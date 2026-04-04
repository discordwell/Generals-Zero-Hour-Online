// @ts-nocheck — self is typed as any; real safety comes from the test suite.
/**
 * Containment system — garrison, transport, tunnel, and container operations.
 *
 * Source parity: Object/Contain/, TransportContain, GarrisonContain, TunnelContain
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { MAP_XY_FACTOR } from '@generals/terrain';
import {
  createRailedTransportRuntimeState as createRailedTransportRuntimeStateImpl,
  executeRailedTransportCommand as executeRailedTransportCommandImpl,
} from './railed-transport.js';
import { isPassengerAllowedToFireFromContainingObject as isPassengerAllowedToFireFromContainingObjectImpl } from './combat-containment.js';
import { RELATIONSHIP_ENEMIES, BASE_REGEN_HEALTH_PERCENT_PER_SECOND, LOGIC_FRAME_RATE, calcBodyDamageState } from './index.js';
type GL = any;

// ---- Containment implementations ----

export function resolveRailedTransportWaypointData(self: GL, mapData: MapDataJSON): RailedTransportWaypointData | null {
  if (!mapData.waypoints) {
    return null;
  }

  return {
    nodes: mapData.waypoints.nodes.map((node) => ({
      id: node.id,
      name: node.name,
      x: node.position.x,
      z: node.position.y,
      biDirectional: node.biDirectional ?? false,
    })),
    links: mapData.waypoints.links.map((link) => ({
      waypoint1: link.waypoint1,
      waypoint2: link.waypoint2,
    })),
  };
}

export function resetContainPlayerEnteredSides(self: GL): void {
  for (const entity of self.spawnedEntities.values()) {
    if (!entity.containProfile) continue;
    entity.containPlayerEnteredSide = null;
    entity.containPlayerEnteredToken = null;
  }
}

export function getCaveContainIndex(self: GL, entityId: number): number | null {
  const entity = self.spawnedEntities.get(entityId);
  if (!entity || entity.destroyed) {
    return null;
  }
  if (entity.containProfile?.moduleType !== 'CAVE') {
    return null;
  }
  const trackerIndex = self.caveTrackerIndexByEntityId.get(entity.id);
  if (trackerIndex !== undefined) {
    return trackerIndex;
  }
  return entity.containProfile.caveIndex ?? 0;
}

export function canSwitchCaveIndexToIndex(self: GL, oldIndex: number, newIndex: number): boolean {
  const oldTracker = resolveCaveTracker(self, oldIndex, false);
  if (oldTracker && oldTracker.passengerIds.size > 0) {
    return false;
  }

  const newTracker = resolveCaveTracker(self, newIndex, false);
  if (newTracker && newTracker.passengerIds.size > 0) {
    return false;
  }

  return true;
}

export function isEntityInEnclosingContainer(self: GL, entity: MapEntity): boolean {
  if (entity.garrisonContainerId !== null) return true;
  if (entity.tunnelContainerId !== null) return true;
  if (entity.helixCarrierId !== null) {
    // Source parity: HelixContain::isEnclosingContainerFor returns FALSE for the
    // portable structure rider — it sits visibly on top and is attackable.
    const carrier = self.spawnedEntities.get(entity.helixCarrierId);
    if (carrier?.helixPortableRiderId === entity.id) return false;
    return true;
  }
  if (entity.transportContainerId !== null) {
    // Source parity: TransportContain/OverlordContain are enclosing by default.
    // OPEN containers are not (passengers visible and attackable, e.g., Battle Bus).
    const transport = self.spawnedEntities.get(entity.transportContainerId);
    if (transport) return isEnclosingContainer(self, transport);
  }
  return false;
}

export function shouldIgnoreRailedTransportPlayerCommand(self: GL, command: GameLogicCommand): boolean {
  const hasEntityId = 'entityId' in command && typeof command.entityId === 'number';
  if (!hasEntityId) {
    return false;
  }

  const blockedCommandType = isRailedTransportPlayerBlockedCommandType(self, command.type);
  if (!blockedCommandType) {
    return false;
  }

  return isRailedTransportEntity(self, command.entityId);
}

export function isRailedTransportPlayerBlockedCommandType(self: GL, commandType: GameLogicCommand['type']): boolean {
  switch (commandType) {
    case 'moveTo':
    case 'attackMoveTo':
    case 'guardPosition':
    case 'guardObject':
    case 'attackEntity':
    case 'fireWeapon':
    case 'switchWeapon':
    case 'stop':
    case 'enterObject':
    case 'combatDrop':
    case 'hackInternet':
    case 'toggleOvercharge':
    case 'detonateDemoTrap':
    case 'toggleDemoTrapMode':
    case 'setRallyPoint':
    case 'garrisonBuilding':
    case 'repairBuilding':
    case 'enterTransport':
      return true;
    default:
      return false;
  }
}

export function isRailedTransportEntity(self: GL, entityId: number): boolean {
  const entity = self.spawnedEntities.get(entityId);
  if (!entity || entity.destroyed) {
    return false;
  }

  const objectDef = self.resolveObjectDefByTemplateName(entity.templateName);
  return self.extractRailedTransportProfile(objectDef ?? undefined) !== null;
}

export function doesSpecialPowerTargetAppearToContainFriendlies(self: GL, source: MapEntity, target: MapEntity): boolean {
  if (!target.containProfile) {
    return false;
  }
  for (const passengerId of collectContainedEntityIds(self, target.id)) {
    const passenger = self.spawnedEntities.get(passengerId);
    if (!passenger || passenger.destroyed) {
      continue;
    }
    if (!passenger.objectStatusFlags.has('STEALTHED')) {
      continue;
    }
    if (self.getTeamRelationship(source, passenger) !== RELATIONSHIP_ENEMIES) {
      return true;
    }
  }
  return false;
}

export function isCaptureBlockedByGarrisonOccupants(self: GL, target: MapEntity): boolean {
  const profile = target.containProfile;
  if (!profile || profile.garrisonCapacity <= 0) {
    return false;
  }
  for (const passengerId of collectContainedEntityIds(self, target.id)) {
    const passenger = self.spawnedEntities.get(passengerId);
    if (!passenger || passenger.destroyed) {
      continue;
    }
    if (!passenger.objectStatusFlags.has('STEALTHED')) {
      return true;
    }
  }
  return false;
}

export function cancelRailedTransportTransit(self: GL, entityId: number): void {
  const state = self.railedTransportStateByEntityId.get(entityId);
  if (!state) {
    return;
  }
  state.inTransit = false;
  state.transitWaypointIds = [];
  state.transitWaypointIndex = 0;
}

export function resolveRailedTransportRuntimeState(self: GL, entityId: number): RailedTransportRuntimeState {
  let state = self.railedTransportStateByEntityId.get(entityId);
  if (!state) {
    state = createRailedTransportRuntimeStateImpl();
    self.railedTransportStateByEntityId.set(entityId, state);
  }
  return state;
}

export function resolveContainerEvacuationPositions(self: GL, 
  container: MapEntity,
  defaultTargetX: number,
  defaultTargetZ: number,
): { spawnX: number; spawnZ: number; targetX: number; targetZ: number } {
  if (container.scriptEvacDisposition !== 1 && container.scriptEvacDisposition !== 2) {
    return {
      spawnX: container.x,
      spawnZ: container.z,
      targetX: defaultTargetX,
      targetZ: defaultTargetZ,
    };
  }

  const scalar = container.scriptEvacDisposition === 1 ? 1 : -1;
  const majorRadius = Math.max(
    container.obstacleGeometry?.majorRadius ?? container.geometryMajorRadius,
    MAP_XY_FACTOR / 2,
  );
  const minorRadius = Math.max(
    container.obstacleGeometry?.minorRadius ?? majorRadius,
    MAP_XY_FACTOR / 4,
  );
  const randomReal = (min: number, max: number): number => min + self.gameRandom.nextFloat() * (max - min);

  const doorLocalX = randomReal(-majorRadius / 4, majorRadius / 4);
  const doorLocalZ = randomReal(minorRadius / 2, minorRadius * 2) * scalar;
  const walkLocalX = randomReal(-majorRadius, majorRadius);
  const walkLocalZ = minorRadius * 10 * scalar;
  const cosTheta = Math.cos(container.rotationY);
  const sinTheta = Math.sin(container.rotationY);

  return {
    spawnX: container.x + (doorLocalX * cosTheta) - (doorLocalZ * sinTheta),
    spawnZ: container.z + (doorLocalX * sinTheta) + (doorLocalZ * cosTheta),
    targetX: container.x + (walkLocalX * cosTheta) - (walkLocalZ * sinTheta),
    targetZ: container.z + (walkLocalX * sinTheta) + (walkLocalZ * cosTheta),
  };
}

export function handleExitContainerCommand(self: GL, entityId: number): void {
  const entity = self.spawnedEntities.get(entityId);
  if (!entity || entity.destroyed) {
    return;
  }

  // Source parity: TunnelContain — use exitTunnel for proper scatter behavior.
  if (entity.tunnelContainerId !== null) {
    const tunnel = self.spawnedEntities.get(entity.tunnelContainerId);
    if (tunnel && !tunnel.destroyed) {
      exitTunnel(self, entity, tunnel);
    } else {
      releaseEntityFromContainer(self, entity);
    }
    return;
  }

  const containerId = entity.parkingSpaceProducerId
    ?? entity.helixCarrierId
    ?? entity.garrisonContainerId
    ?? entity.transportContainerId;
  if (containerId === null) {
    return;
  }

  const container = self.spawnedEntities.get(containerId);
  if (!container || container.destroyed) {
    releaseEntityFromContainer(self, entity);
    return;
  }

  // Source parity: ChinookAIUpdate::getAiFreeToExit — combat-drop exits are owned by
  // ChinookCombatDropState (rappel), not by generic passenger exit commands.
  if (container.chinookAIProfile && self.pendingCombatDropActions.has(container.id)) {
    return;
  }

  if (container.chinookAIProfile && container.chinookFlightStatus !== 'LANDED') {
    container.chinookPendingCommand = { type: 'exitContainer', entityId };
    self.setChinookFlightStatus(container, 'LANDING');
    return;
  }

  // Source parity: AIUpdate::privateExit — blocked when container is DISABLED_SUBDUED.
  // C++ AIUpdate.cpp:3819-3840: prevents passengers exiting subdued containers.
  if (self.entityHasObjectStatus(container, 'DISABLED_SUBDUED')) {
    return;
  }

  self.cancelEntityCommandPathActions(entity.id);
  releaseEntityFromContainer(self, entity);
  const evacuation = resolveContainerEvacuationPositions(self, 
    container,
    container.x + MAP_XY_FACTOR,
    container.z,
  );
  entity.x = evacuation.spawnX;
  entity.z = evacuation.spawnZ;
  entity.y = self.resolveGroundHeight(entity.x, entity.z) + entity.baseHeight;
  self.updatePathfindPosCell(entity);

  if (entity.canMove) {
    self.issueMoveTo(entity.id, evacuation.targetX, evacuation.targetZ);
  }
}

/**
 * Source parity (ZH): AIUpdate.cpp:3846 — privateExitInstantly.
 * Immediately exits the entity from its container without waiting for chinook
 * to land or exit animation delays. Still respects the DISABLED_SUBDUED block.
 * Used by orderAllPassengersToExit(instantly=true) in C++.
 */
export function handleExitContainerInstantlyCommand(self: GL, entityId: number): void {
  const entity = self.spawnedEntities.get(entityId);
  if (!entity || entity.destroyed) {
    return;
  }

  // Source parity: TunnelContain — use exitTunnel for proper scatter behavior.
  if (entity.tunnelContainerId !== null) {
    const tunnel = self.spawnedEntities.get(entity.tunnelContainerId);
    if (tunnel && !tunnel.destroyed) {
      exitTunnel(self, entity, tunnel);
    } else {
      releaseEntityFromContainer(self, entity);
    }
    return;
  }

  const containerId = entity.parkingSpaceProducerId
    ?? entity.helixCarrierId
    ?? entity.garrisonContainerId
    ?? entity.transportContainerId;
  if (containerId === null) {
    return;
  }

  const container = self.spawnedEntities.get(containerId);
  if (!container || container.destroyed) {
    releaseEntityFromContainer(self, entity);
    return;
  }

  // Source parity: AIUpdate.cpp:3857 — DISABLED_SUBDUED still blocks instant exit.
  if (self.entityHasObjectStatus(container, 'DISABLED_SUBDUED')) {
    return;
  }

  // Key difference from handleExitContainerCommand: skip chinook landing wait.
  // In C++ the AI_EXIT_INSTANTLY state calls exitObjectViaDoor directly without
  // coordinating with the container's door state machine.
  self.cancelEntityCommandPathActions(entity.id);
  releaseEntityFromContainer(self, entity);
  const evacuation = resolveContainerEvacuationPositions(self,
    container,
    container.x + MAP_XY_FACTOR,
    container.z,
  );
  entity.x = evacuation.spawnX;
  entity.z = evacuation.spawnZ;
  entity.y = self.resolveGroundHeight(entity.x, entity.z) + entity.baseHeight;
  self.updatePathfindPosCell(entity);

  if (entity.canMove) {
    self.issueMoveTo(entity.id, evacuation.targetX, evacuation.targetZ);
  }
}

export function handleEvacuateCommand(self: GL, entityId: number): void {
  const container = self.spawnedEntities.get(entityId);
  if (!container || container.destroyed) {
    return;
  }

  if (container.chinookAIProfile && container.chinookFlightStatus !== 'LANDED') {
    container.chinookPendingCommand = { type: 'evacuate', entityId };
    self.setChinookFlightStatus(container, 'LANDING');
    return;
  }

  // Source parity: AIUpdate::privateEvacuate — blocked when container is DISABLED_SUBDUED.
  // C++ AIUpdate.cpp:3894-3896: prevents evacuation of subdued buildings (e.g., Microwave Tank).
  if (self.entityHasObjectStatus(container, 'DISABLED_SUBDUED')) {
    return;
  }

  // Source parity: TunnelContain/CaveContain evacuate — exit all shared passengers from this node.
  if (container.containProfile?.moduleType === 'TUNNEL' || container.containProfile?.moduleType === 'CAVE') {
    const tracker = resolveTunnelTrackerForContainer(self, container);
    if (tracker) {
      for (const passengerId of Array.from(tracker.passengerIds)) {
        const passenger = self.spawnedEntities.get(passengerId);
        if (!passenger || passenger.destroyed) continue;
        exitTunnel(self, passenger, container);
      }
    }
    return;
  }

  const objectDef = self.resolveObjectDefByTemplateName(container.templateName);
  const railedProfile = self.extractRailedTransportProfile(objectDef ?? undefined);
  if (railedProfile) {
    const railedState = resolveRailedTransportRuntimeState(self, container.id);
    if (railedState.inTransit) {
      return;
    }
  }

  self.cancelEntityCommandPathActions(container.id);
  evacuateContainedEntities(self, container, container.x, container.z, null);
}

export function handleExecuteRailedTransportCommand(self: GL, command: ExecuteRailedTransportCommand): void {
  const entity = self.spawnedEntities.get(command.entityId);
  if (!entity || entity.destroyed || !entity.canMove) {
    return;
  }

  const objectDef = self.resolveObjectDefByTemplateName(entity.templateName);
  const profile = self.extractRailedTransportProfile(objectDef ?? undefined);
  if (!profile) {
    return;
  }

  executeRailedTransportCommandImpl(entity, profile, {
    waypointIndex: self.railedTransportWaypointIndex,
    resolveRuntimeState: self.resolveRailedTransportRuntimeState.bind(self),
    cancelEntityCommandPathActions: self.cancelEntityCommandPathActions.bind(self),
    clearAttackTarget: self.clearAttackTarget.bind(self),
    stopEntity: self.stopEntity.bind(self),
    issueMoveTo: self.issueMoveTo.bind(self),
    isValidEntity: (candidate) => !candidate.destroyed && candidate.canMove,
  });
}

export function noteContainerEnteredBy(self: GL, container: MapEntity, rider: MapEntity): void {
  if (!container.containProfile) {
    return;
  }
  container.containPlayerEnteredSide = self.normalizeSide(rider.side);
  container.containPlayerEnteredToken = self.resolveEntityControllingPlayerTokenForAffiliation(rider);
}

export function canSourceAttemptContainerEnter(self: GL, source: MapEntity): boolean {
  if (self.isEntityDisabledForMovement(source)) {
    return false;
  }
  if (self.entityHasObjectStatus(source, 'UNDER_CONSTRUCTION')) {
    return false;
  }
  const kindOf = self.resolveEntityKindOfSet(source);
  if (kindOf.has('STRUCTURE') || kindOf.has('IMMOBILE')) {
    return false;
  }
  if (kindOf.has('IGNORED_IN_GUI') || kindOf.has('MOB_NEXUS')) {
    return false;
  }
  return true;
}

export function canTargetAcceptContainerEnter(self: GL, target: MapEntity): boolean {
  if (self.isEntityEffectivelyDeadForEnter(target)) {
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
  if (self.resolveEntityKindOfSet(target).has('IGNORED_IN_GUI')) {
    return false;
  }
  return true;
}

export function isContainerEnterTargetShrouded(self: GL, 
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

export function hasVisibleContainedUnits(self: GL, containerId: number): boolean {
  for (const containedId of collectContainedEntityIds(self, containerId)) {
    const contained = self.spawnedEntities.get(containedId);
    if (!contained || contained.destroyed) {
      continue;
    }
    if (!contained.objectStatusFlags.has('STEALTHED')) {
      return true;
    }
  }
  return false;
}

export function blocksNonOwnerContainerEnter(self: GL, source: MapEntity, target: MapEntity): boolean {
  if (self.isSameControllingPlayerOrSide(source, target)) {
    return false;
  }
  // Source parity: ActionManager::canEnterObject blocks non-owner enters
  // into containers with visible occupants.
  if (hasVisibleContainedUnits(self, target.id)) {
    return true;
  }
  // Source parity: ActionManager::canEnterObject blocks non-owner faction-structure enters.
  return self.isFactionStructure(target);
}

export function shouldIgnoreCapacityForNonOwnerContainerEnter(self: GL, source: MapEntity, target: MapEntity): boolean {
  if (self.isSameControllingPlayerOrSide(source, target)) {
    return false;
  }
  let stealthContainCount = 0;
  for (const containedId of collectContainedEntityIds(self, target.id)) {
    const contained = self.spawnedEntities.get(containedId);
    if (!contained || contained.destroyed) {
      continue;
    }
    if (!contained.objectStatusFlags.has('STEALTHED')) {
      return false;
    }
    stealthContainCount += 1;
  }
  // Source parity: ActionManager::canEnterObject disables capacity checks
  // when non-owner target has only stealthed contained units.
  return stealthContainCount > 0;
}

export function canExecuteGarrisonBuildingEnterAction(self: GL, 
  source: MapEntity,
  building: MapEntity,
  commandSource: 'PLAYER' | 'AI' | 'SCRIPT',
): boolean {
  if (source.id === building.id) {
    return false;
  }
  if (self.isEntityEffectivelyDeadForEnter(source)) {
    return false;
  }
  if (isEntityContained(self, source)) {
    return false;
  }
  if (isContainerEnterTargetShrouded(self, source, building, commandSource)) {
    return false;
  }
  if (!canSourceAttemptContainerEnter(self, source)) {
    return false;
  }
  if (!canTargetAcceptContainerEnter(self, building)) {
    return false;
  }

  // Source parity: GarrisonContain::isValidContainerFor (GarrisonContain.cpp:518-547)
  // ReallyDamaged buildings are not garrisonable unless GARRISONABLE_UNTIL_DESTROYED.
  const buildingDamageState = calcBodyDamageState(building.health, building.maxHealth);
  if (buildingDamageState >= 2) {
    const buildingKindOf = self.resolveEntityKindOfSet(building);
    if (!buildingKindOf.has('GARRISONABLE_UNTIL_DESTROYED')) {
      return false;
    }
  }

  const sourceKindOf = self.resolveEntityKindOfSet(source);
  if (!sourceKindOf.has('INFANTRY') || sourceKindOf.has('NO_GARRISON')) {
    return false;
  }

  const containProfile = building.containProfile;
  if (!containProfile || containProfile.moduleType !== 'GARRISON' || containProfile.garrisonCapacity <= 0) {
    return false;
  }
  if (!self.isScriptContainRelationshipAllowed(building, source)) {
    return false;
  }
  if (!self.isScriptContainKindAllowed(building, source)) {
    return false;
  }
  const currentOccupants = collectContainedEntityIds(self, building.id).length;
  if (currentOccupants >= containProfile.garrisonCapacity) {
    return false;
  }

  return true;
}

export function enterGarrisonBuilding(self: GL, source: MapEntity, building: MapEntity): void {
  self.cancelEntityCommandPathActions(source.id);
  self.clearAttackTarget(source.id);
  source.garrisonContainerId = building.id;
  noteContainerEnteredBy(self, building, source);
  source.x = building.x;
  source.z = building.z;
  source.y = building.y;
  source.canMove = false;
  source.moving = false;
  // Source parity: Object::onContainedBy — set UNSELECTABLE on garrisoned entity (C++ Object.cpp).
  // Source parity: GarrisonContain::onContaining — set DISABLED_HELD (C++ GarrisonContain.cpp line 1623).
  source.objectStatusFlags.add('UNSELECTABLE');
  source.objectStatusFlags.add('DISABLED_HELD');
  self.removeEntityFromSelection(source.id);
  self.pendingGarrisonActions.delete(source.id);
}

export function enterTransport(self: GL, passenger: MapEntity, transport: MapEntity): void {
  self.cancelEntityCommandPathActions(passenger.id);
  self.clearAttackTarget(passenger.id);
  passenger.transportContainerId = transport.id;
  noteContainerEnteredBy(self, transport, passenger);
  passenger.x = transport.x;
  passenger.z = transport.z;
  passenger.y = transport.y;
  passenger.moving = false;
  // Source parity: HealContain — track entry frame for healing calculation.
  if (transport.containProfile?.moduleType === 'HEAL') {
    passenger.healContainEnteredFrame = self.frameCounter;
  }
  // Source parity: InternetHackContain::onContaining — auto-issue hackInternet to entering unit.
  // C++ file: InternetHackContain.cpp — rider->getAI()->aiHackInternet(CMD_FROM_AI).
  if (transport.containProfile?.moduleType === 'INTERNET_HACK') {
    self.commandQueue.push({ type: 'hackInternet', entityId: passenger.id });
  }
  // Source parity: Object::onContainedBy — set UNSELECTABLE and MASKED for enclosed containers.
  // Source parity: TransportContain::onContaining — set DISABLED_HELD on the rider (C++ Object/Contain/TransportContain.cpp).
  passenger.objectStatusFlags.add('UNSELECTABLE');
  passenger.objectStatusFlags.add('DISABLED_HELD');
  if (isEnclosingContainer(self, transport)) {
    passenger.objectStatusFlags.add('MASKED');
  }
  self.removeEntityFromSelection(passenger.id);
  self.pendingTransportActions.delete(passenger.id);
}

export function isEnclosingContainer(self: GL, container: MapEntity): boolean {
  const profile = container.containProfile;
  if (!profile) return false;
  return profile.moduleType === 'TRANSPORT'
    || profile.moduleType === 'OVERLORD'
    || profile.moduleType === 'HELIX'
    || profile.moduleType === 'TUNNEL'
    || profile.moduleType === 'CAVE'
    || profile.moduleType === 'HEAL'
    || profile.moduleType === 'INTERNET_HACK';
}

export function updateHealing(self: GL): void {
  const LOGICFRAMES_PER_SECOND = 30;
  const BASE_REGEN_INTERVAL = 3; // BaseRegenerateUpdate heals every 3 frames

  for (const entity of self.spawnedEntities.values()) {
    if (entity.destroyed) continue;

    // C++ parity: full-health check only skips self-heal and base-regen.
    // Radius and whole-player AutoHeal must still run to heal OTHER entities.
    const atFullHealth = entity.health >= entity.maxHealth && entity.health > 0;
    const hasRadiusOrPlayerHeal = entity.autoHealProfile
      && (entity.autoHealProfile.radius > 0 || entity.autoHealProfile.affectsWholePlayer);
    if (atFullHealth && !entity.propagandaTowerProfile && !hasRadiusOrPlayerHeal) continue;

    const isDisabled = entity.objectStatusFlags.has('DISABLED_EMP')
      || entity.objectStatusFlags.has('DISABLED_HACKED')
      || entity.objectStatusFlags.has('DISABLED_SUBDUED');

    // ── AutoHealBehavior ──
    if (entity.autoHealProfile && !isDisabled && !entity.autoHealSingleBurstDone) {
      const prof = entity.autoHealProfile;
      // Source parity: SingleBurst mode heals once then sleeps forever.
      if (prof.singleBurst && entity.autoHealSingleBurstDone) continue;
      if (prof.initiallyActive || entity.completedUpgrades.size > 0) {
        // Check damage delay.
        if (self.frameCounter >= entity.autoHealDamageDelayUntilFrame) {
          if (self.frameCounter >= entity.autoHealNextFrame) {
            if (prof.radius > 0) {
              // Radius heal mode — heal nearby allies.
              const radiusSq = prof.radius * prof.radius;
              for (const target of self.spawnedEntities.values()) {
                if (target.destroyed) continue;
                // Source parity: AutoHealBehavior.cpp:266 — skip self only when skipSelfForHealing is set.
                if (prof.skipSelfForHealing && target === entity) continue;
                if (target.health >= target.maxHealth) continue;
                if (self.getTeamRelationship(entity, target) === RELATIONSHIP_ENEMIES) continue;
                // Source parity: KindOf filter — only heal matching entity types.
                if (prof.kindOf && prof.kindOf.size > 0) {
                  let matchesKindOf = false;
                  for (const k of prof.kindOf) {
                    if (target.kindOf.has(k)) { matchesKindOf = true; break; }
                  }
                  if (!matchesKindOf) continue;
                }
                // Source parity: ForbiddenKindOf filter — exclude matching types.
                if (prof.forbiddenKindOf && prof.forbiddenKindOf.size > 0) {
                  let matchesForbidden = false;
                  for (const k of prof.forbiddenKindOf) {
                    if (target.kindOf.has(k)) { matchesForbidden = true; break; }
                  }
                  if (matchesForbidden) continue;
                }
                const dx = target.x - entity.x;
                const dz = target.z - entity.z;
                if (dx * dx + dz * dz <= radiusSq) {
                  self.attemptHealingFromSoleBenefactor(target, prof.healingAmount, entity.id, prof.healingDelayFrames);
                }
              }
              // Source parity: SingleBurst — mark done after one radius heal pass.
              if (prof.singleBurst) {
                entity.autoHealSingleBurstDone = true;
              }
            } else if (prof.affectsWholePlayer) {
              // Whole-player mode — heal all entities on same side.
              const side = self.normalizeSide(entity.side);
              for (const target of self.spawnedEntities.values()) {
                if (target.destroyed || target.health >= target.maxHealth) continue;
                if (self.normalizeSide(target.side) !== side) continue;
                const prevHealth = target.health;
                target.health = Math.min(target.maxHealth, target.health + prof.healingAmount);
                if (target.health > prevHealth) {
                  self.clearPoisonFromEntity(target);
                  if (target.minefieldProfile) {
                    self.mineOnDamage(target, entity.id, 'HEALING');
                  }
                }
              }
            } else if (entity.health < entity.maxHealth) {
              // Self-heal mode — only when entity is damaged.
              const prevHealth = entity.health;
              entity.health = Math.min(entity.maxHealth, entity.health + prof.healingAmount);
              if (entity.health > prevHealth) {
                self.clearPoisonFromEntity(entity);
                if (entity.minefieldProfile) {
                  self.mineOnDamage(entity, entity.id, 'HEALING');
                }
              }
            }
            entity.autoHealNextFrame = self.frameCounter + prof.healingDelayFrames;
          }
        }
      }
    }

    // ── BaseRegenerateUpdate (structure regen) ──
    if (entity.kindOf.has('STRUCTURE') && !isDisabled && entity.health < entity.maxHealth
        && !entity.objectStatusFlags.has('UNDER_CONSTRUCTION')
        && !entity.objectStatusFlags.has('SOLD')
        && BASE_REGEN_HEALTH_PERCENT_PER_SECOND > 0) {
      if (self.frameCounter >= entity.baseRegenDelayUntilFrame) {
        if (self.frameCounter % BASE_REGEN_INTERVAL === 0) {
          const prevHealth = entity.health;
          const amount = BASE_REGEN_INTERVAL * entity.maxHealth * BASE_REGEN_HEALTH_PERCENT_PER_SECOND / LOGICFRAMES_PER_SECOND;
          entity.health = Math.min(entity.maxHealth, entity.health + amount);
          if (entity.health > prevHealth) {
            self.clearPoisonFromEntity(entity);
          }
        }
      }
    }

    // ── PropagandaTowerBehavior (radius heal aura) ──
    if (entity.propagandaTowerProfile && !isDisabled
        && !entity.objectStatusFlags.has('UNDER_CONSTRUCTION')
        && !entity.objectStatusFlags.has('SOLD')) {
      const prof = entity.propagandaTowerProfile;
      const isUpgraded = prof.upgradeRequired !== null
        && entity.completedUpgrades.has(prof.upgradeRequired.toUpperCase());
      const healPct = isUpgraded ? prof.upgradedHealPercentPerSecond : prof.healPercentPerSecond;

      // Rescan for units in range periodically.
      if (self.frameCounter >= entity.propagandaTowerNextScanFrame) {
        entity.propagandaTowerTrackedIds = [];
        const radiusSq = prof.radius * prof.radius;
        for (const target of self.spawnedEntities.values()) {
          if (target.destroyed) continue;
          // ZH addition: PropagandaTowerBehavior.cpp:506 — skip self unless AffectsSelf is set.
          if (target === entity && !prof.affectsSelf) continue;
          if (target.kindOf.has('STRUCTURE') && target !== entity) continue; // Only troops (self can be structure)
          if (self.getTeamRelationship(entity, target) === RELATIONSHIP_ENEMIES) continue;
          const dx = target.x - entity.x;
          const dz = target.z - entity.z;
          if (dx * dx + dz * dz <= radiusSq) {
            entity.propagandaTowerTrackedIds.push(target.id);
          }
        }
        entity.propagandaTowerNextScanFrame = self.frameCounter + prof.scanDelayFrames;
      }

      // Heal tracked units each frame.
      for (const targetId of entity.propagandaTowerTrackedIds) {
        const target = self.spawnedEntities.get(targetId);
        if (!target || target.destroyed || target.health >= target.maxHealth) continue;
        const amount = healPct / LOGICFRAMES_PER_SECOND * target.maxHealth;
        self.attemptHealingFromSoleBenefactor(target, amount, entity.id, prof.scanDelayFrames);
      }
    }
  }
}

export function resolveTunnelTracker(self: GL, side: string | undefined): TunnelTrackerState | null {
  const normalized = self.normalizeSide(side);
  if (!normalized) return null;
  let tracker = self.tunnelTrackers.get(normalized);
  if (!tracker) {
    tracker = { tunnelIds: new Set(), passengerIds: new Set() };
    self.tunnelTrackers.set(normalized, tracker);
  }
  return tracker;
}

export function resolveCaveTracker(self: GL, caveIndex: number, createIfMissing = true): TunnelTrackerState | null {
  if (!Number.isFinite(caveIndex)) {
    return null;
  }
  const normalizedIndex = Math.trunc(caveIndex);
  if (normalizedIndex < 0) {
    return null;
  }

  let tracker = self.caveTrackers.get(normalizedIndex);
  if (!tracker && createIfMissing) {
    tracker = { tunnelIds: new Set(), passengerIds: new Set() };
    self.caveTrackers.set(normalizedIndex, tracker);
  }
  return tracker ?? null;
}

export function resolveTunnelTrackerForContainer(self: GL, container: MapEntity): TunnelTrackerState | null {
  const containProfile = container.containProfile;
  if (!containProfile) {
    return null;
  }
  if (containProfile.moduleType === 'TUNNEL') {
    return resolveTunnelTracker(self, container.side);
  }
  if (containProfile.moduleType === 'CAVE') {
    const caveIndex = self.caveTrackerIndexByEntityId.get(container.id) ?? containProfile.caveIndex ?? 0;
    return resolveCaveTracker(self, caveIndex);
  }
  return null;
}

export function enterTunnel(self: GL, passenger: MapEntity, tunnel: MapEntity): void {
  const tracker = resolveTunnelTrackerForContainer(self, tunnel);
  if (!tracker) return;

  // Source parity: TunnelTracker::isValidContainerFor — no aircraft.
  if (passenger.kindOf.has('AIRCRAFT')) return;

  // Check shared capacity.
  if (tracker.passengerIds.size >= self.config.maxTunnelCapacity) return;

  // Cannot enter if already contained.
  if (isEntityContained(self, passenger)) return;

  self.cancelEntityCommandPathActions(passenger.id);
  self.clearAttackTarget(passenger.id);

  passenger.tunnelContainerId = tunnel.id;
  noteContainerEnteredBy(self, tunnel, passenger);
  passenger.tunnelEnteredFrame = self.frameCounter;
  // Source parity (visual): start fade-out transition for tunnel enter visual.
  passenger.tunnelFadeStartFrame = self.frameCounter;
  passenger.x = tunnel.x;
  passenger.z = tunnel.z;
  passenger.y = tunnel.y;
  passenger.moving = false;

  // Source parity: Object::onContainedBy + TunnelContain::onContaining — DISABLED_HELD, MASKED, UNSELECTABLE.
  passenger.objectStatusFlags.add('DISABLED_HELD');
  passenger.objectStatusFlags.add('MASKED');
  passenger.objectStatusFlags.add('UNSELECTABLE');

  tracker.passengerIds.add(passenger.id);
  self.removeEntityFromSelection(passenger.id);
  self.pendingTunnelActions.delete(passenger.id);
}

export function exitTunnel(self: GL, passenger: MapEntity, exitTunnel: MapEntity): void {
  const tracker = resolveTunnelTrackerForContainer(self, exitTunnel);
  if (tracker) {
    tracker.passengerIds.delete(passenger.id);
  }

  passenger.tunnelContainerId = null;
  passenger.tunnelEnteredFrame = 0;
  // Source parity (visual): start fade-in transition for tunnel exit visual.
  passenger.tunnelFadeStartFrame = self.frameCounter;

  // Source parity: TunnelContain::onRemoving — clear DISABLED_HELD.
  passenger.objectStatusFlags.delete('DISABLED_HELD');
  passenger.objectStatusFlags.delete('MASKED');
  passenger.objectStatusFlags.delete('UNSELECTABLE');

  // Source parity: TunnelContain::scatterToNearbyPosition — scatter around the exit tunnel.
  const angle = self.gameRandom.nextFloat() * Math.PI * 2;
  const geom = exitTunnel.obstacleGeometry;
  const baseRadius = geom ? Math.max(geom.majorRadius, geom.minorRadius) : 10;
  const minRadius = baseRadius;
  const maxRadius = baseRadius * 1.5;
  const dist = minRadius + self.gameRandom.nextFloat() * (maxRadius - minRadius);
  const exitX = exitTunnel.x + Math.cos(angle) * dist;
  const exitZ = exitTunnel.z + Math.sin(angle) * dist;

  passenger.x = exitTunnel.x;
  passenger.z = exitTunnel.z;
  passenger.y = self.resolveGroundHeight(passenger.x, passenger.z) + passenger.baseHeight;
  passenger.rotationY = angle;
  self.updatePathfindPosCell(passenger);

  if (passenger.canMove) {
    self.issueMoveTo(passenger.id, exitX, exitZ);
  } else {
    // Source parity: scatterToNearbyPosition — non-AI units are placed directly.
    passenger.x = exitX;
    passenger.z = exitZ;
    passenger.y = self.resolveGroundHeight(exitX, exitZ) + passenger.baseHeight;
    self.updatePathfindPosCell(passenger);
  }
}

export function updateTunnelHealing(self: GL): void {
  for (const tunnel of self.spawnedEntities.values()) {
    if (tunnel.destroyed) continue;
    const profile = tunnel.containProfile;
    if (!profile || profile.moduleType !== 'TUNNEL') continue;

    const tracker = resolveTunnelTracker(self, tunnel.side);
    if (tracker.passengerIds.size === 0) continue;
    const healFrames = profile.timeForFullHealFrames;
    if (healFrames <= 0) continue;

    for (const passengerId of tracker.passengerIds) {
      const passenger = self.spawnedEntities.get(passengerId);
      if (!passenger || passenger.destroyed) continue;
      if (passenger.health >= passenger.maxHealth) continue;

      const framesInside = self.frameCounter - passenger.tunnelEnteredFrame;
      if (framesInside >= healFrames) {
        // Fully healed.
        passenger.health = passenger.maxHealth;
      } else {
        // Linear heal: maxHealth / framesForFullHeal per frame.
        const healPerFrame = passenger.maxHealth / healFrames;
        passenger.health = Math.min(passenger.maxHealth, passenger.health + healPerFrame);
      }
    }
  }
}

export function updateHealContainHealing(self: GL): void {
  // Find all heal containers and process their passengers.
  for (const container of self.spawnedEntities.values()) {
    if (container.destroyed) continue;
    const profile = container.containProfile;
    if (!profile || profile.moduleType !== 'HEAL') continue;
    const healFrames = profile.timeForFullHealFrames;
    if (healFrames <= 0) continue;

    // Collect passengers inside this heal container.
    const passengerIds: number[] = [];
    for (const entity of self.spawnedEntities.values()) {
      if (entity.transportContainerId === container.id && !entity.destroyed) {
        passengerIds.push(entity.id);
      }
    }

    const toEject: number[] = [];
    for (const passengerId of passengerIds) {
      const passenger = self.spawnedEntities.get(passengerId);
      if (!passenger || passenger.destroyed) continue;

      // Source parity: HealContain::doHeal — two-phase: if elapsed >= total, full heal; else linear.
      const framesInside = self.frameCounter - passenger.healContainEnteredFrame;
      if (passenger.health < passenger.maxHealth) {
        if (framesInside >= healFrames) {
          passenger.health = passenger.maxHealth;
        } else {
          const healPerFrame = passenger.maxHealth / healFrames;
          passenger.health = Math.min(passenger.maxHealth, passenger.health + healPerFrame);
        }
      }

      // Source parity: HealContain::update — auto-eject when fully healed.
      if (passenger.health >= passenger.maxHealth) {
        toEject.push(passengerId);
      }
    }

    // Eject healed passengers.
    for (const passengerId of toEject) {
      const passenger = self.spawnedEntities.get(passengerId);
      if (!passenger || passenger.destroyed) continue;
      releaseEntityFromContainer(self, passenger);
      const evacuation = resolveContainerEvacuationPositions(self, container, container.x, container.z);
      passenger.x = evacuation.spawnX;
      passenger.z = evacuation.spawnZ;
      passenger.y = self.resolveGroundHeight(passenger.x, passenger.z) + passenger.baseHeight;
      self.updatePathfindPosCell(passenger);
      if (passenger.canMove) {
        self.issueMoveTo(passenger.id, evacuation.targetX, evacuation.targetZ);
      }
    }
  }
}

export function updateTransportContainHealing(self: GL): void {
  for (const container of self.spawnedEntities.values()) {
    if (container.destroyed) continue;
    const profile = container.containProfile;
    if (!profile) continue;
    if (profile.healthRegenPercentPerSec <= 0) continue;
    // Source parity: only transport-derived containers have HealthRegen%PerSec.
    const isTransportDerived = profile.moduleType === 'TRANSPORT'
      || profile.moduleType === 'OVERLORD'
      || profile.moduleType === 'HELIX'
      || profile.moduleType === 'INTERNET_HACK';
    if (!isTransportDerived) continue;

    for (const entity of self.spawnedEntities.values()) {
      if (entity.destroyed) continue;
      if (entity.transportContainerId !== container.id) continue;
      if (entity.health >= entity.maxHealth) continue;

      // Source parity: regen = maxHealth * (healthRegen / 100) * SECONDS_PER_LOGICFRAME_REAL.
      // healthRegenPercentPerSec is already fraction (0-1), multiply by maxHealth / framesPerSecond.
      const healPerFrame = entity.maxHealth * profile.healthRegenPercentPerSec / LOGIC_FRAME_RATE;
      entity.health = Math.min(entity.maxHealth, entity.health + healPerFrame);
    }
  }
}

export function updateContainModelConditions(self: GL): void {
  for (const container of self.spawnedEntities.values()) {
    if (container.destroyed) continue;
    const profile = container.containProfile;
    if (!profile) continue;

    const isTransportStyle = profile.moduleType === 'TRANSPORT'
      || profile.moduleType === 'OVERLORD'
      || profile.moduleType === 'HELIX'
      || profile.moduleType === 'OPEN'
      || profile.moduleType === 'INTERNET_HACK';
    const isGarrison = profile.moduleType === 'GARRISON';
    if (!isTransportStyle && !isGarrison) continue;

    const passengerIds = collectContainedEntityIds(self, container.id);
    const hasPassengers = passengerIds.length > 0;

    // Source parity: TransportContain::onContaining / onRemoving — MODELCONDITION_LOADED.
    if (hasPassengers) {
      container.modelConditionFlags.add('LOADED');
    } else {
      container.modelConditionFlags.delete('LOADED');
    }

    // Source parity: GarrisonContain::onContaining — set MODELCONDITION_GARRISONED on the building
    // when first occupied, clear when empty. C++ file: GarrisonContain.cpp.
    if (isGarrison) {
      if (hasPassengers) {
        container.modelConditionFlags.add('GARRISONED');
      } else {
        container.modelConditionFlags.delete('GARRISONED');
      }
    }

    // Source parity: OverlordContain — set RIDER model conditions per sub-unit slot.
    if (profile.moduleType === 'OVERLORD' || profile.moduleType === 'HELIX') {
      // Clear all rider conditions first.
      for (let i = 1; i <= 4; i++) {
        container.modelConditionFlags.delete(`RIDER${i}`);
      }
      // Set rider conditions for each occupied slot.
      for (let i = 0; i < passengerIds.length && i < 4; i++) {
        container.modelConditionFlags.add(`RIDER${i + 1}`);
      }
    }
  }
}

export function updateOverlordRiderPositions(self: GL): void {
  for (const entity of self.spawnedEntities.values()) {
    if (entity.destroyed) continue;
    if (entity.transportContainerId === null) continue;

    const container = self.spawnedEntities.get(entity.transportContainerId);
    if (!container || container.destroyed) continue;

    const profile = container.containProfile;
    if (!profile) continue;

    // Source parity: riders inside enclosed containers track parent position.
    if (profile.moduleType === 'OVERLORD' || profile.moduleType === 'HELIX') {
      entity.x = container.x;
      entity.z = container.z;
      entity.y = container.y;
    }
  }
}

export function hasPendingTransportEntryForContainer(self: GL, containerId: number): boolean {
  for (const targetTransportId of self.pendingTransportActions.values()) {
    if (targetTransportId === containerId) {
      return true;
    }
  }
  return false;
}

export function isEntityContained(self: GL, entity: MapEntity): boolean {
  return entity.parkingSpaceProducerId !== null
    || entity.helixCarrierId !== null
    || entity.garrisonContainerId !== null
    || entity.transportContainerId !== null
    || entity.tunnelContainerId !== null;
}

export function isEntityContainedInGarrison(self: GL, entity: MapEntity): boolean {
  return entity.garrisonContainerId !== null;
}

export function collectContainedEntityIds(self: GL, containerId: number): number[] {
  const entityIds = new Set<number>();
  const container = self.spawnedEntities.get(containerId);
  if (container?.parkingPlaceProfile) {
    for (const entityId of container.parkingPlaceProfile.occupiedSpaceEntityIds.values()) {
      entityIds.add(entityId);
    }
  }

  for (const entity of self.spawnedEntities.values()) {
    if (entity.destroyed) {
      continue;
    }
    if (
      entity.parkingSpaceProducerId === containerId
      || entity.helixCarrierId === containerId
      || entity.garrisonContainerId === containerId
      || entity.transportContainerId === containerId
      || entity.tunnelContainerId === containerId
    ) {
      entityIds.add(entity.id);
    }
  }

  return Array.from(entityIds.values()).sort((left, right) => left - right);
}

export function countContainedRappellers(self: GL, containerId: number): number {
  let count = 0;
  for (const passengerId of collectContainedEntityIds(self, containerId)) {
    const passenger = self.spawnedEntities.get(passengerId);
    if (!passenger || passenger.destroyed) {
      continue;
    }
    if (self.resolveEntityKindOfSet(passenger).has('CAN_RAPPEL')) {
      count += 1;
    }
  }
  return count;
}

export function releaseEntityFromContainer(self: GL, entity: MapEntity): void {
  if (entity.parkingSpaceProducerId !== null) {
    const parkingProducer = self.spawnedEntities.get(entity.parkingSpaceProducerId);
    if (parkingProducer?.parkingPlaceProfile) {
      parkingProducer.parkingPlaceProfile.occupiedSpaceEntityIds.delete(entity.id);
    }
    entity.parkingSpaceProducerId = null;
  }

  if (entity.helixCarrierId !== null) {
    const helixCarrier = self.spawnedEntities.get(entity.helixCarrierId);
    if (helixCarrier?.helixPortableRiderId === entity.id) {
      helixCarrier.helixPortableRiderId = null;
    }
    entity.helixCarrierId = null;
  }

  if (entity.garrisonContainerId !== null) {
    entity.garrisonContainerId = null;
    entity.canMove = true;
    // Source parity: GarrisonContain::onRemoving — clear DISABLED_HELD (C++ GarrisonContain.cpp line 1672).
    entity.objectStatusFlags.delete('DISABLED_HELD');
  }

  if (entity.transportContainerId !== null) {
    entity.transportContainerId = null;
    entity.healContainEnteredFrame = 0;
    // Source parity: TransportContain::onRemoving — clear DISABLED_HELD on release.
    entity.objectStatusFlags.delete('DISABLED_HELD');
  }

  if (entity.tunnelContainerId !== null) {
    // Remove from the shared tunnel/cave tracker passenger list.
    const tunnel = self.spawnedEntities.get(entity.tunnelContainerId);
    if (tunnel) {
      const tracker = resolveTunnelTrackerForContainer(self, tunnel);
      if (tracker) {
        tracker.passengerIds.delete(entity.id);
      }
    }
    entity.tunnelContainerId = null;
    entity.tunnelEnteredFrame = 0;
    // Visual: start fade-in transition for tunnel exit.
    entity.tunnelFadeStartFrame = self.frameCounter;
    entity.objectStatusFlags.delete('DISABLED_HELD');
  }

  // Source parity: Object::onRemovedFrom — clear MASKED and UNSELECTABLE on release.
  entity.objectStatusFlags.delete('MASKED');
  entity.objectStatusFlags.delete('UNSELECTABLE');
}

export function evacuateOneContainedRappeller(self: GL, 
  container: MapEntity,
  targetX: number,
  targetZ: number,
  targetObjectId: number | null,
): boolean {
  const isChinookCombatDrop = container.chinookAIProfile !== null
    && self.pendingCombatDropActions.has(container.id);
  for (const passengerId of collectContainedEntityIds(self, container.id)) {
    const passenger = self.spawnedEntities.get(passengerId);
    if (!passenger || passenger.destroyed) continue;
    if (!self.resolveEntityKindOfSet(passenger).has('CAN_RAPPEL')) continue;

    releaseEntityFromContainer(self, passenger);
    passenger.x = container.x;
    passenger.z = container.z;
    passenger.y = Math.max(container.y, self.resolveGroundHeight(passenger.x, passenger.z) + passenger.baseHeight);
    self.updatePathfindPosCell(passenger);

    if (isChinookCombatDrop && container.chinookAIProfile) {
      passenger.objectStatusFlags.add('DISABLED_HELD');
      self.pendingChinookRappels.set(passenger.id, {
        sourceEntityId: container.id,
        targetObjectId,
        targetX,
        targetZ,
        descentSpeedPerFrame: self.resolveChinookRappelSpeedPerFrame(container.chinookAIProfile),
      });
    } else {
      self.issueDroppedPassengerCommand(passenger, targetX, targetZ, targetObjectId);
    }
    return true;
  }
  return false;
}

/**
 * Source parity (ZH): OpenContain::orderAllPassengersToExit(commandSource, instantly).
 * ZH added a second bool parameter. When instantly=true, uses aiExitInstantly
 * (immediate exit without animation delays). When false, uses normal exit.
 * C++ OpenContain.cpp:1377-1398.
 */
export function evacuateContainedEntities(self: GL,
  container: MapEntity,
  targetX: number,
  targetZ: number,
  targetObjectId: number | null,
  instantly = false,
): void {
  const passengerIds = collectContainedEntityIds(self, container.id);
  if (passengerIds.length === 0) {
    return;
  }

  for (const passengerId of passengerIds) {
    const passenger = self.spawnedEntities.get(passengerId);
    if (!passenger || passenger.destroyed) {
      continue;
    }

    if (instantly) {
      // Source parity (ZH): rider->getAI()->aiExitInstantly(getObject(), commandSource)
      handleExitContainerInstantlyCommand(self, passengerId);
    } else {
      releaseEntityFromContainer(self, passenger);
      const evacuation = resolveContainerEvacuationPositions(self, container, targetX, targetZ);
      passenger.x = evacuation.spawnX;
      passenger.z = evacuation.spawnZ;
      passenger.y = self.resolveGroundHeight(passenger.x, passenger.z) + passenger.baseHeight;
      self.updatePathfindPosCell(passenger);

      self.issueDroppedPassengerCommand(
        passenger,
        evacuation.targetX,
        evacuation.targetZ,
        targetObjectId,
      );
    }
  }
}

export function resolveProjectileLauncherContainer(self: GL, projectileLauncher: MapEntity): MapEntity | null {
  // Source parity: Object::getContainedBy() — single containment pointer.
  // In our model containment is split across multiple ID fields; delegate to the
  // unified resolver.
  return resolveEntityContainingObject(self, projectileLauncher);
}

export function resolveEntityContainingObject(self: GL, entity: MapEntity): MapEntity | null {
  // Source parity: Object::getContainedBy() — single m_containedBy pointer.
  // In our model, containment is tracked across multiple ID fields for different
  // container types. At most one will be non-null at any time (mutual exclusion).
  const containerId = entity.parkingSpaceProducerId
    ?? entity.helixCarrierId
    ?? entity.garrisonContainerId
    ?? entity.transportContainerId
    ?? entity.tunnelContainerId;

  if (containerId === null) {
    return null;
  }

  const container = self.spawnedEntities.get(containerId);
  if (!container || container.destroyed) {
    return null;
  }

  return container;
}

export function isPassengerAllowedToFireFromContainingObject(self: GL, 
  entity: MapEntity,
  container: MapEntity,
): boolean {
  // Source parity:
  // - Object::isAbleToAttack() first gates attacks when container->isPassengerAllowedToFire() is false.
  //   (Generals/Code/GameEngine/Source/GameLogic/Object/Object.cpp:2865)
  // - WeaponSet::getAbleToUseWeaponAgainstTarget() checks container riders when allowed.
  //   (Generals/Code/GameEngine/Source/GameLogic/Object/WeaponSet.cpp:711)
  // - OpenContain recursively delegates to a parent container; OverlordContain redirect chains
  //   similarly in the engine.
  //   (OpenContain.cpp:1035, OverlordContain.cpp:99)
  return isPassengerAllowedToFireFromContainingObjectImpl(
    entity,
    container,
    (targetEntity) => self.resolveEntityKindOfSet(targetEntity),
    (targetEntity) => resolveEntityContainingObject(self, targetEntity),
    (targetEntity, statusName) => self.entityHasObjectStatus(targetEntity, statusName),
  );
}

/**
 * Source parity: TransportContain::killRidersWhoAreNotFreeToExit() — called during onDie,
 * before removeAllContained(). Checks each rider: if isSpecificRiderFreeToExit() returns false,
 * the rider is killed. If m_destroyRidersWhoAreNotFreeToExit is true, uses destroyObject()
 * (instant removal); otherwise uses kill() (normal death process).
 * C++ file: TransportContain.cpp lines 536-556.
 *
 * Pragmatic implementation: passengers without locomotors (canMove=false) can't exit.
 */
export function killRidersWhoAreNotFreeToExit(self: GL, container: MapEntity): void {
  const profile = container.containProfile;
  if (!profile) return;

  // Source parity: OverlordContain/HelixContain override onDie to place riders at death
  // position — riders are always "free to exit" from these containers.
  if (profile.moduleType === 'OVERLORD' || profile.moduleType === 'HELIX') return;

  const passengerIds = collectContainedEntityIds(self, container.id);
  for (const passengerId of passengerIds) {
    const passenger = self.spawnedEntities.get(passengerId);
    if (!passenger || passenger.destroyed) continue;
    // Pragmatic: passengers without locomotors can't exit — kill them.
    if (!passenger.canMove) {
      self.markEntityDestroyed(passengerId, container.id);
    }
  }
}

export function processDamageToContained(self: GL, container: MapEntity): void {
  const profile = container.containProfile;
  if (!profile || profile.damagePercentToUnits <= 0) return;
  const percentDamage = profile.damagePercentToUnits;
  const deathType = profile.burnedDeathToUnits ? 'BURNED' : undefined;
  const passengerIds = collectContainedEntityIds(self, container.id);
  for (const passengerId of passengerIds) {
    const passenger = self.spawnedEntities.get(passengerId);
    if (!passenger || passenger.destroyed) continue;
    const damage = passenger.maxHealth * percentDamage;
    self.applyWeaponDamageAmount(container.id, passenger, damage, 'UNRESISTABLE', deathType);
    // Source parity: if percentDamage == 1.0 and unit survived (fireproof), force kill (C++ line 1470-1471).
    if (percentDamage >= 1.0 && !passenger.destroyed && passenger.health > 0) {
      self.applyWeaponDamageAmount(container.id, passenger, passenger.health, 'UNRESISTABLE', deathType);
    }
  }
}
