/**
 * Parity test: WaveGuideUpdate FieldParse fields (15 fields)
 *
 * Verifies that the TypeScript extractWaveGuideProfile() correctly parses all 15
 * WaveGuideUpdate fields from the retail INI data, matching the C++ FieldParse
 * table in WaveGuideUpdate.cpp lines 86–105.
 *
 * Tests cover:
 * 1. WaveGuide object — retail dam-break wave guide (all 15 fields populated)
 * 2. WaveGuideGLA01 object — GLA Sneak Attack variant (different values)
 * 3. Object without WaveGuideUpdate — returns null
 * 4. Unit conversions — parseDurationReal, parseVelocityReal, parseAngleReal
 */
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GameLogicSubsystem, LOGIC_FRAME_RATE } from './index.js';
import { IniDataRegistry } from '@generals/ini-data';
import { HeightmapGrid, type MapDataJSON } from '@generals/terrain';

const ASSETS_DIR = resolve(import.meta.dirname ?? __dirname, '../../app/public/assets');

let iniRegistry: IniDataRegistry;
let mapData: MapDataJSON;

function loadRetailData(): boolean {
  try {
    const bundleJson = JSON.parse(readFileSync(resolve(ASSETS_DIR, 'data/ini-bundle.json'), 'utf-8'));
    iniRegistry = new IniDataRegistry();
    iniRegistry.loadBundle(bundleJson);
    mapData = JSON.parse(readFileSync(
      resolve(ASSETS_DIR, 'maps/_extracted/MapsZH/Maps/Tournament Desert/Tournament Desert.json'), 'utf-8',
    ));
    return true;
  } catch { return false; }
}

const hasRetailData = loadRetailData();

function createFreshGame(credits = 50000): GameLogicSubsystem {
  const logic = new GameLogicSubsystem(new THREE.Scene(), {
    multipleFactory: 0.85,
  });
  const heightmap = HeightmapGrid.fromJSON(mapData.heightmap);
  logic.loadMapObjects(mapData, iniRegistry, heightmap);
  logic.setPlayerSide(0, 'America');
  logic.setPlayerSide(1, 'China');
  logic.setTeamRelationship('America', 'China', 0);
  logic.setTeamRelationship('China', 'America', 0);
  logic.spawnSkirmishStartingEntities();
  logic.submitCommand({ type: 'setSideCredits', side: 'America', amount: credits });
  logic.submitCommand({ type: 'setSideCredits', side: 'China', amount: credits });
  logic.update(0);
  logic.update(1 / 30);
  return logic;
}

// ---------------------------------------------------------------------------
// Unit conversion helpers for expected values
// ---------------------------------------------------------------------------

/** parseDurationReal: milliseconds → logic frames (ms / 1000 * 30) */
function msToFrames(ms: number): number {
  return Math.ceil(ms / 1000 * LOGIC_FRAME_RATE);
}

/** parseVelocityReal: units/sec → units/frame (÷ LOGIC_FRAME_RATE) */
function velocityToPerFrame(unitsPerSec: number): number {
  return unitsPerSec / LOGIC_FRAME_RATE;
}

/** parseAngleReal: degrees → radians */
function degreesToRadians(degrees: number): number {
  return degrees * Math.PI / 180;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe.skipIf(!hasRetailData)('WaveGuideUpdate field extraction (retail data)', () => {

  it('extracts WaveGuide profile with all 15 fields from retail WaveGuide object', () => {
    const logic = createFreshGame();
    // Spawn the WaveGuide object
    const entityId = (logic as any).spawnEntityFromTemplate(
      'WaveGuide', 100, 100, 0, undefined,
    );
    expect(entityId).toBeTruthy();
    const entity = (logic as any).spawnedEntities.get(entityId.id);
    expect(entity).toBeTruthy();
    const prof = entity.waveGuideProfile;
    expect(prof).not.toBeNull();

    // From retail INI data for WaveGuide:
    // WaveDelay = 750 (ms)
    expect(prof.waveDelayFrames).toBe(msToFrames(750));
    // YSize = 650
    expect(prof.ySize).toBe(650);
    // LinearWaveSpacing = 15
    expect(prof.linearWaveSpacing).toBe(15);
    // WaveBendMagnitude = 500
    expect(prof.waveBendMagnitude).toBe(500);
    // WaterVelocity = 2.7 (units/sec → units/frame)
    expect(prof.waterVelocity).toBeCloseTo(velocityToPerFrame(2.7), 6);
    // PreferredHeight = 37.3
    expect(prof.preferredHeight).toBeCloseTo(37.3, 6);
    // ShorelineEffectDistance = 5
    expect(prof.shorelineEffectDistance).toBe(5);
    // DamageRadius = 25
    expect(prof.damageRadius).toBe(25);
    // DamageAmount = 99999
    expect(prof.damageAmount).toBe(99999);
    // ToppleForce = 0.25
    expect(prof.toppleForce).toBeCloseTo(0.25, 6);
    // RandomSplashSound = 'WaveRandomSplash'
    expect(prof.randomSplashSound).toBe('WaveRandomSplash');
    // RandomSplashSoundFrequency = 50
    expect(prof.randomSplashSoundFrequency).toBe(50);
    // BridgeParticle = 'WaveHitBridge01'
    expect(prof.bridgeParticle).toBe('WaveHitBridge01');
    // BridgeParticleAngleFudge = -95 (degrees → radians)
    expect(prof.bridgeParticleAngleFudge).toBeCloseTo(degreesToRadians(-95), 6);
    // LoopingSound = 'DamBreakWaveLoop'
    expect(prof.loopingSound).toBe('DamBreakWaveLoop');
  });

  it('extracts WaveGuideGLA01 profile with different values', () => {
    const logic = createFreshGame();
    const entityId = (logic as any).spawnEntityFromTemplate(
      'WaveGuideGLA01', 100, 100, 0, undefined,
    );
    expect(entityId).toBeTruthy();
    const entity = (logic as any).spawnedEntities.get(entityId.id);
    expect(entity).toBeTruthy();
    const prof = entity.waveGuideProfile;
    expect(prof).not.toBeNull();

    // From retail INI data for WaveGuideGLA01:
    // WaterVelocity = 1 (different from WaveGuide's 2.7)
    expect(prof.waterVelocity).toBeCloseTo(velocityToPerFrame(1), 6);
    // PreferredHeight = 35 (different from WaveGuide's 37.3)
    expect(prof.preferredHeight).toBe(35);
    // Same shared fields as WaveGuide
    expect(prof.waveDelayFrames).toBe(msToFrames(750));
    expect(prof.damageAmount).toBe(99999);
    expect(prof.damageRadius).toBe(25);
    expect(prof.toppleForce).toBeCloseTo(0.25, 6);
    expect(prof.randomSplashSound).toBe('WaveRandomSplash');
    expect(prof.loopingSound).toBe('DamBreakWaveLoop');
  });

  it('returns null for objects without WaveGuideUpdate module', () => {
    const logic = createFreshGame();
    // AmericaTankCrusader is a normal tank — no WaveGuideUpdate module
    const entityId = (logic as any).spawnEntityFromTemplate(
      'AmericaTankCrusader', 100, 100, 0, 'America',
    );
    expect(entityId).toBeTruthy();
    const entity = (logic as any).spawnedEntities.get(entityId.id);
    expect(entity).toBeTruthy();
    expect(entity.waveGuideProfile).toBeNull();
  });

  it('correctly converts parseDurationReal (WaveDelay ms → frames)', () => {
    const logic = createFreshGame();
    const entityId = (logic as any).spawnEntityFromTemplate(
      'WaveGuide', 100, 100, 0, undefined,
    );
    const entity = (logic as any).spawnedEntities.get(entityId.id);
    const prof = entity.waveGuideProfile;
    // 750ms at 30fps = ceil(750/1000 * 30) = ceil(22.5) = 23 frames
    expect(prof.waveDelayFrames).toBe(23);
  });

  it('correctly converts parseVelocityReal (WaterVelocity units/sec → units/frame)', () => {
    const logic = createFreshGame();
    const entityId = (logic as any).spawnEntityFromTemplate(
      'WaveGuide', 100, 100, 0, undefined,
    );
    const entity = (logic as any).spawnedEntities.get(entityId.id);
    const prof = entity.waveGuideProfile;
    // 2.7 units/sec ÷ 30 fps = 0.09 units/frame
    expect(prof.waterVelocity).toBeCloseTo(2.7 / 30, 10);
  });

  it('correctly converts parseAngleReal (BridgeParticleAngleFudge degrees → radians)', () => {
    const logic = createFreshGame();
    const entityId = (logic as any).spawnEntityFromTemplate(
      'WaveGuide', 100, 100, 0, undefined,
    );
    const entity = (logic as any).spawnedEntities.get(entityId.id);
    const prof = entity.waveGuideProfile;
    // -95 degrees in radians
    expect(prof.bridgeParticleAngleFudge).toBeCloseTo(-95 * Math.PI / 180, 10);
  });

  it('all 15 fields are present and have correct types', () => {
    const logic = createFreshGame();
    const entityId = (logic as any).spawnEntityFromTemplate(
      'WaveGuide', 100, 100, 0, undefined,
    );
    const entity = (logic as any).spawnedEntities.get(entityId.id);
    const prof = entity.waveGuideProfile;
    expect(prof).not.toBeNull();

    // Verify all 15 fields exist and have correct types
    expect(typeof prof.waveDelayFrames).toBe('number');
    expect(typeof prof.ySize).toBe('number');
    expect(typeof prof.linearWaveSpacing).toBe('number');
    expect(typeof prof.waveBendMagnitude).toBe('number');
    expect(typeof prof.waterVelocity).toBe('number');
    expect(typeof prof.preferredHeight).toBe('number');
    expect(typeof prof.shorelineEffectDistance).toBe('number');
    expect(typeof prof.damageRadius).toBe('number');
    expect(typeof prof.damageAmount).toBe('number');
    expect(typeof prof.toppleForce).toBe('number');
    expect(typeof prof.randomSplashSound).toBe('string');
    expect(typeof prof.randomSplashSoundFrequency).toBe('number');
    expect(typeof prof.bridgeParticle).toBe('string');
    expect(typeof prof.bridgeParticleAngleFudge).toBe('number');
    expect(typeof prof.loopingSound).toBe('string');

    // Verify field count: exactly 15 keys
    expect(Object.keys(prof).length).toBe(15);
  });
});
