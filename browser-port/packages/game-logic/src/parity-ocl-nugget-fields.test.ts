/**
 * Parity Tests -- DeliverPayload nugget and GenericObjectCreationNugget (CreateObject) missing fields.
 *
 * C++ source: ObjectCreationList.cpp:249-596 (DeliverPayloadNugget)
 * C++ source: ObjectCreationList.cpp:735-918 (GenericObjectCreationNugget)
 * C++ source: DeliverPayloadAIUpdate.cpp:60-102 (DeliverPayloadData FieldParse)
 *
 * DeliverPayloadNugget fields:
 *   Transport, StartAtPreferredHeight, StartAtMaxSpeed, FormationSize, FormationSpacing,
 *   WeaponConvergenceFactor, WeaponErrorRadius, DelayDeliveryMax, Payload, PutInContainer
 *
 * GenericObjectCreationNugget CreateObject-specific fields:
 *   IgnorePrimaryObstacle, SkipIfSignificantlyAirborne, InvulnerableTime,
 *   ContainInsideSourceObject, SpreadFormation, MinDistanceAFormation,
 *   MinDistanceBFormation, MaxDistanceFormation, FadeIn, FadeOut, FadeTime,
 *   MinHealth, MaxHealth, RequiresLivePlayer, MinLifetime, MaxLifetime, PutInContainer
 */

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { GameLogicSubsystem } from './index.js';
import {
  makeBlock,
  makeObjectDef,
  makeBundle,
  makeLocomotorDef,
  makeRegistry,
  makeHeightmap,
  makeMap,
  makeMapObject,
  makeWeaponBlock,
  makeWeaponDef,
} from './test-helpers.js';

function createLogic(): GameLogicSubsystem {
  const scene = new THREE.Scene();
  return new GameLogicSubsystem(scene);
}

// ── Shared OCL bundle injection helper ──────────────────────────────────────

function addOCL(
  bundle: ReturnType<typeof makeBundle>,
  oclName: string,
  nuggets: Array<{
    type: string;
    fields: Record<string, unknown>;
  }>,
): void {
  const lists = ((bundle as Record<string, unknown>).objectCreationLists ?? []) as unknown[];
  lists.push({
    name: oclName,
    fields: {},
    blocks: nuggets.map((n) => ({
      type: n.type,
      name: n.type,
      fields: n.fields,
      blocks: [],
    })),
  });
  (bundle as Record<string, unknown>).objectCreationLists = lists;
}

// ── Private entity access helpers ───────────────────────────────────────────

interface PrivateLogic {
  spawnedEntities: Map<number, PrivateEntity>;
  frameCounter: number;
  defeatedSides: Set<string>;
  pendingScriptReinforcementTransportArrivalByEntityId: Map<number, {
    targetX: number;
    targetZ: number;
    deliverPayloadMoveToX: number;
    deliverPayloadMoveToZ: number;
    deliveryDistance: number;
    deliverPayloadPreOpenDistance: number;
    deliverPayloadPreviousDistanceSqr: number;
    deliverPayloadFireWeapon: boolean;
    deliverPayloadInheritTransportVelocity: boolean;
    deliverPayloadSelfDestructObject: boolean;
    deliverPayloadMode: boolean;
    deliverPayloadDoorDelayFrames: number;
    deliverPayloadDropDelayFrames: number;
    deliverPayloadDropOffsetX: number;
    deliverPayloadDropOffsetZ: number;
    deliverPayloadDropVarianceX: number;
    deliverPayloadDropVarianceZ: number;
  }>;
}

interface PrivateEntity {
  id: number;
  templateName: string;
  destroyed: boolean;
  health: number;
  maxHealth: number;
  x: number;
  y: number;
  z: number;
  side?: string;
  objectStatusFlags: Set<string>;
  modelConditionFlags: Set<string>;
  transportContainerId: number | null;
  lifetimeDieFrame: number | null;
  attackersMissExpireFrame: number;
  experienceState: { currentLevel: number };
  parkingSpaceProducerId: number | null;
  baseHeight: number;
  moving: boolean;
  moveTarget: { x: number; z: number } | null;
  attackTargetPosition: { x: number; z: number } | null;
  physicsBehaviorProfile: { mass: number } | null;
  physicsBehaviorState: {
    velX: number;
    velY: number;
    velZ: number;
    accelX: number;
    accelY: number;
    accelZ: number;
    yawRate: number;
    pitchRate: number;
    rollRate: number;
    wasAirborneLastFrame: boolean;
    stickToGround: boolean;
    allowToFall: boolean;
    isInFreeFall: boolean;
    extraBounciness: number;
    extraFriction: number;
    isStunned: boolean;
    motiveForceExpires?: number;
  } | null;
}

function priv(logic: GameLogicSubsystem): PrivateLogic {
  return logic as unknown as PrivateLogic;
}

function getEntities(logic: GameLogicSubsystem): PrivateEntity[] {
  return [...priv(logic).spawnedEntities.values()].filter((e) => !e.destroyed);
}

function getEntitiesByTemplate(logic: GameLogicSubsystem, template: string): PrivateEntity[] {
  return getEntities(logic).filter((e) => e.templateName === template);
}

// ══════════════════════════════════════════════════════════════════════════════
// Test 1: DeliverPayload nugget — Transport and Payload spawning
// ══════════════════════════════════════════════════════════════════════════════

describe('parity: DeliverPayload nugget', () => {
  /**
   * C++ source: ObjectCreationList.cpp:534-596 (DeliverPayloadNugget::parse)
   *   Parses Transport, Payload, PutInContainer, FormationSize, FormationSpacing,
   *   WeaponConvergenceFactor, WeaponErrorRadius, DelayDeliveryMax, StartAtPreferredHeight,
   *   StartAtMaxSpeed from the INI nugget.
   *
   * C++ source: ObjectCreationList.cpp:275-518 (DeliverPayloadNugget::create)
   *   Creates transport(s), loads payload, starts DeliverPayloadAIUpdate.
   */

  function makeDeliverPayloadSetup(opts: {
    formationSize?: number;
    formationSpacing?: number;
    convergenceFactor?: number;
    errorRadius?: number;
    startAtPreferredHeight?: string;
    startAtMaxSpeed?: string;
    putInContainer?: string;
    payloadCount?: number;
    delayDeliveryMax?: number;
    selfDestructObject?: string;
    deliveryDistance?: number;
    preOpenDistance?: number;
    dropDelay?: number;
    dropOffset?: string;
    dropVariance?: string;
    doorDelay?: number;
    fireWeapon?: string;
    inheritTransportVelocity?: string;
    withPhysics?: boolean;
  } = {}) {
    const extraObjects = [
      makeObjectDef('TestTransport', 'America', ['VEHICLE', 'AIRCRAFT'], [
        makeBlock('LocomotorSet', 'SET_NORMAL TestTransportLoco', {}),
        ...(opts.fireWeapon
          ? [makeWeaponBlock('TestDeliveryWeapon', 'PRIMARY')]
          : []),
        ...(opts.withPhysics
          ? [makeBlock('Behavior', 'PhysicsBehavior ModuleTag_Physics', { Mass: 5 })]
          : []),
        makeBlock('Behavior', 'DeliverPayloadAIUpdate ModuleTag_DeliverPayload', {
          DoorDelay: opts.doorDelay ?? 0,
        }),
        makeBlock('Behavior', 'TransportContain ModuleTag_Contain', { ContainMax: 8 }),
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
      ]),
      makeObjectDef('TestPayload', 'America', ['INFANTRY'], [
        ...(opts.withPhysics
          ? [makeBlock('Behavior', 'PhysicsBehavior ModuleTag_Physics', { Mass: 2 })]
          : []),
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
      ], { TransportSlotCount: 1 }),
    ];
    if (opts.putInContainer) {
      extraObjects.push(
        makeObjectDef('PayloadContainer', 'America', ['VEHICLE'], [
          makeBlock('Behavior', 'TransportContain ModuleTag_Contain', { ContainMax: 1 }),
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
        ], { TransportSlotCount: 1 }),
      );
    }

    const bundle = makeBundle({
      objects: [
        makeObjectDef('Launcher', 'America', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
        ]),
        ...extraObjects,
      ],
      locomotors: [
        makeLocomotorDef('TestTransportLoco', 80, { PreferredHeight: 275 }),
      ],
      weapons: opts.fireWeapon
        ? [makeWeaponDef('TestDeliveryWeapon', {
          PrimaryDamage: 100,
          PrimaryDamageRadius: 15,
          AttackRange: 9999,
          ClipSize: 1,
          DelayBetweenShots: 1,
          WeaponSpeed: 9999,
          DamageType: 'EXPLOSION',
          DeathType: 'NORMAL',
        })]
        : [],
    });

    const nuggetFields: Record<string, unknown> = {
      Transport: 'TestTransport',
      Payload: opts.payloadCount && opts.payloadCount > 1
        ? `TestPayload ${opts.payloadCount}`
        : 'TestPayload',
    };
    if (opts.formationSize !== undefined) nuggetFields['FormationSize'] = opts.formationSize;
    if (opts.formationSpacing !== undefined) nuggetFields['FormationSpacing'] = opts.formationSpacing;
    if (opts.convergenceFactor !== undefined) nuggetFields['WeaponConvergenceFactor'] = opts.convergenceFactor;
    if (opts.errorRadius !== undefined) nuggetFields['WeaponErrorRadius'] = opts.errorRadius;
    if (opts.startAtPreferredHeight !== undefined) nuggetFields['StartAtPreferredHeight'] = opts.startAtPreferredHeight;
    if (opts.startAtMaxSpeed !== undefined) nuggetFields['StartAtMaxSpeed'] = opts.startAtMaxSpeed;
    if (opts.putInContainer !== undefined) nuggetFields['PutInContainer'] = opts.putInContainer;
    if (opts.delayDeliveryMax !== undefined) nuggetFields['DelayDeliveryMax'] = opts.delayDeliveryMax;
    if (opts.selfDestructObject !== undefined) nuggetFields['SelfDestructObject'] = opts.selfDestructObject;
    if (opts.deliveryDistance !== undefined) nuggetFields['DeliveryDistance'] = opts.deliveryDistance;
    if (opts.preOpenDistance !== undefined) nuggetFields['PreOpenDistance'] = opts.preOpenDistance;
    if (opts.dropDelay !== undefined) nuggetFields['DropDelay'] = opts.dropDelay;
    if (opts.dropOffset !== undefined) nuggetFields['DropOffset'] = opts.dropOffset;
    if (opts.dropVariance !== undefined) nuggetFields['DropVariance'] = opts.dropVariance;
    if (opts.fireWeapon !== undefined) nuggetFields['FireWeapon'] = opts.fireWeapon;
    if (opts.inheritTransportVelocity !== undefined) {
      nuggetFields['InheritTransportVelocity'] = opts.inheritTransportVelocity;
    }

    addOCL(bundle, 'OCL_DeliverPayload', [{ type: 'DeliverPayload', fields: nuggetFields }]);

    const logic = createLogic();
    logic.loadMapObjects(
      makeMap([makeMapObject('Launcher', 5, 5)]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.update(0);
    return { logic, bundle };
  }

  it('spawns transport and payload from DeliverPayload nugget', () => {
    // C++ parity: DeliverPayloadNugget::create spawns 1 transport with payload inside.
    const { logic } = makeDeliverPayloadSetup();

    // Execute OCL via a death OCL (simplest trigger).
    const launcher = getEntitiesByTemplate(logic, 'Launcher')[0]!;
    const createdId = (logic as unknown as { executeOCL: (name: string, entity: unknown) => number | null })
      .executeOCL('OCL_DeliverPayload', launcher);

    const transports = getEntitiesByTemplate(logic, 'TestTransport');
    const payloads = getEntitiesByTemplate(logic, 'TestPayload');

    expect(transports.length).toBe(1);
    // Source parity: DeliverPayloadNugget::create returns the first transport.
    // ObjectCreationList::createInternal forwards the first created nugget object.
    expect(createdId).toBe(transports[0]!.id);
    expect(payloads.length).toBe(1);
    // Payload should be contained in transport.
    expect(payloads[0]!.transportContainerId).toBe(transports[0]!.id);
  });

  it('spawns multiple transports with FormationSize > 1', () => {
    // C++ parity: ObjectCreationList.cpp:325 — iterates formationIndex from 0 to m_formationSize.
    const { logic } = makeDeliverPayloadSetup({ formationSize: 3 });

    const launcher = getEntitiesByTemplate(logic, 'Launcher')[0]!;
    // Provide a target position different from source so formation offsets are non-zero.
    (logic as unknown as { executeOCL: (name: string, entity: unknown, frames: undefined, tx: number, tz: number) => void })
      .executeOCL('OCL_DeliverPayload', launcher, undefined, 200, 200);

    const transports = getEntitiesByTemplate(logic, 'TestTransport');
    expect(transports.length).toBe(3);

    // Each transport should be at a different position (formation offset).
    const positions = transports.map((t) => ({ x: t.x, z: t.z }));
    const uniquePositions = new Set(positions.map((p) => `${Math.round(p.x)},${Math.round(p.z)}`));
    expect(uniquePositions.size).toBe(3);
  });

  it('spawns multiple payload units per Payload entry count', () => {
    // C++ parity: ObjectCreationList.cpp:459-510 — iterates i from 0 to payloadCount.
    const { logic } = makeDeliverPayloadSetup({ payloadCount: 3 });

    const launcher = getEntitiesByTemplate(logic, 'Launcher')[0]!;
    (logic as unknown as { executeOCL: (name: string, entity: unknown) => void })
      .executeOCL('OCL_DeliverPayload', launcher);

    const payloads = getEntitiesByTemplate(logic, 'TestPayload');
    expect(payloads.length).toBe(3);
  });

  it('marks transport as SCRIPT_TARGETABLE', () => {
    // C++ parity: ObjectCreationList.cpp:397 — transport->setScriptStatus(OBJECT_STATUS_SCRIPT_TARGETABLE).
    const { logic } = makeDeliverPayloadSetup();

    const launcher = getEntitiesByTemplate(logic, 'Launcher')[0]!;
    (logic as unknown as { executeOCL: (name: string, entity: unknown) => void })
      .executeOCL('OCL_DeliverPayload', launcher);

    const transport = getEntitiesByTemplate(logic, 'TestTransport')[0]!;
    expect(transport.objectStatusFlags.has('SCRIPT_TARGETABLE')).toBe(true);
  });

  it('tracks producer on spawned transport', () => {
    // C++ parity: ObjectCreationList.cpp:395 — transport->setProducer(primaryObj).
    const { logic } = makeDeliverPayloadSetup();

    const launcher = getEntitiesByTemplate(logic, 'Launcher')[0]!;
    (logic as unknown as { executeOCL: (name: string, entity: unknown) => void })
      .executeOCL('OCL_DeliverPayload', launcher);

    const transport = getEntitiesByTemplate(logic, 'TestTransport')[0]!;
    expect(transport.parkingSpaceProducerId).toBe(launcher.id);
  });

  it('raises transport altitude when StartAtPreferredHeight is Yes (default)', () => {
    // C++ parity: ObjectCreationList.cpp:443-447 — startPos.z = terrain + preferredHeight.
    const { logic } = makeDeliverPayloadSetup();

    const launcher = getEntitiesByTemplate(logic, 'Launcher')[0]!;
    (logic as unknown as { executeOCL: (name: string, entity: unknown) => void })
      .executeOCL('OCL_DeliverPayload', launcher);

    const transport = getEntitiesByTemplate(logic, 'TestTransport')[0]!;
    expect(transport.y).toBe(275);
  });

  it('leaves transport on terrain when StartAtPreferredHeight is No', () => {
    // C++ parity: ObjectCreationList.cpp:443 — height adjustment is gated by m_startAtPreferredHeight.
    const { logic } = makeDeliverPayloadSetup({ startAtPreferredHeight: 'No' });

    const launcher = getEntitiesByTemplate(logic, 'Launcher')[0]!;
    (logic as unknown as { executeOCL: (name: string, entity: unknown) => void })
      .executeOCL('OCL_DeliverPayload', launcher);

    const transport = getEntitiesByTemplate(logic, 'TestTransport')[0]!;
    expect(transport.y).toBe(0);
  });

  it('destroys SelfDestructObject transports when delivery exits', () => {
    // C++ parity: ObjectCreationList.cpp:84 — m_selfDestructObject parsed as bool.
    const { logic } = makeDeliverPayloadSetup({ selfDestructObject: 'Yes' });

    const launcher = getEntitiesByTemplate(logic, 'Launcher')[0]!;
    (logic as unknown as { executeOCL: (name: string, entity: unknown) => void })
      .executeOCL('OCL_DeliverPayload', launcher);

    const transport = getEntitiesByTemplate(logic, 'TestTransport')[0]!;
    expect(transport.lifetimeDieFrame).toBeNull();

    logic.update(1 / 30);
    expect(getEntitiesByTemplate(logic, 'TestTransport')).toHaveLength(1);

    logic.update(1 / 30);
    expect(getEntitiesByTemplate(logic, 'TestTransport')).toHaveLength(0);
  });

  it('creates PutInContainer entities when specified', () => {
    // C++ parity: ObjectCreationList.cpp:475-500 — PutInContainer wraps payload in container.
    const { logic } = makeDeliverPayloadSetup({ putInContainer: 'PayloadContainer' });

    const launcher = getEntitiesByTemplate(logic, 'Launcher')[0]!;
    (logic as unknown as { executeOCL: (name: string, entity: unknown) => void })
      .executeOCL('OCL_DeliverPayload', launcher);

    const containers = getEntitiesByTemplate(logic, 'PayloadContainer');
    const payloads = getEntitiesByTemplate(logic, 'TestPayload');
    expect(containers.length).toBe(1);
    expect(payloads.length).toBe(1);
    // Container should be in the transport.
    const transport = getEntitiesByTemplate(logic, 'TestTransport')[0]!;
    expect(containers[0]!.transportContainerId).toBe(transport.id);
    // Source parity: payload is first added to PutInContainer, then that
    // container is loaded into the transport.
    expect(payloads[0]!.transportContainerId).toBe(containers[0]!.id);
  });

  it('starts DeliverPayloadAIUpdate staged delivery from OCL data', () => {
    // C++ parity: ObjectCreationList.cpp:433-438 calls ai->deliverPayload(moveToPos, targetPos, data).
    // The TS OCL path should therefore queue the same delivery-distance/drop-delay state,
    // not merely spawn a loaded transport.
    const { logic } = makeDeliverPayloadSetup({
      deliveryDistance: 0,
      dropDelay: 1000,
      dropOffset: '4 6 0',
      dropVariance: '0 0 0',
      doorDelay: 500,
    });

    const launcher = getEntitiesByTemplate(logic, 'Launcher')[0]!;
    (logic as unknown as { executeOCL: (name: string, entity: unknown, frames: undefined, tx: number, tz: number) => void })
      .executeOCL('OCL_DeliverPayload', launcher, undefined, launcher.x, launcher.z);

    const transport = getEntitiesByTemplate(logic, 'TestTransport')[0]!;
    const payload = getEntitiesByTemplate(logic, 'TestPayload')[0]!;
    const pending = priv(logic).pendingScriptReinforcementTransportArrivalByEntityId.get(transport.id);
    expect(pending).toBeDefined();
    expect(pending!.deliverPayloadMode).toBe(true);
    expect(pending!.deliveryDistance).toBe(0);
    expect(pending!.deliverPayloadPreOpenDistance).toBe(0);
    expect(pending!.deliverPayloadDoorDelayFrames).toBe(15);
    expect(pending!.deliverPayloadDropDelayFrames).toBe(30);
    expect(pending!.deliverPayloadDropOffsetX).toBe(4);
    expect(pending!.deliverPayloadDropOffsetZ).toBe(6);
    expect(payload.transportContainerId).toBe(transport.id);

    for (let i = 0; i < 16; i += 1) {
      logic.update(1 / 30);
    }

    expect(payload.transportContainerId).toBeNull();
    expect(payload.x).toBeCloseTo(transport.x + 4, 5);
    expect(payload.z).toBeCloseTo(transport.z + 6, 5);
  });

  it('fires weapon payloads at target plus DropOffset and destroys the contained payload', () => {
    // C++ parity: DeliverPayloadAIUpdate.cpp:727-734 FireWeapon branch
    // owner->fireCurrentWeapon(targetPos + dropOffset), then destroyObject(item).
    const { logic } = makeDeliverPayloadSetup({
      deliveryDistance: 0,
      dropDelay: 0,
      dropOffset: '7 9 0',
      doorDelay: 0,
      fireWeapon: 'Yes',
    });

    const launcher = getEntitiesByTemplate(logic, 'Launcher')[0]!;
    (logic as unknown as { executeOCL: (name: string, entity: unknown, frames: undefined, tx: number, tz: number) => void })
      .executeOCL('OCL_DeliverPayload', launcher, undefined, launcher.x, launcher.z);

    const transport = getEntitiesByTemplate(logic, 'TestTransport')[0]!;
    const payload = getEntitiesByTemplate(logic, 'TestPayload')[0]!;
    const pending = priv(logic).pendingScriptReinforcementTransportArrivalByEntityId.get(transport.id);
    expect(pending?.deliverPayloadFireWeapon).toBe(true);
    expect(payload.transportContainerId).toBe(transport.id);

    logic.update(1 / 30);

    expect(getEntitiesByTemplate(logic, 'TestPayload')).toHaveLength(0);
    expect(transport.attackTargetPosition).toEqual({
      x: launcher.x + 7,
      z: launcher.z + 9,
    });
  });

  it('orders non-weapon payloads toward moveToPos, not converged targetPos', () => {
    // C++ parity: DeliveringState::update non-FireWeapon branch calls
    // itemAI->aiMoveToPosition(ai->getMoveToPos()), while FireWeapon uses
    // ai->getTargetPos(). With WeaponConvergenceFactor=1, a formation member's
    // targetPos converges to the requested target, but moveToPos keeps the
    // formation offset.
    const { logic } = makeDeliverPayloadSetup({
      formationSize: 2,
      formationSpacing: 20,
      convergenceFactor: 1,
      deliveryDistance: 0,
      dropDelay: 0,
      doorDelay: 0,
    });

    const launcher = getEntitiesByTemplate(logic, 'Launcher')[0]!;
    const targetX = 205;
    const targetZ = 205;
    (logic as unknown as { executeOCL: (name: string, entity: unknown, frames: undefined, tx: number, tz: number) => void })
      .executeOCL('OCL_DeliverPayload', launcher, undefined, targetX, targetZ);

    const transports = getEntitiesByTemplate(logic, 'TestTransport');
    expect(transports).toHaveLength(2);
    const secondTransport = transports[1]!;
    const secondPayload = getEntitiesByTemplate(logic, 'TestPayload')
      .find((payload) => payload.transportContainerId === secondTransport.id)!;
    expect(secondPayload).toBeDefined();

    const pending = priv(logic).pendingScriptReinforcementTransportArrivalByEntityId.get(secondTransport.id);
    expect(pending).toBeDefined();
    expect(pending!.targetX).toBeCloseTo(targetX, 5);
    expect(pending!.targetZ).toBeCloseTo(targetZ, 5);

    const offsetX = secondTransport.x - launcher.x;
    const offsetZ = secondTransport.z - launcher.z;
    const expectedMoveToX = targetX + offsetX;
    const expectedMoveToZ = targetZ + offsetZ;
    expect(pending!.deliverPayloadMoveToX).toBeCloseTo(expectedMoveToX, 5);
    expect(pending!.deliverPayloadMoveToZ).toBeCloseTo(expectedMoveToZ, 5);

    (logic as unknown as {
      dropScriptReinforcementDeliverPayloadPassenger: (
        passengerId: number,
        transport: PrivateEntity,
        pending: NonNullable<ReturnType<PrivateLogic['pendingScriptReinforcementTransportArrivalByEntityId']['get']>>,
      ) => void;
    }).dropScriptReinforcementDeliverPayloadPassenger(secondPayload.id, secondTransport, pending!);

    expect(secondPayload.transportContainerId).toBeNull();
    expect(secondPayload.moveTarget).not.toBeNull();
    expect(secondPayload.moveTarget!.x).toBeCloseTo(expectedMoveToX, 5);
    expect(secondPayload.moveTarget!.z).toBeCloseTo(expectedMoveToZ, 5);
    expect(Math.hypot(
      secondPayload.moveTarget!.x - targetX,
      secondPayload.moveTarget!.z - targetZ,
    )).toBeGreaterThan(1);
  });

  it('applies transport velocity as a physics force when InheritTransportVelocity is set', () => {
    // C++ parity: DeliveringState::update copies owner->getPhysics()->getVelocity()
    // and calls item->getPhysics()->applyForce(&velocity). PhysicsBehavior::applyForce
    // divides the force by payload mass and accumulates acceleration.
    const { logic } = makeDeliverPayloadSetup({
      deliveryDistance: 0,
      dropDelay: 0,
      doorDelay: 0,
      inheritTransportVelocity: 'Yes',
      withPhysics: true,
    });

    const launcher = getEntitiesByTemplate(logic, 'Launcher')[0]!;
    (logic as unknown as { executeOCL: (name: string, entity: unknown, frames: undefined, tx: number, tz: number) => void })
      .executeOCL('OCL_DeliverPayload', launcher, undefined, launcher.x, launcher.z);

    const transport = getEntitiesByTemplate(logic, 'TestTransport')[0]!;
    const payload = getEntitiesByTemplate(logic, 'TestPayload')[0]!;
    const pending = priv(logic).pendingScriptReinforcementTransportArrivalByEntityId.get(transport.id);
    expect(pending).toBeDefined();
    expect(pending!.deliverPayloadInheritTransportVelocity).toBe(true);
    expect(payload.physicsBehaviorProfile?.mass).toBe(2);

    transport.physicsBehaviorState = {
      velX: 6,
      velY: 4,
      velZ: 8,
      accelX: 0,
      accelY: 0,
      accelZ: 0,
      yawRate: 0,
      pitchRate: 0,
      rollRate: 0,
      wasAirborneLastFrame: false,
      stickToGround: false,
      allowToFall: false,
      isInFreeFall: false,
      extraBounciness: 0,
      extraFriction: 0,
      isStunned: false,
    };

    (logic as unknown as {
      dropScriptReinforcementDeliverPayloadPassenger: (
        passengerId: number,
        transport: PrivateEntity,
        pending: NonNullable<ReturnType<PrivateLogic['pendingScriptReinforcementTransportArrivalByEntityId']['get']>>,
      ) => void;
    }).dropScriptReinforcementDeliverPayloadPassenger(payload.id, transport, pending!);

    expect(payload.physicsBehaviorState).not.toBeNull();
    expect(payload.physicsBehaviorState!.accelX).toBeCloseTo(3);
    expect(payload.physicsBehaviorState!.accelY).toBeCloseTo(2);
    expect(payload.physicsBehaviorState!.accelZ).toBeCloseTo(4);
  });

  it('backs OCL delivery transports away by DeliveryDistance slop before approach', () => {
    // C++ parity: ObjectCreationList.cpp:373-378 subtracts
    // DeliveryDistance * 1.5 along the approach direction before spawning.
    const { logic } = makeDeliverPayloadSetup({
      startAtPreferredHeight: 'No',
      deliveryDistance: 20,
    });

    const launcher = getEntitiesByTemplate(logic, 'Launcher')[0]!;
    (logic as unknown as { executeOCL: (name: string, entity: unknown, frames: undefined, tx: number, tz: number) => void })
      .executeOCL('OCL_DeliverPayload', launcher, undefined, launcher.x + 200, launcher.z);

    const transport = getEntitiesByTemplate(logic, 'TestTransport')[0]!;
    expect(transport.x).toBeCloseTo(launcher.x - 30, 5);
    expect(transport.z).toBeCloseTo(launcher.z, 5);
  });

  it('uses PreOpenDistance only after an OCL delivery transport is inbound', () => {
    // C++ parity: DeliverPayloadAIUpdate::isCloseEnoughToTarget adds
    // PreOpenDistance to DeliveryDistance only when previous distance is
    // greater than current distance.
    const { logic } = makeDeliverPayloadSetup({
      startAtPreferredHeight: 'No',
      deliveryDistance: 10,
      preOpenDistance: 500,
      dropDelay: 0,
    });

    const launcher = getEntitiesByTemplate(logic, 'Launcher')[0]!;
    (logic as unknown as { executeOCL: (name: string, entity: unknown, frames: undefined, tx: number, tz: number) => void })
      .executeOCL('OCL_DeliverPayload', launcher, undefined, launcher.x + 200, launcher.z);

    const transport = getEntitiesByTemplate(logic, 'TestTransport')[0]!;
    const payload = getEntitiesByTemplate(logic, 'TestPayload')[0]!;
    const pending = priv(logic).pendingScriptReinforcementTransportArrivalByEntityId.get(transport.id);
    expect(pending?.deliverPayloadPreOpenDistance).toBe(500);
    expect(payload.transportContainerId).toBe(transport.id);

    logic.update(1 / 30);
    expect(payload.transportContainerId).toBe(transport.id);

    logic.update(1 / 30);
    expect(payload.transportContainerId).toBeNull();
    expect(Math.hypot(transport.x - (launcher.x + 200), transport.z - launcher.z)).toBeGreaterThan(100);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Test 2: CreateObject nugget — Missing fields from GenericObjectCreationNugget
// ══════════════════════════════════════════════════════════════════════════════

describe('parity: CreateObject nugget missing fields', () => {
  /**
   * C++ source: ObjectCreationList.cpp:825-876
   *   GenericObjectCreationNugget FieldParse tables (common + CreateObject-specific).
   *
   * C++ source: ObjectCreationList.cpp:735-788
   *   GenericObjectCreationNugget constructor defaults:
   *   m_skipIfSignificantlyAirborne(false), m_invulnerableTime(0),
   *   m_containInsideSourceObject(FALSE), m_minHealth(1.0f), m_maxHealth(1.0f),
   *   m_requiresLivePlayer(FALSE), m_spreadFormation(false), m_fadeIn(false),
   *   m_fadeOut(false), m_fadeFrames(0), etc.
   */

  function makeCreateObjectSetup(
    nuggetFields: Record<string, unknown>,
    extraObjects?: ReturnType<typeof makeObjectDef>[],
    opts: { withPhysics?: boolean } = {},
  ) {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Source', 'America', ['STRUCTURE'], [
          ...(opts.withPhysics
            ? [makeBlock('Behavior', 'PhysicsBehavior ModuleTag_Physics', { Mass: 5 })]
            : []),
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
        ]),
        makeObjectDef('SpawnedUnit', 'America', ['INFANTRY'], [
          ...(opts.withPhysics
            ? [makeBlock('Behavior', 'PhysicsBehavior ModuleTag_Physics', { Mass: 2 })]
            : []),
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
        ], { TransportSlotCount: 1 }),
        ...(extraObjects ?? []),
      ],
    });

    addOCL(bundle, 'OCL_TestCreate', [{
      type: 'CreateObject',
      fields: { ObjectNames: 'SpawnedUnit', ...nuggetFields },
    }]);

    const logic = createLogic();
    logic.loadMapObjects(
      makeMap([makeMapObject('Source', 5, 5)]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.update(0);
    return { logic, bundle };
  }

  it('applies InvulnerableTime to spawned objects', () => {
    // C++ parity: ObjectCreationList.cpp:873 — InvulnerableTime parsed as duration.
    // C++ GenericObjectCreationNugget applies INVULNERABLE status for the specified duration.
    const { logic } = makeCreateObjectSetup({ InvulnerableTime: 3000 });

    const source = getEntitiesByTemplate(logic, 'Source')[0]!;
    (logic as unknown as { executeOCL: (name: string, entity: unknown) => void })
      .executeOCL('OCL_TestCreate', source);

    const spawned = getEntitiesByTemplate(logic, 'SpawnedUnit');
    expect(spawned.length).toBe(1);
    expect(spawned[0]!.objectStatusFlags.has('INVULNERABLE')).toBe(true);
  });

  it('skips creation when SkipIfSignificantlyAirborne is Yes and source is airborne', () => {
    // C++ parity: ObjectCreationList.cpp:794 — if m_skipIfSignificantlyAirborne && isSignificantlyAboveTerrain().
    const { logic } = makeCreateObjectSetup({ SkipIfSignificantlyAirborne: 'Yes' });

    const source = getEntitiesByTemplate(logic, 'Source')[0]!;
    // Elevate source well above terrain.
    source.y = source.baseHeight + 100;

    (logic as unknown as { executeOCL: (name: string, entity: unknown) => void })
      .executeOCL('OCL_TestCreate', source);

    const spawned = getEntitiesByTemplate(logic, 'SpawnedUnit');
    expect(spawned.length).toBe(0);
  });

  it('does not skip creation when SkipIfSignificantlyAirborne is Yes but source is on ground', () => {
    // Source is at ground level, so creation should proceed normally.
    const { logic } = makeCreateObjectSetup({ SkipIfSignificantlyAirborne: 'Yes' });

    const source = getEntitiesByTemplate(logic, 'Source')[0]!;
    // Source stays at ground level.

    (logic as unknown as { executeOCL: (name: string, entity: unknown) => void })
      .executeOCL('OCL_TestCreate', source);

    const spawned = getEntitiesByTemplate(logic, 'SpawnedUnit');
    expect(spawned.length).toBe(1);
  });

  it('places spawned object inside source when ContainInsideSourceObject is Yes', () => {
    // C++ parity: ObjectCreationList.cpp:868 — ContainInsideSourceObject.
    const { logic } = makeCreateObjectSetup({ ContainInsideSourceObject: 'Yes' });

    const source = getEntitiesByTemplate(logic, 'Source')[0]!;
    (logic as unknown as { executeOCL: (name: string, entity: unknown) => void })
      .executeOCL('OCL_TestCreate', source);

    const spawned = getEntitiesByTemplate(logic, 'SpawnedUnit');
    expect(spawned.length).toBe(1);
    expect(spawned[0]!.transportContainerId).toBe(source.id);
  });

  it('clamps spawned health when MinHealth and MaxHealth are specified', () => {
    // C++ parity: ObjectCreationList.cpp:874-875 — MinHealth/MaxHealth as percentages.
    // With MinHealth=50% MaxHealth=50%, spawned at 50% of maxHealth (200 * 0.5 = 100).
    const { logic } = makeCreateObjectSetup({ MinHealth: 0.5, MaxHealth: 0.5 });

    const source = getEntitiesByTemplate(logic, 'Source')[0]!;
    (logic as unknown as { executeOCL: (name: string, entity: unknown) => void })
      .executeOCL('OCL_TestCreate', source);

    const spawned = getEntitiesByTemplate(logic, 'SpawnedUnit');
    expect(spawned.length).toBe(1);
    expect(spawned[0]!.health).toBe(100); // 200 * 0.5 = 100
    expect(spawned[0]!.maxHealth).toBe(200);
  });

  it('does not reduce health when MinHealth and MaxHealth are 1.0 (default)', () => {
    // Default: minHealth=1.0, maxHealth=1.0 means full health.
    const { logic } = makeCreateObjectSetup({});

    const source = getEntitiesByTemplate(logic, 'Source')[0]!;
    (logic as unknown as { executeOCL: (name: string, entity: unknown) => void })
      .executeOCL('OCL_TestCreate', source);

    const spawned = getEntitiesByTemplate(logic, 'SpawnedUnit');
    expect(spawned.length).toBe(1);
    expect(spawned[0]!.health).toBe(200);
  });

  it('assigns random lifetime when MinLifetime and MaxLifetime are specified', () => {
    // C++ parity: ObjectCreationList.cpp:847-848 — MinLifetime/MaxLifetime duration fields.
    const { logic } = makeCreateObjectSetup({ MinLifetime: 3000, MaxLifetime: 3000 });

    const source = getEntitiesByTemplate(logic, 'Source')[0]!;
    (logic as unknown as { executeOCL: (name: string, entity: unknown) => void })
      .executeOCL('OCL_TestCreate', source);

    const spawned = getEntitiesByTemplate(logic, 'SpawnedUnit');
    expect(spawned.length).toBe(1);
    expect(spawned[0]!.lifetimeDieFrame).not.toBeNull();
    // At 30fps, 3000ms = 90 frames.
    expect(spawned[0]!.lifetimeDieFrame).toBeGreaterThan(0);
  });

  it('spreads objects in formation when SpreadFormation is Yes', () => {
    // C++ parity: ObjectCreationList.cpp:849-852 — SpreadFormation + formation distance fields.
    const { logic } = makeCreateObjectSetup({
      Count: '4',
      SpreadFormation: 'Yes',
      MinDistanceAFormation: 10,
      MinDistanceBFormation: 10,
      MaxDistanceFormation: 50,
    });

    const source = getEntitiesByTemplate(logic, 'Source')[0]!;
    (logic as unknown as { executeOCL: (name: string, entity: unknown) => void })
      .executeOCL('OCL_TestCreate', source);

    const spawned = getEntitiesByTemplate(logic, 'SpawnedUnit');
    expect(spawned.length).toBe(4);

    // With spread formation, units should be at varying positions.
    const positions = spawned.map((e) => ({ x: e.x, z: e.z }));
    const uniquePositions = new Set(positions.map((p) => `${Math.round(p.x)},${Math.round(p.z)}`));
    // At least some positions should differ (formation spread).
    expect(uniquePositions.size).toBeGreaterThanOrEqual(2);
  });

  it('sets FadeIn model condition flag on spawned objects', () => {
    // C++ parity: ObjectCreationList.cpp:853-855 — FadeIn/FadeOut/FadeTime.
    const { logic } = makeCreateObjectSetup({ FadeIn: 'Yes', FadeTime: 1000 });

    const source = getEntitiesByTemplate(logic, 'Source')[0]!;
    (logic as unknown as { executeOCL: (name: string, entity: unknown) => void })
      .executeOCL('OCL_TestCreate', source);

    const spawned = getEntitiesByTemplate(logic, 'SpawnedUnit');
    expect(spawned.length).toBe(1);
    expect(spawned[0]!.modelConditionFlags.has('FADING_IN')).toBe(true);
  });

  it('skips creation when RequiresLivePlayer is Yes and owning side is defeated', () => {
    // C++ parity: ObjectCreationList.cpp:876 — m_requiresLivePlayer.
    const { logic } = makeCreateObjectSetup({ RequiresLivePlayer: 'Yes' });

    const source = getEntitiesByTemplate(logic, 'Source')[0]!;
    // Mark the source's side as defeated.
    priv(logic).defeatedSides.add('America');

    (logic as unknown as { executeOCL: (name: string, entity: unknown) => void })
      .executeOCL('OCL_TestCreate', source);

    const spawned = getEntitiesByTemplate(logic, 'SpawnedUnit');
    expect(spawned.length).toBe(0);
  });

  it('allows creation when RequiresLivePlayer is Yes and side is alive', () => {
    // Side is not defeated, so creation should proceed.
    const { logic } = makeCreateObjectSetup({ RequiresLivePlayer: 'Yes' });

    const source = getEntitiesByTemplate(logic, 'Source')[0]!;
    // Side NOT defeated.

    (logic as unknown as { executeOCL: (name: string, entity: unknown) => void })
      .executeOCL('OCL_TestCreate', source);

    const spawned = getEntitiesByTemplate(logic, 'SpawnedUnit');
    expect(spawned.length).toBe(1);
  });

  it('wraps spawned object in PutInContainer template', () => {
    // C++ parity: ObjectCreationList.cpp:829 — PutInContainer (common field).
    const { logic } = makeCreateObjectSetup(
      { PutInContainer: 'Wrapper' },
      [
        makeObjectDef('Wrapper', 'America', ['VEHICLE'], [
          makeBlock('Behavior', 'TransportContain ModuleTag_Contain', { ContainMax: 4 }),
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 300, InitialHealth: 300 }),
        ]),
      ],
    );

    const source = getEntitiesByTemplate(logic, 'Source')[0]!;
    const createdId = (logic as unknown as { executeOCL: (name: string, entity: unknown) => number | null })
      .executeOCL('OCL_TestCreate', source);

    const spawned = getEntitiesByTemplate(logic, 'SpawnedUnit');
    const wrappers = getEntitiesByTemplate(logic, 'Wrapper');
    expect(spawned.length).toBe(1);
    expect(wrappers.length).toBe(1);
    expect(createdId).toBe(wrappers[0]!.id);
    // Spawned unit should be inside the wrapper.
    expect(spawned[0]!.transportContainerId).toBe(wrappers[0]!.id);
  });

  it('uses one shared PutInContainer for multiple CreateObject spawns', () => {
    // C++ parity: GenericObjectCreationNugget::reallyCreate creates the
    // wrapper once before the debris/object loop, then adds every generated
    // object to that same container.
    const { logic } = makeCreateObjectSetup(
      { PutInContainer: 'Wrapper', Count: 2 },
      [
        makeObjectDef('Wrapper', 'America', ['VEHICLE'], [
          makeBlock('Behavior', 'TransportContain ModuleTag_Contain', { ContainMax: 4 }),
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 300, InitialHealth: 300 }),
        ]),
      ],
    );

    const source = getEntitiesByTemplate(logic, 'Source')[0]!;
    const createdId = (logic as unknown as { executeOCL: (name: string, entity: unknown) => number | null })
      .executeOCL('OCL_TestCreate', source);

    const spawned = getEntitiesByTemplate(logic, 'SpawnedUnit');
    const wrappers = getEntitiesByTemplate(logic, 'Wrapper');
    expect(spawned.length).toBe(2);
    expect(wrappers.length).toBe(1);
    expect(createdId).toBe(wrappers[0]!.id);
    expect(spawned.every((entity) => entity.transportContainerId === wrappers[0]!.id)).toBe(true);
  });

  it('applies source physics velocity as force when Disposition inherits velocity', () => {
    // C++ parity: ObjectCreationList.cpp doStuffToObj checks
    // BitTest(m_disposition, INHERIT_VELOCITY) and calls
    // objectPhysics->applyForce(sourcePhysics->getVelocity()).
    const { logic } = makeCreateObjectSetup(
      { Disposition: ['SEND_IT_FLYING', 'INHERIT_VELOCITY'] },
      undefined,
      { withPhysics: true },
    );

    const source = getEntitiesByTemplate(logic, 'Source')[0]!;
    source.physicsBehaviorState = {
      velX: 6,
      velY: 4,
      velZ: 8,
      accelX: 0,
      accelY: 0,
      accelZ: 0,
      yawRate: 0,
      pitchRate: 0,
      rollRate: 0,
      wasAirborneLastFrame: false,
      stickToGround: false,
      allowToFall: false,
      isInFreeFall: false,
      extraBounciness: 0,
      extraFriction: 0,
      isStunned: false,
    };

    (logic as unknown as { executeOCL: (name: string, entity: unknown) => number | null })
      .executeOCL('OCL_TestCreate', source);

    const spawned = getEntitiesByTemplate(logic, 'SpawnedUnit');
    expect(spawned.length).toBe(1);
    expect(spawned[0]!.physicsBehaviorProfile?.mass).toBe(2);
    expect(spawned[0]!.physicsBehaviorState).not.toBeNull();
    expect(spawned[0]!.physicsBehaviorState!.accelX).toBeCloseTo(3);
    expect(spawned[0]!.physicsBehaviorState!.accelY).toBeCloseTo(2);
    expect(spawned[0]!.physicsBehaviorState!.accelZ).toBeCloseTo(4);
  });

  it('records IgnorePrimaryObstacle on spawned physics state', () => {
    // C++ parity: ObjectCreationList.cpp doStuffToObj calls
    // PhysicsBehavior::setIgnoreCollisionsWith(sourceObj) for this field.
    const { logic } = makeCreateObjectSetup(
      { IgnorePrimaryObstacle: 'Yes' },
      undefined,
      { withPhysics: true },
    );

    const source = getEntitiesByTemplate(logic, 'Source')[0]!;
    (logic as unknown as { executeOCL: (name: string, entity: unknown) => number | null })
      .executeOCL('OCL_TestCreate', source);

    const spawned = getEntitiesByTemplate(logic, 'SpawnedUnit');
    expect(spawned.length).toBe(1);
    expect(spawned[0]!.physicsBehaviorState).not.toBeNull();
    expect(spawned[0]!.physicsBehaviorState!.ignoreCollisionsWith).toBe(source.id);
  });

  it('applies SEND_IT_OUT horizontal force and friction to spawned physics', () => {
    // C++ parity: ObjectCreationList.cpp SEND_IT_OUT branch sets
    // extra friction and applies horizontal force in
    // [-4*DispositionIntensity, +4*DispositionIntensity].
    const { logic } = makeCreateObjectSetup(
      {
        Disposition: 'SEND_IT_OUT',
        DispositionIntensity: 3,
        ExtraFriction: 30,
        OrientInForceDirection: 'Yes',
      },
      undefined,
      { withPhysics: true },
    );

    const source = getEntitiesByTemplate(logic, 'Source')[0]!;
    (logic as unknown as { executeOCL: (name: string, entity: unknown) => number | null })
      .executeOCL('OCL_TestCreate', source);

    const spawned = getEntitiesByTemplate(logic, 'SpawnedUnit');
    expect(spawned.length).toBe(1);
    const physics = spawned[0]!.physicsBehaviorState;
    expect(physics).not.toBeNull();
    // parseFrictionPerSec: INI seconds value is converted to per-frame.
    expect(physics!.extraFriction).toBeCloseTo(1);
    expect(physics!.accelY).toBeCloseTo(0);
    // Force is divided by spawned mass 2, so each horizontal acceleration
    // component is bounded by (4 * 3) / 2 = 6.
    expect(Math.abs(physics!.accelX)).toBeLessThanOrEqual(6);
    expect(Math.abs(physics!.accelZ)).toBeLessThanOrEqual(6);
    expect(Math.hypot(physics!.accelX, physics!.accelZ)).toBeGreaterThan(0);
    expect(spawned[0]!.rotationY).toBeCloseTo(Math.atan2(physics!.accelZ, physics!.accelX), 5);
  });
});
