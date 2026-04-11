import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { GameLogicSubsystem } from './index.js';
import {
  makeBlock,
  makeObjectDef,
  makeWeaponDef,
  makeArmorDef,
  makeLocomotorDef,
  makeUpgradeDef,
  makeCommandButtonDef,
  makeCommandSetDef,
  makeScienceDef,
  makeAudioEventDef,
  makeSpecialPowerDef,
  makeBundle,
  makeRegistry,
  makeHeightmap,
  makeMap,
  makeMapObject,
  makeInputState,
} from './test-helpers.js';

describe('construction progress', () => {
  function makeConstructionSetup(buildTimeSeconds = 2) {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('USADozer', 'America', ['VEHICLE', 'DOZER'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
        ], {
          GeometryMajorRadius: 5,
          GeometryMinorRadius: 5,
          Speed: 30,
        }),
        makeObjectDef('USAPowerPlant', 'America', ['STRUCTURE', 'MP_COUNT_FOR_VICTORY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
        ], {
          BuildCost: 500,
          BuildTime: buildTimeSeconds,
          EnergyProduction: 10,
          GeometryMajorRadius: 10,
          GeometryMinorRadius: 10,
        }),
      ],
      locomotors: [makeLocomotorDef('DozerLocomotor', 30)],
    });

    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('USADozer', 16, 16)], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );
    logic.submitCommand({ type: 'setSideCredits', side: 'America', amount: 2000 });
    logic.update(1 / 30); // Process credits

    return { logic, scene };
  }

  it('building starts under construction with 0% and health=1 when dozer places it', () => {
    const { logic } = makeConstructionSetup(2);

    // Issue construct command — dozer at (16,16) builds at (20,20).
    logic.submitCommand({
      type: 'constructBuilding',
      entityId: 1,
      templateName: 'USAPowerPlant',
      targetPosition: [20, 0, 20],
      angle: 0,
      lineEndPosition: null,
    });
    logic.update(1 / 30);

    // Building should exist with UNDER_CONSTRUCTION.
    const building = logic.getEntityState(2);
    expect(building).not.toBeNull();
    expect(building!.statusFlags).toContain('UNDER_CONSTRUCTION');
    expect(building!.constructionPercent).toBeGreaterThanOrEqual(0);
    expect(building!.constructionPercent).toBeLessThan(100);
    expect(building!.health).toBeLessThan(building!.maxHealth);

    // Credits should be deducted immediately.
    expect(logic.getSideCredits('America')).toBe(1500);
  });

  it('building completes construction after BuildTime seconds of dozer proximity', () => {
    const { logic } = makeConstructionSetup(1); // 1 second = 30 frames

    logic.submitCommand({
      type: 'constructBuilding',
      entityId: 1,
      templateName: 'USAPowerPlant',
      targetPosition: [18, 0, 18], // Close to dozer at (16,16)
      angle: 0,
      lineEndPosition: null,
    });

    // Run for 31 frames (1 second + margin) — first frame places the building.
    for (let i = 0; i < 31; i++) {
      logic.update(1 / 30);
    }

    const building = logic.getEntityState(2);
    expect(building).not.toBeNull();
    expect(building!.statusFlags).not.toContain('UNDER_CONSTRUCTION');
    expect(building!.constructionPercent).toBe(-1); // CONSTRUCTION_COMPLETE
    expect(building!.health).toBe(building!.maxHealth);
  });

  it('building does not gain energy until construction completes', () => {
    const { logic } = makeConstructionSetup(1);

    logic.submitCommand({
      type: 'constructBuilding',
      entityId: 1,
      templateName: 'USAPowerPlant',
      targetPosition: [18, 0, 18],
      angle: 0,
      lineEndPosition: null,
    });
    logic.update(1 / 30); // Place building

    // During construction, energy should not be contributed.
    const powerDuring = logic.getSidePowerState('America');
    expect(powerDuring.energyProduction).toBe(0);

    // Complete construction.
    for (let i = 0; i < 31; i++) {
      logic.update(1 / 30);
    }

    // After completion, energy should be registered.
    const powerAfter = logic.getSidePowerState('America');
    expect(powerAfter.energyProduction).toBe(10);
  });

  it('building under construction cannot attack', () => {
    const weaponBlock = makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'GatlingCannon'] });
    const bundle = makeBundle({
      objects: [
        makeObjectDef('USADozer', 'America', ['VEHICLE', 'DOZER'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
        ], { GeometryMajorRadius: 5, GeometryMinorRadius: 5 }),
        makeObjectDef('USADefense', 'America', ['STRUCTURE', 'MP_COUNT_FOR_VICTORY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          weaponBlock,
        ], { BuildCost: 300, BuildTime: 2, GeometryMajorRadius: 10, GeometryMinorRadius: 10 }),
        makeObjectDef('ChinaTank', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ]),
      ],
      weapons: [makeWeaponDef('GatlingCannon', {
        AttackRange: 100, PrimaryDamage: 10, PrimaryDamageRadius: 0,
        DamageType: 'ARMOR_PIERCING', DeathType: 'NORMAL', DelayBetweenShots: 100,
      })],
    });

    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('USADozer', 16, 16), makeMapObject('ChinaTank', 20, 20)], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );
    logic.submitCommand({ type: 'setSideCredits', side: 'America', amount: 1000 });
    logic.setTeamRelationship('America', 'China', 0); // enemies
    logic.setTeamRelationship('China', 'America', 0);

    // Build the defense structure.
    logic.submitCommand({
      type: 'constructBuilding',
      entityId: 1,
      templateName: 'USADefense',
      targetPosition: [18, 0, 18],
      angle: 0,
      lineEndPosition: null,
    });

    // Run a few frames — building is under construction.
    for (let i = 0; i < 5; i++) {
      logic.update(1 / 30);
    }

    const building = logic.getEntityState(3); // building is entity 3 (dozer=1, tank=2)
    expect(building).not.toBeNull();
    expect(building!.statusFlags).toContain('UNDER_CONSTRUCTION');

    // Tank should NOT be under attack from the building under construction.
    const tank = logic.getEntityState(2);
    expect(tank).not.toBeNull();
    expect(tank!.health).toBe(100); // Full health — not attacked.
  });

  it('dozer interrupted during construction leaves building partially built', () => {
    const { logic } = makeConstructionSetup(2); // 2 seconds = 60 frames

    logic.submitCommand({
      type: 'constructBuilding',
      entityId: 1,
      templateName: 'USAPowerPlant',
      targetPosition: [18, 0, 18],
      angle: 0,
      lineEndPosition: null,
    });

    // Build for 15 frames (~25%).
    for (let i = 0; i < 15; i++) {
      logic.update(1 / 30);
    }

    const buildingMid = logic.getEntityState(2);
    expect(buildingMid).not.toBeNull();
    expect(buildingMid!.statusFlags).toContain('UNDER_CONSTRUCTION');
    const midPercent = buildingMid!.constructionPercent;
    expect(midPercent).toBeGreaterThan(0);
    expect(midPercent).toBeLessThan(100);

    // Interrupt: order dozer to move elsewhere.
    logic.submitCommand({ type: 'moveTo', entityId: 1, targetX: 50, targetZ: 50 });
    logic.update(1 / 30);

    // Building should still be under construction at the same percent.
    const buildingAfter = logic.getEntityState(2);
    expect(buildingAfter).not.toBeNull();
    expect(buildingAfter!.statusFlags).toContain('UNDER_CONSTRUCTION');
    expect(buildingAfter!.constructionPercent).toBeCloseTo(midPercent, 0);
  });

  it('cancel construction refunds full cost and destroys building', () => {
    const { logic } = makeConstructionSetup(2);

    logic.submitCommand({
      type: 'constructBuilding',
      entityId: 1,
      templateName: 'USAPowerPlant',
      targetPosition: [18, 0, 18],
      angle: 0,
      lineEndPosition: null,
    });
    logic.update(1 / 30);

    expect(logic.getSideCredits('America')).toBe(1500); // Deducted 500.

    // Cancel the construction.
    logic.submitCommand({ type: 'cancelDozerConstruction', entityId: 2 });
    logic.update(1 / 30);

    // Full cost refunded.
    expect(logic.getSideCredits('America')).toBe(2000);

    // Building should be destroyed.
    const building = logic.getEntityState(2);
    expect(building).toBeNull();
  });

  it('sell on an under-construction building normalizes to cancel construction', () => {
    const { logic } = makeConstructionSetup(2);

    logic.submitCommand({
      type: 'constructBuilding',
      entityId: 1,
      templateName: 'USAPowerPlant',
      targetPosition: [18, 0, 18],
      angle: 0,
      lineEndPosition: null,
    });
    logic.update(1 / 30);

    expect(logic.getSideCredits('America')).toBe(1500);
    expect(logic.getEntityState(2)?.statusFlags).toContain('UNDER_CONSTRUCTION');

    logic.submitCommand({ type: 'sell', entityId: 2 });
    logic.update(1 / 30);

    expect(logic.getSideCredits('America')).toBe(2000);
    expect(logic.getEntityState(2)).toBeNull();

    // The same dozer should be free to start a new construction immediately.
    logic.submitCommand({
      type: 'constructBuilding',
      entityId: 1,
      templateName: 'USAPowerPlant',
      targetPosition: [26, 0, 18],
      angle: 0,
      lineEndPosition: null,
    });
    logic.update(1 / 30);

    expect(logic.getSideCredits('America')).toBe(1500);
    expect(logic.getEntityState(3)?.statusFlags).toContain('UNDER_CONSTRUCTION');
  });

  it('another dozer can resume partially built construction', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('USADozer', 'America', ['VEHICLE', 'DOZER'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
        ], { GeometryMajorRadius: 5, GeometryMinorRadius: 5 }),
        makeObjectDef('USAPowerPlant', 'America', ['STRUCTURE', 'MP_COUNT_FOR_VICTORY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
        ], { BuildCost: 500, BuildTime: 2, GeometryMajorRadius: 10, GeometryMinorRadius: 10 }),
      ],
    });

    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('USADozer', 14, 14), makeMapObject('USADozer', 30, 30)], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );
    logic.submitCommand({ type: 'setSideCredits', side: 'America', amount: 2000 });
    logic.update(1 / 30);

    // Dozer 1 starts building.
    logic.submitCommand({
      type: 'constructBuilding',
      entityId: 1,
      templateName: 'USAPowerPlant',
      targetPosition: [16, 0, 16],
      angle: 0,
      lineEndPosition: null,
    });

    // Build for 15 frames.
    for (let i = 0; i < 15; i++) {
      logic.update(1 / 30);
    }

    // Interrupt dozer 1.
    logic.submitCommand({ type: 'moveTo', entityId: 1, targetX: 50, targetZ: 50 });
    logic.update(1 / 30);

    const buildingMid = logic.getEntityState(3);
    expect(buildingMid).not.toBeNull();
    expect(buildingMid!.statusFlags).toContain('UNDER_CONSTRUCTION');
    const midPercent = buildingMid!.constructionPercent;

    // Dozer 2 resumes construction (via repair command on partially built building).
    logic.submitCommand({ type: 'repairBuilding', entityId: 2, targetBuildingId: 3 });

    // Run enough frames for dozer 2 to reach the building and complete it.
    for (let i = 0; i < 60; i++) {
      logic.update(1 / 30);
    }

    const buildingFinal = logic.getEntityState(3);
    expect(buildingFinal).not.toBeNull();
    expect(buildingFinal!.statusFlags).not.toContain('UNDER_CONSTRUCTION');
    expect(buildingFinal!.constructionPercent).toBe(-1);
    expect(buildingFinal!.health).toBe(500);
  });

  it('retasks build -> repair by releasing construction ownership', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('USADozer', 'America', ['VEHICLE', 'DOZER'], [
          makeBlock('Behavior', 'DozerAIUpdate ModuleTag_DozerAI', {
            RepairHealthPercentPerSecond: '20%',
            BoredTime: 999999,
            BoredRange: 300,
          }),
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
        ], { GeometryMajorRadius: 5, GeometryMinorRadius: 5 }),
        makeObjectDef('USABarracks', 'America', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 250 }),
        ], { GeometryMajorRadius: 10, GeometryMinorRadius: 10 }),
        makeObjectDef('USAPowerPlant', 'America', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
        ], { BuildCost: 300, BuildTime: 2, GeometryMajorRadius: 10, GeometryMinorRadius: 10 }),
      ],
    });

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([
        makeMapObject('USADozer', 20, 20), // id 1
        makeMapObject('USABarracks', 24, 20), // id 2
      ], 96, 96),
      makeRegistry(bundle),
      makeHeightmap(96, 96),
    );
    logic.submitCommand({ type: 'setSideCredits', side: 'America', amount: 1000 });
    logic.update(0);

    const priv = logic as unknown as {
      pendingConstructionActions: Map<number, number>;
      pendingRepairActions: Map<number, number>;
      spawnedEntities: Map<number, { builderId: number }>;
    };

    logic.submitCommand({
      type: 'constructBuilding',
      entityId: 1,
      templateName: 'USAPowerPlant',
      targetPosition: [60, 0, 60],
      angle: 0,
      lineEndPosition: null,
    });
    logic.update(1 / 30);

    const constructedId = priv.pendingConstructionActions.get(1);
    expect(constructedId).toBeDefined();
    expect(priv.spawnedEntities.get(constructedId!)?.builderId).toBe(1);

    logic.submitCommand({ type: 'repairBuilding', entityId: 1, targetBuildingId: 2 });
    logic.update(0);

    expect(priv.pendingConstructionActions.has(1)).toBe(false);
    expect(priv.spawnedEntities.get(constructedId!)?.builderId).toBe(0);
    expect(priv.pendingRepairActions.get(1)).toBe(2);
  });

  it('retasks repair -> build by clearing pending repair target', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('USADozer', 'America', ['VEHICLE', 'DOZER'], [
          makeBlock('Behavior', 'DozerAIUpdate ModuleTag_DozerAI', {
            RepairHealthPercentPerSecond: '20%',
            BoredTime: 999999,
            BoredRange: 300,
          }),
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
        ], { GeometryMajorRadius: 5, GeometryMinorRadius: 5 }),
        makeObjectDef('USABarracks', 'America', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 250 }),
        ], { GeometryMajorRadius: 10, GeometryMinorRadius: 10 }),
        makeObjectDef('USAPowerPlant', 'America', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
        ], { BuildCost: 300, BuildTime: 2, GeometryMajorRadius: 10, GeometryMinorRadius: 10 }),
      ],
    });

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([
        makeMapObject('USADozer', 20, 20), // id 1
        makeMapObject('USABarracks', 24, 20), // id 2
      ], 96, 96),
      makeRegistry(bundle),
      makeHeightmap(96, 96),
    );
    logic.submitCommand({ type: 'setSideCredits', side: 'America', amount: 1000 });
    logic.update(0);

    const priv = logic as unknown as {
      pendingConstructionActions: Map<number, number>;
      pendingRepairActions: Map<number, number>;
    };

    logic.submitCommand({ type: 'repairBuilding', entityId: 1, targetBuildingId: 2 });
    logic.update(0);
    expect(priv.pendingRepairActions.get(1)).toBe(2);

    logic.submitCommand({
      type: 'constructBuilding',
      entityId: 1,
      templateName: 'USAPowerPlant',
      targetPosition: [60, 0, 60],
      angle: 0,
      lineEndPosition: null,
    });
    logic.update(0);

    expect(priv.pendingRepairActions.has(1)).toBe(false);
    expect(priv.pendingConstructionActions.has(1)).toBe(true);
  });

  it('retasks build -> build by clearing previous builder assignment', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('USADozer', 'America', ['VEHICLE', 'DOZER'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
        ], { GeometryMajorRadius: 5, GeometryMinorRadius: 5 }),
        makeObjectDef('USAPowerPlant', 'America', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
        ], { BuildCost: 300, BuildTime: 3, GeometryMajorRadius: 10, GeometryMinorRadius: 10 }),
      ],
    });

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([makeMapObject('USADozer', 20, 20)], 96, 96),
      makeRegistry(bundle),
      makeHeightmap(96, 96),
    );
    logic.submitCommand({ type: 'setSideCredits', side: 'America', amount: 1000 });
    logic.update(0);

    const priv = logic as unknown as {
      pendingConstructionActions: Map<number, number>;
      spawnedEntities: Map<number, { builderId: number }>;
    };

    logic.submitCommand({
      type: 'constructBuilding',
      entityId: 1,
      templateName: 'USAPowerPlant',
      targetPosition: [32, 0, 20],
      angle: 0,
      lineEndPosition: null,
    });
    logic.update(0);

    const firstBuildingId = priv.pendingConstructionActions.get(1);
    expect(firstBuildingId).toBeDefined();
    expect(priv.spawnedEntities.get(firstBuildingId!)?.builderId).toBe(1);

    logic.submitCommand({
      type: 'constructBuilding',
      entityId: 1,
      templateName: 'USAPowerPlant',
      targetPosition: [60, 0, 60],
      angle: 0,
      lineEndPosition: null,
    });
    logic.update(0);

    const secondBuildingId = priv.pendingConstructionActions.get(1);
    expect(secondBuildingId).toBeDefined();
    expect(secondBuildingId).not.toBe(firstBuildingId);
    expect(priv.spawnedEntities.get(firstBuildingId!)?.builderId).toBe(0);
    expect(priv.spawnedEntities.get(secondBuildingId!)?.builderId).toBe(1);
  });
});

describe('GrantUpgradeCreate', () => {
  it('grants object upgrade on creation when not under construction', () => {
    const building = makeObjectDef('AmericaPowerPlant', 'America', ['STRUCTURE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
      makeBlock('Behavior', 'GrantUpgradeCreate ModuleTag_GUC', {
        UpgradeToGrant: 'Upgrade_AmericaPower',
        ExemptStatus: 'UNDER_CONSTRUCTION',
      }),
    ]);

    const bundle = makeBundle({ objects: [building] });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('AmericaPowerPlant', 5, 5)]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.update(0);

    const priv = logic as unknown as { spawnedEntities: Map<number, MapEntity> };
    const entity = priv.spawnedEntities.get(1)!;

    // Map-placed entities are not under construction, so upgrade should be granted immediately.
    expect(entity.completedUpgrades.has('UPGRADE_AMERICAPOWER')).toBe(true);
  });

  it('does not grant upgrade during construction, grants on build complete', () => {
    // Place a building directly but mark it under construction, then complete it.
    const building = makeObjectDef('AmericaPowerPlant2', 'America', ['STRUCTURE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
      makeBlock('Behavior', 'GrantUpgradeCreate ModuleTag_GUC', {
        UpgradeToGrant: 'Upgrade_Power2',
        ExemptStatus: 'UNDER_CONSTRUCTION',
      }),
    ]);

    const bundle = makeBundle({ objects: [building] });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('AmericaPowerPlant2', 5, 5)]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.update(0);

    const priv = logic as unknown as { spawnedEntities: Map<number, MapEntity> };
    const entity = priv.spawnedEntities.get(1)!;

    // When placed from map, it's not under construction → upgrade already granted on creation.
    expect(entity.completedUpgrades.has('UPGRADE_POWER2')).toBe(true);

    // Now simulate a building that starts under construction:
    // Clear the upgrade and set UNDER_CONSTRUCTION, then call completeConstruction.
    entity.completedUpgrades.delete('UPGRADE_POWER2');
    entity.objectStatusFlags.add('UNDER_CONSTRUCTION');
    // The upgrade should NOT be present.
    expect(entity.completedUpgrades.has('UPGRADE_POWER2')).toBe(false);

    // Trigger completeConstruction via the private method.
    (logic as any).completeConstruction(entity);
    // Now the upgrade should be re-granted.
    expect(entity.completedUpgrades.has('UPGRADE_POWER2')).toBe(true);
  });
});

describe('LockWeaponCreate', () => {
  it('extracts weapon slot lock from INI and applies on creation', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('LockedUnit', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          makeBlock('Behavior', 'LockWeaponCreate ModuleTag_LWC', {
            SlotToLock: 'SECONDARY_WEAPON',
          }),
        ]),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(makeMap([makeMapObject('LockedUnit', 50, 50)]), makeRegistry(bundle), makeHeightmap());
    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        lockWeaponCreateSlot: number | null;
        forcedWeaponSlot: number | null;
        weaponLockStatus: string;
      }>;
    };
    const entity = priv.spawnedEntities.get(1)!;
    expect(entity.lockWeaponCreateSlot).toBe(1); // SECONDARY_WEAPON
    expect(entity.forcedWeaponSlot).toBe(1);
    expect(entity.weaponLockStatus).toBe('LOCKED_PERMANENTLY');
  });

  it('locks PRIMARY_WEAPON by default', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('LockedUnit', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          makeBlock('Behavior', 'LockWeaponCreate ModuleTag_LWC', {
            SlotToLock: 'PRIMARY_WEAPON',
          }),
        ]),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(makeMap([makeMapObject('LockedUnit', 50, 50)]), makeRegistry(bundle), makeHeightmap());
    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        forcedWeaponSlot: number | null;
        weaponLockStatus: string;
      }>;
    };
    const entity = priv.spawnedEntities.get(1)!;
    expect(entity.forcedWeaponSlot).toBe(0); // PRIMARY_WEAPON
    expect(entity.weaponLockStatus).toBe('LOCKED_PERMANENTLY');
  });
});

describe('ExperienceScalarUpgrade', () => {
  it('adds XP scalar on upgrade application', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('ScalarUnit', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          makeBlock('Behavior', 'ExperienceScalarUpgrade ModuleTag_XPScalar', {
            TriggeredBy: 'Upgrade_XPBoost',
            AddXPScalar: 0.5,
          }),
        ], {
          ExperienceRequired: '100 200 400',
          ExperienceValue: 50,
        }),
      ],
      upgrades: [makeUpgradeDef('Upgrade_XPBoost', { Type: 'PLAYER', BuildTime: 0.1, BuildCost: 0 })],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(makeMap([makeMapObject('ScalarUnit', 100, 100)]), makeRegistry(bundle), makeHeightmap());
    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        experienceState: { experienceScalar: number };
      }>;
    };
    const entity = priv.spawnedEntities.get(1)!;

    // Before upgrade: scalar should be 1.0 (default).
    expect(entity.experienceState.experienceScalar).toBe(1.0);

    // Apply upgrade.
    logic.submitCommand({ type: 'applyUpgrade', entityId: 1, upgradeName: 'Upgrade_XPBoost' });
    logic.update(1 / 30);

    // After upgrade: scalar should be 1.0 + 0.5 = 1.5.
    expect(entity.experienceState.experienceScalar).toBe(1.5);
  });
});

describe('ObjectCreationUpgrade', () => {
  it('spawns OCL entities on upgrade application', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('OCLUpgradeBuilding', 'America', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          makeBlock('Behavior', 'ObjectCreationUpgrade ModuleTag_OCU', {
            TriggeredBy: 'Upgrade_SpawnDrone',
            UpgradeObject: 'OCL_SpawnDrone',
          }),
        ]),
        makeObjectDef('DroneUnit', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 50, InitialHealth: 50 }),
        ]),
      ],
      upgrades: [makeUpgradeDef('Upgrade_SpawnDrone', { Type: 'PLAYER', BuildTime: 0.1, BuildCost: 0 })],
    });
    // Add OCL definition to bundle.
    (bundle as Record<string, unknown>).objectCreationLists = [
      {
        name: 'OCL_SpawnDrone',
        fields: {},
        blocks: [{
          type: 'CreateObject',
          name: 'CreateObject',
          fields: { ObjectNames: 'DroneUnit', Count: '1' },
          blocks: [],
        }],
      },
    ];
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(makeMap([makeMapObject('OCLUpgradeBuilding', 100, 100)]), makeRegistry(bundle), makeHeightmap());

    // Before upgrade: only 1 entity.
    expect(logic.getEntityState(1)).toBeDefined();
    expect(logic.getEntityState(2)).toBeNull();

    logic.submitCommand({ type: 'applyUpgrade', entityId: 1, upgradeName: 'Upgrade_SpawnDrone' });
    logic.update(1 / 30);

    // After upgrade: OCL should have spawned a DroneUnit.
    const droneState = logic.getEntityState(2);
    expect(droneState).toBeDefined();
    expect(droneState!.templateName).toBe('DroneUnit');
  });
});

describe('ActiveShroudUpgrade', () => {
  it('sets entity shroud range (not vision range) on upgrade application', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('ShroudUnit', 'America', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 300, InitialHealth: 300 }),
          makeBlock('Behavior', 'ActiveShroudUpgrade ModuleTag_ASU', {
            TriggeredBy: 'Upgrade_Shroud',
            NewShroudRange: 500,
          }),
        ], { VisionRange: 200 }),
      ],
      upgrades: [makeUpgradeDef('Upgrade_Shroud', { Type: 'PLAYER', BuildTime: 0.1, BuildCost: 0 })],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(makeMap([makeMapObject('ShroudUnit', 80, 80)]), makeRegistry(bundle), makeHeightmap());
    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        visionRange: number;
        shroudRange: number;
      }>;
    };
    const entity = priv.spawnedEntities.get(1)!;

    // Source parity: ActiveShroudUpgrade sets shroudRange, NOT visionRange.
    expect(entity.shroudRange).toBe(0);
    expect(entity.visionRange).toBe(200);

    logic.submitCommand({ type: 'applyUpgrade', entityId: 1, upgradeName: 'Upgrade_Shroud' });
    logic.update(1 / 30);

    expect(entity.shroudRange).toBe(500);
    expect(entity.visionRange).toBe(200); // visionRange unchanged
  });
});

describe('ReplaceObjectUpgrade', () => {
  it('destroys old entity and spawns replacement at same position', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('OldBuilding', 'America', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          makeBlock('Behavior', 'ReplaceObjectUpgrade ModuleTag_ROU', {
            TriggeredBy: 'Upgrade_Replace',
            ReplaceObject: 'NewBuilding',
          }),
        ]),
        makeObjectDef('NewBuilding', 'America', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 800, InitialHealth: 800 }),
        ]),
      ],
      upgrades: [makeUpgradeDef('Upgrade_Replace', { Type: 'PLAYER', BuildTime: 0.1, BuildCost: 0 })],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(makeMap([makeMapObject('OldBuilding', 50, 50)]), makeRegistry(bundle), makeHeightmap());

    // Entity 1 is OldBuilding.
    expect(logic.getEntityState(1)!.templateName).toBe('OldBuilding');

    logic.submitCommand({ type: 'applyUpgrade', entityId: 1, upgradeName: 'Upgrade_Replace' });
    logic.update(1 / 30);

    // Old entity should be destroyed and finalized (removed from map after update).
    expect(logic.getEntityState(1)).toBeNull();

    // New entity should exist as entity 2.
    const newState = logic.getEntityState(2);
    expect(newState).toBeDefined();
    expect(newState!.templateName).toBe('NewBuilding');
    // Same position as old entity.
    expect(newState!.x).toBeCloseTo(50, 0);
    expect(newState!.z).toBeCloseTo(50, 0);
    // Verify replacement has correct max health via internal state.
    const priv = logic as unknown as { spawnedEntities: Map<number, { maxHealth: number; side: string }> };
    const newEntity = priv.spawnedEntities.get(2)!;
    expect(newEntity.maxHealth).toBe(800);
    expect(newEntity.side).toBe('America');
  });

  it('fires onBuildComplete hooks on replacement entity', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('OldFactory', 'America', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 400, InitialHealth: 400 }),
          makeBlock('Behavior', 'ReplaceObjectUpgrade ModuleTag_ROU', {
            TriggeredBy: 'Upgrade_ReplaceFactory',
            ReplaceObject: 'NewFactory',
          }),
        ]),
        makeObjectDef('NewFactory', 'America', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 600, InitialHealth: 600 }),
          makeBlock('Behavior', 'GrantUpgradeCreate ModuleTag_GUC', {
            UpgradeToGrant: 'Upgrade_FactoryBonus',
          }),
        ]),
      ],
      upgrades: [
        makeUpgradeDef('Upgrade_ReplaceFactory', { Type: 'PLAYER', BuildTime: 0.1, BuildCost: 0 }),
        makeUpgradeDef('Upgrade_FactoryBonus', { Type: 'OBJECT', BuildTime: 0.1, BuildCost: 0 }),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(makeMap([makeMapObject('OldFactory', 60, 60)]), makeRegistry(bundle), makeHeightmap());

    logic.submitCommand({ type: 'applyUpgrade', entityId: 1, upgradeName: 'Upgrade_ReplaceFactory' });
    logic.update(1 / 30);

    // The replacement entity should have received GrantUpgradeCreate's onBuildComplete,
    // which grants Upgrade_FactoryBonus to the entity.
    const priv = logic as unknown as { spawnedEntities: Map<number, { completedUpgrades: Set<string> }> };
    const newEntity = priv.spawnedEntities.get(2);
    expect(newEntity).toBeDefined();
    expect(newEntity!.completedUpgrades.has('UPGRADE_FACTORYBONUS')).toBe(true);
  });

  it('applies VeterancyGainCreate on replacement using final owner side sciences', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('OldVehicle', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 400, InitialHealth: 400 }),
          makeBlock('Behavior', 'ReplaceObjectUpgrade ModuleTag_ROU', {
            TriggeredBy: 'Upgrade_ReplaceVehicle',
            ReplaceObject: 'NewVehicle',
          }),
        ]),
        makeObjectDef('NewVehicle', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 600, InitialHealth: 600 }),
          makeBlock('Behavior', 'VeterancyGainCreate ModuleTag_VetCreate', {
            StartingLevel: 'VETERAN',
            ScienceRequired: 'SCIENCE_REPLACE_VET',
          }),
        ], { ExperienceRequired: [0, 50, 200, 500], ExperienceValue: [10, 20, 30, 40] }),
      ],
      upgrades: [
        makeUpgradeDef('Upgrade_ReplaceVehicle', { Type: 'PLAYER', BuildTime: 0.1, BuildCost: 0 }),
      ],
      sciences: [makeScienceDef('SCIENCE_REPLACE_VET', { IsGrantable: 'Yes' })],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    (logic as unknown as { sideSciences: Map<string, Set<string>> }).sideSciences.set(
      'america',
      new Set(['SCIENCE_REPLACE_VET']),
    );
    logic.loadMapObjects(makeMap([makeMapObject('OldVehicle', 80, 80)]), makeRegistry(bundle), makeHeightmap());

    logic.submitCommand({ type: 'applyUpgrade', entityId: 1, upgradeName: 'Upgrade_ReplaceVehicle' });
    logic.update(1 / 30);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, { side: string; experienceState: { currentLevel: number } }>;
    };
    const replacement = priv.spawnedEntities.get(2);
    expect(replacement).toBeDefined();
    expect(replacement!.side).toBe('America');
    expect(replacement!.experienceState.currentLevel).toBe(1);
  });

  it('refreshes navigation grid after replacement structure construction callback', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('OldStruct', 'America', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          makeBlock('Behavior', 'ReplaceObjectUpgrade ModuleTag_ROU', {
            TriggeredBy: 'Upgrade_ReplaceStruct',
            ReplaceObject: 'NewStruct',
          }),
        ], { GeometryMajorRadius: 5, GeometryMinorRadius: 5 }),
        makeObjectDef('NewStruct', 'America', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 700, InitialHealth: 700 }),
        ], { GeometryMajorRadius: 35, GeometryMinorRadius: 35 }),
      ],
      upgrades: [
        makeUpgradeDef('Upgrade_ReplaceStruct', { Type: 'PLAYER', BuildTime: 0.1, BuildCost: 0 }),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(makeMap([makeMapObject('OldStruct', 100, 100)], 128, 128), makeRegistry(bundle), makeHeightmap(128, 128));

    const privBefore = logic as unknown as { navigationGrid: { blocked: Uint8Array } | null };
    const beforeBlocked = Array.from(privBefore.navigationGrid!.blocked);

    logic.submitCommand({ type: 'applyUpgrade', entityId: 1, upgradeName: 'Upgrade_ReplaceStruct' });
    logic.update(1 / 30);

    const privAfter = logic as unknown as {
      navigationGrid: { blocked: Uint8Array } | null;
      spawnedEntities: Map<number, { templateName: string }>;
    };
    expect(privAfter.spawnedEntities.get(2)?.templateName).toBe('NewStruct');
    const afterBlocked = Array.from(privAfter.navigationGrid!.blocked);

    let changedCells = 0;
    for (let i = 0; i < beforeBlocked.length; i++) {
      if (beforeBlocked[i] !== afterBlocked[i]) changedCells++;
    }
    expect(changedCells).toBeGreaterThan(0);
  });

  it('returns false for unknown replacement template', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('BadReplaceBuilding', 'America', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 300, InitialHealth: 300 }),
          makeBlock('Behavior', 'ReplaceObjectUpgrade ModuleTag_ROU', {
            TriggeredBy: 'Upgrade_BadReplace',
            ReplaceObject: 'NonExistentTemplate',
          }),
        ]),
      ],
      upgrades: [makeUpgradeDef('Upgrade_BadReplace', { Type: 'PLAYER', BuildTime: 0.1, BuildCost: 0 })],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(makeMap([makeMapObject('BadReplaceBuilding', 70, 70)]), makeRegistry(bundle), makeHeightmap());

    logic.submitCommand({ type: 'applyUpgrade', entityId: 1, upgradeName: 'Upgrade_BadReplace' });
    logic.update(1 / 30);

    // Entity should still exist and not be destroyed (template not found → no replacement).
    const priv = logic as unknown as { spawnedEntities: Map<number, { destroyed: boolean }> };
    expect(priv.spawnedEntities.get(1)!.destroyed).toBe(false);
  });
});

describe('SpecialPowerCreate', () => {
  it('starts non-shared special power countdown when building completes construction', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('SuperweaponBuilding', 'America', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
          makeBlock('Behavior', 'SpecialPowerCreate ModuleTag_SPC', {}),
          makeBlock('Behavior', 'OCLSpecialPower ModuleTag_SuperWeapon', {
            SpecialPowerTemplate: 'SuperweaponParticleCannon',
          }),
        ], { BuildTime: 0.5 }),
        makeObjectDef('Dozer', 'America', ['DOZER'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
        ]),
      ],
      specialPowers: [
        makeSpecialPowerDef('SuperweaponParticleCannon', { ReloadTime: 6000 }),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    // Place dozer right at the build site so it doesn't need to walk.
    logic.loadMapObjects(makeMap([makeMapObject('Dozer', 100, 100)]), makeRegistry(bundle), makeHeightmap());

    // Place a building via dozer.
    logic.submitCommand({
      type: 'constructBuilding',
      entityId: 1,
      templateName: 'SuperweaponBuilding',
      targetPosition: [100, 0, 100] as const,
      angle: 0,
      lineEndPosition: null,
    });
    logic.update(1 / 30);

    const priv = logic as unknown as {
      shortcutSpecialPowerSourceByName: Map<string, Map<number, number>>;
      frameCounter: number;
    };

    // Before construction completes: no special power timer set.
    const beforeSources = priv.shortcutSpecialPowerSourceByName.get('SUPERWEAPONPARTICLECANNON');
    expect(beforeSources?.size ?? 0).toBe(0);

    // Fast-forward construction to completion (0.5s = 15 frames + margin).
    for (let i = 0; i < 25; i++) {
      logic.update(1 / 30);
    }

    // After construction completes: special power timer should be set.
    const afterSources = priv.shortcutSpecialPowerSourceByName.get('SUPERWEAPONPARTICLECANNON');
    expect(afterSources).toBeDefined();
    expect(afterSources!.size).toBe(1);

    // Non-shared power: readyFrame = completionFrame + reloadFrames.
    // ReloadTime 6000ms = 180 frames. Ready frame should be ~completionFrame + 180.
    const readyFrame = afterSources!.values().next().value;
    expect(readyFrame).toBeGreaterThan(priv.frameCounter);
  });

  it('emits SUPERWEAPON_DETECTED EVA on superweapon structure completion with own/ally/enemy relationships', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('SuperweaponBuilding', 'America', ['STRUCTURE', 'FS_SUPERWEAPON'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
          makeBlock('Behavior', 'SpecialPowerCreate ModuleTag_SPC', {}),
          makeBlock('Behavior', 'OCLSpecialPower ModuleTag_SuperWeapon', {
            SpecialPowerTemplate: 'SuperweaponParticleCannon',
          }),
        ], { BuildTime: 0.5 }),
        makeObjectDef('Dozer', 'America', ['DOZER'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
        ]),
        makeObjectDef('AllyScout', 'China', ['INFANTRY'], []),
        makeObjectDef('EnemyScout', 'GLA', ['INFANTRY'], []),
      ],
      specialPowers: [
        makeSpecialPowerDef('SuperweaponParticleCannon', { ReloadTime: 6000 }),
      ],
    });

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([
        makeMapObject('Dozer', 100, 100),      // id 1 (America)
        makeMapObject('AllyScout', 20, 20),    // id 2 (China)
        makeMapObject('EnemyScout', 30, 30),   // id 3 (GLA)
      ]),
      makeRegistry(bundle),
      makeHeightmap(),
    );

    // China is allied with America; GLA remains non-allied (treated as enemy for EVA).
    logic.setTeamRelationship('China', 'America', 2);
    logic.setTeamRelationship('America', 'China', 2);

    logic.submitCommand({
      type: 'constructBuilding',
      entityId: 1,
      templateName: 'SuperweaponBuilding',
      targetPosition: [100, 0, 100] as const,
      angle: 0,
      lineEndPosition: null,
    });
    logic.update(1 / 30);

    // Complete construction.
    for (let i = 0; i < 25; i += 1) {
      logic.update(1 / 30);
    }

    const detected = logic
      .drainEvaEvents()
      .filter((event) => event.type === 'SUPERWEAPON_DETECTED'
        && (event.detail ?? '').toUpperCase() === 'SUPERWEAPONPARTICLECANNON');

    expect(detected.some((event) => event.side === 'america' && event.relationship === 'own')).toBe(true);
    expect(detected.some((event) => event.side === 'china' && event.relationship === 'ally')).toBe(true);
    expect(detected.some((event) => event.side === 'gla' && event.relationship === 'enemy')).toBe(true);
  });

  it('map-placed building with SpecialPowerCreate starts timer immediately', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('SuperweaponBuilding', 'America', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
          makeBlock('Behavior', 'SpecialPowerCreate ModuleTag_SPC', {}),
          makeBlock('Behavior', 'OCLSpecialPower ModuleTag_SuperWeapon', {
            SpecialPowerTemplate: 'SuperweaponParticleCannon',
          }),
        ]),
      ],
      specialPowers: [
        makeSpecialPowerDef('SuperweaponParticleCannon', { ReloadTime: 6000 }),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(makeMap([makeMapObject('SuperweaponBuilding', 100, 100)]), makeRegistry(bundle), makeHeightmap());

    const priv = logic as unknown as {
      shortcutSpecialPowerSourceByName: Map<string, Map<number, number>>;
      frameCounter: number;
    };

    // Map-placed building born complete: timer starts immediately at creation.
    const sources = priv.shortcutSpecialPowerSourceByName.get('SUPERWEAPONPARTICLECANNON');
    expect(sources).toBeDefined();
    expect(sources!.size).toBe(1);
    const readyFrame = sources!.values().next().value;
    // ReloadTime 6000ms = 180 frames. Ready at frame 0 + 180 = 180.
    expect(readyFrame).toBe(180);
  });

  it('shared synced power is ready immediately on build complete', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('CommandCenter', 'America', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 2000, InitialHealth: 2000 }),
          makeBlock('Behavior', 'SpecialPowerCreate ModuleTag_SPC', {}),
          makeBlock('Behavior', 'SpecialPowerModule ModuleTag_GenPower', {
            SpecialPowerTemplate: 'GeneralsPower_Paladin',
          }),
        ]),
      ],
      specialPowers: [
        makeSpecialPowerDef('GeneralsPower_Paladin', {
          ReloadTime: 3000,
          SharedSyncedTimer: true,
        }),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(makeMap([makeMapObject('CommandCenter', 100, 100)]), makeRegistry(bundle), makeHeightmap());

    const priv = logic as unknown as {
      shortcutSpecialPowerSourceByName: Map<string, Map<number, number>>;
      sharedShortcutSpecialPowerReadyFrames: Map<string, number>;
      frameCounter: number;
    };

    // SharedNSync power: ready immediately (readyFrame = currentFrame = 0).
    const sharedReady = priv.sharedShortcutSpecialPowerReadyFrames.get('GENERALSPOWER_PALADIN');
    expect(sharedReady).toBe(0);
  });

  it('keeps StartsPaused special power countdown frozen until UnpauseSpecialPowerUpgrade', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('PausedPowerBuilding', 'America', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1500, InitialHealth: 1500 }),
          makeBlock('Behavior', 'SpecialPowerCreate ModuleTag_SPC', {}),
          makeBlock('Behavior', 'OCLSpecialPower ModuleTag_PausedPower', {
            SpecialPowerTemplate: 'PausedPower',
            StartsPaused: 'Yes',
          }),
          makeBlock('Behavior', 'UnpauseSpecialPowerUpgrade ModuleTag_Unpause', {
            TriggeredBy: 'Upgrade_UnpausePower',
            SpecialPowerTemplate: 'PausedPower',
          }),
        ]),
      ],
      upgrades: [
        makeUpgradeDef('Upgrade_UnpausePower', { Type: 'OBJECT', BuildTime: 0.1, BuildCost: 0 }),
      ],
      specialPowers: [
        makeSpecialPowerDef('PausedPower', { ReloadTime: 3000 }),
      ],
    });

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([makeMapObject('PausedPowerBuilding', 100, 100)]),
      makeRegistry(bundle),
      makeHeightmap(),
    );

    const attemptDispatch = (): void => {
      logic.submitCommand({
        type: 'issueSpecialPower',
        commandSource: 'PLAYER',
        commandButtonId: 'CMD_PAUSED_POWER',
        specialPowerName: 'PausedPower',
        commandOption: 0,
        issuingEntityIds: [1],
        sourceEntityId: 1,
        targetEntityId: null,
        targetX: null,
        targetZ: null,
      });
      logic.update(0);
    };

    // StartsPaused blocks dispatch even after elapsed frames.
    attemptDispatch();
    expect(logic.getEntityState(1)?.lastSpecialPowerDispatch).toBeNull();
    for (let i = 0; i < 120; i += 1) {
      logic.update(1 / 30);
    }
    attemptDispatch();
    expect(logic.getEntityState(1)?.lastSpecialPowerDispatch).toBeNull();

    // Unpause keeps elapsed paused time on the cooldown (does not become instantly ready).
    logic.submitCommand({ type: 'applyUpgrade', entityId: 1, upgradeName: 'Upgrade_UnpausePower' });
    logic.update(0);
    attemptDispatch();
    expect(logic.getEntityState(1)?.lastSpecialPowerDispatch).toBeNull();

    // ReloadTime 3000ms = 90 frames. After unpause, the power should still be unavailable
    // for a significant chunk of time (not instantly ready).
    for (let i = 0; i < 60; i += 1) {
      logic.update(1 / 30);
    }
    attemptDispatch();
    expect(logic.getEntityState(1)?.lastSpecialPowerDispatch).toBeNull();

    for (let i = 0; i < 60; i += 1) {
      logic.update(1 / 30);
    }
    attemptDispatch();
    expect(logic.getEntityState(1)?.lastSpecialPowerDispatch).toMatchObject({
      specialPowerTemplateName: 'PAUSEDPOWER',
      dispatchType: 'NO_TARGET',
    });
  });
});

describe('onStructureConstructionComplete parity hooks', () => {
  it('tracks structure score and script topology notifications on completion', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Dozer', 'America', ['DOZER'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
        ]),
        makeObjectDef('ScoreBuilding', 'America', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1200, InitialHealth: 1200 }),
        ], { BuildCost: 500, BuildTime: 0.5 }),
      ],
    });
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([makeMapObject('Dozer', 100, 100)]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.setSideCredits('America', 5000);

    expect(logic.getSideScoreState('America')).toMatchObject({ structuresBuilt: 0, moneySpent: 0 });
    expect(logic.getScriptObjectTopologyVersion()).toBe(0);

    logic.submitCommand({
      type: 'constructBuilding',
      entityId: 1,
      templateName: 'ScoreBuilding',
      targetPosition: [100, 0, 100] as const,
      angle: 0,
      lineEndPosition: null,
    });
    logic.update(1 / 30);

    for (let i = 0; i < 25; i += 1) {
      logic.update(1 / 30);
    }

    expect(logic.getSideScoreState('America')).toMatchObject({ structuresBuilt: 1, moneySpent: 500 });
    expect(logic.getScriptObjectTopologyVersion()).toBe(2);
    expect(logic.getScriptObjectCountChangedFrame()).toBeGreaterThan(0);
  });

  it('returns expanded score state with all zero fields for fresh side', () => {
    const bundle = makeBundle({
      objects: [makeObjectDef('Dozer', 'America', ['DOZER'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
      ])],
    });
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([makeMapObject('Dozer', 100, 100)]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    const score = logic.getSideScoreState('America');
    expect(score).toEqual({
      structuresBuilt: 0,
      structuresLost: 0,
      structuresDestroyed: 0,
      unitsBuilt: 0,
      unitsLost: 0,
      unitsDestroyed: 0,
      moneySpent: 0,
      moneyEarned: 0,
    });
  });

  it('tracks getActiveSideNames from playerSideByIndex', () => {
    const bundle = makeBundle({
      objects: [makeObjectDef('Tank', 'America', ['VEHICLE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
      ])],
    });
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([makeMapObject('Tank', 100, 100)]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.setPlayerSide(0, 'America');
    logic.setPlayerSide(1, 'GLA');
    const sides = logic.getActiveSideNames();
    expect(sides).toContain('america');
    expect(sides).toContain('gla');
    expect(sides.length).toBe(2);
  });

  it('notifies skirmish AI on produced structure completion', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Dozer', 'America', ['DOZER'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
        ]),
        makeObjectDef('PatriotBattery', 'America', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
        ], { BuildCost: 800, BuildTime: 0.5 }),
      ],
    });
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([makeMapObject('Dozer', 80, 80)]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.setSideCredits('America', 5000);
    logic.enableSkirmishAI('America');

    const priv = logic as unknown as {
      skirmishAIStates: Map<string, { builtStructureKeywords: Set<string> }>;
    };
    expect(priv.skirmishAIStates.get('america')?.builtStructureKeywords.has('PATRIOT')).toBe(false);

    logic.submitCommand({
      type: 'constructBuilding',
      entityId: 1,
      templateName: 'PatriotBattery',
      targetPosition: [80, 0, 80] as const,
      angle: 0,
      lineEndPosition: null,
    });
    logic.update(1 / 30);

    for (let i = 0; i < 25; i += 1) {
      logic.update(1 / 30);
    }

    expect(priv.skirmishAIStates.get('america')?.builtStructureKeywords.has('PATRIOT')).toBe(true);
  });

  it('updates script object-change frame when an entity is removed from world', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Target', 'America', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ]),
      ],
    });
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([makeMapObject('Target', 10, 10)]),
      makeRegistry(bundle),
      makeHeightmap(),
    );

    expect(logic.getScriptObjectTopologyVersion()).toBe(0);
    expect(logic.getScriptObjectCountChangedFrame()).toBe(0);

    const privateApi = logic as unknown as {
      applyWeaponDamageAmount: (id: number | null, target: unknown, amount: number, type: string) => void;
      spawnedEntities: Map<number, unknown>;
      frameCounter: number;
    };
    const target = privateApi.spawnedEntities.get(1)!;
    privateApi.applyWeaponDamageAmount(null, target, 200, 'UNRESISTABLE');
    logic.update(1 / 30);

    expect(logic.getEntityState(1)).toBeNull();
    expect(logic.getScriptObjectTopologyVersion()).toBe(1);
    expect(logic.getScriptObjectCountChangedFrame()).toBe(privateApi.frameCounter);
  });
});

describe('multiple factory production speed bonus', () => {
  it('two factories of the same type produce faster than one', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('WarFactory', 'America', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
          makeBlock('Behavior', 'ProductionUpdate ModuleTag_Production', {
            MaxQueueEntries: 3,
          }),
          makeBlock('Behavior', 'QueueProductionExitUpdate ModuleTag_Exit', {
            UnitCreatePoint: [12, 0, 0],
            NaturalRallyPoint: [28, 0, 0],
            ExitDelay: 0,
            InitialBurst: 0,
          }),
        ]),
        makeObjectDef('Tank', 'America', ['VEHICLE'], [], { BuildTime: 1.0, BuildCost: 100 }),
      ],
    });

    // --- Single factory baseline ---
    const scene1 = new THREE.Scene();
    // multipleFactory=0.85 matches retail GameData.ini (C++ default is 0.0 = no bonus)
    const logic1 = new GameLogicSubsystem(scene1, { multipleFactory: 0.85 });
    logic1.loadMapObjects(
      makeMap([makeMapObject('WarFactory', 40, 40)], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    logic1.submitCommand({ type: 'setSideCredits', side: 'America', amount: 5000 });
    logic1.submitCommand({ type: 'queueUnitProduction', entityId: 1, unitTemplateName: 'Tank' });
    // Tick several frames to accumulate production progress
    for (let i = 0; i < 5; i++) logic1.update(1 / 30);
    const singlePercent = logic1.getProductionState(1)!.queue[0]!.percentComplete;

    // --- Two factories ---
    const scene2 = new THREE.Scene();
    const logic2 = new GameLogicSubsystem(scene2, { multipleFactory: 0.85 });
    logic2.loadMapObjects(
      makeMap([
        makeMapObject('WarFactory', 40, 40),
        makeMapObject('WarFactory', 80, 40),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    logic2.submitCommand({ type: 'setSideCredits', side: 'America', amount: 5000 });
    logic2.submitCommand({ type: 'queueUnitProduction', entityId: 1, unitTemplateName: 'Tank' });
    for (let i = 0; i < 5; i++) logic2.update(1 / 30);
    const dualPercent = logic2.getProductionState(1)!.queue[0]!.percentComplete;

    // Two factories: per-frame rate is divided by 0.85 per extra factory,
    // so production progresses faster (higher percent after same number of frames).
    expect(dualPercent).toBeGreaterThan(singlePercent);
  });
});

describe('disabled factory pauses production', () => {
  it('EMP-disabled factory does not advance its production queue', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Factory', 'America', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
          makeBlock('Behavior', 'ProductionUpdate ModuleTag_Production', {
            MaxQueueEntries: 3,
          }),
          makeBlock('Behavior', 'QueueProductionExitUpdate ModuleTag_Exit', {
            UnitCreatePoint: [12, 0, 0],
            ExitDelay: 0,
            InitialBurst: 0,
          }),
        ]),
        makeObjectDef('Infantry', 'America', ['INFANTRY'], [], { BuildTime: 1.0, BuildCost: 100 }),
      ],
    });

    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('Factory', 40, 40)], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    logic.submitCommand({ type: 'setSideCredits', side: 'America', amount: 5000 });
    logic.submitCommand({ type: 'queueUnitProduction', entityId: 1, unitTemplateName: 'Infantry' });

    // Advance a few frames so production starts.
    for (let i = 0; i < 5; i++) logic.update(1 / 30);
    const beforeDisable = logic.getProductionState(1)!.queue[0]!.framesUnderConstruction;
    expect(beforeDisable).toBeGreaterThan(0);

    // Manually set DISABLED_EMP on the factory entity, paired with the
    // source Object::m_disabledTillFrame[DISABLED_EMP] timer.
    const priv = logic as unknown as {
      spawnedEntities: Map<number, { objectStatusFlags: Set<string>; disabledEmpUntilFrame: number }>;
      frameCounter: number;
    };
    const factoryEntity = priv.spawnedEntities.get(1)!;
    factoryEntity.objectStatusFlags.add('DISABLED_EMP');
    factoryEntity.disabledEmpUntilFrame = priv.frameCounter + 60;

    // Advance more frames — production should NOT advance.
    for (let i = 0; i < 10; i++) logic.update(1 / 30);
    const afterDisable = logic.getProductionState(1)!.queue[0]!.framesUnderConstruction;
    expect(afterDisable).toBe(beforeDisable);

    // Remove the flag — production should resume.
    factoryEntity.objectStatusFlags.delete('DISABLED_EMP');
    factoryEntity.disabledEmpUntilFrame = 0;
    for (let i = 0; i < 5; i++) logic.update(1 / 30);
    const afterResume = logic.getProductionState(1)!.queue[0]!.framesUnderConstruction;
    expect(afterResume).toBeGreaterThan(afterDisable);
  });
});

describe('SpawnPointProductionExitUpdate', () => {
  function makeSpawnPointBundle(maxQueue = 12) {
    return makeBundle({
      objects: [
        makeObjectDef('StingerSite', 'GLA', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          makeBlock('Behavior', 'ProductionUpdate ModuleTag_Production', {
            MaxQueueEntries: maxQueue,
          }),
          makeBlock('Behavior', 'SpawnPointProductionExitUpdate ModuleTag_Exit', {
            SpawnPointBoneName: 'SpawnPoint',
          }),
        ], {
          Geometry: 'BOX',
          GeometryMajorRadius: 15,
        }),
        makeObjectDef('StingerMissile', 'GLA', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 50, InitialHealth: 50 }),
          makeBlock('LocomotorSet', 'SET_NORMAL LocomotorSlow', {}),
        ], {
          BuildTime: 0.1,
          BuildCost: 50,
        }),
      ],
      locomotors: [
        makeLocomotorDef('LocomotorSlow', 30),
      ],
    });
  }

  it('spawns units at distributed positions around the building, not at origin', () => {
    const bundle = makeSpawnPointBundle();
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('StingerSite', 50, 50)], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    logic.submitCommand({ type: 'setSideCredits', side: 'GLA', amount: 5000 });
    logic.submitCommand({ type: 'queueUnitProduction', entityId: 1, unitTemplateName: 'StingerMissile' });
    logic.submitCommand({ type: 'queueUnitProduction', entityId: 1, unitTemplateName: 'StingerMissile' });

    // Run enough frames for both units to be produced (BuildTime=0.1s → ~3 logic frames).
    for (let i = 0; i < 15; i++) {
      logic.update(1 / 30);
    }

    const unitIds = logic.getEntityIdsByTemplate('StingerMissile');
    expect(unitIds.length).toBe(2);

    const unit1 = logic.getEntityState(unitIds[0]!)!;
    const unit2 = logic.getEntityState(unitIds[1]!)!;

    // Both units should NOT be at the building center (50, 50).
    // They should be at different spawn point positions around the building.
    const bothAtCenter = (
      Math.abs(unit1.x - 50) < 1 && Math.abs(unit1.z - 50) < 1
      && Math.abs(unit2.x - 50) < 1 && Math.abs(unit2.z - 50) < 1
    );
    expect(bothAtCenter).toBe(false);

    // They should be at different positions from each other.
    const samePosition = Math.abs(unit1.x - unit2.x) < 0.01 && Math.abs(unit1.z - unit2.z) < 0.01;
    expect(samePosition).toBe(false);
  });

  it('respects MAX_SPAWN_POINTS capacity of 10 by blocking the 11th unit', () => {
    const bundle = makeSpawnPointBundle(12);
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('StingerSite', 50, 50)], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    logic.submitCommand({ type: 'setSideCredits', side: 'GLA', amount: 50000 });

    // Queue 11 units.
    for (let i = 0; i < 11; i++) {
      logic.submitCommand({ type: 'queueUnitProduction', entityId: 1, unitTemplateName: 'StingerMissile' });
    }

    // Run many frames to ensure all possible production completes.
    for (let i = 0; i < 200; i++) {
      logic.update(1 / 30);
    }

    const unitIds = logic.getEntityIdsByTemplate('StingerMissile');
    // Should produce exactly 10 (MAX_SPAWN_POINTS), the 11th is blocked.
    expect(unitIds.length).toBe(10);

    // The production queue should still have the 11th entry waiting.
    const prodState = logic.getProductionState(1);
    expect(prodState?.queueEntryCount).toBe(1);
  });

  it('sets DISABLED_HELD on produced units at spawn points', () => {
    const bundle = makeSpawnPointBundle();
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('StingerSite', 50, 50)], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    logic.submitCommand({ type: 'setSideCredits', side: 'GLA', amount: 5000 });
    logic.submitCommand({ type: 'queueUnitProduction', entityId: 1, unitTemplateName: 'StingerMissile' });

    for (let i = 0; i < 15; i++) {
      logic.update(1 / 30);
    }

    const unitIds = logic.getEntityIdsByTemplate('StingerMissile');
    expect(unitIds.length).toBe(1);

    const unit = logic.getEntityState(unitIds[0]!)!;
    expect(unit.statusFlags).toContain('DISABLED_HELD');
  });

  it('frees spawn slot when occupier is destroyed and allows reuse', () => {
    const bundle = makeSpawnPointBundle();
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('StingerSite', 50, 50)], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    logic.submitCommand({ type: 'setSideCredits', side: 'GLA', amount: 50000 });

    // Fill all 10 slots.
    for (let i = 0; i < 10; i++) {
      logic.submitCommand({ type: 'queueUnitProduction', entityId: 1, unitTemplateName: 'StingerMissile' });
    }
    for (let i = 0; i < 200; i++) {
      logic.update(1 / 30);
    }

    const unitIds = logic.getEntityIdsByTemplate('StingerMissile');
    expect(unitIds.length).toBe(10);

    // Destroy the first unit by setting health to 0.
    const priv = logic as unknown as { spawnedEntities: Map<number, { health: number; destroyed: boolean }> };
    const firstUnit = priv.spawnedEntities.get(unitIds[0]!)!;
    firstUnit.health = 0;

    // Run frames to process destruction.
    for (let i = 0; i < 10; i++) {
      logic.update(1 / 30);
    }

    // Now queue another unit — it should be able to occupy the freed slot.
    logic.submitCommand({ type: 'queueUnitProduction', entityId: 1, unitTemplateName: 'StingerMissile' });
    for (let i = 0; i < 30; i++) {
      logic.update(1 / 30);
    }

    // Should have 10 alive StingerMissile units again (9 old + 1 new, minus the destroyed one).
    const aliveUnitIds = logic.getEntityIdsByTemplate('StingerMissile')
      .filter((id) => logic.getEntityState(id)?.alive);
    expect(aliveUnitIds.length).toBe(10);
  });

  it('blocks production queue when all 10 spawn slots are occupied', () => {
    const bundle = makeSpawnPointBundle(12);
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('StingerSite', 50, 50)], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    logic.submitCommand({ type: 'setSideCredits', side: 'GLA', amount: 50000 });

    // Queue 10 units to fill all slots.
    for (let i = 0; i < 10; i++) {
      logic.submitCommand({ type: 'queueUnitProduction', entityId: 1, unitTemplateName: 'StingerMissile' });
    }

    // Run many frames for all to complete.
    for (let i = 0; i < 200; i++) {
      logic.update(1 / 30);
    }

    const unitIds = logic.getEntityIdsByTemplate('StingerMissile');
    expect(unitIds.length).toBe(10);
    expect(logic.getProductionState(1)?.queueEntryCount ?? 0).toBe(0);

    // Now queue one more — it should stay in the queue since all slots are full.
    logic.submitCommand({ type: 'queueUnitProduction', entityId: 1, unitTemplateName: 'StingerMissile' });
    for (let i = 0; i < 60; i++) {
      logic.update(1 / 30);
    }

    // The 11th unit should not have been produced.
    expect(logic.getEntityIdsByTemplate('StingerMissile').length).toBe(10);
    // But the production entry should still be in the queue, blocked.
    expect(logic.getProductionState(1)?.queueEntryCount).toBe(1);
  });
});
