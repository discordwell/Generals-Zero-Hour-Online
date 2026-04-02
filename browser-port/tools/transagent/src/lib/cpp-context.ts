/**
 * C++ source extraction — reads C++ files, extracts functions, resolves type context.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { TranslationContext } from './types.js';

/**
 * Extract a specific function body from C++ source code.
 * Handles class-scoped functions (ClassName::method) and free functions.
 */
export function extractFunction(
  source: string,
  functionName: string,
): string | null {
  // Build patterns for both free functions and class::method
  // e.g. "Money::deposit" or just "deposit"
  const escapedName = functionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Match: <return_type> [ClassName::]functionName(<params>) [const] {
  const pattern = new RegExp(
    `(?:^|\\n)([ \\t]*(?:[\\w:*&<>,\\s]+?)\\s+(?:\\w+::)?${escapedName}\\s*\\([^)]*\\)\\s*(?:const)?\\s*(?:override)?\\s*\\{)`,
    'm',
  );

  const match = source.match(pattern);
  if (!match) return null;

  const startIdx = source.indexOf(match[1]!, match.index);
  if (startIdx === -1) return null;

  // Find the opening brace, then count braces to find the matching close
  const braceStart = source.indexOf('{', startIdx);
  if (braceStart === -1) return null;

  let depth = 0;
  let inString = false;
  let inChar = false;
  let inLineComment = false;
  let inBlockComment = false;
  let prev = '';

  for (let i = braceStart; i < source.length; i++) {
    const ch = source[i]!;

    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      prev = ch;
      continue;
    }
    if (inBlockComment) {
      if (prev === '*' && ch === '/') inBlockComment = false;
      prev = ch;
      continue;
    }
    if (inString) {
      if (ch === '"' && prev !== '\\') inString = false;
      prev = ch;
      continue;
    }
    if (inChar) {
      if (ch === "'" && prev !== '\\') inChar = false;
      prev = ch;
      continue;
    }

    if (ch === '/' && i + 1 < source.length) {
      const next = source[i + 1];
      if (next === '/') { inLineComment = true; prev = ch; continue; }
      if (next === '*') { inBlockComment = true; prev = ch; continue; }
    }
    if (ch === '"') { inString = true; prev = ch; continue; }
    if (ch === "'") { inChar = true; prev = ch; continue; }

    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) {
        return source.slice(startIdx, i + 1);
      }
    }

    prev = ch;
  }

  // Unbalanced braces — return what we have
  return source.slice(startIdx);
}

/**
 * Extract #include directives from C++ source.
 */
export function extractIncludes(source: string): string[] {
  const includes: string[] = [];
  const regex = /#include\s+["<]([^">]+)[">]/g;
  let match;
  while ((match = regex.exec(source)) !== null) {
    includes.push(match[1]!);
  }
  return includes;
}

/**
 * Extract class/struct declarations, typedefs, and enums from a header file.
 */
export function extractTypeDeclarations(source: string): string {
  const declarations: string[] = [];

  // Extract enum declarations
  const enumPattern = /(?:enum\s+(?:class\s+)?\w+\s*(?::\s*\w+)?\s*\{[^}]*\})/gs;
  for (const match of source.matchAll(enumPattern)) {
    declarations.push(match[0]);
  }

  // Extract typedef and using declarations
  const typedefPattern = /(?:typedef\s+.+?;|using\s+\w+\s*=\s*.+?;)/g;
  for (const match of source.matchAll(typedefPattern)) {
    declarations.push(match[0]);
  }

  // Extract struct/class forward declarations and definitions (just the signature + members)
  const classPattern =
    /(?:struct|class)\s+\w+(?:\s*:\s*(?:public|protected|private)\s+\w+(?:\s*,\s*(?:public|protected|private)\s+\w+)*)?\s*\{[^}]*\}/gs;
  for (const match of source.matchAll(classPattern)) {
    declarations.push(match[0]);
  }

  // Extract #define constants
  const definePattern = /^#define\s+\w+\s+.+$/gm;
  for (const match of source.matchAll(definePattern)) {
    declarations.push(match[0]);
  }

  return declarations.join('\n\n');
}

/**
 * Try to find and read the header file corresponding to a .cpp file.
 */
async function findHeaderFile(
  cppPath: string,
  repoRoot: string,
): Promise<string | null> {
  // Try .h in same directory
  const baseName = path.basename(cppPath, path.extname(cppPath));
  const dir = path.dirname(cppPath);

  const candidates = [
    path.join(dir, `${baseName}.h`),
    path.join(dir, `${baseName}.hpp`),
    // Also check Include directories (common in Generals source)
    cppPath.replace('/Source/', '/Include/').replace('.cpp', '.h'),
  ];

  for (const candidate of candidates) {
    try {
      return await fs.readFile(candidate, 'utf8');
    } catch {
      // Not found, try next
    }
  }

  return null;
}

/**
 * Resolve include paths relative to the Generals source tree.
 */
async function resolveInclude(
  includePath: string,
  repoRoot: string,
): Promise<string | null> {
  // Common include directories in the Generals source
  const searchDirs = [
    'Generals/Code/GameEngine/Include',
    'Generals/Code/GameEngine/Include/Common',
    'Generals/Code/GameEngine/Include/GameLogic',
    'Generals/Code/GameEngine/Include/GameClient',
    'GeneralsMD/Code/GameEngine/Include',
  ];

  for (const searchDir of searchDirs) {
    const fullPath = path.join(repoRoot, searchDir, includePath);
    try {
      return await fs.readFile(fullPath, 'utf8');
    } catch {
      // Not found, try next
    }
  }

  return null;
}

/**
 * Build complete translation context for a C++ source file.
 */
export async function buildTranslationContext(
  sourcePath: string,
  repoRoot: string,
  functionName?: string,
  contextPaths?: string[],
  depPaths?: string[],
): Promise<TranslationContext> {
  const absoluteSource = path.isAbsolute(sourcePath)
    ? sourcePath
    : path.join(repoRoot, sourcePath);

  const cppSource = await fs.readFile(absoluteSource, 'utf8');

  // Extract the specific function if requested
  const functionSource = functionName
    ? extractFunction(cppSource, functionName)
    : null;

  // Build type context from the corresponding header and includes
  const typeContextParts: string[] = [];

  // Try to find the header for this .cpp file
  const headerSource = await findHeaderFile(absoluteSource, repoRoot);
  if (headerSource) {
    typeContextParts.push(
      `// === Header for ${path.basename(absoluteSource)} ===\n${headerSource}`,
    );
  }

  // Resolve key includes for type context
  const includes = extractIncludes(cppSource);
  for (const inc of includes.slice(0, 10)) {
    // Limit to 10 includes to avoid huge context
    const content = await resolveInclude(inc, repoRoot);
    if (content) {
      const types = extractTypeDeclarations(content);
      if (types.length > 0) {
        typeContextParts.push(`// === From ${inc} ===\n${types}`);
      }
    }
  }

  // Read additional context files if provided
  if (contextPaths) {
    for (const ctxPath of contextPaths) {
      try {
        const absPath = path.isAbsolute(ctxPath)
          ? ctxPath
          : path.join(repoRoot, ctxPath);
        const content = await fs.readFile(absPath, 'utf8');
        typeContextParts.push(
          `// === Context: ${path.basename(ctxPath)} ===\n${content}`,
        );
      } catch {
        // Skip missing context files
      }
    }
  }

  // Read already-translated TS dependencies
  const depParts: string[] = [];
  if (depPaths) {
    for (const depPath of depPaths) {
      try {
        const absPath = path.isAbsolute(depPath)
          ? depPath
          : path.join(repoRoot, depPath);
        const content = await fs.readFile(absPath, 'utf8');
        depParts.push(
          `// === Dependency: ${path.basename(depPath)} ===\n${content}`,
        );
      } catch {
        // Skip missing dependency files
      }
    }
  }

  return {
    cppSource,
    sourcePath: absoluteSource,
    functionName: functionName ?? null,
    functionSource,
    typeContext: typeContextParts.join('\n\n'),
    dependencies: depParts.join('\n\n'),
  };
}
