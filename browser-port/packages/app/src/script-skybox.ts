import * as THREE from 'three';
import { AssetManager, RUNTIME_ASSET_BASE_URL } from '@generals/assets';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const DEFAULT_SKYBOX_MODEL_NAME = 'new_skybox';
const DEFAULT_SKYBOX_OUTPUT_PATH = 'models/W3D/Art/W3D/new_skybox.glb';
const SKYBOX_RENDER_ORDER = -1000;

export interface ScriptSkyboxControllerConfig {
  assetPath?: string;
  positionY?: number;
  scale?: number;
  modelLoader?: (assetUrl: string) => Promise<THREE.Object3D>;
}

export class ScriptSkyboxController {
  private readonly scene: THREE.Scene;
  private readonly assetPath: string;
  private readonly positionY: number;
  private readonly scale: number;
  private readonly modelLoader: (assetUrl: string) => Promise<THREE.Object3D>;
  private readonly gltfLoader = new GLTFLoader();
  private root: THREE.Object3D | null = null;
  private loadingPromise: Promise<void> | null = null;
  private enabled = false;
  private disposed = false;

  constructor(
    scene: THREE.Scene,
    assets: AssetManager | null,
    config: ScriptSkyboxControllerConfig = {},
  ) {
    this.scene = scene;
    this.assetPath = config.assetPath
      ?? assets?.resolveModelPath(DEFAULT_SKYBOX_MODEL_NAME)
      ?? DEFAULT_SKYBOX_OUTPUT_PATH;
    this.positionY = Number.isFinite(config.positionY) ? Number(config.positionY) : 0;
    this.scale = Number.isFinite(config.scale) ? Math.max(0.001, Number(config.scale)) : 1;
    this.modelLoader = config.modelLoader ?? this.createDefaultModelLoader.bind(this);
  }

  preload(): Promise<void> {
    return this.ensureLoaded();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (this.root) {
      this.root.visible = enabled;
      return;
    }
    if (enabled) {
      void this.ensureLoaded();
    }
  }

  update(camera: THREE.Camera): void {
    if (!this.root) {
      return;
    }
    this.root.position.set(camera.position.x, this.positionY, camera.position.z);
  }

  isLoaded(): boolean {
    return this.root !== null;
  }

  dispose(): void {
    this.disposed = true;
    if (this.root) {
      this.scene.remove(this.root);
      this.root.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh) {
          return;
        }
        if (Array.isArray(mesh.material)) {
          for (const material of mesh.material) {
            material.dispose();
          }
        } else {
          mesh.material.dispose();
        }
        mesh.geometry.dispose();
      });
      this.root = null;
    }
    this.loadingPromise = null;
  }

  private ensureLoaded(): Promise<void> {
    if (this.root || this.loadingPromise) {
      return this.loadingPromise ?? Promise.resolve();
    }

    this.loadingPromise = this.modelLoader(this.resolveAssetUrl())
      .then((root) => {
        if (this.disposed) {
          return;
        }
        this.prepareRoot(root);
        root.visible = this.enabled;
        this.scene.add(root);
        this.root = root;
      })
      .catch((error: unknown) => {
        console.warn('Failed to load script skybox model.', error);
      })
      .finally(() => {
        this.loadingPromise = null;
      });
    return this.loadingPromise;
  }

  private resolveAssetUrl(): string {
    return `${RUNTIME_ASSET_BASE_URL}/${this.assetPath}`;
  }

  private async createDefaultModelLoader(assetUrl: string): Promise<THREE.Object3D> {
    const gltf = await this.gltfLoader.loadAsync(assetUrl);
    return gltf.scene;
  }

  private prepareRoot(root: THREE.Object3D): void {
    root.name = 'script-skybox';
    root.frustumCulled = false;
    root.scale.setScalar(this.scale);
    root.traverse((child) => {
      child.frustumCulled = false;
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) {
        return;
      }
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.renderOrder = SKYBOX_RENDER_ORDER;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        material.depthWrite = false;
        material.depthTest = false;
        (material as THREE.Material & { fog?: boolean }).fog = false;
        material.side = THREE.DoubleSide;
        const map = (material as THREE.MeshBasicMaterial).map;
        if (map) {
          map.wrapS = THREE.ClampToEdgeWrapping;
          map.wrapT = THREE.ClampToEdgeWrapping;
          map.needsUpdate = true;
        }
        material.needsUpdate = true;
      }
    });
  }
}
