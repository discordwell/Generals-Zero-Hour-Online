import { createServer } from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

export interface VisualSceneDebugState {
  frame: number | null;
  mapPath: string | null;
  placementResolvedObjects: number | null;
  placementSpawnedObjects: number | null;
  placementTotalObjects: number | null;
  placementUnresolvedObjects: number | null;
  renderableCount: number | null;
  sceneObjectCount: number | null;
  debugInfoText: string;
  skyboxLoaded: boolean;
  skyboxVisible: boolean;
  objectVisuals: {
    visualEntityCount: number;
    modelEntityCount: number;
    placeholderEntityCount: number;
    unresolvedEntityCount: number;
    unresolvedEntityIds: number[];
  } | null;
}

export interface VisualSceneExpectation {
  expectSkyboxVisible?: boolean;
  maxPlacementUnresolvedObjects?: number;
  maxUnresolvedEntityCount?: number;
  maxPlaceholderEntityCount?: number;
  minRenderableCount?: number;
}

export interface VisualSceneScenarioSpec {
  id: string;
  name: string;
  url: string;
  warmupMs: number;
  expectation: VisualSceneExpectation;
}

export interface VisualSceneScenarioResult {
  id: string;
  name: string;
  url: string;
  status: 'pass' | 'blocked';
  screenshotPath: string;
  pageErrors: string[];
  consoleErrors: string[];
  consoleWarnings: string[];
  debugState: VisualSceneDebugState | null;
  blockingIssues: string[];
}

export interface VisualSceneParityReport {
  generatedAt: string;
  baseUrl: string;
  summary: {
    scenarioCount: number;
    blockedScenarios: number;
    blockerItems: number;
  };
  scenarios: VisualSceneScenarioResult[];
}

const BASE_VISUAL_SCENE_SPECS: readonly VisualSceneScenarioSpec[] = [
  {
    id: 'tournament-desert',
    name: 'Tournament Desert',
    url: '/?map=assets/maps/_extracted/MapsZH/Maps/Tournament%20Desert/Tournament%20Desert.json',
    warmupMs: 8_000,
    expectation: {
      maxPlacementUnresolvedObjects: 0,
      maxUnresolvedEntityCount: 0,
      maxPlaceholderEntityCount: 0,
      minRenderableCount: 100,
    },
  },
];

const CAMPAIGN_SCENE_EXPECTATION: VisualSceneExpectation = {
  maxPlacementUnresolvedObjects: 0,
  maxUnresolvedEntityCount: 0,
  maxPlaceholderEntityCount: 0,
  minRenderableCount: 100,
};
const SCENARIO_BOOT_TIMEOUT_MS = 45_000;

function buildMapUrl(mapName: string): string {
  const encoded = encodeURIComponent(mapName);
  return `/?map=assets/maps/_extracted/MapsZH/Maps/${encoded}/${encoded}.json`;
}

function selectCampaignWarmupMs(mapName: string): number {
  return /(?:_INTRO|_Intro|_CINE|_END|MD_USA01$|MD_ShellMap$)/.test(mapName)
    ? 15_000
    : 12_000;
}

export function buildCampaignVisualSceneSpecs(mapNames: readonly string[]): VisualSceneScenarioSpec[] {
  return mapNames
    .filter((mapName) => mapName.trim().startsWith('MD_'))
    .sort((left, right) => left.localeCompare(right))
    .map((mapName) => ({
      id: mapName.toLowerCase(),
      name: mapName,
      url: buildMapUrl(mapName),
      warmupMs: selectCampaignWarmupMs(mapName),
      expectation: {
        ...CAMPAIGN_SCENE_EXPECTATION,
        ...(mapName === 'MD_USA01' ? { expectSkyboxVisible: true } : {}),
      },
    }));
}

async function discoverCampaignMapNames(distDir: string): Promise<string[]> {
  const mapsDir = path.join(distDir, 'assets', 'maps', '_extracted', 'MapsZH', 'Maps');
  const entries = await fs.readdir(mapsDir, { withFileTypes: true });
  const mapNames: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('MD_')) {
      continue;
    }
    const jsonPath = path.join(mapsDir, entry.name, `${entry.name}.json`);
    try {
      await fs.access(jsonPath);
      mapNames.push(entry.name);
    } catch {
      // Ignore incomplete map directories.
    }
  }
  return mapNames;
}

function contentTypeFor(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.html': return 'text/html; charset=utf-8';
    case '.js': return 'text/javascript; charset=utf-8';
    case '.css': return 'text/css; charset=utf-8';
    case '.json': return 'application/json; charset=utf-8';
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.svg': return 'image/svg+xml';
    case '.rgba': return 'application/octet-stream';
    case '.glb': return 'model/gltf-binary';
    case '.gltf': return 'model/gltf+json';
    case '.mp4': return 'video/mp4';
    case '.webm': return 'video/webm';
    case '.bin': return 'application/octet-stream';
    case '.woff': return 'font/woff';
    case '.woff2': return 'font/woff2';
    default: return 'application/octet-stream';
  }
}

async function createStaticServer(distDir: string): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = createServer(async (req, res) => {
    const requestUrl = new URL(req.url ?? '/', 'http://127.0.0.1');
    const requestPath = decodeURIComponent(requestUrl.pathname);
    const relativePath = requestPath === '/' ? 'index.html' : requestPath.replace(/^\/+/, '');
    const absolutePath = path.resolve(distDir, relativePath);

    if (!absolutePath.startsWith(distDir)) {
      res.statusCode = 403;
      res.end('Forbidden');
      return;
    }

    try {
      const data = await fs.readFile(absolutePath);
      res.statusCode = 200;
      res.setHeader('Content-Type', contentTypeFor(absolutePath));
      res.end(data);
    } catch {
      res.statusCode = 404;
      res.end('Not Found');
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Static server failed to bind a TCP port.');
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}

export function collectVisualSceneBlockingIssues(
  scenario: Pick<VisualSceneScenarioResult, 'pageErrors' | 'consoleErrors' | 'consoleWarnings' | 'debugState'>,
  expectation: VisualSceneExpectation,
): string[] {
  const issues: string[] = [];

  if (scenario.pageErrors.length > 0) {
    issues.push(`page errors: ${scenario.pageErrors.join(' | ')}`);
  }
  if (scenario.consoleErrors.length > 0) {
    issues.push(`console errors: ${scenario.consoleErrors.join(' | ')}`);
  }
  const assetWarnings = scenario.consoleWarnings.filter((warning) =>
    /\bobjectvisualmanager\b|\bterrainroadrenderer\b|model load failed|texture load failed|failed to load script skybox|failed to load resource/i.test(
      warning,
    ),
  );
  if (assetWarnings.length > 0) {
    issues.push(`asset warnings: ${assetWarnings.join(' | ')}`);
  }

  const debugState = scenario.debugState;
  if (!debugState) {
    issues.push('missing visual debug state');
    return issues;
  }

  if (
    expectation.maxPlacementUnresolvedObjects !== undefined
    && (debugState.placementUnresolvedObjects ?? Number.POSITIVE_INFINITY) > expectation.maxPlacementUnresolvedObjects
  ) {
    issues.push(
      `placement unresolved objects ${debugState.placementUnresolvedObjects ?? 'n/a'} > ${expectation.maxPlacementUnresolvedObjects}`,
    );
  }

  if (
    expectation.minRenderableCount !== undefined
    && (debugState.renderableCount ?? 0) < Math.min(
      expectation.minRenderableCount,
      debugState.placementSpawnedObjects ?? Number.POSITIVE_INFINITY,
    )
  ) {
    const effectiveMinRenderableCount = Math.min(
      expectation.minRenderableCount,
      debugState.placementSpawnedObjects ?? Number.POSITIVE_INFINITY,
    );
    issues.push(
      `renderable count ${debugState.renderableCount ?? 'n/a'} < ${effectiveMinRenderableCount}`,
    );
  }

  const objectVisuals = debugState.objectVisuals;
  if (
    expectation.maxUnresolvedEntityCount !== undefined
    && (objectVisuals?.unresolvedEntityCount ?? Number.POSITIVE_INFINITY) > expectation.maxUnresolvedEntityCount
  ) {
    issues.push(
      `unresolved entities ${objectVisuals?.unresolvedEntityCount ?? 'n/a'} > ${expectation.maxUnresolvedEntityCount}`,
    );
  }

  if (
    expectation.maxPlaceholderEntityCount !== undefined
    && (objectVisuals?.placeholderEntityCount ?? Number.POSITIVE_INFINITY) > expectation.maxPlaceholderEntityCount
  ) {
    issues.push(
      `visible placeholders ${objectVisuals?.placeholderEntityCount ?? 'n/a'} > ${expectation.maxPlaceholderEntityCount}`,
    );
  }

  if (expectation.expectSkyboxVisible !== undefined && debugState.skyboxVisible !== expectation.expectSkyboxVisible) {
    issues.push(
      `skybox visible ${debugState.skyboxVisible} !== expected ${expectation.expectSkyboxVisible}`,
    );
  }

  return issues;
}

export function buildVisualSceneParityReport(
  baseUrl: string,
  scenarios: VisualSceneScenarioResult[],
): VisualSceneParityReport {
  const blockedScenarios = scenarios.filter((scenario) => scenario.status === 'blocked');
  return {
    generatedAt: new Date().toISOString(),
    baseUrl,
    summary: {
      scenarioCount: scenarios.length,
      blockedScenarios: blockedScenarios.length,
      blockerItems: blockedScenarios.reduce((sum, scenario) => sum + scenario.blockingIssues.length, 0),
    },
    scenarios,
  };
}

async function readVisualDebugState(page: import('@playwright/test').Page): Promise<VisualSceneDebugState | null> {
  return page.evaluate(() => {
    const hook = (window as Record<string, any>)['__GENERALS_E2E__'];
    if (!hook || typeof hook.getVisualDebugState !== 'function') {
      return null;
    }
    return hook.getVisualDebugState();
  });
}

async function probeScenario(
  page: import('@playwright/test').Page,
  baseUrl: string,
  scenario: VisualSceneScenarioSpec,
  screenshotDir: string,
): Promise<VisualSceneScenarioResult> {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const consoleWarnings: string[] = [];
  const pageErrorHandler = (error: Error): void => {
    pageErrors.push(error.message);
  };
  const consoleHandler = (message: import('@playwright/test').ConsoleMessage): void => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
      return;
    }
    if (message.type() === 'warning') {
      consoleWarnings.push(message.text());
    }
  };

  page.on('pageerror', pageErrorHandler);
  page.on('console', consoleHandler);

  const screenshotPath = path.join(screenshotDir, `${scenario.id}.png`);
  let debugState: VisualSceneDebugState | null = null;
  try {
    try {
      await page.goto(`${baseUrl}${scenario.url}`);
      await page.locator('#loading-screen').waitFor({ state: 'hidden', timeout: SCENARIO_BOOT_TIMEOUT_MS });
      await page.locator('#game-canvas').waitFor({ state: 'visible', timeout: SCENARIO_BOOT_TIMEOUT_MS });
      await page.waitForFunction(() => Boolean((window as Record<string, unknown>)['__GENERALS_E2E__']), {
        timeout: SCENARIO_BOOT_TIMEOUT_MS,
      });

      await page.waitForTimeout(scenario.warmupMs);
      debugState = await readVisualDebugState(page);
    } catch (error) {
      pageErrors.push(
        `probe failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    try {
      await page.screenshot({ path: screenshotPath, fullPage: true });
    } catch (error) {
      pageErrors.push(
        `screenshot failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  } finally {
    page.off('pageerror', pageErrorHandler);
    page.off('console', consoleHandler);
  }

  const blockingIssues = collectVisualSceneBlockingIssues({
    pageErrors,
    consoleErrors,
    consoleWarnings,
    debugState,
  }, scenario.expectation);

  return {
    id: scenario.id,
    name: scenario.name,
    url: scenario.url,
    status: blockingIssues.length === 0 ? 'pass' : 'blocked',
    screenshotPath,
    pageErrors,
    consoleErrors,
    consoleWarnings,
    debugState,
    blockingIssues,
  };
}

export async function runVisualSceneParityReport(rootDir: string): Promise<VisualSceneParityReport> {
  const distDir = path.join(rootDir, 'packages', 'app', 'dist');
  await fs.access(path.join(distDir, 'index.html'));
  const campaignMapNames = await discoverCampaignMapNames(distDir);
  const scenarioSpecs = [
    ...BASE_VISUAL_SCENE_SPECS,
    ...buildCampaignVisualSceneSpecs(campaignMapNames),
  ];

  const screenshotDir = path.join(rootDir, 'test-results', 'visual-scenes');
  await fs.mkdir(screenshotDir, { recursive: true });

  const server = await createStaticServer(distDir);
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader'],
  });

  try {
    const scenarios: VisualSceneScenarioResult[] = [];
    for (const scenario of scenarioSpecs) {
      const page = await browser.newPage();
      try {
        scenarios.push(await probeScenario(page, server.baseUrl, scenario, screenshotDir));
      } finally {
        await page.close();
      }
    }
    return buildVisualSceneParityReport(server.baseUrl, scenarios);
  } finally {
    await browser.close();
    await server.close();
  }
}

async function main(): Promise<void> {
  const scriptPath = fileURLToPath(import.meta.url);
  const rootDir = path.resolve(path.dirname(scriptPath), '..');
  const outputPath = path.join(rootDir, 'visual-scene-parity-report.json');

  const report = await runVisualSceneParityReport(rootDir);
  await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(`Visual scene parity report written: ${outputPath}`);
  console.table(report.scenarios.map((scenario) => ({
    scene: scenario.name,
    status: scenario.status,
    pageErrors: scenario.pageErrors.length,
    consoleErrors: scenario.consoleErrors.length,
    warnings: scenario.consoleWarnings.length,
    blockers: scenario.blockingIssues.length,
  })));
  console.log('Summary:', report.summary);
}

const executedScriptPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
const currentScriptPath = fileURLToPath(import.meta.url);
if (executedScriptPath === currentScriptPath) {
  await main();
}
