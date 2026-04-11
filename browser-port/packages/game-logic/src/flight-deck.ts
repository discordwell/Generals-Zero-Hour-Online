// @ts-nocheck — self is typed as any; real safety comes from the test suite.
/**
 * Flight deck — aircraft carrier state machine, parking healing, space management.
 *
 * Source parity: Object/FlightDeckBehavior.cpp
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { readNumericField, readStringField, readStringList } from './ini-readers.js';
import { FLIGHT_DECK_HEAL_RATE_FRAMES, LOGIC_FRAME_RATE } from './index.js';
type GL = any;

// ---- Flight deck implementations ----

export function extractFlightDeckProfile(self: GL, objectDef: ObjectDef | undefined): FlightDeckProfile | null {
  if (!objectDef) return null;

  let foundModule = false;
  let numRunways = 1;
  let numSpacesPerRunway = 0;
  let healAmountPerSecond = 0;
  let approachHeight = 0;
  let landingDeckHeightOffset = 0;
  let cleanupFrames = 0;
  let humanFollowFrames = 0;
  let replacementFrames = 0;
  let dockAnimationFrames = 0;
  let launchWaveFrames = 0;
  let launchRampFrames = 0;
  let lowerRampFrames = 0;
  let catapultFireFrames = 0;
  let payloadTemplateName = '';
  const runwaySpaces: string[][] = [];
  const runwayTakeoff: [string, string][] = [];
  const runwayLanding: [string, string][] = [];
  const runwayTaxi: string[][] = [];
  const runwayCreation: string[][] = [];

  const msToFrames = (ms: number): number => Math.max(0, Math.round(ms / (1000 / LOGIC_FRAME_RATE)));

  const visitBlock = (block: IniBlock): void => {
    if (block.type.toUpperCase() !== 'BEHAVIOR') {
      for (const child of block.blocks) {
        visitBlock(child);
      }
      return;
    }

    const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
    if (moduleType === 'FLIGHTDECKBEHAVIOR') {
      foundModule = true;

      const numRunwaysRaw = readNumericField(block.fields, ['NumRunways']);
      if (numRunwaysRaw !== null && Number.isFinite(numRunwaysRaw)) {
        numRunways = Math.max(1, Math.trunc(numRunwaysRaw));
      }
      const numSpacesRaw = readNumericField(block.fields, ['NumSpacesPerRunway']);
      if (numSpacesRaw !== null && Number.isFinite(numSpacesRaw)) {
        numSpacesPerRunway = Math.max(0, Math.trunc(numSpacesRaw));
      }
      const healRaw = readNumericField(block.fields, ['HealAmountPerSecond']);
      if (healRaw !== null && Number.isFinite(healRaw)) {
        healAmountPerSecond = healRaw;
      }
      const approachRaw = readNumericField(block.fields, ['ApproachHeight']);
      if (approachRaw !== null && Number.isFinite(approachRaw)) {
        approachHeight = approachRaw;
      }
      const deckOffsetRaw = readNumericField(block.fields, ['LandingDeckHeightOffset']);
      if (deckOffsetRaw !== null && Number.isFinite(deckOffsetRaw)) {
        landingDeckHeightOffset = deckOffsetRaw;
      }
      const cleanupRaw = readNumericField(block.fields, ['ParkingCleanupPeriod']);
      if (cleanupRaw !== null && Number.isFinite(cleanupRaw)) {
        cleanupFrames = msToFrames(cleanupRaw);
      }
      const humanFollowRaw = readNumericField(block.fields, ['HumanFollowPeriod']);
      if (humanFollowRaw !== null && Number.isFinite(humanFollowRaw)) {
        humanFollowFrames = msToFrames(humanFollowRaw);
      }
      const replacementRaw = readNumericField(block.fields, ['ReplacementDelay']);
      if (replacementRaw !== null && Number.isFinite(replacementRaw)) {
        replacementFrames = msToFrames(replacementRaw);
      }
      const dockAnimRaw = readNumericField(block.fields, ['DockAnimationDelay']);
      if (dockAnimRaw !== null && Number.isFinite(dockAnimRaw)) {
        dockAnimationFrames = msToFrames(dockAnimRaw);
      }
      const launchWaveRaw = readNumericField(block.fields, ['LaunchWaveDelay']);
      if (launchWaveRaw !== null && Number.isFinite(launchWaveRaw)) {
        launchWaveFrames = msToFrames(launchWaveRaw);
      }
      const launchRampRaw = readNumericField(block.fields, ['LaunchRampDelay']);
      if (launchRampRaw !== null && Number.isFinite(launchRampRaw)) {
        launchRampFrames = msToFrames(launchRampRaw);
      }
      const lowerRampRaw = readNumericField(block.fields, ['LowerRampDelay']);
      if (lowerRampRaw !== null && Number.isFinite(lowerRampRaw)) {
        lowerRampFrames = msToFrames(lowerRampRaw);
      }
      const catapultFireRaw = readNumericField(block.fields, ['CatapultFireDelay']);
      if (catapultFireRaw !== null && Number.isFinite(catapultFireRaw)) {
        catapultFireFrames = msToFrames(catapultFireRaw);
      }
      const payloadRaw = readStringField(block.fields, ['PayloadTemplate']);
      if (payloadRaw) {
        payloadTemplateName = payloadRaw;
      }

      // Parse per-runway bone names (up to 4 runways).
      for (let r = 0; r < 4; r++) {
        const rn = r + 1;
        const spacesRaw = readStringList(block.fields, [`Runway${rn}Spaces`]);
        const takeoffRaw = readStringList(block.fields, [`Runway${rn}Takeoff`]);
        const landingRaw = readStringList(block.fields, [`Runway${rn}Landing`]);
        const taxiRaw = readStringList(block.fields, [`Runway${rn}Taxi`]);
        const creationRaw = readStringList(block.fields, [`Runway${rn}Creation`]);

        if (spacesRaw.length > 0 || r < numRunways) {
          while (runwaySpaces.length <= r) runwaySpaces.push([]);
          while (runwayTakeoff.length <= r) runwayTakeoff.push(['', '']);
          while (runwayLanding.length <= r) runwayLanding.push(['', '']);
          while (runwayTaxi.length <= r) runwayTaxi.push([]);
          while (runwayCreation.length <= r) runwayCreation.push([]);

          runwaySpaces[r] = spacesRaw;
          if (takeoffRaw.length >= 2) {
            runwayTakeoff[r] = [takeoffRaw[0]!, takeoffRaw[1]!];
          }
          if (landingRaw.length >= 2) {
            runwayLanding[r] = [landingRaw[0]!, landingRaw[1]!];
          }
          runwayTaxi[r] = taxiRaw;
          runwayCreation[r] = creationRaw;
        }
      }
    }

    for (const child of block.blocks) {
      visitBlock(child);
    }
  };

  for (const block of objectDef.blocks) {
    visitBlock(block);
  }

  if (!foundModule) return null;

  return {
    numRunways,
    numSpacesPerRunway,
    healAmountPerSecond,
    approachHeight,
    landingDeckHeightOffset,
    cleanupFrames,
    humanFollowFrames,
    replacementFrames,
    dockAnimationFrames,
    launchWaveFrames,
    launchRampFrames,
    lowerRampFrames,
    catapultFireFrames,
    payloadTemplateName,
    runwaySpaces,
    runwayTakeoff,
    runwayLanding,
    runwayTaxi,
    runwayCreation,
  };
}

export function initializeFlightDeckState(self: GL, entity: MapEntity, profile: FlightDeckProfile): void {
  const parkingSpaces: FlightDeckParkingSpace[] = [];

  // Source parity: interleave spaces — for row in 0..numSpacesPerRunway, for col in 0..numRunways
  for (let row = 0; row < profile.numSpacesPerRunway; row++) {
    for (let col = 0; col < profile.numRunways; col++) {
      parkingSpaces.push({
        occupantId: -1,
        runway: col,
      });
    }
  }

  const runwayTakeoffReservation: number[] = [];
  const runwayLandingReservation: number[] = [];
  const nextLaunchWaveFrame: number[] = [];
  const rampUpFrame: number[] = [];
  const catapultSystemFrame: number[] = [];
  const lowerRampFrame: number[] = [];
  const rampUp: boolean[] = [];

  for (let i = 0; i < profile.numRunways; i++) {
    runwayTakeoffReservation.push(-1);
    runwayLandingReservation.push(-1);
    nextLaunchWaveFrame.push(0);
    rampUpFrame.push(0);
    catapultSystemFrame.push(Number.POSITIVE_INFINITY);
    lowerRampFrame.push(Number.POSITIVE_INFINITY);
    rampUp.push(false);
  }

  entity.flightDeckState = {
    parkingSpaces,
    runwayTakeoffReservation,
    runwayLandingReservation,
    healeeEntityIds: new Set<number>(),
    healeeStates: [],
    nextHealFrame: Number.POSITIVE_INFINITY,
    nextCleanupFrame: 0,
    startedProductionFrame: Number.POSITIVE_INFINITY,
    nextAllowedProductionFrame: 0,
    designatedTargetId: -1,
    designatedCommand: 'NONE',
    designatedCommandType: -1,
    designatedPositionX: 0,
    designatedPositionY: 0,
    designatedPositionZ: 0,
    nextLaunchWaveFrame,
    rampUpFrame,
    catapultSystemFrame,
    lowerRampFrame,
    rampUp,
    sourceRampUpXferFlags: Array.from({ length: profile.numRunways }, () => false),
    initialized: true,
  };

  // Don't produce initial payload on map-placed objects (they get populated separately).
  // C++ buildInfo creates units only when createUnits=true (default), which happens on first update.
}

export function flightDeckPurgeDead(self: GL, state: FlightDeckState): void {
  for (const space of state.parkingSpaces) {
    if (space.occupantId !== -1) {
      const obj = self.spawnedEntities.get(space.occupantId);
      if (!obj || obj.destroyed || obj.health <= 0) {
        space.occupantId = -1;
      }
    }
  }
  for (let i = 0; i < state.runwayTakeoffReservation.length; i++) {
    if (state.runwayTakeoffReservation[i] !== -1) {
      const obj = self.spawnedEntities.get(state.runwayTakeoffReservation[i]!);
      if (!obj || obj.destroyed || obj.health <= 0) {
        state.runwayTakeoffReservation[i] = -1;
      }
    }
    if (state.runwayLandingReservation[i] !== -1) {
      const obj = self.spawnedEntities.get(state.runwayLandingReservation[i]!);
      if (!obj || obj.destroyed || obj.health <= 0) {
        state.runwayLandingReservation[i] = -1;
      }
    }
  }
  const toRemove: number[] = [];
  for (const healeeId of state.healeeEntityIds) {
    const obj = self.spawnedEntities.get(healeeId);
    if (!obj || obj.destroyed || obj.health <= 0) {
      toRemove.push(healeeId);
    }
  }
  for (const id of toRemove) {
    state.healeeEntityIds.delete(id);
    state.healeeStates = state.healeeStates.filter((healee) => healee.entityId !== id);
  }
  if (state.healeeEntityIds.size === 0) {
    state.nextHealFrame = Number.POSITIVE_INFINITY;
  }
}

export function flightDeckHasReservedSpace(self: GL, state: FlightDeckState, entityId: number): boolean {
  if (entityId === -1) return false;
  for (const space of state.parkingSpaces) {
    if (space.occupantId === entityId) return true;
  }
  return false;
}

export function flightDeckFindEmptySpace(self: GL, state: FlightDeckState): FlightDeckParkingSpace | null {
  for (const space of state.parkingSpaces) {
    if (space.occupantId === -1) return space;
  }
  return null;
}

export function flightDeckReserveSpace(self: GL, state: FlightDeckState, entityId: number): boolean {
  // Check if already reserved.
  for (const space of state.parkingSpaces) {
    if (space.occupantId === entityId) return true;
  }
  // Find empty space.
  const empty = flightDeckFindEmptySpace(self, state);
  if (!empty) return false;
  empty.occupantId = entityId;
  return true;
}

export function flightDeckReleaseSpace(self: GL, state: FlightDeckState, entityId: number): void {
  for (const space of state.parkingSpaces) {
    if (space.occupantId === entityId) {
      space.occupantId = -1;
    }
  }
}

export function flightDeckReserveRunway(self: GL, 
  state: FlightDeckState, profile: FlightDeckProfile, entityId: number, forLanding: boolean,
): boolean {
  let runway = -1;

  if (!forLanding) {
    // Source parity: only look at front spaces for takeoff.
    for (let i = 0; i < profile.numRunways; i++) {
      if (state.parkingSpaces[i]?.occupantId === entityId) {
        runway = state.parkingSpaces[i]!.runway;
        break;
      }
    }
  } else {
    for (const space of state.parkingSpaces) {
      if (space.occupantId === entityId) {
        runway = space.runway;
        break;
      }
    }
  }

  if (runway === -1) return false;

  if (forLanding) {
    if (state.runwayLandingReservation[runway] === entityId) return true;
    if (state.runwayLandingReservation[runway] === -1) {
      state.runwayLandingReservation[runway] = entityId;
      return true;
    }
  } else {
    if (state.runwayTakeoffReservation[runway] === entityId) return true;
    if (state.runwayTakeoffReservation[runway] === -1) {
      state.runwayTakeoffReservation[runway] = entityId;
      return true;
    }
  }

  return false;
}

export function flightDeckReleaseRunway(self: GL, state: FlightDeckState, entityId: number): void {
  for (let i = 0; i < state.runwayTakeoffReservation.length; i++) {
    if (state.runwayTakeoffReservation[i] === entityId) {
      state.runwayTakeoffReservation[i] = -1;
    }
    if (state.runwayLandingReservation[i] === entityId) {
      state.runwayLandingReservation[i] = -1;
    }
  }
}

export function flightDeckHasAvailableSpace(self: GL, state: FlightDeckState): boolean {
  for (const space of state.parkingSpaces) {
    let id = space.occupantId;
    if (id !== -1) {
      const obj = self.spawnedEntities.get(id);
      if (!obj || obj.destroyed || obj.health <= 0) {
        id = -1;
      }
    }
    if (id === -1) return true;
  }
  return false;
}

export function flightDeckSetHealee(self: GL, state: FlightDeckState, healeeId: number, add: boolean): void {
  if (add) {
    if (state.healeeEntityIds.has(healeeId)) return;
    state.healeeEntityIds.add(healeeId);
    const existingState = state.healeeStates.find((healee) => healee.entityId === healeeId);
    if (existingState) {
      existingState.healStartFrame = Math.max(0, Math.trunc(self.frameCounter));
    } else {
      state.healeeStates.push({
        entityId: healeeId,
        healStartFrame: Math.max(0, Math.trunc(self.frameCounter)),
      });
    }
    if (state.healeeEntityIds.size === 1) {
      state.nextHealFrame = self.frameCounter + FLIGHT_DECK_HEAL_RATE_FRAMES;
    }
  } else {
    const deleted = state.healeeEntityIds.delete(healeeId);
    state.healeeStates = state.healeeStates.filter((healee) => healee.entityId !== healeeId);
    if (deleted && state.healeeEntityIds.size === 0) {
      state.nextHealFrame = Number.POSITIVE_INFINITY;
    }
  }
}

export function updateFlightDeck(self: GL): void {
  for (const carrier of self.spawnedEntities.values()) {
    const profile = carrier.flightDeckProfile;
    const state = carrier.flightDeckState;
    if (!profile || !state) continue;
    if (carrier.destroyed || carrier.health <= 0) continue;

    // Source parity: buildInfo + purgeDead every frame.
    flightDeckPurgeDead(self, state);

    const now = self.frameCounter;

    // ── Healing ──
    if (profile.healAmountPerSecond > 0 && state.healeeEntityIds.size > 0 && now >= state.nextHealFrame) {
      state.nextHealFrame = now + FLIGHT_DECK_HEAL_RATE_FRAMES;
      // Source parity: healAmount = HEAL_RATE_FRAMES * m_healAmount * SECONDS_PER_LOGICFRAME_REAL
      const healAmount = FLIGHT_DECK_HEAL_RATE_FRAMES * profile.healAmountPerSecond * (1 / LOGIC_FRAME_RATE);
      if (healAmount > 0) {
        const toRemove: number[] = [];
        for (const healeeId of state.healeeEntityIds) {
          const healee = self.spawnedEntities.get(healeeId);
          if (!healee || healee.destroyed || healee.health <= 0) {
            toRemove.push(healeeId);
            continue;
          }
          if (healee.health >= healee.maxHealth) continue;
          const prevHealth = healee.health;
          healee.health = Math.min(healee.maxHealth, healee.health + healAmount);
          if (healee.health > prevHealth) {
            self.clearPoisonFromEntity(healee);
            if (healee.minefieldProfile) {
              self.mineOnDamage(healee, carrier.id, 'HEALING');
            }
          }
        }
        for (const id of toRemove) {
          state.healeeEntityIds.delete(id);
        }
        if (state.healeeEntityIds.size === 0) {
          state.nextHealFrame = Number.POSITIVE_INFINITY;
        }
      }
    }

    // ── Cleanup / shuffle aircraft forward ──
    // Source parity: periodically promote aircraft to frontmost available spaces.
    if (now >= state.nextCleanupFrame) {
      state.nextCleanupFrame = now + profile.cleanupFrames;
      // Mark which runways have already been processed this sweep.
      const complete = new Set<number>();
      for (let spaceIdx = 0; spaceIdx < state.parkingSpaces.length; spaceIdx++) {
        const space = state.parkingSpaces[spaceIdx]!;
        const occupant = space.occupantId !== -1 ? self.spawnedEntities.get(space.occupantId) : null;
        const isAvailable = !occupant || occupant.destroyed || occupant.health <= 0
          || occupant.objectStatusFlags.has('AIRBORNE_TARGET');
        if (isAvailable) {
          // Look behind for an idle aircraft on the same runway to promote forward.
          let runwayCount = profile.numRunways;
          for (let tempIdx = spaceIdx + 1; tempIdx < state.parkingSpaces.length; tempIdx++) {
            if (runwayCount > 0) {
              runwayCount--;
              continue;
            }
            const tempSpace = state.parkingSpaces[tempIdx]!;
            if (complete.has(space.runway)) continue;
            if (tempSpace.runway !== space.runway) continue;
            const parkedJet = tempSpace.occupantId !== -1
              ? self.spawnedEntities.get(tempSpace.occupantId)
              : null;
            if (parkedJet && !parkedJet.destroyed && parkedJet.health > 0
                && !parkedJet.objectStatusFlags.has('AIRBORNE_TARGET')) {
              // Swap parking assignments.
              space.occupantId = parkedJet.id;
              tempSpace.occupantId = occupant ? occupant.id : -1;
              complete.add(space.runway);
              state.nextCleanupFrame = now + profile.humanFollowFrames;
            }
            break;
          }
        }
      }
    }

    // ── Replacement production ──
    // Source parity: if production timer expired, reset startedProductionFrame.
    if (state.nextAllowedProductionFrame <= now) {
      state.startedProductionFrame = Number.POSITIVE_INFINITY;
    }
    // Source parity: find first empty space and queue production.
    for (const space of state.parkingSpaces) {
      if (space.occupantId === -1) {
        // Queue replacement if not already producing.
        if (carrier.productionQueue.length === 0
            && now >= state.nextAllowedProductionFrame
            && profile.payloadTemplateName) {
          // Source parity: ProductionUpdate::queueCreateUnit.
          // We don't directly queue production here (that would need the full production system),
          // but we track the timing for source parity.
          state.startedProductionFrame = now;
          state.nextAllowedProductionFrame = now + profile.replacementFrames + profile.dockAnimationFrames;
        }
        break; // Only handle one empty space per frame.
      }
    }

    // ── Set NO_ATTACK status based on aircraft presence ──
    let hasAircraft = false;
    for (const space of state.parkingSpaces) {
      if (space.occupantId !== -1) {
        hasAircraft = true;
        break;
      }
    }
    if (!hasAircraft) {
      carrier.objectStatusFlags.add('NO_ATTACK');
    } else {
      carrier.objectStatusFlags.delete('NO_ATTACK');
    }

    // ── Catapult launch sequence ──
    // Source parity: for each runway, check if front space has a jet ready to launch.
    for (let i = 0; i < profile.numRunways; i++) {
      const frontSpace = state.parkingSpaces[i];
      if (!frontSpace) continue;
      const jet = frontSpace.occupantId !== -1
        ? self.spawnedEntities.get(frontSpace.occupantId)
        : null;
      const jetReady = jet && !jet.destroyed && jet.health > 0
        && !jet.objectStatusFlags.has('AIRBORNE_TARGET')
        && state.designatedCommand !== 'NONE' && state.designatedCommand !== 'IDLE';
      if (jetReady && (state.nextLaunchWaveFrame[i] ?? 0) <= now) {
        // Ramp-up phase.
        if (!state.rampUp[i]) {
          state.rampUp[i] = true;
          state.rampUpFrame[i] = now + profile.launchRampFrames;
          state.lowerRampFrame[i] = Number.POSITIVE_INFINITY;
          // Source parity: set DOOR_OPENING model condition for this runway.
          carrier.modelConditionFlags.add(`DOOR_${i + 2}_OPENING`);
          carrier.modelConditionFlags.delete(`DOOR_${i + 2}_CLOSING`);
        }
        // Launch when ramp is fully up.
        if (state.rampUp[i] && (state.rampUpFrame[i] ?? 0) <= now) {
          // Source parity: propagateOrderToSpecificPlane + set wave/catapult timers.
          state.nextLaunchWaveFrame[i] = now + profile.launchWaveFrames;
          state.catapultSystemFrame[i] = now + profile.catapultFireFrames;
          state.lowerRampFrame[i] = now + profile.lowerRampFrames;
          // Mark jet as launched — set airborne.
          jet!.objectStatusFlags.add('AIRBORNE_TARGET');
          // Release the parking space.
          frontSpace.occupantId = -1;
          // Release runway reservation.
          if (state.runwayTakeoffReservation[i] === jet!.id) {
            state.runwayTakeoffReservation[i] = -1;
          }
          // Remove from healing.
          flightDeckSetHealee(self, state, jet!.id, false);
        }
      }

      // Source parity: catapult particle system timer (visual only — tracked for state parity).
      if ((state.catapultSystemFrame[i] ?? Number.POSITIVE_INFINITY) <= now) {
        state.catapultSystemFrame[i] = Number.POSITIVE_INFINITY;
        // Source parity: would fire catapult particle here — visual-only effect.
      }

      // Source parity: lower ramp after fighter launched.
      if (state.rampUp[i] && (state.lowerRampFrame[i] ?? Number.POSITIVE_INFINITY) <= now) {
        state.rampUp[i] = false;
        carrier.modelConditionFlags.delete(`DOOR_${i + 2}_OPENING`);
        carrier.modelConditionFlags.add(`DOOR_${i + 2}_CLOSING`);
      }
    }
  }
}

export function onFlightDeckDie(self: GL, entity: MapEntity): void {
  const state = entity.flightDeckState;
  if (!state) return;

  for (const space of state.parkingSpaces) {
    if (space.occupantId !== -1) {
      const aircraft = self.spawnedEntities.get(space.occupantId);
      if (!aircraft || aircraft.destroyed || aircraft.health <= 0) continue;
      // Source parity: skip aircraft that are airborne and not in takeoff/landing.
      // For simplicity, only kill non-airborne aircraft (matching C++ isAboveTerrain check).
      if (aircraft.objectStatusFlags.has('AIRBORNE_TARGET')) continue;
      // Source parity: obj->kill() — apply lethal damage.
      self.applyWeaponDamageAmount(entity.id, aircraft, aircraft.maxHealth, 'UNRESISTABLE');
    }
  }

  // Clear state.
  for (const space of state.parkingSpaces) {
    space.occupantId = -1;
  }
  state.healeeEntityIds.clear();
  state.nextHealFrame = Number.POSITIVE_INFINITY;
}
