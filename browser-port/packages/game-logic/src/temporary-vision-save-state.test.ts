import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { GameLogicSubsystem } from './index.js';

describe('temporary vision save-state', () => {
  it('stores temporary fog reveals in the script-engine chunk instead of the browser runtime blob', () => {
    const logic = new GameLogicSubsystem(new THREE.Scene());
    const privateLogic = logic as unknown as {
      temporaryVisionReveals: Array<{
        playerIndex: number;
        worldX: number;
        worldZ: number;
        radius: number;
        expiryFrame: number;
      }>;
    };

    privateLogic.temporaryVisionReveals.push({
      playerIndex: 1,
      worldX: 80,
      worldZ: 44,
      radius: 30,
      expiryFrame: 900,
    });

    const scriptState = logic.captureSourceScriptEngineRuntimeSaveState();
    const browserState = logic.captureBrowserRuntimeSaveState();

    expect(scriptState.state.temporaryVisionReveals).toEqual([{
      playerIndex: 1,
      worldX: 80,
      worldZ: 44,
      radius: 30,
      expiryFrame: 900,
    }]);
    expect(browserState).not.toHaveProperty('temporaryVisionReveals');

    const restored = new GameLogicSubsystem(new THREE.Scene());
    restored.restoreSourceScriptEngineRuntimeSaveState(scriptState);

    const restoredPrivate = restored as unknown as typeof privateLogic;
    expect(restoredPrivate.temporaryVisionReveals).toEqual([{
      playerIndex: 1,
      worldX: 80,
      worldZ: 44,
      radius: 30,
      expiryFrame: 900,
    }]);
  });

  it('hydrates legacy browser temporary reveal state into the script-engine runtime', () => {
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.restoreBrowserRuntimeSaveState({
      version: 1,
      gameRandomSeed: 1,
      temporaryVisionReveals: [{
        playerIndex: 1,
        worldX: 80,
        worldZ: 44,
        radius: 30,
        expiryFrame: 900,
      }],
    });

    const privateLogic = logic as unknown as {
      temporaryVisionReveals: Array<{
        playerIndex: number;
        worldX: number;
        worldZ: number;
        radius: number;
        expiryFrame: number;
      }>;
    };
    expect(privateLogic.temporaryVisionReveals).toEqual([{
      playerIndex: 1,
      worldX: 80,
      worldZ: 44,
      radius: 30,
      expiryFrame: 900,
    }]);
  });
});
