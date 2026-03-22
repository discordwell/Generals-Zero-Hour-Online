import { findContinueAttackVictim as findContinueAttackVictimImpl } from './combat-damage-resolution.js';

interface VectorXZLike {
  x: number;
  z: number;
}

interface CombatDamageEntityLike {
  id: number;
  x: number;
  y: number;
  z: number;
  baseHeight: number;
  destroyed: boolean;
  canTakeDamage: boolean;
  templateName: string;
  controllingPlayerToken: string | null;
  attackTargetEntityId: number | null;
  attackOriginalVictimPosition: VectorXZLike | null;
  attackCommandSource: string;
}

interface CombatDamageWeaponLike {
  primaryDamageRadius: number;
  secondaryDamageRadius: number;
  radiusDamageAngle: number;
  radiusDamageAffectsMask: number;
  primaryDamage: number;
  secondaryDamage: number;
  damageType: string;
  deathType: string;
  continueAttackRange: number;
}

interface PendingWeaponDamageEventLike<TWeapon extends CombatDamageWeaponLike> {
  sourceEntityId: number;
  primaryVictimEntityId: number | null;
  impactX: number;
  /** Source parity: 3D impact position Y for DAMAGE_RANGE_CALC_TYPE distance checks. */
  impactY: number;
  impactZ: number;
  executeFrame: number;
  delivery: 'DIRECT' | 'PROJECTILE' | 'LASER';
  weapon: TWeapon;
}

interface CombatDamageMasks {
  affectsSelf: number;
  affectsAllies: number;
  affectsEnemies: number;
  affectsNeutrals: number;
  killsSelf: number;
  doesntAffectSimilar: number;
  doesntAffectAirborne: number;
}

interface CombatDamageRelationships {
  allies: number;
  enemies: number;
}

export interface CombatDamageEventContext<
  TEntity extends CombatDamageEntityLike,
  TWeapon extends CombatDamageWeaponLike,
  TEvent extends PendingWeaponDamageEventLike<TWeapon>,
> {
  frameCounter: number;
  pendingEvents: TEvent[];
  entitiesById: ReadonlyMap<number, TEntity>;
  resolveForwardUnitVector(entity: TEntity): VectorXZLike;
  resolveProjectilePointCollisionRadius(entity: TEntity): number;
  resolveProjectileIncidentalVictimForPointImpact(
    projectileLauncher: TEntity | null,
    weapon: TWeapon,
    intendedVictimId: number | null,
    impactX: number,
    impactZ: number,
  ): TEntity | null;
  getTeamRelationship(attacker: TEntity, target: TEntity): number;
  applyWeaponDamageAmount(
    sourceEntityId: number | null,
    target: TEntity,
    amount: number,
    damageType: string,
    weaponDeathType?: string,
  ): void;
  canEntityAttackFromStatus(entity: TEntity): boolean;
  canAttackerTargetEntity(attacker: TEntity, target: TEntity, commandSource: string): boolean;
  /** Source parity: Thing::isSignificantlyAboveTerrain — checks entity altitude above ground. */
  isEntitySignificantlyAboveTerrain(entity: TEntity): boolean;
  /** Source parity: GeometryInfo::getBoundingSphereRadius — bounding sphere for 3D distance. */
  resolveBoundingSphereRadius(entity: TEntity): number;
  /**
   * Source parity: ThingTemplate::isEquivalentTo() — checks template ancestry
   * (ChildObject/ObjectReskin inheritance, BuildVariations) in addition to direct
   * name equality. Used by DOESNT_AFFECT_SIMILAR to determine if two entities
   * share a common base template.
   */
  areTemplatesEquivalent(leftTemplateName: string, rightTemplateName: string): boolean;
  masks: CombatDamageMasks;
  relationships: CombatDamageRelationships;
  hugeDamageAmount: number;
}

/**
 * Source parity: Weapon.cpp:1425-1427 — the C++ RadiusDamageAngle check uses
 * full 3D vectors for both source orientation and victim direction.
 */
function normalizeVector3(x: number, y: number, z: number): { x: number; y: number; z: number } {
  const length = Math.hypot(x, y, z);
  if (length <= 1e-6) {
    return { x: 0, y: 0, z: 0 };
  }
  return { x: x / length, y: y / length, z: z / length };
}

function tryContinueAttackOnVictimDeath<
  TEntity extends CombatDamageEntityLike,
  TWeapon extends CombatDamageWeaponLike,
  TEvent extends PendingWeaponDamageEventLike<TWeapon>,
>(
  context: CombatDamageEventContext<TEntity, TWeapon, TEvent>,
  attacker: TEntity,
  destroyedVictim: TEntity,
  weapon: TWeapon,
): void {
  const continueRange = Math.max(0, weapon.continueAttackRange);
  if (continueRange <= 0) {
    return;
  }
  if (attacker.destroyed || !context.canEntityAttackFromStatus(attacker)) {
    return;
  }
  if (attacker.attackTargetEntityId !== destroyedVictim.id) {
    return;
  }
  const originalVictimPosition = attacker.attackOriginalVictimPosition;
  if (!originalVictimPosition) {
    return;
  }

  const replacementVictim = findContinueAttackVictimImpl(
    attacker.id,
    destroyedVictim.id,
    destroyedVictim.controllingPlayerToken,
    originalVictimPosition,
    continueRange,
    context.entitiesById.values(),
    (candidate) => context.canAttackerTargetEntity(attacker, candidate, attacker.attackCommandSource),
  );
  if (!replacementVictim) {
    return;
  }

  // Source parity: AIAttackState::notifyNewVictimChosen() does not update
  // m_originalVictimPos. Keep the initial victim position for chained reacquire.
  attacker.attackTargetEntityId = replacementVictim.id;
}

export function applyWeaponDamageEvent<
  TEntity extends CombatDamageEntityLike,
  TWeapon extends CombatDamageWeaponLike,
  TEvent extends PendingWeaponDamageEventLike<TWeapon>,
>(
  context: CombatDamageEventContext<TEntity, TWeapon, TEvent>,
  event: TEvent,
): void {
  const weapon = event.weapon;
  if (event.delivery === 'PROJECTILE') {
    // Source parity: projectile damage reaches this path only after projectile-flight
    // update/collision resolution has finalized the detonation point for the frame.
  }

  const source = context.entitiesById.get(event.sourceEntityId) ?? null;
  const primaryVictim = event.primaryVictimEntityId !== null
    ? (context.entitiesById.get(event.primaryVictimEntityId) ?? null)
    : null;
  const primaryVictimWasAlive = !!primaryVictim && !primaryVictim.destroyed && primaryVictim.canTakeDamage;

  let impactX = event.impactX;
  let impactY = event.impactY;
  let impactZ = event.impactZ;
  if (event.delivery === 'DIRECT' && primaryVictim && !primaryVictim.destroyed) {
    impactX = primaryVictim.x;
    // Source parity: Weapon.cpp:1281-1283 — DIRECT delivery uses getPosition() which
    // returns the base (terrain-level) position, not the center.
    impactY = primaryVictim.y - primaryVictim.baseHeight;
    impactZ = primaryVictim.z;
  }

  const primaryRadius = Math.max(0, weapon.primaryDamageRadius);
  const secondaryRadius = Math.max(0, weapon.secondaryDamageRadius);
  const radiusDamageAngle = Math.max(0, weapon.radiusDamageAngle);
  const radiusDamageAngleCos = Math.cos(radiusDamageAngle);
  const primaryRadiusSqr = primaryRadius * primaryRadius;
  const effectRadius = Math.max(primaryRadius, secondaryRadius);
  const effectRadiusSqr = effectRadius * effectRadius;
  // Source parity: Weapon.cpp:1424 — source orientation is from Get_X_Vector (3D transform forward).
  // Our forward vector is XZ-only; y=0 matches ground units (pitch not yet represented).
  const sourceFacingVector = source
    ? normalizeVector3(
      context.resolveForwardUnitVector(source).x,
      0,
      context.resolveForwardUnitVector(source).z,
    )
    : null;

  const victims: Array<{ entity: TEntity; distanceSqr: number }> = [];
  if (effectRadius > 0) {
    for (const entity of context.entitiesById.values()) {
      if (entity.destroyed || !entity.canTakeDamage) {
        continue;
      }
      const dx = entity.x - impactX;
      // Source parity: PartitionManager::iterateObjectsInRange(FROM_BOUNDINGSPHERE_3D)
      // uses center-to-center 3D distance minus bounding sphere radii. entity.y is the
      // center position (terrain + baseHeight); impactY is the terrain height at impact.
      const dy = entity.y - impactY;
      const dz = entity.z - impactZ;
      const rawDistSqr = dx * dx + dy * dy + dz * dz;
      // Source parity: Geometry.cpp:distCalcProc_BoundaryAndBoundary_3D — subtract the
      // target entity's bounding sphere radius from the 3D distance (impact point has no
      // object so only the candidate radius is subtracted). Clamp to zero for overlap.
      const bsr = context.resolveBoundingSphereRadius(entity);
      let distanceSqr: number;
      if (bsr > 0) {
        const rawDist = Math.sqrt(rawDistSqr);
        const shrunken = rawDist - bsr;
        distanceSqr = shrunken > 0 ? shrunken * shrunken : 0;
      } else {
        distanceSqr = rawDistSqr;
      }
      if (distanceSqr <= effectRadiusSqr) {
        victims.push({ entity, distanceSqr });
      }
    }
    victims.sort((left, right) => left.entity.id - right.entity.id);
  } else if (primaryVictim && !primaryVictim.destroyed && primaryVictim.canTakeDamage) {
    if (event.delivery === 'PROJECTILE') {
      const collisionRadius = context.resolveProjectilePointCollisionRadius(primaryVictim);
      const dx = primaryVictim.x - impactX;
      const dz = primaryVictim.z - impactZ;
      const distanceSqr = dx * dx + dz * dz;
      if (distanceSqr <= collisionRadius * collisionRadius) {
        victims.push({ entity: primaryVictim, distanceSqr: 0 });
      } else {
        const incidentalVictim = context.resolveProjectileIncidentalVictimForPointImpact(
          source,
          weapon,
          primaryVictim.id,
          impactX,
          impactZ,
        );
        if (incidentalVictim) {
          victims.push({ entity: incidentalVictim, distanceSqr: 0 });
        }
      }
    } else {
      victims.push({ entity: primaryVictim, distanceSqr: 0 });
    }
  } else if (event.delivery === 'PROJECTILE') {
    const incidentalVictim = context.resolveProjectileIncidentalVictimForPointImpact(
      source,
      weapon,
      primaryVictim?.id ?? null,
      impactX,
      impactZ,
    );
    if (incidentalVictim) {
      victims.push({ entity: incidentalVictim, distanceSqr: 0 });
    }
  }

  if (
    victims.length === 0
    && source
    && (weapon.radiusDamageAffectsMask & context.masks.killsSelf) !== 0
    && effectRadius <= 0
  ) {
    context.applyWeaponDamageAmount(source.id, source, context.hugeDamageAmount, weapon.damageType, weapon.deathType);
    return;
  }

  for (const victim of victims) {
    const candidate = victim.entity;
    let killSelf = false;

    if (radiusDamageAngle < Math.PI) {
      if (!source || !sourceFacingVector) {
        continue;
      }
      // Source parity: Weapon.cpp:1425-1431 — 3D damage direction and dot product check.
      const damageVector = normalizeVector3(candidate.x - source.x, candidate.y - source.y, candidate.z - source.z);
      if ((sourceFacingVector.x * damageVector.x) + (sourceFacingVector.y * damageVector.y) + (sourceFacingVector.z * damageVector.z) < radiusDamageAngleCos) {
        continue;
      }
    }

    if (source && candidate !== primaryVictim) {
      if (
        (weapon.radiusDamageAffectsMask & context.masks.killsSelf) !== 0
        && candidate.id === source.id
      ) {
        killSelf = true;
      } else {
        if (
          (weapon.radiusDamageAffectsMask & context.masks.affectsSelf) === 0
          && candidate.id === source.id
        ) {
          continue;
        }
        if (
          (weapon.radiusDamageAffectsMask & context.masks.doesntAffectSimilar) !== 0
          && context.getTeamRelationship(source, candidate) === context.relationships.allies
          && context.areTemplatesEquivalent(source.templateName, candidate.templateName)
        ) {
          continue;
        }

        // Source parity: Weapon.cpp:1375 — skip airborne targets for ground-only weapons.
        if (
          (weapon.radiusDamageAffectsMask & context.masks.doesntAffectAirborne) !== 0
          && context.isEntitySignificantlyAboveTerrain(candidate)
        ) {
          continue;
        }

        let requiredMask = context.masks.affectsNeutrals;
        const relationship = context.getTeamRelationship(source, candidate);
        if (relationship === context.relationships.allies) {
          requiredMask = context.masks.affectsAllies;
        } else if (relationship === context.relationships.enemies) {
          requiredMask = context.masks.affectsEnemies;
        }
        if ((weapon.radiusDamageAffectsMask & requiredMask) === 0) {
          continue;
        }
      }
    }

    const rawAmount = killSelf
      ? context.hugeDamageAmount
      : (victim.distanceSqr <= primaryRadiusSqr ? weapon.primaryDamage : weapon.secondaryDamage);
    context.applyWeaponDamageAmount(source?.id ?? null, candidate, rawAmount, weapon.damageType, weapon.deathType);
  }

  if (source && primaryVictimWasAlive && primaryVictim && primaryVictim.destroyed) {
    tryContinueAttackOnVictimDeath(context, source, primaryVictim, weapon);
  }

  // Source parity: FROM_BOUNDINGSPHERE_3D bounding-sphere subtraction implemented above.
  // Remaining approximation: box geometry uses bounding circle radius, not exact OBB test.
}

export function updatePendingWeaponDamage<
  TEntity extends CombatDamageEntityLike,
  TWeapon extends CombatDamageWeaponLike,
  TEvent extends PendingWeaponDamageEventLike<TWeapon>,
>(
  context: CombatDamageEventContext<TEntity, TWeapon, TEvent>,
): void {
  if (context.pendingEvents.length === 0) {
    return;
  }

  const remainingEvents: TEvent[] = [];
  for (const event of context.pendingEvents) {
    if (event.executeFrame > context.frameCounter) {
      remainingEvents.push(event);
      continue;
    }
    applyWeaponDamageEvent(context, event);
  }

  context.pendingEvents.length = 0;
  context.pendingEvents.push(...remainingEvents);
}
