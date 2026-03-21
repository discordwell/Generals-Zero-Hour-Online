/**
 * INI Data Registry — loads parsed INI JSON and builds indexed lookups.
 *
 * Resolves inheritance chains, validates references, and provides
 * typed access to game objects, weapons, upgrades, sciences, and factions.
 */

import type { IniBlock, IniValue } from '@generals/core';

// ---------------------------------------------------------------------------
// Definition types
// ---------------------------------------------------------------------------

export interface ObjectDef {
  name: string;
  parent?: string;
  side?: string;
  kindOf?: string[];
  fields: Record<string, IniValue>;
  blocks: IniBlock[];
  resolved: boolean;
  hasUnresolvedParent?: boolean;
}

export interface WeaponDef {
  name: string;
  parent?: string;
  fields: Record<string, IniValue>;
  blocks: IniBlock[];
  resolved?: boolean;
  hasUnresolvedParent?: boolean;
}

export interface ArmorDef {
  name: string;
  fields: Record<string, IniValue>;
}

export interface UpgradeDef {
  name: string;
  fields: Record<string, IniValue>;
  blocks?: IniBlock[];
  kindOf?: string[];
}

export interface SpecialPowerDef {
  name: string;
  parent?: string;
  fields: Record<string, IniValue>;
  blocks: IniBlock[];
  resolved?: boolean;
  hasUnresolvedParent?: boolean;
}

export interface ObjectCreationListDef {
  name: string;
  parent?: string;
  fields: Record<string, IniValue>;
  blocks: IniBlock[];
  resolved?: boolean;
  hasUnresolvedParent?: boolean;
}

export interface ScienceDef {
  name: string;
  fields: Record<string, IniValue>;
}

export interface FactionDef {
  name: string;
  side?: string;
  fields: Record<string, IniValue>;
}

export interface LocomotorDef {
  name: string;
  fields: Record<string, IniValue>;
  surfaces: string[];
  surfaceMask: number;
  downhillOnly: boolean;
  speed?: number;
}

export interface CommandButtonDef {
  name: string;
  fields: Record<string, IniValue>;
  blocks: IniBlock[];
  commandTypeName?: string;
  options: string[];
  unitSpecificSoundName?: string;
}

export interface CommandSetButtonSlot {
  slot: number;
  commandButtonName: string;
}

export interface CommandSetDef {
  name: string;
  fields: Record<string, IniValue>;
  buttons: string[];
  slottedButtons?: CommandSetButtonSlot[];
}

export type AudioEventSoundType = 'music' | 'streaming' | 'sound';

export interface AudioEventDef {
  name: string;
  fields: Record<string, IniValue>;
  blocks: IniBlock[];
  soundType: AudioEventSoundType;
  priorityName?: string;
  typeNames: string[];
  controlNames: string[];
  volume?: number;
  minVolume?: number;
  limit?: number;
  minRange?: number;
  maxRange?: number;
  filename?: string;
}

export interface MiscAudioDef {
  entries: Record<string, string>;
  guiClickSoundName?: string;
  noCanDoSoundName?: string;
}

export interface MusicTracksByType {
  menu: string[];
  ambient: string[];
  battle: string[];
}

export interface RawBlockDef {
  name: string;
  fields: Record<string, IniValue>;
  blocks: IniBlock[];
}

export interface RegistryStats {
  objects: number;
  weapons: number;
  armors: number;
  upgrades: number;
  sciences: number;
  factions: number;
  audioEvents: number;
  commandButtons: number;
  commandSets: number;
  particleSystems: number;
  fxLists: number;
  staticGameLODs: number;
  dynamicGameLODs: number;
  unresolvedInheritance: number;
  totalBlocks: number;
}

export interface RegistryError {
  type: 'unresolved_parent' | 'duplicate' | 'unsupported_block';
  blockType: string;
  name: string;
  detail: string;
  file?: string;
}

export interface AiConfig {
  attackUsesLineOfSight?: boolean;
  skirmishBaseDefenseExtraDistance?: number;
  resourcesWealthy?: number;
  resourcesPoor?: number;
  guardInnerModifierAI?: number;
  guardOuterModifierAI?: number;
  guardInnerModifierHuman?: number;
  guardOuterModifierHuman?: number;
  /** Source parity: INI::parseDurationUnsignedInt stores duration fields as logic frames. */
  guardChaseUnitFrames?: number;
  /** Source parity: INI::parseDurationUnsignedInt stores duration fields as logic frames. */
  guardEnemyScanRateFrames?: number;
  /** Source parity: INI::parseDurationUnsignedInt stores duration fields as logic frames. */
  guardEnemyReturnScanRateFrames?: number;
}

/**
 * Source parity: Zero Hour `Data/INI/Default/AIData.ini`.
 * Duration fields are normalized to logic frames the same way the retail
 * loader stores them after `parseDurationUnsignedInt`.
 */
export const DEFAULT_AI_CONFIG: Required<AiConfig> = {
  attackUsesLineOfSight: true,
  skirmishBaseDefenseExtraDistance: 150,
  resourcesWealthy: 7000,
  resourcesPoor: 2000,
  guardInnerModifierAI: 1.1,
  guardOuterModifierAI: 1.333,
  guardInnerModifierHuman: 1.8,
  guardOuterModifierHuman: 2.2,
  guardChaseUnitFrames: 300,
  guardEnemyScanRateFrames: 15,
  guardEnemyReturnScanRateFrames: 30,
};

/**
 * Source parity: WeaponBonusSet::parseWeaponBonusSet — a single entry from
 * `WeaponBonus = CONDITION FIELD PERCENT%` in GameData.ini.
 */
export interface WeaponBonusEntry {
  condition: string;
  field: string;
  multiplier: number;
}

/**
 * Source parity: TheGlobalData — selected fields from the global GameData INI block.
 */
export interface GameDataConfig {
  weaponBonusEntries: WeaponBonusEntry[];
  /**
   * Source parity: GlobalData::m_healthBonus[LEVEL_COUNT]
   * Indexed by VeterancyLevel: [REGULAR, VETERAN, ELITE, HEROIC].
   * Loaded from GameData.ini fields: HealthBonus_Veteran, HealthBonus_Elite, HealthBonus_Heroic.
   * REGULAR is always 1.0 (hardcoded in C++, not settable via INI).
   * C++ default: all 1.0. Retail ZH values: [1.0, 1.2, 1.3, 1.5].
   */
  healthBonuses: [number, number, number, number];
}

export interface AudioSettingsConfig {
  sampleCount2D?: number;
  sampleCount3D?: number;
  streamCount?: number;
  minSampleVolume?: number;
  globalMinRange?: number;
  globalMaxRange?: number;
  relative2DVolume?: number;
  defaultSoundVolume?: number;
  default3DSoundVolume?: number;
  defaultSpeechVolume?: number;
  defaultMusicVolume?: number;
  /** Source parity: AudioSettings::m_zoomMinDistance */
  zoomMinDistance?: number;
  /** Source parity: AudioSettings::m_zoomMaxDistance */
  zoomMaxDistance?: number;
  /** Source parity: AudioSettings::m_zoomSoundVolumePercentageAmount */
  zoomSoundVolumePercent?: number;
}

export interface IniDataBundle {
  objects: ObjectDef[];
  weapons: WeaponDef[];
  armors: ArmorDef[];
  upgrades: UpgradeDef[];
  sciences: ScienceDef[];
  factions: FactionDef[];
  specialPowers?: SpecialPowerDef[];
  objectCreationLists?: ObjectCreationListDef[];
  locomotors?: LocomotorDef[];
  audioEvents?: AudioEventDef[];
  miscAudio?: MiscAudioDef;
  commandButtons?: CommandButtonDef[];
  commandSets?: CommandSetDef[];
  particleSystems?: RawBlockDef[];
  fxLists?: RawBlockDef[];
  staticGameLODs?: RawBlockDef[];
  dynamicGameLODs?: RawBlockDef[];
  commandMaps?: RawBlockDef[];
  creditsBlocks?: RawBlockDef[];
  mouseBlocks?: RawBlockDef[];
  mouseCursors?: RawBlockDef[];
  multiplayerColors?: RawBlockDef[];
  multiplayerStartingMoneyChoices?: RawBlockDef[];
  onlineChatColorBlocks?: RawBlockDef[];
  waterTransparencyBlocks?: RawBlockDef[];
  challengeGeneralsBlocks?: RawBlockDef[];
  ai?: AiConfig;
  audioSettings?: AudioSettingsConfig;
  gameData?: GameDataConfig;
  stats: RegistryStats;
  errors: RegistryError[];
  unsupportedBlockTypes: string[];
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export class IniDataRegistry {
  readonly objects = new Map<string, ObjectDef>();
  readonly weapons = new Map<string, WeaponDef>();
  readonly armors = new Map<string, ArmorDef>();
  readonly upgrades = new Map<string, UpgradeDef>();
  readonly sciences = new Map<string, ScienceDef>();
  readonly factions = new Map<string, FactionDef>();
  readonly specialPowers = new Map<string, SpecialPowerDef>();
  readonly objectCreationLists = new Map<string, ObjectCreationListDef>();
  readonly locomotors = new Map<string, LocomotorDef>();
  readonly audioEvents = new Map<string, AudioEventDef>();
  readonly commandButtons = new Map<string, CommandButtonDef>();
  readonly commandSets = new Map<string, CommandSetDef>();
  readonly particleSystems = new Map<string, RawBlockDef>();
  readonly fxLists = new Map<string, RawBlockDef>();
  readonly staticGameLODs = new Map<string, RawBlockDef>();
  readonly dynamicGameLODs = new Map<string, RawBlockDef>();
  private commandMaps: RawBlockDef[] = [];
  private creditsBlocks: RawBlockDef[] = [];
  private mouseBlocks: RawBlockDef[] = [];
  private mouseCursors: RawBlockDef[] = [];
  private multiplayerColors: RawBlockDef[] = [];
  private multiplayerStartingMoneyChoices: RawBlockDef[] = [];
  private onlineChatColorBlocks: RawBlockDef[] = [];
  private waterTransparencyBlocks: RawBlockDef[] = [];
  private challengeGeneralsBlocks: RawBlockDef[] = [];
  readonly errors: RegistryError[] = [];
  private ai: AiConfig | undefined;
  private audioSettings: AudioSettingsConfig | undefined;
  private gameData: GameDataConfig | undefined;
  private miscAudio: MiscAudioDef | undefined;

  private unsupportedBlockTypes = new Set<string>();

  /** Load parsed INI blocks (from CLI JSON output or parseIni result). */
  loadBlocks(blocks: IniBlock[], sourcePath?: string): void {
    for (const block of blocks) {
      this.indexBlock(block, sourcePath);
    }
  }

  /** Resolve all inheritance chains. Call after all blocks are loaded. */
  resolveInheritance(): void {
    // Resolve objects
    for (const [name, obj] of this.objects) {
      if (obj.parent && !obj.resolved) {
        this.resolveObjectChain(name, new Set());
      }
    }
    for (const [name, weapon] of this.weapons) {
      if (weapon.parent && !weapon.resolved) {
        this.resolveWeaponChain(name, new Set());
      }
    }
    for (const [name, specialPower] of this.specialPowers) {
      if (specialPower.parent && !specialPower.resolved) {
        this.resolveSpecialPowerChain(name, new Set());
      }
    }
    for (const [name, objectCreationList] of this.objectCreationLists) {
      if (objectCreationList.parent && !objectCreationList.resolved) {
        this.resolveObjectCreationListChain(name, new Set());
      }
    }
  }

  /** Load prebuilt registry state from an INI data bundle. */
  loadBundle(bundle: IniDataBundle): void {
    this.objects.clear();
    this.weapons.clear();
    this.armors.clear();
    this.upgrades.clear();
    this.sciences.clear();
    this.factions.clear();
    this.specialPowers.clear();
    this.objectCreationLists.clear();
    this.locomotors.clear();
    this.audioEvents.clear();
    this.commandButtons.clear();
    this.commandSets.clear();
    this.particleSystems.clear();
    this.fxLists.clear();
    this.staticGameLODs.clear();
    this.dynamicGameLODs.clear();
    this.commandMaps = [];
    this.creditsBlocks = [];
    this.mouseBlocks = [];
    this.mouseCursors = [];
    this.multiplayerColors = [];
    this.multiplayerStartingMoneyChoices = [];
    this.onlineChatColorBlocks = [];
    this.waterTransparencyBlocks = [];
    this.challengeGeneralsBlocks = [];
    this.errors.length = 0;
    this.unsupportedBlockTypes.clear();
    this.miscAudio = undefined;
    this.audioSettings = undefined;
    this.gameData = undefined;

    for (const object of bundle.objects) {
      this.objects.set(object.name, {
        ...object,
        fields: { ...object.fields },
        blocks: [...object.blocks],
        kindOf: object.kindOf ? [...object.kindOf] : undefined,
        resolved: object.resolved ?? !object.parent,
        hasUnresolvedParent: object.hasUnresolvedParent ?? false,
      });
    }

    for (const weapon of bundle.weapons) {
      this.weapons.set(weapon.name, {
        ...weapon,
        fields: { ...weapon.fields },
        blocks: [...weapon.blocks],
        resolved: weapon.resolved ?? !weapon.parent,
        hasUnresolvedParent: weapon.hasUnresolvedParent ?? false,
      });
    }

    for (const armor of bundle.armors) {
      this.armors.set(armor.name, { ...armor, fields: { ...armor.fields } });
    }

    for (const upgrade of bundle.upgrades) {
      this.upgrades.set(upgrade.name, {
        ...upgrade,
        fields: { ...upgrade.fields },
        blocks: [...(upgrade.blocks ?? [])],
        kindOf: upgrade.kindOf ? [...upgrade.kindOf] : undefined,
      });
    }

    for (const science of bundle.sciences) {
      this.sciences.set(science.name, { ...science, fields: { ...science.fields } });
    }

    for (const faction of bundle.factions) {
      this.factions.set(faction.name, { ...faction, fields: { ...faction.fields } });
    }
    for (const specialPower of bundle.specialPowers ?? []) {
      // Source parity: C++ NameKeyGenerator lowercases all names.
      // Store with uppercase key for case-insensitive lookup.
      this.specialPowers.set(specialPower.name.toUpperCase(), {
        ...specialPower,
        fields: { ...specialPower.fields },
        blocks: [...specialPower.blocks],
        resolved: specialPower.resolved ?? !specialPower.parent,
        hasUnresolvedParent: specialPower.hasUnresolvedParent ?? false,
      });
    }
    for (const objectCreationList of bundle.objectCreationLists ?? []) {
      this.objectCreationLists.set(objectCreationList.name, {
        ...objectCreationList,
        fields: { ...objectCreationList.fields },
        blocks: [...objectCreationList.blocks],
        resolved: objectCreationList.resolved ?? !objectCreationList.parent,
        hasUnresolvedParent: objectCreationList.hasUnresolvedParent ?? false,
      });
    }
    for (const locomotor of bundle.locomotors ?? []) {
      this.locomotors.set(locomotor.name, {
        ...locomotor,
        fields: { ...locomotor.fields },
        surfaces: [...locomotor.surfaces],
      });
    }
    for (const audioEvent of bundle.audioEvents ?? []) {
      this.audioEvents.set(audioEvent.name, {
        ...audioEvent,
        fields: { ...audioEvent.fields },
        blocks: [...(audioEvent.blocks ?? [])],
        soundType: audioEvent.soundType ?? 'sound',
        typeNames: [...(audioEvent.typeNames ?? [])],
        controlNames: [...(audioEvent.controlNames ?? [])],
      });
    }
    for (const commandButton of bundle.commandButtons ?? []) {
      this.commandButtons.set(commandButton.name, {
        ...commandButton,
        fields: { ...commandButton.fields },
        blocks: [...(commandButton.blocks ?? [])],
        commandTypeName: commandButton.commandTypeName ?? extractTokenString(commandButton.fields['Command']),
        options: [...(commandButton.options ?? extractOptions(commandButton.fields['Options']))],
        unitSpecificSoundName: commandButton.unitSpecificSoundName,
      });
    }
    for (const commandSet of bundle.commandSets ?? []) {
      const normalizedButtons = commandSet.buttons ?? [];
      const slottedButtons = normalizeCommandSetButtonSlots(
        commandSet.slottedButtons ??
          normalizedButtons.map((commandButtonName, index) => ({
            slot: index + 1,
            commandButtonName,
          })),
      );
      this.commandSets.set(commandSet.name, {
        ...commandSet,
        fields: { ...commandSet.fields },
        buttons: slottedButtons.map((entry) => entry.commandButtonName),
        slottedButtons,
      });
    }
    for (const ps of bundle.particleSystems ?? []) {
      this.particleSystems.set(ps.name, {
        name: ps.name,
        fields: { ...ps.fields },
        blocks: [...(ps.blocks ?? [])],
      });
    }
    for (const fx of bundle.fxLists ?? []) {
      this.fxLists.set(fx.name, {
        name: fx.name,
        fields: { ...fx.fields },
        blocks: [...(fx.blocks ?? [])],
      });
    }
    for (const lod of bundle.staticGameLODs ?? []) {
      this.staticGameLODs.set(lod.name, {
        name: lod.name,
        fields: { ...lod.fields },
        blocks: [...(lod.blocks ?? [])],
      });
    }
    for (const lod of bundle.dynamicGameLODs ?? []) {
      this.dynamicGameLODs.set(lod.name, {
        name: lod.name,
        fields: { ...lod.fields },
        blocks: [...(lod.blocks ?? [])],
      });
    }
    this.commandMaps = cloneRawBlocks(bundle.commandMaps ?? []);
    this.creditsBlocks = cloneRawBlocks(bundle.creditsBlocks ?? []);
    this.mouseBlocks = cloneRawBlocks(bundle.mouseBlocks ?? []);
    this.mouseCursors = cloneRawBlocks(bundle.mouseCursors ?? []);
    this.multiplayerColors = cloneRawBlocks(bundle.multiplayerColors ?? []);
    this.multiplayerStartingMoneyChoices = cloneRawBlocks(bundle.multiplayerStartingMoneyChoices ?? []);
    this.onlineChatColorBlocks = cloneRawBlocks(bundle.onlineChatColorBlocks ?? []);
    this.waterTransparencyBlocks = cloneRawBlocks(bundle.waterTransparencyBlocks ?? []);
    this.challengeGeneralsBlocks = cloneRawBlocks(bundle.challengeGeneralsBlocks ?? []);
    this.miscAudio = bundle.miscAudio
      ? {
          entries: { ...bundle.miscAudio.entries },
          guiClickSoundName: bundle.miscAudio.guiClickSoundName,
          noCanDoSoundName: bundle.miscAudio.noCanDoSoundName,
        }
      : undefined;

    this.errors.push(...bundle.errors);
    this.ai = bundle.ai ? { ...bundle.ai } : undefined;
    this.audioSettings = bundle.audioSettings ? { ...bundle.audioSettings } : undefined;
    this.gameData = bundle.gameData
      ? {
          weaponBonusEntries: [...bundle.gameData.weaponBonusEntries],
          healthBonuses: bundle.gameData.healthBonuses
            ? ([...bundle.gameData.healthBonuses] as [number, number, number, number])
            : [1.0, 1.0, 1.0, 1.0],
        }
      : undefined;
    for (const unsupported of bundle.unsupportedBlockTypes) {
      this.unsupportedBlockTypes.add(unsupported);
    }
  }

  /** Get all objects matching a KindOf flag. */
  getObjectsByKind(kind: string): ObjectDef[] {
    const results: ObjectDef[] = [];
    for (const obj of this.objects.values()) {
      if (obj.kindOf?.includes(kind)) {
        results.push(obj);
      }
    }
    return results;
  }

  /** Get all objects for a given side (America, China, GLA). */
  getObjectsBySide(side: string): ObjectDef[] {
    const results: ObjectDef[] = [];
    for (const obj of this.objects.values()) {
      if (obj.side === side) {
        results.push(obj);
      }
    }
    return results;
  }

  getObject(name: string): ObjectDef | undefined {
    return this.objects.get(name);
  }

  getWeapon(name: string): WeaponDef | undefined {
    return this.weapons.get(name);
  }

  getArmor(name: string): ArmorDef | undefined {
    return this.armors.get(name);
  }

  getUpgrade(name: string): UpgradeDef | undefined {
    return this.upgrades.get(name);
  }

  getScience(name: string): ScienceDef | undefined {
    return this.sciences.get(name);
  }

  getFaction(name: string): FactionDef | undefined {
    return this.factions.get(name);
  }

  getSpecialPower(name: string): SpecialPowerDef | undefined {
    return this.specialPowers.get(name.toUpperCase());
  }

  getObjectCreationList(name: string): ObjectCreationListDef | undefined {
    return this.objectCreationLists.get(name);
  }

  getAiConfig(): AiConfig | undefined {
    return this.ai ? { ...this.ai } : undefined;
  }

  getGameData(): GameDataConfig | undefined {
    return this.gameData
      ? {
          weaponBonusEntries: [...this.gameData.weaponBonusEntries],
          healthBonuses: [...this.gameData.healthBonuses] as [number, number, number, number],
        }
      : undefined;
  }

  getAudioSettings(): AudioSettingsConfig | undefined {
    return this.audioSettings ? { ...this.audioSettings } : undefined;
  }

  getLocomotor(name: string): LocomotorDef | undefined {
    return this.locomotors.get(name);
  }

  getAudioEvent(name: string): AudioEventDef | undefined {
    return this.audioEvents.get(name);
  }

  getCommandButton(name: string): CommandButtonDef | undefined {
    return this.commandButtons.get(name);
  }

  getCommandSet(name: string): CommandSetDef | undefined {
    return this.commandSets.get(name);
  }

  getParticleSystem(name: string): RawBlockDef | undefined {
    return this.particleSystems.get(name);
  }

  getFXList(name: string): RawBlockDef | undefined {
    return this.fxLists.get(name);
  }

  getStaticGameLOD(name: string): RawBlockDef | undefined {
    return this.staticGameLODs.get(name);
  }

  getDynamicGameLOD(name: string): RawBlockDef | undefined {
    return this.dynamicGameLODs.get(name);
  }

  getCommandMaps(): RawBlockDef[] {
    return cloneRawBlocks(this.commandMaps);
  }

  getCommandMap(name: string): RawBlockDef | undefined {
    return findLastRawBlockByName(this.commandMaps, name);
  }

  getCreditsBlocks(): RawBlockDef[] {
    return cloneRawBlocks(this.creditsBlocks);
  }

  getMouseBlocks(): RawBlockDef[] {
    return cloneRawBlocks(this.mouseBlocks);
  }

  getMouseCursors(): RawBlockDef[] {
    return cloneRawBlocks(this.mouseCursors);
  }

  getMouseCursor(name: string): RawBlockDef | undefined {
    return findLastRawBlockByName(this.mouseCursors, name);
  }

  getMultiplayerColors(): RawBlockDef[] {
    return cloneRawBlocks(this.multiplayerColors);
  }

  getMultiplayerColor(name: string): RawBlockDef | undefined {
    return findLastRawBlockByName(this.multiplayerColors, name);
  }

  getMultiplayerStartingMoneyChoices(): RawBlockDef[] {
    return cloneRawBlocks(this.multiplayerStartingMoneyChoices);
  }

  getOnlineChatColorBlocks(): RawBlockDef[] {
    return cloneRawBlocks(this.onlineChatColorBlocks);
  }

  getWaterTransparencyBlocks(): RawBlockDef[] {
    return cloneRawBlocks(this.waterTransparencyBlocks);
  }

  getChallengeGeneralsBlocks(): RawBlockDef[] {
    return cloneRawBlocks(this.challengeGeneralsBlocks);
  }

  /**
   * Categorize music tracks (soundType === 'music') by name pattern.
   * Names containing Menu/Shell -> menu, Ambient -> ambient, Battle/Score -> battle.
   */
  getMusicTracksByType(): MusicTracksByType {
    const menu: string[] = [];
    const ambient: string[] = [];
    const battle: string[] = [];

    for (const [name, def] of this.audioEvents) {
      if (def.soundType !== 'music') continue;
      const upper = name.toUpperCase();
      if (upper.includes('MENU') || upper.includes('SHELL')) {
        menu.push(name);
      } else if (upper.includes('AMBIENT')) {
        ambient.push(name);
      } else if (upper.includes('BATTLE') || upper.includes('SCORE')) {
        battle.push(name);
      }
    }

    // Sort for deterministic ordering
    menu.sort();
    ambient.sort();
    battle.sort();

    return { menu, ambient, battle };
  }

  getMiscAudio(): MiscAudioDef | undefined {
    if (!this.miscAudio) {
      return undefined;
    }
    return {
      entries: { ...this.miscAudio.entries },
      guiClickSoundName: this.miscAudio.guiClickSoundName,
      noCanDoSoundName: this.miscAudio.noCanDoSoundName,
    };
  }

  /** Get summary statistics. */
  getStats(): RegistryStats {
    return {
      objects: this.objects.size,
      weapons: this.weapons.size,
      armors: this.armors.size,
      upgrades: this.upgrades.size,
      sciences: this.sciences.size,
      factions: this.factions.size,
      audioEvents: this.audioEvents.size,
      commandButtons: this.commandButtons.size,
      commandSets: this.commandSets.size,
      particleSystems: this.particleSystems.size,
      fxLists: this.fxLists.size,
      staticGameLODs: this.staticGameLODs.size,
      dynamicGameLODs: this.dynamicGameLODs.size,
      unresolvedInheritance: this.getUnresolvedInheritanceCount(),
      totalBlocks: this.objects.size + this.weapons.size + this.armors.size +
        this.upgrades.size + this.sciences.size + this.factions.size + this.locomotors.size +
        this.audioEvents.size +
        this.commandButtons.size + this.commandSets.size +
        this.particleSystems.size + this.fxLists.size +
        this.staticGameLODs.size + this.dynamicGameLODs.size +
        this.commandMaps.length + this.creditsBlocks.length + this.mouseBlocks.length +
        this.mouseCursors.length + this.multiplayerColors.length +
        this.multiplayerStartingMoneyChoices.length + this.onlineChatColorBlocks.length +
        this.waterTransparencyBlocks.length + this.challengeGeneralsBlocks.length,
    };
  }

  /** Get unsupported block types encountered during loading. */
  getUnsupportedBlockTypes(): string[] {
    return [...this.unsupportedBlockTypes].sort();
  }

  /** Export a deterministic compatibility-friendly bundle. */
  toBundle(): IniDataBundle {
    const stats = this.getStats();

    return {
      objects: [...this.objects.values()].sort((a, b) => a.name.localeCompare(b.name)),
      weapons: [...this.weapons.values()].sort((a, b) => a.name.localeCompare(b.name)),
      armors: [...this.armors.values()].sort((a, b) => a.name.localeCompare(b.name)),
      upgrades: [...this.upgrades.values()].sort((a, b) => a.name.localeCompare(b.name)),
      sciences: [...this.sciences.values()].sort((a, b) => a.name.localeCompare(b.name)),
      factions: [...this.factions.values()].sort((a, b) => a.name.localeCompare(b.name)),
      specialPowers: [...this.specialPowers.values()].sort((a, b) => a.name.localeCompare(b.name)),
      objectCreationLists: [...this.objectCreationLists.values()]
        .sort((a, b) => a.name.localeCompare(b.name)),
      locomotors: [...this.locomotors.values()].sort((a, b) => a.name.localeCompare(b.name)),
      audioEvents: [...this.audioEvents.values()].sort((a, b) => a.name.localeCompare(b.name)),
      miscAudio: this.miscAudio
        ? {
            entries: { ...this.miscAudio.entries },
            guiClickSoundName: this.miscAudio.guiClickSoundName,
            noCanDoSoundName: this.miscAudio.noCanDoSoundName,
          }
        : undefined,
      commandButtons: [...this.commandButtons.values()].sort((a, b) => a.name.localeCompare(b.name)),
      commandSets: [...this.commandSets.values()].sort((a, b) => a.name.localeCompare(b.name)),
      particleSystems: [...this.particleSystems.values()].sort((a, b) => a.name.localeCompare(b.name)),
      fxLists: [...this.fxLists.values()].sort((a, b) => a.name.localeCompare(b.name)),
      staticGameLODs: [...this.staticGameLODs.values()].sort((a, b) => a.name.localeCompare(b.name)),
      dynamicGameLODs: [...this.dynamicGameLODs.values()].sort((a, b) => a.name.localeCompare(b.name)),
      commandMaps: cloneRawBlocks(this.commandMaps),
      creditsBlocks: cloneRawBlocks(this.creditsBlocks),
      mouseBlocks: cloneRawBlocks(this.mouseBlocks),
      mouseCursors: cloneRawBlocks(this.mouseCursors),
      multiplayerColors: cloneRawBlocks(this.multiplayerColors),
      multiplayerStartingMoneyChoices: cloneRawBlocks(this.multiplayerStartingMoneyChoices),
      onlineChatColorBlocks: cloneRawBlocks(this.onlineChatColorBlocks),
      waterTransparencyBlocks: cloneRawBlocks(this.waterTransparencyBlocks),
      challengeGeneralsBlocks: cloneRawBlocks(this.challengeGeneralsBlocks),
      ai: this.ai ? { ...this.ai } : undefined,
      audioSettings: this.audioSettings ? { ...this.audioSettings } : undefined,
      gameData: this.gameData
        ? {
            weaponBonusEntries: [...this.gameData.weaponBonusEntries],
            healthBonuses: [...this.gameData.healthBonuses] as [number, number, number, number],
          }
        : undefined,
      stats,
      errors: [...this.errors],
      unsupportedBlockTypes: this.getUnsupportedBlockTypes(),
    };
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private indexBlock(block: IniBlock, sourcePath?: string): void {
    const addDefinition = <T extends { name: string }>(
      collection: Map<string, T>,
      blockType: string,
      definition: T,
    ): void => {
      if (collection.has(definition.name)) {
        this.errors.push({
          type: 'duplicate',
          blockType,
          name: definition.name,
          detail: `Duplicate definition for ${blockType} "${definition.name}" in ${sourcePath ?? 'unknown source'}`,
          file: sourcePath,
        });
      }
      collection.set(definition.name, definition);
    };
    const appendRawBlock = (collection: RawBlockDef[]): void => {
      collection.push(cloneRawBlock({
        name: block.name,
        fields: block.fields,
        blocks: block.blocks,
      }));
    };

    switch (block.type) {
      case 'Object':
      case 'ChildObject':
      case 'ObjectReskin':
        addDefinition(this.objects, block.type, {
          name: block.name,
          parent: block.parent,
          side: extractString(block.fields['Side']),
          kindOf: extractStringArray(block.fields['KindOf']),
          fields: block.fields,
          blocks: block.blocks,
          resolved: !block.parent,
        });
        break;

      case 'Weapon':
        addDefinition(this.weapons, block.type, {
          name: block.name,
          parent: block.parent,
          fields: block.fields,
          blocks: block.blocks,
          resolved: !block.parent,
        });
        break;

      case 'Armor':
        addDefinition(this.armors, block.type, {
          name: block.name,
          fields: block.fields,
        });
        break;

      case 'Upgrade':
        addDefinition(this.upgrades, block.type, {
          name: block.name,
          fields: block.fields,
          blocks: block.blocks,
          kindOf: extractStringArray(block.fields['KindOf']),
        });
        break;

      case 'Science':
        addDefinition(this.sciences, block.type, {
          name: block.name,
          fields: block.fields,
        });
        break;

      case 'PlayerTemplate':
      case 'Faction':
        addDefinition(this.factions, block.type, {
          name: block.name,
          side: extractString(block.fields['Side']),
          fields: block.fields,
        });
        break;

      case 'Locomotor':
        addDefinition(this.locomotors, block.type, {
          name: block.name,
          fields: block.fields,
          surfaces: extractLocomotorSurfaces(block.fields['Surfaces']),
          surfaceMask: locomotorSurfaceMaskFromNames(extractLocomotorSurfaces(block.fields['Surfaces'])),
          downhillOnly: extractBoolean(block.fields['DownhillOnly']) ?? false,
          speed: extractNumber(block.fields['Speed']) ?? 0,
        });
        break;

      case 'CommandButton':
        addDefinition(this.commandButtons, block.type, {
          name: block.name,
          fields: block.fields,
          blocks: block.blocks,
          commandTypeName: extractTokenString(block.fields['Command']),
          options: extractOptions(block.fields['Options']),
          unitSpecificSoundName: extractAudioEventName(block.fields['UnitSpecificSound']),
        });
        break;

      case 'CommandSet': {
        const slottedButtons = extractCommandSetButtonSlots(block.fields);
        addDefinition(this.commandSets, block.type, {
          name: block.name,
          fields: block.fields,
          buttons: slottedButtons.map((entry) => entry.commandButtonName),
          slottedButtons,
        });
        break;
      }

      case 'SpecialPower':
        addDefinition(this.specialPowers, block.type, {
          name: block.name.toUpperCase(),
          parent: block.parent,
          fields: block.fields,
          blocks: block.blocks,
          resolved: !block.parent,
        });
        break;

      case 'ObjectCreationList':
        addDefinition(this.objectCreationLists, block.type, {
          name: block.name,
          parent: block.parent,
          fields: block.fields,
          blocks: block.blocks,
          resolved: !block.parent,
        });
        break;

      case 'AudioEvent':
      case 'MusicTrack':
      case 'DialogEvent':
        addDefinition(this.audioEvents, block.type, {
          name: block.name,
          fields: block.fields,
          blocks: block.blocks,
          soundType: audioEventSoundTypeFromBlockType(block.type),
          priorityName: extractTokenString(block.fields['Priority'])?.toUpperCase(),
          typeNames: extractOptions(block.fields['Type']),
          controlNames: extractOptions(block.fields['Control']),
          volume: extractPercentToReal(block.fields['Volume']),
          minVolume: extractPercentToReal(block.fields['MinVolume']),
          limit: extractInteger(block.fields['Limit']),
          minRange: extractNumber(block.fields['MinRange']),
          maxRange: extractNumber(block.fields['MaxRange']),
          filename: extractTokenString(block.fields['Filename']) ?? extractTokenString(block.fields['Sounds']),
        });
        break;

      case 'MiscAudio': {
        const entries = {
          ...(this.miscAudio?.entries ?? {}),
          ...extractAudioEventEntries(block.fields),
        };
        this.miscAudio = {
          entries,
          guiClickSoundName: entries['GUIClickSound'],
          noCanDoSoundName: entries['NoCanDoSound'],
        };
        break;
      }

      case 'GameData':
        this.indexGameDataBlock(block);
        break;

      case 'ParticleSystem':
        addDefinition(this.particleSystems, block.type, {
          name: block.name,
          fields: block.fields,
          blocks: block.blocks,
        });
        break;

      case 'FXList':
        addDefinition(this.fxLists, block.type, {
          name: block.name,
          fields: block.fields,
          blocks: block.blocks,
        });
        break;

      case 'StaticGameLOD':
        addDefinition(this.staticGameLODs, block.type, {
          name: block.name,
          fields: block.fields,
          blocks: block.blocks,
        });
        break;

      case 'DynamicGameLOD':
        addDefinition(this.dynamicGameLODs, block.type, {
          name: block.name,
          fields: block.fields,
          blocks: block.blocks,
        });
        break;

      case 'CommandMap':
        appendRawBlock(this.commandMaps);
        break;

      case 'Credits':
        appendRawBlock(this.creditsBlocks);
        break;

      case 'Mouse':
        appendRawBlock(this.mouseBlocks);
        break;

      case 'MouseCursor':
        appendRawBlock(this.mouseCursors);
        break;

      case 'MultiplayerColor':
        appendRawBlock(this.multiplayerColors);
        break;

      case 'MultiplayerStartingMoneyChoice':
        appendRawBlock(this.multiplayerStartingMoneyChoices);
        break;

      case 'OnlineChatColors':
        appendRawBlock(this.onlineChatColorBlocks);
        break;

      case 'WaterTransparency':
        appendRawBlock(this.waterTransparencyBlocks);
        break;

      case 'ChallengeGenerals':
        appendRawBlock(this.challengeGeneralsBlocks);
        break;

      // Known but not indexed block types — skip silently
      case 'DamageFX':
      case 'Multisound':
      case 'EvaEvent':
      case 'MappedImage':
      case 'Animation':
      case 'Terrain':
      case 'Road':
      case 'Bridge':
      case 'Weather':
      case 'WaterSet':
      case 'SkyboxTextureSet':
      case 'Video':
      case 'Campaign':
      case 'Mission':
      case 'CrateData':
      case 'ExperienceLevel':
      case 'ModifierList':
      case 'MultiplayerSettings':
      case 'DrawGroupInfo':
      case 'WindowTransition':
      case 'HeaderTemplate':
      case 'WebpageURL':
      case 'InGameUI':
      case 'ControlBarScheme':
      case 'ControlBarResizer':
      case 'ShellMenuScheme':
      case 'LocomotorSet':
      case 'ClientBehavior':
      case 'ClientUpdate':
      case 'WeaponSet':
      case 'Draw':
      case 'Body':
      case 'ArmorSet':
      case 'AI':
      case 'AIData':
        this.indexAiBlock(block);
        break;

      case 'AudioSettings':
        this.audioSettings = {
          ...this.audioSettings,
          sampleCount2D: extractInteger(block.fields['SampleCount2D']) ?? this.audioSettings?.sampleCount2D,
          sampleCount3D: extractInteger(block.fields['SampleCount3D']) ?? this.audioSettings?.sampleCount3D,
          streamCount: extractInteger(block.fields['StreamCount']) ?? this.audioSettings?.streamCount,
          minSampleVolume:
            extractPercentToReal(block.fields['MinSampleVolume']) ?? this.audioSettings?.minSampleVolume,
          globalMinRange: extractInteger(block.fields['GlobalMinRange']) ?? this.audioSettings?.globalMinRange,
          globalMaxRange: extractInteger(block.fields['GlobalMaxRange']) ?? this.audioSettings?.globalMaxRange,
          relative2DVolume:
            extractSignedPercentToReal(block.fields['Relative2DVolume']) ?? this.audioSettings?.relative2DVolume,
          defaultSoundVolume:
            extractPercentToReal(block.fields['DefaultSoundVolume']) ?? this.audioSettings?.defaultSoundVolume,
          default3DSoundVolume:
            extractPercentToReal(block.fields['Default3DSoundVolume']) ?? this.audioSettings?.default3DSoundVolume,
          defaultSpeechVolume:
            extractPercentToReal(block.fields['DefaultSpeechVolume']) ?? this.audioSettings?.defaultSpeechVolume,
          defaultMusicVolume:
            extractPercentToReal(block.fields['DefaultMusicVolume']) ?? this.audioSettings?.defaultMusicVolume,
        };
        break;

      default:
        this.unsupportedBlockTypes.add(block.type);
        this.errors.push({
          type: 'unsupported_block',
          blockType: block.type,
          name: block.name,
          detail: `Unsupported block type: ${block.type}`,
          file: sourcePath,
        });
        break;
    }
  }

  /**
   * Source parity: GlobalData::parseGameDataDefinition — extract WeaponBonus entries
   * and HealthBonus fields from the GameData INI block.
   * WeaponBonus format: `WeaponBonus = CONDITION FIELD PERCENT%`.
   * HealthBonus format: `HealthBonus_Veteran = 120%` (parsePercentToReal, no clamping).
   */
  private indexGameDataBlock(block: IniBlock): void {
    // ── Health bonuses (source parity: GlobalData.cpp:404-406, m_healthBonus[]) ──
    // C++ default is 1.0 for all levels. REGULAR is always 1.0 (commented out in C++).
    const prevBonuses = this.gameData?.healthBonuses ?? [1.0, 1.0, 1.0, 1.0];
    const healthBonuses: [number, number, number, number] = [...prevBonuses];

    const veteranBonus = extractUnclampedPercentToReal(block.fields['HealthBonus_Veteran']);
    if (veteranBonus !== undefined) healthBonuses[1] = veteranBonus;

    const eliteBonus = extractUnclampedPercentToReal(block.fields['HealthBonus_Elite']);
    if (eliteBonus !== undefined) healthBonuses[2] = eliteBonus;

    const heroicBonus = extractUnclampedPercentToReal(block.fields['HealthBonus_Heroic']);
    if (heroicBonus !== undefined) healthBonuses[3] = heroicBonus;

    // ── Weapon bonuses ──
    const entries: WeaponBonusEntry[] = this.gameData?.weaponBonusEntries
      ? [...this.gameData.weaponBonusEntries]
      : [];

    const weaponBonusValue = block.fields['WeaponBonus'];
    if (weaponBonusValue) {
      const lines = Array.isArray(weaponBonusValue) ? weaponBonusValue : [weaponBonusValue];
      for (const line of lines) {
        const tokens = String(line).trim().split(/\s+/);
        if (tokens.length < 3) continue;
        const condition = tokens[0]!.toUpperCase();
        const field = tokens[1]!.toUpperCase();
        const rawPercent = tokens[2]!;
        // Source parity: INI::scanPercentToReal — "125%" → 1.25 (no clamping).
        const percentStr = rawPercent.endsWith('%') ? rawPercent.slice(0, -1) : rawPercent;
        const multiplier = Number(percentStr) / 100;
        if (Number.isFinite(multiplier)) {
          entries.push({ condition, field, multiplier });
        }
      }
    }

    this.gameData = { weaponBonusEntries: entries, healthBonuses };
  }

  private resolveObjectChain(name: string, visited: Set<string>): ObjectDef | undefined {
    return this.resolveInheritedDefinitionChain(
      this.objects,
      'Object',
      name,
      visited,
      (obj, parent) => {
        // Inherit side and kindOf if not set
        if (!obj.side && parent.side) {
          obj.side = parent.side;
        }
        if (!obj.kindOf && parent.kindOf) {
          obj.kindOf = parent.kindOf;
        }
      },
    );
  }

  private resolveWeaponChain(name: string, visited: Set<string>): WeaponDef | undefined {
    return this.resolveInheritedDefinitionChain(this.weapons, 'Weapon', name, visited);
  }

  private resolveSpecialPowerChain(name: string, visited: Set<string>): SpecialPowerDef | undefined {
    return this.resolveInheritedDefinitionChain(this.specialPowers, 'SpecialPower', name, visited);
  }

  private resolveObjectCreationListChain(
    name: string,
    visited: Set<string>,
  ): ObjectCreationListDef | undefined {
    return this.resolveInheritedDefinitionChain(this.objectCreationLists, 'ObjectCreationList', name, visited);
  }

  private findCollectionEntryCaseInsensitive<T>(
    collection: Map<string, T>,
    name: string,
  ): [string, T] | undefined {
    const direct = collection.get(name);
    if (direct) {
      return [name, direct];
    }
    const normalizedName = name.trim().toUpperCase();
    if (!normalizedName) {
      return undefined;
    }
    for (const entry of collection.entries()) {
      if (entry[0].toUpperCase() === normalizedName) {
        return entry;
      }
    }
    return undefined;
  }

  private resolveInheritedDefinitionChain<
    T extends {
      name: string;
      parent?: string;
      fields: Record<string, IniValue>;
      blocks: IniBlock[];
      resolved?: boolean;
      hasUnresolvedParent?: boolean;
    },
  >(
    collection: Map<string, T>,
    blockType: string,
    name: string,
    visited: Set<string>,
    mergeExtras?: (child: T, parent: T) => void,
  ): T | undefined {
    const entry = this.findCollectionEntryCaseInsensitive(collection, name);
    if (!entry) {
      return undefined;
    }
    const [resolvedName, definition] = entry;
    if (definition.resolved) {
      return definition;
    }

    if (visited.has(resolvedName)) {
      definition.hasUnresolvedParent = true;
      definition.resolved = true;
      this.errors.push({
        type: 'unresolved_parent',
        blockType,
        name: definition.name,
        detail: 'Circular inheritance detected',
      });
      return definition;
    }

    visited.add(resolvedName);
    try {
      if (!definition.parent) {
        definition.resolved = true;
        definition.hasUnresolvedParent = false;
        return definition;
      }

      const parentEntry = this.findCollectionEntryCaseInsensitive(collection, definition.parent);
      if (!parentEntry) {
        definition.hasUnresolvedParent = true;
        definition.resolved = true;
        this.errors.push({
          type: 'unresolved_parent',
          blockType,
          name: definition.name,
          detail: `Parent "${definition.parent}" not found`,
        });
        return definition;
      }

      const [parentName] = parentEntry;
      const parent = this.resolveInheritedDefinitionChain(collection, blockType, parentName, visited, mergeExtras);
      if (!parent) {
        definition.hasUnresolvedParent = true;
        definition.resolved = true;
        this.errors.push({
          type: 'unresolved_parent',
          blockType,
          name: definition.name,
          detail: `Parent "${definition.parent}" not found`,
        });
        return definition;
      }

      // Merge: parent fields are defaults, child fields override.
      definition.fields = { ...parent.fields, ...definition.fields };
      definition.blocks = [...parent.blocks, ...definition.blocks];
      mergeExtras?.(definition, parent);

      definition.resolved = true;
      definition.hasUnresolvedParent = parent.hasUnresolvedParent ?? false;
      return definition;
    } finally {
      visited.delete(resolvedName);
    }
  }

  private getUnresolvedInheritanceCount(): number {
    let count = 0;
    for (const obj of this.objects.values()) {
      if (obj.hasUnresolvedParent) count++;
    }
    for (const weapon of this.weapons.values()) {
      if (weapon.hasUnresolvedParent) count++;
    }
    for (const specialPower of this.specialPowers.values()) {
      if (specialPower.hasUnresolvedParent) count++;
    }
    for (const objectCreationList of this.objectCreationLists.values()) {
      if (objectCreationList.hasUnresolvedParent) count++;
    }
    return count;
  }

  private indexAiBlock(block: IniBlock): void {
    this.ai = {
      ...this.ai,
      attackUsesLineOfSight: extractBoolean(block.fields['AttackUsesLineOfSight']) ??
        this.ai?.attackUsesLineOfSight,
      skirmishBaseDefenseExtraDistance:
        extractNumber(block.fields['SkirmishBaseDefenseExtraDistance']) ??
        this.ai?.skirmishBaseDefenseExtraDistance,
      resourcesWealthy: extractInteger(block.fields['Wealthy']) ?? this.ai?.resourcesWealthy,
      resourcesPoor: extractInteger(block.fields['Poor']) ?? this.ai?.resourcesPoor,
      guardInnerModifierAI:
        extractNumber(block.fields['GuardInnerModifierAI']) ?? this.ai?.guardInnerModifierAI,
      guardOuterModifierAI:
        extractNumber(block.fields['GuardOuterModifierAI']) ?? this.ai?.guardOuterModifierAI,
      guardInnerModifierHuman:
        extractNumber(block.fields['GuardInnerModifierHuman']) ?? this.ai?.guardInnerModifierHuman,
      guardOuterModifierHuman:
        extractNumber(block.fields['GuardOuterModifierHuman']) ?? this.ai?.guardOuterModifierHuman,
      guardChaseUnitFrames:
        extractDurationFrames(block.fields['GuardChaseUnitsDuration']) ?? this.ai?.guardChaseUnitFrames,
      guardEnemyScanRateFrames:
        extractDurationFrames(block.fields['GuardEnemyScanRate']) ?? this.ai?.guardEnemyScanRateFrames,
      guardEnemyReturnScanRateFrames:
        extractDurationFrames(block.fields['GuardEnemyReturnScanRate']) ??
        this.ai?.guardEnemyReturnScanRateFrames,
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MAX_COMMAND_SET_SLOTS = 12;

function extractString(value: IniValue | undefined): string | undefined {
  if (typeof value === 'string') return value;
  return undefined;
}

function extractTokenString(value: IniValue | undefined): string | undefined {
  if (typeof value === 'undefined') {
    return undefined;
  }
  const tokens = flattenIniStrings(value)
    .flatMap((entry) => entry.split(/[\s,;|]+/))
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (tokens.length === 0) {
    return undefined;
  }
  return tokens[0];
}

function extractAudioEventName(value: IniValue | undefined): string | undefined {
  const token = extractTokenString(value);
  if (!token) {
    return undefined;
  }
  if (token.toLowerCase() === 'nosound') {
    return undefined;
  }
  return token;
}

function extractOptions(value: IniValue | undefined): string[] {
  if (typeof value === 'undefined') {
    return [];
  }

  return flattenIniStrings(value)
    .flatMap((entry) => entry.split(/[\s,;|]+/))
    .map((entry) => entry.trim().toUpperCase())
    .filter(Boolean);
}

function extractAudioEventEntries(fields: Record<string, IniValue>): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const [fieldName, value] of Object.entries(fields)) {
    const eventName = extractAudioEventName(value);
    if (!eventName) {
      continue;
    }
    entries[fieldName] = eventName;
  }
  return entries;
}

function normalizeCommandSetButtonSlots(slottedButtons: readonly CommandSetButtonSlot[]): CommandSetButtonSlot[] {
  return slottedButtons
    .filter((entry) =>
      Number.isInteger(entry.slot) &&
      entry.slot >= 1 &&
      entry.slot <= MAX_COMMAND_SET_SLOTS &&
      typeof entry.commandButtonName === 'string' &&
      entry.commandButtonName.trim().length > 0,
    )
    .map((entry) => ({
      slot: entry.slot,
      commandButtonName: entry.commandButtonName.trim(),
    }))
    .sort((a, b) => a.slot - b.slot);
}

function cloneRawBlock(block: RawBlockDef): RawBlockDef {
  return {
    name: block.name,
    fields: { ...block.fields },
    blocks: [...block.blocks],
  };
}

function cloneRawBlocks(blocks: readonly RawBlockDef[]): RawBlockDef[] {
  return blocks.map((block) => cloneRawBlock(block));
}

function findLastRawBlockByName(blocks: readonly RawBlockDef[], name: string): RawBlockDef | undefined {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (block?.name === name) {
      return cloneRawBlock(block);
    }
  }
  return undefined;
}

function extractCommandSetButtonSlots(fields: Record<string, IniValue>): CommandSetButtonSlot[] {
  const entries = Object.entries(fields)
    .map(([key, value]) => {
      const slot = Number(key);
      if (!Number.isInteger(slot) || slot <= 0 || slot > MAX_COMMAND_SET_SLOTS) {
        return null;
      }
      const commandButtonName = extractTokenString(value);
      if (!commandButtonName) {
        return null;
      }
      return { slot, commandButtonName };
    })
    .filter((entry): entry is { slot: number; commandButtonName: string } => entry !== null)
    .sort((a, b) => a.slot - b.slot);

  return entries;
}

function extractStringArray(value: IniValue | undefined): string[] | undefined {
  if (Array.isArray(value) && value.every((v) => typeof v === 'string')) {
    return value as string[];
  }
  return undefined;
}

function extractBoolean(value: IniValue | undefined): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === 'yes' || normalized === '1') return true;
    if (normalized === 'false' || normalized === 'no' || normalized === '0') return false;
  }
  return undefined;
}

function extractNumber(value: IniValue | undefined): number | undefined {
  const values = readNumericValues(value);
  if (values.length === 0) {
    return undefined;
  }
  const candidate = values[0];
  return Number.isFinite(candidate) ? candidate : undefined;
}

function extractInteger(value: IniValue | undefined): number | undefined {
  const numberValue = extractNumber(value);
  if (numberValue === undefined) {
    return undefined;
  }
  return Math.trunc(numberValue);
}

function extractDurationFrames(value: IniValue | undefined): number | undefined {
  const durationMs = extractNumber(value);
  if (durationMs === undefined) {
    return undefined;
  }
  return Math.max(0, Math.ceil(durationMs * 30 / 1000));
}

/**
 * Source parity: INI::parsePercentToReal — converts "120%" → 1.2 with NO clamping.
 * Unlike extractPercentToReal which clamps to [0,1], this preserves the raw value.
 * Used for health bonuses which are commonly > 100% (e.g., HealthBonus_Veteran = 120%).
 */
function extractUnclampedPercentToReal(value: IniValue | undefined): number | undefined {
  if (typeof value === 'undefined') return undefined;

  if (Array.isArray(value)) {
    for (const entry of value) {
      const parsed = extractUnclampedPercentToReal(entry as IniValue);
      if (parsed !== undefined) return parsed;
    }
    return undefined;
  }

  if (typeof value === 'string') {
    const token = value.trim();
    if (!token) return undefined;
    if (token.endsWith('%')) {
      const rawPercent = Number(token.slice(0, -1).trim());
      return Number.isFinite(rawPercent) ? rawPercent / 100 : undefined;
    }
    const parsed = Number(token);
    return Number.isFinite(parsed) ? (parsed > 1 ? parsed / 100 : parsed) : undefined;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? (value > 1 ? value / 100 : value) : undefined;
  }

  return undefined;
}

function extractPercentToReal(value: IniValue | undefined): number | undefined {
  if (typeof value === 'undefined') {
    return undefined;
  }

  if (typeof value === 'string') {
    const token = value.trim();
    if (!token) {
      return undefined;
    }
    if (token.endsWith('%')) {
      const rawPercent = Number(token.slice(0, -1).trim());
      if (!Number.isFinite(rawPercent)) {
        return undefined;
      }
      return Math.min(1, Math.max(0, rawPercent / 100));
    }
  }

  let numeric: number | undefined;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const parsed = extractPercentToReal(entry as IniValue);
      if (parsed !== undefined) {
        return parsed;
      }
    }
    return undefined;
  } else if (typeof value === 'number') {
    numeric = value;
  } else if (typeof value === 'boolean') {
    numeric = value ? 1 : 0;
  } else if (typeof value === 'string') {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return undefined;
    }
    numeric = parsed;
  }

  if (numeric === undefined || !Number.isFinite(numeric)) {
    return undefined;
  }

  const normalized = numeric > 1 ? numeric / 100 : numeric;
  return Math.min(1, Math.max(0, normalized));
}

function extractSignedPercentToReal(value: IniValue | undefined): number | undefined {
  if (typeof value === 'undefined') {
    return undefined;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const parsed = extractSignedPercentToReal(entry as IniValue);
      if (parsed !== undefined) {
        return parsed;
      }
    }
    return undefined;
  }

  let numeric: number | undefined;
  if (typeof value === 'string') {
    const token = value.trim();
    if (!token) {
      return undefined;
    }
    if (token.endsWith('%')) {
      const rawPercent = Number(token.slice(0, -1).trim());
      if (!Number.isFinite(rawPercent)) {
        return undefined;
      }
      numeric = rawPercent / 100;
    } else {
      const parsed = Number(token);
      if (!Number.isFinite(parsed)) {
        return undefined;
      }
      numeric = parsed > 1 || parsed < -1 ? parsed / 100 : parsed;
    }
  } else if (typeof value === 'number') {
    numeric = value > 1 || value < -1 ? value / 100 : value;
  } else if (typeof value === 'boolean') {
    numeric = value ? 1 : 0;
  }

  if (numeric === undefined || !Number.isFinite(numeric)) {
    return undefined;
  }

  return Math.min(1, Math.max(-1, numeric));
}

function readNumericValues(value: IniValue | undefined): number[] {
  if (typeof value === 'number') {
    return [value];
  }
  if (typeof value === 'boolean') {
    return [value ? 1 : 0];
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return [parsed];
    }
    return value.split(/[\s,;|]+/)
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => Number(part))
      .filter((entry) => Number.isFinite(entry));
  }
  if (Array.isArray(value)) {
    return value
      .flatMap((entry) => readNumericValues(entry as IniValue))
      .filter((entry) => Number.isFinite(entry));
  }
  return [];
}

function extractLocomotorSurfaces(value: IniValue | undefined): string[] {
  if (!value) {
    return [];
  }
  const tokens = flattenIniStrings(value)
    .flatMap((token) => token.split(/[\s,;|]+/))
    .map((token) => token.trim().toUpperCase())
    .filter(Boolean);
  return Array.from(new Set(tokens));
}

function flattenIniStrings(value: IniValue): string[] {
  if (typeof value === 'string') return [value];
  if (typeof value === 'number' || typeof value === 'boolean') return [String(value)];
  if (Array.isArray(value)) {
    return value.flatMap((entry) => flattenIniStrings(entry as IniValue));
  }
  return [];
}

function locomotorSurfaceMaskFromNames(names: string[]): number {
  let mask = 0;
  for (const name of names) {
    switch (name) {
      case 'GROUND':
        mask |= 1 << 0;
        break;
      case 'WATER':
        mask |= 1 << 1;
        break;
      case 'CLIFF':
        mask |= 1 << 2;
        break;
      case 'AIR':
        mask |= 1 << 3;
        break;
      case 'RUBBLE':
        mask |= 1 << 4;
        break;
      default:
        break;
    }
  }
  return mask;
}

function audioEventSoundTypeFromBlockType(blockType: string): AudioEventSoundType {
  switch (blockType) {
    case 'MusicTrack':
      return 'music';
    case 'DialogEvent':
      return 'streaming';
    case 'AudioEvent':
    default:
      return 'sound';
  }
}
