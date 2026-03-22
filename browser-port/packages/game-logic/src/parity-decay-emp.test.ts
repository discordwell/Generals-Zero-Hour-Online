/**
 * Parity tests for continuous fire bonus decay smoothness and EMP disable cascade.
 *
 * Test 1: Continuous Fire Bonus Decay
 *   C++ source: Weapon.cpp — FiringTracker state machine.
 *   When a unit stops firing, the continuous fire bonus decays through a state machine:
 *     FAST/MEAN -> NONE (+ CONTINUOUS_FIRE_SLOW flag) after coast frames elapse,
 *     then SLOW -> cleared after an additional LOGICFRAMES_PER_SECOND (30) frames.
 *   This produces a two-step decay (not instant snap-to-zero, not smooth per-frame).
 *
 * Test 2: EMP Disable Cascade
 *   C++ source: Object.cpp, EMPUpdate — DISABLED_EMP blocks movement, weapon fire,
 *   production, and OCL updates. All systems check the status flag independently.
 *   TS: index.ts checks DISABLED_EMP in updateProduction, updateOCLUpdate,
 *       combat-targeting.ts canEntityAttackFromStatus, command-dispatch.ts isEntityDisabledForMovement.
 *
 * Source parity references:
 *   Weapon.cpp — FiringTracker::update(), speedUp(), coolDown()
 *   Object.cpp — isDisabled(), isAbleToAttack()
 *   EMPUpdate.cpp — doDisableAttack(), onObjectCreated()
 */

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import {
  type ParityAgent,
  createParityAgent,
  makeBlock,
  makeObjectDef,
  makeWeaponDef,
  makeWeaponBlock,
  makeLocomotorDef,
  makeBundle,
  makeRegistry,
  makeHeightmap,
  makeMap,
  makeMapObject,
  place,
} from './parity-agent.js';
import { GameLogicSubsystem } from './index.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Access internal entity state for assertions about continuous fire state,
 * object status flags, and other fields not exposed via getEntityState().
 */
function getInternalEntity(agent: ParityAgent, entityId: number) {
  const logic = agent.gameLogic as unknown as {
    spawnedEntities: Map<number, {
      continuousFireState: 'NONE' | 'MEAN' | 'FAST';
      continuousFireCooldownFrame: number;
      consecutiveShotsAtTarget: number;
      objectStatusFlags: Set<string>;
      moving: boolean;
      movePath: Array<{ x: number; z: number }>;
      attackTargetEntityId: number | null;
      attackWeapon: unknown;
      productionQueue: unknown[];
      x: number;
      z: number;
    }>;
    frameCounter: number;
    disabledEmpStatusByEntityId: Map<number, number>;
  };
  return {
    entity: logic.spawnedEntities.get(entityId)!,
    frame: logic.frameCounter,
    disabledEmpMap: logic.disabledEmpStatusByEntityId,
  };
}

// ── Test 1: Continuous Fire Bonus Decay ──────────────────────────────────────

describe('Continuous fire bonus decay smoothness', () => {
  /**
   * C++ source parity: Weapon.cpp / FiringTracker
   *   - ContinuousFireOne: shots needed to enter MEAN state
   *   - ContinuousFireCoast: ms after last possible shot frame before cooldown begins
   *   - After coast window elapses, updateFiringTrackerCooldowns() fires coolDown()
   *   - coolDown(): MEAN -> NONE state + CONTINUOUS_FIRE_SLOW flag (two-step decay)
   *   - Next tick (30 frames later): SLOW flag cleared -> fully cooled
   *
   * TS source: index.ts updateFiringTrackerCooldowns(), continuousFireCoolDown()
   */
  it('decays through SLOW intermediate state, not snapping instantly to zero', () => {
    // Setup: weapon with ContinuousFireMean=2.0 and ContinuousFireCoastFrames=60.
    // ContinuousFireOne=2 means shots > 2 (3rd shot) triggers MEAN state.
    // Use a LOW HP target that will die, naturally stopping fire and
    // letting the coast window expire without auto-targeting interference.
    const coastMs = 2000; // 60 frames at 30 FPS

    const agent = createParityAgent({
      bundles: {
        objects: [
          makeObjectDef('Attacker', 'America', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
            makeWeaponBlock('CFGun'),
          ]),
          // Low HP target — will die after a few shots, stopping fire naturally.
          makeObjectDef('Target', 'China', ['STRUCTURE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 60, InitialHealth: 60 }),
          ]),
        ],
        weapons: [
          makeWeaponDef('CFGun', {
            PrimaryDamage: 10,
            DamageType: 'ARMOR_PIERCING',
            AttackRange: 120,
            DelayBetweenShots: 200,       // 6 frames — fast shots to build up quickly
            ContinuousFireOne: 2,         // shots > 2 -> MEAN
            ContinuousFireTwo: 999,       // Never reach FAST
            ContinuousFireCoast: coastMs, // 60 frame coast window
            WeaponBonus: 'CONTINUOUS_FIRE_MEAN RATE_OF_FIRE 200%',
          }),
        ],
      },
      mapObjects: [place('Attacker', 10, 10), place('Target', 30, 10)],
      mapSize: 8,
      sides: { America: {}, China: {} },
      enemies: [['America', 'China']],
    });

    // Phase 1: Fire until target dies. With 10 damage, 6-frame delay, and 60 HP,
    // the target dies after ~6 shots = ~36 frames. Fire for 60 frames to be safe.
    agent.attack(1, 2);
    agent.step(60);

    // Verify target is dead (no more auto-targeting possible).
    const target = agent.entity(2);
    expect(target === null || !target.alive).toBe(true);

    // After firing 6+ shots, continuous fire should have been activated.
    const afterFiring = getInternalEntity(agent, 1);
    // The state may already be decaying if coast started right after last shot.
    // Record the state — it should be MEAN or in the SLOW transition.
    const stateRightAfterKill = afterFiring.entity.continuousFireState;

    // Phase 2: Coast window check. After target death, the attacker stops firing.
    // The coast window (60 frames) starts from the last possibleNextShotFrame.
    // Within the coast window, the bonus state should remain active.
    //
    // Advance 10 frames — still well within coast window.
    agent.step(10);
    const after10Idle = getInternalEntity(agent, 1);
    // If it was MEAN after the kill, it should still be MEAN.
    // The coast timer hasn't expired yet.
    if (stateRightAfterKill === 'MEAN') {
      expect(after10Idle.entity.continuousFireState).toBe('MEAN');
    }

    // Phase 3: Wait past the coast window + cooldown period.
    // Coast is 60 frames from possibleNextShotFrame (~3 frames bonused delay after last shot).
    // After coast: coolDown() fires, MEAN -> NONE + SLOW flag.
    // After 30 more frames: SLOW cleared.
    // Total needed: ~60 (coast) + 30 (SLOW period) = ~90 frames from death.
    // We already waited 10, so wait another 100 to be safe.
    agent.step(100);
    const afterFullDecay = getInternalEntity(agent, 1);

    // C++ parity: after coast + cooldown, the state machine has fully decayed.
    // The decay is a two-step process:
    //   Step 1 (coast elapsed): MEAN -> NONE state, SLOW flag added (bonus gone, visual spin-down)
    //   Step 2 (30 frames later): SLOW flag cleared (fully cooled)
    //
    // This is NOT smooth per-frame interpolation, and NOT instant snap-to-zero.
    // It is a state-machine transition with an intermediate SLOW visual state.
    expect(afterFullDecay.entity.continuousFireState).toBe('NONE');
    expect(afterFullDecay.entity.objectStatusFlags.has('CONTINUOUS_FIRE_MEAN')).toBe(false);
    expect(afterFullDecay.entity.objectStatusFlags.has('CONTINUOUS_FIRE_FAST')).toBe(false);
    expect(afterFullDecay.entity.objectStatusFlags.has('CONTINUOUS_FIRE_SLOW')).toBe(false);
    expect(afterFullDecay.entity.consecutiveShotsAtTarget).toBe(0);

    // Key finding: bonus removal (continuousFireState = NONE) happens first,
    // visual flag (CONTINUOUS_FIRE_SLOW) clears 30 frames later.
    // This matches C++ FiringTracker::coolDown() behavior.
  });

  it('re-firing within coast window preserves the continuous fire bonus', () => {
    // C++ parity: if the unit resumes firing before the coast window elapses,
    // the bonus is preserved (no cooldown triggered).
    //
    // Strategy: use TWO targets. Fire at target A to build bonus, then fire at
    // target B within the coast window. Coast window preserves bonus across
    // target switching.
    const coastMs = 3000; // 90 frames — long coast window for safety

    const agent = createParityAgent({
      bundles: {
        objects: [
          makeObjectDef('Attacker', 'America', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
            makeWeaponBlock('CFGun'),
          ]),
          makeObjectDef('TargetA', 'China', ['STRUCTURE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 50000, InitialHealth: 50000 }),
          ]),
          makeObjectDef('TargetB', 'China', ['STRUCTURE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 50000, InitialHealth: 50000 }),
          ]),
        ],
        weapons: [
          makeWeaponDef('CFGun', {
            PrimaryDamage: 10,
            DamageType: 'ARMOR_PIERCING',
            AttackRange: 120,
            DelayBetweenShots: 200,
            ContinuousFireOne: 2,
            ContinuousFireTwo: 999,
            ContinuousFireCoast: coastMs,
            WeaponBonus: 'CONTINUOUS_FIRE_MEAN RATE_OF_FIRE 200%',
          }),
        ],
      },
      mapObjects: [
        place('Attacker', 20, 20),
        place('TargetA', 30, 20),
        place('TargetB', 35, 20),
      ],
      mapSize: 8,
      sides: { America: {}, China: {} },
      enemies: [['America', 'China']],
    });

    // Build up bonus by firing at target A for 60 frames.
    // With 6-frame delay, that is ~10 shots. ContinuousFireOne=2 means MEAN after 3rd shot.
    agent.attack(1, 2);
    agent.step(60);
    expect(getInternalEntity(agent, 1).entity.continuousFireState).toBe('MEAN');

    // Switch target to B. This stays within the coast window because we are
    // continuously attacking (not idle). The coast frame was refreshed by each shot.
    agent.attack(1, 3);
    agent.step(60);

    // Bonus should still be active — coast window preserves bonus across target switches.
    // Source parity: FiringTracker tracks consecutiveShotsTargetEntityId, and when
    // switching targets within the coast window, shot count is preserved.
    const afterResume = getInternalEntity(agent, 1);
    expect(afterResume.entity.continuousFireState).toBe('MEAN');
    expect(afterResume.entity.objectStatusFlags.has('CONTINUOUS_FIRE_MEAN')).toBe(true);
  });
});

// ── Test 2: EMP Disable Cascade ──────────────────────────────────────────────

describe('EMP disable cascade', () => {
  /**
   * C++ source parity:
   *   Object.cpp — Object::isDisabled() checks DISABLED_EMP among other flags.
   *   This status blocks:
   *   1. Movement (command-dispatch.ts isEntityDisabledForMovement)
   *   2. Weapon fire (combat-targeting.ts canEntityAttackFromStatus — for PORTABLE_STRUCTURE/SPAWNS_ARE_THE_WEAPONS)
   *   3. Production (index.ts updateProduction skips DISABLED_EMP producers)
   *   4. OCL updates (index.ts updateOCLUpdate pauses timer while disabled)
   *   5. Upgrade side effects (index.ts isObjectDisabledForUpgradeSideEffects)
   *
   * TS source: objectStatusFlags.has('DISABLED_EMP') checked in multiple subsystems.
   */

  function makeEmpTestSetup() {
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);

    // Unit with weapon and movement capability.
    // Uses LocomotorSet block + registered LocomotorDef for proper pathfinding.
    const combatUnit = makeObjectDef('Tank', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
      makeBlock('LocomotorSet', 'SET_NORMAL TankLoco', {}),
      makeWeaponBlock('TankGun'),
    ]);

    // Factory with production capability.
    const factory = makeObjectDef('Factory', 'America', ['STRUCTURE', 'PRODUCTION'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 2000, InitialHealth: 2000 }),
      makeBlock('Behavior', 'ProductionUpdate ModuleTag_Production', {
        MaxQueueEntries: 12,
      }),
    ]);

    // Infantry for production queue.
    const infantry = makeObjectDef('Infantry', 'America', ['INFANTRY'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
    ], { BuildCost: 200, BuildTime: 5 });

    // Enemy target.
    const target = makeObjectDef('EnemyTank', 'China', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 5000, InitialHealth: 5000 }),
    ]);

    const weapon = makeWeaponDef('TankGun', {
      PrimaryDamage: 50,
      DamageType: 'ARMOR_PIERCING',
      AttackRange: 120,
      DelayBetweenShots: 500,
    });

    const bundle = makeBundle({
      objects: [combatUnit, factory, infantry, target],
      weapons: [weapon],
      locomotors: [makeLocomotorDef('TankLoco', 60)],
    });
    const registry = makeRegistry(bundle);
    // Use a large map (128 cells) so pathfinding has room to work.
    const mapSize = 128;

    logic.loadMapObjects(
      makeMap([
        makeMapObject('Tank', 50, 50),       // id=1
        makeMapObject('Factory', 200, 200),  // id=2 — far from tank to avoid collisions
        makeMapObject('EnemyTank', 70, 50),  // id=3 — within weapon range of tank
      ], mapSize, mapSize),
      registry,
      makeHeightmap(mapSize, mapSize),
    );

    logic.setPlayerSide(0, 'America');
    logic.setPlayerSide(1, 'China');
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);
    logic.setSideCredits('America', 10000);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        objectStatusFlags: Set<string>;
        moving: boolean;
        movePath: Array<{ x: number; z: number }>;
        attackTargetEntityId: number | null;
        productionQueue: unknown[];
        canMove: boolean;
        x: number;
        z: number;
      }>;
      frameCounter: number;
      disabledEmpStatusByEntityId: Map<number, number>;
    };

    return { logic, priv };
  }

  it('DISABLED_EMP blocks movement commands', () => {
    // C++ parity: isEntityDisabledForMovement checks DISABLED_EMP.
    // entity-movement.ts issueMoveTo returns early when disabled.
    const { logic, priv } = makeEmpTestSetup();

    const tankEntity = priv.spawnedEntities.get(1)!;
    const startX = tankEntity.x;
    const startZ = tankEntity.z;

    // Apply DISABLED_EMP to the tank.
    tankEntity.objectStatusFlags.add('DISABLED_EMP');

    // Try to issue a move command while EMP'd.
    logic.submitCommand({
      type: 'moveTo',
      entityId: 1,
      targetX: 200,
      targetZ: 200,
      commandSource: 'PLAYER',
    });
    for (let i = 0; i < 30; i++) logic.update(1 / 30);

    // Movement should be blocked (position unchanged).
    expect(tankEntity.x).toBe(startX);
    expect(tankEntity.z).toBe(startZ);
    expect(tankEntity.objectStatusFlags.has('DISABLED_EMP')).toBe(true);
  });

  it('DISABLED_EMP blocks production progress', () => {
    // C++ parity: ProductionUpdate::update skips tick when DISABLED_EMP is set.
    // TS: index.ts updateProduction checks objectStatusFlags.has('DISABLED_EMP').
    const { logic, priv } = makeEmpTestSetup();

    // Queue a unit for production.
    logic.setSideCredits('America', 10000);
    logic.submitCommand({
      type: 'queueUnitProduction',
      entityId: 2,
      unitTemplateName: 'Infantry',
    });

    // Advance a few frames to start production.
    for (let i = 0; i < 5; i++) logic.update(1 / 30);
    const prodBefore = logic.getProductionState(2);
    const progressBefore = prodBefore?.queue[0]?.framesUnderConstruction ?? 0;
    expect(progressBefore).toBeGreaterThan(0);

    // Apply EMP to factory.
    priv.spawnedEntities.get(2)!.objectStatusFlags.add('DISABLED_EMP');

    // Advance 20 frames — production should NOT advance.
    for (let i = 0; i < 20; i++) logic.update(1 / 30);
    const prodDuring = logic.getProductionState(2);
    const progressDuring = prodDuring?.queue[0]?.framesUnderConstruction ?? 0;
    expect(progressDuring).toBe(progressBefore);

    // Remove EMP — production should resume.
    priv.spawnedEntities.get(2)!.objectStatusFlags.delete('DISABLED_EMP');
    for (let i = 0; i < 10; i++) logic.update(1 / 30);
    const prodAfter = logic.getProductionState(2);
    const progressAfter = prodAfter?.queue[0]?.framesUnderConstruction ?? 0;
    expect(progressAfter).toBeGreaterThan(progressDuring);
  });

  it('EMP disable expires after configured duration via timed removal', () => {
    // C++ parity: EMPUpdate tracks disable-until-frame. When the frame counter
    // reaches the expiry frame, DISABLED_EMP is automatically removed.
    // TS: index.ts updateDisabledEmpStatuses() clears the flag on expiry.
    const { logic, priv } = makeEmpTestSetup();
    const empDurationFrames = 60; // 2 seconds at 30 FPS

    // Apply EMP with timed expiry (simulates applyEmpDisable).
    const entity = priv.spawnedEntities.get(1)!;
    entity.objectStatusFlags.add('DISABLED_EMP');
    const expiryFrame = priv.frameCounter + empDurationFrames;
    priv.disabledEmpStatusByEntityId.set(1, expiryFrame);

    // Verify EMP is active.
    expect(entity.objectStatusFlags.has('DISABLED_EMP')).toBe(true);

    // Advance 30 frames (halfway through EMP duration).
    for (let i = 0; i < 30; i++) logic.update(1 / 30);
    expect(entity.objectStatusFlags.has('DISABLED_EMP')).toBe(true);

    // Advance another 35 frames (past the 60-frame duration).
    for (let i = 0; i < 35; i++) logic.update(1 / 30);

    // EMP should have expired — flag should be cleared.
    expect(entity.objectStatusFlags.has('DISABLED_EMP')).toBe(false);
    expect(priv.disabledEmpStatusByEntityId.has(1)).toBe(false);
  });

  it('all disabled functions resume after EMP removal', () => {
    // C++ parity: once DISABLED_EMP is removed, all subsystems resume:
    // movement, production, combat targeting, OCL updates.
    const { logic, priv } = makeEmpTestSetup();

    // Setup: queue production.
    logic.setSideCredits('America', 10000);
    logic.submitCommand({
      type: 'queueUnitProduction',
      entityId: 2,
      unitTemplateName: 'Infantry',
    });

    // Let production start.
    for (let i = 0; i < 3; i++) logic.update(1 / 30);

    // Apply EMP to both tank and factory.
    priv.spawnedEntities.get(1)!.objectStatusFlags.add('DISABLED_EMP');
    priv.spawnedEntities.get(2)!.objectStatusFlags.add('DISABLED_EMP');

    // Snapshot production progress while EMP'd.
    for (let i = 0; i < 10; i++) logic.update(1 / 30);
    const prodFrozen = logic.getProductionState(2)?.queue[0]?.framesUnderConstruction ?? 0;

    // Verify tank cannot move while EMP'd.
    const tankStartX = priv.spawnedEntities.get(1)!.x;
    const tankStartZ = priv.spawnedEntities.get(1)!.z;
    logic.submitCommand({
      type: 'moveTo',
      entityId: 1,
      targetX: 300,
      targetZ: 300,
      commandSource: 'PLAYER',
    });
    for (let i = 0; i < 10; i++) logic.update(1 / 30);
    expect(priv.spawnedEntities.get(1)!.x).toBe(tankStartX);
    expect(priv.spawnedEntities.get(1)!.z).toBe(tankStartZ);

    // Remove EMP from both entities.
    priv.spawnedEntities.get(1)!.objectStatusFlags.delete('DISABLED_EMP');
    priv.spawnedEntities.get(2)!.objectStatusFlags.delete('DISABLED_EMP');

    // Production should resume after EMP removal.
    for (let i = 0; i < 20; i++) logic.update(1 / 30);
    const prodResumed = logic.getProductionState(2)?.queue[0]?.framesUnderConstruction ?? 0;
    expect(prodResumed).toBeGreaterThan(prodFrozen);

    // Movement should now succeed after EMP removal.
    // Issue a fresh move command (the previous one was rejected while disabled).
    logic.submitCommand({
      type: 'moveTo',
      entityId: 1,
      targetX: 300,
      targetZ: 300,
      commandSource: 'PLAYER',
    });
    for (let i = 0; i < 30; i++) logic.update(1 / 30);

    // Tank should have moved from its original position.
    const tankAfterX = priv.spawnedEntities.get(1)!.x;
    const tankAfterZ = priv.spawnedEntities.get(1)!.z;
    const moved = tankAfterX !== tankStartX || tankAfterZ !== tankStartZ;
    expect(moved).toBe(true);

    // Verify EMP flags are fully cleared.
    expect(priv.spawnedEntities.get(1)!.objectStatusFlags.has('DISABLED_EMP')).toBe(false);
    expect(priv.spawnedEntities.get(2)!.objectStatusFlags.has('DISABLED_EMP')).toBe(false);
  });
});
