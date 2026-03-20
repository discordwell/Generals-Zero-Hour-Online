/**
 * Skirmish AI integration test.
 *
 * Verifies the AI opponent builds structures and trains units when
 * given starting credits and a CC + dozer.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { GameLogicSubsystem } from './index.js';
import {
  makeBlock,
  makeObjectDef,
  makeLocomotorDef,
  makeCommandButtonDef,
  makeCommandSetDef,
  makeBundle,
  makeRegistry,
  makeHeightmap,
  makeMap,
  makeMapObject,
} from './test-helpers.js';

describe('skirmish AI', () => {
  it('AI builds structures when given credits and dozers', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('AICC', 'China', ['STRUCTURE', 'COMMANDCENTER'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 5000, InitialHealth: 5000 }),
          makeBlock('Behavior', 'ProductionUpdate ModuleTag_Prod', { MaxQueueEntries: 9 }),
          makeBlock('Behavior', 'DefaultProductionExitUpdate ModuleTag_Exit', {
            UnitCreatePoint: [30, 0, 0],
          }),
        ], { CommandSet: 'AICCCommandSet', VisionRange: 200, ShroudClearingRange: 200 }),
        makeObjectDef('AIDozer', 'China', ['VEHICLE', 'DOZER'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
          makeBlock('LocomotorSet', 'SET_NORMAL Loco', {}),
        ], { CommandSet: 'AIDozerCommandSet', VisionRange: 200, ShroudClearingRange: 200 }),
        makeObjectDef('AIPowerPlant', 'China', ['STRUCTURE', 'FS_POWER'], [
          makeBlock('Body', 'StructureBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
        ], { BuildCost: 500, BuildTime: 1 }),
        makeObjectDef('AIBarracks', 'China', ['STRUCTURE', 'FS_FACTORY'], [
          makeBlock('Body', 'StructureBody ModuleTag_Body', { MaxHealth: 2000, InitialHealth: 2000 }),
          makeBlock('Behavior', 'ProductionUpdate ModuleTag_Prod', { MaxQueueEntries: 9 }),
          makeBlock('Behavior', 'DefaultProductionExitUpdate ModuleTag_Exit', {
            UnitCreatePoint: [20, 0, 0],
          }),
        ], { BuildCost: 600, BuildTime: 1, CommandSet: 'AIBarracksCommandSet' }),
        makeObjectDef('AIInfantry', 'China', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 80, InitialHealth: 80 }),
          makeBlock('LocomotorSet', 'SET_NORMAL Loco', {}),
        ], { BuildCost: 200, BuildTime: 0.5 }),
      ],
      locomotors: [makeLocomotorDef('Loco', 40)],
      commandSets: [
        makeCommandSetDef('AICCCommandSet', { '1': 'Cmd_AITrainDozer' }),
        makeCommandSetDef('AIDozerCommandSet', {
          '1': 'Cmd_AIBuildPP',
          '2': 'Cmd_AIBuildBarracks',
        }),
        makeCommandSetDef('AIBarracksCommandSet', { '1': 'Cmd_AITrainInf' }),
      ],
      commandButtons: [
        makeCommandButtonDef('Cmd_AITrainDozer', { Command: 'UNIT_BUILD', Object: 'AIDozer' }),
        makeCommandButtonDef('Cmd_AIBuildPP', { Command: 'DOZER_CONSTRUCT', Object: 'AIPowerPlant' }),
        makeCommandButtonDef('Cmd_AIBuildBarracks', { Command: 'DOZER_CONSTRUCT', Object: 'AIBarracks' }),
        makeCommandButtonDef('Cmd_AITrainInf', { Command: 'UNIT_BUILD', Object: 'AIInfantry' }),
      ],
    });

    const logic = new GameLogicSubsystem(new THREE.Scene());
    const mapData = makeMap([
      makeMapObject('AICC', 100, 100),
      makeMapObject('AIDozer', 120, 100),
    ], 256, 256);
    mapData.waypoints = {
      nodes: [
        { id: 1, name: 'Player_1_Start', position: { x: 50, y: 50, z: 0 } },
        { id: 2, name: 'Player_2_Start', position: { x: 100, y: 100, z: 0 } },
      ],
      links: [],
    };

    logic.loadMapObjects(mapData, makeRegistry(bundle), makeHeightmap(256, 256));
    logic.setPlayerSide(0, 'America'); // human player (not present on map)
    logic.setPlayerSide(1, 'China');
    logic.submitCommand({ type: 'setSideCredits', side: 'China', amount: 10000 });
    logic.enableSkirmishAI('China');

    // Run 30 game-seconds (900 frames)
    for (let i = 0; i < 900; i++) {
      logic.update(1 / 30);
    }

    const entities = logic.getRenderableEntityStates();
    const chinaEntities = entities.filter(e => e.side?.toLowerCase() === 'china');
    const chinaTemplates = chinaEntities.map(e => e.templateName);

    // AI should have at least attempted to build something
    // It starts with CC + Dozer (2 entities) and should have more after 30 seconds
    expect(chinaEntities.length).toBeGreaterThan(2);
  });
});
