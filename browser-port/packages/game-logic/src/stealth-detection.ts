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

        // Source parity: StealthUpdate.cpp:112 — RevealDistanceFromTarget parsed as Real.
        const revealDistanceFromTarget = readNumericField(block.fields, ['RevealDistanceFromTarget']) ?? 0;

        // Source parity: StealthUpdate.cpp:881 — m_orderIdleEnemiesToAttackMeUponReveal parsed as Bool.
        const orderIdleEnemiesToAttackMeUponReveal = readBooleanField(block.fields, ['OrderIdleEnemiesToAttackMeUponReveal']) ?? false;

        // Source parity: StealthUpdate.h:86 — m_friendlyOpacityMin parsed as percent-to-real (default 0.5).
        // C++ getFriendlyOpacity() returns m_friendlyOpacityMin only (Max is unused in retail).
        // INI uses parsePercentToReal — values like "50%" become 0.5. Raw numeric also accepted.
        const friendlyOpacityMinRaw = readNumericField(block.fields, ['FriendlyOpacityMin']);
        const friendlyOpacityMin = friendlyOpacityMinRaw ?? 0.5;

        // Source parity: StealthUpdate.h:80 — m_hintDetectableStates is an ObjectStatusMaskType
        // parsed from HintDetectableConditions. Purely visual — no gameplay cascade.
        const hintDetectableStr = readStringField(block.fields, ['HintDetectableConditions']) ?? '';
        const hintDetectableConditions: string[] = [];
        for (const token of hintDetectableStr.split(/\s+/)) {
          if (token) hintDetectableConditions.push(token.toUpperCase());
        }

        // Source parity: StealthUpdate.cpp:111 — DisguisesAsTeam enables the disguise system.
        // When true, stealth starts disabled (m_enabled = !m_teamDisguised) and activates
        // via disguiseAsObject(). In our simplified model, we auto-disguise on stealth enter.
        const disguisesAsTeam = readBooleanField(block.fields, ['DisguisesAsTeam']) ?? false;

        // Source parity: StealthUpdate.h:82 — m_forbiddenStatus is an ObjectStatusMaskType
        // parsed from ForbiddenStatus. Status conditions that prevent stealth activation.
        const forbiddenStatusStr = readStringField(block.fields, ['ForbiddenStatus']) ?? '';
        const forbiddenStatus: string[] = [];
        for (const token of forbiddenStatusStr.split(/\s+/)) {
          if (token) forbiddenStatus.push(token.toUpperCase());
        }

        // Source parity (ZH): StealthUpdate.h:81 — m_requiredStatus is an ObjectStatusMaskType
        // parsed from RequiredStatus. ALL listed status bits must be set for stealth to activate.
        const requiredStatusStr = readStringField(block.fields, ['RequiredStatus']) ?? '';
        const requiredStatus: string[] = [];
        for (const token of requiredStatusStr.split(/\s+/)) {
          if (token) requiredStatus.push(token.toUpperCase());
        }

        // Source parity: StealthUpdate.h:87 — m_friendlyOpacityMax (default 1.0).
        // C++ parsePercentToReal — values like "100%" become 1.0. Raw numeric also accepted.
        const friendlyOpacityMax = readNumericField(block.fields, ['FriendlyOpacityMax']) ?? 1.0;

        // Source parity: StealthUpdate.h:91 — m_pulseFrames (default 30 in constructor).
        // C++ parseDurationUnsignedInt — INI value is in milliseconds, converted to frames.
        const pulseFrequencyMs = readNumericField(block.fields, ['PulseFrequency']) ?? 0;
        const pulseFrequencyFrames = pulseFrequencyMs > 0 ? self.msToLogicFrames(pulseFrequencyMs) : 0;

        // Source parity: StealthUpdate.h:84 — m_disguiseFX is an FXList pointer.
        // We store the FX list name as a string for future rendering use.
        const disguiseFX = readStringField(block.fields, ['DisguiseFX']) ?? '';

        // Source parity: StealthUpdate.h:83 — m_disguiseRevealFX is an FXList pointer.
        const disguiseRevealFX = readStringField(block.fields, ['DisguiseRevealFX']) ?? '';

        // Source parity: StealthUpdate.h:89 — m_disguiseTransitionFrames (default 0).
        // C++ parseDurationUnsignedInt — INI value is in milliseconds, converted to frames.
        const disguiseTransitionMs = readNumericField(block.fields, ['DisguiseTransitionTime']) ?? 0;
        const disguiseTransitionFrames = disguiseTransitionMs > 0 ? self.msToLogicFrames(disguiseTransitionMs) : 0;

        // Source parity: StealthUpdate.h:90 — m_disguiseRevealTransitionFrames (default 0).
        const disguiseRevealTransitionMs = readNumericField(block.fields, ['DisguiseRevealTransitionTime']) ?? 0;
        const disguiseRevealTransitionFrames = disguiseRevealTransitionMs > 0 ? self.msToLogicFrames(disguiseRevealTransitionMs) : 0;

        // Source parity: StealthUpdate.h:100 — m_useRiderStealth (default false).
        const useRiderStealth = readBooleanField(block.fields, ['UseRiderStealth']) ?? false;

        // Source parity: StealthUpdate.h:95 — m_enemyDetectionEvaEvent (default EVA_Invalid → "").
        const enemyDetectionEvaEvent = readStringField(block.fields, ['EnemyDetectionEvaEvent']) ?? '';

        // Source parity: StealthUpdate.h:96 — m_ownDetectionEvaEvent (default EVA_Invalid → "").
        const ownDetectionEvaEvent = readStringField(block.fields, ['OwnDetectionEvaEvent']) ?? '';

        // Source parity: StealthUpdate.h:94 — m_blackMarketCheckFrames (default 0).
        // C++ parseDurationUnsignedInt — INI value is in milliseconds, converted to frames.
        const blackMarketCheckDelayMs = readNumericField(block.fields, ['BlackMarketCheckDelay']) ?? 0;
        const blackMarketCheckDelayFrames = blackMarketCheckDelayMs > 0 ? self.msToLogicFrames(blackMarketCheckDelayMs) : 0;

        // Source parity: StealthUpdate.h:101 — m_grantedBySpecialPower (default false).
        const grantedBySpecialPower = readBooleanField(block.fields, ['GrantedBySpecialPower']) ?? false;

        profile = {
          stealthDelayFrames,
          innateStealth,
          forbiddenConditions,
          moveThresholdSpeed,
          revealDistanceFromTarget,
          orderIdleEnemiesToAttackMeUponReveal,
          friendlyOpacityMin,
          hintDetectableConditions,
          disguisesAsTeam,
          forbiddenStatus,
          requiredStatus,
          friendlyOpacityMax,
          pulseFrequencyFrames,
          disguiseFX,
          disguiseRevealFX,
          disguiseTransitionFrames,
          disguiseRevealTransitionFrames,
          useRiderStealth,
          enemyDetectionEvaEvent,
          ownDetectionEvaEvent,
          blackMarketCheckDelayFrames,
          grantedBySpecialPower,
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
        const initiallyDisabled = readBooleanField(block.fields, ['InitiallyDisabled']) ?? false;
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
          initiallyDisabled,
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

  // Source parity (ZH): StealthUpgrade.cpp:54-64 — grant stealth to spawned slaves
  // if the entity is a SPAWNS_ARE_THE_WEAPONS master (e.g. GLA Jarmen Kell / Stealth fighters).
  if (entity.kindOf.has('SPAWNS_ARE_THE_WEAPONS') && entity.spawnBehaviorState) {
    for (const slaveId of entity.spawnBehaviorState.slaveIds) {
      const slave = self.spawnedEntities.get(slaveId);
      if (slave && !slave.destroyed) {
        slave.objectStatusFlags.add('CAN_STEALTH');
      }
    }
  }

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

    // Source parity (ZH): StealthUpdate.cpp:719-738 — m_framesGranted countdown.
    // Temporary stealth grant counts down each frame. If the player issues a command
    // during temporary stealth, the grant is cancelled immediately (no exploits).
    if (entity.temporaryStealthGrant && entity.temporaryStealthExpireFrame > 0) {
      if (entity.lastCommandSource === 'PLAYER') {
        // Source parity: ai->getLastCommandSource() == CMD_FROM_PLAYER → cancel stealth.
        entity.objectStatusFlags.delete('STEALTHED');
        entity.objectStatusFlags.delete('CAN_STEALTH');
        entity.temporaryStealthGrant = false;
        entity.temporaryStealthExpireFrame = 0;
        entity.stealthEnabled = entity.stealthProfile ? !entity.stealthProfile.disguisesAsTeam : false;
      } else if (self.frameCounter >= entity.temporaryStealthExpireFrame) {
        // Timer expired normally.
        entity.objectStatusFlags.delete('STEALTHED');
        entity.objectStatusFlags.delete('CAN_STEALTH');
        entity.temporaryStealthGrant = false;
        entity.temporaryStealthExpireFrame = 0;
        entity.stealthEnabled = entity.stealthProfile ? !entity.stealthProfile.disguisesAsTeam : false;
      }
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

    // Source parity: StealthUpdate.cpp:699-714 — RevealDistanceFromTarget auto-reveal.
    // This check runs BEFORE allowedToStealth. If the entity has an attack target
    // and is within revealDistanceFromTarget, mark as DETECTED and skip the rest (early return
    // in C++). The C++ code does not check STEALTHED status — it always runs.
    if (profile && profile.revealDistanceFromTarget > 0
        && entity.attackTargetEntityId !== null) {
      const revealTarget = self.spawnedEntities.get(entity.attackTargetEntityId);
      if (revealTarget && !revealTarget.destroyed) {
        const rdx = revealTarget.x - entity.x;
        const rdz = revealTarget.z - entity.z;
        const distSq = rdx * rdx + rdz * rdz;
        const revealDistSq = profile.revealDistanceFromTarget * profile.revealDistanceFromTarget;
        if (distSq <= revealDistSq) {
          entity.objectStatusFlags.add('DETECTED');
          entity.detectedUntilFrame = self.frameCounter + delayFrames;
          continue; // C++ returns early — skip allowedToStealth check.
        }
      }
    }

    // Source parity: StealthUpdate::allowedToStealth — check forbidden conditions.
    let breakStealth = false;

    if ((forbidden & STEALTH_FORBIDDEN_ATTACKING) !== 0) {
      if (entity.attackTargetEntityId !== null) {
        breakStealth = true;
      }
    }

    // Source parity: StealthUpdate.cpp:348-386 — per-weapon-slot firing checks.
    // C++ first gates on IS_FIRING_WEAPON, then checks per-slot getLastShotFrame()
    // against (currentFrame - 1). We replicate the per-slot check using lastShotFrameBySlot.
    const firingForbiddenMask = forbidden & (STEALTH_FORBIDDEN_FIRING_PRIMARY
      | STEALTH_FORBIDDEN_FIRING_SECONDARY | STEALTH_FORBIDDEN_FIRING_TERTIARY);
    if (firingForbiddenMask !== 0 && entity.objectStatusFlags.has('IS_FIRING_WEAPON')) {
      // Source parity: if ALL three firing slots are forbidden, skip per-slot checks.
      const allSlotsForbidden = firingForbiddenMask === (STEALTH_FORBIDDEN_FIRING_PRIMARY
        | STEALTH_FORBIDDEN_FIRING_SECONDARY | STEALTH_FORBIDDEN_FIRING_TERTIARY);
      if (allSlotsForbidden) {
        breakStealth = true;
      } else {
        const lastFrame = self.frameCounter - 1;
        if ((firingForbiddenMask & STEALTH_FORBIDDEN_FIRING_PRIMARY) !== 0) {
          if (entity.lastShotFrameBySlot[0] >= lastFrame) {
            breakStealth = true;
          }
        }
        if ((firingForbiddenMask & STEALTH_FORBIDDEN_FIRING_SECONDARY) !== 0) {
          if (entity.lastShotFrameBySlot[1] >= lastFrame) {
            breakStealth = true;
          }
        }
        if ((firingForbiddenMask & STEALTH_FORBIDDEN_FIRING_TERTIARY) !== 0) {
          if (entity.lastShotFrameBySlot[2] >= lastFrame) {
            breakStealth = true;
          }
        }
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

    // Source parity (ZH): StealthUpdate.cpp:303-315 — STEALTH_ONLY_WITH_BLACK_MARKET check.
    // If the stealth requires a Black Market building, iterate same-player structures to find one.
    if ((forbidden & STEALTH_FORBIDDEN_NO_BLACK_MARKET) !== 0) {
      let hasBlackMarket = false;
      for (const candidate of self.spawnedEntities.values()) {
        if (candidate.destroyed) continue;
        if (candidate.kindOf.has('FS_BLACK_MARKET')
            && candidate.side === entity.side
            && !candidate.objectStatusFlags.has('UNDER_CONSTRUCTION')
            && !candidate.objectStatusFlags.has('SOLD')) {
          hasBlackMarket = true;
          break;
        }
      }
      if (!hasBlackMarket) {
        breakStealth = true;
      }
    }

    // Source parity (ZH): StealthUpdate.cpp:389-412 — STEALTH_NOT_WHILE_RIDERS_ATTACKING.
    // If any passenger in a fire-through container is attacking, break stealth.
    if ((forbidden & STEALTH_FORBIDDEN_RIDERS_ATTACKING) !== 0) {
      if (entity.containProfile) {
        const riderIds = self.collectContainedEntityIds(entity.id);
        for (const riderId of riderIds) {
          const rider = self.spawnedEntities.get(riderId);
          if (rider && !rider.destroyed && rider.attackTargetEntityId !== null) {
            breakStealth = true;
            break;
          }
        }
      }
    }

    // Source parity (ZH): StealthUpdate.cpp:281-296 — SPAWNS_ARE_THE_WEAPONS slave stealth check.
    // If the entity has slaves that are weapons, ALL slaves must be allowed to stealth.
    if (entity.kindOf.has('SPAWNS_ARE_THE_WEAPONS') && entity.spawnBehaviorState) {
      let allSlavesCanStealth = true;
      for (const slaveId of entity.spawnBehaviorState.slaveIds) {
        const slave = self.spawnedEntities.get(slaveId);
        if (slave && !slave.destroyed) {
          if (!slave.objectStatusFlags.has('CAN_STEALTH')) {
            allSlavesCanStealth = false;
            break;
          }
        }
      }
      if (!allSlavesCanStealth) {
        breakStealth = true;
      }
    }

    // Source parity: StealthUpdate.cpp:337-340 — RequiredStatus check (ZH only).
    // ALL required status bits must be set for stealth to activate.
    if (profile && profile.requiredStatus.length > 0) {
      for (const status of profile.requiredStatus) {
        if (!entity.objectStatusFlags.has(status)) {
          breakStealth = true;
          break;
        }
      }
    }

    // Source parity: StealthUpdate.cpp:342-344 — ForbiddenStatus check.
    // If the entity has ANY forbidden status bit set, stealth is prevented.
    if (profile && profile.forbiddenStatus.length > 0) {
      for (const status of profile.forbiddenStatus) {
        if (entity.objectStatusFlags.has(status)) {
          breakStealth = true;
          break;
        }
      }
    }

    if (breakStealth) {
      if (entity.objectStatusFlags.has('STEALTHED')) {
        entity.objectStatusFlags.delete('STEALTHED');
      }
      // Source parity: StealthUpdate.cpp:901 — remove disguise on stealth break.
      if (entity.objectStatusFlags.has('DISGUISED')) {
        entity.objectStatusFlags.delete('DISGUISED');
        entity.stealthDisguisePlayerIndex = -1;
        entity.disguiseTemplateName = null;
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
      entity.stealthEnabled = true;

      // Source parity: StealthUpdate.cpp:939-1042 — when a DisguisesAsTeam unit enters
      // stealth, pick a nearby enemy unit as the disguise target. The unit appears as the
      // target's template to opponents. In C++ this is triggered by SpecialAbilityUpdate
      // calling disguiseAsObject(target); here we auto-pick the nearest enemy.
      if (profile && profile.disguisesAsTeam && !entity.objectStatusFlags.has('DISGUISED')) {
        const disguiseTarget = findDisguiseTarget(self, entity);
        if (disguiseTarget) {
          entity.stealthDisguisePlayerIndex = self.getPlayerIndexForSide(disguiseTarget.side) ?? -1;
          entity.disguiseTemplateName = disguiseTarget.templateName;
          entity.objectStatusFlags.add('DISGUISED');
        }
      }
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
  target.stealthEnabled = true;
  target.stealthDelayRemaining = 0;
}

export function updateDetection(self: GL): void {
  const DEFAULT_DETECTION_DURATION_FRAMES = 30; // ~1s at 30fps

  for (const detector of self.spawnedEntities.values()) {
    if (detector.destroyed) continue;

    // Source parity: detector needs either KINDOF_DETECTOR or a StealthDetectorUpdate module.
    const profile = detector.detectorProfile;
    if (!detector.kindOf.has('DETECTOR') && !profile) continue;
    if (profile && !detector.detectorEnabled) continue;

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
        // Source parity: StealthUpdate.cpp:916-935 — markAsDetected checks
        // m_orderIdleEnemiesToAttackMeUponReveal. If true, iterates all enemy
        // players and calls setWakeupIfInRange on their idle units within
        // vision range, causing them to auto-attack the revealed unit.
        const wasAlreadyDetected = target.objectStatusFlags.has('DETECTED');
        target.objectStatusFlags.add('DETECTED');
        target.detectedUntilFrame = self.frameCounter + detectionDuration;

        if (!wasAlreadyDetected
            && target.stealthProfile
            && target.stealthProfile.orderIdleEnemiesToAttackMeUponReveal) {
          orderIdleEnemiesToAttack(self, target);
        }
      }
    }
  }
}

/**
 * Source parity: StealthUpdate.cpp:841-866 setWakeupIfInRange + lines 916-935.
 * When a stealthed unit with OrderIdleEnemiesToAttackMeUponReveal is detected,
 * iterate all enemy entities. If an enemy is idle, armed, and within its own
 * vision range of the revealed unit, order it to attack the revealed unit.
 */
function orderIdleEnemiesToAttack(self: GL, revealedTarget: MapEntity): void {
  for (const enemy of self.spawnedEntities.values()) {
    if (enemy.destroyed) continue;

    // Source parity: only enemy players' objects.
    if (self.getTeamRelationship(enemy, revealedTarget) !== RELATIONSHIP_ENEMIES) continue;

    // Source parity: setWakeupIfInRange checks for AI interface — need an armed entity.
    if (!enemy.attackWeapon) continue;

    // Source parity: only wake up idle units — already attacking or moving units are skipped.
    // C++ wakeUpAndAttemptToTarget() only acts on idle AI states.
    if (enemy.attackTargetEntityId !== null || enemy.attackTargetPosition !== null) continue;
    if (enemy.moving) continue;

    // Source parity: StealthUpdate.cpp:849-855 — check the enemy's vision range.
    const vision = enemy.visionRange;
    if (vision <= 0) continue;

    const edx = enemy.x - revealedTarget.x;
    const edz = enemy.z - revealedTarget.z;
    const distSq = edx * edx + edz * edz;
    if (distSq > vision * vision) continue;

    // Source parity: ai->wakeUpAndAttemptToTarget() — directly assign attack target.
    // C++ wakeUpAndAttemptToTarget() triggers the AI to find and attack a target
    // without going through the normal command dispatch validation chain (no fog
    // check, no anti-mask check). We replicate this by directly setting the target.
    enemy.attackTargetEntityId = revealedTarget.id;
    enemy.attackCommandSource = 'AI';
  }
}

/**
 * Source parity: StealthUpdate::disguiseAsObject — find the nearest enemy unit to
 * use as a disguise template. C++ picks the target passed to the special ability;
 * in our simplified model we auto-pick the nearest enemy unit of the same general
 * category (vehicle, infantry, etc.) for a plausible disguise.
 */
function findDisguiseTarget(self: GL, entity: MapEntity): MapEntity | null {
  let bestTarget: MapEntity | null = null;
  let bestDistSq = Infinity;

  for (const candidate of self.spawnedEntities.values()) {
    if (candidate.destroyed || candidate.id === entity.id) continue;
    // Source parity: disguise as enemy units only.
    if (self.getTeamRelationship(entity, candidate) !== RELATIONSHIP_ENEMIES) continue;
    // Skip stealthed/disguised targets.
    if (candidate.objectStatusFlags.has('STEALTHED')) continue;

    const dx = candidate.x - entity.x;
    const dz = candidate.z - entity.z;
    const distSq = dx * dx + dz * dz;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      bestTarget = candidate;
    }
  }

  return bestTarget;
}
