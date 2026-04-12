import { SaveFileType } from '@generals/engine';
import { describe, expect, it } from 'vitest';
import {
  buildCampaignMissionSavePayload,
  formatCampaignMissionSaveDescription,
} from './campaign-mission-save.js';

const localizedStrings = new Map<string, string>([
  ['GUI:MissionSave', 'Mission Start - %s %d'],
  ['CAMPAIGN:USA', 'USA'],
]);

const campaign = {
  name: 'usa',
  firstMission: 'mission01',
  campaignNameLabel: 'CAMPAIGN:USA',
  finalMovieName: '',
  isChallengeCampaign: false,
  playerFactionName: 'FactionAmerica',
  missions: [],
};

const mission = {
  name: 'mission02',
  mapName: 'Maps\\MD_USA02\\MD_USA02.map',
  nextMission: 'mission03',
  movieLabel: 'MD_USA02',
  objectiveLines: [],
  briefingVoice: '',
  locationNameLabel: '',
  unitNames: [],
  voiceLength: 0,
  generalName: '',
};

describe('campaign mission save payload', () => {
  it('formats source GUI:MissionSave descriptions with one-based mission numbers', () => {
    expect(formatCampaignMissionSaveDescription(campaign, 1, localizedStrings)).toBe(
      'Mission Start - USA 2',
    );
  });

  it('builds source mission-save metadata for the current campaign mission', () => {
    const payload = buildCampaignMissionSavePayload({
      campaign,
      mission,
      missionNumber: 1,
      difficulty: 'HARD',
      rankPoints: 7,
      playerTemplateNum: -1,
      localizedStrings,
    });

    expect(payload).toEqual({
      description: 'Mission Start - USA 2',
      sourceMetadata: {
        saveFileType: SaveFileType.SAVE_FILE_TYPE_MISSION,
        missionMapName: 'Maps\\MD_USA02\\MD_USA02.map',
      },
      campaign: {
        campaignName: 'usa',
        missionName: 'mission02',
        missionNumber: 1,
        difficulty: 'HARD',
        rankPoints: 7,
        isChallengeCampaign: false,
        playerTemplateNum: -1,
        sourceMapName: 'Maps\\MD_USA02\\MD_USA02.map',
        playerDisplayName: undefined,
        challengeGameInfoState: null,
      },
    });
  });
});
