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
      actionPanel: scaleSourceRect({ x: 532, y: 108, width: 224, height: 252 }, viewport),
      preview: scaleSourceRect({ x: 88, y: 108, width: 388, height: 388 }, viewport),
      rulerLoaded: true,
      logoArtLoaded: true,
      actionMapLoaded: true,
      pulseLoaded: true,
      buttonSkinsLoaded: true,
      buttons: expectedButtons.map((button) => ({
        text: button.text,
        rect: scaleSourceRect(button.rect, viewport),
      })),
    }, {
      mainMenuButtons: expectedButtons,
      mainMenuLogo: { x: 504, y: 16, width: 287, height: 94 },
      mainMenuActionPanel: { x: 532, y: 108, width: 224, height: 252 },
      mainMenuPreview: { x: 88, y: 108, width: 388, height: 388 },
    });

    expect(issues).toEqual([]);
  });

  it('passes when multiplayer and load-replay dropdowns match retail bounds', () => {
    const viewport = { width: 1280, height: 720 };

    const multiplayerIssues = collectUiLayoutBlockingIssues('multiplayer-menu', {
      viewport,
      logo: scaleSourceRect({ x: 504, y: 16, width: 287, height: 94 }, viewport),
      actionPanel: scaleSourceRect({ x: 532, y: 108, width: 224, height: 132 }, viewport),
      preview: scaleSourceRect({ x: 88, y: 108, width: 388, height: 388 }, viewport),
      rulerLoaded: true,
      logoArtLoaded: true,
      actionMapLoaded: true,
      pulseLoaded: true,
      buttonSkinsLoaded: true,
      buttons: [
        { text: 'Online', rect: scaleSourceRect({ x: 540, y: 116, width: 208, height: 35 }, viewport) },
        { text: 'Network', rect: scaleSourceRect({ x: 540, y: 156, width: 208, height: 35 }, viewport) },
        { text: 'Back', rect: scaleSourceRect({ x: 540, y: 196, width: 208, height: 36 }, viewport) },
      ],
    }, {
      mainMenuButtons: [
        { text: 'Online', rect: { x: 540, y: 116, width: 208, height: 35 } },
        { text: 'Network', rect: { x: 540, y: 156, width: 208, height: 35 } },
        { text: 'Back', rect: { x: 540, y: 196, width: 208, height: 36 } },
      ],
      mainMenuLogo: { x: 504, y: 16, width: 287, height: 94 },
      mainMenuActionPanel: { x: 532, y: 108, width: 224, height: 132 },
      mainMenuPreview: { x: 88, y: 108, width: 388, height: 388 },
    });
    expect(multiplayerIssues).toEqual([]);

    const loadReplayIssues = collectUiLayoutBlockingIssues('load-replay-menu', {
      viewport,
      logo: scaleSourceRect({ x: 504, y: 16, width: 287, height: 94 }, viewport),
      actionPanel: scaleSourceRect({ x: 532, y: 108, width: 224, height: 132 }, viewport),
      preview: scaleSourceRect({ x: 88, y: 108, width: 388, height: 388 }, viewport),
      rulerLoaded: true,
      logoArtLoaded: true,
      actionMapLoaded: true,
      pulseLoaded: true,
      buttonSkinsLoaded: true,
      buttons: [
        { text: 'Load Game', rect: scaleSourceRect({ x: 540, y: 116, width: 208, height: 35 }, viewport) },
        { text: 'Load Replay', rect: scaleSourceRect({ x: 540, y: 156, width: 208, height: 35 }, viewport) },
        { text: 'Back', rect: scaleSourceRect({ x: 540, y: 196, width: 208, height: 36 }, viewport) },
      ],
    }, {
      mainMenuButtons: [
        { text: 'Load Game', rect: { x: 540, y: 116, width: 208, height: 35 } },
        { text: 'Load Replay', rect: { x: 540, y: 156, width: 208, height: 35 } },
        { text: 'Back', rect: { x: 540, y: 196, width: 208, height: 36 } },
      ],
      mainMenuLogo: { x: 504, y: 16, width: 287, height: 94 },
      mainMenuActionPanel: { x: 532, y: 108, width: 224, height: 132 },
      mainMenuPreview: { x: 88, y: 108, width: 388, height: 388 },
    });
    expect(loadReplayIssues).toEqual([]);
  });

  it('passes when the replay browser matches retail bounds', () => {
    const viewport = { width: 1280, height: 720 };
    const issues = collectUiLayoutBlockingIssues('replay-browser', {
      viewport,
      parent: scaleSourceRect({ x: 42, y: 42, width: 716, height: 516 }, viewport),
      panel: scaleSourceRect({ x: 52, y: 86, width: 696, height: 358 }, viewport),
      title: scaleSourceRect({ x: 57, y: 88, width: 479, height: 44 }, viewport),
      divider: scaleSourceRect({ x: 52, y: 134, width: 696, height: 1 }, viewport),
      listbox: scaleSourceRect({ x: 68, y: 152, width: 484, height: 276 }, viewport),
      loadButton: scaleSourceRect({ x: 563, y: 153, width: 172, height: 36 }, viewport),
      deleteButton: scaleSourceRect({ x: 563, y: 201, width: 172, height: 36 }, viewport),
      copyButton: scaleSourceRect({ x: 563, y: 249, width: 172, height: 36 }, viewport),
      backButton: scaleSourceRect({ x: 563, y: 393, width: 172, height: 36 }, viewport),
    }, {
      replayBrowserParent: { x: 42, y: 42, width: 716, height: 516 },
      replayBrowserPanel: { x: 52, y: 86, width: 696, height: 358 },
      replayBrowserTitle: { x: 57, y: 88, width: 479, height: 44 },
      replayBrowserDivider: { x: 52, y: 134, width: 696, height: 1 },
      replayBrowserListbox: { x: 68, y: 152, width: 484, height: 276 },
      replayBrowserLoadButton: { x: 563, y: 153, width: 172, height: 36 },
      replayBrowserDeleteButton: { x: 563, y: 201, width: 172, height: 36 },
      replayBrowserCopyButton: { x: 563, y: 249, width: 172, height: 36 },
      replayBrowserBackButton: { x: 563, y: 393, width: 172, height: 36 },
    });

    expect(issues).toEqual([]);
  });

  it('passes when the load-game browser matches retail bounds', () => {
    const viewport = { width: 1280, height: 720 };
    const issues = collectUiLayoutBlockingIssues('load-game', {
      viewport,
      panel: scaleSourceRect({ x: 40, y: 40, width: 718, height: 518 }, viewport),
      title: scaleSourceRect({ x: 54, y: 41, width: 352, height: 44 }, viewport),
      listbox: scaleSourceRect({ x: 60, y: 100, width: 672, height: 392 }, viewport),
      saveButton: scaleSourceRect({ x: 60, y: 508, width: 156, height: 32 }, viewport),
      loadButton: scaleSourceRect({ x: 232, y: 508, width: 156, height: 32 }, viewport),
      deleteButton: scaleSourceRect({ x: 404, y: 508, width: 157, height: 32 }, viewport),
      backButton: scaleSourceRect({ x: 576, y: 508, width: 156, height: 32 }, viewport),
    }, {
      loadGamePanel: { x: 40, y: 40, width: 718, height: 518 },
      loadGameTitle: { x: 54, y: 41, width: 352, height: 44 },
      loadGameListbox: { x: 60, y: 100, width: 672, height: 392 },
      loadGameSaveButton: { x: 60, y: 508, width: 156, height: 32 },
      loadGameLoadButton: { x: 232, y: 508, width: 156, height: 32 },
      loadGameDeleteButton: { x: 404, y: 508, width: 157, height: 32 },
      loadGameBackButton: { x: 576, y: 508, width: 156, height: 32 },
    });

    expect(issues).toEqual([]);
  });

  it('flags retail UI layout mismatches for the main menu and HUD', () => {
    const mainMenuIssues = collectUiLayoutBlockingIssues('main-menu', {
      viewport: { width: 1280, height: 720 },
      logo: { x: 500, y: 20, width: 210, height: 70 },
      actionPanel: { x: 500, y: 108, width: 180, height: 180 },
      preview: { x: 120, y: 120, width: 240, height: 280 },
      rulerLoaded: false,
      logoArtLoaded: false,
      actionMapLoaded: false,
      pulseLoaded: false,
      buttonSkinsLoaded: false,
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
      mainMenuActionPanel: { x: 532, y: 108, width: 224, height: 252 },
      mainMenuPreview: { x: 88, y: 108, width: 388, height: 388 },
    });
    expect(mainMenuIssues).toEqual(expect.arrayContaining([
      expect.stringContaining('main menu logo bounds diverge from retail'),
      expect.stringContaining('main menu action panel bounds diverge from retail'),
      expect.stringContaining('main menu preview panel bounds diverge from retail'),
      expect.stringContaining('main menu ruler artwork missing'),
      expect.stringContaining('main menu logo artwork missing'),
      expect.stringContaining('main menu action-panel map artwork missing'),
      expect.stringContaining('main menu pulse artwork missing'),
      expect.stringContaining('main menu button skin artwork missing'),
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

  it('passes when options-menu and skirmish-menu layouts match retail bounds', () => {
    const viewport = { width: 1280, height: 720 };

    const optionsIssues = collectUiLayoutBlockingIssues('options-menu', {
      viewport,
      parent: scaleSourceRect({ x: 120, y: 12, width: 541, height: 585 }, viewport),
      panel: scaleSourceRect({ x: 135, y: 19, width: 515, height: 567 }, viewport),
      video: scaleSourceRect({ x: 151, y: 69, width: 236, height: 202 }, viewport),
      audio: scaleSourceRect({ x: 391, y: 69, width: 244, height: 202 }, viewport),
      scroll: scaleSourceRect({ x: 151, y: 272, width: 484, height: 128 }, viewport),
      defaultsButton: scaleSourceRect({ x: 152, y: 528, width: 156, height: 32 }, viewport),
      acceptButton: scaleSourceRect({ x: 312, y: 528, width: 159, height: 32 }, viewport),
      backButton: scaleSourceRect({ x: 476, y: 528, width: 159, height: 32 }, viewport),
      versionLabel: scaleSourceRect({ x: 152, y: 560, width: 480, height: 18 }, viewport),
    }, {
      optionsParent: { x: 120, y: 12, width: 541, height: 585 },
      optionsPanel: { x: 135, y: 19, width: 515, height: 567 },
      optionsVideo: { x: 151, y: 69, width: 236, height: 202 },
      optionsAudio: { x: 391, y: 69, width: 244, height: 202 },
      optionsScroll: { x: 151, y: 272, width: 484, height: 128 },
      optionsDefaultsButton: { x: 152, y: 528, width: 156, height: 32 },
      optionsAcceptButton: { x: 312, y: 528, width: 159, height: 32 },
      optionsBackButton: { x: 476, y: 528, width: 159, height: 32 },
      optionsVersionLabel: { x: 152, y: 560, width: 480, height: 18 },
    });
    expect(optionsIssues).toEqual([]);

    const skirmishIssues = collectUiLayoutBlockingIssues('skirmish-menu', {
      viewport,
      frame: scaleSourceRect({ x: 42, y: 41, width: 718, height: 518 }, viewport),
      startButton: scaleSourceRect({ x: 94, y: 513, width: 174, height: 36 }, viewport),
      backButton: scaleSourceRect({ x: 530, y: 513, width: 171, height: 36 }, viewport),
      previewLabel: scaleSourceRect({ x: 578, y: 88, width: 164, height: 24 }, viewport),
      preview: scaleSourceRect({ x: 583, y: 115, width: 164, height: 136 }, viewport),
      mapDisplay: scaleSourceRect({ x: 570, y: 252, width: 184, height: 28 }, viewport),
      selectMapButton: scaleSourceRect({ x: 581, y: 281, width: 166, height: 24 }, viewport),
      startingCash: scaleSourceRect({ x: 453, y: 334, width: 104, height: 24 }, viewport),
      limitSuperweapons: scaleSourceRect({ x: 593, y: 336, width: 152, height: 24 }, viewport),
      playersLabel: scaleSourceRect({ x: 59, y: 88, width: 120, height: 24 }, viewport),
      colorLabel: scaleSourceRect({ x: 198, y: 88, width: 80, height: 24 }, viewport),
      factionLabel: scaleSourceRect({ x: 286, y: 87, width: 108, height: 24 }, viewport),
      teamLabel: scaleSourceRect({ x: 493, y: 88, width: 73, height: 24 }, viewport),
      playerName: scaleSourceRect({ x: 49, y: 112, width: 144, height: 24 }, viewport),
      aiSlot: scaleSourceRect({ x: 49, y: 136, width: 144, height: 24 }, viewport),
      playerColor: scaleSourceRect({ x: 196, y: 112, width: 84, height: 24 }, viewport),
      aiColor: scaleSourceRect({ x: 196, y: 136, width: 84, height: 24 }, viewport),
      playerFaction: scaleSourceRect({ x: 283, y: 112, width: 208, height: 24 }, viewport),
      aiFaction: scaleSourceRect({ x: 283, y: 136, width: 208, height: 24 }, viewport),
      playerTeam: scaleSourceRect({ x: 493, y: 112, width: 76, height: 24 }, viewport),
      aiTeam: scaleSourceRect({ x: 493, y: 136, width: 76, height: 24 }, viewport),
    }, {
      skirmishFrame: { x: 42, y: 41, width: 718, height: 518 },
      skirmishStartButton: { x: 94, y: 513, width: 174, height: 36 },
      skirmishBackButton: { x: 530, y: 513, width: 171, height: 36 },
      skirmishPreviewLabel: { x: 578, y: 88, width: 164, height: 24 },
      skirmishPreview: { x: 583, y: 115, width: 164, height: 136 },
      skirmishMapDisplay: { x: 570, y: 252, width: 184, height: 28 },
      skirmishSelectMapButton: { x: 581, y: 281, width: 166, height: 24 },
      skirmishStartingCash: { x: 453, y: 334, width: 104, height: 24 },
      skirmishLimitSuperweapons: { x: 593, y: 336, width: 152, height: 24 },
      skirmishPlayersLabel: { x: 59, y: 88, width: 120, height: 24 },
      skirmishColorLabel: { x: 198, y: 88, width: 80, height: 24 },
      skirmishFactionLabel: { x: 286, y: 87, width: 108, height: 24 },
      skirmishTeamLabel: { x: 493, y: 88, width: 73, height: 24 },
      skirmishPlayerName: { x: 49, y: 112, width: 144, height: 24 },
      skirmishAiSlot: { x: 49, y: 136, width: 144, height: 24 },
      skirmishPlayerColor: { x: 196, y: 112, width: 84, height: 24 },
      skirmishAiColor: { x: 196, y: 136, width: 84, height: 24 },
      skirmishPlayerFaction: { x: 283, y: 112, width: 208, height: 24 },
      skirmishAiFaction: { x: 283, y: 136, width: 208, height: 24 },
      skirmishPlayerTeam: { x: 493, y: 112, width: 76, height: 24 },
      skirmishAiTeam: { x: 493, y: 136, width: 76, height: 24 },
    });
    expect(skirmishIssues).toEqual([]);
  });

  it('passes when challenge-menu layout matches retail bounds', () => {
    const viewport = { width: 1280, height: 720 };
    const issues = collectUiLayoutBlockingIssues('challenge-menu', {
      viewport,
      background: scaleSourceRect({ x: 0, y: 0, width: 799, height: 599 }, viewport),
      frame: scaleSourceRect({ x: 41, y: 40, width: 719, height: 521 }, viewport),
      mainBackdrop: scaleSourceRect({ x: 42, y: 78, width: 717, height: 481 }, viewport),
      playButton: scaleSourceRect({ x: 382, y: 505, width: 172, height: 36 }, viewport),
      backButton: scaleSourceRect({ x: 576, y: 505, width: 172, height: 36 }, viewport),
      bioPanel: scaleSourceRect({ x: 199, y: 379, width: 548, height: 114 }, viewport),
      bioPortrait: scaleSourceRect({ x: 641, y: 386, width: 97, height: 100 }, viewport),
      generalButtons: [
        { index: 0, rect: scaleSourceRect({ x: 152, y: 198, width: 41, height: 41 }, viewport) },
        { index: 8, rect: scaleSourceRect({ x: 535, y: 189, width: 41, height: 41 }, viewport) },
      ],
    }, {
      challengeBackground: { x: 0, y: 0, width: 799, height: 599 },
      challengeFrame: { x: 41, y: 40, width: 719, height: 521 },
      challengeMainBackdrop: { x: 42, y: 78, width: 717, height: 481 },
      challengePlayButton: { x: 382, y: 505, width: 172, height: 36 },
      challengeBackButton: { x: 576, y: 505, width: 172, height: 36 },
      challengeBioPanel: { x: 199, y: 379, width: 548, height: 114 },
      challengeBioPortrait: { x: 641, y: 386, width: 97, height: 100 },
      challengeGeneralButtons: [
        { index: 0, rect: { x: 152, y: 198, width: 41, height: 41 } },
        { index: 8, rect: { x: 535, y: 189, width: 41, height: 41 } },
      ],
    });

    expect(issues).toEqual([]);
  });

  it('passes when campaign-load layout matches retail bounds', () => {
    const viewport = { width: 1280, height: 720 };
    const issues = collectUiLayoutBlockingIssues('campaign-load', {
      viewport,
      background: scaleSourceRect({ x: 0, y: 0, width: 799, height: 599 }, viewport),
      cameoFrame: scaleSourceRect({ x: 396, y: 32, width: 112, height: 172 }, viewport),
      head: scaleSourceRect({ x: 426, y: 209, width: 200, height: 150 }, viewport),
      location: scaleSourceRect({ x: 92, y: 312, width: 167, height: 42 }, viewport),
      objectives: scaleSourceRect({ x: 255, y: 369, width: 513, height: 144 }, viewport),
      progress: scaleSourceRect({ x: 140, y: 564, width: 519, height: 20 }, viewport),
      percent: scaleSourceRect({ x: 760, y: 520, width: 40, height: 32 }, viewport),
      objectiveLines: [
        { index: 0, rect: scaleSourceRect({ x: 255, y: 369, width: 513, height: 25 }, viewport) },
        { index: 4, rect: scaleSourceRect({ x: 255, y: 465, width: 513, height: 28 }, viewport) },
      ],
      unitTexts: [
        { key: 'unit0', rect: scaleSourceRect({ x: 441, y: 146, width: 98, height: 46 }, viewport) },
        { key: 'unit2', rect: scaleSourceRect({ x: 647, y: 146, width: 99, height: 46 }, viewport) },
      ],
    }, {
      campaignLoadBackground: { x: 0, y: 0, width: 799, height: 599 },
      campaignLoadCameoFrame: { x: 396, y: 32, width: 112, height: 172 },
      campaignLoadHead: { x: 426, y: 209, width: 200, height: 150 },
      campaignLoadLocation: { x: 92, y: 312, width: 167, height: 42 },
      campaignLoadObjectives: { x: 255, y: 369, width: 513, height: 144 },
      campaignLoadProgress: { x: 140, y: 564, width: 519, height: 20 },
      campaignLoadPercent: { x: 760, y: 520, width: 40, height: 32 },
      campaignLoadObjectiveLines: [
        { index: 0, rect: { x: 255, y: 369, width: 513, height: 25 } },
        { index: 4, rect: { x: 255, y: 465, width: 513, height: 28 } },
      ],
      campaignLoadUnitTexts: [
        { key: 'unit0', rect: { x: 441, y: 146, width: 98, height: 46 } },
        { key: 'unit2', rect: { x: 647, y: 146, width: 99, height: 46 } },
      ],
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
