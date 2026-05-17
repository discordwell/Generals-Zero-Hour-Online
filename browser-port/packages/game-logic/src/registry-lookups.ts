import type { IniBlock, IniValue } from '@generals/core';
import {
  IniDataRegistry,
  type ArmorDef,
  type CommandButtonDef,
  type CommandSetDef,
  type ObjectDef,
  type ScienceDef,
  type UpgradeDef,
  type WeaponDef,
} from '@generals/ini-data';
import { readNumericField, readStringField } from './ini-readers.js';

const caseInsensitiveLookupCache = new WeakMap<
  ReadonlyMap<string, unknown>,
  { size: number; entries: Map<string, unknown> }
>();
const promotedObjectDefCache = new WeakMap<ObjectDef, ObjectDef>();

function coerceKindOfList(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const tokens = value.filter((entry): entry is string => typeof entry === 'string');
    return tokens.length > 0 ? tokens : undefined;
  }
  if (typeof value === 'string') {
    const tokens = value.split(/\s+/).filter(Boolean);
    return tokens.length > 0 ? tokens : undefined;
  }
  return undefined;
}

function promoteDisplacedObjectFields(objectDef: ObjectDef | undefined): ObjectDef | undefined {
  if (!objectDef) {
    return undefined;
  }
  const cached = promotedObjectDefCache.get(objectDef);
  if (cached) {
    return cached;
  }

  const topLevelHasKindOf = Array.isArray(objectDef.kindOf) && objectDef.kindOf.length > 0;
  const topLevelHasSide = !!objectDef.side || readStringField(objectDef.fields, ['Side']) !== null;
  const topLevelHasRootFields = Object.keys(objectDef.fields).length > 2;
  if (topLevelHasKindOf && topLevelHasSide && topLevelHasRootFields) {
    promotedObjectDefCache.set(objectDef, objectDef);
    return objectDef;
  }

  const promotedFields: Record<string, IniValue> = { ...objectDef.fields };
  let promoted = false;
  const promoteFromBlocks = (blocks: readonly IniBlock[]): void => {
    for (const block of blocks) {
      const blockFields = block.fields ?? {};
      // Conversion artifact: some ChildObject/ObjectReskin entries keep object-level
      // fields on a top-level Draw block instead of the object root.
      if (
        ('KindOf' in blockFields || 'Locomotor' in blockFields || 'Side' in blockFields || 'BuildCost' in blockFields)
      ) {
        for (const [fieldName, fieldValue] of Object.entries(blockFields)) {
          if (!(fieldName in promotedFields)) {
            promotedFields[fieldName] = fieldValue;
            promoted = true;
          }
        }
      }
      if (block.blocks?.length) {
        promoteFromBlocks(block.blocks);
      }
    }
  };

  promoteFromBlocks(objectDef.blocks);
  if (!promoted) {
    promotedObjectDefCache.set(objectDef, objectDef);
    return objectDef;
  }

  const promotedKindOf = topLevelHasKindOf
    ? objectDef.kindOf
    : coerceKindOfList(promotedFields.KindOf);
  const promotedSide = objectDef.side ?? readStringField(promotedFields, ['Side']) ?? undefined;

  const promotedObjectDef = {
    ...objectDef,
    fields: promotedFields,
    kindOf: promotedKindOf,
    side: promotedSide,
  };
  promotedObjectDefCache.set(objectDef, promotedObjectDef);
  return promotedObjectDef;
}

function findByNameCaseInsensitive<T>(
  direct: T | undefined,
  name: string,
  entries: ReadonlyMap<string, T>,
): T | undefined {
  if (direct) {
    return direct;
  }

  const normalizedName = name.toUpperCase();
  let cached = caseInsensitiveLookupCache.get(entries);
  if (!cached || cached.size !== entries.size) {
    const normalizedEntries = new Map<string, unknown>();
    for (const [registryName, entry] of entries) {
      normalizedEntries.set(registryName.toUpperCase(), entry);
    }
    cached = { size: entries.size, entries: normalizedEntries };
    caseInsensitiveLookupCache.set(entries, cached);
  }

  return cached.entries.get(normalizedName) as T | undefined;
}

export function findWeaponDefByName(iniDataRegistry: IniDataRegistry, weaponName: string): WeaponDef | undefined {
  return findByNameCaseInsensitive(
    iniDataRegistry.getWeapon(weaponName),
    weaponName,
    iniDataRegistry.weapons,
  );
}

export function findArmorDefByName(iniDataRegistry: IniDataRegistry, armorName: string): ArmorDef | undefined {
  return findByNameCaseInsensitive(
    iniDataRegistry.getArmor(armorName),
    armorName,
    iniDataRegistry.armors,
  );
}

export function findObjectDefByName(iniDataRegistry: IniDataRegistry, objectName: string): ObjectDef | undefined {
  return promoteDisplacedObjectFields(findByNameCaseInsensitive(
    iniDataRegistry.getObject(objectName),
    objectName,
    iniDataRegistry.objects,
  ));
}

export function findUpgradeDefByName(iniDataRegistry: IniDataRegistry, upgradeName: string): UpgradeDef | undefined {
  return findByNameCaseInsensitive(
    iniDataRegistry.getUpgrade(upgradeName),
    upgradeName,
    iniDataRegistry.upgrades,
  );
}

export function findCommandButtonDefByName(
  iniDataRegistry: IniDataRegistry,
  commandButtonName: string,
): CommandButtonDef | undefined {
  return findByNameCaseInsensitive(
    iniDataRegistry.getCommandButton(commandButtonName),
    commandButtonName,
    iniDataRegistry.commandButtons,
  );
}

export function findCommandSetDefByName(iniDataRegistry: IniDataRegistry, commandSetName: string): CommandSetDef | undefined {
  return findByNameCaseInsensitive(
    iniDataRegistry.getCommandSet(commandSetName),
    commandSetName,
    iniDataRegistry.commandSets,
  );
}

export function findScienceDefByName(iniDataRegistry: IniDataRegistry, scienceName: string): ScienceDef | undefined {
  return findByNameCaseInsensitive(
    iniDataRegistry.getScience(scienceName),
    scienceName,
    iniDataRegistry.sciences,
  );
}

export function iterAllScienceDefs(iniDataRegistry: IniDataRegistry): Iterable<ScienceDef> {
  return iniDataRegistry.sciences.values();
}

export function resolveUpgradeType(upgradeDef: UpgradeDef): 'PLAYER' | 'OBJECT' {
  const type = readStringField(upgradeDef.fields, ['Type'])?.toUpperCase();
  if (type === 'OBJECT') {
    return 'OBJECT';
  }
  return 'PLAYER';
}

export function resolveUpgradeBuildTimeFrames(upgradeDef: UpgradeDef, logicFrameRate: number): number {
  const buildTimeSeconds = readNumericField(upgradeDef.fields, ['BuildTime']) ?? 0;
  if (!Number.isFinite(buildTimeSeconds)) {
    return 0;
  }
  return Math.trunc(buildTimeSeconds * logicFrameRate);
}

export function resolveUpgradeBuildCost(upgradeDef: UpgradeDef): number {
  const buildCostRaw = readNumericField(upgradeDef.fields, ['BuildCost']) ?? 0;
  if (!Number.isFinite(buildCostRaw)) {
    return 0;
  }
  // Source parity note: C&C upgrade cost calc does not apply kind-of production
  // cost modifiers; only object build/production costs are affected in this path.
  return Math.max(0, Math.trunc(buildCostRaw));
}
