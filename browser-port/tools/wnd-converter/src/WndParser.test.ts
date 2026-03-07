import { describe, it, expect } from 'vitest';
import { parseWnd } from './WndParser.js';
import fs from 'node:fs';
import path from 'node:path';

describe('WndParser', () => {
  it('parses a minimal WND file', () => {
    const input = `FILE_VERSION = 2;
STARTLAYOUTBLOCK
  LAYOUTINIT = TestInit;
  LAYOUTUPDATE = [None];
  LAYOUTSHUTDOWN = [None];
ENDLAYOUTBLOCK
WINDOW
  WINDOWTYPE = USER;
  SCREENRECT = UPPERLEFT: 0 0,
               BOTTOMRIGHT: 800 600,
               CREATIONRESOLUTION: 800 600;
  NAME = "Test.wnd:MainWindow";
  STATUS = ENABLED;
  STYLE = USER;
  SYSTEMCALLBACK = "[None]";
  INPUTCALLBACK = "[None]";
  TOOLTIPCALLBACK = "[None]";
  DRAWCALLBACK = "[None]";
  FONT = NAME: "Arial", SIZE: 12, BOLD: 0;
  HEADERTEMPLATE = "[NONE]";
  TOOLTIPDELAY = -1;
  TEXTCOLOR = ENABLED:  255 255 255 0, ENABLEDBORDER:  255 255 255 0,
              DISABLED: 255 255 255 0, DISABLEDBORDER: 255 255 255 0,
              HILITE:   255 255 255 0, HILITEBORDER:   255 255 255 0;
  ENABLEDDRAWDATA = IMAGE: NoImage, COLOR: 0 0 0 255, BORDERCOLOR: 0 0 0 255;
  DISABLEDDRAWDATA = IMAGE: NoImage, COLOR: 0 0 0 255, BORDERCOLOR: 0 0 0 255;
  HILITEDRAWDATA = IMAGE: NoImage, COLOR: 0 0 0 255, BORDERCOLOR: 0 0 0 255;
END
`;

    const result = parseWnd(input);
    expect(result.fileVersion).toBe(2);
    expect(result.layout.init).toBe('TestInit');
    expect(result.windows).toHaveLength(1);
    expect(result.windows[0]!.name).toBe('Test.wnd:MainWindow');
    expect(result.windows[0]!.screenRect.bottomRight.x).toBe(800);
  });

  it('parses nested child windows', () => {
    const input = `FILE_VERSION = 2;
STARTLAYOUTBLOCK
  LAYOUTINIT = [None];
  LAYOUTUPDATE = [None];
  LAYOUTSHUTDOWN = [None];
ENDLAYOUTBLOCK
WINDOW
  WINDOWTYPE = USER;
  SCREENRECT = UPPERLEFT: 0 0, BOTTOMRIGHT: 800 600, CREATIONRESOLUTION: 800 600;
  NAME = "Parent";
  STATUS = ENABLED;
  STYLE = USER;
  SYSTEMCALLBACK = "[None]";
  INPUTCALLBACK = "[None]";
  TOOLTIPCALLBACK = "[None]";
  DRAWCALLBACK = "[None]";
  FONT = NAME: "Arial", SIZE: 12, BOLD: 0;
  HEADERTEMPLATE = "[NONE]";
  TOOLTIPDELAY = -1;
  TEXTCOLOR = ENABLED: 255 255 255 0, ENABLEDBORDER: 255 255 255 0, DISABLED: 255 255 255 0, DISABLEDBORDER: 255 255 255 0, HILITE: 255 255 255 0, HILITEBORDER: 255 255 255 0;
  ENABLEDDRAWDATA = IMAGE: NoImage, COLOR: 0 0 0 255, BORDERCOLOR: 0 0 0 255;
  DISABLEDDRAWDATA = IMAGE: NoImage, COLOR: 0 0 0 255, BORDERCOLOR: 0 0 0 255;
  HILITEDRAWDATA = IMAGE: NoImage, COLOR: 0 0 0 255, BORDERCOLOR: 0 0 0 255;
  CHILD
  WINDOW
    WINDOWTYPE = PUSHBUTTON;
    SCREENRECT = UPPERLEFT: 10 10, BOTTOMRIGHT: 100 40, CREATIONRESOLUTION: 800 600;
    NAME = "Child1";
    STATUS = ENABLED;
    STYLE = PUSHBUTTON;
    SYSTEMCALLBACK = "[None]";
    INPUTCALLBACK = "[None]";
    TOOLTIPCALLBACK = "[None]";
    DRAWCALLBACK = "[None]";
    FONT = NAME: "Arial", SIZE: 10, BOLD: 1;
    HEADERTEMPLATE = "[NONE]";
    TOOLTIPDELAY = -1;
    TEXTCOLOR = ENABLED: 255 255 255 0, ENABLEDBORDER: 255 255 255 0, DISABLED: 255 255 255 0, DISABLEDBORDER: 255 255 255 0, HILITE: 255 255 255 0, HILITEBORDER: 255 255 255 0;
    ENABLEDDRAWDATA = IMAGE: NoImage, COLOR: 0 0 0 255, BORDERCOLOR: 0 0 0 255;
    DISABLEDDRAWDATA = IMAGE: NoImage, COLOR: 0 0 0 255, BORDERCOLOR: 0 0 0 255;
    HILITEDRAWDATA = IMAGE: NoImage, COLOR: 0 0 0 255, BORDERCOLOR: 0 0 0 255;
  END
END
`;

    const result = parseWnd(input);
    expect(result.windows).toHaveLength(1);
    expect(result.windows[0]!.children).toHaveLength(1);
    expect(result.windows[0]!.children[0]!.windowType).toBe('PUSHBUTTON');
    expect(result.windows[0]!.children[0]!.name).toBe('Child1');
  });

  it('parses a real retail WND file', () => {
    const wndPath = path.resolve(
      __dirname, '..', '..', '..', 'packages', 'app', 'public', 'assets',
      '_extracted', 'WindowZH', 'Window', 'InGamePopupMessage.wnd',
    );
    if (!fs.existsSync(wndPath)) return;

    const content = fs.readFileSync(wndPath, 'utf-8');
    const result = parseWnd(content);
    expect(result.fileVersion).toBe(2);
    expect(result.windows.length).toBeGreaterThan(0);
    expect(result.windows[0]!.name).toContain('InGamePopupMessage');
  });
});
