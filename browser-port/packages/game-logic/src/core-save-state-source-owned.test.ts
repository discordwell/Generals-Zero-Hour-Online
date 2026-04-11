import * as THREE from 'three';
import { XferSave } from '@generals/engine';
import { describe, expect, it } from 'vitest';

import {
  ARMOR_SET_FLAG_MASK_BY_NAME,
  createEmptySourceMapEntitySaveState,
  GameLogicSubsystem,
} from './index.js';
import {
  makeBlock,
  makeBundle,
  makeCommandButtonDef,
  makeCommandSetDef,
  makeHeightmap,
  makeMap,
  makeMapObject,
  makeObjectDef,
  makeRegistry,
  makeSpecialPowerDef,
  makeUpgradeDef,
  makeWeaponDef,
} from './test-helpers.js';

function makeSourceOwnedCoreBundle() {
  return makeBundle({
    objects: [
      makeObjectDef('AmericaBarracks', 'America', ['STRUCTURE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
        makeBlock('Behavior', 'ProductionUpdate ModuleTag_Production', { MaxQueueEntries: 9 }),
      ]),
      makeObjectDef('AmericaRanger', 'America', ['INFANTRY'], [], { BuildCost: 225, BuildTime: 5 }),
      makeObjectDef('SupplyPile', 'Neutral', ['STRUCTURE'], [
        makeBlock('Behavior', 'SupplyWarehouseDockUpdate ModuleTag_Dock', {
          StartingBoxes: 50,
          NumberApproachPositions: 3,
        }),
      ]),
      makeObjectDef('RepairBay', 'Neutral', ['STRUCTURE'], [
        makeBlock('Behavior', 'RepairDockUpdate ModuleTag_Dock', {
          NumberApproachPositions: 2,
          TimeForFullHeal: 5000,
        }),
      ]),
      makeObjectDef('DroneSpawner', 'America', ['VEHICLE'], [
        makeBlock('Behavior', 'SpawnBehavior ModuleTag_Spawn', {
          SpawnNumber: 3,
          SpawnTemplateName: 'DroneA DroneB',
          OneShot: true,
          InitialBurst: 2,
          AggregateHealth: true,
        }),
      ]),
      makeObjectDef('DroneA', 'America', ['DRONE'], []),
      makeObjectDef('DroneB', 'America', ['DRONE'], []),
      makeObjectDef('SpecialPowerBuilding', 'America', ['STRUCTURE'], [
        makeBlock('Behavior', 'OCLSpecialPower ModuleTag_Bomb', {
          SpecialPowerTemplate: 'SuperweaponTest',
          OCL: 'OCL_TestBomb',
        }),
      ]),
      makeObjectDef('StealthUnit', 'GLA', ['VEHICLE'], [
        makeBlock('Behavior', 'StealthUpdate ModuleTag_Stealth', {
          StealthDelay: 2000,
          StealthForbiddenConditions: 'ATTACKING MOVING',
        }),
      ]),
      makeObjectDef('TransportBox', 'America', ['VEHICLE', 'TRANSPORT'], [
        makeBlock('Behavior', 'TransportContain ModuleTag_Contain', {
          Slots: 2,
          PassengersAllowedToFire: false,
        }),
      ]),
      makeObjectDef('GarrisonBunker', 'America', ['STRUCTURE'], [
        makeBlock('Behavior', 'GarrisonContain ModuleTag_Contain', {
          ContainMax: 2,
        }),
      ]),
      makeObjectDef('CaveNode', 'Neutral', ['STRUCTURE'], [
        makeBlock('Behavior', 'CaveContain ModuleTag_Contain', {
          ContainMax: 3,
          CaveIndex: 0,
        }),
      ]),
      makeObjectDef('SpyVisionBuilding', 'America', ['STRUCTURE'], [
        makeBlock('Behavior', 'SpyVisionSpecialPower ModuleTag_SpyPower', {
          SpecialPowerTemplate: 'SpyVisionPower',
          BaseDuration: 30000,
        }),
        makeBlock('Behavior', 'SpyVisionUpdate ModuleTag_SpyUpdate', {
          SpecialPowerTemplate: 'SpyVisionPower',
        }),
      ]),
      makeObjectDef('AbilityUnit', 'America', ['INFANTRY'], [
        makeBlock('Behavior', 'SpecialAbilityUpdate ModuleTag_Ability', {
          SpecialPowerTemplate: 'AbilityPower',
          PreparationTime: 1000,
          PackTime: 1000,
          UnpackTime: 1000,
        }),
      ]),
      makeObjectDef('StrategyCenter', 'America', ['STRUCTURE'], [
        makeBlock('Behavior', 'BattlePlanUpdate ModuleTag_BattlePlan', {
          SpecialPowerTemplate: 'BattlePlanPower',
          BombardmentPlanAnimationTime: 1000,
          HoldTheLinePlanAnimationTime: 1000,
          SearchAndDestroyPlanAnimationTime: 1000,
          TransitionIdleTime: 1000,
          BattlePlanChangeParalyzeTime: 1000,
          HoldTheLinePlanArmorDamageScalar: 0.75,
          SearchAndDestroyPlanSightRangeScalar: 1.5,
          ValidMemberKindOf: 'INFANTRY VEHICLE',
          InvalidMemberKindOf: 'AIRCRAFT',
        }),
      ]),
      makeObjectDef('SlavedDrone', 'America', ['DRONE'], [
        makeBlock('Behavior', 'SlavedUpdate ModuleTag_Slaved', {
          GuardMaxRange: 60,
          GuardWanderRange: 20,
          AttackRange: 120,
        }),
      ]),
      makeObjectDef('MobMember', 'GLA', ['INFANTRY'], [
        makeBlock('Behavior', 'MobMemberSlavedUpdate ModuleTag_MobSlave', {
          MustCatchUpRadius: 80,
          NoNeedToCatchUpRadius: 30,
          Squirrelliness: 0.5,
          CatchUpCrisisBailTime: 25,
        }),
      ]),
      makeObjectDef('AutoHealer', 'America', ['VEHICLE'], [
        makeBlock('Behavior', 'AutoHealBehavior ModuleTag_AutoHeal', {
          StartsActive: true,
          HealingAmount: 10,
          HealingDelay: 1000,
          StartHealingDelay: 500,
        }),
      ]),
      makeObjectDef('PoisonableUnit', 'GLA', ['INFANTRY'], [
        makeBlock('Behavior', 'PoisonedBehavior ModuleTag_Poisoned', {
          PoisonDamageInterval: 1000,
          PoisonDuration: 3000,
        }),
      ]),
      makeObjectDef('MinefieldObject', 'GLA', ['IMMOBILE'], [
        makeBlock('Behavior', 'MinefieldBehavior ModuleTag_Minefield', {
          NumVirtualMines: 5,
          Regenerates: true,
          StopsRegenAfterCreatorDies: true,
          DegenPercentPerSecondAfterCreatorDies: 10,
        }),
      ]),
      makeObjectDef('AutoFireObject', 'GLA', ['STRUCTURE'], [
        makeBlock('Behavior', 'FireWeaponUpdate ModuleTag_AutoFire', {
          Weapon: 'AutoFireWeapon',
        }),
      ]),
      makeObjectDef('PowerPlantObject', 'America', ['STRUCTURE'], [
        makeBlock('Behavior', 'PowerPlantUpdate ModuleTag_PowerPlant', {
          RodsExtendTime: 1000,
        }),
        makeBlock('Behavior', 'OverchargeBehavior ModuleTag_Overcharge', {
          HealthPercentToDrainPerSecond: '5%',
          NotAllowedWhenHealthBelowPercent: '25%',
        }),
      ]),
      makeObjectDef('OclEmitterObject', 'America', ['STRUCTURE'], [
        makeBlock('Behavior', 'OCLUpdate ModuleTag_OCL', {
          OCL: 'OCL_Test',
          MinDelay: 1000,
          MaxDelay: 1000,
        }),
      ]),
      makeObjectDef('WeaponBonusAuraObject', 'GLA', ['STRUCTURE'], [
        makeBlock('Behavior', 'WeaponBonusUpdate ModuleTag_WeaponBonus', {
          BonusConditionType: 'FANATICISM',
          BonusDuration: 1000,
          BonusDelay: 500,
          BonusRange: 100,
        }),
      ]),
      makeObjectDef('CollideFireObject', 'GLA', ['STRUCTURE'], [
        makeBlock('Behavior', 'FireWeaponCollide ModuleTag_CollideFire', {
          CollideWeapon: 'CollideFireWeapon',
          FireOnce: true,
        }),
      ]),
      makeObjectDef('ProjectileStreamObject', 'GLA', ['PROJECTILE'], [
        makeBlock('ClientUpdate', 'ProjectileStreamUpdate ModuleTag_Stream', {}),
      ]),
      makeObjectDef('BoneFxObject', 'GLA', ['STRUCTURE'], [
        makeBlock('Behavior', 'BoneFXUpdate ModuleTag_BoneFX', {
          PristineFXList1: 'Bone:BONE01 OnlyOnce:No 1000 2000 FXList:FX_TestBone',
        }),
      ]),
      makeObjectDef('DeployStyleUnit', 'GLA', ['VEHICLE'], [
        makeBlock('Behavior', 'DeployStyleAIUpdate ModuleTag_Deploy', {
          UnpackTime: 1000,
          PackTime: 1000,
        }),
      ]),
      makeObjectDef('AssaultTransportObject', 'China', ['VEHICLE'], [
        makeBlock('Behavior', 'TransportContain ModuleTag_Contain', {
          ContainMax: 8,
        }),
        makeBlock('Behavior', 'AssaultTransportAIUpdate ModuleTag_AssaultAI', {
          MembersGetHealedAtLifeRatio: 0.3,
          ClearRangeRequiredToContinueAttackMove: 50,
        }),
      ]),
      makeObjectDef('SupplyTruckObject', 'China', ['VEHICLE'], [
        makeBlock('Behavior', 'SupplyTruckAIUpdate ModuleTag_SupplyTruckAI', {
          MaxBoxes: 5,
          SupplyCenterActionDelay: 1000,
          SupplyWarehouseActionDelay: 1000,
        }),
      ]),
      makeObjectDef('DefaultExitStructure', 'America', ['STRUCTURE'], [
        makeBlock('Behavior', 'DefaultProductionExitUpdate ModuleTag_DefaultExit', {
          UnitCreatePoint: 'X:0 Y:0 Z:0',
          NaturalRallyPoint: 'X:10 Y:0 Z:20',
        }),
      ]),
      makeObjectDef('QueueExitStructure', 'America', ['STRUCTURE'], [
        makeBlock('Behavior', 'QueueProductionExitUpdate ModuleTag_QueueExit', {
          UnitCreatePoint: 'X:0 Y:0 Z:0',
          NaturalRallyPoint: 'X:10 Y:0 Z:20',
          ExitDelay: 1000,
          InitialBurst: 2,
        }),
      ]),
      makeObjectDef('SpawnPointExitStructure', 'America', ['STRUCTURE'], [
        makeBlock('Behavior', 'SpawnPointProductionExitUpdate ModuleTag_SpawnExit', {
          SpawnPointBoneName: 'SpawnPoint',
        }),
      ]),
      makeObjectDef('PointDefenseObject', 'America', ['VEHICLE'], [
        makeBlock('Behavior', 'PointDefenseLaserUpdate ModuleTag_PDL', {
          WeaponTemplate: 'PDLWeapon',
          PrimaryTargetTypes: 'SMALL_MISSILE',
          SecondaryTargetTypes: 'BALLISTIC_MISSILE',
          ScanRate: 1000,
          ScanRange: 300,
        }),
      ]),
      makeObjectDef('FloatObject', 'America', ['VEHICLE'], [
        makeBlock('Behavior', 'FloatUpdate ModuleTag_Float', {
          Enabled: false,
        }),
      ]),
      makeObjectDef('PilotUnit', 'America', ['INFANTRY'], [
        makeBlock('Behavior', 'PilotFindVehicleUpdate ModuleTag_Pilot', {
          ScanRate: 500,
          ScanRange: 200,
          MinHealth: 0.4,
        }),
      ]),
      makeObjectDef('RadarStructure', 'America', ['STRUCTURE'], [
        makeBlock('Behavior', 'RadarUpdate ModuleTag_Radar', {
          RadarExtendTime: 1000,
        }),
      ]),
      makeObjectDef('LeafletObject', 'America', ['PROJECTILE'], [
        makeBlock('Behavior', 'LeafletDropBehavior ModuleTag_Leaflet', {
          Delay: 1000,
          DisabledDuration: 3000,
          AffectRadius: 60,
        }),
      ]),
      makeObjectDef('HijackerUnit', 'GLA', ['INFANTRY'], [
        makeBlock('Behavior', 'HijackerUpdate ModuleTag_Hijacker', {
          ParachuteName: 'ParachuteContainer',
        }),
      ]),
      makeObjectDef('SpectreCommandCenter', 'America', ['STRUCTURE'], [
        makeBlock('Behavior', 'SpectreGunshipDeploymentUpdate ModuleTag_SpectreDeploy', {
          SpecialPowerTemplate: 'SpectrePower',
          GunshipTemplateName: 'SpectreGunshipObject',
          AttackAreaRadius: 200,
          GunshipOrbitRadius: 250,
        }),
      ]),
      makeObjectDef('SpectreGunshipObject', 'America', ['AIRCRAFT'], [
        makeBlock('Behavior', 'SpectreGunshipUpdate ModuleTag_Spectre', {
          SpecialPowerTemplate: 'SpectrePower',
          AttackAreaRadius: 200,
          TargetingReticleRadius: 25,
          GunshipOrbitRadius: 250,
          StrafingIncrement: 20,
          OrbitInsertionSlope: 0.7,
          OrbitTime: 3000,
          HowitzerFiringRate: 333,
          HowitzerFollowLag: 0,
          RandomOffsetForHowitzer: 20,
          HowitzerWeaponTemplate: 'PDLWeapon',
          GattlingTemplateName: 'SpectreGattling',
        }),
      ]),
      makeObjectDef('SpectreGattling', 'America', ['VEHICLE'], []),
      makeObjectDef('NeutronMissileObject', 'China', ['PROJECTILE'], [
        makeBlock('Behavior', 'NeutronMissileUpdate ModuleTag_Neutron', {
          DistanceToTravelBeforeTurning: 100,
          MaxTurnRate: 120,
          ForwardDamping: 0.2,
          RelativeSpeed: 3,
          TargetFromDirectlyAbove: 150,
          SpecialAccelFactor: 1.25,
          SpecialSpeedTime: 1000,
          SpecialSpeedHeight: 200,
          DeliveryDecalRadius: 80,
          SpecialJitterDistance: 10,
        }),
      ]),
      makeObjectDef('ScudStormObject', 'GLA', ['STRUCTURE'], [
        makeBlock('Behavior', 'MissileLauncherBuildingUpdate ModuleTag_MissileLauncher', {
          SpecialPowerTemplate: 'ScudStormPower',
          DoorOpenTime: 1000,
          DoorWaitOpenTime: 2000,
          DoorCloseTime: 1000,
        }),
      ]),
      makeObjectDef('ParticleCannonObject', 'America', ['STRUCTURE'], [
        makeBlock('Behavior', 'ParticleUplinkCannonUpdate ModuleTag_ParticleUplink', {
          SpecialPowerTemplate: 'ParticleCannonPower',
          BeginChargeTime: 1000,
          RaiseAntennaTime: 1000,
          ReadyDelayTime: 1000,
          WidthGrowTime: 1000,
          BeamTravelTime: 1000,
          TotalFiringTime: 3000,
          TotalScorchMarks: 4,
          TotalDamagePulses: 3,
          DamagePerSecond: 100,
          DamageType: 'LASER',
          DamageRadiusScalar: 1,
          RevealRange: 50,
          SwathOfDeathDistance: 100,
          SwathOfDeathAmplitude: 20,
          DelayBetweenLaunchFX: 500,
          ManualDrivingSpeed: 30,
          ManualFastDrivingSpeed: 60,
          DoubleClickToFastDriveDelay: 500,
        }),
      ]),
      makeObjectDef('ToppleTree', 'Neutral', ['SHRUBBERY'], [
        makeBlock('Behavior', 'ToppleUpdate ModuleTag_Topple', {
          InitialVelocityPercent: '20%',
          InitialAccelPercent: '10%',
          BounceVelocityPercent: '30%',
          KillWhenFinishedToppling: false,
        }),
      ]),
      makeObjectDef('ToppleStructure', 'GLA', ['STRUCTURE'], [
        makeBlock('Behavior', 'StructureToppleUpdate ModuleTag_ToppleStructure', {
          MinToppleDelay: 1000,
          MaxToppleDelay: 1000,
          MinToppleBurstDelay: 200,
          MaxToppleBurstDelay: 200,
          StructuralIntegrity: 0.6,
          StructuralDecay: 0.95,
          CrushingWeaponName: 'PDLWeapon',
        }),
      ]),
      makeObjectDef('HealingSeeker', 'America', ['INFANTRY'], [
        makeBlock('Behavior', 'AutoFindHealingUpdate ModuleTag_AutoFindHealing', {
          ScanRate: 500,
          ScanRange: 200,
          NeverHeal: 0.95,
          AlwaysHeal: 0.25,
        }),
      ]),
      makeObjectDef('BaseRegenStructure', 'America', ['STRUCTURE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 300 }),
        makeBlock('Behavior', 'BaseRegenerateUpdate ModuleTag_BaseRegen', {}),
      ]),
      makeObjectDef('AutoDepositStructure', 'America', ['STRUCTURE'], [
        makeBlock('Behavior', 'AutoDepositUpdate ModuleTag_AutoDeposit', {
          DepositTiming: 2000,
          DepositAmount: 20,
          InitialCaptureBonus: 100,
        }),
      ]),
      makeObjectDef('FireSpreader', 'America', ['STRUCTURE'], [
        makeBlock('Behavior', 'FireSpreadUpdate ModuleTag_FireSpread', {
          MinSpreadDelay: 1000,
          MaxSpreadDelay: 1000,
          SpreadTryRange: 50,
        }),
      ]),
      makeObjectDef('FlammableObject', 'America', ['STRUCTURE'], [
        makeBlock('Behavior', 'FlammableUpdate ModuleTag_Flammable', {
          BurnedDelay: 1000,
          AflameDuration: 3000,
          AflameDamageDelay: 500,
          AflameDamageAmount: 2,
          FlameDamageLimit: 20,
          FlameDamageExpiration: 2000,
        }),
      ]),
      makeObjectDef('CommandHunter', 'America', ['VEHICLE'], [
        makeBlock('Behavior', 'CommandButtonHuntUpdate ModuleTag_Hunt', {
          ScanRate: 1000,
          ScanRange: 300,
        }),
      ], { CommandSet: 'CommandSet_CommandHunter' }),
      makeObjectDef('StealthGrantingUnit', 'GLA', ['VEHICLE'], [
        makeBlock('Behavior', 'GrantStealthBehavior ModuleTag_GrantStealth', {
          StartRadius: 5,
          FinalRadius: 80,
          RadiusGrowRate: 10,
          KindOf: 'INFANTRY VEHICLE',
        }),
      ]),
      makeObjectDef('CountermeasureJet', 'America', ['AIRCRAFT'], [
        makeBlock('Behavior', 'CountermeasuresBehavior ModuleTag_Countermeasures', {
          FlareTemplateName: 'CountermeasureFlare',
          VolleySize: 2,
          NumberOfVolleys: 3,
          DelayBetweenVolleys: 1000,
          ReloadTime: 5000,
          EvasionRate: 50,
        }),
      ]),
      makeObjectDef('CountermeasureFlare', 'America', ['PROJECTILE'], []),
      makeObjectDef('HordeInfantry', 'China', ['INFANTRY'], [
        makeBlock('Behavior', 'HordeUpdate ModuleTag_Horde', {
          UpdateRate: 1000,
          KindOf: 'INFANTRY',
          Count: 5,
          Radius: 60,
          RubOffRadius: 20,
        }),
      ]),
      makeObjectDef('FireOclTank', 'America', ['VEHICLE'], [
        makeBlock('Behavior', 'FireOCLAfterWeaponCooldownUpdate ModuleTag_FireOCL', {
          WeaponSlot: 'PRIMARY',
          OCL: 'OCL_Test',
          MinShotsToCreateOCL: 2,
          OCLLifetimePerSecond: 1000,
          OCLLifetimeMaxCap: 3000,
        }),
      ]),
      makeObjectDef('RadiusDecalCaster', 'America', ['VEHICLE'], [
        makeBlock('Behavior', 'RadiusDecalUpdate ModuleTag_RadiusDecal', {}),
      ]),
      makeObjectDef('CleanupWorker', 'America', ['INFANTRY'], [
        makeBlock('Behavior', 'CleanupHazardUpdate ModuleTag_Cleanup', {
          WeaponSlot: 'PRIMARY',
          ScanRate: 200,
          ScanRange: 100,
        }),
      ]),
      makeObjectDef('DynamicShroudUnit', 'America', ['VEHICLE'], [
        makeBlock('Behavior', 'DynamicShroudClearingRangeUpdate ModuleTag_DynamicShroud', {
          FinalVision: 50,
          ShrinkDelay: 3000,
          ShrinkTime: 1000,
          GrowDelay: 1000,
          GrowTime: 1000,
          ChangeInterval: 200,
          GrowInterval: 100,
        }),
      ]),
      makeObjectDef('DetectorUnit', 'America', ['VEHICLE', 'DETECTOR'], [
        makeBlock('Behavior', 'StealthDetectorUpdate ModuleTag_Detector', {
          DetectionRate: 200,
          DetectionRange: 120,
        }),
      ]),
      makeObjectDef('PhysicsUnit', 'America', ['VEHICLE'], [
        makeBlock('Behavior', 'PhysicsBehavior ModuleTag_Physics', {
          Mass: 5,
          AllowBouncing: false,
          AllowCollideForce: false,
        }),
      ]),
      makeObjectDef('LifetimeObject', 'America', ['PROJECTILE'], [
        makeBlock('Behavior', 'LifetimeUpdate ModuleTag_Lifetime', {
          MinLifetime: 1000,
          MaxLifetime: 1000,
        }),
      ]),
      makeObjectDef('DeletionObject', 'America', ['PROJECTILE'], [
        makeBlock('Behavior', 'DeletionUpdate ModuleTag_Delete', {
          MinLifetime: 1000,
          MaxLifetime: 1000,
        }),
      ]),
      makeObjectDef('HeightDieUnit', 'America', ['AIRCRAFT'], [
        makeBlock('Behavior', 'HeightDieUpdate ModuleTag_HeightDie', {
          TargetHeight: 50,
          TargetHeightIncludesStructures: false,
          OnlyWhenMovingDown: false,
          DestroyAttachedParticlesAtHeight: 20,
          SnapToGroundOnDeath: false,
          InitialDelay: 1000,
        }),
      ]),
      makeObjectDef('StickyBombObject', 'America', ['PROJECTILE'], [
        makeBlock('Behavior', 'StickyBombUpdate ModuleTag_StickyBomb', {
          OffsetZ: 5,
        }),
      ]),
      makeObjectDef('EnemyNearObject', 'America', ['VEHICLE'], [
        makeBlock('Behavior', 'EnemyNearUpdate ModuleTag_EnemyNear', {
          ScanDelayTime: 1000,
        }),
      ]),
      makeObjectDef('CheckpointObject', 'America', ['STRUCTURE'], [
        makeBlock('Behavior', 'CheckpointUpdate ModuleTag_Checkpoint', {
          EnemyScanDelayTime: 1000,
        }),
      ]),
      makeObjectDef('ProneInfantry', 'America', ['INFANTRY'], [
        makeBlock('Behavior', 'ProneUpdate ModuleTag_Prone', {
          DamageToFramesRatio: 2,
        }),
      ]),
      makeObjectDef('SmartBombTarget', 'America', ['PROJECTILE'], [
        makeBlock('Behavior', 'SmartBombTargetHomingUpdate ModuleTag_SmartBomb', {
          CourseCorrectionScalar: 0.95,
        }),
      ]),
      makeObjectDef('DemoTrapObject', 'GLA', ['MINE'], [
        makeBlock('Behavior', 'DemoTrapUpdate ModuleTag_DemoTrap', {
          DefaultProximityMode: true,
          TriggerDetonationRange: 50,
          ScanRate: 500,
        }),
      ]),
      makeObjectDef('DynamicGeometryObject', 'America', ['STRUCTURE'], [
        makeBlock('Behavior', 'DynamicGeometryInfoUpdate ModuleTag_DynamicGeometry', {
          InitialDelay: 1000,
          InitialHeight: 1,
          InitialMajorRadius: 2,
          InitialMinorRadius: 3,
          FinalHeight: 4,
          FinalMajorRadius: 5,
          FinalMinorRadius: 6,
          TransitionTime: 2000,
          ReverseAtTransitionTime: true,
        }),
      ]),
      makeObjectDef('FirestormObject', 'America', ['PROJECTILE'], [
        makeBlock('Behavior', 'FirestormDynamicGeometryInfoUpdate ModuleTag_FirestormGeometry', {
          InitialDelay: 1000,
          InitialHeight: 1,
          InitialMajorRadius: 2,
          InitialMinorRadius: 3,
          FinalHeight: 4,
          FinalMajorRadius: 5,
          FinalMinorRadius: 6,
          TransitionTime: 2000,
          DamageAmount: 10,
          DelayBetweenDamageFrames: 500,
          MaxHeightForDamage: 20,
        }),
      ]),
      makeObjectDef('SupplyCrippleWarehouse', 'GLA', ['STRUCTURE'], [
        makeBlock('Behavior', 'SupplyWarehouseCripplingBehavior ModuleTag_Crippling', {
          SelfHealSupression: 3000,
          SelfHealDelay: 1000,
          SelfHealAmount: 25,
        }),
      ]),
      makeObjectDef('AnimationSteeringUnit', 'America', ['VEHICLE'], [
        makeBlock('Behavior', 'AnimationSteeringUpdate ModuleTag_AnimationSteering', {
          MinTransitionTime: 1000,
        }),
      ]),
      makeObjectDef('EmpPulseObject', 'America', ['PROJECTILE'], [
        makeBlock('Behavior', 'EMPUpdate ModuleTag_EMP', {
          Lifetime: 3000,
          StartFadeTime: 1000,
          DisabledDuration: 5000,
          EffectRadius: 120,
        }),
      ]),
      makeObjectDef('StructureCollapseObject', 'GLA', ['STRUCTURE'], [
        makeBlock('Behavior', 'StructureCollapseUpdate ModuleTag_Collapse', {
          MinCollapseDelay: 1000,
          MaxCollapseDelay: 1000,
          MinBurstDelay: 500,
          MaxBurstDelay: 500,
          CollapseDamping: 0.1,
        }),
      ]),
      makeObjectDef('RailedTransportObject', 'Civilian', ['VEHICLE'], [
        makeBlock('Behavior', 'RailedTransportAIUpdate ModuleTag_RailedAI', {
          PathPrefixName: 'TrainPath',
        }),
        makeBlock('Behavior', 'RailedTransportDockUpdate ModuleTag_RailedDock', {
          PullInsideDuration: 1000,
          PushOutsideDuration: 1000,
          ToleranceDistance: 50,
        }),
      ]),
      makeObjectDef('HelperStateObject', 'America', ['VEHICLE'], []),
    ],
    specialPowers: [
      makeSpecialPowerDef('SuperweaponTest', { ReloadTime: 60000 }),
      makeSpecialPowerDef('SpyVisionPower', { ReloadTime: 60000 }),
      makeSpecialPowerDef('AbilityPower', { ReloadTime: 60000 }),
      makeSpecialPowerDef('BattlePlanPower', { ReloadTime: 60000 }),
      makeSpecialPowerDef('SpectrePower', { ReloadTime: 60000 }),
      makeSpecialPowerDef('ScudStormPower', { ReloadTime: 60000 }),
      makeSpecialPowerDef('ParticleCannonPower', { ReloadTime: 60000 }),
    ],
    weapons: [
      makeWeaponDef('AutoFireWeapon', { PrimaryDamage: 1, DelayBetweenShots: 1000 }),
      makeWeaponDef('CollideFireWeapon', { PrimaryDamage: 1, DelayBetweenShots: 1000 }),
      makeWeaponDef('PDLWeapon', { PrimaryDamage: 1, DelayBetweenShots: 1000, AttackRange: 100 }),
    ],
    commandButtons: [
      makeCommandButtonDef('Command_HuntFireWeapon', {
        Command: 'FIRE_WEAPON',
        WeaponSlot: 'PRIMARY',
      }),
    ],
    commandSets: [
      makeCommandSetDef('CommandSet_CommandHunter', {
        1: 'Command_HuntFireWeapon',
      }),
    ],
    upgrades: [
      makeUpgradeDef('Upgrade_AmericaRangerCaptureBuilding', { Type: 'PLAYER', BuildCost: 1000, BuildTime: 30 }),
    ],
  });
}

function sourceRawInt32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setInt32(0, Math.trunc(value), true);
  return bytes;
}

function sourceUpdateFrameAndPhase(frame: number, phase = 0): number {
  return (Math.max(0, Math.trunc(frame)) << 2) | (phase & 0x03);
}

function writeTestSourceUpdateModuleBase(
  saver: XferSave,
  nextCallFrame: number,
  phase = 0,
): void {
  saver.xferVersion(1);
  saver.xferVersion(1);
  saver.xferVersion(1);
  saver.xferVersion(1);
  saver.xferUnsignedInt(sourceUpdateFrameAndPhase(nextCallFrame, phase));
}

function writeTestSourceObjectHelperBase(
  saver: XferSave,
  nextCallFrame: number,
  phase = 0,
): void {
  saver.xferVersion(1);
  writeTestSourceUpdateModuleBase(saver, nextCallFrame, phase);
}

const SOURCE_PROJECTILE_STREAM_MAX = 20;
const SOURCE_BONE_FX_BODY_DAMAGE_TYPE_COUNT = 4;
const SOURCE_BONE_FX_MAX_BONES = 8;
const SOURCE_SPAWN_POINT_MAX_POINTS = 10;
const SOURCE_UPDATE_PHASE_FINAL = 3;

const SOURCE_PHYSICS_FLAG_STICK_TO_GROUND = 0x0001;
const SOURCE_PHYSICS_FLAG_ALLOW_BOUNCE = 0x0002;
const SOURCE_PHYSICS_FLAG_APPLY_FRICTION2D_WHEN_AIRBORNE = 0x0004;
const SOURCE_PHYSICS_FLAG_UPDATE_EVER_RUN = 0x0008;
const SOURCE_PHYSICS_FLAG_WAS_AIRBORNE_LAST_FRAME = 0x0010;
const SOURCE_PHYSICS_FLAG_ALLOW_COLLIDE_FORCE = 0x0020;
const SOURCE_PHYSICS_FLAG_ALLOW_TO_FALL = 0x0040;
const SOURCE_PHYSICS_FLAG_HAS_PITCH_ROLL_YAW = 0x0080;
const SOURCE_PHYSICS_FLAG_IMMUNE_TO_FALLING_DAMAGE = 0x0100;
const SOURCE_PHYSICS_FLAG_IS_IN_FREEFALL = 0x0200;
const SOURCE_PHYSICS_FLAG_IS_IN_UPDATE = 0x0400;
const SOURCE_PHYSICS_FLAG_IS_STUNNED = 0x0800;

function writeSourceStringBitFlags(saver: XferSave, flags: string[]): void {
  saver.xferVersion(1);
  saver.xferInt(flags.length);
  for (const flag of flags) {
    saver.xferAsciiString(flag);
  }
}

function writeSourceOpenContain(
  saver: XferSave,
  options: {
    passengerIds: number[];
    passengerAllowedToFire?: boolean;
    rallyPointExists?: boolean;
    rallyPoint?: { x: number; y: number; z: number };
  },
): void {
  saver.xferVersion(2);
  saver.xferVersion(1);
  saver.xferVersion(1);
  saver.xferVersion(1);
  saver.xferVersion(1);
  saver.xferUnsignedInt(0);
  saver.xferUnsignedInt(options.passengerIds.length);
  for (const passengerId of options.passengerIds) {
    saver.xferObjectID(passengerId);
  }
  saver.xferUser(new Uint8Array(2));
  saver.xferUnsignedInt(0);
  saver.xferUnsignedInt(0);
  saver.xferUnsignedInt(0);
  saver.xferUnsignedInt(0);
  saver.xferVersion(1);
  saver.xferInt(0);
  saver.xferUser(new Uint8Array(32 * 48));
  saver.xferInt(0);
  saver.xferInt(0);
  saver.xferInt(0);
  saver.xferBool(false);
  saver.xferCoord3D(options.rallyPoint ?? { x: 0, y: 0, z: 0 });
  saver.xferBool(options.rallyPointExists ?? false);
  saver.xferUnsignedShort(0);
  saver.xferInt(1);
  saver.xferBool(options.passengerAllowedToFire ?? false);
}

function writeSourceTransportContain(
  saver: XferSave,
  options: {
    passengerIds: number[];
    passengerAllowedToFire?: boolean;
    payloadCreated: boolean;
  },
): void {
  saver.xferVersion(1);
  writeSourceOpenContain(saver, options);
  saver.xferBool(options.payloadCreated);
  saver.xferInt(0);
  saver.xferUnsignedInt(0);
}

function buildSourceTransportContainModuleData(options: {
  passengerIds: number[];
  passengerAllowedToFire?: boolean;
  payloadCreated: boolean;
}): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-transport-contain');
  try {
    writeSourceTransportContain(saver, options);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceGarrisonContainModuleData(options: {
  passengerIds: number[];
  passengerAllowedToFire?: boolean;
}): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-garrison-contain');
  try {
    saver.xferVersion(1);
    writeSourceOpenContain(saver, options);
    saver.xferUnsignedInt(0);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceCaveContainModuleData(options: {
  passengerIds: number[];
  caveIndex: number;
}): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-cave-contain');
  try {
    saver.xferVersion(1);
    writeSourceOpenContain(saver, { passengerIds: options.passengerIds });
    saver.xferBool(false);
    saver.xferInt(options.caveIndex);
    saver.xferUnsignedInt(0);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceActiveBodyModuleData(options: {
  health: number;
  maxHealth: number;
  initialHealth: number;
  subdualDamage: number;
  damageScalar: number;
  frontCrushed: boolean;
  backCrushed: boolean;
  indestructible: boolean;
  armorSetFlags: string[];
}): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-active-body');
  try {
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferReal(options.damageScalar);
    saver.xferReal(options.health);
    saver.xferReal(options.subdualDamage);
    saver.xferReal(options.health);
    saver.xferReal(options.maxHealth);
    saver.xferReal(options.initialHealth);
    saver.xferUser(sourceRawInt32(0));
    saver.xferUnsignedInt(0);
    saver.xferUser(sourceRawInt32(0));
    saver.xferVersion(1);
    saver.xferVersion(3);
    saver.xferObjectID(0);
    saver.xferUser(new Uint8Array(2));
    saver.xferUser(sourceRawInt32(0));
    saver.xferUser(sourceRawInt32(11));
    saver.xferUser(sourceRawInt32(0));
    saver.xferReal(0);
    saver.xferBool(false);
    saver.xferUser(sourceRawInt32(0));
    saver.xferCoord3D({ x: 0, y: 0, z: 0 });
    saver.xferReal(0);
    saver.xferReal(0);
    saver.xferReal(0);
    saver.xferAsciiString('');
    saver.xferVersion(1);
    saver.xferReal(0);
    saver.xferReal(0);
    saver.xferBool(false);
    saver.xferUnsignedInt(0);
    saver.xferUnsignedInt(0);
    saver.xferBool(options.frontCrushed);
    saver.xferBool(options.backCrushed);
    saver.xferBool(false);
    saver.xferBool(options.indestructible);
    saver.xferUnsignedShort(0);
    saver.xferVersion(1);
    saver.xferInt(options.armorSetFlags.length);
    for (const flag of options.armorSetFlags) {
      saver.xferAsciiString(flag);
    }
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceProductionUpdateModuleData(options: {
  uniqueId: number;
  queue: Array<{
    type: number;
    name: string;
    productionId: number;
    percentComplete: number;
    framesUnderConstruction: number;
    productionQuantityTotal: number;
    productionQuantityProduced: number;
    exitDoor: number;
  }>;
}): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-production-update');
  try {
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferUnsignedInt(0);
    saver.xferUnsignedShort(options.queue.length);
    for (const entry of options.queue) {
      saver.xferUser(sourceRawInt32(entry.type));
      saver.xferAsciiString(entry.name);
      saver.xferUser(sourceRawInt32(entry.productionId));
      saver.xferReal(entry.percentComplete);
      saver.xferInt(entry.framesUnderConstruction);
      saver.xferInt(entry.productionQuantityTotal);
      saver.xferInt(entry.productionQuantityProduced);
      saver.xferInt(entry.exitDoor);
    }
    saver.xferUser(sourceRawInt32(options.uniqueId));
    saver.xferUnsignedInt(options.queue.length);
    saver.xferUnsignedInt(0);
    saver.xferUser(new Uint8Array(64));
    saver.xferVersion(1);
    saver.xferInt(0);
    saver.xferVersion(1);
    saver.xferInt(0);
    saver.xferBool(false);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function writeSourceDockUpdate(
  saver: XferSave,
  options: {
    numberApproachPositions: number;
    approachPositionOwners: number[];
    approachPositionReached?: boolean[];
    activeDocker?: number;
    dockerInside?: boolean;
    dockCrippled?: boolean;
    dockOpen?: boolean;
  },
): void {
  saver.xferVersion(1);
  saver.xferVersion(1);
  saver.xferVersion(1);
  saver.xferVersion(1);
  saver.xferVersion(1);
  saver.xferUnsignedInt(0);
  saver.xferCoord3D({ x: 0, y: 0, z: 0 });
  saver.xferCoord3D({ x: 0, y: 0, z: 0 });
  saver.xferCoord3D({ x: 0, y: 0, z: 0 });
  saver.xferInt(options.numberApproachPositions);
  saver.xferBool(true);
  saver.xferInt(0);
  saver.xferInt(options.approachPositionOwners.length);
  for (const owner of options.approachPositionOwners) {
    saver.xferObjectID(owner);
  }
  const reached = options.approachPositionReached ?? [];
  saver.xferInt(reached.length);
  for (const value of reached) {
    saver.xferBool(value);
  }
  saver.xferObjectID(options.activeDocker ?? 0);
  saver.xferBool(options.dockerInside ?? false);
  saver.xferBool(options.dockCrippled ?? false);
  saver.xferBool(options.dockOpen ?? true);
}

function buildSourceSupplyWarehouseDockUpdateModuleData(options: {
  boxesStored: number;
  numberApproachPositions: number;
  approachPositionOwners: number[];
  dockCrippled: boolean;
}): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-supply-warehouse-dock-update');
  try {
    saver.xferVersion(1);
    writeSourceDockUpdate(saver, options);
    saver.xferInt(options.boxesStored);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceRepairDockUpdateModuleData(options: {
  lastRepair: number;
  healthToAddPerFrame: number;
  numberApproachPositions: number;
  approachPositionOwners: number[];
}): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-repair-dock-update');
  try {
    saver.xferVersion(1);
    writeSourceDockUpdate(saver, options);
    saver.xferObjectID(options.lastRepair);
    saver.xferReal(options.healthToAddPerFrame);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceRailedTransportAIUpdateModuleData(options: {
  inTransit: boolean;
  paths: Array<{ startWaypointID: number; endWaypointID: number }>;
  currentPath: number;
  waypointDataLoaded: boolean;
}): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-railed-transport-ai-update');
  try {
    saver.xferVersion(1);
    saver.xferUser(new Uint8Array([4, 0xaa, 0xbb, 0xcc]));
    saver.xferBool(options.inTransit);
    saver.xferInt(options.paths.length);
    for (const path of options.paths) {
      saver.xferUnsignedInt(path.startWaypointID);
      saver.xferUnsignedInt(path.endWaypointID);
    }
    saver.xferInt(options.currentPath);
    saver.xferBool(options.waypointDataLoaded);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceRailedTransportDockUpdateModuleData(options: {
  dockingObjectId: number;
  pullInsideDistancePerFrame: number;
  unloadingObjectId: number;
  pushOutsideDistancePerFrame: number;
  unloadCount: number;
  numberApproachPositions: number;
  approachPositionOwners: number[];
}): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-railed-transport-dock-update');
  try {
    saver.xferVersion(1);
    writeSourceDockUpdate(saver, options);
    saver.xferObjectID(options.dockingObjectId);
    saver.xferReal(options.pullInsideDistancePerFrame);
    saver.xferObjectID(options.unloadingObjectId);
    saver.xferReal(options.pushOutsideDistancePerFrame);
    saver.xferInt(options.unloadCount);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceSpawnBehaviorModuleData(options: {
  initialBurstTimesInited: boolean;
  spawnTemplateName: string;
  oneShotCountdown: number;
  replacementTimes: number[];
  spawnIds: number[];
  active: boolean;
  aggregateHealth: boolean;
  spawnCount: number;
  selfTaskingSpawnCount: number;
}): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-spawn-behavior');
  try {
    saver.xferVersion(2);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferBool(options.initialBurstTimesInited);
    saver.xferAsciiString(options.spawnTemplateName);
    saver.xferInt(options.oneShotCountdown);
    saver.xferInt(0);
    saver.xferInt(0);
    saver.xferVersion(1);
    saver.xferUnsignedShort(options.replacementTimes.length);
    for (const frame of options.replacementTimes) {
      saver.xferInt(frame);
    }
    saver.xferVersion(1);
    saver.xferUnsignedShort(options.spawnIds.length);
    for (const objectId of options.spawnIds) {
      saver.xferObjectID(objectId);
    }
    saver.xferBool(options.active);
    saver.xferBool(options.aggregateHealth);
    saver.xferInt(options.spawnCount);
    saver.xferUnsignedInt(options.selfTaskingSpawnCount);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceSpecialPowerModuleData(options: {
  availableOnFrame: number;
  pausedCount: number;
  pausedOnFrame: number;
  pausedPercent: number;
}): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-special-power-module');
  try {
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferUnsignedInt(options.availableOnFrame);
    saver.xferInt(options.pausedCount);
    saver.xferUnsignedInt(options.pausedOnFrame);
    saver.xferReal(options.pausedPercent);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceStealthUpdateModuleData(options: {
  stealthAllowedFrame: number;
  detectionExpiresFrame: number;
  enabled: boolean;
  pulsePhaseRate: number;
  pulsePhase: number;
  disguiseAsPlayerIndex: number;
  disguiseTemplateName: string;
  disguiseTransitionFrames: number;
  disguiseHalfpointReached: boolean;
  transitioningToDisguise: boolean;
  disguised: boolean;
  framesGranted: number;
}): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-stealth-update');
  try {
    saver.xferVersion(2);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferUnsignedInt(0);
    saver.xferUnsignedInt(options.stealthAllowedFrame);
    saver.xferUnsignedInt(options.detectionExpiresFrame);
    saver.xferBool(options.enabled);
    saver.xferReal(options.pulsePhaseRate);
    saver.xferReal(options.pulsePhase);
    saver.xferInt(options.disguiseAsPlayerIndex);
    saver.xferAsciiString(options.disguiseTemplateName);
    saver.xferUnsignedInt(options.disguiseTransitionFrames);
    saver.xferBool(options.disguiseHalfpointReached);
    saver.xferBool(options.transitioningToDisguise);
    saver.xferBool(options.disguised);
    saver.xferUnsignedInt(options.framesGranted);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceSpyVisionUpdateModuleData(options: {
  deactivateFrame: number;
  currentlyActive: boolean;
  resetTimersNextUpdate: boolean;
  disabledUntilFrame: number;
}): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-spy-vision-update');
  try {
    saver.xferVersion(2);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferUnsignedInt(0);
    saver.xferUnsignedInt(options.deactivateFrame);
    saver.xferBool(options.currentlyActive);
    saver.xferBool(options.resetTimersNextUpdate);
    saver.xferUnsignedInt(options.disabledUntilFrame);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceSpecialAbilityUpdateModuleData(options: {
  active: boolean;
  prepFrames: number;
  animFrames: number;
  targetId: number;
  targetPos: { x: number; y: number; z: number };
  noTargetCommand: boolean;
  packingState: number;
  facingInitiated: boolean;
  facingComplete: boolean;
  withinStartAbilityRange: boolean;
  doDisableFxParticles: boolean;
  captureFlashPhase: number;
}): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-special-ability-update');
  try {
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferUnsignedInt(0);
    saver.xferBool(options.active);
    saver.xferUnsignedInt(options.prepFrames);
    saver.xferUnsignedInt(options.animFrames);
    saver.xferObjectID(options.targetId);
    saver.xferCoord3D(options.targetPos);
    saver.xferInt(0);
    saver.xferObjectIDList([]);
    saver.xferUnsignedInt(0);
    saver.xferBool(options.noTargetCommand);
    saver.xferInt(options.packingState);
    saver.xferBool(options.facingInitiated);
    saver.xferBool(options.facingComplete);
    saver.xferBool(options.withinStartAbilityRange);
    saver.xferBool(options.doDisableFxParticles);
    saver.xferReal(options.captureFlashPhase);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceBattlePlanUpdateModuleData(options: {
  currentPlan: number;
  desiredPlan: number;
  planAffectingArmy: number;
  status: number;
  nextReadyFrame: number;
  invalidSettings: boolean;
  centeringTurret: boolean;
  armorScalar: number;
  bombardment: number;
  searchAndDestroy: number;
  holdTheLine: number;
  sightRangeScalar: number;
  validKindOf: string[];
  invalidKindOf: string[];
  visionObjectId: number;
}): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-battle-plan-update');
  try {
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferUnsignedInt(0);
    saver.xferUser(sourceRawInt32(options.currentPlan));
    saver.xferUser(sourceRawInt32(options.desiredPlan));
    saver.xferUser(sourceRawInt32(options.planAffectingArmy));
    saver.xferUser(sourceRawInt32(options.status));
    saver.xferUnsignedInt(options.nextReadyFrame);
    saver.xferBool(options.invalidSettings);
    saver.xferBool(options.centeringTurret);
    saver.xferReal(options.armorScalar);
    saver.xferInt(options.bombardment);
    saver.xferInt(options.searchAndDestroy);
    saver.xferInt(options.holdTheLine);
    saver.xferReal(options.sightRangeScalar);
    writeSourceStringBitFlags(saver, options.validKindOf);
    writeSourceStringBitFlags(saver, options.invalidKindOf);
    saver.xferObjectID(options.visionObjectId);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceSlavedUpdateModuleData(options: {
  slaverId: number;
  guardPointOffset: { x: number; y: number; z: number };
  framesToWait: number;
  repairState: number;
  repairing: boolean;
}): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-slaved-update');
  try {
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferUnsignedInt(0);
    saver.xferObjectID(options.slaverId);
    saver.xferCoord3D(options.guardPointOffset);
    saver.xferInt(options.framesToWait);
    saver.xferInt(options.repairState);
    saver.xferBool(options.repairing);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceMobMemberSlavedUpdateModuleData(options: {
  slaverId: number;
  framesToWait: number;
  mobState: number;
  primaryVictimId: number;
  isSelfTasking: boolean;
  catchUpCrisisTimer: number;
}): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-mob-member-slaved-update');
  try {
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferUnsignedInt(0);
    saver.xferObjectID(options.slaverId);
    saver.xferInt(options.framesToWait);
    saver.xferInt(options.mobState);
    saver.xferReal(0.25);
    saver.xferReal(0.3);
    saver.xferReal(0.35);
    saver.xferObjectID(options.primaryVictimId);
    saver.xferReal(0.5);
    saver.xferBool(options.isSelfTasking);
    saver.xferUnsignedInt(options.catchUpCrisisTimer);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceAutoHealBehaviorModuleData(options: {
  nextCallFrame: number;
  upgradeExecuted: boolean;
  radiusParticleSystemId: number;
  soonestHealFrame: number;
  stopped: boolean;
}): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-auto-heal-behavior');
  try {
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferUnsignedInt(sourceUpdateFrameAndPhase(options.nextCallFrame));
    saver.xferVersion(1);
    saver.xferBool(options.upgradeExecuted);
    saver.xferUnsignedInt(options.radiusParticleSystemId);
    saver.xferUnsignedInt(options.soonestHealFrame);
    saver.xferBool(options.stopped);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourcePoisonedBehaviorModuleData(options: {
  nextCallFrame: number;
  poisonDamageFrame: number;
  poisonOverallStopFrame: number;
  poisonDamageAmount: number;
  deathType: number;
}): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-poisoned-behavior');
  try {
    saver.xferVersion(2);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferUnsignedInt(sourceUpdateFrameAndPhase(options.nextCallFrame));
    saver.xferUnsignedInt(options.poisonDamageFrame);
    saver.xferUnsignedInt(options.poisonOverallStopFrame);
    saver.xferReal(options.poisonDamageAmount);
    saver.xferUser(sourceRawInt32(options.deathType));
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceMinefieldBehaviorModuleData(options: {
  nextCallFrame: number;
  virtualMinesRemaining: number;
  nextDeathCheckFrame: number;
  scootFramesLeft: number;
  scootVelocity: { x: number; y: number; z: number };
  scootAcceleration: { x: number; y: number; z: number };
  ignoreDamage: boolean;
  regenerates: boolean;
  draining: boolean;
  immunes: Array<{ objectId: number; collideFrame: number }>;
}): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-minefield-behavior');
  try {
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferUnsignedInt(sourceUpdateFrameAndPhase(options.nextCallFrame));
    saver.xferUnsignedInt(options.virtualMinesRemaining);
    saver.xferUnsignedInt(options.nextDeathCheckFrame);
    saver.xferUnsignedInt(options.scootFramesLeft);
    saver.xferCoord3D(options.scootVelocity);
    saver.xferCoord3D(options.scootAcceleration);
    saver.xferBool(options.ignoreDamage);
    saver.xferBool(options.regenerates);
    saver.xferBool(options.draining);
    saver.xferUnsignedByte(3);
    for (let index = 0; index < 3; index += 1) {
      const immune = options.immunes[index] ?? { objectId: 0, collideFrame: 0 };
      saver.xferObjectID(immune.objectId);
      saver.xferUnsignedInt(immune.collideFrame);
    }
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function xferSourceWeaponSnapshotForTest(saver: XferSave, options: {
  templateName: string;
  whenWeCanFireAgain: number;
}): void {
  saver.xferVersion(3);
  saver.xferAsciiString(options.templateName);
  saver.xferInt(0);
  saver.xferInt(0);
  saver.xferUnsignedInt(0);
  saver.xferUnsignedInt(options.whenWeCanFireAgain);
  saver.xferUnsignedInt(0);
  saver.xferUnsignedInt(0);
  saver.xferUnsignedInt(0);
  saver.xferUnsignedInt(0);
  saver.xferObjectID(0);
  saver.xferObjectID(0);
  saver.xferInt(0);
  saver.xferInt(0);
  saver.xferInt(0);
  saver.xferUnsignedShort(0);
  saver.xferBool(false);
  saver.xferBool(false);
}

function buildSourceFireWeaponUpdateModuleData(options: {
  nextCallFrame: number;
  weaponName: string;
  whenWeCanFireAgain: number;
}): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-fire-weapon-update');
  try {
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferUnsignedInt(sourceUpdateFrameAndPhase(options.nextCallFrame));
    xferSourceWeaponSnapshotForTest(saver, {
      templateName: options.weaponName,
      whenWeCanFireAgain: options.whenWeCanFireAgain,
    });
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceFireWeaponCollideModuleData(options: {
  weaponPresent: boolean;
  weaponName: string;
  whenWeCanFireAgain: number;
  everFired: boolean;
}): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-fire-weapon-collide');
  try {
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferBool(options.weaponPresent);
    if (options.weaponPresent) {
      xferSourceWeaponSnapshotForTest(saver, {
        templateName: options.weaponName,
        whenWeCanFireAgain: options.whenWeCanFireAgain,
      });
    }
    saver.xferBool(options.everFired);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceProjectileStreamUpdateModuleData(options: {
  nextCallFrame: number;
  projectileIds: number[];
  nextFreeIndex: number;
  firstValidIndex: number;
  owningObject: number;
  targetObject: number;
  targetPosition: { x: number; y: number; z: number };
}): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-projectile-stream-update');
  try {
    saver.xferVersion(2);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferUnsignedInt(sourceUpdateFrameAndPhase(options.nextCallFrame));
    for (let index = 0; index < SOURCE_PROJECTILE_STREAM_MAX; index += 1) {
      saver.xferObjectID(options.projectileIds[index] ?? 0);
    }
    saver.xferInt(options.nextFreeIndex);
    saver.xferInt(options.firstValidIndex);
    saver.xferObjectID(options.owningObject);
    saver.xferObjectID(options.targetObject);
    saver.xferCoord3D(options.targetPosition);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function makeSourceBoneFxIntGrid(seed: number): number[][] {
  return Array.from({ length: SOURCE_BONE_FX_BODY_DAMAGE_TYPE_COUNT }, (_, damageState) =>
    Array.from({ length: SOURCE_BONE_FX_MAX_BONES }, (_, boneIndex) => seed + damageState * 10 + boneIndex),
  );
}

function makeSourceBoneFxCoordGrid(seed: number): { x: number; y: number; z: number }[][] {
  return Array.from({ length: SOURCE_BONE_FX_BODY_DAMAGE_TYPE_COUNT }, (_, damageState) =>
    Array.from({ length: SOURCE_BONE_FX_MAX_BONES }, (_, boneIndex) => ({
      x: seed + damageState,
      y: seed + boneIndex,
      z: seed + damageState * 10 + boneIndex,
    })),
  );
}

function xferSourceBoneFxIntGridForTest(saver: XferSave, grid: number[][]): void {
  for (let damageState = 0; damageState < SOURCE_BONE_FX_BODY_DAMAGE_TYPE_COUNT; damageState += 1) {
    for (let boneIndex = 0; boneIndex < SOURCE_BONE_FX_MAX_BONES; boneIndex += 1) {
      saver.xferInt(grid[damageState]?.[boneIndex] ?? 0);
    }
  }
}

function xferSourceBoneFxCoordGridForTest(
  saver: XferSave,
  grid: { x: number; y: number; z: number }[][],
): void {
  for (let damageState = 0; damageState < SOURCE_BONE_FX_BODY_DAMAGE_TYPE_COUNT; damageState += 1) {
    for (let boneIndex = 0; boneIndex < SOURCE_BONE_FX_MAX_BONES; boneIndex += 1) {
      saver.xferCoord3D(grid[damageState]?.[boneIndex] ?? { x: 0, y: 0, z: 0 });
    }
  }
}

function buildSourceBoneFxUpdateModuleData(options: {
  nextCallFrame: number;
  particleSystemIds: number[];
  nextFxFrame: number[][];
  nextOclFrame: number[][];
  nextParticleSystemFrame: number[][];
  fxBonePositions: { x: number; y: number; z: number }[][];
  oclBonePositions: { x: number; y: number; z: number }[][];
  particleSystemBonePositions: { x: number; y: number; z: number }[][];
  currentBodyState: number;
  bonesResolved: boolean[];
  active: boolean;
}): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-bone-fx-update');
  try {
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferUnsignedInt(sourceUpdateFrameAndPhase(options.nextCallFrame));
    saver.xferUnsignedShort(options.particleSystemIds.length);
    for (const particleSystemId of options.particleSystemIds) {
      saver.xferUnsignedInt(particleSystemId);
    }
    xferSourceBoneFxIntGridForTest(saver, options.nextFxFrame);
    xferSourceBoneFxIntGridForTest(saver, options.nextOclFrame);
    xferSourceBoneFxIntGridForTest(saver, options.nextParticleSystemFrame);
    xferSourceBoneFxCoordGridForTest(saver, options.fxBonePositions);
    xferSourceBoneFxCoordGridForTest(saver, options.oclBonePositions);
    xferSourceBoneFxCoordGridForTest(saver, options.particleSystemBonePositions);
    saver.xferUser(sourceRawInt32(options.currentBodyState));
    for (let index = 0; index < SOURCE_BONE_FX_BODY_DAMAGE_TYPE_COUNT; index += 1) {
      saver.xferBool(options.bonesResolved[index] ?? false);
    }
    saver.xferBool(options.active);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceDeployStyleAIUpdateModuleData(options: {
  state: number;
  frameToWaitForDeploy: number;
}): Uint8Array {
  const bytes = new Uint8Array(18);
  bytes[0] = 4;
  bytes[1] = 4;
  bytes[2] = 1;
  bytes[3] = 1;
  bytes[4] = 1;
  bytes[5] = 1;
  bytes[6] = 0xaa;
  bytes[7] = 0xbb;
  bytes[8] = 0xcc;
  bytes[9] = 0xdd;
  const view = new DataView(bytes.buffer);
  view.setInt32(bytes.byteLength - 8, options.state, true);
  view.setUint32(bytes.byteLength - 4, options.frameToWaitForDeploy, true);
  return bytes;
}

function buildSourceAssaultTransportAIUpdateModuleData(options: {
  members: Array<{ entityId: number; isHealing: boolean }>;
  attackMoveGoal: { x: number; y: number; z: number };
  designatedTargetId: number;
  assaultState: number;
  framesRemaining: number;
  isAttackMove: boolean;
  isAttackObject: boolean;
}): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-assault-transport-ai-update');
  try {
    saver.xferVersion(1);
    saver.xferUser(new Uint8Array([4, 0xaa, 0xbb, 0xcc]));
    saver.xferInt(options.members.length);
    for (const member of options.members) {
      saver.xferObjectID(member.entityId);
      saver.xferBool(member.isHealing);
    }
    saver.xferCoord3D(options.attackMoveGoal);
    saver.xferObjectID(options.designatedTargetId);
    saver.xferInt(options.assaultState);
    saver.xferUnsignedInt(options.framesRemaining);
    saver.xferBool(options.isAttackMove);
    saver.xferBool(options.isAttackObject);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceSupplyTruckAIUpdateModuleData(options: {
  preferredDockId: number;
  numberBoxes: number;
  forcePending: boolean;
}): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-supply-truck-ai-update');
  try {
    saver.xferVersion(1);
    saver.xferUser(new Uint8Array([4, 0xaa, 0xbb, 0xcc]));
    saver.xferObjectID(options.preferredDockId);
    saver.xferInt(options.numberBoxes);
    saver.xferBool(options.forcePending);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceProductionExitRallyModuleData(options: {
  nextCallFrame: number;
  rallyPoint: { x: number; y: number; z: number };
  rallyPointExists: boolean;
}): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-production-exit-rally');
  try {
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferUnsignedInt(sourceUpdateFrameAndPhase(options.nextCallFrame));
    saver.xferCoord3D(options.rallyPoint);
    saver.xferBool(options.rallyPointExists);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceQueueProductionExitModuleData(options: {
  nextCallFrame: number;
  currentDelay: number;
  rallyPoint: { x: number; y: number; z: number };
  rallyPointExists: boolean;
  creationClearDistance: number;
  currentBurstCount: number;
}): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-queue-production-exit');
  try {
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferUnsignedInt(sourceUpdateFrameAndPhase(options.nextCallFrame));
    saver.xferUnsignedInt(options.currentDelay);
    saver.xferCoord3D(options.rallyPoint);
    saver.xferBool(options.rallyPointExists);
    saver.xferReal(options.creationClearDistance);
    saver.xferUnsignedInt(options.currentBurstCount);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceSpawnPointProductionExitModuleData(options: {
  nextCallFrame: number;
  occupierIds: number[];
}): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-spawn-point-production-exit');
  try {
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferUnsignedInt(sourceUpdateFrameAndPhase(options.nextCallFrame));
    for (let index = 0; index < SOURCE_SPAWN_POINT_MAX_POINTS; index += 1) {
      saver.xferObjectID(options.occupierIds[index] ?? 0);
    }
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourcePointDefenseLaserUpdateModuleData(options: {
  nextCallFrame: number;
  bestTargetId: number;
  inRange: boolean;
  nextScanFrames: number;
  nextShotAvailableInFrames: number;
}): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-point-defense-laser-update');
  try {
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferUnsignedInt(sourceUpdateFrameAndPhase(options.nextCallFrame));
    saver.xferObjectID(options.bestTargetId);
    saver.xferBool(options.inRange);
    saver.xferInt(options.nextScanFrames);
    saver.xferInt(options.nextShotAvailableInFrames);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceFloatUpdateModuleData(options: {
  nextCallFrame: number;
  enabled: boolean;
}): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-float-update');
  try {
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferUnsignedInt(sourceUpdateFrameAndPhase(options.nextCallFrame));
    saver.xferBool(options.enabled);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourcePilotFindVehicleUpdateModuleData(options: {
  nextCallFrame: number;
  didMoveToBase: boolean;
}): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-pilot-find-vehicle-update');
  try {
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferUnsignedInt(sourceUpdateFrameAndPhase(options.nextCallFrame));
    saver.xferBool(options.didMoveToBase);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceRadarUpdateModuleData(options: {
  nextCallFrame: number;
  extendDoneFrame: number;
  extendComplete: boolean;
  radarActive: boolean;
}): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-radar-update');
  try {
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferUnsignedInt(sourceUpdateFrameAndPhase(options.nextCallFrame));
    saver.xferUnsignedInt(options.extendDoneFrame);
    saver.xferBool(options.extendComplete);
    saver.xferBool(options.radarActive);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceLeafletDropBehaviorModuleData(options: {
  startFrame: number;
}): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-leaflet-drop-behavior');
  try {
    saver.xferVersion(1);
    saver.xferUnsignedInt(options.startFrame);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceHijackerUpdateModuleData(options: {
  nextCallFrame: number;
  targetId: number;
  ejectPosition: { x: number; y: number; z: number };
  update: boolean;
  isInVehicle: boolean;
  wasTargetAirborne: boolean;
}): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-hijacker-update');
  try {
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferUnsignedInt(sourceUpdateFrameAndPhase(options.nextCallFrame));
    saver.xferObjectID(options.targetId);
    saver.xferCoord3D(options.ejectPosition);
    saver.xferBool(options.update);
    saver.xferBool(options.isInVehicle);
    saver.xferBool(options.wasTargetAirborne);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceEnemyNearUpdateModuleData(options: {
  nextCallFrame: number;
  nextScanCountdown: number;
  enemyNear: boolean;
}): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-enemy-near-update');
  try {
    saver.xferVersion(1);
    writeTestSourceUpdateModuleBase(saver, options.nextCallFrame);
    saver.xferUnsignedInt(options.nextScanCountdown);
    saver.xferBool(options.enemyNear);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceCheckpointUpdateModuleData(options: {
  nextCallFrame: number;
  enemyNear: boolean;
  allyNear: boolean;
  maxMinorRadius: number;
  scanCountdown: number;
}): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-checkpoint-update');
  try {
    saver.xferVersion(1);
    writeTestSourceUpdateModuleBase(saver, options.nextCallFrame);
    saver.xferBool(options.enemyNear);
    saver.xferBool(options.allyNear);
    saver.xferReal(options.maxMinorRadius);
    saver.xferUnsignedInt(options.scanCountdown);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceProneUpdateModuleData(options: {
  nextCallFrame: number;
  proneFrames: number;
}): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-prone-update');
  try {
    saver.xferVersion(1);
    writeTestSourceUpdateModuleBase(saver, options.nextCallFrame);
    saver.xferInt(options.proneFrames);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceSmartBombTargetHomingUpdateModuleData(options: {
  nextCallFrame: number;
}): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-smart-bomb-target-homing-update');
  try {
    saver.xferVersion(1);
    writeTestSourceUpdateModuleBase(saver, options.nextCallFrame);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceDemoTrapUpdateModuleData(options: {
  nextCallFrame: number;
  nextScanFrames: number;
  detonated: boolean;
}): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-demo-trap-update');
  try {
    saver.xferVersion(1);
    writeTestSourceUpdateModuleBase(saver, options.nextCallFrame);
    saver.xferInt(options.nextScanFrames);
    saver.xferBool(options.detonated);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function writeSourceDynamicGeometryInfoUpdate(
  saver: XferSave,
  options: {
    nextCallFrame: number;
    startingDelayCountdown: number;
    timeActive: number;
    started: boolean;
    finished: boolean;
    reverseAtTransitionTime: boolean;
    direction: number;
    switchedDirections: boolean;
    initialHeight: number;
    initialMajorRadius: number;
    initialMinorRadius: number;
    finalHeight: number;
    finalMajorRadius: number;
    finalMinorRadius: number;
  },
): void {
  saver.xferVersion(1);
  writeTestSourceUpdateModuleBase(saver, options.nextCallFrame);
  saver.xferUnsignedInt(options.startingDelayCountdown);
  saver.xferUnsignedInt(options.timeActive);
  saver.xferBool(options.started);
  saver.xferBool(options.finished);
  saver.xferBool(options.reverseAtTransitionTime);
  saver.xferUser(sourceRawInt32(options.direction));
  saver.xferBool(options.switchedDirections);
  saver.xferReal(options.initialHeight);
  saver.xferReal(options.initialMajorRadius);
  saver.xferReal(options.initialMinorRadius);
  saver.xferReal(options.finalHeight);
  saver.xferReal(options.finalMajorRadius);
  saver.xferReal(options.finalMinorRadius);
}

function buildSourceDynamicGeometryInfoUpdateModuleData(options: Parameters<typeof writeSourceDynamicGeometryInfoUpdate>[1]): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-dynamic-geometry-info-update');
  try {
    writeSourceDynamicGeometryInfoUpdate(saver, options);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceFirestormDynamicGeometryInfoUpdateModuleData(options: {
  dynamic: Parameters<typeof writeSourceDynamicGeometryInfoUpdate>[1];
  particleSystemIds?: number[];
  effectsFired: boolean;
  scorchPlaced: boolean;
  lastDamageFrame: number;
}): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-firestorm-dynamic-geometry-info-update');
  try {
    saver.xferVersion(1);
    writeSourceDynamicGeometryInfoUpdate(saver, options.dynamic);
    for (let index = 0; index < 16; index += 1) {
      saver.xferUnsignedInt(options.particleSystemIds?.[index] ?? 0);
    }
    saver.xferBool(options.effectsFired);
    saver.xferBool(options.scorchPlaced);
    saver.xferUnsignedInt(options.lastDamageFrame);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceSupplyWarehouseCripplingBehaviorModuleData(options: {
  nextCallFrame: number;
  healingSuppressedUntilFrame: number;
  nextHealingFrame: number;
}): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-supply-warehouse-crippling-behavior');
  try {
    saver.xferVersion(1);
    writeTestSourceUpdateModuleBase(saver, options.nextCallFrame);
    saver.xferUnsignedInt(options.healingSuppressedUntilFrame);
    saver.xferUnsignedInt(options.nextHealingFrame);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceAnimationSteeringUpdateModuleData(options: {
  nextCallFrame: number;
}): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-animation-steering-update');
  try {
    saver.xferVersion(1);
    writeTestSourceUpdateModuleBase(saver, options.nextCallFrame);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceEmpUpdateModuleData(): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-emp-update');
  try {
    saver.xferVersion(1);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceStructureCollapseUpdateModuleData(options: {
  nextCallFrame: number;
  collapseFrame: number;
  burstFrame: number;
  collapseState: number;
  collapseVelocity: number;
  currentHeight: number;
}): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-structure-collapse-update');
  try {
    saver.xferVersion(1);
    writeTestSourceUpdateModuleBase(saver, options.nextCallFrame);
    saver.xferUnsignedInt(options.collapseFrame);
    saver.xferUnsignedInt(options.burstFrame);
    saver.xferUser(sourceRawInt32(options.collapseState));
    saver.xferReal(options.collapseVelocity);
    saver.xferReal(options.currentHeight);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceBaseOnlyObjectHelperModuleData(options: {
  nextCallFrame: number;
  phase?: number;
}): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-base-only-object-helper');
  try {
    saver.xferVersion(1);
    writeTestSourceObjectHelperBase(saver, options.nextCallFrame, options.phase ?? 0);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceObjectDefectionHelperModuleData(options: {
  nextCallFrame: number;
  detectionStartFrame: number;
  detectionEndFrame: number;
  flashPhase: number;
  doFx: boolean;
}): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-object-defection-helper');
  try {
    saver.xferVersion(1);
    writeTestSourceObjectHelperBase(saver, options.nextCallFrame);
    saver.xferUnsignedInt(options.detectionStartFrame);
    saver.xferUnsignedInt(options.detectionEndFrame);
    saver.xferReal(options.flashPhase);
    saver.xferBool(options.doFx);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceStatusDamageHelperModuleData(options: {
  nextCallFrame: number;
  statusType: number;
  clearFrame: number;
}): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-status-damage-helper');
  try {
    saver.xferVersion(1);
    writeTestSourceObjectHelperBase(saver, options.nextCallFrame);
    saver.xferUser(sourceRawInt32(options.statusType));
    saver.xferUnsignedInt(options.clearFrame);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceSubdualDamageHelperModuleData(options: {
  nextCallFrame: number;
  healingStepCountdown: number;
}): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-subdual-damage-helper');
  try {
    saver.xferVersion(1);
    writeTestSourceObjectHelperBase(saver, options.nextCallFrame);
    saver.xferUnsignedInt(options.healingStepCountdown);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceFiringTrackerModuleData(options: {
  nextCallFrame: number;
  consecutiveShots: number;
  victimId: number;
  frameToStartCooldown: number;
}): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-firing-tracker');
  try {
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferUnsignedInt(sourceUpdateFrameAndPhase(options.nextCallFrame));
    saver.xferInt(options.consecutiveShots);
    saver.xferObjectID(options.victimId);
    saver.xferUnsignedInt(options.frameToStartCooldown);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceOverchargeBehaviorModuleData(options: {
  nextCallFrame: number;
  overchargeActive: boolean;
}): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-overcharge-behavior');
  try {
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferUnsignedInt(sourceUpdateFrameAndPhase(options.nextCallFrame));
    saver.xferBool(options.overchargeActive);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourcePowerPlantUpdateModuleData(options: {
  nextCallFrame: number;
  extended: boolean;
}): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-power-plant-update');
  try {
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferUnsignedInt(sourceUpdateFrameAndPhase(options.nextCallFrame));
    saver.xferBool(options.extended);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceOclUpdateModuleData(options: {
  nextCallFrame: number;
  nextCreationFrame: number;
  timerStartedFrame: number;
  factionNeutral: boolean;
  currentPlayerColor: number;
}): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-ocl-update');
  try {
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferUnsignedInt(sourceUpdateFrameAndPhase(options.nextCallFrame));
    saver.xferUnsignedInt(options.nextCreationFrame);
    saver.xferUnsignedInt(options.timerStartedFrame);
    saver.xferBool(options.factionNeutral);
    saver.xferInt(options.currentPlayerColor);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceWeaponBonusUpdateModuleData(options: {
  nextCallFrame: number;
}): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-weapon-bonus-update');
  try {
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferUnsignedInt(sourceUpdateFrameAndPhase(options.nextCallFrame));
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceTempWeaponBonusHelperModuleData(options: {
  nextCallFrame: number;
  currentBonus: number;
  frameToRemove: number;
}): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-temp-weapon-bonus-helper');
  try {
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferUnsignedInt(sourceUpdateFrameAndPhase(options.nextCallFrame));
    saver.xferUser(sourceRawInt32(options.currentBonus));
    saver.xferUnsignedInt(options.frameToRemove);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceSpectreGunshipDeploymentUpdateModuleData(options: {
  nextCallFrame: number;
  gunshipId: number;
}): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-spectre-gunship-deployment-update');
  try {
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferUnsignedInt(sourceUpdateFrameAndPhase(options.nextCallFrame));
    saver.xferObjectID(options.gunshipId);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceSpectreGunshipUpdateModuleData(options: {
  nextCallFrame: number;
  initialTargetPosition: { x: number; y: number; z: number };
  overrideTargetDestination: { x: number; y: number; z: number };
  satellitePosition: { x: number; y: number; z: number };
  status: number;
  orbitEscapeFrame: number;
  gattlingTargetPosition: { x: number; y: number; z: number };
  positionToShootAt: { x: number; y: number; z: number };
  okToFireHowitzerCounter: number;
  gattlingId: number;
}): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-spectre-gunship-update');
  try {
    saver.xferVersion(2);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferUnsignedInt(sourceUpdateFrameAndPhase(options.nextCallFrame));
    saver.xferCoord3D(options.initialTargetPosition);
    saver.xferCoord3D(options.overrideTargetDestination);
    saver.xferCoord3D(options.satellitePosition);
    saver.xferUser(sourceRawInt32(options.status));
    saver.xferUnsignedInt(options.orbitEscapeFrame);
    saver.xferCoord3D(options.gattlingTargetPosition);
    saver.xferCoord3D(options.positionToShootAt);
    saver.xferUnsignedInt(options.okToFireHowitzerCounter);
    saver.xferObjectID(options.gattlingId);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceNeutronMissileUpdateModuleData(options: {
  nextCallFrame: number;
  state: number;
  targetPos: { x: number; y: number; z: number };
  intermedPos: { x: number; y: number; z: number };
  launcherId: number;
  attachWeaponSlot: number;
  attachSpecificBarrelToUse: number;
  accel: { x: number; y: number; z: number };
  vel: { x: number; y: number; z: number };
  stateTimestamp: number;
  isLaunched: boolean;
  isArmed: boolean;
  noTurnDistLeft: number;
  reachedIntermediatePos: boolean;
  frameAtLaunch: number;
  heightAtLaunch: number;
  exhaustSystemTemplateName: string;
}): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-neutron-missile-update');
  try {
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferUnsignedInt(sourceUpdateFrameAndPhase(options.nextCallFrame));
    saver.xferUser(sourceRawInt32(options.state));
    saver.xferCoord3D(options.targetPos);
    saver.xferCoord3D(options.intermedPos);
    saver.xferObjectID(options.launcherId);
    saver.xferUser(sourceRawInt32(options.attachWeaponSlot));
    saver.xferInt(options.attachSpecificBarrelToUse);
    saver.xferCoord3D(options.accel);
    saver.xferCoord3D(options.vel);
    saver.xferUnsignedInt(options.stateTimestamp);
    saver.xferBool(options.isLaunched);
    saver.xferBool(options.isArmed);
    saver.xferReal(options.noTurnDistLeft);
    saver.xferBool(options.reachedIntermediatePos);
    saver.xferUnsignedInt(options.frameAtLaunch);
    saver.xferReal(options.heightAtLaunch);
    saver.xferAsciiString(options.exhaustSystemTemplateName);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceMissileLauncherBuildingUpdateModuleData(options: {
  nextCallFrame: number;
  doorState: number;
  timeoutState: number;
  timeoutFrame: number;
}): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-missile-launcher-building-update');
  try {
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferUnsignedInt(sourceUpdateFrameAndPhase(options.nextCallFrame));
    saver.xferUser(sourceRawInt32(options.doorState));
    saver.xferUser(sourceRawInt32(options.timeoutState));
    saver.xferUnsignedInt(options.timeoutFrame);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function writeSourceParticleUplinkVisualState(saver: XferSave): void {
  for (let index = 0; index < 16; index += 1) {
    saver.xferUnsignedInt(100 + index);
  }
  for (let index = 0; index < 16; index += 1) {
    saver.xferUnsignedInt(200 + index);
  }
  saver.xferUnsignedInt(301);
  saver.xferUnsignedInt(302);
  saver.xferUnsignedInt(303);
  saver.xferUnsignedInt(304);
  for (let index = 0; index < 16; index += 1) {
    saver.xferCoord3D({ x: index + 1, y: index + 2, z: index + 3 });
  }
  for (let matrixIndex = 0; matrixIndex < 16; matrixIndex += 1) {
    const matrix = [1, 0, 0, matrixIndex, 0, 1, 0, matrixIndex + 1, 0, 0, 1, matrixIndex + 2];
    for (const value of matrix) {
      saver.xferReal(value);
    }
  }
  saver.xferCoord3D({ x: 31, y: 32, z: 33 });
  saver.xferCoord3D({ x: 41, y: 42, z: 43 });
  saver.xferCoord3D({ x: 51, y: 52, z: 53 });
  saver.xferBool(true);
  saver.xferBool(true);
  saver.xferBool(false);
}

function buildSourceParticleUplinkCannonUpdateModuleData(options: {
  nextCallFrame: number;
  status: number;
  laserStatus: number;
  frames: number;
  initialTargetPosition: { x: number; y: number; z: number };
  currentTargetPosition: { x: number; y: number; z: number };
  scorchMarksMade: number;
  nextScorchMarkFrame: number;
  nextLaunchFXFrame: number;
  damagePulsesMade: number;
  nextDamagePulseFrame: number;
  startAttackFrame: number;
  startDecayFrame: number;
  lastDrivingClickFrame: number;
  secondLastDrivingClickFrame: number;
  manualTargetMode: boolean;
  scriptedWaypointMode: boolean;
  nextDestWaypointID: number;
}): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-particle-uplink-cannon-update');
  try {
    saver.xferVersion(3);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferUnsignedInt(sourceUpdateFrameAndPhase(options.nextCallFrame));
    saver.xferUser(sourceRawInt32(options.status));
    saver.xferUser(sourceRawInt32(options.laserStatus));
    saver.xferUnsignedInt(options.frames);
    writeSourceParticleUplinkVisualState(saver);
    saver.xferCoord3D(options.initialTargetPosition);
    saver.xferCoord3D(options.currentTargetPosition);
    saver.xferUnsignedInt(options.scorchMarksMade);
    saver.xferUnsignedInt(options.nextScorchMarkFrame);
    saver.xferUnsignedInt(options.nextLaunchFXFrame);
    saver.xferUnsignedInt(options.damagePulsesMade);
    saver.xferUnsignedInt(options.nextDamagePulseFrame);
    saver.xferUnsignedInt(options.startAttackFrame);
    saver.xferUnsignedInt(options.startDecayFrame);
    saver.xferUnsignedInt(options.lastDrivingClickFrame);
    saver.xferUnsignedInt(options.secondLastDrivingClickFrame);
    saver.xferBool(options.manualTargetMode);
    saver.xferBool(options.scriptedWaypointMode);
    saver.xferUnsignedInt(options.nextDestWaypointID);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceToppleUpdateModuleData(options: {
  nextCallFrame: number;
  angularVelocity: number;
  angularAcceleration: number;
  toppleDirection: { x: number; y: number; z: number };
  toppleState: number;
  angularAccumulation: number;
  angleDeltaX: number;
  numAngleDeltaX: number;
  doBounceFx: boolean;
  toppleOptions: number;
  stumpId: number;
}): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-topple-update');
  try {
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferUnsignedInt(sourceUpdateFrameAndPhase(options.nextCallFrame));
    saver.xferReal(options.angularVelocity);
    saver.xferReal(options.angularAcceleration);
    saver.xferCoord3D(options.toppleDirection);
    saver.xferUser(sourceRawInt32(options.toppleState));
    saver.xferReal(options.angularAccumulation);
    saver.xferReal(options.angleDeltaX);
    saver.xferInt(options.numAngleDeltaX);
    saver.xferBool(options.doBounceFx);
    saver.xferUnsignedInt(options.toppleOptions);
    saver.xferObjectID(options.stumpId);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceStructureToppleUpdateModuleData(options: {
  nextCallFrame: number;
  toppleFrame: number;
  toppleDirection: { x: number; y: number };
  toppleState: number;
  toppleVelocity: number;
  accumulatedAngle: number;
  structuralIntegrity: number;
  lastCrushedLocation: number;
  nextBurstFrame: number;
  delayBurstLocation: { x: number; y: number; z: number };
}): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-structure-topple-update');
  try {
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferUnsignedInt(sourceUpdateFrameAndPhase(options.nextCallFrame));
    saver.xferUnsignedInt(options.toppleFrame);
    saver.xferReal(options.toppleDirection.x);
    saver.xferReal(options.toppleDirection.y);
    saver.xferUser(sourceRawInt32(options.toppleState));
    saver.xferReal(options.toppleVelocity);
    saver.xferReal(options.accumulatedAngle);
    saver.xferReal(options.structuralIntegrity);
    saver.xferReal(options.lastCrushedLocation);
    saver.xferInt(options.nextBurstFrame);
    saver.xferCoord3D(options.delayBurstLocation);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceGrantStealthBehaviorModuleData(options: {
  nextCallFrame: number;
  radiusParticleSystemId: number;
  currentScanRadius: number;
}): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-grant-stealth-behavior');
  try {
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferUnsignedInt(sourceUpdateFrameAndPhase(options.nextCallFrame));
    saver.xferUnsignedInt(options.radiusParticleSystemId);
    saver.xferReal(options.currentScanRadius);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceCountermeasuresBehaviorModuleData(options: {
  nextCallFrame: number;
  upgradeExecuted: boolean;
  flareIds: number[];
  availableCountermeasures: number;
  activeCountermeasures: number;
  divertedMissiles: number;
  incomingMissiles: number;
  reactionFrame: number;
  nextVolleyFrame: number;
}): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-countermeasures-behavior');
  try {
    saver.xferVersion(2);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferUnsignedInt(sourceUpdateFrameAndPhase(options.nextCallFrame));
    saver.xferVersion(1);
    saver.xferBool(options.upgradeExecuted);
    saver.xferObjectIDList(options.flareIds);
    saver.xferUnsignedInt(options.availableCountermeasures);
    saver.xferUnsignedInt(options.activeCountermeasures);
    saver.xferUnsignedInt(options.divertedMissiles);
    saver.xferUnsignedInt(options.incomingMissiles);
    saver.xferUnsignedInt(options.reactionFrame);
    saver.xferUnsignedInt(options.nextVolleyFrame);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceHordeUpdateModuleData(options: {
  nextCallFrame: number;
  inHorde: boolean;
  hasFlag: boolean;
}): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-horde-update');
  try {
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferUnsignedInt(sourceUpdateFrameAndPhase(options.nextCallFrame));
    saver.xferBool(options.inHorde);
    saver.xferBool(options.hasFlag);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceFireOclAfterCooldownUpdateModuleData(options: {
  nextCallFrame: number;
  upgradeExecuted: boolean;
  valid: boolean;
  consecutiveShots: number;
  startFrame: number;
}): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-fire-ocl-after-cooldown-update');
  try {
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferUnsignedInt(sourceUpdateFrameAndPhase(options.nextCallFrame));
    saver.xferVersion(1);
    saver.xferBool(options.upgradeExecuted);
    saver.xferBool(options.valid);
    saver.xferUnsignedInt(options.consecutiveShots);
    saver.xferUnsignedInt(options.startFrame);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceRadiusDecalUpdateModuleData(options: {
  nextCallFrame: number;
  killWhenNoLongerAttacking: boolean;
}): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-radius-decal-update');
  try {
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferUnsignedInt(sourceUpdateFrameAndPhase(options.nextCallFrame));
    saver.xferBool(options.killWhenNoLongerAttacking);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceCleanupHazardUpdateModuleData(options: {
  nextCallFrame: number;
  bestTargetId: number;
  inRange: boolean;
  nextScanFrames: number;
  nextShotAvailableInFrames: number;
  position: { x: number; y: number; z: number };
  moveRange: number;
}): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-cleanup-hazard-update');
  try {
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferUnsignedInt(sourceUpdateFrameAndPhase(options.nextCallFrame));
    saver.xferObjectID(options.bestTargetId);
    saver.xferBool(options.inRange);
    saver.xferInt(options.nextScanFrames);
    saver.xferInt(options.nextShotAvailableInFrames);
    saver.xferCoord3D(options.position);
    saver.xferReal(options.moveRange);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceDynamicShroudClearingRangeUpdateModuleData(options: {
  nextCallFrame: number;
  stateCountdown: number;
  totalFrames: number;
  growStartDeadline: number;
  sustainDeadline: number;
  shrinkStartDeadline: number;
  doneForeverFrame: number;
  changeIntervalCountdown: number;
  decalsCreated: boolean;
  visionChangePerInterval: number;
  nativeClearingRange: number;
  currentClearingRange: number;
}): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-dynamic-shroud-clearing-range-update');
  try {
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferUnsignedInt(sourceUpdateFrameAndPhase(options.nextCallFrame));
    saver.xferInt(options.stateCountdown);
    saver.xferInt(options.totalFrames);
    saver.xferUnsignedInt(options.growStartDeadline);
    saver.xferUnsignedInt(options.sustainDeadline);
    saver.xferUnsignedInt(options.shrinkStartDeadline);
    saver.xferUnsignedInt(options.doneForeverFrame);
    saver.xferUnsignedInt(options.changeIntervalCountdown);
    saver.xferBool(options.decalsCreated);
    saver.xferReal(options.visionChangePerInterval);
    saver.xferReal(options.nativeClearingRange);
    saver.xferReal(options.currentClearingRange);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceStealthDetectorUpdateModuleData(options: {
  nextCallFrame: number;
  enabled: boolean;
}): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-stealth-detector-update');
  try {
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferUnsignedInt(sourceUpdateFrameAndPhase(options.nextCallFrame));
    saver.xferBool(options.enabled);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourcePhysicsBehaviorModuleData(options: {
  nextCallFrame: number;
  yawRate: number;
  rollRate: number;
  pitchRate: number;
  accel: { x: number; y: number; z: number };
  prevAccel: { x: number; y: number; z: number };
  vel: { x: number; y: number; z: number };
  turning: number;
  ignoreCollisionsWith: number;
  flags: number;
  mass: number;
  currentOverlap: number;
  previousOverlap: number;
  motiveForceExpires: number;
  extraBounciness: number;
  extraFriction: number;
  velMag: number;
}): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-physics-behavior');
  try {
    saver.xferVersion(2);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferUnsignedInt(sourceUpdateFrameAndPhase(options.nextCallFrame));
    saver.xferReal(options.yawRate);
    saver.xferReal(options.rollRate);
    saver.xferReal(options.pitchRate);
    saver.xferCoord3D(options.accel);
    saver.xferCoord3D(options.prevAccel);
    saver.xferCoord3D(options.vel);
    saver.xferUser(sourceRawInt32(options.turning));
    saver.xferObjectID(options.ignoreCollisionsWith);
    saver.xferInt(options.flags);
    saver.xferReal(options.mass);
    saver.xferObjectID(options.currentOverlap);
    saver.xferObjectID(options.previousOverlap);
    saver.xferUnsignedInt(options.motiveForceExpires);
    saver.xferReal(options.extraBounciness);
    saver.xferReal(options.extraFriction);
    saver.xferReal(options.velMag);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceLifetimeUpdateModuleData(options: {
  nextCallFrame: number;
  dieFrame: number;
}): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-lifetime-update');
  try {
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferUnsignedInt(sourceUpdateFrameAndPhase(options.nextCallFrame));
    saver.xferUnsignedInt(options.dieFrame);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceDeletionUpdateModuleData(options: {
  nextCallFrame: number;
  dieFrame: number;
}): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-deletion-update');
  try {
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferUnsignedInt(sourceUpdateFrameAndPhase(options.nextCallFrame));
    saver.xferUnsignedInt(options.dieFrame);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceAutoFindHealingUpdateModuleData(options: {
  nextCallFrame: number;
  nextScanFrames: number;
}): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-auto-find-healing-update');
  try {
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferUnsignedInt(sourceUpdateFrameAndPhase(options.nextCallFrame));
    saver.xferInt(options.nextScanFrames);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceAutoDepositUpdateModuleData(options: {
  version?: 1 | 2;
  nextCallFrame: number;
  depositOnFrame: number;
  awardInitialCaptureBonus: boolean;
  initialized: boolean;
}): Uint8Array {
  const version = options.version ?? 2;
  const saver = new XferSave();
  saver.open('test-source-auto-deposit-update');
  try {
    saver.xferVersion(version);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferUnsignedInt(sourceUpdateFrameAndPhase(options.nextCallFrame));
    saver.xferUnsignedInt(options.depositOnFrame);
    saver.xferBool(options.awardInitialCaptureBonus);
    if (version > 1) {
      saver.xferBool(options.initialized);
    }
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceBaseRegenerateUpdateModuleData(options: {
  nextCallFrame: number;
}): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-base-regenerate-update');
  try {
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferUnsignedInt(sourceUpdateFrameAndPhase(options.nextCallFrame));
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceCommandButtonHuntUpdateModuleData(options: {
  nextCallFrame: number;
  commandButtonName: string;
}): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-command-button-hunt-update');
  try {
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferUnsignedInt(sourceUpdateFrameAndPhase(options.nextCallFrame));
    saver.xferAsciiString(options.commandButtonName);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceFireSpreadUpdateModuleData(options: {
  nextCallFrame: number;
}): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-fire-spread-update');
  try {
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferUnsignedInt(sourceUpdateFrameAndPhase(options.nextCallFrame));
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceFlammableUpdateModuleData(options: {
  nextCallFrame: number;
  status: number;
  aflameEndFrame: number;
  burnedEndFrame: number;
  damageEndFrame: number;
  flameDamageLimit: number;
  lastFlameDamageDealt: number;
}): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-flammable-update');
  try {
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferUnsignedInt(sourceUpdateFrameAndPhase(options.nextCallFrame));
    saver.xferUser(sourceRawInt32(options.status));
    saver.xferUnsignedInt(options.aflameEndFrame);
    saver.xferUnsignedInt(options.burnedEndFrame);
    saver.xferUnsignedInt(options.damageEndFrame);
    saver.xferReal(options.flameDamageLimit);
    saver.xferUnsignedInt(options.lastFlameDamageDealt);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceHeightDieUpdateModuleData(options: {
  nextCallFrame: number;
  hasDied: boolean;
  particlesDestroyed: boolean;
  lastPosition: { x: number; y: number; z: number };
  earliestDeathFrame: number;
}): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-height-die-update');
  try {
    saver.xferVersion(2);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferUnsignedInt(sourceUpdateFrameAndPhase(options.nextCallFrame));
    saver.xferBool(options.hasDied);
    saver.xferBool(options.particlesDestroyed);
    saver.xferCoord3D(options.lastPosition);
    saver.xferUnsignedInt(options.earliestDeathFrame);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceStickyBombUpdateModuleData(options: {
  nextCallFrame: number;
  targetId: number;
  dieFrame: number;
  nextPingFrame: number;
}): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-sticky-bomb-update');
  try {
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferUnsignedInt(sourceUpdateFrameAndPhase(options.nextCallFrame));
    saver.xferObjectID(options.targetId);
    saver.xferUnsignedInt(options.dieFrame);
    saver.xferUnsignedInt(options.nextPingFrame);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

describe('source-owned game-logic core save-state', () => {
  it('rebuilds live entities from source GameLogic Object::xfer import state', () => {
    const bundle = makeSourceOwnedCoreBundle();
    const registry = makeRegistry(bundle);
    const map = makeMap([], 64, 64);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(64, 64));

    const sourceState = createEmptySourceMapEntitySaveState();
    const disabledTillFrame = Array.from({ length: 13 }, () => 0);
    disabledTillFrame[2] = 90;
    sourceState.objectId = 42;
    sourceState.position = { x: 24, y: 3, z: 28 };
    sourceState.orientation = 0.75;
    sourceState.internalName = 'SAVED_BARRACKS';
    sourceState.statusBits = ['CAN_ATTACK'];
    sourceState.scriptStatus = 0x04 | 0x10;
    sourceState.disabledMask = ['DISABLED_EMP'];
    sourceState.disabledTillFrame = disabledTillFrame;
    sourceState.completedUpgradeNames = ['Upgrade_A'];
    sourceState.commandSetStringOverride = 'CommandSet_Saved';
    sourceState.modules = [{
      identifier: 'ModuleTag_Body',
      blockData: buildSourceActiveBodyModuleData({
        health: 321,
        maxHealth: 500,
        initialHealth: 450,
        subdualDamage: 17,
        damageScalar: 0.75,
        frontCrushed: true,
        backCrushed: true,
        indestructible: true,
        armorSetFlags: ['VETERAN'],
      }),
    }];

    logic.restoreSourceGameLogicImportSaveState({
      version: 1,
      sourceChunkVersion: 10,
      frameCounter: 77,
      objectIdCounter: 100,
      objects: [{
        templateName: 'AmericaBarracks',
        state: sourceState,
      }],
      scriptScoringEnabled: false,
      rankLevelLimit: 3,
    });

    const privateLogic = logic as unknown as {
      frameCounter: number;
      spawnedEntities: Map<number, {
        id: number;
        templateName: string;
        scriptName: string | null;
        x: number;
        y: number;
        z: number;
        rotationY: number;
        objectStatusFlags: Set<string>;
        disabledEmpUntilFrame: number;
        completedUpgrades: Set<string>;
        commandSetStringOverride: string | null;
        health: number;
        maxHealth: number;
        initialHealth: number;
        currentSubdualDamage: number;
        battlePlanDamageScalar: number;
        frontCrushed: boolean;
        backCrushed: boolean;
        isIndestructible: boolean;
        armorSetFlagsMask: number;
      }>;
      scriptScoringEnabled: boolean;
      rankLevelLimit: number;
    };

    expect(privateLogic.frameCounter).toBe(77);
    expect(privateLogic.scriptScoringEnabled).toBe(false);
    expect(privateLogic.rankLevelLimit).toBe(3);
    expect(logic.getObjectIdCounter()).toBe(100);
    expect([...privateLogic.spawnedEntities.keys()]).toEqual([42]);

    const entity = privateLogic.spawnedEntities.get(42)!;
    expect(entity.templateName).toBe('AmericaBarracks');
    expect(entity.scriptName).toBe('SAVED_BARRACKS');
    expect(entity.x).toBe(24);
    expect(entity.y).toBe(3);
    expect(entity.z).toBe(28);
    expect(entity.rotationY).toBe(0.75);
    expect(entity.objectStatusFlags.has('CAN_ATTACK')).toBe(true);
    expect(entity.objectStatusFlags.has('DISABLED_EMP')).toBe(true);
    expect(entity.objectStatusFlags.has('SCRIPT_UNSELLABLE')).toBe(true);
    expect(entity.objectStatusFlags.has('SCRIPT_TARGETABLE')).toBe(true);
    expect(entity.disabledEmpUntilFrame).toBe(90);
    expect(entity.completedUpgrades).toEqual(new Set(['Upgrade_A']));
    expect(entity.commandSetStringOverride).toBe('CommandSet_Saved');
    expect(entity.health).toBe(321);
    expect(entity.maxHealth).toBe(500);
    expect(entity.initialHealth).toBe(450);
    expect(entity.currentSubdualDamage).toBe(17);
    expect(entity.battlePlanDamageScalar).toBe(0.75);
    expect(entity.frontCrushed).toBe(true);
    expect(entity.backCrushed).toBe(true);
    expect(entity.isIndestructible).toBe(true);
    expect(entity.armorSetFlagsMask).toBe(ARMOR_SET_FLAG_MASK_BY_NAME.get('VETERAN'));
  });

  it('imports source ProductionUpdate queue state into live production entries', () => {
    const bundle = makeSourceOwnedCoreBundle();
    const registry = makeRegistry(bundle);
    const map = makeMap([], 64, 64);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(64, 64));

    const sourceState = createEmptySourceMapEntitySaveState();
    sourceState.objectId = 43;
    sourceState.position = { x: 20, y: 0, z: 20 };
    sourceState.orientation = 0;
    sourceState.modules = [{
      identifier: 'ModuleTag_Production',
      blockData: buildSourceProductionUpdateModuleData({
        uniqueId: 9,
        queue: [
          {
            type: 1,
            name: 'AmericaRanger',
            productionId: 7,
            percentComplete: 40,
            framesUnderConstruction: 60,
            productionQuantityTotal: 2,
            productionQuantityProduced: 1,
            exitDoor: -1,
          },
          {
            type: 2,
            name: 'Upgrade_AmericaRangerCaptureBuilding',
            productionId: 0,
            percentComplete: 25,
            framesUnderConstruction: 225,
            productionQuantityTotal: 0,
            productionQuantityProduced: 0,
            exitDoor: -1,
          },
        ],
      }),
    }];

    logic.restoreSourceGameLogicImportSaveState({
      version: 1,
      sourceChunkVersion: 10,
      frameCounter: 77,
      objectIdCounter: 100,
      objects: [{
        templateName: 'AmericaBarracks',
        state: sourceState,
      }],
    });

    const privateLogic = logic as unknown as {
      spawnedEntities: Map<number, {
        productionNextId: number;
        productionQueue: Array<
          | {
            type: 'UNIT';
            templateName: string;
            productionId: number;
            buildCost: number;
            totalProductionFrames: number;
            framesUnderConstruction: number;
            percentComplete: number;
            productionQuantityTotal: number;
            productionQuantityProduced: number;
          }
          | {
            type: 'UPGRADE';
            upgradeName: string;
            productionId: number;
            buildCost: number;
            totalProductionFrames: number;
            framesUnderConstruction: number;
            percentComplete: number;
            upgradeType: 'PLAYER' | 'OBJECT';
          }
        >;
      }>;
      hasSideUpgradeInProduction(side: string, upgradeName: string): boolean;
    };

    const entity = privateLogic.spawnedEntities.get(43)!;
    expect(entity.productionNextId).toBe(9);
    expect(entity.productionQueue).toHaveLength(2);
    expect(entity.productionQueue[0]).toEqual({
      type: 'UNIT',
      templateName: 'AmericaRanger',
      productionId: 7,
      buildCost: 225,
      totalProductionFrames: 150,
      framesUnderConstruction: 60,
      percentComplete: 40,
      productionQuantityTotal: 2,
      productionQuantityProduced: 1,
    });
    expect(entity.productionQueue[1]).toEqual({
      type: 'UPGRADE',
      upgradeName: 'UPGRADE_AMERICARANGERCAPTUREBUILDING',
      productionId: 0,
      buildCost: 1000,
      totalProductionFrames: 900,
      framesUnderConstruction: 225,
      percentComplete: 25,
      upgradeType: 'PLAYER',
    });
    expect(privateLogic.hasSideUpgradeInProduction(
      'America',
      'Upgrade_AmericaRangerCaptureBuilding',
    )).toBe(true);
  });

  it('imports source DockUpdate-owned warehouse and repair dock state', () => {
    const bundle = makeSourceOwnedCoreBundle();
    const registry = makeRegistry(bundle);
    const map = makeMap([], 64, 64);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(64, 64));

    const warehouseState = createEmptySourceMapEntitySaveState();
    warehouseState.objectId = 44;
    warehouseState.position = { x: 10, y: 0, z: 10 };
    warehouseState.modules = [{
      identifier: 'ModuleTag_Dock',
      blockData: buildSourceSupplyWarehouseDockUpdateModuleData({
        boxesStored: 13,
        numberApproachPositions: 3,
        approachPositionOwners: [101, 0, 102],
        dockCrippled: true,
      }),
    }];

    const repairState = createEmptySourceMapEntitySaveState();
    repairState.objectId = 45;
    repairState.position = { x: 12, y: 0, z: 12 };
    repairState.modules = [{
      identifier: 'ModuleTag_Dock',
      blockData: buildSourceRepairDockUpdateModuleData({
        lastRepair: 77,
        healthToAddPerFrame: 1.25,
        numberApproachPositions: 2,
        approachPositionOwners: [201],
      }),
    }];

    logic.restoreSourceGameLogicImportSaveState({
      version: 1,
      sourceChunkVersion: 10,
      frameCounter: 77,
      objectIdCounter: 100,
      objects: [
        { templateName: 'SupplyPile', state: warehouseState },
        { templateName: 'RepairBay', state: repairState },
      ],
    });

    const privateLogic = logic as unknown as {
      spawnedEntities: Map<number, {
        swCripplingDockDisabled: boolean;
        repairDockLastRepairEntityId: number;
        repairDockHealthToAddPerFrame: number;
      }>;
      supplyWarehouseStates: Map<number, { currentBoxes: number }>;
      dockApproachStates: Map<number, { currentDockerCount: number; maxDockers: number }>;
    };

    expect(privateLogic.supplyWarehouseStates.get(44)).toEqual({ currentBoxes: 13 });
    expect(privateLogic.dockApproachStates.get(44)).toEqual({
      currentDockerCount: 2,
      maxDockers: 3,
    });
    expect(privateLogic.spawnedEntities.get(44)!.swCripplingDockDisabled).toBe(true);
    expect(privateLogic.dockApproachStates.get(45)).toEqual({
      currentDockerCount: 1,
      maxDockers: 2,
    });
    expect(privateLogic.spawnedEntities.get(45)!.repairDockLastRepairEntityId).toBe(77);
    expect(privateLogic.spawnedEntities.get(45)!.repairDockHealthToAddPerFrame).toBe(1.25);
  });

  it('imports source RailedTransportAIUpdate and RailedTransportDockUpdate state', () => {
    const bundle = makeSourceOwnedCoreBundle();
    const registry = makeRegistry(bundle);
    const map = makeMap([], 64, 64);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(64, 64));

    const railedState = createEmptySourceMapEntitySaveState();
    railedState.objectId = 46;
    railedState.position = { x: 20, y: 0, z: 20 };
    railedState.modules = [{
      identifier: 'ModuleTag_RailedAI',
      blockData: buildSourceRailedTransportAIUpdateModuleData({
        inTransit: true,
        paths: [
          { startWaypointID: 1001, endWaypointID: 1002 },
          { startWaypointID: 1003, endWaypointID: 1004 },
        ],
        currentPath: 1,
        waypointDataLoaded: true,
      }),
    }, {
      identifier: 'ModuleTag_RailedDock',
      blockData: buildSourceRailedTransportDockUpdateModuleData({
        dockingObjectId: 201,
        pullInsideDistancePerFrame: 1.5,
        unloadingObjectId: 202,
        pushOutsideDistancePerFrame: 2.5,
        unloadCount: -1,
        numberApproachPositions: 2,
        approachPositionOwners: [301, 0],
      }),
    }];

    logic.restoreSourceGameLogicImportSaveState({
      version: 1,
      sourceChunkVersion: 10,
      frameCounter: 77,
      objectIdCounter: 100,
      objects: [
        { templateName: 'RailedTransportObject', state: railedState },
      ],
    });

    const privateLogic = logic as unknown as {
      spawnedEntities: Map<number, {
        railedTransportState: unknown;
      }>;
      dockApproachStates: Map<number, { currentDockerCount: number; maxDockers: number }>;
    };

    expect(privateLogic.spawnedEntities.get(46)!.railedTransportState).toEqual({
      inTransit: true,
      waypointDataLoaded: true,
      paths: [
        { startWaypointID: 1001, endWaypointID: 1002 },
        { startWaypointID: 1003, endWaypointID: 1004 },
      ],
      currentPath: 1,
      transitWaypointIds: [],
      transitWaypointIndex: 0,
      dockState: {
        dockingObjectId: 201,
        pullInsideDistancePerFrame: 1.5,
        unloadingObjectId: 202,
        pushOutsideDistancePerFrame: 2.5,
        unloadCount: -1,
      },
    });
    expect(privateLogic.dockApproachStates.get(46)).toEqual({
      currentDockerCount: 1,
      maxDockers: 2,
    });
  });

  it('imports source SpawnBehavior slave and replacement state', () => {
    const bundle = makeSourceOwnedCoreBundle();
    const registry = makeRegistry(bundle);
    const map = makeMap([], 64, 64);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(64, 64));

    const sourceState = createEmptySourceMapEntitySaveState();
    sourceState.objectId = 46;
    sourceState.position = { x: 30, y: 0, z: 30 };
    sourceState.modules = [{
      identifier: 'ModuleTag_Spawn',
      blockData: buildSourceSpawnBehaviorModuleData({
        initialBurstTimesInited: true,
        spawnTemplateName: 'DroneB',
        oneShotCountdown: 2,
        replacementTimes: [88, 99],
        spawnIds: [1001, 1002],
        active: false,
        aggregateHealth: true,
        spawnCount: 2,
        selfTaskingSpawnCount: 1,
      }),
    }];

    logic.restoreSourceGameLogicImportSaveState({
      version: 1,
      sourceChunkVersion: 10,
      frameCounter: 77,
      objectIdCounter: 100,
      objects: [{
        templateName: 'DroneSpawner',
        state: sourceState,
      }],
    });

    const privateLogic = logic as unknown as {
      spawnedEntities: Map<number, {
        spawnBehaviorState: {
          slaveIds: number[];
          replacementFrames: number[];
          templateNameIndex: number;
          oneShotRemaining: number;
          oneShotCompleted: boolean;
          initialBurstApplied: boolean;
        } | null;
      }>;
    };

    const state = privateLogic.spawnedEntities.get(46)!.spawnBehaviorState!;
    expect(state.slaveIds).toEqual([1001, 1002]);
    expect(state.replacementFrames).toEqual([88, 99]);
    expect(state.templateNameIndex).toBe(1);
    expect(state.oneShotRemaining).toBe(2);
    expect(state.oneShotCompleted).toBe(true);
    expect(state.initialBurstApplied).toBe(true);
  });

  it('imports source SpecialPowerModule ready and pause state', () => {
    const bundle = makeSourceOwnedCoreBundle();
    const registry = makeRegistry(bundle);
    const map = makeMap([], 64, 64);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(64, 64));

    const sourceState = createEmptySourceMapEntitySaveState();
    sourceState.objectId = 47;
    sourceState.position = { x: 34, y: 0, z: 34 };
    sourceState.modules = [{
      identifier: 'ModuleTag_Bomb',
      blockData: buildSourceSpecialPowerModuleData({
        availableOnFrame: 180,
        pausedCount: 2,
        pausedOnFrame: 91,
        pausedPercent: 0.375,
      }),
    }];

    logic.restoreSourceGameLogicImportSaveState({
      version: 1,
      sourceChunkVersion: 10,
      frameCounter: 120,
      objectIdCounter: 100,
      objects: [{
        templateName: 'SpecialPowerBuilding',
        state: sourceState,
      }],
    });

    const privateLogic = logic as unknown as {
      spawnedEntities: Map<number, {
        specialPowerModules: Map<string, {
          availableOnFrame: number;
          pausedCount: number;
          pausedOnFrame: number;
          pausedPercent: number;
        }>;
      }>;
      shortcutSpecialPowerSourceByName: Map<string, Map<number, number>>;
      pausedShortcutSpecialPowerByName: Map<string, Map<number, { pausedCount: number; pausedOnFrame: number }>>;
    };

    const module = privateLogic.spawnedEntities.get(47)!.specialPowerModules.get('SUPERWEAPONTEST')!;
    expect(module.availableOnFrame).toBe(180);
    expect(module.pausedCount).toBe(2);
    expect(module.pausedOnFrame).toBe(91);
    expect(module.pausedPercent).toBe(0.375);
    expect(privateLogic.shortcutSpecialPowerSourceByName.get('SUPERWEAPONTEST')?.get(47)).toBe(180);
    expect(privateLogic.pausedShortcutSpecialPowerByName.get('SUPERWEAPONTEST')?.get(47)).toEqual({
      pausedCount: 2,
      pausedOnFrame: 91,
    });
    expect(logic.resolveShortcutSpecialPowerReadyFrameForSourceEntity('SuperweaponTest', 47)).toBe(209);
    expect(logic.getSpecialPowerPercentReady('SuperweaponTest', 47)).toBe(0.375);
  });

  it('imports source StealthUpdate timing and disguise state', () => {
    const bundle = makeSourceOwnedCoreBundle();
    const registry = makeRegistry(bundle);
    const map = makeMap([], 64, 64);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(64, 64));

    const sourceState = createEmptySourceMapEntitySaveState();
    sourceState.objectId = 48;
    sourceState.position = { x: 38, y: 0, z: 38 };
    sourceState.statusBits = ['CAN_STEALTH', 'STEALTHED'];
    sourceState.modules = [{
      identifier: 'ModuleTag_Stealth',
      blockData: buildSourceStealthUpdateModuleData({
        stealthAllowedFrame: 150,
        detectionExpiresFrame: 240,
        enabled: true,
        pulsePhaseRate: 0.125,
        pulsePhase: 1.75,
        disguiseAsPlayerIndex: 2,
        disguiseTemplateName: 'AmericaRanger',
        disguiseTransitionFrames: 11,
        disguiseHalfpointReached: true,
        transitioningToDisguise: true,
        disguised: true,
        framesGranted: 45,
      }),
    }];

    logic.restoreSourceGameLogicImportSaveState({
      version: 1,
      sourceChunkVersion: 10,
      frameCounter: 120,
      objectIdCounter: 100,
      objects: [{
        templateName: 'StealthUnit',
        state: sourceState,
      }],
    });

    const privateLogic = logic as unknown as {
      spawnedEntities: Map<number, {
        objectStatusFlags: Set<string>;
        stealthDelayRemaining: number;
        detectedUntilFrame: number;
        stealthEnabled: boolean;
        stealthPulsePhaseRate: number;
        stealthPulsePhase: number;
        stealthDisguisePlayerIndex: number;
        disguiseTemplateName: string | null;
        stealthDisguiseTransitionFrames: number;
        stealthDisguiseHalfpointReached: boolean;
        stealthTransitioningToDisguise: boolean;
        temporaryStealthGrant: boolean;
        temporaryStealthExpireFrame: number;
      }>;
    };

    const entity = privateLogic.spawnedEntities.get(48)!;
    expect(entity.stealthDelayRemaining).toBe(30);
    expect(entity.detectedUntilFrame).toBe(240);
    expect(entity.stealthEnabled).toBe(true);
    expect(entity.stealthPulsePhaseRate).toBe(0.125);
    expect(entity.stealthPulsePhase).toBe(1.75);
    expect(entity.stealthDisguisePlayerIndex).toBe(2);
    expect(entity.disguiseTemplateName).toBe('AmericaRanger');
    expect(entity.stealthDisguiseTransitionFrames).toBe(11);
    expect(entity.stealthDisguiseHalfpointReached).toBe(true);
    expect(entity.stealthTransitioningToDisguise).toBe(true);
    expect(entity.temporaryStealthGrant).toBe(true);
    expect(entity.temporaryStealthExpireFrame).toBe(165);
    expect(entity.objectStatusFlags.has('DISGUISED')).toBe(true);
  });

  it('imports source Contain passenger lists after all objects are created', () => {
    const bundle = makeSourceOwnedCoreBundle();
    const registry = makeRegistry(bundle);
    const map = makeMap([], 64, 64);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(64, 64));

    const transportState = createEmptySourceMapEntitySaveState();
    transportState.objectId = 50;
    transportState.position = { x: 40, y: 0, z: 40 };
    transportState.modules = [{
      identifier: 'ModuleTag_Contain',
      blockData: buildSourceTransportContainModuleData({
        passengerIds: [61],
        passengerAllowedToFire: true,
        payloadCreated: true,
      }),
    }];

    const garrisonState = createEmptySourceMapEntitySaveState();
    garrisonState.objectId = 51;
    garrisonState.position = { x: 44, y: 0, z: 40 };
    garrisonState.modules = [{
      identifier: 'ModuleTag_Contain',
      blockData: buildSourceGarrisonContainModuleData({
        passengerIds: [62],
        passengerAllowedToFire: true,
      }),
    }];

    const caveState = createEmptySourceMapEntitySaveState();
    caveState.objectId = 52;
    caveState.position = { x: 48, y: 0, z: 40 };
    caveState.modules = [{
      identifier: 'ModuleTag_Contain',
      blockData: buildSourceCaveContainModuleData({
        passengerIds: [63],
        caveIndex: 7,
      }),
    }];

    const transportPassengerState = createEmptySourceMapEntitySaveState();
    transportPassengerState.objectId = 61;
    transportPassengerState.position = { x: 60, y: 0, z: 40 };
    const garrisonPassengerState = createEmptySourceMapEntitySaveState();
    garrisonPassengerState.objectId = 62;
    garrisonPassengerState.position = { x: 64, y: 0, z: 40 };
    const cavePassengerState = createEmptySourceMapEntitySaveState();
    cavePassengerState.objectId = 63;
    cavePassengerState.position = { x: 68, y: 0, z: 40 };

    logic.restoreSourceGameLogicImportSaveState({
      version: 1,
      sourceChunkVersion: 10,
      frameCounter: 120,
      objectIdCounter: 100,
      objects: [
        { templateName: 'TransportBox', state: transportState },
        { templateName: 'GarrisonBunker', state: garrisonState },
        { templateName: 'CaveNode', state: caveState },
        { templateName: 'AmericaRanger', state: transportPassengerState },
        { templateName: 'AmericaRanger', state: garrisonPassengerState },
        { templateName: 'AmericaRanger', state: cavePassengerState },
      ],
    });

    const privateLogic = logic as unknown as {
      spawnedEntities: Map<number, {
        containProfile: { passengersAllowedToFire: boolean; caveIndex?: number } | null;
        initialPayloadCreated: boolean;
        transportContainerId: number | null;
        garrisonContainerId: number | null;
        tunnelContainerId: number | null;
        objectStatusFlags: Set<string>;
      }>;
      caveTrackerIndexByEntityId: Map<number, number>;
      caveTrackers: Map<number, { tunnelIds: Set<number>; passengerIds: Set<number> }>;
    };

    const transport = privateLogic.spawnedEntities.get(50)!;
    const garrison = privateLogic.spawnedEntities.get(51)!;
    const cave = privateLogic.spawnedEntities.get(52)!;
    const transportPassenger = privateLogic.spawnedEntities.get(61)!;
    const garrisonPassenger = privateLogic.spawnedEntities.get(62)!;
    const cavePassenger = privateLogic.spawnedEntities.get(63)!;

    expect(transport.initialPayloadCreated).toBe(true);
    expect(transport.containProfile?.passengersAllowedToFire).toBe(true);
    expect(transportPassenger.transportContainerId).toBe(50);
    expect(transportPassenger.objectStatusFlags.has('MASKED')).toBe(true);
    expect(garrison.containProfile?.passengersAllowedToFire).toBe(true);
    expect(garrisonPassenger.garrisonContainerId).toBe(51);
    expect(garrisonPassenger.objectStatusFlags.has('DISABLED_HELD')).toBe(true);
    expect(cave.containProfile?.caveIndex).toBe(7);
    expect(privateLogic.caveTrackerIndexByEntityId.get(52)).toBe(7);
    expect(cavePassenger.tunnelContainerId).toBe(52);
    expect(privateLogic.caveTrackers.get(7)?.tunnelIds.has(52)).toBe(true);
    expect(privateLogic.caveTrackers.get(7)?.passengerIds.has(63)).toBe(true);
  });

  it('imports source SpyVisionUpdate active and timer state', () => {
    const bundle = makeSourceOwnedCoreBundle();
    const registry = makeRegistry(bundle);
    const map = makeMap([], 64, 64);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(64, 64));

    const sourceState = createEmptySourceMapEntitySaveState();
    sourceState.objectId = 70;
    sourceState.position = { x: 70, y: 0, z: 40 };
    sourceState.modules = [{
      identifier: 'ModuleTag_SpyUpdate',
      blockData: buildSourceSpyVisionUpdateModuleData({
        deactivateFrame: 300,
        currentlyActive: true,
        resetTimersNextUpdate: true,
        disabledUntilFrame: 180,
      }),
    }];

    logic.restoreSourceGameLogicImportSaveState({
      version: 1,
      sourceChunkVersion: 10,
      frameCounter: 120,
      objectIdCounter: 100,
      objects: [{
        templateName: 'SpyVisionBuilding',
        state: sourceState,
      }],
    });

    const privateLogic = logic as unknown as {
      spawnedEntities: Map<number, {
        specialPowerModules: Map<string, {
          spyVisionDeactivateFrame: number;
          spyVisionCurrentlyActive?: boolean;
          spyVisionResetTimersNextUpdate?: boolean;
          spyVisionDisabledUntilFrame?: number;
        }>;
      }>;
    };

    const module = privateLogic.spawnedEntities.get(70)!.specialPowerModules.get('SPYVISIONPOWER')!;
    expect(module.spyVisionDeactivateFrame).toBe(300);
    expect(module.spyVisionCurrentlyActive).toBe(true);
    expect(module.spyVisionResetTimersNextUpdate).toBe(true);
    expect(module.spyVisionDisabledUntilFrame).toBe(180);
  });

  it('imports source SpecialAbilityUpdate runtime state', () => {
    const bundle = makeSourceOwnedCoreBundle();
    const registry = makeRegistry(bundle);
    const map = makeMap([], 64, 64);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(64, 64));

    const abilityState = createEmptySourceMapEntitySaveState();
    abilityState.objectId = 71;
    abilityState.position = { x: 74, y: 0, z: 40 };
    abilityState.modules = [{
      identifier: 'ModuleTag_Ability',
      blockData: buildSourceSpecialAbilityUpdateModuleData({
        active: true,
        prepFrames: 12,
        animFrames: 8,
        targetId: 72,
        targetPos: { x: 0, y: 0, z: 0 },
        noTargetCommand: false,
        packingState: 1,
        facingInitiated: true,
        facingComplete: false,
        withinStartAbilityRange: true,
        doDisableFxParticles: false,
        captureFlashPhase: 0.625,
      }),
    }];
    const targetState = createEmptySourceMapEntitySaveState();
    targetState.objectId = 72;
    targetState.position = { x: 78, y: 0, z: 40 };

    logic.restoreSourceGameLogicImportSaveState({
      version: 1,
      sourceChunkVersion: 10,
      frameCounter: 120,
      objectIdCounter: 100,
      objects: [
        { templateName: 'AbilityUnit', state: abilityState },
        { templateName: 'AmericaRanger', state: targetState },
      ],
    });

    const privateLogic = logic as unknown as {
      spawnedEntities: Map<number, {
        specialAbilityState: {
          active: boolean;
          prepFrames: number;
          animFrames: number;
          targetEntityId: number | null;
          targetX: number | null;
          targetZ: number | null;
          noTargetCommand: boolean;
          packingState: string;
          facingInitiated: boolean;
          facingComplete: boolean;
          withinStartAbilityRange: boolean;
          doDisableFxParticles: boolean;
          captureFlashPhase: number;
        } | null;
      }>;
    };

    const state = privateLogic.spawnedEntities.get(71)!.specialAbilityState!;
    expect(state.active).toBe(true);
    expect(state.prepFrames).toBe(12);
    expect(state.animFrames).toBe(8);
    expect(state.targetEntityId).toBe(72);
    expect(state.targetX).toBeNull();
    expect(state.targetZ).toBeNull();
    expect(state.noTargetCommand).toBe(false);
    expect(state.packingState).toBe('PACKING');
    expect(state.facingInitiated).toBe(true);
    expect(state.facingComplete).toBe(false);
    expect(state.withinStartAbilityRange).toBe(true);
    expect(state.doDisableFxParticles).toBe(false);
    expect(state.captureFlashPhase).toBe(0.625);
  });

  it('imports source BattlePlanUpdate runtime state', () => {
    const bundle = makeSourceOwnedCoreBundle();
    const registry = makeRegistry(bundle);
    const map = makeMap([], 64, 64);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(64, 64));

    const strategyCenterState = createEmptySourceMapEntitySaveState();
    strategyCenterState.objectId = 73;
    strategyCenterState.position = { x: 80, y: 0, z: 44 };
    strategyCenterState.modules = [{
      identifier: 'ModuleTag_BattlePlan',
      blockData: buildSourceBattlePlanUpdateModuleData({
        currentPlan: 1,
        desiredPlan: 3,
        planAffectingArmy: 1,
        status: 2,
        nextReadyFrame: 210,
        invalidSettings: false,
        centeringTurret: true,
        armorScalar: 1,
        bombardment: 1,
        searchAndDestroy: 0,
        holdTheLine: 0,
        sightRangeScalar: 1,
        validKindOf: ['INFANTRY', 'VEHICLE'],
        invalidKindOf: ['AIRCRAFT'],
        visionObjectId: 77,
      }),
    }];

    logic.restoreSourceGameLogicImportSaveState({
      version: 1,
      sourceChunkVersion: 10,
      frameCounter: 150,
      objectIdCounter: 100,
      objects: [
        { templateName: 'StrategyCenter', state: strategyCenterState },
      ],
    });

    const privateLogic = logic as unknown as {
      spawnedEntities: Map<number, {
        battlePlanState: {
          currentPlan?: string;
          desiredPlan: string;
          activePlan: string;
          transitionStatus: string;
          transitionFinishFrame: number;
          idleCooldownFinishFrame: number;
        } | null;
      }>;
    };

    const state = privateLogic.spawnedEntities.get(73)!.battlePlanState!;
    expect(state.currentPlan).toBe('BOMBARDMENT');
    expect(state.desiredPlan).toBe('SEARCHANDDESTROY');
    expect(state.activePlan).toBe('BOMBARDMENT');
    expect(state.transitionStatus).toBe('ACTIVE');
    expect(state.transitionFinishFrame).toBe(210);
    expect(state.idleCooldownFinishFrame).toBe(0);
  });

  it('imports source SlavedUpdate and MobMemberSlavedUpdate runtime state', () => {
    const bundle = makeSourceOwnedCoreBundle();
    const registry = makeRegistry(bundle);
    const map = makeMap([], 64, 64);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(64, 64));

    const masterState = createEmptySourceMapEntitySaveState();
    masterState.objectId = 80;
    masterState.position = { x: 90, y: 0, z: 50 };

    const slavedState = createEmptySourceMapEntitySaveState();
    slavedState.objectId = 81;
    slavedState.position = { x: 95, y: 0, z: 52 };
    slavedState.modules = [{
      identifier: 'ModuleTag_Slaved',
      blockData: buildSourceSlavedUpdateModuleData({
        slaverId: 80,
        guardPointOffset: { x: 6, y: -4, z: 0 },
        framesToWait: 7,
        repairState: 2,
        repairing: true,
      }),
    }];

    const mobState = createEmptySourceMapEntitySaveState();
    mobState.objectId = 82;
    mobState.position = { x: 92, y: 0, z: 54 };
    mobState.modules = [{
      identifier: 'ModuleTag_MobSlave',
      blockData: buildSourceMobMemberSlavedUpdateModuleData({
        slaverId: 80,
        framesToWait: 11,
        mobState: 1,
        primaryVictimId: 83,
        isSelfTasking: true,
        catchUpCrisisTimer: 4,
      }),
    }];

    const victimState = createEmptySourceMapEntitySaveState();
    victimState.objectId = 83;
    victimState.position = { x: 110, y: 0, z: 54 };

    logic.restoreSourceGameLogicImportSaveState({
      version: 1,
      sourceChunkVersion: 10,
      frameCounter: 100,
      objectIdCounter: 120,
      objects: [
        { templateName: 'DroneSpawner', state: masterState },
        { templateName: 'SlavedDrone', state: slavedState },
        { templateName: 'MobMember', state: mobState },
        { templateName: 'AmericaRanger', state: victimState },
      ],
    });

    const privateLogic = logic as unknown as {
      spawnedEntities: Map<number, {
        slaverEntityId: number | null;
        slaveGuardOffsetX: number;
        slaveGuardOffsetZ: number;
        slavedNextUpdateFrame: number;
        mobMemberState: {
          framesToWait: number;
          catchUpCrisisTimer: number;
          primaryVictimId: number;
          isSelfTasking: boolean;
          mobState: number;
        } | null;
      }>;
    };

    const slaved = privateLogic.spawnedEntities.get(81)!;
    expect(slaved.slaverEntityId).toBe(80);
    expect(slaved.slaveGuardOffsetX).toBe(6);
    expect(slaved.slaveGuardOffsetZ).toBe(-4);
    expect(slaved.slavedNextUpdateFrame).toBe(107);

    const mob = privateLogic.spawnedEntities.get(82)!;
    expect(mob.slaverEntityId).toBe(80);
    expect(mob.mobMemberState).toEqual({
      framesToWait: 11,
      catchUpCrisisTimer: 4,
      primaryVictimId: 83,
      isSelfTasking: true,
      mobState: 1,
    });
  });

  it('imports source AutoHeal, GrantStealth, and Countermeasures runtime state', () => {
    const bundle = makeSourceOwnedCoreBundle();
    const registry = makeRegistry(bundle);
    const map = makeMap([], 64, 64);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(64, 64));

    const autoHealState = createEmptySourceMapEntitySaveState();
    autoHealState.objectId = 90;
    autoHealState.position = { x: 120, y: 0, z: 60 };
    autoHealState.modules = [{
      identifier: 'ModuleTag_AutoHeal',
      blockData: buildSourceAutoHealBehaviorModuleData({
        nextCallFrame: 240,
        upgradeExecuted: true,
        radiusParticleSystemId: 17,
        soonestHealFrame: 260,
        stopped: true,
      }),
    }];

    const grantStealthState = createEmptySourceMapEntitySaveState();
    grantStealthState.objectId = 91;
    grantStealthState.position = { x: 124, y: 0, z: 60 };
    grantStealthState.modules = [{
      identifier: 'ModuleTag_GrantStealth',
      blockData: buildSourceGrantStealthBehaviorModuleData({
        nextCallFrame: 241,
        radiusParticleSystemId: 18,
        currentScanRadius: 42.5,
      }),
    }];

    const countermeasureState = createEmptySourceMapEntitySaveState();
    countermeasureState.objectId = 92;
    countermeasureState.position = { x: 128, y: 0, z: 60 };
    countermeasureState.modules = [{
      identifier: 'ModuleTag_Countermeasures',
      blockData: buildSourceCountermeasuresBehaviorModuleData({
        nextCallFrame: 242,
        upgradeExecuted: true,
        flareIds: [93, 94],
        availableCountermeasures: 3,
        activeCountermeasures: 2,
        divertedMissiles: 4,
        incomingMissiles: 5,
        reactionFrame: 250,
        nextVolleyFrame: 270,
      }),
    }];

    const flareAState = createEmptySourceMapEntitySaveState();
    flareAState.objectId = 93;
    flareAState.position = { x: 130, y: 0, z: 60 };
    const flareBState = createEmptySourceMapEntitySaveState();
    flareBState.objectId = 94;
    flareBState.position = { x: 132, y: 0, z: 60 };

    logic.restoreSourceGameLogicImportSaveState({
      version: 1,
      sourceChunkVersion: 10,
      frameCounter: 200,
      objectIdCounter: 140,
      objects: [
        { templateName: 'AutoHealer', state: autoHealState },
        { templateName: 'StealthGrantingUnit', state: grantStealthState },
        { templateName: 'CountermeasureJet', state: countermeasureState },
        { templateName: 'CountermeasureFlare', state: flareAState },
        { templateName: 'CountermeasureFlare', state: flareBState },
      ],
    });

    const privateLogic = logic as unknown as {
      spawnedEntities: Map<number, {
        autoHealNextFrame: number;
        autoHealSoonestHealFrame: number;
        autoHealStopped: boolean;
        grantStealthCurrentRadius: number;
        countermeasuresState: {
          availableCountermeasures: number;
          activeCountermeasures: number;
          flareIds: number[];
          reactionFrame: number;
          nextVolleyFrame: number;
          reloadFrame: number;
          incomingMissiles: number;
          divertedMissiles: number;
        } | null;
      }>;
    };

    const autoHeal = privateLogic.spawnedEntities.get(90)!;
    expect(autoHeal.autoHealNextFrame).toBe(240);
    expect(autoHeal.autoHealSoonestHealFrame).toBe(260);
    expect(autoHeal.autoHealStopped).toBe(true);

    const grantStealth = privateLogic.spawnedEntities.get(91)!;
    expect(grantStealth.grantStealthCurrentRadius).toBeCloseTo(42.5);

    const countermeasures = privateLogic.spawnedEntities.get(92)!.countermeasuresState!;
    expect(countermeasures).toEqual({
      availableCountermeasures: 3,
      activeCountermeasures: 2,
      flareIds: [93, 94],
      reactionFrame: 250,
      nextVolleyFrame: 270,
      reloadFrame: 0,
      incomingMissiles: 5,
      divertedMissiles: 4,
    });
  });

  it('imports source PoisonedBehavior runtime state', () => {
    const bundle = makeSourceOwnedCoreBundle();
    const registry = makeRegistry(bundle);
    const map = makeMap([], 64, 64);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(64, 64));

    const sourceState = createEmptySourceMapEntitySaveState();
    sourceState.objectId = 112;
    sourceState.position = { x: 136, y: 0, z: 60 };
    sourceState.modules = [{
      identifier: 'ModuleTag_Poisoned',
      blockData: buildSourcePoisonedBehaviorModuleData({
        nextCallFrame: 270,
        poisonDamageFrame: 270,
        poisonOverallStopFrame: 330,
        poisonDamageAmount: 7.5,
        deathType: 9,
      }),
    }];

    logic.restoreSourceGameLogicImportSaveState({
      version: 1,
      sourceChunkVersion: 10,
      frameCounter: 200,
      objectIdCounter: 140,
      objects: [
        { templateName: 'PoisonableUnit', state: sourceState },
      ],
    });

    const privateLogic = logic as unknown as {
      spawnedEntities: Map<number, {
        poisonDamageAmount: number;
        poisonNextDamageFrame: number;
        poisonExpireFrame: number;
        poisonDeathType: string;
        objectStatusFlags: Set<string>;
      }>;
    };

    const entity = privateLogic.spawnedEntities.get(112)!;
    expect(entity.poisonDamageAmount).toBeCloseTo(7.5, 6);
    expect(entity.poisonNextDamageFrame).toBe(270);
    expect(entity.poisonExpireFrame).toBe(330);
    expect(entity.poisonDeathType).toBe('LASERED');
    expect(entity.objectStatusFlags.has('POISONED')).toBe(true);
  });

  it('imports source MinefieldBehavior runtime state', () => {
    const bundle = makeSourceOwnedCoreBundle();
    const registry = makeRegistry(bundle);
    const map = makeMap([], 64, 64);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(64, 64));

    const sourceState = createEmptySourceMapEntitySaveState();
    sourceState.objectId = 113;
    sourceState.position = { x: 138, y: 0, z: 60 };
    sourceState.modules = [{
      identifier: 'ModuleTag_Minefield',
      blockData: buildSourceMinefieldBehaviorModuleData({
        nextCallFrame: 281,
        virtualMinesRemaining: 4,
        nextDeathCheckFrame: 340,
        scootFramesLeft: 17,
        scootVelocity: { x: 1, y: 2, z: 3 },
        scootAcceleration: { x: 4, y: 5, z: 6 },
        ignoreDamage: true,
        regenerates: true,
        draining: true,
        immunes: [
          { objectId: 60, collideFrame: 275 },
          { objectId: 61, collideFrame: 276 },
          { objectId: 0, collideFrame: 0 },
        ],
      }),
    }];

    logic.restoreSourceGameLogicImportSaveState({
      version: 1,
      sourceChunkVersion: 10,
      frameCounter: 200,
      objectIdCounter: 140,
      objects: [
        { templateName: 'MinefieldObject', state: sourceState },
      ],
    });

    const privateLogic = logic as unknown as {
      spawnedEntities: Map<number, {
        mineVirtualMinesRemaining: number;
        mineNextDeathCheckFrame: number;
        mineScootFramesLeft: number;
        mineIgnoreDamage: boolean;
        mineRegenerates: boolean;
        mineDraining: boolean;
        mineImmunes: Array<{ entityId: number; collideFrame: number }>;
        mineDetonators: unknown[];
      }>;
    };

    const entity = privateLogic.spawnedEntities.get(113)!;
    expect(entity.mineVirtualMinesRemaining).toBe(4);
    expect(entity.mineNextDeathCheckFrame).toBe(340);
    expect(entity.mineScootFramesLeft).toBe(17);
    expect(entity.mineIgnoreDamage).toBe(true);
    expect(entity.mineRegenerates).toBe(true);
    expect(entity.mineDraining).toBe(true);
    expect(entity.mineImmunes).toEqual([
      { entityId: 60, collideFrame: 275 },
      { entityId: 61, collideFrame: 276 },
    ]);
    expect(entity.mineDetonators).toEqual([]);
  });

  it('imports source FireWeaponUpdate and FireWeaponCollide runtime state', () => {
    const bundle = makeSourceOwnedCoreBundle();
    const registry = makeRegistry(bundle);
    const map = makeMap([], 64, 64);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(64, 64));

    const autoFireState = createEmptySourceMapEntitySaveState();
    autoFireState.objectId = 114;
    autoFireState.position = { x: 140, y: 0, z: 60 };
    autoFireState.modules = [{
      identifier: 'ModuleTag_AutoFire',
      blockData: buildSourceFireWeaponUpdateModuleData({
        nextCallFrame: 280,
        weaponName: 'AutoFireWeapon',
        whenWeCanFireAgain: 310,
      }),
    }];

    const collideState = createEmptySourceMapEntitySaveState();
    collideState.objectId = 115;
    collideState.position = { x: 142, y: 0, z: 60 };
    collideState.modules = [{
      identifier: 'ModuleTag_CollideFire',
      blockData: buildSourceFireWeaponCollideModuleData({
        weaponPresent: true,
        weaponName: 'CollideFireWeapon',
        whenWeCanFireAgain: 320,
        everFired: true,
      }),
    }];

    logic.restoreSourceGameLogicImportSaveState({
      version: 1,
      sourceChunkVersion: 10,
      frameCounter: 200,
      objectIdCounter: 160,
      objects: [
        { templateName: 'AutoFireObject', state: autoFireState },
        { templateName: 'CollideFireObject', state: collideState },
      ],
    });

    const privateLogic = logic as unknown as {
      spawnedEntities: Map<number, {
        fireWeaponUpdateNextFireFrames: number[];
        fireWeaponCollideEverFired: boolean[];
      }>;
    };

    expect(privateLogic.spawnedEntities.get(114)!.fireWeaponUpdateNextFireFrames).toEqual([310]);
    expect(privateLogic.spawnedEntities.get(115)!.fireWeaponCollideEverFired).toEqual([true]);
  });

  it('imports source ProjectileStreamUpdate and BoneFXUpdate runtime state', () => {
    const bundle = makeSourceOwnedCoreBundle();
    const registry = makeRegistry(bundle);
    const map = makeMap([], 64, 64);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(64, 64));

    const projectileIds = Array.from({ length: SOURCE_PROJECTILE_STREAM_MAX }, (_, index) => 300 + index);
    const streamState = createEmptySourceMapEntitySaveState();
    streamState.objectId = 116;
    streamState.position = { x: 144, y: 0, z: 60 };
    streamState.modules = [{
      identifier: 'ModuleTag_Stream',
      blockData: buildSourceProjectileStreamUpdateModuleData({
        nextCallFrame: 305,
        projectileIds,
        nextFreeIndex: 9,
        firstValidIndex: 4,
        owningObject: 12,
        targetObject: 44,
        targetPosition: { x: 101, y: 202, z: 303 },
      }),
    }];

    const nextFxFrame = makeSourceBoneFxIntGrid(100);
    const nextOclFrame = makeSourceBoneFxIntGrid(200);
    const nextParticleSystemFrame = makeSourceBoneFxIntGrid(300);
    const fxBonePositions = makeSourceBoneFxCoordGrid(10);
    const oclBonePositions = makeSourceBoneFxCoordGrid(210);
    const particleSystemBonePositions = makeSourceBoneFxCoordGrid(410);
    const boneFxState = createEmptySourceMapEntitySaveState();
    boneFxState.objectId = 117;
    boneFxState.position = { x: 146, y: 0, z: 60 };
    boneFxState.modules = [{
      identifier: 'ModuleTag_BoneFX',
      blockData: buildSourceBoneFxUpdateModuleData({
        nextCallFrame: 306,
        particleSystemIds: [77, 88],
        nextFxFrame,
        nextOclFrame,
        nextParticleSystemFrame,
        fxBonePositions,
        oclBonePositions,
        particleSystemBonePositions,
        currentBodyState: 2,
        bonesResolved: [true, false, true, true],
        active: true,
      }),
    }];

    logic.restoreSourceGameLogicImportSaveState({
      version: 1,
      sourceChunkVersion: 10,
      frameCounter: 200,
      objectIdCounter: 180,
      objects: [
        { templateName: 'ProjectileStreamObject', state: streamState },
        { templateName: 'BoneFxObject', state: boneFxState },
      ],
    });

    const privateLogic = logic as unknown as {
      spawnedEntities: Map<number, {
        projectileStreamState: {
          projectileIds: number[];
          nextIndex: number;
          ownerEntityId: number;
          targetObjectId?: number;
          targetPosition?: { x: number; y: number; z: number };
        } | null;
        boneFXState: {
          currentBodyState: number;
          active: boolean;
          nextFXFrame: number[][];
          nextOCLFrame: number[][];
          nextParticleFrame: number[][];
          fxBonePositions?: { x: number; y: number; z: number }[][];
          oclBonePositions?: { x: number; y: number; z: number }[][];
          particleSystemBonePositions?: { x: number; y: number; z: number }[][];
          bonesResolved?: boolean[];
          activeParticleIds: number[];
        } | null;
      }>;
    };

    const importedStream = privateLogic.spawnedEntities.get(116)!.projectileStreamState!;
    expect(importedStream.projectileIds).toEqual([304, 305, 306, 307, 308]);
    expect(importedStream.nextIndex).toBe(5);
    expect(importedStream.ownerEntityId).toBe(12);
    expect(importedStream.targetObjectId).toBe(44);
    expect(importedStream.targetPosition).toEqual({ x: 101, y: 202, z: 303 });

    const importedBoneFx = privateLogic.spawnedEntities.get(117)!.boneFXState!;
    expect(importedBoneFx.activeParticleIds).toEqual([77, 88]);
    expect(importedBoneFx.nextFXFrame).toEqual(nextFxFrame);
    expect(importedBoneFx.nextOCLFrame).toEqual(nextOclFrame);
    expect(importedBoneFx.nextParticleFrame).toEqual(nextParticleSystemFrame);
    expect(importedBoneFx.fxBonePositions).toEqual(fxBonePositions);
    expect(importedBoneFx.oclBonePositions).toEqual(oclBonePositions);
    expect(importedBoneFx.particleSystemBonePositions).toEqual(particleSystemBonePositions);
    expect(importedBoneFx.currentBodyState).toBe(2);
    expect(importedBoneFx.bonesResolved).toEqual([true, false, true, true]);
    expect(importedBoneFx.active).toBe(true);
  });

  it('imports source DeployStyleAIUpdate and production exit runtime state', () => {
    const bundle = makeSourceOwnedCoreBundle();
    const registry = makeRegistry(bundle);
    const map = makeMap([], 64, 64);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(64, 64));

    const deployState = createEmptySourceMapEntitySaveState();
    deployState.objectId = 118;
    deployState.position = { x: 148, y: 0, z: 60 };
    deployState.modules = [{
      identifier: 'ModuleTag_Deploy',
      blockData: buildSourceDeployStyleAIUpdateModuleData({
        state: 3,
        frameToWaitForDeploy: 345,
      }),
    }];

    const defaultExitState = createEmptySourceMapEntitySaveState();
    defaultExitState.objectId = 119;
    defaultExitState.position = { x: 150, y: 0, z: 60 };
    defaultExitState.modules = [{
      identifier: 'ModuleTag_DefaultExit',
      blockData: buildSourceProductionExitRallyModuleData({
        nextCallFrame: 330,
        rallyPoint: { x: 51, y: 6, z: 61 },
        rallyPointExists: true,
      }),
    }];

    const queueExitState = createEmptySourceMapEntitySaveState();
    queueExitState.objectId = 120;
    queueExitState.position = { x: 152, y: 0, z: 60 };
    queueExitState.modules = [{
      identifier: 'ModuleTag_QueueExit',
      blockData: buildSourceQueueProductionExitModuleData({
        nextCallFrame: 331,
        currentDelay: 12,
        rallyPoint: { x: 71, y: 8, z: 81 },
        rallyPointExists: true,
        creationClearDistance: 44.5,
        currentBurstCount: 3,
      }),
    }];

    const spawnExitState = createEmptySourceMapEntitySaveState();
    spawnExitState.objectId = 121;
    spawnExitState.position = { x: 154, y: 0, z: 60 };
    spawnExitState.modules = [{
      identifier: 'ModuleTag_SpawnExit',
      blockData: buildSourceSpawnPointProductionExitModuleData({
        nextCallFrame: 332,
        occupierIds: [0, 401, 402, 0, 404],
      }),
    }];

    logic.restoreSourceGameLogicImportSaveState({
      version: 1,
      sourceChunkVersion: 10,
      frameCounter: 200,
      objectIdCounter: 190,
      objects: [
        { templateName: 'DeployStyleUnit', state: deployState },
        { templateName: 'DefaultExitStructure', state: defaultExitState },
        { templateName: 'QueueExitStructure', state: queueExitState },
        { templateName: 'SpawnPointExitStructure', state: spawnExitState },
      ],
    });

    const privateLogic = logic as unknown as {
      spawnedEntities: Map<number, {
        deployState: string;
        deployFrameToWait: number;
        rallyPoint: { x: number; z: number } | null;
        rallyPointY: number;
        queueProductionExitDelayFramesRemaining: number;
        queueProductionExitBurstRemaining: number;
        queueProductionExitCreationClearDistance: number;
        spawnPointExitState: { occupierIds: number[] } | null;
      }>;
    };

    expect(privateLogic.spawnedEntities.get(118)!.deployState).toBe('UNDEPLOY');
    expect(privateLogic.spawnedEntities.get(118)!.deployFrameToWait).toBe(345);

    expect(privateLogic.spawnedEntities.get(119)!.rallyPoint).toEqual({ x: 51, z: 61 });
    expect(privateLogic.spawnedEntities.get(119)!.rallyPointY).toBe(6);

    const queueEntity = privateLogic.spawnedEntities.get(120)!;
    expect(queueEntity.queueProductionExitDelayFramesRemaining).toBe(12);
    expect(queueEntity.queueProductionExitBurstRemaining).toBe(3);
    expect(queueEntity.queueProductionExitCreationClearDistance).toBeCloseTo(44.5);
    expect(queueEntity.rallyPoint).toEqual({ x: 71, z: 81 });
    expect(queueEntity.rallyPointY).toBe(8);

    expect(privateLogic.spawnedEntities.get(121)!.spawnPointExitState?.occupierIds)
      .toEqual([-1, 401, 402, -1, 404, -1, -1, -1, -1, -1]);
  });

  it('imports source AssaultTransportAIUpdate runtime state', () => {
    const bundle = makeSourceOwnedCoreBundle();
    const registry = makeRegistry(bundle);
    const map = makeMap([], 64, 64);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(64, 64));

    const assaultState = createEmptySourceMapEntitySaveState();
    assaultState.objectId = 122;
    assaultState.position = { x: 156, y: 0, z: 60 };
    assaultState.modules = [{
      identifier: 'ModuleTag_AssaultAI',
      blockData: buildSourceAssaultTransportAIUpdateModuleData({
        members: [
          { entityId: 201, isHealing: true },
          { entityId: 202, isHealing: false },
        ],
        attackMoveGoal: { x: 70, y: 6, z: 90 },
        designatedTargetId: 301,
        assaultState: 1,
        framesRemaining: 45,
        isAttackMove: true,
        isAttackObject: false,
      }),
    }];

    logic.restoreSourceGameLogicImportSaveState({
      version: 1,
      sourceChunkVersion: 10,
      frameCounter: 200,
      objectIdCounter: 190,
      objects: [
        { templateName: 'AssaultTransportObject', state: assaultState },
      ],
    });

    const privateLogic = logic as unknown as {
      spawnedEntities: Map<number, {
        assaultTransportState: unknown;
      }>;
      assaultTransportStateByEntityId: Map<number, unknown>;
    };

    expect(privateLogic.spawnedEntities.get(122)!.assaultTransportState).toEqual({
      members: [
        { entityId: 201, isHealing: true, isNew: false },
        { entityId: 202, isHealing: false, isNew: false },
      ],
      designatedTargetId: 301,
      attackMoveGoalX: 70,
      attackMoveGoalY: 6,
      attackMoveGoalZ: 90,
      assaultState: 1,
      framesRemaining: 45,
      isAttackMove: true,
      isAttackObject: false,
      newOccupantsAreNewMembers: false,
    });
    expect(privateLogic.assaultTransportStateByEntityId.get(122)).toBe(
      privateLogic.spawnedEntities.get(122)!.assaultTransportState,
    );
  });

  it('imports source SupplyTruckAIUpdate runtime state', () => {
    const bundle = makeSourceOwnedCoreBundle();
    const registry = makeRegistry(bundle);
    const map = makeMap([], 64, 64);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(64, 64));

    const supplyTruckState = createEmptySourceMapEntitySaveState();
    supplyTruckState.objectId = 123;
    supplyTruckState.position = { x: 158, y: 0, z: 60 };
    supplyTruckState.modules = [{
      identifier: 'ModuleTag_SupplyTruckAI',
      blockData: buildSourceSupplyTruckAIUpdateModuleData({
        preferredDockId: 301,
        numberBoxes: 4,
        forcePending: true,
      }),
    }];

    logic.restoreSourceGameLogicImportSaveState({
      version: 1,
      sourceChunkVersion: 10,
      frameCounter: 200,
      objectIdCounter: 190,
      objects: [
        { templateName: 'SupplyTruckObject', state: supplyTruckState },
      ],
    });

    const privateLogic = logic as unknown as {
      supplyTruckStates: Map<number, unknown>;
    };

    expect(privateLogic.supplyTruckStates.get(123)).toEqual({
      aiState: 0,
      currentBoxes: 4,
      targetWarehouseId: null,
      targetDepotId: null,
      actionDelayFinishFrame: 0,
      preferredDockId: 301,
      forceBusy: true,
    });
  });

  it('imports source PointDefenseLaserUpdate runtime state', () => {
    const bundle = makeSourceOwnedCoreBundle();
    const registry = makeRegistry(bundle);
    const map = makeMap([], 64, 64);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(64, 64));

    const pdlState = createEmptySourceMapEntitySaveState();
    pdlState.objectId = 122;
    pdlState.position = { x: 156, y: 0, z: 60 };
    pdlState.modules = [{
      identifier: 'ModuleTag_PDL',
      blockData: buildSourcePointDefenseLaserUpdateModuleData({
        nextCallFrame: 340,
        bestTargetId: 501,
        inRange: true,
        nextScanFrames: 7,
        nextShotAvailableInFrames: 11,
      }),
    }];

    logic.restoreSourceGameLogicImportSaveState({
      version: 1,
      sourceChunkVersion: 10,
      frameCounter: 200,
      objectIdCounter: 190,
      objects: [
        { templateName: 'PointDefenseObject', state: pdlState },
      ],
    });

    const privateLogic = logic as unknown as {
      spawnedEntities: Map<number, {
        pdlBestTargetId: number;
        pdlInRange: boolean;
        pdlNextScanFrame: number;
        pdlNextShotFrame: number;
      }>;
    };

    const importedPdl = privateLogic.spawnedEntities.get(122)!;
    expect(importedPdl.pdlBestTargetId).toBe(501);
    expect(importedPdl.pdlInRange).toBe(true);
    expect(importedPdl.pdlNextScanFrame).toBe(207);
    expect(importedPdl.pdlNextShotFrame).toBe(211);
  });

  it('imports simple source update runtime state', () => {
    const bundle = makeSourceOwnedCoreBundle();
    const registry = makeRegistry(bundle);
    const map = makeMap([], 64, 64);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(64, 64));

    const floatState = createEmptySourceMapEntitySaveState();
    floatState.objectId = 123;
    floatState.position = { x: 158, y: 0, z: 60 };
    floatState.modules = [{
      identifier: 'ModuleTag_Float',
      blockData: buildSourceFloatUpdateModuleData({
        nextCallFrame: 350,
        enabled: true,
      }),
    }];

    const pilotState = createEmptySourceMapEntitySaveState();
    pilotState.objectId = 124;
    pilotState.position = { x: 160, y: 0, z: 60 };
    pilotState.modules = [{
      identifier: 'ModuleTag_Pilot',
      blockData: buildSourcePilotFindVehicleUpdateModuleData({
        nextCallFrame: 351,
        didMoveToBase: true,
      }),
    }];

    const radarState = createEmptySourceMapEntitySaveState();
    radarState.objectId = 125;
    radarState.position = { x: 162, y: 0, z: 60 };
    radarState.modules = [{
      identifier: 'ModuleTag_Radar',
      blockData: buildSourceRadarUpdateModuleData({
        nextCallFrame: 352,
        extendDoneFrame: 420,
        extendComplete: true,
        radarActive: true,
      }),
    }];

    const leafletState = createEmptySourceMapEntitySaveState();
    leafletState.objectId = 126;
    leafletState.position = { x: 164, y: 0, z: 60 };
    leafletState.modules = [{
      identifier: 'ModuleTag_Leaflet',
      blockData: buildSourceLeafletDropBehaviorModuleData({
        startFrame: 430,
      }),
    }];

    const hijackerState = createEmptySourceMapEntitySaveState();
    hijackerState.objectId = 127;
    hijackerState.position = { x: 166, y: 0, z: 60 };
    hijackerState.modules = [{
      identifier: 'ModuleTag_Hijacker',
      blockData: buildSourceHijackerUpdateModuleData({
        nextCallFrame: 353,
        targetId: 701,
        ejectPosition: { x: 11, y: 22, z: 3 },
        update: false,
        isInVehicle: true,
        wasTargetAirborne: true,
      }),
    }];

    logic.restoreSourceGameLogicImportSaveState({
      version: 1,
      sourceChunkVersion: 10,
      frameCounter: 200,
      objectIdCounter: 190,
      objects: [
        { templateName: 'FloatObject', state: floatState },
        { templateName: 'PilotUnit', state: pilotState },
        { templateName: 'RadarStructure', state: radarState },
        { templateName: 'LeafletObject', state: leafletState },
        { templateName: 'HijackerUnit', state: hijackerState },
      ],
    });

    const privateLogic = logic as unknown as {
      spawnedEntities: Map<number, {
        floatUpdateProfile: { enabled: boolean } | null;
        pilotFindVehicleDidMoveToBase: boolean;
        pilotFindVehicleNextScanFrame: number;
        radarExtendDoneFrame: number;
        radarExtendComplete: boolean;
        radarActive: boolean;
        leafletDropState: { startFrame: number; fired: boolean } | null;
        hijackerState: {
          targetId: number;
          update: boolean;
          isInVehicle: boolean;
          wasTargetAirborne: boolean;
          ejectX: number;
          ejectY: number;
          ejectZ: number;
        } | null;
      }>;
    };

    expect(privateLogic.spawnedEntities.get(123)!.floatUpdateProfile?.enabled).toBe(true);

    const importedPilot = privateLogic.spawnedEntities.get(124)!;
    expect(importedPilot.pilotFindVehicleDidMoveToBase).toBe(true);
    expect(importedPilot.pilotFindVehicleNextScanFrame).toBe(351);

    const importedRadar = privateLogic.spawnedEntities.get(125)!;
    expect(importedRadar.radarExtendDoneFrame).toBe(420);
    expect(importedRadar.radarExtendComplete).toBe(true);
    expect(importedRadar.radarActive).toBe(true);

    expect(privateLogic.spawnedEntities.get(126)!.leafletDropState).toEqual({
      startFrame: 430,
      fired: false,
    });

    expect(privateLogic.spawnedEntities.get(127)!.hijackerState).toEqual({
      targetId: 701,
      update: false,
      isInVehicle: true,
      wasTargetAirborne: true,
      ejectX: 11,
      ejectY: 3,
      ejectZ: 22,
    });
  });

  it('imports miscellaneous source update and helper runtime state', () => {
    const bundle = makeSourceOwnedCoreBundle();
    const registry = makeRegistry(bundle);
    const map = makeMap([], 64, 64);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(64, 64));

    const enemyNearState = createEmptySourceMapEntitySaveState();
    enemyNearState.objectId = 131;
    enemyNearState.position = { x: 174, y: 0, z: 60 };
    enemyNearState.modules = [{
      identifier: 'ModuleTag_EnemyNear',
      blockData: buildSourceEnemyNearUpdateModuleData({
        nextCallFrame: 390,
        nextScanCountdown: 14,
        enemyNear: true,
      }),
    }];

    const checkpointState = createEmptySourceMapEntitySaveState();
    checkpointState.objectId = 132;
    checkpointState.position = { x: 176, y: 0, z: 60 };
    checkpointState.modules = [{
      identifier: 'ModuleTag_Checkpoint',
      blockData: buildSourceCheckpointUpdateModuleData({
        nextCallFrame: 391,
        enemyNear: false,
        allyNear: true,
        maxMinorRadius: 12.5,
        scanCountdown: 15,
      }),
    }];

    const proneState = createEmptySourceMapEntitySaveState();
    proneState.objectId = 133;
    proneState.position = { x: 178, y: 0, z: 60 };
    proneState.modules = [{
      identifier: 'ModuleTag_Prone',
      blockData: buildSourceProneUpdateModuleData({
        nextCallFrame: 392,
        proneFrames: 27,
      }),
    }];

    const smartBombState = createEmptySourceMapEntitySaveState();
    smartBombState.objectId = 134;
    smartBombState.position = { x: 180, y: 0, z: 60 };
    smartBombState.modules = [{
      identifier: 'ModuleTag_SmartBomb',
      blockData: buildSourceSmartBombTargetHomingUpdateModuleData({
        nextCallFrame: 393,
      }),
    }];

    const helperState = createEmptySourceMapEntitySaveState();
    helperState.objectId = 135;
    helperState.position = { x: 182, y: 0, z: 60 };
    helperState.specialModelConditionUntil = 260;
    helperState.modules = [
      {
        identifier: 'ModuleTag_SMCHelper',
        blockData: buildSourceBaseOnlyObjectHelperModuleData({
          nextCallFrame: 260,
        }),
      },
      {
        identifier: 'ModuleTag_RepulsorHelper',
        blockData: buildSourceBaseOnlyObjectHelperModuleData({
          nextCallFrame: 270,
        }),
      },
      {
        identifier: 'ModuleTag_StatusDamageHelper',
        blockData: buildSourceStatusDamageHelperModuleData({
          nextCallFrame: 280,
          statusType: 38,
          clearFrame: 280,
        }),
      },
      {
        identifier: 'ModuleTag_DefectionHelper',
        blockData: buildSourceObjectDefectionHelperModuleData({
          nextCallFrame: 201,
          detectionStartFrame: 200,
          detectionEndFrame: 300,
          flashPhase: 0.75,
          doFx: true,
        }),
      },
      {
        identifier: 'ModuleTag_SubdualDamageHelper',
        blockData: buildSourceSubdualDamageHelperModuleData({
          nextCallFrame: 201,
          healingStepCountdown: 9,
        }),
      },
      {
        identifier: 'ModuleTag_WeaponStatusHelper',
        blockData: buildSourceBaseOnlyObjectHelperModuleData({
          nextCallFrame: 201,
          phase: SOURCE_UPDATE_PHASE_FINAL,
        }),
      },
    ];

    logic.restoreSourceGameLogicImportSaveState({
      version: 1,
      sourceChunkVersion: 10,
      frameCounter: 200,
      objectIdCounter: 190,
      objects: [
        { templateName: 'EnemyNearObject', state: enemyNearState },
        { templateName: 'CheckpointObject', state: checkpointState },
        { templateName: 'ProneInfantry', state: proneState },
        { templateName: 'SmartBombTarget', state: smartBombState },
        { templateName: 'HelperStateObject', state: helperState },
      ],
    });

    const privateLogic = logic as unknown as {
      spawnedEntities: Map<number, {
        enemyNearNextScanCountdown: number;
        enemyNearDetected: boolean;
        checkpointEnemyNear: boolean;
        checkpointAllyNear: boolean;
        checkpointMaxMinorRadius: number;
        checkpointScanCountdown: number;
        proneFramesRemaining: number;
        smartBombProfile: object | null;
        smartBombState: object | null;
        cheerTimerFrames: number;
        repulsorHelperUntilFrame: number;
        statusDamageStatusName: string | null;
        statusDamageClearFrame: number;
        objectStatusFlags: Set<string>;
        defectorHelperDetectionStartFrame: number;
        defectorHelperDetectionEndFrame: number;
        defectorHelperFlashPhase: number;
        defectorHelperDoFx: boolean;
        undetectedDefectorUntilFrame: number;
        subdualHealingCountdown: number;
      }>;
    };

    const importedEnemyNear = privateLogic.spawnedEntities.get(131)!;
    expect(importedEnemyNear.enemyNearNextScanCountdown).toBe(14);
    expect(importedEnemyNear.enemyNearDetected).toBe(true);

    const importedCheckpoint = privateLogic.spawnedEntities.get(132)!;
    expect(importedCheckpoint.checkpointEnemyNear).toBe(false);
    expect(importedCheckpoint.checkpointAllyNear).toBe(true);
    expect(importedCheckpoint.checkpointMaxMinorRadius).toBeCloseTo(12.5);
    expect(importedCheckpoint.checkpointScanCountdown).toBe(15);

    expect(privateLogic.spawnedEntities.get(133)!.proneFramesRemaining).toBe(27);

    const importedSmartBomb = privateLogic.spawnedEntities.get(134)!;
    expect(importedSmartBomb.smartBombProfile).not.toBeNull();
    expect(importedSmartBomb.smartBombState).toBeNull();

    const importedHelper = privateLogic.spawnedEntities.get(135)!;
    expect(importedHelper.cheerTimerFrames).toBe(60);
    expect(importedHelper.repulsorHelperUntilFrame).toBe(270);
    expect(importedHelper.statusDamageStatusName).toBe('FAERIE_FIRE');
    expect(importedHelper.statusDamageClearFrame).toBe(280);
    expect(importedHelper.objectStatusFlags.has('FAERIE_FIRE')).toBe(true);
    expect(importedHelper.defectorHelperDetectionStartFrame).toBe(200);
    expect(importedHelper.defectorHelperDetectionEndFrame).toBe(300);
    expect(importedHelper.defectorHelperFlashPhase).toBeCloseTo(0.75);
    expect(importedHelper.defectorHelperDoFx).toBe(true);
    expect(importedHelper.undetectedDefectorUntilFrame).toBe(300);
    expect(importedHelper.subdualHealingCountdown).toBe(9);
  });

  it('imports compact source update and behavior runtime state', () => {
    const bundle = makeSourceOwnedCoreBundle();
    const registry = makeRegistry(bundle);
    const map = makeMap([], 64, 64);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(64, 64));

    const demoTrapState = createEmptySourceMapEntitySaveState();
    demoTrapState.objectId = 136;
    demoTrapState.position = { x: 184, y: 0, z: 60 };
    demoTrapState.modules = [{
      identifier: 'ModuleTag_DemoTrap',
      blockData: buildSourceDemoTrapUpdateModuleData({
        nextCallFrame: 401,
        nextScanFrames: 17,
        detonated: true,
      }),
    }];

    const dynamicState = createEmptySourceMapEntitySaveState();
    dynamicState.objectId = 137;
    dynamicState.position = { x: 186, y: 0, z: 60 };
    dynamicState.modules = [{
      identifier: 'ModuleTag_DynamicGeometry',
      blockData: buildSourceDynamicGeometryInfoUpdateModuleData({
        nextCallFrame: 402,
        startingDelayCountdown: 7,
        timeActive: 8,
        started: true,
        finished: false,
        reverseAtTransitionTime: true,
        direction: 2,
        switchedDirections: true,
        initialHeight: 11,
        initialMajorRadius: 12,
        initialMinorRadius: 13,
        finalHeight: 21,
        finalMajorRadius: 22,
        finalMinorRadius: 23,
      }),
    }];

    const firestormState = createEmptySourceMapEntitySaveState();
    firestormState.objectId = 138;
    firestormState.position = { x: 188, y: 0, z: 60 };
    firestormState.modules = [{
      identifier: 'ModuleTag_FirestormGeometry',
      blockData: buildSourceFirestormDynamicGeometryInfoUpdateModuleData({
        dynamic: {
          nextCallFrame: 403,
          startingDelayCountdown: 3,
          timeActive: 4,
          started: true,
          finished: false,
          reverseAtTransitionTime: false,
          direction: 1,
          switchedDirections: false,
          initialHeight: 31,
          initialMajorRadius: 32,
          initialMinorRadius: 33,
          finalHeight: 41,
          finalMajorRadius: 42,
          finalMinorRadius: 43,
        },
        particleSystemIds: [9001, 9002],
        effectsFired: true,
        scorchPlaced: true,
        lastDamageFrame: 333,
      }),
    }];

    const cripplingState = createEmptySourceMapEntitySaveState();
    cripplingState.objectId = 139;
    cripplingState.position = { x: 190, y: 0, z: 60 };
    cripplingState.modules = [{
      identifier: 'ModuleTag_Crippling',
      blockData: buildSourceSupplyWarehouseCripplingBehaviorModuleData({
        nextCallFrame: 404,
        healingSuppressedUntilFrame: 250,
        nextHealingFrame: 275,
      }),
    }];

    const animationState = createEmptySourceMapEntitySaveState();
    animationState.objectId = 140;
    animationState.position = { x: 192, y: 0, z: 60 };
    animationState.modules = [{
      identifier: 'ModuleTag_AnimationSteering',
      blockData: buildSourceAnimationSteeringUpdateModuleData({
        nextCallFrame: 405,
      }),
    }];

    const empState = createEmptySourceMapEntitySaveState();
    empState.objectId = 141;
    empState.position = { x: 194, y: 0, z: 60 };
    empState.modules = [{
      identifier: 'ModuleTag_EMP',
      blockData: buildSourceEmpUpdateModuleData(),
    }];

    const collapseState = createEmptySourceMapEntitySaveState();
    collapseState.objectId = 142;
    collapseState.position = { x: 196, y: 0, z: 60 };
    collapseState.modules = [{
      identifier: 'ModuleTag_Collapse',
      blockData: buildSourceStructureCollapseUpdateModuleData({
        nextCallFrame: 406,
        collapseFrame: 310,
        burstFrame: 320,
        collapseState: 2,
        collapseVelocity: 1.5,
        currentHeight: -2.25,
      }),
    }];

    logic.restoreSourceGameLogicImportSaveState({
      version: 1,
      sourceChunkVersion: 10,
      frameCounter: 200,
      objectIdCounter: 190,
      objects: [
        { templateName: 'DemoTrapObject', state: demoTrapState },
        { templateName: 'DynamicGeometryObject', state: dynamicState },
        { templateName: 'FirestormObject', state: firestormState },
        { templateName: 'SupplyCrippleWarehouse', state: cripplingState },
        { templateName: 'AnimationSteeringUnit', state: animationState },
        { templateName: 'EmpPulseObject', state: empState },
        { templateName: 'StructureCollapseObject', state: collapseState },
      ],
    });

    const privateLogic = logic as unknown as {
      spawnedEntities: Map<number, {
        demoTrapNextScanFrame: number;
        demoTrapDetonated: boolean;
        dynamicGeometryProfile: object | null;
        dynamicGeometryState: {
          delayCountdown: number;
          started: boolean;
          finished: boolean;
          timeActive: number;
          initialHeight: number;
          initialMajorRadius: number;
          initialMinorRadius: number;
          finalHeight: number;
          finalMajorRadius: number;
          finalMinorRadius: number;
          reverseAtTransitionTime: boolean;
        } | null;
        firestormDamageState: { lastDamageFrame: number } | null;
        swCripplingHealSuppressedUntilFrame: number;
        swCripplingNextHealFrame: number;
        animationSteeringProfile: object | null;
        animationSteeringCurrentTurnAnim: string | null;
        empUpdateProfile: object | null;
        empUpdateState: object | null;
        structureCollapseState: {
          state: string;
          collapseFrame: number;
          burstFrame: number;
          collapseVelocity: number;
          currentHeight: number;
        } | null;
      }>;
    };

    const importedDemoTrap = privateLogic.spawnedEntities.get(136)!;
    expect(importedDemoTrap.demoTrapNextScanFrame).toBe(217);
    expect(importedDemoTrap.demoTrapDetonated).toBe(true);

    const importedDynamic = privateLogic.spawnedEntities.get(137)!;
    expect(importedDynamic.dynamicGeometryProfile).not.toBeNull();
    expect(importedDynamic.dynamicGeometryState).toMatchObject({
      delayCountdown: 7,
      started: true,
      finished: false,
      timeActive: 8,
      initialHeight: 11,
      initialMajorRadius: 12,
      initialMinorRadius: 13,
      finalHeight: 21,
      finalMajorRadius: 22,
      finalMinorRadius: 23,
      reverseAtTransitionTime: true,
    });

    const importedFirestorm = privateLogic.spawnedEntities.get(138)!;
    expect(importedFirestorm.dynamicGeometryState).toMatchObject({
      delayCountdown: 3,
      started: true,
      timeActive: 4,
      initialHeight: 31,
      finalMajorRadius: 42,
    });
    expect(importedFirestorm.firestormDamageState).toEqual({ lastDamageFrame: 333 });

    const importedCrippling = privateLogic.spawnedEntities.get(139)!;
    expect(importedCrippling.swCripplingHealSuppressedUntilFrame).toBe(250);
    expect(importedCrippling.swCripplingNextHealFrame).toBe(275);

    const importedAnimation = privateLogic.spawnedEntities.get(140)!;
    expect(importedAnimation.animationSteeringProfile).not.toBeNull();
    expect(importedAnimation.animationSteeringCurrentTurnAnim).toBeNull();

    const importedEmp = privateLogic.spawnedEntities.get(141)!;
    expect(importedEmp.empUpdateProfile).not.toBeNull();
    expect(importedEmp.empUpdateState).toBeNull();

    expect(privateLogic.spawnedEntities.get(142)!.structureCollapseState).toEqual({
      state: 'COLLAPSING',
      collapseFrame: 310,
      burstFrame: 320,
      collapseVelocity: 1.5,
      currentHeight: -2.25,
    });
  });

  it('imports source power, OCL, weapon bonus, and helper runtime state', () => {
    const bundle = makeSourceOwnedCoreBundle();
    const registry = makeRegistry(bundle);
    const map = makeMap([], 64, 64);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(64, 64));

    const powerState = createEmptySourceMapEntitySaveState();
    powerState.objectId = 128;
    powerState.position = { x: 168, y: 0, z: 60 };
    powerState.modules = [
      {
        identifier: 'ModuleTag_PowerPlant',
        blockData: buildSourcePowerPlantUpdateModuleData({
          nextCallFrame: 390,
          extended: true,
        }),
      },
      {
        identifier: 'ModuleTag_Overcharge',
        blockData: buildSourceOverchargeBehaviorModuleData({
          nextCallFrame: 391,
          overchargeActive: true,
        }),
      },
      {
        identifier: 'ModuleTag_FiringTrackerHelper',
        blockData: buildSourceFiringTrackerModuleData({
          nextCallFrame: 392,
          consecutiveShots: 5,
          victimId: 901,
          frameToStartCooldown: 450,
        }),
      },
      {
        identifier: 'ModuleTag_TempWeaponBonusHelper',
        blockData: buildSourceTempWeaponBonusHelperModuleData({
          nextCallFrame: 470,
          currentBonus: 23,
          frameToRemove: 470,
        }),
      },
    ];

    const oclState = createEmptySourceMapEntitySaveState();
    oclState.objectId = 129;
    oclState.position = { x: 170, y: 0, z: 60 };
    oclState.modules = [{
      identifier: 'ModuleTag_OCL',
      blockData: buildSourceOclUpdateModuleData({
        nextCallFrame: 500,
        nextCreationFrame: 520,
        timerStartedFrame: 480,
        factionNeutral: false,
        currentPlayerColor: 7,
      }),
    }];

    const weaponBonusState = createEmptySourceMapEntitySaveState();
    weaponBonusState.objectId = 130;
    weaponBonusState.position = { x: 172, y: 0, z: 60 };
    weaponBonusState.modules = [{
      identifier: 'ModuleTag_WeaponBonus',
      blockData: buildSourceWeaponBonusUpdateModuleData({
        nextCallFrame: 600,
      }),
    }];

    logic.restoreSourceGameLogicImportSaveState({
      version: 1,
      sourceChunkVersion: 10,
      frameCounter: 200,
      objectIdCounter: 190,
      objects: [
        { templateName: 'PowerPlantObject', state: powerState },
        { templateName: 'OclEmitterObject', state: oclState },
        { templateName: 'WeaponBonusAuraObject', state: weaponBonusState },
      ],
    });

    const privateLogic = logic as unknown as {
      spawnedEntities: Map<number, {
        overchargeActive: boolean;
        powerPlantUpdateState: { extended: boolean; upgradeFinishFrame: number } | null;
        consecutiveShotsAtTarget: number;
        consecutiveShotsTargetEntityId: number | null;
        continuousFireCooldownFrame: number;
        tempWeaponBonusFlag: number;
        tempWeaponBonusExpiryFrame: number;
        weaponBonusConditionFlags: number;
        oclUpdateNextCreationFrames: number[];
        oclUpdateTimerStartedFrames: number[];
        oclUpdateTimerStarted: boolean[];
        oclUpdateFactionNeutral: boolean[];
        oclUpdateCurrentPlayerColors: number[];
        weaponBonusUpdateNextPulseFrames: number[];
      }>;
    };

    const importedPower = privateLogic.spawnedEntities.get(128)!;
    expect(importedPower.overchargeActive).toBe(true);
    expect(importedPower.powerPlantUpdateState).toEqual({
      extended: true,
      upgradeFinishFrame: 390,
    });
    expect(importedPower.consecutiveShotsAtTarget).toBe(5);
    expect(importedPower.consecutiveShotsTargetEntityId).toBe(901);
    expect(importedPower.continuousFireCooldownFrame).toBe(450);
    expect(importedPower.tempWeaponBonusFlag).toBe(1 << 23);
    expect(importedPower.tempWeaponBonusExpiryFrame).toBe(470);
    expect((importedPower.weaponBonusConditionFlags & (1 << 23)) !== 0).toBe(true);

    const importedOcl = privateLogic.spawnedEntities.get(129)!;
    expect(importedOcl.oclUpdateNextCreationFrames[0]).toBe(520);
    expect(importedOcl.oclUpdateTimerStartedFrames[0]).toBe(480);
    expect(importedOcl.oclUpdateTimerStarted[0]).toBe(true);
    expect(importedOcl.oclUpdateFactionNeutral[0]).toBe(false);
    expect(importedOcl.oclUpdateCurrentPlayerColors[0]).toBe(7);

    expect(privateLogic.spawnedEntities.get(130)!.weaponBonusUpdateNextPulseFrames[0]).toBe(600);
  });

  it('imports source weapon and special-power update runtime state', () => {
    const bundle = makeSourceOwnedCoreBundle();
    const registry = makeRegistry(bundle);
    const map = makeMap([], 64, 64);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(64, 64));

    const deploymentState = createEmptySourceMapEntitySaveState();
    deploymentState.objectId = 128;
    deploymentState.position = { x: 168, y: 0, z: 60 };
    deploymentState.modules = [{
      identifier: 'ModuleTag_SpectreDeploy',
      blockData: buildSourceSpectreGunshipDeploymentUpdateModuleData({
        nextCallFrame: 360,
        gunshipId: 812,
      }),
    }];

    const spectreState = createEmptySourceMapEntitySaveState();
    spectreState.objectId = 129;
    spectreState.position = { x: 170, y: 0, z: 60 };
    spectreState.modules = [{
      identifier: 'ModuleTag_Spectre',
      blockData: buildSourceSpectreGunshipUpdateModuleData({
        nextCallFrame: 361,
        initialTargetPosition: { x: 10, y: 20, z: 3 },
        overrideTargetDestination: { x: 11, y: 21, z: 4 },
        satellitePosition: { x: 12, y: 22, z: 5 },
        status: 1,
        orbitEscapeFrame: 500,
        gattlingTargetPosition: { x: 13, y: 23, z: 6 },
        positionToShootAt: { x: 14, y: 24, z: 7 },
        okToFireHowitzerCounter: 9,
        gattlingId: 813,
      }),
    }];

    const neutronState = createEmptySourceMapEntitySaveState();
    neutronState.objectId = 130;
    neutronState.position = { x: 172, y: 0, z: 60 };
    neutronState.modules = [{
      identifier: 'ModuleTag_Neutron',
      blockData: buildSourceNeutronMissileUpdateModuleData({
        nextCallFrame: 362,
        state: 2,
        targetPos: { x: 101, y: 202, z: 33 },
        intermedPos: { x: 111, y: 222, z: 44 },
        launcherId: 814,
        attachWeaponSlot: 2,
        attachSpecificBarrelToUse: 3,
        accel: { x: 1.5, y: 2.5, z: 3.5 },
        vel: { x: 4.5, y: 5.5, z: 6.5 },
        stateTimestamp: 600,
        isLaunched: true,
        isArmed: true,
        noTurnDistLeft: 42.25,
        reachedIntermediatePos: true,
        frameAtLaunch: 590,
        heightAtLaunch: 123.5,
        exhaustSystemTemplateName: 'NukeExhaustTrail',
      }),
    }];

    const missileLauncherState = createEmptySourceMapEntitySaveState();
    missileLauncherState.objectId = 131;
    missileLauncherState.position = { x: 174, y: 0, z: 60 };
    missileLauncherState.modules = [{
      identifier: 'ModuleTag_MissileLauncher',
      blockData: buildSourceMissileLauncherBuildingUpdateModuleData({
        nextCallFrame: 363,
        doorState: 3,
        timeoutState: 4,
        timeoutFrame: 700,
      }),
    }];

    const particleState = createEmptySourceMapEntitySaveState();
    particleState.objectId = 132;
    particleState.position = { x: 176, y: 0, z: 60 };
    particleState.modules = [{
      identifier: 'ModuleTag_ParticleUplink',
      blockData: buildSourceParticleUplinkCannonUpdateModuleData({
        nextCallFrame: 364,
        status: 6,
        laserStatus: 1,
        frames: 7,
        initialTargetPosition: { x: 44, y: 66, z: 8 },
        currentTargetPosition: { x: 55, y: 77, z: 9 },
        scorchMarksMade: 4,
        nextScorchMarkFrame: 144,
        nextLaunchFXFrame: 155,
        damagePulsesMade: 3,
        nextDamagePulseFrame: 130,
        startAttackFrame: 88,
        startDecayFrame: 133,
        lastDrivingClickFrame: 99,
        secondLastDrivingClickFrame: 71,
        manualTargetMode: true,
        scriptedWaypointMode: false,
        nextDestWaypointID: 321,
      }),
    }];

    logic.restoreSourceGameLogicImportSaveState({
      version: 1,
      sourceChunkVersion: 10,
      frameCounter: 200,
      objectIdCounter: 190,
      objects: [
        { templateName: 'SpectreCommandCenter', state: deploymentState },
        { templateName: 'SpectreGunshipObject', state: spectreState },
        { templateName: 'NeutronMissileObject', state: neutronState },
        { templateName: 'ScudStormObject', state: missileLauncherState },
        { templateName: 'ParticleCannonObject', state: particleState },
      ],
    });

    const privateLogic = logic as unknown as {
      spawnedEntities: Map<number, {
        spectreGunshipDeploymentGunshipId: number;
        spectreGunshipState: {
          status: string;
          initialTargetX: number;
          initialTargetY?: number;
          initialTargetZ: number;
          overrideTargetX: number;
          overrideTargetY?: number;
          overrideTargetZ: number;
          satelliteX: number;
          satelliteY?: number;
          satelliteZ: number;
          gattlingTargetX: number;
          gattlingTargetY?: number;
          gattlingTargetZ: number;
          positionToShootAtX: number;
          positionToShootAtY?: number;
          positionToShootAtZ: number;
          orbitEscapeFrame: number;
          okToFireHowitzerCounter: number;
          gattlingEntityId: number;
        } | null;
        neutronMissileUpdateState: {
          state: string;
          targetX: number;
          targetY: number;
          targetZ: number;
          intermedX: number;
          intermedY: number;
          intermedZ: number;
          accelX: number;
          accelY: number;
          accelZ: number;
          velX: number;
          velY: number;
          velZ: number;
          launcherId: number;
          attachWeaponSlot: number;
          attachSpecificBarrelToUse: number;
          stateTimestamp: number;
          isLaunched: boolean;
          isArmed: boolean;
          noTurnDistLeft: number;
          reachedIntermediatePos: boolean;
          frameAtLaunch: number;
          heightAtLaunch: number;
        } | null;
        missileLauncherBuildingState: {
          doorState: string;
          timeoutState: string;
          timeoutFrame: number;
        } | null;
        particleUplinkCannonState: {
          status: string;
          laserStatus: string;
          framesInState: number;
          targetX: number;
          targetY?: number;
          targetZ: number;
          currentTargetX: number;
          currentTargetY?: number;
          currentTargetZ: number;
          scorchMarksMade: number;
          nextScorchMarkFrame: number;
          nextLaunchFXFrame: number;
          damagePulsesMade: number;
          nextDamagePulseFrame: number;
          startAttackFrame: number;
          startDecayFrame: number;
          lastDrivingClickFrame: number;
          secondLastDrivingClickFrame: number;
          manualTargetMode: boolean;
          scriptedWaypointMode: boolean;
          nextDestWaypointID: number;
        } | null;
      }>;
    };

    expect(privateLogic.spawnedEntities.get(128)!.spectreGunshipDeploymentGunshipId).toBe(812);

    expect(privateLogic.spawnedEntities.get(129)!.spectreGunshipState).toEqual({
      status: 'ORBITING',
      initialTargetX: 10,
      initialTargetY: 3,
      initialTargetZ: 20,
      overrideTargetX: 11,
      overrideTargetY: 4,
      overrideTargetZ: 21,
      satelliteX: 12,
      satelliteY: 5,
      satelliteZ: 22,
      gattlingTargetX: 13,
      gattlingTargetY: 6,
      gattlingTargetZ: 23,
      positionToShootAtX: 14,
      positionToShootAtY: 7,
      positionToShootAtZ: 24,
      orbitEscapeFrame: 500,
      okToFireHowitzerCounter: 9,
      gattlingEntityId: 813,
    });

    expect(privateLogic.spawnedEntities.get(130)!.neutronMissileUpdateState).toEqual({
      state: 'ATTACK',
      targetX: 101,
      targetY: 33,
      targetZ: 202,
      intermedX: 111,
      intermedY: 44,
      intermedZ: 222,
      accelX: 1.5,
      accelY: 3.5,
      accelZ: 2.5,
      velX: 4.5,
      velY: 6.5,
      velZ: 5.5,
      launcherId: 814,
      attachWeaponSlot: 2,
      attachSpecificBarrelToUse: 3,
      stateTimestamp: 600,
      isArmed: true,
      isLaunched: true,
      noTurnDistLeft: 42.25,
      reachedIntermediatePos: true,
      frameAtLaunch: 590,
      heightAtLaunch: 123.5,
    });

    expect(privateLogic.spawnedEntities.get(131)!.missileLauncherBuildingState).toEqual({
      doorState: 'WAITING_TO_CLOSE',
      timeoutState: 'CLOSING',
      timeoutFrame: 700,
    });

    expect(privateLogic.spawnedEntities.get(132)!.particleUplinkCannonState).toEqual({
      status: 'FIRING',
      laserStatus: 'BORN',
      framesInState: 7,
      targetX: 44,
      targetY: 8,
      targetZ: 66,
      currentTargetX: 55,
      currentTargetY: 9,
      currentTargetZ: 77,
      scorchMarksMade: 4,
      nextScorchMarkFrame: 144,
      nextLaunchFXFrame: 155,
      damagePulsesMade: 3,
      nextDamagePulseFrame: 130,
      startAttackFrame: 88,
      startDecayFrame: 133,
      lastDrivingClickFrame: 99,
      secondLastDrivingClickFrame: 71,
      manualTargetMode: true,
      scriptedWaypointMode: false,
      nextDestWaypointID: 321,
    });
  });

  it('imports source ToppleUpdate and StructureToppleUpdate runtime state', () => {
    const bundle = makeSourceOwnedCoreBundle();
    const registry = makeRegistry(bundle);
    const map = makeMap([], 64, 64);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(64, 64));

    const toppleState = createEmptySourceMapEntitySaveState();
    toppleState.objectId = 123;
    toppleState.position = { x: 158, y: 0, z: 60 };
    toppleState.modules = [{
      identifier: 'ModuleTag_Topple',
      blockData: buildSourceToppleUpdateModuleData({
        nextCallFrame: 350,
        angularVelocity: -0.25,
        angularAcceleration: 0.05,
        toppleDirection: { x: 0.6, y: -0.8, z: 0.125 },
        toppleState: 1,
        angularAccumulation: 1.2,
        angleDeltaX: 0.03,
        numAngleDeltaX: 4,
        doBounceFx: true,
        toppleOptions: 3,
        stumpId: 777,
      }),
    }];

    const structureState = createEmptySourceMapEntitySaveState();
    structureState.objectId = 124;
    structureState.position = { x: 160, y: 0, z: 60 };
    structureState.modules = [{
      identifier: 'ModuleTag_ToppleStructure',
      blockData: buildSourceStructureToppleUpdateModuleData({
        nextCallFrame: 351,
        toppleFrame: 420,
        toppleDirection: { x: -0.4, y: 0.9 },
        toppleState: 2,
        toppleVelocity: 0.35,
        accumulatedAngle: 0.75,
        structuralIntegrity: 0.45,
        lastCrushedLocation: 12.5,
        nextBurstFrame: 500,
        delayBurstLocation: { x: 20, y: 30, z: 4 },
      }),
    }];

    logic.restoreSourceGameLogicImportSaveState({
      version: 1,
      sourceChunkVersion: 10,
      frameCounter: 200,
      objectIdCounter: 190,
      objects: [
        { templateName: 'ToppleTree', state: toppleState },
        { templateName: 'ToppleStructure', state: structureState },
      ],
    });

    const privateLogic = logic as unknown as {
      spawnedEntities: Map<number, {
        toppleState: string;
        toppleAngularVelocity: number;
        toppleAngularAcceleration: number;
        toppleDirX: number;
        toppleDirZ: number;
        toppleDirectionSourceZ: number;
        toppleAngularAccumulation: number;
        toppleAngleDeltaX: number;
        toppleNumAngleDeltaX: number;
        toppleDoBounceFx: boolean;
        toppleOptions: number;
        toppleStumpId: number;
        structureToppleState: {
          state: string;
          toppleFrame: number;
          toppleVelocity: number;
          accumulatedAngle: number;
          structuralIntegrity: number;
          toppleDirX: number;
          toppleDirZ: number;
          lastCrushedLocation: number;
          nextBurstFrame: number;
          delayBurstLocation: { x: number; y: number; z: number };
        } | null;
      }>;
    };

    const importedTopple = privateLogic.spawnedEntities.get(123)!;
    expect(importedTopple.toppleState).toBe('BOUNCING');
    expect(importedTopple.toppleAngularVelocity).toBeCloseTo(-0.25);
    expect(importedTopple.toppleAngularAcceleration).toBeCloseTo(0.05);
    expect(importedTopple.toppleDirX).toBeCloseTo(0.6);
    expect(importedTopple.toppleDirZ).toBeCloseTo(-0.8);
    expect(importedTopple.toppleDirectionSourceZ).toBeCloseTo(0.125);
    expect(importedTopple.toppleAngularAccumulation).toBeCloseTo(1.2);
    expect(importedTopple.toppleAngleDeltaX).toBeCloseTo(0.03);
    expect(importedTopple.toppleNumAngleDeltaX).toBe(4);
    expect(importedTopple.toppleDoBounceFx).toBe(true);
    expect(importedTopple.toppleOptions).toBe(3);
    expect(importedTopple.toppleStumpId).toBe(777);

    const importedStructure = privateLogic.spawnedEntities.get(124)!.structureToppleState!;
    expect(importedStructure.state).toBe('TOPPLING');
    expect(importedStructure.toppleFrame).toBe(420);
    expect(importedStructure.toppleDirX).toBeCloseTo(-0.4);
    expect(importedStructure.toppleDirZ).toBeCloseTo(0.9);
    expect(importedStructure.toppleVelocity).toBeCloseTo(0.35);
    expect(importedStructure.accumulatedAngle).toBeCloseTo(0.75);
    expect(importedStructure.structuralIntegrity).toBeCloseTo(0.45);
    expect(importedStructure.lastCrushedLocation).toBeCloseTo(12.5);
    expect(importedStructure.nextBurstFrame).toBe(500);
    expect(importedStructure.delayBurstLocation).toEqual({ x: 20, y: 4, z: 30 });
  });

  it('imports source HordeUpdate runtime state', () => {
    const bundle = makeSourceOwnedCoreBundle();
    const registry = makeRegistry(bundle);
    const map = makeMap([], 64, 64);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(64, 64));

    const hordeState = createEmptySourceMapEntitySaveState();
    hordeState.objectId = 95;
    hordeState.position = { x: 140, y: 0, z: 64 };
    hordeState.modules = [{
      identifier: 'ModuleTag_Horde',
      blockData: buildSourceHordeUpdateModuleData({
        nextCallFrame: 245,
        inHorde: true,
        hasFlag: true,
      }),
    }];

    logic.restoreSourceGameLogicImportSaveState({
      version: 1,
      sourceChunkVersion: 10,
      frameCounter: 200,
      objectIdCounter: 160,
      objects: [
        { templateName: 'HordeInfantry', state: hordeState },
      ],
    });

    const privateLogic = logic as unknown as {
      spawnedEntities: Map<number, {
        hordeNextCheckFrame: number;
        isInHorde: boolean;
        isTrueHordeMember: boolean;
        hordeHasFlag: boolean;
      }>;
    };

    const entity = privateLogic.spawnedEntities.get(95)!;
    expect(entity.hordeNextCheckFrame).toBe(245);
    expect(entity.isInHorde).toBe(true);
    expect(entity.isTrueHordeMember).toBe(false);
    expect(entity.hordeHasFlag).toBe(true);
  });

  it('imports source FireOCLAfterWeaponCooldownUpdate runtime state', () => {
    const bundle = makeSourceOwnedCoreBundle();
    const registry = makeRegistry(bundle);
    const map = makeMap([], 64, 64);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(64, 64));

    const sourceState = createEmptySourceMapEntitySaveState();
    sourceState.objectId = 96;
    sourceState.position = { x: 144, y: 0, z: 64 };
    sourceState.modules = [{
      identifier: 'ModuleTag_FireOCL',
      blockData: buildSourceFireOclAfterCooldownUpdateModuleData({
        nextCallFrame: 201,
        upgradeExecuted: true,
        valid: true,
        consecutiveShots: 4,
        startFrame: 175,
      }),
    }];

    logic.restoreSourceGameLogicImportSaveState({
      version: 1,
      sourceChunkVersion: 10,
      frameCounter: 200,
      objectIdCounter: 160,
      objects: [
        { templateName: 'FireOclTank', state: sourceState },
      ],
    });

    const privateLogic = logic as unknown as {
      spawnedEntities: Map<number, {
        fireOCLAfterCooldownStates: Array<{
          upgradeExecuted: boolean;
          valid: boolean;
          consecutiveShots: number;
          startFrame: number;
        }>;
      }>;
    };

    expect(privateLogic.spawnedEntities.get(96)!.fireOCLAfterCooldownStates).toEqual([{
      upgradeExecuted: true,
      valid: true,
      consecutiveShots: 4,
      startFrame: 175,
    }]);
  });

  it('imports source RadiusDecalUpdate runtime state', () => {
    const bundle = makeSourceOwnedCoreBundle();
    const registry = makeRegistry(bundle);
    const map = makeMap([], 64, 64);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(64, 64));

    const sourceState = createEmptySourceMapEntitySaveState();
    sourceState.objectId = 97;
    sourceState.position = { x: 148, y: 0, z: 64 };
    sourceState.modules = [{
      identifier: 'ModuleTag_RadiusDecal',
      blockData: buildSourceRadiusDecalUpdateModuleData({
        nextCallFrame: 201,
        killWhenNoLongerAttacking: true,
      }),
    }];

    logic.restoreSourceGameLogicImportSaveState({
      version: 1,
      sourceChunkVersion: 10,
      frameCounter: 200,
      objectIdCounter: 160,
      objects: [
        { templateName: 'RadiusDecalCaster', state: sourceState },
      ],
    });

    const privateLogic = logic as unknown as {
      spawnedEntities: Map<number, {
        radiusDecalStates: unknown[];
        radiusDecalModuleStates: Array<{
          moduleTag: string;
          killWhenNoLongerAttacking: boolean;
        }>;
      }>;
    };

    const entity = privateLogic.spawnedEntities.get(97)!;
    expect(entity.radiusDecalStates).toEqual([]);
    expect(entity.radiusDecalModuleStates).toEqual([{
      moduleTag: 'MODULETAG_RADIUSDECAL',
      killWhenNoLongerAttacking: true,
    }]);
  });

  it('imports source CleanupHazardUpdate runtime state', () => {
    const bundle = makeSourceOwnedCoreBundle();
    const registry = makeRegistry(bundle);
    const map = makeMap([], 64, 64);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(64, 64));

    const cleanupState = createEmptySourceMapEntitySaveState();
    cleanupState.objectId = 98;
    cleanupState.position = { x: 152, y: 0, z: 64 };
    cleanupState.modules = [{
      identifier: 'ModuleTag_Cleanup',
      blockData: buildSourceCleanupHazardUpdateModuleData({
        nextCallFrame: 201,
        bestTargetId: 99,
        inRange: true,
        nextScanFrames: 7,
        nextShotAvailableInFrames: 13,
        position: { x: 5, y: 6, z: 7 },
        moveRange: 125,
      }),
    }];

    const hazardState = createEmptySourceMapEntitySaveState();
    hazardState.objectId = 99;
    hazardState.position = { x: 160, y: 0, z: 64 };

    logic.restoreSourceGameLogicImportSaveState({
      version: 1,
      sourceChunkVersion: 10,
      frameCounter: 200,
      objectIdCounter: 170,
      objects: [
        { templateName: 'CleanupWorker', state: cleanupState },
        { templateName: 'SupplyPile', state: hazardState },
      ],
    });

    const privateLogic = logic as unknown as {
      spawnedEntities: Map<number, {
        cleanupHazardState: {
          bestTargetId: number;
          inRange: boolean;
          nextScanFrame: number;
          nextShotAvailableFrame: number;
          cleanupAreaPosition: { x: number; y: number; z: number };
          cleanupAreaMoveRange: number;
        } | null;
      }>;
    };

    expect(privateLogic.spawnedEntities.get(98)!.cleanupHazardState).toEqual({
      bestTargetId: 99,
      inRange: true,
      nextScanFrame: 7,
      nextShotAvailableFrame: 213,
      cleanupAreaPosition: { x: 5, y: 6, z: 7 },
      cleanupAreaMoveRange: 125,
    });
  });

  it('imports source DynamicShroudClearingRangeUpdate runtime state', () => {
    const bundle = makeSourceOwnedCoreBundle();
    const registry = makeRegistry(bundle);
    const map = makeMap([], 64, 64);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(64, 64));

    const sourceState = createEmptySourceMapEntitySaveState();
    sourceState.objectId = 100;
    sourceState.position = { x: 164, y: 0, z: 64 };
    sourceState.shroudClearingRange = 92;
    sourceState.modules = [{
      identifier: 'ModuleTag_DynamicShroud',
      blockData: buildSourceDynamicShroudClearingRangeUpdateModuleData({
        nextCallFrame: 201,
        stateCountdown: 60,
        totalFrames: 88,
        growStartDeadline: 70,
        sustainDeadline: 55,
        shrinkStartDeadline: 33,
        doneForeverFrame: 456,
        changeIntervalCountdown: 6,
        decalsCreated: true,
        visionChangePerInterval: 1.25,
        nativeClearingRange: 400,
        currentClearingRange: 125,
      }),
    }];

    logic.restoreSourceGameLogicImportSaveState({
      version: 1,
      sourceChunkVersion: 10,
      frameCounter: 200,
      objectIdCounter: 170,
      objects: [
        { templateName: 'DynamicShroudUnit', state: sourceState },
      ],
    });

    const privateLogic = logic as unknown as {
      spawnedEntities: Map<number, {
        shroudClearingRange: number;
        dynamicShroudState: string;
        dynamicShroudStateCountdown: number;
        dynamicShroudTotalFrames: number;
        dynamicShroudGrowStartDeadline: number;
        dynamicShroudSustainDeadline: number;
        dynamicShroudShrinkStartDeadline: number;
        dynamicShroudDoneForeverFrame: number;
        dynamicShroudChangeIntervalCountdown: number;
        dynamicShroudDecalsCreated: boolean;
        dynamicShroudVisionChangePerInterval: number;
        dynamicShroudNativeClearingRange: number;
        dynamicShroudCurrentClearingRange: number;
      }>;
    };

    const entity = privateLogic.spawnedEntities.get(100)!;
    expect(entity.shroudClearingRange).toBe(92);
    expect(entity.dynamicShroudState).toBe('GROWING');
    expect(entity.dynamicShroudStateCountdown).toBe(60);
    expect(entity.dynamicShroudTotalFrames).toBe(88);
    expect(entity.dynamicShroudGrowStartDeadline).toBe(70);
    expect(entity.dynamicShroudSustainDeadline).toBe(55);
    expect(entity.dynamicShroudShrinkStartDeadline).toBe(33);
    expect(entity.dynamicShroudDoneForeverFrame).toBe(456);
    expect(entity.dynamicShroudChangeIntervalCountdown).toBe(6);
    expect(entity.dynamicShroudDecalsCreated).toBe(true);
    expect(entity.dynamicShroudVisionChangePerInterval).toBeCloseTo(1.25);
    expect(entity.dynamicShroudNativeClearingRange).toBeCloseTo(400);
    expect(entity.dynamicShroudCurrentClearingRange).toBeCloseTo(125);
  });

  it('imports source StealthDetectorUpdate runtime state', () => {
    const bundle = makeSourceOwnedCoreBundle();
    const registry = makeRegistry(bundle);
    const map = makeMap([], 64, 64);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(64, 64));

    const sourceState = createEmptySourceMapEntitySaveState();
    sourceState.objectId = 101;
    sourceState.position = { x: 168, y: 0, z: 64 };
    sourceState.modules = [{
      identifier: 'ModuleTag_Detector',
      blockData: buildSourceStealthDetectorUpdateModuleData({
        nextCallFrame: 245,
        enabled: false,
      }),
    }];

    logic.restoreSourceGameLogicImportSaveState({
      version: 1,
      sourceChunkVersion: 10,
      frameCounter: 200,
      objectIdCounter: 170,
      objects: [
        { templateName: 'DetectorUnit', state: sourceState },
      ],
    });

    const privateLogic = logic as unknown as {
      spawnedEntities: Map<number, {
        detectorEnabled: boolean;
        detectorNextScanFrame: number;
      }>;
    };

    const entity = privateLogic.spawnedEntities.get(101)!;
    expect(entity.detectorEnabled).toBe(false);
    expect(entity.detectorNextScanFrame).toBe(245);
  });

  it('imports source PhysicsBehavior runtime state', () => {
    const bundle = makeSourceOwnedCoreBundle();
    const registry = makeRegistry(bundle);
    const map = makeMap([], 64, 64);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(64, 64));

    const sourceState = createEmptySourceMapEntitySaveState();
    sourceState.objectId = 102;
    sourceState.position = { x: 172, y: 0, z: 64 };
    sourceState.modules = [{
      identifier: 'ModuleTag_Physics',
      blockData: buildSourcePhysicsBehaviorModuleData({
        nextCallFrame: 245,
        yawRate: 0.91,
        rollRate: 0.82,
        pitchRate: 0.73,
        accel: { x: 9, y: 8, z: 7 },
        prevAccel: { x: 6, y: 5, z: 4 },
        vel: { x: 3, y: 2, z: 1 },
        turning: -1,
        ignoreCollisionsWith: 123,
        flags: SOURCE_PHYSICS_FLAG_STICK_TO_GROUND
          | SOURCE_PHYSICS_FLAG_ALLOW_BOUNCE
          | SOURCE_PHYSICS_FLAG_APPLY_FRICTION2D_WHEN_AIRBORNE
          | SOURCE_PHYSICS_FLAG_UPDATE_EVER_RUN
          | SOURCE_PHYSICS_FLAG_WAS_AIRBORNE_LAST_FRAME
          | SOURCE_PHYSICS_FLAG_ALLOW_COLLIDE_FORCE
          | SOURCE_PHYSICS_FLAG_ALLOW_TO_FALL
          | SOURCE_PHYSICS_FLAG_HAS_PITCH_ROLL_YAW
          | SOURCE_PHYSICS_FLAG_IMMUNE_TO_FALLING_DAMAGE
          | SOURCE_PHYSICS_FLAG_IS_IN_FREEFALL
          | SOURCE_PHYSICS_FLAG_IS_IN_UPDATE
          | SOURCE_PHYSICS_FLAG_IS_STUNNED,
        mass: 12.5,
        currentOverlap: 456,
        previousOverlap: 789,
        motiveForceExpires: 1024,
        extraBounciness: 0.11,
        extraFriction: 0.22,
        velMag: 2.5,
      }),
    }];

    logic.restoreSourceGameLogicImportSaveState({
      version: 1,
      sourceChunkVersion: 10,
      frameCounter: 200,
      objectIdCounter: 170,
      objects: [
        { templateName: 'PhysicsUnit', state: sourceState },
      ],
    });

    const privateLogic = logic as unknown as {
      spawnedEntities: Map<number, {
        physicsBehaviorProfile: {
          mass: number;
          allowBouncing: boolean;
          allowCollideForce: boolean;
        } | null;
        physicsBehaviorState: {
          velX: number;
          velY: number;
          velZ: number;
          accelX: number;
          accelY: number;
          accelZ: number;
          prevAccelX?: number;
          prevAccelY?: number;
          prevAccelZ?: number;
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
          turning?: number;
          ignoreCollisionsWith?: number;
          currentOverlap?: number;
          previousOverlap?: number;
          motiveForceExpires?: number;
          updateEverRun?: boolean;
          hasPitchRollYaw?: boolean;
          applyFriction2dWhenAirborne?: boolean;
          immuneToFallingDamage?: boolean;
          isInUpdate?: boolean;
          velMag?: number;
        } | null;
      }>;
    };

    const entity = privateLogic.spawnedEntities.get(102)!;
    expect(entity.physicsBehaviorProfile).toMatchObject({
      mass: 12.5,
      allowBouncing: true,
      allowCollideForce: true,
    });
    expect(entity.physicsBehaviorState).toMatchObject({
      velX: 3,
      velY: 1,
      velZ: 2,
      accelX: 9,
      accelY: 7,
      accelZ: 8,
      prevAccelX: 6,
      prevAccelY: 4,
      prevAccelZ: 5,
      wasAirborneLastFrame: true,
      stickToGround: true,
      allowToFall: true,
      isInFreeFall: true,
      isStunned: true,
      turning: -1,
      ignoreCollisionsWith: 123,
      currentOverlap: 456,
      previousOverlap: 789,
      motiveForceExpires: 1024,
      updateEverRun: true,
      hasPitchRollYaw: true,
      applyFriction2dWhenAirborne: true,
      immuneToFallingDamage: true,
      isInUpdate: true,
      velMag: 2.5,
    });
    expect(entity.physicsBehaviorState!.yawRate).toBeCloseTo(0.91);
    expect(entity.physicsBehaviorState!.pitchRate).toBeCloseTo(0.73);
    expect(entity.physicsBehaviorState!.rollRate).toBeCloseTo(0.82);
    expect(entity.physicsBehaviorState!.extraBounciness).toBeCloseTo(0.11);
    expect(entity.physicsBehaviorState!.extraFriction).toBeCloseTo(0.22);
  });

  it('imports source LifetimeUpdate runtime state', () => {
    const bundle = makeSourceOwnedCoreBundle();
    const registry = makeRegistry(bundle);
    const map = makeMap([], 64, 64);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(64, 64));

    const sourceState = createEmptySourceMapEntitySaveState();
    sourceState.objectId = 103;
    sourceState.position = { x: 176, y: 0, z: 64 };
    sourceState.modules = [{
      identifier: 'ModuleTag_Lifetime',
      blockData: buildSourceLifetimeUpdateModuleData({
        nextCallFrame: 333,
        dieFrame: 333,
      }),
    }];

    logic.restoreSourceGameLogicImportSaveState({
      version: 1,
      sourceChunkVersion: 10,
      frameCounter: 200,
      objectIdCounter: 180,
      objects: [
        { templateName: 'LifetimeObject', state: sourceState },
      ],
    });

    const privateLogic = logic as unknown as {
      spawnedEntities: Map<number, {
        lifetimeDieFrame: number | null;
      }>;
    };

    expect(privateLogic.spawnedEntities.get(103)!.lifetimeDieFrame).toBe(333);
  });

  it('imports source DeletionUpdate runtime state', () => {
    const bundle = makeSourceOwnedCoreBundle();
    const registry = makeRegistry(bundle);
    const map = makeMap([], 64, 64);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(64, 64));

    const sourceState = createEmptySourceMapEntitySaveState();
    sourceState.objectId = 104;
    sourceState.position = { x: 180, y: 0, z: 64 };
    sourceState.modules = [{
      identifier: 'ModuleTag_Delete',
      blockData: buildSourceDeletionUpdateModuleData({
        nextCallFrame: 444,
        dieFrame: 444,
      }),
    }];

    logic.restoreSourceGameLogicImportSaveState({
      version: 1,
      sourceChunkVersion: 10,
      frameCounter: 200,
      objectIdCounter: 180,
      objects: [
        { templateName: 'DeletionObject', state: sourceState },
      ],
    });

    const privateLogic = logic as unknown as {
      spawnedEntities: Map<number, {
        deletionDieFrame: number | null;
      }>;
    };

    expect(privateLogic.spawnedEntities.get(104)!.deletionDieFrame).toBe(444);
  });

  it('imports source AutoFindHealingUpdate runtime state', () => {
    const bundle = makeSourceOwnedCoreBundle();
    const registry = makeRegistry(bundle);
    const map = makeMap([], 64, 64);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(64, 64));

    const sourceState = createEmptySourceMapEntitySaveState();
    sourceState.objectId = 105;
    sourceState.position = { x: 182, y: 0, z: 64 };
    sourceState.modules = [{
      identifier: 'ModuleTag_AutoFindHealing',
      blockData: buildSourceAutoFindHealingUpdateModuleData({
        nextCallFrame: 555,
        nextScanFrames: 15,
      }),
    }];

    logic.restoreSourceGameLogicImportSaveState({
      version: 1,
      sourceChunkVersion: 10,
      frameCounter: 200,
      objectIdCounter: 180,
      objects: [
        { templateName: 'HealingSeeker', state: sourceState },
      ],
    });

    const privateLogic = logic as unknown as {
      spawnedEntities: Map<number, {
        autoFindHealingNextScanFrame: number;
      }>;
    };

    expect(privateLogic.spawnedEntities.get(105)!.autoFindHealingNextScanFrame).toBe(216);
  });

  it('imports source AutoDepositUpdate runtime state', () => {
    const bundle = makeSourceOwnedCoreBundle();
    const registry = makeRegistry(bundle);
    const map = makeMap([], 64, 64);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(64, 64));

    const sourceState = createEmptySourceMapEntitySaveState();
    sourceState.objectId = 106;
    sourceState.position = { x: 183, y: 0, z: 64 };
    sourceState.modules = [{
      identifier: 'ModuleTag_AutoDeposit',
      blockData: buildSourceAutoDepositUpdateModuleData({
        nextCallFrame: 210,
        depositOnFrame: 260,
        awardInitialCaptureBonus: true,
        initialized: true,
      }),
    }];

    logic.restoreSourceGameLogicImportSaveState({
      version: 1,
      sourceChunkVersion: 10,
      frameCounter: 200,
      objectIdCounter: 180,
      objects: [
        { templateName: 'AutoDepositStructure', state: sourceState },
      ],
    });

    const privateLogic = logic as unknown as {
      spawnedEntities: Map<number, {
        autoDepositNextFrame: number;
        autoDepositCaptureBonusPending: boolean;
        autoDepositInitialized: boolean;
      }>;
    };

    const entity = privateLogic.spawnedEntities.get(106)!;
    expect(entity.autoDepositNextFrame).toBe(260);
    expect(entity.autoDepositCaptureBonusPending).toBe(true);
    expect(entity.autoDepositInitialized).toBe(true);
  });

  it('imports source BaseRegenerateUpdate wake state', () => {
    const bundle = makeSourceOwnedCoreBundle();
    const registry = makeRegistry(bundle);
    const map = makeMap([], 64, 64);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(64, 64));

    const sourceState = createEmptySourceMapEntitySaveState();
    sourceState.objectId = 107;
    sourceState.position = { x: 183, y: 0, z: 64 };
    sourceState.modules = [{
      identifier: 'ModuleTag_BaseRegen',
      blockData: buildSourceBaseRegenerateUpdateModuleData({
        nextCallFrame: 240,
      }),
    }];

    logic.restoreSourceGameLogicImportSaveState({
      version: 1,
      sourceChunkVersion: 10,
      frameCounter: 200,
      objectIdCounter: 180,
      objects: [
        { templateName: 'BaseRegenStructure', state: sourceState },
      ],
    });

    const privateLogic = logic as unknown as {
      spawnedEntities: Map<number, {
        baseRegenDelayUntilFrame: number;
      }>;
    };

    expect(privateLogic.spawnedEntities.get(107)!.baseRegenDelayUntilFrame).toBe(240);
  });

  it('imports source CommandButtonHuntUpdate runtime state', () => {
    const bundle = makeSourceOwnedCoreBundle();
    const registry = makeRegistry(bundle);
    const map = makeMap([], 64, 64);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(64, 64));

    const sourceState = createEmptySourceMapEntitySaveState();
    sourceState.objectId = 108;
    sourceState.position = { x: 184, y: 0, z: 64 };
    sourceState.modules = [{
      identifier: 'ModuleTag_Hunt',
      blockData: buildSourceCommandButtonHuntUpdateModuleData({
        nextCallFrame: 260,
        commandButtonName: 'Command_HuntFireWeapon',
      }),
    }];

    logic.restoreSourceGameLogicImportSaveState({
      version: 1,
      sourceChunkVersion: 10,
      frameCounter: 200,
      objectIdCounter: 180,
      objects: [
        { templateName: 'CommandHunter', state: sourceState },
      ],
    });

    const privateLogic = logic as unknown as {
      spawnedEntities: Map<number, {
        commandButtonHuntMode: string;
        commandButtonHuntButtonName: string;
        commandButtonHuntNextScanFrame: number;
      }>;
    };

    const entity = privateLogic.spawnedEntities.get(108)!;
    expect(entity.commandButtonHuntMode).toBe('WEAPON');
    expect(entity.commandButtonHuntButtonName).toBe('Command_HuntFireWeapon');
    expect(entity.commandButtonHuntNextScanFrame).toBe(260);
  });

  it('imports source FireSpreadUpdate wake state', () => {
    const bundle = makeSourceOwnedCoreBundle();
    const registry = makeRegistry(bundle);
    const map = makeMap([], 64, 64);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(64, 64));

    const sourceState = createEmptySourceMapEntitySaveState();
    sourceState.objectId = 109;
    sourceState.position = { x: 185, y: 0, z: 64 };
    sourceState.modules = [{
      identifier: 'ModuleTag_FireSpread',
      blockData: buildSourceFireSpreadUpdateModuleData({
        nextCallFrame: 300,
      }),
    }];

    logic.restoreSourceGameLogicImportSaveState({
      version: 1,
      sourceChunkVersion: 10,
      frameCounter: 200,
      objectIdCounter: 180,
      objects: [
        { templateName: 'FireSpreader', state: sourceState },
      ],
    });

    const privateLogic = logic as unknown as {
      spawnedEntities: Map<number, {
        fireSpreadNextFrame: number;
      }>;
    };

    expect(privateLogic.spawnedEntities.get(109)!.fireSpreadNextFrame).toBe(300);
  });

  it('imports source FlammableUpdate runtime state', () => {
    const bundle = makeSourceOwnedCoreBundle();
    const registry = makeRegistry(bundle);
    const map = makeMap([], 64, 64);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(64, 64));

    const sourceState = createEmptySourceMapEntitySaveState();
    sourceState.objectId = 112;
    sourceState.position = { x: 186, y: 0, z: 64 };
    sourceState.statusBits = ['AFLAME'];
    sourceState.modules = [{
      identifier: 'ModuleTag_Flammable',
      blockData: buildSourceFlammableUpdateModuleData({
        nextCallFrame: 275,
        status: 1,
        aflameEndFrame: 320,
        burnedEndFrame: 300,
        damageEndFrame: 275,
        flameDamageLimit: 5,
        lastFlameDamageDealt: 260,
      }),
    }];

    logic.restoreSourceGameLogicImportSaveState({
      version: 1,
      sourceChunkVersion: 10,
      frameCounter: 200,
      objectIdCounter: 180,
      objects: [
        { templateName: 'FlammableObject', state: sourceState },
      ],
    });

    const privateLogic = logic as unknown as {
      spawnedEntities: Map<number, {
        flameStatus: string;
        flameDamageAccumulated: number;
        flameEndFrame: number;
        flameBurnedEndFrame: number;
        flameDamageNextFrame: number;
        flameLastDamageReceivedFrame: number;
        objectStatusFlags: Set<string>;
      }>;
    };

    const entity = privateLogic.spawnedEntities.get(112)!;
    expect(entity.flameStatus).toBe('AFLAME');
    expect(entity.flameEndFrame).toBe(320);
    expect(entity.flameBurnedEndFrame).toBe(300);
    expect(entity.flameDamageNextFrame).toBe(275);
    expect(entity.flameLastDamageReceivedFrame).toBe(260);
    expect(entity.flameDamageAccumulated).toBe(15);
    expect(entity.objectStatusFlags.has('AFLAME')).toBe(true);
  });

  it('imports source HeightDieUpdate runtime state', () => {
    const bundle = makeSourceOwnedCoreBundle();
    const registry = makeRegistry(bundle);
    const map = makeMap([], 64, 64);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(64, 64));

    const sourceState = createEmptySourceMapEntitySaveState();
    sourceState.objectId = 110;
    sourceState.position = { x: 184, y: 0, z: 64 };
    sourceState.modules = [{
      identifier: 'ModuleTag_HeightDie',
      blockData: buildSourceHeightDieUpdateModuleData({
        nextCallFrame: 555,
        hasDied: true,
        particlesDestroyed: true,
        lastPosition: { x: 5, y: 6, z: 7 },
        earliestDeathFrame: 260,
      }),
    }];

    logic.restoreSourceGameLogicImportSaveState({
      version: 1,
      sourceChunkVersion: 10,
      frameCounter: 200,
      objectIdCounter: 180,
      objects: [
        { templateName: 'HeightDieUnit', state: sourceState },
      ],
    });

    const privateLogic = logic as unknown as {
      spawnedEntities: Map<number, {
        heightDieActiveFrame: number;
        heightDieHasDied: boolean;
        heightDieLastPositionX: number;
        heightDieLastPositionZ: number;
        heightDieLastY: number;
        heightDieParticlesDestroyed: boolean;
      }>;
    };

    const entity = privateLogic.spawnedEntities.get(110)!;
    expect(entity.heightDieActiveFrame).toBe(260);
    expect(entity.heightDieHasDied).toBe(true);
    expect(entity.heightDieParticlesDestroyed).toBe(true);
    expect(entity.heightDieLastPositionX).toBe(5);
    expect(entity.heightDieLastPositionZ).toBe(6);
    expect(entity.heightDieLastY).toBe(7);
  });

  it('imports source StickyBombUpdate runtime state', () => {
    const bundle = makeSourceOwnedCoreBundle();
    const registry = makeRegistry(bundle);
    const map = makeMap([], 64, 64);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(64, 64));

    const sourceState = createEmptySourceMapEntitySaveState();
    sourceState.objectId = 111;
    sourceState.position = { x: 188, y: 0, z: 64 };
    sourceState.modules = [{
      identifier: 'ModuleTag_StickyBomb',
      blockData: buildSourceStickyBombUpdateModuleData({
        nextCallFrame: 666,
        targetId: 55,
        dieFrame: 300,
        nextPingFrame: 270,
      }),
    }];

    logic.restoreSourceGameLogicImportSaveState({
      version: 1,
      sourceChunkVersion: 10,
      frameCounter: 200,
      objectIdCounter: 180,
      objects: [
        { templateName: 'StickyBombObject', state: sourceState },
      ],
    });

    const privateLogic = logic as unknown as {
      spawnedEntities: Map<number, {
        stickyBombTargetId: number;
        stickyBombDieFrame: number;
        stickyBombNextPingFrame: number;
      }>;
    };

    const entity = privateLogic.spawnedEntities.get(111)!;
    expect(entity.stickyBombTargetId).toBe(55);
    expect(entity.stickyBombDieFrame).toBe(300);
    expect(entity.stickyBombNextPingFrame).toBe(270);
  });

  it('stores buildable overrides and sell-list state in the source game-logic chunk', () => {
    const bundle = makeSourceOwnedCoreBundle();
    const registry = makeRegistry(bundle);
    const map = makeMap([makeMapObject('AmericaBarracks', 20, 20)], 64, 64);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(64, 64));

    const privateLogic = logic as unknown as {
      frameCounter: number;
      sellingEntities: Map<number, { sellFrame: number; constructionPercent: number }>;
      thingTemplateBuildableOverrides: Map<string, string>;
      commandSetButtonSlotOverrides: Map<string, Map<number, string | null>>;
    };
    privateLogic.frameCounter = 20;
    privateLogic.sellingEntities.set(1, { sellFrame: 20, constructionPercent: 99.9 });
    privateLogic.thingTemplateBuildableOverrides.set('AMERICABARRACKS', 'NO');
    privateLogic.commandSetButtonSlotOverrides.set(
      'AMERICABARRACKSCOMMANDSET',
      new Map([[1, 'COMMAND_AMERICA_BARRACKS']],),
    );

    const coreState = logic.captureSourceGameLogicRuntimeSaveState();
    const browserState = logic.captureBrowserRuntimeSaveState();

    expect(browserState).not.toHaveProperty('sellingEntities');
    expect(browserState).not.toHaveProperty('thingTemplateBuildableOverrides');
    expect(browserState).not.toHaveProperty('commandSetButtonSlotOverrides');
    expect(browserState).not.toHaveProperty('bridgeDamageStatesChangedFrame');
    expect(browserState).not.toHaveProperty('bridgeDamageStateByControlEntity');

    const restored = new GameLogicSubsystem(new THREE.Scene());
    restored.loadMapObjects(map, registry, makeHeightmap(64, 64));
    restored.restoreSourceGameLogicRuntimeSaveState(coreState);
    restored.restoreBrowserRuntimeSaveState(browserState);

    const restoredPrivate = restored as unknown as typeof privateLogic;
    expect(restoredPrivate.thingTemplateBuildableOverrides).toEqual(
      new Map([['AMERICABARRACKS', 'NO']]),
    );
    expect(restoredPrivate.commandSetButtonSlotOverrides).toEqual(
      new Map([['AMERICABARRACKSCOMMANDSET', new Map([[1, 'COMMAND_AMERICA_BARRACKS']])]]),
    );
    expect(restoredPrivate.sellingEntities.get(1)).toEqual({
      sellFrame: 20,
      constructionPercent: 99.9,
    });
  });

  it('hydrates legacy browser buildable overrides and sell-list maps', () => {
    const bundle = makeSourceOwnedCoreBundle();
    const registry = makeRegistry(bundle);
    const map = makeMap([makeMapObject('AmericaBarracks', 20, 20)], 64, 64);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(64, 64));

    logic.restoreBrowserRuntimeSaveState({
      version: 1,
      gameRandomSeed: 1,
      sellingEntities: new Map([[1, {
        sellFrame: 12,
        constructionPercent: 88.5,
      }]]),
      thingTemplateBuildableOverrides: new Map([['AmericaBarracks', 'ONLY_BY_AI']]),
      commandSetButtonSlotOverrides: new Map([
        ['AmericaBarracksCommandSet', new Map([[1, 'Command_America_Barracks'], [2, null]])],
      ]),
      bridgeDamageStatesChangedFrame: 77,
      bridgeDamageStateByControlEntity: new Map([[1, false]]),
    });

    const privateLogic = logic as unknown as {
      sellingEntities: Map<number, { sellFrame: number; constructionPercent: number }>;
      thingTemplateBuildableOverrides: Map<string, string>;
      commandSetButtonSlotOverrides: Map<string, Map<number, string | null>>;
    };

    expect(privateLogic.sellingEntities.get(1)).toEqual({
      sellFrame: 12,
      constructionPercent: 88.5,
    });
    expect(privateLogic.thingTemplateBuildableOverrides).toEqual(
      new Map([['AMERICABARRACKS', 'ONLY_BY_AI']]),
    );
    expect(privateLogic.commandSetButtonSlotOverrides).toEqual(
      new Map([['AMERICABARRACKSCOMMANDSET', new Map([[1, 'COMMAND_AMERICA_BARRACKS'], [2, null]])]]),
    );
  });
});
