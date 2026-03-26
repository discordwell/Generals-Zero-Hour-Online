// @ts-nocheck — self is typed as any; real safety comes from the test suite.
/**
 * Entity factory — createMapEntity, spawnEntityFromTemplate, and all extract*Profile methods.
 *
 * Source parity: System/GameLogic.cpp, Object/*.cpp
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import * as THREE from 'three';
import { MAP_XY_FACTOR } from '@generals/terrain';
import {
  nominalHeightForCategory,
  readBooleanField,
  readCoord3DField,
  readNumericField,
  readNumericListField,
  readStringField,
  readStringList,
} from './ini-readers.js';
import { findObjectDefByName } from './registry-lookups.js';
import { extractUpgradeModulesFromBlocks as extractUpgradeModulesFromBlocksImpl } from './upgrade-modules.js';
import { createExperienceState as createExperienceStateImpl, LEVEL_REGULAR, LEVEL_VETERAN, LEVEL_ELITE, LEVEL_HEROIC } from './experience.js';
import { createEntityVisionState as createEntityVisionStateImpl } from './fog-of-war.js';
import {
  ARMOR_SET_FLAG_MASK_BY_NAME,
  AUTO_TARGET_SCAN_RATE_FRAMES,
  CONSTRUCTION_COMPLETE,
  DEFAULT_AFLAME_DAMAGE_AMOUNT,
  DEFAULT_FLAME_DAMAGE_LIMIT,
  LOCOMOTORSET_NORMAL,
  LOGIC_FRAME_RATE,
  MINE_DEFAULT_DETONATED_BY,
  MINE_DETONATED_BY_ALLIES,
  MINE_DETONATED_BY_ENEMIES,
  MINE_DETONATED_BY_NEUTRAL,
  NO_SURFACES,
  OBJECT_FLAG_BRIDGE_POINT1,
  OBJECT_FLAG_BRIDGE_POINT2,
  SPECIAL_POWER_BEHAVIOR_MODULE_TYPES,
  SCRIPT_AI_ATTITUDE_NORMAL,
  PROJECTILE_DEFAULT_DETONATE_CALLS_KILL,
  PROJECTILE_DEFAULT_ORIENT_TO_FLIGHT_PATH,
  WEAPON_BONUS_CONDITION_BY_NAME,
  WEAPON_SET_FLAG_MASK_BY_NAME,
  parseAutoAcquireEnemiesBitfield,
} from './index.js';
type GL = any;

// ---- Entity factory implementations ----

export function createMapEntity(self: GL, 
  mapObject: MapObjectJSON,
  objectDef: ObjectDef | undefined,
  iniDataRegistry: IniDataRegistry,
  heightmap: HeightmapGrid | null,
): MapEntity {
  const kindOf = objectDef?.kindOf;
  const category = self.inferCategory(kindOf, objectDef?.fields.KindOf);
  const normalizedKindOf = self.normalizeKindOf(kindOf);
  const isResolved = objectDef !== undefined;
  const objectId = self.nextId++;
  const controllingPlayerToken = self.resolveMapObjectControllingPlayerToken(mapObject);
  const scriptName = self.resolveMapObjectScriptName(mapObject);
  const renderAssetProfile = self.resolveRenderAssetProfile(objectDef);

  // Source parity: unresolved objects (no INI definition) still have a templateName
  // from the map file that corresponds to a W3D model name (e.g. "TREEDesert01",
  // "Rock1", "CivBuilding01").  Use templateName as a render asset candidate so
  // the renderer can resolve it against the asset manifest.
  if (!isResolved && renderAssetProfile.renderAssetCandidates.length === 0) {
    const name = mapObject.templateName;
    if (name && name.length > 0) {
      renderAssetProfile.renderAssetCandidates.push(name);
      renderAssetProfile.renderAssetPath = name;
      renderAssetProfile.renderAssetResolved = true;
    }
  }

  const nominalHeight = nominalHeightForCategory(category);

  const locomotorSetProfiles = self.resolveLocomotorProfiles(objectDef, iniDataRegistry);
  const upgradeModules = extractUpgradeModules(self, objectDef);
  // Source parity: ThingTemplate::m_factoryExitWidth — lateral offset for spawned units.
  const factoryExitWidth = Math.max(0, readNumericField(objectDef?.fields ?? {}, ['FactoryExitWidth']) ?? 0);
  const productionProfile = extractProductionProfile(self, objectDef);
  const queueProductionExitProfile = extractQueueProductionExitProfile(self, objectDef);
  const parkingPlaceProfile = self.extractParkingPlaceProfile(objectDef);
  const flightDeckProfile = self.extractFlightDeckProfile(objectDef);
  const containProfile = extractContainProfile(self, objectDef);
  const supplyWarehouseProfile = extractSupplyWarehouseProfile(self, objectDef);
  const supplyTruckProfile = extractSupplyTruckProfile(self, objectDef);
  const chinookAIProfile = self.extractChinookAIProfile(objectDef);
  const repairDockProfile = extractRepairDockProfile(self, objectDef);
  const commandButtonHuntProfile = extractCommandButtonHuntProfile(self, objectDef);
  const dozerAIProfile = extractDozerAIProfile(self, objectDef);
  const workerAIProfile = extractWorkerAIProfile(self, objectDef);
  const powTruckAIProfile = extractPOWTruckAIProfile(self, objectDef);
  const prisonBehaviorProfile = extractPrisonBehaviorProfile(self, objectDef);
  const isSupplyCenter = self.detectIsSupplyCenter(objectDef);
  const experienceProfile = extractExperienceProfile(self, objectDef);
  const visionRangeFromTemplate = readNumericField(objectDef?.fields ?? {}, ['VisionRange']) ?? 0;
  const shroudClearingRangeFromTemplateRaw = readNumericField(objectDef?.fields ?? {}, ['ShroudClearingRange']);
  // Source parity: Object ctor falls back to vision range when template shroud-clearing range is -1.
  const shroudClearingRangeFromTemplate =
    shroudClearingRangeFromTemplateRaw !== null
    && Number.isFinite(shroudClearingRangeFromTemplateRaw)
    && shroudClearingRangeFromTemplateRaw >= 0
      ? shroudClearingRangeFromTemplateRaw
      : visionRangeFromTemplate;
  // Source parity: ThingTemplate::m_shroudRevealToAllRange — reveals to all sides.
  const shroudRevealToAllRange = Math.max(0, readNumericField(objectDef?.fields ?? {}, ['ShroudRevealToAllRange']) ?? 0);
  const ambientSoundProfile = extractAmbientSoundProfile(self, objectDef);
  const jetAIProfile = self.extractJetAIProfile(objectDef);
  const aiUpdateModuleData = extractAIUpdateModuleData(self, objectDef);
  const animationSteeringProfile = extractAnimationSteeringProfile(self, objectDef);
  const tensileFormationProfile = extractTensileFormationProfile(self, objectDef);
  const weaponTemplateSets = extractWeaponTemplateSets(self, objectDef);
  const armorTemplateSets = extractArmorTemplateSets(self, objectDef);
  const attackWeapon = self.resolveAttackWeaponProfile(objectDef, iniDataRegistry);
  const attackWeaponSlotIndex = self.resolveAttackWeaponSlotIndex(weaponTemplateSets, 0, iniDataRegistry);
  const specialPowerModules = extractSpecialPowerModules(self, objectDef);
  const bodyStats = self.resolveBodyStats(objectDef);
  // Source parity: ThingTemplate has two separate energy fields.
  // EnergyProduction — base power production/consumption (positive = produces, negative = consumes).
  // EnergyBonus — additional production granted by upgrades (e.g. Control Rods on Power Plant).
  const energyBonus = readNumericField(objectDef?.fields ?? {}, ['EnergyProduction']) ?? 0;
  const energyUpgradeBonus = readNumericField(objectDef?.fields ?? {}, ['EnergyBonus']) ?? 0;
  const largestWeaponRange = self.resolveLargestWeaponRange(objectDef, iniDataRegistry);
  const totalWeaponAntiMask = self.resolveTotalWeaponAntiMaskForSetSelection(
    weaponTemplateSets, 0, iniDataRegistry,
  );
  const armorDamageCoefficients = self.resolveArmorDamageCoefficientsForSetSelection(
    armorTemplateSets,
    0,
    iniDataRegistry,
  );
  const locomotorProfile = locomotorSetProfiles.get(LOCOMOTORSET_NORMAL) ?? {
    surfaceMask: NO_SURFACES,
    downhillOnly: false,
    movementSpeed: 0,
    minSpeed: 0,
    acceleration: 0,
    braking: 0,
    turnRate: 0,
    appearance: 'OTHER',
    wanderAboutPointRadius: 0,
    preferredHeight: 0,
    preferredHeightDamping: 1,
    zAxisBehavior: 'Z_NO_Z_MOTIVE_FORCE',
    lift: 0,
    liftDamaged: -1,
    closeEnoughDist: 1.0,
    circlingRadius: 0,
    minTurnSpeed: 99999.0,
    speedLimitZ: 999999.0,
    canMoveBackwards: false,
    groupMovementPriority: 'MOVES_MIDDLE',
    speedDamaged: -1.0,
    turnRateDamaged: -1.0,
    accelerationDamaged: -1.0,
    // Gameplay defaults (source parity: Locomotor.cpp constructor)
    stickToGround: false,
    allowAirborneMotiveForce: false,
    locomotorWorksWhenDead: false,
    apply2DFrictionWhenAirborne: false,
    airborneTargetingHeight: 2147483647,
    extra2DFriction: 0,
    slideIntoPlaceTime: 0,
    closeEnoughDist3D: false,
    // Visual/suspension defaults (source parity: Locomotor.cpp constructor)
    pitchStiffness: 0.1,
    rollStiffness: 0.1,
    pitchDamping: 0.9,
    rollDamping: 0.9,
    forwardVelCoef: 0,
    lateralVelCoef: 0,
    pitchByZVelCoef: 0,
    forwardAccelCoef: 0,
    lateralAccelCoef: 0,
    uniformAxialDamping: 1.0,
    turnPivotOffset: 0,
    thrustRoll: 0,
    wobbleRate: 0,
    minWobble: 0,
    maxWobble: 0,
    accelPitchLimit: 0,
    decelPitchLimit: 0,
    bounceKick: 0,
    hasSuspension: false,
    wheelTurnAngle: 0,
    maximumWheelExtension: 0,
    maximumWheelCompression: 0,
    wanderWidthFactor: 0,
    wanderLengthFactor: 1.0,
    rudderCorrectionDegree: 0,
    rudderCorrectionRate: 0,
    elevatorCorrectionDegree: 0,
    elevatorCorrectionRate: 0,
  };
  const combatProfile = self.resolveCombatCollisionProfile(objectDef);
  const attackNeedsLineOfSight = normalizedKindOf.has('ATTACK_NEEDS_LINE_OF_SIGHT');
  const isImmobile = normalizedKindOf.has('IMMOBILE');
  const blocksPath = self.shouldPathfindObstacle(objectDef);
  // Source parity: mines don't block pathfinding but still need collision geometry
  // for MinefieldBehavior::onCollide. Crushers need geometry for crush overlap detection.
  // Crates need geometry for CrateCollide::onCollide collection radius.
  // DynamicGeometryInfoUpdate / FirestormDynamicGeometryInfoUpdate morph obstacle geometry at runtime.
  const hasDynamicGeometryModule = objectDef?.blocks.some(b => {
    const mt = b.name.split(/\s+/)[0]?.toUpperCase() ?? '';
    return mt === 'DYNAMICGEOMETRYINFOUPDATE' || mt === 'FIRESTORMDYNAMICGEOMETRYINFOUPDATE';
  }) ?? false;
  const needsGeometry = blocksPath || normalizedKindOf.has('MINE') || normalizedKindOf.has('CRATE') || combatProfile.crusherLevel > 0 || hasDynamicGeometryModule;
  const obstacleGeometry = needsGeometry ? self.resolveObstacleGeometry(objectDef) : null;
  // Source parity: ThingTemplate constructor defaults m_geometryInfo to
  // GEOMETRY_SPHERE with majorRadius=1, minorRadius=1, height=1.
  // obstacleGeometry is null for entities that don't need pathfinding geometry,
  // but geometryInfo is always present (matching C++ behavior).
  const geometryInfo: { shape: 'circle' | 'box'; majorRadius: number; minorRadius: number; height: number } =
    obstacleGeometry ?? self.resolveObstacleGeometry(objectDef) ?? { shape: 'circle', majorRadius: 1, minorRadius: 1, height: 1 };
  const obstacleFootprint = blocksPath ? self.footprintInCells(category, objectDef, obstacleGeometry) : 0;
  const { pathDiameter, pathfindCenterInCell } = self.resolvePathRadiusAndCenter(category, objectDef, obstacleGeometry);
  const geometryMajorRadius = objectDef
    ? (self.pathDiameterFromGeometryFields(objectDef)
      ?? obstacleGeometry?.majorRadius
      ?? MAP_XY_FACTOR / 2)
    : MAP_XY_FACTOR / 2;
  // Source parity: ThingTemplate shadow fields — drive blob shadow decal rendering.
  const shadowType = readStringField(objectDef?.fields ?? {}, ['Shadow']) ?? null;
  const shadowSizeX = readNumericField(objectDef?.fields ?? {}, ['ShadowSizeX']) ?? 0;
  const shadowSizeY = readNumericField(objectDef?.fields ?? {}, ['ShadowSizeY']) ?? 0;
  const shadowOffsetX = readNumericField(objectDef?.fields ?? {}, ['ShadowOffsetX']) ?? 0;
  const shadowOffsetY = readNumericField(objectDef?.fields ?? {}, ['ShadowOffsetY']) ?? 0;
  // Source parity: ThingTemplate fields — AI targeting, radar, occlusion, rubble, scale, build completion, guards.
  const threatValue = readNumericField(objectDef?.fields ?? {}, ['ThreatValue']) ?? 0;
  const radarPriorityRaw = readStringField(objectDef?.fields ?? {}, ['RadarPriority']);
  const VALID_RADAR_PRIORITIES = new Set(['INVALID', 'NOT_ON_RADAR', 'STRUCTURE', 'UNIT', 'LOCAL_UNIT_ONLY']);
  const radarPriority = (radarPriorityRaw && VALID_RADAR_PRIORITIES.has(radarPriorityRaw)) ? radarPriorityRaw : 'INVALID';
  const occlusionDelay = readNumericField(objectDef?.fields ?? {}, ['OcclusionDelay']) ?? 0;
  const structureRubbleHeight = readNumericField(objectDef?.fields ?? {}, ['StructureRubbleHeight']) ?? 0;
  const instanceScaleFuzziness = readNumericField(objectDef?.fields ?? {}, ['InstanceScaleFuzziness']) ?? 0;
  const buildCompletionRaw = readStringField(objectDef?.fields ?? {}, ['BuildCompletion']);
  const VALID_BUILD_COMPLETIONS = new Set(['INVALID', 'APPEARS_AT_RALLY_POINT', 'PLACED_BY_PLAYER']);
  const buildCompletion = (buildCompletionRaw && VALID_BUILD_COMPLETIONS.has(buildCompletionRaw)) ? buildCompletionRaw : 'APPEARS_AT_RALLY_POINT';
  const enterGuard = readBooleanField(objectDef?.fields ?? {}, ['EnterGuard']) === true;
  const hijackGuard = readBooleanField(objectDef?.fields ?? {}, ['HijackGuard']) === true;
  const [worldX, worldY, worldZ] = self.objectToWorldPosition(mapObject, heightmap);
  const baseHeight = nominalHeight / 2;
  const x = worldX;
  const y = worldY + baseHeight;
  const z = worldZ;
  const rawAngle = Number.isFinite(mapObject.angle) ? mapObject.angle : 0;
  const rotationY = THREE.MathUtils.degToRad(rawAngle);
  const bridgeFlags = mapObject.flags & (OBJECT_FLAG_BRIDGE_POINT1 | OBJECT_FLAG_BRIDGE_POINT2);
  const rawPosX = Number.isFinite(mapObject.position.x) ? mapObject.position.x : 0;
  const rawPosY = Number.isFinite(mapObject.position.y) ? mapObject.position.y : 0;
  const mapCellX = Math.floor(rawPosX / MAP_XY_FACTOR);
  const mapCellZ = Math.floor(rawPosY / MAP_XY_FACTOR);

  const [posCellX, posCellZ] = self.worldToGrid(x, z);
  const initialClipAmmo = attackWeapon && attackWeapon.clipSize > 0 ? attackWeapon.clipSize : 0;
  const initialScatterTargetsUnused = attackWeapon
    ? Array.from({ length: attackWeapon.scatterTargets.length }, (_entry, index) => index)
    : [];
  const normalizedOriginalSide = self.normalizeSide(objectDef?.side ?? '');

  const entity: MapEntity = {
    id: objectId,
    templateName: mapObject.templateName,
    scriptName,
    category,
    kindOf: normalizedKindOf,
    side: objectDef?.side,
    originalOwningSide: normalizedOriginalSide,
    capturedFromOriginalOwner: false,
    controllingPlayerToken,
    resolved: isResolved,
    bridgeFlags,
    mapCellX,
    mapCellZ,
    renderAssetCandidates: renderAssetProfile.renderAssetCandidates,
    renderAssetPath: renderAssetProfile.renderAssetPath,
    renderAssetResolved: renderAssetProfile.renderAssetResolved,
    renderAnimationStateClips: renderAssetProfile.renderAnimationStateClips,
    modelConditionInfos: renderAssetProfile.modelConditionInfos,
    transitionInfos: renderAssetProfile.transitionInfos,
    x,
    y,
    z,
    rotationY,
    animationState: 'IDLE',
    baseHeight,
    nominalHeight,
    selected: false,
    crusherLevel: combatProfile.crusherLevel,
    crushableLevel: combatProfile.crushableLevel,
    canBeSquished: combatProfile.canBeSquished,
    isUnmanned: combatProfile.isUnmanned,
    attackNeedsLineOfSight,
    isImmobile,
    noCollisions: false,
    isIndestructible: false,
    receivingDifficultyBonus: self.scriptObjectsReceiveDifficultyBonus,
    scriptAiRecruitable: true,
    scriptAttackPrioritySetName: '',
    scriptAttitude: SCRIPT_AI_ATTITUDE_NORMAL,
    keepObjectOnDeath: self.hasKeepObjectDie(objectDef),
    canMove: category === 'infantry' || category === 'vehicle' || category === 'air',
    locomotorSets: locomotorSetProfiles,
    completedUpgrades: new Set<string>(),
    locomotorUpgradeTriggers: new Set<string>(),
    executedUpgradeModules: new Set<string>(),
    upgradeModules,
    objectStatusFlags: new Set<string>(),
    modelConditionFlags: new Set<string>(),
    scriptFlashCount: 0,
    scriptFlashColor: 0,
    scriptAmbientSoundEnabled: true,
    scriptAmbientSoundRevision: 0,
    ambientSoundProfile,
    ambientSoundForcedOffExceptRubble: false,
    ambientSoundCustomState: null,
    customIndicatorColor: null,
    commandSetStringOverride: null,
    locomotorUpgradeEnabled: false,
    specialPowerModules,
    lastSpecialPowerDispatch: null,
    activeLocomotorSet: LOCOMOTORSET_NORMAL,
    locomotorSurfaceMask: locomotorProfile.surfaceMask,
    locomotorDownhillOnly: locomotorProfile.downhillOnly,
    bodyType: bodyStats.bodyType,
    hiveStructureProfile: extractHiveStructureProfile(self, objectDef, bodyStats.bodyType),
    // Source parity: UndeadBody — second life config and runtime state.
    undeadSecondLifeMaxHealth: bodyStats.secondLifeMaxHealth,
    undeadIsSecondLife: false,
    canTakeDamage: bodyStats.bodyType !== 'INACTIVE' && bodyStats.maxHealth > 0,
    maxHealth: bodyStats.maxHealth,
    initialHealth: bodyStats.initialHealth,
    health: bodyStats.bodyType === 'INACTIVE' ? 0 : bodyStats.initialHealth,
    energyBonus,
    energyUpgradeBonus,
    attackWeapon,
    weaponTemplateSets,
    weaponSetFlagsMask: 0,
    weaponBonusConditionFlags: 0,
    forcedWeaponSlot: null,
    weaponLockStatus: 'NOT_LOCKED' as const,
    maxShotsRemaining: 0,
    leechRangeActive: false,
    turretProfiles: extractTurretProfiles(self, objectDef),
    turretStates: [], // Initialized after entity creation below.
    armorTemplateSets,
    armorSetFlagsMask: 0,
    armorDamageCoefficients,
    attackTargetEntityId: null,
    attackTargetPosition: null,
    attackOriginalVictimPosition: null,
    attackCommandSource: 'AI',
    attackSubState: 'IDLE',
    nextAttackFrame: 0,
    lastShotFrame: 0,
    lastShotFrameBySlot: [0, 0, 0],
    attackWeaponSlotIndex,
    attackCooldownRemaining: 0,
    attackAmmoInClip: initialClipAmmo,
    attackReloadFinishFrame: 0,
    attackForceReloadFrame: 0,
    attackScatterTargetsUnused: initialScatterTargetsUnused,
    preAttackFinishFrame: 0,
    consecutiveShotsTargetEntityId: null,
    consecutiveShotsAtTarget: 0,
    continuousFireState: 'NONE',
    continuousFireCooldownFrame: 0,
    sneakyOffsetWhenAttacking: jetAIProfile?.sneakyOffsetWhenAttacking ?? 0,
    attackersMissPersistFrames: jetAIProfile?.attackersMissPersistFrames ?? 0,
    attackersMissExpireFrame: 0,
    productionProfile,
    productionQueue: [],
    productionNextId: 1,
    queueProductionExitProfile,
    factoryExitWidth,
    spawnPointExitState: null,
    rallyPoint: null,
    parkingPlaceProfile,
    containProfile,
    scriptEvacDisposition: 0,
    queueProductionExitDelayFramesRemaining: 0,
    queueProductionExitBurstRemaining: queueProductionExitProfile?.initialBurst ?? 0,
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
    initialPayloadCreated: false,
    helixPortableRiderId: null,
    slaverEntityId: null,
    spawnBehaviorState: self.extractSpawnBehaviorState(objectDef),
    pathDiameter,
    pathfindCenterInCell,
    blocksPath,
    geometryMajorRadius,
    shadowType,
    shadowSizeX,
    shadowSizeY,
    shadowOffsetX,
    shadowOffsetY,
    threatValue,
    radarPriority,
    occlusionDelay,
    structureRubbleHeight,
    instanceScaleFuzziness,
    buildCompletion,
    enterGuard,
    hijackGuard,
    obstacleGeometry,
    geometryInfo,
    obstacleFootprint,
    largestWeaponRange,
    totalWeaponAntiMask,
    ignoredMovementObstacleId: null,
    movePath: [],
    pathIndex: 0,
    moving: false,
    speed: locomotorProfile.movementSpeed > 0 ? locomotorProfile.movementSpeed : self.config.defaultMoveSpeed,
    currentSpeed: 0,
    moveTarget: null,
    scriptStoppingDistanceOverride: null,
    pathfindGoalCell: null,
    pathfindPosCell: (posCellX !== null && posCellZ !== null) ? { x: posCellX, z: posCellZ } : null,
    supplyWarehouseProfile,
    supplyTruckProfile,
    chinookAIProfile,
    chinookFlightStatus: chinookAIProfile ? 'FLYING' : null,
    chinookFlightStatusEnteredFrame: chinookAIProfile ? self.frameCounter : 0,
    chinookHealingAirfieldId: 0,
    repairDockProfile,
    commandButtonHuntProfile,
    commandButtonHuntMode: 'NONE',
    commandButtonHuntButtonName: '',
    commandButtonHuntNextScanFrame: 0,
    dozerAIProfile,
    workerAIProfile,
    powTruckAIProfile,
    dozerIdleTooLongTimestamp: self.frameCounter,
    dozerBuildTaskOrderFrame: 0,
    dozerRepairTaskOrderFrame: 0,
    prisonBehaviorProfile,
    isSupplyCenter,
    experienceProfile,
    experienceState: createExperienceStateImpl(),
    visionRange: visionRangeFromTemplate,
    shroudClearingRange: shroudClearingRangeFromTemplate,
    shroudRevealToAllRange,
    visionState: createEntityVisionStateImpl(),
    stealthProfile: self.extractStealthProfile(objectDef),
    stealthDelayRemaining: 0,
    disguiseTemplateName: null,
    detectedUntilFrame: 0,
    lastDamageFrame: 0,
    lastDamageNoEffect: false,
    lastAttackerEntityId: null,
    scriptLastDamageSourceEntityId: null,
    scriptLastDamageSourceTemplateName: null,
    scriptLastDamageSourceSide: null,
    lastDamageInfoFrame: 0,
    detectorProfile: self.extractDetectorProfile(objectDef),
    detectorNextScanFrame: 0,
    autoHealProfile: extractAutoHealProfile(self, objectDef),
    autoHealNextFrame: 0,
    autoHealDamageDelayUntilFrame: 0,
    autoHealSingleBurstDone: false,
    baseRegenDelayUntilFrame: 0,
    propagandaTowerProfile: extractPropagandaTowerProfile(self, objectDef),
    propagandaTowerNextScanFrame: 0,
    propagandaTowerTrackedIds: [],
    soleHealingBenefactorId: null,
    soleHealingBenefactorExpirationFrame: 0,
    autoTargetScanNextFrame: self.frameCounter + (aiUpdateModuleData.moodAttackCheckRate > 0 ? aiUpdateModuleData.moodAttackCheckRate : AUTO_TARGET_SCAN_RATE_FRAMES),
    turretsLinked: aiUpdateModuleData.turretsLinked,
    forbidPlayerCommands: aiUpdateModuleData.forbidPlayerCommands,
    autoAcquireEnemiesWhenIdle: aiUpdateModuleData.autoAcquireEnemiesWhenIdle,
    moodAttackCheckRate: aiUpdateModuleData.moodAttackCheckRate,
    // Guard state
    guardState: 'NONE' as GuardState,
    guardPositionX: 0,
    guardPositionZ: 0,
    guardObjectId: 0,
    guardAreaTriggerIndex: -1,
    guardMode: 0,
    guardNextScanFrame: 0,
    guardChaseExpireFrame: 0,
    guardInnerRange: 0,
    guardOuterRange: 0,
    // Poison DoT state
    poisonedBehaviorProfile: self.extractPoisonedBehaviorProfile(objectDef),
    poisonDamageAmount: 0,
    poisonNextDamageFrame: 0,
    poisonExpireFrame: 0,
    // Fire DoT state
    flameStatus: 'NORMAL' as const,
    flameDamageAccumulated: 0,
    flameEndFrame: 0,
    flameBurnedEndFrame: 0,
    flameDamageNextFrame: 0,
    flameLastDamageReceivedFrame: 0,
    flammableProfile: extractFlammableProfile(self, objectDef),
    fireSpreadProfile: self.extractFireSpreadProfile(objectDef),
    fireSpreadNextFrame: 0,
    // Fire weapon collide
    fireWeaponCollideProfiles: extractFireWeaponCollideProfiles(self, objectDef),
    // Mine behavior
    minefieldProfile: extractMinefieldProfile(self, objectDef),
    mineVirtualMinesRemaining: 0,
    mineImmunes: [],
    mineDetonators: [],
    mineScootFramesLeft: 0,
    mineDraining: false,
    mineRegenerates: false,
    mineNextDeathCheckFrame: 0,
    mineIgnoreDamage: false,
    mineCreatorId: 0,
    // Pilot eject
    ejectPilotTemplateName: extractEjectPilotTemplateName(self, objectDef),
    ejectPilotMinVeterancy: 1,
    // Prone behavior
    proneDamageToFramesRatio: extractProneDamageToFramesRatio(self, objectDef),
    proneFramesRemaining: 0,
    // Demo trap
    demoTrapProfile: extractDemoTrapProfile(self, objectDef),
    demoTrapNextScanFrame: 0,
    demoTrapDetonated: false,
    demoTrapProximityMode: false,
    // Rebuild hole expose die (buildings)
    rebuildHoleExposeDieProfile: extractRebuildHoleExposeDieProfile(self, objectDef),
    // Rebuild hole behavior (holes)
    rebuildHoleProfile: extractRebuildHoleBehaviorProfile(self, objectDef),
    rebuildHoleWorkerEntityId: 0,
    rebuildHoleReconstructingEntityId: 0,
    rebuildHoleSpawnerEntityId: 0,
    rebuildHoleWorkerWaitCounter: 0,
    rebuildHoleRebuildTemplateName: '',
    rebuildHoleMasked: false,
    // Auto deposit
    autoDepositProfile: extractAutoDepositProfile(self, objectDef),
    autoDepositNextFrame: 0,
    autoDepositInitialized: false,
    autoDepositCaptureBonusPending: false,
    // Auto-find-healing
    autoFindHealingProfile: extractAutoFindHealingProfile(self, objectDef),
    autoFindHealingNextScanFrame: 0,
    // Death OCLs
    deathOCLEntries: self.extractDeathOCLEntries(objectDef),
    // Deploy state machine
    deployStyleProfile: extractDeployStyleProfile(self, objectDef),
    deployState: 'READY_TO_MOVE' as DeployState,
    deployFrameToWait: 0,
    // Construction state — born complete unless dozer-placed.
    constructionPercent: CONSTRUCTION_COMPLETE,
    capturePercent: -1,
    builderId: 0,
    buildTotalFrames: 0,
    destroyed: false,
    pendingDeathType: 'NORMAL',
    // Lifetime
    lifetimeDieFrame: self.resolveLifetimeDieFrame(objectDef),
    // Height die
    heightDieProfile: extractHeightDieProfile(self, objectDef),
    heightDieActiveFrame: 0, // Set after first update.
    heightDieLastY: 0,
    // Deletion
    deletionDieFrame: self.resolveDeletionDieFrame(objectDef),
    // Sticky bomb
    stickyBombProfile: extractStickyBombUpdateProfile(self, objectDef),
    stickyBombTargetId: 0,
    stickyBombDieFrame: 0,
    // Fire weapon when damaged
    fireWhenDamagedProfiles: self.extractFireWhenDamagedProfiles(objectDef),
    // Fire weapon update (autonomous fire at own position)
    fireWeaponUpdateProfiles: self.extractFireWeaponUpdateProfiles(objectDef),
    fireWeaponUpdateNextFireFrames: [],
    lastShotFiredFrame: 0,
    // OCL update (periodic Object Creation List spawning)
    oclUpdateProfiles: extractOCLUpdateProfiles(self, objectDef),
    oclUpdateNextCreationFrames: [],
    oclUpdateTimerStarted: [],
    // Weapon bonus update (aura-based weapon bonus)
    weaponBonusUpdateProfiles: extractWeaponBonusUpdateProfiles(self, objectDef),
    weaponBonusUpdateNextPulseFrames: [],
    // Temp weapon bonus (target side)
    tempWeaponBonusFlag: 0,
    tempWeaponBonusExpiryFrame: 0,
    // Instant death die modules
    instantDeathProfiles: extractInstantDeathProfiles(self, objectDef),
    // Fire weapon when dead die modules
    fireWeaponWhenDeadProfiles: extractFireWeaponWhenDeadProfiles(self, objectDef),
    // Slow death
    slowDeathProfiles: extractSlowDeathProfiles(self, objectDef),
    slowDeathState: null,
    // Structure collapse
    structureCollapseProfile: extractStructureCollapseProfile(self, objectDef),
    structureCollapseState: null,
    // EMP update (pulse field that disables nearby entities)
    empUpdateProfile: extractEmpUpdateProfile(self, objectDef),
    empUpdateState: null,
    // Hijacker update (hide in vehicle, eject on death)
    hijackerUpdateProfile: extractHijackerUpdateProfile(self, objectDef),
    hijackerState: null,
    // Leaflet drop (delayed radius disable)
    leafletDropProfile: extractLeafletDropProfile(self, objectDef),
    leafletDropState: null,
    // SmartBomb target homing (course correction for falling projectiles)
    smartBombProfile: extractSmartBombProfile(self, objectDef),
    smartBombState: null,
    // Dynamic geometry (collision shape morphing)
    dynamicGeometryProfile: extractDynamicGeometryProfile(self, objectDef),
    dynamicGeometryState: null,
    // Firestorm damage pulse (extends DynamicGeometryInfoUpdate)
    firestormDamageProfile: extractFirestormDamageProfile(self, objectDef),
    firestormDamageState: null,
    // Fire OCL after weapon cooldown
    fireOCLAfterCooldownProfiles: extractFireOCLAfterCooldownProfiles(self, objectDef),
    fireOCLAfterCooldownStates: [],
    // Neutron blast (death-triggered radius effect)
    neutronBlastProfile: extractNeutronBlastProfile(self, objectDef),
    // Bunker buster (kills garrisoned units on bomb death)
    bunkerBusterProfile: extractBunkerBusterProfile(self, objectDef),
    bunkerBusterVictimId: null,
    // Grant stealth (GPS Scrambler expanding radius)
    grantStealthProfile: self.extractGrantStealthProfile(objectDef),
    grantStealthCurrentRadius: 0,
    // Neutron missile slow death (timed blast waves)
    neutronMissileSlowDeathProfile: extractNeutronMissileSlowDeathProfile(self, objectDef),
    neutronMissileSlowDeathState: null,
    // Helicopter slow death (spiral crash)
    helicopterSlowDeathProfiles: extractHelicopterSlowDeathProfiles(self, objectDef),
    helicopterSlowDeathState: null,
    // Jet slow death (roll + forward motion + FX timeline)
    jetSlowDeathProfiles: self.extractJetSlowDeathProfiles(objectDef),
    jetSlowDeathState: null,
    // Cleanup hazard (workers scan and clean hazards)
    cleanupHazardProfile: extractCleanupHazardProfile(self, objectDef),
    cleanupHazardState: null,
    // Assisted targeting (laser designation)
    assistedTargetingProfile: extractAssistedTargetingProfile(self, objectDef),
    // Tech building behavior (neutral buildings)
    techBuildingProfile: extractTechBuildingProfile(self, objectDef),
    // SupplyWarehouseCrippling
    supplyWarehouseCripplingProfile: extractSupplyWarehouseCripplingProfile(self, objectDef),
    swCripplingHealSuppressedUntilFrame: 0,
    swCripplingNextHealFrame: 0,
    swCripplingDockDisabled: false,
    // Generate minefield
    generateMinefieldProfile: extractGenerateMinefieldProfile(self, objectDef),
    generateMinefieldDone: false,
    // Crate spawning on death
    createCrateDieProfile: extractCreateCrateDieProfile(self, objectDef),
    // Salvage crate collection
    salvageCrateProfile: extractSalvageCrateProfile(self, objectDef),
    crateCollideProfile: extractCrateCollideProfile(self, objectDef),
    // Battle plan
    battlePlanProfile: extractBattlePlanProfile(self, objectDef),
    battlePlanState: null,
    battlePlanDamageScalar: 1.0,
    baseVisionRange: visionRangeFromTemplate,
    baseShroudClearingRange: shroudClearingRangeFromTemplate,
    // Point defense laser
    pointDefenseLaserProfile: extractPointDefenseLaserProfile(self, objectDef),
    pdlNextScanFrame: 0,
    pdlTargetProjectileVisualId: 0,
    pdlNextShotFrame: 0,
    // Horde formation bonus
    hordeProfile: extractHordeUpdateProfile(self, objectDef),
    hordeNextCheckFrame: 0,
    isInHorde: false,
    isTrueHordeMember: false,
    // EnemyNear
    enemyNearScanDelayFrames: extractEnemyNearScanDelay(self, objectDef),
    enemyNearNextScanCountdown: 0,
    enemyNearDetected: false,
    // Slaved update (slave following behavior)
    slavedUpdateProfile: self.extractSlavedUpdateProfile(objectDef),
    slaveGuardOffsetX: 0,
    slaveGuardOffsetZ: 0,
    slavedNextUpdateFrame: 0,
    // Countermeasures (aircraft flare defense)
    countermeasuresProfile: extractCountermeasuresProfile(self, objectDef),
    countermeasuresState: null,
    // Pilot find vehicle
    pilotFindVehicleProfile: extractPilotFindVehicleProfile(self, objectDef),
    pilotFindVehicleNextScanFrame: 0,
    pilotFindVehicleDidMoveToBase: false,
    pilotFindVehicleTargetId: null,
    // Topple
    toppleProfile: extractToppleProfile(self, objectDef),
    toppleState: 'NONE' as ToppleState,
    toppleDirX: 0,
    toppleDirZ: 0,
    toppleAngularVelocity: 0,
    toppleAngularAccumulation: 0,
    toppleSpeed: 0,
    // PhysicsBehavior (rigid body physics)
    physicsBehaviorProfile: extractPhysicsBehaviorProfile(self, objectDef),
    physicsBehaviorState: null,
    // StructureToppleUpdate (building collapse)
    structureToppleProfile: extractStructureToppleProfile(self, objectDef),
    structureToppleState: null,
    // MissileLauncherBuildingUpdate (SCUD Storm doors)
    missileLauncherBuildingProfile: extractMissileLauncherBuildingProfile(self, objectDef),
    missileLauncherBuildingState: null,
    // ParticleUplinkCannonUpdate (Particle Cannon)
    particleUplinkCannonProfile: extractParticleUplinkCannonProfile(self, objectDef),
    particleUplinkCannonState: null,
    // NeutronMissileUpdate (nuke missile flight)
    neutronMissileUpdateProfile: extractNeutronMissileUpdateProfile(self, objectDef),
    neutronMissileUpdateState: null,
    // Special ability
    specialAbilityProfile: extractSpecialAbilityProfile(self, objectDef),
    specialAbilityState: null,
    // RadarUpdate
    radarUpdateProfile: extractRadarUpdateProfile(self, objectDef),
    radarExtendDoneFrame: 0,
    radarExtendComplete: false,
    radarActive: false,
    // FloatUpdate
    floatUpdateProfile: extractFloatUpdateProfile(self, objectDef),
    // WanderAIUpdate
    hasWanderAI: self.hasModuleType(objectDef, 'WANDERAIUPDATE'),
    // ScriptActions::doTeamWanderInPlace
    scriptWanderInPlaceActive: false,
    scriptWanderInPlaceOriginX: 0,
    scriptWanderInPlaceOriginZ: 0,
    // VeterancyGainCreate
    veterancyGainCreateProfiles: extractVeterancyGainCreateProfiles(self, objectDef),
    // FXListDie
    fxListDieProfiles: extractFXListDieProfiles(self, objectDef),
    // CrushDie
    crushDieProfiles: extractCrushDieProfiles(self, objectDef),
    // DestroyDie
    destroyDieProfiles: extractDestroyDieProfiles(self, objectDef),
    // DamDie
    damDieProfiles: extractDamDieProfiles(self, objectDef),
    // SpecialPowerCompletionDie
    specialPowerCompletionDieProfiles: extractSpecialPowerCompletionDieProfiles(self, objectDef),
    specialPowerCompletionCreatorId: 0,
    specialPowerCompletionCreatorSet: false,
    frontCrushed: false,
    backCrushed: false,
    // GrantUpgradeCreate
    grantUpgradeCreateProfiles: extractGrantUpgradeCreateProfiles(self, objectDef),
    // LockWeaponCreate
    lockWeaponCreateSlot: extractLockWeaponCreateSlot(self, objectDef),
    // UpgradeDie
    upgradeDieProfiles: extractUpgradeDieProfiles(self, objectDef),
    producerEntityId: 0,
    // CheckpointUpdate
    checkpointProfile: extractCheckpointProfile(self, objectDef),
    checkpointAllyNear: false,
    checkpointEnemyNear: false,
    checkpointMaxMinorRadius: 0,
    checkpointScanCountdown: 0,
    // DynamicShroudClearingRangeUpdate
    dynamicShroudProfile: extractDynamicShroudProfile(self, objectDef),
    dynamicShroudState: 'NOT_STARTED' as DynamicShroudState,
    dynamicShroudStateCountdown: 0,
    dynamicShroudTotalFrames: 0,
    dynamicShroudShrinkStartDeadline: 0,
    dynamicShroudSustainDeadline: 0,
    dynamicShroudGrowStartDeadline: 0,
    dynamicShroudDoneForeverFrame: 0,
    dynamicShroudChangeIntervalCountdown: 0,
    dynamicShroudNativeClearingRange: 0,
    dynamicShroudCurrentClearingRange: 0,
    // JetAI
    jetAIProfile,
    jetAIState: null,
    // AnimationSteeringUpdate
    animationSteeringProfile,
    animationSteeringCurrentTurnAnim: null,
    animationSteeringNextTransitionFrame: 0,
    animationSteeringLastRotationY: rotationY,
    tensileFormationProfile,
    tensileFormationState: tensileFormationProfile ? {
      enabled: tensileFormationProfile.enabled,
      linksInited: false,
      links: [
        { id: 0, tensorX: 0, tensorZ: 0 },
        { id: 0, tensorX: 0, tensorZ: 0 },
        { id: 0, tensorX: 0, tensorZ: 0 },
        { id: 0, tensorX: 0, tensorZ: 0 },
      ],
      inertiaX: 0,
      inertiaZ: 0,
      motionlessCounter: 0,
      life: 0,
      lowestSlideElevation: 255,
      nextWakeFrame: 0,
      footprintRemoved: false,
      originalBlocksPath: blocksPath,
      done: false,
    } : null,
    // AssaultTransport
    assaultTransportProfile: extractAssaultTransportProfile(self, objectDef),
    // PowerPlantUpdate
    powerPlantUpdateProfile: extractPowerPlantUpdateProfile(self, objectDef),
    powerPlantUpdateState: null,
    // SpecialPowerCreate
    hasSpecialPowerCreate: self.hasModuleType(objectDef, 'SPECIALPOWERCREATE'),
    shroudRange: 0,
    // SubdualDamageHelper
    subdualDamageCap: bodyStats.subdualDamageCap,
    subdualDamageHealRate: bodyStats.subdualDamageHealRate,
    subdualDamageHealAmount: bodyStats.subdualDamageHealAmount,
    currentSubdualDamage: 0,
    subdualHealingCountdown: 0,
    // ModelConditionFlags entity state
    cheerTimerFrames: 0,
    raisingFlagTimerFrames: 0,
    explodedState: 'NONE' as const,
    battleBusEmptyHulkDestroyFrame: 0,
    // Projectile stream tracking (toxin/flamethrower beams)
    projectileStreamProfile: extractProjectileStreamProfile(self, objectDef),
    projectileStreamState: null,
    // MobMemberSlavedUpdate (angry mob member behavior)
    mobMemberProfile: self.extractMobMemberSlavedUpdateProfile(objectDef),
    mobMemberState: null,
    // BoneFXUpdate (bone-attached visual effects per damage state)
    boneFXProfile: extractBoneFXProfile(self, objectDef),
    boneFXState: null,
    // RadiusDecalUpdate (ground radius decals — programmatically created, not INI-driven)
    radiusDecalStates: [],
    // Bridge behavior (bridge lifecycle manager)
    bridgeBehaviorProfile: self.extractBridgeBehaviorProfile(objectDef),
    bridgeBehaviorState: null,
    // Bridge tower behavior (corner towers attached to bridges)
    bridgeTowerProfile: self.extractBridgeTowerProfile(objectDef),
    bridgeTowerState: null,
    // Bridge scaffold behavior (scaffold animation)
    bridgeScaffoldState: null,
    // Flight deck (aircraft carrier)
    flightDeckProfile,
    flightDeckState: null,
    // SpectreGunship (gunship orbital flight + weapons)
    spectreGunshipProfile: self.extractSpectreGunshipUpdateProfile(objectDef),
    spectreGunshipState: null,
    // SpectreGunshipDeployment (command center deployment)
    spectreGunshipDeploymentProfile: self.extractSpectreGunshipDeploymentProfile(objectDef),
    // WaveGuideUpdate (flood wave mechanics — dam break / GLA Sneak Attack)
    waveGuideProfile: extractWaveGuideProfile(self, objectDef),
    // DumbProjectileBehavior (projectile flight path and detonation)
    dumbProjectileProfile: extractDumbProjectileBehaviorProfile(self, objectDef),
  };

  self.applyMapObjectCoreProperties(entity, mapObject);
  self.applyMapObjectAmbientSoundProperties(entity, mapObject, iniDataRegistry);

  // Source parity: PowerPlantUpdate init — extended=false, sleeping forever.
  if (entity.powerPlantUpdateProfile) {
    entity.powerPlantUpdateState = { extended: false, upgradeFinishFrame: 0 };
  }

  // Source parity: TurretAI init — create runtime state for each turret.
  entity.turretStates = entity.turretProfiles.map((tp) => ({
    currentAngle: tp.naturalAngle,
    state: 'IDLE' as const,
    holdUntilFrame: 0,
  }));

  // Source parity: StealthUpdate::init — InnateStealth sets CAN_STEALTH on creation.
  if (entity.stealthProfile?.innateStealth) {
    entity.objectStatusFlags.add('CAN_STEALTH');
  }

  // Source parity: StealthDetectorUpdate init — stagger initial scan with random offset.
  if (entity.detectorProfile) {
    entity.detectorNextScanFrame = self.frameCounter
      + self.gameRandom.nextRange(1, entity.detectorProfile.detectionRate);
  }

  // Source parity: BattlePlanUpdate init — initialize state machine.
  if (entity.battlePlanProfile) {
    entity.battlePlanState = {
      desiredPlan: 'NONE',
      activePlan: 'NONE',
      transitionStatus: 'IDLE',
      transitionFinishFrame: 0,
      idleCooldownFinishFrame: 0,
    };
  }

  // Source parity: PointDefenseLaserUpdate init — stagger initial scan.
  if (entity.pointDefenseLaserProfile) {
    const rate = Math.max(1, entity.pointDefenseLaserProfile.scanRate);
    entity.pdlNextScanFrame = self.frameCounter + self.gameRandom.nextRange(0, rate);
  }

  // Source parity: HordeUpdate init — stagger initial scan to spread load.
  // C++ uses GameLogicRandomValue(1, delay) → [1, delay] inclusive.
  if (entity.hordeProfile) {
    const rate = Math.max(1, entity.hordeProfile.updateRate);
    entity.hordeNextCheckFrame = self.frameCounter + self.gameRandom.nextRange(1, rate);
  }

  // Source parity: AutoHealBehavior constructor — active modules wake after a
  // random delay in [1, HealingDelay] rather than running on the creation frame.
  if (entity.autoHealProfile?.initiallyActive) {
    const delay = Math.max(1, entity.autoHealProfile.healingDelayFrames);
    entity.autoHealNextFrame = self.frameCounter + self.gameRandom.nextRange(1, delay);
  }

  // Source parity: EnemyNearUpdate constructor — random initial delay for staggered scanning.
  // C++ uses GameLogicRandomValue(0, m_enemyScanDelayTime).
  if (entity.enemyNearScanDelayFrames > 0) {
    entity.enemyNearNextScanCountdown = self.gameRandom.nextRange(0, entity.enemyNearScanDelayFrames);
  }

  // Source parity: DemoTrapUpdate::onObjectCreated — set initial mode.
  if (entity.demoTrapProfile) {
    entity.demoTrapProximityMode = entity.demoTrapProfile.defaultsToProximityMode;
  }

  // Source parity: SpecialAbilityUpdate::onObjectCreated — init state machine.
  // Default to PACKED; if no unpack time or skipPackingWithNoTarget, start UNPACKED.
  if (entity.specialAbilityProfile) {
    const sap = entity.specialAbilityProfile;
    const initialPacking: SpecialAbilityPackingState =
      sap.unpackTimeFrames === 0 ? 'UNPACKED' : 'PACKED';
    entity.specialAbilityState = {
      active: false,
      packingState: initialPacking,
      prepFrames: 0,
      animFrames: 0,
      targetEntityId: null,
      targetX: null,
      targetZ: null,
      withinStartAbilityRange: false,
      noTargetCommand: false,
      persistentTriggerCount: 0,
    };
  }

  // Source parity: CountermeasuresBehavior::onObjectCreated — init state.
  if (entity.countermeasuresProfile) {
    const cp = entity.countermeasuresProfile;
    entity.countermeasuresState = {
      availableCountermeasures: cp.numberOfVolleys * cp.volleySize,
      activeCountermeasures: 0,
      flareIds: [],
      reactionFrame: 0,
      nextVolleyFrame: 0,
      reloadFrame: 0,
      incomingMissiles: 0,
      divertedMissiles: 0,
    };
  }

  // Source parity: CheckpointUpdate constructor — cache maxMinorRadius, random scan stagger.
  if (entity.checkpointProfile) {
    entity.checkpointMaxMinorRadius = entity.obstacleGeometry?.minorRadius ?? 0;
    entity.checkpointScanCountdown = self.gameRandom.nextRange(0, entity.checkpointProfile.scanDelayFrames);
  }

  // Source parity: AutoDepositUpdate constructor — schedule first deposit.
  // C++ line 78: m_depositOnFrame = TheGameLogic->getFrame() + m_depositFrame.
  if (entity.autoDepositProfile) {
    entity.autoDepositNextFrame = self.frameCounter + entity.autoDepositProfile.depositFrames;
  }

  // Source parity: DynamicShroudClearingRangeUpdate constructor — compute deadlines.
  // C++ lines 89-133: timeline deadlines computed from profile timing values.
  if (entity.dynamicShroudProfile) {
    const prof = entity.dynamicShroudProfile;
    const stateCountDown = prof.shrinkDelay + prof.shrinkTime;
    entity.dynamicShroudStateCountdown = stateCountDown;
    entity.dynamicShroudTotalFrames = Math.max(1, stateCountDown);
    entity.dynamicShroudShrinkStartDeadline = stateCountDown - prof.shrinkDelay;
    entity.dynamicShroudGrowStartDeadline = stateCountDown - prof.growDelay;
    entity.dynamicShroudSustainDeadline = entity.dynamicShroudGrowStartDeadline - prof.growTime;
    // Source parity: C++ DEBUG_ASSERTCRASH checks (DynamicShroudClearingRangeUpdate.cpp:104-105).
    if (entity.dynamicShroudSustainDeadline < entity.dynamicShroudShrinkStartDeadline) {
      console.warn(`DynamicShroudClearingRangeUpdate: sustainDeadline(${entity.dynamicShroudSustainDeadline}) < shrinkStartDeadline(${entity.dynamicShroudShrinkStartDeadline}) — invalid INI configuration`);
    }
    if (entity.dynamicShroudGrowStartDeadline < entity.dynamicShroudShrinkStartDeadline) {
      console.warn(`DynamicShroudClearingRangeUpdate: growStartDeadline(${entity.dynamicShroudGrowStartDeadline}) < shrinkStartDeadline(${entity.dynamicShroudShrinkStartDeadline}) — invalid INI configuration`);
    }
    entity.dynamicShroudDoneForeverFrame = self.frameCounter + stateCountDown;
    entity.dynamicShroudNativeClearingRange = entity.shroudClearingRange;
    entity.dynamicShroudCurrentClearingRange = 0;
    entity.dynamicShroudState = 'NOT_STARTED';
    entity.dynamicShroudChangeIntervalCountdown = 0;
  }

  // Source parity: JetAIUpdate::onObjectCreated — init flight state machine.
  // Map-placed aircraft start AIRBORNE (already flying). Produced aircraft are set
  // to PARKED by applyQueueProductionExitPath.
  if (jetAIProfile) {
    // Source parity: cruise height from MinHeight INI field, fallback to 100.
    // C++ uses locomotor preferredHeight as middle fallback but we don't parse that yet.
    const cruiseHeight = jetAIProfile.minHeight > 0 ? jetAIProfile.minHeight : 100;
    entity.jetAIState = {
      state: 'AIRBORNE',
      stateEnteredFrame: self.frameCounter,
      allowAirLoco: true,
      pendingCommand: null,
      producerX: entity.x,
      producerZ: entity.z,
      returnToBaseFrame: 0,
      attackLocoExpireFrame: 0,
      useReturnLoco: false,
      reloadDoneFrame: 0,
      reloadTotalFrames: 0,
      circlingNextCheckFrame: 0,
      cruiseHeight,
    };
    // Map-placed aircraft are airborne.
    entity.objectStatusFlags.add('AIRBORNE_TARGET');
  }

  // Source parity: FlightDeckBehavior::buildInfo — initialize flight deck parking/runway state.
  if (flightDeckProfile) {
    self.initializeFlightDeckState(entity, flightDeckProfile);
  }

  // Source parity: GrantUpgradeCreate::onCreate — grant upgrades on entity creation.
  // C++ only grants in onCreate if ExemptStatus includes UNDER_CONSTRUCTION and entity
  // is NOT currently under construction (i.e. placed fully built).
  for (const prof of entity.grantUpgradeCreateProfiles) {
    if (prof.exemptUnderConstruction && !entity.objectStatusFlags.has('UNDER_CONSTRUCTION')) {
      self.applyGrantUpgradeCreate(entity, prof);
    }
  }

  // Source parity: VeterancyGainCreate::onCreate — set min veterancy if player has science.
  // C++ file: VeterancyGainCreate.cpp lines 81-93.
  for (const prof of entity.veterancyGainCreateProfiles) {
    if (prof.scienceRequired === null || self.hasSideScience(entity.side ?? '', prof.scienceRequired)) {
      self.setMinVeterancyLevel(entity, prof.startingLevel);
    }
  }

  // Source parity: LockWeaponCreate::onBuildComplete — lock weapon slot permanently.
  // For non-building entities this fires immediately at creation.
  if (entity.lockWeaponCreateSlot !== null && !entity.objectStatusFlags.has('UNDER_CONSTRUCTION')) {
    entity.forcedWeaponSlot = entity.lockWeaponCreateSlot;
    entity.weaponLockStatus = 'LOCKED_PERMANENTLY';
  }

  // Source parity: FireWeaponUpdate — initialize per-module fire timers with initial delay.
  if (entity.fireWeaponUpdateProfiles.length > 0) {
    entity.fireWeaponUpdateNextFireFrames = entity.fireWeaponUpdateProfiles.map(
      p => self.frameCounter + p.initialDelayFrames,
    );
  }

  // Source parity: OCLUpdate — initialize per-module creation timers (start at 0, first check sets timer).
  if (entity.oclUpdateProfiles.length > 0) {
    entity.oclUpdateNextCreationFrames = entity.oclUpdateProfiles.map(() => 0);
    entity.oclUpdateTimerStarted = entity.oclUpdateProfiles.map(() => false);
  }

  // Source parity: WeaponBonusUpdate — initialize per-module pulse timers.
  if (entity.weaponBonusUpdateProfiles.length > 0) {
    entity.weaponBonusUpdateNextPulseFrames = entity.weaponBonusUpdateProfiles.map(() => 0);
  }

  // Source parity: GrantStealthBehavior — initialize scan radius from profile.
  if (entity.grantStealthProfile) {
    entity.grantStealthCurrentRadius = entity.grantStealthProfile.startRadius;
  }

  // Source parity: BoneFXUpdate::BoneFXUpdate — initialize runtime state if profile exists.
  if (entity.boneFXProfile) {
    const numStates = 4; // BODYDAMAGETYPE_COUNT
    const numBones = 8; // BONE_FX_MAX_BONES
    const makeFrameGrid = (): number[][] => {
      const grid: number[][] = [];
      for (let i = 0; i < numStates; i++) {
        grid.push(new Array(numBones).fill(-1));
      }
      return grid;
    };
    entity.boneFXState = {
      currentBodyState: 0,
      active: false,
      nextFXFrame: makeFrameGrid(),
      nextOCLFrame: makeFrameGrid(),
      nextParticleFrame: makeFrameGrid(),
      activeParticleIds: [],
      pendingVisualEvents: [],
    };
  }

  // Source parity: BridgeBehavior — initialize bridge behavior state.
  if (entity.bridgeBehaviorProfile) {
    entity.bridgeBehaviorState = {
      towerIds: [],
      scaffoldIds: [],
      isBridgeDestroyed: false,
      bridgeCells: [],
      deathFrame: 0,
    };
  }

  return entity;
}

export function extractIniValueTokens(self: GL, value: IniValue | undefined): string[][] {
  if (typeof value === 'undefined') {
    return [];
  }
  if (value === null) {
    return [];
  }
  if (typeof value === 'string') {
    return [value.split(/[\s,;|]+/).map((token) => token.trim()).filter(Boolean)];
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return [[String(value)]];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => extractIniValueTokens(self, entry as IniValue));
  }
  return [];
}

export function extractDynamicAudioEventName(self: GL, fields: Record<string, IniValue>, fieldName: string): string | null {
  const value = self.readIniFieldValue(fields, fieldName);
  for (const tokenGroup of extractIniValueTokens(self, value)) {
    const eventName = tokenGroup[0]?.trim();
    if (!eventName) {
      continue;
    }
    const normalized = eventName.toUpperCase();
    if (normalized === 'NONE' || normalized === 'NOSOUND') {
      return null;
    }
    return eventName;
  }
  return null;
}

export function extractAmbientSoundProfile(self: GL, objectDef: ObjectDef | undefined): AmbientSoundProfile | null {
  if (!objectDef) {
    return null;
  }

  const pristine = extractDynamicAudioEventName(self, objectDef.fields, 'SoundAmbient');
  const damaged = extractDynamicAudioEventName(self, objectDef.fields, 'SoundAmbientDamaged');
  const reallyDamaged = extractDynamicAudioEventName(self, objectDef.fields, 'SoundAmbientReallyDamaged');
  const rubble = extractDynamicAudioEventName(self, objectDef.fields, 'SoundAmbientRubble');
  if (!pristine && !damaged && !reallyDamaged && !rubble) {
    return null;
  }
  return {
    pristine,
    damaged,
    reallyDamaged,
    rubble,
  };
}

export function extractWeaponNamesFromTokens(self: GL, tokens: string[]): string[] {
  const filteredTokens = tokens.filter((token) => token.trim().length > 0).map((token) => token.trim());
  if (filteredTokens.length === 0) {
    return [];
  }

  const slotNames = new Set(['PRIMARY', 'SECONDARY', 'TERTIARY']);
  const weapons: string[] = [];

  let tokenIndex = 0;
  while (tokenIndex < filteredTokens.length) {
    const token = filteredTokens[tokenIndex]!;
    const upperToken = token.toUpperCase();

    if (slotNames.has(upperToken)) {
      const weaponName = filteredTokens[tokenIndex + 1];
      tokenIndex += 2;
      if (weaponName === undefined) {
        continue;
      }
      if (weaponName.toUpperCase() === 'NONE') {
        continue;
      }
      weapons.push(weaponName);
      continue;
    }

    if (upperToken === 'NONE') {
      tokenIndex++;
      continue;
    }

    weapons.push(token);
    tokenIndex++;
  }
  return weapons;
}

export function extractWeaponTemplateSets(self: GL, objectDef: ObjectDef | undefined): WeaponTemplateSetProfile[] {
  if (!objectDef) {
    return [];
  }

  const sets: WeaponTemplateSetProfile[] = [];
  const visitBlock = (block: IniBlock): void => {
    if (block.type.toUpperCase() === 'WEAPONSET') {
      sets.push({
        conditionsMask: extractConditionsMask(self, 
          self.readIniFieldValue(block.fields, 'Conditions'),
          WEAPON_SET_FLAG_MASK_BY_NAME,
        ),
        weaponNamesBySlot: extractWeaponNamesBySlot(self, block.fields),
      });
    }
    for (const child of block.blocks) {
      visitBlock(child);
    }
  };

  for (const block of objectDef.blocks) {
    visitBlock(block);
  }

  if (sets.length > 0) {
    return sets;
  }

  const fallback = self.collectWeaponNamesInPriorityOrder(objectDef);
  if (fallback.length === 0) {
    return [];
  }

  const fallbackBySlot: [string | null, string | null, string | null] = [
    fallback[0] ?? null,
    fallback[1] ?? null,
    fallback[2] ?? null,
  ];
  return [{ conditionsMask: 0, weaponNamesBySlot: fallbackBySlot }];
}

export function extractArmorTemplateSets(self: GL, objectDef: ObjectDef | undefined): ArmorTemplateSetProfile[] {
  if (!objectDef) {
    return [];
  }

  const sets: ArmorTemplateSetProfile[] = [];
  const visitBlock = (block: IniBlock): void => {
    if (block.type.toUpperCase() === 'ARMORSET') {
      sets.push({
        conditionsMask: extractConditionsMask(self, 
          self.readIniFieldValue(block.fields, 'Conditions'),
          ARMOR_SET_FLAG_MASK_BY_NAME,
        ),
        armorName: self.resolveIniFieldString(block.fields, 'Armor'),
      });
    }
    for (const child of block.blocks) {
      visitBlock(child);
    }
  };

  for (const block of objectDef.blocks) {
    visitBlock(block);
  }

  if (sets.length > 0) {
    return sets;
  }

  const fallbackArmor = self.resolveIniFieldString(objectDef.fields, 'Armor');
  if (!fallbackArmor) {
    return [];
  }

  return [{ conditionsMask: 0, armorName: fallbackArmor }];
}

export function extractConditionsMask(self: GL, value: IniValue | undefined, flagMaskByName: Map<string, number>): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.trunc(value));
  }

  let mask = 0;
  for (const tokens of extractIniValueTokens(self, value)) {
    for (const token of tokens) {
      const normalized = token.trim().toUpperCase();
      const bitMask = flagMaskByName.get(normalized);
      if (bitMask !== undefined) {
        mask |= bitMask;
      }
    }
  }

  return mask;
}

export function extractWeaponNamesBySlot(self: GL, fields: Record<string, IniValue>): [string | null, string | null, string | null] {
  const slots: [string | null, string | null, string | null] = [null, null, null];

  for (const [fieldName, fieldValue] of Object.entries(fields)) {
    if (fieldName.toUpperCase() !== 'WEAPON') {
      continue;
    }

    const tokenGroups = extractIniValueTokens(self, fieldValue);
    if (
      Array.isArray(fieldValue)
      && fieldValue.every((entry) => typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean')
    ) {
      const inlineTokens = fieldValue
        .map((entry) => String(entry).trim())
        .filter((entry) => entry.length > 0);
      if (inlineTokens.length > 0) {
        tokenGroups.unshift(inlineTokens);
      }
    }

    for (const tokens of tokenGroups) {
      const slotName = tokens[0]?.trim().toUpperCase() ?? '';
      const weaponName = tokens[1]?.trim();
      if (!weaponName) {
        continue;
      }
      const normalizedWeaponName = weaponName.toUpperCase() === 'NONE' ? null : weaponName;
      if (slotName === 'PRIMARY') {
        slots[0] = normalizedWeaponName;
      } else if (slotName === 'SECONDARY') {
        slots[1] = normalizedWeaponName;
      } else if (slotName === 'TERTIARY') {
        slots[2] = normalizedWeaponName;
      }
    }
  }

  return slots;
}

export function extractHiveStructureProfile(self: GL, 
  objectDef: ObjectDef | undefined,
  bodyType: BodyModuleType,
): HiveStructureBodyProfile | null {
  if (!objectDef || bodyType !== 'HIVE_STRUCTURE') return null;

  const propagateTypes = new Set<string>();
  const swallowTypes = new Set<string>();

  for (const block of objectDef.blocks) {
    if (block.type.toUpperCase() !== 'BODY') continue;
    const moduleName = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
    if (moduleName !== 'HIVESTRUCTUREBODY') continue;

    const propagateRaw = readStringField(block.fields, ['PropagateDamageTypesToSlavesWhenExisting']);
    if (propagateRaw) {
      for (const token of propagateRaw.trim().split(/\s+/)) {
        if (token) propagateTypes.add(token.toUpperCase());
      }
    }
    const swallowRaw = readStringField(block.fields, ['SwallowDamageTypesIfSlavesNotExisting']);
    if (swallowRaw) {
      for (const token of swallowRaw.trim().split(/\s+/)) {
        if (token) swallowTypes.add(token.toUpperCase());
      }
    }
    break;
  }

  return { propagateDamageTypes: propagateTypes, swallowDamageTypes: swallowTypes };
}

export function extractProductionProfile(self: GL, objectDef: ObjectDef | undefined): ProductionProfile | null {
  if (!objectDef) {
    return null;
  }

  let foundModule = false;
  let maxQueueEntries = 9;
  let numDoorAnimations = 0;
  let doorOpeningTimeFrames = 0;
  let constructionCompleteDurationFrames = 0;
  const quantityModifiers: Array<{ templateName: string; quantity: number }> = [];

  const visitBlock = (block: IniBlock): void => {
    if (block.type.toUpperCase() === 'BEHAVIOR') {
      const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
      if (moduleType === 'PRODUCTIONUPDATE') {
        foundModule = true;

        const configuredMaxQueueEntries = readNumericField(block.fields, ['MaxQueueEntries']);
        if (configuredMaxQueueEntries !== null && Number.isFinite(configuredMaxQueueEntries)) {
          maxQueueEntries = Math.max(0, Math.trunc(configuredMaxQueueEntries));
        }

        // Source parity: ProductionUpdateModuleData::m_numDoorAnimations (parseInt).
        const numDoorRaw = readNumericField(block.fields, ['NumDoorAnimations']);
        if (numDoorRaw !== null && Number.isFinite(numDoorRaw)) {
          numDoorAnimations = Math.max(0, Math.trunc(numDoorRaw));
        }

        // Source parity: ProductionUpdateModuleData::m_doorOpeningTime (parseDurationUnsignedInt).
        const doorOpeningMs = readNumericField(block.fields, ['DoorOpeningTime']) ?? 0;
        doorOpeningTimeFrames = self.msToLogicFrames(doorOpeningMs);

        // Source parity: ProductionUpdateModuleData::m_constructionCompleteDuration (parseDurationUnsignedInt).
        const constructionCompleteMs = readNumericField(block.fields, ['ConstructionCompleteDuration']) ?? 0;
        constructionCompleteDurationFrames = self.msToLogicFrames(constructionCompleteMs);

        for (const tokens of extractIniValueTokens(self, block.fields['QuantityModifier'])) {
          const templateName = tokens[0]?.trim();
          if (!templateName || templateName.toUpperCase() === 'NONE') {
            continue;
          }
          const quantityRaw = tokens[1] !== undefined ? Number(tokens[1]) : 1;
          const quantity = Number.isFinite(quantityRaw) ? Math.max(1, Math.trunc(quantityRaw)) : 1;
          quantityModifiers.push({
            templateName: templateName.toUpperCase(),
            quantity,
          });
        }
      }
    }

    for (const child of block.blocks) {
      visitBlock(child);
    }
  };

  for (const block of objectDef.blocks) {
    visitBlock(block);
  }

  if (!foundModule) {
    return null;
  }

  return {
    maxQueueEntries,
    quantityModifiers,
    numDoorAnimations,
    doorOpeningTimeFrames,
    constructionCompleteDurationFrames,
  };
}

export function extractQueueProductionExitProfile(self: GL, objectDef: ObjectDef | undefined): QueueProductionExitProfile | null {
  if (!objectDef) {
    return null;
  }

  let profile: QueueProductionExitProfile | null = null;

  const visitBlock = (block: IniBlock): void => {
    if (profile !== null) {
      return;
    }
    if (block.type.toUpperCase() === 'BEHAVIOR') {
      const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
      // Source parity: C++ uses DefaultProductionExitUpdate (most buildings)
      // and QueueProductionExitUpdate (identical behavior, same fields).
      if (moduleType === 'DEFAULTPRODUCTIONEXITUPDATE' || moduleType === 'QUEUEPRODUCTIONEXITUPDATE') {
        const unitCreatePoint = readCoord3DField(block.fields, ['UnitCreatePoint']) ?? { x: 0, y: 0, z: 0 };
        const naturalRallyPoint = readCoord3DField(block.fields, ['NaturalRallyPoint']);
        const exitDelayMs = readNumericField(block.fields, ['ExitDelay']) ?? 0;
        const initialBurstRaw = readNumericField(block.fields, ['InitialBurst']) ?? 0;
        profile = {
          moduleType: 'QUEUE',
          unitCreatePoint,
          naturalRallyPoint,
          exitDelayFrames: self.msToLogicFrames(exitDelayMs),
          allowAirborneCreation: readBooleanField(block.fields, ['AllowAirborneCreation']) === true,
          initialBurst: Math.max(0, Math.trunc(initialBurstRaw)),
          spawnPointBoneName: null,
        };
      } else if (moduleType === 'SUPPLYCENTERPRODUCTIONEXITUPDATE') {
        const unitCreatePoint = readCoord3DField(block.fields, ['UnitCreatePoint']) ?? { x: 0, y: 0, z: 0 };
        const naturalRallyPoint = readCoord3DField(block.fields, ['NaturalRallyPoint']);
        profile = {
          moduleType: 'SUPPLY_CENTER',
          unitCreatePoint,
          naturalRallyPoint,
          exitDelayFrames: 0,
          allowAirborneCreation: false,
          initialBurst: 0,
          spawnPointBoneName: null,
        };
      } else if (moduleType === 'SPAWNPOINTPRODUCTIONEXITUPDATE') {
        // Source parity: SpawnPointProductionExitUpdate.cpp drives exits from named bone positions.
        // This browser port currently lacks bone-space exit placement, so we deterministically
        // use producer-local origin and emit no rally/airborne overrides.
        const spawnPointBoneName = readStringField(block.fields, ['SpawnPointBoneName']);
        profile = {
          moduleType: 'SPAWN_POINT',
          unitCreatePoint: { x: 0, y: 0, z: 0 },
          naturalRallyPoint: null,
          exitDelayFrames: 0,
          allowAirborneCreation: false,
          initialBurst: 0,
          spawnPointBoneName: spawnPointBoneName ?? null,
        };
      }
    }

    for (const child of block.blocks) {
      visitBlock(child);
    }
  };

  for (const block of objectDef.blocks) {
    visitBlock(block);
  }

  return profile;
}

export function extractContainProfile(self: GL, objectDef: ObjectDef | undefined): ContainProfile | null {
  if (!objectDef) {
    return null;
  }

  let profile: ContainProfile | null = null;

  const visitBlock = (block: IniBlock): void => {
    if (profile !== null) {
      return;
    }
    if (block.type.toUpperCase() !== 'BEHAVIOR') {
      for (const child of block.blocks) {
        visitBlock(child);
      }
      return;
    }

    const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
    const passengersAllowedRaw = readBooleanField(block.fields, ['PassengersAllowedToFire']);
    const passengersAllowedToFire = passengersAllowedRaw === true;
    const allowInsideKindOfTokens = readStringList(block.fields, ['AllowInsideKindOf'])
      .map((kindOfName) => kindOfName.trim().toUpperCase())
      .filter((kindOfName) => kindOfName.length > 0);
    const forbidInsideKindOfTokens = readStringList(block.fields, ['ForbidInsideKindOf'])
      .map((kindOfName) => kindOfName.trim().toUpperCase())
      .filter((kindOfName) => kindOfName.length > 0);
    const allowInsideKindOf = allowInsideKindOfTokens.length > 0 ? new Set<string>(allowInsideKindOfTokens) : null;
    const forbidInsideKindOf = new Set<string>(forbidInsideKindOfTokens);
    const allowAlliesInsideRaw = readBooleanField(block.fields, ['AllowAlliesInside']);
    const allowEnemiesInsideRaw = readBooleanField(block.fields, ['AllowEnemiesInside']);
    const allowNeutralInsideRaw = readBooleanField(block.fields, ['AllowNeutralInside']);
    const allowAlliesInside = allowAlliesInsideRaw !== false;
    const allowEnemiesInside = allowEnemiesInsideRaw !== false;
    const allowNeutralInside = allowNeutralInsideRaw !== false;
    const containMax = readNumericField(block.fields, ['ContainMax']) ?? 0;
    // Source parity: TransportContainModuleData::m_slotCapacity — overrides ContainMax for transports.
    const slotsRaw = readNumericField(block.fields, ['Slots']);
    const payloadTemplateNames = readStringList(block.fields, ['PayloadTemplateName']).map((templateName) =>
      templateName.toUpperCase(),
    );
    // Source parity: OpenContainModuleData — parsePercentToReal (INI percentage → 0-1 fraction).
    const damagePercentRaw = readNumericField(block.fields, ['DamagePercentToUnits']);
    const damagePercentToUnits = damagePercentRaw != null ? damagePercentRaw / 100 : 0;
    // Source parity: OpenContainModuleData::m_isBurnedDeathToUnits — default TRUE.
    const burnedDeathRaw = readBooleanField(block.fields, ['BurnedDeathToUnits']);
    const burnedDeathToUnits = burnedDeathRaw !== false;
    // Source parity: TransportContainModuleData::m_healthRegen (HealthRegen%PerSec).
    const healthRegenRaw = readNumericField(block.fields, ['HealthRegen%PerSec']);
    const healthRegenPercentPerSec = healthRegenRaw != null ? healthRegenRaw / 100 : 0;
    // Source parity: TransportContainModuleData::m_initialPayload.
    const initialPayloadRaw = readStringField(block.fields, ['InitialPayload']);
    let initialPayloadTemplateName: string | null = null;
    let initialPayloadCount = 0;
    if (initialPayloadRaw) {
      const payloadTokens = initialPayloadRaw.trim().split(/\s+/);
      if (payloadTokens.length >= 1) {
        initialPayloadTemplateName = payloadTokens[0]!;
        initialPayloadCount = payloadTokens.length >= 2 ? (parseInt(payloadTokens[1]!, 10) || 1) : 1;
      }
    }

    // Source parity: TransportContainModuleData::m_destroyRidersWhoAreNotFreeToExit.
    const destroyRidersRaw = readBooleanField(block.fields, ['DestroyRidersWhoAreNotFreeToExit']);
    const destroyRidersWhoAreNotFreeToExit = destroyRidersRaw === true;

    // ── OpenContain fields ──
    // Source parity: OpenContainModuleData::m_passengersInTurret (default FALSE).
    const passengersInTurretRaw = readBooleanField(block.fields, ['PassengersInTurret']);
    const passengersInTurret = passengersInTurretRaw === true;
    // Source parity: OpenContainModuleData::m_numberOfExitPaths (default 1 in C++ constructor).
    const numberOfExitPaths = readNumericField(block.fields, ['NumberOfExitPaths']) ?? 1;
    // Source parity: OpenContainModuleData::m_weaponBonusPassedToPassengers (default FALSE/NONE).
    const weaponBonusPassedRaw = readBooleanField(block.fields, ['WeaponBonusPassedToPassengers']);
    const weaponBonusPassedToPassengers = weaponBonusPassedRaw === true;
    // Source parity: OpenContainModuleData::m_enterSound — audio event name.
    const enterSound = readStringField(block.fields, ['EnterSound']) ?? '';
    // Source parity: OpenContainModuleData::m_exitSound — audio event name.
    const exitSound = readStringField(block.fields, ['ExitSound']) ?? '';

    // ── TransportContain fields ──
    // Source parity: TransportContainModuleData::m_scatterNearbyOnExit (default true).
    const scatterNearbyRaw = readBooleanField(block.fields, ['ScatterNearbyOnExit']);
    const scatterNearbyOnExit = scatterNearbyRaw !== false;
    // Source parity: TransportContainModuleData::m_orientLikeContainerOnExit (default false).
    const orientLikeContainerRaw = readBooleanField(block.fields, ['OrientLikeContainerOnExit']);
    const orientLikeContainerOnExit = orientLikeContainerRaw === true;
    // Source parity: TransportContainModuleData::m_keepContainerVelocityOnExit (default false).
    const keepContainerVelocityRaw = readBooleanField(block.fields, ['KeepContainerVelocityOnExit']);
    const keepContainerVelocityOnExit = keepContainerVelocityRaw === true;
    // Source parity: TransportContainModuleData::m_goAggressiveOnExit (default FALSE).
    const goAggressiveRaw = readBooleanField(block.fields, ['GoAggressiveOnExit']);
    const goAggressiveOnExit = goAggressiveRaw === true;
    // Source parity: TransportContainModuleData::m_resetMoodCheckTimeOnExit (default true).
    const resetMoodCheckTimeRaw = readBooleanField(block.fields, ['ResetMoodCheckTimeOnExit']);
    const resetMoodCheckTimeOnExit = resetMoodCheckTimeRaw !== false;
    // Source parity: TransportContainModuleData::m_exitBone — bone name string.
    const exitBone = readStringField(block.fields, ['ExitBone']) ?? '';
    // Source parity: TransportContainModuleData::m_exitPitchRate — parseAngularVelocityReal (deg/sec → rad/frame).
    const exitPitchRateDegPerSec = readNumericField(block.fields, ['ExitPitchRate']);
    const exitPitchRate = exitPitchRateDegPerSec != null && exitPitchRateDegPerSec !== 0
      ? exitPitchRateDegPerSec * (Math.PI / 180) / LOGIC_FRAME_RATE
      : 0;
    // Source parity: TransportContainModuleData::m_armedRidersUpgradeWeaponSet (default FALSE).
    const armedRidersRaw = readBooleanField(block.fields, ['ArmedRidersUpgradeMyWeaponSet']);
    const armedRidersUpgradeMyWeaponSet = armedRidersRaw === true;
    // Source parity: TransportContainModuleData::m_isDelayExitInAir (default FALSE).
    const delayExitInAirRaw = readBooleanField(block.fields, ['DelayExitInAir']);
    const delayExitInAir = delayExitInAirRaw === true;

    // Common OpenContain fields shared across all container profiles.
    const openContainFields = {
      passengersInTurret,
      numberOfExitPaths,
      weaponBonusPassedToPassengers,
      enterSound,
      exitSound,
    };
    // Common TransportContain fields (use parsed values for transport-derived modules,
    // C++ defaults for non-transport modules).
    const transportContainFields = {
      scatterNearbyOnExit,
      orientLikeContainerOnExit,
      keepContainerVelocityOnExit,
      goAggressiveOnExit,
      resetMoodCheckTimeOnExit,
      exitBone,
      exitPitchRate,
      armedRidersUpgradeMyWeaponSet,
      delayExitInAir,
    };
    const transportContainDefaults = {
      scatterNearbyOnExit: true,
      orientLikeContainerOnExit: false,
      keepContainerVelocityOnExit: false,
      goAggressiveOnExit: false,
      resetMoodCheckTimeOnExit: true,
      exitBone: '',
      exitPitchRate: 0,
      armedRidersUpgradeMyWeaponSet: false,
      delayExitInAir: false,
    };

    if (moduleType === 'OPENCONTAIN') {
      profile = {
        moduleType: 'OPEN',
        allowInsideKindOf,
        forbidInsideKindOf,
        allowAlliesInside,
        allowEnemiesInside,
        allowNeutralInside,
        passengersAllowedToFire,
        passengersAllowedToFireDefault: passengersAllowedToFire,
        garrisonCapacity: 0,
        transportCapacity: containMax,
        timeForFullHealFrames: 0,
        damagePercentToUnits,
        burnedDeathToUnits,
        healthRegenPercentPerSec: 0,
        initialPayloadTemplateName: null,
        initialPayloadCount: 0,
        destroyRidersWhoAreNotFreeToExit,
        ...openContainFields,
        ...transportContainDefaults,
      };
    } else if (moduleType === 'TRANSPORTCONTAIN') {
      profile = {
        moduleType: 'TRANSPORT',
        allowInsideKindOf,
        forbidInsideKindOf,
        allowAlliesInside,
        allowEnemiesInside,
        allowNeutralInside,
        passengersAllowedToFire,
        passengersAllowedToFireDefault: passengersAllowedToFire,
        garrisonCapacity: 0,
        transportCapacity: slotsRaw != null ? slotsRaw : containMax,
        timeForFullHealFrames: 0,
        damagePercentToUnits,
        burnedDeathToUnits,
        healthRegenPercentPerSec,
        initialPayloadTemplateName,
        initialPayloadCount,
        destroyRidersWhoAreNotFreeToExit,
        ...openContainFields,
        ...transportContainFields,
      };
    } else if (moduleType === 'OVERLORDCONTAIN') {
      profile = {
        moduleType: 'OVERLORD',
        allowInsideKindOf,
        forbidInsideKindOf,
        allowAlliesInside,
        allowEnemiesInside,
        allowNeutralInside,
        passengersAllowedToFire,
        passengersAllowedToFireDefault: passengersAllowedToFire,
        garrisonCapacity: 0,
        transportCapacity: slotsRaw != null ? slotsRaw : containMax,
        timeForFullHealFrames: 0,
        damagePercentToUnits,
        burnedDeathToUnits,
        healthRegenPercentPerSec,
        initialPayloadTemplateName,
        initialPayloadCount,
        destroyRidersWhoAreNotFreeToExit,
        ...openContainFields,
        ...transportContainFields,
      };
    } else if (moduleType === 'HELIXCONTAIN') {
      // HELIXCONTAIN is a Zero Hour-specific container module name used by data INIs;
      // we map it to a dedicated internal container profile to preserve source behavior.
      profile = {
        moduleType: 'HELIX',
        allowInsideKindOf,
        forbidInsideKindOf,
        allowAlliesInside,
        allowEnemiesInside,
        allowNeutralInside,
        passengersAllowedToFire,
        passengersAllowedToFireDefault: passengersAllowedToFire,
        portableStructureTemplateNames: payloadTemplateNames,
        garrisonCapacity: 0,
        transportCapacity: slotsRaw != null ? slotsRaw : containMax,
        timeForFullHealFrames: 0,
        damagePercentToUnits,
        burnedDeathToUnits,
        healthRegenPercentPerSec,
        initialPayloadTemplateName,
        initialPayloadCount,
        destroyRidersWhoAreNotFreeToExit,
        ...openContainFields,
        ...transportContainFields,
      };
    } else if (moduleType === 'PARACHUTECONTAIN') {
      // Source parity: ParachuteContain overrides isSpecialZeroSlotContainer() == true.
      // The parachute shell itself contributes zero transport slots and proxies slot size
      // checks to its contained rider.
      profile = {
        moduleType: 'PARACHUTE',
        allowInsideKindOf,
        forbidInsideKindOf,
        allowAlliesInside,
        allowEnemiesInside,
        allowNeutralInside,
        passengersAllowedToFire,
        passengersAllowedToFireDefault: passengersAllowedToFire,
        garrisonCapacity: 0,
        transportCapacity: containMax,
        timeForFullHealFrames: 0,
        damagePercentToUnits,
        burnedDeathToUnits,
        healthRegenPercentPerSec: 0,
        initialPayloadTemplateName: null,
        initialPayloadCount: 0,
        destroyRidersWhoAreNotFreeToExit,
        ...openContainFields,
        ...transportContainDefaults,
      };
    } else if (moduleType === 'GARRISONCONTAIN') {
      // GarrisonContain is OpenContain-derived in source but always returns TRUE from
      // isPassengerAllowedToFire(), so we track it explicitly for behavior parity.
      // Source parity: GarrisonContainModuleData — garrison-specific fields.
      const healObjects = readBooleanField(block.fields, ['HealObjects']) === true;
      const timeForFullHealMs = readNumericField(block.fields, ['TimeForFullHeal']) ?? 0;
      const garrisonTimeForFullHealFrames = healObjects && timeForFullHealMs > 0
        ? self.msToLogicFrames(timeForFullHealMs) : 0;
      const mobileGarrison = readBooleanField(block.fields, ['MobileGarrison']) === true;
      const immuneToClearBuildingAttacks = readBooleanField(block.fields, ['ImmuneToClearBuildingAttacks']) === true;
      // Source parity: GarrisonContainModuleData constructor — m_isEnclosingContainer defaults to TRUE.
      const isEnclosingContainerRaw = readBooleanField(block.fields, ['IsEnclosingContainer']);
      const isEnclosingContainer = isEnclosingContainerRaw !== false;
      // Source parity: GarrisonContainModuleData::parseInitialRoster — "templateName count" format.
      const initialRosterRaw = readStringField(block.fields, ['InitialRoster']);
      let initialRosterTemplateName: string | null = null;
      let initialRosterCount = 0;
      if (initialRosterRaw) {
        const rosterTokens = initialRosterRaw.trim().split(/\s+/);
        if (rosterTokens.length >= 1 && rosterTokens[0]) {
          initialRosterTemplateName = rosterTokens[0].toUpperCase();
          initialRosterCount = rosterTokens.length >= 2 ? (parseInt(rosterTokens[1]!, 10) || 1) : 1;
        }
      }
      profile = {
        moduleType: 'GARRISON',
        allowInsideKindOf,
        forbidInsideKindOf,
        allowAlliesInside,
        allowEnemiesInside,
        allowNeutralInside,
        passengersAllowedToFire: true,
        passengersAllowedToFireDefault: true,
        garrisonCapacity: containMax > 0 ? containMax : 10,
        transportCapacity: 0,
        timeForFullHealFrames: garrisonTimeForFullHealFrames,
        damagePercentToUnits,
        burnedDeathToUnits,
        healthRegenPercentPerSec: 0,
        initialPayloadTemplateName: null,
        initialPayloadCount: 0,
        destroyRidersWhoAreNotFreeToExit,
        ...openContainFields,
        ...transportContainDefaults,
        healObjects,
        mobileGarrison,
        initialRosterTemplateName,
        initialRosterCount,
        immuneToClearBuildingAttacks,
        isEnclosingContainer,
      };
    } else if (moduleType === 'TUNNELCONTAIN') {
      // Source parity: TunnelContain — per-player shared tunnel network.
      // Capacity is managed by TunnelTracker (global maxTunnelCapacity), not per-building.
      const timeForFullHealMs = readNumericField(block.fields, ['TimeForFullHeal']) ?? 0;
      profile = {
        moduleType: 'TUNNEL',
        allowInsideKindOf,
        forbidInsideKindOf,
        allowAlliesInside,
        allowEnemiesInside,
        allowNeutralInside,
        passengersAllowedToFire: false,
        passengersAllowedToFireDefault: false,
        garrisonCapacity: 0,
        transportCapacity: 0,
        timeForFullHealFrames: timeForFullHealMs > 0 ? self.msToLogicFrames(timeForFullHealMs) : 1,
        damagePercentToUnits,
        burnedDeathToUnits,
        healthRegenPercentPerSec: 0,
        initialPayloadTemplateName: null,
        initialPayloadCount: 0,
        destroyRidersWhoAreNotFreeToExit,
        ...openContainFields,
        ...transportContainDefaults,
      };
    } else if (moduleType === 'CAVECONTAIN') {
      // Source parity: CaveContain — shared tunnel tracker keyed by CaveIndex.
      const caveIndexRaw = readNumericField(block.fields, ['CaveIndex']);
      const caveIndex = caveIndexRaw !== null && Number.isFinite(caveIndexRaw)
        ? Math.max(0, Math.trunc(caveIndexRaw))
        : 0;
      profile = {
        moduleType: 'CAVE',
        allowInsideKindOf,
        forbidInsideKindOf,
        allowAlliesInside,
        allowEnemiesInside,
        allowNeutralInside,
        passengersAllowedToFire: false,
        passengersAllowedToFireDefault: false,
        garrisonCapacity: 0,
        transportCapacity: 0,
        timeForFullHealFrames: 0,
        damagePercentToUnits,
        burnedDeathToUnits,
        caveIndex,
        healthRegenPercentPerSec: 0,
        initialPayloadTemplateName: null,
        initialPayloadCount: 0,
        destroyRidersWhoAreNotFreeToExit,
        ...openContainFields,
        ...transportContainDefaults,
      };
    } else if (moduleType === 'HEALCONTAIN') {
      // Source parity: HealContain — passengers healed inside, auto-ejected when full health.
      // C++ file: HealContain.cpp — extends OpenContain, single param TimeForFullHeal.
      const timeForFullHealMs = readNumericField(block.fields, ['TimeForFullHeal']) ?? 0;
      profile = {
        moduleType: 'HEAL',
        allowInsideKindOf,
        forbidInsideKindOf,
        allowAlliesInside,
        allowEnemiesInside,
        allowNeutralInside,
        passengersAllowedToFire: false,
        passengersAllowedToFireDefault: false,
        garrisonCapacity: 0,
        transportCapacity: containMax,
        timeForFullHealFrames: timeForFullHealMs > 0 ? self.msToLogicFrames(timeForFullHealMs) : 1,
        damagePercentToUnits,
        burnedDeathToUnits,
        healthRegenPercentPerSec: 0,
        initialPayloadTemplateName: null,
        initialPayloadCount: 0,
        destroyRidersWhoAreNotFreeToExit,
        ...openContainFields,
        ...transportContainDefaults,
      };
    } else if (moduleType === 'INTERNETHACKCONTAIN') {
      // Source parity: InternetHackContain — extends TransportContain, auto-issues
      // hackInternet command to entering units. C++ file: InternetHackContain.cpp.
      profile = {
        moduleType: 'INTERNET_HACK',
        allowInsideKindOf,
        forbidInsideKindOf,
        allowAlliesInside,
        allowEnemiesInside,
        allowNeutralInside,
        passengersAllowedToFire: false,
        passengersAllowedToFireDefault: false,
        garrisonCapacity: 0,
        transportCapacity: slotsRaw != null ? slotsRaw : containMax,
        timeForFullHealFrames: 0,
        damagePercentToUnits,
        burnedDeathToUnits,
        healthRegenPercentPerSec,
        initialPayloadTemplateName,
        initialPayloadCount,
        destroyRidersWhoAreNotFreeToExit,
        ...openContainFields,
        ...transportContainFields,
      };
    }

    for (const child of block.blocks) {
      visitBlock(child);
    }
  };

  for (const block of objectDef.blocks) {
    visitBlock(block);
  }

  return profile;
}

export function extractAnimationSteeringProfile(self: GL, objectDef: ObjectDef | undefined): AnimationSteeringProfile | null {
  if (!objectDef) {
    return null;
  }

  let transitionFrames: number | null = null;
  const visitBlock = (block: IniBlock): void => {
    if (transitionFrames !== null) {
      return;
    }
    if (block.type.toUpperCase() === 'BEHAVIOR') {
      const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
      if (moduleType === 'ANIMATIONSTEERINGUPDATE') {
        const transitionMs = readNumericField(block.fields, ['MinTransitionTime']) ?? 0;
        transitionFrames = self.msToLogicFrames(transitionMs);
      }
    }

    for (const child of block.blocks) {
      visitBlock(child);
    }
  };

  for (const block of objectDef.blocks) {
    visitBlock(block);
  }

  if (transitionFrames === null) {
    return null;
  }

  return {
    transitionFrames,
  };
}

export function extractTensileFormationProfile(self: GL, objectDef: ObjectDef | undefined): TensileFormationProfile | null {
  if (!objectDef) {
    return null;
  }

  let profile: TensileFormationProfile | null = null;
  const visitBlock = (block: IniBlock): void => {
    if (profile) {
      return;
    }

    if (block.type.toUpperCase() === 'BEHAVIOR') {
      const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
      if (moduleType === 'TENSILEFORMATIONUPDATE') {
        profile = {
          enabled: readBooleanField(block.fields, ['Enabled']) === true,
          crackSound: readStringField(block.fields, ['CrackSound'])?.trim() ?? '',
        };
        return;
      }
    }

    for (const child of block.blocks) {
      visitBlock(child);
    }
  };

  for (const block of objectDef.blocks) {
    visitBlock(block);
  }

  return profile;
}

export function extractAssaultTransportProfile(self: GL, objectDef: ObjectDef | undefined): AssaultTransportProfile | null {
  if (!objectDef) return null;
  let profile: AssaultTransportProfile | null = null;
  const visitBlock = (block: IniBlock): void => {
    if (profile) return;
    if (block.type.toUpperCase() === 'BEHAVIOR') {
      const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
      if (moduleType === 'ASSAULTTRANSPORTAIUPDATE') {
        const ratio = readNumericField(block.fields, ['MembersGetHealedAtLifeRatio']) ?? 0;
        profile = { membersGetHealedAtLifeRatio: Math.max(0, Math.min(1, ratio)) };
      }
    }
    for (const child of block.blocks) visitBlock(child);
  };
  for (const block of objectDef.blocks) visitBlock(block);
  return profile;
}

/**
 * Source parity: AIUpdateModuleData fields — TurretsLinked, ForbidPlayerCommands,
 * AutoAcquireEnemiesWhenIdle, MoodAttackCheckRate.
 *
 * These fields live on the base AIUpdateModuleData class, so they can appear on
 * any AIUpdate-derived behavior module (AIUpdateInterface, JetAIUpdate,
 * DozerAIUpdate, etc.). We match any Behavior block whose module type name
 * contains "AIUPDATE".
 */
interface AIUpdateModuleDataFields {
  turretsLinked: boolean;
  forbidPlayerCommands: boolean;
  autoAcquireEnemiesWhenIdle: number;
  /** Interval in logic frames; 0 = use global AUTO_TARGET_SCAN_RATE_FRAMES default. */
  moodAttackCheckRate: number;
}

const AI_UPDATE_MODULE_DATA_DEFAULTS: AIUpdateModuleDataFields = {
  turretsLinked: false,
  forbidPlayerCommands: false,
  autoAcquireEnemiesWhenIdle: 0,
  moodAttackCheckRate: 0,
};

export function extractAIUpdateModuleData(self: GL, objectDef: ObjectDef | undefined): AIUpdateModuleDataFields {
  if (!objectDef) return { ...AI_UPDATE_MODULE_DATA_DEFAULTS };

  let result: AIUpdateModuleDataFields | null = null;

  const visitBlock = (block: IniBlock): void => {
    if (result) return; // take first match
    if (block.type.toUpperCase() === 'BEHAVIOR') {
      const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
      // Match any AIUpdate-derived module (AIUpdateInterface, JetAIUpdate, etc.)
      if (moduleType.includes('AIUPDATE') || moduleType === 'AISTATESEQUENCE') {
        const turretsLinked = readBooleanField(block.fields, ['TurretsLinked']) === true;
        const forbidPlayerCommands = readBooleanField(block.fields, ['ForbidPlayerCommands']) === true;
        const autoAcquireRaw = block.fields['AutoAcquireEnemiesWhenIdle'];
        const autoAcquireEnemiesWhenIdle = parseAutoAcquireEnemiesBitfield(autoAcquireRaw);
        // Source parity: MoodAttackCheckRate is INI::parseDurationUnsignedInt (ms → frames).
        const moodAttackCheckRateMs = readNumericField(block.fields, ['MoodAttackCheckRate']) ?? 0;
        const moodAttackCheckRate = moodAttackCheckRateMs > 0
          ? Math.ceil(moodAttackCheckRateMs / 1000 * LOGIC_FRAME_RATE)
          : 0;
        result = { turretsLinked, forbidPlayerCommands, autoAcquireEnemiesWhenIdle, moodAttackCheckRate };
      }
    }
    for (const child of block.blocks) visitBlock(child);
  };

  for (const block of objectDef.blocks) visitBlock(block);

  return result ?? { ...AI_UPDATE_MODULE_DATA_DEFAULTS };
}

export function extractTurretProfiles(self: GL, objectDef: ObjectDef | undefined): TurretProfile[] {
  if (!objectDef) {
    return [];
  }

  const profiles: TurretProfile[] = [];
  const WEAPON_SLOT_NAMES: Record<string, number> = {
    PRIMARY: 0,
    SECONDARY: 1,
    TERTIARY: 2,
  };

  const visitBlock = (block: IniBlock): void => {
    if (block.type.toUpperCase() === 'BEHAVIOR') {
      const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
      if (moduleType === 'TURRETAIUPDATE') {
        const initiallyDisabled = readBooleanField(block.fields, ['InitiallyDisabled']) === true;

        // Source parity: TurretAIData::m_turretWeaponSlots is a bitmask built from
        // ControlledWeaponSlots INI field (space-separated slot names).
        let controlledWeaponSlotsMask = 0;
        const controlledSlotsRaw = readStringField(block.fields, ['ControlledWeaponSlots']);
        if (controlledSlotsRaw) {
          for (const slotToken of controlledSlotsRaw.split(/\s+/)) {
            const slotIndex = WEAPON_SLOT_NAMES[slotToken.toUpperCase()];
            if (slotIndex !== undefined) {
              controlledWeaponSlotsMask |= (1 << slotIndex);
            }
          }
        }

        // Source parity: TurretTurnRate is parsed as AngularVelocity (degrees/sec in INI).
        // C++ parseAngularVelocityReal converts to rad/frame: value * (PI/180) / LOGICFRAMES_PER_SECOND.
        // C++ TurretAI.h:37 — DEFAULT_TURN_RATE = 0.01 rad/frame when no INI value is specified.
        const turnRateDegPerSec = readNumericField(block.fields, ['TurretTurnRate']);
        const turnRate = turnRateDegPerSec != null && turnRateDegPerSec > 0
          ? turnRateDegPerSec * (Math.PI / 180) / LOGIC_FRAME_RATE
          : 0.01;

        // Source parity: NaturalTurretAngle is an angle (degrees in INI → radians).
        const naturalAngleDeg = readNumericField(block.fields, ['NaturalTurretAngle']) ?? 0;
        const naturalAngle = naturalAngleDeg * (Math.PI / 180);

        const firesWhileTurning = readBooleanField(block.fields, ['FiresWhileTurning']) === true;

        // Source parity: RecenterTime defaults to 2 * LOGICFRAMES_PER_SECOND (60 frames).
        // INI value is in milliseconds.
        const recenterTimeMs = readNumericField(block.fields, ['RecenterTime']) ?? 0;
        // Source parity: TurretAI.cpp uses parseDurationUnsignedInt which applies ceilf(),
        // not round(). See INI.cpp:1720.
        const recenterTimeFrames = recenterTimeMs > 0
          ? Math.ceil(recenterTimeMs / 1000 * LOGIC_FRAME_RATE)
          : 2 * LOGIC_FRAME_RATE;

        if (controlledWeaponSlotsMask !== 0) {
          profiles.push({
            controlledWeaponSlotsMask,
            initiallyDisabled,
            enabled: !initiallyDisabled,
            turnRate,
            naturalAngle,
            firesWhileTurning,
            recenterTimeFrames,
          });
        }
      }
    }

    for (const child of block.blocks) {
      visitBlock(child);
    }
  };

  for (const block of objectDef.blocks) {
    visitBlock(block);
  }

  return profiles;
}

export function extractSupplyWarehouseProfile(self: GL, objectDef: ObjectDef | undefined): SupplyWarehouseProfile | null {
  if (!objectDef) {
    return null;
  }

  let profile: SupplyWarehouseProfile | null = null;
  const visitBlock = (block: IniBlock): void => {
    if (profile !== null) {
      return;
    }
    if (block.type.toUpperCase() === 'BEHAVIOR') {
      const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
      if (moduleType === 'SUPPLYWAREHOUSEDOCKUPDATE') {
        const numApproach = readNumericField(block.fields, ['NumberApproachPositions']);
        profile = {
          startingBoxes: Math.max(0, Math.trunc(readNumericField(block.fields, ['StartingBoxes']) ?? 1)),
          deleteWhenEmpty: readBooleanField(block.fields, ['DeleteWhenEmpty']) === true,
          numberApproachPositions: numApproach !== null ? Math.trunc(numApproach) : -1,
          allowsPassthrough: readBooleanField(block.fields, ['AllowsPassthrough']) === true,
        };
        return;
      }
    }
    for (const child of block.blocks) {
      visitBlock(child);
    }
  };

  for (const block of objectDef.blocks) {
    visitBlock(block);
  }

  return profile;
}

export function extractSupplyTruckProfile(self: GL, objectDef: ObjectDef | undefined): SupplyTruckProfile | null {
  if (!objectDef) {
    return null;
  }

  let profile: SupplyTruckProfile | null = null;
  const visitBlock = (block: IniBlock): void => {
    if (profile !== null) {
      return;
    }
    if (block.type.toUpperCase() === 'BEHAVIOR') {
      const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
      if (moduleType === 'SUPPLYTRUCKAIUPDATE' || moduleType === 'WORKERAIUPDATE' || moduleType === 'CHINOOKAIUPDATE') {
        const maxBoxes = Math.max(1, Math.trunc(readNumericField(block.fields, ['MaxBoxes']) ?? 3));
        const supplyCenterActionDelayMs = readNumericField(block.fields, ['SupplyCenterActionDelay']) ?? 0;
        const supplyWarehouseActionDelayMs = readNumericField(block.fields, ['SupplyWarehouseActionDelay']) ?? 0;
        const scanDistance = readNumericField(block.fields, ['SupplyWarehouseScanDistance']) ?? 200;
        const upgradedSupplyBoost = Math.trunc(readNumericField(block.fields, ['UpgradedSupplyBoost']) ?? 0);
        profile = {
          maxBoxes,
          supplyCenterActionDelayFrames: self.msToLogicFrames(supplyCenterActionDelayMs),
          supplyWarehouseActionDelayFrames: self.msToLogicFrames(supplyWarehouseActionDelayMs),
          supplyWarehouseScanDistance: Math.max(0, scanDistance),
          upgradedSupplyBoost,
        };
        return;
      }
    }
    for (const child of block.blocks) {
      visitBlock(child);
    }
  };

  for (const block of objectDef.blocks) {
    visitBlock(block);
  }

  return profile;
}

export function extractRepairDockProfile(self: GL, objectDef: ObjectDef | undefined): RepairDockProfile | null {
  if (!objectDef) {
    return null;
  }

  let profile: RepairDockProfile | null = null;
  const visitBlock = (block: IniBlock): void => {
    if (profile !== null) {
      return;
    }
    if (block.type.toUpperCase() === 'BEHAVIOR') {
      const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
      if (moduleType === 'REPAIRDOCKUPDATE') {
        const timeForFullHealMs = readNumericField(block.fields, ['TimeForFullHeal']) ?? 0;
        // Source parity: INI::parseDurationReal stores fractional frame values.
        const framesForFullHeal = timeForFullHealMs > 0
          ? self.msToLogicFramesReal(timeForFullHealMs)
          : 1;
        const numApproach = readNumericField(block.fields, ['NumberApproachPositions']);
        profile = {
          timeForFullHealFrames: Math.max(1, framesForFullHeal),
          numberApproachPositions: numApproach !== null ? Math.trunc(numApproach) : -1,
          allowsPassthrough: readBooleanField(block.fields, ['AllowsPassthrough']) === true,
        };
        return;
      }
    }
    for (const child of block.blocks) {
      visitBlock(child);
    }
  };

  for (const block of objectDef.blocks) {
    visitBlock(block);
  }

  return profile;
}

export function extractFireWeaponCollideProfiles(self: GL, objectDef: ObjectDef | undefined): FireWeaponCollideProfile[] {
  if (!objectDef) return [];
  const profiles: FireWeaponCollideProfile[] = [];
  const visitBlock = (block: IniBlock): void => {
    const blockType = block.type.toUpperCase();
    if (blockType === 'BEHAVIOR') {
      const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
      if (moduleType === 'FIREWEAPONCOLLIDE') {
        const collideWeapon = readStringField(block.fields, ['CollideWeapon']);
        if (!collideWeapon) return;
        const fireOnce = readBooleanField(block.fields, ['FireOnce']) === true;
        const rsStr = readStringField(block.fields, ['RequiredStatus'])?.trim().toUpperCase() ?? '';
        const requiredStatus = new Set(rsStr.split(/\s+/).filter(Boolean));
        const fsStr = readStringField(block.fields, ['ForbiddenStatus'])?.trim().toUpperCase() ?? '';
        const forbiddenStatus = new Set(fsStr.split(/\s+/).filter(Boolean));
        profiles.push({
          collideWeapon,
          fireOnce,
          requiredStatus,
          forbiddenStatus,
        });
      }
    }
    if (block.blocks) {
      for (const child of block.blocks) visitBlock(child);
    }
  };
  if (objectDef.blocks) {
    for (const block of objectDef.blocks) visitBlock(block);
  }
  return profiles;
}

export function extractCommandButtonHuntProfile(self: GL, objectDef: ObjectDef | undefined): CommandButtonHuntProfile | null {
  if (!objectDef) {
    return null;
  }

  let profile: CommandButtonHuntProfile | null = null;
  const visitBlock = (block: IniBlock): void => {
    if (profile !== null) {
      return;
    }
    if (block.type.toUpperCase() === 'BEHAVIOR') {
      const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
      if (moduleType === 'COMMANDBUTTONHUNTUPDATE') {
        const scanRateMs = readNumericField(block.fields, ['ScanRate']) ?? 1000;
        profile = {
          scanFrames: Math.max(1, self.msToLogicFrames(scanRateMs)),
          scanRange: readNumericField(block.fields, ['ScanRange']) ?? 9999,
        };
        return;
      }
    }

    for (const child of block.blocks) {
      visitBlock(child);
    }
  };

  for (const block of objectDef.blocks) {
    visitBlock(block);
  }

  return profile;
}

export function extractDozerAIProfile(self: GL, objectDef: ObjectDef | undefined): DozerAIProfile | null {
  if (!objectDef) {
    return null;
  }

  let profile: DozerAIProfile | null = null;
  const visitBlock = (block: IniBlock): void => {
    if (profile !== null) {
      return;
    }
    if (block.type.toUpperCase() === 'BEHAVIOR') {
      const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
      if (moduleType === 'DOZERAIUPDATE' || moduleType === 'WORKERAIUPDATE') {
        const repairHealthPercentPerSecond = self.parseNumericIniValue(
          self.readIniFieldValue(block.fields, 'RepairHealthPercentPerSecond'),
        ) ?? 0;
        const boredTimeMs = readNumericField(block.fields, ['BoredTime']) ?? 0;
        const boredRange = readNumericField(block.fields, ['BoredRange']) ?? 0;
        profile = {
          repairHealthPercentPerSecond: Math.max(0, repairHealthPercentPerSecond),
          boredTimeFrames: boredTimeMs > 0 ? self.msToLogicFramesReal(boredTimeMs) : 0,
          boredRange: Math.max(0, boredRange),
        };
        return;
      }
    }

    for (const child of block.blocks) {
      visitBlock(child);
    }
  };

  for (const block of objectDef.blocks) {
    visitBlock(block);
  }

  return profile;
}

/**
 * Source parity: WorkerAIUpdateModuleData unique fields (WorkerAIUpdate.h lines 96-108).
 * WorkerAIUpdate inherits from SupplyTruckAIUpdate; shared supply fields are extracted
 * by extractSupplyTruckProfile(). This extracts the Worker-specific fields only.
 */
export interface WorkerAIProfile {
  /** Source parity: WorkerAIUpdateModuleData::m_repairHealthPercentPerSecond (parsePercentToReal → 0..1). */
  repairHealthPercentPerSecond: number;
  /** Source parity: WorkerAIUpdateModuleData::m_boredTime (parseDurationReal → frames). */
  boredTimeFrames: number;
  /** Source parity: WorkerAIUpdateModuleData::m_boredRange. */
  boredRange: number;
  /** Source parity: WorkerAIUpdateModuleData::m_suppliesDepletedVoice (parseAudioEventRTS). */
  suppliesDepletedVoice: string;
}

export function extractWorkerAIProfile(self: GL, objectDef: ObjectDef | undefined): WorkerAIProfile | null {
  if (!objectDef) {
    return null;
  }

  let profile: WorkerAIProfile | null = null;
  const visitBlock = (block: IniBlock): void => {
    if (profile !== null) {
      return;
    }
    if (block.type.toUpperCase() === 'BEHAVIOR') {
      const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
      if (moduleType === 'WORKERAIUPDATE') {
        // Source parity: INI::parsePercentToReal divides by 100.
        const rawPercent = readNumericField(block.fields, ['RepairHealthPercentPerSecond']) ?? 0;
        const repairHealthPercentPerSecond = Math.max(0, rawPercent / 100);
        const boredTimeMs = readNumericField(block.fields, ['BoredTime']) ?? 0;
        const boredRange = readNumericField(block.fields, ['BoredRange']) ?? 0;
        const suppliesDepletedVoice = readStringField(block.fields, ['SuppliesDepletedVoice']) ?? '';
        profile = {
          repairHealthPercentPerSecond,
          boredTimeFrames: boredTimeMs > 0 ? self.msToLogicFramesReal(boredTimeMs) : 0,
          boredRange: Math.max(0, boredRange),
          suppliesDepletedVoice,
        };
        return;
      }
    }

    for (const child of block.blocks) {
      visitBlock(child);
    }
  };

  for (const block of objectDef.blocks) {
    visitBlock(block);
  }

  return profile;
}

/**
 * Source parity: POWTruckAIUpdateModuleData fields (POWTruckAIUpdate.cpp lines 68-73).
 */
export interface POWTruckAIProfile {
  /** Source parity: POWTruckAIUpdateModuleData::m_boredTimeInFrames (parseDurationUnsignedInt → frames). */
  boredTimeFrames: number;
  /** Source parity: POWTruckAIUpdateModuleData::m_hangAroundPrisonDistance (parseReal). */
  atPrisonDistance: number;
}

export function extractPOWTruckAIProfile(self: GL, objectDef: ObjectDef | undefined): POWTruckAIProfile | null {
  if (!objectDef) {
    return null;
  }

  let profile: POWTruckAIProfile | null = null;
  const visitBlock = (block: IniBlock): void => {
    if (profile !== null) {
      return;
    }
    if (block.type.toUpperCase() === 'BEHAVIOR') {
      const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
      if (moduleType === 'POWTRUCKAIUPDATE') {
        // Source parity: INI::parseDurationUnsignedInt converts ms → frames (truncated).
        const boredTimeMs = readNumericField(block.fields, ['BoredTime']) ?? 0;
        const atPrisonDistance = readNumericField(block.fields, ['AtPrisonDistance']) ?? 0;
        profile = {
          boredTimeFrames: boredTimeMs > 0 ? self.msToLogicFrames(boredTimeMs) : 0,
          atPrisonDistance: Math.max(0, atPrisonDistance),
        };
        return;
      }
    }

    for (const child of block.blocks) {
      visitBlock(child);
    }
  };

  for (const block of objectDef.blocks) {
    visitBlock(block);
  }

  return profile;
}

/**
 * Source parity: PrisonBehavior.cpp / PropagandaCenterBehavior.cpp
 */
export interface PrisonBehaviorProfile {
  showPrisoners: boolean;
  yardBonePrefix: string;
  brainwashDurationFrames: number;
}

export function extractPrisonBehaviorProfile(self: GL, objectDef: ObjectDef | undefined): PrisonBehaviorProfile | null {
  if (!objectDef) {
    return null;
  }

  let profile: PrisonBehaviorProfile | null = null;
  const visitBlock = (block: IniBlock): void => {
    if (profile !== null) {
      return;
    }
    if (block.type.toUpperCase() === 'BEHAVIOR') {
      const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
      if (moduleType === 'PRISONBEHAVIOR' || moduleType === 'PROPAGANDACENTERBEHAVIOR') {
        const showPrisoners = readBooleanField(block.fields, ['ShowPrisoners']) === true;
        const yardBonePrefix = readStringField(block.fields, ['YardBonePrefix']) ?? '';
        let brainwashDurationFrames = 0;
        if (moduleType === 'PROPAGANDACENTERBEHAVIOR') {
          const brainwashMs = readNumericField(block.fields, ['BrainwashDuration']) ?? 0;
          brainwashDurationFrames = brainwashMs > 0 ? self.msToLogicFrames(brainwashMs) : 0;
        }
        profile = {
          showPrisoners,
          yardBonePrefix,
          brainwashDurationFrames,
        };
        return;
      }
    }
    for (const child of block.blocks) {
      visitBlock(child);
    }
  };

  for (const block of objectDef.blocks) {
    visitBlock(block);
  }

  return profile;
}

export function extractExperienceProfile(self: GL, objectDef: ObjectDef | undefined): ExperienceProfile | null {
  if (!objectDef) {
    return null;
  }

  const expRequiredRaw = readNumericListField(objectDef.fields, ['ExperienceRequired']);
  const expValueRaw = readNumericListField(objectDef.fields, ['ExperienceValue']);
  // Source parity: ThingTemplate.cpp:133 — SkillPointValue parsed as space-separated int list.
  const skillPointRaw = readNumericListField(objectDef.fields, ['SkillPointValue']);
  // Source parity: ThingTemplate.cpp:136 — IsTrainable parsed as bool, default FALSE.
  const isTrainable = readBooleanField(objectDef.fields, ['IsTrainable']) ?? false;

  if (!expRequiredRaw && !expValueRaw && !isTrainable) {
    return null;
  }

  const expRequired: [number, number, number, number] = [0, 0, 0, 0];
  const expValue: [number, number, number, number] = [0, 0, 0, 0];
  // Source parity: ThingTemplate.cpp:1016 — m_skillPointValues initialized to USE_EXP_VALUE_FOR_SKILL_VALUE (-999).
  const USE_EXP_VALUE_FOR_SKILL_VALUE = -999;
  const skillPointValues: [number, number, number, number] = [
    USE_EXP_VALUE_FOR_SKILL_VALUE, USE_EXP_VALUE_FOR_SKILL_VALUE,
    USE_EXP_VALUE_FOR_SKILL_VALUE, USE_EXP_VALUE_FOR_SKILL_VALUE,
  ];

  if (expRequiredRaw) {
    for (let i = 0; i < 4 && i < expRequiredRaw.length; i++) {
      expRequired[i] = Math.max(0, Math.trunc(expRequiredRaw[i] ?? 0));
    }
  }

  if (expValueRaw) {
    for (let i = 0; i < 4 && i < expValueRaw.length; i++) {
      expValue[i] = Math.max(0, Math.trunc(expValueRaw[i] ?? 0));
    }
  }

  if (skillPointRaw) {
    for (let i = 0; i < 4 && i < skillPointRaw.length; i++) {
      skillPointValues[i] = Math.trunc(skillPointRaw[i] ?? USE_EXP_VALUE_FOR_SKILL_VALUE);
    }
  }

  return {
    experienceRequired: expRequired,
    experienceValue: expValue,
    skillPointValues,
    isTrainable,
  };
}

export function extractAutoHealProfile(self: GL, objectDef: ObjectDef | undefined): AutoHealProfile | null {
  if (!objectDef) return null;
  let profile: AutoHealProfile | null = null;
  const visitBlock = (block: IniBlock): void => {
    if (profile !== null) return;
    if (block.type.toUpperCase() === 'BEHAVIOR') {
      const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
      if (moduleType === 'AUTOHEALBEHAVIOR') {
        // Source parity: AutoHealBehavior.h — KindOf defaults to ALL (null = no filter).
        const kindOfStr = readStringField(block.fields, ['KindOf']) ?? '';
        const kindOfSet = new Set<string>();
        for (const token of kindOfStr.split(/\s+/)) {
          if (token) kindOfSet.add(token.toUpperCase());
        }
        // Source parity: AutoHealBehavior.h — ForbiddenKindOf defaults to NONE (null = no filter).
        const forbiddenKindOfStr = readStringField(block.fields, ['ForbiddenKindOf']) ?? '';
        const forbiddenKindOfSet = new Set<string>();
        for (const token of forbiddenKindOfStr.split(/\s+/)) {
          if (token) forbiddenKindOfSet.add(token.toUpperCase());
        }
        profile = {
          healingAmount: readNumericField(block.fields, ['HealingAmount']) ?? 0,
          healingDelayFrames: readNumericField(block.fields, ['HealingDelay']) ?? 900,
          startHealingDelayFrames: readNumericField(block.fields, ['StartHealingDelay']) ?? 0,
          radius: readNumericField(block.fields, ['Radius']) ?? 0,
          affectsWholePlayer: readBooleanField(block.fields, ['AffectsWholePlayer']) ?? false,
          initiallyActive: readBooleanField(block.fields, ['StartsActive']) ?? false,
          singleBurst: readBooleanField(block.fields, ['SingleBurst']) ?? false,
          kindOf: kindOfSet.size > 0 ? kindOfSet : null,
          forbiddenKindOf: forbiddenKindOfSet.size > 0 ? forbiddenKindOfSet : null,
          // Source parity: AutoHealBehaviorModuleData — particle system and self-skip fields.
          radiusParticleSystemName: readStringField(block.fields, ['RadiusParticleSystemName']) ?? '',
          unitHealPulseParticleSystemName: readStringField(block.fields, ['UnitHealPulseParticleSystemName']) ?? '',
          skipSelfForHealing: readBooleanField(block.fields, ['SkipSelfForHealing']) === true,
        };
      }
    }
    if (block.blocks) {
      for (const child of block.blocks) visitBlock(child);
    }
  };
  if (objectDef.blocks) {
    for (const block of objectDef.blocks) visitBlock(block);
  }
  return profile;
}

export function extractPropagandaTowerProfile(self: GL, objectDef: ObjectDef | undefined): PropagandaTowerProfile | null {
  if (!objectDef) return null;
  let profile: PropagandaTowerProfile | null = null;
  const visitBlock = (block: IniBlock): void => {
    if (profile !== null) return;
    if (block.type.toUpperCase() === 'BEHAVIOR') {
      const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
      if (moduleType === 'PROPAGANDATOWERBEHAVIOR') {
        profile = {
          radius: readNumericField(block.fields, ['Radius']) ?? 100,
          scanDelayFrames: readNumericField(block.fields, ['DelayBetweenUpdates']) ?? 100,
          healPercentPerSecond: readNumericField(block.fields, ['HealPercentEachSecond']) ?? 0.01,
          upgradedHealPercentPerSecond: readNumericField(block.fields, ['UpgradedHealPercentEachSecond']) ?? 0.02,
          upgradeRequired: readStringField(block.fields, ['UpgradeRequired']) ?? null,
        };
      }
    }
    if (block.blocks) {
      for (const child of block.blocks) visitBlock(child);
    }
  };
  if (objectDef.blocks) {
    for (const block of objectDef.blocks) visitBlock(block);
  }
  return profile;
}

export function extractFlammableProfile(self: GL, objectDef: ObjectDef | undefined): FlammableProfile | null {
  if (!objectDef) return null;
  let profile: FlammableProfile | null = null;
  const visitBlock = (block: IniBlock): void => {
    if (profile !== null) return;
    if (block.type.toUpperCase() === 'BEHAVIOR') {
      const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
      if (moduleType === 'FLAMMABLEUPDATE') {
        profile = {
          flameDamageLimit: readNumericField(block.fields, ['FlameDamageLimit']) ?? DEFAULT_FLAME_DAMAGE_LIMIT,
          flameDamageExpirationDelayFrames: self.msToLogicFrames(readNumericField(block.fields, ['FlameDamageExpiration']) ?? 2000),
          aflameDurationFrames: self.msToLogicFrames(readNumericField(block.fields, ['AflameDuration']) ?? 3000),
          aflameDamageDelayFrames: self.msToLogicFrames(readNumericField(block.fields, ['AflameDamageDelay']) ?? 500),
          aflameDamageAmount: readNumericField(block.fields, ['AflameDamageAmount']) ?? DEFAULT_AFLAME_DAMAGE_AMOUNT,
          burnedDelayFrames: self.msToLogicFrames(readNumericField(block.fields, ['BurnedDelay']) ?? 0),
        };
      }
    }
    if (block.blocks) {
      for (const child of block.blocks) visitBlock(child);
    }
  };
  if (objectDef.blocks) {
    for (const block of objectDef.blocks) visitBlock(block);
  }
  return profile;
}

/**
 * Source parity: WaveGuideUpdate module — flood wave mechanics.
 * C++ file: WaveGuideUpdate.cpp lines 86–105 (FieldParse table).
 */
export function extractWaveGuideProfile(self: GL, objectDef: ObjectDef | undefined): WaveGuideProfile | null {
  if (!objectDef) return null;
  let profile: WaveGuideProfile | null = null;
  const visitBlock = (block: IniBlock): void => {
    if (profile !== null) return;
    if (block.type.toUpperCase() === 'BEHAVIOR') {
      const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
      if (moduleType === 'WAVEGUIDEUPDATE') {
        profile = {
          waveDelayFrames: self.msToLogicFrames(readNumericField(block.fields, ['WaveDelay']) ?? 0),
          ySize: readNumericField(block.fields, ['YSize']) ?? 0,
          linearWaveSpacing: readNumericField(block.fields, ['LinearWaveSpacing']) ?? 0,
          waveBendMagnitude: readNumericField(block.fields, ['WaveBendMagnitude']) ?? 0,
          waterVelocity: (readNumericField(block.fields, ['WaterVelocity']) ?? 0) / LOGIC_FRAME_RATE,
          preferredHeight: readNumericField(block.fields, ['PreferredHeight']) ?? 0,
          shorelineEffectDistance: readNumericField(block.fields, ['ShorelineEffectDistance']) ?? 0,
          damageRadius: readNumericField(block.fields, ['DamageRadius']) ?? 0,
          damageAmount: readNumericField(block.fields, ['DamageAmount']) ?? 0,
          toppleForce: readNumericField(block.fields, ['ToppleForce']) ?? 0,
          randomSplashSound: readStringField(block.fields, ['RandomSplashSound']) ?? '',
          randomSplashSoundFrequency: readNumericField(block.fields, ['RandomSplashSoundFrequency']) ?? 0,
          bridgeParticle: readStringField(block.fields, ['BridgeParticle']) ?? '',
          bridgeParticleAngleFudge: (readNumericField(block.fields, ['BridgeParticleAngleFudge']) ?? 0) * Math.PI / 180,
          loopingSound: readStringField(block.fields, ['LoopingSound']) ?? '',
        };
      }
    }
    if (block.blocks) {
      for (const child of block.blocks) visitBlock(child);
    }
  };
  if (objectDef.blocks) {
    for (const block of objectDef.blocks) visitBlock(block);
  }
  return profile;
}

export function extractOCLUpdateProfiles(self: GL, objectDef: ObjectDef | undefined): OCLUpdateProfile[] {
  if (!objectDef) return [];
  const profiles: OCLUpdateProfile[] = [];
  const visitBlock = (block: IniBlock): void => {
    const blockType = block.type.toUpperCase();
    if (blockType === 'BEHAVIOR') {
      const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
      if (moduleType === 'OCLUPDATE') {
        const oclName = readStringField(block.fields, ['OCL']);
        if (!oclName) return;
        const minDelayMs = readNumericField(block.fields, ['MinDelay']) ?? 0;
        const maxDelayMs = readNumericField(block.fields, ['MaxDelay']) ?? minDelayMs;
        profiles.push({
          oclName,
          minDelayFrames: self.msToLogicFrames(minDelayMs),
          maxDelayFrames: self.msToLogicFrames(maxDelayMs),
          createAtEdge: readBooleanField(block.fields, ['CreateAtEdge']) ?? false,
        });
      }
    }
    if (block.blocks) {
      for (const child of block.blocks) visitBlock(child);
    }
  };
  if (objectDef.blocks) {
    for (const block of objectDef.blocks) visitBlock(block);
  }
  return profiles;
}

export function extractWeaponBonusUpdateProfiles(self: GL, objectDef: ObjectDef | undefined): WeaponBonusUpdateProfile[] {
  if (!objectDef) return [];
  const profiles: WeaponBonusUpdateProfile[] = [];
  const visitBlock = (block: IniBlock): void => {
    const blockType = block.type.toUpperCase();
    if (blockType === 'BEHAVIOR') {
      const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
      if (moduleType === 'WEAPONBONUSUPDATE') {
        const conditionName = readStringField(block.fields, ['BonusConditionType'])?.toUpperCase();
        if (!conditionName) return;
        const bonusFlag = WEAPON_BONUS_CONDITION_BY_NAME.get(conditionName);
        if (bonusFlag === undefined) return;

        const requiredKindOf = new Set<string>();
        const forbiddenKindOf = new Set<string>();
        for (const tokens of extractIniValueTokens(self, block.fields['RequiredAffectKindOf'])) {
          for (const t of tokens) { if (t) requiredKindOf.add(t.toUpperCase()); }
        }
        for (const tokens of extractIniValueTokens(self, block.fields['ForbiddenAffectKindOf'])) {
          for (const t of tokens) { if (t) forbiddenKindOf.add(t.toUpperCase()); }
        }

        profiles.push({
          requiredKindOf,
          forbiddenKindOf,
          bonusDurationFrames: self.msToLogicFrames(readNumericField(block.fields, ['BonusDuration']) ?? 0),
          bonusDelayFrames: self.msToLogicFrames(readNumericField(block.fields, ['BonusDelay']) ?? 0),
          bonusRange: readNumericField(block.fields, ['BonusRange']) ?? 0,
          bonusConditionFlag: bonusFlag,
        });
      }
    }
    if (block.blocks) {
      for (const child of block.blocks) visitBlock(child);
    }
  };
  if (objectDef.blocks) {
    for (const block of objectDef.blocks) visitBlock(block);
  }
  return profiles;
}

export function extractRadarUpdateProfile(self: GL, objectDef: ObjectDef | undefined): RadarUpdateProfile | null {
  if (!objectDef) return null;
  let profile: RadarUpdateProfile | null = null;
  const visitBlock = (block: IniBlock): void => {
    if (profile) return;
    const blockType = block.type.toUpperCase();
    if (blockType === 'BEHAVIOR') {
      const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
      if (moduleType === 'RADARUPDATE') {
        const extendTimeMs = readNumericField(block.fields, ['RadarExtendTime']) ?? 0;
        profile = {
          radarExtendTimeFrames: self.msToLogicFrames(extendTimeMs),
        };
      }
    }
    if (block.blocks) {
      for (const child of block.blocks) visitBlock(child);
    }
  };
  if (objectDef.blocks) {
    for (const block of objectDef.blocks) visitBlock(block);
  }
  return profile;
}

export function extractFloatUpdateProfile(self: GL, objectDef: ObjectDef | undefined): FloatUpdateProfile | null {
  if (!objectDef) return null;
  let profile: FloatUpdateProfile | null = null;
  const visitBlock = (block: IniBlock): void => {
    if (profile) return;
    const blockType = block.type.toUpperCase();
    if (blockType === 'BEHAVIOR') {
      const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
      if (moduleType === 'FLOATUPDATE') {
        const enabledStr = readStringField(block.fields, ['Enabled'])?.toUpperCase();
        profile = {
          enabled: enabledStr === 'YES' || enabledStr === 'TRUE' || enabledStr === '1',
        };
      }
    }
    if (block.blocks) {
      for (const child of block.blocks) visitBlock(child);
    }
  };
  if (objectDef.blocks) {
    for (const block of objectDef.blocks) visitBlock(block);
  }
  return profile;
}

export function extractStickyBombUpdateProfile(self: GL, objectDef: ObjectDef | undefined): StickyBombUpdateProfile | null {
  if (!objectDef) return null;
  let profile: StickyBombUpdateProfile | null = null;
  const visitBlock = (block: IniBlock): void => {
    if (profile) return;
    if (block.type.toUpperCase() === 'BEHAVIOR') {
      const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
      if (moduleType === 'STICKYBOMBUPDATE') {
        profile = {
          offsetZ: readNumericField(block.fields, ['OffsetZ']) ?? 10.0,
          geometryBasedDamageWeaponName: readStringField(block.fields, ['GeometryBasedDamageWeapon']) ?? null,
        };
      }
    }
    if (block.blocks) {
      for (const child of block.blocks) visitBlock(child);
    }
  };
  if (objectDef.blocks) {
    for (const block of objectDef.blocks) visitBlock(block);
  }
  return profile;
}

export function extractPointDefenseLaserProfile(self: GL, objectDef: ObjectDef | undefined): PointDefenseLaserProfile | null {
  if (!objectDef) return null;
  let profile: PointDefenseLaserProfile | null = null;
  const visitBlock = (block: IniBlock): void => {
    if (profile) return;
    const blockType = block.type.toUpperCase();
    if (blockType === 'BEHAVIOR') {
      const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
      if (moduleType === 'POINTDEFENSELASERUPDATE') {
        const weaponName = readStringField(block.fields, ['WeaponTemplate']);
        if (!weaponName) return;

        const primaryStr = readStringField(block.fields, ['PrimaryTargetTypes']) ?? '';
        const primaryTargetKindOf = new Set<string>();
        for (const token of primaryStr.split(/\s+/)) {
          if (token) primaryTargetKindOf.add(token.toUpperCase());
        }

        const secondaryStr = readStringField(block.fields, ['SecondaryTargetTypes']) ?? '';
        const secondaryTargetKindOf = new Set<string>();
        for (const token of secondaryStr.split(/\s+/)) {
          if (token) secondaryTargetKindOf.add(token.toUpperCase());
        }

        const scanRateMs = readNumericField(block.fields, ['ScanRate']) ?? 0;
        profile = {
          weaponName,
          primaryTargetKindOf,
          secondaryTargetKindOf,
          scanRate: Math.max(1, self.msToLogicFrames(scanRateMs)),
          scanRange: readNumericField(block.fields, ['ScanRange']) ?? 0,
          predictTargetVelocityFactor: readNumericField(block.fields, ['PredictTargetVelocityFactor']) ?? 0,
        };
      }
    }
    if (block.blocks) {
      for (const child of block.blocks) visitBlock(child);
    }
  };
  if (objectDef.blocks) {
    for (const block of objectDef.blocks) visitBlock(block);
  }
  return profile;
}

export function extractHordeUpdateProfile(self: GL, objectDef: ObjectDef | undefined): HordeUpdateProfile | null {
  if (!objectDef) return null;
  let profile: HordeUpdateProfile | null = null;
  const visitBlock = (block: IniBlock): void => {
    if (profile) return;
    const blockType = block.type.toUpperCase();
    if (blockType === 'BEHAVIOR') {
      const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
      if (moduleType === 'HORDEUPDATE') {
        const kindOfStr = readStringField(block.fields, ['KindOf']) ?? '';
        const kindOf = new Set<string>();
        for (const token of kindOfStr.split(/\s+/)) {
          if (token) kindOf.add(token.toUpperCase());
        }

        const updateRateMs = readNumericField(block.fields, ['UpdateRate']) ?? 1000;
        profile = {
          updateRate: Math.max(1, self.msToLogicFrames(updateRateMs)),
          kindOf,
          minCount: readNumericField(block.fields, ['Count']) ?? 2,
          minDist: readNumericField(block.fields, ['Radius']) ?? 100,
          rubOffRadius: readNumericField(block.fields, ['RubOffRadius']) ?? 20,
          alliesOnly: (readStringField(block.fields, ['AlliesOnly']) ?? 'Yes').toUpperCase() !== 'NO',
          exactMatch: (readStringField(block.fields, ['ExactMatch']) ?? 'No').toUpperCase() === 'YES',
          allowedNationalism: (readStringField(block.fields, ['AllowedNationalism']) ?? 'Yes').toUpperCase() !== 'NO',
        };
      }
    }
    if (block.blocks) {
      for (const child of block.blocks) visitBlock(child);
    }
  };
  if (objectDef.blocks) {
    for (const block of objectDef.blocks) visitBlock(block);
  }
  return profile;
}

export function extractEnemyNearScanDelay(self: GL, objectDef: ObjectDef | undefined): number {
  if (!objectDef) return 0;
  let result = 0;
  const visitBlock = (block: IniBlock): void => {
    if (result > 0) return;
    if (block.type.toUpperCase() === 'BEHAVIOR') {
      const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
      if (moduleType === 'ENEMYNEARUPDATE') {
        const scanDelayMs = readNumericField(block.fields, ['ScanDelayTime']) ?? 1000;
        result = Math.max(1, self.msToLogicFrames(scanDelayMs));
      }
    }
    if (block.blocks) {
      for (const child of block.blocks) visitBlock(child);
    }
  };
  if (objectDef.blocks) {
    for (const block of objectDef.blocks) visitBlock(block);
  }
  return result;
}

export function extractVeterancyGainCreateProfiles(self: GL, objectDef: ObjectDef | undefined): VeterancyGainCreateProfile[] {
  if (!objectDef) return [];
  const profiles: VeterancyGainCreateProfile[] = [];
  const visitBlock = (block: IniBlock): void => {
    if (block.type.toUpperCase() === 'BEHAVIOR' || block.type.toUpperCase() === 'DRAW') {
      const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
      if (moduleType === 'VETERANCYGAINCREATE') {
        const levelStr = readStringField(block.fields, ['StartingLevel'])?.trim().toUpperCase() ?? '';
        let startingLevel: VeterancyLevel = LEVEL_REGULAR;
        if (levelStr === 'VETERAN') startingLevel = LEVEL_VETERAN;
        else if (levelStr === 'ELITE') startingLevel = LEVEL_ELITE;
        else if (levelStr === 'HEROIC') startingLevel = LEVEL_HEROIC;

        const scienceStr = readStringField(block.fields, ['ScienceRequired'])?.trim().toUpperCase() ?? '';
        const scienceRequired = (scienceStr && scienceStr !== 'NONE' && scienceStr !== 'SCIENCE_INVALID')
          ? scienceStr : null;

        profiles.push({ startingLevel, scienceRequired });
      }
    }
    if (block.blocks) {
      for (const child of block.blocks) visitBlock(child);
    }
  };
  if (objectDef.blocks) {
    for (const block of objectDef.blocks) visitBlock(block);
  }
  return profiles;
}

export function extractFXListDieProfiles(self: GL, objectDef: ObjectDef | undefined): FXListDieProfile[] {
  if (!objectDef) return [];
  const profiles: FXListDieProfile[] = [];
  const visitBlock = (block: IniBlock): void => {
    if (block.type.toUpperCase() === 'BEHAVIOR') {
      const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
      if (moduleType === 'FXLISTDIE') {
        const deathFXName = readStringField(block.fields, ['DeathFX'])?.trim().toUpperCase() ?? '';
        if (!deathFXName) { return; }
        const orientToObject = (readStringField(block.fields, ['OrientToObject'])?.toUpperCase() ?? 'YES') !== 'NO';

        // DieMuxData filtering fields.
        const deathTypes = new Set<string>();
        const dtStr = readStringField(block.fields, ['DeathTypes'])?.trim().toUpperCase() ?? '';
        if (dtStr) { for (const t of dtStr.split(/\s+/)) { if (t) deathTypes.add(t); } }
        const veterancyLevels = new Set<string>();
        const vlStr = readStringField(block.fields, ['VeterancyLevels'])?.trim().toUpperCase() ?? '';
        if (vlStr) { for (const t of vlStr.split(/\s+/)) { if (t) veterancyLevels.add(t); } }
        const exemptStatus = new Set<string>();
        const esStr = readStringField(block.fields, ['ExemptStatus'])?.trim().toUpperCase() ?? '';
        if (esStr) { for (const t of esStr.split(/\s+/)) { if (t) exemptStatus.add(t); } }
        const requiredStatus = new Set<string>();
        const rsStr = readStringField(block.fields, ['RequiredStatus'])?.trim().toUpperCase() ?? '';
        if (rsStr) { for (const t of rsStr.split(/\s+/)) { if (t) requiredStatus.add(t); } }

        profiles.push({ deathFXName, orientToObject, deathTypes, veterancyLevels, exemptStatus, requiredStatus });
      }
    }
    if (block.blocks) {
      for (const child of block.blocks) visitBlock(child);
    }
  };
  if (objectDef.blocks) {
    for (const block of objectDef.blocks) visitBlock(block);
  }
  return profiles;
}

export function extractCrushDieProfiles(self: GL, objectDef: ObjectDef | undefined): CrushDieProfile[] {
  if (!objectDef) return [];
  const profiles: CrushDieProfile[] = [];
  const visitBlock = (block: IniBlock): void => {
    if (block.type.toUpperCase() === 'BEHAVIOR') {
      const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
      if (moduleType === 'CRUSHDIE') {
        // DieMuxData filtering fields.
        const deathTypes = new Set<string>();
        const dtStr = readStringField(block.fields, ['DeathTypes'])?.trim().toUpperCase() ?? '';
        if (dtStr) { for (const t of dtStr.split(/\s+/)) { if (t) deathTypes.add(t); } }
        const veterancyLevels = new Set<string>();
        const vlStr = readStringField(block.fields, ['VeterancyLevels'])?.trim().toUpperCase() ?? '';
        if (vlStr) { for (const t of vlStr.split(/\s+/)) { if (t) veterancyLevels.add(t); } }
        const exemptStatus = new Set<string>();
        const esStr = readStringField(block.fields, ['ExemptStatus'])?.trim().toUpperCase() ?? '';
        if (esStr) { for (const t of esStr.split(/\s+/)) { if (t) exemptStatus.add(t); } }
        const requiredStatus = new Set<string>();
        const rsStr = readStringField(block.fields, ['RequiredStatus'])?.trim().toUpperCase() ?? '';
        if (rsStr) { for (const t of rsStr.split(/\s+/)) { if (t) requiredStatus.add(t); } }

        profiles.push({ deathTypes, veterancyLevels, exemptStatus, requiredStatus });
      }
    }
    if (block.blocks) {
      for (const child of block.blocks) visitBlock(child);
    }
  };
  if (objectDef.blocks) {
    for (const block of objectDef.blocks) visitBlock(block);
  }
  return profiles;
}

export function extractDieMuxData(self: GL, block: IniBlock): {
  deathTypes: Set<string>;
  veterancyLevels: Set<string>;
  exemptStatus: Set<string>;
  requiredStatus: Set<string>;
} {
  const deathTypes = new Set<string>();
  const dtStr = readStringField(block.fields, ['DeathTypes'])?.trim().toUpperCase() ?? '';
  if (dtStr) {
    for (const token of dtStr.split(/\s+/)) {
      if (token) deathTypes.add(token);
    }
  }

  const veterancyLevels = new Set<string>();
  const vlStr = readStringField(block.fields, ['VeterancyLevels'])?.trim().toUpperCase() ?? '';
  if (vlStr) {
    for (const token of vlStr.split(/\s+/)) {
      if (token) veterancyLevels.add(token);
    }
  }

  const exemptStatus = new Set<string>();
  const esStr = readStringField(block.fields, ['ExemptStatus'])?.trim().toUpperCase() ?? '';
  if (esStr) {
    for (const token of esStr.split(/\s+/)) {
      if (token) exemptStatus.add(token);
    }
  }

  const requiredStatus = new Set<string>();
  const rsStr = readStringField(block.fields, ['RequiredStatus'])?.trim().toUpperCase() ?? '';
  if (rsStr) {
    for (const token of rsStr.split(/\s+/)) {
      if (token) requiredStatus.add(token);
    }
  }

  return { deathTypes, veterancyLevels, exemptStatus, requiredStatus };
}

export function extractDestroyDieProfiles(self: GL, objectDef: ObjectDef | undefined): DestroyDieProfile[] {
  if (!objectDef) return [];
  const profiles: DestroyDieProfile[] = [];
  const visitBlock = (block: IniBlock): void => {
    if (block.type.toUpperCase() === 'BEHAVIOR') {
      const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
      if (moduleType === 'DESTROYDIE') {
        profiles.push(extractDieMuxData(self, block));
      }
    }
    for (const child of block.blocks) {
      visitBlock(child);
    }
  };
  for (const block of objectDef.blocks) {
    visitBlock(block);
  }
  return profiles;
}

export function extractDamDieProfiles(self: GL, objectDef: ObjectDef | undefined): DamDieProfile[] {
  if (!objectDef) return [];
  const profiles: DamDieProfile[] = [];
  const visitBlock = (block: IniBlock): void => {
    if (block.type.toUpperCase() === 'BEHAVIOR') {
      const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
      if (moduleType === 'DAMDIE') {
        const dieMux = extractDieMuxData(self, block);
        const oclName = readStringField(block.fields, ['CreationList', 'GroundCreationList', 'AirCreationList', 'OCL']);
        profiles.push({
          ...dieMux,
          oclName: oclName ? oclName.trim() : null,
        });
      }
    }
    for (const child of block.blocks) {
      visitBlock(child);
    }
  };
  for (const block of objectDef.blocks) {
    visitBlock(block);
  }
  return profiles;
}

export function extractSpecialPowerCompletionDieProfiles(self: GL, objectDef: ObjectDef | undefined): SpecialPowerCompletionDieProfile[] {
  if (!objectDef) return [];
  const profiles: SpecialPowerCompletionDieProfile[] = [];
  const visitBlock = (block: IniBlock): void => {
    if (block.type.toUpperCase() === 'BEHAVIOR') {
      const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
      if (moduleType === 'SPECIALPOWERCOMPLETIONDIE') {
        const specialPowerTemplateName = self.normalizeShortcutSpecialPowerName(
          readStringField(block.fields, ['SpecialPowerTemplate']) ?? '',
        );
        if (!specialPowerTemplateName) {
          return;
        }

        profiles.push({
          specialPowerTemplateName,
          ...extractDieMuxData(self, block),
        });
      }
    }
    for (const child of block.blocks) {
      visitBlock(child);
    }
  };
  for (const block of objectDef.blocks) {
    visitBlock(block);
  }
  return profiles;
}

export function extractGrantUpgradeCreateProfiles(self: GL, objectDef: ObjectDef | undefined): GrantUpgradeCreateProfile[] {
  if (!objectDef) return [];
  const profiles: GrantUpgradeCreateProfile[] = [];
  const visitBlock = (block: IniBlock): void => {
    if (block.type.toUpperCase() === 'BEHAVIOR') {
      const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
      if (moduleType === 'GRANTUPGRADECREATE') {
        const upgradeName = readStringField(block.fields, ['UpgradeToGrant'])?.trim().toUpperCase() ?? '';
        if (upgradeName) {
          const exemptStatus = readStringField(block.fields, ['ExemptStatus'])?.trim().toUpperCase() ?? '';
          // Source parity: determine if this is a PLAYER upgrade by checking the UpgradeDef.
          // We check at runtime; for now store the name and resolve type on application.
          profiles.push({
            upgradeName,
            isPlayerUpgrade: false, // Resolved at application time from UpgradeDef.
            exemptUnderConstruction: exemptStatus.includes('UNDER_CONSTRUCTION'),
          });
        }
      }
    }
    if (block.blocks) {
      for (const child of block.blocks) visitBlock(child);
    }
  };
  if (objectDef.blocks) {
    for (const block of objectDef.blocks) visitBlock(block);
  }
  return profiles;
}

export function extractLockWeaponCreateSlot(self: GL, objectDef: ObjectDef | undefined): number | null {
  if (!objectDef) return null;
  let slot: number | null = null;
  const visitBlock = (block: IniBlock): void => {
    if (slot !== null) return;
    if (block.type.toUpperCase() === 'BEHAVIOR') {
      const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
      if (moduleType === 'LOCKWEAPONCREATE') {
        const slotName = readStringField(block.fields, ['SlotToLock'])?.trim().toUpperCase() ?? '';
        if (slotName === 'SECONDARY_WEAPON') {
          slot = 1;
        } else if (slotName === 'TERTIARY_WEAPON') {
          slot = 2;
        } else {
          // PRIMARY_WEAPON or default.
          slot = 0;
        }
      }
    }
    if (block.blocks) {
      for (const child of block.blocks) visitBlock(child);
    }
  };
  if (objectDef.blocks) {
    for (const block of objectDef.blocks) visitBlock(block);
  }
  return slot;
}

export function extractUpgradeDieProfiles(self: GL, objectDef: ObjectDef | undefined): UpgradeDieProfile[] {
  if (!objectDef) return [];
  const profiles: UpgradeDieProfile[] = [];
  const visitBlock = (block: IniBlock): void => {
    if (block.type.toUpperCase() === 'BEHAVIOR') {
      const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
      if (moduleType === 'UPGRADEDIE') {
        const upgradeName = readStringField(block.fields, ['UpgradeToRemove'])?.trim().toUpperCase() ?? '';
        if (upgradeName) {
          // DieMuxData filtering.
          const deathTypesRaw = readStringField(block.fields, ['DeathTypes'])?.trim().toUpperCase() ?? '';
          const deathTypes: Set<string> | null = deathTypesRaw
            ? new Set(deathTypesRaw.split(/\s+/).filter(Boolean))
            : null;
          const exemptStatusRaw = readStringField(block.fields, ['ExemptStatus'])?.trim().toUpperCase() ?? '';
          const exemptStatus = new Set(exemptStatusRaw.split(/\s+/).filter(Boolean));
          const requiredStatusRaw = readStringField(block.fields, ['RequiredStatus'])?.trim().toUpperCase() ?? '';
          const requiredStatus = new Set(requiredStatusRaw.split(/\s+/).filter(Boolean));
          profiles.push({
            upgradeName,
            deathTypes,
            exemptStatus,
            requiredStatus,
          });
        }
      }
    }
    if (block.blocks) {
      for (const child of block.blocks) visitBlock(child);
    }
  };
  if (objectDef.blocks) {
    for (const block of objectDef.blocks) visitBlock(block);
  }
  return profiles;
}

export function extractCheckpointProfile(self: GL, objectDef: ObjectDef | undefined): CheckpointProfile | null {
  if (!objectDef) return null;
  let profile: CheckpointProfile | null = null;
  const visitBlock = (block: IniBlock): void => {
    if (profile !== null) return;
    if (block.type.toUpperCase() === 'BEHAVIOR') {
      const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
      if (moduleType === 'CHECKPOINTUPDATE') {
        const scanDelayMs = readNumericField(block.fields, ['EnemyScanDelayTime']) ?? 1000;
        profile = {
          scanDelayFrames: Math.max(1, self.msToLogicFrames(scanDelayMs)),
        };
      }
    }
    if (block.blocks) {
      for (const child of block.blocks) visitBlock(child);
    }
  };
  if (objectDef.blocks) {
    for (const block of objectDef.blocks) visitBlock(block);
  }
  return profile;
}

export function extractProneDamageToFramesRatio(self: GL, objectDef: ObjectDef | undefined): number | null {
  if (!objectDef) return null;
  let ratio: number | null = null;
  const visitBlock = (block: IniBlock): void => {
    if (ratio !== null) return;
    const blockType = block.type.toUpperCase();
    if (blockType === 'BEHAVIOR' || blockType === 'PRONEUPDATE') {
      const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
      if (moduleType === 'PRONEUPDATE' || blockType === 'PRONEUPDATE') {
        ratio = readNumericField(block.fields, ['DamageToFramesRatio']) ?? 1.0;
      }
    }
    if (block.blocks) {
      for (const child of block.blocks) visitBlock(child);
    }
  };
  if (objectDef.blocks) {
    for (const block of objectDef.blocks) visitBlock(block);
  }
  return ratio;
}

/** Source parity: parseLookupList with TheWeaponSlotTypeNames — PRIMARY_WEAPON=0, SECONDARY_WEAPON=1, TERTIARY_WEAPON=2. */
function parseWeaponSlotIndex(slotName: string | null): number {
  if (!slotName) return 0; // PRIMARY_WEAPON default
  const upper = slotName.trim().toUpperCase();
  if (upper === 'SECONDARY' || upper === 'SECONDARY_WEAPON') return 1;
  if (upper === 'TERTIARY' || upper === 'TERTIARY_WEAPON') return 2;
  return 0; // PRIMARY_WEAPON or unrecognized
}

export function extractDemoTrapProfile(self: GL, objectDef: ObjectDef | undefined): DemoTrapProfile | null {
  if (!objectDef) return null;
  let profile: DemoTrapProfile | null = null;
  const visitBlock = (block: IniBlock): void => {
    if (profile !== null) return;
    const blockType = block.type.toUpperCase();
    if (blockType === 'BEHAVIOR' || blockType === 'DEMOTRAPUPDATE') {
      const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
      if (moduleType === 'DEMOTRAPUPDATE' || blockType === 'DEMOTRAPUPDATE') {
        const ignoreStr = readStringField(block.fields, ['IgnoreTargetTypes']) ?? '';
        const ignoreKindOf = new Set<string>(
          ignoreStr.split(/\s+/).filter(Boolean).map(s => s.toUpperCase()),
        );
        profile = {
          defaultsToProximityMode: readBooleanField(block.fields, ['DefaultProximityMode']) ?? false,
          triggerDetonationRange: readNumericField(block.fields, ['TriggerDetonationRange']) ?? 0,
          ignoreKindOf,
          scanFrames: self.msToLogicFrames(readNumericField(block.fields, ['ScanRate']) ?? 0),
          friendlyDetonation: readBooleanField(block.fields, ['AutoDetonationWithFriendsInvolved']) ?? false,
          detonationWeaponName: readStringField(block.fields, ['DetonationWeapon']),
          detonateWhenKilled: readBooleanField(block.fields, ['DetonateWhenKilled']) ?? false,
          detonationWeaponSlot: parseWeaponSlotIndex(readStringField(block.fields, ['DetonationWeaponSlot'])),
          proximityModeWeaponSlot: parseWeaponSlotIndex(readStringField(block.fields, ['ProximityModeWeaponSlot'])),
          manualModeWeaponSlot: parseWeaponSlotIndex(readStringField(block.fields, ['ManualModeWeaponSlot'])),
        };
      }
    }
    if (block.blocks) {
      for (const child of block.blocks) visitBlock(child);
    }
  };
  if (objectDef.blocks) {
    for (const block of objectDef.blocks) visitBlock(block);
  }
  return profile;
}

export function extractRebuildHoleExposeDieProfile(self: GL, objectDef: ObjectDef | undefined): RebuildHoleExposeDieProfile | null {
  if (!objectDef) return null;
  let profile: RebuildHoleExposeDieProfile | null = null;
  const visitBlock = (block: IniBlock): void => {
    if (profile) return;
    const blockType = block.type.toUpperCase();
    if (blockType === 'DIE' || blockType === 'BEHAVIOR') {
      const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
      if (moduleType === 'REBUILDHOLEEXPOSEDIE') {
        const holeName = readStringField(block.fields, ['HoleName']);
        if (!holeName) return;
        profile = {
          holeName,
          holeMaxHealth: readNumericField(block.fields, ['HoleMaxHealth']) ?? 50,
          transferAttackers: readBooleanField(block.fields, ['TransferAttackers']) ?? true,
        };
      }
    }
    if (block.blocks) {
      for (const child of block.blocks) visitBlock(child);
    }
  };
  if (objectDef.blocks) {
    for (const block of objectDef.blocks) visitBlock(block);
  }
  return profile;
}

export function extractRebuildHoleBehaviorProfile(self: GL, objectDef: ObjectDef | undefined): RebuildHoleBehaviorProfile | null {
  if (!objectDef) return null;
  let profile: RebuildHoleBehaviorProfile | null = null;
  const visitBlock = (block: IniBlock): void => {
    if (profile) return;
    const blockType = block.type.toUpperCase();
    if (blockType === 'BEHAVIOR') {
      const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
      if (moduleType === 'REBUILDHOLEBEHAVIOR') {
        const workerName = readStringField(block.fields, ['WorkerObjectName']);
        if (!workerName) return;
        // Source parity: WorkerRespawnDelay is in milliseconds → convert to frames.
        const respawnDelayMs = readNumericField(block.fields, ['WorkerRespawnDelay']) ?? 5000;
        // Source parity: HoleHealthRegen%PerSecond uses INI::parsePercentToReal
        // which divides by 100. E.g., INI value "10" → 0.1 (10%). Default = 0.1.
        const regenRaw = readNumericField(block.fields, ['HoleHealthRegen%PerSecond']);
        const regenPercent = regenRaw !== null && Number.isFinite(regenRaw) ? regenRaw / 100 : 0.1;
        profile = {
          workerObjectName: workerName,
          workerRespawnDelay: self.msToLogicFrames(respawnDelayMs),
          holeHealthRegenPercentPerSecond: regenPercent,
        };
      }
    }
    if (block.blocks) {
      for (const child of block.blocks) visitBlock(child);
    }
  };
  if (objectDef.blocks) {
    for (const block of objectDef.blocks) visitBlock(block);
  }
  return profile;
}

export function extractAutoDepositProfile(self: GL, objectDef: ObjectDef | undefined): AutoDepositProfile | null {
  if (!objectDef) return null;
  let profile: AutoDepositProfile | null = null;
  const visitBlock = (block: IniBlock): void => {
    if (profile) return;
    const blockType = block.type.toUpperCase();
    if (blockType === 'BEHAVIOR') {
      const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
      if (moduleType === 'AUTODEPOSITUPDATE') {
        // Source parity: DepositTiming is in milliseconds → convert to frames.
        const depositTimingMs = readNumericField(block.fields, ['DepositTiming']) ?? 2000;
        const depositAmount = readNumericField(block.fields, ['DepositAmount']) ?? 0;
        const initialCaptureBonus = readNumericField(block.fields, ['InitialCaptureBonus']) ?? 0;
        profile = {
          depositFrames: Math.max(1, self.msToLogicFrames(depositTimingMs)),
          depositAmount,
          initialCaptureBonus,
        };
      }
    }
    if (block.blocks) {
      for (const child of block.blocks) visitBlock(child);
    }
  };
  if (objectDef.blocks) {
    for (const block of objectDef.blocks) visitBlock(block);
  }
  return profile;
}

export function extractDynamicShroudProfile(self: GL, objectDef: ObjectDef | undefined): DynamicShroudProfile | null {
  if (!objectDef) return null;
  let profile: DynamicShroudProfile | null = null;
  const visitBlock = (block: IniBlock): void => {
    if (profile) return;
    const blockType = block.type.toUpperCase();
    if (blockType === 'BEHAVIOR') {
      const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
      if (moduleType === 'DYNAMICSHROUDCLEARINGRANGEUPDATE' || moduleType === 'DYNAMICSHROUDCLEARINGRANGE') {
        profile = {
          shrinkDelay: Math.max(0, self.msToLogicFrames(readNumericField(block.fields, ['ShrinkDelay']) ?? 0)),
          shrinkTime: Math.max(0, self.msToLogicFrames(readNumericField(block.fields, ['ShrinkTime']) ?? 0)),
          growDelay: Math.max(0, self.msToLogicFrames(readNumericField(block.fields, ['GrowDelay']) ?? 0)),
          growTime: Math.max(0, self.msToLogicFrames(readNumericField(block.fields, ['GrowTime']) ?? 0)),
          finalVision: readNumericField(block.fields, ['FinalVision']) ?? 0,
          changeInterval: Math.max(1, self.msToLogicFrames(readNumericField(block.fields, ['ChangeInterval']) ?? 0)),
          growInterval: Math.max(1, self.msToLogicFrames(readNumericField(block.fields, ['GrowInterval']) ?? 0)),
        };
      }
    }
    if (block.blocks) {
      for (const child of block.blocks) visitBlock(child);
    }
  };
  if (objectDef.blocks) {
    for (const block of objectDef.blocks) visitBlock(block);
  }
  return profile;
}

export function extractAutoFindHealingProfile(self: GL, objectDef: ObjectDef | undefined): AutoFindHealingProfile | null {
  if (!objectDef) return null;
  let profile: AutoFindHealingProfile | null = null;
  const visitBlock = (block: IniBlock): void => {
    if (profile) return;
    if (block.type.toUpperCase() === 'BEHAVIOR') {
      const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
      if (moduleType === 'AUTOFINDHEALING' || moduleType === 'AUTOFINDHEALINGUPDATE') {
        profile = {
          scanRateFrames: self.msToLogicFrames(readNumericField(block.fields, ['ScanRate']) ?? 1000),
          scanRange: (readNumericField(block.fields, ['ScanRange']) ?? 200) * MAP_XY_FACTOR,
          neverHeal: readNumericField(block.fields, ['NeverHeal']) ?? 0.95,
          alwaysHeal: readNumericField(block.fields, ['AlwaysHeal']) ?? 0.25,
        };
      }
    }
    if (block.blocks) {
      for (const child of block.blocks) visitBlock(child);
    }
  };
  if (objectDef.blocks) {
    for (const block of objectDef.blocks) visitBlock(block);
  }
  return profile;
}

export function extractCountermeasuresProfile(self: GL, objectDef: ObjectDef | undefined): CountermeasuresProfile | null {
  if (!objectDef) return null;
  let profile: CountermeasuresProfile | null = null;
  const visitBlock = (block: IniBlock): void => {
    if (profile) return;
    const blockType = block.type.toUpperCase();
    if (blockType === 'BEHAVIOR') {
      const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
      if (moduleType === 'COUNTERMEASURESBEHAVIOR') {
        const evasionRaw = readNumericField(block.fields, ['EvasionRate']);
        profile = {
          flareTemplateName: readStringField(block.fields, ['FlareTemplateName']) ?? '',
          volleySize: readNumericField(block.fields, ['VolleySize']) ?? 0,
          volleyArcAngle: (readNumericField(block.fields, ['VolleyArcAngle']) ?? 0) * (Math.PI / 180),
          volleyVelocityFactor: readNumericField(block.fields, ['VolleyVelocityFactor']) ?? 1.0,
          framesBetweenVolleys: self.msToLogicFrames(readNumericField(block.fields, ['DelayBetweenVolleys']) ?? 0),
          numberOfVolleys: readNumericField(block.fields, ['NumberOfVolleys']) ?? 0,
          reloadFrames: self.msToLogicFrames(readNumericField(block.fields, ['ReloadTime']) ?? 0),
          evasionRate: evasionRaw != null ? evasionRaw / 100 : 0,
          missileDecoyFrames: self.msToLogicFrames(readNumericField(block.fields, ['MissileDecoyDelay']) ?? 0),
          reactionFrames: self.msToLogicFrames(readNumericField(block.fields, ['ReactionLaunchLatency']) ?? 0),
        };
      }
    }
    if (block.blocks) {
      for (const child of block.blocks) visitBlock(child);
    }
  };
  if (objectDef.blocks) {
    for (const block of objectDef.blocks) visitBlock(block);
  }
  return profile;
}

export function extractPilotFindVehicleProfile(self: GL, objectDef: ObjectDef | undefined): PilotFindVehicleProfile | null {
  if (!objectDef) return null;
  let profile: PilotFindVehicleProfile | null = null;
  const visitBlock = (block: IniBlock): void => {
    if (profile) return;
    const blockType = block.type.toUpperCase();
    if (blockType === 'BEHAVIOR') {
      const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
      if (moduleType === 'PILOTFINDVEHICLEUPDATE') {
        profile = {
          scanFrames: self.msToLogicFrames(readNumericField(block.fields, ['ScanRate']) ?? 0),
          scanRange: readNumericField(block.fields, ['ScanRange']) ?? 0,
          minHealth: readNumericField(block.fields, ['MinHealth']) ?? 0.5,
        };
      }
    }
    if (block.blocks) {
      for (const child of block.blocks) visitBlock(child);
    }
  };
  if (objectDef.blocks) {
    for (const block of objectDef.blocks) visitBlock(block);
  }
  return profile;
}

export function extractToppleProfile(self: GL, objectDef: ObjectDef | undefined): ToppleProfile | null {
  if (!objectDef) return null;
  let profile: ToppleProfile | null = null;
  const visitBlock = (block: IniBlock): void => {
    if (profile) return;
    const blockType = block.type.toUpperCase();
    if (blockType === 'BEHAVIOR') {
      const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
      if (moduleType === 'TOPPLEUPDATE') {
        // Source parity: C++ defaults are 0.2f, 0.01f, 0.3f (set in constructor).
        // Use null to distinguish "field not present" from "field explicitly set to 0".
        const parsePercent = (raw: number | null | undefined): number | null =>
          raw != null ? raw / 100 : null;
        profile = {
          initialVelocityPercent: parsePercent(readNumericField(block.fields, ['InitialVelocityPercent'])) ?? 0.20,
          initialAccelPercent: parsePercent(readNumericField(block.fields, ['InitialAccelPercent'])) ?? 0.01,
          bounceVelocityPercent: parsePercent(readNumericField(block.fields, ['BounceVelocityPercent'])) ?? 0.30,
          killWhenFinishedToppling: readBooleanField(block.fields, ['KillWhenFinishedToppling']) ?? true,
          killWhenStartToppling: readBooleanField(block.fields, ['KillWhenStartToppling']) ?? false,
          toppleLeftOrRightOnly: readBooleanField(block.fields, ['ToppleLeftOrRightOnly']) ?? false,
          stumpName: (readStringField(block.fields, ['StumpName']) ?? '').trim(),
          killStumpWhenToppled: readBooleanField(block.fields, ['KillStumpWhenToppled']) ?? false,
          reorientToppledRubble: readBooleanField(block.fields, ['ReorientToppledRubble']) ?? false,
        };
      }
    }
    if (block.blocks) {
      for (const child of block.blocks) visitBlock(child);
    }
  };
  if (objectDef.blocks) {
    for (const block of objectDef.blocks) visitBlock(block);
  }
  return profile;
}

export function extractPhysicsBehaviorProfile(self: GL, objectDef: ObjectDef | undefined): PhysicsBehaviorProfile | null {
  if (!objectDef) return null;
  let profile: PhysicsBehaviorProfile | null = null;
  const SECONDS_PER_FRAME = 1 / 30;
  const visitBlock = (block: IniBlock): void => {
    if (profile) return;
    if (block.type.toUpperCase() === 'BEHAVIOR') {
      const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
      if (moduleType === 'PHYSICSBEHAVIOR') {
        const parseFrictionPerSec = (val: number | null | undefined, def: number): number => {
          if (val == null) return def;
          return val * SECONDS_PER_FRAME;
        };
        profile = {
          mass: readNumericField(block.fields, ['Mass']) ?? 1.0,
          // Source parity: C++ defaults (PhysicsUpdate.cpp:55-57) are per-frame values:
          // DEFAULT_FORWARD_FRICTION=0.15, DEFAULT_LATERAL_FRICTION=0.15, DEFAULT_Z_FRICTION=0.8.
          // INI-loaded values are per-second and get converted via parseFrictionPerSec (÷30),
          // but the defaults are already per-frame and must NOT be divided.
          forwardFriction: parseFrictionPerSec(readNumericField(block.fields, ['ForwardFriction']), 0.15),
          lateralFriction: parseFrictionPerSec(readNumericField(block.fields, ['LateralFriction']), 0.15),
          zFriction: parseFrictionPerSec(readNumericField(block.fields, ['ZFriction']), 0.8),
          aerodynamicFriction: parseFrictionPerSec(readNumericField(block.fields, ['AerodynamicFriction']), 0),
          centerOfMassOffset: readNumericField(block.fields, ['CenterOfMassOffset']) ?? 0,
          killWhenRestingOnGround: readBooleanField(block.fields, ['KillWhenRestingOnGround']) ?? false,
          allowBouncing: readBooleanField(block.fields, ['AllowBouncing']) ?? false,
          allowCollideForce: readBooleanField(block.fields, ['AllowCollideForce']) ?? true,
          pitchRollYawFactor: readNumericField(block.fields, ['PitchRollYawFactor']) ?? 2.0,
        };
      }
    }
    if (block.blocks) {
      for (const child of block.blocks) visitBlock(child);
    }
  };
  if (objectDef.blocks) {
    for (const block of objectDef.blocks) visitBlock(block);
  }
  return profile;
}

export function extractStructureToppleProfile(self: GL, objectDef: ObjectDef | undefined): StructureToppleProfile | null {
  if (!objectDef) return null;
  let profile: StructureToppleProfile | null = null;
  const visitBlock = (block: IniBlock): void => {
    if (profile) return;
    if (block.type.toUpperCase() === 'BEHAVIOR') {
      const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
      if (moduleType === 'STRUCTURETOPPLEUPDATE') {
        profile = {
          minToppleDelayFrames: self.msToLogicFrames(readNumericField(block.fields, ['MinToppleDelay']) ?? 500),
          maxToppleDelayFrames: self.msToLogicFrames(readNumericField(block.fields, ['MaxToppleDelay']) ?? 1000),
          minToppleBurstDelayFrames: self.msToLogicFrames(readNumericField(block.fields, ['MinToppleBurstDelay']) ?? 100),
          maxToppleBurstDelayFrames: self.msToLogicFrames(readNumericField(block.fields, ['MaxToppleBurstDelay']) ?? 500),
          structuralIntegrity: readNumericField(block.fields, ['StructuralIntegrity']) ?? 0.1,
          structuralDecay: readNumericField(block.fields, ['StructuralDecay']) ?? 0,
          crushingWeaponName: readStringField(block.fields, ['CrushingWeaponName']) ?? '',
        };
      }
    }
    if (block.blocks) {
      for (const child of block.blocks) visitBlock(child);
    }
  };
  if (objectDef.blocks) {
    for (const block of objectDef.blocks) visitBlock(block);
  }
  return profile;
}

export function extractMissileLauncherBuildingProfile(self: GL, objectDef: ObjectDef | undefined): MissileLauncherBuildingProfile | null {
  if (!objectDef) return null;
  let profile: MissileLauncherBuildingProfile | null = null;
  const visitBlock = (block: IniBlock): void => {
    if (profile) return;
    if (block.type.toUpperCase() === 'BEHAVIOR') {
      const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
      if (moduleType === 'MISSILELAUNCHERBUILDINGUPDATE') {
        profile = {
          specialPowerTemplateName: (readStringField(block.fields, ['SpecialPowerTemplate']) ?? '').trim().toUpperCase(),
          doorOpenTimeFrames: self.msToLogicFrames(readNumericField(block.fields, ['DoorOpenTime']) ?? 0),
          doorWaitOpenTimeFrames: self.msToLogicFrames(readNumericField(block.fields, ['DoorWaitOpenTime']) ?? 0),
          doorClosingTimeFrames: self.msToLogicFrames(readNumericField(block.fields, ['DoorCloseTime']) ?? 0),
        };
      }
    }
    if (block.blocks) {
      for (const child of block.blocks) visitBlock(child);
    }
  };
  if (objectDef.blocks) {
    for (const block of objectDef.blocks) visitBlock(block);
  }
  return profile;
}

export function extractParticleUplinkCannonProfile(self: GL, objectDef: ObjectDef | undefined): ParticleUplinkCannonProfile | null {
  if (!objectDef) return null;
  let profile: ParticleUplinkCannonProfile | null = null;
  const visitBlock = (block: IniBlock): void => {
    if (profile) return;
    if (block.type.toUpperCase() === 'BEHAVIOR') {
      const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
      if (moduleType === 'PARTICLEUPLINKCANNONUPDATE') {
        profile = {
          specialPowerTemplateName: (readStringField(block.fields, ['SpecialPowerTemplate']) ?? '').trim().toUpperCase(),
          totalFiringFrames: self.msToLogicFrames(readNumericField(block.fields, ['TotalFiringTime']) ?? 0),
          totalDamagePulses: readNumericField(block.fields, ['TotalDamagePulses']) ?? 0,
          damagePerSecond: readNumericField(block.fields, ['DamagePerSecond']) ?? 0,
          damageType: (readStringField(block.fields, ['DamageType']) ?? 'LASER').toUpperCase(),
          damageRadiusScalar: readNumericField(block.fields, ['DamageRadiusScalar']) ?? 1.0,
          revealRange: (readNumericField(block.fields, ['RevealRange']) ?? 0) * MAP_XY_FACTOR,
          swathOfDeathDistance: (readNumericField(block.fields, ['SwathOfDeathDistance']) ?? 0) * MAP_XY_FACTOR,
          swathOfDeathAmplitude: (readNumericField(block.fields, ['SwathOfDeathAmplitude']) ?? 0) * MAP_XY_FACTOR,
        };
      }
    }
    if (block.blocks) {
      for (const child of block.blocks) visitBlock(child);
    }
  };
  if (objectDef.blocks) {
    for (const block of objectDef.blocks) visitBlock(block);
  }
  return profile;
}

export function extractNeutronMissileUpdateProfile(self: GL, objectDef: ObjectDef | undefined): NeutronMissileUpdateProfile | null {
  if (!objectDef) return null;
  let profile: NeutronMissileUpdateProfile | null = null;
  const visitBlock = (block: IniBlock): void => {
    if (profile) return;
    if (block.type.toUpperCase() === 'BEHAVIOR') {
      const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
      if (moduleType === 'NEUTRONMISSILEUPDATE') {
        profile = {
          initialDist: readNumericField(block.fields, ['DistanceToTravelBeforeTurning']) ?? 0,
          maxTurnRate: (readNumericField(block.fields, ['MaxTurnRate']) ?? 999) * (Math.PI / 180),
          forwardDamping: readNumericField(block.fields, ['ForwardDamping']) ?? 0,
          relativeSpeed: readNumericField(block.fields, ['RelativeSpeed']) ?? 1.0,
          targetFromDirectlyAbove: readNumericField(block.fields, ['TargetFromDirectlyAbove']) ?? 0,
          specialAccelFactor: readNumericField(block.fields, ['SpecialAccelFactor']) ?? 1.0,
          specialSpeedTimeFrames: self.msToLogicFrames(readNumericField(block.fields, ['SpecialSpeedTime']) ?? 0),
          specialSpeedHeight: readNumericField(block.fields, ['SpecialSpeedHeight']) ?? 0,
          deliveryDecalRadius: readNumericField(block.fields, ['DeliveryDecalRadius']) ?? 0,
          specialJitterDistance: readNumericField(block.fields, ['SpecialJitterDistance']) ?? 0,
        };
      }
    }
    if (block.blocks) {
      for (const child of block.blocks) visitBlock(child);
    }
  };
  if (objectDef.blocks) {
    for (const block of objectDef.blocks) visitBlock(block);
  }
  return profile;
}

export function extractSpecialAbilityProfile(self: GL, objectDef: ObjectDef | undefined): SpecialAbilityProfile | null {
  if (!objectDef) return null;
  let profile: SpecialAbilityProfile | null = null;
  const visitBlock = (block: IniBlock): void => {
    if (profile) return;
    const blockType = block.type.toUpperCase();
    if (blockType === 'BEHAVIOR') {
      const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
      if (moduleType === 'SPECIALABILITYUPDATE') {
        const specialPowerTemplate = readStringField(block.fields, ['SpecialPowerTemplate']);
        if (!specialPowerTemplate) return;
        const HUGE_DISTANCE = 10000000.0;
        profile = {
          specialPowerTemplateName: specialPowerTemplate.trim().toUpperCase(),
          startAbilityRange: readNumericField(block.fields, ['StartAbilityRange']) ?? HUGE_DISTANCE,
          abilityAbortRange: readNumericField(block.fields, ['AbilityAbortRange']) ?? HUGE_DISTANCE,
          preparationFrames: self.msToLogicFrames(readNumericField(block.fields, ['PreparationTime']) ?? 0),
          persistentPrepFrames: self.msToLogicFrames(readNumericField(block.fields, ['PersistentPrepTime']) ?? 0),
          packTimeFrames: self.msToLogicFrames(readNumericField(block.fields, ['PackTime']) ?? 0),
          unpackTimeFrames: self.msToLogicFrames(readNumericField(block.fields, ['UnpackTime']) ?? 0),
          packUnpackVariationFactor: readNumericField(block.fields, ['PackUnpackVariationFactor']) ?? 0,
          skipPackingWithNoTarget: readBooleanField(block.fields, ['SkipPackingWithNoTarget']) === true,
          effectDurationFrames: self.msToLogicFrames(readNumericField(block.fields, ['EffectDuration']) ?? 0),
          fleeRangeAfterCompletion: readNumericField(block.fields, ['FleeRangeAfterCompletion']) ?? 0,
          flipOwnerAfterPacking: readBooleanField(block.fields, ['FlipOwnerAfterPacking']) === true,
          flipOwnerAfterUnpacking: readBooleanField(block.fields, ['FlipOwnerAfterUnpacking']) === true,
          loseStealthOnTrigger: readBooleanField(block.fields, ['LoseStealthOnTrigger']) === true,
          preTriggerUnstealthFrames: self.msToLogicFrames(readNumericField(block.fields, ['PreTriggerUnstealthTime']) ?? 0),
          awardXPForTriggering: readNumericField(block.fields, ['AwardXPForTriggering']) ?? 0,
          specialObject: readStringField(block.fields, ['SpecialObject']) ?? null,
          specialObjectAttachToBone: readStringField(block.fields, ['SpecialObjectAttachToBone']) ?? null,
          maxSpecialObjects: readNumericField(block.fields, ['MaxSpecialObjects']) ?? 1,
          specialObjectsPersistent: readBooleanField(block.fields, ['SpecialObjectsPersistent']) === true,
          effectValue: readNumericField(block.fields, ['EffectValue']) ?? 1,
          uniqueSpecialObjectTargets: readBooleanField(block.fields, ['UniqueSpecialObjectTargets']) === true,
          specialObjectsPersistWhenOwnerDies: readBooleanField(block.fields, ['SpecialObjectsPersistWhenOwnerDies']) === true,
          alwaysValidateSpecialObjects: readBooleanField(block.fields, ['AlwaysValidateSpecialObjects']) === true,
        };
      }
    }
    if (block.blocks) {
      for (const child of block.blocks) visitBlock(child);
    }
  };
  if (objectDef.blocks) {
    for (const block of objectDef.blocks) visitBlock(block);
  }
  return profile;
}

export function extractGenerateMinefieldProfile(self: GL, objectDef: ObjectDef | undefined): GenerateMinefieldProfile | null {
  if (!objectDef) return null;
  let profile: GenerateMinefieldProfile | null = null;
  const visitBlock = (block: IniBlock): void => {
    if (profile) return;
    const blockType = block.type.toUpperCase();
    if (blockType === 'BEHAVIOR') {
      const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
      if (moduleType === 'GENERATEMINEFIELDBEHAVIOR') {
        const mineName = readStringField(block.fields, ['MineName']);
        if (!mineName) return;
        // Source parity: parsePercentToReal divides by 100.
        const randomJitterRaw = readNumericField(block.fields, ['RandomJitter']);
        const skipUnderRaw = readNumericField(block.fields, ['SkipIfThisMuchUnderStructure']);
        profile = {
          mineName,
          distanceAroundObject: readNumericField(block.fields, ['DistanceAroundObject']) ?? 20,
          borderOnly: readBooleanField(block.fields, ['BorderOnly']) ?? true,
          alwaysCircular: readBooleanField(block.fields, ['AlwaysCircular']) ?? false,
          generateOnlyOnDeath: readBooleanField(block.fields, ['GenerateOnlyOnDeath']) ?? false,
          minesPerSquareFoot: readNumericField(block.fields, ['MinesPerSquareFoot']) ?? 0.01,
          smartBorder: readBooleanField(block.fields, ['SmartBorder']) ?? false,
          smartBorderSkipInterior: readBooleanField(block.fields, ['SmartBorderSkipInterior']) ?? true,
          randomJitter: randomJitterRaw !== null && Number.isFinite(randomJitterRaw) ? randomJitterRaw / 100 : 0,
          skipIfThisMuchUnderStructure: skipUnderRaw !== null && Number.isFinite(skipUnderRaw) ? skipUnderRaw / 100 : 0.33,
        };
      }
    }
    if (block.blocks) {
      for (const child of block.blocks) visitBlock(child);
    }
  };
  if (objectDef.blocks) {
    for (const block of objectDef.blocks) visitBlock(block);
  }
  return profile;
}

export function extractCreateCrateDieProfile(self: GL, objectDef: ObjectDef | undefined): CreateCrateDieProfile | null {
  if (!objectDef) return null;
  let profile: CreateCrateDieProfile | null = null;
  const visitBlock = (block: IniBlock): void => {
    if (profile) return;
    const blockType = block.type.toUpperCase();
    if (blockType === 'BEHAVIOR') {
      const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
      if (moduleType === 'CREATECRATEDIE') {
        const crateTemplateName = readStringField(block.fields, ['CrateData']);
        if (crateTemplateName) {
          profile = { crateTemplateName };
        }
      }
    }
    if (block.blocks) {
      for (const child of block.blocks) visitBlock(child);
    }
  };
  if (objectDef.blocks) {
    for (const block of objectDef.blocks) visitBlock(block);
  }
  return profile;
}

export function extractSalvageCrateProfile(self: GL, objectDef: ObjectDef | undefined): SalvageCrateProfile | null {
  if (!objectDef) return null;
  let profile: SalvageCrateProfile | null = null;
  const visitBlock = (block: IniBlock): void => {
    if (profile) return;
    const blockType = block.type.toUpperCase();
    if (blockType === 'BEHAVIOR') {
      const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
      if (moduleType === 'SALVAGECRATECOLLIDE') {
        profile = {
          weaponChance: self.parsePercent(self.readIniFieldValue(block.fields, 'WeaponChance')) ?? 1.0,
          levelChance: self.parsePercent(self.readIniFieldValue(block.fields, 'LevelChance')) ?? 0.25,
          minMoney: readNumericField(block.fields, ['MinMoney']) ?? 25,
          maxMoney: readNumericField(block.fields, ['MaxMoney']) ?? 75,
        };
      }
    }
    if (block.blocks) {
      for (const child of block.blocks) visitBlock(child);
    }
  };
  if (objectDef.blocks) {
    for (const block of objectDef.blocks) visitBlock(block);
  }
  return profile;
}

export function extractCrateCollideProfile(self: GL, objectDef: ObjectDef | undefined): CrateCollideProfile | null {
  if (!objectDef) return null;
  let profile: CrateCollideProfile | null = null;
  const visitBlock = (block: IniBlock): void => {
    if (profile) return;
    const blockType = block.type.toUpperCase();
    if (blockType === 'BEHAVIOR') {
      const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
      let crateType: CrateCollideType | null = null;
      if (moduleType === 'HEALCRATECOLLIDE') crateType = 'HEAL';
      else if (moduleType === 'MONEYCRATECOLLIDE') crateType = 'MONEY';
      else if (moduleType === 'VETERANCYCRATECOLLIDE') crateType = 'VETERANCY';
      else if (moduleType === 'SHROUDCRATECOLLIDE') crateType = 'SHROUD';
      else if (moduleType === 'UNITCRATECOLLIDE') crateType = 'UNIT';
      if (crateType !== null) {
        // Parse base CrateCollide fields.
        const requiredKindOf = self.parseKindOf(block.fields['RequiredKindOf'] ?? block.fields['KindOf']);
        const forbiddenKindOf = self.parseKindOf(block.fields['ForbiddenKindOf'] ?? block.fields['KindOfNot']);
        profile = {
          crateType,
          requiredKindOf,
          forbiddenKindOf,
          forbidOwnerPlayer: readBooleanField(block.fields, ['ForbidOwnerPlayer']) ?? false,
          buildingPickup: readBooleanField(block.fields, ['BuildingPickup']) ?? false,
          humanOnly: readBooleanField(block.fields, ['HumanOnly']) ?? false,
          moneyProvided: readNumericField(block.fields, ['MoneyProvided']) ?? 0,
          unitType: readStringField(block.fields, ['UnitName']) ?? '',
          unitCount: readNumericField(block.fields, ['UnitCount']) ?? 1,
          veterancyRange: readNumericField(block.fields, ['EffectRange']) ?? 0,
          addsOwnerVeterancy: readBooleanField(block.fields, ['AddsOwnerVeterancy']) ?? false,
          isPilot: readBooleanField(block.fields, ['IsPilot']) ?? false,
        };
      }
    }
    if (block.blocks) {
      for (const child of block.blocks) visitBlock(child);
    }
  };
  if (objectDef.blocks) {
    for (const block of objectDef.blocks) visitBlock(block);
  }
  return profile;
}

export function extractDeployStyleProfile(self: GL, objectDef: ObjectDef | undefined): DeployStyleProfile | null {
  if (!objectDef) return null;
  let profile: DeployStyleProfile | null = null;
  const visitBlock = (block: IniBlock): void => {
    if (profile) return;
    const blockType = block.type.toUpperCase();
    if (blockType === 'BEHAVIOR') {
      const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
      if (moduleType === 'DEPLOYSTYLEAIUPDATE') {
        const unpackMs = readNumericField(block.fields, ['UnpackTime']) ?? 0;
        const packMs = readNumericField(block.fields, ['PackTime']) ?? 0;
        profile = {
          unpackTimeFrames: self.msToLogicFrames(unpackMs),
          packTimeFrames: self.msToLogicFrames(packMs),
          turretsFunctionOnlyWhenDeployed:
            readBooleanField(block.fields, ['TurretsFunctionOnlyWhenDeployed']) ?? false,
        };
      }
    }
    if (block.blocks) {
      for (const child of block.blocks) visitBlock(child);
    }
  };
  if (objectDef.blocks) {
    for (const block of objectDef.blocks) visitBlock(block);
  }
  return profile;
}

export function extractBattlePlanProfile(self: GL, objectDef: ObjectDef | undefined): BattlePlanProfile | null {
  if (!objectDef) return null;
  let profile: BattlePlanProfile | null = null;
  const visitBlock = (block: IniBlock): void => {
    if (profile) return;
    const blockType = block.type.toUpperCase();
    if (blockType === 'BEHAVIOR') {
      const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
      if (moduleType === 'BATTLEPLANUPDATE') {
        const bombardmentMs = readNumericField(block.fields, ['BombardmentPlanAnimationTime']) ?? 2000;
        const holdTheLineMs = readNumericField(block.fields, ['HoldTheLinePlanAnimationTime']) ?? 2000;
        const searchAndDestroyMs = readNumericField(block.fields, ['SearchAndDestroyPlanAnimationTime']) ?? 2000;
        const transitionIdleMs = readNumericField(block.fields, ['TransitionIdleTime']) ?? 3000;
        const paralyzeMs = readNumericField(block.fields, ['BattlePlanChangeParalyzeTime']) ?? 2000;

        const validKindOf = readStringField(block.fields, ['ValidMemberKindOf']) ?? '';
        const invalidKindOf = readStringField(block.fields, ['InvalidMemberKindOf']) ?? '';

        profile = {
          specialPowerTemplateName: (readStringField(block.fields, ['SpecialPowerTemplate']) ?? '').trim().toUpperCase(),
          bombardmentAnimationFrames: self.msToLogicFrames(bombardmentMs),
          holdTheLineAnimationFrames: self.msToLogicFrames(holdTheLineMs),
          searchAndDestroyAnimationFrames: self.msToLogicFrames(searchAndDestroyMs),
          transitionIdleFrames: self.msToLogicFrames(transitionIdleMs),
          battlePlanParalyzeFrames: self.msToLogicFrames(paralyzeMs),
          holdTheLineArmorDamageScalar:
            readNumericField(block.fields, ['HoldTheLinePlanArmorDamageScalar']) ?? 1.0,
          searchAndDestroySightRangeScalar:
            readNumericField(block.fields, ['SearchAndDestroyPlanSightRangeScalar']) ?? 1.0,
          strategyCenterSearchAndDestroySightRangeScalar:
            readNumericField(block.fields, ['StrategyCenterSearchAndDestroySightRangeScalar']) ?? 1.0,
          strategyCenterSearchAndDestroyDetectsStealth:
            readBooleanField(block.fields, ['StrategyCenterSearchAndDestroyDetectsStealth']) ?? false,
          strategyCenterHoldTheLineMaxHealthScalar:
            readNumericField(block.fields, ['StrategyCenterHoldTheLineMaxHealthScalar']) ?? 1.0,
          validMemberKindOf: new Set(
            validKindOf.split(/\s+/).map((t) => t.trim().toUpperCase()).filter(Boolean),
          ),
          invalidMemberKindOf: new Set(
            invalidKindOf.split(/\s+/).map((t) => t.trim().toUpperCase()).filter(Boolean),
          ),
        };
      }
    }
    if (block.blocks) {
      for (const child of block.blocks) visitBlock(child);
    }
  };
  if (objectDef.blocks) {
    for (const block of objectDef.blocks) visitBlock(block);
  }
  return profile;
}

export function extractHeightDieProfile(self: GL, objectDef: ObjectDef | undefined): HeightDieProfile | null {
  if (!objectDef) return null;
  let profile: HeightDieProfile | null = null;
  const visitBlock = (block: IniBlock): void => {
    if (profile) return;
    if (block.type.toUpperCase() === 'BEHAVIOR') {
      const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
      if (moduleType === 'HEIGHTDIEUPDATE') {
        profile = {
          targetHeight: readNumericField(block.fields, ['TargetHeight']) ?? 0,
          onlyWhenMovingDown: (readStringField(block.fields, ['OnlyWhenMovingDown'])?.toUpperCase() === 'YES'),
          targetHeightIncludesStructures: (readStringField(block.fields, ['TargetHeightIncludesStructures'])?.toUpperCase() === 'YES'),
          snapToGroundOnDeath: (readStringField(block.fields, ['SnapToGroundOnDeath'])?.toUpperCase() === 'YES'),
          initialDelayFrames: self.msToLogicFrames(readNumericField(block.fields, ['InitialDelay']) ?? 0),
        };
      }
    }
    if (block.blocks) {
      for (const child of block.blocks) visitBlock(child);
    }
  };
  if (objectDef.blocks) {
    for (const block of objectDef.blocks) visitBlock(block);
  }
  return profile;
}

export function extractProjectileStreamProfile(self: GL, objectDef: ObjectDef | undefined): ProjectileStreamProfile | null {
  if (!objectDef?.blocks) return null;
  for (const block of objectDef.blocks) {
    const blockType = block.type.toUpperCase();
    if ((blockType === 'BEHAVIOR' || blockType === 'CLIENTUPDATE')
        && block.name.toUpperCase().includes('PROJECTILESTREAMUPDATE')) {
      return { enabled: true };
    }
  }
  return null;
}

export function extractBoneFXProfile(self: GL, objectDef: ObjectDef | undefined): BoneFXProfile | null {
  if (!objectDef) return null;

  let profile: BoneFXProfile | null = null;

  const damageStateNames = ['Pristine', 'Damaged', 'ReallyDamaged', 'Rubble'];
  const effectTypes = [
    { prefix: 'FXList', target: 'fxLists' as const },
    { prefix: 'OCL', target: 'oclLists' as const },
    { prefix: 'ParticleSystem', target: 'particleSystems' as const },
  ];

  const visitBlock = (block: IniBlock): void => {
    if (profile !== null) return;
    const blockType = block.type.toUpperCase();
    if (blockType === 'BEHAVIOR' || blockType === 'CLIENTUPDATE') {
      const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
      if (moduleType === 'BONEFXUPDATE') {
        // Initialize empty profile: 4 damage states x 8 bone slots
        const numStates = 4;
        const numBones = 8;
        const makeGrid = (): (BoneFXEntry | null)[][] => {
          const grid: (BoneFXEntry | null)[][] = [];
          for (let i = 0; i < numStates; i++) {
            grid.push(new Array(numBones).fill(null));
          }
          return grid;
        };

        const fxLists = makeGrid();
        const oclLists = makeGrid();
        const particleSystems = makeGrid();

        for (const [fieldName, fieldValue] of Object.entries(block.fields)) {
          if (typeof fieldValue !== 'string') continue;
          const upperFieldName = fieldName.toUpperCase();

          for (let stateIdx = 0; stateIdx < numStates; stateIdx++) {
            const stateName = damageStateNames[stateIdx]!.toUpperCase();
            for (const eff of effectTypes) {
              const prefix = stateName + eff.prefix.toUpperCase();
              if (upperFieldName.startsWith(prefix)) {
                const indexStr = upperFieldName.slice(prefix.length);
                const boneIndex = parseInt(indexStr, 10) - 1; // 1-based → 0-based
                if (boneIndex < 0 || boneIndex >= numBones || isNaN(boneIndex)) continue;

                const entry = self.parseBoneFXFieldValue(fieldValue);
                if (entry) {
                  const target =
                    eff.target === 'fxLists' ? fxLists :
                    eff.target === 'oclLists' ? oclLists :
                    particleSystems;
                  target[stateIdx]![boneIndex] = entry;
                }
              }
            }
          }
        }

        // Only create profile if at least one entry was parsed.
        let hasEntry = false;
        outer:
        for (const grid of [fxLists, oclLists, particleSystems]) {
          for (const row of grid) {
            for (const cell of row) {
              if (cell !== null) { hasEntry = true; break outer; }
            }
          }
        }

        if (hasEntry) {
          profile = { fxLists, oclLists, particleSystems };
        }
      }
    }
  };

  if (objectDef.blocks) {
    for (const block of objectDef.blocks) {
      visitBlock(block);
    }
  }
  return profile;
}

export function extractSlowDeathProfiles(self: GL, objectDef: ObjectDef | undefined): SlowDeathProfile[] {
  if (!objectDef) return [];
  const profiles: SlowDeathProfile[] = [];
  const phaseNames = ['INITIAL', 'MIDPOINT', 'FINAL'] as const;

  const visitBlock = (block: IniBlock): void => {
    const blockType = block.type.toUpperCase();
    if (blockType === 'BEHAVIOR' || blockType === 'DIE') {
      const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
      if (moduleType.includes('SLOWDEATH') || moduleType === 'HELICOPTERSLOWDEATHBEHAVIOR'
          || moduleType === 'JETSLOWDEATHBEHAVIOR') {
        // Parse DeathTypes set.
        const deathTypes = new Set<string>();
        const deathTypesStr = readStringField(block.fields, ['DeathTypes']);
        if (deathTypesStr) {
          for (const token of deathTypesStr.toUpperCase().split(/\s+/)) {
            if (token) deathTypes.add(token);
          }
        }

        // Parse VeterancyLevels set.
        const veterancyLevels = new Set<string>();
        const vetStr = readStringField(block.fields, ['VeterancyLevels']);
        if (vetStr) {
          for (const token of vetStr.toUpperCase().split(/\s+/)) {
            if (token) veterancyLevels.add(token);
          }
        }

        // Parse ExemptStatus / RequiredStatus.
        const exemptStatus = new Set<string>();
        const exemptStr = readStringField(block.fields, ['ExemptStatus']);
        if (exemptStr) {
          for (const token of exemptStr.toUpperCase().split(/\s+/)) {
            if (token) exemptStatus.add(token);
          }
        }
        const requiredStatus = new Set<string>();
        const reqStr = readStringField(block.fields, ['RequiredStatus']);
        if (reqStr) {
          for (const token of reqStr.toUpperCase().split(/\s+/)) {
            if (token) requiredStatus.add(token);
          }
        }

        // Parse phase-specific OCLs and Weapons.
        // INI format: "OCL INITIAL OCLName" or "Weapon MIDPOINT WeaponName"
        // Fields can appear multiple times — INI parser stores as string or string[].
        const phaseOCLs: [string[], string[], string[]] = [[], [], []];
        const phaseWeapons: [string[], string[], string[]] = [[], [], []];

        const parsePhaseEntries = (fieldName: string, target: [string[], string[], string[]]): void => {
          const raw = block.fields[fieldName];
          const entries: string[] = [];
          if (typeof raw === 'string') {
            entries.push(raw);
          } else if (Array.isArray(raw)) {
            for (const entry of raw) {
              if (typeof entry === 'string') entries.push(entry);
            }
          }
          for (const entry of entries) {
            const parts = entry.trim().split(/\s+/);
            if (parts.length >= 2) {
              const phaseIdx = phaseNames.indexOf(parts[0]!.toUpperCase() as typeof phaseNames[number]);
              const name = parts[parts.length - 1]!;
              if (phaseIdx >= 0 && name) {
                target[phaseIdx]!.push(name);
              }
            } else if (parts.length === 1 && parts[0]) {
              target[0]!.push(parts[0]);
            }
          }
        };
        parsePhaseEntries('OCL', phaseOCLs);
        parsePhaseEntries('Weapon', phaseWeapons);

        profiles.push({
          probabilityModifier: readNumericField(block.fields, ['ProbabilityModifier']) ?? 10,
          modifierBonusPerOverkillPercent: readNumericField(block.fields, ['ModifierBonusPerOverkillPercent']) ?? 0,
          sinkDelay: self.msToLogicFrames(readNumericField(block.fields, ['SinkDelay']) ?? 0),
          sinkDelayVariance: self.msToLogicFrames(readNumericField(block.fields, ['SinkDelayVariance']) ?? 0),
          sinkRate: (readNumericField(block.fields, ['SinkRate']) ?? 0) / LOGIC_FRAME_RATE,
          destructionDelay: self.msToLogicFrames(readNumericField(block.fields, ['DestructionDelay']) ?? 0),
          destructionDelayVariance: self.msToLogicFrames(readNumericField(block.fields, ['DestructionDelayVariance']) ?? 0),
          destructionAltitude: readNumericField(block.fields, ['DestructionAltitude']) ?? -10,
          flingForce: readNumericField(block.fields, ['FlingForce']) ?? 0,
          flingForceVariance: readNumericField(block.fields, ['FlingForceVariance']) ?? 0,
          flingPitch: (readNumericField(block.fields, ['FlingPitch']) ?? 0) * Math.PI / 180,
          flingPitchVariance: (readNumericField(block.fields, ['FlingPitchVariance']) ?? 0) * Math.PI / 180,
          isBattleBus: moduleType === 'BATTLEBUSSLOWDEATHBEHAVIOR',
          throwForce: readNumericField(block.fields, ['ThrowForce']) ?? 200,
          percentDamageToPassengers: readNumericField(block.fields, ['PercentDamageToPassengers']) ?? 50,
          emptyHulkDestructionDelayFrames: self.msToLogicFrames(readNumericField(block.fields, ['EmptyHulkDestructionDelay']) ?? 0),
          deathTypes,
          veterancyLevels,
          exemptStatus,
          requiredStatus,
          phaseOCLs,
          phaseWeapons,
        });
      }
    }
    if (block.blocks) {
      for (const child of block.blocks) visitBlock(child);
    }
  };
  if (objectDef.blocks) {
    for (const block of objectDef.blocks) visitBlock(block);
  }
  return profiles;
}

export function extractHelicopterSlowDeathProfiles(self: GL, objectDef: ObjectDef | undefined): HelicopterSlowDeathProfile[] {
  if (!objectDef) return [];
  const profiles: HelicopterSlowDeathProfile[] = [];

  const visitBlock = (block: IniBlock): void => {
    const blockType = block.type.toUpperCase();
    if (blockType !== 'BEHAVIOR' && blockType !== 'DIE') return;
    const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
    if (moduleType !== 'HELICOPTERSLOWDEATHBEHAVIOR') return;

    // DieMuxData fields.
    const deathTypes = new Set<string>();
    const deathTypesStr = readStringField(block.fields, ['DeathTypes']);
    if (deathTypesStr) {
      for (const token of deathTypesStr.toUpperCase().split(/\s+/)) {
        if (token) deathTypes.add(token);
      }
    }
    const veterancyLevels = new Set<string>();
    const vetStr = readStringField(block.fields, ['VeterancyLevels']);
    if (vetStr) {
      for (const token of vetStr.toUpperCase().split(/\s+/)) {
        if (token) veterancyLevels.add(token);
      }
    }
    const exemptStatus = new Set<string>();
    const exemptStr = readStringField(block.fields, ['ExemptStatus']);
    if (exemptStr) {
      for (const token of exemptStr.toUpperCase().split(/\s+/)) {
        if (token) exemptStatus.add(token);
      }
    }
    const requiredStatus = new Set<string>();
    const reqStr = readStringField(block.fields, ['RequiredStatus']);
    if (reqStr) {
      for (const token of reqStr.toUpperCase().split(/\s+/)) {
        if (token) requiredStatus.add(token);
      }
    }

    // C++ parseAngularVelocityReal: degrees/sec → radians/frame.
    const degPerSecToRadPerFrame = (v: number): number => (v * Math.PI / 180) / LOGIC_FRAME_RATE;
    // C++ parseVelocityReal: units/sec → units/frame.
    const unitsPerSecToPerFrame = (v: number): number => v / LOGIC_FRAME_RATE;

    // Helicopter-specific fields.
    const spiralOrbitTurnRate = degPerSecToRadPerFrame(
      readNumericField(block.fields, ['SpiralOrbitTurnRate']) ?? 0);
    const spiralOrbitForwardSpeed = unitsPerSecToPerFrame(
      readNumericField(block.fields, ['SpiralOrbitForwardSpeed']) ?? 0);
    const spiralOrbitForwardSpeedDamping =
      readNumericField(block.fields, ['SpiralOrbitForwardSpeedDamping']) ?? 1.0;
    const minSelfSpin = degPerSecToRadPerFrame(
      readNumericField(block.fields, ['MinSelfSpin']) ?? 0);
    const maxSelfSpin = degPerSecToRadPerFrame(
      readNumericField(block.fields, ['MaxSelfSpin']) ?? 0);
    const selfSpinUpdateDelay = self.msToLogicFrames(
      readNumericField(block.fields, ['SelfSpinUpdateDelay']) ?? 0);
    // parseAngleReal: degrees → radians, then divided by FPS in update.
    const selfSpinUpdateAmount = (readNumericField(block.fields, ['SelfSpinUpdateAmount']) ?? 0)
      * Math.PI / 180;
    // parsePercentToReal: percentage → 0-1.
    const fallHowFast = (readNumericField(block.fields, ['FallHowFast']) ?? 50) / 100;
    // C++ parseAccelerationReal: dist/sec² → dist/frame² (÷ LOGIC_FRAME_RATE²).
    // C++ default: m_maxBraking = 99999.0f (already in frame units after parse).
    const maxBrakingRaw = readNumericField(block.fields, ['MaxBraking']);
    const maxBraking = maxBrakingRaw != null
      ? maxBrakingRaw / (LOGIC_FRAME_RATE * LOGIC_FRAME_RATE)
      : 99999.0;
    const delayFromGroundToFinalDeath = self.msToLogicFrames(
      readNumericField(block.fields, ['DelayFromGroundToFinalDeath']) ?? 0);

    // OCL references.
    const oclHitGround: string[] = [];
    const hitGroundStr = readStringField(block.fields, ['OCLHitGround']);
    if (hitGroundStr) oclHitGround.push(hitGroundStr);
    const oclFinalBlowUp: string[] = [];
    const finalStr = readStringField(block.fields, ['OCLFinalBlowUp']);
    if (finalStr) oclFinalBlowUp.push(finalStr);

    const finalRubbleObject = readStringField(block.fields, ['FinalRubbleObject']) ?? '';
    // C++ parseAsciiString: blade debris template name and bone name.
    const bladeObjectName = readStringField(block.fields, ['BladeObjectName']) ?? '';
    const bladeBoneName = readStringField(block.fields, ['BladeBoneName']) ?? '';

    // C++ parseDurationReal: ms → logic frames. Blade fly-off delay range.
    const minBladeFlyOffDelay = self.msToLogicFrames(
      readNumericField(block.fields, ['MinBladeFlyOffDelay']) ?? 0);
    const maxBladeFlyOffDelay = self.msToLogicFrames(
      readNumericField(block.fields, ['MaxBladeFlyOffDelay']) ?? 0);

    // Particle system attachment fields.
    const attachParticle = readStringField(block.fields, ['AttachParticle']) ?? null;
    const attachParticleBone = readStringField(block.fields, ['AttachParticleBone']) ?? '';
    const attachParticleLoc = readCoord3DField(block.fields, ['AttachParticleLoc']) ?? { x: 0, y: 0, z: 0 };

    // OCL/FX pointer fields (NULL default in C++).
    const oclEjectPilot = readStringField(block.fields, ['OCLEjectPilot']) ?? null;
    const fxBlade = readStringField(block.fields, ['FXBlade']) ?? null;
    const oclBlade = readStringField(block.fields, ['OCLBlade']) ?? null;
    const fxHitGround = readStringField(block.fields, ['FXHitGround']) ?? null;
    const fxFinalBlowUp = readStringField(block.fields, ['FXFinalBlowUp']) ?? null;

    // C++ parseAudioEventRTS: looping death sound.
    const soundDeathLoop = readStringField(block.fields, ['SoundDeathLoop']) ?? null;

    profiles.push({
      deathTypes,
      veterancyLevels,
      exemptStatus,
      requiredStatus,
      spiralOrbitTurnRate,
      spiralOrbitForwardSpeed,
      spiralOrbitForwardSpeedDamping,
      minSelfSpin,
      maxSelfSpin,
      selfSpinUpdateDelay,
      selfSpinUpdateAmount,
      fallHowFast,
      maxBraking,
      delayFromGroundToFinalDeath,
      oclHitGround,
      oclFinalBlowUp,
      finalRubbleObject,
      bladeObjectName,
      bladeBoneName,
      minBladeFlyOffDelay,
      maxBladeFlyOffDelay,
      attachParticle,
      attachParticleBone,
      attachParticleLoc,
      oclEjectPilot,
      fxBlade,
      oclBlade,
      fxHitGround,
      fxFinalBlowUp,
      soundDeathLoop,
    });
  };

  for (const block of objectDef.blocks) visitBlock(block);
  if (profiles.length === 0 && self.resolveObjectDefParent(objectDef)) {
    for (const block of self.resolveObjectDefParent(objectDef)?.blocks ?? []) visitBlock(block);
  }
  return profiles;
}

export function extractCleanupHazardProfile(self: GL, objectDef: ObjectDef | undefined): CleanupHazardProfile | null {
  if (!objectDef) return null;
  for (const block of objectDef.blocks) {
    const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
    if (moduleType !== 'CLEANUPHAZARDUPDATE') continue;
    const weaponSlotStr = readStringField(block.fields, ['WeaponSlot'])?.toUpperCase() ?? 'PRIMARY';
    const weaponSlot = weaponSlotStr === 'SECONDARY' ? 'SECONDARY' : weaponSlotStr === 'TERTIARY' ? 'TERTIARY' : 'PRIMARY';
    const scanFrames = self.msToLogicFrames(readNumericField(block.fields, ['ScanRate']) ?? 0);
    const scanRange = readNumericField(block.fields, ['ScanRange']) ?? 0;
    return { weaponSlot, scanFrames, scanRange };
  }
  if (self.resolveObjectDefParent(objectDef)) {
    return extractCleanupHazardProfile(self, self.resolveObjectDefParent(objectDef));
  }
  return null;
}

export function extractAssistedTargetingProfile(self: GL, objectDef: ObjectDef | undefined): AssistedTargetingProfile | null {
  if (!objectDef) return null;
  for (const block of objectDef.blocks) {
    const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
    if (moduleType !== 'ASSISTEDTARGETINGUPDATE') continue;
    const clipSize = readNumericField(block.fields, ['AssistingClipSize']) ?? 1;
    const weaponSlotStr = readStringField(block.fields, ['AssistingWeaponSlot'])?.toUpperCase() ?? 'PRIMARY';
    const weaponSlot = weaponSlotStr === 'SECONDARY' ? 'SECONDARY' : weaponSlotStr === 'TERTIARY' ? 'TERTIARY' : 'PRIMARY';
    const laserFromAssisted = readStringField(block.fields, ['LaserFromAssisted']) ?? '';
    const laserToTarget = readStringField(block.fields, ['LaserToTarget']) ?? '';
    return { clipSize, weaponSlot, laserFromAssisted, laserToTarget };
  }
  if (self.resolveObjectDefParent(objectDef)) {
    return extractAssistedTargetingProfile(self, self.resolveObjectDefParent(objectDef));
  }
  return null;
}

export function extractStructureCollapseProfile(self: GL, objectDef: ObjectDef | undefined): StructureCollapseProfile | null {
  if (!objectDef) return null;
  let profile: StructureCollapseProfile | null = null;

  const scPhaseNames = ['INITIAL', 'DELAY', 'BURST', 'FINAL'] as const;

  const visitBlock = (block: IniBlock): void => {
    const blockType = block.type.toUpperCase();
    if (blockType === 'BEHAVIOR' || blockType === 'UPDATE') {
      const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
      if (moduleType === 'STRUCTURECOLLAPSEUPDATE') {
        // Parse DieMuxData fields.
        const deathTypes = new Set<string>();
        const deathTypesStr = readStringField(block.fields, ['DeathTypes']);
        if (deathTypesStr) {
          for (const token of deathTypesStr.toUpperCase().split(/\s+/)) {
            if (token) deathTypes.add(token);
          }
        }
        const veterancyLevels = new Set<string>();
        const vetStr = readStringField(block.fields, ['VeterancyLevels']);
        if (vetStr) {
          for (const token of vetStr.toUpperCase().split(/\s+/)) {
            if (token) veterancyLevels.add(token);
          }
        }
        const exemptStatus = new Set<string>();
        const exemptStr = readStringField(block.fields, ['ExemptStatus']);
        if (exemptStr) {
          for (const token of exemptStr.toUpperCase().split(/\s+/)) {
            if (token) exemptStatus.add(token);
          }
        }
        const requiredStatus = new Set<string>();
        const reqStr = readStringField(block.fields, ['RequiredStatus']);
        if (reqStr) {
          for (const token of reqStr.toUpperCase().split(/\s+/)) {
            if (token) requiredStatus.add(token);
          }
        }

        // Parse phase OCLs: "OCL INITIAL SomeOCLName AnotherOCL"
        const phaseOCLs: [string[], string[], string[], string[]] = [[], [], [], []];
        const rawOCL = block.fields['OCL'];
        const oclEntries: string[] = [];
        if (typeof rawOCL === 'string') {
          oclEntries.push(rawOCL);
        } else if (Array.isArray(rawOCL)) {
          for (const e of rawOCL) {
            if (typeof e === 'string') oclEntries.push(e);
          }
        }
        for (const entry of oclEntries) {
          const parts = entry.trim().split(/\s+/);
          if (parts.length >= 2) {
            const phaseIdx = scPhaseNames.indexOf(parts[0]!.toUpperCase() as typeof scPhaseNames[number]);
            if (phaseIdx >= 0) {
              // All subsequent tokens are OCL names for this phase.
              for (let i = 1; i < parts.length; i++) {
                if (parts[i]) phaseOCLs[phaseIdx]!.push(parts[i]!);
              }
            }
          }
        }

        profile = {
          deathTypes,
          veterancyLevels,
          exemptStatus,
          requiredStatus,
          minCollapseDelay: self.msToLogicFrames(readNumericField(block.fields, ['MinCollapseDelay']) ?? 0),
          maxCollapseDelay: self.msToLogicFrames(readNumericField(block.fields, ['MaxCollapseDelay']) ?? 0),
          minBurstDelay: self.msToLogicFrames(readNumericField(block.fields, ['MinBurstDelay']) ?? 9999),
          maxBurstDelay: self.msToLogicFrames(readNumericField(block.fields, ['MaxBurstDelay']) ?? 9999),
          collapseDamping: readNumericField(block.fields, ['CollapseDamping']) ?? 0.0,
          bigBurstFrequency: readNumericField(block.fields, ['BigBurstFrequency']) ?? 0,
          maxShudder: readNumericField(block.fields, ['MaxShudder']) ?? 0,
          phaseOCLs,
        };
      }
    }
    if (block.blocks) {
      for (const child of block.blocks) visitBlock(child);
    }
  };
  if (objectDef.blocks) {
    for (const block of objectDef.blocks) visitBlock(block);
  }
  return profile;
}

export function extractEmpUpdateProfile(self: GL, objectDef: ObjectDef | undefined): EMPUpdateProfile | null {
  if (!objectDef) return null;
  let profile: EMPUpdateProfile | null = null;
  const visitBlock = (block: IniBlock): void => {
    const blockType = block.type.toUpperCase();
    if (blockType !== 'BEHAVIOR' && blockType !== 'UPDATE') return;
    const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
    if (moduleType !== 'EMPUPDATE') return;

    const victimRequiredKindOf = new Set<string>();
    const victimForbiddenKindOf = new Set<string>();
    const victimReqRaw = readStringField(block.fields, ['VictimRequiredKindOf']);
    if (victimReqRaw) {
      for (const token of victimReqRaw.trim().split(/\s+/)) {
        if (token) victimRequiredKindOf.add(token.toUpperCase());
      }
    }
    const victimForbidRaw = readStringField(block.fields, ['VictimForbiddenKindOf']);
    if (victimForbidRaw) {
      for (const token of victimForbidRaw.trim().split(/\s+/)) {
        if (token) victimForbiddenKindOf.add(token.toUpperCase());
      }
    }

    profile = {
      lifetimeFrames: self.msToLogicFrames(readNumericField(block.fields, ['Lifetime']) ?? 33),
      startFadeFrame: self.msToLogicFrames(readNumericField(block.fields, ['StartFadeTime']) ?? 0),
      disabledDurationFrames: self.msToLogicFrames(readNumericField(block.fields, ['DisabledDuration']) ?? 0),
      effectRadius: readNumericField(block.fields, ['EffectRadius']) ?? 200.0,
      doesNotAffectMyOwnBuildings: readStringField(block.fields, ['DoesNotAffectMyOwnBuildings'])?.toUpperCase() === 'YES',
      victimRequiredKindOf,
      victimForbiddenKindOf,
    };
  };
  for (const block of objectDef.blocks) visitBlock(block);
  if (self.resolveObjectDefParent(objectDef)) {
    for (const block of self.resolveObjectDefParent(objectDef)?.blocks ?? []) visitBlock(block);
  }
  return profile;
}

export function extractHijackerUpdateProfile(self: GL, objectDef: ObjectDef | undefined): HijackerUpdateProfile | null {
  if (!objectDef) return null;
  let profile: HijackerUpdateProfile | null = null;
  const visitBlock = (block: IniBlock): void => {
    const blockType = block.type.toUpperCase();
    if (blockType !== 'BEHAVIOR' && blockType !== 'UPDATE') return;
    const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
    if (moduleType !== 'HIJACKERUPDATE') return;
    profile = {
      parachuteName: readStringField(block.fields, ['ParachuteName']) ?? null,
    };
  };
  for (const block of objectDef.blocks) visitBlock(block);
  if (self.resolveObjectDefParent(objectDef)) {
    for (const block of self.resolveObjectDefParent(objectDef)?.blocks ?? []) visitBlock(block);
  }
  return profile;
}

export function extractLeafletDropProfile(self: GL, objectDef: ObjectDef | undefined): LeafletDropProfile | null {
  if (!objectDef) return null;
  let profile: LeafletDropProfile | null = null;
  const visitBlock = (block: IniBlock): void => {
    const blockType = block.type.toUpperCase();
    if (blockType !== 'BEHAVIOR' && blockType !== 'UPDATE') return;
    const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
    if (moduleType !== 'LEAFLETDROPBEHAVIOR') return;
    profile = {
      delayFrames: self.msToLogicFrames(readNumericField(block.fields, ['Delay']) ?? 33),
      disabledDurationFrames: self.msToLogicFrames(readNumericField(block.fields, ['DisabledDuration']) ?? 0),
      affectRadius: readNumericField(block.fields, ['AffectRadius']) ?? 60.0,
    };
  };
  for (const block of objectDef.blocks) visitBlock(block);
  if (self.resolveObjectDefParent(objectDef)) {
    for (const block of self.resolveObjectDefParent(objectDef)?.blocks ?? []) visitBlock(block);
  }
  return profile;
}

export function extractSmartBombProfile(self: GL, objectDef: ObjectDef | undefined): SmartBombTargetHomingProfile | null {
  if (!objectDef) return null;
  let profile: SmartBombTargetHomingProfile | null = null;
  const visitBlock = (block: IniBlock): void => {
    const blockType = block.type.toUpperCase();
    if (blockType !== 'BEHAVIOR' && blockType !== 'UPDATE') return;
    const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
    if (moduleType !== 'SMARTBOMBTARGETHOMINGUPDATE') return;
    profile = {
      courseCorrectionScalar: readNumericField(block.fields, ['CourseCorrectionScalar']) ?? 0.99,
    };
  };
  for (const block of objectDef.blocks) visitBlock(block);
  if (self.resolveObjectDefParent(objectDef)) {
    for (const block of self.resolveObjectDefParent(objectDef)?.blocks ?? []) visitBlock(block);
  }
  return profile;
}

export function extractDynamicGeometryProfile(self: GL, objectDef: ObjectDef | undefined): DynamicGeometryInfoUpdateProfile | null {
  if (!objectDef) return null;
  let profile: DynamicGeometryInfoUpdateProfile | null = null;
  const visitBlock = (block: IniBlock): void => {
    const blockType = block.type.toUpperCase();
    if (blockType !== 'BEHAVIOR' && blockType !== 'UPDATE') return;
    const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
    if (moduleType !== 'DYNAMICGEOMETRYINFOUPDATE' && moduleType !== 'FIRESTORMDYNAMICGEOMETRYINFOUPDATE') return;
    profile = {
      initialDelayFrames: self.msToLogicFrames(readNumericField(block.fields, ['InitialDelay']) ?? 0),
      initialHeight: readNumericField(block.fields, ['InitialHeight']) ?? 0,
      initialMajorRadius: readNumericField(block.fields, ['InitialMajorRadius']) ?? 0,
      initialMinorRadius: readNumericField(block.fields, ['InitialMinorRadius']) ?? 0,
      finalHeight: readNumericField(block.fields, ['FinalHeight']) ?? 0,
      finalMajorRadius: readNumericField(block.fields, ['FinalMajorRadius']) ?? 0,
      finalMinorRadius: readNumericField(block.fields, ['FinalMinorRadius']) ?? 0,
      transitionTimeFrames: self.msToLogicFrames(readNumericField(block.fields, ['TransitionTime']) ?? 1),
      reverseAtTransitionTime: (readStringField(block.fields, ['ReverseAtTransitionTime']) ?? '').toUpperCase() === 'YES',
    };
  };
  for (const block of objectDef.blocks) visitBlock(block);
  if (self.resolveObjectDefParent(objectDef)) {
    for (const block of self.resolveObjectDefParent(objectDef)?.blocks ?? []) visitBlock(block);
  }
  return profile;
}

export function extractFirestormDamageProfile(self: GL, objectDef: ObjectDef | undefined): FirestormDamageProfile | null {
  if (!objectDef) return null;
  let profile: FirestormDamageProfile | null = null;
  const visitBlock = (block: IniBlock): void => {
    if (profile) return;
    const blockType = block.type.toUpperCase();
    if (blockType !== 'BEHAVIOR' && blockType !== 'UPDATE') return;
    const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
    if (moduleType !== 'FIRESTORMDYNAMICGEOMETRYINFOUPDATE') return;
    profile = {
      damageAmount: readNumericField(block.fields, ['DamageAmount']) ?? 0,
      delayBetweenDamageFrames: self.msToLogicFrames(readNumericField(block.fields, ['DelayBetweenDamageFrames']) ?? 0),
      maxHeightForDamage: readNumericField(block.fields, ['MaxHeightForDamage']) ?? 20.0,
    };
  };
  for (const block of objectDef.blocks) visitBlock(block);
  if (!profile && self.resolveObjectDefParent(objectDef)) {
    for (const block of self.resolveObjectDefParent(objectDef)?.blocks ?? []) visitBlock(block);
  }
  return profile;
}

export function extractFireOCLAfterCooldownProfiles(self: GL, objectDef: ObjectDef | undefined): FireOCLAfterWeaponCooldownProfile[] {
  if (!objectDef) return [];
  const profiles: FireOCLAfterWeaponCooldownProfile[] = [];
  const visitBlock = (block: IniBlock): void => {
    const blockType = block.type.toUpperCase();
    if (blockType !== 'BEHAVIOR' && blockType !== 'UPDATE') return;
    const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
    if (moduleType !== 'FIREOCLAFTERWEAPONCOOLDOWNUPDATE') return;
    const slotStr = (readStringField(block.fields, ['WeaponSlot']) ?? 'PRIMARY').toUpperCase();
    const slot = slotStr === 'SECONDARY' ? 1 : slotStr === 'TERTIARY' ? 2 : 0;
    profiles.push({
      weaponSlot: slot,
      oclName: readStringField(block.fields, ['OCL']) ?? '',
      minShotsRequired: readNumericField(block.fields, ['MinShotsToCreateOCL']) ?? 1,
      oclLifetimePerSecond: readNumericField(block.fields, ['OCLLifetimePerSecond']) ?? 1000,
      oclMaxFrames: self.msToLogicFrames(readNumericField(block.fields, ['OCLLifetimeMaxCap']) ?? 33333),
    });
  };
  for (const block of objectDef.blocks) visitBlock(block);
  if (self.resolveObjectDefParent(objectDef)) {
    for (const block of self.resolveObjectDefParent(objectDef)?.blocks ?? []) visitBlock(block);
  }
  return profiles;
}

export function extractNeutronBlastProfile(self: GL, objectDef: ObjectDef | undefined): NeutronBlastProfile | null {
  if (!objectDef) return null;
  let profile: NeutronBlastProfile | null = null;
  const visitBlock = (block: IniBlock): void => {
    if (profile) return;
    const blockType = block.type.toUpperCase();
    if (blockType !== 'BEHAVIOR' && blockType !== 'UPDATE') return;
    const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
    if (moduleType !== 'NEUTRONBLASTBEHAVIOR') return;
    profile = {
      blastRadius: readNumericField(block.fields, ['BlastRadius']) ?? 10.0,
      affectAirborne: (readStringField(block.fields, ['AffectAirborne']) ?? 'Yes').toUpperCase() !== 'NO',
      affectAllies: (readStringField(block.fields, ['AffectAllies']) ?? 'Yes').toUpperCase() !== 'NO',
    };
  };
  for (const block of objectDef.blocks) visitBlock(block);
  if (!profile && self.resolveObjectDefParent(objectDef)) {
    for (const block of self.resolveObjectDefParent(objectDef)?.blocks ?? []) visitBlock(block);
  }
  return profile;
}

export function extractBunkerBusterProfile(self: GL, objectDef: ObjectDef | undefined): BunkerBusterProfile | null {
  if (!objectDef) return null;
  let profile: BunkerBusterProfile | null = null;
  const visitBlock = (block: IniBlock): void => {
    if (profile) return;
    const blockType = block.type.toUpperCase();
    if (blockType !== 'BEHAVIOR' && blockType !== 'UPDATE') return;
    const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
    if (moduleType !== 'BUNKERBUSTERBEHAVIOR') return;
    profile = {
      upgradeRequired: (readStringField(block.fields, ['UpgradeRequired']) ?? '').trim().toUpperCase(),
      occupantDamageWeaponName: (readStringField(block.fields, ['OccupantDamageWeaponTemplate']) ?? '').trim(),
      shockwaveWeaponName: (readStringField(block.fields, ['ShockwaveWeaponTemplate']) ?? '').trim(),
    };
  };
  for (const block of objectDef.blocks) visitBlock(block);
  if (!profile && self.resolveObjectDefParent(objectDef)) {
    for (const block of self.resolveObjectDefParent(objectDef)?.blocks ?? []) visitBlock(block);
  }
  return profile;
}

export function extractNeutronMissileSlowDeathProfile(self: GL, objectDef: ObjectDef | undefined): NeutronMissileSlowDeathProfile | null {
  if (!objectDef) return null;
  let profile: NeutronMissileSlowDeathProfile | null = null;
  const visitBlock = (block: IniBlock): void => {
    if (profile) return;
    const blockType = block.type.toUpperCase();
    if (blockType !== 'BEHAVIOR' && blockType !== 'DIE' && blockType !== 'UPDATE') return;
    const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
    if (moduleType !== 'NEUTRONMISSILESLOWDEATHBEHAVIOR') return;
    const blasts: NeutronMissileBlastInfo[] = [];
    // Source parity: MAX_NEUTRON_BLASTS = 9 (indices 1-9 in INI).
    for (let i = 1; i <= 9; i++) {
      const prefix = `Blast${i}`;
      const enabled = (readStringField(block.fields, [`${prefix}Enabled`]) ?? 'No').toUpperCase() === 'YES';
      blasts.push({
        enabled,
        delay: self.msToLogicFrames(readNumericField(block.fields, [`${prefix}Delay`]) ?? 0),
        scorchDelay: self.msToLogicFrames(readNumericField(block.fields, [`${prefix}ScorchDelay`]) ?? 0),
        innerRadius: readNumericField(block.fields, [`${prefix}InnerRadius`]) ?? 0,
        outerRadius: readNumericField(block.fields, [`${prefix}OuterRadius`]) ?? 0,
        maxDamage: readNumericField(block.fields, [`${prefix}MaxDamage`]) ?? 0,
        minDamage: readNumericField(block.fields, [`${prefix}MinDamage`]) ?? 0,
        toppleSpeed: readNumericField(block.fields, [`${prefix}ToppleSpeed`]) ?? 0,
      });
    }
    profile = { blasts };
  };
  for (const block of objectDef.blocks) visitBlock(block);
  if (!profile && self.resolveObjectDefParent(objectDef)) {
    for (const block of self.resolveObjectDefParent(objectDef)?.blocks ?? []) visitBlock(block);
  }
  return profile;
}

export function extractTechBuildingProfile(self: GL, objectDef: ObjectDef | undefined): TechBuildingBehaviorProfile | null {
  if (!objectDef) return null;
  let profile: TechBuildingBehaviorProfile | null = null;
  const visitBlock = (block: IniBlock): void => {
    if (profile) return;
    const blockType = block.type.toUpperCase();
    if (blockType !== 'BEHAVIOR' && blockType !== 'UPDATE') return;
    const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
    if (moduleType !== 'TECHBUILDINGBEHAVIOR') return;
    profile = {
      pulseFXRateFrames: self.msToLogicFrames(readNumericField(block.fields, ['PulseFXRate']) ?? 0),
    };
  };
  for (const block of objectDef.blocks) visitBlock(block);
  if (!profile && self.resolveObjectDefParent(objectDef)) {
    for (const block of self.resolveObjectDefParent(objectDef)?.blocks ?? []) visitBlock(block);
  }
  return profile;
}

export function extractSupplyWarehouseCripplingProfile(self: GL, objectDef: ObjectDef | undefined): SupplyWarehouseCripplingProfile | null {
  if (!objectDef) return null;
  let profile: SupplyWarehouseCripplingProfile | null = null;
  const visitBlock = (block: IniBlock): void => {
    if (profile) return;
    const blockType = block.type.toUpperCase();
    if (blockType !== 'BEHAVIOR' && blockType !== 'UPDATE') return;
    const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
    if (moduleType !== 'SUPPLYWAREHOUSECRIPPLINGBEHAVIOR') return;
    profile = {
      selfHealSuppressionFrames: self.msToLogicFrames(readNumericField(block.fields, ['SelfHealSupression']) ?? 0),
      selfHealDelayFrames: self.msToLogicFrames(readNumericField(block.fields, ['SelfHealDelay']) ?? 0),
      selfHealAmount: readNumericField(block.fields, ['SelfHealAmount']) ?? 0,
    };
  };
  for (const block of objectDef.blocks) visitBlock(block);
  if (!profile && self.resolveObjectDefParent(objectDef)) {
    for (const block of self.resolveObjectDefParent(objectDef)?.blocks ?? []) visitBlock(block);
  }
  return profile;
}

export function extractInstantDeathProfiles(self: GL, objectDef: ObjectDef | undefined): InstantDeathProfile[] {
  if (!objectDef) return [];
  const profiles: InstantDeathProfile[] = [];

  const visitBlock = (block: IniBlock): void => {
    const blockType = block.type.toUpperCase();
    if (blockType === 'BEHAVIOR' || blockType === 'DIE') {
      const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
      if (moduleType === 'INSTANTDEATHBEHAVIOR' || moduleType === 'DESTROYDIE') {
        // Parse DieMuxData fields.
        const deathTypes = new Set<string>();
        const deathTypesStr = readStringField(block.fields, ['DeathTypes']);
        if (deathTypesStr) {
          for (const token of deathTypesStr.toUpperCase().split(/\s+/)) {
            if (token) deathTypes.add(token);
          }
        }

        const veterancyLevels = new Set<string>();
        const vetStr = readStringField(block.fields, ['VeterancyLevels']);
        if (vetStr) {
          for (const token of vetStr.toUpperCase().split(/\s+/)) {
            if (token) veterancyLevels.add(token);
          }
        }

        const exemptStatus = new Set<string>();
        const exemptStr = readStringField(block.fields, ['ExemptStatus']);
        if (exemptStr) {
          for (const token of exemptStr.toUpperCase().split(/\s+/)) {
            if (token) exemptStatus.add(token);
          }
        }

        const requiredStatus = new Set<string>();
        const reqStr = readStringField(block.fields, ['RequiredStatus']);
        if (reqStr) {
          for (const token of reqStr.toUpperCase().split(/\s+/)) {
            if (token) requiredStatus.add(token);
          }
        }

        // Parse effect lists (Weapon, OCL — space-separated or multi-valued).
        const weaponNames: string[] = [];
        const weaponRaw = block.fields['Weapon'];
        if (typeof weaponRaw === 'string') {
          const name = weaponRaw.trim();
          if (name) weaponNames.push(name);
        } else if (Array.isArray(weaponRaw)) {
          for (const entry of weaponRaw) {
            const name = typeof entry === 'string' ? entry.trim() : '';
            if (name) weaponNames.push(name);
          }
        }

        const oclNames: string[] = [];
        const oclRaw = block.fields['OCL'];
        if (typeof oclRaw === 'string') {
          const name = oclRaw.trim();
          if (name) oclNames.push(name);
        } else if (Array.isArray(oclRaw)) {
          for (const entry of oclRaw) {
            const name = typeof entry === 'string' ? entry.trim() : '';
            if (name) oclNames.push(name);
          }
        }

        profiles.push({
          deathTypes,
          veterancyLevels,
          exemptStatus,
          requiredStatus,
          weaponNames,
          oclNames,
        });
      }
    }
    if (block.blocks) {
      for (const child of block.blocks) visitBlock(child);
    }
  };
  if (objectDef.blocks) {
    for (const block of objectDef.blocks) visitBlock(block);
  }
  return profiles;
}

export function extractFireWeaponWhenDeadProfiles(self: GL, objectDef: ObjectDef | undefined): FireWeaponWhenDeadProfile[] {
  if (!objectDef) return [];
  const profiles: FireWeaponWhenDeadProfile[] = [];

  const visitBlock = (block: IniBlock): void => {
    const blockType = block.type.toUpperCase();
    if (blockType === 'BEHAVIOR' || blockType === 'DIE') {
      const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
      if (moduleType === 'FIREWEAPONWHENDEADBEHAVIOR') {
        // Parse DieMuxData fields.
        const deathTypes = new Set<string>();
        const deathTypesStr = readStringField(block.fields, ['DeathTypes']);
        if (deathTypesStr) {
          for (const token of deathTypesStr.toUpperCase().split(/\s+/)) {
            if (token) deathTypes.add(token);
          }
        }

        const veterancyLevels = new Set<string>();
        const vetStr = readStringField(block.fields, ['VeterancyLevels']);
        if (vetStr) {
          for (const token of vetStr.toUpperCase().split(/\s+/)) {
            if (token) veterancyLevels.add(token);
          }
        }

        const exemptStatus = new Set<string>();
        const exemptStr = readStringField(block.fields, ['ExemptStatus']);
        if (exemptStr) {
          for (const token of exemptStr.toUpperCase().split(/\s+/)) {
            if (token) exemptStatus.add(token);
          }
        }

        const requiredStatus = new Set<string>();
        const reqStr = readStringField(block.fields, ['RequiredStatus']);
        if (reqStr) {
          for (const token of reqStr.toUpperCase().split(/\s+/)) {
            if (token) requiredStatus.add(token);
          }
        }

        const deathWeaponName = readStringField(block.fields, ['DeathWeapon']) ?? '';
        // Source parity: C++ UpgradeMuxData::m_initiallyActive defaults to false.
        const startsActive = readBooleanField(block.fields, ['StartsActive']) ?? false;

        const triggeredBy: string[] = [];
        const triggeredByStr = readStringField(block.fields, ['TriggeredBy']);
        if (triggeredByStr) {
          for (const token of triggeredByStr.split(/\s+/)) {
            if (token) triggeredBy.push(token);
          }
        }

        const conflictsWith: string[] = [];
        const conflictsStr = readStringField(block.fields, ['ConflictsWith']);
        if (conflictsStr) {
          for (const token of conflictsStr.split(/\s+/)) {
            if (token) conflictsWith.push(token);
          }
        }

        if (deathWeaponName) {
          profiles.push({
            deathTypes,
            veterancyLevels,
            exemptStatus,
            requiredStatus,
            deathWeaponName,
            startsActive,
            triggeredBy,
            conflictsWith,
          });
        }
      }
    }
    if (block.blocks) {
      for (const child of block.blocks) visitBlock(child);
    }
  };
  if (objectDef.blocks) {
    for (const block of objectDef.blocks) visitBlock(block);
  }
  return profiles;
}

export function extractMinefieldProfile(self: GL, objectDef: ObjectDef | undefined): MinefieldProfile | null {
  if (!objectDef) return null;
  let profile: MinefieldProfile | null = null;
  const visitBlock = (block: IniBlock): void => {
    if (profile !== null) return;
    if (block.type.toUpperCase() === 'BEHAVIOR') {
      const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
      if (moduleType === 'MINEFIELDBEHAVIOR') {
        // Parse DetonatedBy relationship mask.
        let detonatedByMask = MINE_DEFAULT_DETONATED_BY;
        const detonatedByStr = readStringField(block.fields, ['DetonatedBy'])?.toUpperCase();
        if (detonatedByStr) {
          detonatedByMask = 0;
          if (detonatedByStr.includes('ALLIES')) detonatedByMask |= MINE_DETONATED_BY_ALLIES;
          if (detonatedByStr.includes('ENEMIES')) detonatedByMask |= MINE_DETONATED_BY_ENEMIES;
          if (detonatedByStr.includes('NEUTRAL')) detonatedByMask |= MINE_DETONATED_BY_NEUTRAL;
        }

        profile = {
          detonationWeaponName: readStringField(block.fields, ['DetonationWeapon']) ?? null,
          detonatedByMask,
          numVirtualMines: readNumericField(block.fields, ['NumVirtualMines']) ?? 1,
          regenerates: readBooleanField(block.fields, ['Regenerates']) ?? false,
          workersDetonate: readBooleanField(block.fields, ['WorkersDetonate']) ?? false,
          repeatDetonateMoveThresh: readNumericField(block.fields, ['RepeatDetonateMoveThresh']) ?? 1.0,
          stopsRegenAfterCreatorDies: readBooleanField(block.fields, ['StopsRegenAfterCreatorDies']) ?? true,
          degenPercentPerSecondAfterCreatorDies: readNumericField(block.fields, ['DegenPercentPerSecondAfterCreatorDies']) ?? 0,
          scootFromStartingPointTimeFrames: self.msToLogicFrames(readNumericField(block.fields, ['ScootFromStartingPointTime']) ?? 0),
        };
      }
    }
    if (block.blocks) {
      for (const child of block.blocks) visitBlock(child);
    }
  };
  if (objectDef.blocks) {
    for (const block of objectDef.blocks) visitBlock(block);
  }
  return profile;
}

export function extractEjectPilotTemplateName(self: GL, objectDef: ObjectDef | undefined): string | null {
  if (!objectDef) return null;
  let pilotName: string | null = null;
  const visitBlock = (block: IniBlock): void => {
    if (pilotName !== null) return;
    const blockType = block.type.toUpperCase();
    if (blockType === 'BEHAVIOR' || blockType === 'DIE') {
      const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
      if (moduleType === 'EJECTPILOTDIE' || moduleType === 'HELICOPTERSLOWDEATHBEHAVIOR') {
        // Look for OCLEjectPilot or CreationList fields that reference an OCL containing the pilot
        const oclName = readStringField(block.fields, ['GroundCreationList', 'AirCreationList', 'OCLEjectPilot']);
        if (oclName) {
          // Resolve the OCL to find the pilot unit template name.
          // For now, use a convention-based approach:
          // Most EjectPilot OCLs create an infantry pilot unit like 'AmericaPilot' or 'ChinaPilot'.
          pilotName = oclName;
        }
      }
    }
    if (block.blocks) {
      for (const child of block.blocks) visitBlock(child);
    }
  };
  if (objectDef.blocks) {
    for (const block of objectDef.blocks) visitBlock(block);
  }
  return pilotName;
}


export function extractPowerPlantUpdateProfile(self: GL, objectDef: ObjectDef | undefined): PowerPlantUpdateProfile | null {
  if (!objectDef) return null;
  let profile: PowerPlantUpdateProfile | null = null;
  for (const block of objectDef.blocks) {
    if (profile) break;
    const blockType = block.type.toUpperCase();
    if (blockType !== 'BEHAVIOR') continue;
    const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
    if (moduleType !== 'POWERPLANTUPDATE') continue;
    profile = {
      rodsExtendTimeFrames: self.msToLogicFrames(readNumericField(block.fields, ['RodsExtendTime']) ?? 0),
    };
  }
  return profile;
}

export function extractUpgradeModules(self: GL, objectDef: ObjectDef | undefined): UpgradeModuleProfile[] {
  if (!objectDef) {
    return [];
  }

  return extractUpgradeModulesFromBlocks(self, objectDef.blocks);
}

export function extractSpecialPowerModules(self: GL, objectDef: ObjectDef | undefined): Map<string, SpecialPowerModuleProfile> {
  const specialPowerModules = new Map<string, SpecialPowerModuleProfile>();
  if (!objectDef) {
    return specialPowerModules;
  }

  const visitBlock = (block: IniBlock): void => {
    if (block.type.toUpperCase() === 'BEHAVIOR') {
      const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
      if (!SPECIAL_POWER_BEHAVIOR_MODULE_TYPES.has(moduleType)) {
        for (const child of block.blocks) {
          visitBlock(child);
        }
        return;
      }
      const specialPowerTemplate = readStringField(block.fields, ['SpecialPowerTemplate']);
      if (specialPowerTemplate) {
        const normalizedSpecialPowerTemplate = specialPowerTemplate.trim().toUpperCase();
        if (normalizedSpecialPowerTemplate && normalizedSpecialPowerTemplate !== 'NONE') {
          specialPowerModules.set(normalizedSpecialPowerTemplate, {
            specialPowerTemplateName: normalizedSpecialPowerTemplate,
            moduleType,
            updateModuleStartsAttack: readBooleanField(block.fields, ['UpdateModuleStartsAttack']) === true,
            startsPaused: readBooleanField(block.fields, ['StartsPaused']) === true,
            // Source parity: read module-specific INI parameters.
            cashHackMoneyAmount: readNumericField(block.fields, ['MoneyAmount']) ?? 0,
            cashBountyPercent: readNumericField(block.fields, ['Bounty']) ?? 0,
            spyVisionBaseDurationMs: readNumericField(block.fields, ['BaseDuration']) ?? 0,
            fireWeaponMaxShots: readNumericField(block.fields, ['MaxShotsToFire']) ?? 1,
            cleanupMoveRange: readNumericField(block.fields, ['MaxMoveDistanceFromLocation']) ?? 0,
            // Source parity: OCLSpecialPower OCL name.
            oclName: readStringField(block.fields, ['OCL']) ?? '',
            // NOTE: In the original engine, area damage/heal parameters live on weapon templates
            // spawned via OCL, not on the special power module itself. These field names are
            // forward-looking placeholders for OCL-less parameter passing; real game INI files
            // won't populate them (they'll fall through to DEFAULT_* constants).
            areaDamageRadius: readNumericField(block.fields, ['Radius', 'WeaponRadius', 'DamageRadius']) ?? 0,
            areaDamageAmount: readNumericField(block.fields, ['Damage', 'DamageAmount']) ?? 0,
            areaHealAmount: readNumericField(block.fields, ['HealAmount', 'RepairAmount']) ?? 0,
            areaHealRadius: readNumericField(block.fields, ['HealRange', 'HealRadius', 'RepairRange']) ?? 0,
            // Source parity: BaikonurLaunchPowerModuleData::m_detonationObject.
            detonationObjectName: readStringField(block.fields, ['DetonationObject']) ?? '',
          });
        }
      }
    }

    for (const child of block.blocks) {
      visitBlock(child);
    }
  };

  for (const block of objectDef.blocks) {
    visitBlock(block);
  }

  return specialPowerModules;
}

export function extractUpgradeModulesFromBlocks(self: GL, 
  blocks: IniBlock[] = [],
  sourceUpgradeName: string | null = null,
): UpgradeModuleProfile[] {
  return extractUpgradeModulesFromBlocksImpl(
    blocks,
    sourceUpgradeName,
    {
      parseUpgradeNames: (value) => self.parseUpgradeNames(value),
      parseObjectStatusNames: (value) => self.parseObjectStatusNames(value),
      parseKindOf: (value) => self.parseKindOf(value),
      parsePercent: (value) => self.parsePercent(value),
    },
  );
}

/**
 * Source parity: DumbProjectileBehaviorModuleData — extract all 13 FieldParse fields
 * from the DumbProjectileBehavior module block.
 * C++ file: DumbProjectileBehavior.cpp:82-103.
 */
export function extractDumbProjectileBehaviorProfile(self: GL, objectDef: ObjectDef | undefined): DumbProjectileBehaviorProfile | null {
  if (!objectDef) {
    return null;
  }

  let profile: DumbProjectileBehaviorProfile | null = null;
  const visitBlock = (block: IniBlock): void => {
    if (profile !== null) {
      return;
    }
    if (block.type.toUpperCase() === 'BEHAVIOR') {
      const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
      if (moduleType === 'DUMBPROJECTILEBEHAVIOR') {
        // Source parity: parseDurationUnsignedInt → ms to logic frames.
        const maxLifespanMs = readNumericField(block.fields, ['MaxLifespan']) ?? 0;
        const maxLifespan = maxLifespanMs > 0 ? self.msToLogicFrames(maxLifespanMs) : 0;

        // Source parity: parsePercentToReal — INI parser already stores as 0..1 fraction.
        const firstPercentIndent = readNumericField(block.fields, ['FirstPercentIndent']) ?? 0.30;
        const secondPercentIndent = readNumericField(block.fields, ['SecondPercentIndent']) ?? 0.70;

        // Source parity: parseVelocityReal — "distance per second" in INI, convert to per-frame.
        const flightPathAdjustRaw = readNumericField(block.fields, ['FlightPathAdjustDistPerSecond']) ?? 0;
        const flightPathAdjustDistPerFrame = flightPathAdjustRaw / LOGIC_FRAME_RATE;

        // Source parity: GarrisonHitKillRequiredKindOf / ForbiddenKindOf — space-separated KindOf tokens.
        const garrisonHitKillRequiredRaw = readStringField(block.fields, ['GarrisonHitKillRequiredKindOf']) ?? '';
        const garrisonHitKillForbiddenRaw = readStringField(block.fields, ['GarrisonHitKillForbiddenKindOf']) ?? '';
        const parseKindOfSet = (raw: string): Set<string> => {
          const tokens = raw.trim().split(/\s+/).filter(t => t.length > 0).map(t => t.toUpperCase());
          return new Set(tokens);
        };

        // Source parity: GarrisonHitKillFX — FXList name string.
        const garrisonHitKillFXRaw = readStringField(block.fields, ['GarrisonHitKillFX']);
        const garrisonHitKillFX = garrisonHitKillFXRaw && garrisonHitKillFXRaw.trim().length > 0
          ? garrisonHitKillFXRaw.trim()
          : null;

        profile = {
          maxLifespan,
          tumbleRandomly: readBooleanField(block.fields, ['TumbleRandomly']) ?? false,
          detonateCallsKill: readBooleanField(block.fields, ['DetonateCallsKill']) ?? PROJECTILE_DEFAULT_DETONATE_CALLS_KILL,
          orientToFlightPath: readBooleanField(block.fields, ['OrientToFlightPath']) ?? PROJECTILE_DEFAULT_ORIENT_TO_FLIGHT_PATH,
          firstHeight: readNumericField(block.fields, ['FirstHeight']) ?? 0,
          secondHeight: readNumericField(block.fields, ['SecondHeight']) ?? 0,
          firstPercentIndent,
          secondPercentIndent,
          garrisonHitKillRequiredKindOf: parseKindOfSet(garrisonHitKillRequiredRaw),
          garrisonHitKillForbiddenKindOf: parseKindOfSet(garrisonHitKillForbiddenRaw),
          garrisonHitKillCount: Math.max(0, Math.trunc(readNumericField(block.fields, ['GarrisonHitKillCount']) ?? 0)),
          garrisonHitKillFX,
          flightPathAdjustDistPerFrame,
        };
        return;
      }
    }
    for (const child of block.blocks) {
      visitBlock(child);
    }
  };

  for (const block of objectDef.blocks) {
    visitBlock(block);
  }

  return profile;
}

export function spawnEntityFromTemplate(self: GL,
  templateName: string,
  worldX: number,
  worldZ: number,
  rotationY: number,
  side?: string,
): MapEntity | null {
  const registry = self.iniDataRegistry;
  if (!registry) return null;
  const objectDef = findObjectDefByName(registry, templateName);
  if (!objectDef) return null;

  const mapObject: MapObjectJSON = {
    templateName: objectDef.name,
    angle: THREE.MathUtils.radToDeg(rotationY),
    flags: 0,
    position: { x: worldX, y: worldZ, z: 0 },
    properties: {},
  };
  const entity = createMapEntity(self, mapObject, objectDef, registry, self.mapHeightmap);
  if (side !== undefined) {
    entity.side = side;
  }
  // Inherit controlling player from side.
  if (side) {
    entity.controllingPlayerToken = self.normalizeControllingPlayerToken(side);
  }
  self.addEntityToWorld(entity);
  self.registerEntityEnergy(entity);
  self.initializeMinefieldState(entity);
  self.registerTunnelEntity(entity);
  // Snap to terrain.
  if (self.mapHeightmap) {
    entity.y = self.mapHeightmap.getInterpolatedHeight(worldX, worldZ) ?? 0;
  }
  return entity;
}
