/**
 * Parity Tests — Weapon Clip Auto-Reload on Idle and Victory Condition Grace Period.
 *
 * Two parity scenarios verified:
 *
 * 1. Auto-Reload When Idle Actually Reloads Clip
 *    C++ FiringTracker.cpp:107-109 — each shot sets m_frameToForceReload = now + autoReloadDelay.
 *    C++ FiringTracker.cpp:175-178 — update() checks if frame >= m_frameToForceReload,
 *      then calls getObject()->reloadAllAmmo(TRUE) and resets the timer.
 *    TS combat-update.ts:282-283 — sets attackForceReloadFrame = frameCounter + autoReloadWhenIdleFrames.
 *    TS combat-helpers.ts:310-336 — updateWeaponIdleAutoReload checks forceReloadFrame,
 *      restores clip to full, resets reload timer, and makes next attack available immediately.
 *
 * 2. Victory Condition Grace Period (Simultaneous Defeat)
 *    C++ VictoryConditions.cpp:192-193 — `if (TheGameLogic->getFrame() > 1)` guards defeat
 *      processing so that the first few frames don't trigger false defeats while entities spawn.
 *    C++ VictoryConditions.cpp:153-183 — checks if only a single alliance remains; if all
 *      players are simultaneously defeated, m_singleAllianceRemaining is still set because
 *      the !multipleAlliances path fires (no alive players = no multiple alliances).
 *    TS entity-lifecycle.ts:1989-1995 — if ALL active sides are newly defeated AND
 *      frameCounter <= 2, returns early (grace period prevents mutual early-frame loss).
 *    TS entity-lifecycle.ts:2014-2019 — if remainingSides.length === 0 after defeat
 *      processing, the game ends as a draw (gameEndFrame set but no victor).
 */

import { describe, expect, it } from 'vitest';

import {
  createParityAgent,
  makeBlock,
  makeObjectDef,
  makeWeaponDef,
  makeWeaponBlock,
  place,
} from './parity-agent.js';

// ── Test 1: Auto-Reload When Idle Actually Reloads Clip ──────────────────────

describe('auto-reload when idle reloads clip', () => {
  it('reloads clip to full after idle period and fires immediately on re-engagement', () => {
    // C++ source parity:
    //   FiringTracker.cpp:106-109 — on each shot:
    //     UnsignedInt autoReloadDelay = weaponFired->getAutoReloadWhenIdleFrames();
    //     if( autoReloadDelay > 0 )
    //       m_frameToForceReload = now + autoReloadDelay;
    //
    //   FiringTracker.cpp:175-178 — on update:
    //     if( m_frameToForceReload != 0 && now >= m_frameToForceReload )
    //       getObject()->reloadAllAmmo(TRUE);
    //       m_frameToForceReload = 0;
    //
    // TS source parity:
    //   combat-update.ts:282-283 — on shot:
    //     attacker.attackForceReloadFrame = context.frameCounter + weapon.autoReloadWhenIdleFrames;
    //
    //   combat-helpers.ts:310-336 — updateWeaponIdleAutoReload:
    //     if forceReloadFrame > 0 && frameCounter >= forceReloadFrame:
    //       entity.attackAmmoInClip = weapon.clipSize;
    //       entity.nextAttackFrame = frameCounter; // fire immediately
    //
    // Setup: ClipSize=3, AutoReloadWhenIdle=1000ms (30 frames at 30 FPS).
    // Fire 2 shots (leaving 1 in clip). Stop attacking. Wait 40 frames.
    // Verify clip is fully reloaded (ammo = 3). Attack again and verify
    // first shot fires immediately (no reload delay).

    const clipSize = 3;
    const autoReloadMs = 1000; // 30 frames at 30 FPS

    const agent = createParityAgent({
      bundles: {
        objects: [
          makeObjectDef('Attacker', 'America', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
            makeWeaponBlock('IdleClipGun'),
          ]),
          makeObjectDef('Target', 'China', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 5000, InitialHealth: 5000 }),
          ]),
        ],
        weapons: [
          makeWeaponDef('IdleClipGun', {
            PrimaryDamage: 10,
            DamageType: 'ARMOR_PIERCING',
            AttackRange: 120,
            DelayBetweenShots: 100,       // 3 frames between shots
            ClipSize: clipSize,
            ClipReloadTime: 30000,        // 900 frames — very long, should never be hit
            AutoReloadWhenIdle: autoReloadMs,
          }),
        ],
      },
      mapObjects: [place('Attacker', 10, 10), place('Target', 30, 10)],
      mapSize: 8,
      sides: { America: {}, China: {} },
      enemies: [['America', 'China']],
    });

    // Start attacking and fire 2 shots.
    agent.attack(1, 2);

    // Step frames to let 2 shots fire. At 3 frames per DelayBetweenShots:
    // Shot 1 fires around frame ~3-5, shot 2 around frame ~6-10.
    // Run 12 frames to be safe.
    const healthTimeline: number[] = [];
    for (let i = 0; i < 12; i++) {
      agent.step(1);
      healthTimeline.push(agent.entity(2)?.health ?? -1);
    }

    // Count shots fired so far.
    const damageEvents = healthTimeline
      .map((h, i) => i > 0 && h < healthTimeline[i - 1]! ? 1 : 0)
      .reduce((sum, v) => sum + v, 0);

    // Should have fired at least 2 shots (10 damage each).
    const targetHealthAfterBurst = agent.entity(2)!.health;
    expect(damageEvents).toBeGreaterThanOrEqual(2);
    expect(targetHealthAfterBurst).toBeLessThanOrEqual(5000 - 20);

    // Access internal state to check ammo.
    const logic = agent.gameLogic as unknown as {
      spawnedEntities: Map<number, {
        id: number;
        attackAmmoInClip: number;
        attackForceReloadFrame: number;
      }>;
    };
    const attacker = logic.spawnedEntities.get(1)!;

    // After 2+ shots from a clip of 3, ammo should be <= 1.
    const ammoAfterBurst = attacker.attackAmmoInClip;
    expect(ammoAfterBurst).toBeLessThan(clipSize);

    // Stop attacking — the unit is now idle.
    agent.stop(1);

    // The forceReloadFrame should have been set on the last shot.
    // It should be > 0 (the idle timer is ticking).
    expect(attacker.attackForceReloadFrame).toBeGreaterThan(0);

    // Wait 40 frames (longer than 30 frame idle threshold).
    // The idle auto-reload should trigger during this period.
    agent.step(40);

    // After the idle timeout, the clip should be fully reloaded.
    // C++ parity: FiringTracker::update calls reloadAllAmmo(TRUE) which fills the clip.
    // TS parity: updateWeaponIdleAutoReload sets attackAmmoInClip = weapon.clipSize.
    const ammoAfterIdle = attacker.attackAmmoInClip;
    expect(ammoAfterIdle).toBe(clipSize);

    // The force reload frame should be reset to 0 after triggering.
    expect(attacker.attackForceReloadFrame).toBe(0);

    // Now attack again — the first shot should fire immediately (no clip reload delay).
    const targetHealthBeforeReengage = agent.entity(2)!.health;
    agent.attack(1, 2);

    // Step just a few frames — the shot should land within the first ~5 frames
    // because the clip is already full and no reload delay is needed.
    const reengageTimeline: number[] = [];
    for (let i = 0; i < 8; i++) {
      agent.step(1);
      reengageTimeline.push(agent.entity(2)?.health ?? -1);
    }

    // Verify at least one shot hit during re-engagement.
    const targetHealthAfterReengage = agent.entity(2)!.health;
    expect(targetHealthAfterReengage).toBeLessThan(targetHealthBeforeReengage);

    // Verify the first damage came quickly (within first 5 frames).
    const firstDamageFrame = reengageTimeline.findIndex(
      (h, i) => i > 0 && h < reengageTimeline[i - 1]!,
    );
    // firstDamageFrame should be small — if clip was reloaded, no 900-frame wait.
    // A value of -1 means no damage (impossible since we verified above), but if
    // the first damage lands at frame 0 or 1, that confirms immediate fire.
    if (firstDamageFrame >= 0) {
      expect(firstDamageFrame).toBeLessThanOrEqual(5);
    }
  });
});

// ── Test 2: Victory Condition Grace Period ───────────────────────────────────

describe('victory condition grace period', () => {
  it('declares VICTORY when all enemy buildings and units are destroyed', () => {
    // C++ source parity:
    //   VictoryConditions.cpp:274-304 — hasSinglePlayerBeenDefeated:
    //     if (ISSET(NOUNITS) && ISSET(NOBUILDINGS))
    //       if (!player->hasAnyObjects()) return true;
    //
    //   VictoryConditions.cpp:153-183 — update checks for single alliance remaining.
    //     When only one alliance survives, m_singleAllianceRemaining = true
    //     and m_endFrame = TheGameLogic->getFrame().
    //
    // TS source parity:
    //   entity-lifecycle.ts:1964-2047 — checkVictoryConditions:
    //     Checks each active side via hasSingleSideBeenDefeated.
    //     When only one alliance group remains, sets gameEndFrame.
    //
    //   index.ts:30799-30818 — hasSingleSideBeenDefeated:
    //     Returns true if the side has zero surviving non-excluded entities
    //     (excludes PROJECTILE, MINE, INERT).
    //
    // Setup: 1v1 game. Destroy all enemy buildings/units. Step frames.
    // Verify VICTORY is declared.

    const agent = createParityAgent({
      bundles: {
        objects: [
          // Player's units (America)
          makeObjectDef('PlayerUnit', 'America', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
            makeWeaponBlock('KillGun'),
          ]),
          // Enemy structure (China)
          makeObjectDef('EnemyHQ', 'China', ['STRUCTURE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          ]),
          // Enemy unit (China)
          makeObjectDef('EnemyUnit', 'China', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          ]),
        ],
        weapons: [
          makeWeaponDef('KillGun', {
            PrimaryDamage: 500,
            DamageType: 'ARMOR_PIERCING',
            AttackRange: 200,
            DelayBetweenShots: 100,
          }),
        ],
      },
      mapObjects: [
        place('PlayerUnit', 30, 30),   // id 1
        place('EnemyHQ', 50, 30),      // id 2
        place('EnemyUnit', 60, 30),    // id 3
      ],
      mapSize: 16,
      sides: { America: {}, China: {} },
      enemies: [['America', 'China']],
    });

    // Verify game has not ended yet.
    expect(agent.state().gameEnd).toBeNull();

    // Kill the enemy building first.
    agent.attack(1, 2);
    agent.step(15);

    // Enemy building should be destroyed.
    const enemyHQ = agent.entity(2);
    expect(enemyHQ === null || !enemyHQ.alive).toBe(true);

    // Game should NOT have ended yet — enemy still has a unit.
    // (Unless the unit was within splash range, which it shouldn't be.)
    const enemyUnit = agent.entity(3);
    if (enemyUnit && enemyUnit.alive) {
      expect(agent.state().gameEnd).toBeNull();

      // Now kill the enemy unit.
      agent.attack(1, 3);
      agent.step(15);
    }

    // All enemy entities should be eliminated.
    const enemyUnitAfter = agent.entity(3);
    expect(enemyUnitAfter === null || !enemyUnitAfter.alive).toBe(true);

    // Step a few more frames for victory condition check to run.
    agent.step(5);

    // Victory should be declared.
    const gameEnd = agent.state().gameEnd;
    expect(gameEnd).not.toBeNull();
    expect(gameEnd!.status).toBe('VICTORY');
    // Side names are normalized to lowercase by setPlayerSide.
    expect(gameEnd!.victorSides).toContain('america');
    expect(gameEnd!.defeatedSides).toContain('china');
  });

  it('grace period prevents simultaneous defeat on early frames', () => {
    // C++ source parity:
    //   VictoryConditions.cpp:192-193 — `if (TheGameLogic->getFrame() > 1)`:
    //     Defeat processing is skipped on frame 0 and frame 1 to prevent false
    //     defeats while SkirmishScripts.scb spawns initial entities. Without
    //     this guard, both sides would be defeated before any entities exist.
    //
    // TS source parity:
    //   entity-lifecycle.ts:1989-1995:
    //     if (newlyDefeated.length === activeSides.size && self.frameCounter <= 2)
    //       return; // Grace period — all sides appear defeated simultaneously.
    //
    // This test verifies: if both sides lose all entities on the same frame
    // (both have zero entities), the early-frame guard prevents mutual defeat.
    //
    // Setup: 1v1 game with NO entities on the map. On early frames, both sides
    // have zero entities, which would trigger hasSingleSideBeenDefeated for both.
    // The grace period (frameCounter <= 2) should prevent the game from ending.

    const agent = createParityAgent({
      bundles: {
        objects: [
          // Define the templates but don't place them on the map.
          makeObjectDef('Unit', 'America', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          ]),
          makeObjectDef('EnemyUnit', 'China', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          ]),
        ],
      },
      // No map objects — both sides start with zero entities.
      mapObjects: [],
      mapSize: 16,
      sides: { America: {}, China: {} },
      enemies: [['America', 'China']],
    });

    // Step the first 2 frames (grace period: frameCounter <= 2).
    agent.step(2);

    // During the grace period, even though both sides have zero entities,
    // the game should NOT end — the guard prevents simultaneous defeat.
    // C++ parity: frame <= 1 (frame 0 and 1) skips defeat processing.
    // TS parity: frameCounter <= 2 (accounts for pre-init frame offset).
    const gameEndDuringGrace = agent.state().gameEnd;
    expect(gameEndDuringGrace).toBeNull();
  });

  it('simultaneous defeat after grace period results in game end (draw)', () => {
    // C++ source parity:
    //   VictoryConditions.cpp:153-183 — when NO alive players remain
    //     (multipleAlliances is false because no one is alive), the code
    //     sets m_singleAllianceRemaining = true and m_endFrame. But both
    //     sides are marked defeated, so hasAchievedVictory returns false
    //     for both — effectively a draw.
    //
    // TS source parity:
    //   entity-lifecycle.ts:2014-2019 — if remainingSides.length === 0
    //     after defeat processing, gameEndFrame is set (draw).
    //
    // Setup: 1v1 game with units on both sides. Step past the early-frame
    // grace period, then directly kill both sides' entities on the same
    // frame to trigger simultaneous defeat. After processing, game ends
    // as a draw with no victor.

    const agent = createParityAgent({
      bundles: {
        objects: [
          makeObjectDef('Unit', 'America', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          ]),
          makeObjectDef('EnemyUnit', 'China', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          ]),
        ],
      },
      mapObjects: [
        place('Unit', 30, 30),            // id 1 — America
        place('EnemyUnit', 50, 30),       // id 2 — China
      ],
      mapSize: 16,
      sides: { America: {}, China: {} },
      enemies: [['America', 'China']],
    });

    // Verify game starts normally.
    expect(agent.state().gameEnd).toBeNull();

    // Step past the grace period (frameCounter > 2).
    agent.step(5);
    expect(agent.state().gameEnd).toBeNull();

    // Directly kill both entities simultaneously by setting health to 0
    // and marking them as destroyed. This simulates mutual destruction.
    const logic = agent.gameLogic as unknown as {
      spawnedEntities: Map<number, {
        id: number;
        health: number;
        destroyed: boolean;
        side: string;
      }>;
    };

    const unit = logic.spawnedEntities.get(1)!;
    const enemyUnit = logic.spawnedEntities.get(2)!;
    unit.health = 0;
    unit.destroyed = true;
    enemyUnit.health = 0;
    enemyUnit.destroyed = true;

    // Step frames to trigger victory condition check.
    agent.step(3);

    // The game should have ended. Since both sides lost all entities,
    // this is a draw scenario. The TS code sets gameEndFrame when
    // remainingSides.length === 0 (entity-lifecycle.ts:2014-2019).
    const gameEnd = agent.state().gameEnd;
    expect(gameEnd).not.toBeNull();

    // Both sides should be in the defeated list (lowercase normalized).
    expect(gameEnd!.defeatedSides).toContain('america');
    expect(gameEnd!.defeatedSides).toContain('china');

    // No victor — all sides are defeated.
    // The status for the local player (America, player index 0) should be DEFEAT.
    expect(gameEnd!.status).toBe('DEFEAT');
    expect(gameEnd!.victorSides).toHaveLength(0);
  });
});
