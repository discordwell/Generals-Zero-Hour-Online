/**
 * Control bar command primitives modeled after Generals `ControlBar.h`.
 *
 * This file ports command option bits and command typing so gameplay/UI flow
 * can move away from ad-hoc overlay actions.
 */

export enum CommandOption {
  COMMAND_OPTION_NONE = 0x00000000,
  NEED_TARGET_ENEMY_OBJECT = 0x00000001,
  NEED_TARGET_NEUTRAL_OBJECT = 0x00000002,
  NEED_TARGET_ALLY_OBJECT = 0x00000004,
  // Compatibility aliases used in legacy command-dispatch tests/callers.
  NEED_OBJECT_TARGET = 0x00000007,
  COMMAND_OPTION_NEED_OBJECT_TARGET = 0x00000007,
  ALLOW_SHRUBBERY_TARGET = 0x00000010,
  NEED_TARGET_POS = 0x00000020,
  NEED_UPGRADE = 0x00000040,
  NEED_SPECIAL_POWER_SCIENCE = 0x00000080,
  OK_FOR_MULTI_SELECT = 0x00000100,
  CONTEXTMODE_COMMAND = 0x00000200,
  CHECK_LIKE = 0x00000400,
  ALLOW_MINE_TARGET = 0x00000800,
  ATTACK_OBJECTS_POSITION = 0x00001000,
  OPTION_ONE = 0x00002000,
  OPTION_TWO = 0x00004000,
  OPTION_THREE = 0x00008000,
  NOT_QUEUEABLE = 0x00010000,
  SINGLE_USE_COMMAND = 0x00020000,
  COMMAND_FIRED_BY_SCRIPT = 0x00040000,
  SCRIPT_ONLY = 0x00080000,
  IGNORES_UNDERPOWERED = 0x00100000,
  USES_MINE_CLEARING_WEAPONSET = 0x00200000,
  CAN_USE_WAYPOINTS = 0x00400000,
  MUST_BE_STOPPED = 0x00800000,
}

export const COMMAND_OPTION_NEED_TARGET =
  CommandOption.NEED_TARGET_ENEMY_OBJECT |
  CommandOption.NEED_TARGET_NEUTRAL_OBJECT |
  CommandOption.NEED_TARGET_ALLY_OBJECT |
  CommandOption.NEED_TARGET_POS |
  CommandOption.CONTEXTMODE_COMMAND;

export const COMMAND_OPTION_NEED_OBJECT_TARGET =
  CommandOption.NEED_TARGET_ENEMY_OBJECT |
  CommandOption.NEED_TARGET_NEUTRAL_OBJECT |
  CommandOption.NEED_TARGET_ALLY_OBJECT;

export enum GUICommandType {
  GUI_COMMAND_NONE = 0,
  GUI_COMMAND_DOZER_CONSTRUCT,
  GUI_COMMAND_DOZER_CONSTRUCT_CANCEL,
  GUI_COMMAND_UNIT_BUILD,
  GUI_COMMAND_CANCEL_UNIT_BUILD,
  GUI_COMMAND_PLAYER_UPGRADE,
  GUI_COMMAND_OBJECT_UPGRADE,
  GUI_COMMAND_CANCEL_UPGRADE,
  GUI_COMMAND_ATTACK_MOVE,
  GUI_COMMAND_GUARD,
  GUI_COMMAND_GUARD_WITHOUT_PURSUIT,
  GUI_COMMAND_GUARD_FLYING_UNITS_ONLY,
  GUI_COMMAND_STOP,
  GUI_COMMAND_WAYPOINTS,
  GUI_COMMAND_EXIT_CONTAINER,
  GUI_COMMAND_EVACUATE,
  GUI_COMMAND_EXECUTE_RAILED_TRANSPORT,
  GUI_COMMAND_BEACON_DELETE,
  GUI_COMMAND_SET_RALLY_POINT,
  GUI_COMMAND_SELL,
  GUI_COMMAND_FIRE_WEAPON,
  GUI_COMMAND_SPECIAL_POWER,
  GUI_COMMAND_PURCHASE_SCIENCE,
  GUI_COMMAND_HACK_INTERNET,
  GUI_COMMAND_TOGGLE_OVERCHARGE,
  GUI_COMMAND_COMBATDROP,
  GUI_COMMAND_SWITCH_WEAPON,
  GUICOMMANDMODE_HIJACK_VEHICLE,
  GUICOMMANDMODE_CONVERT_TO_CARBOMB,
  GUICOMMANDMODE_SABOTAGE_BUILDING,
  GUICOMMANDMODE_PLACE_BEACON,
  GUI_COMMAND_SPECIAL_POWER_FROM_COMMAND_CENTER,
  GUI_COMMAND_SPECIAL_POWER_FROM_SHORTCUT,
  GUI_COMMAND_SPECIAL_POWER_CONSTRUCT,
  GUI_COMMAND_SPECIAL_POWER_CONSTRUCT_FROM_SHORTCUT,
  GUI_COMMAND_SELECT_ALL_UNITS_OF_TYPE,
  GUI_COMMAND_NUM_COMMANDS,
}

/**
 * Source parity: ZH ControlBar.h MAX_COMMANDS_PER_SET = 18.
 * Generals used 12. ZH expanded to 18 (14 visible + 4 script-only).
 */
const SOURCE_MAX_COMMANDS_PER_SET = 18;

/**
 * Source parity: ZH UI layout has 14 visible command buttons.
 * Slots 15-18 are script-only (not rendered in the HUD).
 */
const SOURCE_VISIBLE_HUD_SLOTS = 14;

const GUI_COMMAND_NAME_TO_TYPE = new Map<string, GUICommandType>([
  ['NONE', GUICommandType.GUI_COMMAND_NONE],
  ['DOZER_CONSTRUCT', GUICommandType.GUI_COMMAND_DOZER_CONSTRUCT],
  ['DOZER_CONSTRUCT_CANCEL', GUICommandType.GUI_COMMAND_DOZER_CONSTRUCT_CANCEL],
  ['UNIT_BUILD', GUICommandType.GUI_COMMAND_UNIT_BUILD],
  ['CANCEL_UNIT_BUILD', GUICommandType.GUI_COMMAND_CANCEL_UNIT_BUILD],
  ['PLAYER_UPGRADE', GUICommandType.GUI_COMMAND_PLAYER_UPGRADE],
  ['OBJECT_UPGRADE', GUICommandType.GUI_COMMAND_OBJECT_UPGRADE],
  ['CANCEL_UPGRADE', GUICommandType.GUI_COMMAND_CANCEL_UPGRADE],
  ['ATTACK_MOVE', GUICommandType.GUI_COMMAND_ATTACK_MOVE],
  ['GUARD', GUICommandType.GUI_COMMAND_GUARD],
  ['GUARD_WITHOUT_PURSUIT', GUICommandType.GUI_COMMAND_GUARD_WITHOUT_PURSUIT],
  ['GUARD_FLYING_UNITS_ONLY', GUICommandType.GUI_COMMAND_GUARD_FLYING_UNITS_ONLY],
  ['STOP', GUICommandType.GUI_COMMAND_STOP],
  ['WAYPOINTS', GUICommandType.GUI_COMMAND_WAYPOINTS],
  ['EXIT_CONTAINER', GUICommandType.GUI_COMMAND_EXIT_CONTAINER],
  ['EVACUATE', GUICommandType.GUI_COMMAND_EVACUATE],
  ['EXECUTE_RAILED_TRANSPORT', GUICommandType.GUI_COMMAND_EXECUTE_RAILED_TRANSPORT],
  ['BEACON_DELETE', GUICommandType.GUI_COMMAND_BEACON_DELETE],
  ['SET_RALLY_POINT', GUICommandType.GUI_COMMAND_SET_RALLY_POINT],
  ['SELL', GUICommandType.GUI_COMMAND_SELL],
  ['FIRE_WEAPON', GUICommandType.GUI_COMMAND_FIRE_WEAPON],
  ['SPECIAL_POWER', GUICommandType.GUI_COMMAND_SPECIAL_POWER],
  ['PURCHASE_SCIENCE', GUICommandType.GUI_COMMAND_PURCHASE_SCIENCE],
  ['HACK_INTERNET', GUICommandType.GUI_COMMAND_HACK_INTERNET],
  ['TOGGLE_OVERCHARGE', GUICommandType.GUI_COMMAND_TOGGLE_OVERCHARGE],
  ['COMBATDROP', GUICommandType.GUI_COMMAND_COMBATDROP],
  ['SWITCH_WEAPON', GUICommandType.GUI_COMMAND_SWITCH_WEAPON],
  ['HIJACK_VEHICLE', GUICommandType.GUICOMMANDMODE_HIJACK_VEHICLE],
  ['CONVERT_TO_CARBOMB', GUICommandType.GUICOMMANDMODE_CONVERT_TO_CARBOMB],
  ['SABOTAGE_BUILDING', GUICommandType.GUICOMMANDMODE_SABOTAGE_BUILDING],
  ['PLACE_BEACON', GUICommandType.GUICOMMANDMODE_PLACE_BEACON],
  ['SPECIAL_POWER_FROM_COMMAND_CENTER', GUICommandType.GUI_COMMAND_SPECIAL_POWER_FROM_COMMAND_CENTER],
  ['SPECIAL_POWER_FROM_SHORTCUT', GUICommandType.GUI_COMMAND_SPECIAL_POWER_FROM_SHORTCUT],
  ['SPECIAL_POWER_CONSTRUCT', GUICommandType.GUI_COMMAND_SPECIAL_POWER_CONSTRUCT],
  ['SPECIAL_POWER_CONSTRUCT_FROM_SHORTCUT', GUICommandType.GUI_COMMAND_SPECIAL_POWER_CONSTRUCT_FROM_SHORTCUT],
  ['SELECT_ALL_UNITS_OF_TYPE', GUICommandType.GUI_COMMAND_SELECT_ALL_UNITS_OF_TYPE],
]);

const COMMAND_OPTION_NAME_TO_MASK = new Map<string, number>([
  ['NEED_TARGET_ENEMY_OBJECT', CommandOption.NEED_TARGET_ENEMY_OBJECT],
  ['NEED_TARGET_NEUTRAL_OBJECT', CommandOption.NEED_TARGET_NEUTRAL_OBJECT],
  ['NEED_TARGET_ALLY_OBJECT', CommandOption.NEED_TARGET_ALLY_OBJECT],
  ['ALLOW_SHRUBBERY_TARGET', CommandOption.ALLOW_SHRUBBERY_TARGET],
  ['NEED_TARGET_POS', CommandOption.NEED_TARGET_POS],
  ['NEED_UPGRADE', CommandOption.NEED_UPGRADE],
  ['NEED_SPECIAL_POWER_SCIENCE', CommandOption.NEED_SPECIAL_POWER_SCIENCE],
  ['OK_FOR_MULTI_SELECT', CommandOption.OK_FOR_MULTI_SELECT],
  ['CONTEXTMODE_COMMAND', CommandOption.CONTEXTMODE_COMMAND],
  ['CHECK_LIKE', CommandOption.CHECK_LIKE],
  ['ALLOW_MINE_TARGET', CommandOption.ALLOW_MINE_TARGET],
  ['ATTACK_OBJECTS_POSITION', CommandOption.ATTACK_OBJECTS_POSITION],
  ['OPTION_ONE', CommandOption.OPTION_ONE],
  ['OPTION_TWO', CommandOption.OPTION_TWO],
  ['OPTION_THREE', CommandOption.OPTION_THREE],
  ['NOT_QUEUEABLE', CommandOption.NOT_QUEUEABLE],
  ['SINGLE_USE_COMMAND', CommandOption.SINGLE_USE_COMMAND],
  ['SCRIPT_ONLY', CommandOption.SCRIPT_ONLY],
  ['IGNORES_UNDERPOWERED', CommandOption.IGNORES_UNDERPOWERED],
  ['USES_MINE_CLEARING_WEAPONSET', CommandOption.USES_MINE_CLEARING_WEAPONSET],
  ['CAN_USE_WAYPOINTS', CommandOption.CAN_USE_WAYPOINTS],
  ['MUST_BE_STOPPED', CommandOption.MUST_BE_STOPPED],
]);

export function guiCommandTypeFromSourceName(name: string): GUICommandType | null {
  const normalized = name.trim().toUpperCase();
  if (!normalized) {
    return null;
  }

  const withoutPrefix = normalized.replace(/^GUI_COMMAND_/, '').replace(/^GUICOMMANDMODE_/, '');
  return GUI_COMMAND_NAME_TO_TYPE.get(withoutPrefix) ?? null;
}

export function commandOptionMaskFromSourceNames(optionNames: readonly string[]): number {
  let mask = CommandOption.COMMAND_OPTION_NONE;

  for (const optionName of optionNames) {
    const normalized = optionName.trim().toUpperCase();
    if (!normalized) {
      continue;
    }
    const optionMask = COMMAND_OPTION_NAME_TO_MASK.get(normalized);
    if (optionMask !== undefined) {
      mask |= optionMask;
    }
  }

  return mask;
}

export type ControlBarTargetKind = 'none' | 'object' | 'position' | 'context';
export type ControlBarTargetRequirement = 'instant' | 'target:object' | 'target:position' | 'target:context';

export interface ControlBarSelectionState {
  selectedObjectIds: readonly number[];
  selectedObjectName: string;
}

export interface ControlBarButton {
  id: string;
  slot?: number;
  label: string;
  commandType: GUICommandType;
  commandOption?: number;
  enabled?: boolean;
  disabledReason?: string;
  iconName?: string;
}

export interface PendingControlBarCommand {
  sourceButtonId: string;
  commandType: GUICommandType;
  commandOption: number;
  targetKind: ControlBarTargetKind;
}

export type ControlBarCommandTarget =
  | { kind: 'object'; objectId: number }
  | { kind: 'position'; x: number; y: number; z: number; angle?: number }
  | { kind: 'context'; payload: unknown }
  | { kind: 'cancel' };

export interface IssuedControlBarCommand {
  sourceButtonId: string;
  commandType: GUICommandType;
  commandOption: number;
  selectedObjectIds: number[];
  targetObjectId?: number;
  targetPosition?: readonly [number, number, number];
  angle?: number;
  contextPayload?: unknown;
}

export interface ControlBarObjectTargetValidation {
  sourceButtonId: string;
  commandType: GUICommandType;
  commandOption: number;
  selectedObjectIds: readonly number[];
  targetObjectId: number;
}

export type ControlBarObjectTargetValidator =
  (validation: ControlBarObjectTargetValidation) => boolean;

export interface ControlBarHudSlot {
  slot: number;
  state: 'empty' | 'ready' | 'disabled' | 'pending';
  label: string;
  targetRequirement: ControlBarTargetRequirement;
  sourceButtonId?: string;
  hotkey?: string;
  disabledReason?: string;
  iconName?: string;
}

export type ControlBarActivationResult =
  | {
      status: 'missing';
      buttonId: string;
    }
  | {
      status: 'disabled';
      buttonId: string;
    }
  | {
      status: 'needs-target';
      pendingCommand: PendingControlBarCommand;
    }
  | {
      status: 'issued';
      command: IssuedControlBarCommand;
    };

interface NormalizedControlBarButton {
  id: string;
  slot?: number;
  label: string;
  commandType: GUICommandType;
  commandOption: number;
  enabled: boolean;
  disabledReason?: string;
  iconName?: string;
}

const EMPTY_SELECTION: ControlBarSelectionState = {
  selectedObjectIds: [],
  selectedObjectName: '',
};

function resolveTargetKind(
  commandType: GUICommandType,
  commandOption: number,
): ControlBarTargetKind {
  if (
    commandType === GUICommandType.GUI_COMMAND_SPECIAL_POWER_CONSTRUCT
    || commandType === GUICommandType.GUI_COMMAND_SPECIAL_POWER_CONSTRUCT_FROM_SHORTCUT
  ) {
    // Source behavior from ControlBar::processCommandUI + PlaceEventTranslator:
    // construct-special commands always enter placement mode and require a world
    // target location.
    return 'position';
  }

  if ((commandOption & COMMAND_OPTION_NEED_OBJECT_TARGET) !== 0) {
    return 'object';
  }
  if ((commandOption & CommandOption.NEED_TARGET_POS) !== 0) {
    // Source behavior from InGameUI::canSelectedObjectsDoSpecialPower:
    // object-target requirements are evaluated before position-target requirements.
    return 'position';
  }
  if ((commandOption & CommandOption.CONTEXTMODE_COMMAND) !== 0) {
    return 'context';
  }
  return 'none';
}

function targetRequirementFromButton(
  commandType: GUICommandType,
  commandOption: number,
): ControlBarTargetRequirement {
  const targetKind = resolveTargetKind(commandType, commandOption);
  switch (targetKind) {
    case 'object':
      return 'target:object';
    case 'position':
      return 'target:position';
    case 'context':
      return 'target:context';
    case 'none':
    default:
      return 'instant';
  }
}

function sourceSlotHotkey(slot: number): string | undefined {
  if (slot >= 1 && slot <= 9) {
    return `${slot}`;
  }
  if (slot === 10) {
    return '0';
  }
  if (slot === 11) {
    return '-';
  }
  if (slot === 12) {
    return '=';
  }
  return undefined;
}

function sourceLabelHotkey(label: string): string | undefined {
  // Source behavior from HotKeyManager::searchHotKey:
  // command hotkeys come from '&' marker in localized command labels.
  const markerOffset = label.indexOf('&');
  if (markerOffset < 0 || markerOffset >= label.length - 1) {
    return undefined;
  }

  const hotkey = label.charAt(markerOffset + 1).trim();
  if (!hotkey) {
    return undefined;
  }

  return hotkey.toLowerCase();
}

function normalizeButton(button: ControlBarButton): NormalizedControlBarButton | null {
  const id = button.id.trim();
  if (!id) {
    return null;
  }

  const commandOption = button.commandOption ?? CommandOption.COMMAND_OPTION_NONE;
  if ((commandOption & CommandOption.SCRIPT_ONLY) !== 0) {
    return null;
  }

  return {
    id,
    slot: Number.isInteger(button.slot) && (button.slot ?? 0) > 0 ? button.slot : undefined,
    label: button.label,
    commandType: button.commandType,
    commandOption,
    enabled: button.enabled ?? true,
    disabledReason: typeof button.disabledReason === 'string' && button.disabledReason.trim()
      ? button.disabledReason.trim()
      : undefined,
    iconName: typeof button.iconName === 'string' && button.iconName.trim()
      ? button.iconName.trim()
      : undefined,
  };
}

function shouldExposeForCurrentSelection(
  button: NormalizedControlBarButton,
  selectionState: ControlBarSelectionState,
): boolean {
  if (selectionState.selectedObjectIds.length <= 1) {
    return true;
  }

  if ((button.commandOption & CommandOption.OK_FOR_MULTI_SELECT) !== 0) {
    return true;
  }

  // Source behavior from ControlBarMultiSelect::addCommonCommands:
  // Attack Move is retained in mixed selections when present.
  if (button.commandType === GUICommandType.GUI_COMMAND_ATTACK_MOVE) {
    return true;
  }

  return false;
}

export class ControlBarModel {
  private selectionState: ControlBarSelectionState = EMPTY_SELECTION;
  private buttons: NormalizedControlBarButton[] = [];
  private buttonsById = new Map<string, NormalizedControlBarButton>();
  private buttonsBySlot = new Map<number, NormalizedControlBarButton>();
  private pendingCommand: PendingControlBarCommand | null = null;
  private issuedCommands: IssuedControlBarCommand[] = [];
  private objectTargetValidator: ControlBarObjectTargetValidator | null = null;

  setSelectionState(selectionState: ControlBarSelectionState): void {
    this.selectionState = {
      selectedObjectIds: [...selectionState.selectedObjectIds],
      selectedObjectName: selectionState.selectedObjectName,
    };
  }

  getSelectionState(): ControlBarSelectionState {
    return {
      selectedObjectIds: [...this.selectionState.selectedObjectIds],
      selectedObjectName: this.selectionState.selectedObjectName,
    };
  }

  setButtons(buttons: readonly ControlBarButton[]): void {
    this.buttons = [];
    this.buttonsById.clear();
    this.buttonsBySlot.clear();

    for (const button of buttons) {
      const normalized = normalizeButton(button);
      if (!normalized) {
        continue;
      }
      if (!shouldExposeForCurrentSelection(normalized, this.selectionState)) {
        continue;
      }
      this.buttons.push(normalized);
      this.buttonsById.set(normalized.id, normalized);
      if (
        normalized.slot !== undefined
        && normalized.slot >= 1
        && normalized.slot <= SOURCE_MAX_COMMANDS_PER_SET
        && !this.buttonsBySlot.has(normalized.slot)
      ) {
        this.buttonsBySlot.set(normalized.slot, normalized);
      }
    }

    if (this.pendingCommand && !this.buttonsById.has(this.pendingCommand.sourceButtonId)) {
      this.pendingCommand = null;
    }
  }

  getButtons(): readonly ControlBarButton[] {
    return this.buttons.map((button) => {
      const snapshot: ControlBarButton = {
        id: button.id,
        slot: button.slot,
        label: button.label,
        commandType: button.commandType,
        commandOption: button.commandOption,
        enabled: button.enabled,
      };
      if (button.disabledReason) {
        snapshot.disabledReason = button.disabledReason;
      }
      if (button.iconName) {
        snapshot.iconName = button.iconName;
      }
      return snapshot;
    });
  }

  getPendingCommand(): PendingControlBarCommand | null {
    if (!this.pendingCommand) {
      return null;
    }
    return {
      sourceButtonId: this.pendingCommand.sourceButtonId,
      commandType: this.pendingCommand.commandType,
      commandOption: this.pendingCommand.commandOption,
      targetKind: this.pendingCommand.targetKind,
    };
  }

  setObjectTargetValidator(
    validator: ControlBarObjectTargetValidator | null,
  ): void {
    this.objectTargetValidator = validator;
  }

  activateButton(buttonId: string): ControlBarActivationResult {
    const button = this.buttonsById.get(buttonId);
    if (!button) {
      return { status: 'missing', buttonId };
    }

    if (!button.enabled) {
      return { status: 'disabled', buttonId };
    }

    const targetKind = resolveTargetKind(button.commandType, button.commandOption);
    if (targetKind !== 'none') {
      this.pendingCommand = {
        sourceButtonId: button.id,
        commandType: button.commandType,
        commandOption: button.commandOption,
        targetKind,
      };
      return {
        status: 'needs-target',
        pendingCommand: {
          sourceButtonId: button.id,
          commandType: button.commandType,
          commandOption: button.commandOption,
          targetKind,
        },
      };
    }

    const command = this.issueCommand(button, null);
    return {
      status: 'issued',
      command,
    };
  }

  activateSlot(slot: number): ControlBarActivationResult {
    const button = this.buttonsBySlot.get(slot);
    if (!button) {
      return {
        status: 'missing',
        buttonId: `slot:${slot}`,
      };
    }

    return this.activateButton(button.id);
  }

  getButtonsBySlot(
    maxSlots = SOURCE_MAX_COMMANDS_PER_SET,
  ): ReadonlyArray<{ slot: number; button: ControlBarButton | null }> {
    const slots: Array<{ slot: number; button: ControlBarButton | null }> = [];
    const clampedMax = Math.max(1, Math.trunc(maxSlots));
    for (let slot = 1; slot <= clampedMax; slot += 1) {
      const button = this.buttonsBySlot.get(slot);
      if (!button) {
        slots.push({
          slot,
          button: null,
        });
        continue;
      }

      slots.push({
        slot,
        button: (() => {
          const snapshot: ControlBarButton = {
          id: button.id,
          slot: button.slot,
          label: button.label,
          commandType: button.commandType,
          commandOption: button.commandOption,
          enabled: button.enabled,
          };
          if (button.disabledReason) {
            snapshot.disabledReason = button.disabledReason;
          }
          if (button.iconName) {
            snapshot.iconName = button.iconName;
          }
          return snapshot;
        })(),
      });
    }

    return slots;
  }

  getHudSlots(maxSlots = SOURCE_VISIBLE_HUD_SLOTS): ReadonlyArray<ControlBarHudSlot> {
    const slots: ControlBarHudSlot[] = [];
    const clampedMax = Math.max(1, Math.trunc(maxSlots));

    for (let slot = 1; slot <= clampedMax; slot += 1) {
      const button = this.buttonsBySlot.get(slot);
      if (!button) {
        slots.push({
          slot,
          state: 'empty',
          label: '',
          targetRequirement: 'instant',
          hotkey: sourceSlotHotkey(slot),
        });
        continue;
      }

      const hudSlot: ControlBarHudSlot = {
        slot,
        state: this.pendingCommand?.sourceButtonId === button.id
          ? 'pending'
          : button.enabled
            ? 'ready'
            : 'disabled',
        label: button.label,
        targetRequirement: targetRequirementFromButton(button.commandType, button.commandOption),
        sourceButtonId: button.id,
        hotkey: sourceLabelHotkey(button.label) ?? sourceSlotHotkey(slot),
      };
      if (!button.enabled && button.disabledReason) {
        hudSlot.disabledReason = button.disabledReason;
      }
      if (button.iconName) {
        hudSlot.iconName = button.iconName;
      }
      slots.push(hudSlot);
    }

    return slots;
  }

  cancelPendingCommand(): void {
    this.pendingCommand = null;
  }

  commitPendingCommandTarget(target: ControlBarCommandTarget): IssuedControlBarCommand | null {
    const pending = this.pendingCommand;
    if (!pending) {
      return null;
    }

    if (target.kind === 'cancel') {
      this.pendingCommand = null;
      return null;
    }

    if (target.kind !== pending.targetKind) {
      return null;
    }

    const button = this.buttonsById.get(pending.sourceButtonId);
    if (!button) {
      this.pendingCommand = null;
      return null;
    }

    if (target.kind === 'object' && this.objectTargetValidator) {
      const isValidTarget = this.objectTargetValidator({
        sourceButtonId: button.id,
        commandType: button.commandType,
        commandOption: button.commandOption,
        selectedObjectIds: this.selectionState.selectedObjectIds,
        targetObjectId: target.objectId,
      });
      if (!isValidTarget) {
        return null;
      }
    }

    const command = this.issueCommand(button, target);
    this.pendingCommand = null;
    return command;
  }

  consumeIssuedCommands(): IssuedControlBarCommand[] {
    if (this.issuedCommands.length === 0) {
      return [];
    }

    const issued = this.issuedCommands;
    this.issuedCommands = [];
    return issued;
  }

  private issueCommand(
    button: NormalizedControlBarButton,
    target: ControlBarCommandTarget | null,
  ): IssuedControlBarCommand {
    const command: IssuedControlBarCommand = {
      sourceButtonId: button.id,
      commandType: button.commandType,
      commandOption: button.commandOption,
      selectedObjectIds: [...this.selectionState.selectedObjectIds],
    };

    if (target?.kind === 'object') {
      command.targetObjectId = target.objectId;
    }

    if (target?.kind === 'position') {
      command.targetPosition = [target.x, target.y, target.z];
      if (target.angle !== undefined) {
        command.angle = target.angle;
      }
    }

    if (target?.kind === 'context') {
      command.contextPayload = target.payload;
    }

    this.issuedCommands.push(command);
    return command;
  }
}
