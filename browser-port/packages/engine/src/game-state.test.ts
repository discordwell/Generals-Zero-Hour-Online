import { describe, expect, it } from 'vitest';

import type { Snapshot } from './snapshot.js';
import type { Xfer } from './xfer.js';
import { XferMode } from './xfer.js';
import { GameState, SaveCode } from './game-state.js';

class SimpleSnapshot implements Snapshot {
  value = 0;
  crcCalled = false;
  xferCalled = false;
  postProcessCalled = false;

  crc(xfer: Xfer): void {
    this.crcCalled = true;
    xfer.xferInt(this.value);
  }

  xfer(xfer: Xfer): void {
    this.xferCalled = true;
    this.value = xfer.xferInt(this.value);
  }

  loadPostProcess(): void {
    this.postProcessCalled = true;
  }
}

class MultiFieldSnapshot implements Snapshot {
  name = '';
  health = 0;
  x = 0;
  y = 0;

  crc(xfer: Xfer): void {
    xfer.xferInt(this.health);
  }

  xfer(xfer: Xfer): void {
    this.name = xfer.xferAsciiString(this.name);
    this.health = xfer.xferInt(this.health);
    this.x = xfer.xferReal(this.x);
    this.y = xfer.xferReal(this.y);
  }

  loadPostProcess(): void {
    // Rebuild derived state
  }
}

describe('GameState', () => {
  it('round-trips a single snapshot block', () => {
    const saveState = new GameState();
    const saveSnap = new SimpleSnapshot();
    saveSnap.value = 42;
    saveState.addSnapshotBlock('CHUNK_Test', saveSnap);

    const { data } = saveState.saveGame('test save');

    const loadState = new GameState();
    const loadSnap = new SimpleSnapshot();
    loadState.addSnapshotBlock('CHUNK_Test', loadSnap);

    const result = loadState.loadGame(data);
    expect(result).toBe(SaveCode.SC_OK);
    expect(loadSnap.value).toBe(42);
    expect(loadSnap.postProcessCalled).toBe(true);
  });

  it('round-trips multiple snapshot blocks in order', () => {
    const saveState = new GameState();
    const snap1 = new MultiFieldSnapshot();
    snap1.name = 'Tank';
    snap1.health = 100;
    snap1.x = 10.5;
    snap1.y = 20.5;

    const snap2 = new MultiFieldSnapshot();
    snap2.name = 'Infantry';
    snap2.health = 50;
    snap2.x = -5.0;
    snap2.y = 15.0;

    saveState.addSnapshotBlock('CHUNK_A', snap1);
    saveState.addSnapshotBlock('CHUNK_B', snap2);
    const { data } = saveState.saveGame('multi block');

    const loadState = new GameState();
    const loadSnap1 = new MultiFieldSnapshot();
    const loadSnap2 = new MultiFieldSnapshot();
    loadState.addSnapshotBlock('CHUNK_A', loadSnap1);
    loadState.addSnapshotBlock('CHUNK_B', loadSnap2);

    loadState.loadGame(data);

    expect(loadSnap1.name).toBe('Tank');
    expect(loadSnap1.health).toBe(100);
    expect(loadSnap1.x).toBeCloseTo(10.5);
    expect(loadSnap1.y).toBeCloseTo(20.5);

    expect(loadSnap2.name).toBe('Infantry');
    expect(loadSnap2.health).toBe(50);
    expect(loadSnap2.x).toBeCloseTo(-5.0);
    expect(loadSnap2.y).toBeCloseTo(15.0);
  });

  it('skips unknown blocks during load (forward compatibility)', () => {
    // Save with blocks A, B, C
    const saveState = new GameState();
    const snapA = new SimpleSnapshot();
    snapA.value = 1;
    const snapB = new SimpleSnapshot();
    snapB.value = 2;
    const snapC = new SimpleSnapshot();
    snapC.value = 3;
    saveState.addSnapshotBlock('CHUNK_A', snapA);
    saveState.addSnapshotBlock('CHUNK_Unknown', snapB);
    saveState.addSnapshotBlock('CHUNK_C', snapC);
    const { data } = saveState.saveGame('skip test');

    // Load with only A and C registered (B is "unknown")
    const loadState = new GameState();
    const loadA = new SimpleSnapshot();
    const loadC = new SimpleSnapshot();
    loadState.addSnapshotBlock('CHUNK_A', loadA);
    loadState.addSnapshotBlock('CHUNK_C', loadC);

    const result = loadState.loadGame(data);
    expect(result).toBe(SaveCode.SC_OK);
    expect(loadA.value).toBe(1);
    expect(loadC.value).toBe(3);
  });

  it('calls loadPostProcess on all block snapshots', () => {
    const saveState = new GameState();
    const snap = new SimpleSnapshot();
    snap.value = 10;
    saveState.addSnapshotBlock('CHUNK_Test', snap);
    const { data } = saveState.saveGame('post process');

    const loadState = new GameState();
    const loadSnap = new SimpleSnapshot();
    loadState.addSnapshotBlock('CHUNK_Test', loadSnap);

    loadState.loadGame(data);
    expect(loadSnap.postProcessCalled).toBe(true);
  });

  it('calls loadPostProcess on additional registered snapshots', () => {
    const saveState = new GameState();
    const snap = new SimpleSnapshot();
    snap.value = 5;
    saveState.addSnapshotBlock('CHUNK_Test', snap);
    const { data } = saveState.saveGame('extra post process');

    const loadState = new GameState();
    const loadSnap = new SimpleSnapshot();
    loadState.addSnapshotBlock('CHUNK_Test', loadSnap);

    const extraSnap = new SimpleSnapshot();
    loadState.addPostProcessSnapshot(extraSnap);

    loadState.loadGame(data);
    expect(extraSnap.postProcessCalled).toBe(true);
  });

  it('computeCrc returns non-zero for non-empty state', () => {
    const state = new GameState();
    const snap = new SimpleSnapshot();
    snap.value = 999;
    state.addSnapshotBlock('CHUNK_Test', snap);

    const crc = state.computeCrc();
    expect(crc).not.toBe(0);
  });

  it('computeCrc is deterministic', () => {
    const state1 = new GameState();
    const snap1 = new SimpleSnapshot();
    snap1.value = 42;
    state1.addSnapshotBlock('CHUNK_Test', snap1);

    const state2 = new GameState();
    const snap2 = new SimpleSnapshot();
    snap2.value = 42;
    state2.addSnapshotBlock('CHUNK_Test', snap2);

    expect(state1.computeCrc()).toBe(state2.computeCrc());
  });

  it('different data produces different CRC', () => {
    const state1 = new GameState();
    const snap1 = new SimpleSnapshot();
    snap1.value = 42;
    state1.addSnapshotBlock('CHUNK_Test', snap1);

    const state2 = new GameState();
    const snap2 = new SimpleSnapshot();
    snap2.value = 99;
    state2.addSnapshotBlock('CHUNK_Test', snap2);

    expect(state1.computeCrc()).not.toBe(state2.computeCrc());
  });

  it('saveGame returns metadata', () => {
    const state = new GameState();
    const snap = new SimpleSnapshot();
    snap.value = 1;
    state.addSnapshotBlock('CHUNK_Test', snap);

    const { data, info } = state.saveGame('my description');
    expect(info.description).toBe('my description');
    expect(info.sizeBytes).toBe(data.byteLength);
    expect(info.timestamp).toBeGreaterThan(0);
  });

  it('block name matching is case-insensitive', () => {
    const saveState = new GameState();
    const snap = new SimpleSnapshot();
    snap.value = 77;
    saveState.addSnapshotBlock('CHUNK_Test', snap);
    const { data } = saveState.saveGame('case test');

    const loadState = new GameState();
    const loadSnap = new SimpleSnapshot();
    loadState.addSnapshotBlock('chunk_test', loadSnap);

    loadState.loadGame(data);
    expect(loadSnap.value).toBe(77);
  });

  it('getRegisteredBlocks returns block names', () => {
    const state = new GameState();
    state.addSnapshotBlock('CHUNK_A', new SimpleSnapshot());
    state.addSnapshotBlock('CHUNK_B', new SimpleSnapshot());

    const blocks = state.getRegisteredBlocks();
    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.blockName).toBe('CHUNK_A');
    expect(blocks[1]!.blockName).toBe('CHUNK_B');
  });

  it('clearBlocks removes all registrations', () => {
    const state = new GameState();
    state.addSnapshotBlock('CHUNK_A', new SimpleSnapshot());
    state.clearBlocks();

    expect(state.getRegisteredBlocks()).toHaveLength(0);
  });

  it('CRC after save matches CRC of loaded data', () => {
    // Save
    const saveState = new GameState();
    const saveSnap = new SimpleSnapshot();
    saveSnap.value = 123;
    saveState.addSnapshotBlock('CHUNK_Test', saveSnap);
    const crcBeforeSave = saveState.computeCrc();
    const { data } = saveState.saveGame('crc check');

    // Load
    const loadState = new GameState();
    const loadSnap = new SimpleSnapshot();
    loadState.addSnapshotBlock('CHUNK_Test', loadSnap);
    loadState.loadGame(data);

    // CRC after load should match
    const crcAfterLoad = loadState.computeCrc();
    expect(crcAfterLoad).toBe(crcBeforeSave);
  });
});
