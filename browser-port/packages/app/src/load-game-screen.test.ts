// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { LoadGameScreen } from './load-game-screen.js';

describe('LoadGameScreen', () => {
  it('renders the retail save/load shell geometry and load-only button state', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);

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
      onLoadSave,
      onDeleteSave,
      onClose: () => undefined,
    });

    screen.show();
    await Promise.resolve();
    await Promise.resolve();

    expect(root.querySelector('[data-ref="load-game-panel"]')?.getAttribute('data-source-rect')).toBe('40,40,718,518');
    expect(root.querySelector('[data-ref="load-game-title"]')?.getAttribute('data-source-rect')).toBe('54,41,352,44');
    expect(root.querySelector('[data-ref="load-game-listbox"]')?.getAttribute('data-source-rect')).toBe('60,100,672,392');
    expect(root.querySelector('[data-action="save"]')?.getAttribute('data-source-rect')).toBe('60,508,156,32');
    expect(root.querySelector('[data-action="load"]')?.getAttribute('data-source-rect')).toBe('232,508,156,32');
    expect(root.querySelector('[data-action="delete"]')?.getAttribute('data-source-rect')).toBe('404,508,157,32');
    expect(root.querySelector('[data-action="back"]')?.getAttribute('data-source-rect')).toBe('576,508,156,32');

    expect((root.querySelector('[data-action="save"]') as HTMLButtonElement).disabled).toBe(true);
    expect((root.querySelector('[data-action="load"]') as HTMLButtonElement).disabled).toBe(false);
    expect((root.querySelector('[data-action="delete"]') as HTMLButtonElement).disabled).toBe(false);

    (root.querySelector('[data-action="load"]') as HTMLButtonElement).click();
    expect((root.querySelector('[data-ref="load-game-load-confirm"]') as HTMLElement).hidden).toBe(false);

    (root.querySelector('[data-action="confirm-load"]') as HTMLButtonElement).click();
    await Promise.resolve();
    expect(onLoadSave).toHaveBeenCalledWith('usa01-slot');

    (root.querySelector('[data-action="delete"]') as HTMLButtonElement).click();
    expect((root.querySelector('[data-ref="load-game-delete-confirm"]') as HTMLElement).hidden).toBe(false);

    (root.querySelector('[data-action="confirm-delete"]') as HTMLButtonElement).click();
    await Promise.resolve();
    await Promise.resolve();
    expect(onDeleteSave).toHaveBeenCalledWith('usa01-slot');
  });
});
