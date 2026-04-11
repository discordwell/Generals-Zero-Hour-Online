import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { GameLogicSubsystem } from './index.js';

describe('skirmish AI save-state', () => {
  it('stores skirmish AI runtime in the player chunk instead of the browser runtime blob', () => {
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.enableSkirmishAI('America');

    const privateLogic = logic as unknown as {
      skirmishAIStates: Map<string, {
        builtStructureKeywords: Set<string>;
        lastAttackCheckFrame?: number;
      }>;
    };
    privateLogic.skirmishAIStates.get('america')?.builtStructureKeywords.add('PATRIOT');

    const playerState = logic.captureSourcePlayerRuntimeSaveState();
    const browserState = logic.captureBrowserRuntimeSaveState();

    const capturedState = playerState.state.skirmishAIStates as Map<string, {
      builtStructureKeywords: Set<string>;
    }>;
    expect(capturedState.get('america')?.builtStructureKeywords.has('PATRIOT')).toBe(true);
    expect(browserState).not.toHaveProperty('skirmishAIStates');

    const restored = new GameLogicSubsystem(new THREE.Scene());
    restored.restoreSourcePlayerRuntimeSaveState(playerState);

    const restoredPrivate = restored as unknown as typeof privateLogic;
    expect(restoredPrivate.skirmishAIStates.get('america')?.builtStructureKeywords.has('PATRIOT')).toBe(true);
  });

  it('hydrates legacy browser skirmish AI state into the player-owned runtime', () => {
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.restoreBrowserRuntimeSaveState({
      version: 1,
      gameRandomSeed: 1,
      skirmishAIStates: new Map([
        ['america', {
          builtStructureKeywords: new Set(['PATRIOT']),
          lastAttackCheckFrame: 240,
        }],
      ]),
    });

    const privateLogic = logic as unknown as {
      skirmishAIStates: Map<string, {
        builtStructureKeywords: Set<string>;
        lastAttackCheckFrame?: number;
      }>;
    };
    expect(privateLogic.skirmishAIStates.get('america')?.builtStructureKeywords.has('PATRIOT')).toBe(true);
    expect(privateLogic.skirmishAIStates.get('america')?.lastAttackCheckFrame).toBe(240);
  });

  it('hydrates source AIPlayer skirmish markers into active skirmish AI runtime', () => {
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.restoreSourcePlayerRuntimeSaveState({
      version: 1,
      state: {
        skirmishAIStates: new Map([
          ['America', {}],
        ]),
      },
    });

    const privateLogic = logic as unknown as {
      skirmishAIStates: Map<string, {
        enabled: boolean;
        side: string;
        builtStructureKeywords: Set<string>;
        scoutWaypoints: Array<{ x: number; z: number }>;
      }>;
    };
    const restoredState = privateLogic.skirmishAIStates.get('america');
    expect(restoredState?.enabled).toBe(true);
    expect(restoredState?.side).toBe('america');
    expect(restoredState?.builtStructureKeywords).toBeInstanceOf(Set);
    expect(restoredState?.scoutWaypoints).toEqual([]);
  });

  it('captures live AIPlayer fields back into source player AI state', () => {
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.enableSkirmishAI('America');

    const privateLogic = logic as unknown as {
      sideSourceAiPlayerState: Map<string, Record<string, unknown>>;
      sideScriptSkillset: Map<string, number>;
      scriptCurrentSupplyWarehouseBySide: Map<string, number>;
      sideTeamBuildDelaySecondsByScript: Map<string, number>;
      scriptSkirmishBaseCenterAndRadiusBySide: Map<string, { centerX: number; centerZ: number; radius: number }>;
      scriptSideRepairQueue: Map<string, Set<number>>;
      scriptSkirmishBaseDefenseStateBySide: Map<string, Record<string, number>>;
    };
    privateLogic.sideSourceAiPlayerState.set('America', {
      isSkirmishAi: false,
      teamBuildQueue: [{ teamId: 7 }],
      teamReadyQueue: [],
      skillsetSelector: 0,
      currentWarehouseId: 1,
      teamSeconds: 10,
      baseCenter: { x: 1, y: 0, z: 2 },
      baseCenterSet: false,
      baseRadius: 0,
      structuresToRepair: [99],
      structuresInQueue: 1,
      curFrontBaseDefense: 0,
      curFlankBaseDefense: 0,
      curFrontLeftDefenseAngle: 0,
      curFrontRightDefenseAngle: 0,
      curLeftFlankLeftDefenseAngle: 0,
      curLeftFlankRightDefenseAngle: 0,
      curRightFlankLeftDefenseAngle: 0,
      curRightFlankRightDefenseAngle: 0,
    });
    privateLogic.sideScriptSkillset.set('america', 2);
    privateLogic.scriptCurrentSupplyWarehouseBySide.set('america', 42);
    privateLogic.sideTeamBuildDelaySecondsByScript.set('america', 18);
    privateLogic.scriptSkirmishBaseCenterAndRadiusBySide.set('america', {
      centerX: 100,
      centerZ: 200,
      radius: 300,
    });
    privateLogic.scriptSideRepairQueue.set('america', new Set([5, 6, 7]));
    privateLogic.scriptSkirmishBaseDefenseStateBySide.set('america', {
      curFrontBaseDefense: 3,
      curFlankBaseDefense: 4,
      curFrontLeftDefenseAngle: 0.1,
      curFrontRightDefenseAngle: 0.2,
      curLeftFlankLeftDefenseAngle: 0.3,
      curLeftFlankRightDefenseAngle: 0.4,
      curRightFlankLeftDefenseAngle: 0.5,
      curRightFlankRightDefenseAngle: 0.6,
    });

    const playerState = logic.captureSourcePlayerRuntimeSaveState();
    const aiState = (playerState.state.sideSourceAiPlayerState as Map<string, Record<string, unknown>>)
      .get('America');

    expect(aiState?.teamBuildQueue).toEqual([{ teamId: 7 }]);
    expect(aiState?.isSkirmishAi).toBe(true);
    expect(aiState?.skillsetSelector).toBe(2);
    expect(aiState?.currentWarehouseId).toBe(42);
    expect(aiState?.teamSeconds).toBe(18);
    expect(aiState?.baseCenter).toEqual({ x: 100, y: 0, z: 200 });
    expect(aiState?.baseCenterSet).toBe(true);
    expect(aiState?.baseRadius).toBe(300);
    expect(aiState?.structuresToRepair).toEqual([5, 6]);
    expect(aiState?.structuresInQueue).toBe(2);
    expect(aiState?.curFrontBaseDefense).toBe(3);
    expect(aiState?.curRightFlankRightDefenseAngle).toBe(0.6);
  });
});
