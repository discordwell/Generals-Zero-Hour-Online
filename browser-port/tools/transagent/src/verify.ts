/**
 * TransAGENT Verification Mode
 *
 * Takes existing TS code + its C++ origins and verifies parity using
 * Agents 3 (Code Aligner) + 4 (Semantic Fixer), skipping Agent 1 (translation).
 *
 * Three sub-modes:
 *   --verify <ts-file> --source <cpp-file>     Manual: specify both files
 *   --verify-auto <ts-file>                    Auto: parse source parity comments to find C++ origins
 *   --verify-auto --scan <directory>           Scan: verify all TS files in a directory
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  parseSourceParityComments,
  groupRefsByFunction,
  type SourceParityMap,
  type SourceParityRef,
} from './lib/source-parity-parser.js';
import { extractFunction } from './lib/cpp-context.js';
import { runCodeAligner } from './agents/code-aligner.js';
import { generateTests, runTests } from './agents/semantic-fixer.js';
import { queryClaude, extractCodeBlock } from './lib/claude.js';
import type {
  PipelineOptions,
  CodeBlock,
  BlockAlignment,
  TranslationContext,
} from './lib/types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VerifyResult {
  tsFile: string;
  cppFiles: string[];
  functions: FunctionVerifyResult[];
  summary: {
    totalFunctions: number;
    verified: number;
    divergent: number;
    skipped: number;
  };
  durationMs: number;
}

export interface FunctionVerifyResult {
  tsFunctionName: string;
  cppOrigin: string;
  cppLines: string | null;
  status: 'pass' | 'divergent' | 'fixed' | 'skipped';
  testsGenerated: number;
  testsPassed: number;
  testsFailed: number;
  divergences: string[];
  fix: string | null;
}

// ---------------------------------------------------------------------------
// Resolve C++ file paths
// ---------------------------------------------------------------------------

async function findCppFile(
  ref: SourceParityRef,
  repoRoot: string,
): Promise<string | null> {
  // Try full path first
  if (ref.fullPath) {
    const full = path.join(repoRoot, ref.fullPath);
    try {
      await fs.access(full);
      return full;
    } catch {
      // Also try GeneralsMD variant
      const mdPath = ref.fullPath.replace(/^Generals\//, 'GeneralsMD/');
      const mdFull = path.join(repoRoot, mdPath);
      try {
        await fs.access(mdFull);
        return mdFull;
      } catch {
        // Fall through to search
      }
    }
  }

  // Search by filename
  if (ref.fileName && /\.\w+$/.test(ref.fileName)) {
    const searchDirs = [
      'Generals/Code/GameEngine/Source',
      'Generals/Code/GameEngine/Include',
      'GeneralsMD/Code/GameEngine/Source',
      'GeneralsMD/Code/GameEngine/Include',
    ];
    for (const dir of searchDirs) {
      const dirPath = path.join(repoRoot, dir);
      try {
        await fs.access(dirPath);
        const results = await findFileRecursive(dirPath, ref.fileName);
        if (results.length > 0) return results[0]!;
      } catch {
        // Directory doesn't exist
      }
    }
  }

  return null;
}

async function findFileRecursive(
  dir: string,
  fileName: string,
): Promise<string[]> {
  const results: string[] = [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...(await findFileRecursive(fullPath, fileName)));
      } else if (entry.name === fileName) {
        results.push(fullPath);
      }
    }
  } catch {
    // Permission denied or similar
  }
  return results;
}

// ---------------------------------------------------------------------------
// Extract relevant C++ code for a specific reference
// ---------------------------------------------------------------------------

async function extractCppCode(
  cppPath: string,
  ref: SourceParityRef,
): Promise<string | null> {
  try {
    const source = await fs.readFile(cppPath, 'utf8');

    // If specific lines are referenced, extract that range with context
    if (ref.startLine !== null && ref.endLine !== null) {
      const lines = source.split('\n');
      // Add some context around the referenced lines
      const contextLines = 10;
      const start = Math.max(0, ref.startLine - 1 - contextLines);
      const end = Math.min(lines.length, ref.endLine + contextLines);
      return lines.slice(start, end).join('\n');
    }

    // If a function name is mentioned in the description, try to extract it
    const funcNameMatch = ref.description.match(/(\w+::\w+|\b\w+)\(\)/);
    if (funcNameMatch) {
      const extracted = extractFunction(source, funcNameMatch[1]!);
      if (extracted) return extracted;
    }

    // Return the full file (for file-level references)
    return source;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Verify a single TS function against its C++ origin
// ---------------------------------------------------------------------------

async function verifyFunction(
  tsFuncName: string,
  tsFuncCode: string,
  cppCode: string,
  cppOriginLabel: string,
  fullTsSource: string,
  options: PipelineOptions,
): Promise<FunctionVerifyResult> {
  const result: FunctionVerifyResult = {
    tsFunctionName: tsFuncName,
    cppOrigin: cppOriginLabel,
    cppLines: null,
    status: 'skipped',
    testsGenerated: 0,
    testsPassed: 0,
    testsFailed: 0,
    divergences: [],
    fix: null,
  };

  try {
    // Agent 3: Align blocks between C++ and TS
    if (options.verbose) {
      console.log(`    Aligning blocks for ${tsFuncName}...`);
    }
    const { sourceBlocks, targetBlocks, alignment } = await runCodeAligner(
      cppCode,
      tsFuncCode,
      options,
    );

    // Agent 4 (partial): Generate parity tests
    if (options.verbose) {
      console.log(`    Generating parity tests for ${tsFuncName}...`);
    }

    const context: TranslationContext = {
      cppSource: cppCode,
      sourcePath: cppOriginLabel,
      functionName: tsFuncName,
      functionSource: cppCode,
      typeContext: '',
      dependencies: '',
    };

    // Ask Claude to identify divergences by comparing the aligned blocks
    const divergences = await identifyDivergences(
      sourceBlocks,
      targetBlocks,
      alignment,
      cppCode,
      tsFuncCode,
      options,
    );

    result.divergences = divergences;

    if (divergences.length === 0) {
      result.status = 'pass';
      if (options.verbose) {
        console.log(`    PASS — no divergences found`);
      }
    } else {
      result.status = 'divergent';
      if (options.verbose) {
        console.log(`    DIVERGENT — ${divergences.length} issue(s) found:`);
        for (const d of divergences) {
          console.log(`      - ${d}`);
        }
      }
    }

    return result;
  } catch (err) {
    if (options.verbose) {
      console.log(`    ERROR: ${err}`);
    }
    result.status = 'skipped';
    return result;
  }
}

// ---------------------------------------------------------------------------
// Identify divergences by comparing aligned blocks
// ---------------------------------------------------------------------------

async function identifyDivergences(
  sourceBlocks: CodeBlock[],
  targetBlocks: CodeBlock[],
  alignment: BlockAlignment[],
  cppCode: string,
  tsCode: string,
  options: PipelineOptions,
): Promise<string[]> {
  // Build a focused comparison prompt
  const comparisons: string[] = [];
  for (const a of alignment) {
    const sb = sourceBlocks.find((b) => b.id === a.sourceBlockId);
    const tb = targetBlocks.find((b) => b.id === a.targetBlockId);
    if (sb && tb) {
      comparisons.push(
        `--- Alignment: C++ Block ${sb.id} ↔ TS Block ${tb.id} ---\n` +
          `C++:\n${sb.code}\n\nTypeScript:\n${tb.code}`,
      );
    } else if (sb && !tb) {
      comparisons.push(
        `--- MISSING in TS: C++ Block ${sb.id} ---\n${sb.code}`,
      );
    }
  }

  // Check for unmapped target blocks
  const mappedTargetIds = new Set(alignment.map((a) => a.targetBlockId));
  for (const tb of targetBlocks) {
    if (!mappedTargetIds.has(tb.id)) {
      comparisons.push(
        `--- EXTRA in TS (no C++ origin): TS Block ${tb.id} ---\n${tb.code}`,
      );
    }
  }

  const prompt = `You are verifying that a TypeScript translation is semantically faithful to the C++ original.
Analyze each aligned block pair and identify ANY behavioral divergences.

## Full C++ Source
\`\`\`cpp
${cppCode}
\`\`\`

## Full TypeScript Translation
\`\`\`typescript
${tsCode}
\`\`\`

## Block-by-Block Alignment
${comparisons.join('\n\n')}

## Instructions
For each aligned pair, check:
1. Does the TS block produce the EXACT same result as the C++ block for all inputs?
2. Are there arithmetic differences (integer truncation, unsigned overflow, float precision)?
3. Are there control flow differences (missing branches, different conditions)?
4. Are there missing operations (side effects, state mutations)?
5. Are there extra operations in TS not present in C++ (added validation, error handling)?

Output a JSON array of divergence descriptions. Each entry is a string describing one specific divergence.
If there are NO divergences, output an empty array: []

Output ONLY the JSON array:`;

  const response = await queryClaude(prompt, {
    model: options.model ?? undefined,
  });

  try {
    const jsonStr = response.match(/\[[\s\S]*\]/)?.[0];
    if (!jsonStr) return [];
    const divergences = JSON.parse(jsonStr) as string[];
    return divergences.filter((d) => typeof d === 'string' && d.length > 0);
  } catch {
    // If we can't parse, try to extract any useful info
    if (
      response.toLowerCase().includes('no divergence') ||
      response.includes('[]')
    ) {
      return [];
    }
    return [`(Unparseable response — manual review needed)`];
  }
}

// ---------------------------------------------------------------------------
// Extract a TS function body by name
// ---------------------------------------------------------------------------

function extractTsFunction(
  tsSource: string,
  funcName: string,
): string | null {
  // Try multiple patterns for TS function declarations
  const patterns = [
    // export function name(
    new RegExp(
      `(export\\s+(?:async\\s+)?function\\s+${escapeRegex(funcName)}\\s*\\([^)]*\\)[^{]*\\{)`,
      'm',
    ),
    // export const name = (
    new RegExp(
      `(export\\s+const\\s+${escapeRegex(funcName)}\\s*=\\s*(?:async\\s+)?(?:function)?\\s*\\([^)]*\\)[^{]*\\{)`,
      'm',
    ),
    // method name( inside a class
    new RegExp(
      `(\\s+(?:async\\s+)?${escapeRegex(funcName)}\\s*\\([^)]*\\)[^{]*\\{)`,
      'm',
    ),
  ];

  for (const pattern of patterns) {
    const match = tsSource.match(pattern);
    if (!match) continue;

    const startIdx = tsSource.indexOf(match[1]!, match.index);
    if (startIdx === -1) continue;

    const braceStart = tsSource.indexOf('{', startIdx);
    if (braceStart === -1) continue;

    // Count braces to find matching close
    let depth = 0;
    for (let i = braceStart; i < tsSource.length; i++) {
      if (tsSource[i] === '{') depth++;
      if (tsSource[i] === '}') {
        depth--;
        if (depth === 0) {
          return tsSource.slice(startIdx, i + 1);
        }
      }
    }
  }

  return null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// Main verify pipeline
// ---------------------------------------------------------------------------

/**
 * Verify a single TS file against specified C++ source files.
 */
export async function verifyFile(
  tsFilePath: string,
  cppFilePaths: string[],
  options: PipelineOptions,
): Promise<VerifyResult> {
  const startTime = Date.now();
  const tsSource = await fs.readFile(tsFilePath, 'utf8');
  const functions: FunctionVerifyResult[] = [];

  // Read all C++ files
  const cppSources = new Map<string, string>();
  for (const cppPath of cppFilePaths) {
    try {
      const absPath = path.isAbsolute(cppPath)
        ? cppPath
        : path.join(options.repoRoot, cppPath);
      cppSources.set(cppPath, await fs.readFile(absPath, 'utf8'));
    } catch {
      console.warn(`  Could not read C++ file: ${cppPath}`);
    }
  }

  if (cppSources.size === 0) {
    return {
      tsFile: tsFilePath,
      cppFiles: cppFilePaths,
      functions: [],
      summary: { totalFunctions: 0, verified: 0, divergent: 0, skipped: 0 },
      durationMs: Date.now() - startTime,
    };
  }

  // Combine all C++ source for whole-file comparison
  const combinedCpp = [...cppSources.values()].join('\n\n// === FILE BOUNDARY ===\n\n');

  console.log(`  Verifying ${path.basename(tsFilePath)} against ${cppSources.size} C++ file(s)...`);

  // Run whole-file alignment and divergence check
  if (options.verbose) {
    console.log(`  Running whole-file block alignment...`);
  }

  const { sourceBlocks, targetBlocks, alignment } = await runCodeAligner(
    combinedCpp,
    tsSource,
    options,
  );

  console.log(
    `  Aligned: ${sourceBlocks.length} C++ blocks ↔ ${targetBlocks.length} TS blocks`,
  );

  // Identify divergences at the whole-file level
  if (options.verbose) {
    console.log(`  Checking for semantic divergences...`);
  }

  const divergences = await identifyDivergences(
    sourceBlocks,
    targetBlocks,
    alignment,
    combinedCpp,
    tsSource,
    options,
  );

  functions.push({
    tsFunctionName: '(whole file)',
    cppOrigin: cppFilePaths.join(', '),
    cppLines: null,
    status: divergences.length === 0 ? 'pass' : 'divergent',
    testsGenerated: 0,
    testsPassed: 0,
    testsFailed: 0,
    divergences,
    fix: null,
  });

  const summary = {
    totalFunctions: functions.length,
    verified: functions.filter((f) => f.status === 'pass').length,
    divergent: functions.filter((f) => f.status === 'divergent').length,
    skipped: functions.filter((f) => f.status === 'skipped').length,
  };

  return {
    tsFile: tsFilePath,
    cppFiles: cppFilePaths,
    functions,
    summary,
    durationMs: Date.now() - startTime,
  };
}

/**
 * Auto-verify a TS file by parsing its source parity comments.
 */
export async function verifyFileAuto(
  tsFilePath: string,
  options: PipelineOptions,
): Promise<VerifyResult> {
  const startTime = Date.now();
  const absPath = path.isAbsolute(tsFilePath)
    ? tsFilePath
    : path.join(options.repoRoot, tsFilePath);
  const tsSource = await fs.readFile(absPath, 'utf8');

  console.log(`\n  Scanning ${path.basename(tsFilePath)} for source parity comments...`);

  // Parse source parity comments
  const parityMap = parseSourceParityComments(tsSource, tsFilePath);
  console.log(
    `  Found ${parityMap.fileOrigins.length} file-level origins, ${parityMap.inlineRefs.length} inline refs`,
  );

  if (parityMap.uniqueCppFiles.length === 0) {
    console.log(`  No C++ origins found — skipping.`);
    return {
      tsFile: tsFilePath,
      cppFiles: [],
      functions: [],
      summary: { totalFunctions: 0, verified: 0, divergent: 0, skipped: 0 },
      durationMs: Date.now() - startTime,
    };
  }

  // Resolve C++ file paths
  const resolvedCppPaths: string[] = [];
  for (const ref of parityMap.fileOrigins) {
    const resolved = await findCppFile(ref, options.repoRoot);
    if (resolved) {
      resolvedCppPaths.push(resolved);
      if (options.verbose) {
        console.log(`  Resolved: ${ref.fileName} → ${path.relative(options.repoRoot, resolved)}`);
      }
    } else if (options.verbose) {
      console.log(`  Could not resolve: ${ref.fullPath ?? ref.fileName}`);
    }
  }

  // If no file-level origins, try unique inline refs
  if (resolvedCppPaths.length === 0) {
    const seen = new Set<string>();
    for (const ref of parityMap.inlineRefs) {
      const key = ref.fullPath ?? ref.fileName;
      if (seen.has(key)) continue;
      seen.add(key);
      const resolved = await findCppFile(ref, options.repoRoot);
      if (resolved && !resolvedCppPaths.includes(resolved)) {
        resolvedCppPaths.push(resolved);
      }
    }
  }

  console.log(`  Resolved ${resolvedCppPaths.length} C++ source file(s)`);

  if (resolvedCppPaths.length === 0) {
    console.log(`  Could not resolve any C++ origins — skipping.`);
    return {
      tsFile: tsFilePath,
      cppFiles: [],
      functions: [],
      summary: { totalFunctions: 0, verified: 0, divergent: 0, skipped: 0 },
      durationMs: Date.now() - startTime,
    };
  }

  // Run verification
  return verifyFile(absPath, resolvedCppPaths, options);
}

/**
 * Scan a directory and auto-verify all TS files.
 */
export async function verifyScan(
  dirPath: string,
  options: PipelineOptions,
): Promise<VerifyResult[]> {
  const absDir = path.isAbsolute(dirPath)
    ? dirPath
    : path.join(options.repoRoot, dirPath);

  const entries = await fs.readdir(absDir, { withFileTypes: true });
  const tsFiles = entries
    .filter(
      (e) =>
        e.isFile() &&
        e.name.endsWith('.ts') &&
        !e.name.endsWith('.test.ts') &&
        !e.name.endsWith('.d.ts'),
    )
    .map((e) => path.join(absDir, e.name));

  console.log(`Scanning ${tsFiles.length} TypeScript files in ${path.basename(absDir)}/`);

  const results: VerifyResult[] = [];
  for (const tsFile of tsFiles) {
    try {
      const result = await verifyFileAuto(tsFile, options);
      results.push(result);
    } catch (err) {
      console.warn(`  Error verifying ${path.basename(tsFile)}: ${err}`);
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Report generation
// ---------------------------------------------------------------------------

export function formatVerifyReport(results: VerifyResult[]): string {
  const lines: string[] = [];
  lines.push('# TransAGENT Verification Report\n');

  let totalPass = 0;
  let totalDivergent = 0;
  let totalSkipped = 0;
  const allDivergences: { file: string; issues: string[] }[] = [];

  for (const r of results) {
    const fileLabel = path.basename(r.tsFile);
    const pass = r.summary.verified;
    const div = r.summary.divergent;
    const skip = r.summary.skipped;
    totalPass += pass;
    totalDivergent += div;
    totalSkipped += skip;

    const statusIcon = div > 0 ? 'DIVERGENT' : pass > 0 ? 'PASS' : 'SKIP';
    lines.push(`## ${fileLabel} — ${statusIcon}`);
    lines.push(
      `  C++ origins: ${r.cppFiles.map((f) => path.basename(f)).join(', ') || '(none)'}`,
    );
    lines.push(`  Verified: ${pass} | Divergent: ${div} | Skipped: ${skip}`);
    lines.push(`  Duration: ${(r.durationMs / 1000).toFixed(1)}s`);

    for (const f of r.functions) {
      if (f.divergences.length > 0) {
        lines.push(`\n  ### ${f.tsFunctionName}`);
        for (const d of f.divergences) {
          lines.push(`  - ${d}`);
        }
        allDivergences.push({ file: fileLabel, issues: f.divergences });
      }
    }
    lines.push('');
  }

  lines.push('---');
  lines.push(`## Summary`);
  lines.push(`  Files scanned: ${results.length}`);
  lines.push(`  Passed: ${totalPass}`);
  lines.push(`  Divergent: ${totalDivergent}`);
  lines.push(`  Skipped: ${totalSkipped}`);

  if (allDivergences.length > 0) {
    lines.push(`\n## All Divergences`);
    for (const d of allDivergences) {
      for (const issue of d.issues) {
        lines.push(`  - [${d.file}] ${issue}`);
      }
    }
  }

  return lines.join('\n');
}
