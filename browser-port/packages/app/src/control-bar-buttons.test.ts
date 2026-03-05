import { describe, expect, it } from 'vitest';

import { IniDataRegistry } from '@generals/ini-data';
import { CommandOption, GUICommandType } from '@generals/ui';

import {
  buildControlBarButtonsForSelection,
  buildControlBarButtonsForSelections,
} from './control-bar-buttons.js';

describe('buildControlBarButtonsForSelection', () => {
  it('builds source command-set buttons with preserved slot indices', () => {
    const registry = new IniDataRegistry();
    registry.loadBlocks([
      {
        type: 'Object',
        name: 'UnitA',
        fields: {
          CommandSet: 'UnitSet',
        },
        blocks: [],
      },
      {
        type: 'CommandSet',
        name: 'UnitSet',
        fields: {
          1: 'Command_Stop',
          3: 'Command_AttackMove',
        },
        blocks: [],
      },
      {
        type: 'CommandButton',
        name: 'Command_Stop',
        fields: {
          Command: 'STOP',
          TextLabel: 'CONTROLBAR:Stop',
        },
        blocks: [],
      },
      {
        type: 'CommandButton',
        name: 'Command_AttackMove',
        fields: {
          Command: 'ATTACK_MOVE',
          TextLabel: 'CONTROLBAR:AttackMove',
          Options: 'NEED_TARGET_POS',
        },
        blocks: [],
      },
    ]);

    const buttons = buildControlBarButtonsForSelection(registry, {
      templateName: 'UnitA',
      canMove: true,
      isUnmanned: false,
      isDozer: false,
      isMoving: false,
    });

    expect(buttons).toEqual([
      {
        id: 'Command_Stop',
        slot: 1,
        label: 'Stop',
        commandType: GUICommandType.GUI_COMMAND_STOP,
        commandOption: CommandOption.COMMAND_OPTION_NONE,
        enabled: true,
      },
      {
        id: 'Command_AttackMove',
        slot: 3,
        label: 'AttackMove',
        commandType: GUICommandType.GUI_COMMAND_ATTACK_MOVE,
        commandOption: CommandOption.NEED_TARGET_POS,
        enabled: true,
      },
    ]);
  });

  it('hides all commands for unmanned units per source availability rules', () => {
    const registry = new IniDataRegistry();
    registry.loadBlocks([
      {
        type: 'Object',
        name: 'Vehicle_Unmanned',
        fields: {
          CommandSet: 'Set_Unmanned',
        },
        blocks: [],
      },
      {
        type: 'CommandSet',
        name: 'Set_Unmanned',
        fields: {
          1: 'Command_Stop',
        },
        blocks: [],
      },
      {
        type: 'CommandButton',
        name: 'Command_Stop',
        fields: {
          Command: 'STOP',
        },
        blocks: [],
      },
    ]);

    const buttons = buildControlBarButtonsForSelection(registry, {
      templateName: 'Vehicle_Unmanned',
      canMove: true,
      isUnmanned: true,
      isDozer: false,
      isMoving: false,
    });

    expect(buttons).toEqual([]);
  });

  it('hides all commands when the object is script-disabled', () => {
    const registry = new IniDataRegistry();
    registry.loadBlocks([
      {
        type: 'Object',
        name: 'Vehicle_Unactionable',
        fields: {
          CommandSet: 'Set_Unactionable',
        },
        blocks: [],
      },
      {
        type: 'CommandSet',
        name: 'Set_Unactionable',
        fields: {
          1: 'Command_Stop',
        },
        blocks: [],
      },
      {
        type: 'CommandButton',
        name: 'Command_Stop',
        fields: {
          Command: 'STOP',
        },
        blocks: [],
      },
    ]);

    const buttons = buildControlBarButtonsForSelection(registry, {
      templateName: 'Vehicle_Unactionable',
      canMove: true,
      isUnmanned: false,
      isDozer: false,
      isMoving: false,
      objectStatusFlags: ['SCRIPT_DISABLED'],
    });

    expect(buttons).toEqual([]);
  });

  it('hides all commands when the object is script-unpowered', () => {
    const registry = new IniDataRegistry();
    registry.loadBlocks([
      {
        type: 'Object',
        name: 'Vehicle_Unactionable',
        fields: {
          CommandSet: 'Set_Unactionable',
        },
        blocks: [],
      },
      {
        type: 'CommandSet',
        name: 'Set_Unactionable',
        fields: {
          1: 'Command_Stop',
        },
        blocks: [],
      },
      {
        type: 'CommandButton',
        name: 'Command_Stop',
        fields: {
          Command: 'STOP',
        },
        blocks: [],
      },
    ]);

    const buttons = buildControlBarButtonsForSelection(registry, {
      templateName: 'Vehicle_Unactionable',
      canMove: true,
      isUnmanned: false,
      isDozer: false,
      isMoving: false,
      objectStatusFlags: ['SCRIPT_UNPOWERED'],
    });

    expect(buttons).toEqual([]);
  });

  it('returns no controls for movable units without source command cards', () => {
    const registry = new IniDataRegistry();

    const buttons = buildControlBarButtonsForSelection(registry, {
      templateName: 'Unknown_Movable_Unit',
      canMove: true,
      isUnmanned: false,
      isDozer: false,
      isMoving: false,
    });

    expect(buttons).toEqual([]);
  });

  it('returns no controls for non-movable selections without source cards', () => {
    const registry = new IniDataRegistry();

    const buttons = buildControlBarButtonsForSelection(registry, {
      templateName: 'Unknown_Static_Thing',
      canMove: false,
      isUnmanned: false,
      isDozer: false,
      isMoving: false,
    });

    expect(buttons).toEqual([]);
  });

  it('disables DOZER_CONSTRUCT command for non-dozer selections', () => {
    const registry = new IniDataRegistry();
    registry.loadBlocks([
      {
        type: 'Object',
        name: 'Builder',
        fields: {
          CommandSet: 'BuilderSet',
        },
        blocks: [],
      },
      {
        type: 'CommandSet',
        name: 'BuilderSet',
        fields: {
          1: 'Command_DozerConstruct',
        },
        blocks: [],
      },
      {
        type: 'CommandButton',
        name: 'Command_DozerConstruct',
        fields: {
          Command: 'DOZER_CONSTRUCT',
          Options: 'OK_FOR_MULTI_SELECT',
        },
        blocks: [],
      },
    ]);

    const nonDozerButtons = buildControlBarButtonsForSelection(registry, {
      templateName: 'Builder',
      canMove: true,
      isUnmanned: false,
      isDozer: false,
      isMoving: false,
    });
    expect(nonDozerButtons[0]?.enabled).toBe(false);
    expect(nonDozerButtons[0]?.disabledReason).toBe('DOZER_REQUIRED');

    const dozerButtons = buildControlBarButtonsForSelection(registry, {
      templateName: 'Builder',
      canMove: true,
      isUnmanned: false,
      isDozer: true,
      isMoving: false,
    });
    expect(dozerButtons[0]?.enabled).toBe(true);
  });

  it('enables SET_RALLY_POINT only for AUTO_RALLYPOINT selections', () => {
    const registry = new IniDataRegistry();
    registry.loadBlocks([
      {
        type: 'Object',
        name: 'Barracks',
        fields: {
          CommandSet: 'BarracksSet',
        },
        blocks: [],
      },
      {
        type: 'CommandSet',
        name: 'BarracksSet',
        fields: {
          1: 'Command_SetRallyPoint',
        },
        blocks: [],
      },
      {
        type: 'CommandButton',
        name: 'Command_SetRallyPoint',
        fields: {
          Command: 'SET_RALLY_POINT',
          Options: 'NEED_TARGET_POS',
        },
        blocks: [],
      },
    ]);

    const withoutRallyPointCapability = buildControlBarButtonsForSelection(registry, {
      templateName: 'Barracks',
      canMove: false,
      hasAutoRallyPoint: false,
      isUnmanned: false,
      isDozer: false,
      isMoving: false,
    });
    expect(withoutRallyPointCapability[0]?.enabled).toBe(false);
    expect(withoutRallyPointCapability[0]?.disabledReason).toBe('AUTO_RALLYPOINT_REQUIRED');

    const withRallyPointCapability = buildControlBarButtonsForSelection(registry, {
      templateName: 'Barracks',
      canMove: false,
      hasAutoRallyPoint: true,
      isUnmanned: false,
      isDozer: false,
      isMoving: false,
    });
    expect(withRallyPointCapability[0]?.enabled).toBe(true);
  });

  it('disables MUST_BE_STOPPED commands while selection is moving', () => {
    const registry = new IniDataRegistry();
    registry.loadBlocks([
      {
        type: 'Object',
        name: 'Unit_Move',
        fields: {
          CommandSet: 'Set_Move',
        },
        blocks: [],
      },
      {
        type: 'CommandSet',
        name: 'Set_Move',
        fields: {
          1: 'Command_StopToCast',
        },
        blocks: [],
      },
      {
        type: 'CommandButton',
        name: 'Command_StopToCast',
        fields: {
          Command: 'SPECIAL_POWER',
          Options: 'MUST_BE_STOPPED',
        },
        blocks: [],
      },
    ]);

    const movingButtons = buildControlBarButtonsForSelection(registry, {
      templateName: 'Unit_Move',
      canMove: true,
      isUnmanned: false,
      isDozer: false,
      isMoving: true,
    });
    expect(movingButtons[0]?.enabled).toBe(false);
    expect(movingButtons[0]?.disabledReason).toBe('MUST_BE_STOPPED');

    const stoppedButtons = buildControlBarButtonsForSelection(registry, {
      templateName: 'Unit_Move',
      canMove: true,
      isUnmanned: false,
      isDozer: false,
      isMoving: false,
    });
    expect(stoppedButtons[0]?.enabled).toBe(true);
  });

  it('disables special-power commands when source entity ready frame is in cooldown', () => {
    const registry = new IniDataRegistry();
    registry.loadBlocks([
      {
        type: 'Object',
        name: 'Unit_SpecialPower',
        fields: {
          CommandSet: 'Set_SpecialPower',
        },
        blocks: [],
      },
      {
        type: 'CommandSet',
        name: 'Set_SpecialPower',
        fields: {
          1: 'Command_SpecialPower',
        },
        blocks: [],
      },
      {
        type: 'CommandButton',
        name: 'Command_SpecialPower',
        fields: {
          Command: 'SPECIAL_POWER',
          SpecialPower: 'SpecialPower_MyPower',
        },
        blocks: [],
      },
    ]);

    const buttons = buildControlBarButtonsForSelection(
      registry,
      {
        entityId: 42,
        templateName: 'Unit_SpecialPower',
        canMove: true,
        isUnmanned: false,
        isDozer: false,
        isMoving: false,
      },
      {
        logicFrame: 200,
        resolveSpecialPowerReadyFrame: (specialPowerName, sourceEntityId) => {
          expect(specialPowerName).toBe('SPECIALPOWER_MYPOWER');
          expect(sourceEntityId).toBe(42);
          return 250;
        },
      },
    );

    expect(buttons[0]?.enabled).toBe(false);
    expect(buttons[0]?.disabledReason).toBe('SPECIAL_POWER_COOLDOWN');
  });

  it('keeps special-power commands enabled when source entity ready frame has elapsed', () => {
    const registry = new IniDataRegistry();
    registry.loadBlocks([
      {
        type: 'Object',
        name: 'Unit_SpecialPower',
        fields: {
          CommandSet: 'Set_SpecialPower',
        },
        blocks: [],
      },
      {
        type: 'CommandSet',
        name: 'Set_SpecialPower',
        fields: {
          1: 'Command_SpecialPower',
        },
        blocks: [],
      },
      {
        type: 'CommandButton',
        name: 'Command_SpecialPower',
        fields: {
          Command: 'SPECIAL_POWER',
          SpecialPower: 'SpecialPower_MyPower',
        },
        blocks: [],
      },
    ]);

    const buttons = buildControlBarButtonsForSelection(
      registry,
      {
        entityId: 42,
        templateName: 'Unit_SpecialPower',
        canMove: true,
        isUnmanned: false,
        isDozer: false,
        isMoving: false,
      },
      {
        logicFrame: 250,
        resolveSpecialPowerReadyFrame: () => 250,
      },
    );

    expect(buttons[0]?.enabled).toBe(true);
  });

  it('disables NEED_UPGRADE object commands until the selected object has the upgrade', () => {
    const registry = new IniDataRegistry();
    registry.loadBlocks([
      {
        type: 'Upgrade',
        name: 'Upgrade_ObjectArmor',
        fields: {
          Type: 'OBJECT',
        },
        blocks: [],
      },
      {
        type: 'Object',
        name: 'FactoryWithUpgrade',
        fields: {
          CommandSet: 'FactorySet',
        },
        blocks: [],
      },
      {
        type: 'CommandSet',
        name: 'FactorySet',
        fields: {
          1: 'Command_ObjectUpgradeAction',
        },
        blocks: [],
      },
      {
        type: 'CommandButton',
        name: 'Command_ObjectUpgradeAction',
        fields: {
          Command: 'SPECIAL_POWER',
          Options: 'NEED_UPGRADE',
          Upgrade: 'Upgrade_ObjectArmor',
        },
        blocks: [],
      },
    ]);

    const withoutUpgrade = buildControlBarButtonsForSelection(registry, {
      templateName: 'FactoryWithUpgrade',
      canMove: false,
      isUnmanned: false,
      isDozer: false,
      isMoving: false,
      appliedUpgradeNames: [],
    });
    expect(withoutUpgrade[0]?.enabled).toBe(false);

    const withUpgrade = buildControlBarButtonsForSelection(registry, {
      templateName: 'FactoryWithUpgrade',
      canMove: false,
      isUnmanned: false,
      isDozer: false,
      isMoving: false,
      appliedUpgradeNames: ['upgrade_objectarmor'],
    });
    expect(withUpgrade[0]?.enabled).toBe(true);
  });

  it('disables NEED_UPGRADE player commands until player upgrades include the requirement', () => {
    const registry = new IniDataRegistry();
    registry.loadBlocks([
      {
        type: 'Upgrade',
        name: 'Upgrade_PlayerRadar',
        fields: {
          Type: 'PLAYER',
        },
        blocks: [],
      },
      {
        type: 'Object',
        name: 'SupportVehicle',
        fields: {
          CommandSet: 'SupportSet',
        },
        blocks: [],
      },
      {
        type: 'CommandSet',
        name: 'SupportSet',
        fields: {
          1: 'Command_PlayerUpgradeAction',
        },
        blocks: [],
      },
      {
        type: 'CommandButton',
        name: 'Command_PlayerUpgradeAction',
        fields: {
          Command: 'SPECIAL_POWER',
          Options: 'NEED_UPGRADE',
          Upgrade: 'Upgrade_PlayerRadar',
        },
        blocks: [],
      },
    ]);

    const withoutPlayerUpgrade = buildControlBarButtonsForSelection(registry, {
      templateName: 'SupportVehicle',
      canMove: true,
      isUnmanned: false,
      isDozer: false,
      isMoving: false,
      playerUpgradeNames: [],
    });
    expect(withoutPlayerUpgrade[0]?.enabled).toBe(false);

    const withPlayerUpgrade = buildControlBarButtonsForSelection(registry, {
      templateName: 'SupportVehicle',
      canMove: true,
      isUnmanned: false,
      isDozer: false,
      isMoving: false,
      playerUpgradeNames: ['UPGRADE_PLAYERRADAR'],
    });
    expect(withPlayerUpgrade[0]?.enabled).toBe(true);
  });

  it('uses shared player context for NEED_UPGRADE player commands', () => {
    const registry = new IniDataRegistry();
    registry.loadBlocks([
      {
        type: 'Upgrade',
        name: 'Upgrade_PlayerRadar',
        fields: {
          Type: 'PLAYER',
        },
        blocks: [],
      },
      {
        type: 'Object',
        name: 'SupportVehicle',
        fields: {
          CommandSet: 'SupportSet',
        },
        blocks: [],
      },
      {
        type: 'CommandSet',
        name: 'SupportSet',
        fields: {
          1: 'Command_PlayerUpgradeAction',
        },
        blocks: [],
      },
      {
        type: 'CommandButton',
        name: 'Command_PlayerUpgradeAction',
        fields: {
          Command: 'SPECIAL_POWER',
          Options: 'NEED_UPGRADE',
          Upgrade: 'Upgrade_PlayerRadar',
        },
        blocks: [],
      },
    ]);

    const buttons = buildControlBarButtonsForSelection(
      registry,
      {
        templateName: 'SupportVehicle',
        canMove: true,
        isUnmanned: false,
        isDozer: false,
        isMoving: false,
        playerUpgradeNames: [],
      },
      {
        playerUpgradeNames: ['UPGRADE_PLAYERRADAR'],
      },
    );

    expect(buttons[0]?.enabled).toBe(true);
  });

  it('keeps NEED_UPGRADE commands enabled when no Upgrade template is bound', () => {
    const registry = new IniDataRegistry();
    registry.loadBlocks([
      {
        type: 'Object',
        name: 'Unit_WithMissingUpgradeRef',
        fields: {
          CommandSet: 'Set_MissingUpgrade',
        },
        blocks: [],
      },
      {
        type: 'CommandSet',
        name: 'Set_MissingUpgrade',
        fields: {
          1: 'Command_MissingUpgradeRef',
        },
        blocks: [],
      },
      {
        type: 'CommandButton',
        name: 'Command_MissingUpgradeRef',
        fields: {
          Command: 'SPECIAL_POWER',
          Options: 'NEED_UPGRADE',
        },
        blocks: [],
      },
    ]);

    const buttons = buildControlBarButtonsForSelection(registry, {
      templateName: 'Unit_WithMissingUpgradeRef',
      canMove: true,
      isUnmanned: false,
      isDozer: false,
      isMoving: false,
    });

    expect(buttons[0]?.enabled).toBe(true);
  });

  it('requires all listed sciences for PLAYER_UPGRADE commands', () => {
    const registry = new IniDataRegistry();
    registry.loadBlocks([
      {
        type: 'Object',
        name: 'ScienceHub',
        fields: {
          CommandSet: 'ScienceHubSet',
        },
        blocks: [],
      },
      {
        type: 'CommandSet',
        name: 'ScienceHubSet',
        fields: {
          1: 'Command_ScienceUpgrade',
        },
        blocks: [],
      },
      {
        type: 'CommandButton',
        name: 'Command_ScienceUpgrade',
        fields: {
          Command: 'PLAYER_UPGRADE',
          Science: 'SCIENCE_ALPHA SCIENCE_BETA',
        },
        blocks: [],
      },
    ]);

    const missingScience = buildControlBarButtonsForSelection(registry, {
      templateName: 'ScienceHub',
      canMove: false,
      isUnmanned: false,
      isDozer: false,
      isMoving: false,
      playerScienceNames: ['SCIENCE_ALPHA'],
    });
    expect(missingScience[0]?.enabled).toBe(false);

    const allSciences = buildControlBarButtonsForSelection(registry, {
      templateName: 'ScienceHub',
      canMove: false,
      isUnmanned: false,
      isDozer: false,
      isMoving: false,
      playerScienceNames: ['science_alpha', 'science_beta'],
    });
    expect(allSciences[0]?.enabled).toBe(true);
  });

  it('requires all listed sciences for OBJECT_UPGRADE commands', () => {
    const registry = new IniDataRegistry();
    registry.loadBlocks([
      {
        type: 'Object',
        name: 'WarFactory',
        fields: {
          CommandSet: 'WarFactorySet',
        },
        blocks: [],
      },
      {
        type: 'CommandSet',
        name: 'WarFactorySet',
        fields: {
          1: 'Command_ObjectScienceUpgrade',
        },
        blocks: [],
      },
      {
        type: 'CommandButton',
        name: 'Command_ObjectScienceUpgrade',
        fields: {
          Command: 'OBJECT_UPGRADE',
          Science: 'SCIENCE_GAMMA',
        },
        blocks: [],
      },
    ]);

    const missingScience = buildControlBarButtonsForSelection(registry, {
      templateName: 'WarFactory',
      canMove: false,
      isUnmanned: false,
      isDozer: false,
      isMoving: false,
      playerScienceNames: [],
    });
    expect(missingScience[0]?.enabled).toBe(false);
    expect(missingScience[0]?.disabledReason).toBe('SCIENCE_REQUIRED');

    const ownedScience = buildControlBarButtonsForSelection(registry, {
      templateName: 'WarFactory',
      canMove: false,
      isUnmanned: false,
      isDozer: false,
      isMoving: false,
      playerScienceNames: ['SCIENCE_GAMMA'],
    });
    expect(ownedScience[0]?.enabled).toBe(true);
  });

  it('disables PURCHASE_SCIENCE command when all listed sciences are already owned', () => {
    const registry = new IniDataRegistry();
    registry.loadBlocks([
      {
        type: 'Object',
        name: 'CommandCenter',
        fields: {
          CommandSet: 'ScienceSet',
        },
        blocks: [],
      },
      {
        type: 'CommandSet',
        name: 'ScienceSet',
        fields: {
          1: 'Command_PurchaseScience',
        },
        blocks: [],
      },
      {
        type: 'CommandButton',
        name: 'Command_PurchaseScience',
        fields: {
          Command: 'PURCHASE_SCIENCE',
          Science: 'SCIENCE_ALPHA SCIENCE_BETA',
        },
        blocks: [],
      },
    ]);

    const buttons = buildControlBarButtonsForSelection(registry, {
      templateName: 'CommandCenter',
      canMove: false,
      isUnmanned: false,
      isDozer: false,
      isMoving: false,
      playerScienceNames: ['SCIENCE_ALPHA', 'SCIENCE_BETA'],
    });

    expect(buttons[0]?.enabled).toBe(false);
    expect(buttons[0]?.disabledReason).toBe('SCIENCE_UNAVAILABLE');
  });

  it('enables PURCHASE_SCIENCE when an unowned science has all prerequisite sciences', () => {
    const registry = new IniDataRegistry();
    registry.loadBlocks([
      {
        type: 'Science',
        name: 'SCIENCE_ROOT',
        fields: {
          SciencePurchasePointCost: '1',
        },
        blocks: [],
      },
      {
        type: 'Science',
        name: 'SCIENCE_UNLOCKED',
        fields: {
          PrerequisiteSciences: 'SCIENCE_ROOT',
          SciencePurchasePointCost: '3',
        },
        blocks: [],
      },
      {
        type: 'Object',
        name: 'CommandCenter',
        fields: {
          CommandSet: 'ScienceSet',
        },
        blocks: [],
      },
      {
        type: 'CommandSet',
        name: 'ScienceSet',
        fields: {
          1: 'Command_PurchaseScience',
        },
        blocks: [],
      },
      {
        type: 'CommandButton',
        name: 'Command_PurchaseScience',
        fields: {
          Command: 'PURCHASE_SCIENCE',
          Science: 'SCIENCE_UNLOCKED',
        },
        blocks: [],
      },
    ]);

    const buttons = buildControlBarButtonsForSelection(registry, {
      templateName: 'CommandCenter',
      canMove: false,
      isUnmanned: false,
      isDozer: false,
      isMoving: false,
      playerScienceNames: ['SCIENCE_ROOT'],
      playerSciencePurchasePoints: 3,
    });

    expect(buttons[0]?.enabled).toBe(true);
  });

  it('disables PURCHASE_SCIENCE when unowned sciences are missing prerequisite sciences', () => {
    const registry = new IniDataRegistry();
    registry.loadBlocks([
      {
        type: 'Science',
        name: 'SCIENCE_BRANCH',
        fields: {
          PrerequisiteSciences: 'SCIENCE_ROOT',
          SciencePurchasePointCost: '1',
        },
        blocks: [],
      },
      {
        type: 'Object',
        name: 'CommandCenter',
        fields: {
          CommandSet: 'ScienceSet',
        },
        blocks: [],
      },
      {
        type: 'CommandSet',
        name: 'ScienceSet',
        fields: {
          1: 'Command_PurchaseScience',
        },
        blocks: [],
      },
      {
        type: 'CommandButton',
        name: 'Command_PurchaseScience',
        fields: {
          Command: 'PURCHASE_SCIENCE',
          Science: 'SCIENCE_BRANCH',
        },
        blocks: [],
      },
    ]);

    const buttons = buildControlBarButtonsForSelection(registry, {
      templateName: 'CommandCenter',
      canMove: false,
      isUnmanned: false,
      isDozer: false,
      isMoving: false,
      playerScienceNames: [],
      playerSciencePurchasePoints: 3,
    });

    expect(buttons[0]?.enabled).toBe(false);
    expect(buttons[0]?.disabledReason).toBe('SCIENCE_UNAVAILABLE');
  });

  it('disables build-related commands when production queue is at capacity', () => {
    const registry = new IniDataRegistry();
    registry.loadBlocks([
      {
        type: 'Object',
        name: 'WarFactory',
        fields: {
          CommandSet: 'WarFactorySet',
        },
        blocks: [],
      },
      {
        type: 'CommandSet',
        name: 'WarFactorySet',
        fields: {
          1: 'Command_UnitBuild',
          2: 'Command_ObjectUpgrade',
        },
        blocks: [],
      },
      {
        type: 'CommandButton',
        name: 'Command_UnitBuild',
        fields: {
          Command: 'UNIT_BUILD',
        },
        blocks: [],
      },
      {
        type: 'CommandButton',
        name: 'Command_ObjectUpgrade',
        fields: {
          Command: 'OBJECT_UPGRADE',
        },
        blocks: [],
      },
    ]);

    const buttons = buildControlBarButtonsForSelection(registry, {
      templateName: 'WarFactory',
      canMove: true,
      isUnmanned: false,
      isDozer: false,
      isMoving: false,
      productionQueueEntryCount: 5,
      productionQueueMaxEntries: 5,
    });

    expect(buttons).toEqual([
      {
        id: 'Command_UnitBuild',
        slot: 1,
        label: 'Command_UnitBuild',
        commandType: GUICommandType.GUI_COMMAND_UNIT_BUILD,
        commandOption: CommandOption.COMMAND_OPTION_NONE,
        enabled: false,
        disabledReason: 'PRODUCTION_QUEUE_FULL',
      },
      {
        id: 'Command_ObjectUpgrade',
        slot: 2,
        label: 'Command_ObjectUpgrade',
        commandType: GUICommandType.GUI_COMMAND_OBJECT_UPGRADE,
        commandOption: CommandOption.COMMAND_OPTION_NONE,
        enabled: false,
        disabledReason: 'PRODUCTION_QUEUE_FULL',
      },
    ]);
  });

  it('enables build-related commands when production queue has capacity', () => {
    const registry = new IniDataRegistry();
    registry.loadBlocks([
      {
        type: 'Object',
        name: 'WarFactory',
        fields: {
          CommandSet: 'WarFactorySet',
        },
        blocks: [],
      },
      {
        type: 'CommandSet',
        name: 'WarFactorySet',
        fields: {
          1: 'Command_UnitBuild',
          2: 'Command_ObjectUpgrade',
        },
        blocks: [],
      },
      {
        type: 'CommandButton',
        name: 'Command_UnitBuild',
        fields: {
          Command: 'UNIT_BUILD',
        },
        blocks: [],
      },
      {
        type: 'CommandButton',
        name: 'Command_ObjectUpgrade',
        fields: {
          Command: 'OBJECT_UPGRADE',
        },
        blocks: [],
      },
    ]);

    const buttons = buildControlBarButtonsForSelection(registry, {
      templateName: 'WarFactory',
      canMove: true,
      isUnmanned: false,
      isDozer: false,
      isMoving: false,
      productionQueueEntryCount: 4,
      productionQueueMaxEntries: 5,
    });

    expect(buttons.map((button) => button.enabled)).toEqual([true, true]);
  });

  it('disables PURCHASE_SCIENCE when science cost exceeds available purchase points', () => {
    const registry = new IniDataRegistry();
    registry.loadBlocks([
      {
        type: 'Science',
        name: 'SCIENCE_EXPENSIVE',
        fields: {
          SciencePurchasePointCost: '5',
        },
        blocks: [],
      },
      {
        type: 'Object',
        name: 'CommandCenter',
        fields: {
          CommandSet: 'ScienceSet',
        },
        blocks: [],
      },
      {
        type: 'CommandSet',
        name: 'ScienceSet',
        fields: {
          1: 'Command_PurchaseScience',
        },
        blocks: [],
      },
      {
        type: 'CommandButton',
        name: 'Command_PurchaseScience',
        fields: {
          Command: 'PURCHASE_SCIENCE',
          Science: 'SCIENCE_EXPENSIVE',
        },
        blocks: [],
      },
    ]);

    const buttons = buildControlBarButtonsForSelection(registry, {
      templateName: 'CommandCenter',
      canMove: false,
      isUnmanned: false,
      isDozer: false,
      isMoving: false,
      playerSciencePurchasePoints: 4,
    });

    expect(buttons[0]?.enabled).toBe(false);
    expect(buttons[0]?.disabledReason).toBe('SCIENCE_UNAVAILABLE');
  });

  it('propagates source button image names into control bar icon metadata', () => {
    const registry = new IniDataRegistry();
    registry.loadBlocks([
      {
        type: 'Object',
        name: 'RadarVan',
        fields: {
          CommandSet: 'RadarVanSet',
        },
        blocks: [],
      },
      {
        type: 'CommandSet',
        name: 'RadarVanSet',
        fields: {
          1: 'Command_RadarScan',
        },
        blocks: [],
      },
      {
        type: 'CommandButton',
        name: 'Command_RadarScan',
        fields: {
          Command: 'SPECIAL_POWER',
          ButtonImage: 'SSRadarScan',
        },
        blocks: [],
      },
    ]);

    const buttons = buildControlBarButtonsForSelection(registry, {
      templateName: 'RadarVan',
      canMove: true,
      isUnmanned: false,
      isDozer: false,
      isMoving: false,
    });

    expect(buttons[0]?.iconName).toBe('SSRadarScan');
  });

  it('skips disabled and hidden sciences while resolving PURCHASE_SCIENCE availability', () => {
    const registry = new IniDataRegistry();
    registry.loadBlocks([
      {
        type: 'Science',
        name: 'SCIENCE_DISABLED',
        fields: {
          SciencePurchasePointCost: '1',
        },
        blocks: [],
      },
      {
        type: 'Science',
        name: 'SCIENCE_HIDDEN',
        fields: {
          SciencePurchasePointCost: '1',
        },
        blocks: [],
      },
      {
        type: 'Science',
        name: 'SCIENCE_VISIBLE',
        fields: {
          SciencePurchasePointCost: '2',
        },
        blocks: [],
      },
      {
        type: 'Object',
        name: 'CommandCenter',
        fields: {
          CommandSet: 'ScienceSet',
        },
        blocks: [],
      },
      {
        type: 'CommandSet',
        name: 'ScienceSet',
        fields: {
          1: 'Command_PurchaseScience',
        },
        blocks: [],
      },
      {
        type: 'CommandButton',
        name: 'Command_PurchaseScience',
        fields: {
          Command: 'PURCHASE_SCIENCE',
          Science: 'SCIENCE_DISABLED SCIENCE_HIDDEN SCIENCE_VISIBLE',
        },
        blocks: [],
      },
    ]);

    const buttons = buildControlBarButtonsForSelection(registry, {
      templateName: 'CommandCenter',
      canMove: false,
      isUnmanned: false,
      isDozer: false,
      isMoving: false,
      playerSciencePurchasePoints: 2,
      disabledScienceNames: ['SCIENCE_DISABLED'],
      hiddenScienceNames: ['SCIENCE_HIDDEN'],
    });

    expect(buttons[0]?.enabled).toBe(true);
  });

  it('intersects command cards across multi-selections by slot and button id', () => {
    const registry = new IniDataRegistry();
    registry.loadBlocks([
      {
        type: 'Object',
        name: 'UnitA',
        fields: {
          CommandSet: 'SetA',
        },
        blocks: [],
      },
      {
        type: 'Object',
        name: 'UnitB',
        fields: {
          CommandSet: 'SetB',
        },
        blocks: [],
      },
      {
        type: 'CommandSet',
        name: 'SetA',
        fields: {
          1: 'Command_Stop',
          2: 'Command_AttackMove',
          3: 'Command_OnlyA',
        },
        blocks: [],
      },
      {
        type: 'CommandSet',
        name: 'SetB',
        fields: {
          1: 'Command_Stop',
          2: 'Command_AttackMove',
          3: 'Command_OnlyB',
        },
        blocks: [],
      },
      {
        type: 'CommandButton',
        name: 'Command_Stop',
        fields: {
          Command: 'STOP',
          Options: 'OK_FOR_MULTI_SELECT',
        },
        blocks: [],
      },
      {
        type: 'CommandButton',
        name: 'Command_AttackMove',
        fields: {
          Command: 'ATTACK_MOVE',
          Options: 'OK_FOR_MULTI_SELECT NEED_TARGET_POS',
        },
        blocks: [],
      },
      {
        type: 'CommandButton',
        name: 'Command_OnlyA',
        fields: {
          Command: 'STOP',
          Options: 'OK_FOR_MULTI_SELECT',
        },
        blocks: [],
      },
      {
        type: 'CommandButton',
        name: 'Command_OnlyB',
        fields: {
          Command: 'STOP',
          Options: 'OK_FOR_MULTI_SELECT',
        },
        blocks: [],
      },
    ]);

    const buttons = buildControlBarButtonsForSelections(registry, [
      {
        templateName: 'UnitA',
        canMove: true,
        isUnmanned: false,
        isDozer: false,
        isMoving: false,
      },
      {
        templateName: 'UnitB',
        canMove: true,
        isUnmanned: false,
        isDozer: false,
        isMoving: false,
      },
    ]);

    expect(buttons.map((button) => button.id)).toEqual([
      'Command_Stop',
      'Command_AttackMove',
    ]);
  });

  it('excludes commands that are not OK_FOR_MULTI_SELECT from multi-selection', () => {
    const registry = new IniDataRegistry();
    registry.loadBlocks([
      {
        type: 'Object',
        name: 'UnitA',
        fields: {
          CommandSet: 'SetA',
        },
        blocks: [],
      },
      {
        type: 'Object',
        name: 'UnitB',
        fields: {
          CommandSet: 'SetB',
        },
        blocks: [],
      },
      {
        type: 'CommandSet',
        name: 'SetA',
        fields: {
          1: 'Command_Stop',
        },
        blocks: [],
      },
      {
        type: 'CommandSet',
        name: 'SetB',
        fields: {
          1: 'Command_Stop',
        },
        blocks: [],
      },
      {
        type: 'CommandButton',
        name: 'Command_Stop',
        fields: {
          Command: 'STOP',
        },
        blocks: [],
      },
    ]);

    const buttons = buildControlBarButtonsForSelections(registry, [
      {
        templateName: 'UnitA',
        canMove: true,
        isUnmanned: false,
        isDozer: false,
        isMoving: false,
      },
      {
        templateName: 'UnitB',
        canMove: true,
        isUnmanned: false,
        isDozer: false,
        isMoving: false,
      },
    ]);

    expect(buttons).toEqual([]);
  });

  it('keeps intersected commands enabled when any source can execute them', () => {
    const registry = new IniDataRegistry();
    registry.loadBlocks([
      {
        type: 'Object',
        name: 'Builder',
        fields: {
          CommandSet: 'SetBuilder',
        },
        blocks: [],
      },
      {
        type: 'Object',
        name: 'Base',
        fields: {
          CommandSet: 'SetBase',
        },
        blocks: [],
      },
      {
        type: 'CommandSet',
        name: 'SetBuilder',
        fields: {
          1: 'Command_DozerConstruct',
        },
        blocks: [],
      },
      {
        type: 'CommandSet',
        name: 'SetBase',
        fields: {
          1: 'Command_DozerConstruct',
        },
        blocks: [],
      },
      {
        type: 'CommandButton',
        name: 'Command_DozerConstruct',
        fields: {
          Command: 'DOZER_CONSTRUCT',
          Options: 'OK_FOR_MULTI_SELECT',
        },
        blocks: [],
      },
    ]);

    const buttons = buildControlBarButtonsForSelections(registry, [
      {
        templateName: 'Builder',
        canMove: true,
        isUnmanned: false,
        isDozer: true,
        isMoving: false,
      },
      {
        templateName: 'Base',
        canMove: true,
        isUnmanned: false,
        isDozer: false,
        isMoving: false,
      },
    ]);

    expect(buttons).toEqual([
      {
        id: 'Command_DozerConstruct',
        slot: 1,
        label: 'Command_DozerConstruct',
        commandType: GUICommandType.GUI_COMMAND_DOZER_CONSTRUCT,
        commandOption: CommandOption.COMMAND_OPTION_NONE,
        enabled: true,
      },
    ]);
  });

  it('preserves ATTACK_MOVE slots from non-common selections as source-compatible intersections', () => {
    const registry = new IniDataRegistry();
    registry.loadBlocks([
      {
        type: 'Object',
        name: 'UnitA',
        fields: {
          CommandSet: 'SetA',
        },
        blocks: [],
      },
      {
        type: 'Object',
        name: 'UnitB',
        fields: {
          CommandSet: 'SetB',
        },
        blocks: [],
      },
      {
        type: 'CommandSet',
        name: 'SetA',
        fields: {
          1: 'Command_Stop',
        },
        blocks: [],
      },
      {
        type: 'CommandSet',
        name: 'SetB',
        fields: {
          1: 'Command_Stop',
          2: 'Command_AttackMove',
        },
        blocks: [],
      },
      {
        type: 'CommandButton',
        name: 'Command_Stop',
        fields: {
          Command: 'STOP',
          Options: 'OK_FOR_MULTI_SELECT',
        },
        blocks: [],
      },
      {
        type: 'CommandButton',
        name: 'Command_AttackMove',
        fields: {
          Command: 'ATTACK_MOVE',
          Options: 'OK_FOR_MULTI_SELECT NEED_TARGET_POS',
        },
        blocks: [],
      },
    ]);

    const buttons = buildControlBarButtonsForSelections(registry, [
      {
        templateName: 'UnitA',
        canMove: true,
        isUnmanned: false,
        isDozer: false,
        isMoving: false,
      },
      {
        templateName: 'UnitB',
        canMove: true,
        isUnmanned: false,
        isDozer: false,
        isMoving: false,
      },
    ]);

    expect(buttons.map((button) => button.id)).toEqual([
      'Command_Stop',
      'Command_AttackMove',
    ]);
    expect(buttons).toHaveLength(2);
  });
});
