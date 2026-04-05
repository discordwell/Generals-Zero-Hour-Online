import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { GameLogicSubsystem } from './index.js';

describe('sides-list save-state', () => {
  it('captures map sides-list runtime in the source sides-list chunk instead of script-engine chunk', () => {
    const logic = new GameLogicSubsystem(new THREE.Scene());
    const privateLogic = logic as unknown as {
      mapScriptLists: Array<{
        scripts: Array<{
          name: string;
          nameUpper: string;
          active: boolean;
          oneShot: boolean;
          easy: boolean;
          normal: boolean;
          hard: boolean;
          subroutine: boolean;
          delayEvaluationSeconds: number;
          frameToEvaluateAt: number;
          conditionTeamNameUpper: string | null;
          sourceSideIndex: number;
          conditions: unknown[];
          actions: unknown[];
          falseActions: unknown[];
        }>;
        groups: unknown[];
      }>;
      mapScriptsByNameUpper: Map<string, unknown>;
      mapScriptGroupsByNameUpper: Map<string, unknown>;
      scriptPlayerSideByName: Map<string, string>;
      scriptDefaultTeamNameBySide: Map<string, string>;
      mapScriptSideByIndex: string[];
      mapScriptDifficultyByIndex: number[];
      mapScriptDifficultyByPlayerToken: Map<string, number>;
      scriptAiBuildListEntriesBySide: Map<string, unknown[]>;
    };

    const introScript = {
      name: 'IntroScript',
      nameUpper: 'INTROSCRIPT',
      active: true,
      oneShot: false,
      easy: true,
      normal: true,
      hard: true,
      subroutine: false,
      delayEvaluationSeconds: 0,
      frameToEvaluateAt: 30,
      conditionTeamNameUpper: null,
      sourceSideIndex: 0,
      conditions: [],
      actions: [],
      falseActions: [],
    };

    privateLogic.mapScriptLists.push({
      scripts: [introScript],
      groups: [],
    });
    privateLogic.mapScriptsByNameUpper.set('INTROSCRIPT', introScript);
    privateLogic.scriptPlayerSideByName.set('THE_PLAYER', 'america');
    privateLogic.scriptDefaultTeamNameBySide.set('america', 'TEAMTHEPLAYER');
    privateLogic.mapScriptSideByIndex.push('america');
    privateLogic.mapScriptDifficultyByIndex.push(1);
    privateLogic.mapScriptDifficultyByPlayerToken.set('THE_PLAYER', 1);
    privateLogic.scriptAiBuildListEntriesBySide.set('america', [{
      buildingName: 'AmericaBarracks',
      templateName: 'AmericaBarracks',
      x: 12,
      z: 18,
      rebuilds: 0,
      angle: 0,
      initiallyBuilt: true,
      automaticallyBuild: true,
      priorityBuild: false,
    }]);

    const sidesListState = logic.captureSourceSidesListRuntimeSaveState();
    const scriptEngineState = logic.captureSourceScriptEngineRuntimeSaveState();
    const browserState = logic.captureBrowserRuntimeSaveState();

    expect(sidesListState.state.mapScriptLists).toEqual([{
      scripts: [introScript],
      groups: [],
    }]);
    expect(sidesListState.state.scriptPlayerSideByName).toEqual(new Map([['THE_PLAYER', 'america']]));
    expect(sidesListState.state.scriptDefaultTeamNameBySide).toEqual(new Map([['america', 'TEAMTHEPLAYER']]));
    expect(sidesListState.state.mapScriptSideByIndex).toEqual(['america']);
    expect(sidesListState.state.mapScriptDifficultyByIndex).toEqual([1]);
    expect(sidesListState.state.mapScriptDifficultyByPlayerToken).toEqual(new Map([['THE_PLAYER', 1]]));
    expect(scriptEngineState.state).not.toHaveProperty('mapScriptLists');
    expect(scriptEngineState.state).not.toHaveProperty('scriptPlayerSideByName');
    expect(browserState).not.toHaveProperty('mapScriptLists');
    expect(browserState).not.toHaveProperty('scriptPlayerSideByName');

    const restored = new GameLogicSubsystem(new THREE.Scene());
    restored.restoreSourceSidesListRuntimeSaveState(sidesListState);

    const restoredPrivate = restored as unknown as typeof privateLogic;
    expect(restoredPrivate.mapScriptLists).toEqual([{
      scripts: [introScript],
      groups: [],
    }]);
    expect(restoredPrivate.mapScriptsByNameUpper).toEqual(new Map([['INTROSCRIPT', introScript]]));
    expect(restoredPrivate.scriptPlayerSideByName).toEqual(new Map([['THE_PLAYER', 'america']]));
    expect(restoredPrivate.scriptDefaultTeamNameBySide).toEqual(new Map([['america', 'TEAMTHEPLAYER']]));
    expect(restoredPrivate.mapScriptSideByIndex).toEqual(['america']);
    expect(restoredPrivate.mapScriptDifficultyByIndex).toEqual([1]);
    expect(restoredPrivate.mapScriptDifficultyByPlayerToken).toEqual(new Map([['THE_PLAYER', 1]]));
    expect(restoredPrivate.scriptAiBuildListEntriesBySide).toEqual(new Map([['america', [{
      buildingName: 'AmericaBarracks',
      templateName: 'AmericaBarracks',
      x: 12,
      z: 18,
      rebuilds: 0,
      angle: 0,
      initiallyBuilt: true,
      automaticallyBuild: true,
      priorityBuild: false,
    }]]]));
  });
});
