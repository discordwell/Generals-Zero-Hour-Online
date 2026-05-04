import type { IniBlock, IniValue } from '@generals/core';
import type { ObjectDef } from '@generals/ini-data';

import { readNumericField } from './ini-readers.js';

export type BuildableStatus = 'YES' | 'IGNORE_PREREQUISITES' | 'NO' | 'ONLY_BY_AI';

export interface ProductionPrerequisiteGroup {
  objectAlternatives: string[];
  scienceRequirements: string[];
}

type ExtractIniValueTokens = (value: IniValue | undefined) => string[][];

export function resolveBuildableStatus(
  objectDef: Pick<ObjectDef, 'fields'>,
  extractIniValueTokens: ExtractIniValueTokens,
): BuildableStatus {
  const tokens = extractIniValueTokens(objectDef.fields['Buildable']).flatMap((group) => group);
  const token = tokens[0]?.trim().toUpperCase() ?? '';
  if (token === 'IGNORE_PREREQUISITES') {
    return 'IGNORE_PREREQUISITES';
  }
  if (token === 'NO') {
    return 'NO';
  }
  if (token === 'ONLY_BY_AI') {
    return 'ONLY_BY_AI';
  }
  if (token === 'YES') {
    return 'YES';
  }

  const numericStatus = readNumericField(objectDef.fields, ['Buildable']);
  if (numericStatus !== null) {
    const normalized = Math.trunc(numericStatus);
    if (normalized === 1) {
      return 'IGNORE_PREREQUISITES';
    }
    if (normalized === 2) {
      return 'NO';
    }
    if (normalized === 3) {
      return 'ONLY_BY_AI';
    }
    return 'YES';
  }

  return 'YES';
}

export function extractProductionPrerequisiteGroups(
  objectDef: Pick<ObjectDef, 'fields' | 'blocks'>,
  extractIniValueTokens: ExtractIniValueTokens,
): ProductionPrerequisiteGroup[] {
  const groups: ProductionPrerequisiteGroup[] = [];

  const addObjectGroup = (names: string[]): void => {
    const normalized = names
      .map((name) => name.trim().toUpperCase())
      .filter((name) => name.length > 0 && name !== 'NONE');
    if (normalized.length === 0) {
      return;
    }
    groups.push({ objectAlternatives: normalized, scienceRequirements: [] });
  };

  const addScienceGroup = (names: string[]): void => {
    const normalized = names
      .map((name) => name.trim().toUpperCase())
      .filter((name) => name.length > 0 && name !== 'NONE');
    if (normalized.length === 0) {
      return;
    }
    groups.push({ objectAlternatives: [], scienceRequirements: normalized });
  };

  const parseTokensAsPrereqGroup = (tokens: string[]): void => {
    if (tokens.length === 0) {
      return;
    }
    const head = tokens[0]?.trim().toUpperCase() ?? '';
    const tail = tokens.slice(1);
    if (head === 'OBJECT') {
      addObjectGroup(tail);
    } else if (head === 'SCIENCE') {
      addScienceGroup(tail);
    }
  };

  const parsePrereqValueWithPrefix = (prefix: 'OBJECT' | 'SCIENCE', value: IniValue | undefined): void => {
    const tokens = extractIniValueTokens(value).flatMap((group) => group);
    if (tokens.length === 0) {
      return;
    }
    if (prefix === 'OBJECT') {
      addObjectGroup(tokens);
    } else {
      addScienceGroup(tokens);
    }
  };

  for (const tokens of extractIniValueTokens(objectDef.fields['Prerequisites'])) {
    parseTokensAsPrereqGroup(tokens);
  }
  for (const tokens of extractIniValueTokens(objectDef.fields['Prerequisite'])) {
    parseTokensAsPrereqGroup(tokens);
  }

  const visitBlock = (block: IniBlock): void => {
    const blockType = block.type.toUpperCase();
    if (blockType === 'PREREQUISITE' || blockType === 'PREREQUISITES') {
      const headerTokens = block.name
        .split(/[\s,;|]+/)
        .map((token) => token.trim())
        .filter((token) => token.length > 0);
      parseTokensAsPrereqGroup(headerTokens);

      parsePrereqValueWithPrefix('OBJECT', block.fields['Object']);
      parsePrereqValueWithPrefix('SCIENCE', block.fields['Science']);
      parsePrereqValueWithPrefix('OBJECT', block.fields['OBJECT']);
      parsePrereqValueWithPrefix('SCIENCE', block.fields['SCIENCE']);
    }

    if (blockType === 'OBJECT') {
      const names = block.name
        .split(/[\s,;|]+/)
        .map((token) => token.trim())
        .filter((token) => token.length > 0);
      if (names.length > 0) {
        addObjectGroup(names);
      }
    } else if (blockType === 'SCIENCE') {
      const sciences = block.name
        .split(/[\s,;|]+/)
        .map((token) => token.trim())
        .filter((token) => token.length > 0);
      if (sciences.length > 0) {
        addScienceGroup(sciences);
      }
    }

    for (const child of block.blocks) {
      visitBlock(child);
    }
  };

  for (const block of objectDef.blocks) {
    visitBlock(block);
  }

  return groups;
}
