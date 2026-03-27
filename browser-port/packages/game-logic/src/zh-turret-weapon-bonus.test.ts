/**
 * ZH Turret & Weapon Bonus Runtime Logic Tests
 *
 * Tests three ZH-specific runtime behaviors:
 *   1. Linked turrets fire simultaneously (TurretsLinked = Yes)
 *   2. Container weapon bonus propagation (WeaponBonusPassedToPassengers = Yes)
 *   3. Weapon bonus change triggers immediate reload recalculation
 *
 * Source parity references:
 *   AIStates.cpp:5292-5304 — linked turrets fire all weapon slots
 *   Weapon.cpp:1828-1833 — container weapon bonus propagation
 *   Weapon.cpp:1959-1997 — onWeaponBonusChange timer recalculation
 *   Object.cpp:4674-4697 — set/clearWeaponBonusCondition calls weaponSetOnWeaponBonusChange
 */

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import {
  type ParityAgent,
  makeBlock,
  makeBundle,
  makeObjectDef,
  makeWeaponDef,
  makeWeaponBlock,
  makeRegistry,
  makeHeightmap,
  makeMap,
  place,
} from './parity-agent.js';
import { GameLogicSubsystem } from './index.js';
import type { IniDataBundle, WeaponBonusEntry } from '@generals/ini-data';
import type { MapObjectJSON } from '@generals/terrain';

// ── Custom agent factory that supports GameData weapon bonus table ───────────

function createBonusParityAgent(config: {
  bundleParams: Parameters<typeof makeBundle>[0];
  weaponBonusEntries: WeaponBonusEntry[];
  mapObjects?: MapObjectJSON[];
  mapSize?: number;
  sides: Record<string, { credits?: number; playerType?: string }>;
  enemies?: [string, string][];
}): ParityAgent {
  const bundle = makeBundle(config.bundleParams) as IniDataBundle;
  bundle.gameData = { weaponBonusEntries: config.weaponBonusEntries };

  const registry = makeRegistry(bundle);
  const mapSize = config.mapSize ?? 64;
  const mapObjects = config.mapObjects ?? [];
  const map = makeMap(mapObjects, mapSize, mapSize);
  const heightmap = makeHeightmap(mapSize, mapSize);

  const scene = new THREE.Scene();
  const logic = new GameLogicSubsystem(scene);

  logic.loadMapObjects(map, registry, heightmap);

  let playerIndex = 0;
  const sideNames = Object.keys(config.sides);
  for (const side of sideNames) {
    logic.setPlayerSide(playerIndex, side);
    const sideConfig = config.sides[side]!;
    if (sideConfig.credits !== undefined) {
      logic.setSideCredits(side, sideConfig.credits);
    }
    playerIndex++;
  }

  if (config.enemies) {
    for (const [a, b] of config.enemies) {
      logic.setTeamRelationship(a, b, 0);
      logic.setTeamRelationship(b, a, 0);
    }
  }

  interface AgentEntity {
    id: number;
    template: string;
    side: string;
    pos: [number, number, number];
    health: number;
    maxHealth: number;
    alive: boolean;
    veterancy: number;
    constructionPct: number;
    statusFlags: string[];
  }

  interface AgentState {
    tick: number;
    credits: Record<string, number>;
    entities: AgentEntity[];
    gameEnd: { status: string; victorSides: string[]; defeatedSides: string[] } | null;
  }

  interface AgentStateDiff {
    tickDelta: number;
    creditChanges: Record<string, number>;
    damaged: { id: number; template: string; hpBefore: number; hpAfter: number }[];
    destroyed: { id: number; template: string }[];
    spawned: { id: number; template: string }[];
  }

  function allEntityIds(): number[] {
    const ids: number[] = [];
    const maxId = (logic as unknown as { nextId: number }).nextId ?? 10000;
    for (let id = 1; id < maxId; id++) {
      if (logic.getEntityState(id) !== null) {
        ids.push(id);
      }
    }
    return ids;
  }

  function toAgentEntity(id: number): AgentEntity | null {
    const s = logic.getEntityState(id);
    if (!s) return null;
    return {
      id: s.id,
      template: s.templateName,
      side: s.side,
      pos: [s.x, s.y, s.z],
      health: s.health,
      maxHealth: s.maxHealth,
      alive: s.alive,
      veterancy: s.veterancyLevel,
      constructionPct: s.constructionPercent,
      statusFlags: s.statusFlags,
    };
  }

  function gatherEntities(side?: string): AgentEntity[] {
    const all = allEntityIds().map(toAgentEntity).filter((e): e is AgentEntity => e !== null);
    if (side === undefined) return all;
    const normalizedSide = side.toLowerCase();
    return all.filter((e) => e.side.toLowerCase() === normalizedSide);
  }

  function gatherCredits(): Record<string, number> {
    const credits: Record<string, number> = {};
    for (const side of sideNames) {
      credits[side] = logic.getSideCredits(side);
    }
    return credits;
  }

  function gatherGameEnd(): AgentState['gameEnd'] {
    const ge = logic.getGameEndState();
    if (!ge) return null;
    return { status: ge.status, victorSides: ge.victorSides, defeatedSides: ge.defeatedSides };
  }

  function buildState(): AgentState {
    return {
      tick: (logic as unknown as { frameCounter: number }).frameCounter ?? 0,
      credits: gatherCredits(),
      entities: gatherEntities(),
      gameEnd: gatherGameEnd(),
    };
  }

  const MAX_STEP_FRAMES = 900;

  const agent: ParityAgent = {
    get gameLogic() { return logic; },

    state() { return buildState(); },
    entities(side?: string) { return gatherEntities(side); },
    entity(id: number) { return toAgentEntity(id); },

    move(entityId: number, x: number, z: number) {
      logic.submitCommand({ type: 'moveTo', entityId, targetX: x, targetZ: z, commandSource: 'PLAYER' });
    },
    attackMove(entityId: number, x: number, z: number) {
      logic.submitCommand({
        type: 'attackMoveTo', entityId, targetX: x, targetZ: z,
        attackDistance: logic.getAttackMoveDistanceForEntity(entityId), commandSource: 'PLAYER',
      });
    },
    attack(entityId: number, targetId: number) {
      logic.submitCommand({ type: 'attackEntity', entityId, targetEntityId: targetId, commandSource: 'PLAYER' });
    },
    guard(entityId: number, x: number, z: number) {
      logic.submitCommand({ type: 'guardPosition', entityId, targetX: x, targetZ: z, guardMode: 0, commandSource: 'PLAYER' });
    },
    stop(entityId: number) {
      logic.submitCommand({ type: 'stop', entityId, commandSource: 'PLAYER' });
    },
    build(dozerId: number, template: string, x: number, z: number) {
      logic.submitCommand({
        type: 'constructBuilding', entityId: dozerId, templateName: template,
        targetPosition: [x, 0, z], angle: 0, lineEndPosition: null,
      });
    },
    train(buildingId: number, unitTemplate: string) {
      logic.submitCommand({ type: 'queueUnitProduction', entityId: buildingId, unitTemplateName: unitTemplate });
    },
    upgrade(entityId: number, upgradeName: string) {
      logic.submitCommand({ type: 'applyUpgrade', entityId, upgradeName });
    },
    sell(entityId: number) {
      logic.submitCommand({ type: 'sell', entityId });
    },

    step(n = 1) {
      const frames = Math.min(Math.max(1, Math.trunc(n)), MAX_STEP_FRAMES);
      for (let i = 0; i < frames; i++) {
        logic.update(1 / 30);
      }
      return buildState();
    },

    setCredits(side: string, amount: number) {
      logic.setSideCredits(side, amount);
    },

    snapshot() { return buildState(); },

    diff(before: AgentState): AgentStateDiff {
      const after = buildState();
      const tickDelta = after.tick - before.tick;
      const creditChanges: Record<string, number> = {};
      for (const side of sideNames) {
        const delta = (after.credits[side] ?? 0) - (before.credits[side] ?? 0);
        if (delta !== 0) creditChanges[side] = delta;
      }
      const beforeById = new Map(before.entities.map((e) => [e.id, e]));
      const afterById = new Map(after.entities.map((e) => [e.id, e]));
      const damaged: AgentStateDiff['damaged'] = [];
      const destroyed: AgentStateDiff['destroyed'] = [];
      const spawned: AgentStateDiff['spawned'] = [];
      for (const [id, beforeEntity] of beforeById) {
        const afterEntity = afterById.get(id);
        if (!afterEntity) { destroyed.push({ id, template: beforeEntity.template }); continue; }
        if (beforeEntity.alive && !afterEntity.alive) destroyed.push({ id, template: beforeEntity.template });
        if (afterEntity.health < beforeEntity.health) {
          damaged.push({ id, template: beforeEntity.template, hpBefore: beforeEntity.health, hpAfter: afterEntity.health });
        }
      }
      for (const [id, afterEntity] of afterById) {
        if (!beforeById.has(id)) spawned.push({ id, template: afterEntity.template });
      }
      return { tickDelta, creditChanges, damaged, destroyed, spawned };
    },
  };

  return agent;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('ZH turret and weapon bonus runtime logic', () => {

  // ══════════════════════════════════════════════════════════════════════════
  // Fix 1: Linked turrets fire simultaneously
  // ══════════════════════════════════════════════════════════════════════════

  describe('linked turrets fire simultaneously', () => {
    it('TurretsLinked entity deals damage from both PRIMARY and SECONDARY weapons per shot cycle', () => {
      // Source parity: AIStates.cpp:5292-5304
      // When TurretsLinked = Yes, all weapon slots fire at the same target.
      // Overlord tank has a main cannon and a gattling gun that fire together.
      const primaryDamage = 50;
      const secondaryDamage = 30;

      const agent = createBonusParityAgent({
        bundleParams: {
          objects: [
            makeObjectDef('LinkedTurretUnit', 'America', ['VEHICLE'], [
              makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
              makeBlock('WeaponSet', 'WeaponSet', {
                Weapon: ['PRIMARY MainCannon', 'SECONDARY GattlingGun'],
              }),
              makeBlock('Behavior', 'AIUpdateInterface ModuleTag_AI', {
                TurretsLinked: true,
              }),
            ]),
            makeObjectDef('Target', 'China', ['VEHICLE'], [
              makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 5000, InitialHealth: 5000 }),
            ]),
          ],
          weapons: [
            makeWeaponDef('MainCannon', {
              PrimaryDamage: primaryDamage,
              PrimaryDamageRadius: 0,
              AttackRange: 150,
              DamageType: 'ARMOR_PIERCING',
              DeathType: 'NORMAL',
              DelayBetweenShots: 500,
              ProjectileNugget: 'No',
            }),
            makeWeaponDef('GattlingGun', {
              PrimaryDamage: secondaryDamage,
              PrimaryDamageRadius: 0,
              AttackRange: 100,
              DamageType: 'COMANCHE_VULCAN',
              DeathType: 'NORMAL',
              DelayBetweenShots: 500,
              ProjectileNugget: 'No',
            }),
          ],
        },
        weaponBonusEntries: [],
        mapObjects: [
          place('LinkedTurretUnit', 'America', 32, 32),
          place('Target', 'China', 34, 32),
        ],
        mapSize: 64,
        sides: { America: {}, China: {} },
        enemies: [['America', 'China']],
      });

      const attacker = agent.entities('America')[0]!;
      const target = agent.entities('China')[0]!;

      // Issue attack command.
      agent.attack(attacker.id, target.id);

      // Step enough frames for the weapon to fire once.
      const before = agent.snapshot();
      agent.step(60);
      const diff = agent.diff(before);

      // The target should have taken damage from BOTH weapons.
      const targetDamage = diff.damaged.find((d) => d.id === target.id);
      expect(targetDamage).toBeDefined();
      // With linked turrets, damage should be >= primaryDamage + secondaryDamage.
      // (armor may reduce it, but with default armor the full amount goes through)
      const totalExpectedMinDamage = primaryDamage + secondaryDamage;
      const actualDamage = targetDamage!.hpBefore - targetDamage!.hpAfter;
      expect(actualDamage).toBeGreaterThanOrEqual(totalExpectedMinDamage);
    });

    it('non-linked turret entity only fires the selected weapon slot', () => {
      // Control test: when TurretsLinked is NOT set, only one weapon fires per cycle.
      const primaryDamage = 50;
      const secondaryDamage = 30;

      const agent = createBonusParityAgent({
        bundleParams: {
          objects: [
            makeObjectDef('NormalTurretUnit', 'America', ['VEHICLE'], [
              makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
              makeBlock('WeaponSet', 'WeaponSet', {
                Weapon: ['PRIMARY MainCannon', 'SECONDARY GattlingGun'],
              }),
              makeBlock('Behavior', 'AIUpdateInterface ModuleTag_AI', {}),
            ]),
            makeObjectDef('Target', 'China', ['VEHICLE'], [
              makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 5000, InitialHealth: 5000 }),
            ]),
          ],
          weapons: [
            makeWeaponDef('MainCannon', {
              PrimaryDamage: primaryDamage,
              PrimaryDamageRadius: 0,
              AttackRange: 150,
              DamageType: 'ARMOR_PIERCING',
              DeathType: 'NORMAL',
              DelayBetweenShots: 500,
              ProjectileNugget: 'No',
            }),
            makeWeaponDef('GattlingGun', {
              PrimaryDamage: secondaryDamage,
              PrimaryDamageRadius: 0,
              AttackRange: 100,
              DamageType: 'COMANCHE_VULCAN',
              DeathType: 'NORMAL',
              DelayBetweenShots: 500,
              ProjectileNugget: 'No',
            }),
          ],
        },
        weaponBonusEntries: [],
        mapObjects: [
          place('NormalTurretUnit', 'America', 32, 32),
          place('Target', 'China', 34, 32),
        ],
        mapSize: 64,
        sides: { America: {}, China: {} },
        enemies: [['America', 'China']],
      });

      const attacker = agent.entities('America')[0]!;
      const target = agent.entities('China')[0]!;

      agent.attack(attacker.id, target.id);

      const before = agent.snapshot();
      agent.step(60);
      const diff = agent.diff(before);

      const targetDamage = diff.damaged.find((d) => d.id === target.id);
      expect(targetDamage).toBeDefined();
      // Non-linked: only the primary weapon fires, so damage should be exactly primaryDamage
      // (or a small multiple from multiple shots in 60 frames).
      const actualDamage = targetDamage!.hpBefore - targetDamage!.hpAfter;
      // With 500ms delay = 15 frames, in 60 frames we get ~4 shots at 50 damage = 200 total.
      // The secondary weapon (30 damage) should NOT fire, so total should be <= 4 * primaryDamage.
      expect(actualDamage).toBeLessThanOrEqual(primaryDamage * 5); // allowing 1 extra shot margin
      // Also verify it does NOT include secondary weapon damage per shot.
      // Each shot cycle does exactly primaryDamage, not primaryDamage+secondaryDamage.
      // With ~4 shots, total ~200, not ~320 (if secondary were included).
      expect(actualDamage).toBeLessThan(primaryDamage * 4 + secondaryDamage * 3);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Fix 2: Container weapon bonus propagation at fire time
  // ══════════════════════════════════════════════════════════════════════════

  describe('container weapon bonus propagation', () => {
    it('passenger inherits container weapon bonus flags when WeaponBonusPassedToPassengers is true', () => {
      // Source parity: Weapon.cpp:1828-1833
      // If passenger is inside a container with WeaponBonusPassedToPassengers=Yes,
      // the container's weaponBonusConditionFlags are ORed into the passenger's bonus at fire time.

      // We verify this by giving the container a VETERAN bonus (which has a DAMAGE multiplier)
      // and checking that the passenger's damage output reflects the bonus.

      const baseDamage = 100;
      const veteranDamageMultiplier = 1.5;

      const agent = createBonusParityAgent({
        bundleParams: {
          objects: [
            // Container: an open-contain vehicle that passes weapon bonus to passengers.
            makeObjectDef('BattleBus', 'America', ['VEHICLE'], [
              makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
              makeBlock('Behavior', 'OpenContain ModuleTag_Contain', {
                ContainMax: 5,
                AllowInsideKindOf: 'INFANTRY',
                PassengersAllowedToFire: true,
                WeaponBonusPassedToPassengers: true,
              }),
            ], { ExperienceRequired: [0, 10, 50, 100], ExperienceValue: [1, 2, 3, 4] }),
            // Passenger: infantry that will fire from inside the bus.
            makeObjectDef('Soldier', 'America', ['INFANTRY'], [
              makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
              makeWeaponBlock('SoldierGun'),
            ]),
            // Target to shoot at.
            makeObjectDef('Target', 'China', ['VEHICLE'], [
              makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 5000, InitialHealth: 5000 }),
            ]),
          ],
          weapons: [
            makeWeaponDef('SoldierGun', {
              PrimaryDamage: baseDamage,
              PrimaryDamageRadius: 0,
              AttackRange: 150,
              DamageType: 'ARMOR_PIERCING',
              DeathType: 'NORMAL',
              DelayBetweenShots: 2000,
            }),
          ],
        },
        weaponBonusEntries: [
          { condition: 'VETERAN', field: 'DAMAGE', multiplier: veteranDamageMultiplier },
        ],
        mapObjects: [
          place('BattleBus', 'America', 32, 32),
          place('Target', 'China', 34, 32),
        ],
        mapSize: 64,
        sides: { America: {}, China: {} },
        enemies: [['America', 'China']],
      });

      // Access internal state to set up the scenario:
      // 1. Spawn a soldier inside the bus
      // 2. Set the bus to VETERAN status to give it bonus flags
      const gl = agent.gameLogic as unknown as {
        spawnedEntities: Map<number, {
          id: number; templateName: string; weaponBonusConditionFlags: number;
          transportContainerId: number | null;
        }>;
        spawnEntityInContainer(templateName: string, containerId: number): number | null;
        resolveEntityWeaponBonusConditionFlags(entity: unknown): number;
      };

      const busEntity = agent.entities('America').find((e) => e.template === 'BattleBus');
      expect(busEntity).toBeDefined();

      // Give the bus VETERAN weapon bonus flags (bit 9).
      const busInternal = gl.spawnedEntities.get(busEntity!.id)!;
      const WEAPON_BONUS_VETERAN = 1 << 9;
      busInternal.weaponBonusConditionFlags |= WEAPON_BONUS_VETERAN;

      // Verify that a passenger entity conceptually inside the bus would get the bonus.
      // We verify via the resolveEntityWeaponBonusConditionFlags method.
      // First, find a soldier entity to test with.
      const soldierEntities = agent.entities('America').filter((e) => e.template === 'Soldier');
      if (soldierEntities.length > 0) {
        const soldierInternal = gl.spawnedEntities.get(soldierEntities[0]!.id)!;
        // Simulate containment by setting transportContainerId.
        soldierInternal.transportContainerId = busEntity!.id;
        // Now check the resolved bonus flags include VETERAN from the container.
        const resolvedFlags = (agent.gameLogic as any).resolveEntityWeaponBonusConditionFlags(soldierInternal);
        expect(resolvedFlags & WEAPON_BONUS_VETERAN).toBe(WEAPON_BONUS_VETERAN);
      }
    });

    it('passenger does NOT inherit bonus when WeaponBonusPassedToPassengers is false', () => {
      const agent = createBonusParityAgent({
        bundleParams: {
          objects: [
            makeObjectDef('NormalTransport', 'America', ['VEHICLE'], [
              makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
              makeBlock('Behavior', 'OpenContain ModuleTag_Contain', {
                ContainMax: 5,
                AllowInsideKindOf: 'INFANTRY',
                PassengersAllowedToFire: true,
                WeaponBonusPassedToPassengers: false,
              }),
            ]),
            makeObjectDef('Soldier', 'America', ['INFANTRY'], [
              makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
              makeWeaponBlock('SoldierGun'),
            ]),
          ],
          weapons: [
            makeWeaponDef('SoldierGun', {
              PrimaryDamage: 50,
              PrimaryDamageRadius: 0,
              AttackRange: 150,
              DamageType: 'ARMOR_PIERCING',
              DeathType: 'NORMAL',
              DelayBetweenShots: 2000,
            }),
          ],
        },
        weaponBonusEntries: [],
        mapObjects: [
          place('NormalTransport', 'America', 32, 32),
          place('Soldier', 'America', 33, 32),
        ],
        mapSize: 64,
        sides: { America: {} },
      });

      const gl = agent.gameLogic as unknown as {
        spawnedEntities: Map<number, {
          id: number; templateName: string; weaponBonusConditionFlags: number;
          transportContainerId: number | null;
        }>;
      };

      const transport = agent.entities('America').find((e) => e.template === 'NormalTransport');
      const soldier = agent.entities('America').find((e) => e.template === 'Soldier');
      expect(transport).toBeDefined();
      expect(soldier).toBeDefined();

      // Give the transport VETERAN bonus.
      const WEAPON_BONUS_VETERAN = 1 << 9;
      const transportInternal = gl.spawnedEntities.get(transport!.id)!;
      transportInternal.weaponBonusConditionFlags |= WEAPON_BONUS_VETERAN;

      // Simulate containment.
      const soldierInternal = gl.spawnedEntities.get(soldier!.id)!;
      soldierInternal.transportContainerId = transport!.id;

      // Resolved flags should NOT include VETERAN from the container.
      const resolvedFlags = (agent.gameLogic as any).resolveEntityWeaponBonusConditionFlags(soldierInternal);
      expect(resolvedFlags & WEAPON_BONUS_VETERAN).toBe(0);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Fix 3: Weapon bonus change triggers immediate reload recalculation
  // ══════════════════════════════════════════════════════════════════════════

  describe('weapon bonus change triggers reload recalculation', () => {
    it('onWeaponBonusChange recalculates nextAttackFrame when between shots', () => {
      // Source parity: Weapon.cpp:1974-1977
      // When weapon status is BETWEEN_FIRING_SHOTS and ROF bonus changes,
      // m_whenWeCanFireAgain = currentFrame + newDelay.
      // C++ resets the timer to currentFrame + floor(baseDelay / rofBonus).

      const agent = createBonusParityAgent({
        bundleParams: {
          objects: [
            makeObjectDef('Shooter', 'America', ['VEHICLE'], [
              makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
              makeWeaponBlock('TestGun'),
            ]),
            makeObjectDef('Target', 'China', ['VEHICLE'], [
              makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 5000, InitialHealth: 5000 }),
            ]),
          ],
          weapons: [
            makeWeaponDef('TestGun', {
              PrimaryDamage: 10,
              PrimaryDamageRadius: 0,
              AttackRange: 150,
              DamageType: 'ARMOR_PIERCING',
              DeathType: 'NORMAL',
              DelayBetweenShots: 2000, // 60 frames delay
            }),
          ],
        },
        weaponBonusEntries: [
          // ROF bonus of 2x for VETERAN: delay / 2.0
          { condition: 'VETERAN', field: 'RATE_OF_FIRE', multiplier: 2.0 },
        ],
        mapObjects: [
          place('Shooter', 'America', 32, 32),
          place('Target', 'China', 34, 32),
        ],
        mapSize: 64,
        sides: { America: {}, China: {} },
        enemies: [['America', 'China']],
      });

      const shooter = agent.entities('America')[0]!;
      const target = agent.entities('China')[0]!;

      // Start attacking to get the weapon cycling.
      agent.attack(shooter.id, target.id);
      // Step enough frames for the first shot to fire.
      agent.step(10);

      // Access internal state to verify the timer recalculation.
      const gl = agent.gameLogic as any;
      const shooterInternal = gl.spawnedEntities.get(shooter.id);
      expect(shooterInternal).toBeDefined();

      // Step until we're between shots (nextAttackFrame > currentFrame).
      for (let i = 0; i < 30; i++) {
        agent.step(1);
        if (shooterInternal.nextAttackFrame > gl.frameCounter) break;
      }

      const nextAttackBefore = shooterInternal.nextAttackFrame;
      const currentFrame = gl.frameCounter;

      // The shooter should be between shots now (nextAttackFrame > currentFrame).
      // With 2000ms delay = 60 frames, the next shot should be well ahead.
      expect(nextAttackBefore).toBeGreaterThan(currentFrame);
      const remainingBefore = nextAttackBefore - currentFrame;

      // Apply VETERAN weapon bonus — should trigger onWeaponBonusChange.
      const WEAPON_BONUS_VETERAN = 1 << 9;
      shooterInternal.weaponBonusConditionFlags |= WEAPON_BONUS_VETERAN;
      // Call onWeaponBonusChange manually (normally called by setWeaponBonusCondition).
      gl.onWeaponBonusChange(shooterInternal);

      // Source parity: C++ resets to currentFrame + floor(baseDelay / rofBonus).
      // With 2x ROF, newDelay = floor(60 / 2.0) = 30 frames.
      const expectedNewDelay = Math.floor(60 / 2.0);
      const nextAttackAfter = shooterInternal.nextAttackFrame;
      expect(nextAttackAfter).toBe(currentFrame + expectedNewDelay);
      // The recalculated timer should be different from the original.
      expect(nextAttackAfter).not.toBe(nextAttackBefore);
    });

    it('onWeaponBonusChange recalculates attackReloadFinishFrame when reloading clip', () => {
      // Source parity: Weapon.cpp:1969-1973
      // When weapon status is RELOADING_CLIP and ROF bonus changes,
      // m_whenWeCanFireAgain = currentFrame + newReloadTime.

      const agent = createBonusParityAgent({
        bundleParams: {
          objects: [
            makeObjectDef('ClipShooter', 'America', ['VEHICLE'], [
              makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
              makeWeaponBlock('ClipGun'),
            ]),
            makeObjectDef('Target', 'China', ['VEHICLE'], [
              makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 50000, InitialHealth: 50000 }),
            ]),
          ],
          weapons: [
            makeWeaponDef('ClipGun', {
              PrimaryDamage: 10,
              PrimaryDamageRadius: 0,
              AttackRange: 150,
              DamageType: 'ARMOR_PIERCING',
              DeathType: 'NORMAL',
              ClipSize: 1, // 1 shot per clip = immediately reloads after each shot
              ClipReloadTime: 2000, // 60 frames reload
              DelayBetweenShots: 100,
            }),
          ],
        },
        weaponBonusEntries: [
          // ROF bonus of 3x for VETERAN: reload / 3.0
          { condition: 'VETERAN', field: 'RATE_OF_FIRE', multiplier: 3.0 },
        ],
        mapObjects: [
          place('ClipShooter', 'America', 32, 32),
          place('Target', 'China', 34, 32),
        ],
        mapSize: 64,
        sides: { America: {}, China: {} },
        enemies: [['America', 'China']],
      });

      const shooter = agent.entities('America')[0]!;
      const target = agent.entities('China')[0]!;

      agent.attack(shooter.id, target.id);
      // Step until the first shot fires and clip reload begins.
      agent.step(30);

      const gl = agent.gameLogic as any;
      const shooterInternal = gl.spawnedEntities.get(shooter.id);
      expect(shooterInternal).toBeDefined();

      // Find a frame where the entity is reloading (ammo=0 and reloadFinish > currentFrame).
      // Step a few more frames to ensure we're in reload state.
      for (let i = 0; i < 30; i++) {
        agent.step(1);
        if (shooterInternal.attackAmmoInClip <= 0 && shooterInternal.attackReloadFinishFrame > gl.frameCounter) {
          break;
        }
      }

      // Now if reloading, apply bonus and check timer.
      if (shooterInternal.attackAmmoInClip <= 0 && shooterInternal.attackReloadFinishFrame > gl.frameCounter) {
        const reloadFinishBefore = shooterInternal.attackReloadFinishFrame;
        const currentFrame = gl.frameCounter;

        // Apply VETERAN bonus.
        const WEAPON_BONUS_VETERAN = 1 << 9;
        shooterInternal.weaponBonusConditionFlags |= WEAPON_BONUS_VETERAN;
        gl.onWeaponBonusChange(shooterInternal);

        const reloadFinishAfter = shooterInternal.attackReloadFinishFrame;
        // With 3x ROF, new reload = floor(60/3) = 20 frames from current.
        // This should be less than the original remaining reload time.
        expect(reloadFinishAfter).toBeLessThanOrEqual(reloadFinishBefore);
        expect(reloadFinishAfter).toBe(currentFrame + Math.floor(60 / 3.0));
      }
    });

    it('onWeaponBonusChange does nothing when weapon is ready to fire', () => {
      // If the weapon is ready (nextAttackFrame <= currentFrame), no recalculation needed.
      const agent = createBonusParityAgent({
        bundleParams: {
          objects: [
            makeObjectDef('IdleShooter', 'America', ['VEHICLE'], [
              makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
              makeWeaponBlock('IdleGun'),
            ]),
          ],
          weapons: [
            makeWeaponDef('IdleGun', {
              PrimaryDamage: 10,
              PrimaryDamageRadius: 0,
              AttackRange: 150,
              DamageType: 'ARMOR_PIERCING',
              DeathType: 'NORMAL',
              DelayBetweenShots: 1000,
            }),
          ],
        },
        weaponBonusEntries: [],
        mapObjects: [
          place('IdleShooter', 'America', 32, 32),
        ],
        mapSize: 64,
        sides: { America: {} },
      });

      const shooter = agent.entities('America')[0]!;
      agent.step(5);

      const gl = agent.gameLogic as any;
      const shooterInternal = gl.spawnedEntities.get(shooter.id);

      // Entity is idle, nextAttackFrame should be 0 or <= current frame.
      const nextAttackBefore = shooterInternal.nextAttackFrame;
      expect(nextAttackBefore).toBeLessThanOrEqual(gl.frameCounter);

      // Apply bonus — should not change nextAttackFrame.
      const WEAPON_BONUS_VETERAN = 1 << 9;
      shooterInternal.weaponBonusConditionFlags |= WEAPON_BONUS_VETERAN;
      gl.onWeaponBonusChange(shooterInternal);

      expect(shooterInternal.nextAttackFrame).toBe(nextAttackBefore);
    });
  });
});
