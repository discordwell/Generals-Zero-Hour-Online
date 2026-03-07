import { describe, it, expect, beforeEach } from 'vitest';
import { GameLODManager } from './game-lod-manager.js';
import { IniDataRegistry } from '@generals/ini-data';
import type { IniBlock } from '@generals/core';

function makeBlock(type: string, name: string, fields: Record<string, unknown> = {}): IniBlock {
  return { type, name, fields: fields as Record<string, import('@generals/core').IniValue>, blocks: [] };
}

describe('GameLODManager', () => {
  let manager: GameLODManager;

  beforeEach(() => {
    manager = new GameLODManager();
    manager.init();
  });

  describe('static LOD presets', () => {
    it('defaults to High level', () => {
      expect(manager.getStaticLevel()).toBe('High');
      expect(manager.getParticleCap()).toBe(3000);
      expect(manager.shouldUseShadowVolumes()).toBe(true);
      expect(manager.shouldUseShadowDecals()).toBe(true);
    });

    it('switches to Low preset', () => {
      manager.setStaticLevel('Low');
      expect(manager.getParticleCap()).toBe(500);
      expect(manager.shouldUseShadowVolumes()).toBe(false);
      expect(manager.shouldUseShadowDecals()).toBe(false);
      expect(manager.getTextureReductionFactor()).toBe(1);
    });

    it('switches to Medium preset', () => {
      manager.setStaticLevel('Medium');
      expect(manager.getParticleCap()).toBe(1500);
      expect(manager.shouldUseShadowVolumes()).toBe(false);
      expect(manager.shouldUseShadowDecals()).toBe(true);
    });
  });

  describe('loading from INI registry', () => {
    it('loads static presets from registry', () => {
      const registry = new IniDataRegistry();
      registry.loadBlocks([
        makeBlock('StaticGameLOD', 'High', {
          MaxParticleCount: '5000',
          UseShadowVolumes: 'Yes',
          TextureReductionFactor: '0',
        }),
      ]);

      manager.loadFromRegistry(registry);
      expect(manager.getParticleCap()).toBe(5000);
    });

    it('loads dynamic presets from registry', () => {
      const registry = new IniDataRegistry();
      registry.loadBlocks([
        makeBlock('DynamicGameLOD', 'VeryHigh', {
          MinimumFPS: '30',
          ParticleSkipMask: '0',
          MinParticlePriority: 'WEAPON_EXPLOSION',
        }),
        makeBlock('DynamicGameLOD', 'Low', {
          MinimumFPS: '0',
          ParticleSkipMask: '7',
          MinParticlePriority: 'AREA_EFFECT',
        }),
      ]);

      manager.loadFromRegistry(registry);
      // Default dynamic level is VeryHigh with loaded preset
      expect(manager.getDynamicLevel()).toBe('VeryHigh');
    });
  });

  describe('dynamic LOD FPS adaptation', () => {
    it('starts at VeryHigh dynamic level', () => {
      expect(manager.getDynamicLevel()).toBe('VeryHigh');
    });

    it('drops to lower dynamic level when FPS drops', () => {
      // Simulate very low FPS (5 fps → dt = 0.2)
      for (let i = 0; i < 35; i++) {
        manager.update(0.2);
      }
      // FPS ~5, which is below Medium threshold (10), should go to Low
      expect(manager.getDynamicLevel()).toBe('Low');
    });

    it('stays at VeryHigh when FPS is good', () => {
      for (let i = 0; i < 35; i++) {
        manager.update(1 / 60); // 60 FPS
      }
      expect(manager.getDynamicLevel()).toBe('VeryHigh');
    });

    it('transitions to Medium at moderate FPS', () => {
      for (let i = 0; i < 35; i++) {
        manager.update(1 / 12); // ~12 FPS
      }
      expect(manager.getDynamicLevel()).toBe('Medium');
    });

    it('reports average FPS', () => {
      for (let i = 0; i < 10; i++) {
        manager.update(1 / 30);
      }
      expect(manager.getAverageFPS()).toBeCloseTo(30, 0);
    });
  });

  describe('particle skip logic', () => {
    it('never skips ALWAYS_RENDER priority', () => {
      // Even at Low dynamic level
      for (let i = 0; i < 35; i++) {
        manager.update(0.5); // very low fps
      }
      expect(manager.shouldSkipParticle('ALWAYS_RENDER')).toBe(false);
    });

    it('skips low-priority particles at Low dynamic level', () => {
      for (let i = 0; i < 35; i++) {
        manager.update(0.5);
      }
      // Low dynamic: minParticlePriority = AREA_EFFECT
      // WEAPON_EXPLOSION is below AREA_EFFECT, should be skipped
      expect(manager.shouldSkipParticle('WEAPON_EXPLOSION')).toBe(true);
    });

    it('does not skip high-priority at VeryHigh dynamic level', () => {
      for (let i = 0; i < 35; i++) {
        manager.update(1 / 60);
      }
      expect(manager.shouldSkipParticle('WEAPON_TRAIL')).toBe(false);
    });
  });

  describe('reset', () => {
    it('resets FPS history and dynamic level', () => {
      for (let i = 0; i < 35; i++) {
        manager.update(0.5);
      }
      expect(manager.getDynamicLevel()).toBe('Low');

      manager.reset();
      expect(manager.getDynamicLevel()).toBe('VeryHigh');
      expect(manager.getAverageFPS()).toBe(60); // default when no samples
    });
  });
});
