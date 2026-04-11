import type { IniBlock, IniValue } from '@generals/core';

import {
  readBooleanField,
  readNumericField,
  readStringField,
} from './ini-readers.js';

export type ParsedMaxHealthChangeTypeName = 'SAME_CURRENTHEALTH' | 'PRESERVE_RATIO' | 'ADD_CURRENT_HEALTH_TOO';

export interface ParsedUpgradeModuleProfile {
  id: string;
  moduleTag: string;
  moduleType:
    | 'LOCOMOTORSETUPGRADE'
    | 'MAXHEALTHUPGRADE'
    | 'ARMORUPGRADE'
    | 'WEAPONSETUPGRADE'
    | 'COMMANDSETUPGRADE'
    | 'STATUSBITSUPGRADE'
    | 'STEALTHUPGRADE'
    | 'WEAPONBONUSUPGRADE'
    | 'COSTMODIFIERUPGRADE'
    | 'GRANTSCIENCEUPGRADE'
    | 'POWERPLANTUPGRADE'
    | 'RADARUPGRADE'
    | 'PASSENGERSFIREUPGRADE'
    | 'UNPAUSESPECIALPOWERUPGRADE'
    | 'EXPERIENCESCALARUPGRADE'
    | 'MODELCONDITIONUPGRADE'
    | 'OBJECTCREATIONUPGRADE'
    | 'ACTIVESHROUDUPGRADE'
    | 'REPLACEOBJECTUPGRADE';
  triggeredBy: Set<string>;
  conflictsWith: Set<string>;
  removesUpgrades: Set<string>;
  requiresAllTriggers: boolean;
  addMaxHealth: number;
  maxHealthChangeType: ParsedMaxHealthChangeTypeName;
  sourceUpgradeName: string | null;
  statusToSet: Set<string>;
  statusToClear: Set<string>;
  commandSetName: string | null;
  commandSetAltName: string | null;
  commandSetAltTriggerUpgrade: string | null;
  effectKindOf: Set<string>;
  effectPercent: number;
  grantScienceName: string;
  radarIsDisableProof: boolean;
  specialPowerTemplateName: string;
  addXPScalar: number;
  conditionFlag: string;
  upgradeObjectOCLName: string;
  newShroudRange: number;
  replaceObjectName: string;
}

export interface UpgradeModuleParsingHelpers {
  parseUpgradeNames(value: IniValue | undefined): string[];
  parseObjectStatusNames(value: IniValue | undefined): string[];
  parseKindOf(value: IniValue | undefined): string[];
  parsePercent(value: IniValue | undefined): number | null;
}

export interface KindOfProductionCostModifierState {
  kindOf: Set<string>;
  multiplier: number;
  refCount: number;
}

export interface SidePowerState {
  powerBonus: number;
}

export interface SideRadarState {
  radarCount: number;
  disableProofRadarCount: number;
  /** Source parity: Player::m_radarDisabled — set during power brown-out. */
  radarDisabled: boolean;
}

function asSupportedUpgradeModuleType(
  moduleType: string,
): ParsedUpgradeModuleProfile['moduleType'] | null {
  if (
    moduleType === 'LOCOMOTORSETUPGRADE'
    || moduleType === 'MAXHEALTHUPGRADE'
    || moduleType === 'ARMORUPGRADE'
    || moduleType === 'WEAPONSETUPGRADE'
    || moduleType === 'COMMANDSETUPGRADE'
    || moduleType === 'STATUSBITSUPGRADE'
    || moduleType === 'STEALTHUPGRADE'
    || moduleType === 'WEAPONBONUSUPGRADE'
    || moduleType === 'COSTMODIFIERUPGRADE'
    || moduleType === 'GRANTSCIENCEUPGRADE'
    || moduleType === 'POWERPLANTUPGRADE'
    || moduleType === 'RADARUPGRADE'
    || moduleType === 'PASSENGERSFIREUPGRADE'
    || moduleType === 'UNPAUSESPECIALPOWERUPGRADE'
    || moduleType === 'EXPERIENCESCALARUPGRADE'
    || moduleType === 'MODELCONDITIONUPGRADE'
    || moduleType === 'OBJECTCREATIONUPGRADE'
    || moduleType === 'ACTIVESHROUDUPGRADE'
    || moduleType === 'REPLACEOBJECTUPGRADE'
  ) {
    return moduleType;
  }

  return null;
}

export function extractUpgradeModulesFromBlocks(
  blocks: IniBlock[] = [],
  sourceUpgradeName: string | null = null,
  helpers: UpgradeModuleParsingHelpers,
): ParsedUpgradeModuleProfile[] {
  const modules: ParsedUpgradeModuleProfile[] = [];
  let index = 0;

  const visitBlock = (block: IniBlock): void => {
    if (block.type.toUpperCase() === 'BEHAVIOR') {
      const blockNameTokens = block.name.split(/\s+/).map((token) => token.trim()).filter(Boolean);
      const moduleType = asSupportedUpgradeModuleType(blockNameTokens[0]?.toUpperCase() ?? '');
      if (moduleType !== null) {
        const moduleTag = blockNameTokens[1]?.toUpperCase() ?? '';
        const triggeredBy = new Set(helpers.parseUpgradeNames(block.fields['TriggeredBy']));
        const conflictsWith = new Set(helpers.parseUpgradeNames(block.fields['ConflictsWith']));
        const removesUpgrades = new Set(helpers.parseUpgradeNames(block.fields['RemovesUpgrades']));
        const requiresAllTriggers = readBooleanField(block.fields, ['RequiresAllTriggers']) === true;
        const addMaxHealth = moduleType === 'MAXHEALTHUPGRADE'
          ? (readNumericField(block.fields, ['AddMaxHealth']) ?? 0)
          : 0;
        const statusToSet = moduleType === 'STATUSBITSUPGRADE'
          ? new Set(helpers.parseObjectStatusNames(block.fields['StatusToSet']))
          : new Set<string>();
        const statusToClear = moduleType === 'STATUSBITSUPGRADE'
          ? new Set(helpers.parseObjectStatusNames(block.fields['StatusToClear']))
          : new Set<string>();
        const changeTypeRaw = readStringField(block.fields, ['ChangeType'])?.toUpperCase() ?? 'SAME_CURRENTHEALTH';
        const maxHealthChangeType: ParsedMaxHealthChangeTypeName =
          changeTypeRaw === 'PRESERVE_RATIO' || changeTypeRaw === 'ADD_CURRENT_HEALTH_TOO'
            ? changeTypeRaw
            : 'SAME_CURRENTHEALTH';
        const commandSetName = moduleType === 'COMMANDSETUPGRADE'
          ? (readStringField(block.fields, ['CommandSet'])?.trim().toUpperCase() ?? '')
          : '';
        const commandSetAltName = moduleType === 'COMMANDSETUPGRADE'
          ? (readStringField(block.fields, ['CommandSetAlt'])?.trim().toUpperCase() ?? '')
          : '';
        const commandSetAltTriggerUpgradeRaw = moduleType === 'COMMANDSETUPGRADE'
          ? (readStringField(block.fields, ['TriggerAlt'])?.trim().toUpperCase() ?? '')
          : '';
        const commandSetAltTriggerUpgrade = commandSetAltTriggerUpgradeRaw && commandSetAltTriggerUpgradeRaw !== 'NONE'
          ? commandSetAltTriggerUpgradeRaw
          : null;
        const effectKindOf = moduleType === 'COSTMODIFIERUPGRADE'
          ? new Set(helpers.parseKindOf(block.fields['EffectKindOf']))
          : new Set<string>();
        const effectPercent = moduleType === 'COSTMODIFIERUPGRADE'
          ? (helpers.parsePercent(block.fields['Percentage']) ?? 0)
          : 0;
        const grantScienceName = moduleType === 'GRANTSCIENCEUPGRADE'
          ? (readStringField(block.fields, ['GrantScience'])?.trim().toUpperCase() ?? '')
          : '';
        const radarIsDisableProof = moduleType === 'RADARUPGRADE'
          ? readBooleanField(block.fields, ['DisableProof']) ?? false
          : false;
        const specialPowerTemplateName = moduleType === 'UNPAUSESPECIALPOWERUPGRADE'
          ? (readStringField(block.fields, ['SpecialPowerTemplate'])?.trim().toUpperCase() ?? '')
          : '';
        const addXPScalar = moduleType === 'EXPERIENCESCALARUPGRADE'
          ? (readNumericField(block.fields, ['AddXPScalar']) ?? 0)
          : 0;
        const conditionFlag = moduleType === 'MODELCONDITIONUPGRADE'
          ? (readStringField(block.fields, ['ConditionFlag'])?.trim().toUpperCase() ?? '')
          : '';
        const upgradeObjectOCLName = moduleType === 'OBJECTCREATIONUPGRADE'
          ? (readStringField(block.fields, ['UpgradeObject'])?.trim() ?? '')
          : '';
        const newShroudRange = moduleType === 'ACTIVESHROUDUPGRADE'
          ? (readNumericField(block.fields, ['NewShroudRange']) ?? 0)
          : 0;
        const replaceObjectName = moduleType === 'REPLACEOBJECTUPGRADE'
          ? (readStringField(block.fields, ['ReplaceObject'])?.trim() ?? '')
          : '';
        const moduleId = sourceUpgradeName === null
          ? `${moduleType}:${block.name}:${index}`
          : `${moduleType}:${block.name}:${index}:${sourceUpgradeName}`;
        index += 1;
        modules.push({
          id: moduleId,
          moduleTag,
          moduleType,
          sourceUpgradeName,
          triggeredBy,
          conflictsWith,
          removesUpgrades,
          requiresAllTriggers,
          addMaxHealth,
          maxHealthChangeType,
          statusToSet,
          statusToClear,
          commandSetName: commandSetName && commandSetName !== 'NONE' ? commandSetName : null,
          commandSetAltName: commandSetAltName && commandSetAltName !== 'NONE' ? commandSetAltName : null,
          commandSetAltTriggerUpgrade,
          effectKindOf,
          effectPercent,
          grantScienceName,
          radarIsDisableProof,
          specialPowerTemplateName,
          addXPScalar,
          conditionFlag,
          upgradeObjectOCLName,
          newShroudRange,
          replaceObjectName,
        });
      }
    }

    for (const child of block.blocks) {
      visitBlock(child);
    }
  };

  for (const block of blocks) {
    visitBlock(block);
  }

  return modules;
}

export function areKindOfTokenSetsEquivalent(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  if (left.size !== right.size) {
    return false;
  }
  for (const token of left) {
    if (!right.has(token)) {
      return false;
    }
  }
  return true;
}

export function applyCostModifierUpgradeToSide(
  modifiers: KindOfProductionCostModifierState[],
  module: Pick<ParsedUpgradeModuleProfile, 'effectPercent' | 'effectKindOf'>,
): void {
  const existingModifier = modifiers.find((modifier) => (
    modifier.multiplier === module.effectPercent
    && areKindOfTokenSetsEquivalent(modifier.kindOf, module.effectKindOf)
  ));
  if (existingModifier) {
    existingModifier.refCount += 1;
    return;
  }

  modifiers.push({
    kindOf: new Set(module.effectKindOf),
    multiplier: module.effectPercent,
    refCount: 1,
  });
}

export function removeCostModifierUpgradeFromSide(
  modifiers: KindOfProductionCostModifierState[],
  module: Pick<ParsedUpgradeModuleProfile, 'effectPercent' | 'effectKindOf'>,
): void {
  const index = modifiers.findIndex((modifier) => (
    modifier.multiplier === module.effectPercent
    && areKindOfTokenSetsEquivalent(modifier.kindOf, module.effectKindOf)
  ));
  if (index < 0) {
    return;
  }

  const modifier = modifiers[index];
  if (!modifier) {
    return;
  }
  modifier.refCount -= 1;
  if (modifier.refCount <= 0) {
    modifiers.splice(index, 1);
  }
}

export function applyKindOfProductionCostModifiers(
  buildCost: number,
  kindOf: ReadonlySet<string>,
  modifiers: readonly KindOfProductionCostModifierState[],
): number {
  if (!Number.isFinite(buildCost) || buildCost < 0) {
    return 0;
  }
  if (kindOf.size === 0) {
    return buildCost;
  }

  let nextCost = buildCost;
  for (const modifier of modifiers) {
    if (modifier.kindOf.size === 0) {
      continue;
    }

    let matchesKindOf = false;
    for (const kindOfToken of modifier.kindOf) {
      if (kindOf.has(kindOfToken)) {
        matchesKindOf = true;
        break;
      }
    }

    if (!matchesKindOf) {
      continue;
    }
    nextCost *= 1 + modifier.multiplier;
  }

  return nextCost;
}

export function applyPowerPlantUpgradeToSide(sideState: SidePowerState, energyBonus: number): void {
  const bonus = Number.isFinite(energyBonus) ? energyBonus : 0;
  sideState.powerBonus += bonus;
}

export function removePowerPlantUpgradeFromSide(sideState: SidePowerState, energyBonus: number): boolean {
  const bonus = Number.isFinite(energyBonus) ? energyBonus : 0;
  sideState.powerBonus -= bonus;
  return sideState.powerBonus <= 0;
}

export function applyRadarUpgradeToSide(
  sideState: SideRadarState,
  radarIsDisableProof: boolean,
): void {
  sideState.radarCount += 1;
  if (radarIsDisableProof) {
    sideState.disableProofRadarCount += 1;
  }
}

export function removeRadarUpgradeFromSide(
  sideState: SideRadarState,
  radarIsDisableProof: boolean,
): boolean {
  sideState.radarCount = Math.max(0, sideState.radarCount - 1);
  if (radarIsDisableProof) {
    sideState.disableProofRadarCount = Math.max(0, sideState.disableProofRadarCount - 1);
  }
  return sideState.radarCount <= 0 && sideState.disableProofRadarCount <= 0;
}
