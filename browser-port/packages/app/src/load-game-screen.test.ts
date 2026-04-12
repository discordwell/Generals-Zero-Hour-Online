// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { LoadGameScreen } from './load-game-screen.js';

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('LoadGameScreen', () => {
  it('renders the retail save/load shell geometry and load-only button state', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);

    const onImportSave = vi.fn(async () => 'imported-slot');
    const onExportSave = vi.fn(async () => undefined);
    const onLoadSave = vi.fn(async () => undefined);
    const onDeleteSave = vi.fn(async () => undefined);
    const screen = new LoadGameScreen(root, {
      listSaves: async () => [{
        slotId: 'usa01-slot',
        description: 'USA Mission 1',
        mapName: 'Maps\\MD_USA01\\MD_USA01.map',
        timestamp: Date.parse('2026-04-02T18:00:00.000Z'),
        sizeBytes: 2048,
      }],
      onImportSave,
      onExportSave,
      onLoadSave,
      onDeleteSave,
      onClose: () => undefined,
    });

    screen.show();
    await flushPromises();

    expect(root.querySelector('[data-ref="load-game-panel"]')?.getAttribute('data-source-rect')).toBe('40,40,718,518');
    expect(root.querySelector('[data-ref="load-game-title"]')?.getAttribute('data-source-rect')).toBe('54,41,352,44');
    expect(root.querySelector('[data-action="import"]')?.getAttribute('data-browser-rect')).toBe('444,52,132,26');
    expect(root.querySelector('[data-action="export"]')?.getAttribute('data-browser-rect')).toBe('590,52,132,26');
    expect(root.querySelector('[data-ref="load-game-listbox"]')?.getAttribute('data-source-rect')).toBe('60,100,672,392');
    expect(root.querySelector('[data-action="save"]')?.getAttribute('data-source-rect')).toBe('60,508,156,32');
    expect(root.querySelector('[data-action="load"]')?.getAttribute('data-source-rect')).toBe('232,508,156,32');
    expect(root.querySelector('[data-action="delete"]')?.getAttribute('data-source-rect')).toBe('404,508,157,32');
    expect(root.querySelector('[data-action="back"]')?.getAttribute('data-source-rect')).toBe('576,508,156,32');

    expect((root.querySelector('[data-action="save"]') as HTMLButtonElement).disabled).toBe(true);
    expect((root.querySelector('[data-action="import"]') as HTMLButtonElement).disabled).toBe(false);
    expect((root.querySelector('[data-action="export"]') as HTMLButtonElement).disabled).toBe(false);
    expect((root.querySelector('[data-action="load"]') as HTMLButtonElement).disabled).toBe(false);
    expect((root.querySelector('[data-action="delete"]') as HTMLButtonElement).disabled).toBe(false);

    (root.querySelector('[data-action="export"]') as HTMLButtonElement).click();
    await flushPromises();
    expect(onExportSave).toHaveBeenCalledWith('usa01-slot');

    (root.querySelector('[data-action="load"]') as HTMLButtonElement).click();
    expect((root.querySelector('[data-ref="load-game-load-confirm"]') as HTMLElement).hidden).toBe(false);

    (root.querySelector('[data-action="confirm-load"]') as HTMLButtonElement).click();
    await flushPromises();
    expect(onLoadSave).toHaveBeenCalledWith('usa01-slot');

    (root.querySelector('[data-action="delete"]') as HTMLButtonElement).click();
    expect((root.querySelector('[data-ref="load-game-delete-confirm"]') as HTMLElement).hidden).toBe(false);

    (root.querySelector('[data-action="confirm-delete"]') as HTMLButtonElement).click();
    await flushPromises();
    expect(onDeleteSave).toHaveBeenCalledWith('usa01-slot');
  });

  it('imports a browser-selected save file and refreshes the list selection', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);

    const saves = [{
      slotId: 'old-slot',
      description: 'Old save',
      mapName: 'Maps\\MD_USA01\\MD_USA01.map',
      timestamp: Date.parse('2026-04-02T18:00:00.000Z'),
      sizeBytes: 2048,
    }];
    const importedFile = new File(['imported'], '00000042.sav', {
      type: 'application/octet-stream',
    });
    const onImportSave = vi.fn(async (file: File) => {
      saves.unshift({
        slotId: '00000042',
        description: file.name,
        mapName: 'Maps\\MD_USA02\\MD_USA02.map',
        timestamp: Date.parse('2026-04-03T18:00:00.000Z'),
        sizeBytes: file.size,
      });
      return '00000042';
    });
    const screen = new LoadGameScreen(root, {
      listSaves: async () => saves,
      onImportSave,
      onExportSave: async () => undefined,
      onLoadSave: async () => undefined,
      onDeleteSave: async () => undefined,
      onClose: () => undefined,
    });

    screen.show();
    await flushPromises();

    const importInput = root.querySelector<HTMLInputElement>('[data-ref="load-game-import-input"]');
    expect(importInput).not.toBeNull();
    Object.defineProperty(importInput, 'files', {
      value: [importedFile],
      configurable: true,
    });
    importInput!.dispatchEvent(new Event('change'));
    await flushPromises();
    await flushPromises();

    expect(onImportSave).toHaveBeenCalledWith(importedFile);
    expect(root.querySelector('[data-slot-id="00000042"]')?.classList.contains('selected')).toBe(true);
    expect(root.querySelector('[data-ref="load-game-transfer-status"]')?.textContent).toBe('Imported 00000042.sav');
  });

  it('displays the localized map label when a source save description is empty', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);

    const screen = new LoadGameScreen(root, {
      listSaves: async () => [{
        slotId: '00000046',
        description: '',
        mapName: 'MAP:DowntownAssault',
        timestamp: Date.parse('2026-04-02T18:00:00.000Z'),
        sizeBytes: 2048,
      }],
      onImportSave: async () => '00000046',
      onExportSave: async () => undefined,
      onLoadSave: async () => undefined,
      onDeleteSave: async () => undefined,
      onClose: () => undefined,
    });
    screen.setLocalizedStrings(new Map([
      ['MAP:DowntownAssault', 'Downtown Assault'],
    ]));

    screen.show();
    await flushPromises();

    expect(root.querySelector('[data-ref="load-game-listbox"]')?.textContent).toContain('Downtown Assault');
    expect(root.querySelector('[data-ref="load-game-listbox"]')?.textContent).not.toContain('00000046 |');
  });
});
