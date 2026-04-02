/**
 * ChallengeGenerals — Tracks Generals Challenge progression and personas.
 *
 * Source parity:
 *   GeneralsMD/Code/GameEngine/Include/GameClient/ChallengeGenerals.h
 *   GeneralsMD/Code/GameEngine/Source/GameClient/ChallengeGenerals.cpp
 *
 * Persists defeated generals to localStorage so progress carries across sessions.
 */

import type { IniBlock, IniValue } from '@generals/core';
import type { IniDataRegistry } from '@generals/ini-data';

export interface GeneralPersona {
  index: number;
  startsEnabled: boolean;
  name: string;
  faction: string;
  bioNameLabel: string;
  bioRankLabel?: string;
  bioBranchLabel?: string;
  bioStrategyLabel?: string;
  campaignName: string;
  playerTemplateName: string;
  bioPortraitSmallName: string;
  bioPortraitLargeName: string;
  generalImageName?: string;
  medallionRegularName?: string;
  medallionHiliteName?: string;
  medallionSelectName?: string;
  portraitMovieLeftName: string;
  portraitMovieRightName: string;
  defeatedImageName: string;
  victoriousImageName: string;
  defeatedStringLabel: string;
  victoriousStringLabel: string;
  selectionSound: string;
  tauntSounds: string[];
  winSound: string;
  lossSound: string;
  previewSound: string;
  nameSound: string;
}

/** Single source of truth for general persona data. */
export const DEFAULT_PERSONAS: readonly GeneralPersona[] = [
  { index: 0, startsEnabled: true, name: 'General Granger', faction: 'USA Air Force', bioNameLabel: '', campaignName: 'challenge_0', playerTemplateName: 'FactionAmericaAirForceGeneral', bioPortraitSmallName: '', bioPortraitLargeName: '', portraitMovieLeftName: 'PortraitAirGenLeft', portraitMovieRightName: 'PortraitAirGenRight', defeatedImageName: '', victoriousImageName: '', defeatedStringLabel: '', victoriousStringLabel: '', selectionSound: '', tauntSounds: [], winSound: '', lossSound: '', previewSound: '', nameSound: '' },
  { index: 1, startsEnabled: true, name: 'Dr. Thrax', faction: 'GLA Toxin', bioNameLabel: '', campaignName: 'challenge_1', playerTemplateName: 'FactionGLAToxinGeneral', bioPortraitSmallName: '', bioPortraitLargeName: '', portraitMovieLeftName: 'PortraitDrThraxLeft', portraitMovieRightName: 'PortraitDrThraxRight', defeatedImageName: '', victoriousImageName: '', defeatedStringLabel: '', victoriousStringLabel: '', selectionSound: '', tauntSounds: [], winSound: '', lossSound: '', previewSound: '', nameSound: '' },
  { index: 2, startsEnabled: true, name: 'General Tao', faction: 'China Nuclear', bioNameLabel: '', campaignName: 'challenge_2', playerTemplateName: 'FactionChinaNukeGeneral', bioPortraitSmallName: '', bioPortraitLargeName: '', portraitMovieLeftName: 'PortraitNukeGenLeft', portraitMovieRightName: 'PortraitNukeGenRight', defeatedImageName: '', victoriousImageName: '', defeatedStringLabel: '', victoriousStringLabel: '', selectionSound: '', tauntSounds: [], winSound: '', lossSound: '', previewSound: '', nameSound: '' },
  { index: 3, startsEnabled: true, name: 'General Alexander', faction: 'USA Super Weapons', bioNameLabel: '', campaignName: 'challenge_3', playerTemplateName: 'FactionAmericaSuperWeaponGeneral', bioPortraitSmallName: '', bioPortraitLargeName: '', portraitMovieLeftName: 'PortraitSuperGenLeft', portraitMovieRightName: 'PortraitSuperGenRight', defeatedImageName: '', victoriousImageName: '', defeatedStringLabel: '', victoriousStringLabel: '', selectionSound: '', tauntSounds: [], winSound: '', lossSound: '', previewSound: '', nameSound: '' },
  { index: 4, startsEnabled: true, name: 'General Kwai', faction: 'China Tank', bioNameLabel: '', campaignName: 'challenge_4', playerTemplateName: 'FactionChinaTankGeneral', bioPortraitSmallName: '', bioPortraitLargeName: '', portraitMovieLeftName: 'PortraitTankGenLeft', portraitMovieRightName: 'PortraitTankGenRight', defeatedImageName: '', victoriousImageName: '', defeatedStringLabel: '', victoriousStringLabel: '', selectionSound: '', tauntSounds: [], winSound: '', lossSound: '', previewSound: '', nameSound: '' },
  { index: 5, startsEnabled: true, name: 'General Townes', faction: 'USA Laser', bioNameLabel: '', campaignName: 'challenge_5', playerTemplateName: 'FactionAmericaLaserGeneral', bioPortraitSmallName: '', bioPortraitLargeName: '', portraitMovieLeftName: 'PortraitLaserGenLeft', portraitMovieRightName: 'PortraitLaserGenRight', defeatedImageName: '', victoriousImageName: '', defeatedStringLabel: '', victoriousStringLabel: '', selectionSound: '', tauntSounds: [], winSound: '', lossSound: '', previewSound: '', nameSound: '' },
  { index: 6, startsEnabled: true, name: 'Prince Kassad', faction: 'GLA Stealth', bioNameLabel: '', campaignName: 'challenge_6', playerTemplateName: 'FactionGLAStealthGeneral', bioPortraitSmallName: '', bioPortraitLargeName: '', portraitMovieLeftName: 'PortraitStealthGenLeft', portraitMovieRightName: 'PortraitStealthGenRight', defeatedImageName: '', victoriousImageName: '', defeatedStringLabel: '', victoriousStringLabel: '', selectionSound: '', tauntSounds: [], winSound: '', lossSound: '', previewSound: '', nameSound: '' },
  { index: 7, startsEnabled: true, name: 'General Fai', faction: 'China Infantry', bioNameLabel: '', campaignName: 'challenge_7', playerTemplateName: 'FactionChinaInfantryGeneral', bioPortraitSmallName: '', bioPortraitLargeName: '', portraitMovieLeftName: 'PortraitInfantryGenLeft', portraitMovieRightName: 'PortraitInfantryGenRight', defeatedImageName: '', victoriousImageName: '', defeatedStringLabel: '', victoriousStringLabel: '', selectionSound: '', tauntSounds: [], winSound: '', lossSound: '', previewSound: '', nameSound: '' },
  { index: 8, startsEnabled: true, name: 'GLA Demolition General', faction: 'GLA Demolition General', bioNameLabel: '', campaignName: 'challenge_8', playerTemplateName: 'FactionGLADemolitionGeneral', bioPortraitSmallName: '', bioPortraitLargeName: '', portraitMovieLeftName: 'PortraitDemolitionGenLeft', portraitMovieRightName: 'PortraitDemolitionGenRight', defeatedImageName: '', victoriousImageName: '', defeatedStringLabel: '', victoriousStringLabel: '', selectionSound: '', tauntSounds: [], winSound: '', lossSound: '', previewSound: '', nameSound: '' },
];

export const NUM_GENERALS = DEFAULT_PERSONAS.length;

const DEFAULT_PERSONA_BY_CAMPAIGN = new Map(
  DEFAULT_PERSONAS.map((persona) => [persona.campaignName.toLowerCase(), persona] as const),
);
const DEFAULT_PERSONA_BY_TEMPLATE = new Map(
  DEFAULT_PERSONAS.map((persona) => [persona.playerTemplateName, persona] as const),
);

const STORAGE_KEY = 'generals_challenge_progress';

export class ChallengeGenerals {
  private personas: GeneralPersona[];
  private defeatedIndices = new Set<number>();
  private currentPlayerTemplateNum = 0;
  private storage: Storage | null = null;

  constructor(storage?: Storage | null, personas: readonly GeneralPersona[] = DEFAULT_PERSONAS) {
    this.personas = [...personas];
    this.storage = storage ?? null;
    this.loadProgress();
  }

  getPersonas(): readonly GeneralPersona[] {
    return this.personas;
  }

  getPersona(index: number): GeneralPersona | null {
    return this.personas[index] ?? null;
  }

  getPersonaByCampaignName(name: string): GeneralPersona | null {
    return this.personas.find(p => p.campaignName === name.toLowerCase()) ?? null;
  }

  getPersonaByTemplateName(name: string): GeneralPersona | null {
    return this.personas.find(p => p.playerTemplateName === name) ?? null;
  }

  getEnabledPersonas(): readonly GeneralPersona[] {
    return this.personas.filter((persona) => persona.startsEnabled);
  }

  isDefeated(index: number): boolean {
    return this.defeatedIndices.has(index);
  }

  getDefeatedIndices(): readonly number[] {
    return [...this.defeatedIndices];
  }

  markDefeated(index: number): void {
    this.defeatedIndices.add(index);
    this.saveProgress();
  }

  resetProgress(): void {
    this.defeatedIndices.clear();
    this.saveProgress();
  }

  get currentPlayerTemplate(): number {
    return this.currentPlayerTemplateNum;
  }

  set currentPlayerTemplate(num: number) {
    this.currentPlayerTemplateNum = num;
  }

  private loadProgress(): void {
    if (!this.storage) return;
    const personaIndices = new Set(this.personas.map((persona) => persona.index));
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        if (Array.isArray(data.defeated)) {
          for (const idx of data.defeated) {
            if (typeof idx === 'number' && personaIndices.has(idx)) {
              this.defeatedIndices.add(idx);
            }
          }
        }
      }
    } catch {
      // Ignore corrupt data
    }
  }

  private saveProgress(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(
        STORAGE_KEY,
        JSON.stringify({ defeated: [...this.defeatedIndices] }),
      );
    } catch {
      // Storage may be full or unavailable
    }
  }
}

/**
 * Source parity:
 *   GeneralsMD/Code/GameEngine/Source/GameClient/GUI/ChallengeGenerals.cpp
 */
export function buildChallengePersonasFromRegistry(
  iniDataRegistry: IniDataRegistry,
): GeneralPersona[] {
  const challengeBlocks = iniDataRegistry.getChallengeGeneralsBlocks();
  const sourceBlock = challengeBlocks[challengeBlocks.length - 1];
  if (!sourceBlock) {
    return [...DEFAULT_PERSONAS];
  }

  const personas = sourceBlock.blocks
    .map((block) => buildChallengePersonaFromBlock(block, iniDataRegistry))
    .filter((persona): persona is GeneralPersona => persona !== null)
    .sort((a, b) => a.index - b.index);

  return personas.length > 0 ? personas : [...DEFAULT_PERSONAS];
}

export function getEnabledChallengePersonas(personas: readonly GeneralPersona[]): GeneralPersona[] {
  return personas.filter((persona) =>
    persona.startsEnabled && persona.campaignName.length > 0 && persona.campaignName.toLowerCase() !== 'unimplemented',
  );
}

function buildChallengePersonaFromBlock(
  block: IniBlock,
  iniDataRegistry: IniDataRegistry,
): GeneralPersona | null {
  const match = /^GeneralPersona(\d+)$/i.exec(block.type);
  if (!match) {
    return null;
  }

  const index = Number(match[1]);
  if (!Number.isInteger(index) || index < 0) {
    return null;
  }

  const campaignName = extractString(block.fields['Campaign'])?.toLowerCase() ?? '';
  const playerTemplateName = extractString(block.fields['PlayerTemplate']) ?? '';
  const fallbackPersona =
    DEFAULT_PERSONA_BY_CAMPAIGN.get(campaignName)
    ?? DEFAULT_PERSONA_BY_TEMPLATE.get(playerTemplateName)
    ?? DEFAULT_PERSONAS[index];

  const name = fallbackPersona?.name
    ?? humanizePlayerTemplateName(playerTemplateName)
    ?? extractString(block.fields['BioNameString'])
    ?? `GeneralPersona${index}`;
  const faction = fallbackPersona?.faction
    ?? humanizePlayerTemplateName(playerTemplateName)
    ?? playerTemplateName
    ?? `GeneralPersona${index}`;
  const playerTemplate = playerTemplateName
    ? iniDataRegistry.getFaction(playerTemplateName)
    : undefined;

  return {
    index,
    startsEnabled: extractBoolean(block.fields['StartsEnabled']) ?? false,
    name,
    faction,
    bioNameLabel: extractString(block.fields['BioNameString']) ?? '',
    bioRankLabel: extractString(block.fields['BioRankString']) ?? '',
    bioBranchLabel: extractString(block.fields['BioBranchString']) ?? '',
    bioStrategyLabel: extractString(block.fields['BioStrategyString']) ?? '',
    campaignName,
    playerTemplateName,
    bioPortraitSmallName: normalizeSourceToken(extractString(block.fields['BioPortraitSmall'])) ?? '',
    bioPortraitLargeName: normalizeSourceToken(extractString(block.fields['BioPortraitLarge'])) ?? '',
    generalImageName: normalizeSourceToken(playerTemplate?.generalImage) ?? '',
    medallionRegularName: normalizeSourceToken(playerTemplate?.medallionRegular) ?? '',
    medallionHiliteName: normalizeSourceToken(playerTemplate?.medallionHilite) ?? '',
    medallionSelectName: normalizeSourceToken(playerTemplate?.medallionSelect) ?? '',
    portraitMovieLeftName: normalizeSourceToken(extractString(block.fields['PortraitMovieLeftName'])) ?? '',
    portraitMovieRightName: normalizeSourceToken(extractString(block.fields['PortraitMovieRightName'])) ?? '',
    defeatedImageName: normalizeSourceToken(extractString(block.fields['DefeatedImage'])) ?? '',
    victoriousImageName: normalizeSourceToken(extractString(block.fields['VictoriousImage'])) ?? '',
    defeatedStringLabel: extractString(block.fields['DefeatedString']) ?? '',
    victoriousStringLabel: extractString(block.fields['VictoriousString']) ?? '',
    selectionSound: normalizeSourceToken(extractString(block.fields['SelectionSound'])) ?? '',
    tauntSounds: [
      normalizeSourceToken(extractString(block.fields['TauntSound1'])),
      normalizeSourceToken(extractString(block.fields['TauntSound2'])),
      normalizeSourceToken(extractString(block.fields['TauntSound3'])),
    ].filter((value): value is string => Boolean(value)),
    winSound: normalizeSourceToken(extractString(block.fields['WinSound'])) ?? '',
    lossSound: normalizeSourceToken(extractString(block.fields['LossSound'])) ?? '',
    previewSound: normalizeSourceToken(extractString(block.fields['PreviewSound'])) ?? '',
    nameSound: normalizeSourceToken(extractString(block.fields['NameSound'])) ?? '',
  };
}

function extractString(value: IniValue | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function extractBoolean(value: IniValue | undefined): boolean | undefined {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === 'yes' || normalized === '1') {
      return true;
    }
    if (normalized === 'false' || normalized === 'no' || normalized === '0') {
      return false;
    }
  }
  return undefined;
}

function normalizeSourceToken(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }
  if (normalized.toLowerCase() === 'none' || normalized.toLowerCase() === 'unimplemented') {
    return undefined;
  }
  return normalized;
}

function humanizePlayerTemplateName(playerTemplateName: string): string | undefined {
  const normalized = playerTemplateName.trim();
  if (!normalized) {
    return undefined;
  }
  const withoutPrefix = normalized.replace(/^Faction/, '');
  const tokens = withoutPrefix
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^America\b/, 'USA')
    .replace(/^GLA\b/, 'GLA')
    .trim();
  return tokens.length > 0 ? tokens : undefined;
}
