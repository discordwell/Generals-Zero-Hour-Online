/**
 * Agent 1: Initial Code Translator
 *
 * Translates C++ source to TypeScript with explicit feature mapping rules,
 * type context, and already-translated dependency code for reference.
 *
 * Key design principle from the paper: include the original source inline,
 * not a description of it. Show explicit translation rules for constructs
 * without direct mappings.
 */

import { queryClaude, extractCodeBlock } from '../lib/claude.js';
import type { TranslationContext, PipelineOptions } from '../lib/types.js';

const SYSTEM_PREAMBLE = `You are a C++ to TypeScript code translator for a faithful port of the C&C Generals game engine.

CRITICAL RULES:
1. This is a PARITY port. Preserve EXACT behavior of the original C++.
2. Replicate bugs in the original — do NOT fix them.
3. Preserve all arithmetic behavior (integer truncation, floating point).
4. Preserve all control flow paths exactly.
5. Do NOT add error handling, validation, or safety checks not in the original.
6. Do NOT refactor, simplify, or "improve" the logic.
7. Do NOT add comments explaining what the code does.
8. Produce UGLY-BUT-CORRECT code if necessary — correctness over idiom.`;

const FEATURE_MAPPING_RULES = `
C++ to TypeScript Translation Rules:
- int/long → number (use Math.trunc() or |0 for integer division)
- unsigned int → number (use >>> 0 for unsigned 32-bit behavior where overflow matters)
- float/double → number
- bool → boolean
- char → string (single character)
- std::string / AsciiString / Utf16String → string
- const char* → string
- NULL / nullptr → null
- Raw pointer T* → T | null
- Reference T& → T (pass by value in TS, or use object wrapper if mutation observed)
- static local variables → module-level let variables (preserve initialization semantics)
- const& parameters → regular parameters (TS has no const ref)
- enum → const enum with explicit numeric values matching C++ (or string union if string-based)
- enum bitflags → number with named constants
- switch fall-through → preserve with explicit fall-through (no break)
- #define constants → export const
- sizeof(T) → hardcode the byte size as a numeric literal
- reinterpret_cast / static_cast → direct assignment (TS has no casts, just assert types)
- delete ptr → set to null (GC handles memory)
- new T() → new T() or object literal
- std::vector<T> → T[]
- std::map<K,V> → Map<K,V>
- std::set<T> → Set<T>
- std::list<T> → T[] (or linked list if traversal order matters)
- assert() → remove (or console.assert in debug builds)
- DEBUG_ASSERTCRASH / DEBUG_CRASH → remove in translation
- Bitwise ops (| & ^ ~ << >>) → same operators in TS
- Ternary ?: → same in TS
- for (int i = 0; ...) → for (let i = 0; ...)
- do { } while → do { } while
- goto → restructure as while/break (flag exact equivalent control flow)
- friend class → not needed in TS (all members accessible)
- virtual methods → regular methods (use interface/abstract class if polymorphic dispatch needed)
- multiple inheritance → interface composition
- operator overloads → named methods (add, subtract, equals, etc.)
- this-> → this.
- :: scope resolution → module-level or static class member access
- #include → import (map to appropriate TS module)
`;

/**
 * Build the full translation prompt for Agent 1.
 */
function buildPrompt(context: TranslationContext): string {
  const sourceCode = context.functionSource ?? context.cppSource;
  const scopeLabel = context.functionName
    ? `function \`${context.functionName}\``
    : `file \`${context.sourcePath}\``;

  let prompt = `${SYSTEM_PREAMBLE}

${FEATURE_MAPPING_RULES}

---

Translate the following C++ ${scopeLabel} to TypeScript.

## C++ Source
\`\`\`cpp
${sourceCode}
\`\`\`
`;

  if (context.typeContext) {
    prompt += `
## Type Context (headers and declarations)
\`\`\`cpp
${context.typeContext}
\`\`\`
`;
  }

  if (context.dependencies) {
    prompt += `
## Already-Translated TypeScript Dependencies (for reference — use matching types/interfaces)
\`\`\`typescript
${context.dependencies}
\`\`\`
`;
  }

  prompt += `
## Output
Produce ONLY the TypeScript translation. No explanations, no comments about what you changed, no markdown outside the code fence.
Wrap the output in a single \`\`\`typescript code fence.
`;

  return prompt;
}

/**
 * Run Agent 1: Initial Code Translation.
 */
export async function translateInitial(
  context: TranslationContext,
  options: PipelineOptions,
): Promise<string> {
  const prompt = buildPrompt(context);

  if (options.verbose) {
    const promptKb = Math.round(prompt.length / 1024);
    console.log(`  [Agent 1] Sending ${promptKb}KB prompt to Claude...`);
  }

  const response = await queryClaude(prompt, {
    model: options.model ?? undefined,
  });

  return extractCodeBlock(response, 'typescript');
}
