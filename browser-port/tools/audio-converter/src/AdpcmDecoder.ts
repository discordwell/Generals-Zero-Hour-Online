/**
 * IMA ADPCM decoder for WAV files.
 *
 * Decodes IMA ADPCM (wFormatTag 0x0011) 4-bit samples to 16-bit PCM.
 * Used by C&C Generals for compressed audio assets.
 */

// IMA ADPCM step table (88 entries)
const STEP_TABLE = [
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31,
  34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143,
  157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544,
  598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552, 1707,
  1878, 2066, 2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871,
  5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899,
  15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794,
];

// Index adjustment table for each 4-bit nibble
const INDEX_TABLE = [
  -1, -1, -1, -1, 2, 4, 6, 8,
  -1, -1, -1, -1, 2, 4, 6, 8,
];

function clamp(val: number, min: number, max: number): number {
  return val < min ? min : val > max ? max : val;
}

function decodeNibble(nibble: number, state: { predictor: number; stepIndex: number }): number {
  const step = STEP_TABLE[state.stepIndex]!;

  let diff = step >> 3;
  if (nibble & 1) diff += step >> 2;
  if (nibble & 2) diff += step >> 1;
  if (nibble & 4) diff += step;
  if (nibble & 8) diff = -diff;

  state.predictor = clamp(state.predictor + diff, -32768, 32767);
  state.stepIndex = clamp(state.stepIndex + INDEX_TABLE[nibble & 0xF]!, 0, 88);

  return state.predictor;
}

export interface WavInfo {
  formatTag: number;
  channels: number;
  sampleRate: number;
  blockAlign: number;
  bitsPerSample: number;
  samplesPerBlock: number;
  dataOffset: number;
  dataSize: number;
  fmtOffset: number;
  fmtSize: number;
}

export function parseWavHeader(buffer: ArrayBuffer): WavInfo {
  const view = new DataView(buffer);

  // RIFF header
  const riff = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (riff !== 'RIFF') throw new Error('Not a RIFF file');

  const wave = String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11));
  if (wave !== 'WAVE') throw new Error('Not a WAVE file');

  let offset = 12;
  let fmtOffset = 0;
  let fmtSize = 0;
  let dataOffset = 0;
  let dataSize = 0;

  while (offset + 8 <= buffer.byteLength) {
    const chunkId = String.fromCharCode(
      view.getUint8(offset), view.getUint8(offset + 1),
      view.getUint8(offset + 2), view.getUint8(offset + 3),
    );
    const chunkSize = view.getUint32(offset + 4, true);

    if (chunkId === 'fmt ') {
      fmtOffset = offset + 8;
      fmtSize = chunkSize;
    } else if (chunkId === 'data') {
      dataOffset = offset + 8;
      dataSize = chunkSize;
    }

    offset += 8 + chunkSize;
    if (chunkSize % 2 !== 0) offset++; // RIFF chunks are word-aligned
  }

  if (fmtOffset === 0) throw new Error('No fmt chunk found');
  if (dataOffset === 0) throw new Error('No data chunk found');

  const formatTag = view.getUint16(fmtOffset, true);
  const channels = view.getUint16(fmtOffset + 2, true);
  const sampleRate = view.getUint32(fmtOffset + 4, true);
  const blockAlign = view.getUint16(fmtOffset + 12, true);
  const bitsPerSample = view.getUint16(fmtOffset + 14, true);

  let samplesPerBlock = 0;
  if (formatTag === 0x0011 && fmtSize >= 20) {
    samplesPerBlock = view.getUint16(fmtOffset + 18, true);
  }

  return {
    formatTag, channels, sampleRate, blockAlign, bitsPerSample,
    samplesPerBlock, dataOffset, dataSize, fmtOffset, fmtSize,
  };
}

export function decodeAdpcmToPcm(buffer: ArrayBuffer): ArrayBuffer {
  const info = parseWavHeader(buffer);
  if (info.formatTag !== 0x0011) {
    throw new Error(`Not IMA ADPCM: format tag 0x${info.formatTag.toString(16)}`);
  }

  const view = new DataView(buffer);
  const channels = info.channels;
  const blockAlign = info.blockAlign;
  const samplesPerBlock = info.samplesPerBlock;

  // Calculate total samples
  const numBlocks = Math.floor(info.dataSize / blockAlign);
  const totalSamples = numBlocks * samplesPerBlock;

  // Output PCM buffer
  const pcmDataSize = totalSamples * channels * 2; // 16-bit per sample per channel
  // WAV header: 44 bytes standard
  const outputSize = 44 + pcmDataSize;
  const output = new ArrayBuffer(outputSize);
  const outView = new DataView(output);
  const outBytes = new Uint8Array(output);

  // Write WAV header
  function writeString(offset: number, str: string) {
    for (let i = 0; i < str.length; i++) {
      outBytes[offset + i] = str.charCodeAt(i);
    }
  }

  writeString(0, 'RIFF');
  outView.setUint32(4, outputSize - 8, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  outView.setUint32(16, 16, true);          // fmt chunk size
  outView.setUint16(20, 0x0001, true);      // PCM format
  outView.setUint16(22, channels, true);
  outView.setUint32(24, info.sampleRate, true);
  outView.setUint32(28, info.sampleRate * channels * 2, true); // byte rate
  outView.setUint16(32, channels * 2, true); // block align
  outView.setUint16(34, 16, true);          // bits per sample
  writeString(36, 'data');
  outView.setUint32(40, pcmDataSize, true);

  let pcmOffset = 44;
  let dataPos = info.dataOffset;

  for (let block = 0; block < numBlocks; block++) {
    const blockStart = dataPos;
    const states: Array<{ predictor: number; stepIndex: number }> = [];

    // Read block preamble: 4 bytes per channel (predictor i16 + stepIndex u8 + reserved u8)
    for (let ch = 0; ch < channels; ch++) {
      const predictor = view.getInt16(dataPos, true);
      dataPos += 2;
      const stepIndex = clamp(view.getUint8(dataPos), 0, 88);
      dataPos += 1;
      dataPos += 1; // reserved
      states.push({ predictor, stepIndex });

      // Write initial predictor sample
      outView.setInt16(pcmOffset + ch * 2, predictor, true);
    }
    pcmOffset += channels * 2;

    // Decode remaining samples in blocks of 8 per channel
    const samplesRemaining = samplesPerBlock - 1;
    let samplesDecoded = 0;

    while (samplesDecoded < samplesRemaining && (dataPos - blockStart) < blockAlign) {
      for (let ch = 0; ch < channels; ch++) {
        // Each channel has 4 bytes = 8 nibbles = 8 samples
        const samplesToRead = Math.min(8, samplesRemaining - samplesDecoded);
        for (let s = 0; s < samplesToRead; s++) {
          const byteVal = view.getUint8(dataPos + Math.floor(s / 2));
          const nibble = (s % 2 === 0) ? (byteVal & 0x0F) : ((byteVal >> 4) & 0x0F);
          const sample = decodeNibble(nibble, states[ch]!);
          const outIdx = pcmOffset + (samplesDecoded + s) * channels * 2 + ch * 2;
          if (outIdx + 1 < outputSize) {
            outView.setInt16(outIdx, sample, true);
          }
        }
        dataPos += 4;
      }
      samplesDecoded += 8;
    }

    pcmOffset += samplesRemaining * channels * 2;
    dataPos = blockStart + blockAlign;
  }

  return output;
}
