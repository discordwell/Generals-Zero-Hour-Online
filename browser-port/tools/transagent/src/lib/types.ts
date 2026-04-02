/**
 * TransAGENT — LLM-based multi-agent code translation pipeline.
 * Adapted from the TransAGENT paper (2024) for C++ → TypeScript game engine porting.
 */

export interface CodeBlock {
  id: number;
  type: 'sequential' | 'if' | 'for' | 'while' | 'switch' | 'try' | 'return' | 'function';
  code: string;
  startLine: number;
  endLine: number;
}

export interface BlockAlignment {
  sourceBlockId: number;
  targetBlockId: number;
}

export interface TranslationContext {
  /** Raw C++ source text */
  cppSource: string;
  /** Path to the C++ source file */
  sourcePath: string;
  /** Specific function to translate (null = whole file) */
  functionName: string | null;
  /** Extracted function body (if functionName specified) */
  functionSource: string | null;
  /** Type definitions and struct/class declarations from headers */
  typeContext: string;
  /** Already-translated TS dependency code for reference */
  dependencies: string;
}

export interface PipelineOptions {
  /** Claude model override (null = use CLI default) */
  model: string | null;
  /** Output path for the translated TS file */
  outputPath: string;
  /** Output path for the generated test file */
  testOutputPath: string | null;
  /** Max rounds of syntax fixing before giving up */
  maxSyntaxRounds: number;
  /** Max rounds of semantic fixing before giving up */
  maxSemanticRounds: number;
  /** Print verbose progress */
  verbose: boolean;
  /** Project root (browser-port/) for tsc and vitest */
  projectRoot: string;
  /** Repository root (parent of browser-port/) */
  repoRoot: string;
}

export interface TranslationReport {
  sourcePath: string;
  functionName: string | null;
  outputPath: string;
  testOutputPath: string | null;
  status: 'success' | 'syntax_fixed' | 'partial' | 'failed';
  agents: {
    initialTranslation: { durationMs: number };
    syntaxFixer: { rounds: number; durationMs: number; errorsFixed: number };
    codeAligner: {
      sourceBlocks: number;
      targetBlocks: number;
      alignments: number;
      durationMs: number;
    };
    semanticFixer: {
      testsGenerated: number;
      testsPassed: number;
      testsFailed: number;
      rounds: number;
      durationMs: number;
      blocksFixed: number;
    };
  };
  totalDurationMs: number;
}

export interface TestResult {
  name: string;
  status: 'pass' | 'fail';
  error?: string;
  expected?: string;
  actual?: string;
}
