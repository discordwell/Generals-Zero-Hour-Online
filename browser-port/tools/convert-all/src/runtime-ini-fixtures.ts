import fs from 'node:fs';
import path from 'node:path';

export interface RuntimeIniFixtureSource {
  sourcePath: string;
  relativePath: string;
}

export interface RuntimeIniFixtureParseConfig {
  parseDir: string;
  baseDir: string;
  fixtures: RuntimeIniFixtureSource[];
}

function listIniFiles(dir: string, prefix = ''): RuntimeIniFixtureSource[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name));
  const files: RuntimeIniFixtureSource[] = [];

  for (const entry of entries) {
    const relativePath = prefix.length > 0 ? path.posix.join(prefix, entry.name) : entry.name;
    const absolutePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listIniFiles(absolutePath, relativePath));
      continue;
    }
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.ini')) {
      continue;
    }
    files.push({
      sourcePath: absolutePath,
      relativePath,
    });
  }

  return files;
}

export function loadRuntimeIniFixtures(projectRoot: string): RuntimeIniFixtureParseConfig | null {
  const fixtureDir = path.join(projectRoot, 'tools', 'convert-all', 'fixtures', 'ini');
  if (!fs.existsSync(fixtureDir)) {
    return null;
  }

  const fixtures = listIniFiles(fixtureDir);
  if (fixtures.length === 0) {
    return null;
  }

  return {
    parseDir: fixtureDir,
    baseDir: fixtureDir,
    fixtures,
  };
}
