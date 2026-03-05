import { describe, expect, it } from 'vitest';

import {
  resolveScriptRadarEntityBlipVisibility,
  resolveScriptRadarInteractionEnabled,
  resolveScriptRadarVisibility,
} from './script-radar-visibility.js';

describe('resolveScriptRadarVisibility', () => {
  it('hides radar when script has disabled radar and no force-enable is active', () => {
    expect(resolveScriptRadarVisibility(true, false)).toBe(false);
  });

  it('shows radar when script has not disabled radar', () => {
    expect(resolveScriptRadarVisibility(false, false)).toBe(true);
  });

  it('shows radar when forced even if script hide flag is set', () => {
    expect(resolveScriptRadarVisibility(true, true)).toBe(true);
  });
});

describe('resolveScriptRadarInteractionEnabled', () => {
  it('disables minimap interaction while script input lock is active', () => {
    expect(resolveScriptRadarInteractionEnabled(true, true)).toBe(false);
  });

  it('disables minimap interaction when radar is not visible', () => {
    expect(resolveScriptRadarInteractionEnabled(false, false)).toBe(false);
  });

  it('allows minimap interaction when radar is visible and input is enabled', () => {
    expect(resolveScriptRadarInteractionEnabled(true, false)).toBe(true);
  });
});

describe('resolveScriptRadarEntityBlipVisibility', () => {
  it('hides entity blips when draw-icon UI mode is disabled by script', () => {
    expect(resolveScriptRadarEntityBlipVisibility(true, false)).toBe(false);
  });

  it('hides entity blips when radar is hidden', () => {
    expect(resolveScriptRadarEntityBlipVisibility(false, true)).toBe(false);
  });

  it('shows entity blips when radar is visible and draw-icon UI is enabled', () => {
    expect(resolveScriptRadarEntityBlipVisibility(true, true)).toBe(true);
  });
});
