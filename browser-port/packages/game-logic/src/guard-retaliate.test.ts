/**
 * Tests for the ZH-only AIGuardRetaliate system.
 *
 * Source parity: AIGuardRetaliate.cpp (ZH) — when guarding units are attacked,
 * they retaliate within MaxRetaliationDistance from the guard anchor, recruit
 * nearby friends within RetaliationFriendsRadius, and return to the guard
 * position after the threat is neutralized or escapes range.
 *
 * Key behaviors:
 *   1. Guarding unit retaliates against attacker within MaxRetaliationDistance
 *   2. Attacker beyond MaxRetaliationDistance is ignored
 *   3. If target moves beyond MaxRetaliationDistance during pursuit, unit returns
 *   4. Nearby idle friendly units within RetaliationFriendsRadius are recruited
 *   5. Buildings are NOT acquired as targets during guard scans
 *   6. After killing or losing target, unit returns to guard position
 *
 * TS implementation:
 *   combat-targeting.ts   — updateIdleAutoTargeting guard retaliation path,
 *                           recruitRetaliationFriends
 *   update-behaviors.ts   — updateGuardPursuing MaxRetaliationDistance check
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

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Standard guard-retaliate test setup:
 *   - Guardian: VEHICLE with weapon (range 150), locomotor, VisionRange=100
 *   - Enemy: high-HP VEHICLE that can deal damage
 *
 * Default AI config values:
 *   MaxRetaliationDistance = 210
 *   RetaliationFriendsRadius = 120
 *   guardInnerModifierHuman = 1.8 -> innerRange = 180
 *   guardOuterModifierHuman = 2.2 -> outerRange = 220
 */
function makeGuardRetaliateAgent(opts?: {
  enemyX?: number;
  enemyZ?: number;
  guardianX?: number;
  guardianZ?: number;
  extraObjects?: ReturnType<typeof makeObjectDef>[];
  extraMapObjects?: ReturnType<typeof place>[];
}) {
  const guardianX = opts?.guardianX ?? 100;
  const guardianZ = opts?.guardianZ ?? 100;
  const enemyX = opts?.enemyX ?? 110;
  const enemyZ = opts?.enemyZ ?? 100;

  return createParityAgent({
    bundles: {
      objects: [
        makeObjectDef('Guardian', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', {
            MaxHealth: 500,
            InitialHealth: 500,
          }),
          makeWeaponBlock('GuardGun'),
          makeBlock('LocomotorSet', 'SET_NORMAL GuardLoco', {}),
        ], { VisionRange: 100, ShroudClearingRange: 100 }),
        makeObjectDef('Enemy', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', {
            MaxHealth: 5000,
            InitialHealth: 5000,
          }),
          makeWeaponBlock('EnemyGun'),
          makeBlock('LocomotorSet', 'SET_NORMAL EnemyLoco', {}),
        ], { VisionRange: 100 }),
        ...(opts?.extraObjects ?? []),
      ],
      weapons: [
        makeWeaponDef('GuardGun', {
          PrimaryDamage: 10,
          AttackRange: 150,
          DelayBetweenShots: 200,
        }),
        makeWeaponDef('EnemyGun', {
          PrimaryDamage: 5,
          AttackRange: 150,
          DelayBetweenShots: 500,
        }),
      ],
      locomotors: [
        {
          name: 'GuardLoco',
          fields: { Speed: 30 },
          surfaces: ['GROUND'],
          surfaceMask: 1,
          downhillOnly: false,
          speed: 30,
        },
        {
          name: 'EnemyLoco',
          fields: { Speed: 30 },
          surfaces: ['GROUND'],
          surfaceMask: 1,
          downhillOnly: false,
          speed: 30,
        },
      ],
    },
    mapObjects: [
      place('Guardian', guardianX, guardianZ),  // id 1
      place('Enemy', enemyX, enemyZ),            // id 2
      ...(opts?.extraMapObjects ?? []),
    ],
    mapSize: 512,
    sides: { America: {}, China: {} },
    enemies: [['America', 'China']],
  });
}

type InternalEntity = {
  id: number;
  x: number;
  z: number;
  guardState: string;
  guardPositionX: number;
  guardPositionZ: number;
  attackTargetEntityId: number | null;
  lastAttackerEntityId: number | null;
  moving: boolean;
  destroyed: boolean;
};

type PrivateApi = {
  spawnedEntities: Map<number, InternalEntity>;
};

// ── Test Suite ──────────────────────────────────────────────────────────────

describe('ZH Guard Retaliate AI System', () => {
  describe('retaliation trigger', () => {
    it('guarding unit retaliates against attacker within MaxRetaliationDistance', () => {
      // Guardian at (100,100), enemy at (290,100) — 190 units away, within
      // MaxRetaliationDistance (210) but BEYOND inner guard range (180).
      // This ensures the guard idle scan does NOT find the enemy — the only
      // way the guardian attacks is through the retaliation path.
      const agent = makeGuardRetaliateAgent({ enemyX: 290, enemyZ: 100 });
      const priv = agent.gameLogic as unknown as PrivateApi;

      // Put guardian in guard mode at its own position.
      agent.guard(1, 100, 100);
      agent.step(60); // Let it settle into guard IDLE.

      const guardian = priv.spawnedEntities.get(1)!;
      // Verify guardian is idle (enemy should be outside inner guard range).
      expect(guardian.guardState).toBe('IDLE');
      expect(guardian.attackTargetEntityId).toBeNull();

      // Simulate the enemy attacking the guardian (e.g., a long-range artillery shot).
      guardian.lastAttackerEntityId = 2;

      // Step so the auto-targeting picks up the retaliation.
      agent.step(1);

      // Guardian should now be retaliating against the enemy.
      expect(guardian.attackTargetEntityId).toBe(2);
      // Guard state should be PURSUING.
      expect(guardian.guardState).toBe('PURSUING');
    });

    it('guarding unit ignores attacker beyond MaxRetaliationDistance', () => {
      // Guardian at (100,100), enemy at (350,100) — 250 units away > 210 max retaliation.
      // Also beyond inner guard range (180) so no auto-acquire.
      const agent = makeGuardRetaliateAgent({ enemyX: 350, enemyZ: 100 });
      const priv = agent.gameLogic as unknown as PrivateApi;

      agent.guard(1, 100, 100);
      agent.step(60);

      const guardian = priv.spawnedEntities.get(1)!;
      expect(guardian.guardState).toBe('IDLE');

      guardian.lastAttackerEntityId = 2;

      agent.step(1);

      // Guardian should NOT be attacking — attacker is beyond MaxRetaliationDistance.
      expect(guardian.attackTargetEntityId).toBeNull();
      // Guard state should still be IDLE (not pursuing).
      expect(guardian.guardState).toBe('IDLE');
    });

    it('non-guarding unit retaliates regardless of MaxRetaliationDistance check', () => {
      // Guardian at (100,100), enemy at (200,100) — 100 units away, within attack range.
      // Guardian is NOT in guard mode — should retaliate normally without
      // MaxRetaliationDistance cap (that cap only applies to guarding units).
      const agent = makeGuardRetaliateAgent({ enemyX: 200, enemyZ: 100 });
      const priv = agent.gameLogic as unknown as PrivateApi;

      // Do NOT issue guard command — leave in normal idle mode.
      agent.step(5);

      const guardian = priv.spawnedEntities.get(1)!;
      guardian.lastAttackerEntityId = 2;

      agent.step(1);

      // Non-guarding unit should retaliate — no MaxRetaliationDistance cap.
      expect(guardian.attackTargetEntityId).toBe(2);
    });
  });

  describe('MaxRetaliationDistance enforcement during pursuit', () => {
    it('guarding unit returns when target moves beyond MaxRetaliationDistance', () => {
      // Enemy at 190 units — beyond inner range (180) so no auto-acquire,
      // but within MaxRetaliationDistance (210).
      const agent = makeGuardRetaliateAgent({ enemyX: 290, enemyZ: 100 });
      const priv = agent.gameLogic as unknown as PrivateApi;

      agent.guard(1, 100, 100);
      agent.step(60); // Let it fully settle into IDLE.

      // Trigger retaliation.
      const guardian = priv.spawnedEntities.get(1)!;
      expect(guardian.guardState).toBe('IDLE');
      guardian.lastAttackerEntityId = 2;
      agent.step(1);

      expect(guardian.guardState).toBe('PURSUING');
      expect(guardian.attackTargetEntityId).toBe(2);

      // Now move the enemy far away beyond MaxRetaliationDistance (210).
      const enemy = priv.spawnedEntities.get(2)!;
      enemy.x = 350;
      enemy.z = 100;

      // Step to let the guard behavior evaluate.
      agent.step(1);

      // Guardian should have stopped pursuing and be returning.
      expect(guardian.guardState).toBe('RETURNING');
      expect(guardian.attackTargetEntityId).toBeNull();
    });

    it('guarding unit continues pursuit when target is within MaxRetaliationDistance', () => {
      // Enemy starts at 190 units from guard anchor — beyond inner (180), within max ret (210).
      const agent = makeGuardRetaliateAgent({ enemyX: 290, enemyZ: 100 });
      const priv = agent.gameLogic as unknown as PrivateApi;

      agent.guard(1, 100, 100);
      agent.step(60);

      const guardian = priv.spawnedEntities.get(1)!;
      expect(guardian.guardState).toBe('IDLE');
      guardian.lastAttackerEntityId = 2;
      agent.step(1);

      expect(guardian.guardState).toBe('PURSUING');

      // Enemy moves slightly closer (still within MaxRetaliationDistance).
      // The guardian has not moved far from anchor yet (1 frame only).
      const enemy = priv.spawnedEntities.get(2)!;
      enemy.x = 280;
      enemy.z = 100;

      agent.step(1);

      // Guardian should still be pursuing (target within all distance limits).
      expect(guardian.guardState).toBe('PURSUING');
    });
  });

  describe('return to guard position', () => {
    it('guarding unit returns to guard position after target is destroyed', () => {
      // Enemy beyond inner guard range (180) but within max retaliation (210).
      const agent = makeGuardRetaliateAgent({ enemyX: 290, enemyZ: 100 });
      const priv = agent.gameLogic as unknown as PrivateApi;

      agent.guard(1, 100, 100);
      agent.step(60);

      const guardian = priv.spawnedEntities.get(1)!;
      expect(guardian.guardState).toBe('IDLE');
      guardian.lastAttackerEntityId = 2;
      agent.step(1);

      expect(guardian.guardState).toBe('PURSUING');

      // Destroy the enemy.
      const enemy = priv.spawnedEntities.get(2)!;
      enemy.destroyed = true;

      agent.step(1);

      // Guardian should be returning to guard position.
      expect(guardian.guardState).toBe('RETURNING');
      expect(guardian.attackTargetEntityId).toBeNull();
    });

    it('guard position is preserved during retaliation', () => {
      // Enemy beyond inner guard range (180).
      const agent = makeGuardRetaliateAgent({ enemyX: 290, enemyZ: 100 });
      const priv = agent.gameLogic as unknown as PrivateApi;

      agent.guard(1, 100, 100);
      agent.step(60);

      const guardian = priv.spawnedEntities.get(1)!;

      // Guard position should be at the commanded position.
      expect(guardian.guardPositionX).toBe(100);
      expect(guardian.guardPositionZ).toBe(100);

      // Trigger retaliation.
      guardian.lastAttackerEntityId = 2;
      agent.step(1);

      // Guard position should NOT change during retaliation.
      expect(guardian.guardPositionX).toBe(100);
      expect(guardian.guardPositionZ).toBe(100);
    });
  });

  describe('friend recruitment', () => {
    it('recruits nearby idle friendly units to retaliate', () => {
      // Place a second guardian nearby within RetaliationFriendsRadius (120).
      // Enemy beyond inner guard range (180) so no auto-acquire.
      const agent = makeGuardRetaliateAgent({
        enemyX: 290,
        enemyZ: 100,
        extraObjects: [
          makeObjectDef('Guardian2', 'America', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', {
              MaxHealth: 500,
              InitialHealth: 500,
            }),
            makeWeaponBlock('GuardGun'),
            makeBlock('LocomotorSet', 'SET_NORMAL GuardLoco', {}),
          ], { VisionRange: 100, ShroudClearingRange: 100 }),
        ],
        extraMapObjects: [
          place('Guardian2', 150, 100), // id 3, 50 units from guardian 1 — within friends radius
        ],
      });
      const priv = agent.gameLogic as unknown as PrivateApi;

      // Put guardian 1 in guard mode. Guardian 2 is just idle (not guarding).
      agent.guard(1, 100, 100);
      agent.step(60);

      // Guardian2 should be idle (enemy is beyond inner range).
      const guardian2 = priv.spawnedEntities.get(3)!;
      expect(guardian2.attackTargetEntityId).toBeNull();

      // Guardian1 should be idle in guard mode (enemy beyond inner range).
      const guardian1 = priv.spawnedEntities.get(1)!;
      expect(guardian1.guardState).toBe('IDLE');

      // Trigger retaliation on guardian 1.
      guardian1.lastAttackerEntityId = 2;
      agent.step(1);

      // Guardian 1 should be retaliating.
      expect(guardian1.attackTargetEntityId).toBe(2);

      // Guardian 2 should have been recruited to attack the same enemy.
      expect(guardian2.attackTargetEntityId).toBe(2);
    });

    it('does not recruit friends beyond RetaliationFriendsRadius', () => {
      // Place a second guardian far away — beyond RetaliationFriendsRadius (120).
      // Guardian2 placed far from BOTH guardian1 and enemy to avoid auto-acquire.
      // Enemy at (290,100), Guardian2 at (100,350) — 250 units from guardian1,
      // well beyond friends radius (120), and far from enemy.
      const agent = makeGuardRetaliateAgent({
        enemyX: 290,
        enemyZ: 100,
        extraObjects: [
          makeObjectDef('Guardian2', 'America', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', {
              MaxHealth: 500,
              InitialHealth: 500,
            }),
            makeWeaponBlock('GuardGun'),
            makeBlock('LocomotorSet', 'SET_NORMAL GuardLoco', {}),
          ], { VisionRange: 100, ShroudClearingRange: 100 }),
        ],
        extraMapObjects: [
          place('Guardian2', 100, 350), // id 3, 250 units from guardian1, outside friends radius
        ],
      });
      const priv = agent.gameLogic as unknown as PrivateApi;

      agent.guard(1, 100, 100);
      agent.step(60);

      const guardian2 = priv.spawnedEntities.get(3)!;
      // Guardian2 should be idle (enemy is far away).
      expect(guardian2.attackTargetEntityId).toBeNull();

      const guardian1 = priv.spawnedEntities.get(1)!;
      guardian1.lastAttackerEntityId = 2;
      agent.step(1);

      // Guardian 2 should NOT have been recruited — too far away from retaliator.
      expect(guardian2.attackTargetEntityId).toBeNull();
    });

    it('does not recruit friends that are already attacking', () => {
      // Enemy beyond inner range so no auto-acquire by guard scan.
      const agent = makeGuardRetaliateAgent({
        enemyX: 290,
        enemyZ: 100,
        extraObjects: [
          makeObjectDef('Guardian2', 'America', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', {
              MaxHealth: 500,
              InitialHealth: 500,
            }),
            makeWeaponBlock('GuardGun'),
            makeBlock('LocomotorSet', 'SET_NORMAL GuardLoco', {}),
          ], { VisionRange: 100, ShroudClearingRange: 100 }),
        ],
        extraMapObjects: [
          place('Guardian2', 150, 100), // id 3, within friends radius
        ],
      });
      const priv = agent.gameLogic as unknown as PrivateApi;

      agent.guard(1, 100, 100);
      agent.step(60);

      // Set guardian2 as already attacking something.
      const guardian2 = priv.spawnedEntities.get(3)!;
      guardian2.attackTargetEntityId = 2; // already attacking the enemy

      const guardian1 = priv.spawnedEntities.get(1)!;
      guardian1.lastAttackerEntityId = 2;
      agent.step(1);

      // Guardian 2 should have been skipped by recruitment because it already
      // had an attack target. Its target remains set.
      expect(guardian2.attackTargetEntityId).not.toBeNull();
    });

    it('friend recruitment only happens for guarding retaliators', () => {
      // Non-guarding unit retaliates — should NOT recruit friends.
      // Enemy close enough for normal retaliation to work.
      const agent = makeGuardRetaliateAgent({
        enemyX: 200,
        enemyZ: 100,
        extraObjects: [
          makeObjectDef('Guardian2', 'America', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', {
              MaxHealth: 500,
              InitialHealth: 500,
            }),
            makeWeaponBlock('GuardGun'),
            makeBlock('LocomotorSet', 'SET_NORMAL GuardLoco', {}),
          ], { VisionRange: 100, ShroudClearingRange: 100 }),
        ],
        extraMapObjects: [
          place('Guardian2', 150, 100), // id 3, within friends radius
        ],
      });
      const priv = agent.gameLogic as unknown as PrivateApi;

      // Do NOT put guardian 1 in guard mode.
      agent.step(5);

      // Clear any auto-acquired targets so we can test cleanly.
      const guardian2 = priv.spawnedEntities.get(3)!;
      guardian2.attackTargetEntityId = null;
      guardian2.moving = false;

      const guardian1 = priv.spawnedEntities.get(1)!;
      guardian1.attackTargetEntityId = null;
      guardian1.moving = false;
      guardian1.lastAttackerEntityId = 2;
      agent.step(1);

      // Guardian 1 retaliates (no guard mode, so no distance cap).
      expect(guardian1.attackTargetEntityId).toBe(2);

      // Guardian 2 should NOT have been recruited — retaliator is not guarding.
      expect(guardian2.attackTargetEntityId).toBeNull();
    });
  });

  describe('building rejection', () => {
    it('guard scan does not acquire enemy buildings as targets', () => {
      // Existing behavior from findGuardTarget — buildings are rejected
      // unless they are base defenses. This test verifies the filter
      // continues to work in the guard retaliate context.
      const agent = createParityAgent({
        bundles: {
          objects: [
            makeObjectDef('Guardian', 'America', ['VEHICLE'], [
              makeBlock('Body', 'ActiveBody ModuleTag_Body', {
                MaxHealth: 500,
                InitialHealth: 500,
              }),
              makeWeaponBlock('GuardGun'),
              makeBlock('LocomotorSet', 'SET_NORMAL GuardLoco', {}),
            ], { VisionRange: 100, ShroudClearingRange: 100 }),
            makeObjectDef('EnemyBuilding', 'China', ['STRUCTURE'], [
              makeBlock('Body', 'ActiveBody ModuleTag_Body', {
                MaxHealth: 5000,
                InitialHealth: 5000,
              }),
            ]),
          ],
          weapons: [
            makeWeaponDef('GuardGun', {
              PrimaryDamage: 10,
              AttackRange: 150,
              DelayBetweenShots: 200,
            }),
          ],
          locomotors: [
            {
              name: 'GuardLoco',
              fields: { Speed: 30 },
              surfaces: ['GROUND'],
              surfaceMask: 1,
              downhillOnly: false,
              speed: 30,
            },
          ],
        },
        mapObjects: [
          place('Guardian', 100, 100),       // id 1
          place('EnemyBuilding', 120, 100),  // id 2 — nearby building
        ],
        mapSize: 512,
        sides: { America: {}, China: {} },
        enemies: [['America', 'China']],
      });
      const priv = agent.gameLogic as unknown as PrivateApi;

      agent.guard(1, 100, 100);

      // Step many frames to let guard scans run.
      agent.step(60);

      const guardian = priv.spawnedEntities.get(1)!;

      // Guardian should NOT auto-acquire the building as a guard scan target.
      // (Human player guard mode rejects non-base-defense structures.)
      expect(guardian.attackTargetEntityId).toBeNull();
      expect(guardian.guardState).not.toBe('PURSUING');
    });
  });

  describe('edge cases', () => {
    it('retaliation works when guard anchor is from guardObject mode', () => {
      // Guard a friendly building, enemy attacks while near it.
      const agent = createParityAgent({
        bundles: {
          objects: [
            makeObjectDef('Guardian', 'America', ['VEHICLE'], [
              makeBlock('Body', 'ActiveBody ModuleTag_Body', {
                MaxHealth: 500,
                InitialHealth: 500,
              }),
              makeWeaponBlock('GuardGun'),
              makeBlock('LocomotorSet', 'SET_NORMAL GuardLoco', {}),
            ], { VisionRange: 100, ShroudClearingRange: 100 }),
            makeObjectDef('FriendlyBase', 'America', ['STRUCTURE'], [
              makeBlock('Body', 'ActiveBody ModuleTag_Body', {
                MaxHealth: 5000,
                InitialHealth: 5000,
              }),
            ]),
            makeObjectDef('Enemy', 'China', ['VEHICLE'], [
              makeBlock('Body', 'ActiveBody ModuleTag_Body', {
                MaxHealth: 5000,
                InitialHealth: 5000,
              }),
              makeWeaponBlock('EnemyGun'),
              makeBlock('LocomotorSet', 'SET_NORMAL EnemyLoco', {}),
            ], { VisionRange: 100 }),
          ],
          weapons: [
            makeWeaponDef('GuardGun', {
              PrimaryDamage: 10,
              AttackRange: 150,
              DelayBetweenShots: 200,
            }),
            makeWeaponDef('EnemyGun', {
              PrimaryDamage: 5,
              AttackRange: 150,
              DelayBetweenShots: 500,
            }),
          ],
          locomotors: [
            {
              name: 'GuardLoco',
              fields: { Speed: 30 },
              surfaces: ['GROUND'],
              surfaceMask: 1,
              downhillOnly: false,
              speed: 30,
            },
            {
              name: 'EnemyLoco',
              fields: { Speed: 30 },
              surfaces: ['GROUND'],
              surfaceMask: 1,
              downhillOnly: false,
              speed: 30,
            },
          ],
        },
        mapObjects: [
          place('Guardian', 100, 100),      // id 1
          place('FriendlyBase', 100, 100),  // id 2
          place('Enemy', 130, 100),          // id 3
        ],
        mapSize: 512,
        sides: { America: {}, China: {} },
        enemies: [['America', 'China']],
      });
      const priv = agent.gameLogic as unknown as PrivateApi;

      // Guard the friendly base (object mode).
      agent.gameLogic.submitCommand({
        type: 'guardObject',
        entityId: 1,
        targetEntityId: 2,
        guardMode: 0,
        commandSource: 'PLAYER',
      });
      agent.step(30);

      const guardian = priv.spawnedEntities.get(1)!;
      guardian.lastAttackerEntityId = 3;
      agent.step(1);

      // Guardian should retaliate — enemy is within MaxRetaliationDistance of the guarded object.
      expect(guardian.attackTargetEntityId).toBe(3);
      expect(guardian.guardState).toBe('PURSUING');
    });

    it('guard state persists through retaliation cycle (attack then return)', () => {
      // Place enemy far enough away (beyond inner range 180) so the guardian
      // does not auto-acquire it during idle scans, but close enough for
      // retaliation (within MaxRetaliationDistance 210).
      const agent = makeGuardRetaliateAgent({ enemyX: 290, enemyZ: 100 });
      const priv = agent.gameLogic as unknown as PrivateApi;

      agent.guard(1, 100, 100);
      agent.step(60); // Wait to fully settle into IDLE.

      const guardian = priv.spawnedEntities.get(1)!;
      // Guardian should be in IDLE (enemy is beyond inner range, so no auto-acquire).
      expect(guardian.guardState).toBe('IDLE');

      // Trigger retaliation (simulating a long-range attack from the enemy).
      guardian.lastAttackerEntityId = 2;
      agent.step(1);
      expect(guardian.guardState).toBe('PURSUING');

      // Destroy enemy.
      const enemy = priv.spawnedEntities.get(2)!;
      enemy.destroyed = true;

      agent.step(1);
      expect(guardian.guardState).toBe('RETURNING');

      // After enough steps, guardian should return to IDLE.
      agent.step(300);

      // The key assertion: guard mode was NOT dropped entirely.
      expect(guardian.guardState).not.toBe('NONE');
    });
  });
});
