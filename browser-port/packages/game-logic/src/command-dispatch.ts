// @ts-nocheck — self is typed as any; real safety comes from the test suite.
/**
 * Command dispatch — applyCommand switch, flushCommands, construction, special powers.
 *
 * Source parity: System/GameLogicDispatch.cpp
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { MAP_XY_FACTOR } from '@generals/terrain';
import {
  routeIssueSpecialPowerCommand as routeIssueSpecialPowerCommandImpl,
  resolveSharedShortcutSpecialPowerReadyFrame as resolveSharedShortcutSpecialPowerReadyFrameImpl,
  setSpecialPowerReadyFrame as setSpecialPowerReadyFrameImpl,
} from './special-power-routing.js';
import { resolveEffectCategory as resolveEffectCategoryImpl } from './special-power-effects.js';
import { CELL_SHROUDED } from './fog-of-war.js';
import { DEFAULT_SPY_VISION_RADIUS } from './special-power-effects.js';
import { findObjectDefByName, findScienceDefByName } from './registry-lookups.js';
import { clamp, readNumericField } from './ini-readers.js';
import {
  LOGIC_FRAME_RATE,
  RELATIONSHIP_ALLIES,
  RELATIONSHIP_ENEMIES,
  RELATIONSHIP_NEUTRAL,
  AUTO_TARGET_SCAN_RATE_FRAMES,
  SOURCE_DEFAULT_MAX_BEACONS_PER_PLAYER,
  SOURCE_HACK_FALLBACK_CASH_AMOUNT,
  CLIFF_HEIGHT_DELTA,
  NAV_WATER,
  NAV_CLIFF,
  NAV_IMPASSABLE,
  NAV_BRIDGE_IMPASSABLE,
  NO_ATTACK_DISTANCE,
} from './index.js';
type GL = any;

// ---- Command dispatch implementations ----

export function flushCommands(self: GL): void {
  while (self.commandQueue.length > 0) {
    const command = self.commandQueue.shift();
    if (!command) return;
    applyCommand(self, command);
  }
}

export function applyCommand(self: GL, command: GameLogicCommand): void {
  if (deferCommandWhileHackInternetPacking(self, command)) {
    return;
  }

  if (deferCommandWhileChinookBusy(self, command)) {
    return;
  }

  if (self.shouldIgnoreRailedTransportPlayerCommand(command)) {
    return;
  }

  // Source parity: AIUpdate.cpp:2612-2615 — ForbidPlayerCommands rejects player commands.
  // When an entity has forbidPlayerCommands = true (e.g., Spectre gunship), only AI/script
  // commands are accepted. Player commands are silently dropped.
  if (shouldRejectForbiddenPlayerCommand(self, command)) {
    return;
  }

  switch (command.type) {
    case 'clearSelection': {
      const hadSelection = self.selectedEntityIds.length > 0 || self.selectedEntityId !== null;
      self.selectedEntityIds = [];
      self.selectedEntityId = null;
      self.clearEntitySelectionState();
      if (hadSelection) {
        self.markScriptSelectionChanged();
      }
      return;
    }
    case 'selectEntities': {
      const nextSelectionIds = self.filterValidSelectionIds(command.entityIds);
      const changed = !self.selectionIdsEqual(self.selectedEntityIds, nextSelectionIds);
      self.selectedEntityIds = nextSelectionIds;
      self.selectedEntityId = nextSelectionIds[0] ?? null;
      self.updateSelectionHighlight();
      if (changed) {
        self.markScriptSelectionChanged();
      }
      return;
    }
    case 'select': {
      const picked = self.spawnedEntities.get(command.entityId);
      if (!picked || picked.destroyed) return;
      // Source parity: Object::isSelectable — UNSELECTABLE or MASKED status prevents player selection.
      if (self.entityHasObjectStatus(picked, 'UNSELECTABLE') || self.entityHasObjectStatus(picked, 'MASKED')) return;
      const changed = self.selectedEntityIds.length !== 1 || self.selectedEntityIds[0] !== command.entityId;
      self.selectedEntityIds = [command.entityId];
      self.selectedEntityId = command.entityId;
      self.updateSelectionHighlight();
      if (changed) {
        self.markScriptSelectionChanged();
      }
      return;
    }
    case 'moveTo': {
      const commandSource = command.commandSource ?? 'PLAYER';
      if (commandSource !== 'AI') {
        self.clearCommandButtonHuntForEntityId(command.entityId);
      }
      if (commandSource === 'PLAYER') {
        self.setSupplyTruckForceBusy(command.entityId, true);
      }
      const dozerTaskCancelMode = commandSource === 'PLAYER' ? 'current' : 'none';
      const moveEntity = self.spawnedEntities.get(command.entityId);
      const moveJs = moveEntity?.jetAIState;
      if (moveJs) {
        const s = moveJs.state;
        if (s === 'TAKING_OFF' || s === 'LANDING' || s === 'RETURNING_FOR_LANDING') {
          // Source parity: C++ JetAIUpdate::aiDoCommand lines 2415-2420 — queue during takeoff/landing.
          moveJs.pendingCommand = { type: 'moveTo', x: command.targetX, z: command.targetZ };
          return;
        }
        if (s === 'PARKED' || s === 'RELOAD_AMMO') {
          // Aircraft is parked/reloading — store as pending, takeoff will execute it.
          moveJs.pendingCommand = { type: 'moveTo', x: command.targetX, z: command.targetZ };
          return;
        }
      }
      cancelEntityCommandPathActions(self, command.entityId, dozerTaskCancelMode);
      self.clearAttackTarget(command.entityId);
      self.issueMoveTo(command.entityId, command.targetX, command.targetZ);
      return;
    }
    case 'attackMoveTo': {
      const commandSource = command.commandSource ?? 'PLAYER';
      if (commandSource !== 'AI') {
        self.clearCommandButtonHuntForEntityId(command.entityId);
      }
      if (commandSource === 'PLAYER') {
        self.setSupplyTruckForceBusy(command.entityId, true);
      }
      const dozerTaskCancelMode = commandSource === 'PLAYER' ? 'current' : 'none';
      const amEntity = self.spawnedEntities.get(command.entityId);
      const amJs = amEntity?.jetAIState;
      if (amJs) {
        const s = amJs.state;
        if (s === 'TAKING_OFF' || s === 'LANDING' || s === 'RETURNING_FOR_LANDING') {
          amJs.pendingCommand = { type: 'moveTo', x: command.targetX, z: command.targetZ };
          return;
        }
        if (s === 'PARKED' || s === 'RELOAD_AMMO') {
          amJs.pendingCommand = { type: 'moveTo', x: command.targetX, z: command.targetZ };
          return;
        }
      }
      cancelEntityCommandPathActions(self, command.entityId, dozerTaskCancelMode);
      self.clearAttackTarget(command.entityId);
      self.issueMoveTo(
        command.entityId,
        command.targetX,
        command.targetZ,
        command.attackDistance,
      );
      // Source parity: AssaultTransportAIUpdate::aiDoCommand — begin assault on attack-move.
      if (amEntity?.assaultTransportProfile) {
        self.beginAssaultTransportAttackMove(amEntity, command.targetX, command.targetZ);
      }
      return;
    }
    case 'guardPosition': {
      const guardSource = command.commandSource ?? 'PLAYER';
      if (guardSource !== 'AI') {
        self.clearCommandButtonHuntForEntityId(command.entityId);
      }
      if (guardSource === 'PLAYER') {
        self.setSupplyTruckForceBusy(command.entityId, true);
      }
      cancelEntityCommandPathActions(self, 
        command.entityId,
        guardSource === 'PLAYER' ? 'current' : 'none',
      );
      self.clearAttackTarget(command.entityId);
      self.initGuardPosition(command.entityId, command.targetX, command.targetZ, command.guardMode);
      return;
    }
    case 'guardObject': {
      const guardSource = command.commandSource ?? 'PLAYER';
      if (guardSource !== 'AI') {
        self.clearCommandButtonHuntForEntityId(command.entityId);
      }
      if (guardSource === 'PLAYER') {
        self.setSupplyTruckForceBusy(command.entityId, true);
      }
      cancelEntityCommandPathActions(self, 
        command.entityId,
        guardSource === 'PLAYER' ? 'current' : 'none',
      );
      self.clearAttackTarget(command.entityId);
      self.initGuardObject(command.entityId, command.targetEntityId, command.guardMode);
      return;
    }
    case 'setRallyPoint':
      self.setEntityRallyPoint(command.entityId, command.targetX, command.targetZ);
      return;
    case 'attackEntity': {
      const commandSource = command.commandSource ?? 'PLAYER';
      if (commandSource !== 'AI') {
        self.clearCommandButtonHuntForEntityId(command.entityId);
      }
      if (commandSource === 'PLAYER') {
        self.setSupplyTruckForceBusy(command.entityId, true);
      }
      const atkEntity = self.spawnedEntities.get(command.entityId);
      const atkJs = atkEntity?.jetAIState;
      if (atkJs) {
        const s = atkJs.state;
        if (s === 'TAKING_OFF' || s === 'LANDING' || s === 'RETURNING_FOR_LANDING') {
          // Source parity: C++ JetAIUpdate::aiDoCommand lines 2415-2420 — queue during takeoff/landing.
          atkJs.pendingCommand = { type: 'attackEntity', targetId: command.targetEntityId };
          return;
        }
        if (s === 'PARKED' || s === 'RELOAD_AMMO') {
          // Aircraft is parked/reloading — store as pending, takeoff will execute it.
          atkJs.pendingCommand = { type: 'attackEntity', targetId: command.targetEntityId };
          return;
        }
      }
      cancelEntityCommandPathActions(self, 
        command.entityId,
        commandSource === 'PLAYER' ? 'current' : 'none',
      );
      self.issueAttackEntity(
        command.entityId,
        command.targetEntityId,
        commandSource,
      );
      // Source parity: TransportAIUpdate::privateAttackObject — propagate attack to passengers.
      if (atkEntity) {
        self.propagateTransportAttackToPassengers(
          atkEntity, command.targetEntityId, commandSource,
        );
      }
      // Source parity: AssaultTransportAIUpdate::aiDoCommand — begin assault on attack command.
      if (atkEntity?.assaultTransportProfile && commandSource !== 'AI') {
        self.beginAssaultTransportAttack(atkEntity, command.targetEntityId, false);
      }
      return;
    }
    case 'fireWeapon':
      cancelEntityCommandPathActions(self, command.entityId);
      self.issueFireWeapon(
        command.entityId,
        command.weaponSlot,
        command.maxShotsToFire,
        command.targetObjectId,
        command.targetPosition,
      );
      return;
    case 'switchWeapon': {
      cancelEntityCommandPathActions(self, command.entityId);
      const entity = self.spawnedEntities.get(command.entityId);
      const weaponSlot = self.normalizeWeaponSlot(command.weaponSlot);
      if (!entity || entity.destroyed || weaponSlot === null) {
        return;
      }
      entity.forcedWeaponSlot = weaponSlot;
      self.refreshEntityCombatProfiles(entity);
      return;
    }
    case 'stop': {
      const stopSource = command.commandSource ?? 'AI';
      if (stopSource !== 'AI') {
        self.clearCommandButtonHuntForEntityId(command.entityId);
      }
      cancelEntityCommandPathActions(self, 
        command.entityId,
        stopSource === 'PLAYER' ? 'current' : 'none',
      );
      self.clearAttackTarget(command.entityId);
      self.stopEntity(command.entityId);
      // Source parity: AssaultTransportAIUpdate::aiDoCommand(AICMD_IDLE) — recall all members.
      self.resetAssaultTransportState(command.entityId);
      const stopEntity = self.spawnedEntities.get(command.entityId);
      if (stopEntity) {
        // Source parity: explicit stop resets auto-target scan timer and clears guard state.
        const stopScanRate = stopEntity.moodAttackCheckRate > 0 ? stopEntity.moodAttackCheckRate : AUTO_TARGET_SCAN_RATE_FRAMES;
        stopEntity.autoTargetScanNextFrame = self.frameCounter + stopScanRate;
        stopEntity.guardState = 'NONE';
        stopEntity.guardAreaTriggerIndex = -1;
      }
      if (stopSource === 'PLAYER') {
        self.setSupplyTruckForceBusy(command.entityId, true);
      }
      return;
    }
    case 'bridgeDestroyed':
      self.onObjectDestroyed(command.entityId);
      return;
    case 'bridgeRepaired':
      self.onObjectRepaired(command.entityId);
      return;
    case 'setLocomotorSet':
      self.setEntityLocomotorSet(command.entityId, command.setName);
      return;
    case 'setLocomotorUpgrade':
      self.setEntityLocomotorUpgrade(command.entityId, command.enabled);
      return;
    case 'captureEntity':
      self.captureEntity(command.entityId, command.newSide);
      return;
    case 'applyUpgrade':
      self.applyUpgradeToEntity(command.entityId, command.upgradeName);
      return;
    case 'queueUnitProduction':
      self.queueUnitProduction(command.entityId, command.unitTemplateName);
      return;
    case 'cancelUnitProduction':
      self.cancelUnitProduction(command.entityId, command.productionId);
      return;
    case 'queueUpgradeProduction':
      self.queueUpgradeProduction(command.entityId, command.upgradeName);
      return;
    case 'cancelUpgradeProduction':
      self.cancelUpgradeProduction(command.entityId, command.upgradeName);
      return;
    case 'setSideCredits':
      self.setSideCredits(command.side, command.amount);
      return;
    case 'addSideCredits':
      self.addSideCredits(command.side, command.amount);
      return;
    case 'setSidePlayerType':
      self.setSidePlayerType(command.side, command.playerType);
      return;
    case 'grantSideScience':
      self.grantSideScience(command.side, command.scienceName);
      return;
    case 'applyPlayerUpgrade': {
      const localSide = self.resolveLocalPlayerSide();
      if (!localSide) {
        return;
      }
      const normalizedUpgradeName = command.upgradeName.trim().toUpperCase();
      if (!normalizedUpgradeName) {
        return;
      }
      self.setSideUpgradeCompleted(localSide, normalizedUpgradeName, true);
      self.applyCompletedPlayerUpgrade(localSide, normalizedUpgradeName);
      return;
    }
    case 'purchaseScience': {
      // Source parity: AI players pass side explicitly; human players fall back to local player.
      const purchaseSide = command.side
        ? self.normalizeSide(command.side)
        : self.resolveLocalPlayerSide();
      if (!purchaseSide) {
        return;
      }
      const normalizedScienceName = command.scienceName.trim().toUpperCase();
      if (!normalizedScienceName || normalizedScienceName === 'NONE') {
        return;
      }

      const registry = self.iniDataRegistry;
      if (!registry) {
        return;
      }

      const scienceDef = findScienceDefByName(registry, normalizedScienceName);
      if (!scienceDef) {
        return;
      }

      const normalizedScience = scienceDef.name.trim().toUpperCase();
      if (!normalizedScience || normalizedScience === 'NONE') {
        return;
      }

      const scienceCost = self.getPurchasableScienceCost(purchaseSide, normalizedScience);
      if (scienceCost <= 0) {
        return;
      }
      if (!self.addScienceToSide(purchaseSide, normalizedScience)) {
        return;
      }
      const normalizedPurchaseSide = self.normalizeSide(purchaseSide);
      if (normalizedPurchaseSide) {
        const rankState = self.getSideRankStateMap(normalizedPurchaseSide);
        rankState.sciencePurchasePoints = Math.max(0, rankState.sciencePurchasePoints - scienceCost);
      }
      return;
    }
    case 'issueSpecialPower':
      routeIssueSpecialPowerCommand(self, command);
      return;
    case 'exitContainer':
      self.handleExitContainerCommand(command.entityId);
      return;
    case 'evacuate': {
      self.handleEvacuateCommand(command.entityId);
      return;
    }
    case 'executeRailedTransport':
      self.handleExecuteRailedTransportCommand(command);
      return;
    case 'beaconDelete':
      handleBeaconDeleteCommand(self, command);
      return;
    case 'hackInternet':
      handleHackInternetCommand(self, command);
      return;
    case 'toggleOvercharge':
      handleToggleOverchargeCommand(self, command);
      return;
    case 'detonateDemoTrap':
      handleDetonateDemoTrapCommand(self, command);
      return;
    case 'toggleDemoTrapMode':
      handleToggleDemoTrapModeCommand(self, command);
      return;
    case 'combatDrop':
      handleCombatDropCommand(self, command);
      return;
    case 'placeBeacon':
      handlePlaceBeaconCommand(self, command);
      return;
    case 'enterObject':
      handleEnterObjectCommand(self, command);
      return;
    case 'constructBuilding':
      handleConstructBuildingCommand(self, command);
      return;
    case 'cancelDozerConstruction':
      handleCancelDozerConstructionCommand(self, command);
      return;
    case 'sell':
      handleSellCommand(self, command);
      return;
    case 'garrisonBuilding':
      handleGarrisonBuildingCommand(self, command);
      return;
    case 'repairBuilding':
      if ((command.commandSource ?? 'PLAYER') !== 'AI') {
        self.clearCommandButtonHuntForEntityId(command.entityId);
      }
      handleRepairBuildingCommand(self, command);
      return;
    case 'enterTransport':
      handleEnterTransportCommand(self, command);
      return;
    default:
      return;
  }
}

export function deferCommandWhileHackInternetPacking(self: GL, command: GameLogicCommand): boolean {
  const hasEntityId = 'entityId' in command && typeof command.entityId === 'number';
  if (!hasEntityId) {
    return false;
  }

  const entity = self.spawnedEntities.get(command.entityId);
  if (!entity || entity.destroyed) {
    return false;
  }

  const pendingState = self.hackInternetPendingCommandByEntityId.get(entity.id);
  if (pendingState) {
    pendingState.command = command;
    return true;
  }

  if (command.type === 'hackInternet') {
    return false;
  }

  if (!self.hackInternetStateByEntityId.has(entity.id)) {
    return false;
  }

  const objectDef = self.resolveObjectDefByTemplateName(entity.templateName);
  const profile = self.extractHackInternetProfile(objectDef ?? undefined);
  if (!profile) {
    return false;
  }

  self.hackInternetStateByEntityId.delete(entity.id);
  const packDelayFrames = resolveHackInternetPackTimeFrames(self, entity, profile);
  if (packDelayFrames <= 0) {
    return false;
  }

  self.stopEntity(entity.id);
  self.clearAttackTarget(entity.id);
  self.hackInternetPendingCommandByEntityId.set(entity.id, {
    command,
    executeFrame: self.frameCounter + packDelayFrames,
  });
  return true;
}

export function deferCommandWhileChinookBusy(self: GL, command: GameLogicCommand): boolean {
  const hasEntityId = 'entityId' in command && typeof command.entityId === 'number';
  if (!hasEntityId) {
    return false;
  }

  const entity = self.spawnedEntities.get(command.entityId);
  if (!entity || entity.destroyed || !entity.chinookAIProfile) {
    return false;
  }

  // Source parity: ChinookAIUpdate::aiDoCommand clears healing airfield on any command.
  self.setChinookAirfieldForHealing(entity, 0);

  if (self.pendingCombatDropActions.has(entity.id)) {
    self.pendingChinookCommandByEntityId.set(entity.id, command);
    return true;
  }

  const status = entity.chinookFlightStatus ?? 'FLYING';
  if (status === 'TAKING_OFF' || status === 'LANDING' || status === 'DOING_COMBAT_DROP') {
    self.pendingChinookCommandByEntityId.set(entity.id, command);
    return true;
  }

  if (command.type === 'combatDrop' && status !== 'FLYING') {
    // Allow combat drop command to start while landed; takeoff will continue in update.
    self.setChinookFlightStatus(entity, 'TAKING_OFF');
    return false;
  }

  if (command.type === 'exitContainer' || command.type === 'evacuate') {
    if (status !== 'LANDED') {
      self.pendingChinookCommandByEntityId.set(entity.id, command);
      self.setChinookFlightStatus(entity, 'LANDING');
      return true;
    }
    return false;
  }

  if (isChinookTakeoffCommandType(self, command.type) && status !== 'FLYING') {
    self.pendingChinookCommandByEntityId.set(entity.id, command);
    self.setChinookFlightStatus(entity, 'TAKING_OFF');
    return true;
  }

  return false;
}

/**
 * Source parity: AIUpdate.cpp:2612-2615 — when ForbidPlayerCommands is true on an entity's
 * AIUpdateModuleData, player-sourced commands (CMD_FROM_PLAYER) are silently rejected.
 * Only AI and script commands are allowed through. Used by Spectre gunship and similar units.
 */
export function shouldRejectForbiddenPlayerCommand(self: GL, command: GameLogicCommand): boolean {
  // Only commands with an entityId and a player command source can be rejected.
  const hasEntityId = 'entityId' in command && typeof command.entityId === 'number';
  if (!hasEntityId) {
    return false;
  }
  // Check if the command has a commandSource field and if it's from the player.
  const commandSource = ('commandSource' in command ? command.commandSource : undefined) ?? 'PLAYER';
  if (commandSource !== 'PLAYER') {
    return false;
  }
  const entity = self.spawnedEntities.get(command.entityId);
  if (!entity) {
    return false;
  }
  return entity.forbidPlayerCommands === true;
}

export function isChinookTakeoffCommandType(self: GL, commandType: GameLogicCommand['type']): boolean {
  switch (commandType) {
    case 'moveTo':
    case 'attackMoveTo':
    case 'guardPosition':
    case 'guardObject':
    case 'attackEntity':
    case 'fireWeapon':
    case 'switchWeapon':
    case 'combatDrop':
      return true;
    default:
      return false;
  }
}

export function collectReadySpecialPowersForSide(self: GL, side: string): Array<{
  specialPowerName: string;
  sourceEntityId: number;
  commandOption: number;
  commandButtonId: string;
  effectCategory: string;
}> {
  const normalizedSide = self.normalizeSide(side);
  if (!normalizedSide) return [];
  const result: Array<{
    specialPowerName: string;
    sourceEntityId: number;
    commandOption: number;
    commandButtonId: string;
    effectCategory: string;
  }> = [];

  for (const [powerName, sourcesMap] of self.shortcutSpecialPowerSourceByName.entries()) {
    for (const [entityId, readyFrame] of sourcesMap.entries()) {
      if (readyFrame > self.frameCounter) continue;
      const entity = self.spawnedEntities.get(entityId);
      if (!entity || entity.destroyed) continue;
      if (self.normalizeSide(entity.side) !== normalizedSide) continue;

      // Resolve effect category from entity's special power module.
      const module = entity.specialPowerModules.get(powerName);
      const effectCategory = module
        ? resolveEffectCategoryImpl(module.moduleType)
        : 'GENERIC';

      // Derive commandOption from effect category for AI dispatch.
      const NEED_TARGET_POS = 0x20;
      const NEED_TARGET_ENEMY = 0x01;
      let commandOption = 0;
      const upperCat = effectCategory.toUpperCase();
      if (upperCat === 'AREA_DAMAGE' || upperCat === 'EMP_PULSE'
          || upperCat === 'SPY_VISION' || upperCat === 'AREA_HEAL'
          || upperCat === 'OCL_SPAWN') {
        commandOption = NEED_TARGET_POS;
      } else if (upperCat === 'CASH_HACK' || upperCat === 'DEFECTOR') {
        commandOption = NEED_TARGET_ENEMY;
      }

      result.push({
        specialPowerName: powerName,
        sourceEntityId: entityId,
        commandOption,
        commandButtonId: '', // AI doesn't need button ID — routing uses specialPowerName.
        effectCategory,
      });
      break; // One source per power name is enough for AI.
    }
  }
  return result;
}

export function routeIssueSpecialPowerCommand(self: GL, command: IssueSpecialPowerCommand): void {
  const normalizeShortcutSpecialPowerName = self.normalizeShortcutSpecialPowerName.bind(self);
  routeIssueSpecialPowerCommandImpl(command, {
    iniDataRegistry: self.iniDataRegistry,
    frameCounter: self.frameCounter,
    selectedEntityId: self.selectedEntityId,
    spawnedEntities: self.spawnedEntities,
    msToLogicFrames: self.msToLogicFrames.bind(self),
    resolveShortcutSpecialPowerSourceEntityId: self.resolveShortcutSpecialPowerSourceEntityId.bind(self),
    resolveSharedReadyFrame: (specialPowerName) => (
      resolveSharedShortcutSpecialPowerReadyFrameImpl(
        specialPowerName,
        self.frameCounter,
        self.sharedShortcutSpecialPowerReadyFrames,
        normalizeShortcutSpecialPowerName,
      )
    ),
    resolveSourceReadyFrameBySource: (specialPowerName, sourceEntityId) => {
      const normalizedSpecialPowerName = normalizeShortcutSpecialPowerName(specialPowerName);
      if (!normalizedSpecialPowerName) {
        return self.frameCounter;
      }
      return self.resolveSpecialPowerReadyFrameForSourceEntity(
        normalizedSpecialPowerName,
        sourceEntityId,
      );
    },
    setReadyFrame: self.setSpecialPowerReadyFrame.bind(self),
    isObjectShroudedForAction: self.isSpecialPowerObjectTargetShrouded.bind(self),
    isObjectEffectivelyDead: self.isSpecialPowerObjectEffectivelyDead.bind(self),
    isObjectTargetAllowedForSpecialPower: self.isSpecialPowerObjectTargetAllowed.bind(self),
    isPositionUnderwater: self.isSpecialPowerLocationUnderwater.bind(self),
    isLocationShroudedForAction: self.isSpecialPowerLocationTargetShrouded.bind(self),
    getTeamRelationship: self.getTeamRelationship.bind(self),
    onIssueSpecialPowerNoTarget: self.onIssueSpecialPowerNoTarget.bind(self),
    onIssueSpecialPowerTargetPosition: self.onIssueSpecialPowerTargetPosition.bind(self),
    onIssueSpecialPowerTargetObject: self.onIssueSpecialPowerTargetObject.bind(self),
  });
}

export function setSpecialPowerReadyFrame(self: GL, 
  specialPowerName: string,
  sourceEntityId: number,
  isShared: boolean,
  readyFrame: number,
): void {
  const normalizeShortcutSpecialPowerName = self.normalizeShortcutSpecialPowerName.bind(self);
  setSpecialPowerReadyFrameImpl(
    specialPowerName,
    sourceEntityId,
    isShared,
    readyFrame,
    self.frameCounter,
    self.sharedShortcutSpecialPowerReadyFrames,
    normalizeShortcutSpecialPowerName,
    self.trackShortcutSpecialPowerSourceEntity.bind(self),
  );
}

export function resolveSpyVisionRevealRadius(self: GL, source: MapEntity, specialPowerDef: SpecialPowerDef | null): number {
  const radiusFromSpecialPower = specialPowerDef
    ? (readNumericField(specialPowerDef.fields, ['RadiusCursorRadius']) ?? 0)
    : 0;
  if (radiusFromSpecialPower > 0) {
    return radiusFromSpecialPower;
  }
  return source.visionRange > 0 ? source.visionRange : DEFAULT_SPY_VISION_RADIUS;
}

export function canEntityIssueSpecialPower(self: GL, source: MapEntity): boolean {
  if (source.destroyed) {
    return false;
  }
  if (source.objectStatusFlags.has('UNDER_CONSTRUCTION') || source.objectStatusFlags.has('SOLD')) {
    return false;
  }
  // Source parity: enclosed contained objects cannot execute direct object actions.
  if (self.isEntityInEnclosingContainer(source)) {
    return false;
  }
  return true;
}

export function isSpecialPowerObjectTargetShrouded(self: GL, 
  source: MapEntity,
  target: MapEntity,
  commandSource: 'PLAYER' | 'AI' | 'SCRIPT',
): boolean {
  if (commandSource === 'SCRIPT') {
    return false;
  }
  const sourceOwnerToken = self.normalizeControllingPlayerToken(source.controllingPlayerToken ?? undefined);
  const sourceSide = self.normalizeSide(source.side);
  if (!sourceSide) {
    return false;
  }
  const sourcePlayerType = (
    sourceOwnerToken != null
      ? self.sidePlayerTypes.get(sourceOwnerToken)
      : undefined
  ) ?? self.getSidePlayerType(sourceSide);
  if (sourcePlayerType !== 'HUMAN') {
    return false;
  }
  return self.resolveEntityShroudStatusForSide(target, sourceSide) !== 'CLEAR';
}

export function isSpecialPowerObjectEffectivelyDead(self: GL, target: MapEntity): boolean {
  return self.isScriptEntityEffectivelyDead(target);
}

export function isSpecialPowerObjectTargetAllowed(self: GL, 
  source: MapEntity,
  target: MapEntity,
  specialPowerEnum: string | null,
  _commandSource: 'PLAYER' | 'AI' | 'SCRIPT',
): boolean {
  if (self.isEntityInEnclosingContainer(target)) {
    return false;
  }
  if (!specialPowerEnum) {
    return true;
  }
  const targetKindOf = self.resolveEntityKindOfSet(target);
  const relationship = self.getTeamRelationship(source, target);
  const targetStealthedUndetected = target.objectStatusFlags.has('STEALTHED')
    && !target.objectStatusFlags.has('DETECTED');

  switch (specialPowerEnum) {
    case 'SPECIAL_TANKHUNTER_TNT_ATTACK':
      return targetKindOf.has('STRUCTURE')
        || (targetKindOf.has('VEHICLE') && !targetKindOf.has('AIRCRAFT'));
    case 'SPECIAL_MISSILE_DEFENDER_LASER_GUIDED_MISSILES':
      return targetKindOf.has('VEHICLE') && relationship === RELATIONSHIP_ENEMIES;
    case 'SPECIAL_HACKER_DISABLE_BUILDING':
      return targetKindOf.has('STRUCTURE')
        && relationship === RELATIONSHIP_ENEMIES
        && targetKindOf.has('CAPTURABLE')
        && !targetKindOf.has('REBUILD_HOLE');
    case 'SPECIAL_INFANTRY_CAPTURE_BUILDING':
    case 'SPECIAL_BLACKLOTUS_CAPTURE_BUILDING':
      if (targetKindOf.has('IMMUNE_TO_CAPTURE')) {
        return false;
      }
      if (!targetKindOf.has('STRUCTURE')) {
        return false;
      }
      if (target.objectStatusFlags.has('UNDER_CONSTRUCTION') || target.objectStatusFlags.has('SOLD')) {
        return false;
      }
      if (targetStealthedUndetected) {
        return false;
      }
      if (self.isCaptureBlockedByGarrisonOccupants(target)) {
        return false;
      }
      if (self.doesSpecialPowerTargetAppearToContainFriendlies(source, target)) {
        return false;
      }
      return relationship === RELATIONSHIP_ENEMIES
        || (targetKindOf.has('CAPTURABLE') && relationship !== RELATIONSHIP_ALLIES);
    case 'SPECIAL_CASH_HACK':
      return targetKindOf.has('STRUCTURE')
        && relationship === RELATIONSHIP_ENEMIES
        && targetKindOf.has('CAPTURABLE')
        && targetKindOf.has('CASH_GENERATOR')
        && !targetKindOf.has('REBUILD_HOLE')
        && !target.objectStatusFlags.has('UNDER_CONSTRUCTION');
    case 'SPECIAL_BLACKLOTUS_STEAL_CASH_HACK':
      return relationship === RELATIONSHIP_ENEMIES
        && targetKindOf.has('CASH_GENERATOR')
        && targetKindOf.has('CAPTURABLE')
        && !targetKindOf.has('REBUILD_HOLE')
        && !target.objectStatusFlags.has('UNDER_CONSTRUCTION')
        && !targetStealthedUndetected
        && !self.doesSpecialPowerTargetAppearToContainFriendlies(source, target);
    case 'SPECIAL_BLACKLOTUS_DISABLE_VEHICLE_HACK':
      return relationship === RELATIONSHIP_ENEMIES
        && targetKindOf.has('VEHICLE')
        && !targetKindOf.has('AIRCRAFT')
        && !self.entityHasObjectStatus(target, 'AIRBORNE_TARGET')
        && !targetStealthedUndetected
        && !self.doesSpecialPowerTargetAppearToContainFriendlies(source, target);
    case 'SPECIAL_DISGUISE_AS_VEHICLE':
      return targetKindOf.has('VEHICLE')
        && !targetKindOf.has('AIRCRAFT')
        && !targetKindOf.has('BOAT');
    case 'SPECIAL_DEFECTOR':
      return !targetKindOf.has('STRUCTURE') && relationship === RELATIONSHIP_ENEMIES;
    case 'SPECIAL_REMOTE_CHARGES':
    case 'SPECIAL_TIMED_CHARGES':
      if (targetKindOf.has('BRIDGE') || targetKindOf.has('BRIDGE_TOWER')) {
        return false;
      }
      return targetKindOf.has('STRUCTURE') || targetKindOf.has('VEHICLE');
    default:
      return true;
  }
}

export function isSpecialPowerLocationUnderwater(self: GL, targetX: number, targetZ: number): boolean {
  return self.getWaterHeightAt(targetX, targetZ) !== null;
}

export function isSpecialPowerLocationTargetShrouded(self: GL, 
  source: MapEntity,
  targetX: number,
  targetZ: number,
): boolean {
  const sourceSide = self.normalizeSide(source.side);
  if (!sourceSide) {
    return false;
  }
  return self.getCellVisibility(sourceSide, targetX, targetZ) === CELL_SHROUDED;
}

export function resolveSpecialPowerModuleProfile(self: GL, 
  sourceEntityId: number,
  specialPowerName: string,
): SpecialPowerModuleProfile | null {
  const sourceEntity = self.spawnedEntities.get(sourceEntityId);
  if (!sourceEntity) {
    return null;
  }

  const normalizedSpecialPowerName = specialPowerName.trim().toUpperCase();
  if (!normalizedSpecialPowerName || normalizedSpecialPowerName === 'NONE') {
    return null;
  }

  return sourceEntity.specialPowerModules.get(normalizedSpecialPowerName) ?? null;
}

export function recordSpecialPowerDispatch(self: GL, 
  sourceEntityId: number,
  module: SpecialPowerModuleProfile,
  dispatchType: SpecialPowerDispatchProfile['dispatchType'],
  commandOption: number,
  commandButtonId: string,
  targetEntityId: number | null,
  targetX: number | null,
  targetZ: number | null,
): void {
  const sourceEntity = self.spawnedEntities.get(sourceEntityId);
  if (!sourceEntity) {
    return;
  }

  sourceEntity.lastSpecialPowerDispatch = {
    specialPowerTemplateName: module.specialPowerTemplateName,
    moduleType: module.moduleType,
    dispatchType,
    commandOption,
    commandButtonId,
    targetEntityId,
    targetX,
    targetZ,
  };

  const normalizedSide = self.normalizeSide(sourceEntity.side);
  if (normalizedSide) {
    self.recordScriptTriggeredSpecialPowerEvent(
      normalizedSide,
      module.specialPowerTemplateName,
      sourceEntityId,
    );
  }

  // Source parity: Eva SUPERWEAPON_LAUNCHED fires for FS_SUPERWEAPON entities.
  // ZH expanded to 3 variants: Own, Ally, Enemy (SpecialPowerModule.cpp:555-632).
  if (sourceEntity.kindOf.has('FS_SUPERWEAPON') && sourceEntity.side) {
    const ownerSide = self.normalizeSide(sourceEntity.side);
    self.emitEvaEvent('SUPERWEAPON_LAUNCHED', sourceEntity.side, 'own', sourceEntityId, module.specialPowerTemplateName);
    for (const [side] of self.sidePowerBonus.entries()) {
      if (side !== ownerSide) {
        const relationship = self.resolveEvaRelationshipVariant(ownerSide, side);
        self.emitEvaEvent('SUPERWEAPON_LAUNCHED', side, relationship, sourceEntityId, module.specialPowerTemplateName);
      }
    }
  }
}

export function cancelEntityCommandPathActions(self: GL, 
  entityId: number,
  cancelDozerTaskMode: 'all' | 'current' | 'none' = 'all',
): void {
  self.cancelScriptWaypointPathCompletionTracking(entityId);
  self.cancelRailedTransportTransit(entityId);
  self.hackInternetStateByEntityId.delete(entityId);
  self.hackInternetPendingCommandByEntityId.delete(entityId);
  self.pendingEnterObjectActions.delete(entityId);
  self.pendingRepairDockActions.delete(entityId);
  self.pendingCombatDropActions.delete(entityId);
  self.scriptAttackAreaStateByEntityId.delete(entityId);
  self.scriptHuntStateByEntityId.delete(entityId);
  self.clearChinookCombatDropIgnoredObstacle(entityId);
  self.pendingGarrisonActions.delete(entityId);
  self.pendingTransportActions.delete(entityId);
  if (cancelDozerTaskMode === 'all') {
    self.pendingRepairActions.delete(entityId);
    const dozer = self.spawnedEntities.get(entityId);
    if (dozer) {
      dozer.dozerRepairTaskOrderFrame = 0;
    }
  } else if (cancelDozerTaskMode === 'current') {
    cancelCurrentDozerTask(self, entityId);
  }
  self.clearScriptWanderInPlace(entityId);
  if (cancelDozerTaskMode === 'all') {
    // Source parity: DozerAIUpdate::cancelTask — clear active construction assignment.
    cancelDozerConstructionTask(self, entityId);
  }
  // Source parity: SpecialAbilityUpdate — cancel any active special ability.
  cancelActiveSpecialAbility(self, entityId);
}

export function cancelCurrentDozerTask(self: GL, dozerId: number): void {
  const dozer = self.spawnedEntities.get(dozerId);
  if (!dozer) {
    return;
  }
  const currentTask = getDozerCurrentTask(self, dozer);
  if (currentTask === 'REPAIR') {
    self.pendingRepairActions.delete(dozerId);
    clearDozerTaskOrder(self, dozer, 'REPAIR');
    return;
  }
  if (currentTask === 'BUILD') {
    cancelDozerConstructionTask(self, dozerId);
  }
}

export function cancelActiveSpecialAbility(self: GL, entityId: number): void {
  const entity = self.spawnedEntities.get(entityId);
  if (!entity) return;
  const state = entity.specialAbilityState;
  if (!state || !state.active) return;
  self.finishSpecialAbility(entity, false);
}

export function cancelDozerConstructionTask(self: GL, dozerId: number): void {
  const buildingId = self.pendingConstructionActions.get(dozerId);
  if (buildingId !== undefined) {
    self.pendingConstructionActions.delete(dozerId);
    const building = self.spawnedEntities.get(buildingId);
    if (building && !building.destroyed && building.builderId === dozerId) {
      building.builderId = 0;
    }
  }
  const dozer = self.spawnedEntities.get(dozerId);
  if (dozer) {
    dozer.dozerBuildTaskOrderFrame = 0;
  }
}

export function handleBeaconDeleteCommand(self: GL, command: BeaconDeleteCommand): void {
  const beacon = self.spawnedEntities.get(command.entityId);
  if (!beacon || beacon.destroyed || !self.isBeaconEntity(beacon)) {
    return;
  }

  const localSide = self.resolveLocalPlayerSide();
  const beaconSide = self.normalizeSide(beacon.side);
  if (!localSide || !beaconSide || beaconSide !== localSide) {
    // Source parity: non-owner delete requests are client-visibility only.
    return;
  }

  self.markEntityDestroyed(beacon.id, -1);
}

export function handleHackInternetCommand(self: GL, command: HackInternetCommand): void {
  const entity = self.spawnedEntities.get(command.entityId);
  if (!entity || entity.destroyed) {
    return;
  }

  const objectDef = self.resolveObjectDefByTemplateName(entity.templateName);
  if (!objectDef) {
    return;
  }

  const profile = self.extractHackInternetProfile(objectDef);
  if (!profile) {
    return;
  }

  // Source parity: MSG_INTERNET_HACK clears active AI state and enters
  // HackInternetAIUpdate (UNPACKING -> HACK_INTERNET persistent loop).
  cancelEntityCommandPathActions(self, entity.id);
  self.clearAttackTarget(entity.id);
  self.stopEntity(entity.id);

  const cashUpdateDelayFrames = resolveHackInternetCashUpdateDelayFrames(self, entity, profile);
  const cashAmountPerCycle = profile.regularCashAmount > 0
    ? profile.regularCashAmount
    : SOURCE_HACK_FALLBACK_CASH_AMOUNT;
  const initialDelayFrames = Math.max(1, profile.unpackTimeFrames + cashUpdateDelayFrames);
  self.hackInternetStateByEntityId.set(entity.id, {
    cashUpdateDelayFrames,
    cashAmountPerCycle,
    nextCashFrame: self.frameCounter + initialDelayFrames,
  });
}

export function resolveHackInternetPackTimeFrames(self: GL, entity: MapEntity, profile: HackInternetProfile): number {
  if (self.isEntityContained(entity)) {
    return 0;
  }
  return Math.max(0, profile.packTimeFrames);
}

export function resolveHackInternetCashUpdateDelayFrames(self: GL, entity: MapEntity, profile: HackInternetProfile): number {
  const delayFrames = self.isEntityContained(entity)
    ? profile.cashUpdateDelayFastFrames
    : profile.cashUpdateDelayFrames;
  return Math.max(0, delayFrames);
}

export function handleToggleOverchargeCommand(self: GL, command: ToggleOverchargeCommand): void {
  const entity = self.spawnedEntities.get(command.entityId);
  if (!entity || entity.destroyed) {
    return;
  }

  const objectDef = self.resolveObjectDefByTemplateName(entity.templateName);
  const profile = self.extractOverchargeBehaviorProfile(objectDef);
  if (!profile) {
    return;
  }

  if (self.overchargeStateByEntityId.has(entity.id)) {
    self.disableOverchargeForEntity(entity);
    return;
  }

  const minimumAllowedHealth = entity.maxHealth * profile.notAllowedWhenHealthBelowPercent;
  if (minimumAllowedHealth > 0 && entity.health < minimumAllowedHealth) {
    return;
  }

  self.enableOverchargeForEntity(entity, profile);
}

export function handleDetonateDemoTrapCommand(self: GL, command: DetonateDemoTrapCommand): void {
  const entity = self.spawnedEntities.get(command.entityId);
  if (!entity || entity.destroyed) return;
  const profile = entity.demoTrapProfile;
  if (!profile || entity.demoTrapDetonated) return;
  // Source parity: C++ update() returns early if UNDER_CONSTRUCTION or SOLD.
  if (entity.objectStatusFlags.has('UNDER_CONSTRUCTION') ||
      entity.objectStatusFlags.has('SOLD')) return;
  self.detonateDemoTrap(entity, profile);
}

export function handleToggleDemoTrapModeCommand(self: GL, command: ToggleDemoTrapModeCommand): void {
  const entity = self.spawnedEntities.get(command.entityId);
  if (!entity || entity.destroyed) return;
  if (!entity.demoTrapProfile || entity.demoTrapDetonated) return;
  entity.demoTrapProximityMode = !entity.demoTrapProximityMode;
}

export function handleCombatDropCommand(self: GL, command: CombatDropCommand): void {
  const source = self.spawnedEntities.get(command.entityId);
  if (!source || source.destroyed) {
    return;
  }
  const commandSource = command.commandSource ?? 'PLAYER';
  if (self.countContainedRappellers(source.id) <= 0) {
    return;
  }

  let targetObjectId: number | null = null;
  let targetX: number;
  let targetZ: number;
  if (command.targetObjectId !== null) {
    const target = self.spawnedEntities.get(command.targetObjectId);
    if (!target || target.destroyed) {
      return;
    }
    // Source parity: ChinookAIUpdate::privateCombatDrop calls
    // ActionManager::canEnterObject(..., COMBATDROP_INTO) only for player-issued
    // object-target combat drops.
    if (commandSource === 'PLAYER' && !canPlayerCombatDropIntoTarget(self, source, target)) {
      return;
    }
    targetObjectId = target.id;
    targetX = target.x;
    targetZ = target.z;
  } else if (command.targetPosition !== null) {
    targetX = command.targetPosition[0];
    targetZ = command.targetPosition[2];
    const resolvedDropPosition = resolveCombatDropPositionWithoutTarget(self, source, targetX, targetZ);
    targetX = resolvedDropPosition.x;
    targetZ = resolvedDropPosition.z;
  } else {
    return;
  }

  // Source parity: MSG_COMBATDROP routes through AIGroup::groupCombatDrop,
  // which delegates per-unit AI combat-drop behavior.
  cancelEntityCommandPathActions(self, source.id);
  self.clearAttackTarget(source.id);
  // Source parity: ChinookAIUpdate::getBuildingToNotPathAround.
  // While in MOVE_TO_COMBAT_DROP/DO_COMBAT_DROP, pathing must not avoid the goal building.
  self.syncChinookCombatDropIgnoredObstacle(source, targetObjectId);
  self.issueMoveTo(source.id, targetX, targetZ);
  self.pendingCombatDropActions.set(source.id, {
    targetObjectId,
    targetX,
    targetZ,
    nextDropFrame: 0,
  });
}

export function canPlayerCombatDropIntoTarget(self: GL, source: MapEntity, target: MapEntity): boolean {
  if (!passesCommonEnterObjectValidation(self, source, target, 'PLAYER')) {
    return false;
  }
  // Source parity: ActionManager::canEnterObject with COMBATDROP_INTO forbids
  // combat drop into faction structures.
  return !self.isFactionStructure(target);
}

export function resolveCombatDropPositionWithoutTarget(self: GL, 
  source: MapEntity,
  centerX: number,
  centerZ: number,
): { x: number; z: number } {
  const heightmap = self.mapHeightmap;
  if (heightmap && (
    centerX < 0
    || centerZ < 0
    || centerX >= heightmap.worldWidth
    || centerZ >= heightmap.worldDepth
  )) {
    // Source parity: PartitionManager::findPositionAround returns center unchanged
    // when the requested position is off-map.
    return { x: centerX, z: centerZ };
  }

  const maxRadius = Math.max(0, self.resolveEntityBoundingCircleRadius2D(source) * 100);
  if (!Number.isFinite(maxRadius) || maxRadius <= 0) {
    return { x: centerX, z: centerZ };
  }

  const ringSpacing = 5;
  const twoPi = Math.PI * 2;
  const startAngle = self.gameRandom.nextFloat() * twoPi;
  const centerY = self.resolveGroundHeight(centerX, centerZ);

  for (let dist = 0; dist <= maxRadius; dist += ringSpacing) {
    const angleSpacing = dist === 0
      ? twoPi
      : (ringSpacing / (dist + 1)) * (twoPi / 6);
    const samples = Math.ceil((twoPi / angleSpacing) / 2);
    for (let i = 0; i < samples; i += 1) {
      const left = tryCombatDropPositionCandidate(self, centerX, centerY, centerZ, dist, startAngle + (angleSpacing * i));
      if (left) {
        return left;
      }
      if (i !== 0) {
        const right = tryCombatDropPositionCandidate(self, centerX, centerY, centerZ, dist, startAngle - (angleSpacing * i));
        if (right) {
          return right;
        }
      }
    }
  }

  return { x: centerX, z: centerZ };
}

export function tryCombatDropPositionCandidate(self: GL, 
  centerX: number,
  centerY: number,
  centerZ: number,
  distance: number,
  angle: number,
): { x: number; z: number } | null {
  const worldX = (distance * Math.cos(angle)) + centerX;
  const worldZ = (distance * Math.sin(angle)) + centerZ;

  const heightmap = self.mapHeightmap;
  if (heightmap && (
    worldX < 0
    || worldZ < 0
    || worldX >= heightmap.worldWidth
    || worldZ >= heightmap.worldDepth
  )) {
    return null;
  }

  const worldY = self.resolveGroundHeight(worldX, worldZ);
  if (Math.abs(worldY - centerY) > 1e10) {
    return null;
  }

  const navGrid = self.navigationGrid;
  if (!navGrid) {
    return null;
  }
  const [cellX, cellZ] = self.worldToGrid(worldX, worldZ);
  if (cellX === null || cellZ === null) {
    return null;
  }
  const cellIndex = (cellZ * navGrid.width) + cellX;
  const terrainType = navGrid.terrainType[cellIndex]!;
  if (terrainType === NAV_CLIFF) {
    return null;
  }
  if (terrainType === NAV_IMPASSABLE || terrainType === NAV_BRIDGE_IMPASSABLE) {
    return null;
  }

  const waterHeight = self.getWaterHeightAt(worldX, worldZ);
  if (waterHeight !== null && worldY < waterHeight) {
    return null;
  }

  if (doesCombatDropPositionOverlapAnyObject(self, worldX, worldZ, 5)) {
    return null;
  }

  return { x: worldX, z: worldZ };
}

export function doesCombatDropPositionOverlapAnyObject(self: GL, worldX: number, worldZ: number, radius: number): boolean {
  for (const entity of self.spawnedEntities.values()) {
    if (entity.destroyed || self.isEntityOffMap(entity)) {
      continue;
    }
    const geometry = entity.obstacleGeometry;
    if (geometry) {
      if (geometry.shape === 'box') {
        if (doesCircleBoxGeometryOverlap(self, 
          { x: worldX, z: worldZ },
          radius,
          {
            x: entity.x,
            z: entity.z,
            angle: entity.rotationY,
            geometry,
          },
        )) {
          return true;
        }
      } else if (doesCircleGeometryOverlap(self, 
        { x: worldX, z: worldZ },
        radius,
        { x: entity.x, z: entity.z },
        geometry.majorRadius,
      )) {
        return true;
      }
      continue;
    }

    const entityRadius = self.resolveEntityBoundingCircleRadius2D(entity);
    if (doesCircleGeometryOverlap(self, 
      { x: worldX, z: worldZ },
      radius,
      { x: entity.x, z: entity.z },
      entityRadius,
    )) {
      return true;
    }
  }
  return false;
}

export function handlePlaceBeaconCommand(self: GL, command: PlaceBeaconCommand): void {
  const localSide = self.resolveLocalPlayerSide();
  if (!localSide) {
    return;
  }

  const beaconTemplateName = self.resolveBeaconTemplateNameForSide(localSide);
  if (!beaconTemplateName) {
    return;
  }

  if (
    self.countActiveEntitiesOfTemplateForSide(localSide, beaconTemplateName)
    >= SOURCE_DEFAULT_MAX_BEACONS_PER_PLAYER
  ) {
    return;
  }

  const registry = self.iniDataRegistry;
  if (!registry) {
    return;
  }
  const beaconObjectDef = findObjectDefByName(registry, beaconTemplateName);
  if (!beaconObjectDef) {
    return;
  }

  const [x, z] = self.clampWorldPositionToMapBounds(command.targetPosition[0], command.targetPosition[2]);
  const terrainY = self.resolveGroundHeight(x, z);

  const mapObject: MapObjectJSON = {
    templateName: beaconObjectDef.name,
    angle: 0,
    flags: 0,
    position: {
      x,
      y: z,
      z: 0,
    },
    properties: {},
  };
  const created = self.createMapEntity(mapObject, beaconObjectDef, registry, self.mapHeightmap);
  created.side = localSide;
  created.controllingPlayerToken = self.normalizeControllingPlayerToken(localSide);
  created.x = x;
  created.z = z;
  created.y = terrainY + created.baseHeight;
  self.updatePathfindPosCell(created);
  self.addEntityToWorld(created);
  self.registerEntityEnergy(created);
  self.initializeMinefieldState(created);
  self.registerTunnelEntity(created);
}

export function handleEnterObjectCommand(self: GL, command: EnterObjectCommand): void {
  const source = self.spawnedEntities.get(command.entityId);
  const target = self.spawnedEntities.get(command.targetObjectId);
  if (!source || !target || source.destroyed || target.destroyed) {
    return;
  }
  const commandSource = command.commandSource ?? 'PLAYER';

  if (!canQueueEnterObjectAction(self, source, target, command.action, commandSource)) {
    return;
  }

  // Source parity: MSG_ENTER routes through AIGroup::groupEnter into
  // aiEnter target-action state. We track pending enter intent and resolve a
  // minimal action subset on contact.
  cancelEntityCommandPathActions(self, source.id);
  self.clearAttackTarget(source.id);
  self.issueMoveTo(source.id, target.x, target.z);
  self.pendingEnterObjectActions.set(source.id, {
    targetObjectId: target.id,
    action: command.action,
    commandSource,
  });
}

export function canQueueEnterObjectAction(self: GL, 
  source: MapEntity,
  target: MapEntity,
  action: EnterObjectCommand['action'],
  commandSource: 'PLAYER' | 'AI' | 'SCRIPT',
): boolean {
  if (!source.canMove) {
    return false;
  }
  if (!passesCommonEnterObjectValidation(self, source, target, commandSource)) {
    return false;
  }

  switch (action) {
    case 'hijackVehicle':
      return self.canExecuteHijackVehicleEnterAction(source, target);
    case 'convertToCarBomb':
      return self.canExecuteConvertToCarBombEnterAction(source, target);
    case 'sabotageBuilding':
      return self.canExecuteSabotageBuildingEnterAction(source, target);
    case 'repairVehicle':
      return self.canExecuteRepairVehicleEnterAction(source, target, commandSource);
    case 'captureUnmannedFactionUnit':
      return self.canExecuteCaptureUnmannedFactionUnitEnterAction(source, target, commandSource);
    default:
      return false;
  }
}

export function passesCommonEnterObjectValidation(self: GL, 
  source: MapEntity,
  target: MapEntity,
  commandSource: 'PLAYER' | 'AI' | 'SCRIPT',
): boolean {
  if (source.id === target.id) {
    return false;
  }
  // Source parity: ActionManager::canEnterObject rejects dead/effectively-dead targets.
  if (isEntityEffectivelyDeadForEnter(self, target)) {
    return false;
  }
  if (self.isContainerEnterTargetShrouded(source, target, commandSource)) {
    return false;
  }
  if (self.entityHasObjectStatus(source, 'UNDER_CONSTRUCTION')) {
    return false;
  }
  if (self.entityHasObjectStatus(target, 'UNDER_CONSTRUCTION')) {
    return false;
  }
  if (self.entityHasObjectStatus(target, 'SOLD')) {
    return false;
  }
  if (self.entityHasObjectStatus(target, 'DISABLED_SUBDUED')) {
    return false;
  }
  const sourceKindOf = self.resolveEntityKindOfSet(source);
  if (sourceKindOf.has('STRUCTURE') || sourceKindOf.has('IMMOBILE')) {
    return false;
  }
  if (sourceKindOf.has('IGNORED_IN_GUI') || sourceKindOf.has('MOB_NEXUS')) {
    return false;
  }
  const targetKindOf = self.resolveEntityKindOfSet(target);
  if (targetKindOf.has('IGNORED_IN_GUI')) {
    return false;
  }
  return true;
}

export function isEntityEffectivelyDeadForEnter(self: GL, entity: MapEntity): boolean {
  if (self.isScriptEntityEffectivelyDead(entity)) {
    return true;
  }
  // Source parity: ActionManager::canEnterObject checks Object::isEffectivelyDead.
  // Body-less objects can be enterable, so health-only death applies when damageable.
  return entity.canTakeDamage && entity.health <= 0;
}

export function isEntityDozerCapable(self: GL, entity: MapEntity): boolean {
  const kindOf = self.resolveEntityKindOfSet(entity);
  return kindOf.has('DOZER') || entity.dozerAIProfile !== null;
}

export function isWorkerEntity(self: GL, entity: MapEntity): boolean {
  if (!entity.dozerAIProfile || !entity.supplyTruckProfile) {
    return false;
  }
  return entity.kindOf.has('INFANTRY');
}

export function handleConstructBuildingCommand(self: GL, command: ConstructBuildingCommand): void {
  const constructor = self.spawnedEntities.get(command.entityId);
  if (!constructor || constructor.destroyed) {
    return;
  }

  if (!isEntityDozerCapable(self, constructor)) {
    return;
  }

  const registry = self.iniDataRegistry;
  if (!registry) {
    return;
  }

  const objectDef = findObjectDefByName(registry, command.templateName);
  if (!objectDef) {
    return;
  }

  const side = self.normalizeSide(constructor.side);
  if (!side) {
    return;
  }
  if (!self.canSideBuildUnitTemplate(side, objectDef, self.getControllingPlayerTypeForEntity(constructor))) {
    return;
  }
  if (!self.canEntityIssueBuildCommandForTemplate(constructor, objectDef.name, ['DOZER_CONSTRUCT', 'UNIT_BUILD'])) {
    return;
  }

  const placementPositions = self.resolveConstructPlacementPositions(command, objectDef);
  if (placementPositions.length === 0) {
    return;
  }

  if (isWorkerEntity(self, constructor)) {
    // Source parity: WorkerAIUpdate::newTask clears preferred dock when entering dozer tasks.
    self.resetSupplyTruckState(constructor.id, true);
  }
  // Source parity: DozerAIUpdate/WorkerAIUpdate::newTask retasks dozer work items.
  // Construct task overrides any active repair task.
  if (self.pendingRepairActions.has(constructor.id)) {
    self.pendingRepairActions.delete(constructor.id);
    clearDozerTaskOrder(self, constructor, 'REPAIR');
  }
  // Construct task replacement should release previous partial build ownership.
  if (self.pendingConstructionActions.has(constructor.id)) {
    cancelDozerConstructionTask(self, constructor.id);
  }

  const buildCost = self.resolveObjectBuildCost(objectDef, side);
  const maxSimultaneousOfType = self.resolveMaxSimultaneousOfType(objectDef);
  const isLineBuild = isLineBuildTemplate(self, objectDef);
  for (const [x, y, z] of placementPositions) {
    clearRemovableForConstruction(self, 
      objectDef,
      x,
      z,
      command.angle,
      constructor.id,
    );
    if (
      !moveObjectsForConstruction(self, 
        objectDef,
        x,
        z,
        command.angle,
        side,
        constructor.id,
      )
    ) {
      continue;
    }

    if (
      !isConstructLocationClear(self, 
        objectDef,
        x,
        z,
        command.angle,
        side,
        constructor.id,
      )
    ) {
      continue;
    }

    // Source parity: BuildAssistant::isLocationLegalToBuild —
    // terrain tile restrictions and height flatness check.
    if (!isConstructTerrainLegal(self, objectDef, x, z, command.angle)) {
      continue;
    }

    if (maxSimultaneousOfType > 0) {
      const existingCount = self.countActiveEntitiesForMaxSimultaneousForSide(side, objectDef);
      if (existingCount >= maxSimultaneousOfType) {
        break;
      }
    }

    if (buildCost > 0) {
      const withdrawn = self.withdrawSideCredits(side, buildCost);
      if (withdrawn < buildCost) {
        if (withdrawn > 0) {
          self.depositSideCredits(side, withdrawn);
        }
        self.emitEvaEvent('INSUFFICIENT_FUNDS', side, 'own');
        break;
      }
    }

    const created = self.spawnConstructedObject(
      constructor,
      objectDef,
      [x, y, z],
      command.angle,
    );
    if (!created) {
      if (isLineBuild) {
        continue;
      }
      break;
    }
  }
}

export function clearRemovableForConstruction(self: GL, 
  objectDef: ObjectDef,
  worldX: number,
  worldZ: number,
  angle: number,
  ignoredEntityId: number,
): void {
  const buildGeometry = resolveConstructCollisionGeometry(self, objectDef);
  if (!buildGeometry) {
    return;
  }

  for (const blocker of self.spawnedEntities.values()) {
    if (blocker.id === ignoredEntityId || blocker.destroyed) {
      continue;
    }

    if (
      !doesConstructionGeometryOverlap(self, 
        { x: worldX, z: worldZ },
        angle,
        buildGeometry,
        blocker,
        resolveConstructCollisionGeometryForEntity(self, blocker),
      )
    ) {
      continue;
    }

    if (isRemovableForConstruction(self, blocker) && !isAlwaysSelectableForConstruction(self, blocker)) {
      self.markEntityDestroyed(blocker.id, -1);
    }
  }
}

export function moveObjectsForConstruction(self: GL, 
  objectDef: ObjectDef,
  worldX: number,
  worldZ: number,
  angle: number,
  owningSide: string,
  ignoredEntityId: number,
): boolean {
  const buildGeometry = resolveConstructCollisionGeometry(self, objectDef);
  if (!buildGeometry) {
    return true;
  }

  let anyUnmovables = false;
  const clearanceRadius = Math.hypot(buildGeometry.majorRadius, buildGeometry.minorRadius) * 1.4;
  for (const blocker of self.spawnedEntities.values()) {
    if (blocker.id === ignoredEntityId || blocker.destroyed) {
      continue;
    }

    if (
      !doesConstructionGeometryOverlap(self, 
        { x: worldX, z: worldZ },
        angle,
        buildGeometry,
        blocker,
        resolveConstructCollisionGeometryForEntity(self, blocker),
      )
    ) {
      continue;
    }

    if (
      isRemovableForConstruction(self, blocker)
      || isMineForConstruction(self, blocker)
      || isInertForConstruction(self, blocker)
    ) {
      continue;
    }
    if (isAlwaysSelectableForConstruction(self, blocker)) {
      continue;
    }

    const relationship = getConstructingRelationship(self, owningSide, blocker.side);
    if (relationship === RELATIONSHIP_ENEMIES || isDisabledForConstruction(self, blocker) || blocker.canMove === false) {
      anyUnmovables = true;
      continue;
    }

    const variedRadius = (0.5 + self.gameRandom.nextFloat()) * clearanceRadius;
    const direction = (self.gameRandom.nextFloat() * Math.PI * 2) - Math.PI;
    const destinationX = worldX + Math.cos(direction) * variedRadius;
    const destinationZ = worldZ + Math.sin(direction) * variedRadius;
    self.issueMoveTo(blocker.id, destinationX, destinationZ, NO_ATTACK_DISTANCE, true);
    if (!blocker.canMove) {
      anyUnmovables = true;
    }
  }

  return !anyUnmovables;
}

export function isConstructLocationClear(self: GL, 
  objectDef: ObjectDef,
  worldX: number,
  worldZ: number,
  angle: number,
  owningSide: string,
  ignoredEntityId: number,
): boolean {
  const buildGeometry = resolveConstructCollisionGeometry(self, objectDef);
  if (!buildGeometry) {
    return true;
  }

  for (const blocker of self.spawnedEntities.values()) {
    if (blocker.id === ignoredEntityId || blocker.destroyed) {
      continue;
    }

    if (
      !doesConstructionGeometryOverlap(self, 
        { x: worldX, z: worldZ },
        angle,
        buildGeometry,
        blocker,
        resolveConstructCollisionGeometryForEntity(self, blocker),
      )
    ) {
      continue;
    }

    if (
      isRemovableForConstruction(self, blocker)
      || isMineForConstruction(self, blocker)
      || isInertForConstruction(self, blocker)
    ) {
      continue;
    }

    const relationship = getConstructingRelationship(self, owningSide, blocker.side);
    if (
      relationship === RELATIONSHIP_ENEMIES
      || isImmobileForConstruction(self, blocker)
      || isDisabledForConstruction(self, blocker)
    ) {
      return false;
    }
  }

  return true;
}

export function isConstructTerrainLegal(self: GL, 
  objectDef: ObjectDef,
  worldX: number,
  worldZ: number,
  angle: number,
): boolean {
  const navGrid = self.navigationGrid;
  const heightmap = self.mapHeightmap;
  if (!navGrid || !heightmap) {
    return true;
  }

  const geometry = resolveConstructCollisionGeometry(self, objectDef);
  if (!geometry) {
    return true;
  }

  // Compute footprint half-extents.
  const halfW = geometry.majorRadius;
  const halfH = geometry.shape === 'box' ? geometry.minorRadius : geometry.majorRadius;

  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);

  let loHeight = Infinity;
  let hiHeight = -Infinity;

  // Sample the footprint at cell resolution (MAP_XY_FACTOR).
  for (let ly = -halfH; ly <= halfH + 0.01; ly += MAP_XY_FACTOR) {
    for (let lx = -halfW; lx <= halfW + 0.01; lx += MAP_XY_FACTOR) {
      // For circular geometry, skip points outside the circle.
      if (geometry.shape === 'circle') {
        const dist2 = lx * lx + ly * ly;
        if (dist2 > halfW * halfW) {
          continue;
        }
      }

      // Transform local → world.
      const wx = worldX + (lx * cosA - ly * sinA);
      const wz = worldZ + (lx * sinA + ly * cosA);

      // Check navigation cell type.
      const cellX = Math.floor(wx / MAP_XY_FACTOR);
      const cellZ = Math.floor(wz / MAP_XY_FACTOR);
      if (cellX >= 0 && cellX < navGrid.width && cellZ >= 0 && cellZ < navGrid.height) {
        const cellIndex = cellZ * navGrid.width + cellX;
        const terrainCell = navGrid.terrainType[cellIndex]!;
        if (
          terrainCell === NAV_WATER
          || terrainCell === NAV_CLIFF
          || terrainCell === NAV_IMPASSABLE
        ) {
          return false;
        }
      } else {
        // Out of map bounds.
        return false;
      }

      // Track height range for flatness check.
      const h = heightmap.getInterpolatedHeight(wx, wz);
      if (h < loHeight) loHeight = h;
      if (h > hiHeight) hiHeight = h;
    }
  }

  // Source parity: BuildAssistant::checkSampleBuildLocation —
  // reject if height variation exceeds threshold.  C++ uses
  // TheGlobalData->m_allowedHeightVariationForBuilding (default 0.0
  // which is overridden in INI).  We use the cliff delta as a
  // reasonable default.
  if (hiHeight - loHeight > CLIFF_HEIGHT_DELTA) {
    return false;
  }

  return true;
}

export function resolveConstructCollisionGeometry(self: GL, objectDef: ObjectDef | undefined): ObstacleGeometry | null {
  const geometry = self.resolveObstacleGeometry(objectDef);
  if (!geometry) {
    return null;
  }

  if (geometry.shape === 'box') {
    return geometry;
  }

  const radius = geometry.majorRadius;
  if (!Number.isFinite(radius) || radius <= 0) {
    return null;
  }
  return {
    shape: 'circle',
    majorRadius: radius,
    minorRadius: radius,
    height: geometry.height,
  };
}

export function resolveConstructCollisionGeometryForEntity(self: GL, entity: MapEntity): ObstacleGeometry | null {
  if (entity.obstacleGeometry) {
    return entity.obstacleGeometry;
  }

  const objectDef = self.resolveObjectDefByTemplateName(entity.templateName);
  return resolveConstructCollisionGeometry(self, objectDef ?? undefined);
}

export function doesConstructionGeometryOverlap(self: GL, 
  leftPosition: { x: number; z: number },
  leftAngle: number,
  leftGeometry: ObstacleGeometry,
  rightEntity: MapEntity,
  rightGeometry: ObstacleGeometry | null,
): boolean {
  if (!rightGeometry) {
    return false;
  }

  if (leftGeometry.shape === 'circle' && rightGeometry.shape === 'circle') {
    return doesCircleGeometryOverlap(self, 
      leftPosition,
      leftGeometry.majorRadius,
      { x: rightEntity.x, z: rightEntity.z },
      rightGeometry.majorRadius,
    );
  }

  if (leftGeometry.shape === 'box' && rightGeometry.shape === 'box') {
    return doesBoxGeometryOverlap(self, 
      leftPosition,
      leftAngle,
      leftGeometry,
      { x: rightEntity.x, z: rightEntity.z },
      rightEntity.rotationY,
      rightGeometry,
    );
  }

  if (leftGeometry.shape === 'circle') {
    return doesCircleBoxGeometryOverlap(self, 
      leftPosition,
      leftGeometry.majorRadius,
      {
        x: rightEntity.x,
        z: rightEntity.z,
        angle: rightEntity.rotationY,
        geometry: rightGeometry,
      },
    );
  }

  return doesCircleBoxGeometryOverlap(self, 
    { x: rightEntity.x, z: rightEntity.z },
    rightGeometry.majorRadius,
    {
      x: leftPosition.x,
      z: leftPosition.z,
      angle: leftAngle,
      geometry: leftGeometry,
    },
  );
}

export function doesCircleGeometryOverlap(self: GL, 
  firstPosition: { x: number; z: number },
  firstRadius: number,
  secondPosition: { x: number; z: number },
  secondRadius: number,
): boolean {
  const distanceX = firstPosition.x - secondPosition.x;
  const distanceZ = firstPosition.z - secondPosition.z;
  const minDistance = firstRadius + secondRadius;
  return (distanceX * distanceX + distanceZ * distanceZ) <= (minDistance * minDistance);
}

export function doesCircleBoxGeometryOverlap(self: GL, 
  circlePosition: { x: number; z: number },
  circleRadius: number,
  box: {
    x: number;
    z: number;
    angle: number;
    geometry: ObstacleGeometry;
  },
): boolean {
  if (box.geometry.majorRadius <= 0 || box.geometry.minorRadius <= 0) {
    return false;
  }

  const cos = Math.cos(-box.angle);
  const sin = Math.sin(-box.angle);
  const dx = circlePosition.x - box.x;
  const dz = circlePosition.z - box.z;
  const localX = (dx * cos) + (dz * sin);
  const localZ = (-dx * sin) + (dz * cos);
  const clampedX = clamp(localX, -box.geometry.majorRadius, box.geometry.majorRadius);
  const clampedZ = clamp(localZ, -box.geometry.minorRadius, box.geometry.minorRadius);
  const distanceX = localX - clampedX;
  const distanceZ = localZ - clampedZ;
  return (distanceX * distanceX + distanceZ * distanceZ) <= (circleRadius * circleRadius);
}

export function doesBoxGeometryOverlap(self: GL, 
  leftPosition: { x: number; z: number },
  leftAngle: number,
  leftGeometry: ObstacleGeometry,
  rightPosition: { x: number; z: number },
  rightAngle: number,
  rightGeometry: ObstacleGeometry,
): boolean {
  if (leftGeometry.majorRadius <= 0 || leftGeometry.minorRadius <= 0
    || rightGeometry.majorRadius <= 0 || rightGeometry.minorRadius <= 0) {
    return false;
  }

  const deltaX = rightPosition.x - leftPosition.x;
  const deltaZ = rightPosition.z - leftPosition.z;

  const leftXAxisX = Math.cos(leftAngle);
  const leftXAxisZ = Math.sin(leftAngle);
  const leftZAxisX = -leftXAxisZ;
  const leftZAxisZ = leftXAxisX;
  const rightXAxisX = Math.cos(rightAngle);
  const rightXAxisZ = Math.sin(rightAngle);
  const rightZAxisX = -rightXAxisZ;
  const rightZAxisZ = rightXAxisX;

  const projectionAxes = [
    { x: leftXAxisX, z: leftXAxisZ },
    { x: leftZAxisX, z: leftZAxisZ },
    { x: rightXAxisX, z: rightXAxisZ },
    { x: rightZAxisX, z: rightZAxisZ },
  ];

  for (const axis of projectionAxes) {
    const leftRadius = projectBoxRadiusOntoAxis(self, leftGeometry, axis, leftXAxisX, leftXAxisZ, leftZAxisX, leftZAxisZ);
    const rightRadius = projectBoxRadiusOntoAxis(self, 
      rightGeometry,
      axis,
      rightXAxisX,
      rightXAxisZ,
      rightZAxisX,
      rightZAxisZ,
    );
    const distanceToAxis = Math.abs((deltaX * axis.x) + (deltaZ * axis.z));
    if (distanceToAxis > leftRadius + rightRadius) {
      return false;
    }
  }

  return true;
}

export function projectBoxRadiusOntoAxis(self: GL, 
  geometry: ObstacleGeometry,
  axis: { x: number; z: number },
  axisX: number,
  axisZ: number,
  zAxisX: number,
  zAxisZ: number,
): number {
  return (geometry.majorRadius * Math.abs((axis.x * axisX) + (axis.z * axisZ)))
    + (geometry.minorRadius * Math.abs((axis.x * zAxisX) + (axis.z * zAxisZ)));
}

export function isRemovableForConstruction(self: GL, entity: MapEntity): boolean {
  if (entity.destroyed) {
    return false;
  }

  const kindOf = self.resolveEntityKindOfSet(entity);
  if (kindOf.has('INERT')) {
    return false;
  }
  if (kindOf.has('SHRUBBERY') || kindOf.has('CLEARED_BY_BUILD')) {
    return true;
  }
  return entity.health <= 0;
}

export function isMineForConstruction(self: GL, entity: MapEntity): boolean {
  return self.resolveEntityKindOfSet(entity).has('MINE');
}

export function isInertForConstruction(self: GL, entity: MapEntity): boolean {
  return self.resolveEntityKindOfSet(entity).has('INERT');
}

export function isAlwaysSelectableForConstruction(self: GL, entity: MapEntity): boolean {
  return self.resolveEntityKindOfSet(entity).has('ALWAYS_SELECTABLE');
}

export function isImmobileForConstruction(self: GL, entity: MapEntity): boolean {
  return self.resolveEntityKindOfSet(entity).has('IMMOBILE');
}

export function isEntityDisabledForMovement(self: GL, entity: MapEntity): boolean {
  return (
    self.entityHasObjectStatus(entity, 'DISABLED_HELD')
    || self.entityHasObjectStatus(entity, 'DISABLED_EMP')
    || self.entityHasObjectStatus(entity, 'DISABLED_HACKED')
    || self.entityHasObjectStatus(entity, 'DISABLED_SUBDUED')
    || self.entityHasObjectStatus(entity, 'DISABLED_PARALYZED')
    || self.entityHasObjectStatus(entity, 'DISABLED_UNMANNED')
    || self.entityHasObjectStatus(entity, 'DISABLED_UNDERPOWERED')
  );
}

export function isDisabledForConstruction(self: GL, entity: MapEntity): boolean {
  return (
    self.entityHasObjectStatus(entity, 'DISABLED')
    || self.entityHasObjectStatus(entity, 'DISABLED_SUBDUED')
    || self.entityHasObjectStatus(entity, 'DISABLED_HACKED')
    || self.entityHasObjectStatus(entity, 'DISABLED_EMP')
    || self.entityHasObjectStatus(entity, 'DISABLED_HELD')
    || self.entityHasObjectStatus(entity, 'DISABLED_UNDERPOWERED')
    || self.entityHasObjectStatus(entity, 'SCRIPT_DISABLED')
    || self.entityHasObjectStatus(entity, 'SCRIPT_UNPOWERED')
  );
}

export function isEntityDisabledForScriptCommandButton(self: GL, entity: MapEntity): boolean {
  return self.entityHasObjectStatus(entity, 'DISABLED')
    || self.entityHasObjectStatus(entity, 'SCRIPT_DISABLED')
    || self.entityHasObjectStatus(entity, 'SCRIPT_UNPOWERED')
    || isEntityDisabledForMovement(self, entity);
}

export function isLineBuildTemplate(self: GL, objectDef: ObjectDef): boolean {
  return self.normalizeKindOf(objectDef.kindOf).has('LINEBUILD');
}

export function getConstructingRelationship(self: GL, owningSide: string, otherSide: string | undefined): number {
  const source = self.normalizeSide(owningSide);
  const target = self.normalizeSide(otherSide ?? '');
  if (!source || !target) {
    return RELATIONSHIP_NEUTRAL;
  }
  return self.getTeamRelationshipBySides(source, target);
}

export function handleCancelDozerConstructionCommand(self: GL, command: CancelDozerConstructionCommand): void {
  const building = self.spawnedEntities.get(command.entityId);
  if (!building || building.destroyed || building.category !== 'building') {
    return;
  }

  // Source parity: MSG_DOZER_CANCEL_CONSTRUCT only applies to structures under construction.
  if (!self.entityHasObjectStatus(building, 'UNDER_CONSTRUCTION')) {
    return;
  }

  if (!self.entityHasObjectStatus(building, 'RECONSTRUCTING')) {
    const objectDef = self.resolveObjectDefByTemplateName(building.templateName);
    if (objectDef) {
      const amount = self.resolveObjectBuildCost(objectDef, building.side ?? '');
      self.depositSideCredits(building.side, amount);
    }
  }

  self.markEntityDestroyed(building.id, -1);
}

export function handleSellCommand(self: GL, command: SellCommand): void {
  const entity = self.spawnedEntities.get(command.entityId);
  if (!entity || entity.destroyed) {
    return;
  }
  if (entity.category !== 'building') {
    return;
  }
  if (self.sellingEntities.has(entity.id)) {
    return;
  }
  // Source parity: unfinished structures do not enter the BuildAssistant sell flow.
  // The player-visible action for an under-construction building is construction cancel
  // (MSG_DOZER_CANCEL_CONSTRUCT), which refunds full cost and destroys the scaffold.
  // Our command API can receive a raw sell request from tests/scripts, so normalize it
  // to the source-authentic cancel path instead of silently ignoring the request.
  if (self.entityHasObjectStatus(entity, 'UNDER_CONSTRUCTION')) {
    handleCancelDozerConstructionCommand(self, { type: 'cancelDozerConstruction', entityId: entity.id });
    return;
  }

  // Source parity: BuildAssistant::sellObject starts a timed teardown
  // (construction-percent countdown) and refunds queue production immediately.
  cancelEntityCommandPathActions(self, entity.id);
  self.clearAttackTarget(entity.id);
  self.stopEntity(entity.id);
  self.cancelAndRefundAllProductionOnDeath(entity);
  entity.objectStatusFlags.add('SOLD');
  entity.objectStatusFlags.add('UNSELECTABLE');
  self.removeEntityFromSelection(entity.id);

  // Source parity: BuildAssistant::sellObject invokes contain->onSelling().
  // Open/Garrison contain variants map to passenger evacuation on sell start.
  // Source parity: TunnelContain::onSelling — eject all if this is the last tunnel.
  if (entity.containProfile?.moduleType === 'TUNNEL') {
    self.handleTunnelSelling(entity);
  } else if (entity.containProfile && self.collectContainedEntityIds(entity.id).length > 0) {
    self.evacuateContainedEntities(entity, entity.x, entity.z, null);
  }

  if (entity.parkingPlaceProfile) {
    const parkedEntityIds = Array.from(entity.parkingPlaceProfile.occupiedSpaceEntityIds.values());
    for (const parkedEntityId of parkedEntityIds) {
      self.markEntityDestroyed(parkedEntityId, entity.id);
    }
  }

  self.sellingEntities.set(entity.id, {
    sellFrame: self.frameCounter,
    constructionPercent: 99.9,
  });
}

export function canEntityGetHealedAt(self: GL, 
  source: MapEntity,
  healTarget: MapEntity,
  commandSource: 'PLAYER' | 'AI' | 'SCRIPT',
): boolean {
  if (self.getTeamRelationship(source, healTarget) !== RELATIONSHIP_ALLIES) {
    return false;
  }
  if (isEntityEffectivelyDeadForEnter(self, healTarget)) {
    return false;
  }
  if (self.entityHasObjectStatus(source, 'UNDER_CONSTRUCTION') || self.entityHasObjectStatus(healTarget, 'UNDER_CONSTRUCTION')) {
    return false;
  }
  if (self.entityHasObjectStatus(healTarget, 'SOLD')) {
    return false;
  }
  if (!self.resolveEntityKindOfSet(source).has('INFANTRY')) {
    return false;
  }
  if (!self.resolveEntityKindOfSet(healTarget).has('HEAL_PAD')) {
    return false;
  }
  if (self.isContainerEnterTargetShrouded(source, healTarget, commandSource)) {
    return false;
  }
  if (source.health >= source.maxHealth) {
    return false;
  }
  return true;
}

export function isSameControllingPlayerOrSide(self: GL, left: MapEntity, right: MapEntity): boolean {
  const leftOwner = self.normalizeControllingPlayerToken(left.controllingPlayerToken ?? undefined);
  const rightOwner = self.normalizeControllingPlayerToken(right.controllingPlayerToken ?? undefined);
  if (leftOwner !== null && rightOwner !== null) {
    return leftOwner === rightOwner;
  }
  const leftSide = self.normalizeSide(left.side);
  const rightSide = self.normalizeSide(right.side);
  return leftSide !== null && leftSide === rightSide;
}

export function handleGarrisonBuildingCommand(self: GL, command: GarrisonBuildingCommand): void {
  const infantry = self.spawnedEntities.get(command.entityId);
  const building = self.spawnedEntities.get(command.targetBuildingId);
  if (!infantry || !building || infantry.destroyed || building.destroyed) {
    return;
  }
  if (!self.canExecuteGarrisonBuildingEnterAction(infantry, building, 'SCRIPT')) {
    return;
  }

  // Move infantry to building if not close enough.
  const interactionDistance = self.resolveEntityInteractionDistance(infantry, building);
  const distance = Math.hypot(building.x - infantry.x, building.z - infantry.z);
  if (distance > interactionDistance) {
    self.issueMoveTo(infantry.id, building.x, building.z);
    // Re-issue garrison when close enough via pending action.
    self.pendingGarrisonActions.set(infantry.id, building.id);
    return;
  }

  self.enterGarrisonBuilding(infantry, building);
}

export function updatePendingGarrisonActions(self: GL): void {
  for (const [infantryId, buildingId] of self.pendingGarrisonActions.entries()) {
    const infantry = self.spawnedEntities.get(infantryId);
    const building = self.spawnedEntities.get(buildingId);
    if (!infantry || !building || infantry.destroyed || building.destroyed) {
      self.pendingGarrisonActions.delete(infantryId);
      continue;
    }
    if (!self.canExecuteGarrisonBuildingEnterAction(infantry, building, 'SCRIPT')) {
      self.pendingGarrisonActions.delete(infantryId);
      continue;
    }

    const interactionDistance = self.resolveEntityInteractionDistance(infantry, building);
    const distance = Math.hypot(building.x - infantry.x, building.z - infantry.z);
    if (distance > interactionDistance) {
      continue;
    }

    self.enterGarrisonBuilding(infantry, building);
  }
}

export function handleEnterTransportCommand(self: GL, command: EnterTransportCommand): void {
  const passenger = self.spawnedEntities.get(command.entityId);
  const transport = self.spawnedEntities.get(command.targetTransportId);
  if (!passenger || !transport || passenger.destroyed || transport.destroyed) {
    return;
  }
  const commandSource = command.commandSource ?? 'PLAYER';
  // Source parity: ActionManager::canEnterObject — cannot enter self.
  if (passenger.id === transport.id) return;
  if (isEntityEffectivelyDeadForEnter(self, passenger) || isEntityEffectivelyDeadForEnter(self, transport)) return;
  if (self.isContainerEnterTargetShrouded(passenger, transport, commandSource)) return;

  // Source parity: OpenContain::addToContain — cannot enter if already contained.
  if (self.isEntityContained(passenger)) return;
  if (!self.canSourceAttemptContainerEnter(passenger)) return;
  if (!self.canTargetAcceptContainerEnter(transport)) return;

  // Validate: target must have a transport-style contain profile.
  const containProfile = transport.containProfile;
  if (!containProfile) return;
  if (containProfile.moduleType === 'HEAL' && passenger.health >= passenger.maxHealth) return;
  if (self.blocksNonOwnerContainerEnter(passenger, transport)) return;
  const ignoreCapacityCheck = self.shouldIgnoreCapacityForNonOwnerContainerEnter(passenger, transport);

  // Source parity: TunnelContain/CaveContain — route to shared-network entry.
  if (containProfile.moduleType === 'TUNNEL' || containProfile.moduleType === 'CAVE') {
    const kindOf = self.resolveEntityKindOfSet(passenger);
    if (kindOf.has('AIRCRAFT')) return;
    const tracker = self.resolveTunnelTrackerForContainer(transport);
    if (!tracker || tracker.passengerIds.size >= self.config.maxTunnelCapacity) return;

    const interactionDistance = self.resolveEntityInteractionDistance(passenger, transport);
    const distance = Math.hypot(transport.x - passenger.x, transport.z - passenger.z);
    if (distance > interactionDistance) {
      self.issueMoveTo(passenger.id, transport.x, transport.z);
      self.pendingTunnelActions.set(passenger.id, transport.id);
      return;
    }
    self.enterTunnel(passenger, transport);
    return;
  }

  const isTransportContain = containProfile.moduleType === 'TRANSPORT'
    || containProfile.moduleType === 'OVERLORD'
    || containProfile.moduleType === 'HELIX';
  const isOpenStyleContain = containProfile.moduleType === 'OPEN'
    || containProfile.moduleType === 'HEAL'
    || containProfile.moduleType === 'INTERNET_HACK';
  if (!isTransportContain && !isOpenStyleContain) return;

  if (isTransportContain) {
    // Source parity: TransportContain::isValidContainerFor — when a rider is a
    // special-zero-slot container (e.g. parachute shell), validate against its rider.
    const validationPassenger = self.resolveScriptTransportValidationEntity(passenger);
    if (self.normalizeSide(validationPassenger.side) !== self.normalizeSide(transport.side)) return;
    if (!self.isScriptContainRelationshipAllowed(transport, validationPassenger)) return;
    if (!self.isScriptContainKindAllowed(transport, validationPassenger)) return;

    const kindOf = self.resolveEntityKindOfSet(validationPassenger);
    if (containProfile.moduleType === 'TRANSPORT') {
      if (!kindOf.has('INFANTRY') && !kindOf.has('VEHICLE')) return;
    } else if (containProfile.moduleType === 'OVERLORD' || containProfile.moduleType === 'HELIX') {
      if (!kindOf.has('INFANTRY') && !kindOf.has('PORTABLE_STRUCTURE')) return;
    }

    if (!ignoreCapacityCheck && !self.canScriptContainerFitEntity(transport, passenger)) return;
  } else {
    if (!self.isScriptContainRelationshipAllowed(transport, passenger)) return;
    if (!self.isScriptContainKindAllowed(transport, passenger)) return;
    if (!ignoreCapacityCheck && !self.canScriptContainerFitEntity(transport, passenger)) return;
  }

  // Move passenger to transport if not close enough.
  const interactionDistance = self.resolveEntityInteractionDistance(passenger, transport);
  const distance = Math.hypot(transport.x - passenger.x, transport.z - passenger.z);
  if (transport.chinookAIProfile && transport.chinookFlightStatus !== 'LANDED') {
    if (distance > interactionDistance) {
      self.issueMoveTo(passenger.id, transport.x, transport.z);
    }
    self.pendingTransportActions.set(passenger.id, transport.id);
    self.setChinookFlightStatus(transport, 'LANDING');
    return;
  }
  if (distance > interactionDistance) {
    self.issueMoveTo(passenger.id, transport.x, transport.z);
    self.pendingTransportActions.set(passenger.id, transport.id);
    return;
  }

  self.enterTransport(passenger, transport);
}

export function updatePendingTransportActions(self: GL): void {
  for (const [passengerId, transportId] of self.pendingTransportActions.entries()) {
    const passenger = self.spawnedEntities.get(passengerId);
    const transport = self.spawnedEntities.get(transportId);
    if (!passenger || !transport || passenger.destroyed || transport.destroyed) {
      self.pendingTransportActions.delete(passengerId);
      continue;
    }
    if (passenger.id === transport.id) {
      self.pendingTransportActions.delete(passengerId);
      continue;
    }
    if (isEntityEffectivelyDeadForEnter(self, passenger) || isEntityEffectivelyDeadForEnter(self, transport)) {
      self.pendingTransportActions.delete(passengerId);
      continue;
    }
    if (!self.canSourceAttemptContainerEnter(passenger) || !self.canTargetAcceptContainerEnter(transport)) {
      self.pendingTransportActions.delete(passengerId);
      continue;
    }
    if (self.blocksNonOwnerContainerEnter(passenger, transport)) {
      self.pendingTransportActions.delete(passengerId);
      continue;
    }
    const ignoreCapacityCheck = self.shouldIgnoreCapacityForNonOwnerContainerEnter(passenger, transport);

    if (transport.chinookAIProfile && transport.chinookFlightStatus !== 'LANDED') {
      self.setChinookFlightStatus(transport, 'LANDING');
      continue;
    }

    if (self.isEntityContained(passenger)) {
      self.pendingTransportActions.delete(passengerId);
      continue;
    }

    const interactionDistance = self.resolveEntityInteractionDistance(passenger, transport);
    const distance = Math.hypot(transport.x - passenger.x, transport.z - passenger.z);
    if (distance > interactionDistance) continue;

    // Close enough — check capacity again and enter.
    const containProfile = transport.containProfile;
    if (!containProfile) {
      self.pendingTransportActions.delete(passengerId);
      continue;
    }

    if (
      containProfile.moduleType === 'TRANSPORT'
      || containProfile.moduleType === 'OVERLORD'
      || containProfile.moduleType === 'HELIX'
    ) {
      const validationPassenger = self.resolveScriptTransportValidationEntity(passenger);
      if (self.normalizeSide(validationPassenger.side) !== self.normalizeSide(transport.side)) {
        self.pendingTransportActions.delete(passengerId);
        continue;
      }
      if (!self.isScriptContainRelationshipAllowed(transport, validationPassenger)) {
        self.pendingTransportActions.delete(passengerId);
        continue;
      }
      if (!self.isScriptContainKindAllowed(transport, validationPassenger)) {
        self.pendingTransportActions.delete(passengerId);
        continue;
      }
    } else if (
      containProfile.moduleType !== 'OPEN'
      && containProfile.moduleType !== 'HEAL'
      && containProfile.moduleType !== 'INTERNET_HACK'
    ) {
      self.pendingTransportActions.delete(passengerId);
      continue;
    } else if (!self.isScriptContainRelationshipAllowed(transport, passenger)) {
      self.pendingTransportActions.delete(passengerId);
      continue;
    } else if (!self.isScriptContainKindAllowed(transport, passenger)) {
      self.pendingTransportActions.delete(passengerId);
      continue;
    }

    if (!ignoreCapacityCheck && !self.canScriptContainerFitEntity(transport, passenger)) {
      self.pendingTransportActions.delete(passengerId);
      continue;
    }
    if (containProfile.moduleType === 'HEAL' && passenger.health >= passenger.maxHealth) {
      self.pendingTransportActions.delete(passengerId);
      continue;
    }

    self.enterTransport(passenger, transport);
  }
}

export function handleRepairBuildingCommand(self: GL, command: RepairBuildingCommand): void {
  const dozer = self.spawnedEntities.get(command.entityId);
  const building = self.spawnedEntities.get(command.targetBuildingId);
  if (!dozer || !building || dozer.destroyed || building.destroyed) return;
  const commandSource = command.commandSource ?? 'PLAYER';

  if (isWorkerEntity(self, dozer)) {
    // Source parity: WorkerAIUpdate::newTask clears preferred dock when entering dozer tasks.
    self.resetSupplyTruckState(dozer.id, true);
  }

  // Source parity: DozerAIUpdate::privateResumeConstruction — if the building is
  // still under construction, resume building instead of repairing.
  if (canDozerResumeConstructionTarget(self, dozer, building, commandSource)) {
    // Source parity: new build task cancels active repair task.
    if (self.pendingRepairActions.has(dozer.id)) {
      self.pendingRepairActions.delete(dozer.id);
      clearDozerTaskOrder(self, dozer, 'REPAIR');
    }
    // Source parity: dozer can own only one active build target at a time.
    const existingBuildTargetId = self.pendingConstructionActions.get(dozer.id);
    if (existingBuildTargetId !== undefined && existingBuildTargetId !== building.id) {
      cancelDozerConstructionTask(self, dozer.id);
    }
    // Another dozer can resume. Claim it.
    building.builderId = dozer.id;
    self.pendingConstructionActions.set(dozer.id, building.id);
    dozer.dozerBuildTaskOrderFrame = self.frameCounter;
    self.issueMoveTo(dozer.id, building.x, building.z);
    return;
  }

  if (!self.canDozerRepairTarget(dozer, building, commandSource)) return;
  if (!canDozerAcceptNewRepairTarget(self, dozer, building)) return;
  // Source parity: repair task replaces active build task for this dozer/worker.
  if (self.pendingConstructionActions.has(dozer.id)) {
    cancelDozerConstructionTask(self, dozer.id);
  }

  // Move dozer to building if not close enough.
  const distance = Math.hypot(building.x - dozer.x, building.z - dozer.z);
  if (distance > 20) {
    self.issueMoveTo(dozer.id, building.x, building.z);
  }
  self.pendingRepairActions.set(dozer.id, building.id);
  dozer.dozerRepairTaskOrderFrame = self.frameCounter;
}

export function canDozerResumeConstructionTarget(self: GL, 
  dozer: MapEntity,
  building: MapEntity,
  commandSource: 'PLAYER' | 'AI' | 'SCRIPT',
): boolean {
  if (!isEntityDozerCapable(self, dozer)) {
    return false;
  }
  if (isEntityEffectivelyDeadForEnter(self, dozer)) {
    return false;
  }
  if (self.isEntityContained(dozer)) {
    return false;
  }

  const isUnderConstruction = building.objectStatusFlags.has('UNDER_CONSTRUCTION');
  if (!isUnderConstruction) {
    return false;
  }

  if (self.getTeamRelationship(dozer, building) !== RELATIONSHIP_ALLIES) {
    return false;
  }
  if (self.isDozerActionTargetShrouded(dozer, building, commandSource)) {
    return false;
  }

  if (building.builderId === 0) {
    return true;
  }

  const builder = self.spawnedEntities.get(building.builderId);
  if (!builder || builder.destroyed) {
    return true;
  }

  if (
    self.pendingConstructionActions.get(builder.id) === building.id
    && getDozerCurrentTask(self, builder) === 'BUILD'
  ) {
    return false;
  }

  return true;
}

export function canDozerAcceptNewRepairTarget(self: GL, dozer: MapEntity, target: MapEntity): boolean {
  if (getDozerCurrentTask(self, dozer) !== 'REPAIR') {
    return true;
  }

  const currentRepairTargetId = self.pendingRepairActions.get(dozer.id);
  if (!currentRepairTargetId) {
    return true;
  }
  if (currentRepairTargetId === target.id) {
    return false;
  }

  const currentRepairTarget = self.spawnedEntities.get(currentRepairTargetId);
  if (!currentRepairTarget || currentRepairTarget.destroyed) {
    return true;
  }

  if (currentRepairTarget.kindOf.has('BRIDGE_TOWER') && target.kindOf.has('BRIDGE_TOWER')) {
    const currentSegmentId = self.bridgeSegmentByControlEntity.get(currentRepairTarget.id);
    const nextSegmentId = self.bridgeSegmentByControlEntity.get(target.id);
    // Source parity: keep repairing current bridge if both towers map to the same bridge segment.
    if (currentSegmentId !== undefined && currentSegmentId === nextSegmentId) {
      return false;
    }
  }

  return true;
}

export function getDozerCurrentTask(self: GL, dozer: MapEntity): 'BUILD' | 'REPAIR' | null {
  const hasBuild = self.pendingConstructionActions.has(dozer.id);
  const hasRepair = self.pendingRepairActions.has(dozer.id);
  if (!hasBuild && !hasRepair) {
    return null;
  }
  if (hasBuild && !hasRepair) {
    return 'BUILD';
  }
  if (hasRepair && !hasBuild) {
    return 'REPAIR';
  }
  return dozer.dozerRepairTaskOrderFrame > dozer.dozerBuildTaskOrderFrame ? 'REPAIR' : 'BUILD';
}

export function clearDozerTaskOrder(self: GL, dozer: MapEntity | null, task: 'BUILD' | 'REPAIR'): void {
  if (!dozer) {
    return;
  }
  if (task === 'BUILD') {
    dozer.dozerBuildTaskOrderFrame = 0;
  } else {
    dozer.dozerRepairTaskOrderFrame = 0;
  }
}

export function updatePendingRepairActions(self: GL): void {
  for (const [dozerId, buildingId] of self.pendingRepairActions.entries()) {
    const dozer = self.spawnedEntities.get(dozerId);
    const building = self.spawnedEntities.get(buildingId);
    if (!dozer || !building || dozer.destroyed || building.destroyed) {
      self.pendingRepairActions.delete(dozerId);
      clearDozerTaskOrder(self, dozer ?? null, 'REPAIR');
      continue;
    }

    if (getDozerCurrentTask(self, dozer) !== 'REPAIR') {
      continue;
    }

    // Building fully repaired.
    if (building.health >= building.maxHealth) {
      self.onObjectRepaired(building.id);
      self.pendingRepairActions.delete(dozerId);
      clearDozerTaskOrder(self, dozer, 'REPAIR');
      continue;
    }

    // Must be close enough to repair.
    const distance = Math.hypot(building.x - dozer.x, building.z - dozer.z);
    if (distance > 20) continue; // Still moving

    // Stop dozer movement while repairing.
    if (dozer.moving) {
      dozer.moving = false;
      dozer.moveTarget = null;
      dozer.movePath = [];
    }

    const repairHealthPercentPerSecond = dozer.dozerAIProfile?.repairHealthPercentPerSecond ?? 0.02;
    if (repairHealthPercentPerSecond <= 0) {
      continue;
    }
    const healAmount = (repairHealthPercentPerSecond / LOGIC_FRAME_RATE) * building.maxHealth;
    if (healAmount <= 0) {
      continue;
    }

    // Source parity: attemptHealingFromSoleBenefactor rejects competing dozers/workers.
    const healed = self.attemptHealingFromSoleBenefactor(building, healAmount, dozer.id, 2);
    if (!healed) {
      self.pendingRepairActions.delete(dozerId);
      clearDozerTaskOrder(self, dozer, 'REPAIR');
      continue;
    }
    if (building.health >= building.maxHealth) {
      self.onObjectRepaired(building.id);
    }
  }
}

export function updateDozerIdleBehavior(self: GL): void {
  for (const entity of self.spawnedEntities.values()) {
    if (entity.destroyed) continue;
    const profile = entity.dozerAIProfile;
    if (!profile || profile.boredTimeFrames <= 0 || profile.boredRange <= 0) continue;

    const hasTask = self.pendingConstructionActions.has(entity.id)
      || self.pendingRepairActions.has(entity.id);
    self.setDozerMineClearingDetail(entity, !hasTask);
    if (isWorkerEntity(self, entity) && !hasTask) {
      // Source parity: WorkerAIUpdate runs dozer logic only while in dozer tasks.
      entity.dozerIdleTooLongTimestamp = self.frameCounter;
      continue;
    }
    const isIdle = !entity.moving
      && entity.moveTarget === null
      && entity.attackTargetEntityId === null
      && entity.attackTargetPosition === null
      && !hasTask;

    if (!isIdle) {
      entity.dozerIdleTooLongTimestamp = self.frameCounter;
      continue;
    }

    if ((self.frameCounter - entity.dozerIdleTooLongTimestamp) <= profile.boredTimeFrames) {
      continue;
    }

    // Source parity: throttle expensive scans by resetting idle timestamp after each check.
    entity.dozerIdleTooLongTimestamp = self.frameCounter;

    const target = findDozerAutoRepairTarget(self, entity, profile.boredRange);
    if (target) {
      handleRepairBuildingCommand(self, {
        type: 'repairBuilding',
        entityId: entity.id,
        targetBuildingId: target.id,
        commandSource: 'AI',
      });
      continue;
    }

    const mineTarget = findDozerAutoMineTarget(self, entity, profile.boredRange);
    if (!mineTarget) {
      continue;
    }

    // Source parity: DozerPrimaryIdleState::update issues aiAttackObject(..., CMD_FROM_DOZER)
    // when no repair target is available.
    self.issueAttackEntity(entity.id, mineTarget.id, 'DOZER');
  }
}

export function findDozerAutoRepairTarget(self: GL, dozer: MapEntity, range: number): MapEntity | null {
  const rangeSqr = range * range;
  let closest: MapEntity | null = null;
  let closestDistSqr = Infinity;
  for (const candidate of self.spawnedEntities.values()) {
    if (candidate.id === dozer.id || candidate.destroyed) continue;
    if (!candidate.kindOf.has('STRUCTURE')) continue;
    if (!self.canDozerRepairTarget(dozer, candidate, 'AI')) continue;

    const dx = candidate.x - dozer.x;
    const dz = candidate.z - dozer.z;
    const distSqr = dx * dx + dz * dz;
    if (distSqr > rangeSqr) continue;

    if (distSqr < closestDistSqr) {
      closest = candidate;
      closestDistSqr = distSqr;
    }
  }
  return closest;
}

export function findDozerAutoMineTarget(self: GL, dozer: MapEntity, range: number): MapEntity | null {
  const rangeSqr = range * range;
  let closest: MapEntity | null = null;
  let closestDistSqr = Infinity;

  for (const candidate of self.spawnedEntities.values()) {
    if (candidate.id === dozer.id || candidate.destroyed) continue;
    const kindOf = self.resolveEntityKindOfSet(candidate);
    if (!kindOf.has('MINE') && !kindOf.has('DEMOTRAP')) continue;
    if (!self.canAttackerTargetEntity(dozer, candidate, 'DOZER')) continue;

    const dx = candidate.x - dozer.x;
    const dz = candidate.z - dozer.z;
    const distSqr = dx * dx + dz * dz;
    if (distSqr > rangeSqr) continue;
    if (distSqr < closestDistSqr) {
      closest = candidate;
      closestDistSqr = distSqr;
    }
  }

  return closest;
}
