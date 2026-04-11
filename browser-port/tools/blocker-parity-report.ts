import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface BlockerFinding {
  id: string;
  area: string;
  count: number;
  details: string[];
}

export interface BlockerParityReport {
  generatedAt: string;
  status: 'clear' | 'blocked';
  summary: {
    blockerGroups: number;
    blockerItems: number;
  };
  blockers: BlockerFinding[];
}

export interface BlockerReportInputs {
  conversionParity?: {
    unsupportedBlockTypes?: unknown[];
    unresolvedRegistryErrors?: unknown[];
    missingReferences?: unknown[];
  } | null;
  commandCoverage?: {
    summary?: {
      unsupportedBundleCommandTypes?: number;
      unknownBundleCommandTypes?: number;
    };
    bundleCommandTypeCoverage?: Array<{
      sourceCommandName?: string;
      status?: string;
    }>;
  } | null;
  scriptCoverage?: {
    summary?: {
      missingActionTypesUsed?: number;
      missingConditionTypesUsed?: number;
      unknownActionTypeIdsUsed?: number;
      unknownConditionTypeIdsUsed?: number;
      knownActionTypeIdsMissingImplementation?: number;
      knownConditionTypeIdsMissingImplementation?: number;
    };
  } | null;
  prerequisiteCoverage?: {
    missingReferences?: unknown[];
    objectCycles?: unknown[];
    scienceCycles?: unknown[];
  } | null;
  saveGeneratedModuleCoverage?: {
    totalSourceModuleTypes?: number;
    coveredSourceModuleTypes?: number;
    missingSourceModuleTypes?: Array<{
      moduleType?: string;
      count?: number;
      exampleObjectName?: string | null;
    }>;
  } | null;
  visualSceneParity?: {
    summary?: {
      blockedScenarios?: number;
    };
    scenarios?: Array<{
      name?: string;
      status?: string;
      blockingIssues?: string[];
    }>;
  } | null;
  uiLayoutParity?: {
    summary?: {
      blockedScenarios?: number;
    };
    scenarios?: Array<{
      name?: string;
      status?: string;
      blockingIssues?: string[];
    }>;
  } | null;
}

function normalizeCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function pushBlocker(
  blockers: BlockerFinding[],
  id: string,
  area: string,
  count: number,
  details: string[],
): void {
  const normalizedCount = normalizeCount(count);
  if (normalizedCount <= 0) {
    return;
  }
  blockers.push({
    id,
    area,
    count: normalizedCount,
    details,
  });
}

export function collectBlockerFindings(inputs: BlockerReportInputs): BlockerFinding[] {
  const blockers: BlockerFinding[] = [];

  if (!inputs.conversionParity) {
    pushBlocker(blockers, 'conversion-report-missing', 'conversion', 1, ['conversion-parity-report.json missing']);
  } else {
    const unsupportedBlockTypes = inputs.conversionParity.unsupportedBlockTypes ?? [];
    const unresolvedRegistryErrors = inputs.conversionParity.unresolvedRegistryErrors ?? [];
    const missingReferences = inputs.conversionParity.missingReferences ?? [];
    pushBlocker(
      blockers,
      'conversion-unsupported-block-types',
      'conversion',
      Array.isArray(unsupportedBlockTypes) ? unsupportedBlockTypes.length : 0,
      ['Unsupported INI block types were emitted by conversion.'],
    );
    pushBlocker(
      blockers,
      'conversion-unresolved-registry-errors',
      'conversion',
      Array.isArray(unresolvedRegistryErrors) ? unresolvedRegistryErrors.length : 0,
      ['Unresolved registry errors remain in converted data.'],
    );
    pushBlocker(
      blockers,
      'conversion-missing-references',
      'conversion',
      Array.isArray(missingReferences) ? missingReferences.length : 0,
      ['Missing reference edges remain in converted data.'],
    );
  }

  if (!inputs.commandCoverage) {
    pushBlocker(blockers, 'command-coverage-report-missing', 'command-card', 1, ['command-type-coverage-report.json missing']);
  } else {
    const unsupported = normalizeCount(inputs.commandCoverage.summary?.unsupportedBundleCommandTypes);
    const unknown = normalizeCount(inputs.commandCoverage.summary?.unknownBundleCommandTypes);
    const unresolvedCommands = (inputs.commandCoverage.bundleCommandTypeCoverage ?? [])
      .filter((row) => row.status === 'unsupported' || row.status === 'unknown_command_name')
      .map((row) => row.sourceCommandName ?? '(unnamed)')
      .slice(0, 10);
    pushBlocker(
      blockers,
      'command-coverage-unsupported-types',
      'command-card',
      unsupported + unknown,
      unresolvedCommands.length > 0
        ? [`Unsupported command source names: ${unresolvedCommands.join(', ')}`]
        : ['Command coverage contains unsupported or unknown command types.'],
    );
  }

  if (!inputs.scriptCoverage) {
    pushBlocker(blockers, 'script-coverage-report-missing', 'scripts', 1, ['script-coverage-report.json missing']);
  } else {
    const summary = inputs.scriptCoverage.summary ?? {};
    const missingUsed = normalizeCount(summary.missingActionTypesUsed) + normalizeCount(summary.missingConditionTypesUsed);
    const unknownUsed = normalizeCount(summary.unknownActionTypeIdsUsed) + normalizeCount(summary.unknownConditionTypeIdsUsed);
    const engineKnownMissing =
      normalizeCount(summary.knownActionTypeIdsMissingImplementation)
      + normalizeCount(summary.knownConditionTypeIdsMissingImplementation);
    pushBlocker(
      blockers,
      'script-coverage-missing-used-types',
      'scripts',
      missingUsed,
      ['Maps reference script actions/conditions that are not implemented.'],
    );
    pushBlocker(
      blockers,
      'script-coverage-unknown-used-type-ids',
      'scripts',
      unknownUsed,
      ['Maps contain unknown script action/condition IDs.'],
    );
    pushBlocker(
      blockers,
      'script-engine-known-missing-implementations',
      'scripts',
      engineKnownMissing,
      ['Known script type IDs are still marked missing in engine coverage.'],
    );
  }

  if (!inputs.prerequisiteCoverage) {
    pushBlocker(blockers, 'prerequisite-report-missing', 'prerequisites', 1, ['prerequisite-chain-report.json missing']);
  } else {
    const missingReferences = inputs.prerequisiteCoverage.missingReferences ?? [];
    const objectCycles = inputs.prerequisiteCoverage.objectCycles ?? [];
    const scienceCycles = inputs.prerequisiteCoverage.scienceCycles ?? [];
    pushBlocker(
      blockers,
      'prerequisite-missing-references',
      'prerequisites',
      Array.isArray(missingReferences) ? missingReferences.length : 0,
      ['Prerequisite graph has missing references.'],
    );
    pushBlocker(
      blockers,
      'prerequisite-object-cycles',
      'prerequisites',
      Array.isArray(objectCycles) ? objectCycles.length : 0,
      ['Object prerequisite graph has cycles.'],
    );
    pushBlocker(
      blockers,
      'prerequisite-science-cycles',
      'prerequisites',
      Array.isArray(scienceCycles) ? scienceCycles.length : 0,
      ['Science prerequisite graph has cycles.'],
    );
  }

  if (!inputs.saveGeneratedModuleCoverage) {
    pushBlocker(
      blockers,
      'save-generated-module-coverage-report-missing',
      'save-files',
      1,
      ['save-generated-module-coverage-report.json missing'],
    );
  } else {
    const total = normalizeCount(inputs.saveGeneratedModuleCoverage.totalSourceModuleTypes);
    const covered = normalizeCount(inputs.saveGeneratedModuleCoverage.coveredSourceModuleTypes);
    const missing = inputs.saveGeneratedModuleCoverage.missingSourceModuleTypes ?? [];
    const missingDetails = missing.slice(0, 10).map((row) => {
      const moduleType = row.moduleType ?? '(unknown module)';
      const count = normalizeCount(row.count);
      const example = row.exampleObjectName ? ` example ${row.exampleObjectName}` : '';
      return `${moduleType} (${count} descriptors${example})`;
    });
    pushBlocker(
      blockers,
      'save-generated-module-missing-serializers',
      'save-files',
      Math.max(missing.length, total - covered),
      missingDetails.length > 0
        ? missingDetails
        : ['Generated Object::xfer module coverage is incomplete.'],
    );
  }

  if (!inputs.visualSceneParity) {
    pushBlocker(blockers, 'visual-scene-report-missing', 'visual-scenes', 1, ['visual-scene-parity-report.json missing']);
  } else {
    const blockedScenarios = normalizeCount(inputs.visualSceneParity.summary?.blockedScenarios);
    const scenarioDetails = (inputs.visualSceneParity.scenarios ?? [])
      .filter((scenario) => scenario.status === 'blocked')
      .slice(0, 5)
      .map((scenario) => {
        const issues = (scenario.blockingIssues ?? []).slice(0, 2);
        const suffix = issues.length > 0 ? `: ${issues.join(' | ')}` : '';
        return `${scenario.name ?? '(unnamed scene)'}${suffix}`;
      });
    pushBlocker(
      blockers,
      'visual-scene-blocked-scenarios',
      'visual-scenes',
      blockedScenarios,
      scenarioDetails.length > 0
        ? scenarioDetails
        : ['Visual scene parity report contains blocked retail-map scenarios.'],
    );
  }

  if (!inputs.uiLayoutParity) {
    pushBlocker(blockers, 'ui-layout-report-missing', 'ui-layout', 1, ['ui-layout-parity-report.json missing']);
  } else {
    const blockedScenarios = normalizeCount(inputs.uiLayoutParity.summary?.blockedScenarios);
    const scenarioDetails = (inputs.uiLayoutParity.scenarios ?? [])
      .filter((scenario) => scenario.status === 'blocked')
      .slice(0, 5)
      .map((scenario) => {
        const issues = (scenario.blockingIssues ?? []).slice(0, 2);
        const suffix = issues.length > 0 ? `: ${issues.join(' | ')}` : '';
        return `${scenario.name ?? '(unnamed UI scene)'}${suffix}`;
      });
    pushBlocker(
      blockers,
      'ui-layout-blocked-scenarios',
      'ui-layout',
      blockedScenarios,
      scenarioDetails.length > 0
        ? scenarioDetails
        : ['UI layout parity report contains blocked retail UI scenarios.'],
    );
  }

  return blockers;
}

export function buildBlockerParityReport(inputs: BlockerReportInputs): BlockerParityReport {
  const blockers = collectBlockerFindings(inputs);
  const blockerItems = blockers.reduce((sum, blocker) => sum + blocker.count, 0);
  return {
    generatedAt: new Date().toISOString(),
    status: blockers.length > 0 ? 'blocked' : 'clear',
    summary: {
      blockerGroups: blockers.length,
      blockerItems,
    },
    blockers,
  };
}

async function readJsonOrNull<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const scriptPath = fileURLToPath(import.meta.url);
  const rootDir = path.resolve(path.dirname(scriptPath), '..');
  const outputPath = path.join(rootDir, 'blocker-parity-report.json');

  const conversionParity = await readJsonOrNull<BlockerReportInputs['conversionParity']>(
    path.join(rootDir, 'conversion-parity-report.json'),
  );
  const commandCoverage = await readJsonOrNull<BlockerReportInputs['commandCoverage']>(
    path.join(rootDir, 'command-type-coverage-report.json'),
  );
  const scriptCoverage = await readJsonOrNull<BlockerReportInputs['scriptCoverage']>(
    path.join(rootDir, 'script-coverage-report.json'),
  );
  const prerequisiteCoverage = await readJsonOrNull<BlockerReportInputs['prerequisiteCoverage']>(
    path.join(rootDir, 'prerequisite-chain-report.json'),
  );
  const saveGeneratedModuleCoverage = await readJsonOrNull<BlockerReportInputs['saveGeneratedModuleCoverage']>(
    path.join(rootDir, 'save-generated-module-coverage-report.json'),
  );
  const visualSceneParity = await readJsonOrNull<BlockerReportInputs['visualSceneParity']>(
    path.join(rootDir, 'visual-scene-parity-report.json'),
  );
  const uiLayoutParity = await readJsonOrNull<BlockerReportInputs['uiLayoutParity']>(
    path.join(rootDir, 'ui-layout-parity-report.json'),
  );

  const report = buildBlockerParityReport({
    conversionParity,
    commandCoverage,
    scriptCoverage,
    prerequisiteCoverage,
    saveGeneratedModuleCoverage,
    visualSceneParity,
    uiLayoutParity,
  });

  await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(`Blocker parity report written: ${outputPath}`);
  if (report.blockers.length === 0) {
    console.log('Blocker parity status: clear (0 blockers).');
    return;
  }
  console.table(report.blockers.map((blocker) => ({
    id: blocker.id,
    area: blocker.area,
    count: blocker.count,
  })));
  console.log('Summary:', report.summary);
}

const executedScriptPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
const currentScriptPath = fileURLToPath(import.meta.url);
if (executedScriptPath === currentScriptPath) {
  await main();
}
