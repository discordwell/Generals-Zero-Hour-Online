import { describe, expect, it } from 'vitest';

import {
  buildUiLayoutParityReport,
  collectUiLayoutBlockingIssues,
  scaleSourceRect,
  type UiRect,
} from './ui-layout-parity-report.js';

describe('ui layout parity report', () => {
  it('passes when main-menu buttons match the retail order and bounds', () => {
    const viewport = { width: 1280, height: 720 };
    const expectedButtons = [
      { text: 'Single Player', rect: { x: 540, y: 116, width: 208, height: 36 } satisfies UiRect },
      { text: 'Multiplayer', rect: { x: 540, y: 156, width: 208, height: 36 } satisfies UiRect },
    ];
    const issues = collectUiLayoutBlockingIssues('main-menu', {
      viewport,
      logo: scaleSourceRect({ x: 504, y: 16, width: 287, height: 94 }, viewport),
      actionPanel: scaleSourceRect({ x: 532, y: 108, width: 224, height: 212 }, viewport),
      preview: scaleSourceRect({ x: 88, y: 108, width: 388, height: 388 }, viewport),
      buttons: expectedButtons.map((button) => ({
        text: button.text,
        rect: scaleSourceRect(button.rect, viewport),
      })),
    }, {
      mainMenuButtons: expectedButtons,
      mainMenuLogo: { x: 504, y: 16, width: 287, height: 94 },
      mainMenuActionPanel: { x: 532, y: 108, width: 224, height: 212 },
      mainMenuPreview: { x: 88, y: 108, width: 388, height: 388 },
    });

    expect(issues).toEqual([]);
  });

  it('flags retail UI layout mismatches for the main menu and HUD', () => {
    const mainMenuIssues = collectUiLayoutBlockingIssues('main-menu', {
      viewport: { width: 1280, height: 720 },
      logo: { x: 500, y: 20, width: 210, height: 70 },
      actionPanel: { x: 500, y: 108, width: 180, height: 180 },
      preview: { x: 120, y: 120, width: 240, height: 280 },
      buttons: [
        { text: 'Single Player', rect: { x: 500, y: 260, width: 280, height: 50 } },
        { text: 'Skirmish', rect: { x: 500, y: 320, width: 280, height: 50 } },
      ],
    }, {
      mainMenuButtons: [
        { text: 'Single Player', rect: { x: 540, y: 116, width: 208, height: 36 } },
        { text: 'Multiplayer', rect: { x: 540, y: 156, width: 208, height: 36 } },
      ],
      mainMenuLogo: { x: 504, y: 16, width: 287, height: 94 },
      mainMenuActionPanel: { x: 532, y: 108, width: 224, height: 212 },
      mainMenuPreview: { x: 88, y: 108, width: 388, height: 388 },
    });
    expect(mainMenuIssues).toEqual(expect.arrayContaining([
      expect.stringContaining('main menu logo bounds diverge from retail'),
      expect.stringContaining('main menu action panel bounds diverge from retail'),
      expect.stringContaining('main menu preview panel bounds diverge from retail'),
      expect.stringContaining('main menu button order mismatch'),
      expect.stringContaining('bounds diverge from retail'),
    ]));

    const hudIssues = collectUiLayoutBlockingIssues('in-game-hud', {
      viewport: { width: 1280, height: 720 },
      buttonCount: 12,
      minimap: { x: 8, y: 512, width: 200, height: 200 },
      commandCard: { x: 539, y: 510, width: 202, height: 202 },
      creditsHud: { x: 623, y: 10, width: 34, height: 10 },
      powerHud: { x: 1150, y: 38, width: 120, height: 16 },
    }, {
      minimap: { x: 7, y: 443, width: 167, height: 152 },
      commandCard: { x: 223, y: 494, width: 380, height: 95 },
      creditsHud: { x: 360, y: 437, width: 79, height: 19 },
      powerHud: { x: 261, y: 473, width: 283, height: 7 },
    });
    expect(hudIssues).toEqual(expect.arrayContaining([
      expect.stringContaining('button count 12'),
      expect.stringContaining('command-card bounds diverge from retail'),
      expect.stringContaining('minimap bounds diverge from retail'),
      expect.stringContaining('credits HUD bounds diverge from retail'),
      expect.stringContaining('power HUD bounds diverge from retail'),
    ]));
  });

  it('passes when campaign-difficulty dialog matches retail bounds', () => {
    const viewport = { width: 1280, height: 720 };
    const issues = collectUiLayoutBlockingIssues('campaign-difficulty', {
      viewport,
      parent: scaleSourceRect({ x: 156, y: 120, width: 436, height: 296 }, viewport),
      panel: scaleSourceRect({ x: 224, y: 180, width: 288, height: 188 }, viewport),
      title: scaleSourceRect({ x: 232, y: 188, width: 268, height: 28 }, viewport),
      options: [
        { text: 'Easy', rect: scaleSourceRect({ x: 288, y: 220, width: 152, height: 32 }, viewport) },
        { text: 'Medium', rect: scaleSourceRect({ x: 288, y: 256, width: 152, height: 32 }, viewport) },
        { text: 'Hard', rect: scaleSourceRect({ x: 288, y: 292, width: 152, height: 32 }, viewport) },
      ],
      confirmButton: scaleSourceRect({ x: 236, y: 328, width: 128, height: 28 }, viewport),
      cancelButton: scaleSourceRect({ x: 372, y: 328, width: 128, height: 28 }, viewport),
    }, {
      difficultyParent: { x: 156, y: 120, width: 436, height: 296 },
      difficultyPanel: { x: 224, y: 180, width: 288, height: 188 },
      difficultyTitle: { x: 232, y: 188, width: 268, height: 28 },
      difficultyOptions: [
        { text: 'Easy', rect: { x: 288, y: 220, width: 152, height: 32 } },
        { text: 'Medium', rect: { x: 288, y: 256, width: 152, height: 32 } },
        { text: 'Hard', rect: { x: 288, y: 292, width: 152, height: 32 } },
      ],
      difficultyConfirmButton: { x: 236, y: 328, width: 128, height: 28 },
      difficultyCancelButton: { x: 372, y: 328, width: 128, height: 28 },
    });

    expect(issues).toEqual([]);
  });

  it('summarizes blocked scenarios in the final report', () => {
    const report = buildUiLayoutParityReport('http://127.0.0.1:4177', [
      {
        id: 'main-menu',
        name: 'Main Menu',
        url: '/',
        status: 'blocked',
        screenshotPath: '/tmp/main-menu.png',
        pageErrors: [],
        consoleErrors: [],
        consoleWarnings: [],
        debugState: null,
        blockingIssues: ['button order mismatch', 'layout mismatch'],
      },
      {
        id: 'in-game-hud',
        name: 'In-Game HUD',
        url: '/?map=test',
        status: 'pass',
        screenshotPath: '/tmp/hud.png',
        pageErrors: [],
        consoleErrors: [],
        consoleWarnings: [],
        debugState: null,
        blockingIssues: [],
      },
    ]);

    expect(report.summary).toEqual({
      scenarioCount: 2,
      blockedScenarios: 1,
      blockerItems: 2,
    });
  });
});
