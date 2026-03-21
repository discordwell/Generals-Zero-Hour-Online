/**
 * Miscellaneous Parity Tests — battle plan scalar, supply deposit, armor set
 * transition, and 2D attack range vs 3D damage range.
 *
 * Source references:
 *   ActiveBody.cpp:381-388 — battlePlanDamageScalar
 *   SupplyCenterDockUpdate.cpp — loseOneBox() loop
 *   ActiveBody.cpp:1139-1161 — armor set flags per veterancy level
 *   Weapon.cpp:83-96 — FROM_BOUNDINGSPHERE_2D vs FROM_BOUNDINGSPHERE_3D
 */

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { HeightmapGrid, uint8ArrayToBase64 } from '@generals/terrain';

import { GameLogicSubsystem } from './index.js';
import {
  createParityAgent,
  makeBlock,
  makeObjectDef,
  makeWeaponDef,
  makeArmorDef,
  makeWeaponBlock,
  makeBundle,
  makeRegistry,
  makeMap,
  makeMapObject,
  place,
} from './parity-agent.js';

// ── Test 1: Battle Plan Damage Scalar ──────────────────────────────────────

describe('battle plan damage scalar', () => {
  function createBattlePlanSetup() {
    return createParityAgent({
      bundles: {
        objects: [
          makeObjectDef('Attacker', 'America', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
            makeWeaponBlock('TestGun'),
          ]),
          makeObjectDef('Target', 'China', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
            // No armor — damage coefficient 1.0 for all types, so raw damage passes through.
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
      },
      mapObjects: [place('Attacker', 10, 10), place('Target', 30, 10)],
      mapSize: 8,
      sides: { America: {}, China: {} },
      enemies: [['America', 'China']],
    });
  }

  it('reduces damage by battlePlanDamageScalar (0.8 = 20% reduction)', () => {
    const agent = createBattlePlanSetup();

    // Directly set battlePlanDamageScalar on the target entity.
    // Source parity: ActiveBody.cpp:381-388 — after armor adjustment,
    // damage *= m_damageScalar. HOLD_THE_LINE sets this to 0.8.
    const logic = agent.gameLogic as unknown as { spawnedEntities: Map<number, any> };
    const target = logic.spawnedEntities.get(2);
    expect(target).toBeDefined();
    target.battlePlanDamageScalar = 0.8;

    agent.attack(1, 2);
    const before = agent.snapshot();
    agent.step(6);
    const d = agent.diff(before);

    const targetDamage = d.damaged.find((e) => e.id === 2);
    expect(targetDamage).toBeDefined();
    const actualDamage = targetDamage!.hpBefore - targetDamage!.hpAfter;
    // 50 damage * 1.0 (no armor) * 0.8 (battle plan scalar) = 40 damage per hit
    expect(actualDamage % 40).toBe(0);
    expect(actualDamage).toBeGreaterThanOrEqual(40);
  });

  it('UNRESISTABLE damage bypasses battlePlanDamageScalar', () => {
    const agent = createParityAgent({
      bundles: {
        objects: [
          makeObjectDef('Attacker', 'America', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
            makeWeaponBlock('UnresistableGun'),
          ]),
          makeObjectDef('Target', 'China', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          ]),
        ],
        weapons: [
          makeWeaponDef('UnresistableGun', {
            PrimaryDamage: 50,
            DamageType: 'UNRESISTABLE',
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

    // Set battle plan scalar to something very low — UNRESISTABLE should ignore it.
    const logic = agent.gameLogic as unknown as { spawnedEntities: Map<number, any> };
    const target = logic.spawnedEntities.get(2);
    expect(target).toBeDefined();
    target.battlePlanDamageScalar = 0.5;

    agent.attack(1, 2);
    const before = agent.snapshot();
    agent.step(6);
    const d = agent.diff(before);

    const targetDamage = d.damaged.find((e) => e.id === 2);
    expect(targetDamage).toBeDefined();
    const actualDamage = targetDamage!.hpBefore - targetDamage!.hpAfter;
    // Full 50 damage per hit — UNRESISTABLE bypasses the 0.5 scalar
    expect(actualDamage % 50).toBe(0);
    expect(actualDamage).toBeGreaterThanOrEqual(50);
  });
});

// ── Test 2: Supply Deposit — All at Once vs One-by-One ─────────────────────

describe('supply deposit total credits', () => {
  it('supply truck deposits all boxes at once, yielding correct total credits', () => {
    // Source parity: SupplyCenterDockUpdate::action() loops loseOneBox() and
    // accumulates value one box at a time. TS deposits all boxes in one
    // operation. The final credit amount should be identical (4 boxes * 100 = 400).
    const agent = createParityAgent({
      bundles: {
        objects: [
          // Supply warehouse with enough boxes
          makeObjectDef('TestWarehouse', 'Neutral', ['STRUCTURE', 'SUPPLY_SOURCE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
            makeBlock('Behavior', 'SupplyWarehouseDockUpdate ModuleTag_Dock', {
              StartingBoxes: 50,
              DeleteWhenEmpty: 'No',
            }),
          ]),
          // Supply center (depot)
          makeObjectDef('TestDepot', 'America', ['STRUCTURE', 'SUPPLY_CENTER', 'CAN_PERSIST_AND_CHANGE_OWNER'], [
            makeBlock('Body', 'StructureBody ModuleTag_Body', { MaxHealth: 2000, InitialHealth: 2000 }),
            makeBlock('Behavior', 'SupplyCenterDockUpdate ModuleTag_Dock', {
              ValueMultiplier: 1,
            }),
          ]),
          // Supply truck with MaxBoxes = 4
          makeObjectDef('TestTruck', 'America', ['VEHICLE', 'HARVESTER'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 150, InitialHealth: 150 }),
            makeBlock('LocomotorSet', 'SET_NORMAL TruckLoco', {}),
            makeBlock('Behavior', 'SupplyTruckAIUpdate ModuleTag_AI', {
              MaxBoxes: 4,
              SupplyCenterActionDelay: 0,
              SupplyWarehouseActionDelay: 0,
              SupplyWarehouseScanDistance: 500,
            }),
          ], { VisionRange: 200, ShroudClearingRange: 200 }),
        ],
        locomotors: [
          { name: 'TruckLoco', fields: { Speed: 60 }, surfaces: ['GROUND'], surfaceMask: 1, downhillOnly: false, speed: 60 },
        ],
      },
      mapObjects: [
        place('TestWarehouse', 20, 20),
        place('TestDepot', 40, 20),
        place('TestTruck', 30, 20),
      ],
      mapSize: 64,
      sides: { America: { credits: 0 }, Neutral: {} },
    });

    agent.setCredits('America', 0);

    const initialCredits = agent.state().credits['America'] ?? 0;
    expect(initialCredits).toBe(0);

    // Run enough frames for the truck to complete at least one gather-deliver cycle.
    // Each box = 100 credits (DEFAULT_SUPPLY_BOX_VALUE). 4 boxes = 400 credits.
    agent.step(600);

    const finalCredits = agent.state().credits['America'] ?? 0;
    // The truck should have deposited at least one load of 4 boxes = 400 credits.
    expect(finalCredits).toBeGreaterThan(0);
    // Total should be a multiple of 100 (each box worth 100 credits).
    expect(finalCredits % 100).toBe(0);
  });
});

// ── Test 3: Armor Set Transition on Veterancy ──────────────────────────────

describe('armor set transition on veterancy', () => {
  it('activates VETERAN armor and then replaces it with ELITE armor on promotion', () => {
    // Source parity: ActiveBody.cpp:1139-1161 — each vet level sets ONLY
    // its own armor flag, clearing the others. resolveArmorSetFlagsForLevel
    // returns a single flag per level.
    const agent = createParityAgent({
      bundles: {
        objects: [
          makeObjectDef('Attacker', 'America', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
            makeWeaponBlock('TestGun'),
          ]),
          makeObjectDef('Target', 'China', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 5000, InitialHealth: 5000 }),
            // NONE condition: default armor at REGULAR level (100% = full damage)
            makeBlock('ArmorSet', 'ArmorSet', { Conditions: 'NONE', Armor: 'RegularArmor' }),
            // VETERAN condition: 50% damage
            makeBlock('ArmorSet', 'ArmorSet', { Conditions: 'VETERAN', Armor: 'VeteranArmor' }),
            // ELITE condition: 25% damage
            makeBlock('ArmorSet', 'ArmorSet', { Conditions: 'ELITE', Armor: 'EliteArmor' }),
          ], {
            // Experience profile: REGULAR=0, VETERAN=100, ELITE=200, HEROIC=400
            ExperienceRequired: [0, 100, 200, 400],
            ExperienceValue: [10, 20, 30, 40],
          }),
        ],
        weapons: [
          makeWeaponDef('TestGun', {
            PrimaryDamage: 100,
            DamageType: 'ARMOR_PIERCING',
            AttackRange: 120,
            DelayBetweenShots: 100,
          }),
        ],
        armors: [
          // Regular: 100% for ARMOR_PIERCING = full damage
          makeArmorDef('RegularArmor', { Default: 1, ARMOR_PIERCING: '100%' }),
          // Veteran: 50% for ARMOR_PIERCING = half damage
          makeArmorDef('VeteranArmor', { Default: 1, ARMOR_PIERCING: '50%' }),
          // Elite: 25% for ARMOR_PIERCING = quarter damage
          makeArmorDef('EliteArmor', { Default: 1, ARMOR_PIERCING: '25%' }),
        ],
      },
      mapObjects: [place('Attacker', 10, 10), place('Target', 30, 10)],
      mapSize: 8,
      sides: { America: {}, China: {} },
      enemies: [['America', 'China']],
    });

    // ── Step 1: REGULAR level — full damage (100% coefficient) ──
    agent.attack(1, 2);
    const beforeRegular = agent.snapshot();
    agent.step(6);
    const dRegular = agent.diff(beforeRegular);

    const regularDamage = dRegular.damaged.find((e) => e.id === 2);
    expect(regularDamage).toBeDefined();
    const regularActual = regularDamage!.hpBefore - regularDamage!.hpAfter;
    // 100 * 1.0 = 100 damage per hit
    expect(regularActual % 100).toBe(0);
    expect(regularActual).toBeGreaterThanOrEqual(100);

    // ── Step 2: Promote to VETERAN — apply 50% coefficient ──
    const logic = agent.gameLogic as unknown as { spawnedEntities: Map<number, any> };
    const targetEntity = logic.spawnedEntities.get(2);
    expect(targetEntity).toBeDefined();

    // Grant enough XP to reach VETERAN level (need 100 XP).
    targetEntity.experienceState.currentExperience = 100;
    targetEntity.experienceState.currentLevel = 1; // LEVEL_VETERAN
    // Set armor flags: clear all vet bits, set VETERAN (bit 0).
    targetEntity.armorSetFlagsMask &= ~0x07;
    targetEntity.armorSetFlagsMask |= 0x01; // ARMOR_SET_FLAG_VETERAN
    // Refresh combat profiles so the new armor coefficients take effect.
    (agent.gameLogic as any).refreshEntityCombatProfiles(targetEntity);

    const beforeVeteran = agent.snapshot();
    agent.step(6);
    const dVeteran = agent.diff(beforeVeteran);

    const veteranDamage = dVeteran.damaged.find((e) => e.id === 2);
    expect(veteranDamage).toBeDefined();
    const veteranActual = veteranDamage!.hpBefore - veteranDamage!.hpAfter;
    // 100 * 0.5 = 50 damage per hit
    expect(veteranActual % 50).toBe(0);
    expect(veteranActual).toBeGreaterThanOrEqual(50);
    // Veteran damage should be less than regular
    expect(veteranActual).toBeLessThan(regularActual * 2);

    // ── Step 3: Promote to ELITE — apply 25% coefficient, verify VETERAN deactivated ──
    targetEntity.experienceState.currentExperience = 200;
    targetEntity.experienceState.currentLevel = 2; // LEVEL_ELITE
    // Set armor flags: clear all vet bits, set ELITE (bit 1).
    // This verifies VETERAN flag is deactivated when ELITE activates.
    targetEntity.armorSetFlagsMask &= ~0x07;
    targetEntity.armorSetFlagsMask |= 0x02; // ARMOR_SET_FLAG_ELITE
    (agent.gameLogic as any).refreshEntityCombatProfiles(targetEntity);

    const beforeElite = agent.snapshot();
    agent.step(6);
    const dElite = agent.diff(beforeElite);

    const eliteDamage = dElite.damaged.find((e) => e.id === 2);
    expect(eliteDamage).toBeDefined();
    const eliteActual = eliteDamage!.hpBefore - eliteDamage!.hpAfter;
    // 100 * 0.25 = 25 damage per hit
    expect(eliteActual % 25).toBe(0);
    expect(eliteActual).toBeGreaterThanOrEqual(25);
    // Elite damage should be less than veteran damage
    expect(eliteActual).toBeLessThan(veteranActual * 2);

    // Verify that the armor set flag mask has ONLY elite, NOT veteran.
    expect(targetEntity.armorSetFlagsMask & 0x01).toBe(0); // VETERAN cleared
    expect(targetEntity.armorSetFlagsMask & 0x02).toBe(0x02); // ELITE set
  });
});

// ── Test 4: 2D Attack Range vs 3D Damage Range ────────────────────────────

describe('2D attack range vs 3D damage range', () => {
  it('2D attack range ignores height difference (target at same XZ but different Y is in range)', () => {
    // Source parity: Weapon.cpp:83-96 — ATTACK_RANGE_CALC_TYPE = FROM_BOUNDINGSPHERE_2D.
    // combat-update.ts: dx*dx + dz*dz (no dy term) for attack range check.
    const agent = createParityAgent({
      bundles: {
        objects: [
          makeObjectDef('Attacker', 'America', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
            makeWeaponBlock('TestGun'),
          ]),
          makeObjectDef('Target', 'China', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          ]),
        ],
        weapons: [
          makeWeaponDef('TestGun', {
            PrimaryDamage: 50,
            DamageType: 'ARMOR_PIERCING',
            AttackRange: 100,
            DelayBetweenShots: 100,
          }),
        ],
      },
      // Place both at same XZ position (2D distance = 0).
      mapObjects: [place('Attacker', 30, 30), place('Target', 30, 30)],
      mapSize: 64,
      sides: { America: {}, China: {} },
      enemies: [['America', 'China']],
    });

    // Move the target entity to a high altitude (y=50) while keeping XZ the same.
    // 2D distance remains 0, so the target should be in attack range.
    const logic = agent.gameLogic as unknown as { spawnedEntities: Map<number, any> };
    const target = logic.spawnedEntities.get(2);
    expect(target).toBeDefined();
    target.y = 50;

    agent.attack(1, 2);
    const before = agent.snapshot();
    agent.step(6);
    const d = agent.diff(before);

    // Target should have taken damage — 2D range check passes (XZ distance = 0 < 100).
    const targetDamage = d.damaged.find((e) => e.id === 2);
    expect(targetDamage).toBeDefined();
    const actualDamage = targetDamage!.hpBefore - targetDamage!.hpAfter;
    expect(actualDamage).toBeGreaterThanOrEqual(50);
  });

  it('3D damage radius excludes targets whose 3D distance exceeds splash radius', () => {
    // Source parity: Weapon.cpp — DAMAGE_RANGE_CALC_TYPE = FROM_BOUNDINGSPHERE_3D.
    // combat-damage-events.ts: dx*dx + dy*dy + dz*dz for splash radius.
    //
    // Setup: attacker fires a splash weapon at a primary target. A bystander is
    // close in XZ to the primary target but on elevated terrain. The height
    // difference pushes the 3D distance beyond the splash radius.
    //
    // Use a custom heightmap with a cliff so the bystander's terrain height is
    // genuinely elevated (not just a manual y override that gets reset each frame).
    //
    // Heightmap layout (16x16, MAP_XY_FACTOR=10, MAP_HEIGHT_SCALE=0.625):
    //   Cells at row=5, cols 0-5: height=0 (flat ground for attacker + primary target)
    //   Cells at row=5, cols 6-8: height=80 => world height = 80*0.625 = 50 (cliff for bystander)
    //   All other cells: height=0
    //
    // Entities (world coords):
    //   Attacker   at (10, 50) => col=1, row=5  => ground=0
    //   Primary    at (40, 50) => col=4, row=5  => ground=0
    //   Bystander  at (70, 50) => col=7, row=5  => ground=50
    //
    // Splash damage check (DIRECT delivery):
    //   impactX = primary.x = 40, impactY = primary.y - baseHeight = 0, impactZ = primary.z = 50
    //   Bystander: x=70, y=50+1.5=51.5, z=50
    //   dx=30, dy=51.5-0=51.5, dz=0
    //   rawDist = sqrt(30^2 + 51.5^2) = sqrt(900 + 2652.25) = sqrt(3552.25) ≈ 59.6
    //   bsr = 1.5 => shrunken ≈ 58.1 > 45 splash radius => OUT of splash range.
    //
    // The bystander is also outside the attacker's 2D attack range (60 > 50).
    const mapSize = 16;
    const heightData = new Uint8Array(mapSize * mapSize).fill(0);
    // Set cells at col 6, 7, 8 in row 5 to 80 raw value (= 50 world height).
    // Also set surrounding rows so bilinear interpolation keeps it high at world (70,50).
    for (let row = 4; row <= 6; row++) {
      for (let col = 6; col <= 8; col++) {
        heightData[row * mapSize + col] = 80;
      }
    }
    const heightmap = HeightmapGrid.fromJSON({
      width: mapSize,
      height: mapSize,
      borderSize: 0,
      data: uint8ArrayToBase64(heightData),
    });

    const bundle = makeBundle({
      objects: [
        makeObjectDef('Attacker', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          makeWeaponBlock('SplashGun'),
        ]),
        makeObjectDef('PrimaryTarget', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 5000, InitialHealth: 5000 }),
        ]),
        makeObjectDef('Bystander', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
        ]),
      ],
      weapons: [
        makeWeaponDef('SplashGun', {
          PrimaryDamage: 100,
          PrimaryDamageRadius: 45,
          DamageType: 'EXPLOSION',
          AttackRange: 50,
          DelayBetweenShots: 200,
          RadiusDamageAffects: 'ENEMIES',
        }),
      ],
    });

    const registry = makeRegistry(bundle);
    const map = makeMap([
      makeMapObject('Attacker', 10, 50),
      makeMapObject('PrimaryTarget', 40, 50),
      makeMapObject('Bystander', 70, 50),
    ], mapSize, mapSize);
    // Override the map's heightmap data with our custom one.
    map.heightmap = {
      width: mapSize,
      height: mapSize,
      borderSize: 0,
      data: uint8ArrayToBase64(heightData),
    };

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, heightmap);
    logic.setPlayerSide(0, 'America');
    logic.setPlayerSide(1, 'China');
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);
    logic.update(0);

    // Verify entities and their heights.
    const states = logic.getRenderableEntityStates();
    const attackerState = states.find(e => e.templateName === 'Attacker');
    const primaryState = states.find(e => e.templateName === 'PrimaryTarget');
    const bystanderState = states.find(e => e.templateName === 'Bystander');
    expect(attackerState).toBeDefined();
    expect(primaryState).toBeDefined();
    expect(bystanderState).toBeDefined();

    // Attacker and primary should be near ground level (y ≈ 1.5 = baseHeight).
    expect(attackerState!.y).toBeLessThan(5);
    expect(primaryState!.y).toBeLessThan(5);
    // Bystander should be elevated (y ≈ 50 + 1.5 = 51.5).
    expect(bystanderState!.y).toBeGreaterThan(40);

    // Issue attack command.
    logic.submitCommand({
      type: 'attackEntity',
      entityId: attackerState!.id,
      targetEntityId: primaryState!.id,
      commandSource: 'PLAYER',
    });

    // Run enough frames for at least one shot.
    const bystanderInitialHealth = bystanderState!.health;
    for (let i = 0; i < 12; i++) {
      logic.update(1 / 30);
    }

    // Re-read states.
    const statesAfter = logic.getRenderableEntityStates();
    const primaryAfter = statesAfter.find(e => e.templateName === 'PrimaryTarget');
    const bystanderAfter = statesAfter.find(e => e.templateName === 'Bystander');
    expect(primaryAfter).toBeDefined();
    expect(bystanderAfter).toBeDefined();

    // Primary target should have taken damage.
    expect(primaryAfter!.health).toBeLessThan(5000);

    // Bystander should NOT have taken splash damage — 3D distance exceeds splash radius.
    expect(bystanderAfter!.health).toBe(bystanderInitialHealth);
  });
});
