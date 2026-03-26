// @ts-nocheck — self is typed as any; real safety comes from the test suite.
/**
 * Entity movement — locomotors, collision, crushing, animation steering, physics.
 *
 * Source parity: Object/Locomotor.cpp, PhysicsBehavior.cpp, FloatUpdateModule.cpp
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { MAP_XY_FACTOR } from '@generals/terrain';
import { readBooleanField, readNumericField, readStringField, toByte } from './ini-readers.js';
import { findObjectDefByName } from './registry-lookups.js';
import {
  LOGIC_FRAME_RATE,
  NO_ATTACK_DISTANCE,
  PATHFIND_CELL_SIZE,
  LOCOMOTORSET_NORMAL,
  SOURCE_LOCOMOTOR_SET_NAMES,
  TEST_CRUSH_OR_SQUISH,
  ATTACK_MOVE_DISTANCE_FUDGE,
  MINE_DETONATED_BY_ALLIES,
  MINE_DETONATED_BY_ENEMIES,
  LOCOMOTORSET_NORMAL_UPGRADED,
  LOCOMOTORSET_FREEFALL,
  RELATIONSHIP_ALLIES,
  RELATIONSHIP_ENEMIES,
  LOCOMOTORSET_TAXIING,
  TEST_SQUISH_ONLY,
  TEST_CRUSH_ONLY,
  HUGE_DAMAGE_AMOUNT,
  MINE_MAX_IMMUNITY,
} from './index.js';
type GL = any;

// ---- Entity movement implementations ----

export function setEntityLocomotorSet(self: GL, entityId: number, setName: string): boolean {
  const entity = self.spawnedEntities.get(entityId);
  if (!entity) {
    return false;
  }
  const normalizedSet = setName.trim().toUpperCase();
  if (!SOURCE_LOCOMOTOR_SET_NAMES.has(normalizedSet)) {
    return false;
  }
  if (normalizedSet === LOCOMOTORSET_NORMAL_UPGRADED) {
    return false;
  }
  let resolvedSet = normalizedSet;
  if (entity.chinookAIProfile && entity.chinookFlightStatus === 'LANDED') {
    resolvedSet = LOCOMOTORSET_TAXIING;
  }
  if (
    normalizedSet === LOCOMOTORSET_NORMAL
    && entity.locomotorUpgradeEnabled
    && entity.locomotorSets.has(LOCOMOTORSET_NORMAL_UPGRADED)
  ) {
    resolvedSet = LOCOMOTORSET_NORMAL_UPGRADED;
  }
  const profile = entity.locomotorSets.get(resolvedSet);
  if (!profile) {
    return false;
  }
  entity.activeLocomotorSet = resolvedSet;
  entity.locomotorSurfaceMask = profile.surfaceMask;
  entity.locomotorDownhillOnly = profile.downhillOnly;
  entity.speed = profile.movementSpeed > 0 ? profile.movementSpeed : self.config.defaultMoveSpeed;
  return true;
}

export function setEntityLocomotorUpgrade(self: GL, entityId: number, enabled: boolean): boolean {
  const entity = self.spawnedEntities.get(entityId);
  if (!entity) {
    return false;
  }
  entity.locomotorUpgradeEnabled = enabled;
  if (
    entity.activeLocomotorSet === LOCOMOTORSET_NORMAL
    || entity.activeLocomotorSet === LOCOMOTORSET_NORMAL_UPGRADED
  ) {
    setEntityLocomotorSet(self, entityId, LOCOMOTORSET_NORMAL);
  }
  return true;
}

export function resolveAttackMoveDistance(self: GL, entity: MapEntity | undefined): number {
  if (!entity || entity.largestWeaponRange === NO_ATTACK_DISTANCE) {
    return NO_ATTACK_DISTANCE;
  }

  return entity.largestWeaponRange + ATTACK_MOVE_DISTANCE_FUDGE;
}

export function hasLocomotorSetDefinition(self: GL, objectDef: ObjectDef): boolean {
  for (const block of objectDef.blocks) {
    const type = block.type.toUpperCase();
    if (type === 'LOCOMOTOR' || type === 'LOCOMOTORSET') {
      return true;
    }
  }

  return false;
}

export function resolveCombatCollisionProfile(self: GL, objectDef: ObjectDef | undefined): {
  crusherLevel: number;
  crushableLevel: number;
  canBeSquished: boolean;
  isUnmanned: boolean;
} {
  if (!objectDef) {
    return {
      crusherLevel: 0,
      crushableLevel: 255, // Source parity: ThingTemplate constructor sets m_crushableLevel = 255 (immune)
      canBeSquished: false,
      isUnmanned: false,
    };
  }

  return {
    crusherLevel: toByte(readNumericField(objectDef.fields, ['CrusherLevel', 'Crusherlevel'])),
    crushableLevel: toByte(readNumericField(objectDef.fields, ['CrushableLevel', 'Crushablelevel']) ?? 255),
    canBeSquished: self.hasSquishCollideModule(objectDef),
    isUnmanned: readBooleanField(objectDef.fields, ['Unmanned', 'IsUnmanned']) === true,
  };
}

export function canCrushOrSquish(self: GL, 
  mover: MapEntity,
  target: MapEntity,
  testType: number = TEST_CRUSH_OR_SQUISH,
): boolean {
  if (!mover || !target) {
    return false;
  }
  if (mover.isUnmanned) {
    return false;
  }

  if (self.getTeamRelationship(mover, target) === RELATIONSHIP_ALLIES) {
    return false;
  }

  if (mover.crusherLevel <= 0) {
    return false;
  }

  if (testType === TEST_SQUISH_ONLY || testType === TEST_CRUSH_OR_SQUISH) {
    if (target.canBeSquished) {
      return true;
    }
  }

  if (testType === TEST_CRUSH_ONLY || testType === TEST_CRUSH_OR_SQUISH) {
    return mover.crusherLevel > target.crushableLevel;
  }

  return false;
}

export function resolveLocomotorProfiles(self: GL, 
  objectDef: ObjectDef | undefined,
  iniDataRegistry: IniDataRegistry,
): Map<string, LocomotorSetProfile> {
  const profiles = new Map<string, LocomotorSetProfile>();
  if (!objectDef) {
    return profiles;
  }

  const locomotorSets = extractLocomotorSetEntries(self, objectDef);
  for (const [setName, locomotorNames] of locomotorSets) {
    let surfaceMask = 0;
    let downhillOnly = false;
    let movementSpeed = 0;
    // Source parity: physics fields come from the primary (fastest) locomotor in the set.
    let acceleration = 0;
    let braking = 0;
    let turnRate = 0;
    let minSpeed = 0;
    let appearance = 'OTHER';
    let wanderAboutPointRadius = 0;
    let preferredHeight = 0;
    let preferredHeightDamping = 1;
    let primaryLocomotor: LocomotorDef | null = null;
    for (const locomotorName of locomotorNames) {
      const locomotor = iniDataRegistry.getLocomotor(locomotorName);
      if (!locomotor) {
        continue;
      }
      surfaceMask |= locomotor.surfaceMask;
      downhillOnly = downhillOnly || locomotor.downhillOnly;
      if ((locomotor.speed ?? 0) > movementSpeed) {
        movementSpeed = locomotor.speed ?? 0;
        primaryLocomotor = locomotor;
      }
    }
    if (primaryLocomotor) {
      const f = primaryLocomotor.fields;
      acceleration = readNumericField(f, ['Acceleration']) ?? 0;
      braking = readNumericField(f, ['Braking']) ?? 0;
      turnRate = readNumericField(f, ['TurnRate']) ?? 0;
      minSpeed = readNumericField(f, ['MinSpeed']) ?? 0;
      wanderAboutPointRadius = readNumericField(f, ['WanderAboutPointRadius']) ?? 0;
      preferredHeight = readNumericField(f, ['PreferredHeight']) ?? 0;
      preferredHeightDamping = readNumericField(f, ['PreferredHeightDamping']) ?? 1;
      // Source parity: TurnRate in INI is degrees/sec, convert to radians/sec.
      turnRate = turnRate * (Math.PI / 180);
      const appearanceToken = readStringField(f, ['Appearance'])?.toUpperCase().trim();
      if (appearanceToken) {
        appearance = appearanceToken;
      }
    }
    profiles.set(setName, {
      surfaceMask,
      downhillOnly,
      movementSpeed,
      minSpeed,
      acceleration,
      braking,
      turnRate,
      appearance,
      wanderAboutPointRadius,
      preferredHeight,
      preferredHeightDamping,
    });
  }

  return profiles;
}

export function extractLocomotorSetEntries(self: GL, objectDef: ObjectDef): Map<string, string[]> {
  const sets = new Map<string, string[]>();

  const addEntry = (setName: string, locomotors: string[]): void => {
    const normalizedSet = setName.trim().toUpperCase();
    if (!normalizedSet) {
      return;
    }
    sets.set(normalizedSet, locomotors);
  };

  const parseTokens = (tokens: string[]): { setName: string; locomotors: string[] } | null => {
    if (tokens.length < 1) {
      return null;
    }
    const setName = tokens[0]!.trim();
    const locomotors = tokens
      .slice(1)
      .map((token) => token.trim())
      .filter((token) => token.length > 0 && token.toUpperCase() !== 'NONE');
    return { setName, locomotors };
  };

  const parseIniScalarTokens = (value: IniValue): string[] => {
    if (typeof value === 'string') {
      return value.split(/[\s,;|]+/).filter(Boolean);
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return [String(value)];
    }
    return [];
  };

  const parseLocomotorEntries = (value: IniValue | undefined): Array<{ setName: string; locomotors: string[] }> => {
    if (value === undefined) {
      return [];
    }
    if (Array.isArray(value)) {
      // INI bundle stores Locomotor as a flat string array: ["SET_NORMAL", "LocomotorName", ...]
      // If all elements are strings, treat them as tokens of a single entry.
      const allStrings = value.every((v) => typeof v === 'string');
      if (allStrings) {
        const parsed = parseTokens(value as string[]);
        return parsed ? [parsed] : [];
      }
      // Nested arrays: each sub-element is a separate entry.
      return value.flatMap((entry) => parseLocomotorEntries(entry as IniValue));
    }
    const parsed = parseTokens(parseIniScalarTokens(value));
    return parsed ? [parsed] : [];
  };

  const isLocomotorSetField = (fieldName: string): boolean => {
    const normalized = fieldName.toUpperCase();
    return normalized === 'LOCOMOTOR' || normalized === 'LOCOMOTORSET';
  };

  const visitBlock = (block: IniBlock): void => {
    const blockType = block.type.toUpperCase();
    if (blockType === 'LOCOMOTORSET' || blockType === 'LOCOMOTOR') {
      const tokens = block.name.split(/\s+/).filter(Boolean);
      const parsed = parseTokens(tokens);
      if (parsed) {
        addEntry(parsed.setName, parsed.locomotors);
      }
    }

    for (const [fieldName, fieldValue] of Object.entries(block.fields)) {
      if (!isLocomotorSetField(fieldName)) {
        continue;
      }
      const parsedEntries = parseLocomotorEntries(fieldValue);
      for (const parsed of parsedEntries) {
        addEntry(parsed.setName, parsed.locomotors);
      }
    }

    for (const child of block.blocks) {
      visitBlock(child);
    }
  };

  for (const [fieldName, fieldValue] of Object.entries(objectDef.fields)) {
    if (!isLocomotorSetField(fieldName)) {
      continue;
    }
    const parsedEntries = parseLocomotorEntries(fieldValue);
    for (const parsed of parsedEntries) {
      addEntry(parsed.setName, parsed.locomotors);
    }
  }

  for (const block of objectDef.blocks) {
    visitBlock(block);
  }

  return sets;
}

export function updateMineCollisions(self: GL): void {
  for (const mine of self.spawnedEntities.values()) {
    if (!mine.minefieldProfile || mine.destroyed) continue;
    if (mine.mineVirtualMinesRemaining <= 0) continue;
    if (mine.mineScootFramesLeft > 0) continue;

    const mineGeom = mine.obstacleGeometry;
    if (!mineGeom) continue;

    // Check all entities for geometry overlap with this mine.
    for (const other of self.spawnedEntities.values()) {
      if (other.id === mine.id || other.destroyed) continue;
      if (other.kindOf.has('NO_COLLIDE')) continue;
      if (other.noCollisions) continue;
      // Mines are immobile — only check mobile entities colliding into us.
      if (!other.moving && other.isImmobile) continue;

      // Quick 2D bounding circle rejection.
      const otherRadius = other.obstacleGeometry ? Math.max(other.obstacleGeometry.majorRadius, other.obstacleGeometry.minorRadius) : 0;
      const mineRadius = Math.max(mineGeom.majorRadius, mineGeom.minorRadius);
      const dx = other.x - mine.x;
      const dz = other.z - mine.z;
      const combinedRadius = mineRadius + otherRadius;
      if (dx * dx + dz * dz > combinedRadius * combinedRadius) continue;

      // Geometry overlap confirmed — dispatch collision.
      handleMineCollision(self, mine, other);

      // Mine may have been destroyed by detonation.
      if (mine.destroyed || mine.mineVirtualMinesRemaining <= 0) break;
    }
  }
}

export function handleMineCollision(self: GL, mine: MapEntity, other: MapEntity): void {
  const prof = mine.minefieldProfile!;
  if (mine.mineVirtualMinesRemaining <= 0) return;

  // Check immunity list (must always update collideTime first).
  for (const immune of mine.mineImmunes) {
    if (immune.entityId === other.id) {
      immune.collideFrame = self.frameCounter;
      return;
    }
  }

  // Workers (infantry+dozer) don't detonate by default.
  if (!prof.workersDetonate) {
    if (other.kindOf.has('INFANTRY') && other.kindOf.has('DOZER')) {
      return;
    }
  }

  // Relationship check: does this entity detonate us?
  const relationship = self.getEntityRelationship(mine.id, other.id);
  let requiredBit = 0;
  if (relationship === 'allies') requiredBit = MINE_DETONATED_BY_ALLIES;
  else if (relationship === 'enemies') requiredBit = MINE_DETONATED_BY_ENEMIES;
  else requiredBit = MINE_DETONATED_BY_NEUTRAL;
  if ((prof.detonatedByMask & requiredBit) === 0) return;

  // Mine-clearing immunity: units attacking with WEAPON_ANTI_MINE get immunity.
  if (self.isEntityClearingMines(other)) {
    // Grant immunity in a free slot.
    let granted = false;
    for (const immune of mine.mineImmunes) {
      if (immune.entityId === other.id) {
        immune.collideFrame = self.frameCounter;
        granted = true;
        break;
      }
    }
    if (!granted && mine.mineImmunes.length < MINE_MAX_IMMUNITY) {
      mine.mineImmunes.push({ entityId: other.id, collideFrame: self.frameCounter });
    } else if (!granted) {
      // Replace oldest slot.
      for (const immune of mine.mineImmunes) {
        if (immune.entityId === 0) {
          immune.entityId = other.id;
          immune.collideFrame = self.frameCounter;
          granted = true;
          break;
        }
      }
    }
    return;
  }

  // Repeat detonation threshold: same object must move before re-triggering.
  const threshSq = prof.repeatDetonateMoveThresh * prof.repeatDetonateMoveThresh;
  let found = false;
  for (const det of mine.mineDetonators) {
    if (det.entityId === other.id) {
      found = true;
      const distSq = (other.x - det.x) * (other.x - det.x) + (other.z - det.z) * (other.z - det.z);
      if (distSq <= threshSq) {
        return; // Too close to last detonation point.
      }
      // Far enough — update position and detonate.
      det.x = other.x;
      det.z = other.z;
      break;
    }
  }
  if (!found) {
    mine.mineDetonators.push({ entityId: other.id, x: other.x, z: other.z });
  }

  // Clip detonation point to mine footprint (simplified: use mine center for circular).
  self.detonateMineOnce(mine, other.x, other.z);
}

export function updateCrateCollisions(self: GL): void {
  for (const crate of self.spawnedEntities.values()) {
    if (crate.destroyed) continue;
    const isSalvage = !!crate.salvageCrateProfile;
    const isGeneral = !!crate.crateCollideProfile;
    if (!isSalvage && !isGeneral) continue;

    const crateGeom = crate.obstacleGeometry;
    const crateRadius = crateGeom
      ? Math.max(crateGeom.majorRadius, crateGeom.minorRadius)
      : 1.0;

    for (const other of self.spawnedEntities.values()) {
      if (other.id === crate.id || other.destroyed) continue;

      // Source parity: SalvageCrateCollide requires SALVAGER KindOf.
      if (isSalvage && !other.kindOf.has('SALVAGER')) continue;

      // Source parity: CrateCollide::isValidToExecute — general crate eligibility.
      if (isGeneral && !self.isCrateCollideEligible(crate, other)) continue;

      const otherRadius = other.obstacleGeometry
        ? Math.max(other.obstacleGeometry.majorRadius, other.obstacleGeometry.minorRadius)
        : 1.0;
      const dx = other.x - crate.x;
      const dz = other.z - crate.z;
      const combinedRadius = crateRadius + otherRadius;
      if (dx * dx + dz * dz > combinedRadius * combinedRadius) continue;

      // Collision detected — execute appropriate behavior.
      if (isSalvage) {
        self.executeSalvageCrateBehavior(crate, other);
      } else {
        self.executeGeneralCrateBehavior(crate, other);
      }
      break; // Crate consumed.
    }
  }
}

export function issueMoveTo(self: GL, 
  entityId: number,
  targetX: number,
  targetZ: number,
  attackDistance = NO_ATTACK_DISTANCE,
  allowNoPathMove = false,
): void {
  const entity = self.spawnedEntities.get(entityId);
  if (!entity || !entity.canMove) return;
  // Source parity: Object::isMobile — KINDOF_IMMOBILE or any DISABLED state blocks movement.
  // C++ Object.cpp:2902 — isMobile() returns false when isDisabled() is true (any flag set).
  if (entity.isImmobile || self.isEntityDisabledForMovement(entity)) {
    return;
  }

  // Source parity: airborne aircraft fly point-to-point, skip A* pathfinding.
  const js = entity.jetAIState;
  const isAirborneAircraft = entity.category === 'air' && entity.chinookFlightStatus !== 'LANDED';
  if ((js && js.allowAirLoco) || isAirborneAircraft) {
    entity.moving = true;
    entity.movePath = [{ x: targetX, z: targetZ }];
    entity.pathIndex = 0;
    entity.moveTarget = { x: targetX, z: targetZ };
    entity.pathfindGoalCell = {
      x: Math.floor(targetX / PATHFIND_CELL_SIZE),
      z: Math.floor(targetZ / PATHFIND_CELL_SIZE),
    };
    return;
  }

  if (allowNoPathMove && self.isWorldPositionOffMap(targetX, targetZ)) {
    // Off-map exits must not run through A* clamping, or movers can get stuck
    // issuing a one-node path that never leaves the map.
    entity.moving = true;
    entity.movePath = [{ x: targetX, z: targetZ }];
    entity.pathIndex = 0;
    entity.moveTarget = { x: targetX, z: targetZ };
    entity.pathfindGoalCell = {
      x: Math.floor(targetX / PATHFIND_CELL_SIZE),
      z: Math.floor(targetZ / PATHFIND_CELL_SIZE),
    };
    return;
  }

  self.updatePathfindPosCell(entity);
  const path = self.findPath(entity.x, entity.z, targetX, targetZ, entity, attackDistance);
  if (path.length === 0) {
    if (allowNoPathMove) {
      entity.moving = true;
      entity.movePath = [{ x: targetX, z: targetZ }];
      entity.pathIndex = 0;
      entity.moveTarget = { x: targetX, z: targetZ };
      entity.pathfindGoalCell = {
        x: Math.floor(targetX / PATHFIND_CELL_SIZE),
        z: Math.floor(targetZ / PATHFIND_CELL_SIZE),
      };
      return;
    }

    entity.moving = false;
    entity.moveTarget = null;
    entity.movePath = [];
    entity.pathIndex = 0;
    entity.pathfindGoalCell = null;
    return;
  }

  entity.moving = true;
  entity.movePath = path;
  entity.pathIndex = 0;
  entity.moveTarget = entity.movePath[0]!;
  self.updatePathfindGoalCellFromPath(entity);
}

export function updateFloatEntities(self: GL): void {
  for (const entity of self.spawnedEntities.values()) {
    if (entity.destroyed || entity.slowDeathState || entity.structureCollapseState) continue;
    if (!entity.floatUpdateProfile?.enabled) continue;

    const waterHeight = self.getWaterHeightAt(entity.x, entity.z);
    if (waterHeight === null) continue;

    // Source parity: C++ sets pos->z = waterZ (raw ground position).
    // TS entity.y = waterHeight + baseHeight (center position including baseHeight offset).
    entity.y = waterHeight + entity.baseHeight;
  }
}

export function updatePhysicsBehavior(self: GL): void {
  const GRAVITY = -1.0; // Source parity: TheGlobalData->m_gravity default (GlobalData.cpp line 834)
  const GROUND_STIFFNESS = 0.5; // Source parity: TheGlobalData->m_groundStiffness default
  const VEL_THRESH = 0.001;
  const REST_THRESH = 0.01;

  for (const entity of self.spawnedEntities.values()) {
    if (entity.destroyed) continue;
    const prof = entity.physicsBehaviorProfile;
    if (!prof) continue;

    // Lazy-init state on first frame.
    if (!entity.physicsBehaviorState) {
      entity.physicsBehaviorState = {
        velX: 0, velY: 0, velZ: 0,
        accelX: 0, accelY: 0, accelZ: 0,
        yawRate: 0, pitchRate: 0, rollRate: 0,
        wasAirborneLastFrame: false,
        stickToGround: true,
        allowToFall: false,
        isInFreeFall: false,
        extraBounciness: 0, extraFriction: 0,
      };
    }
    const st = entity.physicsBehaviorState;

    // Apply gravity (Y is vertical in THREE.js coordinate system).
    st.accelY += GRAVITY;

    // Apply friction.
    const terrainY = self.resolveGroundHeight(entity.x, entity.z);
    const isAboveTerrain = entity.y > terrainY + 0.5;

    if (!isAboveTerrain) {
      // Ground friction — lateral and forward.
      if (st.velX !== 0 || st.velZ !== 0) {
        const ff = prof.mass * prof.forwardFriction;
        st.accelX += -(ff * st.velX);
        st.accelZ += -(ff * st.velZ);
      }
      // Source parity: ZFriction applied to vertical velocity on ground.
      if (st.velY !== 0) {
        st.accelY += -(prof.mass * prof.zFriction * st.velY);
      }
    } else {
      // Aerodynamic friction — proportional to velocity.
      const aero = -prof.aerodynamicFriction;
      st.accelX += st.velX * aero;
      st.accelY += st.velY * aero;
      st.accelZ += st.velZ * aero;
    }

    // Integrate acceleration into velocity.
    st.velX += st.accelX;
    st.velY += st.accelY;
    st.velZ += st.accelZ;

    // Clamp tiny velocities.
    if (Math.abs(st.velX) < VEL_THRESH) st.velX = 0;
    if (Math.abs(st.velY) < VEL_THRESH) st.velY = 0;
    if (Math.abs(st.velZ) < VEL_THRESH) st.velZ = 0;

    // Integrate velocity into position.
    const oldY = entity.y;
    entity.x += st.velX;
    entity.y += st.velY;
    entity.z += st.velZ;

    // Ground collision / bounce.
    const groundY = self.resolveGroundHeight(entity.x, entity.z);

    if (prof.allowBouncing && entity.y <= groundY && oldY > groundY && st.velY < 0) {
      // Source parity: handleBounce() — reflect velocity, apply stiffness damping.
      const stiffness = Math.max(0.01, Math.min(0.99, GROUND_STIFFNESS + st.extraBounciness));
      // Reverse and damp vertical velocity (direct velocity modification, not via accel).
      st.velY = Math.abs(st.velY) * stiffness;
      // Damp horizontal velocity on bounce.
      st.velX *= (1 - prof.forwardFriction);
      st.velZ *= (1 - prof.forwardFriction);
      // Damp pitch/roll/yaw rates on bounce.
      st.yawRate *= 0.7;
      st.pitchRate *= 0.7;
      st.rollRate *= 0.7;
      entity.y = groundY;
    } else if (entity.y <= groundY) {
      st.velY = 0;
      entity.y = groundY;
      st.allowToFall = false;
    } else if (st.stickToGround && !st.allowToFall) {
      entity.y = groundY;
    }

    // Kill when resting on ground.
    if (prof.killWhenRestingOnGround && !isAboveTerrain
        && Math.abs(st.velX) < REST_THRESH
        && Math.abs(st.velY) < REST_THRESH
        && Math.abs(st.velZ) < REST_THRESH) {
      self.markEntityDestroyed(entity.id, -1);
    }

    // Landing collision (was airborne, now grounded).
    if (st.wasAirborneLastFrame && entity.y <= groundY + 0.5) {
      // Source parity: onCollide(NULL, pos, normal) — ground collision event.
    }
    st.wasAirborneLastFrame = entity.y > groundY + 0.5;

    // Reset acceleration for next frame.
    st.accelX = 0;
    st.accelY = 0;
    st.accelZ = 0;
  }
}

export function updateEntityMovement(self: GL, dt: number): void {
  for (const entity of self.spawnedEntities.values()) {
    if (entity.destroyed) {
      continue;
    }
    if (entity.canMove) {
      self.updatePathfindPosCell(entity);
    }
  }

  for (const entity of self.spawnedEntities.values()) {
    if (entity.destroyed) {
      continue;
    }
    if (!entity.canMove || !entity.moving || entity.moveTarget === null) {
      // Decelerate stopped entities.
      if (entity.currentSpeed > 0) {
        entity.currentSpeed = 0;
      }
      self.updateEntityVerticalPosition(entity, dt);
      continue;
    }

    if (entity.pathIndex >= entity.movePath.length) {
      self.markScriptWaypointPathCompleted(entity.id);
      entity.moving = false;
      entity.moveTarget = null;
      entity.movePath = [];
      entity.pathfindGoalCell = null;
      entity.currentSpeed = 0;
      continue;
    }

    if (entity.pathIndex < entity.movePath.length && entity.moveTarget !== entity.movePath[entity.pathIndex]!) {
      entity.moveTarget = entity.movePath[entity.pathIndex]!;
    }

    const dx = entity.moveTarget.x - entity.x;
    const dz = entity.moveTarget.z - entity.z;
    const distance = Math.hypot(dx, dz);

    const isFinalPathNode = entity.pathIndex >= entity.movePath.length - 1;
    const stoppingDistanceOverride = isFinalPathNode
      ? (entity.scriptStoppingDistanceOverride ?? 0)
      : 0;
    if (stoppingDistanceOverride >= 0.5 && distance <= stoppingDistanceOverride) {
      entity.moving = false;
      entity.moveTarget = null;
      entity.movePath = [];
      entity.pathfindGoalCell = null;
      entity.currentSpeed = 0;
      continue;
    }

    if (distance < 0.001) {
      entity.pathIndex += 1;
      if (entity.pathIndex >= entity.movePath.length) {
        self.markScriptWaypointPathCompleted(entity.id);
        entity.moving = false;
        entity.moveTarget = null;
        entity.movePath = [];
        entity.pathfindGoalCell = null;
        entity.currentSpeed = 0;
        continue;
      }
      entity.moveTarget = entity.movePath[entity.pathIndex]!;
      continue;
    }

    // Source parity: Locomotor physics — get active locomotor profile.
    const locoProfile = entity.locomotorSets.get(entity.activeLocomotorSet);
    const maxSpeed = entity.speed;
    const accel = locoProfile?.acceleration ?? 0;
    const brake = locoProfile?.braking ?? 0;
    const turnRateRad = locoProfile?.turnRate ?? 0;
    const minSpeed = locoProfile?.minSpeed ?? 0;

    // Source parity: Locomotor::computeDesiredDirection — angle toward waypoint.
    // In our coordinate system: atan2(dz, dx) + PI/2 converts to heading.
    const desiredHeading = Math.atan2(dz, dx) + Math.PI / 2;

    // Source parity: Locomotor turn-rate limiting.
    // If turnRate > 0, smoothly rotate toward desired heading instead of snapping.
    if (turnRateRad > 0) {
      let angleDiff = desiredHeading - entity.rotationY;
      // Normalize to [-PI, PI].
      while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
      while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
      const maxTurn = turnRateRad * dt;
      if (Math.abs(angleDiff) <= maxTurn) {
        entity.rotationY = desiredHeading;
      } else {
        entity.rotationY += Math.sign(angleDiff) * maxTurn;
        // Normalize rotationY.
        while (entity.rotationY > Math.PI) entity.rotationY -= 2 * Math.PI;
        while (entity.rotationY < -Math.PI) entity.rotationY += 2 * Math.PI;
      }
    } else {
      // Instant rotation (legacy behavior).
      entity.rotationY = desiredHeading;
    }

    // Source parity: Locomotor acceleration/braking.
    // Compute remaining path distance for braking calculation.
    let remainingPathDist = distance;
    for (let i = entity.pathIndex + 1; i < entity.movePath.length; i++) {
      const prev = i === entity.pathIndex + 1 ? entity.moveTarget : entity.movePath[i - 1]!;
      const curr = entity.movePath[i]!;
      remainingPathDist += Math.hypot(curr.x - prev.x, curr.z - prev.z);
    }

    // Compute braking distance: v^2 / (2 * braking).
    const effectiveBrake = brake > 0 ? brake : 99999;
    const brakingDist = (entity.currentSpeed * entity.currentSpeed) / (2 * effectiveBrake);

    // Determine target speed for this frame.
    let targetSpeed = maxSpeed;
    if (remainingPathDist <= brakingDist && brake > 0) {
      // Need to decelerate — compute max speed for safe stop.
      targetSpeed = Math.sqrt(Math.max(0, 2 * effectiveBrake * remainingPathDist));
      targetSpeed = Math.min(targetSpeed, maxSpeed);
    }

    // Source parity: scale speed by turn alignment.
    // When turning sharply, slow down proportionally (C++ Locomotor behavior).
    if (turnRateRad > 0) {
      let headingDiff = desiredHeading - entity.rotationY;
      while (headingDiff > Math.PI) headingDiff -= 2 * Math.PI;
      while (headingDiff < -Math.PI) headingDiff += 2 * Math.PI;
      const alignment = Math.cos(headingDiff);
      // Units moving perpendicular or backward slow significantly.
      if (alignment < 0) {
        targetSpeed = minSpeed;
      } else {
        targetSpeed *= Math.max(0.3, alignment);
      }
    }

    // Apply acceleration or braking.
    if (accel > 0 || brake > 0) {
      if (entity.currentSpeed < targetSpeed) {
        const effectiveAccel = accel > 0 ? accel : 99999;
        entity.currentSpeed = Math.min(targetSpeed, entity.currentSpeed + effectiveAccel * dt);
      } else if (entity.currentSpeed > targetSpeed) {
        entity.currentSpeed = Math.max(targetSpeed, entity.currentSpeed - effectiveBrake * dt);
      }
    } else {
      // No physics specified — instant speed (legacy behavior).
      entity.currentSpeed = maxSpeed;
    }

    // Enforce minimum speed when moving.
    if (entity.currentSpeed > 0 && entity.currentSpeed < minSpeed && distance > minSpeed * dt * 2) {
      entity.currentSpeed = minSpeed;
    }

    const step = entity.currentSpeed * dt;
    if (distance <= step) {
      entity.x = entity.moveTarget.x;
      entity.z = entity.moveTarget.z;
      entity.pathIndex += 1;
      if (entity.pathIndex >= entity.movePath.length) {
        self.markScriptWaypointPathCompleted(entity.id);
        entity.moving = false;
        entity.moveTarget = null;
        entity.movePath = [];
        entity.pathfindGoalCell = null;
        entity.currentSpeed = 0;
        continue;
      }
      entity.moveTarget = entity.movePath[entity.pathIndex]!;
    } else if (turnRateRad > 0) {
      // Source parity: move along current heading, not directly toward target.
      // This creates realistic curved movement when turning.
      // Derive direction vector from rotationY (heading convention):
      // rotationY = atan2(dz, dx) + PI/2, so direction = (-sin(rot-PI/2), cos(rot-PI/2))
      // which simplifies to (cos(rotationY - PI/2), sin(rotationY - PI/2))
      // = (sin(rotationY), cos(rotationY))... but this depends on coordinate convention.
      // Use a safe approach: reverse the heading formula to get direction.
      const headingAngle = entity.rotationY - Math.PI / 2; // reverse the +PI/2 offset
      const headingX = Math.cos(headingAngle);
      const headingZ = Math.sin(headingAngle);
      // Blend heading movement with direct waypoint movement to prevent orbiting.
      // When well-aligned, mostly follow heading; when misaligned, bias toward waypoint.
      let headingDiff = desiredHeading - entity.rotationY;
      while (headingDiff > Math.PI) headingDiff -= 2 * Math.PI;
      while (headingDiff < -Math.PI) headingDiff += 2 * Math.PI;
      const alignment = Math.abs(headingDiff) < 0.01 ? 1 : Math.max(0, Math.cos(headingDiff));
      const directX = dx / distance;
      const directZ = dz / distance;
      const moveX = headingX * alignment + directX * (1 - alignment);
      const moveZ = headingZ * alignment + directZ * (1 - alignment);
      const moveMag = Math.hypot(moveX, moveZ);
      if (moveMag > 0.001) {
        entity.x += (moveX / moveMag) * step;
        entity.z += (moveZ / moveMag) * step;
      }
    } else {
      // No turn rate — move directly toward waypoint (legacy behavior).
      const inv = 1 / distance;
      entity.x += dx * inv * step;
      entity.z += dz * inv * step;
    }

    self.updateEntityVerticalPosition(entity, dt);

    self.updatePathfindPosCell(entity);
  }

  // Source parity: contained entities move with their container.
  // Sync passenger positions to their container's current position.
  for (const entity of self.spawnedEntities.values()) {
    if (entity.destroyed) continue;
    const containerId = entity.transportContainerId
      ?? entity.helixCarrierId
      ?? entity.garrisonContainerId
      ?? entity.tunnelContainerId;
    if (containerId === null) continue;
    const container = self.spawnedEntities.get(containerId);
    if (!container || container.destroyed) continue;
    entity.x = container.x;
    entity.z = container.z;
    entity.y = container.y;
  }
}

export function updateAnimationSteering(self: GL): void {
  const now = self.frameCounter;
  const TURN_EPSILON = 1e-4;

  for (const entity of self.spawnedEntities.values()) {
    if (entity.destroyed) continue;
    const profile = entity.animationSteeringProfile;
    if (!profile) continue;

    // Source parity approximation: derive PhysicsTurningType from body yaw delta.
    const turnDelta = self.normalizeAngle(entity.rotationY - entity.animationSteeringLastRotationY);
    entity.animationSteeringLastRotationY = entity.rotationY;

    if (now < entity.animationSteeringNextTransitionFrame) {
      continue;
    }

    let currentTurn: 'TURN_NONE' | 'TURN_NEGATIVE' | 'TURN_POSITIVE' = 'TURN_NONE';
    if (turnDelta < -TURN_EPSILON) {
      currentTurn = 'TURN_NEGATIVE';
    } else if (turnDelta > TURN_EPSILON) {
      currentTurn = 'TURN_POSITIVE';
    }

    switch (entity.animationSteeringCurrentTurnAnim) {
      case null: {
        if (currentTurn === 'TURN_NEGATIVE') {
          entity.modelConditionFlags.add('CENTER_TO_RIGHT');
          entity.animationSteeringNextTransitionFrame = now + profile.transitionFrames;
          entity.animationSteeringCurrentTurnAnim = 'CENTER_TO_RIGHT';
        } else if (currentTurn === 'TURN_POSITIVE') {
          entity.modelConditionFlags.add('CENTER_TO_LEFT');
          entity.animationSteeringNextTransitionFrame = now + profile.transitionFrames;
          entity.animationSteeringCurrentTurnAnim = 'CENTER_TO_LEFT';
        }
        break;
      }
      case 'CENTER_TO_RIGHT': {
        if (currentTurn !== 'TURN_NEGATIVE') {
          entity.modelConditionFlags.delete('CENTER_TO_RIGHT');
          entity.modelConditionFlags.add('RIGHT_TO_CENTER');
          entity.animationSteeringNextTransitionFrame = now + profile.transitionFrames;
          entity.animationSteeringCurrentTurnAnim = 'RIGHT_TO_CENTER';
        }
        break;
      }
      case 'CENTER_TO_LEFT': {
        if (currentTurn !== 'TURN_POSITIVE') {
          entity.modelConditionFlags.delete('CENTER_TO_LEFT');
          entity.modelConditionFlags.add('LEFT_TO_CENTER');
          entity.animationSteeringNextTransitionFrame = now + profile.transitionFrames;
          entity.animationSteeringCurrentTurnAnim = 'LEFT_TO_CENTER';
        }
        break;
      }
      case 'LEFT_TO_CENTER':
      case 'RIGHT_TO_CENTER': {
        if (currentTurn === 'TURN_NONE') {
          entity.modelConditionFlags.delete('LEFT_TO_CENTER');
          entity.modelConditionFlags.delete('RIGHT_TO_CENTER');
          entity.animationSteeringNextTransitionFrame = now;
          entity.animationSteeringCurrentTurnAnim = null;
        }
        break;
      }
    }
  }
}

export function updateUnitCollisionSeparation(self: GL): void {
  // Build a compact array of ground entities eligible for collision.
  const groundEntities: MapEntity[] = [];
  for (const entity of self.spawnedEntities.values()) {
    if (entity.destroyed) continue;
    if (!entity.canMove) continue;
    if (entity.category === 'air') continue;
    if (entity.noCollisions) continue;
    if (entity.objectStatusFlags.has('AIRBORNE_TARGET')) continue;
    // Source parity: C++ processCollision requires a locomotor to apply forces.
    // Entities without locomotors (e.g. crate victims, static objects) don't participate.
    if (entity.locomotorSets.size === 0) continue;
    // Skip contained/transported entities.
    if (entity.transportContainerId !== null
      || entity.helixCarrierId !== null
      || entity.garrisonContainerId !== null
      || entity.tunnelContainerId !== null) continue;
    groundEntities.push(entity);
  }

  const len = groundEntities.length;
  if (len < 2) return;

  // Source parity: minimum separation is PATHFIND_CELL_SIZE / 2 to prevent co-location.
  const MIN_SEPARATION = PATHFIND_CELL_SIZE * 0.5;
  // Source parity: separation strength — fraction of overlap corrected per frame.
  // C++ uses a force-based approach; we use direct position correction.
  const SEPARATION_STRENGTH = 0.4;

  for (let i = 0; i < len; i++) {
    const a = groundEntities[i]!;
    for (let j = i + 1; j < len; j++) {
      const b = groundEntities[j]!;

      // Source parity: C++ processCollision primarily handles same-team blocking.
      // Enemy units are handled by combat engagement and crush collisions, not separation.
      if (self.getTeamRelationship(a, b) !== RELATIONSHIP_ALLIES) continue;

      // Source parity: C++ canPathThroughUnits skips collision for certain units.
      // We approximate: skip if either entity has an ignored obstacle ID pointing at the other.
      if (a.ignoredMovementObstacleId === b.id || b.ignoredMovementObstacleId === a.id) continue;

      // Bounding circle radii from obstacle geometry.
      const radiusA = a.obstacleGeometry ? a.obstacleGeometry.majorRadius : MIN_SEPARATION;
      const radiusB = b.obstacleGeometry ? b.obstacleGeometry.majorRadius : MIN_SEPARATION;
      const combinedRadius = Math.max(radiusA + radiusB, MIN_SEPARATION * 2);

      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const distSqr = dx * dx + dz * dz;
      const combinedRadiusSqr = combinedRadius * combinedRadius;

      if (distSqr >= combinedRadiusSqr) continue;

      // Overlap detected.
      const dist = Math.sqrt(distSqr);
      // Source parity: C++ caps overlap at 5.0 to prevent explosive separation
      // when deeply interpenetrating objects (PhysicsUpdate.cpp:1412).
      const overlap = Math.min(combinedRadius - dist, 5.0);

      // Direction from A to B (or random if coincident).
      let nx: number;
      let nz: number;
      if (dist > 0.01) {
        nx = dx / dist;
        nz = dz / dist;
      } else {
        // Source parity: C++ caps dist at 1.0 for coincident objects.
        // Use a deterministic pseudo-random direction based on entity IDs.
        const angle = ((a.id * 7 + b.id * 13) % 360) * (Math.PI / 180);
        nx = Math.cos(angle);
        nz = Math.sin(angle);
      }

      const correction = overlap * SEPARATION_STRENGTH;

      // Determine who moves: moving entities yield to stationary ones.
      const aMoving = a.moving;
      const bMoving = b.moving;
      const aIdle = !aMoving && a.attackTargetEntityId === null;
      const bIdle = !bMoving && b.attackTargetEntityId === null;

      // Source parity: immobile structures never get pushed.
      const aImmobile = a.isImmobile;
      const bImmobile = b.isImmobile;

      if (aImmobile && bImmobile) continue;

      let aFraction: number;
      let bFraction: number;

      if (aImmobile) {
        // Only push B.
        aFraction = 0;
        bFraction = 1;
      } else if (bImmobile) {
        // Only push A.
        aFraction = 1;
        bFraction = 0;
      } else if (aMoving && !bMoving) {
        // Moving A yields to stationary B.
        aFraction = 0.8;
        bFraction = 0.2;
      } else if (bMoving && !aMoving) {
        // Moving B yields to stationary A.
        aFraction = 0.2;
        bFraction = 0.8;
      } else {
        // Both moving or both idle — split evenly.
        aFraction = 0.5;
        bFraction = 0.5;
      }

      // Push A away from B (negative direction) and B away from A (positive direction).
      a.x -= nx * correction * aFraction;
      a.z -= nz * correction * aFraction;
      b.x += nx * correction * bFraction;
      b.z += nz * correction * bFraction;

      // Source parity: when both are idle and very close (< cell size / 4),
      // issue move-away commands to resolve permanent overlap.
      // C++ AIUpdate.cpp:1575-1585: nudge BOTH idle units in opposite directions.
      // C++ AIUpdate.cpp:1567-1571: skip if busy or using ability.
      if (aIdle && bIdle && !aImmobile && !bImmobile
        && distSqr < PATHFIND_CELL_SIZE * PATHFIND_CELL_SIZE * 0.25) {
        if (a.moveTarget === null
          && !a.objectStatusFlags.has('IS_USING_ABILITY')) {
          const awayX = a.x - nx * PATHFIND_CELL_SIZE;
          const awayZ = a.z - nz * PATHFIND_CELL_SIZE;
          issueMoveTo(self, a.id, awayX, awayZ);
        }
        if (b.moveTarget === null
          && !b.objectStatusFlags.has('IS_USING_ABILITY')) {
          const awayX = b.x + nx * PATHFIND_CELL_SIZE;
          const awayZ = b.z + nz * PATHFIND_CELL_SIZE;
          issueMoveTo(self, b.id, awayX, awayZ);
        }
      }
    }
  }
}

export function updateCrushCollisions(self: GL): void {
  for (const mover of self.spawnedEntities.values()) {
    if (mover.destroyed || !mover.canMove || !mover.moving) {
      continue;
    }
    if (mover.crusherLevel <= 0) {
      continue;
    }

    // Source parity: rotationY = atan2(dz, dx) + PI/2; reverse to get movement direction.
    const moveDirX = Math.sin(mover.rotationY);
    const moveDirZ = -Math.cos(mover.rotationY);

    // Source parity: geometry major radius comes from object geometry info.
    // In this port some units keep radius via pathDiameter even when obstacleGeometry is null.
    const moverRadius = self.resolveEntityMajorRadius(mover);

    for (const target of self.spawnedEntities.values()) {
      if (target.destroyed || !target.canTakeDamage || target.id === mover.id) {
        continue;
      }
      if (!canCrushOrSquish(self, mover, target)) {
        continue;
      }

      // Source parity: SquishCollide::onCollide — hijacker/TNT-hunter immunity.
      // If the infantry has a pending enter-object action (hijackVehicle) targeting the
      // crusher, it is immune to being crushed by that specific vehicle.
      const pendingAction = self.pendingEnterObjectActions.get(target.id);
      if (pendingAction && pendingAction.targetObjectId === mover.id
        && (pendingAction.action === 'hijackVehicle' || pendingAction.action === 'convertToCarBomb')) {
        continue;
      }

      // Source parity: SquishCollide::onCollide uses radius 1.0 for infantry collision.
      const targetRadius = target.canBeSquished
        ? 1.0
        : self.resolveEntityMajorRadius(target);

      const combinedRadius = moverRadius + targetRadius;
      const dx = target.x - mover.x;
      const dz = target.z - mover.z;
      const distSqr = dx * dx + dz * dz;

      if (distSqr > combinedRadius * combinedRadius) {
        continue;
      }

      if (target.canBeSquished) {
        // Source parity: SquishCollide::onCollide — infantry crush requires the
        // crusher to be moving toward the target (dot > 0).
        if (distSqr > 0.001) {
          const dot = moveDirX * dx + moveDirZ * dz;
          if (dot <= 0) {
            continue;
          }
        }
      } else if (!shouldCrushVehicleTarget(self, mover, target)) {
        // Source parity: PhysicsUpdate vehicle-on-vehicle crush point check.
        continue;
      }

      // Source parity: ToppleUpdate::onCollide — entities with topple profile get toppled
      // instead of crushed. Death is handled by topple completion (KillWhenFinishedToppling).
      // In C++, ToppleUpdate is the collide handler, not SquishCollide.
      if (target.toppleProfile && target.toppleState === 'NONE') {
        const moverSpeed = mover.speed > 0 ? mover.speed : 1.0;
        self.applyTopplingForce(target, dx, dz, moverSpeed);
      } else {
        // Source parity: CRUSH damage uses HUGE_DAMAGE_AMOUNT (guaranteed kill).
        self.applyWeaponDamageAmount(mover.id, target, HUGE_DAMAGE_AMOUNT, 'CRUSH');
      }
    }
  }
}

export function resolveVehicleCrushTarget(self: GL, 
  crusher: MapEntity,
  victim: MapEntity,
): 'TOTAL' | 'FRONT' | 'BACK' | 'NONE' {
  const frontCrushed = victim.frontCrushed;
  const backCrushed = victim.backCrushed;
  if (frontCrushed && backCrushed) {
    return 'NONE';
  }

  if (frontCrushed) return 'BACK';
  if (backCrushed) return 'FRONT';

  const dirX = Math.sin(crusher.rotationY);
  const dirZ = -Math.cos(crusher.rotationY);
  const victimDirX = Math.sin(victim.rotationY);
  const victimDirZ = -Math.cos(victim.rotationY);
  const crushPointOffsetDistance = self.resolveEntityMajorRadius(victim) * 0.5;
  const offsetX = victimDirX * crushPointOffsetDistance;
  const offsetZ = victimDirZ * crushPointOffsetDistance;

  const frontX = victim.x + offsetX;
  const frontZ = victim.z + offsetZ;
  const backX = victim.x - offsetX;
  const backZ = victim.z - offsetZ;
  const centerX = victim.x;
  const centerZ = victim.z;

  const frontVectorX = frontX - crusher.x;
  const frontVectorZ = frontZ - crusher.z;
  const backVectorX = backX - crusher.x;
  const backVectorZ = backZ - crusher.z;
  const centerVectorX = centerX - crusher.x;
  const centerVectorZ = centerZ - crusher.z;

  const frontRayLength = frontVectorX * dirX + frontVectorZ * dirZ;
  const backRayLength = backVectorX * dirX + backVectorZ * dirZ;
  const centerRayLength = centerVectorX * dirX + centerVectorZ * dirZ;

  const frontPerpLength = Math.hypot(frontRayLength * dirX - frontVectorX, frontRayLength * dirZ - frontVectorZ);
  const backPerpLength = Math.hypot(backRayLength * dirX - backVectorX, backRayLength * dirZ - backVectorZ);
  const centerPerpLength = Math.hypot(centerRayLength * dirX - centerVectorX, centerRayLength * dirZ - centerVectorZ);

  const frontVectorLength = Math.hypot(frontVectorX, frontVectorZ);
  const backVectorLength = Math.hypot(backVectorX, backVectorZ);
  const centerVectorLength = Math.hypot(centerVectorX, centerVectorZ);

  if (frontPerpLength <= centerPerpLength && frontPerpLength <= backPerpLength) {
    if (
      self.perpsLogicallyEqual(frontPerpLength, centerPerpLength)
      || self.perpsLogicallyEqual(frontPerpLength, backPerpLength)
    ) {
      if (self.perpsLogicallyEqual(frontPerpLength, centerPerpLength)) {
        return frontVectorLength < centerVectorLength ? 'FRONT' : 'TOTAL';
      }
      return frontVectorLength < backVectorLength ? 'FRONT' : 'BACK';
    }
    return 'FRONT';
  }

  if (backPerpLength <= centerPerpLength && backPerpLength <= frontPerpLength) {
    if (
      self.perpsLogicallyEqual(backPerpLength, centerPerpLength)
      || self.perpsLogicallyEqual(backPerpLength, frontPerpLength)
    ) {
      if (self.perpsLogicallyEqual(backPerpLength, centerPerpLength)) {
        return backVectorLength < centerVectorLength ? 'BACK' : 'TOTAL';
      }
      return backVectorLength < frontVectorLength ? 'BACK' : 'FRONT';
    }
    return 'BACK';
  }

  if (
    self.perpsLogicallyEqual(centerPerpLength, backPerpLength)
    || self.perpsLogicallyEqual(centerPerpLength, frontPerpLength)
  ) {
    if (self.perpsLogicallyEqual(centerPerpLength, frontPerpLength)) {
      return centerVectorLength < frontVectorLength ? 'TOTAL' : 'FRONT';
    }
    return centerVectorLength < backVectorLength ? 'TOTAL' : 'BACK';
  }
  return 'TOTAL';
}

export function shouldCrushVehicleTarget(self: GL, crusher: MapEntity, victim: MapEntity): boolean {
  const crushTarget = resolveVehicleCrushTarget(self, crusher, victim);
  if (crushTarget === 'NONE') {
    return false;
  }

  const victimDirX = Math.sin(victim.rotationY);
  const victimDirZ = -Math.cos(victim.rotationY);
  const crushPointOffsetDistance = self.resolveEntityMajorRadius(victim) * 0.5;
  const offsetX = victimDirX * crushPointOffsetDistance;
  const offsetZ = victimDirZ * crushPointOffsetDistance;

  let pointX = victim.x;
  let pointZ = victim.z;
  if (crushTarget === 'FRONT') {
    pointX += offsetX;
    pointZ += offsetZ;
  } else if (crushTarget === 'BACK') {
    pointX -= offsetX;
    pointZ -= offsetZ;
  }

  const dx = pointX - crusher.x;
  const dz = pointZ - crusher.z;
  const dirX = Math.sin(crusher.rotationY);
  const dirZ = -Math.cos(crusher.rotationY);
  const dot = dirX * dx + dirZ * dz;
  const distanceSquared = dx * dx + dz * dz;
  const distanceTooFarSquared = 2.25 * crushPointOffsetDistance * crushPointOffsetDistance;
  return dot < 0 && distanceSquared < distanceTooFarSquared;
}
