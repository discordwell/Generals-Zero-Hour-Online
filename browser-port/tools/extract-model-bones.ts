/**
 * Extracts pristine bone positions from converted .glb model files.
 *
 * Source parity: GeneralsMD Drawable::getPristineBonePositions — the C++ engine
 * reads named bones (e.g., SpawnPoint, FirePoint, ExitDoor) from the W3D model's
 * pristine pose and uses them as anchor points for spawn-point exits, projectile
 * origins, garrison doors, etc.  The browser port already preserves W3D pivots
 * as glTF nodes during w3d-converter; this tool walks all generated .glb files
 * and emits a JSON sidecar that maps `modelName → { boneName: { x, y, z, angle } }`
 * so the deterministic game-logic layer can resolve bone positions without
 * coupling to the renderer.
 *
 * Usage:
 *   npx tsx tools/extract-model-bones.ts --models <dir> --output <file>
 *
 * Default behavior writes to packages/app/public/assets/data/model-bones.json.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Bone-name prefixes the C++ engine queries via getPristineBonePositions.  We
 * intentionally extract only the prefixes that drive deterministic gameplay
 * (not visual-only bones) so the data file stays compact.
 */
const TRACKED_BONE_PREFIXES: ReadonlyArray<string> = [
  'SPAWNPOINT',
  'FIREPOINT',
  'GARRISONPOINT',
  'EXITDOOR',
  'DOORWAYBONE',
  'RUNWAY',
  'PRODUCT',
  'PARKING',
];

interface PivotRecord {
  /** Bone name as stored in the W3D pivots table (typically UPPERCASE). */
  name: string;
  /** Model-local X translation (Generals units). */
  x: number;
  /** Model-local Y translation (Generals units). */
  y: number;
  /** Model-local Z translation (Generals units; usually height above floor). */
  z: number;
  /** Yaw rotation around the model Z-axis in radians, derived from the bone quaternion. */
  angle: number;
}

type ModelBoneMap = Record<string, PivotRecord[]>;

/**
 * Read a glTF binary container's JSON chunk and return the parsed object.
 */
function readGlbJson(buffer: Buffer): unknown | null {
  if (buffer.length < 20) return null;
  const magic = buffer.readUInt32LE(0);
  if (magic !== 0x46546c67) return null; // 'glTF' little-endian
  const chunkLen = buffer.readUInt32LE(12);
  const chunkType = buffer.readUInt32LE(16);
  if (chunkType !== 0x4e4f534a) return null; // 'JSON'
  if (20 + chunkLen > buffer.length) return null;
  const text = buffer.slice(20, 20 + chunkLen).toString('utf-8').replace(/\0+$/, '');
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Convert an XYZW quaternion to Z-axis yaw in radians.
 * Matches Matrix3D::Get_Z_Rotation from the C++ math library.
 */
function quaternionToZYaw(qx: number, qy: number, qz: number, qw: number): number {
  const siny_cosp = 2 * (qw * qz + qx * qy);
  const cosy_cosp = 1 - 2 * (qy * qy + qz * qz);
  return Math.atan2(siny_cosp, cosy_cosp);
}

/**
 * Find bones in a glTF document whose names start with any tracked prefix.
 */
function extractTrackedBones(gltf: { nodes?: Array<{ name?: string; translation?: number[]; rotation?: number[] }> }): PivotRecord[] {
  const result: PivotRecord[] = [];
  for (const node of gltf.nodes ?? []) {
    const name = (node.name ?? '').toUpperCase();
    if (!name) continue;
    const matches = TRACKED_BONE_PREFIXES.some((prefix) => name.startsWith(prefix));
    if (!matches) continue;

    const translation = node.translation ?? [0, 0, 0];
    const rotation = node.rotation ?? [0, 0, 0, 1];
    const [tx, ty, tz] = [translation[0] ?? 0, translation[1] ?? 0, translation[2] ?? 0];
    const [qx, qy, qz, qw] = [
      rotation[0] ?? 0,
      rotation[1] ?? 0,
      rotation[2] ?? 0,
      rotation[3] ?? 1,
    ];
    result.push({
      name,
      x: tx,
      y: ty,
      z: tz,
      angle: quaternionToZYaw(qx, qy, qz, qw),
    });
  }
  return result;
}

/**
 * Walk a directory tree and yield .glb file paths.
 */
function* walkGlbFiles(dir: string): Generator<string> {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkGlbFiles(fullPath);
    } else if (entry.isFile() && /\.glb$/i.test(entry.name)) {
      yield fullPath;
    }
  }
}

function modelKeyFromPath(filePath: string): string {
  return path.basename(filePath, path.extname(filePath)).toLowerCase();
}

export function extractModelBones(modelsDir: string): ModelBoneMap {
  const out: ModelBoneMap = {};
  for (const filePath of walkGlbFiles(modelsDir)) {
    let buffer: Buffer;
    try {
      buffer = fs.readFileSync(filePath);
    } catch {
      continue;
    }
    const gltf = readGlbJson(buffer);
    if (!gltf || typeof gltf !== 'object') continue;
    const bones = extractTrackedBones(gltf as { nodes?: Array<{ name?: string; translation?: number[]; rotation?: number[] }> });
    if (bones.length === 0) continue;
    const key = modelKeyFromPath(filePath);
    if (out[key]) {
      // Two .glb files with the same basename (e.g., duplicate art) — keep the longest set.
      if (bones.length <= out[key].length) continue;
    }
    out[key] = bones;
  }
  return out;
}

function parseArgs(argv: string[]): { modelsDir: string; outputPath: string } {
  const projectRoot = path.resolve(__dirname, '..');
  let modelsDir = path.join(projectRoot, 'packages/app/public/assets/models');
  let outputPath = path.join(projectRoot, 'packages/app/public/assets/data/model-bones.json');
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--models' && argv[i + 1]) {
      modelsDir = path.resolve(argv[i + 1]!);
      i++;
    } else if (arg === '--output' && argv[i + 1]) {
      outputPath = path.resolve(argv[i + 1]!);
      i++;
    }
  }
  return { modelsDir, outputPath };
}

function main(): void {
  const { modelsDir, outputPath } = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(modelsDir)) {
    console.error(`Models directory not found: ${modelsDir}`);
    process.exit(1);
  }
  const start = Date.now();
  const bones = extractModelBones(modelsDir);
  const modelCount = Object.keys(bones).length;
  let totalBones = 0;
  for (const list of Object.values(bones)) totalBones += list.length;
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const serialized = `${JSON.stringify(bones, null, 2)}\n`;
  fs.writeFileSync(outputPath, serialized);
  const elapsed = Date.now() - start;
  console.log(
    `Extracted ${totalBones} bones across ${modelCount} models in ${elapsed}ms → ${outputPath}`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
