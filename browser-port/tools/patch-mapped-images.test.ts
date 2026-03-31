import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IniDataBundle, MappedImageDef } from '@generals/ini-data';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '..');
const BUNDLE_PATH = path.join(
  PROJECT_ROOT,
  'packages/app/public/assets/data/ini-bundle.json',
);

describe('patch-mapped-images output', () => {
  const bundle: IniDataBundle = JSON.parse(fs.readFileSync(BUNDLE_PATH, 'utf-8'));
  const mappedImages: MappedImageDef[] = bundle.mappedImages ?? [];

  it('should have a non-zero number of MappedImage entries', () => {
    expect(mappedImages.length).toBeGreaterThan(0);
    expect(mappedImages.length).toBe(1186);
  });

  it('should have entries sorted by name', () => {
    for (let i = 1; i < mappedImages.length; i++) {
      expect(
        mappedImages[i - 1].name.localeCompare(mappedImages[i].name),
      ).toBeLessThanOrEqual(0);
    }
  });

  it('should have all required fields on every entry', () => {
    for (const mi of mappedImages) {
      expect(mi.name).toBeTruthy();
      expect(typeof mi.name).toBe('string');
      expect(mi.texture).toBeTruthy();
      expect(typeof mi.texture).toBe('string');
      expect(typeof mi.textureWidth).toBe('number');
      expect(typeof mi.textureHeight).toBe('number');
      expect(typeof mi.left).toBe('number');
      expect(typeof mi.top).toBe('number');
      expect(typeof mi.right).toBe('number');
      expect(typeof mi.bottom).toBe('number');
      expect(typeof mi.rotated).toBe('boolean');
    }
  });

  it('should have textures with .tga extension', () => {
    for (const mi of mappedImages) {
      expect(mi.texture).toMatch(/\.tga$/i);
    }
  });

  it('should have valid coordinate bounds', () => {
    for (const mi of mappedImages) {
      expect(mi.left).toBeGreaterThanOrEqual(0);
      expect(mi.top).toBeGreaterThanOrEqual(0);
      expect(mi.right).toBeGreaterThanOrEqual(mi.left);
      // bottom >= top (some entries like GameinfoBOSS have bottom=0, top=0)
      expect(mi.bottom).toBeGreaterThanOrEqual(mi.top);
      expect(mi.right).toBeLessThanOrEqual(mi.textureWidth);
      expect(mi.bottom).toBeLessThanOrEqual(mi.textureHeight);
    }
  });

  it('should include known rotated entries', () => {
    const rotated = mappedImages.filter((mi) => mi.rotated);
    expect(rotated.length).toBe(5);
    // SSObserverUSA, SSObserverChina, SSObserverGLA are known rotated entries
    const rotatedNames = rotated.map((mi) => mi.name);
    expect(rotatedNames).toContain('SSObserverUSA');
    expect(rotatedNames).toContain('SSObserverChina');
    expect(rotatedNames).toContain('SSObserverGLA');
  });

  it('should include known hand-created entries', () => {
    // LoadPageHuge is defined in both HandCreated/ and TextureSize_512/ —
    // the TextureSize_512 version overwrites the HandCreated one (engine load order).
    const loadPage = mappedImages.find((mi) => mi.name === 'LoadPageHuge');
    expect(loadPage).toBeDefined();
    expect(loadPage!.texture).toBe('loadpage.tga');
    expect(loadPage!.textureWidth).toBe(1024);
    expect(loadPage!.textureHeight).toBe(1024);
    expect(loadPage!.left).toBe(0);
    expect(loadPage!.top).toBe(0);
    expect(loadPage!.right).toBe(1024);
    expect(loadPage!.bottom).toBe(768);
    expect(loadPage!.rotated).toBe(false);
  });

  it('should have mappedImages count in stats', () => {
    expect(bundle.stats).toBeDefined();
    expect((bundle.stats as Record<string, number>).mappedImages).toBe(1186);
  });

  it('should have totalBlocks updated to include mappedImages', () => {
    expect(bundle.stats).toBeDefined();
    // totalBlocks should include the 1186 mapped images
    expect(bundle.stats.totalBlocks).toBeGreaterThanOrEqual(1186);
  });
});
