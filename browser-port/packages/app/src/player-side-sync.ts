export interface NetworkPlayerSideSource {
  getKnownPlayerSlots(): number[];
  getPlayerSide(playerNum: number): string | null;
}

export interface GameLogicPlayerSideSink {
  setPlayerSide(playerIndex: number, side: string | null | undefined): void;
}

/**
 * Mirror session slot side ownership into game-logic relationship routing.
 * Only overwrites sides that the network source explicitly provides;
 * null/undefined values are skipped to preserve sides set by skirmish setup.
 */
export function syncPlayerSidesFromNetwork(
  source: NetworkPlayerSideSource,
  sink: GameLogicPlayerSideSink,
): void {
  for (const playerSlot of source.getKnownPlayerSlots()) {
    const side = source.getPlayerSide(playerSlot);
    if (side != null) {
      sink.setPlayerSide(playerSlot, side);
    }
  }
}
