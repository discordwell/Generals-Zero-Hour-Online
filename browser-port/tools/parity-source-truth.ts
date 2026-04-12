/**
 * Source Truth Parity Verification — compares C++ source data against the TypeScript port.
 *
 * Parses C++ header files from the in-repo original and compares enum values,
 * field tables, and bonus conditions against the browser port's implementation.
 *
 * Usage:
 *   npx tsx tools/parity-source-truth.ts [--strict]
 *
 * Outputs:
 *   test-results/parity/source-parity.json   — structured mismatch list
 *   test-results/parity/source-parity.md     — human-readable summary
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ── Types ───────────────────────────────────────────────────────────────────

export interface ParityMismatch {
  category: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  cppValue?: string;
  tsValue?: string;
}

export interface ParityCategoryResult {
  category: string;
  status: 'match' | 'mismatch' | 'partial';
  mismatches: ParityMismatch[];
}

export interface SourceParityReport {
  generatedAt: string;
  status: 'pass' | 'fail';
  summary: {
    totalCategories: number;
    passingCategories: number;
    failingCategories: number;
    totalMismatches: number;
    errors: number;
    warnings: number;
  };
  categories: ParityCategoryResult[];
}

// ── Parsers ─────────────────────────────────────────────────────────────────

/**
 * Parse C++ damage type enum names from GeneralsMD Damage.h or Damage.cpp.
 * Extracts the s_bitNameList[] string array.
 */
export function parseCppDamageTypeNames(source: string): string[] {
  // Look for the s_bitNameList array (ZH style) or TheDamageNames array (Generals style)
  const patterns = [
    /s_bitNameList\s*\[\s*\]\s*=\s*\{([^}]+)\}/s,
    /TheDamageNames\s*\[\s*\]\s*=\s*\{([^}]+)\}/s,
  ];

  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match) {
      return extractQuotedStrings(match[1]!);
    }
  }
  return [];
}

/**
 * Parse C++ WeaponBonusConditionType names from Weapon.h.
 * Extracts TheWeaponBonusNames[] string array.
 */
export function parseCppWeaponBonusNames(source: string): string[] {
  const match = source.match(/TheWeaponBonusNames\s*\[\s*\]\s*=\s*\{([^}]+)\}/s);
  if (!match) return [];
  return extractQuotedStrings(match[1]!);
}

/**
 * Parse C++ weapon field names from TheWeaponTemplateFieldParseTable.
 * Extracts the field name strings.
 */
export function parseCppWeaponFieldNames(source: string): string[] {
  const match = source.match(
    /TheWeaponTemplateFieldParseTable\s*\[\s*\]\s*=\s*\{([\s\S]*?)\{\s*NULL/,
  );
  if (!match) return [];
  return extractQuotedStrings(match[1]!);
}

/**
 * Parse C++ WeaponBonusConditionType enum values.
 * Returns ordered list of enum constant names (without WEAPONBONUSCONDITION_ prefix).
 */
export function parseCppWeaponBonusEnumValues(source: string): string[] {
  const match = source.match(
    /enum\s+WeaponBonusConditionType\s*\{([\s\S]*?WEAPONBONUSCONDITION_COUNT[\s\S]*?)\}/,
  );
  if (!match) return [];

  const body = match[1]!;
  const names: string[] = [];
  const lines = body.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    // Skip preprocessor directives, comments, INVALID, and COUNT
    if (trimmed.startsWith('#') || trimmed.startsWith('//')) continue;
    const enumMatch = trimmed.match(/^WEAPONBONUSCONDITION_(\w+)/);
    if (!enumMatch) continue;
    const name = enumMatch[1]!;
    if (name === 'INVALID' || name === 'COUNT') continue;
    // Skip obsolete entries
    if (name.includes('OBSOLETE')) continue;
    names.push(name);
  }
  return names;
}

/**
 * Parse C++ GameState::init save/load snapshot block registration order.
 * Source saves use this exact registration order for normal save files.
 */
export function parseCppSaveSnapshotBlockNames(source: string): string[] {
  const defines = new Map<string, string>();
  const defineRegex = /#define\s+(\w+)\s+"([^"]+)"/g;
  let match;
  while ((match = defineRegex.exec(source)) !== null) {
    defines.set(match[1]!, match[2]!);
  }

  const names: string[] = [];
  const blockRegex = /addSnapshotBlock\s*\(\s*([^,]+)\s*,[^;]+\);/g;
  while ((match = blockRegex.exec(source)) !== null) {
    if (!match[0].includes('SNAPSHOT_SAVELOAD')) {
      continue;
    }
    const rawName = match[1]!.trim();
    if (rawName.startsWith('"') && rawName.endsWith('"')) {
      names.push(rawName.slice(1, -1));
      continue;
    }
    const resolved = defines.get(rawName);
    if (resolved) {
      names.push(resolved);
    }
  }
  return names;
}

/**
 * Parse TS buildRuntimeSaveFile source-save block write order.
 * Conditional alternatives can mention the same block more than once; first
 * occurrence preserves the source stream position.
 */
export function parseTsSaveSnapshotBlockNames(source: string): string[] {
  const constants = new Map<string, string>();
  const constRegex = /(?:export\s+)?const\s+(\w+)\s*=\s*['"]([^'"]+)['"]/g;
  let match;
  while ((match = constRegex.exec(source)) !== null) {
    constants.set(match[1]!, match[2]!);
  }

  const functionStart = source.indexOf('export function buildRuntimeSaveFile');
  if (functionStart < 0) {
    return [];
  }
  const functionEnd = source.indexOf('\nfunction parseRuntimeSaveGameMapInfoForMetadata', functionStart);
  const functionBody = source.slice(functionStart, functionEnd < 0 ? undefined : functionEnd);
  const names: string[] = [];
  const seen = new Set<string>();
  const blockRegex = /state\.addSnapshotBlock\s*\(\s*([^,\s)]+)/g;
  while ((match = blockRegex.exec(functionBody)) !== null) {
    const rawName = match[1]!.trim();
    let resolved: string | undefined;
    if (rawName.startsWith("'") || rawName.startsWith('"')) {
      resolved = rawName.slice(1, -1);
    } else {
      resolved = constants.get(rawName);
    }
    if (!resolved || resolved === 'CHUNK_TS_RuntimeState' || seen.has(resolved)) {
      continue;
    }
    seen.add(resolved);
    names.push(resolved);
  }
  return names;
}

/**
 * Parse SaveGameInfo field xfer order from C++ GameState::xfer.
 */
export function parseCppSaveGameInfoXferFields(source: string): string[] {
  const start = source.indexOf('void GameState::xfer( Xfer *xfer )');
  if (start < 0) {
    return [];
  }
  const end = source.indexOf('}  // end xfer', start);
  const body = source.slice(start, end < 0 ? undefined : end);
  const fields: string[] = [];
  const seen = new Set<string>();
  const fieldRegex = /xfer->xfer\w+\s*\(\s*&saveGameInfo->(?:(date)\.)?(\w+)/g;
  let match;
  while ((match = fieldRegex.exec(body)) !== null) {
    const fieldName = match[1] ? `date.${match[2]!}` : match[2]!;
    if (seen.has(fieldName)) {
      continue;
    }
    seen.add(fieldName);
    fields.push(fieldName);
  }
  return fields;
}

/**
 * Parse RuntimeSaveMetadataState field xfer order from TS MetadataSnapshot.
 */
export function parseTsSaveGameInfoXferFields(source: string): string[] {
  const start = source.indexOf('class MetadataSnapshot');
  if (start < 0) {
    return [];
  }
  const end = source.indexOf('class MapSnapshot', start);
  const body = source.slice(start, end < 0 ? undefined : end);
  const fields: string[] = [];
  const fieldRegex = /this\.state\.(?:(date)\.)?(\w+)\s*=\s*xfer\.xfer\w+\(/g;
  let match;
  while ((match = fieldRegex.exec(body)) !== null) {
    fields.push(match[1] ? `date.${match[2]!}` : match[2]!);
  }
  return fields;
}

/**
 * Parse C++ GameStateMap::xfer source-save field order.
 */
export function parseCppGameStateMapXferFields(source: string): string[] {
  const start = source.indexOf('void GameStateMap::xfer( Xfer *xfer )');
  if (start < 0) {
    return [];
  }
  const end = source.indexOf('}  // end xfer', start);
  const body = source.slice(start, end < 0 ? undefined : end);
  const fields: string[] = [];

  pushIfFound(fields, body, 'version', /xfer->xferVersion\s*\(/);
  const asciiStringMatches = [...body.matchAll(/xfer->xferAsciiString\s*\(/g)];
  if (asciiStringMatches.length >= 1) {
    fields.push('saveGameMapPath');
  }
  if (asciiStringMatches.length >= 2) {
    fields.push('pristineMapPath');
  }
  pushIfFound(fields, body, 'gameMode', /xfer->xferInt\s*\(\s*&gameMode\s*\)/);
  if (/embedPristineMap|embedInUseMap|extractAndSaveMap/.test(body)) {
    fields.push('embeddedMapBytes');
  }
  pushIfFound(fields, body, 'objectIdCounter', /xfer->xferObjectID\s*\(\s*&highObjectID\s*\)/);
  pushIfFound(fields, body, 'drawableIdCounter', /xfer->xferDrawableID\s*\(\s*&highDrawableID\s*\)/);
  pushIfFound(fields, body, 'skirmishGameInfoSnapshot', /xfer->xferSnapshot\s*\(\s*TheSkirmishGameInfo\s*\)/);
  return fields;
}

/**
 * Parse TS MapSnapshot source-save field order.
 */
export function parseTsGameStateMapXferFields(source: string): string[] {
  const start = source.indexOf('class MapSnapshot');
  if (start < 0) {
    return [];
  }
  const end = source.indexOf('class CampaignSnapshot', start);
  const body = source.slice(start, end < 0 ? undefined : end);
  const fields: string[] = [];
  pushIfFound(fields, body, 'version', /xfer\.xferVersion\s*\(/);
  pushIfFound(fields, body, 'saveGameMapPath', /this\.state\.saveGameMapPath\s*=\s*xfer\.xferAsciiString\s*\(/);
  pushIfFound(fields, body, 'pristineMapPath', /this\.state\.pristineMapPath\s*=\s*xfer\.xferAsciiString\s*\(/);
  pushIfFound(fields, body, 'gameMode', /this\.state\.gameMode\s*=\s*xfer\.xferInt\s*\(/);
  pushIfFound(fields, body, 'embeddedMapBytes', /this\.state\.embeddedMapBytes|xfer\.xferUser\s*\(\s*this\.state\.embeddedMapBytes\s*\)/);
  pushIfFound(fields, body, 'objectIdCounter', /this\.state\.objectIdCounter\s*=\s*xfer\.xferObjectID\s*\(/);
  pushIfFound(fields, body, 'drawableIdCounter', /this\.state\.drawableIdCounter\s*=\s*xfer\.xferUnsignedInt\s*\(/);
  pushIfFound(fields, body, 'skirmishGameInfoSnapshot', /this\.state\.skirmishGameInfoState\s*=\s*xferChallengeGameInfoState\s*\(/);
  return fields;
}

/**
 * Parse C++ SkirmishGameInfo::xfer field order.
 */
export function parseCppSkirmishGameInfoXferFields(source: string): string[] {
  const start = source.indexOf('void SkirmishGameInfo::xfer( Xfer *xfer )');
  if (start < 0) {
    return [];
  }
  const end = source.indexOf('}  // end xfer', start);
  const body = source.slice(start, end < 0 ? undefined : end);
  const fields: string[] = [];
  const fieldRegex = /xfer->(xfer\w+)\s*\(\s*([^)]*?)\s*\)/g;
  let match;
  while ((match = fieldRegex.exec(body)) !== null) {
    const method = match[1]!;
    const argument = match[2]!.replace(/^&\s*/, '').trim();
    const label = mapCppSkirmishGameInfoField(method, argument);
    if (label) {
      fields.push(label);
    }
  }
  return fields;
}

/**
 * Parse TS xferChallengeGameInfoState field order.
 */
export function parseTsSkirmishGameInfoXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'function xferChallengeGameInfoState');
  if (!body) {
    return [];
  }
  const slotFields = parseTsSkirmishGameSlotXferFields(source);
  const fields: string[] = [];
  const tokenRegex =
    /(?:const|let)\s+(\w+)\s*=\s*xfer\.xfer\w+\s*\(|(\w+)\s*=\s*xfer\.xfer\w+\s*\(|(\w+)\s*=\s*xferMoneyAmount\s*\(|xfer\.xferBool\s*\(\s*false\s*\)|xferChallengeGameSlotState\s*\(/g;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    if (match[0]!.startsWith('xferChallengeGameSlotState')) {
      fields.push(...slotFields);
      continue;
    }
    if (match[0]!.startsWith('xfer.xferBool')) {
      fields.push('version3ObsoleteBool');
      continue;
    }
    const rawName = match[1] ?? match[2] ?? match[3];
    const label = rawName ? mapTsSkirmishGameInfoField(rawName) : null;
    if (label) {
      fields.push(label);
    }
  }
  return fields;
}

/**
 * Parse C++ CampaignManager::xfer source-save field order.
 */
export function parseCppCampaignManagerXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'void CampaignManager::xfer');
  if (!body) {
    return [];
  }
  return parseCppXferFields(body, mapCppCampaignManagerField);
}

/**
 * Parse TS CampaignSnapshot source-save field order.
 */
export function parseTsCampaignManagerXferFields(source: string): string[] {
  const start = source.indexOf('class CampaignSnapshot');
  if (start < 0) {
    return [];
  }
  const end = source.indexOf('function createEmptyTerrainLogicSaveState', start);
  const body = source.slice(start, end < 0 ? undefined : end);
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex =
    /xfer\.xferVersion\s*\(|this\.state\.(currentCampaign|currentMission|currentRankPoints|isChallengeCampaign|playerTemplateNum)\s*=\s*xfer\.xfer\w+\s*\(|this\.state\.difficulty\s*=\s*decodeSourceDifficulty\s*\(\s*xfer\.xferInt\s*\(|this\.state\.challengeGameInfoState\s*=\s*xferChallengeGameInfoState\s*\(/g;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    let label: string | null = null;
    if (match[0]!.startsWith('xfer.xferVersion')) {
      label = 'version';
    } else if (match[0]!.includes('difficulty')) {
      label = 'difficulty';
    } else if (match[0]!.includes('challengeGameInfoState')) {
      label = 'challengeGameInfoSnapshot';
    } else if (match[1]) {
      label = mapTsCampaignManagerField(match[1]!);
    }
    pushUniqueField(fields, seen, label);
  }
  return fields;
}

/**
 * Parse C++ TerrainLogic::xfer source-save field order.
 */
export function parseCppTerrainLogicXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'void TerrainLogic::xfer');
  if (!body) {
    return [];
  }
  return parseCppXferFields(body, mapCppTerrainLogicField);
}

/**
 * Parse TS TerrainLogicSnapshot source-save field order.
 */
export function parseTsTerrainLogicXferFields(source: string): string[] {
  const start = source.indexOf('class TerrainLogicSnapshot');
  if (start < 0) {
    return [];
  }
  const end = source.indexOf('class TacticalViewSnapshot', start);
  const body = source.slice(start, end < 0 ? undefined : end);
  const waterUpdateFields = parseTsTerrainWaterUpdateXferFields(source);
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex =
    /xfer\.xferVersion\s*\(|payload\.activeBoundary\s*=\s*xfer\.xferInt\s*\(|xfer\.xferInt\s*\(\s*payload\.waterUpdates\.length\s*\)|xferSourceTerrainWaterUpdate\s*\(/g;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    if (match[0]!.startsWith('xferSourceTerrainWaterUpdate')) {
      for (const field of waterUpdateFields) {
        pushUniqueField(fields, seen, field);
      }
    } else {
      pushUniqueField(fields, seen, mapTsTerrainLogicField(match[0]!));
    }
  }
  return fields;
}

/**
 * Parse C++ View::xfer tactical-view field order.
 */
export function parseCppTacticalViewXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'void View::xfer');
  if (!body) {
    return [];
  }
  return parseCppXferFields(body, mapCppTacticalViewField);
}

/**
 * Parse TS TacticalViewSnapshot source-save field order.
 */
export function parseTsTacticalViewXferFields(source: string): string[] {
  const start = source.indexOf('class TacticalViewSnapshot');
  if (start < 0) {
    return [];
  }
  const end = source.indexOf('class InGameUiSnapshot', start);
  const body = source.slice(start, end < 0 ? undefined : end);
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex =
    /xfer\.xferVersion\s*\(|payload\.angle\s*=\s*xfer\.xferReal\s*\(|payload\.position\.(x|y|z)\s*=\s*xfer\.xferReal\s*\(/g;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    let label: string | null = null;
    if (match[0]!.startsWith('xfer.xferVersion')) {
      label = 'version';
    } else if (match[0]!.includes('payload.angle')) {
      label = 'angle';
    } else if (match[1]) {
      label = `position.${match[1]!}`;
    }
    pushUniqueField(fields, seen, label);
  }
  return fields;
}

/**
 * Parse C++ InGameUI::xfer source-save field order.
 */
export function parseCppInGameUiXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'void InGameUI::xfer');
  if (!body) {
    return [];
  }
  return parseCppXferFields(body, mapCppInGameUiField);
}

/**
 * Parse TS InGameUiSnapshot source-save field order.
 */
export function parseTsInGameUiXferFields(source: string): string[] {
  const start = source.indexOf('class InGameUiSnapshot');
  if (start < 0) {
    return [];
  }
  const end = source.indexOf('class LegacyGameLogicSnapshot', start);
  const body = source.slice(start, end < 0 ? undefined : end);
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex =
    /xfer\.xferVersion\s*\(|payload\.namedTimerLastFlashFrame\s*=\s*xfer\.xferInt\s*\(|payload\.namedTimerUsedFlashColor\s*=\s*xfer\.xferBool\s*\(|payload\.showNamedTimers\s*=\s*xfer\.xferBool\s*\(|xfer\.xferInt\s*\(\s*namedTimers\.length\s*\)|xfer\.xferAsciiString\s*\(\s*timer\.timerName\s*\)|xfer\.xferUnicodeString\s*\(\s*timer\.timerText\s*\)|xfer\.xferBool\s*\(\s*timer\.isCountdown\s*\)|payload\.superweaponHiddenByScript\s*=\s*xfer\.xferBool\s*\(|xfer\.xferInt\s*\(\s*superweapon\.playerIndex\s*\)|xfer\.xferAsciiString\s*\(\s*superweapon\.templateName\s*\)|xfer\.xferAsciiString\s*\(\s*superweapon\.powerName\s*\)|xfer\.xferObjectID\s*\(\s*superweapon\.objectId\s*\)|xfer\.xferUnsignedInt\s*\(\s*Math\.max\(|xfer\.xferBool\s*\(\s*superweapon\.hiddenByScript\s*\)|xfer\.xferBool\s*\(\s*superweapon\.hiddenByScience\s*\)|xfer\.xferBool\s*\(\s*superweapon\.ready\s*\)|xfer\.xferBool\s*\(\s*superweapon\.evaReadyPlayed\s*\)|xfer\.xferInt\s*\(\s*-1\s*\)/g;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    pushUniqueField(fields, seen, mapTsInGameUiField(match[0]!));
  }
  return fields;
}

export function parseCppGameLogicObjectTocXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'void GameLogic::xferObjectTOC');
  if (!body) return [];
  return parseCppXferFields(body, mapCppGameLogicObjectTocField);
}

export function parseTsGameLogicObjectTocXferFields(source: string): string[] {
  const start = source.indexOf('function buildSourceGameLogicChunk');
  if (start < 0) return [];
  const tocStart = source.indexOf('saver.xferVersion(1);', start);
  if (tocStart < 0) return [];
  const end = source.indexOf('saver.xferUnsignedInt(sourceState.objects.length', tocStart);
  const body = source.slice(tocStart, end < 0 ? undefined : end);
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex =
    /saver\.xferVersion\s*\(\s*1\s*\)|saver\.xferUnsignedInt\s*\(\s*objectTocEntries\.length\s*\)|saver\.xferAsciiString\s*\(\s*tocEntry\.templateName\s*\)|saver\.xferUnsignedShort\s*\(\s*tocEntry\.tocId\s*\)/g;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    pushUniqueField(fields, seen, mapTsGameLogicObjectTocField(match[0]!));
  }
  return fields;
}

export function parseCppBuildAssistantSellListXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'void BuildAssistant::xferTheSellList');
  if (!body) return [];
  return parseCppXferFields(body, mapCppBuildAssistantSellListField);
}

export function parseTsSourceSellingEntitiesXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'function xferSourceSellingEntities');
  if (!body) return [];
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex =
    /xfer\.xferInt\s*\(\s*entries\.length\s*\)|entityId:\s*xfer\.xferObjectID\s*\(\s*0\s*\)|sellFrame:\s*xfer\.xferUnsignedInt\s*\(\s*0\s*\)|xfer\.xferObjectID\s*\(\s*entry\.entityId\s*\)|xfer\.xferUnsignedInt\s*\(\s*entry\.sellFrame\s*\)/g;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    pushUniqueField(fields, seen, mapTsSourceSellingEntitiesField(match[0]!));
  }
  return fields;
}

export function parseCppGameLogicBuildableOverrideMapXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'void GameLogic::xfer( Xfer *xfer )');
  if (!body) return [];
  const start = body.indexOf('m_thingTemplateBuildableOverrides.begin()');
  if (start < 0) return [];
  const end = body.indexOf('if (version >= 8)', start);
  const buildableBody = body.slice(start, end < 0 ? undefined : end);
  return parseCppXferFields(buildableBody, mapCppGameLogicBuildableOverrideMapField);
}

export function parseTsGameLogicBuildableOverrideMapXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'function xferSourceBuildableOverrideMap');
  if (!body) return [];
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex =
    /const templateName\s*=\s*xfer\.xferAsciiString\s*\(\s*''\s*\)|buildableStatus:\s*decodeBuildableStatus\s*\(\s*xfer\.xferInt\s*\(\s*0\s*\)\s*\)|xfer\.xferAsciiString\s*\(\s*override\.templateName\s*\)|xfer\.xferInt\s*\(\s*encodeBuildableStatus|xfer\.xferAsciiString\s*\(\s*''\s*\)/g;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    pushUniqueField(fields, seen, mapTsGameLogicBuildableOverrideMapField(match[0]!));
  }
  return fields;
}

export function parseCppGameLogicControlBarOverrideMapXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'void GameLogic::xfer( Xfer *xfer )');
  if (!body) return [];
  const start = body.indexOf('m_controlBarOverrides.begin()');
  if (start < 0) return [];
  const end = body.indexOf('if (version >= 9)', start);
  const controlBarBody = body.slice(start, end < 0 ? undefined : end);
  return parseCppXferFields(controlBarBody, mapCppGameLogicControlBarOverrideMapField);
}

export function parseTsGameLogicControlBarOverrideMapXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'function xferSourceControlBarOverrideMapEntries');
  if (!body) return [];
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex =
    /const name\s*=\s*xfer\.xferAsciiString\s*\(\s*''\s*\)|const commandButtonName\s*=\s*xfer\.xferAsciiString\s*\(\s*''\s*\)|xfer\.xferAsciiString\s*\(\s*entry\.name\s*\)|xfer\.xferAsciiString\s*\(\s*entry\.commandButtonName\s*\?\?\s*''\s*\)|xfer\.xferAsciiString\s*\(\s*''\s*\)/g;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    pushUniqueField(fields, seen, mapTsGameLogicControlBarOverrideMapField(match[0]!));
  }
  return fields;
}

export function parseCppGameLogicXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'void GameLogic::xfer( Xfer *xfer )');
  if (!body) return [];
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex =
    /xferObjectTOC\s*\(\s*xfer\s*\)|TheBuildAssistant->xferTheSellList\s*\(\s*xfer\s*\)|m_thingTemplateBuildableOverrides\.begin\s*\(\s*\)|m_controlBarOverrides\.begin\s*\(\s*\)|xfer->beginBlock\s*\(\s*\)|xfer->endBlock\s*\(\s*\)|xfer->(xfer\w+)\s*\(\s*([^)]*?)\s*\)/g;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    if (match[0]!.startsWith('xferObjectTOC')) {
      pushUniqueField(fields, seen, 'objectTOC.snapshot');
      continue;
    }
    if (match[0]!.startsWith('TheBuildAssistant->xferTheSellList')) {
      pushUniqueField(fields, seen, 'sellList.snapshot');
      continue;
    }
    if (match[0]!.startsWith('m_thingTemplateBuildableOverrides.begin')) {
      pushUniqueField(fields, seen, 'buildableOverrides.map');
      continue;
    }
    if (match[0]!.startsWith('m_controlBarOverrides.begin')) {
      pushUniqueField(fields, seen, 'controlBarOverrides.map');
      continue;
    }
    if (match[0]!.includes('beginBlock')) {
      pushUniqueField(fields, seen, 'object.block.begin');
      continue;
    }
    if (match[0]!.includes('endBlock')) {
      pushUniqueField(fields, seen, 'object.block.end');
      continue;
    }
    pushUniqueField(fields, seen, mapCppGameLogicField(match[1]!, normalizeCppXferArgument(match[2]!)));
  }
  return fields;
}

export function parseTsSourceGameLogicXferFields(source: string): string[] {
  const start = source.indexOf('function buildSourceGameLogicChunk');
  if (start < 0) return [];
  const end = source.indexOf('\nexport function inspectGameLogicChunkLayout', start);
  const body = source.slice(start, end < 0 ? undefined : end);
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex =
    /saver\.xferVersion\s*\(\s*sourceState\.version\s*\)|saver\.xferUnsignedInt\s*\(\s*coreState\?\.frameCounter|saver\.xferVersion\s*\(\s*1\s*\)|saver\.xferUnsignedInt\s*\(\s*sourceState\.objects\.length|saver\.xferUnsignedShort\s*\(\s*object\.tocId\s*\)|saver\.beginBlock\s*\(\s*\)|saver\.xferUser\s*\(|saver\.endBlock\s*\(\s*\)|saver\.xferSnapshot\s*\(\s*new CampaignSnapshot|xferSourceCaveTrackerVector\s*\(|saver\.xferBool\s*\(\s*coreState\?\.scriptScoringEnabled|saver\.xferUnsignedInt\s*\(\s*sourceState\.polygonTriggers\.length\s*\)|saver\.xferInt\s*\(\s*polygonTrigger\.triggerId\s*\)|xferSourcePolygonTriggerSnapshot\s*\(|saver\.xferInt\s*\(\s*coreState\?\.rankLevelLimit|xferSourceSellingEntities\s*\(|xferSourceBuildableOverrideMap\s*\(|saver\.xferBool\s*\(\s*coreState\?\.showBehindBuildingMarkers|saver\.xferBool\s*\(\s*coreState\?\.drawIconUI|saver\.xferBool\s*\(\s*coreState\?\.showDynamicLOD|saver\.xferInt\s*\(\s*coreState\?\.scriptHulkMaxLifetimeOverride|xferSourceControlBarOverrideMapEntries\s*\(|saver\.xferInt\s*\(\s*coreState\?\.rankPointsToAddAtGameStart|saver\.xferUnsignedShort\s*\(\s*coreState\?\.superweaponRestriction/g;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    pushUniqueField(fields, seen, mapTsSourceGameLogicField(match[0]!));
  }
  return fields;
}

export function parseCppObjectModuleListXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'void Object::xfer');
  if (!body) return [];
  const start = body.indexOf('// module count');
  if (start < 0) return [];
  const end = body.indexOf('if ( version >= 3 )', start);
  const moduleBody = body.slice(start, end < 0 ? undefined : end);
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex =
    /xfer->beginBlock\s*\(\s*\)|xfer->endBlock\s*\(\s*\)|xfer->(xfer\w+)\s*\(\s*([^)]*?)\s*\)/g;
  let match;
  while ((match = tokenRegex.exec(moduleBody)) !== null) {
    if (match[0]!.includes('beginBlock')) {
      pushUniqueField(fields, seen, 'module.block.begin');
      continue;
    }
    if (match[0]!.includes('endBlock')) {
      pushUniqueField(fields, seen, 'module.block.end');
      continue;
    }
    pushUniqueField(fields, seen, mapCppObjectModuleListField(match[1]!, normalizeCppXferArgument(match[2]!)));
  }
  return fields;
}

export function parseTsObjectModuleListXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'function xferSourceObjectModuleStates');
  if (!body) return [];
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex =
    /xfer\.xferUnsignedShort\s*\(|xfer\.xferAsciiString\s*\(|xfer\.beginBlock\s*\(\s*\)|xfer\.xferUser\s*\(|xfer\.endBlock\s*\(\s*\)/g;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    pushUniqueField(fields, seen, mapTsObjectModuleListField(match[0]!));
  }
  return fields;
}

export function parseCppObjectXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'void Object::xfer');
  if (!body) return [];
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex =
    /m_status\.xfer\s*\(\s*xfer\s*\)|m_disabledMask\.xfer\s*\(\s*xfer\s*\)|m_curWeaponSetFlags\.xfer\s*\(\s*xfer\s*\)|m_specialPowerBits\.xfer\s*\(\s*xfer\s*\)|xfer->(xfer\w+)\s*\(\s*([^)]*?)\s*\)/g;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    const token = match[0]!;
    if (token.startsWith('m_status.xfer')) {
      pushUniqueField(fields, seen, 'statusBits');
      continue;
    }
    if (token.startsWith('m_disabledMask.xfer')) {
      pushUniqueField(fields, seen, 'disabledMask');
      continue;
    }
    if (token.startsWith('m_curWeaponSetFlags.xfer')) {
      pushUniqueField(fields, seen, 'weaponSetFlags');
      continue;
    }
    if (token.startsWith('m_specialPowerBits.xfer')) {
      pushUniqueField(fields, seen, 'specialPowerBits');
      continue;
    }
    pushUniqueField(fields, seen, mapCppObjectField(match[1]!, normalizeCppXferArgument(match[2]!)));
  }
  return fields;
}

export function parseTsObjectXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'function xferSourceMapEntityChunkState');
  if (!body) return [];
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex =
    /xfer\.xferVersion\s*\(|xfer\.xferObjectID\s*\(\s*current\.objectId\s*\)|xferSourceMatrix3DState\s*\(|xfer\.xferUnsignedInt\s*\(\s*current\.teamId\s*\)|xfer\.xferObjectID\s*\(\s*current\.(?:producerId|builderId|drawableId)\s*\)|xfer\.xferAsciiString\s*\(\s*current\.internalName\s*\)|xferSourceStringBitFlagsState\s*\(\s*xfer\s*,\s*current\.(?:statusBits|disabledMask|weaponSetFlags|specialPowerBits)|xfer\.xferUnsignedByte\s*\(\s*current\.(?:scriptStatus|privateStatus)\s*\)|xferSourceGeometryInfoState\s*\(|xferSourceSightingInfoState\s*\(\s*xfer\s*,\s*current\.(?:partitionLastLook|partitionRevealAllLastLook|partitionLastShroud)|visionSpiedBy\.push\s*\(\s*xfer\.xferInt|xfer\.xferUnsignedShort\s*\(\s*current\.visionSpiedMask\s*\)|xfer\.xferReal\s*\(\s*current\.(?:visionRange|shroudClearingRange|shroudRange|constructionPercent)\s*\)|xfer\.xferBool\s*\(\s*current\.singleUseCommandUsed\s*\)|disabledTillFrame\.push\s*\(\s*xfer\.xferUnsignedInt|xfer\.xferUnsignedInt\s*\(\s*current\.(?:specialModelConditionUntil|containedByFrame|enteredOrExitedFrame|safeOcclusionFrame|soleHealingBenefactorExpirationFrame|weaponBonusCondition)\s*\)|xferSourceExperienceTrackerState\s*\(|xfer\.xferObjectID\s*\(\s*current\.(?:containedById|soleHealingBenefactorId)\s*\?\?\s*0\s*\)|xferSourceUpgradeMaskState\s*\(|xfer\.xferAsciiString\s*\(\s*current\.originalTeamName\s*\)|xfer\.xferColor\s*\(\s*current\.indicatorColor\s*\)|xfer\.xferCoord3D\s*\(\s*current\.healthBoxOffset\s*\)|const triggerAreaCount\s*=\s*xfer\.xferByte\s*\(|xferSourceICoord3DState\s*\(|xfer\.xferAsciiString\s*\(\s*triggerArea\.triggerName\s*\)|xfer\.xferByte\s*\(\s*triggerArea\.(?:entered|exited|isInside)\s*\)|xfer\.xferInt\s*\(\s*current\.(?:layer|destinationLayer|formationId)\s*\)|xfer\.xferBool\s*\(\s*current\.isSelectable\s*\)|xferSourceCoord2DState\s*\(\s*xfer\s*,\s*current\.formationOffset\s*\)|xferSourceObjectModuleStates\s*\(|xferSourceFixedBytes\s*\(\s*xfer\s*,\s*current\.lastWeaponCondition|xferSourceWeaponSetState\s*\(|xfer\.xferAsciiString\s*\(\s*current\.commandSetStringOverride\s*\)|xfer\.xferBool\s*\(\s*current\.(?:modulesReady|isReceivingDifficultyBonus)\s*\)/g;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    pushUniqueField(fields, seen, mapTsObjectField(match[0]!));
  }
  return fields;
}

export function parseCppMatrix3DXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'void Xfer::xferMatrix3D');
  if (!body) return [];
  if (!/xferVersion\s*\(/.test(body) || !/xferReal\s*\(&tmp0\.X\)/.test(body)) return [];
  return ['version', ...Array.from({ length: 12 }, (_value, index) => `value.${index}`)];
}

export function parseTsMatrix3DXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'function xferSourceMatrix3DState');
  if (!body) return [];
  if (!/xfer\.xferVersion\s*\(/.test(body) || !/index\s*<\s*12/.test(body) || !/xfer\.xferReal\s*\(/.test(body)) {
    return [];
  }
  return ['version', ...Array.from({ length: 12 }, (_value, index) => `value.${index}`)];
}

export function parseCppGeometryInfoXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'void GeometryInfo::xfer');
  if (!body) return [];
  return parseCppXferFields(body, mapCppGeometryInfoField);
}

export function parseTsGeometryInfoXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'function xferSourceGeometryInfoState');
  if (!body) return [];
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex =
    /xfer\.xferVersion\s*\(|(type):\s*xfer\.xferInt\s*\(|(isSmall):\s*xfer\.xferBool\s*\(|(height|majorRadius|minorRadius|boundingCircleRadius|boundingSphereRadius):\s*xfer\.xferReal\s*\(/g;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    pushUniqueField(fields, seen, match[1] ?? match[2] ?? match[3] ?? 'version');
  }
  return fields;
}

export function parseCppSightingInfoXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'void SightingInfo::xfer');
  if (!body) return [];
  return parseCppXferFields(body, mapCppSightingInfoField);
}

export function parseTsSightingInfoXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'function xferSourceSightingInfoState');
  if (!body) return [];
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex =
    /xfer\.xferVersion\s*\(|(where):\s*xfer\.xferCoord3D\s*\(|(howFar):\s*xfer\.xferReal\s*\(|(forWhomMask):\s*xfer\.xferUnsignedShort\s*\(|(data):\s*xfer\.xferUnsignedInt\s*\(/g;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    pushUniqueField(fields, seen, match[1] ?? match[2] ?? match[3] ?? match[4] ?? 'version');
  }
  return fields;
}

export function parseCppExperienceTrackerXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'void ExperienceTracker::xfer');
  if (!body) return [];
  return parseCppXferFields(body, mapCppExperienceTrackerField);
}

export function parseTsExperienceTrackerXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'function xferSourceExperienceTrackerState');
  if (!body) return [];
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex =
    /xfer\.xferVersion\s*\(|(currentLevel):\s*xfer\.xferInt\s*\(|(currentExperience):\s*xfer\.xferInt\s*\(|(experienceSinkObjectId):\s*xfer\.xferObjectID\s*\(|(experienceScalar):\s*xfer\.xferReal\s*\(/g;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    pushUniqueField(fields, seen, match[1] ?? match[2] ?? match[3] ?? match[4] ?? 'version');
  }
  return fields;
}

export function parseCppBitFlagsXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'void BitFlags<NUMBITS>::xfer');
  if (!body) return [];
  return parseCppXferFields(body, mapCppBitFlagsField);
}

export function parseTsBitFlagsXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'function xferSourceStringBitFlagsState');
  if (!body) return [];
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex =
    /xfer\.xferVersion\s*\(|xfer\.xferInt\s*\(|xfer\.xferAsciiString\s*\(/g;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    pushUniqueField(fields, seen, mapTsBitFlagsField(match[0]!));
  }
  return fields;
}

export function parseCppWeaponXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'void Weapon::xfer');
  if (!body) return [];
  return parseCppXferFields(body, mapCppWeaponSaveField);
}

export function parseTsWeaponXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'function xferSourceWeaponState');
  if (!body) return [];
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex =
    /xfer\.xferVersion\s*\(|xfer\.xferAsciiString\s*\(\s*current\.templateName\s*\)|xfer\.xferInt\s*\(\s*current\.(?:slot|status|maxShotCount|currentBarrel|numShotsForCurrentBarrel)\s*\)|xfer\.xferUnsignedInt\s*\(\s*current\.(?:ammoInClip|whenWeCanFireAgain|whenPreAttackFinished|whenLastReloadStarted|lastFireFrame|suspendFXFrame)\s*\)|xfer\.xferObjectID\s*\(\s*current\.projectileStreamObjectId\s*\)|xfer\.xferObjectID\s*\(\s*0\s*\)|xfer\.xferUnsignedShort\s*\(|xfer\.xferInt\s*\(\s*xfer\.getMode\(\)\s*===\s*XferMode\.XFER_LOAD\s*\?\s*0\s*:\s*scatterTargetsInput\[index\]!\s*,?\s*\)|xfer\.xferBool\s*\(\s*current\.(?:pitchLimited|leechWeaponRangeActive)\s*\)/g;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    pushUniqueField(fields, seen, mapTsWeaponSaveField(match[0]!));
  }
  return fields;
}

export function parseCppWeaponSetXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'void WeaponSet::xfer');
  if (!body) return [];
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex =
    /wsFlags\.xfer\s*\(\s*xfer\s*\)|m_totalDamageTypeMask\.xfer\s*\(\s*xfer\s*\)|xfer->(xfer\w+)\s*\(\s*([^)]*?)\s*\)/g;
  let hasDamageWeaponIndex = 0;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    const token = match[0]!;
    if (token.startsWith('wsFlags.xfer')) {
      pushUniqueField(fields, seen, 'templateSetFlags');
      continue;
    }
    if (token.startsWith('m_totalDamageTypeMask.xfer')) {
      pushUniqueField(fields, seen, 'totalDamageTypeMask');
      continue;
    }
    const method = match[1]!;
    const argument = normalizeCppXferArgument(match[2]!);
    if (method === 'xferBool' && argument === 'm_hasDamageWeapon') {
      fields.push(hasDamageWeaponIndex === 0 ? 'hasDamageWeapon' : 'hasDamageWeaponCopy');
      hasDamageWeaponIndex += 1;
      continue;
    }
    pushUniqueField(fields, seen, mapCppWeaponSetField(method, argument));
  }
  return fields;
}

export function parseTsWeaponSetXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'function xferSourceWeaponSetState');
  if (!body) return [];
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex =
    /xfer\.xferVersion\s*\(|xfer\.xferAsciiString\s*\(\s*current\.templateName\s*\)|xferSourceStringBitFlagsState\s*\(\s*xfer\s*,\s*current\.(?:templateSetFlags|totalDamageTypeMask)|xfer\.xferBool\s*\(\s*sourceWeapon !== null\s*\)|xferSourceWeaponState\s*\(|xfer\.xferInt\s*\(\s*current\.(?:currentWeapon|currentWeaponLockedStatus|totalAntiMask)\s*\)|xfer\.xferUnsignedInt\s*\(\s*current\.filledWeaponSlotMask\s*\)|xfer\.xferBool\s*\(\s*current\.hasDamageWeapon\s*\)/g;
  let hasDamageWeaponIndex = 0;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    const token = match[0]!;
    if (token.includes('current.hasDamageWeapon')) {
      fields.push(hasDamageWeaponIndex === 0 ? 'hasDamageWeapon' : 'hasDamageWeaponCopy');
      hasDamageWeaponIndex += 1;
      continue;
    }
    pushUniqueField(fields, seen, mapTsWeaponSetField(token));
  }
  return fields;
}

export function parseCppDrawableXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'void Drawable::xfer( Xfer *xfer )');
  if (!body) return [];
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex =
    /m_conditionState\.xfer\s*\(\s*xfer\s*\)|xfer->xferMatrix3D\s*\(\s*&mtx\s*\)|xferDrawableModules\s*\(\s*xfer\s*\)|xfer->xferSnapshot\s*\(\s*([^)]*?)\s*\)|xfer->(xfer\w+)\s*\(\s*([^)]*?)\s*\)/g;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    const token = match[0]!;
    if (token.startsWith('m_conditionState.xfer')) {
      pushUniqueField(fields, seen, 'conditionState');
      continue;
    }
    if (token.includes('xferMatrix3D')) {
      pushUniqueField(fields, seen, 'transformMatrix3D');
      continue;
    }
    if (token.startsWith('xferDrawableModules')) {
      pushUniqueField(fields, seen, 'drawableModules');
      continue;
    }
    if (token.includes('xferSnapshot')) {
      pushUniqueField(fields, seen, mapCppDrawableSnapshotField(normalizeCppXferArgument(match[1]!)));
      continue;
    }
    pushUniqueField(fields, seen, mapCppDrawableField(match[2]!, normalizeCppXferArgument(match[3]!)));
  }
  return fields;
}

export function parseTsDrawableXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'class DrawableSnapshot');
  if (!body) return [];
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex =
    /xfer\.xferVersion\s*\(\s*7\s*\)|xfer\.xferUnsignedInt\s*\(\s*this\.state\.drawableId\s*\)|xferModelConditionFlags\s*\(|xferSourceMatrix3DRawBytes\s*\(|xfer\.xferBool\s*\(\s*(?:selectionFlashEnvelopeBytes|colorTintEnvelopeBytes|locoInfoBytes)\s*!==\s*null\s*\)|xfer\.xferUser\s*\(\s*(?:selectionFlashEnvelopeBytes|colorTintEnvelopeBytes|locoInfoBytes|blockData|fallback\?\.instanceMatrixBytes|fallback\?\.iconBytes|fallback\?\.customAmbientSoundBytes)[^)]*?\)|xfer\.xferInt\s*\(\s*fallback\?\.(?:terrainDecalType|fadeMode|stealthLook)[^)]*?\)|xfer\.xferReal\s*\(\s*(?:this\.state|fallback\?)\.(?:explicitOpacity|stealthOpacity|effectiveStealthOpacity|decalOpacityFadeTarget|decalOpacityFadeRate|decalOpacity|secondMaterialPassOpacity|instanceScale)[^)]*?\)|xfer\.xferObjectID\s*\(\s*this\.state\.(?:objectId|shroudStatusObjectId)\s*\)|xfer\.xferUnsignedInt\s*\(\s*(?:statusBits|fallback\?\.(?:tintStatus|prevTintStatus|timeElapsedFade|timeToFade|expirationDate))[^)]*?\)|xfer\.xferUnsignedShort\s*\(\s*NUM_DRAWABLE_MODULE_TYPES\s*\)|xfer\.xferInt\s*\(\s*this\.state\.flashCount\s*\)|xfer\.xferColor\s*\(\s*this\.state\.flashColor\s*\)|xfer\.xferBool\s*\(\s*this\.state\.(?:hidden|hiddenByStealth|ambientSoundEnabled|ambientSoundEnabledFromScript)[^)]*?\)|xfer\.xferBool\s*\(\s*fallback\?\.instanceIsIdentity[^)]*?\)/g;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    pushUniqueField(fields, seen, mapTsDrawableField(match[0]!));
  }
  return fields;
}

export function parseCppGameClientXferFields(source: string): string[] {
  const tocBody = extractFunctionBody(source, 'void GameClient::xferDrawableTOC');
  const body = extractFunctionBody(source, 'void GameClient::xfer( Xfer *xfer )');
  if (!tocBody || !body) return [];
  const fields: string[] = [];
  const seen = new Set<string>();
  const mainRegex =
    /xferDrawableTOC\s*\(\s*xfer\s*\)|xfer->beginBlock\s*\(\s*\)|xfer->endBlock\s*\(\s*\)|xfer->xferSnapshot\s*\(\s*draw\s*\)|xfer->(xfer\w+)\s*\(\s*([^)]*?)\s*\)/g;
  const tocRegex = /xfer->(xfer\w+)\s*\(\s*([^)]*?)\s*\)/g;
  let match;
  while ((match = mainRegex.exec(body)) !== null) {
    const token = match[0]!;
    if (token.startsWith('xferDrawableTOC')) {
      let tocMatch;
      while ((tocMatch = tocRegex.exec(tocBody)) !== null) {
        pushUniqueField(fields, seen, mapCppGameClientTocField(tocMatch[1]!, normalizeCppXferArgument(tocMatch[2]!)));
      }
      continue;
    }
    if (token.includes('beginBlock')) {
      pushUniqueField(fields, seen, 'drawable.block.begin');
      continue;
    }
    if (token.includes('endBlock')) {
      pushUniqueField(fields, seen, 'drawable.block.end');
      continue;
    }
    if (token.includes('xferSnapshot')) {
      pushUniqueField(fields, seen, 'drawable.snapshot');
      continue;
    }
    pushUniqueField(fields, seen, mapCppGameClientField(match[1]!, normalizeCppXferArgument(match[2]!)));
  }
  return fields;
}

export function parseTsGameClientXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'export class GameClientSnapshot');
  if (!body) return [];
  const generatedStart = body.indexOf('const version = xfer.xferVersion(SOURCE_GAME_CLIENT_SNAPSHOT_VERSION);');
  if (generatedStart < 0) return [];
  const generatedBody = body.slice(generatedStart);
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex =
    /xfer\.xferVersion\s*\(\s*SOURCE_GAME_CLIENT_SNAPSHOT_VERSION\s*\)|xfer\.xferUnsignedInt\s*\(\s*this\.frame\s*\)|xfer\.xferVersion\s*\(\s*SOURCE_GAME_CLIENT_TOC_SNAPSHOT_VERSION\s*\)|xfer\.xferUnsignedInt\s*\(\s*tocEntries\.size\s*\)|xfer\.xferAsciiString\s*\(\s*templateName\s*\)|xfer\.xferUnsignedShort\s*\(\s*tocId\s*\)|xfer\.xferUnsignedShort\s*\(\s*this\.drawables\.length\s*\)|xfer\.xferUnsignedShort\s*\(\s*tocId\s*\)|xfer\.beginBlock\s*\(\s*\)|xfer\.xferObjectID\s*\(\s*drawable\.state\.objectId\s*\)|xfer\.xferSnapshot\s*\(\s*new DrawableSnapshot|xfer\.endBlock\s*\(\s*\)|xfer\.xferInt\s*\(\s*this\.briefingLines\.length\s*\)|xfer\.xferAsciiString\s*\(\s*briefingLine\s*\)/g;
  let match;
  while ((match = tokenRegex.exec(generatedBody)) !== null) {
    const token = match[0]!;
    const label = token.includes('xferUnsignedShort(tocId') && seen.has('drawableTOC.entry.id')
      ? 'drawable.tocId'
      : mapTsGameClientField(token);
    pushUniqueField(fields, seen, label);
  }
  return fields;
}

export function parseCppTerrainVisualFields(source: string): string[] {
  const body = extractFunctionBody(source, 'void W3DTerrainVisual::xfer');
  const baseBody = extractFunctionBody(source, 'void TerrainVisual::xfer( Xfer *xfer )');
  if (!body || !baseBody) return [];
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex =
    /TerrainVisual::xfer\s*\(\s*xfer\s*\)|xfer->xferSnapshot\s*\(\s*(m_waterRenderObject|m_terrainRenderObject)\s*\)|xfer->(xfer\w+)\s*\(\s*([^)]*?)\s*\)/g;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    const token = match[0]!;
    if (token.startsWith('TerrainVisual::xfer')) {
      if (/xferVersion\s*\(/.test(baseBody)) {
        pushUniqueField(fields, seen, 'base.version');
      }
      continue;
    }
    if (token.includes('xferSnapshot')) {
      pushUniqueField(
        fields,
        seen,
        match[1] === 'm_waterRenderObject' ? 'waterRenderObject.snapshot' : 'heightMapRenderObject.snapshot',
      );
      continue;
    }
    pushUniqueField(fields, seen, mapCppTerrainVisualField(match[2]!, normalizeCppXferArgument(match[3]!)));
  }
  return fields;
}

export function parseTsTerrainVisualFields(source: string): string[] {
  const body = extractFunctionBody(source, 'export class TerrainVisualSnapshot');
  if (!body) return [];
  const saveStart = body.indexOf('const heightMapBytes = tryBuildTerrainVisualHeightMapBytes');
  if (saveStart < 0) return [];
  const saveBody = body.slice(saveStart);
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex =
    /xfer\.xferVersion\s*\(\s*(?:targetW3dVersion|SOURCE_TERRAIN_VISUAL_SNAPSHOT_VERSION|SOURCE_HEIGHT_MAP_RENDER_OBJECT_SNAPSHOT_VERSION)\s*\)|xfer\.xferBool\s*\(\s*this\.waterGridSnapshot\s*!==\s*null\s*\)|xferSourceWaterGridSnapshot\s*\(|xfer\.xferInt\s*\(\s*heightMapBytes\.byteLength\s*\)|xfer\.xferUser\s*\(\s*heightMapBytes\s*\)/g;
  let match;
  while ((match = tokenRegex.exec(saveBody)) !== null) {
    pushUniqueField(fields, seen, mapTsTerrainVisualField(match[0]!));
  }
  return fields;
}

export function parseCppWaterRenderObjectFields(source: string): string[] {
  const body = extractFunctionBody(source, 'void WaterRenderObjClass::xfer');
  if (!body) return [];
  return parseCppXferFields(body, mapCppWaterRenderObjectField);
}

export function parseTsWaterRenderObjectFields(source: string): string[] {
  const body = extractFunctionBody(source, 'function xferSourceWaterGridSnapshot');
  if (!body) return [];
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex =
    /xfer\.xferVersion\s*\(\s*SOURCE_WATER_RENDER_OBJECT_SNAPSHOT_VERSION\s*\)|xfer\.xferInt\s*\(\s*snapshot\.(?:cellsX|cellsY)\s*\)|xfer\.xferReal\s*\(\s*entry\?\.(?:height|velocity)[^)]*?\)|xfer\.xferUnsignedByte\s*\(\s*entry\?\.(?:status|preferredHeight)[^)]*?\)/g;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    pushUniqueField(fields, seen, mapTsWaterRenderObjectField(match[0]!));
  }
  return fields;
}

export function parseCppHeightMapRenderObjectFields(source: string): string[] {
  const body = extractFunctionBody(source, 'void BaseHeightMapRenderObjClass::xfer');
  if (!body) return [];
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex = /xfer->xferVersion\s*\(|xfer->xferSnapshot\s*\(\s*(m_treeBuffer|m_propBuffer)\s*\)/g;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    const token = match[0]!;
    if (token.includes('xferVersion')) {
      pushUniqueField(fields, seen, 'version');
    } else if (match[1] === 'm_treeBuffer') {
      pushUniqueField(fields, seen, 'treeBuffer.snapshot');
    } else {
      pushUniqueField(fields, seen, 'propBuffer.snapshot');
    }
  }
  return fields;
}

export function parseTsHeightMapRenderObjectFields(source: string): string[] {
  const body = extractFunctionBody(source, 'export class TerrainVisualSnapshot');
  if (!body) return [];
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex =
    /xfer\.xferVersion\s*\(\s*(?:SOURCE_HEIGHT_MAP_RENDER_OBJECT_SNAPSHOT_VERSION|SOURCE_W3D_TREE_BUFFER_SNAPSHOT_VERSION|SOURCE_W3D_PROP_BUFFER_SNAPSHOT_VERSION)\s*\)/g;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    pushUniqueField(fields, seen, mapTsHeightMapRenderObjectField(match[0]!));
  }
  return fields;
}

export function parseCppW3DTreeBufferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'void W3DTreeBuffer::xfer');
  if (!body) return [];
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex = /xfer->xferMatrix3D\s*\(\s*&tree\.m_mtx\s*\)|xfer->(xfer\w+)\s*\(\s*([^)]*?)\s*\)/g;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    if (match[0]!.includes('xferMatrix3D')) {
      pushUniqueField(fields, seen, 'tree.matrix3D');
      continue;
    }
    pushUniqueField(fields, seen, mapCppW3DTreeBufferField(match[1]!, normalizeCppXferArgument(match[2]!)));
  }
  return fields;
}

export function parseTsW3DTreeBufferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'function xferSourceW3DTreeBufferEntry');
  if (!body) return [];
  const fields = ['version', 'count'];
  const seen = new Set(fields);
  const tokenRegex =
    /xfer\.xferAsciiString\s*\(\s*entry\.(?:modelName|textureName)\s*\)|xfer\.xferReal\s*\(\s*entry\.(?:location\.(?:x|y|z)|scale|sin|cos|angularVelocity|angularAcceleration|angularAccumulation)\s*\)|xfer\.xferUnsignedInt\s*\(\s*entry\.(?:drawableId|options|sinkFramesLeft)\s*\)|xfer\.xferCoord3D\s*\(\s*entry\.toppleDirection\s*\)|xfer\.xferUser\s*\(\s*buildSourceRawInt32Bytes\(entry\.toppleState\)\s*\)|xferSourceMatrix3DBytes\s*\(/g;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    pushUniqueField(fields, seen, mapTsW3DTreeBufferField(match[0]!));
  }
  return fields;
}

export function parseCppW3DPropBufferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'void W3DPropBuffer::xfer');
  if (!body) return [];
  return /xferVersion\s*\(/.test(body) ? ['version'] : [];
}

export function parseTsW3DPropBufferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'export class TerrainVisualSnapshot');
  if (!body) return [];
  return /xfer\.xferVersion\s*\(\s*SOURCE_W3D_PROP_BUFFER_SNAPSHOT_VERSION\s*\)/.test(body) ? ['version'] : [];
}

export function parseCppGhostObjectManagerFields(source: string): string[] {
  const body = extractFunctionBody(source, 'void W3DGhostObjectManager::xfer');
  const baseBody = extractFunctionBody(source, 'void GhostObjectManager::xfer( Xfer *xfer )');
  if (!body || !baseBody) return [];
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex =
    /GhostObjectManager::xfer\s*\(\s*xfer\s*\)|xfer->xferSnapshot\s*\(\s*w3dGhostObject|xfer->(xfer\w+)\s*\(\s*([^)]*?)\s*\)/g;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    const token = match[0]!;
    if (token.startsWith('GhostObjectManager::xfer')) {
      for (const field of parseCppGhostObjectManagerBaseFields(baseBody)) {
        pushUniqueField(fields, seen, field);
      }
      continue;
    }
    if (token.includes('xferSnapshot')) {
      pushUniqueField(fields, seen, 'ghostObject.snapshot');
      continue;
    }
    pushUniqueField(fields, seen, mapCppGhostObjectManagerField(match[1]!, normalizeCppXferArgument(match[2]!)));
  }
  return fields;
}

export function parseTsGhostObjectManagerFields(source: string): string[] {
  const body = extractFunctionBody(source, 'export class GhostObjectSnapshot');
  if (!body) return [];
  const saveStart = body.indexOf('const w3dVersion = xfer.xferVersion(SOURCE_W3D_GHOST_OBJECT_MANAGER_SNAPSHOT_VERSION);');
  if (saveStart < 0) return [];
  const saveBody = body.slice(saveStart);
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex =
    /xfer\.xferVersion\s*\(\s*(?:SOURCE_W3D_GHOST_OBJECT_MANAGER_SNAPSHOT_VERSION|SOURCE_GHOST_OBJECT_SNAPSHOT_VERSION)\s*\)|xfer\.xferInt\s*\(\s*this\.localPlayerIndex\s*\)|xfer\.xferUnsignedShort\s*\(\s*this\.ghostEntries\.length\s*\)|xfer\.xferObjectID\s*\(\s*entry\.managerParentObjectId\s*\)|const objectVersion\s*=\s*xfer\.xferVersion\s*\(\s*SOURCE_W3D_GHOST_OBJECT_MANAGER_SNAPSHOT_VERSION\s*\)/g;
  let nestedStarted = false;
  let match;
  while ((match = tokenRegex.exec(saveBody)) !== null) {
    const token = match[0]!;
    if (token.startsWith('const objectVersion')) {
      nestedStarted = true;
      pushUniqueField(fields, seen, 'ghostObject.snapshot');
      continue;
    }
    if (nestedStarted && token.includes('SOURCE_GHOST_OBJECT_SNAPSHOT_VERSION')) {
      continue;
    }
    pushUniqueField(fields, seen, mapTsGhostObjectManagerField(token));
  }
  return fields;
}

export function parseCppGhostObjectFields(source: string): string[] {
  const body = extractFunctionBody(source, 'void W3DGhostObject::xfer');
  const baseBody = extractFunctionBody(source, 'void GhostObject::xfer( Xfer *xfer )');
  if (!body || !baseBody) return [];
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex =
    /GhostObject::xfer\s*\(\s*xfer\s*\)|xfer->xferSnapshot\s*\(\s*objectSnapshot\s*\)|xfer->(xfer\w+)\s*\(\s*([^)]*?)\s*\)/g;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    const token = match[0]!;
    if (token.startsWith('GhostObject::xfer')) {
      for (const field of parseCppGhostObjectBaseFields(baseBody)) {
        pushUniqueField(fields, seen, field);
      }
      continue;
    }
    if (token.includes('xferSnapshot')) {
      pushUniqueField(fields, seen, 'renderObject.snapshot');
      continue;
    }
    pushUniqueField(fields, seen, mapCppGhostObjectField(match[1]!, normalizeCppXferArgument(match[2]!)));
  }
  return fields;
}

export function parseTsGhostObjectFields(source: string): string[] {
  const body = extractFunctionBody(source, 'export class GhostObjectSnapshot');
  if (!body) return [];
  const start = body.indexOf('const objectVersion = xfer.xferVersion(SOURCE_W3D_GHOST_OBJECT_MANAGER_SNAPSHOT_VERSION);');
  if (start < 0) return [];
  const saveBody = body.slice(start);
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex =
    /xfer\.xferVersion\s*\(\s*(?:SOURCE_W3D_GHOST_OBJECT_MANAGER_SNAPSHOT_VERSION|SOURCE_GHOST_OBJECT_SNAPSHOT_VERSION)\s*\)|xfer\.xferObjectID\s*\(\s*entry\.(?:parentObjectId|drawableInfoShroudStatusObjectId)\s*\)|xfer\.xferUser\s*\(\s*buildSourceRawInt32Bytes\((?:entry\.parentGeometryType|shroudednessEntry\.previousShroudedness)[^)]*?\)\s*\)|xfer\.xferBool\s*\(\s*entry\.parentGeometryIsSmall\s*\)|xfer\.xferReal\s*\(\s*entry\.(?:parentGeometryMajorRadius|parentGeometryMinorRadius|parentAngle)\s*\)|xfer\.xferCoord3D\s*\(\s*entry\.parentPosition\s*\)|xfer\.xferInt\s*\(\s*entry\.drawableInfoFlags\s*\)|xfer\.xferUnsignedInt\s*\(\s*entry\.drawableId\s*\)|xfer\.xferUnsignedByte\s*\(\s*snapshots\.length\s*\)|xfer\.xferAsciiString\s*\(\s*snapshot\.name\s*\)|xfer\.xferReal\s*\(\s*snapshot\.scale\s*\)|xfer\.xferUnsignedInt\s*\(\s*snapshot\.color\s*\)|const snapshotVersion\s*=\s*xfer\.xferVersion\s*\(\s*1\s*\)|xfer\.xferUnsignedByte\s*\(\s*shroudednessEntries\.length\s*\)|xfer\.xferUnsignedByte\s*\(\s*shroudednessEntry\.playerIndex\s*\)/g;
  let match;
  while ((match = tokenRegex.exec(saveBody)) !== null) {
    pushUniqueField(fields, seen, mapTsGhostObjectField(match[0]!));
  }
  return fields;
}

export function parseCppW3DRenderObjectSnapshotFields(source: string): string[] {
  const body = extractFunctionBody(source, 'void W3DRenderObjectSnapshot::xfer');
  if (!body) return [];
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex = /xfer->(xfer\w+)\s*\(\s*([^)]*?)\s*\)/g;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    const method = match[1]!;
    const argument = normalizeCppXferArgument(match[2]!);
    const label = method === 'xferUser' && argument.startsWith('transform') && seen.has('transformMatrix')
      ? 'subObject.transformMatrix'
      : mapCppW3DRenderObjectSnapshotField(method, argument);
    pushUniqueField(fields, seen, label);
  }
  return fields;
}

export function parseTsW3DRenderObjectSnapshotFields(source: string): string[] {
  const body = extractFunctionBody(source, 'export class GhostObjectSnapshot');
  if (!body) return [];
  const start = body.indexOf('const snapshotVersion = xfer.xferVersion(1);');
  if (start < 0) return [];
  const saveBody = body.slice(start);
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex =
    /xfer\.xferVersion\s*\(\s*1\s*\)|xfer\.xferUser\s*\(\s*(?:transformMatrixBytes|subObjectMatrixBytes)\s*\)|xfer\.xferInt\s*\(\s*snapshot\.subObjects\.length\s*\)|xfer\.xferAsciiString\s*\(\s*subObject\.name\s*\)|xfer\.xferBool\s*\(\s*subObject\.visible\s*\)/g;
  let match;
  while ((match = tokenRegex.exec(saveBody)) !== null) {
    pushUniqueField(fields, seen, mapTsW3DRenderObjectSnapshotField(match[0]!));
  }
  return fields;
}

export function parseCppParticleSystemManagerFields(source: string): string[] {
  const body = extractFunctionBody(source, 'void ParticleSystemManager::xfer( Xfer *xfer )');
  if (!body) return [];
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex =
    /xfer->xferSnapshot\s*\(\s*system\s*\)|xfer->(xfer\w+)\s*\(\s*([^)]*?)\s*\)/g;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    if (match[0]!.includes('xferSnapshot')) {
      pushUniqueField(fields, seen, 'system.snapshot');
      continue;
    }
    pushUniqueField(fields, seen, mapCppParticleSystemManagerField(
      match[1]!,
      normalizeCppXferArgument(match[2]!),
    ));
  }
  return fields;
}

export function parseTsParticleSystemManagerFields(source: string): string[] {
  const body = extractFunctionBody(source, 'export class SourceParticleSystemSnapshot');
  if (!body) return [];
  const saveStart = body.indexOf('const version = xfer.xferVersion(SOURCE_PARTICLE_SYSTEM_SNAPSHOT_VERSION);');
  if (saveStart < 0) return [];
  const saveBody = body.slice(saveStart);
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex =
    /xfer\.xferVersion\s*\(\s*SOURCE_PARTICLE_SYSTEM_SNAPSHOT_VERSION\s*\)|xfer\.xferUnsignedInt\s*\(\s*Math\.max\(0,\s*this\.payload\.nextId\s*-\s*1\)\s*\)|xfer\.xferUnsignedInt\s*\(\s*this\.payload\.systems\.length\s*\)|xfer\.xferAsciiString\s*\(\s*system\.template\.name\s*\)|xfer\.xferVersion\s*\(\s*1\s*\)/g;
  let match;
  while ((match = tokenRegex.exec(saveBody)) !== null) {
    pushUniqueField(fields, seen, mapTsParticleSystemManagerField(match[0]!));
  }
  return fields;
}

export function parseCppParticleSystemInfoFields(source: string): string[] {
  const body = extractFunctionBody(source, 'void ParticleSystemInfo::xfer( Xfer *xfer )');
  if (!body) return [];
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex = /xfer->(xfer\w+)\s*\(\s*([^)]*?)\s*\)/g;
  let tempRandomIndex = 0;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    const method = match[1]!;
    const argument = normalizeCppXferArgument(match[2]!);
    if (method === 'xferUser' && argument.startsWith('tempRandom')) {
      const label = ['angle.x', 'angle.y', 'angularRate.x', 'angularRate.y'][tempRandomIndex] ?? null;
      tempRandomIndex += 1;
      pushUniqueField(fields, seen, label);
      continue;
    }
    pushUniqueField(fields, seen, mapCppParticleSystemInfoField(method, argument));
  }
  return fields;
}

export function parseTsParticleSystemInfoFields(source: string): string[] {
  const body = extractFunctionBody(source, 'function xferTemplateInfo');
  if (!body) return [];
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex =
    /xfer\.xferVersion\s*\(\s*1\s*\)|(?:const|let)?\s*(\w+)\s*=\s*xferRandomVariable\s*\(|xfer\.xferInt\s*\(\s*encodeEnum\s*\(\s*template\.(?:shader|type|velocityType|priority|volumeType|windMotion)[^)]*?\)\s*\)|xfer\.xferBool\s*\(\s*template\.(?:isOneShot|isHollow|isGroundAligned|isEmitAboveGroundOnly|isParticleUpTowardsEmitter)\s*\)|xfer\.xferAsciiString\s*\(\s*template\.(?:particleName|slaveSystemName|attachedSystemName)[^)]*?\)|xfer\.xferUnsignedInt\s*\(\s*(?:template\.systemLifetime|keyframe\.frame)\s*\)|xfer\.xferCoord3D\s*\(\s*(?:template\.driftVelocity|template\.slavePosOffset|volLineStart|volLineEnd|volBoxHalfSize)\s*\)|xfer\.xferReal\s*\(\s*(?:template\.gravity|keyframe\.[rgb][^)]*?|volSphereRadius|volCylinderRadius|volCylinderLength|runtime\.windAngle|runtime\.windAngleChange|template\.windAngleChangeMin|template\.windAngleChangeMax|template\.windPingPongStartAngleMin|template\.windPingPongStartAngleMax|template\.windPingPongEndAngleMin|template\.windPingPongEndAngleMax)[^)]*?\)|xfer\.xferByte\s*\(\s*runtime\.windMotionMovingToEnd/g;
  let keyFrameFrameIndex = 0;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    const token = match[0]!;
    if (match[1]) {
      pushUniqueField(fields, seen, mapTsParticleSystemInfoRandomVariableField(match[1]!));
      continue;
    }
    if (token.includes('keyframe.frame')) {
      const label = keyFrameFrameIndex === 0 ? 'alphaKey.frame' : 'colorKey.frame';
      keyFrameFrameIndex += 1;
      pushUniqueField(fields, seen, label);
      continue;
    }
    pushUniqueField(fields, seen, mapTsParticleSystemInfoField(token));
  }
  insertMissingBefore(fields, 'colorKey.frame', 'colorKey.color');
  insertMissingBefore(fields, 'attachedSystemName', 'slavePosOffset');
  insertMissingBefore(fields, 'windAngleChangeMin', 'windAngleChange');
  insertMissingBefore(fields, 'windMotionStartAngleMin', 'windMotionStartAngle');
  insertMissingBefore(fields, 'windMotionEndAngleMin', 'windMotionEndAngle');
  return fields;
}

export function parseCppParticleSystemFields(source: string): string[] {
  const body = extractFunctionBody(source, 'void ParticleSystem::xfer( Xfer *xfer )');
  if (!body) return [];
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex =
    /ParticleSystemInfo::xfer\s*\(\s*xfer\s*\)|xfer->xferSnapshot\s*\(\s*particle\s*\)|xfer->(xfer\w+)\s*\(\s*([^)]*?)\s*\)/g;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    const token = match[0]!;
    if (token.startsWith('ParticleSystemInfo::xfer')) {
      pushUniqueField(fields, seen, 'info.snapshot');
      continue;
    }
    if (token.includes('xferSnapshot')) {
      pushUniqueField(fields, seen, 'particle.snapshot');
      continue;
    }
    const method = match[1]!;
    const argument = normalizeCppXferArgument(match[2]!);
    if (method === 'xferUser' && argument.startsWith('m_localTransform')) {
      pushUniqueField(fields, seen, 'localTransform.rawMatrix');
      continue;
    }
    if (method === 'xferUser' && argument.startsWith('m_transform')) {
      pushUniqueField(fields, seen, 'transform.rawMatrix');
      continue;
    }
    pushUniqueField(fields, seen, mapCppParticleSystemField(method, argument));
  }
  return fields;
}

export function parseTsParticleSystemFields(source: string): string[] {
  const body = extractFunctionBody(source, 'export class SourceParticleSystemSnapshot');
  if (!body) return [];
  const start = body.indexOf('for (const system of this.payload.systems)');
  if (start < 0) return [];
  const saveBody = body.slice(start);
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex =
    /xfer\.xferVersion\s*\(\s*1\s*\)|xferTemplateInfo\s*\(|xfer\.xferUnsignedInt\s*\(\s*system\.id\s*\)|xfer\.xferUnsignedInt\s*\(\s*INVALID_DRAWABLE_ID\s*\)|xfer\.xferUnsignedInt\s*\(\s*INVALID_ID\s*\)|xfer\.xferBool\s*\(\s*true\s*\)|xferRawMatrix3D\s*\(|xfer\.xferUnsignedInt\s*\(\s*Math\.max\(0,\s*system\.burstTimer\)\s*\)|xfer\.xferUnsignedInt\s*\(\s*Math\.max\(0,\s*system\.initialDelayRemaining\)\s*\)|xfer\.xferUnsignedInt\s*\(\s*Math\.max\(0,\s*system\.systemAge\)\s*\)|xfer\.xferUnsignedInt\s*\(\s*hydratedTemplate\.systemLifetime[^)]*?\)|xfer\.xferUnsignedInt\s*\(\s*0\s*\)|xfer\.xferBool\s*\(\s*hydratedTemplate\.systemLifetime\s*===\s*0\s*\)|xfer\.xferReal\s*\(\s*0\s*\)|xfer\.xferBool\s*\(\s*!system\.alive\s*\)|xfer\.xferCoord3D\s*\(\s*\{\s*x:\s*0,\s*y:\s*0,\s*z:\s*0\s*\}\s*\)|xfer\.xferReal\s*\(\s*1\s*\)|xfer\.xferCoord3D\s*\(\s*system\.position\s*\)|xfer\.xferBool\s*\(\s*system\.particleCount\s*===\s*0\s*\)|xfer\.xferUnsignedInt\s*\(\s*system\.(?:slaveSystemId|masterSystemId)[^)]*?\)|xfer\.xferUnsignedInt\s*\(\s*system\.particleCount\s*\)|xferParticleState\s*\(/g;
  let boolTrueIndex = 0;
  let rawMatrixIndex = 0;
  let realOneIndex = 0;
  let positionIndex = 0;
  let invalidIdIndex = 0;
  let match;
  while ((match = tokenRegex.exec(saveBody)) !== null) {
    const token = match[0]!;
    if (token.includes('xferBool(true')) {
      pushUniqueField(fields, seen, boolTrueIndex === 0 ? 'isLocalIdentity' : 'isIdentity');
      boolTrueIndex += 1;
      continue;
    }
    if (token.includes('xferRawMatrix3D')) {
      pushUniqueField(fields, seen, rawMatrixIndex === 0 ? 'localTransform.rawMatrix' : 'transform.rawMatrix');
      rawMatrixIndex += 1;
      continue;
    }
    if (token.includes('xferReal(1')) {
      const label = ['countCoeff', 'delayCoeff', 'sizeCoeff'][realOneIndex] ?? null;
      realOneIndex += 1;
      pushUniqueField(fields, seen, label);
      continue;
    }
    if (token.includes('xferCoord3D(system.position')) {
      pushUniqueField(fields, seen, positionIndex === 0 ? 'pos' : 'lastPos');
      positionIndex += 1;
      continue;
    }
    if (token.includes('xferUnsignedInt(INVALID_ID')) {
      pushUniqueField(fields, seen, invalidIdIndex === 0 ? 'attachedObjectId' : null);
      invalidIdIndex += 1;
      continue;
    }
    pushUniqueField(fields, seen, mapTsParticleSystemField(token));
  }
  moveOrInsertBefore(fields, 'personalityStore', 'systemLifetimeLeft');
  insertMissingBefore(fields, 'accumulatedSizeBonus', 'isForever');
  return fields;
}

export function parseCppParticleInfoFields(source: string): string[] {
  const body = extractFunctionBody(source, 'void ParticleInfo::xfer( Xfer *xfer )');
  if (!body) return [];
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex = /xfer->(xfer\w+)\s*\(\s*([^)]*?)\s*\)/g;
  let tempAngleIndex = 0;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    const method = match[1]!;
    const argument = normalizeCppXferArgument(match[2]!);
    if (method === 'xferReal' && argument === 'tempAngle') {
      const label = ['angleX', 'angleY', 'angularRateX', 'angularRateY'][tempAngleIndex] ?? null;
      tempAngleIndex += 1;
      pushUniqueField(fields, seen, label);
      continue;
    }
    pushUniqueField(fields, seen, mapCppParticleInfoField(method, argument));
  }
  return fields;
}

export function parseCppParticleFields(source: string): string[] {
  const body = extractFunctionBody(source, 'void Particle::xfer( Xfer *xfer )');
  if (!body) return [];
  const infoFields = parseCppParticleInfoFields(source);
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex =
    /ParticleInfo::xfer\s*\(\s*xfer\s*\)|xfer->(xfer\w+)\s*\(\s*([^)]*?)\s*\)/g;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    const token = match[0]!;
    if (token.startsWith('ParticleInfo::xfer')) {
      for (const field of infoFields) {
        pushUniqueField(fields, seen, `info.${field}`);
      }
      continue;
    }
    pushUniqueField(fields, seen, mapCppParticleField(match[1]!, normalizeCppXferArgument(match[2]!)));
  }
  return fields;
}

export function parseTsParticleFields(source: string): string[] {
  const body = extractFunctionBody(source, 'function xferParticleState');
  if (!body) return [];
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex =
    /xfer\.xferVersion\s*\(\s*1\s*\)|const\s+(\w+)\s*=\s*xfer\.xfer(?:Coord3D|Real|UnsignedInt|Int|Bool)\s*\([^)]*?\)|xfer\.xferUnsignedInt\s*\(\s*INVALID_DRAWABLE_ID\s*\)|value:\s*xfer\.xferReal\s*\(\s*keyframe\.value\s*\)|frame:\s*xfer\.xferUnsignedInt\s*\(\s*keyframe\.frame\s*\)|red:\s*xfer\.xferReal\s*\(\s*(?:keyframe\.color\.red|particle\.color\.red|particle\.colorRate\.red)\s*\)/g;
  let versionIndex = 0;
  let keyFrameFrameIndex = 0;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    const token = match[0]!;
    if (token.includes('xferVersion')) {
      pushUniqueField(fields, seen, versionIndex === 0 ? 'version' : 'info.version');
      versionIndex += 1;
      continue;
    }
    if (match[1]) {
      pushUniqueField(fields, seen, mapTsParticleField(match[1]!));
      continue;
    }
    if (token.includes('keyframe.value')) {
      pushUniqueField(fields, seen, 'info.alphaKey.value');
      continue;
    }
    if (token.includes('keyframe.frame')) {
      const label = keyFrameFrameIndex === 0 ? 'info.alphaKey.frame' : 'info.colorKey.frame';
      keyFrameFrameIndex += 1;
      pushUniqueField(fields, seen, label);
      continue;
    }
    if (token.includes('keyframe.color.red')) {
      pushUniqueField(fields, seen, 'info.colorKey.color');
      continue;
    }
    if (token.includes('particle.color.red')) {
      pushUniqueField(fields, seen, 'color');
      continue;
    }
    if (token.includes('particle.colorRate.red')) {
      pushUniqueField(fields, seen, 'colorRate');
      continue;
    }
    if (token.includes('INVALID_DRAWABLE_ID')) {
      pushUniqueField(fields, seen, 'drawableId');
    }
  }
  return fields;
}

export function parseCppSourceModuleBaseFields(source: string): string[] {
  return parseCppSimpleModuleFields(source, 'void Module::xfer( Xfer *xfer )', {});
}

export function parseTsSourceModuleBaseFields(source: string): string[] {
  return parseTsSimpleModuleFields(source, 'function xferSourceModuleBase', {
    'xfer.xferVersion': 'version',
  });
}

export function parseCppSourceObjectModuleBaseFields(source: string): string[] {
  return parseCppSimpleModuleFields(source, 'void ObjectModule::xfer( Xfer *xfer )', {
    'Module::xfer': ['module.version'],
  });
}

export function parseCppSourceDrawableModuleBaseFields(source: string): string[] {
  return parseCppSimpleModuleFields(source, 'void DrawableModule::xfer( Xfer *xfer )', {
    'Module::xfer': ['module.version'],
  });
}

export function parseTsSourceDrawableModuleBaseFields(source: string): string[] {
  return parseTsSimpleModuleFields(source, 'function xferSourceDrawableModuleBase', {
    'xfer.xferVersion': 'version',
    xferSourceModuleBase: 'module.version',
  });
}

export function parseCppSourceDrawModuleBaseFields(source: string): string[] {
  return parseCppSimpleModuleFields(source, 'void DrawModule::xfer( Xfer *xfer )', {
    'DrawableModule::xfer': ['drawableModule.version', 'module.version'],
  });
}

export function parseTsSourceDrawModuleBaseFields(source: string): string[] {
  return parseTsSimpleModuleFields(source, 'function xferSourceDrawModuleBase', {
    'xfer.xferVersion': 'version',
    xferSourceDrawableModuleBase: 'drawableModule.version',
    xferSourceModuleBase: 'module.version',
  });
}

export function parseCppSourceBehaviorModuleBaseFields(source: string): string[] {
  return parseCppSimpleModuleFields(source, 'void BehaviorModule::xfer( Xfer *xfer )', {
    'ObjectModule::xfer': ['objectModule.version', 'module.version'],
  });
}

export function parseTsSourceBehaviorModuleBaseFields(source: string): string[] {
  return parseTsSimpleModuleFields(source, 'function xferSourceBehaviorModuleBase', {
    behaviorVersion: 'version',
    objectModuleVersion: 'objectModule.version',
    moduleVersion: 'module.version',
  });
}

export function parseCppSourceUpdateModuleBaseFields(source: string): string[] {
  return parseCppSimpleModuleFields(source, 'void UpdateModule::xfer( Xfer *xfer )', {
    'BehaviorModule::xfer': ['behavior.version', 'objectModule.version', 'module.version'],
  });
}

export function parseTsSourceUpdateModuleBaseFields(source: string): string[] {
  return parseTsSimpleModuleFields(source, 'function xferSourceUpdateModuleBase', {
    updateVersion: 'version',
    behaviorVersion: 'behavior.version',
    objectModuleVersion: 'objectModule.version',
    moduleVersion: 'module.version',
    nextCallFrameAndPhase: 'nextCallFrameAndPhase',
  });
}

export function parseCppSourceBodyModuleBaseFields(source: string): string[] {
  return parseCppSimpleModuleFields(source, 'void BodyModule::xfer( Xfer *xfer )', {
    'BehaviorModule::xfer': ['behavior.version', 'objectModule.version', 'module.version'],
  });
}

export function parseTsSourceBodyModuleBaseFields(source: string): string[] {
  return parseTsSimpleModuleFields(source, 'function xferSourceBodyModuleBase', {
    bodyVersion: 'version',
    behaviorVersion: 'behavior.version',
    objectModuleVersion: 'objectModule.version',
    moduleVersion: 'module.version',
    damageScalar: 'damageScalar',
  });
}

export function parseCppSourceCollideModuleBaseFields(source: string): string[] {
  return parseCppSimpleModuleFields(source, 'void CollideModule::xfer( Xfer *xfer )', {
    'BehaviorModule::xfer': ['behavior.version', 'objectModule.version', 'module.version'],
  });
}

export function parseTsSourceCollideModuleBaseFields(source: string): string[] {
  return parseTsSimpleModuleFields(source, 'function xferSourceCollideModuleBase', {
    collideVersion: 'version',
    xferSourceBehaviorModuleBase: 'behavior.version',
    objectModuleVersion: 'objectModule.version',
    moduleVersion: 'module.version',
  });
}

export function parseCppSourceDieModuleBaseFields(source: string): string[] {
  return parseCppSimpleModuleFields(source, 'void DieModule::xfer( Xfer *xfer )', {
    'BehaviorModule::xfer': ['behavior.version', 'objectModule.version', 'module.version'],
  });
}

export function parseTsSourceDieModuleBaseFields(source: string): string[] {
  return parseTsSimpleModuleFields(source, 'function xferSourceDieModuleBase', {
    dieVersion: 'version',
    xferSourceBehaviorModuleBase: 'behavior.version',
    objectModuleVersion: 'objectModule.version',
    moduleVersion: 'module.version',
  });
}

export function parseCppSourceDamageModuleBaseFields(source: string): string[] {
  return parseCppSimpleModuleFields(source, 'void DamageModule::xfer( Xfer *xfer )', {
    'BehaviorModule::xfer': ['behavior.version', 'objectModule.version', 'module.version'],
  });
}

export function parseTsSourceDamageModuleBaseFields(source: string): string[] {
  return parseTsSimpleModuleFields(source, 'function xferSourceDamageModuleBase', {
    damageVersion: 'version',
    xferSourceBehaviorModuleBase: 'behavior.version',
    objectModuleVersion: 'objectModule.version',
    moduleVersion: 'module.version',
  });
}

export function parseCppSourceCreateModuleFields(source: string): string[] {
  return parseCppSimpleModuleFields(source, 'void CreateModule::xfer( Xfer *xfer )', {
    'BehaviorModule::xfer': ['behavior.version', 'objectModule.version', 'module.version'],
  });
}

export function parseTsSourceCreateModuleFields(source: string): string[] {
  return parseTsSimpleModuleFields(source, 'function xferSourceCreateModule', {
    version: 'version',
    xferSourceBehaviorModuleBase: 'behavior.version',
    objectModuleVersion: 'objectModule.version',
    moduleVersion: 'module.version',
    needToRunOnBuildComplete: 'needToRunOnBuildComplete',
  });
}

export function parseCppSourceSpecialPowerModuleFields(source: string): string[] {
  return parseCppSimpleModuleFields(source, 'void SpecialPowerModule::xfer( Xfer *xfer )', {
    'BehaviorModule::xfer': ['behavior.version', 'objectModule.version', 'module.version'],
  });
}

export function parseTsSourceSpecialPowerModuleFields(source: string): string[] {
  return parseTsSimpleModuleFields(source, 'function xferSourceSpecialPowerModule', {
    version: 'version',
    xferSourceBehaviorModuleBase: 'behavior.version',
    objectModuleVersion: 'objectModule.version',
    moduleVersion: 'module.version',
    availableOnFrame: 'availableOnFrame',
    pausedCount: 'pausedCount',
    pausedOnFrame: 'pausedOnFrame',
    pausedPercent: 'pausedPercent',
  });
}

/**
 * Parse C++ Radar::xfer source-save field order.
 */
export function parseCppRadarXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'void Radar::xfer');
  if (!body) {
    return [];
  }
  const objectListFields = parseCppRadarObjectListXferFields(source);
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex =
    /xfer->(xfer\w+)\s*\(\s*([^)]*?)\s*\)|xferRadarObjectList\s*\(\s*xfer\s*,\s*([^)]*?)\s*\)/g;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    if (match[3]) {
      const prefix = match[3]!.includes('m_localObjectList') ? 'localObjectList' : 'objectList';
      for (const field of objectListFields) {
        pushUniqueField(fields, seen, `${prefix}.${field}`);
      }
      continue;
    }
    const method = match[1]!;
    const argument = normalizeCppXferArgument(match[2]!);
    pushUniqueField(fields, seen, mapCppRadarField(method, argument));
  }
  return fields;
}

/**
 * Parse TS RadarSnapshot source-save field order.
 */
export function parseTsRadarXferFields(source: string): string[] {
  const start = source.indexOf('class RadarSnapshot');
  if (start < 0) {
    return [];
  }
  const end = source.indexOf('function buildScriptEngineNamedEventSlots', start);
  const body = source.slice(start, end < 0 ? undefined : end);
  const objectListFields = parseTsRadarObjectListXferFields(source);
  const eventFields = parseTsRadarEventXferFields(source);
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex =
    /xfer\.xferVersion\s*\(|payload\.radarHidden\s*=\s*xfer\.xferBool\s*\(|payload\.radarForced\s*=\s*xfer\.xferBool\s*\(|payload\.(localObjectList|objectList)\s*=\s*xferSourceRadarObjectList\s*\(|xfer\.xferUnsignedShort\s*\(\s*eventCountVerify\s*\)|xferSourceRadarEvent\s*\(|payload\.nextFreeRadarEvent\s*=\s*xfer\.xferInt\s*\(|payload\.lastRadarEvent\s*=\s*xfer\.xferInt\s*\(/g;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    if (match[1]) {
      for (const field of objectListFields) {
        pushUniqueField(fields, seen, `${match[1]!}.${field}`);
      }
      continue;
    }
    if (match[0]!.startsWith('xferSourceRadarEvent')) {
      for (const field of eventFields) {
        pushUniqueField(fields, seen, field);
      }
      continue;
    }
    pushUniqueField(fields, seen, mapTsRadarField(match[0]!));
  }
  return fields;
}

/**
 * Parse C++ PartitionManager::xfer source-save field order.
 */
export function parseCppPartitionXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'void PartitionManager::xfer');
  if (!body) {
    return [];
  }
  const cellFields = parseCppPartitionCellXferFields(source);
  const undoRevealFields = parseCppPartitionUndoRevealXferFields(source);
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex =
    /xfer->(xfer\w+)\s*\(\s*([^)]*?)\s*\)|xfer->xferSnapshot\s*\(\s*(cell|newInfo|saveInfo)\s*\)/g;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    if (match[3] === 'cell') {
      for (const field of cellFields) {
        pushUniqueField(fields, seen, `cell.${field}`);
      }
      continue;
    }
    if (match[3] === 'newInfo' || match[3] === 'saveInfo') {
      for (const field of undoRevealFields) {
        pushUniqueField(fields, seen, `undoReveal.${field}`);
      }
      continue;
    }
    const method = match[1]!;
    const argument = normalizeCppXferArgument(match[2]!);
    if (method === 'xferSnapshot' && argument === 'cell') {
      for (const field of cellFields) {
        pushUniqueField(fields, seen, `cell.${field}`);
      }
      continue;
    }
    if (method === 'xferSnapshot' && (argument === 'newInfo' || argument === 'saveInfo')) {
      for (const field of undoRevealFields) {
        pushUniqueField(fields, seen, `undoReveal.${field}`);
      }
      continue;
    }
    pushUniqueField(fields, seen, mapCppPartitionField(method, argument));
  }
  return fields;
}

/**
 * Parse TS PartitionSnapshot source-save field order.
 */
export function parseTsPartitionXferFields(source: string): string[] {
  const start = source.indexOf('class PartitionSnapshot');
  if (start < 0) {
    return [];
  }
  const end = source.indexOf('function xferNullableObjectId', start);
  const body = source.slice(start, end < 0 ? undefined : end);
  const shroudFields = parseTsPartitionShroudLevelXferFields(source);
  const undoRevealFields = parseTsPartitionUndoRevealXferFields(source);
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex =
    /xfer\.xferVersion\s*\(\s*SOURCE_PARTITION_SNAPSHOT_VERSION\s*\)|payload\.cellSize\s*=\s*xfer\.xferReal\s*\(|payload\.totalCellCount\s*=\s*xfer\.xferInt\s*\(|xfer\.xferVersion\s*\(\s*SOURCE_PARTITION_CELL_SNAPSHOT_VERSION\s*\)|xferSourcePartitionShroudLevel\s*\(|xfer\.xferInt\s*\(\s*payload\.pendingUndoShroudReveals\.length\s*\)|xferSourcePartitionUndoReveal\s*\(/g;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    if (match[0]!.startsWith('xferSourcePartitionShroudLevel')) {
      for (const field of shroudFields) {
        pushUniqueField(fields, seen, `cell.shroudLevel.${field}`);
      }
      continue;
    }
    if (match[0]!.startsWith('xferSourcePartitionUndoReveal')) {
      for (const field of undoRevealFields) {
        pushUniqueField(fields, seen, `undoReveal.${field}`);
      }
      continue;
    }
    pushUniqueField(fields, seen, mapTsPartitionField(match[0]!));
  }
  return fields;
}

export function parseCppTeamFactoryXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'void TeamFactory::xfer');
  if (!body) return [];
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex = /xfer->(xfer\w+)\s*\(\s*([^)]*?)\s*\)/g;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    const method = match[1]!;
    const argument = normalizeCppXferArgument(match[2]!);
    pushUniqueField(fields, seen, mapCppTeamFactoryField(method, argument));
  }
  return fields;
}

export function parseTsTeamFactoryXferFields(source: string): string[] {
  const start = source.indexOf('class SourceTeamFactorySnapshot');
  if (start < 0) return [];
  const end = source.indexOf('export function buildSourceTeamFactoryChunk', start);
  const body = source.slice(start, end < 0 ? undefined : end);
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex =
    /xfer\.xferVersion\s*\(\s*SOURCE_TEAM_FACTORY_SNAPSHOT_VERSION\s*\)|xfer\.xferUnsignedInt\s*\(\s*normalizePositiveInt\(this\.state\.state\.scriptNextSourceTeamId|xfer\.xferUnsignedShort\s*\(\s*prototypeOrder\.length\s*\)|xfer\.xferUnsignedInt\s*\(\s*normalizePositiveInt\(prototypeRecord\.sourcePrototypeId|xfer\.xferSnapshot\s*\(\s*new SourceTeamPrototypeSnapshot/g;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    pushUniqueField(fields, seen, mapTsTeamFactoryField(match[0]!));
  }
  return fields;
}

export function parseCppPlayerListXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'void PlayerList::xfer');
  if (!body) return [];
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex =
    /xfer->(xfer\w+)\s*\(\s*([^)]*?)\s*\)|xfer->xferSnapshot\s*\(\s*m_players\s*\[\s*i\s*\]\s*\)/g;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    if (match[0]!.includes('xferSnapshot')) {
      pushUniqueField(fields, seen, 'player.snapshot');
      continue;
    }
    const method = match[1]!;
    const argument = normalizeCppXferArgument(match[2]!);
    pushUniqueField(fields, seen, mapCppPlayerListField(method, argument));
  }
  return fields;
}

export function parseTsPlayerListXferFields(source: string): string[] {
  const start = source.indexOf('class SourcePlayersSnapshot');
  if (start < 0) return [];
  const end = source.indexOf('class LegacyPlayersSnapshot', start);
  const body = source.slice(start, end < 0 ? undefined : end);
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex =
    /xfer\.xferVersion\s*\(\s*SOURCE_PLAYERS_LIST_SNAPSHOT_VERSION\s*\)|xfer\.xferInt\s*\(\s*resolveSourcePlayersCount|xfer\.xferVersion\s*\(\s*SOURCE_PLAYER_ENTRY_SNAPSHOT_VERSION\s*\)/g;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    pushUniqueField(fields, seen, mapTsPlayerListField(match[0]!));
  }
  return fields;
}

export function parseCppPlayerXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'void Player::xfer');
  if (!body) return [];
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex =
    /xfer->(xfer\w+)\s*\(\s*([^)]*?)\s*\)|(entry->m_kindOf|m_battlePlanBonuses->m_validKindOf|m_battlePlanBonuses->m_invalidKindOf)\.xfer\s*\(\s*xfer\s*\)/g;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    if (match[3]) {
      pushUniqueField(fields, seen, mapCppPlayerBitFlagsField(match[3]!));
      continue;
    }
    const method = match[1]!;
    const argument = normalizeCppXferArgument(match[2]!);
    pushUniqueField(fields, seen, mapCppPlayerField(method, argument));
  }
  return fields;
}

export function parseTsPlayerXferFields(source: string): string[] {
  const start = source.indexOf('class SourcePlayersSnapshot');
  if (start < 0) return [];
  const end = source.indexOf('class LegacyPlayersSnapshot', start);
  const body = source.slice(start, end < 0 ? undefined : end);
  const fields: string[] = [];
  const seen = new Set<string>();
  let squadObjectIdsCallCount = 0;
  const tokenRegex =
    /const playerVersion\s*=\s*xfer\.xferVersion\s*\(\s*SOURCE_PLAYER_ENTRY_SNAPSHOT_VERSION\s*\)|const moneyVersion\s*=\s*xfer\.xferVersion\s*\(\s*SOURCE_MONEY_SNAPSHOT_VERSION\s*\)|const upgradeCount\s*=\s*xfer\.xferUnsignedShort\s*\(\s*player\.upgrades\.length\s*\)|player\.\w+\s*=\s*xfer\.xfer\w+\s*\([^)]*?\)|player\.(?:sciencesDisabled|sciencesHidden|sciences|upgradesInProgress|upgradesCompleted|playerRelations|teamRelations|kindOfCostModifiers|scoreKeeper)\s*=\s*xferSource\w+\s*\(|const name\s*=\s*xfer\.xferAsciiString\s*\(\s*''\s*\)|xfer\.xferAsciiString\s*\(\s*upgrade\.name\s*\)|xferSourceUpgradeState\s*\(|const energyVersion\s*=\s*xfer\.xferVersion\s*\(\s*SOURCE_ENERGY_SNAPSHOT_VERSION\s*\)|const teamPrototypeCount\s*=\s*xfer\.xferUnsignedShort\s*\(\s*player\.teamPrototypeIds\.length\s*\)|player\.teamPrototypeIds\.push\s*\(\s*xfer\.xferUnsignedInt\s*\(\s*0\s*\)\s*\)|xfer\.xferUnsignedInt\s*\(\s*teamPrototypeId\s*\)|const buildListInfoCount\s*=\s*xfer\.xferUnsignedShort\s*\(\s*player\.buildListInfos\.length\s*\)|xferSourceBuildListInfoState\s*\(|const aiPlayerPresent\s*=\s*xfer\.xferBool\s*\(\s*player\.aiPlayer !== null\s*\)|xferSourceAiPlayerState\s*\(|const resourceGatheringManagerPresent\s*=\s*xfer\.xferBool\s*\(\s*player\.resourceGatheringManager !== null\s*\)|xferSourceResourceGatheringManagerState\s*\(|const tunnelTrackerPresent\s*=\s*xfer\.xferBool\s*\(\s*player\.tunnelTracker !== null\s*\)|xferSourcePlayerTunnelTrackerSnapshot\s*\(|xferSourcePlayerRelationEntries\s*\(|xferSourceTeamRelationEntries\s*\(|xfer\.xferBool\s*\(\s*player\.attackedByPlayerIndices\.includes\(index\)\s*\)|xferSourceScoreKeeperState\s*\(|xferSourceKindOfCostModifiers\s*\(|const timerListSize\s*=\s*xfer\.xferUnsignedShort\s*\(\s*player\.specialPowerReadyTimers\.length\s*\)|templateId:\s*xfer\.xferUnsignedInt\s*\(\s*0\s*\)|readyFrame:\s*xfer\.xferUnsignedInt\s*\(\s*0\s*\)|xfer\.xferUnsignedInt\s*\(\s*timer\.templateId\s*\)|xfer\.xferUnsignedInt\s*\(\s*timer\.readyFrame\s*\)|const squadCount\s*=\s*xfer\.xferUnsignedShort\s*\(\s*player\.squads\.length\s*\)|xferSourceSquadObjectIds\s*\(|const currentSelectionPresent\s*=\s*xfer\.xferBool\s*\(\s*player\.currentSelectionPresent\s*\)|const battlePlanBonusPresent\s*=\s*xfer\.xferBool\s*\(\s*player\.battlePlanBonuses !== null\s*\)|xferSourceBattlePlanBonusesState\s*\(/g;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    const token = match[0]!;
    if (token.startsWith('xferSourceSquadObjectIds')) {
      pushUniqueField(fields, seen, squadObjectIdsCallCount < 2 ? 'squad.snapshot' : 'currentSelection.snapshot');
      squadObjectIdsCallCount += 1;
      continue;
    }
    if (token.includes('xferSourceKindOfCostModifiers')) {
      for (const field of [
        'kindOfCostModifierCount',
        'kindOfCostModifier.kindOfMask',
        'kindOfCostModifier.percent',
        'kindOfCostModifier.ref',
      ]) {
        pushUniqueField(fields, seen, field);
      }
      continue;
    }
    if (token.includes('xferSourceBattlePlanBonusesState')) {
      for (const field of [
        'battlePlanBonus.armorScalar',
        'battlePlanBonus.sightRangeScalar',
        'battlePlanBonus.bombardment',
        'battlePlanBonus.holdTheLine',
        'battlePlanBonus.searchAndDestroy',
        'battlePlanBonus.validKindOf',
        'battlePlanBonus.invalidKindOf',
      ]) {
        pushUniqueField(fields, seen, field);
      }
      continue;
    }
    pushUniqueField(fields, seen, mapTsPlayerField(token));
  }
  return fields;
}

export function parseCppMoneyXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'void Money::xfer');
  if (!body) return [];
  return parseCppXferFields(body, mapCppMoneyField);
}

export function parseTsMoneyXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'function xferMoneyAmount');
  if (!body) return [];
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex =
    /xfer\.xferVersion\s*\(\s*SOURCE_MONEY_SNAPSHOT_VERSION\s*\)|xfer\.xferUnsignedInt\s*\(\s*value\s*\)/g;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    pushUniqueField(fields, seen, mapTsMoneyField(match[0]!));
  }
  return fields;
}

export function parseCppEnergyXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'void Energy::xfer');
  if (!body) return [];
  return parseCppXferFields(body, mapCppEnergyField);
}

export function parseTsEnergyXferFields(source: string): string[] {
  const start = source.indexOf('class SourcePlayersSnapshot');
  if (start < 0) return [];
  const end = source.indexOf('class LegacyPlayersSnapshot', start);
  const body = source.slice(start, end < 0 ? undefined : end);
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex =
    /const energyVersion\s*=\s*xfer\.xferVersion\s*\(\s*SOURCE_ENERGY_SNAPSHOT_VERSION\s*\)|const energyPlayerIndex\s*=\s*xfer\.xferInt\s*\(\s*player\.playerIndex\s*\)|player\.powerSabotagedTillFrame\s*=\s*xfer\.xferUnsignedInt\s*\(\s*player\.powerSabotagedTillFrame\s*\)/g;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    pushUniqueField(fields, seen, mapTsEnergyField(match[0]!));
  }
  return fields;
}

export function parseCppScoreKeeperXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'void ScoreKeeper::xfer( Xfer *xfer )');
  if (!body) return [];
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex =
    /xfer->(xfer\w+)\s*\(\s*([^)]*?)\s*\)|xferObjectCountMap\s*\(\s*xfer\s*,\s*&([^)]*?)\s*\)/g;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    if (match[3]) {
      pushUniqueField(fields, seen, mapCppScoreKeeperMapField(match[3]!.trim()));
      continue;
    }
    const method = match[1]!;
    const argument = normalizeCppXferArgument(match[2]!);
    pushUniqueField(fields, seen, mapCppScoreKeeperField(method, argument));
  }
  return fields;
}

export function parseTsScoreKeeperXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'function xferSourceScoreKeeperState');
  if (!body) return [];
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex =
    /xfer\.xferVersion\s*\(\s*SOURCE_SCORE_KEEPER_SNAPSHOT_VERSION\s*\)|(\w+):\s*xfer\.xferInt\s*\([^)]*?\)|totalUnitsDestroyed:\s*totalUnitsDestroyed\.map\s*\(\s*\(value\)\s*=>\s*xfer\.xferInt\s*\(value\)\s*\)|totalBuildingsDestroyed:\s*totalBuildingsDestroyed\.map\s*\(\s*\(value\)\s*=>\s*xfer\.xferInt\s*\(value\)\s*\)|xferSourceScoreObjectCountMap\s*\(\s*xfer\s*,\s*scoreKeeper\.(objectsBuilt|objectsLost|objectsCaptured)\s*\)|xferSourceScoreObjectCountMap\s*\(\s*xfer\s*,\s*objectsDestroyed\[index\][^)]*?\)|const destroyedArraySize\s*=\s*xfer\.xferUnsignedShort\s*\(\s*SOURCE_SCRIPT_ENGINE_PLAYER_COUNT\s*\)/g;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    const token = match[0]!;
    pushUniqueField(fields, seen, mapTsScoreKeeperField(token, match[1], match[2]));
  }
  return fields;
}

export function parseCppObjectIdListXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'void Xfer::xferSTLObjectIDList');
  if (!body) return [];
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex = /(xfer\w+)\s*\(\s*([^)]*?)\s*\)/g;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    pushUniqueField(fields, seen, mapCppObjectIdListField(match[1]!, normalizeCppXferArgument(match[2]!)));
  }
  return fields;
}

export function parseTsObjectIdListXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'function xferSourceObjectIdLinkedList');
  if (!body) return [];
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex =
    /xfer\.xferVersion\s*\(\s*SOURCE_OBJECT_ID_LINKED_LIST_VERSION\s*\)|xfer\.xferUnsignedShort\s*\(\s*objectIds\.length\s*\)|xfer\.xferObjectID\s*\(/g;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    pushUniqueField(fields, seen, mapTsObjectIdListField(match[0]!));
  }
  return fields;
}

export function parseCppUpgradeXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'void Upgrade::xfer');
  if (!body) return [];
  return parseCppXferFields(body, mapCppUpgradeField);
}

export function parseTsUpgradeXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'function xferSourceUpgradeState');
  if (!body) return [];
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex =
    /xfer\.xferVersion\s*\(\s*SOURCE_UPGRADE_SNAPSHOT_VERSION\s*\)|status:\s*xfer\.xferInt\s*\(\s*upgrade\.status\s*\)/g;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    pushUniqueField(fields, seen, mapTsUpgradeField(match[0]!));
  }
  return fields;
}

export function parseCppPlayerRelationMapXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'void PlayerRelationMap::xfer');
  if (!body) return [];
  return parseCppXferFields(body, mapCppPlayerRelationMapField);
}

export function parseTsPlayerRelationMapXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'function xferSourcePlayerRelationEntries');
  if (!body) return [];
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex =
    /xfer\.xferVersion\s*\(\s*SOURCE_PLAYER_RELATION_MAP_SNAPSHOT_VERSION\s*\)|xfer\.xferUnsignedShort\s*\(\s*entries\.length\s*\)|id:\s*xfer\.xferInt\s*\(\s*0\s*\)|relationship:\s*xfer\.xferInt\s*\(\s*0\s*\)|xfer\.xferInt\s*\(\s*Math\.trunc\(entry\.id\)\s*\)|xfer\.xferInt\s*\(\s*Math\.trunc\(entry\.relationship\)\s*\)/g;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    pushUniqueField(fields, seen, mapTsPlayerRelationMapField(match[0]!));
  }
  return fields;
}

export function parseCppTeamRelationMapXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'void TeamRelationMap::xfer');
  if (!body) return [];
  return parseCppXferFields(body, mapCppTeamRelationMapField);
}

export function parseTsTeamRelationMapXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'function xferSourceTeamRelationEntries');
  if (!body) return [];
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex =
    /xfer\.xferVersion\s*\(\s*SOURCE_PLAYER_RELATION_MAP_SNAPSHOT_VERSION\s*\)|xfer\.xferUnsignedShort\s*\(\s*entries\.length\s*\)|id:\s*xfer\.xferUnsignedInt\s*\(\s*0\s*\)|relationship:\s*xfer\.xferInt\s*\(\s*0\s*\)|xfer\.xferUnsignedInt\s*\(\s*Math\.max\(0, Math\.trunc\(entry\.id\)\)\s*\)|xfer\.xferInt\s*\(\s*Math\.trunc\(entry\.relationship\)\s*\)/g;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    pushUniqueField(fields, seen, mapTsTeamRelationMapField(match[0]!));
  }
  return fields;
}

export function parseCppBuildListInfoXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'void BuildListInfo::xfer');
  if (!body) return [];
  return parseCppXferFields(body, mapCppBuildListInfoField);
}

export function parseTsBuildListInfoXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'function xferSourceBuildListInfoState');
  if (!body) return [];
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex =
    /xfer\.xferVersion\s*\(\s*SOURCE_BUILD_LIST_INFO_SNAPSHOT_VERSION\s*\)|(\w+):\s*xfer\.xfer\w+\s*\(\s*buildListInfo\.\w+\s*\)|rallyPointOffset:\s*xferSourceCoord2D\s*\(|resourceGatherers:\s*xferSourceFixedObjectIdArray\s*\(|currentGatherers:\s*version >= 2\s*\?\s*xfer\.xferInt\s*\(\s*buildListInfo\.currentGatherers\s*\)/g;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    pushUniqueField(fields, seen, mapTsBuildListInfoField(match[0]!, match[1]));
  }
  return fields;
}

export function parseCppResourceGatheringManagerXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'void ResourceGatheringManager::xfer');
  if (!body) return [];
  return parseCppXferFields(body, mapCppResourceGatheringManagerField);
}

export function parseTsResourceGatheringManagerXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'function xferSourceResourceGatheringManagerState');
  if (!body) return [];
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex =
    /xfer\.xferVersion\s*\(\s*SOURCE_RESOURCE_GATHERING_MANAGER_SNAPSHOT_VERSION\s*\)|supplyWarehouses:\s*xferSourceObjectIdLinkedList\s*\(|supplyCenters:\s*xferSourceObjectIdLinkedList\s*\(/g;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    pushUniqueField(fields, seen, mapTsResourceGatheringManagerField(match[0]!));
  }
  return fields;
}

export function parseCppTunnelTrackerXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'void TunnelTracker::xfer');
  if (!body) return [];
  return parseCppXferFields(body, mapCppTunnelTrackerField);
}

export function parseTsTunnelTrackerXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'function xferSourcePlayerTunnelTrackerSnapshot');
  if (!body) return [];
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex =
    /xfer\.xferVersion\s*\(\s*SOURCE_TUNNEL_TRACKER_SNAPSHOT_VERSION\s*\)|const tunnelIds\s*=\s*xferSourceObjectIdLinkedList\s*\(|const passengerCount\s*=\s*xfer\.xferInt\s*\(\s*tunnelTracker\.passengerIds\.length\s*\)|xfer\.xferObjectID\s*\(\s*(?:0|passengerId)\s*\)|tunnelCount:\s*xfer\.xferUnsignedInt\s*\(\s*tunnelTracker\.tunnelCount\s*\)/g;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    pushUniqueField(fields, seen, mapTsTunnelTrackerField(match[0]!));
  }
  return fields;
}

export function parseCppSquadXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'void Squad::xfer');
  if (!body) return [];
  return parseCppXferFields(body, mapCppSquadField);
}

export function parseTsSquadXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'function xferSourceSquadObjectIds');
  if (!body) return [];
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex =
    /xfer\.xferVersion\s*\(\s*SOURCE_SQUAD_SNAPSHOT_VERSION\s*\)|xfer\.xferUnsignedShort\s*\(\s*objectIds\.length\s*\)|xfer\.xferObjectID\s*\(\s*(?:0|objectId)\s*\)/g;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    pushUniqueField(fields, seen, mapTsSquadField(match[0]!));
  }
  return fields;
}

export function parseCppWorkOrderXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'void WorkOrder::xfer');
  if (!body) return [];
  return parseCppXferFields(body, mapCppWorkOrderField);
}

export function parseTsWorkOrderXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'function xferSourceWorkOrderState');
  if (!body) return [];
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex =
    /xfer\.xferVersion\s*\(\s*SOURCE_WORK_ORDER_SNAPSHOT_VERSION\s*\)|(\w+):\s*xfer\.xfer\w+\s*\(\s*workOrder\.\w+\s*\)/g;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    pushUniqueField(fields, seen, mapTsWorkOrderField(match[0]!, match[1]));
  }
  return fields;
}

export function parseCppTeamInQueueXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'void TeamInQueue::xfer');
  if (!body) return [];
  return parseCppXferFields(body, mapCppTeamInQueueField);
}

export function parseTsTeamInQueueXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'function xferSourceTeamInQueueState');
  if (!body) return [];
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex =
    /xfer\.xferVersion\s*\(\s*SOURCE_TEAM_IN_QUEUE_SNAPSHOT_VERSION\s*\)|const workOrderCount\s*=\s*xfer\.xferUnsignedShort\s*\(\s*teamInQueue\.workOrders\.length\s*\)|xferSourceWorkOrderState\s*\(|(\w+):\s*xfer\.xfer\w+\s*\(\s*teamInQueue\.\w+\s*\)/g;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    pushUniqueField(fields, seen, mapTsTeamInQueueField(match[0]!, match[1]));
  }
  return fields;
}

export function parseCppAiPlayerXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'void AIPlayer::xfer');
  if (!body) return [];
  const fields: string[] = [];
  const seen = new Set<string>();
  let teamInQueueSnapshotIndex = 0;
  const tokenRegex = /xfer->(xfer\w+)\s*\(\s*([^)]*?)\s*\)/g;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    const method = match[1]!;
    const argument = normalizeCppXferArgument(match[2]!);
    if (method === 'xferSnapshot' && (argument === 'teamInQueue' || argument === 'teamReadyQueue')) {
      pushUniqueField(
        fields,
        seen,
        teamInQueueSnapshotIndex < 2 ? 'teamBuildQueue.snapshot' : 'teamReadyQueue.snapshot',
      );
      teamInQueueSnapshotIndex += 1;
      continue;
    }
    pushUniqueField(fields, seen, mapCppAiPlayerField(method, argument));
  }
  return fields;
}

export function parseTsAiPlayerXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'function xferSourceKnownAiPlayerState');
  if (!body) return [];
  const fields: string[] = [];
  const seen = new Set<string>();
  let teamInQueueSnapshotIndex = 0;
  const tokenRegex =
    /const version\s*=\s*xfer\.xferVersion\s*\(\s*SOURCE_AI_PLAYER_SNAPSHOT_VERSION\s*\)|const teamBuildQueueCount\s*=\s*xfer\.xferUnsignedShort\s*\(\s*aiPlayer\.teamBuildQueue\.length\s*\)|const teamReadyQueueCount\s*=\s*xfer\.xferUnsignedShort\s*\(\s*aiPlayer\.teamReadyQueue\.length\s*\)|xferSourceTeamInQueueState\s*\(|const savedPlayerIndex\s*=\s*xfer\.xferInt\s*\(\s*playerIndex\s*\)|(\w+):\s*xfer\.xfer\w+\s*\(\s*aiPlayer\.\w+\s*\)|structuresToRepair:\s*xferSourceFixedObjectIdArray\s*\(/g;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    const token = match[0]!;
    if (token.startsWith('xferSourceTeamInQueueState')) {
      pushUniqueField(
        fields,
        seen,
        teamInQueueSnapshotIndex < 2 ? 'teamBuildQueue.snapshot' : 'teamReadyQueue.snapshot',
      );
      teamInQueueSnapshotIndex += 1;
      continue;
    }
    pushUniqueField(fields, seen, mapTsAiPlayerField(token, match[1]));
  }
  return fields;
}

export function parseCppAiSkirmishPlayerXferFields(source: string, aiPlayerSource: string): string[] {
  const body = extractFunctionBody(source, 'void AISkirmishPlayer::xfer');
  if (!body) return [];
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex = /xfer->(xfer\w+)\s*\(\s*([^)]*?)\s*\)|AIPlayer::xfer\s*\(\s*xfer\s*\)/g;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    if (match[0]!.startsWith('AIPlayer::xfer')) {
      for (const field of parseCppAiPlayerXferFields(aiPlayerSource)) {
        pushUniqueField(fields, seen, `base.${field}`);
      }
      continue;
    }
    pushUniqueField(fields, seen, mapCppAiSkirmishPlayerField(match[1]!, normalizeCppXferArgument(match[2]!)));
  }
  return fields;
}

export function parseTsAiSkirmishPlayerXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'function xferSourceKnownAiPlayerState');
  if (!body) return [];
  const fields: string[] = [];
  const seen = new Set<string>();
  const skirmishVersionRegex = /const skirmishVersion\s*=\s*xfer\.xferVersion\s*\(\s*SOURCE_AI_SKIRMISH_PLAYER_SNAPSHOT_VERSION\s*\)/;
  if (skirmishVersionRegex.test(body)) {
    pushUniqueField(fields, seen, 'version');
  }
  for (const field of parseTsAiPlayerXferFields(source)) {
    pushUniqueField(fields, seen, `base.${field}`);
  }
  const tokenRegex = /nextState\.(\w+)\s*=\s*xfer\.xfer(?:Int|Real)\s*\(\s*aiPlayer\.\w+\s*\)/g;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    pushUniqueField(fields, seen, mapTsAiSkirmishPlayerField(match[1]!));
  }
  return fields;
}

export function parseCppSequentialScriptXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'void SequentialScript::xfer');
  if (!body) return [];
  return parseCppXferFields(body, mapCppSequentialScriptField);
}

export function parseTsSequentialScriptXferFields(source: string): string[] {
  const start = source.indexOf('function xferScriptEngineSequentialScript');
  if (start < 0) return [];
  const end = source.indexOf('\nexport function createRuntimeSaveInGameUiSuperweaponKey', start);
  const body = source.slice(start, end < 0 ? undefined : end);
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex =
    /xfer\.xferVersion\s*\(\s*1\s*\)|const (\w+)\s*=\s*xfer\.xfer\w+\s*\(/g;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    pushUniqueField(fields, seen, mapTsSequentialScriptField(match[0]!, match[1]));
  }
  return fields;
}

export function parseCppAttackPriorityInfoXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'void AttackPriorityInfo::xfer');
  if (!body) return [];
  return parseCppXferFields(body, mapCppAttackPriorityInfoField);
}

export function parseTsAttackPriorityInfoXferFields(source: string): string[] {
  const start = source.indexOf('function xferScriptEngineAttackPrioritySet');
  if (start < 0) return [];
  const end = source.indexOf('\nfunction xferScriptEngineSequentialScript', start);
  const body = source.slice(start, end < 0 ? undefined : end);
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex =
    /xfer\.xferVersion\s*\(\s*1\s*\)|const resolvedName\s*=\s*xfer\.xferAsciiString\s*\(|const resolvedDefaultPriority\s*=\s*xfer\.xferInt\s*\(|const count\s*=\s*xfer\.xferUnsignedShort\s*\(|xfer\.xferAsciiString\s*\(\s*(?:''|templateName)\s*\)|xfer\.xferInt\s*\(\s*(?:0|Math\.trunc\(priority\))\s*\)/g;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    pushUniqueField(fields, seen, mapTsAttackPriorityInfoField(match[0]!));
  }
  return fields;
}

export function parseCppScriptEngineBreezeXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'void ScriptEngine::xfer');
  if (!body) return [];
  const start = body.indexOf('// breeze info');
  if (start < 0) return [];
  const end = body.indexOf('// game difficulty', start);
  const breezeBody = body.slice(start, end < 0 ? undefined : end);
  const fields: string[] = [];
  const tokenRegex = /xfer->(xfer\w+)\s*\(\s*([^)]*?)\s*\)/g;
  let intensityIndex = 0;
  let match;
  while ((match = tokenRegex.exec(breezeBody)) !== null) {
    const method = match[1]!;
    const argument = normalizeCppXferArgument(match[2]!);
    if (argument === 'm_breezeInfo.m_intensity') {
      fields.push(intensityIndex === 0 ? 'intensity' : 'intensityCopy');
      intensityIndex += 1;
      continue;
    }
    const field = mapCppScriptEngineBreezeField(method, argument);
    if (field) {
      fields.push(field);
    }
  }
  return fields;
}

export function parseTsScriptEngineBreezeXferFields(source: string): string[] {
  const start = source.indexOf('const breezeState =');
  if (start < 0) return [];
  const end = source.indexOf('const loadedDifficulty =', start);
  const body = source.slice(start, end < 0 ? undefined : end);
  const fields: string[] = [];
  const tokenRegex = /xfer\.xfer(?:Real|Short)\s*\(\s*([^)]*?)\s*\)/g;
  let intensityIndex = 0;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    const token = match[0]!;
    if (token.includes("'intensity'") || token.includes('loadedBreezeIntensity')) {
      fields.push(intensityIndex === 0 ? 'intensity' : 'intensityCopy');
      intensityIndex += 1;
      continue;
    }
    const field = mapTsScriptEngineBreezeField(token);
    if (field) {
      fields.push(field);
    }
  }
  return fields;
}

export function parseCppScriptEngineStringListXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'static void xferListAsciiString( Xfer *xfer, ListAsciiString *list )');
  if (!body) return [];
  return parseCppXferFields(body, mapCppScriptEngineStringListField);
}

export function parseTsScriptEngineStringListXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'function xferScriptEngineAsciiStringEntries');
  if (!body) return [];
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex =
    /xfer\.xferVersion\s*\(\s*1\s*\)|xfer\.xferUnsignedShort\s*\(\s*entries\.length\s*\)|xfer\.xferAsciiString\s*\(/g;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    pushUniqueField(fields, seen, mapTsScriptEngineStringListField(match[0]!));
  }
  return fields;
}

export function parseCppScriptEngineStringUIntListXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'static void xferListAsciiStringUINT');
  if (!body) return [];
  return parseCppXferFields(body, mapCppScriptEngineStringUIntListField);
}

export function parseTsScriptEngineStringUIntListXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'function xferScriptEngineAsciiStringUIntEntries');
  if (!body) return [];
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex =
    /xfer\.xferVersion\s*\(\s*1\s*\)|xfer\.xferUnsignedShort\s*\(\s*entries\.length\s*\)|xfer\.xferAsciiString\s*\(|xfer\.xferUnsignedInt\s*\(/g;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    pushUniqueField(fields, seen, mapTsScriptEngineStringUIntListField(match[0]!));
  }
  return fields;
}

export function parseCppScriptEngineStringObjectIdListXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'static void xferListAsciiStringObjectID');
  if (!body) return [];
  return parseCppXferFields(body, mapCppScriptEngineStringObjectIdListField);
}

export function parseTsScriptEngineStringObjectIdListXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'function xferScriptEngineAsciiStringObjectIdEntries');
  if (!body) return [];
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex =
    /xfer\.xferVersion\s*\(\s*1\s*\)|xfer\.xferUnsignedShort\s*\(\s*entries\.length\s*\)|xfer\.xferAsciiString\s*\(|xfer\.xferObjectID\s*\(/g;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    pushUniqueField(fields, seen, mapTsScriptEngineStringObjectIdListField(match[0]!));
  }
  return fields;
}

export function parseCppScriptEngineNamedObjectXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'void ScriptEngine::xfer');
  if (!body) return [];
  const start = body.indexOf('// named objects');
  if (start < 0) return [];
  const end = body.indexOf('// first update', start);
  const namedObjectBody = body.slice(start, end < 0 ? undefined : end);
  return parseCppXferFields(namedObjectBody, mapCppScriptEngineNamedObjectField);
}

export function parseTsScriptEngineNamedObjectXferFields(source: string): string[] {
  const start = source.indexOf('const namedEntitiesByName =');
  if (start < 0) return [];
  const end = source.indexOf('xfer.xferBool(false)', start);
  const namedObjectBody = source.slice(start, end < 0 ? undefined : end);
  const fields: string[] = [];
  const seen = new Set<string>();
  if (/xfer\.xferUnsignedShort\s*\(\s*namedObjectEntries\.length\s*\)/.test(namedObjectBody)) {
    pushUniqueField(fields, seen, 'count');
  }
  if (namedObjectBody.includes('xferScriptEngineAsciiStringObjectIdEntries')) {
    pushUniqueField(fields, seen, 'list.version');
    pushUniqueField(fields, seen, 'list.count');
    pushUniqueField(fields, seen, 'entry.name');
    pushUniqueField(fields, seen, 'entry.objectId');
    return fields;
  }
  const helperBody = extractFunctionBody(source, 'function xferScriptEngineNamedObjectEntries');
  if (!helperBody) return fields;
  const tokenRegex = /xfer\.xfer(?:AsciiString|ObjectID)\s*\(/g;
  let match;
  while ((match = tokenRegex.exec(helperBody)) !== null) {
    pushUniqueField(fields, seen, mapTsScriptEngineNamedObjectField(match[0]!));
  }
  return fields;
}

export function parseCppScienceVectorXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'void Xfer::xferScienceVec');
  if (!body) return [];
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex = /\b(xfer\w+)\s*\(\s*([^)]*?)\s*\)/g;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    pushUniqueField(fields, seen, mapCppScienceVectorField(match[1]!, normalizeCppXferArgument(match[2]!)));
  }
  return fields;
}

export function parseTsSourceScienceVectorXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'function xferSourceScienceNames');
  if (!body) return [];
  return parseTsScienceVectorFields(body);
}

export function parseTsScriptEngineScienceVectorXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'function xferScriptEngineScienceNames');
  if (!body) return [];
  return parseTsScienceVectorFields(body);
}

export function parseCppObjectTypesXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'void ObjectTypes::xfer');
  if (!body) return [];
  return parseCppXferFields(body, mapCppObjectTypesField);
}

export function parseTsScriptEngineObjectTypeListXferFields(source: string): string[] {
  const start = source.indexOf('function xferScriptEngineObjectTypeList');
  if (start < 0) return [];
  const end = source.indexOf('\nfunction xferScriptEngineAttackPrioritySet', start);
  const body = source.slice(start, end < 0 ? undefined : end);
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex =
    /xfer\.xferVersion\s*\(\s*1\s*\)|const resolvedListName\s*=\s*xfer\.xferAsciiString\s*\(|xfer\.xferUnsignedShort\s*\(\s*objectTypes\.length\s*\)|xfer\.xferAsciiString\s*\(\s*(?:''|objectType)\s*\)/g;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    pushUniqueField(fields, seen, mapTsObjectTypesField(match[0]!));
  }
  return fields;
}

export function parseCppScriptXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'void Script::xfer');
  if (!body) return [];
  return parseCppXferFields(body, mapCppSourceScriptField);
}

export function parseTsSourceScriptXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'function xferSourceScriptState');
  if (!body) return [];
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex = /xfer\.xferVersion\s*\(\s*1\s*\)|xfer\.xferBool\s*\(\s*scriptState\.active\s*\)/g;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    pushUniqueField(fields, seen, mapTsSourceScriptField(match[0]!));
  }
  return fields;
}

export function parseCppScriptGroupXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'void ScriptGroup::xfer');
  if (!body) return [];
  return parseCppXferFields(body, mapCppSourceScriptGroupField);
}

export function parseTsSourceScriptGroupXferFields(source: string): string[] {
  const start = source.indexOf('function xferSourceScriptGroupState');
  if (start < 0) return [];
  const end = source.indexOf('\nfunction xferSourceScriptListState', start);
  const body = source.slice(start, end < 0 ? undefined : end);
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex =
    /xfer\.xferVersion\s*\(\s*2\s*\)|xfer\.xferBool\s*\(\s*groupState\.active\s*\)|xfer\.xferUnsignedShort\s*\(\s*groupState\.scripts\.length\s*\)|xferSourceScriptState\s*\(/g;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    pushUniqueField(fields, seen, mapTsSourceScriptGroupField(match[0]!));
  }
  return fields;
}

export function parseCppScriptListXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'void ScriptList::xfer');
  if (!body) return [];
  return parseCppXferFields(body, mapCppSourceScriptListField);
}

export function parseTsSourceScriptListXferFields(source: string): string[] {
  const start = source.indexOf('function xferSourceScriptListState');
  if (start < 0) return [];
  const end = source.indexOf('\nclass SidesListSnapshot', start);
  const body = source.slice(start, end < 0 ? undefined : end);
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex =
    /xfer\.xferVersion\s*\(\s*1\s*\)|xfer\.xferUnsignedShort\s*\(\s*scriptListState\.scripts\.length\s*\)|xferSourceScriptState\s*\(|xfer\.xferUnsignedShort\s*\(\s*scriptListState\.groups\.length\s*\)|xferSourceScriptGroupState\s*\(/g;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    pushUniqueField(fields, seen, mapTsSourceScriptListField(match[0]!));
  }
  return fields;
}

export function parseCppSidesListXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'void SidesList::xfer');
  if (!body) return [];
  return parseCppXferFields(body, mapCppSidesListField);
}

export function parseTsSidesListXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'class SidesListSnapshot');
  if (!body) return [];
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex =
    /xfer\.xferVersion\s*\(\s*1\s*\)|xfer\.xferInt\s*\(\s*scriptLists\.length\s*\)|xfer\.xferBool\s*\(\s*scriptListState\.present\s*\)|xferSourceScriptListState\s*\(/g;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    pushUniqueField(fields, seen, mapTsSidesListField(match[0]!));
  }
  return fields;
}

export function parseCppScriptEngineStringCoordListXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'static void xferListAsciiStringCoord3D');
  if (!body) return [];
  return parseCppXferFields(body, mapCppScriptEngineStringCoordListField);
}

export function parseTsScriptEngineStringCoordListXferFields(source: string): string[] {
  const start = source.indexOf('function xferScriptEngineAsciiStringCoord3DEntries');
  if (start < 0) return [];
  const end = source.indexOf('\nfunction xferScriptEngineScienceNames', start);
  const body = source.slice(start, end < 0 ? undefined : end);
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex =
    /xfer\.xferVersion\s*\(\s*1\s*\)|xfer\.xferUnsignedShort\s*\(\s*entries\.length\s*\)|xfer\.xferAsciiString\s*\(|xfer\.xferCoord3D\s*\(/g;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    pushUniqueField(fields, seen, mapTsScriptEngineStringCoordListField(match[0]!));
  }
  return fields;
}

export function parseCppTeamTemplateInfoXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'void TeamTemplateInfo::xfer');
  if (!body) return [];
  return parseCppXferFields(body, mapCppTeamTemplateInfoField);
}

export function parseTsTeamTemplateInfoXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'class SourceTeamTemplateInfoSnapshot');
  if (!body) return [];
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex =
    /xfer\.xferVersion\s*\(\s*SOURCE_TEAM_TEMPLATE_INFO_SNAPSHOT_VERSION\s*\)|this\.team\.productionPriority\s*=\s*xfer\.xferInt\s*\(/g;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    pushUniqueField(fields, seen, mapTsTeamTemplateInfoField(match[0]!));
  }
  return fields;
}

export function parseCppTeamPrototypeXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'void TeamPrototype::xfer');
  if (!body) return [];
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex =
    /xfer->(xfer\w+)\s*\(\s*([^)]*?)\s*\)/g;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    const method = match[1]!;
    const argument = normalizeCppXferArgument(match[2]!);
    pushUniqueField(fields, seen, mapCppTeamPrototypeField(method, argument));
  }
  return fields;
}

export function parseTsTeamPrototypeXferFields(source: string): string[] {
  const start = source.indexOf('class SourceTeamPrototypeSnapshot');
  if (start < 0) return [];
  const end = source.indexOf('class SourceTeamFactorySnapshot', start);
  const body = source.slice(start, end < 0 ? undefined : end);
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex =
    /xfer\.xferVersion\s*\(\s*SOURCE_TEAM_PROTOTYPE_SNAPSHOT_VERSION\s*\)|const ownerIndex\s*=\s*xfer\.xferInt\s*\(|this\.prototypeRecord\.attackPrioritySetName\s*=\s*xfer\.xferAsciiString\s*\(|xfer\.xferBool\s*\(\s*false\s*\)|xfer\.xferSnapshot\s*\(\s*new SourceTeamTemplateInfoSnapshot|xfer\.xferUnsignedShort\s*\(\s*(?:0|savedTeams\.length)\s*\)|xfer\.xferUnsignedInt\s*\(\s*(?:0|normalizePositiveInt\(team\.sourceTeamId)|xfer\.xferSnapshot\s*\(\s*new SourceTeamSnapshot/g;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    pushUniqueField(fields, seen, mapTsTeamPrototypeField(match[0]!));
  }
  return fields;
}

export function parseCppTeamXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'void Team::xfer');
  if (!body) return [];
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex = /xfer->(xfer\w+)\s*\(\s*([^)]*?)\s*\)/g;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    const method = match[1]!;
    const argument = normalizeCppXferArgument(match[2]!);
    pushUniqueField(fields, seen, mapCppTeamField(method, argument));
  }
  return fields;
}

export function parseTsTeamXferFields(source: string): string[] {
  const start = source.indexOf('class SourceTeamSnapshot');
  if (start < 0) return [];
  const end = source.indexOf('class SourceTeamPrototypeSnapshot', start);
  const body = source.slice(start, end < 0 ? undefined : end);
  const fields: string[] = [];
  const seen = new Set<string>();
  let falseBoolIndex = 0;
  let objectIdZeroIndex = 0;
  const tokenRegex =
    /xfer\.xferVersion\s*\(\s*SOURCE_TEAM_SNAPSHOT_VERSION\s*\)|const teamId\s*=\s*xfer\.xferUnsignedInt\s*\(|xfer\.xferUnsignedShort\s*\(\s*(?:0|memberIds\.length)\s*\)|xfer\.xferObjectID\s*\(\s*(?:0|memberId)\s*\)|this\.team\.stateName\s*=\s*xfer\.xferAsciiString\s*\(|xfer\.xferBool\s*\(\s*false\s*\)|xfer\.xferBool\s*\(\s*this\.team\.created\s*\|\||this\.team\.created\s*=\s*xfer\.xferBool\s*\(|xfer\.xferInt\s*\(\s*0\s*\)|xfer\.xferInt\s*\(\s*this\.team\.memberEntityIds\.size\s*\)|xfer\.xferUnsignedInt\s*\(\s*0\s*\)|xfer\.xferUnsignedShort\s*\(\s*GENERIC_SCRIPT_SLOT_COUNT\s*\)|xfer\.xferBool\s*\(\s*true\s*\)|const hasRecruitableOverride\s*=\s*xfer\.xferBool\s*\(|const recruitableValue\s*=\s*xfer\.xferBool\s*\(|xfer\.xferSnapshot\s*\(\s*new SourceEmptyTeamRelationSnapshot|xfer\.xferSnapshot\s*\(\s*new SourceEmptyPlayerRelationSnapshot/g;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    const token = match[0]!;
    if (token === 'xfer.xferBool(false)') {
      const falseBoolLabels = [
        'enteredOrExited',
        'checkEnemySighted',
        'seeEnemy',
        'prevSeeEnemy',
        'wasIdle',
      ];
      pushUniqueField(fields, seen, falseBoolLabels[falseBoolIndex]);
      falseBoolIndex += 1;
      continue;
    }
    if (token === 'xfer.xferObjectID(0)') {
      pushUniqueField(fields, seen, objectIdZeroIndex === 0 ? 'member.id' : 'commonAttackTarget');
      objectIdZeroIndex += 1;
      continue;
    }
    pushUniqueField(fields, seen, mapTsTeamField(token));
  }
  return fields;
}

function extractQuotedStrings(text: string): string[] {
  const names: string[] = [];
  const regex = /["']([^"']+)["']/g;
  let m;
  while ((m = regex.exec(text)) !== null) {
    names.push(m[1]!);
  }
  return names;
}

function pushIfFound(fields: string[], body: string, label: string, pattern: RegExp): void {
  if (pattern.test(body)) {
    fields.push(label);
  }
}

function pushUniqueField(fields: string[], seen: Set<string>, label: string | null | undefined): void {
  if (!label || seen.has(label)) {
    return;
  }
  seen.add(label);
  fields.push(label);
}

function insertMissingBefore(fields: string[], before: string, label: string): void {
  if (fields.includes(label)) {
    return;
  }
  const index = fields.indexOf(before);
  if (index < 0) {
    fields.push(label);
    return;
  }
  fields.splice(index, 0, label);
}

function moveOrInsertBefore(fields: string[], before: string, label: string): void {
  const existingIndex = fields.indexOf(label);
  if (existingIndex >= 0) {
    fields.splice(existingIndex, 1);
  }
  const beforeIndex = fields.indexOf(before);
  if (beforeIndex < 0) {
    fields.push(label);
    return;
  }
  fields.splice(beforeIndex, 0, label);
}

function parseCppXferFields(
  body: string,
  mapper: (method: string, argument: string) => string | null,
): string[] {
  const fields: string[] = [];
  const seen = new Set<string>();
  const fieldRegex = /xfer->(xfer\w+)\s*\(\s*([^)]*?)\s*\)/g;
  let match;
  while ((match = fieldRegex.exec(body)) !== null) {
    const method = match[1]!;
    const argument = normalizeCppXferArgument(match[2]!);
    pushUniqueField(fields, seen, mapper(method, argument));
  }
  return fields;
}

function parseCppSimpleModuleFields(
  source: string,
  signature: string,
  baseExpansions: Record<string, string[]>,
  mapper: (method: string, argument: string) => string | null = mapCppSimpleModuleField,
): string[] {
  const body = extractFunctionBody(source, signature);
  if (!body) return [];
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex =
    /xfer->xferInt\s*\(\s*\(Int\*\)&production->m_exitDoor\s*\)|m_(?:clearFlags|setFlags)\.xfer\s*\(\s*xfer\s*\)|m_bonuses->m_(?:validKindOf|invalidKindOf)\.xfer\s*\(\s*xfer\s*\)|[A-Za-z0-9_]+::(?:xfer|upgradeMuxXfer)\s*\(\s*xfer\s*\)|xfer->(xfer\w+)\s*\(\s*([^)]*?)\s*\)/g;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    const token = match[0]!;
    if (token.includes('production->m_exitDoor')) {
      pushUniqueField(fields, seen, 'queue.entry.exitDoor');
      continue;
    }
    if (token.includes('m_clearFlags.xfer')) {
      pushUniqueField(fields, seen, 'clearFlags');
      continue;
    }
    if (token.includes('m_setFlags.xfer')) {
      pushUniqueField(fields, seen, 'setFlags');
      continue;
    }
    if (token.includes('m_bonuses->m_validKindOf.xfer')) {
      pushUniqueField(fields, seen, 'validKindOf');
      continue;
    }
    if (token.includes('m_bonuses->m_invalidKindOf.xfer')) {
      pushUniqueField(fields, seen, 'invalidKindOf');
      continue;
    }
    const baseKey = token.split('(')[0]?.replace(/\s+/g, '');
    const baseFields = baseKey ? baseExpansions[baseKey] : undefined;
    if (baseFields) {
      for (const field of baseFields) {
        pushUniqueField(fields, seen, field);
      }
      continue;
    }
    pushUniqueField(fields, seen, mapper(match[1]!, normalizeCppXferArgument(match[2]!)));
  }
  return fields;
}

function parseTsSimpleModuleFields(source: string, signature: string, labels: Record<string, string>): string[] {
  let body = extractFunctionBody(source, signature);
  if (body && !body.includes('xfer.')) {
    body = extractFunctionRegion(source, signature);
  }
  if (!body) return [];
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex =
    /const\s+(\w+)\s*=\s*xfer\.xfer(?:Version|Real|UnsignedInt|Int|Bool)\s*\(|(\w+):\s*xfer\.xfer(?:Real|UnsignedInt|Int|Bool)\s*\(|return\s+xfer\.xferUnsignedInt\s*\(\s*(\w+)\s*\)|xfer\.xferVersion\s*\(|xferSource(?:ModuleBase|DrawableModuleBase|BehaviorModuleBase)\s*\(/g;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    const token = match[0]!;
    if (token.includes('xferSourceBehaviorModuleBase')) {
      for (const field of ['behavior.version', 'objectModule.version', 'module.version']) {
        pushUniqueField(fields, seen, field);
      }
      continue;
    }
    if (token.includes('xferSourceDrawableModuleBase')) {
      for (const field of ['drawableModule.version', 'module.version']) {
        pushUniqueField(fields, seen, field);
      }
      continue;
    }
    if (token.includes('xferSourceModuleBase')) {
      pushUniqueField(fields, seen, 'module.version');
      continue;
    }
    const rawName = match[1] ?? match[2] ?? match[3];
    if (rawName) {
      pushUniqueField(fields, seen, labels[rawName]);
      continue;
    }
    for (const [needle, label] of Object.entries(labels)) {
      if (token.includes(needle)) {
        pushUniqueField(fields, seen, label);
        break;
      }
    }
  }
  return fields;
}

function prefixBaseVersion(fields: string[], prefix: string): string[] {
  return fields.map((field) => field === 'version' ? `${prefix}.version` : field);
}

function sourceDrawModuleBaseFields(): string[] {
  return ['drawModule.version', 'drawableModule.version', 'module.version'];
}

function sourceDrawableModuleBaseFields(): string[] {
  return ['drawableModule.version', 'module.version'];
}

function sourceUpdateModuleBaseFields(): string[] {
  return ['update.version', 'behavior.version', 'objectModule.version', 'module.version', 'nextCallFrameAndPhase'];
}

function sourceUpgradeMuxFields(): string[] {
  return ['upgradeMux.version', 'upgradeExecuted'];
}

function sourceDynamicGeometryInfoUpdateFields(): string[] {
  return [
    'version',
    ...sourceUpdateModuleBaseFields(),
    'startingDelayCountdown',
    'timeActive',
    'started',
    'finished',
    'reverseAtTransitionTime',
    'direction',
    'switchedDirections',
    'initialHeight',
    'initialMajorRadius',
    'initialMinorRadius',
    'finalHeight',
    'finalMajorRadius',
    'finalMinorRadius',
  ];
}

function sourceDockUpdateFields(): string[] {
  return [
    'version',
    ...sourceUpdateModuleBaseFields(),
    'enterPosition',
    'dockPosition',
    'exitPosition',
    'numberApproachPositions',
    'positionsLoaded',
    'approachPositions.count',
    'approachPositions.entry',
    'approachPositionOwners.count',
    'approachPositionOwners.entry',
    'approachPositionReached.count',
    'approachPositionReached.entry',
    'activeDocker',
    'dockerInside',
    'dockCrippled',
    'dockOpen',
  ];
}

function sourceProductionExitRallyFields(): string[] {
  return [
    'version',
    ...sourceUpdateModuleBaseFields(),
    'rallyPoint',
    'rallyPointExists',
  ];
}

function sourceParticleUplinkVisualFields(): string[] {
  return [
    'outerSystemIds',
    'laserBeamIds',
    'groundToOrbitBeamId',
    'orbitToTargetBeamId',
    'connectorSystemId',
    'laserBaseSystemId',
    'outerNodePositions',
    'outerNodeOrientations',
    'connectorNodePosition',
    'laserOriginPosition',
    'overrideTargetDestination',
    'upBonesCached',
    'defaultInfoCached',
    'invalidSettings',
  ];
}

export function parseCppSourceW3DModelDrawFields(source: string): string[] {
  return parseCppSimpleModuleFields(source, 'void W3DModelDraw::xfer( Xfer *xfer )', {
    'DrawModule::xfer': sourceDrawModuleBaseFields(),
  });
}

export function parseCppSourceW3DDrawBaseOnlyFields(source: string): string[] {
  return parseCppSimpleModuleFields(source, 'void W3DDefaultDraw::xfer( Xfer *xfer )', {
    'DrawModule::xfer': sourceDrawModuleBaseFields(),
  });
}

export function parseCppSourceW3DDrawModuleFields(source: string, className: string): string[] {
  const modelFields = parseCppSourceW3DModelDrawFields(source);
  const tankFields = parseCppSimpleModuleFields(source, 'void W3DTankDraw::xfer( Xfer *xfer )', {
    'W3DModelDraw::xfer': prefixBaseVersion(modelFields, 'modelDraw'),
  });
  const truckFields = parseCppSimpleModuleFields(source, 'void W3DTruckDraw::xfer( Xfer *xfer )', {
    'W3DModelDraw::xfer': prefixBaseVersion(modelFields, 'modelDraw'),
  });

  switch (className) {
    case 'W3DModelDraw':
      return modelFields;
    case 'W3DTankDraw':
      return tankFields;
    case 'W3DTruckDraw':
      return truckFields;
    case 'W3DOverlordTankDraw':
      return parseCppSimpleModuleFields(source, 'void W3DOverlordTankDraw::xfer( Xfer *xfer )', {
        'W3DTankDraw::xfer': prefixBaseVersion(tankFields, 'tankDraw'),
      });
    case 'W3DOverlordTruckDraw':
      return parseCppSimpleModuleFields(source, 'void W3DOverlordTruckDraw::xfer( Xfer *xfer )', {
        'W3DTruckDraw::xfer': prefixBaseVersion(truckFields, 'truckDraw'),
      });
    case 'W3DPoliceCarDraw':
      return parseCppSimpleModuleFields(source, 'void W3DPoliceCarDraw::xfer( Xfer *xfer )', {
        'W3DTruckDraw::xfer': prefixBaseVersion(truckFields, 'truckDraw'),
      });
    case 'W3DDependencyModelDraw':
      return parseCppSimpleModuleFields(source, 'void W3DDependencyModelDraw::xfer( Xfer *xfer )', {
        'W3DModelDraw::xfer': prefixBaseVersion(modelFields, 'modelDraw'),
      });
    case 'W3DTankTruckDraw':
    case 'W3DOverlordAircraftDraw':
    case 'W3DScienceModelDraw':
    case 'W3DSupplyDraw':
      return parseCppSimpleModuleFields(source, `void ${className}::xfer( Xfer *xfer )`, {
        'W3DModelDraw::xfer': prefixBaseVersion(modelFields, 'modelDraw'),
      });
    case 'W3DDebrisDraw':
    case 'W3DRopeDraw':
      return parseCppSimpleModuleFields(source, `void ${className}::xfer( Xfer *xfer )`, {
        'DrawModule::xfer': sourceDrawModuleBaseFields(),
      });
    default:
      return [];
  }
}

function parseTsSourceW3DDrawFields(
  source: string,
  signature: string,
  baseExpansions: Record<string, string[]>,
): string[] {
  const body = extractFunctionBody(source, signature);
  if (!body) return [];
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex =
    /xferSource\w+\s*\(|xfer\.xfer(?:Version|UnsignedByte|UnsignedInt|Bool|AsciiString|Color|Coord3D|Short|Int|Real)\s*\(|xfer\.xferUser\s*\(/g;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    const token = match[0]!;
    const callName = token.match(/^(xferSource\w+)/)?.[1];
    if (callName && baseExpansions[callName]) {
      for (const field of baseExpansions[callName]) {
        pushUniqueField(fields, seen, field);
      }
      continue;
    }
    pushUniqueField(fields, seen, mapTsSourceW3DDrawField(token, body, match.index));
  }
  return fields;
}

export function parseTsSourceW3DModelDrawFields(source: string): string[] {
  return parseTsSourceW3DDrawFields(source, 'function xferSourceW3DModelDrawBase', {
    xferSourceDrawModuleBase: sourceDrawModuleBaseFields(),
    xferSourceW3DWeaponRecoilInfo: ['weaponRecoil.state', 'weaponRecoil.shift', 'weaponRecoil.recoilRate'],
    xferSourceW3DSubObjectInfo: ['subObject.name', 'subObject.hide'],
    xferSourceW3DAnimationState: ['animation.mode', 'animation.percent'],
  });
}

export function parseTsSourceW3DDrawBaseOnlyFields(source: string): string[] {
  return parseTsSourceW3DDrawFields(source, 'function xferSourceW3DBaseDraw', {
    xferSourceDrawModuleBase: sourceDrawModuleBaseFields(),
  });
}

export function parseTsSourceW3DDrawModuleFields(source: string, helperName: string): string[] {
  const modelFields = parseTsSourceW3DModelDrawFields(source);
  const tankFields = parseTsSourceW3DDrawFields(source, 'function xferSourceW3DTankDraw', {
    xferSourceW3DModelDrawBase: prefixBaseVersion(modelFields, 'modelDraw'),
  });
  const truckFields = parseTsSourceW3DDrawFields(source, 'function xferSourceW3DTruckDraw', {
    xferSourceW3DModelDrawBase: prefixBaseVersion(modelFields, 'modelDraw'),
  });

  switch (helperName) {
    case 'xferSourceW3DModelDrawBase':
      return modelFields;
    case 'xferSourceW3DModelDrawDerived':
      return parseTsSourceW3DDrawFields(source, 'function xferSourceW3DModelDrawDerived', {
        xferSourceW3DModelDrawBase: prefixBaseVersion(modelFields, 'modelDraw'),
      });
    case 'xferSourceW3DTankDraw':
      return tankFields;
    case 'xferSourceW3DTruckDraw':
      return truckFields;
    case 'xferSourceW3DOverlordTankDraw':
      return parseTsSourceW3DDrawFields(source, 'function xferSourceW3DOverlordTankDraw', {
        xferSourceW3DTankDraw: prefixBaseVersion(tankFields, 'tankDraw'),
      });
    case 'xferSourceW3DOverlordTruckDraw':
      return parseTsSourceW3DDrawFields(source, 'function xferSourceW3DOverlordTruckDraw', {
        xferSourceW3DTruckDraw: prefixBaseVersion(truckFields, 'truckDraw'),
      });
    case 'xferSourceW3DDependencyModelDraw':
      return parseTsSourceW3DDrawFields(source, 'function xferSourceW3DDependencyModelDraw', {
        xferSourceW3DModelDrawDerived: parseTsSourceW3DDrawModuleFields(source, 'xferSourceW3DModelDrawDerived'),
      });
    case 'xferSourceW3DDebrisDraw':
    case 'xferSourceW3DRopeDraw':
      return parseTsSourceW3DDrawFields(source, `function ${helperName}`, {
        xferSourceDrawModuleBase: sourceDrawModuleBaseFields(),
        xferSourceRGBColor: ['color'],
      });
    default:
      return [];
  }
}

export function parseCppSourceDrawableClientUpdateFields(source: string, className: string): string[] {
  return parseCppSimpleModuleFields(source, `void ${className}::xfer( Xfer *xfer )`, {
    'ClientUpdateModule::xfer': sourceDrawableModuleBaseFields(),
  });
}

export function parseTsSourceDrawableClientUpdateFields(source: string, helperName: string): string[] {
  return parseTsSourceW3DDrawFields(source, `function ${helperName}`, {
    xferSourceDrawableModuleBase: sourceDrawableModuleBaseFields(),
  });
}

export function parseCppSourceObjectUpdateFields(source: string, className: string): string[] {
  const dynamicGeometryFields = parseCppSimpleModuleFields(
    source,
    'void DynamicGeometryInfoUpdate::xfer( Xfer *xfer )',
    {
      'UpdateModule::xfer': sourceUpdateModuleBaseFields(),
    },
  );
  let mapper = mapCppSimpleModuleField;
  if (className === 'ProductionUpdate') {
    mapper = mapCppProductionUpdateField;
  } else if (className === 'NeutronMissileUpdate') {
    mapper = mapCppNeutronMissileUpdateField;
  }
  return parseCppSimpleModuleFields(
    source,
    `void ${className}::xfer( Xfer *xfer )`,
    {
      'UpdateModule::xfer': sourceUpdateModuleBaseFields(),
      'UpgradeMux::upgradeMuxXfer': sourceUpgradeMuxFields(),
      'DynamicGeometryInfoUpdate::xfer': prefixBaseVersion(dynamicGeometryFields, 'dynamicGeometry'),
      'DockUpdate::xfer': prefixBaseVersion(sourceDockUpdateFields(), 'dock'),
    },
    mapper,
  );
}

export function parseTsSourceObjectUpdateFields(
  source: string,
  helperName: string,
  options: { hasUpgradeMux?: boolean } = {},
): string[] {
  const body = extractFunctionBodyAfterParams(source, helperName);
  if (!body) return [];
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex =
    /xferSource(?:UpdateModuleBase|DynamicGeometryInfoUpdate|DockUpdateBlockState|ProductionExitRallyState|ParticleUplinkVisualState|WeaponSnapshot|KindOfNames|StringBitFlags|RgbColor|BoneFx(?:Int|Coord)Grid)\s*\(|(?:saver|xfer)\.xfer(?:Version|UnsignedShort|UnsignedInt|ObjectIDList|ObjectID|AsciiString|Int|Bool|Coord3D|Real)\s*\(|(?:saver|xfer)\.xferUser\s*\(/g;
  let versionIndex = 0;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    const token = match[0]!;
    if (token.includes('xferVersion')) {
      if (versionIndex === 0) {
        pushUniqueField(fields, seen, 'version');
      } else if (options.hasUpgradeMux && versionIndex === 1) {
        pushUniqueField(fields, seen, 'upgradeMux.version');
      }
      versionIndex += 1;
      continue;
    }
    if (token.includes('xferUser')) {
      const window = tsTokenStatement(body, match.index);
      if (window.includes('buildSourceUpdateModuleBaseBlockData')) {
        for (const field of sourceUpdateModuleBaseFields()) {
          pushUniqueField(fields, seen, field);
        }
        continue;
      }
    }
    if (token.includes('xferSourceUpdateModuleBase')) {
      for (const field of sourceUpdateModuleBaseFields()) {
        pushUniqueField(fields, seen, field);
      }
      continue;
    }
    if (token.includes('xferSourceDockUpdateBlockState')) {
      for (const field of prefixBaseVersion(sourceDockUpdateFields(), 'dock')) {
        pushUniqueField(fields, seen, field);
      }
      continue;
    }
    if (token.includes('xferSourceProductionExitRallyState')) {
      for (const field of sourceProductionExitRallyFields()) {
        pushUniqueField(fields, seen, field);
      }
      continue;
    }
    if (token.includes('xferSourceParticleUplinkVisualState')) {
      for (const field of sourceParticleUplinkVisualFields()) {
        pushUniqueField(fields, seen, field);
      }
      continue;
    }
    if (token.includes('xferSourceDynamicGeometryInfoUpdate')) {
      const dynamicGeometryFields = helperName === 'buildSourceFirestormDynamicGeometryInfoUpdateBlockData'
        ? prefixBaseVersion(sourceDynamicGeometryInfoUpdateFields(), 'dynamicGeometry')
        : sourceDynamicGeometryInfoUpdateFields();
      for (const field of dynamicGeometryFields) {
        pushUniqueField(fields, seen, field);
      }
      continue;
    }
    pushUniqueField(fields, seen, mapTsSourceObjectUpdateField(token, body, match.index));
  }
  return fields;
}

function extractFunctionRegion(source: string, signature: string): string | null {
  const start = source.indexOf(signature);
  if (start < 0) {
    return null;
  }
  const nextFunction = source.indexOf('\nfunction ', start + signature.length);
  const nextClass = source.indexOf('\nclass ', start + signature.length);
  const candidates = [nextFunction, nextClass].filter((index) => index >= 0);
  const end = candidates.length > 0 ? Math.min(...candidates) : source.length;
  return source.slice(start, end);
}

function parseTsScienceVectorFields(body: string): string[] {
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex =
    /xfer\.xferVersion\s*\(\s*1\s*\)|xfer\.xferUnsignedShort\s*\(|xfer\.xferAsciiString\s*\(/g;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    pushUniqueField(fields, seen, mapTsScienceVectorField(match[0]!));
  }
  return fields;
}

function normalizeCppXferArgument(argument: string): string {
  return argument
    .replace(/^&\s*/, '')
    .replace(/^\(/, '')
    .trim();
}

function extractFunctionBody(source: string, signature: string): string | null {
  const start = source.indexOf(signature);
  if (start < 0) {
    return null;
  }
  const openBrace = source.indexOf('{', start);
  if (openBrace < 0) {
    return null;
  }
  let depth = 0;
  for (let index = openBrace; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(openBrace, index + 1);
      }
    }
  }
  return null;
}

function extractFunctionBodyAfterParams(source: string, functionName: string): string | null {
  const signature = `function ${functionName}`;
  const start = source.indexOf(signature);
  if (start < 0) {
    return null;
  }
  const openParen = source.indexOf('(', start + signature.length);
  if (openParen < 0) {
    return null;
  }

  let parenDepth = 0;
  let closeParen = -1;
  for (let index = openParen; index < source.length; index += 1) {
    const char = source[index];
    if (char === '(') {
      parenDepth += 1;
    } else if (char === ')') {
      parenDepth -= 1;
      if (parenDepth === 0) {
        closeParen = index;
        break;
      }
    }
  }
  if (closeParen < 0) {
    return null;
  }

  const openBrace = source.indexOf('{', closeParen);
  if (openBrace < 0) {
    return null;
  }
  let depth = 0;
  for (let index = openBrace; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(openBrace, index + 1);
      }
    }
  }
  return null;
}

function parseTsSkirmishGameSlotXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'function xferChallengeGameSlotState');
  if (!body) {
    return [];
  }
  const fields: string[] = [];
  const fieldRegex = /const\s+(\w+)\s*=\s*(?:version\s+>=\s+2\s+\?\s*)?xfer\.xfer\w+\s*\(/g;
  let match;
  while ((match = fieldRegex.exec(body)) !== null) {
    const rawName = match[1]!;
    const label = mapTsSkirmishGameInfoField(rawName);
    if (label?.startsWith('slot.')) {
      fields.push(label);
    }
  }
  return fields;
}

function parseTsTerrainWaterUpdateXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'function xferSourceTerrainWaterUpdate');
  if (!body) {
    return [];
  }
  const fields: string[] = [];
  const seen = new Set<string>();
  const fieldRegex =
    /(triggerId|changePerFrame|targetHeight|damageAmount|currentHeight):\s*xfer\.xfer\w+\s*\(/g;
  let match;
  while ((match = fieldRegex.exec(body)) !== null) {
    pushUniqueField(fields, seen, mapTsTerrainLogicField(match[1]!));
  }
  return fields;
}

function parseCppRadarObjectListXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'static void xferRadarObjectList');
  if (!body) {
    return [];
  }
  const objectFields = parseCppRadarObjectXferFields(source);
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex =
    /xfer->(xfer\w+)\s*\(\s*([^)]*?)\s*\)|xfer->xferSnapshot\s*\(\s*radarObject\s*\)/g;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    if (match[0]!.includes('xferSnapshot')) {
      for (const field of objectFields) {
        pushUniqueField(fields, seen, `object.${field}`);
      }
      continue;
    }
    const method = match[1]!;
    const argument = normalizeCppXferArgument(match[2]!);
    pushUniqueField(fields, seen, mapCppRadarObjectListField(method, argument));
  }
  return fields;
}

function parseCppRadarObjectXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'void RadarObject::xfer');
  if (!body) {
    return [];
  }
  return parseCppXferFields(body, mapCppRadarObjectField);
}

function parseTsRadarObjectListXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'function xferSourceRadarObjectList');
  if (!body) {
    return [];
  }
  const objectFields = parseTsRadarObjectXferFields(source);
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex =
    /xfer\.xferVersion\s*\(|xfer\.xferUnsignedShort\s*\(\s*objectList\.length\s*\)|xferSourceRadarObject\s*\(/g;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    if (match[0]!.startsWith('xferSourceRadarObject')) {
      for (const field of objectFields) {
        pushUniqueField(fields, seen, `object.${field}`);
      }
      continue;
    }
    pushUniqueField(fields, seen, mapTsRadarObjectListField(match[0]!));
  }
  return fields;
}

function parseTsRadarObjectXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'function xferSourceRadarObject');
  if (!body) {
    return [];
  }
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex =
    /xfer\.xferVersion\s*\(|objectId:\s*xfer\.xferObjectID\s*\(|color:\s*xfer\.xferColor\s*\(/g;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    pushUniqueField(fields, seen, mapTsRadarObjectField(match[0]!));
  }
  return fields;
}

function parseTsRadarEventXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'function xferSourceRadarEvent');
  if (!body) {
    return [];
  }
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex =
    /(type|active|createFrame|dieFrame|fadeFrame|color1|color2|worldLoc|radarLoc|soundPlayed):\s*xfer\.xfer\w+\s*\(/g;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    pushUniqueField(fields, seen, mapTsRadarEventField(match[1]!));
  }
  return fields;
}

function parseCppPartitionCellXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'void PartitionCell::xfer');
  if (!body) {
    return [];
  }
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex = /xfer->(xfer\w+)\s*\(\s*([^)]*?)\s*\)/g;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    const method = match[1]!;
    const argument = normalizeCppXferArgument(match[2]!);
    const labels = mapCppPartitionCellFields(method, argument);
    for (const label of labels) {
      pushUniqueField(fields, seen, label);
    }
  }
  return fields;
}

function parseCppPartitionUndoRevealXferFields(source: string): string[] {
  const body = extractFunctionBody(source, 'void SightingInfo::xfer');
  if (!body) {
    return [];
  }
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex = /xfer->(xfer\w+)\s*\(\s*([^)]*?)\s*\)/g;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    const method = match[1]!;
    const argument = normalizeCppXferArgument(match[2]!);
    pushUniqueField(fields, seen, mapCppPartitionUndoRevealField(method, argument));
  }
  return fields;
}

function parseTsPartitionShroudLevelXferFields(source: string): string[] {
  const start = source.indexOf('function xferSourcePartitionShroudLevel');
  if (start < 0) {
    return [];
  }
  const end = source.indexOf('function xferSourcePartitionUndoReveal', start);
  const body = source.slice(start, end < 0 ? undefined : end);
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex = /(currentShroud|activeShroudLevel):\s*xfer\.xferShort\s*\(/g;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    pushUniqueField(fields, seen, match[1]!);
  }
  return fields;
}

function parseTsPartitionUndoRevealXferFields(source: string): string[] {
  const start = source.indexOf('function xferSourcePartitionUndoReveal');
  if (start < 0) {
    return [];
  }
  const end = source.indexOf('class PartitionSnapshot', start);
  const body = source.slice(start, end < 0 ? undefined : end);
  const fields: string[] = [];
  const seen = new Set<string>();
  const tokenRegex =
    /xfer\.xferVersion\s*\(|(where):\s*xfer\.xferCoord3D\s*\(|(howFar):\s*xfer\.xferReal\s*\(|(forWhom):\s*xfer\.xferUnsignedShort\s*\(|(data):\s*xfer\.xferUnsignedInt\s*\(/g;
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    const rawName = match[1] ?? match[2] ?? match[3] ?? match[4];
    pushUniqueField(fields, seen, rawName ?? 'version');
  }
  return fields;
}

function mapCppSkirmishGameInfoField(method: string, argument: string): string | null {
  if (method === 'xferVersion') {
    return 'version';
  }
  if (method === 'xferMapName' && argument === 'm_mapName') {
    return 'mapName';
  }
  if (method === 'xferSnapshot' && argument === 'm_startingCash') {
    return 'startingCash';
  }
  const normalized = argument.replace(/^m_/, '');
  const mappings = new Map<string, string>([
    ['preorderMask', 'preorderMask'],
    ['crcInterval', 'crcInterval'],
    ['inGame', 'inGame'],
    ['inProgress', 'inProgress'],
    ['surrendered', 'surrendered'],
    ['gameID', 'gameId'],
    ['slot', 'slotCount'],
    ['state', 'slot.state'],
    ['name', 'slot.name'],
    ['isAccepted', 'slot.isAccepted'],
    ['isMuted', 'slot.isMuted'],
    ['color', 'slot.color'],
    ['startPos', 'slot.startPos'],
    ['playerTemplate', 'slot.playerTemplate'],
    ['teamNumber', 'slot.teamNumber'],
    ['origColor', 'slot.origColor'],
    ['origStartPos', 'slot.origStartPos'],
    ['origPlayerTemplate', 'slot.origPlayerTemplate'],
    ['localIP', 'localIp'],
    ['mapCRC', 'mapCrc'],
    ['mapSize', 'mapSize'],
    ['mapMask', 'mapMask'],
    ['seed', 'seed'],
    ['superweaponRestriction', 'superweaponRestriction'],
    ['obsoleteBool', 'version3ObsoleteBool'],
  ]);
  return mappings.get(normalized) ?? null;
}

function mapTsSkirmishGameInfoField(rawName: string): string | null {
  const mappings = new Map<string, string>([
    ['version', 'version'],
    ['preorderMask', 'preorderMask'],
    ['crcInterval', 'crcInterval'],
    ['inGame', 'inGame'],
    ['inProgress', 'inProgress'],
    ['surrendered', 'surrendered'],
    ['gameId', 'gameId'],
    ['slotCount', 'slotCount'],
    ['state', 'slot.state'],
    ['name', 'slot.name'],
    ['isAccepted', 'slot.isAccepted'],
    ['isMuted', 'slot.isMuted'],
    ['color', 'slot.color'],
    ['startPos', 'slot.startPos'],
    ['playerTemplate', 'slot.playerTemplate'],
    ['teamNumber', 'slot.teamNumber'],
    ['origColor', 'slot.origColor'],
    ['origStartPos', 'slot.origStartPos'],
    ['origPlayerTemplate', 'slot.origPlayerTemplate'],
    ['localIp', 'localIp'],
    ['mapName', 'mapName'],
    ['mapCrc', 'mapCrc'],
    ['mapSize', 'mapSize'],
    ['mapMask', 'mapMask'],
    ['seed', 'seed'],
    ['superweaponRestriction', 'superweaponRestriction'],
    ['startingCash', 'startingCash'],
  ]);
  return mappings.get(rawName) ?? null;
}

function mapCppCampaignManagerField(method: string, argument: string): string | null {
  if (method === 'xferVersion') {
    return 'version';
  }
  if (method === 'xferAsciiString' && argument === 'currentCampaign') {
    return 'currentCampaign';
  }
  if (method === 'xferAsciiString' && argument === 'currentMission') {
    return 'currentMission';
  }
  if (method === 'xferInt' && argument === 'm_currentRankPoints') {
    return 'currentRankPoints';
  }
  if (method === 'xferUser' && argument.startsWith('m_difficulty')) {
    return 'difficulty';
  }
  if (method === 'xferBool' && argument === 'isChallengeCampaign') {
    return 'isChallengeCampaign';
  }
  if (method === 'xferSnapshot' && argument === 'TheChallengeGameInfo') {
    return 'challengeGameInfoSnapshot';
  }
  if (method === 'xferInt' && argument === 'playerTemplateNum') {
    return 'playerTemplateNum';
  }
  return null;
}

function mapTsCampaignManagerField(rawName: string): string | null {
  const mappings = new Map<string, string>([
    ['currentCampaign', 'currentCampaign'],
    ['currentMission', 'currentMission'],
    ['currentRankPoints', 'currentRankPoints'],
    ['isChallengeCampaign', 'isChallengeCampaign'],
    ['playerTemplateNum', 'playerTemplateNum'],
  ]);
  return mappings.get(rawName) ?? null;
}

function mapCppTerrainLogicField(method: string, argument: string): string | null {
  if (method === 'xferVersion') {
    return 'version';
  }
  if (method === 'xferInt' && argument === 'activeBoundary') {
    return 'activeBoundary';
  }
  if (method === 'xferInt' && argument === 'm_numWaterToUpdate') {
    return 'waterUpdateCount';
  }
  if (method === 'xferInt' && argument === 'triggerID') {
    return 'waterUpdate.triggerId';
  }
  if (method === 'xferReal' && argument.endsWith('.changePerFrame')) {
    return 'waterUpdate.changePerFrame';
  }
  if (method === 'xferReal' && argument.endsWith('.targetHeight')) {
    return 'waterUpdate.targetHeight';
  }
  if (method === 'xferReal' && argument.endsWith('.damageAmount')) {
    return 'waterUpdate.damageAmount';
  }
  if (method === 'xferReal' && argument.endsWith('.currentHeight')) {
    return 'waterUpdate.currentHeight';
  }
  return null;
}

function mapTsTerrainLogicField(token: string): string | null {
  if (token.startsWith('xfer.xferVersion')) return 'version';
  if (token.includes('payload.activeBoundary')) return 'activeBoundary';
  if (token.includes('payload.waterUpdates.length')) return 'waterUpdateCount';
  if (token.includes('triggerId')) return 'waterUpdate.triggerId';
  if (token.includes('changePerFrame')) return 'waterUpdate.changePerFrame';
  if (token.includes('targetHeight')) return 'waterUpdate.targetHeight';
  if (token.includes('damageAmount')) return 'waterUpdate.damageAmount';
  if (token.includes('currentHeight')) return 'waterUpdate.currentHeight';
  return null;
}

function mapCppTacticalViewField(method: string, argument: string): string | null {
  if (method === 'xferVersion') {
    return 'version';
  }
  if (method === 'xferReal' && argument === 'angle') {
    return 'angle';
  }
  if (method === 'xferReal' && argument === 'viewPos.x') {
    return 'position.x';
  }
  if (method === 'xferReal' && argument === 'viewPos.y') {
    return 'position.y';
  }
  if (method === 'xferReal' && argument === 'viewPos.z') {
    return 'position.z';
  }
  return null;
}

function mapCppInGameUiField(method: string, argument: string): string | null {
  if (method === 'xferVersion') {
    return 'version';
  }
  const mappings = new Map<string, string>([
    ['m_namedTimerLastFlashFrame', 'namedTimerLastFlashFrame'],
    ['m_namedTimerUsedFlashColor', 'namedTimerUsedFlashColor'],
    ['m_showNamedTimers', 'showNamedTimers'],
    ['timerCount', 'namedTimerCount'],
    ['timerIter->second->m_timerName', 'namedTimer.name'],
    ['timerIter->second->timerText', 'namedTimer.text'],
    ['timerIter->second->isCountdown', 'namedTimer.isCountdown'],
    ['m_superweaponHiddenByScript', 'superweaponHiddenByScript'],
    ['playerIndex', 'superweapon.playerIndex'],
    ['templateName', 'superweapon.templateName'],
    ['powerName', 'superweapon.powerName'],
    ['swInfo->m_id', 'superweapon.objectId'],
    ['swInfo->m_timestamp', 'superweapon.timestamp'],
    ['swInfo->m_hiddenByScript', 'superweapon.hiddenByScript'],
    ['swInfo->m_hiddenByScience', 'superweapon.hiddenByScience'],
    ['swInfo->m_ready', 'superweapon.ready'],
    ['swInfo->m_evaReadyPlayed', 'superweapon.evaReadyPlayed'],
    ['noMorePlayers', 'superweaponSentinel'],
  ]);
  return mappings.get(argument) ?? null;
}

function mapTsInGameUiField(token: string): string | null {
  if (token.startsWith('xfer.xferVersion')) return 'version';
  if (token.includes('namedTimerLastFlashFrame')) return 'namedTimerLastFlashFrame';
  if (token.includes('namedTimerUsedFlashColor')) return 'namedTimerUsedFlashColor';
  if (token.includes('showNamedTimers')) return 'showNamedTimers';
  if (token.includes('namedTimers.length')) return 'namedTimerCount';
  if (token.includes('timer.timerName')) return 'namedTimer.name';
  if (token.includes('timer.timerText')) return 'namedTimer.text';
  if (token.includes('timer.isCountdown')) return 'namedTimer.isCountdown';
  if (token.includes('superweaponHiddenByScript')) return 'superweaponHiddenByScript';
  if (token.includes('superweapon.playerIndex')) return 'superweapon.playerIndex';
  if (token.includes('superweapon.templateName')) return 'superweapon.templateName';
  if (token.includes('superweapon.powerName')) return 'superweapon.powerName';
  if (token.includes('superweapon.objectId')) return 'superweapon.objectId';
  if (token.includes('Math.max')) return 'superweapon.timestamp';
  if (token.includes('superweapon.hiddenByScript')) return 'superweapon.hiddenByScript';
  if (token.includes('superweapon.hiddenByScience')) return 'superweapon.hiddenByScience';
  if (token.includes('superweapon.ready')) return 'superweapon.ready';
  if (token.includes('superweapon.evaReadyPlayed')) return 'superweapon.evaReadyPlayed';
  if (token.includes('-1')) return 'superweaponSentinel';
  return null;
}

function mapCppGameLogicObjectTocField(method: string, argument: string): string | null {
  if (method === 'xferVersion') return 'version';
  if (method === 'xferUnsignedInt' && argument === 'tocCount') return 'tocCount';
  if (method === 'xferAsciiString' && (argument === 'tocEntry->name' || argument === 'templateName')) {
    return 'entry.templateName';
  }
  if (method === 'xferUnsignedShort' && (argument === 'tocEntry->id' || argument === 'id')) return 'entry.tocId';
  return null;
}

function mapTsGameLogicObjectTocField(token: string): string | null {
  if (token.includes('xferVersion')) return 'version';
  if (token.includes('objectTocEntries.length')) return 'tocCount';
  if (token.includes('tocEntry.templateName')) return 'entry.templateName';
  if (token.includes('tocEntry.tocId')) return 'entry.tocId';
  return null;
}

function mapCppBuildAssistantSellListField(method: string, argument: string): string | null {
  if (method === 'xferInt' && argument === 'count') return 'count';
  if (method === 'xferObjectID' && argument === 'sellInfo->m_id') return 'entry.objectId';
  if (method === 'xferUnsignedInt' && argument === 'sellInfo->m_sellFrame') return 'entry.sellFrame';
  return null;
}

function mapTsSourceSellingEntitiesField(token: string): string | null {
  if (token.includes('entries.length')) return 'count';
  if (token.includes('xferObjectID')) return 'entry.objectId';
  if (token.includes('xferUnsignedInt')) return 'entry.sellFrame';
  return null;
}

function mapCppGameLogicBuildableOverrideMapField(method: string, argument: string): string | null {
  if (method === 'xferAsciiString' && argument === 'name') return 'entry.templateName';
  if (method === 'xferUser' && argument === 'bs, sizeof(bs') return 'entry.status';
  if (method === 'xferAsciiString' && argument === 'empty') return 'terminator';
  return null;
}

function mapTsGameLogicBuildableOverrideMapField(token: string): string | null {
  if (token.includes('templateName')) return 'entry.templateName';
  if (token.includes('xferInt')) return 'entry.status';
  if (token.includes("xferAsciiString(''")) return 'terminator';
  return null;
}

function mapCppGameLogicControlBarOverrideMapField(method: string, argument: string): string | null {
  if (method === 'xferAsciiString' && argument === 'name') return 'entry.name';
  if (method === 'xferAsciiString' && argument === 'value') return 'entry.commandButtonName';
  if (method === 'xferAsciiString' && argument === 'empty') return 'terminator';
  return null;
}

function mapTsGameLogicControlBarOverrideMapField(token: string): string | null {
  if (token.includes('entry.name') || token.includes('const name')) return 'entry.name';
  if (token.includes('commandButtonName')) return 'entry.commandButtonName';
  if (token.includes("xferAsciiString(''")) return 'terminator';
  return null;
}

function mapCppGameLogicField(method: string, argument: string): string | null {
  if (method === 'xferVersion') return 'version';
  if (method === 'xferUnsignedInt' && argument === 'm_frame') return 'frame';
  if (method === 'xferUnsignedInt' && argument === 'objectCount') return 'objectCount';
  if (method === 'xferUnsignedShort' && (argument === 'tocEntry->id' || argument === 'tocID')) return 'object.tocId';
  if (method === 'xferSnapshot' && argument === 'obj') return 'object.snapshot';
  if (method === 'xferSnapshot' && argument === 'TheCampaignManager') return 'campaign.snapshot';
  if (method === 'xferSnapshot' && argument === 'TheCaveSystem') return 'caveSystem.snapshot';
  if (method === 'xferBool' && argument === 'm_isScoringEnabled') return 'scoringEnabled';
  if (method === 'xferUnsignedInt' && argument === 'triggerCount') return 'polygonTriggerCount';
  if (method === 'xferInt' && argument === 'triggerID') return 'polygonTrigger.id';
  if (method === 'xferSnapshot' && argument === 'poly') return 'polygonTrigger.snapshot';
  if (method === 'xferInt' && argument === 'm_rankLevelLimit') return 'rankLevelLimit';
  if (method === 'xferBool' && argument === 'm_showBehindBuildingMarkers') return 'showBehindBuildingMarkers';
  if (method === 'xferBool' && argument === 'm_drawIconUI') return 'drawIconUI';
  if (method === 'xferBool' && argument === 'm_showDynamicLOD') return 'showDynamicLOD';
  if (method === 'xferInt' && argument === 'm_scriptHulkMaxLifetimeOverride') return 'scriptHulkMaxLifetimeOverride';
  if (method === 'xferInt' && argument === 'm_rankPointsToAddAtGameStart') return 'rankPointsToAddAtGameStart';
  if (method === 'xferUnsignedShort' && argument === 'm_superweaponRestriction') return 'superweaponRestriction';
  return null;
}

function mapTsSourceGameLogicField(token: string): string | null {
  if (token.includes('sourceState.version')) return 'version';
  if (token.includes('frameCounter')) return 'frame';
  if (token.includes('xferVersion(1')) return 'objectTOC.snapshot';
  if (token.includes('sourceState.objects.length')) return 'objectCount';
  if (token.includes('object.tocId')) return 'object.tocId';
  if (token.includes('beginBlock')) return 'object.block.begin';
  if (token.includes('xferUser')) return 'object.snapshot';
  if (token.includes('endBlock')) return 'object.block.end';
  if (token.includes('CampaignSnapshot')) return 'campaign.snapshot';
  if (token.includes('xferSourceCaveTrackerVector')) return 'caveSystem.snapshot';
  if (token.includes('scriptScoringEnabled')) return 'scoringEnabled';
  if (token.includes('polygonTriggers.length')) return 'polygonTriggerCount';
  if (token.includes('polygonTrigger.triggerId')) return 'polygonTrigger.id';
  if (token.includes('xferSourcePolygonTriggerSnapshot')) return 'polygonTrigger.snapshot';
  if (token.includes('rankLevelLimit')) return 'rankLevelLimit';
  if (token.includes('xferSourceSellingEntities')) return 'sellList.snapshot';
  if (token.includes('xferSourceBuildableOverrideMap')) return 'buildableOverrides.map';
  if (token.includes('showBehindBuildingMarkers')) return 'showBehindBuildingMarkers';
  if (token.includes('drawIconUI')) return 'drawIconUI';
  if (token.includes('showDynamicLOD')) return 'showDynamicLOD';
  if (token.includes('scriptHulkMaxLifetimeOverride')) return 'scriptHulkMaxLifetimeOverride';
  if (token.includes('xferSourceControlBarOverrideMapEntries')) return 'controlBarOverrides.map';
  if (token.includes('rankPointsToAddAtGameStart')) return 'rankPointsToAddAtGameStart';
  if (token.includes('superweaponRestriction')) return 'superweaponRestriction';
  return null;
}

function mapCppObjectModuleListField(method: string, argument: string): string | null {
  if (method === 'xferUnsignedShort' && argument === 'moduleCount') return 'moduleCount';
  if (method === 'xferAsciiString' && argument === 'moduleIdentifier') return 'module.identifier';
  if (method === 'xferSnapshot' && argument === 'module') return 'module.snapshot';
  return null;
}

function mapTsObjectModuleListField(token: string): string | null {
  if (token.includes('xferUnsignedShort')) return 'moduleCount';
  if (token.includes('xferAsciiString')) return 'module.identifier';
  if (token.includes('beginBlock')) return 'module.block.begin';
  if (token.includes('xferUser')) return 'module.snapshot';
  if (token.includes('endBlock')) return 'module.block.end';
  return null;
}

function mapCppObjectField(method: string, argument: string): string | null {
  if (method === 'xferVersion') return 'version';
  if (method === 'xferObjectID' && argument === 'id') return 'objectId';
  if (method === 'xferMatrix3D' && argument === 'mtx') return 'transformMatrix';
  if (method === 'xferUser' && argument.startsWith('teamID')) return 'teamId';
  if (method === 'xferObjectID' && argument === 'm_producerID') return 'producerId';
  if (method === 'xferObjectID' && argument === 'm_builderID') return 'builderId';
  if (method === 'xferDrawableID' && argument === 'drawableID') return 'drawableId';
  if (method === 'xferAsciiString' && argument === 'm_name') return 'internalName';
  if (method === 'xferUnsignedByte' && argument === 'm_scriptStatus') return 'scriptStatus';
  if (method === 'xferUnsignedByte' && argument === 'm_privateStatus') return 'privateStatus';
  if (method === 'xferSnapshot' && argument === 'm_geometryInfo') return 'geometryInfo';
  if (method === 'xferSnapshot' && argument === 'm_partitionLastLook') return 'partitionLastLook';
  if (method === 'xferSnapshot' && argument === 'm_partitionRevealAllLastLook') return 'partitionRevealAllLastLook';
  if (method === 'xferSnapshot' && argument === 'm_partitionLastShroud') return 'partitionLastShroud';
  if (method === 'xferUser' && argument.startsWith('m_visionSpiedBy')) return 'visionSpiedBy';
  if (method === 'xferUser' && argument.startsWith('m_visionSpiedMask')) return 'visionSpiedMask';
  if (method === 'xferReal' && argument === 'm_visionRange') return 'visionRange';
  if (method === 'xferReal' && argument === 'm_shroudClearingRange') return 'shroudClearingRange';
  if (method === 'xferReal' && argument === 'm_shroudRange') return 'shroudRange';
  if (method === 'xferBool' && argument === 'm_singleUseCommandUsed') return 'singleUseCommandUsed';
  if (method === 'xferUser' && argument.startsWith('m_disabledTillFrame')) return 'disabledTillFrame';
  if (method === 'xferUnsignedInt' && argument === 'm_smcUntil') return 'specialModelConditionUntil';
  if (method === 'xferSnapshot' && argument === 'm_experienceTracker') return 'experienceTracker';
  if (method === 'xferObjectID' && argument === 'm_xferContainedByID') return 'containedById';
  if (method === 'xferUnsignedInt' && argument === 'm_containedByFrame') return 'containedByFrame';
  if (method === 'xferReal' && argument === 'm_constructionPercent') return 'constructionPercent';
  if (method === 'xferUpgradeMask' && argument === 'm_objectUpgradesCompleted') return 'completedUpgradeNames';
  if (method === 'xferAsciiString' && argument === 'm_originalTeamName') return 'originalTeamName';
  if (method === 'xferColor' && argument === 'm_indicatorColor') return 'indicatorColor';
  if (method === 'xferCoord3D' && argument === 'm_healthBoxOffset') return 'healthBoxOffset';
  if (method === 'xferByte' && argument === 'm_numTriggerAreasActive') return 'triggerAreaCount';
  if (method === 'xferUnsignedInt' && argument === 'm_enteredOrExitedFrame') return 'enteredOrExitedFrame';
  if (method === 'xferICoord3D' && argument === 'm_iPos') return 'ipos';
  if (method === 'xferAsciiString' && argument === 'triggerName') return 'triggerArea.name';
  if (method === 'xferByte' && argument === 'm_triggerInfo[i].entered') return 'triggerArea.entered';
  if (method === 'xferByte' && argument === 'm_triggerInfo[i].exited') return 'triggerArea.exited';
  if (method === 'xferByte' && argument === 'm_triggerInfo[i].isInside') return 'triggerArea.isInside';
  if (method === 'xferUser' && argument.startsWith('m_layer')) return 'layer';
  if (method === 'xferUser' && argument.startsWith('m_destinationLayer')) return 'destinationLayer';
  if (method === 'xferBool' && argument === 'm_isSelectable') return 'isSelectable';
  if (method === 'xferUnsignedInt' && argument === 'm_safeOcclusionFrame') return 'safeOcclusionFrame';
  if (method === 'xferUser' && argument.startsWith('m_formationID')) return 'formationId';
  if (method === 'xferCoord2D' && argument === 'm_formationOffset') return 'formationOffset';
  if (method === 'xferUnsignedShort' && argument === 'moduleCount') return 'modules.snapshot';
  if (method === 'xferObjectID' && argument === 'm_soleHealingBenefactorID') return 'soleHealingBenefactorId';
  if (method === 'xferUnsignedInt' && argument === 'm_soleHealingBenefactorExpirationFrame') {
    return 'soleHealingBenefactorExpirationFrame';
  }
  if (method === 'xferUnsignedInt' && argument === 'm_weaponBonusCondition') return 'weaponBonusCondition';
  if (method === 'xferUser' && argument.startsWith('m_lastWeaponCondition')) return 'lastWeaponCondition';
  if (method === 'xferSnapshot' && argument === 'm_weaponSet') return 'weaponSet';
  if (method === 'xferAsciiString' && argument === 'm_commandSetStringOverride') return 'commandSetStringOverride';
  if (method === 'xferBool' && argument === 'm_modulesReady') return 'modulesReady';
  if (method === 'xferBool' && argument === 'm_isReceivingDifficultyBonus') return 'isReceivingDifficultyBonus';
  return null;
}

function mapTsObjectField(token: string): string | null {
  if (token.includes('xferVersion')) return 'version';
  if (token.includes('current.objectId')) return 'objectId';
  if (token.includes('xferSourceMatrix3DState')) return 'transformMatrix';
  if (token.includes('current.teamId')) return 'teamId';
  if (token.includes('current.producerId')) return 'producerId';
  if (token.includes('current.builderId')) return 'builderId';
  if (token.includes('current.drawableId')) return 'drawableId';
  if (token.includes('current.internalName')) return 'internalName';
  if (token.includes('current.statusBits')) return 'statusBits';
  if (token.includes('current.scriptStatus')) return 'scriptStatus';
  if (token.includes('current.privateStatus')) return 'privateStatus';
  if (token.includes('xferSourceGeometryInfoState')) return 'geometryInfo';
  if (token.includes('current.partitionLastLook')) return 'partitionLastLook';
  if (token.includes('current.partitionRevealAllLastLook')) return 'partitionRevealAllLastLook';
  if (token.includes('current.partitionLastShroud')) return 'partitionLastShroud';
  if (token.includes('visionSpiedBy.push')) return 'visionSpiedBy';
  if (token.includes('current.visionSpiedMask')) return 'visionSpiedMask';
  if (token.includes('current.visionRange')) return 'visionRange';
  if (token.includes('current.shroudClearingRange')) return 'shroudClearingRange';
  if (token.includes('current.shroudRange')) return 'shroudRange';
  if (token.includes('current.disabledMask')) return 'disabledMask';
  if (token.includes('current.singleUseCommandUsed')) return 'singleUseCommandUsed';
  if (token.includes('disabledTillFrame.push')) return 'disabledTillFrame';
  if (token.includes('current.specialModelConditionUntil')) return 'specialModelConditionUntil';
  if (token.includes('xferSourceExperienceTrackerState')) return 'experienceTracker';
  if (token.includes('current.containedById')) return 'containedById';
  if (token.includes('current.containedByFrame')) return 'containedByFrame';
  if (token.includes('current.constructionPercent')) return 'constructionPercent';
  if (token.includes('xferSourceUpgradeMaskState')) return 'completedUpgradeNames';
  if (token.includes('current.originalTeamName')) return 'originalTeamName';
  if (token.includes('current.indicatorColor')) return 'indicatorColor';
  if (token.includes('current.healthBoxOffset')) return 'healthBoxOffset';
  if (token.includes('xferByte') && !token.includes('triggerArea.')) return 'triggerAreaCount';
  if (token.includes('current.enteredOrExitedFrame')) return 'enteredOrExitedFrame';
  if (token.includes('xferSourceICoord3DState')) return 'ipos';
  if (token.includes('triggerArea.triggerName')) return 'triggerArea.name';
  if (token.includes('triggerArea.entered')) return 'triggerArea.entered';
  if (token.includes('triggerArea.exited')) return 'triggerArea.exited';
  if (token.includes('triggerArea.isInside')) return 'triggerArea.isInside';
  if (token.includes('current.layer')) return 'layer';
  if (token.includes('current.destinationLayer')) return 'destinationLayer';
  if (token.includes('current.isSelectable')) return 'isSelectable';
  if (token.includes('current.safeOcclusionFrame')) return 'safeOcclusionFrame';
  if (token.includes('current.formationId')) return 'formationId';
  if (token.includes('current.formationOffset')) return 'formationOffset';
  if (token.includes('xferSourceObjectModuleStates')) return 'modules.snapshot';
  if (token.includes('current.soleHealingBenefactorId')) return 'soleHealingBenefactorId';
  if (token.includes('current.soleHealingBenefactorExpirationFrame')) return 'soleHealingBenefactorExpirationFrame';
  if (token.includes('current.weaponSetFlags')) return 'weaponSetFlags';
  if (token.includes('current.weaponBonusCondition')) return 'weaponBonusCondition';
  if (token.includes('current.lastWeaponCondition')) return 'lastWeaponCondition';
  if (token.includes('xferSourceWeaponSetState')) return 'weaponSet';
  if (token.includes('current.specialPowerBits')) return 'specialPowerBits';
  if (token.includes('current.commandSetStringOverride')) return 'commandSetStringOverride';
  if (token.includes('current.modulesReady')) return 'modulesReady';
  if (token.includes('current.isReceivingDifficultyBonus')) return 'isReceivingDifficultyBonus';
  return null;
}

function mapCppGeometryInfoField(method: string, argument: string): string | null {
  if (method === 'xferVersion') return 'version';
  if (method === 'xferUser' && argument.startsWith('m_type')) return 'type';
  if (method === 'xferBool' && argument === 'm_isSmall') return 'isSmall';
  if (method === 'xferReal' && argument === 'm_height') return 'height';
  if (method === 'xferReal' && argument === 'm_majorRadius') return 'majorRadius';
  if (method === 'xferReal' && argument === 'm_minorRadius') return 'minorRadius';
  if (method === 'xferReal' && argument === 'm_boundingCircleRadius') return 'boundingCircleRadius';
  if (method === 'xferReal' && argument === 'm_boundingSphereRadius') return 'boundingSphereRadius';
  return null;
}

function mapCppSightingInfoField(method: string, argument: string): string | null {
  if (method === 'xferVersion') return 'version';
  if (method === 'xferCoord3D' && argument === 'm_where') return 'where';
  if (method === 'xferReal' && argument === 'm_howFar') return 'howFar';
  if (method === 'xferUser' && argument.startsWith('m_forWhom')) return 'forWhomMask';
  if (method === 'xferUnsignedInt' && argument === 'm_data') return 'data';
  return null;
}

function mapCppExperienceTrackerField(method: string, argument: string): string | null {
  if (method === 'xferVersion') return 'version';
  if (method === 'xferUser' && argument.startsWith('m_currentLevel')) return 'currentLevel';
  if (method === 'xferInt' && argument === 'm_currentExperience') return 'currentExperience';
  if (method === 'xferObjectID' && argument === 'm_experienceSink') return 'experienceSinkObjectId';
  if (method === 'xferReal' && argument === 'm_experienceScalar') return 'experienceScalar';
  return null;
}

function mapCppBitFlagsField(method: string, argument: string): string | null {
  if (method === 'xferVersion') return 'version';
  if (method === 'xferInt' && argument === 'c') return 'count';
  if (method === 'xferAsciiString' && (argument === 'bitNameA' || argument === 'string')) return 'entry.name';
  return null;
}

function mapTsBitFlagsField(token: string): string | null {
  if (token.includes('xferVersion')) return 'version';
  if (token.includes('xferInt')) return 'count';
  if (token.includes('xferAsciiString')) return 'entry.name';
  return null;
}

function mapCppWeaponSaveField(method: string, argument: string): string | null {
  if (method === 'xferVersion') return 'version';
  if (method === 'xferAsciiString' && argument === 'tmplName') return 'templateName';
  if (method === 'xferUser' && argument.startsWith('m_wslot')) return 'slot';
  if (method === 'xferUser' && argument.startsWith('m_status')) return 'status';
  if (method === 'xferUnsignedInt' && argument === 'm_ammoInClip') return 'ammoInClip';
  if (method === 'xferUnsignedInt' && argument === 'm_whenWeCanFireAgain') return 'whenWeCanFireAgain';
  if (method === 'xferUnsignedInt' && argument === 'm_whenPreAttackFinished') return 'whenPreAttackFinished';
  if (method === 'xferUnsignedInt' && argument === 'm_whenLastReloadStarted') return 'whenLastReloadStarted';
  if (method === 'xferUnsignedInt' && argument === 'm_lastFireFrame') return 'lastFireFrame';
  if (method === 'xferUnsignedInt' && argument === 'm_suspendFXFrame') return 'suspendFXFrame';
  if (method === 'xferObjectID' && argument === 'm_projectileStreamID') return 'projectileStreamObjectId';
  if (method === 'xferObjectID' && argument === 'laserIDUnused') return 'laserObjectIdUnused';
  if (method === 'xferInt' && argument === 'm_maxShotCount') return 'maxShotCount';
  if (method === 'xferInt' && argument === 'm_curBarrel') return 'currentBarrel';
  if (method === 'xferInt' && argument === 'm_numShotsForCurBarrel') return 'numShotsForCurrentBarrel';
  if (method === 'xferUnsignedShort' && argument === 'scatterCount') return 'scatterTargetsUnused.count';
  if (method === 'xferInt' && argument === 'intData') return 'scatterTargetsUnused.entry';
  if (method === 'xferBool' && argument === 'm_pitchLimited') return 'pitchLimited';
  if (method === 'xferBool' && argument === 'm_leechWeaponRangeActive') return 'leechWeaponRangeActive';
  return null;
}

function mapTsWeaponSaveField(token: string): string | null {
  if (token.includes('xferVersion')) return 'version';
  if (token.includes('current.templateName')) return 'templateName';
  if (token.includes('current.slot')) return 'slot';
  if (token.includes('current.status')) return 'status';
  if (token.includes('current.ammoInClip')) return 'ammoInClip';
  if (token.includes('current.whenWeCanFireAgain')) return 'whenWeCanFireAgain';
  if (token.includes('current.whenPreAttackFinished')) return 'whenPreAttackFinished';
  if (token.includes('current.whenLastReloadStarted')) return 'whenLastReloadStarted';
  if (token.includes('current.lastFireFrame')) return 'lastFireFrame';
  if (token.includes('current.suspendFXFrame')) return 'suspendFXFrame';
  if (token.includes('current.projectileStreamObjectId')) return 'projectileStreamObjectId';
  if (/xferObjectID\s*\(\s*0\s*\)/.test(token)) return 'laserObjectIdUnused';
  if (token.includes('current.maxShotCount')) return 'maxShotCount';
  if (token.includes('current.currentBarrel')) return 'currentBarrel';
  if (token.includes('current.numShotsForCurrentBarrel')) return 'numShotsForCurrentBarrel';
  if (token.includes('xferUnsignedShort')) return 'scatterTargetsUnused.count';
  if (token.includes('scatterTargetsInput[index]')) return 'scatterTargetsUnused.entry';
  if (token.includes('current.pitchLimited')) return 'pitchLimited';
  if (token.includes('current.leechWeaponRangeActive')) return 'leechWeaponRangeActive';
  return null;
}

function mapCppWeaponSetField(method: string, argument: string): string | null {
  if (method === 'xferVersion') return 'version';
  if (method === 'xferAsciiString' && argument === 'ttName') return 'templateName';
  if (method === 'xferBool' && argument === 'hasWeaponInSlot') return 'weapon.hasWeapon';
  if (method === 'xferSnapshot' && argument === 'm_weapons[i]') return 'weapon.snapshot';
  if (method === 'xferUser' && argument.startsWith('m_curWeapon,')) return 'currentWeapon';
  if (method === 'xferUser' && argument.startsWith('m_curWeaponLockedStatus')) return 'currentWeaponLockedStatus';
  if (method === 'xferUnsignedInt' && argument === 'm_filledWeaponSlotMask') return 'filledWeaponSlotMask';
  if (method === 'xferInt' && argument === 'm_totalAntiMask') return 'totalAntiMask';
  return null;
}

function mapTsWeaponSetField(token: string): string | null {
  if (token.includes('xferVersion')) return 'version';
  if (token.includes('current.templateName')) return 'templateName';
  if (token.includes('current.templateSetFlags')) return 'templateSetFlags';
  if (token.includes('sourceWeapon !== null')) return 'weapon.hasWeapon';
  if (token.includes('xferSourceWeaponState')) return 'weapon.snapshot';
  if (token.includes('current.currentWeaponLockedStatus')) return 'currentWeaponLockedStatus';
  if (token.includes('current.currentWeapon')) return 'currentWeapon';
  if (token.includes('current.filledWeaponSlotMask')) return 'filledWeaponSlotMask';
  if (token.includes('current.totalAntiMask')) return 'totalAntiMask';
  if (token.includes('current.totalDamageTypeMask')) return 'totalDamageTypeMask';
  return null;
}

function mapCppDrawableSnapshotField(argument: string): string | null {
  if (argument === 'm_selectionFlashEnvelope') return 'selectionFlashEnvelope.snapshot';
  if (argument === 'm_colorTintEnvelope') return 'colorTintEnvelope.snapshot';
  return null;
}

function mapCppDrawableField(method: string, argument: string): string | null {
  if (method === 'xferVersion') return 'version';
  if (method === 'xferDrawableID' && argument === 'id') return 'drawableId';
  if (method === 'xferBool' && argument === 'selFlash') return 'selectionFlashEnvelope.present';
  if (method === 'xferBool' && argument === 'colFlash') return 'colorTintEnvelope.present';
  if (method === 'xferUser' && argument.startsWith('decal,')) return 'terrainDecalType';
  if (method === 'xferReal' && argument === 'm_explicitOpacity') return 'explicitOpacity';
  if (method === 'xferReal' && argument === 'm_stealthOpacity') return 'stealthOpacity';
  if (method === 'xferReal' && argument === 'm_effectiveStealthOpacity') return 'effectiveStealthOpacity';
  if (method === 'xferReal' && argument === 'm_decalOpacityFadeTarget') return 'decalOpacityFadeTarget';
  if (method === 'xferReal' && argument === 'm_decalOpacityFadeRate') return 'decalOpacityFadeRate';
  if (method === 'xferReal' && argument === 'm_decalOpacity') return 'decalOpacity';
  if (method === 'xferObjectID' && argument === 'objectID') return 'objectId';
  if (method === 'xferUnsignedInt' && argument === 'm_status') return 'status';
  if (method === 'xferUnsignedInt' && argument === 'm_tintStatus') return 'tintStatus';
  if (method === 'xferUnsignedInt' && argument === 'm_prevTintStatus') return 'prevTintStatus';
  if (method === 'xferUser' && argument.startsWith('m_fadeMode')) return 'fadeMode';
  if (method === 'xferUnsignedInt' && argument === 'm_timeElapsedFade') return 'timeElapsedFade';
  if (method === 'xferUnsignedInt' && argument === 'm_timeToFade') return 'timeToFade';
  if (method === 'xferBool' && argument === 'hasLocoInfo') return 'locoInfo.present';
  if (method === 'xferReal' && argument.startsWith('m_locoInfo->')) return 'locoInfo.payload';
  if (method === 'xferUser' && argument.startsWith('m_stealthLook')) return 'stealthLook';
  if (method === 'xferInt' && argument === 'm_flashCount') return 'flashCount';
  if (method === 'xferColor' && argument === 'm_flashColor') return 'flashColor';
  if (method === 'xferBool' && argument === 'm_hidden') return 'hidden';
  if (method === 'xferBool' && argument === 'm_hiddenByStealth') return 'hiddenByStealth';
  if (method === 'xferReal' && argument === 'm_secondMaterialPassOpacity') return 'secondMaterialPassOpacity';
  if (method === 'xferBool' && argument === 'm_instanceIsIdentity') return 'instanceIsIdentity';
  if (method === 'xferUser' && argument.startsWith('m_instance')) return 'instanceMatrix';
  if (method === 'xferReal' && argument === 'm_instanceScale') return 'instanceScale';
  if (method === 'xferObjectID' && argument === 'm_drawableInfo.m_shroudStatusObjectID') {
    return 'drawableInfo.shroudStatusObjectId';
  }
  if (method === 'xferUnsignedInt' && argument === 'm_expirationDate') return 'expirationDate';
  if (method === 'xferUnsignedByte' && argument === 'iconCount') return 'icon.payload';
  if (method === 'xferBool' && argument === 'm_ambientSoundEnabled') return 'ambientSoundEnabled';
  if (method === 'xferBool' && argument === 'm_ambientSoundEnabledFromScript') return 'ambientSoundEnabledFromScript';
  if (method === 'xferBool' && argument === 'customized') return 'customAmbientSound.payload';
  return null;
}

function mapTsDrawableField(token: string): string | null {
  if (token.includes('xferVersion(7')) return 'version';
  if (token.includes('this.state.drawableId')) return 'drawableId';
  if (token.includes('xferModelConditionFlags')) return 'conditionState';
  if (token.includes('xferSourceMatrix3DRawBytes')) return 'transformMatrix3D';
  if (token.includes('selectionFlashEnvelopeBytes !== null')) return 'selectionFlashEnvelope.present';
  if (token.includes('xferUser(selectionFlashEnvelopeBytes')) return 'selectionFlashEnvelope.snapshot';
  if (token.includes('colorTintEnvelopeBytes !== null')) return 'colorTintEnvelope.present';
  if (token.includes('xferUser(colorTintEnvelopeBytes')) return 'colorTintEnvelope.snapshot';
  if (token.includes('fallback?.terrainDecalType')) return 'terrainDecalType';
  if (token.includes('.explicitOpacity')) return 'explicitOpacity';
  if (token.includes('.stealthOpacity')) return 'stealthOpacity';
  if (token.includes('.effectiveStealthOpacity')) return 'effectiveStealthOpacity';
  if (token.includes('.decalOpacityFadeTarget')) return 'decalOpacityFadeTarget';
  if (token.includes('.decalOpacityFadeRate')) return 'decalOpacityFadeRate';
  if (token.includes('.decalOpacity')) return 'decalOpacity';
  if (token.includes('this.state.objectId')) return 'objectId';
  if (token.includes('statusBits')) return 'status';
  if (token.includes('fallback?.tintStatus')) return 'tintStatus';
  if (token.includes('fallback?.prevTintStatus')) return 'prevTintStatus';
  if (token.includes('fallback?.fadeMode')) return 'fadeMode';
  if (token.includes('fallback?.timeElapsedFade')) return 'timeElapsedFade';
  if (token.includes('fallback?.timeToFade')) return 'timeToFade';
  if (token.includes('locoInfoBytes !== null')) return 'locoInfo.present';
  if (token.includes('xferUser(locoInfoBytes')) return 'locoInfo.payload';
  if (token.includes('NUM_DRAWABLE_MODULE_TYPES')) return 'drawableModules';
  if (token.includes('fallback?.stealthLook')) return 'stealthLook';
  if (token.includes('this.state.flashCount')) return 'flashCount';
  if (token.includes('this.state.flashColor')) return 'flashColor';
  if (token.includes('this.state.hiddenByStealth')) return 'hiddenByStealth';
  if (token.includes('this.state.hidden')) return 'hidden';
  if (token.includes('fallback?.secondMaterialPassOpacity')) return 'secondMaterialPassOpacity';
  if (token.includes('fallback?.instanceIsIdentity')) return 'instanceIsIdentity';
  if (token.includes('fallback?.instanceMatrixBytes')) return 'instanceMatrix';
  if (token.includes('fallback?.instanceScale')) return 'instanceScale';
  if (token.includes('this.state.shroudStatusObjectId')) return 'drawableInfo.shroudStatusObjectId';
  if (token.includes('fallback?.expirationDate')) return 'expirationDate';
  if (token.includes('fallback?.iconBytes')) return 'icon.payload';
  if (token.includes('this.state.ambientSoundEnabledFromScript')) return 'ambientSoundEnabledFromScript';
  if (token.includes('this.state.ambientSoundEnabled')) return 'ambientSoundEnabled';
  if (token.includes('fallback?.customAmbientSoundBytes')) return 'customAmbientSound.payload';
  return null;
}

function mapCppGameClientTocField(method: string, argument: string): string | null {
  if (method === 'xferVersion') return 'drawableTOC.version';
  if (method === 'xferUnsignedInt' && argument === 'tocCount') return 'drawableTOC.count';
  if (method === 'xferAsciiString' && (argument === 'tocEntry->name' || argument === 'templateName')) {
    return 'drawableTOC.entry.name';
  }
  if (method === 'xferUnsignedShort' && (argument === 'tocEntry->id' || argument === 'id')) {
    return 'drawableTOC.entry.id';
  }
  return null;
}

function mapCppGameClientField(method: string, argument: string): string | null {
  if (method === 'xferVersion') return 'version';
  if (method === 'xferUnsignedInt' && argument === 'm_frame') return 'frame';
  if (method === 'xferUnsignedShort' && argument === 'drawableCount') return 'drawable.count';
  if (method === 'xferUnsignedShort' && (argument === 'tocEntry->id' || argument === 'tocID')) return 'drawable.tocId';
  if (method === 'xferObjectID' && argument === 'objectID') return 'drawable.objectId';
  if (method === 'xferInt' && argument === 'numEntries') return 'briefing.count';
  if (method === 'xferAsciiString' && argument === 'tempStr') return 'briefing.line';
  return null;
}

function mapTsGameClientField(token: string): string | null {
  if (token.includes('SOURCE_GAME_CLIENT_SNAPSHOT_VERSION')) return 'version';
  if (token.includes('this.frame')) return 'frame';
  if (token.includes('SOURCE_GAME_CLIENT_TOC_SNAPSHOT_VERSION')) return 'drawableTOC.version';
  if (token.includes('tocEntries.size')) return 'drawableTOC.count';
  if (token.includes('xferAsciiString(templateName')) return 'drawableTOC.entry.name';
  if (token.includes('xferUnsignedShort(tocId')) return 'drawableTOC.entry.id';
  if (token.includes('this.drawables.length')) return 'drawable.count';
  if (token.includes('beginBlock')) return 'drawable.block.begin';
  if (token.includes('drawable.state.objectId')) return 'drawable.objectId';
  if (token.includes('new DrawableSnapshot')) return 'drawable.snapshot';
  if (token.includes('endBlock')) return 'drawable.block.end';
  if (token.includes('this.briefingLines.length')) return 'briefing.count';
  if (token.includes('briefingLine')) return 'briefing.line';
  return null;
}

function mapCppTerrainVisualField(method: string, argument: string): string | null {
  if (method === 'xferVersion') return 'w3d.version';
  if (method === 'xferBool' && argument === 'gridEnabled') return 'waterGrid.enabled';
  if (method === 'xferInt' && argument === 'xferLen') return 'heightMap.length';
  if (method === 'xferUser' && argument.startsWith('data,')) return 'heightMap.bytes';
  return null;
}

function mapTsTerrainVisualField(token: string): string | null {
  if (token.includes('targetW3dVersion')) return 'w3d.version';
  if (token.includes('SOURCE_TERRAIN_VISUAL_SNAPSHOT_VERSION')) return 'base.version';
  if (token.includes('this.waterGridSnapshot')) return 'waterGrid.enabled';
  if (token.includes('xferSourceWaterGridSnapshot')) return 'waterRenderObject.snapshot';
  if (token.includes('heightMapBytes.byteLength')) return 'heightMap.length';
  if (token.includes('xferUser(heightMapBytes')) return 'heightMap.bytes';
  if (token.includes('SOURCE_HEIGHT_MAP_RENDER_OBJECT_SNAPSHOT_VERSION')) return 'heightMapRenderObject.snapshot';
  return null;
}

function mapCppWaterRenderObjectField(method: string, argument: string): string | null {
  if (method === 'xferVersion') return 'version';
  if (method === 'xferInt' && argument === 'cellsX') return 'cellsX';
  if (method === 'xferInt' && argument === 'cellsY') return 'cellsY';
  if (method === 'xferReal' && argument === 'm_meshData[ i ].height') return 'mesh.height';
  if (method === 'xferReal' && argument === 'm_meshData[ i ].velocity') return 'mesh.velocity';
  if (method === 'xferUnsignedByte' && argument === 'm_meshData[ i ].status') return 'mesh.status';
  if (method === 'xferUnsignedByte' && argument === 'm_meshData[ i ].preferredHeight') return 'mesh.preferredHeight';
  return null;
}

function mapTsWaterRenderObjectField(token: string): string | null {
  if (token.includes('SOURCE_WATER_RENDER_OBJECT_SNAPSHOT_VERSION')) return 'version';
  if (token.includes('snapshot.cellsX')) return 'cellsX';
  if (token.includes('snapshot.cellsY')) return 'cellsY';
  if (token.includes('entry?.height')) return 'mesh.height';
  if (token.includes('entry?.velocity')) return 'mesh.velocity';
  if (token.includes('entry?.status')) return 'mesh.status';
  if (token.includes('entry?.preferredHeight')) return 'mesh.preferredHeight';
  return null;
}

function mapTsHeightMapRenderObjectField(token: string): string | null {
  if (token.includes('SOURCE_HEIGHT_MAP_RENDER_OBJECT_SNAPSHOT_VERSION')) return 'version';
  if (token.includes('SOURCE_W3D_TREE_BUFFER_SNAPSHOT_VERSION')) return 'treeBuffer.snapshot';
  if (token.includes('SOURCE_W3D_PROP_BUFFER_SNAPSHOT_VERSION')) return 'propBuffer.snapshot';
  return null;
}

function mapCppW3DTreeBufferField(method: string, argument: string): string | null {
  if (method === 'xferVersion') return 'version';
  if (method === 'xferInt' && argument === 'numTrees') return 'count';
  if (method === 'xferAsciiString' && argument === 'modelName') return 'tree.modelName';
  if (method === 'xferAsciiString' && argument === 'modelTexture') return 'tree.textureName';
  if (method === 'xferReal' && argument === 'tree.location.X') return 'tree.location.x';
  if (method === 'xferReal' && argument === 'tree.location.Y') return 'tree.location.y';
  if (method === 'xferReal' && argument === 'tree.location.Z') return 'tree.location.z';
  if (method === 'xferReal' && argument === 'tree.scale') return 'tree.scale';
  if (method === 'xferReal' && argument === 'tree.sin') return 'tree.sin';
  if (method === 'xferReal' && argument === 'tree.cos') return 'tree.cos';
  if (method === 'xferDrawableID' && argument === 'tree.drawableID') return 'tree.drawableId';
  if (method === 'xferReal' && argument === 'tree.m_angularVelocity') return 'tree.angularVelocity';
  if (method === 'xferReal' && argument === 'tree.m_angularAcceleration') return 'tree.angularAcceleration';
  if (method === 'xferCoord3D' && argument === 'tree.m_toppleDirection') return 'tree.toppleDirection';
  if (method === 'xferUser' && argument.startsWith('tree.m_toppleState')) return 'tree.toppleState';
  if (method === 'xferReal' && argument === 'tree.m_angularAccumulation') return 'tree.angularAccumulation';
  if (method === 'xferUnsignedInt' && argument === 'tree.m_options') return 'tree.options';
  if (method === 'xferUnsignedInt' && argument === 'tree.m_sinkFramesLeft') return 'tree.sinkFramesLeft';
  return null;
}

function mapTsW3DTreeBufferField(token: string): string | null {
  if (token.includes('entry.modelName')) return 'tree.modelName';
  if (token.includes('entry.textureName')) return 'tree.textureName';
  if (token.includes('entry.location.x')) return 'tree.location.x';
  if (token.includes('entry.location.y')) return 'tree.location.y';
  if (token.includes('entry.location.z')) return 'tree.location.z';
  if (token.includes('entry.scale')) return 'tree.scale';
  if (token.includes('entry.sinkFramesLeft')) return 'tree.sinkFramesLeft';
  if (token.includes('entry.sin')) return 'tree.sin';
  if (token.includes('entry.cos')) return 'tree.cos';
  if (token.includes('entry.drawableId')) return 'tree.drawableId';
  if (token.includes('entry.angularVelocity')) return 'tree.angularVelocity';
  if (token.includes('entry.angularAcceleration')) return 'tree.angularAcceleration';
  if (token.includes('entry.toppleDirection')) return 'tree.toppleDirection';
  if (token.includes('entry.toppleState')) return 'tree.toppleState';
  if (token.includes('entry.angularAccumulation')) return 'tree.angularAccumulation';
  if (token.includes('entry.options')) return 'tree.options';
  if (token.includes('xferSourceMatrix3DBytes')) return 'tree.matrix3D';
  return null;
}

function parseCppGhostObjectManagerBaseFields(body: string): string[] {
  const fields: string[] = [];
  const seen = new Set<string>();
  const fieldRegex = /xfer->(xfer\w+)\s*\(\s*([^)]*?)\s*\)/g;
  let match;
  while ((match = fieldRegex.exec(body)) !== null) {
    pushUniqueField(fields, seen, mapCppGhostObjectManagerBaseField(match[1]!, normalizeCppXferArgument(match[2]!)));
  }
  return fields;
}

function parseCppGhostObjectBaseFields(body: string): string[] {
  const fields: string[] = [];
  const seen = new Set<string>();
  const fieldRegex = /xfer->(xfer\w+)\s*\(\s*([^)]*?)\s*\)/g;
  let match;
  while ((match = fieldRegex.exec(body)) !== null) {
    pushUniqueField(fields, seen, mapCppGhostObjectBaseField(match[1]!, normalizeCppXferArgument(match[2]!)));
  }
  return fields;
}

function mapCppGhostObjectManagerBaseField(method: string, argument: string): string | null {
  if (method === 'xferVersion') return 'base.version';
  if (method === 'xferInt' && argument === 'm_localPlayer') return 'localPlayer';
  return null;
}

function mapCppGhostObjectManagerField(method: string, argument: string): string | null {
  if (method === 'xferVersion') return 'w3d.version';
  if (method === 'xferUnsignedShort' && argument === 'count') return 'ghostObject.count';
  if (method === 'xferObjectID' && argument === 'objectID') return 'ghostObject.managerParentObjectId';
  return null;
}

function mapTsGhostObjectManagerField(token: string): string | null {
  if (token.includes('SOURCE_W3D_GHOST_OBJECT_MANAGER_SNAPSHOT_VERSION')) return 'w3d.version';
  if (token.includes('SOURCE_GHOST_OBJECT_SNAPSHOT_VERSION')) return 'base.version';
  if (token.includes('this.localPlayerIndex')) return 'localPlayer';
  if (token.includes('this.ghostEntries.length')) return 'ghostObject.count';
  if (token.includes('entry.managerParentObjectId')) return 'ghostObject.managerParentObjectId';
  return null;
}

function mapCppGhostObjectBaseField(method: string, argument: string): string | null {
  if (method === 'xferVersion') return 'base.version';
  if (method === 'xferObjectID' && argument === 'parentObjectID') return 'parentObjectId';
  if (method === 'xferUser' && argument.startsWith('m_parentGeometryType')) return 'parentGeometryType';
  if (method === 'xferBool' && argument === 'm_parentGeometryIsSmall') return 'parentGeometryIsSmall';
  if (method === 'xferReal' && argument === 'm_parentGeometryMajorRadius') return 'parentGeometryMajorRadius';
  if (method === 'xferReal' && argument === 'm_parentGeometryminorRadius') return 'parentGeometryMinorRadius';
  if (method === 'xferReal' && argument === 'm_parentAngle') return 'parentAngle';
  if (method === 'xferCoord3D' && argument === 'm_parentPosition') return 'parentPosition';
  return null;
}

function mapCppGhostObjectField(method: string, argument: string): string | null {
  if (method === 'xferVersion') return 'w3d.version';
  if (method === 'xferObjectID' && argument === 'm_drawableInfo.m_shroudStatusObjectID') {
    return 'drawableInfo.shroudStatusObjectId';
  }
  if (method === 'xferInt' && argument === 'm_drawableInfo.m_flags') return 'drawableInfo.flags';
  if (method === 'xferDrawableID' && argument === 'drawableID') return 'drawableInfo.drawableId';
  if (method === 'xferUnsignedByte' && argument === 'snapshotCount') return 'snapshot.count';
  if (method === 'xferAsciiString' && argument === 'name') return 'snapshot.name';
  if (method === 'xferReal' && argument === 'scale') return 'snapshot.scale';
  if (method === 'xferUnsignedInt' && argument === 'color') return 'snapshot.color';
  if (method === 'xferUnsignedByte' && argument === 'shroudednessCount') return 'shroudedness.count';
  if (method === 'xferUnsignedByte' && argument === 'playerIndex') return 'shroudedness.playerIndex';
  if (method === 'xferUser' && argument.startsWith('status')) return 'shroudedness.previous';
  return null;
}

function mapTsGhostObjectField(token: string): string | null {
  if (token.includes('SOURCE_W3D_GHOST_OBJECT_MANAGER_SNAPSHOT_VERSION')) return 'w3d.version';
  if (token.includes('SOURCE_GHOST_OBJECT_SNAPSHOT_VERSION')) return 'base.version';
  if (token.includes('entry.parentObjectId')) return 'parentObjectId';
  if (token.includes('entry.parentGeometryType')) return 'parentGeometryType';
  if (token.includes('entry.parentGeometryIsSmall')) return 'parentGeometryIsSmall';
  if (token.includes('entry.parentGeometryMajorRadius')) return 'parentGeometryMajorRadius';
  if (token.includes('entry.parentGeometryMinorRadius')) return 'parentGeometryMinorRadius';
  if (token.includes('entry.parentAngle')) return 'parentAngle';
  if (token.includes('entry.parentPosition')) return 'parentPosition';
  if (token.includes('entry.drawableInfoShroudStatusObjectId')) return 'drawableInfo.shroudStatusObjectId';
  if (token.includes('entry.drawableInfoFlags')) return 'drawableInfo.flags';
  if (token.includes('entry.drawableId')) return 'drawableInfo.drawableId';
  if (token.includes('snapshots.length')) return 'snapshot.count';
  if (token.includes('snapshot.name')) return 'snapshot.name';
  if (token.includes('snapshot.scale')) return 'snapshot.scale';
  if (token.includes('snapshot.color')) return 'snapshot.color';
  if (token.includes('snapshotVersion')) return 'renderObject.snapshot';
  if (token.includes('shroudednessEntries.length')) return 'shroudedness.count';
  if (token.includes('shroudednessEntry.playerIndex')) return 'shroudedness.playerIndex';
  if (token.includes('previousShroudedness')) return 'shroudedness.previous';
  return null;
}

function mapCppW3DRenderObjectSnapshotField(method: string, argument: string): string | null {
  if (method === 'xferVersion') return 'version';
  if (method === 'xferUser' && argument.startsWith('transform,')) return 'transformMatrix';
  if (method === 'xferInt' && argument === 'subObjectCount') return 'subObject.count';
  if (method === 'xferAsciiString' && argument === 'subObjectName') return 'subObject.name';
  if (method === 'xferBool' && argument === 'visible') return 'subObject.visible';
  if (method === 'xferUser' && argument.startsWith('transform')) return 'subObject.transformMatrix';
  return null;
}

function mapTsW3DRenderObjectSnapshotField(token: string): string | null {
  if (token.includes('xferVersion')) return 'version';
  if (token.includes('transformMatrixBytes')) return 'transformMatrix';
  if (token.includes('snapshot.subObjects.length')) return 'subObject.count';
  if (token.includes('subObject.name')) return 'subObject.name';
  if (token.includes('subObject.visible')) return 'subObject.visible';
  if (token.includes('subObjectMatrixBytes')) return 'subObject.transformMatrix';
  return null;
}

function mapCppParticleSystemManagerField(method: string, argument: string): string | null {
  if (method === 'xferVersion') return 'version';
  if (method === 'xferUser' && argument.startsWith('m_uniqueSystemID')) return 'uniqueSystemId';
  if (method === 'xferUnsignedInt' && argument === 'systemCount') return 'system.count';
  if (method === 'xferAsciiString') return 'system.templateName';
  return null;
}

function mapTsParticleSystemManagerField(token: string): string | null {
  if (token.includes('SOURCE_PARTICLE_SYSTEM_SNAPSHOT_VERSION')) return 'version';
  if (token.includes('this.payload.nextId')) return 'uniqueSystemId';
  if (token.includes('this.payload.systems.length')) return 'system.count';
  if (token.includes('system.template.name')) return 'system.templateName';
  if (token.includes('xferVersion(1')) return 'system.snapshot';
  return null;
}

function mapCppParticleSystemInfoField(method: string, argument: string): string | null {
  if (method === 'xferVersion') return 'version';
  if (method === 'xferBool' && argument === 'm_isOneShot') return 'isOneShot';
  if (method === 'xferUser' && argument.startsWith('m_shaderType')) return 'shaderType';
  if (method === 'xferUser' && argument.startsWith('m_particleType')) return 'particleType';
  if (method === 'xferAsciiString' && argument === 'm_particleTypeName') return 'particleTypeName';
  if (method === 'xferUser' && argument.startsWith('m_angleZ')) return 'angle.z';
  if (method === 'xferUser' && argument.startsWith('m_angularRateZ')) return 'angularRate.z';
  if (method === 'xferUser' && argument.startsWith('m_angularDamping')) return 'angularDamping';
  if (method === 'xferUser' && argument.startsWith('m_velDamping')) return 'velocityDamping';
  if (method === 'xferUser' && argument.startsWith('m_lifetime')) return 'lifetime';
  if (method === 'xferUnsignedInt' && argument === 'm_systemLifetime') return 'systemLifetime';
  if (method === 'xferUser' && argument.startsWith('m_startSize,')) return 'startSize';
  if (method === 'xferUser' && argument.startsWith('m_startSizeRate')) return 'startSizeRate';
  if (method === 'xferUser' && argument.startsWith('m_sizeRate,')) return 'sizeRate';
  if (method === 'xferUser' && argument.startsWith('m_sizeRateDamping')) return 'sizeRateDamping';
  if (method === 'xferUser' && argument.startsWith('m_alphaKey[ i ].var')) return 'alphaKey.var';
  if (method === 'xferUnsignedInt' && argument === 'm_alphaKey[ i ].frame') return 'alphaKey.frame';
  if (method === 'xferRGBColor' && argument === 'm_colorKey[ i ].color') return 'colorKey.color';
  if (method === 'xferUnsignedInt' && argument === 'm_colorKey[ i ].frame') return 'colorKey.frame';
  if (method === 'xferUser' && argument.startsWith('m_colorScale')) return 'colorScale';
  if (method === 'xferUser' && argument.startsWith('m_burstDelay')) return 'burstDelay';
  if (method === 'xferUser' && argument.startsWith('m_burstCount')) return 'burstCount';
  if (method === 'xferUser' && argument.startsWith('m_initialDelay')) return 'initialDelay';
  if (method === 'xferCoord3D' && argument === 'm_driftVelocity') return 'driftVelocity';
  if (method === 'xferReal' && argument === 'm_gravity') return 'gravity';
  if (method === 'xferAsciiString' && argument === 'm_slaveSystemName') return 'slaveSystemName';
  if (method === 'xferCoord3D' && argument === 'm_slavePosOffset') return 'slavePosOffset';
  if (method === 'xferAsciiString' && argument === 'm_attachedSystemName') return 'attachedSystemName';
  if (method === 'xferUser' && argument.startsWith('m_emissionVelocityType')) return 'emissionVelocityType';
  if (method === 'xferUser' && argument.startsWith('m_priority')) return 'priority';
  if (method === 'xferUser' && argument.startsWith('m_emissionVelocity.ortho.x')) return 'velocity.ortho.x';
  if (method === 'xferUser' && argument.startsWith('m_emissionVelocity.ortho.y')) return 'velocity.ortho.y';
  if (method === 'xferUser' && argument.startsWith('m_emissionVelocity.ortho.z')) return 'velocity.ortho.z';
  if (method === 'xferUser' && argument.startsWith('m_emissionVelocity.spherical.speed')) return 'velocity.spherical.speed';
  if (method === 'xferUser' && argument.startsWith('m_emissionVelocity.hemispherical.speed')) {
    return 'velocity.hemispherical.speed';
  }
  if (method === 'xferUser' && argument.startsWith('m_emissionVelocity.cylindrical.radial')) {
    return 'velocity.cylindrical.radial';
  }
  if (method === 'xferUser' && argument.startsWith('m_emissionVelocity.cylindrical.normal')) {
    return 'velocity.cylindrical.normal';
  }
  if (method === 'xferUser' && argument.startsWith('m_emissionVelocity.outward.speed')) {
    return 'velocity.outward.speed';
  }
  if (method === 'xferUser' && argument.startsWith('m_emissionVelocity.outward.otherSpeed')) {
    return 'velocity.outward.otherSpeed';
  }
  if (method === 'xferUser' && argument.startsWith('m_emissionVolumeType')) return 'emissionVolumeType';
  if (method === 'xferCoord3D' && argument === 'm_emissionVolume.line.start') return 'volume.line.start';
  if (method === 'xferCoord3D' && argument === 'm_emissionVolume.line.end') return 'volume.line.end';
  if (method === 'xferCoord3D' && argument === 'm_emissionVolume.box.halfSize') return 'volume.box.halfSize';
  if (method === 'xferReal' && argument === 'm_emissionVolume.sphere.radius') return 'volume.sphere.radius';
  if (method === 'xferReal' && argument === 'm_emissionVolume.cylinder.radius') return 'volume.cylinder.radius';
  if (method === 'xferReal' && argument === 'm_emissionVolume.cylinder.length') return 'volume.cylinder.length';
  if (method === 'xferBool' && argument === 'm_isEmissionVolumeHollow') return 'isEmissionVolumeHollow';
  if (method === 'xferBool' && argument === 'm_isGroundAligned') return 'isGroundAligned';
  if (method === 'xferBool' && argument === 'm_isEmitAboveGroundOnly') return 'isEmitAboveGroundOnly';
  if (method === 'xferBool' && argument === 'm_isParticleUpTowardsEmitter') return 'isParticleUpTowardsEmitter';
  if (method === 'xferUser' && argument.startsWith('m_windMotion')) return 'windMotion';
  if (method === 'xferReal' && argument === 'm_windAngle') return 'windAngle';
  if (method === 'xferReal' && argument === 'm_windAngleChange') return 'windAngleChange';
  if (method === 'xferReal' && argument === 'm_windAngleChangeMin') return 'windAngleChangeMin';
  if (method === 'xferReal' && argument === 'm_windAngleChangeMax') return 'windAngleChangeMax';
  if (method === 'xferReal' && argument === 'm_windMotionStartAngle') return 'windMotionStartAngle';
  if (method === 'xferReal' && argument === 'm_windMotionStartAngleMin') return 'windMotionStartAngleMin';
  if (method === 'xferReal' && argument === 'm_windMotionStartAngleMax') return 'windMotionStartAngleMax';
  if (method === 'xferReal' && argument === 'm_windMotionEndAngle') return 'windMotionEndAngle';
  if (method === 'xferReal' && argument === 'm_windMotionEndAngleMin') return 'windMotionEndAngleMin';
  if (method === 'xferReal' && argument === 'm_windMotionEndAngleMax') return 'windMotionEndAngleMax';
  if (method === 'xferByte' && argument === 'm_windMotionMovingToEndAngle') return 'windMotionMovingToEnd';
  return null;
}

function mapTsParticleSystemInfoRandomVariableField(rawName: string): string | null {
  const fields: Record<string, string> = {
    angleX: 'angle.x',
    angleY: 'angle.y',
    angleZ: 'angle.z',
    angularRateX: 'angularRate.x',
    angularRateY: 'angularRate.y',
    angularRateZ: 'angularRate.z',
    angularDamping: 'angularDamping',
    velocityDamping: 'velocityDamping',
    lifetime: 'lifetime',
    startSize: 'startSize',
    startSizeRate: 'startSizeRate',
    sizeRate: 'sizeRate',
    sizeRateDamping: 'sizeRateDamping',
    alphaRange: 'alphaKey.var',
    colorScale: 'colorScale',
    burstDelay: 'burstDelay',
    burstCount: 'burstCount',
    initialDelay: 'initialDelay',
    velOrthoX: 'velocity.ortho.x',
    velOrthoY: 'velocity.ortho.y',
    velOrthoZ: 'velocity.ortho.z',
    velSpherical: 'velocity.spherical.speed',
    velHemispherical: 'velocity.hemispherical.speed',
    velCylindricalRadial: 'velocity.cylindrical.radial',
    velCylindricalNormal: 'velocity.cylindrical.normal',
    velOutward: 'velocity.outward.speed',
    velOutwardOther: 'velocity.outward.otherSpeed',
  };
  return fields[rawName] ?? null;
}

function mapTsParticleSystemInfoField(token: string): string | null {
  if (token.includes('xferVersion')) return 'version';
  if (token.includes('template.isOneShot')) return 'isOneShot';
  if (token.includes('template.shader')) return 'shaderType';
  if (token.includes('template.type')) return 'particleType';
  if (token.includes('template.particleName')) return 'particleTypeName';
  if (token.includes('template.systemLifetime')) return 'systemLifetime';
  if (token.includes('keyframe.r')) return 'colorKey.color';
  if (token.includes('template.driftVelocity')) return 'driftVelocity';
  if (token.includes('template.gravity')) return 'gravity';
  if (token.includes('template.slaveSystemName')) return 'slaveSystemName';
  if (token.includes('template.slavePosOffset')) return 'slavePosOffset';
  if (token.includes('template.attachedSystemName')) return 'attachedSystemName';
  if (token.includes('template.velocityType')) return 'emissionVelocityType';
  if (token.includes('template.priority')) return 'priority';
  if (token.includes('template.volumeType')) return 'emissionVolumeType';
  if (token.includes('volLineStart')) return 'volume.line.start';
  if (token.includes('volLineEnd')) return 'volume.line.end';
  if (token.includes('volBoxHalfSize')) return 'volume.box.halfSize';
  if (token.includes('volSphereRadius')) return 'volume.sphere.radius';
  if (token.includes('volCylinderRadius')) return 'volume.cylinder.radius';
  if (token.includes('volCylinderLength')) return 'volume.cylinder.length';
  if (token.includes('template.isHollow')) return 'isEmissionVolumeHollow';
  if (token.includes('template.isGroundAligned')) return 'isGroundAligned';
  if (token.includes('template.isEmitAboveGroundOnly')) return 'isEmitAboveGroundOnly';
  if (token.includes('template.isParticleUpTowardsEmitter')) return 'isParticleUpTowardsEmitter';
  if (token.includes('template.windMotion')) return 'windMotion';
  if (token.includes('runtime.windAngle')) return 'windAngle';
  if (token.includes('runtime.windAngleChange')) return 'windAngleChange';
  if (token.includes('template.windAngleChangeMin')) return 'windAngleChangeMin';
  if (token.includes('template.windAngleChangeMax')) return 'windAngleChangeMax';
  if (token.includes('template.windPingPongStartAngleMin')) return 'windMotionStartAngleMin';
  if (token.includes('template.windPingPongStartAngleMax')) return 'windMotionStartAngleMax';
  if (token.includes('template.windPingPongEndAngleMin')) return 'windMotionEndAngleMin';
  if (token.includes('template.windPingPongEndAngleMax')) return 'windMotionEndAngleMax';
  if (token.includes('runtime.windMotionMovingToEnd')) return 'windMotionMovingToEnd';
  return null;
}

function mapCppParticleSystemField(method: string, argument: string): string | null {
  if (method === 'xferVersion') return 'version';
  if (method === 'xferUser' && argument.startsWith('m_systemID')) return 'systemId';
  if (method === 'xferDrawableID' && argument === 'm_attachedToDrawableID') return 'attachedDrawableId';
  if (method === 'xferObjectID' && argument === 'm_attachedToObjectID') return 'attachedObjectId';
  if (method === 'xferBool' && argument === 'm_isLocalIdentity') return 'isLocalIdentity';
  if (method === 'xferBool' && argument === 'm_isIdentity') return 'isIdentity';
  if (method === 'xferUnsignedInt' && argument === 'm_burstDelayLeft') return 'burstDelayLeft';
  if (method === 'xferUnsignedInt' && argument === 'm_delayLeft') return 'delayLeft';
  if (method === 'xferUnsignedInt' && argument === 'm_startTimestamp') return 'startTimestamp';
  if (method === 'xferUnsignedInt' && argument === 'm_systemLifetimeLeft') return 'systemLifetimeLeft';
  if (method === 'xferUnsignedInt' && argument === 'm_personalityStore') return 'personalityStore';
  if (method === 'xferBool' && argument === 'm_isForever') return 'isForever';
  if (method === 'xferReal' && argument === 'm_accumulatedSizeBonus') return 'accumulatedSizeBonus';
  if (method === 'xferBool' && argument === 'm_isStopped') return 'isStopped';
  if (method === 'xferCoord3D' && argument === 'm_velCoeff') return 'velCoeff';
  if (method === 'xferReal' && argument === 'm_countCoeff') return 'countCoeff';
  if (method === 'xferReal' && argument === 'm_delayCoeff') return 'delayCoeff';
  if (method === 'xferReal' && argument === 'm_sizeCoeff') return 'sizeCoeff';
  if (method === 'xferCoord3D' && argument === 'm_pos') return 'pos';
  if (method === 'xferCoord3D' && argument === 'm_lastPos') return 'lastPos';
  if (method === 'xferBool' && argument === 'm_isFirstPos') return 'isFirstPos';
  if (method === 'xferUser' && argument.startsWith('m_slaveSystemID')) return 'slaveSystemId';
  if (method === 'xferUser' && argument.startsWith('m_masterSystemID')) return 'masterSystemId';
  if (method === 'xferUnsignedInt' && argument === 'particleCount') return 'particle.count';
  return null;
}

function mapTsParticleSystemField(token: string): string | null {
  if (token.includes('xferVersion(1')) return 'version';
  if (token.includes('xferTemplateInfo')) return 'info.snapshot';
  if (token.includes('system.id')) return 'systemId';
  if (token.includes('INVALID_DRAWABLE_ID')) return 'attachedDrawableId';
  if (token.includes('system.burstTimer')) return 'burstDelayLeft';
  if (token.includes('system.initialDelayRemaining')) return 'delayLeft';
  if (token.includes('system.systemAge')) return 'startTimestamp';
  if (token.includes('hydratedTemplate.systemLifetime')) return 'systemLifetimeLeft';
  if (token.includes('xferUnsignedInt(0')) return 'personalityStore';
  if (token.includes('hydratedTemplate.systemLifetime === 0')) return 'isForever';
  if (token.includes('xferReal(0')) return 'accumulatedSizeBonus';
  if (token.includes('!system.alive')) return 'isStopped';
  if (token.includes('xferCoord3D({ x: 0')) return 'velCoeff';
  if (token.includes('system.particleCount === 0')) return 'isFirstPos';
  if (token.includes('system.slaveSystemId')) return 'slaveSystemId';
  if (token.includes('system.masterSystemId')) return 'masterSystemId';
  if (token.includes('system.particleCount')) return 'particle.count';
  if (token.includes('xferParticleState')) return 'particle.snapshot';
  return null;
}

function mapCppParticleInfoField(method: string, argument: string): string | null {
  if (method === 'xferVersion') return 'version';
  if (method === 'xferCoord3D' && argument === 'm_vel') return 'velocity';
  if (method === 'xferCoord3D' && argument === 'm_pos') return 'position';
  if (method === 'xferCoord3D' && argument === 'm_emitterPos') return 'emitterPosition';
  if (method === 'xferReal' && argument === 'm_velDamping') return 'velocityDamping';
  if (method === 'xferReal' && argument === 'm_angleZ') return 'angleZ';
  if (method === 'xferReal' && argument === 'm_angularRateZ') return 'angularRateZ';
  if (method === 'xferUnsignedInt' && argument === 'm_lifetime') return 'lifetime';
  if (method === 'xferReal' && argument === 'm_size') return 'size';
  if (method === 'xferReal' && argument === 'm_sizeRate') return 'sizeRate';
  if (method === 'xferReal' && argument === 'm_sizeRateDamping') return 'sizeRateDamping';
  if (method === 'xferReal' && argument === 'm_alphaKey[ i ].value') return 'alphaKey.value';
  if (method === 'xferUnsignedInt' && argument === 'm_alphaKey[ i ].frame') return 'alphaKey.frame';
  if (method === 'xferRGBColor' && argument === 'm_colorKey[ i ].color') return 'colorKey.color';
  if (method === 'xferUnsignedInt' && argument === 'm_colorKey[ i ].frame') return 'colorKey.frame';
  if (method === 'xferReal' && argument === 'm_colorScale') return 'colorScale';
  if (method === 'xferBool' && argument === 'm_particleUpTowardsEmitter') return 'particleUpTowardsEmitter';
  if (method === 'xferReal' && argument === 'm_windRandomness') return 'windRandomness';
  return null;
}

function mapCppParticleField(method: string, argument: string): string | null {
  if (method === 'xferVersion') return 'version';
  if (method === 'xferUnsignedInt' && argument === 'm_personality') return 'personality';
  if (method === 'xferCoord3D' && argument === 'm_accel') return 'acceleration';
  if (method === 'xferCoord3D' && argument === 'm_lastPos') return 'lastPosition';
  if (method === 'xferUnsignedInt' && argument === 'm_lifetimeLeft') return 'lifetimeLeft';
  if (method === 'xferUnsignedInt' && argument === 'm_createTimestamp') return 'createTimestamp';
  if (method === 'xferReal' && argument === 'm_alpha') return 'alpha';
  if (method === 'xferReal' && argument === 'm_alphaRate') return 'alphaRate';
  if (method === 'xferInt' && argument === 'm_alphaTargetKey') return 'alphaTargetKey';
  if (method === 'xferRGBColor' && argument === 'm_color') return 'color';
  if (method === 'xferRGBColor' && argument === 'm_colorRate') return 'colorRate';
  if (method === 'xferInt' && argument === 'm_colorTargetKey') return 'colorTargetKey';
  if (method === 'xferDrawableID' && argument === 'drawableID') return 'drawableId';
  if (method === 'xferUser' && argument.startsWith('systemUnderControlID')) return 'systemUnderControlId';
  return null;
}

function mapTsParticleField(rawName: string): string | null {
  const fields: Record<string, string> = {
    velocity: 'info.velocity',
    position: 'info.position',
    emitterPosition: 'info.emitterPosition',
    velocityDamping: 'info.velocityDamping',
    angleX: 'info.angleX',
    angleY: 'info.angleY',
    angleZ: 'info.angleZ',
    angularRateX: 'info.angularRateX',
    angularRateY: 'info.angularRateY',
    angularRateZ: 'info.angularRateZ',
    lifetime: 'info.lifetime',
    size: 'info.size',
    sizeRate: 'info.sizeRate',
    sizeRateDamping: 'info.sizeRateDamping',
    colorScale: 'info.colorScale',
    particleUpTowardsEmitter: 'info.particleUpTowardsEmitter',
    windRandomness: 'info.windRandomness',
    personality: 'personality',
    acceleration: 'acceleration',
    lastPosition: 'lastPosition',
    lifetimeLeft: 'lifetimeLeft',
    createTimestamp: 'createTimestamp',
    alpha: 'alpha',
    alphaRate: 'alphaRate',
    alphaTargetKey: 'alphaTargetKey',
    colorTargetKey: 'colorTargetKey',
    systemUnderControlId: 'systemUnderControlId',
  };
  return fields[rawName] ?? null;
}

function mapCppSimpleModuleField(method: string, argument: string): string | null {
  if (method === 'xferVersion') return 'version';
  if (method === 'xferUnsignedInt' && argument === 'm_nextCallFrameAndPhase') return 'nextCallFrameAndPhase';
  if (method === 'xferReal' && argument === 'm_damageScalar') return 'damageScalar';
  if (method === 'xferBool' && argument === 'm_needToRunOnBuildComplete') return 'needToRunOnBuildComplete';
  if (method === 'xferBool' && argument === 'm_upgradeExecuted') return 'upgradeExecuted';
  if (method === 'xferUnsignedInt' && argument === 'm_availableOnFrame') return 'availableOnFrame';
  if (method === 'xferInt' && argument === 'm_pausedCount') return 'pausedCount';
  if (method === 'xferUnsignedInt' && argument === 'm_pausedOnFrame') return 'pausedOnFrame';
  if (method === 'xferReal' && argument === 'm_pausedPercent') return 'pausedPercent';
  if (method === 'xferUnsignedByte' && argument === 'recoilInfoCount') return 'weaponRecoil.count';
  if (method === 'xferUser' && argument.startsWith('weaponRecoilInfo.m_state')) return 'weaponRecoil.state';
  if (method === 'xferReal' && argument === 'weaponRecoilInfo.m_shift') return 'weaponRecoil.shift';
  if (method === 'xferReal' && argument === 'weaponRecoilInfo.m_recoilRate') return 'weaponRecoil.recoilRate';
  if (method === 'xferUnsignedByte' && argument === 'subObjectCount') return 'subObject.count';
  if (method === 'xferAsciiString' && argument === 'hideShowSubObjInfo.subObjName') return 'subObject.name';
  if (method === 'xferBool' && argument === 'hideShowSubObjInfo.hide') return 'subObject.hide';
  if (method === 'xferBool' && argument === 'present') return 'animation.present';
  if (method === 'xferInt' && argument === 'mode') return 'animation.mode';
  if (method === 'xferReal' && argument === 'percent') return 'animation.percent';
  if (method === 'xferBool' && argument === 'm_dependencyCleared') return 'dependencyCleared';
  if (method === 'xferAsciiString' && argument === 'm_modelName') return 'modelName';
  if (method === 'xferColor' && argument === 'm_modelColor') return 'modelColor';
  if (method === 'xferAsciiString' && argument === 'm_animInitial') return 'animInitial';
  if (method === 'xferAsciiString' && argument === 'm_animFlying') return 'animFlying';
  if (method === 'xferAsciiString' && argument === 'm_animFinal') return 'animFinal';
  if (method === 'xferInt' && argument === 'm_state') return 'state';
  if (method === 'xferInt' && argument === 'm_frames') return 'frames';
  if (method === 'xferBool' && argument === 'm_finalStop') return 'finalStop';
  if (method === 'xferReal' && argument === 'm_curLen') return 'curLen';
  if (method === 'xferReal' && argument === 'm_maxLen') return 'maxLen';
  if (method === 'xferReal' && argument === 'm_width') return 'width';
  if (method === 'xferRGBColor' && argument === 'm_color') return 'color';
  if (method === 'xferReal' && argument === 'm_curSpeed') return 'curSpeed';
  if (method === 'xferReal' && argument === 'm_maxSpeed') return 'maxSpeed';
  if (method === 'xferReal' && argument === 'm_accel') return 'accel';
  if (method === 'xferReal' && argument === 'm_wobbleLen') return 'wobbleLen';
  if (method === 'xferReal' && argument === 'm_wobbleAmp') return 'wobbleAmp';
  if (method === 'xferReal' && argument === 'm_wobbleRate') return 'wobbleRate';
  if (method === 'xferReal' && argument === 'm_curWobblePhase') return 'curWobblePhase';
  if (method === 'xferReal' && argument === 'm_curZOffset') return 'curZOffset';
  if (method === 'xferReal' && argument === 'm_curValue') return 'curValue';
  if (method === 'xferReal' && argument === 'm_curAngle') return 'curAngle';
  if (method === 'xferReal' && argument === 'm_curDelta') return 'curDelta';
  if (method === 'xferReal' && argument === 'm_curAngleLimit') return 'curAngleLimit';
  if (method === 'xferReal' && argument === 'm_leanAngle') return 'leanAngle';
  if (method === 'xferShort' && argument === 'm_curVersion') return 'curVersion';
  if (method === 'xferBool' && argument === 'm_swaying') return 'swaying';
  if (method === 'xferCoord3D' && argument === 'm_startPos') return 'startPos';
  if (method === 'xferCoord3D' && argument === 'm_endPos') return 'endPos';
  if (method === 'xferBool' && argument === 'm_dirty') return 'dirty';
  if (method === 'xferUser' && argument.startsWith('m_particleSystemID')) return 'particleSystemId';
  if (method === 'xferUser' && argument.startsWith('m_targetParticleSystemID')) return 'targetParticleSystemId';
  if (method === 'xferBool' && argument === 'm_widening') return 'widening';
  if (method === 'xferBool' && argument === 'm_decaying') return 'decaying';
  if (method === 'xferUnsignedInt' && argument === 'm_widenStartFrame') return 'widenStartFrame';
  if (method === 'xferUnsignedInt' && argument === 'm_widenFinishFrame') return 'widenFinishFrame';
  if (method === 'xferReal' && argument === 'm_currentWidthScalar') return 'currentWidthScalar';
  if (method === 'xferUnsignedInt' && argument === 'm_decayStartFrame') return 'decayStartFrame';
  if (method === 'xferUnsignedInt' && argument === 'm_decayFinishFrame') return 'decayFinishFrame';
  if (method === 'xferDrawableID' && argument === 'm_parentID') return 'parentDrawableId';
  if (method === 'xferDrawableID' && argument === 'm_targetID') return 'targetDrawableId';
  if (method === 'xferAsciiString' && argument === 'm_parentBoneName') return 'parentBoneName';
  if (method === 'xferUnsignedInt' && argument === 'm_lastRadarPulse') return 'lastRadarPulse';
  if (method === 'xferBool' && argument === 'm_extended') return 'extended';
  if (method === 'xferUnsignedInt' && argument === 'm_nextCreationFrame') return 'nextCreationFrame';
  if (method === 'xferUnsignedInt' && argument === 'm_timerStartedFrame') return 'timerStartedFrame';
  if (method === 'xferBool' && argument === 'm_isFactionNeutral') return 'factionNeutral';
  if (method === 'xferInt' && argument === 'm_currentPlayerColor') return 'currentPlayerColor';
  if (method === 'xferUnsignedInt' && argument === 'm_enemyScanDelay') return 'enemyScanDelay';
  if (method === 'xferBool' && argument === 'm_enemyNear') return 'enemyNear';
  if (method === 'xferBool' && argument === 'm_inHorde') return 'inHorde';
  if (method === 'xferBool' && argument === 'm_hasFlag') return 'hasFlag';
  if (method === 'xferInt' && argument === 'm_proneFrames') return 'proneFrames';
  if (method === 'xferBool' && argument === 'm_valid') return 'valid';
  if (method === 'xferUnsignedInt' && argument === 'm_consecutiveShots') return 'consecutiveShots';
  if (method === 'xferUnsignedInt' && argument === 'm_startFrame') return 'startFrame';
  if (method === 'xferInt' && argument === 'm_nextScanFrames') return 'nextScanFrames';
  if (method === 'xferBool' && argument === 'm_killWhenNoLongerAttacking') return 'killWhenNoLongerAttacking';
  if (method === 'xferUnsignedInt' && argument === 'm_dieFrame') return 'dieFrame';
  if (method === 'xferBool' && argument === 'm_hasDied') return 'hasDied';
  if (method === 'xferBool' && argument === 'm_particlesDestroyed') return 'particlesDestroyed';
  if (method === 'xferCoord3D' && argument === 'm_lastPosition') return 'lastPosition';
  if (method === 'xferUnsignedInt' && argument === 'm_earliestDeathFrame') return 'earliestDeathFrame';
  if (method === 'xferObjectID' && argument === 'm_targetID') return 'targetId';
  if (method === 'xferUnsignedInt' && argument === 'm_nextPingFrame') return 'nextPingFrame';
  if (method === 'xferObjectID' && argument === 'm_bestTargetID') return 'bestTargetId';
  if (method === 'xferBool' && argument === 'm_inRange') return 'inRange';
  if (method === 'xferInt' && argument === 'm_nextShotAvailableInFrames') return 'nextShotAvailableInFrames';
  if (method === 'xferCoord3D' && argument === 'm_pos') return 'position';
  if (method === 'xferReal' && argument === 'm_moveRange') return 'moveRange';
  if (method === 'xferBool' && argument === 'm_detonated') return 'detonated';
  if (method === 'xferAsciiString' && argument === 'm_commandButtonName') return 'commandButtonName';
  if (method === 'xferUnsignedInt' && argument === 'm_depositOnFrame') return 'depositOnFrame';
  if (method === 'xferBool' && argument === 'm_awardInitialCaptureBonus') return 'awardInitialCaptureBonus';
  if (method === 'xferBool' && argument === 'm_initialized') return 'initialized';
  if (method === 'xferInt' && argument === 'm_stateCountDown') return 'stateCountdown';
  if (method === 'xferInt' && argument === 'm_totalFrames') return 'totalFrames';
  if (method === 'xferUnsignedInt' && argument === 'm_growStartDeadline') return 'growStartDeadline';
  if (method === 'xferUnsignedInt' && argument === 'm_sustainDeadline') return 'sustainDeadline';
  if (method === 'xferUnsignedInt' && argument === 'm_shrinkStartDeadline') return 'shrinkStartDeadline';
  if (method === 'xferUnsignedInt' && argument === 'm_doneForeverFrame') return 'doneForeverFrame';
  if (method === 'xferUnsignedInt' && argument === 'm_changeIntervalCountdown') return 'changeIntervalCountdown';
  if (method === 'xferBool' && argument === 'm_decalsCreated') return 'decalsCreated';
  if (method === 'xferReal' && argument === 'm_visionChangePerInterval') return 'visionChangePerInterval';
  if (method === 'xferReal' && argument === 'm_nativeClearingRange') return 'nativeClearingRange';
  if (method === 'xferReal' && argument === 'm_currentClearingRange') return 'currentClearingRange';
  if (method === 'xferUnsignedInt' && argument === 'm_stealthAllowedFrame') return 'stealthAllowedFrame';
  if (method === 'xferUnsignedInt' && argument === 'm_detectionExpiresFrame') return 'detectionExpiresFrame';
  if (method === 'xferBool' && argument === 'm_enabled') return 'enabled';
  if (method === 'xferReal' && argument === 'm_pulsePhaseRate') return 'pulsePhaseRate';
  if (method === 'xferReal' && argument === 'm_pulsePhase') return 'pulsePhase';
  if (method === 'xferInt' && argument === 'm_disguiseAsPlayerIndex') return 'disguiseAsPlayerIndex';
  if (method === 'xferAsciiString' && argument === 'name') return 'disguiseTemplateName';
  if (method === 'xferUnsignedInt' && argument === 'm_disguiseTransitionFrames') return 'disguiseTransitionFrames';
  if (method === 'xferBool' && argument === 'm_disguiseHalfpointReached') return 'disguiseHalfpointReached';
  if (method === 'xferBool' && argument === 'm_transitioningToDisguise') return 'transitioningToDisguise';
  if (method === 'xferBool' && argument === 'm_disguised') return 'disguised';
  if (method === 'xferUnsignedInt' && argument === 'm_framesGranted') return 'framesGranted';
  if (method === 'xferUnsignedInt' && argument === 'm_activeFrame') return 'activeFrame';
  if (method === 'xferBool' && argument === 'm_needDisable') return 'needDisable';
  if (method === 'xferUser' && argument.startsWith('m_shapePoints')) return 'shapePoints';
  if (method === 'xferUser' && argument.startsWith('m_transformedShapePoints')) return 'transformedShapePoints';
  if (method === 'xferUser' && argument.startsWith('m_shapeEffects')) return 'shapeEffects';
  if (method === 'xferInt' && argument === 'm_shapePointCount') return 'shapePointCount';
  if (method === 'xferUnsignedInt' && argument === 'm_splashSoundFrame') return 'splashSoundFrame';
  if (method === 'xferCoord3D' && argument === 'm_finalDestination') return 'finalDestination';
  if (method === 'xferUser' && argument.startsWith('m_projectileIDs')) return 'projectileIds';
  if (method === 'xferInt' && argument === 'm_nextFreeIndex') return 'nextFreeIndex';
  if (method === 'xferInt' && argument === 'm_firstValidIndex') return 'firstValidIndex';
  if (method === 'xferObjectID' && argument === 'm_owningObject') return 'owningObject';
  if (method === 'xferObjectID' && argument === 'm_targetObject') return 'targetObject';
  if (method === 'xferCoord3D' && argument === 'm_targetPosition') return 'targetPosition';
  if (method === 'xferUnsignedShort' && argument === 'particleSystemCount') return 'particleSystem.count';
  if (method === 'xferUser' && argument.startsWith('systemID')) return 'particleSystem.id';
  if (method === 'xferUser' && argument.startsWith('m_nextFXFrame')) return 'nextFxFrame';
  if (method === 'xferUser' && argument.startsWith('m_nextOCLFrame')) return 'nextOclFrame';
  if (method === 'xferUser' && argument.startsWith('m_nextParticleSystemFrame')) return 'nextParticleSystemFrame';
  if (method === 'xferUser' && argument.startsWith('m_FXBonePositions')) return 'fxBonePositions';
  if (method === 'xferUser' && argument.startsWith('m_OCLBonePositions')) return 'oclBonePositions';
  if (method === 'xferUser' && argument.startsWith('m_PSBonePositions')) return 'particleSystemBonePositions';
  if (method === 'xferUser' && argument.startsWith('m_curBodyState')) return 'currentBodyState';
  if (method === 'xferUser' && argument.startsWith('m_bonesResolved')) return 'bonesResolved';
  if (method === 'xferBool' && argument === 'm_active') return 'active';
  if (method === 'xferUser' && argument.startsWith('m_status')) return 'status';
  if (method === 'xferUnsignedInt' && argument === 'm_aflameEndFrame') return 'aflameEndFrame';
  if (method === 'xferUnsignedInt' && argument === 'm_burnedEndFrame') return 'burnedEndFrame';
  if (method === 'xferUnsignedInt' && argument === 'm_damageEndFrame') return 'damageEndFrame';
  if (method === 'xferReal' && argument === 'm_flameDamageLimit') return 'flameDamageLimit';
  if (method === 'xferUnsignedInt' && argument === 'm_lastFlameDamageDealt') return 'lastFlameDamageDealt';
  if (method === 'xferUnsignedInt' && argument === 'm_startingDelayCountdown') return 'startingDelayCountdown';
  if (method === 'xferUnsignedInt' && argument === 'm_timeActive') return 'timeActive';
  if (method === 'xferBool' && argument === 'm_started') return 'started';
  if (method === 'xferBool' && argument === 'm_finished') return 'finished';
  if (method === 'xferBool' && argument === 'm_reverseAtTransitionTime') return 'reverseAtTransitionTime';
  if (method === 'xferUser' && argument.startsWith('m_direction')) return 'direction';
  if (method === 'xferBool' && argument === 'm_switchedDirections') return 'switchedDirections';
  if (method === 'xferReal' && argument === 'm_initialHeight') return 'initialHeight';
  if (method === 'xferReal' && argument === 'm_initialMajorRadius') return 'initialMajorRadius';
  if (method === 'xferReal' && argument === 'm_initialMinorRadius') return 'initialMinorRadius';
  if (method === 'xferReal' && argument === 'm_finalHeight') return 'finalHeight';
  if (method === 'xferReal' && argument === 'm_finalMajorRadius') return 'finalMajorRadius';
  if (method === 'xferReal' && argument === 'm_finalMinorRadius') return 'finalMinorRadius';
  if (method === 'xferUser' && argument.startsWith('m_myParticleSystemID')) return 'particleSystemIds';
  if (method === 'xferBool' && argument === 'm_effectsFired') return 'effectsFired';
  if (method === 'xferBool' && argument === 'm_scorchPlaced') return 'scorchPlaced';
  if (method === 'xferUnsignedInt' && argument === 'm_lastDamageFrame') return 'lastDamageFrame';
  if (method === 'xferBool' && argument === 'm_didMoveToBase') return 'didMoveToBase';
  if (method === 'xferUnsignedInt' && argument === 'm_extendDoneFrame') return 'extendDoneFrame';
  if (method === 'xferBool' && argument === 'm_extendComplete') return 'extendComplete';
  if (method === 'xferBool' && argument === 'm_radarActive') return 'radarActive';
  if (method === 'xferBool' && argument === 'm_allyNear') return 'allyNear';
  if (method === 'xferReal' && argument === 'm_maxMinorRadius') return 'maxMinorRadius';
  if (method === 'xferCoord3D' && argument === 'm_ejectPos') return 'ejectPosition';
  if (method === 'xferBool' && argument === 'm_update') return 'update';
  if (method === 'xferBool' && argument === 'm_isInVehicle') return 'isInVehicle';
  if (method === 'xferBool' && argument === 'm_wasTargetAirborne') return 'wasTargetAirborne';
  if (method === 'xferUser' && argument.startsWith('m_doorState')) return 'doorState';
  if (method === 'xferUser' && argument.startsWith('m_timeoutState')) return 'timeoutState';
  if (method === 'xferUnsignedInt' && argument === 'm_timeoutFrame') return 'timeoutFrame';
  if (method === 'xferUnsignedInt' && argument === 'm_collapseFrame') return 'collapseFrame';
  if (method === 'xferUnsignedInt' && argument === 'm_burstFrame') return 'burstFrame';
  if (method === 'xferUser' && argument.startsWith('m_collapseState')) return 'collapseState';
  if (method === 'xferReal' && argument === 'm_collapseVelocity') return 'collapseVelocity';
  if (method === 'xferReal' && argument === 'm_currentHeight') return 'currentHeight';
  if (method === 'xferInt' && argument === 'm_boxesStored') return 'boxesStored';
  if (method === 'xferObjectID' && argument === 'm_lastRepair') return 'lastRepair';
  if (method === 'xferReal' && argument === 'm_healthToAddPerFrame') return 'healthToAddPerFrame';
  if (method === 'xferObjectID' && argument === 'm_dockingObjectID') return 'dockingObjectId';
  if (method === 'xferReal' && argument === 'm_pullInsideDistancePerFrame') return 'pullInsideDistancePerFrame';
  if (method === 'xferObjectID' && argument === 'm_unloadingObjectID') return 'unloadingObjectId';
  if (method === 'xferReal' && argument === 'm_pushOutsideDistancePerFrame') return 'pushOutsideDistancePerFrame';
  if (method === 'xferInt' && argument === 'm_unloadCount') return 'unloadCount';
  if (method === 'xferCoord3D' && argument === 'm_rallyPoint') return 'rallyPoint';
  if (method === 'xferBool' && argument === 'm_rallyPointExists') return 'rallyPointExists';
  if (method === 'xferUnsignedInt' && argument === 'm_currentDelay') return 'currentDelay';
  if (method === 'xferReal' && argument === 'm_creationClearDistance') return 'creationClearDistance';
  if (method === 'xferUnsignedInt' && argument === 'm_currentBurstCount') return 'currentBurstCount';
  if (method === 'xferUser' && argument.startsWith('m_spawnPointOccupier')) return 'occupierIds';
  if (method === 'xferUnsignedShort' && argument === 'productionCount') return 'queue.count';
  if (method === 'xferUser' && argument.startsWith('production->m_type')) return 'queue.entry.type';
  if (method === 'xferAsciiString' && argument === 'name') return 'queue.entry.name';
  if (method === 'xferUser' && argument.startsWith('production->m_productionID')) return 'queue.entry.productionId';
  if (method === 'xferReal' && argument === 'production->m_percentComplete') return 'queue.entry.percentComplete';
  if (method === 'xferInt' && argument === 'production->m_framesUnderConstruction') {
    return 'queue.entry.framesUnderConstruction';
  }
  if (method === 'xferInt' && argument === 'production->m_productionQuantityTotal') {
    return 'queue.entry.productionQuantityTotal';
  }
  if (method === 'xferInt' && argument === 'production->m_productionQuantityProduced') {
    return 'queue.entry.productionQuantityProduced';
  }
  if (method === 'xferInt' && argument.includes('production->m_exitDoor')) return 'queue.entry.exitDoor';
  if (method === 'xferUser' && argument.startsWith('m_uniqueID')) return 'uniqueId';
  if (method === 'xferUnsignedInt' && argument === 'm_productionCount') return 'productionCount';
  if (method === 'xferUnsignedInt' && argument === 'm_constructionCompleteFrame') {
    return 'constructionCompleteFrame';
  }
  if (method === 'xferUser' && argument.startsWith('m_doors')) return 'doorInfo';
  if (method === 'xferBool' && argument === 'm_flagsDirty') return 'flagsDirty';
  if (method === 'xferSnapshot' && argument === 'm_weapon') return 'weapon.snapshot';
  if (method === 'xferUnsignedInt' && argument === 'm_initialDelayFrame') return 'initialDelayFrame';
  if (method === 'xferUser' && argument.startsWith('m_currentPlan')) return 'currentPlan';
  if (method === 'xferUser' && argument.startsWith('m_desiredPlan')) return 'desiredPlan';
  if (method === 'xferUser' && argument.startsWith('m_planAffectingArmy')) return 'planAffectingArmy';
  if (method === 'xferUnsignedInt' && argument === 'm_nextReadyFrame') return 'nextReadyFrame';
  if (method === 'xferBool' && argument === 'm_invalidSettings') return 'invalidSettings';
  if (method === 'xferBool' && argument === 'm_centeringTurret') return 'centeringTurret';
  if (method === 'xferReal' && argument === 'm_bonuses->m_armorScalar') return 'armorScalar';
  if (method === 'xferInt' && argument === 'm_bonuses->m_bombardment') return 'bombardment';
  if (method === 'xferInt' && argument === 'm_bonuses->m_searchAndDestroy') return 'searchAndDestroy';
  if (method === 'xferInt' && argument === 'm_bonuses->m_holdTheLine') return 'holdTheLine';
  if (method === 'xferReal' && argument === 'm_bonuses->m_sightRangeScalar') return 'sightRangeScalar';
  if (method === 'xferObjectID' && argument === 'm_visionObjectID') return 'visionObjectId';
  if (method === 'xferObjectID' && argument === 'm_slaver') return 'slaver';
  if (method === 'xferCoord3D' && argument === 'm_guardPointOffset') return 'guardPointOffset';
  if (method === 'xferInt' && argument === 'm_framesToWait') return 'framesToWait';
  if (method === 'xferUser' && argument.startsWith('m_repairState')) return 'repairState';
  if (method === 'xferBool' && argument === 'm_repairing') return 'repairing';
  if (method === 'xferUser' && argument.startsWith('m_mobState')) return 'mobState';
  if (method === 'xferRGBColor' && argument === 'm_personalColor') return 'personalColor';
  if (method === 'xferObjectID' && argument === 'm_primaryVictimID') return 'primaryVictimId';
  if (method === 'xferReal' && argument === 'm_squirrellinessRatio') return 'squirrellinessRatio';
  if (method === 'xferBool' && argument === 'm_isSelfTasking') return 'isSelfTasking';
  if (method === 'xferUnsignedInt' && argument === 'm_catchUpCrisisTimer') return 'catchUpCrisisTimer';
  if (method === 'xferCoord3D' && argument === 'm_initialTargetPosition') return 'initialTargetPosition';
  if (method === 'xferCoord3D' && argument === 'm_overrideTargetDestination') {
    return 'overrideTargetDestination';
  }
  if (method === 'xferCoord3D' && argument === 'm_satellitePosition') return 'satellitePosition';
  if (method === 'xferUnsignedInt' && argument === 'm_orbitEscapeFrame') return 'orbitEscapeFrame';
  if (method === 'xferCoord3D' && argument === 'm_gattlingTargetPosition') return 'gattlingTargetPosition';
  if (method === 'xferCoord3D' && argument === 'm_positionToShootAt') return 'positionToShootAt';
  if (method === 'xferUnsignedInt' && argument === 'm_okToFireHowitzerCounter') {
    return 'okToFireHowitzerCounter';
  }
  if (method === 'xferObjectID' && argument === 'm_gattlingID') return 'gattlingId';
  if (method === 'xferUnsignedInt' && argument === 'm_prepFrames') return 'prepFrames';
  if (method === 'xferUnsignedInt' && argument === 'm_animFrames') return 'animFrames';
  if (method === 'xferInt' && argument === 'm_locationCount') return 'locationCount';
  if (method === 'xferSTLObjectIDList' && argument === 'm_specialObjectIDList') return 'specialObjectIdList';
  if (method === 'xferUnsignedInt' && argument === 'm_specialObjectEntries') return 'specialObjectEntries';
  if (method === 'xferBool' && argument === 'm_noTargetCommand') return 'noTargetCommand';
  if (method === 'xferUser' && argument.startsWith('m_packingState')) return 'packingState';
  if (method === 'xferBool' && argument === 'm_facingInitiated') return 'facingInitiated';
  if (method === 'xferBool' && argument === 'm_facingComplete') return 'facingComplete';
  if (method === 'xferBool' && argument === 'm_withinStartAbilityRange') return 'withinStartAbilityRange';
  if (method === 'xferBool' && argument === 'm_doDisableFXParticles') return 'doDisableFxParticles';
  if (method === 'xferReal' && argument === 'm_captureFlashPhase') return 'captureFlashPhase';
  if (method === 'xferUser' && argument.startsWith('m_laserStatus')) return 'laserStatus';
  if (method === 'xferUnsignedInt' && argument === 'm_frames') return 'frames';
  if (method === 'xferUser' && argument.startsWith('m_outerSystemIDs')) return 'outerSystemIds';
  if (method === 'xferUser' && argument.startsWith('m_laserBeamIDs')) return 'laserBeamIds';
  if (method === 'xferDrawableID' && argument === 'm_groundToOrbitBeamID') return 'groundToOrbitBeamId';
  if (method === 'xferDrawableID' && argument === 'm_orbitToTargetBeamID') return 'orbitToTargetBeamId';
  if (method === 'xferUser' && argument.startsWith('m_connectorSystemID')) return 'connectorSystemId';
  if (method === 'xferUser' && argument.startsWith('m_laserBaseSystemID')) return 'laserBaseSystemId';
  if (method === 'xferUser' && argument.startsWith('m_outerNodePositions')) return 'outerNodePositions';
  if (method === 'xferUser' && argument.startsWith('m_outerNodeOrientations')) return 'outerNodeOrientations';
  if (method === 'xferCoord3D' && argument === 'm_connectorNodePosition') return 'connectorNodePosition';
  if (method === 'xferCoord3D' && argument === 'm_laserOriginPosition') return 'laserOriginPosition';
  if (method === 'xferBool' && argument === 'm_upBonesCached') return 'upBonesCached';
  if (method === 'xferBool' && argument === 'm_defaultInfoCached') return 'defaultInfoCached';
  if (method === 'xferCoord3D' && argument === 'm_currentTargetPosition') return 'currentTargetPosition';
  if (method === 'xferUnsignedInt' && argument === 'm_scorchMarksMade') return 'scorchMarksMade';
  if (method === 'xferUnsignedInt' && argument === 'm_nextScorchMarkFrame') return 'nextScorchMarkFrame';
  if (method === 'xferUnsignedInt' && argument === 'm_nextLaunchFXFrame') return 'nextLaunchFxFrame';
  if (method === 'xferUnsignedInt' && argument === 'm_damagePulsesMade') return 'damagePulsesMade';
  if (method === 'xferUnsignedInt' && argument === 'm_nextDamagePulseFrame') return 'nextDamagePulseFrame';
  if (method === 'xferUnsignedInt' && argument === 'm_startAttackFrame') return 'startAttackFrame';
  if (method === 'xferUnsignedInt' && argument === 'm_startDecayFrame') return 'startDecayFrame';
  if (method === 'xferUnsignedInt' && argument === 'm_lastDrivingClickFrame') return 'lastDrivingClickFrame';
  if (method === 'xferUnsignedInt' && argument === 'm_2ndLastDrivingClickFrame') {
    return 'secondLastDrivingClickFrame';
  }
  if (method === 'xferBool' && argument === 'm_manualTargetMode') return 'manualTargetMode';
  if (method === 'xferBool' && argument === 'm_scriptedWaypointMode') return 'scriptedWaypointMode';
  if (method === 'xferUnsignedInt' && argument === 'm_nextDestWaypointID') return 'nextDestWaypointId';
  if (method === 'xferReal' && argument === 'm_angularVelocity') return 'angularVelocity';
  if (method === 'xferReal' && argument === 'm_angularAcceleration') return 'angularAcceleration';
  if (method === 'xferCoord3D' && argument === 'm_toppleDirection') return 'toppleDirection';
  if (method === 'xferCoord2D' && argument === 'm_toppleDirection') return 'toppleDirection';
  if (method === 'xferUser' && argument.startsWith('m_toppleState')) return 'toppleState';
  if (method === 'xferReal' && argument === 'm_angularAccumulation') return 'angularAccumulation';
  if (method === 'xferReal' && argument === 'm_angleDeltaX') return 'angleDeltaX';
  if (method === 'xferInt' && argument === 'm_numAngleDeltaX') return 'numAngleDeltaX';
  if (method === 'xferBool' && argument === 'm_doBounceFX') return 'doBounceFx';
  if (method === 'xferUnsignedInt' && argument === 'm_options') return 'options';
  if (method === 'xferObjectID' && argument === 'm_stumpID') return 'stumpId';
  if (method === 'xferUnsignedInt' && argument === 'm_toppleFrame') return 'toppleFrame';
  if (method === 'xferReal' && argument === 'm_toppleVelocity') return 'toppleVelocity';
  if (method === 'xferReal' && argument === 'm_accumulatedAngle') return 'accumulatedAngle';
  if (method === 'xferReal' && argument === 'm_structuralIntegrity') return 'structuralIntegrity';
  if (method === 'xferReal' && argument === 'm_lastCrushedLocation') return 'lastCrushedLocation';
  if (method === 'xferInt' && argument === 'm_nextBurstFrame') return 'nextBurstFrame';
  if (method === 'xferCoord3D' && argument === 'm_delayBurstLocation') return 'delayBurstLocation';
  if (method === 'xferUser' && argument.startsWith('m_state')) return 'state';
  if (method === 'xferCoord3D' && argument === 'm_targetPos') return 'targetPosition';
  if (method === 'xferCoord3D' && argument === 'm_intermedPos') return 'intermediatePosition';
  if (method === 'xferObjectID' && argument === 'm_launcherID') return 'launcherId';
  if (method === 'xferUser' && argument.startsWith('m_attach_wslot')) return 'attachWeaponSlot';
  if (method === 'xferInt' && argument === 'm_attach_specificBarrelToUse') return 'attachSpecificBarrelToUse';
  if (method === 'xferCoord3D' && argument === 'm_accel') return 'acceleration';
  if (method === 'xferCoord3D' && argument === 'm_vel') return 'velocity';
  if (method === 'xferUnsignedInt' && argument === 'm_stateTimestamp') return 'stateTimestamp';
  if (method === 'xferBool' && argument === 'm_isLaunched') return 'isLaunched';
  if (method === 'xferBool' && argument === 'm_isArmed') return 'isArmed';
  if (method === 'xferReal' && argument === 'm_noTurnDistLeft') return 'noTurnDistLeft';
  if (method === 'xferBool' && argument === 'm_reachedIntermediatePos') return 'reachedIntermediatePos';
  if (method === 'xferUnsignedInt' && argument === 'm_frameAtLaunch') return 'frameAtLaunch';
  if (method === 'xferReal' && argument === 'm_heightAtLaunch') return 'heightAtLaunch';
  if (method === 'xferAsciiString' && argument === 'name') return 'exhaustSystemTemplateName';
  if (method === 'xferUnsignedInt' && argument === 'm_deactivateFrame') return 'deactivateFrame';
  if (method === 'xferBool' && argument === 'm_currentlyActive') return 'currentlyActive';
  if (method === 'xferBool' && argument === 'm_resetTimersNextUpdate') return 'resetTimersNextUpdate';
  if (method === 'xferUnsignedInt' && argument === 'm_disabledUntilFrame') return 'disabledUntilFrame';
  if (method === 'xferObjectID' && argument === 'm_gunshipID') return 'gunshipId';
  return null;
}

function mapCppProductionUpdateField(method: string, argument: string): string | null {
  if (method === 'xferAsciiString' && argument === 'name') return 'queue.entry.name';
  return mapCppSimpleModuleField(method, argument);
}

function mapCppNeutronMissileUpdateField(method: string, argument: string): string | null {
  if (method === 'xferAsciiString' && argument === 'name') return 'exhaustSystemTemplateName';
  return mapCppSimpleModuleField(method, argument);
}

function mapTsSourceObjectUpdateField(token: string, body: string, tokenIndex: number): string | null {
  const window = tsTokenStatement(body, tokenIndex);
  if (token.includes('xferSourceWeaponSnapshot')) return 'weapon.snapshot';
  if (token.includes('xferSourceRgbColor')) return 'personalColor';
  if (token.includes('xferSourceKindOfNames')) {
    if (window.includes('invalidKindOf')) return 'invalidKindOf';
    if (window.includes('validKindOf')) return 'validKindOf';
  }
  if (token.includes('xferSourceStringBitFlags')) {
    if (window.includes('clearFlags')) return 'clearFlags';
    if (window.includes('setFlags')) return 'setFlags';
  }
  if (token.includes('xferObjectID')) {
    if (window.includes('targetId')) return 'targetId';
    if (window.includes('targetEntityId')) return 'targetId';
    if (window.includes('bestTargetId')) return 'bestTargetId';
    if (window.includes('projectileId')) return 'projectileIds';
    if (window.includes('specialObjectIdList')) return 'specialObjectIdList';
    if (window.includes('lastRepair')) return 'lastRepair';
    if (window.includes('dockingObjectId')) return 'dockingObjectId';
    if (window.includes('unloadingObjectId')) return 'unloadingObjectId';
    if (window.includes('toppleStumpId')) return 'stumpId';
    if (window.includes('launcherId')) return 'launcherId';
    if (window.includes('spectreGunshipDeploymentGunshipId')) return 'gunshipId';
    if (window.includes('occupierIds')) return 'occupierIds';
    if (window.includes('visionObjectId')) return 'visionObjectId';
    if (window.includes('primaryVictimId')) return 'primaryVictimId';
    if (window.includes('slaverEntityId') || window.includes('preservedState.slaver')) return 'slaver';
    if (window.includes('gattlingEntityId') || window.includes('gattlingId')) return 'gattlingId';
    if (window.includes('ownerEntityId') || window.includes('owningObject')) return 'owningObject';
    if (window.includes('targetObjectId') || window.includes('targetObject')) return 'targetObject';
  }
  if (token.includes('xferAsciiString')) {
    if (window.includes('entry.name')) return 'queue.entry.name';
    if (window.includes('buttonName')) return 'commandButtonName';
    if (window.includes('disguiseTemplateName')) return 'disguiseTemplateName';
    if (window.includes('exhaustSystemTemplateName')) return 'exhaustSystemTemplateName';
  }
  if (token.includes('xferUnsignedShort')) {
    if (window.includes('queue.length')) return 'queue.count';
    if (window.includes('particleSystemIds.length')) return 'particleSystem.count';
  }
  if (token.includes('xferBool')) {
    if (window.includes('state?.extended')) return 'extended';
    if (window.includes('entity.oclUpdateFactionNeutral')) return 'factionNeutral';
    if (window.includes('entity.enemyNearDetected')) return 'enemyNear';
    if (window.includes('entity.isInHorde')) return 'inHorde';
    if (window.includes('hasFlag')) return 'hasFlag';
    if (window.includes('state.upgradeExecuted') || window.includes('upgradeExecuted')) return 'upgradeExecuted';
    if (window.includes('state.valid')) return 'valid';
    if (window.includes('killWhenNoLongerAttacking')) return 'killWhenNoLongerAttacking';
    if (window.includes('entity.heightDieHasDied')) return 'hasDied';
    if (window.includes('entity.heightDieParticlesDestroyed')) return 'particlesDestroyed';
    if (window.includes('state?.inRange')) return 'inRange';
    if (window.includes('pdlInRange')) return 'inRange';
    if (window.includes('entity.demoTrapDetonated')) return 'detonated';
    if (window.includes('entity.autoDepositCaptureBonusPending')) return 'awardInitialCaptureBonus';
    if (window.includes('entity.autoDepositInitialized')) return 'initialized';
    if (window.includes('entity.dynamicShroudDecalsCreated')) return 'decalsCreated';
    if (window.includes('preservedState.effectsFired')) return 'effectsFired';
    if (window.includes('preservedState.scorchPlaced')) return 'scorchPlaced';
    if (window.includes('disguiseHalfpointReached')) return 'disguiseHalfpointReached';
    if (window.includes('transitioningToDisguise')) return 'transitioningToDisguise';
    if (window.includes('isDisguised')) return 'disguised';
    if (window.includes('needDisable')) return 'needDisable';
    if (window.includes('initialized')) return 'initialized';
    if (window.includes('pilotFindVehicleDidMoveToBase')) return 'didMoveToBase';
    if (window.includes('radarExtendComplete')) return 'extendComplete';
    if (window.includes('radarActive')) return 'radarActive';
    if (window.includes('checkpointEnemyNear')) return 'enemyNear';
    if (window.includes('checkpointAllyNear')) return 'allyNear';
    if (window.includes('isInVehicle')) return 'isInVehicle';
    if (window.includes('wasTargetAirborne')) return 'wasTargetAirborne';
    if (window.includes('state?.update')) return 'update';
    if (window.includes('toppleDoBounceFx')) return 'doBounceFx';
    if (window.includes('isLaunched')) return 'isLaunched';
    if (window.includes('isArmed')) return 'isArmed';
    if (window.includes('reachedIntermediatePos')) return 'reachedIntermediatePos';
    if (window.includes('currentlyActive')) return 'currentlyActive';
    if (window.includes('resetTimersNextUpdate')) return 'resetTimersNextUpdate';
    if (window.includes('rallyPointExists')) return 'rallyPointExists';
    if (window.includes('state?.active')) return 'active';
    if (window.includes('noTargetCommand')) return 'noTargetCommand';
    if (window.includes('facingInitiated')) return 'facingInitiated';
    if (window.includes('facingComplete')) return 'facingComplete';
    if (window.includes('withinStartAbilityRange')) return 'withinStartAbilityRange';
    if (window.includes('doDisableFxParticles')) return 'doDisableFxParticles';
    if (window.includes('manualTargetMode')) return 'manualTargetMode';
    if (window.includes('scriptedWaypointMode')) return 'scriptedWaypointMode';
    if (window.includes('invalidSettings')) return 'invalidSettings';
    if (window.includes('centeringTurret')) return 'centeringTurret';
    if (window.includes('repairing')) return 'repairing';
    if (window.includes('isSelfTasking')) return 'isSelfTasking';
    if (window.includes('flagsDirty')) return 'flagsDirty';
    if (window.includes('detectorEnabled') || window.includes('enabled')) return 'enabled';
    if (window.includes('state.active')) return 'active';
  }
  if (token.includes('xferInt')) {
    if (window.includes('SOURCE_BATTLE_PLAN_BOMBARDMENT')) return 'bombardment';
    if (window.includes('SOURCE_BATTLE_PLAN_SEARCH_AND_DESTROY')) return 'searchAndDestroy';
    if (window.includes('SOURCE_BATTLE_PLAN_HOLD_THE_LINE')) return 'holdTheLine';
    if (window.includes('entry.framesUnderConstruction')) return 'queue.entry.framesUnderConstruction';
    if (window.includes('entry.productionQuantityTotal')) return 'queue.entry.productionQuantityTotal';
    if (window.includes('entry.productionQuantityProduced')) return 'queue.entry.productionQuantityProduced';
    if (window.includes('entry.exitDoor')) return 'queue.entry.exitDoor';
    if (window.includes('currentPlan')) return 'currentPlan';
    if (window.includes('desiredPlan')) return 'desiredPlan';
    if (window.includes('planAffectingArmy')) return 'planAffectingArmy';
    if (window.includes('framesToWait')) return 'framesToWait';
    if (window.includes('mobState')) return 'mobState';
    if (window.includes('repairState')) return 'repairState';
    if (window.includes('locationCount')) return 'locationCount';
    if (window.includes('entity.oclUpdateCurrentPlayerColors')) return 'currentPlayerColor';
    if (window.includes('entity.proneFramesRemaining')) return 'proneFrames';
    if (window.includes('nextScanFrames')) return 'nextScanFrames';
    if (window.includes('nextScanFrame')) return 'nextScanFrames';
    if (window.includes('nextShotAvailableInFrames')) return 'nextShotAvailableInFrames';
    if (window.includes('nextShotAvailableFrame')) return 'nextShotAvailableInFrames';
    if (window.includes('entity.dynamicShroudStateCountdown')) return 'stateCountdown';
    if (window.includes('entity.dynamicShroudTotalFrames')) return 'totalFrames';
    if (window.includes('disguiseAsPlayerIndex')) return 'disguiseAsPlayerIndex';
    if (window.includes('shapePointCount')) return 'shapePointCount';
    if (window.includes('liveProjectileIds.length')) return 'nextFreeIndex';
    if (window === 'saver.xferInt(0);') return 'firstValidIndex';
    if (window.includes('nextFreeIndex')) return 'nextFreeIndex';
    if (window.includes('firstValidIndex')) return 'firstValidIndex';
    if (window.includes('findLiveSupplyWarehouseBoxes')) return 'boxesStored';
    if (window.includes('unloadCount')) return 'unloadCount';
    if (window.includes('toppleNumAngleDeltaX')) return 'numAngleDeltaX';
    if (window.includes('attachSpecificBarrelToUse')) return 'attachSpecificBarrelToUse';
    if (window.includes('nextBurstFrame')) return 'nextBurstFrame';
  }
  if (token.includes('xferUnsignedInt')) {
    if (window.includes('currentDelay')) return 'currentDelay';
    if (window.includes('currentBurstCount')) return 'currentBurstCount';
    if (window.includes('liveNextFireFrame')) return 'initialDelayFrame';
    if (window.includes('queue.length')) return 'productionCount';
    if (window.includes('constructionCompleteFrame')) return 'constructionCompleteFrame';
    if (window.includes('orbitEscapeFrame')) return 'orbitEscapeFrame';
    if (window.includes('okToFireHowitzerCounter')) return 'okToFireHowitzerCounter';
    if (window.includes('prepFrames')) return 'prepFrames';
    if (window.includes('animFrames')) return 'animFrames';
    if (window.includes('specialObjectEntries')) return 'specialObjectEntries';
    if (window.includes('xferUnsignedInt(frames')) return 'frames';
    if (window.includes('scorchMarksMade')) return 'scorchMarksMade';
    if (window.includes('nextScorchMarkFrame')) return 'nextScorchMarkFrame';
    if (window.includes('nextLaunchFXFrame')) return 'nextLaunchFxFrame';
    if (window.includes('damagePulsesMade')) return 'damagePulsesMade';
    if (window.includes('nextDamagePulseFrame')) return 'nextDamagePulseFrame';
    if (window.includes('startAttackFrame')) return 'startAttackFrame';
    if (window.includes('startDecayFrame')) return 'startDecayFrame';
    if (window.includes('lastDrivingClickFrame')) return 'lastDrivingClickFrame';
    if (window.includes('secondLastDrivingClickFrame')) return 'secondLastDrivingClickFrame';
    if (window.includes('nextDestWaypointID')) return 'nextDestWaypointId';
    if (window.includes('nextReadyFrame') || window.includes('sourceBattlePlanNextReadyFrame')) {
      return 'nextReadyFrame';
    }
    if (window.includes('catchUpCrisisTimer')) return 'catchUpCrisisTimer';
    if (window.includes('entity.oclUpdateNextCreationFrames')) return 'nextCreationFrame';
    if (window.includes('entity.oclUpdateTimerStartedFrames')) return 'timerStartedFrame';
    if (window.includes('entity.enemyNearNextScanCountdown')) return 'enemyScanDelay';
    if (window.includes('state.consecutiveShots')) return 'consecutiveShots';
    if (window.includes('state.startFrame')) return 'startFrame';
    if (window.includes('nextPingFrame')) return 'nextPingFrame';
    if (window.includes('entity.autoDepositNextFrame')) return 'depositOnFrame';
    if (window.includes('entity.dynamicShroudGrowStartDeadline')) return 'growStartDeadline';
    if (window.includes('entity.dynamicShroudSustainDeadline')) return 'sustainDeadline';
    if (window.includes('entity.dynamicShroudShrinkStartDeadline')) return 'shrinkStartDeadline';
    if (window.includes('entity.dynamicShroudDoneForeverFrame')) return 'doneForeverFrame';
    if (window.includes('entity.dynamicShroudChangeIntervalCountdown')) return 'changeIntervalCountdown';
    if (window.includes('stealthAllowedFrame')) return 'stealthAllowedFrame';
    if (window.includes('entity.detectedUntilFrame')) return 'detectionExpiresFrame';
    if (window.includes('disguiseTransitionFrames')) return 'disguiseTransitionFrames';
    if (window.includes('framesGranted')) return 'framesGranted';
    if (window.includes('activeFrame')) return 'activeFrame';
    if (window.includes('splashSoundFrame')) return 'splashSoundFrame';
    if (window.includes('particleSystemId')) return 'particleSystem.id';
    if (window.includes('flameEndFrame')) return 'aflameEndFrame';
    if (window.includes('flameBurnedEndFrame')) return 'burnedEndFrame';
    if (window.includes('flameDamageNextFrame')) return 'damageEndFrame';
    if (window.includes('flameLastDamageReceivedFrame')) return 'lastFlameDamageDealt';
    if (window.includes('lastDamageFrame')) return 'lastDamageFrame';
    if (window.includes('radarExtendDoneFrame')) return 'extendDoneFrame';
    if (window.includes('checkpointScanCountdown')) return 'enemyScanDelay';
    if (window.includes('timeoutFrame')) return 'timeoutFrame';
    if (window.includes('collapseFrame')) return 'collapseFrame';
    if (window.includes('burstFrame')) return 'burstFrame';
    if (window.includes('toppleOptions')) return 'options';
    if (window.includes('toppleFrame')) return 'toppleFrame';
    if (window.includes('stateTimestamp')) return 'stateTimestamp';
    if (window.includes('frameAtLaunch')) return 'frameAtLaunch';
    if (window.includes('deactivateFrame')) return 'deactivateFrame';
    if (window.includes('disabledUntilFrame')) return 'disabledUntilFrame';
    if (window.includes('dieFrame')) return 'dieFrame';
    if (window.includes('earliestDeathFrame')) return 'earliestDeathFrame';
  }
  if (token.includes('xferReal')) {
    if (window.includes('cleanupAreaMoveRange')) return 'moveRange';
    if (window.includes('entity.dynamicShroudVisionChangePerInterval')) return 'visionChangePerInterval';
    if (window.includes('entity.dynamicShroudNativeClearingRange')) return 'nativeClearingRange';
    if (window.includes('entity.dynamicShroudCurrentClearingRange')) return 'currentClearingRange';
    if (window.includes('stealthPulsePhaseRate')) return 'pulsePhaseRate';
    if (window.includes('stealthPulsePhase')) return 'pulsePhase';
    if (window.includes('sourceFlammableRemainingDamageLimit')) return 'flameDamageLimit';
    if (window.includes('checkpointMaxMinorRadius')) return 'maxMinorRadius';
    if (window.includes('collapseVelocity')) return 'collapseVelocity';
    if (window.includes('currentHeight')) return 'currentHeight';
    if (window.includes('healthToAddPerFrame')) return 'healthToAddPerFrame';
    if (window.includes('pullInsideDistancePerFrame')) return 'pullInsideDistancePerFrame';
    if (window.includes('pushOutsideDistancePerFrame')) return 'pushOutsideDistancePerFrame';
    if (window.includes('toppleAngularVelocity')) return 'angularVelocity';
    if (window.includes('toppleAngularAcceleration')) return 'angularAcceleration';
    if (window.includes('toppleAngularAccumulation')) return 'angularAccumulation';
    if (window.includes('toppleAngleDeltaX')) return 'angleDeltaX';
    if (window.includes('toppleDirX')) return 'toppleDirection';
    if (window.includes('toppleDirZ')) return 'toppleDirection';
    if (window.includes('toppleVelocity')) return 'toppleVelocity';
    if (window.includes('accumulatedAngle')) return 'accumulatedAngle';
    if (window.includes('structuralIntegrity')) return 'structuralIntegrity';
    if (window.includes('lastCrushedLocation')) return 'lastCrushedLocation';
    if (window.includes('noTurnDistLeft')) return 'noTurnDistLeft';
    if (window.includes('heightAtLaunch')) return 'heightAtLaunch';
    if (window.includes('creationClearDistance')) return 'creationClearDistance';
    if (window.includes('entry.percentComplete')) return 'queue.entry.percentComplete';
    if (window.includes('armorScalar')) return 'armorScalar';
    if (window.includes('sightRangeScalar')) return 'sightRangeScalar';
    if (window.includes('squirrellinessRatio')) return 'squirrellinessRatio';
    if (window.includes('captureFlashPhase')) return 'captureFlashPhase';
  }
  if (token.includes('xferUser')) {
    if (window.includes('buildSourceRawInt32Bytes(entry.type)')) return 'queue.entry.type';
    if (window.includes('buildSourceRawInt32Bytes(entry.productionId)')) return 'queue.entry.productionId';
    if (window.includes('buildSourceRawInt32Bytes(uniqueId)')) return 'uniqueId';
    if (window.includes('doorInfoBytes')) return 'doorInfo';
    if (window.includes('buildSourceSpectreGunshipStatusBytes')) return 'status';
    if (window.includes('statusBytes')) return 'status';
    if (window.includes('laserStatusBytes')) return 'laserStatus';
    if (window.includes('sourceSpecialAbilityPackingStateToInt')) return 'packingState';
    if (window.includes('buildSourceRawInt32Bytes(currentPlan)')) return 'currentPlan';
    if (window.includes('buildSourceRawInt32Bytes(desiredPlan)')) return 'desiredPlan';
    if (window.includes('buildSourceRawInt32Bytes(planAffectingArmy)')) return 'planAffectingArmy';
    if (window.includes('buildSourceRawInt32Bytes(status)')) return 'status';
    if (window.includes('shapePointsBytes')) return 'shapePoints';
    if (window.includes('transformedShapePointsBytes')) return 'transformedShapePoints';
    if (window.includes('shapeEffectsBytes')) return 'shapeEffects';
    if (window.includes('currentBodyState')) return 'currentBodyState';
    if (window.includes('bonesResolved')) return 'bonesResolved';
    if (window.includes('sourceFlammableStatusToInt')) return 'status';
    if (window.includes('particleSystemIdBytes')) return 'particleSystemIds';
    if (window.includes('sourceMissileDoorStateToInt(state?.doorState')) return 'doorState';
    if (window.includes('sourceMissileDoorStateToInt(state?.timeoutState')) return 'timeoutState';
    if (window.includes('sourceStructureCollapseStateToInt')) return 'collapseState';
    if (window.includes('sourceToppleStateToInt')) return 'toppleState';
    if (window.includes('sourceStructureToppleStateToInt')) return 'toppleState';
    if (window.includes('sourceNeutronMissileStateToInt')) return 'state';
    if (window.includes('attachWeaponSlot')) return 'attachWeaponSlot';
  }
  if (token.includes('xferSourceBoneFxIntGrid')) {
    if (window.includes('nextFXFrame')) return 'nextFxFrame';
    if (window.includes('nextOCLFrame')) return 'nextOclFrame';
    if (window.includes('nextParticleFrame')) return 'nextParticleSystemFrame';
  }
  if (token.includes('xferSourceBoneFxCoordGrid')) {
    if (window.includes('fxBonePositions')) return 'fxBonePositions';
    if (window.includes('oclBonePositions')) return 'oclBonePositions';
    if (window.includes('particleSystemBonePositions')) return 'particleSystemBonePositions';
  }
  if (token.includes('xferCoord3D') && window.includes('heightDieLastPosition')) {
    return 'lastPosition';
  }
  if (token.includes('xferCoord3D')) {
    if (window.includes('cleanupAreaPosition')) return 'position';
    if (window.includes('ejectX')) return 'ejectPosition';
    if (window.includes('toppleDirX')) return 'toppleDirection';
    if (window.includes('delayBurstLocation')) return 'delayBurstLocation';
    if (window.includes('targetX')) return 'targetPosition';
    if (window.includes('targetPos')) return 'targetPosition';
    if (window.includes('intermedX')) return 'intermediatePosition';
    if (window.includes('initialTarget')) return 'initialTargetPosition';
    if (window.includes('currentTargetPosition')) return 'currentTargetPosition';
    if (window.includes('overrideTarget')) return 'overrideTargetDestination';
    if (window.includes('satellite')) return 'satellitePosition';
    if (window.includes('gattlingTarget')) return 'gattlingTargetPosition';
    if (window.includes('positionToShootAt')) return 'positionToShootAt';
    if (window.includes('accelX')) return 'acceleration';
    if (window.includes('velX')) return 'velocity';
    if (window.includes('finalDestination')) return 'finalDestination';
    if (window.includes('targetPosition')) return 'targetPosition';
    if (window.includes('rallyPoint')) return 'rallyPoint';
    if (window.includes('guardPointOffset') || window.includes('slaveGuardOffset')) return 'guardPointOffset';
  }
  return null;
}

function mapTsSourceW3DDrawField(token: string, body: string, tokenIndex: number): string | null {
  if (token.includes('xferVersion')) return 'version';
  if (token.includes('xferCoord3D')) {
    const window = tsTokenStatement(body, tokenIndex);
    if (window.includes('state.startPos')) return 'startPos';
    if (window.includes('state.endPos')) return 'endPos';
  }
  if (token.includes('xferUser')) {
    const window = tsTokenStatement(body, tokenIndex);
    if (window.includes('state.targetParticleSystemId')) return 'targetParticleSystemId';
    if (window.includes('state.particleSystemId')) return 'particleSystemId';
  }
  if (token.includes('xferUnsignedByte')) {
    const window = tsTokenStatement(body, tokenIndex);
    if (window.includes('recoilEntries.length')) return 'weaponRecoil.count';
    if (window.includes('subObjects.length')) return 'subObject.count';
  }
  if (token.includes('xferUnsignedInt')) {
    const window = tsTokenStatement(body, tokenIndex);
    if (window.includes('state.widenStartFrame')) return 'widenStartFrame';
    if (window.includes('state.widenFinishFrame')) return 'widenFinishFrame';
    if (window.includes('state.decayStartFrame')) return 'decayStartFrame';
    if (window.includes('state.decayFinishFrame')) return 'decayFinishFrame';
    if (window.includes('state.parentDrawableId')) return 'parentDrawableId';
    if (window.includes('state.targetDrawableId')) return 'targetDrawableId';
    if (window.includes('state.lastRadarPulse')) return 'lastRadarPulse';
  }
  if (token.includes('xferBool')) {
    const window = tsTokenStatement(body, tokenIndex);
    if (window.includes('hasAnimation')) return 'animation.present';
    if (window.includes('state.finalStop')) return 'finalStop';
    if (window.includes('state.swaying')) return 'swaying';
    if (window.includes('state.dirty')) return 'dirty';
    if (window.includes('state.widening')) return 'widening';
    if (window.includes('state.decaying')) return 'decaying';
    if (window.includes('false')) return 'dependencyCleared';
  }
  if (token.includes('xferAsciiString')) {
    const window = tsTokenStatement(body, tokenIndex);
    if (window.includes('state.modelName')) return 'modelName';
    if (window.includes('state.animInitial')) return 'animInitial';
    if (window.includes('state.animFlying')) return 'animFlying';
    if (window.includes('state.animFinal')) return 'animFinal';
    if (window.includes('state.parentBoneName')) return 'parentBoneName';
  }
  if (token.includes('xferColor')) return 'modelColor';
  if (token.includes('xferShort')) return 'curVersion';
  if (token.includes('xferInt')) {
    const window = tsTokenStatement(body, tokenIndex);
    if (window.includes('state.state')) return 'state';
    if (window.includes('state.frames')) return 'frames';
  }
  if (token.includes('xferReal')) {
    const window = tsTokenStatement(body, tokenIndex);
    if (window.includes('state.curValue')) return 'curValue';
    if (window.includes('state.curAngleLimit')) return 'curAngleLimit';
    if (window.includes('state.curAngle')) return 'curAngle';
    if (window.includes('state.curDelta')) return 'curDelta';
    if (window.includes('state.leanAngle')) return 'leanAngle';
    if (window.includes('state.curLen')) return 'curLen';
    if (window.includes('state.maxLen')) return 'maxLen';
    if (window.includes('state.width')) return 'width';
    if (window.includes('state.curSpeed')) return 'curSpeed';
    if (window.includes('state.maxSpeed')) return 'maxSpeed';
    if (window.includes('state.accel')) return 'accel';
    if (window.includes('state.wobbleLen')) return 'wobbleLen';
    if (window.includes('state.wobbleAmp')) return 'wobbleAmp';
    if (window.includes('state.wobbleRate')) return 'wobbleRate';
    if (window.includes('state.curWobblePhase')) return 'curWobblePhase';
    if (window.includes('state.curZOffset')) return 'curZOffset';
    if (window.includes('state.currentWidthScalar')) return 'currentWidthScalar';
  }
  return null;
}

function tsTokenStatement(body: string, tokenIndex: number): string {
  const end = body.indexOf(';', tokenIndex);
  return body.slice(tokenIndex, end >= 0 ? end + 1 : tokenIndex + 160);
}

function mapCppRadarField(method: string, argument: string): string | null {
  if (method === 'xferVersion') return 'version';
  if (method === 'xferBool' && argument === 'm_radarHidden') return 'radarHidden';
  if (method === 'xferBool' && argument === 'm_radarForceOn') return 'radarForced';
  if (method === 'xferUnsignedShort' && argument === 'eventCount') return 'eventCount';
  if (method === 'xferUser' && argument.startsWith('m_event[ i ].type')) return 'event.type';
  if (method === 'xferBool' && argument === 'm_event[ i ].active') return 'event.active';
  if (method === 'xferUnsignedInt' && argument === 'm_event[ i ].createFrame') return 'event.createFrame';
  if (method === 'xferUnsignedInt' && argument === 'm_event[ i ].dieFrame') return 'event.dieFrame';
  if (method === 'xferUnsignedInt' && argument === 'm_event[ i ].fadeFrame') return 'event.fadeFrame';
  if (method === 'xferRGBAColorInt' && argument === 'm_event[ i ].color1') return 'event.color1';
  if (method === 'xferRGBAColorInt' && argument === 'm_event[ i ].color2') return 'event.color2';
  if (method === 'xferCoord3D' && argument === 'm_event[ i ].worldLoc') return 'event.worldLoc';
  if (method === 'xferICoord2D' && argument === 'm_event[ i ].radarLoc') return 'event.radarLoc';
  if (method === 'xferBool' && argument === 'm_event[ i ].soundPlayed') return 'event.soundPlayed';
  if (method === 'xferInt' && argument === 'm_nextFreeRadarEvent') return 'nextFreeRadarEvent';
  if (method === 'xferInt' && argument === 'm_lastRadarEvent') return 'lastRadarEvent';
  return null;
}

function mapCppRadarObjectListField(method: string, argument: string): string | null {
  if (method === 'xferVersion') return 'version';
  if (method === 'xferUnsignedShort' && argument === 'count') return 'count';
  return null;
}

function mapCppRadarObjectField(method: string, argument: string): string | null {
  if (method === 'xferVersion') return 'version';
  if (method === 'xferObjectID' && argument === 'objectID') return 'objectId';
  if (method === 'xferColor' && argument === 'm_color') return 'color';
  return null;
}

function mapTsRadarField(token: string): string | null {
  if (token.startsWith('xfer.xferVersion')) return 'version';
  if (token.includes('payload.radarHidden')) return 'radarHidden';
  if (token.includes('payload.radarForced')) return 'radarForced';
  if (token.includes('eventCountVerify')) return 'eventCount';
  if (token.includes('nextFreeRadarEvent')) return 'nextFreeRadarEvent';
  if (token.includes('lastRadarEvent')) return 'lastRadarEvent';
  return null;
}

function mapTsRadarObjectListField(token: string): string | null {
  if (token.startsWith('xfer.xferVersion')) return 'version';
  if (token.includes('objectList.length')) return 'count';
  return null;
}

function mapTsRadarObjectField(token: string): string | null {
  if (token.startsWith('xfer.xferVersion')) return 'version';
  if (token.includes('objectId')) return 'objectId';
  if (token.includes('color')) return 'color';
  return null;
}

function mapTsRadarEventField(rawName: string): string | null {
  const mappings = new Map<string, string>([
    ['type', 'event.type'],
    ['active', 'event.active'],
    ['createFrame', 'event.createFrame'],
    ['dieFrame', 'event.dieFrame'],
    ['fadeFrame', 'event.fadeFrame'],
    ['color1', 'event.color1'],
    ['color2', 'event.color2'],
    ['worldLoc', 'event.worldLoc'],
    ['radarLoc', 'event.radarLoc'],
    ['soundPlayed', 'event.soundPlayed'],
    ['sourceEntityId', 'event.sourceEntityId'],
    ['sourceTeamName', 'event.sourceTeamName'],
  ]);
  return mappings.get(rawName) ?? null;
}

function mapCppPartitionField(method: string, argument: string): string | null {
  if (method === 'xferVersion') return 'version';
  if (method === 'xferReal' && argument === 'cellSize') return 'cellSize';
  if (method === 'xferInt' && argument === 'totalCellCount') return 'totalCellCount';
  if (method === 'xferInt' && argument === 'queueSize') return 'undoRevealCount';
  return null;
}

function mapCppPartitionCellFields(method: string, argument: string): string[] {
  if (method === 'xferVersion') return ['version'];
  if (method === 'xferUser' && argument.startsWith('m_shroudLevel')) {
    return ['shroudLevel.currentShroud', 'shroudLevel.activeShroudLevel'];
  }
  return [];
}

function mapCppPartitionUndoRevealField(method: string, argument: string): string | null {
  if (method === 'xferVersion') return 'version';
  if (method === 'xferCoord3D' && argument === 'm_where') return 'where';
  if (method === 'xferReal' && argument === 'm_howFar') return 'howFar';
  if (method === 'xferUser' && argument.startsWith('m_forWhom')) return 'forWhom';
  if (method === 'xferUnsignedInt' && argument === 'm_data') return 'data';
  return null;
}

function mapTsPartitionField(token: string): string | null {
  if (token.includes('SOURCE_PARTITION_SNAPSHOT_VERSION')) return 'version';
  if (token.includes('payload.cellSize')) return 'cellSize';
  if (token.includes('payload.totalCellCount')) return 'totalCellCount';
  if (token.includes('SOURCE_PARTITION_CELL_SNAPSHOT_VERSION')) return 'cell.version';
  if (token.includes('pendingUndoShroudReveals.length')) return 'undoRevealCount';
  return null;
}

function mapCppTeamFactoryField(method: string, argument: string): string | null {
  if (method === 'xferVersion') return 'version';
  if (method === 'xferUser' && argument.startsWith('m_uniqueTeamID')) return 'uniqueTeamId';
  if (method === 'xferUnsignedShort' && argument === 'prototypeCount') return 'prototypeCount';
  if (method === 'xferUser' && argument.startsWith('teamPrototypeID')) return 'prototype.id';
  if (method === 'xferSnapshot' && argument === 'teamPrototype') return 'prototype.snapshot';
  return null;
}

function mapTsTeamFactoryField(token: string): string | null {
  if (token.includes('SOURCE_TEAM_FACTORY_SNAPSHOT_VERSION')) return 'version';
  if (token.includes('scriptNextSourceTeamId')) return 'uniqueTeamId';
  if (token.includes('prototypeOrder.length')) return 'prototypeCount';
  if (token.includes('prototypeRecord.sourcePrototypeId')) return 'prototype.id';
  if (token.includes('SourceTeamPrototypeSnapshot')) return 'prototype.snapshot';
  return null;
}

function mapCppPlayerListField(method: string, argument: string): string | null {
  if (method === 'xferVersion') return 'version';
  if (method === 'xferInt' && argument === 'playerCount') return 'playerCount';
  if (method === 'xferSnapshot' && argument === 'm_players[ i ]') return 'player.snapshot';
  return null;
}

function mapTsPlayerListField(token: string): string | null {
  if (token.includes('SOURCE_PLAYERS_LIST_SNAPSHOT_VERSION')) return 'version';
  if (token.includes('resolveSourcePlayersCount')) return 'playerCount';
  if (token.includes('SOURCE_PLAYER_ENTRY_SNAPSHOT_VERSION')) return 'player.snapshot';
  return null;
}

function mapCppPlayerField(method: string, argument: string): string | null {
  if (method === 'xferVersion') return 'version';
  if (method === 'xferSnapshot' && argument === 'm_money') return 'money.snapshot';
  if (method === 'xferUnsignedShort' && argument === 'upgradeCount') return 'upgradeCount';
  if (method === 'xferBool' && argument === 'm_isPreorder') return 'isPreorder';
  if (method === 'xferScienceVec' && argument === 'm_sciencesDisabled') return 'sciencesDisabled';
  if (method === 'xferScienceVec' && argument === 'm_sciencesHidden') return 'sciencesHidden';
  if (method === 'xferAsciiString' && argument === 'upgradeName') return 'upgrade.name';
  if (method === 'xferSnapshot' && argument === 'upgrade') return 'upgrade.snapshot';
  if (method === 'xferInt' && argument === 'm_radarCount') return 'radarCount';
  if (method === 'xferBool' && argument === 'm_isPlayerDead') return 'isPlayerDead';
  if (method === 'xferInt' && argument === 'm_disableProofRadarCount') return 'disableProofRadarCount';
  if (method === 'xferBool' && argument === 'm_radarDisabled') return 'radarDisabled';
  if (method === 'xferUpgradeMask' && argument === 'm_upgradesInProgress') return 'upgradesInProgress';
  if (method === 'xferUpgradeMask' && argument === 'm_upgradesCompleted') return 'upgradesCompleted';
  if (method === 'xferSnapshot' && argument === 'm_energy') return 'energy.snapshot';
  if (method === 'xferUnsignedShort' && argument === 'prototypeCount') return 'teamPrototypeCount';
  if (method === 'xferUser' && argument.startsWith('prototypeID')) return 'teamPrototype.id';
  if (method === 'xferUnsignedShort' && argument === 'buildListInfoCount') return 'buildListInfoCount';
  if (method === 'xferSnapshot' && argument === 'buildListInfo') return 'buildListInfo.snapshot';
  if (method === 'xferBool' && argument === 'aiPlayerPresent') return 'aiPlayerPresent';
  if (method === 'xferSnapshot' && argument === 'm_ai') return 'aiPlayer.snapshot';
  if (method === 'xferBool' && argument === 'resourceGatheringManagerPresent') return 'resourceGatheringManagerPresent';
  if (method === 'xferSnapshot' && argument === 'm_resourceGatheringManager') {
    return 'resourceGatheringManager.snapshot';
  }
  if (method === 'xferBool' && argument === 'tunnelTrackerPresent') return 'tunnelTrackerPresent';
  if (method === 'xferSnapshot' && argument === 'm_tunnelSystem') return 'tunnelTracker.snapshot';
  if (method === 'xferUser' && argument.startsWith('teamID')) return 'defaultTeamId';
  if (method === 'xferScienceVec' && argument === 'm_sciences') return 'sciences';
  if (method === 'xferInt' && argument === 'm_rankLevel') return 'rankLevel';
  if (method === 'xferInt' && argument === 'm_skillPoints') return 'skillPoints';
  if (method === 'xferInt' && argument === 'm_sciencePurchasePoints') return 'sciencePurchasePoints';
  if (method === 'xferInt' && argument === 'm_levelUp') return 'levelUp';
  if (method === 'xferInt' && argument === 'm_levelDown') return 'levelDown';
  if (method === 'xferUnicodeString' && argument === 'm_generalName') return 'generalName';
  if (method === 'xferSnapshot' && argument === 'm_playerRelations') return 'playerRelations.snapshot';
  if (method === 'xferSnapshot' && argument === 'm_teamRelations') return 'teamRelations.snapshot';
  if (method === 'xferBool' && argument === 'm_canBuildUnits') return 'canBuildUnits';
  if (method === 'xferBool' && argument === 'm_canBuildBase') return 'canBuildBase';
  if (method === 'xferBool' && argument === 'm_observer') return 'observer';
  if (method === 'xferReal' && argument === 'm_skillPointsModifier') return 'skillPointsModifier';
  if (method === 'xferBool' && argument === 'm_listInScoreScreen') return 'listInScoreScreen';
  if (method === 'xferUser' && argument.startsWith('m_attackedBy')) return 'attackedBy';
  if (method === 'xferReal' && argument === 'm_cashBountyPercent') return 'cashBountyPercent';
  if (method === 'xferSnapshot' && argument === 'm_scoreKeeper') return 'scoreKeeper.snapshot';
  if (method === 'xferUnsignedShort' && argument === 'percentProductionChangeCount') {
    return 'kindOfCostModifierCount';
  }
  if (method === 'xferReal' && argument === 'entry->m_percent') return 'kindOfCostModifier.percent';
  if (method === 'xferUnsignedInt' && argument === 'entry->m_ref') return 'kindOfCostModifier.ref';
  if (method === 'xferUnsignedShort' && argument === 'timerListSize') return 'specialPowerReadyTimerCount';
  if (method === 'xferUnsignedInt' && argument === 'timer->m_templateID') return 'specialPowerReadyTimer.templateId';
  if (method === 'xferUnsignedInt' && argument === 'timer->m_readyFrame') return 'specialPowerReadyTimer.readyFrame';
  if (method === 'xferUnsignedShort' && argument === 'squadCount') return 'squadCount';
  if (method === 'xferSnapshot' && argument === 'm_squads[ i ]') return 'squad.snapshot';
  if (method === 'xferBool' && argument === 'currentSelectionPresent') return 'currentSelectionPresent';
  if (method === 'xferSnapshot' && argument === 'm_currentSelection') return 'currentSelection.snapshot';
  if (method === 'xferBool' && argument === 'battlePlanBonus') return 'battlePlanBonusPresent';
  if (method === 'xferReal' && argument === 'm_battlePlanBonuses->m_armorScalar') {
    return 'battlePlanBonus.armorScalar';
  }
  if (method === 'xferReal' && argument === 'm_battlePlanBonuses->m_sightRangeScalar') {
    return 'battlePlanBonus.sightRangeScalar';
  }
  if (method === 'xferInt' && argument === 'm_battlePlanBonuses->m_bombardment') {
    return 'battlePlanBonus.bombardment';
  }
  if (method === 'xferInt' && argument === 'm_battlePlanBonuses->m_holdTheLine') {
    return 'battlePlanBonus.holdTheLine';
  }
  if (method === 'xferInt' && argument === 'm_battlePlanBonuses->m_searchAndDestroy') {
    return 'battlePlanBonus.searchAndDestroy';
  }
  if (method === 'xferInt' && argument === 'm_bombardBattlePlans') return 'bombardBattlePlans';
  if (method === 'xferInt' && argument === 'm_holdTheLineBattlePlans') return 'holdTheLineBattlePlans';
  if (method === 'xferInt' && argument === 'm_searchAndDestroyBattlePlans') return 'searchAndDestroyBattlePlans';
  if (method === 'xferBool' && argument === 'm_unitsShouldHunt') return 'unitsShouldHunt';
  return null;
}

function mapCppPlayerBitFlagsField(token: string): string | null {
  if (token === 'entry->m_kindOf') return 'kindOfCostModifier.kindOfMask';
  if (token === 'm_battlePlanBonuses->m_validKindOf') return 'battlePlanBonus.validKindOf';
  if (token === 'm_battlePlanBonuses->m_invalidKindOf') return 'battlePlanBonus.invalidKindOf';
  return null;
}

function mapTsPlayerField(token: string): string | null {
  if (token.includes('SOURCE_PLAYER_ENTRY_SNAPSHOT_VERSION')) return 'version';
  if (token.includes('SOURCE_MONEY_SNAPSHOT_VERSION')) return 'money.snapshot';
  if (token.includes('player.upgrades.length')) return 'upgradeCount';
  if (token.includes('player.isPreorder')) return 'isPreorder';
  if (token.includes('player.sciencesDisabled')) return 'sciencesDisabled';
  if (token.includes('player.sciencesHidden')) return 'sciencesHidden';
  if (token.includes("const name = xfer.xferAsciiString('')")) return 'upgrade.name';
  if (token.includes('upgrade.name')) return 'upgrade.name';
  if (token.includes('xferSourceUpgradeState')) return 'upgrade.snapshot';
  if (token.includes('player.radarCount')) return 'radarCount';
  if (token.includes('player.isPlayerDead')) return 'isPlayerDead';
  if (token.includes('player.disableProofRadarCount')) return 'disableProofRadarCount';
  if (token.includes('player.radarDisabled')) return 'radarDisabled';
  if (token.includes('player.upgradesInProgress')) return 'upgradesInProgress';
  if (token.includes('player.upgradesCompleted')) return 'upgradesCompleted';
  if (token.includes('SOURCE_ENERGY_SNAPSHOT_VERSION')) return 'energy.snapshot';
  if (token.includes('player.teamPrototypeIds.length')) return 'teamPrototypeCount';
  if (token.includes('player.teamPrototypeIds.push') || token.includes('teamPrototypeId')) return 'teamPrototype.id';
  if (token.includes('player.buildListInfos.length')) return 'buildListInfoCount';
  if (token.includes('xferSourceBuildListInfoState')) return 'buildListInfo.snapshot';
  if (token.includes('player.aiPlayer !== null')) return 'aiPlayerPresent';
  if (token.includes('xferSourceAiPlayerState')) return 'aiPlayer.snapshot';
  if (token.includes('player.resourceGatheringManager !== null')) return 'resourceGatheringManagerPresent';
  if (token.includes('xferSourceResourceGatheringManagerState')) return 'resourceGatheringManager.snapshot';
  if (token.includes('player.tunnelTracker !== null')) return 'tunnelTrackerPresent';
  if (token.includes('xferSourcePlayerTunnelTrackerSnapshot')) return 'tunnelTracker.snapshot';
  if (token.includes('player.defaultTeamId')) return 'defaultTeamId';
  if (token.includes('player.sciences =')) return 'sciences';
  if (token.includes('player.rankLevel')) return 'rankLevel';
  if (token.includes('player.skillPoints =')) return 'skillPoints';
  if (token.includes('player.sciencePurchasePoints')) return 'sciencePurchasePoints';
  if (token.includes('player.levelUp')) return 'levelUp';
  if (token.includes('player.levelDown')) return 'levelDown';
  if (token.includes('player.generalName')) return 'generalName';
  if (token.includes('xferSourcePlayerRelationEntries')) return 'playerRelations.snapshot';
  if (token.includes('xferSourceTeamRelationEntries')) return 'teamRelations.snapshot';
  if (token.includes('player.canBuildUnits')) return 'canBuildUnits';
  if (token.includes('player.canBuildBase')) return 'canBuildBase';
  if (token.includes('player.observer')) return 'observer';
  if (token.includes('player.skillPointsModifier')) return 'skillPointsModifier';
  if (token.includes('player.listInScoreScreen')) return 'listInScoreScreen';
  if (token.includes('player.attackedByPlayerIndices.includes')) return 'attackedBy';
  if (token.includes('player.cashBountyPercent')) return 'cashBountyPercent';
  if (token.includes('xferSourceScoreKeeperState')) return 'scoreKeeper.snapshot';
  if (token.includes('player.specialPowerReadyTimers.length')) return 'specialPowerReadyTimerCount';
  if (token.includes('templateId')) return 'specialPowerReadyTimer.templateId';
  if (token.includes('readyFrame')) return 'specialPowerReadyTimer.readyFrame';
  if (token.includes('player.squads.length')) return 'squadCount';
  if (token.includes('player.currentSelectionPresent')) return 'currentSelectionPresent';
  if (token.includes('player.battlePlanBonuses !== null')) return 'battlePlanBonusPresent';
  if (token.includes('player.bombardBattlePlans')) return 'bombardBattlePlans';
  if (token.includes('player.holdTheLineBattlePlans')) return 'holdTheLineBattlePlans';
  if (token.includes('player.searchAndDestroyBattlePlans')) return 'searchAndDestroyBattlePlans';
  if (token.includes('player.unitsShouldHunt')) return 'unitsShouldHunt';
  return null;
}

function mapCppMoneyField(method: string, argument: string): string | null {
  if (method === 'xferVersion') return 'version';
  if (method === 'xferUnsignedInt' && argument === 'm_money') return 'money';
  return null;
}

function mapTsMoneyField(token: string): string | null {
  if (token.includes('SOURCE_MONEY_SNAPSHOT_VERSION')) return 'version';
  if (token.includes('xferUnsignedInt')) return 'money';
  return null;
}

function mapCppEnergyField(method: string, argument: string): string | null {
  if (method === 'xferVersion') return 'version';
  if (method === 'xferInt' && argument === 'owningPlayerIndex') return 'owningPlayerIndex';
  if (method === 'xferUnsignedInt' && argument === 'm_powerSabotagedTillFrame') return 'powerSabotagedTillFrame';
  return null;
}

function mapTsEnergyField(token: string): string | null {
  if (token.includes('SOURCE_ENERGY_SNAPSHOT_VERSION')) return 'version';
  if (token.includes('energyPlayerIndex')) return 'owningPlayerIndex';
  if (token.includes('powerSabotagedTillFrame')) return 'powerSabotagedTillFrame';
  return null;
}

function mapCppScoreKeeperField(method: string, argument: string): string | null {
  if (method === 'xferVersion') return 'version';
  const mappings = new Map<string, string>([
    ['m_totalMoneyEarned', 'totalMoneyEarned'],
    ['m_totalMoneySpent', 'totalMoneySpent'],
    ['m_totalUnitsBuilt', 'totalUnitsBuilt'],
    ['m_totalUnitsLost', 'totalUnitsLost'],
    ['m_totalBuildingsBuilt', 'totalBuildingsBuilt'],
    ['m_totalBuildingsLost', 'totalBuildingsLost'],
    ['m_totalTechBuildingsCaptured', 'totalTechBuildingsCaptured'],
    ['m_totalFactionBuildingsCaptured', 'totalFactionBuildingsCaptured'],
    ['m_currentScore', 'currentScore'],
    ['m_myPlayerIdx', 'playerIndex'],
    ['destroyedArraySize', 'objectsDestroyedArraySize'],
  ]);
  if (method === 'xferUser' && argument.startsWith('m_totalUnitsDestroyed')) return 'totalUnitsDestroyed';
  if (method === 'xferUser' && argument.startsWith('m_totalBuildingsDestroyed')) return 'totalBuildingsDestroyed';
  return mappings.get(argument) ?? null;
}

function mapCppScoreKeeperMapField(argument: string): string | null {
  const mappings = new Map<string, string>([
    ['m_objectsBuilt', 'objectsBuilt.map'],
    ['m_objectsDestroyed[ i ]', 'objectsDestroyed.map'],
    ['m_objectsLost', 'objectsLost.map'],
    ['m_objectsCaptured', 'objectsCaptured.map'],
  ]);
  return mappings.get(argument) ?? null;
}

function mapTsScoreKeeperField(token: string, directIntField: string | undefined, mapField: string | undefined): string | null {
  if (token.includes('SOURCE_SCORE_KEEPER_SNAPSHOT_VERSION')) return 'version';
  if (token.includes('totalUnitsDestroyed.map')) return 'totalUnitsDestroyed';
  if (token.includes('totalBuildingsDestroyed.map')) return 'totalBuildingsDestroyed';
  if (token.includes('destroyedArraySize')) return 'objectsDestroyedArraySize';
  if (token.includes('objectsDestroyed[index]')) return 'objectsDestroyed.map';
  if (mapField) {
    const mappings = new Map<string, string>([
      ['objectsBuilt', 'objectsBuilt.map'],
      ['objectsLost', 'objectsLost.map'],
      ['objectsCaptured', 'objectsCaptured.map'],
    ]);
    return mappings.get(mapField) ?? null;
  }
  const mappings = new Map<string, string>([
    ['totalMoneyEarned', 'totalMoneyEarned'],
    ['totalMoneySpent', 'totalMoneySpent'],
    ['totalUnitsBuilt', 'totalUnitsBuilt'],
    ['totalUnitsLost', 'totalUnitsLost'],
    ['totalBuildingsBuilt', 'totalBuildingsBuilt'],
    ['totalBuildingsLost', 'totalBuildingsLost'],
    ['totalTechBuildingsCaptured', 'totalTechBuildingsCaptured'],
    ['totalFactionBuildingsCaptured', 'totalFactionBuildingsCaptured'],
    ['currentScore', 'currentScore'],
    ['playerIndex', 'playerIndex'],
  ]);
  return directIntField ? mappings.get(directIntField) ?? null : null;
}

function mapCppObjectIdListField(method: string, argument: string): string | null {
  if (method === 'xferVersion') return 'version';
  if (method === 'xferUnsignedShort' && argument === 'listCount') return 'count';
  if (method === 'xferObjectID' && argument === 'objectID') return 'objectId';
  return null;
}

function mapTsObjectIdListField(token: string): string | null {
  if (token.includes('SOURCE_OBJECT_ID_LINKED_LIST_VERSION')) return 'version';
  if (token.includes('xferUnsignedShort')) return 'count';
  if (token.includes('xferObjectID')) return 'objectId';
  return null;
}

function mapCppUpgradeField(method: string, argument: string): string | null {
  if (method === 'xferVersion') return 'version';
  if (method === 'xferUser' && argument.startsWith('m_status')) return 'status';
  return null;
}

function mapTsUpgradeField(token: string): string | null {
  if (token.includes('SOURCE_UPGRADE_SNAPSHOT_VERSION')) return 'version';
  if (token.includes('status')) return 'status';
  return null;
}

function mapCppPlayerRelationMapField(method: string, argument: string): string | null {
  if (method === 'xferVersion') return 'version';
  if (method === 'xferUnsignedShort' && argument === 'playerRelationCount') return 'relationCount';
  if (method === 'xferInt' && argument === 'playerIndex') return 'relation.playerIndex';
  if (method === 'xferUser' && argument.startsWith('r')) return 'relation.relationship';
  return null;
}

function mapTsPlayerRelationMapField(token: string): string | null {
  if (token.includes('SOURCE_PLAYER_RELATION_MAP_SNAPSHOT_VERSION')) return 'version';
  if (token.includes('entries.length')) return 'relationCount';
  if (token.includes('id') || token.includes('entry.id')) return 'relation.playerIndex';
  if (token.includes('relationship')) return 'relation.relationship';
  return null;
}

function mapCppTeamRelationMapField(method: string, argument: string): string | null {
  if (method === 'xferVersion') return 'version';
  if (method === 'xferUnsignedShort' && argument === 'teamRelationCount') return 'relationCount';
  if (method === 'xferUser' && argument.startsWith('teamID')) return 'relation.teamId';
  if (method === 'xferUser' && argument.startsWith('r')) return 'relation.relationship';
  return null;
}

function mapTsTeamRelationMapField(token: string): string | null {
  if (token.includes('SOURCE_PLAYER_RELATION_MAP_SNAPSHOT_VERSION')) return 'version';
  if (token.includes('entries.length')) return 'relationCount';
  if (token.includes('id') || token.includes('entry.id')) return 'relation.teamId';
  if (token.includes('relationship')) return 'relation.relationship';
  return null;
}

function mapCppBuildListInfoField(method: string, argument: string): string | null {
  if (method === 'xferVersion') return 'version';
  const mappings = new Map<string, string>([
    ['m_buildingName', 'buildingName'],
    ['m_templateName', 'templateName'],
    ['m_location', 'location'],
    ['m_rallyPointOffset', 'rallyPointOffset'],
    ['m_angle', 'angle'],
    ['m_isInitiallyBuilt', 'isInitiallyBuilt'],
    ['m_numRebuilds', 'numRebuilds'],
    ['m_script', 'script'],
    ['m_health', 'health'],
    ['m_whiner', 'whiner'],
    ['m_unsellable', 'unsellable'],
    ['m_repairable', 'repairable'],
    ['m_automaticallyBuild', 'automaticallyBuild'],
    ['m_objectID', 'objectId'],
    ['m_objectTimestamp', 'objectTimestamp'],
    ['m_underConstruction', 'underConstruction'],
    ['m_isSupplyBuilding', 'isSupplyBuilding'],
    ['m_desiredGatherers', 'desiredGatherers'],
    ['m_priorityBuild', 'priorityBuild'],
    ['m_currentGatherers', 'currentGatherers'],
  ]);
  if (method === 'xferUser' && argument.startsWith('m_resourceGatherers')) return 'resourceGatherers';
  return mappings.get(argument) ?? null;
}

function mapTsBuildListInfoField(token: string, directField: string | undefined): string | null {
  if (token.includes('SOURCE_BUILD_LIST_INFO_SNAPSHOT_VERSION')) return 'version';
  if (token.includes('xferSourceCoord2D')) return 'rallyPointOffset';
  if (token.includes('xferSourceFixedObjectIdArray')) return 'resourceGatherers';
  if (token.includes('currentGatherers')) return 'currentGatherers';
  const mappings = new Map<string, string>([
    ['buildingName', 'buildingName'],
    ['templateName', 'templateName'],
    ['location', 'location'],
    ['angle', 'angle'],
    ['isInitiallyBuilt', 'isInitiallyBuilt'],
    ['numRebuilds', 'numRebuilds'],
    ['script', 'script'],
    ['health', 'health'],
    ['whiner', 'whiner'],
    ['unsellable', 'unsellable'],
    ['repairable', 'repairable'],
    ['automaticallyBuild', 'automaticallyBuild'],
    ['objectId', 'objectId'],
    ['objectTimestamp', 'objectTimestamp'],
    ['underConstruction', 'underConstruction'],
    ['isSupplyBuilding', 'isSupplyBuilding'],
    ['desiredGatherers', 'desiredGatherers'],
    ['priorityBuild', 'priorityBuild'],
  ]);
  return directField ? mappings.get(directField) ?? null : null;
}

function mapCppResourceGatheringManagerField(method: string, argument: string): string | null {
  if (method === 'xferVersion') return 'version';
  if (method === 'xferSTLObjectIDList' && argument === 'm_supplyWarehouses') return 'supplyWarehouses.objectIdList';
  if (method === 'xferSTLObjectIDList' && argument === 'm_supplyCenters') return 'supplyCenters.objectIdList';
  return null;
}

function mapTsResourceGatheringManagerField(token: string): string | null {
  if (token.includes('SOURCE_RESOURCE_GATHERING_MANAGER_SNAPSHOT_VERSION')) return 'version';
  if (token.includes('supplyWarehouses')) return 'supplyWarehouses.objectIdList';
  if (token.includes('supplyCenters')) return 'supplyCenters.objectIdList';
  return null;
}

function mapCppTunnelTrackerField(method: string, argument: string): string | null {
  if (method === 'xferVersion') return 'version';
  if (method === 'xferSTLObjectIDList' && argument === 'm_tunnelIDs') return 'tunnelIds.objectIdList';
  if (method === 'xferInt' && argument === 'm_containListSize') return 'passengerCount';
  if (method === 'xferObjectID' && argument === 'objectID') return 'passenger.id';
  if (method === 'xferUnsignedInt' && argument === 'm_tunnelCount') return 'tunnelCount';
  return null;
}

function mapTsTunnelTrackerField(token: string): string | null {
  if (token.includes('SOURCE_TUNNEL_TRACKER_SNAPSHOT_VERSION')) return 'version';
  if (token.includes('xferSourceObjectIdLinkedList')) return 'tunnelIds.objectIdList';
  if (token.includes('passengerCount')) return 'passengerCount';
  if (token.includes('xferObjectID')) return 'passenger.id';
  if (token.includes('tunnelCount')) return 'tunnelCount';
  return null;
}

function mapCppSquadField(method: string, argument: string): string | null {
  if (method === 'xferVersion') return 'version';
  if (method === 'xferUnsignedShort' && argument === 'objectCount') return 'objectCount';
  if (method === 'xferObjectID' && argument === 'objectID') return 'objectId';
  return null;
}

function mapTsSquadField(token: string): string | null {
  if (token.includes('SOURCE_SQUAD_SNAPSHOT_VERSION')) return 'version';
  if (token.includes('xferUnsignedShort')) return 'objectCount';
  if (token.includes('xferObjectID')) return 'objectId';
  return null;
}

function mapCppWorkOrderField(method: string, argument: string): string | null {
  if (method === 'xferVersion') return 'version';
  const mappings = new Map<string, string>([
    ['thingTemplateName', 'templateName'],
    ['m_factoryID', 'factoryId'],
    ['m_numCompleted', 'numCompleted'],
    ['m_numRequired', 'numRequired'],
    ['m_required', 'required'],
    ['m_isResourceGatherer', 'isResourceGatherer'],
  ]);
  return mappings.get(argument) ?? null;
}

function mapTsWorkOrderField(token: string, directField: string | undefined): string | null {
  if (token.includes('SOURCE_WORK_ORDER_SNAPSHOT_VERSION')) return 'version';
  const mappings = new Map<string, string>([
    ['templateName', 'templateName'],
    ['factoryId', 'factoryId'],
    ['numCompleted', 'numCompleted'],
    ['numRequired', 'numRequired'],
    ['required', 'required'],
    ['isResourceGatherer', 'isResourceGatherer'],
  ]);
  return directField ? mappings.get(directField) ?? null : null;
}

function mapCppTeamInQueueField(method: string, argument: string): string | null {
  if (method === 'xferVersion') return 'version';
  if (method === 'xferUnsignedShort' && argument === 'workOrderCount') return 'workOrderCount';
  if (method === 'xferSnapshot' && argument === 'workOrder') return 'workOrder.snapshot';
  if (method === 'xferBool' && argument === 'm_priorityBuild') return 'priorityBuild';
  if (method === 'xferUser' && argument.startsWith('teamID')) return 'teamId';
  if (method === 'xferInt' && argument === 'm_frameStarted') return 'frameStarted';
  if (method === 'xferBool' && argument === 'm_sentToStartLocation') return 'sentToStartLocation';
  if (method === 'xferBool' && argument === 'm_stopQueueing') return 'stopQueueing';
  if (method === 'xferBool' && argument === 'm_reinforcement') return 'reinforcement';
  if (method === 'xferObjectID' && argument === 'm_reinforcementID') return 'reinforcementId';
  return null;
}

function mapTsTeamInQueueField(token: string, directField: string | undefined): string | null {
  if (token.includes('SOURCE_TEAM_IN_QUEUE_SNAPSHOT_VERSION')) return 'version';
  if (token.includes('workOrderCount')) return 'workOrderCount';
  if (token.includes('xferSourceWorkOrderState')) return 'workOrder.snapshot';
  const mappings = new Map<string, string>([
    ['priorityBuild', 'priorityBuild'],
    ['teamId', 'teamId'],
    ['frameStarted', 'frameStarted'],
    ['sentToStartLocation', 'sentToStartLocation'],
    ['stopQueueing', 'stopQueueing'],
    ['reinforcement', 'reinforcement'],
    ['reinforcementId', 'reinforcementId'],
  ]);
  return directField ? mappings.get(directField) ?? null : null;
}

function mapCppAiPlayerField(method: string, argument: string): string | null {
  if (method === 'xferVersion') return 'version';
  if (method === 'xferUnsignedShort' && argument === 'teamBuildQueueCount') return 'teamBuildQueueCount';
  if (method === 'xferUnsignedShort' && argument === 'teamReadyQueueCount') return 'teamReadyQueueCount';
  if (method === 'xferUser' && argument.startsWith('playerIndex')) return 'playerIndex';
  if (method === 'xferBool' && argument === 'm_readyToBuildTeam') return 'readyToBuildTeam';
  if (method === 'xferBool' && argument === 'm_readyToBuildStructure') return 'readyToBuildStructure';
  if (method === 'xferInt' && argument === 'm_teamTimer') return 'teamTimer';
  if (method === 'xferInt' && argument === 'm_structureTimer') return 'structureTimer';
  if (method === 'xferInt' && argument === 'm_buildDelay') return 'buildDelay';
  if (method === 'xferInt' && argument === 'm_teamDelay') return 'teamDelay';
  if (method === 'xferInt' && argument === 'm_teamSeconds') return 'teamSeconds';
  if (method === 'xferObjectID' && argument === 'm_curWarehouseID') return 'currentWarehouseId';
  if (method === 'xferInt' && argument === 'm_frameLastBuildingBuilt') return 'frameLastBuildingBuilt';
  if (method === 'xferUser' && argument.startsWith('m_difficulty')) return 'difficulty';
  if (method === 'xferInt' && argument === 'm_skillsetSelector') return 'skillsetSelector';
  if (method === 'xferCoord3D' && argument === 'm_baseCenter') return 'baseCenter';
  if (method === 'xferBool' && argument === 'm_baseCenterSet') return 'baseCenterSet';
  if (method === 'xferReal' && argument === 'm_baseRadius') return 'baseRadius';
  if (method === 'xferUser' && argument.startsWith('m_structuresToRepair')) return 'structuresToRepair';
  if (method === 'xferObjectID' && argument === 'm_repairDozer') return 'repairDozer';
  if (method === 'xferInt' && argument === 'm_structuresInQueue') return 'structuresInQueue';
  if (method === 'xferBool' && argument === 'm_dozerQueuedForRepair') return 'dozerQueuedForRepair';
  if (method === 'xferBool' && argument === 'm_dozerIsRepairing') return 'dozerIsRepairing';
  if (method === 'xferInt' && argument === 'm_bridgeTimer') return 'bridgeTimer';
  return null;
}

function mapTsAiPlayerField(token: string, directField: string | undefined): string | null {
  if (token.includes('SOURCE_AI_PLAYER_SNAPSHOT_VERSION')) return 'version';
  if (token.includes('teamBuildQueue.length')) return 'teamBuildQueueCount';
  if (token.includes('teamReadyQueue.length')) return 'teamReadyQueueCount';
  if (token.includes('savedPlayerIndex')) return 'playerIndex';
  if (token.includes('structuresToRepair')) return 'structuresToRepair';
  const mappings = new Map<string, string>([
    ['readyToBuildTeam', 'readyToBuildTeam'],
    ['readyToBuildStructure', 'readyToBuildStructure'],
    ['teamTimer', 'teamTimer'],
    ['structureTimer', 'structureTimer'],
    ['buildDelay', 'buildDelay'],
    ['teamDelay', 'teamDelay'],
    ['teamSeconds', 'teamSeconds'],
    ['currentWarehouseId', 'currentWarehouseId'],
    ['frameLastBuildingBuilt', 'frameLastBuildingBuilt'],
    ['difficulty', 'difficulty'],
    ['skillsetSelector', 'skillsetSelector'],
    ['baseCenter', 'baseCenter'],
    ['baseCenterSet', 'baseCenterSet'],
    ['baseRadius', 'baseRadius'],
    ['repairDozer', 'repairDozer'],
    ['structuresInQueue', 'structuresInQueue'],
    ['dozerQueuedForRepair', 'dozerQueuedForRepair'],
    ['dozerIsRepairing', 'dozerIsRepairing'],
    ['bridgeTimer', 'bridgeTimer'],
  ]);
  return directField ? mappings.get(directField) ?? null : null;
}

function mapCppAiSkirmishPlayerField(method: string, argument: string): string | null {
  if (method === 'xferVersion') return 'version';
  if (method === 'xferInt' && argument === 'm_curFrontBaseDefense') return 'curFrontBaseDefense';
  if (method === 'xferInt' && argument === 'm_curFlankBaseDefense') return 'curFlankBaseDefense';
  if (method === 'xferReal' && argument === 'm_curFrontLeftDefenseAngle') return 'curFrontLeftDefenseAngle';
  if (method === 'xferReal' && argument === 'm_curFrontRightDefenseAngle') return 'curFrontRightDefenseAngle';
  if (method === 'xferReal' && argument === 'm_curLeftFlankLeftDefenseAngle') return 'curLeftFlankLeftDefenseAngle';
  if (method === 'xferReal' && argument === 'm_curLeftFlankRightDefenseAngle') return 'curLeftFlankRightDefenseAngle';
  if (method === 'xferReal' && argument === 'm_curRightFlankLeftDefenseAngle') return 'curRightFlankLeftDefenseAngle';
  if (method === 'xferReal' && argument === 'm_curRightFlankRightDefenseAngle') return 'curRightFlankRightDefenseAngle';
  return null;
}

function mapTsAiSkirmishPlayerField(rawName: string): string | null {
  const mappings = new Map<string, string>([
    ['curFrontBaseDefense', 'curFrontBaseDefense'],
    ['curFlankBaseDefense', 'curFlankBaseDefense'],
    ['curFrontLeftDefenseAngle', 'curFrontLeftDefenseAngle'],
    ['curFrontRightDefenseAngle', 'curFrontRightDefenseAngle'],
    ['curLeftFlankLeftDefenseAngle', 'curLeftFlankLeftDefenseAngle'],
    ['curLeftFlankRightDefenseAngle', 'curLeftFlankRightDefenseAngle'],
    ['curRightFlankLeftDefenseAngle', 'curRightFlankLeftDefenseAngle'],
    ['curRightFlankRightDefenseAngle', 'curRightFlankRightDefenseAngle'],
  ]);
  return mappings.get(rawName) ?? null;
}

function mapCppSequentialScriptField(method: string, argument: string): string | null {
  if (method === 'xferVersion') return 'version';
  if (method === 'xferUser' && argument.startsWith('teamID')) return 'teamId';
  if (method === 'xferObjectID' && argument === 'm_objectID') return 'objectId';
  if (method === 'xferAsciiString' && argument === 'scriptName') return 'scriptName';
  if (method === 'xferInt' && argument === 'm_currentInstruction') return 'currentInstruction';
  if (method === 'xferInt' && argument === 'm_timesToLoop') return 'timesToLoop';
  if (method === 'xferInt' && argument === 'm_framesToWait') return 'framesToWait';
  if (method === 'xferBool' && argument === 'm_dontAdvanceInstruction') return 'dontAdvanceInstruction';
  return null;
}

function mapTsSequentialScriptField(token: string, directField: string | undefined): string | null {
  if (token.includes('xferVersion')) return 'version';
  const mappings = new Map<string, string>([
    ['teamId', 'teamId'],
    ['objectId', 'objectId'],
    ['scriptNameUpper', 'scriptName'],
    ['currentInstruction', 'currentInstruction'],
    ['timesToLoop', 'timesToLoop'],
    ['framesToWait', 'framesToWait'],
    ['dontAdvanceInstruction', 'dontAdvanceInstruction'],
  ]);
  return directField ? mappings.get(directField) ?? null : null;
}

function mapCppAttackPriorityInfoField(method: string, argument: string): string | null {
  if (method === 'xferVersion') return 'version';
  if (method === 'xferAsciiString' && argument === 'm_name') return 'name';
  if (method === 'xferInt' && argument === 'm_defaultPriority') return 'defaultPriority';
  if (method === 'xferUnsignedShort' && argument === 'priorityMapCount') return 'priorityMapCount';
  if (method === 'xferAsciiString' && argument === 'thingTemplateName') return 'priority.templateName';
  if (method === 'xferInt' && argument === 'priority') return 'priority.value';
  return null;
}

function mapTsAttackPriorityInfoField(token: string): string | null {
  if (token.includes('xferVersion')) return 'version';
  if (token.includes('resolvedName')) return 'name';
  if (token.includes('resolvedDefaultPriority')) return 'defaultPriority';
  if (token.includes('const count')) return 'priorityMapCount';
  if (token.includes('xferAsciiString')) return 'priority.templateName';
  if (token.includes('xferInt')) return 'priority.value';
  return null;
}

function mapCppScriptEngineBreezeField(method: string, argument: string): string | null {
  const mappings = new Map<string, string>([
    ['m_breezeInfo.m_direction', 'direction'],
    ['m_breezeInfo.m_directionVec.x', 'directionVec.x'],
    ['m_breezeInfo.m_directionVec.y', 'directionVec.y'],
    ['m_breezeInfo.m_lean', 'lean'],
    ['m_breezeInfo.m_randomness', 'randomness'],
    ['m_breezeInfo.m_breezePeriod', 'breezePeriod'],
    ['m_breezeInfo.m_breezeVersion', 'breezeVersion'],
  ]);
  return method === 'xferReal' || method === 'xferShort' ? mappings.get(argument) ?? null : null;
}

function mapTsScriptEngineBreezeField(token: string): string | null {
  if (token.includes("'direction'")) return 'direction';
  if (token.includes("'directionX'")) return 'directionVec.x';
  if (token.includes("'directionY'")) return 'directionVec.y';
  if (token.includes("'lean'")) return 'lean';
  if (token.includes("'randomness'")) return 'randomness';
  if (token.includes("'breezePeriodFrames'")) return 'breezePeriod';
  if (token.includes("'version'")) return 'breezeVersion';
  return null;
}

function mapCppScriptEngineStringListField(method: string, argument: string): string | null {
  if (method === 'xferVersion') return 'version';
  if (method === 'xferUnsignedShort' && argument === 'count') return 'count';
  if (method === 'xferAsciiString' && argument === 'string') return 'entry.string';
  return null;
}

function mapTsScriptEngineStringListField(token: string): string | null {
  if (token.includes('xferVersion')) return 'version';
  if (token.includes('xferUnsignedShort')) return 'count';
  if (token.includes('xferAsciiString')) return 'entry.string';
  return null;
}

function mapCppScriptEngineStringUIntListField(method: string, argument: string): string | null {
  if (method === 'xferVersion') return 'version';
  if (method === 'xferUnsignedShort' && argument === 'count') return 'count';
  if (method === 'xferAsciiString' && argument === 'string') return 'entry.string';
  if (method === 'xferUnsignedInt' && argument === 'unsignedIntData') return 'entry.unsignedInt';
  return null;
}

function mapTsScriptEngineStringUIntListField(token: string): string | null {
  if (token.includes('xferVersion')) return 'version';
  if (token.includes('xferUnsignedShort')) return 'count';
  if (token.includes('xferAsciiString')) return 'entry.string';
  if (token.includes('xferUnsignedInt')) return 'entry.unsignedInt';
  return null;
}

function mapCppScriptEngineStringObjectIdListField(method: string, argument: string): string | null {
  if (method === 'xferVersion') return 'version';
  if (method === 'xferUnsignedShort' && argument === 'count') return 'count';
  if (method === 'xferAsciiString' && argument === 'string') return 'entry.string';
  if (method === 'xferObjectID' && argument === 'objectID') return 'entry.objectId';
  return null;
}

function mapTsScriptEngineStringObjectIdListField(token: string): string | null {
  if (token.includes('xferVersion')) return 'version';
  if (token.includes('xferUnsignedShort')) return 'count';
  if (token.includes('xferAsciiString')) return 'entry.string';
  if (token.includes('xferObjectID')) return 'entry.objectId';
  return null;
}

function mapCppScriptEngineNamedObjectField(method: string, argument: string): string | null {
  if (method === 'xferUnsignedShort' && argument === 'namedObjectsCount') return 'count';
  if (method === 'xferAsciiString' && argument === 'namedObjectName') return 'entry.name';
  if (method === 'xferObjectID' && argument === 'objectID') return 'entry.objectId';
  return null;
}

function mapTsScriptEngineNamedObjectField(token: string): string | null {
  if (token.includes('xferAsciiString')) return 'entry.name';
  if (token.includes('xferObjectID')) return 'entry.objectId';
  return null;
}

function mapCppScienceVectorField(method: string, argument: string): string | null {
  if (method === 'xferVersion') return 'version';
  if (method === 'xferUnsignedShort' && argument === 'count') return 'count';
  if (method === 'xferScienceType' && argument === 'science') return 'entry.scienceName';
  return null;
}

function mapTsScienceVectorField(token: string): string | null {
  if (token.includes('xferVersion')) return 'version';
  if (token.includes('xferUnsignedShort')) return 'count';
  if (token.includes('xferAsciiString')) return 'entry.scienceName';
  return null;
}

function mapCppObjectTypesField(method: string, argument: string): string | null {
  if (method === 'xferVersion') return 'version';
  if (method === 'xferAsciiString' && argument === 'm_listName') return 'listName';
  if (method === 'xferUnsignedShort' && argument === 'objectTypesCount') return 'objectTypesCount';
  if (method === 'xferAsciiString' && argument === '*it') return 'entry.objectTypeName';
  if (method === 'xferAsciiString' && argument === 'typeName') return 'entry.objectTypeName';
  return null;
}

function mapTsObjectTypesField(token: string): string | null {
  if (token.includes('xferVersion')) return 'version';
  if (token.includes('resolvedListName')) return 'listName';
  if (token.includes('objectTypes.length')) return 'objectTypesCount';
  if (token.includes('xferAsciiString')) return 'entry.objectTypeName';
  return null;
}

function mapCppSourceScriptField(method: string, argument: string): string | null {
  if (method === 'xferVersion') return 'version';
  if (method === 'xferBool' && argument === 'active') return 'active';
  return null;
}

function mapTsSourceScriptField(token: string): string | null {
  if (token.includes('xferVersion')) return 'version';
  if (token.includes('scriptState.active')) return 'active';
  return null;
}

function mapCppSourceScriptGroupField(method: string, argument: string): string | null {
  if (method === 'xferVersion') return 'version';
  if (method === 'xferBool' && argument === 'm_isGroupActive') return 'active';
  if (method === 'xferUnsignedShort' && argument === 'scriptCount') return 'scriptCount';
  if (method === 'xferSnapshot' && (argument === 'script' || argument === 's_mtScript')) return 'script.snapshot';
  return null;
}

function mapTsSourceScriptGroupField(token: string): string | null {
  if (token.includes('xferVersion')) return 'version';
  if (token.includes('groupState.active')) return 'active';
  if (token.includes('groupState.scripts.length')) return 'scriptCount';
  if (token.includes('xferSourceScriptState')) return 'script.snapshot';
  return null;
}

function mapCppSourceScriptListField(method: string, argument: string): string | null {
  if (method === 'xferVersion') return 'version';
  if (method === 'xferUnsignedShort' && argument === 'scriptCount') return 'scriptCount';
  if (method === 'xferSnapshot' && (argument === 'script' || argument === 's_mtScript')) return 'script.snapshot';
  if (method === 'xferUnsignedShort' && argument === 'scriptGroupCount') return 'groupCount';
  if (method === 'xferSnapshot' && (argument === 'scriptGroup' || argument === 's_mtGroup')) return 'group.snapshot';
  return null;
}

function mapTsSourceScriptListField(token: string): string | null {
  if (token.includes('xferVersion')) return 'version';
  if (token.includes('scriptListState.scripts.length')) return 'scriptCount';
  if (token.includes('xferSourceScriptState')) return 'script.snapshot';
  if (token.includes('scriptListState.groups.length')) return 'groupCount';
  if (token.includes('xferSourceScriptGroupState')) return 'group.snapshot';
  return null;
}

function mapCppSidesListField(method: string, argument: string): string | null {
  if (method === 'xferVersion') return 'version';
  if (method === 'xferInt' && argument === 'sideCount') return 'sideCount';
  if (method === 'xferBool' && argument === 'scriptListPresent') return 'scriptList.present';
  if (method === 'xferSnapshot' && argument === 'scriptList') return 'scriptList.snapshot';
  return null;
}

function mapTsSidesListField(token: string): string | null {
  if (token.includes('xferVersion')) return 'version';
  if (token.includes('scriptLists.length')) return 'sideCount';
  if (token.includes('scriptListState.present')) return 'scriptList.present';
  if (token.includes('xferSourceScriptListState')) return 'scriptList.snapshot';
  return null;
}

function mapCppScriptEngineStringCoordListField(method: string, argument: string): string | null {
  if (method === 'xferVersion') return 'version';
  if (method === 'xferUnsignedShort' && argument === 'count') return 'count';
  if (method === 'xferAsciiString' && argument === 'string') return 'entry.string';
  if (method === 'xferCoord3D' && argument === 'coord') return 'entry.coord';
  return null;
}

function mapTsScriptEngineStringCoordListField(token: string): string | null {
  if (token.includes('xferVersion')) return 'version';
  if (token.includes('xferUnsignedShort')) return 'count';
  if (token.includes('xferAsciiString')) return 'entry.string';
  if (token.includes('xferCoord3D')) return 'entry.coord';
  return null;
}

function mapCppTeamTemplateInfoField(method: string, argument: string): string | null {
  if (method === 'xferVersion') return 'version';
  if (method === 'xferInt' && argument === 'm_productionPriority') return 'productionPriority';
  return null;
}

function mapTsTeamTemplateInfoField(token: string): string | null {
  if (token.includes('SOURCE_TEAM_TEMPLATE_INFO_SNAPSHOT_VERSION')) return 'version';
  if (token.includes('productionPriority')) return 'productionPriority';
  return null;
}

function mapCppTeamPrototypeField(method: string, argument: string): string | null {
  if (method === 'xferVersion') return 'version';
  if (method === 'xferInt' && argument === 'owningPlayerIndex') return 'owningPlayerIndex';
  if (method === 'xferAsciiString' && argument === 'm_attackPriorityName') return 'attackPriorityName';
  if (method === 'xferBool' && argument === 'm_productionConditionAlwaysFalse') return 'productionConditionAlwaysFalse';
  if (method === 'xferSnapshot' && argument === 'm_teamTemplate') return 'teamTemplateInfoSnapshot';
  if (method === 'xferUnsignedShort' && argument === 'teamInstanceCount') return 'teamInstanceCount';
  if (method === 'xferUser' && argument.startsWith('teamID')) return 'team.id';
  if (method === 'xferSnapshot' && argument === 'teamInstance') return 'team.snapshot';
  return null;
}

function mapTsTeamPrototypeField(token: string): string | null {
  if (token.includes('SOURCE_TEAM_PROTOTYPE_SNAPSHOT_VERSION')) return 'version';
  if (token.includes('ownerIndex')) return 'owningPlayerIndex';
  if (token.includes('attackPrioritySetName')) return 'attackPriorityName';
  if (token === 'xfer.xferBool(false)') return 'productionConditionAlwaysFalse';
  if (token.includes('SourceTeamTemplateInfoSnapshot')) return 'teamTemplateInfoSnapshot';
  if (token.includes('xfer.xferUnsignedShort')) return 'teamInstanceCount';
  if (token.includes('xfer.xferUnsignedInt')) return 'team.id';
  if (token.includes('SourceTeamSnapshot')) return 'team.snapshot';
  return null;
}

function mapCppTeamField(method: string, argument: string): string | null {
  if (method === 'xferVersion') return 'version';
  if (method === 'xferUser' && argument.startsWith('teamID')) return 'teamId';
  if (method === 'xferUnsignedShort' && argument === 'memberCount') return 'memberCount';
  if (method === 'xferObjectID' && argument === 'memberID') return 'member.id';
  if (method === 'xferAsciiString' && argument === 'm_state') return 'state';
  if (method === 'xferBool' && argument === 'm_enteredOrExited') return 'enteredOrExited';
  if (method === 'xferBool' && argument === 'm_active') return 'active';
  if (method === 'xferBool' && argument === 'm_created') return 'created';
  if (method === 'xferBool' && argument === 'm_checkEnemySighted') return 'checkEnemySighted';
  if (method === 'xferBool' && argument === 'm_seeEnemy') return 'seeEnemy';
  if (method === 'xferBool' && argument === 'm_prevSeeEnemy') return 'prevSeeEnemy';
  if (method === 'xferBool' && argument === 'm_wasIdle') return 'wasIdle';
  if (method === 'xferInt' && argument === 'm_destroyThreshold') return 'destroyThreshold';
  if (method === 'xferInt' && argument === 'm_curUnits') return 'curUnits';
  if (method === 'xferUnsignedInt' && argument === 'currentWaypointID') return 'currentWaypointId';
  if (method === 'xferUnsignedShort' && argument === 'shouldAttemptGenericScriptCount') return 'genericScriptCount';
  if (method === 'xferBool' && argument === 'm_shouldAttemptGenericScript[i]') return 'genericScript.shouldAttempt';
  if (method === 'xferBool' && argument === 'm_isRecruitablitySet') return 'isRecruitabilitySet';
  if (method === 'xferBool' && argument === 'm_isRecruitable') return 'isRecruitable';
  if (method === 'xferObjectID' && argument === 'm_commonAttackTarget') return 'commonAttackTarget';
  if (method === 'xferSnapshot' && argument === 'm_teamRelations') return 'teamRelations';
  if (method === 'xferSnapshot' && argument === 'm_playerRelations') return 'playerRelations';
  return null;
}

function mapTsTeamField(token: string): string | null {
  if (token.includes('SOURCE_TEAM_SNAPSHOT_VERSION')) return 'version';
  if (token.includes('const teamId')) return 'teamId';
  if (token.includes('xfer.xferUnsignedShort') && token.includes('memberIds')) return 'memberCount';
  if (token.includes('xfer.xferUnsignedShort') && token.includes('0')) return 'memberCount';
  if (token.includes('xfer.xferObjectID') && (token.includes('memberId') || token.includes('0'))) return 'member.id';
  if (token.includes('stateName')) return 'state';
  if (token.includes('this.team.created ||')) return 'active';
  if (token.includes('this.team.created =')) return 'created';
  if (token === 'xfer.xferInt(0)') return 'destroyThreshold';
  if (token.includes('memberEntityIds.size')) return 'curUnits';
  if (token === 'xfer.xferUnsignedInt(0)') return 'currentWaypointId';
  if (token.includes('GENERIC_SCRIPT_SLOT_COUNT')) return 'genericScriptCount';
  if (token === 'xfer.xferBool(true)') return 'genericScript.shouldAttempt';
  if (token.includes('hasRecruitableOverride')) return 'isRecruitabilitySet';
  if (token.includes('recruitableValue')) return 'isRecruitable';
  if (token.includes('SourceEmptyTeamRelationSnapshot')) return 'teamRelations';
  if (token.includes('SourceEmptyPlayerRelationSnapshot')) return 'playerRelations';
  return null;
}

// ── TS Port Extractors ──────────────────────────────────────────────────────

/**
 * Extract SOURCE_DAMAGE_TYPE_NAMES from the TS port's index.ts.
 */
export function parseTsDamageTypeNames(source: string): string[] {
  const match = source.match(
    /SOURCE_DAMAGE_TYPE_NAMES\s*(?::\s*readonly\s+string\[\])?\s*=\s*\[([\s\S]*?)\];/,
  );
  if (!match) return [];
  return extractQuotedStrings(match[1]!);
}

/**
 * Extract WEAPON_BONUS_CONDITION_BY_NAME keys from the TS port's index.ts.
 */
export function parseTsWeaponBonusConditionNames(source: string): string[] {
  const match = source.match(
    /WEAPON_BONUS_CONDITION_BY_NAME\s*=\s*new\s+Map\s*<[^>]*>\s*\(\s*\[([\s\S]*?)\]\s*\)/,
  );
  if (!match) return [];
  return extractQuotedStrings(match[1]!);
}

/**
 * Extract weapon field names read by resolveWeaponProfileFromDef in TS port.
 * Finds all readNumericField/readStringField/readBooleanField calls.
 */
export function parseTsWeaponFieldNames(source: string): string[] {
  // Find the resolveWeaponProfileFromDef method body
  const startIdx = source.indexOf('resolveWeaponProfileFromDef(weaponDef');
  if (startIdx === -1) return [];

  // Find the end of the method by looking for the next top-level method declaration
  const rest = source.slice(startIdx);
  const nextMethodMatch = rest.match(/\n {2}(?:private|public|protected)\s+\w+\s*\(/);
  const endOffset = nextMethodMatch?.index ?? 15000;
  const window = rest.slice(0, endOffset);

  const fieldNames = new Set<string>();

  // Match readNumericField/readStringField/readBooleanField with field name arrays
  const fieldRegex = /read(?:Numeric|String|Boolean)Field\s*\([^,]+,\s*\[([^\]]+)\]/g;
  let m;
  while ((m = fieldRegex.exec(window)) !== null) {
    for (const name of extractQuotedStrings(m[1]!)) {
      fieldNames.add(name);
    }
  }

  // Also match direct field access like weaponDef.fields['FieldName']
  const directRegex = /weaponDef\.fields\s*\[\s*'([^']+)'/g;
  while ((m = directRegex.exec(window)) !== null) {
    fieldNames.add(m[1]!);
  }

  return Array.from(fieldNames).sort();
}

// ── Comparison Logic ────────────────────────────────────────────────────────

export function compareDamageTypes(cppNames: string[], tsNames: string[]): ParityCategoryResult {
  const mismatches: ParityMismatch[] = [];

  // Check ordering for matching positions
  const minLen = Math.min(cppNames.length, tsNames.length);
  for (let i = 0; i < minLen; i++) {
    if (cppNames[i] !== tsNames[i]) {
      mismatches.push({
        category: 'damage-types',
        severity: 'error',
        message: `Position ${i}: C++ has "${cppNames[i]}" but TS has "${tsNames[i]}"`,
        cppValue: cppNames[i],
        tsValue: tsNames[i],
      });
    }
  }

  // Check for extra/missing entries
  if (cppNames.length > tsNames.length) {
    for (let i = tsNames.length; i < cppNames.length; i++) {
      mismatches.push({
        category: 'damage-types',
        severity: 'error',
        message: `Missing in TS: "${cppNames[i]}" at position ${i}`,
        cppValue: cppNames[i],
      });
    }
  } else if (tsNames.length > cppNames.length) {
    for (let i = cppNames.length; i < tsNames.length; i++) {
      mismatches.push({
        category: 'damage-types',
        severity: 'error',
        message: `Extra in TS: "${tsNames[i]}" at position ${i} (not in C++)`,
        tsValue: tsNames[i],
      });
    }
  }

  return {
    category: 'damage-types',
    status: mismatches.length === 0 ? 'match' : 'mismatch',
    mismatches,
  };
}

export function compareWeaponBonusConditions(
  _cppEnumValues: string[],
  cppNameStrings: string[],
  tsNames: string[],
): ParityCategoryResult {
  const mismatches: ParityMismatch[] = [];

  // Compare the TheWeaponBonusNames string array against TS map keys
  const tsSet = new Set(tsNames);
  const cppSet = new Set(cppNameStrings);

  for (const name of cppNameStrings) {
    if (name.includes('OBSOLETE')) continue;
    // SOLO_* difficulty bonuses now implemented in the browser port.
    if (name.startsWith('DEMORALIZED')) continue; // #ifdef'd out
    if (!tsSet.has(name)) {
      mismatches.push({
        category: 'weapon-bonus-conditions',
        severity: 'warning',
        message: `Missing in TS: "${name}" (present in C++ TheWeaponBonusNames)`,
        cppValue: name,
      });
    }
  }

  for (const name of tsNames) {
    if (!cppSet.has(name)) {
      mismatches.push({
        category: 'weapon-bonus-conditions',
        severity: 'warning',
        message: `Extra in TS: "${name}" (not in C++ TheWeaponBonusNames)`,
        tsValue: name,
      });
    }
  }

  return {
    category: 'weapon-bonus-conditions',
    status: mismatches.length === 0 ? 'match' : mismatches.some((m) => m.severity === 'error') ? 'mismatch' : 'partial',
    mismatches,
  };
}

export function compareWeaponFields(cppFields: string[], tsFields: string[]): ParityCategoryResult {
  const mismatches: ParityMismatch[] = [];
  const tsSet = new Set(tsFields);
  const cppSet = new Set(cppFields);

  // Fields that are visual-only or not relevant for game logic parity
  const visualOnlyFields = new Set([
    'FireSound', 'FireSoundLoopTime', 'FireFX', 'ProjectileDetonationFX',
    'FireOCL', 'ProjectileDetonationOCL', 'ProjectileExhaust',
    'VeterancyFireFX', 'VeterancyProjectileDetonationFX',
    'VeterancyFireOCL', 'VeterancyProjectileDetonationOCL',
    'VeterancyProjectileExhaust',
    'WeaponRecoil', 'ShowsAmmoPips', 'PlayFXWhenStealthed',
    'SuspendFXDelay', 'ProjectileStreamName',
  ]);

  for (const field of cppFields) {
    if (visualOnlyFields.has(field)) continue;
    if (!tsSet.has(field)) {
      mismatches.push({
        category: 'weapon-fields',
        severity: 'warning',
        message: `C++ weapon field "${field}" not read by TS resolveWeaponProfileFromDef`,
        cppValue: field,
      });
    }
  }

  for (const field of tsFields) {
    if (!cppSet.has(field)) {
      mismatches.push({
        category: 'weapon-fields',
        severity: 'info',
        message: `TS reads "${field}" which is not in C++ WeaponTemplateFieldParseTable (may be an alias)`,
        tsValue: field,
      });
    }
  }

  return {
    category: 'weapon-fields',
    status: mismatches.length === 0 ? 'match' : mismatches.some((m) => m.severity === 'error') ? 'mismatch' : 'partial',
    mismatches,
  };
}

export function compareSaveSnapshotBlockOrder(cppNames: string[], tsNames: string[]): ParityCategoryResult {
  return compareOrderedStrings('save-snapshot-block-order', cppNames, tsNames);
}

export function compareSaveGameInfoFields(cppFields: string[], tsFields: string[]): ParityCategoryResult {
  return compareOrderedStrings('save-game-info-fields', cppFields, tsFields);
}

export function compareGameStateMapFields(cppFields: string[], tsFields: string[]): ParityCategoryResult {
  return compareOrderedStrings('save-game-state-map-fields', cppFields, tsFields);
}

export function compareSkirmishGameInfoFields(cppFields: string[], tsFields: string[]): ParityCategoryResult {
  return compareOrderedStrings('save-skirmish-game-info-fields', cppFields, tsFields);
}

export function compareCampaignManagerFields(cppFields: string[], tsFields: string[]): ParityCategoryResult {
  return compareOrderedStrings('save-campaign-manager-fields', cppFields, tsFields);
}

export function compareTerrainLogicFields(cppFields: string[], tsFields: string[]): ParityCategoryResult {
  return compareOrderedStrings('save-terrain-logic-fields', cppFields, tsFields);
}

export function compareTacticalViewFields(cppFields: string[], tsFields: string[]): ParityCategoryResult {
  return compareOrderedStrings('save-tactical-view-fields', cppFields, tsFields);
}

export function compareInGameUiFields(cppFields: string[], tsFields: string[]): ParityCategoryResult {
  return compareOrderedStrings('save-in-game-ui-fields', cppFields, tsFields);
}

export function compareGameLogicObjectTocFields(cppFields: string[], tsFields: string[]): ParityCategoryResult {
  return compareOrderedStrings('save-game-logic-object-toc-fields', cppFields, tsFields);
}

export function compareBuildAssistantSellListFields(cppFields: string[], tsFields: string[]): ParityCategoryResult {
  return compareOrderedStrings('save-build-assistant-sell-list-fields', cppFields, tsFields);
}

export function compareGameLogicBuildableOverrideMapFields(
  cppFields: string[],
  tsFields: string[],
): ParityCategoryResult {
  return compareOrderedStrings('save-game-logic-buildable-overrides-fields', cppFields, tsFields);
}

export function compareGameLogicControlBarOverrideMapFields(
  cppFields: string[],
  tsFields: string[],
): ParityCategoryResult {
  return compareOrderedStrings('save-game-logic-control-bar-overrides-fields', cppFields, tsFields);
}

export function compareGameLogicFields(cppFields: string[], tsFields: string[]): ParityCategoryResult {
  return compareOrderedStrings('save-game-logic-fields', cppFields, tsFields);
}

export function compareObjectModuleListFields(cppFields: string[], tsFields: string[]): ParityCategoryResult {
  return compareOrderedStrings('save-object-module-list-fields', cppFields, tsFields);
}

export function compareObjectFields(cppFields: string[], tsFields: string[]): ParityCategoryResult {
  return compareOrderedStrings('save-object-fields', cppFields, tsFields);
}

export function compareMatrix3DFields(cppFields: string[], tsFields: string[]): ParityCategoryResult {
  return compareOrderedStrings('save-matrix3d-fields', cppFields, tsFields);
}

export function compareGeometryInfoFields(cppFields: string[], tsFields: string[]): ParityCategoryResult {
  return compareOrderedStrings('save-geometry-info-fields', cppFields, tsFields);
}

export function compareSightingInfoFields(cppFields: string[], tsFields: string[]): ParityCategoryResult {
  return compareOrderedStrings('save-sighting-info-fields', cppFields, tsFields);
}

export function compareExperienceTrackerFields(cppFields: string[], tsFields: string[]): ParityCategoryResult {
  return compareOrderedStrings('save-experience-tracker-fields', cppFields, tsFields);
}

export function compareBitFlagsFields(cppFields: string[], tsFields: string[]): ParityCategoryResult {
  return compareOrderedStrings('save-bit-flags-fields', cppFields, tsFields);
}

export function compareWeaponSaveFields(cppFields: string[], tsFields: string[]): ParityCategoryResult {
  return compareOrderedStrings('save-weapon-fields', cppFields, tsFields);
}

export function compareWeaponSetFields(cppFields: string[], tsFields: string[]): ParityCategoryResult {
  return compareOrderedStrings('save-weapon-set-fields', cppFields, tsFields);
}

export function compareDrawableFields(cppFields: string[], tsFields: string[]): ParityCategoryResult {
  return compareOrderedStrings('save-drawable-fields', cppFields, tsFields);
}

export function compareGameClientFields(cppFields: string[], tsFields: string[]): ParityCategoryResult {
  return compareOrderedStrings('save-game-client-fields', cppFields, tsFields);
}

export function compareTerrainVisualFields(cppFields: string[], tsFields: string[]): ParityCategoryResult {
  return compareOrderedStrings('save-terrain-visual-fields', cppFields, tsFields);
}

export function compareWaterRenderObjectFields(cppFields: string[], tsFields: string[]): ParityCategoryResult {
  return compareOrderedStrings('save-water-render-object-fields', cppFields, tsFields);
}

export function compareHeightMapRenderObjectFields(cppFields: string[], tsFields: string[]): ParityCategoryResult {
  return compareOrderedStrings('save-height-map-render-object-fields', cppFields, tsFields);
}

export function compareW3DTreeBufferFields(cppFields: string[], tsFields: string[]): ParityCategoryResult {
  return compareOrderedStrings('save-w3d-tree-buffer-fields', cppFields, tsFields);
}

export function compareW3DPropBufferFields(cppFields: string[], tsFields: string[]): ParityCategoryResult {
  return compareOrderedStrings('save-w3d-prop-buffer-fields', cppFields, tsFields);
}

export function compareGhostObjectManagerFields(cppFields: string[], tsFields: string[]): ParityCategoryResult {
  return compareOrderedStrings('save-ghost-object-manager-fields', cppFields, tsFields);
}

export function compareGhostObjectFields(cppFields: string[], tsFields: string[]): ParityCategoryResult {
  return compareOrderedStrings('save-ghost-object-fields', cppFields, tsFields);
}

export function compareW3DRenderObjectSnapshotFields(cppFields: string[], tsFields: string[]): ParityCategoryResult {
  return compareOrderedStrings('save-w3d-render-object-snapshot-fields', cppFields, tsFields);
}

export function compareParticleSystemManagerFields(cppFields: string[], tsFields: string[]): ParityCategoryResult {
  return compareOrderedStrings('save-particle-system-manager-fields', cppFields, tsFields);
}

export function compareParticleSystemInfoFields(cppFields: string[], tsFields: string[]): ParityCategoryResult {
  return compareOrderedStrings('save-particle-system-info-fields', cppFields, tsFields);
}

export function compareParticleSystemFields(cppFields: string[], tsFields: string[]): ParityCategoryResult {
  return compareOrderedStrings('save-particle-system-fields', cppFields, tsFields);
}

export function compareParticleFields(cppFields: string[], tsFields: string[]): ParityCategoryResult {
  return compareOrderedStrings('save-particle-fields', cppFields, tsFields);
}

export function compareSourceModuleBaseFields(cppFields: string[], tsFields: string[]): ParityCategoryResult {
  return compareOrderedStrings('save-module-base-fields', cppFields, tsFields);
}

export function compareSourceObjectModuleBaseFields(cppFields: string[], tsFields: string[]): ParityCategoryResult {
  return compareOrderedStrings('save-object-module-base-fields', cppFields, tsFields);
}

export function compareSourceDrawableModuleBaseFields(cppFields: string[], tsFields: string[]): ParityCategoryResult {
  return compareOrderedStrings('save-drawable-module-base-fields', cppFields, tsFields);
}

export function compareSourceDrawModuleBaseFields(cppFields: string[], tsFields: string[]): ParityCategoryResult {
  return compareOrderedStrings('save-draw-module-base-fields', cppFields, tsFields);
}

export function compareSourceBehaviorModuleBaseFields(cppFields: string[], tsFields: string[]): ParityCategoryResult {
  return compareOrderedStrings('save-behavior-module-base-fields', cppFields, tsFields);
}

export function compareSourceUpdateModuleBaseFields(cppFields: string[], tsFields: string[]): ParityCategoryResult {
  return compareOrderedStrings('save-update-module-base-fields', cppFields, tsFields);
}

export function compareSourceBodyModuleBaseFields(cppFields: string[], tsFields: string[]): ParityCategoryResult {
  return compareOrderedStrings('save-body-module-base-fields', cppFields, tsFields);
}

export function compareSourceCollideModuleBaseFields(cppFields: string[], tsFields: string[]): ParityCategoryResult {
  return compareOrderedStrings('save-collide-module-base-fields', cppFields, tsFields);
}

export function compareSourceDieModuleBaseFields(cppFields: string[], tsFields: string[]): ParityCategoryResult {
  return compareOrderedStrings('save-die-module-base-fields', cppFields, tsFields);
}

export function compareSourceDamageModuleBaseFields(cppFields: string[], tsFields: string[]): ParityCategoryResult {
  return compareOrderedStrings('save-damage-module-base-fields', cppFields, tsFields);
}

export function compareSourceCreateModuleFields(cppFields: string[], tsFields: string[]): ParityCategoryResult {
  return compareOrderedStrings('save-create-module-fields', cppFields, tsFields);
}

export function compareSourceSpecialPowerModuleFields(cppFields: string[], tsFields: string[]): ParityCategoryResult {
  return compareOrderedStrings('save-special-power-module-fields', cppFields, tsFields);
}

export function compareSourceW3DDrawModuleFields(
  category: string,
  cppFields: string[],
  tsFields: string[],
): ParityCategoryResult {
  return compareOrderedStrings(category, cppFields, tsFields);
}

export function compareSourceObjectUpdateFields(
  category: string,
  cppFields: string[],
  tsFields: string[],
): ParityCategoryResult {
  return compareOrderedStrings(category, cppFields, tsFields);
}

export function compareRadarFields(cppFields: string[], tsFields: string[]): ParityCategoryResult {
  return compareOrderedStrings('save-radar-fields', cppFields, tsFields);
}

export function comparePartitionFields(cppFields: string[], tsFields: string[]): ParityCategoryResult {
  return compareOrderedStrings('save-partition-fields', cppFields, tsFields);
}

export function compareTeamFactoryFields(cppFields: string[], tsFields: string[]): ParityCategoryResult {
  return compareOrderedStrings('save-team-factory-fields', cppFields, tsFields);
}

export function comparePlayerListFields(cppFields: string[], tsFields: string[]): ParityCategoryResult {
  return compareOrderedStrings('save-player-list-fields', cppFields, tsFields);
}

export function comparePlayerFields(cppFields: string[], tsFields: string[]): ParityCategoryResult {
  return compareOrderedStrings('save-player-fields', cppFields, tsFields);
}

export function compareMoneyFields(cppFields: string[], tsFields: string[]): ParityCategoryResult {
  return compareOrderedStrings('save-money-fields', cppFields, tsFields);
}

export function compareEnergyFields(cppFields: string[], tsFields: string[]): ParityCategoryResult {
  return compareOrderedStrings('save-energy-fields', cppFields, tsFields);
}

export function compareScoreKeeperFields(cppFields: string[], tsFields: string[]): ParityCategoryResult {
  return compareOrderedStrings('save-score-keeper-fields', cppFields, tsFields);
}

export function compareObjectIdListFields(cppFields: string[], tsFields: string[]): ParityCategoryResult {
  return compareOrderedStrings('save-object-id-list-fields', cppFields, tsFields);
}

export function compareUpgradeFields(cppFields: string[], tsFields: string[]): ParityCategoryResult {
  return compareOrderedStrings('save-upgrade-fields', cppFields, tsFields);
}

export function comparePlayerRelationMapFields(cppFields: string[], tsFields: string[]): ParityCategoryResult {
  return compareOrderedStrings('save-player-relation-map-fields', cppFields, tsFields);
}

export function compareTeamRelationMapFields(cppFields: string[], tsFields: string[]): ParityCategoryResult {
  return compareOrderedStrings('save-team-relation-map-fields', cppFields, tsFields);
}

export function compareBuildListInfoFields(cppFields: string[], tsFields: string[]): ParityCategoryResult {
  return compareOrderedStrings('save-build-list-info-fields', cppFields, tsFields);
}

export function compareResourceGatheringManagerFields(cppFields: string[], tsFields: string[]): ParityCategoryResult {
  return compareOrderedStrings('save-resource-gathering-manager-fields', cppFields, tsFields);
}

export function compareTunnelTrackerFields(cppFields: string[], tsFields: string[]): ParityCategoryResult {
  return compareOrderedStrings('save-tunnel-tracker-fields', cppFields, tsFields);
}

export function compareSquadFields(cppFields: string[], tsFields: string[]): ParityCategoryResult {
  return compareOrderedStrings('save-squad-fields', cppFields, tsFields);
}

export function compareWorkOrderFields(cppFields: string[], tsFields: string[]): ParityCategoryResult {
  return compareOrderedStrings('save-work-order-fields', cppFields, tsFields);
}

export function compareTeamInQueueFields(cppFields: string[], tsFields: string[]): ParityCategoryResult {
  return compareOrderedStrings('save-team-in-queue-fields', cppFields, tsFields);
}

export function compareAiPlayerFields(cppFields: string[], tsFields: string[]): ParityCategoryResult {
  return compareOrderedStrings('save-ai-player-fields', cppFields, tsFields);
}

export function compareAiSkirmishPlayerFields(cppFields: string[], tsFields: string[]): ParityCategoryResult {
  return compareOrderedStrings('save-ai-skirmish-player-fields', cppFields, tsFields);
}

export function compareSequentialScriptFields(cppFields: string[], tsFields: string[]): ParityCategoryResult {
  return compareOrderedStrings('save-script-engine-sequential-script-fields', cppFields, tsFields);
}

export function compareAttackPriorityInfoFields(cppFields: string[], tsFields: string[]): ParityCategoryResult {
  return compareOrderedStrings('save-script-engine-attack-priority-fields', cppFields, tsFields);
}

export function compareScriptEngineBreezeFields(cppFields: string[], tsFields: string[]): ParityCategoryResult {
  return compareOrderedStrings('save-script-engine-breeze-fields', cppFields, tsFields);
}

export function compareScriptEngineStringListFields(cppFields: string[], tsFields: string[]): ParityCategoryResult {
  return compareOrderedStrings('save-script-engine-string-list-fields', cppFields, tsFields);
}

export function compareScriptEngineStringUIntListFields(cppFields: string[], tsFields: string[]): ParityCategoryResult {
  return compareOrderedStrings('save-script-engine-string-uint-list-fields', cppFields, tsFields);
}

export function compareScriptEngineStringObjectIdListFields(
  cppFields: string[],
  tsFields: string[],
): ParityCategoryResult {
  return compareOrderedStrings('save-script-engine-string-object-id-list-fields', cppFields, tsFields);
}

export function compareScriptEngineNamedObjectFields(cppFields: string[], tsFields: string[]): ParityCategoryResult {
  return compareOrderedStrings('save-script-engine-named-object-fields', cppFields, tsFields);
}

export function compareScienceVectorFields(cppFields: string[], tsFields: string[]): ParityCategoryResult {
  return compareOrderedStrings('save-science-vector-fields', cppFields, tsFields);
}

export function compareScriptEngineScienceVectorFields(cppFields: string[], tsFields: string[]): ParityCategoryResult {
  return compareOrderedStrings('save-script-engine-science-vector-fields', cppFields, tsFields);
}

export function compareScriptEngineObjectTypeListFields(cppFields: string[], tsFields: string[]): ParityCategoryResult {
  return compareOrderedStrings('save-script-engine-object-type-list-fields', cppFields, tsFields);
}

export function compareSourceScriptFields(cppFields: string[], tsFields: string[]): ParityCategoryResult {
  return compareOrderedStrings('save-source-script-fields', cppFields, tsFields);
}

export function compareSourceScriptGroupFields(cppFields: string[], tsFields: string[]): ParityCategoryResult {
  return compareOrderedStrings('save-source-script-group-fields', cppFields, tsFields);
}

export function compareSourceScriptListFields(cppFields: string[], tsFields: string[]): ParityCategoryResult {
  return compareOrderedStrings('save-source-script-list-fields', cppFields, tsFields);
}

export function compareSidesListFields(cppFields: string[], tsFields: string[]): ParityCategoryResult {
  return compareOrderedStrings('save-sides-list-fields', cppFields, tsFields);
}

export function compareScriptEngineStringCoordListFields(cppFields: string[], tsFields: string[]): ParityCategoryResult {
  return compareOrderedStrings('save-script-engine-string-coord-list-fields', cppFields, tsFields);
}

export function compareTeamTemplateInfoFields(cppFields: string[], tsFields: string[]): ParityCategoryResult {
  return compareOrderedStrings('save-team-template-info-fields', cppFields, tsFields);
}

export function compareTeamPrototypeFields(cppFields: string[], tsFields: string[]): ParityCategoryResult {
  return compareOrderedStrings('save-team-prototype-fields', cppFields, tsFields);
}

export function compareTeamFields(cppFields: string[], tsFields: string[]): ParityCategoryResult {
  return compareOrderedStrings('save-team-fields', cppFields, tsFields);
}

function compareOrderedStrings(category: string, cppValues: string[], tsValues: string[]): ParityCategoryResult {
  const mismatches: ParityMismatch[] = [];
  const maxLength = Math.max(cppValues.length, tsValues.length);
  for (let index = 0; index < maxLength; index += 1) {
    const cppValue = cppValues[index];
    const tsValue = tsValues[index];
    if (cppValue === tsValue) {
      continue;
    }
    mismatches.push({
      category,
      severity: 'error',
      message: `Position ${index}: C++ has "${cppValue ?? '<missing>'}" but TS has "${tsValue ?? '<missing>'}"`,
      cppValue,
      tsValue,
    });
  }

  return {
    category,
    status: mismatches.length === 0 ? 'match' : 'mismatch',
    mismatches,
  };
}

// ── Report Builder ──────────────────────────────────────────────────────────

export function buildSourceParityReport(categories: ParityCategoryResult[]): SourceParityReport {
  const totalMismatches = categories.reduce((sum, c) => sum + c.mismatches.length, 0);
  const errors = categories.reduce(
    (sum, c) => sum + c.mismatches.filter((m) => m.severity === 'error').length,
    0,
  );
  const warnings = categories.reduce(
    (sum, c) => sum + c.mismatches.filter((m) => m.severity === 'warning').length,
    0,
  );
  const passingCategories = categories.filter((c) => c.status === 'match').length;
  const failingCategories = categories.filter((c) => c.status === 'mismatch').length;

  return {
    generatedAt: new Date().toISOString(),
    status: errors > 0 ? 'fail' : 'pass',
    summary: {
      totalCategories: categories.length,
      passingCategories,
      failingCategories,
      totalMismatches,
      errors,
      warnings,
    },
    categories,
  };
}

export function formatReportMarkdown(report: SourceParityReport): string {
  const lines: string[] = [
    '# Source Truth Parity Report',
    '',
    `Generated: ${report.generatedAt}`,
    `Status: **${report.status.toUpperCase()}**`,
    '',
    '## Summary',
    '',
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Categories | ${report.summary.totalCategories} |`,
    `| Passing | ${report.summary.passingCategories} |`,
    `| Failing | ${report.summary.failingCategories} |`,
    `| Total Mismatches | ${report.summary.totalMismatches} |`,
    `| Errors | ${report.summary.errors} |`,
    `| Warnings | ${report.summary.warnings} |`,
    '',
  ];

  for (const category of report.categories) {
    const icon = category.status === 'match' ? 'PASS' : category.status === 'mismatch' ? 'FAIL' : 'WARN';
    lines.push(`## ${icon}: ${category.category}`);
    lines.push('');

    if (category.mismatches.length === 0) {
      lines.push('No mismatches found.');
    } else {
      for (const mismatch of category.mismatches) {
        const prefix = mismatch.severity === 'error' ? '[ERROR]' : mismatch.severity === 'warning' ? '[WARN]' : '[INFO]';
        lines.push(`- ${prefix} ${mismatch.message}`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ── Main ────────────────────────────────────────────────────────────────────

export async function runSourceParityCheck(rootDir: string): Promise<SourceParityReport> {
  const repoRoot = path.resolve(rootDir, '..');

  // Read C++ source files (prefer ZH/GeneralsMD variant)
  const zhDamageCpp = await readFileOrEmpty(
    path.join(repoRoot, 'GeneralsMD/Code/GameEngine/Source/GameLogic/System/Damage.cpp'),
  );
  const zhDamageH = await readFileOrEmpty(
    path.join(repoRoot, 'GeneralsMD/Code/GameEngine/Include/GameLogic/Damage.h'),
  );
  const genDamageH = await readFileOrEmpty(
    path.join(repoRoot, 'Generals/Code/GameEngine/Include/GameLogic/Damage.h'),
  );
  const zhWeaponH = await readFileOrEmpty(
    path.join(repoRoot, 'GeneralsMD/Code/GameEngine/Include/GameLogic/Weapon.h'),
  );
  const genWeaponH = await readFileOrEmpty(
    path.join(repoRoot, 'Generals/Code/GameEngine/Include/GameLogic/Weapon.h'),
  );
  const zhWeaponCpp = await readFileOrEmpty(
    path.join(repoRoot, 'GeneralsMD/Code/GameEngine/Source/GameLogic/Object/Weapon.cpp'),
  );
  const genWeaponCpp = await readFileOrEmpty(
    path.join(repoRoot, 'Generals/Code/GameEngine/Source/GameLogic/Object/Weapon.cpp'),
  );
  const zhGameStateCpp = await readFileOrEmpty(
    path.join(repoRoot, 'GeneralsMD/Code/GameEngine/Source/Common/System/SaveGame/GameState.cpp'),
  );
  const genGameStateCpp = await readFileOrEmpty(
    path.join(repoRoot, 'Generals/Code/GameEngine/Source/Common/System/SaveGame/GameState.cpp'),
  );
  const zhGameStateMapCpp = await readFileOrEmpty(
    path.join(repoRoot, 'GeneralsMD/Code/GameEngine/Source/Common/System/SaveGame/GameStateMap.cpp'),
  );
  const genGameStateMapCpp = await readFileOrEmpty(
    path.join(repoRoot, 'Generals/Code/GameEngine/Source/Common/System/SaveGame/GameStateMap.cpp'),
  );
  const zhGameInfoCpp = await readFileOrEmpty(
    path.join(repoRoot, 'GeneralsMD/Code/GameEngine/Source/GameNetwork/GameInfo.cpp'),
  );
  const genGameInfoCpp = await readFileOrEmpty(
    path.join(repoRoot, 'Generals/Code/GameEngine/Source/GameNetwork/GameInfo.cpp'),
  );
  const zhCampaignManagerCpp = await readFileOrEmpty(
    path.join(repoRoot, 'GeneralsMD/Code/GameEngine/Source/GameClient/System/CampaignManager.cpp'),
  );
  const genCampaignManagerCpp = await readFileOrEmpty(
    path.join(repoRoot, 'Generals/Code/GameEngine/Source/GameClient/System/CampaignManager.cpp'),
  );
  const zhTerrainLogicCpp = await readFileOrEmpty(
    path.join(repoRoot, 'GeneralsMD/Code/GameEngine/Source/GameLogic/Map/TerrainLogic.cpp'),
  );
  const genTerrainLogicCpp = await readFileOrEmpty(
    path.join(repoRoot, 'Generals/Code/GameEngine/Source/GameLogic/Map/TerrainLogic.cpp'),
  );
  const zhViewCpp = await readFileOrEmpty(
    path.join(repoRoot, 'GeneralsMD/Code/GameEngine/Source/GameClient/View.cpp'),
  );
  const genViewCpp = await readFileOrEmpty(
    path.join(repoRoot, 'Generals/Code/GameEngine/Source/GameClient/View.cpp'),
  );
  const zhInGameUiCpp = await readFileOrEmpty(
    path.join(repoRoot, 'GeneralsMD/Code/GameEngine/Source/GameClient/InGameUI.cpp'),
  );
  const genInGameUiCpp = await readFileOrEmpty(
    path.join(repoRoot, 'Generals/Code/GameEngine/Source/GameClient/InGameUI.cpp'),
  );
  const zhGameClientCpp = await readFileOrEmpty(
    path.join(repoRoot, 'GeneralsMD/Code/GameEngine/Source/GameClient/GameClient.cpp'),
  );
  const genGameClientCpp = await readFileOrEmpty(
    path.join(repoRoot, 'Generals/Code/GameEngine/Source/GameClient/GameClient.cpp'),
  );
  const zhParticleSysCpp = await readFileOrEmpty(
    path.join(repoRoot, 'GeneralsMD/Code/GameEngine/Source/GameClient/System/ParticleSys.cpp'),
  );
  const genParticleSysCpp = await readFileOrEmpty(
    path.join(repoRoot, 'Generals/Code/GameEngine/Source/GameClient/System/ParticleSys.cpp'),
  );
  const zhModuleCpp = await readFileOrEmpty(
    path.join(repoRoot, 'GeneralsMD/Code/GameEngine/Source/Common/Thing/Module.cpp'),
  );
  const genModuleCpp = await readFileOrEmpty(
    path.join(repoRoot, 'Generals/Code/GameEngine/Source/Common/Thing/Module.cpp'),
  );
  const zhDrawModuleCpp = await readFileOrEmpty(
    path.join(repoRoot, 'GeneralsMD/Code/GameEngine/Source/Common/Thing/DrawModule.cpp'),
  );
  const genDrawModuleCpp = await readFileOrEmpty(
    path.join(repoRoot, 'Generals/Code/GameEngine/Source/Common/Thing/DrawModule.cpp'),
  );
  const zhBehaviorModuleCpp = await readFileOrEmpty(
    path.join(repoRoot, 'GeneralsMD/Code/GameEngine/Source/GameLogic/Object/Behavior/BehaviorModule.cpp'),
  );
  const genBehaviorModuleCpp = await readFileOrEmpty(
    path.join(repoRoot, 'Generals/Code/GameEngine/Source/GameLogic/Object/Behavior/BehaviorModule.cpp'),
  );
  const zhUpdateModuleCpp = await readFileOrEmpty(
    path.join(repoRoot, 'GeneralsMD/Code/GameEngine/Source/GameLogic/Object/Update/UpdateModule.cpp'),
  );
  const genUpdateModuleCpp = await readFileOrEmpty(
    path.join(repoRoot, 'Generals/Code/GameEngine/Source/GameLogic/Object/Update/UpdateModule.cpp'),
  );
  const zhBodyModuleCpp = await readFileOrEmpty(
    path.join(repoRoot, 'GeneralsMD/Code/GameEngine/Source/GameLogic/Object/Body/BodyModule.cpp'),
  );
  const genBodyModuleCpp = await readFileOrEmpty(
    path.join(repoRoot, 'Generals/Code/GameEngine/Source/GameLogic/Object/Body/BodyModule.cpp'),
  );
  const zhCollideModuleCpp = await readFileOrEmpty(
    path.join(repoRoot, 'GeneralsMD/Code/GameEngine/Source/GameLogic/Object/Collide/CollideModule.cpp'),
  );
  const genCollideModuleCpp = await readFileOrEmpty(
    path.join(repoRoot, 'Generals/Code/GameEngine/Source/GameLogic/Object/Collide/CollideModule.cpp'),
  );
  const zhDieModuleCpp = await readFileOrEmpty(
    path.join(repoRoot, 'GeneralsMD/Code/GameEngine/Source/GameLogic/Object/Die/DieModule.cpp'),
  );
  const genDieModuleCpp = await readFileOrEmpty(
    path.join(repoRoot, 'Generals/Code/GameEngine/Source/GameLogic/Object/Die/DieModule.cpp'),
  );
  const zhDamageModuleCpp = await readFileOrEmpty(
    path.join(repoRoot, 'GeneralsMD/Code/GameEngine/Source/GameLogic/Object/Damage/DamageModule.cpp'),
  );
  const genDamageModuleCpp = await readFileOrEmpty(
    path.join(repoRoot, 'Generals/Code/GameEngine/Source/GameLogic/Object/Damage/DamageModule.cpp'),
  );
  const zhCreateModuleCpp = await readFileOrEmpty(
    path.join(repoRoot, 'GeneralsMD/Code/GameEngine/Source/GameLogic/Object/Create/CreateModule.cpp'),
  );
  const genCreateModuleCpp = await readFileOrEmpty(
    path.join(repoRoot, 'Generals/Code/GameEngine/Source/GameLogic/Object/Create/CreateModule.cpp'),
  );
  const zhSpecialPowerModuleCpp = await readFileOrEmpty(
    path.join(repoRoot, 'GeneralsMD/Code/GameEngine/Source/GameLogic/Object/SpecialPower/SpecialPowerModule.cpp'),
  );
  const genSpecialPowerModuleCpp = await readFileOrEmpty(
    path.join(repoRoot, 'Generals/Code/GameEngine/Source/GameLogic/Object/SpecialPower/SpecialPowerModule.cpp'),
  );
  const w3dDrawFiles = [
    'W3DDefaultDraw.cpp',
    'W3DDependencyModelDraw.cpp',
    'W3DDebrisDraw.cpp',
    'W3DLaserDraw.cpp',
    'W3DModelDraw.cpp',
    'W3DOverlordAircraftDraw.cpp',
    'W3DOverlordTankDraw.cpp',
    'W3DOverlordTruckDraw.cpp',
    'W3DPoliceCarDraw.cpp',
    'W3DProjectileStreamDraw.cpp',
    'W3DPropDraw.cpp',
    'W3DRopeDraw.cpp',
    'W3DScienceModelDraw.cpp',
    'W3DSupplyDraw.cpp',
    'W3DTankDraw.cpp',
    'W3DTankTruckDraw.cpp',
    'W3DTracerDraw.cpp',
    'W3DTreeDraw.cpp',
    'W3DTruckDraw.cpp',
  ];
  const zhW3DDrawCpp = (await Promise.all(w3dDrawFiles.map((fileName) =>
    readFileOrEmpty(path.join(
      repoRoot,
      'GeneralsMD/Code/GameEngineDevice/Source/W3DDevice/GameClient/Drawable/Draw',
      fileName,
    )),
  ))).join('\n');
  const genW3DDrawCpp = (await Promise.all(w3dDrawFiles.map((fileName) =>
    readFileOrEmpty(path.join(
      repoRoot,
      'Generals/Code/GameEngineDevice/Source/W3DDevice/GameClient/Drawable/Draw',
      fileName,
    )),
  ))).join('\n');
  const drawableClientUpdateFiles = [
    'AnimatedParticleSysBoneClientUpdate.cpp',
    'BeaconClientUpdate.cpp',
    'SwayClientUpdate.cpp',
  ];
  const zhDrawableClientUpdateCpp = (await Promise.all(drawableClientUpdateFiles.map((fileName) =>
    readFileOrEmpty(path.join(
      repoRoot,
      'GeneralsMD/Code/GameEngine/Source/GameClient/Drawable/Update',
      fileName,
    )),
  ))).join('\n');
  const genDrawableClientUpdateCpp = (await Promise.all(drawableClientUpdateFiles.map((fileName) =>
    readFileOrEmpty(path.join(
      repoRoot,
      'Generals/Code/GameEngine/Source/GameClient/Drawable/Update',
      fileName,
    )),
  ))).join('\n');
  const zhLaserUpdateCpp = await readFileOrEmpty(
    path.join(repoRoot, 'GeneralsMD/Code/GameEngine/Source/GameLogic/Object/Update/LaserUpdate.cpp'),
  );
  const genLaserUpdateCpp = await readFileOrEmpty(
    path.join(repoRoot, 'Generals/Code/GameEngine/Source/GameLogic/Object/Update/LaserUpdate.cpp'),
  );
  const objectUpdateFiles = [
    'AutoFindHealingUpdate.cpp',
    'AutoDepositUpdate.cpp',
    'AnimationSteeringUpdate.cpp',
    'BaseRenerateUpdate.cpp',
    'BattlePlanUpdate.cpp',
    'BoneFXUpdate.cpp',
    'CheckpointUpdate.cpp',
    'CleanupHazardUpdate.cpp',
    'CommandButtonHuntUpdate.cpp',
    'DeletionUpdate.cpp',
    'DemoTrapUpdate.cpp',
    'DockUpdate/DockUpdate.cpp',
    'DockUpdate/PrisonDockUpdate.cpp',
    'DockUpdate/RailedTransportDockUpdate.cpp',
    'DockUpdate/RepairDockUpdate.cpp',
    'DockUpdate/SupplyCenterDockUpdate.cpp',
    'DockUpdate/SupplyWarehouseDockUpdate.cpp',
    'DynamicGeometryInfoUpdate.cpp',
    'DynamicShroudClearingRangeUpdate.cpp',
    'EMPUpdate.cpp',
    'EnemyNearUpdate.cpp',
    'FireWeaponUpdate.cpp',
    'FireOCLAfterWeaponCooldownUpdate.cpp',
    'FireSpreadUpdate.cpp',
    'FirestormDynamicGeometryInfoUpdate.cpp',
    'FlammableUpdate.cpp',
    'FloatUpdate.cpp',
    'HeightDieUpdate.cpp',
    'HijackerUpdate.cpp',
    'HordeUpdate.cpp',
    'LifetimeUpdate.cpp',
    'MissileLauncherBuildingUpdate.cpp',
    'MobMemberSlavedUpdate.cpp',
    'NeutronMissileUpdate.cpp',
    'OCLUpdate.cpp',
    'PilotFindVehicleUpdate.cpp',
    'PointDefenseLaserUpdate.cpp',
    'PowerPlantUpdate.cpp',
    'ProjectileStreamUpdate.cpp',
    'ParticleUplinkCannonUpdate.cpp',
    'ProneUpdate.cpp',
    'ProductionExitUpdate/DefaultProductionExitUpdate.cpp',
    'ProductionExitUpdate/QueueProductionExitUpdate.cpp',
    'ProductionExitUpdate/SpawnPointProductionExitUpdate.cpp',
    'ProductionExitUpdate/SupplyCenterProductionExitUpdate.cpp',
    'ProductionUpdate.cpp',
    'RadiusDecalUpdate.cpp',
    'RadarUpdate.cpp',
    'SmartBombTargetHomingUpdate.cpp',
    'SlavedUpdate.cpp',
    'SpectreGunshipUpdate.cpp',
    'SpectreGunshipDeploymentUpdate.cpp',
    'SpecialAbilityUpdate.cpp',
    'SpyVisionUpdate.cpp',
    'StealthDetectorUpdate.cpp',
    'StealthUpdate.cpp',
    'StickyBombUpdate.cpp',
    'StructureCollapseUpdate.cpp',
    'StructureToppleUpdate.cpp',
    'TensileFormationUpdate.cpp',
    'ToppleUpdate.cpp',
    'WaveGuideUpdate.cpp',
    'WeaponBonusUpdate.cpp',
    '../Upgrade/UpgradeModule.cpp',
  ];
  const zhObjectUpdateCpp = (await Promise.all(objectUpdateFiles.map((fileName) =>
    readFileOrEmpty(path.join(
      repoRoot,
      'GeneralsMD/Code/GameEngine/Source/GameLogic/Object/Update',
      fileName,
    )),
  ))).join('\n');
  const genObjectUpdateCpp = (await Promise.all(objectUpdateFiles.map((fileName) =>
    readFileOrEmpty(path.join(
      repoRoot,
      'Generals/Code/GameEngine/Source/GameLogic/Object/Update',
      fileName,
    )),
  ))).join('\n');
  const zhTerrainVisualCpp = await readFileOrEmpty(
    path.join(repoRoot, 'GeneralsMD/Code/GameEngine/Source/GameClient/Terrain/TerrainVisual.cpp'),
  );
  const genTerrainVisualCpp = await readFileOrEmpty(
    path.join(repoRoot, 'Generals/Code/GameEngine/Source/GameClient/Terrain/TerrainVisual.cpp'),
  );
  const zhW3DTerrainVisualCpp = await readFileOrEmpty(
    path.join(repoRoot, 'GeneralsMD/Code/GameEngineDevice/Source/W3DDevice/GameClient/W3DTerrainVisual.cpp'),
  );
  const genW3DTerrainVisualCpp = await readFileOrEmpty(
    path.join(repoRoot, 'Generals/Code/GameEngineDevice/Source/W3DDevice/GameClient/W3DTerrainVisual.cpp'),
  );
  const zhW3DWaterCpp = await readFileOrEmpty(
    path.join(repoRoot, 'GeneralsMD/Code/GameEngineDevice/Source/W3DDevice/GameClient/Water/W3DWater.cpp'),
  );
  const genW3DWaterCpp = await readFileOrEmpty(
    path.join(repoRoot, 'Generals/Code/GameEngineDevice/Source/W3DDevice/GameClient/Water/W3DWater.cpp'),
  );
  const zhBaseHeightMapCpp = await readFileOrEmpty(
    path.join(repoRoot, 'GeneralsMD/Code/GameEngineDevice/Source/W3DDevice/GameClient/BaseHeightMap.cpp'),
  );
  const genBaseHeightMapCpp = await readFileOrEmpty(
    path.join(repoRoot, 'Generals/Code/GameEngineDevice/Source/W3DDevice/GameClient/BaseHeightMap.cpp'),
  );
  const zhW3DTreeBufferCpp = await readFileOrEmpty(
    path.join(repoRoot, 'GeneralsMD/Code/GameEngineDevice/Source/W3DDevice/GameClient/W3DTreeBuffer.cpp'),
  );
  const genW3DTreeBufferCpp = await readFileOrEmpty(
    path.join(repoRoot, 'Generals/Code/GameEngineDevice/Source/W3DDevice/GameClient/W3DTreeBuffer.cpp'),
  );
  const zhW3DPropBufferCpp = await readFileOrEmpty(
    path.join(repoRoot, 'GeneralsMD/Code/GameEngineDevice/Source/W3DDevice/GameClient/W3DPropBuffer.cpp'),
  );
  const genW3DPropBufferCpp = await readFileOrEmpty(
    path.join(repoRoot, 'Generals/Code/GameEngineDevice/Source/W3DDevice/GameClient/W3DPropBuffer.cpp'),
  );
  const zhW3DGhostObjectCpp = await readFileOrEmpty(
    path.join(repoRoot, 'GeneralsMD/Code/GameEngineDevice/Source/W3DDevice/GameLogic/W3DGhostObject.cpp'),
  );
  const genW3DGhostObjectCpp = await readFileOrEmpty(
    path.join(repoRoot, 'Generals/Code/GameEngineDevice/Source/W3DDevice/GameLogic/W3DGhostObject.cpp'),
  );
  const zhGhostObjectCpp = await readFileOrEmpty(
    path.join(repoRoot, 'GeneralsMD/Code/GameEngine/Source/GameLogic/Object/GhostObject.cpp'),
  );
  const genGhostObjectCpp = await readFileOrEmpty(
    path.join(repoRoot, 'Generals/Code/GameEngine/Source/GameLogic/Object/GhostObject.cpp'),
  );
  const zhGameLogicCpp = await readFileOrEmpty(
    path.join(repoRoot, 'GeneralsMD/Code/GameEngine/Source/GameLogic/System/GameLogic.cpp'),
  );
  const genGameLogicCpp = await readFileOrEmpty(
    path.join(repoRoot, 'Generals/Code/GameEngine/Source/GameLogic/System/GameLogic.cpp'),
  );
  const zhObjectCpp = await readFileOrEmpty(
    path.join(repoRoot, 'GeneralsMD/Code/GameEngine/Source/GameLogic/Object/Object.cpp'),
  );
  const genObjectCpp = await readFileOrEmpty(
    path.join(repoRoot, 'Generals/Code/GameEngine/Source/GameLogic/Object/Object.cpp'),
  );
  const zhGeometryCpp = await readFileOrEmpty(
    path.join(repoRoot, 'GeneralsMD/Code/GameEngine/Source/Common/System/Geometry.cpp'),
  );
  const genGeometryCpp = await readFileOrEmpty(
    path.join(repoRoot, 'Generals/Code/GameEngine/Source/Common/System/Geometry.cpp'),
  );
  const zhExperienceTrackerCpp = await readFileOrEmpty(
    path.join(repoRoot, 'GeneralsMD/Code/GameEngine/Source/GameLogic/Object/ExperienceTracker.cpp'),
  );
  const genExperienceTrackerCpp = await readFileOrEmpty(
    path.join(repoRoot, 'Generals/Code/GameEngine/Source/GameLogic/Object/ExperienceTracker.cpp'),
  );
  const zhWeaponSetCpp = await readFileOrEmpty(
    path.join(repoRoot, 'GeneralsMD/Code/GameEngine/Source/GameLogic/Object/WeaponSet.cpp'),
  );
  const genWeaponSetCpp = await readFileOrEmpty(
    path.join(repoRoot, 'Generals/Code/GameEngine/Source/GameLogic/Object/WeaponSet.cpp'),
  );
  const zhDrawableCpp = await readFileOrEmpty(
    path.join(repoRoot, 'GeneralsMD/Code/GameEngine/Source/GameClient/Drawable.cpp'),
  );
  const genDrawableCpp = await readFileOrEmpty(
    path.join(repoRoot, 'Generals/Code/GameEngine/Source/GameClient/Drawable.cpp'),
  );
  const zhBitFlagsIoH = await readFileOrEmpty(
    path.join(repoRoot, 'GeneralsMD/Code/GameEngine/Include/Common/BitFlagsIO.h'),
  );
  const genBitFlagsIoH = await readFileOrEmpty(
    path.join(repoRoot, 'Generals/Code/GameEngine/Include/Common/BitFlagsIO.h'),
  );
  const zhBuildAssistantCpp = await readFileOrEmpty(
    path.join(repoRoot, 'GeneralsMD/Code/GameEngine/Source/Common/System/BuildAssistant.cpp'),
  );
  const genBuildAssistantCpp = await readFileOrEmpty(
    path.join(repoRoot, 'Generals/Code/GameEngine/Source/Common/System/BuildAssistant.cpp'),
  );
  const zhRadarCpp = await readFileOrEmpty(
    path.join(repoRoot, 'GeneralsMD/Code/GameEngine/Source/Common/System/Radar.cpp'),
  );
  const genRadarCpp = await readFileOrEmpty(
    path.join(repoRoot, 'Generals/Code/GameEngine/Source/Common/System/Radar.cpp'),
  );
  const zhPartitionManagerCpp = await readFileOrEmpty(
    path.join(repoRoot, 'GeneralsMD/Code/GameEngine/Source/GameLogic/Object/PartitionManager.cpp'),
  );
  const genPartitionManagerCpp = await readFileOrEmpty(
    path.join(repoRoot, 'Generals/Code/GameEngine/Source/GameLogic/Object/PartitionManager.cpp'),
  );
  const zhTeamCpp = await readFileOrEmpty(
    path.join(repoRoot, 'GeneralsMD/Code/GameEngine/Source/Common/RTS/Team.cpp'),
  );
  const genTeamCpp = await readFileOrEmpty(
    path.join(repoRoot, 'Generals/Code/GameEngine/Source/Common/RTS/Team.cpp'),
  );
  const zhPlayerListCpp = await readFileOrEmpty(
    path.join(repoRoot, 'GeneralsMD/Code/GameEngine/Source/Common/RTS/PlayerList.cpp'),
  );
  const genPlayerListCpp = await readFileOrEmpty(
    path.join(repoRoot, 'Generals/Code/GameEngine/Source/Common/RTS/PlayerList.cpp'),
  );
  const zhPlayerCpp = await readFileOrEmpty(
    path.join(repoRoot, 'GeneralsMD/Code/GameEngine/Source/Common/RTS/Player.cpp'),
  );
  const genPlayerCpp = await readFileOrEmpty(
    path.join(repoRoot, 'Generals/Code/GameEngine/Source/Common/RTS/Player.cpp'),
  );
  const zhMoneyCpp = await readFileOrEmpty(
    path.join(repoRoot, 'GeneralsMD/Code/GameEngine/Source/Common/RTS/Money.cpp'),
  );
  const genMoneyCpp = await readFileOrEmpty(
    path.join(repoRoot, 'Generals/Code/GameEngine/Source/Common/RTS/Money.cpp'),
  );
  const zhEnergyCpp = await readFileOrEmpty(
    path.join(repoRoot, 'GeneralsMD/Code/GameEngine/Source/Common/RTS/Energy.cpp'),
  );
  const genEnergyCpp = await readFileOrEmpty(
    path.join(repoRoot, 'Generals/Code/GameEngine/Source/Common/RTS/Energy.cpp'),
  );
  const zhScoreKeeperCpp = await readFileOrEmpty(
    path.join(repoRoot, 'GeneralsMD/Code/GameEngine/Source/Common/RTS/ScoreKeeper.cpp'),
  );
  const genScoreKeeperCpp = await readFileOrEmpty(
    path.join(repoRoot, 'Generals/Code/GameEngine/Source/Common/RTS/ScoreKeeper.cpp'),
  );
  const zhXferCpp = await readFileOrEmpty(
    path.join(repoRoot, 'GeneralsMD/Code/GameEngine/Source/Common/System/Xfer.cpp'),
  );
  const genXferCpp = await readFileOrEmpty(
    path.join(repoRoot, 'Generals/Code/GameEngine/Source/Common/System/Xfer.cpp'),
  );
  const zhObjectTypesCpp = await readFileOrEmpty(
    path.join(repoRoot, 'GeneralsMD/Code/GameEngine/Source/GameLogic/Object/ObjectTypes.cpp'),
  );
  const genObjectTypesCpp = await readFileOrEmpty(
    path.join(repoRoot, 'Generals/Code/GameEngine/Source/GameLogic/Object/ObjectTypes.cpp'),
  );
  const zhUpgradeCpp = await readFileOrEmpty(
    path.join(repoRoot, 'GeneralsMD/Code/GameEngine/Source/Common/System/Upgrade.cpp'),
  );
  const genUpgradeCpp = await readFileOrEmpty(
    path.join(repoRoot, 'Generals/Code/GameEngine/Source/Common/System/Upgrade.cpp'),
  );
  const zhSidesListCpp = await readFileOrEmpty(
    path.join(repoRoot, 'GeneralsMD/Code/GameEngine/Source/GameLogic/Map/SidesList.cpp'),
  );
  const genSidesListCpp = await readFileOrEmpty(
    path.join(repoRoot, 'Generals/Code/GameEngine/Source/GameLogic/Map/SidesList.cpp'),
  );
  const zhResourceGatheringManagerCpp = await readFileOrEmpty(
    path.join(repoRoot, 'GeneralsMD/Code/GameEngine/Source/Common/RTS/ResourceGatheringManager.cpp'),
  );
  const genResourceGatheringManagerCpp = await readFileOrEmpty(
    path.join(repoRoot, 'Generals/Code/GameEngine/Source/Common/RTS/ResourceGatheringManager.cpp'),
  );
  const zhTunnelTrackerCpp = await readFileOrEmpty(
    path.join(repoRoot, 'GeneralsMD/Code/GameEngine/Source/Common/RTS/TunnelTracker.cpp'),
  );
  const genTunnelTrackerCpp = await readFileOrEmpty(
    path.join(repoRoot, 'Generals/Code/GameEngine/Source/Common/RTS/TunnelTracker.cpp'),
  );
  const zhSquadCpp = await readFileOrEmpty(
    path.join(repoRoot, 'GeneralsMD/Code/GameEngine/Source/GameLogic/AI/Squad.cpp'),
  );
  const genSquadCpp = await readFileOrEmpty(
    path.join(repoRoot, 'Generals/Code/GameEngine/Source/GameLogic/AI/Squad.cpp'),
  );
  const zhAiPlayerCpp = await readFileOrEmpty(
    path.join(repoRoot, 'GeneralsMD/Code/GameEngine/Source/GameLogic/AI/AIPlayer.cpp'),
  );
  const genAiPlayerCpp = await readFileOrEmpty(
    path.join(repoRoot, 'Generals/Code/GameEngine/Source/GameLogic/AI/AIPlayer.cpp'),
  );
  const zhAiSkirmishPlayerCpp = await readFileOrEmpty(
    path.join(repoRoot, 'GeneralsMD/Code/GameEngine/Source/GameLogic/AI/AISkirmishPlayer.cpp'),
  );
  const genAiSkirmishPlayerCpp = await readFileOrEmpty(
    path.join(repoRoot, 'Generals/Code/GameEngine/Source/GameLogic/AI/AISkirmishPlayer.cpp'),
  );
  const zhScriptEngineCpp = await readFileOrEmpty(
    path.join(repoRoot, 'GeneralsMD/Code/GameEngine/Source/GameLogic/ScriptEngine/ScriptEngine.cpp'),
  );
  const genScriptEngineCpp = await readFileOrEmpty(
    path.join(repoRoot, 'Generals/Code/GameEngine/Source/GameLogic/ScriptEngine/ScriptEngine.cpp'),
  );
  const zhScriptsCpp = await readFileOrEmpty(
    path.join(repoRoot, 'GeneralsMD/Code/GameEngine/Source/GameLogic/ScriptEngine/Scripts.cpp'),
  );
  const genScriptsCpp = await readFileOrEmpty(
    path.join(repoRoot, 'Generals/Code/GameEngine/Source/GameLogic/ScriptEngine/Scripts.cpp'),
  );

  // Read TS port source
  const tsIndexPath = path.join(rootDir, 'packages/game-logic/src/index.ts');
  const tsIndex = await readFileOrEmpty(tsIndexPath);
  const tsRuntimeSavePath = path.join(rootDir, 'packages/app/src/runtime-save-game.ts');
  const tsRuntimeSave = await readFileOrEmpty(tsRuntimeSavePath);
  const tsRuntimeParticleSystemPath = path.join(rootDir, 'packages/app/src/runtime-particle-system-save.ts');
  const tsRuntimeParticleSystem = await readFileOrEmpty(tsRuntimeParticleSystemPath);
  const tsEntityXferPath = path.join(rootDir, 'packages/game-logic/src/entity-xfer.ts');
  const tsEntityXfer = await readFileOrEmpty(tsEntityXferPath);
  const tsRuntimeTeamFactoryPath = path.join(rootDir, 'packages/app/src/runtime-team-factory-save.ts');
  const tsRuntimeTeamFactory = await readFileOrEmpty(tsRuntimeTeamFactoryPath);

  const categories: ParityCategoryResult[] = [];

  // A. Damage Types — use ZH if available, else Generals
  const cppDamageSource = zhDamageCpp || zhDamageH || genDamageH;
  const cppDamageNames = parseCppDamageTypeNames(cppDamageSource);
  const tsDamageNames = parseTsDamageTypeNames(tsIndex);
  if (cppDamageNames.length > 0 && tsDamageNames.length > 0) {
    categories.push(compareDamageTypes(cppDamageNames, tsDamageNames));
  }

  // B. Weapon Bonus Conditions — use ZH if available
  const weaponBonusSource = zhWeaponH || genWeaponH;
  const cppBonusEnumValues = parseCppWeaponBonusEnumValues(weaponBonusSource);
  const cppBonusNames = parseCppWeaponBonusNames(weaponBonusSource);
  const tsBonusNames = parseTsWeaponBonusConditionNames(tsIndex);
  if (cppBonusNames.length > 0 && tsBonusNames.length > 0) {
    categories.push(compareWeaponBonusConditions(cppBonusEnumValues, cppBonusNames, tsBonusNames));
  }

  // C. Weapon Fields — use ZH parse table
  const weaponFieldSource = zhWeaponCpp || genWeaponCpp;
  const cppWeaponFields = parseCppWeaponFieldNames(weaponFieldSource);
  const tsWeaponFields = parseTsWeaponFieldNames(tsIndex);
  if (cppWeaponFields.length > 0 && tsWeaponFields.length > 0) {
    categories.push(compareWeaponFields(cppWeaponFields, tsWeaponFields));
  }

  // D. Save GameState chunk order and SaveGameInfo field ABI
  const gameStateSource = zhGameStateCpp || genGameStateCpp;
  const cppSaveBlocks = parseCppSaveSnapshotBlockNames(gameStateSource);
  const tsSaveBlocks = parseTsSaveSnapshotBlockNames(tsRuntimeSave);
  if (cppSaveBlocks.length > 0 && tsSaveBlocks.length > 0) {
    categories.push(compareSaveSnapshotBlockOrder(cppSaveBlocks, tsSaveBlocks));
  }

  const cppSaveGameInfoFields = parseCppSaveGameInfoXferFields(gameStateSource);
  const tsSaveGameInfoFields = parseTsSaveGameInfoXferFields(tsRuntimeSave);
  if (cppSaveGameInfoFields.length > 0 && tsSaveGameInfoFields.length > 0) {
    categories.push(compareSaveGameInfoFields(cppSaveGameInfoFields, tsSaveGameInfoFields));
  }

  const gameStateMapSource = zhGameStateMapCpp || genGameStateMapCpp;
  const cppGameStateMapFields = parseCppGameStateMapXferFields(gameStateMapSource);
  const tsGameStateMapFields = parseTsGameStateMapXferFields(tsRuntimeSave);
  if (cppGameStateMapFields.length > 0 && tsGameStateMapFields.length > 0) {
    categories.push(compareGameStateMapFields(cppGameStateMapFields, tsGameStateMapFields));
  }

  const gameInfoSource = zhGameInfoCpp || genGameInfoCpp;
  const cppSkirmishGameInfoFields = parseCppSkirmishGameInfoXferFields(gameInfoSource);
  const tsSkirmishGameInfoFields = parseTsSkirmishGameInfoXferFields(tsRuntimeSave);
  if (cppSkirmishGameInfoFields.length > 0 && tsSkirmishGameInfoFields.length > 0) {
    categories.push(compareSkirmishGameInfoFields(cppSkirmishGameInfoFields, tsSkirmishGameInfoFields));
  }

  const campaignManagerSource = zhCampaignManagerCpp || genCampaignManagerCpp;
  const cppCampaignManagerFields = parseCppCampaignManagerXferFields(campaignManagerSource);
  const tsCampaignManagerFields = parseTsCampaignManagerXferFields(tsRuntimeSave);
  if (cppCampaignManagerFields.length > 0 && tsCampaignManagerFields.length > 0) {
    categories.push(compareCampaignManagerFields(cppCampaignManagerFields, tsCampaignManagerFields));
  }

  const terrainLogicSource = zhTerrainLogicCpp || genTerrainLogicCpp;
  const cppTerrainLogicFields = parseCppTerrainLogicXferFields(terrainLogicSource);
  const tsTerrainLogicFields = parseTsTerrainLogicXferFields(tsRuntimeSave);
  if (cppTerrainLogicFields.length > 0 && tsTerrainLogicFields.length > 0) {
    categories.push(compareTerrainLogicFields(cppTerrainLogicFields, tsTerrainLogicFields));
  }

  const viewSource = zhViewCpp || genViewCpp;
  const cppTacticalViewFields = parseCppTacticalViewXferFields(viewSource);
  const tsTacticalViewFields = parseTsTacticalViewXferFields(tsRuntimeSave);
  if (cppTacticalViewFields.length > 0 && tsTacticalViewFields.length > 0) {
    categories.push(compareTacticalViewFields(cppTacticalViewFields, tsTacticalViewFields));
  }

  const inGameUiSource = zhInGameUiCpp || genInGameUiCpp;
  const cppInGameUiFields = parseCppInGameUiXferFields(inGameUiSource);
  const tsInGameUiFields = parseTsInGameUiXferFields(tsRuntimeSave);
  if (cppInGameUiFields.length > 0 && tsInGameUiFields.length > 0) {
    categories.push(compareInGameUiFields(cppInGameUiFields, tsInGameUiFields));
  }

  const gameLogicSource = zhGameLogicCpp || genGameLogicCpp;
  const cppGameLogicObjectTocFields = parseCppGameLogicObjectTocXferFields(gameLogicSource);
  const tsGameLogicObjectTocFields = parseTsGameLogicObjectTocXferFields(tsRuntimeSave);
  if (cppGameLogicObjectTocFields.length > 0 && tsGameLogicObjectTocFields.length > 0) {
    categories.push(compareGameLogicObjectTocFields(cppGameLogicObjectTocFields, tsGameLogicObjectTocFields));
  }

  const buildAssistantSource = zhBuildAssistantCpp || genBuildAssistantCpp;
  const cppBuildAssistantSellListFields = parseCppBuildAssistantSellListXferFields(buildAssistantSource);
  const tsSourceSellingEntitiesFields = parseTsSourceSellingEntitiesXferFields(tsRuntimeSave);
  if (cppBuildAssistantSellListFields.length > 0 && tsSourceSellingEntitiesFields.length > 0) {
    categories.push(compareBuildAssistantSellListFields(
      cppBuildAssistantSellListFields,
      tsSourceSellingEntitiesFields,
    ));
  }

  const cppGameLogicBuildableOverrideMapFields = parseCppGameLogicBuildableOverrideMapXferFields(gameLogicSource);
  const tsGameLogicBuildableOverrideMapFields = parseTsGameLogicBuildableOverrideMapXferFields(tsRuntimeSave);
  if (cppGameLogicBuildableOverrideMapFields.length > 0 && tsGameLogicBuildableOverrideMapFields.length > 0) {
    categories.push(compareGameLogicBuildableOverrideMapFields(
      cppGameLogicBuildableOverrideMapFields,
      tsGameLogicBuildableOverrideMapFields,
    ));
  }

  const cppGameLogicControlBarOverrideMapFields =
    parseCppGameLogicControlBarOverrideMapXferFields(gameLogicSource);
  const tsGameLogicControlBarOverrideMapFields = parseTsGameLogicControlBarOverrideMapXferFields(tsRuntimeSave);
  if (cppGameLogicControlBarOverrideMapFields.length > 0 && tsGameLogicControlBarOverrideMapFields.length > 0) {
    categories.push(compareGameLogicControlBarOverrideMapFields(
      cppGameLogicControlBarOverrideMapFields,
      tsGameLogicControlBarOverrideMapFields,
    ));
  }

  const cppGameLogicFields = parseCppGameLogicXferFields(gameLogicSource);
  const tsGameLogicFields = parseTsSourceGameLogicXferFields(tsRuntimeSave);
  if (cppGameLogicFields.length > 0 && tsGameLogicFields.length > 0) {
    categories.push(compareGameLogicFields(cppGameLogicFields, tsGameLogicFields));
  }

  const objectSource = zhObjectCpp || genObjectCpp;
  const cppObjectModuleListFields = parseCppObjectModuleListXferFields(objectSource);
  const tsObjectModuleListFields = parseTsObjectModuleListXferFields(tsEntityXfer);
  if (cppObjectModuleListFields.length > 0 && tsObjectModuleListFields.length > 0) {
    categories.push(compareObjectModuleListFields(cppObjectModuleListFields, tsObjectModuleListFields));
  }

  const cppObjectFields = parseCppObjectXferFields(objectSource);
  const tsObjectFields = parseTsObjectXferFields(tsEntityXfer);
  if (cppObjectFields.length > 0 && tsObjectFields.length > 0) {
    categories.push(compareObjectFields(cppObjectFields, tsObjectFields));
  }

  const matrixSource = zhXferCpp || genXferCpp;
  const cppMatrix3DFields = parseCppMatrix3DXferFields(matrixSource);
  const tsMatrix3DFields = parseTsMatrix3DXferFields(tsEntityXfer);
  if (cppMatrix3DFields.length > 0 && tsMatrix3DFields.length > 0) {
    categories.push(compareMatrix3DFields(cppMatrix3DFields, tsMatrix3DFields));
  }

  const geometrySource = zhGeometryCpp || genGeometryCpp;
  const cppGeometryInfoFields = parseCppGeometryInfoXferFields(geometrySource);
  const tsGeometryInfoFields = parseTsGeometryInfoXferFields(tsEntityXfer);
  if (cppGeometryInfoFields.length > 0 && tsGeometryInfoFields.length > 0) {
    categories.push(compareGeometryInfoFields(cppGeometryInfoFields, tsGeometryInfoFields));
  }

  const sightingInfoSource = zhPartitionManagerCpp || genPartitionManagerCpp;
  const cppSightingInfoFields = parseCppSightingInfoXferFields(sightingInfoSource);
  const tsSightingInfoFields = parseTsSightingInfoXferFields(tsEntityXfer);
  if (cppSightingInfoFields.length > 0 && tsSightingInfoFields.length > 0) {
    categories.push(compareSightingInfoFields(cppSightingInfoFields, tsSightingInfoFields));
  }

  const experienceTrackerSource = zhExperienceTrackerCpp || genExperienceTrackerCpp;
  const cppExperienceTrackerFields = parseCppExperienceTrackerXferFields(experienceTrackerSource);
  const tsExperienceTrackerFields = parseTsExperienceTrackerXferFields(tsEntityXfer);
  if (cppExperienceTrackerFields.length > 0 && tsExperienceTrackerFields.length > 0) {
    categories.push(compareExperienceTrackerFields(cppExperienceTrackerFields, tsExperienceTrackerFields));
  }

  const bitFlagsSource = zhBitFlagsIoH || genBitFlagsIoH;
  const cppBitFlagsFields = parseCppBitFlagsXferFields(bitFlagsSource);
  const tsBitFlagsFields = parseTsBitFlagsXferFields(tsEntityXfer);
  if (cppBitFlagsFields.length > 0 && tsBitFlagsFields.length > 0) {
    categories.push(compareBitFlagsFields(cppBitFlagsFields, tsBitFlagsFields));
  }

  const weaponSource = zhWeaponCpp || genWeaponCpp;
  const cppWeaponSaveFields = parseCppWeaponXferFields(weaponSource);
  const tsWeaponSaveFields = parseTsWeaponXferFields(tsEntityXfer);
  if (cppWeaponSaveFields.length > 0 && tsWeaponSaveFields.length > 0) {
    categories.push(compareWeaponSaveFields(cppWeaponSaveFields, tsWeaponSaveFields));
  }

  const weaponSetSource = zhWeaponSetCpp || genWeaponSetCpp;
  const cppWeaponSetFields = parseCppWeaponSetXferFields(weaponSetSource);
  const tsWeaponSetFields = parseTsWeaponSetXferFields(tsEntityXfer);
  if (cppWeaponSetFields.length > 0 && tsWeaponSetFields.length > 0) {
    categories.push(compareWeaponSetFields(cppWeaponSetFields, tsWeaponSetFields));
  }

  const drawableSource = zhDrawableCpp || genDrawableCpp;
  const cppDrawableFields = parseCppDrawableXferFields(drawableSource);
  const tsDrawableFields = parseTsDrawableXferFields(tsRuntimeSave);
  if (cppDrawableFields.length > 0 && tsDrawableFields.length > 0) {
    categories.push(compareDrawableFields(cppDrawableFields, tsDrawableFields));
  }

  const gameClientSource = zhGameClientCpp || genGameClientCpp;
  const cppGameClientFields = parseCppGameClientXferFields(gameClientSource);
  const tsGameClientFields = parseTsGameClientXferFields(tsRuntimeSave);
  if (cppGameClientFields.length > 0 && tsGameClientFields.length > 0) {
    categories.push(compareGameClientFields(cppGameClientFields, tsGameClientFields));
  }

  const particleSystemSource = zhParticleSysCpp || genParticleSysCpp;
  const cppParticleSystemManagerFields = parseCppParticleSystemManagerFields(particleSystemSource);
  const tsParticleSystemManagerFields = parseTsParticleSystemManagerFields(tsRuntimeParticleSystem);
  if (cppParticleSystemManagerFields.length > 0 && tsParticleSystemManagerFields.length > 0) {
    categories.push(compareParticleSystemManagerFields(
      cppParticleSystemManagerFields,
      tsParticleSystemManagerFields,
    ));
  }

  const cppParticleSystemInfoFields = parseCppParticleSystemInfoFields(particleSystemSource);
  const tsParticleSystemInfoFields = parseTsParticleSystemInfoFields(tsRuntimeParticleSystem);
  if (cppParticleSystemInfoFields.length > 0 && tsParticleSystemInfoFields.length > 0) {
    categories.push(compareParticleSystemInfoFields(cppParticleSystemInfoFields, tsParticleSystemInfoFields));
  }

  const cppParticleSystemFields = parseCppParticleSystemFields(particleSystemSource);
  const tsParticleSystemFields = parseTsParticleSystemFields(tsRuntimeParticleSystem);
  if (cppParticleSystemFields.length > 0 && tsParticleSystemFields.length > 0) {
    categories.push(compareParticleSystemFields(cppParticleSystemFields, tsParticleSystemFields));
  }

  const cppParticleFields = parseCppParticleFields(particleSystemSource);
  const tsParticleFields = parseTsParticleFields(tsRuntimeParticleSystem);
  if (cppParticleFields.length > 0 && tsParticleFields.length > 0) {
    categories.push(compareParticleFields(cppParticleFields, tsParticleFields));
  }

  const moduleBaseSource = [
    zhModuleCpp || genModuleCpp,
    zhDrawModuleCpp || genDrawModuleCpp,
    zhBehaviorModuleCpp || genBehaviorModuleCpp,
    zhUpdateModuleCpp || genUpdateModuleCpp,
    zhBodyModuleCpp || genBodyModuleCpp,
    zhCollideModuleCpp || genCollideModuleCpp,
    zhDieModuleCpp || genDieModuleCpp,
    zhDamageModuleCpp || genDamageModuleCpp,
    zhCreateModuleCpp || genCreateModuleCpp,
    zhSpecialPowerModuleCpp || genSpecialPowerModuleCpp,
  ].join('\n');
  const moduleBaseChecks: Array<{
    cpp: string[];
    ts: string[];
    compare: (cppFields: string[], tsFields: string[]) => ParityCategoryResult;
  }> = [
    {
      cpp: parseCppSourceModuleBaseFields(moduleBaseSource),
      ts: parseTsSourceModuleBaseFields(tsRuntimeSave),
      compare: compareSourceModuleBaseFields,
    },
    {
      cpp: parseCppSourceObjectModuleBaseFields(moduleBaseSource),
      ts: ['version', 'module.version'],
      compare: compareSourceObjectModuleBaseFields,
    },
    {
      cpp: parseCppSourceDrawableModuleBaseFields(moduleBaseSource),
      ts: parseTsSourceDrawableModuleBaseFields(tsRuntimeSave),
      compare: compareSourceDrawableModuleBaseFields,
    },
    {
      cpp: parseCppSourceDrawModuleBaseFields(moduleBaseSource),
      ts: parseTsSourceDrawModuleBaseFields(tsRuntimeSave),
      compare: compareSourceDrawModuleBaseFields,
    },
    {
      cpp: parseCppSourceBehaviorModuleBaseFields(moduleBaseSource),
      ts: parseTsSourceBehaviorModuleBaseFields(tsRuntimeSave),
      compare: compareSourceBehaviorModuleBaseFields,
    },
    {
      cpp: parseCppSourceUpdateModuleBaseFields(moduleBaseSource),
      ts: parseTsSourceUpdateModuleBaseFields(tsRuntimeSave),
      compare: compareSourceUpdateModuleBaseFields,
    },
    {
      cpp: parseCppSourceBodyModuleBaseFields(moduleBaseSource),
      ts: parseTsSourceBodyModuleBaseFields(tsRuntimeSave),
      compare: compareSourceBodyModuleBaseFields,
    },
    {
      cpp: parseCppSourceCollideModuleBaseFields(moduleBaseSource),
      ts: parseTsSourceCollideModuleBaseFields(tsRuntimeSave),
      compare: compareSourceCollideModuleBaseFields,
    },
    {
      cpp: parseCppSourceDieModuleBaseFields(moduleBaseSource),
      ts: parseTsSourceDieModuleBaseFields(tsRuntimeSave),
      compare: compareSourceDieModuleBaseFields,
    },
    {
      cpp: parseCppSourceDamageModuleBaseFields(moduleBaseSource),
      ts: parseTsSourceDamageModuleBaseFields(tsRuntimeSave),
      compare: compareSourceDamageModuleBaseFields,
    },
    {
      cpp: parseCppSourceCreateModuleFields(moduleBaseSource),
      ts: parseTsSourceCreateModuleFields(tsRuntimeSave),
      compare: compareSourceCreateModuleFields,
    },
    {
      cpp: parseCppSourceSpecialPowerModuleFields(moduleBaseSource),
      ts: parseTsSourceSpecialPowerModuleFields(tsRuntimeSave),
      compare: compareSourceSpecialPowerModuleFields,
    },
  ];
  for (const check of moduleBaseChecks) {
    if (check.cpp.length > 0 && check.ts.length > 0) {
      categories.push(check.compare(check.cpp, check.ts));
    }
  }

  const w3dDrawSource = zhW3DDrawCpp || genW3DDrawCpp;
  const w3dModelDerivedFields = parseTsSourceW3DDrawModuleFields(
    tsRuntimeSave,
    'xferSourceW3DModelDrawDerived',
  );
  const w3dOverlordTruckFields = parseTsSourceW3DDrawModuleFields(
    tsRuntimeSave,
    'xferSourceW3DOverlordTruckDraw',
  );
  const w3dDrawChecks: Array<{
    category: string;
    cpp: string[];
    ts: string[];
  }> = [
    {
      category: 'save-w3d-draw-base-only-fields',
      cpp: parseCppSourceW3DDrawBaseOnlyFields(w3dDrawSource),
      ts: parseTsSourceW3DDrawBaseOnlyFields(tsRuntimeSave),
    },
    {
      category: 'save-w3d-model-draw-fields',
      cpp: parseCppSourceW3DDrawModuleFields(w3dDrawSource, 'W3DModelDraw'),
      ts: parseTsSourceW3DDrawModuleFields(tsRuntimeSave, 'xferSourceW3DModelDrawBase'),
    },
    {
      category: 'save-w3d-tank-draw-fields',
      cpp: parseCppSourceW3DDrawModuleFields(w3dDrawSource, 'W3DTankDraw'),
      ts: parseTsSourceW3DDrawModuleFields(tsRuntimeSave, 'xferSourceW3DTankDraw'),
    },
    {
      category: 'save-w3d-truck-draw-fields',
      cpp: parseCppSourceW3DDrawModuleFields(w3dDrawSource, 'W3DTruckDraw'),
      ts: parseTsSourceW3DDrawModuleFields(tsRuntimeSave, 'xferSourceW3DTruckDraw'),
    },
    {
      category: 'save-w3d-tank-truck-draw-fields',
      cpp: parseCppSourceW3DDrawModuleFields(w3dDrawSource, 'W3DTankTruckDraw'),
      ts: w3dModelDerivedFields,
    },
    {
      category: 'save-w3d-overlord-aircraft-draw-fields',
      cpp: parseCppSourceW3DDrawModuleFields(w3dDrawSource, 'W3DOverlordAircraftDraw'),
      ts: w3dModelDerivedFields,
    },
    {
      category: 'save-w3d-science-model-draw-fields',
      cpp: parseCppSourceW3DDrawModuleFields(w3dDrawSource, 'W3DScienceModelDraw'),
      ts: w3dModelDerivedFields,
    },
    {
      category: 'save-w3d-supply-draw-fields',
      cpp: parseCppSourceW3DDrawModuleFields(w3dDrawSource, 'W3DSupplyDraw'),
      ts: w3dModelDerivedFields,
    },
    {
      category: 'save-w3d-overlord-tank-draw-fields',
      cpp: parseCppSourceW3DDrawModuleFields(w3dDrawSource, 'W3DOverlordTankDraw'),
      ts: parseTsSourceW3DDrawModuleFields(tsRuntimeSave, 'xferSourceW3DOverlordTankDraw'),
    },
    {
      category: 'save-w3d-overlord-truck-draw-fields',
      cpp: parseCppSourceW3DDrawModuleFields(w3dDrawSource, 'W3DOverlordTruckDraw'),
      ts: w3dOverlordTruckFields,
    },
    {
      category: 'save-w3d-police-car-draw-fields',
      cpp: parseCppSourceW3DDrawModuleFields(w3dDrawSource, 'W3DPoliceCarDraw'),
      ts: w3dOverlordTruckFields,
    },
    {
      category: 'save-w3d-dependency-model-draw-fields',
      cpp: parseCppSourceW3DDrawModuleFields(w3dDrawSource, 'W3DDependencyModelDraw'),
      ts: parseTsSourceW3DDrawModuleFields(tsRuntimeSave, 'xferSourceW3DDependencyModelDraw'),
    },
    {
      category: 'save-w3d-debris-draw-fields',
      cpp: parseCppSourceW3DDrawModuleFields(w3dDrawSource, 'W3DDebrisDraw'),
      ts: parseTsSourceW3DDrawModuleFields(tsRuntimeSave, 'xferSourceW3DDebrisDraw'),
    },
    {
      category: 'save-w3d-rope-draw-fields',
      cpp: parseCppSourceW3DDrawModuleFields(w3dDrawSource, 'W3DRopeDraw'),
      ts: parseTsSourceW3DDrawModuleFields(tsRuntimeSave, 'xferSourceW3DRopeDraw'),
    },
  ];
  for (const check of w3dDrawChecks) {
    if (check.cpp.length > 0 && check.ts.length > 0) {
      categories.push(compareSourceW3DDrawModuleFields(check.category, check.cpp, check.ts));
    }
  }

  const drawableClientUpdateSource = `${zhDrawableClientUpdateCpp || genDrawableClientUpdateCpp}\n${
    zhLaserUpdateCpp || genLaserUpdateCpp
  }`;
  const drawableClientUpdateChecks: Array<{
    category: string;
    cpp: string[];
    ts: string[];
  }> = [
    {
      category: 'save-animated-particle-sys-bone-client-update-fields',
      cpp: parseCppSourceDrawableClientUpdateFields(drawableClientUpdateSource, 'AnimatedParticleSysBoneClientUpdate'),
      ts: parseTsSourceDrawableClientUpdateFields(tsRuntimeSave, 'xferSourceAnimatedParticleSysBoneClientUpdate'),
    },
    {
      category: 'save-sway-client-update-fields',
      cpp: parseCppSourceDrawableClientUpdateFields(drawableClientUpdateSource, 'SwayClientUpdate'),
      ts: parseTsSourceDrawableClientUpdateFields(tsRuntimeSave, 'xferSourceSwayClientUpdate'),
    },
    {
      category: 'save-laser-update-fields',
      cpp: parseCppSourceDrawableClientUpdateFields(drawableClientUpdateSource, 'LaserUpdate'),
      ts: parseTsSourceDrawableClientUpdateFields(tsRuntimeSave, 'xferSourceLaserUpdate'),
    },
    {
      category: 'save-beacon-client-update-fields',
      cpp: parseCppSourceDrawableClientUpdateFields(drawableClientUpdateSource, 'BeaconClientUpdate'),
      ts: parseTsSourceDrawableClientUpdateFields(tsRuntimeSave, 'xferSourceBeaconClientUpdate'),
    },
  ];
  for (const check of drawableClientUpdateChecks) {
    if (check.cpp.length > 0 && check.ts.length > 0) {
      categories.push(compareSourceW3DDrawModuleFields(check.category, check.cpp, check.ts));
    }
  }

  const objectUpdateSource = zhObjectUpdateCpp || genObjectUpdateCpp;
  const objectUpdateChecks: Array<{
    category: string;
    cppClass: string;
    tsHelper: string;
    hasUpgradeMux?: boolean;
  }> = [
    {
      category: 'save-weapon-bonus-update-fields',
      cppClass: 'WeaponBonusUpdate',
      tsHelper: 'buildSourceWeaponBonusUpdateBlockData',
    },
    {
      category: 'save-power-plant-update-fields',
      cppClass: 'PowerPlantUpdate',
      tsHelper: 'buildSourcePowerPlantUpdateBlockData',
    },
    {
      category: 'save-ocl-update-fields',
      cppClass: 'OCLUpdate',
      tsHelper: 'buildSourceOclUpdateBlockData',
    },
    {
      category: 'save-enemy-near-update-fields',
      cppClass: 'EnemyNearUpdate',
      tsHelper: 'buildSourceEnemyNearUpdateBlockData',
    },
    {
      category: 'save-horde-update-fields',
      cppClass: 'HordeUpdate',
      tsHelper: 'buildSourceHordeUpdateBlockData',
    },
    {
      category: 'save-prone-update-fields',
      cppClass: 'ProneUpdate',
      tsHelper: 'buildSourceProneUpdateBlockData',
    },
    {
      category: 'save-fire-ocl-after-weapon-cooldown-update-fields',
      cppClass: 'FireOCLAfterWeaponCooldownUpdate',
      tsHelper: 'buildSourceFireOclAfterCooldownUpdateBlockData',
      hasUpgradeMux: true,
    },
    {
      category: 'save-auto-find-healing-update-fields',
      cppClass: 'AutoFindHealingUpdate',
      tsHelper: 'buildSourceAutoFindHealingUpdateBlockData',
    },
    {
      category: 'save-radius-decal-update-fields',
      cppClass: 'RadiusDecalUpdate',
      tsHelper: 'buildSourceRadiusDecalUpdateBlockData',
    },
    {
      category: 'save-base-regenerate-update-fields',
      cppClass: 'BaseRegenerateUpdate',
      tsHelper: 'buildSourceBaseRegenerateUpdateBlockData',
    },
    {
      category: 'save-lifetime-update-fields',
      cppClass: 'LifetimeUpdate',
      tsHelper: 'buildSourceLifetimeUpdateBlockData',
    },
    {
      category: 'save-deletion-update-fields',
      cppClass: 'DeletionUpdate',
      tsHelper: 'buildSourceDeletionUpdateBlockData',
    },
    {
      category: 'save-height-die-update-fields',
      cppClass: 'HeightDieUpdate',
      tsHelper: 'buildSourceHeightDieUpdateBlockData',
    },
    {
      category: 'save-sticky-bomb-update-fields',
      cppClass: 'StickyBombUpdate',
      tsHelper: 'buildSourceStickyBombUpdateBlockData',
    },
    {
      category: 'save-cleanup-hazard-update-fields',
      cppClass: 'CleanupHazardUpdate',
      tsHelper: 'buildSourceCleanupHazardUpdateBlockData',
    },
    {
      category: 'save-demo-trap-update-fields',
      cppClass: 'DemoTrapUpdate',
      tsHelper: 'buildSourceDemoTrapUpdateBlockData',
    },
    {
      category: 'save-command-button-hunt-update-fields',
      cppClass: 'CommandButtonHuntUpdate',
      tsHelper: 'buildSourceCommandButtonHuntUpdateBlockData',
    },
    {
      category: 'save-auto-deposit-update-fields',
      cppClass: 'AutoDepositUpdate',
      tsHelper: 'buildSourceAutoDepositUpdateBlockData',
    },
    {
      category: 'save-dynamic-shroud-clearing-range-update-fields',
      cppClass: 'DynamicShroudClearingRangeUpdate',
      tsHelper: 'buildSourceDynamicShroudClearingRangeUpdateBlockData',
    },
    {
      category: 'save-stealth-update-fields',
      cppClass: 'StealthUpdate',
      tsHelper: 'buildSourceStealthUpdateBlockData',
    },
    {
      category: 'save-stealth-detector-update-fields',
      cppClass: 'StealthDetectorUpdate',
      tsHelper: 'buildSourceStealthDetectorUpdateBlockData',
    },
    {
      category: 'save-wave-guide-update-fields',
      cppClass: 'WaveGuideUpdate',
      tsHelper: 'buildSourceWaveGuideUpdateBlockData',
    },
    {
      category: 'save-projectile-stream-update-fields',
      cppClass: 'ProjectileStreamUpdate',
      tsHelper: 'buildSourceProjectileStreamUpdateBlockData',
    },
    {
      category: 'save-bone-fx-update-fields',
      cppClass: 'BoneFXUpdate',
      tsHelper: 'buildSourceBoneFxUpdateBlockData',
    },
    {
      category: 'save-flammable-update-fields',
      cppClass: 'FlammableUpdate',
      tsHelper: 'buildSourceFlammableUpdateBlockData',
    },
    {
      category: 'save-fire-spread-update-fields',
      cppClass: 'FireSpreadUpdate',
      tsHelper: 'buildSourceFireSpreadUpdateBlockData',
    },
    {
      category: 'save-dynamic-geometry-info-update-fields',
      cppClass: 'DynamicGeometryInfoUpdate',
      tsHelper: 'buildSourceDynamicGeometryInfoUpdateBlockData',
    },
    {
      category: 'save-firestorm-dynamic-geometry-info-update-fields',
      cppClass: 'FirestormDynamicGeometryInfoUpdate',
      tsHelper: 'buildSourceFirestormDynamicGeometryInfoUpdateBlockData',
    },
    {
      category: 'save-smart-bomb-target-homing-update-fields',
      cppClass: 'SmartBombTargetHomingUpdate',
      tsHelper: 'buildSourceSmartBombTargetHomingUpdateBlockData',
    },
    {
      category: 'save-animation-steering-update-fields',
      cppClass: 'AnimationSteeringUpdate',
      tsHelper: 'buildSourceAnimationSteeringUpdateBlockData',
    },
    {
      category: 'save-float-update-fields',
      cppClass: 'FloatUpdate',
      tsHelper: 'buildSourceFloatUpdateBlockData',
    },
    {
      category: 'save-tensile-formation-update-fields',
      cppClass: 'TensileFormationUpdate',
      tsHelper: 'buildSourceTensileFormationUpdateBlockData',
    },
    {
      category: 'save-pilot-find-vehicle-update-fields',
      cppClass: 'PilotFindVehicleUpdate',
      tsHelper: 'buildSourcePilotFindVehicleUpdateBlockData',
    },
    {
      category: 'save-point-defense-laser-update-fields',
      cppClass: 'PointDefenseLaserUpdate',
      tsHelper: 'buildSourcePointDefenseLaserUpdateBlockData',
    },
    {
      category: 'save-emp-update-fields',
      cppClass: 'EMPUpdate',
      tsHelper: 'buildSourceEmpUpdateBlockData',
    },
    {
      category: 'save-radar-update-fields',
      cppClass: 'RadarUpdate',
      tsHelper: 'buildSourceRadarUpdateBlockData',
    },
    {
      category: 'save-checkpoint-update-fields',
      cppClass: 'CheckpointUpdate',
      tsHelper: 'buildSourceCheckpointUpdateBlockData',
    },
    {
      category: 'save-hijacker-update-fields',
      cppClass: 'HijackerUpdate',
      tsHelper: 'buildSourceHijackerUpdateBlockData',
    },
    {
      category: 'save-missile-launcher-building-update-fields',
      cppClass: 'MissileLauncherBuildingUpdate',
      tsHelper: 'buildSourceMissileLauncherBuildingUpdateBlockData',
    },
    {
      category: 'save-structure-collapse-update-fields',
      cppClass: 'StructureCollapseUpdate',
      tsHelper: 'buildSourceStructureCollapseUpdateBlockData',
    },
    {
      category: 'save-supply-center-dock-update-fields',
      cppClass: 'SupplyCenterDockUpdate',
      tsHelper: 'buildSourceDockOnlyUpdateBlockData',
    },
    {
      category: 'save-prison-dock-update-fields',
      cppClass: 'PrisonDockUpdate',
      tsHelper: 'buildSourceDockOnlyUpdateBlockData',
    },
    {
      category: 'save-supply-warehouse-dock-update-fields',
      cppClass: 'SupplyWarehouseDockUpdate',
      tsHelper: 'buildSourceSupplyWarehouseDockUpdateBlockData',
    },
    {
      category: 'save-repair-dock-update-fields',
      cppClass: 'RepairDockUpdate',
      tsHelper: 'buildSourceRepairDockUpdateBlockData',
    },
    {
      category: 'save-railed-transport-dock-update-fields',
      cppClass: 'RailedTransportDockUpdate',
      tsHelper: 'buildSourceRailedTransportDockUpdateBlockData',
    },
    {
      category: 'save-default-production-exit-update-fields',
      cppClass: 'DefaultProductionExitUpdate',
      tsHelper: 'buildSourceProductionExitRallyBlockData',
    },
    {
      category: 'save-supply-center-production-exit-update-fields',
      cppClass: 'SupplyCenterProductionExitUpdate',
      tsHelper: 'buildSourceProductionExitRallyBlockData',
    },
    {
      category: 'save-queue-production-exit-update-fields',
      cppClass: 'QueueProductionExitUpdate',
      tsHelper: 'buildSourceQueueProductionExitBlockData',
    },
    {
      category: 'save-spawn-point-production-exit-update-fields',
      cppClass: 'SpawnPointProductionExitUpdate',
      tsHelper: 'buildSourceSpawnPointProductionExitBlockData',
    },
    {
      category: 'save-fire-weapon-update-fields',
      cppClass: 'FireWeaponUpdate',
      tsHelper: 'buildSourceFireWeaponUpdateBlockData',
    },
    {
      category: 'save-production-update-fields',
      cppClass: 'ProductionUpdate',
      tsHelper: 'buildSourceProductionUpdateBlockData',
    },
    {
      category: 'save-battle-plan-update-fields',
      cppClass: 'BattlePlanUpdate',
      tsHelper: 'buildSourceBattlePlanUpdateBlockData',
    },
    {
      category: 'save-slaved-update-fields',
      cppClass: 'SlavedUpdate',
      tsHelper: 'buildSourceSlavedUpdateBlockData',
    },
    {
      category: 'save-mob-member-slaved-update-fields',
      cppClass: 'MobMemberSlavedUpdate',
      tsHelper: 'buildSourceMobMemberSlavedUpdateBlockData',
    },
    {
      category: 'save-neutron-missile-update-fields',
      cppClass: 'NeutronMissileUpdate',
      tsHelper: 'buildSourceNeutronMissileUpdateBlockData',
    },
    {
      category: 'save-topple-update-fields',
      cppClass: 'ToppleUpdate',
      tsHelper: 'buildSourceToppleUpdateBlockData',
    },
    {
      category: 'save-structure-topple-update-fields',
      cppClass: 'StructureToppleUpdate',
      tsHelper: 'buildSourceStructureToppleUpdateBlockData',
    },
    {
      category: 'save-spectre-gunship-deployment-update-fields',
      cppClass: 'SpectreGunshipDeploymentUpdate',
      tsHelper: 'buildSourceSpectreGunshipDeploymentUpdateBlockData',
    },
    {
      category: 'save-spectre-gunship-update-fields',
      cppClass: 'SpectreGunshipUpdate',
      tsHelper: 'buildSourceSpectreGunshipUpdateBlockData',
    },
    {
      category: 'save-special-ability-update-fields',
      cppClass: 'SpecialAbilityUpdate',
      tsHelper: 'buildSourceSpecialAbilityUpdateBlockData',
    },
    {
      category: 'save-particle-uplink-cannon-update-fields',
      cppClass: 'ParticleUplinkCannonUpdate',
      tsHelper: 'buildSourceParticleUplinkCannonUpdateBlockData',
    },
    {
      category: 'save-spy-vision-update-fields',
      cppClass: 'SpyVisionUpdate',
      tsHelper: 'buildSourceSpyVisionUpdateBlockData',
    },
  ];
  for (const check of objectUpdateChecks) {
    const cpp = parseCppSourceObjectUpdateFields(objectUpdateSource, check.cppClass);
    const ts = parseTsSourceObjectUpdateFields(tsRuntimeSave, check.tsHelper, {
      hasUpgradeMux: check.hasUpgradeMux,
    });
    if (cpp.length > 0 && ts.length > 0) {
      categories.push(compareSourceObjectUpdateFields(check.category, cpp, ts));
    }
  }

  const terrainVisualSource = `${zhW3DTerrainVisualCpp || genW3DTerrainVisualCpp}\n${zhTerrainVisualCpp || genTerrainVisualCpp}`;
  const cppTerrainVisualFields = parseCppTerrainVisualFields(terrainVisualSource);
  const tsTerrainVisualFields = parseTsTerrainVisualFields(tsRuntimeSave);
  if (cppTerrainVisualFields.length > 0 && tsTerrainVisualFields.length > 0) {
    categories.push(compareTerrainVisualFields(cppTerrainVisualFields, tsTerrainVisualFields));
  }

  const waterRenderSource = zhW3DWaterCpp || genW3DWaterCpp;
  const cppWaterRenderFields = parseCppWaterRenderObjectFields(waterRenderSource);
  const tsWaterRenderFields = parseTsWaterRenderObjectFields(tsRuntimeSave);
  if (cppWaterRenderFields.length > 0 && tsWaterRenderFields.length > 0) {
    categories.push(compareWaterRenderObjectFields(cppWaterRenderFields, tsWaterRenderFields));
  }

  const heightMapRenderSource = zhBaseHeightMapCpp || genBaseHeightMapCpp;
  const cppHeightMapRenderFields = parseCppHeightMapRenderObjectFields(heightMapRenderSource);
  const tsHeightMapRenderFields = parseTsHeightMapRenderObjectFields(tsRuntimeSave);
  if (cppHeightMapRenderFields.length > 0 && tsHeightMapRenderFields.length > 0) {
    categories.push(compareHeightMapRenderObjectFields(cppHeightMapRenderFields, tsHeightMapRenderFields));
  }

  const w3dTreeBufferSource = zhW3DTreeBufferCpp || genW3DTreeBufferCpp;
  const cppW3DTreeBufferFields = parseCppW3DTreeBufferFields(w3dTreeBufferSource);
  const tsW3DTreeBufferFields = parseTsW3DTreeBufferFields(tsRuntimeSave);
  if (cppW3DTreeBufferFields.length > 0 && tsW3DTreeBufferFields.length > 0) {
    categories.push(compareW3DTreeBufferFields(cppW3DTreeBufferFields, tsW3DTreeBufferFields));
  }

  const w3dPropBufferSource = zhW3DPropBufferCpp || genW3DPropBufferCpp;
  const cppW3DPropBufferFields = parseCppW3DPropBufferFields(w3dPropBufferSource);
  const tsW3DPropBufferFields = parseTsW3DPropBufferFields(tsRuntimeSave);
  if (cppW3DPropBufferFields.length > 0 && tsW3DPropBufferFields.length > 0) {
    categories.push(compareW3DPropBufferFields(cppW3DPropBufferFields, tsW3DPropBufferFields));
  }

  const ghostObjectSource = `${zhW3DGhostObjectCpp || genW3DGhostObjectCpp}\n${zhGhostObjectCpp || genGhostObjectCpp}`;
  const cppGhostObjectManagerFields = parseCppGhostObjectManagerFields(ghostObjectSource);
  const tsGhostObjectManagerFields = parseTsGhostObjectManagerFields(tsRuntimeSave);
  if (cppGhostObjectManagerFields.length > 0 && tsGhostObjectManagerFields.length > 0) {
    categories.push(compareGhostObjectManagerFields(cppGhostObjectManagerFields, tsGhostObjectManagerFields));
  }

  const cppGhostObjectFields = parseCppGhostObjectFields(ghostObjectSource);
  const tsGhostObjectFields = parseTsGhostObjectFields(tsRuntimeSave);
  if (cppGhostObjectFields.length > 0 && tsGhostObjectFields.length > 0) {
    categories.push(compareGhostObjectFields(cppGhostObjectFields, tsGhostObjectFields));
  }

  const cppW3DRenderObjectSnapshotFields = parseCppW3DRenderObjectSnapshotFields(ghostObjectSource);
  const tsW3DRenderObjectSnapshotFields = parseTsW3DRenderObjectSnapshotFields(tsRuntimeSave);
  if (cppW3DRenderObjectSnapshotFields.length > 0 && tsW3DRenderObjectSnapshotFields.length > 0) {
    categories.push(compareW3DRenderObjectSnapshotFields(
      cppW3DRenderObjectSnapshotFields,
      tsW3DRenderObjectSnapshotFields,
    ));
  }

  const radarSource = zhRadarCpp || genRadarCpp;
  const cppRadarFields = parseCppRadarXferFields(radarSource);
  const tsRadarFields = parseTsRadarXferFields(tsRuntimeSave);
  if (cppRadarFields.length > 0 && tsRadarFields.length > 0) {
    categories.push(compareRadarFields(cppRadarFields, tsRadarFields));
  }

  const partitionSource = zhPartitionManagerCpp || genPartitionManagerCpp;
  const cppPartitionFields = parseCppPartitionXferFields(partitionSource);
  const tsPartitionFields = parseTsPartitionXferFields(tsRuntimeSave);
  if (cppPartitionFields.length > 0 && tsPartitionFields.length > 0) {
    categories.push(comparePartitionFields(cppPartitionFields, tsPartitionFields));
  }

  const teamSource = zhTeamCpp || genTeamCpp;
  const cppTeamFactoryFields = parseCppTeamFactoryXferFields(teamSource);
  const tsTeamFactoryFields = parseTsTeamFactoryXferFields(tsRuntimeTeamFactory);
  if (cppTeamFactoryFields.length > 0 && tsTeamFactoryFields.length > 0) {
    categories.push(compareTeamFactoryFields(cppTeamFactoryFields, tsTeamFactoryFields));
  }

  const playerListSource = zhPlayerListCpp || genPlayerListCpp;
  const cppPlayerListFields = parseCppPlayerListXferFields(playerListSource);
  const tsPlayerListFields = parseTsPlayerListXferFields(tsRuntimeSave);
  if (cppPlayerListFields.length > 0 && tsPlayerListFields.length > 0) {
    categories.push(comparePlayerListFields(cppPlayerListFields, tsPlayerListFields));
  }

  const playerSource = zhPlayerCpp || genPlayerCpp;
  const cppPlayerFields = parseCppPlayerXferFields(playerSource);
  const tsPlayerFields = parseTsPlayerXferFields(tsRuntimeSave);
  if (cppPlayerFields.length > 0 && tsPlayerFields.length > 0) {
    categories.push(comparePlayerFields(cppPlayerFields, tsPlayerFields));
  }

  const moneySource = zhMoneyCpp || genMoneyCpp;
  const cppMoneyFields = parseCppMoneyXferFields(moneySource);
  const tsMoneyFields = parseTsMoneyXferFields(tsRuntimeSave);
  if (cppMoneyFields.length > 0 && tsMoneyFields.length > 0) {
    categories.push(compareMoneyFields(cppMoneyFields, tsMoneyFields));
  }

  const energySource = zhEnergyCpp || genEnergyCpp;
  const cppEnergyFields = parseCppEnergyXferFields(energySource);
  const tsEnergyFields = parseTsEnergyXferFields(tsRuntimeSave);
  if (cppEnergyFields.length > 0 && tsEnergyFields.length > 0) {
    categories.push(compareEnergyFields(cppEnergyFields, tsEnergyFields));
  }

  const scoreKeeperSource = zhScoreKeeperCpp || genScoreKeeperCpp;
  const cppScoreKeeperFields = parseCppScoreKeeperXferFields(scoreKeeperSource);
  const tsScoreKeeperFields = parseTsScoreKeeperXferFields(tsRuntimeSave);
  if (cppScoreKeeperFields.length > 0 && tsScoreKeeperFields.length > 0) {
    categories.push(compareScoreKeeperFields(cppScoreKeeperFields, tsScoreKeeperFields));
  }

  const xferSource = zhXferCpp || genXferCpp;
  const cppObjectIdListFields = parseCppObjectIdListXferFields(xferSource);
  const tsObjectIdListFields = parseTsObjectIdListXferFields(tsRuntimeSave);
  if (cppObjectIdListFields.length > 0 && tsObjectIdListFields.length > 0) {
    categories.push(compareObjectIdListFields(cppObjectIdListFields, tsObjectIdListFields));
  }

  const cppScienceVectorFields = parseCppScienceVectorXferFields(xferSource);
  const tsSourceScienceVectorFields = parseTsSourceScienceVectorXferFields(tsRuntimeSave);
  if (cppScienceVectorFields.length > 0 && tsSourceScienceVectorFields.length > 0) {
    categories.push(compareScienceVectorFields(cppScienceVectorFields, tsSourceScienceVectorFields));
  }

  const upgradeSource = zhUpgradeCpp || genUpgradeCpp;
  const cppUpgradeFields = parseCppUpgradeXferFields(upgradeSource);
  const tsUpgradeFields = parseTsUpgradeXferFields(tsRuntimeSave);
  if (cppUpgradeFields.length > 0 && tsUpgradeFields.length > 0) {
    categories.push(compareUpgradeFields(cppUpgradeFields, tsUpgradeFields));
  }

  const cppPlayerRelationMapFields = parseCppPlayerRelationMapXferFields(playerSource);
  const tsPlayerRelationMapFields = parseTsPlayerRelationMapXferFields(tsRuntimeSave);
  if (cppPlayerRelationMapFields.length > 0 && tsPlayerRelationMapFields.length > 0) {
    categories.push(comparePlayerRelationMapFields(cppPlayerRelationMapFields, tsPlayerRelationMapFields));
  }

  const cppTeamRelationMapFields = parseCppTeamRelationMapXferFields(teamSource);
  const tsTeamRelationMapFields = parseTsTeamRelationMapXferFields(tsRuntimeSave);
  if (cppTeamRelationMapFields.length > 0 && tsTeamRelationMapFields.length > 0) {
    categories.push(compareTeamRelationMapFields(cppTeamRelationMapFields, tsTeamRelationMapFields));
  }

  const sidesListSource = zhSidesListCpp || genSidesListCpp;
  const scriptsSource = zhScriptsCpp || genScriptsCpp;
  const cppScriptFields = parseCppScriptXferFields(scriptsSource);
  const tsScriptFields = parseTsSourceScriptXferFields(tsRuntimeSave);
  if (cppScriptFields.length > 0 && tsScriptFields.length > 0) {
    categories.push(compareSourceScriptFields(cppScriptFields, tsScriptFields));
  }

  const cppScriptGroupFields = parseCppScriptGroupXferFields(scriptsSource);
  const tsScriptGroupFields = parseTsSourceScriptGroupXferFields(tsRuntimeSave);
  if (cppScriptGroupFields.length > 0 && tsScriptGroupFields.length > 0) {
    categories.push(compareSourceScriptGroupFields(cppScriptGroupFields, tsScriptGroupFields));
  }

  const cppScriptListFields = parseCppScriptListXferFields(scriptsSource);
  const tsScriptListFields = parseTsSourceScriptListXferFields(tsRuntimeSave);
  if (cppScriptListFields.length > 0 && tsScriptListFields.length > 0) {
    categories.push(compareSourceScriptListFields(cppScriptListFields, tsScriptListFields));
  }

  const cppSidesListFields = parseCppSidesListXferFields(sidesListSource);
  const tsSidesListFields = parseTsSidesListXferFields(tsRuntimeSave);
  if (cppSidesListFields.length > 0 && tsSidesListFields.length > 0) {
    categories.push(compareSidesListFields(cppSidesListFields, tsSidesListFields));
  }

  const cppBuildListInfoFields = parseCppBuildListInfoXferFields(sidesListSource);
  const tsBuildListInfoFields = parseTsBuildListInfoXferFields(tsRuntimeSave);
  if (cppBuildListInfoFields.length > 0 && tsBuildListInfoFields.length > 0) {
    categories.push(compareBuildListInfoFields(cppBuildListInfoFields, tsBuildListInfoFields));
  }

  const resourceGatheringManagerSource = zhResourceGatheringManagerCpp || genResourceGatheringManagerCpp;
  const cppResourceGatheringManagerFields = parseCppResourceGatheringManagerXferFields(resourceGatheringManagerSource);
  const tsResourceGatheringManagerFields = parseTsResourceGatheringManagerXferFields(tsRuntimeSave);
  if (cppResourceGatheringManagerFields.length > 0 && tsResourceGatheringManagerFields.length > 0) {
    categories.push(compareResourceGatheringManagerFields(
      cppResourceGatheringManagerFields,
      tsResourceGatheringManagerFields,
    ));
  }

  const tunnelTrackerSource = zhTunnelTrackerCpp || genTunnelTrackerCpp;
  const cppTunnelTrackerFields = parseCppTunnelTrackerXferFields(tunnelTrackerSource);
  const tsTunnelTrackerFields = parseTsTunnelTrackerXferFields(tsRuntimeSave);
  if (cppTunnelTrackerFields.length > 0 && tsTunnelTrackerFields.length > 0) {
    categories.push(compareTunnelTrackerFields(cppTunnelTrackerFields, tsTunnelTrackerFields));
  }

  const squadSource = zhSquadCpp || genSquadCpp;
  const cppSquadFields = parseCppSquadXferFields(squadSource);
  const tsSquadFields = parseTsSquadXferFields(tsRuntimeSave);
  if (cppSquadFields.length > 0 && tsSquadFields.length > 0) {
    categories.push(compareSquadFields(cppSquadFields, tsSquadFields));
  }

  const aiPlayerSource = zhAiPlayerCpp || genAiPlayerCpp;
  const cppWorkOrderFields = parseCppWorkOrderXferFields(aiPlayerSource);
  const tsWorkOrderFields = parseTsWorkOrderXferFields(tsRuntimeSave);
  if (cppWorkOrderFields.length > 0 && tsWorkOrderFields.length > 0) {
    categories.push(compareWorkOrderFields(cppWorkOrderFields, tsWorkOrderFields));
  }

  const cppTeamInQueueFields = parseCppTeamInQueueXferFields(aiPlayerSource);
  const tsTeamInQueueFields = parseTsTeamInQueueXferFields(tsRuntimeSave);
  if (cppTeamInQueueFields.length > 0 && tsTeamInQueueFields.length > 0) {
    categories.push(compareTeamInQueueFields(cppTeamInQueueFields, tsTeamInQueueFields));
  }

  const cppAiPlayerFields = parseCppAiPlayerXferFields(aiPlayerSource);
  const tsAiPlayerFields = parseTsAiPlayerXferFields(tsRuntimeSave);
  if (cppAiPlayerFields.length > 0 && tsAiPlayerFields.length > 0) {
    categories.push(compareAiPlayerFields(cppAiPlayerFields, tsAiPlayerFields));
  }

  const aiSkirmishPlayerSource = zhAiSkirmishPlayerCpp || genAiSkirmishPlayerCpp;
  const cppAiSkirmishPlayerFields = parseCppAiSkirmishPlayerXferFields(aiSkirmishPlayerSource, aiPlayerSource);
  const tsAiSkirmishPlayerFields = parseTsAiSkirmishPlayerXferFields(tsRuntimeSave);
  if (cppAiSkirmishPlayerFields.length > 0 && tsAiSkirmishPlayerFields.length > 0) {
    categories.push(compareAiSkirmishPlayerFields(cppAiSkirmishPlayerFields, tsAiSkirmishPlayerFields));
  }

  const scriptEngineSource = zhScriptEngineCpp || genScriptEngineCpp;
  const cppSequentialScriptFields = parseCppSequentialScriptXferFields(scriptEngineSource);
  const tsSequentialScriptFields = parseTsSequentialScriptXferFields(tsRuntimeSave);
  if (cppSequentialScriptFields.length > 0 && tsSequentialScriptFields.length > 0) {
    categories.push(compareSequentialScriptFields(cppSequentialScriptFields, tsSequentialScriptFields));
  }

  const cppAttackPriorityInfoFields = parseCppAttackPriorityInfoXferFields(scriptEngineSource);
  const tsAttackPriorityInfoFields = parseTsAttackPriorityInfoXferFields(tsRuntimeSave);
  if (cppAttackPriorityInfoFields.length > 0 && tsAttackPriorityInfoFields.length > 0) {
    categories.push(compareAttackPriorityInfoFields(cppAttackPriorityInfoFields, tsAttackPriorityInfoFields));
  }

  const cppScriptEngineBreezeFields = parseCppScriptEngineBreezeXferFields(scriptEngineSource);
  const tsScriptEngineBreezeFields = parseTsScriptEngineBreezeXferFields(tsRuntimeSave);
  if (cppScriptEngineBreezeFields.length > 0 && tsScriptEngineBreezeFields.length > 0) {
    categories.push(compareScriptEngineBreezeFields(cppScriptEngineBreezeFields, tsScriptEngineBreezeFields));
  }

  const cppScriptEngineStringListFields = parseCppScriptEngineStringListXferFields(scriptEngineSource);
  const tsScriptEngineStringListFields = parseTsScriptEngineStringListXferFields(tsRuntimeSave);
  if (cppScriptEngineStringListFields.length > 0 && tsScriptEngineStringListFields.length > 0) {
    categories.push(compareScriptEngineStringListFields(
      cppScriptEngineStringListFields,
      tsScriptEngineStringListFields,
    ));
  }

  const cppScriptEngineStringUIntListFields = parseCppScriptEngineStringUIntListXferFields(scriptEngineSource);
  const tsScriptEngineStringUIntListFields = parseTsScriptEngineStringUIntListXferFields(tsRuntimeSave);
  if (cppScriptEngineStringUIntListFields.length > 0 && tsScriptEngineStringUIntListFields.length > 0) {
    categories.push(compareScriptEngineStringUIntListFields(
      cppScriptEngineStringUIntListFields,
      tsScriptEngineStringUIntListFields,
    ));
  }

  const cppScriptEngineStringObjectIdListFields =
    parseCppScriptEngineStringObjectIdListXferFields(scriptEngineSource);
  const tsScriptEngineStringObjectIdListFields = parseTsScriptEngineStringObjectIdListXferFields(tsRuntimeSave);
  if (cppScriptEngineStringObjectIdListFields.length > 0 && tsScriptEngineStringObjectIdListFields.length > 0) {
    categories.push(compareScriptEngineStringObjectIdListFields(
      cppScriptEngineStringObjectIdListFields,
      tsScriptEngineStringObjectIdListFields,
    ));
  }

  const cppScriptEngineNamedObjectFields = parseCppScriptEngineNamedObjectXferFields(scriptEngineSource);
  const tsScriptEngineNamedObjectFields = parseTsScriptEngineNamedObjectXferFields(tsRuntimeSave);
  if (cppScriptEngineNamedObjectFields.length > 0 && tsScriptEngineNamedObjectFields.length > 0) {
    categories.push(compareScriptEngineNamedObjectFields(
      cppScriptEngineNamedObjectFields,
      tsScriptEngineNamedObjectFields,
    ));
  }

  const tsScriptEngineScienceVectorFields = parseTsScriptEngineScienceVectorXferFields(tsRuntimeSave);
  if (cppScienceVectorFields.length > 0 && tsScriptEngineScienceVectorFields.length > 0) {
    categories.push(compareScriptEngineScienceVectorFields(
      cppScienceVectorFields,
      tsScriptEngineScienceVectorFields,
    ));
  }

  const objectTypesSource = zhObjectTypesCpp || genObjectTypesCpp;
  const cppObjectTypesFields = parseCppObjectTypesXferFields(objectTypesSource);
  const tsScriptEngineObjectTypeListFields = parseTsScriptEngineObjectTypeListXferFields(tsRuntimeSave);
  if (cppObjectTypesFields.length > 0 && tsScriptEngineObjectTypeListFields.length > 0) {
    categories.push(compareScriptEngineObjectTypeListFields(
      cppObjectTypesFields,
      tsScriptEngineObjectTypeListFields,
    ));
  }

  const cppScriptEngineStringCoordListFields = parseCppScriptEngineStringCoordListXferFields(scriptEngineSource);
  const tsScriptEngineStringCoordListFields = parseTsScriptEngineStringCoordListXferFields(tsRuntimeSave);
  if (cppScriptEngineStringCoordListFields.length > 0 && tsScriptEngineStringCoordListFields.length > 0) {
    categories.push(compareScriptEngineStringCoordListFields(
      cppScriptEngineStringCoordListFields,
      tsScriptEngineStringCoordListFields,
    ));
  }

  const cppTeamTemplateInfoFields = parseCppTeamTemplateInfoXferFields(teamSource);
  const tsTeamTemplateInfoFields = parseTsTeamTemplateInfoXferFields(tsRuntimeTeamFactory);
  if (cppTeamTemplateInfoFields.length > 0 && tsTeamTemplateInfoFields.length > 0) {
    categories.push(compareTeamTemplateInfoFields(cppTeamTemplateInfoFields, tsTeamTemplateInfoFields));
  }

  const cppTeamPrototypeFields = parseCppTeamPrototypeXferFields(teamSource);
  const tsTeamPrototypeFields = parseTsTeamPrototypeXferFields(tsRuntimeTeamFactory);
  if (cppTeamPrototypeFields.length > 0 && tsTeamPrototypeFields.length > 0) {
    categories.push(compareTeamPrototypeFields(cppTeamPrototypeFields, tsTeamPrototypeFields));
  }

  const cppTeamFields = parseCppTeamXferFields(teamSource);
  const tsTeamFields = parseTsTeamXferFields(tsRuntimeTeamFactory);
  if (cppTeamFields.length > 0 && tsTeamFields.length > 0) {
    categories.push(compareTeamFields(cppTeamFields, tsTeamFields));
  }

  return buildSourceParityReport(categories);
}

async function readFileOrEmpty(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return '';
  }
}

async function main(): Promise<void> {
  const scriptPath = fileURLToPath(import.meta.url);
  const rootDir = path.resolve(path.dirname(scriptPath), '..');
  const strict = process.argv.includes('--strict');

  const report = await runSourceParityCheck(rootDir);

  // Ensure output directory exists
  const outputDir = path.join(rootDir, 'test-results', 'parity');
  await fs.mkdir(outputDir, { recursive: true });

  const jsonPath = path.join(outputDir, 'source-parity.json');
  const mdPath = path.join(outputDir, 'source-parity.md');

  await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await fs.writeFile(mdPath, formatReportMarkdown(report), 'utf8');

  console.log(`Source parity report written: ${jsonPath}`);
  console.log(`Markdown summary: ${mdPath}`);
  console.log(`Status: ${report.status} (${report.summary.errors} errors, ${report.summary.warnings} warnings)`);

  for (const cat of report.categories) {
    const icon = cat.status === 'match' ? 'PASS' : cat.status === 'mismatch' ? 'FAIL' : 'WARN';
    console.log(`  ${icon}: ${cat.category} (${cat.mismatches.length} mismatches)`);
  }

  if (strict && report.status === 'fail') {
    process.exitCode = 1;
  }
}

const executedScriptPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
const currentScriptPath = fileURLToPath(import.meta.url);
if (executedScriptPath === currentScriptPath) {
  await main();
}
