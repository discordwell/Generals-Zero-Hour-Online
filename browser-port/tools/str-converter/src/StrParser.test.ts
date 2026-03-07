import { describe, it, expect } from 'vitest';
import { parseStr } from './StrParser.js';
import fs from 'node:fs';
import path from 'node:path';

describe('StrParser', () => {
  it('parses a simple STR file', () => {
    const input = `MAP:Objective1
"Destroy the base"
END

MAP:Objective2
"Capture the flag"
END
`;

    const result = parseStr(input);
    expect(Object.keys(result.entries)).toHaveLength(2);
    expect(result.entries['MAP:Objective1']).toBe('Destroy the base');
    expect(result.entries['MAP:Objective2']).toBe('Capture the flag');
  });

  it('handles \\n escape sequences', () => {
    const input = `MAP:Obj1
"Line one\\nLine two"
END
`;

    const result = parseStr(input);
    expect(result.entries['MAP:Obj1']).toBe('Line one\nLine two');
  });

  it('handles comments and empty lines', () => {
    const input = `// This is a comment

MAP:Label1
"Text"
END
`;

    const result = parseStr(input);
    expect(Object.keys(result.entries)).toHaveLength(1);
    expect(result.entries['MAP:Label1']).toBe('Text');
  });

  it('parses a real retail STR file', () => {
    const strPath = path.resolve(
      __dirname, '..', '..', '..', 'packages', 'app', 'public', 'assets',
      '_extracted', 'MapsZH', 'Maps', 'MD_USA01_CINE', 'map.str',
    );
    if (!fs.existsSync(strPath)) {
      return; // skip if no retail data
    }

    const content = fs.readFileSync(strPath, 'utf-8');
    const result = parseStr(content);
    expect(Object.keys(result.entries).length).toBeGreaterThan(0);
    // Known entry from the file
    expect(result.entries['MAP:MD_USA01Objective1']).toContain('Train Depot');
  });
});
