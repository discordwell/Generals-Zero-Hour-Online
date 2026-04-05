import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { GameLogicSubsystem } from './index.js';

describe('team-factory save-state', () => {
  it('captures team registry runtime in the source team-factory chunk instead of script-engine chunk', () => {
    const logic = new GameLogicSubsystem(new THREE.Scene());
    const privateLogic = logic as unknown as {
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
      scriptTeamInstanceNamesByPrototypeName: Map<string, string[]>;
    };

    const teamRecord = {
      nameUpper: 'TEAMTHEPLAYER',
      prototypeNameUpper: 'TEAMTHEPLAYER',
      sourcePrototypeId: undefined,
      sourceTeamId: undefined,
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
    };

    privateLogic.scriptTeamsByName.set('TEAMTHEPLAYER', teamRecord);
    privateLogic.scriptTeamInstanceNamesByPrototypeName.set('TEAMTHEPLAYER', ['TEAMTHEPLAYER']);

    const teamFactoryState = logic.captureSourceTeamFactoryRuntimeSaveState();
    const scriptEngineState = logic.captureSourceScriptEngineRuntimeSaveState();
    const browserState = logic.captureBrowserRuntimeSaveState();

    const savedTeams = teamFactoryState.state.scriptTeamsByName as Map<string, typeof teamRecord>;
    const savedTeam = savedTeams.get('TEAMTHEPLAYER');
    expect(savedTeam).toBeDefined();
    expect(savedTeam).toMatchObject({
      ...teamRecord,
      sourcePrototypeId: expect.any(Number),
      sourceTeamId: expect.any(Number),
    });
    expect(teamFactoryState.state.scriptTeamInstanceNamesByPrototypeName).toEqual(
      new Map([['TEAMTHEPLAYER', ['TEAMTHEPLAYER']]]),
    );
    expect(teamFactoryState.state.scriptNextSourceTeamId).toBe(
      ((savedTeam?.sourceTeamId as number) ?? 0) + 1,
    );
    expect(teamFactoryState.state.scriptNextSourceTeamPrototypeId).toBe(
      ((savedTeam?.sourcePrototypeId as number) ?? 0) + 1,
    );
    expect(scriptEngineState.state).not.toHaveProperty('scriptTeamsByName');
    expect(scriptEngineState.state).not.toHaveProperty('scriptTeamInstanceNamesByPrototypeName');
    expect(browserState).not.toHaveProperty('scriptTeamsByName');
    expect(browserState).not.toHaveProperty('scriptTeamInstanceNamesByPrototypeName');

    const restored = new GameLogicSubsystem(new THREE.Scene());
    restored.restoreSourceTeamFactoryRuntimeSaveState(teamFactoryState);

    const restoredPrivate = restored as unknown as typeof privateLogic;
    expect(restoredPrivate.scriptTeamsByName).toEqual(new Map([['TEAMTHEPLAYER', savedTeam!]]));
    expect(restoredPrivate.scriptTeamInstanceNamesByPrototypeName).toEqual(
      new Map([['TEAMTHEPLAYER', ['TEAMTHEPLAYER']]]),
    );
  });
});
