import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { CommandButtonDef, CommandSetDef, IniDataBundle, ObjectDef, RegistryError } from '@generals/ini-data';

interface MissingReference {
  ownerType: 'Object' | 'CommandSet' | 'CommandButton' | 'SpecialPower';
  ownerName: string;
  referenceType: 'CommandSet' | 'CommandButton' | 'Object' | 'Upgrade' | 'SpecialPower' | 'Science';
  referenceName: string;
  detail: string;
}

interface ConversionParityReport {
  generatedAt: string;
  bundlePath: string;
  summary: {
    objects: number;
    commandButtons: number;
    commandSets: number;
    upgrades: number;
    specialPowers: number;
    sciences: number;
    unsupportedBlockTypes: number;
    unresolvedRegistryErrors: number;
    missingReferences: number;
  };
  unresolvedRegistryErrors: RegistryError[];
  unsupportedBlockTypes: string[];
  missingReferences: MissingReference[];
}

function normalizeToken(token: string | null | undefined): string {
  return token?.trim().toUpperCase() ?? '';
}

function extractFirstToken(value: unknown): string | null {
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

function buildNameSet<T extends { name: string }>(items: readonly T[]): Set<string> {
  return new Set(items.map((item) => normalizeToken(item.name)).filter(Boolean));
}

function resolveCommandType(button: CommandButtonDef): string {
  const fromField = extractFirstToken(button.fields['Command']);
  return normalizeToken(button.commandTypeName ?? fromField);
}

function collectMissingReferences(bundle: IniDataBundle): MissingReference[] {
  const missing: MissingReference[] = [];
  const commandSetNames = buildNameSet(bundle.commandSets ?? []);
  const commandButtonNames = buildNameSet(bundle.commandButtons ?? []);
  const objectNames = buildNameSet(bundle.objects);
  const upgradeNames = buildNameSet(bundle.upgrades);
  const specialPowerNames = buildNameSet(bundle.specialPowers ?? []);
  const scienceNames = buildNameSet(bundle.sciences);

  for (const object of bundle.objects) {
    const commandSetName = normalizeToken(extractFirstToken(object.fields['CommandSet']));
    if (commandSetName && !commandSetNames.has(commandSetName)) {
      missing.push({
        ownerType: 'Object',
        ownerName: object.name,
        referenceType: 'CommandSet',
        referenceName: commandSetName,
        detail: 'Object field CommandSet points to a missing CommandSet.',
      });
    }
  }

  for (const commandSet of bundle.commandSets ?? []) {
    for (const buttonName of extractCommandSetButtonNames(commandSet)) {
      if (commandButtonNames.has(buttonName)) {
        continue;
      }
      missing.push({
        ownerType: 'CommandSet',
        ownerName: commandSet.name,
        referenceType: 'CommandButton',
        referenceName: buttonName,
        detail: 'CommandSet slot references a missing CommandButton.',
      });
    }
  }

  const objectReferenceCommands = new Set(['UNIT_BUILD', 'DOZER_CONSTRUCT', 'SPECIAL_POWER_CONSTRUCT']);
  const upgradeReferenceCommands = new Set(['PLAYER_UPGRADE', 'OBJECT_UPGRADE']);
  const specialPowerReferenceCommands = new Set(['SPECIAL_POWER', 'SPECIAL_POWER_FROM_COMMAND_CENTER', 'SPECIAL_POWER_CONSTRUCT']);

  for (const button of bundle.commandButtons ?? []) {
    const commandType = resolveCommandType(button);
    if (!commandType) {
      continue;
    }

    if (objectReferenceCommands.has(commandType)) {
      const objectName = normalizeToken(extractFirstToken(button.fields['Object']));
      if (objectName && !objectNames.has(objectName)) {
        missing.push({
          ownerType: 'CommandButton',
          ownerName: button.name,
          referenceType: 'Object',
          referenceName: objectName,
          detail: `Command "${commandType}" references a missing Object.`,
        });
      }
    }

    if (upgradeReferenceCommands.has(commandType)) {
      const upgradeName = normalizeToken(extractFirstToken(button.fields['Upgrade']));
      if (upgradeName && !upgradeNames.has(upgradeName)) {
        missing.push({
          ownerType: 'CommandButton',
          ownerName: button.name,
          referenceType: 'Upgrade',
          referenceName: upgradeName,
          detail: `Command "${commandType}" references a missing Upgrade.`,
        });
      }
    }

    if (specialPowerReferenceCommands.has(commandType)) {
      const specialPowerName = normalizeToken(extractFirstToken(button.fields['SpecialPower']));
      if (specialPowerName && !specialPowerNames.has(specialPowerName)) {
        missing.push({
          ownerType: 'CommandButton',
          ownerName: button.name,
          referenceType: 'SpecialPower',
          referenceName: specialPowerName,
          detail: `Command "${commandType}" references a missing SpecialPower.`,
        });
      }
    }
  }

  for (const specialPower of bundle.specialPowers ?? []) {
    const scienceName = normalizeToken(extractFirstToken(specialPower.fields['Science']));
    if (scienceName && !scienceNames.has(scienceName)) {
      missing.push({
        ownerType: 'SpecialPower',
        ownerName: specialPower.name,
        referenceType: 'Science',
        referenceName: scienceName,
        detail: 'SpecialPower field Science points to a missing Science.',
      });
    }
  }

  return missing;
}

async function main(): Promise<void> {
  const scriptPath = fileURLToPath(import.meta.url);
  const projectRoot = path.resolve(path.dirname(scriptPath), '..');
  const bundlePath = path.join(projectRoot, 'packages', 'app', 'public', 'assets', 'data', 'ini-bundle.json');
  const outputPath = path.join(projectRoot, 'conversion-parity-report.json');

  const bundleRaw = await fs.readFile(bundlePath, 'utf8');
  const bundle = JSON.parse(bundleRaw) as IniDataBundle;

  const unresolvedRegistryErrors = (bundle.errors ?? []).filter((error) => error.type === 'unresolved_parent');
  const unsupportedBlockTypes = [...(bundle.unsupportedBlockTypes ?? [])].sort((left, right) =>
    left.localeCompare(right),
  );
  const missingReferences = collectMissingReferences(bundle);

  const report: ConversionParityReport = {
    generatedAt: new Date().toISOString(),
    bundlePath,
    summary: {
      objects: bundle.objects.length,
      commandButtons: (bundle.commandButtons ?? []).length,
      commandSets: (bundle.commandSets ?? []).length,
      upgrades: bundle.upgrades.length,
      specialPowers: (bundle.specialPowers ?? []).length,
      sciences: bundle.sciences.length,
      unsupportedBlockTypes: unsupportedBlockTypes.length,
      unresolvedRegistryErrors: unresolvedRegistryErrors.length,
      missingReferences: missingReferences.length,
    },
    unresolvedRegistryErrors,
    unsupportedBlockTypes,
    missingReferences,
  };

  await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(`Conversion parity report written: ${outputPath}`);
  console.table([
    {
      objects: report.summary.objects,
      commandButtons: report.summary.commandButtons,
      commandSets: report.summary.commandSets,
      upgrades: report.summary.upgrades,
      specialPowers: report.summary.specialPowers,
      sciences: report.summary.sciences,
      unresolvedRegistryErrors: report.summary.unresolvedRegistryErrors,
      unsupportedBlockTypes: report.summary.unsupportedBlockTypes,
      missingReferences: report.summary.missingReferences,
    },
  ]);
}

await main();
