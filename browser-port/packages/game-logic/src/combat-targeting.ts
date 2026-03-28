// @ts-nocheck — self is typed as any; real safety comes from the test suite.
/**
 * Combat targeting — attack validation, idle auto-targeting, issue attack/fire, guard targeting.
 *
 * Source parity: Object/Update/AIUpdate.cpp, GameLogicDispatch.cpp, WeaponSet.cpp
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  AAS_IDLE_NO,
  AAS_IDLE_STEALTHED,
  approximateCubicBezierArcLength3D,
  AUTO_TARGET_SCAN_RATE_FRAMES,
  BEZIER_ARC_LENGTH_TOLERANCE,
  BEZIER_TERRAIN_SAMPLE_COUNT,
  estimateHighestTerrainAlongLine,
  LOCOMOTORSET_SUPERSONIC,
  RELATIONSHIP_ALLIES,
  RELATIONSHIP_ENEMIES,
  RELATIONSHIP_NEUTRAL,
  SCRIPT_AI_ATTITUDE_PASSIVE,
  SCRIPT_COMMAND_OPTION_NEED_TARGET_ALLY_OBJECT,
  SCRIPT_COMMAND_OPTION_NEED_TARGET_ENEMY_OBJECT,
  SCRIPT_COMMAND_OPTION_NEED_TARGET_NEUTRAL_OBJECT,
  WEAPON_ANTI_AIRBORNE_INFANTRY,
  WEAPON_ANTI_AIRBORNE_VEHICLE,
  WEAPON_ANTI_BALLISTIC_MISSILE,
  WEAPON_ANTI_GROUND,
  WEAPON_ANTI_MINE,
  WEAPON_ANTI_PARACHUTE,
  WEAPON_ANTI_PROJECTILE,
  WEAPON_ANTI_SMALL_MISSILE,
} from './index.js';
import { applyWeaponDamageEvent as applyWeaponDamageEventImpl } from './combat-damage-events.js';
type GL = any;

// ---- Combat targeting implementations ----

export function findFireWeaponTargetForPositionUsingWeapon(self: GL, 
  attacker: MapEntity,
  weapon: AttackWeaponProfile,
  targetX: number,
  targetZ: number,
): MapEntity | null {
  const attackRange = Math.max(0, weapon.attackRange);
  const attackRangeSqr = attackRange * attackRange;
  let bestTarget: MapEntity | null = null;
  let bestDistanceSqr = Number.POSITIVE_INFINITY;

  for (const candidate of self.spawnedEntities.values()) {
    if (!candidate.canTakeDamage || candidate.destroyed) {
      continue;
    }
    if (candidate.id === attacker.id) {
      continue;
    }
    if (!canAttackerTargetEntity(self, attacker, candidate, 'SCRIPT')) {
      continue;
    }
    const dx = candidate.x - targetX;
    const dz = candidate.z - targetZ;
    const distanceSqr = dx * dx + dz * dz;
    if (distanceSqr > attackRangeSqr) {
      continue;
    }
    if (distanceSqr >= bestDistanceSqr) {
      continue;
    }
    bestTarget = candidate;
    bestDistanceSqr = distanceSqr;
  }

  return bestTarget;
}

export function canEntityAttackFromStatus(self: GL, entity: MapEntity): boolean {
  // Source parity: DeployStyleAIUpdate — only allow attacks when fully deployed.
  if (entity.deployStyleProfile && entity.deployState !== 'READY_TO_ATTACK') {
    return false;
  }
  // Source parity: GeneralsMD Object::isAbleToAttack() early-outs on OBJECT_STATUS_NO_ATTACK,
  // OBJECT_STATUS_UNDER_CONSTRUCTION, and OBJECT_STATUS_SOLD.
  if (self.entityHasObjectStatus(entity, 'NO_ATTACK')) {
    return false;
  }
  if (self.entityHasObjectStatus(entity, 'UNDER_CONSTRUCTION')) {
    return false;
  }
  if (self.entityHasObjectStatus(entity, 'SOLD')) {
    return false;
  }

  // Source parity: GeneralsMD Object::isAbleToAttack() adds DISABLED_SUBDUED guard.
  // - Portable structures and spawned-weapon units are also blocked while
  //   DISABLED_HACKED or DISABLED_EMP (see Object.cpp).
  if (self.entityHasObjectStatus(entity, 'DISABLED_SUBDUED')) {
    return false;
  }
  const containingEntity = self.resolveEntityContainingObject(entity);
  const kindOf = self.resolveEntityKindOfSet(entity);
  const isPortableOrSpawnWeaponUnit = kindOf.has('PORTABLE_STRUCTURE') || kindOf.has('SPAWNS_ARE_THE_WEAPONS');
  if (isPortableOrSpawnWeaponUnit && (
    self.entityHasObjectStatus(entity, 'DISABLED_HACKED')
    || self.entityHasObjectStatus(entity, 'DISABLED_EMP')
  )) {
    return false;
  }
  if (containingEntity && !self.isPassengerAllowedToFireFromContainingObject(entity, containingEntity)) {
    // Source parity: GeneralsMD/Object.cpp checks contain modules via
    // getContainedBy()->getContain()->isPassengerAllowedToFire().
    return false;
  }
  if (isPortableOrSpawnWeaponUnit && kindOf.has('INFANTRY')) {
    // Source parity: Object::isAbleToAttack() (Object.cpp:3212-3230) — spawned infantry
    // checks SlavedUpdateInterface::getSlaverID() and blocks attacks when slaver is
    // DISABLED_SUBDUED (e.g., Microwave Tank suppressing a Stinger Site also suppresses
    // its stinger soldiers).
    const slaverEntity = entity.slaverEntityId !== null
      ? self.spawnedEntities.get(entity.slaverEntityId) ?? null
      : containingEntity;
    if (
      slaverEntity
      && self.entityHasObjectStatus(slaverEntity, 'DISABLED_SUBDUED')
    ) {
      return false;
    }
  }

  // Source parity: Object::isAbleToAttack() (Object.cpp:3237-3280) checks if all
  // weapons are on disabled turrets. Only turreted weapons can be disabled.
  // KINDOF_CAN_ATTACK objects skip this check (e.g., Nuke Cannon needs isAbleToAttack()
  // true even with disabled turret so it can deploy).
  if (entity.turretProfiles.length > 0 && !kindOf.has('CAN_ATTACK')) {
    let anyWeapon = false;
    let anyEnabled = false;
    const weaponSlots = self.resolveActiveWeaponSetSlots(entity);
    for (let slotIndex = 0; slotIndex < weaponSlots.length; slotIndex += 1) {
      if (weaponSlots[slotIndex] === null) {
        continue;
      }
      anyWeapon = true;
      const turret = self.findTurretForWeaponSlot(entity, slotIndex);
      if (!turret) {
        // Non-turreted weapon — always considered enabled.
        anyEnabled = true;
        break;
      }
      if (turret.enabled) {
        anyEnabled = true;
        break;
      }
    }
    if (anyWeapon && !anyEnabled) {
      return false;
    }
  }

  return true;
}

export function canAttackerTargetEntity(self: GL,
  attacker: MapEntity,
  target: MapEntity,
  commandSource: AttackCommandSource,
): boolean {
  if (!target.canTakeDamage || target.destroyed) {
    return false;
  }
  if (self.entityHasObjectStatus(target, 'MASKED')) {
    return false;
  }
  const aiLikeCommandSource = commandSource === 'AI' || commandSource === 'DOZER';
  if (aiLikeCommandSource && self.entityHasObjectStatus(target, 'NO_ATTACK_FROM_AI')) {
    return false;
  }
  const targetKindOf = self.resolveEntityKindOfSet(target);
  if (targetKindOf.has('UNATTACKABLE')) {
    return false;
  }
  const relationship = self.getTeamRelationship(attacker, target);
  const allowNeutralMineTarget = commandSource === 'DOZER'
    && (targetKindOf.has('MINE') || targetKindOf.has('DEMOTRAP'));
  if (
    relationship !== RELATIONSHIP_ENEMIES
    && (!allowNeutralMineTarget || relationship !== RELATIONSHIP_NEUTRAL)
  ) {
    return false;
  }
  if (self.isEntityOffMap(attacker) !== self.isEntityOffMap(target)) {
    return false;
  }
  if (
    !self.entityHasObjectStatus(attacker, 'IGNORING_STEALTH')
    && self.isEntityStealthedAndUndetected(target)
  ) {
    return false;
  }

  // Source parity: WeaponSet.cpp line 550 — cannot attack targets inside enclosing containers.
  if (self.isEntityInEnclosingContainer(target)) {
    return false;
  }

  // Source parity: AIUpdate.cpp line 4633 — fog of war affects human-player
  // auto-targeting (UNFOGGED flag). Computer AI players can target through fog.
  // Gate requires a fog grid and that the attacker has vision capability.
  if (aiLikeCommandSource && self.fogOfWarGrid && attacker.visionRange > 0) {
    const attackerSide = self.normalizeSide(attacker.side);
    if (attackerSide && self.getControllingPlayerTypeForEntity(attacker) === 'HUMAN'
        && !self.isPositionVisible(attackerSide, target.x, target.z)) {
      return false;
    }
  }

  // Source parity: WeaponTemplate pitch limits — reject targets outside vertical arc.
  const weapon = attacker.attackWeapon;
  if (weapon && (weapon.minTargetPitch > -Math.PI / 2 || weapon.maxTargetPitch < Math.PI / 2)) {
    const dx = target.x - attacker.x;
    const dz = target.z - attacker.z;
    const horizontalDist = Math.hypot(dx, dz);
    const dy = (target.y ?? 0) - (attacker.y ?? 0);
    const pitch = Math.atan2(dy, Math.max(horizontalDist, 0.001));
    if (pitch < weapon.minTargetPitch || pitch > weapon.maxTargetPitch) {
      return false;
    }
  }

  // Source parity: WeaponTemplate::m_allowAttackGarrisonedBldgs (Weapon.cpp line 613).
  // When the attacker's weapon disallows targeting garrisoned buildings, reject if the
  // target is a garrisoned structure with occupants inside.
  if (
    attacker.attackWeapon
    && !attacker.attackWeapon.allowAttackGarrisonedBldgs
    && target.containProfile?.moduleType === 'GARRISON'
    && self.collectContainedEntityIds(target.id).length > 0
  ) {
    return false;
  }

  // Source parity: WeaponSet.cpp line 673 — weapon anti-mask vs target anti-mask.
  // If no weapon on the attacker can engage this target type, reject.
  if (attacker.totalWeaponAntiMask !== 0) {
    const targetAntiMask = resolveTargetAntiMask(self, target, targetKindOf);
    if (targetAntiMask !== 0 && (attacker.totalWeaponAntiMask & targetAntiMask) === 0) {
      return false;
    }
  }

  return true;
}

export function resolveTargetAntiMask(self: GL, target: MapEntity, targetKindOf: ReadonlySet<string>): number {
  // Source parity: WeaponSet.cpp getVictimAntiMask — priority order matches C++ exactly.
  if (targetKindOf.has('SMALL_MISSILE')) {
    return WEAPON_ANTI_SMALL_MISSILE;
  }
  if (targetKindOf.has('BALLISTIC_MISSILE')) {
    return WEAPON_ANTI_BALLISTIC_MISSILE;
  }
  if (targetKindOf.has('PROJECTILE')) {
    return WEAPON_ANTI_PROJECTILE;
  }
  if (targetKindOf.has('MINE') || targetKindOf.has('DEMOTRAP')) {
    return WEAPON_ANTI_MINE | WEAPON_ANTI_GROUND;
  }
  // Source parity: Object::isAirborneTarget checks OBJECT_STATUS_AIRBORNE_TARGET.
  if (self.entityHasObjectStatus(target, 'AIRBORNE_TARGET') || target.category === 'air') {
    if (targetKindOf.has('VEHICLE')) {
      return WEAPON_ANTI_AIRBORNE_VEHICLE;
    }
    if (targetKindOf.has('INFANTRY')) {
      return WEAPON_ANTI_AIRBORNE_INFANTRY;
    }
    if (targetKindOf.has('PARACHUTE')) {
      return WEAPON_ANTI_PARACHUTE;
    }
    // Airborne but not a recognized sub-type — unattackable in practice.
    return 0;
  }
  return WEAPON_ANTI_GROUND;
}

export function refreshEntityCombatProfiles(self: GL, entity: MapEntity): void {
  const registry = self.iniDataRegistry;
  if (!registry) {
    return;
  }

  const previousWeapon = entity.attackWeapon;
  entity.attackWeapon = self.resolveAttackWeaponProfileForSetSelection(
    entity.weaponTemplateSets,
    entity.weaponSetFlagsMask,
    registry,
    entity.forcedWeaponSlot,
  );
  entity.attackWeaponSlotIndex = self.resolveAttackWeaponSlotIndex(
    entity.weaponTemplateSets,
    entity.weaponSetFlagsMask,
    registry,
    entity.forcedWeaponSlot,
  );
  entity.largestWeaponRange = self.resolveLargestWeaponRangeForSetSelection(
    entity.weaponTemplateSets,
    entity.weaponSetFlagsMask,
    registry,
    entity.forcedWeaponSlot,
  );
  entity.totalWeaponAntiMask = self.resolveTotalWeaponAntiMaskForSetSelection(
    entity.weaponTemplateSets,
    entity.weaponSetFlagsMask,
    registry,
    entity.forcedWeaponSlot,
  );
  entity.armorDamageCoefficients = self.resolveArmorDamageCoefficientsForSetSelection(
    entity.armorTemplateSets,
    entity.armorSetFlagsMask,
    registry,
  );

  // Source parity: apply RANGE bonus from global weapon bonus table to resolved weapon profile.
  if (entity.attackWeapon) {
    const rangeBonus = self.resolveWeaponRangeBonusMultiplier(entity);
    if (rangeBonus !== 1.0) {
      entity.attackWeapon = {
        ...entity.attackWeapon,
        attackRange: entity.attackWeapon.attackRange * rangeBonus,
      };
    }
  }

  const nextWeapon = entity.attackWeapon;
  const scatterTargetPatternChanged = (() => {
    if (!previousWeapon || !nextWeapon) {
      return previousWeapon !== nextWeapon;
    }
    if (previousWeapon.scatterTargets.length !== nextWeapon.scatterTargets.length) {
      return true;
    }
    for (let index = 0; index < previousWeapon.scatterTargets.length; index += 1) {
      const previousTarget = previousWeapon.scatterTargets[index];
      const nextTarget = nextWeapon.scatterTargets[index];
      if (!previousTarget || !nextTarget) {
        return true;
      }
      if (previousTarget.x !== nextTarget.x || previousTarget.z !== nextTarget.z) {
        return true;
      }
    }
    return false;
  })();
  // Source parity: WeaponSet::updateWeaponSet — when a set change keeps the same
  // weapon template in a slot, preserve runtime state (clip ammo, reload timers,
  // consecutive shots). Only fully reset timing when the template name changes
  // (i.e., a truly different weapon is now selected).
  const weaponTemplateChanged = previousWeapon?.name !== nextWeapon?.name;
  if (weaponTemplateChanged) {
    self.resetEntityWeaponTimingState(entity);
  } else if (scatterTargetPatternChanged && nextWeapon) {
    // Same weapon template but scatter offsets changed (e.g., upgrade modified scatter) —
    // rebuild scatter targets without resetting clip/reload state.
    self.rebuildEntityScatterTargets(entity);
  }
}

export function issueAttackEntity(self: GL,
  entityId: number,
  targetEntityId: number,
  commandSource: AttackCommandSource,
): void {
  const attacker = self.spawnedEntities.get(entityId);
  const target = self.spawnedEntities.get(targetEntityId);
  if (!attacker || !target) {
    return;
  }
  if (attacker.destroyed || target.destroyed) {
    return;
  }
  const weapon = attacker.attackWeapon;
  if (!weapon || weapon.primaryDamage <= 0) {
    return;
  }

  // Source parity: ZH AIAttackState::onEnter/update (AIStates.cpp:5547-5551, 5660-5666) —
  // chooseWeapon() returns STATE_FAILURE when no suitable weapon is available for the target.
  // Check weapon anti-mask against target type: if the specific weapon can't engage this
  // target category, fail the attack to prevent units getting stuck.
  if (weapon.antiMask !== 0) {
    const targetKindOf = self.resolveEntityKindOfSet(target);
    const targetAntiMask = resolveTargetAntiMask(self, target, targetKindOf);
    if (targetAntiMask !== 0 && (weapon.antiMask & targetAntiMask) === 0) {
      return;
    }
  }

  self.setEntityIgnoringStealthStatus(attacker, weapon.continueAttackRange > 0);
  if (!canAttackerTargetEntity(self, attacker, target, commandSource)) {
    self.setEntityIgnoringStealthStatus(attacker, false);
    return;
  }

  attacker.attackTargetEntityId = targetEntityId;
  attacker.attackOriginalVictimPosition = {
    x: target.x,
    z: target.z,
  };
  attacker.attackCommandSource = commandSource;

  const attackRange = weapon.attackRange;
  if (!attacker.canMove || attackRange <= 0) {
    attacker.moving = false;
    attacker.moveTarget = null;
    attacker.movePath = [];
    attacker.pathIndex = 0;
    attacker.pathfindGoalCell = null;
    return;
  }

  self.issueMoveTo(attacker.id, target.x, target.z, attackRange);

  // Source parity: ZH AIUpdate.cpp:1980-1997 — after computing attack path, verify
  // the path endpoint is within weapon range of the target. If not, the unit can't
  // reach a valid firing position, so clear the attack state.
  if (attacker.movePath.length > 0) {
    const lastNode = attacker.movePath[attacker.movePath.length - 1]!;
    const dx = lastNode.x - target.x;
    const dz = lastNode.z - target.z;
    const endpointDistSqr = dx * dx + dz * dz;
    const maxRangeSqr = attackRange * attackRange;
    if (endpointDistSqr > maxRangeSqr) {
      // Path endpoint is outside weapon range — attack cannot succeed.
      attacker.attackTargetEntityId = null;
      attacker.attackOriginalVictimPosition = null;
      attacker.attackCommandSource = 'AI';
      self.setEntityIgnoringStealthStatus(attacker, false);
      attacker.moving = false;
      attacker.moveTarget = null;
      attacker.movePath = [];
      attacker.pathIndex = 0;
      attacker.pathfindGoalCell = null;
    }
  }
}

export function issueFireWeapon(self: GL,
  entityId: number,
  weaponSlot: number,
  maxShotsToFire: number,
  targetObjectId: number | null,
  targetPosition: readonly [number, number, number] | null,
): void {
  const attacker = self.spawnedEntities.get(entityId);
  if (!attacker || attacker.destroyed) {
    return;
  }

  const normalizedWeaponSlot = self.normalizeWeaponSlot(Math.trunc(weaponSlot));
  if (normalizedWeaponSlot === null) {
    return;
  }
  attacker.forcedWeaponSlot = normalizedWeaponSlot;
  refreshEntityCombatProfiles(self, attacker);

  const weapon = attacker.attackWeapon;
  if (!weapon || weapon.primaryDamage <= 0) {
    return;
  }

  self.setEntityIgnoringStealthStatus(attacker, weapon.continueAttackRange > 0);
  attacker.attackCommandSource = 'PLAYER';
  attacker.attackTargetEntityId = null;
  attacker.attackOriginalVictimPosition = null;
  attacker.attackTargetPosition = null;
  attacker.preAttackFinishFrame = 0;

  // Source parity: MSG_DO_WEAPON sets a temporary weapon lock and shot counter.
  attacker.weaponLockStatus = 'LOCKED_TEMPORARILY';
  attacker.maxShotsRemaining = maxShotsToFire > 0 ? maxShotsToFire : 0;
  if (maxShotsToFire <= 0) {
    return;
  }

  if (targetObjectId !== null) {
    issueAttackEntity(self, entityId, targetObjectId, 'PLAYER');
    return;
  }

  if (targetPosition === null) {
    return;
  }

  const [targetX, , targetZ] = targetPosition;
  attacker.attackTargetPosition = { x: targetX, z: targetZ };

  // Source behavior for MSG_DO_WEAPON_AT_LOCATION sends a target location while some
  // commands also append an object ID for obstacle awareness. We only have positional
  // targeting here and select a victim dynamically from command-local state.
  const targetEntity = findFireWeaponTargetForPosition(self, attacker, targetX, targetZ);
  if (!targetEntity) {
    const attackRange = Math.max(0, weapon.attackRange);
    if (attacker.canMove) {
      self.issueMoveTo(entityId, targetX, targetZ, attackRange);
    }
    return;
  }
  issueAttackEntity(self, entityId, targetEntity.id, 'PLAYER');
}

export function issueFireWeaponAtPosition(self: GL, 
  entityId: number,
  targetX: number,
  targetZ: number,
  maxShotsToFire: number,
): void {
  const attacker = self.spawnedEntities.get(entityId);
  if (!attacker || attacker.destroyed) {
    return;
  }

  // Source parity: FireWeaponPower.cpp checks self->isDisabled() and returns early.
  if (attacker.objectStatusFlags.has('DISABLED_EMP')
    || attacker.objectStatusFlags.has('DISABLED_HACKED')
    || attacker.objectStatusFlags.has('DISABLED_SUBDUED')
    || attacker.objectStatusFlags.has('DISABLED_HELD')) {
    return;
  }

  // Source parity: FireWeaponPower reloads all ammo before firing.
  // C++ calls reloadAllAmmo(TRUE) across all weapon slots; we only track one.
  if (attacker.attackWeapon) {
    attacker.attackAmmoInClip = attacker.attackWeapon.clipSize;
  }

  // Issue attack at position using primary weapon slot (0).
  issueFireWeapon(self, entityId, 0, maxShotsToFire, null, [targetX, 0, targetZ]);
}

export function findFireWeaponTargetForPosition(self: GL, 
  attacker: MapEntity,
  targetX: number,
  targetZ: number,
): MapEntity | null {
  const weapon = attacker.attackWeapon;
  if (!weapon) {
    return null;
  }

  const attackRange = Math.max(0, weapon.attackRange);
  const attackRangeSqr = attackRange * attackRange;
  let bestTarget: MapEntity | null = null;
  let bestDistanceSqr = Number.POSITIVE_INFINITY;

  for (const candidate of self.spawnedEntities.values()) {
    if (!candidate.canTakeDamage || candidate.destroyed) {
      continue;
    }
    if (candidate.id === attacker.id) {
      continue;
    }
    if (!canAttackerTargetEntity(self, attacker, candidate, attacker.attackCommandSource)) {
      continue;
    }
    const dx = candidate.x - targetX;
    const dz = candidate.z - targetZ;
    const distanceSqr = dx * dx + dz * dz;
    if (distanceSqr > attackRangeSqr) {
      continue;
    }
    if (distanceSqr >= bestDistanceSqr) {
      continue;
    }
    bestTarget = candidate;
    bestDistanceSqr = distanceSqr;
  }

  return bestTarget;
}

export function clearAttackTarget(self: GL, entityId: number): void {
  const entity = self.spawnedEntities.get(entityId);
  if (!entity) {
    return;
  }
  entity.attackTargetEntityId = null;
  entity.attackTargetPosition = null;
  entity.attackOriginalVictimPosition = null;
  entity.attackCommandSource = 'AI';
  // Source parity: AIAttackState::onExit() — clear all attack flags on target release.
  self.setEntityAttackStatus(entity, false);
  entity.preAttackFinishFrame = 0;
  // Source parity: AIAttackState::onExit() — clear leech range mode for all weapons.
  // C++ file: AIStates.cpp:5714 — obj->clearLeechRangeModeForAllWeapons().
  entity.leechRangeActive = false;
  // Source parity: releaseWeaponLock on attack exit — temporary locks are cleared.
  self.releaseTemporaryWeaponLock(entity);
}

export function clearMaxShotsAttackState(self: GL, entity: MapEntity): void {
  entity.attackTargetEntityId = null;
  entity.attackTargetPosition = null;
  entity.attackOriginalVictimPosition = null;
  entity.attackCommandSource = 'AI';
  entity.maxShotsRemaining = 0;
  self.setEntityAttackStatus(entity, false);
  entity.preAttackFinishFrame = 0;
  self.releaseTemporaryWeaponLock(entity);
}

export function findCommandButtonHuntTarget(self: GL, 
  source: MapEntity,
  commandButtonDef: CommandButtonDef,
  mode: CommandButtonHuntMode,
  scanRange: number,
): MapEntity | null {
  const range = Math.max(0, scanRange);
  const rangeSqr = range * range;
  const sourceOffMap = self.isEntityOffMap(source);

  let allowEnemies = false;
  let allowNeutral = false;
  let allowAllies = false;
  if (mode === 'ENTER_CARBOMB') {
    allowNeutral = true;
  } else if (mode === 'ENTER_HIJACK' || mode === 'ENTER_SABOTAGE') {
    allowEnemies = true;
  } else if (mode === 'SPECIAL_POWER') {
    const options = self.resolveScriptCommandButtonOptionMask(commandButtonDef);
    allowEnemies = (options & SCRIPT_COMMAND_OPTION_NEED_TARGET_ENEMY_OBJECT) !== 0;
    allowNeutral = (options & SCRIPT_COMMAND_OPTION_NEED_TARGET_NEUTRAL_OBJECT) !== 0;
    allowAllies = (options & SCRIPT_COMMAND_OPTION_NEED_TARGET_ALLY_OBJECT) !== 0;
    if (!allowEnemies && !allowNeutral && !allowAllies) {
      allowEnemies = true;
    }
  }

  let bestTarget: MapEntity | null = null;
  let bestDistanceSqr = Number.POSITIVE_INFINITY;
  for (const candidate of self.spawnedEntities.values()) {
    if (candidate.destroyed || candidate.id === source.id) {
      continue;
    }
    if (self.isEntityOffMap(candidate) !== sourceOffMap) {
      continue;
    }
    if (candidate.objectStatusFlags.has('STEALTHED') && !candidate.objectStatusFlags.has('DETECTED')) {
      continue;
    }

    const relation = self.getTeamRelationship(source, candidate);
    const relationAllowed = (allowEnemies && relation === RELATIONSHIP_ENEMIES)
      || (allowNeutral && relation === RELATIONSHIP_NEUTRAL)
      || (allowAllies && relation === RELATIONSHIP_ALLIES);
    if (!relationAllowed) {
      continue;
    }

    const dx = candidate.x - source.x;
    const dz = candidate.z - source.z;
    const distanceSqr = (dx * dx) + (dz * dz);
    if (distanceSqr > rangeSqr || distanceSqr >= bestDistanceSqr) {
      continue;
    }
    if (!isCommandButtonHuntTargetValidForMode(self, source, candidate, mode)) {
      continue;
    }

    bestTarget = candidate;
    bestDistanceSqr = distanceSqr;
  }

  return bestTarget;
}

export function isCommandButtonHuntTargetValidForMode(self: GL, 
  source: MapEntity,
  target: MapEntity,
  mode: CommandButtonHuntMode,
): boolean {
  switch (mode) {
    case 'SPECIAL_POWER':
      return target.canTakeDamage;
    case 'ENTER_HIJACK':
      return self.canExecuteHijackVehicleEnterAction(source, target);
    case 'ENTER_CARBOMB':
      return self.canExecuteConvertToCarBombEnterAction(source, target);
    case 'ENTER_SABOTAGE':
      return self.resolveSabotageBuildingProfile(source, target) !== null;
    default:
      return false;
  }
}

export function updateIdleAutoTargeting(self: GL): void {
  for (const entity of self.spawnedEntities.values()) {
    if (entity.destroyed) {
      continue;
    }

    // Only scan combat-capable entities with weapons.
    if (!entity.attackWeapon) {
      continue;
    }

    // Source parity: skip disabled entities (paralyzed, EMP, hacked, unmanned, subdued).
    // ZH adds DISABLED_SUBDUED guard — AIStates.cpp:1436 (AIIdleState::update).
    if (
      self.entityHasObjectStatus(entity, 'DISABLED_PARALYZED') ||
      self.entityHasObjectStatus(entity, 'DISABLED_EMP') ||
      self.entityHasObjectStatus(entity, 'DISABLED_HACKED') ||
      self.entityHasObjectStatus(entity, 'DISABLED_UNMANNED') ||
      self.entityHasObjectStatus(entity, 'DISABLED_SUBDUED')
    ) {
      continue;
    }

    // Source parity: GeneralsMD Object::isAbleToAttack() — units under construction cannot attack.
    // Prevents auto-acquire for buildings/units still being built.
    if (self.entityHasObjectStatus(entity, 'UNDER_CONSTRUCTION')) {
      continue;
    }

    // Source parity: don't auto-acquire while already attacking or moving.
    if (entity.attackTargetEntityId !== null || entity.attackTargetPosition !== null) {
      continue;
    }
    if (entity.moving) {
      continue;
    }

    // Source parity: parked/reloading aircraft should not auto-acquire targets.
    // C++ JetAI state machine controls command dispatch; grounded jets are inert.
    const autoTargetJs = entity.jetAIState;
    if (autoTargetJs && (autoTargetJs.state === 'PARKED' || autoTargetJs.state === 'RELOAD_AMMO'
      || autoTargetJs.state === 'TAKING_OFF' || autoTargetJs.state === 'LANDING')) {
      continue;
    }

    // Source parity: ActiveBody::shouldRetaliate — skip if using a special ability.
    if (entity.objectStatusFlags.has('IS_USING_ABILITY')) {
      continue;
    }

    // Source parity: AIGuardRetaliate — immediate retaliation when attacked.
    // C++ BodyModule::getClearableLastAttacker() returns the last damage source;
    // guard/idle AI checks this EVERY FRAME and immediately retaliates, bypassing
    // the 2-second auto-target scan interval. This makes units feel responsive.
    // Note: DAMAGE_HEALING never sets lastAttackerEntityId (filtered at damage
    // application time — see ActiveBody.cpp line 379 early return for DAMAGE_HEALING).
    if (entity.lastAttackerEntityId !== null) {
      const attackerId = entity.lastAttackerEntityId;
      entity.lastAttackerEntityId = null; // Source parity: clearLastAttacker().
      const attacker = self.spawnedEntities.get(attackerId);
      if (attacker && !attacker.destroyed
          && self.getTeamRelationship(entity, attacker) === RELATIONSHIP_ENEMIES
          && canAttackerTargetEntity(self, entity, attacker, 'AI')
          // Source parity: ActiveBody.cpp lines 783-786 — stealthed units skip
          // retaliation UNLESS they are detected (inside a detector's radius).
          && !(entity.objectStatusFlags.has('STEALTHED') && !entity.objectStatusFlags.has('DETECTED'))) {
        issueAttackEntity(self, entity.id, attacker.id, 'AI');
        continue;
      }
    }

    // Source parity: passive AI units only retaliate to last attacker and
    // otherwise skip proactive idle-acquire scans.
    if (
      self.getControllingPlayerTypeForEntity(entity) !== 'HUMAN'
      && entity.scriptAttitude === SCRIPT_AI_ATTITUDE_PASSIVE
    ) {
      continue;
    }

    // Guarding entities use their own scan logic in updateGuardBehavior().
    if (entity.guardState !== 'NONE') {
      continue;
    }

    // Source parity: AutoAcquireEnemiesWhenIdle AAS_Idle_No — unit never auto-targets.
    if (entity.autoAcquireEnemiesWhenIdle & AAS_IDLE_NO) {
      continue;
    }

    // Source parity: stealthed units do not auto-acquire targets (would break stealth)
    // unless AAS_Idle_Stealthed flag is set in AutoAcquireEnemiesWhenIdle.
    // ZH addition (AIUpdate.cpp:4483-4488): units whose stealth was granted by a special
    // power (e.g., GPS Scrambler) CAN auto-acquire while stealthed.
    if (entity.objectStatusFlags.has('STEALTHED') && !(entity.autoAcquireEnemiesWhenIdle & AAS_IDLE_STEALTHED)) {
      if (!(entity.stealthProfile && entity.stealthProfile.grantedBySpecialPower)) {
        continue;
      }
    }

    // Throttle scanning to once per entity moodAttackCheckRate (or global default).
    if (self.frameCounter < entity.autoTargetScanNextFrame) {
      continue;
    }
    const scanRate = entity.moodAttackCheckRate > 0 ? entity.moodAttackCheckRate : AUTO_TARGET_SCAN_RATE_FRAMES;
    entity.autoTargetScanNextFrame = self.frameCounter + scanRate;

    // Source parity: findClosestEnemy — C++ uses vision range for AI-controlled
    // units and weapon range for human-controlled units.
    const weapon = entity.attackWeapon;
    const entitySidePlayerType = self.getControllingPlayerTypeForEntity(entity);
    const entityKindOf = self.resolveEntityKindOfSet(entity);
    const entityIsAircraft = entityKindOf.has('AIRCRAFT');
    const scanRange = entitySidePlayerType === 'HUMAN'
      ? weapon.attackRange
      : Math.max(weapon.attackRange, entity.visionRange);
    const scanRangeSqr = scanRange * scanRange;

    let bestTarget: MapEntity | null = null;
    let bestDistanceSqr = Number.POSITIVE_INFINITY;

    for (const candidate of self.spawnedEntities.values()) {
      if (candidate.destroyed || !candidate.canTakeDamage) {
        continue;
      }
      if (candidate.id === entity.id) {
        continue;
      }
      // Source parity: only auto-target enemies.
      if (self.getTeamRelationship(entity, candidate) !== RELATIONSHIP_ENEMIES) {
        continue;
      }
      // Source parity: stealthed units not auto-acquired unless detected.
      if (
        candidate.objectStatusFlags.has('STEALTHED') &&
        !candidate.objectStatusFlags.has('DETECTED')
      ) {
        continue;
      }
      // Source parity: AIStates.cpp line 2622 — Computer AI don't chase aircraft
      // unless they are in hunt mode. Non-aircraft units controlled by the computer
      // skip airborne aircraft targets during idle auto-acquire.
      if (entitySidePlayerType === 'COMPUTER' && !entityIsAircraft) {
        const candidateKindOf = self.resolveEntityKindOfSet(candidate);
        if (candidateKindOf.has('AIRCRAFT') && (
          self.entityHasObjectStatus(candidate, 'AIRBORNE_TARGET') || candidate.category === 'air'
        )) {
          continue;
        }
      }
      if (!canAttackerTargetEntity(self, entity, candidate, 'AI')) {
        continue;
      }
      const dx = candidate.x - entity.x;
      const dz = candidate.z - entity.z;
      const distanceSqr = dx * dx + dz * dz;
      if (distanceSqr > scanRangeSqr) {
        continue;
      }
      if (distanceSqr < bestDistanceSqr) {
        bestTarget = candidate;
        bestDistanceSqr = distanceSqr;
      }
    }

    if (bestTarget) {
      issueAttackEntity(self, entity.id, bestTarget.id, 'AI');
    }
  }
}

export function findGuardTarget(self: GL, 
  entity: MapEntity,
  centerX: number,
  centerZ: number,
  range: number,
): MapEntity | null {
  const rangeSqr = range * range;
  const guardArea = entity.guardAreaTriggerIndex >= 0
    ? self.mapTriggerRegions[entity.guardAreaTriggerIndex] ?? null
    : null;
  if (entity.guardAreaTriggerIndex >= 0 && !guardArea) {
    entity.guardAreaTriggerIndex = -1;
  }
  let bestTarget: MapEntity | null = null;
  let bestDistanceSqr = Number.POSITIVE_INFINITY;

  for (const candidate of self.spawnedEntities.values()) {
    if (candidate.destroyed || !candidate.canTakeDamage) {
      continue;
    }
    if (candidate.id === entity.id) {
      continue;
    }
    if (self.getTeamRelationship(entity, candidate) !== RELATIONSHIP_ENEMIES) {
      continue;
    }
    if (guardArea && !self.isPointInsideTriggerRegion(guardArea, candidate.x, candidate.z)) {
      continue;
    }
    // Source parity: GUARDMODE_GUARD_FLYING_UNITS_ONLY — only target air units.
    if (entity.guardMode === 2 && candidate.category !== 'air') {
      continue;
    }
    if (
      candidate.objectStatusFlags.has('STEALTHED') &&
      !candidate.objectStatusFlags.has('DETECTED')
    ) {
      continue;
    }
    // Source parity: AIGuardRetaliate.cpp line 249/275 — PartitionFilterRejectBuildings.
    // Guard retaliation rejects buildings unless:
    //   1. Computer AI units can acquire enemy buildings, OR
    //   2. Building is a base defense (KINDOF FS_BASE_DEFENSE), OR
    //   3. Building is garrisoned and can attack.
    const candidateKindOf = self.resolveEntityKindOfSet(candidate);
    if (candidateKindOf.has('STRUCTURE')) {
      const entityPlayerType = self.getControllingPlayerTypeForEntity(entity);
      if (entityPlayerType !== 'COMPUTER') {
        // Human player: only allow base defenses or garrisoned buildings that can attack.
        const isBaseDefense = candidateKindOf.has('FS_BASE_DEFENSE');
        const isGarrisonedAttacker = candidate.containProfile !== null
          && candidate.containProfile.moduleType === 'GARRISON'
          && self.collectContainedEntityIds(candidate.id).length > 0
          && candidate.attackWeapon !== null;
        if (!isBaseDefense && !isGarrisonedAttacker) {
          continue;
        }
      }
      // Computer player: allow all enemy buildings (m_acquireEnemies = true).
    }
    if (!canAttackerTargetEntity(self, entity, candidate, 'AI')) {
      continue;
    }
    const dx = candidate.x - centerX;
    const dz = candidate.z - centerZ;
    const distanceSqr = dx * dx + dz * dz;
    if (distanceSqr > rangeSqr) {
      continue;
    }
    if (distanceSqr < bestDistanceSqr) {
      bestTarget = candidate;
      bestDistanceSqr = distanceSqr;
    }
  }

  return bestTarget;
}

export function queueWeaponDamageEvent(self: GL, attacker: MapEntity, target: MapEntity, weapon: AttackWeaponProfile, inflictDamage: boolean = true): void {
  // Source parity: Object::getLastShotFiredFrame() — track last normal weapon fire for ExclusiveWeaponDelay.
  attacker.lastShotFiredFrame = self.frameCounter;
  let sourceX = attacker.x;
  let sourceZ = attacker.z;
  const targetX = target.x;
  const targetZ = target.z;

  // Source parity: GarrisonContain.cpp — trackTargets() fires from FIREPOINT bones at the
  // building edge. Without the full bone system, approximate by offsetting the fire origin
  // toward the target by a fraction of the building's geometry radius.
  if (attacker.garrisonContainerId !== null) {
    const building = self.spawnedEntities.get(attacker.garrisonContainerId);
    if (building && !building.destroyed) {
      const dx = targetX - building.x;
      const dz = targetZ - building.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 0) {
        const offset = building.geometryMajorRadius * 0.8;
        sourceX = building.x + (dx / dist) * offset;
        sourceZ = building.z + (dz / dist) * offset;
      }
    }
  }

  let aimX = targetX;
  let aimZ = targetZ;
  let primaryVictimEntityId = weapon.damageDealtAtSelfPosition ? null : target.id;

  const sneakyOffset = self.resolveEntitySneakyTargetingOffset(target);
  if (sneakyOffset && primaryVictimEntityId !== null) {
    aimX += sneakyOffset.x;
    aimZ += sneakyOffset.z;
    // Source parity: WeaponTemplate::fireWeaponTemplate() converts sneaky-targeted
    // victim shots into position-shots using AIUpdateInterface::getSneakyTargetingOffset().
    primaryVictimEntityId = null;
  }

  if (attacker.attackScatterTargetsUnused.length > 0) {
    const randomPick = self.gameRandom.nextRange(0, attacker.attackScatterTargetsUnused.length - 1);
    const targetIndex = attacker.attackScatterTargetsUnused[randomPick];
    const scatterOffset = targetIndex === undefined ? null : weapon.scatterTargets[targetIndex];
    if (scatterOffset) {
      aimX += scatterOffset.x * weapon.scatterTargetScalar;
      aimZ += scatterOffset.z * weapon.scatterTargetScalar;
      primaryVictimEntityId = null;
    }

    attacker.attackScatterTargetsUnused[randomPick] = attacker.attackScatterTargetsUnused[attacker.attackScatterTargetsUnused.length - 1]!;
    attacker.attackScatterTargetsUnused.pop();
    // Source parity: Weapon::privateFireWeapon() consumes one ScatterTarget
    // offset per shot from a randomized "unused" list until reload rebuilds it.
    // Scatter terrain projection handled at impactY resolution (line uses heightmap).
  }

  let delivery: 'DIRECT' | 'PROJECTILE' | 'LASER' = 'DIRECT';
  let travelSpeed = weapon.weaponSpeed;
  if (weapon.projectileObjectName) {
    delivery = 'PROJECTILE';
    // Source parity: Weapon.cpp projectile branch notifies completion immediately when the
    // source object itself has SpecialPowerCompletionDie with a valid creator id.
    self.notifyScriptCompletedSpecialPowerOnProjectileFired(attacker);
    // Source parity: projectile weapons in WeaponTemplate::fireWeaponTemplate()
    // spawn ProjectileObject and defer damage to projectile update/collision.
    // We represent this as a deterministic delayed impact without spawning a full
    // projectile object graph yet.

    const scatterRadius = self.resolveProjectileScatterRadiusForTarget(weapon, target);
    if (scatterRadius > 0) {
      const randomizedScatterRadius = scatterRadius * self.gameRandom.nextFloat();
      const scatterAngleRadians = self.gameRandom.nextFloat() * (2 * Math.PI);
      aimX += randomizedScatterRadius * Math.cos(scatterAngleRadians);
      aimZ += randomizedScatterRadius * Math.sin(scatterAngleRadians);
      primaryVictimEntityId = null;
      // Source parity: projectile scatter path launches at a position (not victim object),
      // so impact no longer homes to the moving target.
      // Scatter terrain projection handled at impactY resolution below.
    }
    const sourceToAimDistance = Math.hypot(aimX - sourceX, aimZ - sourceZ);
    travelSpeed = self.resolveScaledProjectileTravelSpeed(weapon, sourceToAimDistance);
  } else if (weapon.laserName) {
    // Source parity: Weapon::fireWeaponTemplate() laser sub-branch.
    // Laser damage is always instant. If scatter moved the aim point outside the
    // weapon's damage radius, damageID becomes INVALID (ground shot / miss).
    delivery = 'LASER';
    const scatterDx = aimX - targetX;
    const scatterDz = aimZ - targetZ;
    const scatterDistSqr = scatterDx * scatterDx + scatterDz * scatterDz;
    const primaryRadiusSqr = weapon.primaryDamageRadius * weapon.primaryDamageRadius;
    const secondaryRadiusSqr = weapon.secondaryDamageRadius * weapon.secondaryDamageRadius;
    if (scatterDistSqr > Math.max(primaryRadiusSqr, secondaryRadiusSqr) && scatterDistSqr > 0) {
      // Scatter caused a miss — laser hits ground, no victim ID.
      primaryVictimEntityId = null;
    }
  } else {
    // Source parity: Weapon::fireWeaponTemplate delays direct-damage resolution by
    // distance / getWeaponSpeed().
  }

  const impactX = weapon.damageDealtAtSelfPosition ? sourceX : aimX;
  const impactZ = weapon.damageDealtAtSelfPosition ? sourceZ : aimZ;
  const heightmap = self.mapHeightmap;
  const impactY = heightmap ? heightmap.getInterpolatedHeight(impactX, impactZ) : 0;

  // Source parity: DumbProjectileBehavior::calcFlightPath() — compute cubic Bezier
  // arc control points and use arc length for travel time when arc params are present.
  let hasBezierArc = false;
  let bezierP1Y = 0;
  let bezierP2Y = 0;
  let bezierFirstPercentIndent = 0;
  let bezierSecondPercentIndent = 0;

  if (
    delivery === 'PROJECTILE' &&
    (weapon.projectileArcFirstHeight !== 0 || weapon.projectileArcSecondHeight !== 0 ||
     weapon.projectileArcFirstPercentIndent !== 0 || weapon.projectileArcSecondPercentIndent !== 0)
  ) {
    hasBezierArc = true;
    bezierFirstPercentIndent = weapon.projectileArcFirstPercentIndent;
    bezierSecondPercentIndent = weapon.projectileArcSecondPercentIndent;

    // Source parity: highestInterveningTerrain = max(terrain along line, P0.z, P3.z)
    let highestTerrain = Math.max(attacker.y, impactY);
    if (heightmap) {
      const terrainMax = estimateHighestTerrainAlongLine(
        heightmap, sourceX, sourceZ, impactX, impactZ, BEZIER_TERRAIN_SAMPLE_COUNT,
      );
      highestTerrain = Math.max(highestTerrain, terrainMax);
    }
    bezierP1Y = highestTerrain + weapon.projectileArcFirstHeight;
    bezierP2Y = highestTerrain + weapon.projectileArcSecondHeight;
  }

  const sourceToAimDistance = Math.hypot(aimX - sourceX, aimZ - sourceZ);
  let delayFrames: number;
  if (delivery === 'LASER') {
    // Source parity: laser damage is always instant — returns TheGameLogic->getFrame().
    delayFrames = 0;
  } else if (delivery === 'PROJECTILE') {
    let flightDistance: number;
    if (hasBezierArc) {
      // Source parity: flightDistance = BezierSegment::getApproximateLength()
      const p0x = sourceX, p0y = attacker.y, p0z = sourceZ;
      const p3x = impactX, p3y = impactY, p3z = impactZ;
      const dx = p3x - p0x, dy = p3y - p0y, dz = p3z - p0z;
      const dist = Math.hypot(dx, dy, dz);
      const nx = dist > 0 ? dx / dist : 0;
      const nz = dist > 0 ? dz / dist : 0;
      const p1x = p0x + nx * dist * bezierFirstPercentIndent;
      const p1z = p0z + nz * dist * bezierFirstPercentIndent;
      const p2x = p0x + nx * dist * bezierSecondPercentIndent;
      const p2z = p0z + nz * dist * bezierSecondPercentIndent;
      flightDistance = approximateCubicBezierArcLength3D(
        p0x, p0y, p0z,
        p1x, bezierP1Y, p1z,
        p2x, bezierP2Y, p2z,
        p3x, p3y, p3z,
        BEZIER_ARC_LENGTH_TOLERANCE, 0,
      );
    } else {
      flightDistance = sourceToAimDistance;
    }
    const travelFrames = flightDistance / travelSpeed;
    delayFrames = Math.max(1, Number.isFinite(travelFrames) && travelFrames >= 1
      ? Math.ceil(travelFrames) : 1);
  } else {
    const travelFrames = sourceToAimDistance / travelSpeed;
    delayFrames = Number.isFinite(travelFrames) && travelFrames >= 1
      ? Math.ceil(travelFrames) : 0;
  }

  // Source parity: Weapon::computeBonus() — apply damage and radius bonuses at fire time.
  const damageBonus = self.resolveWeaponDamageBonusMultiplier(attacker);
  const radiusBonus = self.resolveWeaponRadiusBonusMultiplier(attacker);
  const bonusedWeapon: AttackWeaponProfile = (damageBonus !== 1.0 || radiusBonus !== 1.0)
    ? {
      ...weapon,
      primaryDamage: weapon.primaryDamage * damageBonus,
      secondaryDamage: weapon.secondaryDamage * damageBonus,
      primaryDamageRadius: weapon.primaryDamageRadius * radiusBonus,
      secondaryDamageRadius: weapon.secondaryDamageRadius * radiusBonus,
    }
    : weapon;

  let missileAIProfile: MissileAIProfile | null = null;
  let missileAIState: MissileAIRuntimeState | null = null;
  let executeFrame = self.frameCounter + delayFrames;
  let projectilePlannedImpactFrame: number | null = null;

  if (delivery === 'PROJECTILE' && weapon.projectileObjectName) {
    missileAIProfile = self.extractMissileAIProfile(weapon.projectileObjectName);
    if (missileAIProfile) {
      // Source parity: MissileAIUpdate owns flight and detonation timing.
      // Leave queued executeFrame far in the future until MissileAI transitions to KILL.
      executeFrame = Number.MAX_SAFE_INTEGER;

      // Source parity: projectileFireAtObjectOrPosition initializes heading from
      // launcher forward vector with positive-Z correction when target is above missile.
      let dirX = 0;
      let dirY = 0;
      let dirZ = 1;
      const launcherForward = self.resolveForwardUnitVector(attacker);
      const forwardLength = Math.hypot(launcherForward.x, launcherForward.z);
      if (forwardLength > 0) {
        dirX = launcherForward.x / forwardLength;
        dirZ = launcherForward.z / forwardLength;
      } else {
        const toTargetX = impactX - sourceX;
        const toTargetZ = impactZ - sourceZ;
        const toTargetLength = Math.hypot(toTargetX, toTargetZ);
        if (toTargetLength > 0) {
          dirX = toTargetX / toTargetLength;
          dirZ = toTargetZ / toTargetLength;
        }
      }

      const xyDistance = Math.max(1, Math.hypot(impactX - sourceX, impactZ - sourceZ));
      const deltaY = impactY - attacker.y;
      const zFactor = deltaY > 0 ? (deltaY / xyDistance) : 0;
      dirY += 2 * zFactor;

      const directionLength = Math.hypot(dirX, dirY, dirZ);
      if (directionLength > 0) {
        dirX /= directionLength;
        dirY /= directionLength;
        dirZ /= directionLength;
      } else {
        dirX = 0;
        dirY = 0;
        dirZ = 1;
      }

      const missileSpeed = missileAIProfile.useWeaponSpeed
        ? travelSpeed
        : (missileAIProfile.initialVelocity > 0 ? missileAIProfile.initialVelocity : travelSpeed);
      const speed = Number.isFinite(missileSpeed) && missileSpeed > 0 ? missileSpeed : travelSpeed;
      const trackingTarget = missileAIProfile.tryToFollowTarget && primaryVictimEntityId !== null;
      // Source parity: MissileAIUpdate::projectileFireAtObjectOrPosition adds an approach
      // height offset for coordinate shots when lock distance is enabled.
      const approachHeight = (!trackingTarget && missileAIProfile.distanceToTargetForLock > 0)
        ? 10.0
        : 0.0;

      missileAIState = {
        state: 'LAUNCH',
        stateEnteredFrame: self.frameCounter,
        currentX: sourceX,
        currentY: attacker.y,
        currentZ: sourceZ,
        prevX: sourceX,
        prevY: attacker.y,
        prevZ: sourceZ,
        velocityX: dirX * speed,
        velocityY: dirY * speed,
        velocityZ: dirZ * speed,
        speed,
        armed: false,
        fuelExpirationFrame: Number.MAX_SAFE_INTEGER,
        noTurnDistanceLeft: missileAIProfile.distanceToTravelBeforeTurning,
        trackingTarget,
        targetEntityId: trackingTarget ? primaryVictimEntityId : null,
        targetX: impactX,
        targetY: impactY + approachHeight,
        targetZ: impactZ,
        originalTargetX: impactX,
        originalTargetY: impactY,
        originalTargetZ: impactZ,
        usePreciseTargetY: false,
        travelDistance: 0,
        totalDistanceEstimate: Math.max(1, Math.hypot(impactX - sourceX, impactZ - sourceZ)),
        isJammed: false,
      };
    } else {
      // Source parity: non-missile projectiles detonate from projectile-flight update path.
      projectilePlannedImpactFrame = self.frameCounter + delayFrames;
      executeFrame = Number.MAX_SAFE_INTEGER;
    }
  }
  const projectileVisualId = self.nextProjectileVisualId++;

  const event: PendingWeaponDamageEvent = {
    sourceEntityId: attacker.id,
    primaryVictimEntityId,
    impactX,
    impactZ,
    executeFrame,
    projectilePlannedImpactFrame,
    delivery,
    weapon: bonusedWeapon,
    launchFrame: self.frameCounter,
    sourceX,
    sourceY: attacker.y,
    sourceZ,
    projectileVisualId,
    cachedVisualType: self.classifyWeaponVisualType(weapon),
    impactY,
    bezierP1Y,
    bezierP2Y,
    bezierFirstPercentIndent,
    bezierSecondPercentIndent,
    hasBezierArc,
    countermeasureDivertFrame: 0,
    countermeasureNoDamage: false,
    suppressImpactVisual: false,
    missileAIProfile,
    missileAIState,
    scriptWaypointPath: null,
    // Source parity: DamageInfoInput::m_damageFXOverride (Damage.h:269). Default UNRESISTABLE = no override.
    damageFXOverride: 'UNRESISTABLE',
    // Source parity: DamageInfoInput::m_sourceTemplate (Damage.cpp:148-157).
    sourceTemplateName: attacker.templateName,
  };

  // Emit muzzle flash visual event (includes target endpoint for beam/tracer rendering).
  // When the fire origin is offset (e.g., garrisoned unit), pass the source override
  // so the muzzle flash renders at the building edge rather than the attacker's center.
  const sourceOverride = (sourceX !== attacker.x || sourceZ !== attacker.z)
    ? { x: sourceX, y: attacker.y + 1.5, z: sourceZ }
    : undefined;
  self.emitWeaponFiredVisualEvent(
    attacker,
    weapon,
    { x: impactX, y: impactY, z: impactZ },
    sourceOverride,
  );
  if (delivery === 'PROJECTILE') {
    self.registerActiveWeaponProjectileState(
      projectileVisualId,
      attacker,
      weapon,
      sourceX,
      attacker.y,
      sourceZ,
    );
  }

  if (delivery === 'LASER') {
    // Source parity: laser weapons always deal damage synchronously (instant hit).
    // createLaser() is called for the visual beam; damage is applied immediately.
    self.emitWeaponImpactVisualEvent(event);
    // Source parity (ZH): Weapon.cpp:1052 — inflictDamage gates dealDamageInternal.
    if (inflictDamage) {
      applyWeaponDamageEventImpl(self.createCombatDamageEventContext(), event);
    }
    return;
  }

  if (delivery === 'DIRECT' && delayFrames <= 0) {
    // Source parity: WeaponTemplate::fireWeaponTemplate() applies non-projectile
    // damage immediately when delayInFrames < 1.0f instead of queuing delayed damage.
    self.emitWeaponImpactVisualEvent(event);
    // Source parity (ZH): Weapon.cpp:1064 — inflictDamage gates dealDamageInternal.
    if (inflictDamage) {
      applyWeaponDamageEventImpl(self.createCombatDamageEventContext(), event);
    }
    return;
  }

  // Source parity: Weapon.cpp:1169-1177 — check victim for countermeasures at weapon fire time.
  // Only MISSILE projectiles (KINDOF_SMALL_MISSILE) can be diverted.
  // Source parity: supersonic jets cannot deploy countermeasures (too fast).
  if (delivery === 'PROJECTILE' && event.cachedVisualType === 'MISSILE' && primaryVictimEntityId !== null) {
    const victim = self.spawnedEntities.get(primaryVictimEntityId);
    if (victim && victim.countermeasuresState && victim.countermeasuresProfile
      && !victim.locomotorSets.has(LOCOMOTORSET_SUPERSONIC)) {
      self.reportMissileForCountermeasures(victim, event);
    }
  }

  // Source parity (ZH): Weapon.cpp:1082 — inflictDamage gates setDelayedDamage (queued damage).
  // When inflictDamage is false, projectile visual still flies but deals no damage on impact.
  if (inflictDamage) {
    self.pendingWeaponDamageEvents.push(event);
  }

  // Source parity: HistoricBonus — track hit location for bonus weapon triggering.
  self.checkHistoricBonus(bonusedWeapon, impactX, impactZ, attacker.id);

  // Source parity: FireOCL — spawn OCL at weapon fire position.
  if (weapon.fireOCLName) {
    self.executeOCL(weapon.fireOCLName, attacker, undefined, impactX, impactZ);
  }

  // Source parity: RequestAssistRange — rally idle allies to attack same target.
  if (weapon.requestAssistRange > 0 && target && !target.destroyed) {
    requestAssistFromNearbyAllies(self, attacker, target, weapon.requestAssistRange);
  }
}

export function requestAssistFromNearbyAllies(self: GL, attacker: MapEntity, target: MapEntity, range: number): void {
  const rangeSq = range * range;
  for (const ally of self.spawnedEntities.values()) {
    if (ally.destroyed || ally.id === attacker.id || !ally.attackWeapon) continue;
    if (ally.attackTargetEntityId !== null || ally.moving) continue;
    if (self.getTeamRelationship(attacker, ally) !== RELATIONSHIP_ALLIES) continue;
    const dx = ally.x - attacker.x;
    const dz = ally.z - attacker.z;
    if (dx * dx + dz * dz > rangeSq) continue;
    if (!canAttackerTargetEntity(self, ally, target, 'AI')) continue;
    issueAttackEntity(self, ally.id, target.id, 'AI');
  }
}
