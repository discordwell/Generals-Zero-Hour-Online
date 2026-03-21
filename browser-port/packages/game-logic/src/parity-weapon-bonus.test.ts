/**
 * Weapon Bonus Parity Tests — verify damage, radius, and ROF bonus stacking match C++ source.
 *
 * Uses a custom agent factory to inject GameData weapon bonus table entries
 * (required for VETERAN/ELITE/HEROIC bonuses). Tests verify:
 * - VETERAN damage bonus multiplier (Weapon.cpp:531-533 getPrimaryDamage)
 * - VETERAN radius bonus multiplier (Weapon.cpp:537-539 getPrimaryDamageRadius)
 * - ROF bonus stacking with continuous-fire and veterancy (Weapon.cpp:499-513 getDelayBetweenShots)
 *
 * Source parity references:
 *   Weapon.cpp — WeaponTemplate::getPrimaryDamage, getPrimaryDamageRadius, getDelayBetweenShots
 *   Weapon.cpp — WeaponBonus::appendBonuses (additive accumulation)
 *   Weapon.cpp — Weapon::computeBonus (combines global + per-weapon bonus tables)
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

/**
 * Creates a ParityAgent with GameData weapon bonus entries injected into the registry.
 * Standard createParityAgent cannot pass gameData because its makeBundle call strips it.
 */
function createBonusParityAgent(config: {
  bundleParams: Parameters<typeof makeBundle>[0];
  weaponBonusEntries: WeaponBonusEntry[];
  mapObjects?: MapObjectJSON[];
  mapSize?: number;
  sides: Record<string, { credits?: number; playerType?: string }>;
  enemies?: [string, string][];
}): ParityAgent {
  // Build bundle with gameData attached
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

  // Set up player sides
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

  // Set up enemy relationships
  if (config.enemies) {
    for (const [a, b] of config.enemies) {
      logic.setTeamRelationship(a, b, 0);
      logic.setTeamRelationship(b, a, 0);
    }
  }

  // ── Internal helpers (same as parity-agent.ts) ──────────────────────────

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

describe('parity weapon bonus', () => {
  // ── Test 1: Weapon Damage Bonus from Veterancy ─────────────────────────

  describe('weapon damage bonus from veterancy', () => {
    it('VETERAN damage bonus multiplies per-shot damage by the configured DAMAGE bonus', () => {
      // C++ source parity: Weapon.cpp:531-533
      //   getPrimaryDamage(bonus) returns m_primaryDamage * bonus.getField(WeaponBonus::DAMAGE)
      // Global bonus table: VETERAN DAMAGE 120% → multiplier 1.2
      const veteranDamageMultiplier = 1.2;

      const objectDefs = [
        makeObjectDef('Attacker', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          makeWeaponBlock('TestGun'),
        ], { ExperienceRequired: [0, 10, 50, 100], ExperienceValue: [1, 2, 3, 4] }),
        makeObjectDef('Target', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 2000, InitialHealth: 2000 }),
        ]),
      ];
      const weaponDefs = [
        makeWeaponDef('TestGun', {
          PrimaryDamage: 100,
          DamageType: 'ARMOR_PIERCING',
          AttackRange: 120,
          DelayBetweenShots: 500, // Large delay to isolate single shots
        }),
      ];
      const bonusEntries: WeaponBonusEntry[] = [
        { condition: 'VETERAN', field: 'DAMAGE', multiplier: veteranDamageMultiplier },
      ];

      // Create a REGULAR attacker (no bonus)
      const regularAgent = createBonusParityAgent({
        bundleParams: { objects: objectDefs, weapons: weaponDefs },
        weaponBonusEntries: bonusEntries,
        mapObjects: [place('Attacker', 10, 10), place('Target', 30, 10)],
        mapSize: 8,
        sides: { America: {}, China: {} },
        enemies: [['America', 'China']],
      });

      regularAgent.attack(1, 2);
      const regularBefore = regularAgent.snapshot();
      regularAgent.step(10);
      const regularDiff = regularAgent.diff(regularBefore);

      const regularDamage = regularDiff.damaged.find((e) => e.id === 2);
      expect(regularDamage).toBeDefined();
      const regularActual = regularDamage!.hpBefore - regularDamage!.hpAfter;

      // Create a VETERAN attacker (using objectVeterancy map property)
      const veteranAgent = createBonusParityAgent({
        bundleParams: { objects: objectDefs, weapons: weaponDefs },
        weaponBonusEntries: bonusEntries,
        mapObjects: [
          place('Attacker', 10, 10, { objectVeterancy: '1' }),
          place('Target', 30, 10),
        ],
        mapSize: 8,
        sides: { America: {}, China: {} },
        enemies: [['America', 'China']],
      });

      // Verify attacker is actually at VETERAN level
      const attackerEntity = veteranAgent.entity(1);
      expect(attackerEntity).not.toBeNull();
      expect(attackerEntity!.veterancy).toBe(1); // LEVEL_VETERAN

      veteranAgent.attack(1, 2);
      const veteranBefore = veteranAgent.snapshot();
      veteranAgent.step(10);
      const veteranDiff = veteranAgent.diff(veteranBefore);

      const veteranDamageResult = veteranDiff.damaged.find((e) => e.id === 2);
      expect(veteranDamageResult).toBeDefined();
      const veteranActual = veteranDamageResult!.hpBefore - veteranDamageResult!.hpAfter;

      // REGULAR should deal base damage (100 per hit)
      expect(regularActual).toBeGreaterThanOrEqual(100);
      expect(regularActual % 100).toBe(0);

      // VETERAN should deal 120 per hit (100 * 1.2)
      // Source parity: Weapon.cpp:533 — m_primaryDamage * bonus.getField(DAMAGE)
      expect(veteranActual).toBeGreaterThanOrEqual(120);
      expect(veteranActual % 120).toBe(0);

      // VETERAN damage per shot should be exactly veteranDamageMultiplier times REGULAR per shot
      const shotsRegular = regularActual / 100;
      const shotsVeteran = veteranActual / 120;
      // Both ran for same number of frames — should fire same number of shots
      expect(shotsRegular).toBe(shotsVeteran);
    });
  });

  // ── Test 2: Weapon Radius Bonus from Veterancy ─────────────────────────

  describe('weapon radius bonus from veterancy', () => {
    it('VETERAN radius bonus expands splash damage area', () => {
      // C++ source parity: Weapon.cpp:537-539
      //   getPrimaryDamageRadius(bonus) returns m_primaryDamageRadius * bonus.getField(RADIUS)
      //
      // Strategy: Place a target at distance 55 from impact point.
      // With PrimaryDamageRadius=50, it should NOT be hit (no vet bonus).
      // With PrimaryDamageRadius=50 and VETERAN RADIUS 120% → effective radius 60,
      // the target at distance 55 SHOULD be hit.
      //
      // TS file: combat-targeting.ts queueWeaponDamageEvent applies radius bonus at fire time.

      const objectDefs = [
        makeObjectDef('Attacker', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          makeWeaponBlock('SplashGun'),
        ], { ExperienceRequired: [0, 10, 50, 100], ExperienceValue: [1, 2, 3, 4] }),
        makeObjectDef('PrimaryTarget', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
        ]),
        makeObjectDef('SplashVictim', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
        ]),
      ];
      const weaponDefs = [
        makeWeaponDef('SplashGun', {
          PrimaryDamage: 50,
          DamageType: 'EXPLOSION',
          AttackRange: 200,
          PrimaryDamageRadius: 50,
          DelayBetweenShots: 500,
        }),
      ];
      const bonusEntries: WeaponBonusEntry[] = [
        { condition: 'VETERAN', field: 'RADIUS', multiplier: 1.2 },
      ];

      // ── WITHOUT vet bonus (REGULAR) ──
      // Attacker at (10,10), PrimaryTarget at (30,10), SplashVictim at (85,10)
      // Distance from PrimaryTarget (30,10) to SplashVictim (85,10) = 55 units
      const regularAgent = createBonusParityAgent({
        bundleParams: { objects: objectDefs, weapons: weaponDefs },
        weaponBonusEntries: bonusEntries,
        mapObjects: [
          place('Attacker', 10, 10),
          place('PrimaryTarget', 30, 10),
          place('SplashVictim', 85, 10),
        ],
        mapSize: 16,
        sides: { America: {}, China: {} },
        enemies: [['America', 'China']],
      });

      regularAgent.attack(1, 2);
      const regularBefore = regularAgent.snapshot();
      regularAgent.step(10);
      const regularDiff = regularAgent.diff(regularBefore);

      // Primary target (id=2) should take damage
      const regularPrimaryDmg = regularDiff.damaged.find((e) => e.id === 2);
      expect(regularPrimaryDmg).toBeDefined();

      // SplashVictim (id=3) at distance 55 from primary target — should NOT be hit
      // because PrimaryDamageRadius is only 50
      const regularSplashDmg = regularDiff.damaged.find((e) => e.id === 3);
      const regularSplashVictimDamaged = regularSplashDmg !== undefined
        ? (regularSplashDmg.hpBefore - regularSplashDmg.hpAfter) > 0
        : false;

      // ── WITH vet bonus (VETERAN) ──
      const veteranAgent = createBonusParityAgent({
        bundleParams: { objects: objectDefs, weapons: weaponDefs },
        weaponBonusEntries: bonusEntries,
        mapObjects: [
          place('Attacker', 10, 10, { objectVeterancy: '1' }),
          place('PrimaryTarget', 30, 10),
          place('SplashVictim', 85, 10),
        ],
        mapSize: 16,
        sides: { America: {}, China: {} },
        enemies: [['America', 'China']],
      });

      expect(veteranAgent.entity(1)!.veterancy).toBe(1);

      veteranAgent.attack(1, 2);
      const veteranBefore = veteranAgent.snapshot();
      veteranAgent.step(10);
      const veteranDiff = veteranAgent.diff(veteranBefore);

      // Primary target should still be hit
      const veteranPrimaryDmg = veteranDiff.damaged.find((e) => e.id === 2);
      expect(veteranPrimaryDmg).toBeDefined();

      // With VETERAN RADIUS 120%, effective radius = 50 * 1.2 = 60.
      // SplashVictim at distance 55 from primary target should NOW be hit.
      // Source parity: combat-targeting.ts queueWeaponDamageEvent applies radiusBonus
      // to weapon profile before queueing the event.
      const veteranSplashDmg = veteranDiff.damaged.find((e) => e.id === 3);
      const veteranSplashVictimDamaged = veteranSplashDmg !== undefined
        ? (veteranSplashDmg.hpBefore - veteranSplashDmg.hpAfter) > 0
        : false;

      // The vet bonus should expand the splash radius enough to hit the distant target
      // REGULAR: radius=50, distance=55 → NOT hit
      // VETERAN: radius=60, distance=55 → HIT
      expect(regularSplashVictimDamaged).toBe(false);
      expect(veteranSplashVictimDamaged).toBe(true);
    });
  });

  // ── Test 3: Rate of Fire Bonus Stacking ────────────────────────────────

  describe('rate of fire bonus stacking', () => {
    it('VETERAN ROF bonus reduces delay between shots', () => {
      // C++ source parity: Weapon.cpp:499-513
      //   getDelayBetweenShots(bonus) divides delay by bonus.getField(WeaponBonus::RATE_OF_FIRE)
      //
      // TS source: weapon-profiles.ts:340-351
      //   resolveWeaponDelayFramesWithBonus combines ROF bonuses.
      //
      // Bonus accumulation (both C++ and TS):
      //   C++ WeaponBonus::appendBonuses: result += bonus - 1.0 (additive)
      //   TS computeWeaponBonusField: result += multiplier - 1.0 (additive)
      //
      // With VETERAN RATE_OF_FIRE 150% (1.5x):
      //   DelayBetweenShots = 300ms → 9 frames at 30 FPS
      //   Bonused delay = floor(9 / 1.5) = 6 frames
      //
      // Without bonus: delay = 9 frames
      // With VETERAN ROF 1.5x: delay = 6 frames

      const baseDelayMs = 300; // 9 frames at 30 FPS
      const rofBonus = 1.5;

      const objectDefs = [
        makeObjectDef('Attacker', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          makeWeaponBlock('ROFGun'),
        ], { ExperienceRequired: [0, 10, 50, 100], ExperienceValue: [1, 2, 3, 4] }),
        makeObjectDef('Target', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 5000, InitialHealth: 5000 }),
        ]),
      ];
      const weaponDefs = [
        makeWeaponDef('ROFGun', {
          PrimaryDamage: 10,
          DamageType: 'ARMOR_PIERCING',
          AttackRange: 120,
          DelayBetweenShots: baseDelayMs,
        }),
      ];
      const bonusEntries: WeaponBonusEntry[] = [
        { condition: 'VETERAN', field: 'RATE_OF_FIRE', multiplier: rofBonus },
      ];

      // REGULAR attacker (no ROF bonus)
      const regularAgent = createBonusParityAgent({
        bundleParams: { objects: objectDefs, weapons: weaponDefs },
        weaponBonusEntries: bonusEntries,
        mapObjects: [place('Attacker', 10, 10), place('Target', 30, 10)],
        mapSize: 8,
        sides: { America: {}, China: {} },
        enemies: [['America', 'China']],
      });

      regularAgent.attack(1, 2);
      const regularTimeline: number[] = [];
      for (let i = 0; i < 40; i++) {
        regularAgent.step(1);
        regularTimeline.push(regularAgent.entity(2)?.health ?? -1);
      }

      const regularDamageFrames = regularTimeline
        .map((h, i) => i > 0 && h < regularTimeline[i - 1]! ? i : -1)
        .filter((f) => f >= 0);

      // VETERAN attacker (ROF bonus)
      const veteranAgent = createBonusParityAgent({
        bundleParams: { objects: objectDefs, weapons: weaponDefs },
        weaponBonusEntries: bonusEntries,
        mapObjects: [
          place('Attacker', 10, 10, { objectVeterancy: '1' }),
          place('Target', 30, 10),
        ],
        mapSize: 8,
        sides: { America: {}, China: {} },
        enemies: [['America', 'China']],
      });

      expect(veteranAgent.entity(1)!.veterancy).toBe(1);

      veteranAgent.attack(1, 2);
      const veteranTimeline: number[] = [];
      for (let i = 0; i < 40; i++) {
        veteranAgent.step(1);
        veteranTimeline.push(veteranAgent.entity(2)?.health ?? -1);
      }

      const veteranDamageFrames = veteranTimeline
        .map((h, i) => i > 0 && h < veteranTimeline[i - 1]! ? i : -1)
        .filter((f) => f >= 0);

      // Both should fire multiple shots
      expect(regularDamageFrames.length).toBeGreaterThanOrEqual(3);
      expect(veteranDamageFrames.length).toBeGreaterThanOrEqual(3);

      // Measure average delay between shots
      function averageGap(frames: number[]): number {
        let totalGap = 0;
        let gapCount = 0;
        for (let i = 1; i < frames.length; i++) {
          totalGap += frames[i]! - frames[i - 1]!;
          gapCount++;
        }
        return gapCount > 0 ? totalGap / gapCount : 0;
      }

      const regularAvgGap = averageGap(regularDamageFrames);
      const veteranAvgGap = averageGap(veteranDamageFrames);

      // VETERAN should fire faster (shorter delay between shots)
      // Source parity: C++ delay = floor(baseDelay / rofBonus)
      // 300ms = 9 frames; 9/1.5 = 6 frames for VETERAN
      expect(veteranAvgGap).toBeLessThan(regularAvgGap);

      // Total shots fired in 40 frames: VETERAN should fire more shots
      expect(veteranDamageFrames.length).toBeGreaterThan(regularDamageFrames.length);

      // Document the actual formula used
      // C++: delay = floor(baseDelayFrames / globalRofBonus) = floor(9 / 1.5) = 6
      // TS: totalRofBonus = continuousFireBonus + (globalRofBonus - 1.0)
      //     = 1.0 + (1.5 - 1.0) = 1.5, delay = floor(9 / 1.5) = 6
      // Both formulas produce the same result when no continuous fire bonus is active.
      const expectedRegularDelay = 9; // 300ms / 33.33ms ≈ 9 frames
      const expectedVeteranDelay = Math.floor(9 / rofBonus); // 6 frames
      expect(regularAvgGap).toBeGreaterThanOrEqual(expectedRegularDelay - 1);
      expect(regularAvgGap).toBeLessThanOrEqual(expectedRegularDelay + 1);
      expect(veteranAvgGap).toBeGreaterThanOrEqual(expectedVeteranDelay - 1);
      expect(veteranAvgGap).toBeLessThanOrEqual(expectedVeteranDelay + 1);
    });

    it('ROF bonus stacking: continuous fire + veteran bonuses accumulate additively', () => {
      // C++ source parity: WeaponBonus::appendBonuses — additive accumulation.
      //   Both per-weapon continuous-fire bonus and global VETERAN bonus feed through
      //   appendBonuses: result += bonus - 1.0 for each condition.
      //
      // TS source: weapon-profiles.ts:346
      //   totalRofBonus = continuousFireBonus + (globalRofBonus - 1.0)
      //
      // With VETERAN RATE_OF_FIRE 120% (1.2x) and per-weapon ContinuousFireOne RATE_OF_FIRE 200% (2.0x):
      //   C++: accumulated ROF = 1.0 + (1.2 - 1.0) + (2.0 - 1.0) = 2.2
      //        delay = floor(baseDelay / 2.2)
      //   TS:  totalRofBonus = 2.0 + (1.2 - 1.0) = 2.2
      //        delay = floor(baseDelay / 2.2)
      //   Both produce identical results.
      //
      // Test: create a weapon with ContinuousFireOne=1 (triggers after 1 shot),
      // VETERAN ROF 120%. After continuous fire kicks in, measure combined fire rate.

      const baseDelayMs = 660; // 660ms ≈ 20 frames at 30 FPS
      const vetRofBonus = 1.2;
      const continuousFireRof = 2.0;

      const agent = createBonusParityAgent({
        bundleParams: {
          objects: [
            makeObjectDef('Attacker', 'America', ['VEHICLE'], [
              makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
              makeWeaponBlock('CFGun'),
            ], { ExperienceRequired: [0, 10, 50, 100], ExperienceValue: [1, 2, 3, 4] }),
            makeObjectDef('Target', 'China', ['VEHICLE'], [
              makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 10000, InitialHealth: 10000 }),
            ]),
          ],
          weapons: [
            makeWeaponDef('CFGun', {
              PrimaryDamage: 10,
              DamageType: 'ARMOR_PIERCING',
              AttackRange: 120,
              DelayBetweenShots: baseDelayMs,
              ContinuousFireOne: 1,    // Activate MEAN after 1 consecutive shot
              ContinuousFireTwo: 999,  // Never transition to FAST (stay in MEAN)
              ContinuousFireCoast: 0,  // No coast period
              // Per-weapon continuous fire ROF bonus
              WeaponBonus: `CONTINUOUS_FIRE_MEAN RATE_OF_FIRE ${continuousFireRof * 100}%`,
            }),
          ],
        },
        weaponBonusEntries: [
          { condition: 'VETERAN', field: 'RATE_OF_FIRE', multiplier: vetRofBonus },
        ],
        mapObjects: [
          place('Attacker', 10, 10, { objectVeterancy: '1' }),
          place('Target', 30, 10),
        ],
        mapSize: 8,
        sides: { America: {}, China: {} },
        enemies: [['America', 'China']],
      });

      expect(agent.entity(1)!.veterancy).toBe(1);

      agent.attack(1, 2);
      const timeline: number[] = [];
      for (let i = 0; i < 80; i++) {
        agent.step(1);
        timeline.push(agent.entity(2)?.health ?? -1);
      }

      const damageFrames = timeline
        .map((h, i) => i > 0 && h < timeline[i - 1]! ? i : -1)
        .filter((f) => f >= 0);

      // Should fire enough shots for continuous fire to activate
      expect(damageFrames.length).toBeGreaterThanOrEqual(3);

      // The first shot fires without continuous fire bonus.
      // After ContinuousFireOne (1 shot), continuous fire activates -> MEAN state.
      // Combined ROF: veteran 1.2 + continuous fire mean 2.0 -> accumulated = 2.2
      // Expected delay after activation: floor(20 / 2.2) = 9 frames
      //
      // The base delay of 20 frames should only apply to the first gap.
      // After continuous fire kicks in, gaps should be shorter.
      if (damageFrames.length >= 4) {
        // Measure later gaps (after continuous fire has activated)
        const laterGaps: number[] = [];
        for (let i = 2; i < damageFrames.length; i++) {
          laterGaps.push(damageFrames[i]! - damageFrames[i - 1]!);
        }
        const avgLaterGap = laterGaps.reduce((a, b) => a + b, 0) / laterGaps.length;

        // With combined 2.2x ROF bonus, delay should be floor(20/2.2) = 9 frames
        // Without any bonus, delay would be 20 frames
        const expectedCombinedDelay = Math.floor(20 / (continuousFireRof + (vetRofBonus - 1.0)));
        expect(avgLaterGap).toBeLessThan(20); // Definitely faster than base
        // Allow tolerance for frame quantization
        expect(avgLaterGap).toBeGreaterThanOrEqual(expectedCombinedDelay - 2);
        expect(avgLaterGap).toBeLessThanOrEqual(expectedCombinedDelay + 3);
      }

      // Document the formula used:
      // Both C++ and TS use additive accumulation for ROF bonuses:
      //   C++: bonus.m_field[ROF] = 1.0 + (vet-1.0) + (cf-1.0) = 1.0 + 0.2 + 1.0 = 2.2
      //   TS:  totalRofBonus = cfBonus + (globalRof - 1.0) = 2.0 + 0.2 = 2.2
      //   delay = floor(baseDelay / totalBonus)
      // This is ADDITIVE accumulation, not multiplicative.
    });
  });
});
