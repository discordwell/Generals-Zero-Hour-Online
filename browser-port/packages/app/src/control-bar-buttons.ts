import { IniDataRegistry, type CommandButtonDef } from '@generals/ini-data';
import {
  CommandOption,
  GUICommandType,
  commandOptionMaskFromSourceNames,
  guiCommandTypeFromSourceName,
  type ControlBarButton,
} from '@generals/ui';

export interface ControlBarSelectionContext {
  entityId?: number;
  templateName: string | null;
  canMove: boolean;
  hasAutoRallyPoint?: boolean;
  isUnmanned: boolean;
  isDozer: boolean;
  isMoving: boolean;
  objectStatusFlags?: readonly string[];
  productionQueueEntryCount?: number;
  productionQueueMaxEntries?: number;
  appliedUpgradeNames?: readonly string[];
  // Compatibility fallback for older call sites. Prefer ControlBarPlayerContext.
  playerUpgradeNames?: readonly string[];
  // Compatibility fallback for older call sites. Prefer ControlBarPlayerContext.
  playerScienceNames?: readonly string[];
  // Compatibility fallback for older call sites. Prefer ControlBarPlayerContext.
  playerSciencePurchasePoints?: number;
  // Compatibility fallback for older call sites. Prefer ControlBarPlayerContext.
  disabledScienceNames?: readonly string[];
  // Compatibility fallback for older call sites. Prefer ControlBarPlayerContext.
  hiddenScienceNames?: readonly string[];
}

export interface ControlBarPlayerContext {
  playerUpgradeNames?: readonly string[];
  playerScienceNames?: readonly string[];
  playerSciencePurchasePoints?: number;
  disabledScienceNames?: readonly string[];
  hiddenScienceNames?: readonly string[];
  logicFrame?: number;
  resolveSpecialPowerReadyFrame?: (
    specialPowerName: string,
    sourceEntityId: number,
  ) => number | null;
}

interface ResolvedControlBarPlayerContext {
  playerUpgradeNames: readonly string[];
  playerScienceNames: readonly string[];
  playerSciencePurchasePoints: number;
  disabledScienceNames: readonly string[];
  hiddenScienceNames: readonly string[];
  logicFrame: number | null;
  resolveSpecialPowerReadyFrame: (
    specialPowerName: string,
    sourceEntityId: number,
  ) => number | null;
}

function isMultiSelectButton(button: ControlBarButton): boolean {
  return ((button.commandOption ?? CommandOption.COMMAND_OPTION_NONE) & CommandOption.OK_FOR_MULTI_SELECT) !== 0;
}

function isAttackMoveButton(button: ControlBarButton): boolean {
  return button.commandType === GUICommandType.GUI_COMMAND_ATTACK_MOVE;
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

function normalizeControlBarLabel(value: unknown, fallback: string): string {
  const token = firstIniToken(value);
  if (!token) {
    return fallback;
  }
  const colonOffset = token.indexOf(':');
  if (colonOffset < 0 || colonOffset >= token.length - 1) {
    return token;
  }
  return token.slice(colonOffset + 1);
}

function normalizeControlBarIconName(value: unknown): string | undefined {
  const token = firstIniToken(value);
  if (!token) {
    return undefined;
  }
  const trimmed = token.trim();
  return trimmed || undefined;
}

type CommandDisabledReason =
  | 'MUST_BE_STOPPED'
  | 'DOZER_REQUIRED'
  | 'AUTO_RALLYPOINT_REQUIRED'
  | 'UPGRADE_REQUIRED'
  | 'SCIENCE_REQUIRED'
  | 'PRODUCTION_QUEUE_FULL'
  | 'SCIENCE_UNAVAILABLE'
  | 'SPECIAL_POWER_COOLDOWN';

interface CommandAvailabilityResult {
  enabled: boolean;
  disabledReason?: CommandDisabledReason;
}

function buildControlBarButtonsFromCommandSet(
  iniDataRegistry: IniDataRegistry,
  commandSetName: string,
  selection: ControlBarSelectionContext,
  playerContext: ResolvedControlBarPlayerContext,
): ControlBarButton[] {
  const commandSet = iniDataRegistry.getCommandSet(commandSetName);
  if (!commandSet) {
    return [];
  }

  const slottedButtons = commandSet.slottedButtons ??
    commandSet.buttons.map((commandButtonName, index) => ({
      slot: index + 1,
      commandButtonName,
    }));
  const buttons: ControlBarButton[] = [];
  for (const entry of slottedButtons) {
    const commandButtonName = entry.commandButtonName;
    const commandButton = iniDataRegistry.getCommandButton(commandButtonName);
    if (!commandButton) {
      continue;
    }

    const commandTypeName = commandButton.commandTypeName ?? firstIniToken(commandButton.fields['Command']);
    if (!commandTypeName) {
      continue;
    }
    const commandType = guiCommandTypeFromSourceName(commandTypeName);
    if (commandType === null) {
      continue;
    }

    const optionNames = commandButton.options.length > 0
      ? commandButton.options
      : flattenIniValueTokens(commandButton.fields['Options']).map((token) => token.toUpperCase());
    const commandOption = commandOptionMaskFromSourceNames(optionNames);
    const label = normalizeControlBarLabel(
      commandButton.fields['TextLabel'] ?? commandButton.fields['Label'],
      commandButton.name,
    );
    const iconName = normalizeControlBarIconName(
      commandButton.fields['ButtonImage'] ?? commandButton.fields['ButtonImageName'],
    );

    const availability = evaluateCommandAvailability(
      iniDataRegistry,
      commandButton,
      commandType,
      commandOption,
      selection,
      playerContext,
    );

    buttons.push({
      id: commandButton.name,
      slot: entry.slot,
      label,
      commandType,
      commandOption,
      enabled: availability.enabled,
      ...(availability.disabledReason ? { disabledReason: availability.disabledReason } : {}),
      ...(iconName ? { iconName } : {}),
    });
  }

  return buttons;
}

function normalizeUpgradeNameSet(names: readonly string[] | undefined): Set<string> {
  const normalizedNames = new Set<string>();
  if (!names) {
    return normalizedNames;
  }

  for (const name of names) {
    const normalized = name.trim().toUpperCase();
    if (!normalized) {
      continue;
    }
    normalizedNames.add(normalized);
  }
  return normalizedNames;
}

function normalizeStatusNameSet(names: readonly string[] | undefined): Set<string> {
  const normalizedNames = new Set<string>();
  if (!names) {
    return normalizedNames;
  }

  for (const name of names) {
    const normalized = name.trim().toUpperCase();
    if (!normalized) {
      continue;
    }
    normalizedNames.add(normalized);
  }
  return normalizedNames;
}

function isBlockedByScriptStatusOrUnmanned(selection: ControlBarSelectionContext): boolean {
  if (selection.isUnmanned) {
    // Source behavior from ControlBar::getCommandAvailability:
    // DISABLED_UNMANNED objects expose no command buttons.
    return true;
  }

  const statusFlags = normalizeStatusNameSet(selection.objectStatusFlags);
  return statusFlags.has('SCRIPT_DISABLED')
    || statusFlags.has('SCRIPT_UNPOWERED')
    || statusFlags.has('DISABLED_UNMANNED');
}

function parseUpgradeType(upgradeTypeName: string | null): 'player' | 'object' {
  // Source behavior from UpgradeTemplate::UpgradeTemplate:
  // missing/unknown upgrade type defaults to player-level upgrades.
  return upgradeTypeName?.toUpperCase() === 'OBJECT' ? 'object' : 'player';
}

function resolvePlayerContext(
  selection: ControlBarSelectionContext,
  playerContext: ControlBarPlayerContext | undefined,
): ResolvedControlBarPlayerContext {
  const logicFrame = playerContext?.logicFrame;
  const resolveSpecialPowerReadyFrame = playerContext?.resolveSpecialPowerReadyFrame;
  return {
    playerUpgradeNames: playerContext?.playerUpgradeNames ?? selection.playerUpgradeNames ?? [],
    playerScienceNames: playerContext?.playerScienceNames ?? selection.playerScienceNames ?? [],
    // Source parity: unknown purchase-point state should behave as not purchasable.
    playerSciencePurchasePoints: playerContext?.playerSciencePurchasePoints
      ?? selection.playerSciencePurchasePoints
      ?? 0,
    disabledScienceNames: playerContext?.disabledScienceNames ?? selection.disabledScienceNames ?? [],
    hiddenScienceNames: playerContext?.hiddenScienceNames ?? selection.hiddenScienceNames ?? [],
    logicFrame: typeof logicFrame === 'number' && Number.isFinite(logicFrame)
      ? Math.trunc(logicFrame)
      : null,
    resolveSpecialPowerReadyFrame: typeof resolveSpecialPowerReadyFrame === 'function'
      ? resolveSpecialPowerReadyFrame
      : () => null,
  };
}

function hasRequiredUpgrade(
  iniDataRegistry: IniDataRegistry,
  commandButton: CommandButtonDef,
  selection: ControlBarSelectionContext,
  playerContext: ResolvedControlBarPlayerContext,
): boolean {
  const upgradeName = firstIniToken(commandButton.fields['Upgrade']);
  if (!upgradeName) {
    // Source behavior from ControlBar::getCommandAvailability:
    // NEED_UPGRADE checks only run when an upgrade template exists.
    return true;
  }

  const normalizedUpgradeName = upgradeName.trim().toUpperCase();
  const upgradeDef = iniDataRegistry.getUpgrade(upgradeName);
  if (!upgradeDef) {
    // Source parity: unresolved upgrade templates effectively behave as absent.
    return true;
  }

  const upgradeType = parseUpgradeType(firstIniToken(upgradeDef.fields['Type']));
  if (upgradeType === 'object') {
    const objectUpgrades = normalizeUpgradeNameSet(selection.appliedUpgradeNames);
    return objectUpgrades.has(normalizedUpgradeName);
  }

  const playerUpgrades = normalizeUpgradeNameSet(playerContext.playerUpgradeNames);
  return playerUpgrades.has(normalizedUpgradeName);
}

function hasRequiredSciences(
  commandButton: CommandButtonDef,
  playerContext: ResolvedControlBarPlayerContext,
): boolean {
  const scienceNames = normalizeUpgradeNameSet(
    flattenIniValueTokens(commandButton.fields['Science']),
  );
  if (scienceNames.size === 0) {
    return true;
  }

  const ownedSciences = normalizeUpgradeNameSet(playerContext.playerScienceNames);
  for (const scienceName of scienceNames) {
    if (!ownedSciences.has(scienceName)) {
      return false;
    }
  }
  return true;
}

function canPurchaseScienceFromButton(
  iniDataRegistry: IniDataRegistry,
  commandButton: CommandButtonDef,
  playerContext: ResolvedControlBarPlayerContext,
): boolean {
  const scienceNames = flattenIniValueTokens(commandButton.fields['Science'])
    .map((scienceName) => scienceName.trim().toUpperCase())
    .filter(Boolean);
  if (scienceNames.length === 0) {
    return false;
  }

  const ownedSciences = normalizeUpgradeNameSet(playerContext.playerScienceNames);
  const disabledSciences = normalizeUpgradeNameSet(playerContext.disabledScienceNames);
  const hiddenSciences = normalizeUpgradeNameSet(playerContext.hiddenScienceNames);
  const availablePurchasePoints = playerContext.playerSciencePurchasePoints;
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
    // Source behavior from ScienceStore::getPurchasableSciences:
    // a cost of 0 means the science cannot be purchased.
    if (!Number.isFinite(sciencePurchasePointCost) || sciencePurchasePointCost <= 0) {
      continue;
    }
    if (sciencePurchasePointCost > availablePurchasePoints) {
      continue;
    }

    const requiredSciences = normalizeUpgradeNameSet(
      flattenIniValueTokens(scienceDef?.fields['PrerequisiteSciences']),
    );

    let hasAllPrereqs = true;
    for (const requiredScience of requiredSciences) {
      if (!ownedSciences.has(requiredScience)) {
        hasAllPrereqs = false;
        break;
      }
    }

    if (hasAllPrereqs) {
      return true;
    }
  }

  return false;
}

function isProductionQueueFull(selection: ControlBarSelectionContext): boolean {
  if (selection.productionQueueMaxEntries === undefined || selection.productionQueueEntryCount === undefined) {
    return false;
  }

  return selection.productionQueueMaxEntries <= selection.productionQueueEntryCount;
}

function isSpecialPowerCommandType(commandType: GUICommandType): boolean {
  switch (commandType) {
    case GUICommandType.GUI_COMMAND_SPECIAL_POWER:
    case GUICommandType.GUI_COMMAND_SPECIAL_POWER_FROM_COMMAND_CENTER:
    case GUICommandType.GUI_COMMAND_SPECIAL_POWER_FROM_SHORTCUT:
    case GUICommandType.GUI_COMMAND_SPECIAL_POWER_CONSTRUCT:
    case GUICommandType.GUI_COMMAND_SPECIAL_POWER_CONSTRUCT_FROM_SHORTCUT:
      return true;
    default:
      return false;
  }
}

function isSpecialPowerReadyForSelection(
  commandButton: CommandButtonDef,
  commandType: GUICommandType,
  selection: ControlBarSelectionContext,
  playerContext: ResolvedControlBarPlayerContext,
): boolean {
  if (!isSpecialPowerCommandType(commandType)) {
    return true;
  }
  if (selection.entityId === undefined || !Number.isFinite(selection.entityId)) {
    return true;
  }
  if (playerContext.logicFrame === null) {
    return true;
  }

  const specialPowerNameToken = firstIniToken(commandButton.fields['SpecialPower']);
  const specialPowerName = specialPowerNameToken?.trim().toUpperCase() ?? '';
  if (!specialPowerName) {
    // Missing SpecialPower metadata is validated in dispatch path; do not disable
    // here to preserve source command-card visibility for malformed data.
    return true;
  }

  const sourceEntityId = Math.trunc(selection.entityId);
  const readyFrame = playerContext.resolveSpecialPowerReadyFrame(specialPowerName, sourceEntityId);
  if (readyFrame === null || !Number.isFinite(readyFrame)) {
    return false;
  }

  return Math.trunc(readyFrame) <= playerContext.logicFrame;
}

function evaluateCommandAvailability(
  iniDataRegistry: IniDataRegistry,
  commandButton: CommandButtonDef,
  commandType: GUICommandType,
  commandOption: number,
  selection: ControlBarSelectionContext,
  playerContext: ResolvedControlBarPlayerContext,
): CommandAvailabilityResult {
  if ((commandOption & CommandOption.MUST_BE_STOPPED) !== 0 && selection.isMoving) {
    return {
      enabled: false,
      disabledReason: 'MUST_BE_STOPPED',
    };
  }

  // Source behavior from ControlBar::getCommandAvailability:
  // GUI_COMMAND_DOZER_CONSTRUCT is restricted for non-dozers.
  if (commandType === GUICommandType.GUI_COMMAND_DOZER_CONSTRUCT && !selection.isDozer) {
    return {
      enabled: false,
      disabledReason: 'DOZER_REQUIRED',
    };
  }

  // Source behavior from InGameUI::canSelectedObjectsDoAction(ACTIONTYPE_SET_RALLY_POINT):
  // rally-point commands require AUTO_RALLYPOINT capability on the selected object.
  if (
    commandType === GUICommandType.GUI_COMMAND_SET_RALLY_POINT &&
    !(selection.hasAutoRallyPoint ?? false)
  ) {
    return {
      enabled: false,
      disabledReason: 'AUTO_RALLYPOINT_REQUIRED',
    };
  }

  if ((commandOption & CommandOption.NEED_UPGRADE) !== 0 && !hasRequiredUpgrade(
    iniDataRegistry,
    commandButton,
    selection,
    playerContext,
  )) {
    return {
      enabled: false,
      disabledReason: 'UPGRADE_REQUIRED',
    };
  }

  // Source behavior from ControlBar::getCommandAvailability:
  // PLAYER_UPGRADE and OBJECT_UPGRADE commands require all sciences listed on
  // the command button.
  if (
    (commandType === GUICommandType.GUI_COMMAND_PLAYER_UPGRADE ||
      commandType === GUICommandType.GUI_COMMAND_OBJECT_UPGRADE) &&
    !hasRequiredSciences(commandButton, playerContext)
  ) {
    return {
      enabled: false,
      disabledReason: 'SCIENCE_REQUIRED',
    };
  }

  // Source behavior from ControlBar::getCommandAvailability:
  // production-backed commands are disabled when command queues are full.
  if (
    (commandType === GUICommandType.GUI_COMMAND_UNIT_BUILD
      || commandType === GUICommandType.GUI_COMMAND_OBJECT_UPGRADE)
    && isProductionQueueFull(selection)
  ) {
    return {
      enabled: false,
      disabledReason: 'PRODUCTION_QUEUE_FULL',
    };
  }

  if (
    commandType === GUICommandType.GUI_COMMAND_PURCHASE_SCIENCE &&
    !canPurchaseScienceFromButton(iniDataRegistry, commandButton, playerContext)
  ) {
    return {
      enabled: false,
      disabledReason: 'SCIENCE_UNAVAILABLE',
    };
  }

  // Source parity bridge: special power command buttons are disabled while the
  // bound source entity's module ready-frame is still in cooldown.
  if (!isSpecialPowerReadyForSelection(commandButton, commandType, selection, playerContext)) {
    return {
      enabled: false,
      disabledReason: 'SPECIAL_POWER_COOLDOWN',
    };
  }

  return {
    enabled: true,
  };
}

export function buildControlBarButtonsForSelection(
  iniDataRegistry: IniDataRegistry,
  selection: ControlBarSelectionContext,
  playerContext?: ControlBarPlayerContext,
): ControlBarButton[] {
  if (!selection.templateName) {
    return [];
  }

  if (isBlockedByScriptStatusOrUnmanned(selection)) {
    return [];
  }

  const objectDef = iniDataRegistry.getObject(selection.templateName);
  const resolvedPlayerContext = resolvePlayerContext(selection, playerContext);
  const commandSetName = objectDef
    ? firstIniToken(objectDef.fields['CommandSet'] ?? objectDef.fields['CommandSetName'])
    : null;
  if (commandSetName) {
    const sourceButtons = buildControlBarButtonsFromCommandSet(
      iniDataRegistry,
      commandSetName,
      selection,
      resolvedPlayerContext,
    );
    if (sourceButtons.length > 0) {
      return sourceButtons;
    }
  }

  return [];
}

function intersectControlBarButtonLists(
  buttonSets: readonly ControlBarButton[][],
): ControlBarButton[] {
  if (buttonSets.length === 0) {
    return [];
  }

  const firstSet = buttonSets[0] ?? [];
  if (buttonSets.length === 1) {
    return [...firstSet];
  }

  const commonBySlot = new Map<number, {
    button: ControlBarButton;
    canAnySource: boolean;
  }>();
  for (const button of firstSet) {
    const slot = button.slot;
    if (!slot) {
      continue;
    }
    if (isMultiSelectButton(button) && !commonBySlot.has(slot)) {
      commonBySlot.set(slot, {
        button,
        canAnySource: button.enabled === true,
      });
    }
  }

  for (const currentSet of buttonSets.slice(1)) {
    const currentSetBySlot = new Map<number, ControlBarButton>();
    for (const button of currentSet) {
      const slot = button.slot;
      if (!slot || !isMultiSelectButton(button)) {
        continue;
      }
      if (!currentSetBySlot.has(slot)) {
        currentSetBySlot.set(slot, button);
      }
    }

    for (const [slot, commonButton] of commonBySlot) {
      const nextButton = currentSetBySlot.get(slot);
      if (!nextButton) {
        if (commonButton.button.commandType !== GUICommandType.GUI_COMMAND_ATTACK_MOVE) {
          commonBySlot.delete(slot);
        }
        continue;
      }
      if (commonButton.button.id === nextButton.id) {
        commonButton.canAnySource = commonButton.canAnySource || nextButton.enabled === true;
        continue;
      }
      if (isAttackMoveButton(commonButton.button) || isAttackMoveButton(nextButton)) {
        continue;
      }
      commonBySlot.delete(slot);
    }

    for (const [slot, currentButton] of currentSetBySlot) {
      if (commonBySlot.has(slot)) {
        continue;
      }
      if (isAttackMoveButton(currentButton)) {
        commonBySlot.set(slot, {
          button: currentButton,
          canAnySource: currentButton.enabled === true,
        });
      }
    }
  }

  return Array.from(commonBySlot.entries())
    .sort(([left], [right]) => left - right)
    .map(([, entry]) => {
      const commandOption = (
        (entry.button.commandOption ?? CommandOption.COMMAND_OPTION_NONE)
        & ~CommandOption.OK_FOR_MULTI_SELECT
      ) >>> 0;
      return {
        ...entry.button,
        commandOption,
        enabled: entry.canAnySource,
      };
    });
}

export function buildControlBarButtonsForSelections(
  iniDataRegistry: IniDataRegistry,
  selections: readonly ControlBarSelectionContext[],
  playerContext?: ControlBarPlayerContext,
): ControlBarButton[] {
  if (selections.length === 0) {
    return [];
  }

  const controlBarButtonSets = selections.map((selection) =>
    buildControlBarButtonsForSelection(iniDataRegistry, selection, playerContext),
  );

  return intersectControlBarButtonLists(controlBarButtonSets);
}
