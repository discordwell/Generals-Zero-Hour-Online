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
