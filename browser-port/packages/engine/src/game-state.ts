/**
 * GameState — save/load orchestrator.
 *
 * Source parity: Generals/Code/GameEngine/Source/Common/System/SaveGame/GameState.cpp
 *
 * Manages named SnapshotBlocks. On save, iterates blocks writing
 * [blockName][size][data] and terminates with "SG_EOF".
 * On load, reads tokens, matches to registered blocks, skips unknown blocks,
 * then runs loadPostProcess() on all loaded snapshots.
 */

import type { Snapshot } from './snapshot.js';
import { Xfer, XferMode } from './xfer.js';
import { XferCrc } from './xfer-crc.js';
import { XferLoad } from './xfer-load.js';
import { XferSave } from './xfer-save.js';

const SAVE_FILE_EOF = 'SG_EOF';

export enum SaveCode {
  SC_INVALID = -1,
  SC_OK = 0,
  SC_NO_FILE_AVAILABLE = 1,
  SC_FILE_NOT_FOUND = 2,
  SC_UNABLE_TO_OPEN_FILE = 3,
  SC_INVALID_XFER = 4,
  SC_UNKNOWN_BLOCK = 5,
  SC_INVALID_DATA = 6,
  SC_ERROR = 7,
}

export interface SaveGameInfo {
  description: string;
  mapName: string;
  timestamp: number;
  sizeBytes: number;
}

interface SnapshotBlock {
  blockName: string;
  snapshot: Snapshot;
}

export class GameState {
  private readonly blocks: SnapshotBlock[] = [];
  private readonly postProcessList: Snapshot[] = [];
  private lastLoadError: Error | null = null;

  /**
   * Register a named snapshot block.
   * Source parity: GameState::addSnapshotBlock()
   * Registration order determines save order.
   */
  addSnapshotBlock(blockName: string, snapshot: Snapshot): void {
    if (!blockName) {
      throw new Error('addSnapshotBlock: blockName is required');
    }
    this.blocks.push({ blockName, snapshot });
  }

  /**
   * Register a snapshot for post-process after load.
   * Source parity: GameState::addPostProcessSnapshot()
   */
  addPostProcessSnapshot(snapshot: Snapshot): void {
    this.postProcessList.push(snapshot);
  }

  /**
   * Save the game state to an ArrayBuffer.
   * Source parity: GameState::saveGame() -> xferSaveData() with XFER_SAVE.
   *
   * Format: for each block: [blockName as length-prefixed string][4-byte block size][block data]
   * Terminated with "SG_EOF" string.
   */
  saveGame(description: string): { data: ArrayBuffer; info: SaveGameInfo } {
    const xferSave = new XferSave();
    xferSave.open('save');

    this.xferSaveData(xferSave);

    xferSave.close();
    const data = xferSave.getBuffer();

    const info: SaveGameInfo = {
      description,
      mapName: '',
      timestamp: Date.now(),
      sizeBytes: data.byteLength,
    };

    return { data, info };
  }

  /**
   * Load game state from an ArrayBuffer.
   * Source parity: GameState::loadGame() -> xferSaveData() with XFER_LOAD.
   *
   * Reads block tokens, matches to registered blocks, skips unknown,
   * then runs loadPostProcess() on all loaded snapshots.
   */
  loadGame(data: ArrayBuffer): SaveCode {
    const xferLoad = new XferLoad(data);
    xferLoad.open('load');
    this.lastLoadError = null;

    try {
      this.xferSaveData(xferLoad);
    } catch (error) {
      this.lastLoadError = error instanceof Error
        ? error
        : new Error(String(error));
      return SaveCode.SC_ERROR;
    }

    xferLoad.close();

    // Post-process all block snapshots
    for (const block of this.blocks) {
      block.snapshot.loadPostProcess();
    }

    // Post-process additional registered snapshots
    for (const snapshot of this.postProcessList) {
      snapshot.loadPostProcess();
    }

    return SaveCode.SC_OK;
  }

  /**
   * Compute CRC of all registered blocks.
   * Source parity: GameState::friend_xferSaveDataForCRC()
   */
  computeCrc(): number {
    const xferCrc = new XferCrc();
    xferCrc.open('crc');

    this.xferSaveData(xferCrc);

    xferCrc.close();
    return xferCrc.getCrc();
  }

  /**
   * The shared save/load method. Direction depends on xfer mode.
   * Source parity: GameState::xferSaveData()
   */
  private xferSaveData(xfer: Xfer): void {
    if (xfer.getMode() === XferMode.XFER_SAVE || xfer.getMode() === XferMode.XFER_CRC) {
      // Save all blocks
      for (const block of this.blocks) {
        // Write block name
        xfer.xferAsciiString(block.blockName);

        // Begin size-prefixed block
        xfer.beginBlock();

        // Xfer block data
        xfer.xferSnapshot(block.snapshot);

        // End block (patches size)
        xfer.endBlock();
      }

      // Write EOF token
      xfer.xferAsciiString(SAVE_FILE_EOF);
    } else {
      // Load: read block tokens until EOF
      let done = false;

      while (!done) {
        const token = xfer.xferAsciiString('');

        if (token === SAVE_FILE_EOF) {
          done = true;
        } else {
          const blockInfo = this.findBlockByName(token);

          if (!blockInfo) {
            // Unknown block — skip it (forward compatibility)
            const dataSize = xfer.beginBlock();
            xfer.skip(dataSize);
            continue;
          }

          // Read block
          xfer.beginBlock();
          xfer.xferSnapshot(blockInfo.snapshot);
          xfer.endBlock();
        }
      }
    }
  }

  private findBlockByName(name: string): SnapshotBlock | undefined {
    return this.blocks.find(
      (b) => b.blockName.toLowerCase() === name.toLowerCase(),
    );
  }

  getRegisteredBlocks(): ReadonlyArray<{ blockName: string }> {
    return this.blocks.map((b) => ({ blockName: b.blockName }));
  }

  clearBlocks(): void {
    this.blocks.length = 0;
    this.postProcessList.length = 0;
    this.lastLoadError = null;
  }

  getLastLoadError(): Error | null {
    return this.lastLoadError;
  }
}
