import { SaveFileType } from '@generals/engine';
import type { Campaign, GameDifficulty, Mission } from '@generals/game-logic';
import { formatSourceText, resolveLocalizedText } from './localization.js';
import type {
  RuntimeSaveCampaignBootstrap,
  RuntimeSaveChallengeGameInfoState,
} from './runtime-save-game.js';

export interface CampaignMissionSavePayload {
  description: string;
  sourceMetadata: {
    saveFileType: SaveFileType.SAVE_FILE_TYPE_MISSION;
    missionMapName: string;
  };
  campaign: RuntimeSaveCampaignBootstrap;
}

export interface CampaignMissionSavePayloadParams {
  campaign: Campaign;
  mission: Mission;
  missionNumber: number;
  difficulty: GameDifficulty;
  rankPoints: number;
  playerTemplateNum: number;
  localizedStrings: ReadonlyMap<string, string>;
  playerDisplayName?: string | null;
  challengeGameInfoState?: RuntimeSaveChallengeGameInfoState | null;
}

export function formatCampaignMissionSaveDescription(
  campaign: Pick<Campaign, 'campaignNameLabel' | 'name'>,
  missionNumber: number,
  localizedStrings: ReadonlyMap<string, string>,
): string {
  if (!Number.isFinite(missionNumber) || missionNumber < 0) {
    throw new Error(`Cannot format mission save description for invalid mission number ${missionNumber}.`);
  }
  const format = resolveLocalizedText('GUI:MissionSave', localizedStrings);
  const campaignLabel = resolveLocalizedText(
    campaign.campaignNameLabel || campaign.name,
    localizedStrings,
  );
  return formatSourceText(format, [campaignLabel, Math.trunc(missionNumber) + 1]);
}

export function buildCampaignMissionSavePayload(
  params: CampaignMissionSavePayloadParams,
): CampaignMissionSavePayload {
  const missionNumber = Math.trunc(params.missionNumber);
  return {
    description: formatCampaignMissionSaveDescription(
      params.campaign,
      missionNumber,
      params.localizedStrings,
    ),
    sourceMetadata: {
      saveFileType: SaveFileType.SAVE_FILE_TYPE_MISSION,
      missionMapName: params.mission.mapName,
    },
    campaign: {
      campaignName: params.campaign.name,
      missionName: params.mission.name,
      missionNumber,
      difficulty: params.difficulty,
      rankPoints: Math.trunc(params.rankPoints),
      isChallengeCampaign: params.campaign.isChallengeCampaign,
      playerTemplateNum: Math.trunc(params.playerTemplateNum),
      sourceMapName: params.mission.mapName,
      playerDisplayName: params.playerDisplayName ?? undefined,
      challengeGameInfoState: params.challengeGameInfoState ?? null,
    },
  };
}
