/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { SaveLoadMenu, type SaveLoadMenuCallbacks } from './save-load-menu.js';

function makeCallbacks(
  overrides: Partial<SaveLoadMenuCallbacks> = {},
): SaveLoadMenuCallbacks {
  return {
    onSave: vi.fn(async () => undefined),
    onLoad: vi.fn(async () => undefined),
    onDelete: vi.fn(async () => undefined),
    onDownload: vi.fn(async () => undefined),
    onUpload: vi.fn(async () => undefined),
    onClose: vi.fn(),
    listSaves: vi.fn(async () => []),
    ...overrides,
  };
}

async function flushAsyncClick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function getButton(text: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll('button'))
    .find((candidate) => candidate.textContent === text);
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Missing button "${text}".`);
  }
  return button;
}

describe('SaveLoadMenu', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('allocates new saves through the source-compatible slot callback', async () => {
    const callbacks = makeCallbacks({
      findNextSaveSlotId: vi.fn(async () => '00000000'),
    });
    const menu = new SaveLoadMenu(callbacks);

    await menu.show(document.body);
    const description = document.querySelector('input');
    if (!(description instanceof HTMLInputElement)) {
      throw new Error('Missing save description input.');
    }
    description.value = 'Source Save';

    getButton('Save').click();
    await flushAsyncClick();

    expect(callbacks.findNextSaveSlotId).toHaveBeenCalledOnce();
    expect(callbacks.onSave).toHaveBeenCalledWith('00000000', 'Source Save');
  });

  it('passes an empty filename for new saves when no allocator is provided', async () => {
    const callbacks = makeCallbacks();
    const menu = new SaveLoadMenu(callbacks);

    await menu.show(document.body);

    getButton('Save').click();
    await flushAsyncClick();

    expect(callbacks.onSave).toHaveBeenCalledWith('', 'Quick Save');
  });
});
