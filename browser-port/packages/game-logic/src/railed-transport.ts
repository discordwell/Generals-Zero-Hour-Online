import type { IniBlock } from '@generals/core';
import type { ObjectDef } from '@generals/ini-data';

import { readNumericField, readStringField } from './ini-readers.js';

export const INVALID_RAILED_TRANSPORT_PATH = -1;
const MAX_WAYPOINT_PATHS = 32;
const ARRIVAL_DISTANCE = 5.0;

export interface RailedTransportWaypointNode {
  id: number;
  name: string;
  x: number;
  z: number;
  biDirectional: boolean;
}

export interface RailedTransportWaypointLink {
  waypoint1: number;
  waypoint2: number;
}

export interface RailedTransportWaypointData {
  nodes: readonly RailedTransportWaypointNode[];
  links: readonly RailedTransportWaypointLink[];
}

export interface RailedTransportWaypointIndex {
  byId: Map<number, RailedTransportWaypointNode>;
  byName: Map<string, RailedTransportWaypointNode>;
  outgoingById: Map<number, number[]>;
}

export interface RailedTransportPathInfo {
  startWaypointID: number;
  endWaypointID: number;
}

export interface RailedTransportDockRuntimeState {
  dockingObjectId: number;
  pullInsideDistancePerFrame: number;
  unloadingObjectId: number;
  pushOutsideDistancePerFrame: number;
  unloadCount: number;
}

export interface RailedTransportRuntimeState {
  inTransit: boolean;
  waypointDataLoaded: boolean;
  paths: RailedTransportPathInfo[];
  currentPath: number;
  transitWaypointIds: number[];
  transitWaypointIndex: number;
  dockState: RailedTransportDockRuntimeState | null;
}

export interface RailedTransportProfile {
  pathPrefixName: string;
  /** Source parity: RailedTransportDockUpdateModuleData::m_pullInsideDuration (frames). */
  pullInsideDurationFrames: number;
  /** Source parity: RailedTransportDockUpdateModuleData::m_pushOutsideDuration (frames). */
  pushOutsideDurationFrames: number;
  /** Source parity: RailedTransportDockUpdateModuleData::m_toleranceDistance — distance
   *  threshold for considering a railed transport at its target waypoint. Default: 50.0. ZH-only field. */
  toleranceDistance: number;
}

export interface RailedTransportEntityLike {
  id: number;
  x: number;
  z: number;
  moving: boolean;
}

interface RailedTransportSharedContext {
  waypointIndex: RailedTransportWaypointIndex;
  resolveRuntimeState(entityId: number): RailedTransportRuntimeState;
  issueMoveTo(entityId: number, targetX: number, targetZ: number): void;
}

export interface RailedTransportCommandContext<TEntity extends RailedTransportEntityLike>
  extends RailedTransportSharedContext {
  cancelEntityCommandPathActions(entityId: number): void;
  clearAttackTarget(entityId: number): void;
  stopEntity(entityId: number): void;
  isValidEntity(_entity: TEntity): boolean;
}

export interface RailedTransportUpdateContext<TEntity extends RailedTransportEntityLike>
  extends RailedTransportSharedContext {
  isValidEntity(entity: TEntity): boolean;
}

export function createRailedTransportWaypointIndex(
  waypointData: RailedTransportWaypointData | null | undefined,
): RailedTransportWaypointIndex {
  const byId = new Map<number, RailedTransportWaypointNode>();
  const byName = new Map<string, RailedTransportWaypointNode>();
  const outgoingById = new Map<number, number[]>();
  if (!waypointData) {
    return { byId, byName, outgoingById };
  }

  for (const node of waypointData.nodes) {
    const id = Math.trunc(node.id);
    if (!Number.isFinite(id) || id <= 0) {
      continue;
    }
    const name = node.name.trim();
    if (!name) {
      continue;
    }
    if (!Number.isFinite(node.x) || !Number.isFinite(node.z)) {
      continue;
    }
    const normalizedNode: RailedTransportWaypointNode = {
      id,
      name,
      x: node.x,
      z: node.z,
      biDirectional: node.biDirectional,
    };
    byId.set(id, normalizedNode);
    byName.set(name, normalizedNode);
  }

  for (const link of waypointData.links) {
    const waypoint1 = Math.trunc(link.waypoint1);
    const waypoint2 = Math.trunc(link.waypoint2);
    if (!byId.has(waypoint1) || !byId.has(waypoint2) || waypoint1 === waypoint2) {
      continue;
    }

    addDirectedWaypointEdge(outgoingById, waypoint1, waypoint2);
    if (byId.get(waypoint1)?.biDirectional) {
      addDirectedWaypointEdge(outgoingById, waypoint2, waypoint1);
    }
  }

  return { byId, byName, outgoingById };
}

export function createRailedTransportRuntimeState(): RailedTransportRuntimeState {
  return {
    inTransit: false,
    waypointDataLoaded: false,
    paths: [],
    currentPath: INVALID_RAILED_TRANSPORT_PATH,
    transitWaypointIds: [],
    transitWaypointIndex: 0,
    dockState: null,
  };
}

// Source parity: parseDurationUnsignedInt — ms * LOGICFRAMES_PER_SECOND / 1000
const LOGIC_FRAME_RATE = 30;
const LOGIC_FRAME_MS = 1000 / LOGIC_FRAME_RATE;

function msToLogicFramesLocal(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) {
    return 0;
  }
  return Math.max(1, Math.ceil(ms / LOGIC_FRAME_MS));
}

export function extractRailedTransportProfile(objectDef: ObjectDef | undefined): RailedTransportProfile | null {
  if (!objectDef) {
    return null;
  }

  let pathPrefixName: string | null = null;
  let pullInsideDurationFrames = 0;
  let pushOutsideDurationFrames = 0;
  let toleranceDistance = 50.0;

  const visitBlock = (block: IniBlock): void => {
    if (block.type.toUpperCase() === 'BEHAVIOR') {
      const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
      if (moduleType === 'RAILEDTRANSPORTAIUPDATE') {
        pathPrefixName = readStringField(block.fields, ['PathPrefixName']) ?? '';
      } else if (moduleType === 'RAILEDTRANSPORTDOCKUPDATE') {
        const pullMs = readNumericField(block.fields, ['PullInsideDuration']) ?? 0;
        const pushMs = readNumericField(block.fields, ['PushOutsideDuration']) ?? 0;
        pullInsideDurationFrames = msToLogicFramesLocal(pullMs);
        pushOutsideDurationFrames = msToLogicFramesLocal(pushMs);
        // Source parity: ZH-only field — RailedTransportDockUpdate.cpp:55,69 (default 50.0).
        toleranceDistance = readNumericField(block.fields, ['ToleranceDistance']) ?? 50.0;
      }
    }
    for (const child of block.blocks) {
      visitBlock(child);
    }
  };

  for (const block of objectDef.blocks) {
    visitBlock(block);
  }

  if (pathPrefixName === null) {
    return null;
  }

  return {
    pathPrefixName,
    pullInsideDurationFrames,
    pushOutsideDurationFrames,
    toleranceDistance,
  };
}

export function executeRailedTransportCommand<TEntity extends RailedTransportEntityLike>(
  entity: TEntity,
  profile: RailedTransportProfile,
  context: RailedTransportCommandContext<TEntity>,
): void {
  if (!context.isValidEntity(entity)) {
    return;
  }

  const state = context.resolveRuntimeState(entity.id);
  loadWaypointPathsIfNeeded(state, profile.pathPrefixName, context.waypointIndex.byName);
  if (state.paths.length === 0) {
    return;
  }

  context.cancelEntityCommandPathActions(entity.id);
  context.clearAttackTarget(entity.id);
  context.stopEntity(entity.id);

  state.currentPath += 1;
  if (state.currentPath >= state.paths.length) {
    state.currentPath = 0;
  }

  const path = state.paths[state.currentPath];
  if (!path) {
    return;
  }
  const startWaypoint = context.waypointIndex.byId.get(path.startWaypointID);
  const endWaypoint = context.waypointIndex.byId.get(path.endWaypointID);
  if (!startWaypoint || !endWaypoint) {
    clearTransitState(state);
    return;
  }

  state.transitWaypointIds = resolveDirectedWaypointRoute(
    startWaypoint.id,
    endWaypoint.id,
    context.waypointIndex.outgoingById,
  );
  if (state.transitWaypointIds.length === 0) {
    clearTransitState(state);
    return;
  }

  state.transitWaypointIndex = 0;
  const firstWaypointId = state.transitWaypointIds[state.transitWaypointIndex];
  const firstWaypoint = firstWaypointId !== undefined
    ? context.waypointIndex.byId.get(firstWaypointId)
    : null;
  if (!firstWaypoint) {
    clearTransitState(state);
    return;
  }

  context.issueMoveTo(entity.id, firstWaypoint.x, firstWaypoint.z);
  state.inTransit = true;
}

export function updateRailedTransportEntity<TEntity extends RailedTransportEntityLike>(
  entity: TEntity,
  profile: RailedTransportProfile,
  context: RailedTransportUpdateContext<TEntity>,
): void {
  if (!context.isValidEntity(entity)) {
    return;
  }

  const state = context.resolveRuntimeState(entity.id);
  loadWaypointPathsIfNeeded(state, profile.pathPrefixName, context.waypointIndex.byName);

  if (state.currentPath === INVALID_RAILED_TRANSPORT_PATH && state.paths.length > 0) {
    pickAndMoveToInitialLocation(entity, state, context);
  }

  if (!state.inTransit) {
    return;
  }

  const targetWaypoint = resolveTransitTargetWaypoint(state, context.waypointIndex.byId);
  if (!targetWaypoint) {
    clearTransitState(state);
    return;
  }

  const distance = Math.hypot(targetWaypoint.x - entity.x, targetWaypoint.z - entity.z);
  if (distance > ARRIVAL_DISTANCE && entity.moving) {
    return;
  }

  if (state.transitWaypointIndex + 1 < state.transitWaypointIds.length) {
    state.transitWaypointIndex += 1;
    const nextWaypointId = state.transitWaypointIds[state.transitWaypointIndex];
    const nextWaypoint = nextWaypointId !== undefined
      ? context.waypointIndex.byId.get(nextWaypointId)
      : null;
    if (!nextWaypoint) {
      clearTransitState(state);
      return;
    }
    context.issueMoveTo(entity.id, nextWaypoint.x, nextWaypoint.z);
    return;
  }

  clearTransitState(state);
}

function addDirectedWaypointEdge(outgoingById: Map<number, number[]>, fromId: number, toId: number): void {
  const outgoing = outgoingById.get(fromId) ?? [];
  if (!outgoing.includes(toId)) {
    outgoing.push(toId);
    outgoingById.set(fromId, outgoing);
  }
}

function loadWaypointPathsIfNeeded(
  state: RailedTransportRuntimeState,
  pathPrefixName: string,
  waypointByName: Map<string, RailedTransportWaypointNode>,
): void {
  if (state.waypointDataLoaded) {
    return;
  }

  state.paths.length = 0;
  const prefix = pathPrefixName.trim();
  if (prefix.length > 0) {
    for (let i = 0; i < MAX_WAYPOINT_PATHS; i++) {
      const pathSuffix = String(i + 1).padStart(2, '0');
      const start = waypointByName.get(`${prefix}Start${pathSuffix}`);
      const end = waypointByName.get(`${prefix}End${pathSuffix}`);
      if (start && end) {
        state.paths.push({
          startWaypointID: start.id,
          endWaypointID: end.id,
        });
      }
    }
  }

  if (state.currentPath < 0 || state.currentPath >= state.paths.length) {
    state.currentPath = INVALID_RAILED_TRANSPORT_PATH;
  }
  if (state.paths.length === 0) {
    clearTransitState(state);
  }
  state.waypointDataLoaded = true;
}

function pickAndMoveToInitialLocation<TEntity extends RailedTransportEntityLike>(
  entity: TEntity,
  state: RailedTransportRuntimeState,
  context: RailedTransportUpdateContext<TEntity>,
): void {
  let closestPath = INVALID_RAILED_TRANSPORT_PATH;
  let closestDistance = Number.POSITIVE_INFINITY;
  let closestWaypoint: RailedTransportWaypointNode | null = null;
  for (let i = 0; i < state.paths.length; i++) {
    const path = state.paths[i];
    if (!path) {
      continue;
    }
    const waypoint = context.waypointIndex.byId.get(path.endWaypointID);
    if (!waypoint) {
      continue;
    }

    const distance = Math.hypot(waypoint.x - entity.x, waypoint.z - entity.z);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestPath = i;
      closestWaypoint = waypoint;
    }
  }

  if (closestPath === INVALID_RAILED_TRANSPORT_PATH || !closestWaypoint) {
    return;
  }

  state.currentPath = closestPath;
  state.transitWaypointIds = [closestWaypoint.id];
  state.transitWaypointIndex = 0;
  state.inTransit = true;
  context.issueMoveTo(entity.id, closestWaypoint.x, closestWaypoint.z);
}

function resolveTransitTargetWaypoint(
  state: RailedTransportRuntimeState,
  waypointById: Map<number, RailedTransportWaypointNode>,
): RailedTransportWaypointNode | null {
  const transitWaypointId = state.transitWaypointIds[state.transitWaypointIndex];
  if (transitWaypointId !== undefined) {
    const transitWaypoint = waypointById.get(transitWaypointId);
    if (transitWaypoint) {
      return transitWaypoint;
    }
  }

  const path = state.paths[state.currentPath];
  if (!path) {
    return null;
  }
  return waypointById.get(path.endWaypointID) ?? null;
}

function clearTransitState(state: RailedTransportRuntimeState): void {
  state.inTransit = false;
  state.transitWaypointIds = [];
  state.transitWaypointIndex = 0;
}

function resolveDirectedWaypointRoute(
  startWaypointID: number,
  endWaypointID: number,
  outgoingById: Map<number, number[]>,
): number[] {
  if (startWaypointID === endWaypointID) {
    return [startWaypointID];
  }

  const visited = new Set<number>([startWaypointID]);
  const previous = new Map<number, number>();
  const queue: number[] = [startWaypointID];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) {
      break;
    }
    const outgoing = outgoingById.get(current);
    if (!outgoing) {
      continue;
    }

    for (const nextWaypointID of outgoing) {
      if (visited.has(nextWaypointID)) {
        continue;
      }

      visited.add(nextWaypointID);
      previous.set(nextWaypointID, current);
      if (nextWaypointID === endWaypointID) {
        return buildWaypointRoute(startWaypointID, endWaypointID, previous);
      }
      queue.push(nextWaypointID);
    }
  }

  return [startWaypointID, endWaypointID];
}

function buildWaypointRoute(
  startWaypointID: number,
  endWaypointID: number,
  previous: Map<number, number>,
): number[] {
  const route = [endWaypointID];
  let cursor = endWaypointID;
  while (cursor !== startWaypointID) {
    const prior = previous.get(cursor);
    if (prior === undefined) {
      return [startWaypointID, endWaypointID];
    }
    route.push(prior);
    cursor = prior;
  }
  route.reverse();
  return route;
}
