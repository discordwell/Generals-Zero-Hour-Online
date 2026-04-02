import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AssetManager } from '@generals/assets';

import {
  TerrainBridgeRenderer,
  calculateSectionalBridgeSpanCount,
  extractBridgeSegments,
  type TerrainBridgeDefinition,
} from './terrain-bridges.js';

function makeBridgeObj(
  x: number,
  z: number,
  flags: number,
  templateName = 'EuropeanBridgeWide',
) {
  return { position: { x, y: z, z: 0 }, flags, templateName };
}

function createSectionalBridgeScene(): THREE.Object3D {
  const scene = new THREE.Group();

  const left = new THREE.Mesh(new THREE.BoxGeometry(50, 10, 20), new THREE.MeshBasicMaterial());
  left.name = 'BRIDGE_LEFT';
  left.position.x = -25;
  scene.add(left);

  const span = new THREE.Mesh(new THREE.BoxGeometry(100, 10, 20), new THREE.MeshBasicMaterial());
  span.name = 'BRIDGE_SPAN';
  span.position.x = 50;
  scene.add(span);

  const right = new THREE.Mesh(new THREE.BoxGeometry(50, 10, 20), new THREE.MeshBasicMaterial());
  right.name = 'BRIDGE_RIGHT';
  right.position.x = 125;
  scene.add(right);

  return scene;
}

describe('extractBridgeSegments', () => {
  it('pairs sequential BRIDGE_POINT1 and BRIDGE_POINT2 objects', () => {
    const segments = extractBridgeSegments([
      makeBridgeObj(0, 0, 0x010),
      makeBridgeObj(100, 0, 0x020),
    ]);

    expect(segments).toHaveLength(1);
    expect(segments[0]!.start.x).toBe(0);
    expect(segments[0]!.end.x).toBe(100);
    expect(segments[0]!.templateName).toBe('EuropeanBridgeWide');
  });

  it('ignores unmatched first bridge points', () => {
    const segments = extractBridgeSegments([
      makeBridgeObj(0, 0, 0x010),
      makeBridgeObj(100, 0, 0x000),
    ]);

    expect(segments).toHaveLength(0);
  });
});

describe('calculateSectionalBridgeSpanCount', () => {
  it('matches the source num-span rounding behavior', () => {
    expect(calculateSectionalBridgeSpanCount(200, 200, 100)).toBe(1);
    expect(calculateSectionalBridgeSpanCount(260, 200, 100)).toBe(2);
    expect(calculateSectionalBridgeSpanCount(40, 200, 100)).toBe(0);
  });
});

describe('TerrainBridgeRenderer', () => {
  let scene: THREE.Scene;
  let renderer: TerrainBridgeRenderer;

  beforeEach(() => {
    scene = new THREE.Scene();
    renderer = new TerrainBridgeRenderer(
      scene,
      {
        resolveModelPath: () => 'models/W3D/Art/W3D/CBWBrdgeArc.glb',
      } as unknown as AssetManager,
      {
        modelLoader: async () => createSectionalBridgeScene(),
      },
    );
  });

  afterEach(() => {
    renderer.dispose();
  });

  it('builds bridge visuals from BRIDGE_POINT map objects', async () => {
    const definitions = new Map<string, TerrainBridgeDefinition>([
      ['EUROPEANBRIDGEWIDE', { name: 'EuropeanBridgeWide', modelName: 'CBWBrdgeArc', scale: 1 }],
    ]);

    await renderer.buildFromMapObjects([
      makeBridgeObj(0, 0, 0x010),
      makeBridgeObj(200, 0, 0x020),
    ], () => 0, definitions);

    expect(renderer.getBridgeCount()).toBe(1);
    expect(scene.getObjectByName('terrain-bridge')).toBeTruthy();
  });
});
