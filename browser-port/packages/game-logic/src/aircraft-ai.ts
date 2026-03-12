// @ts-nocheck — self is typed as any; real safety comes from the test suite.
/**
 * Aircraft AI — jet state machine, chinook rappel/combat drop, parking places.
 *
 * Source parity: Object/Update/JetAIUpdate.cpp, Object/Update/ChinookAIUpdate.cpp, Object/ParkingPlace.cpp
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { readBooleanField, readNumericField, readNumericListField, readStringField } from './ini-readers.js';
import {
  canExitProducedUnitViaParking as canExitProducedUnitViaParkingImpl,
  hasAvailableParkingSpace as hasAvailableParkingSpaceImpl,
  releaseParkingDoorReservationForProduction as releaseParkingDoorReservationForProductionImpl,
  reserveParkingDoorForQueuedUnit as reserveParkingDoorForQueuedUnitImpl,
  reserveParkingSpaceForProducedUnit as reserveParkingSpaceForProducedUnitImpl,
  shouldReserveParkingDoorWhenQueued as shouldReserveParkingDoorWhenQueuedImpl,
} from './production-parking.js';
import { SupplyTruckAIState } from './supply-chain.js';
import {
  DEFAULT_CHINOOK_RAPPEL_SPEED,
  DEFAULT_CHINOOK_ROPE_COLOR,
  DEFAULT_CHINOOK_ROPE_NAME,
  DEFAULT_CHINOOK_ROPE_WOBBLE_AMP,
  DEFAULT_CHINOOK_ROPE_WOBBLE_LEN,
  DEFAULT_CHINOOK_ROPE_WOBBLE_RATE,
  DEFAULT_CHINOOK_ROPE_WIDTH,
  LOCOMOTORSET_NORMAL,
  LOCOMOTORSET_TAXIING,
  LOGIC_FRAME_RATE,
  PARKING_PLACE_HEAL_RATE_FRAMES,
} from './index.js';
import { MAP_XY_FACTOR } from '@generals/terrain';
type GL = any;

// ---- Aircraft AI implementations ----

export function extractParkingPlaceProfile(self: GL, objectDef: ObjectDef | undefined): ParkingPlaceProfile | null {
  if (!objectDef) {
    return null;
  }

  let foundModule = false;
  let numRows = 0;
  let numCols = 0;
  let approachHeight = 0;
  let hasRunways = false;
  let parkInHangars = false;
  let healAmountPerSecond = 0;

  const visitBlock = (block: IniBlock): void => {
    if (block.type.toUpperCase() !== 'BEHAVIOR') {
      for (const child of block.blocks) {
        visitBlock(child);
      }
      return;
    }

    const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
    if (moduleType === 'PARKINGPLACEBEHAVIOR') {
      foundModule = true;
      const rowsRaw = readNumericField(block.fields, ['NumRows']);
      const colsRaw = readNumericField(block.fields, ['NumCols']);
      const approachHeightRaw = readNumericField(block.fields, ['ApproachHeight']);
      const hasRunwaysRaw = readBooleanField(block.fields, ['HasRunways']);
      const parkInHangarsRaw = readBooleanField(block.fields, ['ParkInHangars']);
      const healAmountRaw = readNumericField(block.fields, ['HealAmountPerSecond']);
      if (rowsRaw !== null && Number.isFinite(rowsRaw)) {
        numRows = Math.max(0, Math.trunc(rowsRaw));
      }
      if (colsRaw !== null && Number.isFinite(colsRaw)) {
        numCols = Math.max(0, Math.trunc(colsRaw));
      }
      if (approachHeightRaw !== null && Number.isFinite(approachHeightRaw)) {
        approachHeight = approachHeightRaw;
      }
      if (typeof hasRunwaysRaw === 'boolean') {
        hasRunways = hasRunwaysRaw;
      }
      if (typeof parkInHangarsRaw === 'boolean') {
        parkInHangars = parkInHangarsRaw;
      }
      if (healAmountRaw !== null && Number.isFinite(healAmountRaw)) {
        healAmountPerSecond = healAmountRaw;
      }
    }

    for (const child of block.blocks) {
      visitBlock(child);
    }
  };

  for (const block of objectDef.blocks) {
    visitBlock(block);
  }

  if (!foundModule) {
    return null;
  }

  return {
    totalSpaces: numRows * numCols,
    occupiedSpaceEntityIds: new Set<number>(),
    reservedProductionIds: new Set<number>(),
    healAmountPerSecond,
    approachHeight,
    hasRunways,
    parkInHangars,
    healeeEntityIds: new Set<number>(),
    nextHealFrame: Number.POSITIVE_INFINITY,
  };
}

export function extractJetAIProfile(self: GL, objectDef: ObjectDef | undefined): JetAIProfile | null {
  if (!objectDef) {
    return null;
  }

  let foundModule = false;
  let sneakyOffsetWhenAttacking = 0;
  let attackersMissPersistFrames = 0;
  let needsRunway = true;
  let keepsParkingSpaceWhenAirborne = true;
  let outOfAmmoDamagePerSecond = 0;
  let returnToBaseIdleFrames = 0;
  let minHeight = 0;
  let parkingOffset = 0;
  let takeoffPauseFrames = 0;
  let takeoffDistForMaxLift = 0;
  let attackLocomotorSet = '';
  let attackLocoPersistFrames = 0;
  let returnLocomotorSet = '';

  const visitBlock = (block: IniBlock): void => {
    if (block.type.toUpperCase() === 'BEHAVIOR') {
      const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
      if (moduleType === 'JETAIUPDATE') {
        foundModule = true;
        const sneakyOffsetRaw = readNumericField(block.fields, ['SneakyOffsetWhenAttacking']) ?? 0;
        if (Number.isFinite(sneakyOffsetRaw)) {
          sneakyOffsetWhenAttacking = sneakyOffsetRaw;
        }
        const persistMsRaw = readNumericField(block.fields, ['AttackersMissPersistTime']) ?? 0;
        attackersMissPersistFrames = self.msToLogicFrames(persistMsRaw);
        needsRunway = readBooleanField(block.fields, ['NeedsRunway']) ?? true;
        keepsParkingSpaceWhenAirborne = readBooleanField(block.fields, ['KeepsParkingSpaceWhenAirborne']) ?? true;
        const outOfAmmoDmgRaw = readNumericField(block.fields, ['OutOfAmmoDamagePerSecond']) ?? 0;
        outOfAmmoDamagePerSecond = outOfAmmoDmgRaw / 100;
        const returnIdleMsRaw = readNumericField(block.fields, ['ReturnToBaseIdleTime']) ?? 0;
        returnToBaseIdleFrames = self.msToLogicFrames(returnIdleMsRaw);
        minHeight = readNumericField(block.fields, ['MinHeight']) ?? 0;
        parkingOffset = readNumericField(block.fields, ['ParkingOffset']) ?? 0;
        const takeoffPauseMsRaw = readNumericField(block.fields, ['TakeoffPause']) ?? 0;
        takeoffPauseFrames = self.msToLogicFrames(takeoffPauseMsRaw);
        takeoffDistForMaxLift = readNumericField(block.fields, ['TakeoffDistForMaxLift']) ?? 0;
        attackLocomotorSet = readStringField(block.fields, ['AttackLocomotorType'])?.trim().toUpperCase() ?? '';
        const attackLocoPersistMsRaw = readNumericField(block.fields, ['AttackLocomotorPersistTime']) ?? 0;
        attackLocoPersistFrames = self.msToLogicFrames(attackLocoPersistMsRaw);
        returnLocomotorSet = readStringField(block.fields, ['ReturnForAmmoLocomotorType'])?.trim().toUpperCase() ?? '';
      }
    }

    for (const child of block.blocks) {
      visitBlock(child);
    }
  };

  for (const block of objectDef.blocks) {
    visitBlock(block);
  }

  if (!foundModule) {
    return null;
  }

  return {
    sneakyOffsetWhenAttacking,
    attackersMissPersistFrames,
    needsRunway,
    keepsParkingSpaceWhenAirborne,
    outOfAmmoDamagePerSecond,
    returnToBaseIdleFrames,
    minHeight,
    parkingOffset,
    takeoffPauseFrames,
    takeoffDistForMaxLift,
    attackLocomotorSet,
    attackLocoPersistFrames,
    returnLocomotorSet,
  };
}

export function extractChinookAIProfile(self: GL, objectDef: ObjectDef | undefined): ChinookAIProfile | null {
  if (!objectDef) {
    return null;
  }

  let profile: ChinookAIProfile | null = null;
  const visitBlock = (block: IniBlock): void => {
    if (profile !== null) {
      return;
    }

    if (block.type.toUpperCase() === 'BEHAVIOR') {
      const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
      if (moduleType === 'CHINOOKAIUPDATE') {
        const perRopeDelayMinMs = readNumericField(block.fields, ['PerRopeDelayMin']) ?? 0x7fffffff;
        const perRopeDelayMaxMs = readNumericField(block.fields, ['PerRopeDelayMax']) ?? 0x7fffffff;
        const ropeName = readStringField(block.fields, ['RopeName']) ?? DEFAULT_CHINOOK_ROPE_NAME;
        const ropeWidth = readNumericField(block.fields, ['RopeWidth']) ?? DEFAULT_CHINOOK_ROPE_WIDTH;
        const ropeColorValues = readNumericListField(block.fields, ['RopeColor']);
        const ropeColor: readonly [number, number, number] = ropeColorValues && ropeColorValues.length >= 3
          ? [
            ropeColorValues[0] ?? DEFAULT_CHINOOK_ROPE_COLOR[0],
            ropeColorValues[1] ?? DEFAULT_CHINOOK_ROPE_COLOR[1],
            ropeColorValues[2] ?? DEFAULT_CHINOOK_ROPE_COLOR[2],
          ]
          : DEFAULT_CHINOOK_ROPE_COLOR;
        const ropeWobbleLen = readNumericField(block.fields, ['RopeWobbleLen']) ?? DEFAULT_CHINOOK_ROPE_WOBBLE_LEN;
        const ropeWobbleAmp = readNumericField(block.fields, ['RopeWobbleAmplitude']) ?? DEFAULT_CHINOOK_ROPE_WOBBLE_AMP;
        const ropeWobbleRateRaw = readNumericField(block.fields, ['RopeWobbleRate']);
        const ropeWobbleRate = ropeWobbleRateRaw != null
          ? (ropeWobbleRateRaw * Math.PI / 180) / LOGIC_FRAME_RATE
          : DEFAULT_CHINOOK_ROPE_WOBBLE_RATE;
        profile = {
          numRopes: Math.max(1, Math.trunc(readNumericField(block.fields, ['NumRopes']) ?? 4)),
          perRopeDelayMinFrames: self.msToLogicFrames(perRopeDelayMinMs),
          perRopeDelayMaxFrames: self.msToLogicFrames(perRopeDelayMaxMs),
          ropeName,
          ropeWidth,
          ropeColor,
          ropeWobbleLen,
          ropeWobbleAmp,
          ropeWobbleRate,
          minDropHeight: readNumericField(block.fields, ['MinDropHeight']) ?? 30.0,
          waitForRopesToDrop: readBooleanField(block.fields, ['WaitForRopesToDrop']) ?? true,
          rappelSpeed: readNumericField(block.fields, ['RappelSpeed']) ?? DEFAULT_CHINOOK_RAPPEL_SPEED,
          ropeDropSpeed: readNumericField(block.fields, ['RopeDropSpeed']) ?? 1e10,
          ropeFinalHeight: readNumericField(block.fields, ['RopeFinalHeight']) ?? 0.0,
        };
        return;
      }
    }

    for (const child of block.blocks) {
      visitBlock(child);
    }
  };

  for (const block of objectDef.blocks) {
    visitBlock(block);
  }

  return profile;
}

export function extractJetSlowDeathProfiles(self: GL, objectDef: ObjectDef | undefined): JetSlowDeathProfile[] {
  if (!objectDef) return [];
  const profiles: JetSlowDeathProfile[] = [];

  const visitBlock = (block: IniBlock): void => {
    const blockType = block.type.toUpperCase();
    if (blockType !== 'BEHAVIOR' && blockType !== 'DIE') return;
    const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
    if (moduleType !== 'JETSLOWDEATHBEHAVIOR') return;

    // DieMuxData fields.
    const deathTypes = new Set<string>();
    const deathTypesStr = readStringField(block.fields, ['DeathTypes']);
    if (deathTypesStr) {
      for (const token of deathTypesStr.toUpperCase().split(/\s+/)) {
        if (token) deathTypes.add(token);
      }
    }
    const veterancyLevels = new Set<string>();
    const vetStr = readStringField(block.fields, ['VeterancyLevels']);
    if (vetStr) {
      for (const token of vetStr.toUpperCase().split(/\s+/)) {
        if (token) veterancyLevels.add(token);
      }
    }
    const exemptStatus = new Set<string>();
    const exemptStr = readStringField(block.fields, ['ExemptStatus']);
    if (exemptStr) {
      for (const token of exemptStr.toUpperCase().split(/\s+/)) {
        if (token) exemptStatus.add(token);
      }
    }
    const requiredStatus = new Set<string>();
    const reqStr = readStringField(block.fields, ['RequiredStatus']);
    if (reqStr) {
      for (const token of reqStr.toUpperCase().split(/\s+/)) {
        if (token) requiredStatus.add(token);
      }
    }

    // C++ parseReal: RollRate and PitchRate are raw floats (not degrees).
    // C++ source comment confirms they should use parseAngularVelocityReal but don't.
    // C++ parsePercentToReal: RollRateDelta, FallHowFast → 0-1.
    const rollRate = readNumericField(block.fields, ['RollRate']) ?? 0;
    const rollRateDelta = (readNumericField(block.fields, ['RollRateDelta']) ?? 100) / 100;
    const pitchRate = readNumericField(block.fields, ['PitchRate']) ?? 0;
    const fallHowFast = (readNumericField(block.fields, ['FallHowFast']) ?? 50) / 100;

    // FX/OCL timeline.
    const oclOnGroundDeath: string[] = [];
    const ogStr = readStringField(block.fields, ['OCLOnGroundDeath']);
    if (ogStr) oclOnGroundDeath.push(ogStr);
    const oclInitialDeath: string[] = [];
    const idStr = readStringField(block.fields, ['OCLInitialDeath']);
    if (idStr) oclInitialDeath.push(idStr);
    const delaySecondaryFromInitialDeath = self.msToLogicFrames(
      readNumericField(block.fields, ['DelaySecondaryFromInitialDeath']) ?? 0);
    const oclSecondary: string[] = [];
    const secStr = readStringField(block.fields, ['OCLSecondary']);
    if (secStr) oclSecondary.push(secStr);
    const oclHitGround: string[] = [];
    const hgStr = readStringField(block.fields, ['OCLHitGround']);
    if (hgStr) oclHitGround.push(hgStr);
    const delayFinalBlowUpFromHitGround = self.msToLogicFrames(
      readNumericField(block.fields, ['DelayFinalBlowUpFromHitGround']) ?? 0);
    const oclFinalBlowUp: string[] = [];
    const fbStr = readStringField(block.fields, ['OCLFinalBlowUp']);
    if (fbStr) oclFinalBlowUp.push(fbStr);

    profiles.push({
      deathTypes, veterancyLevels, exemptStatus, requiredStatus,
      oclOnGroundDeath, oclInitialDeath, delaySecondaryFromInitialDeath,
      oclSecondary, oclHitGround, delayFinalBlowUpFromHitGround, oclFinalBlowUp,
      rollRate, rollRateDelta, pitchRate, fallHowFast,
    });
  };

  for (const block of objectDef.blocks) visitBlock(block);
  if (profiles.length === 0 && self.resolveObjectDefParent(objectDef)) {
    for (const block of self.resolveObjectDefParent(objectDef)?.blocks ?? []) visitBlock(block);
  }
  return profiles;
}

export function canAircraftEnterAirfieldForRepair(self: GL, source: MapEntity, airfield: MapEntity): boolean {
  const parkingProfile = airfield.parkingPlaceProfile;
  if (!parkingProfile) {
    return false;
  }
  // Source parity: ActionManager::canEnterObject uses ParkingPlaceBehavior::hasReservedSpace(obj->id).
  if (parkingProfile.occupiedSpaceEntityIds.has(source.id)) {
    return true;
  }

  const sourceObjectDef = self.resolveObjectDefByTemplateName(source.templateName) ?? undefined;
  if (!shouldReserveParkingDoorWhenQueuedImpl(sourceObjectDef?.kindOf)) {
    return false;
  }

  return hasAvailableParkingSpaceImpl(parkingProfile, airfield.productionQueue, self.spawnedEntities);
}

export function resolveChinookPreferredHeight(self: GL, entity: MapEntity): number {
  const active = entity.locomotorSets.get(entity.activeLocomotorSet);
  if (active) {
    return active.preferredHeight;
  }
  const normal = entity.locomotorSets.get(LOCOMOTORSET_NORMAL);
  return normal ? normal.preferredHeight : 0;
}

export function resolveChinookPreferredHeightDamping(self: GL, entity: MapEntity): number {
  const active = entity.locomotorSets.get(entity.activeLocomotorSet);
  if (active) {
    return active.preferredHeightDamping;
  }
  const normal = entity.locomotorSets.get(LOCOMOTORSET_NORMAL);
  return normal ? normal.preferredHeightDamping : 1;
}

export function setChinookAirfieldForHealing(self: GL, entity: MapEntity, airfieldId: number): void {
  const previousId = entity.chinookHealingAirfieldId;
  if (previousId === airfieldId) {
    return;
  }
  if (previousId !== 0) {
    const previousAirfield = self.spawnedEntities.get(previousId);
    if (previousAirfield?.parkingPlaceProfile) {
      setParkingPlaceHealee(self, previousAirfield, entity, false);
    }
  }
  entity.chinookHealingAirfieldId = airfieldId;
}

export function setChinookFlightStatus(self: GL, entity: MapEntity, status: ChinookFlightStatus): void {
  if (!entity.chinookAIProfile) {
    return;
  }
  if (entity.chinookFlightStatus === status) {
    return;
  }
  entity.chinookFlightStatus = status;
  entity.chinookFlightStatusEnteredFrame = self.frameCounter;

  if (status === 'LANDING') {
    // Source parity: ChinookTakeoffOrLandingState::onEnter — clear supplies on landing.
    clearChinookSupplyBoxes(self, entity.id);
    self.stopEntity(entity.id);
  } else if (status === 'TAKING_OFF') {
    self.stopEntity(entity.id);
  }

  if (status === 'LANDED') {
    entity.objectStatusFlags.delete('AIRBORNE_TARGET');
    self.setEntityLocomotorSet(entity.id, LOCOMOTORSET_TAXIING);
  } else {
    entity.objectStatusFlags.add('AIRBORNE_TARGET');
    self.setEntityLocomotorSet(entity.id, LOCOMOTORSET_NORMAL);
  }
}

export function clearChinookSupplyBoxes(self: GL, entityId: number): void {
  const state = self.supplyTruckStates.get(entityId);
  if (!state || state.currentBoxes <= 0) {
    return;
  }

  // Source parity: ChinookCombatDropState::onEnter — while (ai->loseOneBox()).
  state.currentBoxes = 0;
  if (state.aiState === SupplyTruckAIState.APPROACHING_DEPOT || state.aiState === SupplyTruckAIState.DEPOSITING) {
    state.targetDepotId = null;
    state.aiState = SupplyTruckAIState.IDLE;
  }
}

export function countActiveChinookRappellers(self: GL, sourceEntityId: number): number {
  let count = 0;
  for (const pending of self.pendingChinookRappels.values()) {
    if (pending.sourceEntityId === sourceEntityId) {
      count += 1;
    }
  }
  return count;
}

export function clearPendingChinookCommands(self: GL, entityId: number): void {
  self.pendingChinookCommandByEntityId.delete(entityId);
}

export function flushPendingChinookCommand(self: GL, entityId: number): void {
  const command = self.pendingChinookCommandByEntityId.get(entityId);
  if (!command) {
    return;
  }
  self.pendingChinookCommandByEntityId.delete(entityId);
  self.submitCommand(command);
}

export function abortPendingChinookRappels(self: GL, sourceEntityId: number): void {
  for (const [passengerId, pending] of self.pendingChinookRappels.entries()) {
    if (pending.sourceEntityId !== sourceEntityId) {
      continue;
    }
    const passenger = self.spawnedEntities.get(passengerId);
    if (passenger && !passenger.destroyed) {
      // Source parity: ChinookCombatDropState::onExit(STATE_FAILURE) -> rappellerAI->aiIdle().
      passenger.objectStatusFlags.delete('DISABLED_HELD');
      self.cancelEntityCommandPathActions(passenger.id);
      self.clearAttackTarget(passenger.id);
    }
    self.pendingChinookRappels.delete(passengerId);
  }
}

export function syncChinookCombatDropIgnoredObstacle(self: GL, source: MapEntity, targetObjectId: number | null): void {
  if (!source.chinookAIProfile || targetObjectId === null) {
    source.ignoredMovementObstacleId = null;
    return;
  }
  const target = self.spawnedEntities.get(targetObjectId);
  source.ignoredMovementObstacleId = target && !target.destroyed ? target.id : null;
}

export function clearChinookCombatDropIgnoredObstacle(self: GL, entityId: number): void {
  const entity = self.spawnedEntities.get(entityId);
  if (!entity || !entity.chinookAIProfile) {
    return;
  }
  entity.ignoredMovementObstacleId = null;
}

export function updatePendingChinookRappels(self: GL): void {
  for (const [passengerId, pending] of self.pendingChinookRappels.entries()) {
    const passenger = self.spawnedEntities.get(passengerId);
    if (!passenger || passenger.destroyed) {
      self.pendingChinookRappels.delete(passengerId);
      continue;
    }

    const source = self.spawnedEntities.get(pending.sourceEntityId);
    if (!source || source.destroyed) {
      passenger.objectStatusFlags.delete('DISABLED_HELD');
      self.cancelEntityCommandPathActions(passenger.id);
      self.clearAttackTarget(passenger.id);
      self.pendingChinookRappels.delete(passengerId);
      continue;
    }

    const groundY = self.resolveGroundHeight(passenger.x, passenger.z) + passenger.baseHeight;
    if (passenger.y > groundY) {
      passenger.y = Math.max(groundY, passenger.y - Math.max(0, pending.descentSpeedPerFrame));
      continue;
    }

    passenger.y = groundY;
    passenger.objectStatusFlags.delete('DISABLED_HELD');
    self.pendingChinookRappels.delete(passengerId);
    self.issueDroppedPassengerCommand(passenger, pending.targetX, pending.targetZ, pending.targetObjectId);
  }
}

export function updatePendingCombatDropActions(self: GL): void {
  for (const [sourceId, pending] of self.pendingCombatDropActions.entries()) {
    const source = self.spawnedEntities.get(sourceId);
    if (!source || source.destroyed) {
      clearChinookCombatDropIgnoredObstacle(self, sourceId);
      abortPendingChinookRappels(self, sourceId);
      clearPendingChinookCommands(self, sourceId);
      self.pendingCombatDropActions.delete(sourceId);
      continue;
    }

    syncChinookCombatDropIgnoredObstacle(self, source, pending.targetObjectId);

    if (source.moving) {
      continue;
    }

    const distance = Math.hypot(pending.targetX - source.x, pending.targetZ - source.z);
    const dropReachDistance = self.resolveEntityMajorRadius(source) + MAP_XY_FACTOR;
    if (distance > dropReachDistance) {
      self.issueMoveTo(source.id, pending.targetX, pending.targetZ);
      continue;
    }

    if (source.chinookAIProfile) {
      // Source parity: ChinookCombatDropState rappels CAN_RAPPEL passengers over time.
      const profile = source.chinookAIProfile;
      if (pending.nextDropFrame === 0) {
        // Source parity: combat drop holds the transport in place while rappelling.
        source.objectStatusFlags.add('DISABLED_HELD');
        setChinookFlightStatus(self, source, 'DOING_COMBAT_DROP');
        // Source parity: ChinookCombatDropState::onEnter — lose all gathered supply boxes.
        clearChinookSupplyBoxes(self, source.id);
        // Source parity: keep chinook at min drop height while deploying ropes.
        const hoverGround = self.resolveGroundHeight(source.x, source.z);
        const hoverY = hoverGround + source.baseHeight + Math.max(0, profile.minDropHeight);
        if (source.y < hoverY) {
          source.y = hoverY;
        }
        pending.nextDropFrame = self.frameCounter + resolveChinookCombatDropInitialDelayFrames(self, source);
      }
      if (self.frameCounter < pending.nextDropFrame) {
        continue;
      }

      let droppedAny = false;
      const dropsThisTick = Math.max(1, profile.numRopes);
      for (let i = 0; i < dropsThisTick; i++) {
        if (!self.evacuateOneContainedRappeller(source, pending.targetX, pending.targetZ, pending.targetObjectId)) {
          break;
        }
        droppedAny = true;
      }

      const hasContainedRappellers = self.countContainedRappellers(source.id) > 0;
      const hasActiveRappellers = countActiveChinookRappellers(self, source.id) > 0;
      if (!hasContainedRappellers && !hasActiveRappellers) {
        source.objectStatusFlags.delete('DISABLED_HELD');
        clearChinookCombatDropIgnoredObstacle(self, sourceId);
        self.pendingCombatDropActions.delete(sourceId);
        setChinookFlightStatus(self, source, 'FLYING');
        flushPendingChinookCommand(self, source.id);
        continue;
      }

      pending.nextDropFrame = droppedAny
        ? self.frameCounter + resolveChinookCombatDropIntervalFrames(self, profile)
        : self.frameCounter + 1;
      continue;
    }

    // Non-Chinook combat-drop carriers: immediate evac at destination.
    self.evacuateContainedEntities(source, pending.targetX, pending.targetZ, pending.targetObjectId);
    clearChinookCombatDropIgnoredObstacle(self, sourceId);
    self.pendingCombatDropActions.delete(sourceId);
  }
}

export function setParkingPlaceHealee(self: GL, airfield: MapEntity, healee: MapEntity, add: boolean): void {
  const profile = airfield.parkingPlaceProfile;
  if (!profile) {
    return;
  }
  if (add) {
    if (profile.healeeEntityIds.has(healee.id)) {
      return;
    }
    // Ensure a healee is only registered with one parking place at a time.
    for (const other of self.spawnedEntities.values()) {
      if (other.id === airfield.id) continue;
      const otherProfile = other.parkingPlaceProfile;
      if (otherProfile) {
        otherProfile.healeeEntityIds.delete(healee.id);
      }
    }
    profile.healeeEntityIds.add(healee.id);
    if (profile.healeeEntityIds.size === 1) {
      profile.nextHealFrame = self.frameCounter + PARKING_PLACE_HEAL_RATE_FRAMES;
    }
    return;
  }

  if (profile.healeeEntityIds.delete(healee.id) && profile.healeeEntityIds.size === 0) {
    profile.nextHealFrame = Number.POSITIVE_INFINITY;
  }
}

export function clearParkingPlaceHealee(self: GL, healee: MapEntity): void {
  for (const other of self.spawnedEntities.values()) {
    const profile = other.parkingPlaceProfile;
    if (!profile) continue;
    if (profile.healeeEntityIds.delete(healee.id) && profile.healeeEntityIds.size === 0) {
      profile.nextHealFrame = Number.POSITIVE_INFINITY;
    }
  }
}

export function updateParkingPlaceHealing(self: GL): void {
  for (const airfield of self.spawnedEntities.values()) {
    const profile = airfield.parkingPlaceProfile;
    if (!profile) continue;
    if (profile.healAmountPerSecond <= 0) continue;
    if (profile.healeeEntityIds.size === 0) continue;
    if (self.frameCounter < profile.nextHealFrame) continue;

    profile.nextHealFrame = self.frameCounter + PARKING_PLACE_HEAL_RATE_FRAMES;
    const healAmount = profile.healAmountPerSecond * (PARKING_PLACE_HEAL_RATE_FRAMES / LOGIC_FRAME_RATE);
    if (healAmount <= 0) continue;

    const toRemove: number[] = [];
    for (const healeeId of profile.healeeEntityIds) {
      const healee = self.spawnedEntities.get(healeeId);
      if (!healee || healee.destroyed) {
        toRemove.push(healeeId);
        continue;
      }
      if (healee.health >= healee.maxHealth) {
        continue;
      }
      const prevHealth = healee.health;
      healee.health = Math.min(healee.maxHealth, healee.health + healAmount);
      if (healee.health > prevHealth) {
        self.clearPoisonFromEntity(healee);
        if (healee.minefieldProfile) {
          self.mineOnDamage(healee, airfield.id, 'HEALING');
        }
      }
    }

    for (const healeeId of toRemove) {
      profile.healeeEntityIds.delete(healeeId);
    }
    if (profile.healeeEntityIds.size === 0) {
      profile.nextHealFrame = Number.POSITIVE_INFINITY;
    }
  }
}

export function isChinookAvailableForSupplying(self: GL, entity: MapEntity): boolean {
  if (!entity.chinookAIProfile) {
    return true;
  }
  if (self.pendingCombatDropActions.has(entity.id)) {
    return false;
  }
  if (self.collectContainedEntityIds(entity.id).length > 0) {
    return false;
  }
  if (self.hasPendingTransportEntryForContainer(entity.id)) {
    return false;
  }
  if (entity.containProfile?.moduleType === 'OVERLORD') {
    return false;
  }
  return true;
}

export function resolveChinookCombatDropInitialDelayFrames(self: GL, source: MapEntity): number {
  const profile = source.chinookAIProfile;
  if (!profile || !profile.waitForRopesToDrop) {
    return 0;
  }
  if (!Number.isFinite(profile.ropeDropSpeed) || profile.ropeDropSpeed <= 0) {
    return 0;
  }

  const groundY = self.resolveGroundHeight(source.x, source.z);
  const dropHeight = Math.max(0, (source.y - source.baseHeight) - groundY - profile.ropeFinalHeight);
  if (dropHeight <= 0) {
    return 0;
  }

  // Source parity approximation: rope speed is world-units/sec.
  const dropSpeedPerFrame = profile.ropeDropSpeed / LOGIC_FRAME_RATE;
  if (dropSpeedPerFrame <= 0) {
    return 0;
  }
  return Math.max(0, Math.ceil(dropHeight / dropSpeedPerFrame));
}

export function resolveChinookCombatDropIntervalFrames(self: GL, profile: ChinookAIProfile): number {
  const minFrames = Math.max(0, profile.perRopeDelayMinFrames);
  const maxFrames = Math.max(minFrames, profile.perRopeDelayMaxFrames);
  if (maxFrames <= minFrames) {
    return minFrames;
  }
  return self.gameRandom.nextRange(minFrames, maxFrames);
}

export function resolveChinookRappelSpeedPerFrame(self: GL, profile: ChinookAIProfile): number {
  if (!Number.isFinite(profile.rappelSpeed) || profile.rappelSpeed <= 0) {
    return 0;
  }
  return profile.rappelSpeed / LOGIC_FRAME_RATE;
}

export function hasAvailableParkingSpaceFor(self: GL, producer: MapEntity, unitDef: ObjectDef): boolean {
  if (!shouldReserveParkingDoorWhenQueued(self, unitDef)) {
    return true;
  }

  return hasAvailableParkingSpaceImpl(
    producer.parkingPlaceProfile,
    producer.productionQueue,
    self.spawnedEntities,
  );
}

export function shouldReserveParkingDoorWhenQueued(self: GL, unitDef: ObjectDef): boolean {
  return shouldReserveParkingDoorWhenQueuedImpl(unitDef.kindOf);
}

export function reserveParkingDoorForQueuedUnit(self: GL, 
  producer: MapEntity,
  unitDef: ObjectDef,
  productionId: number,
): boolean {
  if (!shouldReserveParkingDoorWhenQueued(self, unitDef)) {
    return true;
  }

  return reserveParkingDoorForQueuedUnitImpl(
    producer.parkingPlaceProfile,
    producer.productionQueue,
    self.spawnedEntities,
    productionId,
  );
}

export function releaseParkingDoorReservationForProduction(self: GL, producer: MapEntity, productionId: number): void {
  releaseParkingDoorReservationForProductionImpl(producer.parkingPlaceProfile, productionId);
}

export function canExitProducedUnitViaParking(self: GL, 
  producer: MapEntity,
  unitDef: ObjectDef,
  productionId: number,
): boolean {
  if (!shouldReserveParkingDoorWhenQueued(self, unitDef)) {
    return true;
  }

  return canExitProducedUnitViaParkingImpl(
    producer.parkingPlaceProfile,
    producer.productionQueue,
    self.spawnedEntities,
    productionId,
  );
}

export function reserveParkingSpaceForProducedUnit(self: GL, 
  producer: MapEntity,
  producedUnit: MapEntity,
  producedUnitDef: ObjectDef,
  productionId: number,
): boolean {
  if (!shouldReserveParkingDoorWhenQueued(self, producedUnitDef)) {
    return true;
  }

  if (!reserveParkingSpaceForProducedUnitImpl(
    producer.parkingPlaceProfile,
    producer.productionQueue,
    self.spawnedEntities,
    productionId,
    producedUnit.id,
  )) {
    return false;
  }

  producedUnit.parkingSpaceProducerId = producer.id;
  if (producer.containProfile?.moduleType === 'HELIX') {
    const producedKindOf = self.resolveEntityKindOfSet(producedUnit);
    if (producedKindOf.has('PORTABLE_STRUCTURE')) {
      const allowedPortableTemplates = producer.containProfile.portableStructureTemplateNames;
      const producedTemplateName = producedUnit.templateName.toUpperCase();
      const isTemplateAllowed =
        !allowedPortableTemplates || allowedPortableTemplates.length === 0 || allowedPortableTemplates.includes(producedTemplateName);
      // Source parity: HelixContain::addToContain/addToContainList only set
      // m_portableStructureID when it is INVALID_ID (first portable only).
      // (GeneralsMD/Code/GameEngine/Source/GameLogic/Object/Contain/HelixContain.cpp:252,270)
      if (producer.helixPortableRiderId === null && isTemplateAllowed) {
        producer.helixPortableRiderId = producedUnit.id;
      }
      producedUnit.helixCarrierId = producer.id;
    }
  }
  return true;
}

export function jetAITransition(self: GL, _entity: MapEntity, js: JetAIRuntimeState, newState: JetAIState): void {
  js.state = newState;
  js.stateEnteredFrame = self.frameCounter;
}

export function updateJetAI(self: GL): void {
  const TAKEOFF_FRAMES = 30;
  const LANDING_FRAMES = 30;
  const NEAR_AIRFIELD_DIST_SQ = 400; // 20 world units squared

  for (const entity of self.spawnedEntities.values()) {
    if (entity.destroyed) continue;
    const js = entity.jetAIState;
    const profile = entity.jetAIProfile;
    if (!js || !profile) continue;

    const framesInState = self.frameCounter - js.stateEnteredFrame;

    switch (js.state) {
      case 'PARKED': {
        // If there's a pending command, take off.
        if (js.pendingCommand) {
          // Source parity: JetAwaitingRunwayState — must reserve runway before takeoff.
          // For flight deck carriers, attempt to reserve a takeoff runway first.
          const parkedProducer = self.spawnedEntities.get(entity.producerEntityId);
          const fdProfileParked = parkedProducer?.flightDeckProfile;
          const fdStateParked = parkedProducer?.flightDeckState;
          if (fdProfileParked && fdStateParked) {
            if (!self.flightDeckReserveRunway(fdStateParked, fdProfileParked, entity.id, false)) {
              // Can't get a runway yet — stay PARKED and wait.
              break;
            }
          }
          jetAITransition(self, entity, js, 'TAKING_OFF');
          entity.objectStatusFlags.add('AIRBORNE_TARGET');
          js.allowAirLoco = false; // not yet airborne for movement
          entity.moving = false;
        }
        break;
      }

      case 'TAKING_OFF': {
        // Interpolate altitude from ground to cruise over TAKEOFF_FRAMES.
        const progress = Math.min(1, framesInState / TAKEOFF_FRAMES);
        if (self.mapHeightmap) {
          const terrainHeight = self.mapHeightmap.getInterpolatedHeight(entity.x, entity.z);
          const groundY = terrainHeight + entity.baseHeight;
          entity.y = groundY + js.cruiseHeight * progress;
        }

        if (framesInState >= TAKEOFF_FRAMES) {
          js.allowAirLoco = true;
          jetAITransition(self, entity, js, 'AIRBORNE');

          // Source parity: JetTakeoffOrLandingState::onExit — release runway and
          // optionally release parking space when takeoff completes.
          const takeoffProducer = self.spawnedEntities.get(entity.producerEntityId);
          const fdStateTakeoff = takeoffProducer?.flightDeckState;
          if (fdStateTakeoff) {
            if (!profile.keepsParkingSpaceWhenAirborne) {
              self.flightDeckReleaseSpace(fdStateTakeoff, entity.id);
            }
            self.flightDeckReleaseRunway(fdStateTakeoff, entity.id);
          }

          // Execute pending command.
          if (js.pendingCommand) {
            const cmd = js.pendingCommand;
            js.pendingCommand = null;
            if (cmd.type === 'moveTo') {
              self.issueMoveTo(entity.id, cmd.x, cmd.z);
            } else if (cmd.type === 'attackEntity') {
              self.issueAttackEntity(entity.id, cmd.targetId, 'PLAYER');
            }
          }

          // Start idle return timer if configured.
          if (profile.returnToBaseIdleFrames > 0) {
            js.returnToBaseFrame = self.frameCounter + profile.returnToBaseIdleFrames;
          }
        }
        break;
      }

      case 'AIRBORNE': {
        // Check ammo depletion → return to base.
        if (self.isEntityOutOfClipAmmo(entity)) {
          jetAITransition(self, entity, js, 'RETURNING_FOR_LANDING');
          js.useReturnLoco = profile.returnLocomotorSet !== '';
          self.clearAttackTarget(entity.id);
          entity.moving = false;
          // Issue moveTo toward producer/airfield.
          self.issueMoveTo(entity.id, js.producerX, js.producerZ);
          break;
        }

        // Check idle return timer.
        if (profile.returnToBaseIdleFrames > 0
          && js.returnToBaseFrame > 0
          && self.frameCounter >= js.returnToBaseFrame
          && !entity.moving
          && entity.attackTargetEntityId === null) {
          jetAITransition(self, entity, js, 'RETURNING_FOR_LANDING');
          js.useReturnLoco = profile.returnLocomotorSet !== '';
          self.issueMoveTo(entity.id, js.producerX, js.producerZ);
          break;
        }

        // Reset idle timer when given a new command.
        if (entity.moving || entity.attackTargetEntityId !== null) {
          if (profile.returnToBaseIdleFrames > 0) {
            js.returnToBaseFrame = self.frameCounter + profile.returnToBaseIdleFrames;
          }
        }

        // Manage attack locomotor switching.
        if (profile.attackLocomotorSet !== '' && entity.attackTargetEntityId !== null) {
          if (js.attackLocoExpireFrame === 0) {
            js.attackLocoExpireFrame = self.frameCounter + profile.attackLocoPersistFrames;
          }
        }
        if (js.attackLocoExpireFrame > 0 && self.frameCounter >= js.attackLocoExpireFrame
          && entity.attackTargetEntityId === null) {
          js.attackLocoExpireFrame = 0;
        }

        break;
      }

      case 'RETURNING_FOR_LANDING': {
        // Check if producer/airfield is dead.
        const producer = self.spawnedEntities.get(entity.producerEntityId);
        if (!producer || producer.destroyed) {
          // Try to find a new airfield.
          const newAirfield = self.findSuitableAirfield(entity);
          if (newAirfield) {
            js.producerX = newAirfield.x;
            js.producerZ = newAirfield.z;
            entity.producerEntityId = newAirfield.id;
            self.issueMoveTo(entity.id, js.producerX, js.producerZ);
          } else {
            jetAITransition(self, entity, js, 'CIRCLING_DEAD_AIRFIELD');
            js.circlingNextCheckFrame = self.frameCounter + 30;
            break;
          }
        }

        // Check if near airfield.
        const dxR = entity.x - js.producerX;
        const dzR = entity.z - js.producerZ;
        if (dxR * dxR + dzR * dzR <= NEAR_AIRFIELD_DIST_SQ) {
          // Source parity: JetAwaitingRunwayState + JetTakeoffOrLandingState::onEnter —
          // for flight deck carriers, must reserve space + landing runway before landing.
          const landProducer = self.spawnedEntities.get(entity.producerEntityId);
          const fdProfileLand = landProducer?.flightDeckProfile;
          const fdStateLand = landProducer?.flightDeckState;
          if (fdProfileLand && fdStateLand) {
            // Reserve a parking space first (required before runway reservation).
            if (!self.flightDeckReserveSpace(fdStateLand, entity.id)) {
              // No space available — keep circling.
              break;
            }
            // Reserve landing runway.
            if (!self.flightDeckReserveRunway(fdStateLand, fdProfileLand, entity.id, true)) {
              // Runway busy — keep circling (space stays reserved).
              break;
            }
          }
          jetAITransition(self, entity, js, 'LANDING');
          entity.moving = false;
          // Snap XZ to airfield.
          entity.x = js.producerX;
          entity.z = js.producerZ;
        }
        break;
      }

      case 'LANDING': {
        // Interpolate altitude from cruise to ground over LANDING_FRAMES.
        const landProgress = Math.min(1, framesInState / LANDING_FRAMES);
        if (self.mapHeightmap) {
          const terrainHeight = self.mapHeightmap.getInterpolatedHeight(entity.x, entity.z);
          const groundY = terrainHeight + entity.baseHeight;
          entity.y = groundY + js.cruiseHeight * (1 - landProgress);
        }

        if (framesInState >= LANDING_FRAMES) {
          js.allowAirLoco = false;
          entity.objectStatusFlags.delete('AIRBORNE_TARGET');

          // Source parity: JetTakeoffOrLandingState::onExit — release landing runway
          // when landing completes (for both airfields and flight decks).
          const landingDoneProducer = self.spawnedEntities.get(entity.producerEntityId);
          const fdStateLandDone = landingDoneProducer?.flightDeckState;
          if (fdStateLandDone) {
            self.flightDeckReleaseRunway(fdStateLandDone, entity.id);
          }

          // Determine if reload is needed.
          const weapon = entity.attackWeapon;
          if (weapon && weapon.clipSize > 0 && entity.attackAmmoInClip < weapon.clipSize) {
            jetAITransition(self, entity, js, 'RELOAD_AMMO');
            // Compute reload time proportional to ammo missing.
            const missingRatio = 1 - (entity.attackAmmoInClip / weapon.clipSize);
            const fullReloadFrames = weapon.clipReloadFrames > 0 ? weapon.clipReloadFrames : 30;
            js.reloadTotalFrames = Math.max(1, Math.trunc(fullReloadFrames * missingRatio));
            js.reloadDoneFrame = self.frameCounter + js.reloadTotalFrames;
          } else {
            jetAITransition(self, entity, js, 'PARKED');
          }
        }
        break;
      }

      case 'RELOAD_AMMO': {
        const weapon = entity.attackWeapon;
        if (weapon && weapon.clipSize > 0 && js.reloadTotalFrames > 0) {
          // Proportional clip refill: linearly restore ammo over reloadTotalFrames.
          const elapsed = self.frameCounter - js.stateEnteredFrame;
          const progress = Math.min(1, elapsed / js.reloadTotalFrames);
          const ammoAtStart = weapon.clipSize - Math.trunc(js.reloadTotalFrames * weapon.clipSize / Math.max(1, weapon.clipReloadFrames > 0 ? weapon.clipReloadFrames : 30));
          entity.attackAmmoInClip = Math.min(weapon.clipSize,
            Math.trunc(ammoAtStart + (weapon.clipSize - ammoAtStart) * progress));
        }

        if (self.frameCounter >= js.reloadDoneFrame) {
          // Fully refill.
          if (weapon && weapon.clipSize > 0) {
            entity.attackAmmoInClip = weapon.clipSize;
          }
          // If a command is pending, go straight to takeoff.
          if (js.pendingCommand) {
            // Source parity: must reserve runway before takeoff (same as PARKED → TAKING_OFF).
            const reloadProducer = self.spawnedEntities.get(entity.producerEntityId);
            const fdProfileReload = reloadProducer?.flightDeckProfile;
            const fdStateReload = reloadProducer?.flightDeckState;
            if (fdProfileReload && fdStateReload) {
              if (!self.flightDeckReserveRunway(fdStateReload, fdProfileReload, entity.id, false)) {
                // Runway busy — stay in RELOAD_AMMO with pending command to retry next frame.
                break;
              }
            }
            jetAITransition(self, entity, js, 'TAKING_OFF');
            entity.objectStatusFlags.add('AIRBORNE_TARGET');
            js.allowAirLoco = false;
            entity.moving = false;
          } else {
            jetAITransition(self, entity, js, 'PARKED');
          }
        }
        break;
      }

      case 'CIRCLING_DEAD_AIRFIELD': {
        // Apply out-of-ammo damage per second.
        if (profile.outOfAmmoDamagePerSecond > 0) {
          const dmgPerFrame = entity.maxHealth * profile.outOfAmmoDamagePerSecond / LOGIC_FRAME_RATE;
          self.applyWeaponDamageAmount(null, entity, dmgPerFrame, 'UNRESISTABLE');
          if (entity.destroyed) continue;
        }

        // Check for new airfield every 30 frames.
        if (self.frameCounter >= js.circlingNextCheckFrame) {
          js.circlingNextCheckFrame = self.frameCounter + 30;
          const newAirfield = self.findSuitableAirfield(entity);
          if (newAirfield) {
            js.producerX = newAirfield.x;
            js.producerZ = newAirfield.z;
            entity.producerEntityId = newAirfield.id;
            jetAITransition(self, entity, js, 'RETURNING_FOR_LANDING');
            self.issueMoveTo(entity.id, js.producerX, js.producerZ);
          }
        }
        break;
      }
    }

    const airfield = self.spawnedEntities.get(entity.producerEntityId);
    if (airfield?.parkingPlaceProfile) {
      if (
        !js.allowAirLoco
        && !js.pendingCommand
        && entity.kindOf.has('PRODUCED_AT_HELIPAD')
        && entity.health >= entity.maxHealth
      ) {
        // Source parity: helipad aircraft take off once fully healed.
        setParkingPlaceHealee(self, airfield, entity, false);
        jetAITransition(self, entity, js, 'TAKING_OFF');
        entity.objectStatusFlags.add('AIRBORNE_TARGET');
        js.allowAirLoco = false;
        entity.moving = false;
      } else {
        setParkingPlaceHealee(self, airfield, entity, !js.allowAirLoco);
      }
    } else if (airfield?.flightDeckState) {
      // Source parity: FlightDeckBehavior healing — grounded jets at carriers get healed.
      const isGrounded = !js.allowAirLoco;
      self.flightDeckSetHealee(airfield.flightDeckState, entity.id, isGrounded);
    } else {
      clearParkingPlaceHealee(self, entity);
    }
  }
}

export function updateChinookAI(self: GL): void {
  for (const entity of self.spawnedEntities.values()) {
    if (entity.destroyed || !entity.chinookAIProfile) {
      continue;
    }

    if (!entity.chinookFlightStatus) {
      // Source parity: ChinookAIUpdate ctor — start as FLYING even if grounded.
      setChinookFlightStatus(self, entity, 'FLYING');
    }

    const status = entity.chinookFlightStatus ?? 'FLYING';
    const waitingToEnterOrExit = self.hasPendingTransportEntryForContainer(entity.id);
    const healingAirfieldId = entity.chinookHealingAirfieldId;
    if (healingAirfieldId !== 0) {
      const airfield = self.spawnedEntities.get(healingAirfieldId);
      if (!airfield || airfield.destroyed || !airfield.parkingPlaceProfile) {
        setChinookAirfieldForHealing(self, entity, 0);
      } else if (
        status === 'LANDED'
        && !waitingToEnterOrExit
        && !self.pendingChinookCommandByEntityId.has(entity.id)
        && entity.health >= entity.maxHealth
      ) {
        setParkingPlaceHealee(self, airfield, entity, false);
        setChinookFlightStatus(self, entity, 'TAKING_OFF');
      } else {
        setParkingPlaceHealee(self, airfield, entity, status === 'LANDED');
      }
    }
    if (status === 'TAKING_OFF' || status === 'LANDING' || status === 'DOING_COMBAT_DROP') {
      continue;
    }

    if (waitingToEnterOrExit && status !== 'LANDED') {
      setChinookFlightStatus(self, entity, 'LANDING');
      continue;
    }

    if (
      !waitingToEnterOrExit
      && status === 'LANDED'
      && !self.pendingChinookCommandByEntityId.has(entity.id)
      && entity.chinookHealingAirfieldId === 0
    ) {
      setChinookFlightStatus(self, entity, 'TAKING_OFF');
    }
  }
}
