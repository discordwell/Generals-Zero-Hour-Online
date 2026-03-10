import { describe, expect, it } from 'vitest';

import { syncPlayerSidesFromNetwork } from './player-side-sync.js';

describe('syncPlayerSidesFromNetwork', () => {
  it('writes known slot sides into game-logic routing state', () => {
    const recorded: Array<{ playerIndex: number; side: string | null | undefined }> = [];

    syncPlayerSidesFromNetwork(
      {
        getKnownPlayerSlots: () => [0, 2, 5],
        getPlayerSide: (playerNum) => {
          if (playerNum === 0) {
            return 'America';
          }
          if (playerNum === 2) {
            return 'China';
          }
          return null;
        },
      },
      {
        setPlayerSide(playerIndex, side) {
          recorded.push({ playerIndex, side });
        },
      },
    );

    // Null sides are skipped to prevent overwriting sides set by skirmish setup.
    expect(recorded).toEqual([
      { playerIndex: 0, side: 'America' },
      { playerIndex: 2, side: 'China' },
    ]);
  });

  it('does nothing when there are no known slots', () => {
    let calls = 0;

    syncPlayerSidesFromNetwork(
      {
        getKnownPlayerSlots: () => [],
        getPlayerSide: () => {
          throw new Error('should not be called');
        },
      },
      {
        setPlayerSide() {
          calls += 1;
        },
      },
    );

    expect(calls).toBe(0);
  });
});
