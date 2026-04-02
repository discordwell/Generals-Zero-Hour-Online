/**
 * Agent 2: Syntax Error Fixer
 *
 * Iteratively fixes TypeScript compilation errors by:
 * 1. Running tsc --noEmit on the translated file
 * 2. Parsing error messages
 * 3. Asking Claude to fix them (with a fix-strategy planning step)
 * 4. Repeating until clean or stuck
 *
 * Terminates when:
 * - No errors remain
 * - Same error at same location repeats (prevents infinite loops)
 * - Max rounds exceeded
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { queryClaude, extractCodeBlock } from '../lib/claude.js';
import type { PipelineOptions } from '../lib/types.js';

const execFileAsync = promisify(execFile);

interface TscError {
  file: string;
  line: number;
  col: number;
  code: string;
  message: string;
  raw: string;
}

/**
 * Run tsc --noEmit on a single file and return errors.
 * Uses a minimal tsconfig for standalone checking.
 */
async function runTscCheck(
  filePath: string,
  options: PipelineOptions,
): Promise<TscError[]> {
  // Create a minimal tsconfig for standalone checking
  const tmpConfig = path.join(
    path.dirname(filePath),
    `.tsconfig.transagent-check.json`,
  );

  const tsconfig = {
    compilerOptions: {
      target: 'ES2022',
      module: 'ES2022',
      moduleResolution: 'bundler',
      strict: true,
      noEmit: true,
      esModuleInterop: true,
      skipLibCheck: true,
      // Include DOM types for browser-targeted code
      lib: ['ES2022', 'DOM'],
    },
    include: [filePath],
  };

  try {
    await fs.writeFile(tmpConfig, JSON.stringify(tsconfig, null, 2));

    const { stdout } = await execFileAsync(
      'npx',
      ['tsc', '--project', tmpConfig, '--pretty', 'false'],
      {
        cwd: options.projectRoot,
        timeout: 60_000,
      },
    );

    // No errors if we get here
    return [];
  } catch (err: unknown) {
    const execErr = err as { stdout?: string; stderr?: string };
    const output = execErr.stdout ?? execErr.stderr ?? '';

    return parseTscErrors(output, filePath);
  } finally {
    // Clean up temp config
    try {
      await fs.unlink(tmpConfig);
    } catch {
      // ignore cleanup errors
    }
  }
}

/**
 * Parse tsc error output into structured errors.
 */
function parseTscErrors(output: string, targetFile: string): TscError[] {
  const errors: TscError[] = [];
  const basename = path.basename(targetFile);

  for (const line of output.split('\n')) {
    // tsc error format: file.ts(line,col): error TS1234: message
    const match = line.match(
      /(.+?)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s+(.+)/,
    );
    if (match && line.includes(basename)) {
      errors.push({
        file: match[1]!,
        line: parseInt(match[2]!, 10),
        col: parseInt(match[3]!, 10),
        code: match[4]!,
        message: match[5]!,
        raw: line,
      });
    }
  }

  return errors;
}

/**
 * Create a fingerprint for an error to detect repeats.
 */
function errorFingerprint(error: TscError): string {
  return `${error.line}:${error.col}:${error.code}`;
}

/**
 * Build the syntax fix prompt.
 * Follows the paper's two-step approach: first plan the fix, then generate patched code.
 */
function buildFixPrompt(tsCode: string, errors: TscError[]): string {
  const errorList = errors
    .map((e) => `  Line ${e.line}: ${e.code} — ${e.message}`)
    .join('\n');

  return `You are fixing TypeScript compilation errors in a C++ → TypeScript translation.

RULES:
1. Fix ONLY the compilation errors listed below.
2. Do NOT change any logic or behavior.
3. Do NOT refactor, simplify, or "improve" the code.
4. Preserve all variable names, control flow, and structure.
5. If a type is unknown, use \`any\` rather than guessing wrong.

## Current TypeScript Code
\`\`\`typescript
${tsCode}
\`\`\`

## Compilation Errors
${errorList}

## Instructions
First, briefly plan your fix for each error (1 line each).
Then output the COMPLETE corrected TypeScript file in a \`\`\`typescript code fence.
Do not omit any code — output the entire file with fixes applied.
`;
}

/**
 * Run Agent 2: Syntax Error Fixer loop.
 */
export async function fixSyntaxErrors(
  tsCode: string,
  outputPath: string,
  options: PipelineOptions,
): Promise<{ code: string; rounds: number; errorsFixed: number }> {
  let currentCode = tsCode;
  let totalErrorsFixed = 0;
  const seenErrors = new Set<string>();

  for (let round = 1; round <= options.maxSyntaxRounds; round++) {
    // Write current code to disk for tsc to check
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, currentCode, 'utf8');

    const errors = await runTscCheck(outputPath, options);

    if (errors.length === 0) {
      if (options.verbose) {
        console.log(`  [Agent 2] Round ${round}: No errors — syntax clean.`);
      }
      return { code: currentCode, rounds: round, errorsFixed: totalErrorsFixed };
    }

    // Check for repeated errors (stuck in a loop)
    const currentFingerprints = errors.map(errorFingerprint);
    const allSeen = currentFingerprints.every((fp) => seenErrors.has(fp));
    if (allSeen && round > 1) {
      console.warn(
        `  [Agent 2] Round ${round}: Same ${errors.length} error(s) repeating — stopping.`,
      );
      return { code: currentCode, rounds: round, errorsFixed: totalErrorsFixed };
    }

    for (const fp of currentFingerprints) {
      seenErrors.add(fp);
    }

    if (options.verbose) {
      console.log(
        `  [Agent 2] Round ${round}: ${errors.length} error(s) — asking Claude to fix...`,
      );
    }

    const prompt = buildFixPrompt(currentCode, errors);
    const response = await queryClaude(prompt, {
      model: options.model ?? undefined,
    });

    const fixedCode = extractCodeBlock(response, 'typescript');
    if (fixedCode && fixedCode !== currentCode) {
      totalErrorsFixed += errors.length;
      currentCode = fixedCode;
    } else {
      console.warn(`  [Agent 2] Round ${round}: Claude returned unchanged code — stopping.`);
      return { code: currentCode, rounds: round, errorsFixed: totalErrorsFixed };
    }
  }

  console.warn(
    `  [Agent 2] Max ${options.maxSyntaxRounds} rounds reached with errors remaining.`,
  );
  return {
    code: currentCode,
    rounds: options.maxSyntaxRounds,
    errorsFixed: totalErrorsFixed,
  };
}
