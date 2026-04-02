import { createServer } from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

import { parseWnd, type WndWindow } from './wnd-converter/src/WndParser.js';

export interface UiRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface UiViewport {
  width: number;
  height: number;
}

export interface MainMenuRuntimeButton {
  text: string;
  rect: UiRect | null;
}

export interface MainMenuLayoutDebugState {
  viewport: UiViewport;
  logo: UiRect | null;
  actionPanel: UiRect | null;
  preview: UiRect | null;
  rulerLoaded: boolean;
  logoArtLoaded: boolean;
  actionMapLoaded: boolean;
  pulseLoaded: boolean;
  buttonSkinsLoaded: boolean;
  buttons: MainMenuRuntimeButton[];
}

export interface DifficultyRuntimeOption {
  text: string;
  rect: UiRect | null;
}

export interface DifficultyLayoutDebugState {
  viewport: UiViewport;
  parent: UiRect | null;
  panel: UiRect | null;
  title: UiRect | null;
  options: DifficultyRuntimeOption[];
  confirmButton: UiRect | null;
  cancelButton: UiRect | null;
}

export interface ChallengeRuntimeButton {
  index: number;
  rect: UiRect | null;
}

export interface ChallengeMenuLayoutDebugState {
  viewport: UiViewport;
  background: UiRect | null;
  frame: UiRect | null;
  mainBackdrop: UiRect | null;
  playButton: UiRect | null;
  backButton: UiRect | null;
  bioPanel: UiRect | null;
  bioPortrait: UiRect | null;
  generalButtons: ChallengeRuntimeButton[];
}

export interface CampaignLoadLayoutDebugState {
  viewport: UiViewport;
  background: UiRect | null;
  cameoFrame: UiRect | null;
  head: UiRect | null;
  location: UiRect | null;
  objectives: UiRect | null;
  progress: UiRect | null;
  percent: UiRect | null;
  objectiveLines: Array<{ index: number; rect: UiRect | null }>;
  unitTexts: Array<{ key: string; rect: UiRect | null }>;
}

export interface HudLayoutDebugState {
  viewport: UiViewport;
  buttonCount: number;
  minimap: UiRect | null;
  commandCard: UiRect | null;
  creditsHud: UiRect | null;
  powerHud: UiRect | null;
}

export type UiLayoutDebugState =
  | MainMenuLayoutDebugState
  | DifficultyLayoutDebugState
  | ChallengeMenuLayoutDebugState
  | CampaignLoadLayoutDebugState
  | HudLayoutDebugState;

export interface UiLayoutScenarioResult {
  id: string;
  name: string;
  url: string;
  status: 'pass' | 'blocked';
  screenshotPath: string;
  pageErrors: string[];
  consoleErrors: string[];
  consoleWarnings: string[];
  debugState: UiLayoutDebugState | null;
  blockingIssues: string[];
}

export interface UiLayoutParityReport {
  generatedAt: string;
  baseUrl: string;
  summary: {
    scenarioCount: number;
    blockedScenarios: number;
    blockerItems: number;
  };
  scenarios: UiLayoutScenarioResult[];
}

const SOURCE_RESOLUTION = { width: 800, height: 600 } as const;
const MAIN_MENU_BUTTON_SEQUENCE = [
  'ButtonSinglePlayer',
  'ButtonMultiplayer',
  'ButtonLoadReplay',
  'ButtonOptions',
  'ButtonExit',
] as const;
const SINGLE_PLAYER_BUTTON_SEQUENCE = [
  'ButtonUSA',
  'ButtonGLA',
  'ButtonChina',
  'ButtonChallenge',
  'ButtonSkirmish',
  'ButtonSingleBack',
] as const;
const HUD_COMMAND_BUTTON_SEQUENCE = [
  'ButtonCommand01',
  'ButtonCommand02',
  'ButtonCommand03',
  'ButtonCommand04',
  'ButtonCommand05',
  'ButtonCommand06',
  'ButtonCommand07',
  'ButtonCommand08',
  'ButtonCommand09',
  'ButtonCommand10',
  'ButtonCommand11',
  'ButtonCommand12',
  'ButtonCommand13',
  'ButtonCommand14',
] as const;
const MAIN_MENU_TEXT_BY_TOKEN: Record<string, string> = {
  'GUI:SinglePlayer': 'Single Player',
  'GUI:Multiplayer': 'Multiplayer',
  'GUI:ReplayMenu': 'Replay',
  'GUI:Options': 'Options',
  'GUI:Exit': 'Exit',
};
const SINGLE_PLAYER_TEXT_BY_TOKEN: Record<string, string> = {
  'GUI:USA': 'USA',
  'GUI:GLA': 'GLA',
  'GUI:CHINA_Caps': 'CHINA',
  'GUI:Generals_Challenge': 'Generals Challenge',
  'GUI:Skirmish': 'Skirmish',
  'GUI:Back': 'Back',
};
const DIFFICULTY_OPTION_SEQUENCE = [
  'RadioButtonEasy',
  'RadioButtonMedium',
  'RadioButtonHard',
] as const;
const DIFFICULTY_TEXT_BY_TOKEN: Record<string, string> = {
  'GUI:Easy': 'Easy',
  'GUI:Medium': 'Medium',
  'GUI:Hard': 'Hard',
};
const CHALLENGE_GENERAL_SEQUENCE = Array.from({ length: 12 }, (_, index) => `GeneralPosition${index}` as const);
const CAMPAIGN_LOAD_UNIT_TEXT_SEQUENCE = [
  'StaticTextCameoText0',
  'StaticTextCameoText1',
  'StaticTextCameoText2',
] as const;
const CAMPAIGN_LOAD_OBJECTIVE_LINE_SEQUENCE = [
  'StaticTextLine0',
  'StaticTextLine1',
  'StaticTextLine2',
  'StaticTextLine3',
  'StaticTextLine4',
] as const;
const UI_LAYOUT_TOLERANCE_PX = 24;
const SCENARIO_BOOT_TIMEOUT_MS = 45_000;

function flattenWindows(windows: readonly WndWindow[]): WndWindow[] {
  return windows.flatMap((window) => [window, ...flattenWindows(window.children)]);
}

function uiRectFromWnd(window: WndWindow): UiRect {
  return {
    x: window.screenRect.upperLeft.x,
    y: window.screenRect.upperLeft.y,
    width: window.screenRect.bottomRight.x - window.screenRect.upperLeft.x,
    height: window.screenRect.bottomRight.y - window.screenRect.upperLeft.y,
  };
}

export function scaleSourceRect(rect: UiRect, viewport: UiViewport): UiRect {
  return {
    x: rect.x * (viewport.width / SOURCE_RESOLUTION.width),
    y: rect.y * (viewport.height / SOURCE_RESOLUTION.height),
    width: rect.width * (viewport.width / SOURCE_RESOLUTION.width),
    height: rect.height * (viewport.height / SOURCE_RESOLUTION.height),
  };
}

function rectDistance(actual: UiRect, expected: UiRect): number {
  return Math.max(
    Math.abs(actual.x - expected.x),
    Math.abs(actual.y - expected.y),
    Math.abs(actual.width - expected.width),
    Math.abs(actual.height - expected.height),
  );
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

function lookupWindowBySuffix(windows: readonly WndWindow[], suffix: string): WndWindow {
  const window = flattenWindows(windows).find((candidate) => candidate.name.endsWith(`:${suffix}`));
  if (!window) {
    throw new Error(`WND window "${suffix}" not found.`);
  }
  return window;
}

function buildSourceShellMenuLayout(
  mainMenuWindows: readonly WndWindow[],
  buttonSequence: readonly string[],
  textByToken: Readonly<Record<string, string>>,
  actionPanelSuffix: string,
): {
  buttons: Array<{ text: string; rect: UiRect }>;
  logo: UiRect;
  actionPanel: UiRect;
  preview: UiRect;
} {
  const buttons = buttonSequence.map((buttonName) => {
    const buttonWindow = lookupWindowBySuffix(mainMenuWindows, buttonName);
    const localizedText = buttonWindow.text ? textByToken[buttonWindow.text] : null;
    if (!localizedText) {
      throw new Error(`Retail shell button "${buttonName}" is missing a known text token.`);
    }
    return {
      text: localizedText,
      rect: uiRectFromWnd(buttonWindow),
    };
  });

  return {
    buttons,
    logo: uiRectFromWnd(lookupWindowBySuffix(mainMenuWindows, 'Logo')),
    actionPanel: uiRectFromWnd(lookupWindowBySuffix(mainMenuWindows, actionPanelSuffix)),
    preview: uiRectFromWnd(lookupWindowBySuffix(mainMenuWindows, 'WinGrowMarker')),
  };
}

function buildSourceHudRects(controlBarWindows: readonly WndWindow[]): {
  minimap: UiRect;
  commandCard: UiRect;
  creditsHud: UiRect;
  powerHud: UiRect;
} {
  const commandRects = HUD_COMMAND_BUTTON_SEQUENCE.map((buttonName) => uiRectFromWnd(lookupWindowBySuffix(controlBarWindows, buttonName)));
  const minX = Math.min(...commandRects.map((rect) => rect.x));
  const minY = Math.min(...commandRects.map((rect) => rect.y));
  const maxX = Math.max(...commandRects.map((rect) => rect.x + rect.width));
  const maxY = Math.max(...commandRects.map((rect) => rect.y + rect.height));

  return {
    minimap: uiRectFromWnd(lookupWindowBySuffix(controlBarWindows, 'LeftHUD')),
    commandCard: {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    },
    creditsHud: uiRectFromWnd(lookupWindowBySuffix(controlBarWindows, 'MoneyDisplay')),
    powerHud: uiRectFromWnd(lookupWindowBySuffix(controlBarWindows, 'PowerWindow')),
  };
}

function buildSourceDifficultyLayout(difficultyWindows: readonly WndWindow[]): {
  parent: UiRect;
  panel: UiRect;
  title: UiRect;
  options: Array<{ text: string; rect: UiRect }>;
  confirmButton: UiRect;
  cancelButton: UiRect;
} {
  const allWindows = flattenWindows(difficultyWindows);
  const parent = uiRectFromWnd(lookupWindowBySuffix(difficultyWindows, 'DifficultySelectParent'));
  const panelWindow = allWindows.find((window) =>
    window.windowType === 'USER'
    && window.name === 'DifficultySelect.wnd:'
    && window.children.some((child) => child.name.endsWith(':RadioButtonEasy')),
  );
  const titleWindow = allWindows.find((window) => window.text === 'GUI:SelectDifficulty');
  if (!panelWindow || !titleWindow) {
    throw new Error('Retail difficulty dialog is missing its panel or title window.');
  }

  return {
    parent,
    panel: uiRectFromWnd(panelWindow),
    title: uiRectFromWnd(titleWindow),
    options: DIFFICULTY_OPTION_SEQUENCE.map((buttonName) => {
      const optionWindow = lookupWindowBySuffix(difficultyWindows, buttonName);
      const localizedText = optionWindow.text ? DIFFICULTY_TEXT_BY_TOKEN[optionWindow.text] : null;
      if (!localizedText) {
        throw new Error(`Retail difficulty option "${buttonName}" is missing a known text token.`);
      }
      return {
        text: localizedText,
        rect: uiRectFromWnd(optionWindow),
      };
    }),
    confirmButton: uiRectFromWnd(lookupWindowBySuffix(difficultyWindows, 'ButtonOk')),
    cancelButton: uiRectFromWnd(lookupWindowBySuffix(difficultyWindows, 'ButtonCancel')),
  };
}

function buildSourceChallengeLayout(challengeWindows: readonly WndWindow[]): {
  background: UiRect;
  frame: UiRect;
  mainBackdrop: UiRect;
  playButton: UiRect;
  backButton: UiRect;
  bioPanel: UiRect;
  bioPortrait: UiRect;
  generalButtons: Array<{ index: number; rect: UiRect }>;
} {
  return {
    background: uiRectFromWnd(lookupWindowBySuffix(challengeWindows, 'BackgroundWindow')),
    frame: uiRectFromWnd(lookupWindowBySuffix(challengeWindows, 'Frame')),
    mainBackdrop: uiRectFromWnd(lookupWindowBySuffix(challengeWindows, 'MainBackdrop')),
    playButton: uiRectFromWnd(lookupWindowBySuffix(challengeWindows, 'ButtonPlay')),
    backButton: uiRectFromWnd(lookupWindowBySuffix(challengeWindows, 'ButtonBack')),
    bioPanel: uiRectFromWnd(lookupWindowBySuffix(challengeWindows, 'GeneralsBioParent')),
    bioPortrait: uiRectFromWnd(lookupWindowBySuffix(challengeWindows, 'BioPortrait')),
    generalButtons: CHALLENGE_GENERAL_SEQUENCE.map((buttonName, index) => {
      const wndRect = uiRectFromWnd(lookupWindowBySuffix(challengeWindows, buttonName));
      return {
        index,
        rect: {
          x: wndRect.x,
          y: wndRect.y,
          width: Math.max(wndRect.width, 41),
          height: Math.max(wndRect.height, 41),
        },
      };
    }),
  };
}

function buildSourceCampaignLoadLayout(loadScreenWindows: readonly WndWindow[]): {
  background: UiRect;
  cameoFrame: UiRect;
  head: UiRect;
  location: UiRect;
  objectives: UiRect;
  progress: UiRect;
  percent: UiRect;
  objectiveLines: Array<{ index: number; rect: UiRect }>;
  unitTexts: Array<{ key: string; rect: UiRect }>;
} {
  return {
    background: uiRectFromWnd(lookupWindowBySuffix(loadScreenWindows, 'ParentSinglePlayerLoadScreen')),
    cameoFrame: uiRectFromWnd(lookupWindowBySuffix(loadScreenWindows, 'WindowHiliteCameo')),
    head: uiRectFromWnd(lookupWindowBySuffix(loadScreenWindows, 'WindowHead')),
    location: uiRectFromWnd(lookupWindowBySuffix(loadScreenWindows, 'StaticTextCameoText3')),
    objectives: uiRectFromWnd(lookupWindowBySuffix(loadScreenWindows, 'ObjectivesWin')),
    progress: uiRectFromWnd(lookupWindowBySuffix(loadScreenWindows, 'ProgressLoad')),
    percent: uiRectFromWnd(lookupWindowBySuffix(loadScreenWindows, 'Percent')),
    objectiveLines: CAMPAIGN_LOAD_OBJECTIVE_LINE_SEQUENCE.map((lineName, index) => ({
      index,
      rect: uiRectFromWnd(lookupWindowBySuffix(loadScreenWindows, lineName)),
    })),
    unitTexts: CAMPAIGN_LOAD_UNIT_TEXT_SEQUENCE.map((windowName, index) => ({
      key: `unit${index}`,
      rect: uiRectFromWnd(lookupWindowBySuffix(loadScreenWindows, windowName)),
    })),
  };
}

function mainMenuRectIssue(
  label: string,
  actualRect: UiRect | null,
  expectedRect: UiRect | undefined,
  viewport: UiViewport,
): string | null {
  if (!actualRect || !expectedRect) {
    return `${label} bounds missing`;
  }

  const scaledExpected = scaleSourceRect(expectedRect, viewport);
  if (rectDistance(actualRect, scaledExpected) <= UI_LAYOUT_TOLERANCE_PX) {
    return null;
  }

  return `${label} bounds diverge from retail (${Math.round(actualRect.x)},${Math.round(actualRect.y)},${Math.round(actualRect.width)}x${Math.round(actualRect.height)} vs ${Math.round(scaledExpected.x)},${Math.round(scaledExpected.y)},${Math.round(scaledExpected.width)}x${Math.round(scaledExpected.height)})`;
}

export function collectUiLayoutBlockingIssues(
  scenarioId: 'main-menu' | 'single-player' | 'campaign-difficulty' | 'challenge-menu' | 'campaign-load' | 'in-game-hud',
  debugState: UiLayoutDebugState | null,
  expectedSource: {
    mainMenuButtons?: Array<{ text: string; rect: UiRect }>;
    mainMenuLogo?: UiRect;
    mainMenuActionPanel?: UiRect;
    mainMenuPreview?: UiRect;
    difficultyParent?: UiRect;
    difficultyPanel?: UiRect;
    difficultyTitle?: UiRect;
    difficultyOptions?: Array<{ text: string; rect: UiRect }>;
    difficultyConfirmButton?: UiRect;
    difficultyCancelButton?: UiRect;
    challengeBackground?: UiRect;
    challengeFrame?: UiRect;
    challengeMainBackdrop?: UiRect;
    challengePlayButton?: UiRect;
    challengeBackButton?: UiRect;
    challengeBioPanel?: UiRect;
    challengeBioPortrait?: UiRect;
    challengeGeneralButtons?: Array<{ index: number; rect: UiRect }>;
    campaignLoadBackground?: UiRect;
    campaignLoadCameoFrame?: UiRect;
    campaignLoadHead?: UiRect;
    campaignLoadLocation?: UiRect;
    campaignLoadObjectives?: UiRect;
    campaignLoadProgress?: UiRect;
    campaignLoadPercent?: UiRect;
    campaignLoadObjectiveLines?: Array<{ index: number; rect: UiRect }>;
    campaignLoadUnitTexts?: Array<{ key: string; rect: UiRect }>;
    minimap?: UiRect;
    commandCard?: UiRect;
    creditsHud?: UiRect;
    powerHud?: UiRect;
  },
): string[] {
  if (!debugState) {
    return ['missing runtime debug state'];
  }

  const issues: string[] = [];

  if (scenarioId === 'main-menu' || scenarioId === 'single-player') {
    const menuDebugState = debugState as MainMenuLayoutDebugState;
    const menuLabel = scenarioId === 'single-player' ? 'single-player menu' : 'main menu';
    const expectedButtons = expectedSource.mainMenuButtons ?? [];
    const actualTexts = menuDebugState.buttons.map((button) => button.text);
    const expectedTexts = expectedButtons.map((button) => button.text);
    if (JSON.stringify(actualTexts) !== JSON.stringify(expectedTexts)) {
      issues.push(`${menuLabel} button order mismatch: ${actualTexts.join(', ') || '(none)'} !== ${expectedTexts.join(', ')}`);
    }
    const logoIssue = mainMenuRectIssue(`${menuLabel} logo`, menuDebugState.logo, expectedSource.mainMenuLogo, menuDebugState.viewport);
    if (logoIssue) issues.push(logoIssue);
    const actionPanelIssue = mainMenuRectIssue(`${menuLabel} action panel`, menuDebugState.actionPanel, expectedSource.mainMenuActionPanel, menuDebugState.viewport);
    if (actionPanelIssue) issues.push(actionPanelIssue);
    const previewIssue = mainMenuRectIssue(`${menuLabel} preview panel`, menuDebugState.preview, expectedSource.mainMenuPreview, menuDebugState.viewport);
    if (previewIssue) issues.push(previewIssue);
    if (!menuDebugState.rulerLoaded) {
      issues.push(`${menuLabel} ruler artwork missing`);
    }
    if (!menuDebugState.logoArtLoaded) {
      issues.push(`${menuLabel} logo artwork missing`);
    }
    if (!menuDebugState.actionMapLoaded) {
      issues.push(`${menuLabel} action-panel map artwork missing`);
    }
    if (!menuDebugState.pulseLoaded) {
      issues.push(`${menuLabel} pulse artwork missing`);
    }
    if (!menuDebugState.buttonSkinsLoaded) {
      issues.push(`${menuLabel} button skin artwork missing`);
    }
    for (let index = 0; index < Math.min(menuDebugState.buttons.length, expectedButtons.length); index++) {
      const actualButton = menuDebugState.buttons[index]!;
      const expectedButton = expectedButtons[index]!;
      const buttonIssue = mainMenuRectIssue(
        `${menuLabel} button "${actualButton.text}"`,
        actualButton.rect,
        expectedButton.rect,
        menuDebugState.viewport,
      );
      if (buttonIssue) issues.push(buttonIssue);
    }
    return issues;
  }

  if (scenarioId === 'campaign-difficulty') {
    const dialogDebugState = debugState as DifficultyLayoutDebugState;
    const expectedOptions = expectedSource.difficultyOptions ?? [];
    const actualTexts = dialogDebugState.options.map((option) => option.text);
    const expectedTexts = expectedOptions.map((option) => option.text);
    if (JSON.stringify(actualTexts) !== JSON.stringify(expectedTexts)) {
      issues.push(`campaign-difficulty option order mismatch: ${actualTexts.join(', ') || '(none)'} !== ${expectedTexts.join(', ')}`);
    }

    const parentIssue = mainMenuRectIssue('campaign-difficulty parent', dialogDebugState.parent, expectedSource.difficultyParent, dialogDebugState.viewport);
    if (parentIssue) issues.push(parentIssue);
    const panelIssue = mainMenuRectIssue('campaign-difficulty panel', dialogDebugState.panel, expectedSource.difficultyPanel, dialogDebugState.viewport);
    if (panelIssue) issues.push(panelIssue);
    const titleIssue = mainMenuRectIssue('campaign-difficulty title', dialogDebugState.title, expectedSource.difficultyTitle, dialogDebugState.viewport);
    if (titleIssue) issues.push(titleIssue);
    const confirmIssue = mainMenuRectIssue('campaign-difficulty confirm button', dialogDebugState.confirmButton, expectedSource.difficultyConfirmButton, dialogDebugState.viewport);
    if (confirmIssue) issues.push(confirmIssue);
    const cancelIssue = mainMenuRectIssue('campaign-difficulty cancel button', dialogDebugState.cancelButton, expectedSource.difficultyCancelButton, dialogDebugState.viewport);
    if (cancelIssue) issues.push(cancelIssue);

    for (let index = 0; index < Math.min(dialogDebugState.options.length, expectedOptions.length); index++) {
      const actualOption = dialogDebugState.options[index]!;
      const expectedOption = expectedOptions[index]!;
      const optionIssue = mainMenuRectIssue(
        `campaign-difficulty option "${actualOption.text}"`,
        actualOption.rect,
        expectedOption.rect,
        dialogDebugState.viewport,
      );
      if (optionIssue) issues.push(optionIssue);
    }

    return issues;
  }

  if (scenarioId === 'challenge-menu') {
    const challengeDebugState = debugState as ChallengeMenuLayoutDebugState;
    const expectedButtons = expectedSource.challengeGeneralButtons ?? [];

    const backgroundIssue = mainMenuRectIssue('challenge-menu background', challengeDebugState.background, expectedSource.challengeBackground, challengeDebugState.viewport);
    if (backgroundIssue) issues.push(backgroundIssue);
    const frameIssue = mainMenuRectIssue('challenge-menu frame', challengeDebugState.frame, expectedSource.challengeFrame, challengeDebugState.viewport);
    if (frameIssue) issues.push(frameIssue);
    const backdropIssue = mainMenuRectIssue('challenge-menu main backdrop', challengeDebugState.mainBackdrop, expectedSource.challengeMainBackdrop, challengeDebugState.viewport);
    if (backdropIssue) issues.push(backdropIssue);
    const playIssue = mainMenuRectIssue('challenge-menu play button', challengeDebugState.playButton, expectedSource.challengePlayButton, challengeDebugState.viewport);
    if (playIssue) issues.push(playIssue);
    const backIssue = mainMenuRectIssue('challenge-menu back button', challengeDebugState.backButton, expectedSource.challengeBackButton, challengeDebugState.viewport);
    if (backIssue) issues.push(backIssue);
    const bioPanelIssue = mainMenuRectIssue('challenge-menu bio panel', challengeDebugState.bioPanel, expectedSource.challengeBioPanel, challengeDebugState.viewport);
    if (bioPanelIssue) issues.push(bioPanelIssue);
    const bioPortraitIssue = mainMenuRectIssue('challenge-menu bio portrait', challengeDebugState.bioPortrait, expectedSource.challengeBioPortrait, challengeDebugState.viewport);
    if (bioPortraitIssue) issues.push(bioPortraitIssue);

    for (const actualButton of challengeDebugState.generalButtons) {
      const expectedButton = expectedButtons.find((button) => button.index === actualButton.index);
      const buttonIssue = mainMenuRectIssue(
        `challenge-menu general button ${actualButton.index}`,
        actualButton.rect,
        expectedButton?.rect,
        challengeDebugState.viewport,
      );
      if (buttonIssue) issues.push(buttonIssue);
    }

    return issues;
  }

  if (scenarioId === 'campaign-load') {
    const loadDebugState = debugState as CampaignLoadLayoutDebugState;
    const backgroundIssue = mainMenuRectIssue('campaign-load background', loadDebugState.background, expectedSource.campaignLoadBackground, loadDebugState.viewport);
    if (backgroundIssue) issues.push(backgroundIssue);
    const cameoFrameIssue = mainMenuRectIssue('campaign-load cameo frame', loadDebugState.cameoFrame, expectedSource.campaignLoadCameoFrame, loadDebugState.viewport);
    if (cameoFrameIssue) issues.push(cameoFrameIssue);
    const headIssue = mainMenuRectIssue('campaign-load head', loadDebugState.head, expectedSource.campaignLoadHead, loadDebugState.viewport);
    if (headIssue) issues.push(headIssue);
    const locationIssue = mainMenuRectIssue('campaign-load location', loadDebugState.location, expectedSource.campaignLoadLocation, loadDebugState.viewport);
    if (locationIssue) issues.push(locationIssue);
    const objectivesIssue = mainMenuRectIssue('campaign-load objectives', loadDebugState.objectives, expectedSource.campaignLoadObjectives, loadDebugState.viewport);
    if (objectivesIssue) issues.push(objectivesIssue);
    const progressIssue = mainMenuRectIssue('campaign-load progress', loadDebugState.progress, expectedSource.campaignLoadProgress, loadDebugState.viewport);
    if (progressIssue) issues.push(progressIssue);
    const percentIssue = mainMenuRectIssue('campaign-load percent', loadDebugState.percent, expectedSource.campaignLoadPercent, loadDebugState.viewport);
    if (percentIssue) issues.push(percentIssue);

    const expectedLines = expectedSource.campaignLoadObjectiveLines ?? [];
    for (const actualLine of loadDebugState.objectiveLines) {
      const expectedLine = expectedLines.find((line) => line.index === actualLine.index);
      const lineIssue = mainMenuRectIssue(
        `campaign-load objective line ${actualLine.index}`,
        actualLine.rect,
        expectedLine?.rect,
        loadDebugState.viewport,
      );
      if (lineIssue) issues.push(lineIssue);
    }

    const expectedUnitTexts = expectedSource.campaignLoadUnitTexts ?? [];
    for (const actualUnitText of loadDebugState.unitTexts) {
      const expectedUnitText = expectedUnitTexts.find((entry) => entry.key === actualUnitText.key);
      const unitIssue = mainMenuRectIssue(
        `campaign-load unit text ${actualUnitText.key}`,
        actualUnitText.rect,
        expectedUnitText?.rect,
        loadDebugState.viewport,
      );
      if (unitIssue) issues.push(unitIssue);
    }

    return issues;
  }

  const hudDebugState = debugState as HudLayoutDebugState;
  if (hudDebugState.buttonCount !== HUD_COMMAND_BUTTON_SEQUENCE.length) {
    issues.push(`command-card button count ${hudDebugState.buttonCount} !== retail ${HUD_COMMAND_BUTTON_SEQUENCE.length}`);
  }

  const expectedCommandCard = expectedSource.commandCard ? scaleSourceRect(expectedSource.commandCard, hudDebugState.viewport) : null;
  if (!hudDebugState.commandCard || !expectedCommandCard) {
    issues.push('command-card bounds missing');
  } else if (rectDistance(hudDebugState.commandCard, expectedCommandCard) > UI_LAYOUT_TOLERANCE_PX) {
    issues.push(
      `command-card bounds diverge from retail (${Math.round(hudDebugState.commandCard.x)},${Math.round(hudDebugState.commandCard.y)},${Math.round(hudDebugState.commandCard.width)}x${Math.round(hudDebugState.commandCard.height)} vs ${Math.round(expectedCommandCard.x)},${Math.round(expectedCommandCard.y)},${Math.round(expectedCommandCard.width)}x${Math.round(expectedCommandCard.height)})`,
    );
  }

  const expectedMinimap = expectedSource.minimap ? scaleSourceRect(expectedSource.minimap, hudDebugState.viewport) : null;
  if (!hudDebugState.minimap || !expectedMinimap) {
    issues.push('minimap bounds missing');
  } else if (rectDistance(hudDebugState.minimap, expectedMinimap) > UI_LAYOUT_TOLERANCE_PX) {
    issues.push(
      `minimap bounds diverge from retail (${Math.round(hudDebugState.minimap.x)},${Math.round(hudDebugState.minimap.y)},${Math.round(hudDebugState.minimap.width)}x${Math.round(hudDebugState.minimap.height)} vs ${Math.round(expectedMinimap.x)},${Math.round(expectedMinimap.y)},${Math.round(expectedMinimap.width)}x${Math.round(expectedMinimap.height)})`,
    );
  }

  const expectedCredits = expectedSource.creditsHud ? scaleSourceRect(expectedSource.creditsHud, hudDebugState.viewport) : null;
  if (!hudDebugState.creditsHud || !expectedCredits) {
    issues.push('credits HUD bounds missing');
  } else if (rectDistance(hudDebugState.creditsHud, expectedCredits) > UI_LAYOUT_TOLERANCE_PX) {
    issues.push(
      `credits HUD bounds diverge from retail (${Math.round(hudDebugState.creditsHud.x)},${Math.round(hudDebugState.creditsHud.y)},${Math.round(hudDebugState.creditsHud.width)}x${Math.round(hudDebugState.creditsHud.height)} vs ${Math.round(expectedCredits.x)},${Math.round(expectedCredits.y)},${Math.round(expectedCredits.width)}x${Math.round(expectedCredits.height)})`,
    );
  }

  const expectedPower = expectedSource.powerHud ? scaleSourceRect(expectedSource.powerHud, hudDebugState.viewport) : null;
  if (!hudDebugState.powerHud || !expectedPower) {
    issues.push('power HUD bounds missing');
  } else if (rectDistance(hudDebugState.powerHud, expectedPower) > UI_LAYOUT_TOLERANCE_PX) {
    issues.push(
      `power HUD bounds diverge from retail (${Math.round(hudDebugState.powerHud.x)},${Math.round(hudDebugState.powerHud.y)},${Math.round(hudDebugState.powerHud.width)}x${Math.round(hudDebugState.powerHud.height)} vs ${Math.round(expectedPower.x)},${Math.round(expectedPower.y)},${Math.round(expectedPower.width)}x${Math.round(expectedPower.height)})`,
    );
  }

  return issues;
}

export function buildUiLayoutParityReport(baseUrl: string, scenarios: UiLayoutScenarioResult[]): UiLayoutParityReport {
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

function browserLaunchArgs(): string[] {
  return ['--use-gl=angle', '--use-angle=swiftshader'];
}

async function probeMainMenu(baseUrl: string, screenshotPath: string): Promise<UiLayoutScenarioResult> {
  const browser = await chromium.launch({ headless: true, args: browserLaunchArgs() });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const consoleWarnings: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
    if (message.type() === 'warning') consoleWarnings.push(message.text());
  });

  try {
    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => Boolean(document.getElementById('main-menu-screen')),
      undefined,
      { timeout: SCENARIO_BOOT_TIMEOUT_MS },
    );
    await page.waitForTimeout(1000);
    await page.screenshot({ path: screenshotPath });

    const debugState = await page.evaluate<MainMenuLayoutDebugState>(() => {
      const mainMenu = document.getElementById('main-menu-screen');
      const buttons = [...document.querySelectorAll('#main-menu-screen .menu-button')].map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          text: element.textContent?.trim() ?? '',
          rect: {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
          },
        };
      });
      const firstButton = mainMenu?.querySelector<HTMLElement>('.retail-main-menu-button');

      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        logo: (() => {
          const element = document.querySelector('#main-menu-screen [data-ref="main-menu-logo"]');
          const rect = element?.getBoundingClientRect() ?? null;
          return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null;
        })(),
        actionPanel: (() => {
          const element = document.querySelector('#main-menu-screen [data-ref="main-menu-action-panel"]');
          const rect = element?.getBoundingClientRect() ?? null;
          return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null;
        })(),
        preview: (() => {
          const element = document.querySelector('#main-menu-screen [data-ref="main-menu-preview"]');
          const rect = element?.getBoundingClientRect() ?? null;
          return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null;
        })(),
        rulerLoaded: (() => {
          const element = mainMenu?.querySelector<HTMLElement>('[data-ref="retail-menu-ruler"]');
          return Boolean(element) && window.getComputedStyle(element).backgroundImage !== 'none';
        })(),
        logoArtLoaded: (() => {
          const element = mainMenu?.querySelector<HTMLElement>('[data-ref="retail-menu-logo-art"]');
          return Boolean(element) && window.getComputedStyle(element).backgroundImage !== 'none';
        })(),
        actionMapLoaded: (() => {
          const element = mainMenu?.querySelector<HTMLElement>('[data-ref="retail-menu-action-panel-map"]');
          return Boolean(element) && window.getComputedStyle(element).backgroundImage !== 'none';
        })(),
        pulseLoaded: (() => {
          const element = mainMenu?.querySelector<HTMLElement>('[data-ref="retail-menu-pulse"]');
          return Boolean(element) && window.getComputedStyle(element).backgroundImage !== 'none';
        })(),
        buttonSkinsLoaded: Boolean(
          firstButton
          && window.getComputedStyle(firstButton).getPropertyValue('--retail-button-left-enabled-image').trim() !== '',
        ),
        buttons,
      };
    });

    return {
      id: 'main-menu',
      name: 'Main Menu',
      url: '/',
      status: 'pass',
      screenshotPath,
      pageErrors,
      consoleErrors,
      consoleWarnings,
      debugState,
      blockingIssues: [],
    };
  } finally {
    await browser.close();
  }
}

async function probeSinglePlayer(baseUrl: string, screenshotPath: string): Promise<UiLayoutScenarioResult> {
  const browser = await chromium.launch({ headless: true, args: browserLaunchArgs() });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const consoleWarnings: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
    if (message.type() === 'warning') consoleWarnings.push(message.text());
  });

  try {
    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => Boolean(document.getElementById('main-menu-screen')),
      undefined,
      { timeout: SCENARIO_BOOT_TIMEOUT_MS },
    );
    await page.click('#main-menu-screen [data-action="single-player"]');
    await page.waitForFunction(
      () => {
        const screen = document.getElementById('single-player-screen');
        return Boolean(screen) && !screen?.classList.contains('hidden');
      },
      undefined,
      { timeout: SCENARIO_BOOT_TIMEOUT_MS },
    );
    await page.waitForTimeout(1000);
    await page.screenshot({ path: screenshotPath });

    const debugState = await page.evaluate<MainMenuLayoutDebugState>(() => {
      const screen = document.getElementById('single-player-screen');
      const buttons = [...document.querySelectorAll('#single-player-screen .menu-button')].map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          text: element.textContent?.trim() ?? '',
          rect: {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
          },
        };
      });
      const firstButton = screen?.querySelector<HTMLElement>('.retail-main-menu-button');

      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        logo: (() => {
          const element = document.querySelector('#single-player-screen [data-ref="single-player-logo"]');
          const rect = element?.getBoundingClientRect() ?? null;
          return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null;
        })(),
        actionPanel: (() => {
          const element = document.querySelector('#single-player-screen [data-ref="single-player-action-panel"]');
          const rect = element?.getBoundingClientRect() ?? null;
          return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null;
        })(),
        preview: (() => {
          const element = document.querySelector('#single-player-screen [data-ref="single-player-preview"]');
          const rect = element?.getBoundingClientRect() ?? null;
          return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null;
        })(),
        rulerLoaded: (() => {
          const element = screen?.querySelector<HTMLElement>('[data-ref="retail-menu-ruler"]');
          return Boolean(element) && window.getComputedStyle(element).backgroundImage !== 'none';
        })(),
        logoArtLoaded: (() => {
          const element = screen?.querySelector<HTMLElement>('[data-ref="retail-menu-logo-art"]');
          return Boolean(element) && window.getComputedStyle(element).backgroundImage !== 'none';
        })(),
        actionMapLoaded: (() => {
          const element = screen?.querySelector<HTMLElement>('[data-ref="retail-menu-action-panel-map"]');
          return Boolean(element) && window.getComputedStyle(element).backgroundImage !== 'none';
        })(),
        pulseLoaded: (() => {
          const element = screen?.querySelector<HTMLElement>('[data-ref="retail-menu-pulse"]');
          return Boolean(element) && window.getComputedStyle(element).backgroundImage !== 'none';
        })(),
        buttonSkinsLoaded: Boolean(
          firstButton
          && window.getComputedStyle(firstButton).getPropertyValue('--retail-button-left-enabled-image').trim() !== '',
        ),
        buttons,
      };
    });

    return {
      id: 'single-player',
      name: 'Single Player',
      url: '/',
      status: 'pass',
      screenshotPath,
      pageErrors,
      consoleErrors,
      consoleWarnings,
      debugState,
      blockingIssues: [],
    };
  } finally {
    await browser.close();
  }
}

async function probeCampaignDifficulty(baseUrl: string, screenshotPath: string): Promise<UiLayoutScenarioResult> {
  const browser = await chromium.launch({ headless: true, args: browserLaunchArgs() });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const consoleWarnings: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
    if (message.type() === 'warning') consoleWarnings.push(message.text());
  });

  try {
    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => Boolean(document.getElementById('main-menu-screen')),
      undefined,
      { timeout: SCENARIO_BOOT_TIMEOUT_MS },
    );
    await page.click('#main-menu-screen [data-action="single-player"]');
    await page.waitForFunction(
      () => {
        const screen = document.getElementById('single-player-screen');
        return Boolean(screen) && !screen?.classList.contains('hidden');
      },
      undefined,
      { timeout: SCENARIO_BOOT_TIMEOUT_MS },
    );
    await page.click('#single-player-screen [data-action="campaign-usa"]');
    await page.waitForFunction(
      () => {
        const screen = document.getElementById('campaign-difficulty-screen');
        return Boolean(screen) && !screen?.classList.contains('hidden');
      },
      undefined,
      { timeout: SCENARIO_BOOT_TIMEOUT_MS },
    );
    await page.waitForTimeout(1000);
    await page.screenshot({ path: screenshotPath });

    const debugState = await page.evaluate<DifficultyLayoutDebugState>(() => ({
      viewport: { width: window.innerWidth, height: window.innerHeight },
      parent: (() => {
        const element = document.querySelector('#campaign-difficulty-screen [data-ref="campaign-difficulty-parent"]');
        const rect = element?.getBoundingClientRect() ?? null;
        return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null;
      })(),
      panel: (() => {
        const element = document.querySelector('#campaign-difficulty-screen [data-ref="campaign-difficulty-panel"]');
        const rect = element?.getBoundingClientRect() ?? null;
        return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null;
      })(),
      title: (() => {
        const element = document.querySelector('#campaign-difficulty-screen [data-ref="campaign-difficulty-title"]');
        const rect = element?.getBoundingClientRect() ?? null;
        return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null;
      })(),
      options: [...document.querySelectorAll('#campaign-difficulty-screen .difficulty-option')].map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          text: element.textContent?.trim() ?? '',
          rect: {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
          },
        };
      }),
      confirmButton: (() => {
        const element = document.querySelector('#campaign-difficulty-screen [data-ref="campaign-difficulty-ok"]');
        const rect = element?.getBoundingClientRect() ?? null;
        return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null;
      })(),
      cancelButton: (() => {
        const element = document.querySelector('#campaign-difficulty-screen [data-ref="campaign-difficulty-cancel"]');
        const rect = element?.getBoundingClientRect() ?? null;
        return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null;
      })(),
    }));

    return {
      id: 'campaign-difficulty',
      name: 'Campaign Difficulty',
      url: '/',
      status: 'pass',
      screenshotPath,
      pageErrors,
      consoleErrors,
      consoleWarnings,
      debugState,
      blockingIssues: [],
    };
  } finally {
    await browser.close();
  }
}

async function probeChallengeMenu(baseUrl: string, screenshotPath: string): Promise<UiLayoutScenarioResult> {
  const browser = await chromium.launch({ headless: true, args: browserLaunchArgs() });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const consoleWarnings: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
    if (message.type() === 'warning') consoleWarnings.push(message.text());
  });

  try {
    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => Boolean(document.getElementById('main-menu-screen')),
      undefined,
      { timeout: SCENARIO_BOOT_TIMEOUT_MS },
    );
    await page.click('#main-menu-screen [data-action="single-player"]');
    await page.click('#single-player-screen [data-action="challenge"]');
    await page.waitForFunction(
      () => {
        const screen = document.getElementById('campaign-difficulty-screen');
        return Boolean(screen) && !screen?.classList.contains('hidden');
      },
      undefined,
      { timeout: SCENARIO_BOOT_TIMEOUT_MS },
    );
    await page.click('#campaign-difficulty-screen [data-action="start"]');
    await page.waitForFunction(
      () => {
        const screen = document.getElementById('challenge-select-screen');
        return Boolean(screen) && !screen?.classList.contains('hidden');
      },
      undefined,
      { timeout: SCENARIO_BOOT_TIMEOUT_MS },
    );
    await page.click('#challenge-select-screen [data-challenge]');
    await page.waitForTimeout(500);
    await page.screenshot({ path: screenshotPath });

    const debugState = await page.evaluate<ChallengeMenuLayoutDebugState>(() => ({
      viewport: { width: window.innerWidth, height: window.innerHeight },
      background: (() => {
        const element = document.querySelector('#challenge-select-screen [data-ref="challenge-menu-background"]');
        const rect = element?.getBoundingClientRect() ?? null;
        return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null;
      })(),
      frame: (() => {
        const element = document.querySelector('#challenge-select-screen [data-ref="challenge-menu-frame"]');
        const rect = element?.getBoundingClientRect() ?? null;
        return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null;
      })(),
      mainBackdrop: (() => {
        const element = document.querySelector('#challenge-select-screen [data-ref="challenge-menu-main-backdrop"]');
        const rect = element?.getBoundingClientRect() ?? null;
        return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null;
      })(),
      playButton: (() => {
        const element = document.querySelector('#challenge-select-screen [data-ref="challenge-menu-start"]');
        const rect = element?.getBoundingClientRect() ?? null;
        return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null;
      })(),
      backButton: (() => {
        const element = document.querySelector('#challenge-select-screen [data-ref="challenge-menu-back"]');
        const rect = element?.getBoundingClientRect() ?? null;
        return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null;
      })(),
      bioPanel: (() => {
        const element = document.querySelector('#challenge-select-screen [data-ref="challenge-bio-panel"]');
        const rect = element?.getBoundingClientRect() ?? null;
        return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null;
      })(),
      bioPortrait: (() => {
        const element = document.querySelector('#challenge-select-screen [data-ref="challenge-bio-portrait"]');
        const rect = element?.getBoundingClientRect() ?? null;
        return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null;
      })(),
      generalButtons: [...document.querySelectorAll('#challenge-select-screen [data-challenge]')].map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          index: Number((element as HTMLElement).dataset.challenge),
          rect: {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
          },
        };
      }),
    }));

    return {
      id: 'challenge-menu',
      name: 'Challenge Menu',
      url: '/',
      status: 'pass',
      screenshotPath,
      pageErrors,
      consoleErrors,
      consoleWarnings,
      debugState,
      blockingIssues: [],
    };
  } finally {
    await browser.close();
  }
}

async function probeCampaignLoad(baseUrl: string, screenshotPath: string): Promise<UiLayoutScenarioResult> {
  const browser = await chromium.launch({ headless: true, args: browserLaunchArgs() });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const consoleWarnings: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
    if (message.type() === 'warning') consoleWarnings.push(message.text());
  });

  try {
    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => Boolean(document.getElementById('main-menu-screen')),
      undefined,
      { timeout: SCENARIO_BOOT_TIMEOUT_MS },
    );
    await page.click('#main-menu-screen [data-action="single-player"]');
    await page.click('#single-player-screen [data-action="campaign-usa"]');
    await page.waitForFunction(
      () => {
        const screen = document.getElementById('campaign-difficulty-screen');
        return Boolean(screen) && !screen?.classList.contains('hidden');
      },
      undefined,
      { timeout: SCENARIO_BOOT_TIMEOUT_MS },
    );
    await page.click('#campaign-difficulty-screen [data-action="start"]');
    await page.waitForFunction(
      () => {
        const screen = document.getElementById('campaign-briefing-screen');
        return Boolean(screen) && !screen?.classList.contains('hidden');
      },
      undefined,
      { timeout: SCENARIO_BOOT_TIMEOUT_MS },
    );
    await page.waitForTimeout(500);
    await page.screenshot({ path: screenshotPath });

    const debugState = await page.evaluate<CampaignLoadLayoutDebugState>(() => ({
      viewport: { width: window.innerWidth, height: window.innerHeight },
      background: (() => {
        const element = document.querySelector('#campaign-briefing-screen [data-ref="campaign-load-background"]');
        const rect = element?.getBoundingClientRect() ?? null;
        return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null;
      })(),
      cameoFrame: (() => {
        const element = document.querySelector('#campaign-briefing-screen [data-ref="campaign-load-cameo-frame"]');
        const rect = element?.getBoundingClientRect() ?? null;
        return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null;
      })(),
      head: (() => {
        const element = document.querySelector('#campaign-briefing-screen [data-ref="campaign-load-head"]');
        const rect = element?.getBoundingClientRect() ?? null;
        return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null;
      })(),
      location: (() => {
        const element = document.querySelector('#campaign-briefing-screen [data-ref="campaign-load-location"]');
        const rect = element?.getBoundingClientRect() ?? null;
        return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null;
      })(),
      objectives: (() => {
        const element = document.querySelector('#campaign-briefing-screen [data-ref="campaign-load-objectives"]');
        const rect = element?.getBoundingClientRect() ?? null;
        return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null;
      })(),
      progress: (() => {
        const element = document.querySelector('#campaign-briefing-screen [data-ref="campaign-load-progress"]');
        const rect = element?.getBoundingClientRect() ?? null;
        return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null;
      })(),
      percent: (() => {
        const element = document.querySelector('#campaign-briefing-screen [data-ref="campaign-load-percent"]');
        const rect = element?.getBoundingClientRect() ?? null;
        return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null;
      })(),
      objectiveLines: [...document.querySelectorAll('#campaign-briefing-screen [data-ref^="campaign-load-line-"]')].map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          index: Number((element as HTMLElement).dataset.ref?.replace('campaign-load-line-', '') ?? '-1'),
          rect: {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
          },
        };
      }),
      unitTexts: [...document.querySelectorAll('#campaign-briefing-screen [data-ref$="-text"]')].map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          key: (element as HTMLElement).dataset.ref?.replace('campaign-load-', '').replace('-text', '') ?? '',
          rect: {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
          },
        };
      }),
    }));

    return {
      id: 'campaign-load',
      name: 'Campaign Load Screen',
      url: '/',
      status: 'pass',
      screenshotPath,
      pageErrors,
      consoleErrors,
      consoleWarnings,
      debugState,
      blockingIssues: [],
    };
  } finally {
    await browser.close();
  }
}

async function probeHud(baseUrl: string, screenshotPath: string): Promise<UiLayoutScenarioResult> {
  const browser = await chromium.launch({ headless: true, args: browserLaunchArgs() });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const consoleWarnings: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
    if (message.type() === 'warning') consoleWarnings.push(message.text());
  });

  try {
    await page.goto(
      `${baseUrl}/?map=assets/maps/_extracted/MapsZH/Maps/Tournament%20Desert/Tournament%20Desert.json`,
      { waitUntil: 'domcontentloaded' },
    );
    await page.waitForFunction(
      () => Boolean(document.getElementById('command-card')) && Boolean(document.getElementById('minimap-canvas')),
      undefined,
      { timeout: SCENARIO_BOOT_TIMEOUT_MS },
    );
    await page.waitForTimeout(8_000);
    await page.screenshot({ path: screenshotPath });

    const debugState = await page.evaluate<HudLayoutDebugState>(() => {
      const minimapElement = document.getElementById('minimap-canvas');
      const commandCardElement = document.getElementById('command-card');
      const creditsElement = document.getElementById('credits-hud');
      const powerElement = document.getElementById('power-hud');

      const minimapRect = minimapElement?.getBoundingClientRect() ?? null;
      const commandCardRect = commandCardElement?.getBoundingClientRect() ?? null;
      const creditsRect = creditsElement?.getBoundingClientRect() ?? null;
      const powerRect = powerElement?.getBoundingClientRect() ?? null;

      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        buttonCount: document.querySelectorAll('#command-card button[data-slot]').length,
        minimap: minimapRect ? {
          x: minimapRect.x,
          y: minimapRect.y,
          width: minimapRect.width,
          height: minimapRect.height,
        } : null,
        commandCard: commandCardRect ? {
          x: commandCardRect.x,
          y: commandCardRect.y,
          width: commandCardRect.width,
          height: commandCardRect.height,
        } : null,
        creditsHud: creditsRect ? {
          x: creditsRect.x,
          y: creditsRect.y,
          width: creditsRect.width,
          height: creditsRect.height,
        } : null,
        powerHud: powerRect ? {
          x: powerRect.x,
          y: powerRect.y,
          width: powerRect.width,
          height: powerRect.height,
        } : null,
      };
    });

    return {
      id: 'in-game-hud',
      name: 'In-Game HUD',
      url: '/?map=assets/maps/_extracted/MapsZH/Maps/Tournament%20Desert/Tournament%20Desert.json',
      status: 'pass',
      screenshotPath,
      pageErrors,
      consoleErrors,
      consoleWarnings,
      debugState,
      blockingIssues: [],
    };
  } finally {
    await browser.close();
  }
}

async function main(): Promise<void> {
  const scriptPath = fileURLToPath(import.meta.url);
  const rootDir = path.resolve(path.dirname(scriptPath), '..');
  const distDir = path.join(rootDir, 'packages', 'app', 'dist');
  const reportPath = path.join(rootDir, 'ui-layout-parity-report.json');
  const screenshotDir = path.join(rootDir, 'test-results', 'ui-layout');
  await fs.mkdir(screenshotDir, { recursive: true });

  const mainMenuWnd = parseWnd(await fs.readFile(
    path.join(distDir, 'assets', '_extracted', 'WindowZH', 'Window', 'Menus', 'MainMenu.wnd'),
    'utf8',
  ));
  const controlBarWnd = parseWnd(await fs.readFile(
    path.join(distDir, 'assets', '_extracted', 'WindowZH', 'Window', 'ControlBar.wnd'),
    'utf8',
  ));
  const difficultyWnd = parseWnd(await fs.readFile(
    path.join(distDir, 'assets', '_extracted', 'WindowZH', 'Window', 'Menus', 'DifficultySelect.wnd'),
    'utf8',
  ));
  const challengeWnd = parseWnd(await fs.readFile(
    path.join(distDir, 'assets', '_extracted', 'WindowZH', 'Window', 'Menus', 'ChallengeMenu.wnd'),
    'utf8',
  ));
  const campaignLoadWnd = parseWnd(await fs.readFile(
    path.join(distDir, 'assets', '_extracted', 'WindowZH', 'Window', 'Menus', 'SinglePlayerLoadScreen.wnd'),
    'utf8',
  ));
  const sourceMainMenuLayout = buildSourceShellMenuLayout(
    mainMenuWnd.windows,
    MAIN_MENU_BUTTON_SEQUENCE,
    MAIN_MENU_TEXT_BY_TOKEN,
    'MapBorder2',
  );
  const sourceSinglePlayerLayout = buildSourceShellMenuLayout(
    mainMenuWnd.windows,
    SINGLE_PLAYER_BUTTON_SEQUENCE,
    SINGLE_PLAYER_TEXT_BY_TOKEN,
    'MapBorder',
  );
  const sourceDifficultyLayout = buildSourceDifficultyLayout(difficultyWnd.windows);
  const sourceChallengeLayout = buildSourceChallengeLayout(challengeWnd.windows);
  const sourceCampaignLoadLayout = buildSourceCampaignLoadLayout(campaignLoadWnd.windows);
  const sourceHudRects = buildSourceHudRects(controlBarWnd.windows);

  const server = await createStaticServer(distDir);
  try {
    const mainMenuScenario = await probeMainMenu(
      server.baseUrl,
      path.join(screenshotDir, 'main-menu.png'),
    );
    mainMenuScenario.blockingIssues = collectUiLayoutBlockingIssues('main-menu', mainMenuScenario.debugState, {
      mainMenuButtons: sourceMainMenuLayout.buttons,
      mainMenuLogo: sourceMainMenuLayout.logo,
      mainMenuActionPanel: sourceMainMenuLayout.actionPanel,
      mainMenuPreview: sourceMainMenuLayout.preview,
    });
    mainMenuScenario.status = mainMenuScenario.blockingIssues.length > 0 ? 'blocked' : 'pass';

    const singlePlayerScenario = await probeSinglePlayer(
      server.baseUrl,
      path.join(screenshotDir, 'single-player.png'),
    );
    singlePlayerScenario.blockingIssues = collectUiLayoutBlockingIssues('single-player', singlePlayerScenario.debugState, {
      mainMenuButtons: sourceSinglePlayerLayout.buttons,
      mainMenuLogo: sourceSinglePlayerLayout.logo,
      mainMenuActionPanel: sourceSinglePlayerLayout.actionPanel,
      mainMenuPreview: sourceSinglePlayerLayout.preview,
    });
    singlePlayerScenario.status = singlePlayerScenario.blockingIssues.length > 0 ? 'blocked' : 'pass';

    const campaignDifficultyScenario = await probeCampaignDifficulty(
      server.baseUrl,
      path.join(screenshotDir, 'campaign-difficulty.png'),
    );
    campaignDifficultyScenario.blockingIssues = collectUiLayoutBlockingIssues('campaign-difficulty', campaignDifficultyScenario.debugState, {
      difficultyParent: sourceDifficultyLayout.parent,
      difficultyPanel: sourceDifficultyLayout.panel,
      difficultyTitle: sourceDifficultyLayout.title,
      difficultyOptions: sourceDifficultyLayout.options,
      difficultyConfirmButton: sourceDifficultyLayout.confirmButton,
      difficultyCancelButton: sourceDifficultyLayout.cancelButton,
    });
    campaignDifficultyScenario.status = campaignDifficultyScenario.blockingIssues.length > 0 ? 'blocked' : 'pass';

    const challengeMenuScenario = await probeChallengeMenu(
      server.baseUrl,
      path.join(screenshotDir, 'challenge-menu.png'),
    );
    challengeMenuScenario.blockingIssues = collectUiLayoutBlockingIssues('challenge-menu', challengeMenuScenario.debugState, {
      challengeBackground: sourceChallengeLayout.background,
      challengeFrame: sourceChallengeLayout.frame,
      challengeMainBackdrop: sourceChallengeLayout.mainBackdrop,
      challengePlayButton: sourceChallengeLayout.playButton,
      challengeBackButton: sourceChallengeLayout.backButton,
      challengeBioPanel: sourceChallengeLayout.bioPanel,
      challengeBioPortrait: sourceChallengeLayout.bioPortrait,
      challengeGeneralButtons: sourceChallengeLayout.generalButtons,
    });
    challengeMenuScenario.status = challengeMenuScenario.blockingIssues.length > 0 ? 'blocked' : 'pass';

    const campaignLoadScenario = await probeCampaignLoad(
      server.baseUrl,
      path.join(screenshotDir, 'campaign-load.png'),
    );
    campaignLoadScenario.blockingIssues = collectUiLayoutBlockingIssues('campaign-load', campaignLoadScenario.debugState, {
      campaignLoadBackground: sourceCampaignLoadLayout.background,
      campaignLoadCameoFrame: sourceCampaignLoadLayout.cameoFrame,
      campaignLoadHead: sourceCampaignLoadLayout.head,
      campaignLoadLocation: sourceCampaignLoadLayout.location,
      campaignLoadObjectives: sourceCampaignLoadLayout.objectives,
      campaignLoadProgress: sourceCampaignLoadLayout.progress,
      campaignLoadPercent: sourceCampaignLoadLayout.percent,
      campaignLoadObjectiveLines: sourceCampaignLoadLayout.objectiveLines,
      campaignLoadUnitTexts: sourceCampaignLoadLayout.unitTexts,
    });
    campaignLoadScenario.status = campaignLoadScenario.blockingIssues.length > 0 ? 'blocked' : 'pass';

    const hudScenario = await probeHud(
      server.baseUrl,
      path.join(screenshotDir, 'in-game-hud.png'),
    );
    hudScenario.blockingIssues = collectUiLayoutBlockingIssues('in-game-hud', hudScenario.debugState, sourceHudRects);
    hudScenario.status = hudScenario.blockingIssues.length > 0 ? 'blocked' : 'pass';

    const report = buildUiLayoutParityReport(server.baseUrl, [
      mainMenuScenario,
      singlePlayerScenario,
      campaignDifficultyScenario,
      challengeMenuScenario,
      campaignLoadScenario,
      hudScenario,
    ]);
    await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await server.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
