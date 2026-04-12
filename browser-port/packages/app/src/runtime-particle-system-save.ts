import * as THREE from 'three';
import {
  XferLoad,
  XferMode,
  type Snapshot,
  type Xfer,
} from '@generals/engine';
import {
  PARTICLE_PRIORITY_ORDER,
  type ParticlePriority,
  type ParticleSystemManagerSaveState,
  type ParticleSystemInstanceSaveState,
  type ParticleSystemTemplate,
} from '@generals/renderer';

const SOURCE_PARTICLE_SYSTEM_SNAPSHOT_VERSION = 1;
const MAX_PARTICLE_KEYFRAMES = 8;
const INVALID_ID = 0xffffffff;
const INVALID_DRAWABLE_ID = 0xffffffff;
const SOURCE_SHADER_TYPES = ['NONE', 'ADDITIVE', 'ALPHA', 'ALPHA_TEST', 'MULTIPLY'] as const;
const SOURCE_PARTICLE_TYPES = ['NONE', 'PARTICLE', 'DRAWABLE', 'STREAK', 'VOLUME_PARTICLE', 'SMUDGE'] as const;
const SOURCE_EMISSION_VELOCITY_TYPES = [
  'NONE',
  'ORTHO',
  'SPHERICAL',
  'HEMISPHERICAL',
  'CYLINDRICAL',
  'OUTWARD',
] as const;
const SOURCE_EMISSION_VOLUME_TYPES = ['NONE', 'POINT', 'LINE', 'BOX', 'SPHERE', 'CYLINDER'] as const;
const SOURCE_WIND_MOTION_TYPES = ['NONE', 'Unused', 'PingPong', 'Circular'] as const;

interface RandomVariableState {
  distributionType: number;
  low: number;
  high: number;
}

interface Coord3D {
  x: number;
  y: number;
  z: number;
}

interface RGBColor {
  red: number;
  green: number;
  blue: number;
}

interface SourceParticleState {
  velocity: Coord3D;
  position: Coord3D;
  emitterPosition: Coord3D;
  velocityDamping: number;
  angleZ: number;
  angularRateZ: number;
  lifetime: number;
  size: number;
  sizeRate: number;
  sizeRateDamping: number;
  alphaKeys: Array<{ value: number; frame: number }>;
  colorKeys: Array<{ color: RGBColor; frame: number }>;
  particleUpTowardsEmitter: boolean;
  windRandomness: number;
  personality: number;
  acceleration: Coord3D;
  lastPosition: Coord3D;
  lifetimeLeft: number;
  createTimestamp: number;
  alpha: number;
  alphaRate: number;
  alphaTargetKey: number;
  color: RGBColor;
  colorRate: RGBColor;
  colorTargetKey: number;
  systemUnderControlId: number | null;
}

function copyChunkBytes(chunkData: ArrayBuffer | Uint8Array): ArrayBuffer {
  const bytes = chunkData instanceof Uint8Array ? chunkData : new Uint8Array(chunkData);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function distributionTypeForRange(low: number, high: number): number {
  return low === high ? 0 : 1;
}

function rangeToRandomVariable(low: number, high: number): RandomVariableState {
  return {
    distributionType: distributionTypeForRange(low, high),
    low,
    high,
  };
}

function xferRandomVariable(xfer: Xfer, value: RandomVariableState): RandomVariableState {
  return {
    distributionType: xfer.xferInt(value.distributionType),
    low: xfer.xferReal(value.low),
    high: xfer.xferReal(value.high),
  };
}

function xferRawMatrix3D(xfer: Xfer, values: number[]): number[] {
  const result: number[] = [];
  for (let index = 0; index < 12; index += 1) {
    result.push(xfer.xferReal(values[index] ?? 0));
  }
  return result;
}

function quaternionToMatrixRows(
  position: Coord3D,
  orientation: { x: number; y: number; z: number; w: number },
  includeTranslation: boolean,
): number[] {
  const matrix = new THREE.Matrix4();
  matrix.compose(
    new THREE.Vector3(
      includeTranslation ? position.x : 0,
      includeTranslation ? position.y : 0,
      includeTranslation ? position.z : 0,
    ),
    new THREE.Quaternion(orientation.x, orientation.y, orientation.z, orientation.w),
    new THREE.Vector3(1, 1, 1),
  );
  const e = matrix.elements;
  return [
    e[0]!, e[4]!, e[8]!, e[12]!,
    e[1]!, e[5]!, e[9]!, e[13]!,
    e[2]!, e[6]!, e[10]!, e[14]!,
  ];
}

function matrixRowsToQuaternion(values: number[]): { x: number; y: number; z: number; w: number } {
  const matrix = new THREE.Matrix4().set(
    values[0] ?? 1, values[1] ?? 0, values[2] ?? 0, values[3] ?? 0,
    values[4] ?? 0, values[5] ?? 1, values[6] ?? 0, values[7] ?? 0,
    values[8] ?? 0, values[9] ?? 0, values[10] ?? 1, values[11] ?? 0,
    0, 0, 0, 1,
  );
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(matrix);
  return {
    x: quaternion.x,
    y: quaternion.y,
    z: quaternion.z,
    w: quaternion.w,
  };
}

function encodeEnum<T extends readonly string[]>(value: string, values: T): number {
  const index = values.indexOf(value as T[number]);
  return index >= 0 ? index : 0;
}

function decodeEnum<T extends readonly string[]>(index: number, values: T): T[number] {
  return values[index] ?? values[0]!;
}

function decodeSourceEnum<T extends readonly string[]>(
  index: number,
  values: T,
  fallback: T[number],
): T[number] {
  const value = decodeEnum(index, values);
  return value === 'NONE' ? fallback : value;
}

function xferTemplateInfo(
  xfer: Xfer,
  template: ParticleSystemTemplate,
  runtime: Pick<
    ParticleSystemInstanceSaveState,
    'windAngle' | 'windAngleChange' | 'windMotionMovingToEnd' | 'windPingPongTargetAngle'
  >,
): ParticleSystemTemplate {
  const version = xfer.xferVersion(1);
  if (version !== 1) {
    throw new Error(`Unsupported particle-system info version ${version}`);
  }

  const isOneShot = xfer.xferBool(template.isOneShot);
  const shader = decodeSourceEnum(
    xfer.xferInt(encodeEnum(template.shader, SOURCE_SHADER_TYPES)),
    SOURCE_SHADER_TYPES,
    'ALPHA',
  ) as ParticleSystemTemplate['shader'];
  const type = decodeSourceEnum(
    xfer.xferInt(encodeEnum(template.type, SOURCE_PARTICLE_TYPES)),
    SOURCE_PARTICLE_TYPES,
    'PARTICLE',
  ) as ParticleSystemTemplate['type'];
  const particleName = xfer.xferAsciiString(template.particleName);

  const angleX = xferRandomVariable(xfer, rangeToRandomVariable(0, 0));
  const angleY = xferRandomVariable(xfer, rangeToRandomVariable(0, 0));
  const angleZ = xferRandomVariable(xfer, rangeToRandomVariable(template.angleZ.min, template.angleZ.max));
  const angularRateX = xferRandomVariable(xfer, rangeToRandomVariable(0, 0));
  const angularRateY = xferRandomVariable(xfer, rangeToRandomVariable(0, 0));
  const angularRateZ = xferRandomVariable(
    xfer,
    rangeToRandomVariable(template.angularRateZ.min, template.angularRateZ.max),
  );
  const angularDamping = xferRandomVariable(
    xfer,
    rangeToRandomVariable(template.angularDamping.min, template.angularDamping.max),
  );
  const velocityDamping = xferRandomVariable(
    xfer,
    rangeToRandomVariable(template.velocityDamping.min, template.velocityDamping.max),
  );
  const lifetime = xferRandomVariable(xfer, rangeToRandomVariable(template.lifetime.min, template.lifetime.max));
  const systemLifetime = xfer.xferUnsignedInt(template.systemLifetime);
  const startSize = xferRandomVariable(xfer, rangeToRandomVariable(template.size.min, template.size.max));
  const startSizeRate = xferRandomVariable(
    xfer,
    rangeToRandomVariable(template.startSizeRate.min, template.startSizeRate.max),
  );
  const sizeRate = xferRandomVariable(xfer, rangeToRandomVariable(template.sizeRate.min, template.sizeRate.max));
  const sizeRateDamping = xferRandomVariable(
    xfer,
    rangeToRandomVariable(template.sizeRateDamping.min, template.sizeRateDamping.max),
  );

  const alphaKeyframes: ParticleSystemTemplate['alphaKeyframes'] = [];
  for (let index = 0; index < MAX_PARTICLE_KEYFRAMES; index += 1) {
    const keyframe = template.alphaKeyframes[index] ?? { alphaMin: 0, alphaMax: 0, frame: 0 };
    const alphaRange = xferRandomVariable(
      xfer,
      rangeToRandomVariable(keyframe.alphaMin, keyframe.alphaMax),
    );
    const frame = xfer.xferUnsignedInt(keyframe.frame);
    if (frame > 0 || index === 0 || alphaRange.low !== 0 || alphaRange.high !== 0) {
      alphaKeyframes.push({
        alphaMin: alphaRange.low,
        alphaMax: alphaRange.high,
        frame,
      });
    }
  }

  const colorKeyframes: ParticleSystemTemplate['colorKeyframes'] = [];
  for (let index = 0; index < MAX_PARTICLE_KEYFRAMES; index += 1) {
    const keyframe = template.colorKeyframes[index] ?? { r: 0, g: 0, b: 0, frame: 0 };
    const color = {
      red: xfer.xferReal((keyframe.r ?? 0) / 255),
      green: xfer.xferReal((keyframe.g ?? 0) / 255),
      blue: xfer.xferReal((keyframe.b ?? 0) / 255),
    };
    const frame = xfer.xferUnsignedInt(keyframe.frame);
    if (frame > 0 || index === 0 || color.red !== 0 || color.green !== 0 || color.blue !== 0) {
      colorKeyframes.push({
        r: Math.round(clamp(color.red, 0, 1) * 255),
        g: Math.round(clamp(color.green, 0, 1) * 255),
        b: Math.round(clamp(color.blue, 0, 1) * 255),
        frame,
      });
    }
  }

  const colorScale = xferRandomVariable(
    xfer,
    rangeToRandomVariable(template.colorScale.min, template.colorScale.max),
  );
  const burstDelay = xferRandomVariable(xfer, rangeToRandomVariable(template.burstDelay.min, template.burstDelay.max));
  const burstCount = xferRandomVariable(xfer, rangeToRandomVariable(template.burstCount.min, template.burstCount.max));
  const initialDelay = xferRandomVariable(
    xfer,
    rangeToRandomVariable(template.initialDelay.min, template.initialDelay.max),
  );
  const driftVelocity = xfer.xferCoord3D(template.driftVelocity);
  const gravity = xfer.xferReal(template.gravity);
  const slaveSystemName = xfer.xferAsciiString(template.slaveSystemName ?? '');
  const slavePosOffset = xfer.xferCoord3D(template.slavePosOffset ?? { x: 0, y: 0, z: 0 });
  const attachedSystemName = xfer.xferAsciiString(template.attachedSystemName ?? '');

  const velocityTypeIndex = xfer.xferInt(encodeEnum(template.velocityType, SOURCE_EMISSION_VELOCITY_TYPES));
  const velocityType = decodeSourceEnum(
    velocityTypeIndex,
    SOURCE_EMISSION_VELOCITY_TYPES,
    'ORTHO',
  ) as ParticleSystemTemplate['velocityType'];
  const priority = decodeEnum(
    xfer.xferInt(encodeEnum(template.priority, PARTICLE_PRIORITY_ORDER)),
    PARTICLE_PRIORITY_ORDER,
  ) as ParticlePriority;

  let velOrthoX = rangeToRandomVariable(template.velOrtho.x.min, template.velOrtho.x.max);
  let velOrthoY = rangeToRandomVariable(template.velOrtho.y.min, template.velOrtho.y.max);
  let velOrthoZ = rangeToRandomVariable(template.velOrtho.z.min, template.velOrtho.z.max);
  let velSpherical = rangeToRandomVariable(template.velSpherical.min, template.velSpherical.max);
  let velHemispherical = rangeToRandomVariable(template.velHemispherical.min, template.velHemispherical.max);
  let velCylindricalRadial =
    rangeToRandomVariable(template.velCylindrical.radial.min, template.velCylindrical.radial.max);
  let velCylindricalNormal =
    rangeToRandomVariable(template.velCylindrical.normal.min, template.velCylindrical.normal.max);
  let velOutward = rangeToRandomVariable(template.velOutward.min, template.velOutward.max);
  let velOutwardOther = rangeToRandomVariable(template.velOutwardOther.min, template.velOutwardOther.max);
  switch (SOURCE_EMISSION_VELOCITY_TYPES[velocityTypeIndex]) {
    case 'ORTHO':
      velOrthoX = xferRandomVariable(xfer, velOrthoX);
      velOrthoY = xferRandomVariable(xfer, velOrthoY);
      velOrthoZ = xferRandomVariable(xfer, velOrthoZ);
      break;
    case 'SPHERICAL':
      velSpherical = xferRandomVariable(xfer, velSpherical);
      break;
    case 'HEMISPHERICAL':
      velHemispherical = xferRandomVariable(xfer, velHemispherical);
      break;
    case 'CYLINDRICAL':
      velCylindricalRadial = xferRandomVariable(xfer, velCylindricalRadial);
      velCylindricalNormal = xferRandomVariable(xfer, velCylindricalNormal);
      break;
    case 'OUTWARD':
      velOutward = xferRandomVariable(xfer, velOutward);
      velOutwardOther = xferRandomVariable(xfer, velOutwardOther);
      break;
  }

  const volumeTypeIndex = xfer.xferInt(encodeEnum(template.volumeType, SOURCE_EMISSION_VOLUME_TYPES));
  const volumeType = decodeSourceEnum(
    volumeTypeIndex,
    SOURCE_EMISSION_VOLUME_TYPES,
    'POINT',
  ) as ParticleSystemTemplate['volumeType'];
  let volLineStart = template.volLineStart;
  let volLineEnd = template.volLineEnd;
  let volBoxHalfSize = template.volBoxHalfSize;
  let volSphereRadius = template.volSphereRadius;
  let volCylinderRadius = template.volCylinderRadius;
  let volCylinderLength = template.volCylinderLength;
  switch (SOURCE_EMISSION_VOLUME_TYPES[volumeTypeIndex]) {
    case 'LINE':
      volLineStart = xfer.xferCoord3D(volLineStart);
      volLineEnd = xfer.xferCoord3D(volLineEnd);
      break;
    case 'BOX':
      volBoxHalfSize = xfer.xferCoord3D(volBoxHalfSize);
      break;
    case 'SPHERE':
      volSphereRadius = xfer.xferReal(volSphereRadius);
      break;
    case 'CYLINDER':
      volCylinderRadius = xfer.xferReal(volCylinderRadius);
      volCylinderLength = xfer.xferReal(volCylinderLength);
      break;
  }

  const isHollow = xfer.xferBool(template.isHollow);
  const isGroundAligned = xfer.xferBool(template.isGroundAligned);
  const isEmitAboveGroundOnly = xfer.xferBool(template.isEmitAboveGroundOnly);
  const isParticleUpTowardsEmitter = xfer.xferBool(template.isParticleUpTowardsEmitter);

  const windMotion = decodeSourceEnum(
    xfer.xferInt(encodeEnum(template.windMotion, SOURCE_WIND_MOTION_TYPES)),
    SOURCE_WIND_MOTION_TYPES,
    'Unused',
  ) as ParticleSystemTemplate['windMotion'];
  const windAngle = xfer.xferReal(runtime.windAngle);
  const windAngleChange = xfer.xferReal(runtime.windAngleChange);
  const windAngleChangeMin = xfer.xferReal(template.windAngleChangeMin);
  const windAngleChangeMax = xfer.xferReal(template.windAngleChangeMax);
  const windMotionStartAngle = xfer.xferReal(
    runtime.windMotionMovingToEnd ? template.windPingPongStartAngleMin : runtime.windPingPongTargetAngle,
  );
  const windPingPongStartAngleMin = xfer.xferReal(template.windPingPongStartAngleMin);
  const windPingPongStartAngleMax = xfer.xferReal(template.windPingPongStartAngleMax);
  const windMotionEndAngle = xfer.xferReal(
    runtime.windMotionMovingToEnd ? runtime.windPingPongTargetAngle : template.windPingPongEndAngleMin,
  );
  const windPingPongEndAngleMin = xfer.xferReal(template.windPingPongEndAngleMin);
  const windPingPongEndAngleMax = xfer.xferReal(template.windPingPongEndAngleMax);
  const windMotionMovingToEnd = xfer.xferByte(runtime.windMotionMovingToEnd ? 1 : 0) !== 0;

  void angleX;
  void angleY;
  void angularRateX;
  void angularRateY;
  void colorScale;
  void windAngle;
  void windAngleChange;
  void windMotionStartAngle;
  void windMotionEndAngle;
  void windMotionMovingToEnd;

  return {
    name: template.name,
    priority,
    isOneShot,
    shader,
    type,
    particleName,
    angleZ: { min: angleZ.low, max: angleZ.high },
    angularRateZ: { min: angularRateZ.low, max: angularRateZ.high },
    angularDamping: { min: angularDamping.low, max: angularDamping.high },
    velocityDamping: { min: velocityDamping.low, max: velocityDamping.high },
    gravity,
    lifetime: { min: lifetime.low, max: lifetime.high },
    systemLifetime,
    size: { min: startSize.low, max: startSize.high },
    startSizeRate: { min: startSizeRate.low, max: startSizeRate.high },
    sizeRate: { min: sizeRate.low, max: sizeRate.high },
    sizeRateDamping: { min: sizeRateDamping.low, max: sizeRateDamping.high },
    alphaKeyframes,
    colorKeyframes,
    colorScale: { min: colorScale.low, max: colorScale.high },
    burstDelay: { min: burstDelay.low, max: burstDelay.high },
    burstCount: { min: burstCount.low, max: burstCount.high },
    initialDelay: { min: initialDelay.low, max: initialDelay.high },
    driftVelocity,
    velocityType,
    velOrtho: {
      x: { min: velOrthoX.low, max: velOrthoX.high },
      y: { min: velOrthoY.low, max: velOrthoY.high },
      z: { min: velOrthoZ.low, max: velOrthoZ.high },
    },
    velOutward: { min: velOutward.low, max: velOutward.high },
    velOutwardOther: { min: velOutwardOther.low, max: velOutwardOther.high },
    velSpherical: { min: velSpherical.low, max: velSpherical.high },
    velHemispherical: { min: velHemispherical.low, max: velHemispherical.high },
    velCylindrical: {
      radial: { min: velCylindricalRadial.low, max: velCylindricalRadial.high },
      normal: { min: velCylindricalNormal.low, max: velCylindricalNormal.high },
    },
    volumeType,
    volLineStart,
    volLineEnd,
    volBoxHalfSize,
    volSphereRadius,
    volCylinderRadius,
    volCylinderLength,
    isHollow,
    isGroundAligned,
    isEmitAboveGroundOnly,
    isParticleUpTowardsEmitter,
    windMotion,
    windAngleChangeMin,
    windAngleChangeMax,
    windPingPongStartAngleMin,
    windPingPongStartAngleMax,
    windPingPongEndAngleMin,
    windPingPongEndAngleMax,
    slavePosOffset: slaveSystemName.length > 0 ? slavePosOffset : undefined,
    slaveSystemName: slaveSystemName || undefined,
    attachedSystemName: attachedSystemName || undefined,
  };
}

function alphaKeyValueForParticle(
  template: ParticleSystemTemplate,
  keyIndex: number,
  alphaFactor: number,
): { value: number; frame: number } {
  const keyframe = template.alphaKeyframes[keyIndex] ?? { alphaMin: 0, alphaMax: 0, frame: 0 };
  return {
    value: keyframe.alphaMin + alphaFactor * (keyframe.alphaMax - keyframe.alphaMin),
    frame: keyframe.frame,
  };
}

function colorKeyForParticle(
  template: ParticleSystemTemplate,
  keyIndex: number,
): { color: RGBColor; frame: number } {
  const keyframe = template.colorKeyframes[keyIndex] ?? { r: 0, g: 0, b: 0, frame: 0 };
  return {
    color: {
      red: keyframe.r / 255,
      green: keyframe.g / 255,
      blue: keyframe.b / 255,
    },
    frame: keyframe.frame,
  };
}

function resolveTargetKey(keyframes: readonly { frame: number }[], age: number): number {
  for (let index = 0; index < keyframes.length; index += 1) {
    if (age <= (keyframes[index]?.frame ?? 0)) {
      return index;
    }
  }
  return Math.max(0, keyframes.length - 1);
}

function buildParticleState(
  system: ParticleSystemInstanceSaveState,
  particleIndex: number,
): SourceParticleState {
  const base = particleIndex * 20;
  const prevBase = particleIndex * 3;
  const data = system.particles;
  const alphaFactor = data[base + 19] ?? 0;
  const lifetime = Math.max(0, Math.round(data[base + 12] ?? 0));
  const age = Math.max(0, Math.round(data[base + 11] ?? 0));
  const lifetimeLeft = Math.max(1, lifetime - age + 1);
  const lastPosition = system.prevPositions
    ? {
        x: system.prevPositions[prevBase] ?? data[base] ?? 0,
        y: system.prevPositions[prevBase + 1] ?? data[base + 1] ?? 0,
        z: system.prevPositions[prevBase + 2] ?? data[base + 2] ?? 0,
      }
    : {
        x: data[base] ?? 0,
        y: data[base + 1] ?? 0,
        z: data[base + 2] ?? 0,
      };

  return {
    velocity: {
      x: data[base + 3] ?? 0,
      y: data[base + 4] ?? 0,
      z: data[base + 5] ?? 0,
    },
    position: {
      x: data[base] ?? 0,
      y: data[base + 1] ?? 0,
      z: data[base + 2] ?? 0,
    },
    emitterPosition: system.position,
    velocityDamping: data[base + 17] ?? 1,
    angleZ: data[base + 13] ?? 0,
    angularRateZ: data[base + 14] ?? 0,
    lifetime,
    size: data[base + 10] ?? 0,
    sizeRate: data[base + 15] ?? 0,
    sizeRateDamping: data[base + 16] ?? 1,
    alphaKeys: Array.from(
      { length: MAX_PARTICLE_KEYFRAMES },
      (_, index) => alphaKeyValueForParticle(system.template, index, alphaFactor),
    ),
    colorKeys: Array.from(
      { length: MAX_PARTICLE_KEYFRAMES },
      (_, index) => colorKeyForParticle(system.template, index),
    ),
    particleUpTowardsEmitter: system.template.isParticleUpTowardsEmitter,
    windRandomness: 1,
    personality: 0,
    acceleration: {
      x: 0,
      y: 0,
      z: 0,
    },
    lastPosition,
    lifetimeLeft,
    createTimestamp: Math.max(0, system.systemAge - age),
    alpha: data[base + 6] ?? 0,
    alphaRate: 0,
    alphaTargetKey: resolveTargetKey(system.template.alphaKeyframes, age),
    color: {
      red: data[base + 7] ?? 0,
      green: data[base + 8] ?? 0,
      blue: data[base + 9] ?? 0,
    },
    colorRate: { red: 0, green: 0, blue: 0 },
    colorTargetKey: resolveTargetKey(system.template.colorKeyframes, age),
    systemUnderControlId: system.attachedParticleSystems.find(([index]) => index === particleIndex)?.[1] ?? null,
  };
}

function xferParticleState(xfer: Xfer, particle: SourceParticleState): SourceParticleState {
  const particleVersion = xfer.xferVersion(1);
  if (particleVersion !== 1) {
    throw new Error(`Unsupported particle snapshot version ${particleVersion}`);
  }
  const infoVersion = xfer.xferVersion(1);
  if (infoVersion !== 1) {
    throw new Error(`Unsupported particle info snapshot version ${infoVersion}`);
  }

  const velocity = xfer.xferCoord3D(particle.velocity);
  const position = xfer.xferCoord3D(particle.position);
  const emitterPosition = xfer.xferCoord3D(particle.emitterPosition);
  const velocityDamping = xfer.xferReal(particle.velocityDamping);
  const angleX = xfer.xferReal(0);
  const angleY = xfer.xferReal(0);
  const angleZ = xfer.xferReal(particle.angleZ);
  const angularRateX = xfer.xferReal(0);
  const angularRateY = xfer.xferReal(0);
  const angularRateZ = xfer.xferReal(particle.angularRateZ);
  const lifetime = xfer.xferUnsignedInt(particle.lifetime);
  const size = xfer.xferReal(particle.size);
  const sizeRate = xfer.xferReal(particle.sizeRate);
  const sizeRateDamping = xfer.xferReal(particle.sizeRateDamping);

  const alphaKeys: SourceParticleState['alphaKeys'] = [];
  for (let index = 0; index < MAX_PARTICLE_KEYFRAMES; index += 1) {
    const keyframe = particle.alphaKeys[index] ?? { value: 0, frame: 0 };
    alphaKeys.push({
      value: xfer.xferReal(keyframe.value),
      frame: xfer.xferUnsignedInt(keyframe.frame),
    });
  }

  const colorKeys: SourceParticleState['colorKeys'] = [];
  for (let index = 0; index < MAX_PARTICLE_KEYFRAMES; index += 1) {
    const keyframe = particle.colorKeys[index] ?? { color: { red: 0, green: 0, blue: 0 }, frame: 0 };
    colorKeys.push({
      color: {
        red: xfer.xferReal(keyframe.color.red),
        green: xfer.xferReal(keyframe.color.green),
        blue: xfer.xferReal(keyframe.color.blue),
      },
      frame: xfer.xferUnsignedInt(keyframe.frame),
    });
  }

  const colorScale = xfer.xferReal(1);
  const particleUpTowardsEmitter = xfer.xferBool(particle.particleUpTowardsEmitter);
  const windRandomness = xfer.xferReal(particle.windRandomness);
  const personality = xfer.xferUnsignedInt(particle.personality);
  const acceleration = xfer.xferCoord3D(particle.acceleration);
  const lastPosition = xfer.xferCoord3D(particle.lastPosition);
  const lifetimeLeft = xfer.xferUnsignedInt(particle.lifetimeLeft);
  const createTimestamp = xfer.xferUnsignedInt(particle.createTimestamp);
  const alpha = xfer.xferReal(particle.alpha);
  const alphaRate = xfer.xferReal(particle.alphaRate);
  const alphaTargetKey = xfer.xferInt(particle.alphaTargetKey);
  const color = {
    red: xfer.xferReal(particle.color.red),
    green: xfer.xferReal(particle.color.green),
    blue: xfer.xferReal(particle.color.blue),
  };
  const colorRate = {
    red: xfer.xferReal(particle.colorRate.red),
    green: xfer.xferReal(particle.colorRate.green),
    blue: xfer.xferReal(particle.colorRate.blue),
  };
  const colorTargetKey = xfer.xferInt(particle.colorTargetKey);
  xfer.xferUnsignedInt(INVALID_DRAWABLE_ID);
  const systemUnderControlId = xfer.xferUnsignedInt(particle.systemUnderControlId ?? INVALID_ID);

  void angleX;
  void angleY;
  void angularRateX;
  void angularRateY;
  void colorScale;

  return {
    velocity,
    position,
    emitterPosition,
    velocityDamping,
    angleZ,
    angularRateZ,
    lifetime,
    size,
    sizeRate,
    sizeRateDamping,
    alphaKeys,
    colorKeys,
    particleUpTowardsEmitter,
    windRandomness,
    personality,
    acceleration,
    lastPosition,
    lifetimeLeft,
    createTimestamp,
    alpha,
    alphaRate,
    alphaTargetKey,
    color,
    colorRate,
    colorTargetKey,
    systemUnderControlId: systemUnderControlId === INVALID_ID ? null : systemUnderControlId,
  };
}

function sourceParticleToSavedParticle(
  template: ParticleSystemTemplate,
  particle: SourceParticleState,
): { values: number[]; prevPosition: number[]; attachedSystemId: number | null } {
  const firstAlphaKey = particle.alphaKeys[0] ?? { value: 0, frame: 0 };
  const templateFirstKey = template.alphaKeyframes[0] ?? { alphaMin: 0, alphaMax: 0, frame: 0 };
  const alphaSpan = templateFirstKey.alphaMax - templateFirstKey.alphaMin;
  const alphaFactor = alphaSpan === 0
    ? 0
    : clamp((firstAlphaKey.value - templateFirstKey.alphaMin) / alphaSpan, 0, 1);

  const age = Math.max(0, particle.lifetime - particle.lifetimeLeft + 1);
  return {
    values: [
      particle.position.x,
      particle.position.y,
      particle.position.z,
      particle.velocity.x,
      particle.velocity.y,
      particle.velocity.z,
      particle.alpha,
      particle.color.red,
      particle.color.green,
      particle.color.blue,
      particle.size,
      age,
      particle.lifetime,
      particle.angleZ,
      particle.angularRateZ,
      particle.sizeRate,
      particle.sizeRateDamping,
      particle.velocityDamping,
      template.angularDamping.min,
      alphaFactor,
    ],
    prevPosition: [
      particle.lastPosition.x,
      particle.lastPosition.y,
      particle.lastPosition.z,
    ],
    attachedSystemId: particle.systemUnderControlId,
  };
}

export class SourceParticleSystemSnapshot implements Snapshot {
  payload: ParticleSystemManagerSaveState;

  constructor(
    state: ParticleSystemManagerSaveState = {
      version: 1,
      nextId: 1,
      systems: [],
    },
  ) {
    this.payload = state;
  }

  crc(_xfer: Xfer): void {}

  xfer(xfer: Xfer): void {
    if (xfer.getMode() === XferMode.XFER_LOAD) {
      const payloadBytes = xfer.xferUser(new Uint8Array(0));
      const parsed = parseSourceParticleSystemChunk(payloadBytes);
      if (parsed === null) {
        throw new Error('Unsupported source particle-system snapshot payload.');
      }
      this.payload = parsed;
      return;
    }

    const version = xfer.xferVersion(SOURCE_PARTICLE_SYSTEM_SNAPSHOT_VERSION);
    if (version !== SOURCE_PARTICLE_SYSTEM_SNAPSHOT_VERSION) {
      throw new Error(`Unsupported particle-system snapshot version ${version}`);
    }

    const uniqueSystemId = xfer.xferUnsignedInt(Math.max(0, this.payload.nextId - 1));
    const systemCount = xfer.xferUnsignedInt(this.payload.systems.length);
    void uniqueSystemId;
    void systemCount;

    for (const system of this.payload.systems) {
      xfer.xferAsciiString(system.template.name);
      xfer.xferVersion(1);
      const hydratedTemplate = xferTemplateInfo(xfer, system.template, system);
      xfer.xferUnsignedInt(system.id);
      xfer.xferUnsignedInt(INVALID_DRAWABLE_ID);
      xfer.xferUnsignedInt(INVALID_ID);
      xfer.xferBool(true);
      xferRawMatrix3D(xfer, quaternionToMatrixRows(system.position, system.orientation, false));
      xfer.xferBool(true);
      xferRawMatrix3D(xfer, quaternionToMatrixRows(system.position, system.orientation, true));
      xfer.xferUnsignedInt(Math.max(0, system.burstTimer));
      xfer.xferUnsignedInt(Math.max(0, system.initialDelayRemaining));
      xfer.xferUnsignedInt(Math.max(0, system.systemAge));
      xfer.xferUnsignedInt(
        hydratedTemplate.systemLifetime > 0
          ? Math.max(0, hydratedTemplate.systemLifetime - system.systemAge)
          : 0,
      );
      xfer.xferUnsignedInt(0);
      xfer.xferBool(hydratedTemplate.systemLifetime === 0);
      xfer.xferReal(0);
      xfer.xferBool(!system.alive);
      xfer.xferCoord3D({ x: 0, y: 0, z: 0 });
      xfer.xferReal(1);
      xfer.xferReal(1);
      xfer.xferReal(1);
      xfer.xferCoord3D(system.position);
      xfer.xferCoord3D(system.position);
      xfer.xferBool(system.particleCount === 0);
      xfer.xferUnsignedInt(system.slaveSystemId ?? INVALID_ID);
      xfer.xferUnsignedInt(system.masterSystemId ?? INVALID_ID);
      xfer.xferUnsignedInt(system.particleCount);

      for (let index = 0; index < system.particleCount; index += 1) {
        const particle = buildParticleState(system, index);
        xferParticleState(xfer, particle);
      }
    }
  }

  loadPostProcess(): void {}
}

export function parseSourceParticleSystemChunk(
  chunkData: ArrayBuffer | Uint8Array,
): ParticleSystemManagerSaveState | null {
  const xferLoad = new XferLoad(copyChunkBytes(chunkData));
  xferLoad.open('parse-source-particle-system-state');
  try {
    const version = xferLoad.xferVersion(SOURCE_PARTICLE_SYSTEM_SNAPSHOT_VERSION);
    if (version !== SOURCE_PARTICLE_SYSTEM_SNAPSHOT_VERSION) {
      return null;
    }

    const uniqueSystemId = xferLoad.xferUnsignedInt(0);
    const systemCount = xferLoad.xferUnsignedInt(0);
    const systems: ParticleSystemInstanceSaveState[] = [];
    for (let systemIndex = 0; systemIndex < systemCount; systemIndex += 1) {
      const templateName = xferLoad.xferAsciiString('');
      if (templateName.length === 0) {
        continue;
      }

      const systemVersion = xferLoad.xferVersion(1);
      if (systemVersion !== 1) {
        return null;
      }
      const template = xferTemplateInfo(xferLoad, {
        name: templateName,
        priority: 'NONE',
        isOneShot: false,
        shader: 'ALPHA',
        type: 'PARTICLE',
        particleName: '',
        angleZ: { min: 0, max: 0 },
        angularRateZ: { min: 0, max: 0 },
        angularDamping: { min: 1, max: 1 },
        velocityDamping: { min: 1, max: 1 },
        gravity: 0,
        lifetime: { min: 0, max: 0 },
        systemLifetime: 0,
        size: { min: 0, max: 0 },
        startSizeRate: { min: 0, max: 0 },
        sizeRate: { min: 0, max: 0 },
        sizeRateDamping: { min: 1, max: 1 },
        alphaKeyframes: [],
        colorKeyframes: [],
        colorScale: { min: 0, max: 0 },
        burstDelay: { min: 0, max: 0 },
        burstCount: { min: 0, max: 0 },
        initialDelay: { min: 0, max: 0 },
        driftVelocity: { x: 0, y: 0, z: 0 },
        velocityType: 'ORTHO',
        velOrtho: {
          x: { min: 0, max: 0 },
          y: { min: 0, max: 0 },
          z: { min: 0, max: 0 },
        },
        velOutward: { min: 0, max: 0 },
        velOutwardOther: { min: 0, max: 0 },
        velSpherical: { min: 0, max: 0 },
        velHemispherical: { min: 0, max: 0 },
        velCylindrical: {
          radial: { min: 0, max: 0 },
          normal: { min: 0, max: 0 },
        },
        volumeType: 'POINT',
        volLineStart: { x: 0, y: 0, z: 0 },
        volLineEnd: { x: 0, y: 0, z: 0 },
        volBoxHalfSize: { x: 0, y: 0, z: 0 },
        volSphereRadius: 0,
        volCylinderRadius: 0,
        volCylinderLength: 0,
        isHollow: false,
        isGroundAligned: false,
        isEmitAboveGroundOnly: false,
        isParticleUpTowardsEmitter: false,
        windMotion: 'Unused',
        windAngleChangeMin: 0.15,
        windAngleChangeMax: 0.45,
        windPingPongStartAngleMin: 0,
        windPingPongStartAngleMax: Math.PI / 4,
        windPingPongEndAngleMin: 5.5,
        windPingPongEndAngleMax: Math.PI * 2,
      }, {
        windAngle: 0,
        windAngleChange: 0,
        windMotionMovingToEnd: true,
        windPingPongTargetAngle: 0,
      });

      const id = xferLoad.xferUnsignedInt(0);
      xferLoad.xferUnsignedInt(INVALID_DRAWABLE_ID);
      xferLoad.xferUnsignedInt(INVALID_ID);
      xferLoad.xferBool(true);
      xferRawMatrix3D(xferLoad, new Array<number>(12).fill(0));
      xferLoad.xferBool(true);
      const transformRows = xferRawMatrix3D(xferLoad, new Array<number>(12).fill(0));
      const burstTimer = xferLoad.xferUnsignedInt(0);
      const initialDelayRemaining = xferLoad.xferUnsignedInt(0);
      const systemAge = xferLoad.xferUnsignedInt(0);
      xferLoad.xferUnsignedInt(0);
      xferLoad.xferUnsignedInt(0);
      xferLoad.xferBool(false);
      xferLoad.xferReal(0);
      const destroyed = xferLoad.xferBool(false);
      xferLoad.xferCoord3D({ x: 0, y: 0, z: 0 });
      xferLoad.xferReal(1);
      xferLoad.xferReal(1);
      xferLoad.xferReal(1);
      const position = xferLoad.xferCoord3D({ x: 0, y: 0, z: 0 });
      xferLoad.xferCoord3D(position);
      xferLoad.xferBool(false);
      const slaveSystemId = xferLoad.xferUnsignedInt(INVALID_ID);
      const masterSystemId = xferLoad.xferUnsignedInt(INVALID_ID);
      const particleCount = xferLoad.xferUnsignedInt(0);

      const particleValues: number[] = [];
      const prevPositions: number[] = [];
      const attachedParticleSystems: Array<[number, number]> = [];
      for (let particleIndex = 0; particleIndex < particleCount; particleIndex += 1) {
        const particle = xferParticleState(xferLoad, {
          velocity: { x: 0, y: 0, z: 0 },
          position: { x: 0, y: 0, z: 0 },
          emitterPosition: position,
          velocityDamping: 1,
          angleZ: 0,
          angularRateZ: 0,
          lifetime: 0,
          size: 0,
          sizeRate: 0,
          sizeRateDamping: 1,
          alphaKeys: [],
          colorKeys: [],
          particleUpTowardsEmitter: false,
          windRandomness: 1,
          personality: 0,
          acceleration: { x: 0, y: 0, z: 0 },
          lastPosition: { x: 0, y: 0, z: 0 },
          lifetimeLeft: 1,
          createTimestamp: 0,
          alpha: 0,
          alphaRate: 0,
          alphaTargetKey: 0,
          color: { red: 0, green: 0, blue: 0 },
          colorRate: { red: 0, green: 0, blue: 0 },
          colorTargetKey: 0,
          systemUnderControlId: null,
        });
        const savedParticle = sourceParticleToSavedParticle(template, particle);
        particleValues.push(...savedParticle.values);
        prevPositions.push(...savedParticle.prevPosition);
        if (savedParticle.attachedSystemId !== null) {
          attachedParticleSystems.push([particleIndex, savedParticle.attachedSystemId]);
        }
      }

      systems.push({
        id,
        template,
        position,
        orientation: matrixRowsToQuaternion(transformRows),
        particleCount,
        particles: particleValues,
        burstTimer,
        systemAge,
        initialDelayRemaining,
        alive: !destroyed,
        windAngle: 0,
        windAngleChange: template.windAngleChangeMin,
        windMotionMovingToEnd: true,
        windPingPongTargetAngle: template.windPingPongEndAngleMin,
        slaveSystemId: slaveSystemId === INVALID_ID ? null : slaveSystemId,
        masterSystemId: masterSystemId === INVALID_ID ? null : masterSystemId,
        attachedParticleSystems,
        prevPositions: prevPositions.length > 0 ? prevPositions : null,
      });
    }

    return {
      version: 1,
      nextId: uniqueSystemId + 1,
      systems,
    };
  } catch {
    return null;
  } finally {
    xferLoad.close();
  }
}
