import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { isSourceSaveFixtureFile, listSaveFixturePaths } from './save-core-chunk-report.js';

export interface ImportedSourceSaveFixture {
  sourcePath: string;
  fixturePath: string;
  status: 'imported' | 'unchanged';
}

export interface ImportSourceSaveFixturesReport {
  outputDir: string;
  summary: {
    scannedPaths: number;
    validSourceSaves: number;
    imported: number;
    unchanged: number;
  };
  fixtures: ImportedSourceSaveFixture[];
}

function sanitizeFixtureBaseName(filePath: string): string {
  const parsedExtension = extname(filePath);
  const rawBaseName = parsedExtension
    ? basename(filePath, parsedExtension)
    : basename(filePath);
  const sanitized = rawBaseName
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return sanitized || 'source-save';
}

function arrayBuffersEqual(left: Buffer, right: Buffer): boolean {
  if (left.byteLength !== right.byteLength) {
    return false;
  }
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

function resolveUniqueFixturePath(outputDir: string, sourcePath: string, data: Buffer): {
  fixturePath: string;
  unchanged: boolean;
} {
  const baseName = sanitizeFixtureBaseName(sourcePath);
  for (let suffix = 0; ; suffix += 1) {
    const candidateName = suffix === 0 ? `${baseName}.sav` : `${baseName}-${suffix}.sav`;
    const candidatePath = join(outputDir, candidateName);
    if (!existsSync(candidatePath)) {
      return { fixturePath: candidatePath, unchanged: false };
    }
    if (arrayBuffersEqual(readFileSync(candidatePath), data)) {
      return { fixturePath: candidatePath, unchanged: true };
    }
  }
}

function collectSourceSavePaths(inputPaths: readonly string[]): string[] {
  const discovered = new Set<string>();
  for (const inputPath of inputPaths) {
    const absolutePath = resolve(process.cwd(), inputPath);
    if (!existsSync(absolutePath)) {
      continue;
    }
    const stats = statSync(absolutePath);
    if (stats.isFile()) {
      if (isSourceSaveFixtureFile(absolutePath)) {
        discovered.add(absolutePath);
      }
      continue;
    }
    if (stats.isDirectory()) {
      for (const savePath of listSaveFixturePaths(absolutePath)) {
        discovered.add(savePath);
      }
    }
  }
  return [...discovered].sort((left, right) => left.localeCompare(right));
}

export function importSourceSaveFixtures(params: {
  inputPaths: readonly string[];
  outputDir: string;
}): ImportSourceSaveFixturesReport {
  const outputDir = resolve(process.cwd(), params.outputDir);
  mkdirSync(outputDir, { recursive: true });

  const sourceSavePaths = collectSourceSavePaths(params.inputPaths);
  const fixtures = sourceSavePaths.map((sourcePath) => {
    const data = readFileSync(sourcePath);
    const resolved = resolveUniqueFixturePath(outputDir, sourcePath, data);
    if (!resolved.unchanged) {
      writeFileSync(resolved.fixturePath, data);
    }
    return {
      sourcePath,
      fixturePath: resolved.fixturePath,
      status: resolved.unchanged ? 'unchanged' as const : 'imported' as const,
    };
  });

  return {
    outputDir,
    summary: {
      scannedPaths: params.inputPaths.length,
      validSourceSaves: fixtures.length,
      imported: fixtures.filter((fixture) => fixture.status === 'imported').length,
      unchanged: fixtures.filter((fixture) => fixture.status === 'unchanged').length,
    },
    fixtures,
  };
}

function usage(): void {
  console.error('Usage: tsx tools/import-source-save-fixtures.ts [--out fixtures/source-saves] <save-file-or-directory> [...]');
}

function main(): void {
  const args = process.argv.slice(2);
  const outIndex = args.indexOf('--out');
  const outputDir = outIndex >= 0 ? args[outIndex + 1] : 'fixtures/source-saves';
  const inputPaths = args.filter((arg, index) =>
    arg !== '--out' && index !== outIndex + 1);

  if (!outputDir || inputPaths.length === 0) {
    usage();
    process.exitCode = 1;
    return;
  }

  const report = importSourceSaveFixtures({ inputPaths, outputDir });
  process.stdout.write(JSON.stringify(report, null, 2));
  process.stdout.write('\n');
  if (report.summary.validSourceSaves === 0) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
