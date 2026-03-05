import type { IniValue } from '@generals/core';
import type { CommandSetDef, IniDataBundle } from '@generals/ini-data';
import { GUICommandType, guiCommandTypeFromSourceName } from '@generals/ui';

interface RuntimeManifestLike {
  hasOutputPath(outputPath: string): boolean;
}

function normalizeToken(value: string | null | undefined): string {
  return value?.trim().toUpperCase() ?? '';
}

function extractFirstToken(value: IniValue | undefined): string | null {
  if (typeof value === 'string') {
    const token = value.trim();
    return token.length > 0 ? token : null;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const token = extractFirstToken(entry);
      if (token) {
        return token;
      }
    }
  }
  return null;
}

function extractCommandSetButtonNames(commandSet: CommandSetDef): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  const append = (name: string | null): void => {
    const normalized = normalizeToken(name);
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    names.push(normalized);
  };

  if (Array.isArray(commandSet.slottedButtons)) {
    for (const slot of commandSet.slottedButtons) {
      append(slot.commandButtonName);
    }
  }

  if (Array.isArray(commandSet.buttons)) {
    for (const buttonName of commandSet.buttons) {
      append(buttonName);
    }
  }

  for (let slot = 1; slot <= 12; slot += 1) {
    append(extractFirstToken(commandSet.fields[String(slot)]));
  }

  return names;
}

function buildNameSet(values: readonly { name: string }[]): Set<string> {
  return new Set(values.map((value) => normalizeToken(value.name)).filter(Boolean));
}

function resolveCommandTypeName(commandButton: { fields: Record<string, IniValue>; commandTypeName?: string }): string | null {
  return normalizeToken(commandButton.commandTypeName ?? extractFirstToken(commandButton.fields['Command']));
}

export function assertRequiredManifestEntries(
  manifest: RuntimeManifestLike | null,
  requiredOutputPaths: readonly string[],
): void {
  if (!manifest) {
    throw new Error('Required runtime manifest is unavailable.');
  }

  const missing = requiredOutputPaths.filter((outputPath) => !manifest.hasOutputPath(outputPath));
  if (missing.length > 0) {
    throw new Error(`Runtime manifest is missing required assets: ${missing.join(', ')}`);
  }
}

export function assertIniBundleConsistency(bundle: IniDataBundle): void {
  const statsMismatches: string[] = [];
  const expectedStats = {
    objects: bundle.objects.length,
    weapons: bundle.weapons.length,
    armors: bundle.armors.length,
    upgrades: bundle.upgrades.length,
    sciences: bundle.sciences.length,
    factions: bundle.factions.length,
    audioEvents: (bundle.audioEvents ?? []).length,
    commandButtons: (bundle.commandButtons ?? []).length,
    commandSets: (bundle.commandSets ?? []).length,
  } as const;

  for (const [key, expected] of Object.entries(expectedStats)) {
    const actual = bundle.stats[key as keyof typeof expectedStats];
    if (actual !== expected) {
      statsMismatches.push(`${key}: stats=${actual}, actual=${expected}`);
    }
  }
  if (statsMismatches.length > 0) {
    throw new Error(`INI bundle stats mismatch: ${statsMismatches.join('; ')}`);
  }

  const unresolvedInheritanceErrors = bundle.errors.filter((error) => error.type === 'unresolved_parent');
  if (unresolvedInheritanceErrors.length > 0) {
    throw new Error(`INI bundle has ${unresolvedInheritanceErrors.length} unresolved inheritance error(s).`);
  }

  const commandSetNames = new Set((bundle.commandSets ?? []).map((set) => normalizeToken(set.name)).filter(Boolean));
  const commandButtonNames = new Set((bundle.commandButtons ?? []).map((button) => normalizeToken(button.name)).filter(Boolean));
  const objectNames = buildNameSet(bundle.objects);
  const upgradeNames = buildNameSet(bundle.upgrades);
  const specialPowerNames = buildNameSet(bundle.specialPowers ?? []);
  const scienceNames = buildNameSet(bundle.sciences);

  const missingCommandSets: string[] = [];
  for (const object of bundle.objects) {
    const commandSetName = normalizeToken(extractFirstToken(object.fields['CommandSet']));
    if (commandSetName && !commandSetNames.has(commandSetName)) {
      missingCommandSets.push(`${object.name}->${commandSetName}`);
    }
  }
  if (missingCommandSets.length > 0) {
    throw new Error(`INI bundle has missing CommandSet references: ${missingCommandSets.join(', ')}`);
  }

  const missingCommandButtons: string[] = [];
  for (const commandSet of bundle.commandSets ?? []) {
    for (const buttonName of extractCommandSetButtonNames(commandSet)) {
      if (!commandButtonNames.has(buttonName)) {
        missingCommandButtons.push(`${commandSet.name}->${buttonName}`);
      }
    }
  }
  if (missingCommandButtons.length > 0) {
    throw new Error(`INI bundle has missing CommandButton references: ${missingCommandButtons.join(', ')}`);
  }

  const commandButtonIssues: string[] = [];
  const objectRefCommands = new Set<GUICommandType>([
    GUICommandType.GUI_COMMAND_UNIT_BUILD,
    GUICommandType.GUI_COMMAND_DOZER_CONSTRUCT,
    GUICommandType.GUI_COMMAND_SPECIAL_POWER_CONSTRUCT,
    GUICommandType.GUI_COMMAND_SPECIAL_POWER_CONSTRUCT_FROM_SHORTCUT,
  ]);
  const upgradeRefCommands = new Set<GUICommandType>([
    GUICommandType.GUI_COMMAND_OBJECT_UPGRADE,
    GUICommandType.GUI_COMMAND_PLAYER_UPGRADE,
    GUICommandType.GUI_COMMAND_CANCEL_UPGRADE,
  ]);
  const specialPowerRefCommands = new Set<GUICommandType>([
    GUICommandType.GUI_COMMAND_SPECIAL_POWER,
    GUICommandType.GUI_COMMAND_SPECIAL_POWER_FROM_COMMAND_CENTER,
    GUICommandType.GUI_COMMAND_SPECIAL_POWER_FROM_SHORTCUT,
    GUICommandType.GUI_COMMAND_SPECIAL_POWER_CONSTRUCT,
    GUICommandType.GUI_COMMAND_SPECIAL_POWER_CONSTRUCT_FROM_SHORTCUT,
  ]);

  for (const commandButton of bundle.commandButtons ?? []) {
    const commandTypeName = resolveCommandTypeName(commandButton);
    if (!commandTypeName) {
      continue;
    }
    const commandType = guiCommandTypeFromSourceName(commandTypeName);
    if (commandType === null) {
      continue;
    }

    const objectName = normalizeToken(extractFirstToken(commandButton.fields['Object']));
    if (objectRefCommands.has(commandType)) {
      if (!objectName) {
        commandButtonIssues.push(`${commandButton.name}: command ${commandTypeName} requires Object.`);
      } else if (!objectNames.has(objectName)) {
        commandButtonIssues.push(`${commandButton.name}: Object "${objectName}" is missing.`);
      }
    }

    const upgradeName = normalizeToken(extractFirstToken(commandButton.fields['Upgrade']));
    if (upgradeRefCommands.has(commandType)) {
      if (!upgradeName) {
        commandButtonIssues.push(`${commandButton.name}: command ${commandTypeName} requires Upgrade.`);
      } else if (!upgradeNames.has(upgradeName)) {
        commandButtonIssues.push(`${commandButton.name}: Upgrade "${upgradeName}" is missing.`);
      }
    }

    const specialPowerName = normalizeToken(extractFirstToken(commandButton.fields['SpecialPower']));
    if (specialPowerRefCommands.has(commandType)) {
      if (!specialPowerName) {
        commandButtonIssues.push(`${commandButton.name}: command ${commandTypeName} requires SpecialPower.`);
      } else if (!specialPowerNames.has(specialPowerName)) {
        commandButtonIssues.push(`${commandButton.name}: SpecialPower "${specialPowerName}" is missing.`);
      }
    }

    if (commandType === GUICommandType.GUI_COMMAND_PURCHASE_SCIENCE) {
      const scienceName = normalizeToken(extractFirstToken(commandButton.fields['Science']));
      if (!scienceName) {
        commandButtonIssues.push(`${commandButton.name}: command ${commandTypeName} requires Science.`);
      } else if (!scienceNames.has(scienceName)) {
        commandButtonIssues.push(`${commandButton.name}: Science "${scienceName}" is missing.`);
      }
    }

    if (commandType === GUICommandType.GUI_COMMAND_SELECT_ALL_UNITS_OF_TYPE) {
      const thingTemplate = normalizeToken(extractFirstToken(commandButton.fields['ThingTemplate']));
      if (!objectName && !thingTemplate) {
        commandButtonIssues.push(`${commandButton.name}: command ${commandTypeName} requires Object/ThingTemplate.`);
      } else {
        const selectionTarget = objectName || thingTemplate;
        if (selectionTarget && !objectNames.has(selectionTarget)) {
          commandButtonIssues.push(`${commandButton.name}: Object/ThingTemplate "${selectionTarget}" is missing.`);
        }
      }
    }
  }

  if (commandButtonIssues.length > 0) {
    throw new Error(`INI bundle has invalid CommandButton references: ${commandButtonIssues.join(', ')}`);
  }
}
