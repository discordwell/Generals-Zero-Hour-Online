import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { parseSaveGameInfo } from '@generals/engine';

test.describe.configure({ mode: 'parallel' });

const E2E_AUTO_PAUSE_KEY = '__GENERALS_E2E_AUTO_PAUSE__';

async function openLoadGameScreen(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 120_000 });

  await page.getByRole('button', { name: 'Replay' }).click();
  await page.getByRole('button', { name: 'Load Game' }).click();
  await expect(page.locator('.load-game-overlay')).toBeVisible({ timeout: 120_000 });
}

async function waitForE2EHook(
  page: import('@playwright/test').Page,
  diagnostics: readonly string[],
): Promise<void> {
  try {
    await page.waitForFunction(() => Boolean((window as Record<string, unknown>)['__GENERALS_E2E__']), {
      timeout: 120_000,
    });
  } catch (error) {
    const loadingStatus = await page.locator('#loading-status').textContent().catch(() => null);
    throw new Error([
      `Timed out waiting for loaded game hook at status "${loadingStatus ?? '<missing>'}".`,
      ...diagnostics.slice(-20),
      error instanceof Error ? error.message : String(error),
    ].join('\n'));
  }
}

async function requestAutoPauseOnNextLoad(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate((key) => {
    (window as Record<string, unknown>)[key] = true;
  }, E2E_AUTO_PAUSE_KEY);
}

async function pauseLoadedSimulation(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(() => {
    const hook = (window as Record<string, any>)['__GENERALS_E2E__'];
    hook?.setSimulationPaused?.(true);
  });
}

interface RoundtripFixture {
  fileName: string;
  title: string;
  expectedPlayerSideLower?: string;
}

interface SourceSaveMapAssetReport {
  requiredMaps?: Array<{
    availableOutputPath?: string | null;
    saveFiles?: string[];
  }>;
}

function bufferToArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

function loadAutoRoundtripFixtures(): RoundtripFixture[] {
  const reportPath = resolve('source-save-map-asset-report.json');
  const report = JSON.parse(readFileSync(reportPath, 'utf8')) as SourceSaveMapAssetReport;
  const fixtures: RoundtripFixture[] = [];
  const seen = new Set<string>();

  for (const map of report.requiredMaps ?? []) {
    if (!map.availableOutputPath || !map.availableOutputPath.includes('MapsZH')) {
      continue;
    }
    for (const fileName of [...(map.saveFiles ?? [])].filter((entry) => entry.startsWith('zipeater_ZH_')).sort()) {
      if (seen.has(fileName)) {
        continue;
      }
      const saveBytes = readFileSync(resolve('fixtures/source-saves', fileName));
      const saveInfo = parseSaveGameInfo(bufferToArrayBuffer(saveBytes));
      fixtures.push({
        fileName,
        title: saveInfo.description,
      });
      seen.add(fileName);
    }
  }

  return fixtures.sort((left, right) => left.fileName.localeCompare(right.fileName));
}

const curatedRoundtripFixtures: RoundtripFixture[] = [
  {
    fileName: 'zipeater_ZH_000.sav',
    title: 'Hard Start - USA',
    expectedPlayerSideLower: 'america',
  },
  {
    fileName: 'zipeater_ZH_005.sav',
    title: 'Hard Start - GLA',
  },
  {
    fileName: 'zipeater_ZH_010.sav',
    title: 'Hard Start - China',
  },
  {
    fileName: 'zipeater_ZH_038.sav',
    title: 'Hard Air Force - 2 - Nuke',
    expectedPlayerSideLower: 'glatoxingeneral',
  },
  {
    fileName: 'zipeater_ZH_130.sav',
    title: 'Easy Demolition - 1 - Superweapon',
  },
  {
    fileName: 'zipeater_ZH_160.sav',
    title: 'Brutal Finale - China Nuke Party',
  },
  {
    fileName: 'zipeater_ZH_161.sav',
    title: "Brutal Finale - General Tao's Nuke Party",
  },
];

const roundtripFixtures: RoundtripFixture[] = (() => {
  const seen = new Set(curatedRoundtripFixtures.map((fixture) => fixture.fileName));
  const fixtures = [...curatedRoundtripFixtures];
  for (const fixture of loadAutoRoundtripFixtures()) {
    if (seen.has(fixture.fileName)) {
      continue;
    }
    fixtures.push(fixture);
  }
  return fixtures;
})();

for (const fixture of roundtripFixtures) {
  test(`roundtrips imported ZH source save through TS save/load: ${fixture.fileName}`, async ({ page }) => {
    test.setTimeout(180_000);
    const errors: string[] = [];
    const diagnostics: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (message) => diagnostics.push(`console:${message.type()}: ${message.text()}`));
    page.on('requestfailed', (request) => {
      diagnostics.push(`requestfailed: ${request.url()} ${request.failure()?.errorText ?? ''}`);
    });

    await openLoadGameScreen(page);

    const fixturePath = resolve('fixtures/source-saves', fixture.fileName);
    await page.locator('[data-ref="load-game-import-input"]').setInputFiles(fixturePath);
    await expect(page.locator('.load-game-row-title', { hasText: fixture.title })).toBeVisible({
      timeout: 120_000,
    });

    await requestAutoPauseOnNextLoad(page);
    await page.locator('.load-game-overlay [data-action="load"]').click();
    await page.locator('.load-game-overlay [data-action="confirm-load"]').click();

    await waitForE2EHook(page, diagnostics);
    await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 120_000 });
    await expect(page.locator('#game-canvas')).toBeVisible({ timeout: 120_000 });
    await pauseLoadedSimulation(page);

    const slotId = `e2e-source-roundtrip-${fixture.fileName.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
    const saveDescription = `E2E ${fixture.title}`;

    const importedState = await page.evaluate(async ({ slotId, saveDescription }) => {
      const hook = (window as Record<string, any>)['__GENERALS_E2E__'];
      const logic = hook?.gameLogic;
      if (!hook || !logic) {
        return null;
      }
      const summarizeTeamFactory = () => {
        const teamFactory = logic.captureSourceTeamFactoryRuntimeSaveState?.();
        const teamsByName = teamFactory?.state?.scriptTeamsByName;
        const scriptEngine = logic.captureSourceScriptEngineRuntimeSaveState?.();
        const scriptState = scriptEngine?.state ?? {};
        const coreState = logic.captureSourceGameLogicRuntimeSaveState?.();
        const playerSnapshot = logic.captureSourcePlayerRuntimeSaveState?.();
        const playerState = playerSnapshot?.state ?? {};
        const mapSize = (value: unknown): number | null => value instanceof Map ? value.size : null;
        const setSize = (value: unknown): number | null => value instanceof Set ? value.size : null;
        const commandQueue = Array.isArray(logic.commandQueue) ? logic.commandQueue : null;
        const normalizeForDigest = (value: unknown): unknown => {
          if (value instanceof Map) {
            return [...value.entries()]
              .sort(([left], [right]) => String(left).localeCompare(String(right)))
              .map(([key, entry]) => [key, normalizeForDigest(entry)]);
          }
          if (value instanceof Set) {
            return [...value.values()].sort((left, right) => String(left).localeCompare(String(right)));
          }
          if (Array.isArray(value)) {
            return value.map((entry) => normalizeForDigest(entry));
          }
          if (value && typeof value === 'object') {
            return Object.fromEntries(
              Object.entries(value)
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([key, entry]) => [key, normalizeForDigest(entry)]),
            );
          }
          return value;
        };
        const digest = (value: unknown): number => {
          const text = JSON.stringify(normalizeForDigest(value));
          let hash = 2166136261;
          for (let i = 0; i < text.length; i += 1) {
            hash ^= text.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
          }
          return hash >>> 0;
        };
        const playerSummary = {
          digests: Object.fromEntries(
            Object.entries(playerState)
              .sort(([left], [right]) => left.localeCompare(right))
              .map(([key, value]) => [key, digest(value)]),
          ),
          tunnelTrackers: digest(playerSnapshot?.tunnelTrackers ?? []),
        };
        const aiSummary = {
          logicFrame: coreState?.frameCounter ?? null,
          nextId: coreState?.nextId ?? null,
          animationTime: Object.is(coreState?.animationTime, -0) ? '-0' : coreState?.animationTime ?? null,
          commandQueueLength: commandQueue?.length ?? null,
          commandQueueTypes: commandQueue?.map((command: { type?: string }) => command?.type ?? '') ?? null,
          scriptCompletedVideosLength: Array.isArray(scriptState.scriptCompletedVideos)
            ? scriptState.scriptCompletedVideos.length
            : null,
          scriptCompletedSpeechLength: Array.isArray(scriptState.scriptCompletedSpeech)
            ? scriptState.scriptCompletedSpeech.length
            : null,
          scriptCompletedAudioLength: Array.isArray(scriptState.scriptCompletedAudio)
            ? scriptState.scriptCompletedAudio.length
            : null,
          scriptCompletedMusicLength: Array.isArray(scriptState.scriptCompletedMusic)
            ? scriptState.scriptCompletedMusic.length
            : null,
          scriptAudioLengthMapSize: mapSize(scriptState.scriptAudioLengthMsByName),
          scriptSpeechCompletionMapSize: mapSize(scriptState.scriptTestingSpeechCompletionFrameByName),
          scriptAudioCompletionMapSize: mapSize(scriptState.scriptTestingAudioCompletionFrameByName),
          scriptCountersSize: mapSize(scriptState.scriptCountersByName),
          scriptFlagsSize: mapSize(scriptState.scriptFlagsByName),
          scriptUIInteractionsSize: setSize(scriptState.scriptUIInteractions),
          scriptActiveSize: mapSize(scriptState.scriptActiveByName),
          scriptSubroutineCallsLength: Array.isArray(scriptState.scriptSubroutineCalls)
            ? scriptState.scriptSubroutineCalls.length
            : null,
          scriptTeamCreatedReadySize: mapSize(scriptState.scriptTeamCreatedReadyFrameByName),
          scriptTeamCreatedAutoClearSize: mapSize(scriptState.scriptTeamCreatedAutoClearFrameByName),
          pendingReinforcementTransportArrivalSize:
            mapSize(scriptState.pendingScriptReinforcementTransportArrivalByEntityId),
          digests: {
            coreScalars: digest({
              frameCounter: coreState?.frameCounter ?? null,
              nextId: coreState?.nextId ?? null,
              animationTime: Object.is(coreState?.animationTime, -0) ? '-0' : coreState?.animationTime ?? null,
              isAttackMoveToMode: logic.isAttackMoveToMode ?? null,
              previousAttackMoveToggleDown: logic.previousAttackMoveToggleDown ?? null,
              scriptInputDisabled: logic.scriptInputDisabled ?? null,
            }),
            scriptCompletion: digest({
              scriptCompletedVideos: scriptState.scriptCompletedVideos,
              scriptCompletedSpeech: scriptState.scriptCompletedSpeech,
              scriptCompletedAudio: scriptState.scriptCompletedAudio,
              scriptAudioLengthMsByName: scriptState.scriptAudioLengthMsByName,
              scriptTestingSpeechCompletionFrameByName: scriptState.scriptTestingSpeechCompletionFrameByName,
              scriptTestingAudioCompletionFrameByName: scriptState.scriptTestingAudioCompletionFrameByName,
              scriptCompletedMusic: scriptState.scriptCompletedMusic,
            }),
            scriptCounters: digest(scriptState.scriptCountersByName),
            scriptFlagsAndActivity: digest({
              scriptFlagsByName: scriptState.scriptFlagsByName,
              scriptUIInteractions: scriptState.scriptUIInteractions,
              scriptActiveByName: scriptState.scriptActiveByName,
              scriptSubroutineCalls: scriptState.scriptSubroutineCalls,
              scriptCameraMovementFinished: scriptState.scriptCameraMovementFinished,
              scriptRadarForced: scriptState.scriptRadarForced,
              scriptRadarRefreshFrame: scriptState.scriptRadarRefreshFrame,
            }),
            scriptTeams: digest(teamsByName),
            scriptCreatedTeamFrames: digest({
              scriptTeamCreatedReadyFrameByName: scriptState.scriptTeamCreatedReadyFrameByName,
              scriptTeamCreatedAutoClearFrameByName: scriptState.scriptTeamCreatedAutoClearFrameByName,
            }),
            pendingReinforcements: digest(scriptState.pendingScriptReinforcementTransportArrivalByEntityId),
            config: digest({
              renderUnknownObjects: logic.config?.renderUnknownObjects,
              attackUsesLineOfSight: logic.config?.attackUsesLineOfSight,
              defaultMoveSpeed: logic.config?.defaultMoveSpeed,
              terrainSnapSpeed: logic.config?.terrainSnapSpeed,
              sellPercentage: logic.config?.sellPercentage,
            }),
            runtimeAiConfig: digest(logic.runtimeAiConfig),
            commandQueue: digest(commandQueue ?? []),
          },
          teamDigests: teamsByName instanceof Map
            ? [...teamsByName.entries()]
              .map(([name, team]) => [String(name), digest(team)] as const)
              .sort(([left], [right]) => left.localeCompare(right))
            : [],
          teamRecords: teamsByName instanceof Map
            ? [...teamsByName.entries()]
              .map(([name, team]) => [String(name), normalizeForDigest(team)] as const)
              .sort(([left], [right]) => left.localeCompare(right))
            : [],
        };
        if (!(teamsByName instanceof Map)) {
          return {
            teamCount: null,
            sourceTeamCount: null,
            centralGuardSide: null,
            aiSummary,
          };
        }
        const names = [...teamsByName.keys()].map((name) => String(name));
        const centralGuard = teamsByName.get('CENTRAL_GUARD');
        return {
          teamCount: names.length,
          sourceTeamCount: names.filter((name) => /^__SOURCE_TEAM_PROTOTYPE_\d+$/i.test(name)).length,
          centralGuardSide: centralGuard?.controllingSide ?? null,
          playerSummary,
          aiSummary,
        };
      };
      hook.setSimulationPaused?.(true);
      const visual = hook.getVisualDebugState();
      const snapshot = {
        frame: visual.frame,
        crc: hook.computeGameLogicCrc(visual.frame),
        crcSections: hook.computeGameLogicCrcSections(visual.frame),
        mapWidth: logic.loadedMapData?.heightmap?.width ?? null,
        mapHeight: logic.loadedMapData?.heightmap?.height ?? null,
        playerSide0: typeof logic.getPlayerSide === 'function' ? logic.getPlayerSide(0) : null,
        endState: typeof hook.getGameEndState === 'function' ? hook.getGameEndState() : null,
        ...summarizeTeamFactory(),
      };
      const savedSlotId = await hook.saveGame(slotId, saveDescription);
      const savedSlotInspection = typeof hook.inspectRuntimeSaveSlot === 'function'
        ? await hook.inspectRuntimeSaveSlot(savedSlotId)
        : null;
      return { savedSlotId, snapshot, savedSlotInspection };
    }, { slotId, saveDescription });

    const importedSnapshot = importedState?.snapshot ?? null;
    const savedSlotInspection = importedState?.savedSlotInspection ?? null;
    const savedSlotId = importedState?.savedSlotId ?? slotId;

    expect(importedSnapshot).not.toBeNull();
    expect(importedSnapshot?.mapWidth ?? 0).toBeGreaterThan(0);
    expect(importedSnapshot?.mapHeight ?? 0).toBeGreaterThan(0);
    if ('expectedPlayerSideLower' in fixture) {
      expect(importedSnapshot?.playerSide0?.toLowerCase?.()).toBe(fixture.expectedPlayerSideLower);
    } else {
      expect(importedSnapshot?.playerSide0).toBeTruthy();
    }

    await page.evaluate(async (slotId) => {
      const hook = (window as Record<string, any>)['__GENERALS_E2E__'];
      hook?.setSimulationPaused?.(true);
      hook?.setAutoPauseOnNextLoad?.(true);
      await hook.loadGameFromSlot(slotId);
    }, savedSlotId);

    await waitForE2EHook(page, diagnostics);
    await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 120_000 });
    await expect(page.locator('#game-canvas')).toBeVisible({ timeout: 120_000 });
    await pauseLoadedSimulation(page);

    const restoredSnapshot = await page.evaluate(() => {
      const hook = (window as Record<string, any>)['__GENERALS_E2E__'];
      const logic = hook?.gameLogic;
      if (!hook || !logic) {
        return null;
      }
      const summarizeTeamFactory = () => {
        const teamFactory = logic.captureSourceTeamFactoryRuntimeSaveState?.();
        const teamsByName = teamFactory?.state?.scriptTeamsByName;
        const scriptEngine = logic.captureSourceScriptEngineRuntimeSaveState?.();
        const scriptState = scriptEngine?.state ?? {};
        const coreState = logic.captureSourceGameLogicRuntimeSaveState?.();
        const playerSnapshot = logic.captureSourcePlayerRuntimeSaveState?.();
        const playerState = playerSnapshot?.state ?? {};
        const mapSize = (value: unknown): number | null => value instanceof Map ? value.size : null;
        const setSize = (value: unknown): number | null => value instanceof Set ? value.size : null;
        const commandQueue = Array.isArray(logic.commandQueue) ? logic.commandQueue : null;
        const normalizeForDigest = (value: unknown): unknown => {
          if (value instanceof Map) {
            return [...value.entries()]
              .sort(([left], [right]) => String(left).localeCompare(String(right)))
              .map(([key, entry]) => [key, normalizeForDigest(entry)]);
          }
          if (value instanceof Set) {
            return [...value.values()].sort((left, right) => String(left).localeCompare(String(right)));
          }
          if (Array.isArray(value)) {
            return value.map((entry) => normalizeForDigest(entry));
          }
          if (value && typeof value === 'object') {
            return Object.fromEntries(
              Object.entries(value)
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([key, entry]) => [key, normalizeForDigest(entry)]),
            );
          }
          return value;
        };
        const digest = (value: unknown): number => {
          const text = JSON.stringify(normalizeForDigest(value));
          let hash = 2166136261;
          for (let i = 0; i < text.length; i += 1) {
            hash ^= text.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
          }
          return hash >>> 0;
        };
        const playerSummary = {
          digests: Object.fromEntries(
            Object.entries(playerState)
              .sort(([left], [right]) => left.localeCompare(right))
              .map(([key, value]) => [key, digest(value)]),
          ),
          tunnelTrackers: digest(playerSnapshot?.tunnelTrackers ?? []),
        };
        const aiSummary = {
          logicFrame: coreState?.frameCounter ?? null,
          nextId: coreState?.nextId ?? null,
          animationTime: Object.is(coreState?.animationTime, -0) ? '-0' : coreState?.animationTime ?? null,
          commandQueueLength: commandQueue?.length ?? null,
          commandQueueTypes: commandQueue?.map((command: { type?: string }) => command?.type ?? '') ?? null,
          scriptCompletedVideosLength: Array.isArray(scriptState.scriptCompletedVideos)
            ? scriptState.scriptCompletedVideos.length
            : null,
          scriptCompletedSpeechLength: Array.isArray(scriptState.scriptCompletedSpeech)
            ? scriptState.scriptCompletedSpeech.length
            : null,
          scriptCompletedAudioLength: Array.isArray(scriptState.scriptCompletedAudio)
            ? scriptState.scriptCompletedAudio.length
            : null,
          scriptCompletedMusicLength: Array.isArray(scriptState.scriptCompletedMusic)
            ? scriptState.scriptCompletedMusic.length
            : null,
          scriptAudioLengthMapSize: mapSize(scriptState.scriptAudioLengthMsByName),
          scriptSpeechCompletionMapSize: mapSize(scriptState.scriptTestingSpeechCompletionFrameByName),
          scriptAudioCompletionMapSize: mapSize(scriptState.scriptTestingAudioCompletionFrameByName),
          scriptCountersSize: mapSize(scriptState.scriptCountersByName),
          scriptFlagsSize: mapSize(scriptState.scriptFlagsByName),
          scriptUIInteractionsSize: setSize(scriptState.scriptUIInteractions),
          scriptActiveSize: mapSize(scriptState.scriptActiveByName),
          scriptSubroutineCallsLength: Array.isArray(scriptState.scriptSubroutineCalls)
            ? scriptState.scriptSubroutineCalls.length
            : null,
          scriptTeamCreatedReadySize: mapSize(scriptState.scriptTeamCreatedReadyFrameByName),
          scriptTeamCreatedAutoClearSize: mapSize(scriptState.scriptTeamCreatedAutoClearFrameByName),
          pendingReinforcementTransportArrivalSize:
            mapSize(scriptState.pendingScriptReinforcementTransportArrivalByEntityId),
          digests: {
            coreScalars: digest({
              frameCounter: coreState?.frameCounter ?? null,
              nextId: coreState?.nextId ?? null,
              animationTime: Object.is(coreState?.animationTime, -0) ? '-0' : coreState?.animationTime ?? null,
              isAttackMoveToMode: logic.isAttackMoveToMode ?? null,
              previousAttackMoveToggleDown: logic.previousAttackMoveToggleDown ?? null,
              scriptInputDisabled: logic.scriptInputDisabled ?? null,
            }),
            scriptCompletion: digest({
              scriptCompletedVideos: scriptState.scriptCompletedVideos,
              scriptCompletedSpeech: scriptState.scriptCompletedSpeech,
              scriptCompletedAudio: scriptState.scriptCompletedAudio,
              scriptAudioLengthMsByName: scriptState.scriptAudioLengthMsByName,
              scriptTestingSpeechCompletionFrameByName: scriptState.scriptTestingSpeechCompletionFrameByName,
              scriptTestingAudioCompletionFrameByName: scriptState.scriptTestingAudioCompletionFrameByName,
              scriptCompletedMusic: scriptState.scriptCompletedMusic,
            }),
            scriptCounters: digest(scriptState.scriptCountersByName),
            scriptFlagsAndActivity: digest({
              scriptFlagsByName: scriptState.scriptFlagsByName,
              scriptUIInteractions: scriptState.scriptUIInteractions,
              scriptActiveByName: scriptState.scriptActiveByName,
              scriptSubroutineCalls: scriptState.scriptSubroutineCalls,
              scriptCameraMovementFinished: scriptState.scriptCameraMovementFinished,
              scriptRadarForced: scriptState.scriptRadarForced,
              scriptRadarRefreshFrame: scriptState.scriptRadarRefreshFrame,
            }),
            scriptTeams: digest(teamsByName),
            scriptCreatedTeamFrames: digest({
              scriptTeamCreatedReadyFrameByName: scriptState.scriptTeamCreatedReadyFrameByName,
              scriptTeamCreatedAutoClearFrameByName: scriptState.scriptTeamCreatedAutoClearFrameByName,
            }),
            pendingReinforcements: digest(scriptState.pendingScriptReinforcementTransportArrivalByEntityId),
            config: digest({
              renderUnknownObjects: logic.config?.renderUnknownObjects,
              attackUsesLineOfSight: logic.config?.attackUsesLineOfSight,
              defaultMoveSpeed: logic.config?.defaultMoveSpeed,
              terrainSnapSpeed: logic.config?.terrainSnapSpeed,
              sellPercentage: logic.config?.sellPercentage,
            }),
            runtimeAiConfig: digest(logic.runtimeAiConfig),
            commandQueue: digest(commandQueue ?? []),
          },
          teamDigests: teamsByName instanceof Map
            ? [...teamsByName.entries()]
              .map(([name, team]) => [String(name), digest(team)] as const)
              .sort(([left], [right]) => left.localeCompare(right))
            : [],
          teamRecords: teamsByName instanceof Map
            ? [...teamsByName.entries()]
              .map(([name, team]) => [String(name), normalizeForDigest(team)] as const)
              .sort(([left], [right]) => left.localeCompare(right))
            : [],
        };
        if (!(teamsByName instanceof Map)) {
          return {
            teamCount: null,
            sourceTeamCount: null,
            centralGuardSide: null,
            aiSummary,
          };
        }
        const names = [...teamsByName.keys()].map((name) => String(name));
        const centralGuard = teamsByName.get('CENTRAL_GUARD');
        return {
          teamCount: names.length,
          sourceTeamCount: names.filter((name) => /^__SOURCE_TEAM_PROTOTYPE_\d+$/i.test(name)).length,
          centralGuardSide: centralGuard?.controllingSide ?? null,
          playerSummary,
          aiSummary,
        };
      };
      const visual = hook.getVisualDebugState();
      return {
        frame: visual.frame,
        crc: hook.computeGameLogicCrc(visual.frame),
        crcSections: hook.computeGameLogicCrcSections(visual.frame),
        mapWidth: logic.loadedMapData?.heightmap?.width ?? null,
        mapHeight: logic.loadedMapData?.heightmap?.height ?? null,
        playerSide0: typeof logic.getPlayerSide === 'function' ? logic.getPlayerSide(0) : null,
        endState: typeof hook.getGameEndState === 'function' ? hook.getGameEndState() : null,
        ...summarizeTeamFactory(),
      };
    });

    if (
      restoredSnapshot?.crc !== importedSnapshot?.crc
      || JSON.stringify(restoredSnapshot?.crcSections ?? null) !== JSON.stringify(importedSnapshot?.crcSections ?? null)
    ) {
      const summarizeMismatch = (snapshot: unknown): unknown => {
        const record = snapshot as {
          crc?: number;
          crcSections?: unknown;
          teamCount?: number | null;
          sourceTeamCount?: number | null;
          centralGuardSide?: string | null;
          playerSummary?: unknown;
          aiSummary?: { digests?: unknown };
        } | null;
        return record
          ? {
              crc: record.crc ?? null,
              crcSections: record.crcSections ?? null,
              teamCount: record.teamCount ?? null,
              sourceTeamCount: record.sourceTeamCount ?? null,
              centralGuardSide: record.centralGuardSide ?? null,
              playerSummary: record.playerSummary ?? null,
              aiDigests: record.aiSummary?.digests ?? null,
            }
          : null;
      };
      console.log(JSON.stringify({
        fixture: fixture.fileName,
        importedSnapshot: summarizeMismatch(importedSnapshot),
        savedSlotInspection,
        restoredSnapshot: summarizeMismatch(restoredSnapshot),
      }, null, 2));
    }

    expect(importedSnapshot?.crc).toEqual(expect.any(Number));
    expect(restoredSnapshot?.crc).toEqual(expect.any(Number));
    expect(importedSnapshot?.crcSections).toEqual(expect.objectContaining({
      ai: expect.any(Number),
      objects: expect.any(Number),
      partitionManager: expect.any(Number),
      playerList: expect.any(Number),
    }));
    expect(restoredSnapshot?.crcSections).toEqual(expect.objectContaining({
      ai: expect.any(Number),
      objects: expect.any(Number),
      partitionManager: expect.any(Number),
      playerList: expect.any(Number),
    }));
    expect(restoredSnapshot?.crc).toBe(importedSnapshot?.crc);
    expect(restoredSnapshot?.crcSections).toEqual(importedSnapshot?.crcSections);
    expect(restoredSnapshot).toEqual(importedSnapshot);
    expect(errors).toEqual([]);
  });
}
