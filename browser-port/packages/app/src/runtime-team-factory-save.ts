import {
  XferLoad,
  XferMode,
  XferSave,
  type Snapshot,
  type Xfer,
} from '@generals/engine';
import type {
  GameLogicCoreSaveState,
  GameLogicPlayersSaveState,
  GameLogicSidesListSaveState,
  GameLogicTeamFactorySaveState,
  ScriptTeamRecord,
} from '@generals/game-logic';

const SOURCE_TEAM_FACTORY_SNAPSHOT_VERSION = 1;
const SOURCE_TEAM_PROTOTYPE_SNAPSHOT_VERSION = 2;
const SOURCE_TEAM_TEMPLATE_INFO_SNAPSHOT_VERSION = 1;
const SOURCE_TEAM_SNAPSHOT_VERSION = 1;
const SOURCE_TEAM_RELATION_SNAPSHOT_VERSION = 1;
const SOURCE_PLAYER_RELATION_SNAPSHOT_VERSION = 1;
const GENERIC_SCRIPT_SLOT_COUNT = 16;

function getTeamMap(state: GameLogicTeamFactorySaveState): Map<string, ScriptTeamRecord> {
  const value = state.state.scriptTeamsByName;
  if (value instanceof Map) {
    return value as Map<string, ScriptTeamRecord>;
  }
  const created = new Map<string, ScriptTeamRecord>();
  state.state.scriptTeamsByName = created;
  return created;
}

function getInstanceMap(state: GameLogicTeamFactorySaveState): Map<string, string[]> {
  const value = state.state.scriptTeamInstanceNamesByPrototypeName;
  if (value instanceof Map) {
    return value as Map<string, string[]>;
  }
  const created = new Map<string, string[]>();
  state.state.scriptTeamInstanceNamesByPrototypeName = created;
  return created;
}

function toArrayBuffer(data: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (data instanceof ArrayBuffer) {
    return data.slice(0);
  }
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy.buffer;
}

function getPlayerSideByIndex(
  playerState: GameLogicPlayersSaveState | null | undefined,
): Map<number, string> | null {
  const value = playerState?.state.playerSideByIndex;
  return value instanceof Map ? (value as Map<number, string>) : null;
}

function getPlayerSideByName(
  sidesListState: GameLogicSidesListSaveState | null | undefined,
): Map<string, string> | null {
  const value = sidesListState?.state.scriptPlayerSideByName;
  return value instanceof Map ? (value as Map<string, string>) : null;
}

function normalizePositiveInt(value: unknown, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  const normalized = Math.trunc(value as number);
  return normalized > 0 ? normalized : fallback;
}

function isPrototypePlaceholderTeamRecord(team: ScriptTeamRecord): boolean {
  return team.nameUpper === team.prototypeNameUpper
    && !team.created
    && team.memberEntityIds.size === 0;
}

function createPrototypePlaceholder(prototypeNameUpper: string): ScriptTeamRecord {
  return {
    nameUpper: prototypeNameUpper,
    prototypeNameUpper,
    sourcePrototypeId: undefined,
    sourceTeamId: null,
    memberEntityIds: new Set<number>(),
    created: false,
    stateName: '',
    attackPrioritySetName: '',
    recruitableOverride: null,
    isAIRecruitable: false,
    homeWaypointName: '',
    controllingSide: null,
    controllingPlayerToken: null,
    isSingleton: true,
    maxInstances: 0,
    productionPriority: 0,
    productionPrioritySuccessIncrease: 0,
    productionPriorityFailureDecrease: 0,
    reinforcementUnitEntries: [],
    reinforcementTransportTemplateName: '',
    reinforcementStartWaypointName: '',
    reinforcementTeamStartsFull: false,
    reinforcementTransportsExit: false,
  };
}

function cloneInstanceFromPrototype(
  teamMap: Map<string, ScriptTeamRecord>,
  prototype: ScriptTeamRecord,
): ScriptTeamRecord {
  let suffix = 1;
  let instanceNameUpper = `${prototype.nameUpper}#${suffix}`;
  while (teamMap.has(instanceNameUpper)) {
    suffix += 1;
    instanceNameUpper = `${prototype.nameUpper}#${suffix}`;
  }

  const instance: ScriptTeamRecord = {
    nameUpper: instanceNameUpper,
    prototypeNameUpper: prototype.nameUpper,
    sourcePrototypeId: prototype.sourcePrototypeId,
    sourceTeamId: null,
    memberEntityIds: new Set<number>(),
    created: false,
    stateName: '',
    attackPrioritySetName: '',
    recruitableOverride: prototype.recruitableOverride,
    isAIRecruitable: prototype.isAIRecruitable,
    homeWaypointName: prototype.homeWaypointName,
    controllingSide: prototype.controllingSide,
    controllingPlayerToken: prototype.controllingPlayerToken,
    isSingleton: false,
    maxInstances: prototype.maxInstances,
    productionPriority: prototype.productionPriority,
    productionPrioritySuccessIncrease: prototype.productionPrioritySuccessIncrease,
    productionPriorityFailureDecrease: prototype.productionPriorityFailureDecrease,
    reinforcementUnitEntries: prototype.reinforcementUnitEntries.map((entry) => ({ ...entry })),
    reinforcementTransportTemplateName: prototype.reinforcementTransportTemplateName,
    reinforcementStartWaypointName: prototype.reinforcementStartWaypointName,
    reinforcementTeamStartsFull: prototype.reinforcementTeamStartsFull,
    reinforcementTransportsExit: prototype.reinforcementTransportsExit,
  };
  teamMap.set(instanceNameUpper, instance);
  return instance;
}

function clearMaterializedTeamRuntime(team: ScriptTeamRecord): void {
  team.sourceTeamId = null;
  team.memberEntityIds = new Set<number>();
  team.created = false;
  team.stateName = '';
  team.recruitableOverride = null;
}

function getPrototypeOrder(state: GameLogicTeamFactorySaveState): string[] {
  const teamMap = getTeamMap(state);
  const instanceMap = getInstanceMap(state);
  const seen = new Set<string>();
  const ordered: string[] = [];

  for (const prototypeNameUpper of instanceMap.keys()) {
    if (!seen.has(prototypeNameUpper)) {
      seen.add(prototypeNameUpper);
      ordered.push(prototypeNameUpper);
    }
  }
  for (const team of teamMap.values()) {
    if (!seen.has(team.prototypeNameUpper)) {
      seen.add(team.prototypeNameUpper);
      ordered.push(team.prototypeNameUpper);
    }
  }
  return ordered;
}

function getActualTeamInstancesForPrototype(
  state: GameLogicTeamFactorySaveState,
  prototypeNameUpper: string,
): ScriptTeamRecord[] {
  const teamMap = getTeamMap(state);
  const instanceNames = getInstanceMap(state).get(prototypeNameUpper) ?? [];
  const teams: ScriptTeamRecord[] = [];
  for (const instanceName of instanceNames) {
    const team = teamMap.get(instanceName);
    if (!team || isPrototypePlaceholderTeamRecord(team)) {
      continue;
    }
    teams.push(team);
  }
  return teams;
}

function resolveTeamOwnerIndex(
  team: ScriptTeamRecord,
  playerState: GameLogicPlayersSaveState | null | undefined,
  sidesListState: GameLogicSidesListSaveState | null | undefined,
): number {
  const playerSideByIndex = getPlayerSideByIndex(playerState);
  if (!playerSideByIndex || playerSideByIndex.size === 0) {
    return 0;
  }

  const controllingToken = team.controllingPlayerToken?.trim().toUpperCase() ?? '';
  const controllingSide = team.controllingSide?.trim().toUpperCase() ?? '';
  const playerSideByName = getPlayerSideByName(sidesListState);
  const resolvedSide = (controllingToken && playerSideByName?.get(controllingToken))
    ?? controllingSide
    ?? '';

  for (const [playerIndex, side] of playerSideByIndex) {
    if (side.trim().toUpperCase() === resolvedSide) {
      return playerIndex;
    }
  }

  const first = [...playerSideByIndex.keys()][0];
  return first ?? 0;
}

function applyOwnerIndexToTeam(
  team: ScriptTeamRecord,
  ownerIndex: number,
  playerState: GameLogicPlayersSaveState | null | undefined,
): void {
  const playerSideByIndex = getPlayerSideByIndex(playerState);
  const resolvedSide = playerSideByIndex?.get(ownerIndex) ?? null;
  if (!resolvedSide) {
    return;
  }
  team.controllingSide = resolvedSide;
  if (!team.controllingPlayerToken) {
    team.controllingPlayerToken = resolvedSide;
  }
}

class SourceEmptyTeamRelationSnapshot implements Snapshot {
  crc(_xfer: Xfer): void {}

  xfer(xfer: Xfer): void {
    const version = xfer.xferVersion(SOURCE_TEAM_RELATION_SNAPSHOT_VERSION);
    if (version !== SOURCE_TEAM_RELATION_SNAPSHOT_VERSION) {
      throw new Error(`Unsupported team relation snapshot version ${version}`);
    }
    xfer.xferUnsignedShort(0);
  }

  loadPostProcess(): void {}
}

class SourceEmptyPlayerRelationSnapshot implements Snapshot {
  crc(_xfer: Xfer): void {}

  xfer(xfer: Xfer): void {
    const version = xfer.xferVersion(SOURCE_PLAYER_RELATION_SNAPSHOT_VERSION);
    if (version !== SOURCE_PLAYER_RELATION_SNAPSHOT_VERSION) {
      throw new Error(`Unsupported player relation snapshot version ${version}`);
    }
    xfer.xferUnsignedShort(0);
  }

  loadPostProcess(): void {}
}

class SourceTeamTemplateInfoSnapshot implements Snapshot {
  constructor(private readonly team: ScriptTeamRecord) {}

  crc(_xfer: Xfer): void {}

  xfer(xfer: Xfer): void {
    const version = xfer.xferVersion(SOURCE_TEAM_TEMPLATE_INFO_SNAPSHOT_VERSION);
    if (version !== SOURCE_TEAM_TEMPLATE_INFO_SNAPSHOT_VERSION) {
      throw new Error(`Unsupported team template-info snapshot version ${version}`);
    }
    this.team.productionPriority = xfer.xferInt(this.team.productionPriority);
  }

  loadPostProcess(): void {}
}

class SourceTeamSnapshot implements Snapshot {
  constructor(private readonly team: ScriptTeamRecord) {}

  crc(_xfer: Xfer): void {}

  xfer(xfer: Xfer): void {
    const version = xfer.xferVersion(SOURCE_TEAM_SNAPSHOT_VERSION);
    if (version !== SOURCE_TEAM_SNAPSHOT_VERSION) {
      throw new Error(`Unsupported team snapshot version ${version}`);
    }

    const teamId = xfer.xferUnsignedInt(normalizePositiveInt(this.team.sourceTeamId, 1));
    this.team.sourceTeamId = teamId;

    if (xfer.getMode() === XferMode.XFER_LOAD) {
      const memberCount = xfer.xferUnsignedShort(0);
      const nextMembers = new Set<number>();
      for (let index = 0; index < memberCount; index += 1) {
        nextMembers.add(xfer.xferObjectID(0));
      }
      this.team.memberEntityIds = nextMembers;
    } else {
      const memberIds = [...this.team.memberEntityIds];
      xfer.xferUnsignedShort(memberIds.length);
      for (const memberId of memberIds) {
        xfer.xferObjectID(memberId);
      }
    }

    this.team.stateName = xfer.xferAsciiString(this.team.stateName);
    xfer.xferBool(false);
    xfer.xferBool(this.team.created || this.team.memberEntityIds.size > 0);
    this.team.created = xfer.xferBool(this.team.created);
    xfer.xferBool(false);
    xfer.xferBool(false);
    xfer.xferBool(false);
    xfer.xferBool(false);
    xfer.xferInt(0);
    xfer.xferInt(this.team.memberEntityIds.size);
    xfer.xferUnsignedInt(0);

    const genericScriptCount = xfer.xferUnsignedShort(GENERIC_SCRIPT_SLOT_COUNT);
    if (genericScriptCount !== GENERIC_SCRIPT_SLOT_COUNT) {
      throw new Error(
        `Unsupported team generic-script slot count ${genericScriptCount}; expected ${GENERIC_SCRIPT_SLOT_COUNT}.`,
      );
    }
    for (let index = 0; index < GENERIC_SCRIPT_SLOT_COUNT; index += 1) {
      xfer.xferBool(true);
    }

    const hasRecruitableOverride = xfer.xferBool(this.team.recruitableOverride !== null);
    const recruitableValue = xfer.xferBool(this.team.recruitableOverride ?? false);
    this.team.recruitableOverride = hasRecruitableOverride ? recruitableValue : null;
    xfer.xferObjectID(0);
    xfer.xferSnapshot(new SourceEmptyTeamRelationSnapshot());
    xfer.xferSnapshot(new SourceEmptyPlayerRelationSnapshot());
  }

  loadPostProcess(): void {}
}

class SourceTeamPrototypeSnapshot implements Snapshot {
  constructor(
    private readonly state: GameLogicTeamFactorySaveState,
    private readonly prototypeNameUpper: string,
    private readonly prototypeRecord: ScriptTeamRecord,
    private readonly playerState: GameLogicPlayersSaveState | null | undefined,
    private readonly sidesListState: GameLogicSidesListSaveState | null | undefined,
  ) {}

  crc(_xfer: Xfer): void {}

  xfer(xfer: Xfer): void {
    const version = xfer.xferVersion(SOURCE_TEAM_PROTOTYPE_SNAPSHOT_VERSION);
    if (version !== 1 && version !== SOURCE_TEAM_PROTOTYPE_SNAPSHOT_VERSION) {
      throw new Error(`Unsupported team prototype snapshot version ${version}`);
    }

    const ownerIndex = xfer.xferInt(resolveTeamOwnerIndex(
      this.prototypeRecord,
      this.playerState,
      this.sidesListState,
    ));
    applyOwnerIndexToTeam(this.prototypeRecord, ownerIndex, this.playerState);
    if (version >= 2) {
      this.prototypeRecord.attackPrioritySetName = xfer.xferAsciiString(
        this.prototypeRecord.attackPrioritySetName,
      );
    }
    xfer.xferBool(false);
    xfer.xferSnapshot(new SourceTeamTemplateInfoSnapshot(this.prototypeRecord));

    const teamMap = getTeamMap(this.state);
    const instanceMap = getInstanceMap(this.state);

    if (xfer.getMode() === XferMode.XFER_LOAD) {
      const existingInstanceNames = instanceMap.get(this.prototypeNameUpper) ?? [];
      for (const instanceName of existingInstanceNames) {
        if (instanceName === this.prototypeNameUpper) {
          continue;
        }
        teamMap.delete(instanceName);
      }
      clearMaterializedTeamRuntime(this.prototypeRecord);

      const loadedInstanceNames = [this.prototypeNameUpper];
      const teamInstanceCount = xfer.xferUnsignedShort(0);
      for (let index = 0; index < teamInstanceCount; index += 1) {
        const sourceTeamId = xfer.xferUnsignedInt(0);
        const targetTeam = (this.prototypeRecord.isSingleton || this.prototypeRecord.maxInstances <= 1) && index === 0
          ? this.prototypeRecord
          : cloneInstanceFromPrototype(teamMap, this.prototypeRecord);
        targetTeam.prototypeNameUpper = this.prototypeNameUpper;
        targetTeam.sourcePrototypeId = this.prototypeRecord.sourcePrototypeId;
        targetTeam.sourceTeamId = sourceTeamId;
        xfer.xferSnapshot(new SourceTeamSnapshot(targetTeam));
        if (!loadedInstanceNames.includes(targetTeam.nameUpper)) {
          loadedInstanceNames.push(targetTeam.nameUpper);
        }
      }
      instanceMap.set(this.prototypeNameUpper, loadedInstanceNames);
      return;
    }

    const savedTeams = getActualTeamInstancesForPrototype(this.state, this.prototypeNameUpper);
    xfer.xferUnsignedShort(savedTeams.length);
    for (const team of savedTeams) {
      xfer.xferUnsignedInt(normalizePositiveInt(team.sourceTeamId, 1));
      xfer.xferSnapshot(new SourceTeamSnapshot(team));
    }
  }

  loadPostProcess(): void {}
}

class SourceTeamFactorySnapshot implements Snapshot {
  constructor(
    private readonly state: GameLogicTeamFactorySaveState,
    private readonly playerState: GameLogicPlayersSaveState | null | undefined,
    private readonly sidesListState: GameLogicSidesListSaveState | null | undefined,
    private readonly coreState: GameLogicCoreSaveState | null | undefined,
    private readonly sourcePrototypeNames: readonly string[] | null | undefined,
  ) {}

  crc(_xfer: Xfer): void {}

  xfer(xfer: Xfer): void {
    const version = xfer.xferVersion(SOURCE_TEAM_FACTORY_SNAPSHOT_VERSION);
    if (version !== SOURCE_TEAM_FACTORY_SNAPSHOT_VERSION) {
      throw new Error(`Unsupported team-factory snapshot version ${version}`);
    }

    const teamMap = getTeamMap(this.state);
    const instanceMap = getInstanceMap(this.state);
    const prototypeOrder = getPrototypeOrder(this.state);
    if (prototypeOrder.length === 0) {
      const defaultTeamNameBySide = this.sidesListState?.state.scriptDefaultTeamNameBySide;
      if (defaultTeamNameBySide instanceof Map) {
        for (const teamName of defaultTeamNameBySide.values()) {
          const prototypeNameUpper = teamName.trim().toUpperCase();
          if (!prototypeNameUpper || prototypeOrder.includes(prototypeNameUpper)) {
            continue;
          }
          prototypeOrder.push(prototypeNameUpper);
          if (!teamMap.has(prototypeNameUpper)) {
            teamMap.set(prototypeNameUpper, createPrototypePlaceholder(prototypeNameUpper));
          }
          if (!instanceMap.has(prototypeNameUpper)) {
            instanceMap.set(prototypeNameUpper, [prototypeNameUpper]);
          }
        }
      }
    }
    if (prototypeOrder.length === 0 && this.coreState) {
      for (const entity of this.coreState.spawnedEntities) {
        const sourceTeamNameUpper = entity.sourceTeamNameUpper?.trim().toUpperCase()
          || entity.controllingPlayerToken?.trim().toUpperCase()
          || '';
        if (!sourceTeamNameUpper || prototypeOrder.includes(sourceTeamNameUpper)) {
          continue;
        }
        prototypeOrder.push(sourceTeamNameUpper);
        if (!teamMap.has(sourceTeamNameUpper)) {
          teamMap.set(sourceTeamNameUpper, createPrototypePlaceholder(sourceTeamNameUpper));
        }
        if (!instanceMap.has(sourceTeamNameUpper)) {
          instanceMap.set(sourceTeamNameUpper, [sourceTeamNameUpper]);
        }
      }
    }
    if (prototypeOrder.length === 0 && Array.isArray(this.sourcePrototypeNames)) {
      for (const sourcePrototypeName of this.sourcePrototypeNames) {
        const prototypeNameUpper = sourcePrototypeName.trim().toUpperCase();
        if (!prototypeNameUpper || prototypeOrder.includes(prototypeNameUpper)) {
          continue;
        }
        prototypeOrder.push(prototypeNameUpper);
        if (!teamMap.has(prototypeNameUpper)) {
          teamMap.set(prototypeNameUpper, createPrototypePlaceholder(prototypeNameUpper));
        }
        if (!instanceMap.has(prototypeNameUpper)) {
          instanceMap.set(prototypeNameUpper, [prototypeNameUpper]);
        }
      }
    }
    const nextTeamId = xfer.xferUnsignedInt(
      normalizePositiveInt(this.state.state.scriptNextSourceTeamId, 1),
    );
    this.state.state.scriptNextSourceTeamId = nextTeamId;

    const prototypeCount = xfer.xferUnsignedShort(prototypeOrder.length);
    if (xfer.getMode() === XferMode.XFER_LOAD && prototypeCount !== prototypeOrder.length) {
      throw new Error(
        `Source team-factory prototype count mismatch: save has ${prototypeCount}, map loaded ${prototypeOrder.length}.`,
      );
    }

    for (let index = 0; index < prototypeOrder.length; index += 1) {
      const prototypeNameUpper = prototypeOrder[index]!;
      const prototypeRecord = teamMap.get(prototypeNameUpper) ?? createPrototypePlaceholder(prototypeNameUpper);
      teamMap.set(prototypeNameUpper, prototypeRecord);
      if (!instanceMap.has(prototypeNameUpper)) {
        instanceMap.set(prototypeNameUpper, [prototypeNameUpper]);
      }

      const prototypeId = xfer.xferUnsignedInt(
        normalizePositiveInt(prototypeRecord.sourcePrototypeId, index + 1),
      );
      prototypeRecord.sourcePrototypeId = prototypeId;
      xfer.xferSnapshot(new SourceTeamPrototypeSnapshot(
        this.state,
        prototypeNameUpper,
        prototypeRecord,
        this.playerState,
        this.sidesListState,
      ));
    }

    let maxTeamId = 0;
    let maxPrototypeId = 0;
    for (const team of teamMap.values()) {
      maxPrototypeId = Math.max(maxPrototypeId, normalizePositiveInt(team.sourcePrototypeId, 0));
      if (!isPrototypePlaceholderTeamRecord(team)) {
        maxTeamId = Math.max(maxTeamId, normalizePositiveInt(team.sourceTeamId, 0));
      }
    }
    this.state.state.scriptNextSourceTeamId = Math.max(nextTeamId, maxTeamId + 1, 1);
    this.state.state.scriptNextSourceTeamPrototypeId = Math.max(
      normalizePositiveInt(this.state.state.scriptNextSourceTeamPrototypeId, 1),
      maxPrototypeId + 1,
      1,
    );
  }

  loadPostProcess(): void {}
}

export function buildSourceTeamFactoryChunk(
  teamFactoryState: GameLogicTeamFactorySaveState,
  playerState: GameLogicPlayersSaveState | null | undefined,
  sidesListState: GameLogicSidesListSaveState | null | undefined,
): Uint8Array {
  const saver = new XferSave();
  saver.open('source-team-factory');
  saver.xferSnapshot(new SourceTeamFactorySnapshot(teamFactoryState, playerState, sidesListState, null, null));
  saver.close();
  return new Uint8Array(saver.getBuffer());
}

export function applySourceTeamFactoryChunkToState(
  chunkData: ArrayBuffer | Uint8Array,
  currentState: GameLogicTeamFactorySaveState,
  playerState: GameLogicPlayersSaveState | null | undefined,
  sidesListState: GameLogicSidesListSaveState | null | undefined,
  coreState: GameLogicCoreSaveState | null | undefined = null,
  sourcePrototypeNames: readonly string[] | null | undefined = null,
): GameLogicTeamFactorySaveState {
  const loader = new XferLoad(toArrayBuffer(chunkData));
  loader.open('source-team-factory');
  loader.xferSnapshot(new SourceTeamFactorySnapshot(
    currentState,
    playerState,
    sidesListState,
    coreState,
    sourcePrototypeNames,
  ));
  loader.close();
  return currentState;
}
