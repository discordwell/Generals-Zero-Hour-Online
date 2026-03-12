// @ts-nocheck — self is typed as any; real safety comes from the test suite.
/**
 * Stealth and detection — stealth updates, grant stealth, detector scanning.
 *
 * Source parity: Object/StealthUpdate.cpp, Object/DetectorUpdate.cpp
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { readBooleanField, readNumericField, readStringField } from './ini-readers.js';
import {
  CONSTRUCTION_COMPLETE,
  RELATIONSHIP_ENEMIES,
  RELATIONSHIP_NEUTRAL,
  STEALTH_FORBIDDEN_ATTACKING,
  STEALTH_FORBIDDEN_DEFAULT,
  STEALTH_FORBIDDEN_FIRING_PRIMARY,
  STEALTH_FORBIDDEN_FIRING_SECONDARY,
  STEALTH_FORBIDDEN_FIRING_TERTIARY,
  STEALTH_FORBIDDEN_MOVING,
  STEALTH_FORBIDDEN_NO_BLACK_MARKET,
  STEALTH_FORBIDDEN_RIDERS_ATTACKING,
  STEALTH_FORBIDDEN_TAKING_DAMAGE,
  STEALTH_FORBIDDEN_USING_ABILITY,
} from './index.js';
type GL = any;

// ---- Stealth and detection implementations ----

export function extractStealthProfile(self: GL, objectDef: ObjectDef | undefined): StealthProfile | null {
  if (!objectDef) return null;
  let profile: StealthProfile | null = null;
  const visitBlock = (block: IniBlock): void => {
    if (profile !== null) return;
    if (block.type.toUpperCase() === 'BEHAVIOR') {
      const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
      if (moduleType === 'STEALTHUPDATE') {
        const innateStealth = readBooleanField(block.fields, ['InnateStealth']) ?? true;
        const stealthDelayMs = readNumericField(block.fields, ['StealthDelay']) ?? 2000;
        const stealthDelayFrames = self.msToLogicFrames(stealthDelayMs);
        const moveThresholdSpeed = readNumericField(block.fields, ['MoveThresholdSpeed']) ?? 0;

        // Parse StealthForbiddenConditions — space-separated tokens.
        let forbiddenConditions = 0;
        const forbiddenStr = readStringField(block.fields, ['StealthForbiddenConditions']) ?? '';
        for (const token of forbiddenStr.split(/\s+/)) {
          switch (token.toUpperCase()) {
            case 'ATTACKING':
            case 'STEALTH_NOT_WHILE_ATTACKING':
              forbiddenConditions |= STEALTH_FORBIDDEN_ATTACKING;
              break;
            case 'MOVING':
            case 'STEALTH_NOT_WHILE_MOVING':
              forbiddenConditions |= STEALTH_FORBIDDEN_MOVING;
              break;
            case 'USING_ABILITY':
            case 'STEALTH_NOT_WHILE_USING_ABILITY':
              forbiddenConditions |= STEALTH_FORBIDDEN_USING_ABILITY;
              break;
            case 'FIRING_PRIMARY':
            case 'STEALTH_NOT_WHILE_FIRING_PRIMARY':
              forbiddenConditions |= STEALTH_FORBIDDEN_FIRING_PRIMARY;
              break;
            case 'FIRING_SECONDARY':
              forbiddenConditions |= STEALTH_FORBIDDEN_FIRING_SECONDARY;
              break;
            case 'FIRING_TERTIARY':
              forbiddenConditions |= STEALTH_FORBIDDEN_FIRING_TERTIARY;
              break;
            case 'FIRING_WEAPON':
            case 'STEALTH_NOT_WHILE_FIRING_WEAPON':
              // Composite: all weapon slots.
              forbiddenConditions |= STEALTH_FORBIDDEN_FIRING_PRIMARY
                | STEALTH_FORBIDDEN_FIRING_SECONDARY | STEALTH_FORBIDDEN_FIRING_TERTIARY;
              break;
            case 'NO_BLACK_MARKET':
              forbiddenConditions |= STEALTH_FORBIDDEN_NO_BLACK_MARKET;
              break;
            case 'TAKING_DAMAGE':
            case 'STEALTH_NOT_WHILE_TAKING_DAMAGE':
              forbiddenConditions |= STEALTH_FORBIDDEN_TAKING_DAMAGE;
              break;
            case 'RIDERS_ATTACKING':
              forbiddenConditions |= STEALTH_FORBIDDEN_RIDERS_ATTACKING;
              break;
          }
        }

        // If no explicit conditions, use default (attacking + moving).
        if (forbiddenConditions === 0 && forbiddenStr.trim() === '') {
          forbiddenConditions = STEALTH_FORBIDDEN_DEFAULT;
        }

        profile = {
          stealthDelayFrames,
          innateStealth,
          forbiddenConditions,
          moveThresholdSpeed,
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

export function extractDetectorProfile(self: GL, objectDef: ObjectDef | undefined): DetectorProfile | null {
  if (!objectDef) return null;
  let profile: DetectorProfile | null = null;
  const visitBlock = (block: IniBlock): void => {
    if (profile !== null) return;
    if (block.type.toUpperCase() === 'BEHAVIOR') {
      const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
      if (moduleType === 'STEALTHDETECTORUPDATE') {
        const detectionRange = readNumericField(block.fields, ['DetectionRange']) ?? 0;
        const detectionRateMs = readNumericField(block.fields, ['DetectionRate']) ?? 33;
        const detectionRate = Math.max(1, self.msToLogicFrames(detectionRateMs));
        const canDetectWhileGarrisoned = readBooleanField(block.fields, ['CanDetectWhileGarrisoned']) ?? false;
        const canDetectWhileContained = readBooleanField(block.fields, ['CanDetectWhileContained']) ?? false;

        const extraRequiredKindOf = new Set<string>();
        const requiredStr = readStringField(block.fields, ['ExtraRequiredKindOf']) ?? '';
        for (const token of requiredStr.split(/\s+/)) {
          if (token) extraRequiredKindOf.add(token.toUpperCase());
        }

        const extraForbiddenKindOf = new Set<string>();
        const forbiddenStr = readStringField(block.fields, ['ExtraForbiddenKindOf']) ?? '';
        for (const token of forbiddenStr.split(/\s+/)) {
          if (token) extraForbiddenKindOf.add(token.toUpperCase());
        }

        profile = {
          detectionRange,
          detectionRate,
          canDetectWhileGarrisoned,
          canDetectWhileContained,
          extraRequiredKindOf,
          extraForbiddenKindOf,
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

export function extractGrantStealthProfile(self: GL, objectDef: ObjectDef | undefined): GrantStealthProfile | null {
  if (!objectDef) return null;
  let profile: GrantStealthProfile | null = null;
  const visitBlock = (block: IniBlock): void => {
    if (profile) return;
    const blockType = block.type.toUpperCase();
    if (blockType !== 'BEHAVIOR' && blockType !== 'UPDATE') return;
    const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
    if (moduleType !== 'GRANTSTEALTHBEHAVIOR') return;
    const kindOfStr = readStringField(block.fields, ['KindOf']);
    profile = {
      startRadius: readNumericField(block.fields, ['StartRadius']) ?? 0,
      finalRadius: readNumericField(block.fields, ['FinalRadius']) ?? 200,
      radiusGrowRate: readNumericField(block.fields, ['RadiusGrowRate']) ?? 10,
      kindOf: kindOfStr ? new Set(kindOfStr.split(/\s+/).map(s => s.toUpperCase())) : null,
    };
  };
  for (const block of objectDef.blocks) visitBlock(block);
  if (!profile && self.resolveObjectDefParent(objectDef)) {
    for (const block of self.resolveObjectDefParent(objectDef)?.blocks ?? []) visitBlock(block);
  }
  return profile;
}

export function applyStealthUpgrade(self: GL, entity: MapEntity): boolean {
  entity.objectStatusFlags.add('CAN_STEALTH');
  return true;
}

export function removeStealthUpgradeFromEntity(self: GL, entity: MapEntity): void {
  // Keep CAN_STEALTH active if any other STEALTHUPGRADE module remains executed.
  entity.objectStatusFlags.delete('CAN_STEALTH');
  for (const module of entity.upgradeModules) {
    if (!entity.executedUpgradeModules.has(module.id)) {
      continue;
    }
    if (module.moduleType === 'STEALTHUPGRADE') {
      entity.objectStatusFlags.add('CAN_STEALTH');
      break;
    }
  }
}

export function isEntityStealthedAndUndetected(self: GL, entity: MapEntity): boolean {
  return (
    self.entityHasObjectStatus(entity, 'STEALTHED')
    && !self.entityHasObjectStatus(entity, 'DETECTED')
    && !self.entityHasObjectStatus(entity, 'DISGUISED')
  );
}

export function updateStealth(self: GL): void {
  const DEFAULT_STEALTH_DELAY_FRAMES = 60; // ~2s at 30fps

  for (const entity of self.spawnedEntities.values()) {
    if (entity.destroyed) continue;

    // Clear expired detection.
    if (entity.detectedUntilFrame > 0 && self.frameCounter >= entity.detectedUntilFrame) {
      entity.objectStatusFlags.delete('DETECTED');
      entity.detectedUntilFrame = 0;
    }

    if (!entity.objectStatusFlags.has('CAN_STEALTH')) continue;

    const profile = entity.stealthProfile;
    const delayFrames = profile ? profile.stealthDelayFrames : DEFAULT_STEALTH_DELAY_FRAMES;
    const forbidden = profile ? profile.forbiddenConditions : STEALTH_FORBIDDEN_DEFAULT;

    // Source parity: StealthUpdate::allowedToStealth — contained in non-garrisonable = no stealth.
    const stealthContainer = self.resolveEntityContainingObject(entity);
    if (stealthContainer) {
      const isGarrisonable = stealthContainer.containProfile !== null
        && stealthContainer.containProfile.garrisonCapacity > 0;
      if (!isGarrisonable) {
        if (entity.objectStatusFlags.has('STEALTHED')) {
          entity.objectStatusFlags.delete('STEALTHED');
        }
        entity.stealthDelayRemaining = delayFrames;
        continue;
      }
    }

    // Source parity: StealthUpdate::allowedToStealth — check forbidden conditions.
    let breakStealth = false;

    if ((forbidden & STEALTH_FORBIDDEN_ATTACKING) !== 0) {
      if (entity.attackTargetEntityId !== null) {
        breakStealth = true;
      }
    }

    if ((forbidden & STEALTH_FORBIDDEN_FIRING_PRIMARY) !== 0) {
      if (entity.objectStatusFlags.has('IS_FIRING_WEAPON')) {
        breakStealth = true;
      }
    }

    if ((forbidden & STEALTH_FORBIDDEN_MOVING) !== 0) {
      if (profile && profile.moveThresholdSpeed > 0) {
        // Source parity: break stealth only if speed exceeds threshold.
        if (entity.moving && entity.currentSpeed > profile.moveThresholdSpeed) {
          breakStealth = true;
        }
      } else if (entity.moving) {
        breakStealth = true;
      }
    }

    if ((forbidden & STEALTH_FORBIDDEN_TAKING_DAMAGE) !== 0) {
      // Source parity: getLastDamageTimestamp >= now - 1 — stealth breaks if damaged this frame or last.
      // Healing damage does not break stealth (C++ checks m_damageType != DAMAGE_HEALING).
      if (entity.lastDamageFrame > 0 && (self.frameCounter - entity.lastDamageFrame) <= 1) {
        breakStealth = true;
      }
    }

    if ((forbidden & STEALTH_FORBIDDEN_USING_ABILITY) !== 0) {
      if (entity.objectStatusFlags.has('IS_USING_ABILITY')) {
        breakStealth = true;
      }
    }
    if (entity.objectStatusFlags.has('SCRIPT_UNSTEALTHED')) {
      breakStealth = true;
    }

    if (breakStealth) {
      if (entity.objectStatusFlags.has('STEALTHED')) {
        entity.objectStatusFlags.delete('STEALTHED');
      }
      entity.stealthDelayRemaining = delayFrames;
      continue;
    }

    // Count down stealth delay.
    if (entity.stealthDelayRemaining > 0) {
      entity.stealthDelayRemaining--;
      continue;
    }

    // Enter stealth.
    if (!entity.objectStatusFlags.has('STEALTHED')) {
      entity.objectStatusFlags.add('STEALTHED');
    }
  }
}

export function updateGrantStealth(self: GL): void {
  for (const entity of self.spawnedEntities.values()) {
    if (entity.destroyed || entity.slowDeathState || entity.structureCollapseState) continue;
    const profile = entity.grantStealthProfile;
    if (!profile) continue;

    // Source parity: grow radius each frame.
    entity.grantStealthCurrentRadius += profile.radiusGrowRate;

    let isFinalScan = false;
    if (entity.grantStealthCurrentRadius >= profile.finalRadius) {
      entity.grantStealthCurrentRadius = profile.finalRadius;
      isFinalScan = true;
    }

    const radiusSqr = entity.grantStealthCurrentRadius * entity.grantStealthCurrentRadius;

    // Source parity: scan allies in range.
    for (const target of self.spawnedEntities.values()) {
      if (target.destroyed || target.id === entity.id) continue;
      if (target.slowDeathState || target.structureCollapseState) continue;

      // Source parity: PartitionFilterRelationship(ALLOW_ALLIES).
      const rel = self.getEntityRelationship(entity.id, target.id);
      if (rel !== 'allies') continue;

      // Source parity: FROM_CENTER_2D distance check.
      const dx = target.x - entity.x;
      const dz = target.z - entity.z;
      if (dx * dx + dz * dz > radiusSqr) continue;

      grantStealthToEntity(self, target, profile);
    }

    // Source parity: self-destruct when final radius reached.
    if (isFinalScan) {
      self.silentDestroyEntity(entity.id);
    }
  }
}

export function grantStealthToEntity(self: GL, target: MapEntity, profile: GrantStealthProfile): void {
  // Source parity: C++ checks obj->getStealth() != null — only entities with StealthUpdate can receive stealth.
  if (!target.stealthProfile) return;

  // Source parity: KindOf filter — null means all types accepted.
  if (profile.kindOf) {
    const targetKindOf = self.resolveEntityKindOfSet(target);
    let matches = false;
    for (const kind of profile.kindOf) {
      if (targetKindOf.has(kind)) {
        matches = true;
        break;
      }
    }
    if (!matches) return;
  }

  // Source parity: StealthUpdate::receiveGrant(TRUE, 0) — permanent stealth grant.
  // Sets CAN_STEALTH + STEALTHED flags, clears stealth delay.
  target.objectStatusFlags.add('CAN_STEALTH');
  target.objectStatusFlags.add('STEALTHED');
  target.stealthDelayRemaining = 0;
}

export function updateDetection(self: GL): void {
  const DEFAULT_DETECTION_DURATION_FRAMES = 30; // ~1s at 30fps

  for (const detector of self.spawnedEntities.values()) {
    if (detector.destroyed) continue;

    // Source parity: detector needs either KINDOF_DETECTOR or a StealthDetectorUpdate module.
    const profile = detector.detectorProfile;
    if (!detector.kindOf.has('DETECTOR') && !profile) continue;

    // Source parity: detector must be fully constructed and not sold.
    if (detector.constructionPercent !== CONSTRUCTION_COMPLETE) continue;
    if (detector.objectStatusFlags.has('SOLD')) continue;

    // Source parity: DetectionRate throttle — skip scan if not yet due.
    if (profile) {
      if (self.frameCounter < detector.detectorNextScanFrame) continue;
      detector.detectorNextScanFrame = self.frameCounter + profile.detectionRate;
    }

    // Source parity: contained/garrisoned detector checks.
    // C++ uses isGarrisonable() — garrison buildings allow fire; transports enclose passengers.
    if (profile) {
      const containingObject = self.resolveEntityContainingObject(detector);
      if (containingObject) {
        const isGarrison = containingObject.containProfile !== null
          && containingObject.containProfile.garrisonCapacity > 0;
        if (isGarrison && !profile.canDetectWhileGarrisoned) continue;
        if (!isGarrison && !profile.canDetectWhileContained) continue;
      }
    }

    // Detection range: profile override > visionRange > fallback 150.
    const detectionRange = (profile && profile.detectionRange > 0)
      ? profile.detectionRange
      : (detector.visionRange > 0 ? detector.visionRange : 150);
    const detRangeSq = detectionRange * detectionRange;

    // Detection duration matches the scan interval (+ 1 frame) to prevent flicker.
    const detectionDuration = profile
      ? profile.detectionRate + 1
      : DEFAULT_DETECTION_DURATION_FRAMES;

    for (const target of self.spawnedEntities.values()) {
      if (target.destroyed || target === detector) continue;
      if (!target.objectStatusFlags.has('STEALTHED')) continue;

      // Source parity: detect enemies and neutrals (PartitionFilterRelationship::ALLOW_ENEMIES | ALLOW_NEUTRAL).
      const detRel = self.getTeamRelationship(detector, target);
      if (detRel !== RELATIONSHIP_ENEMIES && detRel !== RELATIONSHIP_NEUTRAL) continue;

      // Source parity: ExtraRequiredKindOf / ExtraForbiddenKindOf filters.
      if (profile && profile.extraRequiredKindOf.size > 0) {
        let hasRequired = false;
        for (const kind of profile.extraRequiredKindOf) {
          if (target.kindOf.has(kind)) { hasRequired = true; break; }
        }
        if (!hasRequired) continue;
      }
      if (profile && profile.extraForbiddenKindOf.size > 0) {
        let hasForbidden = false;
        for (const kind of profile.extraForbiddenKindOf) {
          if (target.kindOf.has(kind)) { hasForbidden = true; break; }
        }
        if (hasForbidden) continue;
      }

      const dx = target.x - detector.x;
      const dz = target.z - detector.z;
      if (dx * dx + dz * dz <= detRangeSq) {
        target.objectStatusFlags.add('DETECTED');
        target.detectedUntilFrame = self.frameCounter + detectionDuration;
      }
    }
  }
}
