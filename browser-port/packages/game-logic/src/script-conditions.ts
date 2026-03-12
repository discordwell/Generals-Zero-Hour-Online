// @ts-nocheck — self is typed as any; real safety comes from the test suite.
/**
 * Script condition evaluators — extracted from GameLogicSubsystem.
 *
 * Source parity: ScriptEngine condition evaluation.
 * C++ reference: ScriptConditions.cpp
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type GL = any;

import { findCommandButtonDefByName, findUpgradeDefByName } from './registry-lookups.js';
import { readStringField } from './ini-readers.js';

// ---- Script condition implementations ----

export function evaluateScriptCondition(self: GL, condition: unknown): boolean {
  if (!condition || typeof condition !== 'object') {
    return false;
  }

  const conditionRecord = condition as Record<string, unknown>;
  const conditionType = self.resolveScriptConditionTypeName(
    conditionRecord.conditionType ?? conditionRecord.type,
  );
  if (!conditionType) {
    return false;
  }

  const { paramsObject, paramsArray } = self.resolveScriptConditionParams(conditionRecord);
  const conditionCacheId = self.resolveScriptConditionCacheId(conditionRecord, paramsObject);

  const readValue = (index: number, keyNames: readonly string[] = []): unknown =>
    self.resolveScriptConditionParamValue(conditionRecord, paramsObject, paramsArray, index, keyNames);
  const readString = (index: number, keyNames: readonly string[] = []): string =>
    self.coerceScriptConditionString(readValue(index, keyNames));
  const readNumber = (index: number, keyNames: readonly string[] = []): number =>
    self.coerceScriptConditionNumber(readValue(index, keyNames)) ?? 0;
  const readInteger = (index: number, keyNames: readonly string[] = []): number =>
    Math.trunc(readNumber(index, keyNames));
  const readEntityId = (index: number, keyNames: readonly string[] = []): number | null =>
    self.resolveScriptEntityIdForCondition(readValue(index, keyNames));
  const readOptionalEntityId = (
    index: number,
    keyNames: readonly string[] = [],
  ): number | undefined => {
    const value = readValue(index, keyNames);
    if (value === undefined) {
      return undefined;
    }
    const resolved = self.resolveScriptEntityIdForCondition(value);
    if (resolved !== null) {
      return resolved;
    }
    const fallback = self.coerceScriptConditionNumber(value);
    return fallback === null ? Number.NaN : Math.trunc(fallback);
  };
  const readEntityRef = (index: number, keyNames: readonly string[] = []): {
    entityId: number | null;
    didExist: boolean;
  } => self.resolveScriptEntityConditionRef(readValue(index, keyNames));
  const readBoolean = (
    index: number,
    keyNames: readonly string[] = [],
    defaultValue = false,
  ): boolean => self.coerceScriptConditionBoolean(readValue(index, keyNames), defaultValue);
  const readOptionalInteger = (
    index: number,
    keyNames: readonly string[] = [],
  ): number | undefined => {
    const value = self.coerceScriptConditionNumber(readValue(index, keyNames));
    return value === null ? undefined : Math.trunc(value);
  };
  const readComparison = (
    index: number,
    keyNames: readonly string[] = [],
  ): ScriptComparisonInput => {
    const value = readValue(index, keyNames);
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Math.trunc(value);
    }
    return self.coerceScriptConditionString(value) as ScriptComparisonType;
  };
  const readRelationship = (
    index: number,
    keyNames: readonly string[] = [],
  ): ScriptRelationshipInput => {
    const value = readValue(index, keyNames);
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Math.trunc(value);
    }
    return self.coerceScriptConditionString(value) as ScriptRelationshipInput;
  };

  switch (conditionType) {
    case 'CONDITION_FALSE':
      return false;
    case 'CONDITION_TRUE':
      return true;
    case 'COUNTER':
      return evaluateScriptCounterCondition(self, {
        counterName: readString(0, ['counterName', 'counter']),
        comparison: readComparison(1, ['comparison']),
        value: readInteger(2, ['value']),
      });
    case 'FLAG':
      return evaluateScriptFlagCondition(self, {
        flagName: readString(0, ['flagName', 'flag']),
        value: readBoolean(1, ['value']),
      });
    case 'TIMER_EXPIRED':
      return evaluateScriptTimerExpired(self, {
        counterName: readString(0, ['counterName', 'counter']),
      });

    case 'PLAYER_ALL_DESTROYED':
      return self.evaluateScriptAllDestroyed({
        side: readString(0, ['side', 'playerName', 'player']),
      });
    case 'PLAYER_ALL_BUILDFACILITIES_DESTROYED':
      return self.evaluateScriptAllBuildFacilitiesDestroyed({
        side: readString(0, ['side', 'playerName', 'player']),
      });
    case 'TEAM_INSIDE_AREA_PARTIALLY':
      return self.evaluateScriptTeamInsideAreaPartially({
        teamName: readString(0, ['teamName', 'team']),
        triggerName: readString(1, ['triggerName', 'trigger']),
        surfacesAllowed: readOptionalInteger(2, ['surfacesAllowed']),
      });
    case 'TEAM_DESTROYED':
      return self.evaluateScriptIsDestroyed({
        teamName: readString(0, ['teamName', 'team']),
      });
    case 'CAMERA_MOVEMENT_FINISHED':
      return self.evaluateScriptCameraMovementFinished();
    case 'TEAM_HAS_UNITS':
      return self.evaluateScriptHasUnits({
        teamName: readString(0, ['teamName', 'team']),
      });
    case 'TEAM_STATE_IS':
      return self.evaluateScriptTeamStateIs({
        teamName: readString(0, ['teamName', 'team']),
        stateName: readString(1, ['stateName', 'state']),
      });
    case 'TEAM_STATE_IS_NOT':
      return self.evaluateScriptTeamStateIsNot({
        teamName: readString(0, ['teamName', 'team']),
        stateName: readString(1, ['stateName', 'state']),
      });
    case 'NAMED_INSIDE_AREA': {
      const entityId = readEntityId(0, ['entityId']);
      if (entityId === null) {
        return false;
      }
      return self.evaluateScriptNamedInsideArea({
        entityId,
        triggerName: readString(1, ['triggerName', 'trigger']),
      });
    }
    case 'NAMED_OUTSIDE_AREA': {
      const entityId = readEntityId(0, ['entityId']);
      if (entityId === null) {
        return false;
      }
      return self.evaluateScriptNamedOutsideArea({
        entityId,
        triggerName: readString(1, ['triggerName', 'trigger']),
      });
    }
    case 'NAMED_DESTROYED': {
      const entityRef = readEntityRef(0, ['entityId']);
      if (entityRef.entityId !== null) {
        return self.evaluateScriptNamedUnitDestroyed({ entityId: entityRef.entityId });
      }
      return entityRef.didExist;
    }
    case 'NAMED_NOT_DESTROYED': {
      const entityId = readEntityId(0, ['entityId']);
      if (entityId === null) {
        return false;
      }
      return self.evaluateScriptNamedUnitExists({ entityId });
    }
    case 'TEAM_INSIDE_AREA_ENTIRELY':
      return self.evaluateScriptTeamInsideAreaEntirely({
        teamName: readString(0, ['teamName', 'team']),
        triggerName: readString(1, ['triggerName', 'trigger']),
        surfacesAllowed: readOptionalInteger(2, ['surfacesAllowed']),
      });
    case 'TEAM_OUTSIDE_AREA_ENTIRELY':
      return self.evaluateScriptTeamOutsideAreaEntirely({
        teamName: readString(0, ['teamName', 'team']),
        triggerName: readString(1, ['triggerName', 'trigger']),
        surfacesAllowed: readOptionalInteger(2, ['surfacesAllowed']),
      });
    case 'NAMED_ATTACKED_BY_OBJECTTYPE': {
      const entityId = readEntityId(0, ['entityId']);
      if (entityId === null) {
        return false;
      }
      return self.evaluateScriptNamedAttackedByType({
        entityId,
        objectType: readString(1, ['objectType', 'templateName', 'unitType']),
      });
    }
    case 'TEAM_ATTACKED_BY_OBJECTTYPE':
      return self.evaluateScriptTeamAttackedByType({
        teamName: readString(0, ['teamName', 'team']),
        objectType: readString(1, ['objectType', 'templateName', 'unitType']),
      });
    case 'NAMED_ATTACKED_BY_PLAYER': {
      const entityId = readEntityId(0, ['entityId']);
      if (entityId === null) {
        return false;
      }
      return self.evaluateScriptNamedAttackedByPlayer({
        entityId,
        attackedBySide: readString(1, ['attackedBySide', 'side', 'playerName', 'player']),
      });
    }
    case 'TEAM_ATTACKED_BY_PLAYER':
      return self.evaluateScriptTeamAttackedByPlayer({
        teamName: readString(0, ['teamName', 'team']),
        attackedBySide: readString(1, ['attackedBySide', 'side', 'playerName', 'player']),
      });
    case 'BUILT_BY_PLAYER':
      return self.evaluateScriptBuiltByPlayer({
        templateName: readString(0, ['templateName', 'objectType', 'unitType']),
        side: readString(1, ['side', 'playerName', 'player']),
        conditionCacheId,
      });
    case 'NAMED_CREATED': {
      const entityId = readEntityId(0, ['entityId']);
      if (entityId === null) {
        return false;
      }
      return self.evaluateScriptNamedCreated({ entityId });
    }
    case 'TEAM_CREATED':
      return self.evaluateScriptTeamCreated({
        teamName: readString(0, ['teamName', 'team']),
      });
    case 'PLAYER_HAS_CREDITS':
      return self.evaluateScriptPlayerHasCredits({
        credits: readNumber(0, ['credits']),
        comparison: readComparison(1, ['comparison']),
        side: readString(2, ['side', 'playerName', 'player']),
      });
    case 'NAMED_DISCOVERED': {
      const entityId = readEntityId(0, ['entityId']);
      if (entityId === null) {
        return false;
      }
      return self.evaluateScriptNamedDiscovered({
        entityId,
        side: readString(1, ['side', 'playerName', 'player']),
      });
    }
    case 'TEAM_DISCOVERED':
      return self.evaluateScriptTeamDiscovered({
        teamName: readString(0, ['teamName', 'team']),
        side: readString(1, ['side', 'playerName', 'player']),
      });
    case 'MISSION_ATTEMPTS':
      return self.evaluateScriptMissionAttempts({
        side: readString(0, ['side', 'playerName', 'player']),
        comparison: readComparison(1, ['comparison']),
        attempts: readInteger(2, ['attempts']),
      });
    case 'NAMED_OWNED_BY_PLAYER': {
      const entityId = readEntityId(0, ['entityId']);
      if (entityId === null) {
        return false;
      }
      return self.evaluateScriptNamedOwnedByPlayer({
        entityId,
        side: readString(1, ['side', 'playerName', 'player']),
      });
    }
    case 'TEAM_OWNED_BY_PLAYER':
      return self.evaluateScriptTeamOwnedByPlayer({
        teamName: readString(0, ['teamName', 'team']),
        side: readString(1, ['side', 'playerName', 'player']),
      });
    case 'PLAYER_HAS_N_OR_FEWER_BUILDINGS':
      return self.evaluateScriptPlayerHasNOrFewerBuildings({
        side: readString(0, ['side', 'playerName', 'player']),
        buildingCount: readInteger(1, ['buildingCount', 'count']),
      });
    case 'PLAYER_HAS_POWER':
      return self.evaluateScriptPlayerHasPower({
        side: readString(0, ['side', 'playerName', 'player']),
      });
    case 'PLAYER_HAS_NO_POWER':
      return !self.evaluateScriptPlayerHasPower({
        side: readString(0, ['side', 'playerName', 'player']),
      });
    case 'NAMED_REACHED_WAYPOINTS_END': {
      const entityId = readEntityId(0, ['entityId']);
      if (entityId === null) {
        return false;
      }
      return self.evaluateScriptNamedReachedWaypointsEnd({
        entityId,
        waypointPathName: readString(1, ['waypointPathName', 'waypointPath']),
      });
    }
    case 'TEAM_REACHED_WAYPOINTS_END':
      return self.evaluateScriptTeamReachedWaypointsEnd({
        teamName: readString(0, ['teamName', 'team']),
        waypointPathName: readString(1, ['waypointPathName', 'waypointPath']),
      });
    case 'NAMED_SELECTED': {
      const entityId = readEntityId(0, ['entityId']);
      if (entityId === null) {
        return false;
      }
      return self.evaluateScriptNamedSelected({ entityId, conditionCacheId });
    }
    case 'NAMED_ENTERED_AREA': {
      const entityId = readEntityId(0, ['entityId']);
      if (entityId === null) {
        return false;
      }
      return self.evaluateScriptNamedEnteredArea({
        entityId,
        triggerName: readString(1, ['triggerName', 'trigger']),
      });
    }
    case 'NAMED_EXITED_AREA': {
      const entityId = readEntityId(0, ['entityId']);
      if (entityId === null) {
        return false;
      }
      return self.evaluateScriptNamedExitedArea({
        entityId,
        triggerName: readString(1, ['triggerName', 'trigger']),
      });
    }
    case 'TEAM_ENTERED_AREA_ENTIRELY':
      return self.evaluateScriptTeamEnteredAreaEntirely({
        teamName: readString(0, ['teamName', 'team']),
        triggerName: readString(1, ['triggerName', 'trigger']),
        surfacesAllowed: readOptionalInteger(2, ['surfacesAllowed']),
      });
    case 'TEAM_ENTERED_AREA_PARTIALLY':
      return self.evaluateScriptTeamEnteredAreaPartially({
        teamName: readString(0, ['teamName', 'team']),
        triggerName: readString(1, ['triggerName', 'trigger']),
        surfacesAllowed: readOptionalInteger(2, ['surfacesAllowed']),
      });
    case 'TEAM_EXITED_AREA_ENTIRELY':
      return self.evaluateScriptTeamExitedAreaEntirely({
        teamName: readString(0, ['teamName', 'team']),
        triggerName: readString(1, ['triggerName', 'trigger']),
        surfacesAllowed: readOptionalInteger(2, ['surfacesAllowed']),
      });
    case 'TEAM_EXITED_AREA_PARTIALLY':
      return self.evaluateScriptTeamExitedAreaPartially({
        teamName: readString(0, ['teamName', 'team']),
        triggerName: readString(1, ['triggerName', 'trigger']),
        surfacesAllowed: readOptionalInteger(2, ['surfacesAllowed']),
      });
    case 'MULTIPLAYER_ALLIED_VICTORY':
      return self.evaluateScriptMultiplayerAlliedVictory();
    case 'MULTIPLAYER_ALLIED_DEFEAT':
      return self.evaluateScriptMultiplayerAlliedDefeat();
    case 'MULTIPLAYER_PLAYER_DEFEAT':
      return self.evaluateScriptMultiplayerPlayerDefeat();
    case 'HAS_FINISHED_VIDEO':
      return self.evaluateScriptVideoHasCompleted({
        videoName: readString(0, ['videoName']),
      });
    case 'HAS_FINISHED_SPEECH':
      return self.evaluateScriptSpeechHasCompleted({
        speechName: readString(0, ['speechName']),
      });
    case 'HAS_FINISHED_AUDIO':
      return self.evaluateScriptAudioHasCompleted({
        audioName: readString(0, ['audioName']),
      });
    case 'BUILDING_ENTERED_BY_PLAYER': {
      const entityId = readEntityId(0, ['entityId']);
      if (entityId === null) {
        return false;
      }
      return self.evaluateScriptBuildingEntered({
        entityId,
        side: readString(1, ['side', 'playerName', 'player']),
      });
    }
    case 'ENEMY_SIGHTED': {
      const entityId = readEntityId(0, ['entityId']);
      if (entityId === null) {
        return false;
      }
      return self.evaluateScriptEnemySighted({
        entityId,
        alliance: readRelationship(1, ['alliance']),
        side: readString(2, ['side', 'playerName', 'player']),
      });
    }
    case 'TYPE_SIGHTED': {
      const entityId = readEntityId(0, ['entityId']);
      if (entityId === null) {
        return false;
      }
      return self.evaluateScriptTypeSighted({
        entityId,
        objectType: readString(1, ['objectType', 'templateName', 'unitType']),
        side: readString(2, ['side', 'playerName', 'player']),
      });
    }
    case 'UNIT_HEALTH': {
      const entityId = readEntityId(0, ['entityId']);
      if (entityId === null) {
        return false;
      }
      return self.evaluateScriptUnitHealth({
        entityId,
        comparison: readComparison(1, ['comparison']),
        healthPercent: readNumber(2, ['healthPercent']),
      });
    }
    case 'BRIDGE_REPAIRED': {
      const entityId = readEntityId(0, ['entityId']);
      if (entityId === null) {
        return false;
      }
      return self.evaluateScriptBridgeRepaired({ entityId });
    }
    case 'BRIDGE_BROKEN': {
      const entityId = readEntityId(0, ['entityId']);
      if (entityId === null) {
        return false;
      }
      return self.evaluateScriptBridgeBroken({ entityId });
    }
    case 'NAMED_DYING': {
      const entityRef = readEntityRef(0, ['entityId']);
      if (entityRef.entityId === null) {
        return false;
      }
      return self.evaluateScriptNamedUnitDying({ entityId: entityRef.entityId });
    }
    case 'NAMED_TOTALLY_DEAD': {
      const entityRef = readEntityRef(0, ['entityId']);
      if (entityRef.entityId !== null) {
        return self.evaluateScriptNamedUnitTotallyDead({ entityId: entityRef.entityId });
      }
      return entityRef.didExist;
    }
    case 'PLAYER_HAS_OBJECT_COMPARISON':
      return evaluateScriptPlayerUnitCondition(self, {
        side: readString(0, ['side', 'playerName', 'player']),
        comparison: readComparison(1, ['comparison']),
        count: readInteger(2, ['count']),
        unitType: readString(3, ['unitType', 'objectType', 'templateName']),
        conditionCacheId,
      });
    case 'PLAYER_TRIGGERED_SPECIAL_POWER':
      return self.evaluateScriptPlayerSpecialPowerFromUnitTriggered({
        side: readString(0, ['side', 'playerName', 'player']),
        specialPowerName: readString(1, ['specialPowerName', 'specialPower']),
      });
    case 'PLAYER_TRIGGERED_SPECIAL_POWER_FROM_NAMED':
      return self.evaluateScriptPlayerSpecialPowerFromUnitTriggered({
        side: readString(0, ['side', 'playerName', 'player']),
        specialPowerName: readString(1, ['specialPowerName', 'specialPower']),
        sourceEntityId: readOptionalEntityId(2, ['sourceEntityId', 'entityId']),
      });
    case 'PLAYER_MIDWAY_SPECIAL_POWER':
      return self.evaluateScriptPlayerSpecialPowerFromUnitMidway({
        side: readString(0, ['side', 'playerName', 'player']),
        specialPowerName: readString(1, ['specialPowerName', 'specialPower']),
      });
    case 'PLAYER_MIDWAY_SPECIAL_POWER_FROM_NAMED':
      return self.evaluateScriptPlayerSpecialPowerFromUnitMidway({
        side: readString(0, ['side', 'playerName', 'player']),
        specialPowerName: readString(1, ['specialPowerName', 'specialPower']),
        sourceEntityId: readOptionalEntityId(2, ['sourceEntityId', 'entityId']),
      });
    case 'PLAYER_COMPLETED_SPECIAL_POWER':
      return self.evaluateScriptPlayerSpecialPowerFromUnitComplete({
        side: readString(0, ['side', 'playerName', 'player']),
        specialPowerName: readString(1, ['specialPowerName', 'specialPower']),
      });
    case 'PLAYER_COMPLETED_SPECIAL_POWER_FROM_NAMED':
      return self.evaluateScriptPlayerSpecialPowerFromUnitComplete({
        side: readString(0, ['side', 'playerName', 'player']),
        specialPowerName: readString(1, ['specialPowerName', 'specialPower']),
        sourceEntityId: readOptionalEntityId(2, ['sourceEntityId', 'entityId']),
      });
    case 'PLAYER_ACQUIRED_SCIENCE':
      return self.evaluateScriptScienceAcquired({
        side: readString(0, ['side', 'playerName', 'player']),
        scienceName: readString(1, ['scienceName']),
      });
    case 'PLAYER_CAN_PURCHASE_SCIENCE':
      return self.evaluateScriptCanPurchaseScience({
        side: readString(0, ['side', 'playerName', 'player']),
        scienceName: readString(1, ['scienceName']),
      });
    case 'PLAYER_HAS_SCIENCEPURCHASEPOINTS':
      return self.evaluateScriptSciencePurchasePoints({
        side: readString(0, ['side', 'playerName', 'player']),
        pointsNeeded: readNumber(1, ['pointsNeeded', 'sciencePurchasePoints']),
      });
    case 'NAMED_HAS_FREE_CONTAINER_SLOTS': {
      const entityId = readEntityId(0, ['entityId']);
      if (entityId === null) {
        return false;
      }
      return self.evaluateScriptNamedHasFreeContainerSlots({ entityId });
    }
    case 'PLAYER_BUILT_UPGRADE':
      return self.evaluateScriptUpgradeFromUnitComplete({
        side: readString(0, ['side', 'playerName', 'player']),
        upgradeName: readString(1, ['upgradeName', 'upgrade']),
      });
    case 'PLAYER_BUILT_UPGRADE_FROM_NAMED':
      return self.evaluateScriptUpgradeFromUnitComplete({
        side: readString(0, ['side', 'playerName', 'player']),
        upgradeName: readString(1, ['upgradeName', 'upgrade']),
        sourceEntityId: readOptionalEntityId(2, ['sourceEntityId', 'entityId']),
      });
    case 'DEFUNCT_PLAYER_SELECTED_GENERAL':
    case 'DEFUNCT_PLAYER_SELECTED_GENERAL_FROM_NAMED':
      return false;
    case 'PLAYER_DESTROYED_N_BUILDINGS_PLAYER':
      return self.evaluateScriptPlayerDestroyedNOrMoreBuildings({
        side: readString(0, ['side', 'playerName', 'player']),
        count: readInteger(1, ['count']),
        opponentSide: readString(2, ['opponentSide', 'side', 'playerName', 'player']),
      });
    case 'PLAYER_HAS_COMPARISON_UNIT_TYPE_IN_TRIGGER_AREA':
      return self.evaluateScriptPlayerHasUnitTypeInArea({
        side: readString(0, ['side', 'playerName', 'player']),
        comparison: readComparison(1, ['comparison']),
        count: readInteger(2, ['count']),
        templateName: readString(3, ['templateName', 'objectType', 'unitType']),
        triggerName: readString(4, ['triggerName', 'trigger']),
        conditionCacheId,
      });
    case 'PLAYER_HAS_COMPARISON_UNIT_KIND_IN_TRIGGER_AREA':
      return self.evaluateScriptPlayerHasUnitKindInArea({
        side: readString(0, ['side', 'playerName', 'player']),
        comparison: readComparison(1, ['comparison']),
        count: readInteger(2, ['count']),
        kindOf: readString(3, ['kindOf']),
        triggerName: readString(4, ['triggerName', 'trigger']),
        conditionCacheId,
      });
    case 'UNIT_EMPTIED': {
      const entityId = readEntityId(0, ['entityId']);
      if (entityId === null) {
        return false;
      }
      return self.evaluateScriptUnitHasEmptied({ entityId });
    }
    case 'NAMED_BUILDING_IS_EMPTY': {
      const entityId = readEntityId(0, ['entityId']);
      if (entityId === null) {
        return false;
      }
      return self.evaluateScriptIsBuildingEmpty({ entityId });
    }
    case 'PLAYER_HAS_N_OR_FEWER_FACTION_BUILDINGS':
      return self.evaluateScriptPlayerHasNOrFewerFactionBuildings({
        side: readString(0, ['side', 'playerName', 'player']),
        buildingCount: readInteger(1, ['buildingCount', 'count']),
      });
    case 'UNIT_HAS_OBJECT_STATUS': {
      const entityId = readEntityId(0, ['entityId']);
      if (entityId === null) {
        return false;
      }
      return self.evaluateScriptUnitHasObjectStatus({
        entityId,
        objectStatus: readString(1, ['objectStatus']),
      });
    }
    case 'TEAM_ALL_HAS_OBJECT_STATUS':
      return self.evaluateScriptTeamHasObjectStatus({
        teamName: readString(0, ['teamName', 'team']),
        objectStatus: readString(1, ['objectStatus']),
        entireTeam: true,
      });
    case 'TEAM_SOME_HAVE_OBJECT_STATUS':
      return self.evaluateScriptTeamHasObjectStatus({
        teamName: readString(0, ['teamName', 'team']),
        objectStatus: readString(1, ['objectStatus']),
        entireTeam: false,
      });
    case 'PLAYER_POWER_COMPARE_PERCENT':
      return self.evaluateScriptPlayerHasComparisonPercentPower({
        side: readString(0, ['side', 'playerName', 'player']),
        comparison: readComparison(1, ['comparison']),
        percent: readNumber(2, ['percent']),
      });
    case 'PLAYER_EXCESS_POWER_COMPARE_VALUE':
      return self.evaluateScriptPlayerHasComparisonValueExcessPower({
        side: readString(0, ['side', 'playerName', 'player']),
        comparison: readComparison(1, ['comparison']),
        kilowatts: readNumber(2, ['kilowatts']),
      });
    case 'SKIRMISH_SPECIAL_POWER_READY':
      return self.evaluateScriptSkirmishSpecialPowerIsReady({
        side: readString(0, ['side', 'playerName', 'player']),
        specialPowerName: readString(1, ['specialPowerName', 'specialPower']),
        conditionCacheId,
      });
    case 'SKIRMISH_VALUE_IN_AREA':
      return self.evaluateScriptSkirmishValueInArea({
        side: readString(0, ['side', 'playerName', 'player']),
        comparison: readComparison(1, ['comparison']),
        money: readInteger(2, ['money', 'value']),
        triggerName: readString(3, ['triggerName', 'trigger']),
        conditionCacheId,
      });
    case 'SKIRMISH_PLAYER_FACTION':
      return self.evaluateScriptSkirmishPlayerIsFaction({
        side: readString(0, ['side', 'playerName', 'player']),
        factionName: readString(1, ['factionName', 'faction']),
      });
    case 'SKIRMISH_SUPPLIES_VALUE_WITHIN_DISTANCE':
      return self.evaluateScriptSkirmishSuppliesWithinDistancePerimeter({
        side: readString(0, ['side', 'playerName', 'player']),
        distance: readNumber(1, ['distance']),
        triggerName: readString(2, ['triggerName', 'trigger']),
        value: readInteger(3, ['value']),
      });
    case 'SKIRMISH_TECH_BUILDING_WITHIN_DISTANCE':
      return self.evaluateScriptSkirmishPlayerTechBuildingWithinDistancePerimeter({
        side: readString(0, ['side', 'playerName', 'player']),
        distance: readNumber(1, ['distance']),
        triggerName: readString(2, ['triggerName', 'trigger']),
        conditionCacheId,
      });
    case 'SKIRMISH_COMMAND_BUTTON_READY_ALL':
      return self.evaluateScriptSkirmishCommandButtonIsReady({
        side: readString(0, ['side', 'playerName', 'player']),
        teamName: readString(1, ['teamName', 'team']),
        commandButtonName: readString(2, ['commandButtonName', 'commandButton']),
        allReady: true,
      });
    case 'SKIRMISH_COMMAND_BUTTON_READY_PARTIAL':
      return self.evaluateScriptSkirmishCommandButtonIsReady({
        side: readString(0, ['side', 'playerName', 'player']),
        teamName: readString(1, ['teamName', 'team']),
        commandButtonName: readString(2, ['commandButtonName', 'commandButton']),
        allReady: false,
      });
    case 'SKIRMISH_UNOWNED_FACTION_UNIT_EXISTS':
      return self.evaluateScriptSkirmishUnownedFactionUnitComparison({
        comparison: readComparison(1, ['comparison']),
        count: readInteger(2, ['count']),
      });
    case 'SKIRMISH_PLAYER_HAS_PREREQUISITE_TO_BUILD':
      return self.evaluateScriptSkirmishPlayerHasPrereqsToBuild({
        side: readString(0, ['side', 'playerName', 'player']),
        templateName: readString(1, ['templateName', 'objectType', 'unitType']),
      });
    case 'SKIRMISH_PLAYER_HAS_COMPARISON_GARRISONED':
      return self.evaluateScriptSkirmishPlayerHasComparisonGarrisoned({
        side: readString(0, ['side', 'playerName', 'player']),
        comparison: readComparison(1, ['comparison']),
        count: readInteger(2, ['count']),
      });
    case 'SKIRMISH_PLAYER_HAS_COMPARISON_CAPTURED_UNITS':
      return self.evaluateScriptSkirmishPlayerHasComparisonCapturedUnits({
        side: readString(0, ['side', 'playerName', 'player']),
        comparison: readComparison(1, ['comparison']),
        count: readInteger(2, ['count']),
      });
    case 'SKIRMISH_NAMED_AREA_EXIST':
      return self.evaluateScriptSkirmishNamedAreaExists(
        readString(1, ['triggerName', 'trigger']),
      );
    case 'SKIRMISH_PLAYER_HAS_UNITS_IN_AREA':
      return self.evaluateScriptSkirmishPlayerHasUnitsInArea({
        side: readString(0, ['side', 'playerName', 'player']),
        triggerName: readString(1, ['triggerName', 'trigger']),
        conditionCacheId,
      });
    case 'SKIRMISH_PLAYER_HAS_BEEN_ATTACKED_BY_PLAYER':
      return self.evaluateScriptSkirmishPlayerHasBeenAttackedByPlayer({
        side: readString(0, ['side', 'playerName', 'player']),
        attackedBySide: readString(1, ['attackedBySide', 'side', 'playerName', 'player']),
      });
    case 'SKIRMISH_PLAYER_IS_OUTSIDE_AREA':
      return self.evaluateScriptSkirmishPlayerIsOutsideArea({
        side: readString(0, ['side', 'playerName', 'player']),
        triggerName: readString(1, ['triggerName', 'trigger']),
        conditionCacheId,
      });
    case 'SKIRMISH_PLAYER_HAS_DISCOVERED_PLAYER':
      return self.evaluateScriptSkirmishPlayerHasDiscoveredPlayer({
        side: readString(0, ['side', 'playerName', 'player']),
        discoveredBySide: readString(1, ['discoveredBySide', 'side', 'playerName', 'player']),
      });
    case 'MUSIC_TRACK_HAS_COMPLETED':
      return self.evaluateScriptMusicHasCompleted({
        musicName: readString(0, ['musicName']),
        index: readInteger(1, ['index']),
      });
    case 'PLAYER_LOST_OBJECT_TYPE':
      return self.evaluateScriptPlayerLostObjectType({
        side: readString(0, ['side', 'playerName', 'player']),
        templateName: readString(1, ['templateName', 'objectType', 'unitType']),
      });
    case 'SUPPLY_SOURCE_SAFE':
      return self.evaluateScriptSkirmishSupplySourceSafe({
        side: readString(0, ['side', 'playerName', 'player']),
        minSupplyAmount: readNumber(1, ['minSupplyAmount', 'supplyAmount']),
        conditionCacheId,
      });
    case 'SUPPLY_SOURCE_ATTACKED':
      return self.evaluateScriptSkirmishSupplySourceAttacked({
        side: readString(0, ['side', 'playerName', 'player']),
      });
    case 'START_POSITION_IS':
      return self.evaluateScriptSkirmishStartPosition({
        side: readString(0, ['side', 'playerName', 'player']),
        startPosition: readInteger(1, ['startPosition']),
      });
    case 'OBSOLETE_SCRIPT_1':
    case 'OBSOLETE_SCRIPT_2':
    case 'UNIT_COMPLETED_SEQUENTIAL_EXECUTION':
    case 'TEAM_COMPLETED_SEQUENTIAL_EXECUTION':
      // Source parity: these condition handlers are unimplemented in C++ and return FALSE.
      return false;

    default:
      return false;
  }
}

export function evaluateScriptTeamCommandButtonIsReady(self: GL, 
  team: ScriptTeamRecord,
  commandButtonName: string,
  allReady: boolean,
): boolean {
  const registry = self.iniDataRegistry;
  if (!registry) {
    return false;
  }

  const commandButtonDef = findCommandButtonDefByName(registry, commandButtonName);
  if (!commandButtonDef) {
    return false;
  }

  const specialPowerName = self.normalizeShortcutSpecialPowerName(
    readStringField(commandButtonDef.fields, ['SpecialPower'])
    ?? readStringField(commandButtonDef.fields, ['SpecialPowerTemplate'])
    ?? '',
  );
  const upgradeName = readStringField(commandButtonDef.fields, ['Upgrade'])?.trim().toUpperCase() ?? '';
  const upgradeDef = upgradeName ? findUpgradeDefByName(registry, upgradeName) ?? null : null;

  if (!specialPowerName && !upgradeDef) {
    return false;
  }

  for (const entity of self.getScriptTeamMemberEntities(team)) {
    if (entity.destroyed) {
      continue;
    }

    let ready: boolean | null = null;
    if (specialPowerName) {
      ready = self.evaluateScriptCommandButtonSpecialPowerReady(entity, specialPowerName);
    } else if (upgradeDef) {
      ready = self.evaluateScriptCommandButtonUpgradeReady(entity, upgradeDef);
    }

    if (ready === null) {
      continue;
    }

    if (ready) {
      if (!allReady) {
        return true;
      }
    } else if (allReady) {
      return false;
    }
  }

  return allReady;
}

export function evaluateScriptSingleTeamIsContained(self: GL, team: ScriptTeamRecord, allContained: boolean): boolean {
  let anyConsidered = false;
  for (const entity of self.getScriptTeamMemberEntities(team)) {
    const isContained = self.isEntityContained(entity);
    if (isContained) {
      if (!allContained) {
        return true;
      }
    } else if (allContained) {
      return false;
    }
    anyConsidered = true;
  }
  if (!anyConsidered) {
    return false;
  }
  return allContained;
}

export function evaluateScriptSingleTeamHasObjectStatus(self: GL, 
  team: ScriptTeamRecord,
  statusMask: number | null,
  statusTokens: readonly string[],
  entireTeam: boolean,
): boolean {
  for (const entity of self.getScriptTeamMemberEntities(team)) {
    const hasStatus = (
      (statusMask !== null && statusMask !== 0 && self.entityHasAnyStatusMask(entity, statusMask))
      || statusTokens.some((token) => self.entityHasObjectStatus(entity, token))
    );
    if (entireTeam && !hasStatus) {
      return false;
    }
    if (!entireTeam && hasStatus) {
      return true;
    }
  }
  return entireTeam;
}

export function evaluateScriptSingleTeamInsideAreaEntirely(self: GL, 
  team: ScriptTeamRecord,
  triggerIndex: number,
  surfacesAllowed: number | undefined,
): boolean {
  let anyConsidered = false;
  let anyOutside = false;
  for (const entity of self.getScriptTeamMemberEntities(team)) {
    if (!self.doesScriptSurfaceMaskMatchEntity(entity, surfacesAllowed)) {
      continue;
    }
    if (self.isScriptEntityEffectivelyDead(entity)) {
      continue;
    }
    if (entity.kindOf.has('INERT')) {
      continue;
    }

    if (!self.isScriptTeamMemberInsideTrigger(entity.id, triggerIndex)) {
      anyOutside = true;
    }
    anyConsidered = true;
  }

  return anyConsidered && !anyOutside;
}

export function evaluateScriptSingleTeamInsideAreaPartially(self: GL, 
  team: ScriptTeamRecord,
  triggerIndex: number,
  surfacesAllowed: number | undefined,
): boolean {
  let anyConsidered = false;
  let anyInside = false;
  let anyOutside = false;
  for (const entity of self.getScriptTeamMemberEntities(team)) {
    if (!self.doesScriptSurfaceMaskMatchEntity(entity, surfacesAllowed)) {
      continue;
    }
    if (self.isScriptEntityEffectivelyDead(entity)) {
      continue;
    }
    if (entity.kindOf.has('INERT')) {
      continue;
    }

    if (self.isScriptTeamMemberInsideTrigger(entity.id, triggerIndex)) {
      anyInside = true;
    } else {
      anyOutside = true;
    }
    anyConsidered = true;
  }

  const someInsideSomeOutside = anyConsidered && anyInside && anyOutside;
  const allInside = anyConsidered && !anyOutside;
  return someInsideSomeOutside || allInside;
}

export function evaluateScriptSingleTeamEnteredAreaEntirely(self: GL, 
  team: ScriptTeamRecord,
  triggerIndex: number,
  surfacesAllowed: number | undefined,
): boolean {
  if (!self.didScriptTeamMemberEnterOrExitThisFrame(team)) {
    return false;
  }

  let entered = false;
  let outside = false;
  for (const entity of self.getScriptTeamMemberEntities(team)) {
    if (!self.doesScriptSurfaceMaskMatchEntity(entity, surfacesAllowed)) {
      continue;
    }
    if (self.isScriptEntityEffectivelyDead(entity)) {
      continue;
    }
    if (entity.kindOf.has('INERT')) {
      continue;
    }

    if (self.didScriptTeamMemberEnterTrigger(entity.id, triggerIndex)) {
      entered = true;
    } else if (!self.isScriptTeamMemberInsideTrigger(entity.id, triggerIndex)) {
      outside = true;
    }
  }

  return entered && !outside;
}

export function evaluateScriptSingleTeamEnteredAreaPartially(self: GL, 
  team: ScriptTeamRecord,
  triggerIndex: number,
  surfacesAllowed: number | undefined,
): boolean {
  if (!self.didScriptTeamMemberEnterOrExitThisFrame(team)) {
    return false;
  }

  for (const entity of self.getScriptTeamMemberEntities(team)) {
    if (!self.doesScriptSurfaceMaskMatchEntity(entity, surfacesAllowed)) {
      continue;
    }
    if (self.isScriptEntityEffectivelyDead(entity)) {
      continue;
    }
    if (entity.kindOf.has('INERT')) {
      continue;
    }
    if (self.didScriptTeamMemberEnterTrigger(entity.id, triggerIndex)) {
      return true;
    }
  }
  return false;
}

export function evaluateScriptSingleTeamExitedAreaEntirely(self: GL, 
  team: ScriptTeamRecord,
  triggerIndex: number,
  surfacesAllowed: number | undefined,
): boolean {
  if (!self.didScriptTeamMemberEnterOrExitThisFrame(team)) {
    return false;
  }

  let anyConsidered = false;
  let exited = false;
  let inside = false;
  for (const entity of self.getScriptTeamMemberEntities(team)) {
    if (!self.doesScriptSurfaceMaskMatchEntity(entity, surfacesAllowed)) {
      continue;
    }
    if (self.isScriptEntityEffectivelyDead(entity)) {
      continue;
    }
    if (entity.kindOf.has('INERT')) {
      continue;
    }

    if (self.didScriptTeamMemberExitTrigger(entity.id, triggerIndex)) {
      exited = true;
    } else if (self.isScriptTeamMemberInsideTrigger(entity.id, triggerIndex)) {
      inside = true;
    }
    anyConsidered = true;
  }

  return anyConsidered && exited && !inside;
}

export function evaluateScriptSingleTeamExitedAreaPartially(self: GL, 
  team: ScriptTeamRecord,
  triggerIndex: number,
  surfacesAllowed: number | undefined,
): boolean {
  if (!self.didScriptTeamMemberEnterOrExitThisFrame(team)) {
    return false;
  }

  for (const entity of self.getScriptTeamMemberEntities(team)) {
    if (!self.doesScriptSurfaceMaskMatchEntity(entity, surfacesAllowed)) {
      continue;
    }
    if (self.isScriptEntityEffectivelyDead(entity)) {
      continue;
    }
    if (entity.kindOf.has('INERT')) {
      continue;
    }
    if (self.didScriptTeamMemberExitTrigger(entity.id, triggerIndex)) {
      return true;
    }
  }
  return false;
}

export function evaluateScriptTeamCommandButtonReadinessByName(self: GL, 
  teamName: string,
  commandButtonName: string,
  allReady: boolean,
): boolean {
  const team = self.getScriptTeamRecord(teamName);
  if (!team) {
    return false;
  }
  return evaluateScriptTeamCommandButtonIsReady(self, team, commandButtonName, allReady);
}

export function evaluateScriptPlayerUnitCondition(self: GL, filter: {
  side: string;
  comparison: ScriptComparisonInput;
  count: number;
  unitType: string;
  conditionCacheId?: string;
}): boolean {
  return self.evaluateScriptPlayerHasObjectComparison({
    side: filter.side,
    comparison: filter.comparison,
    count: filter.count,
    templateName: filter.unitType,
    conditionCacheId: filter.conditionCacheId,
  });
}

export function evaluateScriptCounterCondition(self: GL, filter: {
  counterName: string;
  comparison: ScriptComparisonInput;
  value: number;
}): boolean {
  const counter = self.getOrCreateScriptCounter(filter.counterName);
  if (!counter) {
    return false;
  }
  return self.compareScriptCount(filter.comparison, counter.value, filter.value);
}

export function evaluateScriptFlagCondition(self: GL, filter: {
  flagName: string;
  value: boolean;
}): boolean {
  const normalizedName = self.normalizeScriptVariableName(filter.flagName);
  if (!normalizedName) {
    return false;
  }

  const currentValue = self.scriptFlagsByName.get(normalizedName) ?? false;
  if (currentValue === filter.value) {
    return true;
  }

  // Source parity: shell/UI hooks are one-frame flag satisfiers.
  return self.scriptUIInteractions.has(normalizedName);
}

export function evaluateScriptTimerExpired(self: GL, filter: {
  counterName: string;
}): boolean {
  const counter = self.getOrCreateScriptCounter(filter.counterName);
  if (!counter || !counter.isCountdownTimer) {
    return false;
  }
  return counter.value < 1;
}
