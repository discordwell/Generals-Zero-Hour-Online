#!/usr/bin/env node
/**
 * TransAGENT — Multi-agent LLM code translation pipeline for C++ → TypeScript.
 *
 * Adapted from:
 *   "TransAGENT: An LLM-Based Multi-Agent System for Code Translation" (2024)
 *   https://arxiv.org/abs/2409.19894
 *
 * Two modes:
 *   TRANSLATE: Full 4-agent pipeline (C++ → TS with syntax/semantic fixing)
 *   VERIFY:    Agents 3+4 only — check existing TS against C++ source
 *
 * Usage:
 *   npx tsx tools/transagent/src/cli.ts --source <cpp-file> [options]
 *   npx tsx tools/transagent/src/cli.ts --verify <ts-file> --source <cpp-file>
 *   npx tsx tools/transagent/src/cli.ts --verify-auto <ts-file>
 *   npx tsx tools/transagent/src/cli.ts --verify-auto --scan <directory>
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTranslationContext } from './lib/cpp-context.js';
import { translateInitial } from './agents/initial-translator.js';
import { fixSyntaxErrors } from './agents/syntax-fixer.js';
import { runCodeAligner } from './agents/code-aligner.js';
import { runSemanticFixer } from './agents/semantic-fixer.js';
import {
  verifyFile,
  verifyFileAuto,
  verifyScan,
  formatVerifyReport,
} from './verify.js';
import type { PipelineOptions, TranslationReport } from './lib/types.js';

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

const scriptPath = fileURLToPath(import.meta.url);
const toolDir = path.resolve(path.dirname(scriptPath), '..');
const projectRoot = path.resolve(toolDir, '../..'); // browser-port/
const repoRoot = path.resolve(projectRoot, '..'); // repo root

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

interface CliArgs {
  // Translate mode
  source: string | undefined;
  function: string | undefined;
  output: string | undefined;
  testOutput: string | undefined;
  context: string[];
  deps: string[];
  skipTests: boolean;

  // Verify mode
  verify: string | undefined;
  verifyAuto: string | undefined;
  scan: string | undefined;

  // Shared
  model: string | null;
  maxSyntaxRounds: number;
  maxSemanticRounds: number;
  verbose: boolean;
}

function printUsage(): void {
  console.log(`TransAGENT — Multi-agent C++ → TypeScript translation & verification

TRANSLATE MODE (full pipeline: Agents 1→2→3→4):
  npx tsx tools/transagent/src/cli.ts --source <cpp-file> [options]

  Required:
    --source <path>           C++ source file (relative to repo root or absolute)

  Optional:
    --function <name>         Specific function/method to translate (default: whole file)
    --output <path>           Output TS file path (default: auto-generated)
    --test-output <path>      Output test file path (default: alongside output)
    --context <paths>         Additional C++ files for type context (comma-separated)
    --deps <paths>            Already-translated TS dependencies (comma-separated)
    --skip-tests              Skip Agent 4 (semantic fixer)
    --max-syntax-rounds <n>   Max syntax fix iterations (default: 5)
    --max-semantic-rounds <n> Max semantic fix iterations (default: 3)

VERIFY MODE (Agents 3+4 only — check existing TS against C++ source):
  # Manual: specify both files
  npx tsx tools/transagent/src/cli.ts --verify <ts-file> --source <cpp-file>[,<cpp-file2>,...]

  # Auto: parse source parity comments to find C++ origins
  npx tsx tools/transagent/src/cli.ts --verify-auto <ts-file>

  # Scan: auto-verify all TS files in a directory
  npx tsx tools/transagent/src/cli.ts --verify-auto --scan <directory>

SHARED OPTIONS:
  --model <model>           Claude model to use (default: CLI default)
  --verbose                 Verbose progress output
  --help                    Show this help

EXAMPLES:
  # Translate Money.cpp to TypeScript
  npm run transagent -- --source Generals/Code/GameEngine/Source/Common/RTS/Money.cpp \\
    --output browser-port/packages/game-logic/src/money.ts --verbose

  # Verify existing experience.ts against its C++ origins (auto-detected)
  npm run transagent -- --verify-auto browser-port/packages/game-logic/src/experience.ts -v

  # Verify experience.ts against a specific C++ file
  npm run transagent -- --verify browser-port/packages/game-logic/src/experience.ts \\
    --source Generals/Code/GameEngine/Source/GameLogic/Object/ExperienceTracker.cpp -v

  # Scan and verify all game-logic files
  npm run transagent -- --verify-auto --scan browser-port/packages/game-logic/src -v
`);
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    source: undefined,
    function: undefined,
    output: undefined,
    testOutput: undefined,
    context: [],
    deps: [],
    skipTests: false,
    verify: undefined,
    verifyAuto: undefined,
    scan: undefined,
    model: null,
    maxSyntaxRounds: 5,
    maxSemanticRounds: 3,
    verbose: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i]!;
    switch (arg) {
      case '--source':
      case '-s':
        args.source = argv[++i];
        break;
      case '--function':
      case '-f':
        args.function = argv[++i];
        break;
      case '--output':
      case '-o':
        args.output = argv[++i];
        break;
      case '--test-output':
        args.testOutput = argv[++i];
        break;
      case '--context':
        args.context = (argv[++i] ?? '').split(',').filter(Boolean);
        break;
      case '--deps':
        args.deps = (argv[++i] ?? '').split(',').filter(Boolean);
        break;
      case '--skip-tests':
        args.skipTests = true;
        break;
      case '--verify':
        args.verify = argv[++i];
        break;
      case '--verify-auto':
        args.verifyAuto = argv[++i];
        break;
      case '--scan':
        args.scan = argv[++i];
        break;
      case '--model':
        args.model = argv[++i] ?? null;
        break;
      case '--max-syntax-rounds':
        args.maxSyntaxRounds = parseInt(argv[++i] ?? '5', 10);
        break;
      case '--max-semantic-rounds':
        args.maxSemanticRounds = parseInt(argv[++i] ?? '3', 10);
        break;
      case '--verbose':
      case '-v':
        args.verbose = true;
        break;
      case '--help':
      case '-h':
        printUsage();
        process.exit(0);
        break;
      default:
        console.error(`Unknown argument: ${arg}`);
        printUsage();
        process.exit(1);
    }
  }

  return args;
}

function buildOptions(args: CliArgs, outputPath?: string): PipelineOptions {
  return {
    model: args.model,
    outputPath: outputPath ?? '',
    testOutputPath: args.testOutput ?? null,
    maxSyntaxRounds: args.maxSyntaxRounds,
    maxSemanticRounds: args.maxSemanticRounds,
    verbose: args.verbose,
    projectRoot,
    repoRoot,
  };
}

// ---------------------------------------------------------------------------
// Translate mode
// ---------------------------------------------------------------------------

function deriveOutputPath(sourcePath: string): string {
  const basename = path.basename(sourcePath, path.extname(sourcePath));
  const kebab = basename
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
  return path.join(
    projectRoot,
    'packages/game-logic/src/translated',
    `${kebab}.ts`,
  );
}

function deriveTestPath(outputPath: string): string {
  const dir = path.dirname(outputPath);
  const basename = path.basename(outputPath, '.ts');
  return path.join(dir, `${basename}.test.ts`);
}

async function runTranslatePipeline(args: CliArgs): Promise<void> {
  const startTime = Date.now();

  const outputPath = args.output
    ? path.isAbsolute(args.output)
      ? args.output
      : path.join(repoRoot, args.output)
    : deriveOutputPath(args.source!);

  const testOutputPath = args.testOutput
    ? path.isAbsolute(args.testOutput)
      ? args.testOutput
      : path.join(repoRoot, args.testOutput)
    : deriveTestPath(outputPath);

  const options: PipelineOptions = {
    model: args.model,
    outputPath,
    testOutputPath,
    maxSyntaxRounds: args.maxSyntaxRounds,
    maxSemanticRounds: args.maxSemanticRounds,
    verbose: args.verbose,
    projectRoot,
    repoRoot,
  };

  const report: TranslationReport = {
    sourcePath: args.source!,
    functionName: args.function ?? null,
    outputPath,
    testOutputPath: args.skipTests ? null : testOutputPath,
    status: 'failed',
    agents: {
      initialTranslation: { durationMs: 0 },
      syntaxFixer: { rounds: 0, durationMs: 0, errorsFixed: 0 },
      codeAligner: {
        sourceBlocks: 0,
        targetBlocks: 0,
        alignments: 0,
        durationMs: 0,
      },
      semanticFixer: {
        testsGenerated: 0,
        testsPassed: 0,
        testsFailed: 0,
        rounds: 0,
        durationMs: 0,
        blocksFixed: 0,
      },
    },
    totalDurationMs: 0,
  };

  try {
    console.log(`\n╔══════════════════════════════════════════════════════════╗`);
    console.log(`║  TransAGENT — C++ → TypeScript Translation Pipeline     ║`);
    console.log(`╚══════════════════════════════════════════════════════════╝\n`);
    console.log(`Source:   ${args.source}`);
    if (args.function) console.log(`Function: ${args.function}`);
    console.log(`Output:   ${path.relative(repoRoot, outputPath)}`);
    if (!args.skipTests) {
      console.log(`Tests:    ${path.relative(repoRoot, testOutputPath)}`);
    }
    console.log('');

    // Step 0: Build context
    console.log(`[Step 0] Building translation context...`);
    const context = await buildTranslationContext(
      args.source!,
      repoRoot,
      args.function,
      args.context,
      args.deps,
    );

    if (args.function && !context.functionSource) {
      console.error(
        `ERROR: Function "${args.function}" not found in ${args.source}`,
      );
      process.exit(1);
    }

    const sourceLines = (context.functionSource ?? context.cppSource).split('\n').length;
    console.log(`  Found ${sourceLines} lines of C++ source.`);
    if (context.typeContext) {
      console.log(`  Loaded type context (${Math.round(context.typeContext.length / 1024)}KB).`);
    }

    // Agent 1: Translate
    console.log(`\n[Agent 1] Initial Code Translation...`);
    let t0 = Date.now();
    let tsCode = await translateInitial(context, options);
    report.agents.initialTranslation.durationMs = Date.now() - t0;
    console.log(
      `  Translated ${sourceLines} C++ → ${tsCode.split('\n').length} TS lines (${report.agents.initialTranslation.durationMs}ms)`,
    );

    // Agent 2: Syntax fix
    console.log(`\n[Agent 2] Syntax Error Fixer...`);
    t0 = Date.now();
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    const syntaxResult = await fixSyntaxErrors(tsCode, outputPath, options);
    tsCode = syntaxResult.code;
    report.agents.syntaxFixer = {
      rounds: syntaxResult.rounds,
      durationMs: Date.now() - t0,
      errorsFixed: syntaxResult.errorsFixed,
    };
    console.log(
      `  ${syntaxResult.errorsFixed} errors fixed in ${syntaxResult.rounds} round(s) (${report.agents.syntaxFixer.durationMs}ms)`,
    );
    await fs.writeFile(outputPath, tsCode, 'utf8');

    // Agent 3: Align
    console.log(`\n[Agent 3] Code Aligner...`);
    t0 = Date.now();
    const cppCode = context.functionSource ?? context.cppSource;
    const { sourceBlocks, targetBlocks, alignment } = await runCodeAligner(
      cppCode,
      tsCode,
      options,
    );
    report.agents.codeAligner = {
      sourceBlocks: sourceBlocks.length,
      targetBlocks: targetBlocks.length,
      alignments: alignment.length,
      durationMs: Date.now() - t0,
    };
    console.log(
      `  ${sourceBlocks.length} C++ blocks ↔ ${targetBlocks.length} TS blocks, ${alignment.length} alignments (${report.agents.codeAligner.durationMs}ms)`,
    );

    // Agent 4: Semantic fix
    if (!args.skipTests) {
      console.log(`\n[Agent 4] Semantic Error Fixer...`);
      t0 = Date.now();
      const semanticResult = await runSemanticFixer(
        context,
        tsCode,
        sourceBlocks,
        targetBlocks,
        alignment,
        testOutputPath,
        outputPath,
        options,
      );
      tsCode = semanticResult.code;
      report.agents.semanticFixer = {
        ...semanticResult,
        durationMs: Date.now() - t0,
      };
      console.log(
        `  ${semanticResult.testsPassed}/${semanticResult.testsGenerated} tests passing, ` +
          `${semanticResult.blocksFixed} blocks fixed in ${semanticResult.rounds} round(s) (${report.agents.semanticFixer.durationMs}ms)`,
      );
      await fs.writeFile(outputPath, tsCode, 'utf8');
    }

    // Final status
    report.totalDurationMs = Date.now() - startTime;
    if (args.skipTests || report.agents.semanticFixer.testsFailed === 0) {
      report.status =
        report.agents.syntaxFixer.errorsFixed > 0 ? 'syntax_fixed' : 'success';
    } else if (report.agents.semanticFixer.testsPassed > 0) {
      report.status = 'partial';
    } else {
      report.status = 'failed';
    }

    // Write report to test-results/transagent/ (gitignored)
    const reportDir = path.join(projectRoot, 'test-results', 'transagent');
    await fs.mkdir(reportDir, { recursive: true });
    const reportBasename = path.basename(outputPath, '.ts');
    const reportPath = path.join(reportDir, `translate-${reportBasename}.json`);
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8');

    console.log(`\n╔══════════════════════════════════════════════════════════╗`);
    console.log(`║  Result: ${report.status.toUpperCase().padEnd(47)}║`);
    console.log(`╚══════════════════════════════════════════════════════════╝`);
    console.log(`  Output:    ${path.relative(repoRoot, outputPath)}`);
    if (!args.skipTests) {
      console.log(`  Tests:     ${path.relative(repoRoot, testOutputPath)}`);
    }
    console.log(`  Report:    ${path.relative(repoRoot, reportPath)}`);
    console.log(`  Duration:  ${(report.totalDurationMs / 1000).toFixed(1)}s`);
    console.log('');
  } catch (err) {
    report.totalDurationMs = Date.now() - startTime;
    report.status = 'failed';
    console.error(`\nPIPELINE FAILED:`, err);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Verify mode
// ---------------------------------------------------------------------------

async function runVerifyMode(args: CliArgs): Promise<void> {
  const options = buildOptions(args);
  const startTime = Date.now();

  console.log(`\n╔══════════════════════════════════════════════════════════╗`);
  console.log(`║  TransAGENT — Parity Verification Mode                  ║`);
  console.log(`╚══════════════════════════════════════════════════════════╝\n`);

  if (args.verify) {
    // Manual verify: --verify <ts-file> --source <cpp-file>[,<cpp-file2>]
    if (!args.source) {
      console.error('Error: --verify requires --source <cpp-file>\n');
      printUsage();
      process.exit(1);
    }

    const tsPath = path.isAbsolute(args.verify)
      ? args.verify
      : path.join(repoRoot, args.verify);
    const cppPaths = args.source.split(',').map((p) =>
      path.isAbsolute(p.trim()) ? p.trim() : path.join(repoRoot, p.trim()),
    );

    console.log(`TS File:  ${path.relative(repoRoot, tsPath)}`);
    console.log(`C++ Files: ${cppPaths.map((p) => path.relative(repoRoot, p)).join(', ')}`);

    const result = await verifyFile(tsPath, cppPaths, options);
    const report = formatVerifyReport([result]);

    // Write report
    const reportDir = path.join(projectRoot, 'test-results', 'transagent');
    await fs.mkdir(reportDir, { recursive: true });
    const reportPath = path.join(
      reportDir,
      `verify-${path.basename(args.verify, '.ts')}.md`,
    );
    await fs.writeFile(reportPath, report, 'utf8');

    console.log(`\n${report}`);
    console.log(`\nReport:   ${path.relative(repoRoot, reportPath)}`);
    console.log(`Duration: ${((Date.now() - startTime) / 1000).toFixed(1)}s`);

  } else if (args.verifyAuto && args.scan) {
    // Scan mode: --verify-auto --scan <directory>
    const scanDir = path.isAbsolute(args.scan)
      ? args.scan
      : path.join(repoRoot, args.scan);

    console.log(`Scan dir: ${path.relative(repoRoot, scanDir)}`);

    const results = await verifyScan(scanDir, options);
    const report = formatVerifyReport(results);

    const reportDir = path.join(projectRoot, 'test-results', 'transagent');
    await fs.mkdir(reportDir, { recursive: true });
    const reportPath = path.join(reportDir, 'verify-scan.md');
    await fs.writeFile(reportPath, report, 'utf8');

    // Also write JSON
    const jsonPath = path.join(reportDir, 'verify-scan.json');
    await fs.writeFile(jsonPath, JSON.stringify(results, null, 2) + '\n', 'utf8');

    console.log(`\n${report}`);
    console.log(`\nReport:   ${path.relative(repoRoot, reportPath)}`);
    console.log(`JSON:     ${path.relative(repoRoot, jsonPath)}`);
    console.log(`Duration: ${((Date.now() - startTime) / 1000).toFixed(1)}s`);

  } else if (args.verifyAuto) {
    // Auto-verify single file: --verify-auto <ts-file>
    const tsPath = path.isAbsolute(args.verifyAuto)
      ? args.verifyAuto
      : path.join(repoRoot, args.verifyAuto);

    console.log(`TS File:  ${path.relative(repoRoot, tsPath)}`);
    console.log(`Mode:     Auto-detect C++ origins from source parity comments\n`);

    const result = await verifyFileAuto(tsPath, options);
    const report = formatVerifyReport([result]);

    const reportDir = path.join(projectRoot, 'test-results', 'transagent');
    await fs.mkdir(reportDir, { recursive: true });
    const reportPath = path.join(
      reportDir,
      `verify-${path.basename(args.verifyAuto, '.ts')}.md`,
    );
    await fs.writeFile(reportPath, report, 'utf8');

    console.log(`\n${report}`);
    console.log(`\nReport:   ${path.relative(repoRoot, reportPath)}`);
    console.log(`Duration: ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  // Determine mode
  if (args.verify || args.verifyAuto) {
    await runVerifyMode(args);
  } else if (args.source) {
    await runTranslatePipeline(args);
  } else {
    console.error('Error: --source (translate mode) or --verify/--verify-auto (verify mode) is required\n');
    printUsage();
    process.exit(1);
  }
}

const executedScriptPath = process.argv[1]
  ? path.resolve(process.argv[1])
  : null;
const currentScriptPath = fileURLToPath(import.meta.url);

if (executedScriptPath === currentScriptPath) {
  await main();
}

export { runTranslatePipeline, runVerifyMode, parseArgs };
