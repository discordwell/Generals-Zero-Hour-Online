/**
 * Shared test helpers — reusable builders for INI data structures, maps, and registries.
 *
 * All test files that need to construct game bundles, registries, heightmaps, or map
 * objects should import from this module instead of defining local copies.
 */

import type { IniBlock } from '@generals/core';
import type { InputState } from '@generals/input';
import {
  DEFAULT_AI_CONFIG,
  type AiConfig,
  type AudioEventDef,
  type ArmorDef,
  type CommandButtonDef,
  type CommandSetDef,
  type FactionDef,
  type GameDataConfig,
  IniDataRegistry,
  type IniDataBundle,
  type LocomotorDef,
  type ObjectDef,
  type ScienceDef,
  type SpecialPowerDef,
  type UpgradeDef,
  type WeaponDef,
} from '@generals/ini-data';
import { HeightmapGrid, type MapDataJSON, type MapObjectJSON, uint8ArrayToBase64 } from '@generals/terrain';

// ── INI block builders ──────────────────────────────────────────────────────

export function makeBlock(
  type: string,
  name: string,
  fields: Record<string, unknown>,
  blocks: IniBlock[] = [],
): IniBlock {
  return {
    type,
    name,
    fields: fields as Record<string, string | number | boolean | string[] | number[]>,
    blocks,
  };
}

export function makeObjectDef(
  name: string,
  side: string,
  kindOf: string[],
  blocks: IniBlock[],
  fields: Record<string, unknown> = {},
): ObjectDef {
  return {
    name,
    side,
    kindOf,
    fields: fields as Record<string, string | number | boolean | string[] | number[]>,
    blocks,
    resolved: true,
  };
}

export function makeWeaponDef(name: string, fields: Record<string, unknown>): WeaponDef {
  return {
    name,
    fields: fields as Record<string, string | number | boolean | string[] | number[]>,
    blocks: [],
  };
}

export function makeArmorDef(name: string, fields: Record<string, unknown>): ArmorDef {
  return {
    name,
    fields: fields as Record<string, string | number | boolean | string[] | number[]>,
  };
}

export function makeLocomotorDef(name: string, speed: number): LocomotorDef {
  return {
    name,
    fields: { Speed: speed },
    surfaces: ['GROUND'],
    surfaceMask: 1,
    downhillOnly: false,
    speed,
  };
}

export function makeUpgradeDef(name: string, fields: Record<string, unknown>): UpgradeDef {
  return {
    name,
    fields: fields as Record<string, string | number | boolean | string[] | number[]>,
  };
}

export function makeCommandButtonDef(name: string, fields: Record<string, unknown>): CommandButtonDef {
  return {
    name,
    fields: fields as Record<string, string | number | boolean | string[] | number[]>,
    blocks: [],
    options: [],
  };
}

export function makeCommandSetDef(name: string, fields: Record<string, unknown>): CommandSetDef {
  return {
    name,
    fields: fields as Record<string, string | number | boolean | string[] | number[]>,
    buttons: [],
  };
}

export function makeScienceDef(name: string, fields: Record<string, unknown>): ScienceDef {
  return {
    name,
    fields: fields as Record<string, string | number | boolean | string[] | number[]>,
  };
}

export function makeAudioEventDef(
  name: string,
  fields: Record<string, unknown> = {},
  options: {
    soundType?: AudioEventDef['soundType'];
    typeNames?: string[];
    controlNames?: string[];
    priorityName?: string;
    volume?: number;
    minVolume?: number;
    minRange?: number;
    maxRange?: number;
  } = {},
): AudioEventDef {
  return {
    name,
    fields: fields as Record<string, string | number | boolean | string[] | number[]>,
    blocks: [],
    soundType: options.soundType ?? 'sound',
    typeNames: options.typeNames ? [...options.typeNames] : ['WORLD'],
    controlNames: options.controlNames ? [...options.controlNames] : [],
    priorityName: options.priorityName,
    volume: options.volume,
    minVolume: options.minVolume,
    minRange: options.minRange,
    maxRange: options.maxRange,
  };
}

export function makeSpecialPowerDef(name: string, fields: Record<string, unknown>): SpecialPowerDef {
  return {
    name,
    fields: fields as Record<string, string | number | boolean | string[] | number[]>,
    blocks: [],
  };
}

// ── Convenience compound builder ────────────────────────────────────────────

export function makeWeaponBlock(weaponName: string, slot: string = 'PRIMARY'): IniBlock {
  return makeBlock('WeaponSet', 'WeaponSet', { Weapon: [slot, weaponName] });
}

// ── Bundle / registry / map builders ────────────────────────────────────────

export function makeBundle(params: {
  objects: ObjectDef[];
  weapons?: WeaponDef[];
  armors?: ArmorDef[];
  upgrades?: UpgradeDef[];
  commandButtons?: CommandButtonDef[];
  commandSets?: CommandSetDef[];
  sciences?: ScienceDef[];
  specialPowers?: SpecialPowerDef[];
  locomotors?: LocomotorDef[];
  audioEvents?: AudioEventDef[];
  factions?: FactionDef[];
  ai?: Partial<AiConfig>;
  gameData?: GameDataConfig;
}): IniDataBundle {
  const weapons = params.weapons ?? [];
  const armors = params.armors ?? [];
  const upgrades = params.upgrades ?? [];
  const commandButtons = params.commandButtons ?? [];
  const commandSets = params.commandSets ?? [];
  const sciences = params.sciences ?? [];
  const specialPowers = params.specialPowers ?? [];
  const locomotors = params.locomotors ?? [];
  const audioEvents = params.audioEvents ?? [];
  const factions = params.factions ?? [];
  return {
    objects: params.objects,
    weapons,
    armors,
    upgrades,
    commandButtons,
    commandSets,
    sciences,
    specialPowers,
    factions,
    locomotors,
    audioEvents,
    ai: {
      ...DEFAULT_AI_CONFIG,
      ...params.ai,
    },
    gameData: params.gameData,
    stats: {
      objects: params.objects.length,
      weapons: weapons.length,
      armors: armors.length,
      upgrades: upgrades.length,
      sciences: sciences.length,
      factions: 0,
      audioEvents: audioEvents.length,
      commandButtons: commandButtons.length,
      commandSets: commandSets.length,
      particleSystems: 0,
      fxLists: 0,
      staticGameLODs: 0,
      dynamicGameLODs: 0,
      unresolvedInheritance: 0,
      totalBlocks:
        params.objects.length
        + weapons.length
        + armors.length
        + upgrades.length
        + specialPowers.length
        + commandButtons.length
        + commandSets.length
        + sciences.length
        + locomotors.length,
    },
    errors: [],
    unsupportedBlockTypes: [],
  };
}

export function makeRegistry(bundle: IniDataBundle): IniDataRegistry {
  const registry = new IniDataRegistry();
  registry.loadBundle(bundle);
  return registry;
}

export function makeHeightmap(width = 8, height = 8): HeightmapGrid {
  const data = new Uint8Array(width * height).fill(0);
  return HeightmapGrid.fromJSON({
    width,
    height,
    borderSize: 0,
    data: uint8ArrayToBase64(data),
  });
}

export function makeMap(objects: MapObjectJSON[], width = 8, height = 8): MapDataJSON {
  const data = new Uint8Array(width * height).fill(0);
  return {
    heightmap: {
      width,
      height,
      borderSize: 0,
      data: uint8ArrayToBase64(data),
    },
    objects,
    triggers: [],
    textureClasses: [],
    blendTileCount: 0,
  };
}

export function makeMapObject(
  templateName: string,
  x: number,
  y: number,
  properties: Record<string, string> = {},
): MapObjectJSON {
  return {
    templateName,
    angle: 0,
    flags: 0,
    position: { x, y, z: 0 },
    properties,
  };
}

// ── Input state builder ─────────────────────────────────────────────────────

export function makeInputState(overrides: Partial<InputState> = {}): InputState {
  return {
    keysDown: new Set<string>(),
    keysPressed: new Set<string>(),
    mouseX: 0,
    mouseY: 0,
    viewportWidth: 800,
    viewportHeight: 600,
    wheelDelta: 0,
    middleMouseDown: false,
    leftMouseDown: false,
    rightMouseDown: false,
    leftMouseClick: false,
    rightMouseClick: false,
    middleDragDx: 0,
    middleDragDy: 0,
    pointerInCanvas: true,
    ...overrides,
  };
}
