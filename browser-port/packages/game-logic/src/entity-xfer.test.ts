import { describe, expect, it } from 'vitest';

import { XferSave, XferLoad, XferCrc } from '@generals/engine';
import {
  buildSourceMapEntityChunk,
  createEmptySourceMapEntitySaveState,
  inspectMapEntityChunkLayout,
  parseSourceMapEntityChunk,
  xferMapEntity,
} from './entity-xfer.js';
import type { SourceMapEntitySaveState } from './entity-xfer.js';

/**
 * Create a minimal MapEntity-like object with all required properties set to defaults.
 */
function createTestEntity(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    // Identity
    id: 1,
    templateName: 'TestUnit',
    scriptName: null,
    category: 'vehicle',
    kindOf: new Set<string>(['VEHICLE', 'CAN_ATTACK']),
    side: 'USA',
    originalOwningSide: 'USA',
    capturedFromOriginalOwner: false,
    undetectedDefectorUntilFrame: 0,
    defectorHelperDetectionStartFrame: 0,
    defectorHelperDetectionEndFrame: 0,
    defectorHelperFlashPhase: 0,
    defectorHelperDoFx: false,
    repulsorHelperUntilFrame: 0,
    statusDamageStatusName: null,
    statusDamageClearFrame: 0,
    controllingPlayerToken: 'player1',
    resolved: true,
    bridgeFlags: 0,
    mapCellX: 10,
    mapCellZ: 20,
    renderAssetCandidates: ['models/tank.w3d'],
    renderAssetPath: 'models/tank.w3d',
    renderAssetResolved: true,
    renderAnimationStateClips: undefined,

    // Transform
    x: 100.5,
    y: 10.0,
    z: 200.5,
    rotationY: 1.57,
    animationState: 'IDLE',
    baseHeight: 10.0,
    nominalHeight: 12.0,

    // Flags
    selected: false,
    canMove: true,
    energyBonus: 0,
    energyUpgradeBonus: 0,
    crusherLevel: 2,
    crushableLevel: 1,
    canBeSquished: false,
    isUnmanned: false,
    attackNeedsLineOfSight: true,
    isImmobile: false,
    noCollisions: false,
    isIndestructible: false,
    receivingDifficultyBonus: false,
    scriptAiRecruitable: true,
    scriptAttackPrioritySetName: '',
    scriptAttitude: 0,
    keepObjectOnDeath: false,

    // Body / Health
    bodyType: 'ActiveBody',
    hiveStructureProfile: null,
    undeadSecondLifeMaxHealth: 0,
    undeadIsSecondLife: false,
    canTakeDamage: true,
    maxHealth: 400,
    initialHealth: 400,
    health: 350,

    // Weapons
    attackWeapon: { weaponName: 'TankGun', damage: 50 },
    weaponTemplateSets: [{ slots: [{ weaponName: 'TankGun' }] }],
    weaponSetFlagsMask: 1,
    weaponBonusConditionFlags: 0,
    armorTemplateSets: [{ armorName: 'TankArmor' }],
    armorSetFlagsMask: 0,
    armorDamageCoefficients: new Map([['EXPLOSION', 0.8], ['SMALL_ARMS', 0.3]]),
    attackTargetEntityId: 42,
    attackTargetPosition: { x: 150.0, z: 250.0 },
    attackOriginalVictimPosition: null,
    attackCommandSource: 'PLAYER',
    lastCommandSource: 'PLAYER',
    attackSubState: 'FIRING',
    nextAttackFrame: 100,
    lastShotFrame: 0,
    lastShotFrameBySlot: [0, 0, 0] as [number, number, number],
    attackWeaponSlotIndex: 0,
    attackCooldownRemaining: 5,
    attackAmmoInClip: 3,
    attackReloadFinishFrame: 0,
    attackForceReloadFrame: 0,
    forcedWeaponSlot: null,
    weaponLockStatus: 'NOT_LOCKED',
    maxShotsRemaining: -1,
    leechRangeActive: false,
    turretProfiles: [],
    turretStates: [],
    attackScatterTargetsUnused: [],
    preAttackFinishFrame: 0,
    consecutiveShotsTargetEntityId: null,
    consecutiveShotsAtTarget: 0,
    continuousFireState: 'NONE',
    continuousFireCooldownFrame: 0,
    sneakyOffsetWhenAttacking: 0,
    attackersMissPersistFrames: 0,
    attackersMissExpireFrame: 0,

    // Production
    productionProfile: null,
    productionQueue: [],
    productionNextId: 1,
    queueProductionExitProfile: null,
    rallyPoint: null,
    parkingPlaceProfile: null,
    containProfile: null,
    riderChangeContainProfile: null,
    scriptEvacDisposition: 0,
    queueProductionExitDelayFramesRemaining: 0,
    queueProductionExitBurstRemaining: 0,

    // Containment
    parkingSpaceProducerId: null,
    helixCarrierId: null,
    garrisonContainerId: null,
    containPlayerEnteredSide: null,
    containPlayerEnteredToken: null,
    transportContainerId: null,
    tunnelContainerId: null,
    tunnelEnteredFrame: 0,
    tunnelFadeStartFrame: 0,
    healContainEnteredFrame: 0,
    helixPortableRiderId: null,

    // Slaves
    slaverEntityId: null,
    spawnBehaviorState: null,

    // Movement
    largestWeaponRange: 150.0,
    totalWeaponAntiMask: 0,
    locomotorSets: new Map([['DEFAULT', { speed: 30 }]]),
    completedUpgrades: new Set(['UpgradeArmor']),
    locomotorUpgradeTriggers: new Set<string>(),
    executedUpgradeModules: new Set<string>(),
    upgradeModules: [],
    objectStatusFlags: new Set(['IMMOBILE']),
    modelConditionFlags: new Set<string>(),
    scriptFlashCount: 0,
    scriptFlashColor: 0,
    scriptAmbientSoundEnabled: true,
    scriptAmbientSoundRevision: 0,
    ambientSoundProfile: null,
    ambientSoundForcedOffExceptRubble: false,
    ambientSoundCustomState: null,
    customIndicatorColor: null,
    healthBoxOffset: { x: 1, y: 2, z: 3 },
    commandSetStringOverride: null,
    locomotorUpgradeEnabled: false,
    activeLocomotorSet: 'DEFAULT',
    locomotorSurfaceMask: 1,
    locomotorDownhillOnly: false,

    // Special Powers
    specialPowerModules: new Map(),
    lastSpecialPowerDispatch: null,

    // Pathfinding
    pathDiameter: 20.0,
    pathfindCenterInCell: false,
    blocksPath: true,
    geometryMajorRadius: 15.0,
    obstacleGeometry: null,
    obstacleFootprint: 0,
    ignoredMovementObstacleId: null,
    movePath: [{ x: 110, z: 210 }, { x: 120, z: 220 }],
    pathIndex: 0,
    moving: true,
    speed: 30.0,
    currentSpeed: 25.0,
    moveTarget: { x: 120, z: 220 },
    scriptStoppingDistanceOverride: null,
    pathfindGoalCell: { x: 12, z: 22 },
    pathfindPosCell: { x: 10, z: 20 },

    // Economy
    supplyWarehouseProfile: null,
    supplyTruckProfile: null,
    chinookAIProfile: null,
    chinookFlightStatus: null,
    chinookFlightStatusEnteredFrame: 0,
    chinookHealingAirfieldId: 0,
    chinookPendingCommand: null,
    pendingEnterState: null,
    chinookCombatDropState: null,
    chinookRappelState: null,
    repairDockState: null,
    repairDockLastRepairEntityId: 0,
    repairDockHealthToAddPerFrame: 0,
    repairDockProfile: null,
    commandButtonHuntProfile: null,
    commandButtonHuntMode: 'NONE',
    commandButtonHuntButtonName: '',
    commandButtonHuntNextScanFrame: 0,
    dozerAIProfile: null,
    dozerIdleTooLongTimestamp: 0,
    dozerBuildTargetEntityId: 0,
    dozerBuildTaskOrderFrame: 0,
    dozerRepairTargetEntityId: 0,
    dozerRepairTaskOrderFrame: 0,
    isSupplyCenter: false,

    // Experience
    experienceProfile: { levels: [0, 100, 300, 600] },
    experienceState: { currentXP: 150, level: 1 },

    // Vision
    visionRange: 200.0,
    shroudClearingRange: 250.0,
    visionState: { revealed: true },
    stealthProfile: null,
    stealthDelayRemaining: 0,
    detectedUntilFrame: 0,
    lastDamageFrame: 0,
    lastDamageNoEffect: false,
    lastAttackerEntityId: null,
    scriptLastDamageSourceEntityId: null,
    scriptLastDamageSourceTemplateName: null,
    scriptLastDamageSourceSide: null,
    lastDamageInfoFrame: 0,
    detectorProfile: null,
    detectorEnabled: false,
    detectorNextScanFrame: 0,

    // Healing
    autoHealProfile: null,
    autoHealNextFrame: 88,
    autoHealSoonestHealFrame: 77,
    autoHealStopped: true,
    autoHealDamageDelayUntilFrame: 99,
    baseRegenDelayUntilFrame: 0,
    propagandaTowerProfile: null,
    propagandaTowerNextScanFrame: 0,
    propagandaTowerTrackedIds: [],
    soleHealingBenefactorId: null,
    soleHealingBenefactorExpirationFrame: 0,
    autoTargetScanNextFrame: 0,

    // Guard
    guardState: 'NONE',
    guardPositionX: 0,
    guardPositionZ: 0,
    guardObjectId: 0,
    guardAreaTriggerIndex: -1,
    guardMode: 0,
    guardNextScanFrame: 0,
    guardChaseExpireFrame: 0,
    guardInnerRange: 0,
    guardOuterRange: 0,
    guardRetaliating: false,
    tunnelNetworkGuardState: 'NONE',
    temporaryMoveExpireFrame: 0,

    // Poison
    poisonedBehaviorProfile: null,
    poisonDamageAmount: 0,
    poisonNextDamageFrame: 0,
    poisonExpireFrame: 0,

    // Fire
    flameStatus: 'NORMAL',
    flameDamageAccumulated: 0,
    flameEndFrame: 0,
    flameBurnedEndFrame: 0,
    flameDamageNextFrame: 0,
    flameLastDamageReceivedFrame: 0,
    flammableProfile: null,
    fireSpreadProfile: null,
    fireSpreadNextFrame: 0,

    // Mines
    minefieldProfile: null,
    mineVirtualMinesRemaining: 0,
    mineImmunes: [],
    mineDetonators: [],
    mineScootFramesLeft: 0,
    mineDraining: false,
    mineRegenerates: false,
    mineNextDeathCheckFrame: 0,
    mineIgnoreDamage: false,
    mineCreatorId: 0,

    // Fire weapon collide
    fireWeaponCollideProfiles: [],

    // Eject
    ejectPilotTemplateName: null,
    ejectPilotMinVeterancy: 1,

    // Prone
    proneDamageToFramesRatio: null,
    proneFramesRemaining: 0,

    // Demo Trap
    demoTrapProfile: null,
    demoTrapNextScanFrame: 0,
    demoTrapDetonated: false,
    demoTrapProximityMode: false,

    // Rebuild Hole
    rebuildHoleExposeDieProfile: null,
    rebuildHoleProfile: null,
    rebuildHoleWorkerEntityId: 0,
    rebuildHoleReconstructingEntityId: 0,
    rebuildHoleSpawnerEntityId: 0,
    rebuildHoleWorkerWaitCounter: 0,
    rebuildHoleRebuildTemplateName: '',
    rebuildHoleMasked: false,

    // Auto Deposit
    autoDepositProfile: null,
    autoDepositNextFrame: 0,
    autoDepositInitialized: false,
    autoDepositCaptureBonusPending: false,

    // Auto Find Healing
    autoFindHealingProfile: null,
    autoFindHealingNextScanFrame: 0,

    // Death OCL
    deathOCLEntries: [],

    // Construction
    constructionPercent: -1,
    builderId: 0,
    buildTotalFrames: 0,

    // Deploy
    deployStyleProfile: null,
    deployState: 'UNDEPLOY',
    deployFrameToWait: 0,

    // Special Ability
    specialAbilityProfile: null,
    specialAbilityState: null,

    // Destroyed
    destroyed: false,
    pendingDeathType: '',
    lifetimeDieFrame: null,
    heightDieProfile: null,
    heightDieActiveFrame: 0,
    heightDieLastY: 0,
    deletionDieFrame: null,

    // Sticky Bomb
    stickyBombProfile: null,
    stickyBombTargetId: 0,
    stickyBombDieFrame: 0,

    // Fire When Damaged
    fireWhenDamagedProfiles: [],

    // Fire Weapon Update
    fireWeaponUpdateProfiles: [],
    fireWeaponUpdateNextFireFrames: [],
    lastShotFiredFrame: 0,

    // OCL Update
    oclUpdateProfiles: [],
    oclUpdateNextCreationFrames: [],
    oclUpdateTimerStarted: [],
    oclUpdateTimerStartedFrames: [],
    oclUpdateFactionNeutral: [],
    oclUpdateFactionOwnerSide: [],
    oclUpdateCurrentPlayerColors: [],

    // Weapon Bonus Update
    weaponBonusUpdateProfiles: [],
    weaponBonusUpdateNextPulseFrames: [],
    tempWeaponBonusFlag: 0,
    tempWeaponBonusExpiryFrame: 0,

    // Death behaviors
    instantDeathProfiles: [],
    fireWeaponWhenDeadProfiles: [],
    slowDeathProfiles: [],
    slowDeathState: null,
    structureCollapseProfile: null,
    structureCollapseState: null,

    // EMP
    empUpdateProfile: null,
    empUpdateState: null,

    // Hijacker
    hijackerUpdateProfile: null,
    hijackerState: null,

    // Leaflet
    leafletDropProfile: null,
    leafletDropState: null,

    // Smart Bomb
    smartBombProfile: null,
    smartBombState: null,

    // Dynamic Geometry
    dynamicGeometryProfile: null,
    dynamicGeometryState: null,

    // Fire OCL After Cooldown
    fireOCLAfterCooldownProfiles: [],
    fireOCLAfterCooldownStates: [],

    // Neutron Blast
    neutronBlastProfile: null,

    // Bunker Buster
    bunkerBusterProfile: null,
    bunkerBusterVictimId: null,

    // Grant Stealth
    grantStealthProfile: null,
    grantStealthCurrentRadius: 0,

    // Neutron Missile Slow Death
    neutronMissileSlowDeathProfile: null,
    neutronMissileSlowDeathState: null,

    // Heli/Jet Slow Death
    helicopterSlowDeathProfiles: [],
    helicopterSlowDeathState: null,
    jetSlowDeathProfiles: [],
    jetSlowDeathState: null,

    // Cleanup Hazard
    cleanupHazardProfile: null,
    cleanupHazardState: null,

    // Misc Profiles
    assistedTargetingProfile: null,
    techBuildingProfile: null,
    supplyWarehouseCripplingProfile: null,
    swCripplingHealSuppressedUntilFrame: 0,
    swCripplingNextHealFrame: 0,
    swCripplingDockDisabled: false,
    generateMinefieldProfile: null,
    generateMinefieldDone: false,
    createCrateDieProfile: null,
    salvageCrateProfile: null,
    crateCollideProfile: null,

    // Battle Plan
    battlePlanProfile: null,
    battlePlanState: null,
    battlePlanDamageScalar: 1.0,
    baseVisionRange: 200.0,
    baseShroudClearingRange: 250.0,

    // PDL
    pointDefenseLaserProfile: null,
    pdlNextScanFrame: 0,
    pdlTargetProjectileVisualId: 0,
    pdlNextShotFrame: 0,

    // Horde
    hordeProfile: null,
    hordeNextCheckFrame: 0,
    isInHorde: false,
    isTrueHordeMember: false,

    // Enemy Near
    enemyNearScanDelayFrames: 60,
    enemyNearNextScanCountdown: 30,
    enemyNearDetected: false,

    // Slaved
    slavedUpdateProfile: null,
    slaveGuardOffsetX: 0,
    slaveGuardOffsetZ: 0,
    slavedNextUpdateFrame: 0,
    countermeasuresProfile: null,
    countermeasuresState: null,

    // Pilot Find Vehicle
    pilotFindVehicleProfile: null,
    pilotFindVehicleNextScanFrame: 0,
    pilotFindVehicleDidMoveToBase: false,
    pilotFindVehicleTargetId: null,

    // Topple
    toppleProfile: null,
    toppleState: 'STANDING',
    toppleDirX: 0,
    toppleDirZ: 0,
    toppleAngularVelocity: 0,
    toppleAngularAccumulation: 0,
    toppleSpeed: 0,

    // Physics
    physicsBehaviorProfile: null,
    physicsBehaviorState: null,

    // Structure Topple
    structureToppleProfile: null,
    structureToppleState: null,

    // Missile Launcher Building
    missileLauncherBuildingProfile: null,
    missileLauncherBuildingState: null,

    // Particle Uplink Cannon
    particleUplinkCannonProfile: null,
    particleUplinkCannonState: null,

    // Neutron Missile Update
    neutronMissileUpdateProfile: null,
    neutronMissileUpdateState: null,

    // Radar
    radarUpdateProfile: null,
    radarExtendDoneFrame: 0,
    radarExtendComplete: false,
    radarActive: false,

    // Float
    floatUpdateProfile: null,

    // Wander
    hasWanderAI: false,
    scriptWanderInPlaceActive: false,
    scriptWanderInPlaceOriginX: 0,
    scriptWanderInPlaceOriginZ: 0,

    // Create Modules
    veterancyGainCreateProfiles: [],
    fxListDieProfiles: [],
    crushDieProfiles: [],
    destroyDieProfiles: [],
    damDieProfiles: [],
    specialPowerCompletionDieProfiles: [],
    specialPowerCompletionCreatorId: 0,
    specialPowerCompletionCreatorSet: false,
    frontCrushed: false,
    backCrushed: false,
    grantUpgradeCreateProfiles: [],
    lockWeaponCreateSlot: null,

    // Upgrade Die
    upgradeDieProfiles: [],
    producerEntityId: 0,

    // Checkpoint
    checkpointProfile: null,
    checkpointAllyNear: false,
    checkpointEnemyNear: false,
    checkpointMaxMinorRadius: 0,
    checkpointScanCountdown: 0,

    // Dynamic Shroud
    dynamicShroudProfile: null,
    dynamicShroudState: 'IDLE',
    dynamicShroudStateCountdown: 0,
    dynamicShroudTotalFrames: 0,
    dynamicShroudShrinkStartDeadline: 0,
    dynamicShroudSustainDeadline: 0,
    dynamicShroudGrowStartDeadline: 0,
    dynamicShroudDoneForeverFrame: 0,
    dynamicShroudChangeIntervalCountdown: 0,
    dynamicShroudNativeClearingRange: 0,
    dynamicShroudCurrentClearingRange: 0,

    // Jet AI
    jetAIProfile: null,
    jetAIState: null,

    // Animation Steering
    animationSteeringProfile: null,
    animationSteeringCurrentTurnAnim: null,
    animationSteeringNextTransitionFrame: 0,
    animationSteeringLastRotationY: 0,

    // Tensile Formation
    tensileFormationProfile: null,
    tensileFormationState: null,

    // Assault Transport
    assaultTransportProfile: null,
    assaultTransportState: null,
    railedTransportState: null,

    // Power Plant
    powerPlantUpdateProfile: null,
    powerPlantUpdateState: null,

    // Special Power Create
    hasSpecialPowerCreate: false,
    shroudRange: 0,

    // Subdual Damage
    subdualDamageCap: 0,
    subdualDamageHealRate: 0,
    subdualDamageHealAmount: 0,
    currentSubdualDamage: 0,
    subdualHealingCountdown: 0,

    ...overrides,
  };
}

function createSourceObjectState(): SourceMapEntitySaveState {
  const state = createEmptySourceMapEntitySaveState();
  state.objectId = 7;
  state.teamId = 3;
  state.drawableId = 9;
  state.internalName = 'UNIT_007';
  state.statusBits = ['SELECTABLE'];
  state.geometryInfo = {
    ...state.geometryInfo,
    majorRadius: 8,
    minorRadius: 8,
    boundingCircleRadius: 8,
    boundingSphereRadius: 8,
  };
  state.visionRange = 150;
  state.shroudClearingRange = 150;
  state.shroudRange = 150;
  state.experienceTracker = {
    ...state.experienceTracker,
    currentLevel: 1,
    currentExperience: 150,
    experienceScalar: 1,
  };
  state.constructionPercent = 100;
  state.layer = 1;
  state.destinationLayer = 1;
  state.isSelectable = true;
  state.modulesReady = true;
  return state;
}

function createSourceObjectChunk(): ArrayBuffer {
  return buildSourceMapEntityChunk(createSourceObjectState());
}

describe('entity-xfer', () => {
  it('round-trips an entity through save/load', () => {
    const original = createTestEntity();

    // Save
    const saver = new XferSave();
    saver.open('entity');
    xferMapEntity(saver, original);
    saver.close();

    // Load into blank entity
    const loaded = createTestEntity(); // fresh defaults
    const loader = new XferLoad(saver.getBuffer());
    loader.open('entity');
    xferMapEntity(loader, loaded);
    loader.close();

    // Verify identity fields
    expect(loaded.id).toBe(1);
    expect(loaded.templateName).toBe('TestUnit');
    expect(loaded.scriptName).toBeNull();
    expect(loaded.category).toBe('vehicle');
    expect(loaded.side).toBe('USA');
    expect(loaded.controllingPlayerToken).toBe('player1');
  });

  it('preserves transform values', () => {
    const original = createTestEntity();

    const saver = new XferSave();
    saver.open('entity');
    xferMapEntity(saver, original);
    saver.close();

    const loaded = createTestEntity();
    const loader = new XferLoad(saver.getBuffer());
    loader.open('entity');
    xferMapEntity(loader, loaded);
    loader.close();

    expect(loaded.x).toBeCloseTo(100.5);
    expect(loaded.y).toBeCloseTo(10.0);
    expect(loaded.z).toBeCloseTo(200.5);
    expect(loaded.rotationY).toBeCloseTo(1.57);
  });

  it('preserves health values', () => {
    const original = createTestEntity({ health: 275.5, maxHealth: 500 });

    const saver = new XferSave();
    saver.open('entity');
    xferMapEntity(saver, original);
    saver.close();

    const loaded = createTestEntity();
    const loader = new XferLoad(saver.getBuffer());
    loader.open('entity');
    xferMapEntity(loader, loaded);
    loader.close();

    expect(loaded.health).toBeCloseTo(275.5);
    expect(loaded.maxHealth).toBeCloseTo(500);
  });

  it('preserves health-box offsets', () => {
    const original = createTestEntity({ healthBoxOffset: { x: 6, y: 4, z: -2 } });

    const saver = new XferSave();
    saver.open('entity');
    xferMapEntity(saver, original);
    saver.close();

    const loaded = createTestEntity({ healthBoxOffset: { x: 0, y: 0, z: 0 } });
    const loader = new XferLoad(saver.getBuffer());
    loader.open('entity');
    xferMapEntity(loader, loaded);
    loader.close();

    expect(loaded.healthBoxOffset).toEqual({ x: 6, y: 4, z: -2 });
  });

  it('preserves Set<string> (kindOf, completedUpgrades)', () => {
    const original = createTestEntity();

    const saver = new XferSave();
    saver.open('entity');
    xferMapEntity(saver, original);
    saver.close();

    const loaded = createTestEntity({
      kindOf: new Set(),
      completedUpgrades: new Set(),
    });
    const loader = new XferLoad(saver.getBuffer());
    loader.open('entity');
    xferMapEntity(loader, loaded);
    loader.close();

    expect(loaded.kindOf).toEqual(new Set(['VEHICLE', 'CAN_ATTACK']));
    expect(loaded.completedUpgrades).toEqual(new Set(['UpgradeArmor']));
  });

  it('preserves Map<string, number> (armorDamageCoefficients)', () => {
    const original = createTestEntity();

    const saver = new XferSave();
    saver.open('entity');
    xferMapEntity(saver, original);
    saver.close();

    const loaded = createTestEntity({ armorDamageCoefficients: null });
    const loader = new XferLoad(saver.getBuffer());
    loader.open('entity');
    xferMapEntity(loader, loaded);
    loader.close();

    const coeffs = loaded.armorDamageCoefficients as Map<string, number>;
    expect(coeffs).toBeInstanceOf(Map);
    expect(coeffs.get('EXPLOSION')).toBeCloseTo(0.8);
    expect(coeffs.get('SMALL_ARMS')).toBeCloseTo(0.3);
  });

  it('preserves nullable entity IDs', () => {
    const original = createTestEntity({ attackTargetEntityId: 42 });

    const saver = new XferSave();
    saver.open('entity');
    xferMapEntity(saver, original);
    saver.close();

    const loaded = createTestEntity({ attackTargetEntityId: null });
    const loader = new XferLoad(saver.getBuffer());
    loader.open('entity');
    xferMapEntity(loader, loaded);
    loader.close();

    expect(loaded.attackTargetEntityId).toBe(42);
  });

  it('preserves undetected defector timers', () => {
    const original = createTestEntity({
      undetectedDefectorUntilFrame: 180,
      defectorHelperDetectionStartFrame: 120,
      defectorHelperDetectionEndFrame: 180,
      defectorHelperFlashPhase: 2.5,
      defectorHelperDoFx: true,
    });

    const saver = new XferSave();
    saver.open('entity');
    xferMapEntity(saver, original);
    saver.close();

    const loaded = createTestEntity({
      undetectedDefectorUntilFrame: 0,
      defectorHelperDetectionStartFrame: 0,
      defectorHelperDetectionEndFrame: 0,
      defectorHelperFlashPhase: 0,
      defectorHelperDoFx: false,
    });
    const loader = new XferLoad(saver.getBuffer());
    loader.open('entity');
    xferMapEntity(loader, loaded);
    loader.close();

    expect(loaded.undetectedDefectorUntilFrame).toBe(180);
    expect(loaded.defectorHelperDetectionStartFrame).toBe(120);
    expect(loaded.defectorHelperDetectionEndFrame).toBe(180);
    expect(loaded.defectorHelperFlashPhase).toBeCloseTo(2.5);
    expect(loaded.defectorHelperDoFx).toBe(true);
  });

  it('preserves repulsor helper wake frames', () => {
    const original = createTestEntity({ repulsorHelperUntilFrame: 240 });

    const saver = new XferSave();
    saver.open('entity');
    xferMapEntity(saver, original);
    saver.close();

    const loaded = createTestEntity({ repulsorHelperUntilFrame: 0 });
    const loader = new XferLoad(saver.getBuffer());
    loader.open('entity');
    xferMapEntity(loader, loaded);
    loader.close();

    expect(loaded.repulsorHelperUntilFrame).toBe(240);
  });

  it('preserves status damage helper runtime state', () => {
    const original = createTestEntity({
      statusDamageStatusName: 'FAERIE_FIRE',
      statusDamageClearFrame: 135,
    });

    const saver = new XferSave();
    saver.open('entity');
    xferMapEntity(saver, original);
    saver.close();

    const loaded = createTestEntity({
      statusDamageStatusName: null,
      statusDamageClearFrame: 0,
    });
    const loader = new XferLoad(saver.getBuffer());
    loader.open('entity');
    xferMapEntity(loader, loaded);
    loader.close();

    expect(loaded.statusDamageStatusName).toBe('FAERIE_FIRE');
    expect(loaded.statusDamageClearFrame).toBe(135);
  });

  it('preserves movement path (VectorXZ array)', () => {
    const original = createTestEntity();

    const saver = new XferSave();
    saver.open('entity');
    xferMapEntity(saver, original);
    saver.close();

    const loaded = createTestEntity({ movePath: [] });
    const loader = new XferLoad(saver.getBuffer());
    loader.open('entity');
    xferMapEntity(loader, loaded);
    loader.close();

    const path = loaded.movePath as Array<{ x: number; z: number }>;
    expect(path).toHaveLength(2);
    expect(path[0]!.x).toBeCloseTo(110);
    expect(path[0]!.z).toBeCloseTo(210);
  });

  it('preserves JSON-serialized profiles', () => {
    const original = createTestEntity({
      experienceProfile: { levels: [0, 100, 300, 600] },
      experienceState: { currentXP: 150, level: 1 },
    });

    const saver = new XferSave();
    saver.open('entity');
    xferMapEntity(saver, original);
    saver.close();

    const loaded = createTestEntity();
    const loader = new XferLoad(saver.getBuffer());
    loader.open('entity');
    xferMapEntity(loader, loaded);
    loader.close();

    expect(loaded.experienceProfile).toEqual({ levels: [0, 100, 300, 600] });
    expect(loaded.experienceState).toEqual({ currentXP: 150, level: 1 });
  });

  it('preserves Map-containing properties via JSON with collections', () => {
    const original = createTestEntity({
      locomotorSets: new Map([['DEFAULT', { speed: 30 }], ['UPGRADE', { speed: 50 }]]),
    });

    const saver = new XferSave();
    saver.open('entity');
    xferMapEntity(saver, original);
    saver.close();

    const loaded = createTestEntity({ locomotorSets: new Map() });
    const loader = new XferLoad(saver.getBuffer());
    loader.open('entity');
    xferMapEntity(loader, loaded);
    loader.close();

    const sets = loaded.locomotorSets as Map<string, unknown>;
    expect(sets).toBeInstanceOf(Map);
    expect(sets.size).toBe(2);
    expect(sets.get('DEFAULT')).toEqual({ speed: 30 });
  });

  it('round-trips source-owned assault transport state and drops TS-only helper flags', () => {
    const original = createTestEntity({
      assaultTransportState: {
        members: [
          { entityId: 4, isHealing: true, isNew: true },
          { entityId: 5, isHealing: false, isNew: false },
        ],
        designatedTargetId: 9,
        attackMoveGoalX: 120,
        attackMoveGoalY: 7.5,
        attackMoveGoalZ: 144,
        assaultState: 3,
        framesRemaining: 45,
        isAttackMove: true,
        isAttackObject: false,
        newOccupantsAreNewMembers: true,
      },
    });

    const saver = new XferSave();
    saver.open('entity');
    xferMapEntity(saver, original);
    saver.close();

    const loaded = createTestEntity({ assaultTransportState: null });
    const loader = new XferLoad(saver.getBuffer());
    loader.open('entity');
    xferMapEntity(loader, loaded);
    loader.close();

    expect(loaded.assaultTransportState).toEqual({
      members: [
        { entityId: 4, isHealing: true, isNew: false },
        { entityId: 5, isHealing: false, isNew: false },
      ],
      designatedTargetId: 9,
      attackMoveGoalX: 120,
      attackMoveGoalY: 7.5,
      attackMoveGoalZ: 144,
      assaultState: 3,
      framesRemaining: 45,
      isAttackMove: true,
      isAttackObject: false,
      newOccupantsAreNewMembers: false,
    });
  });

  it('round-trips source-owned railed transport state and drops TS-only transit helpers', () => {
    const original = createTestEntity({
      railedTransportState: {
        inTransit: true,
        waypointDataLoaded: true,
        paths: [
          { startWaypointID: 10, endWaypointID: 20 },
          { startWaypointID: 30, endWaypointID: 40 },
        ],
        currentPath: 1,
        transitWaypointIds: [10, 15, 20],
        transitWaypointIndex: 2,
      },
    });

    const saver = new XferSave();
    saver.open('entity');
    xferMapEntity(saver, original);
    saver.close();

    const loaded = createTestEntity({ railedTransportState: null });
    const loader = new XferLoad(saver.getBuffer());
    loader.open('entity');
    xferMapEntity(loader, loaded);
    loader.close();

    expect(loaded.railedTransportState).toEqual({
      inTransit: true,
      waypointDataLoaded: true,
      paths: [
        { startWaypointID: 10, endWaypointID: 20 },
        { startWaypointID: 30, endWaypointID: 40 },
      ],
      currentPath: 1,
      transitWaypointIds: [],
      transitWaypointIndex: 0,
    });
  });

  it('round-trips source-owned dozer task target object ids', () => {
    const original = createTestEntity({
      dozerBuildTargetEntityId: 11,
      dozerBuildTaskOrderFrame: 120,
      dozerRepairTargetEntityId: 12,
      dozerRepairTaskOrderFrame: 150,
    });

    const saver = new XferSave();
    saver.open('entity');
    xferMapEntity(saver, original);
    saver.close();

    const loaded = createTestEntity({
      dozerBuildTargetEntityId: 0,
      dozerRepairTargetEntityId: 0,
    });
    const loader = new XferLoad(saver.getBuffer());
    loader.open('entity');
    xferMapEntity(loader, loaded);
    loader.close();

    expect(loaded.dozerBuildTargetEntityId).toBe(11);
    expect(loaded.dozerBuildTaskOrderFrame).toBe(120);
    expect(loaded.dozerRepairTargetEntityId).toBe(12);
    expect(loaded.dozerRepairTaskOrderFrame).toBe(150);
  });

  it('round-trips source-owned pending enter state', () => {
    const original = createTestEntity({
      pendingEnterState: {
        targetObjectId: 33,
        action: 'enterTransport',
        commandSource: 'AI',
      },
    });

    const saver = new XferSave();
    saver.open('entity');
    xferMapEntity(saver, original);
    saver.close();

    const loaded = createTestEntity();
    const loader = new XferLoad(saver.getBuffer());
    loader.open('entity');
    xferMapEntity(loader, loaded);
    loader.close();

    expect(loaded.pendingEnterState).toEqual({
      targetObjectId: 33,
      action: 'enterTransport',
      commandSource: 'AI',
    });
  });

  it('round-trips Chinook combat-drop and rappel runtime state', () => {
    const original = createTestEntity({
      chinookCombatDropState: {
        targetObjectId: 44,
        targetX: 320,
        targetZ: 512,
        nextDropFrame: 180,
      },
      chinookRappelState: {
        sourceEntityId: 1,
        targetObjectId: 44,
        targetX: 320,
        targetZ: 512,
        descentSpeedPerFrame: 0.75,
      },
    });

    const saver = new XferSave();
    saver.open('entity');
    xferMapEntity(saver, original);
    saver.close();

    const loaded = createTestEntity();
    const loader = new XferLoad(saver.getBuffer());
    loader.open('entity');
    xferMapEntity(loader, loaded);
    loader.close();

    expect(loaded.chinookCombatDropState).toEqual({
      targetObjectId: 44,
      targetX: 320,
      targetZ: 512,
      nextDropFrame: 180,
    });
    expect(loaded.chinookRappelState).toEqual({
      sourceEntityId: 1,
      targetObjectId: 44,
      targetX: 320,
      targetZ: 512,
      descentSpeedPerFrame: 0.75,
    });
  });

  it('round-trips repair-dock runtime state', () => {
    const original = createTestEntity({
      repairDockState: {
        dockObjectId: 4,
        commandSource: 'SCRIPT',
      },
      repairDockLastRepairEntityId: 11,
      repairDockHealthToAddPerFrame: 2.5,
    });

    const saver = new XferSave();
    saver.open('entity');
    xferMapEntity(saver, original);
    saver.close();

    const loaded = createTestEntity();
    const loader = new XferLoad(saver.getBuffer());
    loader.open('entity');
    xferMapEntity(loader, loaded);
    loader.close();

    expect(loaded.repairDockState).toEqual({
      dockObjectId: 4,
      commandSource: 'SCRIPT',
    });
    expect(loaded.repairDockLastRepairEntityId).toBe(11);
    expect(loaded.repairDockHealthToAddPerFrame).toBeCloseTo(2.5, 6);
  });

  it('CRC is deterministic for identical entities', () => {
    const entity1 = createTestEntity();
    const entity2 = createTestEntity();

    const crc1 = new XferCrc();
    crc1.open('entity');
    xferMapEntity(crc1, entity1);
    crc1.close();

    const crc2 = new XferCrc();
    crc2.open('entity');
    xferMapEntity(crc2, entity2);
    crc2.close();

    expect(crc1.getCrc()).toBe(crc2.getCrc());
    expect(crc1.getCrc()).not.toBe(0);
  });

  it('CRC differs for different entities', () => {
    const entity1 = createTestEntity({ health: 100 });
    const entity2 = createTestEntity({ health: 200 });

    const crc1 = new XferCrc();
    crc1.open('entity');
    xferMapEntity(crc1, entity1);
    crc1.close();

    const crc2 = new XferCrc();
    crc2.open('entity');
    xferMapEntity(crc2, entity2);
    crc2.close();

    expect(crc1.getCrc()).not.toBe(crc2.getCrc());
  });

  it('classifies browser-port entity chunks as legacy', () => {
    const saver = new XferSave();
    saver.open('entity');
    xferMapEntity(saver, createTestEntity());
    saver.close();

    expect(inspectMapEntityChunkLayout(saver.getBuffer())).toEqual({
      layout: 'legacy',
      version: null,
      objectId: null,
      parsedThrough: null,
      moduleCount: null,
      moduleIdentifiers: null,
      remainingBytes: 0,
      reason: expect.any(String),
    });
  });

  it('round-trips source Object::xfer state through build/parse', () => {
    const original = createSourceObjectState();
    original.modules = [
      {
        identifier: 'ModuleTag_01',
        blockData: new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
      },
    ];
    original.weaponSetFlags = ['PLAYER_UPGRADE'];
    original.specialPowerBits = ['SPECIAL_POWER_READY'];
    original.completedUpgradeNames = ['UpgradeArmor'];
    original.lastWeaponCondition = [1, 2, 3];

    const parsed = parseSourceMapEntityChunk(buildSourceMapEntityChunk(original));

    expect(parsed).toEqual({
      ...original,
      modules: [
        {
          identifier: 'ModuleTag_01',
          blockData: new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
        },
      ],
    });
  });

  it('inspects source object chunk framing through the tail fields', () => {
    expect(inspectMapEntityChunkLayout(createSourceObjectChunk())).toEqual({
      layout: 'source_partial',
      version: 9,
      objectId: 7,
      parsedThrough: 'complete',
      moduleCount: 0,
      moduleIdentifiers: [],
      remainingBytes: 0,
    });
  });
});
