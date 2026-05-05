/**
 * Fixed-timestep simulation loop.
 *
 * Source reference: Generals/Code/GameEngine/Include/Common/GameEngine.h
 * Source reference: Generals/Code/GameEngine/Source/Common/GameEngine.cpp
 */

export interface GameLoopCallbacks {
  onSimulationStep(frameNumber: number, dt: number): void;
  onRender(alpha: number): void;
}

export interface GameLoopScheduler {
  now(): number;
  requestAnimationFrame(callback: (timestamp: number) => void): number;
  cancelAnimationFrame(handle: number): void;
}

function resolveDefaultScheduler(): GameLoopScheduler {
  const raf = globalThis.requestAnimationFrame?.bind(globalThis);
  const caf = globalThis.cancelAnimationFrame?.bind(globalThis);
  if (!raf || !caf) {
    throw new Error('GameLoop requires requestAnimationFrame/cancelAnimationFrame');
  }

  const nowProvider =
    globalThis.performance?.now?.bind(globalThis.performance)
    ?? (() => Date.now());

  return {
    now: nowProvider,
    requestAnimationFrame: raf,
    cancelAnimationFrame: caf,
  };
}

export class GameLoop {
  readonly simulationDt: number;

  private frameNumber = 0;
  private accumulator = 0;
  private lastTimestamp = 0;
  private running = false;
  private rafId = 0;
  private callbacks: GameLoopCallbacks | null = null;
  private readonly scheduler: GameLoopScheduler;

  speed = 1.0;
  paused = false;

  constructor(simulationFps = 30, scheduler?: GameLoopScheduler) {
    this.simulationDt = 1000 / simulationFps;
    this.scheduler = scheduler ?? resolveDefaultScheduler();
  }

  start(callbacks: GameLoopCallbacks): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.callbacks = callbacks;
    this.lastTimestamp = this.scheduler.now();
    this.accumulator = 0;
    this.tick(this.lastTimestamp);
  }

  stop(): void {
    this.running = false;
    if (this.rafId !== 0) {
      this.scheduler.cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    this.callbacks = null;
  }

  reset(): void {
    this.frameNumber = 0;
    this.accumulator = 0;
    this.lastTimestamp = this.scheduler.now();
  }

  getFrameNumber(): number {
    return this.frameNumber;
  }

  isRunning(): boolean {
    return this.running;
  }

  stepSimulationFrames(frameCount = 1): void {
    if (!Number.isInteger(frameCount) || frameCount < 0) {
      throw new Error(`frameCount must be a non-negative integer, got ${frameCount}`);
    }
    if (frameCount === 0) {
      return;
    }
    const callbacks = this.callbacks;
    if (!callbacks) {
      return;
    }

    for (let index = 0; index < frameCount; index += 1) {
      try {
        callbacks.onSimulationStep(this.frameNumber, this.simulationDt / 1000);
      } catch (err) {
        console.error(`Game loop error on frame ${this.frameNumber}:`, err);
      }
      this.frameNumber += 1;
    }
    this.accumulator = 0;
    callbacks.onRender(0);
  }

  private readonly tick = (timestamp: number): void => {
    if (!this.running) {
      return;
    }

    this.rafId = this.scheduler.requestAnimationFrame(this.tick);

    let elapsed = timestamp - this.lastTimestamp;
    this.lastTimestamp = timestamp;

    // Prevent spiral-of-death after background tab pauses.
    if (elapsed > 250) {
      elapsed = 250;
    }

    elapsed *= this.speed;

    const callbacks = this.callbacks;
    if (!callbacks) {
      return;
    }

    if (!this.paused) {
      this.accumulator += elapsed;

      while (this.accumulator >= this.simulationDt) {
        try {
          callbacks.onSimulationStep(this.frameNumber, this.simulationDt / 1000);
        } catch (err) {
          console.error(`Game loop error on frame ${this.frameNumber}:`, err);
        }
        this.frameNumber += 1;
        this.accumulator -= this.simulationDt;
      }
    }

    const alpha = this.accumulator / this.simulationDt;
    callbacks.onRender(alpha);
  };
}
