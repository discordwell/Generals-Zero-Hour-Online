import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  compareCampaignManagerFields,
  compareDamageTypes,
  compareGameStateMapFields,
  compareInGameUiFields,
  comparePartitionFields,
  comparePlayerListFields,
  compareRadarFields,
  compareSaveGameInfoFields,
  compareSaveSnapshotBlockOrder,
  compareSkirmishGameInfoFields,
  compareTacticalViewFields,
  compareTeamFactoryFields,
  compareTerrainLogicFields,
  parseCppCampaignManagerXferFields,
  parseCppDamageTypeNames,
  parseCppGameStateMapXferFields,
  parseCppInGameUiXferFields,
  parseCppPartitionXferFields,
  parseCppPlayerListXferFields,
  parseCppRadarXferFields,
  parseCppSaveGameInfoXferFields,
  parseCppSaveSnapshotBlockNames,
  parseCppSkirmishGameInfoXferFields,
  parseCppTacticalViewXferFields,
  parseCppTeamFactoryXferFields,
  parseCppTerrainLogicXferFields,
  parseCppWeaponBonusEnumValues,
  parseCppWeaponBonusNames,
  parseCppWeaponFieldNames,
  parseTsCampaignManagerXferFields,
  parseTsDamageTypeNames,
  parseTsGameStateMapXferFields,
  parseTsInGameUiXferFields,
  parseTsPartitionXferFields,
  parseTsPlayerListXferFields,
  parseTsRadarXferFields,
  parseTsSaveGameInfoXferFields,
  parseTsSaveSnapshotBlockNames,
  parseTsSkirmishGameInfoXferFields,
  parseTsTacticalViewXferFields,
  parseTsTeamFactoryXferFields,
  parseTsTerrainLogicXferFields,
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

    it('parses C++ CampaignManager xfer field order', () => {
      const source = `
void CampaignManager::xfer( Xfer *xfer )
{
  xfer->xferVersion( &version, currentVersion );
  xfer->xferAsciiString( &currentCampaign );
  xfer->xferAsciiString( &currentMission );
  xfer->xferInt( &m_currentRankPoints );
  xfer->xferUser( &m_difficulty, sizeof(m_difficulty) );
  xfer->xferBool(&isChallengeCampaign);
  xfer->xferSnapshot(TheChallengeGameInfo);
  xfer->xferInt(&playerTemplateNum);
}  // end xfer`;
      const fields = parseCppCampaignManagerXferFields(source);
      expect(fields).toEqual([
        'version',
        'currentCampaign',
        'currentMission',
        'currentRankPoints',
        'difficulty',
        'isChallengeCampaign',
        'challengeGameInfoSnapshot',
        'playerTemplateNum',
      ]);
    });

    it('parses TS CampaignSnapshot xfer field order', () => {
      const source = `
class CampaignSnapshot implements Snapshot {
  xfer(xfer: Xfer): void {
    const version = xfer.xferVersion(5);
    this.state.currentCampaign = xfer.xferAsciiString(this.state.currentCampaign);
    this.state.currentMission = xfer.xferAsciiString(this.state.currentMission);
    this.state.currentRankPoints = xfer.xferInt(this.state.currentRankPoints);
    this.state.difficulty = decodeSourceDifficulty(xfer.xferInt(encodeSourceDifficulty(this.state.difficulty)));
    this.state.isChallengeCampaign = xfer.xferBool(this.state.isChallengeCampaign);
    this.state.challengeGameInfoState = xferChallengeGameInfoState(xfer, this.state.challengeGameInfoState);
    this.state.playerTemplateNum = xfer.xferInt(this.state.playerTemplateNum);
  }
}
function createEmptyTerrainLogicSaveState() {}`;
      const fields = parseTsCampaignManagerXferFields(source);
      expect(fields).toEqual([
        'version',
        'currentCampaign',
        'currentMission',
        'currentRankPoints',
        'difficulty',
        'isChallengeCampaign',
        'challengeGameInfoSnapshot',
        'playerTemplateNum',
      ]);
    });

    it('parses C++ TerrainLogic xfer field order', () => {
      const source = `
void TerrainLogic::xfer( Xfer *xfer )
{
  xfer->xferVersion( &version, currentVersion );
  xfer->xferInt( &activeBoundary );
  xfer->xferInt( &m_numWaterToUpdate );
  xfer->xferInt( &triggerID );
  xfer->xferInt( &triggerID );
  xfer->xferReal( &m_waterToUpdate[ i ].changePerFrame );
  xfer->xferReal( &m_waterToUpdate[ i ].targetHeight );
  xfer->xferReal( &m_waterToUpdate[ i ].damageAmount );
  xfer->xferReal( &m_waterToUpdate[ i ].currentHeight );
}  // end xfer`;
      const fields = parseCppTerrainLogicXferFields(source);
      expect(fields).toEqual([
        'version',
        'activeBoundary',
        'waterUpdateCount',
        'waterUpdate.triggerId',
        'waterUpdate.changePerFrame',
        'waterUpdate.targetHeight',
        'waterUpdate.damageAmount',
        'waterUpdate.currentHeight',
      ]);
    });

    it('parses TS TerrainLogicSnapshot xfer field order', () => {
      const source = `
function xferSourceTerrainWaterUpdate(xfer: Xfer) {
  return {
    triggerId: xfer.xferInt(waterUpdate.triggerId),
    changePerFrame: xfer.xferReal(waterUpdate.changePerFrame),
    targetHeight: xfer.xferReal(waterUpdate.targetHeight),
    damageAmount: xfer.xferReal(waterUpdate.damageAmount),
    currentHeight: xfer.xferReal(waterUpdate.currentHeight),
  };
}
class TerrainLogicSnapshot implements Snapshot {
  xfer(xfer: Xfer): void {
    const version = xfer.xferVersion(2);
    payload.activeBoundary = xfer.xferInt(payload.activeBoundary);
    const waterUpdateCount = xfer.xferInt(payload.waterUpdates.length);
    waterUpdates.push(xferSourceTerrainWaterUpdate(xfer, waterUpdate));
  }
}
class TacticalViewSnapshot implements Snapshot {}`;
      const fields = parseTsTerrainLogicXferFields(source);
      expect(fields).toEqual([
        'version',
        'activeBoundary',
        'waterUpdateCount',
        'waterUpdate.triggerId',
        'waterUpdate.changePerFrame',
        'waterUpdate.targetHeight',
        'waterUpdate.damageAmount',
        'waterUpdate.currentHeight',
      ]);
    });

    it('parses C++ tactical View xfer field order', () => {
      const source = `
void View::xfer( Xfer *xfer )
{
  xfer->xferVersion( &version, currentVersion );
  xfer->xferReal( &angle );
  xfer->xferReal( &viewPos.x );
  xfer->xferReal( &viewPos.y );
  xfer->xferReal( &viewPos.z );
}  // end xfer`;
      const fields = parseCppTacticalViewXferFields(source);
      expect(fields).toEqual(['version', 'angle', 'position.x', 'position.y', 'position.z']);
    });

    it('parses TS TacticalViewSnapshot xfer field order', () => {
      const source = `
class TacticalViewSnapshot implements Snapshot {
  xfer(xfer: Xfer): void {
    const version = xfer.xferVersion(1);
    payload.angle = xfer.xferReal(payload.angle);
    payload.position.x = xfer.xferReal(payload.position.x);
    payload.position.y = xfer.xferReal(payload.position.y);
    payload.position.z = xfer.xferReal(payload.position.z);
  }
}
class InGameUiSnapshot implements Snapshot {}`;
      const fields = parseTsTacticalViewXferFields(source);
      expect(fields).toEqual(['version', 'angle', 'position.x', 'position.y', 'position.z']);
    });

    it('parses C++ InGameUI xfer field order', () => {
      const source = `
void InGameUI::xfer( Xfer *xfer )
{
  xfer->xferVersion( &version, currentVersion );
  xfer->xferInt(&m_namedTimerLastFlashFrame);
  xfer->xferBool(&m_namedTimerUsedFlashColor);
  xfer->xferBool(&m_showNamedTimers);
  xfer->xferInt( &timerCount );
  xfer->xferAsciiString( &(timerIter->second->m_timerName) );
  xfer->xferUnicodeString( &(timerIter->second->timerText) );
  xfer->xferBool( &(timerIter->second->isCountdown) );
  xfer->xferBool(&m_superweaponHiddenByScript);
  xfer->xferInt(&playerIndex);
  xfer->xferAsciiString(&templateName);
  xfer->xferAsciiString(&powerName);
  xfer->xferObjectID(&swInfo->m_id);
  xfer->xferUnsignedInt(&swInfo->m_timestamp);
  xfer->xferBool(&swInfo->m_hiddenByScript);
  xfer->xferBool(&swInfo->m_hiddenByScience);
  xfer->xferBool(&swInfo->m_ready);
  xfer->xferBool( &swInfo->m_evaReadyPlayed );
  xfer->xferInt(&noMorePlayers);
}  // end xfer`;
      const fields = parseCppInGameUiXferFields(source);
      expect(fields).toEqual([
        'version',
        'namedTimerLastFlashFrame',
        'namedTimerUsedFlashColor',
        'showNamedTimers',
        'namedTimerCount',
        'namedTimer.name',
        'namedTimer.text',
        'namedTimer.isCountdown',
        'superweaponHiddenByScript',
        'superweapon.playerIndex',
        'superweapon.templateName',
        'superweapon.powerName',
        'superweapon.objectId',
        'superweapon.timestamp',
        'superweapon.hiddenByScript',
        'superweapon.hiddenByScience',
        'superweapon.ready',
        'superweapon.evaReadyPlayed',
        'superweaponSentinel',
      ]);
    });

    it('parses TS InGameUiSnapshot xfer field order', () => {
      const source = `
class InGameUiSnapshot implements Snapshot {
  xfer(xfer: Xfer): void {
    const version = xfer.xferVersion(3);
    payload.namedTimerLastFlashFrame = xfer.xferInt(payload.namedTimerLastFlashFrame);
    payload.namedTimerUsedFlashColor = xfer.xferBool(payload.namedTimerUsedFlashColor);
    payload.showNamedTimers = xfer.xferBool(payload.showNamedTimers);
    xfer.xferInt(namedTimers.length);
    xfer.xferAsciiString(timer.timerName);
    xfer.xferUnicodeString(timer.timerText);
    xfer.xferBool(timer.isCountdown);
    payload.superweaponHiddenByScript = xfer.xferBool(payload.superweaponHiddenByScript);
    xfer.xferInt(superweapon.playerIndex);
    xfer.xferAsciiString(superweapon.templateName);
    xfer.xferAsciiString(superweapon.powerName);
    xfer.xferObjectID(superweapon.objectId);
    xfer.xferUnsignedInt(Math.max(0, superweapon.timestamp >>> 0));
    xfer.xferBool(superweapon.hiddenByScript);
    xfer.xferBool(superweapon.hiddenByScience);
    xfer.xferBool(superweapon.ready);
    xfer.xferBool(superweapon.evaReadyPlayed);
    xfer.xferInt(-1);
  }
}
class LegacyGameLogicSnapshot implements Snapshot {}`;
      const fields = parseTsInGameUiXferFields(source);
      expect(fields).toEqual([
        'version',
        'namedTimerLastFlashFrame',
        'namedTimerUsedFlashColor',
        'showNamedTimers',
        'namedTimerCount',
        'namedTimer.name',
        'namedTimer.text',
        'namedTimer.isCountdown',
        'superweaponHiddenByScript',
        'superweapon.playerIndex',
        'superweapon.templateName',
        'superweapon.powerName',
        'superweapon.objectId',
        'superweapon.timestamp',
        'superweapon.hiddenByScript',
        'superweapon.hiddenByScience',
        'superweapon.ready',
        'superweapon.evaReadyPlayed',
        'superweaponSentinel',
      ]);
    });

    it('parses C++ Radar xfer field order', () => {
      const source = `
void RadarObject::xfer( Xfer *xfer )
{
  xfer->xferVersion( &version, currentVersion );
  xfer->xferObjectID( &objectID );
  xfer->xferColor( &m_color );
}  // end xfer
static void xferRadarObjectList( Xfer *xfer, RadarObject **head )
{
  xfer->xferVersion( &version, currentVersion );
  xfer->xferUnsignedShort( &count );
  xfer->xferSnapshot( radarObject );
}  // end xferRadarObjectList
void Radar::xfer( Xfer *xfer )
{
  xfer->xferVersion( &version, currentVersion );
  xfer->xferBool( &m_radarHidden );
  xfer->xferBool( &m_radarForceOn );
  xferRadarObjectList( xfer, &m_localObjectList );
  xferRadarObjectList( xfer, &m_objectList );
  xfer->xferUnsignedShort( &eventCount );
  xfer->xferUser( &m_event[ i ].type, sizeof( RadarEventType ) );
  xfer->xferBool( &m_event[ i ].active );
  xfer->xferUnsignedInt( &m_event[ i ].createFrame );
  xfer->xferUnsignedInt( &m_event[ i ].dieFrame );
  xfer->xferUnsignedInt( &m_event[ i ].fadeFrame );
  xfer->xferRGBAColorInt( &m_event[ i ].color1 );
  xfer->xferRGBAColorInt( &m_event[ i ].color2 );
  xfer->xferCoord3D( &m_event[ i ].worldLoc );
  xfer->xferICoord2D( &m_event[ i ].radarLoc );
  xfer->xferBool( &m_event[ i ].soundPlayed );
  xfer->xferInt( &m_nextFreeRadarEvent );
  xfer->xferInt( &m_lastRadarEvent );
}  // end xfer`;
      const fields = parseCppRadarXferFields(source);
      expect(fields).toEqual([
        'version',
        'radarHidden',
        'radarForced',
        'localObjectList.version',
        'localObjectList.count',
        'localObjectList.object.version',
        'localObjectList.object.objectId',
        'localObjectList.object.color',
        'objectList.version',
        'objectList.count',
        'objectList.object.version',
        'objectList.object.objectId',
        'objectList.object.color',
        'eventCount',
        'event.type',
        'event.active',
        'event.createFrame',
        'event.dieFrame',
        'event.fadeFrame',
        'event.color1',
        'event.color2',
        'event.worldLoc',
        'event.radarLoc',
        'event.soundPlayed',
        'nextFreeRadarEvent',
        'lastRadarEvent',
      ]);
    });

    it('parses TS RadarSnapshot xfer field order', () => {
      const source = `
function xferSourceRadarObject(xfer: Xfer) {
  const version = xfer.xferVersion(1);
  return {
    objectId: xfer.xferObjectID(objectState.objectId),
    color: xfer.xferColor(objectState.color),
  };
}
function xferSourceRadarObjectList(xfer: Xfer) {
  const version = xfer.xferVersion(1);
  const count = xfer.xferUnsignedShort(objectList.length);
  xferSourceRadarObject(xfer, objectState);
}
function xferSourceRadarEvent(xfer: Xfer) {
  return {
    type: xfer.xferInt(eventState.type),
    active: xfer.xferBool(eventState.active),
    createFrame: xfer.xferUnsignedInt(eventState.createFrame),
    dieFrame: xfer.xferUnsignedInt(eventState.dieFrame),
    fadeFrame: xfer.xferUnsignedInt(eventState.fadeFrame),
    color1: xfer.xferRGBAColorInt(eventState.color1),
    color2: xfer.xferRGBAColorInt(eventState.color2),
    worldLoc: xfer.xferCoord3D(eventState.worldLoc),
    radarLoc: xfer.xferICoord2D(eventState.radarLoc),
    soundPlayed: xfer.xferBool(eventState.soundPlayed),
  };
}
class RadarSnapshot implements Snapshot {
  xfer(xfer: Xfer): void {
    const version = xfer.xferVersion(1);
    payload.radarHidden = xfer.xferBool(payload.radarHidden);
    payload.radarForced = xfer.xferBool(payload.radarForced);
    payload.localObjectList = xferSourceRadarObjectList(xfer, payload.localObjectList);
    payload.objectList = xferSourceRadarObjectList(xfer, payload.objectList);
    const eventCount = xfer.xferUnsignedShort(eventCountVerify);
    xferSourceRadarEvent(xfer, event);
    payload.nextFreeRadarEvent = xfer.xferInt(payload.nextFreeRadarEvent);
    payload.lastRadarEvent = xfer.xferInt(payload.lastRadarEvent);
  }
}
function buildScriptEngineNamedEventSlots() {}`;
      const fields = parseTsRadarXferFields(source);
      expect(fields).toEqual([
        'version',
        'radarHidden',
        'radarForced',
        'localObjectList.version',
        'localObjectList.count',
        'localObjectList.object.version',
        'localObjectList.object.objectId',
        'localObjectList.object.color',
        'objectList.version',
        'objectList.count',
        'objectList.object.version',
        'objectList.object.objectId',
        'objectList.object.color',
        'eventCount',
        'event.type',
        'event.active',
        'event.createFrame',
        'event.dieFrame',
        'event.fadeFrame',
        'event.color1',
        'event.color2',
        'event.worldLoc',
        'event.radarLoc',
        'event.soundPlayed',
        'nextFreeRadarEvent',
        'lastRadarEvent',
      ]);
    });

    it('parses C++ PartitionManager xfer field order', () => {
      const source = `
void PartitionCell::xfer( Xfer *xfer )
{
  xfer->xferVersion( &version, currentVersion );
  xfer->xferUser( &m_shroudLevel, sizeof( ShroudLevel ) * MAX_PLAYER_COUNT );
}  // end xfer
void SightingInfo::xfer( Xfer *xfer )
{
  xfer->xferVersion( &version, currentVersion );
  xfer->xferCoord3D( &m_where );
  xfer->xferReal( &m_howFar );
  xfer->xferUser( &m_forWhom, sizeof( PlayerMaskType ) );
  xfer->xferUnsignedInt( &m_data );
}  // end xfer
void PartitionManager::xfer( Xfer *xfer )
{
  xfer->xferVersion( &version, currentVersion );
  xfer->xferReal( &cellSize );
  xfer->xferInt( &totalCellCount );
  xfer->xferSnapshot( cell );
  xfer->xferInt(&queueSize);
  xfer->xferSnapshot(newInfo);
  xfer->xferSnapshot(saveInfo);
}  // end xfer`;
      const fields = parseCppPartitionXferFields(source);
      expect(fields).toEqual([
        'version',
        'cellSize',
        'totalCellCount',
        'cell.version',
        'cell.shroudLevel.currentShroud',
        'cell.shroudLevel.activeShroudLevel',
        'undoRevealCount',
        'undoReveal.version',
        'undoReveal.where',
        'undoReveal.howFar',
        'undoReveal.forWhom',
        'undoReveal.data',
      ]);
    });

    it('parses TS PartitionSnapshot xfer field order', () => {
      const source = `
function xferSourcePartitionShroudLevel(xfer: Xfer) {
  return {
    currentShroud: xfer.xferShort(level.currentShroud),
    activeShroudLevel: xfer.xferShort(level.activeShroudLevel),
  };
}
function xferSourcePartitionUndoReveal(xfer: Xfer) {
  const version = xfer.xferVersion(1);
  return {
    where: xfer.xferCoord3D(reveal.where),
    howFar: xfer.xferReal(reveal.howFar),
    forWhom: xfer.xferUnsignedShort(reveal.forWhom),
    data: xfer.xferUnsignedInt(reveal.data),
  };
}
class PartitionSnapshot implements Snapshot {
  xfer(xfer: Xfer): void {
    const version = xfer.xferVersion(SOURCE_PARTITION_SNAPSHOT_VERSION);
    payload.cellSize = xfer.xferReal(payload.cellSize);
    payload.totalCellCount = xfer.xferInt(payload.totalCellCount);
    xfer.xferVersion(SOURCE_PARTITION_CELL_SNAPSHOT_VERSION);
    xferSourcePartitionShroudLevel(xfer, level);
    const queueSize = xfer.xferInt(payload.pendingUndoShroudReveals.length);
    xferSourcePartitionUndoReveal(xfer, reveal);
  }
}
function xferNullableObjectId() {}`;
      const fields = parseTsPartitionXferFields(source);
      expect(fields).toEqual([
        'version',
        'cellSize',
        'totalCellCount',
        'cell.version',
        'cell.shroudLevel.currentShroud',
        'cell.shroudLevel.activeShroudLevel',
        'undoRevealCount',
        'undoReveal.version',
        'undoReveal.where',
        'undoReveal.howFar',
        'undoReveal.forWhom',
        'undoReveal.data',
      ]);
    });

    it('parses TeamFactory top-level xfer field order', () => {
      const cppSource = `
void TeamFactory::xfer( Xfer *xfer )
{
  xfer->xferVersion( &version, currentVersion );
  xfer->xferUser( &m_uniqueTeamID, sizeof( TeamID ) );
  xfer->xferUnsignedShort( &prototypeCount );
  xfer->xferUser( &teamPrototypeID, sizeof( TeamPrototypeID ) );
  xfer->xferSnapshot( teamPrototype );
}  // end xfer`;
      const tsSource = `
class SourceTeamFactorySnapshot implements Snapshot {
  xfer(xfer: Xfer): void {
    const version = xfer.xferVersion(SOURCE_TEAM_FACTORY_SNAPSHOT_VERSION);
    const nextTeamId = xfer.xferUnsignedInt(normalizePositiveInt(this.state.state.scriptNextSourceTeamId, 1));
    const prototypeCount = xfer.xferUnsignedShort(prototypeOrder.length);
    const prototypeId = xfer.xferUnsignedInt(normalizePositiveInt(prototypeRecord.sourcePrototypeId, index + 1));
    xfer.xferSnapshot(new SourceTeamPrototypeSnapshot());
  }
}
export function buildSourceTeamFactoryChunk() {}`;
      expect(parseCppTeamFactoryXferFields(cppSource)).toEqual([
        'version',
        'uniqueTeamId',
        'prototypeCount',
        'prototype.id',
        'prototype.snapshot',
      ]);
      expect(parseTsTeamFactoryXferFields(tsSource)).toEqual([
        'version',
        'uniqueTeamId',
        'prototypeCount',
        'prototype.id',
        'prototype.snapshot',
      ]);
    });

    it('parses PlayerList top-level xfer field order', () => {
      const cppSource = `
void PlayerList::xfer( Xfer *xfer )
{
  xfer->xferVersion( &version, currentVersion );
  xfer->xferInt( &playerCount );
  xfer->xferSnapshot( m_players[ i ] );
}  // end xfer`;
      const tsSource = `
class SourcePlayersSnapshot implements Snapshot {
  xfer(xfer: Xfer): void {
    const version = xfer.xferVersion(SOURCE_PLAYERS_LIST_SNAPSHOT_VERSION);
    const playerCount = xfer.xferInt(resolveSourcePlayersCount(this.payload, this.mapData));
    const playerVersion = xfer.xferVersion(SOURCE_PLAYER_ENTRY_SNAPSHOT_VERSION);
  }
}
class LegacyPlayersSnapshot implements Snapshot {}`;
      expect(parseCppPlayerListXferFields(cppSource)).toEqual([
        'version',
        'playerCount',
        'player.snapshot',
      ]);
      expect(parseTsPlayerListXferFields(tsSource)).toEqual([
        'version',
        'playerCount',
        'player.snapshot',
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

    it('detects CampaignManager ABI reorderings', () => {
      const result = compareCampaignManagerFields(
        ['version', 'currentCampaign', 'currentMission'],
        ['version', 'currentMission', 'currentCampaign'],
      );
      expect(result.status).toBe('mismatch');
      expect(result.mismatches).toHaveLength(2);
    });

    it('detects TerrainLogic ABI reorderings', () => {
      const result = compareTerrainLogicFields(
        ['version', 'activeBoundary', 'waterUpdateCount'],
        ['version', 'waterUpdateCount', 'activeBoundary'],
      );
      expect(result.status).toBe('mismatch');
      expect(result.mismatches).toHaveLength(2);
    });

    it('detects TacticalView ABI reorderings', () => {
      const result = compareTacticalViewFields(
        ['version', 'angle', 'position.x'],
        ['version', 'position.x', 'angle'],
      );
      expect(result.status).toBe('mismatch');
      expect(result.mismatches).toHaveLength(2);
    });

    it('detects InGameUI ABI reorderings', () => {
      const result = compareInGameUiFields(
        ['version', 'namedTimerCount', 'superweaponSentinel'],
        ['version', 'superweaponSentinel', 'namedTimerCount'],
      );
      expect(result.status).toBe('mismatch');
      expect(result.mismatches).toHaveLength(2);
    });

    it('detects Radar ABI reorderings', () => {
      const result = compareRadarFields(
        ['version', 'radarHidden', 'radarForced'],
        ['version', 'radarForced', 'radarHidden'],
      );
      expect(result.status).toBe('mismatch');
      expect(result.mismatches).toHaveLength(2);
    });

    it('detects Partition ABI reorderings', () => {
      const result = comparePartitionFields(
        ['version', 'cellSize', 'totalCellCount'],
        ['version', 'totalCellCount', 'cellSize'],
      );
      expect(result.status).toBe('mismatch');
      expect(result.mismatches).toHaveLength(2);
    });

    it('detects TeamFactory ABI reorderings', () => {
      const result = compareTeamFactoryFields(
        ['version', 'uniqueTeamId', 'prototypeCount'],
        ['version', 'prototypeCount', 'uniqueTeamId'],
      );
      expect(result.status).toBe('mismatch');
      expect(result.mismatches).toHaveLength(2);
    });

    it('detects PlayerList ABI reorderings', () => {
      const result = comparePlayerListFields(
        ['version', 'playerCount', 'player.snapshot'],
        ['version', 'player.snapshot', 'playerCount'],
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

      const campaignCategory = report.categories.find((c) => c.category === 'save-campaign-manager-fields');
      expect(campaignCategory).toBeDefined();
      expect(campaignCategory!.status).toBe('match');

      const terrainLogicCategory = report.categories.find((c) => c.category === 'save-terrain-logic-fields');
      expect(terrainLogicCategory).toBeDefined();
      expect(terrainLogicCategory!.status).toBe('match');

      const tacticalViewCategory = report.categories.find((c) => c.category === 'save-tactical-view-fields');
      expect(tacticalViewCategory).toBeDefined();
      expect(tacticalViewCategory!.status).toBe('match');

      const inGameUiCategory = report.categories.find((c) => c.category === 'save-in-game-ui-fields');
      expect(inGameUiCategory).toBeDefined();
      expect(inGameUiCategory!.status).toBe('match');

      const gameLogicObjectTocCategory = report.categories.find((c) =>
        c.category === 'save-game-logic-object-toc-fields');
      expect(gameLogicObjectTocCategory).toBeDefined();
      expect(gameLogicObjectTocCategory!.status).toBe('match');

      const buildAssistantSellListCategory = report.categories.find((c) =>
        c.category === 'save-build-assistant-sell-list-fields');
      expect(buildAssistantSellListCategory).toBeDefined();
      expect(buildAssistantSellListCategory!.status).toBe('match');

      const gameLogicBuildableOverrideCategory = report.categories.find((c) =>
        c.category === 'save-game-logic-buildable-overrides-fields');
      expect(gameLogicBuildableOverrideCategory).toBeDefined();
      expect(gameLogicBuildableOverrideCategory!.status).toBe('match');

      const gameLogicControlBarOverrideCategory = report.categories.find((c) =>
        c.category === 'save-game-logic-control-bar-overrides-fields');
      expect(gameLogicControlBarOverrideCategory).toBeDefined();
      expect(gameLogicControlBarOverrideCategory!.status).toBe('match');

      const gameLogicCategory = report.categories.find((c) => c.category === 'save-game-logic-fields');
      expect(gameLogicCategory).toBeDefined();
      expect(gameLogicCategory!.status).toBe('match');

      const objectModuleListCategory = report.categories.find((c) =>
        c.category === 'save-object-module-list-fields');
      expect(objectModuleListCategory).toBeDefined();
      expect(objectModuleListCategory!.status).toBe('match');

      const objectCategory = report.categories.find((c) => c.category === 'save-object-fields');
      expect(objectCategory).toBeDefined();
      expect(objectCategory!.status).toBe('match');

      const matrix3dCategory = report.categories.find((c) => c.category === 'save-matrix3d-fields');
      expect(matrix3dCategory).toBeDefined();
      expect(matrix3dCategory!.status).toBe('match');

      const geometryInfoCategory = report.categories.find((c) => c.category === 'save-geometry-info-fields');
      expect(geometryInfoCategory).toBeDefined();
      expect(geometryInfoCategory!.status).toBe('match');

      const sightingInfoCategory = report.categories.find((c) => c.category === 'save-sighting-info-fields');
      expect(sightingInfoCategory).toBeDefined();
      expect(sightingInfoCategory!.status).toBe('match');

      const experienceTrackerCategory = report.categories.find((c) => c.category === 'save-experience-tracker-fields');
      expect(experienceTrackerCategory).toBeDefined();
      expect(experienceTrackerCategory!.status).toBe('match');

      const bitFlagsCategory = report.categories.find((c) => c.category === 'save-bit-flags-fields');
      expect(bitFlagsCategory).toBeDefined();
      expect(bitFlagsCategory!.status).toBe('match');

      const weaponCategory = report.categories.find((c) => c.category === 'save-weapon-fields');
      expect(weaponCategory).toBeDefined();
      expect(weaponCategory!.status).toBe('match');

      const weaponSetCategory = report.categories.find((c) => c.category === 'save-weapon-set-fields');
      expect(weaponSetCategory).toBeDefined();
      expect(weaponSetCategory!.status).toBe('match');

      const drawableCategory = report.categories.find((c) => c.category === 'save-drawable-fields');
      expect(drawableCategory).toBeDefined();
      expect(drawableCategory!.status).toBe('match');

      const gameClientCategory = report.categories.find((c) => c.category === 'save-game-client-fields');
      expect(gameClientCategory).toBeDefined();
      expect(gameClientCategory!.status).toBe('match');

      const particleSystemManagerCategory = report.categories.find((c) =>
        c.category === 'save-particle-system-manager-fields');
      expect(particleSystemManagerCategory).toBeDefined();
      expect(particleSystemManagerCategory!.status).toBe('match');

      const particleSystemInfoCategory = report.categories.find((c) =>
        c.category === 'save-particle-system-info-fields');
      expect(particleSystemInfoCategory).toBeDefined();
      expect(particleSystemInfoCategory!.status).toBe('match');

      const particleSystemCategory = report.categories.find((c) => c.category === 'save-particle-system-fields');
      expect(particleSystemCategory).toBeDefined();
      expect(particleSystemCategory!.status).toBe('match');

      const particleCategory = report.categories.find((c) => c.category === 'save-particle-fields');
      expect(particleCategory).toBeDefined();
      expect(particleCategory!.status).toBe('match');

      for (const category of [
        'save-module-base-fields',
        'save-object-module-base-fields',
        'save-drawable-module-base-fields',
        'save-draw-module-base-fields',
        'save-behavior-module-base-fields',
        'save-update-module-base-fields',
        'save-body-module-base-fields',
        'save-collide-module-base-fields',
        'save-die-module-base-fields',
        'save-damage-module-base-fields',
        'save-create-module-fields',
        'save-special-power-module-fields',
        'save-w3d-draw-base-only-fields',
        'save-w3d-model-draw-fields',
        'save-w3d-tank-draw-fields',
        'save-w3d-truck-draw-fields',
        'save-w3d-tank-truck-draw-fields',
        'save-w3d-overlord-aircraft-draw-fields',
        'save-w3d-science-model-draw-fields',
        'save-w3d-supply-draw-fields',
        'save-w3d-overlord-tank-draw-fields',
        'save-w3d-overlord-truck-draw-fields',
        'save-w3d-police-car-draw-fields',
        'save-w3d-dependency-model-draw-fields',
        'save-w3d-debris-draw-fields',
        'save-w3d-rope-draw-fields',
        'save-animated-particle-sys-bone-client-update-fields',
        'save-sway-client-update-fields',
        'save-laser-update-fields',
        'save-beacon-client-update-fields',
        'save-weapon-bonus-update-fields',
        'save-power-plant-update-fields',
        'save-ocl-update-fields',
        'save-enemy-near-update-fields',
        'save-horde-update-fields',
        'save-prone-update-fields',
        'save-fire-ocl-after-weapon-cooldown-update-fields',
        'save-auto-find-healing-update-fields',
        'save-radius-decal-update-fields',
        'save-base-regenerate-update-fields',
        'save-lifetime-update-fields',
        'save-deletion-update-fields',
        'save-height-die-update-fields',
        'save-sticky-bomb-update-fields',
        'save-cleanup-hazard-update-fields',
        'save-demo-trap-update-fields',
        'save-command-button-hunt-update-fields',
        'save-auto-deposit-update-fields',
        'save-dynamic-shroud-clearing-range-update-fields',
        'save-stealth-update-fields',
        'save-stealth-detector-update-fields',
        'save-wave-guide-update-fields',
        'save-projectile-stream-update-fields',
        'save-bone-fx-update-fields',
        'save-flammable-update-fields',
        'save-fire-spread-update-fields',
        'save-dynamic-geometry-info-update-fields',
        'save-firestorm-dynamic-geometry-info-update-fields',
        'save-smart-bomb-target-homing-update-fields',
        'save-animation-steering-update-fields',
        'save-assisted-targeting-update-fields',
        'save-float-update-fields',
        'save-tensile-formation-update-fields',
        'save-pilot-find-vehicle-update-fields',
        'save-open-contain-fields',
        'save-transport-contain-fields',
        'save-parachute-contain-fields',
        'save-internet-hack-contain-fields',
        'save-railed-transport-contain-fields',
        'save-overlord-contain-fields',
        'save-helix-contain-fields',
        'save-heal-contain-fields',
        'save-tunnel-contain-fields',
        'save-cave-contain-fields',
        'save-mob-nexus-contain-fields',
        'save-rider-change-contain-fields',
        'save-physics-behavior-fields',
        'save-railroad-behavior-fields',
        'save-dumb-projectile-behavior-fields',
        'save-rebuild-hole-behavior-fields',
        'save-propaganda-tower-behavior-fields',
        'save-auto-heal-behavior-fields',
        'save-grant-stealth-behavior-fields',
        'save-countermeasures-behavior-fields',
        'save-overcharge-behavior-fields',
        'save-fire-weapon-when-damaged-behavior-fields',
        'save-fire-weapon-when-dead-behavior-fields',
        'save-poisoned-behavior-fields',
        'save-minefield-behavior-fields',
        'save-generate-minefield-behavior-fields',
        'save-bridge-scaffold-behavior-fields',
        'save-bridge-behavior-fields',
        'save-bridge-tower-behavior-fields',
        'save-parking-place-behavior-fields',
        'save-flight-deck-behavior-fields',
        'save-slow-death-behavior-fields',
        'save-battle-bus-slow-death-behavior-fields',
        'save-helicopter-slow-death-behavior-fields',
        'save-jet-slow-death-behavior-fields',
        'save-neutron-missile-slow-death-behavior-fields',
        'save-supply-warehouse-crippling-behavior-fields',
        'save-spawn-behavior-fields',
        'save-leaflet-drop-behavior-fields',
        'save-tech-building-behavior-fields',
        'save-bunker-buster-behavior-fields',
        'save-neutron-blast-behavior-fields',
        'save-pow-truck-behavior-fields',
        'save-instant-death-behavior-fields',
        'save-prison-behavior-fields',
        'save-propaganda-center-behavior-fields',
        'save-point-defense-laser-update-fields',
        'save-emp-update-fields',
        'save-radar-update-fields',
        'save-checkpoint-update-fields',
        'save-hijacker-update-fields',
        'save-missile-launcher-building-update-fields',
        'save-structure-collapse-update-fields',
        'save-supply-center-dock-update-fields',
        'save-prison-dock-update-fields',
        'save-supply-warehouse-dock-update-fields',
        'save-repair-dock-update-fields',
        'save-railed-transport-dock-update-fields',
        'save-default-production-exit-update-fields',
        'save-supply-center-production-exit-update-fields',
        'save-queue-production-exit-update-fields',
        'save-spawn-point-production-exit-update-fields',
        'save-fire-weapon-update-fields',
        'save-production-update-fields',
        'save-battle-plan-update-fields',
        'save-slaved-update-fields',
        'save-mob-member-slaved-update-fields',
        'save-neutron-missile-update-fields',
        'save-topple-update-fields',
        'save-structure-topple-update-fields',
        'save-spectre-gunship-deployment-update-fields',
        'save-spectre-gunship-update-fields',
        'save-special-ability-update-fields',
        'save-special-power-update-module-fields',
        'save-particle-uplink-cannon-update-fields',
        'save-wander-ai-update-fields',
        'save-transport-ai-update-fields',
        'save-ai-update-interface-fields',
        'save-deploy-style-ai-update-fields',
        'save-assault-transport-ai-update-fields',
        'save-chinook-ai-update-fields',
        'save-deliver-payload-ai-update-fields',
        'save-deliver-payload-state-machine-fields',
        'save-deliver-payload-delivering-state-fields',
        'save-deliver-payload-consider-new-approach-state-fields',
        'save-deliver-payload-recover-from-off-map-state-fields',
        'save-hack-internet-ai-update-fields',
        'save-hack-internet-unpacking-state-fields',
        'save-hack-internet-packing-state-fields',
        'save-hack-internet-hack-state-fields',
        'save-jet-ai-update-fields',
        'save-missile-ai-update-fields',
        'save-dozer-ai-update-fields',
        'save-dozer-action-state-machine-fields',
        'save-dozer-primary-idle-state-fields',
        'save-dozer-action-state-fields',
        'save-dozer-primary-state-machine-fields',
        'save-worker-ai-update-fields',
        'save-worker-state-machine-fields',
        'save-supply-truck-ai-update-fields',
        'save-supply-truck-state-machine-fields',
        'save-pow-truck-ai-update-fields',
        'save-railed-transport-ai-update-fields',
        'save-spy-vision-update-fields',
      ]) {
        const moduleCategory = report.categories.find((c) => c.category === category);
        expect(moduleCategory).toBeDefined();
        expect(moduleCategory!.status).toBe('match');
      }

      const terrainVisualCategory = report.categories.find((c) => c.category === 'save-terrain-visual-fields');
      expect(terrainVisualCategory).toBeDefined();
      expect(terrainVisualCategory!.status).toBe('match');

      const waterRenderCategory = report.categories.find((c) => c.category === 'save-water-render-object-fields');
      expect(waterRenderCategory).toBeDefined();
      expect(waterRenderCategory!.status).toBe('match');

      const heightMapRenderCategory = report.categories.find((c) => c.category === 'save-height-map-render-object-fields');
      expect(heightMapRenderCategory).toBeDefined();
      expect(heightMapRenderCategory!.status).toBe('match');

      const w3dTreeBufferCategory = report.categories.find((c) => c.category === 'save-w3d-tree-buffer-fields');
      expect(w3dTreeBufferCategory).toBeDefined();
      expect(w3dTreeBufferCategory!.status).toBe('match');

      const w3dPropBufferCategory = report.categories.find((c) => c.category === 'save-w3d-prop-buffer-fields');
      expect(w3dPropBufferCategory).toBeDefined();
      expect(w3dPropBufferCategory!.status).toBe('match');

      const ghostObjectManagerCategory = report.categories.find(
        (c) => c.category === 'save-ghost-object-manager-fields',
      );
      expect(ghostObjectManagerCategory).toBeDefined();
      expect(ghostObjectManagerCategory!.status).toBe('match');

      const ghostObjectCategory = report.categories.find((c) => c.category === 'save-ghost-object-fields');
      expect(ghostObjectCategory).toBeDefined();
      expect(ghostObjectCategory!.status).toBe('match');

      const w3dRenderObjectCategory = report.categories.find(
        (c) => c.category === 'save-w3d-render-object-snapshot-fields',
      );
      expect(w3dRenderObjectCategory).toBeDefined();
      expect(w3dRenderObjectCategory!.status).toBe('match');

      const radarCategory = report.categories.find((c) => c.category === 'save-radar-fields');
      expect(radarCategory).toBeDefined();
      expect(radarCategory!.status).toBe('match');

      const partitionCategory = report.categories.find((c) => c.category === 'save-partition-fields');
      expect(partitionCategory).toBeDefined();
      expect(partitionCategory!.status).toBe('match');

      const teamFactoryCategory = report.categories.find((c) => c.category === 'save-team-factory-fields');
      expect(teamFactoryCategory).toBeDefined();
      expect(teamFactoryCategory!.status).toBe('match');

      const playerListCategory = report.categories.find((c) => c.category === 'save-player-list-fields');
      expect(playerListCategory).toBeDefined();
      expect(playerListCategory!.status).toBe('match');

      const playerCategory = report.categories.find((c) => c.category === 'save-player-fields');
      expect(playerCategory).toBeDefined();
      expect(playerCategory!.status).toBe('match');

      const moneyCategory = report.categories.find((c) => c.category === 'save-money-fields');
      expect(moneyCategory).toBeDefined();
      expect(moneyCategory!.status).toBe('match');

      const energyCategory = report.categories.find((c) => c.category === 'save-energy-fields');
      expect(energyCategory).toBeDefined();
      expect(energyCategory!.status).toBe('match');

      const scoreKeeperCategory = report.categories.find((c) => c.category === 'save-score-keeper-fields');
      expect(scoreKeeperCategory).toBeDefined();
      expect(scoreKeeperCategory!.status).toBe('match');

      const objectIdListCategory = report.categories.find((c) => c.category === 'save-object-id-list-fields');
      expect(objectIdListCategory).toBeDefined();
      expect(objectIdListCategory!.status).toBe('match');

      const scienceVectorCategory = report.categories.find((c) => c.category === 'save-science-vector-fields');
      expect(scienceVectorCategory).toBeDefined();
      expect(scienceVectorCategory!.status).toBe('match');

      const upgradeCategory = report.categories.find((c) => c.category === 'save-upgrade-fields');
      expect(upgradeCategory).toBeDefined();
      expect(upgradeCategory!.status).toBe('match');

      const playerRelationMapCategory = report.categories.find((c) => c.category === 'save-player-relation-map-fields');
      expect(playerRelationMapCategory).toBeDefined();
      expect(playerRelationMapCategory!.status).toBe('match');

      const teamRelationMapCategory = report.categories.find((c) => c.category === 'save-team-relation-map-fields');
      expect(teamRelationMapCategory).toBeDefined();
      expect(teamRelationMapCategory!.status).toBe('match');

      const sourceScriptCategory = report.categories.find((c) => c.category === 'save-source-script-fields');
      expect(sourceScriptCategory).toBeDefined();
      expect(sourceScriptCategory!.status).toBe('match');

      const sourceScriptGroupCategory = report.categories.find((c) =>
        c.category === 'save-source-script-group-fields');
      expect(sourceScriptGroupCategory).toBeDefined();
      expect(sourceScriptGroupCategory!.status).toBe('match');

      const sourceScriptListCategory = report.categories.find((c) => c.category === 'save-source-script-list-fields');
      expect(sourceScriptListCategory).toBeDefined();
      expect(sourceScriptListCategory!.status).toBe('match');

      const sidesListCategory = report.categories.find((c) => c.category === 'save-sides-list-fields');
      expect(sidesListCategory).toBeDefined();
      expect(sidesListCategory!.status).toBe('match');

      const buildListInfoCategory = report.categories.find((c) => c.category === 'save-build-list-info-fields');
      expect(buildListInfoCategory).toBeDefined();
      expect(buildListInfoCategory!.status).toBe('match');

      const resourceGatheringCategory = report.categories.find((c) =>
        c.category === 'save-resource-gathering-manager-fields');
      expect(resourceGatheringCategory).toBeDefined();
      expect(resourceGatheringCategory!.status).toBe('match');

      const tunnelTrackerCategory = report.categories.find((c) => c.category === 'save-tunnel-tracker-fields');
      expect(tunnelTrackerCategory).toBeDefined();
      expect(tunnelTrackerCategory!.status).toBe('match');

      const squadCategory = report.categories.find((c) => c.category === 'save-squad-fields');
      expect(squadCategory).toBeDefined();
      expect(squadCategory!.status).toBe('match');

      const workOrderCategory = report.categories.find((c) => c.category === 'save-work-order-fields');
      expect(workOrderCategory).toBeDefined();
      expect(workOrderCategory!.status).toBe('match');

      const teamInQueueCategory = report.categories.find((c) => c.category === 'save-team-in-queue-fields');
      expect(teamInQueueCategory).toBeDefined();
      expect(teamInQueueCategory!.status).toBe('match');

      const aiPlayerCategory = report.categories.find((c) => c.category === 'save-ai-player-fields');
      expect(aiPlayerCategory).toBeDefined();
      expect(aiPlayerCategory!.status).toBe('match');

      const aiSkirmishPlayerCategory = report.categories.find((c) =>
        c.category === 'save-ai-skirmish-player-fields');
      expect(aiSkirmishPlayerCategory).toBeDefined();
      expect(aiSkirmishPlayerCategory!.status).toBe('match');

      const sequentialScriptCategory = report.categories.find((c) =>
        c.category === 'save-script-engine-sequential-script-fields');
      expect(sequentialScriptCategory).toBeDefined();
      expect(sequentialScriptCategory!.status).toBe('match');

      const attackPriorityCategory = report.categories.find((c) =>
        c.category === 'save-script-engine-attack-priority-fields');
      expect(attackPriorityCategory).toBeDefined();
      expect(attackPriorityCategory!.status).toBe('match');

      const scriptEngineBreezeCategory = report.categories.find((c) =>
        c.category === 'save-script-engine-breeze-fields');
      expect(scriptEngineBreezeCategory).toBeDefined();
      expect(scriptEngineBreezeCategory!.status).toBe('match');

      const scriptEngineStringListCategory = report.categories.find((c) =>
        c.category === 'save-script-engine-string-list-fields');
      expect(scriptEngineStringListCategory).toBeDefined();
      expect(scriptEngineStringListCategory!.status).toBe('match');

      const scriptEngineStringUIntListCategory = report.categories.find((c) =>
        c.category === 'save-script-engine-string-uint-list-fields');
      expect(scriptEngineStringUIntListCategory).toBeDefined();
      expect(scriptEngineStringUIntListCategory!.status).toBe('match');

      const scriptEngineStringObjectIdListCategory = report.categories.find((c) =>
        c.category === 'save-script-engine-string-object-id-list-fields');
      expect(scriptEngineStringObjectIdListCategory).toBeDefined();
      expect(scriptEngineStringObjectIdListCategory!.status).toBe('match');

      const scriptEngineNamedObjectCategory = report.categories.find((c) =>
        c.category === 'save-script-engine-named-object-fields');
      expect(scriptEngineNamedObjectCategory).toBeDefined();
      expect(scriptEngineNamedObjectCategory!.status).toBe('match');

      const scriptEngineScienceVectorCategory = report.categories.find((c) =>
        c.category === 'save-script-engine-science-vector-fields');
      expect(scriptEngineScienceVectorCategory).toBeDefined();
      expect(scriptEngineScienceVectorCategory!.status).toBe('match');

      const scriptEngineObjectTypeListCategory = report.categories.find((c) =>
        c.category === 'save-script-engine-object-type-list-fields');
      expect(scriptEngineObjectTypeListCategory).toBeDefined();
      expect(scriptEngineObjectTypeListCategory!.status).toBe('match');

      const scriptEngineStringCoordListCategory = report.categories.find((c) =>
        c.category === 'save-script-engine-string-coord-list-fields');
      expect(scriptEngineStringCoordListCategory).toBeDefined();
      expect(scriptEngineStringCoordListCategory!.status).toBe('match');

      const teamTemplateInfoCategory = report.categories.find((c) => c.category === 'save-team-template-info-fields');
      expect(teamTemplateInfoCategory).toBeDefined();
      expect(teamTemplateInfoCategory!.status).toBe('match');

      const teamPrototypeCategory = report.categories.find((c) => c.category === 'save-team-prototype-fields');
      expect(teamPrototypeCategory).toBeDefined();
      expect(teamPrototypeCategory!.status).toBe('match');

      const teamCategory = report.categories.find((c) => c.category === 'save-team-fields');
      expect(teamCategory).toBeDefined();
      expect(teamCategory!.status).toBe('match');
    });
  });
});
