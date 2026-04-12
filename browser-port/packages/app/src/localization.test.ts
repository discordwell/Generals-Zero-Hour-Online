import { describe, expect, it } from 'vitest';
import {
  buildLocalizationStrings,
  formatSourceText,
  resolveLocalizedText,
  type LocalizationData,
} from './localization.js';

describe('localization', () => {
  it('merges localization data sets without overwriting earlier entries', () => {
    const primary: LocalizationData = {
      version: 3,
      language: 0,
      entries: {
        'GUI:BioNameEntry_Pos8': { text: 'General Juhziz' },
        'OBJECT:Mazar': { text: 'Mazar' },
      },
    };
    const secondary: LocalizationData = {
      version: 3,
      language: 0,
      entries: {
        'GUI:BioNameEntry_Pos8': { text: 'Fallback Name' },
        'OBJECT:Ranger': { text: 'Ranger' },
      },
    };

    const localizedStrings = buildLocalizationStrings([primary, secondary]);

    expect(localizedStrings.get('GUI:BioNameEntry_Pos8')).toBe('General Juhziz');
    expect(localizedStrings.get('OBJECT:Ranger')).toBe('Ranger');
  });

  it('falls back to the raw token when a localized entry is missing', () => {
    const localizedStrings = buildLocalizationStrings([
      {
        version: 3,
        language: 0,
        entries: {
          'CAMPAIGN:USA': { text: 'USA' },
        },
      },
    ]);

    expect(resolveLocalizedText('CAMPAIGN:USA', localizedStrings)).toBe('USA');
    expect(resolveLocalizedText('MISSING:LABEL', localizedStrings)).toBe('MISSING:LABEL');
  });

  it('formats source-style localized text placeholders', () => {
    expect(formatSourceText('Mission Start - %s %d', ['USA', 2])).toBe('Mission Start - USA 2');
    expect(formatSourceText('Saved %% %d', [2.8])).toBe('Saved % 2');
    expect(formatSourceText('Missing %s %d', ['arg'])).toBe('Missing arg %d');
  });
});
