// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameShell, isSkirmishMapName, type ShellCampaign } from './game-shell.js';
import type { GeneralPersona } from './challenge-generals.js';
import type { StartingCreditsOption } from './shell-runtime-data.js';

describe('GameShell', () => {
  let root: HTMLDivElement;

  beforeEach(() => {
    root = document.createElement('div');
    document.body.appendChild(root);
  });

  afterEach(() => {
    root.remove();
    document.querySelectorAll('style').forEach((styleEl) => styleEl.remove());
  });

  it('renders source-driven starting credit options', () => {
    const shell = new GameShell(root, {
      onStartGame: () => undefined,
    });
    const options: StartingCreditsOption[] = [
      { value: 5000, label: '$5,000', isDefault: false },
      { value: 10000, label: '$10,000 (Default)', isDefault: true },
      { value: 50000, label: '$50,000', isDefault: false },
    ];

    shell.setStartingCreditsOptions(options);
    shell.show();

    const select = root.querySelector('#skirmish-setup-screen [data-ref="credits-select"]') as HTMLSelectElement;
    expect([...select.options].map((option) => option.textContent)).toEqual([
      '$5,000',
      '$10,000 (Default)',
      '$50,000',
    ]);
    expect(select.value).toBe('10000');
  });

  it('renders the retail skirmish layout and passes source-backed slot settings into game start', () => {
    const onStartGame = vi.fn();
    const shell = new GameShell(root, {
      onStartGame,
    });
    shell.setAvailableMaps([
      'maps/_extracted/MapsZH/Maps/Tournament Desert/Tournament Desert.json',
    ]);
    shell.setStartingCreditsOptions([
      { value: 5000, label: '$5,000', isDefault: true },
      { value: 10000, label: '$10,000', isDefault: false },
    ]);

    shell.show();
    (root.querySelector('#main-menu-screen [data-action="single-player"]') as HTMLButtonElement).click();
    (root.querySelector('#single-player-screen [data-action="skirmish"]') as HTMLButtonElement).click();

    const skirmishScreen = root.querySelector('#skirmish-setup-screen') as HTMLElement;
    expect(skirmishScreen.classList.contains('hidden')).toBe(false);
    expect(root.querySelector('#skirmish-setup-screen [data-ref="skirmish-frame"]')?.getAttribute('data-source-rect')).toBe('42,41,718,518');
    expect(root.querySelector('#skirmish-setup-screen [data-ref="skirmish-map-preview"]')?.getAttribute('data-source-rect')).toBe('583,115,164,136');
    expect(root.querySelector('#skirmish-setup-screen [data-ref="skirmish-limit-superweapons"]')?.getAttribute('data-source-rect')).toBe('593,336,152,24');
    expect(root.querySelector('#skirmish-setup-screen [data-action="start"]')?.getAttribute('data-source-rect')).toBe('94,513,174,36');
    expect(root.querySelector('#skirmish-setup-screen [data-action="back"]')?.getAttribute('data-source-rect')).toBe('530,513,171,36');

    const setSelectValue = (ref: string, value: string) => {
      const select = root.querySelector(`#skirmish-setup-screen [data-ref="${ref}"]`) as HTMLSelectElement;
      select.value = value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const setCheckboxValue = (ref: string, checked: boolean) => {
      const input = root.querySelector(`#skirmish-setup-screen [data-ref="${ref}"]`) as HTMLInputElement;
      input.checked = checked;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };

    setSelectValue('map-select', '0');
    setSelectValue('player-side', 'GLA');
    setSelectValue('player-team', '2');
    setSelectValue('ai-enabled', 'hard-ai');
    setSelectValue('ai-side', 'America');
    setSelectValue('ai-team', '2');
    setSelectValue('credits-select', '5000');
    setCheckboxValue('limit-superweapons-input', true);

    (root.querySelector('#skirmish-setup-screen [data-action="start"]') as HTMLButtonElement).click();

    expect(onStartGame).toHaveBeenCalledWith({
      mapPath: 'maps/_extracted/MapsZH/Maps/Tournament Desert/Tournament Desert.json',
      slots: [
        {
          slotIndex: 0,
          playerName: 'Player',
          mode: 'human',
          side: 'GLA',
          team: 2,
          color: 2,
          startPosition: 1,
        },
        {
          slotIndex: 1,
          playerName: 'Computer 1',
          mode: 'hard-ai',
          side: 'America',
          team: 2,
          color: 1,
          startPosition: 2,
        },
      ],
      startingCredits: 5000,
      limitSuperweapons: true,
    });
  });

  it('matches the retail main menu button order and routes skirmish through single player', () => {
    const shell = new GameShell(root, {
      onStartGame: () => undefined,
    });

    shell.show();

    expect(
      [...root.querySelectorAll('#main-menu-screen .menu-button')].map((button) => button.textContent?.trim()),
    ).toEqual([
      'Single Player',
      'Multiplayer',
      'Replay',
      'Options',
      'Exit',
    ]);
    expect(
      (root.querySelector('#main-menu-screen [data-action="single-player"]') as HTMLButtonElement).dataset.sourceRect,
    ).toBe('540,116,208,36');
    expect(root.querySelector('#main-menu-screen [data-ref="main-menu-logo"]')).not.toBeNull();
    expect(root.querySelector('#main-menu-screen [data-ref="main-menu-action-panel"]')).not.toBeNull();

    (root.querySelector('#main-menu-screen [data-action="single-player"]') as HTMLButtonElement).click();

    expect(
      [...root.querySelectorAll('#single-player-screen .menu-button')].map((button) => button.textContent?.trim()),
    ).toEqual([
      'USA',
      'GLA',
      'CHINA',
      'Generals Challenge',
      'Skirmish',
      'Back',
    ]);
    expect(root.querySelector('#single-player-screen [data-ref="single-player-action-panel"]')).not.toBeNull();
  });

  it('matches the retail multiplayer and load-replay dropdown button order and back flow', () => {
    const onOpenLoadGame = vi.fn();
    const onOpenReplayMenu = vi.fn();
    const shell = new GameShell(root, {
      onStartGame: () => undefined,
      onOpenLoadGame,
      onOpenReplayMenu,
    });

    shell.show();

    const multiplayerButton = root.querySelector('#main-menu-screen [data-action="multiplayer"]') as HTMLButtonElement;
    expect(multiplayerButton.disabled).toBe(false);
    multiplayerButton.click();

    expect(
      [...root.querySelectorAll('#multiplayer-menu-screen .menu-button')].map((button) => button.textContent?.trim()),
    ).toEqual([
      'Online',
      'Network',
      'Back',
    ]);
    expect(
      (root.querySelector('#multiplayer-menu-screen [data-action="online"]') as HTMLButtonElement).dataset.sourceRect,
    ).toBe('540,116,208,35');
    expect(root.querySelector('#multiplayer-menu-screen [data-ref="multiplayer-action-panel"]')).not.toBeNull();

    (root.querySelector('#multiplayer-menu-screen [data-action="back"]') as HTMLButtonElement).click();
    expect(root.querySelector('#main-menu-screen')?.classList.contains('hidden')).toBe(false);

    const replayButton = root.querySelector('#main-menu-screen [data-action="replay"]') as HTMLButtonElement;
    expect(replayButton.disabled).toBe(false);
    replayButton.click();

    expect(
      [...root.querySelectorAll('#load-replay-menu-screen .menu-button')].map((button) => button.textContent?.trim()),
    ).toEqual([
      'Load Game',
      'Load Replay',
      'Back',
    ]);
    expect(
      (root.querySelector('#load-replay-menu-screen [data-action="load-game"]') as HTMLButtonElement).dataset.sourceRect,
    ).toBe('540,116,208,35');
    expect(root.querySelector('#load-replay-menu-screen [data-ref="load-replay-action-panel"]')).not.toBeNull();

    (root.querySelector('#load-replay-menu-screen [data-action="load-game"]') as HTMLButtonElement).click();
    expect(onOpenLoadGame).toHaveBeenCalledTimes(1);

    (root.querySelector('#load-replay-menu-screen [data-action="replay-browser"]') as HTMLButtonElement).click();
    expect(onOpenReplayMenu).toHaveBeenCalledTimes(1);

    (root.querySelector('#load-replay-menu-screen [data-action="back"]') as HTMLButtonElement).click();
    expect(root.querySelector('#main-menu-screen')?.classList.contains('hidden')).toBe(false);
  });

  it('filters legacy and demo campaigns when shell campaign data is set', () => {
    const shell = new GameShell(root, {
      onStartGame: () => undefined,
    });

    shell.setCampaigns([
      {
        name: 'training',
        firstMission: 'mission01',
        campaignNameLabel: 'CAMPAIGN:TRAINING',
        finalMovieName: '',
        isChallengeCampaign: false,
        playerFactionName: '',
        missions: [],
      },
      {
        name: 'md_campea_demo',
        firstMission: 'mission01',
        campaignNameLabel: 'CAMPAIGN:MD_CAMPEA_DEMO',
        finalMovieName: '',
        isChallengeCampaign: false,
        playerFactionName: '',
        missions: [],
      },
      {
        name: 'challenge_0',
        firstMission: 'mission01',
        campaignNameLabel: 'CAMPAIGN:CHALLENGE_0',
        finalMovieName: 'USACampaignVictory',
        isChallengeCampaign: true,
        playerFactionName: 'FactionAmericaAirForceGeneral',
        missions: [
          {
            name: 'mission01',
            mapName: 'Maps\\GC_ChemGeneral\\GC_ChemGeneral.map',
            nextMission: '',
            movieLabel: 'GeneralsChallengeBackground',
            objectiveLines: [],
            briefingVoice: '',
            locationNameLabel: '',
            unitNames: [],
            voiceLength: 0,
            generalName: '',
          },
        ],
      },
      {
        name: 'usa',
        firstMission: 'mission01',
        campaignNameLabel: 'CAMPAIGN:USA',
        finalMovieName: '',
        isChallengeCampaign: false,
        playerFactionName: 'FactionAmerica',
        missions: [
          {
            name: 'mission01',
            mapName: 'Maps\\MD_USA01\\MD_USA01.map',
            nextMission: '',
            movieLabel: 'MD_USA01',
            objectiveLines: [],
            briefingVoice: '',
            locationNameLabel: '',
            unitNames: [],
            voiceLength: 0,
            generalName: '',
          },
        ],
      },
    ]);

    expect((shell as { campaigns: ShellCampaign[] }).campaigns.map((campaign) => campaign.name).sort()).toEqual([
      'challenge_0',
      'usa',
    ]);
  });

  it('starts the source-selected challenge campaign from challenge personas', () => {
    const onStartCampaign = vi.fn();
    const shell = new GameShell(root, {
      onStartGame: () => undefined,
      onStartCampaign,
    });
    const personas: GeneralPersona[] = [
      {
        index: 0,
        startsEnabled: true,
        name: 'General Granger',
        faction: 'USA Air Force',
        bioNameLabel: 'GUI:BioNameEntry_Pos0',
        campaignName: 'challenge_0',
        playerTemplateName: 'FactionAmericaAirForceGeneral',
        bioPortraitSmallName: '',
        bioPortraitLargeName: '',
        portraitMovieLeftName: 'PortraitAirGenLeft',
        portraitMovieRightName: 'PortraitAirGenRight',
        defeatedImageName: '',
        victoriousImageName: '',
        defeatedStringLabel: '',
        victoriousStringLabel: '',
        selectionSound: '',
        tauntSounds: [],
        winSound: '',
        lossSound: '',
        previewSound: '',
        nameSound: '',
      },
      {
        index: 8,
        startsEnabled: true,
        name: 'GLA Demolition General',
        faction: 'GLA Demolition General',
        bioNameLabel: 'GUI:BioNameEntry_Pos8',
        campaignName: 'challenge_8',
        playerTemplateName: 'FactionGLADemolitionGeneral',
        bioPortraitSmallName: '',
        bioPortraitLargeName: '',
        portraitMovieLeftName: 'PortraitDemolitionGenLeft',
        portraitMovieRightName: 'PortraitDemolitionGenRight',
        defeatedImageName: '',
        victoriousImageName: '',
        defeatedStringLabel: '',
        victoriousStringLabel: '',
        selectionSound: '',
        tauntSounds: [],
        winSound: '',
        lossSound: '',
        previewSound: '',
        nameSound: '',
      },
    ];
    const campaigns: ShellCampaign[] = [
      {
        name: 'challenge_8',
        firstMission: 'mission01',
        campaignNameLabel: 'CAMPAIGN:CHALLENGE_8',
        finalMovieName: '',
        isChallengeCampaign: true,
        playerFactionName: 'FactionGLADemolitionGeneral',
        missions: [
          {
            name: 'mission01',
            mapName: 'Maps/GC_DemolitionGeneral/GC_DemolitionGeneral.map',
            nextMission: '',
            movieLabel: '',
            objectiveLines: [],
            briefingVoice: '',
            locationNameLabel: '',
            unitNames: [],
            voiceLength: 0,
            generalName: 'GUI:BioNameEntry_Pos3',
          },
        ],
      },
    ];

    shell.setChallengePersonas(personas);
    shell.setCampaigns(campaigns);
    shell.show();

    (root.querySelector('#main-menu-screen [data-action="single-player"]') as HTMLButtonElement).click();
    (root.querySelector('#single-player-screen [data-action="challenge"]') as HTMLButtonElement).click();
    (root.querySelector('#campaign-difficulty-screen [data-action="start"]') as HTMLButtonElement).click();

    expect(root.querySelectorAll('#challenge-select-screen [data-challenge]')).toHaveLength(2);
    expect((root.querySelector('#challenge-select-screen [data-ref="challenge-menu-start"]') as HTMLElement).classList.contains('hidden')).toBe(true);

    (root.querySelector('#challenge-select-screen [data-challenge="8"]') as HTMLButtonElement).click();
    (root.querySelector('#challenge-select-screen [data-action="start"]') as HTMLButtonElement).click();

    expect(onStartCampaign).toHaveBeenCalledWith(
      expect.objectContaining({
        campaignName: 'challenge_8',
        mapPath: 'maps/_extracted/MapsZH/Maps/GC_DemolitionGeneral/GC_DemolitionGeneral.json',
      }),
    );
  });

  it('renders localized challenge names and campaign briefing labels', () => {
    const shell = new GameShell(root, {
      onStartGame: () => undefined,
    });

    shell.setLocalizedStrings(new Map([
      ['GUI:BioNameEntry_Pos8', 'General Juhziz'],
      ['CAMPAIGN:USA', 'USA'],
      ['OBJECT:Mazar', 'Mazar'],
      ['LOAD:TRAINING_1', '- GLA controls a Chemical Weapons Plant'],
      ['OBJECT:Ranger', 'Ranger'],
    ]));
    shell.setChallengePersonas([
      {
        index: 8,
        startsEnabled: true,
        name: 'GLA Demolition General',
        faction: 'GLA Demolition General',
        bioNameLabel: 'GUI:BioNameEntry_Pos8',
        campaignName: 'challenge_8',
        playerTemplateName: 'FactionGLADemolitionGeneral',
        bioPortraitSmallName: '',
        bioPortraitLargeName: '',
        portraitMovieLeftName: '',
        portraitMovieRightName: '',
        defeatedImageName: '',
        victoriousImageName: '',
        defeatedStringLabel: '',
        victoriousStringLabel: '',
        selectionSound: '',
        tauntSounds: [],
        winSound: '',
        lossSound: '',
        previewSound: '',
        nameSound: '',
      },
    ]);
    shell.setCampaigns([
      {
        name: 'usa',
        firstMission: 'mission01',
        campaignNameLabel: 'CAMPAIGN:USA',
        finalMovieName: '',
        isChallengeCampaign: false,
        playerFactionName: 'FactionAmerica',
        missions: [
          {
            name: 'mission01',
            mapName: 'Maps\\Training01\\Training01.map',
            nextMission: '',
            movieLabel: '',
            objectiveLines: ['LOAD:TRAINING_1'],
            briefingVoice: '',
            locationNameLabel: 'OBJECT:Mazar',
            unitNames: ['OBJECT:Ranger'],
            voiceLength: 0,
            generalName: '',
          },
        ],
      },
    ]);
    shell.show();

    (root.querySelector('#main-menu-screen [data-action="single-player"]') as HTMLButtonElement).click();
    (root.querySelector('#single-player-screen [data-action="challenge"]') as HTMLButtonElement).click();
    (root.querySelector('#campaign-difficulty-screen [data-action="start"]') as HTMLButtonElement).click();

    expect(root.querySelector('#challenge-select-screen [data-ref="challenge-bio-name"]')?.textContent).toBe('');
    (root.querySelector('#challenge-select-screen [data-challenge="8"]') as HTMLButtonElement).click();
    expect(root.querySelector('#challenge-select-screen [data-ref="challenge-bio-name"]')?.textContent).toBe('General Juhziz');

    (root.querySelector('#challenge-select-screen [data-action="back"]') as HTMLButtonElement).click();
    (root.querySelector('#single-player-screen [data-action="campaign-usa"]') as HTMLButtonElement).click();
    (root.querySelector('#campaign-difficulty-screen [data-action="start"]') as HTMLButtonElement).click();

    const briefingContent = root.querySelector('#campaign-briefing-screen')?.textContent ?? '';
    expect(briefingContent).toContain('USA');
    expect(briefingContent).toContain('Mazar');
    expect(briefingContent).toContain('- GLA controls a Chemical Weapons Plant');
    expect(briefingContent).toContain('Ranger');
    expect(briefingContent).not.toContain('mission01');
  });

  describe('isSkirmishMapName', () => {
    it('accepts standard skirmish maps', () => {
      expect(isSkirmishMapName('Tournament Desert')).toBe(true);
      expect(isSkirmishMapName('Alpine Assault')).toBe(true);
      expect(isSkirmishMapName('Winter Wolf')).toBe(true);
      expect(isSkirmishMapName('Golden Oasis')).toBe(true);
      expect(isSkirmishMapName('Flash Fire')).toBe(true);
    });

    it('rejects campaign maps (MD_ prefix)', () => {
      expect(isSkirmishMapName('MD USA01')).toBe(false);
      expect(isSkirmishMapName('MD CHI03')).toBe(false);
      expect(isSkirmishMapName('MD GLA05')).toBe(false);
      expect(isSkirmishMapName('MD ShellMap')).toBe(false);
    });

    it('rejects campaign cinematics and intros', () => {
      expect(isSkirmishMapName('MD USA01 CINE')).toBe(false);
      expect(isSkirmishMapName('MD GLA04 INTRO')).toBe(false);
      expect(isSkirmishMapName('MD CHI05 END')).toBe(false);
      expect(isSkirmishMapName('MD USA03 END1')).toBe(false);
      expect(isSkirmishMapName('MD GLA04 Sound')).toBe(false);
    });

    it('rejects Generals Challenge maps (GC_ prefix)', () => {
      expect(isSkirmishMapName('GC AirGeneral')).toBe(false);
      expect(isSkirmishMapName('GC TankGeneral')).toBe(false);
      expect(isSkirmishMapName('GC ChinaBoss')).toBe(false);
    });

    it('rejects shell and test maps', () => {
      expect(isSkirmishMapName('ShellMapMD')).toBe(false);
      expect(isSkirmishMapName('ScenarioSkirmish')).toBe(false);
      expect(isSkirmishMapName('SmokeTest')).toBe(false);
      expect(isSkirmishMapName('AllBuildingsAllSidesUnitTest Save')).toBe(false);
      expect(isSkirmishMapName('BUG SavedGameandEnabledFolders')).toBe(false);
      expect(isSkirmishMapName('Art Review New Units')).toBe(false);
      expect(isSkirmishMapName('Hovercraft')).toBe(false);
    });

    it('rejects USA campaign overflow maps', () => {
      expect(isSkirmishMapName('USA05 EndsConflict')).toBe(false);
      expect(isSkirmishMapName('USA05 EndsConflict INTRO')).toBe(false);
      expect(isSkirmishMapName('USA07-TaskForces')).toBe(false);
    });

    it('rejects empty string', () => {
      expect(isSkirmishMapName('')).toBe(false);
    });
  });

  it('map dropdown shows clean names and filters non-skirmish maps', () => {
    const shell = new GameShell(root, { onStartGame: () => undefined });
    shell.setAvailableMaps([
      'maps/_extracted/MapsZH/Maps/Tournament Desert/Tournament Desert.json',
      'maps/_extracted/MapsZH/Maps/MD_USA01/MD_USA01.json',
      'maps/_extracted/MapsZH/Maps/GC_AirGeneral/GC_AirGeneral.json',
      'maps/_extracted/MapsZH/Maps/ShellMapMD/ShellMapMD.json',
      'maps/_extracted/MapsZH/Maps/Alpine Assault/Alpine Assault.json',
      'maps/_extracted/MapsZH/Maps/MD_USA01_CINE/MD_USA01_CINE.json',
    ]);
    shell.show();

    const select = root.querySelector('[data-ref="map-select"]') as HTMLSelectElement;
    const optionTexts = [...select.options]
      .map(o => o.textContent)
      .filter(t => t !== 'Procedural Demo Terrain');
    expect(optionTexts).toEqual(['Alpine Assault', 'Tournament Desert']);
  });
});
