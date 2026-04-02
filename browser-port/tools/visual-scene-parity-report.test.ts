import { describe, expect, it } from 'vitest';

import {
  buildCampaignVisualSceneSpecs,
  buildVisualSceneParityReport,
  collectVisualSceneBlockingIssues,
} from './visual-scene-parity-report.js';

describe('visual scene parity report', () => {
  it('returns no blockers when a scene matches its expectations', () => {
    const issues = collectVisualSceneBlockingIssues({
      pageErrors: [],
      consoleErrors: [],
      consoleWarnings: [],
      debugState: {
        frame: 300,
        mapPath: 'maps/test.json',
        placementResolvedObjects: 250,
        placementSpawnedObjects: 250,
        placementTotalObjects: 300,
        placementUnresolvedObjects: 0,
        renderableCount: 250,
        sceneObjectCount: 1200,
        debugInfoText: 'FPS: 60',
        skyboxLoaded: true,
        skyboxVisible: true,
        objectVisuals: {
          visualEntityCount: 200,
          modelEntityCount: 200,
          placeholderEntityCount: 0,
          unresolvedEntityCount: 0,
          unresolvedEntityIds: [],
        },
      },
    }, {
      expectSkyboxVisible: true,
      maxPlacementUnresolvedObjects: 0,
      maxUnresolvedEntityCount: 0,
      maxPlaceholderEntityCount: 0,
      minRenderableCount: 100,
    });

    expect(issues).toEqual([]);
  });

  it('flags missing skybox and unresolved visuals as blockers', () => {
    const issues = collectVisualSceneBlockingIssues({
      pageErrors: [],
      consoleErrors: [],
      consoleWarnings: ['Failed to load script skybox model.'],
      debugState: {
        frame: 120,
        mapPath: 'maps/md_usa01.json',
        placementResolvedObjects: 40,
        placementSpawnedObjects: 40,
        placementTotalObjects: 90,
        placementUnresolvedObjects: 2,
        renderableCount: 40,
        sceneObjectCount: 500,
        debugInfoText: 'FPS: 60 | Unresolved: 3',
        skyboxLoaded: false,
        skyboxVisible: false,
        objectVisuals: {
          visualEntityCount: 80,
          modelEntityCount: 77,
          placeholderEntityCount: 3,
          unresolvedEntityCount: 3,
          unresolvedEntityIds: [1, 2, 3],
        },
      },
    }, {
      expectSkyboxVisible: true,
      maxPlacementUnresolvedObjects: 0,
      maxUnresolvedEntityCount: 0,
      maxPlaceholderEntityCount: 0,
      minRenderableCount: 100,
    });

    expect(issues).toEqual(expect.arrayContaining([
      expect.stringContaining('asset warnings'),
      expect.stringContaining('placement unresolved objects'),
      expect.stringContaining('unresolved entities'),
      expect.stringContaining('visible placeholders'),
      expect.stringContaining('skybox visible false !== expected true'),
    ]));
  });

  it('does not treat audio decode warnings as visual asset blockers', () => {
    const issues = collectVisualSceneBlockingIssues({
      pageErrors: [],
      consoleErrors: [],
      consoleWarnings: ['[AudioManager] Failed to load/decode "xu1xou08.wav": Unable to decode audio data'],
      debugState: {
        frame: 300,
        mapPath: 'maps/test.json',
        placementResolvedObjects: 250,
        placementSpawnedObjects: 250,
        placementTotalObjects: 300,
        placementUnresolvedObjects: 0,
        renderableCount: 250,
        sceneObjectCount: 1200,
        debugInfoText: 'FPS: 60',
        skyboxLoaded: true,
        skyboxVisible: true,
        objectVisuals: {
          visualEntityCount: 200,
          modelEntityCount: 200,
          placeholderEntityCount: 0,
          unresolvedEntityCount: 0,
          unresolvedEntityIds: [],
        },
      },
    }, {
      maxPlacementUnresolvedObjects: 0,
      maxUnresolvedEntityCount: 0,
      maxPlaceholderEntityCount: 0,
      minRenderableCount: 100,
    });

    expect(issues).toEqual([]);
  });

  it('scales the minimum renderable count down for sparse cinematic maps', () => {
    const issues = collectVisualSceneBlockingIssues({
      pageErrors: [],
      consoleErrors: [],
      consoleWarnings: [],
      debugState: {
        frame: 525,
        mapPath: 'maps/md_usa03_mid_cine.json',
        placementResolvedObjects: 50,
        placementSpawnedObjects: 50,
        placementTotalObjects: 104,
        placementUnresolvedObjects: 0,
        renderableCount: 55,
        sceneObjectCount: 289,
        debugInfoText: 'FPS: 15',
        skyboxLoaded: true,
        skyboxVisible: false,
        objectVisuals: {
          visualEntityCount: 55,
          modelEntityCount: 55,
          placeholderEntityCount: 0,
          unresolvedEntityCount: 0,
          unresolvedEntityIds: [],
        },
      },
    }, {
      maxPlacementUnresolvedObjects: 0,
      maxUnresolvedEntityCount: 0,
      maxPlaceholderEntityCount: 0,
      minRenderableCount: 100,
    });

    expect(issues).toEqual([]);
  });

  it('summarizes blocked scenarios in the final report', () => {
    const report = buildVisualSceneParityReport('http://127.0.0.1:42173', [
      {
        id: 'good-scene',
        name: 'Good Scene',
        url: '/',
        status: 'pass',
        screenshotPath: '/tmp/good-scene.png',
        pageErrors: [],
        consoleErrors: [],
        consoleWarnings: [],
        debugState: null,
        blockingIssues: [],
      },
      {
        id: 'bad-scene',
        name: 'Bad Scene',
        url: '/',
        status: 'blocked',
        screenshotPath: '/tmp/bad-scene.png',
        pageErrors: [],
        consoleErrors: [],
        consoleWarnings: [],
        debugState: null,
        blockingIssues: ['skybox missing', 'unresolved visuals'],
      },
    ]);

    expect(report.summary).toEqual({
      scenarioCount: 2,
      blockedScenarios: 1,
      blockerItems: 2,
    });
  });

  it('builds campaign scene specs for every MD map and preserves special expectations', () => {
    const specs = buildCampaignVisualSceneSpecs([
      'MD_USA03_CINE',
      'MD_USA01',
      'MD_GLA05_END',
      'SkirmishMap',
    ]);

    expect(specs.map((spec) => spec.name)).toEqual([
      'MD_GLA05_END',
      'MD_USA01',
      'MD_USA03_CINE',
    ]);
    expect(specs[0]).toEqual(expect.objectContaining({
      name: 'MD_GLA05_END',
      url: '/?map=assets/maps/_extracted/MapsZH/Maps/MD_GLA05_END/MD_GLA05_END.json',
      warmupMs: 15_000,
      expectation: expect.objectContaining({
        maxPlacementUnresolvedObjects: 0,
        maxUnresolvedEntityCount: 0,
        maxPlaceholderEntityCount: 0,
        minRenderableCount: 100,
      }),
    }));
    expect(specs[1]).toEqual(expect.objectContaining({
      name: 'MD_USA01',
      warmupMs: 15_000,
      expectation: expect.objectContaining({
        expectSkyboxVisible: true,
      }),
    }));
    expect(specs[2]).toEqual(expect.objectContaining({
      name: 'MD_USA03_CINE',
      warmupMs: 15_000,
    }));
  });
});
