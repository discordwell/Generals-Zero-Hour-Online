// @ts-nocheck — self is typed as any; real safety comes from the test suite.
/**
 * Script engine — map script loading, execution, and runtime updates.
 *
 * Source parity: ScriptEngine.cpp, ScriptEngine::update/execute
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type GL = any;

import {
  DRAWABLE_FRAMES_PER_FLASH, LOCOMOTORSET_PANIC, LOCOMOTORSET_WANDER,
  LOGIC_FRAME_RATE, MapEntity, MAX_SPIN_COUNT, NO_ATTACK_DISTANCE,
  RELATIONSHIP_ENEMIES, SCRIPT_DIFFICULTY_NORMAL,
  SCRIPT_KIND_OF_ALLOW_SURRENDER_NAMES, SCRIPT_KIND_OF_NAMES_BY_SOURCE_BIT,
  SCRIPT_KIND_OF_NAMES_BY_SOURCE_BIT_ALLOW_SURRENDER,
  SCRIPT_KIND_OF_NAME_TO_BIT, SCRIPT_KIND_OF_NAME_TO_BIT_ALLOW_SURRENDER,
  SCRIPT_PARAMETER_TYPE_AI_MOOD, SCRIPT_PARAMETER_TYPE_ANGLE,
  SCRIPT_PARAMETER_TYPE_BOOLEAN, SCRIPT_PARAMETER_TYPE_BOUNDARY,
  SCRIPT_PARAMETER_TYPE_BUILDABLE, SCRIPT_PARAMETER_TYPE_COMPARISON,
  SCRIPT_PARAMETER_TYPE_COORD3D, SCRIPT_PARAMETER_TYPE_INT,
  SCRIPT_PARAMETER_TYPE_KIND_OF, SCRIPT_PARAMETER_TYPE_OBJECT_STATUS,
  SCRIPT_PARAMETER_TYPE_OBJECT_TYPE, SCRIPT_PARAMETER_TYPE_RADAR_EVENT_TYPE,
  SCRIPT_PARAMETER_TYPE_REAL, SCRIPT_PARAMETER_TYPE_RELATION,
  SCRIPT_PARAMETER_TYPE_SHAKE_INTENSITY, SCRIPT_PARAMETER_TYPE_SURFACES_ALLOWED,
  SCRIPT_PARAMETER_TYPE_TEAM, SCRIPT_PARAMETER_TYPE_UPGRADE,
  ScriptTeamRecord,
} from './index.js';
import { MAP_XY_FACTOR } from '@generals/terrain';

// ---- Script engine implementations ----

export function loadMapScripts(self: GL, mapData: MapDataJSON): void {
  self.mapScriptLists.length = 0;
  self.mapScriptsByNameUpper.clear();
  self.mapScriptGroupsByNameUpper.clear();
  self.scriptPlayerSideByName.clear();
  self.scriptDefaultTeamNameBySide.clear();
  self.mapScriptSideByIndex.length = 0;
  self.mapScriptDifficultyByIndex.length = 0;
  self.scriptAiBuildListEntriesBySide.clear();

  const sidesList = mapData.sidesList;
  if (!sidesList) {
    return;
  }

  for (let sideIndex = 0; sideIndex < sidesList.sides.length; sideIndex += 1) {
    const side = sidesList.sides[sideIndex];
    if (!side) {
      continue;
    }
    const dict = side.dict ?? {};
    const playerName = self.readScriptDictString(dict, 'playerName');
    const playerFaction = self.readScriptDictString(dict, 'playerFaction');
    const resolvedSide = self.resolveScriptSideFromPlayerFaction(playerFaction);
    if (resolvedSide) {
      self.mapScriptSideByIndex[sideIndex] = resolvedSide;
    }
    const buildListEntries = self.resolveScriptAiBuildListEntries(side.buildList ?? []);
    if (resolvedSide && buildListEntries.length > 0) {
      const existingEntries = self.scriptAiBuildListEntriesBySide.get(resolvedSide);
      if (existingEntries) {
        existingEntries.push(...buildListEntries);
      } else {
        self.scriptAiBuildListEntriesBySide.set(resolvedSide, buildListEntries);
      }
    }
    const normalizedPlayerName = playerName.trim().toUpperCase();
    if (normalizedPlayerName && resolvedSide) {
      self.scriptPlayerSideByName.set(normalizedPlayerName, resolvedSide);
    }
    const difficulty = self.readScriptDictNumber(dict, 'skirmishDifficulty');
    self.mapScriptDifficultyByIndex[sideIndex] = difficulty !== null
      ? Math.trunc(difficulty)
      : SCRIPT_DIFFICULTY_NORMAL;
  }

  for (const teamEntry of sidesList.teams) {
    const dict = teamEntry.dict ?? {};
    const teamName = self.readScriptDictString(dict, 'teamName');
    if (!teamName) {
      continue;
    }
    const teamRecord = self.getOrCreateLiteralScriptTeamRecord(teamName);
    if (!teamRecord) {
      continue;
    }
    const teamNameUpper = teamRecord.nameUpper;

    const teamOwner = self.readScriptDictString(dict, 'teamOwner');
    const ownerKey = teamOwner.trim().toUpperCase();
    if (ownerKey) {
      teamRecord.controllingPlayerToken = self.normalizeControllingPlayerToken(teamOwner);
      const ownerSide = self.scriptPlayerSideByName.get(ownerKey);
      if (ownerSide) {
        teamRecord.controllingSide = ownerSide;
        // Source parity: SidesList::isPlayerDefaultTeam marks "team<playerName>" as
        // the owning player's default team.
        if (
          teamNameUpper.startsWith('TEAM')
          && teamNameUpper.slice('TEAM'.length) === ownerKey
          && !self.scriptDefaultTeamNameBySide.has(ownerSide)
        ) {
          self.scriptDefaultTeamNameBySide.set(ownerSide, teamNameUpper);
        }
      }
    }

    const isSingleton = self.readScriptDictBoolean(dict, 'teamIsSingleton');
    if (isSingleton !== null) {
      teamRecord.isSingleton = isSingleton;
    }
    const maxInstances = self.readScriptDictNumber(dict, 'teamMaxInstances');
    if (maxInstances !== null) {
      teamRecord.maxInstances = Math.trunc(maxInstances);
    }
    const productionPriority = self.readScriptDictNumber(dict, 'teamProductionPriority');
    if (productionPriority !== null) {
      teamRecord.productionPriority = Math.trunc(productionPriority);
    }
    const productionPrioritySuccessIncrease = self.readScriptDictNumber(
      dict,
      'teamProductionPrioritySuccessIncrease',
    );
    if (productionPrioritySuccessIncrease !== null) {
      teamRecord.productionPrioritySuccessIncrease = Math.trunc(productionPrioritySuccessIncrease);
    }
    const productionPriorityFailureDecrease = self.readScriptDictNumber(
      dict,
      'teamProductionPriorityFailureDecrease',
    );
    if (productionPriorityFailureDecrease !== null) {
      teamRecord.productionPriorityFailureDecrease = Math.trunc(productionPriorityFailureDecrease);
    }
    teamRecord.reinforcementUnitEntries = self.resolveScriptTeamTemplateUnitEntries(dict);
    const reinforcementTransportTemplateName = self.readScriptDictString(dict, 'teamTransport');
    if (reinforcementTransportTemplateName) {
      teamRecord.reinforcementTransportTemplateName = reinforcementTransportTemplateName;
    }
    const reinforcementStartWaypointName = self.readScriptDictString(dict, 'teamReinforcementOrigin');
    if (reinforcementStartWaypointName) {
      teamRecord.reinforcementStartWaypointName = reinforcementStartWaypointName;
    }
    const reinforcementTeamStartsFull = self.readScriptDictBoolean(dict, 'teamStartsFull');
    if (reinforcementTeamStartsFull !== null) {
      teamRecord.reinforcementTeamStartsFull = reinforcementTeamStartsFull;
    }
    const reinforcementTransportsExit = self.readScriptDictBoolean(dict, 'teamTransportsExit');
    if (reinforcementTransportsExit !== null) {
      teamRecord.reinforcementTransportsExit = reinforcementTransportsExit;
    }
    const teamHomeWaypointName = self.readScriptDictString(dict, 'teamHome');
    if (teamHomeWaypointName) {
      teamRecord.homeWaypointName = teamHomeWaypointName;
    }
    const teamIsAIRecruitable = self.readScriptDictBoolean(dict, 'teamIsAIRecruitable');
    if (teamIsAIRecruitable !== null) {
      teamRecord.isAIRecruitable = teamIsAIRecruitable;
    }
  }

  for (let sideIndex = 0; sideIndex < sidesList.sides.length; sideIndex += 1) {
    const side = sidesList.sides[sideIndex];
    if (!side || !side.scripts) {
      self.mapScriptLists[sideIndex] = { scripts: [], groups: [] };
      continue;
    }
    self.mapScriptLists[sideIndex] = createMapScriptListRuntime(self, side.scripts, sideIndex);
  }
}

export function createMapScriptListRuntime(self: GL, scriptList: ScriptListJSON, sideIndex: number): MapScriptListRuntime {
  const scripts: MapScriptRuntime[] = [];
  for (const script of scriptList.scripts ?? []) {
    scripts.push(createMapScriptRuntime(self, script, sideIndex));
  }

  const groups: MapScriptGroupRuntime[] = [];
  for (const group of scriptList.groups ?? []) {
    groups.push(createMapScriptGroupRuntime(self, group, sideIndex));
  }

  return { scripts, groups };
}

export function createMapScriptGroupRuntime(self: GL, group: ScriptGroupJSON, sideIndex: number): MapScriptGroupRuntime {
  const name = group.name ?? '';
  const nameUpper = name.trim().toUpperCase();
  const scripts: MapScriptRuntime[] = [];
  for (const script of group.scripts ?? []) {
    scripts.push(createMapScriptRuntime(self, script, sideIndex));
  }
  const runtime: MapScriptGroupRuntime = {
    name,
    nameUpper,
    active: group.active ?? true,
    subroutine: group.subroutine ?? false,
    scripts,
  };
  if (nameUpper && !self.mapScriptGroupsByNameUpper.has(nameUpper)) {
    self.mapScriptGroupsByNameUpper.set(nameUpper, runtime);
  }
  return runtime;
}

export function createMapScriptRuntime(self: GL, script: ScriptJSON, sideIndex: number): MapScriptRuntime {
  const name = script.name ?? '';
  const nameUpper = name.trim().toUpperCase();
  const conditions: MapScriptOrConditionRuntime[] = [];
  const conditionList = script.conditions ?? [];
  for (let orIndex = 0; orIndex < conditionList.length; orIndex += 1) {
    const orCondition = conditionList[orIndex]!;
    conditions.push(createMapScriptOrConditionRuntime(self, orCondition, sideIndex, nameUpper, orIndex));
  }

  const actions: MapScriptActionRuntime[] = [];
  for (const action of script.actions ?? []) {
    actions.push(createMapScriptActionRuntime(self, action));
  }

  const falseActions: MapScriptActionRuntime[] = [];
  for (const action of script.falseActions ?? []) {
    falseActions.push(createMapScriptActionRuntime(self, action));
  }

  const delaySeconds = Number.isFinite(script.delayEvaluationSeconds)
    ? script.delayEvaluationSeconds
    : 0;

  const runtime: MapScriptRuntime = {
    name,
    nameUpper,
    active: script.active ?? true,
    oneShot: script.oneShot ?? false,
    easy: script.easy ?? true,
    normal: script.normal ?? true,
    hard: script.hard ?? true,
    subroutine: script.subroutine ?? false,
    delayEvaluationSeconds: delaySeconds,
    frameToEvaluateAt: 0,
    conditionTeamNameUpper: null,
    sourceSideIndex: sideIndex,
    conditions,
    actions,
    falseActions,
  };

  checkMapScriptConditionsForTeamNames(self, runtime);

  if (delaySeconds > 0) {
    runtime.frameToEvaluateAt = self.gameRandom.nextRange(0, 2 * LOGIC_FRAME_RATE);
  }

  if (nameUpper && !self.mapScriptsByNameUpper.has(nameUpper)) {
    self.mapScriptsByNameUpper.set(nameUpper, runtime);
  }

  return runtime;
}

export function createMapScriptOrConditionRuntime(self: GL, 
  orCondition: ScriptOrConditionJSON,
  sideIndex: number,
  scriptNameUpper: string,
  orIndex: number,
): MapScriptOrConditionRuntime {
  const conditions: MapScriptConditionRuntime[] = [];
  for (let condIndex = 0; condIndex < (orCondition.conditions ?? []).length; condIndex += 1) {
    const condition = orCondition.conditions[condIndex]!;
    const cacheId = `MAPSCRIPT:${sideIndex}:${scriptNameUpper}:OR${orIndex}:COND${condIndex}`;
    conditions.push(createMapScriptConditionRuntime(self, condition, cacheId));
  }
  return { conditions };
}

export function createMapScriptConditionRuntime(self: GL, 
  condition: ScriptConditionJSON,
  cacheId: string,
): MapScriptConditionRuntime {
  const params: MapScriptParameterRuntime[] = [];
  for (const param of condition.params ?? []) {
    params.push(createMapScriptParameterRuntime(self, param));
  }
  return {
    conditionType: condition.conditionType,
    params,
    cacheId,
  };
}

export function createMapScriptActionRuntime(self: GL, action: ScriptActionJSON): MapScriptActionRuntime {
  const params: MapScriptParameterRuntime[] = [];
  for (const param of action.params ?? []) {
    params.push(createMapScriptParameterRuntime(self, param));
  }
  return {
    actionType: action.actionType,
    params,
  };
}

export function createMapScriptParameterRuntime(self: GL, param: ScriptParameterJSON): MapScriptParameterRuntime {
  return {
    type: param.type,
    value: resolveMapScriptParameterValue(self, param),
  };
}

export function resolveMapScriptParameterValue(self: GL, param: ScriptParameterJSON): unknown {
  switch (param.type) {
    case SCRIPT_PARAMETER_TYPE_COORD3D:
      return param.coord ?? { x: 0, y: 0, z: 0 };
    case SCRIPT_PARAMETER_TYPE_REAL:
    case SCRIPT_PARAMETER_TYPE_ANGLE:
      return Number.isFinite(param.realValue) ? param.realValue : 0;
    case SCRIPT_PARAMETER_TYPE_BOOLEAN:
      return param.intValue !== 0;
    case SCRIPT_PARAMETER_TYPE_KIND_OF: {
      const kindOf = self.normalizeScriptKindOfToken(param.stringValue);
      if (kindOf) {
        const bitIndex = self.resolveScriptKindOfBitFromName(kindOf);
        if (bitIndex !== null) {
          return bitIndex;
        }
      }
      return Math.trunc(param.intValue);
    }
    case SCRIPT_PARAMETER_TYPE_OBJECT_STATUS: {
      const mask = self.resolveScriptObjectStatusMaskFromInput(param.stringValue);
      if (mask !== null) {
        return mask;
      }
      return Math.trunc(param.intValue);
    }
    case SCRIPT_PARAMETER_TYPE_OBJECT_TYPE:
      return normalizeMapScriptObjectTypeParam(self, param.stringValue);
    case SCRIPT_PARAMETER_TYPE_UPGRADE:
      return normalizeMapScriptUpgradeParam(self, param.stringValue);
    case SCRIPT_PARAMETER_TYPE_INT:
    case SCRIPT_PARAMETER_TYPE_COMPARISON:
    case SCRIPT_PARAMETER_TYPE_RELATION:
    case SCRIPT_PARAMETER_TYPE_AI_MOOD:
    case SCRIPT_PARAMETER_TYPE_RADAR_EVENT_TYPE:
    case SCRIPT_PARAMETER_TYPE_BOUNDARY:
    case SCRIPT_PARAMETER_TYPE_BUILDABLE:
    case SCRIPT_PARAMETER_TYPE_SURFACES_ALLOWED:
    case SCRIPT_PARAMETER_TYPE_SHAKE_INTENSITY:
      return Math.trunc(param.intValue);
    default:
      return param.stringValue;
  }
}

export function configureScriptKindOfBitLayout(self: GL, iniDataRegistry: IniDataRegistry): void {
  let useAllowSurrenderLayout = false;
  for (const objectDef of iniDataRegistry.objects.values()) {
    const kindOf = self.normalizeKindOf(objectDef.kindOf);
    for (const kindOfName of SCRIPT_KIND_OF_ALLOW_SURRENDER_NAMES) {
      if (kindOf.has(kindOfName)) {
        useAllowSurrenderLayout = true;
        break;
      }
    }
    if (useAllowSurrenderLayout) {
      break;
    }
  }

  if (useAllowSurrenderLayout) {
    self.scriptKindOfNamesBySourceBit = SCRIPT_KIND_OF_NAMES_BY_SOURCE_BIT_ALLOW_SURRENDER;
    self.scriptKindOfNameToBit = SCRIPT_KIND_OF_NAME_TO_BIT_ALLOW_SURRENDER;
    return;
  }

  self.scriptKindOfNamesBySourceBit = SCRIPT_KIND_OF_NAMES_BY_SOURCE_BIT;
  self.scriptKindOfNameToBit = SCRIPT_KIND_OF_NAME_TO_BIT;
}

export function normalizeMapScriptObjectTypeParam(self: GL, rawValue: string): string {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return '';
  }
  if (trimmed.startsWith('Fundamentalist')) {
    return `GLA${trimmed.slice('Fundamentalist'.length)}`;
  }
  return trimmed;
}

export function normalizeMapScriptUpgradeParam(self: GL, rawValue: string): string {
  const trimmed = rawValue.trim();
  if (
    trimmed === 'Upgrade_AmericaRangerCaptureBuilding'
    || trimmed === 'Upgrade_ChinaRedguardCaptureBuilding'
    || trimmed === 'Upgrade_GLARebelCaptureBuilding'
  ) {
    return 'Upgrade_InfantryCaptureBuilding';
  }
  return trimmed;
}

export function checkMapScriptConditionsForTeamNames(self: GL, script: MapScriptRuntime): void {
  let singletonTeamName: string | null = null;
  let multiTeamName: string | null = null;
  let multiTeamDisplayName: string | null = null;

  for (const orCondition of script.conditions) {
    for (const condition of orCondition.conditions) {
      for (const param of condition.params) {
        if (param.type !== SCRIPT_PARAMETER_TYPE_TEAM) {
          continue;
        }
        const rawName = self.coerceScriptConditionString(param.value).trim();
        if (!rawName) {
          continue;
        }
        const teamNameUpper = rawName.toUpperCase();
        const teamRecord = self.scriptTeamsByName.get(teamNameUpper);
        if (!teamRecord) {
          continue;
        }
        let isSingleton = teamRecord.isSingleton;
        if (teamRecord.maxInstances < 2) {
          isSingleton = true;
        }
        if (isSingleton) {
          singletonTeamName = teamNameUpper;
        } else if (!multiTeamName) {
          multiTeamName = teamNameUpper;
          multiTeamDisplayName = rawName;
        } else if (multiTeamName !== teamNameUpper) {
          // Source parity: ScriptEngine::checkConditionsForTeamNames warning/debug append chain.
          self.executeScriptDebugMessage(
            '***WARNING: Script contains multiple non-singleton team conditions::***',
            false,
            false,
          );
          self.executeScriptDebugMessage(script.name, false, false);
          self.executeScriptDebugMessage(multiTeamDisplayName ?? multiTeamName, false, false);
          self.executeScriptDebugMessage(rawName, false, false);
        }
      }
    }
  }

  if (multiTeamName) {
    script.conditionTeamNameUpper = multiTeamName;
  } else if (singletonTeamName) {
    script.conditionTeamNameUpper = singletonTeamName;
  }
}

export function resetScriptWaypointPathCompletions(self: GL): void {
  if (self.scriptCompletedWaypointPathsByEntityId.size === 0) {
    return;
  }
  self.scriptCompletedWaypointPathsByEntityId.clear();
}

export function updateScriptCountdownTimers(self: GL): void {
  for (const counter of self.scriptCountersByName.values()) {
    if (!counter.isCountdownTimer) {
      continue;
    }
    // Source parity: countdown timers decrement to -1 and then stop.
    if (counter.value >= 0) {
      counter.value -= 1;
    }
  }
}

export function updateScriptEntityFlashes(self: GL): void {
  if (self.frameCounter % DRAWABLE_FRAMES_PER_FLASH !== 0) {
    return;
  }
  for (const entity of self.spawnedEntities.values()) {
    if (entity.scriptFlashCount <= 0) {
      continue;
    }
    entity.scriptFlashCount = Math.max(0, entity.scriptFlashCount - 1);
  }
}

export function updatePendingScriptTeamCreated(self: GL): void {
  if (self.scriptTeamCreatedReadyFrameByName.size === 0) {
    return;
  }

  for (const [teamNameUpper, readyFrame] of self.scriptTeamCreatedReadyFrameByName) {
    if (self.frameCounter < readyFrame) {
      continue;
    }
    const team = self.scriptTeamsByName.get(teamNameUpper);
    if (team) {
      markScriptTeamCreatedPulse(self, team);
    }
    self.scriptTeamCreatedReadyFrameByName.delete(teamNameUpper);
  }
}

export function markScriptTeamCreatedPulse(self: GL, team: ScriptTeamRecord): void {
  team.created = true;
  self.scriptTeamCreatedAutoClearFrameByName.set(team.nameUpper, self.frameCounter + 1);
}

export function updateScriptTeamCreatedPulses(self: GL): void {
  if (self.scriptTeamCreatedAutoClearFrameByName.size === 0) {
    return;
  }

  for (const [teamNameUpper, clearFrame] of self.scriptTeamCreatedAutoClearFrameByName) {
    if (self.frameCounter < clearFrame) {
      continue;
    }
    const team = self.scriptTeamsByName.get(teamNameUpper);
    if (team) {
      team.created = false;
    }
    self.scriptTeamCreatedAutoClearFrameByName.delete(teamNameUpper);
  }
}

export function updateScriptWaypointPathCompletions(self: GL): void {
  for (const [entityId] of self.scriptPendingWaypointPathByEntityId.entries()) {
    const entity = self.spawnedEntities.get(entityId);
    if (!entity || entity.destroyed) {
      self.scriptPendingWaypointPathByEntityId.delete(entityId);
      continue;
    }

    if (entity.moving || entity.movePath.length > 0 || entity.moveTarget !== null) {
      continue;
    }
    self.scriptPendingWaypointPathByEntityId.delete(entityId);
  }
}

export function updateScriptAttackAreaEntity(self: GL, 
  attacker: MapEntity,
  state: ScriptAttackAreaState,
  forceScan: boolean,
): void {
  const trigger = self.mapTriggerRegions[state.triggerIndex];
  if (!trigger) {
    self.scriptAttackAreaStateByEntityId.delete(attacker.id);
    return;
  }

  if (!forceScan && self.frameCounter < state.nextEnemyScanFrame) {
    return;
  }
  state.nextEnemyScanFrame = self.frameCounter + LOGIC_FRAME_RATE;

  const currentTargetId = attacker.attackTargetEntityId;
  if (currentTargetId !== null) {
    const currentTarget = self.spawnedEntities.get(currentTargetId);
    if (
      currentTarget
      && !currentTarget.destroyed
      && !self.isScriptEntityEffectivelyDead(currentTarget)
      && self.getTeamRelationship(attacker, currentTarget) === RELATIONSHIP_ENEMIES
      && self.isPointInsideTriggerRegion(trigger, currentTarget.x, currentTarget.z)
      && self.canAttackerTargetEntity(attacker, currentTarget, 'SCRIPT')
    ) {
      return;
    }
    self.clearAttackTarget(attacker.id);
  }

  const victim = self.findScriptClosestEnemyInTriggerArea(attacker, state.triggerIndex);
  if (victim) {
    self.issueAttackEntity(attacker.id, victim.id, 'SCRIPT');
  }
}

export function updateScriptAttackArea(self: GL): void {
  if (self.scriptAttackAreaStateByEntityId.size === 0) {
    return;
  }

  for (const [entityId, state] of self.scriptAttackAreaStateByEntityId) {
    const attacker = self.spawnedEntities.get(entityId);
    if (!attacker || attacker.destroyed || self.isScriptEntityEffectivelyDead(attacker)) {
      self.scriptAttackAreaStateByEntityId.delete(entityId);
      continue;
    }
    // Source parity: AI_ATTACK_AREA is only valid for mobile, non-projectile units.
    if (!attacker.canMove || attacker.kindOf.has('PROJECTILE')) {
      self.scriptAttackAreaStateByEntityId.delete(entityId);
      continue;
    }

    updateScriptAttackAreaEntity(self, attacker, state, false);
  }
}

export function updateScriptHunt(self: GL): void {
  if (self.scriptHuntStateByEntityId.size === 0) {
    return;
  }

  for (const [entityId, state] of self.scriptHuntStateByEntityId) {
    const entity = self.spawnedEntities.get(entityId);
    if (!entity || entity.destroyed || self.isScriptEntityEffectivelyDead(entity)) {
      self.scriptHuntStateByEntityId.delete(entityId);
      continue;
    }
    if (!entity.canMove || entity.kindOf.has('PROJECTILE')) {
      self.scriptHuntStateByEntityId.delete(entityId);
      continue;
    }
    if (self.frameCounter < state.nextEnemyScanFrame) {
      continue;
    }
    state.nextEnemyScanFrame = self.frameCounter + LOGIC_FRAME_RATE;

    const side = self.normalizeSide(entity.side);
    const hasGlobalPlayerHunt = side !== null && self.scriptSidesUnitsShouldHunt.has(side);

    const currentTargetId = entity.attackTargetEntityId;
    if (currentTargetId !== null) {
      const currentTarget = self.spawnedEntities.get(currentTargetId);
      if (
        currentTarget
        && !currentTarget.destroyed
        && !self.isScriptEntityEffectivelyDead(currentTarget)
        && self.getTeamRelationship(entity, currentTarget) === RELATIONSHIP_ENEMIES
        && self.canAttackerTargetEntity(entity, currentTarget, 'SCRIPT')
      ) {
        continue;
      }
      self.clearAttackTarget(entity.id);
    }

    const victim = self.findScriptHuntTarget(entity);
    if (victim) {
      self.issueAttackEntity(entity.id, victim.id, 'SCRIPT');
      continue;
    }

    if (!hasGlobalPlayerHunt) {
      self.scriptHuntStateByEntityId.delete(entityId);
    }
  }
}

export function updatePendingScriptReinforcementTransportArrivals(self: GL): void {
  for (const [entityId, pending] of self.pendingScriptReinforcementTransportArrivalByEntityId.entries()) {
    const transport = self.spawnedEntities.get(entityId);
    if (!transport || transport.destroyed) {
      self.pendingScriptReinforcementTransportArrivalByEntityId.delete(entityId);
      continue;
    }

    const reachDistance = Math.max(
      MAP_XY_FACTOR,
      self.resolveEntityMajorRadius(transport) + MAP_XY_FACTOR,
    );

    if (pending.exitMoveIssued) {
      if (self.isEntityOffMap(transport)) {
        self.markEntityDestroyed(transport.id, -1);
        self.pendingScriptReinforcementTransportArrivalByEntityId.delete(entityId);
        continue;
      }
      if (transport.moving) {
        continue;
      }
      if (pending.deliverPayloadMode) {
        self.issueMoveTo(
          transport.id,
          pending.exitTargetX,
          pending.exitTargetZ,
          NO_ATTACK_DISTANCE,
          true,
        );
        continue;
      }
      const distanceToOrigin = Math.hypot(transport.x - pending.originX, transport.z - pending.originZ);
      if (distanceToOrigin > reachDistance) {
        self.issueMoveTo(transport.id, pending.originX, pending.originZ, NO_ATTACK_DISTANCE, true);
        continue;
      }
      self.markEntityDestroyed(transport.id, -1);
      self.pendingScriptReinforcementTransportArrivalByEntityId.delete(entityId);
      continue;
    }

    if (pending.evacuationIssued) {
      const remainingContained = self.collectContainedEntityIds(transport.id).length;
      if (remainingContained <= 0) {
        if (pending.transportsExit) {
          if (pending.deliverPayloadMode) {
            self.beginScriptReinforcementTransportExit(transport, pending);
            continue;
          }
          const distanceToOrigin = Math.hypot(transport.x - pending.originX, transport.z - pending.originZ);
          if (distanceToOrigin <= reachDistance) {
            self.markEntityDestroyed(transport.id, -1);
            self.pendingScriptReinforcementTransportArrivalByEntityId.delete(entityId);
            continue;
          }
          self.beginScriptReinforcementTransportExit(transport, pending);
          continue;
        }
        self.pendingScriptReinforcementTransportArrivalByEntityId.delete(entityId);
        continue;
      }
      if (!pending.deliverPayloadMode) {
        continue;
      }
    }

    const distanceToTarget = Math.hypot(transport.x - pending.targetX, transport.z - pending.targetZ);
    const allowedTargetDistance = Math.max(reachDistance, pending.deliveryDistance);
    if (distanceToTarget > allowedTargetDistance) {
      if (!transport.moving) {
        self.issueMoveTo(transport.id, pending.targetX, pending.targetZ, NO_ATTACK_DISTANCE, true);
      }
      continue;
    }
    // Source parity: DeliverPayloadAIUpdate starts drop logic as soon as
    // distance-to-target constraints are satisfied, not only after path end.
    // The transport keeps following its move command while delivering.

    const containedEntityIds = self.collectContainedEntityIds(transport.id);
    if (transport.containProfile && containedEntityIds.length > 0) {
      if (pending.deliverPayloadMode) {
        pending.evacuationIssued = true;
        if (pending.deliverPayloadNextDropFrame < 0) {
          pending.deliverPayloadNextDropFrame = self.frameCounter + pending.deliverPayloadDoorDelayFrames;
        }
        if (self.frameCounter < pending.deliverPayloadNextDropFrame) {
          continue;
        }
        const passengerId = containedEntityIds[0]!;
        self.dropScriptReinforcementDeliverPayloadPassenger(passengerId, transport, pending);
        pending.deliverPayloadNextDropFrame = self.frameCounter + Math.max(1, pending.deliverPayloadDropDelayFrames);
        continue;
      }
      self.applyCommand({ type: 'evacuate', entityId: transport.id });
    }

    if (pending.transportsExit) {
      pending.evacuationIssued = true;
      if (self.collectContainedEntityIds(transport.id).length <= 0) {
        if (pending.deliverPayloadMode) {
          self.beginScriptReinforcementTransportExit(transport, pending);
          continue;
        }
        const distanceToOrigin = Math.hypot(transport.x - pending.originX, transport.z - pending.originZ);
        if (distanceToOrigin <= reachDistance) {
          self.markEntityDestroyed(transport.id, -1);
          self.pendingScriptReinforcementTransportArrivalByEntityId.delete(entityId);
        } else {
          self.beginScriptReinforcementTransportExit(transport, pending);
        }
      }
      continue;
    }
    self.pendingScriptReinforcementTransportArrivalByEntityId.delete(entityId);
  }
}

export function updateScriptSideRepairQueues(self: GL): void {
  for (const [side, queuedBuildingIds] of self.scriptSideRepairQueue.entries()) {
    for (const buildingId of Array.from(queuedBuildingIds.values())) {
      const building = self.spawnedEntities.get(buildingId);
      if (!building || building.destroyed) {
        queuedBuildingIds.delete(buildingId);
        continue;
      }
      if (building.health >= building.maxHealth && building.constructionPercent === CONSTRUCTION_COMPLETE) {
        queuedBuildingIds.delete(buildingId);
        continue;
      }

      const dozer = self.findScriptRepairDozerForBuilding(side, building);
      if (!dozer) {
        continue;
      }

      self.handleRepairBuildingCommand({
        type: 'repairBuilding',
        entityId: dozer.id,
        targetBuildingId: building.id,
        commandSource: 'AI',
      });
      queuedBuildingIds.delete(buildingId);
    }

    if (queuedBuildingIds.size === 0) {
      self.scriptSideRepairQueue.delete(side);
    }
  }
}

export function updateScriptTriggerTransitions(self: GL): void {
  if (self.mapTriggerRegions.length === 0) {
    return;
  }

  for (const trackedEntityId of Array.from(self.scriptTriggerMembershipByEntityId.keys())) {
    const trackedEntity = self.spawnedEntities.get(trackedEntityId);
    if (!trackedEntity || trackedEntity.destroyed) {
      self.clearScriptTriggerTrackingForEntity(trackedEntityId);
    }
  }

  for (const entity of self.spawnedEntities.values()) {
    if (entity.destroyed || entity.kindOf.has('INERT') || entity.kindOf.has('PROJECTILE')) {
      self.clearScriptTriggerTrackingForEntity(entity.id);
      continue;
    }

    const previousMembership = self.scriptTriggerMembershipByEntityId.get(entity.id) ?? new Set<number>();
    const currentMembership = self.computeCurrentScriptTriggerMembership(entity);
    const entered = new Set<number>();
    const exited = new Set<number>();

    for (const triggerIndex of currentMembership) {
      if (!previousMembership.has(triggerIndex)) {
        entered.add(triggerIndex);
      }
    }
    for (const triggerIndex of previousMembership) {
      if (!currentMembership.has(triggerIndex)) {
        exited.add(triggerIndex);
      }
    }

    self.scriptTriggerMembershipByEntityId.set(entity.id, currentMembership);

    if (entered.size === 0 && exited.size === 0) {
      continue;
    }

    self.scriptTriggerEnteredByEntityId.set(entity.id, entered);
    self.scriptTriggerExitedByEntityId.set(entity.id, exited);
    self.scriptTriggerEnterExitFrameByEntityId.set(entity.id, self.frameCounter);
  }
}

export function executeMapScripts(self: GL): void {
  if (self.mapScriptLists.length === 0) {
    return;
  }

  const previousCurrentSide = self.scriptCurrentPlayerSide;
  for (let sideIndex = 0; sideIndex < self.mapScriptLists.length; sideIndex += 1) {
    const scriptList = self.mapScriptLists[sideIndex];
    if (!scriptList) {
      continue;
    }
    self.scriptCurrentPlayerSide = self.mapScriptSideByIndex[sideIndex] ?? null;
    self.executeMapScriptList(scriptList);
  }
  self.scriptCurrentPlayerSide = previousCurrentSide;
}

export function updateScriptSequentialScripts(self: GL): void {
  let lastIndex = -1;
  let spinCount = 0;

  for (let index = 0; index < self.scriptSequentialScripts.length; ) {
    if (index === lastIndex) {
      spinCount += 1;
    } else {
      spinCount = 0;
    }
    if (spinCount > MAX_SPIN_COUNT) {
      index += 1;
      continue;
    }
    lastIndex = index;

    const seqScript = self.scriptSequentialScripts[index];
    if (!seqScript) {
      self.cleanupSequentialScriptAt(index, false);
      continue;
    }

    const targetEntity = seqScript.objectId !== null ? self.spawnedEntities.get(seqScript.objectId) ?? null : null;
    const team = seqScript.teamNameUpper
      ? self.scriptTeamsByName.get(seqScript.teamNameUpper) ?? null
      : null;
    if (!targetEntity && !team) {
      self.cleanupSequentialScriptAt(index, false);
      continue;
    }

    const previousCurrentSide = self.scriptCurrentPlayerSide;
    let scriptSide: string | null = null;
    if (targetEntity) {
      scriptSide = self.normalizeSide(targetEntity.side);
    } else if (team) {
      scriptSide = self.resolveScriptTeamControllingSide(team);
    }
    if (scriptSide && self.sidePlayerTypes.get(scriptSide) === 'COMPUTER') {
      self.scriptCurrentPlayerSide = scriptSide;
    } else {
      self.scriptCurrentPlayerSide = null;
    }

    const isIdle = targetEntity
      ? self.isScriptSequentialEntityIdle(targetEntity)
      : (team ? self.isScriptSequentialTeamIdle(team) : false);
    let itAdvanced = false;

    if ((isIdle && seqScript.framesToWait < 1) || seqScript.framesToWait === 0) {
      if (seqScript.dontAdvanceInstruction) {
        seqScript.dontAdvanceInstruction = false;
      } else {
        seqScript.currentInstruction += 1;
      }

      const scriptRuntime = self.mapScriptsByNameUpper.get(seqScript.scriptNameUpper);
      if (!scriptRuntime) {
        self.cleanupSequentialScriptAt(index, false);
        self.scriptCurrentPlayerSide = previousCurrentSide;
        continue;
      }

      const action = scriptRuntime.actions[seqScript.currentInstruction] ?? null;
      if (action) {
        const previousConditionTeam = self.scriptConditionTeamNameUpper;
        const previousConditionEntity = self.scriptConditionEntityId;
        const previousCallingTeam = self.scriptCallingTeamNameUpper;
        const previousCallingEntity = self.scriptCallingEntityId;

        self.scriptConditionTeamNameUpper = team ? team.nameUpper : null;
        self.scriptConditionEntityId = targetEntity ? targetEntity.id : null;
        seqScript.framesToWait = -1;

        const actionTypeName = self.resolveScriptActionTypeName(action.actionType);
        if (
          actionTypeName === 'SKIRMISH_WAIT_FOR_COMMANDBUTTON_AVAILABLE_ALL'
          || actionTypeName === 'SKIRMISH_WAIT_FOR_COMMANDBUTTON_AVAILABLE_PARTIAL'
        ) {
          const params = action.params.map((param) => param.value);
          const teamName = self.coerceScriptConditionString(params[1]);
          const commandButtonName = self.coerceScriptConditionString(params[2]);
          const allReady = actionTypeName === 'SKIRMISH_WAIT_FOR_COMMANDBUTTON_AVAILABLE_ALL';
          if (!self.executeScriptSkirmishWaitForCommandButtonAvailability(teamName, commandButtonName, allReady)) {
            seqScript.dontAdvanceInstruction = true;
          }
        } else if (
          actionTypeName === 'TEAM_WAIT_FOR_NOT_CONTAINED_ALL'
          || actionTypeName === 'TEAM_WAIT_FOR_NOT_CONTAINED_PARTIAL'
        ) {
          const params = action.params.map((param) => param.value);
          const teamName = self.coerceScriptConditionString(params[0]);
          const allContained = actionTypeName === 'TEAM_WAIT_FOR_NOT_CONTAINED_ALL';
          if (!self.executeScriptTeamWaitForNotContained(teamName, allContained)) {
            seqScript.dontAdvanceInstruction = true;
          }
        } else {
          self.executeMapScriptAction(action);
        }

        self.scriptConditionTeamNameUpper = previousConditionTeam;
        self.scriptConditionEntityId = previousConditionEntity;
        self.scriptCallingTeamNameUpper = previousCallingTeam;
        self.scriptCallingEntityId = previousCallingEntity;

        if (seqScript.dontAdvanceInstruction) {
          self.scriptCurrentPlayerSide = previousCurrentSide;
          index += 1;
          continue;
        }

        if (targetEntity && self.isScriptSequentialEntityIdle(targetEntity)) {
          itAdvanced = true;
        } else if (team && self.isScriptSequentialTeamIdle(team)) {
          itAdvanced = true;
        }

        if (itAdvanced) {
          if (targetEntity && targetEntity.destroyed) {
            self.cleanupSequentialScriptAt(index, true);
            self.scriptCurrentPlayerSide = previousCurrentSide;
            continue;
          }
          if (team && self.isScriptSequentialTeamDead(team)) {
            self.cleanupSequentialScriptAt(index, true);
            self.scriptCurrentPlayerSide = previousCurrentSide;
            continue;
          }
        }
      } else {
        if (seqScript.timesToLoop !== 0) {
          const timesToLoop = seqScript.timesToLoop === -1 ? -1 : seqScript.timesToLoop - 1;
          self.appendScriptSequentialScript({
            scriptNameUpper: seqScript.scriptNameUpper,
            objectId: seqScript.objectId,
            teamNameUpper: seqScript.teamNameUpper,
            currentInstruction: -1,
            timesToLoop,
            framesToWait: -1,
            dontAdvanceInstruction: false,
            nextScript: null,
          });
        }
        self.cleanupSequentialScriptAt(index, false);
        self.scriptCurrentPlayerSide = previousCurrentSide;
        continue;
      }
    } else if (seqScript.framesToWait > 0) {
      seqScript.framesToWait -= 1;
    }

    self.scriptCurrentPlayerSide = previousCurrentSide;

    if (!itAdvanced) {
      index += 1;
    }
  }
}

export function updateScriptWanderInPlace(self: GL): void {
  for (const entity of self.spawnedEntities.values()) {
    if (entity.destroyed || !entity.scriptWanderInPlaceActive) continue;
    if (!entity.canMove || self.isEntityDisabledForMovement(entity)) continue;
    if (entity.attackTargetEntityId !== null || entity.guardState !== 'NONE') continue;
    if (entity.moving && entity.moveTarget !== null) continue;

    // Source parity: AI_WANDER_IN_PLACE transitions to AI_MOVE_AWAY_FROM_REPULSORS
    // for CAN_BE_REPULSED units when repulsors are nearby.
    if (entity.kindOf.has('CAN_BE_REPULSED')) {
      const repulsor = self.findClosestRepulsorEntity(entity, entity.visionRange);
      if (repulsor) {
        if (entity.locomotorSets.has(LOCOMOTORSET_PANIC)) {
          self.setEntityLocomotorSet(entity.id, LOCOMOTORSET_PANIC);
        }
        entity.modelConditionFlags.add('PANICKING');
        self.setScriptWanderAwayFromRepulsorGoal(entity, repulsor);
        continue;
      }
      entity.modelConditionFlags.delete('PANICKING');
      if (entity.activeLocomotorSet === LOCOMOTORSET_PANIC && entity.locomotorSets.has(LOCOMOTORSET_WANDER)) {
        self.setEntityLocomotorSet(entity.id, LOCOMOTORSET_WANDER);
      }
    }

    self.setScriptWanderInPlaceGoal(entity);
  }
}
