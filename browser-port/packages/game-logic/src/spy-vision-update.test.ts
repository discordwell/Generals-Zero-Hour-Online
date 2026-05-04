import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { GameLogicSubsystem } from './index.js';
import {
  makeBlock,
  makeBundle,
  makeHeightmap,
  makeMap,
  makeMapObject,
  makeObjectDef,
  makeRegistry,
} from './test-helpers.js';

describe('SpyVisionUpdate parity', () => {
  it('activates upgrade-triggered self-powered spy vision and honors SpyOnKindof', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('InternetCenter', 'China', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
          makeBlock('Behavior', 'SpyVisionUpdate ModuleTag_SatelliteHackOne', {
            NeedsUpgrade: true,
            SelfPowered: true,
            SpyOnKindof: 'COMMANDCENTER',
            TriggeredBy: 'Upgrade_ChinaSatelliteHackOne',
          }),
        ], { VisionRange: 20, ShroudClearingRange: 20 }),
        makeObjectDef('EnemyCommandCenter', 'America', ['STRUCTURE', 'COMMANDCENTER'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
        ], { VisionRange: 70, ShroudClearingRange: 70 }),
        makeObjectDef('EnemyTank', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
        ], { VisionRange: 70, ShroudClearingRange: 70 }),
      ],
    });

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([
        makeMapObject('InternetCenter', 10, 10),
        makeMapObject('EnemyCommandCenter', 190, 190),
        makeMapObject('EnemyTank', 350, 350),
      ], 512, 512),
      makeRegistry(bundle),
      makeHeightmap(512, 512),
    );
    logic.setPlayerSide(0, 'China');
    logic.setPlayerSide(1, 'America');
    logic.setTeamRelationship('China', 'America', 0);
    logic.setTeamRelationship('America', 'China', 0);
    logic.update(1 / 30);

    expect(logic.getCellVisibility('China', 190, 190)).toBe(0);
    expect(logic.getCellVisibility('China', 350, 350)).toBe(0);

    expect(logic.applyUpgradeToEntity(1, 'Upgrade_ChinaSatelliteHackOne')).toBe(true);
    logic.update(1 / 30);

    expect(logic.getCellVisibility('China', 190, 190)).toBe(2);
    expect(logic.getCellVisibility('China', 350, 350)).toBe(0);
  });

  it('cycles self-powered spy vision using SelfPoweredDuration and SelfPoweredInterval', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('InternetCenter', 'China', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
          makeBlock('Behavior', 'SpyVisionUpdate ModuleTag_SatelliteHackTwo', {
            NeedsUpgrade: true,
            SelfPowered: true,
            SelfPoweredDuration: 1000,
            SelfPoweredInterval: 2000,
            TriggeredBy: 'Upgrade_ChinaSatelliteHackTwo',
          }),
        ], { VisionRange: 20, ShroudClearingRange: 20 }),
        makeObjectDef('EnemyTank', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
        ], { VisionRange: 70, ShroudClearingRange: 70 }),
      ],
    });

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([
        makeMapObject('InternetCenter', 10, 10),
        makeMapObject('EnemyTank', 190, 190),
      ], 512, 512),
      makeRegistry(bundle),
      makeHeightmap(512, 512),
    );
    logic.setPlayerSide(0, 'China');
    logic.setPlayerSide(1, 'America');
    logic.setTeamRelationship('China', 'America', 0);
    logic.setTeamRelationship('America', 'China', 0);
    logic.update(1 / 30);

    logic.applyUpgradeToEntity(1, 'Upgrade_ChinaSatelliteHackTwo');
    logic.update(1 / 30);
    expect(logic.getCellVisibility('China', 190, 190)).toBe(2);

    for (let i = 0; i < 35; i += 1) {
      logic.update(1 / 30);
    }
    expect(logic.getCellVisibility('China', 190, 190)).toBe(1);

    for (let i = 0; i < 61; i += 1) {
      logic.update(1 / 30);
    }
    expect(logic.getCellVisibility('China', 190, 190)).toBe(2);
  });
});
