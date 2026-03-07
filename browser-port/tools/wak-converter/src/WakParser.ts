/**
 * WAK (Water Tracks) parser for C&C Generals map water effects.
 *
 * Binary format (little-endian):
 *   Records: startPos(2x float32) + endPos(2x float32) + waveType(int32) = 20 bytes each
 *   Last 4 bytes: track count (int32)
 *
 * C++ ref: GeneralsMD/Code/GameEngineDevice/Source/W3DDevice/GameClient/Water/W3DWaterTracks.cpp:969-1055
 */

export interface WaterTrack {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  waveType: number;
}

export interface WakData {
  trackCount: number;
  tracks: WaterTrack[];
}

export function parseWak(buffer: ArrayBuffer): WakData {
  const view = new DataView(buffer);

  if (buffer.byteLength < 4) {
    return { trackCount: 0, tracks: [] };
  }

  // Track count is stored as the last 4 bytes
  const trackCount = view.getInt32(buffer.byteLength - 4, true);

  if (trackCount <= 0 || trackCount * 20 + 4 > buffer.byteLength) {
    return { trackCount: 0, tracks: [] };
  }

  const tracks: WaterTrack[] = [];
  let offset = 0;

  for (let i = 0; i < trackCount; i++) {
    if (offset + 20 > buffer.byteLength - 4) break;

    tracks.push({
      startX: view.getFloat32(offset, true),
      startY: view.getFloat32(offset + 4, true),
      endX: view.getFloat32(offset + 8, true),
      endY: view.getFloat32(offset + 12, true),
      waveType: view.getInt32(offset + 16, true),
    });

    offset += 20;
  }

  return { trackCount, tracks };
}
