// @ts-nocheck — self is typed as any; real safety comes from the test suite.
/**
 * Status effects — poison, fire spread, subdual damage, EMP/hacked disable, fire-when-damaged.
 *
 * Source parity: Object/PoisonedBehavior.cpp, Object/FireSpreadUpdate.cpp
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { MAP_XY_FACTOR } from '@generals/terrain';
import { readNumericField, readStringField } from './ini-readers.js';
import { DEFAULT_POISON_DAMAGE_INTERVAL_FRAMES } from './index.js';
type GL = any;

// ---- Status effects implementations ----

export function extractFireSpreadProfile(self: GL, objectDef: ObjectDef | undefined): FireSpreadProfile | null {
  if (!objectDef) return null;
  let profile: FireSpreadProfile | null = null;
  const visitBlock = (block: IniBlock): void => {
    if (profile !== null) return;
    if (block.type.toUpperCase() === 'BEHAVIOR') {
      const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
      if (moduleType === 'FIRESPREADUPDATE') {
        profile = {
          minSpreadDelayFrames: self.msToLogicFrames(readNumericField(block.fields, ['MinSpreadDelay']) ?? 500),
          maxSpreadDelayFrames: self.msToLogicFrames(readNumericField(block.fields, ['MaxSpreadDelay']) ?? 1500),
          spreadTryRange: (readNumericField(block.fields, ['SpreadTryRange']) ?? 10) * MAP_XY_FACTOR,
        };
      }
    }
    if (block.blocks) {
      for (const child of block.blocks) visitBlock(child);
    }
  };
  if (objectDef.blocks) {
    for (const block of objectDef.blocks) visitBlock(block);
  }
  return profile;
}

export function extractPoisonedBehaviorProfile(self: GL, objectDef: ObjectDef | undefined): PoisonedBehaviorProfile | null {
  if (!objectDef) return null;
  let profile: PoisonedBehaviorProfile | null = null;
  const visitBlock = (block: IniBlock): void => {
    if (profile !== null) return;
    if (block.type.toUpperCase() === 'BEHAVIOR') {
      const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
      if (moduleType === 'POISONEDBEHAVIOR') {
        profile = {
          poisonDamageIntervalFrames: self.msToLogicFrames(readNumericField(block.fields, ['PoisonDamageInterval']) ?? 333),
          poisonDurationFrames: self.msToLogicFrames(readNumericField(block.fields, ['PoisonDuration']) ?? 3000),
        };
      }
    }
    if (block.blocks) {
      for (const child of block.blocks) visitBlock(child);
    }
  };
  if (objectDef.blocks) {
    for (const block of objectDef.blocks) visitBlock(block);
  }
  return profile;
}

export function extractFireWhenDamagedProfiles(self: GL, objectDef: ObjectDef | undefined): FireWhenDamagedProfile[] {
  if (!objectDef) return [];
  const profiles: FireWhenDamagedProfile[] = [];
  const visitBlock = (block: IniBlock): void => {
    const blockType = block.type.toUpperCase();
    if (blockType === 'BEHAVIOR') {
      const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
      if (moduleType === 'FIREWEAPONWHENDAMAGEDBEHAVIOR') {
        profiles.push({
          reactionWeapons: [
            readStringField(block.fields, ['ReactionWeaponPristine']),
            readStringField(block.fields, ['ReactionWeaponDamaged']),
            readStringField(block.fields, ['ReactionWeaponReallyDamaged']),
            readStringField(block.fields, ['ReactionWeaponRubble']),
          ],
          continuousWeapons: [
            readStringField(block.fields, ['ContinuousWeaponPristine']),
            readStringField(block.fields, ['ContinuousWeaponDamaged']),
            readStringField(block.fields, ['ContinuousWeaponReallyDamaged']),
            readStringField(block.fields, ['ContinuousWeaponRubble']),
          ],
          damageAmount: readNumericField(block.fields, ['DamageAmount']) ?? 0,
          reactionNextFireFrame: [0, 0, 0, 0],
          continuousNextFireFrame: [0, 0, 0, 0],
        });
      }
    }
    if (block.blocks) {
      for (const child of block.blocks) visitBlock(child);
    }
  };
  if (objectDef.blocks) {
    for (const block of objectDef.blocks) visitBlock(block);
  }
  return profiles;
}

export function extractFireWeaponUpdateProfiles(self: GL, objectDef: ObjectDef | undefined): FireWeaponUpdateProfile[] {
  if (!objectDef) return [];
  const profiles: FireWeaponUpdateProfile[] = [];
  const visitBlock = (block: IniBlock): void => {
    const blockType = block.type.toUpperCase();
    if (blockType === 'BEHAVIOR') {
      const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
      if (moduleType === 'FIREWEAPONUPDATE') {
        const weaponName = readStringField(block.fields, ['Weapon']);
        if (!weaponName) return;

        profiles.push({
          weaponName,
          initialDelayFrames: self.msToLogicFrames(readNumericField(block.fields, ['InitialDelay']) ?? 0),
          exclusiveWeaponDelayFrames: self.msToLogicFrames(readNumericField(block.fields, ['ExclusiveWeaponDelay']) ?? 0),
        });
      }
    }
    if (block.blocks) {
      for (const child of block.blocks) visitBlock(child);
    }
  };
  if (objectDef.blocks) {
    for (const block of objectDef.blocks) visitBlock(block);
  }
  return profiles;
}

export function setDisabledHackedStatusUntil(self: GL, entity: MapEntity, disableUntilFrame: number): void {
  if (!Number.isFinite(disableUntilFrame)) {
    return;
  }
  const resolvedDisableUntilFrame = Math.max(self.frameCounter + 1, Math.trunc(disableUntilFrame));
  entity.objectStatusFlags.add('DISABLED_HACKED');
  const previousDisableUntil = self.disabledHackedStatusByEntityId.get(entity.id) ?? 0;
  if (resolvedDisableUntilFrame > previousDisableUntil) {
    self.disabledHackedStatusByEntityId.set(entity.id, resolvedDisableUntilFrame);
  }
}

export function updateDisabledHackedStatuses(self: GL): void {
  for (const [entityId, disableUntilFrame] of self.disabledHackedStatusByEntityId.entries()) {
    const entity = self.spawnedEntities.get(entityId);
    if (!entity || entity.destroyed) {
      self.disabledHackedStatusByEntityId.delete(entityId);
      continue;
    }

    if (self.frameCounter < disableUntilFrame) {
      continue;
    }

    entity.objectStatusFlags.delete('DISABLED_HACKED');
    self.disabledHackedStatusByEntityId.delete(entityId);
  }
}

export function updateSubdualDamageHelpers(self: GL): void {
  for (const entity of self.spawnedEntities.values()) {
    if (entity.destroyed || entity.currentSubdualDamage <= 0 || entity.subdualDamageCap <= 0) continue;
    if (entity.subdualDamageHealRate <= 0 || entity.subdualDamageHealAmount <= 0) continue;

    // Source parity: SubdualDamageHelper::update — decrement countdown each frame.
    entity.subdualHealingCountdown--;
    if (entity.subdualHealingCountdown > 0) continue;

    // Reset countdown for next heal tick.
    entity.subdualHealingCountdown = entity.subdualDamageHealRate;

    // Source parity: heal subdual damage by SubdualDamageHealAmount via SUBDUAL_UNRESISTABLE.
    // C++ calls attemptDamage with negative amount, but we can directly adjust since the
    // negative path would just subtract from currentSubdualDamage anyway.
    const wasSubdued = entity.currentSubdualDamage >= entity.maxHealth;
    entity.currentSubdualDamage = Math.max(0, entity.currentSubdualDamage - entity.subdualDamageHealAmount);
    const nowSubdued = entity.currentSubdualDamage >= entity.maxHealth;

    // Source parity: onSubdualChange — clear DISABLED_SUBDUED when un-subdued.
    if (wasSubdued && !nowSubdued) {
      entity.objectStatusFlags.delete('DISABLED_SUBDUED');
    }
  }
}

export function updatePoisonedEntities(self: GL): void {
  for (const entity of self.spawnedEntities.values()) {
    if (entity.destroyed || entity.poisonDamageAmount <= 0) continue;

    // Check if poison has expired
    if (self.frameCounter >= entity.poisonExpireFrame) {
      entity.poisonDamageAmount = 0;
      entity.objectStatusFlags.delete('POISONED');
      continue;
    }

    // Apply poison damage tick
    if (self.frameCounter >= entity.poisonNextDamageFrame) {
      self.applyWeaponDamageAmount(null, entity, entity.poisonDamageAmount, 'UNRESISTABLE');
      const interval = entity.poisonedBehaviorProfile?.poisonDamageIntervalFrames ?? DEFAULT_POISON_DAMAGE_INTERVAL_FRAMES;
      entity.poisonNextDamageFrame = self.frameCounter + interval;
    }
  }
}

export function updateFireSpread(self: GL): void {
  for (const entity of self.spawnedEntities.values()) {
    if (entity.destroyed) continue;
    const prof = entity.fireSpreadProfile;
    if (!prof) continue;

    // Source parity: sleeps forever until entity is AFLAME.
    if (entity.flameStatus !== 'AFLAME') {
      entity.fireSpreadNextFrame = 0;
      continue;
    }

    // Activate spread timer when first set aflame.
    if (entity.fireSpreadNextFrame === 0) {
      entity.fireSpreadNextFrame = self.frameCounter + calcFireSpreadDelay(self, prof);
      continue;
    }

    if (self.frameCounter < entity.fireSpreadNextFrame) continue;

    // Schedule next attempt.
    entity.fireSpreadNextFrame = self.frameCounter + calcFireSpreadDelay(self, prof);

    if (prof.spreadTryRange <= 0) continue;

    // Source parity: find closest flammable target within range.
    const rangeSqr = prof.spreadTryRange * prof.spreadTryRange;
    let closestTarget: MapEntity | null = null;
    let closestDistSqr = Infinity;

    for (const candidate of self.spawnedEntities.values()) {
      if (candidate.destroyed || candidate.id === entity.id) continue;
      if (!candidate.flammableProfile) continue;
      // Source parity: PartitionFilterFlammable::wouldIgnite — only NORMAL status can ignite.
      if (candidate.flameStatus !== 'NORMAL') continue;

      const dx = candidate.x - entity.x;
      // Source parity: FireSpreadUpdate.cpp:147 uses FROM_CENTER_3D for distance.
      const dy = candidate.y - entity.y;
      const dz = candidate.z - entity.z;
      const distSqr = dx * dx + dy * dy + dz * dz;
      if (distSqr < rangeSqr && distSqr < closestDistSqr) {
        closestDistSqr = distSqr;
        closestTarget = candidate;
      }
    }

    // Source parity: tryToIgnite — set target aflame instantly.
    if (closestTarget) {
      self.igniteEntity(closestTarget);
    }
  }
}

export function calcFireSpreadDelay(self: GL, prof: FireSpreadProfile): number {
  if (prof.minSpreadDelayFrames >= prof.maxSpreadDelayFrames) {
    return Math.max(1, prof.minSpreadDelayFrames);
  }
  return Math.max(1, self.gameRandom.nextRange(prof.minSpreadDelayFrames, prof.maxSpreadDelayFrames));
}

export function applyFireDamageToEntity(self: GL, entity: MapEntity, actualDamage: number): void {
  const prof = entity.flammableProfile;
  if (!prof) return;
  if (entity.flameStatus !== 'NORMAL') return; // Can't reignite burned or already aflame

  // Reset accumulation if no fire damage in a while
  if (self.frameCounter - entity.flameLastDamageReceivedFrame > prof.flameDamageExpirationDelayFrames) {
    entity.flameDamageAccumulated = 0;
  }
  entity.flameLastDamageReceivedFrame = self.frameCounter;
  entity.flameDamageAccumulated += actualDamage;

  // Check ignition threshold.
  // C++ parity: do NOT reset flameDamageAccumulated on ignition. The accumulated
  // value stays, so if the entity returns to NORMAL and receives fire damage
  // before the expiration delay, it re-ignites instantly (matching C++ where
  // m_flameDamageLimit stays depleted after tryToIgnite).
  if (entity.flameDamageAccumulated >= prof.flameDamageLimit) {
    self.igniteEntity(entity);
  }
}

export function applyPoisonToEntity(self: GL, entity: MapEntity, actualDamage: number): void {
  if (actualDamage <= 0) return;
  // C++ parity: only entities with the PoisonedBehavior module react to poison.
  if (!entity.poisonedBehaviorProfile) return;
  const prof = entity.poisonedBehaviorProfile;
  entity.poisonDamageAmount = actualDamage;
  entity.poisonExpireFrame = self.frameCounter + prof.poisonDurationFrames;
  // C++ parity: re-poisoning uses min() of existing timer and new interval
  // to prevent "early" damage ticks. (PoisonedBehavior.cpp line 169-173)
  const newDamageFrame = self.frameCounter + prof.poisonDamageIntervalFrames;
  if (entity.poisonNextDamageFrame > self.frameCounter) {
    entity.poisonNextDamageFrame = Math.min(entity.poisonNextDamageFrame, newDamageFrame);
  } else {
    entity.poisonNextDamageFrame = newDamageFrame;
  }
  entity.objectStatusFlags.add('POISONED');
}

export function clearPoisonFromEntity(self: GL, entity: MapEntity): void {
  if (entity.poisonDamageAmount <= 0) return;
  entity.poisonDamageAmount = 0;
  entity.poisonNextDamageFrame = 0;
  entity.poisonExpireFrame = 0;
  entity.objectStatusFlags.delete('POISONED');
}
