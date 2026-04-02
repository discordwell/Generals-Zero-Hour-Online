import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { ScriptSkyboxController } from './script-skybox.js';

function createSkyboxRoot(): THREE.Group {
  const root = new THREE.Group();
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(10, 10, 10),
    new THREE.MeshStandardMaterial(),
  );
  root.add(mesh);
  return root;
}

describe('ScriptSkyboxController', () => {
  it('loads the skybox model, applies skybox material policy, and follows the camera', async () => {
    const scene = new THREE.Scene();
    const loadedUrls: string[] = [];
    const controller = new ScriptSkyboxController(scene, null, {
      assetPath: 'models/W3D/Art/W3D/new_skybox.glb',
      positionY: -100,
      scale: 8.4,
      modelLoader: async (assetUrl) => {
        loadedUrls.push(assetUrl);
        return createSkyboxRoot();
      },
    });
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(120, 48, -36);

    controller.setEnabled(true);
    await controller.preload();
    controller.update(camera);

    expect(loadedUrls).toEqual(['assets/models/W3D/Art/W3D/new_skybox.glb']);
    expect(controller.isLoaded()).toBe(true);
    const root = scene.getObjectByName('script-skybox');
    expect(root).not.toBeNull();
    expect(root?.visible).toBe(true);
    expect(root?.position.toArray()).toEqual([120, -100, -36]);
    expect(root?.scale.toArray()).toEqual([8.4, 8.4, 8.4]);

    const mesh = root?.children[0] as THREE.Mesh | undefined;
    expect(mesh?.renderOrder).toBe(-1000);
    const material = mesh?.material as THREE.MeshStandardMaterial | undefined;
    expect(material?.depthWrite).toBe(false);
    expect(material?.depthTest).toBe(false);
    expect(material?.fog).toBe(false);
    expect(material?.side).toBe(THREE.DoubleSide);
  });

  it('hides the loaded skybox when scripts disable it', async () => {
    const scene = new THREE.Scene();
    const controller = new ScriptSkyboxController(scene, null, {
      modelLoader: async () => createSkyboxRoot(),
    });

    controller.setEnabled(true);
    await controller.preload();
    controller.setEnabled(false);

    const root = scene.getObjectByName('script-skybox');
    expect(root?.visible).toBe(false);
  });
});
