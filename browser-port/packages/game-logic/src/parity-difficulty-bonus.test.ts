/**
 * Solo Player Difficulty Bonus Parity Tests — verify SOLO_* weapon bonus conditions
 * and health multipliers match C++ source.
 *
 * Source parity references:
 *   Player.cpp:3370-3402 — Player::friend_applyDifficultyBonusesForObject
 *   GlobalData.cpp:408-414 — HumanSoloPlayerHealthBonus_*, AISoloPlayerHealthBonus_*
 *   GlobalData.h:225 — m_soloPlayerHealthBonusForDifficulty[PLAYERTYPE_COUNT][DIFFICULTY_COUNT]
 *   Weapon.h:197-202 — WEAPONBONUSCONDITION_SOLO_HUMAN_EASY through SOLO_AI_HARD
 *   Object.cpp:545-548 — initObject applies bonus when scriptObjectsReceiveDifficultyBonus
 */

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import {
  makeBlock,
  makeBundle,
  makeObjectDef,
  makeRegistry,
  makeHeightmap,
  makeMap,
  makeMapObject,
} from './test-helpers.js';
import {
  GameLogicSubsystem,
  WEAPON_BONUS_CONDITION_BY_NAME,
  WEAPON_BONUS_SOLO_HUMAN_EASY,
  WEAPON_BONUS_SOLO_HUMAN_NORMAL,
  WEAPON_BONUS_SOLO_HUMAN_HARD,
  WEAPON_BONUS_SOLO_AI_EASY,
  WEAPON_BONUS_SOLO_AI_NORMAL,
  WEAPON_BONUS_SOLO_AI_HARD,
} from './index.js';
import type { IniDataBundle, GameDataConfig } from '@generals/ini-data';

// ── Helpers ─────────────────────────────────────────────────────────────────

interface TestObjectSpec {
  maxHealth: number;
  initialHealth?: number;
}

function createCampaignLogic(opts: {
  objects?: TestObjectSpec[];
  gameData?: Partial<GameDataConfig>;
  sides?: Record<string, { playerType?: string }>;
  difficulty?: number;
  mapObjects?: ReturnType<typeof makeMapObject>[];
}) {
  const specs: TestObjectSpec[] = opts.objects ?? [{ maxHealth: 100 }];
  const sideEntries = Object.keys(opts.sides ?? { America: {} });
  const defaultSide = sideEntries[0] ?? 'America';
  const objectDefs = specs.map((spec, i) => {
    const bodyFields: Record<string, unknown> = { MaxHealth: spec.maxHealth };
    if (spec.initialHealth !== undefined) {
      bodyFields.InitialHealth = spec.initialHealth;
    }
    return makeObjectDef(
      `TestUnit_${i}`,
      defaultSide,
      ['INFANTRY'],
      [makeBlock('Body', 'ActiveBody ModuleTag_Body', bodyFields)],
    );
  });
  const bundle = makeBundle({ objects: objectDefs }) as IniDataBundle;
  bundle.gameData = {
    weaponBonusEntries: [],
    healthBonuses: [1.0, 1.0, 1.0, 1.0],
    soloPlayerHealthBonuses: opts.gameData?.soloPlayerHealthBonuses ?? [[1.0, 1.0, 1.0], [1.0, 1.0, 1.0]],
    ...opts.gameData,
  };

  const registry = makeRegistry(bundle);
  const mapSize = 64;
  const mapObjects = opts.mapObjects ?? [makeMapObject('TestUnit_0', 10, 10)];
  const mapData = makeMap(mapObjects, mapSize, mapSize);

  // Inject sidesList with difficulty info
  (mapData as any).sidesList = {
    sides: sideEntries.map((sideName) => ({
      dict: {
        playerName: sideName,
        playerFaction: sideName,
        skirmishDifficulty: String(opts.difficulty ?? 1), // default NORMAL
      },
    })),
    teams: [],
  };

  const heightmap = makeHeightmap(mapSize, mapSize);
  const scene = new THREE.Scene();
  const logic = new GameLogicSubsystem(scene, { isCampaignMode: true });

  logic.loadMapObjects(mapData, registry, heightmap);

  // Set up player sides and types
  let playerIndex = 0;
  for (const side of sideEntries) {
    logic.setPlayerSide(playerIndex, side);
    const sideConfig = (opts.sides ?? { America: {} })[side];
    if (sideConfig?.playerType) {
      logic.setSidePlayerType(side, sideConfig.playerType);
    }
    playerIndex++;
  }

  return logic;
}

// ── Part 1: SOLO_* weapon bonus condition constants ─────────────────────────

describe('SOLO_* weapon bonus condition constants', () => {
  it('exports all 6 SOLO_* conditions at correct bit positions', () => {
    expect(WEAPON_BONUS_SOLO_HUMAN_EASY).toBe(1 << 16);
    expect(WEAPON_BONUS_SOLO_HUMAN_NORMAL).toBe(1 << 17);
    expect(WEAPON_BONUS_SOLO_HUMAN_HARD).toBe(1 << 18);
    expect(WEAPON_BONUS_SOLO_AI_EASY).toBe(1 << 19);
    expect(WEAPON_BONUS_SOLO_AI_NORMAL).toBe(1 << 20);
    expect(WEAPON_BONUS_SOLO_AI_HARD).toBe(1 << 21);
  });

  it('has all 6 SOLO_* entries in WEAPON_BONUS_CONDITION_BY_NAME map', () => {
    expect(WEAPON_BONUS_CONDITION_BY_NAME.get('SOLO_HUMAN_EASY')).toBe(1 << 16);
    expect(WEAPON_BONUS_CONDITION_BY_NAME.get('SOLO_HUMAN_NORMAL')).toBe(1 << 17);
    expect(WEAPON_BONUS_CONDITION_BY_NAME.get('SOLO_HUMAN_HARD')).toBe(1 << 18);
    expect(WEAPON_BONUS_CONDITION_BY_NAME.get('SOLO_AI_EASY')).toBe(1 << 19);
    expect(WEAPON_BONUS_CONDITION_BY_NAME.get('SOLO_AI_NORMAL')).toBe(1 << 20);
    expect(WEAPON_BONUS_CONDITION_BY_NAME.get('SOLO_AI_HARD')).toBe(1 << 21);
  });

  it('preserves existing conditions at correct bit positions after the gap', () => {
    // TARGET_FAERIE_FIRE is at bit 22, right after SOLO_AI_HARD at bit 21
    expect(WEAPON_BONUS_CONDITION_BY_NAME.get('TARGET_FAERIE_FIRE')).toBe(1 << 22);
    expect(WEAPON_BONUS_CONDITION_BY_NAME.get('FANATICISM')).toBe(1 << 23);
    expect(WEAPON_BONUS_CONDITION_BY_NAME.get('FRENZY_ONE')).toBe(1 << 24);
    expect(WEAPON_BONUS_CONDITION_BY_NAME.get('FRENZY_TWO')).toBe(1 << 25);
    expect(WEAPON_BONUS_CONDITION_BY_NAME.get('FRENZY_THREE')).toBe(1 << 26);
  });

  it('preserves pre-gap conditions at correct bit positions', () => {
    expect(WEAPON_BONUS_CONDITION_BY_NAME.get('GARRISONED')).toBe(1 << 0);
    expect(WEAPON_BONUS_CONDITION_BY_NAME.get('SUBLIMINAL')).toBe(1 << 15);
  });
});

// ── Part 2: Solo player health bonus in GameData config ─────────────────────

describe('soloPlayerHealthBonuses GameData config', () => {
  it('defaults to all 1.0 when not specified in INI', () => {
    const bundle = makeBundle({ objects: [] }) as IniDataBundle;
    // gameData not set — should get default when loading
    const registry = makeRegistry(bundle);
    const gameData = registry.getGameData();
    // When no GameData block is parsed, getGameData returns undefined
    // The defaults are applied in the GameLogic constructor
    expect(gameData).toBeUndefined();
  });

  it('parses soloPlayerHealthBonuses from GameDataConfig', () => {
    const bundle = makeBundle({ objects: [] }) as IniDataBundle;
    bundle.gameData = {
      weaponBonusEntries: [],
      healthBonuses: [1.0, 1.0, 1.0, 1.0],
      soloPlayerHealthBonuses: [[1.5, 1.0, 0.75], [0.8, 1.0, 1.25]],
    };
    const registry = makeRegistry(bundle);
    const gameData = registry.getGameData()!;
    expect(gameData.soloPlayerHealthBonuses).toEqual([[1.5, 1.0, 0.75], [0.8, 1.0, 1.25]]);
  });

  it('returns a defensive copy of soloPlayerHealthBonuses from getGameData', () => {
    const bundle = makeBundle({ objects: [] }) as IniDataBundle;
    bundle.gameData = {
      weaponBonusEntries: [],
      healthBonuses: [1.0, 1.0, 1.0, 1.0],
      soloPlayerHealthBonuses: [[1.5, 1.0, 0.75], [0.8, 1.0, 1.25]],
    };
    const registry = makeRegistry(bundle);
    const a = registry.getGameData()!;
    const b = registry.getGameData()!;
    // Should be equal but not the same reference
    expect(a.soloPlayerHealthBonuses).toEqual(b.soloPlayerHealthBonuses);
    expect(a.soloPlayerHealthBonuses).not.toBe(b.soloPlayerHealthBonuses);
    expect(a.soloPlayerHealthBonuses[0]).not.toBe(b.soloPlayerHealthBonuses[0]);
  });
});

// ── Part 3: Difficulty bonuses applied at entity creation ───────────────────

describe('difficulty bonuses at entity creation', () => {
  it('applies SOLO_HUMAN_NORMAL weapon bonus for human player on normal difficulty', () => {
    const logic = createCampaignLogic({
      sides: { America: { playerType: 'HUMAN' } },
      difficulty: 1, // NORMAL
    });
    const state = logic.getEntityState(1);
    expect(state).not.toBeNull();
    expect(state!.weaponBonusConditionFlags & WEAPON_BONUS_SOLO_HUMAN_NORMAL).toBe(WEAPON_BONUS_SOLO_HUMAN_NORMAL);
    // Should NOT have other SOLO flags
    expect(state!.weaponBonusConditionFlags & WEAPON_BONUS_SOLO_HUMAN_EASY).toBe(0);
    expect(state!.weaponBonusConditionFlags & WEAPON_BONUS_SOLO_HUMAN_HARD).toBe(0);
    expect(state!.weaponBonusConditionFlags & WEAPON_BONUS_SOLO_AI_EASY).toBe(0);
    expect(state!.weaponBonusConditionFlags & WEAPON_BONUS_SOLO_AI_NORMAL).toBe(0);
    expect(state!.weaponBonusConditionFlags & WEAPON_BONUS_SOLO_AI_HARD).toBe(0);
  });

  it('applies SOLO_HUMAN_EASY weapon bonus for human player on easy difficulty', () => {
    const logic = createCampaignLogic({
      sides: { America: { playerType: 'HUMAN' } },
      difficulty: 0, // EASY
    });
    const state = logic.getEntityState(1);
    expect(state).not.toBeNull();
    expect(state!.weaponBonusConditionFlags & WEAPON_BONUS_SOLO_HUMAN_EASY).toBe(WEAPON_BONUS_SOLO_HUMAN_EASY);
  });

  it('applies SOLO_HUMAN_HARD weapon bonus for human player on hard difficulty', () => {
    const logic = createCampaignLogic({
      sides: { America: { playerType: 'HUMAN' } },
      difficulty: 2, // HARD
    });
    const state = logic.getEntityState(1);
    expect(state).not.toBeNull();
    expect(state!.weaponBonusConditionFlags & WEAPON_BONUS_SOLO_HUMAN_HARD).toBe(WEAPON_BONUS_SOLO_HUMAN_HARD);
  });

  it('applies SOLO_AI_NORMAL weapon bonus for computer player on normal difficulty', () => {
    const logic = createCampaignLogic({
      sides: { America: { playerType: 'COMPUTER' } },
      difficulty: 1, // NORMAL
    });
    const state = logic.getEntityState(1);
    expect(state).not.toBeNull();
    expect(state!.weaponBonusConditionFlags & WEAPON_BONUS_SOLO_AI_NORMAL).toBe(WEAPON_BONUS_SOLO_AI_NORMAL);
    expect(state!.weaponBonusConditionFlags & WEAPON_BONUS_SOLO_HUMAN_NORMAL).toBe(0);
  });

  it('applies SOLO_AI_EASY for computer player on easy difficulty', () => {
    const logic = createCampaignLogic({
      sides: { America: { playerType: 'COMPUTER' } },
      difficulty: 0,
    });
    const state = logic.getEntityState(1);
    expect(state).not.toBeNull();
    expect(state!.weaponBonusConditionFlags & WEAPON_BONUS_SOLO_AI_EASY).toBe(WEAPON_BONUS_SOLO_AI_EASY);
  });

  it('applies SOLO_AI_HARD for computer player on hard difficulty', () => {
    const logic = createCampaignLogic({
      sides: { America: { playerType: 'COMPUTER' } },
      difficulty: 2,
    });
    const state = logic.getEntityState(1);
    expect(state).not.toBeNull();
    expect(state!.weaponBonusConditionFlags & WEAPON_BONUS_SOLO_AI_HARD).toBe(WEAPON_BONUS_SOLO_AI_HARD);
  });

  it('multiplies max health by solo health bonus factor for human on easy', () => {
    const logic = createCampaignLogic({
      gameData: {
        soloPlayerHealthBonuses: [[1.5, 1.0, 0.75], [1.0, 1.0, 1.0]],
      },
      sides: { America: { playerType: 'HUMAN' } },
      difficulty: 0, // EASY, human bonus = 1.5
    });
    const state = logic.getEntityState(1);
    expect(state).not.toBeNull();
    // 100 (base) * 1.5 = 150
    expect(state!.maxHealth).toBeCloseTo(150, 1);
    expect(state!.health).toBeCloseTo(150, 1);
  });

  it('does not alter health when bonus factor is 1.0', () => {
    const logic = createCampaignLogic({
      gameData: {
        soloPlayerHealthBonuses: [[1.0, 1.0, 1.0], [1.0, 1.0, 1.0]],
      },
      sides: { America: { playerType: 'HUMAN' } },
      difficulty: 1, // NORMAL, bonus = 1.0
    });
    const state = logic.getEntityState(1);
    expect(state).not.toBeNull();
    expect(state!.maxHealth).toBe(100);
    expect(state!.health).toBe(100);
  });

  it('multiplies max health by AI bonus for computer player', () => {
    const logic = createCampaignLogic({
      gameData: {
        soloPlayerHealthBonuses: [[1.0, 1.0, 1.0], [1.0, 1.0, 2.0]],
      },
      sides: { America: { playerType: 'COMPUTER' } },
      difficulty: 2, // HARD, AI bonus = 2.0
    });
    const state = logic.getEntityState(1);
    expect(state).not.toBeNull();
    expect(state!.maxHealth).toBeCloseTo(200, 1);
    expect(state!.health).toBeCloseTo(200, 1);
  });

  it('does not apply difficulty bonuses in multiplayer (non-campaign) mode', () => {
    // Create a non-campaign logic instance
    const objectDefs = [makeObjectDef(
      'TestUnit_0', 'America', ['INFANTRY'],
      [makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100 })],
    )];
    const bundle = makeBundle({ objects: objectDefs }) as IniDataBundle;
    bundle.gameData = {
      weaponBonusEntries: [],
      healthBonuses: [1.0, 1.0, 1.0, 1.0],
      soloPlayerHealthBonuses: [[2.0, 2.0, 2.0], [2.0, 2.0, 2.0]],
    };
    const registry = makeRegistry(bundle);
    const mapData = makeMap([makeMapObject('TestUnit_0', 10, 10)], 64, 64);
    const heightmap = makeHeightmap(64, 64);
    const scene = new THREE.Scene();
    // isCampaignMode: false (default)
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(mapData, registry, heightmap);
    logic.setPlayerSide(0, 'America');

    const state = logic.getEntityState(1);
    expect(state).not.toBeNull();
    // Health should NOT be multiplied
    expect(state!.maxHealth).toBe(100);
    // No SOLO_* flags should be set
    const allSoloFlags = WEAPON_BONUS_SOLO_HUMAN_EASY | WEAPON_BONUS_SOLO_HUMAN_NORMAL
      | WEAPON_BONUS_SOLO_HUMAN_HARD | WEAPON_BONUS_SOLO_AI_EASY
      | WEAPON_BONUS_SOLO_AI_NORMAL | WEAPON_BONUS_SOLO_AI_HARD;
    expect(state!.weaponBonusConditionFlags & allSoloFlags).toBe(0);
  });

  it('preserves health ratio when applying health factor', () => {
    // Entity starts with initialHealth less than maxHealth
    const logic = createCampaignLogic({
      objects: [{ maxHealth: 200, initialHealth: 100 }],
      gameData: {
        soloPlayerHealthBonuses: [[2.0, 1.0, 1.0], [1.0, 1.0, 1.0]],
      },
      sides: { America: { playerType: 'HUMAN' } },
      difficulty: 0, // EASY, human bonus = 2.0
    });
    const state = logic.getEntityState(1);
    expect(state).not.toBeNull();
    // maxHealth: 200 * 2.0 = 400, health preserves ratio (100/200 = 0.5): 400 * 0.5 = 200
    expect(state!.maxHealth).toBeCloseTo(400, 1);
    expect(state!.health).toBeCloseTo(200, 1);
  });
});

// ── Script toggling of difficulty bonuses ────────────────────────────────────

describe('script toggling of difficulty bonuses', () => {
  it('removes SOLO_* weapon bonus when setScriptObjectsReceiveDifficultyBonus(false)', () => {
    const logic = createCampaignLogic({
      gameData: {
        soloPlayerHealthBonuses: [[1.5, 1.0, 1.0], [1.0, 1.0, 1.0]],
      },
      sides: { America: { playerType: 'HUMAN' } },
      difficulty: 0, // EASY
    });

    // Verify bonus was applied at creation
    let state = logic.getEntityState(1);
    expect(state!.weaponBonusConditionFlags & WEAPON_BONUS_SOLO_HUMAN_EASY).toBe(WEAPON_BONUS_SOLO_HUMAN_EASY);
    expect(state!.maxHealth).toBeCloseTo(150, 1);

    // Disable difficulty bonuses
    logic.setScriptObjectsReceiveDifficultyBonus(false);

    state = logic.getEntityState(1);
    expect(state!.weaponBonusConditionFlags & WEAPON_BONUS_SOLO_HUMAN_EASY).toBe(0);
    // Health should revert: 150 / 1.5 = 100
    expect(state!.maxHealth).toBeCloseTo(100, 1);
  });

  it('re-applies SOLO_* weapon bonus when setScriptObjectsReceiveDifficultyBonus(true)', () => {
    const logic = createCampaignLogic({
      gameData: {
        soloPlayerHealthBonuses: [[1.5, 1.0, 1.0], [1.0, 1.0, 1.0]],
      },
      sides: { America: { playerType: 'HUMAN' } },
      difficulty: 0,
    });

    // Disable then re-enable
    logic.setScriptObjectsReceiveDifficultyBonus(false);
    logic.setScriptObjectsReceiveDifficultyBonus(true);

    const state = logic.getEntityState(1);
    expect(state!.weaponBonusConditionFlags & WEAPON_BONUS_SOLO_HUMAN_EASY).toBe(WEAPON_BONUS_SOLO_HUMAN_EASY);
    expect(state!.maxHealth).toBeCloseTo(150, 1);
  });
});
