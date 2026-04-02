/**
 * Agent 3: Code Aligner
 *
 * Two-phase approach from the paper:
 *   Phase 1 — Block Extraction: Divide source and target into numbered blocks
 *     based on control flow analysis (if/for/while/switch/try = individual blocks,
 *     continuous statements = sequential blocks).
 *   Phase 2 — Block Alignment: LLM maps each source block to its target block.
 *
 * The paper uses Joern for CFG analysis. We use Claude since Joern isn't available
 * and Claude handles both C++ and TS parsing well.
 */

import { queryClaude, extractCodeBlock } from '../lib/claude.js';
import type { CodeBlock, BlockAlignment, PipelineOptions } from '../lib/types.js';

/**
 * Heuristic block extractor — splits code on control flow boundaries.
 * This runs locally without LLM calls. Falls back to LLM extraction
 * if the heuristic produces too few blocks.
 */
export function extractBlocksHeuristic(
  code: string,
  language: 'cpp' | 'ts',
): CodeBlock[] {
  const lines = code.split('\n');
  const blocks: CodeBlock[] = [];
  let blockId = 0;

  const controlFlowPattern =
    /^\s*(if\s*\(|else\s+if\s*\(|else\s*\{|for\s*\(|while\s*\(|do\s*\{|switch\s*\(|try\s*\{|catch\s*[\({]|finally\s*\{|case\s+|default\s*:)/;
  const returnPattern = /^\s*return\b/;
  const functionPattern =
    language === 'cpp'
      ? /^\s*(?:[\w:*&<>,\s]+?)\s+\w+(?:::\w+)?\s*\([^)]*\)\s*(?:const)?\s*\{/
      : /^\s*(?:export\s+)?(?:async\s+)?(?:function\s+\w+|(?:const|let|var)\s+\w+\s*=\s*(?:async\s+)?(?:\([^)]*\)|[^=])\s*=>|\w+\s*\([^)]*\)\s*(?::\s*\w+)?\s*\{)/;

  let currentLines: string[] = [];
  let currentStart = 0;

  function flushSequential(endLine: number): void {
    const code = currentLines.join('\n').trim();
    if (code.length > 0) {
      blocks.push({
        id: blockId++,
        type: 'sequential',
        code,
        startLine: currentStart,
        endLine,
      });
    }
    currentLines = [];
  }

  /**
   * Given a starting line with an opening brace, find the matching close brace.
   * Returns the line index of the closing brace.
   */
  function findMatchingBrace(startLine: number): number {
    let depth = 0;
    for (let i = startLine; i < lines.length; i++) {
      for (const ch of lines[i]!) {
        if (ch === '{') depth++;
        if (ch === '}') {
          depth--;
          if (depth === 0) return i;
        }
      }
    }
    return lines.length - 1;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();

    // Skip empty lines and preprocessor directives
    if (trimmed === '' || trimmed.startsWith('#') || trimmed.startsWith('//')) {
      currentLines.push(line);
      continue;
    }

    // Check for control flow
    if (controlFlowPattern.test(line)) {
      flushSequential(i - 1);
      currentStart = i;

      // Determine block type
      let type: CodeBlock['type'] = 'sequential';
      if (/^\s*if\s*\(|^\s*else/.test(line)) type = 'if';
      else if (/^\s*for\s*\(/.test(line)) type = 'for';
      else if (/^\s*while\s*\(|^\s*do\s*\{/.test(line)) type = 'while';
      else if (/^\s*switch\s*\(/.test(line)) type = 'switch';
      else if (/^\s*try\s*\{|^\s*catch|^\s*finally/.test(line)) type = 'try';

      // Find the extent of this control flow block
      const endLine = line.includes('{')
        ? findMatchingBrace(i)
        : i; // single-line statement

      const blockCode = lines.slice(i, endLine + 1).join('\n');
      blocks.push({
        id: blockId++,
        type,
        code: blockCode,
        startLine: i,
        endLine,
      });

      i = endLine; // Skip past this block
      currentStart = endLine + 1;
      continue;
    }

    // Check for return statements
    if (returnPattern.test(line)) {
      flushSequential(i - 1);
      blocks.push({
        id: blockId++,
        type: 'return',
        code: trimmed,
        startLine: i,
        endLine: i,
      });
      currentStart = i + 1;
      continue;
    }

    // Check for function definitions
    if (functionPattern.test(line) && line.includes('{')) {
      flushSequential(i - 1);
      const endLine = findMatchingBrace(i);
      blocks.push({
        id: blockId++,
        type: 'function',
        code: lines.slice(i, endLine + 1).join('\n'),
        startLine: i,
        endLine,
      });
      i = endLine;
      currentStart = endLine + 1;
      continue;
    }

    // Regular statement — accumulate
    if (currentLines.length === 0) currentStart = i;
    currentLines.push(line);
  }

  // Flush remaining
  flushSequential(lines.length - 1);

  return blocks;
}

/**
 * LLM-based block extraction for when heuristic isn't sufficient.
 */
async function extractBlocksWithClaude(
  code: string,
  language: 'cpp' | 'ts',
  options: PipelineOptions,
): Promise<CodeBlock[]> {
  const langName = language === 'cpp' ? 'C++' : 'TypeScript';

  const prompt = `Divide the following ${langName} code into numbered blocks for semantic comparison.

BLOCK RULES (from TransAGENT paper):
1. A continuous sequence of non-control-flow statements (assignments, declarations, function calls) = ONE sequential block.
2. Each control flow construct (if/else, for, while, switch, try/catch) INCLUDING its body = ONE block.
3. Each return statement = ONE block.
4. Nested control flow is part of the enclosing block (don't recursively split).

Output ONLY a JSON array. Each element: {"id": N, "type": "sequential|if|for|while|switch|try|return|function", "startLine": N, "endLine": N, "code": "..."}

Line numbers are 1-indexed from the start of the provided code.

\`\`\`${language === 'cpp' ? 'cpp' : 'typescript'}
${code}
\`\`\`

Output the JSON array only, no explanation:`;

  const response = await queryClaude(prompt, {
    model: options.model ?? undefined,
  });

  try {
    // Try to parse as JSON
    const jsonStr = response.match(/\[[\s\S]*\]/)?.[0];
    if (!jsonStr) throw new Error('No JSON array found');

    const parsed = JSON.parse(jsonStr) as Array<{
      id: number;
      type: string;
      startLine: number;
      endLine: number;
      code: string;
    }>;

    return parsed.map((b) => ({
      id: b.id,
      type: b.type as CodeBlock['type'],
      code: b.code,
      startLine: b.startLine,
      endLine: b.endLine,
    }));
  } catch {
    // Fall back to heuristic
    console.warn(
      `  [Agent 3] LLM block extraction failed, falling back to heuristic`,
    );
    return extractBlocksHeuristic(code, language);
  }
}

/**
 * Extract blocks from code — tries heuristic first, falls back to LLM.
 */
export async function extractBlocks(
  code: string,
  language: 'cpp' | 'ts',
  options: PipelineOptions,
): Promise<CodeBlock[]> {
  const blocks = extractBlocksHeuristic(code, language);

  // If heuristic produced very few blocks for a non-trivial file, use LLM
  const lineCount = code.split('\n').length;
  if (blocks.length < 2 && lineCount > 10) {
    if (options.verbose) {
      console.log(
        `  [Agent 3] Heuristic produced only ${blocks.length} block(s) for ${lineCount} lines — using LLM extraction`,
      );
    }
    return extractBlocksWithClaude(code, language, options);
  }

  return blocks;
}

/**
 * Format blocks for display in prompts.
 */
export function formatBlocks(blocks: CodeBlock[], label: string): string {
  return blocks
    .map(
      (b) =>
        `--- ${label} BLOCK ${b.id} (${b.type}, lines ${b.startLine}-${b.endLine}) ---\n${b.code}`,
    )
    .join('\n\n');
}

/**
 * Phase 2: LLM-based block alignment.
 * Maps each source block to its corresponding target block.
 */
export async function alignBlocks(
  sourceBlocks: CodeBlock[],
  targetBlocks: CodeBlock[],
  options: PipelineOptions,
): Promise<BlockAlignment[]> {
  const sourceFormatted = formatBlocks(sourceBlocks, 'SOURCE');
  const targetFormatted = formatBlocks(targetBlocks, 'TARGET');

  const prompt = `You are aligning code blocks between a C++ source and its TypeScript translation.
For each source block, identify which target block implements the same logic.

## Source Blocks (C++)
${sourceFormatted}

## Target Blocks (TypeScript)
${targetFormatted}

## Instructions
Output a JSON array of mappings: [{"sourceBlockId": N, "targetBlockId": N}, ...]

Rules:
- Every source block should map to exactly one target block (or -1 if missing)
- Every target block should be mapped from at most one source block
- Match by semantic equivalence, not line position
- If a source block was split across multiple target blocks, map to the primary one

Output ONLY the JSON array:`;

  const response = await queryClaude(prompt, {
    model: options.model ?? undefined,
  });

  try {
    const jsonStr = response.match(/\[[\s\S]*\]/)?.[0];
    if (!jsonStr) throw new Error('No JSON array found');

    return JSON.parse(jsonStr) as BlockAlignment[];
  } catch {
    // Fallback: align by position
    console.warn(`  [Agent 3] LLM alignment failed — falling back to positional alignment`);
    return sourceBlocks.map((sb, i) => ({
      sourceBlockId: sb.id,
      targetBlockId: i < targetBlocks.length ? targetBlocks[i]!.id : -1,
    }));
  }
}

/**
 * Run the full Code Aligner pipeline.
 */
export async function runCodeAligner(
  cppCode: string,
  tsCode: string,
  options: PipelineOptions,
): Promise<{
  sourceBlocks: CodeBlock[];
  targetBlocks: CodeBlock[];
  alignment: BlockAlignment[];
}> {
  if (options.verbose) {
    console.log(`  [Agent 3] Extracting blocks from C++ source...`);
  }
  const sourceBlocks = await extractBlocks(cppCode, 'cpp', options);

  if (options.verbose) {
    console.log(
      `  [Agent 3] Extracted ${sourceBlocks.length} C++ blocks. Extracting TS blocks...`,
    );
  }
  const targetBlocks = await extractBlocks(tsCode, 'ts', options);

  if (options.verbose) {
    console.log(
      `  [Agent 3] Extracted ${targetBlocks.length} TS blocks. Aligning...`,
    );
  }
  const alignment = await alignBlocks(sourceBlocks, targetBlocks, options);

  if (options.verbose) {
    console.log(
      `  [Agent 3] Created ${alignment.length} block alignments.`,
    );
  }

  return { sourceBlocks, targetBlocks, alignment };
}
