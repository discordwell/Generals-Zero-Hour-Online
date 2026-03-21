interface VectorXZLike {
  x: number;
  z: number;
}

interface CombatUpdateWeaponLike {
  minAttackRange: number;
  attackRange: number;
  clipSize: number;
  autoReloadWhenIdleFrames: number;
  clipReloadFrames: number;
  /** Source parity: Weapon::m_leechRangeWeapon — unlimited range after first shot connects. */
  leechRangeWeapon: boolean;
}

interface CombatUpdateEntityLike {
  id: number;
  x: number;
  z: number;
  destroyed: boolean;
  canMove: boolean;
  moving: boolean;
  moveTarget: VectorXZLike | null;
  movePath: VectorXZLike[];
  pathIndex: number;
  pathfindGoalCell: { x: number; z: number } | null;
  preAttackFinishFrame: number;
  attackTargetEntityId: number | null;
  attackTargetPosition: VectorXZLike | null;
  attackWeapon: CombatUpdateWeaponLike | null;
  attackCommandSource: string;
  attackOriginalVictimPosition: VectorXZLike | null;
  nextAttackFrame: number;
  attackAmmoInClip: number;
  attackReloadFinishFrame: number;
  attackForceReloadFrame: number;
  attackNeedsLineOfSight: boolean;
  maxShotsRemaining: number;
  category: string;
  /**
   * Source parity: Weapon::m_leechWeaponRangeActive — set true after first shot with leech weapon.
   * Note: C++ tracks this per-weapon; we track per-entity. Safe because the range bypass also checks
   * weapon.leechRangeWeapon, so non-leech weapons on the same entity won't get unlimited range.
   */
  leechRangeActive: boolean;
}

interface CombatUpdateConstants {
  attackMinRangeDistanceSqrFudge: number;
  pathfindCellSize: number;
}

interface CombatUpdateContext<TEntity extends CombatUpdateEntityLike> {
  entities: Iterable<TEntity>;
  frameCounter: number;
  constants: CombatUpdateConstants;
  findEntityById(entityId: number): TEntity | null;
  findFireWeaponTargetForPosition(attacker: TEntity, targetX: number, targetZ: number): TEntity | null;
  canEntityAttackFromStatus(entity: TEntity): boolean;
  canAttackerTargetEntity(attacker: TEntity, target: TEntity, commandSource: string): boolean;
  setEntityAttackStatus(entity: TEntity, isAttacking: boolean): void;
  setEntityAimingWeaponStatus(entity: TEntity, isAiming: boolean): void;
  setEntityFiringWeaponStatus(entity: TEntity, isFiring: boolean): void;
  setEntityIgnoringStealthStatus(entity: TEntity, isIgnoringStealth: boolean): void;
  refreshEntitySneakyMissWindow(entity: TEntity): void;
  issueMoveTo(entityId: number, targetX: number, targetZ: number, attackDistance?: number): void;
  computeAttackRetreatTarget(
    attacker: TEntity,
    target: TEntity,
    weapon: CombatUpdateWeaponLike,
  ): VectorXZLike | null;
  rebuildEntityScatterTargets(entity: TEntity): void;
  resolveWeaponPreAttackDelayFrames(
    attacker: TEntity,
    target: TEntity,
    weapon: CombatUpdateWeaponLike,
  ): number;
  queueWeaponDamageEvent(attacker: TEntity, target: TEntity, weapon: CombatUpdateWeaponLike): void;
  recordConsecutiveAttackShot(attacker: TEntity, targetEntityId: number): void;
  resolveWeaponDelayFrames(attacker: TEntity, weapon: CombatUpdateWeaponLike): number;
  /** Source parity: Weapon::getClipReloadTime(bonus) — divide clipReloadFrames by ROF bonus. */
  resolveClipReloadFrames(attacker: TEntity, weapon: CombatUpdateWeaponLike): number;
  resolveTargetAnchorPosition(target: TEntity): VectorXZLike;
  /** Check if terrain blocks line of sight from attacker to target. */
  isAttackLineOfSightBlocked(attackerX: number, attackerZ: number, targetX: number, targetZ: number): boolean;
  /** Clear the attacker's combat state when maxShotsToFire limit is reached. */
  clearMaxShotsAttackState(attacker: TEntity): void;
  /** Source parity: TurretAI alignment check — is the turret aligned enough to fire? */
  isTurretAlignedForFiring(attacker: TEntity): boolean;
}

function clearImmediateCombatState<TEntity extends CombatUpdateEntityLike>(
  entity: TEntity,
  context: CombatUpdateContext<TEntity>,
): void {
  context.setEntityAttackStatus(entity, false);
  context.setEntityAimingWeaponStatus(entity, false);
  context.setEntityIgnoringStealthStatus(entity, false);
  context.refreshEntitySneakyMissWindow(entity);
  entity.preAttackFinishFrame = 0;
}

export function updateCombat<TEntity extends CombatUpdateEntityLike>(
  context: CombatUpdateContext<TEntity>,
): void {
  for (const attacker of context.entities) {
    if (attacker.destroyed) {
      continue;
    }

    context.setEntityFiringWeaponStatus(attacker, false);
    if (!context.canEntityAttackFromStatus(attacker)) {
      clearImmediateCombatState(attacker, context);
      continue;
    }

    const targetId = attacker.attackTargetEntityId;
    const targetPosition = attacker.attackTargetPosition;
    const weapon = attacker.attackWeapon;
    if ((targetId === null && targetPosition === null) || !weapon) {
      clearImmediateCombatState(attacker, context);
      continue;
    }

    let target = targetId === null ? null : context.findEntityById(targetId);
    if (!target && targetPosition !== null) {
      target = context.findFireWeaponTargetForPosition(attacker, targetPosition.x, targetPosition.z);
      if (!target) {
        clearImmediateCombatState(attacker, context);
        if (attacker.canMove) {
          const attackRange = Math.max(0, weapon.attackRange);
          context.issueMoveTo(attacker.id, targetPosition.x, targetPosition.z, attackRange);
        }
        continue;
      }

      attacker.attackTargetEntityId = target.id;
      const targetAnchor = context.resolveTargetAnchorPosition(target);
      attacker.attackOriginalVictimPosition = {
        x: targetAnchor.x,
        z: targetAnchor.z,
      };
    }

    if (!target || !context.canAttackerTargetEntity(attacker, target, attacker.attackCommandSource)) {
      attacker.attackTargetEntityId = null;
      attacker.attackOriginalVictimPosition = null;
      if (!targetPosition) {
        attacker.attackCommandSource = 'AI';
      }
      clearImmediateCombatState(attacker, context);
      continue;
    }

    context.setEntityAttackStatus(attacker, true);
    context.refreshEntitySneakyMissWindow(attacker);

    const dx = target.x - attacker.x;
    const dz = target.z - attacker.z;
    const distanceSqr = dx * dx + dz * dz;
    const minAttackRange = Math.max(0, weapon.minAttackRange);
    const minAttackRangeSqr = minAttackRange * minAttackRange;
    const attackRange = Math.max(0, weapon.attackRange);
    const attackRangeSqr = attackRange * attackRange;
    if (distanceSqr < Math.max(0, minAttackRangeSqr - context.constants.attackMinRangeDistanceSqrFudge)) {
      context.setEntityAimingWeaponStatus(attacker, false);
      if (attacker.canMove && minAttackRange > context.constants.pathfindCellSize) {
        const retreatTarget = context.computeAttackRetreatTarget(attacker, target, weapon);
        if (retreatTarget) {
          context.issueMoveTo(attacker.id, retreatTarget.x, retreatTarget.z);
        }
      }
      attacker.preAttackFinishFrame = 0;
      continue;
    }

    // Source parity: Weapon.cpp:873 — skip range check for leech range weapons with active lock.
    if (distanceSqr > attackRangeSqr && !(weapon.leechRangeWeapon && attacker.leechRangeActive)) {
      context.setEntityAimingWeaponStatus(attacker, false);
      if (attacker.canMove) {
        // Source parity: C++ AIAttackState only issues moveToObject on state
        // entry, not every frame. Re-issuing issueMoveTo every frame resets
        // pathIndex to 0, preventing the entity from advancing along its path.
        // Only re-issue when the entity has stopped (path exhausted or blocked),
        // or when the target has moved significantly from where we're heading.
        // Re-chase if target has moved more than half the weapon range from original position.
        // Squared threshold: (0.5 * range)^2 = 0.25 * range^2.
        const CHASE_REPATH_THRESHOLD_SQR_FACTOR = 0.25;
        const origPos = attacker.attackOriginalVictimPosition;
        const targetMoved = origPos
          ? (target.x - origPos.x) * (target.x - origPos.x)
            + (target.z - origPos.z) * (target.z - origPos.z) > attackRangeSqr * CHASE_REPATH_THRESHOLD_SQR_FACTOR
          : false;
        if (!attacker.moving || targetMoved) {
          context.issueMoveTo(attacker.id, target.x, target.z, attackRange);
          attacker.attackOriginalVictimPosition = { x: target.x, z: target.z };
        }
      }
      attacker.preAttackFinishFrame = 0;
      continue;
    }

    // Source parity: Weapon::canFireWeapon() — LOS check.
    // If attacker needs line of sight and terrain blocks it, move closer.
    // Source parity: AIStates.cpp:1139 — leech range weapons bypass LOS check (locked on).
    if (attacker.attackNeedsLineOfSight && attacker.category !== 'air'
      && !(weapon.leechRangeWeapon && attacker.leechRangeActive)) {
      if (context.isAttackLineOfSightBlocked(attacker.x, attacker.z, target.x, target.z)) {
        context.setEntityAimingWeaponStatus(attacker, false);
        if (attacker.canMove && !attacker.moving) {
          context.issueMoveTo(attacker.id, target.x, target.z, attackRange * 0.5);
        }
        attacker.preAttackFinishFrame = 0;
        continue;
      }
    }

    if (attacker.moving) {
      attacker.moving = false;
      attacker.moveTarget = null;
      attacker.movePath = [];
      attacker.pathIndex = 0;
      attacker.pathfindGoalCell = null;
    }
    context.setEntityAimingWeaponStatus(attacker, true);

    if (context.frameCounter < attacker.nextAttackFrame) {
      continue;
    }

    if (weapon.clipSize > 0 && attacker.attackAmmoInClip <= 0) {
      if (context.frameCounter < attacker.attackReloadFinishFrame) {
        continue;
      }
      attacker.attackAmmoInClip = weapon.clipSize;
      context.rebuildEntityScatterTargets(attacker);
    }

    if (attacker.preAttackFinishFrame > context.frameCounter) {
      continue;
    }

    if (attacker.preAttackFinishFrame === 0) {
      const preAttackDelay = context.resolveWeaponPreAttackDelayFrames(attacker, target, weapon);
      if (preAttackDelay > 0) {
        attacker.preAttackFinishFrame = context.frameCounter + preAttackDelay;
        // Source parity: Weapon::preFireWeapon (Weapon.cpp:2708) — activate leech range at pre-attack start.
        if (weapon.leechRangeWeapon) {
          attacker.leechRangeActive = true;
        }
        if (attacker.preAttackFinishFrame > context.frameCounter) {
          continue;
        }
      }
    }

    // Source parity: TurretAI — weapon cannot fire until turret is aligned.
    if (!context.isTurretAlignedForFiring(attacker)) {
      continue;
    }

    context.setEntityAimingWeaponStatus(attacker, false);
    context.setEntityFiringWeaponStatus(attacker, true);
    context.queueWeaponDamageEvent(attacker, target, weapon);
    context.setEntityIgnoringStealthStatus(attacker, false);
    attacker.preAttackFinishFrame = 0;
    // Source parity: Weapon.cpp:2511 — activate leech range after first shot fires.
    if (weapon.leechRangeWeapon) {
      attacker.leechRangeActive = true;
    }
    context.recordConsecutiveAttackShot(attacker, target.id);

    // Source parity: Weapon::fire decrements m_maxShotCount; when exhausted, attack ends.
    if (attacker.maxShotsRemaining > 0) {
      attacker.maxShotsRemaining--;
      if (attacker.maxShotsRemaining <= 0) {
        context.clearMaxShotsAttackState(attacker);
        continue;
      }
    }

    if (weapon.autoReloadWhenIdleFrames > 0) {
      attacker.attackForceReloadFrame = context.frameCounter + weapon.autoReloadWhenIdleFrames;
    } else {
      attacker.attackForceReloadFrame = 0;
    }

    if (weapon.clipSize > 0) {
      attacker.attackAmmoInClip = Math.max(0, attacker.attackAmmoInClip - 1);
      if (attacker.attackAmmoInClip <= 0) {
        attacker.attackReloadFinishFrame = context.frameCounter + context.resolveClipReloadFrames(attacker, weapon);
        attacker.nextAttackFrame = attacker.attackReloadFinishFrame;
        continue;
      }
    }

    attacker.nextAttackFrame = context.frameCounter + context.resolveWeaponDelayFrames(attacker, weapon);
  }
}
