/**
 * Source parity comment parser — extracts C++ origin mappings from TypeScript files.
 *
 * Handles three formats found in the codebase:
 *
 * 1. File-level header:
 *    /**
 *     * Source parity:
 *     *   Generals/Code/GameEngine/Source/GameLogic/Object/ExperienceTracker.cpp
 *     *   Generals/Code/GameEngine/Source/GameLogic/Object/Body/ActiveBody.cpp (lines 1126-1159)
 *     * /
 *
 * 2. Inline comments:
 *    // Source parity: ActiveBody.cpp lines 1139-1159
 *    // Source parity: GlobalData.cpp:940 — all default to 1.0
 *    // Source parity (ZH): AIStates.cpp:5547-5551 — chooseWeapon()
 *
 * 3. JSDoc comments:
 *    /** Source parity: ThingTemplate.h:689 — m_skillPointValues[LEVEL_COUNT]. * /
 */

export interface SourceParityRef {
  /** Full path like "Generals/Code/GameEngine/Source/Common/RTS/Money.cpp" */
  fullPath: string | null;
  /** Short filename like "Money.cpp" */
  fileName: string;
  /** Start line in C++ source (or null if not specified) */
  startLine: number | null;
  /** End line in C++ source (or null if not specified) */
  endLine: number | null;
  /** Description/note from the comment */
  description: string;
  /** Line in the TS file where this reference appears */
  tsLine: number;
  /** Whether this is a file-level header reference (vs inline) */
  isFileHeader: boolean;
}

export interface SourceParityMap {
  /** The TS file path */
  tsFilePath: string;
  /** All file-level C++ origins (from the header block) */
  fileOrigins: SourceParityRef[];
  /** All inline source parity references */
  inlineRefs: SourceParityRef[];
  /** Unique C++ file paths referenced (full paths where available, short names otherwise) */
  uniqueCppFiles: string[];
}

/**
 * Parse all source parity comments from a TypeScript file.
 */
export function parseSourceParityComments(
  tsSource: string,
  tsFilePath: string,
): SourceParityMap {
  const fileOrigins: SourceParityRef[] = [];
  const inlineRefs: SourceParityRef[] = [];
  const lines = tsSource.split('\n');

  // Phase 1: Extract file-level header block
  // Look for: * Source parity:\n *   path1\n *   path2
  let inHeaderBlock = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();

    // Detect start of header block
    if (/^\*\s+Source parity:\s*$/.test(trimmed) || /^\/\*\*?\s*Source parity:\s*$/.test(trimmed)) {
      inHeaderBlock = true;
      continue;
    }

    if (inHeaderBlock) {
      // Check for continuation lines: *   Generals/Code/... or *   filename.cpp
      const pathMatch = trimmed.match(/^\*\s+(\S.*)/);
      if (pathMatch) {
        const content = pathMatch[1]!.replace(/\*\/\s*$/, '').trim();
        if (content.length > 0 && !content.startsWith('*')) {
          const ref = parsePathRef(content, i + 1, true);
          if (ref) fileOrigins.push(ref);
        }
      }
      // End of block comment
      if (trimmed.includes('*/') || trimmed === '*/' || trimmed === '') {
        if (trimmed === '' && inHeaderBlock) continue; // Allow blank lines in header
        inHeaderBlock = false;
      }
      continue;
    }

    // Phase 2: Inline source parity comments
    // Match: // Source parity: ... or // Source parity (ZH): ... or /** Source parity: ... */
    const inlineMatch = line.match(
      /(?:\/\/|\/\*\*?\s*|\*\s+)\s*Source parity(?:\s*\(ZH\))?\s*:\s*(.+)/,
    );
    if (inlineMatch) {
      const content = inlineMatch[1]!.replace(/\*\/\s*$/, '').trim();
      const ref = parsePathRef(content, i + 1, false);
      if (ref) inlineRefs.push(ref);
    }
  }

  // Build unique C++ file list
  const fileSet = new Set<string>();
  for (const ref of [...fileOrigins, ...inlineRefs]) {
    fileSet.add(ref.fullPath ?? ref.fileName);
  }

  return {
    tsFilePath,
    fileOrigins,
    inlineRefs,
    uniqueCppFiles: [...fileSet],
  };
}

/**
 * Parse a single source parity path reference.
 *
 * Formats:
 *   "Generals/Code/GameEngine/Source/Common/RTS/Money.cpp"
 *   "ActiveBody.cpp (lines 1126-1159)"
 *   "GlobalData.cpp:940 — all default to 1.0"
 *   "ThingTemplate.cpp:1392-1399 — getSkillPointValue"
 *   "WeaponSet.cpp line 550 — cannot attack targets"
 *   "DockUpdate base — number of docking slots"
 */
function parsePathRef(
  content: string,
  tsLine: number,
  isFileHeader: boolean,
): SourceParityRef | null {
  let fullPath: string | null = null;
  let fileName = '';
  let startLine: number | null = null;
  let endLine: number | null = null;
  let description = '';

  // Split on " — " or " -- " to separate path from description
  const dashSplit = content.split(/\s+[—–-]{1,2}\s+/);
  const pathPart = dashSplit[0]!.trim();
  description = dashSplit.slice(1).join(' — ').trim();

  // Try to extract a full path (contains / and ends with .cpp, .h, .hpp)
  const fullPathMatch = pathPart.match(
    /((?:Generals(?:MD)?\/)?Code\/[^\s()]+\.(?:cpp|h|hpp))/i,
  );
  if (fullPathMatch) {
    fullPath = fullPathMatch[1]!;
    fileName = fullPath.split('/').pop()!;
  }

  // Try to extract just a filename
  if (!fileName) {
    const fileMatch = pathPart.match(/(\w+\.(?:cpp|h|hpp))/i);
    if (fileMatch) {
      fileName = fileMatch[1]!;
    }
  }

  // If no file found, this might be a conceptual reference (e.g., "DockUpdate base")
  if (!fileName) {
    return {
      fullPath: null,
      fileName: pathPart.split(/\s/)[0]!,
      startLine: null,
      endLine: null,
      description: content,
      tsLine,
      isFileHeader,
    };
  }

  // Extract line numbers
  // Format: filename.cpp:940 or filename.cpp:1392-1399
  const colonLineMatch = pathPart.match(/\.(?:cpp|h|hpp):(\d+)(?:-(\d+))?/i);
  if (colonLineMatch) {
    startLine = parseInt(colonLineMatch[1]!, 10);
    endLine = colonLineMatch[2] ? parseInt(colonLineMatch[2], 10) : startLine;
  }

  // Format: filename.cpp (lines 1126-1159) or filename.cpp lines 1126-1159
  const linesMatch = pathPart.match(
    /\(?lines?\s+(\d+)(?:\s*-\s*(\d+))?\)?/i,
  );
  if (linesMatch) {
    startLine = parseInt(linesMatch[1]!, 10);
    endLine = linesMatch[2] ? parseInt(linesMatch[2], 10) : startLine;
  }

  // Format: "filename.cpp line 550"
  const singleLineMatch = pathPart.match(/line\s+(\d+)/i);
  if (singleLineMatch && startLine === null) {
    startLine = parseInt(singleLineMatch[1]!, 10);
    endLine = startLine;
  }

  return {
    fullPath,
    fileName,
    startLine,
    endLine,
    description,
    tsLine,
    isFileHeader,
  };
}

/**
 * Resolve a short C++ filename to a full path by searching the repo.
 * Returns all matching paths (there may be duplicates across Generals/GeneralsMD).
 */
export function resolveShortFileName(
  fileName: string,
  knownPaths: string[],
): string[] {
  return knownPaths.filter((p) => p.endsWith(`/${fileName}`) || p === fileName);
}

/**
 * Group inline references by the nearest preceding function/export declaration.
 * This lets us map TS functions to their C++ origins.
 */
export function groupRefsByFunction(
  tsSource: string,
  refs: SourceParityRef[],
): Map<string, SourceParityRef[]> {
  const lines = tsSource.split('\n');
  const groups = new Map<string, SourceParityRef[]>();

  // Find all function/export declarations with their line numbers
  const functions: { name: string; line: number }[] = [];
  const funcPattern =
    /^export\s+(?:function|const|class|interface|type|enum)\s+(\w+)|^(?:export\s+)?(?:async\s+)?function\s+(\w+)|^\s+(?:async\s+)?(\w+)\s*\(/;

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i]!.match(funcPattern);
    if (match) {
      const name = match[1] ?? match[2] ?? match[3] ?? '';
      if (name) functions.push({ name, line: i + 1 });
    }
  }

  // Assign each ref to the nearest preceding function
  for (const ref of refs) {
    let nearestFunc = '(file-level)';
    for (const func of functions) {
      if (func.line <= ref.tsLine) {
        nearestFunc = func.name;
      } else {
        break;
      }
    }
    if (!groups.has(nearestFunc)) {
      groups.set(nearestFunc, []);
    }
    groups.get(nearestFunc)!.push(ref);
  }

  return groups;
}
