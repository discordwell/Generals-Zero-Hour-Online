// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { OptionsScreen, loadOptionsState, saveOptionsToStorage } from './options-screen.js';

describe('loadOptionsState', () => {
  it('returns defaults for empty preferences', () => {
    const state = loadOptionsState(new Map());
    expect(state).toEqual({
      musicVolume: 70,
      sfxVolume: 70,
      voiceVolume: 70,
      scrollSpeed: 50,
    });
  });

  it('parses stored preferences', () => {
    const prefs = new Map([
      ['MusicVolume', '40'],
      ['SFXVolume', '80'],
      ['VoiceVolume', '60'],
      ['ScrollSpeed', '25'],
    ]);
    const state = loadOptionsState(prefs);
    expect(state).toEqual({
      musicVolume: 40,
      sfxVolume: 80,
      voiceVolume: 60,
      scrollSpeed: 25,
    });
  });

  it('clamps values to 0-100', () => {
    const prefs = new Map([
      ['MusicVolume', '-10'],
      ['SFXVolume', '200'],
    ]);
    const state = loadOptionsState(prefs);
    expect(state.musicVolume).toBe(0);
    expect(state.sfxVolume).toBe(100);
  });

  it('handles non-numeric values gracefully', () => {
    const prefs = new Map([['MusicVolume', 'abc']]);
    const state = loadOptionsState(prefs);
    expect(state.musicVolume).toBe(70); // fallback
  });
});

describe('saveOptionsToStorage', () => {
  it('serializes options to key=value format', () => {
    const stored = new Map<string, string>();
    const mockStorage = {
      setItem: (key: string, value: string) => stored.set(key, value),
    };
    saveOptionsToStorage(
      { musicVolume: 50, sfxVolume: 80, voiceVolume: 60, scrollSpeed: 30 },
      mockStorage,
    );
    const text = stored.get('Options.ini')!;
    expect(text).toContain('MusicVolume = 50');
    expect(text).toContain('SFXVolume = 80');
    expect(text).toContain('VoiceVolume = 60');
    expect(text).toContain('ScrollSpeed = 30');
  });

  it('handles null storage without error', () => {
    expect(() => {
      saveOptionsToStorage(
        { musicVolume: 50, sfxVolume: 50, voiceVolume: 50, scrollSpeed: 50 },
        null,
      );
    }).not.toThrow();
  });
});

describe('OptionsScreen', () => {
  it('renders the source-backed options layout and resets live controls to defaults', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const onApply = (): void => undefined;
    const onClose = (): void => undefined;
    const screen = new OptionsScreen(root, { onApply, onClose }, {
      musicVolume: 10,
      sfxVolume: 20,
      voiceVolume: 30,
      scrollSpeed: 40,
    });

    screen.show();

    expect(root.querySelector('[data-ref="options-parent"]')?.getAttribute('data-source-rect')).toBe('120,12,541,585');
    expect(root.querySelector('[data-ref="options-panel"]')?.getAttribute('data-source-rect')).toBe('135,19,515,567');
    expect(root.querySelector('[data-ref="options-video-parent"]')?.getAttribute('data-source-rect')).toBe('151,69,236,202');
    expect(root.querySelector('[data-ref="options-audio-parent"]')?.getAttribute('data-source-rect')).toBe('391,69,244,202');
    expect(root.querySelector('[data-ref="options-scroll-parent"]')?.getAttribute('data-source-rect')).toBe('151,272,484,128');

    const musicInput = root.querySelector('[data-ref="music"]') as HTMLInputElement;
    const scrollInput = root.querySelector('[data-ref="scroll"]') as HTMLInputElement;
    musicInput.value = '85';
    musicInput.dispatchEvent(new Event('input', { bubbles: true }));
    scrollInput.value = '65';
    scrollInput.dispatchEvent(new Event('input', { bubbles: true }));

    expect(root.querySelector('[data-ref="music-val"]')?.textContent).toBe('85%');
    expect(root.querySelector('[data-ref="scroll-val"]')?.textContent).toBe('65%');

    (root.querySelector('[data-action="defaults"]') as HTMLButtonElement).click();

    expect((root.querySelector('[data-ref="music"]') as HTMLInputElement).value).toBe('70');
    expect((root.querySelector('[data-ref="sfx"]') as HTMLInputElement).value).toBe('70');
    expect((root.querySelector('[data-ref="voice"]') as HTMLInputElement).value).toBe('70');
    expect((root.querySelector('[data-ref="scroll"]') as HTMLInputElement).value).toBe('50');
    expect(root.querySelector('[data-ref="music-val"]')?.textContent).toBe('70%');
    expect(root.querySelector('[data-ref="scroll-val"]')?.textContent).toBe('50%');
  });

  it('applies the current state and hides the overlay', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const appliedStates: Array<Record<string, number>> = [];
    const screen = new OptionsScreen(root, {
      onApply: (state) => appliedStates.push(state),
      onClose: () => undefined,
    }, {
      musicVolume: 25,
      sfxVolume: 35,
      voiceVolume: 45,
      scrollSpeed: 55,
    });

    screen.show();
    const sfxInput = root.querySelector('[data-ref="sfx"]') as HTMLInputElement;
    sfxInput.value = '80';
    sfxInput.dispatchEvent(new Event('input', { bubbles: true }));

    (root.querySelector('[data-action="apply"]') as HTMLButtonElement).click();

    expect(appliedStates).toEqual([{
      musicVolume: 25,
      sfxVolume: 80,
      voiceVolume: 45,
      scrollSpeed: 55,
    }]);
    expect(screen.isVisible).toBe(false);
    expect(root.querySelector('.options-overlay')).toBeNull();
  });
});
