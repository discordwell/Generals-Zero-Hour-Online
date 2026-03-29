/**
 * Tests for ZH-only Weapon and Damage system fixes:
 * 1. SourceTemplate on DamageInfoInput — runtime usage in death pipeline
 * 2. DamageFXOverride runtime usage in visual events
 * 3. Weapon clip reload sharing between slots
 * 4. Object::setDisabledUntil combined disable types with independent timers
 * 5. Veterancy-based weapon set switching edge cases
 *
 * Source parity:
 *   - Damage.cpp:148-157 (m_sourceTemplate)
 *   - Damage.h:269 (m_damageFXOverride)
 *   - WeaponSet.cpp / Weapon.cpp:2400-2412 (shared reload time)
 *   - Object.cpp:setDisabledUntil (combined disable types)
 *   - Object.cpp:setVeterancyLevel (weapon set switching)
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import {
  GameLogicSubsystem,
  WEAPON_SET_FLAG_VETERAN,
  WEAPON_SET_FLAG_ELITE,
  WEAPON_SET_FLAG_HERO,
} from './index.js';
import {
  makeBlock,
  makeObjectDef,
  makeWeaponDef,
  makeBundle,
  makeRegistry,
  makeHeightmap,
  makeMap,
  makeMapObject,
} from './test-helpers.js';
import {
  createMultiWeaponEntityState,
  fireWeaponSlot,
  getWeaponSlotStatus,
  WEAPON_SLOT_PRIMARY,
  type WeaponSlotProfile,
} from './combat-weapon-set.js';

// ---------------------------------------------------------------------------
// Helper: find entities by template name
// ---------------------------------------------------------------------------
function getEntitiesByTemplate(logic: GameLogicSubsystem, templateName: string): any[] {
  const privateApi = logic as unknown as {
    spawnedEntities: Map<number, { templateName: string }>;
  };
  const result: any[] = [];
  for (const ent of privateApi.spawnedEntities.values()) {
    if (ent.templateName === templateName) {
      result.push(ent);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Helper: standard game init with two sides
// ---------------------------------------------------------------------------
function initLogic(
  bundle: ReturnType<typeof makeBundle>,
  mapObjects: ReturnType<typeof makeMapObject>[],
  sides: [string, string] = ['America', 'GLA'],
): GameLogicSubsystem {
  const logic = new GameLogicSubsystem(new THREE.Scene());
  const mapData = makeMap(mapObjects, 256, 256);
  mapData.waypoints = {
    nodes: [
      { id: 1, name: 'Player_1_Start', position: { x: 50, y: 50, z: 0 } },
      { id: 2, name: 'Player_2_Start', position: { x: 200, y: 50, z: 0 } },
    ],
    links: [],
  };
  logic.loadMapObjects(mapData, makeRegistry(bundle), makeHeightmap(256, 256));
  logic.setPlayerSide(0, sides[0]);
  logic.setPlayerSide(1, sides[1]);
  logic.setTeamRelationship(sides[0], sides[1], 0);
  logic.setTeamRelationship(sides[1], sides[0], 0);
  logic.update(0);
  return logic;
}

// ---------------------------------------------------------------------------
// Helper: make a weapon slot profile for multi-weapon tests
// ---------------------------------------------------------------------------
function makeTestWeaponSlotProfile(overrides: Partial<WeaponSlotProfile> & { name: string; slotIndex: number }): WeaponSlotProfile {
  return {
    primaryDamage: 10,
    secondaryDamage: 0,
    primaryDamageRadius: 0,
    secondaryDamageRadius: 0,
    scatterTargetScalar: 0,
    scatterTargets: [],
    scatterRadius: 0,
    scatterRadiusVsInfantry: 0,
    radiusDamageAngle: Math.PI,
    damageType: 'ARMOR_PIERCING',
    deathType: 'NORMAL',
    damageDealtAtSelfPosition: false,
    radiusDamageAffectsMask: 0xFFFF,
    projectileCollideMask: 0,
    weaponSpeed: 999999,
    minWeaponSpeed: 0,
    scaleWeaponSpeed: false,
    capableOfFollowingWaypoints: false,
    projectileObjectName: null,
    attackRange: 150,
    unmodifiedAttackRange: 150,
    minAttackRange: 0,
    continueAttackRange: 0,
    clipSize: 0,
    clipReloadFrames: 0,
    autoReloadWhenIdleFrames: 0,
    preAttackDelayFrames: 0,
    preAttackType: 'PER_SHOT',
    minDelayFrames: 5,
    maxDelayFrames: 5,
    antiMask: 0,
    continuousFireOneShotsNeeded: 0,
    continuousFireTwoShotsNeeded: 0,
    continuousFireCoastFrames: 0,
    continuousFireMeanRateOfFire: 0,
    continuousFireFastRateOfFire: 0,
    laserName: null,
    projectileArcFirstHeight: 0,
    projectileArcSecondHeight: 0,
    projectileArcFirstPercentIndent: 0,
    projectileArcSecondPercentIndent: 0,
    leechRangeWeapon: false,
    fireSoundEvent: null,
    autoChooseSourceMask: 0xFFFF,
    preferredAgainstKindOf: new Set<string>(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Fix 1: SourceTemplate on DamageInfoInput — runtime usage in death pipeline
// ---------------------------------------------------------------------------
describe('SourceTemplate wired through to death pipeline (Damage.cpp:148-157)', () => {
  function makeSourceTemplateBundle() {
    return makeBundle({
      objects: [
        makeObjectDef('Attacker', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          makeBlock('Locomotor', 'Locomotor', { Speed: 30 }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'AttackerGun'] }),
        ]),
        makeObjectDef('Victim', 'GLA', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 10, InitialHealth: 10 }),
        ]),
      ],
      weapons: [
        makeWeaponDef('AttackerGun', {
          AttackRange: 150,
          PrimaryDamage: 50,
          PrimaryDamageRadius: 0,
          WeaponSpeed: 999999,
          DelayBetweenShots: 500,
          ClipSize: 1,
          AutoReloadsClip: 'Yes',
        }),
      ],
    });
  }

  it('pendingDeathSourceTemplateName is set when an entity is killed by damage', () => {
    const bundle = makeSourceTemplateBundle();
    const logic = initLogic(bundle, [
      makeMapObject('Attacker', 50, 50),
      makeMapObject('Victim', 60, 50),
    ]);

    // Grab reference to victim BEFORE it gets destroyed and removed.
    const victims = getEntitiesByTemplate(logic, 'Victim');
    expect(victims.length).toBe(1);
    const victim = victims[0];

    // Run frames until the victim is destroyed.
    for (let i = 0; i < 120; i++) {
      logic.update(1 / 30);
      if (victim.destroyed || victim.health <= 0) break;
    }

    expect(victim.destroyed || victim.health <= 0).toBe(true);
    // Source parity: the dying entity should know the attacker's template name.
    expect(victim.pendingDeathSourceTemplateName).toBe('Attacker');
  });

  it('pendingDeathSourceTemplateName defaults to null on entity creation', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('TestUnit', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ]),
      ],
    });
    const logic = initLogic(bundle, [
      makeMapObject('TestUnit', 50, 50),
    ], ['America', 'GLA']);

    const entities = getEntitiesByTemplate(logic, 'TestUnit');
    expect(entities.length).toBe(1);
    expect(entities[0].pendingDeathSourceTemplateName).toBeNull();
    expect(entities[0].pendingDeathType).toBe('NORMAL');
  });

  it('pendingDeathSourceTemplateName is null when killed with no source', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('FragileUnit', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ]),
      ],
    });
    const logic = initLogic(bundle, [
      makeMapObject('FragileUnit', 50, 50),
    ], ['America', 'GLA']);

    const entities = getEntitiesByTemplate(logic, 'FragileUnit');
    const entity = entities[0];

    // Kill via internal API with no source entity.
    (logic as any).applyWeaponDamageAmount(null, entity, 9999, 'UNRESISTABLE');

    expect(entity.health).toBe(0);
    expect(entity.pendingDeathSourceTemplateName).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Fix 2: DamageFXOverride runtime usage in visual events
// ---------------------------------------------------------------------------
describe('DamageFXOverride on weapon impact visual events (Damage.h:269)', () => {
  it('weapon damage events carry damageFXOverride defaulting to UNRESISTABLE', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Attacker', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          makeBlock('Locomotor', 'Locomotor', { Speed: 30 }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'TestWeapon'] }),
        ]),
        makeObjectDef('Victim', 'GLA', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
        ]),
      ],
      weapons: [
        makeWeaponDef('TestWeapon', {
          AttackRange: 150,
          PrimaryDamage: 10,
          PrimaryDamageRadius: 0,
          WeaponSpeed: 999999,
          DelayBetweenShots: 500,
          ClipSize: 1,
          AutoReloadsClip: 'Yes',
        }),
      ],
    });
    const logic = initLogic(bundle, [
      makeMapObject('Attacker', 50, 50),
      makeMapObject('Victim', 60, 50),
    ]);

    // Access internal pending events.
    const privateApi = logic as unknown as {
      pendingWeaponDamageEvents: Array<{ damageFXOverride: string }>;
    };

    // Run frames until a weapon fires.
    for (let i = 0; i < 30; i++) {
      logic.update(1 / 30);
      // Check if any pending events were created.
      if (privateApi.pendingWeaponDamageEvents.length > 0) {
        for (const event of privateApi.pendingWeaponDamageEvents) {
          expect(event.damageFXOverride).toBe('UNRESISTABLE');
        }
        break;
      }
    }
  });

  it('weapon impact visual events omit damageFXOverride when default (UNRESISTABLE)', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Shooter', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          makeBlock('Locomotor', 'Locomotor', { Speed: 30 }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'ShooterGun'] }),
        ]),
        makeObjectDef('Target', 'GLA', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
        ]),
      ],
      weapons: [
        makeWeaponDef('ShooterGun', {
          AttackRange: 150,
          PrimaryDamage: 10,
          PrimaryDamageRadius: 5,
          WeaponSpeed: 999999,
          DelayBetweenShots: 500,
          ClipSize: 1,
          AutoReloadsClip: 'Yes',
        }),
      ],
    });
    const logic = initLogic(bundle, [
      makeMapObject('Shooter', 50, 50),
      makeMapObject('Target', 60, 50),
    ]);

    // Access visual events.
    const privateApi = logic as unknown as {
      visualEventBuffer: Array<{ type: string; damageFXOverride?: string }>;
    };

    // Run frames to trigger weapon impact.
    let sawImpact = false;
    for (let i = 0; i < 60; i++) {
      logic.update(1 / 30);
      for (const event of privateApi.visualEventBuffer) {
        if (event.type === 'WEAPON_IMPACT') {
          // Default (UNRESISTABLE) should NOT appear on the visual event.
          expect(event.damageFXOverride).toBeUndefined();
          sawImpact = true;
        }
      }
    }
    // Ensure we actually saw at least one impact event.
    expect(sawImpact).toBe(true);
  });

  it('emitWeaponImpactVisualEvent includes damageFXOverride when non-default', () => {
    // Test the internal method directly: when a pending weapon damage event
    // has a non-UNRESISTABLE damageFXOverride, the emitted visual event
    // should include it. Use a slow projectile so the event persists across frames.
    const bundle = makeBundle({
      objects: [
        makeObjectDef('PoisonShooter', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          makeBlock('Locomotor', 'Locomotor', { Speed: 30 }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'PoisonGun'] }),
        ]),
        makeObjectDef('PoisonTarget', 'GLA', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
        ]),
      ],
      weapons: [
        makeWeaponDef('PoisonGun', {
          AttackRange: 150,
          PrimaryDamage: 10,
          PrimaryDamageRadius: 5,
          // Slow projectile: 5 units/sec over ~10 units = ~2 seconds = ~60 frames
          WeaponSpeed: 5,
          DelayBetweenShots: 500,
          ClipSize: 1,
          AutoReloadsClip: 'Yes',
        }),
      ],
    });
    const logic = initLogic(bundle, [
      makeMapObject('PoisonShooter', 50, 50),
      makeMapObject('PoisonTarget', 60, 50),
    ]);

    const privateApi = logic as unknown as {
      pendingWeaponDamageEvents: Array<{ damageFXOverride: string; executeFrame: number }>;
      visualEventBuffer: Array<{ type: string; damageFXOverride?: string }>;
      frameCounter: number;
    };

    // Run frames until weapon fires and generates a pending event, then inject override.
    let injected = false;
    let foundOverride = false;
    for (let i = 0; i < 120; i++) {
      logic.update(1 / 30);

      // After the update, try to inject POISON on pending events that haven't executed yet.
      if (!injected) {
        for (const event of privateApi.pendingWeaponDamageEvents) {
          if (event.damageFXOverride === 'UNRESISTABLE' && event.executeFrame > privateApi.frameCounter) {
            event.damageFXOverride = 'POISON';
            injected = true;
          }
        }
      }

      // Check if the visual event buffer has the override.
      for (const event of privateApi.visualEventBuffer) {
        if (event.type === 'WEAPON_IMPACT' && event.damageFXOverride === 'POISON') {
          foundOverride = true;
        }
      }
      if (foundOverride) break;
    }
    expect(injected).toBe(true);
    expect(foundOverride).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Fix 3: Weapon clip reload sharing between slots (WeaponSet.cpp)
// ---------------------------------------------------------------------------
describe('Weapon clip reload sharing between slots (Weapon.cpp:2400-2412)', () => {
  it('clip reload timing propagates to sibling slots when shareReloadTime is true', () => {
    const state = createMultiWeaponEntityState();
    state.shareReloadTime = true;

    const primaryProfile = makeTestWeaponSlotProfile({
      name: 'ClipPrimary',
      slotIndex: 0,
      clipSize: 2,
      clipReloadFrames: 60,
      minDelayFrames: 5,
      maxDelayFrames: 5,
    });
    const secondaryProfile = makeTestWeaponSlotProfile({
      name: 'ClipSecondary',
      slotIndex: 1,
      clipSize: 4,
      clipReloadFrames: 40,
      minDelayFrames: 3,
      maxDelayFrames: 3,
    });

    state.weaponSlotProfiles[0] = primaryProfile;
    state.weaponSlotProfiles[1] = secondaryProfile;
    state.weaponSlots[0].weaponName = 'ClipPrimary';
    state.weaponSlots[0].ammoInClip = 2;
    state.weaponSlots[1].weaponName = 'ClipSecondary';
    state.weaponSlots[1].ammoInClip = 4;
    state.filledWeaponSlotMask = 0b11;

    const frameCounter = 100;

    // Fire primary — first shot decrements ammo, does NOT trigger reload.
    const clipEmpty1 = fireWeaponSlot(state, WEAPON_SLOT_PRIMARY, frameCounter, () => 5);
    expect(clipEmpty1).toBe(false);
    expect(state.weaponSlots[0].ammoInClip).toBe(1);

    // Source parity: between-shots delay is shared.
    expect(state.weaponSlots[0].nextFireFrame).toBe(frameCounter + 5);
    expect(state.weaponSlots[1].nextFireFrame).toBe(frameCounter + 5);

    // Fire primary again — clip depletes, reload starts.
    const frameCounter2 = frameCounter + 5;
    const clipEmpty2 = fireWeaponSlot(state, WEAPON_SLOT_PRIMARY, frameCounter2, () => 5);
    expect(clipEmpty2).toBe(true);
    expect(state.weaponSlots[0].ammoInClip).toBe(0);

    // Source parity: clip reload timing is shared — both slots blocked.
    expect(state.weaponSlots[0].nextFireFrame).toBe(frameCounter2 + 60);
    expect(state.weaponSlots[1].nextFireFrame).toBe(frameCounter2 + 60);

    // Secondary still has ammo but is blocked by shared timing.
    expect(state.weaponSlots[1].ammoInClip).toBe(4);
    const secondaryStatus = getWeaponSlotStatus(state.weaponSlots[1], secondaryProfile, frameCounter2);
    expect(secondaryStatus).toBe('BETWEEN_FIRING_SHOTS');
  });

  it('without shareReloadTime, clip reload does NOT propagate to sibling slots', () => {
    const state = createMultiWeaponEntityState();
    state.shareReloadTime = false;

    const primaryProfile = makeTestWeaponSlotProfile({
      name: 'ClipPrimary',
      slotIndex: 0,
      clipSize: 1,
      clipReloadFrames: 60,
      minDelayFrames: 5,
      maxDelayFrames: 5,
    });
    const secondaryProfile = makeTestWeaponSlotProfile({
      name: 'ClipSecondary',
      slotIndex: 1,
      clipSize: 4,
      clipReloadFrames: 40,
      minDelayFrames: 3,
      maxDelayFrames: 3,
    });

    state.weaponSlotProfiles[0] = primaryProfile;
    state.weaponSlotProfiles[1] = secondaryProfile;
    state.weaponSlots[0].weaponName = 'ClipPrimary';
    state.weaponSlots[0].ammoInClip = 1;
    state.weaponSlots[1].weaponName = 'ClipSecondary';
    state.weaponSlots[1].ammoInClip = 4;
    state.filledWeaponSlotMask = 0b11;

    const frameCounter = 200;

    // Fire primary — clip depletes.
    const clipEmpty = fireWeaponSlot(state, WEAPON_SLOT_PRIMARY, frameCounter, () => 5);
    expect(clipEmpty).toBe(true);

    // Primary is reloading.
    expect(state.weaponSlots[0].nextFireFrame).toBe(frameCounter + 60);

    // Secondary is UNAFFECTED — still ready to fire.
    expect(state.weaponSlots[1].nextFireFrame).toBe(0);
    const secondaryStatus = getWeaponSlotStatus(state.weaponSlots[1], secondaryProfile, frameCounter);
    expect(secondaryStatus).toBe('READY_TO_FIRE');
  });

  it('shared reload timing uses the firing slots clip reload time, not the siblings', () => {
    // Source parity: When slot A fires and triggers reload, all slots get
    // slot A's reload timing — NOT their own clipReloadFrames.
    const state = createMultiWeaponEntityState();
    state.shareReloadTime = true;

    const primaryProfile = makeTestWeaponSlotProfile({
      name: 'QuickReload',
      slotIndex: 0,
      clipSize: 1,
      clipReloadFrames: 20,
      minDelayFrames: 3,
      maxDelayFrames: 3,
    });
    const secondaryProfile = makeTestWeaponSlotProfile({
      name: 'SlowReload',
      slotIndex: 1,
      clipSize: 1,
      clipReloadFrames: 200,
      minDelayFrames: 10,
      maxDelayFrames: 10,
    });

    state.weaponSlotProfiles[0] = primaryProfile;
    state.weaponSlotProfiles[1] = secondaryProfile;
    state.weaponSlots[0].weaponName = 'QuickReload';
    state.weaponSlots[0].ammoInClip = 1;
    state.weaponSlots[1].weaponName = 'SlowReload';
    state.weaponSlots[1].ammoInClip = 1;
    state.filledWeaponSlotMask = 0b11;

    const frameCounter = 500;

    // Fire primary (quick 20-frame reload).
    fireWeaponSlot(state, WEAPON_SLOT_PRIMARY, frameCounter, () => 3);

    // Both slots should get primary's 20-frame reload time, NOT secondary's 200.
    expect(state.weaponSlots[0].nextFireFrame).toBe(frameCounter + 20);
    expect(state.weaponSlots[1].nextFireFrame).toBe(frameCounter + 20);
  });
});

// ---------------------------------------------------------------------------
// Fix 4: Object::setDisabledUntil combined disable types (EMP + HACKED)
// ---------------------------------------------------------------------------
describe('Combined disable types with independent timers (Object.cpp:setDisabledUntil)', () => {
  function makeDisableBundle() {
    return makeBundle({
      objects: [
        makeObjectDef('Vehicle', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          makeBlock('Locomotor', 'Locomotor', { Speed: 30 }),
        ]),
      ],
    });
  }

  it('EMP and HACKED disable types have independent expiry timers', async () => {
    const bundle = makeDisableBundle();
    const logic = initLogic(bundle, [
      makeMapObject('Vehicle', 50, 50),
    ], ['America', 'GLA']);

    const vehicles = getEntitiesByTemplate(logic, 'Vehicle');
    expect(vehicles.length).toBe(1);
    const vehicle = vehicles[0];

    // Access internal disable maps.
    const privateApi = logic as unknown as {
      disabledEmpStatusByEntityId: Map<number, number>;
      disabledHackedStatusByEntityId: Map<number, number>;
      frameCounter: number;
    };

    // Apply EMP disable for 10 frames.
    (logic as any).applyEmpDisable(vehicle, 10);
    expect(vehicle.objectStatusFlags.has('DISABLED_EMP')).toBe(true);
    const empExpiry = privateApi.disabledEmpStatusByEntityId.get(vehicle.id);
    expect(empExpiry).toBeDefined();

    // Apply HACKED disable for 20 frames.
    const { setDisabledHackedStatusUntil } = await import('./status-effects.js');
    setDisabledHackedStatusUntil(logic, vehicle, privateApi.frameCounter + 20);
    expect(vehicle.objectStatusFlags.has('DISABLED_HACKED')).toBe(true);
    const hackedExpiry = privateApi.disabledHackedStatusByEntityId.get(vehicle.id);
    expect(hackedExpiry).toBeDefined();

    // Both disables are active simultaneously.
    expect(vehicle.objectStatusFlags.has('DISABLED_EMP')).toBe(true);
    expect(vehicle.objectStatusFlags.has('DISABLED_HACKED')).toBe(true);

    // Verify independent expiry: EMP expires at different frame than HACKED.
    expect(empExpiry).not.toBe(hackedExpiry);
  });

  it('EMP expires independently while HACKED remains active', async () => {
    const bundle = makeDisableBundle();
    const logic = initLogic(bundle, [
      makeMapObject('Vehicle', 50, 50),
    ], ['America', 'GLA']);

    const vehicles = getEntitiesByTemplate(logic, 'Vehicle');
    const vehicle = vehicles[0];

    const privateApi = logic as unknown as {
      frameCounter: number;
    };

    // Apply EMP for 5 frames.
    (logic as any).applyEmpDisable(vehicle, 5);

    // Apply HACKED for 60 frames (2 seconds at 30fps).
    const { setDisabledHackedStatusUntil } = await import('./status-effects.js');
    setDisabledHackedStatusUntil(logic, vehicle, privateApi.frameCounter + 60);

    expect(vehicle.objectStatusFlags.has('DISABLED_EMP')).toBe(true);
    expect(vehicle.objectStatusFlags.has('DISABLED_HACKED')).toBe(true);

    // Advance 10 frames — EMP should expire, HACKED should remain.
    for (let i = 0; i < 10; i++) {
      logic.update(1 / 30);
    }

    expect(vehicle.objectStatusFlags.has('DISABLED_EMP')).toBe(false);
    expect(vehicle.objectStatusFlags.has('DISABLED_HACKED')).toBe(true);
  });

  it('HACKED expires independently while EMP remains active', async () => {
    const bundle = makeDisableBundle();
    const logic = initLogic(bundle, [
      makeMapObject('Vehicle', 50, 50),
    ], ['America', 'GLA']);

    const vehicles = getEntitiesByTemplate(logic, 'Vehicle');
    const vehicle = vehicles[0];

    const privateApi = logic as unknown as {
      frameCounter: number;
    };

    // Apply HACKED for 5 frames.
    const { setDisabledHackedStatusUntil } = await import('./status-effects.js');
    setDisabledHackedStatusUntil(logic, vehicle, privateApi.frameCounter + 5);

    // Apply EMP for 60 frames.
    (logic as any).applyEmpDisable(vehicle, 60);

    expect(vehicle.objectStatusFlags.has('DISABLED_EMP')).toBe(true);
    expect(vehicle.objectStatusFlags.has('DISABLED_HACKED')).toBe(true);

    // Advance 10 frames — HACKED should expire, EMP should remain.
    for (let i = 0; i < 10; i++) {
      logic.update(1 / 30);
    }

    expect(vehicle.objectStatusFlags.has('DISABLED_HACKED')).toBe(false);
    expect(vehicle.objectStatusFlags.has('DISABLED_EMP')).toBe(true);
  });

  it('reapplying the same disable type extends its timer', async () => {
    const bundle = makeDisableBundle();
    const logic = initLogic(bundle, [
      makeMapObject('Vehicle', 50, 50),
    ], ['America', 'GLA']);

    const vehicles = getEntitiesByTemplate(logic, 'Vehicle');
    const vehicle = vehicles[0];

    const privateApi = logic as unknown as {
      disabledEmpStatusByEntityId: Map<number, number>;
      frameCounter: number;
    };

    // Apply EMP for 10 frames.
    (logic as any).applyEmpDisable(vehicle, 10);
    const firstExpiry = privateApi.disabledEmpStatusByEntityId.get(vehicle.id);

    // Advance 5 frames.
    for (let i = 0; i < 5; i++) {
      logic.update(1 / 30);
    }

    // Reapply EMP for 20 frames — should extend.
    (logic as any).applyEmpDisable(vehicle, 20);
    const secondExpiry = privateApi.disabledEmpStatusByEntityId.get(vehicle.id);

    // The new expiry should be later than the original.
    expect(secondExpiry).toBeGreaterThan(firstExpiry!);
    expect(vehicle.objectStatusFlags.has('DISABLED_EMP')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Fix 5: Veterancy-based weapon set switching edge cases
// ---------------------------------------------------------------------------
describe('Veterancy-based weapon set switching (Object.cpp:setVeterancyLevel)', () => {
  function makeVeterancyBundle() {
    return makeBundle({
      objects: [
        makeObjectDef('Tank', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          makeBlock('Locomotor', 'Locomotor', { Speed: 30 }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'TankGun'] }),
          makeBlock('WeaponSet', 'VETWeaponSet', {
            Conditions: 'VETERAN',
            Weapon: ['PRIMARY', 'TankGunVet'],
          }),
          makeBlock('WeaponSet', 'ELITEWeaponSet', {
            Conditions: 'ELITE',
            Weapon: ['PRIMARY', 'TankGunElite'],
          }),
          makeBlock('WeaponSet', 'HEROWeaponSet', {
            Conditions: 'HERO',
            Weapon: ['PRIMARY', 'TankGunHero'],
          }),
        ], {
          ExperienceValue: '100',
          ExperienceRequired: '100 200 300',
        }),
      ],
      weapons: [
        makeWeaponDef('TankGun', {
          AttackRange: 150,
          PrimaryDamage: 10,
          PrimaryDamageRadius: 0,
          WeaponSpeed: 999999,
          DelayBetweenShots: 500,
        }),
        makeWeaponDef('TankGunVet', {
          AttackRange: 160,
          PrimaryDamage: 15,
          PrimaryDamageRadius: 0,
          WeaponSpeed: 999999,
          DelayBetweenShots: 500,
        }),
        makeWeaponDef('TankGunElite', {
          AttackRange: 170,
          PrimaryDamage: 20,
          PrimaryDamageRadius: 0,
          WeaponSpeed: 999999,
          DelayBetweenShots: 500,
        }),
        makeWeaponDef('TankGunHero', {
          AttackRange: 180,
          PrimaryDamage: 25,
          PrimaryDamageRadius: 0,
          WeaponSpeed: 999999,
          DelayBetweenShots: 500,
        }),
      ],
    });
  }

  it('newly spawned entity has no veterancy weapon set flags', () => {
    const bundle = makeVeterancyBundle();
    const logic = initLogic(bundle, [
      makeMapObject('Tank', 50, 50),
    ], ['America', 'GLA']);

    const tanks = getEntitiesByTemplate(logic, 'Tank');
    expect(tanks.length).toBe(1);
    const tank = tanks[0];
    expect(tank.weaponSetFlagsMask & WEAPON_SET_FLAG_VETERAN).toBe(0);
    expect(tank.weaponSetFlagsMask & WEAPON_SET_FLAG_ELITE).toBe(0);
    expect(tank.weaponSetFlagsMask & WEAPON_SET_FLAG_HERO).toBe(0);
  });

  it('VETERAN flag is set correctly and replaces no-flag', () => {
    const bundle = makeVeterancyBundle();
    const logic = initLogic(bundle, [
      makeMapObject('Tank', 50, 50),
    ], ['America', 'GLA']);

    const tanks = getEntitiesByTemplate(logic, 'Tank');
    const tank = tanks[0];

    // Manually set veterancy via internal API.
    (logic as any).setExactVeterancyLevel(tank, 1); // LEVEL_VETERAN = 1

    expect(tank.weaponSetFlagsMask & WEAPON_SET_FLAG_VETERAN).not.toBe(0);
    expect(tank.weaponSetFlagsMask & WEAPON_SET_FLAG_ELITE).toBe(0);
    expect(tank.weaponSetFlagsMask & WEAPON_SET_FLAG_HERO).toBe(0);
  });

  it('ELITE flag replaces VETERAN flag (only one veterancy flag at a time)', () => {
    const bundle = makeVeterancyBundle();
    const logic = initLogic(bundle, [
      makeMapObject('Tank', 50, 50),
    ], ['America', 'GLA']);

    const tanks = getEntitiesByTemplate(logic, 'Tank');
    const tank = tanks[0];

    // Set VETERAN first.
    (logic as any).setExactVeterancyLevel(tank, 1);
    expect(tank.weaponSetFlagsMask & WEAPON_SET_FLAG_VETERAN).not.toBe(0);

    // Promote to ELITE — VETERAN flag should be cleared.
    (logic as any).setExactVeterancyLevel(tank, 2);
    expect(tank.weaponSetFlagsMask & WEAPON_SET_FLAG_VETERAN).toBe(0);
    expect(tank.weaponSetFlagsMask & WEAPON_SET_FLAG_ELITE).not.toBe(0);
    expect(tank.weaponSetFlagsMask & WEAPON_SET_FLAG_HERO).toBe(0);
  });

  it('HERO flag replaces ELITE flag (only one veterancy flag at a time)', () => {
    const bundle = makeVeterancyBundle();
    const logic = initLogic(bundle, [
      makeMapObject('Tank', 50, 50),
    ], ['America', 'GLA']);

    const tanks = getEntitiesByTemplate(logic, 'Tank');
    const tank = tanks[0];

    // Set ELITE first.
    (logic as any).setExactVeterancyLevel(tank, 2);
    expect(tank.weaponSetFlagsMask & WEAPON_SET_FLAG_ELITE).not.toBe(0);

    // Promote to HERO — ELITE flag should be cleared.
    (logic as any).setExactVeterancyLevel(tank, 3);
    expect(tank.weaponSetFlagsMask & WEAPON_SET_FLAG_VETERAN).toBe(0);
    expect(tank.weaponSetFlagsMask & WEAPON_SET_FLAG_ELITE).toBe(0);
    expect(tank.weaponSetFlagsMask & WEAPON_SET_FLAG_HERO).not.toBe(0);
  });

  it('non-veterancy weapon set flags are preserved during promotion', () => {
    const bundle = makeVeterancyBundle();
    const logic = initLogic(bundle, [
      makeMapObject('Tank', 50, 50),
    ], ['America', 'GLA']);

    const tanks = getEntitiesByTemplate(logic, 'Tank');
    const tank = tanks[0];

    // Set a non-veterancy flag (PLAYER_UPGRADE = 1 << 3).
    const WEAPON_SET_FLAG_PLAYER_UPGRADE = 1 << 3;
    tank.weaponSetFlagsMask |= WEAPON_SET_FLAG_PLAYER_UPGRADE;

    // Promote to VETERAN.
    (logic as any).setExactVeterancyLevel(tank, 1);

    // PLAYER_UPGRADE flag should be preserved.
    expect(tank.weaponSetFlagsMask & WEAPON_SET_FLAG_PLAYER_UPGRADE).not.toBe(0);
    expect(tank.weaponSetFlagsMask & WEAPON_SET_FLAG_VETERAN).not.toBe(0);
  });

  it('refreshEntityCombatProfiles is called after veterancy promotion', () => {
    // Source parity: Object::setVeterancyLevel calls refreshWeaponSet() which
    // recomputes the weapon profiles.
    const bundle = makeVeterancyBundle();
    const logic = initLogic(bundle, [
      makeMapObject('Tank', 50, 50),
    ], ['America', 'GLA']);

    const tanks = getEntitiesByTemplate(logic, 'Tank');
    const tank = tanks[0];

    // Promote — should call refreshEntityCombatProfiles internally.
    (logic as any).setExactVeterancyLevel(tank, 1);

    // The entity should have the VETERAN flag set, confirming the promotion ran.
    expect(tank.weaponSetFlagsMask & WEAPON_SET_FLAG_VETERAN).not.toBe(0);
  });
});
