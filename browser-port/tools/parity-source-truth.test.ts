import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  compareDamageTypes,
  compareGameStateMapFields,
  compareSaveGameInfoFields,
  compareSaveSnapshotBlockOrder,
  compareSkirmishGameInfoFields,
  parseCppDamageTypeNames,
  parseCppGameStateMapXferFields,
  parseCppSaveGameInfoXferFields,
  parseCppSaveSnapshotBlockNames,
  parseCppSkirmishGameInfoXferFields,
  parseCppWeaponBonusEnumValues,
  parseCppWeaponBonusNames,
  parseCppWeaponFieldNames,
  parseTsDamageTypeNames,
  parseTsGameStateMapXferFields,
  parseTsSaveGameInfoXferFields,
  parseTsSaveSnapshotBlockNames,
  parseTsSkirmishGameInfoXferFields,
  parseTsWeaponBonusConditionNames,
  runSourceParityCheck,
} from './parity-source-truth.js';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(rootDir, '..');

async function readFileOrEmpty(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return '';
  }
}

describe('parity source truth', () => {
  describe('parsers', () => {
    it('parses C++ damage type names from TheDamageNames array', () => {
      const source = `
static const char *TheDamageNames[] =
{
  "EXPLOSION",
  "CRUSH",
  "ARMOR_PIERCING",
  NULL
};`;
      const names = parseCppDamageTypeNames(source);
      expect(names).toEqual(['EXPLOSION', 'CRUSH', 'ARMOR_PIERCING']);
    });

    it('parses C++ damage type names from s_bitNameList array', () => {
      const source = `
const char* DamageTypeFlags::s_bitNameList[] =
{
  "EXPLOSION",
  "CRUSH",
  NULL
};`;
      const names = parseCppDamageTypeNames(source);
      expect(names).toEqual(['EXPLOSION', 'CRUSH']);
    });

    it('parses C++ weapon bonus names', () => {
      const source = `
static const char *TheWeaponBonusNames[] =
{
  "GARRISONED",
  "HORDE",
  "VETERAN",
  NULL
};`;
      const names = parseCppWeaponBonusNames(source);
      expect(names).toEqual(['GARRISONED', 'HORDE', 'VETERAN']);
    });

    it('parses C++ weapon field names from parse table', () => {
      const source = `
const FieldParse WeaponTemplate::TheWeaponTemplateFieldParseTable[] =
{
  { "PrimaryDamage", INI::parseReal, NULL, 0 },
  { "AttackRange", INI::parseReal, NULL, 0 },
  { "ClipSize", INI::parseInt, NULL, 0 },
  { NULL, NULL, NULL, 0 }
};`;
      const names = parseCppWeaponFieldNames(source);
      expect(names).toEqual(['PrimaryDamage', 'AttackRange', 'ClipSize']);
    });

    it('parses C++ weapon bonus enum values', () => {
      const source = `
enum WeaponBonusConditionType
{
  WEAPONBONUSCONDITION_INVALID = -1,
  WEAPONBONUSCONDITION_GARRISONED = 0,
  WEAPONBONUSCONDITION_HORDE,
  WEAPONBONUSCONDITION_VETERAN,
  WEAPONBONUSCONDITION_COUNT
};`;
      const values = parseCppWeaponBonusEnumValues(source);
      expect(values).toEqual(['GARRISONED', 'HORDE', 'VETERAN']);
    });

    it('parses C++ save snapshot block registration order', () => {
      const source = `
#define GAME_STATE_BLOCK_STRING "CHUNK_GameState"
#define CAMPAIGN_BLOCK_STRING "CHUNK_Campaign"
void GameState::init( void )
{
  addSnapshotBlock( GAME_STATE_BLOCK_STRING, TheGameState, SNAPSHOT_SAVELOAD );
  addSnapshotBlock( CAMPAIGN_BLOCK_STRING, TheCampaignManager, SNAPSHOT_SAVELOAD );
  addSnapshotBlock( "CHUNK_GameStateMap", TheGameStateMap, SNAPSHOT_SAVELOAD );
  addSnapshotBlock( "CHUNK_TeamFactory", TheTeamFactory, SNAPSHOT_DEEPCRC_LOGICONLY );
}`;
      const names = parseCppSaveSnapshotBlockNames(source);
      expect(names).toEqual(['CHUNK_GameState', 'CHUNK_Campaign', 'CHUNK_GameStateMap']);
    });

    it('parses TS source save snapshot block write order without runtime-only blocks', () => {
      const source = `
const SOURCE_CAMPAIGN_BLOCK = 'CHUNK_Campaign';
const SOURCE_GAME_CLIENT_BLOCK = 'CHUNK_GameClient';
export const BROWSER_RUNTIME_STATE_BLOCK = 'CHUNK_TS_RuntimeState';
export function buildRuntimeSaveFile() {
  const state = new GameState();
  state.addSnapshotBlock('CHUNK_GameState', new MetadataSnapshot());
  if (condition) {
    state.addSnapshotBlock(SOURCE_GAME_CLIENT_BLOCK, new RawPassthroughSnapshot());
  } else {
    state.addSnapshotBlock(SOURCE_GAME_CLIENT_BLOCK, new GameClientSnapshot());
  }
  state.addSnapshotBlock(SOURCE_CAMPAIGN_BLOCK, new CampaignSnapshot());
  state.addSnapshotBlock(BROWSER_RUNTIME_STATE_BLOCK, new BrowserRuntimeSnapshot());
}
function parseRuntimeSaveGameMapInfoForMetadata() {}
function parseRuntimeSaveFile() {
  state.addSnapshotBlock('CHUNK_NotWriteOrder', snapshot);
}`;
      const names = parseTsSaveSnapshotBlockNames(source);
      expect(names).toEqual(['CHUNK_GameState', 'CHUNK_GameClient', 'CHUNK_Campaign']);
    });

    it('parses C++ SaveGameInfo xfer field order', () => {
      const source = `
void GameState::xfer( Xfer *xfer )
{
  SaveGameInfo *saveGameInfo = getSaveGameInfo();
  xfer->xferUser( &saveGameInfo->saveFileType, sizeof( SaveFileType ) );
  xfer->xferAsciiString( &saveGameInfo->missionMapName );
  xfer->xferUnsignedShort( &saveGameInfo->date.year );
  xfer->xferUnicodeString( &saveGameInfo->description );
  xfer->xferAsciiString( &saveGameInfo->mapLabel );
}  // end xfer`;
      const fields = parseCppSaveGameInfoXferFields(source);
      expect(fields).toEqual([
        'saveFileType',
        'missionMapName',
        'date.year',
        'description',
        'mapLabel',
      ]);
    });

    it('parses TS MetadataSnapshot xfer field order', () => {
      const source = `
class MetadataSnapshot implements Snapshot {
  xfer(xfer: Xfer): void {
    this.state.saveFileType = xfer.xferInt(this.state.saveFileType);
    this.state.missionMapName = xfer.xferAsciiString(this.state.missionMapName);
    this.state.date.year = xfer.xferUnsignedShort(this.state.date.year);
    this.state.description = xfer.xferUnicodeString(this.state.description);
  }
}
class MapSnapshot implements Snapshot {}`;
      const fields = parseTsSaveGameInfoXferFields(source);
      expect(fields).toEqual(['saveFileType', 'missionMapName', 'date.year', 'description']);
    });

    it('parses C++ GameStateMap xfer field order', () => {
      const source = `
void GameStateMap::xfer( Xfer *xfer )
{
  xfer->xferVersion( &version, currentVersion );
  xfer->xferAsciiString( &tmp );
  xfer->xferAsciiString( &tmp );
  xfer->xferInt( &gameMode );
  embedPristineMap( saveGameInfo->pristineMapName, xfer );
  xfer->xferObjectID( &highObjectID );
  xfer->xferDrawableID( &highDrawableID );
  xfer->xferSnapshot(TheSkirmishGameInfo);
}  // end xfer`;
      const fields = parseCppGameStateMapXferFields(source);
      expect(fields).toEqual([
        'version',
        'saveGameMapPath',
        'pristineMapPath',
        'gameMode',
        'embeddedMapBytes',
        'objectIdCounter',
        'drawableIdCounter',
        'skirmishGameInfoSnapshot',
      ]);
    });

    it('parses TS MapSnapshot xfer field order', () => {
      const source = `
class MapSnapshot implements Snapshot {
  xfer(xfer: Xfer): void {
    const version = xfer.xferVersion(GAME_STATE_MAP_VERSION);
    this.state.saveGameMapPath = xfer.xferAsciiString(this.state.saveGameMapPath);
    this.state.pristineMapPath = xfer.xferAsciiString(this.state.pristineMapPath);
    this.state.gameMode = xfer.xferInt(this.state.gameMode);
    this.state.embeddedMapBytes = xfer.xferUser(new Uint8Array(0));
    this.state.objectIdCounter = xfer.xferObjectID(this.state.objectIdCounter);
    this.state.drawableIdCounter = xfer.xferUnsignedInt(this.state.drawableIdCounter);
    this.state.skirmishGameInfoState = xferChallengeGameInfoState(xfer, this.state.skirmishGameInfoState);
  }
}
class CampaignSnapshot implements Snapshot {}`;
      const fields = parseTsGameStateMapXferFields(source);
      expect(fields).toEqual([
        'version',
        'saveGameMapPath',
        'pristineMapPath',
        'gameMode',
        'embeddedMapBytes',
        'objectIdCounter',
        'drawableIdCounter',
        'skirmishGameInfoSnapshot',
      ]);
    });

    it('parses C++ SkirmishGameInfo xfer field order', () => {
      const source = `
void SkirmishGameInfo::xfer( Xfer *xfer )
{
  xfer->xferVersion( &version, currentVersion );
  xfer->xferInt(&m_preorderMask);
  xfer->xferInt(&m_crcInterval);
  xfer->xferBool(&m_inGame);
  xfer->xferBool(&m_inProgress);
  xfer->xferBool(&m_surrendered);
  xfer->xferInt(&m_gameID);
  xfer->xferInt(&slot);
  xfer->xferInt(&state);
  xfer->xferUnicodeString(&name);
  xfer->xferBool(&isAccepted);
  xfer->xferBool(&isMuted);
  xfer->xferInt(&color);
  xfer->xferInt(&startPos);
  xfer->xferInt(&playerTemplate);
  xfer->xferInt(&teamNumber);
  xfer->xferInt(&origColor);
  xfer->xferInt(&origStartPos);
  xfer->xferInt(&origPlayerTemplate);
  xfer->xferUnsignedInt(&m_localIP);
  xfer->xferMapName(&m_mapName);
  xfer->xferUnsignedInt(&m_mapCRC);
  xfer->xferUnsignedInt(&m_mapSize);
  xfer->xferInt(&m_mapMask);
  xfer->xferInt(&m_seed);
  xfer->xferUnsignedShort( &m_superweaponRestriction );
  xfer->xferBool( &obsoleteBool );
  xfer->xferSnapshot( &m_startingCash );
}  // end xfer`;
      const fields = parseCppSkirmishGameInfoXferFields(source);
      expect(fields).toEqual([
        'version',
        'preorderMask',
        'crcInterval',
        'inGame',
        'inProgress',
        'surrendered',
        'gameId',
        'slotCount',
        'slot.state',
        'slot.name',
        'slot.isAccepted',
        'slot.isMuted',
        'slot.color',
        'slot.startPos',
        'slot.playerTemplate',
        'slot.teamNumber',
        'slot.origColor',
        'slot.origStartPos',
        'slot.origPlayerTemplate',
        'localIp',
        'mapName',
        'mapCrc',
        'mapSize',
        'mapMask',
        'seed',
        'superweaponRestriction',
        'version3ObsoleteBool',
        'startingCash',
      ]);
    });

    it('parses TS SkirmishGameInfo xfer field order', () => {
      const source = `
function xferChallengeGameSlotState(xfer: Xfer): RuntimeSaveChallengeGameSlotState {
  const state = xfer.xferInt(slotState.state);
  const name = version >= 2 ? xfer.xferUnicodeString(slotState.name) : slotState.name;
  const isAccepted = xfer.xferBool(slotState.isAccepted);
  const isMuted = xfer.xferBool(slotState.isMuted);
  const color = xfer.xferInt(slotState.color);
  const startPos = xfer.xferInt(slotState.startPos);
  const playerTemplate = xfer.xferInt(slotState.playerTemplate);
  const teamNumber = xfer.xferInt(slotState.teamNumber);
  const origColor = xfer.xferInt(slotState.origColor);
  const origStartPos = xfer.xferInt(slotState.origStartPos);
  const origPlayerTemplate = xfer.xferInt(slotState.origPlayerTemplate);
}
function xferChallengeGameInfoState(xfer: Xfer): RuntimeSaveChallengeGameInfoState {
  const version = xfer.xferVersion(4);
  const preorderMask = xfer.xferInt(state.preorderMask);
  const crcInterval = xfer.xferInt(state.crcInterval);
  const inGame = xfer.xferBool(state.inGame);
  const inProgress = xfer.xferBool(state.inProgress);
  const surrendered = xfer.xferBool(state.surrendered);
  const gameId = xfer.xferInt(state.gameId);
  const slotCount = xfer.xferInt(state.slots.length);
  slots.push(xferChallengeGameSlotState(xfer));
  const localIp = xfer.xferUnsignedInt(state.localIp);
  const mapName = xfer.xferAsciiString(state.mapName);
  const mapCrc = xfer.xferUnsignedInt(state.mapCrc);
  const mapSize = xfer.xferUnsignedInt(state.mapSize);
  const mapMask = xfer.xferInt(state.mapMask);
  const seed = xfer.xferInt(state.seed);
  superweaponRestriction = xfer.xferUnsignedShort(superweaponRestriction);
  xfer.xferBool(false);
  startingCash = xferMoneyAmount(xfer, startingCash);
}`;
      const fields = parseTsSkirmishGameInfoXferFields(source);
      expect(fields).toEqual([
        'version',
        'preorderMask',
        'crcInterval',
        'inGame',
        'inProgress',
        'surrendered',
        'gameId',
        'slotCount',
        'slot.state',
        'slot.name',
        'slot.isAccepted',
        'slot.isMuted',
        'slot.color',
        'slot.startPos',
        'slot.playerTemplate',
        'slot.teamNumber',
        'slot.origColor',
        'slot.origStartPos',
        'slot.origPlayerTemplate',
        'localIp',
        'mapName',
        'mapCrc',
        'mapSize',
        'mapMask',
        'seed',
        'superweaponRestriction',
        'version3ObsoleteBool',
        'startingCash',
      ]);
    });

    it('parses TS damage type names', () => {
      const source = `
const SOURCE_DAMAGE_TYPE_NAMES: readonly string[] = [
  'EXPLOSION',
  'CRUSH',
  'ARMOR_PIERCING',
];`;
      const names = parseTsDamageTypeNames(source);
      expect(names).toEqual(['EXPLOSION', 'CRUSH', 'ARMOR_PIERCING']);
    });

    it('parses TS weapon bonus condition names', () => {
      const source = `
const WEAPON_BONUS_CONDITION_BY_NAME = new Map<string, number>([
  ['GARRISONED', 1],
  ['HORDE', 2],
  ['VETERAN', 4],
]);`;
      const names = parseTsWeaponBonusConditionNames(source);
      expect(names).toEqual(['GARRISONED', 'HORDE', 'VETERAN']);
    });
  });

  describe('comparisons', () => {
    it('detects matching damage types', () => {
      const result = compareDamageTypes(
        ['EXPLOSION', 'CRUSH', 'ARMOR_PIERCING'],
        ['EXPLOSION', 'CRUSH', 'ARMOR_PIERCING'],
      );
      expect(result.status).toBe('match');
      expect(result.mismatches).toHaveLength(0);
    });

    it('detects reordered damage types', () => {
      const result = compareDamageTypes(
        ['EXPLOSION', 'CRUSH'],
        ['CRUSH', 'EXPLOSION'],
      );
      expect(result.status).toBe('mismatch');
      expect(result.mismatches.length).toBe(2);
    });

    it('detects missing damage types', () => {
      const result = compareDamageTypes(
        ['EXPLOSION', 'CRUSH', 'ARMOR_PIERCING'],
        ['EXPLOSION', 'CRUSH'],
      );
      expect(result.status).toBe('mismatch');
      expect(result.mismatches.some((m) => m.message.includes('Missing in TS'))).toBe(true);
    });

    it('detects extra damage types in TS', () => {
      const result = compareDamageTypes(
        ['EXPLOSION'],
        ['EXPLOSION', 'EXTRA'],
      );
      expect(result.status).toBe('mismatch');
      expect(result.mismatches.some((m) => m.message.includes('Extra in TS'))).toBe(true);
    });

    it('detects matching save snapshot block order', () => {
      const result = compareSaveSnapshotBlockOrder(
        ['CHUNK_GameState', 'CHUNK_Campaign'],
        ['CHUNK_GameState', 'CHUNK_Campaign'],
      );
      expect(result.status).toBe('match');
      expect(result.mismatches).toEqual([]);
    });

    it('detects save metadata ABI reorderings', () => {
      const result = compareSaveGameInfoFields(
        ['saveFileType', 'missionMapName', 'date.year'],
        ['missionMapName', 'saveFileType', 'date.year'],
      );
      expect(result.status).toBe('mismatch');
      expect(result.mismatches).toHaveLength(2);
    });

    it('detects GameStateMap ABI reorderings', () => {
      const result = compareGameStateMapFields(
        ['version', 'saveGameMapPath', 'pristineMapPath'],
        ['version', 'pristineMapPath', 'saveGameMapPath'],
      );
      expect(result.status).toBe('mismatch');
      expect(result.mismatches).toHaveLength(2);
    });

    it('detects SkirmishGameInfo ABI reorderings', () => {
      const result = compareSkirmishGameInfoFields(
        ['version', 'preorderMask', 'crcInterval'],
        ['version', 'crcInterval', 'preorderMask'],
      );
      expect(result.status).toBe('mismatch');
      expect(result.mismatches).toHaveLength(2);
    });
  });

  describe('live source comparison', () => {
    it('parses actual C++ ZH damage types', async () => {
      const source = await readFileOrEmpty(
        path.join(repoRoot, 'GeneralsMD/Code/GameEngine/Source/GameLogic/System/Damage.cpp'),
      );
      if (!source) return; // skip if source not available
      const names = parseCppDamageTypeNames(source);
      expect(names.length).toBeGreaterThan(30);
      expect(names[0]).toBe('EXPLOSION');
      expect(names).toContain('SUBDUAL_MISSILE');
    });

    it('parses actual TS damage types', async () => {
      const source = await readFileOrEmpty(
        path.join(rootDir, 'packages/game-logic/src/index.ts'),
      );
      const names = parseTsDamageTypeNames(source);
      expect(names.length).toBeGreaterThan(20);
      expect(names[0]).toBe('EXPLOSION');
    });

    it('parses actual C++ ZH weapon field parse table', async () => {
      const source = await readFileOrEmpty(
        path.join(repoRoot, 'GeneralsMD/Code/GameEngine/Source/GameLogic/Object/Weapon.cpp'),
      );
      if (!source) return;
      const fields = parseCppWeaponFieldNames(source);
      expect(fields.length).toBeGreaterThan(30);
      expect(fields).toContain('PrimaryDamage');
      expect(fields).toContain('AttackRange');
      expect(fields).toContain('ClipSize');
    });

    it('parses actual C++ ZH weapon bonus names', async () => {
      const source = await readFileOrEmpty(
        path.join(repoRoot, 'GeneralsMD/Code/GameEngine/Include/GameLogic/Weapon.h'),
      );
      if (!source) return;
      const names = parseCppWeaponBonusNames(source);
      expect(names.length).toBeGreaterThan(10);
      expect(names).toContain('GARRISONED');
      expect(names).toContain('VETERAN');
    });

    it('runs full source parity check and generates report', async () => {
      const report = await runSourceParityCheck(rootDir);
      expect(report.summary.totalCategories).toBeGreaterThan(0);

      const damageCategory = report.categories.find((c) => c.category === 'damage-types');
      expect(damageCategory).toBeDefined();
      expect(damageCategory!.status).toBe('match');
      expect(damageCategory!.mismatches).toEqual([]);

      const saveBlockCategory = report.categories.find((c) => c.category === 'save-snapshot-block-order');
      expect(saveBlockCategory).toBeDefined();
      expect(saveBlockCategory!.status).toBe('match');

      const saveMetadataCategory = report.categories.find((c) => c.category === 'save-game-info-fields');
      expect(saveMetadataCategory).toBeDefined();
      expect(saveMetadataCategory!.status).toBe('match');

      const saveMapCategory = report.categories.find((c) => c.category === 'save-game-state-map-fields');
      expect(saveMapCategory).toBeDefined();
      expect(saveMapCategory!.status).toBe('match');

      const skirmishInfoCategory = report.categories.find((c) => c.category === 'save-skirmish-game-info-fields');
      expect(skirmishInfoCategory).toBeDefined();
      expect(skirmishInfoCategory!.status).toBe('match');
    });
  });
});
