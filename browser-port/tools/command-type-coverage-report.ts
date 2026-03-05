import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { IniDataBundle } from '@generals/ini-data';
import { GUICommandType, guiCommandTypeFromSourceName } from '@generals/ui';

type CoverageStatus = 'supported' | 'unsupported' | 'unknown_command_name';

interface BundleCommandTypeCoverageRow {
  sourceCommandName: string;
  enumName: string | null;
  status: CoverageStatus;
  buttonCount: number;
  buttonIds: string[];
}

interface EnumCoverageRow {
  enumName: string;
  enumValue: number;
  handledByDispatch: boolean;
  referencedByBundle: boolean;
  sourceCommandNames: string[];
}

interface CommandTypeCoverageReport {
  generatedAt: string;
  bundlePath: string;
  dispatchSourcePath: string;
  summary: {
    totalCommandButtons: number;
    distinctBundleCommandTypes: number;
    supportedBundleCommandTypes: number;
    unsupportedBundleCommandTypes: number;
    unknownBundleCommandTypes: number;
    dispatchHandledCommandTypes: number;
  };
  bundleCommandTypeCoverage: BundleCommandTypeCoverageRow[];
  enumCoverage: EnumCoverageRow[];
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

function normalizeSourceCommandName(value: string | null | undefined): string | null {
  const normalized = value?.trim().toUpperCase() ?? '';
  return normalized.length > 0 ? normalized : null;
}

function parseHandledDispatchEnumNames(dispatchSource: string): Set<string> {
  const handled = new Set<string>();
  const caseRegex = /case\s+GUICommandType\.([A-Z0-9_]+)\s*:/g;
  for (;;) {
    const match = caseRegex.exec(dispatchSource);
    if (!match) {
      break;
    }
    const enumName = match[1];
    if (enumName) {
      handled.add(enumName);
    }
  }
  return handled;
}

function getGuiCommandEnumNames(): string[] {
  return Object.keys(GUICommandType).filter((key) => Number.isNaN(Number(key)));
}

async function main(): Promise<void> {
  const scriptPath = fileURLToPath(import.meta.url);
  const projectRoot = path.resolve(path.dirname(scriptPath), '..');
  const bundlePath = path.join(projectRoot, 'packages', 'app', 'public', 'assets', 'data', 'ini-bundle.json');
  const dispatchSourcePath = path.join(projectRoot, 'packages', 'app', 'src', 'control-bar-dispatch.ts');
  const outputPath = path.join(projectRoot, 'command-type-coverage-report.json');

  const [bundleRaw, dispatchSource] = await Promise.all([
    fs.readFile(bundlePath, 'utf8'),
    fs.readFile(dispatchSourcePath, 'utf8'),
  ]);

  const bundle = JSON.parse(bundleRaw) as IniDataBundle;
  const handledDispatchEnumNames = parseHandledDispatchEnumNames(dispatchSource);

  const bySourceCommandName = new Map<string, { buttonIds: string[]; enumName: string | null }>();
  for (const button of bundle.commandButtons ?? []) {
    const sourceCommandName = normalizeSourceCommandName(
      button.commandTypeName ?? extractFirstToken(button.fields['Command']),
    );
    if (!sourceCommandName) {
      continue;
    }
    const existing = bySourceCommandName.get(sourceCommandName);
    if (existing) {
      existing.buttonIds.push(button.name);
      continue;
    }
    const guiCommandType = guiCommandTypeFromSourceName(sourceCommandName);
    const enumName = guiCommandType === null ? null : (GUICommandType[guiCommandType] as string);
    bySourceCommandName.set(sourceCommandName, { buttonIds: [button.name], enumName });
  }

  const bundleCommandTypeCoverage: BundleCommandTypeCoverageRow[] = [...bySourceCommandName.entries()]
    .map(([sourceCommandName, entry]) => {
      let status: CoverageStatus;
      if (entry.enumName === null) {
        status = 'unknown_command_name';
      } else if (handledDispatchEnumNames.has(entry.enumName)) {
        status = 'supported';
      } else {
        status = 'unsupported';
      }
      return {
        sourceCommandName,
        enumName: entry.enumName,
        status,
        buttonCount: entry.buttonIds.length,
        buttonIds: [...entry.buttonIds].sort((left, right) => left.localeCompare(right)),
      };
    })
    .sort((left, right) => left.sourceCommandName.localeCompare(right.sourceCommandName));

  const sourceNamesByEnum = new Map<string, string[]>();
  for (const row of bundleCommandTypeCoverage) {
    if (!row.enumName) {
      continue;
    }
    const names = sourceNamesByEnum.get(row.enumName) ?? [];
    names.push(row.sourceCommandName);
    sourceNamesByEnum.set(row.enumName, names);
  }

  const enumCoverage: EnumCoverageRow[] = getGuiCommandEnumNames()
    .map((enumName) => {
      const enumValue = GUICommandType[enumName as keyof typeof GUICommandType] as unknown as number;
      const sourceCommandNames = sourceNamesByEnum.get(enumName) ?? [];
      return {
        enumName,
        enumValue,
        handledByDispatch: handledDispatchEnumNames.has(enumName),
        referencedByBundle: sourceCommandNames.length > 0,
        sourceCommandNames: [...sourceCommandNames].sort((left, right) => left.localeCompare(right)),
      };
    })
    .sort((left, right) => left.enumValue - right.enumValue);

  const report: CommandTypeCoverageReport = {
    generatedAt: new Date().toISOString(),
    bundlePath,
    dispatchSourcePath,
    summary: {
      totalCommandButtons: (bundle.commandButtons ?? []).length,
      distinctBundleCommandTypes: bundleCommandTypeCoverage.length,
      supportedBundleCommandTypes: bundleCommandTypeCoverage.filter((row) => row.status === 'supported').length,
      unsupportedBundleCommandTypes: bundleCommandTypeCoverage.filter((row) => row.status === 'unsupported').length,
      unknownBundleCommandTypes: bundleCommandTypeCoverage.filter((row) => row.status === 'unknown_command_name').length,
      dispatchHandledCommandTypes: handledDispatchEnumNames.size,
    },
    bundleCommandTypeCoverage,
    enumCoverage,
  };

  await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(`Command-type coverage report written: ${outputPath}`);
  console.table(
    bundleCommandTypeCoverage.map((row) => ({
      sourceCommand: row.sourceCommandName,
      enumName: row.enumName ?? '(unknown)',
      status: row.status,
      buttons: row.buttonCount,
    })),
  );
  console.log('Summary:', report.summary);
}

await main();
