import * as THREE from 'three';
import type { InputState } from '@generals/input';
import type { ModelConditionInfo, TransitionInfo } from './render-profile-helpers.js';

export interface MapObjectPlacementSummary {
  totalObjects: number;
  spawnedObjects: number;
  skippedObjects: number;
  resolvedObjects: number;
  unresolvedObjects: number;
}

export type RenderAnimationState = 'IDLE' | 'MOVE' | 'ATTACK' | 'DIE' | 'PRONE';
export type RenderAnimationStateClipCandidates = Partial<Record<RenderAnimationState, string[]>>;

export type { ModelConditionInfo, TransitionInfo, IdleAnimationVariant } from './render-profile-helpers.js';

export type RenderableObjectCategory = 'air' | 'building' | 'infantry' | 'vehicle' | 'unknown';

export interface RenderableEntityState {
  id: number;
  templateName: string;
  resolved: boolean;
  renderAssetCandidates: string[];
  renderAssetPath: string | null;
  renderAssetResolved: boolean;
  renderAnimationStateClips?: RenderAnimationStateClipCandidates;
  modelConditionInfos?: ModelConditionInfo[];
  transitionInfos?: TransitionInfo[];
  modelConditionFlags?: readonly string[];
  currentSpeed?: number;
  maxSpeed?: number;
  category: RenderableObjectCategory;
  x: number;
  y: number;
  z: number;
  rotationY: number;
  animationState: RenderAnimationState;
  health: number;
  maxHealth: number;
  isSelected: boolean;
  side?: string;
  veterancyLevel: number;
  isStealthed: boolean;
  isDetected: boolean;
  /** Source parity: StealthUpdate.h:86 — per-module friendly opacity for stealthed ally rendering.
   *  Set when entity is stealthed and owned by local player. 0 = fully transparent, 1 = fully opaque. */
  stealthFriendlyOpacity: number;
  /** Source parity: StealthUpdate disguise — template name the unit is visually disguised as.
   *  null when not disguised. Used by the renderer to swap the visual model. */
  disguiseTemplateName: string | null;
  /** Source parity bridge: Drawable::setFlash count remaining. */
  scriptFlashCount?: number;
  /** Source parity bridge: Drawable indicator flash color (0xRRGGBB). */
  scriptFlashColor?: number;
  /** Source parity bridge: Drawable ambient event selected by current body damage state. */
  ambientSoundEventName?: string | null;
  /** Source parity bridge: Drawable::m_ambientSoundEnabledFromScript script gate. */
  scriptAmbientSoundEnabled?: boolean;
  /** Source parity bridge: increments on every ENABLE/DISABLE_OBJECT_SOUND action. */
  scriptAmbientSoundRevision?: number;
  /** Source parity: ObjectShroudStatus — visibility from the local player's perspective. */
  shroudStatus: 'CLEAR' | 'FOGGED' | 'SHROUDED';
  /** Source parity: Object::m_constructionPercent — 0..100 during build, -1 when complete. */
  constructionPercent: number;
  /** Source parity: capture progress — 0..100 during capture, -1 when not being captured. */
  capturePercent: number;
  /** Source parity: ToppleUpdate — angular tilt in radians (0 = upright, PI/2 = fallen). */
  toppleAngle: number;
  /** Source parity: ToppleUpdate — topple direction X component (unit vector). */
  toppleDirX: number;
  /** Source parity: ToppleUpdate — topple direction Z component (unit vector). */
  toppleDirZ: number;
  /** Source parity: TurretAI — turret rotation angles in radians (relative to body), one per turret. */
  turretAngles: number[];
  /** Active status effects for overlay icons (poisoned, burning, EMP'd, etc.). */
  statusEffects?: readonly string[];
  /** Source parity: Geometry MajorRadius — used for selection circle sizing. */
  selectionCircleRadius?: number;
  /** True when this entity belongs to the local player's side. */
  isOwnedByLocalPlayer?: boolean;
  /** True when the entity is in guard mode (guardState !== 'NONE'). */
  isGuarding?: boolean;
  /** Source parity: ProjectileStreamUpdate — positions of active projectiles in stream. */
  streamPoints?: { x: number; y: number; z: number }[];
  /** Source parity: RadiusDecalUpdate — ground radius decal states for targeting visualization. */
  radiusDecals?: RenderableRadiusDecal[];
  /** Source parity: BoneFXUpdate — pending bone FX/OCL/ParticleSystem visual events. */
  boneFXEvents?: BoneFXVisualEvent[];
  /** Source parity: ThingTemplate::m_shadowType — INI Shadow field (e.g. SHADOW_DECAL, SHADOW_VOLUME). */
  shadowType?: string;
  /** Source parity: ThingTemplate::m_shadowSizeX — shadow decal X extent. */
  shadowSizeX?: number;
  /** Source parity: ThingTemplate::m_shadowSizeY — shadow decal Y extent. */
  shadowSizeY?: number;
  /** Tunnel enter/exit transition opacity override (0..1). Undefined = no transition active. */
  tunnelTransitionOpacity?: number;
}

/**
 * Source parity: RadiusDecalUpdate — renderable state for a ground radius decal.
 */
export interface RenderableRadiusDecal {
  positionX: number;
  positionY: number;
  positionZ: number;
  radius: number;
  visible: boolean;
}

/**
 * Source parity: BoneFXUpdate — visual event emitted when a bone FX/OCL/ParticleSystem fires.
 */
export interface BoneFXVisualEvent {
  type: 'FX' | 'OCL' | 'PARTICLE_SYSTEM';
  boneName: string;
  effectName: string;
  positionX: number;
  positionY: number;
  positionZ: number;
  entityId: number;
}

export interface ScriptObjectAmbientSoundState {
  entityId: number;
  audioName: string;
  enabled: boolean;
  toggleRevision: number;
  /** Source parity: map-script customized ambient event definition for this object instance. */
  customAudioDefinition?: ScriptObjectAmbientCustomAudioDefinition;
}

export interface ScriptObjectAmbientCustomAudioDefinition {
  /** Base AudioEvent to clone before applying map customization overrides. */
  sourceAudioName: string;
  loopingOverride?: boolean;
  loopCountOverride?: number;
  minVolumeOverride?: number;
  volumeOverride?: number;
  minRangeOverride?: number;
  maxRangeOverride?: number;
  priorityNameOverride?: 'LOWEST' | 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL';
}

export type GameEndStatus = 'ACTIVE' | 'VICTORY' | 'DEFEAT';

export interface GameEndState {
  status: GameEndStatus;
  endFrame: number;
  victorSides: string[];
  defeatedSides: string[];
}

export type ProjectileVisualType = 'BULLET' | 'MISSILE' | 'ARTILLERY' | 'LASER';

export interface ActiveProjectile {
  id: number;
  sourceEntityId: number;
  visualType: ProjectileVisualType;
  /** Current interpolated position. */
  x: number;
  y: number;
  z: number;
  /** Target impact position. */
  targetX: number;
  targetZ: number;
  /** Flight progress 0..1. */
  progress: number;
  /** Heading angle in radians. */
  heading: number;
}

export type VisualEventType = 'WEAPON_IMPACT' | 'ENTITY_DESTROYED' | 'WEAPON_FIRED';

export interface VisualEvent {
  type: VisualEventType;
  x: number;
  y: number;
  z: number;
  /** Damage radius (for scaling explosion size). 0 for non-AOE. */
  radius: number;
  /** Source entity id (for muzzle flash positioning). */
  sourceEntityId: number | null;
  /** Visual type hint for the effect. */
  projectileType: ProjectileVisualType;
  /** Target endpoint for directed weapon visuals (laser beams, bullet tracers). */
  targetX?: number;
  targetY?: number;
  targetZ?: number;
  /** Weapon fire sound AudioEvent name (from INI FireSound field). */
  fireSoundEvent?: string;
  /**
   * Source parity: DamageInfoInput::m_damageFXOverride — allows a weapon to override
   * which damage FX plays on the victim. 'UNRESISTABLE' means no override (default).
   * (Damage.h:269, ActiveBody.cpp:321-329)
   */
  damageFXOverride?: string;
}

/**
 * Source parity: Eva.h — EVA announcer event types.
 * These map to voice lines the UI/audio system should play.
 */
export type EvaEventType =
  | 'LOW_POWER'
  | 'INSUFFICIENT_FUNDS'
  | 'BUILDING_LOST'
  | 'UNIT_LOST'
  | 'BASE_UNDER_ATTACK'
  | 'ALLY_UNDER_ATTACK'
  | 'UPGRADE_COMPLETE'
  | 'GENERAL_LEVEL_UP'
  | 'VEHICLE_STOLEN'
  | 'BUILDING_STOLEN'
  | 'SUPERWEAPON_DETECTED'
  | 'SUPERWEAPON_LAUNCHED'
  | 'SUPERWEAPON_READY'
  | 'CONSTRUCTION_COMPLETE'
  | 'UNIT_READY'
  | 'BEACON_DETECTED'
  | 'CASH_STOLEN'
  | 'BUILDING_SABOTAGED';

export interface EvaEvent {
  type: EvaEventType;
  /** Side this event applies to (e.g., which player's EVA speaks). */
  side: string;
  /** Relationship to local player: 'own' | 'ally' | 'enemy'. */
  relationship: 'own' | 'ally' | 'enemy';
  /** Optional entity ID associated with the event. */
  entityId: number | null;
  /** Optional extra info (e.g., upgrade name, superweapon type). */
  detail: string | null;
}

export interface SelectByIdCommand {
  type: 'select';
  entityId: number;
}

export interface ClearSelectionCommand {
  type: 'clearSelection';
}

export interface SelectEntitySetCommand {
  type: 'selectEntities';
  entityIds: number[];
}

export interface MoveToCommand {
  type: 'moveTo';
  entityId: number;
  targetX: number;
  targetZ: number;
  commandSource?: 'PLAYER' | 'AI' | 'SCRIPT';
}

export interface AttackMoveToCommand {
  type: 'attackMoveTo';
  entityId: number;
  targetX: number;
  targetZ: number;
  attackDistance: number;
  commandSource?: 'PLAYER' | 'AI' | 'SCRIPT';
}

export enum GuardMode {
  GUARDMODE_NORMAL = 0,
  GUARDMODE_GUARD_WITHOUT_PURSUIT = 1,
  GUARDMODE_GUARD_FLYING_UNITS_ONLY = 2,
}

export interface GuardPositionCommand {
  type: 'guardPosition';
  entityId: number;
  targetX: number;
  targetZ: number;
  guardMode: GuardMode;
  commandSource?: 'PLAYER' | 'AI' | 'SCRIPT';
}

export interface GuardObjectCommand {
  type: 'guardObject';
  entityId: number;
  targetEntityId: number;
  guardMode: GuardMode;
  commandSource?: 'PLAYER' | 'AI' | 'SCRIPT';
}

export interface SetRallyPointCommand {
  type: 'setRallyPoint';
  entityId: number;
  targetX: number;
  targetZ: number;
}

export interface AttackEntityCommand {
  type: 'attackEntity';
  entityId: number;
  targetEntityId: number;
  commandSource?: 'PLAYER' | 'AI' | 'SCRIPT';
}

export interface FireWeaponCommand {
  type: 'fireWeapon';
  entityId: number;
  weaponSlot: number;
  maxShotsToFire: number;
  targetObjectId: number | null;
  targetPosition: readonly [number, number, number] | null;
}

export interface StopCommand {
  type: 'stop';
  entityId: number;
  commandSource?: 'PLAYER' | 'AI' | 'SCRIPT';
}

export interface BridgeDestroyedCommand {
  type: 'bridgeDestroyed';
  entityId: number;
}

export interface BridgeRepairedCommand {
  type: 'bridgeRepaired';
  entityId: number;
}

export interface SetLocomotorSetCommand {
  type: 'setLocomotorSet';
  entityId: number;
  setName: string;
}

export interface SetLocomotorUpgradeCommand {
  type: 'setLocomotorUpgrade';
  entityId: number;
  enabled: boolean;
}

export interface CaptureEntityCommand {
  type: 'captureEntity';
  entityId: number;
  newSide: string;
}

export interface ApplyUpgradeCommand {
  type: 'applyUpgrade';
  entityId: number;
  upgradeName: string;
}

export interface QueueUnitProductionCommand {
  type: 'queueUnitProduction';
  entityId: number;
  unitTemplateName: string;
}

export interface CancelUnitProductionCommand {
  type: 'cancelUnitProduction';
  entityId: number;
  productionId: number;
}

export interface QueueUpgradeProductionCommand {
  type: 'queueUpgradeProduction';
  entityId: number;
  upgradeName: string;
}

export interface CancelUpgradeProductionCommand {
  type: 'cancelUpgradeProduction';
  entityId: number;
  upgradeName: string;
}

export interface SetSideCreditsCommand {
  type: 'setSideCredits';
  side: string;
  amount: number;
}

export interface AddSideCreditsCommand {
  type: 'addSideCredits';
  side: string;
  amount: number;
}

export interface SetSidePlayerTypeCommand {
  type: 'setSidePlayerType';
  side: string;
  playerType: 'HUMAN' | 'COMPUTER';
}

export interface GrantSideScienceCommand {
  type: 'grantSideScience';
  side: string;
  scienceName: string;
}

export interface ApplyPlayerUpgradeCommand {
  type: 'applyPlayerUpgrade';
  upgradeName: string;
}

export interface PurchaseScienceCommand {
  type: 'purchaseScience';
  scienceName: string;
  scienceCost: number;
  /** Source parity: AI players specify their side explicitly; human players use local-player fallback. */
  side?: string;
}

export interface IssueSpecialPowerCommand {
  type: 'issueSpecialPower';
  commandSource?: 'PLAYER' | 'AI' | 'SCRIPT';
  commandButtonId: string;
  specialPowerName: string;
  commandOption: number;
  issuingEntityIds: number[];
  sourceEntityId: number | null;
  targetEntityId: number | null;
  targetX: number | null;
  targetZ: number | null;
  /**
   * Source parity (ZH): AIGroup::groupDoSpecialPowerAtLocation gains an angle parameter
   * for creation orientation. C++ AIGroup.cpp:2676. Defaults to 0 when not provided.
   */
  angle?: number;
}

export interface SwitchWeaponCommand {
  type: 'switchWeapon';
  entityId: number;
  weaponSlot: number;
}

export interface SellCommand {
  type: 'sell';
  entityId: number;
}

export interface ExitContainerCommand {
  type: 'exitContainer';
  entityId: number;
}

/**
 * Source parity (ZH): AIUpdate.cpp:2756 — AICMD_EXIT_INSTANTLY.
 * Immediately exits the entity from its container without waiting for
 * exit animations or door coordination. Used by orderAllPassengersToExit(instantly=true).
 */
export interface ExitContainerInstantlyCommand {
  type: 'exitContainerInstantly';
  entityId: number;
}

export interface EvacuateCommand {
  type: 'evacuate';
  entityId: number;
}

export interface ExecuteRailedTransportCommand {
  type: 'executeRailedTransport';
  entityId: number;
}

export interface BeaconDeleteCommand {
  type: 'beaconDelete';
  entityId: number;
}

export interface HackInternetCommand {
  type: 'hackInternet';
  entityId: number;
}

export interface ToggleOverchargeCommand {
  type: 'toggleOvercharge';
  entityId: number;
}

export interface DetonateDemoTrapCommand {
  type: 'detonateDemoTrap';
  entityId: number;
}

export interface ToggleDemoTrapModeCommand {
  type: 'toggleDemoTrapMode';
  entityId: number;
}

export interface CombatDropCommand {
  type: 'combatDrop';
  entityId: number;
  targetObjectId: number | null;
  targetPosition: readonly [number, number, number] | null;
  commandSource?: 'PLAYER' | 'AI' | 'SCRIPT';
}

export interface PlaceBeaconCommand {
  type: 'placeBeacon';
  targetPosition: readonly [number, number, number];
}

export interface EnterObjectCommand {
  type: 'enterObject';
  entityId: number;
  targetObjectId: number;
  commandSource?: 'PLAYER' | 'AI' | 'SCRIPT';
  action:
    | 'hijackVehicle'
    | 'convertToCarBomb'
    | 'sabotageBuilding'
    | 'repairVehicle'
    | 'captureUnmannedFactionUnit';
}

export interface ConstructBuildingCommand {
  type: 'constructBuilding';
  entityId: number;
  templateName: string;
  targetPosition: readonly [number, number, number];
  angle: number;
  lineEndPosition: readonly [number, number, number] | null;
}

export interface CancelDozerConstructionCommand {
  type: 'cancelDozerConstruction';
  entityId: number;
}

export interface GarrisonBuildingCommand {
  type: 'garrisonBuilding';
  entityId: number;
  targetBuildingId: number;
}

export interface RepairBuildingCommand {
  type: 'repairBuilding';
  entityId: number;
  targetBuildingId: number;
  commandSource?: 'PLAYER' | 'AI' | 'SCRIPT';
}

export interface EnterTransportCommand {
  type: 'enterTransport';
  entityId: number;
  targetTransportId: number;
  commandSource?: 'PLAYER' | 'AI' | 'SCRIPT';
}

export type GameLogicCommand =
  | SelectByIdCommand
  | SelectEntitySetCommand
  | ClearSelectionCommand
  | MoveToCommand
  | AttackMoveToCommand
  | GuardPositionCommand
  | GuardObjectCommand
  | SetRallyPointCommand
  | AttackEntityCommand
  | FireWeaponCommand
  | StopCommand
  | BridgeDestroyedCommand
  | BridgeRepairedCommand
  | SetLocomotorSetCommand
  | SetLocomotorUpgradeCommand
  | CaptureEntityCommand
  | ApplyUpgradeCommand
  | QueueUnitProductionCommand
  | CancelUnitProductionCommand
  | QueueUpgradeProductionCommand
  | CancelUpgradeProductionCommand
  | SetSideCreditsCommand
  | AddSideCreditsCommand
  | SetSidePlayerTypeCommand
  | GrantSideScienceCommand
  | ApplyPlayerUpgradeCommand
  | PurchaseScienceCommand
  | IssueSpecialPowerCommand
  | ExitContainerCommand
  | ExitContainerInstantlyCommand
  | EvacuateCommand
  | ExecuteRailedTransportCommand
  | BeaconDeleteCommand
  | SellCommand
  | HackInternetCommand
  | ToggleOverchargeCommand
  | DetonateDemoTrapCommand
  | ToggleDemoTrapModeCommand
  | CombatDropCommand
  | PlaceBeaconCommand
  | EnterObjectCommand
  | ConstructBuildingCommand
  | CancelDozerConstructionCommand
  | GarrisonBuildingCommand
  | RepairBuildingCommand
  | EnterTransportCommand
  | SwitchWeaponCommand;

export interface SelectedEntityInfo {
  id: number;
  templateName: string;
  category: RenderableObjectCategory;
  side?: string;
  resolved: boolean;
  canMove: boolean;
  hasAutoRallyPoint: boolean;
  isUnmanned: boolean;
  isDozer: boolean;
  isMoving: boolean;
  appliedUpgradeNames: string[];
  objectStatusFlags: string[];
  modelConditionFlags: string[];
}

export type EntityRelationship = 'enemies' | 'neutral' | 'allies';
export type LocalScienceAvailability = 'enabled' | 'disabled' | 'hidden';

export interface GameLogicConfig {
  /**
   * Optional renderer-side object picker callback for pointer selection/hit-testing.
   */
  pickObjectByInput?: (input: InputState, camera: THREE.Camera) => number | null;
  /**
   * Source parity: View::isCameraMovementFinished consumed by script condition
   * CAMERA_MOVEMENT_FINISHED.
   */
  isCameraMovementFinished?: () => boolean;
  /**
   * Source parity: View::isTimeFrozen && !View::isCameraMovementFinished gate.
   * Allows app camera runtime bridges to freeze simulation while scripted camera
   * movements are active.
   */
  isCameraTimeFrozen?: () => boolean;
  /**
   * Source parity: View::getTimeMultiplier. Camera script modifiers can adjust
   * simulation speed while cinematic movements run.
   */
  getCameraTimeMultiplier?: () => number;
  /**
   * Include unresolved objects as magenta placeholders.
   * If false, unresolved templates are skipped entirely.
   */
  renderUnknownObjects: boolean;
  /** Units default speed, in world units per second. */
  defaultMoveSpeed: number;
  /** Terrain snap speed while moving. */
  terrainSnapSpeed: number;
  /**
   * If true, attack-move LOS checks are active for movers with
   * ATTACK_NEEDS_LINE_OF_SIGHT.
   */
  attackUsesLineOfSight: boolean;
  /**
   * Fraction of the fallback build cost refunded when sellValue is not set.
   * Mirrors TheGlobalData::m_sellPercentage from source.
   */
  sellPercentage: number;
  /**
   * Source parity: GameInfo::m_superweaponRestriction — per-player limit
   * for objects with MaxSimultaneousOfType = DeterminedBySuperweaponRestriction.
   * 0 = no restriction (unlimited), typically 1 when enabled in game lobby.
   */
  superweaponRestriction: number;
  /**
   * Source parity: TheGlobalData::m_maxTunnelCapacity — per-player shared
   * tunnel network passenger limit. 0 = tunnels disabled.
   */
  maxTunnelCapacity: number;
  /**
   * Source parity: TheGlobalData::m_partitionCellSize used by PartitionManager
   * cell-space queries (for example getNearestGroupWithValue).
   */
  partitionCellSize: number;
  /**
   * Source parity: TheGlobalData::m_MultipleFactory — multiplier applied to
   * build time per additional factory of the same type.
   * C++ default is 0.0 (no bonus). Retail GameData.ini sets 0.85.
   * When <= 0, extra factories do not speed up production.
   */
  multipleFactory: number;
  /**
   * Source parity: TheGlobalData::m_MaxLowEnergyProductionSpeed — upper cap
   * on production rate when energy supply is below 100%.
   * C++ default is 0.0 (disabled). Retail GameData.ini sets ~0.5.
   * When <= 0 the cap is not applied.
   */
  maxLowEnergyProductionSpeed: number;
  /**
   * Source parity: VictoryConditions::update() exits early when
   * `!TheRecorder->isMultiplayer()` — campaign missions use script-based
   * victory/defeat exclusively.  When true, the default "all objects
   * destroyed = defeat" check in checkVictoryConditions is suppressed.
   */
  isCampaignMode: boolean;
}
