import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import { buildSourceSaveMapAssetReport } from './source-save-map-asset-report.js';

describe('source save map asset report', () => {
  it('groups external map requirements and ignores saves with embedded maps', () => {
    const tempDir = join(tmpdir(), `generals-map-assets-${process.pid}-${Date.now()}`);
    const assetsDir = join(tempDir, 'assets');
    mkdirSync(join(assetsDir, 'maps', '_extracted', 'Maps', 'Maps', 'USA02'), { recursive: true });
    writeFileSync(join(assetsDir, 'maps', '_extracted', 'Maps', 'Maps', 'USA02', 'USA02.json'), '{}');

    try {
      const report = buildSourceSaveMapAssetReport({
        fixturesDir: join(tempDir, 'fixtures'),
        assetsDir,
        manifestPath: join(assetsDir, 'manifest.json'),
        manifest: {
          version: 1,
          generatedAt: '2026-04-15T00:00:00.000Z',
          entryCount: 1,
          entries: [{
            sourcePath: '_extracted/Maps/Maps/USA02/USA02.map',
            sourceHash: 'source-hash',
            outputPath: 'maps/_extracted/Maps/Maps/USA02/USA02.json',
            outputHash: 'output-hash',
            converter: 'save-map-asset-extractor',
            converterVersion: '1.0.0',
            timestamp: '2026-04-15T00:00:00.000Z',
          }],
        },
        saves: [
          {
            fileName: 'embedded.sav',
            hasEmbeddedMapData: true,
            sourceMapPath: 'Maps/GLA02/GLA02.map',
            candidateOutputPaths: ['maps/_extracted/Maps/Maps/GLA02/GLA02.json'],
          },
          {
            fileName: 'usa-a.sav',
            hasEmbeddedMapData: false,
            sourceMapPath: 'Maps/USA02/USA02.map',
            candidateOutputPaths: ['maps/_extracted/Maps/Maps/USA02/USA02.json'],
          },
          {
            fileName: 'usa-b.sav',
            hasEmbeddedMapData: false,
            sourceMapPath: 'Maps\\USA02\\USA02.map',
            candidateOutputPaths: ['\\maps\\_extracted\\Maps\\Maps\\USA02\\USA02.json'],
          },
        ],
        parseFailures: [],
        now: '2026-04-15T00:00:00.000Z',
      });

      expect(report.summary).toMatchObject({
        totalSaveFiles: 3,
        parsedSaveFiles: 3,
        embeddedMapSaveFiles: 1,
        externalMapSaveFiles: 2,
        requiredMapAssets: 1,
        availableMapAssets: 1,
        missingMapAssets: 0,
        blockedSaveFiles: 0,
      });
      expect(report.requiredMaps).toEqual([expect.objectContaining({
        sourceMapPath: 'Maps/USA02/USA02.map',
        saveFiles: ['usa-a.sav', 'usa-b.sav'],
        status: 'available',
        availableOutputPath: 'maps/_extracted/Maps/Maps/USA02/USA02.json',
      })]);
      expect(report.requiredMaps[0]?.candidates[0]).toEqual(expect.objectContaining({
        manifestEntry: true,
        outputFileExists: true,
        sourceFileExists: false,
        sourceIsMap: true,
        sourceCompatible: true,
      }));
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('blocks saves when candidate maps are not source-compatible', () => {
    const tempDir = join(tmpdir(), `generals-map-assets-missing-${process.pid}-${Date.now()}`);
    const assetsDir = join(tempDir, 'assets');
    mkdirSync(assetsDir, { recursive: true });

    try {
      const report = buildSourceSaveMapAssetReport({
        fixturesDir: join(tempDir, 'fixtures'),
        assetsDir,
        manifestPath: join(assetsDir, 'manifest.json'),
        manifest: null,
        saves: [{
          fileName: 'china.sav',
          hasEmbeddedMapData: false,
          sourceMapPath: 'Maps/CHI02/CHI02.map',
          candidateOutputPaths: ['maps/_extracted/Maps/Maps/CHI02/CHI02.json'],
        }],
        parseFailures: [{
          fileName: 'corrupt.sav',
          error: 'bad header',
        }],
        now: '2026-04-15T00:00:00.000Z',
      });

      expect(report.summary).toMatchObject({
        parseFailedSaveFiles: 1,
        missingMapAssets: 1,
        blockedSaveFiles: 2,
      });
      expect(report.requiredMaps[0]).toEqual(expect.objectContaining({
        sourceMapPath: 'Maps/CHI02/CHI02.map',
        status: 'missing',
        availableOutputPath: null,
      }));
      expect(report.requiredMaps[0]?.candidates[0]).toEqual(expect.objectContaining({
        manifestEntry: false,
        outputFileExists: false,
        sourceCompatible: false,
      }));
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
