// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameShell, type ShellCampaign } from './game-shell.js';
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

    expect(root.querySelectorAll('#challenge-select-screen .challenge-card')).toHaveLength(2);

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

    expect(root.querySelector('#challenge-select-screen .general-name')?.textContent).toBe('General Juhziz');

    (root.querySelector('#challenge-select-screen [data-action="back"]') as HTMLButtonElement).click();
    (root.querySelector('#single-player-screen [data-action="campaign"]') as HTMLButtonElement).click();
    (root.querySelector('#campaign-faction-screen [data-action="next"]') as HTMLButtonElement).click();
    (root.querySelector('#campaign-difficulty-screen [data-action="start"]') as HTMLButtonElement).click();

    const briefingContent = root.querySelector('#campaign-briefing-screen [data-ref="briefing-content"]')?.textContent ?? '';
    expect(briefingContent).toContain('USA');
    expect(briefingContent).toContain('Mazar');
    expect(briefingContent).toContain('- GLA controls a Chemical Weapons Plant');
    expect(briefingContent).toContain('Ranger');
    expect(briefingContent).not.toContain('mission01');
  });
});
