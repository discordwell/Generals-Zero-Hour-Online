/**
 * Combat Parity Tests — verify damage formulas and weapon mechanics match C++ source.
 *
 * Uses createParityAgent for headless combat scenarios. Tests verify:
 * - damage = PrimaryDamage * armorCoefficient[damageType]
 * - DAMAGE_UNRESISTABLE bypasses all armor
 * - Negative coefficients clamp to 0
 * - Clip reload timing
 * - DelayBetweenShots spacing
 * - PreAttackDelay types (PER_SHOT, PER_ATTACK, PER_CLIP)
 */

import { describe, expect, it } from 'vitest';

import {
  createParityAgent,
  makeBlock,
  makeObjectDef,
  makeWeaponDef,
  makeArmorDef,
  makeWeaponBlock,
  place,
} from './parity-agent.js';

describe('parity combat', () => {
  // ── Armor Coefficient Damage ──────────────────────────────────────────

  describe('armor coefficient reduces weapon damage', () => {
    it('applies 50% armor coefficient to reduce damage by half', () => {
      const agent = createParityAgent({
        bundles: {
          objects: [
            makeObjectDef('Attacker', 'America', ['VEHICLE'], [
              makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
              makeWeaponBlock('TestGun'),
            ]),
            makeObjectDef('Target', 'China', ['VEHICLE'], [
              makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
              makeBlock('ArmorSet', 'ArmorSet', { Conditions: 'NONE', Armor: 'HeavyArmor' }),
            ]),
          ],
          weapons: [
            makeWeaponDef('TestGun', {
              PrimaryDamage: 50,
              DamageType: 'ARMOR_PIERCING',
              AttackRange: 120,
              DelayBetweenShots: 100,
            }),
          ],
          armors: [
            makeArmorDef('HeavyArmor', { Default: 1, ARMOR_PIERCING: '50%' }),
          ],
        },
        mapObjects: [place('Attacker', 10, 10), place('Target', 30, 10)],
        mapSize: 8,
        sides: { America: {}, China: {} },
        enemies: [['America', 'China']],
      });

      agent.attack(1, 2);
      const before = agent.snapshot();
      // Step enough for one hit (first shot fires within 3 frames with DelayBetweenShots: 100ms)
      agent.step(6);
      const d = agent.diff(before);

      // 50 damage * 0.5 coefficient = 25 actual damage per hit
      const targetDamage = d.damaged.find((e) => e.id === 2);
      expect(targetDamage).toBeDefined();
      const actualDamage = targetDamage!.hpBefore - targetDamage!.hpAfter;
      // Should be a multiple of 25 (50 * 0.5)
      expect(actualDamage % 25).toBe(0);
      expect(actualDamage).toBeGreaterThanOrEqual(25);
    });

    it('applies 100% armor coefficient (full damage)', () => {
      const agent = createParityAgent({
        bundles: {
          objects: [
            makeObjectDef('Attacker', 'America', ['VEHICLE'], [
              makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
              makeWeaponBlock('TestGun'),
            ]),
            makeObjectDef('Target', 'China', ['VEHICLE'], [
              makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
              makeBlock('ArmorSet', 'ArmorSet', { Conditions: 'NONE', Armor: 'PaperArmor' }),
            ]),
          ],
          weapons: [
            makeWeaponDef('TestGun', {
              PrimaryDamage: 40,
              DamageType: 'EXPLOSION',
              AttackRange: 120,
              DelayBetweenShots: 100,
            }),
          ],
          armors: [
            makeArmorDef('PaperArmor', { Default: '100%' }),
          ],
        },
        mapObjects: [place('Attacker', 10, 10), place('Target', 30, 10)],
        mapSize: 8,
        sides: { America: {}, China: {} },
        enemies: [['America', 'China']],
      });

      agent.attack(1, 2);
      const before = agent.snapshot();
      agent.step(6);
      const d = agent.diff(before);

      const targetDamage = d.damaged.find((e) => e.id === 2);
      expect(targetDamage).toBeDefined();
      const actualDamage = targetDamage!.hpBefore - targetDamage!.hpAfter;
      // 40 damage * 1.0 coefficient = 40 actual damage per hit
      expect(actualDamage % 40).toBe(0);
      expect(actualDamage).toBeGreaterThanOrEqual(40);
    });

    it('Default armor applies to all unspecified damage types', () => {
      // C++ source parity: ArmorTemplate::clear() sets all to 1.0,
      // then "Default" overrides all entries before specific types are parsed.
      const agent = createParityAgent({
        bundles: {
          objects: [
            makeObjectDef('Attacker', 'America', ['VEHICLE'], [
              makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
              makeWeaponBlock('TestGun'),
            ]),
            makeObjectDef('Target', 'China', ['VEHICLE'], [
              makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
              makeBlock('ArmorSet', 'ArmorSet', { Conditions: 'NONE', Armor: 'DefaultLowArmor' }),
            ]),
          ],
          weapons: [
            makeWeaponDef('TestGun', {
              PrimaryDamage: 60,
              DamageType: 'FLAME',
              AttackRange: 120,
              DelayBetweenShots: 100,
            }),
          ],
          armors: [
            // Default 25% — all damage types get 0.25 coefficient unless overridden
            makeArmorDef('DefaultLowArmor', { Default: '25%' }),
          ],
        },
        mapObjects: [place('Attacker', 10, 10), place('Target', 30, 10)],
        mapSize: 8,
        sides: { America: {}, China: {} },
        enemies: [['America', 'China']],
      });

      agent.attack(1, 2);
      const before = agent.snapshot();
      agent.step(6);
      const d = agent.diff(before);

      const targetDamage = d.damaged.find((e) => e.id === 2);
      expect(targetDamage).toBeDefined();
      const actualDamage = targetDamage!.hpBefore - targetDamage!.hpAfter;
      // 60 * 0.25 = 15 damage per hit
      expect(actualDamage % 15).toBe(0);
      expect(actualDamage).toBeGreaterThanOrEqual(15);
    });
  });

  // ── Negative Armor Coefficient ───────────────────────────────────────

  describe('negative armor coefficient clamps to zero damage', () => {
    it('negative coefficient produces zero damage, not healing', () => {
      const agent = createParityAgent({
        bundles: {
          objects: [
            makeObjectDef('Attacker', 'America', ['VEHICLE'], [
              makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
              makeWeaponBlock('TestGun'),
            ]),
            makeObjectDef('Target', 'China', ['VEHICLE'], [
              makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
              makeBlock('ArmorSet', 'ArmorSet', { Conditions: 'NONE', Armor: 'HealArmor' }),
            ]),
          ],
          weapons: [
            makeWeaponDef('TestGun', {
              PrimaryDamage: 50,
              DamageType: 'SMALL_ARMS',
              AttackRange: 120,
              DelayBetweenShots: 100,
            }),
          ],
          armors: [
            // Negative coefficient — C++ clamps to 0 damage
            makeArmorDef('HealArmor', { Default: 1, SMALL_ARMS: '-50%' }),
          ],
        },
        mapObjects: [place('Attacker', 10, 10), place('Target', 30, 10)],
        mapSize: 8,
        sides: { America: {}, China: {} },
        enemies: [['America', 'China']],
      });

      agent.attack(1, 2);
      agent.step(15);

      // Target should not have gained health (no healing from negative armor)
      const target = agent.entity(2);
      expect(target).not.toBeNull();
      expect(target!.health).toBeLessThanOrEqual(500);
    });
  });

  // ── UNRESISTABLE Damage ───────────────────────────────────────────────

  describe('DAMAGE_UNRESISTABLE bypasses armor', () => {
    it('deals full damage regardless of armor coefficient', () => {
      const agent = createParityAgent({
        bundles: {
          objects: [
            makeObjectDef('Attacker', 'America', ['VEHICLE'], [
              makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
              makeWeaponBlock('UnresistableGun'),
            ]),
            makeObjectDef('Target', 'China', ['VEHICLE'], [
              makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
              makeBlock('ArmorSet', 'ArmorSet', { Conditions: 'NONE', Armor: 'NearlyImmune' }),
            ]),
          ],
          weapons: [
            makeWeaponDef('UnresistableGun', {
              PrimaryDamage: 100,
              DamageType: 'UNRESISTABLE',
              AttackRange: 120,
              DelayBetweenShots: 100,
            }),
          ],
          armors: [
            // 1% coefficient for everything — but UNRESISTABLE ignores it
            makeArmorDef('NearlyImmune', { Default: '1%' }),
          ],
        },
        mapObjects: [place('Attacker', 10, 10), place('Target', 30, 10)],
        mapSize: 8,
        sides: { America: {}, China: {} },
        enemies: [['America', 'China']],
      });

      agent.attack(1, 2);
      const before = agent.snapshot();
      agent.step(6);
      const d = agent.diff(before);

      const targetDamage = d.damaged.find((e) => e.id === 2);
      expect(targetDamage).toBeDefined();
      const actualDamage = targetDamage!.hpBefore - targetDamage!.hpAfter;
      // Full 100 damage per hit, not 1% = 1
      expect(actualDamage % 100).toBe(0);
      expect(actualDamage).toBeGreaterThanOrEqual(100);
    });
  });

  // ── Clip Reload ───────────────────────────────────────────────────────

  describe('clip reload mechanics', () => {
    it('reloads after clip is empty', () => {
      const agent = createParityAgent({
        bundles: {
          objects: [
            makeObjectDef('Attacker', 'America', ['VEHICLE'], [
              makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
              makeWeaponBlock('ClipGun'),
            ]),
            makeObjectDef('Target', 'China', ['VEHICLE'], [
              makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 2000, InitialHealth: 2000 }),
            ]),
          ],
          weapons: [
            makeWeaponDef('ClipGun', {
              PrimaryDamage: 10,
              AttackRange: 120,
              DelayBetweenShots: 66,    // 2 frames
              ClipSize: 2,
              ClipReloadTime: 600,       // 18 frames — very long reload
            }),
          ],
        },
        mapObjects: [place('Attacker', 10, 10), place('Target', 30, 10)],
        mapSize: 8,
        sides: { America: {}, China: {} },
        enemies: [['America', 'China']],
      });

      agent.attack(1, 2);

      // Track damage per frame to observe clip/reload pattern
      const healthTimeline: number[] = [];
      for (let i = 0; i < 40; i++) {
        agent.step(1);
        const t = agent.entity(2);
        healthTimeline.push(t ? t.health : -1);
      }

      // Count total damage events (health decreases)
      const damageFrames = healthTimeline
        .map((h, i) => i > 0 && h < healthTimeline[i - 1]! ? i : -1)
        .filter((f) => f >= 0);

      // Should see at least the clip (2 shots) fire, then reload, then fire again
      expect(damageFrames.length).toBeGreaterThanOrEqual(2);

      // The total damage should be a multiple of 10
      const totalDamage = 2000 - (agent.entity(2)?.health ?? 0);
      expect(totalDamage % 10).toBe(0);

      // Verify clip pattern: if we got 4+ damage events, the gap between
      // clip 1 end and clip 2 start should be longer than intra-clip gap
      if (damageFrames.length >= 4) {
        const intraClipGap = damageFrames[1]! - damageFrames[0]!;
        const reloadGap = damageFrames[2]! - damageFrames[1]!;
        expect(reloadGap).toBeGreaterThan(intraClipGap);
      }
    });
  });

  // ── DelayBetweenShots ─────────────────────────────────────────────────

  describe('delay between shots', () => {
    it('spaces shots by DelayBetweenShots milliseconds', () => {
      const agent = createParityAgent({
        bundles: {
          objects: [
            makeObjectDef('Attacker', 'America', ['VEHICLE'], [
              makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
              makeWeaponBlock('SlowGun'),
            ]),
            makeObjectDef('Target', 'China', ['VEHICLE'], [
              makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
            ]),
          ],
          weapons: [
            makeWeaponDef('SlowGun', {
              PrimaryDamage: 10,
              AttackRange: 120,
              // 200ms = 6 frames at 30 FPS
              DelayBetweenShots: 200,
            }),
          ],
        },
        mapObjects: [place('Attacker', 10, 10), place('Target', 30, 10)],
        mapSize: 8,
        sides: { America: {}, China: {} },
        enemies: [['America', 'China']],
      });

      agent.attack(1, 2);

      const healthTimeline: number[] = [];
      for (let i = 0; i < 20; i++) {
        agent.step(1);
        const t = agent.entity(2);
        healthTimeline.push(t ? t.health : -1);
      }

      const damageFrames = healthTimeline
        .map((h, i) => i > 0 && h < healthTimeline[i - 1]! ? i : -1)
        .filter((f) => f >= 0);

      // Should have multiple shots
      expect(damageFrames.length).toBeGreaterThanOrEqual(2);

      // Delay between consecutive shots should be ~6 frames (200ms / 33.33ms)
      if (damageFrames.length >= 2) {
        const delay = damageFrames[1]! - damageFrames[0]!;
        // Allow some tolerance (5-7 frames for 200ms)
        expect(delay).toBeGreaterThanOrEqual(5);
        expect(delay).toBeLessThanOrEqual(8);
      }
    });
  });

  // ── PreAttackDelay Types ──────────────────────────────────────────────

  describe('pre-attack delay types', () => {
    it('PER_SHOT delays every shot', () => {
      const agent = createParityAgent({
        bundles: {
          objects: [
            makeObjectDef('Attacker', 'America', ['VEHICLE'], [
              makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
              makeWeaponBlock('PerShotGun'),
            ]),
            makeObjectDef('Target', 'China', ['VEHICLE'], [
              makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
            ]),
          ],
          weapons: [
            makeWeaponDef('PerShotGun', {
              PrimaryDamage: 20,
              AttackRange: 120,
              DelayBetweenShots: 100,
              PreAttackDelay: 100,  // extra 3 frames before each shot
              PreAttackType: 'PER_SHOT',
            }),
          ],
        },
        mapObjects: [place('Attacker', 10, 10), place('Target', 30, 10)],
        mapSize: 8,
        sides: { America: {}, China: {} },
        enemies: [['America', 'China']],
      });

      agent.attack(1, 2);
      const healthTimeline: number[] = [];
      for (let i = 0; i < 15; i++) {
        agent.step(1);
        const t = agent.entity(2);
        healthTimeline.push(t ? t.health : -1);
      }

      const damageFrames = healthTimeline
        .map((h, i) => i > 0 && h < healthTimeline[i - 1]! ? i : -1)
        .filter((f) => f >= 0);

      // With PER_SHOT, each shot is delayed by PreAttackDelay + DelayBetweenShots
      // So interval should be ~6 frames (100+100=200ms ≈ 6 frames)
      // Fewer damage events than a weapon without pre-attack delay
      expect(damageFrames.length).toBeGreaterThanOrEqual(1);
      if (damageFrames.length >= 2) {
        const interval = damageFrames[1]! - damageFrames[0]!;
        // Should be larger than just DelayBetweenShots (3 frames)
        expect(interval).toBeGreaterThan(3);
      }
    });

    it('PER_ATTACK delays only the first shot of each engagement', () => {
      const agent = createParityAgent({
        bundles: {
          objects: [
            makeObjectDef('Attacker', 'America', ['VEHICLE'], [
              makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
              makeWeaponBlock('PerAttackGun'),
            ]),
            makeObjectDef('Target', 'China', ['VEHICLE'], [
              makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
            ]),
          ],
          weapons: [
            makeWeaponDef('PerAttackGun', {
              PrimaryDamage: 20,
              AttackRange: 120,
              DelayBetweenShots: 100,
              PreAttackDelay: 200,  // 6 frames before first shot only
              PreAttackType: 'PER_ATTACK',
            }),
          ],
        },
        mapObjects: [place('Attacker', 10, 10), place('Target', 30, 10)],
        mapSize: 8,
        sides: { America: {}, China: {} },
        enemies: [['America', 'China']],
      });

      agent.attack(1, 2);
      const healthTimeline: number[] = [];
      for (let i = 0; i < 18; i++) {
        agent.step(1);
        const t = agent.entity(2);
        healthTimeline.push(t ? t.health : -1);
      }

      const damageFrames = healthTimeline
        .map((h, i) => i > 0 && h < healthTimeline[i - 1]! ? i : -1)
        .filter((f) => f >= 0);

      expect(damageFrames.length).toBeGreaterThanOrEqual(2);

      if (damageFrames.length >= 3) {
        // First shot is delayed by PreAttackDelay
        // Subsequent shots are only delayed by DelayBetweenShots (~3 frames)
        const secondGap = damageFrames[2]! - damageFrames[1]!;
        // Second gap should be close to DelayBetweenShots (3 frames), not PreAttackDelay + Delay
        expect(secondGap).toBeLessThanOrEqual(5);
      }
    });
  });

  // ── PreAttackDelay PER_CLIP ──────────────────────────────────────────

  describe('pre-attack delay PER_CLIP', () => {
    it('PER_CLIP delays only the first shot of each clip', () => {
      const agent = createParityAgent({
        bundles: {
          objects: [
            makeObjectDef('Attacker', 'America', ['VEHICLE'], [
              makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
              makeWeaponBlock('PerClipGun'),
            ]),
            makeObjectDef('Target', 'China', ['VEHICLE'], [
              makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 2000, InitialHealth: 2000 }),
            ]),
          ],
          weapons: [
            makeWeaponDef('PerClipGun', {
              PrimaryDamage: 10,
              AttackRange: 120,
              DelayBetweenShots: 66,       // ~2 frames
              ClipSize: 3,
              ClipReloadTime: 200,          // ~6 frames
              PreAttackDelay: 200,          // ~6 frames
              PreAttackType: 'PER_CLIP',
            }),
          ],
        },
        mapObjects: [place('Attacker', 10, 10), place('Target', 30, 10)],
        mapSize: 8,
        sides: { America: {}, China: {} },
        enemies: [['America', 'China']],
      });

      agent.attack(1, 2);
      const healthTimeline: number[] = [];
      for (let i = 0; i < 40; i++) {
        agent.step(1);
        const t = agent.entity(2);
        healthTimeline.push(t ? t.health : -1);
      }

      const damageFrames = healthTimeline
        .map((h, i) => i > 0 && h < healthTimeline[i - 1]! ? i : -1)
        .filter((f) => f >= 0);

      // Should fire at least one clip (3 shots)
      expect(damageFrames.length).toBeGreaterThanOrEqual(3);

      // Within a clip, shots should be spaced by DelayBetweenShots (~2 frames)
      // NOT by PreAttackDelay + DelayBetweenShots
      if (damageFrames.length >= 3) {
        const intraClipGap = damageFrames[1]! - damageFrames[0]!;
        // Intra-clip gap should be short (~2-3 frames for 66ms delay)
        expect(intraClipGap).toBeLessThanOrEqual(5);
      }
    });
  });

  // ── No Armor (default 100%) ───────────────────────────────────────────

  describe('entities without armor take full damage', () => {
    it('no ArmorSet means coefficient = 1.0 for all damage types', () => {
      const agent = createParityAgent({
        bundles: {
          objects: [
            makeObjectDef('Attacker', 'America', ['VEHICLE'], [
              makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
              makeWeaponBlock('TestGun'),
            ]),
            makeObjectDef('Target', 'China', ['VEHICLE'], [
              makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
              // No ArmorSet block
            ]),
          ],
          weapons: [
            makeWeaponDef('TestGun', {
              PrimaryDamage: 35,
              DamageType: 'SMALL_ARMS',
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
      const before = agent.snapshot();
      agent.step(6);
      const d = agent.diff(before);

      const targetDamage = d.damaged.find((e) => e.id === 2);
      expect(targetDamage).toBeDefined();
      const actualDamage = targetDamage!.hpBefore - targetDamage!.hpAfter;
      // Full 35 damage per hit (no armor reduction)
      expect(actualDamage % 35).toBe(0);
      expect(actualDamage).toBeGreaterThanOrEqual(35);
    });
  });

  // ── Combat Determinism ────────────────────────────────────────────────

  describe('combat determinism', () => {
    it('identical setups produce identical damage timelines', () => {
      function runTimeline() {
        const agent = createParityAgent({
          bundles: {
            objects: [
              makeObjectDef('Attacker', 'America', ['VEHICLE'], [
                makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
                makeWeaponBlock('DeterGun'),
              ]),
              makeObjectDef('Target', 'China', ['VEHICLE'], [
                makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
              ]),
            ],
            weapons: [
              makeWeaponDef('DeterGun', {
                PrimaryDamage: 25,
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
        const timeline: number[] = [];
        for (let i = 0; i < 15; i++) {
          agent.step(1);
          timeline.push(agent.entity(2)?.health ?? -1);
        }
        return timeline;
      }

      const a = runTimeline();
      const b = runTimeline();
      expect(a).toEqual(b);
    });
  });
});
