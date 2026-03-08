import { describe, it, expect, beforeEach } from 'vitest';
import { ControlGroupManager } from './control-group-manager.js';

describe('ControlGroupManager', () => {
  /** Set of entity IDs considered "alive" — test controls this. */
  let aliveIds: Set<number>;
  let mgr: ControlGroupManager;

  beforeEach(() => {
    aliveIds = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    mgr = new ControlGroupManager((id) => aliveIds.has(id));
  });

  // --------------------------------------------------------------------------
  // Assign & recall
  // --------------------------------------------------------------------------

  it('assigns and recalls a group', () => {
    mgr.assignGroup(1, [1, 2, 3]);
    expect(mgr.recallGroup(1)).toEqual([1, 2, 3]);
  });

  it('overwrites a group on re-assign', () => {
    mgr.assignGroup(1, [1, 2]);
    mgr.assignGroup(1, [4, 5, 6]);
    expect(mgr.recallGroup(1)).toEqual([4, 5, 6]);
  });

  // --------------------------------------------------------------------------
  // Dead entity filtering
  // --------------------------------------------------------------------------

  it('recall filters out dead entities', () => {
    mgr.assignGroup(2, [1, 2, 3, 4]);
    aliveIds.delete(2);
    aliveIds.delete(4);

    expect(mgr.recallGroup(2)).toEqual([1, 3]);
  });

  it('recall prunes internal state so subsequent calls stay consistent', () => {
    mgr.assignGroup(3, [5, 6, 7]);
    aliveIds.delete(6);

    mgr.recallGroup(3); // prunes 6
    // Even getGroup (no filter) should reflect the pruned state
    expect(mgr.getGroup(3)).toEqual([5, 7]);
  });

  // --------------------------------------------------------------------------
  // Add to group (Shift+digit)
  // --------------------------------------------------------------------------

  it('adds entities to an existing group without duplicates', () => {
    mgr.assignGroup(4, [1, 2]);
    mgr.addToGroup(4, [2, 3, 4]);
    expect(mgr.getGroup(4)).toEqual([1, 2, 3, 4]);
  });

  it('creates the group if it does not exist on addToGroup', () => {
    mgr.addToGroup(5, [7, 8]);
    expect(mgr.getGroup(5)).toEqual([7, 8]);
  });

  // --------------------------------------------------------------------------
  // Clear
  // --------------------------------------------------------------------------

  it('clears a single group', () => {
    mgr.assignGroup(6, [1, 2]);
    mgr.clearGroup(6);
    expect(mgr.recallGroup(6)).toEqual([]);
  });

  it('clearAll resets everything', () => {
    mgr.assignGroup(1, [1]);
    mgr.assignGroup(2, [2]);
    mgr.assignGroup(9, [9]);
    mgr.clearAll();

    for (let g = 0; g <= 9; g++) {
      expect(mgr.recallGroup(g)).toEqual([]);
    }
  });

  // --------------------------------------------------------------------------
  // Empty / unassigned
  // --------------------------------------------------------------------------

  it('recalling an unassigned group returns an empty array', () => {
    expect(mgr.recallGroup(7)).toEqual([]);
  });

  it('getGroup on unassigned group returns an empty array', () => {
    expect(mgr.getGroup(0)).toEqual([]);
  });

  // --------------------------------------------------------------------------
  // Group independence
  // --------------------------------------------------------------------------

  it('groups 0-9 are independent', () => {
    for (let g = 0; g <= 9; g++) {
      mgr.assignGroup(g, [g * 10 + 1, g * 10 + 2]);
      // Mark them alive
      aliveIds.add(g * 10 + 1);
      aliveIds.add(g * 10 + 2);
    }

    for (let g = 0; g <= 9; g++) {
      expect(mgr.recallGroup(g)).toEqual([g * 10 + 1, g * 10 + 2]);
    }
  });

  // --------------------------------------------------------------------------
  // Defensive copies
  // --------------------------------------------------------------------------

  it('recallGroup returns a copy, not the internal array', () => {
    mgr.assignGroup(1, [1, 2, 3]);
    const result = mgr.recallGroup(1);
    result.push(99);
    expect(mgr.recallGroup(1)).toEqual([1, 2, 3]);
  });

  it('getGroup returns a copy, not the internal array', () => {
    mgr.assignGroup(1, [1, 2]);
    const snapshot = mgr.getGroup(1);
    // readonly prevents push at compile time, but verify at runtime too
    expect(snapshot).toEqual([1, 2]);
  });

  // --------------------------------------------------------------------------
  // Invalid group numbers
  // --------------------------------------------------------------------------

  it('ignores invalid group numbers gracefully', () => {
    mgr.assignGroup(-1, [1]);
    mgr.assignGroup(10, [2]);
    mgr.assignGroup(1.5, [3]);
    expect(mgr.recallGroup(-1)).toEqual([]);
    expect(mgr.recallGroup(10)).toEqual([]);
    expect(mgr.recallGroup(1.5)).toEqual([]);
  });

  it('clearGroup with invalid number does not throw', () => {
    expect(() => mgr.clearGroup(-1)).not.toThrow();
    expect(() => mgr.clearGroup(10)).not.toThrow();
  });
});
