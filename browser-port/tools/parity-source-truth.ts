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

  // Read TS port source
  const tsIndexPath = path.join(rootDir, 'packages/game-logic/src/index.ts');
  const tsIndex = await readFileOrEmpty(tsIndexPath);
  const tsRuntimeSavePath = path.join(rootDir, 'packages/app/src/runtime-save-game.ts');
  const tsRuntimeSave = await readFileOrEmpty(tsRuntimeSavePath);
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
