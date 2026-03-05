import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const FORBIDDEN_PATTERNS = [
  /Math\.random\(/,
  /Date\.now\(/,
  /performance\.now\(/,
];

async function collectRuntimeSourceFiles(rootDir: string): Promise<string[]> {
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const absolute = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectRuntimeSourceFiles(absolute)));
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.ts')) {
      continue;
    }
    if (entry.name.endsWith('.test.ts')) {
      continue;
    }
    files.push(absolute);
  }
  return files;
}

describe('deterministic seam guardrails', () => {
  it('keeps game-logic runtime sources free of wall-clock and random APIs', async () => {
    const sourceDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
    const files = await collectRuntimeSourceFiles(sourceDir);
    const violations: string[] = [];

    for (const filePath of files) {
      const source = await fs.readFile(filePath, 'utf8');
      for (const pattern of FORBIDDEN_PATTERNS) {
        if (pattern.test(source)) {
          violations.push(`${path.basename(filePath)} matches ${pattern.source}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
