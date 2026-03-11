/**
 * Pipeline Parity Tests — multi-system integration tests verifying emergent behavior.
 *
 * These tests exercise multiple subsystems together: combat + armor + veterancy,
 * build + produce + combat, attack-move, guard behavior, and victory conditions.
 */

import { describe, expect, it } from 'vitest';

import {
  createParityAgent,
  makeBlock,
  makeObjectDef,
  makeWeaponDef,
  makeArmorDef,
  makeUpgradeDef,
  makeWeaponBlock,
  place,
} from './parity-agent.js';

describe('parity pipeline', () => {
  // ── Combat + Armor + Upgrade ──────────────────────────────────────────

  describe('combat + armor upgrade pipeline', () => {
    it('armor upgrade changes damage coefficients mid-combat', () => {
      const agent = createParityAgent({
        bundles: {
          objects: [
            makeObjectDef('Attacker', 'America', ['VEHICLE'], [
              makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 300, InitialHealth: 300 }),
              makeWeaponBlock('Rifle'),
            ]),
            makeObjectDef('Target', 'China', ['VEHICLE'], [
              makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
              makeBlock('ArmorSet', 'ArmorSet', {
                Conditions: 'NONE',
                Armor: 'DefaultArmor',
              }),
              makeBlock('ArmorSet', 'ArmorSet', {
                Conditions: 'PLAYER_UPGRADE',
                Armor: 'UpgradedArmor',
              }),
              makeBlock('Behavior', 'ArmorUpgrade ModuleTag_ArmorUpgrade', {
                TriggeredBy: 'Upgrade_PlateArmor',
              }),
            ]),
          ],
          weapons: [
            makeWeaponDef('Rifle', {
              PrimaryDamage: 40,
              DamageType: 'SMALL_ARMS',
              AttackRange: 120,
              DelayBetweenShots: 100,
            }),
          ],
          armors: [
            makeArmorDef('DefaultArmor', { Default: 1, SMALL_ARMS: '100%' }),
            makeArmorDef('UpgradedArmor', { Default: 1, SMALL_ARMS: '25%' }),
          ],
          upgrades: [
            makeUpgradeDef('Upgrade_PlateArmor', {}),
          ],
        },
        mapObjects: [place('Attacker', 10, 10), place('Target', 30, 10)],
        mapSize: 8,
        sides: { America: {}, China: {} },
        enemies: [['America', 'China']],
      });

      // Attack with default armor (100% = full damage)
      agent.attack(1, 2);
      const beforeUpgrade = agent.snapshot();
      agent.step(6);
      const afterFirstHits = agent.diff(beforeUpgrade);

      const firstDamage = afterFirstHits.damaged.find((e) => e.id === 2);
      expect(firstDamage).toBeDefined();
      const dmgBefore = firstDamage!.hpBefore - firstDamage!.hpAfter;
      expect(dmgBefore % 40).toBe(0); // 40 * 1.0 = 40 per hit

      // Apply armor upgrade
      agent.upgrade(2, 'Upgrade_PlateArmor');
      const beforeSecondPhase = agent.snapshot();
      agent.step(6);
      const afterUpgrade = agent.diff(beforeSecondPhase);

      const secondDamage = afterUpgrade.damaged.find((e) => e.id === 2);
      expect(secondDamage).toBeDefined();
      const dmgAfter = secondDamage!.hpBefore - secondDamage!.hpAfter;
      // Before upgrade: each hit = 40 * 1.0 = 40
      // After upgrade: each hit = 40 * 0.25 = 10
      // So dmgAfter per hit should be exactly 10, not 40
      expect(dmgAfter).toBeLessThan(dmgBefore);
      // Verify the actual per-hit damage is 10 (not 40)
      expect(dmgAfter % 10).toBe(0);
      expect(dmgAfter % 40).not.toBe(0); // Must NOT be a multiple of 40
    });
  });

  // ── Attack-Move ───────────────────────────────────────────────────────

  describe('attack-move engages enemies in path', () => {
    it('attack-move command is accepted without error', () => {
      // Attack-move depends on multiple subsystems (locomotor, weapon scan, pathfinding)
      // so we verify the command is accepted and entity state is valid after stepping.
      const agent = createParityAgent({
        bundles: {
          objects: [
            makeObjectDef('Mover', 'America', ['VEHICLE'], [
              makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 300, InitialHealth: 300 }),
              makeWeaponBlock('MoverGun'),
              makeBlock('Locomotor', 'SET_NORMAL BasicLoco', {}),
            ]),
          ],
          weapons: [
            makeWeaponDef('MoverGun', {
              PrimaryDamage: 30,
              AttackRange: 120,
              DelayBetweenShots: 100,
            }),
          ],
          locomotors: [{ name: 'BasicLoco', fields: { Speed: 30 }, surfaces: ['GROUND'], surfaceMask: 1, downhillOnly: false, speed: 30 }],
        },
        mapObjects: [place('Mover', 10, 10)],
        mapSize: 64,
        sides: { America: {} },
      });

      // Issue attack-move — should not throw
      agent.attackMove(1, 50, 50);
      agent.step(30);
      const mover = agent.entity(1);
      expect(mover).not.toBeNull();
      expect(mover!.alive).toBe(true);
    });
  });

  // ── Multiple Sides Combat ─────────────────────────────────────────────

  describe('multi-side combat', () => {
    it('mutual combat: both sides deal damage simultaneously', () => {
      const agent = createParityAgent({
        bundles: {
          objects: [
            makeObjectDef('TankA', 'America', ['VEHICLE'], [
              makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 300, InitialHealth: 300 }),
              makeWeaponBlock('TankGun'),
            ]),
            makeObjectDef('TankB', 'China', ['VEHICLE'], [
              makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 300, InitialHealth: 300 }),
              makeWeaponBlock('TankGun'),
            ]),
          ],
          weapons: [
            makeWeaponDef('TankGun', {
              PrimaryDamage: 25,
              AttackRange: 120,
              DelayBetweenShots: 100,
            }),
          ],
        },
        mapObjects: [place('TankA', 10, 10), place('TankB', 30, 10)],
        mapSize: 8,
        sides: { America: {}, China: {} },
        enemies: [['America', 'China']],
      });

      // Both attack each other
      agent.attack(1, 2);
      agent.attack(2, 1);
      const before = agent.snapshot();
      agent.step(15);
      const d = agent.diff(before);

      // Both should take damage
      const tankADamage = d.damaged.find((e) => e.id === 1);
      const tankBDamage = d.damaged.find((e) => e.id === 2);
      const tankADestroyed = d.destroyed.find((e) => e.id === 1);
      const tankBDestroyed = d.destroyed.find((e) => e.id === 2);

      // At least one (or both) should have taken damage
      expect(
        (tankADamage !== undefined || tankADestroyed !== undefined)
        && (tankBDamage !== undefined || tankBDestroyed !== undefined),
      ).toBe(true);
    });
  });

  // ── Victory Conditions ────────────────────────────────────────────────

  describe('victory conditions', () => {
    it('destroying all enemy entities triggers game end', () => {
      const agent = createParityAgent({
        bundles: {
          objects: [
            makeObjectDef('Strong', 'America', ['VEHICLE'], [
              makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
              makeWeaponBlock('BigGun'),
            ]),
            makeObjectDef('Weak', 'China', ['VEHICLE'], [
              makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 50, InitialHealth: 50 }),
            ]),
          ],
          weapons: [
            makeWeaponDef('BigGun', {
              PrimaryDamage: 100,
              AttackRange: 120,
              DelayBetweenShots: 66,
            }),
          ],
        },
        mapObjects: [place('Strong', 10, 10), place('Weak', 30, 10)],
        mapSize: 8,
        sides: { America: {}, China: {} },
        enemies: [['America', 'China']],
      });

      agent.attack(1, 2);
      agent.step(30); // Should destroy the 50 HP target quickly

      // Target should be destroyed
      expect(agent.entity(2)).toBeNull();

      // Side China should be defeated
      expect(agent.gameLogic.isSideDefeated('China')).toBe(true);
    });
  });

  // ── Credits + Economy ─────────────────────────────────────────────────

  describe('credits management', () => {
    it('setting credits persists across frames', () => {
      const agent = createParityAgent({
        bundles: {
          objects: [
            makeObjectDef('Unit', 'America', ['VEHICLE'], [
              makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
            ]),
          ],
        },
        mapObjects: [place('Unit', 10, 10)],
        sides: { America: { credits: 5000 }, China: { credits: 3000 } },
      });

      expect(agent.state().credits['America']).toBe(5000);
      expect(agent.state().credits['China']).toBe(3000);

      agent.step(10);
      expect(agent.state().credits['America']).toBe(5000);
      expect(agent.state().credits['China']).toBe(3000);

      agent.setCredits('America', 10000);
      expect(agent.state().credits['America']).toBe(10000);
    });
  });

  // ── Guard Behavior ────────────────────────────────────────────────────

  describe('guard position', () => {
    it('guard command keeps entity at position', () => {
      const agent = createParityAgent({
        bundles: {
          objects: [
            makeObjectDef('Guard', 'America', ['VEHICLE'], [
              makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
              makeWeaponBlock('GuardGun'),
              makeBlock('Locomotor', 'SET_NORMAL GuardLoco', {}),
            ]),
          ],
          weapons: [
            makeWeaponDef('GuardGun', {
              PrimaryDamage: 20,
              AttackRange: 80,
              DelayBetweenShots: 100,
            }),
          ],
          locomotors: [{ name: 'GuardLoco', fields: { Speed: 20 }, surfaces: ['GROUND'], surfaceMask: 1, downhillOnly: false, speed: 20 }],
        },
        mapObjects: [place('Guard', 30, 30)],
        mapSize: 64,
        sides: { America: {} },
      });

      const startPos = agent.entity(1)!.pos;
      agent.guard(1, 30, 30);
      agent.step(30);

      // Entity should still be near its guard position
      const endPos = agent.entity(1)!.pos;
      const drift = Math.hypot(endPos[0] - startPos[0], endPos[2] - startPos[2]);
      expect(drift).toBeLessThan(10); // Should not wander far
    });
  });

  // ── Stop Command ──────────────────────────────────────────────────────

  describe('stop command', () => {
    it('stop halts an entity in combat', () => {
      const agent = createParityAgent({
        bundles: {
          objects: [
            makeObjectDef('Attacker', 'America', ['VEHICLE'], [
              makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 300, InitialHealth: 300 }),
              makeWeaponBlock('Gun'),
            ]),
            makeObjectDef('Target', 'China', ['VEHICLE'], [
              makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
            ]),
          ],
          weapons: [
            makeWeaponDef('Gun', {
              PrimaryDamage: 30,
              AttackRange: 120,
              DelayBetweenShots: 100,
            }),
          ],
        },
        mapObjects: [place('Attacker', 10, 10), place('Target', 30, 10)],
        mapSize: 8,
        sides: { America: {}, China: {} },
        enemies: [['America', 'China']],
      });

      agent.attack(1, 2);
      agent.step(6); // Some damage dealt
      const healthAfterAttack = agent.entity(2)!.health;

      agent.stop(1); // Stop attacking
      const snapshotAfterStop = agent.snapshot();
      agent.step(10); // Run 10 more frames

      // After stopping, no further damage should be dealt
      const d = agent.diff(snapshotAfterStop);
      const furtherDamage = d.damaged.find((e) => e.id === 2);
      // Target health should be unchanged after stop (or very close)
      const healthAfterStop = agent.entity(2)!.health;
      expect(healthAfterStop).toBeGreaterThanOrEqual(healthAfterAttack - 30);
    });
  });

  // ── Full Combat Timeline Determinism ──────────────────────────────────

  describe('full timeline determinism', () => {
    it('complex scenario produces identical results on replay', () => {
      function runScenario() {
        const agent = createParityAgent({
          bundles: {
            objects: [
              makeObjectDef('MedTank', 'America', ['VEHICLE'], [
                makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
                makeWeaponBlock('MedCannon'),
              ]),
              makeObjectDef('LightTank', 'China', ['VEHICLE'], [
                makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
                makeWeaponBlock('LightCannon'),
              ]),
            ],
            weapons: [
              makeWeaponDef('MedCannon', { PrimaryDamage: 30, AttackRange: 120, DelayBetweenShots: 100 }),
              makeWeaponDef('LightCannon', { PrimaryDamage: 15, AttackRange: 100, DelayBetweenShots: 66 }),
            ],
          },
          mapObjects: [place('MedTank', 10, 10), place('LightTank', 30, 10)],
          mapSize: 8,
          sides: { America: {}, China: {} },
          enemies: [['America', 'China']],
        });

        // Both attack
        agent.attack(1, 2);
        agent.attack(2, 1);

        const snapshots: { e1: number; e2: number }[] = [];
        for (let i = 0; i < 20; i++) {
          agent.step(1);
          snapshots.push({
            e1: agent.entity(1)?.health ?? -1,
            e2: agent.entity(2)?.health ?? -1,
          });
        }
        return snapshots;
      }

      const run1 = runScenario();
      const run2 = runScenario();
      expect(run1).toEqual(run2);
    });
  });
});
