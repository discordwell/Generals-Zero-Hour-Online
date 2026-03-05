import { describe, expect, it } from 'vitest';

import {
  commandOptionMaskFromSourceNames,
  CommandOption,
  ControlBarModel,
  guiCommandTypeFromSourceName,
  GUICommandType,
  type ControlBarButton,
} from './control-bar.js';

function makeButtons(): ControlBarButton[] {
  return [
    {
      id: 'attack-move',
      label: 'Attack Move',
      commandType: GUICommandType.GUI_COMMAND_ATTACK_MOVE,
      commandOption: CommandOption.NEED_TARGET_POS,
    },
    {
      id: 'stop',
      label: 'Stop',
      commandType: GUICommandType.GUI_COMMAND_STOP,
      commandOption: CommandOption.COMMAND_OPTION_NONE,
    },
    {
      id: 'sell',
      label: 'Sell',
      commandType: GUICommandType.GUI_COMMAND_SELL,
      enabled: false,
    },
  ];
}

describe('ControlBarModel', () => {
  it('enters pending mode for NEED_TARGET_POS commands and commits command targets', () => {
    const model = new ControlBarModel();
    model.setSelectionState({
      selectedObjectIds: [7, 9],
      selectedObjectName: 'Crusader Tank',
    });
    model.setButtons(makeButtons());

    const activation = model.activateButton('attack-move');
    expect(activation.status).toBe('needs-target');
    expect(model.getPendingCommand()).toEqual({
      sourceButtonId: 'attack-move',
      commandType: GUICommandType.GUI_COMMAND_ATTACK_MOVE,
      commandOption: CommandOption.NEED_TARGET_POS,
      targetKind: 'position',
    });

    const committed = model.commitPendingCommandTarget({
      kind: 'position',
      x: 10,
      y: 0,
      z: 40,
    });

    expect(committed).toEqual({
      sourceButtonId: 'attack-move',
      commandType: GUICommandType.GUI_COMMAND_ATTACK_MOVE,
      commandOption: CommandOption.NEED_TARGET_POS,
      selectedObjectIds: [7, 9],
      targetPosition: [10, 0, 40],
    });
    expect(model.getPendingCommand()).toBeNull();

    expect(model.consumeIssuedCommands()).toEqual([
      {
        sourceButtonId: 'attack-move',
        commandType: GUICommandType.GUI_COMMAND_ATTACK_MOVE,
        commandOption: CommandOption.NEED_TARGET_POS,
        selectedObjectIds: [7, 9],
        targetPosition: [10, 0, 40],
      },
    ]);
    expect(model.consumeIssuedCommands()).toEqual([]);
  });

  it('issues immediate commands for non-targeted buttons', () => {
    const model = new ControlBarModel();
    model.setButtons(makeButtons());

    const activation = model.activateButton('stop');
    expect(activation.status).toBe('issued');
    if (activation.status !== 'issued') {
      throw new Error('Expected immediate command issuance');
    }

    expect(activation.command.commandType).toBe(GUICommandType.GUI_COMMAND_STOP);
    expect(activation.command.selectedObjectIds).toEqual([]);

    expect(model.consumeIssuedCommands()).toEqual([activation.command]);
  });

  it('enters pending mode for object-target commands and commits object targets', () => {
    const model = new ControlBarModel();
    model.setSelectionState({
      selectedObjectIds: [3],
      selectedObjectName: 'Tank Hunter',
    });
    model.setButtons([
      {
        id: 'guard',
        label: 'Guard',
        commandType: GUICommandType.GUI_COMMAND_GUARD,
        commandOption: CommandOption.NEED_TARGET_ENEMY_OBJECT,
      },
    ]);

    const activation = model.activateButton('guard');
    expect(activation.status).toBe('needs-target');
    expect(model.getPendingCommand()?.targetKind).toBe('object');

    const committed = model.commitPendingCommandTarget({
      kind: 'object',
      objectId: 22,
    });
    expect(committed).toEqual({
      sourceButtonId: 'guard',
      commandType: GUICommandType.GUI_COMMAND_GUARD,
      commandOption: CommandOption.NEED_TARGET_ENEMY_OBJECT,
      selectedObjectIds: [3],
      targetObjectId: 22,
    });
  });

  it('rejects object targets when validator marks them invalid and keeps pending command active', () => {
    const model = new ControlBarModel();
    model.setSelectionState({
      selectedObjectIds: [3],
      selectedObjectName: 'Tank Hunter',
    });
    model.setButtons([
      {
        id: 'guard',
        label: 'Guard',
        commandType: GUICommandType.GUI_COMMAND_GUARD,
        commandOption: CommandOption.NEED_TARGET_ENEMY_OBJECT,
      },
    ]);
    model.setObjectTargetValidator((validation) => {
      expect(validation.sourceButtonId).toBe('guard');
      expect(validation.selectedObjectIds).toEqual([3]);
      expect(validation.targetObjectId).toBe(22);
      return false;
    });

    model.activateButton('guard');
    expect(model.commitPendingCommandTarget({
      kind: 'object',
      objectId: 22,
    })).toBeNull();
    expect(model.getPendingCommand()?.sourceButtonId).toBe('guard');
    expect(model.consumeIssuedCommands()).toEqual([]);
  });

  it('prioritizes object targets when options include both object and position bits', () => {
    const model = new ControlBarModel();
    model.setSelectionState({
      selectedObjectIds: [5],
      selectedObjectName: 'Humvee',
    });
    model.setButtons([
      {
        id: 'mixed-target',
        label: 'MixedTarget',
        commandType: GUICommandType.GUI_COMMAND_SPECIAL_POWER,
        commandOption:
          CommandOption.NEED_TARGET_ENEMY_OBJECT |
          CommandOption.NEED_TARGET_POS,
      },
    ]);

    const activation = model.activateButton('mixed-target');
    expect(activation.status).toBe('needs-target');
    expect(model.getPendingCommand()?.targetKind).toBe('object');

    const committed = model.commitPendingCommandTarget({
      kind: 'object',
      objectId: 99,
    });
    expect(committed).toEqual({
      sourceButtonId: 'mixed-target',
      commandType: GUICommandType.GUI_COMMAND_SPECIAL_POWER,
      commandOption:
        CommandOption.NEED_TARGET_ENEMY_OBJECT |
        CommandOption.NEED_TARGET_POS,
      selectedObjectIds: [5],
      targetObjectId: 99,
    });
  });

  it('forces placement targets for SPECIAL_POWER_CONSTRUCT commands', () => {
    const model = new ControlBarModel();
    model.setSelectionState({
      selectedObjectIds: [42],
      selectedObjectName: 'Command Center',
    });
    model.setButtons([
      {
        id: 'construct-special',
        label: 'Construct Special',
        commandType: GUICommandType.GUI_COMMAND_SPECIAL_POWER_CONSTRUCT,
        commandOption: CommandOption.COMMAND_OPTION_NONE,
      },
    ]);

    const activation = model.activateButton('construct-special');
    expect(activation.status).toBe('needs-target');
    expect(model.getPendingCommand()).toEqual({
      sourceButtonId: 'construct-special',
      commandType: GUICommandType.GUI_COMMAND_SPECIAL_POWER_CONSTRUCT,
      commandOption: CommandOption.COMMAND_OPTION_NONE,
      targetKind: 'position',
    });
  });

  it('reports disabled and missing buttons without creating commands', () => {
    const model = new ControlBarModel();
    model.setButtons(makeButtons());

    expect(model.activateButton('sell')).toEqual({
      status: 'disabled',
      buttonId: 'sell',
    });
    expect(model.activateButton('missing')).toEqual({
      status: 'missing',
      buttonId: 'missing',
    });

    expect(model.consumeIssuedCommands()).toEqual([]);
  });

  it('rejects mismatched target kinds and preserves pending command', () => {
    const model = new ControlBarModel();
    model.setButtons(makeButtons());

    model.activateButton('attack-move');
    const mismatch = model.commitPendingCommandTarget({
      kind: 'object',
      objectId: 22,
    });

    expect(mismatch).toBeNull();
    expect(model.getPendingCommand()).not.toBeNull();

    model.cancelPendingCommand();
    expect(model.getPendingCommand()).toBeNull();
  });

  it('maps source command names and options into runtime enums/masks', () => {
    expect(guiCommandTypeFromSourceName('ATTACK_MOVE')).toBe(
      GUICommandType.GUI_COMMAND_ATTACK_MOVE,
    );
    expect(guiCommandTypeFromSourceName('GUI_COMMAND_STOP')).toBe(
      GUICommandType.GUI_COMMAND_STOP,
    );
    expect(guiCommandTypeFromSourceName('SPECIAL_POWER_FROM_COMMAND_CENTER')).toBe(
      GUICommandType.GUI_COMMAND_SPECIAL_POWER_FROM_COMMAND_CENTER,
    );
    expect(guiCommandTypeFromSourceName('invalid')).toBeNull();

    expect(
      commandOptionMaskFromSourceNames([
        'NEED_TARGET_POS',
        'OK_FOR_MULTI_SELECT',
      ]),
    ).toBe(
      CommandOption.NEED_TARGET_POS | CommandOption.OK_FOR_MULTI_SELECT,
    );
  });

  it('preserves source slot metadata on runtime button snapshots', () => {
    const model = new ControlBarModel();
    model.setButtons([
      {
        id: 'slot-1',
        slot: 1,
        label: 'First',
        commandType: GUICommandType.GUI_COMMAND_STOP,
      },
      {
        id: 'slot-3',
        slot: 3,
        label: 'Third',
        commandType: GUICommandType.GUI_COMMAND_ATTACK_MOVE,
        commandOption: CommandOption.NEED_TARGET_POS,
      },
    ]);

    expect(model.getButtons()).toEqual([
      {
        id: 'slot-1',
        slot: 1,
        label: 'First',
        commandType: GUICommandType.GUI_COMMAND_STOP,
        commandOption: CommandOption.COMMAND_OPTION_NONE,
        enabled: true,
      },
      {
        id: 'slot-3',
        slot: 3,
        label: 'Third',
        commandType: GUICommandType.GUI_COMMAND_ATTACK_MOVE,
        commandOption: CommandOption.NEED_TARGET_POS,
        enabled: true,
      },
    ]);
  });

  it('filters SCRIPT_ONLY commands from user-visible command cards', () => {
    const model = new ControlBarModel();
    model.setButtons([
      {
        id: 'script-only',
        label: 'ScriptOnly',
        commandType: GUICommandType.GUI_COMMAND_STOP,
        commandOption: CommandOption.SCRIPT_ONLY,
      },
      {
        id: 'normal',
        label: 'Normal',
        commandType: GUICommandType.GUI_COMMAND_STOP,
      },
    ]);

    expect(model.getButtons().map((button) => button.id)).toEqual(['normal']);
  });

  it('applies source multi-select filtering and keeps ATTACK_MOVE exception', () => {
    const model = new ControlBarModel();
    model.setSelectionState({
      selectedObjectIds: [1, 2],
      selectedObjectName: 'Mixed squad',
    });
    model.setButtons([
      {
        id: 'attack-move',
        label: 'Attack Move',
        commandType: GUICommandType.GUI_COMMAND_ATTACK_MOVE,
        commandOption: CommandOption.NEED_TARGET_POS,
      },
      {
        id: 'stop',
        label: 'Stop',
        commandType: GUICommandType.GUI_COMMAND_STOP,
      },
      {
        id: 'waypoints',
        label: 'Waypoints',
        commandType: GUICommandType.GUI_COMMAND_WAYPOINTS,
        commandOption: CommandOption.OK_FOR_MULTI_SELECT,
      },
    ]);

    expect(model.getButtons().map((button) => button.id)).toEqual([
      'attack-move',
      'waypoints',
    ]);
  });

  it('activates slotted commands through source slot indices', () => {
    const model = new ControlBarModel();
    model.setSelectionState({
      selectedObjectIds: [11],
      selectedObjectName: 'Tank',
    });
    model.setButtons([
      {
        id: 'slot-3-attack-move',
        slot: 3,
        label: 'Attack Move',
        commandType: GUICommandType.GUI_COMMAND_ATTACK_MOVE,
        commandOption: CommandOption.NEED_TARGET_POS,
      },
    ]);

    expect(model.activateSlot(2)).toEqual({
      status: 'missing',
      buttonId: 'slot:2',
    });

    const activation = model.activateSlot(3);
    expect(activation.status).toBe('needs-target');

    const committed = model.commitPendingCommandTarget({
      kind: 'position',
      x: 25,
      y: 0,
      z: 40,
    });
    expect(committed).toEqual({
      sourceButtonId: 'slot-3-attack-move',
      commandType: GUICommandType.GUI_COMMAND_ATTACK_MOVE,
      commandOption: CommandOption.NEED_TARGET_POS,
      selectedObjectIds: [11],
      targetPosition: [25, 0, 40],
    });
  });

  it('activates 10-12 slot buttons by slot index', () => {
    const model = new ControlBarModel();
    model.setSelectionState({
      selectedObjectIds: [4],
      selectedObjectName: 'Tank',
    });
    model.setButtons([
      {
        id: 'slot-10-stop',
        slot: 10,
        label: 'Stop',
        commandType: GUICommandType.GUI_COMMAND_STOP,
      },
    ]);

    const activation = model.activateSlot(10);
    expect(activation.status).toBe('issued');
    if (activation.status !== 'issued') {
      throw new Error('Expected slot 10 command to issue');
    }

    expect(activation.command).toEqual({
      sourceButtonId: 'slot-10-stop',
      commandType: GUICommandType.GUI_COMMAND_STOP,
      commandOption: CommandOption.COMMAND_OPTION_NONE,
      selectedObjectIds: [4],
    });
  });

  it('projects commands into fixed 12-slot snapshots', () => {
    const model = new ControlBarModel();
    model.setButtons([
      {
        id: 'slot-1-stop',
        slot: 1,
        label: 'Stop',
        commandType: GUICommandType.GUI_COMMAND_STOP,
      },
      {
        id: 'slot-4-move',
        slot: 4,
        label: 'Move',
        commandType: GUICommandType.GUI_COMMAND_WAYPOINTS,
      },
      {
        id: 'slot-1-duplicate',
        slot: 1,
        label: 'Duplicate',
        commandType: GUICommandType.GUI_COMMAND_STOP,
      },
    ]);

    const slotted = model.getButtonsBySlot();
    expect(slotted).toHaveLength(12);
    expect(slotted[0]).toEqual({
      slot: 1,
      button: {
        id: 'slot-1-stop',
        slot: 1,
        label: 'Stop',
        commandType: GUICommandType.GUI_COMMAND_STOP,
        commandOption: CommandOption.COMMAND_OPTION_NONE,
        enabled: true,
      },
    });
    expect(slotted[1]).toEqual({
      slot: 2,
      button: null,
    });
    expect(slotted[3]).toEqual({
      slot: 4,
      button: {
        id: 'slot-4-move',
        slot: 4,
        label: 'Move',
        commandType: GUICommandType.GUI_COMMAND_WAYPOINTS,
        commandOption: CommandOption.COMMAND_OPTION_NONE,
        enabled: true,
      },
    });
  });

  it('builds HUD slot states with pending/disabled/requirement metadata', () => {
    const model = new ControlBarModel();
    model.setButtons([
      {
        id: 'slot-1-attack',
        slot: 1,
        label: 'Attack Move',
        commandType: GUICommandType.GUI_COMMAND_ATTACK_MOVE,
        commandOption: CommandOption.NEED_TARGET_POS,
      },
      {
        id: 'slot-2-stop',
        slot: 2,
        label: 'Stop',
        commandType: GUICommandType.GUI_COMMAND_STOP,
        enabled: false,
        disabledReason: 'MUST_BE_STOPPED',
        iconName: 'SSTOP',
      },
      {
        id: 'slot-3-sp-construct',
        slot: 3,
        label: 'Build Power',
        commandType: GUICommandType.GUI_COMMAND_SPECIAL_POWER_CONSTRUCT,
      },
    ]);

    const activation = model.activateSlot(1);
    expect(activation.status).toBe('needs-target');

    const hud = model.getHudSlots();
    expect(hud).toHaveLength(12);
    expect(hud[0]).toEqual({
      slot: 1,
      state: 'pending',
      label: 'Attack Move',
      targetRequirement: 'target:position',
      sourceButtonId: 'slot-1-attack',
      hotkey: '1',
    });
    expect(hud[1]).toEqual({
      slot: 2,
      state: 'disabled',
      label: 'Stop',
      targetRequirement: 'instant',
      sourceButtonId: 'slot-2-stop',
      hotkey: '2',
      disabledReason: 'MUST_BE_STOPPED',
      iconName: 'SSTOP',
    });
    expect(hud[2]).toEqual({
      slot: 3,
      state: 'ready',
      label: 'Build Power',
      targetRequirement: 'target:position',
      sourceButtonId: 'slot-3-sp-construct',
      hotkey: '3',
    });
    expect(hud[3]).toEqual({
      slot: 4,
      state: 'empty',
      label: '',
      targetRequirement: 'instant',
      hotkey: '4',
    });
  });

  it('extracts source command hotkeys from ampersand label markers', () => {
    const model = new ControlBarModel();
    model.setButtons([
      {
        id: 'slot-1-attack',
        slot: 1,
        label: '&Attack Move',
        commandType: GUICommandType.GUI_COMMAND_ATTACK_MOVE,
        commandOption: CommandOption.NEED_TARGET_POS,
      },
      {
        id: 'slot-2-stop',
        slot: 2,
        label: 'Stop &',
        commandType: GUICommandType.GUI_COMMAND_STOP,
      },
    ]);

    const hud = model.getHudSlots();
    expect(hud[0]?.hotkey).toBe('a');
    expect(hud[1]?.hotkey).toBe('2');
  });

  it('assigns numeric/top-row hotkeys for 12 control bar slots', () => {
    const model = new ControlBarModel();
    const hud = model.getHudSlots();

    expect(hud[0]?.hotkey).toBe('1');
    expect(hud[8]?.hotkey).toBe('9');
    expect(hud[9]?.hotkey).toBe('0');
    expect(hud[10]?.hotkey).toBe('-');
    expect(hud[11]?.hotkey).toBe('=');
  });
});
