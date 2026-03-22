import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import type { IniBlock } from '@generals/core';
import {
  IniDataRegistry,
  type IniDataBundle,
  type ObjectDef,
  type WeaponDef,
  type LocomotorDef,
} from '@generals/ini-data';
import { HeightmapGrid, type MapDataJSON, type MapObjectJSON, uint8ArrayToBase64 } from '@generals/terrain';
import { GameLogicSubsystem } from '@generals/game-logic';
import type { LoadedModelAsset } from './object-visuals.js';
import { ObjectVisualManager } from './object-visuals.js';

function makeBlock(
  type: string,
  name: string,
  fields: Record<string, unknown>,
  blocks: IniBlock[] = [],
): IniBlock {
  return {
    type,
    name,
    fields: fields as Record<string, string | number | boolean | string[] | number[]>,
    blocks,
  };
}

function makeObjectDef(
  name: string,
  side: string,
  kindOf: string[],
  blocks: IniBlock[],
  fields: Record<string, unknown> = {},
): ObjectDef {
  return {
    name,
    side,
    kindOf,
    fields: fields as Record<string, string | number | boolean | string[] | number[]>,
    blocks,
    resolved: true,
  };
}

function makeWeaponDef(name: string, fields: Record<string, unknown>): WeaponDef {
  return {
    name,
    fields: fields as Record<string, string | number | boolean | string[] | number[]>,
    blocks: [],
  };
}

function makeLocomotorDef(name: string, speed: number): LocomotorDef {
  return {
    name,
    fields: { Speed: speed },
    surfaces: ['GROUND'],
    surfaceMask: 1,
    downhillOnly: false,
    speed,
  };
}

function makeBundle(params: {
  objects: ObjectDef[];
  weapons?: WeaponDef[];
  locomotors?: LocomotorDef[];
}): IniDataBundle {
  const weapons = params.weapons ?? [];
  const locomotors = params.locomotors ?? [];
  return {
    objects: params.objects,
    weapons,
    armors: [],
    upgrades: [],
    commandButtons: [],
    commandSets: [],
    sciences: [],
    factions: [],
    locomotors,
    ai: {
      attackUsesLineOfSight: true,
    },
    stats: {
      objects: params.objects.length,
      weapons: weapons.length,
      armors: 0,
      upgrades: 0,
      sciences: 0,
      factions: 0,
      unresolvedInheritance: 0,
      totalBlocks:
        params.objects.length + weapons.length + locomotors.length,
    },
    errors: [],
    unsupportedBlockTypes: [],
  };
}

function makeRegistry(bundle: IniDataBundle): IniDataRegistry {
  const registry = new IniDataRegistry();
  registry.loadBundle(bundle);
  return registry;
}

function makeHeightmap(width = 16, height = 16): HeightmapGrid {
  const data = new Uint8Array(width * height).fill(0);
  return HeightmapGrid.fromJSON({
    width,
    height,
    borderSize: 0,
    data: uint8ArrayToBase64(data),
  });
}

function makeMap(objects: MapObjectJSON[], width = 16, height = 16): MapDataJSON {
  const data = new Uint8Array(width * height).fill(0);
  return {
    heightmap: {
      width,
      height,
      borderSize: 0,
      data: uint8ArrayToBase64(data),
    },
    objects,
    triggers: [],
    textureClasses: [],
    blendTileCount: 0,
  };
}

function makeMapObject(
  templateName: string,
  x: number,
  z: number,
): MapObjectJSON {
  return {
    templateName,
    angle: 0,
    flags: 0,
    position: { x, y: z, z: 0 },
    properties: {},
  };
}

function flushModelLoadQueue(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function modelWithAnimationClips(clips: readonly string[] = []): LoadedModelAsset {
  const scene = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  scene.add(mesh);

  const createdClips = clips.map((clipName) => new THREE.AnimationClip(
    clipName,
    1,
    [
      new THREE.NumberKeyframeTrack(
        '.position[x]',
        [0, 1],
        [0, 0],
      ),
    ],
  ));

  return {
    scene,
    animations: createdClips,
  };
}

describe('renderer/game-logic integration', () => {
  it('consumes game-logic render snapshots for assets and animation transitions', async () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef(
          'RenderSourceTank',
          'America',
          ['VEHICLE'],
          [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
            makeBlock('LocomotorSet', 'SET_NORMAL Crawler', {}),
            makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'TankCannon'] }),
            makeBlock('Draw', 'W3DModelDraw ModuleTag_Draw', {}, [
              makeBlock('ModelConditionState', 'DefaultModelConditionState', { Model: 'TankMesh' }),
            ]),
          ],
        ),
        makeObjectDef('RenderTarget', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ]),
      ],
      weapons: [
        makeWeaponDef('TankCannon', {
          AttackRange: 160,
          PrimaryDamage: 25,
          DelayBetweenShots: 1000,
        }),
      ],
      locomotors: [makeLocomotorDef('Crawler', 100)],
    });

    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('RenderSourceTank', 10, 10),
        makeMapObject('RenderTarget', 30, 10),
        makeMapObject('MissingTemplate', 42, 10),
      ]),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);

    const requestedPaths: string[] = [];
    const manager = new ObjectVisualManager(scene, null, {
      modelLoader: async (assetPath) => {
        requestedPaths.push(assetPath);
        return modelWithAnimationClips(['Idle', 'Move', 'Attack', 'Die']);
      },
    });

    const dt = 1 / 30;
    manager.sync(logic.getRenderableEntityStates(), dt);
    await flushModelLoadQueue();

    expect(requestedPaths).toContain('TankMesh.gltf');
    expect(manager.getVisualState(1)?.hasModel).toBe(true);
    expect(manager.getVisualState(1)?.animationState).toBe('IDLE');
    // Entity 2 (RenderTarget — no Draw module) has no renderAssetPath,
    // so it is treated as intentionally invisible.
    // Entity 3 (MissingTemplate — no INI def) uses its templateName as
    // a render asset candidate, so the renderer attempts to load a model.
    expect(manager.getVisualState(3)?.hasModel).toBe(true);

    manager.sync(logic.getRenderableEntityStates(), dt);
    expect(manager.getVisualState(1)?.animationState).toBe('IDLE');

    logic.submitCommand({ type: 'moveTo', entityId: 1, targetX: 40, targetZ: 10 });
    logic.update(dt);
    manager.sync(logic.getRenderableEntityStates(), dt);
    await flushModelLoadQueue();
    expect(manager.getVisualState(1)?.animationState).toBe('MOVE');

    logic.submitCommand({ type: 'attackEntity', entityId: 1, targetEntityId: 2 });
    logic.update(dt);
    manager.sync(logic.getRenderableEntityStates(), dt);
    await flushModelLoadQueue();
    expect(manager.getVisualState(1)?.animationState).toBe('ATTACK');

    const logicWithPrivateAccess = logic as unknown as {
      markEntityDestroyed: (entityId: number, attackerId: number) => void;
    };
    logicWithPrivateAccess.markEntityDestroyed(1, 2);
    manager.sync(logic.getRenderableEntityStates(), dt);
    await flushModelLoadQueue();
    expect(manager.getVisualState(1)?.animationState).toBe('DIE');
  });
});
