// @ts-nocheck — self is typed as any; real safety comes from the test suite.
/**
 * Render state bridge — syncModelConditionFlags, deriveRenderAnimationState, makeRenderableEntityState, and related render state methods.
 *
 * Source parity: Object/Drawable.cpp, Object/W3DModelDraw.cpp
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { CELL_CLEAR, CELL_FOGGED } from './fog-of-war.js';
import { SupplyTruckAIState } from './supply-chain.js';
import {
  calcBodyDamageState,
  CONSTRUCTION_COMPLETE,
  NAV_CLIFF,
  RELATIONSHIP_ALLIES,
  WEAPON_SET_FLAG_ELITE,
  WEAPON_SET_FLAG_HERO,
  WEAPON_SET_FLAG_PLAYER_UPGRADE,
  WEAPON_SET_FLAG_VETERAN,
} from './index.js';
type GL = any;

const VISUAL_STATUS_FLAGS = [
    'POISONED',
    'POISONED_BETA',
    'BURNING',
    'DISABLED_EMP',
    'DISABLED_UNDERPOWERED',
    'DISABLED_HELD',
  ] as const;

const EMPTY_STATUS_EFFECTS: readonly string[] = [];

export function deriveRenderAnimationState(self: GL, entity: MapEntity): RenderAnimationState {
    // Source parity note:
    // Generals/Code/GameEngine/Source/GameLogic/Thing/Drawable.cpp
    // drives render-state from object locomotor/combat lifecycle transitions.
    if (entity.slowDeathState || entity.structureCollapseState) {
      return 'DIE';
    }
    if (entity.destroyed) {
      return 'DIE';
    }

    if (entity.attackTargetEntityId !== null && self.canEntityAttackFromStatus(entity)) {
      return 'ATTACK';
    }

    // Source parity: ProneUpdate — prone overrides movement/idle state.
    if (entity.proneFramesRemaining > 0) {
      return 'PRONE';
    }

    if (entity.canMove && entity.moving) {
      return 'MOVE';
    }

    return 'IDLE';
}

export function updateRenderState(self: GL, entity: MapEntity): void {
    entity.animationState = self.deriveRenderAnimationState(entity);
    self.syncModelConditionFlags(entity);
}

export function syncModelConditionFlags(self: GL, entity: MapEntity): void {
    const flags = entity.modelConditionFlags;

    // ════════════════════════════════════════════════════════════════════════
    // DAMAGE STATE (body module)
    // ════════════════════════════════════════════════════════════════════════
    const bodyState = calcBodyDamageState(entity.health, entity.maxHealth);
    if (bodyState >= 1) { flags.add('DAMAGED'); } else { flags.delete('DAMAGED'); }
    if (bodyState >= 2) { flags.add('REALLYDAMAGED'); } else { flags.delete('REALLYDAMAGED'); }
    if (bodyState >= 3) { flags.add('RUBBLE'); } else { flags.delete('RUBBLE'); }

    // ── SPECIAL_DAMAGED — severe damage visual variant ──
    // Source parity: set when health drops below REALLY_DAMAGED threshold and
    // an object has special damage art. We gate on bodyState >= 2 (same as REALLYDAMAGED).
    if (bodyState >= 2) { flags.add('SPECIAL_DAMAGED'); } else { flags.delete('SPECIAL_DAMAGED'); }

    // ════════════════════════════════════════════════════════════════════════
    // MOVEMENT / POSITION
    // ════════════════════════════════════════════════════════════════════════

    // ── MOVING — normal locomotion ──
    // Skip if topple or tensile collapse is managing MOVING/FREEFALL/POST_COLLAPSE.
    const toppleActive = entity.toppleAngularAccumulation > 0.0001;
    const tensileActive = entity.tensileFormationState?.enabled === true;
    if (!toppleActive && !tensileActive) {
      if (entity.canMove && entity.moving && entity.currentSpeed > 0) {
        flags.add('MOVING');
      } else {
        flags.delete('MOVING');
      }
    }

    // ── TOPPLED — tree/pole has completed topple animation ──
    if (entity.toppleState === 'DONE' || entity.toppleState === 'BOUNCING') {
      flags.add('TOPPLED');
    } else {
      flags.delete('TOPPLED');
    }

    // ── PRONE — infantry lying flat when taking damage ──
    if (entity.proneFramesRemaining > 0) {
      flags.add('PRONE');
    } else {
      flags.delete('PRONE');
    }

    // ── CLIMBING — entity is on a cliff cell ──
    // Source parity: C++ AIStates.cpp:1646-1650 — set when moving entity is on CELL_CLIFF.
    if (entity.moving && self.navigationGrid) {
      const [cellX, cellZ] = self.worldToGrid(entity.x, entity.z);
      if (cellX !== null && cellZ !== null) {
        const cellIndex = cellZ * self.navigationGrid.width + cellX;
        if (self.navigationGrid.terrainType[cellIndex] === NAV_CLIFF) {
          flags.add('CLIMBING');
        } else {
          flags.delete('CLIMBING');
        }
      } else {
        flags.delete('CLIMBING');
      }
    } else {
      flags.delete('CLIMBING');
    }

    // ── OVER_WATER — entity is floating on water ──
    if (entity.floatUpdateProfile?.enabled) {
      flags.add('OVER_WATER');
    } else {
      flags.delete('OVER_WATER');
    }

    // ── PARACHUTING — entity is parachuting down ──
    if (entity.kindOf.has('PARACHUTE')) {
      flags.add('PARACHUTING');
    } else {
      flags.delete('PARACHUTING');
    }

    // ════════════════════════════════════════════════════════════════════════
    // COMBAT — weapon slot flags
    // ════════════════════════════════════════════════════════════════════════

    // ── ATTACKING — entity has an attack target (any slot) ──
    if (entity.attackTargetEntityId !== null) {
      flags.add('ATTACKING');
    } else {
      flags.delete('ATTACKING');
    }

    // Determine which weapon slot is active for FIRING/RELOADING/PREATTACK/BETWEEN/USING.
    const activeSlot = entity.forcedWeaponSlot ?? 0;
    const isFiring = entity.attackSubState === 'FIRING';
    const isReloading = entity.attackReloadFinishFrame > self.frameCounter;
    const isPreattack = entity.attackSubState === 'AIMING' && entity.preAttackFinishFrame > self.frameCounter;
    const isBetweenShots = entity.attackSubState === 'AIMING'
      && entity.attackTargetEntityId !== null
      && entity.preAttackFinishFrame <= self.frameCounter;
    const isUsingWeapon = entity.attackTargetEntityId !== null && entity.attackSubState !== 'IDLE';

    // ── FIRING_A / FIRING_B / FIRING_C ──
    if (isFiring && activeSlot === 0) { flags.add('FIRING_A'); } else { flags.delete('FIRING_A'); }
    if (isFiring && activeSlot === 1) { flags.add('FIRING_B'); } else { flags.delete('FIRING_B'); }
    if (isFiring && activeSlot === 2) { flags.add('FIRING_C'); } else { flags.delete('FIRING_C'); }

    // ── RELOADING_A / RELOADING_B / RELOADING_C ──
    if (isReloading && activeSlot === 0) { flags.add('RELOADING_A'); } else { flags.delete('RELOADING_A'); }
    if (isReloading && activeSlot === 1) { flags.add('RELOADING_B'); } else { flags.delete('RELOADING_B'); }
    if (isReloading && activeSlot === 2) { flags.add('RELOADING_C'); } else { flags.delete('RELOADING_C'); }

    // ── PREATTACK_A / PREATTACK_B / PREATTACK_C ──
    if (isPreattack && activeSlot === 0) { flags.add('PREATTACK_A'); } else { flags.delete('PREATTACK_A'); }
    if (isPreattack && activeSlot === 1) { flags.add('PREATTACK_B'); } else { flags.delete('PREATTACK_B'); }
    if (isPreattack && activeSlot === 2) { flags.add('PREATTACK_C'); } else { flags.delete('PREATTACK_C'); }

    // ── BETWEEN_FIRING_SHOTS_A / _B / _C ──
    if (isBetweenShots && activeSlot === 0) { flags.add('BETWEEN_FIRING_SHOTS_A'); } else { flags.delete('BETWEEN_FIRING_SHOTS_A'); }
    if (isBetweenShots && activeSlot === 1) { flags.add('BETWEEN_FIRING_SHOTS_B'); } else { flags.delete('BETWEEN_FIRING_SHOTS_B'); }
    if (isBetweenShots && activeSlot === 2) { flags.add('BETWEEN_FIRING_SHOTS_C'); } else { flags.delete('BETWEEN_FIRING_SHOTS_C'); }

    // ── USING_WEAPON_A / _B / _C ──
    if (isUsingWeapon && activeSlot === 0) { flags.add('USING_WEAPON_A'); } else { flags.delete('USING_WEAPON_A'); }
    if (isUsingWeapon && activeSlot === 1) { flags.add('USING_WEAPON_B'); } else { flags.delete('USING_WEAPON_B'); }
    if (isUsingWeapon && activeSlot === 2) { flags.add('USING_WEAPON_C'); } else { flags.delete('USING_WEAPON_C'); }

    // ── TURRET_ROTATE — turret is rotating toward a target ──
    let turretRotating = false;
    for (const ts of entity.turretStates) {
      if (ts.state === 'AIM') { turretRotating = true; break; }
    }
    if (turretRotating) { flags.add('TURRET_ROTATE'); } else { flags.delete('TURRET_ROTATE'); }

    // ── CONTINUOUS_FIRE_SLOW / CONTINUOUS_FIRE_MEAN / CONTINUOUS_FIRE_FAST ──
    if (entity.objectStatusFlags.has('CONTINUOUS_FIRE_SLOW')) {
      flags.add('CONTINUOUS_FIRE_SLOW');
    } else {
      flags.delete('CONTINUOUS_FIRE_SLOW');
    }
    if (entity.continuousFireState === 'MEAN' || entity.continuousFireState === 'FAST') {
      flags.add('CONTINUOUS_FIRE_MEAN');
    } else {
      flags.delete('CONTINUOUS_FIRE_MEAN');
    }
    if (entity.continuousFireState === 'FAST') {
      flags.add('CONTINUOUS_FIRE_FAST');
    } else {
      flags.delete('CONTINUOUS_FIRE_FAST');
    }

    // ── ENEMYNEAR — an enemy unit is within detection radius ──
    if (entity.enemyNearDetected) {
      flags.add('ENEMYNEAR');
    } else {
      flags.delete('ENEMYNEAR');
    }

    // ════════════════════════════════════════════════════════════════════════
    // CONSTRUCTION
    // ════════════════════════════════════════════════════════════════════════

    // ── ACTIVELY_BEING_CONSTRUCTED / PARTIALLY_CONSTRUCTED ──
    if (entity.constructionPercent >= 0 && entity.constructionPercent < 100) {
      flags.add('ACTIVELY_BEING_CONSTRUCTED');
      flags.add('PARTIALLY_CONSTRUCTED');
    } else {
      flags.delete('ACTIVELY_BEING_CONSTRUCTED');
      flags.delete('PARTIALLY_CONSTRUCTED');
    }

    // ── AWAITING_CONSTRUCTION — queued/placed but builder hasn't started ──
    if (entity.constructionPercent === 0 && entity.builderId === 0) {
      flags.add('AWAITING_CONSTRUCTION');
    } else {
      flags.delete('AWAITING_CONSTRUCTION');
    }

    // ── CONSTRUCTION_COMPLETE — build is fully done ──
    if (entity.constructionPercent === CONSTRUCTION_COMPLETE) {
      flags.add('CONSTRUCTION_COMPLETE');
    } else {
      flags.delete('CONSTRUCTION_COMPLETE');
    }

    // ── ACTIVELY_CONSTRUCTING — this entity (dozer/worker) is building something ──
    let isActivelyConstructing = false;
    if (entity.dozerAIProfile) {
      for (const other of self.spawnedEntities.values()) {
        if (other.builderId === entity.id && other.constructionPercent >= 0 && other.constructionPercent < 100) {
          isActivelyConstructing = true;
          break;
        }
      }
    }
    if (isActivelyConstructing) {
      flags.add('ACTIVELY_CONSTRUCTING');
    } else {
      flags.delete('ACTIVELY_CONSTRUCTING');
    }

    // ════════════════════════════════════════════════════════════════════════
    // CONTAIN / TRANSPORT STATE
    // ════════════════════════════════════════════════════════════════════════

    // ── GARRISONED — entity is inside a garrison building ──
    if (entity.garrisonContainerId !== null) {
      flags.add('GARRISONED');
    } else {
      flags.delete('GARRISONED');
    }

    // ── CARRYING — supply trucks with cargo ──
    if (entity.supplyTruckProfile) {
      const truckState = self.supplyTruckStates.get(entity.id);
      if (truckState && truckState.currentBoxes > 0) {
        flags.add('CARRYING');
      } else {
        flags.delete('CARRYING');
      }
    }

    // ── LOADED — transport/container has passengers inside ──
    if (entity.containProfile) {
      const occupantCount = self.collectContainedEntityIds(entity.id).length;
      if (occupantCount > 0) {
        flags.add('LOADED');
      } else {
        flags.delete('LOADED');
      }
    } else {
      flags.delete('LOADED');
    }

    // ════════════════════════════════════════════════════════════════════════
    // DOCKING — supply truck dock animation phases
    // ════════════════════════════════════════════════════════════════════════
    if (entity.supplyTruckProfile) {
      const truckState = self.supplyTruckStates.get(entity.id);
      const aiState = truckState?.aiState ?? SupplyTruckAIState.IDLE;
      const isDockingOverall = aiState === SupplyTruckAIState.APPROACHING_WAREHOUSE
        || aiState === SupplyTruckAIState.GATHERING
        || aiState === SupplyTruckAIState.APPROACHING_DEPOT
        || aiState === SupplyTruckAIState.DEPOSITING;
      const isDockBeginning = aiState === SupplyTruckAIState.APPROACHING_WAREHOUSE
        || aiState === SupplyTruckAIState.APPROACHING_DEPOT;
      const isDockActive = aiState === SupplyTruckAIState.GATHERING
        || aiState === SupplyTruckAIState.DEPOSITING;

      if (isDockingOverall) { flags.add('DOCKING'); } else { flags.delete('DOCKING'); }
      if (isDockBeginning) { flags.add('DOCKING_BEGINNING'); } else { flags.delete('DOCKING_BEGINNING'); }
      if (isDockActive) { flags.add('DOCKING_ACTIVE'); } else { flags.delete('DOCKING_ACTIVE'); }
      // DOCKING_ENDING: approximate as not-docking (C++ tracks a separate exit phase).
      flags.delete('DOCKING_ENDING');
    }

    // ════════════════════════════════════════════════════════════════════════
    // SELL / DEATH
    // ════════════════════════════════════════════════════════════════════════

    // ── SOLD — entity is in sell animation ──
    if (self.sellingEntities.has(entity.id)) {
      flags.add('SOLD');
    } else {
      flags.delete('SOLD');
    }

    // ── DYING — during slow death / structure collapse ──
    if (entity.slowDeathState || entity.structureCollapseState) {
      flags.add('DYING');
    } else {
      flags.delete('DYING');
    }

    // ════════════════════════════════════════════════════════════════════════
    // DEPLOY / PACK / UNPACK
    // ════════════════════════════════════════════════════════════════════════
    if (entity.deployStyleProfile) {
      if (entity.deployState === 'READY_TO_ATTACK') {
        flags.add('DEPLOYED');
      } else {
        flags.delete('DEPLOYED');
      }
      if (entity.deployState === 'DEPLOY') {
        flags.add('UNPACKING');
      } else {
        flags.delete('UNPACKING');
      }
      if (entity.deployState === 'UNDEPLOY') {
        flags.add('PACKING');
      } else {
        flags.delete('PACKING');
      }
    }

    // ════════════════════════════════════════════════════════════════════════
    // RAPPELLING
    // ════════════════════════════════════════════════════════════════════════
    if (entity.chinookFlightStatus === 'DOING_COMBAT_DROP') {
      flags.add('RAPPELLING');
    } else {
      flags.delete('RAPPELLING');
    }

    // ════════════════════════════════════════════════════════════════════════
    // VETERANCY — weapon set condition model flags
    // ════════════════════════════════════════════════════════════════════════
    if (entity.weaponSetFlagsMask & WEAPON_SET_FLAG_VETERAN) {
      flags.add('WEAPONSET_VETERAN');
    } else {
      flags.delete('WEAPONSET_VETERAN');
    }
    if (entity.weaponSetFlagsMask & WEAPON_SET_FLAG_ELITE) {
      flags.add('WEAPONSET_ELITE');
    } else {
      flags.delete('WEAPONSET_ELITE');
    }
    if (entity.weaponSetFlagsMask & WEAPON_SET_FLAG_HERO) {
      flags.add('WEAPONSET_HERO');
    } else {
      flags.delete('WEAPONSET_HERO');
    }
    if (entity.weaponSetFlagsMask & WEAPON_SET_FLAG_PLAYER_UPGRADE) {
      flags.add('WEAPONSET_PLAYER_UPGRADE');
    } else {
      flags.delete('WEAPONSET_PLAYER_UPGRADE');
    }

    // ════════════════════════════════════════════════════════════════════════
    // FIRE / FLAME STATE
    // ════════════════════════════════════════════════════════════════════════

    // ── AFLAME — entity is on fire ──
    if (entity.flameStatus === 'AFLAME') {
      flags.add('AFLAME');
    } else {
      flags.delete('AFLAME');
    }

    // ── BURNED — entity finished burning, charred husk ──
    if (entity.flameStatus === 'BURNED') {
      flags.add('BURNED');
    } else {
      flags.delete('BURNED');
    }

    // ── SMOLDERING — transitional/charred state ──
    if (entity.flameStatus === 'BURNED') {
      flags.add('SMOLDERING');
    } else {
      flags.delete('SMOLDERING');
    }

    // ════════════════════════════════════════════════════════════════════════
    // JET AIRCRAFT STATE
    // ════════════════════════════════════════════════════════════════════════
    if (entity.jetAIState) {
      const js = entity.jetAIState.state;
      const isAirborne = js === 'AIRBORNE' || js === 'TAKING_OFF'
        || js === 'RETURNING_FOR_LANDING' || js === 'CIRCLING_DEAD_AIRFIELD';
      if (isAirborne) {
        flags.add('JETEXHAUST');
      } else {
        flags.delete('JETEXHAUST');
      }
      // ── JETAFTERBURNER — extra thrust during takeoff ──
      if (js === 'TAKING_OFF') {
        flags.add('JETAFTERBURNER');
      } else {
        flags.delete('JETAFTERBURNER');
      }
    } else {
      flags.delete('JETEXHAUST');
      flags.delete('JETAFTERBURNER');
    }

    // ════════════════════════════════════════════════════════════════════════
    // RADAR STATE
    // ════════════════════════════════════════════════════════════════════════
    if (entity.radarUpdateProfile && !entity.radarExtendComplete) {
      flags.add('RADAR_EXTENDING');
    } else {
      flags.delete('RADAR_EXTENDING');
    }
    if (entity.radarExtendComplete && entity.radarActive) {
      flags.add('RADAR_UPGRADED');
    } else {
      flags.delete('RADAR_UPGRADED');
    }

    // ════════════════════════════════════════════════════════════════════════
    // MINE / BOMB STATE
    // ════════════════════════════════════════════════════════════════════════
    if (entity.demoTrapProfile && !entity.demoTrapDetonated) {
      flags.add('ARMED');
    } else if (entity.minefieldProfile && entity.mineVirtualMinesRemaining > 0) {
      flags.add('ARMED');
    } else {
      flags.delete('ARMED');
    }

    // ════════════════════════════════════════════════════════════════════════
    // CAPTURE STATE
    // ════════════════════════════════════════════════════════════════════════
    if (entity.capturedFromOriginalOwner) {
      flags.add('CAPTURED');
    } else {
      flags.delete('CAPTURED');
    }

    // ════════════════════════════════════════════════════════════════════════
    // SPECIAL_CHEERING — active while cheer timer is positive.
    // ════════════════════════════════════════════════════════════════════════
    if (entity.cheerTimerFrames > 0) {
      entity.cheerTimerFrames--;
      flags.add('SPECIAL_CHEERING');
    } else {
      flags.delete('SPECIAL_CHEERING');
    }

    // RAISING_FLAG — active while flag-raising timer is positive.
    if (entity.raisingFlagTimerFrames > 0) {
      entity.raisingFlagTimerFrames--;
      flags.add('RAISING_FLAG');
    } else {
      flags.delete('RAISING_FLAG');
    }

    // EXPLODED_FLAILING / EXPLODED_BOUNCING / SPLATTED — ragdoll state machine.
    flags.delete('EXPLODED_FLAILING');
    flags.delete('EXPLODED_BOUNCING');
    flags.delete('SPLATTED');
    switch (entity.explodedState) {
      case 'FLAILING': flags.add('EXPLODED_FLAILING'); break;
      case 'BOUNCING': flags.add('EXPLODED_BOUNCING'); break;
      case 'SPLATTED': flags.add('SPLATTED'); break;
    }

    // ── FLOODED — entity below water level ──
    // C++ sets this via WaveGuideUpdate (dynamic flood waves). We approximate with static
    // water polygon lookup since WaveGuideUpdate is not yet ported.
    {
      const waterHeight = self.getWaterHeightAt(entity.x, entity.z);
      if (waterHeight !== null && entity.y < waterHeight) {
        flags.add('FLOODED');
      } else {
        flags.delete('FLOODED');
      }
    }
    // CLIMBING — wired above (Y-over-Y frame comparison).
    // SURRENDER — gated behind ALLOW_SURRENDER #ifdef, not in retail.
    // PREORDER — promotional flag, not gameplay relevant.
    //
    // Flags managed elsewhere (NOT touched here):
    // POST_COLLAPSE, FREEFALL — tensile/topple system
    // PANICKING — updatePanicSystems()
    // NIGHT / SNOW — day/night cycle
    // DOOR_1-4_* — door state machine
    // FRONTCRUSHED / BACKCRUSHED — crush die
    // POWER_PLANT_UPGRADING / POWER_PLANT_UPGRADED — power plant upgrade system
    // ARMORSET_CRATEUPGRADE_ONE / TWO — crate system
    // CENTER_TO_* / LEFT_TO_* / RIGHT_TO_* — steering animation
    // SECOND_LIFE — undead body
}

export function updateRenderStates(self: GL): void {
    for (const entity of self.spawnedEntities.values()) {
      self.updateRenderState(entity);
    }
}

export function resolveEntityStatusEffects(self: GL, entity: MapEntity): readonly string[] {
    let effects: string[] | null = null;
    for (const flag of VISUAL_STATUS_FLAGS) {
      if (entity.objectStatusFlags.has(flag)) {
        (effects ??= []).push(flag);
      }
    }
    if (entity.poisonDamageAmount > 0) {
      if (!effects || !effects.includes('POISONED')) {
        (effects ??= []).push('POISONED');
      }
    }
    return effects ?? EMPTY_STATUS_EFFECTS;
}

export function resolveEntityAmbientSoundEventName(self: GL, entity: MapEntity): string | null {
    const bodyDamageState = calcBodyDamageState(entity.health, entity.maxHealth);
    if (bodyDamageState !== 3) {
      if (entity.ambientSoundForcedOffExceptRubble) {
        return null;
      }
      if (entity.ambientSoundCustomState) {
        return entity.ambientSoundCustomState.audioName;
      }
    }

    const profile = entity.ambientSoundProfile;
    if (!profile) {
      return null;
    }
    switch (bodyDamageState) {
      case 1:
        return profile.damaged ?? profile.pristine;
      case 2:
        return profile.reallyDamaged ?? profile.pristine;
      case 3:
        return profile.rubble;
      default:
        return profile.pristine;
    }
}

export function resolveEntityAmbientSoundState(self: GL, entity: MapEntity): {
    audioName: string | null;
    customAudioDefinition: ScriptObjectAmbientCustomAudioDefinition | null;
  } {
    const audioName = self.resolveEntityAmbientSoundEventName(entity);
    if (!audioName) {
      return {
        audioName: null,
        customAudioDefinition: null,
      };
    }
    if (entity.ambientSoundCustomState && entity.ambientSoundCustomState.audioName === audioName) {
      return {
        audioName,
        customAudioDefinition: { ...entity.ambientSoundCustomState.definition },
      };
    }
    return {
      audioName,
      customAudioDefinition: null,
    };
}

export function makeRenderableEntityState(self: GL, entity: MapEntity, localSide?: string | null): RenderableEntityState {
    return {
      id: entity.id,
      templateName: entity.templateName,
      resolved: entity.resolved,
      renderAssetCandidates: entity.renderAssetCandidates,
      renderAssetPath: entity.renderAssetPath,
      renderAssetResolved: entity.renderAssetResolved,
      renderAnimationStateClips: entity.renderAnimationStateClips,
      modelConditionInfos: entity.modelConditionInfos,
      transitionInfos: entity.transitionInfos,
      modelConditionFlags: [...entity.modelConditionFlags],
      currentSpeed: entity.currentSpeed,
      maxSpeed: entity.speed,
      category: entity.category,
      x: entity.x,
      y: entity.y,
      z: entity.z,
      rotationY: entity.rotationY,
      animationState: entity.animationState,
      health: entity.health,
      maxHealth: entity.maxHealth,
      isSelected: entity.selected,
      side: entity.side,
      veterancyLevel: entity.experienceState.currentLevel,
      isStealthed: entity.objectStatusFlags.has('STEALTHED'),
      isDetected: entity.objectStatusFlags.has('DETECTED'),
      scriptFlashCount: entity.scriptFlashCount,
      scriptFlashColor: entity.scriptFlashColor,
      ambientSoundEventName: self.resolveEntityAmbientSoundEventName(entity),
      scriptAmbientSoundEnabled: entity.scriptAmbientSoundEnabled,
      scriptAmbientSoundRevision: entity.scriptAmbientSoundRevision,
      shroudStatus: self.resolveEntityShroudStatusForLocalPlayer(entity),
      constructionPercent: entity.constructionPercent,
      toppleAngle: entity.toppleAngularAccumulation,
      toppleDirX: entity.toppleDirX,
      toppleDirZ: entity.toppleDirZ,
      /** Turret rotation angles (one per turret module), in radians relative to body. */
      turretAngles: entity.turretStates.map(ts => ts.currentAngle),
      statusEffects: self.resolveEntityStatusEffects(entity),
      selectionCircleRadius: entity.geometryMajorRadius > 0 ? entity.geometryMajorRadius : undefined,
      isOwnedByLocalPlayer: entity.side ? self.normalizeSide(entity.side) === (localSide ?? self.resolveLocalPlayerSide()) : undefined,
      streamPoints: entity.projectileStreamState
        ? self.getStreamPoints(entity.id)
        : undefined,
      radiusDecals: entity.radiusDecalStates.length > 0
        ? entity.radiusDecalStates.map(d => ({
            positionX: d.positionX,
            positionY: d.positionY,
            positionZ: d.positionZ,
            radius: d.radius,
            visible: d.visible,
          }))
        : undefined,
      boneFXEvents: entity.boneFXState?.pendingVisualEvents.length
        ? entity.boneFXState.pendingVisualEvents.slice()
        : undefined,
    };
}

export function resolveEntityShroudStatusForLocalPlayer(self: GL, entity: MapEntity): 'CLEAR' | 'FOGGED' | 'SHROUDED' {
    const localSide = self.playerSideByIndex.get(self.localPlayerIndex);
    return self.resolveEntityShroudStatusForSide(entity, localSide ?? null);
}

export function resolveEntityShroudStatusForSide(self: GL, 
    entity: MapEntity,
    viewerSide: string | null | undefined,
  ): 'CLEAR' | 'FOGGED' | 'SHROUDED' {
    const normalizedViewerSide = self.normalizeSide(viewerSide ?? '');
    if (!normalizedViewerSide) return 'CLEAR';
    // Source parity: KINDOF_ALWAYS_VISIBLE bypasses all shroud (Object.cpp line 1804).
    if (entity.kindOf.has('ALWAYS_VISIBLE')) return 'CLEAR';
    // Own entities always visible.
    const entitySide = self.normalizeSide(entity.side);
    if (entitySide && entitySide === normalizedViewerSide) return 'CLEAR';
    // Allied entities always visible (source parity: allied shroud is shared).
    if (entitySide && self.getTeamRelationshipBySides(normalizedViewerSide, entitySide) === RELATIONSHIP_ALLIES) {
      return 'CLEAR';
    }
    const vis = self.getCellVisibility(normalizedViewerSide, entity.x, entity.z);
    if (vis === CELL_CLEAR) return 'CLEAR';
    if (vis === CELL_FOGGED) {
      // Source parity: PartitionManager.cpp lines 1659-1676 — mobile enemies and
      // mines vanish in fog. Only immobile structures previously seen show as ghosts.
      const isImmobile = entity.kindOf.has('IMMOBILE');
      if (!isImmobile || entity.kindOf.has('MINE')) {
        return 'SHROUDED';
      }
      return 'FOGGED';
    }
    return 'SHROUDED';
}
