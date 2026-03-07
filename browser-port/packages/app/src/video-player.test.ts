import { describe, it, expect } from 'vitest';
import { parseVideoIni } from './video-player.js';

const VIDEO_INI = `
; FILE: Video.ini
Video Sizzle
  Filename = sizzle_review
  Comment = This is the EA logo screen
End

Video EALogoMovie
  Filename = EA_LOGO
  Comment = This is the EA logo screen
End

Video MD_USA01
  Filename = MD_USA01_0
  Comment = campaign transition movie
End

Video GeneralsChallengeBackground
  Filename = GC_Background
  Comment = Plays in the background for GC loads
End

Video PortraitDrThraxLeft
  Filename = Comp_ThraxGen_000
  Comment = portrait transition for Generals Challenge load screen
End
`;

describe('parseVideoIni', () => {
  it('parses video entries from INI text', () => {
    const entries = parseVideoIni(VIDEO_INI);
    expect(entries.size).toBe(5);
  });

  it('maps internal name to filename', () => {
    const entries = parseVideoIni(VIDEO_INI);
    expect(entries.get('MD_USA01')!.filename).toBe('MD_USA01_0');
    expect(entries.get('Sizzle')!.filename).toBe('sizzle_review');
    expect(entries.get('EALogoMovie')!.filename).toBe('EA_LOGO');
  });

  it('preserves comments', () => {
    const entries = parseVideoIni(VIDEO_INI);
    expect(entries.get('GeneralsChallengeBackground')!.comment).toBe(
      'Plays in the background for GC loads',
    );
  });

  it('handles entries with no filename gracefully', () => {
    const ini = `
Video EmptyEntry
  Comment = no filename
End
`;
    const entries = parseVideoIni(ini);
    expect(entries.size).toBe(0);
  });
});
