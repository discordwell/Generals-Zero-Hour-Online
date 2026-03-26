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
  makeRegistry,
  makeHeightmap,
  makeMap,
  makeMapObject,
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
  } = {}) {
    const extraObjects = [
      makeObjectDef('TestTransport', 'America', ['VEHICLE', 'AIRCRAFT'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
      ]),
      makeObjectDef('TestPayload', 'America', ['INFANTRY'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
      ]),
    ];
    if (opts.putInContainer) {
      extraObjects.push(
        makeObjectDef('PayloadContainer', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
        ]),
      );
    }

    const bundle = makeBundle({
      objects: [
        makeObjectDef('Launcher', 'America', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
        ]),
        ...extraObjects,
      ],
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
    (logic as unknown as { executeOCL: (name: string, entity: unknown) => void })
      .executeOCL('OCL_DeliverPayload', launcher);

    const transports = getEntitiesByTemplate(logic, 'TestTransport');
    const payloads = getEntitiesByTemplate(logic, 'TestPayload');

    expect(transports.length).toBe(1);
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
    const launcherY = launcher.y;
    (logic as unknown as { executeOCL: (name: string, entity: unknown) => void })
      .executeOCL('OCL_DeliverPayload', launcher);

    const transport = getEntitiesByTemplate(logic, 'TestTransport')[0]!;
    // Transport should be elevated above the launcher's ground level.
    expect(transport.y).toBeGreaterThan(launcherY);
  });

  it('sets lifetime on transport when SelfDestructObject is Yes', () => {
    // C++ parity: ObjectCreationList.cpp:84 — m_selfDestructObject parsed as bool.
    const { logic } = makeDeliverPayloadSetup({ selfDestructObject: 'Yes' });

    const launcher = getEntitiesByTemplate(logic, 'Launcher')[0]!;
    (logic as unknown as { executeOCL: (name: string, entity: unknown) => void })
      .executeOCL('OCL_DeliverPayload', launcher);

    const transport = getEntitiesByTemplate(logic, 'TestTransport')[0]!;
    expect(transport.lifetimeDieFrame).not.toBeNull();
  });

  it('creates PutInContainer entities when specified', () => {
    // C++ parity: ObjectCreationList.cpp:475-500 — PutInContainer wraps payload in container.
    const { logic } = makeDeliverPayloadSetup({ putInContainer: 'PayloadContainer' });

    const launcher = getEntitiesByTemplate(logic, 'Launcher')[0]!;
    (logic as unknown as { executeOCL: (name: string, entity: unknown) => void })
      .executeOCL('OCL_DeliverPayload', launcher);

    const containers = getEntitiesByTemplate(logic, 'PayloadContainer');
    expect(containers.length).toBe(1);
    // Container should be in the transport.
    const transport = getEntitiesByTemplate(logic, 'TestTransport')[0]!;
    expect(containers[0]!.transportContainerId).toBe(transport.id);
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

  function makeCreateObjectSetup(nuggetFields: Record<string, unknown>, extraObjects?: ReturnType<typeof makeObjectDef>[]) {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Source', 'America', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
        ]),
        makeObjectDef('SpawnedUnit', 'America', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
        ]),
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
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 300, InitialHealth: 300 }),
        ]),
      ],
    );

    const source = getEntitiesByTemplate(logic, 'Source')[0]!;
    (logic as unknown as { executeOCL: (name: string, entity: unknown) => void })
      .executeOCL('OCL_TestCreate', source);

    const spawned = getEntitiesByTemplate(logic, 'SpawnedUnit');
    const wrappers = getEntitiesByTemplate(logic, 'Wrapper');
    expect(spawned.length).toBe(1);
    expect(wrappers.length).toBe(1);
    // Spawned unit should be inside the wrapper.
    expect(spawned[0]!.transportContainerId).toBe(wrappers[0]!.id);
  });
});
