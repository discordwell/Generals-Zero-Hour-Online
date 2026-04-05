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
});
