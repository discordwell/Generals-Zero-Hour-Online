/**
 * Deterministic math utilities — ported from GameMath / QuickTrig.
 *
 * The original engine uses lookup-table-based trig for deterministic
 * multiplayer. We replicate this to ensure lockstep sync across browsers.
 *
 * IMPORTANT: All game-logic code must use these functions instead of
 * Math.sin/cos/atan2 directly. Rendering code can use native Math.
 */

const SIN_TABLE_SIZE = 4096;
const sinTable = new Float64Array(SIN_TABLE_SIZE);
const TWO_PI = 2 * Math.PI;

// Pre-compute sine lookup table
for (let i = 0; i < SIN_TABLE_SIZE; i++) {
  sinTable[i] = Math.sin((i / SIN_TABLE_SIZE) * TWO_PI);
}

/** Normalize angle to [0, 2*PI). */
export function normalizeAngle(angle: number): number {
  angle = angle % TWO_PI;
  if (angle < 0) angle += TWO_PI;
  return angle;
}

/** Deterministic sine via lookup table with linear interpolation. */
export function gameSin(angle: number): number {
  angle = normalizeAngle(angle);
  const index = (angle / TWO_PI) * SIN_TABLE_SIZE;
  const i0 = Math.floor(index) % SIN_TABLE_SIZE;
  const i1 = (i0 + 1) % SIN_TABLE_SIZE;
  const frac = index - Math.floor(index);
  return sinTable[i0]! * (1 - frac) + sinTable[i1]! * frac;
}

/** Deterministic cosine via lookup table. */
export function gameCos(angle: number): number {
  return gameSin(angle + Math.PI / 2);
}

/** Deterministic atan2 approximation. */
export function gameAtan2(y: number, x: number): number {
  // Use native atan2 — it's deterministic within a single browser engine,
  // and for cross-browser multiplayer we validate via CRC checks.
  // If CRC mismatches occur, we can switch to a polynomial approximation.
  return Math.atan2(y, x);
}

/** Deterministic square root. */
export function gameSqrt(x: number): number {
  return Math.sqrt(x);
}

/** Fast inverse square root (for normalization). */
export function gameInvSqrt(x: number): number {
  return 1.0 / Math.sqrt(x);
}

/** Clamp value to range. */
export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Linear interpolation. */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Smooth step interpolation. */
export function smoothStep(a: number, b: number, t: number): number {
  t = clamp((t - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Convert degrees to radians. */
export function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

/** Convert radians to degrees. */
export function toDegrees(radians: number): number {
  return radians * (180 / Math.PI);
}

/**
 * Compute the shortest angular difference between two angles.
 * Result is in [-PI, PI].
 */
export function angleDifference(from: number, to: number): number {
  let diff = normalizeAngle(to - from);
  if (diff > Math.PI) diff -= TWO_PI;
  return diff;
}

const SOURCE_RANDOM_SEED_BASE = [
  0xf22d0e56,
  0x883126e9,
  0xc624dd2f,
  0x0702c49c,
  0x9e353f7d,
  0x6fdf3b64,
] as const;

/**
 * Integer-based random number generator (deterministic, seedable).
 *
 * Source parity: Common/RandomValue.cpp. Generals uses a six-word add-with-carry
 * generator for GameLogic/GameClient/GameAudio random streams, not the MSVC LCG.
 */
export class GameRandom {
  private baseSeed: number;
  private state: number[];

  constructor(seed: number = 1) {
    this.baseSeed = seed >>> 0;
    this.state = [...SOURCE_RANDOM_SEED_BASE];
    this.setSeed(seed);
  }

  /** Returns next pseudo-random unsigned 32-bit integer. */
  nextInt(): number {
    return this.randomValue();
  }

  /** Returns float [0, 1], matching GetGame*RandomValueReal scaling. */
  nextFloat(): number {
    return this.randomValue() / 0xffffffff;
  }

  /** Returns integer in [min, max] inclusive. */
  nextRange(min: number, max: number): number {
    const lo = Math.trunc(min);
    const hi = Math.trunc(max);
    const delta = (hi - lo + 1) >>> 0;
    if (delta === 0) {
      return hi;
    }
    return lo + (this.randomValue() % delta);
  }

  /** Returns the initial/base seed for replay metadata. */
  getSeed(): number {
    return this.baseSeed;
  }

  setSeed(seed: number): void {
    this.baseSeed = seed >>> 0;
    let ax = this.baseSeed;
    this.state = [];
    ax = (ax + SOURCE_RANDOM_SEED_BASE[0]) >>> 0;
    this.state[0] = ax;
    for (let index = 1; index < SOURCE_RANDOM_SEED_BASE.length; index += 1) {
      ax = (ax + (SOURCE_RANDOM_SEED_BASE[index]! - SOURCE_RANDOM_SEED_BASE[index - 1]!)) >>> 0;
      this.state[index] = ax;
    }
  }

  getState(): number[] {
    return [...this.state];
  }

  setState(state: readonly number[]): void {
    if (state.length !== SOURCE_RANDOM_SEED_BASE.length) {
      throw new Error(`GameRandom state must contain ${SOURCE_RANDOM_SEED_BASE.length} words.`);
    }
    this.state = state.map((value) => Math.trunc(value) >>> 0);
  }

  private randomValue(): number {
    let carry = 0;
    let ax = 0;
    const adc = (left: number, right: number): number => {
      const sum = (left + right + carry) >>> 0;
      carry = sum < left || sum < right ? 1 : 0;
      return sum;
    };

    ax = adc(this.state[5]!, this.state[4]!);
    this.state[4] = ax;
    ax = adc(ax, this.state[3]!);
    this.state[3] = ax;
    ax = adc(ax, this.state[2]!);
    this.state[2] = ax;
    ax = adc(ax, this.state[1]!);
    this.state[1] = ax;
    ax = adc(ax, this.state[0]!);
    this.state[0] = ax;

    this.state[5] = (this.state[5]! + 1) >>> 0;
    if (this.state[5] === 0) {
      this.state[4] = (this.state[4]! + 1) >>> 0;
      if (this.state[4] === 0) {
        this.state[3] = (this.state[3]! + 1) >>> 0;
        if (this.state[3] === 0) {
          this.state[2] = (this.state[2]! + 1) >>> 0;
          if (this.state[2] === 0) {
            this.state[1] = (this.state[1]! + 1) >>> 0;
            if (this.state[1] === 0) {
              this.state[0] = (this.state[0]! + 1) >>> 0;
              ax = (ax + 1) >>> 0;
            }
          }
        }
      }
    }

    return ax >>> 0;
  }
}
