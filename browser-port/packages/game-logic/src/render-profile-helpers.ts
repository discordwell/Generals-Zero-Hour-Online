import type { IniBlock, IniValue } from '@generals/core';
import type { ObjectDef } from '@generals/ini-data';

import { readNumericField } from './ini-readers.js';
import type { RenderAnimationState, RenderAnimationStateClipCandidates } from './types.js';

/**
 * Idle animation variant — one of potentially many idle clips that are
 * randomly selected when the current idle finishes (source parity:
 * W3DAnimationInfo with m_isIdleAnim=true).
 */
export interface IdleAnimationVariant {
  animationName: string;
  /** Weight for weighted random selection (default 1). Higher = more likely. */
  randomWeight: number;
}

export interface ModelConditionInfo {
  conditionFlags: string[];
  /** Pre-computed sorted key for O(1) comparison in hot paths. */
  conditionKey?: string;
  /**
   * Source parity: m_conditionsYesVec — alternative condition flag arrays.
   * In C++, a single ModelConditionState can match multiple different
   * condition flag combinations (multiple ConditionsYes lines).
   * When present, the match loop iterates all sets.
   * Each inner array is one alternative set of condition flags.
   */
  conditionFlagSets?: string[][];
  modelName: string | null;
  animationName: string | null;
  idleAnimationName: string | null;
  hideSubObjects: string[];
  showSubObjects: string[];
  animationMode: 'LOOP' | 'ONCE' | 'MANUAL' | 'ONCE_BACKWARDS' | 'LOOP_BACKWARDS';
  /**
   * Source parity: TransitionKey — lowercase key used to look up transition
   * animations between states (e.g. "trans_open", "trans_close").
   */
  transitionKey: string | null;
  /**
   * Source parity: AnimationSpeedFactorRange min/max.
   * A random speed factor in [min, max] is applied each time the animation starts.
   */
  animSpeedFactorMin: number;
  animSpeedFactorMax: number;
  /**
   * Source parity: IdleAnimation entries — multiple idle clips that cycle
   * randomly when the previous one completes (ONCE mode).
   */
  idleAnimations: IdleAnimationVariant[];
}

/**
 * Source parity: TransitionState — an animation played during a transition
 * between two named condition states.
 * The C++ engine maps `buildTransitionSig(srcKey, dstKey)` to a
 * ModelConditionInfo-like entry with ONCE mode animation.
 */
export interface TransitionInfo {
  /** Source TransitionKey name (lowercase). */
  fromKey: string;
  /** Destination TransitionKey name (lowercase). */
  toKey: string;
  /** Optional model name override during transition. */
  modelName: string | null;
  /** Animation clip name to play during the transition. */
  animationName: string | null;
  /** Transition animations always use ONCE mode in source. */
  animationMode: 'ONCE';
  hideSubObjects: string[];
  showSubObjects: string[];
}

export interface ResolvedRenderAssetProfile {
  renderAssetCandidates: string[];
  renderAssetPath: string | null;
  renderAssetResolved: boolean;
  renderAnimationStateClips: RenderAnimationStateClipCandidates;
  modelConditionInfos: ModelConditionInfo[];
  /**
   * Source parity: TransitionMap — transition animations keyed by
   * "fromKey→toKey" signature string.
   */
  transitionInfos: TransitionInfo[];
  /**
   * Source parity: IgnoreConditionStates — condition flags that should be
   * stripped before matching ModelConditionStates.  Parsed from draw module
   * blocks (e.g. W3DModelDraw) rather than individual ModelConditionState blocks.
   */
  ignoreConditionStates: string[];
}

function isModelConditionStateBlockType(blockType: string): boolean {
  const normalized = blockType.toUpperCase();
  return normalized === 'MODELCONDITIONSTATE'
    || normalized === 'CONDITIONSTATE'
    || normalized === 'DEFAULTCONDITIONSTATE';
}

export function resolveRenderAssetProfile(
  objectDef: ObjectDef | undefined,
): ResolvedRenderAssetProfile {
  const renderAssetCandidates = collectRenderAssetCandidates(objectDef);
  const renderAssetPath = resolveRenderAssetPathFromCandidates(renderAssetCandidates);
  return {
    renderAssetCandidates,
    renderAssetPath,
    renderAssetResolved: renderAssetPath !== null,
    renderAnimationStateClips: collectRenderAnimationStateClips(objectDef),
    modelConditionInfos: collectModelConditionInfos(objectDef),
    transitionInfos: collectTransitionInfos(objectDef),
    ignoreConditionStates: collectIgnoreConditionStates(objectDef),
  };
}

export function resolveRenderAssetPathFromCandidates(renderAssetCandidates: readonly string[]): string | null {
  for (const candidate of renderAssetCandidates) {
    if (candidate.length === 0) {
      continue;
    }
    if (candidate.toUpperCase() === 'NONE') {
      continue;
    }
    return candidate;
  }
  return null;
}

interface PathfindObstacleContext {
  mapXyFactor: number;
  normalizeKindOf(kindOf: string[] | undefined): Set<string>;
  isMobileObject(objectDef: ObjectDef, kinds: Set<string>): boolean;
  isSmallGeometry(fields: Record<string, IniValue>): boolean;
}

export function shouldPathfindObstacle(
  objectDef: ObjectDef | undefined,
  context: PathfindObstacleContext,
): boolean {
  if (!objectDef) {
    return false;
  }

  const kinds = context.normalizeKindOf(objectDef.kindOf);
  const hasKindOf = (kind: string): boolean => kinds.has(kind);

  if (hasKindOf('MINE') || hasKindOf('PROJECTILE') || hasKindOf('BRIDGE_TOWER')) {
    return false;
  }

  if (!hasKindOf('STRUCTURE')) {
    return false;
  }

  if (context.isMobileObject(objectDef, kinds)) {
    return false;
  }

  if (context.isSmallGeometry(objectDef.fields)) {
    return false;
  }

  const heightAboveTerrain = readNumericField(objectDef.fields, ['HeightAboveTerrain', 'Height']);
  if (heightAboveTerrain !== null && heightAboveTerrain > context.mapXyFactor && !hasKindOf('BLAST_CRATER')) {
    return false;
  }

  return true;
}

function collectRenderAssetCandidates(objectDef: ObjectDef | undefined): string[] {
  if (!objectDef) {
    return [];
  }

  const candidates: string[] = [];
  candidates.push(...collectRenderAssetCandidatesInFields(objectDef.fields));

  for (const block of objectDef.blocks) {
    candidates.push(...collectRenderAssetCandidatesInBlock(block));
  }

  return candidates.filter((candidate) => candidate !== null).map((candidate) => candidate.trim()).filter(Boolean);
}

function collectRenderAssetCandidatesInBlock(block: IniBlock): string[] {
  const candidates = collectRenderAssetCandidatesInFields(block.fields);
  for (const childBlock of block.blocks) {
    candidates.push(...collectRenderAssetCandidatesInBlock(childBlock));
  }
  return candidates;
}

function collectRenderAssetCandidatesInFields(fields: Record<string, IniValue>): string[] {
  const candidateFieldNames = ['Model', 'ModelName', 'FileName'];
  const candidates: string[] = [];
  for (const fieldName of candidateFieldNames) {
    const value = readIniFieldValue(fields, fieldName);
    for (const tokenGroup of extractIniValueTokens(value)) {
      for (const token of tokenGroup) {
        if (typeof token === 'string') {
          const trimmed = token.trim();
          if (trimmed.length > 0) {
            candidates.push(trimmed);
          }
        }
      }
    }
  }
  return candidates;
}

export function collectModelConditionInfos(objectDef: ObjectDef | undefined): ModelConditionInfo[] {
  if (!objectDef) {
    return [];
  }

  const rawInfos: ModelConditionInfo[] = [];

  const visitBlock = (block: IniBlock): void => {
    const blockType = block.type.toUpperCase();
    if (isModelConditionStateBlockType(blockType)) {
      rawInfos.push(parseModelConditionStateBlock(block));
    } else if (blockType === 'ALIASCONDITIONSTATE' && rawInfos.length > 0) {
      const previous = rawInfos[rawInfos.length - 1]!;
      const conditionFlags = parseConditionStateName(block.name);
      rawInfos.push({
        ...previous,
        conditionFlags,
        conditionKey: conditionFlags.slice().sort().join('|'),
        conditionFlagSets: undefined,
      });
    }

    for (const childBlock of block.blocks) {
      visitBlock(childBlock);
    }
  };

  for (const block of objectDef.blocks) {
    visitBlock(block);
  }

  // Source parity: merge blocks that share the same visual output but differ
  // in condition flags into a single info with conditionFlagSets (mirrors
  // C++ m_conditionsYesVec.push_back()).
  return mergeConditionInfosByVisualKey(rawInfos);
}

/**
 * Build a string key that identifies the visual output of a ModelConditionInfo
 * (everything except the condition flags).
 */
function buildVisualKey(info: ModelConditionInfo): string {
  return [
    info.modelName ?? '',
    info.animationName ?? '',
    info.idleAnimationName ?? '',
    info.hideSubObjects.join(','),
    info.showSubObjects.join(','),
    info.animationMode,
    info.transitionKey ?? '',
    String(info.animSpeedFactorMin),
    String(info.animSpeedFactorMax),
    info.idleAnimations.map(v => `${v.animationName}:${v.randomWeight}`).join(','),
  ].join('\0');
}

/**
 * Merge infos that share the same visual output into a single info with
 * conditionFlagSets containing all the alternative flag arrays.
 */
function mergeConditionInfosByVisualKey(infos: ModelConditionInfo[]): ModelConditionInfo[] {
  if (infos.length <= 1) {
    return infos;
  }

  const keyToGroup = new Map<string, ModelConditionInfo[]>();
  const orderKeys: string[] = [];

  for (const info of infos) {
    const key = buildVisualKey(info);
    const group = keyToGroup.get(key);
    if (group) {
      group.push(info);
    } else {
      keyToGroup.set(key, [info]);
      orderKeys.push(key);
    }
  }

  const merged: ModelConditionInfo[] = [];
  for (const key of orderKeys) {
    const group = keyToGroup.get(key)!;
    if (group.length === 1) {
      merged.push(group[0]!);
    } else {
      // Merge: use the first info as the base, add all flag sets.
      const base = group[0]!;
      const flagSets = group.map(g => g.conditionFlags);
      merged.push({
        ...base,
        // Primary conditionFlags stays as the first set for backward compat.
        conditionFlags: base.conditionFlags,
        conditionKey: base.conditionFlags.slice().sort().join('|'),
        conditionFlagSets: flagSets,
      });
    }
  }
  return merged;
}

function parseModelConditionStateBlock(block: IniBlock): ModelConditionInfo {
  const conditionFlags = parseConditionStateName(block.name);

  const modelName = readFirstStringToken(block.fields, 'Model')
    ?? readFirstStringToken(block.fields, 'ModelName');
  const animationName = readFirstStringToken(block.fields, 'Animation');
  const idleAnimationName = readFirstStringToken(block.fields, 'IdleAnimation');

  const hideSubObjects = collectAllStringTokens(block.fields, 'HideSubObject');
  const showSubObjects = collectAllStringTokens(block.fields, 'ShowSubObject');

  const animationModeRaw = readFirstStringToken(block.fields, 'AnimationMode');
  let animationMode: 'LOOP' | 'ONCE' | 'MANUAL' | 'ONCE_BACKWARDS' | 'LOOP_BACKWARDS' = 'LOOP';
  if (animationModeRaw) {
    const normalized = animationModeRaw.toUpperCase();
    if (normalized === 'ONCE') {
      animationMode = 'ONCE';
    } else if (normalized === 'MANUAL') {
      animationMode = 'MANUAL';
    } else if (normalized === 'ONCE_BACKWARDS') {
      animationMode = 'ONCE_BACKWARDS';
    } else if (normalized === 'LOOP_BACKWARDS') {
      animationMode = 'LOOP_BACKWARDS';
    }
  }

  // Source parity: TransitionKey — lowercase name key for transition lookups.
  const transitionKeyRaw = readFirstStringToken(block.fields, 'TransitionKey');
  const transitionKey = transitionKeyRaw ? transitionKeyRaw.toLowerCase() : null;

  // Source parity: AnimationSpeedFactorRange min max
  const speedFactorRange = readNumericRangeFromField(block.fields, 'AnimationSpeedFactorRange');
  const animSpeedFactorMin = speedFactorRange ? speedFactorRange[0] : 1.0;
  const animSpeedFactorMax = speedFactorRange ? speedFactorRange[1] : 1.0;

  // Source parity: IdleAnimation entries — multiple idle clips with optional weight.
  // INI format: IdleAnimation = AnimName [DistanceCovered] [TimesToRepeat]
  // We collect all IdleAnimation values as idle animation variants.
  const idleAnimations = collectIdleAnimationVariants(block.fields);

  return {
    conditionFlags,
    conditionKey: conditionFlags.slice().sort().join('|'),
    modelName: modelName ?? null,
    animationName: animationName ?? null,
    idleAnimationName: idleAnimationName ?? null,
    hideSubObjects,
    showSubObjects,
    animationMode,
    transitionKey,
    animSpeedFactorMin,
    animSpeedFactorMax,
    idleAnimations,
  };
}

function parseConditionStateName(name: string): string[] {
  return name.trim().length > 0
    ? name.trim().split(/\s+/)
    : [];
}

function readFirstStringToken(fields: Record<string, IniValue>, fieldName: string): string | undefined {
  const value = readIniFieldValue(fields, fieldName);
  const groups = extractIniValueTokens(value);
  for (const group of groups) {
    for (const token of group) {
      if (typeof token === 'string' && token.trim().length > 0) {
        return token.trim();
      }
    }
  }
  return undefined;
}

function collectAllStringTokens(fields: Record<string, IniValue>, fieldName: string): string[] {
  const value = readIniFieldValue(fields, fieldName);
  const tokens: string[] = [];
  for (const group of extractIniValueTokens(value)) {
    for (const token of group) {
      if (typeof token === 'string') {
        const trimmed = token.trim();
        if (trimmed.length > 0) {
          tokens.push(trimmed);
        }
      }
    }
  }
  return tokens;
}

/**
 * Read a two-element numeric range from a field (e.g., "AnimationSpeedFactorRange = 0.8 1.2").
 */
function readNumericRangeFromField(fields: Record<string, IniValue>, fieldName: string): [number, number] | null {
  const value = readIniFieldValue(fields, fieldName);
  if (value === undefined || value === null) {
    return null;
  }
  const tokens: number[] = [];
  for (const group of extractIniValueTokens(value)) {
    for (const token of group) {
      if (typeof token === 'string') {
        const num = parseFloat(token);
        if (Number.isFinite(num)) {
          tokens.push(num);
        }
      }
    }
  }
  if (tokens.length >= 2) {
    return [tokens[0]!, tokens[1]!];
  }
  if (tokens.length === 1) {
    return [tokens[0]!, tokens[0]!];
  }
  return null;
}

/**
 * Collect IdleAnimation variants from INI fields.
 * Source parity: each `IdleAnimation` line produces a W3DAnimationInfo with
 * m_isIdleAnim=true. The optional second token is DistanceCovered (ignored here)
 * and third token is TimesToRepeat (used as weight hint).
 */
function collectIdleAnimationVariants(fields: Record<string, IniValue>): IdleAnimationVariant[] {
  const value = readIniFieldValue(fields, 'IdleAnimation');
  if (value === undefined || value === null) {
    return [];
  }

  const variants: IdleAnimationVariant[] = [];

  for (const tokens of extractIniValueTokens(value)) {
    const variant = parseIdleAnimationTokens(tokens);
    if (variant) {
      variants.push(variant);
    }
  }

  return variants;
}

function parseIdleAnimationTokens(parts: readonly string[]): IdleAnimationVariant | null {
  const animName = parts[0]?.trim();
  if (!animName || animName.length === 0) {
    return null;
  }
  // Third token is the repeat/weight value (source: timesToRepeat parameter).
  const weight = parts.length >= 3 ? parseInt(parts[2]!, 10) : 1;
  return {
    animationName: animName,
    randomWeight: Number.isFinite(weight) && weight > 0 ? weight : 1,
  };
}

/**
 * Collect TransitionState blocks from the INI object definition.
 * Source parity: W3DModelDrawModuleData::parseConditionState with PARSE_TRANSITION.
 * TransitionState blocks have two name tokens: "fromKey toKey".
 */
export function collectTransitionInfos(objectDef: ObjectDef | undefined): TransitionInfo[] {
  if (!objectDef) {
    return [];
  }

  const infos: TransitionInfo[] = [];

  const visitBlock = (block: IniBlock, defaultInfo: ModelConditionInfo | null): void => {
    const childDefaultInfo = findDefaultConditionInfo(block) ?? defaultInfo;
    if (block.type.toUpperCase() === 'TRANSITIONSTATE') {
      const parsed = parseTransitionStateBlock(block, defaultInfo);
      if (parsed) {
        infos.push(parsed);
      }
    }

    for (const childBlock of block.blocks) {
      visitBlock(childBlock, childDefaultInfo);
    }
  };

  for (const block of objectDef.blocks) {
    visitBlock(block, null);
  }

  return infos;
}

function findDefaultConditionInfo(block: IniBlock): ModelConditionInfo | null {
  for (const childBlock of block.blocks) {
    if (childBlock.type.toUpperCase() === 'DEFAULTCONDITIONSTATE') {
      return parseModelConditionStateBlock(childBlock);
    }
  }
  return null;
}

function parseTransitionStateBlock(block: IniBlock, defaultInfo: ModelConditionInfo | null): TransitionInfo | null {
  const tokens = block.name.trim().split(/\s+/);
  if (tokens.length < 2) {
    return null;
  }
  const fromKey = tokens[0]!.toLowerCase();
  const toKey = tokens[1]!.toLowerCase();
  if (fromKey === toKey) {
    return null;
  }

  const modelName = readFirstStringToken(block.fields, 'Model')
    ?? readFirstStringToken(block.fields, 'ModelName');
  const animationName = readFirstStringToken(block.fields, 'Animation');
  const hideSubObjects = collectAllStringTokens(block.fields, 'HideSubObject');
  const showSubObjects = collectAllStringTokens(block.fields, 'ShowSubObject');

  return {
    fromKey,
    toKey,
    modelName: modelName ?? defaultInfo?.modelName ?? null,
    animationName: animationName ?? defaultInfo?.animationName ?? null,
    animationMode: 'ONCE',
    hideSubObjects: [...(defaultInfo?.hideSubObjects ?? []), ...hideSubObjects],
    showSubObjects: [...(defaultInfo?.showSubObjects ?? []), ...showSubObjects],
  };
}

/**
 * Collect IgnoreConditionStates from draw module blocks.
 * Source parity: W3DModelDrawModuleData stores IgnoreConditionStates at the
 * draw module level (not inside individual ModelConditionState blocks).
 * These flags are stripped from the active condition set before matching.
 */
export function collectIgnoreConditionStates(objectDef: ObjectDef | undefined): string[] {
  if (!objectDef) {
    return [];
  }

  const ignored: string[] = [];

  const visitBlock = (block: IniBlock): void => {
    // IgnoreConditionStates lives on draw module blocks (the parent blocks
    // containing ModelConditionState children), not on ModelConditionState itself.
    const hasChildModelConditionState = block.blocks.some(
      child => isModelConditionStateBlockType(child.type),
    );
    if (hasChildModelConditionState) {
      const tokens = collectAllStringTokens(block.fields, 'IgnoreConditionStates');
      for (const token of tokens) {
        if (!ignored.includes(token)) {
          ignored.push(token);
        }
      }
    }

    for (const childBlock of block.blocks) {
      visitBlock(childBlock);
    }
  };

  for (const block of objectDef.blocks) {
    visitBlock(block);
  }

  return ignored;
}

function collectRenderAnimationStateClips(objectDef: ObjectDef | undefined): RenderAnimationStateClipCandidates {
  if (!objectDef) {
    return {};
  }

  const renderAnimationStateClips: RenderAnimationStateClipCandidates = {};
  const used = new Map<RenderAnimationState, Set<string>>();

  const addClip = (state: RenderAnimationState, clipName: string): void => {
    const trimmed = clipName.trim();
    if (!trimmed || trimmed.toUpperCase() === 'NONE') {
      return;
    }
    const seen = used.get(state) ?? new Set<string>();
    const canonical = trimmed.toUpperCase();
    if (seen.has(canonical)) {
      return;
    }
    seen.add(canonical);
    used.set(state, seen);
    renderAnimationStateClips[state] = renderAnimationStateClips[state] ?? [];
    renderAnimationStateClips[state]!.push(trimmed);
  };

  const visitBlock = (block: IniBlock): void => {
    if (isModelConditionStateBlockType(block.type)) {
      const inferredStateFromName = inferRenderAnimationStateFromConditionStateName(block.name);
      for (const [fieldName, fieldValue] of Object.entries(block.fields)) {
        const inferredState = inferRenderAnimationStateFromFieldName(
          fieldName,
          inferredStateFromName,
        );
        if (!inferredState) {
          continue;
        }

        // Source parity: W3DModelDraw::parseConditionState uses parseAnimation
        // for Animation/IdleAnimation. W3DAnimationInfo stores the first token
        // as m_name and optional later tokens as distance/repeat metadata, so
        // only the first non-empty token in each INI entry is an animation clip.
        for (const tokenGroup of extractIniValueTokens(fieldValue)) {
          const clipName = tokenGroup.find((token) => typeof token === 'string' && token.trim().length > 0);
          if (clipName) {
            addClip(inferredState, clipName);
          }
        }
      }
    }

    for (const childBlock of block.blocks) {
      visitBlock(childBlock);
    }
  };

  for (const block of objectDef.blocks) {
    visitBlock(block);
  }

  return renderAnimationStateClips;
}

function inferRenderAnimationStateFromFieldName(
  fieldName: string,
  fallback: RenderAnimationState | null,
): RenderAnimationState | null {
  const normalizedFieldName = fieldName.toUpperCase();
  // Source parser supports only `Animation` and `IdleAnimation` for condition-state
  // clips (see W3DModelDraw::parseConditionState).
  if (normalizedFieldName === 'ANIMATION') {
    return fallback;
  }
  if (normalizedFieldName === 'IDLEANIMATION') {
    return 'IDLE';
  }
  return null;
}

function inferRenderAnimationStateFromConditionStateName(conditionStateName: string): RenderAnimationState | null {
  const normalizedConditionStateName = conditionStateName.toUpperCase();
  if (
    normalizedConditionStateName.includes('ATTACK')
    || normalizedConditionStateName.includes('FIRING')
    || normalizedConditionStateName.includes('PREATTACK')
    || normalizedConditionStateName.includes('RELOADING')
    || normalizedConditionStateName.includes('BETWEEN_FIRING_SHOTS')
    || normalizedConditionStateName.includes('USING_WEAPON')
  ) {
    return 'ATTACK';
  }
  if (normalizedConditionStateName.includes('MOVE') || normalizedConditionStateName.includes('RUN')
    || normalizedConditionStateName.includes('WALK')
    || normalizedConditionStateName.includes('MOVING')) {
    return 'MOVE';
  }
  if (
    normalizedConditionStateName.includes('DEATH')
    || normalizedConditionStateName.includes('DIE')
    || normalizedConditionStateName.includes('DEAD')
    || normalizedConditionStateName.includes('DESTROY')
    || normalizedConditionStateName.includes('DYING')
  ) {
    return 'DIE';
  }
  if (
    normalizedConditionStateName.includes('IDLE')
    || normalizedConditionStateName.includes('STAND')
    || normalizedConditionStateName.includes('DEFAULT')
    || normalizedConditionStateName.includes('NORMAL')
  ) {
    return 'IDLE';
  }
  return null;
}

function extractIniValueTokens(value: IniValue | undefined): string[][] {
  if (typeof value === 'undefined') {
    return [];
  }
  if (value === null) {
    return [];
  }
  if (typeof value === 'string') {
    const tokens = value.split(/[\s,;|]+/).map((token) => token.trim()).filter(Boolean);
    return tokens.length > 0 ? [tokens] : [];
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return [[String(value)]];
  }
  if (Array.isArray(value)) {
    if (value.some((entry) => Array.isArray(entry))) {
      return value.flatMap((entry) => extractIniValueTokens(entry as IniValue));
    }
    const stringElems: string[] = [];
    for (const entry of value) {
      if (typeof entry === 'string') {
        stringElems.push(entry);
      }
    }
    const anyMultiTokenString = stringElems.some((entry) => /\s/.test(entry));
    if (anyMultiTokenString) {
      return value.flatMap((entry) => extractIniValueTokens(entry as IniValue));
    }
    const inlineTokens: string[] = [];
    for (const entry of value) {
      if (typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean') {
        const token = String(entry).trim();
        if (token.length > 0) {
          inlineTokens.push(token);
        }
      }
    }
    return inlineTokens.length > 0 ? [inlineTokens] : [];
  }
  return [];
}

function readIniFieldValue(fields: Record<string, IniValue>, fieldName: string): IniValue | undefined {
  const normalizedFieldName = fieldName.toUpperCase();
  for (const [name, value] of Object.entries(fields)) {
    if (name.toUpperCase() === normalizedFieldName) {
      return value;
    }
  }
  return undefined;
}
