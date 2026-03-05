import type { IniValue } from '@generals/core';
import type { ObjectDef } from '@generals/ini-data';

import { readNumericField, readStringField } from './ini-readers.js';

type ExtractIniValueTokens = (value: IniValue | undefined) => string[][];
type FindObjectDefByName = (templateName: string) => ObjectDef | undefined;
const MAX_TEMPLATE_ANCESTRY_DEPTH = 64;

export interface ProductionQuantityModifier {
  templateName: string;
  quantity: number;
}

function normalizeKindOf(kindOf: readonly string[] | undefined): Set<string> {
  const normalized = new Set<string>();
  if (!Array.isArray(kindOf)) {
    return normalized;
  }
  for (const token of kindOf) {
    const nextToken = token.trim().toUpperCase();
    if (nextToken) {
      normalized.add(nextToken);
    }
  }
  return normalized;
}

function normalizeTemplateName(name: string | undefined): string {
  return name?.trim().toUpperCase() ?? '';
}

function hasSetIntersection(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  for (const value of left) {
    if (right.has(value)) {
      return true;
    }
  }
  return false;
}

function collectTemplateAncestry(
  objectDef: ObjectDef,
  findObjectDefByName: FindObjectDefByName,
): { names: Set<string>; definitions: ObjectDef[] } {
  const names = new Set<string>();
  const definitions: ObjectDef[] = [];
  let current: ObjectDef | undefined = objectDef;

  for (let depth = 0; depth < MAX_TEMPLATE_ANCESTRY_DEPTH && current; depth += 1) {
    const normalizedName = normalizeTemplateName(current.name);
    if (!normalizedName || names.has(normalizedName)) {
      break;
    }
    names.add(normalizedName);
    definitions.push(current);

    const parentName = normalizeTemplateName(current.parent);
    if (!parentName) {
      break;
    }
    current = findObjectDefByName(parentName);
  }

  return { names, definitions };
}

function collectBuildVariationNamesFromAncestry(
  definitions: readonly ObjectDef[],
  extractIniValueTokens: ExtractIniValueTokens,
): Set<string> {
  const names = new Set<string>();
  for (const definition of definitions) {
    for (const variationName of extractBuildVariationNames(definition, extractIniValueTokens)) {
      names.add(variationName);
    }
  }
  return names;
}

/**
 * Source parity: ThingTemplate::getMaxSimultaneousOfType() — resolve the
 * per-player build limit for this object type. When the INI keyword
 * `DeterminedBySuperweaponRestriction` is used, the limit comes from
 * GameLogic::getSuperweaponRestriction() (cached from GameInfo at game start).
 * @param superweaponRestriction The session's superweapon restriction value (0 = unlimited).
 */
export function resolveMaxSimultaneousOfType(
  objectDef: Pick<ObjectDef, 'fields'>,
  superweaponRestriction: number,
): number {
  const maxKeyword = readStringField(objectDef.fields, ['MaxSimultaneousOfType'])?.trim().toUpperCase();
  if (maxKeyword === 'DETERMINEDBYSUPERWEAPONRESTRICTION') {
    // Source parity: TheGameLogic->getSuperweaponRestriction().
    // 0 means no restriction (unlimited), non-zero is the cap.
    return Math.max(0, Math.trunc(superweaponRestriction));
  }

  const maxRaw = readNumericField(objectDef.fields, ['MaxSimultaneousOfType']) ?? 0;
  if (!Number.isFinite(maxRaw)) {
    return 0;
  }
  return Math.max(0, Math.trunc(maxRaw));
}

export function resolveMaxSimultaneousLinkKey(objectDef: Pick<ObjectDef, 'fields'>): string | null {
  const rawLinkKey = readStringField(objectDef.fields, ['MaxSimultaneousLinkKey'])?.trim().toUpperCase() ?? '';
  if (!rawLinkKey || rawLinkKey === 'NONE') {
    return null;
  }
  return rawLinkKey;
}

export function isStructureObjectDef(objectDef: Pick<ObjectDef, 'kindOf'>): boolean {
  return normalizeKindOf(objectDef.kindOf).has('STRUCTURE');
}

export function extractBuildVariationNames(
  objectDef: Pick<ObjectDef, 'fields'> | undefined,
  extractIniValueTokens: ExtractIniValueTokens,
): Set<string> {
  const names = new Set<string>();
  if (!objectDef) {
    return names;
  }

  for (const tokens of extractIniValueTokens(objectDef.fields['BuildVariations'])) {
    for (const token of tokens) {
      const normalized = token.trim().toUpperCase();
      if (!normalized || normalized === 'NONE') {
        continue;
      }
      names.add(normalized);
    }
  }

  return names;
}

export function areEquivalentObjectTemplates(
  left: ObjectDef | undefined,
  right: ObjectDef | undefined,
  extractIniValueTokens: ExtractIniValueTokens,
  findObjectDefByName: FindObjectDefByName,
): boolean {
  if (!left || !right) {
    return false;
  }

  const leftName = normalizeTemplateName(left.name);
  const rightName = normalizeTemplateName(right.name);
  if (!leftName || !rightName) {
    return false;
  }
  if (leftName === rightName) {
    return true;
  }

  // Source parity: ThingTemplate::isEquivalentTo() compares direct equality, final overrides,
  // reskin ancestry, and BuildVariations both directions.
  const leftVariations = extractBuildVariationNames(left, extractIniValueTokens);
  if (leftVariations.has(rightName)) {
    return true;
  }
  const rightVariations = extractBuildVariationNames(right, extractIniValueTokens);
  if (rightVariations.has(leftName)) {
    return true;
  }

  const leftAncestry = collectTemplateAncestry(left, findObjectDefByName);
  const rightAncestry = collectTemplateAncestry(right, findObjectDefByName);
  if (hasSetIntersection(leftAncestry.names, rightAncestry.names)) {
    return true;
  }

  const leftAncestryVariations = collectBuildVariationNamesFromAncestry(
    leftAncestry.definitions,
    extractIniValueTokens,
  );
  if (hasSetIntersection(leftAncestryVariations, rightAncestry.names)) {
    return true;
  }

  const rightAncestryVariations = collectBuildVariationNamesFromAncestry(
    rightAncestry.definitions,
    extractIniValueTokens,
  );
  if (hasSetIntersection(rightAncestryVariations, leftAncestry.names)) {
    return true;
  }

  return false;
}

export function areEquivalentTemplateNames(
  leftTemplateName: string,
  rightTemplateName: string,
  findObjectDefByName: FindObjectDefByName,
  extractIniValueTokens: ExtractIniValueTokens,
): boolean {
  const normalizedLeft = leftTemplateName.trim().toUpperCase();
  const normalizedRight = rightTemplateName.trim().toUpperCase();
  if (!normalizedLeft || !normalizedRight) {
    return false;
  }
  if (normalizedLeft === normalizedRight) {
    return true;
  }

  const leftDef = findObjectDefByName(normalizedLeft);
  const rightDef = findObjectDefByName(normalizedRight);
  return areEquivalentObjectTemplates(leftDef, rightDef, extractIniValueTokens, findObjectDefByName);
}

export function resolveProductionQuantity(
  quantityModifiers: readonly ProductionQuantityModifier[] | undefined,
  templateName: string,
  areEquivalentTemplateNames: (leftTemplateName: string, rightTemplateName: string) => boolean,
): number {
  if (!quantityModifiers) {
    return 1;
  }

  for (const modifier of quantityModifiers) {
    if (!areEquivalentTemplateNames(modifier.templateName, templateName)) {
      continue;
    }
    return Math.max(1, modifier.quantity);
  }

  return 1;
}

export function doesTemplateMatchMaxSimultaneousType(
  targetObjectDef: ObjectDef,
  candidateTemplateName: string,
  areEquivalentTemplateNames: (leftTemplateName: string, rightTemplateName: string) => boolean,
  findObjectDefByName: FindObjectDefByName,
): boolean {
  const normalizedTargetName = targetObjectDef.name.trim().toUpperCase();
  if (!normalizedTargetName) {
    return false;
  }

  if (areEquivalentTemplateNames(candidateTemplateName, normalizedTargetName)) {
    return true;
  }

  const targetLinkKey = resolveMaxSimultaneousLinkKey(targetObjectDef);
  if (!targetLinkKey) {
    return false;
  }

  const candidateDef = findObjectDefByName(candidateTemplateName);
  if (!candidateDef) {
    return false;
  }

  const candidateLinkKey = resolveMaxSimultaneousLinkKey(candidateDef);
  return candidateLinkKey !== null && candidateLinkKey === targetLinkKey;
}
