/**
 * Terrain bridge rendering — source-backed bridge visuals from Roads.ini.
 *
 * Source parity: W3DBridgeBuffer builds bridge visuals from map BRIDGE_POINT1/2
 * objects and TerrainRoads bridge templates, not via ThingFactory entities.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { RUNTIME_ASSET_BASE_URL, type AssetManager } from '@generals/assets';

import type { HeightmapQuery } from './terrain-roads.js';

const BRIDGE_POINT1 = 0x010;
const BRIDGE_POINT2 = 0x020;
const BRIDGE_FLOAT_AMT = 0.25;
const BRIDGE_LEFT = 'BRIDGE_LEFT';
const BRIDGE_SPAN = 'BRIDGE_SPAN';
const BRIDGE_RIGHT = 'BRIDGE_RIGHT';

export interface BridgePoint {
  x: number;
  z: number;
  flags: number;
  templateName: string;
}

export interface BridgeSegment {
  start: BridgePoint;
  end: BridgePoint;
  templateName: string;
}

export interface TerrainBridgeDefinition {
  name: string;
  modelName: string;
  scale: number;
}

export interface TerrainBridgeRendererConfig {
  modelLoader?: (assetUrl: string) => Promise<THREE.Object3D>;
}

interface BridgeSectionPrototype {
  prototype: THREE.Object3D;
  minX: number;
  maxX: number;
}

interface LoadedBridgePrototype {
  scale: number;
  left: BridgeSectionPrototype;
  span: BridgeSectionPrototype | null;
  right: BridgeSectionPrototype | null;
  isSectional: boolean;
  leftMinX: number;
  leftMaxX: number;
  rightMinX: number;
  length: number;
  spanLength: number;
  dispose(): void;
}

function cloneBridgeObject(source: THREE.Object3D): THREE.Object3D {
  return SkeletonUtils.clone(source);
}

function setSectionVisibility(root: THREE.Object3D, visibleSectionNames: readonly string[]): void {
  const visible = new Set(visibleSectionNames.map((name) => name.toUpperCase()));
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) {
      return;
    }
    mesh.visible = visible.has(mesh.name.toUpperCase());
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
  });
}

function computeSectionBounds(sectionRoot: THREE.Object3D): THREE.Box3 | null {
  sectionRoot.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(sectionRoot);
  if (
    !Number.isFinite(bounds.min.x)
    || !Number.isFinite(bounds.max.x)
    || !Number.isFinite(bounds.min.y)
    || !Number.isFinite(bounds.max.y)
    || !Number.isFinite(bounds.min.z)
    || !Number.isFinite(bounds.max.z)
  ) {
    return null;
  }
  if (bounds.isEmpty()) {
    return null;
  }
  return bounds;
}

function buildSectionPrototype(sourceScene: THREE.Object3D, sectionName: string): BridgeSectionPrototype | null {
  const sectionRoot = cloneBridgeObject(sourceScene);
  setSectionVisibility(sectionRoot, [sectionName]);
  const bounds = computeSectionBounds(sectionRoot);
  if (!bounds) {
    return null;
  }
  return {
    prototype: sectionRoot,
    minX: bounds.min.x,
    maxX: bounds.max.x,
  };
}

export function extractBridgeSegments(
  objects: ReadonlyArray<{ position: { x: number; y: number; z: number }; flags: number; templateName: string }>,
): BridgeSegment[] {
  const segments: BridgeSegment[] = [];

  for (let index = 0; index < objects.length; index++) {
    const current = objects[index]!;
    if ((current.flags & BRIDGE_POINT1) === 0) {
      continue;
    }

    const next = objects[index + 1];
    if (!next || (next.flags & BRIDGE_POINT2) === 0) {
      continue;
    }

    segments.push({
      start: {
        x: current.position.x,
        z: current.position.y,
        flags: current.flags,
        templateName: current.templateName,
      },
      end: {
        x: next.position.x,
        z: next.position.y,
        flags: next.flags,
        templateName: next.templateName,
      },
      templateName: current.templateName,
    });
    index++;
  }

  return segments;
}

export function calculateSectionalBridgeSpanCount(
  desiredLength: number,
  bridgeLength: number,
  spanLength: number,
): number {
  if (spanLength <= 0) {
    return 1;
  }
  const spannable = desiredLength - (bridgeLength - spanLength);
  const numSpans = Math.floor((spannable + spanLength / 2) / spanLength);
  return Math.max(0, numSpans);
}

export class TerrainBridgeRenderer {
  private readonly scene: THREE.Scene;
  private readonly assetManager: AssetManager;
  private readonly modelLoader: (assetUrl: string) => Promise<THREE.Object3D>;
  private readonly gltfLoader = new GLTFLoader();
  private readonly activeRoots: THREE.Object3D[] = [];
  private readonly prototypeCache = new Map<string, Promise<LoadedBridgePrototype | null>>();

  constructor(
    scene: THREE.Scene,
    assetManager: AssetManager,
    config: TerrainBridgeRendererConfig = {},
  ) {
    this.scene = scene;
    this.assetManager = assetManager;
    this.modelLoader = config.modelLoader ?? this.createDefaultModelLoader.bind(this);
  }

  async buildFromMapObjects(
    objects: ReadonlyArray<{ position: { x: number; y: number; z: number }; flags: number; templateName: string }>,
    getHeight: HeightmapQuery,
    bridgeDefinitions: ReadonlyMap<string, TerrainBridgeDefinition>,
  ): Promise<void> {
    this.clearActiveRoots();

    const segments = extractBridgeSegments(objects);
    for (const segment of segments) {
      const definition = bridgeDefinitions.get(segment.templateName.trim().toUpperCase());
      if (!definition) {
        continue;
      }
      const prototype = await this.loadBridgePrototype(definition);
      if (!prototype) {
        continue;
      }
      const root = this.instantiateBridge(prototype, segment, getHeight);
      if (!root) {
        continue;
      }
      this.scene.add(root);
      this.activeRoots.push(root);
    }
  }

  getBridgeCount(): number {
    return this.activeRoots.length;
  }

  dispose(): void {
    this.clearActiveRoots();
    for (const pendingPrototype of this.prototypeCache.values()) {
      void pendingPrototype.then((prototype) => {
        prototype?.dispose();
      });
    }
    this.prototypeCache.clear();
  }

  private clearActiveRoots(): void {
    for (const root of this.activeRoots) {
      this.scene.remove(root);
    }
    this.activeRoots.length = 0;
  }

  private async loadBridgePrototype(definition: TerrainBridgeDefinition): Promise<LoadedBridgePrototype | null> {
    const cacheKey = definition.name.trim().toUpperCase();
    const existing = this.prototypeCache.get(cacheKey);
    if (existing) {
      return existing;
    }

    const pending = this.loadBridgePrototypeImpl(definition)
      .catch((error: unknown) => {
        console.warn(
          `[TerrainBridgeRenderer] Failed to load bridge "${definition.name}" from model "${definition.modelName}".`,
          error,
        );
        return null;
      });
    this.prototypeCache.set(cacheKey, pending);
    return pending;
  }

  private async loadBridgePrototypeImpl(definition: TerrainBridgeDefinition): Promise<LoadedBridgePrototype | null> {
    const resolvedPath = this.assetManager.resolveModelPath(definition.modelName);
    if (!resolvedPath) {
      console.warn(
        `[TerrainBridgeRenderer] Missing bridge model asset for "${definition.name}" (${definition.modelName}).`,
      );
      return null;
    }

    const assetUrl = `${RUNTIME_ASSET_BASE_URL}/${resolvedPath}`;
    const sourceScene = await this.modelLoader(assetUrl);
    const left = buildSectionPrototype(sourceScene, BRIDGE_LEFT);
    if (!left) {
      return null;
    }
    const span = buildSectionPrototype(sourceScene, BRIDGE_SPAN);
    const right = buildSectionPrototype(sourceScene, BRIDGE_RIGHT);

    let isSectional = span !== null && right !== null;
    let rightMinX = left.maxX;
    let spanLength = 0;
    let length = left.maxX - left.minX;

    if (isSectional && span && right) {
      rightMinX = right.minX;
      spanLength = right.minX - left.maxX;
      length = right.maxX - left.minX;
      if (length < 1) {
        length = 1;
      }
      const allowableError = 0.05 * length;
      if (left.maxX > span.minX + allowableError || right.minX < span.maxX - allowableError) {
        isSectional = false;
      }
    }

    const prototypesToDispose = [left.prototype, span?.prototype ?? null, right?.prototype ?? null];

    return {
      scale: Math.max(0.001, definition.scale),
      left,
      span: isSectional ? span : null,
      right: isSectional ? right : null,
      isSectional,
      leftMinX: left.minX,
      leftMaxX: left.maxX,
      rightMinX,
      length: Math.max(1, length),
      spanLength,
      dispose: () => {
        for (const prototype of prototypesToDispose) {
          if (!prototype) {
            continue;
          }
          prototype.traverse((child) => {
            const mesh = child as THREE.Mesh;
            if (!mesh.isMesh) {
              return;
            }
            mesh.geometry.dispose();
            if (Array.isArray(mesh.material)) {
              for (const material of mesh.material) {
                material.dispose();
              }
            } else {
              mesh.material.dispose();
            }
          });
        }
      },
    };
  }

  private instantiateBridge(
    prototype: LoadedBridgePrototype,
    segment: BridgeSegment,
    getHeight: HeightmapQuery,
  ): THREE.Object3D | null {
    const start = new THREE.Vector3(
      segment.start.x,
      getHeight(segment.start.x, segment.start.z) + BRIDGE_FLOAT_AMT,
      segment.start.z,
    );
    const end = new THREE.Vector3(
      segment.end.x,
      getHeight(segment.end.x, segment.end.z) + BRIDGE_FLOAT_AMT,
      segment.end.z,
    );

    const delta = end.clone().sub(start);
    const desiredLength = delta.length();
    if (desiredLength < 1e-3) {
      return null;
    }

    const horizontal = new THREE.Vector3(delta.x, 0, delta.z);
    if (horizontal.lengthSq() < 1e-6) {
      return null;
    }

    let numSpans = 1;
    let bridgeLength = prototype.length;
    if (prototype.isSectional && prototype.spanLength > 0) {
      numSpans = calculateSectionalBridgeSpanCount(desiredLength, prototype.length, prototype.spanLength);
      bridgeLength = prototype.length + (numSpans - 1) * prototype.spanLength;
    }
    if (bridgeLength < 1e-3) {
      bridgeLength = desiredLength;
    }

    const forward = delta.normalize();
    const side = new THREE.Vector3(-horizontal.z, 0, horizontal.x).normalize();
    const up = new THREE.Vector3().crossVectors(side, forward).normalize();

    const xAxis = forward.multiplyScalar(desiredLength / bridgeLength);
    const yAxis = up.multiplyScalar(prototype.scale);
    const zAxis = side.multiplyScalar(prototype.scale);
    const origin = start.clone().addScaledVector(xAxis, -prototype.leftMinX);

    const root = new THREE.Group();
    root.name = 'terrain-bridge';
    root.matrixAutoUpdate = false;
    root.matrix.makeBasis(xAxis, yAxis, zAxis);
    root.matrix.setPosition(origin);
    root.matrixWorldNeedsUpdate = true;
    root.frustumCulled = false;

    const left = cloneBridgeObject(prototype.left.prototype);
    left.frustumCulled = false;
    root.add(left);

    if (!prototype.isSectional || !prototype.span || !prototype.right) {
      root.updateMatrixWorld(true);
      return root;
    }

    for (let spanIndex = 0; spanIndex < numSpans; spanIndex++) {
      const span = cloneBridgeObject(prototype.span.prototype);
      span.position.x = spanIndex * prototype.spanLength;
      span.frustumCulled = false;
      root.add(span);
    }

    const right = cloneBridgeObject(prototype.right.prototype);
    right.position.x = (numSpans - 1) * prototype.spanLength;
    right.frustumCulled = false;
    root.add(right);
    root.updateMatrixWorld(true);
    return root;
  }

  private async createDefaultModelLoader(assetUrl: string): Promise<THREE.Object3D> {
    const gltf = await this.gltfLoader.loadAsync(assetUrl);
    return gltf.scene;
  }
}
