// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ReplayMenuScreen } from './replay-menu-screen.js';

describe('ReplayMenuScreen', () => {
  let root: HTMLDivElement;

  beforeEach(() => {
    root = document.createElement('div');
    document.body.appendChild(root);
  });

  afterEach(() => {
    root.remove();
    document.querySelectorAll('style').forEach((styleEl) => styleEl.remove());
  });

  it('renders the retail replay browser layout and enables actions when a replay is selected', async () => {
    const screen = new ReplayMenuScreen(root, {
      listReplays: async () => [{
        replayId: 'last-replay',
        description: 'Last Replay',
        mapPath: 'maps/Tournament Desert.json',
        version: 1,
        timestamp: Date.UTC(2026, 3, 2, 20, 15, 0),
        sizeBytes: 1024,
        totalFrames: 1800,
        playerCount: 2,
      }],
      onLoadReplay: async () => undefined,
      onDeleteReplay: async () => undefined,
      onCopyReplay: async () => undefined,
      onClose: () => undefined,
    });

    screen.show();
    await Promise.resolve();

    expect(root.querySelector('[data-ref="replay-menu-gadget-parent"]')?.getAttribute('data-source-rect')).toBe('42,42,717,517');
    expect(root.querySelector('[data-ref="replay-menu-panel"]')?.getAttribute('data-source-rect')).toBe('52,86,697,359');
    expect(root.querySelector('[data-ref="replay-menu-listbox"]')?.getAttribute('data-source-rect')).toBe('68,152,485,277');
    expect(root.querySelector('[data-action="load"]')?.getAttribute('data-source-rect')).toBe('563,153,173,37');
    expect(root.querySelector('[data-action="back"]')?.getAttribute('data-source-rect')).toBe('563,393,173,37');

    const row = root.querySelector<HTMLElement>('[data-replay-id="last-replay"]');
    expect(row).not.toBeNull();
    expect(row?.textContent).toContain('Last Replay');
    expect(row?.textContent).toContain('v1');
    expect(row?.textContent).toContain('Tournament Desert');
    expect((root.querySelector('[data-action="load"]') as HTMLButtonElement).disabled).toBe(false);
    expect((root.querySelector('[data-action="delete"]') as HTMLButtonElement).disabled).toBe(false);
    expect((root.querySelector('[data-action="copy"]') as HTMLButtonElement).disabled).toBe(false);
  });

  it('loads, deletes, copies, and closes through the provided callbacks', async () => {
    const onLoadReplay = vi.fn(async () => undefined);
    const onDeleteReplay = vi.fn(async () => undefined);
    const onCopyReplay = vi.fn(async () => undefined);
    const onClose = vi.fn();

    const screen = new ReplayMenuScreen(root, {
      listReplays: async () => [{
        replayId: 'md-usa01',
        description: 'MD_USA01 Replay',
        mapPath: 'maps/MD_USA01.json',
        version: 1,
        timestamp: Date.UTC(2026, 3, 2, 20, 15, 0),
        sizeBytes: 2048,
        totalFrames: 2700,
        playerCount: 2,
      }],
      onLoadReplay,
      onDeleteReplay,
      onCopyReplay,
      onClose,
    });

    screen.show();
    await Promise.resolve();

    (root.querySelector('[data-action="copy"]') as HTMLButtonElement).click();
    await Promise.resolve();
    expect(onCopyReplay).toHaveBeenCalledWith('md-usa01');

    (root.querySelector('[data-action="delete"]') as HTMLButtonElement).click();
    await Promise.resolve();
    expect(onDeleteReplay).toHaveBeenCalledWith('md-usa01');

    (root.querySelector('[data-replay-id="md-usa01"]') as HTMLElement).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await Promise.resolve();
    expect(onLoadReplay).toHaveBeenCalledWith('md-usa01');

    screen.hide();
    expect(onClose).toHaveBeenCalled();
    expect(screen.isVisible).toBe(false);
  });
});
