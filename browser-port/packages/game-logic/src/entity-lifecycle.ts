// @ts-nocheck — self is typed as any; real safety comes from the test suite.
/**
 * Entity lifecycle — death pipeline, slow death, victory conditions.
 *
 * Source parity: System/GameLogic.cpp, Object/Die/, SlowDeathBehavior.cpp
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { MAP_XY_FACTOR, MAP_HEIGHT_SCALE } from '@generals/terrain';
import { getExperienceValue as getExperienceValueImpl, addExperiencePoints as addExperiencePointsImpl } from './experience.js';
import { findObjectDefByName } from './registry-lookups.js';
import { readStringField } from './ini-readers.js';
import {
  RELATIONSHIP_ALLIES,
  LOGIC_FRAME_RATE,
  SLOW_DEATH_BEGIN_MIDPOINT_RATIO,
  SLOW_DEATH_END_MIDPOINT_RATIO,
  HELICOPTER_GRAVITY,
} from './index.js';
type GL = any;

// ---- Entity lifecycle implementations ----

export function createCraterInTerrain(self: GL, entity: MapEntity): void {
  const heightmap = self.mapHeightmap;
  if (!heightmap) {
    return;
  }
  const objectDef = self.resolveObjectDefByTemplateName(entity.templateName);
  if (objectDef && self.isSmallGeometry(objectDef.fields)) {
    return;
  }

  const radius = entity.geometryMajorRadius;
  if (!(radius > 0)) {
    return;
  }

  const minCellX = Math.floor((entity.x - radius) / MAP_XY_FACTOR);
  const maxCellX = Math.floor((entity.x + radius) / MAP_XY_FACTOR);
  const maxCellZ = Math.floor((entity.z + radius) / MAP_XY_FACTOR);

  for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
    // Source parity: C++ currently iterates 0..maxY here (not minY..maxY).
    for (let cellZ = 0; cellZ <= maxCellZ; cellZ += 1) {
      if (cellX < 0 || cellX >= heightmap.width || cellZ < 0 || cellZ >= heightmap.height) {
        continue;
      }

      const deltaX = (cellX * MAP_XY_FACTOR) - entity.x;
      const deltaZ = (cellZ * MAP_XY_FACTOR) - entity.z;
      const distance = Math.sqrt((deltaX * deltaX) + (deltaZ * deltaZ));
      if (distance >= radius) {
        continue;
      }

      const displacementAmount = radius * (1 - distance / radius);
      const index = cellZ * heightmap.width + cellX;
      const currentRawHeight = heightmap.rawData[index] ?? 0;
      const targetRawHeight = Math.max(1, Math.trunc(currentRawHeight - displacementAmount));
      heightmap.rawData[index] = targetRawHeight;
      heightmap.worldHeights[index] = targetRawHeight * MAP_HEIGHT_SCALE;
    }
  }
}

export function onObjectDestroyed(self: GL, entityId: number): boolean {
  const segmentId = self.bridgeSegmentByControlEntity.get(entityId);
  if (segmentId === undefined) {
    return false;
  }
  return self.setBridgeSegmentPassable(segmentId, false);
}

export function addEntityDestroyedScore(self: GL, victim: MapEntity, attackerId: number): void {
  if (!self.scriptScoringEnabled) return;
  const victimSide = self.normalizeSide(victim.side);
  const isBuilding = victim.kindOf.has('STRUCTURE');

  // Victim side: lost
  if (victimSide && !self.sideScoreScreenExcluded.has(victimSide)) {
    const victimScore = self.getOrCreateSideScoreState(victimSide);
    if (isBuilding) {
      victimScore.structuresLost += 1;
    } else {
      victimScore.unitsLost += 1;
    }
  }

  // Attacker side: destroyed
  const attacker = attackerId > 0 ? self.spawnedEntities.get(attackerId) : null;
  const attackerSide = attacker ? self.normalizeSide(attacker.side) : null;
  if (attackerSide && attackerSide !== victimSide && !self.sideScoreScreenExcluded.has(attackerSide)) {
    const attackerScore = self.getOrCreateSideScoreState(attackerSide);
    if (isBuilding) {
      attackerScore.structuresDestroyed += 1;
    } else {
      attackerScore.unitsDestroyed += 1;
    }
  }
}

export function recordDestroyedBuildingBySource(self: GL, victim: MapEntity, attackerId: number): void {
  if (!victim.kindOf.has('STRUCTURE')) {
    return;
  }
  if (!Number.isFinite(attackerId) || attackerId <= 0) {
    return;
  }
  const attacker = self.spawnedEntities.get(Math.trunc(attackerId));
  if (!attacker || attacker.destroyed) {
    return;
  }

  const victimSide = self.normalizeSide(victim.side);
  const attackerSide = self.normalizeSide(attacker.side);
  if (!victimSide || !attackerSide) {
    return;
  }
  self.incrementNestedScriptCounter(self.sideDestroyedBuildingsByAttacker, attackerSide, victimSide);

  const attackerToken = self.resolveEntityControllingPlayerTokenForAffiliation(attacker);
  const victimToken = self.resolveEntityControllingPlayerTokenForAffiliation(victim);
  if (!attackerToken || !victimToken) {
    return;
  }
  self.incrementNestedScriptCounter(
    self.controllingPlayerDestroyedBuildingsByAttacker,
    attackerToken,
    victimToken,
  );
}

export function executeUpgradeDieModules(self: GL, entity: MapEntity): void {
  for (const prof of entity.upgradeDieProfiles) {
    // Apply DieMuxData filtering.
    if (prof.deathTypes !== null && prof.deathTypes.size > 0) {
      if (!prof.deathTypes.has(entity.pendingDeathType)) continue;
    }
    // ExemptStatus — entity must NOT have any of these flags.
    let exempt = false;
    for (const status of prof.exemptStatus) {
      if (entity.objectStatusFlags.has(status)) { exempt = true; break; }
    }
    if (exempt) continue;
    // RequiredStatus — entity must have ALL of these flags.
    let missingRequired = false;
    for (const status of prof.requiredStatus) {
      if (!entity.objectStatusFlags.has(status)) { missingRequired = true; break; }
    }
    if (missingRequired) continue;

    // Find producer and remove upgrade.
    if (entity.producerEntityId === 0) continue;
    const producer = self.spawnedEntities.get(entity.producerEntityId);
    if (!producer || producer.destroyed) continue;
    if (producer.completedUpgrades.has(prof.upgradeName)) {
      self.removeEntityUpgrade(producer, prof.upgradeName);
    }
  }
}

export function tryCreateRebuildHoleOnDeath(self: GL, entity: MapEntity, _attackerId: number): void {
  const profile = entity.rebuildHoleExposeDieProfile;
  if (!profile) return;

  // Source parity: no hole if building was still under construction.
  if (entity.objectStatusFlags.has('UNDER_CONSTRUCTION')) return;
  // Source parity: no hole if player is neutral or inactive.
  if (!entity.side) return;
  const side = self.normalizeSide(entity.side);
  const controllingPlayerToken = self.normalizeControllingPlayerToken(entity.controllingPlayerToken ?? undefined);
  const playerType = (
    controllingPlayerToken != null
      ? self.sidePlayerTypes.get(controllingPlayerToken)
      : undefined
  ) ?? (side ? self.sidePlayerTypes.get(side) : undefined);
  if (!playerType) return;

  const registry = self.iniDataRegistry;
  if (!registry) return;

  // Spawn the hole object at the building's position with the building's orientation.
  const hole = self.spawnEntityFromTemplate(
    profile.holeName,
    entity.x,
    entity.z,
    entity.rotationY,
    entity.side,
  );
  if (!hole) return;

  // Source parity: set hole max health from profile.
  if (profile.holeMaxHealth > 0) {
    hole.maxHealth = profile.holeMaxHealth;
    hole.initialHealth = profile.holeMaxHealth;
    hole.health = profile.holeMaxHealth;
    hole.canTakeDamage = true;
  }

  // Source parity: copy geometry info from building to hole (preserves pathfinding footprint).
  if (entity.obstacleGeometry) {
    hole.obstacleGeometry = { ...entity.obstacleGeometry };
  }

  // Source parity: RebuildHoleBehavior::startRebuildProcess — store rebuild template
  // and start the worker respawn timer.
  if (hole.rebuildHoleProfile) {
    hole.rebuildHoleSpawnerEntityId = entity.id;
    hole.rebuildHoleRebuildTemplateName = entity.templateName;
    // Start worker respawn countdown.
    hole.rebuildHoleWorkerWaitCounter = hole.rebuildHoleProfile.workerRespawnDelay;
  }

  // Source parity: TransferAttackers — redirect all AI attacks from building to hole.
  if (profile.transferAttackers) {
    for (const other of self.spawnedEntities.values()) {
      if (other.destroyed || other.id === entity.id) continue;
      if (other.attackTargetEntityId === entity.id) {
        other.attackTargetEntityId = hole.id;
      }
    }
  }
}

export function tryGenerateMinefieldOnDeath(self: GL, entity: MapEntity): void {
  const profile = entity.generateMinefieldProfile;
  if (!profile || entity.generateMinefieldDone) return;
  if (!profile.generateOnlyOnDeath) return;
  entity.generateMinefieldDone = true;

  const registry = self.iniDataRegistry;
  if (!registry) return;
  const mineObjDef = findObjectDefByName(registry, profile.mineName);
  if (!mineObjDef) return;

  // Source parity: get mine radius from geometry for spacing.
  const mineGeom = self.resolveObstacleGeometry(mineObjDef);
  const mineRadius = mineGeom
    ? Math.max(mineGeom.majorRadius, mineGeom.minorRadius)
    : MAP_XY_FACTOR * 0.5;
  const mineDiameter = Math.max(1, mineRadius * 2);

  const radius = profile.distanceAroundObject;
  if (radius <= 0) return;

  // Source parity: circular border placement.
  const circumference = 2 * Math.PI * radius;
  const numMines = Math.max(1, Math.ceil(circumference / mineDiameter));
  const angleInc = (2 * Math.PI) / numMines;

  for (let i = 0; i < numMines; i++) {
    const angle = i * angleInc;
    const mineX = entity.x + radius * Math.cos(angle);
    const mineZ = entity.z + radius * Math.sin(angle);
    const rotation = self.gameRandom.nextFloat() * Math.PI * 2 - Math.PI;
    self.spawnEntityFromTemplate(profile.mineName, mineX, mineZ, rotation, entity.side);
  }
}

export function trySpawnCrateOnDeath(self: GL, entity: MapEntity, attackerId: number): void {
  const profile = entity.createCrateDieProfile;
  if (!profile) return;

  // Source parity: no crate for killing allies.
  if (attackerId >= 0) {
    const attacker = self.spawnedEntities.get(attackerId);
    if (attacker && self.getEntityRelationship(attacker.id, entity.id) === 'allies') {
      return;
    }
  }

  // Source parity: findPositionAround with maxRadius=5 (circular distribution).
  const angle = self.gameRandom.nextFloat() * Math.PI * 2;
  const radius = self.gameRandom.nextFloat() * 5;
  const offsetX = Math.cos(angle) * radius;
  const offsetZ = Math.sin(angle) * radius;
  const crateX = entity.x + offsetX;
  const crateZ = entity.z + offsetZ;
  const rotation = self.gameRandom.nextFloat() * Math.PI * 2 - Math.PI;

  self.spawnEntityFromTemplate(profile.crateTemplateName, crateX, crateZ, rotation, entity.side);
}

export function tryBeginUndeadSecondLifeSlowDeathVisual(self: GL, entity: MapEntity): boolean {
  if (entity.destroyed || entity.slowDeathState || entity.structureCollapseState) {
    return false;
  }
  if (entity.slowDeathProfiles.length === 0) {
    return false;
  }

  const candidates: { index: number; weight: number }[] = [];
  for (let i = 0; i < entity.slowDeathProfiles.length; i += 1) {
    const profile = entity.slowDeathProfiles[i]!;
    if (!isSlowDeathApplicable(self, entity, profile)) {
      continue;
    }
    candidates.push({
      index: i,
      weight: Math.max(1, profile.probabilityModifier),
    });
  }
  if (candidates.length === 0) {
    return false;
  }

  const totalWeight = candidates.reduce((sum, candidate) => sum + candidate.weight, 0);
  let roll = self.gameRandom.nextRange(1, totalWeight);
  let selectedIndex = candidates[0]!.index;
  for (const candidate of candidates) {
    roll -= candidate.weight;
    if (roll <= 0) {
      selectedIndex = candidate.index;
      break;
    }
  }

  const profile = entity.slowDeathProfiles[selectedIndex]!;
  const sinkDelay = profile.sinkDelay + (profile.sinkDelayVariance > 0
    ? self.gameRandom.nextRange(0, profile.sinkDelayVariance) : 0);
  const destructionDelay = profile.destructionDelay + (profile.destructionDelayVariance > 0
    ? self.gameRandom.nextRange(0, profile.destructionDelayVariance) : 0);
  const sinkFrame = self.frameCounter + sinkDelay;
  const destructionFrame = self.frameCounter + Math.max(1, destructionDelay);
  const midpointBegin = Math.floor(destructionDelay * SLOW_DEATH_BEGIN_MIDPOINT_RATIO);
  const midpointEnd = Math.floor(destructionDelay * SLOW_DEATH_END_MIDPOINT_RATIO);
  const midpointFrame = self.frameCounter + (midpointBegin < midpointEnd
    ? self.gameRandom.nextRange(midpointBegin, midpointEnd)
    : midpointBegin);

  entity.slowDeathState = {
    profileIndex: selectedIndex,
    sinkFrame,
    midpointFrame,
    destructionFrame,
    midpointExecuted: false,
    destroyOnCompletion: false,
    flingVelocityX: 0,
    flingVelocityY: 0,
    flingVelocityZ: 0,
    isFlung: false,
    hasBounced: false,
    isBattleBusFakeDeath: false,
    battleBusThrowVelocity: 0,
    battleBusLandingCheckFrame: 0,
    battleBusEmptyHulkDestroyFrame: 0,
  };

  executeSlowDeathPhase(self, entity, profile, 0); // INITIAL
  return true;
}

export function tryBeginSlowDeath(self: GL, entity: MapEntity, _attackerId: number): boolean {
  if (entity.slowDeathProfiles.length === 0) return false;

  // Collect applicable profiles with their weights.
  const candidates: { index: number; weight: number }[] = [];
  for (let i = 0; i < entity.slowDeathProfiles.length; i++) {
    const profile = entity.slowDeathProfiles[i]!;
    if (!isSlowDeathApplicable(self, entity, profile)) continue;
    // Source parity: overkill bonus = (overkillDamage / maxHealth) * bonusPerOverkillPercent.
    // C++ uses fraction (0.0–1.0+), not percentage. Simplified: overkill = -health.
    const overkillFraction = entity.maxHealth > 0 ? -entity.health / entity.maxHealth : 0;
    const overkillBonus = Math.floor(overkillFraction * profile.modifierBonusPerOverkillPercent);
    const weight = Math.max(1, profile.probabilityModifier + overkillBonus);
    candidates.push({ index: i, weight });
  }
  if (candidates.length === 0) return false;

  // Source parity: weighted random selection among applicable profiles.
  const totalWeight = candidates.reduce((sum, c) => sum + c.weight, 0);
  let roll = self.gameRandom.nextRange(1, totalWeight);
  let selectedIndex = candidates[0]!.index;
  for (const candidate of candidates) {
    roll -= candidate.weight;
    if (roll <= 0) {
      selectedIndex = candidate.index;
      break;
    }
  }

  const profile = entity.slowDeathProfiles[selectedIndex]!;

  // Calculate frame timings.
  const hulkOverrideActive = entity.kindOf.has('HULK') && self.scriptHulkLifetimeOverrideFrames !== -1;
  let sinkFrame: number;
  let midpointFrame: number;
  let destructionFrame: number;
  if (hulkOverrideActive) {
    // Source parity: SlowDeathBehavior::onDie uses fixed rapid timing when hulk override is active.
    sinkFrame = self.frameCounter + 1;
    midpointFrame = self.frameCounter + Math.floor(LOGIC_FRAME_RATE / 2) + 1;
    destructionFrame = self.frameCounter + LOGIC_FRAME_RATE + 1;
  } else {
    const sinkDelay = profile.sinkDelay + (profile.sinkDelayVariance > 0
      ? self.gameRandom.nextRange(0, profile.sinkDelayVariance) : 0);
    const destructionDelay = profile.destructionDelay + (profile.destructionDelayVariance > 0
      ? self.gameRandom.nextRange(0, profile.destructionDelayVariance) : 0);
    sinkFrame = self.frameCounter + sinkDelay;
    destructionFrame = self.frameCounter + Math.max(1, destructionDelay);

    // Source parity: midpoint is randomly placed between 35-65% of destruction time.
    const midpointBegin = Math.floor(destructionDelay * SLOW_DEATH_BEGIN_MIDPOINT_RATIO);
    const midpointEnd = Math.floor(destructionDelay * SLOW_DEATH_END_MIDPOINT_RATIO);
    midpointFrame = self.frameCounter + (midpointBegin < midpointEnd
      ? self.gameRandom.nextRange(midpointBegin, midpointEnd) : midpointBegin);
  }

  entity.slowDeathState = {
    profileIndex: selectedIndex,
    sinkFrame,
    midpointFrame,
    destructionFrame,
    midpointExecuted: false,
    destroyOnCompletion: true,
    flingVelocityX: 0,
    flingVelocityY: 0,
    flingVelocityZ: 0,
    isFlung: false,
    hasBounced: false,
    isBattleBusFakeDeath: false,
    battleBusThrowVelocity: 0,
    battleBusLandingCheckFrame: 0,
    battleBusEmptyHulkDestroyFrame: 0,
  };

  // Source parity: BattleBusSlowDeathBehavior — two-phase death.
  // Phase 1 (fake death): throw vertically, damage passengers, land as SECOND_LIFE hulk.
  // Phase 2 (real death): delegate to normal SlowDeath.
  if (profile.isBattleBus && !entity.modelConditionFlags.has('SECOND_LIFE')) {
    entity.slowDeathState!.isBattleBusFakeDeath = true;
    entity.slowDeathState!.battleBusThrowVelocity = profile.throwForce / LOGIC_FRAME_RATE;
    entity.slowDeathState!.battleBusLandingCheckFrame = self.frameCounter + 10;
    entity.slowDeathState!.destroyOnCompletion = false;

    // Damage passengers by percentage.
    if (profile.percentDamageToPassengers > 0) {
      // C++ parity: damage is percentage of EACH PASSENGER's maxHealth, not the bus's.
      const damagePercent = profile.percentDamageToPassengers / 100;
      const containedIds = self.collectContainedEntityIds(entity.id);
      for (const passengerId of containedIds) {
        const passenger = self.spawnedEntities.get(passengerId);
        if (passenger && !passenger.destroyed) {
          const passengerDamage = passenger.maxHealth * damagePercent;
          self.applyWeaponDamageAmount(entity.id, passenger, passengerDamage, 'CRUSH', 'CRUSHED');
        }
      }
    }

    // Execute INITIAL phase effects, then return — skip the normal death AI teardown.
    executeSlowDeathPhase(self, entity, profile, 0);
    return true;
  }

  // Source parity: SlowDeathBehavior::calcRandomForce — fling physics.
  // C++ ref: SlowDeathBehavior.cpp:271-314 — random angle, pitch, magnitude → XYZ velocity.
  if (profile.flingForce > 0) {
    const angle = self.gameRandom.nextFloat() * Math.PI * 2 - Math.PI; // [-PI, PI]
    // C++ parity: pitch is sampled from [flingPitch, flingPitch + flingPitchVariance] (one-sided).
    const pitch = profile.flingPitch + (profile.flingPitchVariance > 0
      ? self.gameRandom.nextFloat() * profile.flingPitchVariance : 0);
    const magnitude = profile.flingForce + (profile.flingForceVariance > 0
      ? self.gameRandom.nextFloat() * profile.flingForceVariance : 0);
    const horizontalMag = Math.cos(pitch) * magnitude;
    entity.slowDeathState!.flingVelocityX = Math.cos(angle) * horizontalMag / LOGIC_FRAME_RATE;
    entity.slowDeathState!.flingVelocityY = Math.sin(pitch) * magnitude / LOGIC_FRAME_RATE;
    entity.slowDeathState!.flingVelocityZ = Math.sin(angle) * horizontalMag / LOGIC_FRAME_RATE;
    entity.slowDeathState!.isFlung = true;
    entity.explodedState = 'FLAILING';
  }

  // Source parity: mark AI as dead — prevent further combat, production, movement.
  entity.animationState = 'DIE';
  entity.canTakeDamage = false;
  entity.attackTargetEntityId = null;
  entity.attackTargetPosition = null;
  entity.attackOriginalVictimPosition = null;
  entity.attackCommandSource = 'AI';
  entity.attackSubState = 'IDLE';
  entity.moving = false;
  entity.moveTarget = null;
  entity.movePath = [];
  entity.pathIndex = 0;
  entity.pathfindGoalCell = null;

  // Unregister energy while dying.
  self.unregisterEntityEnergy(entity);
  // Cancel production and pending actions.
  self.cancelEntityCommandPathActions(entity.id);
  cancelAndRefundAllProductionOnDeath(self, entity);

  // Source parity: deselect for all players.
  entity.selected = false;

  // Execute INITIAL phase.
  executeSlowDeathPhase(self, entity, profile, 0);

  // Source parity: NeutronMissileSlowDeathBehavior — initialize blast state when slow death activates.
  if (entity.neutronMissileSlowDeathProfile) {
    const nmProfile = entity.neutronMissileSlowDeathProfile;
    entity.neutronMissileSlowDeathState = {
      activationFrame: 0, // Will be set to actual frame on first update tick.
      completedBlasts: nmProfile.blasts.map(() => false),
      completedScorchBlasts: nmProfile.blasts.map(() => false),
    };
  }

  // Source parity: HelicopterSlowDeathBehavior — initialize spiral crash state.
  if (entity.helicopterSlowDeathProfiles.length > 0) {
    // Find first applicable helicopter death profile.
    for (let hpi = 0; hpi < entity.helicopterSlowDeathProfiles.length; hpi++) {
      const heliProfile = entity.helicopterSlowDeathProfiles[hpi]!;
      if (!isDieModuleApplicable(self, entity, heliProfile)) continue;
      entity.helicopterSlowDeathState = {
        forwardAngle: entity.rotationY,
        forwardSpeed: heliProfile.spiralOrbitForwardSpeed,
        verticalVelocity: 0,
        selfSpin: heliProfile.minSelfSpin,
        selfSpinTowardsMax: true,
        lastSelfSpinUpdateFrame: self.frameCounter,
        orbitDirection: 1, // Always left (C++ line 213).
        hitGroundFrame: 0,
        profileIndex: hpi,
      };
      break;
    }
  }

  // Source parity: JetSlowDeathBehavior — initialize jet crash state.
  // C++ onDie: if on ground → instant destroy with ground OCL; if airborne → slow death.
  if (entity.jetSlowDeathProfiles.length > 0) {
    for (let jpi = 0; jpi < entity.jetSlowDeathProfiles.length; jpi++) {
      const jetProfile = entity.jetSlowDeathProfiles[jpi]!;
      if (!isDieModuleApplicable(self, entity, jetProfile)) continue;

      // C++ parity: isSignificantlyAboveTerrain check (height > 9.0).
      const terrainY = self.resolveGroundHeight(entity.x, entity.z) + entity.baseHeight;
      const heightAbove = entity.y - terrainY;

      if (heightAbove <= 9.0) {
        // On ground: instant destroy with ground OCL (C++ line 157-169).
        // C++ calls destroyObject directly — does NOT go through SlowDeathBehavior.
        for (const oclName of jetProfile.oclOnGroundDeath) {
          self.executeOCL(oclName, entity, undefined, entity.x, entity.z);
        }
        // Immediate destruction — C++ parity: TheGameLogic->destroyObject(us).
        entity.slowDeathState = null;
        markEntityDestroyed(self, entity.id, -1);
      } else {
        // Airborne: initialize jet slow death state (C++ beginSlowDeath lines 185-221).
        entity.jetSlowDeathState = {
          deathFrame: self.frameCounter,
          groundFrame: 0,
          rollRate: jetProfile.rollRate,
          rollAngle: 0,
          pitchAngle: 0,
          forwardSpeed: entity.currentSpeed > 0 ? entity.currentSpeed / LOGIC_FRAME_RATE : entity.speed / LOGIC_FRAME_RATE,
          forwardAngle: entity.rotationY,
          verticalVelocity: 0,
          secondaryExecuted: false,
          profileIndex: jpi,
        };

        // Execute initial death OCLs (C++ line 193-194).
        for (const oclName of jetProfile.oclInitialDeath) {
          self.executeOCL(oclName, entity, undefined, entity.x, entity.z);
        }
      }
      break;
    }
  }

  return true;
}

export function isSlowDeathApplicable(self: GL, entity: MapEntity, profile: SlowDeathProfile): boolean {
  return isDieModuleApplicable(self, entity, profile);
}

export function executeSlowDeathPhase(self: GL, entity: MapEntity, profile: SlowDeathProfile, phaseIndex: number): void {
  // Execute ONE random OCL from this phase's list.
  const oclList = profile.phaseOCLs[phaseIndex as 0 | 1 | 2];
  if (oclList && oclList.length > 0) {
    const idx = oclList.length === 1 ? 0 : self.gameRandom.nextRange(0, oclList.length - 1);
    self.executeOCL(oclList[idx]!, entity);
  }

  // Fire ONE random weapon from this phase's list.
  const weaponList = profile.phaseWeapons[phaseIndex as 0 | 1 | 2];
  if (weaponList && weaponList.length > 0) {
    const idx = weaponList.length === 1 ? 0 : self.gameRandom.nextRange(0, weaponList.length - 1);
    const weaponName = weaponList[idx]!;
    const weaponDef = self.iniDataRegistry?.getWeapon(weaponName);
    if (weaponDef) {
      self.fireTemporaryWeaponAtPosition(entity, weaponDef, entity.x, entity.z);
    }
  }
}

export function updateLifetimeEntities(self: GL): void {
  for (const entity of self.spawnedEntities.values()) {
    if (entity.destroyed || entity.slowDeathState || entity.structureCollapseState) continue;
    if (entity.lifetimeDieFrame === null) continue;
    if (self.frameCounter < entity.lifetimeDieFrame) continue;
    // Source parity: kill() applies DAMAGE_UNRESISTABLE at maxHealth amount.
    // This triggers the normal death pipeline (SlowDeath, death OCLs, etc.).
    self.applyWeaponDamageAmount(null, entity, entity.maxHealth, 'UNRESISTABLE');
  }
}

export function updateDeletionEntities(self: GL): void {
  for (const entity of self.spawnedEntities.values()) {
    if (entity.destroyed) continue;
    if (entity.deletionDieFrame === null) continue;
    if (self.frameCounter < entity.deletionDieFrame) continue;
    // Source parity: destroyObject — instant silent removal (NOT kill).
    silentDestroyEntity(self, entity.id);
  }
}

export function updateHeightDieEntities(self: GL): void {
  for (const entity of self.spawnedEntities.values()) {
    if (entity.destroyed || entity.slowDeathState || entity.structureCollapseState) continue;
    const prof = entity.heightDieProfile;
    if (!prof) continue;

    // Source parity: skip if contained (inside transport).
    // C++ line 131: m_lastPosition is still updated while contained.
    if (self.isEntityContained(entity)) {
      entity.heightDieLastY = entity.y;
      continue;
    }

    // Source parity: InitialDelay — don't check until delay expires.
    if (entity.heightDieActiveFrame === 0) {
      entity.heightDieActiveFrame = self.frameCounter + prof.initialDelayFrames;
      entity.heightDieLastY = entity.y;
    }
    if (self.frameCounter < entity.heightDieActiveFrame) continue;

    // Source parity: HeightDieUpdate.cpp:144-154 — OnlyWhenMovingDown check.
    // If entity is not moving downward, skip the height-death check but NOT the lastY update.
    const currentY = entity.y;
    let directionOK = true;
    if (prof.onlyWhenMovingDown && currentY >= entity.heightDieLastY) {
      directionOK = false;
    }

    // Source parity: calculate height above terrain/layer.
    let terrainY = self.resolveGroundHeight(entity.x, entity.z);
    let targetHeight = terrainY + prof.targetHeight;

    // Source parity: HeightDieUpdate.cpp:160-221 — TargetHeightIncludesStructures
    // raises targetHeight based on bridge layers and nearby STRUCTURE entities.
    if (prof.targetHeightIncludesStructures) {
      // Source parity: HeightDieUpdate.cpp lines 160-169
      // TerrainLogic::getHighestLayerForDestination + getLayerHeight.
      const layerHeight = self.resolveHighestBridgeLayerHeightForDestination(
        entity.x,
        entity.z,
        entity.y,
      );
      if (layerHeight !== null && layerHeight > terrainY) {
        terrainY = layerHeight;
        targetHeight = terrainY + prof.targetHeight;
      }

      // Scan nearby structures and raise target height above the tallest one.
      // C++ uses getBoundingCircleRadius(): SPHERE/CYLINDER=majorRadius, BOX=sqrt(major²+minor²).
      const geom = entity.obstacleGeometry;
      let scanRange: number;
      if (!geom) {
        scanRange = entity.baseHeight;
      } else if (geom.shape === 'box') {
        scanRange = Math.sqrt(geom.majorRadius * geom.majorRadius + geom.minorRadius * geom.minorRadius);
      } else {
        scanRange = geom.majorRadius;
      }
      const scanRangeSqr = scanRange * scanRange;
      let tallestStructureHeight = 0;
      for (const candidate of self.spawnedEntities.values()) {
        if (candidate.id === entity.id || candidate.destroyed) continue;
        if (!candidate.kindOf.has('STRUCTURE')) continue;
        const dx = candidate.x - entity.x;
        const dz = candidate.z - entity.z;
        if (dx * dx + dz * dz > scanRangeSqr) continue;
        const structHeight = candidate.obstacleGeometry?.height ?? 0;
        if (structHeight > tallestStructureHeight) {
          tallestStructureHeight = structHeight;
        }
      }
      if (tallestStructureHeight > prof.targetHeight) {
        targetHeight = tallestStructureHeight + terrainY;
      }
    }

    // Source parity: C++ line 224 — death check gated on directionOK.
    if (directionOK) {
      // Source parity: C++ uses raw pos->z (entity.y), not adjusted by baseHeight.
      if (entity.y < targetHeight) {
        // Source parity: C++ line 229 — snap if configured, or if entity position is below terrain.
        // C++ compares pos->z (raw entity position) against terrainHeightAtPos (not minus baseHeight).
        if (prof.snapToGroundOnDeath || entity.y < terrainY) {
          entity.y = terrainY + entity.baseHeight;
        }
        // Source parity: kill via UNRESISTABLE damage (same as LifetimeUpdate).
        self.applyWeaponDamageAmount(null, entity, entity.maxHealth, 'UNRESISTABLE');
      }
    }

    // Source parity: C++ line 266 — always update lastPosition at end of update.
    entity.heightDieLastY = currentY;
  }
}

export function updateStickyBombs(self: GL): void {
  for (const bomb of self.spawnedEntities.values()) {
    if (bomb.destroyed || !bomb.stickyBombProfile || bomb.stickyBombTargetId === 0) continue;

    const target = self.spawnedEntities.get(bomb.stickyBombTargetId);
    if (!target || target.destroyed) {
      // C++ parity: if target dies, destroy bomb silently (detonation handled
      // by checkAndDetonateBoobyTrap in the target's death path).
      silentDestroyEntity(self, bomb.id);
      continue;
    }

    // Track target position.
    if (target.kindOf.has('IMMOBILE')) {
      // Buildings: keep bomb at current XZ, ground level (for mine-clearing units).
      // Z is unchanged — stays where initially placed.
    } else {
      // Mobile targets: follow target position + offsetZ.
      bomb.x = target.x;
      bomb.z = target.z;
      // bomb.y would be target.y + offsetZ if we had vertical positioning.
    }
  }
}

export function silentDestroyEntity(self: GL, entityId: number): void {
  const entity = self.spawnedEntities.get(entityId);
  if (!entity || entity.destroyed) return;

  // Still unregister energy and clean up references.
  self.unregisterEntityEnergy(entity);
  self.cancelEntityCommandPathActions(entityId);
  self.railedTransportStateByEntityId.delete(entityId);
  self.supplyWarehouseStates.delete(entityId);
  self.supplyTruckStates.delete(entityId);
  self.dockApproachStates.delete(entityId);
  self.disableOverchargeForEntity(entity);
  self.sellingEntities.delete(entityId);
  self.disabledHackedStatusByEntityId.delete(entityId);
  self.disabledEmpStatusByEntityId.delete(entityId);
  self.battlePlanParalyzedUntilFrame.delete(entityId);

  // Clean up pending actions referencing this entity.
  for (const [sourceId, pendingAction] of self.pendingEnterObjectActions.entries()) {
    if (pendingAction.targetObjectId === entityId) {
      self.pendingEnterObjectActions.delete(sourceId);
    }
  }
  for (const [dockerId, pendingAction] of self.pendingRepairDockActions.entries()) {
    if (pendingAction.dockObjectId === entityId || dockerId === entityId) {
      self.pendingRepairDockActions.delete(dockerId);
    }
  }
  for (const [sourceId, targetBuildingId] of self.pendingGarrisonActions.entries()) {
    if (targetBuildingId === entityId) {
      self.pendingGarrisonActions.delete(sourceId);
    }
  }
  for (const [sourceId, targetTransportId] of self.pendingTransportActions.entries()) {
    if (targetTransportId === entityId) {
      self.pendingTransportActions.delete(sourceId);
    }
  }
  for (const [sourceId, targetTunnelId] of self.pendingTunnelActions.entries()) {
    if (targetTunnelId === entityId) {
      self.pendingTunnelActions.delete(sourceId);
    }
  }
  for (const [sourceId, pendingAction] of self.pendingCombatDropActions.entries()) {
    if (sourceId === entityId) {
      self.clearChinookCombatDropIgnoredObstacle(sourceId);
      self.pendingCombatDropActions.delete(sourceId);
      self.abortPendingChinookRappels(sourceId);
      self.clearPendingChinookCommands(sourceId);
      continue;
    }
    if (pendingAction.targetObjectId === entityId) {
      pendingAction.targetObjectId = null;
      self.clearChinookCombatDropIgnoredObstacle(sourceId);
    }
  }
  for (const [passengerId, pendingRappel] of self.pendingChinookRappels.entries()) {
    if (passengerId === entityId || pendingRappel.sourceEntityId === entityId) {
      self.pendingChinookRappels.delete(passengerId);
      continue;
    }
    if (pendingRappel.targetObjectId === entityId) {
      pendingRappel.targetObjectId = null;
    }
  }
  for (const [dozerId, targetBuildingId] of self.pendingConstructionActions.entries()) {
    if (targetBuildingId === entityId) {
      self.pendingConstructionActions.delete(dozerId);
    }
  }

  // Remove upgrades (cleans up side state like radar/power counts).
  const completedUpgradeNames = Array.from(entity.completedUpgrades.values());
  for (const completedUpgradeName of completedUpgradeNames) {
    self.removeEntityUpgrade(entity, completedUpgradeName);
  }

  // Mark as destroyed — no death animation, no dying renderable state.
  entity.destroyed = true;
  entity.moving = false;
  entity.moveTarget = null;
  entity.movePath = [];
  entity.pathIndex = 0;
  entity.pathfindGoalCell = null;
  entity.attackTargetEntityId = null;
  entity.attackTargetPosition = null;
  entity.attackOriginalVictimPosition = null;
  entity.attackCommandSource = 'AI';
  entity.attackSubState = 'IDLE';
  entity.lastAttackerEntityId = null;
  onObjectDestroyed(self, entityId);
}

export function updateSlowDeathEntities(self: GL): void {
  for (const entity of self.spawnedEntities.values()) {
    if (entity.destroyed) continue;

    // Source parity: BattleBus empty hulk auto-destruction check.
    // Runs outside slow death state since the state is nulled on landing.
    if (entity.battleBusEmptyHulkDestroyFrame > 0 && self.frameCounter >= entity.battleBusEmptyHulkDestroyFrame) {
      entity.battleBusEmptyHulkDestroyFrame = 0;
      markEntityDestroyed(self, entity.id, -1);
      continue;
    }

    if (!entity.slowDeathState) continue;
    const state = entity.slowDeathState;
    const profile = entity.slowDeathProfiles[state.profileIndex];
    if (!profile) {
      entity.slowDeathState = null;
      if (state.destroyOnCompletion) {
        markEntityDestroyed(self, entity.id, -1);
      }
      continue;
    }

    // Source parity: BattleBusSlowDeathBehavior::update — fake death throw + landing.
    if (state.isBattleBusFakeDeath) {
      const BATTLE_BUS_GRAVITY = 6.0 / LOGIC_FRAME_RATE;
      state.battleBusThrowVelocity -= BATTLE_BUS_GRAVITY;
      entity.y += state.battleBusThrowVelocity;

      // Landing check after initial delay.
      if (self.frameCounter >= state.battleBusLandingCheckFrame) {
        const terrainY = self.resolveGroundHeight(entity.x, entity.z) + entity.baseHeight;
        if (entity.y <= terrainY) {
          entity.y = terrainY;
          state.isBattleBusFakeDeath = false;
          state.battleBusThrowVelocity = 0;

          // Become SECOND_LIFE hulk — re-enable as driveable wreck.
          entity.modelConditionFlags.add('SECOND_LIFE');
          entity.canTakeDamage = true;
          entity.health = entity.maxHealth * 0.5; // Half health hulk.
          entity.animationState = 'IDLE';
          entity.slowDeathState = null; // End slow death for now.

          // Empty hulk auto-destruction timer.
          if (profile.emptyHulkDestructionDelayFrames > 0) {
            const containedIds = self.collectContainedEntityIds(entity.id);
            if (containedIds.length === 0) {
              entity.battleBusEmptyHulkDestroyFrame = self.frameCounter + profile.emptyHulkDestructionDelayFrames;
            }
          }
        }
      }
      continue;
    }

    // Source parity: SlowDeathBehavior fling physics — gravity, position update, ground bounce.
    // C++ ref: SlowDeathBehavior.cpp:414-453 — FLUNG_INTO_AIR → BOUNCED state transitions.
    if (state.isFlung) {
      const FLING_GRAVITY = 4.0 / LOGIC_FRAME_RATE;
      state.flingVelocityY -= FLING_GRAVITY;
      entity.x += state.flingVelocityX;
      entity.y += state.flingVelocityY;
      entity.z += state.flingVelocityZ;

      // Ground collision check.
      const terrainY = self.resolveGroundHeight(entity.x, entity.z) + entity.baseHeight;
      if (entity.y <= terrainY) {
        entity.y = terrainY;
        if (!state.hasBounced && Math.abs(state.flingVelocityY) > 0.05) {
          // First bounce: retain 30% velocity, reverse Y.
          state.flingVelocityX *= 0.3;
          state.flingVelocityY *= -0.3;
          state.flingVelocityZ *= 0.3;
          state.hasBounced = true;
          entity.explodedState = 'BOUNCING';
        } else {
          // Below threshold or already bounced: stop fling.
          state.flingVelocityX = 0;
          state.flingVelocityY = 0;
          state.flingVelocityZ = 0;
          state.isFlung = false;
          entity.explodedState = 'SPLATTED';
        }
      }
      continue; // Skip normal sink logic while flung
    }

    // Source parity: sink the entity below terrain.
    if (profile.sinkRate > 0 && self.frameCounter >= state.sinkFrame) {
      entity.y -= profile.sinkRate;
      // Altitude check: destroy when sunk below threshold.
      if (entity.y <= profile.destructionAltitude) {
        executeSlowDeathPhase(self, entity, profile, 2); // FINAL
        entity.slowDeathState = null;
        if (state.destroyOnCompletion) {
          markEntityDestroyed(self, entity.id, -1);
        }
        continue;
      }
    }

    // Source parity: midpoint phase — execute once at the midpoint frame.
    if (!state.midpointExecuted && self.frameCounter >= state.midpointFrame) {
      executeSlowDeathPhase(self, entity, profile, 1); // MIDPOINT
      state.midpointExecuted = true;
    }

    // Source parity: destruction frame — execute final phase and destroy.
    // C++ parity: helicopter/jet slow death behaviors call base SlowDeathBehavior::update() for
    // FX/OCL phases but override the destruction timing with their own ground-hit + delay logic.
    // Skip the base timer destruction when these sub-behaviors are actively managing the death.
    if (self.frameCounter >= state.destructionFrame
      && !entity.helicopterSlowDeathState && !entity.jetSlowDeathState) {
      executeSlowDeathPhase(self, entity, profile, 2); // FINAL
      entity.slowDeathState = null;
      if (state.destroyOnCompletion) {
        markEntityDestroyed(self, entity.id, -1);
      }
      continue;
    }

    // Source parity: NeutronMissileSlowDeathBehavior::update — timed blast waves.
    // Runs after base SlowDeathBehavior logic, only while slow death is activated.
    const nmState = entity.neutronMissileSlowDeathState;
    const nmProfile = entity.neutronMissileSlowDeathProfile;
    if (nmState && nmProfile) {
      // Record activation frame on first tick (C++ m_activationFrame set once).
      if (nmState.activationFrame === 0) {
        nmState.activationFrame = self.frameCounter;
      }
      const elapsed = self.frameCounter - nmState.activationFrame;
      for (let bi = 0; bi < nmProfile.blasts.length; bi++) {
        const blast = nmProfile.blasts[bi]!;
        if (!blast.enabled) continue;
        // Fire damage blast if delay has elapsed.
        if (!nmState.completedBlasts[bi] && elapsed > blast.delay) {
          self.doNeutronMissileBlast(entity, blast);
          nmState.completedBlasts[bi] = true;
        }
        // Fire scorch blast (visual burned condition) if scorch delay has elapsed.
        if (!nmState.completedScorchBlasts[bi] && elapsed > blast.scorchDelay) {
          self.doNeutronMissileScorchBlast(entity, blast);
          nmState.completedScorchBlasts[bi] = true;
        }
      }
    }
  }
}

export function updateHelicopterSlowDeath(self: GL): void {
  for (const entity of self.spawnedEntities.values()) {
    if (entity.destroyed) continue;
    const hs = entity.helicopterSlowDeathState;
    if (!hs) continue;

    // Look up the profile that was selected at init time.
    const profile = entity.helicopterSlowDeathProfiles[hs.profileIndex];
    if (!profile) continue;

    // ── Still airborne ──
    if (hs.hitGroundFrame === 0) {
      // Self-spin: rotate the entity body (visual rotation).
      entity.rotationY += hs.selfSpin * hs.orbitDirection;

      // Self-spin rate oscillation: ping-pong between minSelfSpin and maxSelfSpin.
      if (profile.selfSpinUpdateDelay > 0
        && self.frameCounter - hs.lastSelfSpinUpdateFrame > profile.selfSpinUpdateDelay) {
        const spinIncrement = profile.selfSpinUpdateAmount / LOGIC_FRAME_RATE;
        if (hs.selfSpinTowardsMax) {
          hs.selfSpin += spinIncrement;
          if (hs.selfSpin >= profile.maxSelfSpin) {
            hs.selfSpin = profile.maxSelfSpin;
            hs.selfSpinTowardsMax = false;
          }
        } else {
          hs.selfSpin -= spinIncrement;
          if (hs.selfSpin <= profile.minSelfSpin) {
            hs.selfSpin = profile.minSelfSpin;
            hs.selfSpinTowardsMax = true;
          }
        }
        hs.lastSelfSpinUpdateFrame = self.frameCounter;
      }

      // Forward motion along spiral orbit direction.
      entity.x += Math.cos(hs.forwardAngle) * hs.forwardSpeed;
      entity.z += Math.sin(hs.forwardAngle) * hs.forwardSpeed;

      // Turn the spiral orbit angle.
      hs.forwardAngle += profile.spiralOrbitTurnRate * hs.orbitDirection;

      // Damp forward speed.
      hs.forwardSpeed *= profile.spiralOrbitForwardSpeedDamping;

      // Gravity-based descent.
      // C++: locomotor maxLift = -gravity * (1 - fallHowFast).
      // Simplified: apply downward velocity proportional to fallHowFast.
      hs.verticalVelocity += HELICOPTER_GRAVITY * profile.fallHowFast;
      entity.y += hs.verticalVelocity;

      // Ground hit detection.
      const terrainY = self.resolveGroundHeight(entity.x, entity.z) + entity.baseHeight;
      if (entity.y <= terrainY + 1.0) {
        entity.y = terrainY;
        hs.hitGroundFrame = self.frameCounter;

        // Execute ground hit OCLs.
        for (const oclName of profile.oclHitGround) {
          self.executeOCL(oclName, entity, undefined, entity.x, entity.z);
        }

        // C++ parity: copter->setDisabled(DISABLED_HELD) — freeze the entity on ground.
        entity.moving = false;
        entity.moveTarget = null;
        entity.movePath = [];
        entity.objectStatusFlags.add('DISABLED_HELD');
      }
    }

    // ── On the ground: wait for final explosion ──
    if (hs.hitGroundFrame > 0
      && self.frameCounter - hs.hitGroundFrame > profile.delayFromGroundToFinalDeath) {
      // Execute final explosion OCLs.
      for (const oclName of profile.oclFinalBlowUp) {
        self.executeOCL(oclName, entity, undefined, entity.x, entity.z);
      }

      // Spawn rubble object.
      if (profile.finalRubbleObject) {
        self.spawnEntityFromTemplate(
          profile.finalRubbleObject, entity.x, entity.z, entity.rotationY, entity.side);
      }

      // Destroy the helicopter.
      entity.helicopterSlowDeathState = null;
      entity.slowDeathState = null;
      markEntityDestroyed(self, entity.id, -1);
    }
  }
}

export function updateJetSlowDeath(self: GL): void {
  for (const entity of self.spawnedEntities.values()) {
    if (entity.destroyed) continue;
    const js = entity.jetSlowDeathState;
    if (!js) continue;

    const profile = entity.jetSlowDeathProfiles[js.profileIndex];
    if (!profile) continue;

    // C++ parity: roll rate application and decay happen unconditionally (outside if/else).
    // Roll continues even after ground impact, creating a tumbling effect.
    js.rollAngle += js.rollRate;
    js.rollRate *= profile.rollRateDelta;

    // ── Still airborne ──
    if (js.groundFrame === 0) {
      // Forward motion: jet keeps flying in the direction it was headed at death.
      entity.x += Math.cos(js.forwardAngle) * js.forwardSpeed;
      entity.z += Math.sin(js.forwardAngle) * js.forwardSpeed;

      // Gravity descent (C++ setMaxLift(-gravity * (1 - fallHowFast))).
      // fallHowFast=1 → full fall, fallHowFast=0 → slow fall.
      js.verticalVelocity += HELICOPTER_GRAVITY * profile.fallHowFast;
      entity.y += js.verticalVelocity;

      // Secondary OCL timer (C++ line 292-301). Delay of 0 fires on first frame.
      if (!js.secondaryExecuted
        && self.frameCounter - js.deathFrame >= profile.delaySecondaryFromInitialDeath) {
        for (const oclName of profile.oclSecondary) {
          self.executeOCL(oclName, entity, undefined, entity.x, entity.z);
        }
        js.secondaryExecuted = true;
      }

      // Ground hit detection.
      const terrainY = self.resolveGroundHeight(entity.x, entity.z) + entity.baseHeight;
      if (entity.y <= terrainY + 1.0) {
        entity.y = terrainY;
        js.groundFrame = self.frameCounter;

        // Execute ground hit OCLs (C++ line 276-277).
        for (const oclName of profile.oclHitGround) {
          self.executeOCL(oclName, entity, undefined, entity.x, entity.z);
        }

        // C++ parity: freeze the entity on ground (DISABLED_HELD).
        entity.moving = false;
        entity.moveTarget = null;
        entity.movePath = [];
        entity.objectStatusFlags.add('DISABLED_HELD');
      }
    } else {
      // ── On the ground: wait for final explosion (C++ if/else with airborne) ──
      // Apply pitch rotation after ground impact (C++ physics->setPitchRate).
      js.pitchAngle += profile.pitchRate;

      if (self.frameCounter - js.groundFrame >= profile.delayFinalBlowUpFromHitGround) {
        // Execute final explosion OCLs (C++ line 306-307).
        for (const oclName of profile.oclFinalBlowUp) {
          self.executeOCL(oclName, entity, undefined, entity.x, entity.z);
        }

        // Destroy the jet.
        entity.jetSlowDeathState = null;
        entity.slowDeathState = null;
        markEntityDestroyed(self, entity.id, -1);
      }
    }
  }
}

export function markEntityDestroyed(self: GL, entityId: number, attackerId: number): void {
  const entity = self.spawnedEntities.get(entityId);
  if (!entity || entity.destroyed) {
    return;
  }

  // Source parity: Object::m_hasDiedAlready — prevent re-entrant death pipeline.
  // Death effects (sticky bomb detonation, InstantDeathBehavior weapons) can kill other
  // entities, which may cascade back. Guard against processing the same entity twice.
  if (self.dyingEntityIds.has(entityId)) {
    return;
  }
  self.dyingEntityIds.add(entityId);

  // Source parity: TechBuildingBehavior::onDie — revert to neutral team instead of destroying.
  // C++ sets team to ThePlayerList->getNeutralPlayer()->getDefaultTeam() and clears MODELCONDITION_CAPTURED.
  // C++ does NOT restore health, but our engine would re-trigger death at 0 HP, so we restore to maxHealth.
  if (entity.techBuildingProfile) {
    self.dyingEntityIds.delete(entityId);
    // Unregister energy from current side.
    self.unregisterEntityEnergy(entity);
    // Revert to civilian/neutral side.
    entity.side = 'civilian';
    entity.controllingPlayerToken = self.normalizeControllingPlayerToken('civilian');
    // Restore full health to prevent re-death loop (pragmatic deviation from C++).
    entity.health = entity.maxHealth;
    return;
  }

  // Source parity: Object::onDie calls checkAndDetonateBoobyTrap before die modules.
  // C++ file: Object.cpp line 4575.
  self.checkAndDetonateBoobyTrap(entityId);

  // Source parity: StickyBombUpdate die module — if this entity IS a sticky bomb,
  // execute its detonation damage before the bomb is marked destroyed.
  // In C++, a die module calls StickyBombUpdate::detonate() on bomb death.
  if (entity.stickyBombProfile && entity.stickyBombTargetId !== 0) {
    self.executeStickyBombDetonationDamage(entity);
  }

  // Source parity: BridgeBehavior::onDie — kill towers, mark cells impassable.
  if (entity.bridgeBehaviorState) {
    self.bridgeBehaviorOnDie(entity);
  }

  // Source parity: BridgeTowerBehavior::onDie — kill the parent bridge.
  if (entity.bridgeTowerState) {
    self.bridgeTowerOnDie(entity);
  }

  // Emit entity destroyed visual event.
  self.visualEventBuffer.push({
    type: 'ENTITY_DESTROYED',
    x: entity.x,
    y: entity.y,
    z: entity.z,
    radius: entity.category === 'building' ? 8 : 3,
    sourceEntityId: entityId,
    projectileType: 'BULLET',
  });

  // Source parity: EVA — announce building/unit loss.
  if (entity.side) {
    if (entity.kindOf.has('STRUCTURE') && entity.kindOf.has('MP_COUNT_FOR_VICTORY')) {
      self.emitEvaEvent('BUILDING_LOST', entity.side, 'own', entityId);
    } else if (entity.category === 'infantry' || entity.category === 'vehicle') {
      self.emitEvaEvent('UNIT_LOST', entity.side, 'own', entityId);
    }
  }

  // Source parity: ScoreKeeper — track entity destruction stats.
  addEntityDestroyedScore(self, entity, attackerId);

  // Unregister energy contribution before destruction.
  self.unregisterEntityEnergy(entity);

  // Source parity: award XP to killer on victim death.
  awardExperienceOnKill(self, entityId, attackerId);
  recordDestroyedBuildingBySource(self, entity, attackerId);

  // Source parity: Player::addCashBounty — if the killer's player has cash bounty active,
  // award a percentage of the victim's build cost as credits.
  awardCashBountyOnKill(self, entity, attackerId);

  // Source parity: RebuildHoleExposeDie::onDie — create rebuild hole on building death.
  tryCreateRebuildHoleOnDeath(self, entity, attackerId);

  // Source parity: EjectPilotDie — eject pilot unit for VETERAN+ vehicles on death.
  tryEjectPilotOnDeath(self, entity);

  // Source parity: GenerateMinefieldBehavior::onDie — spawn mines on death.
  tryGenerateMinefieldOnDeath(self, entity);

  // Source parity: CreateObjectDie / SlowDeathBehavior — execute death OCLs.
  executeDeathOCLs(self, entity);

  // Source parity: InstantDeathBehavior::onDie — fire matching die module effects.
  executeInstantDeathModules(self, entity);

  // Source parity: FireWeaponWhenDeadBehavior::onDie — fire weapon on death with upgrade control.
  self.executeFireWeaponWhenDeadModules(entity);

  // Source parity: NeutronBlastBehavior::onDie — radius neutron blast on death.
  self.executeNeutronBlast(entity);

  // Source parity: BunkerBusterBehavior::onDie — kill garrisoned units in victim building.
  self.executeBunkerBuster(entity);

  // Source parity: FXListDie::onDie — trigger death FX for matching profiles.
  executeFXListDieModules(self, entity);

  // Source parity: CrushDie::onDie — set FRONTCRUSHED/BACKCRUSHED model conditions.
  executeCrushDie(self, entity, attackerId);

  // Source parity: DamDie::onDie — enable all WAVEGUIDE objects for flood wave.
  executeDamDieModules(self, entity);

  // Source parity: SpecialPowerCompletionDie::onDie — notify script engine of completion.
  executeSpecialPowerCompletionDieModules(self, entity);

  // Source parity: UpgradeDie::onDie — remove upgrade from producer on death.
  executeUpgradeDieModules(self, entity);

  // Source parity: CreateCrateDie::onDie — spawn salvage crate on death.
  trySpawnCrateOnDeath(self, entity, attackerId);

  // Source parity: FlightDeckBehavior::onDie — kill all parked aircraft when carrier dies.
  self.onFlightDeckDie(entity);

  // Source parity: SpectreGunshipUpdate — if the gunship is shot down, destroy the
  // contained gattling entity. C++ SpectreGunshipUpdate.cpp update() line 693-696:
  // "THE GUNSHIP MUST HAVE GOTTEN SHOT DOWN!" → cleanUp() destroys gattling.
  if (entity.spectreGunshipState && entity.spectreGunshipState.gattlingEntityId !== -1) {
    self.cleanUpSpectreGunship(entity.spectreGunshipState);
    entity.spectreGunshipState.status = 'IDLE';
  }

  // Source parity: SpawnBehavior::onDie — handle slaver death (orphan/kill slaves).
  self.onSlaverDeath(entity);
  // Source parity: Object::onDie → SpawnBehavior::onSpawnDeath — notify slaver of slave death.
  self.onSlaveDeath(entity);

  // Source parity: RebuildHoleBehavior::onDie — if a hole dies, destroy its worker.
  if (entity.rebuildHoleProfile && entity.rebuildHoleWorkerEntityId !== 0) {
    const worker = self.spawnedEntities.get(entity.rebuildHoleWorkerEntityId);
    if (worker && !worker.destroyed) {
      markEntityDestroyed(self, worker.id, -1);
    }
    entity.rebuildHoleWorkerEntityId = 0;
  }

  self.cancelEntityCommandPathActions(entityId);
  self.railedTransportStateByEntityId.delete(entityId);
  self.supplyWarehouseStates.delete(entityId);
  self.supplyTruckStates.delete(entityId);
  self.dockApproachStates.delete(entityId);
  self.disableOverchargeForEntity(entity);
  self.sellingEntities.delete(entityId);
  self.disabledHackedStatusByEntityId.delete(entityId);
  self.disabledEmpStatusByEntityId.delete(entityId);
  self.battlePlanParalyzedUntilFrame.delete(entityId);
  // Source parity: if a Strategy Center is destroyed while a battle plan is active,
  // remove its bonuses from all entities on the side.
  if (entity.battlePlanState?.activePlan !== 'NONE' && entity.battlePlanState?.transitionStatus === 'ACTIVE') {
    self.applyBattlePlanBonuses(entity, entity.battlePlanState.activePlan, false);
  }
  for (const [sourceId, pendingAction] of self.pendingEnterObjectActions.entries()) {
    if (pendingAction.targetObjectId === entityId) {
      self.pendingEnterObjectActions.delete(sourceId);
    }
  }
  for (const [dockerId, pendingAction] of self.pendingRepairDockActions.entries()) {
    if (pendingAction.dockObjectId === entityId || dockerId === entityId) {
      self.pendingRepairDockActions.delete(dockerId);
    }
  }
  for (const [sourceId, targetBuildingId] of self.pendingGarrisonActions.entries()) {
    if (targetBuildingId === entityId) {
      self.pendingGarrisonActions.delete(sourceId);
    }
  }
  for (const [sourceId, targetTransportId] of self.pendingTransportActions.entries()) {
    if (targetTransportId === entityId) {
      self.pendingTransportActions.delete(sourceId);
    }
  }
  for (const [sourceId, targetTunnelId] of self.pendingTunnelActions.entries()) {
    if (targetTunnelId === entityId) {
      self.pendingTunnelActions.delete(sourceId);
    }
  }
  for (const [sourceId, pendingAction] of self.pendingCombatDropActions.entries()) {
    if (sourceId === entityId) {
      self.clearChinookCombatDropIgnoredObstacle(sourceId);
      self.pendingCombatDropActions.delete(sourceId);
      self.abortPendingChinookRappels(sourceId);
      self.clearPendingChinookCommands(sourceId);
      continue;
    }
    if (pendingAction.targetObjectId === entityId) {
      pendingAction.targetObjectId = null;
      self.clearChinookCombatDropIgnoredObstacle(sourceId);
    }
  }
  for (const [passengerId, pendingRappel] of self.pendingChinookRappels.entries()) {
    if (passengerId === entityId || pendingRappel.sourceEntityId === entityId) {
      self.pendingChinookRappels.delete(passengerId);
      continue;
    }
    if (pendingRappel.targetObjectId === entityId) {
      pendingRappel.targetObjectId = null;
    }
  }
  // Clear dozer construction tasks targeting this building.
  for (const [dozerId, targetBuildingId] of self.pendingConstructionActions.entries()) {
    if (targetBuildingId === entityId) {
      self.pendingConstructionActions.delete(dozerId);
    }
  }

  // Source parity: TunnelTracker::onTunnelDestroyed — cave-in if last tunnel.
  if (entity.containProfile?.moduleType === 'TUNNEL' || entity.containProfile?.moduleType === 'CAVE') {
    self.handleTunnelDestroyed(entity);
  }

  // Source parity: OpenContain::onDie — apply damage to contained units before releasing (C++ line 862-866).
  // processDamageToContained: percentDamage * maxHealth as UNRESISTABLE, deathType BURNED or NORMAL.
  if (entity.containProfile && entity.containProfile.moduleType !== 'TUNNEL'
      && entity.containProfile.moduleType !== 'CAVE'
      && entity.containProfile.damagePercentToUnits > 0) {
    self.processDamageToContained(entity);
  }

  // Source parity: TransportContain::killRidersWhoAreNotFreeToExit — kill riders who cannot exit
  // before releasing remaining passengers (C++ TransportContain.cpp lines 536-556).
  if (entity.containProfile) {
    self.killRidersWhoAreNotFreeToExit(entity);
  }

  // Source parity: Contain::onDie — release contained entities on container death.
  // Garrison, transport, helix, and overlord passengers are ejected at the container position.
  if (entity.containProfile
      && entity.containProfile.moduleType !== 'TUNNEL'
      && entity.containProfile.moduleType !== 'CAVE') {
    const passengerIds = self.collectContainedEntityIds(entityId);
    for (const passengerId of passengerIds) {
      const passenger = self.spawnedEntities.get(passengerId);
      if (passenger && !passenger.destroyed) {
        self.releaseEntityFromContainer(passenger);
      }
    }
    // Edge case: AOE damage may kill passengers on the same frame as the container
    // (or processDamageToContained / killRidersWhoAreNotFreeToExit killed them above).
    // collectContainedEntityIds skips destroyed entities, so their containment IDs
    // remain stale. Clean them up to prevent reference leaks.
    for (const other of self.spawnedEntities.values()) {
      if (!other.destroyed) continue;
      if (other.garrisonContainerId === entityId) {
        other.garrisonContainerId = null;
      }
      if (other.transportContainerId === entityId) {
        other.transportContainerId = null;
      }
      if (other.helixCarrierId === entityId) {
        other.helixCarrierId = null;
      }
      if (other.parkingSpaceProducerId === entityId) {
        other.parkingSpaceProducerId = null;
      }
    }
  }

  const completedUpgradeNames = Array.from(entity.completedUpgrades.values());
  for (const completedUpgradeName of completedUpgradeNames) {
    self.removeEntityUpgrade(entity, completedUpgradeName);
  }
  cancelAndRefundAllProductionOnDeath(self, entity);
  self.removeAllSequentialScriptsForEntity(entityId);
  entity.animationState = 'DIE';
  // Source parity: upgrade modules clean up side state via removeEntityUpgrade/onDelete parity.
  entity.destroyed = true;
  self.dyingEntityIds.delete(entityId);
  entity.moving = false;
  entity.moveTarget = null;
  entity.movePath = [];
  entity.pathIndex = 0;
  entity.pathfindGoalCell = null;
  entity.attackTargetEntityId = null;
  entity.attackTargetPosition = null;
  entity.attackOriginalVictimPosition = null;
  entity.attackCommandSource = 'AI';
  entity.attackSubState = 'IDLE';
  entity.leechRangeActive = false;
  entity.lastAttackerEntityId = null;
  entity.continuousFireState = 'NONE';
  entity.continuousFireCooldownFrame = 0;
  entity.objectStatusFlags.delete('CONTINUOUS_FIRE_SLOW');
  entity.objectStatusFlags.delete('CONTINUOUS_FIRE_MEAN');
  entity.objectStatusFlags.delete('CONTINUOUS_FIRE_FAST');
  // Source parity: buildings with topple/collapse profiles leave rubble remnants longer.
  // C++ keeps the object with POST_COLLAPSE/RUBBLE model condition; we approximate by
  // extending corpse persistence to 10 seconds and adding RUBBLE flag + reduced opacity.
  const isRubbleBuilding = !!(entity.structureToppleProfile || entity.structureCollapseProfile);
  const rubbleDuration = isRubbleBuilding
    ? LOGIC_FRAME_RATE * 10 // ~10 seconds rubble persistence
    : LOGIC_FRAME_RATE * 3; // ~3 seconds corpse persistence

  if (isRubbleBuilding) {
    entity.modelConditionFlags.add('RUBBLE');
  }

  const dyingRenderState = self.makeRenderableEntityState(entity);

  if (isRubbleBuilding) {
    dyingRenderState.health = 0;
  }

  self.pendingDyingRenderableStates.set(entityId, {
    state: dyingRenderState,
    expireFrame: self.frameCounter + rubbleDuration,
  });
  onObjectDestroyed(self, entityId);
}

export function tryEjectPilotOnDeath(self: GL, entity: MapEntity): void {
  if (!entity.ejectPilotTemplateName) return;
  if (entity.category !== 'vehicle' && entity.category !== 'air') return;

  // Source parity: Only VETERAN or higher eject a pilot.
  const vetLevel = entity.experienceState.currentLevel;
  if (vetLevel < entity.ejectPilotMinVeterancy) return;

  // Try to resolve the pilot unit template. The ejectPilotTemplateName
  // may be an OCL name rather than a direct unit template. Try to find
  // a matching infantry template first, falling back to a side-specific pilot.
  const registry = self.iniDataRegistry;
  if (!registry) return;

  // Convention: look for the OCL name as an object template first.
  // If not found, try side-prefixed variants (e.g., AmericaPilot, ChinaPilot).
  let pilotTemplateName = entity.ejectPilotTemplateName;
  let pilotDef = findObjectDefByName(registry, pilotTemplateName);
  if (!pilotDef && entity.side) {
    // Try conventional pilot name: <Side>Pilot (e.g., AmericaPilot)
    const sidePilot = entity.side + 'Pilot';
    pilotDef = findObjectDefByName(registry, sidePilot);
    if (pilotDef) pilotTemplateName = sidePilot;
  }
  if (!pilotDef) {
    // Try generic Pilot template
    pilotDef = findObjectDefByName(registry, 'Pilot');
    if (pilotDef) pilotTemplateName = 'Pilot';
  }
  if (!pilotDef) return;

  // Spawn the pilot at the vehicle's position.
  const pilotEntity = self.spawnEntityFromTemplate(
    pilotTemplateName,
    entity.x,
    entity.z,
    entity.rotationY,
    entity.side,
  );
  if (!pilotEntity) return;

  // Inherit veterancy.
  if (pilotEntity.experienceProfile) {
    pilotEntity.experienceState.currentLevel = vetLevel;
  }
}

export function hasKeepObjectDie(self: GL, objectDef: ObjectDef | undefined): boolean {
  if (!objectDef) return false;
  for (const block of objectDef.blocks) {
    if (block.type.toUpperCase() === 'BEHAVIOR') {
      const moduleName = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
      if (moduleName === 'KEEPOBJECTDIE') return true;
    }
  }
  return false;
}

export function extractDeathOCLEntries(self: GL, objectDef: ObjectDef | undefined): DeathOCLEntry[] {
  if (!objectDef) return [];
  const entries: DeathOCLEntry[] = [];
  const moduleBlocks = objectDef.blocks ?? [];
  for (const block of moduleBlocks) {
    const blockType = block.type.toUpperCase();
    if (blockType !== 'DIE' && blockType !== 'BEHAVIOR') continue;
    const moduleType = block.name.split(/\s+/)[0] ?? '';
    const upperModuleType = moduleType.toUpperCase();
    // CreateObjectDie, SlowDeathBehavior
    if (upperModuleType.includes('CREATEOBJECTDIE') || upperModuleType.includes('SLOWDEATH')) {
      // Parse DieMuxData fields.
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

      const oclName = readStringField(block.fields, [
        'CreationList', 'GroundCreationList', 'AirCreationList',
      ]);
      if (oclName) {
        entries.push({
          oclName: oclName.trim(),
          deathTypes, veterancyLevels, exemptStatus, requiredStatus,
        });
      }
      // SlowDeathBehavior can have OCL fields with phase names.
      // e.g., "OCL INITIAL OCLDestroyDebris"
      const oclFieldRaw = readStringField(block.fields, ['OCL']);
      if (oclFieldRaw) {
        const parts = oclFieldRaw.trim().split(/\s+/);
        const oclPart = parts.length > 1 ? parts[parts.length - 1]! : parts[0]!;
        if (oclPart) {
          entries.push({
            oclName: oclPart,
            deathTypes, veterancyLevels, exemptStatus, requiredStatus,
          });
        }
      }
    }
  }
  return entries;
}

export function executeDeathOCLs(self: GL, entity: MapEntity): void {
  for (const entry of entity.deathOCLEntries) {
    // Source parity: DieMuxData filtering for each CreateObjectDie module.
    if (!isDieModuleApplicable(self, entity, entry)) continue;
    self.executeOCL(entry.oclName, entity);
  }
}

export function executeInstantDeathModules(self: GL, entity: MapEntity): void {
  for (const profile of entity.instantDeathProfiles) {
    if (!isDieModuleApplicable(self, entity, profile)) continue;

    // Fire one random OCL from the list.
    if (profile.oclNames.length > 0) {
      const idx = profile.oclNames.length === 1 ? 0
        : self.gameRandom.nextRange(0, profile.oclNames.length - 1);
      const oclName = profile.oclNames[idx];
      if (oclName) {
        self.executeOCL(oclName, entity);
      }
    }

    // Fire one random weapon from the list.
    if (profile.weaponNames.length > 0) {
      const idx = profile.weaponNames.length === 1 ? 0
        : self.gameRandom.nextRange(0, profile.weaponNames.length - 1);
      const weaponName = profile.weaponNames[idx];
      if (weaponName) {
        const weaponDef = self.iniDataRegistry?.getWeapon(weaponName);
        if (weaponDef) {
          self.fireTemporaryWeaponAtPosition(entity, weaponDef, entity.x, entity.z);
        }
      }
    }
  }
}

export function executeFXListDieModules(self: GL, entity: MapEntity): void {
  for (const profile of entity.fxListDieProfiles) {
    if (!isDieModuleApplicable(self, entity, profile)) continue;
    // Emit a death FX visual event for the renderer.
    // Source parity: C++ triggers FXList::doFXObj or FXList::doFXPos based on orientToObject.
    self.visualEventBuffer.push({
      type: 'ENTITY_DESTROYED',
      x: entity.x,
      y: entity.y,
      z: entity.z,
      radius: 0,
      sourceEntityId: entity.id,
      projectileType: 'BULLET',
    });
  }
}

export function executeCrushDie(self: GL, entity: MapEntity, attackerId: number): void {
  if (entity.crushDieProfiles.length === 0) return;

  for (const profile of entity.crushDieProfiles) {
    if (!isDieModuleApplicable(self, entity, profile)) continue;

    // Source parity: CrushDie.cpp line 169 — only for CRUSH damage type.
    if (entity.pendingDeathType !== 'CRUSHED') continue;

    const crusher = self.spawnedEntities.get(attackerId);
    // Source parity: CrushDie.cpp line 175 — if no crusher found, use TOTAL_CRUSH.
    const crushType = crusher
      ? self.crushLocationCheck(crusher, entity)
      : 'TOTAL';

    if (crushType === 'NONE') continue;

    // Source parity: CrushDie.cpp lines 195-204.
    entity.frontCrushed = crushType === 'TOTAL' || crushType === 'FRONT';
    entity.backCrushed = crushType === 'TOTAL' || crushType === 'BACK';

    if (entity.frontCrushed) entity.modelConditionFlags.add('FRONTCRUSHED');
    if (entity.backCrushed) entity.modelConditionFlags.add('BACKCRUSHED');
  }
}

export function executeDamDieModules(self: GL, entity: MapEntity): void {
  if (entity.damDieProfiles.length === 0) {
    return;
  }

  const matchedProfiles: DamDieProfile[] = [];
  for (const profile of entity.damDieProfiles) {
    if (isDieModuleApplicable(self, entity, profile)) {
      matchedProfiles.push(profile);
    }
  }
  if (matchedProfiles.length === 0) {
    return;
  }

  for (const profile of matchedProfiles) {
    if (!profile.oclName) {
      continue;
    }
    self.executeOCL(profile.oclName, entity, undefined, entity.x, entity.z);
  }

  for (const candidate of self.spawnedEntities.values()) {
    if (!candidate.kindOf.has('WAVEGUIDE')) {
      continue;
    }
    candidate.objectStatusFlags.delete('DISABLED_DEFAULT');
  }
}

export function executeSpecialPowerCompletionDieModules(self: GL, entity: MapEntity): void {
  if (entity.specialPowerCompletionDieProfiles.length === 0) {
    return;
  }

  const normalizedSide = self.normalizeSide(entity.side);
  if (!normalizedSide) {
    return;
  }

  const creatorId = entity.specialPowerCompletionCreatorId;
  if (!Number.isFinite(creatorId) || Math.trunc(creatorId) <= 0) {
    return;
  }
  const normalizedCreatorId = Math.trunc(creatorId);

  for (const profile of entity.specialPowerCompletionDieProfiles) {
    if (!isDieModuleApplicable(self, entity, profile)) {
      continue;
    }
    self.recordScriptCompletedSpecialPowerEvent(
      normalizedSide,
      profile.specialPowerTemplateName,
      normalizedCreatorId,
    );
  }
}

export function isDieModuleApplicable(self: GL, entity: MapEntity, profile: {
  deathTypes: Set<string>;
  veterancyLevels: Set<string>;
  exemptStatus: Set<string>;
  requiredStatus: Set<string>;
}): boolean {
  // Source parity: DieModule.cpp line 76 — wrong death type? punt.
  // C++ checks: getDeathTypeFlag(m_deathTypes, damageInfo->in.m_deathType).
  // If profile has DeathTypes, entity's actual death cause must be in the set.
  // Empty deathTypes set = ALL_DEATH_TYPES (accepts everything).
  if (profile.deathTypes.size > 0) {
    if (profile.deathTypes.has('NONE') && profile.deathTypes.size === 1) {
      return false; // Explicitly set to NONE — never fires.
    }
    // Source parity: ALL = all death types accepted (bitmask with all bits set in C++).
    if (!profile.deathTypes.has('ALL') && !profile.deathTypes.has(entity.pendingDeathType)) {
      return false;
    }
  }

  // VeterancyLevels filter (empty = all levels accepted).
  if (profile.veterancyLevels.size > 0) {
    const levelNames = ['REGULAR', 'VETERAN', 'ELITE', 'HEROIC'] as const;
    const entityLevel = levelNames[entity.experienceState.currentLevel] ?? 'REGULAR';
    if (!profile.veterancyLevels.has(entityLevel)) return false;
  }

  // ExemptStatus — entity must NOT have any of these flags.
  for (const status of profile.exemptStatus) {
    if (entity.objectStatusFlags.has(status)) return false;
  }

  // RequiredStatus — entity must have ALL of these flags.
  for (const status of profile.requiredStatus) {
    if (!entity.objectStatusFlags.has(status)) return false;
  }

  return true;
}

export function isAnyDestroyDieProfileApplicable(self: GL, entity: MapEntity): boolean {
  if (entity.destroyDieProfiles.length === 0) {
    return false;
  }
  for (const profile of entity.destroyDieProfiles) {
    if (isDieModuleApplicable(self, entity, profile)) {
      return true;
    }
  }
  return false;
}

export function awardExperienceOnKill(self: GL, victimId: number, attackerId: number): void {
  if (attackerId < 0) {
    return;
  }

  const victim = self.spawnedEntities.get(victimId);
  const attacker = self.spawnedEntities.get(attackerId);
  if (!victim || !attacker || attacker.destroyed) {
    return;
  }

  const victimProfile = victim.experienceProfile;
  if (!victimProfile) {
    return;
  }

  const attackerProfile = attacker.experienceProfile;
  if (!attackerProfile) {
    return;
  }

  // Source parity: no XP for killing allies.
  const victimSide = self.normalizeSide(victim.side);
  const attackerSide = self.normalizeSide(attacker.side);
  if (victimSide && attackerSide && victimSide === attackerSide) {
    return;
  }

  // Source parity: Object.cpp:2661 — no XP or skill points for killing things under construction.
  if (victim.objectStatusFlags.has('UNDER_CONSTRUCTION')) {
    return;
  }

  const xpGain = getExperienceValueImpl(victimProfile, victim.experienceState.currentLevel);
  if (xpGain <= 0) {
    return;
  }

  // Source parity: ExperienceTracker.cpp:150-160 — experience sink redirect.
  // When an entity has m_experienceSink set (e.g. spawned slaves redirect XP to master),
  // all XP is forwarded to the sink entity instead of being applied locally.
  let xpRecipient = attacker;
  let xpRecipientProfile = attackerProfile;
  const sinkEntityId = attacker.experienceState.experienceSinkEntityId;
  if (sinkEntityId >= 0) {
    const sinkEntity = self.spawnedEntities.get(sinkEntityId);
    if (sinkEntity && !sinkEntity.destroyed && sinkEntity.experienceProfile) {
      xpRecipient = sinkEntity;
      xpRecipientProfile = sinkEntity.experienceProfile;
    }
    // Source parity: if sink entity is dead/invalid, XP is silently discarded
    // (the C++ code returns without applying XP when sinkPointer is null).
    else {
      return;
    }
  }

  // Source parity: unit-level veterancy XP.
  const result = addExperiencePointsImpl(
    xpRecipient.experienceState,
    xpRecipientProfile,
    xpGain,
    true,
  );

  if (result.didLevelUp) {
    self.onEntityLevelUp(xpRecipient, result.oldLevel, result.newLevel);
  }

  // Source parity: Player::addSkillPointsForKill — also award player-level rank points.
  // SkillPointValue defaults to ExperienceValue when not set in INI (USE_EXP_VALUE_FOR_SKILL_VALUE sentinel).
  if (attackerSide) {
    self.addPlayerSkillPoints(attackerSide, xpGain);
  }
}

export function awardCashBountyOnKill(self: GL, victim: MapEntity, attackerId: number): void {
  if (attackerId < 0) {
    return;
  }
  const attacker = self.spawnedEntities.get(attackerId);
  if (!attacker || attacker.destroyed) {
    return;
  }
  const attackerSide = self.normalizeSide(attacker.side);
  if (!attackerSide) {
    return;
  }
  // Source parity: no bounty for killing allies or own units.
  const victimSide = self.normalizeSide(victim.side);
  if (victimSide && victimSide === attackerSide) {
    return;
  }
  // Source parity: no bounty for partially-built structures.
  if (victim.objectStatusFlags.has('UNDER_CONSTRUCTION')) {
    return;
  }
  const bountyPercent = self.sideCashBountyPercent.get(attackerSide) ?? 0;
  if (bountyPercent <= 0) {
    return;
  }
  // Resolve the victim's build cost from its template.
  const objectDef = self.resolveObjectDefByTemplateName(victim.templateName);
  if (!objectDef) {
    return;
  }
  const buildCost = self.resolveObjectBuildCost(objectDef, victim.side ?? '');
  if (buildCost <= 0) {
    return;
  }
  // Source parity: REAL_TO_INT_CEIL rounding.
  const bountyAmount = Math.ceil(buildCost * bountyPercent);
  if (bountyAmount > 0) {
    self.depositSideCredits(attackerSide, bountyAmount);
  }
}

export function cancelAndRefundAllProductionOnDeath(self: GL, producer: MapEntity): void {
  if (producer.productionQueue.length === 0) {
    return;
  }

  // Source parity: ProductionUpdate::onDie() calls cancelAndRefundAllProduction(),
  // which iterates queue entries through cancel paths to restore player money/state.
  const productionLimit = 100;
  for (let i = 0; i < productionLimit && producer.productionQueue.length > 0; i += 1) {
    const producerSide = self.resolveEntityOwnerSide(producer);
    const production = producer.productionQueue[0];
    if (!production) {
      break;
    }

    if (producerSide && production.type === 'UPGRADE' && production.upgradeType === 'PLAYER') {
      self.setSideUpgradeInProduction(producerSide, production.upgradeName, false);
    }
    if (production.type === 'UNIT') {
      self.releaseParkingDoorReservationForProduction(producer, production.productionId);
    }

    if (producerSide) {
      self.depositSideCredits(producerSide, production.buildCost);
    }
    producer.productionQueue.shift();
  }
}

export function finalizeDestroyedEntities(self: GL): void {
  const destroyedEntityIds: number[] = [];
  for (const entity of self.spawnedEntities.values()) {
    const destroyDieMatched = isAnyDestroyDieProfileApplicable(self, entity);
    if (entity.destroyed && (!entity.keepObjectOnDeath || destroyDieMatched)) {
      destroyedEntityIds.push(entity.id);
    }
  }

  if (destroyedEntityIds.length === 0) {
    return;
  }

  for (const entity of self.spawnedEntities.values()) {
    if (entity.attackTargetEntityId !== null && destroyedEntityIds.includes(entity.attackTargetEntityId)) {
      entity.attackTargetEntityId = null;
      entity.attackOriginalVictimPosition = null;
      entity.attackTargetPosition = null;
      entity.attackCommandSource = 'AI';
    }
  }

  for (const entityId of destroyedEntityIds) {
    const entity = self.spawnedEntities.get(entityId);
    if (!entity) {
      continue;
    }
    if (self.scriptCameraTetherState?.entityId === entityId) {
      self.scriptCameraTetherState = null;
    }
    if (self.scriptCameraFollowState?.entityId === entityId) {
      self.scriptCameraFollowState = null;
    }
    if (self.scriptCameraLookTowardObjectState?.entityId === entityId) {
      self.scriptCameraLookTowardObjectState = null;
    }
    if (entity.parkingSpaceProducerId !== null) {
      const producer = self.spawnedEntities.get(entity.parkingSpaceProducerId);
      if (producer?.parkingPlaceProfile) {
        producer.parkingPlaceProfile.occupiedSpaceEntityIds.delete(entity.id);
      }
      entity.parkingSpaceProducerId = null;
    }
    if (entity.helixCarrierId !== null) {
      const carrier = self.spawnedEntities.get(entity.helixCarrierId);
      if (carrier?.helixPortableRiderId === entity.id) {
        carrier.helixPortableRiderId = null;
      }
      entity.helixCarrierId = null;
    }
    if (entity.helixPortableRiderId !== null) {
      entity.helixPortableRiderId = null;
    }
    if (entity.garrisonContainerId !== null) {
      entity.garrisonContainerId = null;
    }
    if (entity.transportContainerId !== null) {
      entity.transportContainerId = null;
    }
    if (entity.tunnelContainerId !== null) {
      // Remove from tunnel tracker passenger list on final cleanup.
      const tunnel = self.spawnedEntities.get(entity.tunnelContainerId);
      if (tunnel) {
        const tracker = self.resolveTunnelTrackerForContainer(tunnel);
        if (tracker) tracker.passengerIds.delete(entity.id);
      }
      entity.tunnelContainerId = null;
    }
    if (entity.chinookHealingAirfieldId !== 0) {
      self.setChinookAirfieldForHealing(entity, 0);
    }
    self.clearParkingPlaceHealee(entity);
    self.pendingChinookCommandByEntityId.delete(entityId);
    self.pendingCombatDropActions.delete(entityId);
    self.abortPendingChinookRappels(entityId);
    self.removeEntityFromWorld(entityId);
    self.removeEntityFromSelection(entityId);
  }
}

export function cleanupDyingRenderableStates(self: GL): void {
  for (const [entityId, pending] of self.pendingDyingRenderableStates.entries()) {
    if (self.frameCounter > pending.expireFrame) {
      self.pendingDyingRenderableStates.delete(entityId);
    }
  }
}

export function checkVictoryConditions(self: GL): void {
  if (self.gameEndFrame !== null) {
    return; // Game already ended.
  }

  // Source parity: VictoryConditions::update() — `if (!TheRecorder->isMultiplayer()) return;`
  // Campaign missions use script-based victory/defeat exclusively.  The default
  // "all objects destroyed = defeat" check must not run in campaign mode.
  if (self.config.isCampaignMode) {
    return;
  }

  // Collect all active sides from playerSideByIndex.
  const activeSides = new Set<string>();
  for (const [, side] of self.playerSideByIndex) {
    if (!self.defeatedSides.has(side)) {
      activeSides.add(side);
    }
  }

  if (activeSides.size < 2) {
    return; // Need at least 2 sides for victory conditions.
  }

  // Check each active side for defeat — source parity: hasSinglePlayerBeenDefeated.
  const newlyDefeated: string[] = [];
  for (const side of activeSides) {
    if (self.hasSingleSideBeenDefeated(side)) {
      newlyDefeated.push(side);
    }
  }

  // Source parity: VictoryConditions.cpp line 192 — `if (TheGameLogic->getFrame() > 1)`
  // guards defeat processing on early frames while SkirmishScripts.scb spawns entities.
  // Guard is <= 2 (not <= 1) because the pre-init gameLogic.update(0) call in main.ts
  // consumes one frame to register fog-of-war lookers before the game loop starts.
  if (newlyDefeated.length === activeSides.size && self.frameCounter <= 2) {
    return;
  }

  // Source parity: VictoryConditions::update() — on defeat: reveal map, kill remaining units.
  for (const side of newlyDefeated) {
    self.defeatedSides.add(side);
    self.setMapRevealEntirePermanentlyForSide(side, true);
    killRemainingEntitiesForSide(self, side);
  }

  // Source parity: Check if only one alliance remains.
  // Build alliance groups — two sides are in the same alliance if both
  // consider each other ALLIES (mutual relationship, like C++ areAllies).
  const remainingSides: string[] = [];
  for (const [, side] of self.playerSideByIndex) {
    if (!self.defeatedSides.has(side) && !remainingSides.includes(side)) {
      remainingSides.push(side);
    }
  }

  if (remainingSides.length === 0) {
    // Source parity: all sides eliminated simultaneously — game ends as draw.
    if (self.defeatedSides.size > 0) {
      self.gameEndFrame = self.frameCounter;
    }
    return;
  }

  // Group remaining sides by alliance: two sides are allied if both
  // have RELATIONSHIP_ALLIES toward each other (mutual).
  const allianceGroups: string[][] = [];
  const assigned = new Set<string>();

  for (const side of remainingSides) {
    if (assigned.has(side)) continue;
    const group = [side];
    assigned.add(side);

    for (const other of remainingSides) {
      if (assigned.has(other)) continue;
      // Mutual alliance check (source parity: areAllies helper in VictoryConditions.cpp).
      if (self.getTeamRelationshipBySides(side, other) === RELATIONSHIP_ALLIES
          && self.getTeamRelationshipBySides(other, side) === RELATIONSHIP_ALLIES) {
        group.push(other);
        assigned.add(other);
      }
    }
    allianceGroups.push(group);
  }

  // Game ends when only one alliance group remains.
  if (allianceGroups.length <= 1 && self.defeatedSides.size > 0) {
    self.gameEndFrame = self.frameCounter;
  }
}

export function killRemainingEntitiesForSide(self: GL, side: string): void {
  // Source parity: evacuate containers before killing, so contained entities
  // are released and can be killed individually (prevents orphaned passengers).
  for (const entity of self.spawnedEntities.values()) {
    if (entity.destroyed) continue;
    if (self.normalizeSide(entity.side) !== side) continue;
    if (entity.containProfile && self.collectContainedEntityIds(entity.id).length > 0) {
      self.evacuateContainedEntities(entity, entity.x, entity.z, null);
    }
  }

  const toKill: number[] = [];
  for (const entity of self.spawnedEntities.values()) {
    if (entity.destroyed) continue;
    if (self.normalizeSide(entity.side) !== side) continue;
    // Don't kill projectiles/mines — they'll clean up naturally.
    if (entity.kindOf.has('PROJECTILE') || entity.kindOf.has('MINE')) continue;
    toKill.push(entity.id);
  }
  for (const entityId of toKill) {
    markEntityDestroyed(self, entityId, -1);
  }
}
