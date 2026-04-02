export interface SourceCameraSettings {
  cameraPitchDegrees: number;
  cameraYawDegrees: number;
  cameraHeight: number;
  maxCameraHeight: number;
  minCameraHeight: number;
  enforceMaxCameraHeight: boolean;
}

const DEFAULT_SOURCE_CAMERA_SETTINGS: Readonly<SourceCameraSettings> = {
  // Retail Zero Hour GameData.ini values.
  cameraPitchDegrees: 37.5,
  cameraYawDegrees: 0,
  cameraHeight: 232,
  maxCameraHeight: 310,
  minCameraHeight: 120,
  enforceMaxCameraHeight: false,
};

const TERRAIN_SAMPLE_SIZE = 40;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function resolveSourceCameraSettings(
  settings: Partial<SourceCameraSettings> | null | undefined,
): SourceCameraSettings {
  return {
    cameraPitchDegrees: isFiniteNumber(settings?.cameraPitchDegrees) && settings.cameraPitchDegrees > 0
      ? settings.cameraPitchDegrees
      : DEFAULT_SOURCE_CAMERA_SETTINGS.cameraPitchDegrees,
    cameraYawDegrees: isFiniteNumber(settings?.cameraYawDegrees)
      ? settings.cameraYawDegrees
      : DEFAULT_SOURCE_CAMERA_SETTINGS.cameraYawDegrees,
    cameraHeight: isFiniteNumber(settings?.cameraHeight) && settings.cameraHeight > 0
      ? settings.cameraHeight
      : DEFAULT_SOURCE_CAMERA_SETTINGS.cameraHeight,
    maxCameraHeight: isFiniteNumber(settings?.maxCameraHeight) && settings.maxCameraHeight > 0
      ? settings.maxCameraHeight
      : DEFAULT_SOURCE_CAMERA_SETTINGS.maxCameraHeight,
    minCameraHeight: isFiniteNumber(settings?.minCameraHeight) && settings.minCameraHeight > 0
      ? settings.minCameraHeight
      : DEFAULT_SOURCE_CAMERA_SETTINGS.minCameraHeight,
    enforceMaxCameraHeight: typeof settings?.enforceMaxCameraHeight === 'boolean'
      ? settings.enforceMaxCameraHeight
      : DEFAULT_SOURCE_CAMERA_SETTINGS.enforceMaxCameraHeight,
  };
}

export function getSourceCameraOrbitPitchAngle(settings: Partial<SourceCameraSettings> | null | undefined): number {
  const resolved = resolveSourceCameraSettings(settings);
  return Math.PI / 2 - ((resolved.cameraPitchDegrees * Math.PI) / 180);
}

export function getSourceCameraBaseDistance(settings: Partial<SourceCameraSettings> | null | undefined): number {
  const resolved = resolveSourceCameraSettings(settings);
  const pitchRadians = (resolved.cameraPitchDegrees * Math.PI) / 180;
  const horizontalDistance = resolved.cameraHeight / Math.tan(pitchRadians);
  return Math.hypot(horizontalDistance, resolved.cameraHeight);
}

export function sampleSourceCameraTerrainHeight(
  x: number,
  z: number,
  getTerrainHeightAt?: ((worldX: number, worldZ: number) => number) | null,
): number {
  if (!getTerrainHeightAt) {
    return 0;
  }

  const centerHeight = getTerrainHeightAt(x, z);
  let maxHeight = Number.isFinite(centerHeight) ? centerHeight : 0;
  const sampleOffsets: ReadonlyArray<readonly [number, number]> = [
    [TERRAIN_SAMPLE_SIZE, -TERRAIN_SAMPLE_SIZE],
    [-TERRAIN_SAMPLE_SIZE, -TERRAIN_SAMPLE_SIZE],
    [TERRAIN_SAMPLE_SIZE, TERRAIN_SAMPLE_SIZE],
    [-TERRAIN_SAMPLE_SIZE, TERRAIN_SAMPLE_SIZE],
  ];
  for (const [offsetX, offsetZ] of sampleOffsets) {
    const sampleHeight = getTerrainHeightAt(x + offsetX, z + offsetZ);
    if (Number.isFinite(sampleHeight)) {
      maxHeight = Math.max(maxHeight, sampleHeight);
    }
  }
  return maxHeight;
}

function resolveMaxHeightAboveGround(
  settings: SourceCameraSettings,
  maxHeightMultiplier: number | null | undefined,
): number {
  const normalizedMultiplier = Number.isFinite(maxHeightMultiplier)
    ? Number(maxHeightMultiplier)
    : 1;
  return Math.max(settings.minCameraHeight, settings.maxCameraHeight * normalizedMultiplier);
}

export function resolveSourceAbsoluteZoomWorldDistance(
  zoomMultiplier: number,
  settings: Partial<SourceCameraSettings> | null | undefined,
): number {
  const resolved = resolveSourceCameraSettings(settings);
  return getSourceCameraBaseDistance(resolved) * zoomMultiplier;
}

export function resolveSourceHeightScaledZoomWorldDistance(options: {
  zoomMultiplier: number;
  targetX: number;
  targetZ: number;
  maxHeightMultiplier?: number | null;
  getTerrainHeightAt?: ((worldX: number, worldZ: number) => number) | null;
  settings?: Partial<SourceCameraSettings> | null;
}): number {
  const resolved = resolveSourceCameraSettings(options.settings);
  const terrainHeightMax = sampleSourceCameraTerrainHeight(
    options.targetX,
    options.targetZ,
    options.getTerrainHeightAt,
  );
  const maxHeightAboveGround = resolveMaxHeightAboveGround(resolved, options.maxHeightMultiplier);
  const maxZoom = (terrainHeightMax + maxHeightAboveGround) / resolved.cameraHeight;
  return getSourceCameraBaseDistance(resolved) * options.zoomMultiplier * maxZoom;
}
