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

describe('Sabotage building profiles', () => {
  function makeSabotageSetup() {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('GLAInfantrySaboteur', 'GLA', ['INFANTRY'], [
          makeBlock('Behavior', 'SabotageMilitaryFactoryCrateCollide ModuleTag_MilitaryFactory', {
            SabotageDuration: 30000,
          }),
          makeBlock('Behavior', 'SabotageInternetCenterCrateCollide ModuleTag_InternetCenter', {
            SabotageDuration: 15000,
          }),
        ]),
        makeObjectDef('ChinaWarFactory', 'China', ['STRUCTURE', 'FS_WARFACTORY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
        ]),
        makeObjectDef('ChinaInternetCenter', 'China', ['STRUCTURE', 'FS_INTERNET_CENTER'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
        ]),
      ],
    });
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([
        makeMapObject('GLAInfantrySaboteur', 10, 10),
        makeMapObject('ChinaWarFactory', 40, 10),
        makeMapObject('ChinaInternetCenter', 70, 10),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    return logic as unknown as {
      spawnedEntities: Map<number, unknown>;
      msToLogicFrames(ms: number): number;
      resolveSabotageBuildingProfile(source: unknown, target: unknown): {
        moduleType: string;
        disableHackedDurationFrames: number;
        disableContainedHackers: boolean;
      } | null;
    };
  }

  it('SabotageMilitaryFactoryCrateCollide SabotageDuration disables factory targets', () => {
    const logic = makeSabotageSetup();
    const source = logic.spawnedEntities.get(1)!;
    const target = logic.spawnedEntities.get(2)!;

    const profile = logic.resolveSabotageBuildingProfile(source, target);

    expect(profile?.moduleType).toBe('SABOTAGEMILITARYFACTORYCRATECOLLIDE');
    expect(profile?.disableHackedDurationFrames).toBe(logic.msToLogicFrames(30000));
    expect(profile?.disableContainedHackers).toBe(false);
  });

  it('SabotageInternetCenterCrateCollide SabotageDuration disables internet centers and contained hackers', () => {
    const logic = makeSabotageSetup();
    const source = logic.spawnedEntities.get(1)!;
    const target = logic.spawnedEntities.get(3)!;

    const profile = logic.resolveSabotageBuildingProfile(source, target);

    expect(profile?.moduleType).toBe('SABOTAGEINTERNETCENTERCRATECOLLIDE');
    expect(profile?.disableHackedDurationFrames).toBe(logic.msToLogicFrames(15000));
    expect(profile?.disableContainedHackers).toBe(true);
  });
});
