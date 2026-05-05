import { describe, expect, it } from 'vitest';

import { GameLoop } from './game-loop.js';
import type { GameLoopScheduler } from './game-loop.js';

class ManualScheduler implements GameLoopScheduler {
  private timestamp = 0;
  private nextHandle = 1;
  private readonly callbacks = new Map<number, (timestamp: number) => void>();

  now(): number {
    return this.timestamp;
  }

  requestAnimationFrame(callback: (timestamp: number) => void): number {
    const handle = this.nextHandle;
    this.nextHandle += 1;
    this.callbacks.set(handle, callback);
    return handle;
  }

  cancelAnimationFrame(handle: number): void {
    this.callbacks.delete(handle);
  }

  step(elapsedMs: number): void {
    this.timestamp += elapsedMs;
    const queuedCallbacks = Array.from(this.callbacks.entries());
    this.callbacks.clear();

    for (const [, callback] of queuedCallbacks) {
      callback(this.timestamp);
    }
  }

  getQueuedCallbackCount(): number {
    return this.callbacks.size;
  }
}

describe('GameLoop', () => {
  it('runs fixed simulation steps with render interpolation', () => {
    const scheduler = new ManualScheduler();
    const loop = new GameLoop(10, scheduler);

    const simulationFrames: number[] = [];
    const renderAlphas: number[] = [];

    loop.start({
      onSimulationStep: (frameNumber) => {
        simulationFrames.push(frameNumber);
      },
      onRender: (alpha) => {
        renderAlphas.push(alpha);
      },
    });

    expect(loop.isRunning()).toBe(true);
    expect(loop.getFrameNumber()).toBe(0);
    expect(scheduler.getQueuedCallbackCount()).toBe(1);

    scheduler.step(250);
    expect(simulationFrames).toEqual([0, 1]);
    expect(loop.getFrameNumber()).toBe(2);
    expect(renderAlphas.at(-1)).toBeCloseTo(0.5);

    scheduler.step(100);
    expect(simulationFrames).toEqual([0, 1, 2]);
    expect(loop.getFrameNumber()).toBe(3);
    expect(renderAlphas.at(-1)).toBeCloseTo(0.5);

    loop.stop();
    expect(loop.isRunning()).toBe(false);
    expect(scheduler.getQueuedCallbackCount()).toBe(0);
  });

  it('continues rendering even if onSimulationStep throws', () => {
    const scheduler = new ManualScheduler();
    const loop = new GameLoop(10, scheduler);

    let simCount = 0;
    let renderCount = 0;

    loop.start({
      onSimulationStep: () => {
        simCount += 1;
        throw new Error('simulation error');
      },
      onRender: () => {
        renderCount += 1;
      },
    });

    // Advance past one simulation step — should throw but still render.
    scheduler.step(200);
    expect(simCount).toBe(2);
    expect(renderCount).toBe(2); // one from start, one from this step
    expect(loop.isRunning()).toBe(true);

    loop.stop();
  });

  it('skips simulation updates while paused and resumes cleanly', () => {
    const scheduler = new ManualScheduler();
    const loop = new GameLoop(30, scheduler);

    const simulationFrames: number[] = [];
    let renderCount = 0;

    loop.start({
      onSimulationStep: (frameNumber) => {
        simulationFrames.push(frameNumber);
      },
      onRender: () => {
        renderCount += 1;
      },
    });

    loop.paused = true;
    scheduler.step(1000);
    expect(simulationFrames).toEqual([]);
    expect(loop.getFrameNumber()).toBe(0);

    loop.paused = false;
    scheduler.step(34);
    expect(simulationFrames).toEqual([0]);
    expect(loop.getFrameNumber()).toBe(1);
    expect(renderCount).toBeGreaterThan(0);
  });

  it('manually steps exact simulation frames while paused', () => {
    const scheduler = new ManualScheduler();
    const loop = new GameLoop(30, scheduler);

    const simulationFrames: number[] = [];
    const renderAlphas: number[] = [];

    loop.start({
      onSimulationStep: (frameNumber) => {
        simulationFrames.push(frameNumber);
      },
      onRender: (alpha) => {
        renderAlphas.push(alpha);
      },
    });

    loop.paused = true;
    loop.stepSimulationFrames(3);

    expect(simulationFrames).toEqual([0, 1, 2]);
    expect(loop.getFrameNumber()).toBe(3);
    expect(renderAlphas.at(-1)).toBe(0);

    scheduler.step(1000);
    expect(simulationFrames).toEqual([0, 1, 2]);
    expect(loop.getFrameNumber()).toBe(3);

    loop.stepSimulationFrames(2);
    expect(simulationFrames).toEqual([0, 1, 2, 3, 4]);
    expect(loop.getFrameNumber()).toBe(5);

    loop.stop();
  });

  it('runs simulation faster at 2x speed', () => {
    const scheduler = new ManualScheduler();
    // 10 FPS = 100ms per simulation step
    const loop = new GameLoop(10, scheduler);

    const simulationFrames: number[] = [];

    loop.start({
      onSimulationStep: (frameNumber) => {
        simulationFrames.push(frameNumber);
      },
      onRender: () => {},
    });

    // At 1x speed, 100ms elapsed = 1 simulation step
    scheduler.step(100);
    expect(simulationFrames).toEqual([0]);

    // Set 2x speed — 100ms wall time becomes 200ms effective = 2 steps
    loop.speed = 2;
    scheduler.step(100);
    expect(simulationFrames).toEqual([0, 1, 2]);

    loop.stop();
  });

  it('runs simulation slower at 0.5x speed', () => {
    const scheduler = new ManualScheduler();
    // 10 FPS = 100ms per simulation step
    const loop = new GameLoop(10, scheduler);

    const simulationFrames: number[] = [];

    loop.start({
      onSimulationStep: (frameNumber) => {
        simulationFrames.push(frameNumber);
      },
      onRender: () => {},
    });

    loop.speed = 0.5;

    // At 0.5x speed, 100ms wall time becomes 50ms effective = 0 steps (need 100ms)
    scheduler.step(100);
    expect(simulationFrames).toEqual([]);

    // Another 100ms wall time = 50ms more effective (total 100ms) = 1 step
    scheduler.step(100);
    expect(simulationFrames).toEqual([0]);

    loop.stop();
  });

  it('runs simulation at 4x speed', () => {
    const scheduler = new ManualScheduler();
    // 10 FPS = 100ms per simulation step
    const loop = new GameLoop(10, scheduler);

    const simulationFrames: number[] = [];

    loop.start({
      onSimulationStep: (frameNumber) => {
        simulationFrames.push(frameNumber);
      },
      onRender: () => {},
    });

    loop.speed = 4;

    // At 4x speed, 100ms wall time becomes 400ms effective = 4 steps
    scheduler.step(100);
    expect(simulationFrames).toEqual([0, 1, 2, 3]);

    loop.stop();
  });

  it('defaults speed to 1 and paused to false', () => {
    const scheduler = new ManualScheduler();
    const loop = new GameLoop(30, scheduler);

    expect(loop.speed).toBe(1);
    expect(loop.paused).toBe(false);
  });
});
