import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

interface PackageParityDebt {
  packageName: string;
  sourceFileCount: number;
  todoMarkers: number;
  subsetMarkers: number;
  totalMarkers: number;
}

interface ParityDebtReport {
  generatedAt: string;
  rootDir: string;
  packagesDir: string;
  packages: PackageParityDebt[];
  totals: {
    sourceFileCount: number;
    todoMarkers: number;
    subsetMarkers: number;
    totalMarkers: number;
  };
}

const TODO_REGEX = /\b(?:TODO|FIXME|XXX)\b/i;
const SUBSET_REGEX = /\bsource\s+parity\s+subset\b/i;

async function walkTypeScriptFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'dist' || entry.name === 'node_modules' || entry.name.startsWith('.')) {
        continue;
      }
      results.push(...await walkTypeScriptFiles(fullPath));
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    if (!fullPath.endsWith('.ts')) {
      continue;
    }
    results.push(fullPath);
  }
  return results;
}

function countMarkers(content: string): { todoMarkers: number; subsetMarkers: number } {
  let todoMarkers = 0;
  let subsetMarkers = 0;
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    if (TODO_REGEX.test(line)) {
      todoMarkers += 1;
    }
    if (SUBSET_REGEX.test(line)) {
      subsetMarkers += 1;
    }
  }
  return { todoMarkers, subsetMarkers };
}

async function buildPackageDebt(packagesDir: string, packageName: string): Promise<PackageParityDebt> {
  const sourceDir = path.join(packagesDir, packageName, 'src');
  let sourceFiles: string[] = [];
  try {
    sourceFiles = await walkTypeScriptFiles(sourceDir);
  } catch {
    sourceFiles = [];
  }

  let todoMarkers = 0;
  let subsetMarkers = 0;
  for (const filePath of sourceFiles) {
    const content = await fs.readFile(filePath, 'utf8');
    const markers = countMarkers(content);
    todoMarkers += markers.todoMarkers;
    subsetMarkers += markers.subsetMarkers;
  }

  return {
    packageName,
    sourceFileCount: sourceFiles.length,
    todoMarkers,
    subsetMarkers,
    totalMarkers: todoMarkers + subsetMarkers,
  };
}

async function main(): Promise<void> {
  const scriptPath = fileURLToPath(import.meta.url);
  const rootDir = path.resolve(path.dirname(scriptPath), '..');
  const packagesDir = path.join(rootDir, 'packages');
  const outputPath = path.join(rootDir, 'parity-debt-report.json');

  const entries = await fs.readdir(packagesDir, { withFileTypes: true });
  const packageNames = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  const packages: PackageParityDebt[] = [];
  for (const packageName of packageNames) {
    packages.push(await buildPackageDebt(packagesDir, packageName));
  }

  const totals = packages.reduce(
    (acc, pkg) => {
      acc.sourceFileCount += pkg.sourceFileCount;
      acc.todoMarkers += pkg.todoMarkers;
      acc.subsetMarkers += pkg.subsetMarkers;
      acc.totalMarkers += pkg.totalMarkers;
      return acc;
    },
    { sourceFileCount: 0, todoMarkers: 0, subsetMarkers: 0, totalMarkers: 0 },
  );

  const report: ParityDebtReport = {
    generatedAt: new Date().toISOString(),
    rootDir,
    packagesDir,
    packages,
    totals,
  };

  await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(`Parity debt report written: ${outputPath}`);
  console.table(packages.map((pkg) => ({
    package: pkg.packageName,
    files: pkg.sourceFileCount,
    todo: pkg.todoMarkers,
    subset: pkg.subsetMarkers,
    total: pkg.totalMarkers,
  })));
  console.log('Totals:', totals);
}

await main();
