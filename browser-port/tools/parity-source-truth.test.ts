import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  compareDamageTypes,
  compareSaveGameInfoFields,
  compareSaveSnapshotBlockOrder,
  parseCppDamageTypeNames,
  parseCppSaveGameInfoXferFields,
  parseCppSaveSnapshotBlockNames,
  parseCppWeaponBonusEnumValues,
  parseCppWeaponBonusNames,
  parseCppWeaponFieldNames,
  parseTsDamageTypeNames,
  parseTsSaveGameInfoXferFields,
  parseTsSaveSnapshotBlockNames,
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
    });
  });
});
