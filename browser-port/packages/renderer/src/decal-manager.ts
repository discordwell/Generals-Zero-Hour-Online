/**
 * DecalManager — subsystem coordinating all decal types:
 * selection circles, scorch marks, shadow decals.
 *
 * Source parity: W3DTerrainLogic.cpp decal management.
 */

import * as THREE from 'three';
import type { Subsystem } from '@generals/engine';
import type { AssetManager } from '@generals/assets';
import { DecalRenderer, type DecalHandle } from './decal-renderer.js';
import { TerrainScorchManager } from './terrain-scorch.js';

const LOGIC_FRAMES_PER_SECOND = 30;

export interface RenderableRadiusDecal {
  positionX: number;
  positionY: number;
  positionZ: number;
  radius: number;
  visible: boolean;
  textureName?: string;
  shadowType?: string;
  minOpacity?: number;
  maxOpacity?: number;
  opacityThrobFrames?: number;
  color?: number;
  ownerColor?: number | null;
  onlyVisibleToOwningPlayer?: boolean;
}

export interface RadiusDecalEntityState {
  id: number;
  isOwnedByLocalPlayer?: boolean;
  radiusDecals?: readonly RenderableRadiusDecal[];
}

interface LiveRadiusDecal {
  handle: DecalHandle;
  signature: string;
  textureKey: string;
  loadToken: number;
}

export class DecalManager implements Subsystem {
  readonly name = 'DecalManager';

  readonly decalRenderer: DecalRenderer;
  readonly terrainScorch: TerrainScorchManager;
  private readonly assetManager: AssetManager | null;
  private readonly radiusDecals = new Map<string, LiveRadiusDecal>();
  private readonly texturePromises = new Map<string, Promise<THREE.Texture | null>>();

  constructor(scene: THREE.Scene, maxDecals = 256, maxScorchMarks = 128, assetManager: AssetManager | null = null) {
    this.decalRenderer = new DecalRenderer(scene, maxDecals);
    this.terrainScorch = new TerrainScorchManager(this.decalRenderer, maxScorchMarks);
    this.assetManager = assetManager;
  }

  init(): void {
    // no-op
  }

  update(dt: number): void {
    this.decalRenderer.update(dt);
  }

  reset(): void {
    this.clearRadiusDecals();
    this.terrainScorch.dispose();
    this.decalRenderer.dispose();
  }

  dispose(): void {
    this.reset();
  }

  /**
   * Add a scorch mark at the given position.
   * Called by FXListManager when a TerrainScorch nugget fires.
   */
  addScorchMark(scorchType: string, radius: number, position: THREE.Vector3, lifetime = 30): void {
    this.terrainScorch.addScorch({
      scorchType,
      radius,
      position: [position.x, position.y, position.z],
      lifetime,
    });
  }

  syncRadiusDecals(states: readonly RadiusDecalEntityState[]): void {
    const activeKeys = new Set<string>();

    for (const state of states) {
      const decals = state.radiusDecals ?? [];
      for (let i = 0; i < decals.length; i++) {
        const decal = decals[i]!;
        const key = `${state.id}:${i}`;
        if (!this.shouldRenderRadiusDecal(state, decal)) {
          continue;
        }

        activeKeys.add(key);
        const signature = this.buildRadiusDecalSignature(decal);
        const existing = this.radiusDecals.get(key);
        if (existing && !this.decalRenderer.hasDecal(existing.handle)) {
          this.radiusDecals.delete(key);
        }
        const current = this.radiusDecals.get(key);
        if (current && current.signature === signature) {
          continue;
        }

        if (current) {
          this.decalRenderer.removeDecal(current.handle);
          this.radiusDecals.delete(key);
        }

        const textureKey = this.normalizeTextureName(decal.textureName ?? '');
        const handle = this.decalRenderer.addDecal({
          position: [decal.positionX, decal.positionY, decal.positionZ],
          sizeX: decal.radius * 2,
          sizeY: decal.radius * 2,
          rotation: 0,
          blendMode: this.resolveBlendMode(decal.shadowType),
          opacity: this.resolveMaxOpacity(decal),
          color: this.resolveDecalColor(decal.color, decal.ownerColor),
          opacityThrob: {
            minOpacity: this.resolveMinOpacity(decal),
            maxOpacity: this.resolveMaxOpacity(decal),
            periodSeconds: Math.max(1, decal.opacityThrobFrames ?? LOGIC_FRAMES_PER_SECOND) / LOGIC_FRAMES_PER_SECOND,
          },
          lifetime: 0,
          terrainConform: true,
        });
        const live: LiveRadiusDecal = { handle, signature, textureKey, loadToken: 0 };
        this.radiusDecals.set(key, live);

        if (textureKey) {
          live.loadToken += 1;
          const loadToken = live.loadToken;
          void this.loadRadiusDecalTexture(textureKey).then((texture) => {
            const current = this.radiusDecals.get(key);
            if (!current || current.loadToken !== loadToken || current.textureKey !== textureKey) {
              return;
            }
            this.decalRenderer.setDecalTexture(current.handle, texture);
          });
        }
      }
    }

    for (const [key, live] of this.radiusDecals) {
      if (!activeKeys.has(key)) {
        this.decalRenderer.removeDecal(live.handle);
        this.radiusDecals.delete(key);
      }
    }
  }

  private clearRadiusDecals(): void {
    for (const live of this.radiusDecals.values()) {
      this.decalRenderer.removeDecal(live.handle);
    }
    this.radiusDecals.clear();
  }

  private shouldRenderRadiusDecal(state: RadiusDecalEntityState, decal: RenderableRadiusDecal): boolean {
    if (!decal.visible || decal.radius <= 0 || !Number.isFinite(decal.radius)) {
      return false;
    }
    if ((decal.textureName ?? '').trim().length === 0) {
      return false;
    }
    if (decal.onlyVisibleToOwningPlayer !== false && state.isOwnedByLocalPlayer === false) {
      return false;
    }
    return Number.isFinite(decal.positionX) && Number.isFinite(decal.positionY) && Number.isFinite(decal.positionZ);
  }

  private buildRadiusDecalSignature(decal: RenderableRadiusDecal): string {
    return [
      decal.positionX,
      decal.positionY,
      decal.positionZ,
      decal.radius,
      decal.textureName ?? '',
      decal.shadowType ?? '',
      this.resolveMinOpacity(decal),
      this.resolveMaxOpacity(decal),
      decal.opacityThrobFrames ?? LOGIC_FRAMES_PER_SECOND,
      decal.color ?? 0,
      decal.ownerColor ?? null,
      decal.onlyVisibleToOwningPlayer ?? true,
    ].join('|');
  }

  private resolveMinOpacity(decal: RenderableRadiusDecal): number {
    return this.clampOpacity(decal.minOpacity ?? 1);
  }

  private resolveMaxOpacity(decal: RenderableRadiusDecal): number {
    return this.clampOpacity(decal.maxOpacity ?? 1);
  }

  private clampOpacity(value: number): number {
    return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1;
  }

  private resolveBlendMode(shadowType: string | undefined): 'ALPHA' | 'ADDITIVE' {
    return shadowType?.trim().toUpperCase() === 'SHADOW_ADDITIVE_DECAL' ? 'ADDITIVE' : 'ALPHA';
  }

  private resolveDecalColor(color: number | undefined, ownerColor: number | null | undefined): number {
    const packed = Number.isFinite(color) ? (color as number) : 0;
    if ((packed | 0) === 0) {
      return Number.isFinite(ownerColor) ? (ownerColor as number) & 0x00ffffff : 0;
    }
    return packed & 0x00ffffff;
  }

  private normalizeTextureName(textureName: string): string {
    return textureName.trim().replace(/\.(?:tga|dds|rgba)$/i, '').toLowerCase();
  }

  private resolveRadiusDecalTextureOutputPaths(textureName: string): string[] {
    const normalized = this.normalizeTextureName(textureName);
    if (!normalized) {
      return [];
    }

    const fallbackPaths = [
      `textures/Art/Textures/${normalized}.rgba`,
      `textures/TexturesZH/Art/Textures/${normalized}.rgba`,
    ];
    const manifest = this.assetManager?.getManifest();
    if (!manifest) {
      return fallbackPaths;
    }

    const suffix = `/${normalized}.rgba`;
    const matches = manifest.getOutputPaths()
      .filter((outputPath) => outputPath.toLowerCase().endsWith(suffix));
    return matches.length > 0 ? matches : fallbackPaths;
  }

  private loadRadiusDecalTexture(textureName: string): Promise<THREE.Texture | null> {
    const normalized = this.normalizeTextureName(textureName);
    if (!this.assetManager || !normalized) {
      return Promise.resolve(null);
    }

    const cached = this.texturePromises.get(normalized);
    if (cached) {
      return cached;
    }

    const promise = (async () => {
      for (const outputPath of this.resolveRadiusDecalTextureOutputPaths(normalized)) {
        try {
          const handle = await this.assetManager!.loadArrayBuffer(outputPath);
          const texture = DecalManager.parseRgbaTexture(handle.data);
          texture.name = normalized;
          return texture;
        } catch {
          // Try the next manifest/fallback path.
        }
      }
      return null;
    })().catch(() => null);

    this.texturePromises.set(normalized, promise);
    return promise;
  }

  private static parseRgbaTexture(data: ArrayBuffer): THREE.DataTexture {
    const header = new DataView(data);
    const width = header.getUint32(0, true);
    const height = header.getUint32(4, true);
    const expectedByteLength = width * height * 4;
    const pixels = new Uint8Array(data, 8);
    if (width <= 0 || height <= 0 || pixels.byteLength < expectedByteLength) {
      throw new Error('Invalid .rgba texture payload.');
    }

    const texture = new THREE.DataTexture(
      new Uint8Array(pixels.buffer, pixels.byteOffset, expectedByteLength),
      width,
      height,
      THREE.RGBAFormat,
    );
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    return texture;
  }
}
