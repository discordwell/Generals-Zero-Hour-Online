import type { IniDataRegistry, SpecialPowerDef } from '@generals/ini-data';

import { readBooleanField, readNumericField, readStringField } from './ini-readers.js';
import type { IssueSpecialPowerCommand } from './types.js';

const RELATIONSHIP_ENEMIES = 0;
const RELATIONSHIP_NEUTRAL = 1;
const RELATIONSHIP_ALLIES = 2;
const COMMAND_OPTION_NEED_TARGET_ENEMY_OBJECT = 0x00000001;
const COMMAND_OPTION_NEED_TARGET_NEUTRAL_OBJECT = 0x00000002;
const COMMAND_OPTION_NEED_TARGET_ALLY_OBJECT = 0x00000004;
const COMMAND_OPTION_NEED_TARGET_POS = 0x00000020;
const COMMAND_OPTION_NEED_OBJECT_TARGET = COMMAND_OPTION_NEED_TARGET_ENEMY_OBJECT
  | COMMAND_OPTION_NEED_TARGET_NEUTRAL_OBJECT
  | COMMAND_OPTION_NEED_TARGET_ALLY_OBJECT;
type SpecialPowerCommandSource = NonNullable<IssueSpecialPowerCommand['commandSource']>;

// Source parity: ActionManager::canDoSpecialPowerAtLocation.
const LOCATION_TARGET_SHROUD_RESTRICTED_SPECIAL_POWERS = new Set<string>([
  'SPECIAL_DAISY_CUTTER',
  'SPECIAL_PARADROP_AMERICA',
  'SPECIAL_CARPET_BOMB',
  'SPECIAL_CLUSTER_MINES',
  'SPECIAL_EMP_PULSE',
  'SPECIAL_CRATE_DROP',
  'SPECIAL_NAPALM_STRIKE',
  'SPECIAL_BLACK_MARKET_NUKE',
  'SPECIAL_ANTHRAX_BOMB',
  'SPECIAL_TERROR_CELL',
  'SPECIAL_AMBUSH',
  'SPECIAL_NEUTRON_MISSILE',
  'SPECIAL_SCUD_STORM',
  'SPECIAL_DEMORALIZE',
  'SPECIAL_A10_THUNDERBOLT_STRIKE',
  'SPECIAL_REPAIR_VEHICLES',
  'SPECIAL_ARTILLERY_BARRAGE',
  'SPECIAL_PARTICLE_UPLINK_CANNON',
  'SPECIAL_CLEANUP_AREA',
]);
const LOCATION_TARGET_REJECTS_UNDERWATER_SPECIAL_POWERS = new Set<string>([
  'SPECIAL_PARADROP_AMERICA',
  'SPECIAL_CRATE_DROP',
]);
const LOCATION_TARGET_UNRESTRICTED_SPECIAL_POWERS = new Set<string>([
  'SPECIAL_SPY_SATELLITE',
  'SPECIAL_RADAR_VAN_SCAN',
  'SPECIAL_SPY_DRONE',
  'SPECIAL_LAUNCH_BAIKONUR_ROCKET',
]);
const LOCATION_TARGET_SPECIAL_POWERS = new Set<string>([
  ...LOCATION_TARGET_SHROUD_RESTRICTED_SPECIAL_POWERS,
  ...LOCATION_TARGET_UNRESTRICTED_SPECIAL_POWERS,
]);
const OBJECT_TARGET_SPECIAL_POWERS = new Set<string>([
  'SPECIAL_MISSILE_DEFENDER_LASER_GUIDED_MISSILES',
  'SPECIAL_HACKER_DISABLE_BUILDING',
  'SPECIAL_TANKHUNTER_TNT_ATTACK',
  'SPECIAL_CASH_HACK',
  'SPECIAL_DEFECTOR',
  'SPECIAL_BLACKLOTUS_CAPTURE_BUILDING',
  'SPECIAL_BLACKLOTUS_DISABLE_VEHICLE_HACK',
  'SPECIAL_BLACKLOTUS_STEAL_CASH_HACK',
  'SPECIAL_INFANTRY_CAPTURE_BUILDING',
  'SPECIAL_DISGUISE_AS_VEHICLE',
  'SPECIAL_REMOTE_CHARGES',
  'SPECIAL_TIMED_CHARGES',
]);
const NO_TARGET_SPECIAL_POWERS = new Set<string>([
  'SPECIAL_REMOTE_CHARGES',
  'SPECIAL_CIA_INTELLIGENCE',
  'SPECIAL_DETONATE_DIRTY_NUKE',
  'SPECIAL_CHANGE_BATTLE_PLANS',
  'SPECIAL_LAUNCH_BAIKONUR_ROCKET',
]);

interface SpecialPowerCommandEntity {
  id: number;
  destroyed: boolean;
}

interface SpecialPowerCommandContext<TEntity extends SpecialPowerCommandEntity> {
  readonly iniDataRegistry: IniDataRegistry | null;
  readonly frameCounter: number;
  readonly selectedEntityId: number | null;
  readonly spawnedEntities: ReadonlyMap<number, TEntity>;
  msToLogicFrames(milliseconds: number): number;
  resolveShortcutSpecialPowerSourceEntityId(specialPowerName: string): number | null;
  resolveSharedReadyFrame(specialPowerName: string): number;
  resolveSourceReadyFrameBySource(specialPowerName: string, sourceEntityId: number): number;
  setReadyFrame(
    specialPowerName: string,
    sourceEntityId: number,
    isShared: boolean,
    readyFrame: number,
  ): void;
  isObjectShroudedForAction(
    sourceEntity: TEntity,
    targetEntity: TEntity,
    commandSource: SpecialPowerCommandSource,
  ): boolean;
  isObjectEffectivelyDead(targetEntity: TEntity): boolean;
  isObjectTargetAllowedForSpecialPower(
    sourceEntity: TEntity,
    targetEntity: TEntity,
    specialPowerEnum: string | null,
    commandSource: SpecialPowerCommandSource,
  ): boolean;
  isPositionUnderwater(targetX: number, targetZ: number): boolean;
  isLocationShroudedForAction(sourceEntity: TEntity, targetX: number, targetZ: number): boolean;
  getTeamRelationship(sourceEntity: TEntity, targetEntity: TEntity): number;
  onIssueSpecialPowerNoTarget(
    sourceEntityId: number,
    specialPowerName: string,
    commandOption: number,
    commandButtonId: string,
    specialPowerDef: SpecialPowerDef,
  ): boolean;
  onIssueSpecialPowerTargetPosition(
    sourceEntityId: number,
    specialPowerName: string,
    targetX: number,
    targetZ: number,
    commandOption: number,
    commandButtonId: string,
    specialPowerDef: SpecialPowerDef,
  ): boolean;
  onIssueSpecialPowerTargetObject(
    sourceEntityId: number,
    specialPowerName: string,
    targetEntityId: number,
    commandOption: number,
    commandButtonId: string,
    specialPowerDef: SpecialPowerDef,
  ): boolean;
}

type NormalizeShortcutSpecialPowerName = (specialPowerName: string) => string | null;

type TrackShortcutSpecialPowerSourceEntity = (
  specialPowerName: string,
  sourceEntityId: number,
  readyFrame: number,
) => boolean;
type SpecialPowerDispatchMode = 'NO_TARGET' | 'POSITION' | 'OBJECT';

function resolveSpecialPowerEnum(specialPowerDef: SpecialPowerDef): string | null {
  const enumToken = readStringField(specialPowerDef.fields, ['Enum'])?.trim().toUpperCase() ?? '';
  return enumToken.length > 0 ? enumToken : null;
}

function shouldApplyLocationShroudGate(specialPowerEnum: string | null): boolean {
  if (!specialPowerEnum) {
    return false;
  }
  if (LOCATION_TARGET_UNRESTRICTED_SPECIAL_POWERS.has(specialPowerEnum)) {
    return false;
  }
  return LOCATION_TARGET_SHROUD_RESTRICTED_SPECIAL_POWERS.has(specialPowerEnum);
}

function isDispatchModeAllowedForSpecialPowerEnum(
  specialPowerEnum: string | null,
  dispatchMode: SpecialPowerDispatchMode,
): boolean {
  if (!specialPowerEnum) {
    return true;
  }
  if (dispatchMode === 'OBJECT') {
    return OBJECT_TARGET_SPECIAL_POWERS.has(specialPowerEnum);
  }
  if (dispatchMode === 'POSITION') {
    return LOCATION_TARGET_SPECIAL_POWERS.has(specialPowerEnum);
  }
  return NO_TARGET_SPECIAL_POWERS.has(specialPowerEnum);
}

function resolveIssueSpecialPowerSourceEntityId<TEntity extends SpecialPowerCommandEntity>(
  command: IssueSpecialPowerCommand,
  normalizedSpecialPowerName: string,
  context: SpecialPowerCommandContext<TEntity>,
): number | null {
  if (Number.isFinite(command.sourceEntityId)) {
    const explicitSourceEntityId = Math.trunc(command.sourceEntityId as number);
    const explicitSourceEntity = context.spawnedEntities.get(explicitSourceEntityId);
    if (explicitSourceEntity && !explicitSourceEntity.destroyed) {
      return explicitSourceEntityId;
    }
  }

  if (command.issuingEntityIds.length > 0) {
    for (const rawEntityId of command.issuingEntityIds) {
      if (!Number.isFinite(rawEntityId)) {
        continue;
      }
      const candidateId = Math.trunc(rawEntityId);
      const candidateEntity = context.spawnedEntities.get(candidateId);
      if (candidateEntity && !candidateEntity.destroyed) {
        return candidateId;
      }
    }
  }

  const shortcutSourceEntityId = context.resolveShortcutSpecialPowerSourceEntityId(normalizedSpecialPowerName);
  if (shortcutSourceEntityId !== null) {
    const shortcutSourceEntity = context.spawnedEntities.get(shortcutSourceEntityId);
    if (shortcutSourceEntity && !shortcutSourceEntity.destroyed) {
      return shortcutSourceEntityId;
    }
  }

  const selectedEntity = context.selectedEntityId !== null
    ? context.spawnedEntities.get(context.selectedEntityId)
    : null;
  if (selectedEntity && !selectedEntity.destroyed) {
    return selectedEntity.id;
  }

  return null;
}

export function isSpecialPowerObjectRelationshipAllowed(
  commandOption: number,
  relationship: number,
): boolean {
  const requiresEnemy = (commandOption & COMMAND_OPTION_NEED_TARGET_ENEMY_OBJECT) !== 0;
  const requiresNeutral = (commandOption & COMMAND_OPTION_NEED_TARGET_NEUTRAL_OBJECT) !== 0;
  const requiresAlly = (commandOption & COMMAND_OPTION_NEED_TARGET_ALLY_OBJECT) !== 0;

  if (!requiresEnemy && !requiresNeutral && !requiresAlly) {
    return true;
  }

  if (requiresEnemy && relationship === RELATIONSHIP_ENEMIES) {
    return true;
  }
  if (requiresNeutral && relationship === RELATIONSHIP_NEUTRAL) {
    return true;
  }
  if (requiresAlly && relationship === RELATIONSHIP_ALLIES) {
    return true;
  }

  return false;
}

export function resolveSharedShortcutSpecialPowerReadyFrame(
  specialPowerName: string,
  frameCounter: number,
  sharedShortcutSpecialPowerReadyFrames: ReadonlyMap<string, number>,
  normalizeShortcutSpecialPowerName: NormalizeShortcutSpecialPowerName,
): number {
  const normalizedSpecialPowerName = normalizeShortcutSpecialPowerName(specialPowerName);
  if (!normalizedSpecialPowerName) {
    return frameCounter;
  }

  const sharedReadyFrame = sharedShortcutSpecialPowerReadyFrames.get(normalizedSpecialPowerName);
  if (sharedReadyFrame === undefined || !Number.isFinite(sharedReadyFrame)) {
    // Source parity: shared special powers are player-global and start at frame 0 (ready immediately)
    // unless explicitly started by prior usage.
    return frameCounter;
  }

  return Math.max(0, Math.trunc(sharedReadyFrame));
}

export function resolveShortcutSpecialPowerSourceEntityReadyFrameBySource(
  specialPowerName: string,
  sourceEntityId: number,
  frameCounter: number,
  shortcutSpecialPowerSourceByName: ReadonlyMap<string, ReadonlyMap<number, number>>,
  normalizeShortcutSpecialPowerName: NormalizeShortcutSpecialPowerName,
): number {
  const normalizedSpecialPowerName = normalizeShortcutSpecialPowerName(specialPowerName);
  if (!normalizedSpecialPowerName || !Number.isFinite(sourceEntityId)) {
    return frameCounter;
  }

  const normalizedSourceEntityId = Math.trunc(sourceEntityId);
  const sourcesForPower = shortcutSpecialPowerSourceByName.get(normalizedSpecialPowerName);
  if (!sourcesForPower) {
    return frameCounter;
  }

  const readyFrame = sourcesForPower.get(normalizedSourceEntityId);
  if (readyFrame === undefined || !Number.isFinite(readyFrame)) {
    return frameCounter;
  }

  return Math.max(0, Math.trunc(readyFrame));
}

export function setSpecialPowerReadyFrame(
  specialPowerName: string,
  sourceEntityId: number,
  isShared: boolean,
  readyFrame: number,
  frameCounter: number,
  sharedShortcutSpecialPowerReadyFrames: Map<string, number>,
  normalizeShortcutSpecialPowerName: NormalizeShortcutSpecialPowerName,
  trackShortcutSpecialPowerSourceEntity: TrackShortcutSpecialPowerSourceEntity,
): void {
  const normalizedSpecialPowerName = normalizeShortcutSpecialPowerName(specialPowerName);
  if (!normalizedSpecialPowerName) {
    return;
  }

  if (!Number.isFinite(readyFrame)) {
    return;
  }

  const normalizedReadyFrame = Math.max(frameCounter, Math.trunc(readyFrame));
  if (isShared) {
    sharedShortcutSpecialPowerReadyFrames.set(normalizedSpecialPowerName, normalizedReadyFrame);
    return;
  }

  trackShortcutSpecialPowerSourceEntity(normalizedSpecialPowerName, sourceEntityId, normalizedReadyFrame);
}

export function routeIssueSpecialPowerCommand<TEntity extends SpecialPowerCommandEntity>(
  command: IssueSpecialPowerCommand,
  context: SpecialPowerCommandContext<TEntity>,
): void {
  const registry = context.iniDataRegistry;
  if (!registry) {
    return;
  }

  const normalizedSpecialPowerName = command.specialPowerName.trim().toUpperCase();
  if (!normalizedSpecialPowerName) {
    return;
  }

  // Try normalized name first, then original name (registry may store with original casing).
  const specialPowerDef = registry.getSpecialPower(normalizedSpecialPowerName)
    ?? registry.getSpecialPower(command.specialPowerName.trim());
  if (!specialPowerDef) {
    return;
  }

  const reloadFrames = context.msToLogicFrames(readNumericField(specialPowerDef.fields, ['ReloadTime']) ?? 0);
  const isSharedSynced = readBooleanField(specialPowerDef.fields, ['SharedSyncedTimer']) === true;

  const sourceEntityId = resolveIssueSpecialPowerSourceEntityId(command, normalizedSpecialPowerName, context);
  if (sourceEntityId === null) {
    return;
  }

  const sourceEntity = context.spawnedEntities.get(sourceEntityId);
  if (!sourceEntity || sourceEntity.destroyed) {
    return;
  }
  const commandSource: SpecialPowerCommandSource = command.commandSource ?? 'PLAYER';

  // Source parity: shared special powers gate globally by power name; non-shared powers
  // gate per source entity via its tracked shortcut-ready frame.
  const canExecute = isSharedSynced
    ? context.frameCounter >= context.resolveSharedReadyFrame(normalizedSpecialPowerName)
    : context.frameCounter >= context.resolveSourceReadyFrameBySource(
      normalizedSpecialPowerName,
      sourceEntityId,
    );
  if (!canExecute) {
    return;
  }

  const readyFrame = context.frameCounter + reloadFrames;

  const commandOption = Number.isFinite(command.commandOption) ? command.commandOption | 0 : 0;
  const needsObjectTarget = (commandOption & COMMAND_OPTION_NEED_OBJECT_TARGET) !== 0;
  const needsTargetPosition = (commandOption & COMMAND_OPTION_NEED_TARGET_POS) !== 0;
  const specialPowerEnum = resolveSpecialPowerEnum(specialPowerDef);
  const dispatchMode: SpecialPowerDispatchMode = needsObjectTarget
    ? 'OBJECT'
    : needsTargetPosition
      ? 'POSITION'
      : 'NO_TARGET';
  if (!isDispatchModeAllowedForSpecialPowerEnum(specialPowerEnum, dispatchMode)) {
    return;
  }

  if (needsObjectTarget) {
    if (command.targetEntityId === null || !Number.isFinite(command.targetEntityId)) {
      return;
    }

    const targetEntityId = Math.trunc(command.targetEntityId);
    const targetEntity = context.spawnedEntities.get(targetEntityId);
    if (!targetEntity || targetEntity.destroyed) {
      return;
    }
    if (context.isObjectEffectivelyDead(targetEntity)) {
      return;
    }
    if (context.isObjectShroudedForAction(sourceEntity, targetEntity, commandSource)) {
      return;
    }
    if (!context.isObjectTargetAllowedForSpecialPower(sourceEntity, targetEntity, specialPowerEnum, commandSource)) {
      return;
    }

    if (!isSpecialPowerObjectRelationshipAllowed(commandOption, context.getTeamRelationship(sourceEntity, targetEntity))) {
      return;
    }

    const dispatched = context.onIssueSpecialPowerTargetObject(
      sourceEntity.id,
      normalizedSpecialPowerName,
      targetEntity.id,
      commandOption,
      command.commandButtonId,
      specialPowerDef,
    );
    if (!dispatched) {
      return;
    }

    context.setReadyFrame(normalizedSpecialPowerName, sourceEntityId, isSharedSynced, readyFrame);
    return;
  }

  if (needsTargetPosition) {
    if (!Number.isFinite(command.targetX) || !Number.isFinite(command.targetZ)) {
      return;
    }

    const targetX = command.targetX as number;
    const targetZ = command.targetZ as number;
    if (
      specialPowerEnum
      && LOCATION_TARGET_REJECTS_UNDERWATER_SPECIAL_POWERS.has(specialPowerEnum)
      && context.isPositionUnderwater(targetX, targetZ)
    ) {
      return;
    }
    if (
      shouldApplyLocationShroudGate(specialPowerEnum)
      && context.isLocationShroudedForAction(sourceEntity, targetX, targetZ)
    ) {
      return;
    }

    const dispatched = context.onIssueSpecialPowerTargetPosition(
      sourceEntity.id,
      normalizedSpecialPowerName,
      targetX,
      targetZ,
      commandOption,
      command.commandButtonId,
      specialPowerDef,
    );
    if (!dispatched) {
      return;
    }

    context.setReadyFrame(normalizedSpecialPowerName, sourceEntityId, isSharedSynced, readyFrame);
    return;
  }

  const dispatched = context.onIssueSpecialPowerNoTarget(
    sourceEntity.id,
    normalizedSpecialPowerName,
    commandOption,
    command.commandButtonId,
    specialPowerDef,
  );
  if (!dispatched) {
    return;
  }

  context.setReadyFrame(normalizedSpecialPowerName, sourceEntityId, isSharedSynced, readyFrame);
}
