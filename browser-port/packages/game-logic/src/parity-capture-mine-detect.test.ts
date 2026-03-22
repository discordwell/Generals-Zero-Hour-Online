/**
 * Parity tests for:
 *   1. Building capture via SpecialAbilityUpdate — timed capture with progress
 *      and ownership transfer on completion.
 *   2. Mine detection — stealthed mines are revealed by detector units.
 *
 * Source references:
 *   SpecialAbilityUpdate.cpp — SPECIAL_INFANTRY_CAPTURE_BUILDING / SPECIAL_BLACKLOTUS_CAPTURE_BUILDING
 *     triggers Object::defect() after preparation timer completes.
 *   DetectorUpdate.cpp — scans all STEALTHED entities (including MINE KindOf) within detection range.
 */

import { describe, expect, it } from 'vitest';

import {
  createParityAgent,
  makeBlock,
  makeObjectDef,
  makeSpecialPowerDef,
  place,
} from './parity-agent.js';

// ── Test 1: Capture Building Progress and Completion ─────────────────────────

describe('Parity: capture building progress and completion', () => {
  function makeCaptureAgent() {
    return createParityAgent({
      bundles: {
        objects: [
          makeObjectDef('Ranger', 'America', ['INFANTRY'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
            // Source parity: SpecialAbilityUpdate is the module that gets extracted into
            // specialPowerModules (SPECIALABILITY is skipped since it's not in the valid list).
            makeBlock('Behavior', 'SpecialAbilityUpdate ModuleTag_SA', {
              SpecialPowerTemplate: 'SpecialAbilityCapture',
              StartAbilityRange: 50,
              PreparationTime: 1000, // ~30 frames at 30fps
            }),
          ]),
          makeObjectDef('EnemyBuilding', 'China', ['STRUCTURE', 'CAPTURABLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
          ]),
        ],
        specialPowers: [
          makeSpecialPowerDef('SpecialAbilityCapture', {
            ReloadTime: 15000,
            Enum: 'SPECIAL_INFANTRY_CAPTURE_BUILDING',
          }),
        ],
      },
      // Place ranger right next to the building (within StartAbilityRange=50).
      mapObjects: [
        place('Ranger', 20, 20),       // id 1
        place('EnemyBuilding', 25, 20), // id 2
      ],
      mapSize: 64,
      sides: { America: {}, China: {} },
      enemies: [['America', 'China']],
    });
  }

  it('building capturePercent starts at -1 (not being captured)', () => {
    const agent = makeCaptureAgent();
    const building = agent.entity(2)!;
    expect(building.side.toLowerCase()).toBe('china');
    const state = agent.gameLogic.getEntityState(2)!;
    expect(state.capturePercent).toBe(-1);
  });

  it('capture command activates SpecialAbilityUpdate state machine', () => {
    const agent = makeCaptureAgent();
    const rangerInternal = (agent.gameLogic as any).spawnedEntities.get(1);

    // Verify module extraction.
    const captureModule = rangerInternal.specialPowerModules.get('SPECIALABILITYCAPTURE');
    expect(captureModule).toBeDefined();
    expect(captureModule.moduleType).toBe('SPECIALABILITYUPDATE');
    expect(rangerInternal.specialAbilityProfile).not.toBeNull();
    expect(rangerInternal.specialAbilityState.active).toBe(false);

    // Set player type to COMPUTER so shroud gate doesn't block the command.
    agent.gameLogic.submitCommand({ type: 'setSidePlayerType', side: 'America', playerType: 'COMPUTER' });
    agent.step(1);

    agent.gameLogic.submitCommand({
      type: 'issueSpecialPower',
      commandButtonId: 'CMD_CAPTURE',
      specialPowerName: 'SpecialAbilityCapture',
      commandOption: 0x01,
      issuingEntityIds: [1],
      sourceEntityId: 1,
      targetEntityId: 2,
      targetX: null,
      targetZ: null,
    });
    agent.step(1);

    expect(rangerInternal.lastSpecialPowerDispatch).not.toBeNull();
    expect(rangerInternal.specialAbilityState.active).toBe(true);
  });

  it('capture building shows progress during preparation and transfers ownership on completion', () => {
    const agent = makeCaptureAgent();

    // Verify initial state.
    expect(agent.entity(2)!.side.toLowerCase()).toBe('china');

    // Set player type to COMPUTER to bypass shroud gate.
    agent.gameLogic.submitCommand({ type: 'setSidePlayerType', side: 'America', playerType: 'COMPUTER' });
    agent.step(1);

    // Issue capture command.
    agent.gameLogic.submitCommand({
      type: 'issueSpecialPower',
      commandButtonId: 'CMD_CAPTURE',
      specialPowerName: 'SpecialAbilityCapture',
      commandOption: 0x01, // COMMAND_OPTION_NEED_OBJECT_TARGET
      issuingEntityIds: [1],
      sourceEntityId: 1,
      targetEntityId: 2,
      targetX: null,
      targetZ: null,
    });

    // Step 1 frame to process command and start state machine.
    agent.step(1);

    const rangerInternal = (agent.gameLogic as any).spawnedEntities.get(1);
    expect(rangerInternal.specialAbilityState).not.toBeNull();
    expect(rangerInternal.specialAbilityState.active).toBe(true);

    // Step partway through the preparation.
    // PreparationTime=1000ms => ~30 frames. Step 15 frames to be ~50%.
    agent.step(15);

    const buildingMid = agent.gameLogic.getEntityState(2)!;
    expect(buildingMid.capturePercent).toBeGreaterThan(0);
    expect(buildingMid.capturePercent).toBeLessThan(100);
    // Building should still be Chinese.
    expect(buildingMid.side.toLowerCase()).toBe('china');

    // Step through the rest of the preparation (need ~15 more frames plus some margin).
    agent.step(30);

    // After completion, building should belong to America (sides are normalized to lowercase).
    const buildingFinal = agent.gameLogic.getEntityState(2)!;
    expect(buildingFinal.side.toLowerCase()).toBe('america');
    expect(buildingFinal.side.toLowerCase()).not.toBe('china');
    // Capture percent should reset to -1 after completion.
    expect(buildingFinal.capturePercent).toBe(-1);
  });

  it('capturePercent resets when ability is aborted (entity dies)', () => {
    const agent = makeCaptureAgent();

    // Set player type to COMPUTER to bypass shroud gate.
    agent.gameLogic.submitCommand({ type: 'setSidePlayerType', side: 'America', playerType: 'COMPUTER' });
    agent.step(1);

    // Issue capture command.
    agent.gameLogic.submitCommand({
      type: 'issueSpecialPower',
      commandButtonId: 'CMD_CAPTURE',
      specialPowerName: 'SpecialAbilityCapture',
      commandOption: 0x01,
      issuingEntityIds: [1],
      sourceEntityId: 1,
      targetEntityId: 2,
      targetX: null,
      targetZ: null,
    });

    agent.step(1);
    // Step a few frames into preparation.
    agent.step(10);

    const buildingDuring = agent.gameLogic.getEntityState(2)!;
    expect(buildingDuring.capturePercent).toBeGreaterThan(0);

    // Kill the ranger to abort the capture.
    const rangerInternal = (agent.gameLogic as any).spawnedEntities.get(1);
    rangerInternal.health = 0;
    rangerInternal.destroyed = true;

    // Step to process death and cleanup.
    agent.step(2);

    const buildingAfter = agent.gameLogic.getEntityState(2)!;
    // Should still be Chinese.
    expect(buildingAfter.side.toLowerCase()).toBe('china');
    // Capture percent should reset.
    expect(buildingAfter.capturePercent).toBe(-1);
  });
});

// ── Test 2: Mine Detection by Detector Units ─────────────────────────────────

describe('Parity: mine detection by detector units', () => {
  it('detector unit reveals stealthed mines within detection range', () => {
    const agent = createParityAgent({
      bundles: {
        objects: [
          // Detector unit with StealthDetectorUpdate.
          makeObjectDef('Detector', 'America', ['VEHICLE', 'DETECTOR'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
            makeBlock('Behavior', 'StealthDetectorUpdate ModuleTag_Detector', {
              DetectionRate: 100, // ~3 frames
              DetectionRange: 100,
            }),
          ], { VisionRange: 150, ShroudClearingRange: 150 }),
          // Mine with stealth (innate).
          makeObjectDef('Mine', 'China', ['MINE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 10, InitialHealth: 10 }),
            makeBlock('Behavior', 'StealthUpdate ModuleTag_Stealth', {
              InnateStealth: 'Yes',
              StealthDelay: 0,
            }),
          ]),
        ],
      },
      mapObjects: [
        place('Detector', 20, 20), // id 1
        place('Mine', 30, 20),     // id 2 — within detection range (dist=10)
      ],
      mapSize: 64,
      sides: { America: {}, China: {} },
      enemies: [['America', 'China']],
    });

    // Step enough for stealth to engage and detection to scan.
    agent.step(10);

    const mineState = agent.gameLogic.getEntityState(2)!;
    const flags = mineState.statusFlags;

    // Mine should be STEALTHED (has innate stealth).
    expect(flags).toContain('STEALTHED');
    // Mine should be DETECTED (detector is within range).
    expect(flags).toContain('DETECTED');
  });

  it('stealthed mine outside detection range is NOT detected', () => {
    const agent = createParityAgent({
      bundles: {
        objects: [
          makeObjectDef('Detector', 'America', ['VEHICLE', 'DETECTOR'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
            makeBlock('Behavior', 'StealthDetectorUpdate ModuleTag_Detector', {
              DetectionRate: 100,
              DetectionRange: 20, // Short detection range.
            }),
          ], { VisionRange: 150, ShroudClearingRange: 150 }),
          makeObjectDef('Mine', 'China', ['MINE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 10, InitialHealth: 10 }),
            makeBlock('Behavior', 'StealthUpdate ModuleTag_Stealth', {
              InnateStealth: 'Yes',
              StealthDelay: 0,
            }),
          ]),
        ],
      },
      mapObjects: [
        place('Detector', 20, 20), // id 1
        place('Mine', 60, 20),     // id 2 — outside detection range (dist=40 > 20)
      ],
      mapSize: 64,
      sides: { America: {}, China: {} },
      enemies: [['America', 'China']],
    });

    agent.step(10);

    const mineState = agent.gameLogic.getEntityState(2)!;
    const flags = mineState.statusFlags;

    // Mine should be STEALTHED.
    expect(flags).toContain('STEALTHED');
    // Mine should NOT be DETECTED (too far away).
    expect(flags).not.toContain('DETECTED');
  });
});
