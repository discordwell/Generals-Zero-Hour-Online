/**
 * Agent 4: Semantic Error Fixer
 *
 * Adapted from the paper's approach for our context where we can't run C++ directly.
 * Instead of instrumenting both programs and comparing runtime values, we:
 *
 * 1. Have Claude analyze the C++ function and generate expected test cases
 *    (Claude traces through C++ logic to determine expected outputs)
 * 2. Generate a vitest file encoding those expectations
 * 3. Run the tests against the TS translation
 * 4. For failures: use block alignment to localize the divergent block
 * 5. Fix the block using both vanilla and value-aware strategies from the paper
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { queryClaude, extractCodeBlock } from '../lib/claude.js';
import { formatBlocks } from './code-aligner.js';
import type {
  CodeBlock,
  BlockAlignment,
  TranslationContext,
  PipelineOptions,
  TestResult,
} from '../lib/types.js';

const execFileAsync = promisify(execFile);

/**
 * Generate vitest test cases from C++ behavior analysis.
 */
export async function generateTests(
  context: TranslationContext,
  tsCode: string,
  outputPath: string,
  options: PipelineOptions,
): Promise<string> {
  const cppCode = context.functionSource ?? context.cppSource;
  const importPath = `./${path.basename(outputPath, '.ts')}`;

  const prompt = `You are generating parity tests for a C++ → TypeScript translation.
Your goal: create vitest test cases that verify the TypeScript code matches C++ behavior EXACTLY.

## C++ Original
\`\`\`cpp
${cppCode}
\`\`\`

## TypeScript Translation
\`\`\`typescript
${tsCode}
\`\`\`

## Instructions
1. Trace through the C++ code mentally for each test case to determine the EXACT expected output.
2. Cover ALL code paths: normal cases, edge cases, boundary values, error paths.
3. For numeric code: test overflow, underflow, zero, negative, max values.
4. For collection code: test empty, single element, many elements.
5. Generate at least 5 test cases (more for complex functions).
6. Import from "${importPath}" — use the actual exported function/class names from the TS code.

## Output
A complete vitest test file. Use \`describe\`/\`it\`/\`expect\` patterns.
Include \`import { describe, it, expect } from 'vitest'\` at the top.

CRITICAL: The expected values must come from tracing the C++ logic, NOT from reading the TS code.
If the TS code has a bug, the test should FAIL (revealing the bug).

\`\`\`typescript
`;

  const response = await queryClaude(prompt, {
    model: options.model ?? undefined,
  });

  return extractCodeBlock(response, 'typescript');
}

/**
 * Run vitest on a specific test file and parse results.
 */
export async function runTests(
  testPath: string,
  options: PipelineOptions,
): Promise<TestResult[]> {
  try {
    const { stdout } = await execFileAsync(
      'npx',
      ['vitest', 'run', testPath, '--reporter=json', '--no-color'],
      {
        cwd: options.projectRoot,
        timeout: 120_000,
        env: { ...process.env, NODE_OPTIONS: '--experimental-vm-modules' },
      },
    );

    return parseVitestJson(stdout);
  } catch (err: unknown) {
    const execErr = err as { stdout?: string; stderr?: string };
    const output = execErr.stdout ?? '';

    // vitest exits with code 1 when tests fail — still parse the output
    if (output.includes('"testResults"') || output.includes('"numFailedTests"')) {
      return parseVitestJson(output);
    }

    // Real execution error
    console.warn(`  [Agent 4] vitest execution error: ${execErr.stderr ?? '(no stderr)'}`);
    return [
      {
        name: 'vitest execution',
        status: 'fail',
        error: execErr.stderr ?? 'Unknown vitest error',
      },
    ];
  }
}

/**
 * Parse vitest JSON reporter output into TestResult[].
 */
function parseVitestJson(output: string): TestResult[] {
  const results: TestResult[] = [];

  try {
    // Find the JSON object in the output (vitest may prepend non-JSON text)
    const jsonStart = output.indexOf('{');
    if (jsonStart === -1) return results;
    const json = JSON.parse(output.slice(jsonStart)) as {
      testResults?: Array<{
        assertionResults?: Array<{
          fullName?: string;
          title?: string;
          status: string;
          failureMessages?: string[];
        }>;
      }>;
    };

    for (const suite of json.testResults ?? []) {
      for (const test of suite.assertionResults ?? []) {
        const result: TestResult = {
          name: test.fullName ?? test.title ?? 'unknown',
          status: test.status === 'passed' ? 'pass' : 'fail',
        };
        if (test.failureMessages?.length) {
          result.error = test.failureMessages.join('\n');

          // Try to extract expected/actual from vitest error message
          const expectedMatch = result.error.match(/Expected:\s*(.+)/);
          const actualMatch = result.error.match(/Received:\s*(.+)/);
          if (expectedMatch) result.expected = expectedMatch[1];
          if (actualMatch) result.actual = actualMatch[1];
        }
        results.push(result);
      }
    }
  } catch {
    // If JSON parsing fails, try line-by-line parsing of text output
    for (const line of output.split('\n')) {
      if (line.includes('✓') || line.includes('√')) {
        const name = line.replace(/.*[✓√]\s*/, '').trim();
        if (name) results.push({ name, status: 'pass' });
      } else if (line.includes('✗') || line.includes('×') || line.includes('FAIL')) {
        const name = line.replace(/.*[✗×]\s*/, '').replace(/FAIL\s*/, '').trim();
        if (name) results.push({ name, status: 'fail', error: line });
      }
    }
  }

  return results;
}

/**
 * Localize a test failure to a specific target block.
 * Uses the block alignment to narrow down which block diverges.
 */
async function localizeError(
  failedTest: TestResult,
  sourceBlocks: CodeBlock[],
  targetBlocks: CodeBlock[],
  alignment: BlockAlignment[],
  cppCode: string,
  tsCode: string,
  options: PipelineOptions,
): Promise<{ targetBlockId: number; sourceBlockId: number; explanation: string }> {
  const sourceFormatted = formatBlocks(sourceBlocks, 'C++');
  const targetFormatted = formatBlocks(targetBlocks, 'TS');

  const alignmentStr = alignment
    .map((a) => `  C++ Block ${a.sourceBlockId} → TS Block ${a.targetBlockId}`)
    .join('\n');

  const prompt = `A parity test has FAILED, meaning the TypeScript translation doesn't match C++ behavior.
Localize the error to a specific TypeScript block.

## Failed Test
Name: ${failedTest.name}
${failedTest.expected ? `Expected (from C++ behavior): ${failedTest.expected}` : ''}
${failedTest.actual ? `Actual (from TS execution): ${failedTest.actual}` : ''}
${failedTest.error ? `Error details:\n${failedTest.error}` : ''}

## Block Alignment
${alignmentStr}

## C++ Blocks
${sourceFormatted}

## TypeScript Blocks
${targetFormatted}

## Instructions
Trace through the C++ code with the test's input values. Then trace through the TypeScript code.
Identify the FIRST block where the values diverge.

Output a JSON object: {"targetBlockId": N, "sourceBlockId": N, "explanation": "..."}
The explanation should describe what the C++ block does vs what the TS block does wrong.

Output ONLY the JSON:`;

  const response = await queryClaude(prompt, {
    model: options.model ?? undefined,
  });

  try {
    const jsonStr = response.match(/\{[\s\S]*\}/)?.[0];
    if (!jsonStr) throw new Error('No JSON found');
    return JSON.parse(jsonStr) as {
      targetBlockId: number;
      sourceBlockId: number;
      explanation: string;
    };
  } catch {
    // Default to first block
    return {
      targetBlockId: targetBlocks[0]?.id ?? 0,
      sourceBlockId: sourceBlocks[0]?.id ?? 0,
      explanation: 'Could not localize — defaulting to first block',
    };
  }
}

/**
 * Fix a semantic error in a specific block.
 * Implements both vanilla and value-aware strategies from the paper.
 */
async function fixBlock(
  errorBlock: CodeBlock,
  sourceBlock: CodeBlock,
  failedTest: TestResult,
  explanation: string,
  fullCpp: string,
  fullTs: string,
  strategy: 'vanilla' | 'value-aware',
  options: PipelineOptions,
): Promise<string> {
  let prompt = `Fix the semantic error in the TypeScript block to match C++ behavior exactly.

## Error TypeScript Block (BLOCK ${errorBlock.id})
\`\`\`typescript
${errorBlock.code}
\`\`\`

## Corresponding C++ Block (BLOCK ${sourceBlock.id})
\`\`\`cpp
${sourceBlock.code}
\`\`\`

## Error Analysis
${explanation}

## Failed Test
Name: ${failedTest.name}
${failedTest.expected ? `Expected: ${failedTest.expected}` : ''}
${failedTest.actual ? `Actual: ${failedTest.actual}` : ''}
`;

  if (strategy === 'value-aware' && failedTest.expected && failedTest.actual) {
    prompt += `
## Value Analysis (value-aware strategy)
The C++ code should produce: ${failedTest.expected}
The TypeScript code actually produces: ${failedTest.actual}
Pay special attention to:
- Integer overflow/underflow (C++ int is 32-bit signed)
- Unsigned arithmetic differences
- Floating point precision
- Off-by-one errors in loops
- Operator precedence differences
`;
  }

  prompt += `
## Full Context
### C++
\`\`\`cpp
${fullCpp}
\`\`\`

### TypeScript
\`\`\`typescript
${fullTs}
\`\`\`

## Instructions
1. Identify the exact semantic difference between the C++ and TS blocks.
2. Fix the TS block to match C++ behavior.
3. Output the COMPLETE fixed TypeScript file (not just the block).
   The fixed code replaces the entire TS file.

Output in a \`\`\`typescript code fence:`;

  const response = await queryClaude(prompt, {
    model: options.model ?? undefined,
  });

  return extractCodeBlock(response, 'typescript');
}

/**
 * Run the full Semantic Error Fixer loop.
 */
export async function runSemanticFixer(
  context: TranslationContext,
  tsCode: string,
  sourceBlocks: CodeBlock[],
  targetBlocks: CodeBlock[],
  alignment: BlockAlignment[],
  testOutputPath: string,
  outputPath: string,
  options: PipelineOptions,
): Promise<{
  code: string;
  rounds: number;
  testsGenerated: number;
  testsPassed: number;
  testsFailed: number;
  blocksFixed: number;
}> {
  const cppCode = context.functionSource ?? context.cppSource;
  let currentCode = tsCode;
  let blocksFixed = 0;

  // Step 1: Generate test cases
  if (options.verbose) {
    console.log(`  [Agent 4] Generating parity tests from C++ behavior...`);
  }

  const testCode = await generateTests(context, currentCode, outputPath, options);
  await fs.mkdir(path.dirname(testOutputPath), { recursive: true });
  await fs.writeFile(testOutputPath, testCode, 'utf8');

  if (options.verbose) {
    console.log(`  [Agent 4] Tests written to ${testOutputPath}`);
  }

  // Step 2: Iterative fix loop
  for (let round = 1; round <= options.maxSemanticRounds; round++) {
    // Write current code
    await fs.writeFile(outputPath, currentCode, 'utf8');

    // Run tests
    if (options.verbose) {
      console.log(`  [Agent 4] Round ${round}: Running tests...`);
    }
    const results = await runTests(testOutputPath, options);

    const passed = results.filter((r) => r.status === 'pass').length;
    const failed = results.filter((r) => r.status === 'fail');

    if (options.verbose) {
      console.log(
        `  [Agent 4] Round ${round}: ${passed} passed, ${failed.length} failed`,
      );
    }

    if (failed.length === 0) {
      return {
        code: currentCode,
        rounds: round,
        testsGenerated: results.length,
        testsPassed: passed,
        testsFailed: 0,
        blocksFixed,
      };
    }

    // Pick the first failing test to fix
    const failedTest = failed[0]!;

    if (options.verbose) {
      console.log(
        `  [Agent 4] Localizing error for: "${failedTest.name}"...`,
      );
    }

    // Localize the error to a block
    const { targetBlockId, sourceBlockId, explanation } = await localizeError(
      failedTest,
      sourceBlocks,
      targetBlocks,
      alignment,
      cppCode,
      currentCode,
      options,
    );

    const errorBlock =
      targetBlocks.find((b) => b.id === targetBlockId) ?? targetBlocks[0];
    const sourceBlock =
      sourceBlocks.find((b) => b.id === sourceBlockId) ?? sourceBlocks[0];

    if (!errorBlock || !sourceBlock) {
      console.warn(`  [Agent 4] Could not find blocks for localization — stopping.`);
      break;
    }

    if (options.verbose) {
      console.log(
        `  [Agent 4] Error in TS Block ${targetBlockId} (mapped from C++ Block ${sourceBlockId})`,
      );
      console.log(`  [Agent 4] Explanation: ${explanation}`);
    }

    // Try vanilla fix first, then value-aware if vanilla doesn't help
    for (const strategy of ['vanilla', 'value-aware'] as const) {
      if (options.verbose) {
        console.log(`  [Agent 4] Trying ${strategy} fix strategy...`);
      }

      const fixedCode = await fixBlock(
        errorBlock,
        sourceBlock,
        failedTest,
        explanation,
        cppCode,
        currentCode,
        strategy,
        options,
      );

      if (fixedCode && fixedCode !== currentCode) {
        currentCode = fixedCode;
        blocksFixed++;
        break; // Move to next round to re-test
      }
    }
  }

  // Final test run to get accurate counts
  await fs.writeFile(outputPath, currentCode, 'utf8');
  const finalResults = await runTests(testOutputPath, options);
  const finalPassed = finalResults.filter((r) => r.status === 'pass').length;
  const finalFailed = finalResults.filter((r) => r.status === 'fail').length;

  return {
    code: currentCode,
    rounds: options.maxSemanticRounds,
    testsGenerated: finalResults.length,
    testsPassed: finalPassed,
    testsFailed: finalFailed,
    blocksFixed,
  };
}
