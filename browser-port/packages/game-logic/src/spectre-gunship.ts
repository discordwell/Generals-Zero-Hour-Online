// @ts-nocheck — self is typed as any; real safety comes from the test suite.
/**
 * Spectre gunship — gunship orbital, gattling spawn, howitzer damage.
 *
 * Source parity: Object/SpectreGunshipUpdate.cpp
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { readNumericField, readStringField } from './ini-readers.js';
import { findObjectDefByName } from './registry-lookups.js';
type GL = any;

// ---- Spectre gunship implementations ----

export function extractSpectreGunshipUpdateProfile(self: GL, objectDef: ObjectDef | undefined): SpectreGunshipUpdateProfile | null {
  if (!objectDef) return null;
  for (const block of objectDef.blocks) {
    const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
    if (moduleType !== 'SPECTREGUNSHIPUPDATE') continue;
    return {
      specialPowerTemplate: readStringField(block.fields, ['SpecialPowerTemplate']) ?? '',
      attackAreaRadius: readNumericField(block.fields, ['AttackAreaRadius']) ?? 200,
      targetingReticleRadius: readNumericField(block.fields, ['TargetingReticleRadius']) ?? 25,
      gunshipOrbitRadius: readNumericField(block.fields, ['GunshipOrbitRadius']) ?? 250,
      strafingIncrement: readNumericField(block.fields, ['StrafingIncrement']) ?? 20,
      orbitInsertionSlope: readNumericField(block.fields, ['OrbitInsertionSlope']) ?? 0.7,
      howitzerFiringRate: self.msToLogicFrames(readNumericField(block.fields, ['HowitzerFiringRate']) ?? 333),
      howitzerFollowLag: self.msToLogicFrames(readNumericField(block.fields, ['HowitzerFollowLag']) ?? 0),
      randomOffsetForHowitzer: readNumericField(block.fields, ['RandomOffsetForHowitzer']) ?? 20,
      orbitFrames: self.msToLogicFrames(readNumericField(block.fields, ['OrbitTime']) ?? 0),
      howitzerWeaponTemplate: readStringField(block.fields, ['HowitzerWeaponTemplate']) ?? '',
      gattlingTemplateName: readStringField(block.fields, ['GattlingTemplateName']) ?? '',
    };
  }
  return null;
}

export function extractSpectreGunshipDeploymentProfile(self: GL, objectDef: ObjectDef | undefined): SpectreGunshipDeploymentProfile | null {
  if (!objectDef) return null;
  for (const block of objectDef.blocks) {
    const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
    if (moduleType !== 'SPECTREGUNSHIPDEPLOYMENTUPDATE') continue;
    const createLocStr = (readStringField(block.fields, ['CreateLocation']) ?? 'CREATE_AT_EDGE_FARTHEST_FROM_TARGET').toUpperCase();
    let createLocation: SpectreGunshipDeploymentProfile['createLocation'] = 'FARTHEST_FROM_TARGET';
    if (createLocStr.includes('NEAR_SOURCE')) createLocation = 'NEAR_SOURCE';
    else if (createLocStr.includes('FARTHEST_FROM_SOURCE')) createLocation = 'FARTHEST_FROM_SOURCE';
    else if (createLocStr.includes('NEAR_TARGET')) createLocation = 'NEAR_TARGET';
    return {
      specialPowerTemplate: readStringField(block.fields, ['SpecialPowerTemplate']) ?? '',
      gunshipTemplateName: readStringField(block.fields, ['GunshipTemplateName']) ?? '',
      attackAreaRadius: readNumericField(block.fields, ['AttackAreaRadius']) ?? 200,
      gunshipOrbitRadius: readNumericField(block.fields, ['GunshipOrbitRadius']) ?? 250,
      createLocation,
    };
  }
  return null;
}

export function initiateSpectreGunshipDeployment(self: GL, 
  sourceEntityId: number,
  targetX: number,
  targetZ: number,
): boolean {
  const source = self.spawnedEntities.get(sourceEntityId);
  if (!source) return false;
  const profile = source.spectreGunshipDeploymentProfile;
  if (!profile || !profile.gunshipTemplateName) return false;

  // Resolve the gunship template
  const iniDataRegistry = self.iniDataRegistry;
  if (!iniDataRegistry) return false;
  const gunshipDef = findObjectDefByName(iniDataRegistry, profile.gunshipTemplateName);
  if (!gunshipDef) return false;

  // Source parity: find creation point at map edge based on createLocation strategy
  const mapWidth = self.mapHeightmap ? self.mapHeightmap.worldWidth : 1000;
  const mapHeight = self.mapHeightmap ? self.mapHeightmap.worldDepth : 1000;

  let referenceX: number;
  let referenceZ: number;
  let findFarthest: boolean;
  switch (profile.createLocation) {
    case 'NEAR_SOURCE':
      referenceX = source.x;
      referenceZ = source.z;
      findFarthest = false;
      break;
    case 'FARTHEST_FROM_SOURCE':
      referenceX = source.x;
      referenceZ = source.z;
      findFarthest = true;
      break;
    case 'NEAR_TARGET':
      referenceX = targetX;
      referenceZ = targetZ;
      findFarthest = false;
      break;
    case 'FARTHEST_FROM_TARGET':
    default:
      referenceX = targetX;
      referenceZ = targetZ;
      findFarthest = true;
      break;
  }

  // Source parity: TerrainLogic::findClosestEdgePoint / findFarthestEdgePoint
  // Projects reference point to each map edge and selects closest/farthest
  const edgeCandidates = [
    { x: 0, z: referenceZ },                // left edge
    { x: mapWidth, z: referenceZ },          // right edge
    { x: referenceX, z: 0 },                // top edge
    { x: referenceX, z: mapHeight },         // bottom edge
  ];
  let bestEdge = edgeCandidates[0]!;
  let bestDist = findFarthest ? -1 : Number.POSITIVE_INFINITY;
  for (const edge of edgeCandidates) {
    const dx = edge.x - referenceX;
    const dz = edge.z - referenceZ;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (findFarthest ? dist > bestDist : dist < bestDist) {
      bestDist = dist;
      bestEdge = edge;
    }
  }

  // Source parity: push creation point further off-map by orbit radius
  const dxToEdge = targetX - bestEdge.x;
  const dzToEdge = targetZ - bestEdge.z;
  const distToTarget = Math.sqrt(dxToEdge * dxToEdge + dzToEdge * dzToEdge);
  if (distToTarget > 0.001) {
    const normX = dxToEdge / distToTarget;
    const normZ = dzToEdge / distToTarget;
    const extendedDist = distToTarget + (profile.gunshipOrbitRadius || 250);
    bestEdge.x = targetX - normX * extendedDist;
    bestEdge.z = targetZ - normZ * extendedDist;
  }

  // Spawn the gunship entity
  const orientation = Math.atan2(targetZ - bestEdge.z, targetX - bestEdge.x);
  const gunshipEntity = self.spawnEntityFromTemplate(
    profile.gunshipTemplateName,
    bestEdge.x,
    bestEdge.z,
    orientation,
    source.side ?? '',
  );
  if (!gunshipEntity) return false;

  // Source parity: fire the gunship's own special power at the target location
  const gunshipProfile = gunshipEntity.spectreGunshipProfile;
  if (gunshipProfile) {
    // Initialize the gunship state machine
    gunshipEntity.spectreGunshipState = {
      status: 'INSERTING',
      initialTargetX: targetX,
      initialTargetZ: targetZ,
      overrideTargetX: targetX,
      overrideTargetZ: targetZ,
      satelliteX: targetX,
      satelliteZ: targetZ,
      gattlingTargetX: targetX,
      gattlingTargetZ: targetZ,
      positionToShootAtX: targetX,
      positionToShootAtZ: targetZ,
      orbitEscapeFrame: 0,
      okToFireHowitzerCounter: 0,
      gattlingEntityId: -1,
    };

    // Source parity: SpectreGunshipUpdate::initiateIntentToDoSpecialPower —
    // spawn a gattling entity, add it to the gunship's contain module, and disable it
    // until orbit insertion is complete. C++ creates the entity from m_gattlingTemplateName,
    // calls shipContain->addToContain(newGattling), then gattling->setDisabled(DISABLED_PARALYZED).
    spawnSpectreGattlingEntity(self, gunshipEntity, gunshipProfile, gunshipEntity.spectreGunshipState);
  }

  return true;
}

export function spawnSpectreGattlingEntity(self: GL, 
  gunship: MapEntity,
  profile: SpectreGunshipUpdateProfile,
  state: SpectreGunshipState,
): void {
  if (!profile.gattlingTemplateName) return;

  // Destroy any pre-existing gattling entity (C++ nulls m_gattlingID if entity already exists)
  if (state.gattlingEntityId !== -1) {
    const existing = self.spawnedEntities.get(state.gattlingEntityId);
    if (existing && !existing.destroyed) {
      self.markEntityDestroyed(existing.id, -1);
    }
    state.gattlingEntityId = -1;
  }

  const gattling = self.spawnEntityFromTemplate(
    profile.gattlingTemplateName,
    gunship.x,
    gunship.z,
    gunship.rotationY,
    gunship.side ?? '',
  );
  if (!gattling) return;

  // Source parity: shipContain->addToContain(newGattling) — track as contained by gunship.
  gattling.transportContainerId = gunship.id;

  // Source parity: gattling->setDisabled(DISABLED_PARALYZED) — hold fire until orbit insertion.
  gattling.objectStatusFlags.add('DISABLED_PARALYZED');

  state.gattlingEntityId = gattling.id;
}

export function cleanUpSpectreGunship(self: GL, state: SpectreGunshipState): void {
  if (state.gattlingEntityId !== -1) {
    const gattling = self.spawnedEntities.get(state.gattlingEntityId);
    if (gattling && !gattling.destroyed) {
      self.markEntityDestroyed(gattling.id, -1);
    }
    state.gattlingEntityId = -1;
  }
}

export function updateSpectreGunship(self: GL): void {
  const ORBIT_INSERTION_SLOPE_MAX = 0.8;
  const ORBIT_INSERTION_SLOPE_MIN = 0.5;

  for (const entity of self.spawnedEntities.values()) {
    if (entity.destroyed) continue;
    const profile = entity.spectreGunshipProfile;
    const state = entity.spectreGunshipState;
    if (!profile || !state) continue;

    if (state.status === 'IDLE') continue;

    // Source parity: INSERTING or ORBITING — compute orbital waypoint
    if (state.status === 'INSERTING' || state.status === 'ORBITING') {
      // Source parity: perigee — normalized direction from target to gunship
      const perigeeX = entity.x - state.initialTargetX;
      const perigeeZ = entity.z - state.initialTargetZ;
      const distanceToTarget = Math.sqrt(perigeeX * perigeeX + perigeeZ * perigeeZ);
      const pLen = distanceToTarget > 0.001 ? distanceToTarget : 1;
      const normPX = perigeeX / pLen;
      const normPZ = perigeeZ / pLen;

      // Source parity: apogee — 90° counterclockwise rotation of perigee
      const apogeeX = -normPZ;
      const apogeeZ = normPX;

      // Source parity: declination — blend perigee and apogee by insertion slope
      const n1 = Math.min(ORBIT_INSERTION_SLOPE_MAX, Math.max(ORBIT_INSERTION_SLOPE_MIN, profile.orbitInsertionSlope));
      const n2 = 1.0 - n1;
      const declX = normPX * n1 + apogeeX * n2;
      const declZ = normPZ * n1 + apogeeZ * n2;

      // Scale to orbital radius
      const orbitalRadius = profile.gunshipOrbitRadius;
      state.satelliteX = state.initialTargetX + declX * orbitalRadius;
      state.satelliteZ = state.initialTargetZ + declZ * orbitalRadius;

      // Move toward satellite position (simplified — source uses locomotor AI)
      const moveSpeed = entity.speed > 0 ? entity.speed : 3.0;
      const dxMove = state.satelliteX - entity.x;
      const dzMove = state.satelliteZ - entity.z;
      const moveDist = Math.sqrt(dxMove * dxMove + dzMove * dzMove);
      if (moveDist > moveSpeed) {
        entity.x += (dxMove / moveDist) * moveSpeed;
        entity.z += (dzMove / moveDist) * moveSpeed;
      } else {
        entity.x = state.satelliteX;
        entity.z = state.satelliteZ;
      }
      entity.rotationY = Math.atan2(dzMove, dxMove);

      // Source parity: constrain target override within attack radius
      const constraintRadius = profile.attackAreaRadius - profile.targetingReticleRadius;
      const overrideDX = state.initialTargetX - state.overrideTargetX;
      const overrideDZ = state.initialTargetZ - state.overrideTargetZ;
      const overrideDist = Math.sqrt(overrideDX * overrideDX + overrideDZ * overrideDZ);
      if (overrideDist > constraintRadius && overrideDist > 0.001) {
        const normOX = overrideDX / overrideDist;
        const normOZ = overrideDZ / overrideDist;
        state.overrideTargetX = state.initialTargetX - normOX * constraintRadius;
        state.overrideTargetZ = state.initialTargetZ - normOZ * constraintRadius;
      }

      // Source parity: transition from INSERTING to ORBITING when within orbit radius
      if (state.status === 'INSERTING' && distanceToTarget < orbitalRadius) {
        state.status = 'ORBITING';
        state.orbitEscapeFrame = self.frameCounter + profile.orbitFrames;

        // Source parity: gattling->clearDisabled(DISABLED_PARALYZED) — enable the gattling gun
        // on orbit insertion. C++ SpectreGunshipUpdate.cpp line 478.
        const gattlingInsert = self.spawnedEntities.get(state.gattlingEntityId);
        if (gattlingInsert && !gattlingInsert.destroyed) {
          gattlingInsert.objectStatusFlags.delete('DISABLED_PARALYZED');
        }
      }

      // Source parity: gattling entity tracks gunship position (it's contained aboard).
      const gattlingFollow = self.spawnedEntities.get(state.gattlingEntityId);
      if (gattlingFollow && !gattlingFollow.destroyed) {
        gattlingFollow.x = entity.x;
        gattlingFollow.z = entity.z;
        gattlingFollow.y = entity.y;
      }
    }

    // Source parity: ORBITING — weapon firing logic
    if (state.status === 'ORBITING') {
      // Check departure
      if (self.frameCounter >= state.orbitEscapeFrame) {
        state.status = 'DEPARTING';

        // Source parity: disengageAndDepartAO — gattling->setDisabled(DISABLED_PARALYZED)
        // and cleanUp() destroys the gattling entity. C++ SpectreGunshipUpdate.cpp line 812/828.
        const gattlingDepart = self.spawnedEntities.get(state.gattlingEntityId);
        if (gattlingDepart && !gattlingDepart.destroyed) {
          gattlingDepart.objectStatusFlags.add('DISABLED_PARALYZED');
        }
        cleanUpSpectreGunship(self, state);

        // Source parity: disengage — fly in current facing direction off map
        continue;
      }

      // Source parity: howitzer evaluation every N frames
      if (profile.howitzerFiringRate > 0 && self.frameCounter % profile.howitzerFiringRate === 0) {
        state.positionToShootAtX = state.overrideTargetX;
        state.positionToShootAtZ = state.overrideTargetZ;

        // Find nearest enemy in targeting reticle
        let targetEntity: MapEntity | null = null;
        let closestDist = profile.targetingReticleRadius;
        for (const other of self.spawnedEntities.values()) {
          if (other.destroyed || other.health <= 0) continue;
          if (other.side === entity.side) continue;
          if (other.side === '') continue;
          const edx = other.x - state.overrideTargetX;
          const edz = other.z - state.overrideTargetZ;
          const eDist = Math.sqrt(edx * edx + edz * edz);
          if (eDist < closestDist) {
            // Source parity: isFairDistanceFromShip — target must be > 75% orbit radius from ship
            const shipDx = other.x - entity.x;
            const shipDz = other.z - entity.z;
            const shipDist = Math.sqrt(shipDx * shipDx + shipDz * shipDz);
            if (shipDist > profile.gunshipOrbitRadius * 0.75) {
              closestDist = eDist;
              targetEntity = other;
            }
          }
        }

        // Source parity: AI players auto-acquire targets in the full attack area
        if (!targetEntity) {
          for (const other of self.spawnedEntities.values()) {
            if (other.destroyed || other.health <= 0) continue;
            if (other.side === entity.side) continue;
            if (other.side === '') continue;
            const edx = other.x - state.initialTargetX;
            const edz = other.z - state.initialTargetZ;
            const eDist = Math.sqrt(edx * edx + edz * edz);
            if (eDist < profile.attackAreaRadius) {
              const shipDx = other.x - entity.x;
              const shipDz = other.z - entity.z;
              const shipDist = Math.sqrt(shipDx * shipDx + shipDz * shipDz);
              if (shipDist > profile.gunshipOrbitRadius * 0.75) {
                state.positionToShootAtX = other.x;
                state.positionToShootAtZ = other.z;
                targetEntity = other;
                break;
              }
            }
          }
        }

        // Source parity: gattlingAI->aiAttackObject / aiAttackPosition —
        // direct the gattling entity to attack the found target or strafe position.
        // C++ SpectreGunshipUpdate.cpp lines 585-591.
        const gattlingOrbit = self.spawnedEntities.get(state.gattlingEntityId);
        if (gattlingOrbit && !gattlingOrbit.destroyed) {
          if (targetEntity) {
            gattlingOrbit.attackTargetEntityId = targetEntity.id;
            gattlingOrbit.attackTargetPosition = null;
          } else {
            gattlingOrbit.attackTargetEntityId = null;
            gattlingOrbit.attackTargetPosition = { x: state.gattlingTargetX, z: state.gattlingTargetZ };
          }
        }

        // Source parity: howitzer fires after gattling has converged for long enough
        if (state.okToFireHowitzerCounter > profile.howitzerFollowLag) {
          if (profile.howitzerWeaponTemplate) {
            const offs = profile.randomOffsetForHowitzer;
            const attackX = state.gattlingTargetX + (self.gameRandom.nextFloat() * 2 - 1) * offs;
            const attackZ = state.gattlingTargetZ + (self.gameRandom.nextFloat() * 2 - 1) * offs;
            // Apply area damage at howitzer impact point
            applySpectreHowitzerDamageAt(self, entity, attackX, attackZ, profile.howitzerWeaponTemplate);
          }
        }
      }

      // Source parity: gattling strafing — move toward positionToShootAt incrementally
      const strafeDX = state.positionToShootAtX - state.gattlingTargetX;
      const strafeDZ = state.positionToShootAtZ - state.gattlingTargetZ;
      const strafeDist = Math.sqrt(strafeDX * strafeDX + strafeDZ * strafeDZ);
      if (strafeDist < profile.strafingIncrement) {
        state.gattlingTargetX = state.positionToShootAtX;
        state.gattlingTargetZ = state.positionToShootAtZ;
        state.okToFireHowitzerCounter++;
      } else {
        state.okToFireHowitzerCounter = 0;
        const normSX = strafeDX / strafeDist;
        const normSZ = strafeDZ / strafeDist;
        state.gattlingTargetX += normSX * profile.strafingIncrement;
        state.gattlingTargetZ += normSZ * profile.strafingIncrement;
      }
    }

    // Source parity: DEPARTING — fly off map, then destroy self
    if (state.status === 'DEPARTING') {
      const exitSpeed = entity.speed > 0 ? entity.speed : 3.0;
      const dirX = Math.cos(entity.rotationY);
      const dirZ = Math.sin(entity.rotationY);
      entity.x += dirX * exitSpeed;
      entity.z += dirZ * exitSpeed;

      // Source parity: destroy when off map
      const mapWidth = self.mapHeightmap ? self.mapHeightmap.worldWidth : 1000;
      const mapHeight = self.mapHeightmap ? self.mapHeightmap.worldDepth : 1000;
      if (entity.x < -100 || entity.x > mapWidth + 100 || entity.z < -100 || entity.z > mapHeight + 100) {
        cleanUpSpectreGunship(self, state);
        self.markEntityDestroyed(entity.id, -1);
        state.status = 'IDLE';
      }
    }
  }
}

export function applySpectreHowitzerDamageAt(self: GL, source: MapEntity, targetX: number, targetZ: number, weaponTemplateName: string): void {
  const iniDataRegistry = self.iniDataRegistry;
  if (!iniDataRegistry) return;
  const weaponDef = iniDataRegistry.getWeapon(weaponTemplateName);
  const damage = weaponDef
    ? (readNumericField(weaponDef.fields, ['Damage']) ?? 50)
    : 50;
  const radius = weaponDef
    ? (readNumericField(weaponDef.fields, ['DamageRadius', 'AttackRange']) ?? 30)
    : 30;
  const damageType = weaponDef
    ? (readStringField(weaponDef.fields, ['DamageType']) ?? 'EXPLOSION')
    : 'EXPLOSION';

  for (const other of self.spawnedEntities.values()) {
    if (other.destroyed || other.health <= 0) continue;
    if (other.side === source.side && other.side !== '') continue;
    const dx = other.x - targetX;
    const dz = other.z - targetZ;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist <= radius) {
      self.applyWeaponDamageAmount(source.id, other, damage, damageType);
    }
  }
}
