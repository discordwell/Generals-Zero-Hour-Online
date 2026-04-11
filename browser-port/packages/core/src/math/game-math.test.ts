import { describe, it, expect } from 'vitest';
import { gameSin, gameCos, normalizeAngle, angleDifference, GameRandom, clamp, lerp, toRadians } from './game-math.js';

describe('gameSin / gameCos', () => {
  it('returns 0 for sin(0)', () => {
    expect(gameSin(0)).toBeCloseTo(0, 4);
  });

  it('returns 1 for sin(PI/2)', () => {
    expect(gameSin(Math.PI / 2)).toBeCloseTo(1, 3);
  });

  it('returns 0 for cos(PI/2)', () => {
    expect(gameCos(Math.PI / 2)).toBeCloseTo(0, 3);
  });

  it('returns 1 for cos(0)', () => {
    expect(gameCos(0)).toBeCloseTo(1, 3);
  });

  it('satisfies sin^2 + cos^2 = 1', () => {
    const angle = 1.234;
    const s = gameSin(angle);
    const c = gameCos(angle);
    expect(s * s + c * c).toBeCloseTo(1, 3);
  });

  it('handles negative angles', () => {
    expect(gameSin(-Math.PI / 2)).toBeCloseTo(-1, 3);
  });
});

describe('normalizeAngle', () => {
  it('normalizes positive angle', () => {
    expect(normalizeAngle(3 * Math.PI)).toBeCloseTo(Math.PI, 6);
  });

  it('normalizes negative angle', () => {
    const result = normalizeAngle(-Math.PI / 2);
    expect(result).toBeCloseTo(3 * Math.PI / 2, 6);
  });
});

describe('angleDifference', () => {
  it('returns 0 for same angle', () => {
    expect(angleDifference(1.0, 1.0)).toBeCloseTo(0, 6);
  });

  it('returns shortest path', () => {
    // From 350° to 10° should be +20°, not -340°
    const from = toRadians(350);
    const to = toRadians(10);
    const diff = angleDifference(from, to);
    expect(diff).toBeCloseTo(toRadians(20), 3);
  });
});

describe('GameRandom', () => {
  it('produces deterministic sequence', () => {
    const rng1 = new GameRandom(42);
    const rng2 = new GameRandom(42);
    for (let i = 0; i < 100; i++) {
      expect(rng1.nextInt()).toBe(rng2.nextInt());
    }
  });

  it('different seeds produce different sequences', () => {
    const rng1 = new GameRandom(1);
    const rng2 = new GameRandom(2);
    const seq1 = Array.from({ length: 10 }, () => rng1.nextInt());
    const seq2 = Array.from({ length: 10 }, () => rng2.nextInt());
    expect(seq1).not.toEqual(seq2);
  });

  it('matches the C++ RandomValue.cpp sequence for seed 1', () => {
    const rng = new GameRandom(1);
    expect(Array.from({ length: 10 }, () => rng.nextInt())).toEqual([
      1436176883,
      659466250,
      3894933528,
      1991661232,
      2132492519,
      3941128124,
      1359027079,
      1702176609,
      1768189074,
      2598104576,
    ]);
  });

  it('can restore the full six-word C++ random stream state', () => {
    const original = new GameRandom(1);
    original.nextInt();
    original.nextInt();
    const restored = new GameRandom(99);
    restored.setState(original.getState());
    expect(restored.nextInt()).toBe(original.nextInt());
    expect(restored.nextInt()).toBe(original.nextInt());
  });

  it('nextRange produces values in range', () => {
    const rng = new GameRandom(123);
    for (let i = 0; i < 1000; i++) {
      const val = rng.nextRange(5, 10);
      expect(val).toBeGreaterThanOrEqual(5);
      expect(val).toBeLessThanOrEqual(10);
    }
  });

  it('nextFloat produces values in [0, 1)', () => {
    const rng = new GameRandom(456);
    for (let i = 0; i < 1000; i++) {
      const val = rng.nextFloat();
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThanOrEqual(1);
    }
  });
});

describe('utility functions', () => {
  it('clamp works correctly', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(15, 0, 10)).toBe(10);
  });

  it('lerp interpolates correctly', () => {
    expect(lerp(0, 10, 0)).toBe(0);
    expect(lerp(0, 10, 1)).toBe(10);
    expect(lerp(0, 10, 0.5)).toBe(5);
  });
});
