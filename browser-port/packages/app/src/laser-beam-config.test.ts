import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { IniDataRegistry, type IniDataBundle, type ObjectDef } from '@generals/ini-data';
import { resolveW3DLaserDrawBeamConfig } from './laser-beam-config.js';

const RETAIL_BUNDLE_PATH = path.resolve(
  __dirname,
  '..',
  'public',
  'assets',
  'data',
  'ini-bundle.json',
);

function makeLaserObject(fields: Record<string, unknown>): ObjectDef {
  return {
    name: 'TestLaserBeam',
    side: 'America',
    fields: {},
    blocks: [
      {
        type: 'Draw',
        name: 'W3DLaserDraw ModuleTag_Laser',
        fields: fields as ObjectDef['fields'],
        blocks: [],
      },
    ],
    resolved: true,
  };
}

describe('resolveW3DLaserDrawBeamConfig', () => {
  it('parses W3DLaserDraw beam widths, colors, opacity, beams, segments, and arc height', () => {
    const config = resolveW3DLaserDrawBeamConfig(makeLaserObject({
      NumBeams: 3,
      InnerBeamWidth: 0.4,
      OuterBeamWidth: 1.2,
      InnerColor: ['R:255', 'G:255', 'B:255', 'A:250'],
      OuterColor: ['R:255', 'G:0', 'B:0', 'A:150'],
      Segments: 4,
      ArcHeight: 30,
      SegmentOverlapRatio: 0.125,
      MaxIntensityLifetime: 100,
      FadeLifetime: 250,
    }));

    expect(config).toEqual(expect.objectContaining({
      numBeams: 3,
      innerWidth: 0.4,
      outerWidth: 1.2,
      innerColor: 0xffffff,
      outerColor: 0xff0000,
      segments: 4,
      arcHeight: 30,
      segmentOverlapRatio: 0.125,
      fullIntensityMs: 100,
      fadeMs: 250,
    }));
    expect(config!.innerOpacity).toBeCloseTo(250 / 255, 6);
    expect(config!.outerOpacity).toBeCloseTo(150 / 255, 6);
  });

  it('parses every retail W3DLaserDraw object instead of falling back to hardcoded red defaults', () => {
    const bundle = JSON.parse(fs.readFileSync(RETAIL_BUNDLE_PATH, 'utf8')) as IniDataBundle;
    const registry = new IniDataRegistry();
    registry.loadBundle(bundle);

    let laserDrawObjectCount = 0;
    for (const objectDef of bundle.objects ?? []) {
      const hasLaserDraw = objectDef.blocks.some((block) =>
        block.type === 'Draw' && (block.name ?? '').trim().split(/\s+/)[0] === 'W3DLaserDraw');
      if (!hasLaserDraw) {
        continue;
      }
      laserDrawObjectCount++;
      const config = resolveW3DLaserDrawBeamConfig(registry.getObject(objectDef.name));
      expect(config, `missing W3DLaserDraw config for ${objectDef.name}`).toBeDefined();
      expect(config!.numBeams, `missing NumBeams on ${objectDef.name}`).toBeGreaterThanOrEqual(1);
      expect(config!.innerWidth, `missing InnerBeamWidth on ${objectDef.name}`).toBeGreaterThanOrEqual(0);
      expect(config!.innerColor, `missing InnerColor on ${objectDef.name}`).toBeGreaterThanOrEqual(0);
      expect(config!.innerOpacity, `missing InnerColor alpha on ${objectDef.name}`).toBeGreaterThan(0);
    }

    expect(laserDrawObjectCount).toBeGreaterThan(20);
    const laserBeam = resolveW3DLaserDrawBeamConfig(registry.getObject('LaserBeam'));
    expect(laserBeam).toEqual(expect.objectContaining({
      numBeams: 3,
      innerWidth: 0.4,
      outerWidth: 1.2,
      innerColor: 0xffffff,
      outerColor: 0xff0000,
    }));
  });
});
