/**
 * Campaign content lifecycle policy used by campaign certification and shell
 * integration.
 *
 * Source notes:
 * - Zero Hour still carries a TRAINING campaign block in Campaign.ini, but the
 *   main menu branch that launches it was explicitly removed in June 2003.
 * - *_DEMO campaigns are mission-disk/demo leftovers and should not be treated
 *   as shipped story/challenge parity targets.
 * - Challenge final movies are still live content when referenced by a shipped
 *   challenge campaign because ScoreScreen consumes Campaign::getFinalVictoryMovie().
 */

export type CampaignContentLifecycle = 'shipped' | 'demo' | 'legacy';

export type CampaignAssetKind =
  | 'campaign'
  | 'map'
  | 'introMovie'
  | 'briefingVoice'
  | 'finalVictoryMovie';

export type CampaignClassificationReason =
  | 'shipped-retail-campaign'
  | 'demo-mission-disk-campaign'
  | 'training-removed-from-zero-hour-menu'
  | 'unshipped-final-victory-placeholder';

export interface CampaignReferenceClassification {
  lifecycle: CampaignContentLifecycle;
  reason: CampaignClassificationReason;
}

export interface CampaignReferenceDescriptor {
  campaignName: string;
  assetKind: CampaignAssetKind;
  assetName?: string | null;
  missionName?: string | null;
}

const LEGACY_FINAL_VICTORY_PLACEHOLDER_NAMES = new Set([
  'usacampaignvictory',
  'glacampaignvictory',
  'chinacampaignvictory',
]);

function normalizeName(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? '';
}

/**
 * Classify a campaign name as shipped content, demo-only content, or legacy
 * content that still appears in retail INI data.
 */
export function classifyCampaignLifecycle(campaignName: string): CampaignReferenceClassification {
  const normalizedCampaignName = normalizeName(campaignName);
  if (!normalizedCampaignName) {
    return {
      lifecycle: 'shipped',
      reason: 'shipped-retail-campaign',
    };
  }
  if (normalizedCampaignName.endsWith('_demo')) {
    return {
      lifecycle: 'demo',
      reason: 'demo-mission-disk-campaign',
    };
  }
  if (normalizedCampaignName === 'training') {
    return {
      lifecycle: 'legacy',
      reason: 'training-removed-from-zero-hour-menu',
    };
  }
  return {
    lifecycle: 'shipped',
    reason: 'shipped-retail-campaign',
  };
}

/**
 * Classify a campaign-owned asset reference using the owning campaign's source
 * lifecycle, with targeted overrides for live references that are still
 * consumed by shipped runtime code.
 */
export function classifyCampaignReference(
  reference: CampaignReferenceDescriptor,
): CampaignReferenceClassification {
  const campaignLifecycle = classifyCampaignLifecycle(reference.campaignName);
  if (campaignLifecycle.lifecycle !== 'shipped') {
    return campaignLifecycle;
  }

  const normalizedAssetName = normalizeName(reference.assetName);
  if (
    reference.assetKind === 'finalVictoryMovie'
    && LEGACY_FINAL_VICTORY_PLACEHOLDER_NAMES.has(normalizedAssetName)
  ) {
    return {
      lifecycle: 'legacy',
      reason: 'unshipped-final-victory-placeholder',
    };
  }

  return campaignLifecycle;
}

export function isLiveCampaignLifecycle(lifecycle: CampaignContentLifecycle): boolean {
  return lifecycle === 'shipped';
}
