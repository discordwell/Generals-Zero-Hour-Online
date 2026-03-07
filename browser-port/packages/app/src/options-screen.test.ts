import { describe, it, expect } from 'vitest';
import { loadOptionsState, saveOptionsToStorage } from './options-screen.js';

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
