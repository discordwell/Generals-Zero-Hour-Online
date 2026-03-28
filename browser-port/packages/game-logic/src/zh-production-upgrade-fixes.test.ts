/**
 * ZH production + upgrade runtime fixes tests.
 *
 * Verifies five ZH-specific behaviors:
 *   1. SabotageSupplyCenterCrateCollide — EVA events for cash theft
 *   2. Upgrade display name suppression — no UPGRADE_COMPLETE for unlabeled upgrades
 *   3. Power sabotage recovery — powerSabotagedUntilFrame reset on expiry
 *   4. Fanaticism weapon bonus — uses player upgrades, not sciences
 *   5. isAllowedNationalism check — disables nationalism/fanaticism per horde module
 *
 * Source parity:
 *   - SabotageSupplyCenterCrateCollide.cpp:133-177: withdraw/deposit + EVA events
 *   - ProductionUpdate.cpp:912: !upgrade->getDisplayNameLabel().isEmpty() gate
 *   - Player.cpp:730-733: reset powerSabotagedTillFrame on expiry
 *   - AIUpdate.cpp:4689-4700: Upgrade_Nationalism / Upgrade_Fanaticism checks
 *   - HordeUpdate.cpp:181-184 + AIUpdate.cpp:4712-4717: isAllowedNationalism
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { GameLogicSubsystem } from './index.js';
import {
  makeBlock,
  makeObjectDef,
  makeWeaponDef,
  makeArmorDef,
  makeLocomotorDef,
  makeBundle,
  makeRegistry,
  makeHeightmap,
  makeMap,
  makeMapObject,
  makeUpgradeDef,
  makeCommandButtonDef,
  makeCommandSetDef,
} from './test-helpers.js';

// ---------------------------------------------------------------------------
// 1. SabotageSupplyCenterCrateCollide — EVA events for cash theft
// ---------------------------------------------------------------------------
describe('SabotageSupplyCenterCrateCollide — cash theft EVA events', () => {
  function makeSabotageSupplyBundle(stealAmount: number) {
    return makeBundle({
      objects: [
        // Saboteur unit with SabotageSupplyCenterCrateCollide module
        makeObjectDef('GLASaboteur', 'GLA', ['INFANTRY'], [
          makeBlock('Behavior', 'SabotageSupplyCenterCrateCollide ModuleTag_SabotageSC', {
            StealCashAmount: stealAmount,
          }),
        ], { VisionRange: 100 }),
        // Enemy supply center
        makeObjectDef('SupplyCenter', 'America', ['STRUCTURE', 'FS_SUPPLY_CENTER'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
        ]),
      ],
    });
  }

  it('emits CASH_STOLEN when cash is successfully stolen', () => {
    const bundle = makeSabotageSupplyBundle(500);
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([
        makeMapObject('GLASaboteur', 10, 10),     // id 1
        makeMapObject('SupplyCenter', 20, 10),     // id 2
      ], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );
    logic.setTeamRelationship('GLA', 'America', 0);
    logic.setTeamRelationship('America', 'GLA', 0);

    // Give America some starting cash.
    const priv = logic as unknown as {
      sideCredits: Map<string, number>;
    };
    priv.sideCredits.set('america', 1000);
    priv.sideCredits.set('gla', 0);

    logic.update(1 / 30);
    logic.drainEvaEvents(); // Clear initial events.

    // Execute sabotage action.
    logic.submitCommand({
      type: 'enterObject',
      entityId: 1,
      targetObjectId: 2,
      action: 'sabotageBuilding',
    });
    logic.update(1 / 30);

    const events = logic.drainEvaEvents();
    const cashStolenEvents = events.filter(e => e.type === 'CASH_STOLEN');
    expect(cashStolenEvents.length).toBeGreaterThan(0);
    // EVA fires on the victim's side.
    expect(cashStolenEvents[0]!.side).toBe('america');

    // Verify cash was transferred: America loses 500, GLA gains 500.
    expect(priv.sideCredits.get('america')).toBe(500);
    expect(priv.sideCredits.get('gla')).toBe(500);
  });

  it('emits BUILDING_SABOTAGED when target has no cash to steal', () => {
    const bundle = makeSabotageSupplyBundle(500);
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([
        makeMapObject('GLASaboteur', 10, 10),     // id 1
        makeMapObject('SupplyCenter', 20, 10),     // id 2
      ], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );
    logic.setTeamRelationship('GLA', 'America', 0);
    logic.setTeamRelationship('America', 'GLA', 0);

    // America has 0 cash.
    const priv = logic as unknown as {
      sideCredits: Map<string, number>;
    };
    priv.sideCredits.set('america', 0);
    priv.sideCredits.set('gla', 0);

    logic.update(1 / 30);
    logic.drainEvaEvents();

    logic.submitCommand({
      type: 'enterObject',
      entityId: 1,
      targetObjectId: 2,
      action: 'sabotageBuilding',
    });
    logic.update(1 / 30);

    const events = logic.drainEvaEvents();
    const sabotagedEvents = events.filter(e => e.type === 'BUILDING_SABOTAGED');
    expect(sabotagedEvents.length).toBeGreaterThan(0);
    expect(sabotagedEvents[0]!.side).toBe('america');
    // No CASH_STOLEN event when no cash is available.
    expect(events.filter(e => e.type === 'CASH_STOLEN').length).toBe(0);
  });

  it('caps stolen amount to what the target actually has', () => {
    const bundle = makeSabotageSupplyBundle(1000);
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([
        makeMapObject('GLASaboteur', 10, 10),
        makeMapObject('SupplyCenter', 20, 10),
      ], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );
    logic.setTeamRelationship('GLA', 'America', 0);
    logic.setTeamRelationship('America', 'GLA', 0);

    const priv = logic as unknown as { sideCredits: Map<string, number> };
    priv.sideCredits.set('america', 300);
    priv.sideCredits.set('gla', 0);

    logic.update(1 / 30);
    logic.drainEvaEvents();

    logic.submitCommand({
      type: 'enterObject',
      entityId: 1,
      targetObjectId: 2,
      action: 'sabotageBuilding',
    });
    logic.update(1 / 30);

    // Cash is capped: steal min(1000, 300) = 300.
    expect(priv.sideCredits.get('america')).toBe(0);
    expect(priv.sideCredits.get('gla')).toBe(300);
  });
});

// ---------------------------------------------------------------------------
// 2. Upgrade display name suppression
// ---------------------------------------------------------------------------
describe('Upgrade display name suppression', () => {
  function makeUpgradeBundle(displayName: string | null) {
    const upgradeFields: Record<string, unknown> = {
      BuildTime: 2, // 2 seconds = ~60 frames
      BuildCost: 100,
      Type: 'PLAYER',
    };
    if (displayName !== null) {
      upgradeFields['DisplayName'] = displayName;
    }

    return makeBundle({
      objects: [
        makeObjectDef('WarFactory', 'America', ['STRUCTURE', 'FS_WARFACTORY'], [
          makeBlock('Body', 'StructureBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
          makeBlock('Behavior', 'ProductionUpdate ModuleTag_Prod', { MaxQueueEntries: 9 }),
        ], {
          CommandSet: 'FactoryCommandSet',
        }),
      ],
      upgrades: [
        makeUpgradeDef('Upgrade_TestUpgrade', upgradeFields),
      ],
      commandButtons: [
        makeCommandButtonDef('Cmd_TestUpgrade', {
          Command: 'PLAYER_UPGRADE',
          Upgrade: 'Upgrade_TestUpgrade',
        }),
      ],
      commandSets: [
        makeCommandSetDef('FactoryCommandSet', { '1': 'Cmd_TestUpgrade' }),
      ],
    });
  }

  it('emits UPGRADE_COMPLETE for upgrades with a non-empty DisplayName', () => {
    const bundle = makeUpgradeBundle('UPGRADE:MyUpgradeName');
    const logic = new GameLogicSubsystem(new THREE.Scene());
    const registry = makeRegistry(bundle);
    logic.loadMapObjects(
      makeMap([makeMapObject('WarFactory', 50, 50)], 128, 128),
      registry,
      makeHeightmap(128, 128),
    );
    logic.setPlayerSide(0, 'America');
    logic.submitCommand({ type: 'setSideCredits', side: 'America', amount: 10000 });
    logic.update(1 / 30);
    logic.drainEvaEvents();

    // Queue the upgrade via production system.
    logic.submitCommand({
      type: 'queueUpgradeProduction',
      entityId: 1,
      upgradeName: 'Upgrade_TestUpgrade',
    });

    // Run enough frames to complete the upgrade (2s = 60 frames + margin).
    for (let i = 0; i < 80; i++) logic.update(1 / 30);

    const events = logic.drainEvaEvents();
    const upgradeEvents = events.filter(e => e.type === 'UPGRADE_COMPLETE');
    expect(upgradeEvents.length).toBeGreaterThan(0);
  });

  it('suppresses UPGRADE_COMPLETE for upgrades with an empty DisplayName', () => {
    const bundle = makeUpgradeBundle('');
    const logic = new GameLogicSubsystem(new THREE.Scene());
    const registry = makeRegistry(bundle);
    logic.loadMapObjects(
      makeMap([makeMapObject('WarFactory', 50, 50)], 128, 128),
      registry,
      makeHeightmap(128, 128),
    );
    logic.setPlayerSide(0, 'America');
    logic.submitCommand({ type: 'setSideCredits', side: 'America', amount: 10000 });
    logic.update(1 / 30);
    logic.drainEvaEvents();

    logic.submitCommand({
      type: 'queueUpgradeProduction',
      entityId: 1,
      upgradeName: 'Upgrade_TestUpgrade',
    });

    for (let i = 0; i < 80; i++) logic.update(1 / 30);

    const events = logic.drainEvaEvents();
    const upgradeEvents = events.filter(e => e.type === 'UPGRADE_COMPLETE');
    expect(upgradeEvents.length).toBe(0);
  });

  it('suppresses UPGRADE_COMPLETE for upgrades with no DisplayName field', () => {
    const bundle = makeUpgradeBundle(null);
    const logic = new GameLogicSubsystem(new THREE.Scene());
    const registry = makeRegistry(bundle);
    logic.loadMapObjects(
      makeMap([makeMapObject('WarFactory', 50, 50)], 128, 128),
      registry,
      makeHeightmap(128, 128),
    );
    logic.setPlayerSide(0, 'America');
    logic.submitCommand({ type: 'setSideCredits', side: 'America', amount: 10000 });
    logic.update(1 / 30);
    logic.drainEvaEvents();

    logic.submitCommand({
      type: 'queueUpgradeProduction',
      entityId: 1,
      upgradeName: 'Upgrade_TestUpgrade',
    });

    for (let i = 0; i < 80; i++) logic.update(1 / 30);

    const events = logic.drainEvaEvents();
    const upgradeEvents = events.filter(e => e.type === 'UPGRADE_COMPLETE');
    expect(upgradeEvents.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 3. Power sabotage recovery — powerSabotagedUntilFrame reset
// ---------------------------------------------------------------------------
describe('Power sabotage recovery', () => {
  it('resets powerSabotagedUntilFrame to 0 when sabotage timer expires', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('BlackLotus', 'China', ['INFANTRY'], [
          makeBlock('Behavior', 'SabotagePowerPlantCrateCollide ModuleTag_SabotagePP', {
            SabotagePowerDuration: 1000, // ~30 frames
          }),
        ], { VisionRange: 100 }),
        makeObjectDef('PowerPlant', 'America', ['STRUCTURE', 'FS_POWER'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
        ], { EnergyProduction: 5 }),
        makeObjectDef('WarFactory', 'America', ['STRUCTURE', 'FS_WARFACTORY', 'POWERED'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 800, InitialHealth: 800 }),
        ], { EnergyProduction: -3 }),
      ],
    });

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([
        makeMapObject('BlackLotus', 10, 10),   // id 1
        makeMapObject('PowerPlant', 20, 10),    // id 2
        makeMapObject('WarFactory', 30, 10),    // id 3
      ], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );
    logic.setTeamRelationship('China', 'America', 0);
    logic.setTeamRelationship('America', 'China', 0);
    logic.update(1 / 30);

    // Verify not browned out initially.
    expect(logic.getSidePowerState('America').brownedOut).toBe(false);

    const priv = logic as unknown as {
      sidePowerBonus: Map<string, { powerSabotagedUntilFrame: number; brownedOut: boolean }>;
    };

    // Sabotage the power plant.
    logic.submitCommand({
      type: 'enterObject',
      entityId: 1,
      targetObjectId: 2,
      action: 'sabotageBuilding',
    });
    logic.update(1 / 30);
    logic.update(1 / 30);

    // Verify sabotaged state.
    const powerState = priv.sidePowerBonus.get('america')!;
    expect(powerState.powerSabotagedUntilFrame).toBeGreaterThan(0);
    expect(powerState.brownedOut).toBe(true);

    // Run past the sabotage duration.
    for (let i = 0; i < 50; i++) logic.update(1 / 30);

    // Source parity: Player.cpp:730-733 — frame resets to 0 after expiry.
    expect(powerState.powerSabotagedUntilFrame).toBe(0);
    expect(powerState.brownedOut).toBe(false);
  });

  it('triggers onPowerBrownOutChange on sabotage expiry, clearing DISABLED_UNDERPOWERED', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('BlackLotus', 'China', ['INFANTRY'], [
          makeBlock('Behavior', 'SabotagePowerPlantCrateCollide ModuleTag_SabotagePP', {
            SabotagePowerDuration: 1000,
          }),
        ], { VisionRange: 100 }),
        makeObjectDef('PowerPlant', 'America', ['STRUCTURE', 'FS_POWER'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
        ], { EnergyProduction: 10 }),
        makeObjectDef('Radar', 'America', ['STRUCTURE', 'POWERED'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 300, InitialHealth: 300 }),
        ], { EnergyProduction: -3 }),
      ],
    });

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([
        makeMapObject('BlackLotus', 10, 10),
        makeMapObject('PowerPlant', 20, 10),
        makeMapObject('Radar', 30, 10),     // id 3 — POWERED, should get DISABLED_UNDERPOWERED during sabotage
      ], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );
    logic.setTeamRelationship('China', 'America', 0);
    logic.setTeamRelationship('America', 'China', 0);
    logic.update(1 / 30);

    // Sabotage.
    logic.submitCommand({
      type: 'enterObject',
      entityId: 1,
      targetObjectId: 2,
      action: 'sabotageBuilding',
    });
    logic.update(1 / 30);
    logic.update(1 / 30);

    // Radar should be disabled during sabotage.
    const radarState = logic.getEntityState(3)!;
    expect(radarState.statusFlags).toContain('DISABLED_UNDERPOWERED');

    // Run past sabotage.
    for (let i = 0; i < 50; i++) logic.update(1 / 30);

    // Radar should be re-enabled.
    const radarAfter = logic.getEntityState(3)!;
    expect(radarAfter.statusFlags).not.toContain('DISABLED_UNDERPOWERED');
  });
});

// ---------------------------------------------------------------------------
// 4. Fanaticism weapon bonus — uses player upgrades, not sciences
// ---------------------------------------------------------------------------
describe('Fanaticism weapon bonus via player upgrades', () => {
  const WEAPON_BONUS_HORDE = 1 << 1;
  const WEAPON_BONUS_NATIONALISM = 1 << 4;
  const WEAPON_BONUS_FANATICISM = 1 << 23;

  function makeHordeBlock(overrides: Record<string, unknown> = {}): IniBlock {
    return makeBlock('Behavior', 'HordeUpdate ModuleTag_Horde', {
      Count: 3,
      KindOf: 'INFANTRY',
      Action: 'HORDE',
      RubOffRadius: 0,
      UpdateRate: 500,
      AllowedNationalism: 'Yes',
      ...overrides,
    });
  }

  function makeHordeSetup(opts?: { unitCount?: number; hordeOverrides?: Record<string, unknown> }) {
    const unitCount = opts?.unitCount ?? 3;
    const hordeOverrides = opts?.hordeOverrides ?? {};
    const objects = [
      makeObjectDef('HordeInfantry', 'GLA', ['INFANTRY'], [
        makeHordeBlock(hordeOverrides),
      ], { MaxHealth: 100 }),
    ];
    const mapObjects = [];
    for (let i = 0; i < unitCount; i++) {
      mapObjects.push(makeMapObject('HordeInfantry', 5, 5 + i));
    }
    const bundle = makeBundle({ objects });
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(makeMap(mapObjects, 64, 64), makeRegistry(bundle), makeHeightmap(64, 64));
    logic.setPlayerSide(0, 'GLA');
    return { logic, bundle };
  }

  it('grants NATIONALISM when player has Upgrade_Nationalism completed', () => {
    const { logic } = makeHordeSetup({ unitCount: 3 });

    // Set the upgrade as completed (the C++ way).
    const priv = logic as unknown as {
      setSideUpgradeCompleted: (side: string, upgradeName: string, enabled: boolean) => void;
    };
    priv.setSideUpgradeCompleted('GLA', 'Upgrade_Nationalism', true);

    logic.update(0);
    for (let i = 0; i < 20; i++) logic.update(1 / 30);

    const state = logic.getEntityState(1)!;
    expect(state.weaponBonusConditionFlags & WEAPON_BONUS_HORDE).toBe(WEAPON_BONUS_HORDE);
    expect(state.weaponBonusConditionFlags & WEAPON_BONUS_NATIONALISM).toBe(WEAPON_BONUS_NATIONALISM);
    expect(state.weaponBonusConditionFlags & WEAPON_BONUS_FANATICISM).toBe(0);
  });

  it('grants FANATICISM when both Upgrade_Nationalism and Upgrade_Fanaticism are completed', () => {
    const { logic } = makeHordeSetup({ unitCount: 3 });

    const priv = logic as unknown as {
      setSideUpgradeCompleted: (side: string, upgradeName: string, enabled: boolean) => void;
    };
    priv.setSideUpgradeCompleted('GLA', 'Upgrade_Nationalism', true);
    priv.setSideUpgradeCompleted('GLA', 'Upgrade_Fanaticism', true);

    logic.update(0);
    for (let i = 0; i < 20; i++) logic.update(1 / 30);

    const state = logic.getEntityState(1)!;
    expect(state.weaponBonusConditionFlags & WEAPON_BONUS_HORDE).toBe(WEAPON_BONUS_HORDE);
    expect(state.weaponBonusConditionFlags & WEAPON_BONUS_NATIONALISM).toBe(WEAPON_BONUS_NATIONALISM);
    expect(state.weaponBonusConditionFlags & WEAPON_BONUS_FANATICISM).toBe(WEAPON_BONUS_FANATICISM);
  });

  it('does not grant FANATICISM without NATIONALISM upgrade', () => {
    const { logic } = makeHordeSetup({ unitCount: 3 });

    const priv = logic as unknown as {
      setSideUpgradeCompleted: (side: string, upgradeName: string, enabled: boolean) => void;
    };
    // Only fanaticism without nationalism — should not activate.
    priv.setSideUpgradeCompleted('GLA', 'Upgrade_Fanaticism', true);

    logic.update(0);
    for (let i = 0; i < 20; i++) logic.update(1 / 30);

    const state = logic.getEntityState(1)!;
    expect(state.weaponBonusConditionFlags & WEAPON_BONUS_NATIONALISM).toBe(0);
    expect(state.weaponBonusConditionFlags & WEAPON_BONUS_FANATICISM).toBe(0);
  });

  it('does not grant nationalism/fanaticism from sciences (only upgrades)', () => {
    const { logic } = makeHordeSetup({ unitCount: 3 });

    // Add as sciences — should NOT trigger nationalism/fanaticism (those are upgrades in C++).
    const priv = logic as unknown as {
      addScienceToSide: (side: string, science: string) => boolean;
    };
    priv.addScienceToSide('gla', 'SCIENCE_NATIONALISM');
    priv.addScienceToSide('gla', 'SCIENCE_FANATICISM');

    logic.update(0);
    for (let i = 0; i < 20; i++) logic.update(1 / 30);

    const state = logic.getEntityState(1)!;
    // Horde is still active, but nationalism/fanaticism should NOT be set from sciences.
    expect(state.weaponBonusConditionFlags & WEAPON_BONUS_HORDE).toBe(WEAPON_BONUS_HORDE);
    expect(state.weaponBonusConditionFlags & WEAPON_BONUS_NATIONALISM).toBe(0);
    expect(state.weaponBonusConditionFlags & WEAPON_BONUS_FANATICISM).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 5. isAllowedNationalism check — disables nationalism/fanaticism per horde module
// ---------------------------------------------------------------------------
describe('isAllowedNationalism check', () => {
  const WEAPON_BONUS_HORDE = 1 << 1;
  const WEAPON_BONUS_NATIONALISM = 1 << 4;
  const WEAPON_BONUS_FANATICISM = 1 << 23;

  function makeHordeBlock(overrides: Record<string, unknown> = {}): IniBlock {
    return makeBlock('Behavior', 'HordeUpdate ModuleTag_Horde', {
      Count: 3,
      KindOf: 'INFANTRY',
      Action: 'HORDE',
      RubOffRadius: 0,
      UpdateRate: 500,
      AllowedNationalism: 'Yes',
      ...overrides,
    });
  }

  it('prevents nationalism/fanaticism when AllowedNationalism=No', () => {
    const objects = [
      makeObjectDef('HordeInfantry', 'GLA', ['INFANTRY'], [
        makeHordeBlock({ AllowedNationalism: 'No' }),
      ], { MaxHealth: 100 }),
    ];
    const mapObjects = [
      makeMapObject('HordeInfantry', 5, 5),
      makeMapObject('HordeInfantry', 5, 6),
      makeMapObject('HordeInfantry', 5, 7),
    ];
    const bundle = makeBundle({ objects });
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(makeMap(mapObjects, 64, 64), makeRegistry(bundle), makeHeightmap(64, 64));
    logic.setPlayerSide(0, 'GLA');

    // Grant both upgrades.
    const priv = logic as unknown as {
      setSideUpgradeCompleted: (side: string, upgradeName: string, enabled: boolean) => void;
    };
    priv.setSideUpgradeCompleted('GLA', 'Upgrade_Nationalism', true);
    priv.setSideUpgradeCompleted('GLA', 'Upgrade_Fanaticism', true);

    logic.update(0);
    for (let i = 0; i < 20; i++) logic.update(1 / 30);

    const state = logic.getEntityState(1)!;
    // HORDE bonus should still be active.
    expect(state.weaponBonusConditionFlags & WEAPON_BONUS_HORDE).toBe(WEAPON_BONUS_HORDE);
    // But nationalism/fanaticism should be blocked by AllowedNationalism=No.
    expect(state.weaponBonusConditionFlags & WEAPON_BONUS_NATIONALISM).toBe(0);
    expect(state.weaponBonusConditionFlags & WEAPON_BONUS_FANATICISM).toBe(0);
  });

  it('allows nationalism/fanaticism when AllowedNationalism=Yes', () => {
    const objects = [
      makeObjectDef('HordeInfantry', 'GLA', ['INFANTRY'], [
        makeHordeBlock({ AllowedNationalism: 'Yes' }),
      ], { MaxHealth: 100 }),
    ];
    const mapObjects = [
      makeMapObject('HordeInfantry', 5, 5),
      makeMapObject('HordeInfantry', 5, 6),
      makeMapObject('HordeInfantry', 5, 7),
    ];
    const bundle = makeBundle({ objects });
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(makeMap(mapObjects, 64, 64), makeRegistry(bundle), makeHeightmap(64, 64));
    logic.setPlayerSide(0, 'GLA');

    const priv = logic as unknown as {
      setSideUpgradeCompleted: (side: string, upgradeName: string, enabled: boolean) => void;
    };
    priv.setSideUpgradeCompleted('GLA', 'Upgrade_Nationalism', true);
    priv.setSideUpgradeCompleted('GLA', 'Upgrade_Fanaticism', true);

    logic.update(0);
    for (let i = 0; i < 20; i++) logic.update(1 / 30);

    const state = logic.getEntityState(1)!;
    expect(state.weaponBonusConditionFlags & WEAPON_BONUS_HORDE).toBe(WEAPON_BONUS_HORDE);
    expect(state.weaponBonusConditionFlags & WEAPON_BONUS_NATIONALISM).toBe(WEAPON_BONUS_NATIONALISM);
    expect(state.weaponBonusConditionFlags & WEAPON_BONUS_FANATICISM).toBe(WEAPON_BONUS_FANATICISM);
  });

  it('defaults to AllowedNationalism=Yes when field is missing', () => {
    const hordeBlock = makeBlock('Behavior', 'HordeUpdate ModuleTag_Horde', {
      Count: 3,
      KindOf: 'INFANTRY',
      Action: 'HORDE',
      RubOffRadius: 0,
      UpdateRate: 500,
      // No AllowedNationalism field — defaults to Yes.
    });
    const objects = [
      makeObjectDef('HordeInfantry', 'GLA', ['INFANTRY'], [hordeBlock], { MaxHealth: 100 }),
    ];
    const mapObjects = [
      makeMapObject('HordeInfantry', 5, 5),
      makeMapObject('HordeInfantry', 5, 6),
      makeMapObject('HordeInfantry', 5, 7),
    ];
    const bundle = makeBundle({ objects });
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(makeMap(mapObjects, 64, 64), makeRegistry(bundle), makeHeightmap(64, 64));
    logic.setPlayerSide(0, 'GLA');

    const priv = logic as unknown as {
      setSideUpgradeCompleted: (side: string, upgradeName: string, enabled: boolean) => void;
    };
    priv.setSideUpgradeCompleted('GLA', 'Upgrade_Nationalism', true);

    logic.update(0);
    for (let i = 0; i < 20; i++) logic.update(1 / 30);

    const state = logic.getEntityState(1)!;
    expect(state.weaponBonusConditionFlags & WEAPON_BONUS_NATIONALISM).toBe(WEAPON_BONUS_NATIONALISM);
  });
});
