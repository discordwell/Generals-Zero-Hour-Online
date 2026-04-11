// @ts-nocheck — self is typed as any; real safety comes from the test suite.
/**
 * Spawner behavior — spawn/slave lifecycle, slaved updates, mob member AI.
 *
 * Source parity: Object/SpawnBehavior.cpp, Object/SlavedUpdate.cpp
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { readBooleanField, readNumericField, readStringField } from './ini-readers.js';
import {
  PATHFIND_CELL_SIZE,
  RELATIONSHIP_ENEMIES,
  SLAVE_CLOSE_ENOUGH,
  SLAVED_UPDATE_RATE,
  STRAY_MULTIPLIER,
  WEAPON_BONUS_DRONE_SPOTTING,
} from './index.js';
type GL = any;

// Source parity: SpawnBehavior.cpp — minimum spawn delay clamp.
// "about as rapidly as you'd expect people to successively exit through the same door"
export const SPAWN_DELAY_MIN_FRAMES = 16;

// ---- Spawner behavior implementations ----

export function extractSpawnBehaviorState(self: GL, objectDef: ObjectDef | undefined): SpawnBehaviorState | null {
  if (!objectDef) {
    return null;
  }

  let profile: SpawnBehaviorProfile | null = null;
  const visitBlock = (block: IniBlock): void => {
    if (profile !== null) {
      return;
    }
    if (block.type.toUpperCase() === 'BEHAVIOR') {
      const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
      if (moduleType === 'SPAWNBEHAVIOR') {
        const spawnNumber = Math.max(0, Math.trunc(readNumericField(block.fields, ['SpawnNumber']) ?? 0));
        const spawnReplaceDelayMs = readNumericField(block.fields, ['SpawnReplaceDelay']) ?? 0;
        const spawnReplaceDelayFrames = self.msToLogicFrames(spawnReplaceDelayMs);
        const templateNames: string[] = [];
        const templateNameRaw = readStringField(block.fields, ['SpawnTemplateName']);
        if (templateNameRaw) {
          // SpawnTemplateName is parsed with INI_PARSE_APPEND in C++, meaning
          // multiple entries accumulate. Our INI parser stores the last value,
          // so we split on whitespace to handle potential multi-token values.
          for (const token of templateNameRaw.split(/\s+/)) {
            if (token) {
              templateNames.push(token.toUpperCase());
            }
          }
        }
        const oneShot = readBooleanField(block.fields, ['OneShot']) === true;
        const spawnedRequireSpawner = readBooleanField(block.fields, ['SpawnedRequireSpawner']) === true;
        const aggregateHealth = readBooleanField(block.fields, ['AggregateHealth']) === true;
        // Source parity: C++ defaults m_initialBurst to 0 when absent from INI.
        const initialBurst = Math.max(0, Math.trunc(readNumericField(block.fields, ['InitialBurst']) ?? 0));

        const slavesHaveFreeWill = readBooleanField(block.fields, ['SlavesHaveFreeWill']) === true;
        // Source parity: SpawnBehaviorModuleData — canReclaimOrphans defaults to FALSE, exitByBudding defaults to FALSE.
        const canReclaimOrphans = readBooleanField(block.fields, ['CanReclaimOrphans']) === true;
        const exitByBudding = readBooleanField(block.fields, ['ExitByBudding']) === true;

        if (spawnNumber > 0 && templateNames.length > 0) {
          profile = {
            spawnNumber,
            spawnReplaceDelayFrames,
            spawnTemplateNames: templateNames,
            oneShot,
            spawnedRequireSpawner,
            aggregateHealth,
            initialBurst,
            slavesHaveFreeWill,
            canReclaimOrphans,
            exitByBudding,
          };
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

  if (!profile) {
    return null;
  }

  return {
    profile,
    slaveIds: [],
    replacementFrames: [],
    templateNameIndex: 0,
    oneShotRemaining: profile.oneShot ? profile.spawnNumber : -1,
    oneShotCompleted: false,
    initialBurstApplied: false,
  };
}

export function extractSlavedUpdateProfile(self: GL, objectDef: ObjectDef | undefined): SlavedUpdateProfile | null {
  if (!objectDef) return null;
  let profile: SlavedUpdateProfile | null = null;
  const visitBlock = (block: IniBlock): void => {
    if (profile) return;
    const blockType = block.type.toUpperCase();
    if (blockType === 'BEHAVIOR') {
      const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
      if (moduleType === 'SLAVEDUPDATE') {
        profile = {
          guardMaxRange: readNumericField(block.fields, ['GuardMaxRange']) ?? 0,
          guardWanderRange: readNumericField(block.fields, ['GuardWanderRange']) ?? 0,
          attackRange: readNumericField(block.fields, ['AttackRange']) ?? 0,
          attackWanderRange: readNumericField(block.fields, ['AttackWanderRange']) ?? 0,
          scoutRange: readNumericField(block.fields, ['ScoutRange']) ?? 0,
          scoutWanderRange: readNumericField(block.fields, ['ScoutWanderRange']) ?? 0,
          distToTargetToGrantRangeBonus: readNumericField(block.fields, ['DistToTargetToGrantRangeBonus']) ?? 0,
          repairRatePerSecond: readNumericField(block.fields, ['RepairRatePerSecond']) ?? 0,
          repairWhenBelowHealthPercent: readNumericField(block.fields, ['RepairWhenBelowHealth%']) ?? 0,
          // Source parity: SlavedUpdateModuleData repair fields (parseInt / parseReal / parseDurationUnsignedInt).
          repairRange: readNumericField(block.fields, ['RepairRange']) ?? 0,
          repairMinAltitude: readNumericField(block.fields, ['RepairMinAltitude']) ?? 0,
          repairMaxAltitude: readNumericField(block.fields, ['RepairMaxAltitude']) ?? 0,
          repairMinReadyFrames: self.msToLogicFrames(readNumericField(block.fields, ['RepairMinReadyTime']) ?? 0),
          repairMaxReadyFrames: self.msToLogicFrames(readNumericField(block.fields, ['RepairMaxReadyTime']) ?? 0),
          repairMinWeldFrames: self.msToLogicFrames(readNumericField(block.fields, ['RepairMinWeldTime']) ?? 0),
          repairMaxWeldFrames: self.msToLogicFrames(readNumericField(block.fields, ['RepairMaxWeldTime']) ?? 0),
          stayOnSameLayerAsMaster: readStringField(block.fields, ['StayOnSameLayerAsMaster'])?.toUpperCase() === 'YES',
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

export function extractMobMemberSlavedUpdateProfile(self: GL, objectDef: ObjectDef | undefined): MobMemberSlavedUpdateProfile | null {
  if (!objectDef) return null;
  let profile: MobMemberSlavedUpdateProfile | null = null;
  const visitBlock = (block: IniBlock): void => {
    if (profile) return;
    const blockType = block.type.toUpperCase();
    if (blockType === 'BEHAVIOR') {
      const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
      if (moduleType === 'MOBMEMBERSLAVEDUPDATE') {
        // Source parity: C++ defaults from MobMemberSlavedUpdateModuleData constructor:
        //   m_mustCatchUpRadius = DEFAULT_MUST_CATCH_UP_RADIUS (50)
        //   m_noNeedToCatchUpRadius = DEFAULT_NO_NEED_TO_CATCH_UP_RADIUS (25)
        //   m_squirrellinessRatio = 0
        //   m_catchUpCrisisBailTime = 999999
        const mustCatchUpRadius = readNumericField(block.fields, ['MustCatchUpRadius']) ?? 50;
        const noNeedToCatchUpRadius = readNumericField(block.fields, ['NoNeedToCatchUpRadius']) ?? 25;
        const squirrellinessRaw = readNumericField(block.fields, ['Squirrelliness']) ?? 0;
        // Source parity: onObjectCreated clamps to [0, MAX_SQUIRRELLINESS=1.0].
        const squirrellinessRatio = Math.min(1.0, Math.max(0, squirrellinessRaw));
        const catchUpCrisisBailTime = readNumericField(block.fields, ['CatchUpCrisisBailTime']) ?? 999999;
        profile = {
          mustCatchUpRadius,
          noNeedToCatchUpRadius,
          squirrellinessRatio,
          catchUpCrisisBailTime,
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

export function updateSpawnBehaviors(self: GL): void {
  for (const entity of self.spawnedEntities.values()) {
    if (entity.destroyed) {
      continue;
    }
    const state = entity.spawnBehaviorState;
    if (!state || (state.profile.oneShot && state.oneShotCompleted)) {
      continue;
    }

    // Prune dead slaves from the tracking list.
    state.slaveIds = state.slaveIds.filter((slaveId) => {
      const slave = self.spawnedEntities.get(slaveId);
      return slave !== undefined && !slave.destroyed;
    });

    // Process scheduled replacements.
    while (
      state.slaveIds.length < state.profile.spawnNumber
      && state.replacementFrames.length > 0
    ) {
      const nextFrame = state.replacementFrames[0];
      if (nextFrame !== undefined && self.frameCounter > nextFrame) {
        state.replacementFrames.shift();
        createSpawnSlave(self, entity, state);
      } else {
        break;
      }
    }

    // Source parity: SpawnBehavior initializes m_replacementTimes once via
    // m_initialBurstTimesInited guard. The burst creates slaves immediately up
    // to initialBurst count, then schedules the rest with spawnReplaceDelay.
    // C++ staggers burst spawns by listIndex * SPAWN_DELAY_MIN_FRAMES for
    // runtime-produced objects (factory-built, not script-placed).
    if (
      !state.initialBurstApplied
      && state.slaveIds.length < state.profile.spawnNumber
      && state.replacementFrames.length === 0
    ) {
      state.initialBurstApplied = true;
      const deficit = state.profile.spawnNumber - state.slaveIds.length;
      const runtimeProduced = entity.producerEntityId !== 0;
      let burstInitCount = state.profile.initialBurst;
      for (let i = 0; i < deficit; i += 1) {
        if (state.profile.initialBurst > 0 && runtimeProduced && burstInitCount > 0) {
          // Source parity: stagger burst spawns by SPAWN_DELAY_MIN_FRAMES intervals
          // for runtime-produced (factory-built) objects.
          burstInitCount -= 1;
          state.replacementFrames.push(self.frameCounter + i * SPAWN_DELAY_MIN_FRAMES);
        } else if (state.profile.initialBurst > 0 && state.slaveIds.length < state.profile.initialBurst) {
          // Non-runtime spawner: burst spawns immediately.
          createSpawnSlave(self, entity, state);
        } else {
          // Source parity: C++ schedules at listIndex (0, 1, 2...) when
          // m_initialBurst == 0, causing all spawns to fire on next update.
          // We schedule at frame 0 (always in the past) for the same effect.
          state.replacementFrames.push(0);
        }
      }
    }

    // Source parity: attack forwarding for SPAWNS_ARE_THE_WEAPONS masters.
    if (entity.kindOf.has('SPAWNS_ARE_THE_WEAPONS') && !state.profile.slavesHaveFreeWill) {
      const masterTarget = entity.attackTargetEntityId;
      if (masterTarget !== null) {
        for (const slaveId of state.slaveIds) {
          const slave = self.spawnedEntities.get(slaveId);
          if (slave && !slave.destroyed && slave.attackTargetEntityId !== masterTarget) {
            slave.attackTargetEntityId = masterTarget;
            slave.attackTargetPosition = null;
          }
        }
      }
    }

    let liveSlaveCount = 0;
    let totalSlaveX = 0;
    let totalSlaveY = 0;
    let totalSlaveZ = 0;
    for (const slaveId of state.slaveIds) {
      const slave = self.spawnedEntities.get(slaveId);
      if (!slave || slave.destroyed) {
        continue;
      }
      liveSlaveCount += 1;
      totalSlaveX += slave.x;
      totalSlaveY += slave.y;
      totalSlaveZ += slave.z;
    }
    if (liveSlaveCount > 0) {
      entity.healthBoxOffset = {
        x: totalSlaveX / liveSlaveCount - entity.x,
        y: totalSlaveY / liveSlaveCount - entity.y,
        z: totalSlaveZ / liveSlaveCount - entity.z,
      };
    } else {
      entity.healthBoxOffset = { x: 0, y: 0, z: 0 };
    }
  }
}

export function createSpawnSlave(self: GL, slaver: MapEntity, state: SpawnBehaviorState): void {
  if (state.slaveIds.length >= state.profile.spawnNumber) {
    return;
  }

  const templateNames = state.profile.spawnTemplateNames;
  if (templateNames.length === 0) {
    return;
  }
  const templateName = templateNames[state.templateNameIndex % templateNames.length]!;
  state.templateNameIndex = (state.templateNameIndex + 1) % templateNames.length;

  let spawnX = slaver.x;
  let spawnZ = slaver.z;
  let spawnHeightOffset = 0;
  if (
    slaver.queueProductionExitProfile
    && typeof self.resolveQueueSpawnLocation === 'function'
  ) {
    const spawnLocation = self.resolveQueueSpawnLocation(slaver);
    if (spawnLocation) {
      spawnX = spawnLocation.x;
      spawnZ = spawnLocation.z;
      spawnHeightOffset = spawnLocation.heightOffset;
    }
  }

  const slave = self.spawnEntityFromTemplate(
    templateName,
    spawnX,
    spawnZ,
    slaver.rotationY,
    slaver.side,
  );
  if (!slave) {
    return;
  }

  if (slaver.queueProductionExitProfile) {
    const terrainHeight = self.mapHeightmap ? (self.mapHeightmap.getInterpolatedHeight(spawnX, spawnZ) ?? 0) : 0;
    slave.x = spawnX;
    slave.z = spawnZ;
    slave.y = terrainHeight + spawnHeightOffset + slave.baseHeight;
  }

  // Source parity: Object::setProducer(parent) — all SpawnBehavior offspring record their producer.
  slave.producerEntityId = slaver.id;
  state.slaveIds.push(slave.id);

  if (state.profile.oneShot && state.oneShotRemaining > 0) {
    state.oneShotRemaining -= 1;
    if (state.oneShotRemaining <= 0) {
      state.oneShotCompleted = true;
    }
  }

  const hasSlavedUpdate = !!slave.slavedUpdateProfile || !!slave.mobMemberProfile;
  if (hasSlavedUpdate) {
    // Source parity: only SlavedUpdate-style spawns are enslaved to the parent.
    slave.slaverEntityId = slaver.id;

    // Source parity: ExperienceTracker.cpp — spawned slaves redirect earned XP to master.
    slave.experienceState.experienceSinkEntityId = slaver.id;

    // Source parity: onEnslave marks slaves as UNSELECTABLE.
    slave.objectStatusFlags.add('UNSELECTABLE');

    // Source parity: randomize initial guard offset at guardMaxRange distance.
    const guardRange = slave.slavedUpdateProfile?.guardMaxRange ?? 30;
    if (guardRange > 0) {
      const angle = self.gameRandom.nextFloat() * Math.PI * 2;
      slave.slaveGuardOffsetX = Math.cos(angle) * guardRange;
      slave.slaveGuardOffsetZ = Math.sin(angle) * guardRange;
    }

    // Source parity (ZH): SlavedUpdate::startSlavedEffects — if slaver is stealthed, grant
    // stealth to the slave so drones inherit their master's stealth state on creation.
    // SlavedUpdate.cpp:728-737
    if (slaver.objectStatusFlags.has('STEALTHED') && slave.stealthProfile) {
      slave.objectStatusFlags.add('CAN_STEALTH');
      slave.objectStatusFlags.add('STEALTHED');
      slave.temporaryStealthGrant = true;
      slave.stealthDelayRemaining = 0;
    }

    // Source parity: MobMemberSlavedUpdate — initialize runtime state on enslave.
    if (slave.mobMemberProfile) {
      slave.mobMemberState = {
        framesToWait: self.gameRandom.nextRange(0, 20),
        personalColorRed: 0.2 + self.gameRandom.nextFloat() * 0.2,
        personalColorGreen: 0.2 + self.gameRandom.nextFloat() * 0.2,
        personalColorBlue: 0.2 + self.gameRandom.nextFloat() * 0.2,
        catchUpCrisisTimer: 0,
        primaryVictimId: -1,
        isSelfTasking: false,
        mobState: 0, // MOB_STATE_NONE
      };
    }
  }

  if (typeof self.applyQueueProductionExitPath === 'function') {
    // Source parity: SpawnBehavior::createSpawn routes newly created objects through the
    // parent's exit interface when one exists, including SupplyCenterProductionExitUpdate.
    self.applyQueueProductionExitPath(slaver, slave);
  }
}

export function onSlaverDeath(self: GL, slaver: MapEntity): void {
  const state = slaver.spawnBehaviorState;
  if (!state) {
    return;
  }

  for (const slaveId of state.slaveIds) {
    const slave = self.spawnedEntities.get(slaveId);
    if (!slave || slave.destroyed) {
      continue;
    }
    slave.producerEntityId = 0;

    const hasSlavedUpdate = !!slave.slavedUpdateProfile || !!slave.mobMemberProfile;
    if (hasSlavedUpdate) {
      // Source parity: sdu->onSlaverDie() → stopSlavedEffects() for true slaved units only.
      slave.slaverEntityId = null;
      slave.objectStatusFlags.delete('UNSELECTABLE');

      if (state.profile.spawnedRequireSpawner) {
        // Source parity: SpawnBehavior::onDie kills slaves when spawnedRequireSpawner.
        self.applyWeaponDamageAmount(null, slave, slave.health, 'UNRESISTABLE');
      } else {
        // Source parity: orphaned slave gets DISABLED_UNMANNED.
        slave.objectStatusFlags.add('DISABLED_UNMANNED');
        // Source parity (ZH): SlavedUpdate::update — call aiIdle on slave when master dies
        // before disabling, so the slave can start crashing/falling behavior properly.
        // SlavedUpdate.cpp:162-163
        slave.attackTargetEntityId = null;
        slave.attackTargetPosition = null;
        slave.moveTarget = null;
        slave.moving = false;
      }
    } else if (state.profile.spawnedRequireSpawner) {
      self.applyWeaponDamageAmount(null, slave, slave.health, 'UNRESISTABLE');
    }
  }

  state.slaveIds = [];
  state.replacementFrames = [];
}

export function onSlaveDeath(self: GL, slave: MapEntity): void {
  const spawnerId = slave.slaverEntityId ?? (slave.producerEntityId !== 0 ? slave.producerEntityId : null);
  if (spawnerId === null) {
    return;
  }
  const slaver = self.spawnedEntities.get(spawnerId);
  if (!slaver || slaver.destroyed) {
    return;
  }
  const state = slaver.spawnBehaviorState;
  if (!state) {
    return;
  }

  // Remove from tracking.
  const index = state.slaveIds.indexOf(slave.id);
  if (index !== -1) {
    state.slaveIds.splice(index, 1);
  }

  // Schedule replacement (unless one-shot).
  // Source parity: clamp replacement delay to SPAWN_DELAY_MIN_FRAMES minimum
  // to prevent spawn timers from being set to extremely low values.
  if (!state.profile.oneShot || !state.oneShotCompleted) {
    const clampedDelay = Math.max(SPAWN_DELAY_MIN_FRAMES, state.profile.spawnReplaceDelayFrames);
    state.replacementFrames.push(self.frameCounter + clampedDelay);
  }

  // Source parity: aggregate health — spawner dies when all slaves are dead.
  if (state.profile.aggregateHealth && state.slaveIds.length === 0) {
    self.applyWeaponDamageAmount(null, slaver, slaver.health, 'UNRESISTABLE');
  }
}

export function updateSlavedEntities(self: GL): void {
  for (const entity of self.spawnedEntities.values()) {
    if (entity.destroyed || entity.slowDeathState || entity.structureCollapseState) continue;
    if (!entity.slavedUpdateProfile) continue;
    if (entity.slaverEntityId === null) continue;

    // Source parity: throttled update rate.
    if (self.frameCounter < entity.slavedNextUpdateFrame) continue;
    entity.slavedNextUpdateFrame = self.frameCounter + SLAVED_UPDATE_RATE;

    const profile = entity.slavedUpdateProfile;
    const master = self.spawnedEntities.get(entity.slaverEntityId);

    // Source parity: if master is dead or DISABLED_UNMANNED, disable slave.
    if (!master || master.destroyed || master.objectStatusFlags.has('DISABLED_UNMANNED')) {
      entity.slaverEntityId = null;
      entity.objectStatusFlags.delete('UNSELECTABLE');
      entity.objectStatusFlags.add('DISABLED_UNMANNED');
      // Source parity: slave goes idle / crashes (flying drones).
      entity.attackTargetEntityId = null;
      entity.attackTargetPosition = null;
      entity.moveTarget = null;
      entity.moving = false;
      continue;
    }

    // Source parity: clear drone spotting each tick — slave must re-earn it.
    master.weaponBonusConditionFlags &= ~WEAPON_BONUS_DRONE_SPOTTING;

    // Source parity: repair logic — heal master if below health threshold.
    const masterHealthPercent = master.maxHealth > 0 ? (master.health / master.maxHealth) * 100 : 100;
    const needsEmergencyRepair = profile.repairRatePerSecond > 0
      && profile.repairWhenBelowHealthPercent > 0
      && masterHealthPercent <= profile.repairWhenBelowHealthPercent;

    if (needsEmergencyRepair) {
      slavedDoRepair(self, entity, master, profile);
      continue;
    }

    // Source parity: attack logic — move near master's target.
    if (profile.attackRange > 0 && master.attackTargetEntityId !== null) {
      const target = self.spawnedEntities.get(master.attackTargetEntityId);
      if (target && !target.destroyed) {
        slavedDoAttack(self, entity, master, target, profile);
        continue;
      }
    }

    // Source parity: scout logic — move ahead toward master's destination.
    if (profile.scoutRange > 0 && master.moveTarget !== null) {
      const destX = master.moveTarget.x;
      const destZ = master.moveTarget.z;
      const dx = destX - master.x;
      const dz = destZ - master.z;
      const distToDest = Math.sqrt(dx * dx + dz * dz);
      // Only scout if destination is far enough from master (> half guard range).
      if (distToDest > (profile.guardMaxRange / 2)) {
        slavedDoScout(self, entity, master, destX, destZ, profile);
        continue;
      }
    }

    // Source parity: idle repair — heal master if not at full health.
    if (profile.repairRatePerSecond > 0 && master.health < master.maxHealth) {
      slavedDoRepair(self, entity, master, profile);
      continue;
    }

    // Source parity: guard logic — stay near master.
    slavedDoGuard(self, entity, master, profile);
  }
}

export function slavedDoRepair(self: GL, slave: MapEntity, master: MapEntity, profile: SlavedUpdateProfile): void {
  const dx = master.x - slave.x;
  const dz = master.z - slave.z;
  const dist = Math.sqrt(dx * dx + dz * dz);

  // Move toward master if too far.
  if (dist > SLAVE_CLOSE_ENOUGH) {
    slave.moveTarget = { x: master.x, z: master.z };
    slave.attackTargetEntityId = null;
    slave.attackTargetPosition = null;
  }

  // Source parity: heal master at repairRatePerSecond / LOGIC_FRAMES_PER_SECOND per frame.
  // Apply healing on every frame (not just throttled ticks) for smoother repair.
  if (dist <= SLAVE_CLOSE_ENOUGH * 2) {
    const healPerFrame = profile.repairRatePerSecond / 30;
    if (healPerFrame > 0) {
      master.health = Math.min(master.maxHealth, master.health + healPerFrame);
    }
  }
}

export function slavedDoAttack(self: GL, 
  slave: MapEntity, master: MapEntity, target: MapEntity, profile: SlavedUpdateProfile,
): void {
  // Calculate position near target, clamped to attackRange from master.
  let goalX = target.x;
  let goalZ = target.z;

  const dx = goalX - master.x;
  const dz = goalZ - master.z;
  const distToTarget = Math.sqrt(dx * dx + dz * dz);
  if (distToTarget > profile.attackRange && distToTarget > 0) {
    const scale = profile.attackRange / distToTarget;
    goalX = master.x + dx * scale;
    goalZ = master.z + dz * scale;
  }

  // Add wander offset.
  if (profile.attackWanderRange > 0) {
    const angle = self.gameRandom.nextFloat() * Math.PI * 2;
    const dist = self.gameRandom.nextFloat() * profile.attackWanderRange;
    goalX += Math.cos(angle) * dist;
    goalZ += Math.sin(angle) * dist;
  }

  slave.moveTarget = { x: goalX, z: goalZ };

  // Source parity: grant DRONE_SPOTTING bonus if slave is close enough to target.
  if (profile.distToTargetToGrantRangeBonus > 0) {
    const sdx = target.x - slave.x;
    const sdz = target.z - slave.z;
    const slaveDist = Math.sqrt(sdx * sdx + sdz * sdz);
    if (slaveDist <= profile.distToTargetToGrantRangeBonus) {
      master.weaponBonusConditionFlags |= WEAPON_BONUS_DRONE_SPOTTING;
    }
  }
}

export function slavedDoScout(self: GL, 
  slave: MapEntity, master: MapEntity, destX: number, destZ: number, profile: SlavedUpdateProfile,
): void {
  let goalX = destX;
  let goalZ = destZ;

  const dx = goalX - master.x;
  const dz = goalZ - master.z;
  const dist = Math.sqrt(dx * dx + dz * dz);
  if (dist > profile.scoutRange && dist > 0) {
    const scale = profile.scoutRange / dist;
    goalX = master.x + dx * scale;
    goalZ = master.z + dz * scale;
  }

  if (profile.scoutWanderRange > 0) {
    const angle = self.gameRandom.nextFloat() * Math.PI * 2;
    const wanderDist = self.gameRandom.nextFloat() * profile.scoutWanderRange;
    goalX += Math.cos(angle) * wanderDist;
    goalZ += Math.sin(angle) * wanderDist;
  }

  slave.moveTarget = { x: goalX, z: goalZ };
  slave.attackTargetEntityId = null;
  slave.attackTargetPosition = null;
}

export function slavedDoGuard(self: GL, slave: MapEntity, master: MapEntity, profile: SlavedUpdateProfile): void {
  const guardRange = profile.guardMaxRange || 30;
  const leash = STRAY_MULTIPLIER * guardRange;

  // Source parity: stray check — if beyond leash distance from master, force return.
  const masterDx = slave.x - master.x;
  const masterDz = slave.z - master.z;
  const masterDist = Math.sqrt(masterDx * masterDx + masterDz * masterDz);

  if (masterDist > leash) {
    // Beyond leash — pick new guard offset and move back.
    if (profile.guardMaxRange > 0) {
      const angle = self.gameRandom.nextFloat() * Math.PI * 2;
      slave.slaveGuardOffsetX = Math.cos(angle) * guardRange;
      slave.slaveGuardOffsetZ = Math.sin(angle) * guardRange;
    }
    const newPinnedX = master.x + slave.slaveGuardOffsetX;
    const newPinnedZ = master.z + slave.slaveGuardOffsetZ;
    slave.moveTarget = { x: newPinnedX, z: newPinnedZ };
    slave.attackTargetEntityId = null;
    slave.attackTargetPosition = null;
    return;
  }

  // Source parity: idle guard — if far from pinned position, move toward it.
  const pinnedX = master.x + slave.slaveGuardOffsetX;
  const pinnedZ = master.z + slave.slaveGuardOffsetZ;
  const dx = slave.x - pinnedX;
  const dz = slave.z - pinnedZ;
  const dist = Math.sqrt(dx * dx + dz * dz);

  if (dist > SLAVE_CLOSE_ENOUGH) {
    slave.moveTarget = { x: pinnedX, z: pinnedZ };
    slave.attackTargetEntityId = null;
    slave.attackTargetPosition = null;
  }
}

export function updateMobMemberSlaved(self: GL): void {
  for (const entity of self.spawnedEntities.values()) {
    if (entity.destroyed || entity.slowDeathState || entity.structureCollapseState) continue;
    if (!entity.mobMemberProfile || !entity.mobMemberState) continue;
    if (entity.slaverEntityId === null) continue;

    const state = entity.mobMemberState;
    const profile = entity.mobMemberProfile;

    // Source parity: C++ increments m_framesToWait each frame, skips until >= 16.
    state.framesToWait += 1;
    if (state.framesToWait < 16) continue;
    state.framesToWait = 0;

    // Source parity: find master. If dead, kill self.
    const master = self.spawnedEntities.get(entity.slaverEntityId);
    if (!master || master.destroyed) {
      // Source parity: stopSlavedEffects() + me->kill().
      entity.slaverEntityId = null;
      entity.objectStatusFlags.delete('UNSELECTABLE');
      self.applyWeaponDamageAmount(null, entity, entity.health, 'UNRESISTABLE');
      continue;
    }

    // Source parity: need master's spawn behavior for self-tasking permission check.
    const masterSpawnState = master.spawnBehaviorState;
    if (!masterSpawnState) continue;

    // Source parity: track master's current victim.
    const masterVictimId = master.attackTargetEntityId;
    if (masterVictimId !== null) {
      state.primaryVictimId = masterVictimId;
    }
    const primaryVictim = state.primaryVictimId >= 0
      ? (self.spawnedEntities.get(state.primaryVictimId) ?? null)
      : null;
    const primaryVictimAlive = primaryVictim !== null && !primaryVictim.destroyed;

    // Source parity: current victim of the mob member.
    const myVictimId = entity.attackTargetEntityId;
    const myVictim = myVictimId !== null ? (self.spawnedEntities.get(myVictimId) ?? null) : null;
    const myVictimAlive = myVictim !== null && !myVictim.destroyed;

    // Source parity: distance from me to master (squared).
    const dx = entity.x - master.x;
    const dz = entity.z - master.z;
    const distSqr = dx * dx + dz * dz;
    const mustCatchUpRadiusSqr = profile.mustCatchUpRadius * profile.mustCatchUpRadius;
    const noNeedToCatchUpRadiusSqr = profile.noNeedToCatchUpRadius * profile.noNeedToCatchUpRadius;

    if (distSqr > mustCatchUpRadiusSqr) {
      // ── CATCH-UP MODE ──
      // Source parity: master moving → check if mob member is ahead or behind.
      if (master.moving) {
        const masterGoal = master.moveTarget;
        if (masterGoal) {
          const masterDistToGoalDx = masterGoal.x - master.x;
          const masterDistToGoalDz = masterGoal.z - master.z;
          const masterDistToGoal = Math.sqrt(masterDistToGoalDx * masterDistToGoalDx + masterDistToGoalDz * masterDistToGoalDz);
          const myDistToGoalDx = masterGoal.x - entity.x;
          const myDistToGoalDz = masterGoal.z - entity.z;
          const myDistToGoal = Math.sqrt(myDistToGoalDx * myDistToGoalDx + myDistToGoalDz * myDistToGoalDz);

          if (masterDistToGoal > myDistToGoal) {
            // Source parity: I'm ahead of master, slow down (WANDER speed).
            entity.speed = Math.max(1, entity.speed * 0.6);
          } else {
            // Source parity: I'm behind, speed up (PANIC speed).
            entity.speed = Math.max(1, entity.speed * 1.5);
          }

          // Source parity: move toward master's goal unless it's at origin (error case).
          const goalLen = Math.sqrt(masterGoal.x * masterGoal.x + masterGoal.z * masterGoal.z);
          if (goalLen < 1.0) {
            // Source parity: nasty error → move directly to master.
            entity.moveTarget = { x: master.x, z: master.z };
          } else {
            // Source parity: only redirect if not already heading close enough.
            const currentGoal = entity.moveTarget;
            if (currentGoal) {
              const goalDeltaX = currentGoal.x - masterGoal.x;
              const goalDeltaZ = currentGoal.z - masterGoal.z;
              const goalDeltaDist = Math.sqrt(goalDeltaX * goalDeltaX + goalDeltaZ * goalDeltaZ);
              if (goalDeltaDist > 5.0 * PATHFIND_CELL_SIZE) {
                entity.moveTarget = { x: masterGoal.x, z: masterGoal.z };
              }
            } else {
              entity.moveTarget = { x: masterGoal.x, z: masterGoal.z };
            }
          }
        } else {
          // Master moving but no goal → move directly to master.
          entity.moveTarget = { x: master.x, z: master.z };
        }
      } else {
        // Source parity: master is still → regroup in a hurry (PANIC speed).
        entity.speed = Math.max(1, entity.speed * 1.5);
        entity.moveTarget = { x: master.x, z: master.z };
      }

      // Source parity: crisis check — critically far (> mustCatchUpRadius * 3).
      const criticalRadiusSqr = mustCatchUpRadiusSqr * 9; // (radius*3)^2 = radius^2 * 9
      if (distSqr > criticalRadiusSqr) {
        state.catchUpCrisisTimer += 1;

        if (state.catchUpCrisisTimer > profile.catchUpCrisisBailTime) {
          // Source parity: me->kill() — too far for too long.
          self.applyWeaponDamageAmount(null, entity, entity.health, 'UNRESISTABLE');
          continue;
        } else if (state.catchUpCrisisTimer > Math.trunc(profile.catchUpCrisisBailTime / 3)) {
          // Source parity: move directly to master (emergency).
          entity.moveTarget = { x: master.x, z: master.z };
        }
      }

      state.mobState = 1; // MOB_STATE_CATCHING_UP
    } else if (entity.moving && distSqr > noNeedToCatchUpRadiusSqr) {
      // ── ON THE MOVE WITH MASTER (within catch-up radius but outside no-need zone) ──
      state.catchUpCrisisTimer = 0;

      // Source parity: randomly vary locomotor speed for visual variety.
      const seed = self.gameRandom.nextRange(0, 10);
      if (seed === 1) {
        entity.speed = Math.max(1, entity.speed * 0.6); // WANDER
      } else if (seed === 2) {
        entity.speed = Math.max(1, entity.speed * 1.5); // PANIC
      } else if (seed === 3) {
        // NORMAL — restore base speed.
        // Restore base speed from active locomotor set
        const normalLoco = entity.locomotorSets.get('NORMAL');
        if (normalLoco && normalLoco.movementSpeed > 0) {
          entity.speed = normalLoco.movementSpeed;
        }
      }
    } else {
      // ── IDLE ──
      state.catchUpCrisisTimer = 0;

      if (masterSpawnState) {
        // Source parity: if master is idle → go idle, clear targets.
        if (!master.moving && master.attackTargetEntityId === null && master.attackTargetPosition === null) {
          entity.attackTargetEntityId = null;
          entity.attackTargetPosition = null;
          entity.moveTarget = null;
          entity.moving = false;
          state.primaryVictimId = -1;
          state.isSelfTasking = false;
          state.mobState = 2; // MOB_STATE_IDLE
          continue;
        }

        // Source parity: maySpawnSelfTaskAI — check squirrelliness probability.
        // C++ SpawnBehaviorInterface::maySpawnSelfTaskAI(ratio) → GameLogicRandomValueReal(0,1) < ratio.
        if (profile.squirrellinessRatio > 0 && self.gameRandom.nextFloat() < profile.squirrellinessRatio) {
          // Source parity: find nearby enemy to self-task attack.
          const scanRange = entity.visionRange > 0 ? entity.visionRange : (entity.attackWeapon?.attackRange ?? 100);
          const scanRangeSqr = scanRange * scanRange;
          let bestTarget: MapEntity | null = null;
          let bestDistSqr = Number.POSITIVE_INFINITY;

          for (const candidate of self.spawnedEntities.values()) {
            if (candidate.destroyed || !candidate.canTakeDamage) continue;
            if (candidate.id === entity.id) continue;
            if (self.getTeamRelationship(entity, candidate) !== RELATIONSHIP_ENEMIES) continue;
            if (candidate.objectStatusFlags.has('STEALTHED') && !candidate.objectStatusFlags.has('DETECTED')) continue;
            const cdx = candidate.x - entity.x;
            const cdz = candidate.z - entity.z;
            const cdistSqr = cdx * cdx + cdz * cdz;
            if (cdistSqr > scanRangeSqr) continue;
            if (cdistSqr < bestDistSqr) {
              bestTarget = candidate;
              bestDistSqr = cdistSqr;
            }
          }

          if (bestTarget && (!myVictimAlive || bestTarget.id !== myVictimId)) {
            self.issueAttackEntity(entity.id, bestTarget.id, 'AI');
            state.isSelfTasking = true;
          }
        }

        // Source parity: if still no victim → try remembered primary victim.
        if (!myVictimAlive) {
          if (primaryVictimAlive) {
            self.issueAttackEntity(entity.id, primaryVictim!.id, 'AI');
          }
          state.isSelfTasking = false;
        }
      }

      state.mobState = 2; // MOB_STATE_IDLE
    }
  }
}
