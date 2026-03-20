import type { AudioManager } from '@generals/audio';
import {
  GuardMode,
  type GameLogicCommand,
  type GameLogicSubsystem,
} from '@generals/game-logic';
import { type CommandButtonDef, type IniDataRegistry } from '@generals/ini-data';
import {
  COMMAND_OPTION_NEED_OBJECT_TARGET,
  CommandOption,
  GUICommandType,
  type IssuedControlBarCommand,
  type UiRuntime,
} from '@generals/ui';

import { playIssuedCommandAudio } from './control-bar-audio.js';
import {
  isObjectTargetAllowedForSelection,
  isObjectTargetRelationshipAllowed,
} from './control-bar-targeting.js';

const SOURCE_DEFAULT_MAX_SHOTS_TO_FIRE = 0x7fffffff;

type ControlBarDispatchGameLogic = Pick<
  GameLogicSubsystem,
  | 'getSelectedEntityId'
  | 'getEntityWorldPosition'
  | 'getAttackMoveDistanceForEntity'
  | 'getEntityIdsByTemplateAndSide'
  | 'getPlayerSide'
  | 'getEntityRelationship'
  | 'getProductionState'
  | 'getLocalPlayerSciencePurchasePoints'
  | 'getLocalPlayerDisabledScienceNames'
  | 'getLocalPlayerHiddenScienceNames'
  | 'getLocalPlayerScienceNames'
  | 'resolveShortcutSpecialPowerSourceEntityId'
  | 'resolveCommandCenterEntityId'
  | 'submitCommand'
>;

type ControlBarDispatchUiRuntime = Pick<UiRuntime, 'showMessage'>;

export interface UnsupportedControlBarCommandRoute {
  sourceButtonId: string;
  commandType: GUICommandType;
  commandName: string;
  selectedEntityCount: number;
  hasObjectTarget: boolean;
  hasPositionTarget: boolean;
}

function flattenIniValueTokens(value: unknown): string[] {
  if (typeof value === 'string') {
    return value
      .split(/[\s,;|]+/)
      .map((token) => token.trim())
      .filter(Boolean);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return [String(value)];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => flattenIniValueTokens(entry));
  }
  return [];
}

function firstIniToken(value: unknown): string | null {
  const tokens = flattenIniValueTokens(value);
  return tokens[0] ?? null;
}

function resolveSourceCommandButton(
  iniDataRegistry: IniDataRegistry,
  command: IssuedControlBarCommand,
): CommandButtonDef | undefined {
  return iniDataRegistry.getCommandButton(command.sourceButtonId);
}

function resolveSelectedEntityIds(
  command: IssuedControlBarCommand,
  gameLogic: ControlBarDispatchGameLogic,
): number[] {
  if (command.selectedObjectIds.length > 0) {
    return [...command.selectedObjectIds];
  }
  const selectedEntityId = gameLogic.getSelectedEntityId();
  return selectedEntityId === null ? [] : [selectedEntityId];
}

function submitCommandForSelectedEntities(
  selectedEntityIds: readonly number[],
  commandFactory: (entityId: number) => GameLogicCommand,
  gameLogic: ControlBarDispatchGameLogic,
): void {
  for (const entityId of selectedEntityIds) {
    gameLogic.submitCommand(commandFactory(entityId));
  }
}

function resolveRequiredCommandButtonToken(
  commandButton: CommandButtonDef | undefined,
  fieldName: string,
): string | null {
  if (!commandButton) {
    return null;
  }
  return firstIniToken(commandButton.fields[fieldName]);
}

function resolveWeaponSlotFromCommandButton(
  commandButton: CommandButtonDef | undefined,
): number | null {
  const token = resolveRequiredCommandButtonToken(commandButton, 'WeaponSlot');
  if (!token) {
    return null;
  }

  const normalized = token.trim().toUpperCase();
  switch (normalized) {
    case 'PRIMARY':
    case 'PRIMARY_WEAPON':
      return 0;
    case 'SECONDARY':
    case 'SECONDARY_WEAPON':
      return 1;
    case 'TERTIARY':
    case 'TERTIARY_WEAPON':
      return 2;
  }

  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    return null;
  }
  if (parsed < 0 || parsed > 2) {
    return null;
  }

  return parsed;
}

function resolveMaxShotsToFireFromCommandButton(
  commandButton: CommandButtonDef | undefined,
): number {
  const maxShotsToFire = resolveRequiredCommandButtonToken(commandButton, 'MaxShotsToFire');
  if (!maxShotsToFire) {
    return SOURCE_DEFAULT_MAX_SHOTS_TO_FIRE;
  }
  const parsed = Number.parseInt(maxShotsToFire, 10);
  if (!Number.isFinite(parsed)) {
    return SOURCE_DEFAULT_MAX_SHOTS_TO_FIRE;
  }
  return parsed;
}

function guardModeForCommandType(commandType: GUICommandType): GuardMode {
  switch (commandType) {
    case GUICommandType.GUI_COMMAND_GUARD_WITHOUT_PURSUIT:
      return GuardMode.GUARDMODE_GUARD_WITHOUT_PURSUIT;
    case GUICommandType.GUI_COMMAND_GUARD_FLYING_UNITS_ONLY:
      return GuardMode.GUARDMODE_GUARD_FLYING_UNITS_ONLY;
    case GUICommandType.GUI_COMMAND_GUARD:
    default:
      return GuardMode.GUARDMODE_NORMAL;
  }
}

function normalizeTokenSet(tokens: readonly string[]): Set<string> {
  const normalized = new Set<string>();
  for (const token of tokens) {
    const normalizedToken = token.trim().toUpperCase();
    if (!normalizedToken) {
      continue;
    }
    normalized.add(normalizedToken);
  }
  return normalized;
}

function resolvePurchasableScienceName(
  iniDataRegistry: IniDataRegistry,
  commandButton: CommandButtonDef | undefined,
  ownedScienceNames: readonly string[],
  availablePurchasePoints: number,
  disabledScienceNames: readonly string[],
  hiddenScienceNames: readonly string[],
): string | null {
  if (!commandButton) {
    return null;
  }

  const scienceNames = flattenIniValueTokens(commandButton.fields['Science'])
    .map((scienceName) => scienceName.trim().toUpperCase())
    .filter(Boolean);
  if (scienceNames.length === 0) {
    return null;
  }

  const ownedSciences = normalizeTokenSet(ownedScienceNames);
  const disabledSciences = normalizeTokenSet(disabledScienceNames);
  const hiddenSciences = normalizeTokenSet(hiddenScienceNames);
  for (const scienceName of scienceNames) {
    if (ownedSciences.has(scienceName)) {
      continue;
    }
    if (disabledSciences.has(scienceName) || hiddenSciences.has(scienceName)) {
      continue;
    }

    const scienceDef = iniDataRegistry.getScience(scienceName);
    if (!scienceDef) {
      continue;
    }
    const sciencePurchasePointCost = Number.parseInt(
      firstIniToken(scienceDef.fields['SciencePurchasePointCost']) ?? '',
      10,
    );
    if (!Number.isFinite(sciencePurchasePointCost) || sciencePurchasePointCost <= 0) {
      continue;
    }
    if (sciencePurchasePointCost > availablePurchasePoints) {
      continue;
    }

    const requiredSciences = normalizeTokenSet(
      flattenIniValueTokens(scienceDef.fields['PrerequisiteSciences']),
    );

    let hasAllPrereqs = true;
    for (const requiredScience of requiredSciences) {
      if (!ownedSciences.has(requiredScience)) {
        hasAllPrereqs = false;
        break;
      }
    }

    if (hasAllPrereqs) {
      return scienceName;
    }
  }

  return null;
}

interface ContextCommandPayload {
  targetObjectId: number | null;
  targetPosition: readonly [number, number, number] | null;
  productionId: number | null;
  upgradeName: string | null;
  placeLineEndPosition: readonly [number, number, number] | null;
  buildRotation: number | null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function parseTargetPosition(value: unknown): readonly [number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 3) {
    return null;
  }
  const [x, y, z] = value;
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z)) {
    return null;
  }
  return [x, y, z];
}

function parseTargetObjectId(value: unknown): number | null {
  if (!isFiniteNumber(value)) {
    return null;
  }
  return Math.trunc(value);
}

function parseRotation(value: unknown): number | null {
  if (!isFiniteNumber(value)) {
    return null;
  }
  return value;
}

function resolveContextCommandPayload(payload: unknown): ContextCommandPayload {
  if (!payload || typeof payload !== 'object') {
    return {
      targetObjectId: null,
      targetPosition: null,
      productionId: null,
      upgradeName: null,
      placeLineEndPosition: null,
      buildRotation: null,
    };
  }
  const candidate = payload as {
    targetObjectId?: unknown;
    targetPosition?: unknown;
    objectId?: unknown;
    position?: unknown;
    productionId?: unknown;
    production_id?: unknown;
    queueId?: unknown;
    queueID?: unknown;
    upgradeName?: unknown;
    upgrade?: unknown;
    placeLineEndPosition?: unknown;
    buildLineEndPosition?: unknown;
    lineEndPosition?: unknown;
    buildEndPosition?: unknown;
    rotation?: unknown;
    angle?: unknown;
    buildAngle?: unknown;
  };
  const targetObjectId = parseTargetObjectId(candidate.targetObjectId ?? candidate.objectId);
  const targetPosition = parseTargetPosition(candidate.targetPosition ?? candidate.position);
  const productionId = parseTargetObjectId(
    candidate.productionId ?? candidate.production_id ?? candidate.queueId ?? candidate.queueID,
  );
  const upgradeName = typeof candidate.upgradeName === 'string' && candidate.upgradeName.trim()
    ? candidate.upgradeName.trim().toUpperCase()
    : typeof candidate.upgrade === 'string' && candidate.upgrade.trim()
      ? candidate.upgrade.trim().toUpperCase()
      : null;
  const placeLineEndPosition = parseTargetPosition(
    candidate.placeLineEndPosition
      ?? candidate.buildLineEndPosition
      ?? candidate.lineEndPosition
      ?? candidate.buildEndPosition,
  );
  const buildRotation = parseRotation(candidate.rotation ?? candidate.angle ?? candidate.buildAngle);
  return {
    targetObjectId,
    targetPosition,
    productionId,
    upgradeName,
    placeLineEndPosition,
    buildRotation,
  };
}

function isObjectTargetValidForSources(
  commandOption: number,
  sourceEntityIds: readonly number[],
  targetEntityId: number,
  gameLogic: ControlBarDispatchGameLogic,
): boolean {
  if (sourceEntityIds.length === 0) {
    return false;
  }
  if (sourceEntityIds.length === 1) {
    return isObjectTargetRelationshipAllowed(
      commandOption,
      gameLogic.getEntityRelationship(sourceEntityIds[0]!, targetEntityId),
    );
  }
  return isObjectTargetAllowedForSelection(
    commandOption,
    sourceEntityIds,
    targetEntityId,
    (sourceObjectId, objectTargetId) => gameLogic.getEntityRelationship(sourceObjectId, objectTargetId),
  );
}

export function dispatchIssuedControlBarCommands(
  commands: readonly IssuedControlBarCommand[],
  iniDataRegistry: IniDataRegistry,
  gameLogic: ControlBarDispatchGameLogic,
  uiRuntime: ControlBarDispatchUiRuntime,
  audioManager: AudioManager,
  localPlayerIndex?: number | null,
  onUnsupportedCommand?: (route: UnsupportedControlBarCommandRoute) => void,
): void {
  for (const command of commands) {
    const commandButton = resolveSourceCommandButton(iniDataRegistry, command);
    const selectedEntityIds = resolveSelectedEntityIds(command, gameLogic);
    const playCommandAudio = (): void => {
      playIssuedCommandAudio(
        iniDataRegistry,
        audioManager,
        command,
        localPlayerIndex,
      );
    };

    switch (command.commandType) {
      case GUICommandType.GUI_COMMAND_STOP: {
        if (selectedEntityIds.length === 0) {
          continue;
        }
        submitCommandForSelectedEntities(
          selectedEntityIds,
          (entityId) => ({
            type: 'stop',
            entityId,
            commandSource: 'PLAYER',
          }),
          gameLogic,
        );
        playCommandAudio();
        break;
      }

      case GUICommandType.GUI_COMMAND_ATTACK_MOVE: {
        if (selectedEntityIds.length === 0) {
          continue;
        }
        if (!command.targetPosition) {
          uiRuntime.showMessage('Attack Move requires a world target.');
          break;
        }
        const [targetX, , targetZ] = command.targetPosition;
        submitCommandForSelectedEntities(
          selectedEntityIds,
          (entityId) => ({
            type: 'attackMoveTo',
            entityId,
            targetX,
            targetZ,
            attackDistance: gameLogic.getAttackMoveDistanceForEntity(entityId),
            commandSource: 'PLAYER',
          }),
          gameLogic,
        );
        playCommandAudio();
        break;
      }

      case GUICommandType.GUI_COMMAND_WAYPOINTS: {
        if (selectedEntityIds.length === 0) {
          continue;
        }
        if (!command.targetPosition) {
          uiRuntime.showMessage('Move requires a world target.');
          break;
        }
        const [targetX, , targetZ] = command.targetPosition;
        submitCommandForSelectedEntities(
          selectedEntityIds,
          (entityId) => ({
            type: 'moveTo',
            entityId,
            targetX,
            targetZ,
            commandSource: 'PLAYER',
          }),
          gameLogic,
        );
        playCommandAudio();
        break;
      }

      case GUICommandType.GUI_COMMAND_SET_RALLY_POINT: {
        // Source behavior from GUICommandTranslator::doSetRallyPointCommand:
        // rally point commands operate on exactly one selected structure.
        if (selectedEntityIds.length !== 1) {
          uiRuntime.showMessage('Set Rally Point requires a single selected structure.');
          break;
        }
        if (!command.targetPosition) {
          uiRuntime.showMessage('Set Rally Point requires a world target.');
          break;
        }
        const [targetX, , targetZ] = command.targetPosition;
        gameLogic.submitCommand({
          type: 'setRallyPoint',
          entityId: selectedEntityIds[0]!,
          targetX,
          targetZ,
        });
        playCommandAudio();
        break;
      }

      case GUICommandType.GUI_COMMAND_GUARD:
      case GUICommandType.GUI_COMMAND_GUARD_WITHOUT_PURSUIT:
      case GUICommandType.GUI_COMMAND_GUARD_FLYING_UNITS_ONLY: {
        if (selectedEntityIds.length === 0) {
          continue;
        }

        const guardMode = guardModeForCommandType(command.commandType);
        if (command.targetObjectId !== undefined) {
          submitCommandForSelectedEntities(
            selectedEntityIds,
            (entityId) => ({
              type: 'guardObject',
              entityId,
              targetEntityId: command.targetObjectId!,
              guardMode,
              commandSource: 'PLAYER',
            }),
            gameLogic,
          );
          playCommandAudio();
          break;
        }

        if (command.targetPosition) {
          const [targetX, , targetZ] = command.targetPosition;
          submitCommandForSelectedEntities(
            selectedEntityIds,
            (entityId) => ({
              type: 'guardPosition',
              entityId,
              targetX,
              targetZ,
              guardMode,
              commandSource: 'PLAYER',
            }),
            gameLogic,
          );
          playCommandAudio();
          break;
        }

        // Source behavior from GUICommandTranslator::doGuardCommand:
        // guard commands with no explicit target guard the unit's current location.
        for (const entityId of selectedEntityIds) {
          const entityPosition = gameLogic.getEntityWorldPosition(entityId);
          if (!entityPosition) {
            continue;
          }
          gameLogic.submitCommand({
            type: 'guardPosition',
            entityId,
            targetX: entityPosition[0],
            targetZ: entityPosition[2],
            guardMode,
            commandSource: 'PLAYER',
          });
        }
        playCommandAudio();
        break;
      }

      case GUICommandType.GUI_COMMAND_SPECIAL_POWER:
      case GUICommandType.GUI_COMMAND_SPECIAL_POWER_FROM_SHORTCUT:
      case GUICommandType.GUI_COMMAND_SPECIAL_POWER_CONSTRUCT:
      case GUICommandType.GUI_COMMAND_SPECIAL_POWER_CONSTRUCT_FROM_SHORTCUT: {
        const specialPowerName = resolveRequiredCommandButtonToken(commandButton, 'SpecialPower');
        if (!specialPowerName) {
          uiRuntime.showMessage(`${command.sourceButtonId} is missing a SpecialPower mapping.`);
          break;
        }

        const isShortcutSpecialPower =
          command.commandType === GUICommandType.GUI_COMMAND_SPECIAL_POWER_FROM_SHORTCUT
          || command.commandType === GUICommandType.GUI_COMMAND_SPECIAL_POWER_CONSTRUCT_FROM_SHORTCUT;
        const isConstructSpecialPower =
          command.commandType === GUICommandType.GUI_COMMAND_SPECIAL_POWER_CONSTRUCT
          || command.commandType === GUICommandType.GUI_COMMAND_SPECIAL_POWER_CONSTRUCT_FROM_SHORTCUT;

        if (command.commandType === GUICommandType.GUI_COMMAND_SPECIAL_POWER && selectedEntityIds.length === 0) {
          uiRuntime.showMessage('Special Power requires a selected source unit.');
          break;
        }

        if (isConstructSpecialPower && !isShortcutSpecialPower && selectedEntityIds.length !== 1) {
          uiRuntime.showMessage('Construct Special Power requires a single selected source unit.');
          break;
        }

        const contextPayload = resolveContextCommandPayload(command.contextPayload);
        let targetEntityId = command.targetObjectId ?? contextPayload.targetObjectId;
        let targetPosition = command.targetPosition ?? contextPayload.targetPosition;

        if (isConstructSpecialPower) {
          const constructObjectName = resolveRequiredCommandButtonToken(commandButton, 'Object');
          if (!constructObjectName) {
            uiRuntime.showMessage(`${command.sourceButtonId} is missing an Object mapping for construct special power.`);
            break;
          }

          // Source behavior from PlaceEventTranslator: construct special powers are
          // placement commands resolved to world locations.
          if (!targetPosition) {
            uiRuntime.showMessage('Construct Special Power requires a world target.');
            break;
          }
          targetEntityId = null;
        } else if ((command.commandOption & COMMAND_OPTION_NEED_OBJECT_TARGET) !== 0) {
          if (targetEntityId === null) {
            uiRuntime.showMessage('Special Power requires an object target.');
            break;
          }
        } else if ((command.commandOption & CommandOption.NEED_TARGET_POS) !== 0) {
          if (!targetPosition) {
            uiRuntime.showMessage('Special Power requires a world target.');
            break;
          }
        }

        let sourceEntityId: number | null = null;
        if (isShortcutSpecialPower) {
          sourceEntityId = gameLogic.resolveShortcutSpecialPowerSourceEntityId(
            specialPowerName,
          );
          if (sourceEntityId === null) {
            // Source behavior from ControlBar::processCommandUI:
            // shortcut special powers resolve source via local-player readiness.
            uiRuntime.showMessage(
              'Special power shortcut source is not currently available.',
            );
            break;
          }
        }
        if (isConstructSpecialPower && !isShortcutSpecialPower) {
          sourceEntityId = selectedEntityIds[0] ?? null;
        }
        if ((command.commandOption & COMMAND_OPTION_NEED_OBJECT_TARGET) !== 0 && targetEntityId !== null) {
          const sourceIdsForValidation = isShortcutSpecialPower
            ? (sourceEntityId === null ? [] : [sourceEntityId])
            : selectedEntityIds;
          if (!isObjectTargetValidForSources(
            command.commandOption,
            sourceIdsForValidation,
            targetEntityId,
            gameLogic,
          )) {
            uiRuntime.showMessage('Target is not valid for this command.');
            break;
          }
          targetPosition = null;
        }

        gameLogic.submitCommand({
          type: 'issueSpecialPower',
          commandButtonId: command.sourceButtonId,
          specialPowerName,
          commandOption: command.commandOption,
          issuingEntityIds: isShortcutSpecialPower && sourceEntityId !== null
            ? [sourceEntityId]
            : isConstructSpecialPower && sourceEntityId !== null
            ? [sourceEntityId]
            : [...selectedEntityIds],
          sourceEntityId,
          targetEntityId,
          targetX: targetPosition ? targetPosition[0] : null,
          targetZ: targetPosition ? targetPosition[2] : null,
        });

        playCommandAudio();
        break;
      }

      case GUICommandType.GUI_COMMAND_SPECIAL_POWER_FROM_COMMAND_CENTER: {
        const specialPowerName = resolveRequiredCommandButtonToken(commandButton, 'SpecialPower');
        if (!specialPowerName) {
          uiRuntime.showMessage(
            `${command.sourceButtonId} is missing a SpecialPower mapping.`,
          );
          break;
        }

        const commandCenterEntityId = gameLogic.resolveCommandCenterEntityId(localPlayerIndex ?? 0);
        if (commandCenterEntityId === null) {
          // Source parity: command-center specials no-op when no natural command center exists.
          break;
        }

        const contextPayload = resolveContextCommandPayload(command.contextPayload);
        let targetEntityId = command.targetObjectId ?? contextPayload.targetObjectId;
        let targetPosition = command.targetPosition ?? contextPayload.targetPosition;

        if ((command.commandOption & COMMAND_OPTION_NEED_OBJECT_TARGET) !== 0) {
          if (targetEntityId === null) {
            uiRuntime.showMessage('Special Power from command center requires an object target.');
            break;
          }
          if (!isObjectTargetRelationshipAllowed(
            command.commandOption,
            gameLogic.getEntityRelationship(commandCenterEntityId, targetEntityId),
          )) {
            uiRuntime.showMessage('Target is not valid for this command.');
            break;
          }
          targetPosition = null;
        } else if ((command.commandOption & CommandOption.NEED_TARGET_POS) !== 0) {
          if (!targetPosition) {
            uiRuntime.showMessage('Special Power from command center requires a world target.');
            break;
          }
          targetEntityId = null;
        } else {
          targetEntityId = null;
          targetPosition = null;
        }

        gameLogic.submitCommand({
          type: 'issueSpecialPower',
          commandButtonId: command.sourceButtonId,
          specialPowerName,
          commandOption: command.commandOption,
          issuingEntityIds: [commandCenterEntityId],
          sourceEntityId: commandCenterEntityId,
          targetEntityId,
          targetX: targetPosition ? targetPosition[0] : null,
          targetZ: targetPosition ? targetPosition[2] : null,
        });
        playCommandAudio();
        break;
      }

      case GUICommandType.GUI_COMMAND_NONE:
      case GUICommandType.GUI_COMMAND_NUM_COMMANDS: {
        // Sentinel command values in source command sets; no runtime action.
        break;
      }

      case GUICommandType.GUI_COMMAND_SELECT_ALL_UNITS_OF_TYPE: {
        const objectName =
          resolveRequiredCommandButtonToken(commandButton, 'Object')
          || resolveRequiredCommandButtonToken(commandButton, 'ThingTemplate');
        if (!objectName) {
          uiRuntime.showMessage(
            `${command.sourceButtonId} is missing Object/ThingTemplate mapping.`,
          );
          break;
        }

        const localSide = gameLogic.getPlayerSide(localPlayerIndex ?? 0);
        if (!localSide) {
          uiRuntime.showMessage(
            `${command.sourceButtonId} requires local player side resolution.`,
          );
          break;
        }

        const matchingEntityIds = gameLogic.getEntityIdsByTemplateAndSide(
          objectName,
          localSide,
        );
        gameLogic.submitCommand({ type: 'clearSelection' });
        if (matchingEntityIds.length > 0) {
          gameLogic.submitCommand({
            type: 'selectEntities',
            entityIds: matchingEntityIds,
          });
        }
        playCommandAudio();
        break;
      }

      case GUICommandType.GUICOMMANDMODE_SABOTAGE_BUILDING: {
        const contextPayload = resolveContextCommandPayload(command.contextPayload);
        const targetObjectId = command.targetObjectId ?? contextPayload.targetObjectId;
        if (targetObjectId === null) {
          uiRuntime.showMessage(`${command.sourceButtonId} requires a target object.`);
          break;
        }
        if (selectedEntityIds.length === 0) {
          uiRuntime.showMessage('Command mode requires a selected source unit.');
          break;
        }
        submitCommandForSelectedEntities(
          selectedEntityIds,
          (entityId) => ({
            type: 'enterObject',
            entityId,
            targetObjectId,
            action: 'sabotageBuilding',
          }),
          gameLogic,
        );
        playCommandAudio();
        break;
      }

      case GUICommandType.GUI_COMMAND_EXIT_CONTAINER: {
        if (selectedEntityIds.length === 0) {
          continue;
        }
        submitCommandForSelectedEntities(
          selectedEntityIds,
          (entityId) => ({
            type: 'exitContainer',
            entityId,
          }),
          gameLogic,
        );
        playCommandAudio();
        break;
      }

      case GUICommandType.GUI_COMMAND_EVACUATE: {
        if (selectedEntityIds.length === 0) {
          continue;
        }
        submitCommandForSelectedEntities(
          selectedEntityIds,
          (entityId) => ({
            type: 'evacuate',
            entityId,
          }),
          gameLogic,
        );
        playCommandAudio();
        break;
      }

      case GUICommandType.GUI_COMMAND_EXECUTE_RAILED_TRANSPORT: {
        if (selectedEntityIds.length === 0) {
          continue;
        }
        submitCommandForSelectedEntities(
          selectedEntityIds,
          (entityId) => ({
            type: 'executeRailedTransport',
            entityId,
          }),
          gameLogic,
        );
        playCommandAudio();
        break;
      }

      case GUICommandType.GUI_COMMAND_BEACON_DELETE: {
        if (selectedEntityIds.length === 0) {
          continue;
        }
        submitCommandForSelectedEntities(
          selectedEntityIds,
          (entityId) => ({
            type: 'beaconDelete',
            entityId,
          }),
          gameLogic,
        );
        playCommandAudio();
        break;
      }

      case GUICommandType.GUI_COMMAND_SELL: {
        if (selectedEntityIds.length === 0) {
          continue;
        }
        submitCommandForSelectedEntities(
          selectedEntityIds,
          (entityId) => ({
            type: 'sell',
            entityId,
          }),
          gameLogic,
        );
        playCommandAudio();
        break;
      }

      case GUICommandType.GUI_COMMAND_FIRE_WEAPON: {
        if (selectedEntityIds.length === 0) {
          continue;
        }

        const weaponSlot = resolveWeaponSlotFromCommandButton(commandButton) ?? 0;
        const maxShotsToFire = resolveMaxShotsToFireFromCommandButton(commandButton);
        const contextPayload = resolveContextCommandPayload(command.contextPayload);
        const needsObjectTarget =
          (command.commandOption & COMMAND_OPTION_NEED_OBJECT_TARGET) !== 0;
        const needsTargetPosition = (command.commandOption & CommandOption.NEED_TARGET_POS) !== 0;
        const attacksObjectPosition =
          (command.commandOption & CommandOption.ATTACK_OBJECTS_POSITION) !== 0;

        let targetObjectId = command.targetObjectId ?? contextPayload.targetObjectId;
        let targetPosition = command.targetPosition ?? contextPayload.targetPosition;

        if (needsObjectTarget && targetObjectId === null) {
          uiRuntime.showMessage('Fire Weapon requires an object target.');
          break;
        }
        if (needsTargetPosition && !targetPosition) {
          uiRuntime.showMessage('Fire Weapon requires a world target.');
          break;
        }

        if (attacksObjectPosition && targetPosition === null && targetObjectId !== null) {
          targetPosition = gameLogic.getEntityWorldPosition(targetObjectId) ?? null;
          if (targetPosition === null) {
            uiRuntime.showMessage('Fire Weapon needs target world position for ATTACK_OBJECTS_POSITION behavior.');
            break;
          }
        }

        submitCommandForSelectedEntities(
          selectedEntityIds,
          (entityId) => ({
            type: 'fireWeapon',
            entityId,
            weaponSlot,
            maxShotsToFire,
            targetObjectId: needsObjectTarget ? targetObjectId : null,
            targetPosition,
          }),
          gameLogic,
        );
        playCommandAudio();
        break;
      }

      case GUICommandType.GUI_COMMAND_HACK_INTERNET: {
        if (selectedEntityIds.length === 0) {
          continue;
        }
        submitCommandForSelectedEntities(
          selectedEntityIds,
          (entityId) => ({
            type: 'hackInternet',
            entityId,
          }),
          gameLogic,
        );
        playCommandAudio();
        break;
      }

      case GUICommandType.GUI_COMMAND_TOGGLE_OVERCHARGE: {
        if (selectedEntityIds.length === 0) {
          continue;
        }
        submitCommandForSelectedEntities(
          selectedEntityIds,
          (entityId) => ({
            type: 'toggleOvercharge',
            entityId,
          }),
          gameLogic,
        );
        playCommandAudio();
        break;
      }

      case GUICommandType.GUI_COMMAND_COMBATDROP: {
        if (selectedEntityIds.length === 0) {
          continue;
        }

        const contextPayload = resolveContextCommandPayload(command.contextPayload);
        const needsObjectTarget =
          (command.commandOption & COMMAND_OPTION_NEED_OBJECT_TARGET) !== 0;
        const needsTargetPosition =
          (command.commandOption & CommandOption.NEED_TARGET_POS) !== 0;

        const targetObjectId =
          command.targetObjectId ?? contextPayload.targetObjectId;
        const targetPosition = command.targetPosition ?? contextPayload.targetPosition;

        if (needsObjectTarget && targetObjectId === null) {
          uiRuntime.showMessage('Combat Drop requires an object target.');
          break;
        }
        if (!needsObjectTarget && needsTargetPosition && !targetPosition) {
          uiRuntime.showMessage('Combat Drop requires a world target.');
          break;
        }
        if (!needsObjectTarget && !needsTargetPosition) {
          uiRuntime.showMessage('Combat Drop requires a target.');
          break;
        }

        submitCommandForSelectedEntities(
          selectedEntityIds,
          (entityId) => ({
            type: 'combatDrop',
            entityId,
            targetObjectId: needsObjectTarget ? targetObjectId : null,
            targetPosition: needsObjectTarget ? null : targetPosition,
          }),
          gameLogic,
        );
        playCommandAudio();
        break;
      }

      case GUICommandType.GUI_COMMAND_SWITCH_WEAPON: {
        if (selectedEntityIds.length === 0) {
          continue;
        }
        const weaponSlot = resolveWeaponSlotFromCommandButton(commandButton) ?? 0;
        submitCommandForSelectedEntities(
          selectedEntityIds,
          (entityId) => ({
            type: 'switchWeapon',
            entityId,
            weaponSlot,
          }),
          gameLogic,
        );
        playCommandAudio();
        break;
      }

      case GUICommandType.GUICOMMANDMODE_HIJACK_VEHICLE:
      case GUICommandType.GUICOMMANDMODE_CONVERT_TO_CARBOMB: {
        const contextPayload = resolveContextCommandPayload(command.contextPayload);
        const targetObjectId = command.targetObjectId ?? contextPayload.targetObjectId;
        if (targetObjectId === null) {
          uiRuntime.showMessage(`${command.sourceButtonId} requires a target object.`);
          break;
        }
        if (selectedEntityIds.length === 0) {
          uiRuntime.showMessage('Command mode requires a selected source unit.');
          break;
        }
        submitCommandForSelectedEntities(
          selectedEntityIds,
          (entityId) => ({
            type: 'enterObject',
            entityId,
            targetObjectId,
            action:
              command.commandType === GUICommandType.GUICOMMANDMODE_HIJACK_VEHICLE
                ? 'hijackVehicle'
                : 'convertToCarBomb',
          }),
          gameLogic,
        );
        playCommandAudio();
        break;
      }

      case GUICommandType.GUICOMMANDMODE_PLACE_BEACON: {
        const contextPayload = resolveContextCommandPayload(command.contextPayload);
        const targetPosition = command.targetPosition ?? contextPayload.targetPosition;
        if (!targetPosition) {
          uiRuntime.showMessage('Place Beacon requires a world target.');
          break;
        }
        gameLogic.submitCommand({
          type: 'placeBeacon',
          targetPosition,
        });
        playCommandAudio();
        break;
      }

      case GUICommandType.GUI_COMMAND_DOZER_CONSTRUCT: {
        if (selectedEntityIds.length === 0) {
          continue;
        }
        const contextPayload = resolveContextCommandPayload(command.contextPayload);
        const targetPosition = command.targetPosition ?? contextPayload.targetPosition;
        if (!targetPosition) {
          uiRuntime.showMessage('GUI_COMMAND_DOZER_CONSTRUCT requires a world target.');
          break;
        }
        const templateName =
          resolveRequiredCommandButtonToken(commandButton, 'Object')
          || resolveRequiredCommandButtonToken(commandButton, 'ThingTemplate');
        if (!templateName) {
          uiRuntime.showMessage(
            `${command.sourceButtonId} is missing unit/build template mapping.`,
          );
          break;
        }
        submitCommandForSelectedEntities(
          selectedEntityIds,
          (entityId) => ({
            type: 'constructBuilding',
            entityId,
            templateName,
            targetPosition,
            angle: command.angle ?? contextPayload.buildRotation ?? 0,
            lineEndPosition: contextPayload.placeLineEndPosition,
          }),
          gameLogic,
        );
        playCommandAudio();
        break;
      }

      case GUICommandType.GUI_COMMAND_UNIT_BUILD: {
        if (selectedEntityIds.length === 0) {
          continue;
        }
        const unitTemplateName = resolveRequiredCommandButtonToken(commandButton, 'Object');
        if (!unitTemplateName) {
          uiRuntime.showMessage(`${command.sourceButtonId} is missing unit/build template mapping.`);
          break;
        }
        submitCommandForSelectedEntities(
          selectedEntityIds,
          (entityId) => ({
            type: 'queueUnitProduction',
            entityId,
            unitTemplateName,
          }),
          gameLogic,
        );
        playCommandAudio();
        break;
      }

      case GUICommandType.GUI_COMMAND_CANCEL_UNIT_BUILD: {
        if (selectedEntityIds.length !== 1) {
          uiRuntime.showMessage('Cancel Unit Build requires a single selected source object.');
          break;
        }
        const selectedEntityId = selectedEntityIds[0];
        if (selectedEntityId === undefined) {
          break;
        }
        const contextPayload = resolveContextCommandPayload(command.contextPayload);
        let productionId = contextPayload.productionId;
        if (productionId === null) {
          const productionState = gameLogic.getProductionState(selectedEntityId);
          const queuedUnit = productionState?.queue.find((entry) => entry.type === 'UNIT');
          productionId = queuedUnit?.productionId ?? null;
        }
        if (productionId === null) {
          uiRuntime.showMessage(
            'Cancel Unit Build requires queued unit production context to dispatch.',
          );
          break;
        }
        gameLogic.submitCommand({
          type: 'cancelUnitProduction',
          entityId: selectedEntityId,
          productionId,
        });
        playCommandAudio();
        break;
      }

      case GUICommandType.GUI_COMMAND_DOZER_CONSTRUCT_CANCEL: {
        if (selectedEntityIds.length !== 1) {
          uiRuntime.showMessage('Cancel dozer construction requires a single selected source object.');
          break;
        }
        gameLogic.submitCommand({
          type: 'cancelDozerConstruction',
          entityId: selectedEntityIds[0]!,
        });
        playCommandAudio();
        break;
      }

      case GUICommandType.GUI_COMMAND_CANCEL_UPGRADE: {
        if (selectedEntityIds.length !== 1) {
          uiRuntime.showMessage('Cancel Upgrade requires a single selected source object.');
          break;
        }
        const selectedEntityId = selectedEntityIds[0];
        if (selectedEntityId === undefined) {
          break;
        }
        const contextPayload = resolveContextCommandPayload(command.contextPayload);
        let upgradeName = contextPayload.upgradeName;
        if (!upgradeName) {
          const upgradeFromCommandButton = resolveRequiredCommandButtonToken(commandButton, 'Upgrade');
          upgradeName = upgradeFromCommandButton ? upgradeFromCommandButton.trim().toUpperCase() : null;
        }
        if (!upgradeName) {
          const productionState = gameLogic.getProductionState(selectedEntityId);
          const queuedUpgrade = productionState?.queue.find((entry) => entry.type === 'UPGRADE');
          upgradeName = queuedUpgrade?.upgradeName.trim().toUpperCase() ?? null;
        }
        if (!upgradeName) {
          uiRuntime.showMessage(
            'Cancel Upgrade requires queued upgrade context to dispatch.',
          );
          break;
        }
        gameLogic.submitCommand({
          type: 'cancelUpgradeProduction',
          entityId: selectedEntityId,
          upgradeName,
        });
        playCommandAudio();
        break;
      }

      case GUICommandType.GUI_COMMAND_OBJECT_UPGRADE: {
        if (selectedEntityIds.length === 0) {
          continue;
        }
        const upgradeName = resolveRequiredCommandButtonToken(commandButton, 'Upgrade');
        if (!upgradeName) {
          uiRuntime.showMessage(`${command.sourceButtonId} is missing object Upgrade mapping.`);
          break;
        }
        submitCommandForSelectedEntities(
          selectedEntityIds,
          (entityId) => ({
            type: 'applyUpgrade',
            entityId,
            upgradeName,
          }),
          gameLogic,
        );
        playCommandAudio();
        break;
      }

      case GUICommandType.GUI_COMMAND_PLAYER_UPGRADE: {
        const upgradeName = resolveRequiredCommandButtonToken(commandButton, 'Upgrade');
        if (!upgradeName) {
          uiRuntime.showMessage(`${command.sourceButtonId} is missing player Upgrade mapping.`);
          break;
        }
        gameLogic.submitCommand({
          type: 'applyPlayerUpgrade',
          upgradeName,
        });
        playCommandAudio();
        break;
      }

      case GUICommandType.GUI_COMMAND_PURCHASE_SCIENCE: {
        const localPlayerSciencePurchasePoints = gameLogic.getLocalPlayerSciencePurchasePoints();
        const scienceName = resolvePurchasableScienceName(
          iniDataRegistry,
          commandButton,
          gameLogic.getLocalPlayerScienceNames(),
          localPlayerSciencePurchasePoints,
          gameLogic.getLocalPlayerDisabledScienceNames(),
          gameLogic.getLocalPlayerHiddenScienceNames(),
        );
        if (!scienceName) {
          uiRuntime.showMessage(`${command.sourceButtonId} has no currently purchasable science.`);
          break;
        }
        const sciencePurchasePointCost = Number.parseInt(
          firstIniToken(iniDataRegistry.getScience(scienceName)?.fields['SciencePurchasePointCost']) ?? '',
          10,
        );
        if (!Number.isFinite(sciencePurchasePointCost) || sciencePurchasePointCost <= 0) {
          uiRuntime.showMessage(`${scienceName} has invalid purchase cost.`);
          break;
        }
        gameLogic.submitCommand({
          type: 'purchaseScience',
          scienceName,
          scienceCost: sciencePurchasePointCost,
        });
        playCommandAudio();
        break;
      }

      default: {
        const commandName = GUICommandType[command.commandType] ?? `#${command.commandType}`;
        const unsupportedRoute: UnsupportedControlBarCommandRoute = {
          sourceButtonId: command.sourceButtonId,
          commandType: command.commandType,
          commandName,
          selectedEntityCount: selectedEntityIds.length,
          hasObjectTarget: command.targetObjectId !== undefined,
          hasPositionTarget: Array.isArray(command.targetPosition),
        };
        onUnsupportedCommand?.(unsupportedRoute);
        if (!onUnsupportedCommand) {
          console.warn('[control-bar-dispatch] unsupported command route', unsupportedRoute);
        }
        uiRuntime.showMessage(`${commandName} is not mapped to game logic.`);
        break;
      }
    }
  }
}
