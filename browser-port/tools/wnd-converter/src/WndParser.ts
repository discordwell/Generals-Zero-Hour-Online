/**
 * WND (Window Definition) parser for C&C Generals UI layouts.
 *
 * Text format with structured blocks:
 *   FILE_VERSION = 2;
 *   STARTLAYOUTBLOCK .. ENDLAYOUTBLOCK
 *   WINDOW .. END (with nested CHILD WINDOW .. END)
 *
 * C++ ref: GeneralsMD/Code/GameEngine/Source/GameClient/GUI/GameWindowManagerScript.cpp
 */

export interface WndColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface WndRect {
  upperLeft: { x: number; y: number };
  bottomRight: { x: number; y: number };
  creationResolution: { w: number; h: number };
}

export interface WndDrawDataItem {
  image: string;
  color: WndColor;
  borderColor: WndColor;
}

export interface WndFont {
  name: string;
  size: number;
  bold: boolean;
}

export interface WndTextColor {
  enabled: WndColor;
  enabledBorder: WndColor;
  disabled: WndColor;
  disabledBorder: WndColor;
  hilite: WndColor;
  hiliteBorder: WndColor;
}

export interface WndLayout {
  init: string;
  update: string;
  shutdown: string;
}

export interface WndWindow {
  windowType: string;
  screenRect: WndRect;
  name: string;
  status: string[];
  style: string[];
  systemCallback: string;
  inputCallback: string;
  tooltipCallback: string;
  drawCallback: string;
  font: WndFont;
  headerTemplate: string;
  tooltipDelay: number;
  tooltipText?: string;
  text?: string;
  textColor: WndTextColor;
  enabledDrawData: WndDrawDataItem[];
  disabledDrawData: WndDrawDataItem[];
  hiliteDrawData: WndDrawDataItem[];
  children: WndWindow[];
  // Gadget-specific fields
  listboxData?: Record<string, unknown>;
  comboboxData?: Record<string, unknown>;
  sliderData?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface WndFile {
  fileVersion: number;
  layout: WndLayout;
  windows: WndWindow[];
}

// ---------------------------------------------------------------------------
// Tokenizer / line-level parsing
// ---------------------------------------------------------------------------

function stripComments(line: string): string {
  // Remove // comments (but not inside quotes)
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') inQuote = !inQuote;
    if (!inQuote && line[i] === '/' && line[i + 1] === '/') {
      return line.slice(0, i);
    }
  }
  return line;
}

function parseColor(text: string): WndColor {
  const nums = text.trim().split(/\s+/).map(Number);
  return { r: nums[0] ?? 0, g: nums[1] ?? 0, b: nums[2] ?? 0, a: nums[3] ?? 255 };
}

function parseRect(lines: string[]): WndRect {
  const combined = lines.join(' ');
  const ulMatch = combined.match(/UPPERLEFT:\s*(\d+)\s+(\d+)/i);
  const brMatch = combined.match(/BOTTOMRIGHT:\s*(\d+)\s+(\d+)/i);
  const crMatch = combined.match(/CREATIONRESOLUTION:\s*(\d+)\s+(\d+)/i);

  return {
    upperLeft: { x: Number(ulMatch?.[1] ?? 0), y: Number(ulMatch?.[2] ?? 0) },
    bottomRight: { x: Number(brMatch?.[1] ?? 0), y: Number(brMatch?.[2] ?? 0) },
    creationResolution: { w: Number(crMatch?.[1] ?? 800), h: Number(crMatch?.[2] ?? 600) },
  };
}

function parseFont(text: string): WndFont {
  const nameMatch = text.match(/NAME:\s*"([^"]*)"/i);
  const sizeMatch = text.match(/SIZE:\s*(\d+)/i);
  const boldMatch = text.match(/BOLD:\s*(\d+)/i);
  return {
    name: nameMatch?.[1] ?? 'Arial',
    size: Number(sizeMatch?.[1] ?? 12),
    bold: boldMatch?.[1] === '1',
  };
}

function parseTextColor(lines: string[]): WndTextColor {
  const combined = lines.join(' ');
  const colorPattern = /(\w+):\s*(\d+\s+\d+\s+\d+\s+\d+)/gi;
  const colors: Record<string, WndColor> = {};
  let match: RegExpExecArray | null;

  while ((match = colorPattern.exec(combined)) !== null) {
    colors[match[1]!.toUpperCase()] = parseColor(match[2]!);
  }

  return {
    enabled: colors['ENABLED'] ?? { r: 255, g: 255, b: 255, a: 0 },
    enabledBorder: colors['ENABLEDBORDER'] ?? { r: 255, g: 255, b: 255, a: 0 },
    disabled: colors['DISABLED'] ?? { r: 255, g: 255, b: 255, a: 0 },
    disabledBorder: colors['DISABLEDBORDER'] ?? { r: 255, g: 255, b: 255, a: 0 },
    hilite: colors['HILITE'] ?? { r: 255, g: 255, b: 255, a: 0 },
    hiliteBorder: colors['HILITEBORDER'] ?? { r: 255, g: 255, b: 255, a: 0 },
  };
}

function parseDrawData(lines: string[]): WndDrawDataItem[] {
  const combined = lines.join(' ');
  const items: WndDrawDataItem[] = [];
  // Each draw data item: IMAGE: <name>, COLOR: r g b a, BORDERCOLOR: r g b a
  const pattern = /IMAGE:\s*(\S+),\s*COLOR:\s*(\d+\s+\d+\s+\d+\s+\d+),\s*BORDERCOLOR:\s*(\d+\s+\d+\s+\d+\s+\d+)/gi;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(combined)) !== null) {
    items.push({
      image: match[1]!,
      color: parseColor(match[2]!),
      borderColor: parseColor(match[3]!),
    });
  }
  return items;
}

function unquote(val: string): string {
  const trimmed = val.trim().replace(/;$/, '').trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseStatusList(val: string): string[] {
  return val.trim().replace(/;$/, '').trim().split(/\s*\+\s*/);
}

// ---------------------------------------------------------------------------
// Main parser
// ---------------------------------------------------------------------------

export function parseWnd(content: string): WndFile {
  const rawLines = content.split(/\r?\n/);
  const lines = rawLines.map((l) => stripComments(l).trimEnd());

  let pos = 0;
  let fileVersion = 2;

  function currentLine(): string {
    return lines[pos] ?? '';
  }

  function advance(): string {
    return lines[pos++] ?? '';
  }

  function peekTrimmed(): string {
    return (lines[pos] ?? '').trim();
  }

  // Collect multi-line values (lines ending with ,)
  function collectMultilineValue(firstLine: string): string[] {
    const collected = [firstLine];
    while (pos < lines.length) {
      const trimmed = collected[collected.length - 1]!.trim();
      if (!trimmed.endsWith(',')) break;
      collected.push(advance());
    }
    return collected;
  }

  // Parse FILE_VERSION
  const versionLine = advance().trim();
  const versionMatch = versionLine.match(/FILE_VERSION\s*=\s*(\d+)/i);
  if (versionMatch) {
    fileVersion = Number(versionMatch[1]);
  }

  // Parse layout block
  let layout: WndLayout = { init: '[None]', update: '[None]', shutdown: '[None]' };

  if (peekTrimmed().toUpperCase() === 'STARTLAYOUTBLOCK') {
    advance();
    while (pos < lines.length) {
      const line = advance().trim();
      if (line.toUpperCase() === 'ENDLAYOUTBLOCK') break;
      const eqIdx = line.indexOf('=');
      if (eqIdx < 0) continue;
      const key = line.slice(0, eqIdx).trim().toUpperCase();
      const val = unquote(line.slice(eqIdx + 1));
      if (key === 'LAYOUTINIT') layout.init = val;
      else if (key === 'LAYOUTUPDATE') layout.update = val;
      else if (key === 'LAYOUTSHUTDOWN') layout.shutdown = val;
    }
  }

  // Parse windows
  function parseWindow(): WndWindow {
    const win: WndWindow = {
      windowType: 'USER',
      screenRect: { upperLeft: { x: 0, y: 0 }, bottomRight: { x: 0, y: 0 }, creationResolution: { w: 800, h: 600 } },
      name: '',
      status: ['ENABLED'],
      style: ['USER'],
      systemCallback: '[None]',
      inputCallback: '[None]',
      tooltipCallback: '[None]',
      drawCallback: '[None]',
      font: { name: 'Arial', size: 12, bold: false },
      headerTemplate: '[NONE]',
      tooltipDelay: -1,
      textColor: {
        enabled: { r: 255, g: 255, b: 255, a: 0 },
        enabledBorder: { r: 255, g: 255, b: 255, a: 0 },
        disabled: { r: 255, g: 255, b: 255, a: 0 },
        disabledBorder: { r: 255, g: 255, b: 255, a: 0 },
        hilite: { r: 255, g: 255, b: 255, a: 0 },
        hiliteBorder: { r: 255, g: 255, b: 255, a: 0 },
      },
      enabledDrawData: [],
      disabledDrawData: [],
      hiliteDrawData: [],
      children: [],
    };

    while (pos < lines.length) {
      const line = advance();
      const trimmed = line.trim();
      const upper = trimmed.toUpperCase();

      if (upper === 'END' || upper === 'END;') break;

      if (upper === 'CHILD') {
        // Next line should be WINDOW
        if (peekTrimmed().toUpperCase() === 'WINDOW') {
          advance(); // consume WINDOW
          win.children.push(parseWindow());
        }
        continue;
      }

      if (upper === 'WINDOW') {
        // Nested window without CHILD prefix (shouldn't happen but handle gracefully)
        win.children.push(parseWindow());
        continue;
      }

      const eqIdx = trimmed.indexOf('=');
      if (eqIdx < 0) continue;

      const key = trimmed.slice(0, eqIdx).trim().toUpperCase();
      const rawVal = trimmed.slice(eqIdx + 1);
      const allLines = collectMultilineValue(rawVal);

      switch (key) {
        case 'WINDOWTYPE':
          win.windowType = unquote(allLines[0]!);
          break;
        case 'SCREENRECT':
          win.screenRect = parseRect(allLines);
          break;
        case 'NAME':
          win.name = unquote(allLines[0]!);
          break;
        case 'STATUS':
          win.status = parseStatusList(allLines[0]!);
          break;
        case 'STYLE':
          win.style = parseStatusList(allLines[0]!);
          break;
        case 'SYSTEMCALLBACK':
          win.systemCallback = unquote(allLines[0]!);
          break;
        case 'INPUTCALLBACK':
          win.inputCallback = unquote(allLines[0]!);
          break;
        case 'TOOLTIPCALLBACK':
          win.tooltipCallback = unquote(allLines[0]!);
          break;
        case 'DRAWCALLBACK':
          win.drawCallback = unquote(allLines[0]!);
          break;
        case 'FONT':
          win.font = parseFont(allLines.join(' '));
          break;
        case 'HEADERTEMPLATE':
          win.headerTemplate = unquote(allLines[0]!);
          break;
        case 'TOOLTIPDELAY':
          win.tooltipDelay = parseInt(unquote(allLines[0]!), 10) || -1;
          break;
        case 'TOOLTIPTEXT':
          win.tooltipText = unquote(allLines[0]!);
          break;
        case 'TEXT':
          win.text = unquote(allLines[0]!);
          break;
        case 'TEXTCOLOR':
          win.textColor = parseTextColor(allLines);
          break;
        case 'ENABLEDDRAWDATA':
          win.enabledDrawData = parseDrawData(allLines);
          break;
        case 'DISABLEDDRAWDATA':
          win.disabledDrawData = parseDrawData(allLines);
          break;
        case 'HILITEDRAWDATA':
          win.hiliteDrawData = parseDrawData(allLines);
          break;
        default:
          // Store other properties as-is (gadget-specific data, etc.)
          if (allLines.length === 1) {
            win[key.toLowerCase()] = unquote(allLines[0]!);
          } else {
            win[key.toLowerCase()] = allLines.map((l) => l.trim()).join(' ');
          }
          break;
      }
    }

    return win;
  }

  const windows: WndWindow[] = [];
  while (pos < lines.length) {
    const trimmed = peekTrimmed();
    if (trimmed.toUpperCase() === 'WINDOW') {
      advance();
      windows.push(parseWindow());
    } else {
      advance();
    }
  }

  return { fileVersion, layout, windows };
}
