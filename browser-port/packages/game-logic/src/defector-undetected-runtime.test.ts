import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { GameLogicSubsystem } from './index.js';
import {
  makeBlock,
  makeBundle,
  makeHeightmap,
  makeMap,
  makeMapObject,
  makeObjectDef,
  makeRegistry,
  makeSpecialPowerDef,
  makeWeaponDef,
} from './test-helpers.js';

function makeDefectorRuntimeBundle(detectionTime = 5000) {
  return makeBundle({
    objects: [
      makeObjectDef('Defector', 'America', ['INFANTRY'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 50, InitialHealth: 50 }),
        makeBlock('Behavior', 'DefectorSpecialPower DefectModule', {
          SpecialPowerTemplate: 'SpecialPowerDefector',
        }),
      ]),
      makeObjectDef('EnemyConvert', 'China', ['VEHICLE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
        makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'TestGun'] }),
      ]),
      makeObjectDef('EnemyVictim', 'China', ['VEHICLE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
      ]),
    ],
    weapons: [
      makeWeaponDef('TestGun', {
        AttackRange: 120,
        PrimaryDamage: 30,
        DelayBetweenShots: 100,
      }),
    ],
    specialPowers: [
      makeSpecialPowerDef('SpecialPowerDefector', {
        ReloadTime: 0,
        DetectionTime: detectionTime,
        Enum: 'SPECIAL_DEFECTOR',
      }),
    ],
  });
}

describe('defector undetected runtime', () => {
  it('sets the source undetected-defector timer from DetectionTime and exposes the private-status bit', () => {
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([
        makeMapObject('Defector', 10, 10),
        makeMapObject('EnemyConvert', 20, 10),
        makeMapObject('EnemyVictim', 30, 10),
      ], 64, 64),
      makeRegistry(makeDefectorRuntimeBundle(5000)),
      makeHeightmap(64, 64),
    );
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);
    logic.submitCommand({ type: 'setSidePlayerType', side: 'America', playerType: 'COMPUTER' });
    logic.update(0);

    logic.submitCommand({
      type: 'issueSpecialPower',
      commandButtonId: 'CMD_DEFECT',
      specialPowerName: 'SpecialPowerDefector',
      commandOption: 0x01,
      issuingEntityIds: [1],
      sourceEntityId: 1,
      targetEntityId: 2,
      targetX: null,
      targetZ: null,
    });
    logic.update(0);

    const privateLogic = logic as unknown as {
      frameCounter: number;
      spawnedEntities: Map<number, any>;
      captureSourceObjectXferOverlayState: () => Array<{ entityId: number; privateStatus: number }>;
    };
    const converted = privateLogic.spawnedEntities.get(2);
    if (!converted) {
      throw new Error('Expected converted defector target');
    }

    expect(converted.side).toBe('america');
    expect(converted.capturedFromOriginalOwner).toBe(true);
    expect(converted.undetectedDefectorUntilFrame).toBeGreaterThan(privateLogic.frameCounter);
    expect(converted.defectorHelperDetectionStartFrame).toBe(privateLogic.frameCounter);
    expect(converted.defectorHelperDetectionEndFrame).toBe(converted.undetectedDefectorUntilFrame);
    expect(converted.defectorHelperFlashPhase).toBe(0);
    expect(converted.defectorHelperDoFx).toBe(true);

    const overlay = privateLogic.captureSourceObjectXferOverlayState().find((entry) => entry.entityId === 2);
    expect(overlay?.privateStatus & 0x02).toBe(0x02);
    expect(overlay?.privateStatus & 0x04).toBe(0x04);
  });

  it('clears undetected defector state when the converted unit attacks', () => {
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([
        makeMapObject('Defector', 10, 10),
        makeMapObject('EnemyConvert', 20, 10),
        makeMapObject('EnemyVictim', 30, 10),
      ], 64, 64),
      makeRegistry(makeDefectorRuntimeBundle(5000)),
      makeHeightmap(64, 64),
    );
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);
    logic.submitCommand({ type: 'setSidePlayerType', side: 'America', playerType: 'COMPUTER' });
    logic.update(0);

    logic.submitCommand({
      type: 'issueSpecialPower',
      commandButtonId: 'CMD_DEFECT',
      specialPowerName: 'SpecialPowerDefector',
      commandOption: 0x01,
      issuingEntityIds: [1],
      sourceEntityId: 1,
      targetEntityId: 2,
      targetX: null,
      targetZ: null,
    });
    logic.update(0);

    const privateLogic = logic as unknown as {
      spawnedEntities: Map<number, any>;
      captureSourceObjectXferOverlayState: () => Array<{ entityId: number; privateStatus: number }>;
    };
    const converted = privateLogic.spawnedEntities.get(2);
    if (!converted) {
      throw new Error('Expected converted defector target');
    }
    expect(converted.undetectedDefectorUntilFrame).toBeGreaterThan(0);

    logic.submitCommand({ type: 'attackEntity', entityId: 2, targetEntityId: 3 });
    logic.update(1 / 30);

    expect(converted.undetectedDefectorUntilFrame).toBe(0);
    const overlay = privateLogic.captureSourceObjectXferOverlayState().find((entry) => entry.entityId === 2);
    expect(overlay?.privateStatus & 0x02).toBe(0);
  });

  it('advances defector helper flash phase while the unit remains hidden', () => {
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([
        makeMapObject('Defector', 10, 10),
        makeMapObject('EnemyConvert', 20, 10),
      ], 64, 64),
      makeRegistry(makeDefectorRuntimeBundle(5000)),
      makeHeightmap(64, 64),
    );
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);
    logic.submitCommand({ type: 'setSidePlayerType', side: 'America', playerType: 'COMPUTER' });
    logic.update(0);

    logic.submitCommand({
      type: 'issueSpecialPower',
      commandButtonId: 'CMD_DEFECT',
      specialPowerName: 'SpecialPowerDefector',
      commandOption: 0x01,
      issuingEntityIds: [1],
      sourceEntityId: 1,
      targetEntityId: 2,
      targetX: null,
      targetZ: null,
    });
    logic.update(0);

    const privateLogic = logic as unknown as {
      spawnedEntities: Map<number, any>;
    };
    const converted = privateLogic.spawnedEntities.get(2);
    if (!converted) {
      throw new Error('Expected converted defector target');
    }

    const initialFlashPhase = converted.defectorHelperFlashPhase;
    logic.update(1 / 30);
    expect(converted.defectorHelperFlashPhase).toBeGreaterThan(initialFlashPhase);
  });
});
