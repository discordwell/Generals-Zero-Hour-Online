/**
 * Entity serialization for MapEntity.
 *
 * Source parity: Generals/Code/GameEngine/Source/GameLogic/Object/Object.cpp (Object::xfer)
 *
 * Serializes all ~400+ properties of MapEntity. Uses binary xfer for primitives
 * and collections, and JSON-encoded blocks for complex profile objects (INI-derived
 * configuration data that C++ would re-parse from INI on load).
 *
 * This module is internal to game-logic. The MapEntity interface is defined in index.ts.
 */

import type { Xfer } from '@generals/engine';
import { XferMode } from '@generals/engine';

// Version for the entity serialization format.
// Increment when adding new fields. Older saves with lower versions
// will load the fields they have and use defaults for newer fields.
const ENTITY_XFER_VERSION = 2;

/**
 * Serialize or deserialize a nullable string.
 * Layout: bool hasValue + string value (if true).
 */
function xferNullableString(xfer: Xfer, value: string | null): string | null {
  const hasValue = xfer.xferBool(value !== null && value !== undefined);
  if (hasValue) {
    return xfer.xferAsciiString(value ?? '');
  }
  return null;
}

/**
 * Serialize or deserialize a nullable number.
 * Layout: bool hasValue + int32 value (if true).
 */
function xferNullableInt(xfer: Xfer, value: number | null): number | null {
  const hasValue = xfer.xferBool(value !== null && value !== undefined);
  if (hasValue) {
    return xfer.xferInt(value ?? 0);
  }
  return null;
}

/**
 * Serialize or deserialize a nullable real.
 */
function xferNullableReal(xfer: Xfer, value: number | null): number | null {
  const hasValue = xfer.xferBool(value !== null && value !== undefined);
  if (hasValue) {
    return xfer.xferReal(value ?? 0);
  }
  return null;
}

/**
 * Serialize a Set<string>.
 */
function xferStringSet(xfer: Xfer, value: Set<string> | null | undefined): Set<string> {
  return xfer.xferStringSet(value ?? new Set<string>());
}

/**
 * Serialize a Map<string, number>.
 */
function xferStringNumberMap(
  xfer: Xfer,
  value: Map<string, number> | null | undefined,
): Map<string, number> | null {
  const hasValue = xfer.xferBool(value !== null);
  if (!hasValue) return null;

  const size = xfer.xferUnsignedInt(value?.size ?? 0);
  if (xfer.getMode() === XferMode.XFER_LOAD) {
    const result = new Map<string, number>();
    for (let i = 0; i < size; i++) {
      const key = xfer.xferAsciiString('');
      const val = xfer.xferReal(0);
      result.set(key, val);
    }
    return result;
  }
  if (value) {
    for (const [key, val] of value) {
      xfer.xferAsciiString(key);
      xfer.xferReal(val);
    }
  }
  return value ?? null;
}

/**
 * Serialize a nullable VectorXZ ({x, z}).
 */
function xferNullableVectorXZ(
  xfer: Xfer,
  value: { x: number; z: number } | null,
): { x: number; z: number } | null {
  const hasValue = xfer.xferBool(value !== null && value !== undefined);
  if (hasValue) {
    const x = xfer.xferReal(value?.x ?? 0);
    const z = xfer.xferReal(value?.z ?? 0);
    return { x, z };
  }
  return null;
}

/**
 * Serialize a VectorXZ array.
 */
function xferVectorXZList(
  xfer: Xfer,
  values: Array<{ x: number; z: number }> | null | undefined,
): Array<{ x: number; z: number }> {
  const sourceValues = values ?? [];
  const length = xfer.xferUnsignedInt(sourceValues.length);
  if (xfer.getMode() === XferMode.XFER_LOAD) {
    const result: Array<{ x: number; z: number }> = [];
    for (let i = 0; i < length; i++) {
      const x = xfer.xferReal(0);
      const z = xfer.xferReal(0);
      result.push({ x, z });
    }
    return result;
  }
  for (const v of sourceValues) {
    xfer.xferReal(v.x);
    xfer.xferReal(v.z);
  }
  return sourceValues;
}

/**
 * Serialize a complex object as JSON string.
 * Used for INI-derived profile objects that contain nested structures.
 * This is a practical adaptation — C++ re-parses INI on load; we serialize
 * the pre-parsed object graph.
 */
function xferJsonObject<T>(xfer: Xfer, value: T): T {
  if (xfer.getMode() === XferMode.XFER_LOAD) {
    const json = xfer.xferLongString('');
    return JSON.parse(json, jsonReviver) as T;
  }
  const json = JSON.stringify(value, jsonReplacer);
  xfer.xferLongString(json);
  return value;
}

/**
 * Serialize a nullable complex object as JSON string.
 */
function xferNullableJsonObject<T>(xfer: Xfer, value: T | null): T | null {
  const hasValue = xfer.xferBool(value !== null && value !== undefined);
  if (!hasValue) return null;
  return xferJsonObject(xfer, value!);
}

/**
 * JSON replacer that handles Map and Set serialization.
 */
function jsonReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Map) {
    return { __type: 'Map', entries: Array.from(value.entries()) };
  }
  if (value instanceof Set) {
    return { __type: 'Set', values: Array.from(value) };
  }
  return value;
}

/**
 * JSON reviver that restores Map and Set from serialized form.
 */
function jsonReviver(_key: string, value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    if (obj.__type === 'Map' && Array.isArray(obj.entries)) {
      return new Map(obj.entries as Array<[unknown, unknown]>);
    }
    if (obj.__type === 'Set' && Array.isArray(obj.values)) {
      return new Set(obj.values as unknown[]);
    }
  }
  return value;
}

/**
 * Serialize a complex object as JSON with Map/Set revival support.
 */
function xferJsonObjectWithCollections<T>(xfer: Xfer, value: T): T {
  if (xfer.getMode() === XferMode.XFER_LOAD) {
    const json = xfer.xferLongString('');
    return JSON.parse(json, jsonReviver) as T;
  }
  const json = JSON.stringify(value, jsonReplacer);
  xfer.xferLongString(json);
  return value;
}

/**
 * Main entity serialization function.
 *
 * Serializes every property of a MapEntity. The entity object is
 * mutated in-place during load; during save, values are written out.
 *
 * @param xfer - The Xfer instance (save, load, or CRC mode)
 * @param e - The entity to serialize. Mutated in-place during load.
 * @returns The (possibly mutated) entity
 */
export function xferMapEntity(xfer: Xfer, e: Record<string, unknown>): void {
  // Read version from stream (will be used for conditional field loading
  // when ENTITY_XFER_VERSION is incremented).
  const version = xfer.xferVersion(ENTITY_XFER_VERSION);

  // ── Identity ──
  e.id = xfer.xferUnsignedInt(e.id as number);
  e.templateName = xfer.xferAsciiString(e.templateName as string);
  e.scriptName = xferNullableString(xfer, e.scriptName as string | null);
  e.category = xfer.xferAsciiString(e.category as string);
  e.kindOf = xferStringSet(xfer, e.kindOf as Set<string>);
  e.side = xferNullableString(xfer, (e.side as string) ?? null) ?? undefined;
  e.originalOwningSide = xfer.xferAsciiString(e.originalOwningSide as string);
  e.capturedFromOriginalOwner = xfer.xferBool(e.capturedFromOriginalOwner as boolean);
  e.controllingPlayerToken = xferNullableString(xfer, e.controllingPlayerToken as string | null);
  e.resolved = xfer.xferBool(e.resolved as boolean);
  e.bridgeFlags = xfer.xferInt(e.bridgeFlags as number);
  e.mapCellX = xfer.xferInt(e.mapCellX as number);
  e.mapCellZ = xfer.xferInt(e.mapCellZ as number);
  e.renderAssetCandidates = xfer.xferStringList(
    (e.renderAssetCandidates as string[] | undefined) ?? [],
  );
  e.renderAssetPath = xferNullableString(xfer, e.renderAssetPath as string | null);
  e.renderAssetResolved = xfer.xferBool(e.renderAssetResolved as boolean);
  e.renderAnimationStateClips = xferNullableJsonObject(xfer, (e.renderAnimationStateClips as object) ?? null) ?? undefined;

  // ── Transform ──
  e.x = xfer.xferReal(e.x as number);
  e.y = xfer.xferReal(e.y as number);
  e.z = xfer.xferReal(e.z as number);
  e.rotationY = xfer.xferReal(e.rotationY as number);
  e.animationState = xfer.xferAsciiString(e.animationState as string);
  e.baseHeight = xfer.xferReal(e.baseHeight as number);
  e.nominalHeight = xfer.xferReal(e.nominalHeight as number);

  // ── Flags ──
  e.selected = xfer.xferBool(e.selected as boolean);
  e.canMove = xfer.xferBool(e.canMove as boolean);
  e.energyBonus = xfer.xferReal(e.energyBonus as number);
  e.energyUpgradeBonus = xfer.xferReal(e.energyUpgradeBonus as number);
  e.crusherLevel = xfer.xferInt(e.crusherLevel as number);
  e.crushableLevel = xfer.xferInt(e.crushableLevel as number);
  e.canBeSquished = xfer.xferBool(e.canBeSquished as boolean);
  e.isUnmanned = xfer.xferBool(e.isUnmanned as boolean);
  e.attackNeedsLineOfSight = xfer.xferBool(e.attackNeedsLineOfSight as boolean);
  e.isImmobile = xfer.xferBool(e.isImmobile as boolean);
  e.noCollisions = xfer.xferBool(e.noCollisions as boolean);
  e.isIndestructible = xfer.xferBool(e.isIndestructible as boolean);
  e.receivingDifficultyBonus = xfer.xferBool(e.receivingDifficultyBonus as boolean);
  e.scriptAiRecruitable = xfer.xferBool(e.scriptAiRecruitable as boolean);
  e.scriptAttackPrioritySetName = xfer.xferAsciiString(e.scriptAttackPrioritySetName as string);
  e.scriptAttitude = xfer.xferInt(e.scriptAttitude as number);
  e.keepObjectOnDeath = xfer.xferBool(e.keepObjectOnDeath as boolean);

  // ── Body / Health ──
  e.bodyType = xfer.xferAsciiString(e.bodyType as string);
  e.hiveStructureProfile = xferNullableJsonObject(xfer, e.hiveStructureProfile as object | null);
  e.undeadSecondLifeMaxHealth = xfer.xferReal(e.undeadSecondLifeMaxHealth as number);
  e.undeadIsSecondLife = xfer.xferBool(e.undeadIsSecondLife as boolean);
  e.canTakeDamage = xfer.xferBool(e.canTakeDamage as boolean);
  e.maxHealth = xfer.xferReal(e.maxHealth as number);
  e.initialHealth = xfer.xferReal(e.initialHealth as number);
  e.health = xfer.xferReal(e.health as number);

  // ── Weapons / Combat ──
  e.attackWeapon = xferNullableJsonObject(xfer, e.attackWeapon as object | null);
  e.weaponTemplateSets = xferJsonObject(xfer, e.weaponTemplateSets as unknown[]);
  e.weaponSetFlagsMask = xfer.xferInt(e.weaponSetFlagsMask as number);
  e.weaponBonusConditionFlags = xfer.xferInt(e.weaponBonusConditionFlags as number);
  e.armorTemplateSets = xferJsonObject(xfer, e.armorTemplateSets as unknown[]);
  e.armorSetFlagsMask = xfer.xferInt(e.armorSetFlagsMask as number);
  e.armorDamageCoefficients = xferStringNumberMap(xfer, e.armorDamageCoefficients as Map<string, number> | null);
  e.attackTargetEntityId = xferNullableInt(xfer, e.attackTargetEntityId as number | null);
  e.attackTargetPosition = xferNullableVectorXZ(xfer, e.attackTargetPosition as { x: number; z: number } | null);
  e.attackOriginalVictimPosition = xferNullableVectorXZ(xfer, e.attackOriginalVictimPosition as { x: number; z: number } | null);
  e.attackCommandSource = xfer.xferAsciiString(e.attackCommandSource as string);
  e.lastCommandSource = xfer.xferAsciiString(e.lastCommandSource as string);
  e.attackSubState = xfer.xferAsciiString(e.attackSubState as string);
  e.nextAttackFrame = xfer.xferInt(e.nextAttackFrame as number);
  e.lastShotFrame = xfer.xferInt(e.lastShotFrame as number);
  {
    const arr = (
      (e.lastShotFrameBySlot as [number, number, number] | undefined)
      ?? [0, 0, 0]
    ) as [number, number, number];
    arr[0] = xfer.xferInt(arr[0]);
    arr[1] = xfer.xferInt(arr[1]);
    arr[2] = xfer.xferInt(arr[2]);
    e.lastShotFrameBySlot = arr;
  }
  e.attackWeaponSlotIndex = xfer.xferInt(e.attackWeaponSlotIndex as number);
  e.attackCooldownRemaining = xfer.xferInt(e.attackCooldownRemaining as number);
  e.attackAmmoInClip = xfer.xferInt(e.attackAmmoInClip as number);
  e.attackReloadFinishFrame = xfer.xferInt(e.attackReloadFinishFrame as number);
  e.attackForceReloadFrame = xfer.xferInt(e.attackForceReloadFrame as number);
  e.forcedWeaponSlot = xferNullableInt(xfer, e.forcedWeaponSlot as number | null);
  e.weaponLockStatus = xfer.xferAsciiString(e.weaponLockStatus as string);
  e.maxShotsRemaining = xfer.xferInt(e.maxShotsRemaining as number);
  e.leechRangeActive = xfer.xferBool(e.leechRangeActive as boolean);
  e.turretProfiles = xferJsonObject(xfer, e.turretProfiles as unknown[]);
  e.turretStates = xferJsonObject(xfer, e.turretStates as unknown[]);
  e.attackScatterTargetsUnused = xfer.xferIntList(
    (e.attackScatterTargetsUnused as number[] | undefined) ?? [],
  );
  e.preAttackFinishFrame = xfer.xferInt(e.preAttackFinishFrame as number);
  e.consecutiveShotsTargetEntityId = xferNullableInt(xfer, e.consecutiveShotsTargetEntityId as number | null);
  e.consecutiveShotsAtTarget = xfer.xferInt(e.consecutiveShotsAtTarget as number);
  e.continuousFireState = xfer.xferAsciiString(e.continuousFireState as string);
  e.continuousFireCooldownFrame = xfer.xferInt(e.continuousFireCooldownFrame as number);
  e.sneakyOffsetWhenAttacking = xfer.xferReal(e.sneakyOffsetWhenAttacking as number);
  e.attackersMissPersistFrames = xfer.xferInt(e.attackersMissPersistFrames as number);
  e.attackersMissExpireFrame = xfer.xferInt(e.attackersMissExpireFrame as number);

  // ── Production ──
  e.productionProfile = xferNullableJsonObject(xfer, e.productionProfile as object | null);
  e.productionQueue = xferJsonObject(xfer, e.productionQueue as unknown[]);
  e.productionNextId = xfer.xferInt(e.productionNextId as number);
  e.queueProductionExitProfile = xferNullableJsonObject(xfer, e.queueProductionExitProfile as object | null);
  e.rallyPoint = xferNullableVectorXZ(xfer, e.rallyPoint as { x: number; z: number } | null);
  e.parkingPlaceProfile = xferNullableJsonObject(xfer, e.parkingPlaceProfile as object | null);
  e.containProfile = xferNullableJsonObject(xfer, e.containProfile as object | null);
  e.riderChangeContainProfile = xferNullableJsonObject(xfer, e.riderChangeContainProfile as object | null);
  e.scriptEvacDisposition = xfer.xferInt(e.scriptEvacDisposition as number);
  e.queueProductionExitDelayFramesRemaining = xfer.xferInt(e.queueProductionExitDelayFramesRemaining as number);
  e.queueProductionExitBurstRemaining = xfer.xferInt(e.queueProductionExitBurstRemaining as number);

  // ── Containment ──
  e.parkingSpaceProducerId = xferNullableInt(xfer, e.parkingSpaceProducerId as number | null);
  e.helixCarrierId = xferNullableInt(xfer, e.helixCarrierId as number | null);
  e.garrisonContainerId = xferNullableInt(xfer, e.garrisonContainerId as number | null);
  e.containPlayerEnteredSide = xferNullableString(xfer, e.containPlayerEnteredSide as string | null);
  e.containPlayerEnteredToken = xferNullableString(xfer, e.containPlayerEnteredToken as string | null);
  e.transportContainerId = xferNullableInt(xfer, e.transportContainerId as number | null);
  e.tunnelContainerId = xferNullableInt(xfer, e.tunnelContainerId as number | null);
  e.tunnelEnteredFrame = xfer.xferInt(e.tunnelEnteredFrame as number);
  e.tunnelFadeStartFrame = xfer.xferInt(e.tunnelFadeStartFrame as number);
  e.healContainEnteredFrame = xfer.xferInt(e.healContainEnteredFrame as number);
  e.helixPortableRiderId = xferNullableInt(xfer, e.helixPortableRiderId as number | null);

  // ── Slaves / Spawns ──
  e.slaverEntityId = xferNullableInt(xfer, e.slaverEntityId as number | null);
  e.spawnBehaviorState = xferNullableJsonObject(xfer, e.spawnBehaviorState as object | null);

  // ── Locomotion / Movement ──
  e.largestWeaponRange = xfer.xferReal(e.largestWeaponRange as number);
  e.totalWeaponAntiMask = xfer.xferInt(e.totalWeaponAntiMask as number);
  e.locomotorSets = xferJsonObjectWithCollections(xfer, e.locomotorSets as Map<string, unknown>);
  e.completedUpgrades = xferStringSet(xfer, e.completedUpgrades as Set<string>);
  e.locomotorUpgradeTriggers = xferStringSet(xfer, e.locomotorUpgradeTriggers as Set<string>);
  e.executedUpgradeModules = xferStringSet(xfer, e.executedUpgradeModules as Set<string>);
  e.upgradeModules = xferJsonObject(xfer, e.upgradeModules as unknown[]);
  e.objectStatusFlags = xferStringSet(xfer, e.objectStatusFlags as Set<string>);
  e.modelConditionFlags = xferStringSet(xfer, e.modelConditionFlags as Set<string>);
  e.scriptFlashCount = xfer.xferInt(e.scriptFlashCount as number);
  e.scriptFlashColor = xfer.xferInt(e.scriptFlashColor as number);
  e.scriptAmbientSoundEnabled = xfer.xferBool(e.scriptAmbientSoundEnabled as boolean);
  e.scriptAmbientSoundRevision = xfer.xferInt(e.scriptAmbientSoundRevision as number);
  e.ambientSoundProfile = xferNullableJsonObject(xfer, e.ambientSoundProfile as object | null);
  e.ambientSoundForcedOffExceptRubble = xfer.xferBool(e.ambientSoundForcedOffExceptRubble as boolean);
  e.ambientSoundCustomState = xferNullableJsonObject(xfer, e.ambientSoundCustomState as object | null);
  e.customIndicatorColor = xferNullableInt(xfer, e.customIndicatorColor as number | null);
  e.commandSetStringOverride = xferNullableString(xfer, e.commandSetStringOverride as string | null);
  e.locomotorUpgradeEnabled = xfer.xferBool(e.locomotorUpgradeEnabled as boolean);
  e.activeLocomotorSet = xfer.xferAsciiString(e.activeLocomotorSet as string);
  e.locomotorSurfaceMask = xfer.xferInt(e.locomotorSurfaceMask as number);
  e.locomotorDownhillOnly = xfer.xferBool(e.locomotorDownhillOnly as boolean);

  // ── Special Powers ──
  e.specialPowerModules = xferJsonObjectWithCollections(xfer, e.specialPowerModules as Map<string, unknown>);
  e.lastSpecialPowerDispatch = xferNullableJsonObject(xfer, e.lastSpecialPowerDispatch as object | null);

  // ── Pathfinding ──
  e.pathDiameter = xfer.xferReal(e.pathDiameter as number);
  e.pathfindCenterInCell = xfer.xferBool(e.pathfindCenterInCell as boolean);
  e.blocksPath = xfer.xferBool(e.blocksPath as boolean);
  e.geometryMajorRadius = xfer.xferReal(e.geometryMajorRadius as number);
  e.obstacleGeometry = xferNullableJsonObject(xfer, e.obstacleGeometry as object | null);
  e.obstacleFootprint = xfer.xferInt(e.obstacleFootprint as number);
  e.ignoredMovementObstacleId = xferNullableInt(xfer, e.ignoredMovementObstacleId as number | null);
  e.movePath = xferVectorXZList(xfer, e.movePath as Array<{ x: number; z: number }>);
  e.pathIndex = xfer.xferInt(e.pathIndex as number);
  e.moving = xfer.xferBool(e.moving as boolean);
  e.speed = xfer.xferReal(e.speed as number);
  e.currentSpeed = xfer.xferReal(e.currentSpeed as number);
  e.moveTarget = xferNullableVectorXZ(xfer, e.moveTarget as { x: number; z: number } | null);
  e.scriptStoppingDistanceOverride = xferNullableReal(xfer, e.scriptStoppingDistanceOverride as number | null);
  e.pathfindGoalCell = xferNullableJsonObject(xfer, e.pathfindGoalCell as object | null);
  e.pathfindPosCell = xferNullableJsonObject(xfer, e.pathfindPosCell as object | null);

  // ── Supply / Economy ──
  e.supplyWarehouseProfile = xferNullableJsonObject(xfer, e.supplyWarehouseProfile as object | null);
  e.supplyTruckProfile = xferNullableJsonObject(xfer, e.supplyTruckProfile as object | null);
  e.chinookAIProfile = xferNullableJsonObject(xfer, e.chinookAIProfile as object | null);
  e.chinookFlightStatus = xferNullableString(xfer, e.chinookFlightStatus as string | null);
  e.chinookFlightStatusEnteredFrame = xfer.xferInt(e.chinookFlightStatusEnteredFrame as number);
  e.chinookHealingAirfieldId = xfer.xferInt(e.chinookHealingAirfieldId as number);
  e.repairDockProfile = xferNullableJsonObject(xfer, e.repairDockProfile as object | null);
  e.commandButtonHuntProfile = xferNullableJsonObject(xfer, e.commandButtonHuntProfile as object | null);
  e.commandButtonHuntMode = xfer.xferAsciiString(e.commandButtonHuntMode as string);
  e.commandButtonHuntButtonName = xfer.xferAsciiString(e.commandButtonHuntButtonName as string);
  e.commandButtonHuntNextScanFrame = xfer.xferInt(e.commandButtonHuntNextScanFrame as number);
  e.dozerAIProfile = xferNullableJsonObject(xfer, e.dozerAIProfile as object | null);
  e.dozerIdleTooLongTimestamp = xfer.xferInt(e.dozerIdleTooLongTimestamp as number);
  e.dozerBuildTaskOrderFrame = xfer.xferInt(e.dozerBuildTaskOrderFrame as number);
  e.dozerRepairTaskOrderFrame = xfer.xferInt(e.dozerRepairTaskOrderFrame as number);
  e.isSupplyCenter = xfer.xferBool(e.isSupplyCenter as boolean);

  // ── Experience / Veterancy ──
  e.experienceProfile = xferNullableJsonObject(xfer, e.experienceProfile as object | null);
  e.experienceState = xferJsonObject(xfer, e.experienceState as object);

  // ── Vision / Stealth ──
  e.visionRange = xfer.xferReal(e.visionRange as number);
  e.shroudClearingRange = xfer.xferReal(e.shroudClearingRange as number);
  e.visionState = xferJsonObject(xfer, e.visionState as object);
  e.stealthProfile = xferNullableJsonObject(xfer, e.stealthProfile as object | null);
  e.stealthDelayRemaining = xfer.xferInt(e.stealthDelayRemaining as number);
  e.temporaryStealthGrant = xfer.xferBool(e.temporaryStealthGrant as boolean);
  e.temporaryStealthExpireFrame = xfer.xferInt(e.temporaryStealthExpireFrame as number);
  e.detectedUntilFrame = xfer.xferInt(e.detectedUntilFrame as number);
  e.lastDamageFrame = xfer.xferInt(e.lastDamageFrame as number);
  e.lastDamageNoEffect = xfer.xferBool(e.lastDamageNoEffect as boolean);
  e.lastAttackerEntityId = xferNullableInt(xfer, e.lastAttackerEntityId as number | null);
  e.scriptLastDamageSourceEntityId = xferNullableInt(xfer, e.scriptLastDamageSourceEntityId as number | null);
  e.scriptLastDamageSourceTemplateName = xferNullableString(xfer, e.scriptLastDamageSourceTemplateName as string | null);
  e.scriptLastDamageSourceSide = xferNullableString(xfer, e.scriptLastDamageSourceSide as string | null);
  e.lastDamageInfoFrame = xfer.xferInt(e.lastDamageInfoFrame as number);
  e.detectorProfile = xferNullableJsonObject(xfer, e.detectorProfile as object | null);
  e.detectorNextScanFrame = xfer.xferInt(e.detectorNextScanFrame as number);

  // ── Healing ──
  e.autoHealProfile = xferNullableJsonObject(xfer, e.autoHealProfile as object | null);
  e.autoHealNextFrame = xfer.xferInt(e.autoHealNextFrame as number);
  e.autoHealDamageDelayUntilFrame = xfer.xferInt(e.autoHealDamageDelayUntilFrame as number);
  e.baseRegenDelayUntilFrame = xfer.xferInt(e.baseRegenDelayUntilFrame as number);
  e.propagandaTowerProfile = xferNullableJsonObject(xfer, e.propagandaTowerProfile as object | null);
  e.propagandaTowerNextScanFrame = xfer.xferInt(e.propagandaTowerNextScanFrame as number);
  e.propagandaTowerTrackedIds = xfer.xferIntList(
    (e.propagandaTowerTrackedIds as number[] | undefined) ?? [],
  );
  e.soleHealingBenefactorId = xferNullableInt(xfer, e.soleHealingBenefactorId as number | null);
  e.soleHealingBenefactorExpirationFrame = xfer.xferInt(e.soleHealingBenefactorExpirationFrame as number);
  e.autoTargetScanNextFrame = xfer.xferInt(e.autoTargetScanNextFrame as number);

  // ── Guard ──
  e.guardState = xfer.xferAsciiString(e.guardState as string);
  e.guardPositionX = xfer.xferReal(e.guardPositionX as number);
  e.guardPositionZ = xfer.xferReal(e.guardPositionZ as number);
  e.guardObjectId = xfer.xferInt(e.guardObjectId as number);
  e.guardAreaTriggerIndex = xfer.xferInt(e.guardAreaTriggerIndex as number);
  e.guardMode = xfer.xferInt(e.guardMode as number);
  e.guardNextScanFrame = xfer.xferInt(e.guardNextScanFrame as number);
  e.guardChaseExpireFrame = xfer.xferInt(e.guardChaseExpireFrame as number);
  e.guardInnerRange = xfer.xferReal(e.guardInnerRange as number);
  e.guardOuterRange = xfer.xferReal(e.guardOuterRange as number);
  e.guardRetaliating = xfer.xferBool(e.guardRetaliating as boolean);
  e.tunnelNetworkGuardState = xfer.xferAsciiString(e.tunnelNetworkGuardState as string);
  e.temporaryMoveExpireFrame = xfer.xferInt(e.temporaryMoveExpireFrame as number);

  // ── Poison ──
  e.poisonedBehaviorProfile = xferNullableJsonObject(xfer, e.poisonedBehaviorProfile as object | null);
  e.poisonDamageAmount = xfer.xferReal(e.poisonDamageAmount as number);
  e.poisonNextDamageFrame = xfer.xferInt(e.poisonNextDamageFrame as number);
  e.poisonExpireFrame = xfer.xferInt(e.poisonExpireFrame as number);

  // ── Fire ──
  e.flameStatus = xfer.xferAsciiString(e.flameStatus as string);
  e.flameDamageAccumulated = xfer.xferReal(e.flameDamageAccumulated as number);
  e.flameEndFrame = xfer.xferInt(e.flameEndFrame as number);
  e.flameBurnedEndFrame = xfer.xferInt(e.flameBurnedEndFrame as number);
  e.flameDamageNextFrame = xfer.xferInt(e.flameDamageNextFrame as number);
  e.flameLastDamageReceivedFrame = xfer.xferInt(e.flameLastDamageReceivedFrame as number);
  e.flammableProfile = xferNullableJsonObject(xfer, e.flammableProfile as object | null);
  e.fireSpreadProfile = xferNullableJsonObject(xfer, e.fireSpreadProfile as object | null);
  e.fireSpreadNextFrame = xfer.xferInt(e.fireSpreadNextFrame as number);

  // ── Mines ──
  e.minefieldProfile = xferNullableJsonObject(xfer, e.minefieldProfile as object | null);
  e.mineVirtualMinesRemaining = xfer.xferInt(e.mineVirtualMinesRemaining as number);
  e.mineImmunes = xferJsonObject(xfer, e.mineImmunes as unknown[]);
  e.mineDetonators = xferJsonObject(xfer, e.mineDetonators as unknown[]);
  e.mineScootFramesLeft = xfer.xferInt(e.mineScootFramesLeft as number);
  e.mineDraining = xfer.xferBool(e.mineDraining as boolean);
  e.mineRegenerates = xfer.xferBool(e.mineRegenerates as boolean);
  e.mineNextDeathCheckFrame = xfer.xferInt(e.mineNextDeathCheckFrame as number);
  e.mineIgnoreDamage = xfer.xferBool(e.mineIgnoreDamage as boolean);
  e.mineCreatorId = xfer.xferInt(e.mineCreatorId as number);

  // ── Eject Pilot ──
  e.ejectPilotTemplateName = xferNullableString(xfer, e.ejectPilotTemplateName as string | null);
  e.ejectPilotMinVeterancy = xfer.xferInt(e.ejectPilotMinVeterancy as number);

  // ── Prone ──
  e.proneDamageToFramesRatio = xferNullableReal(xfer, e.proneDamageToFramesRatio as number | null);
  e.proneFramesRemaining = xfer.xferInt(e.proneFramesRemaining as number);

  // ── Demo Trap ──
  e.demoTrapProfile = xferNullableJsonObject(xfer, e.demoTrapProfile as object | null);
  e.demoTrapNextScanFrame = xfer.xferInt(e.demoTrapNextScanFrame as number);
  e.demoTrapDetonated = xfer.xferBool(e.demoTrapDetonated as boolean);
  e.demoTrapProximityMode = xfer.xferBool(e.demoTrapProximityMode as boolean);

  // ── Rebuild Hole ──
  e.rebuildHoleExposeDieProfile = xferNullableJsonObject(xfer, e.rebuildHoleExposeDieProfile as object | null);
  e.rebuildHoleProfile = xferNullableJsonObject(xfer, e.rebuildHoleProfile as object | null);
  e.rebuildHoleWorkerEntityId = xfer.xferInt(e.rebuildHoleWorkerEntityId as number);
  e.rebuildHoleReconstructingEntityId = xfer.xferInt(e.rebuildHoleReconstructingEntityId as number);
  e.rebuildHoleSpawnerEntityId = xfer.xferInt(e.rebuildHoleSpawnerEntityId as number);
  e.rebuildHoleWorkerWaitCounter = xfer.xferInt(e.rebuildHoleWorkerWaitCounter as number);
  e.rebuildHoleRebuildTemplateName = xfer.xferAsciiString(e.rebuildHoleRebuildTemplateName as string);
  e.rebuildHoleMasked = xfer.xferBool(e.rebuildHoleMasked as boolean);

  // ── Auto Deposit ──
  e.autoDepositProfile = xferNullableJsonObject(xfer, e.autoDepositProfile as object | null);
  e.autoDepositNextFrame = xfer.xferInt(e.autoDepositNextFrame as number);
  e.autoDepositInitialized = xfer.xferBool(e.autoDepositInitialized as boolean);
  e.autoDepositCaptureBonusPending = xfer.xferBool(e.autoDepositCaptureBonusPending as boolean);

  // ── Auto Find Healing ──
  e.autoFindHealingProfile = xferNullableJsonObject(xfer, e.autoFindHealingProfile as object | null);
  e.autoFindHealingNextScanFrame = xfer.xferInt(e.autoFindHealingNextScanFrame as number);

  // ── Death OCL ──
  e.deathOCLEntries = xferJsonObject(xfer, e.deathOCLEntries as unknown[]);

  // ── Construction ──
  e.constructionPercent = xfer.xferReal(e.constructionPercent as number);
  e.builderId = xfer.xferInt(e.builderId as number);
  e.buildTotalFrames = xfer.xferInt(e.buildTotalFrames as number);

  // ── Deploy ──
  e.deployStyleProfile = xferNullableJsonObject(xfer, e.deployStyleProfile as object | null);
  e.deployState = xfer.xferAsciiString(e.deployState as string);
  e.deployFrameToWait = xfer.xferInt(e.deployFrameToWait as number);

  // ── Special Ability ──
  e.specialAbilityProfile = xferNullableJsonObject(xfer, e.specialAbilityProfile as object | null);
  e.specialAbilityState = xferNullableJsonObject(xfer, e.specialAbilityState as object | null);

  // ── Destroyed / Death ──
  e.destroyed = xfer.xferBool(e.destroyed as boolean);
  e.pendingDeathType = xfer.xferAsciiString(e.pendingDeathType as string);
  e.pendingDeathSourceTemplateName = xferNullableString(xfer, e.pendingDeathSourceTemplateName as string | null);
  e.lifetimeDieFrame = xferNullableInt(xfer, e.lifetimeDieFrame as number | null);
  e.heightDieProfile = xferNullableJsonObject(xfer, e.heightDieProfile as object | null);
  e.heightDieActiveFrame = xfer.xferInt(e.heightDieActiveFrame as number);
  e.heightDieLastY = xfer.xferReal(e.heightDieLastY as number);
  e.deletionDieFrame = xferNullableInt(xfer, e.deletionDieFrame as number | null);

  // ── Sticky Bomb ──
  e.stickyBombProfile = xferNullableJsonObject(xfer, e.stickyBombProfile as object | null);
  e.stickyBombTargetId = xfer.xferInt(e.stickyBombTargetId as number);
  e.stickyBombDieFrame = xfer.xferInt(e.stickyBombDieFrame as number);

  // ── Fire When Damaged ──
  e.fireWhenDamagedProfiles = xferJsonObject(xfer, e.fireWhenDamagedProfiles as unknown[]);

  // ── Fire Weapon Update ──
  e.fireWeaponUpdateProfiles = xferJsonObject(xfer, e.fireWeaponUpdateProfiles as unknown[]);
  e.fireWeaponUpdateNextFireFrames = xfer.xferIntList(
    (e.fireWeaponUpdateNextFireFrames as number[] | undefined) ?? [],
  );
  e.lastShotFiredFrame = xfer.xferInt(e.lastShotFiredFrame as number);

  // ── OCL Update ──
  e.oclUpdateProfiles = xferJsonObject(xfer, e.oclUpdateProfiles as unknown[]);
  e.oclUpdateNextCreationFrames = xfer.xferIntList(
    (e.oclUpdateNextCreationFrames as number[] | undefined) ?? [],
  );
  e.oclUpdateTimerStarted = xferJsonObject(xfer, e.oclUpdateTimerStarted as boolean[]);
  e.oclUpdateFactionNeutral = xferJsonObject(xfer, e.oclUpdateFactionNeutral as boolean[]);
  e.oclUpdateFactionOwnerSide = xferJsonObject(xfer, e.oclUpdateFactionOwnerSide as string[]);

  // ── Weapon Bonus Update ──
  e.weaponBonusUpdateProfiles = xferJsonObject(xfer, e.weaponBonusUpdateProfiles as unknown[]);
  e.weaponBonusUpdateNextPulseFrames = xfer.xferIntList(
    (e.weaponBonusUpdateNextPulseFrames as number[] | undefined) ?? [],
  );
  e.tempWeaponBonusFlag = xfer.xferInt(e.tempWeaponBonusFlag as number);
  e.tempWeaponBonusExpiryFrame = xfer.xferInt(e.tempWeaponBonusExpiryFrame as number);

  // ── Death behaviors ──
  e.instantDeathProfiles = xferJsonObject(xfer, e.instantDeathProfiles as unknown[]);
  e.fireWeaponWhenDeadProfiles = xferJsonObject(xfer, e.fireWeaponWhenDeadProfiles as unknown[]);
  e.slowDeathProfiles = xferJsonObject(xfer, e.slowDeathProfiles as unknown[]);
  e.slowDeathState = xferNullableJsonObject(xfer, e.slowDeathState as object | null);
  e.structureCollapseProfile = xferNullableJsonObject(xfer, e.structureCollapseProfile as object | null);
  e.structureCollapseState = xferNullableJsonObject(xfer, e.structureCollapseState as object | null);

  // ── EMP ──
  e.empUpdateProfile = xferNullableJsonObject(xfer, e.empUpdateProfile as object | null);
  e.empUpdateState = xferNullableJsonObject(xfer, e.empUpdateState as object | null);

  // ── Hijacker ──
  e.hijackerUpdateProfile = xferNullableJsonObject(xfer, e.hijackerUpdateProfile as object | null);
  e.hijackerState = xferNullableJsonObject(xfer, e.hijackerState as object | null);

  // ── Leaflet Drop ──
  e.leafletDropProfile = xferNullableJsonObject(xfer, e.leafletDropProfile as object | null);
  e.leafletDropState = xferNullableJsonObject(xfer, e.leafletDropState as object | null);

  // ── Smart Bomb ──
  e.smartBombProfile = xferNullableJsonObject(xfer, e.smartBombProfile as object | null);
  e.smartBombState = xferNullableJsonObject(xfer, e.smartBombState as object | null);

  // ── Dynamic Geometry ──
  e.dynamicGeometryProfile = xferNullableJsonObject(xfer, e.dynamicGeometryProfile as object | null);
  e.dynamicGeometryState = xferNullableJsonObject(xfer, e.dynamicGeometryState as object | null);

  // ── Fire OCL After Cooldown ──
  e.fireOCLAfterCooldownProfiles = xferJsonObject(xfer, e.fireOCLAfterCooldownProfiles as unknown[]);
  e.fireOCLAfterCooldownStates = xferJsonObject(xfer, e.fireOCLAfterCooldownStates as unknown[]);

  // ── Neutron Blast ──
  e.neutronBlastProfile = xferNullableJsonObject(xfer, e.neutronBlastProfile as object | null);

  // ── Bunker Buster ──
  e.bunkerBusterProfile = xferNullableJsonObject(xfer, e.bunkerBusterProfile as object | null);
  e.bunkerBusterVictimId = xferNullableInt(xfer, e.bunkerBusterVictimId as number | null);

  // ── Grant Stealth ──
  e.grantStealthProfile = xferNullableJsonObject(xfer, e.grantStealthProfile as object | null);
  e.grantStealthCurrentRadius = xfer.xferReal(e.grantStealthCurrentRadius as number);

  // ── Neutron Missile Slow Death ──
  e.neutronMissileSlowDeathProfile = xferNullableJsonObject(xfer, e.neutronMissileSlowDeathProfile as object | null);
  e.neutronMissileSlowDeathState = xferNullableJsonObject(xfer, e.neutronMissileSlowDeathState as object | null);

  // ── Helicopter / Jet Slow Death ──
  e.helicopterSlowDeathProfiles = xferJsonObject(xfer, e.helicopterSlowDeathProfiles as unknown[]);
  e.helicopterSlowDeathState = xferNullableJsonObject(xfer, e.helicopterSlowDeathState as object | null);
  e.jetSlowDeathProfiles = xferJsonObject(xfer, e.jetSlowDeathProfiles as unknown[]);
  e.jetSlowDeathState = xferNullableJsonObject(xfer, e.jetSlowDeathState as object | null);

  // ── Cleanup Hazard ──
  e.cleanupHazardProfile = xferNullableJsonObject(xfer, e.cleanupHazardProfile as object | null);
  e.cleanupHazardState = xferNullableJsonObject(xfer, e.cleanupHazardState as object | null);

  // ── Misc Profiles ──
  e.assistedTargetingProfile = xferNullableJsonObject(xfer, e.assistedTargetingProfile as object | null);
  e.techBuildingProfile = xferNullableJsonObject(xfer, e.techBuildingProfile as object | null);
  e.supplyWarehouseCripplingProfile = xferNullableJsonObject(xfer, e.supplyWarehouseCripplingProfile as object | null);
  e.swCripplingHealSuppressedUntilFrame = xfer.xferInt(e.swCripplingHealSuppressedUntilFrame as number);
  e.swCripplingNextHealFrame = xfer.xferInt(e.swCripplingNextHealFrame as number);
  e.swCripplingDockDisabled = xfer.xferBool(e.swCripplingDockDisabled as boolean);
  e.generateMinefieldProfile = xferNullableJsonObject(xfer, e.generateMinefieldProfile as object | null);
  e.generateMinefieldDone = xfer.xferBool(e.generateMinefieldDone as boolean);
  e.createCrateDieProfile = xferNullableJsonObject(xfer, e.createCrateDieProfile as object | null);
  e.salvageCrateProfile = xferNullableJsonObject(xfer, e.salvageCrateProfile as object | null);
  e.crateCollideProfile = xferNullableJsonObject(xfer, e.crateCollideProfile as object | null);

  // ── Battle Plan ──
  e.battlePlanProfile = xferNullableJsonObject(xfer, e.battlePlanProfile as object | null);
  e.battlePlanState = xferNullableJsonObject(xfer, e.battlePlanState as object | null);
  e.battlePlanDamageScalar = xfer.xferReal(e.battlePlanDamageScalar as number);
  e.baseVisionRange = xfer.xferReal(e.baseVisionRange as number);
  e.baseShroudClearingRange = xfer.xferReal(e.baseShroudClearingRange as number);

  // ── Point Defense Laser ──
  e.pointDefenseLaserProfile = xferNullableJsonObject(xfer, e.pointDefenseLaserProfile as object | null);
  e.pdlNextScanFrame = xfer.xferInt(e.pdlNextScanFrame as number);
  e.pdlTargetProjectileVisualId = xfer.xferInt(e.pdlTargetProjectileVisualId as number);
  e.pdlNextShotFrame = xfer.xferInt(e.pdlNextShotFrame as number);

  // ── Horde ──
  e.hordeProfile = xferNullableJsonObject(xfer, e.hordeProfile as object | null);
  e.hordeNextCheckFrame = xfer.xferInt(e.hordeNextCheckFrame as number);
  e.isInHorde = xfer.xferBool(e.isInHorde as boolean);
  e.isTrueHordeMember = xfer.xferBool(e.isTrueHordeMember as boolean);

  // ── Enemy Near ──
  e.enemyNearScanDelayFrames = xfer.xferInt(e.enemyNearScanDelayFrames as number);
  e.enemyNearNextScanCountdown = xfer.xferInt(e.enemyNearNextScanCountdown as number);
  e.enemyNearDetected = xfer.xferBool(e.enemyNearDetected as boolean);

  // ── Slaved ──
  e.slavedUpdateProfile = xferNullableJsonObject(xfer, e.slavedUpdateProfile as object | null);
  e.slaveGuardOffsetX = xfer.xferReal(e.slaveGuardOffsetX as number);
  e.slaveGuardOffsetZ = xfer.xferReal(e.slaveGuardOffsetZ as number);
  e.slavedNextUpdateFrame = xfer.xferInt(e.slavedNextUpdateFrame as number);
  e.countermeasuresProfile = xferNullableJsonObject(xfer, e.countermeasuresProfile as object | null);
  e.countermeasuresState = xferNullableJsonObject(xfer, e.countermeasuresState as object | null);

  // ── Pilot Find Vehicle ──
  e.pilotFindVehicleProfile = xferNullableJsonObject(xfer, e.pilotFindVehicleProfile as object | null);
  e.pilotFindVehicleNextScanFrame = xfer.xferInt(e.pilotFindVehicleNextScanFrame as number);
  e.pilotFindVehicleDidMoveToBase = xfer.xferBool(e.pilotFindVehicleDidMoveToBase as boolean);
  e.pilotFindVehicleTargetId = xferNullableInt(xfer, e.pilotFindVehicleTargetId as number | null);

  // ── Topple ──
  e.toppleProfile = xferNullableJsonObject(xfer, e.toppleProfile as object | null);
  e.toppleState = xfer.xferAsciiString(e.toppleState as string);
  e.toppleDirX = xfer.xferReal(e.toppleDirX as number);
  e.toppleDirZ = xfer.xferReal(e.toppleDirZ as number);
  e.toppleAngularVelocity = xfer.xferReal(e.toppleAngularVelocity as number);
  e.toppleAngularAccumulation = xfer.xferReal(e.toppleAngularAccumulation as number);
  e.toppleSpeed = xfer.xferReal(e.toppleSpeed as number);

  // ── Physics ──
  e.physicsBehaviorProfile = xferNullableJsonObject(xfer, e.physicsBehaviorProfile as object | null);
  e.physicsBehaviorState = xferNullableJsonObject(xfer, e.physicsBehaviorState as object | null);

  // ── Structure Topple ──
  e.structureToppleProfile = xferNullableJsonObject(xfer, e.structureToppleProfile as object | null);
  e.structureToppleState = xferNullableJsonObject(xfer, e.structureToppleState as object | null);

  // ── Missile Launcher Building ──
  e.missileLauncherBuildingProfile = xferNullableJsonObject(xfer, e.missileLauncherBuildingProfile as object | null);
  e.missileLauncherBuildingState = xferNullableJsonObject(xfer, e.missileLauncherBuildingState as object | null);

  // ── Particle Uplink Cannon ──
  e.particleUplinkCannonProfile = xferNullableJsonObject(xfer, e.particleUplinkCannonProfile as object | null);
  e.particleUplinkCannonState = xferNullableJsonObject(xfer, e.particleUplinkCannonState as object | null);

  // ── Neutron Missile Update ──
  e.neutronMissileUpdateProfile = xferNullableJsonObject(xfer, e.neutronMissileUpdateProfile as object | null);
  e.neutronMissileUpdateState = xferNullableJsonObject(xfer, e.neutronMissileUpdateState as object | null);

  // ── Radar ──
  e.radarUpdateProfile = xferNullableJsonObject(xfer, e.radarUpdateProfile as object | null);
  e.radarExtendDoneFrame = xfer.xferInt(e.radarExtendDoneFrame as number);
  e.radarExtendComplete = xfer.xferBool(e.radarExtendComplete as boolean);
  e.radarActive = xfer.xferBool(e.radarActive as boolean);

  // ── Float ──
  e.floatUpdateProfile = xferNullableJsonObject(xfer, e.floatUpdateProfile as object | null);

  // ── Wander ──
  e.hasWanderAI = xfer.xferBool(e.hasWanderAI as boolean);
  e.scriptWanderInPlaceActive = xfer.xferBool(e.scriptWanderInPlaceActive as boolean);
  e.scriptWanderInPlaceOriginX = xfer.xferReal(e.scriptWanderInPlaceOriginX as number);
  e.scriptWanderInPlaceOriginZ = xfer.xferReal(e.scriptWanderInPlaceOriginZ as number);

  // ── Create Modules ──
  e.veterancyGainCreateProfiles = xferJsonObject(xfer, e.veterancyGainCreateProfiles as unknown[]);
  e.fxListDieProfiles = xferJsonObject(xfer, e.fxListDieProfiles as unknown[]);
  e.crushDieProfiles = xferJsonObject(xfer, e.crushDieProfiles as unknown[]);
  e.destroyDieProfiles = xferJsonObject(xfer, e.destroyDieProfiles as unknown[]);
  e.damDieProfiles = xferJsonObject(xfer, e.damDieProfiles as unknown[]);
  e.specialPowerCompletionDieProfiles = xferJsonObject(xfer, e.specialPowerCompletionDieProfiles as unknown[]);
  e.specialPowerCompletionCreatorId = xfer.xferInt(e.specialPowerCompletionCreatorId as number);
  e.specialPowerCompletionCreatorSet = xfer.xferBool(e.specialPowerCompletionCreatorSet as boolean);
  e.frontCrushed = xfer.xferBool(e.frontCrushed as boolean);
  e.backCrushed = xfer.xferBool(e.backCrushed as boolean);
  e.grantUpgradeCreateProfiles = xferJsonObject(xfer, e.grantUpgradeCreateProfiles as unknown[]);
  e.lockWeaponCreateSlot = xferNullableInt(xfer, e.lockWeaponCreateSlot as number | null);

  // ── Upgrade Die ──
  e.upgradeDieProfiles = xferJsonObject(xfer, e.upgradeDieProfiles as unknown[]);
  e.producerEntityId = xfer.xferInt(e.producerEntityId as number);

  // ── Checkpoint ──
  e.checkpointProfile = xferNullableJsonObject(xfer, e.checkpointProfile as object | null);
  e.checkpointAllyNear = xfer.xferBool(e.checkpointAllyNear as boolean);
  e.checkpointEnemyNear = xfer.xferBool(e.checkpointEnemyNear as boolean);
  e.checkpointMaxMinorRadius = xfer.xferReal(e.checkpointMaxMinorRadius as number);
  e.checkpointScanCountdown = xfer.xferInt(e.checkpointScanCountdown as number);

  // ── Dynamic Shroud ──
  e.dynamicShroudProfile = xferNullableJsonObject(xfer, e.dynamicShroudProfile as object | null);
  e.dynamicShroudState = xfer.xferAsciiString(e.dynamicShroudState as string);
  e.dynamicShroudStateCountdown = xfer.xferInt(e.dynamicShroudStateCountdown as number);
  e.dynamicShroudTotalFrames = xfer.xferInt(e.dynamicShroudTotalFrames as number);
  e.dynamicShroudShrinkStartDeadline = xfer.xferInt(e.dynamicShroudShrinkStartDeadline as number);
  e.dynamicShroudSustainDeadline = xfer.xferInt(e.dynamicShroudSustainDeadline as number);
  e.dynamicShroudGrowStartDeadline = xfer.xferInt(e.dynamicShroudGrowStartDeadline as number);
  e.dynamicShroudDoneForeverFrame = xfer.xferInt(e.dynamicShroudDoneForeverFrame as number);
  e.dynamicShroudChangeIntervalCountdown = xfer.xferInt(e.dynamicShroudChangeIntervalCountdown as number);
  e.dynamicShroudNativeClearingRange = xfer.xferReal(e.dynamicShroudNativeClearingRange as number);
  e.dynamicShroudCurrentClearingRange = xfer.xferReal(e.dynamicShroudCurrentClearingRange as number);

  // ── Jet AI ──
  e.jetAIProfile = xferNullableJsonObject(xfer, e.jetAIProfile as object | null);
  e.jetAIState = xferNullableJsonObject(xfer, e.jetAIState as object | null);

  // ── Animation Steering ──
  e.animationSteeringProfile = xferNullableJsonObject(xfer, e.animationSteeringProfile as object | null);
  e.animationSteeringCurrentTurnAnim = xferNullableString(xfer, e.animationSteeringCurrentTurnAnim as string | null);
  e.animationSteeringNextTransitionFrame = xfer.xferInt(e.animationSteeringNextTransitionFrame as number);
  e.animationSteeringLastRotationY = xfer.xferReal(e.animationSteeringLastRotationY as number);

  // ── Tensile Formation ──
  e.tensileFormationProfile = xferNullableJsonObject(xfer, e.tensileFormationProfile as object | null);
  e.tensileFormationState = xferNullableJsonObject(xfer, e.tensileFormationState as object | null);

  // ── Assault Transport ──
  e.assaultTransportProfile = xferNullableJsonObject(xfer, e.assaultTransportProfile as object | null);

  // ── Power Plant ──
  e.powerPlantUpdateProfile = xferNullableJsonObject(xfer, e.powerPlantUpdateProfile as object | null);
  e.powerPlantUpdateState = xferNullableJsonObject(xfer, e.powerPlantUpdateState as object | null);

  // ── Special Power Create ──
  e.hasSpecialPowerCreate = xfer.xferBool(e.hasSpecialPowerCreate as boolean);
  e.shroudRange = xfer.xferReal(e.shroudRange as number);

  // ── Subdual Damage ──
  e.subdualDamageCap = xfer.xferReal(e.subdualDamageCap as number);
  e.subdualDamageHealRate = xfer.xferInt(e.subdualDamageHealRate as number);
  e.subdualDamageHealAmount = xfer.xferReal(e.subdualDamageHealAmount as number);
  e.currentSubdualDamage = xfer.xferReal(e.currentSubdualDamage as number);
  e.subdualHealingCountdown = xfer.xferInt(e.subdualHealingCountdown as number);

  if (version >= 2) {
    // ── Source parity: post-v1 MapEntity runtime additions ──
    e.cheerTimerFrames = xfer.xferInt((e.cheerTimerFrames as number | undefined) ?? 0);
    e.raisingFlagTimerFrames = xfer.xferInt((e.raisingFlagTimerFrames as number | undefined) ?? 0);
    e.explodedState = xfer.xferAsciiString((e.explodedState as string | undefined) ?? 'NONE');
    e.battleBusEmptyHulkDestroyFrame = xfer.xferInt(
      (e.battleBusEmptyHulkDestroyFrame as number | undefined) ?? 0,
    );
    e.projectileStreamProfile = xferNullableJsonObject(xfer, e.projectileStreamProfile as object | null);
    e.projectileStreamState = xferNullableJsonObject(xfer, e.projectileStreamState as object | null);
    e.mobMemberProfile = xferNullableJsonObject(xfer, e.mobMemberProfile as object | null);
    e.mobMemberState = xferNullableJsonObject(xfer, e.mobMemberState as object | null);
    e.boneFXProfile = xferNullableJsonObject(xfer, e.boneFXProfile as object | null);
    e.boneFXState = xferNullableJsonObject(xfer, e.boneFXState as object | null);
    e.radiusDecalStates = xferJsonObject(xfer, (e.radiusDecalStates as unknown[]) ?? []);
    e.bridgeBehaviorProfile = xferNullableJsonObject(xfer, e.bridgeBehaviorProfile as object | null);
    e.bridgeBehaviorState = xferNullableJsonObject(xfer, e.bridgeBehaviorState as object | null);
    e.bridgeTowerProfile = xferNullableJsonObject(xfer, e.bridgeTowerProfile as object | null);
    e.bridgeTowerState = xferNullableJsonObject(xfer, e.bridgeTowerState as object | null);
    e.bridgeScaffoldState = xferNullableJsonObject(xfer, e.bridgeScaffoldState as object | null);
    e.flightDeckProfile = xferNullableJsonObject(xfer, e.flightDeckProfile as object | null);
    e.flightDeckState = xferNullableJsonObject(xfer, e.flightDeckState as object | null);
    e.spectreGunshipProfile = xferNullableJsonObject(xfer, e.spectreGunshipProfile as object | null);
    e.spectreGunshipState = xferNullableJsonObject(xfer, e.spectreGunshipState as object | null);
    e.spectreGunshipDeploymentProfile = xferNullableJsonObject(
      xfer,
      e.spectreGunshipDeploymentProfile as object | null,
    );
    e.waveGuideProfile = xferNullableJsonObject(xfer, e.waveGuideProfile as object | null);
    e.dumbProjectileProfile = xferNullableJsonObject(xfer, e.dumbProjectileProfile as object | null);
    return;
  }

  e.cheerTimerFrames = 0;
  e.raisingFlagTimerFrames = 0;
  e.explodedState = 'NONE';
  e.battleBusEmptyHulkDestroyFrame = 0;
  e.projectileStreamProfile = null;
  e.projectileStreamState = null;
  e.mobMemberProfile = null;
  e.mobMemberState = null;
  e.boneFXProfile = null;
  e.boneFXState = null;
  e.radiusDecalStates = [];
  e.bridgeBehaviorProfile = null;
  e.bridgeBehaviorState = null;
  e.bridgeTowerProfile = null;
  e.bridgeTowerState = null;
  e.bridgeScaffoldState = null;
  e.flightDeckProfile = null;
  e.flightDeckState = null;
  e.spectreGunshipProfile = null;
  e.spectreGunshipState = null;
  e.spectreGunshipDeploymentProfile = null;
  e.waveGuideProfile = null;
  e.dumbProjectileProfile = null;
}
