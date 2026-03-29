/**
 * Parity Agent — headless game logic wrapper for deterministic parity testing.
 *
 * Provides a camera-free, selection-free interface to GameLogicSubsystem
 * that works in vitest without browser/Three.js rendering dependencies.
 * Commands target entities directly by ID for deterministic test authoring.
 */

import * as THREE from 'three';
import type { MapObjectJSON } from '@generals/terrain';

import { GameLogicSubsystem } from './index.js';
import {
  makeBlock,
  makeObjectDef,
  makeWeaponDef,
  makeArmorDef,
  makeLocomotorDef,
  makeUpgradeDef,
  makeCommandButtonDef,
  makeCommandSetDef,
  makeScienceDef,
  makeSpecialPowerDef,
  makeObjectCreationListDef,
  makeWeaponBlock,
  makeBundle,
  makeRegistry,
  makeHeightmap,
  makeMap,
  makeMapObject,
} from './test-helpers.js';

// Re-export helpers for backward compat (parity-combat.test.ts, parity-pipeline.test.ts, etc.)
export {
  makeBlock,
  makeObjectDef,
  makeWeaponDef,
  makeArmorDef,
  makeLocomotorDef,
  makeUpgradeDef,
  makeCommandButtonDef,
  makeCommandSetDef,
  makeScienceDef,
  makeSpecialPowerDef,
  makeObjectCreationListDef,
  makeWeaponBlock,
  makeBundle,
  makeRegistry,
  makeHeightmap,
  makeMap,
  makeMapObject,
};

/** Alias for makeMapObject — used in parity tests for brevity. */
export const place = makeMapObject;

// ── Interfaces ──────────────────────────────────────────────────────────────

export interface AgentState {
  tick: number;
  credits: Record<string, number>;
  entities: AgentEntity[];
  gameEnd: { status: string; victorSides: string[]; defeatedSides: string[] } | null;
}

export interface AgentEntity {
  id: number;
  template: string;
  side: string;
  pos: [number, number, number];
  health: number;
  maxHealth: number;
  alive: boolean;
  veterancy: number;
  constructionPct: number;
  statusFlags: string[];
}

export interface AgentStateDiff {
  tickDelta: number;
  creditChanges: Record<string, number>;
  damaged: { id: number; template: string; hpBefore: number; hpAfter: number }[];
  destroyed: { id: number; template: string }[];
  spawned: { id: number; template: string }[];
}

export interface ParityAgent {
  state(): AgentState;
  entities(side?: string): AgentEntity[];
  entity(id: number): AgentEntity | null;

  // Commands (by entity ID, no selection state needed)
  move(entityId: number, x: number, z: number): void;
  attackMove(entityId: number, x: number, z: number): void;
  attack(entityId: number, targetId: number): void;
  guard(entityId: number, x: number, z: number): void;
  stop(entityId: number): void;
  build(dozerId: number, template: string, x: number, z: number): void;
  train(buildingId: number, unitTemplate: string): void;
  upgrade(entityId: number, upgradeName: string): void;
  sell(entityId: number): void;

  // Simulation control
  step(n?: number): AgentState;
  setCredits(side: string, amount: number): void;

  // Diff helpers
  snapshot(): AgentState;
  diff(before: AgentState): AgentStateDiff;

  // Direct access for assertions
  readonly gameLogic: GameLogicSubsystem;
}

// ── Factory ─────────────────────────────────────────────────────────────────

const MAX_STEP_FRAMES = 900;

export function createParityAgent(config: {
  bundles: Parameters<typeof makeBundle>[0];
  mapObjects?: MapObjectJSON[];
  mapSize?: number;
  sides: Record<string, { credits?: number; playerType?: string }>;
  enemies?: [string, string][];
}): ParityAgent {
  const bundle = makeBundle(config.bundles);
  const registry = makeRegistry(bundle);
  const mapSize = config.mapSize ?? 64;
  const mapObjects = config.mapObjects ?? [];
  const map = makeMap(mapObjects, mapSize, mapSize);
  const heightmap = makeHeightmap(mapSize, mapSize);

  const scene = new THREE.Scene();
  const logic = new GameLogicSubsystem(scene);

  logic.loadMapObjects(map, registry, heightmap);

  // Set up player sides
  let playerIndex = 0;
  const sideNames = Object.keys(config.sides);
  for (const side of sideNames) {
    logic.setPlayerSide(playerIndex, side);
    const sideConfig = config.sides[side]!;
    if (sideConfig.credits !== undefined) {
      logic.setSideCredits(side, sideConfig.credits);
    }
    playerIndex++;
  }

  // Set up enemy relationships
  if (config.enemies) {
    for (const [a, b] of config.enemies) {
      logic.setTeamRelationship(a, b, 0);
      logic.setTeamRelationship(b, a, 0);
    }
  }

  // ── Internal helpers ──────────────────────────────────────────────────

  function allEntityIds(): number[] {
    const ids: number[] = [];
    // Scan up to the next ID that will be assigned. The subsystem increments
    // nextId monotonically, so any entity that ever existed has id < nextId.
    const maxId = (logic as unknown as { nextId: number }).nextId ?? 10000;
    for (let id = 1; id < maxId; id++) {
      if (logic.getEntityState(id) !== null) {
        ids.push(id);
      }
    }
    return ids;
  }

  function toAgentEntity(id: number): AgentEntity | null {
    const s = logic.getEntityState(id);
    if (!s) return null;
    return {
      id: s.id,
      template: s.templateName,
      side: s.side,
      pos: [s.x, s.y, s.z],
      health: s.health,
      maxHealth: s.maxHealth,
      alive: s.alive,
      veterancy: s.veterancyLevel,
      constructionPct: s.constructionPercent,
      statusFlags: s.statusFlags,
    };
  }

  function gatherEntities(side?: string): AgentEntity[] {
    const all = allEntityIds().map(toAgentEntity).filter((e): e is AgentEntity => e !== null);
    if (side === undefined) return all;
    const normalizedSide = side.toLowerCase();
    return all.filter((e) => e.side.toLowerCase() === normalizedSide);
  }

  function gatherCredits(): Record<string, number> {
    const credits: Record<string, number> = {};
    for (const side of sideNames) {
      credits[side] = logic.getSideCredits(side);
    }
    return credits;
  }

  function gatherGameEnd(): AgentState['gameEnd'] {
    const ge = logic.getGameEndState();
    if (!ge) return null;
    return {
      status: ge.status,
      victorSides: ge.victorSides,
      defeatedSides: ge.defeatedSides,
    };
  }

  function buildState(): AgentState {
    return {
      tick: (logic as unknown as { frameCounter: number }).frameCounter ?? 0,
      credits: gatherCredits(),
      entities: gatherEntities(),
      gameEnd: gatherGameEnd(),
    };
  }

  // ── Agent implementation ──────────────────────────────────────────────

  const agent: ParityAgent = {
    get gameLogic() {
      return logic;
    },

    state() {
      return buildState();
    },

    entities(side?: string) {
      return gatherEntities(side);
    },

    entity(id: number) {
      return toAgentEntity(id);
    },

    move(entityId: number, x: number, z: number) {
      logic.submitCommand({
        type: 'moveTo',
        entityId,
        targetX: x,
        targetZ: z,
        commandSource: 'PLAYER',
      });
    },

    attackMove(entityId: number, x: number, z: number) {
      logic.submitCommand({
        type: 'attackMoveTo',
        entityId,
        targetX: x,
        targetZ: z,
        attackDistance: logic.getAttackMoveDistanceForEntity(entityId),
        commandSource: 'PLAYER',
      });
    },

    attack(entityId: number, targetId: number) {
      logic.submitCommand({
        type: 'attackEntity',
        entityId,
        targetEntityId: targetId,
        commandSource: 'PLAYER',
      });
    },

    guard(entityId: number, x: number, z: number) {
      logic.submitCommand({
        type: 'guardPosition',
        entityId,
        targetX: x,
        targetZ: z,
        guardMode: 0,
        commandSource: 'PLAYER',
      });
    },

    stop(entityId: number) {
      logic.submitCommand({ type: 'stop', entityId, commandSource: 'PLAYER' });
    },

    build(dozerId: number, template: string, x: number, z: number) {
      logic.submitCommand({
        type: 'constructBuilding',
        entityId: dozerId,
        templateName: template,
        targetPosition: [x, 0, z],
        angle: 0,
        lineEndPosition: null,
      });
    },

    train(buildingId: number, unitTemplate: string) {
      logic.submitCommand({
        type: 'queueUnitProduction',
        entityId: buildingId,
        unitTemplateName: unitTemplate,
      });
    },

    upgrade(entityId: number, upgradeName: string) {
      logic.submitCommand({
        type: 'applyUpgrade',
        entityId,
        upgradeName,
      });
    },

    sell(entityId: number) {
      logic.submitCommand({ type: 'sell', entityId });
    },

    step(n = 1) {
      const frames = Math.min(Math.max(1, Math.trunc(n)), MAX_STEP_FRAMES);
      for (let i = 0; i < frames; i++) {
        logic.update(1 / 30);
      }
      return buildState();
    },

    setCredits(side: string, amount: number) {
      logic.setSideCredits(side, amount);
    },

    snapshot() {
      return buildState();
    },

    diff(before: AgentState): AgentStateDiff {
      const after = buildState();
      const tickDelta = after.tick - before.tick;

      // Credit changes
      const creditChanges: Record<string, number> = {};
      for (const side of sideNames) {
        const delta = (after.credits[side] ?? 0) - (before.credits[side] ?? 0);
        if (delta !== 0) {
          creditChanges[side] = delta;
        }
      }

      // Index before entities by id
      const beforeById = new Map<number, AgentEntity>();
      for (const e of before.entities) {
        beforeById.set(e.id, e);
      }

      const afterById = new Map<number, AgentEntity>();
      for (const e of after.entities) {
        afterById.set(e.id, e);
      }

      const damaged: AgentStateDiff['damaged'] = [];
      const destroyed: AgentStateDiff['destroyed'] = [];
      const spawned: AgentStateDiff['spawned'] = [];

      // Check for damaged and destroyed
      for (const [id, beforeEntity] of beforeById) {
        const afterEntity = afterById.get(id);
        if (!afterEntity) {
          // Entity removed from world entirely
          destroyed.push({ id, template: beforeEntity.template });
          continue;
        }
        if (beforeEntity.alive && !afterEntity.alive) {
          destroyed.push({ id, template: beforeEntity.template });
        }
        if (afterEntity.health < beforeEntity.health) {
          damaged.push({
            id,
            template: beforeEntity.template,
            hpBefore: beforeEntity.health,
            hpAfter: afterEntity.health,
          });
        }
      }

      // Check for spawned (new entities)
      for (const [id, afterEntity] of afterById) {
        if (!beforeById.has(id)) {
          spawned.push({ id, template: afterEntity.template });
        }
      }

      return { tickDelta, creditChanges, damaged, destroyed, spawned };
    },
  };

  return agent;
}
