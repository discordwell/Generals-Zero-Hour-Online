import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { GameLogicSubsystem } from './index.js';

describe('script-engine save-state', () => {
  it('captures and restores source script-engine runtime state', () => {
    const logic = new GameLogicSubsystem(new THREE.Scene());
    const privateLogic = logic as unknown as {
      scriptSequentialScripts: Array<{
        scriptNameUpper: string;
        objectId: number | null;
        teamNameUpper: string | null;
        currentInstruction: number;
        timesToLoop: number;
        framesToWait: number;
        dontAdvanceInstruction: boolean;
        nextScript: {
          scriptNameUpper: string;
          objectId: number | null;
          teamNameUpper: string | null;
          currentInstruction: number;
          timesToLoop: number;
          framesToWait: number;
          dontAdvanceInstruction: boolean;
          nextScript: null;
        } | null;
      }>;
      scriptCountersByName: Map<string, { value: number; isCountdownTimer: boolean }>;
      scriptFlagsByName: Map<string, boolean>;
      scriptCompletedVideos: string[];
      scriptTestingSpeechCompletionFrameByName: Map<string, number>;
      scriptActiveByName: Map<string, boolean>;
      scriptSubroutineCalls: string[];
      scriptCameraMovementFinished: boolean;
      scriptTeamsByName: Map<string, {
        nameUpper: string;
        prototypeNameUpper: string;
        memberEntityIds: Set<number>;
        created: boolean;
        stateName: string;
        attackPrioritySetName: string;
        recruitableOverride: boolean | null;
        isAIRecruitable: boolean;
        homeWaypointName: string;
        controllingSide: string | null;
        controllingPlayerToken: string | null;
        isSingleton: boolean;
        maxInstances: number;
        productionPriority: number;
        productionPrioritySuccessIncrease: number;
        productionPriorityFailureDecrease: number;
        reinforcementUnitEntries: unknown[];
        reinforcementTransportTemplateName: string;
        reinforcementStartWaypointName: string;
        reinforcementTeamStartsFull: boolean;
        reinforcementTransportsExit: boolean;
      }>;
      sideScriptAcquiredSciences: Map<string, Set<string>>;
      scriptTimeFrozenByScript: boolean;
      scriptChooseVictimAlwaysUsesNormal: boolean;
      scriptObjectTypeListsByName: Map<string, string[]>;
      scriptNamedMapRevealByName: Map<string, {
        playerIndex: number;
        worldX: number;
        worldZ: number;
        radius: number;
        applied: boolean;
      }>;
      scriptAttackPrioritySetsByName: Map<string, {
        nameUpper: string;
        defaultPriority: number;
        templatePriorityByName: Map<string, number>;
      }>;
      scriptMusicTrackState: { trackName: string; fadeOut: boolean; fadeIn: boolean; frame: number } | null;
    };

    privateLogic.scriptSequentialScripts.push({
      scriptNameUpper: 'PLAY_INTRO',
      objectId: 7,
      teamNameUpper: null,
      currentInstruction: 2,
      timesToLoop: 1,
      framesToWait: 15,
      dontAdvanceInstruction: false,
      nextScript: {
        scriptNameUpper: 'PLAY_OUTRO',
        objectId: 7,
        teamNameUpper: null,
        currentInstruction: -1,
        timesToLoop: 0,
        framesToWait: -1,
        dontAdvanceInstruction: false,
        nextScript: null,
      },
    });
    privateLogic.scriptCountersByName.set('missiontimer', { value: 45, isCountdownTimer: true });
    privateLogic.scriptFlagsByName.set('intro_complete', true);
    privateLogic.scriptCompletedVideos.push('USA_BNN_INTRO');
    privateLogic.scriptTestingSpeechCompletionFrameByName.set('BriefingLine01', 90);
    privateLogic.scriptActiveByName.set('INTROSCRIPT', false);
    privateLogic.scriptSubroutineCalls.push('CHECK_OBJECTIVES');
    privateLogic.scriptCameraMovementFinished = false;
    privateLogic.scriptTeamsByName.set('TEAMTHEPLAYER', {
      nameUpper: 'TEAMTHEPLAYER',
      prototypeNameUpper: 'TEAMTHEPLAYER',
      memberEntityIds: new Set([7]),
      created: true,
      stateName: 'ATTACKING',
      attackPrioritySetName: 'ANTIVEHICLESET',
      recruitableOverride: null,
      isAIRecruitable: true,
      homeWaypointName: 'HOME',
      controllingSide: 'america',
      controllingPlayerToken: 'the_player',
      isSingleton: true,
      maxInstances: 1,
      productionPriority: 3,
      productionPrioritySuccessIncrease: 0,
      productionPriorityFailureDecrease: 0,
      reinforcementUnitEntries: [],
      reinforcementTransportTemplateName: '',
      reinforcementStartWaypointName: '',
      reinforcementTeamStartsFull: false,
      reinforcementTransportsExit: false,
    });
    privateLogic.sideScriptAcquiredSciences.set('america', new Set(['SCIENCE_PARTICLE_UPLINK_CANNON']));
    privateLogic.scriptTimeFrozenByScript = true;
    privateLogic.scriptChooseVictimAlwaysUsesNormal = true;
    privateLogic.scriptObjectTypeListsByName.set('RAIDTARGETS', ['SupplyCenter', 'Dozer']);
    privateLogic.scriptNamedMapRevealByName.set('FOCUS_AREA', {
      playerIndex: 0,
      worldX: 120,
      worldZ: 240,
      radius: 80,
      applied: true,
    });
    privateLogic.scriptAttackPrioritySetsByName.set('ANTIVEHICLESET', {
      nameUpper: 'ANTIVEHICLESET',
      defaultPriority: 3,
      templatePriorityByName: new Map([['BattlemasterTank', 11]]),
    });
    privateLogic.scriptMusicTrackState = {
      trackName: 'Score_usa',
      fadeOut: true,
      fadeIn: false,
      frame: 12,
    };

    const captured = logic.captureSourceScriptEngineRuntimeSaveState();

    expect(captured.version).toBe(1);

    const restored = new GameLogicSubsystem(new THREE.Scene());
    restored.restoreSourceScriptEngineRuntimeSaveState(captured);

    const restoredPrivate = restored as unknown as typeof privateLogic;
    expect(restoredPrivate.scriptSequentialScripts).toEqual(privateLogic.scriptSequentialScripts);
    expect(restoredPrivate.scriptCountersByName).toEqual(
      new Map([['missiontimer', { value: 45, isCountdownTimer: true }]]),
    );
    expect(restoredPrivate.scriptFlagsByName).toEqual(new Map([['intro_complete', true]]));
    expect(restoredPrivate.scriptCompletedVideos).toEqual(['USA_BNN_INTRO']);
    expect(restoredPrivate.scriptTestingSpeechCompletionFrameByName).toEqual(
      new Map([['BriefingLine01', 90]]),
    );
    expect(restoredPrivate.scriptActiveByName).toEqual(new Map([['INTROSCRIPT', false]]));
    expect(restoredPrivate.scriptSubroutineCalls).toEqual(['CHECK_OBJECTIVES']);
    expect(restoredPrivate.scriptCameraMovementFinished).toBe(false);
    expect(restoredPrivate.scriptTeamsByName).toEqual(privateLogic.scriptTeamsByName);
    expect(restoredPrivate.sideScriptAcquiredSciences).toEqual(
      new Map([['america', new Set(['SCIENCE_PARTICLE_UPLINK_CANNON'])]]),
    );
    expect(restoredPrivate.scriptTimeFrozenByScript).toBe(true);
    expect(restoredPrivate.scriptChooseVictimAlwaysUsesNormal).toBe(true);
    expect(restoredPrivate.scriptObjectTypeListsByName).toEqual(
      new Map([['RAIDTARGETS', ['SupplyCenter', 'Dozer']]]),
    );
    expect(restoredPrivate.scriptNamedMapRevealByName).toEqual(
      new Map([['FOCUS_AREA', {
        playerIndex: 0,
        worldX: 120,
        worldZ: 240,
        radius: 80,
        applied: true,
      }]]),
    );
    expect(restoredPrivate.scriptAttackPrioritySetsByName).toEqual(
      new Map([['ANTIVEHICLESET', {
        nameUpper: 'ANTIVEHICLESET',
        defaultPriority: 3,
        templatePriorityByName: new Map([['BattlemasterTank', 11]]),
      }]]),
    );
    expect(restoredPrivate.scriptMusicTrackState).toEqual({
      trackName: 'Score_usa',
      fadeOut: true,
      fadeIn: false,
      frame: 12,
    });
  });
});
