/**
 * STR (String File) parser for C&C Generals map mission strings.
 *
 * Text format:
 *   LABEL
 *   "text content that may span
 *   multiple lines until closing quote"
 *   END
 *
 * Comments start with //. Empty lines are skipped.
 *
 * C++ ref: GeneralsMD/Code/GameEngine/Source/GameClient/GameText.cpp:1031-1126
 */

export interface StrData {
  entries: Record<string, string>;
}

export function parseStr(content: string): StrData {
  const entries: Record<string, string> = {};
  const lines = content.split(/\r?\n/);
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!.trim();
    i++;

    // Skip empty lines and comments
    if (line.length === 0 || line.startsWith('//')) {
      continue;
    }

    // This line is a label
    const label = line;
    let text = '';
    let foundString = false;

    // Read until END
    while (i < lines.length) {
      const innerLine = lines[i]!;
      const trimmed = innerLine.trim();
      i++;

      if (trimmed.toUpperCase() === 'END') {
        break;
      }

      if (trimmed.startsWith('"')) {
        // Start of quoted string - collect until closing quote
        let fullText = innerLine;
        // Check if closing quote is on the same line (after the opening)
        const afterOpen = trimmed.slice(1);
        const closeIdx = afterOpen.lastIndexOf('"');
        if (closeIdx >= 0) {
          // Single-line string
          text = afterOpen.slice(0, closeIdx);
          foundString = true;
        } else {
          // Multi-line: read until we find a line ending with "
          while (i < lines.length) {
            const nextLine = lines[i]!;
            i++;
            fullText += '\n' + nextLine;
            const nextTrimmed = nextLine.trim();
            if (nextTrimmed.endsWith('"')) {
              break;
            }
          }
          // Extract text between first " and last "
          const firstQuote = fullText.indexOf('"');
          const lastQuote = fullText.lastIndexOf('"');
          if (firstQuote >= 0 && lastQuote > firstQuote) {
            text = fullText.slice(firstQuote + 1, lastQuote);
          }
          foundString = true;
        }
      }
    }

    if (foundString) {
      // Normalize \n escape sequences (the game uses literal \n in strings)
      text = text.replace(/\\n/g, '\n');
      entries[label] = text;
    }
  }

  return { entries };
}
