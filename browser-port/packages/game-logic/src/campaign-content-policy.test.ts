import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCampaignIni } from './campaign-manager.js';
import {
  classifyCampaignLifecycle,
  classifyCampaignReference,
  isLiveCampaignLifecycle,
} from './campaign-content-policy.js';

const RETAIL_CAMPAIGN_INI_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  'app',
  'public',
  'assets',
  '_extracted',
  'INIZH',
  'Data',
  'INI',
  'Campaign.ini',
);

describe('campaign content policy', () => {
  it('classifies campaign names by lifecycle', () => {
    expect(classifyCampaignLifecycle('USA')).toEqual({
      lifecycle: 'shipped',
      reason: 'shipped-retail-campaign',
    });
    expect(classifyCampaignLifecycle('TRAINING')).toEqual({
      lifecycle: 'legacy',
      reason: 'training-removed-from-zero-hour-menu',
    });
    expect(classifyCampaignLifecycle('MD_CAMPEA_DEMO')).toEqual({
      lifecycle: 'demo',
      reason: 'demo-mission-disk-campaign',
    });
  });

  it('inherits training and demo lifecycle for owned asset references', () => {
    expect(
      classifyCampaignReference({
        campaignName: 'TRAINING',
        missionName: 'Mission01',
        assetKind: 'map',
        assetName: 'Maps\\Training01\\Training01.map',
      }),
    ).toEqual({
      lifecycle: 'legacy',
      reason: 'training-removed-from-zero-hour-menu',
    });
    expect(
      classifyCampaignReference({
        campaignName: 'MD_CAMPEA_DEMO',
        missionName: 'Mission01',
        assetKind: 'map',
        assetName: 'Maps\\CampEADemo\\CampEADemo.map',
      }),
    ).toEqual({
      lifecycle: 'demo',
      reason: 'demo-mission-disk-campaign',
    });
  });

  it('keeps challenge final victory movies live for shipped challenge campaigns', () => {
    expect(
      classifyCampaignReference({
        campaignName: 'CHALLENGE_0',
        assetKind: 'finalVictoryMovie',
        assetName: 'USACampaignVictory',
      }),
    ).toEqual({
      lifecycle: 'shipped',
      reason: 'live-challenge-final-movie-reference',
    });
  });

  it('treats shipped campaign references as live by default', () => {
    expect(
      classifyCampaignReference({
        campaignName: 'USA',
        missionName: 'Mission05',
        assetKind: 'introMovie',
        assetName: 'MD_USA05',
      }),
    ).toEqual({
      lifecycle: 'shipped',
      reason: 'shipped-retail-campaign',
    });
    expect(isLiveCampaignLifecycle('shipped')).toBe(true);
    expect(isLiveCampaignLifecycle('demo')).toBe(false);
    expect(isLiveCampaignLifecycle('legacy')).toBe(false);
  });

  it('classifies retail campaign roster into shipped, demo, and legacy buckets', () => {
    if (!fs.existsSync(RETAIL_CAMPAIGN_INI_PATH)) {
      return;
    }

    const campaigns = parseCampaignIni(fs.readFileSync(RETAIL_CAMPAIGN_INI_PATH, 'utf8'));
    const demoCampaigns = campaigns
      .filter((campaign) => classifyCampaignLifecycle(campaign.name).lifecycle === 'demo')
      .map((campaign) => campaign.name)
      .sort();
    const legacyCampaigns = campaigns
      .filter((campaign) => classifyCampaignLifecycle(campaign.name).lifecycle === 'legacy')
      .map((campaign) => campaign.name)
      .sort();
    const shippedCampaigns = campaigns
      .filter((campaign) => classifyCampaignLifecycle(campaign.name).lifecycle === 'shipped')
      .map((campaign) => campaign.name)
      .sort();

    expect(legacyCampaigns).toEqual(['training']);
    expect(demoCampaigns).toEqual([
      'md_campea_demo',
      'md_gla_3_demo',
      'md_usa_1_demo',
      'md_usa_2_demo',
    ]);
    expect(shippedCampaigns).toEqual([
      'challenge_0',
      'challenge_1',
      'challenge_2',
      'challenge_3',
      'challenge_4',
      'challenge_5',
      'challenge_6',
      'challenge_7',
      'challenge_8',
      'china',
      'gla',
      'usa',
    ]);
  });
});
