# TransAGENT

Multi-agent C++ to TypeScript translation and parity verification pipeline, adapted from the [TransAGENT paper](https://arxiv.org/abs/2409.19894) (2024).

## Why this exists

AI-assisted code porting has a consistent failure mode: the LLM paraphrases rather than faithfully translates. It produces code that "looks right" but drifts from the original semantics. TransAGENT addresses this with a structured pipeline that forces block-level alignment and iterative verification, making parity checking systematic rather than ad-hoc.

## Two modes

### Translate mode

Full 4-agent pipeline for translating new C++ code to TypeScript:

| Agent | Role | Implementation |
|-------|------|----------------|
| **1. Initial Translator** | C++ to TS with 40+ explicit feature mapping rules | Prompt includes type context from headers, already-ported dependencies |
| **2. Syntax Fixer** | Iterative `tsc` error loop | Writes file, runs tsc, parses errors, fixes. Terminates on clean compile, repeated errors, or max rounds |
| **3. Code Aligner** | CFG-based block extraction + alignment | Heuristic block extractor with Claude fallback, then LLM block-to-block mapping |
| **4. Semantic Fixer** | Test-driven block-level error localization | Generates parity tests from C++ behavior analysis, runs vitest, localizes failures to blocks, applies vanilla + value-aware fix strategies |

### Verify mode

Agents 3+4 only, for checking existing TypeScript code against its C++ origins. Parses `// Source parity:` comments already in the codebase to auto-discover which C++ files map to which TS files.

## When to use each mode

| Scenario | Command |
|----------|---------|
| Porting a new C++ file that hasn't been translated yet | `--source <cpp-file>` (translate mode) |
| Porting a specific function from a C++ file | `--source <cpp-file> --function "Class::method"` |
| Checking if an existing TS file matches its C++ origins | `--verify-auto <ts-file>` |
| Checking a TS file against a specific C++ file | `--verify <ts-file> --source <cpp-file>` |
| Auditing parity across an entire package | `--verify-auto --scan <directory>` |
| Quick translation without running tests | `--source <cpp-file> --skip-tests` |

## Usage

All commands run from the `browser-port/` directory.

### Translate

```bash
# Translate a full C++ file
npm run transagent -- \
  --source Generals/Code/GameEngine/Source/Common/RTS/Money.cpp \
  --output browser-port/packages/game-logic/src/money.ts \
  --verbose

# Translate a specific function
npm run transagent -- \
  --source Generals/Code/GameEngine/Source/Common/RTS/Player.cpp \
  --function "Player::getMoney" \
  --output browser-port/packages/game-logic/src/player-money.ts

# With type context and existing dependencies
npm run transagent -- \
  --source Generals/Code/GameEngine/Source/Common/RTS/Money.cpp \
  --context Generals/Code/GameEngine/Include/Common/RTS/Money.h \
  --deps browser-port/packages/core/src/types.ts \
  --output browser-port/packages/game-logic/src/money.ts

# Translation only (skip test generation/running)
npm run transagent -- \
  --source Generals/Code/GameEngine/Source/Common/RTS/Money.cpp \
  --output browser-port/packages/game-logic/src/money.ts \
  --skip-tests
```

### Verify

```bash
# Auto-verify a single file (parses source parity comments)
npm run transagent:verify -- browser-port/packages/game-logic/src/experience.ts -v

# Manually specify the C++ files to compare against
npm run transagent -- \
  --verify browser-port/packages/game-logic/src/experience.ts \
  --source Generals/Code/GameEngine/Source/GameLogic/Object/ExperienceTracker.cpp -v

# Scan and verify all TS files in a directory
npm run transagent:scan -- browser-port/packages/game-logic/src -v
```

## How source parity comment auto-discovery works

The existing codebase annotates C++ origins in three formats that the tool parses automatically:

**File-level header** (lists all C++ files a TS file draws from):
```typescript
/**
 * Source parity:
 *   Generals/Code/GameEngine/Source/GameLogic/Object/ExperienceTracker.cpp
 *   Generals/Code/GameEngine/Source/GameLogic/Object/Body/ActiveBody.cpp (lines 1126-1159)
 */
```

**Inline comments** (maps a specific TS section to C++ location):
```typescript
// Source parity: ActiveBody.cpp lines 1139-1159
// Source parity: GlobalData.cpp:940 — all default to 1.0
// Source parity (ZH): AIStates.cpp:5547-5551 — chooseWeapon()
```

**JSDoc comments**:
```typescript
/** Source parity: ThingTemplate.h:689 — m_skillPointValues[LEVEL_COUNT]. */
```

The tool resolves short filenames (e.g., `ActiveBody.cpp`) by searching `Generals/Code/` and `GeneralsMD/Code/` automatically.

## Output

All reports go to `browser-port/test-results/transagent/` (gitignored).

| Mode | Output files |
|------|-------------|
| Translate | The TS file at `--output`, plus `test-results/transagent/translate-<name>.json` |
| Verify (single) | `test-results/transagent/verify-<name>.md` |
| Verify (scan) | `test-results/transagent/verify-scan.md` + `verify-scan.json` |

When using translate mode without `--output`, files default to `packages/game-logic/src/translated/` (also gitignored).

## Options reference

```
TRANSLATE MODE:
  --source <path>           C++ source file (relative to repo root or absolute)  [required]
  --function <name>         Specific function/method to translate
  --output <path>           Output TS file path
  --test-output <path>      Output test file path
  --context <paths>         Additional C++ files for type context (comma-separated)
  --deps <paths>            Already-translated TS dependencies (comma-separated)
  --skip-tests              Skip Agent 4 (semantic fixer)
  --max-syntax-rounds <n>   Max syntax fix iterations (default: 5)
  --max-semantic-rounds <n> Max semantic fix iterations (default: 3)

VERIFY MODE:
  --verify <ts-file>        Verify a TS file (requires --source for C++ files)
  --verify-auto <ts-file>   Verify a TS file, auto-detecting C++ origins
  --verify-auto --scan <dir>  Scan and verify all TS files in a directory

SHARED:
  --model <model>           Claude model to use (default: CLI default)
  --verbose, -v             Verbose progress output
  --help, -h                Show help
```

## How it works (technical detail)

### Block extraction (Agent 3)

The Code Aligner splits both C++ and TypeScript code into numbered blocks using control flow analysis:

1. Continuous statement sequences (assignments, calls, declarations) = one **sequential** block
2. Each control flow construct (`if`/`for`/`while`/`switch`/`try`) including its body = one block
3. Each `return` statement = one block

A heuristic parser handles this locally. For files where the heuristic produces too few blocks, it falls back to an LLM-based extraction.

### Block alignment

After extraction, Claude maps each C++ block to its corresponding TypeScript block by semantic equivalence (not line position). The alignment handles code reordering, split blocks, and merged blocks.

### Divergence detection (Verify mode)

With the alignment in hand, Claude compares each block pair checking for:
- Arithmetic differences (integer truncation, unsigned overflow, float precision)
- Control flow differences (missing branches, different conditions)
- Missing operations (side effects, state mutations)
- Extra operations not in the original (added validation, error handling)
- Missing functions entirely (C++ methods with no TS equivalent)

### Semantic fixing (Translate mode)

When a test fails, the pipeline localizes the failure to a specific TypeScript block using the alignment, then applies two fix strategies from the paper:

1. **Vanilla**: Shows only the error block, mapped C++ block, and test failure. Best for structural/logical errors.
2. **Value-aware**: Additionally provides expected vs actual runtime values. Best for numeric precision and overflow issues.

## Architecture

```
tools/transagent/
  src/
    cli.ts                         CLI entry point + pipeline orchestration
    verify.ts                      Verification pipeline (auto-discovery + report)
    agents/
      initial-translator.ts        Agent 1: C++ to TS translation
      syntax-fixer.ts              Agent 2: tsc error fixing loop
      code-aligner.ts              Agent 3: block extraction + alignment
      semantic-fixer.ts            Agent 4: test generation + block-level fixing
    lib/
      types.ts                     Shared types (CodeBlock, BlockAlignment, etc.)
      claude.ts                    Claude CLI wrapper (shells out to `claude -p`)
      cpp-context.ts               C++ source extraction (functions, includes, types)
      source-parity-parser.ts      Parses // Source parity: comments from TS files
  package.json
```

Each agent is implemented as a standalone module with a clear interface. The `claude.ts` wrapper shells out to the `claude -p` CLI, leveraging the user's existing Claude Code authentication.

## Limitations

- **No C++ execution**: Since the original C++ has Windows/DirectX dependencies that don't compile on macOS, Agent 4 uses Claude as a "C++ oracle" to trace expected behavior rather than actually running both programs. This is less rigorous than the paper's differential testing approach but practical for this context.
- **Large files**: Whole-file verification of very large TS files (>1000 lines) with many C++ origins can produce a lot of blocks. The block count disparity (e.g., 409 C++ blocks vs 19 TS blocks when combining 5 C++ files) means alignment is approximate.
- **Speed**: Each Claude call takes 5-30 seconds. A full translate pipeline takes ~3-5 minutes. Verification of a single file takes ~1-6 minutes depending on size. Scanning a full directory is sequential and can take hours.
