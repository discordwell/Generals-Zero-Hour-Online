/**
 * CampaignManager — Parses Campaign.ini and manages campaign/mission state.
 *
 * Source parity:
 *   GeneralsMD/Code/GameEngine/Include/GameClient/CampaignManager.h
 *   GeneralsMD/Code/GameEngine/Source/GameClient/System/CampaignManager.cpp
 */

// ──── Types ─────────────────────────────────────────────────────────────────

export type GameDifficulty = 'EASY' | 'NORMAL' | 'HARD';

export const MAX_OBJECTIVE_LINES = 5;
export const MAX_DISPLAYED_UNITS = 3;

export interface Mission {
  name: string;
  mapName: string;
  nextMission: string;
  movieLabel: string;
  objectiveLines: string[];
  briefingVoice: string;
  locationNameLabel: string;
  unitNames: string[];
  voiceLength: number;
  generalName: string;
}

export interface Campaign {
  name: string;
  firstMission: string;
  campaignNameLabel: string;
  finalMovieName: string;
  isChallengeCampaign: boolean;
  playerFactionName: string;
  missions: Mission[];
}

// ──── Parsing ───────────────────────────────────────────────────────────────

/**
 * Parse Campaign.ini text into Campaign objects.
 * This is a purpose-built mini-parser matching the C++ field parse table in
 * CampaignManager.cpp — not a generic INI parser.
 */
export function parseCampaignIni(text: string): Campaign[] {
  const campaigns: Campaign[] = [];
  const lines = text.split(/\r?\n/);

  let currentCampaign: Campaign | null = null;
  let currentMission: Mission | null = null;

  for (const rawLine of lines) {
    // Strip comments
    const commentIdx = rawLine.indexOf(';');
    const line = (commentIdx >= 0 ? rawLine.slice(0, commentIdx) : rawLine).trim();
    if (!line) continue;

    const tokens = line.split(/\s+/);
    const keyword = tokens[0]!;
    const rest = tokens.slice(1).join(' ');

    if (keyword === 'Campaign') {
      currentCampaign = {
        name: rest.toLowerCase(),
        firstMission: '',
        campaignNameLabel: '',
        finalMovieName: '',
        isChallengeCampaign: false,
        playerFactionName: '',
        missions: [],
      };
      currentMission = null;
      continue;
    }

    if (keyword === 'END' || keyword === 'End') {
      if (currentMission && currentCampaign) {
        currentCampaign.missions.push(currentMission);
        currentMission = null;
      } else if (currentCampaign) {
        campaigns.push(currentCampaign);
        currentCampaign = null;
      }
      continue;
    }

    if (!currentCampaign) continue;

    if (keyword === 'Mission') {
      currentMission = {
        name: rest.toLowerCase(),
        mapName: '',
        nextMission: '',
        movieLabel: '',
        objectiveLines: [],
        briefingVoice: '',
        locationNameLabel: '',
        unitNames: [],
        voiceLength: 0,
        generalName: '',
      };
      continue;
    }

    // Campaign-level fields
    if (!currentMission) {
      switch (keyword) {
        case 'FirstMission':
          currentCampaign.firstMission = rest.toLowerCase();
          break;
        case 'CampaignNameLabel':
          currentCampaign.campaignNameLabel = rest;
          break;
        case 'FinalVictoryMovie':
          currentCampaign.finalMovieName = rest;
          break;
        case 'IsChallengeCampaign':
          currentCampaign.isChallengeCampaign = rest.toLowerCase() === 'yes';
          break;
        case 'PlayerFaction':
          currentCampaign.playerFactionName = rest;
          break;
      }
      continue;
    }

    // Mission-level fields
    switch (keyword) {
      case 'Map':
        currentMission.mapName = rest;
        break;
      case 'NextMission':
        currentMission.nextMission = rest.toLowerCase();
        break;
      case 'IntroMovie':
        currentMission.movieLabel = rest;
        break;
      case 'ObjectiveLine0':
      case 'ObjectiveLine1':
      case 'ObjectiveLine2':
      case 'ObjectiveLine3':
      case 'ObjectiveLine4':
        currentMission.objectiveLines.push(rest);
        break;
      case 'BriefingVoice':
        currentMission.briefingVoice = rest;
        break;
      case 'LocationNameLabel':
        currentMission.locationNameLabel = rest;
        break;
      case 'UnitNames0':
      case 'UnitNames1':
      case 'UnitNames2':
        currentMission.unitNames.push(rest);
        break;
      case 'VoiceLength':
        currentMission.voiceLength = parseInt(rest.replace('=', '').trim(), 10) || 0;
        break;
      case 'GeneralName':
        currentMission.generalName = rest;
        break;
    }
  }

  return campaigns;
}

// ──── CampaignManager ───────────────────────────────────────────────────────

export class CampaignManager {
  private campaigns: Campaign[] = [];
  private currentCampaign: Campaign | null = null;
  private currentMission: Mission | null = null;
  private _victorious = false;
  private _difficulty: GameDifficulty = 'NORMAL';

  /** Parse Campaign.ini text and populate the campaign list. */
  init(campaignIniText: string): void {
    this.campaigns = parseCampaignIni(campaignIniText);
    this.currentCampaign = null;
    this.currentMission = null;
    this._victorious = false;
  }

  /** Get all parsed campaigns. */
  getCampaigns(): readonly Campaign[] {
    return this.campaigns;
  }

  /** Get non-challenge, non-demo campaigns (USA, GLA, China). */
  getStoryCampaigns(): Campaign[] {
    const storyNames = new Set(['usa', 'gla', 'china']);
    return this.campaigns.filter(c => storyNames.has(c.name));
  }

  /** Get challenge campaigns (CHALLENGE_0 through CHALLENGE_8). */
  getChallengeCampaigns(): Campaign[] {
    return this.campaigns.filter(c => c.isChallengeCampaign);
  }

  /** Get the training campaign. */
  getTrainingCampaign(): Campaign | null {
    return this.campaigns.find(c => c.name === 'training') ?? null;
  }

  getCurrentCampaign(): Campaign | null {
    return this.currentCampaign;
  }

  getCurrentMission(): Mission | null {
    return this.currentMission;
  }

  get difficulty(): GameDifficulty {
    return this._difficulty;
  }

  set difficulty(d: GameDifficulty) {
    this._difficulty = d;
  }

  get victorious(): boolean {
    return this._victorious;
  }

  set victorious(v: boolean) {
    this._victorious = v;
  }

  /**
   * Source parity: CampaignManager::setCampaign.
   * Sets the campaign by name and points to its first mission.
   */
  setCampaign(campaignName: string): boolean {
    const normalized = campaignName.toLowerCase();
    const campaign = this.campaigns.find(c => c.name === normalized);
    if (!campaign) {
      this.currentCampaign = null;
      this.currentMission = null;
      this._difficulty = 'NORMAL';
      return false;
    }
    this.currentCampaign = campaign;
    this.currentMission = this.findMission(campaign, campaign.firstMission);
    return true;
  }

  /**
   * Source parity: CampaignManager::setCampaignAndMission.
   */
  setCampaignAndMission(campaignName: string, missionName: string): boolean {
    if (!missionName) {
      return this.setCampaign(campaignName);
    }
    const normalized = campaignName.toLowerCase();
    const campaign = this.campaigns.find(c => c.name === normalized);
    if (!campaign) return false;
    const mission = this.findMission(campaign, missionName.toLowerCase());
    if (!mission) return false;
    this.currentCampaign = campaign;
    this.currentMission = mission;
    return true;
  }

  /**
   * Source parity: CampaignManager::gotoNextMission.
   * Advances to the next mission in the current campaign.
   * Returns the next Mission or null if at the end.
   */
  gotoNextMission(): Mission | null {
    if (!this.currentCampaign || !this.currentMission) return null;
    if (!this.currentMission.nextMission) {
      this.currentMission = null;
      return null;
    }
    this.currentMission = this.findMission(
      this.currentCampaign,
      this.currentMission.nextMission,
    );
    return this.currentMission;
  }

  /**
   * Source parity: CampaignManager::getCurrentMap.
   * Returns the map path for the current mission (Windows-style path from INI).
   */
  getCurrentMap(): string {
    return this.currentMission?.mapName ?? '';
  }

  /**
   * Source parity: CampaignManager::getCurrentMissionNumber.
   * Returns 0-based mission index within the current campaign.
   */
  getCurrentMissionNumber(): number {
    if (!this.currentCampaign || !this.currentMission) return -1;
    return this.currentCampaign.missions.indexOf(this.currentMission);
  }

  /**
   * Convert a mission's Windows-style map path to a runtime asset path.
   * e.g. "Maps\\MD_USA01\\MD_USA01.map" → "maps/_extracted/MapsZH/Maps/MD_USA01/MD_USA01.json"
   */
  resolveMapAssetPath(mission?: Mission | null): string | null {
    const m = mission ?? this.currentMission;
    if (!m?.mapName) return null;
    // INI uses backslash: "Maps\MD_USA01\MD_USA01.map"
    const parts = m.mapName.replace(/\\/g, '/').split('/');
    // Extract the map directory name (e.g., "MD_USA01")
    const mapDir = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
    if (!mapDir) return null;
    return `maps/_extracted/MapsZH/Maps/${mapDir}/${mapDir}.json`;
  }

  /**
   * Source parity: CampaignManager::getRankPoints always returns 0.
   * "All campaign missions start each map at rank 0" per source comment.
   */
  getRankPoints(): number {
    return 0;
  }

  private findMission(campaign: Campaign, missionName: string): Mission | null {
    if (!missionName) return null;
    const normalized = missionName.toLowerCase();
    return campaign.missions.find(m => m.name === normalized) ?? null;
  }
}
