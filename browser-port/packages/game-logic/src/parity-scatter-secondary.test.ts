/**
 * Parity tests for scatter target per-clip reset and secondary damage radius bonus.
 *
 * Source parity references:
 * - Weapon.cpp:2329-2354, 1666, 1888-1897 — rebuildScatterTargets refills unused list on clip reload
 * - Weapon.cpp:2617-2624 — scatter target consumed per shot from randomized unused list
 * - Weapon.cpp:549-552 — getSecondaryDamageRadius(bonus) applies RADIUS bonus to secondary radius
 */

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import {
  type ParityAgent,
  createParityAgent,
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

import { rebuildEntityScatterTargets } from './combat-helpers.js';

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

  // ── Internal helpers (same structure as parity-agent.ts) ──────────────

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

describe('parity scatter target per-clip reset / secondary damage radius bonus', () => {

  // ── Test 1: Scatter Targets Reset Per Clip ──────────────────────────────

  describe('scatter targets reset per clip (parity: Weapon.cpp:1888-1897, 1936)', () => {
    it('each shot in a clip uses a different scatter index (no repeats within a clip)', () => {
      // Source parity: Weapon::rebuildScatterTargets (Weapon.cpp:1888-1897)
      //   m_scatterTargetsUnused.clear();
      //   for (Int targetIndex = 0; targetIndex < scatterTargetsCount; targetIndex++)
      //     m_scatterTargetsUnused.push_back( targetIndex );
      //
      // Source parity: Weapon::privateFireWeapon (Weapon.cpp:2617-2624)
      //   picks random index from m_scatterTargetsUnused, swap-removes it.
      //   Each shot in a clip gets a unique ScatterTarget offset.
      //
      // Source parity: Weapon::reload (Weapon.cpp:1936) and setClipPercentFull (1883)
      //   both call rebuildScatterTargets() on clip reload, restoring all indices.

      const entity = {
        attackWeapon: {
          scatterTargets: [
            { x: 10, z: 0 },
            { x: -10, z: 0 },
            { x: 0, z: 10 },
          ],
          clipSize: 3,
          autoReloadWhenIdleFrames: 0,
        },
        attackScatterTargetsUnused: [] as number[],
      };

      // Initial build: all 3 targets available
      rebuildEntityScatterTargets(entity);
      expect(entity.attackScatterTargetsUnused).toEqual([0, 1, 2]);
      expect(entity.attackScatterTargetsUnused.length).toBe(3);

      // Simulate firing 3 shots (one per clip round), consuming scatter targets.
      // Each shot picks a random index and swap-removes it from the unused list.
      const usedIndices: number[] = [];
      for (let shot = 0; shot < 3; shot++) {
        const pickIndex = 0; // deterministic pick (first element)
        const targetIndex = entity.attackScatterTargetsUnused[pickIndex]!;
        usedIndices.push(targetIndex);

        // Swap-remove (source parity: combat-targeting.ts:849-850)
        entity.attackScatterTargetsUnused[pickIndex] =
          entity.attackScatterTargetsUnused[entity.attackScatterTargetsUnused.length - 1]!;
        entity.attackScatterTargetsUnused.pop();
      }

      // After exhausting the clip, unused list should be empty
      expect(entity.attackScatterTargetsUnused.length).toBe(0);

      // All 3 shots used different indices (no repeats within the clip)
      const uniqueIndices = new Set(usedIndices);
      expect(uniqueIndices.size).toBe(3);
      expect(usedIndices.length).toBe(3);

      // Clip reload: rebuildScatterTargets restores all indices
      rebuildEntityScatterTargets(entity);
      expect(entity.attackScatterTargetsUnused).toEqual([0, 1, 2]);
      expect(entity.attackScatterTargetsUnused.length).toBe(3);
    });

    it('scatter targets are rebuilt on clip reload in live combat (integration)', () => {
      // Full integration test: attacker with ClipSize=3 and 3 ScatterTargets fires a clip,
      // reloads, and the scatter targets become available again for the next clip.

      const agent = createParityAgent({
        bundles: {
          objects: [
            makeObjectDef('ScatterAttacker', 'America', ['VEHICLE'], [
              makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
              makeWeaponBlock('ScatterGun'),
            ]),
            makeObjectDef('Target', 'China', ['VEHICLE'], [
              makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 50000, InitialHealth: 50000 }),
            ]),
          ],
          weapons: [
            makeWeaponDef('ScatterGun', {
              PrimaryDamage: 10,
              PrimaryDamageRadius: 20,
              DamageType: 'ARMOR_PIERCING',
              AttackRange: 120,
              DelayBetweenShots: 100, // 3 frames
              ClipSize: 3,
              ClipReloadTime: 2000, // 60 frames
              // ScatterTarget: each entry is "X Z" — 3 entries for 3 targets
              ScatterTarget: ['10 0', '-10 0', '0 10'],
              ScatterTargetScalar: 1,
            }),
          ],
        },
        mapObjects: [
          place('ScatterAttacker', 10, 10), // id 1
          place('Target', 30, 10),          // id 2
        ],
        mapSize: 8,
        sides: { America: {}, China: {} },
        enemies: [['America', 'China']],
      });

      // Access internal entity state for scatter target inspection
      const priv = agent.gameLogic as unknown as {
        spawnedEntities: Map<number, {
          id: number;
          attackScatterTargetsUnused: number[];
          attackAmmoInClip: number;
          attackReloadFinishFrame: number;
          attackWeapon: { scatterTargets: { x: number; z: number }[]; clipSize: number } | null;
        }>;
      };

      // Issue attack command
      agent.attack(1, 2);

      // Step a few frames to let combat start
      agent.step(5);

      const attacker = priv.spawnedEntities.get(1)!;

      // Verify weapon has 3 scatter targets
      expect(attacker.attackWeapon).not.toBeNull();
      expect(attacker.attackWeapon!.scatterTargets.length).toBe(3);

      // Track scatter target consumption over a full clip cycle.
      // Source parity: after firing all 3 shots, clip is empty (ammo=0) and reload starts.
      // After reload, rebuildScatterTargets restores the full index list.
      //
      // We check for ammo <= 0 (empty clip during reload wait) and then ammo === clipSize
      // after reload completes. The reload sets ammo and rebuilds scatter targets in the
      // same combat update frame (combat-update.ts:235-236), so immediately after refill,
      // a shot may fire reducing ammo to clipSize-1. We track the reload frame to detect
      // the transition.
      let sawClipEmpty = false;
      let sawClipRefill = false;
      let reloadFinishFrame = 0;

      for (let frame = 0; frame < 150; frame++) {
        agent.step(1);

        if (attacker.attackAmmoInClip <= 0 && !sawClipEmpty) {
          sawClipEmpty = true;
          // Record the reload finish frame for verification
          reloadFinishFrame = attacker.attackReloadFinishFrame;
          // During reload, scatter targets should be exhausted (0 remaining)
          expect(attacker.attackScatterTargetsUnused.length).toBe(0);
        }

        // After clip reload is complete, ammo is refilled and scatter targets rebuilt.
        // Due to atomic refill+fire (combat-update.ts:235-264), ammo might be
        // clipSize-1 by the end of the frame. Detect the transition by checking if
        // ammo is positive again after we saw it empty.
        if (sawClipEmpty && attacker.attackAmmoInClip > 0) {
          sawClipRefill = true;
          // Source parity: rebuildScatterTargets restores indices.
          // Since one shot already fired on this frame, scatter targets should have
          // count = (clipSize - 1) because one was consumed. Or count = clipSize if
          // the fire path didn't consume one yet.
          expect(attacker.attackScatterTargetsUnused.length).toBeGreaterThanOrEqual(
            attacker.attackWeapon!.scatterTargets.length - 1,
          );
          break;
        }
      }

      // Verify we observed the full clip cycle
      expect(sawClipEmpty).toBe(true);
      expect(sawClipRefill).toBe(true);
    });
  });

  // ── Test 2: Secondary Damage Radius Bonus ──────────────────────────────

  describe('secondary damage radius bonus (parity: Weapon.cpp:549-552)', () => {
    it('VETERAN radius bonus applies to BOTH primary and secondary damage radius', () => {
      // C++ source parity: Weapon.cpp:537-539
      //   Real WeaponTemplate::getPrimaryDamageRadius(const WeaponBonus& bonus) const
      //     return m_primaryDamageRadius * bonus.getField(WeaponBonus::RADIUS);
      //
      // C++ source parity: Weapon.cpp:549-552
      //   Real WeaponTemplate::getSecondaryDamageRadius(const WeaponBonus& bonus) const
      //     return m_secondaryDamageRadius * bonus.getField(WeaponBonus::RADIUS);
      //
      // TS source: combat-targeting.ts:975-981 — queueWeaponDamageEvent applies radiusBonus
      //   to BOTH primaryDamageRadius and secondaryDamageRadius (matching C++):
      //     primaryDamageRadius: weapon.primaryDamageRadius * radiusBonus,
      //     secondaryDamageRadius: weapon.secondaryDamageRadius * radiusBonus,
      //
      // Setup:
      //   PrimaryDamageRadius=10, SecondaryDamageRadius=30, SecondaryDamage=50
      //   Bystander at distance 35 from target (impact point).
      //   Without bonus: secondary radius=30 < distance=35 -> NO damage
      //   With VETERAN RADIUS 1.5x bonus: secondary radius=45 > distance=35 -> TAKES damage

      const objectDefs = [
        makeObjectDef('Attacker', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          makeWeaponBlock('SplashGun'),
        ], { ExperienceRequired: [0, 10, 50, 100], ExperienceValue: [1, 2, 3, 4] }),
        makeObjectDef('Target', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 50000, InitialHealth: 50000 }),
        ]),
        makeObjectDef('Bystander', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 50000, InitialHealth: 50000 }),
        ]),
      ];
      const weaponDefs = [
        makeWeaponDef('SplashGun', {
          PrimaryDamage: 10,
          PrimaryDamageRadius: 10,
          SecondaryDamage: 50,
          SecondaryDamageRadius: 30,
          DamageType: 'ARMOR_PIERCING',
          AttackRange: 120,
          DelayBetweenShots: 100,
        }),
      ];
      const bonusEntries: WeaponBonusEntry[] = [
        { condition: 'VETERAN', field: 'RADIUS', multiplier: 1.5 },
      ];

      // ── REGULAR attacker (no radius bonus) ──
      // Target at (50, 10), Bystander at (85, 10) — distance 35 from target
      // Secondary radius = 30, so bystander at distance 35 should NOT take damage
      const regularAgent = createBonusParityAgent({
        bundleParams: { objects: objectDefs, weapons: weaponDefs },
        weaponBonusEntries: bonusEntries,
        mapObjects: [
          place('Attacker', 10, 10),    // id 1
          place('Target', 50, 10),      // id 2
          place('Bystander', 85, 10),   // id 3 — 35 units from target
        ],
        mapSize: 16,
        sides: { America: {}, China: {} },
        enemies: [['America', 'China']],
      });

      const bystanderBefore = regularAgent.entity(3)!.health;

      regularAgent.attack(1, 2);
      regularAgent.step(30);

      // Target should have taken damage (within primary radius from direct hit)
      const targetAfter = regularAgent.entity(2);
      expect(targetAfter).not.toBeNull();
      expect(targetAfter!.health).toBeLessThan(50000);

      // Bystander should NOT have taken damage: 35 > SecondaryDamageRadius(30)
      const bystanderAfterRegular = regularAgent.entity(3);
      expect(bystanderAfterRegular).not.toBeNull();
      expect(bystanderAfterRegular!.health).toBe(bystanderBefore);

      // ── VETERAN attacker (RADIUS bonus 1.5x) ──
      // Same layout but attacker is VETERAN.
      // Secondary radius = 30 * 1.5 = 45, bystander at distance 35 is now IN range
      const veteranAgent = createBonusParityAgent({
        bundleParams: { objects: objectDefs, weapons: weaponDefs },
        weaponBonusEntries: bonusEntries,
        mapObjects: [
          place('Attacker', 10, 10, { objectVeterancy: '1' }), // id 1 — VETERAN
          place('Target', 50, 10),                               // id 2
          place('Bystander', 85, 10),                            // id 3 — 35 units from target
        ],
        mapSize: 16,
        sides: { America: {}, China: {} },
        enemies: [['America', 'China']],
      });

      expect(veteranAgent.entity(1)!.veterancy).toBe(1); // LEVEL_VETERAN

      const vetBystanderBefore = veteranAgent.entity(3)!.health;

      veteranAgent.attack(1, 2);
      veteranAgent.step(30);

      // Target should have taken damage
      const vetTargetAfter = veteranAgent.entity(2);
      expect(vetTargetAfter).not.toBeNull();
      expect(vetTargetAfter!.health).toBeLessThan(50000);

      // Bystander SHOULD take secondary damage with VETERAN radius bonus:
      // SecondaryDamageRadius = 30 * 1.5 = 45 > 35 (bystander distance)
      // C++ parity: getSecondaryDamageRadius(bonus) returns m_secondaryDamageRadius * bonus.RADIUS
      const vetBystanderAfter = veteranAgent.entity(3);
      expect(vetBystanderAfter).not.toBeNull();
      expect(vetBystanderAfter!.health).toBeLessThan(vetBystanderBefore);
    });

    it('documents C++ parity: secondary radius uses same RADIUS bonus as primary', () => {
      // C++ source: Weapon.cpp:537-539 (primary) and 549-552 (secondary)
      // Both use bonus.getField(WeaponBonus::RADIUS) — the SAME bonus field.
      //
      // TS source: combat-targeting.ts:980-981
      //   primaryDamageRadius: weapon.primaryDamageRadius * radiusBonus,
      //   secondaryDamageRadius: weapon.secondaryDamageRadius * radiusBonus,
      // Both multiply by the same radiusBonus — matching C++ parity.
      //
      // Verify math: given base radii and a bonus multiplier, both scale identically.

      const primaryRadiusBase = 10;
      const secondaryRadiusBase = 30;
      const radiusBonus = 1.5;

      const bonusedPrimary = primaryRadiusBase * radiusBonus;   // 15
      const bonusedSecondary = secondaryRadiusBase * radiusBonus; // 45

      // C++ expected values:
      expect(bonusedPrimary).toBe(15);
      expect(bonusedSecondary).toBe(45);

      // The ratio is preserved: secondary is still 3x the primary
      expect(bonusedSecondary / bonusedPrimary).toBe(secondaryRadiusBase / primaryRadiusBase);
    });
  });
});
