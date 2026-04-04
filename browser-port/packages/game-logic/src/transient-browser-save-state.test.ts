import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { GameLogicSubsystem } from './index.js';

describe('transient browser save-state', () => {
  it('omits command queue and EVA cooldowns from browser runtime saves', () => {
    const logic = new GameLogicSubsystem(new THREE.Scene());
    const privateLogic = logic as unknown as {
      commandQueue: Array<{ type: string; entityId: number; x: number; z: number }>;
      evaCooldowns: Map<string, number>;
    };

    privateLogic.commandQueue.push({ type: 'moveTo', entityId: 1, x: 10, z: 20 });
    privateLogic.evaCooldowns.set('UNIT_LOST:america:own', 180);

    const browserState = logic.captureBrowserRuntimeSaveState();
    expect(browserState).not.toHaveProperty('commandQueue');
    expect(browserState).not.toHaveProperty('evaCooldowns');

    const restored = new GameLogicSubsystem(new THREE.Scene());
    restored.restoreBrowserRuntimeSaveState(browserState);

    const restoredPrivate = restored as unknown as typeof privateLogic;
    expect(restoredPrivate.commandQueue).toEqual([]);
    expect(restoredPrivate.evaCooldowns).toEqual(new Map());
  });
});
