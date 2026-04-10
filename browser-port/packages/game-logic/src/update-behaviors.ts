// @ts-nocheck — self is typed as any; real safety comes from the test suite.
/**
 * Miscellaneous update behaviors — mines, crates, demo traps, battle plan, special abilities, guard, deploy, horde, bone FX, and other small update systems.
 *
 * Source parity: Object/Update/*.cpp, Object/Behavior/*.cpp
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { addExperiencePoints as addExperiencePointsImpl, LEVEL_REGULAR, LEVEL_HEROIC } from './experience.js';
import { depositSideCredits as depositSideCreditsImpl } from './side-credits.js';
import {
  resolveEffectCategory as resolveEffectCategoryImpl,
  executeCashHack as executeCashHackImpl,
  executeDefector as executeDefectorImpl,
  executeAreaDamage as executeAreaDamageImpl,
  executeEmpPulse as executeEmpPulseImpl,
  DEFAULT_CASH_HACK_AMOUNT,
  DEFAULT_AREA_DAMAGE_RADIUS,
  DEFAULT_AREA_DAMAGE_AMOUNT,
  DEFAULT_EMP_RADIUS,
  DEFAULT_EMP_DAMAGE,
} from './special-power-effects.js';
import { readNumericField, readStringField } from './ini-readers.js';
import {
  LOGIC_FRAME_RATE,
  PATHFIND_CELL_SIZE,
  RELATIONSHIP_ALLIES,
  RELATIONSHIP_ENEMIES,
  SIGNIFICANTLY_ABOVE_TERRAIN_THRESHOLD,
  WEAPON_BONUS_BOMBARDMENT,
  WEAPON_BONUS_HOLDTHELINE,
  WEAPON_BONUS_HORDE,
  WEAPON_BONUS_FANATICISM,
  WEAPON_BONUS_NATIONALISM,
  WEAPON_BONUS_SEARCHANDDESTROY,
  WEAPON_SET_FLAG_MINE_CLEARING_DETAIL,
} from './index.js';
type GL = any;


export function updateHackInternet(self: GL): void {
    for (const entity of self.spawnedEntities.values()) {
      if (entity.destroyed) {
        entity.hackInternetRuntimeState = null;
        entity.hackInternetPendingCommand = null;
        continue;
      }
      const hackState = entity.hackInternetRuntimeState;
      if (!hackState) {
        continue;
      }

      if (self.frameCounter < hackState.nextCashFrame) {
        continue;
      }

      self.depositSideCredits(entity.side, hackState.cashAmountPerCycle);
      const cycleDelay = Math.max(1, hackState.cashUpdateDelayFrames);
      hackState.nextCashFrame = self.frameCounter + cycleDelay;
    }
}


export function updatePendingHackInternetCommands(self: GL): void {
    for (const entity of self.spawnedEntities.values()) {
      if (entity.destroyed) {
        entity.hackInternetPendingCommand = null;
        continue;
      }
      const pending = entity.hackInternetPendingCommand;
      if (!pending) {
        continue;
      }

      if (self.frameCounter < pending.executeFrame) {
        continue;
      }

      entity.hackInternetPendingCommand = null;
      self.applyCommand(pending.command);
    }
}


export function getOrCreateAssaultTransportState(self: GL, entityId: number): AssaultTransportState {
    const transport = self.spawnedEntities.get(entityId);
    let state = transport?.assaultTransportState ?? self.assaultTransportStateByEntityId.get(entityId);
    if (!state) {
      state = {
        members: [],
        designatedTargetId: null,
        attackMoveGoalX: 0,
        attackMoveGoalY: transport?.y ?? 0,
        attackMoveGoalZ: 0,
        assaultState: 0,
        framesRemaining: 0,
        isAttackMove: false,
        isAttackObject: false,
        newOccupantsAreNewMembers: false,
      };
    }
    if (transport) {
      transport.assaultTransportState = state;
    }
    self.assaultTransportStateByEntityId.set(entityId, state);
    return state;
}


  /**
   * Source parity: AssaultTransportAIUpdate::update() — frame-by-frame member coordination.
   * C++ file: AssaultTransportAIUpdate.cpp lines 155-370.
   */
export function updateAssaultTransports(self: GL): void {
    for (const [transportId, state] of self.assaultTransportStateByEntityId.entries()) {
      const transport = self.spawnedEntities.get(transportId);
      if (!transport || transport.destroyed) {
        // Source parity: giveFinalOrders() — transfer commands to troops when transport dies.
        self.giveAssaultTransportFinalOrders(state);
        if (transport) {
          transport.assaultTransportState = null;
        }
        self.assaultTransportStateByEntityId.delete(transportId);
        continue;
      }
      const profile = transport.assaultTransportProfile;
      if (!profile) {
        transport.assaultTransportState = null;
        self.assaultTransportStateByEntityId.delete(transportId);
        continue;
      }

      // Source parity: cleanup dead or externally-commanded members.
      state.members = state.members.filter((member) => {
        const memberEntity = self.spawnedEntities.get(member.entityId);
        if (!memberEntity || memberEntity.destroyed) return false;
        // Source parity: if member received direct player command, release from tracking.
        if (memberEntity.attackCommandSource === 'PLAYER') return false;
        return true;
      });

      // Source parity: add new contained passengers not yet tracked.
      const containedIds = self.collectContainedEntityIds(transportId);
      for (const passengerId of containedIds) {
        if (state.members.some((m) => m.entityId === passengerId)) continue;
        if (state.members.length >= 10) break; // MAX_TRANSPORT_SLOTS
        const passenger = self.spawnedEntities.get(passengerId);
        if (!passenger || passenger.destroyed) continue;
        const isWounded = profile.membersGetHealedAtLifeRatio > 0
          && passenger.health / passenger.maxHealth < profile.membersGetHealedAtLifeRatio;
        state.members.push({
          entityId: passengerId,
          isHealing: isWounded,
          isNew: state.newOccupantsAreNewMembers,
        });
      }
      // After first sync, all future occupants are new members.
      state.newOccupantsAreNewMembers = true;

      // Source parity: C++ isAttackPointless() (lines 386-408) — abort if all members are
      // new AND the transport is currently attacking. Calls aiIdle → retrieveMembers + reset.
      if (self.entityHasObjectStatus(transport, 'IS_ATTACKING')
        && state.members.length > 0 && state.members.every((m) => m.isNew)) {
        // Source parity: aiIdle(CMD_FROM_AI) → retrieveMembers + reset.
        for (const member of state.members) {
          const memberEntity = self.spawnedEntities.get(member.entityId);
          if (memberEntity && !memberEntity.destroyed && !self.isEntityContained(memberEntity)) {
            self.commandQueue.push({
              type: 'enterTransport',
              entityId: member.entityId,
              targetTransportId: transportId,
              commandSource: 'AI',
            });
          }
        }
        state.designatedTargetId = null;
        state.isAttackObject = false;
        state.isAttackMove = false;
        continue;
      }

      // Resolve designated target.
      let target = state.designatedTargetId !== null
        ? self.spawnedEntities.get(state.designatedTargetId) ?? null
        : null;
      if (target?.destroyed) {
        target = null;
        state.designatedTargetId = null;
      }

      if (target) {
        // Source parity: coordinate members for attack-object.
        for (const member of state.members) {
          const memberEntity = self.spawnedEntities.get(member.entityId);
          if (!memberEntity || memberEntity.destroyed) continue;
          const contained = self.isEntityContained(memberEntity);
          const isHealthy = memberEntity.health >= memberEntity.maxHealth;
          const isWounded = profile.membersGetHealedAtLifeRatio > 0
            && memberEntity.health / memberEntity.maxHealth < profile.membersGetHealedAtLifeRatio;

          if (contained && isHealthy && !member.isNew) {
            // Eject healthy members.
            self.commandQueue.push({ type: 'exitContainer', entityId: member.entityId });
          } else if (!contained && isWounded) {
            // Recall wounded members.
            member.isHealing = true;
            self.commandQueue.push({
              type: 'enterTransport',
              entityId: member.entityId,
              targetTransportId: transportId,
              commandSource: 'AI',
            });
          } else if (!contained && !isWounded) {
            // Order healthy outside members to attack target.
            member.isHealing = false;
            if (memberEntity.attackTargetEntityId !== target.id) {
              self.commandQueue.push({ type: 'attackEntity', entityId: member.entityId, targetEntityId: target.id, commandSource: 'AI' });
            }
          }
        }
      } else if (state.isAttackMove) {
        // Source parity: C++ lines 322-327 — re-issue attackMoveTo to continue advancing.
        // Target died during attack-move: recall members and keep transport moving.
        for (const member of state.members) {
          const memberEntity = self.spawnedEntities.get(member.entityId);
          if (!memberEntity || memberEntity.destroyed) continue;
          if (!self.isEntityContained(memberEntity)) {
            self.commandQueue.push({
              type: 'enterTransport',
              entityId: member.entityId,
              targetTransportId: transportId,
              commandSource: 'AI',
            });
          }
        }
        state.designatedTargetId = null;
        // Re-issue attack-move to the transport itself.
        if (!transport.moving) {
          self.commandQueue.push({
            type: 'attackMoveTo',
            entityId: transportId,
            targetX: state.attackMoveGoalX,
            targetZ: state.attackMoveGoalZ,
            attackDistance: 0,
          });
        }
      } else if (state.isAttackObject) {
        // Target died — retrieve members.
        for (const member of state.members) {
          const memberEntity = self.spawnedEntities.get(member.entityId);
          if (!memberEntity || memberEntity.destroyed) continue;
          if (!self.isEntityContained(memberEntity)) {
            self.commandQueue.push({
              type: 'enterTransport',
              entityId: member.entityId,
              targetTransportId: transportId,
              commandSource: 'AI',
            });
          }
        }
        state.isAttackObject = false;
        state.designatedTargetId = null;
      }
    }
}


export function updateOvercharge(self: GL): void {
    for (const entity of self.spawnedEntities.values()) {
      if (entity.destroyed) {
        entity.overchargeActive = false;
        continue;
      }
      if (!entity.overchargeActive || !entity.overchargeBehaviorProfile) {
        continue;
      }
      const overchargeState = entity.overchargeBehaviorProfile;

      const damageAmount = (entity.maxHealth * overchargeState.healthPercentToDrainPerSecond) / LOGIC_FRAME_RATE;
      if (damageAmount > 0 && entity.canTakeDamage && entity.health > 0) {
        self.applyWeaponDamageAmount(entity.id, entity, damageAmount, 'PENALTY');
      }

      const refreshed = self.spawnedEntities.get(entity.id);
      if (!refreshed || refreshed.destroyed) {
        continue;
      }

      const minimumAllowedHealth = refreshed.maxHealth * overchargeState.notAllowedWhenHealthBelowPercent;
      if (minimumAllowedHealth > 0 && refreshed.health < minimumAllowedHealth) {
        self.disableOverchargeForEntity(refreshed);
      }
    }
}


  // ── Source parity: FlightDeckBehavior — aircraft carrier flight deck system ──────────────

  /**
   * Source parity: FlightDeckBehavior::hasReservedSpace — check if an aircraft has a parking space.
   */

  // ── Source parity: SpectreGunshipUpdate — orbital gunship update system ──────────────

  // ── Source parity: MinefieldBehavior — mine collision system ──────────────

  /**
   * Initialize mine runtime state from profile. Called once after entity creation.
   * Source parity: MinefieldBehavior constructor (MinefieldBehavior.cpp line 107).
   */
export function initializeMinefieldState(self: GL, entity: MapEntity): void {
    const prof = entity.minefieldProfile;
    if (!prof) return;
    entity.mineVirtualMinesRemaining = prof.numVirtualMines;
    entity.mineRegenerates = prof.regenerates;
    entity.mineImmunes = [];
    entity.mineDetonators = [];
    entity.mineScootFramesLeft = 0;
    entity.mineDraining = false;
    entity.mineNextDeathCheckFrame = 0;
    entity.mineIgnoreDamage = false;
    // Source parity: mines are not auto-acquirable (OBJECT_STATUS_NO_ATTACK_FROM_AI).
    entity.objectStatusFlags.add('NO_ATTACK_FROM_AI');
}


  /**
   * Source parity: MinefieldBehavior::detonateOnce (MinefieldBehavior.cpp line 275).
   * Fires the detonation weapon, decrements virtual mines, destroys if exhausted.
   */
export function detonateMineOnce(self: GL, mine: MapEntity, detX: number, detZ: number): void {
    const prof = mine.minefieldProfile!;

    // Fire detonation weapon at the detonation point.
    if (prof.detonationWeaponName) {
      const weaponDef = self.iniDataRegistry?.getWeapon(prof.detonationWeaponName);
      if (weaponDef) {
        self.fireTemporaryWeaponAtPosition(mine, weaponDef, detX, detZ);
      }
    }

    if (mine.mineVirtualMinesRemaining > 0) {
      mine.mineVirtualMinesRemaining--;
    }

    if (!mine.mineRegenerates && mine.mineVirtualMinesRemaining <= 0) {
      // Mine exhausted — destroy.
      self.markEntityDestroyed(mine.id, mine.id);
    } else {
      // Adjust health proportional to remaining mines.
      const percent = mine.mineVirtualMinesRemaining / prof.numVirtualMines;
      const desired = Math.max(0.1, percent * mine.maxHealth);
      const healthToRemove = mine.health - desired;
      if (healthToRemove > 0) {
        mine.mineIgnoreDamage = true;
        self.applyWeaponDamageAmount(mine.id, mine, healthToRemove, 'UNRESISTABLE');
        mine.mineIgnoreDamage = false;
      }
    }

    // Source parity: MASKED status when all charges spent (for regenerating mines).
    if (mine.mineVirtualMinesRemaining <= 0) {
      mine.objectStatusFlags.add('MASKED');
    } else {
      mine.objectStatusFlags.delete('MASKED');
    }

    // ZH addition: MinefieldBehavior.cpp:327-333 — execute CreationList OCL on detonation.
    if (prof.creationListName) {
      self.executeOCL(prof.creationListName, mine, undefined, mine.x, mine.z);
    }
}


  /**
   * Source parity: MinefieldBehavior::update immunity expiry and creator death drain.
   * Called per mine per frame from updateMineCollisions.
   */
export function updateMineBehavior(self: GL): void {
    for (const mine of self.spawnedEntities.values()) {
      if (!mine.minefieldProfile || mine.destroyed) continue;
      const prof = mine.minefieldProfile;

      // Expire immunity entries (C++: 2 frames after last collision).
      mine.mineImmunes = mine.mineImmunes.filter(immune => {
        const entity = self.spawnedEntities.get(immune.entityId);
        if (!entity || entity.destroyed) return false;
        return self.frameCounter <= immune.collideFrame + 2;
      });

      // Source parity: MinefieldBehavior creator death check.
      // When the creator dies and stopsRegenAfterCreatorDies is set, stop regen and start draining.
      if (mine.mineRegenerates && prof.stopsRegenAfterCreatorDies && self.frameCounter >= mine.mineNextDeathCheckFrame) {
        mine.mineNextDeathCheckFrame = self.frameCounter + LOGIC_FRAME_RATE; // Check every second.
        if (mine.mineCreatorId > 0) {
          const creator = self.spawnedEntities.get(mine.mineCreatorId);
          if (!creator || creator.destroyed) {
            mine.mineRegenerates = false;
            mine.mineDraining = true;
            // Source parity: stopHealing() on AutoHealBehavior when creator dies.
            if (mine.autoHealProfile) {
              mine.autoHealStopped = true;
              mine.autoHealNextFrame = Number.MAX_SAFE_INTEGER;
              mine.autoHealSoonestHealFrame = Number.MAX_SAFE_INTEGER;
            }
          }
        }
      }

      if (mine.mineDraining && prof.degenPercentPerSecondAfterCreatorDies > 0) {
        const drainAmount = (mine.maxHealth * prof.degenPercentPerSecondAfterCreatorDies) / LOGIC_FRAME_RATE;
        self.applyWeaponDamageAmount(mine.id, mine, drainAmount, 'UNRESISTABLE');
      }
    }
}


  /**
   * Source parity: Check if an entity is actively clearing mines.
   * AIUpdate.cpp line 3144: attacking with a WEAPON_ANTI_MINE weapon.
   */
export function isEntityClearingMines(self: GL, entity: MapEntity): boolean {
    if (!self.entityHasObjectStatus(entity, 'IS_ATTACKING')) return false;
    const weapon = entity.attackWeapon;
    if (!weapon) return false;
    return (weapon.antiMask & WEAPON_ANTI_MINE) !== 0;
}


  // ──── Salvage Crate Collision System ─────────────────────────────────────

/**
 * Source parity (ZH): MoneyCrateCollide::getUpgradedSupplyBoost — check if collector's
 * player has any completed upgrades that grant bonus money from crate pickup.
 * Returns the first matching boost amount (or 0 if none match).
 * C++ file: MoneyCrateCollide.cpp:72-94.
 */
function getUpgradedSupplyBoost(
  self: GL,
  collector: MapEntity,
  boosts: ReadonlyArray<{ upgradeName: string; amount: number }>,
): number {
  if (!collector.side) return 0;
  const side = self.normalizeSide(collector.side);
  if (!side) return 0;
  for (const boost of boosts) {
    if (self.hasSideUpgradeCompleted(side, boost.upgradeName)) {
      return boost.amount;
    }
  }
  return 0;
}

  /**
   * Source parity: CrateCollide::isValidToExecute — validate collector eligibility.
   * Checks KindOf requirements, death ownership, building pickup, human-only, etc.
   */
export function isCrateCollideEligible(self: GL, crate: MapEntity, collector: MapEntity): boolean {
    const prof = crate.crateCollideProfile!;
    // Must not be effectively dead.
    if (collector.health <= 0 || collector.destroyed) return false;
    // Source parity: neutral units cannot collect crates.
    if (!collector.side) return false;
    // Source parity: CrateCollide.cpp:166-168 — crates cannot be claimed while in the air,
    // except by buildings with BuildingPickup flag.
    const validBuildingAttempt = prof.buildingPickup && collector.kindOf.has('STRUCTURE');
    if (self.entityHasObjectStatus(crate, 'AIRBORNE_TARGET') && !validBuildingAttempt) return false;
    // Source parity (ZH): CrateCollide.cpp:188-189 — parachuting units cannot collect crates.
    if (collector.kindOf.has('PARACHUTE')) return false;
    // Source parity: must have KindOf requirements.
    if (prof.requiredKindOf.length > 0) {
      if (!prof.requiredKindOf.every(k => collector.kindOf.has(k))) return false;
    }
    // Source parity: must NOT have forbidden KindOf.
    if (prof.forbiddenKindOf.length > 0) {
      if (prof.forbiddenKindOf.some(k => collector.kindOf.has(k))) return false;
    }
    // Source parity: ForbidOwnerPlayer — dead unit's team cannot collect.
    if (prof.forbidOwnerPlayer && crate.side) {
      if (self.normalizeSide(collector.side) === self.normalizeSide(crate.side)) return false;
    }
    // Source parity: BuildingPickup — only buildings can bypass AI/movement check.
    if (!prof.buildingPickup && collector.kindOf.has('STRUCTURE')) return false;
    // Source parity: non-buildings must be able to move (have AI).
    if (!collector.kindOf.has('STRUCTURE') && !collector.canMove) return false;
    return true;
}


  /**
   * Source parity: CrateCollide::onCollide → executeCrateBehavior dispatch.
   * Routes to the appropriate crate behavior handler based on crateType.
   */
export function executeGeneralCrateBehavior(self: GL, crate: MapEntity, collector: MapEntity): void {
    const prof = crate.crateCollideProfile!;
    let success = false;
    switch (prof.crateType) {
      case 'HEAL':
        success = self.executeCrateHeal(collector);
        break;
      case 'MONEY': {
        // Source parity (ZH): MoneyCrateCollide.cpp:57 — add UpgradedBoost supply bonus.
        let totalMoney = prof.moneyProvided;
        if (prof.upgradedBoosts && prof.upgradedBoosts.length > 0) {
          totalMoney += getUpgradedSupplyBoost(self, collector, prof.upgradedBoosts);
        }
        success = self.executeCrateMoney(collector, totalMoney);
        break;
      }
      case 'VETERANCY':
        success = self.executeCrateVeterancy(crate, collector, prof);
        break;
      case 'SHROUD':
        success = self.executeCrateShroud(collector);
        break;
      case 'UNIT':
        success = self.executeCrateUnit(crate, collector, prof);
        break;
    }
    if (success) {
      self.markEntityDestroyed(crate.id, collector.id);
    }
}


  /**
   * Source parity: HealCrateCollide::executeCrateBehavior — heals all units of collector's side.
   */
export function executeCrateHeal(self: GL, collector: MapEntity): boolean {
    if (!collector.side) return false;
    const collectorSide = self.normalizeSide(collector.side);
    for (const entity of self.spawnedEntities.values()) {
      if (entity.destroyed || entity.health >= entity.maxHealth) continue;
      if (!entity.side) continue;
      if (self.normalizeSide(entity.side) !== collectorSide) continue;
      entity.health = entity.maxHealth;
    }
    return true;
}


  /**
   * Source parity: MoneyCrateCollide::executeCrateBehavior — deposits credits.
   */
export function executeCrateMoney(self: GL, collector: MapEntity, amount: number): boolean {
    if (!collector.side || amount <= 0) return false;
    depositSideCreditsImpl(self.sideCredits, self.normalizeSide(collector.side), amount);
    return true;
}


  /**
   * Source parity: VeterancyCrateCollide::executeCrateBehavior — grants veterancy levels.
   */
export function executeCrateVeterancy(self: GL, crate: MapEntity, collector: MapEntity, prof: CrateCollideProfile): boolean {
    if (!collector.experienceProfile) return false;
    if (collector.experienceState.currentLevel >= LEVEL_HEROIC) return false;

    if (prof.isPilot) {
      // Source parity: VeterancyCrateCollide::isValidToExecute / executeCrateBehavior.
      // Pilot only "enters" same-side, non-airborne targets and only while actively targeting it.
      const crateSide = crate.side ? self.normalizeSide(crate.side) : null;
      const collectorSide = collector.side ? self.normalizeSide(collector.side) : null;
      if (!crateSide || !collectorSide || crateSide !== collectorSide) return false;

      const terrainY = self.resolveGroundHeight(collector.x, collector.z);
      if ((collector.y - collector.baseHeight - terrainY) > SIGNIFICANTLY_ABOVE_TERRAIN_THRESHOLD) {
        return false;
      }

      if (crate.pilotFindVehicleTargetId !== null && crate.pilotFindVehicleTargetId !== collector.id) {
        return false;
      }
    }

    const levelsToGain = prof.addsOwnerVeterancy
      ? Math.max(1, crate.experienceState.currentLevel)
      : 1;

    if (prof.veterancyRange <= 0) {
      // Single unit effect.
      self.grantVeterancyLevels(collector, levelsToGain);
    } else {
      // Area effect — upgrade all nearby same-side units.
      const collectorSide = self.normalizeSide(collector.side ?? '');
      const rangeSq = prof.veterancyRange * prof.veterancyRange;
      for (const entity of self.spawnedEntities.values()) {
        if (entity.destroyed || !entity.experienceProfile) continue;
        if (!entity.side || self.normalizeSide(entity.side) !== collectorSide) continue;
        if (entity.experienceState.currentLevel >= LEVEL_HEROIC) continue;
        const dx = entity.x - collector.x;
        const dz = entity.z - collector.z;
        if (dx * dx + dz * dz <= rangeSq) {
          self.grantVeterancyLevels(entity, levelsToGain);
        }
      }
    }
    return true;
}


  /**
   * Source parity: ShroudCrateCollide::executeCrateBehavior — reveals entire map.
   */
export function executeCrateShroud(self: GL, collector: MapEntity): boolean {
    if (!collector.side) return false;
    // Reveal entire map for collector's side by marking all fog-of-war as revealed.
    const side = self.normalizeSide(collector.side);
    self.revealEntireMapForSide(side);
    return true;
}


  /**
   * Source parity: UnitCrateCollide::executeCrateBehavior — spawns N units nearby.
   */
export function executeCrateUnit(self: GL, crate: MapEntity, collector: MapEntity, prof: CrateCollideProfile): boolean {
    if (!prof.unitType) return false;
    const count = Math.max(1, prof.unitCount);
    for (let i = 0; i < count; i++) {
      // Find position around crate (0-20 unit radius).
      const angle = self.gameRandom.nextFloat() * Math.PI * 2;
      const radius = self.gameRandom.nextFloat() * 20;
      const spawnX = crate.x + Math.cos(angle) * radius;
      const spawnZ = crate.z + Math.sin(angle) * radius;
      const rotation = self.gameRandom.nextFloat() * Math.PI * 2 - Math.PI;
      self.spawnEntityFromTemplate(prof.unitType, spawnX, spawnZ, rotation, collector.side);
    }
    return true;
}


  /**
   * Helper: grant N veterancy levels to an entity.
   */
export function grantVeterancyLevels(self: GL, entity: MapEntity, levels: number): void {
    const profile = entity.experienceProfile;
    if (!profile) return;
    for (let i = 0; i < levels; i++) {
      const currentLevel = entity.experienceState.currentLevel;
      const targetLevel = Math.min(currentLevel + 1, LEVEL_HEROIC) as VeterancyLevel;
      if (targetLevel <= currentLevel) break;
      const xpNeeded = (profile.experienceRequired[targetLevel] ?? 0) - entity.experienceState.currentExperience;
      if (xpNeeded <= 0) break;
      const result = addExperiencePointsImpl(entity.experienceState, profile, xpNeeded, true);
      if (result.didLevelUp) {
        self.onEntityLevelUp(entity, result.oldLevel, result.newLevel);
      }
    }
}


export function clampVeterancyLevel(self: GL, level: number): VeterancyLevel {
    if (!Number.isFinite(level)) {
      return LEVEL_REGULAR;
    }
    const clamped = Math.max(LEVEL_REGULAR, Math.min(LEVEL_HEROIC, Math.trunc(level)));
    return clamped as VeterancyLevel;
}


  /**
   * Source parity: ExperienceTracker::setMinVeterancyLevel — raise veterancy to at least
   * the given level (never lowers). Used by VeterancyGainCreate::onCreate.
   * C++ file: ExperienceTracker.cpp.
   */
export function setMinVeterancyLevel(self: GL, entity: MapEntity, targetLevel: VeterancyLevel): void {
    const profile = entity.experienceProfile;
    if (!profile) return;
    if (entity.experienceState.currentLevel >= targetLevel) return;
    // Source parity: C++ ExperienceTracker::setMinVeterancyLevel directly sets level and XP
    // rather than going through addExperiencePoints. This handles edge cases where
    // experienceRequired thresholds are 0.
    const oldLevel = entity.experienceState.currentLevel;
    entity.experienceState.currentLevel = targetLevel;
    entity.experienceState.currentExperience = profile.experienceRequired[targetLevel] ?? 0;
    self.onEntityLevelUp(entity, oldLevel, targetLevel);
}


  /**
   * Source parity: SalvageCrateCollide::doMoney.
   * Deposits random money in [minMoney, maxMoney] to the collector's side.
   */
export function doSalvageMoney(self: GL, collector: MapEntity, prof: SalvageCrateProfile): void {
    let money: number;
    if (prof.minMoney !== prof.maxMoney) {
      money = self.gameRandom.nextRange(prof.minMoney, prof.maxMoney);
    } else {
      money = prof.minMoney;
    }

    if (money > 0 && collector.side) {
      depositSideCreditsImpl(self.sideCredits, self.normalizeSide(collector.side), money);
    }
}


  /**
   * Source parity: MinefieldBehavior::onDamage (MinefieldBehavior.cpp line 453).
   * Recalculates virtual mines from health ratio. When mines > expected, detonate
   * sympathetically. When mines < expected (healing), increase mine count.
   */
export function mineOnDamage(self: GL, mine: MapEntity, sourceEntityId: number | null, damageType: string): void {
    const prof = mine.minefieldProfile!;
    if (prof.numVirtualMines <= 0) return;

    // Source parity: loop until virtual mines match health-proportional expected count.
    for (let iterations = 0; iterations < prof.numVirtualMines + 1; iterations++) {
      const ratio = mine.health / mine.maxHealth;
      const virtualMinesExpectedF = prof.numVirtualMines * ratio;
      // Source parity: healing rounds down, damage rounds up.
      const virtualMinesExpected = Math.min(
        prof.numVirtualMines,
        damageType === 'HEALING'
          ? Math.floor(virtualMinesExpectedF)
          : Math.ceil(virtualMinesExpectedF),
      );

      if (mine.mineVirtualMinesRemaining < virtualMinesExpected) {
        // Healing: increase virtual mine count.
        mine.mineVirtualMinesRemaining = virtualMinesExpected;
      } else if (mine.mineVirtualMinesRemaining > virtualMinesExpected) {
        if (mine.mineDraining
            && sourceEntityId !== null && sourceEntityId === mine.id
            && damageType === 'UNRESISTABLE') {
          // Source parity: self-drain just removes a mine without detonation.
          mine.mineVirtualMinesRemaining--;
        } else {
          // Sympathetic detonation at the mine's own position.
          self.detonateMineOnce(mine, mine.x, mine.z);
        }
      } else {
        break;
      }

      if (mine.destroyed) break;
    }

    // Source parity: MASKED/regen health floor after recalculation.
    if (mine.mineVirtualMinesRemaining <= 0) {
      if (mine.mineRegenerates && mine.health < 0.1) {
        mine.health = 0.1;
      }
      mine.objectStatusFlags.add('MASKED');
    } else {
      mine.objectStatusFlags.delete('MASKED');
    }
}


export function setWorkerMineClearingDetail(self: GL, entity: MapEntity, enabled: boolean): void {
    if (!self.isWorkerEntity(entity)) {
      return;
    }
    const hasFlag = (entity.weaponSetFlagsMask & WEAPON_SET_FLAG_MINE_CLEARING_DETAIL) !== 0;
    if (enabled) {
      entity.weaponSetFlagsMask |= WEAPON_SET_FLAG_MINE_CLEARING_DETAIL;
    } else {
      entity.weaponSetFlagsMask &= ~WEAPON_SET_FLAG_MINE_CLEARING_DETAIL;
    }
    const nextHasFlag = (entity.weaponSetFlagsMask & WEAPON_SET_FLAG_MINE_CLEARING_DETAIL) !== 0;
    if (hasFlag !== nextHasFlag) {
      self.refreshEntityCombatProfiles(entity);
    }
}


export function dropWorkerSupplyBoxesIfClearingMines(self: GL, entity: MapEntity): void {
    if (!self.isWorkerEntity(entity)) {
      return;
    }
    if (!self.isEntityClearingMines(entity)) {
      return;
    }
    const state = self.supplyTruckStates.get(entity.id);
    if (!state || state.currentBoxes <= 0) {
      return;
    }
    // Source parity: WorkerAIUpdate::aiDoCommand — drop boxes when clearing mines.
    state.currentBoxes = 0;
    if (state.aiState === SupplyTruckAIState.APPROACHING_DEPOT || state.aiState === SupplyTruckAIState.DEPOSITING) {
      state.targetDepotId = null;
      state.aiState = SupplyTruckAIState.IDLE;
    }
}


  /**
   * Resolve the current guard anchor position. For guard-object mode, this
   * follows the guarded entity. For guard-position, returns the fixed point.
   */
export function resolveGuardAnchorPosition(self: GL, entity: MapEntity): { x: number; z: number } | null {
    if (entity.guardAreaTriggerIndex >= 0 && !self.mapTriggerRegions[entity.guardAreaTriggerIndex]) {
      entity.guardAreaTriggerIndex = -1;
      entity.guardState = 'NONE';
      return null;
    }
    if (entity.guardObjectId !== 0) {
      const guarded = self.spawnedEntities.get(entity.guardObjectId);
      if (!guarded || guarded.destroyed) {
        // Guarded object is gone — drop guard state.
        entity.guardState = 'NONE';
        return null;
      }
      entity.guardPositionX = guarded.x;
      entity.guardPositionZ = guarded.z;
    }
    return { x: entity.guardPositionX, z: entity.guardPositionZ };
}


  /**
   * Source parity: AIGuardMachine state updates — runs the guard state machine
   * for each guarding entity. States: IDLE → PURSUING → RETURNING → IDLE.
   */
export function updateGuardBehavior(self: GL): void {
    for (const entity of self.spawnedEntities.values()) {
      if (entity.destroyed || entity.guardState === 'NONE') {
        continue;
      }

      const anchor = self.resolveGuardAnchorPosition(entity);
      if (!anchor) {
        continue;
      }

      switch (entity.guardState) {
        case 'IDLE':
          self.updateGuardIdle(entity, anchor);
          break;
        case 'PURSUING':
          self.updateGuardPursuing(entity, anchor);
          break;
        case 'RETURNING':
          self.updateGuardReturning(entity, anchor);
          break;
      }
    }
}


  /**
   * Guard IDLE state: entity is at the guard point. Periodically scan for enemies
   * within the inner guard range. If an enemy is found, engage and transition to PURSUING.
   * Source parity: AIGuardIdleState — scan rate is m_guardEnemyScanRate (0.5s).
   */
export function updateGuardIdle(self: GL, entity: MapEntity, anchor: { x: number; z: number }): void {
    // Source parity: if guarding an object that has moved, return to it.
    if (entity.guardObjectId !== 0) {
      const dx = entity.x - anchor.x;
      const dz = entity.z - anchor.z;
      const followThreshold = PATHFIND_CELL_SIZE * 4;
      if (dx * dx + dz * dz > followThreshold * followThreshold) {
        entity.guardState = 'RETURNING';
        entity.guardNextScanFrame = self.frameCounter + self.getGuardEnemyReturnScanRateFrames();
        self.issueMoveTo(entity.id, anchor.x, anchor.z);
        return;
      }
    }

    // Throttle scanning.
    if (self.frameCounter < entity.guardNextScanFrame) {
      return;
    }
    entity.guardNextScanFrame = self.frameCounter + self.getGuardEnemyScanRateFrames();

    // Source parity: stealthed guarders don't auto-acquire.
    if (entity.objectStatusFlags.has('STEALTHED')) {
      return;
    }

    if (!entity.attackWeapon) {
      return;
    }

    // Source parity: AIStates.cpp:6744 — JetAI units that are out of ammo (and don't auto-reload)
    // should exit guard to return to base for reload, unless they are EnterGuard units.
    if (entity.jetAIProfile && !entity.enterGuard) {
      if (entity.attackWeapon && entity.attackWeapon.clipSize > 0
          && entity.attackAmmoInClip <= 0 && !entity.kindOf.has('PROJECTILE')) {
        // Out of ammo — exit guard state so JetAI return-to-base logic takes over.
        entity.guardState = 'NONE';
        return;
      }
    }

    const target = self.findGuardTarget(entity, anchor.x, anchor.z, entity.guardInnerRange);
    if (target) {
      // Source parity: AIGuardRetaliate.cpp:255-276 — EnterGuard/HijackGuard behavior.
      // Units with EnterGuard=Yes issue enter commands instead of attack commands during guard.
      if (entity.enterGuard) {
        const action = entity.hijackGuard ? 'hijackVehicle' : 'captureUnmannedFactionUnit';
        entity.guardState = 'PURSUING';
        entity.guardChaseExpireFrame = self.frameCounter + self.getGuardChaseUnitFrames();
        self.clearAttackTarget(entity.id);
        self.issueMoveTo(entity.id, target.x, target.z);
        self.setEntityPendingEnterState(entity.id, {
          targetObjectId: target.id,
          action,
          commandSource: 'AI',
        });
      } else {
        // Source parity: GUARDMODE_GUARD_WITHOUT_PURSUIT — attack only within inner range, don't chase.
        entity.guardState = 'PURSUING';
        entity.guardChaseExpireFrame = self.frameCounter + self.getGuardChaseUnitFrames();
        self.issueAttackEntity(entity.id, target.id, 'AI');
      }
    }
}


  /**
   * Guard PURSUING state: entity is chasing an enemy. Monitor for:
   * 1. Target dies/becomes invalid → GUARD_INNER scan (ZH) or RETURNING
   * 2. Target escapes outer range → RETURNING
   * 3. Chase timer expires → RETURNING
   * 4. GUARDMODE_GUARD_WITHOUT_PURSUIT — immediately return after inner-range target lost
   * 5. (ZH) ATTACK_ExitIfOutsideRadius — retaliation exits if target beyond guard range
   * Source parity: AIGuardOuterState, AIGuardRetaliateAttackAggressorState.
   */
export function updateGuardPursuing(self: GL, entity: MapEntity, anchor: { x: number; z: number }): void {
    const targetId = entity.attackTargetEntityId;
    const target = targetId !== null ? self.spawnedEntities.get(targetId) ?? null : null;

    // Target gone — Source parity (ZH): defineState(AI_GUARD_ATTACK_AGGRESSOR, ...,
    // AI_GUARD_INNER, AI_GUARD_INNER) — on success (target killed), transition to
    // GUARD_INNER which scans for new nearby targets, allowing chained attacks on
    // clustered enemies instead of immediately returning.
    if (!target || target.destroyed) {
      entity.guardRetaliating = false;
      // Source parity (ZH): AI_GUARD_INNER scan — look for another target nearby.
      if (!entity.objectStatusFlags.has('STEALTHED') && entity.attackWeapon) {
        const newTarget = self.findGuardTarget(entity, anchor.x, anchor.z, entity.guardInnerRange);
        if (newTarget) {
          entity.guardChaseExpireFrame = self.frameCounter + self.getGuardChaseUnitFrames();
          self.issueAttackEntity(entity.id, newTarget.id, 'AI');
          return;
        }
      }
      self.transitionGuardToReturning(entity, anchor);
      return;
    }

    // Source parity (ZH): AIGuardRetaliate.cpp — MaxRetaliationDistance hard cap.
    // Regardless of guard mode or outer range, if the target has moved beyond
    // MaxRetaliationDistance from the guard anchor, the unit must return.
    // This prevents guarding units from chasing artillery across the map.
    const maxRetDist = self.resolveMaxRetaliationDistance();
    if (maxRetDist > 0) {
      const retDx = target.x - anchor.x;
      const retDz = target.z - anchor.z;
      if (retDx * retDx + retDz * retDz > maxRetDist * maxRetDist) {
        self.transitionGuardToReturning(entity, anchor);
        return;
      }
      // Source parity (ZH): AIGuardRetaliate.cpp line 153-167 — also check
      // that the guarding unit itself hasn't wandered beyond the standard guard
      // range from the anchor (prevents being lured too far even if target stays nearby).
      const myDx = entity.x - anchor.x;
      const myDz = entity.z - anchor.z;
      const guardRangeSqr = entity.guardOuterRange * entity.guardOuterRange;
      if (myDx * myDx + myDz * myDz > guardRangeSqr) {
        self.transitionGuardToReturning(entity, anchor);
        return;
      }
    }

    // Source parity (ZH): AIGuardRetaliateAttackAggressorState — ATTACK_ExitIfOutsideRadius.
    // When a guard unit is retaliating against an aggressor, exit if the target moves
    // beyond the guard inner range from the anchor. This prevents indefinite pursuit of
    // aggressors that kite the guard unit away from its post.
    // C++ reference: AIGuardRetaliate.cpp:140-168, m_radiusSqr = sqr(1.5 * stdGuardRange).
    if (entity.guardRetaliating) {
      const retRadiusSqr = (1.5 * entity.guardInnerRange) * (1.5 * entity.guardInnerRange);
      const tdx = target.x - anchor.x;
      const tdz = target.z - anchor.z;
      if (tdx * tdx + tdz * tdz > retRadiusSqr) {
        entity.guardRetaliating = false;
        self.transitionGuardToReturning(entity, anchor);
        return;
      }
    }

    // GUARD_WITHOUT_PURSUIT: no outer-range chase, return immediately if target escapes inner range.
    if (entity.guardMode === 1) {
      const dx = target.x - anchor.x;
      const dz = target.z - anchor.z;
      const innerRangeSqr = entity.guardInnerRange * entity.guardInnerRange;
      if (dx * dx + dz * dz > innerRangeSqr) {
        self.transitionGuardToReturning(entity, anchor);
        return;
      }
      return;
    }

    // Source parity: AI_GUARD_INNER fights without a time limit inside inner range.
    // AI_GUARD_OUTER starts a chase timer when the target is outside inner range.
    const dx = target.x - anchor.x;
    const dz = target.z - anchor.z;
    const targetDistSqr = dx * dx + dz * dz;
    const innerRangeSqr = entity.guardInnerRange * entity.guardInnerRange;
    const outerRangeSqr = entity.guardOuterRange * entity.guardOuterRange;

    if (targetDistSqr <= innerRangeSqr) {
      // Target is in inner range — fight indefinitely, reset chase timer.
      entity.guardChaseExpireFrame = self.frameCounter + self.getGuardChaseUnitFrames();
      return;
    }

    // Target is outside inner range — check outer range and chase timer.
    if (targetDistSqr > outerRangeSqr) {
      self.transitionGuardToReturning(entity, anchor);
      return;
    }

    if (self.getGuardChaseUnitFrames() > 0 && self.frameCounter >= entity.guardChaseExpireFrame) {
      self.transitionGuardToReturning(entity, anchor);
      return;
    }
}


  /**
   * Guard RETURNING state: entity is walking back to the guard point.
   * Periodically scan for enemies along the way (source parity: m_guardEnemyReturnScanRate).
   * Transition to IDLE once arrived.
   */
export function updateGuardReturning(self: GL, entity: MapEntity, anchor: { x: number; z: number }): void {
    // Check if we've arrived at the guard point.
    if (!entity.moving) {
      const dx = entity.x - anchor.x;
      const dz = entity.z - anchor.z;
      const arrivalThreshold = PATHFIND_CELL_SIZE * 2;
      if (dx * dx + dz * dz <= arrivalThreshold * arrivalThreshold) {
        entity.guardState = 'IDLE';
        entity.guardNextScanFrame = self.frameCounter + self.getGuardEnemyScanRateFrames();
        return;
      }
      // Not moving but not at guard point — re-issue move.
      self.issueMoveTo(entity.id, anchor.x, anchor.z);
    }

    // Source parity: scan for enemies during return at a slower rate.
    if (self.frameCounter < entity.guardNextScanFrame) {
      return;
    }
    entity.guardNextScanFrame = self.frameCounter + self.getGuardEnemyReturnScanRateFrames();

    if (entity.objectStatusFlags.has('STEALTHED') || !entity.attackWeapon) {
      return;
    }

    const target = self.findGuardTarget(entity, anchor.x, anchor.z, entity.guardInnerRange);
    if (target) {
      // Source parity: AIGuardRetaliate.cpp:255-276 — EnterGuard/HijackGuard during return scan.
      if (entity.enterGuard) {
        const action = entity.hijackGuard ? 'hijackVehicle' : 'captureUnmannedFactionUnit';
        entity.guardState = 'PURSUING';
        entity.guardChaseExpireFrame = self.frameCounter + self.getGuardChaseUnitFrames();
        self.clearAttackTarget(entity.id);
        self.issueMoveTo(entity.id, target.x, target.z);
        self.setEntityPendingEnterState(entity.id, {
          targetObjectId: target.id,
          action,
          commandSource: 'AI',
        });
      } else {
        entity.guardState = 'PURSUING';
        entity.guardChaseExpireFrame = self.frameCounter + self.getGuardChaseUnitFrames();
        self.issueAttackEntity(entity.id, target.id, 'AI');
      }
    }
}


  /**
   * Transition a guarding entity back to RETURNING state: clear its attack target,
   * stop it, and issue a move back to the guard anchor position.
   */
export function transitionGuardToReturning(self: GL, entity: MapEntity, anchor: { x: number; z: number }): void {
    self.clearAttackTarget(entity.id);
    entity.guardState = 'RETURNING';
    entity.guardRetaliating = false;
    entity.guardNextScanFrame = self.frameCounter + self.getGuardEnemyReturnScanRateFrames();
    self.issueMoveTo(entity.id, anchor.x, anchor.z);
}


  // ── HordeUpdate implementation ─────────────────────────────────────────

  /**
   * Source parity: HordeUpdate::update() — periodic spatial scan to detect
   * nearby matching units. When enough units are grouped, sets HORDE weapon
   * bonus condition, granting damage/rate bonuses. Also evaluates NATIONALISM
   * and FANATICISM bonuses if the player has those upgrades.
   */

  /**
   * Source parity: EnemyNearUpdate::update — periodic scan for nearby enemies.
   * Sets/clears entity.enemyNearDetected based on whether an enemy exists within visionRange.
   * C++ file: EnemyNearUpdate.cpp lines 65-107.
   */
export function updateEnemyNear(self: GL): void {
    for (const entity of self.spawnedEntities.values()) {
      if (entity.destroyed) continue;
      if (entity.enemyNearScanDelayFrames <= 0) continue;

      // Source parity: countdown-based scan delay (decrements each frame, resets on scan).
      if (entity.enemyNearNextScanCountdown > 0) {
        entity.enemyNearNextScanCountdown--;
        continue;
      }
      // Reset countdown for next scan.
      entity.enemyNearNextScanCountdown = entity.enemyNearScanDelayFrames;

      // Source parity: TheAI->findClosestEnemy(getObject(), visionRange, AI::CAN_SEE).
      // Simplified: scan for any enemy entity within vision range.
      const visionRange = entity.visionRange;
      if (visionRange <= 0) {
        entity.enemyNearDetected = false;
        continue;
      }
      const rangeSqr = visionRange * visionRange;
      let foundEnemy = false;
      for (const candidate of self.spawnedEntities.values()) {
        if (candidate.id === entity.id || candidate.destroyed) continue;
        if (!candidate.canTakeDamage) continue;
        if (self.getTeamRelationship(entity, candidate) !== RELATIONSHIP_ENEMIES) continue;
        const dx = candidate.x - entity.x;
        const dz = candidate.z - entity.z;
        if (dx * dx + dz * dz <= rangeSqr) {
          foundEnemy = true;
          break;
        }
      }
      entity.enemyNearDetected = foundEnemy;
    }
}


  /**
   * Source parity: CheckpointUpdate::update — gate opens for allies, closes for enemies.
   * C++ file: CheckpointUpdate.cpp lines 107-171.
   * Scans for allies and enemies within vision range, adjusts geometry to allow/block passage.
   */
export function updateCheckpoints(self: GL): void {
    for (const entity of self.spawnedEntities.values()) {
      if (entity.destroyed) continue;
      const prof = entity.checkpointProfile;
      if (!prof) continue;

      const wasAllyNear = entity.checkpointAllyNear;
      const wasEnemyNear = entity.checkpointEnemyNear;

      // Source parity: C++ lines 78-95 — temporarily restore full minor radius during scan
      // to prevent oscillation when the gate is partially open and units are at the boundary.
      const geom = entity.obstacleGeometry;
      const savedMinorRadius = geom ? geom.minorRadius : 0;
      if (geom) {
        geom.minorRadius = entity.checkpointMaxMinorRadius;
      }

      // Source parity: C++ line 71 — always scan (delay code effectively disabled with `|| TRUE`).
      entity.checkpointScanCountdown = prof.scanDelayFrames;
      const visionRange = entity.visionRange;
      if (visionRange > 0) {
        const rangeSqr = visionRange * visionRange;
        let foundEnemy = false;
        let foundAlly = false;
        for (const candidate of self.spawnedEntities.values()) {
          if (candidate.id === entity.id || candidate.destroyed) continue;
          if (!candidate.canTakeDamage) continue;
          const dx = candidate.x - entity.x;
          const dz = candidate.z - entity.z;
          if (dx * dx + dz * dz > rangeSqr) continue;
          const relationship = self.getTeamRelationship(entity, candidate);
          if (relationship === RELATIONSHIP_ENEMIES) foundEnemy = true;
          else if (relationship === RELATIONSHIP_ALLIES) foundAlly = true;
          if (foundEnemy && foundAlly) break;
        }
        entity.checkpointEnemyNear = foundEnemy;
        entity.checkpointAllyNear = foundAlly;
      } else {
        entity.checkpointEnemyNear = false;
        entity.checkpointAllyNear = false;
      }

      // Restore the actual minor radius after scan.
      if (geom) {
        geom.minorRadius = savedMinorRadius;
      }

      const changed = wasAllyNear !== entity.checkpointAllyNear || wasEnemyNear !== entity.checkpointEnemyNear;
      const open = !entity.checkpointEnemyNear && entity.checkpointAllyNear;

      if (changed) {
        if (open) {
          entity.modelConditionFlags.delete('DOOR_1_CLOSING');
          entity.modelConditionFlags.add('DOOR_1_OPENING');
        } else {
          entity.modelConditionFlags.delete('DOOR_1_OPENING');
          entity.modelConditionFlags.add('DOOR_1_CLOSING');
        }
      }

      // Source parity: C++ lines 153-161 — gradually shrink/expand minor radius.
      // When open: shrink to 0 (units can pass through). When closed: expand to max.
      if (geom) {
        if (open) {
          if (geom.minorRadius > 0) {
            geom.minorRadius = Math.max(0, geom.minorRadius - 0.333);
          }
        } else {
          if (geom.minorRadius < entity.checkpointMaxMinorRadius) {
            geom.minorRadius = Math.min(entity.checkpointMaxMinorRadius, geom.minorRadius + 0.333);
          }
        }
      }
    }
}


export function updateHorde(self: GL): void {
    for (const entity of self.spawnedEntities.values()) {
      if (entity.destroyed || entity.slowDeathState || entity.structureCollapseState) continue;
      const profile = entity.hordeProfile;
      if (!profile) continue;

      // Source parity: periodic expensive scan (staggered per entity).
      if (self.frameCounter < entity.hordeNextCheckFrame) continue;
      entity.hordeNextCheckFrame = self.frameCounter + profile.updateRate;

      let join = false;
      let trueHordeMember = false;

      // Count nearby matching units (including self count implicitly via >= minCount-1).
      let nearbyCount = 0;
      const scanRangeSqr = profile.minDist * profile.minDist;
      const rubOffRadiusSqr = profile.rubOffRadius * profile.rubOffRadius;
      let nearbyTrueHordeMember = false;

      for (const candidate of self.spawnedEntities.values()) {
        if (candidate === entity) continue;
        if (candidate.destroyed || candidate.slowDeathState || candidate.structureCollapseState) continue;

        // Source parity: PartitionFilterHordeMember checks.
        // Must have HordeUpdate module.
        if (!candidate.hordeProfile) continue;

        // Source parity: ExactMatch check — same template name.
        if (profile.exactMatch && entity.templateName !== candidate.templateName) continue;

        // Source parity: KindOf filter — candidate must match ALL required kindOf flags.
        // C++ uses isKindOfMulti() with KINDOFMASK_NONE which requires all bits in mustBeSet.
        if (profile.kindOf.size > 0) {
          let allMatch = true;
          for (const k of profile.kindOf) {
            if (!candidate.kindOf.has(k)) {
              allMatch = false;
              break;
            }
          }
          if (!allMatch) continue;
        }

        // Source parity: AlliesOnly filter.
        if (profile.alliesOnly) {
          const rel = self.getTeamRelationshipBySides(
            entity.side ?? '',
            candidate.side ?? '',
          );
          if (rel !== RELATIONSHIP_ALLIES) continue;
        }

        // Distance check.
        const dx = candidate.x - entity.x;
        const dz = candidate.z - entity.z;
        const distSqr = dx * dx + dz * dz;
        if (distSqr > scanRangeSqr) continue;

        nearbyCount++;

        // Source parity: rub-off check — if any nearby matching unit is a true horde member
        // within rubOffRadius, we inherit horde status even without enough count.
        if (candidate.isTrueHordeMember && distSqr <= rubOffRadiusSqr) {
          nearbyTrueHordeMember = true;
        }
      }

      // Source parity: minCount includes self, so check >= minCount - 1 neighbors.
      if (nearbyCount >= profile.minCount - 1) {
        join = true;
        trueHordeMember = true;
      } else if (nearbyTrueHordeMember) {
        // Source parity: rub-off inheritance — close enough to a true member.
        join = true;
      }

      entity.isInHorde = join;
      entity.isTrueHordeMember = trueHordeMember;

      // Source parity: AIUpdateInterface::evaluateMoraleBonus() — always recalculate
      // and write the correct flags (C++ is idempotent, not gated on change detection).
      const oldBonusFlags = entity.weaponBonusConditionFlags;
      if (join) {
        entity.weaponBonusConditionFlags |= WEAPON_BONUS_HORDE;
      } else {
        entity.weaponBonusConditionFlags &= ~WEAPON_BONUS_HORDE;
        entity.weaponBonusConditionFlags &= ~WEAPON_BONUS_NATIONALISM;
        entity.weaponBonusConditionFlags &= ~WEAPON_BONUS_FANATICISM;
      }

      // Source parity: NATIONALISM/FANATICISM bonuses require horde + allowedNationalism + player upgrade.
      // C++ AIUpdate.cpp:4689-4700 checks player->hasUpgradeComplete() for Upgrade_Nationalism / Upgrade_Fanaticism.
      if (join) {
        if (profile.allowedNationalism) {
          const normalizedSide = self.normalizeSide(entity.side ?? '');
          const hasNationalism = self.hasSideUpgradeCompleted(normalizedSide, 'UPGRADE_NATIONALISM');
          const hasFanaticism = self.hasSideUpgradeCompleted(normalizedSide, 'UPGRADE_FANATICISM');
          if (hasNationalism) {
            entity.weaponBonusConditionFlags |= WEAPON_BONUS_NATIONALISM;
            if (hasFanaticism) {
              entity.weaponBonusConditionFlags |= WEAPON_BONUS_FANATICISM;
            } else {
              entity.weaponBonusConditionFlags &= ~WEAPON_BONUS_FANATICISM;
            }
          } else {
            entity.weaponBonusConditionFlags &= ~WEAPON_BONUS_NATIONALISM;
            entity.weaponBonusConditionFlags &= ~WEAPON_BONUS_FANATICISM;
          }
        } else {
          // Source parity: allowedNationalism=false forces nationalism/fanaticism off.
          // C++ HordeUpdate.cpp:181-184 + AIUpdate.cpp:4712-4717
          entity.weaponBonusConditionFlags &= ~WEAPON_BONUS_NATIONALISM;
          entity.weaponBonusConditionFlags &= ~WEAPON_BONUS_FANATICISM;
        }
      }
      // Source parity: Object::setWeaponBonusCondition — recalculate weapon timers on change.
      if (entity.weaponBonusConditionFlags !== oldBonusFlags) {
        self.onWeaponBonusChange(entity);
      }
    }
}


  // ── DemoTrapUpdate implementation ────────────────────────────────────────

  /**
   * Source parity: DemoTrapUpdate::update() — periodic proximity scan.
   * In proximity mode, scans nearby entities; detonates when an enemy
   * enters the trigger range (unless friendlies are blocking).
   */
export function updateDemoTraps(self: GL): void {
    for (const entity of self.spawnedEntities.values()) {
      if (entity.destroyed || entity.slowDeathState || entity.structureCollapseState) continue;
      const profile = entity.demoTrapProfile;
      if (!profile || entity.demoTrapDetonated) continue;

      // Source parity: skip while under construction or sold.
      if (entity.objectStatusFlags.has('UNDER_CONSTRUCTION') ||
          entity.objectStatusFlags.has('SOLD')) {
        continue;
      }

      // Not in proximity mode → dormant, skip scanning.
      if (!entity.demoTrapProximityMode) continue;

      // Scan throttle.
      if (self.frameCounter < entity.demoTrapNextScanFrame) continue;
      entity.demoTrapNextScanFrame = self.frameCounter + Math.max(1, profile.scanFrames);

      // Proximity scan.
      const rangeSq = profile.triggerDetonationRange * profile.triggerDetonationRange;
      let shallDetonate = false;

      for (const other of self.spawnedEntities.values()) {
        if (other === entity) continue;
        if (other.destroyed || other.slowDeathState || other.structureCollapseState) continue;

        // Source parity: isEffectivelyDead().
        if (other.health <= 0) continue;

        // IgnoreTargetTypes filter.
        if (profile.ignoreKindOf.size > 0) {
          let skip = false;
          for (const k of profile.ignoreKindOf) {
            if (other.kindOf.has(k)) { skip = true; break; }
          }
          if (skip) continue;
        }

        // Source parity: partition manager pre-filters by range. Only consider
        // entities within the trigger range for both detonation and friendly blocking.
        const dx = entity.x - other.x;
        const dz = entity.z - other.z;
        const distSq = dx * dx + dz * dz;
        if (distSq > rangeSq) continue;

        // Source parity (ZH): dozer with DISARM weapon that is actively attacking → skip.
        if (other.kindOf.has('DOZER') && other.objectStatusFlags.has('IS_ATTACKING')) {
          continue;
        }

        // Relationship check — we want to know if entity considers other to be enemy.
        const rel = self.getTeamRelationship(entity, other);
        if (rel !== RELATIONSHIP_ENEMIES) {
          if (!profile.friendlyDetonation) {
            // Non-enemy in range blocks detonation entirely.
            shallDetonate = false;
            break;
          }
          // friendlyDetonation=true → skip non-enemies, keep looking.
          continue;
        }

        // Source parity: don't detonate on anything airborne.
        if (other.kindOf.has('AIRCRAFT') && other.category === 'air') continue;

        shallDetonate = true;
        if (profile.friendlyDetonation) break; // no need to check for friendlies
      }

      if (shallDetonate) {
        self.detonateDemoTrap(entity, profile);
      }
    }
}


  /**
   * Source parity: DemoTrapUpdate::detonate() — fire temp weapon, kill self.
   */
export function detonateDemoTrap(self: GL, entity: MapEntity, profile: DemoTrapProfile): void {
    entity.demoTrapDetonated = true;

    // Fire detonation weapon at own position (if not under construction/sold).
    if (!entity.objectStatusFlags.has('UNDER_CONSTRUCTION') &&
        !entity.objectStatusFlags.has('SOLD')) {
      if (profile.detonationWeaponName) {
        const weaponDef = self.iniDataRegistry?.getWeapon(profile.detonationWeaponName);
        if (weaponDef) {
          self.fireTemporaryWeaponAtPosition(entity, weaponDef, entity.x, entity.z);
        }
      }
    }

    // Kill the trap.
    self.markEntityDestroyed(entity.id, entity.id);
}


  /**
   * Source parity: WanderAIUpdate::update — when idle, move to a random nearby position.
   * C++ file: WanderAIUpdate.cpp — used by civilian units, animals, etc.
   * C++ uses GameLogicRandomValue(5, 50) offset for both x and y.
   */
export function updateWanderAI(self: GL): void {
    for (const entity of self.spawnedEntities.values()) {
      if (entity.destroyed || entity.slowDeathState || entity.structureCollapseState) continue;
      if (!entity.hasWanderAI) continue;
      if (!entity.canMove || entity.isImmobile) continue;
      if (self.isEntityDisabledForMovement(entity)) continue;

      // Source parity (ZH): AIUpdate.cpp:3119-3127 — isIdle() checks both
      // getCurrentStateID() == AI_IDLE and isInIdleState(). We check all activity
      // states including attackTargetPosition (attack-ground) to match.
      const isIdle = !entity.moving
        && entity.attackTargetEntityId === null
        && entity.attackTargetPosition === null
        && entity.guardState === 'NONE';
      if (!isIdle) continue;

      // NOTE: C++ parity bug — offset is always positive, entities drift southeast over time.
      // C++ source (WanderAIUpdate.cpp:58-59) uses GameLogicRandomValue(5, 50) for both axes.
      const offsetX = self.gameRandom.nextRange(5, 50);
      const offsetZ = self.gameRandom.nextRange(5, 50);
      const destX = entity.x + offsetX;
      const destZ = entity.z + offsetZ;
      self.issueMoveTo(entity.id, destX, destZ);
    }
}


function resolveSpecialAbilityFacingHeading(entity: MapEntity, state: SpecialAbilityRuntimeState): number | null {
    let targetX: number | null = null;
    let targetZ: number | null = null;
    if (Number.isFinite(state.targetX) || Number.isFinite(state.targetZ)) {
      targetX = Number.isFinite(state.targetX) ? state.targetX : entity.x;
      targetZ = Number.isFinite(state.targetZ) ? state.targetZ : entity.z;
    }
    if (targetX === null || targetZ === null) {
      return null;
    }
    const dx = targetX - entity.x;
    const dz = targetZ - entity.z;
    if (Math.abs(dx) < 0.001 && Math.abs(dz) < 0.001) {
      return null;
    }
    return Math.atan2(dz, dx) + (Math.PI / 2);
}

function resolveEntityFootprintArea(entity: MapEntity): number {
    const majorRadius = Number.isFinite(entity.geometryInfo.majorRadius) ? entity.geometryInfo.majorRadius : 0;
    const minorRadius = Number.isFinite(entity.geometryInfo.minorRadius) ? entity.geometryInfo.minorRadius : majorRadius;
    if (entity.geometryInfo.shape === 'box') {
      return 4 * majorRadius * minorRadius;
    }
    return Math.PI * majorRadius * majorRadius;
}

function startSpecialAbilityFacing(entity: MapEntity, state: SpecialAbilityRuntimeState): void {
    entity.moving = false;
    entity.movePath = [];
    entity.moveTarget = null;
    state.facingInitiated = true;
    const heading = resolveSpecialAbilityFacingHeading(entity, state);
    if (heading !== null) {
      entity.rotationY = heading;
    }
}

function updateSpecialAbilityCaptureFlash(self: GL, profile: SpecialAbilityProfile, state: SpecialAbilityRuntimeState): void {
    if (!profile.doCaptureFX || state.targetEntityId === null) {
      return;
    }
    const target = self.spawnedEntities.get(state.targetEntityId);
    if (!target || target.destroyed) {
      return;
    }
    const denominator = Math.max(1, profile.preparationFrames);
    const increment = 1.0 - (Math.max(0, state.prepFrames) / denominator);
    state.captureFlashPhase += increment / 3.0;
}


  // ═══════════════════════════════════════════════════════════════════════
  // SpecialAbilityUpdate — unit special ability state machine
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Source parity: SpecialAbilityUpdate::initiateIntentToDoSpecialPower —
   * begins the special ability state machine for an entity.
   */
export function initiateSpecialAbility(self: GL, 
    entityId: number,
    targetEntityId: number | null,
    targetX: number | null,
    targetZ: number | null,
  ): void {
    const entity = self.spawnedEntities.get(entityId);
    if (!entity || entity.destroyed) return;
    const profile = entity.specialAbilityProfile;
    const state = entity.specialAbilityState;
    if (!profile || !state) return;

    // Stop current movement/combat — ability takes priority.
    // Must happen before setting active=true so cancelActiveSpecialAbility doesn't cancel the new ability.
    self.cancelEntityCommandPathActions(entityId);

    // Store target.
    state.targetEntityId = targetEntityId;
    state.targetX = targetX;
    state.targetZ = targetZ;
    state.noTargetCommand = targetEntityId === null && targetX === null;
    state.withinStartAbilityRange = false;
    state.prepFrames = 0;
    state.animFrames = 0;
    state.persistentTriggerCount = 0;
    state.facingInitiated = false;
    state.facingComplete = false;
    state.active = true;

    // Source parity: SpecialAbilityUpdate::initiateIntentToDoSpecialPower — always reset
    // packingState to PACKED, then conditionally advance to UNPACKED.
    state.packingState = 'PACKED';
    if (profile.unpackTimeFrames === 0 || (profile.skipPackingWithNoTarget && state.noTargetCommand)) {
      state.packingState = 'UNPACKED';
    }
}


  /**
   * Source parity: SpecialAbilityUpdate::update() — per-frame state machine.
   */
export function updateSpecialAbility(self: GL): void {
    for (const entity of self.spawnedEntities.values()) {
      const profile = entity.specialAbilityProfile;
      const state = entity.specialAbilityState;
      if (!profile || !state || !state.active) continue;

      // Source parity: isEffectivelyDead check — clean up ability on dying entity.
      if (entity.destroyed || entity.slowDeathState || entity.structureCollapseState) {
        self.finishSpecialAbility(entity, false);
        continue;
      }

      // ── Target validation ──
      if (state.targetEntityId !== null) {
        const target = self.spawnedEntities.get(state.targetEntityId);
        if (!target || target.destroyed || target.slowDeathState || target.structureCollapseState) {
          // Target died — abort.
          self.finishSpecialAbility(entity, false);
          continue;
        }
      }

      // ── Handle pack/unpack animation timers ──
      if (state.animFrames > 0) {
        state.animFrames--;
        if (state.animFrames <= 0) {
          if (state.packingState === 'UNPACKING') {
            state.packingState = 'UNPACKED';
            if (profile.flipOwnerAfterUnpacking) {
              entity.rotationY += Math.PI;
            }
          } else if (state.packingState === 'PACKING') {
            state.packingState = 'PACKED';
            if (profile.flipOwnerAfterPacking) {
              entity.rotationY += Math.PI;
            }
            // Packing complete → finish ability.
            self.finishSpecialAbility(entity, true);
            continue;
          }
        } else {
          continue; // Still animating.
        }
      }

      // ── Preparation countdown ──
      if (state.prepFrames > 0) {
        // Source parity: abort if target moved beyond abort range.
        if (!self.continueSpecialAbilityPreparation(entity, profile, state)) {
          // Clear capture progress on abort.
          if (state.targetEntityId !== null) {
            const abortTarget = self.spawnedEntities.get(state.targetEntityId);
            if (abortTarget) abortTarget.capturePercent = -1;
          }
          self.startSpecialAbilityPacking(entity, profile, state, false);
          continue;
        }

        updateSpecialAbilityCaptureFlash(self, profile, state);

        // Source parity: pre-trigger un-stealth.
        if (profile.loseStealthOnTrigger && profile.preTriggerUnstealthFrames > 0
          && state.prepFrames <= profile.preTriggerUnstealthFrames) {
          entity.detectedUntilFrame = Math.max(
            entity.detectedUntilFrame,
            self.frameCounter + profile.preTriggerUnstealthFrames,
          );
        }

        state.prepFrames--;

        // Source parity: update capture progress on the target building during preparation.
        if (state.targetEntityId !== null && profile.preparationFrames > 0) {
          const captureTarget = self.spawnedEntities.get(state.targetEntityId);
          if (captureTarget) {
            const totalFrames = Math.max(1, profile.preparationFrames);
            const elapsed = totalFrames - state.prepFrames;
            captureTarget.capturePercent = Math.min(100, Math.round((elapsed / totalFrames) * 100));
          }
        }

        if (state.prepFrames <= 0) {
          self.triggerSpecialAbilityEffect(entity, profile, state);

          // Source parity: persistent mode — reset prep for next trigger.
          if (profile.persistentPrepFrames > 0) {
            state.prepFrames = profile.persistentPrepFrames;
            state.persistentTriggerCount++;
            continue;
          }

          // Non-persistent: start packing.
          self.startSpecialAbilityPacking(entity, profile, state, true);
        }
        continue;
      }

      // ── Approach phase: move within StartAbilityRange ──
      if (!state.withinStartAbilityRange) {
        if (self.isWithinSpecialAbilityRange(entity, state, profile.startAbilityRange, profile)) {
          state.withinStartAbilityRange = true;
        } else {
          self.approachSpecialAbilityTarget(entity, state);
          continue;
        }
      }

      if (profile.needToFaceTarget) {
        if (state.facingInitiated && !state.facingComplete) {
          state.facingComplete = true;
        }
        if (!state.facingComplete) {
          startSpecialAbilityFacing(entity, state);
          continue;
        }
      }

      // ── Unpack phase ──
      if (state.packingState === 'PACKED') {
        self.startSpecialAbilityUnpacking(entity, profile, state);
        continue;
      }

      // ── Start preparation after unpacked ──
      if (state.packingState === 'UNPACKED') {
        // Source parity: IS_USING_ABILITY is set at start of preparation, not initiation.
        entity.objectStatusFlags.add('IS_USING_ABILITY');
        state.prepFrames = profile.preparationFrames > 0 ? profile.preparationFrames : 1;
        continue;
      }
    }
}


  /**
   * Source parity: Check if entity is within range of its special ability target.
   */
export function isWithinSpecialAbilityRange(self: GL, 
    entity: MapEntity,
    state: SpecialAbilityRuntimeState,
    range: number,
    profile?: SpecialAbilityProfile | null,
  ): boolean {
    if (state.noTargetCommand) return true;
    let tx: number;
    let tz: number;
    if (state.targetEntityId !== null) {
      const target = self.spawnedEntities.get(state.targetEntityId);
      if (!target) return true;
      tx = target.x;
      tz = target.z;
    } else if (state.targetX !== null && state.targetZ !== null) {
      tx = state.targetX;
      tz = state.targetZ;
    } else {
      return true;
    }
    const dx = entity.x - tx;
    const dz = entity.z - tz;
    if (dx * dx + dz * dz > range * range) {
      return false;
    }
    if (
      profile?.approachRequiresLOS
      && state.targetEntityId !== null
      && typeof self.isTerrainLineOfSightBlocked === 'function'
      && self.isTerrainLineOfSightBlocked(entity.x, entity.z, tx, tz)
    ) {
      return false;
    }
    return true;
}


  /**
   * Source parity: Move entity toward its special ability target.
   */
export function approachSpecialAbilityTarget(self: GL, 
    entity: MapEntity,
    state: SpecialAbilityRuntimeState,
  ): void {
    if (entity.moving) return; // Already moving.
    if (state.targetEntityId !== null) {
      const target = self.spawnedEntities.get(state.targetEntityId);
      if (target && !target.destroyed) {
        self.issueMoveTo(entity.id, target.x, target.z);
      }
    } else if (state.targetX !== null && state.targetZ !== null) {
      self.issueMoveTo(entity.id, state.targetX, state.targetZ);
    }
}


  /**
   * Source parity: Start the unpack animation.
   */
export function startSpecialAbilityUnpacking(self: GL, 
    entity: MapEntity,
    profile: SpecialAbilityProfile,
    state: SpecialAbilityRuntimeState,
  ): void {
    if (profile.unpackTimeFrames <= 0) {
      state.packingState = 'UNPACKED';
      return;
    }
    state.packingState = 'UNPACKING';
    const variation = profile.packUnpackVariationFactor > 0
      ? 1.0 + (self.gameRandom.nextFloat() * 2 - 1) * profile.packUnpackVariationFactor
      : 1.0;
    state.animFrames = Math.max(1, Math.round(profile.unpackTimeFrames * variation));
    // Stop movement during unpack.
    entity.moving = false;
    entity.movePath = [];
    entity.moveTarget = null;
}


  /**
   * Source parity: Start the pack animation.
   */
export function startSpecialAbilityPacking(self: GL, 
    entity: MapEntity,
    profile: SpecialAbilityProfile,
    state: SpecialAbilityRuntimeState,
    _success: boolean,
  ): void {
    if (profile.packTimeFrames <= 0 ||
        (profile.skipPackingWithNoTarget && state.noTargetCommand)) {
      // No packing needed — finish immediately.
      self.finishSpecialAbility(entity, _success);
      return;
    }
    state.packingState = 'PACKING';
    const variation = profile.packUnpackVariationFactor > 0
      ? 1.0 + (self.gameRandom.nextFloat() * 2 - 1) * profile.packUnpackVariationFactor
      : 1.0;
    state.animFrames = Math.max(1, Math.round(profile.packTimeFrames * variation));
}


  /**
   * Source parity: continuePreparation — check abort conditions during preparation.
   * Returns false if the ability should be aborted.
   */
export function continueSpecialAbilityPreparation(self: GL, 
    entity: MapEntity,
    profile: SpecialAbilityProfile,
    state: SpecialAbilityRuntimeState,
  ): boolean {
    const HUGE_DISTANCE = 10000000.0;
    if (profile.abilityAbortRange < HUGE_DISTANCE) {
      if (!self.isWithinSpecialAbilityRange(entity, state, profile.abilityAbortRange, null)) {
        return false;
      }
    }
    return true;
}


  /**
   * Source parity: triggerAbilityEffect — execute the ability's actual effect.
   * Delegates to the existing special-power-effects infrastructure via lastSpecialPowerDispatch.
   */
export function triggerSpecialAbilityEffect(self: GL, 
    entity: MapEntity,
    profile: SpecialAbilityProfile,
    state: SpecialAbilityRuntimeState,
  ): void {
    // Source parity: LoseStealthOnTrigger.
    if (profile.loseStealthOnTrigger) {
      entity.detectedUntilFrame = Math.max(
        entity.detectedUntilFrame,
        self.frameCounter + LOGIC_FRAME_RATE * 2,
      );
    }

    // Source parity: award XP for triggering.
    if (profile.awardXPForTriggering > 0 && entity.experienceProfile) {
      const xpResult = addExperiencePointsImpl(
        entity.experienceState,
        entity.experienceProfile,
        profile.awardXPForTriggering,
        false,
      );
      if (xpResult.didLevelUp) {
        self.onEntityLevelUp(entity, xpResult.oldLevel, xpResult.newLevel);
      }
    }

    // Execute the effect based on the last dispatch record.
    const dispatch = entity.lastSpecialPowerDispatch;
    if (!dispatch) return;

    const effectContext = self.createSpecialPowerEffectContext();
    const sourceSide = entity.side ?? '';

    if (state.targetEntityId !== null) {
      // Object-targeted ability: cash hack, defector, capture building, etc.
      const module = entity.specialPowerModules.get(profile.specialPowerTemplateName);
      if (!module) return;
      const effectCategory = resolveEffectCategoryImpl(module.moduleType);
      const specialPowerDef = self.resolveSpecialPowerDefByName(profile.specialPowerTemplateName);
      const spEnum = specialPowerDef
        ? (readStringField(specialPowerDef.fields, ['Enum'])?.trim().toUpperCase() ?? '')
        : '';
      switch (effectCategory) {
        case 'CASH_HACK':
          executeCashHackImpl({
            sourceEntityId: entity.id,
            sourceSide,
            targetEntityId: state.targetEntityId,
            amountToSteal: module.cashHackMoneyAmount > 0
              ? module.cashHackMoneyAmount : DEFAULT_CASH_HACK_AMOUNT,
          }, effectContext);
          break;
        case 'DEFECTOR':
          {
            const specialPowerDef = self.resolveSpecialPowerDefByName(profile.specialPowerTemplateName);
            const detectionFrames = specialPowerDef
              ? self.msToLogicFrames(readNumericField(specialPowerDef.fields, ['DetectionTime']) ?? 0)
              : 0;
          executeDefectorImpl({
            sourceEntityId: entity.id,
            sourceSide,
            targetEntityId: state.targetEntityId,
            detectionFrames,
          }, effectContext);
          }
          break;
        default: {
          const target = self.spawnedEntities.get(state.targetEntityId);
          if (!target || target.destroyed) {
            break;
          }
          if (
            spEnum === 'SPECIAL_HACKER_DISABLE_BUILDING'
            || spEnum === 'SPECIAL_BLACKLOTUS_DISABLE_VEHICLE_HACK'
          ) {
            if (self.getTeamRelationship(entity, target) === RELATIONSHIP_ALLIES) {
              break;
            }
            self.setDisabledHackedStatusUntil(target, self.frameCounter + profile.effectDurationFrames);
            if (target.kindOf.has('STRUCTURE') && resolveEntityFootprintArea(target) < 300) {
              state.doDisableFxParticles = !(state.doDisableFxParticles ?? true);
            }
            break;
          }
          // Source parity: SpecialAbilityUpdate::triggerAbilityEffect —
          // SPECIAL_INFANTRY_CAPTURE_BUILDING / SPECIAL_BLACKLOTUS_CAPTURE_BUILDING
          // transfer ownership of target building to source's side via Object::defect().
          if (spEnum === 'SPECIAL_INFANTRY_CAPTURE_BUILDING'
              || spEnum === 'SPECIAL_BLACKLOTUS_CAPTURE_BUILDING') {
            // Source parity: if target building has garrison occupants, evacuate them first.
            if (target.containProfile
                && target.containProfile.garrisonCapacity > 0) {
              self.evacuateContainedEntities(target.id, true);
            }
            // Source parity: target->defect(object->getControllingPlayer()->getDefaultTeam())
            effectContext.changeEntitySide(state.targetEntityId, sourceSide);
            // Clear capture progress on the target.
            target.capturePercent = -1;
          }
          break;
        }
      }
    } else if (state.targetX !== null && state.targetZ !== null) {
      // Position-targeted ability.
      const module = entity.specialPowerModules.get(profile.specialPowerTemplateName);
      if (!module) return;
      const effectCategory = resolveEffectCategoryImpl(module.moduleType);
      switch (effectCategory) {
        case 'AREA_DAMAGE':
          executeAreaDamageImpl({
            sourceEntityId: entity.id,
            sourceSide,
            targetX: state.targetX,
            targetZ: state.targetZ,
            radius: module.areaDamageRadius > 0 ? module.areaDamageRadius : DEFAULT_AREA_DAMAGE_RADIUS,
            damage: module.areaDamageAmount > 0 ? module.areaDamageAmount : DEFAULT_AREA_DAMAGE_AMOUNT,
            damageType: 'EXPLOSION',
          }, effectContext);
          break;
        case 'EMP_PULSE':
          executeEmpPulseImpl({
            sourceEntityId: entity.id,
            sourceSide,
            targetX: state.targetX,
            targetZ: state.targetZ,
            radius: module.areaDamageRadius > 0 ? module.areaDamageRadius : DEFAULT_EMP_RADIUS,
            damage: module.areaDamageAmount > 0 ? module.areaDamageAmount : DEFAULT_EMP_DAMAGE,
          }, effectContext);
          break;
      }
    }
    // No-target abilities have their effects triggered inline (e.g., cash bounty already handled).
}


  /**
   * Source parity: finishAbility + onExit — clean up after ability completion or abort.
   */
export function finishSpecialAbility(self: GL, entity: MapEntity, _success: boolean): void {
    const profile = entity.specialAbilityProfile;
    const state = entity.specialAbilityState;
    if (!state) return;

    // Clear capture progress on the target building when ability finishes/aborts.
    if (state.targetEntityId !== null) {
      const captureTarget = self.spawnedEntities.get(state.targetEntityId);
      if (captureTarget && captureTarget.capturePercent >= 0) {
        captureTarget.capturePercent = -1;
      }
    }

    state.active = false;
    state.targetEntityId = null;
    state.targetX = null;
    state.targetZ = null;
    state.prepFrames = 0;
    state.animFrames = 0;
    state.withinStartAbilityRange = false;
    state.noTargetCommand = false;
    state.persistentTriggerCount = 0;

    // Source parity: onExit sets m_packingState = STATE_NONE.
    // We use 'PACKED' as the idle representation since initiateSpecialAbility always resets it.
    state.packingState = 'PACKED';

    entity.objectStatusFlags.delete('IS_USING_ABILITY');

    // Source parity: flee after completion.
    // C++ uses forward (facing) direction when flip flags are set, backward otherwise.
    if (_success && profile && profile.fleeRangeAfterCompletion > 0) {
      const fleeDist = profile.fleeRangeAfterCompletion;
      const flipped = profile.flipOwnerAfterUnpacking || profile.flipOwnerAfterPacking;
      const fleeAngle = flipped ? entity.rotationY : entity.rotationY + Math.PI;
      const fleeX = entity.x + Math.cos(fleeAngle) * fleeDist;
      const fleeZ = entity.z + Math.sin(fleeAngle) * fleeDist;
      self.issueMoveTo(entity.id, fleeX, fleeZ);
    }
}


  /**
   * Source parity: DeployStyleAIUpdate::update() — per-frame deploy state machine.
   * Transitions: READY_TO_MOVE ↔ DEPLOY ↔ READY_TO_ATTACK ↔ UNDEPLOY ↔ READY_TO_MOVE.
   * Timer-based: DEPLOY finishes after unpackTime, UNDEPLOY finishes after packTime.
   * Reversal: mid-deploy/undeploy can be reversed at current progress frame.
   */
export function updateDeployStyleEntities(self: GL): void {
    for (const entity of self.spawnedEntities.values()) {
      if (entity.destroyed || entity.slowDeathState || entity.structureCollapseState) continue;
      const profile = entity.deployStyleProfile;
      if (!profile) continue;

      const isTryingToAttack = entity.attackTargetEntityId !== null || entity.attackTargetPosition !== null;
      const isTryingToMove = entity.moving || entity.moveTarget !== null;

      // Check timer expiry for DEPLOY/UNDEPLOY transitions.
      if (entity.deployFrameToWait !== 0 && self.frameCounter >= entity.deployFrameToWait) {
        if (entity.deployState === 'DEPLOY') {
          self.setDeployState(entity, 'READY_TO_ATTACK');
        } else if (entity.deployState === 'UNDEPLOY') {
          self.setDeployState(entity, 'READY_TO_MOVE');
        }
      }

      // Source parity: If trying to attack (or idle auto-target will engage), deploy.
      if (isTryingToAttack) {
        switch (entity.deployState) {
          case 'READY_TO_MOVE':
            self.setDeployState(entity, 'DEPLOY');
            break;
          case 'READY_TO_ATTACK':
            // Already deployed — let combat system handle attacking.
            break;
          case 'DEPLOY':
            // Still deploying — wait for timer.
            break;
          case 'UNDEPLOY':
            // Reverse the undeploy.
            if (entity.deployFrameToWait !== 0) {
              self.reverseDeployTransition(entity, 'DEPLOY', profile.unpackTimeFrames);
            }
            break;
        }
      } else if (isTryingToMove) {
        // Source parity: If trying to move, undeploy.
        switch (entity.deployState) {
          case 'READY_TO_MOVE':
            // Already mobile — movement system handles it.
            break;
          case 'READY_TO_ATTACK':
            self.setDeployState(entity, 'UNDEPLOY');
            break;
          case 'DEPLOY':
            // Reverse the deploy.
            if (entity.deployFrameToWait !== 0) {
              // Source parity: C++ setMyState(UNDEPLOY, TRUE) uses getUnpackTime() for both reversal directions.
              self.reverseDeployTransition(entity, 'UNDEPLOY', profile.unpackTimeFrames);
            }
            break;
          case 'UNDEPLOY':
            // Still undeploying — wait for timer.
            break;
        }
      }

      // Source parity: Block movement during DEPLOY/UNDEPLOY/READY_TO_ATTACK.
      if (entity.deployState !== 'READY_TO_MOVE') {
        entity.moving = false;
      }
    }
}


export function setDeployState(self: GL, entity: MapEntity, state: DeployState): void {
    const profile = entity.deployStyleProfile;
    if (!profile) return;
    entity.deployState = state;
    switch (state) {
      case 'DEPLOY':
        entity.deployFrameToWait = self.frameCounter + profile.unpackTimeFrames;
        entity.objectStatusFlags.delete('DEPLOYED');
        break;
      case 'UNDEPLOY':
        entity.deployFrameToWait = self.frameCounter + profile.packTimeFrames;
        entity.objectStatusFlags.delete('DEPLOYED');
        break;
      case 'READY_TO_ATTACK':
        entity.deployFrameToWait = 0;
        entity.objectStatusFlags.add('DEPLOYED');
        break;
      case 'READY_TO_MOVE':
        entity.deployFrameToWait = 0;
        entity.objectStatusFlags.delete('DEPLOYED');
        // Source parity: re-enable movement if a pending move target exists.
        if (entity.moveTarget !== null && entity.movePath.length > 0) {
          entity.moving = true;
        }
        break;
    }
}


export function reverseDeployTransition(self: GL, entity: MapEntity, newState: DeployState, totalFrames: number): void {
    const framesLeft = Math.max(0, entity.deployFrameToWait - self.frameCounter);
    entity.deployState = newState;
    entity.deployFrameToWait = self.frameCounter + (totalFrames - framesLeft);
}


  /**
   * Source parity: BoneFXUpdate::update — fire FX/OCL/ParticleSystem effects on named bones
   * when scheduled frames are reached. Initializes times on first activation.
   * (GeneralsMD/Code/GameEngine/Source/GameLogic/Object/Update/BoneFXUpdate.cpp:290-317)
   */
export function updateBoneFX(self: GL): void {
    const now = self.frameCounter;
    for (const entity of self.spawnedEntities.values()) {
      if (entity.destroyed) continue;
      if (!entity.boneFXProfile || !entity.boneFXState) continue;
      if (entity.objectStatusFlags.has('UNDER_CONSTRUCTION')) continue;

      const profile = entity.boneFXProfile;
      const state = entity.boneFXState;

      // Clear pending visual events from previous frame.
      state.pendingVisualEvents.length = 0;

      // Source parity: if not active, initTimes and set active.
      if (!state.active) {
        self.boneFXInitTimes(profile, state);
        state.active = true;
      }

      const bodyState = state.currentBodyState;
      const numBones = 8;

      for (let i = 0; i < numBones; i++) {
        const fxRow = state.nextFXFrame[bodyState]!;
        const oclRow = state.nextOCLFrame[bodyState]!;
        const psRow = state.nextParticleFrame[bodyState]!;

        // Check FXList
        if (fxRow[i] !== -1 && fxRow[i]! <= now) {
          const entry = profile.fxLists[bodyState]?.[i];
          if (entry) {
            state.pendingVisualEvents.push({
              type: 'FX',
              boneName: entry.boneName,
              effectName: entry.effectName,
              positionX: entity.x,
              positionY: entity.y,
              positionZ: entity.z,
              entityId: entity.id,
            });
            if (entry.onlyOnce) {
              fxRow[i] = -1;
            } else {
              const delay = entry.delayMinFrames === entry.delayMaxFrames
                ? entry.delayMinFrames
                : self.gameRandom.nextRange(entry.delayMinFrames, entry.delayMaxFrames);
              fxRow[i] = now + delay;
            }
          }
        }

        // Check OCL
        if (oclRow[i] !== -1 && oclRow[i]! <= now) {
          const entry = profile.oclLists[bodyState]?.[i];
          if (entry) {
            state.pendingVisualEvents.push({
              type: 'OCL',
              boneName: entry.boneName,
              effectName: entry.effectName,
              positionX: entity.x,
              positionY: entity.y,
              positionZ: entity.z,
              entityId: entity.id,
            });
            if (entry.onlyOnce) {
              oclRow[i] = -1;
            } else {
              const delay = entry.delayMinFrames === entry.delayMaxFrames
                ? entry.delayMinFrames
                : self.gameRandom.nextRange(entry.delayMinFrames, entry.delayMaxFrames);
              oclRow[i] = now + delay;
            }
          }
        }

        // Check ParticleSystem
        if (psRow[i] !== -1 && psRow[i]! <= now) {
          const entry = profile.particleSystems[bodyState]?.[i];
          if (entry) {
            state.pendingVisualEvents.push({
              type: 'PARTICLE_SYSTEM',
              boneName: entry.boneName,
              effectName: entry.effectName,
              positionX: entity.x,
              positionY: entity.y,
              positionZ: entity.z,
              entityId: entity.id,
            });
            if (entry.onlyOnce) {
              psRow[i] = -1;
            } else {
              const delay = entry.delayMinFrames === entry.delayMaxFrames
                ? entry.delayMinFrames
                : self.gameRandom.nextRange(entry.delayMinFrames, entry.delayMaxFrames);
              psRow[i] = now + delay;
            }
          }
        }
      }
    }
}


  /**
   * Source parity: BoneFXUpdate::initTimes — schedule initial fire times for current damage state.
   * (GeneralsMD/Code/GameEngine/Source/GameLogic/Object/Update/BoneFXUpdate.cpp:321-343)
   */
export function boneFXInitTimes(self: GL, profile: BoneFXProfile, state: BoneFXState): void {
    const now = self.frameCounter;
    const bodyState = state.currentBodyState;
    const numBones = 8;
    const fxRow = state.nextFXFrame[bodyState]!;
    const oclRow = state.nextOCLFrame[bodyState]!;
    const psRow = state.nextParticleFrame[bodyState]!;

    for (let i = 0; i < numBones; i++) {
      // FXList
      const fxEntry = profile.fxLists[bodyState]?.[i];
      if (fxEntry) {
        const delay = fxEntry.delayMinFrames === fxEntry.delayMaxFrames
          ? fxEntry.delayMinFrames
          : self.gameRandom.nextRange(fxEntry.delayMinFrames, fxEntry.delayMaxFrames);
        fxRow[i] = now + delay;
      } else {
        fxRow[i] = -1;
      }

      // OCL
      const oclEntry = profile.oclLists[bodyState]?.[i];
      if (oclEntry) {
        const delay = oclEntry.delayMinFrames === oclEntry.delayMaxFrames
          ? oclEntry.delayMinFrames
          : self.gameRandom.nextRange(oclEntry.delayMinFrames, oclEntry.delayMaxFrames);
        oclRow[i] = now + delay;
      } else {
        oclRow[i] = -1;
      }

      // ParticleSystem
      const psEntry = profile.particleSystems[bodyState]?.[i];
      if (psEntry) {
        const delay = psEntry.delayMinFrames === psEntry.delayMaxFrames
          ? psEntry.delayMinFrames
          : self.gameRandom.nextRange(psEntry.delayMinFrames, psEntry.delayMaxFrames);
        psRow[i] = now + delay;
      } else {
        psRow[i] = -1;
      }
    }
}


  // ── Source parity: Unit collision separation ──────────────────────────────

  // ── BattlePlanUpdate implementation ──────────────────────────────────────

  /**
   * Source parity: BattlePlanUpdate::update — per-frame state machine for each
   * Strategy Center's battle plan transition (IDLE → UNPACKING → ACTIVE → PACKING → IDLE).
   */
export function updateBattlePlan(self: GL): void {
    for (const entity of self.spawnedEntities.values()) {
      if (entity.destroyed) continue;
      const profile = entity.battlePlanProfile;
      const state = entity.battlePlanState;
      if (!profile || !state) continue;

      switch (state.transitionStatus) {
        case 'IDLE':
          // Waiting for cooldown after previous plan change.
          if (state.desiredPlan !== 'NONE' && self.frameCounter >= state.idleCooldownFinishFrame) {
            state.transitionStatus = 'UNPACKING';
            state.transitionFinishFrame = self.frameCounter
              + self.getBattlePlanAnimationFrames(profile, state.desiredPlan);
          }
          break;

        case 'UNPACKING':
          if (self.frameCounter >= state.transitionFinishFrame) {
            // Transition to ACTIVE — apply bonuses.
            state.transitionStatus = 'ACTIVE';
            state.activePlan = state.desiredPlan;
            self.applyBattlePlanBonuses(entity, state.activePlan, true);
          }
          break;

        case 'ACTIVE':
          // If desired plan changed, begin packing.
          // Source parity: BattlePlanUpdate::setStatus(TRANSITIONSTATUS_PACKING) immediately
          // calls setBattlePlan(PLANSTATUS_NONE) which removes bonuses and paralyzes troops.
          if (state.desiredPlan !== state.activePlan) {
            // Remove bonuses immediately at packing start (C++ parity).
            self.applyBattlePlanBonuses(entity, state.activePlan, false);
            self.paralyzeBattlePlanTroops(entity, profile);
            state.activePlan = 'NONE';
            state.transitionStatus = 'PACKING';
            state.transitionFinishFrame = self.frameCounter
              + self.getBattlePlanAnimationFrames(profile, state.desiredPlan);
          }
          break;

        case 'PACKING':
          if (self.frameCounter >= state.transitionFinishFrame) {
            // Packing animation complete → idle cooldown.
            state.transitionStatus = 'IDLE';
            state.idleCooldownFinishFrame = self.frameCounter + profile.transitionIdleFrames;
          }
          break;
      }
    }
}


export function requestBattlePlanChange(self: GL, entity: MapEntity, desiredPlan: BattlePlanType): void {
    const state = entity.battlePlanState;
    if (!state) return;

    if (state.activePlan === desiredPlan && state.transitionStatus === 'ACTIVE') {
      return; // Already active on requested plan.
    }

    // Just set desired plan. The state machine in updateBattlePlan handles ACTIVE→PACKING
    // transition, including immediate bonus removal and paralysis (C++ parity).
    state.desiredPlan = desiredPlan;
}


export function getBattlePlanAnimationFrames(self: GL, profile: BattlePlanProfile, plan: BattlePlanType): number {
    switch (plan) {
      case 'BOMBARDMENT': return profile.bombardmentAnimationFrames;
      case 'HOLDTHELINE': return profile.holdTheLineAnimationFrames;
      case 'SEARCHANDDESTROY': return profile.searchAndDestroyAnimationFrames;
      default: return 0;
    }
}


  /**
   * Source parity: Player::changeBattlePlan + localApplyBattlePlanBonusesToObject —
   * Apply or remove battle plan bonuses to all entities on the same side.
   * @param apply true = apply bonuses, false = remove (invert)
   */
export function applyBattlePlanBonuses(self: GL, source: MapEntity, plan: BattlePlanType, apply: boolean): void {
    const side = self.normalizeSide(source.side);
    if (!side) return;

    const profile = source.battlePlanProfile;
    if (!profile) return;

    // Track per-side counts.
    let bonuses = self.sideBattlePlanBonuses.get(side);
    if (!bonuses) {
      bonuses = { bombardmentCount: 0, holdTheLineCount: 0, searchAndDestroyCount: 0 };
      self.sideBattlePlanBonuses.set(side, bonuses);
    }

    const delta = apply ? 1 : -1;
    let weaponBonusFlag = 0;
    // Source parity: Player::changeBattlePlan — only apply/remove when count transitions
    // through 1/0 (first plan of type enables, last plan of type disables). Multiple Strategy
    // Centers with the same plan don't stack army bonuses; they add redundancy.
    let shouldModifyArmy = false;

    switch (plan) {
      case 'BOMBARDMENT':
        bonuses.bombardmentCount = Math.max(0, bonuses.bombardmentCount + delta);
        weaponBonusFlag = WEAPON_BONUS_BOMBARDMENT;
        shouldModifyArmy = (apply && bonuses.bombardmentCount === 1)
          || (!apply && bonuses.bombardmentCount === 0);
        break;
      case 'HOLDTHELINE':
        bonuses.holdTheLineCount = Math.max(0, bonuses.holdTheLineCount + delta);
        weaponBonusFlag = WEAPON_BONUS_HOLDTHELINE;
        shouldModifyArmy = (apply && bonuses.holdTheLineCount === 1)
          || (!apply && bonuses.holdTheLineCount === 0);
        break;
      case 'SEARCHANDDESTROY':
        bonuses.searchAndDestroyCount = Math.max(0, bonuses.searchAndDestroyCount + delta);
        weaponBonusFlag = WEAPON_BONUS_SEARCHANDDESTROY;
        shouldModifyArmy = (apply && bonuses.searchAndDestroyCount === 1)
          || (!apply && bonuses.searchAndDestroyCount === 0);
        break;
    }

    // Source parity: only modify army bonuses on count transitions (0→1 or 1→0).
    if (shouldModifyArmy) {
      const armorScalar = plan === 'HOLDTHELINE' ? profile.holdTheLineArmorDamageScalar : 1.0;
      const sightScalar = plan === 'SEARCHANDDESTROY' ? profile.searchAndDestroySightRangeScalar : 1.0;

      for (const entity of self.spawnedEntities.values()) {
        if (entity.destroyed) continue;
        if (self.normalizeSide(entity.side) !== side) continue;
        if (!self.isBattlePlanMember(entity, profile)) continue;

        // Weapon bonus condition flag.
        const oldBattlePlanFlags = entity.weaponBonusConditionFlags;
        if (apply) {
          entity.weaponBonusConditionFlags |= weaponBonusFlag;
        } else {
          entity.weaponBonusConditionFlags &= ~weaponBonusFlag;
        }
        if (entity.weaponBonusConditionFlags !== oldBattlePlanFlags) {
          self.onWeaponBonusChange(entity);
        }

        // Armor damage scalar.
        if (apply && armorScalar !== 1.0) {
          entity.battlePlanDamageScalar = Math.max(0.01, entity.battlePlanDamageScalar * armorScalar);
        } else if (!apply && plan === 'HOLDTHELINE') {
          // Restore to 1.0 (undo the armor scalar).
          entity.battlePlanDamageScalar = 1.0;
        }

        // Sight range scalar — always use absolute computation from base ranges.
        if (apply && sightScalar !== 1.0) {
          entity.visionRange = Math.max(0, entity.baseVisionRange * sightScalar);
          entity.shroudClearingRange = Math.max(0, entity.baseShroudClearingRange * sightScalar);
        } else if (!apply && plan === 'SEARCHANDDESTROY') {
          entity.visionRange = entity.baseVisionRange;
          entity.shroudClearingRange = entity.baseShroudClearingRange;
        }
      }
    }

    // Strategy Center building-specific bonuses.
    if (plan === 'HOLDTHELINE') {
      // Building health scalar — apply to Strategy Center itself.
      if (profile.strategyCenterHoldTheLineMaxHealthScalar !== 1.0) {
        const scalar = apply
          ? profile.strategyCenterHoldTheLineMaxHealthScalar
          : (1.0 / Math.max(0.01, profile.strategyCenterHoldTheLineMaxHealthScalar));
        const newMaxHealth = Math.max(1, Math.round(source.maxHealth * scalar));
        const ratio = source.maxHealth > 0 ? source.health / source.maxHealth : 1;
        source.maxHealth = newMaxHealth;
        source.initialHealth = newMaxHealth;
        source.health = Math.round(newMaxHealth * ratio);
      }
    }

    if (plan === 'SEARCHANDDESTROY') {
      // Building sight range bonus + stealth detection.
      if (apply && profile.strategyCenterSearchAndDestroySightRangeScalar !== 1.0) {
        source.visionRange = Math.max(0, source.baseVisionRange * profile.strategyCenterSearchAndDestroySightRangeScalar);
        source.shroudClearingRange = Math.max(
          0,
          source.baseShroudClearingRange * profile.strategyCenterSearchAndDestroySightRangeScalar,
        );
      } else if (!apply) {
        source.visionRange = source.baseVisionRange;
        source.shroudClearingRange = source.baseShroudClearingRange;
      }
      // Stealth detection toggling on the building.
      if (profile.strategyCenterSearchAndDestroyDetectsStealth && source.detectorProfile) {
        source.detectorEnabled = apply;
        if (apply) {
          source.detectorNextScanFrame = self.frameCounter;
        }
      }
    }
}


export function isBattlePlanMember(self: GL, entity: MapEntity, profile: BattlePlanProfile): boolean {
    const kindOf = self.resolveEntityKindOfSet(entity);
    // If ValidMemberKindOf is non-empty, entity must have at least one matching kind.
    if (profile.validMemberKindOf.size > 0) {
      let hasValid = false;
      for (const k of profile.validMemberKindOf) {
        if (kindOf.has(k)) { hasValid = true; break; }
      }
      if (!hasValid) return false;
    }
    // If InvalidMemberKindOf is non-empty, entity must NOT have any matching kind.
    for (const k of profile.invalidMemberKindOf) {
      if (kindOf.has(k)) return false;
    }
    return true;
}


  /**
   * Source parity: BattlePlanUpdate — paralyze all troops on the side when packing completes.
   */
export function paralyzeBattlePlanTroops(self: GL, source: MapEntity, profile: BattlePlanProfile): void {
    if (profile.battlePlanParalyzeFrames <= 0) return;
    const side = self.normalizeSide(source.side);
    if (!side) return;

    for (const entity of self.spawnedEntities.values()) {
      if (entity.destroyed) continue;
      if (self.normalizeSide(entity.side) !== side) continue;
      if (entity.id === source.id) continue; // Don't paralyze the building itself.
      if (!self.isBattlePlanMember(entity, profile)) continue;

      // Source parity: paralyzeTroop uses a time-limited disable.
      // We reuse DISABLED_SUBDUED which blocks movement and actions.
      entity.objectStatusFlags.add('DISABLED_SUBDUED');
      entity.disabledParalyzedUntilFrame = self.frameCounter + profile.battlePlanParalyzeFrames;
    }
}


  /**
   * Clear battle plan paralysis when duration expires.
   */
export function updateBattlePlanParalysis(self: GL): void {
    for (const entity of self.spawnedEntities.values()) {
      if (entity.destroyed) {
        entity.disabledParalyzedUntilFrame = 0;
        continue;
      }
      if (entity.disabledParalyzedUntilFrame <= 0 || self.frameCounter < entity.disabledParalyzedUntilFrame) {
        continue;
      }
      entity.objectStatusFlags.delete('DISABLED_SUBDUED');
      entity.disabledParalyzedUntilFrame = 0;
    }
}
