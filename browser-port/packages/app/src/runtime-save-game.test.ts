import { describe, expect, it } from 'vitest';
import { XferLoad, XferMode, XferSave, listSaveGameChunks, type Coord3D, type Xfer } from '@generals/engine';
import {
  buildSourceMapEntityChunk,
  createEmptySourceMapEntitySaveState,
  parseSourceMapEntityChunk,
} from '@generals/game-logic';
import * as THREE from 'three';

import {
  buildRuntimeSaveFile,
  inspectGameLogicChunkLayout,
  inspectRuntimeSaveCoreChunkStatus,
  parseSourceSidesListChunk,
  parseRuntimeSaveFile,
  SOURCE_GAME_MODE_SINGLE_PLAYER,
  type RuntimeSaveChallengeGameInfoState,
} from './runtime-save-game.js';
import {
  applySourceTeamFactoryChunkToState,
  buildSourceTeamFactoryChunk,
} from './runtime-team-factory-save.js';

function createEmptyRadarEvent() {
  return {
    type: 0,
    active: false,
    createFrame: 0,
    dieFrame: 0,
    fadeFrame: 0,
    color1: { red: 0, green: 0, blue: 0, alpha: 0 },
    color2: { red: 0, green: 0, blue: 0, alpha: 0 },
    worldLoc: { x: 0, y: 0, z: 0 },
    radarLoc: { x: 0, y: 0 },
    soundPlayed: false,
    sourceEntityId: null,
    sourceTeamName: null,
  };
}

function createEmptyRadarState() {
  return {
    version: 2 as const,
    radarHidden: false,
    radarForced: false,
    localObjectList: [],
    objectList: [],
    events: Array.from({ length: 64 }, () => createEmptyRadarEvent()),
    nextFreeRadarEvent: 0,
    lastRadarEvent: -1,
  };
}

function createEmptyPartitionState() {
  return {
    version: 2 as const,
    cellSize: 10,
    totalCellCount: 0,
    cells: [],
    pendingUndoShroudReveals: [],
  };
}

function createEmptySidesListState() {
  return {
    version: 2 as const,
    state: {},
    scriptLists: [],
  };
}

function createSourceSidesListState() {
  return {
    version: 2 as const,
    state: {
      scriptPlayerSideByName: new Map([['THE_PLAYER', 'america']]),
      scriptDefaultTeamNameBySide: new Map([['america', 'TEAMTHEPLAYER']]),
      mapScriptSideByIndex: ['america'],
      mapScriptDifficultyByIndex: [1],
      mapScriptDifficultyByPlayerToken: new Map([['THE_PLAYER', 1]]),
      scriptAiBuildListEntriesBySide: new Map([['america', [{
        buildingName: 'AmericaBarracks',
        templateName: 'AmericaBarracks',
        x: 12,
        z: 18,
        rebuilds: 0,
        angle: 0,
        initiallyBuilt: true,
        automaticallyBuild: true,
        priorityBuild: false,
      }]]]),
    },
    scriptLists: [{
      present: true,
      scripts: [{ active: true }],
      groups: [],
    }],
  };
}

type TeamFactoryPrototypeSkeleton = {
  nameUpper: string;
  prototypeNameUpper: string;
  sourcePrototypeId: number | undefined;
  sourceTeamId: number | null;
  memberEntityIds: Set<number>;
  created: boolean;
  stateName: string;
  attackPrioritySetName: string;
  recruitableOverride: boolean | null;
  isAIRecruitable: boolean;
  homeWaypointName: string;
  controllingSide: string | null;
  controllingPlayerToken: string | null;
  isSingleton: boolean;
  maxInstances: number;
  productionPriority: number;
  productionPrioritySuccessIncrease: number;
  productionPriorityFailureDecrease: number;
  reinforcementUnitEntries: Array<{ templateName: string; minUnits: number; maxUnits: number }>;
  reinforcementTransportTemplateName: string;
  reinforcementStartWaypointName: string;
  reinforcementTeamStartsFull: boolean;
  reinforcementTransportsExit: boolean;
};

function createTeamFactoryPrototypeSkeleton(
  prototypeNameUpper: string,
  overrides: Partial<TeamFactoryPrototypeSkeleton> = {},
) {
  return {
    nameUpper: prototypeNameUpper,
    prototypeNameUpper,
    sourcePrototypeId: undefined,
    sourceTeamId: null,
    memberEntityIds: new Set<number>(),
    created: false,
    stateName: '',
    attackPrioritySetName: '',
    recruitableOverride: null,
    isAIRecruitable: false,
    homeWaypointName: '',
    controllingSide: null,
    controllingPlayerToken: null,
    isSingleton: true,
    maxInstances: 0,
    productionPriority: 0,
    productionPrioritySuccessIncrease: 0,
    productionPriorityFailureDecrease: 0,
    reinforcementUnitEntries: [],
    reinforcementTransportTemplateName: '',
    reinforcementStartWaypointName: '',
    reinforcementTeamStartsFull: false,
    reinforcementTransportsExit: false,
    ...overrides,
  };
}

function createEmptyTeamFactoryState(
  prototypeNameUpper: string | null = null,
  prototypeOverrides: Partial<ReturnType<typeof createTeamFactoryPrototypeSkeleton>> = {},
) {
  if (prototypeNameUpper === null) {
    return {
      version: 1 as const,
      state: {
        scriptTeamsByName: new Map(),
        scriptTeamInstanceNamesByPrototypeName: new Map(),
        scriptNextSourceTeamId: 1,
        scriptNextSourceTeamPrototypeId: 1,
      },
    };
  }

  return {
    version: 1 as const,
    state: {
      scriptTeamsByName: new Map([
        [prototypeNameUpper, createTeamFactoryPrototypeSkeleton(prototypeNameUpper, prototypeOverrides)],
      ]),
      scriptTeamInstanceNamesByPrototypeName: new Map([[prototypeNameUpper, [prototypeNameUpper]]]),
      scriptNextSourceTeamId: 1,
      scriptNextSourceTeamPrototypeId: 1,
    },
  };
}

function readSaveChunkData(data: ArrayBuffer, blockName: string): Uint8Array | null {
  const chunk = listSaveGameChunks(data).find(
    (candidate) => candidate.blockName.toLowerCase() === blockName.toLowerCase(),
  );
  if (!chunk) {
    return null;
  }
  return new Uint8Array(data, chunk.blockDataOffset, chunk.blockSize).slice();
}

function createSourceObjectHelperBaseBlockData(nextCallFrameAndPhase: number): Uint8Array {
  const xferSave = new XferSave();
  xferSave.open('create-source-object-helper-base');
  try {
    xferSave.xferVersion(1);
    xferSave.xferVersion(1);
    xferSave.xferVersion(1);
    xferSave.xferVersion(1);
    xferSave.xferVersion(1);
    xferSave.xferUnsignedInt(nextCallFrameAndPhase);
    return new Uint8Array(xferSave.getBuffer());
  } finally {
    xferSave.close();
  }
}

function createSourceUpdateModuleBaseBlockData(nextCallFrameAndPhase: number): Uint8Array {
  const xferSave = new XferSave();
  xferSave.open('create-source-update-module-base');
  try {
    xferSave.xferVersion(1);
    xferSave.xferVersion(1);
    xferSave.xferVersion(1);
    xferSave.xferVersion(1);
    xferSave.xferUnsignedInt(nextCallFrameAndPhase);
    return new Uint8Array(xferSave.getBuffer());
  } finally {
    xferSave.close();
  }
}

function createSourceDefectionHelperBlockData(
  nextCallFrameAndPhase: number,
  detectionStart: number,
  detectionEnd: number,
  flashPhase: number,
  doFx: boolean,
): Uint8Array {
  const xferSave = new XferSave();
  xferSave.open('create-source-defection-helper');
  try {
    xferSave.xferVersion(1);
    xferSave.xferUser(createSourceObjectHelperBaseBlockData(nextCallFrameAndPhase));
    xferSave.xferUnsignedInt(detectionStart);
    xferSave.xferUnsignedInt(detectionEnd);
    xferSave.xferReal(flashPhase);
    xferSave.xferBool(doFx);
    return new Uint8Array(xferSave.getBuffer());
  } finally {
    xferSave.close();
  }
}

function createSourceTempWeaponBonusHelperBlockData(
  nextCallFrameAndPhase: number,
  currentBonus: number,
  frameToRemove: number,
): Uint8Array {
  const xferSave = new XferSave();
  xferSave.open('create-source-temp-weapon-bonus-helper');
  try {
    xferSave.xferVersion(1);
    xferSave.xferUser(createSourceObjectHelperBaseBlockData(nextCallFrameAndPhase));
    xferSave.xferInt(currentBonus);
    xferSave.xferUnsignedInt(frameToRemove);
    return new Uint8Array(xferSave.getBuffer());
  } finally {
    xferSave.close();
  }
}

function createSourceSubdualDamageHelperBlockData(
  nextCallFrameAndPhase: number,
  healingStepCountdown: number,
): Uint8Array {
  const xferSave = new XferSave();
  xferSave.open('create-source-subdual-damage-helper');
  try {
    xferSave.xferVersion(1);
    xferSave.xferUser(createSourceObjectHelperBaseBlockData(nextCallFrameAndPhase));
    xferSave.xferUnsignedInt(healingStepCountdown);
    return new Uint8Array(xferSave.getBuffer());
  } finally {
    xferSave.close();
  }
}

function createSourceStatusDamageHelperBlockData(
  nextCallFrameAndPhase: number,
  currentStatus: number,
  frameToHeal: number,
): Uint8Array {
  const xferSave = new XferSave();
  xferSave.open('create-source-status-damage-helper');
  try {
    xferSave.xferVersion(1);
    xferSave.xferUser(createSourceObjectHelperBaseBlockData(nextCallFrameAndPhase));
    xferSave.xferInt(currentStatus);
    xferSave.xferUnsignedInt(frameToHeal);
    return new Uint8Array(xferSave.getBuffer());
  } finally {
    xferSave.close();
  }
}

function createSourceFiringTrackerBlockData(
  nextCallFrameAndPhase: number,
  consecutiveShots: number,
  victimId: number,
  frameToStartCooldown: number,
): Uint8Array {
  const xferSave = new XferSave();
  xferSave.open('create-source-firing-tracker');
  try {
    xferSave.xferVersion(1);
    xferSave.xferUser(createSourceUpdateModuleBaseBlockData(nextCallFrameAndPhase));
    xferSave.xferInt(consecutiveShots);
    xferSave.xferUnsignedInt(victimId);
    xferSave.xferUnsignedInt(frameToStartCooldown);
    return new Uint8Array(xferSave.getBuffer());
  } finally {
    xferSave.close();
  }
}

function createSourceOverchargeBehaviorBlockData(
  nextCallFrameAndPhase: number,
  overchargeActive: boolean,
): Uint8Array {
  const xferSave = new XferSave();
  xferSave.open('create-source-overcharge-behavior');
  try {
    xferSave.xferVersion(1);
    xferSave.xferUser(createSourceUpdateModuleBaseBlockData(nextCallFrameAndPhase));
    xferSave.xferBool(overchargeActive);
    return new Uint8Array(xferSave.getBuffer());
  } finally {
    xferSave.close();
  }
}

function createSourceAutoHealBehaviorBlockData(
  nextCallFrameAndPhase: number,
  upgradeExecuted: boolean,
  radiusParticleSystemId: number,
  soonestHealFrame: number,
  stopped: boolean,
): Uint8Array {
  const xferSave = new XferSave();
  xferSave.open('create-source-auto-heal-behavior');
  try {
    xferSave.xferVersion(1);
    xferSave.xferUser(createSourceUpdateModuleBaseBlockData(nextCallFrameAndPhase));
    xferSave.xferVersion(1);
    xferSave.xferBool(upgradeExecuted);
    xferSave.xferUnsignedInt(radiusParticleSystemId);
    xferSave.xferUnsignedInt(soonestHealFrame);
    xferSave.xferBool(stopped);
    return new Uint8Array(xferSave.getBuffer());
  } finally {
    xferSave.close();
  }
}

function createSourceGrantStealthBehaviorBlockData(
  nextCallFrameAndPhase: number,
  radiusParticleSystemId: number,
  currentScanRadius: number,
): Uint8Array {
  const xferSave = new XferSave();
  xferSave.open('create-source-grant-stealth-behavior');
  try {
    xferSave.xferVersion(1);
    xferSave.xferUser(createSourceUpdateModuleBaseBlockData(nextCallFrameAndPhase));
    xferSave.xferUnsignedInt(radiusParticleSystemId);
    xferSave.xferReal(currentScanRadius);
    return new Uint8Array(xferSave.getBuffer());
  } finally {
    xferSave.close();
  }
}

function createSourceCountermeasuresBehaviorBlockData(
  nextCallFrameAndPhase: number,
  upgradeExecuted: boolean,
  flareIds: number[],
  availableCountermeasures: number,
  activeCountermeasures: number,
  divertedMissiles: number,
  incomingMissiles: number,
  reactionFrame: number,
  nextVolleyFrame: number,
): Uint8Array {
  const xferSave = new XferSave();
  xferSave.open('create-source-countermeasures-behavior');
  try {
    xferSave.xferVersion(2);
    xferSave.xferUser(createSourceUpdateModuleBaseBlockData(nextCallFrameAndPhase));
    xferSave.xferVersion(1);
    xferSave.xferBool(upgradeExecuted);
    xferSave.xferObjectIDList(flareIds);
    xferSave.xferUnsignedInt(availableCountermeasures);
    xferSave.xferUnsignedInt(activeCountermeasures);
    xferSave.xferUnsignedInt(divertedMissiles);
    xferSave.xferUnsignedInt(incomingMissiles);
    xferSave.xferUnsignedInt(reactionFrame);
    xferSave.xferUnsignedInt(nextVolleyFrame);
    return new Uint8Array(xferSave.getBuffer());
  } finally {
    xferSave.close();
  }
}

function createSourceWeaponBonusUpdateBlockData(
  nextCallFrameAndPhase: number,
): Uint8Array {
  const xferSave = new XferSave();
  xferSave.open('create-source-weapon-bonus-update');
  try {
    xferSave.xferVersion(1);
    xferSave.xferUser(createSourceUpdateModuleBaseBlockData(nextCallFrameAndPhase));
    return new Uint8Array(xferSave.getBuffer());
  } finally {
    xferSave.close();
  }
}

function createSourcePowerPlantUpdateBlockData(
  nextCallFrameAndPhase: number,
  extended: boolean,
): Uint8Array {
  const xferSave = new XferSave();
  xferSave.open('create-source-power-plant-update');
  try {
    xferSave.xferVersion(1);
    xferSave.xferUser(createSourceUpdateModuleBaseBlockData(nextCallFrameAndPhase));
    xferSave.xferBool(extended);
    return new Uint8Array(xferSave.getBuffer());
  } finally {
    xferSave.close();
  }
}

function createSourceOclUpdateBlockData(
  nextCallFrameAndPhase: number,
  nextCreationFrame: number,
  timerStartedFrame: number,
  factionNeutral: boolean,
  currentPlayerColor: number,
): Uint8Array {
  const xferSave = new XferSave();
  xferSave.open('create-source-ocl-update');
  try {
    xferSave.xferVersion(1);
    xferSave.xferUser(createSourceUpdateModuleBaseBlockData(nextCallFrameAndPhase));
    xferSave.xferUnsignedInt(nextCreationFrame);
    xferSave.xferUnsignedInt(timerStartedFrame);
    xferSave.xferBool(factionNeutral);
    xferSave.xferInt(currentPlayerColor);
    return new Uint8Array(xferSave.getBuffer());
  } finally {
    xferSave.close();
  }
}

function createSourceEnemyNearUpdateBlockData(
  nextCallFrameAndPhase: number,
  enemyScanDelay: number,
  enemyNear: boolean,
): Uint8Array {
  const xferSave = new XferSave();
  xferSave.open('create-source-enemy-near-update');
  try {
    xferSave.xferVersion(1);
    xferSave.xferUser(createSourceUpdateModuleBaseBlockData(nextCallFrameAndPhase));
    xferSave.xferUnsignedInt(enemyScanDelay);
    xferSave.xferBool(enemyNear);
    return new Uint8Array(xferSave.getBuffer());
  } finally {
    xferSave.close();
  }
}

function createSourceHordeUpdateBlockData(
  nextCallFrameAndPhase: number,
  inHorde: boolean,
  hasFlag: boolean,
): Uint8Array {
  const xferSave = new XferSave();
  xferSave.open('create-source-horde-update');
  try {
    xferSave.xferVersion(1);
    xferSave.xferUser(createSourceUpdateModuleBaseBlockData(nextCallFrameAndPhase));
    xferSave.xferBool(inHorde);
    xferSave.xferBool(hasFlag);
    return new Uint8Array(xferSave.getBuffer());
  } finally {
    xferSave.close();
  }
}

function createSourceProneUpdateBlockData(
  nextCallFrameAndPhase: number,
  proneFrames: number,
): Uint8Array {
  const xferSave = new XferSave();
  xferSave.open('create-source-prone-update');
  try {
    xferSave.xferVersion(1);
    xferSave.xferUser(createSourceUpdateModuleBaseBlockData(nextCallFrameAndPhase));
    xferSave.xferInt(proneFrames);
    return new Uint8Array(xferSave.getBuffer());
  } finally {
    xferSave.close();
  }
}

function createSourceFireOclAfterCooldownUpdateBlockData(
  nextCallFrameAndPhase: number,
  upgradeExecuted: boolean,
  valid: boolean,
  consecutiveShots: number,
  startFrame: number,
): Uint8Array {
  const xferSave = new XferSave();
  xferSave.open('create-source-fire-ocl-after-cooldown-update');
  try {
    xferSave.xferVersion(1);
    xferSave.xferUser(createSourceUpdateModuleBaseBlockData(nextCallFrameAndPhase));
    xferSave.xferVersion(1);
    xferSave.xferBool(upgradeExecuted);
    xferSave.xferBool(valid);
    xferSave.xferUnsignedInt(consecutiveShots);
    xferSave.xferUnsignedInt(startFrame);
    return new Uint8Array(xferSave.getBuffer());
  } finally {
    xferSave.close();
  }
}

function createSourceAutoFindHealingUpdateBlockData(
  nextCallFrameAndPhase: number,
  nextScanFrames: number,
): Uint8Array {
  const xferSave = new XferSave();
  xferSave.open('create-source-auto-find-healing-update');
  try {
    xferSave.xferVersion(1);
    xferSave.xferUser(createSourceUpdateModuleBaseBlockData(nextCallFrameAndPhase));
    xferSave.xferInt(nextScanFrames);
    return new Uint8Array(xferSave.getBuffer());
  } finally {
    xferSave.close();
  }
}

function createSourceRadiusDecalUpdateBlockData(
  nextCallFrameAndPhase: number,
  killWhenNoLongerAttacking: boolean,
): Uint8Array {
  const xferSave = new XferSave();
  xferSave.open('create-source-radius-decal-update');
  try {
    xferSave.xferVersion(1);
    xferSave.xferUser(createSourceUpdateModuleBaseBlockData(nextCallFrameAndPhase));
    xferSave.xferBool(killWhenNoLongerAttacking);
    return new Uint8Array(xferSave.getBuffer());
  } finally {
    xferSave.close();
  }
}

function createSourceBaseRegenerateUpdateBlockData(
  nextCallFrameAndPhase: number,
): Uint8Array {
  const xferSave = new XferSave();
  xferSave.open('create-source-base-regenerate-update');
  try {
    xferSave.xferVersion(1);
    xferSave.xferUser(createSourceUpdateModuleBaseBlockData(nextCallFrameAndPhase));
    return new Uint8Array(xferSave.getBuffer());
  } finally {
    xferSave.close();
  }
}

function createSourceLifetimeUpdateBlockData(
  nextCallFrameAndPhase: number,
  dieFrame: number,
): Uint8Array {
  const xferSave = new XferSave();
  xferSave.open('create-source-lifetime-update');
  try {
    xferSave.xferVersion(1);
    xferSave.xferUser(createSourceUpdateModuleBaseBlockData(nextCallFrameAndPhase));
    xferSave.xferUnsignedInt(dieFrame);
    return new Uint8Array(xferSave.getBuffer());
  } finally {
    xferSave.close();
  }
}

function createSourceDeletionUpdateBlockData(
  nextCallFrameAndPhase: number,
  dieFrame: number,
): Uint8Array {
  const xferSave = new XferSave();
  xferSave.open('create-source-deletion-update');
  try {
    xferSave.xferVersion(1);
    xferSave.xferUser(createSourceUpdateModuleBaseBlockData(nextCallFrameAndPhase));
    xferSave.xferUnsignedInt(dieFrame);
    return new Uint8Array(xferSave.getBuffer());
  } finally {
    xferSave.close();
  }
}

function createSourceHeightDieUpdateBlockData(
  nextCallFrameAndPhase: number,
  hasDied: boolean,
  particlesDestroyed: boolean,
  lastPosition: { x: number; y: number; z: number },
  earliestDeathFrame: number,
): Uint8Array {
  const xferSave = new XferSave();
  xferSave.open('create-source-height-die-update');
  try {
    xferSave.xferVersion(2);
    xferSave.xferUser(createSourceUpdateModuleBaseBlockData(nextCallFrameAndPhase));
    xferSave.xferBool(hasDied);
    xferSave.xferBool(particlesDestroyed);
    xferSave.xferCoord3D(lastPosition);
    xferSave.xferUnsignedInt(earliestDeathFrame);
    return new Uint8Array(xferSave.getBuffer());
  } finally {
    xferSave.close();
  }
}

function createSourceStickyBombUpdateBlockData(
  nextCallFrameAndPhase: number,
  targetId: number,
  dieFrame: number,
  nextPingFrame: number,
): Uint8Array {
  const xferSave = new XferSave();
  xferSave.open('create-source-sticky-bomb-update');
  try {
    xferSave.xferVersion(1);
    xferSave.xferUser(createSourceUpdateModuleBaseBlockData(nextCallFrameAndPhase));
    xferSave.xferObjectID(targetId);
    xferSave.xferUnsignedInt(dieFrame);
    xferSave.xferUnsignedInt(nextPingFrame);
    return new Uint8Array(xferSave.getBuffer());
  } finally {
    xferSave.close();
  }
}

function createSourceCleanupHazardUpdateBlockData(
  nextCallFrameAndPhase: number,
  bestTargetId: number,
  inRange: boolean,
  nextScanFrames: number,
  nextShotAvailableInFrames: number,
  position: { x: number; y: number; z: number },
  moveRange: number,
): Uint8Array {
  const xferSave = new XferSave();
  xferSave.open('create-source-cleanup-hazard-update');
  try {
    xferSave.xferVersion(1);
    xferSave.xferUser(createSourceUpdateModuleBaseBlockData(nextCallFrameAndPhase));
    xferSave.xferObjectID(bestTargetId);
    xferSave.xferBool(inRange);
    xferSave.xferInt(nextScanFrames);
    xferSave.xferInt(nextShotAvailableInFrames);
    xferSave.xferCoord3D(position);
    xferSave.xferReal(moveRange);
    return new Uint8Array(xferSave.getBuffer());
  } finally {
    xferSave.close();
  }
}

function createSourceDemoTrapUpdateBlockData(
  nextCallFrameAndPhase: number,
  nextScanFrames: number,
  detonated: boolean,
): Uint8Array {
  const xferSave = new XferSave();
  xferSave.open('create-source-demo-trap-update');
  try {
    xferSave.xferVersion(1);
    xferSave.xferUser(createSourceUpdateModuleBaseBlockData(nextCallFrameAndPhase));
    xferSave.xferInt(nextScanFrames);
    xferSave.xferBool(detonated);
    return new Uint8Array(xferSave.getBuffer());
  } finally {
    xferSave.close();
  }
}

function createSourceCommandButtonHuntUpdateBlockData(
  nextCallFrameAndPhase: number,
  commandButtonName: string,
): Uint8Array {
  const xferSave = new XferSave();
  xferSave.open('create-source-command-button-hunt-update');
  try {
    xferSave.xferVersion(1);
    xferSave.xferUser(createSourceUpdateModuleBaseBlockData(nextCallFrameAndPhase));
    xferSave.xferAsciiString(commandButtonName);
    return new Uint8Array(xferSave.getBuffer());
  } finally {
    xferSave.close();
  }
}

function createSourceAutoDepositUpdateBlockData(
  nextCallFrameAndPhase: number,
  depositOnFrame: number,
  awardInitialCaptureBonus: boolean,
  initialized: boolean,
): Uint8Array {
  const xferSave = new XferSave();
  xferSave.open('create-source-auto-deposit-update');
  try {
    xferSave.xferVersion(2);
    xferSave.xferUser(createSourceUpdateModuleBaseBlockData(nextCallFrameAndPhase));
    xferSave.xferUnsignedInt(depositOnFrame);
    xferSave.xferBool(awardInitialCaptureBonus);
    xferSave.xferBool(initialized);
    return new Uint8Array(xferSave.getBuffer());
  } finally {
    xferSave.close();
  }
}

function createSourceDynamicShroudClearingRangeUpdateBlockData(
  nextCallFrameAndPhase: number,
  stateCountDown: number,
  totalFrames: number,
  growStartDeadline: number,
  sustainDeadline: number,
  shrinkStartDeadline: number,
  doneForeverFrame: number,
  changeIntervalCountdown: number,
  decalsCreated: boolean,
  visionChangePerInterval: number,
  nativeClearingRange: number,
  currentClearingRange: number,
): Uint8Array {
  const xferSave = new XferSave();
  xferSave.open('create-source-dynamic-shroud-clearing-range-update');
  try {
    xferSave.xferVersion(1);
    xferSave.xferUser(createSourceUpdateModuleBaseBlockData(nextCallFrameAndPhase));
    xferSave.xferInt(stateCountDown);
    xferSave.xferInt(totalFrames);
    xferSave.xferUnsignedInt(growStartDeadline);
    xferSave.xferUnsignedInt(sustainDeadline);
    xferSave.xferUnsignedInt(shrinkStartDeadline);
    xferSave.xferUnsignedInt(doneForeverFrame);
    xferSave.xferUnsignedInt(changeIntervalCountdown);
    xferSave.xferBool(decalsCreated);
    xferSave.xferReal(visionChangePerInterval);
    xferSave.xferReal(nativeClearingRange);
    xferSave.xferReal(currentClearingRange);
    return new Uint8Array(xferSave.getBuffer());
  } finally {
    xferSave.close();
  }
}

function createSourceStealthDetectorUpdateBlockData(
  nextCallFrameAndPhase: number,
  enabled: boolean,
): Uint8Array {
  const xferSave = new XferSave();
  xferSave.open('create-source-stealth-detector-update');
  try {
    xferSave.xferVersion(1);
    xferSave.xferUser(createSourceUpdateModuleBaseBlockData(nextCallFrameAndPhase));
    xferSave.xferBool(enabled);
    return new Uint8Array(xferSave.getBuffer());
  } finally {
    xferSave.close();
  }
}

function createSourceStealthUpdateBlockData(
  nextCallFrameAndPhase: number,
  stealthAllowedFrame: number,
  detectionExpiresFrame: number,
  enabled: boolean,
  pulsePhaseRate: number,
  pulsePhase: number,
  disguiseAsPlayerIndex: number,
  disguiseTemplateName: string,
  disguiseTransitionFrames: number,
  disguiseHalfpointReached: boolean,
  transitioningToDisguise: boolean,
  disguised: boolean,
  framesGranted: number,
): Uint8Array {
  const xferSave = new XferSave();
  xferSave.open('create-source-stealth-update');
  try {
    xferSave.xferVersion(2);
    xferSave.xferUser(createSourceUpdateModuleBaseBlockData(nextCallFrameAndPhase));
    xferSave.xferUnsignedInt(stealthAllowedFrame);
    xferSave.xferUnsignedInt(detectionExpiresFrame);
    xferSave.xferBool(enabled);
    xferSave.xferReal(pulsePhaseRate);
    xferSave.xferReal(pulsePhase);
    xferSave.xferInt(disguiseAsPlayerIndex);
    xferSave.xferAsciiString(disguiseTemplateName);
    xferSave.xferUnsignedInt(disguiseTransitionFrames);
    xferSave.xferBool(disguiseHalfpointReached);
    xferSave.xferBool(transitioningToDisguise);
    xferSave.xferBool(disguised);
    xferSave.xferUnsignedInt(framesGranted);
    return new Uint8Array(xferSave.getBuffer());
  } finally {
    xferSave.close();
  }
}

function createSourceFloatUpdateBlockData(
  nextCallFrameAndPhase: number,
  enabled: boolean,
): Uint8Array {
  const xferSave = new XferSave();
  xferSave.open('create-source-float-update');
  try {
    xferSave.xferVersion(1);
    xferSave.xferUser(createSourceUpdateModuleBaseBlockData(nextCallFrameAndPhase));
    xferSave.xferBool(enabled);
    return new Uint8Array(xferSave.getBuffer());
  } finally {
    xferSave.close();
  }
}

function createSourceSpectreGunshipDeploymentUpdateBlockData(
  nextCallFrameAndPhase: number,
  gunshipId: number,
): Uint8Array {
  const xferSave = new XferSave();
  xferSave.open('create-source-spectre-gunship-deployment-update');
  try {
    xferSave.xferVersion(1);
    xferSave.xferUser(createSourceUpdateModuleBaseBlockData(nextCallFrameAndPhase));
    xferSave.xferObjectID(gunshipId);
    return new Uint8Array(xferSave.getBuffer());
  } finally {
    xferSave.close();
  }
}

function createSourceSpectreGunshipUpdateBlockData(
  nextCallFrameAndPhase: number,
  initialTargetPosition: { x: number; y: number; z: number },
  overrideTargetDestination: { x: number; y: number; z: number },
  satellitePosition: { x: number; y: number; z: number },
  status: number,
  orbitEscapeFrame: number,
  gattlingTargetPosition: { x: number; y: number; z: number },
  positionToShootAt: { x: number; y: number; z: number },
  okToFireHowitzerCounter: number,
  gattlingId: number,
): Uint8Array {
  const xferSave = new XferSave();
  xferSave.open('create-source-spectre-gunship-update');
  try {
    const statusBytes = new Uint8Array(4);
    new DataView(statusBytes.buffer).setInt32(0, status, true);
    xferSave.xferVersion(2);
    xferSave.xferUser(createSourceUpdateModuleBaseBlockData(nextCallFrameAndPhase));
    xferSave.xferCoord3D(initialTargetPosition);
    xferSave.xferCoord3D(overrideTargetDestination);
    xferSave.xferCoord3D(satellitePosition);
    xferSave.xferUser(statusBytes);
    xferSave.xferUnsignedInt(orbitEscapeFrame);
    xferSave.xferCoord3D(gattlingTargetPosition);
    xferSave.xferCoord3D(positionToShootAt);
    xferSave.xferUnsignedInt(okToFireHowitzerCounter);
    xferSave.xferObjectID(gattlingId);
    return new Uint8Array(xferSave.getBuffer());
  } finally {
    xferSave.close();
  }
}

function createSourcePilotFindVehicleUpdateBlockData(
  nextCallFrameAndPhase: number,
  didMoveToBase: boolean,
): Uint8Array {
  const xferSave = new XferSave();
  xferSave.open('create-source-pilot-find-vehicle-update');
  try {
    xferSave.xferVersion(1);
    xferSave.xferUser(createSourceUpdateModuleBaseBlockData(nextCallFrameAndPhase));
    xferSave.xferBool(didMoveToBase);
    return new Uint8Array(xferSave.getBuffer());
  } finally {
    xferSave.close();
  }
}

function createSourcePointDefenseLaserUpdateBlockData(
  nextCallFrameAndPhase: number,
  bestTargetId: number,
  inRange: boolean,
  nextScanFrames: number,
  nextShotAvailableInFrames: number,
): Uint8Array {
  const xferSave = new XferSave();
  xferSave.open('create-source-point-defense-laser-update');
  try {
    xferSave.xferVersion(1);
    xferSave.xferUser(createSourceUpdateModuleBaseBlockData(nextCallFrameAndPhase));
    xferSave.xferObjectID(bestTargetId);
    xferSave.xferBool(inRange);
    xferSave.xferInt(nextScanFrames);
    xferSave.xferInt(nextShotAvailableInFrames);
    return new Uint8Array(xferSave.getBuffer());
  } finally {
    xferSave.close();
  }
}

function createSourceLeafletDropBehaviorBlockData(
  startFrame: number,
): Uint8Array {
  const xferSave = new XferSave();
  xferSave.open('create-source-leaflet-drop-behavior');
  try {
    xferSave.xferVersion(1);
    xferSave.xferUnsignedInt(startFrame);
    return new Uint8Array(xferSave.getBuffer());
  } finally {
    xferSave.close();
  }
}

function createSourceEmpUpdateBlockData(): Uint8Array {
  const xferSave = new XferSave();
  xferSave.open('create-source-emp-update');
  try {
    xferSave.xferVersion(1);
    return new Uint8Array(xferSave.getBuffer());
  } finally {
    xferSave.close();
  }
}

function createSourceRadarUpdateBlockData(
  nextCallFrameAndPhase: number,
  extendDoneFrame: number,
  extendComplete: boolean,
  radarActive: boolean,
): Uint8Array {
  const xferSave = new XferSave();
  xferSave.open('create-source-radar-update');
  try {
    xferSave.xferVersion(1);
    xferSave.xferUser(createSourceUpdateModuleBaseBlockData(nextCallFrameAndPhase));
    xferSave.xferUnsignedInt(extendDoneFrame);
    xferSave.xferBool(extendComplete);
    xferSave.xferBool(radarActive);
    return new Uint8Array(xferSave.getBuffer());
  } finally {
    xferSave.close();
  }
}

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
const SOURCE_PHYSICS_INVALID_VEL_MAG = -1;
const SOURCE_PROJECTILE_STREAM_MAX = 20;
const SOURCE_BONE_FX_BODY_DAMAGE_TYPE_COUNT = 4;
const SOURCE_BONE_FX_MAX_BONES = 8;
const SOURCE_FLAMMABLE_STATUS_AFLAME = 1;
const SOURCE_DEATH_TYPE_POISONED = 5;
const SOURCE_DEATH_TYPE_LASERED = 9;
const SOURCE_MINEFIELD_MAX_IMMUNITY = 3;
const SOURCE_FIRESTORM_PARTICLE_IDS_BYTE_LENGTH = 16 * 4;
const SOURCE_WEAPON_STATUS_BETWEEN_FIRING_SHOTS = 2;
const SOURCE_PRODUCTION_UNIT = 1;
const SOURCE_PRODUCTION_UPGRADE = 2;
const SOURCE_PRODUCTION_DOOR_INFO_BYTE_LENGTH = 64;
const SOURCE_DAMAGE_TYPE_UNRESISTABLE = 11;
const SOURCE_PLAYER_MASK_BYTE_LENGTH = 2;
const SOURCE_OPEN_CONTAIN_FIRE_POINTS_BYTE_LENGTH = 32 * 48;
const SOURCE_BATTLE_PLAN_NONE = 0;
const SOURCE_BATTLE_PLAN_BOMBARDMENT = 1;
const SOURCE_BATTLE_PLAN_HOLD_THE_LINE = 2;
const SOURCE_BATTLE_PLAN_SEARCH_AND_DESTROY = 3;
const SOURCE_BATTLE_PLAN_STATUS_ACTIVE = 2;
const SOURCE_BATTLE_PLAN_STATUS_PACKING = 3;

interface SourcePhysicsBehaviorTestState {
  nextCallFrameAndPhase: number;
  yawRate: number;
  rollRate: number;
  pitchRate: number;
  accel: Coord3D;
  prevAccel: Coord3D;
  vel: Coord3D;
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
}

function createSourcePhysicsBehaviorBlockData(state: SourcePhysicsBehaviorTestState): Uint8Array {
  const xferSave = new XferSave();
  xferSave.open('create-source-physics-behavior');
  try {
    xferSave.xferVersion(2);
    xferSave.xferUser(createSourceUpdateModuleBaseBlockData(state.nextCallFrameAndPhase));
    xferSave.xferReal(state.yawRate);
    xferSave.xferReal(state.rollRate);
    xferSave.xferReal(state.pitchRate);
    xferSave.xferCoord3D(state.accel);
    xferSave.xferCoord3D(state.prevAccel);
    xferSave.xferCoord3D(state.vel);
    xferSave.xferUser(createRawInt32Bytes(state.turning));
    xferSave.xferObjectID(state.ignoreCollisionsWith);
    xferSave.xferInt(state.flags);
    xferSave.xferReal(state.mass);
    xferSave.xferObjectID(state.currentOverlap);
    xferSave.xferObjectID(state.previousOverlap);
    xferSave.xferUnsignedInt(state.motiveForceExpires);
    xferSave.xferReal(state.extraBounciness);
    xferSave.xferReal(state.extraFriction);
    xferSave.xferReal(state.velMag);
    return new Uint8Array(xferSave.getBuffer());
  } finally {
    xferSave.close();
  }
}

interface SourceProjectileStreamUpdateTestState {
  nextCallFrameAndPhase: number;
  projectileIds: number[];
  nextFreeIndex: number;
  firstValidIndex: number;
  owningObject: number;
  targetObject: number;
  targetPosition: Coord3D;
}

function createSourceProjectileStreamUpdateBlockData(state: SourceProjectileStreamUpdateTestState): Uint8Array {
  const xferSave = new XferSave();
  xferSave.open('create-source-projectile-stream-update');
  try {
    xferSave.xferVersion(2);
    xferSave.xferUser(createSourceUpdateModuleBaseBlockData(state.nextCallFrameAndPhase));
    for (let index = 0; index < SOURCE_PROJECTILE_STREAM_MAX; index += 1) {
      xferSave.xferObjectID(state.projectileIds[index] ?? 0);
    }
    xferSave.xferInt(state.nextFreeIndex);
    xferSave.xferInt(state.firstValidIndex);
    xferSave.xferObjectID(state.owningObject);
    xferSave.xferObjectID(state.targetObject);
    xferSave.xferCoord3D(state.targetPosition);
    return new Uint8Array(xferSave.getBuffer());
  } finally {
    xferSave.close();
  }
}

interface SourceBoneFxUpdateTestState {
  nextCallFrameAndPhase: number;
  particleSystemIds: number[];
  nextFxFrame: number[][];
  nextOclFrame: number[][];
  nextParticleSystemFrame: number[][];
  fxBonePositions: Coord3D[][];
  oclBonePositions: Coord3D[][];
  particleSystemBonePositions: Coord3D[][];
  currentBodyState: number;
  bonesResolvedBytes: Uint8Array;
  active: boolean;
}

function createSourceBoneFxIntGrid(seed: number): number[][] {
  return Array.from({ length: SOURCE_BONE_FX_BODY_DAMAGE_TYPE_COUNT }, (_, damageState) =>
    Array.from({ length: SOURCE_BONE_FX_MAX_BONES }, (_, boneIndex) =>
      seed + (damageState * 10) + boneIndex,
    ),
  );
}

function createSourceBoneFxCoordGrid(seed: number): Coord3D[][] {
  return Array.from({ length: SOURCE_BONE_FX_BODY_DAMAGE_TYPE_COUNT }, (_, damageState) =>
    Array.from({ length: SOURCE_BONE_FX_MAX_BONES }, (_, boneIndex) => ({
      x: seed + (damageState * 100) + boneIndex,
      y: seed + (damageState * 100) + boneIndex + 0.25,
      z: seed + (damageState * 100) + boneIndex + 0.5,
    })),
  );
}

function xferSourceBoneFxIntGrid(xfer: Xfer, grid: number[][]): number[][] {
  const result: number[][] = [];
  for (let damageState = 0; damageState < SOURCE_BONE_FX_BODY_DAMAGE_TYPE_COUNT; damageState += 1) {
    const row: number[] = [];
    for (let boneIndex = 0; boneIndex < SOURCE_BONE_FX_MAX_BONES; boneIndex += 1) {
      row.push(xfer.xferInt(grid[damageState]?.[boneIndex] ?? 0));
    }
    result.push(row);
  }
  return result;
}

function xferSourceBoneFxCoordGrid(xfer: Xfer, grid: Coord3D[][]): Coord3D[][] {
  const result: Coord3D[][] = [];
  for (let damageState = 0; damageState < SOURCE_BONE_FX_BODY_DAMAGE_TYPE_COUNT; damageState += 1) {
    const row: Coord3D[] = [];
    for (let boneIndex = 0; boneIndex < SOURCE_BONE_FX_MAX_BONES; boneIndex += 1) {
      row.push(xfer.xferCoord3D(grid[damageState]?.[boneIndex] ?? { x: 0, y: 0, z: 0 }));
    }
    result.push(row);
  }
  return result;
}

function createSourceBoneFxUpdateBlockData(state: SourceBoneFxUpdateTestState): Uint8Array {
  const xferSave = new XferSave();
  xferSave.open('create-source-bone-fx-update');
  try {
    xferSave.xferVersion(1);
    xferSave.xferUser(createSourceUpdateModuleBaseBlockData(state.nextCallFrameAndPhase));
    xferSave.xferUnsignedShort(state.particleSystemIds.length);
    for (const particleSystemId of state.particleSystemIds) {
      xferSave.xferUnsignedInt(particleSystemId);
    }
    xferSourceBoneFxIntGrid(xferSave, state.nextFxFrame);
    xferSourceBoneFxIntGrid(xferSave, state.nextOclFrame);
    xferSourceBoneFxIntGrid(xferSave, state.nextParticleSystemFrame);
    xferSourceBoneFxCoordGrid(xferSave, state.fxBonePositions);
    xferSourceBoneFxCoordGrid(xferSave, state.oclBonePositions);
    xferSourceBoneFxCoordGrid(xferSave, state.particleSystemBonePositions);
    xferSave.xferUser(createRawInt32Bytes(state.currentBodyState));
    xferSave.xferUser(state.bonesResolvedBytes);
    xferSave.xferBool(state.active);
    return new Uint8Array(xferSave.getBuffer());
  } finally {
    xferSave.close();
  }
}

interface SourceFlammableUpdateTestState {
  nextCallFrameAndPhase: number;
  status: number;
  aflameEndFrame: number;
  burnedEndFrame: number;
  damageEndFrame: number;
  flameDamageLimit: number;
  lastFlameDamageDealt: number;
}

function createSourceFlammableUpdateBlockData(state: SourceFlammableUpdateTestState): Uint8Array {
  const xferSave = new XferSave();
  xferSave.open('create-source-flammable-update');
  try {
    xferSave.xferVersion(1);
    xferSave.xferUser(createSourceUpdateModuleBaseBlockData(state.nextCallFrameAndPhase));
    xferSave.xferUser(createRawInt32Bytes(state.status));
    xferSave.xferUnsignedInt(state.aflameEndFrame);
    xferSave.xferUnsignedInt(state.burnedEndFrame);
    xferSave.xferUnsignedInt(state.damageEndFrame);
    xferSave.xferReal(state.flameDamageLimit);
    xferSave.xferUnsignedInt(state.lastFlameDamageDealt);
    return new Uint8Array(xferSave.getBuffer());
  } finally {
    xferSave.close();
  }
}

function createSourceFireSpreadUpdateBlockData(nextCallFrameAndPhase: number): Uint8Array {
  const xferSave = new XferSave();
  xferSave.open('create-source-fire-spread-update');
  try {
    xferSave.xferVersion(1);
    xferSave.xferUser(createSourceUpdateModuleBaseBlockData(nextCallFrameAndPhase));
    return new Uint8Array(xferSave.getBuffer());
  } finally {
    xferSave.close();
  }
}

interface SourcePoisonedBehaviorTestState {
  nextCallFrameAndPhase: number;
  poisonDamageFrame: number;
  poisonOverallStopFrame: number;
  poisonDamageAmount: number;
  deathType: number;
}

function createSourcePoisonedBehaviorBlockData(state: SourcePoisonedBehaviorTestState): Uint8Array {
  const xferSave = new XferSave();
  xferSave.open('create-source-poisoned-behavior');
  try {
    xferSave.xferVersion(2);
    xferSave.xferUser(createSourceUpdateModuleBaseBlockData(state.nextCallFrameAndPhase));
    xferSave.xferUnsignedInt(state.poisonDamageFrame);
    xferSave.xferUnsignedInt(state.poisonOverallStopFrame);
    xferSave.xferReal(state.poisonDamageAmount);
    xferSave.xferUser(createRawInt32Bytes(state.deathType));
    return new Uint8Array(xferSave.getBuffer());
  } finally {
    xferSave.close();
  }
}

function parseSourcePoisonedBehaviorBlockData(data: Uint8Array): SourcePoisonedBehaviorTestState {
  const xferLoad = new XferLoad(data.slice().buffer);
  xferLoad.open('parse-source-poisoned-behavior');
  try {
    xferLoad.xferVersion(2);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    return {
      nextCallFrameAndPhase: xferLoad.xferUnsignedInt(0),
      poisonDamageFrame: xferLoad.xferUnsignedInt(0),
      poisonOverallStopFrame: xferLoad.xferUnsignedInt(0),
      poisonDamageAmount: xferLoad.xferReal(0),
      deathType: readRawInt32Bytes(xferLoad.xferUser(new Uint8Array(4))),
    };
  } finally {
    xferLoad.close();
  }
}

interface SourceMinefieldImmuneTestState {
  objectId: number;
  collideTime: number;
}

interface SourceMinefieldBehaviorTestState {
  nextCallFrameAndPhase: number;
  virtualMinesRemaining: number;
  nextDeathCheckFrame: number;
  scootFramesLeft: number;
  scootVelocity: Coord3D;
  scootAcceleration: Coord3D;
  ignoreDamage: boolean;
  regenerates: boolean;
  draining: boolean;
  immunes: SourceMinefieldImmuneTestState[];
}

function createSourceMinefieldBehaviorBlockData(state: SourceMinefieldBehaviorTestState): Uint8Array {
  const xferSave = new XferSave();
  xferSave.open('create-source-minefield-behavior');
  try {
    xferSave.xferVersion(1);
    xferSave.xferUser(createSourceUpdateModuleBaseBlockData(state.nextCallFrameAndPhase));
    xferSave.xferUnsignedInt(state.virtualMinesRemaining);
    xferSave.xferUnsignedInt(state.nextDeathCheckFrame);
    xferSave.xferUnsignedInt(state.scootFramesLeft);
    xferSave.xferCoord3D(state.scootVelocity);
    xferSave.xferCoord3D(state.scootAcceleration);
    xferSave.xferBool(state.ignoreDamage);
    xferSave.xferBool(state.regenerates);
    xferSave.xferBool(state.draining);
    xferSave.xferUnsignedByte(SOURCE_MINEFIELD_MAX_IMMUNITY);
    for (let index = 0; index < SOURCE_MINEFIELD_MAX_IMMUNITY; index += 1) {
      const immune = state.immunes[index] ?? { objectId: 0, collideTime: 0 };
      xferSave.xferObjectID(immune.objectId);
      xferSave.xferUnsignedInt(immune.collideTime);
    }
    return new Uint8Array(xferSave.getBuffer());
  } finally {
    xferSave.close();
  }
}

function parseSourceMinefieldBehaviorBlockData(data: Uint8Array): SourceMinefieldBehaviorTestState {
  const xferLoad = new XferLoad(data.slice().buffer);
  xferLoad.open('parse-source-minefield-behavior');
  try {
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    const state: SourceMinefieldBehaviorTestState = {
      nextCallFrameAndPhase: xferLoad.xferUnsignedInt(0),
      virtualMinesRemaining: xferLoad.xferUnsignedInt(0),
      nextDeathCheckFrame: xferLoad.xferUnsignedInt(0),
      scootFramesLeft: xferLoad.xferUnsignedInt(0),
      scootVelocity: xferLoad.xferCoord3D({ x: 0, y: 0, z: 0 }),
      scootAcceleration: xferLoad.xferCoord3D({ x: 0, y: 0, z: 0 }),
      ignoreDamage: xferLoad.xferBool(false),
      regenerates: xferLoad.xferBool(false),
      draining: xferLoad.xferBool(false),
      immunes: [],
    };
    expect(xferLoad.xferUnsignedByte(0)).toBe(SOURCE_MINEFIELD_MAX_IMMUNITY);
    for (let index = 0; index < SOURCE_MINEFIELD_MAX_IMMUNITY; index += 1) {
      state.immunes.push({
        objectId: xferLoad.xferObjectID(0),
        collideTime: xferLoad.xferUnsignedInt(0),
      });
    }
    return state;
  } finally {
    xferLoad.close();
  }
}

interface SourceDynamicGeometryInfoUpdateTestState {
  nextCallFrameAndPhase: number;
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
}

interface SourceFirestormDynamicGeometryInfoUpdateTestState {
  dynamic: SourceDynamicGeometryInfoUpdateTestState;
  particleSystemIdBytes: Uint8Array;
  effectsFired: boolean;
  scorchPlaced: boolean;
  lastDamageFrame: number;
}

function xferSourceDynamicGeometryInfoUpdateForTest(
  xfer: Xfer,
  state: SourceDynamicGeometryInfoUpdateTestState,
): SourceDynamicGeometryInfoUpdateTestState {
  xfer.xferVersion(1);
  xfer.xferVersion(1);
  xfer.xferVersion(1);
  xfer.xferVersion(1);
  xfer.xferVersion(1);
  return {
    nextCallFrameAndPhase: xfer.xferUnsignedInt(state.nextCallFrameAndPhase),
    startingDelayCountdown: xfer.xferUnsignedInt(state.startingDelayCountdown),
    timeActive: xfer.xferUnsignedInt(state.timeActive),
    started: xfer.xferBool(state.started),
    finished: xfer.xferBool(state.finished),
    reverseAtTransitionTime: xfer.xferBool(state.reverseAtTransitionTime),
    direction: readRawInt32Bytes(xfer.xferUser(createRawInt32Bytes(state.direction))),
    switchedDirections: xfer.xferBool(state.switchedDirections),
    initialHeight: xfer.xferReal(state.initialHeight),
    initialMajorRadius: xfer.xferReal(state.initialMajorRadius),
    initialMinorRadius: xfer.xferReal(state.initialMinorRadius),
    finalHeight: xfer.xferReal(state.finalHeight),
    finalMajorRadius: xfer.xferReal(state.finalMajorRadius),
    finalMinorRadius: xfer.xferReal(state.finalMinorRadius),
  };
}

function createSourceDynamicGeometryInfoUpdateBlockData(
  state: SourceDynamicGeometryInfoUpdateTestState,
): Uint8Array {
  const xferSave = new XferSave();
  xferSave.open('create-source-dynamic-geometry-info-update');
  try {
    xferSourceDynamicGeometryInfoUpdateForTest(xferSave, state);
    return new Uint8Array(xferSave.getBuffer());
  } finally {
    xferSave.close();
  }
}

function parseSourceDynamicGeometryInfoUpdateBlockData(
  data: Uint8Array,
): SourceDynamicGeometryInfoUpdateTestState {
  const xferLoad = new XferLoad(data.slice().buffer);
  xferLoad.open('parse-source-dynamic-geometry-info-update');
  try {
    return xferSourceDynamicGeometryInfoUpdateForTest(xferLoad, {
      nextCallFrameAndPhase: 0,
      startingDelayCountdown: 0,
      timeActive: 0,
      started: false,
      finished: false,
      reverseAtTransitionTime: false,
      direction: 0,
      switchedDirections: false,
      initialHeight: 0,
      initialMajorRadius: 0,
      initialMinorRadius: 0,
      finalHeight: 0,
      finalMajorRadius: 0,
      finalMinorRadius: 0,
    });
  } finally {
    xferLoad.close();
  }
}

function createSourceFirestormDynamicGeometryInfoUpdateBlockData(
  state: SourceFirestormDynamicGeometryInfoUpdateTestState,
): Uint8Array {
  const xferSave = new XferSave();
  xferSave.open('create-source-firestorm-dynamic-geometry-info-update');
  try {
    xferSave.xferVersion(1);
    xferSourceDynamicGeometryInfoUpdateForTest(xferSave, state.dynamic);
    xferSave.xferUser(state.particleSystemIdBytes);
    xferSave.xferBool(state.effectsFired);
    xferSave.xferBool(state.scorchPlaced);
    xferSave.xferUnsignedInt(state.lastDamageFrame);
    return new Uint8Array(xferSave.getBuffer());
  } finally {
    xferSave.close();
  }
}

function parseSourceFirestormDynamicGeometryInfoUpdateBlockData(
  data: Uint8Array,
): SourceFirestormDynamicGeometryInfoUpdateTestState {
  const xferLoad = new XferLoad(data.slice().buffer);
  xferLoad.open('parse-source-firestorm-dynamic-geometry-info-update');
  try {
    xferLoad.xferVersion(1);
    return {
      dynamic: xferSourceDynamicGeometryInfoUpdateForTest(xferLoad, {
        nextCallFrameAndPhase: 0,
        startingDelayCountdown: 0,
        timeActive: 0,
        started: false,
        finished: false,
        reverseAtTransitionTime: false,
        direction: 0,
        switchedDirections: false,
        initialHeight: 0,
        initialMajorRadius: 0,
        initialMinorRadius: 0,
        finalHeight: 0,
        finalMajorRadius: 0,
        finalMinorRadius: 0,
      }),
      particleSystemIdBytes: xferLoad.xferUser(new Uint8Array(SOURCE_FIRESTORM_PARTICLE_IDS_BYTE_LENGTH)),
      effectsFired: xferLoad.xferBool(false),
      scorchPlaced: xferLoad.xferBool(false),
      lastDamageFrame: xferLoad.xferUnsignedInt(0),
    };
  } finally {
    xferLoad.close();
  }
}

function createSourceSmartBombTargetHomingUpdateBlockData(nextCallFrameAndPhase: number): Uint8Array {
  const xferSave = new XferSave();
  xferSave.open('create-source-smart-bomb-target-homing-update');
  try {
    xferSave.xferVersion(1);
    xferSave.xferUser(createSourceUpdateModuleBaseBlockData(nextCallFrameAndPhase));
    return new Uint8Array(xferSave.getBuffer());
  } finally {
    xferSave.close();
  }
}

function parseSourceSmartBombTargetHomingUpdateBlockData(data: Uint8Array) {
  const xferLoad = new XferLoad(data.slice().buffer);
  xferLoad.open('parse-source-smart-bomb-target-homing-update');
  try {
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    return {
      nextCallFrameAndPhase: xferLoad.xferUnsignedInt(0),
    };
  } finally {
    xferLoad.close();
  }
}

interface SourceWeaponSnapshotTestState {
  version: number;
  templateName: string;
  slot: number;
  status: number;
  ammoInClip: number;
  whenWeCanFireAgain: number;
  whenPreAttackFinished: number;
  whenLastReloadStarted: number;
  lastFireFrame: number;
  suspendFxFrame: number;
  projectileStreamObjectId: number;
  laserObjectIdUnused: number;
  maxShotCount: number;
  currentBarrel: number;
  numShotsForCurrentBarrel: number;
  scatterTargetsUnused: number[];
  pitchLimited: boolean;
  leechWeaponRangeActive: boolean;
}

interface SourceFireWeaponUpdateTestState {
  nextCallFrameAndPhase: number;
  weapon: SourceWeaponSnapshotTestState;
  initialDelayFrame: number;
}

interface SourceFireWeaponCollideTestState {
  weaponPresent: boolean;
  weapon: SourceWeaponSnapshotTestState;
  everFired: boolean;
}

function createSourceWeaponSnapshotTestState(overrides: Partial<SourceWeaponSnapshotTestState> = {}) {
  return {
    version: 3,
    templateName: 'OldFireWeapon',
    slot: 0,
    status: 0,
    ammoInClip: 3,
    whenWeCanFireAgain: 0,
    whenPreAttackFinished: 0,
    whenLastReloadStarted: 0,
    lastFireFrame: 0,
    suspendFxFrame: 0,
    projectileStreamObjectId: 0,
    laserObjectIdUnused: 0,
    maxShotCount: 0,
    currentBarrel: 0,
    numShotsForCurrentBarrel: 0,
    scatterTargetsUnused: [],
    pitchLimited: false,
    leechWeaponRangeActive: false,
    ...overrides,
  };
}

function xferSourceCollideModuleBaseForTest(xfer: Xfer): void {
  xfer.xferVersion(1);
  xfer.xferVersion(1);
  xfer.xferVersion(1);
  xfer.xferVersion(1);
}

function xferSourceWeaponSnapshotForTest(
  xfer: Xfer,
  state: SourceWeaponSnapshotTestState,
): SourceWeaponSnapshotTestState {
  const version = xfer.xferVersion(state.version);
  const templateName = version >= 2 ? xfer.xferAsciiString(state.templateName) : '';
  const slot = xfer.xferInt(state.slot);
  const status = xfer.xferInt(state.status);
  const ammoInClip = xfer.xferUnsignedInt(state.ammoInClip);
  const whenWeCanFireAgain = xfer.xferUnsignedInt(state.whenWeCanFireAgain);
  const whenPreAttackFinished = xfer.xferUnsignedInt(state.whenPreAttackFinished);
  const whenLastReloadStarted = xfer.xferUnsignedInt(state.whenLastReloadStarted);
  const lastFireFrame = xfer.xferUnsignedInt(state.lastFireFrame);
  const suspendFxFrame = version >= 3 ? xfer.xferUnsignedInt(state.suspendFxFrame) : 0;
  const projectileStreamObjectId = xfer.xferObjectID(state.projectileStreamObjectId);
  const laserObjectIdUnused = xfer.xferObjectID(state.laserObjectIdUnused);
  const maxShotCount = xfer.xferInt(state.maxShotCount);
  const currentBarrel = xfer.xferInt(state.currentBarrel);
  const numShotsForCurrentBarrel = xfer.xferInt(state.numShotsForCurrentBarrel);
  const scatterCount = xfer.xferUnsignedShort(state.scatterTargetsUnused.length);
  const scatterTargetsUnused: number[] = [];
  for (let index = 0; index < scatterCount; index += 1) {
    scatterTargetsUnused.push(xfer.xferInt(state.scatterTargetsUnused[index] ?? 0));
  }
  const pitchLimited = xfer.xferBool(state.pitchLimited);
  const leechWeaponRangeActive = xfer.xferBool(state.leechWeaponRangeActive);
  return {
    version,
    templateName,
    slot,
    status,
    ammoInClip,
    whenWeCanFireAgain,
    whenPreAttackFinished,
    whenLastReloadStarted,
    lastFireFrame,
    suspendFxFrame,
    projectileStreamObjectId,
    laserObjectIdUnused,
    maxShotCount,
    currentBarrel,
    numShotsForCurrentBarrel,
    scatterTargetsUnused,
    pitchLimited,
    leechWeaponRangeActive,
  };
}

function createSourceFireWeaponCollideBlockData(state: SourceFireWeaponCollideTestState): Uint8Array {
  const xferSave = new XferSave();
  xferSave.open('create-source-fire-weapon-collide');
  try {
    xferSave.xferVersion(1);
    xferSourceCollideModuleBaseForTest(xferSave);
    xferSave.xferBool(state.weaponPresent);
    if (state.weaponPresent) {
      xferSourceWeaponSnapshotForTest(xferSave, state.weapon);
    }
    xferSave.xferBool(state.everFired);
    return new Uint8Array(xferSave.getBuffer());
  } finally {
    xferSave.close();
  }
}

function parseSourceFireWeaponCollideBlockData(data: Uint8Array): SourceFireWeaponCollideTestState {
  const xferLoad = new XferLoad(data.slice().buffer);
  xferLoad.open('parse-source-fire-weapon-collide');
  try {
    xferLoad.xferVersion(1);
    xferSourceCollideModuleBaseForTest(xferLoad);
    const weaponPresent = xferLoad.xferBool(false);
    const weapon = weaponPresent
      ? xferSourceWeaponSnapshotForTest(xferLoad, createSourceWeaponSnapshotTestState())
      : createSourceWeaponSnapshotTestState();
    const everFired = xferLoad.xferBool(false);
    return {
      weaponPresent,
      weapon,
      everFired,
    };
  } finally {
    xferLoad.close();
  }
}

function createSourceFireWeaponUpdateBlockData(state: SourceFireWeaponUpdateTestState): Uint8Array {
  const xferSave = new XferSave();
  xferSave.open('create-source-fire-weapon-update');
  try {
    xferSave.xferVersion(2);
    xferSave.xferUser(createSourceUpdateModuleBaseBlockData(state.nextCallFrameAndPhase));
    xferSourceWeaponSnapshotForTest(xferSave, state.weapon);
    xferSave.xferUnsignedInt(state.initialDelayFrame);
    return new Uint8Array(xferSave.getBuffer());
  } finally {
    xferSave.close();
  }
}

function parseSourceFireWeaponUpdateBlockData(data: Uint8Array): SourceFireWeaponUpdateTestState {
  const xferLoad = new XferLoad(data.slice().buffer);
  xferLoad.open('parse-source-fire-weapon-update');
  try {
    xferLoad.xferVersion(2);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    return {
      nextCallFrameAndPhase: xferLoad.xferUnsignedInt(0),
      weapon: xferSourceWeaponSnapshotForTest(xferLoad, createSourceWeaponSnapshotTestState()),
      initialDelayFrame: xferLoad.xferUnsignedInt(0),
    };
  } finally {
    xferLoad.close();
  }
}

function createSourceAnimationSteeringUpdateBlockData(nextCallFrameAndPhase: number): Uint8Array {
  const xferSave = new XferSave();
  xferSave.open('create-source-animation-steering-update');
  try {
    xferSave.xferVersion(1);
    xferSave.xferUser(createSourceUpdateModuleBaseBlockData(nextCallFrameAndPhase));
    return new Uint8Array(xferSave.getBuffer());
  } finally {
    xferSave.close();
  }
}

function parseSourceAnimationSteeringUpdateBlockData(data: Uint8Array): { nextCallFrameAndPhase: number } {
  const xferLoad = new XferLoad(data.slice().buffer);
  xferLoad.open('parse-source-animation-steering-update');
  try {
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    return {
      nextCallFrameAndPhase: xferLoad.xferUnsignedInt(0),
    };
  } finally {
    xferLoad.close();
  }
}

function createSourceDeployStyleAIUpdateBlockData(
  state: number,
  frameToWaitForDeploy: number,
): Uint8Array {
  const blockData = new Uint8Array([
    4,
    4,
    1,
    1,
    1,
    1,
    0xaa,
    0xbb,
    0xcc,
    0xdd,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
  ]);
  const view = new DataView(blockData.buffer, blockData.byteOffset, blockData.byteLength);
  view.setInt32(blockData.byteLength - 8, state, true);
  view.setUint32(blockData.byteLength - 4, frameToWaitForDeploy, true);
  return blockData;
}

function parseSourceDeployStyleAIUpdateBlockData(
  data: Uint8Array,
): { prefix: number[]; state: number; frameToWaitForDeploy: number } {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return {
    prefix: [...data.subarray(0, data.byteLength - 8)],
    state: view.getInt32(data.byteLength - 8, true),
    frameToWaitForDeploy: view.getUint32(data.byteLength - 4, true),
  };
}

function createSourceProductionExitRallyBlockData(
  nextCallFrameAndPhase: number,
  rallyPoint: Coord3D,
  rallyPointExists: boolean,
): Uint8Array {
  const xferSave = new XferSave();
  xferSave.open('create-source-production-exit-rally');
  try {
    xferSave.xferVersion(1);
    xferSave.xferUser(createSourceUpdateModuleBaseBlockData(nextCallFrameAndPhase));
    xferSave.xferCoord3D(rallyPoint);
    xferSave.xferBool(rallyPointExists);
    return new Uint8Array(xferSave.getBuffer());
  } finally {
    xferSave.close();
  }
}

function parseSourceProductionExitRallyBlockData(
  data: Uint8Array,
): { nextCallFrameAndPhase: number; rallyPoint: Coord3D; rallyPointExists: boolean } {
  const xferLoad = new XferLoad(data.slice().buffer);
  xferLoad.open('parse-source-production-exit-rally');
  try {
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    return {
      nextCallFrameAndPhase: xferLoad.xferUnsignedInt(0),
      rallyPoint: xferLoad.xferCoord3D({ x: 0, y: 0, z: 0 }),
      rallyPointExists: xferLoad.xferBool(false),
    };
  } finally {
    xferLoad.close();
  }
}

function createSourceQueueProductionExitBlockData(
  nextCallFrameAndPhase: number,
  currentDelay: number,
  rallyPoint: Coord3D,
  rallyPointExists: boolean,
  creationClearDistance: number,
  currentBurstCount: number,
): Uint8Array {
  const xferSave = new XferSave();
  xferSave.open('create-source-queue-production-exit');
  try {
    xferSave.xferVersion(1);
    xferSave.xferUser(createSourceUpdateModuleBaseBlockData(nextCallFrameAndPhase));
    xferSave.xferUnsignedInt(currentDelay);
    xferSave.xferCoord3D(rallyPoint);
    xferSave.xferBool(rallyPointExists);
    xferSave.xferReal(creationClearDistance);
    xferSave.xferUnsignedInt(currentBurstCount);
    return new Uint8Array(xferSave.getBuffer());
  } finally {
    xferSave.close();
  }
}

function parseSourceQueueProductionExitBlockData(data: Uint8Array) {
  const xferLoad = new XferLoad(data.slice().buffer);
  xferLoad.open('parse-source-queue-production-exit');
  try {
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    return {
      nextCallFrameAndPhase: xferLoad.xferUnsignedInt(0),
      currentDelay: xferLoad.xferUnsignedInt(0),
      rallyPoint: xferLoad.xferCoord3D({ x: 0, y: 0, z: 0 }),
      rallyPointExists: xferLoad.xferBool(false),
      creationClearDistance: xferLoad.xferReal(0),
      currentBurstCount: xferLoad.xferUnsignedInt(0),
    };
  } finally {
    xferLoad.close();
  }
}

function createSourceSpawnPointProductionExitBlockData(
  nextCallFrameAndPhase: number,
  occupierIds: number[],
): Uint8Array {
  const xferSave = new XferSave();
  xferSave.open('create-source-spawn-point-production-exit');
  try {
    xferSave.xferVersion(1);
    xferSave.xferUser(createSourceUpdateModuleBaseBlockData(nextCallFrameAndPhase));
    for (let index = 0; index < 10; index += 1) {
      xferSave.xferObjectID(occupierIds[index] ?? 0);
    }
    return new Uint8Array(xferSave.getBuffer());
  } finally {
    xferSave.close();
  }
}

function parseSourceSpawnPointProductionExitBlockData(data: Uint8Array) {
  const xferLoad = new XferLoad(data.slice().buffer);
  xferLoad.open('parse-source-spawn-point-production-exit');
  try {
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    const nextCallFrameAndPhase = xferLoad.xferUnsignedInt(0);
    const occupierIds: number[] = [];
    for (let index = 0; index < 10; index += 1) {
      occupierIds.push(xferLoad.xferObjectID(0));
    }
    return { nextCallFrameAndPhase, occupierIds };
  } finally {
    xferLoad.close();
  }
}

interface SourceDockUpdateTestState {
  nextCallFrameAndPhase: number;
  enterPosition: Coord3D;
  dockPosition: Coord3D;
  exitPosition: Coord3D;
  numberApproachPositions: number;
  positionsLoaded: boolean;
  approachPositions: Coord3D[];
  approachPositionOwners: number[];
  approachPositionReached: boolean[];
  activeDocker: number;
  dockerInside: boolean;
  dockCrippled: boolean;
  dockOpen: boolean;
}

function createSourceDockUpdateTestState(
  overrides: Partial<SourceDockUpdateTestState> = {},
): SourceDockUpdateTestState {
  return {
    nextCallFrameAndPhase: (80 << 2) | 2,
    enterPosition: { x: 1, y: 2, z: 3 },
    dockPosition: { x: 4, y: 5, z: 6 },
    exitPosition: { x: 7, y: 8, z: 9 },
    numberApproachPositions: 2,
    positionsLoaded: true,
    approachPositions: [
      { x: 10, y: 11, z: 12 },
      { x: 13, y: 14, z: 15 },
    ],
    approachPositionOwners: [21, 0],
    approachPositionReached: [true, false],
    activeDocker: 21,
    dockerInside: true,
    dockCrippled: false,
    dockOpen: false,
    ...overrides,
  };
}

function xferSourceDockUpdateForTest(
  xfer: Xfer,
  state: SourceDockUpdateTestState,
): SourceDockUpdateTestState {
  xfer.xferVersion(1);
  xfer.xferVersion(1);
  xfer.xferVersion(1);
  xfer.xferVersion(1);
  xfer.xferVersion(1);
  const nextCallFrameAndPhase = xfer.xferUnsignedInt(state.nextCallFrameAndPhase);
  const enterPosition = xfer.xferCoord3D(state.enterPosition);
  const dockPosition = xfer.xferCoord3D(state.dockPosition);
  const exitPosition = xfer.xferCoord3D(state.exitPosition);
  const numberApproachPositions = xfer.xferInt(state.numberApproachPositions);
  const positionsLoaded = xfer.xferBool(state.positionsLoaded);
  const approachPositionCount = xfer.xferInt(state.approachPositions.length);
  const approachPositions: Coord3D[] = [];
  for (let index = 0; index < approachPositionCount; index += 1) {
    approachPositions.push(xfer.xferCoord3D(state.approachPositions[index] ?? { x: 0, y: 0, z: 0 }));
  }
  const approachOwnerCount = xfer.xferInt(state.approachPositionOwners.length);
  const approachPositionOwners: number[] = [];
  for (let index = 0; index < approachOwnerCount; index += 1) {
    approachPositionOwners.push(xfer.xferObjectID(state.approachPositionOwners[index] ?? 0));
  }
  const approachReachedCount = xfer.xferInt(state.approachPositionReached.length);
  const approachPositionReached: boolean[] = [];
  for (let index = 0; index < approachReachedCount; index += 1) {
    approachPositionReached.push(xfer.xferBool(state.approachPositionReached[index] ?? false));
  }
  const activeDocker = xfer.xferObjectID(state.activeDocker);
  const dockerInside = xfer.xferBool(state.dockerInside);
  const dockCrippled = xfer.xferBool(state.dockCrippled);
  const dockOpen = xfer.xferBool(state.dockOpen);
  return {
    nextCallFrameAndPhase,
    enterPosition,
    dockPosition,
    exitPosition,
    numberApproachPositions,
    positionsLoaded,
    approachPositions,
    approachPositionOwners,
    approachPositionReached,
    activeDocker,
    dockerInside,
    dockCrippled,
    dockOpen,
  };
}

function createSourceDockOnlyUpdateBlockData(state: SourceDockUpdateTestState): Uint8Array {
  const xferSave = new XferSave();
  xferSave.open('create-source-dock-only-update');
  try {
    xferSave.xferVersion(1);
    xferSourceDockUpdateForTest(xferSave, state);
    return new Uint8Array(xferSave.getBuffer());
  } finally {
    xferSave.close();
  }
}

function parseSourceDockOnlyUpdateBlockData(data: Uint8Array): SourceDockUpdateTestState {
  const xferLoad = new XferLoad(data.slice().buffer);
  xferLoad.open('parse-source-dock-only-update');
  try {
    xferLoad.xferVersion(1);
    return xferSourceDockUpdateForTest(xferLoad, createSourceDockUpdateTestState());
  } finally {
    xferLoad.close();
  }
}

function createSourceSupplyWarehouseDockUpdateBlockData(
  dock: SourceDockUpdateTestState,
  boxesStored: number,
): Uint8Array {
  const xferSave = new XferSave();
  xferSave.open('create-source-supply-warehouse-dock-update');
  try {
    xferSave.xferVersion(1);
    xferSourceDockUpdateForTest(xferSave, dock);
    xferSave.xferInt(boxesStored);
    return new Uint8Array(xferSave.getBuffer());
  } finally {
    xferSave.close();
  }
}

function parseSourceSupplyWarehouseDockUpdateBlockData(data: Uint8Array) {
  const xferLoad = new XferLoad(data.slice().buffer);
  xferLoad.open('parse-source-supply-warehouse-dock-update');
  try {
    xferLoad.xferVersion(1);
    const dock = xferSourceDockUpdateForTest(xferLoad, createSourceDockUpdateTestState());
    return {
      dock,
      boxesStored: xferLoad.xferInt(0),
    };
  } finally {
    xferLoad.close();
  }
}

function createSourceRepairDockUpdateBlockData(
  dock: SourceDockUpdateTestState,
  lastRepair: number,
  healthToAddPerFrame: number,
): Uint8Array {
  const xferSave = new XferSave();
  xferSave.open('create-source-repair-dock-update');
  try {
    xferSave.xferVersion(1);
    xferSourceDockUpdateForTest(xferSave, dock);
    xferSave.xferObjectID(lastRepair);
    xferSave.xferReal(healthToAddPerFrame);
    return new Uint8Array(xferSave.getBuffer());
  } finally {
    xferSave.close();
  }
}

function parseSourceRepairDockUpdateBlockData(data: Uint8Array) {
  const xferLoad = new XferLoad(data.slice().buffer);
  xferLoad.open('parse-source-repair-dock-update');
  try {
    xferLoad.xferVersion(1);
    const dock = xferSourceDockUpdateForTest(xferLoad, createSourceDockUpdateTestState());
    return {
      dock,
      lastRepair: xferLoad.xferObjectID(0),
      healthToAddPerFrame: xferLoad.xferReal(0),
    };
  } finally {
    xferLoad.close();
  }
}

function createSourceRailedTransportDockUpdateBlockData(
  dock: SourceDockUpdateTestState,
): Uint8Array {
  const xferSave = new XferSave();
  xferSave.open('create-source-railed-transport-dock-update');
  try {
    xferSave.xferVersion(1);
    xferSourceDockUpdateForTest(xferSave, dock);
    xferSave.xferObjectID(31);
    xferSave.xferReal(1.25);
    xferSave.xferObjectID(32);
    xferSave.xferReal(2.5);
    xferSave.xferInt(-1);
    return new Uint8Array(xferSave.getBuffer());
  } finally {
    xferSave.close();
  }
}

function parseSourceRailedTransportDockUpdateBlockData(data: Uint8Array) {
  const xferLoad = new XferLoad(data.slice().buffer);
  xferLoad.open('parse-source-railed-transport-dock-update');
  try {
    xferLoad.xferVersion(1);
    const dock = xferSourceDockUpdateForTest(xferLoad, createSourceDockUpdateTestState());
    return {
      dock,
      dockingObjectId: xferLoad.xferObjectID(0),
      pullInsideDistancePerFrame: xferLoad.xferReal(0),
      unloadingObjectId: xferLoad.xferObjectID(0),
      pushOutsideDistancePerFrame: xferLoad.xferReal(0),
      unloadCount: xferLoad.xferInt(0),
    };
  } finally {
    xferLoad.close();
  }
}

function createSourceSupplyWarehouseCripplingBehaviorBlockData(
  nextCallFrameAndPhase: number,
  healingSuppressedUntilFrame: number,
  nextHealingFrame: number,
): Uint8Array {
  const xferSave = new XferSave();
  xferSave.open('create-source-supply-warehouse-crippling-behavior');
  try {
    xferSave.xferVersion(1);
    xferSave.xferUser(createSourceUpdateModuleBaseBlockData(nextCallFrameAndPhase));
    xferSave.xferUnsignedInt(healingSuppressedUntilFrame);
    xferSave.xferUnsignedInt(nextHealingFrame);
    return new Uint8Array(xferSave.getBuffer());
  } finally {
    xferSave.close();
  }
}

function parseSourceSupplyWarehouseCripplingBehaviorBlockData(data: Uint8Array) {
  const xferLoad = new XferLoad(data.slice().buffer);
  xferLoad.open('parse-source-supply-warehouse-crippling-behavior');
  try {
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    return {
      nextCallFrameAndPhase: xferLoad.xferUnsignedInt(0),
      healingSuppressedUntilFrame: xferLoad.xferUnsignedInt(0),
      nextHealingFrame: xferLoad.xferUnsignedInt(0),
    };
  } finally {
    xferLoad.close();
  }
}

interface SourceSpawnBehaviorTestState {
  version: number;
  initialBurstTimesInited: boolean;
  spawnTemplateName: string;
  oneShotCountdown: number;
  framesToWait: number;
  firstBatchCount: number;
  replacementTimes: number[];
  spawnIds: number[];
  active: boolean;
  aggregateHealth: boolean;
  spawnCount: number;
  selfTaskingSpawnCount: number;
}

function createSourceSpawnBehaviorTestState(
  overrides: Partial<SourceSpawnBehaviorTestState> = {},
): SourceSpawnBehaviorTestState {
  return {
    version: 2,
    initialBurstTimesInited: false,
    spawnTemplateName: 'OldDrone',
    oneShotCountdown: 3,
    framesToWait: 9,
    firstBatchCount: 2,
    replacementTimes: [30],
    spawnIds: [40],
    active: true,
    aggregateHealth: false,
    spawnCount: 1,
    selfTaskingSpawnCount: 7,
    ...overrides,
  };
}

function xferSourceBehaviorModuleBaseForTest(xfer: Xfer): void {
  xfer.xferVersion(1);
  xfer.xferVersion(1);
  xfer.xferVersion(1);
}

function xferSourceIntListForTest(xfer: Xfer, values: readonly number[]): number[] {
  xfer.xferVersion(1);
  const count = xfer.xferUnsignedShort(values.length);
  const loaded: number[] = [];
  for (let index = 0; index < count; index += 1) {
    loaded.push(xfer.xferInt(values[index] ?? 0));
  }
  return loaded;
}

function xferSourceObjectIdListForTest(xfer: Xfer, values: readonly number[]): number[] {
  xfer.xferVersion(1);
  const count = xfer.xferUnsignedShort(values.length);
  const loaded: number[] = [];
  for (let index = 0; index < count; index += 1) {
    loaded.push(xfer.xferObjectID(values[index] ?? 0));
  }
  return loaded;
}

function xferSourceSpawnBehaviorForTest(
  xfer: Xfer,
  state: SourceSpawnBehaviorTestState,
): SourceSpawnBehaviorTestState {
  const version = xfer.xferVersion(state.version);
  xferSourceBehaviorModuleBaseForTest(xfer);
  const initialBurstTimesInited = version >= 2 ? xfer.xferBool(state.initialBurstTimesInited) : false;
  const spawnTemplateName = xfer.xferAsciiString(state.spawnTemplateName);
  const oneShotCountdown = xfer.xferInt(state.oneShotCountdown);
  const framesToWait = xfer.xferInt(state.framesToWait);
  const firstBatchCount = xfer.xferInt(state.firstBatchCount);
  const replacementTimes = xferSourceIntListForTest(xfer, state.replacementTimes);
  const spawnIds = xferSourceObjectIdListForTest(xfer, state.spawnIds);
  const active = xfer.xferBool(state.active);
  const aggregateHealth = xfer.xferBool(state.aggregateHealth);
  const spawnCount = xfer.xferInt(state.spawnCount);
  const selfTaskingSpawnCount = xfer.xferUnsignedInt(state.selfTaskingSpawnCount);
  return {
    version,
    initialBurstTimesInited,
    spawnTemplateName,
    oneShotCountdown,
    framesToWait,
    firstBatchCount,
    replacementTimes,
    spawnIds,
    active,
    aggregateHealth,
    spawnCount,
    selfTaskingSpawnCount,
  };
}

function createSourceSpawnBehaviorBlockData(state: SourceSpawnBehaviorTestState): Uint8Array {
  const xferSave = new XferSave();
  xferSave.open('create-source-spawn-behavior');
  try {
    xferSourceSpawnBehaviorForTest(xferSave, state);
    return new Uint8Array(xferSave.getBuffer());
  } finally {
    xferSave.close();
  }
}

function parseSourceSpawnBehaviorBlockData(data: Uint8Array): SourceSpawnBehaviorTestState {
  const xferLoad = new XferLoad(data.slice().buffer);
  xferLoad.open('parse-source-spawn-behavior');
  try {
    return xferSourceSpawnBehaviorForTest(xferLoad, createSourceSpawnBehaviorTestState());
  } finally {
    xferLoad.close();
  }
}

function createSourceBaseOnlyUpdateModuleBlockData(nextCallFrameAndPhase: number): Uint8Array {
  const xferSave = new XferSave();
  xferSave.open('create-source-base-only-update-module');
  try {
    xferSave.xferVersion(1);
    xferSave.xferUser(createSourceUpdateModuleBaseBlockData(nextCallFrameAndPhase));
    return new Uint8Array(xferSave.getBuffer());
  } finally {
    xferSave.close();
  }
}

interface SourceProductionQueueEntryTestState {
  type: number;
  name: string;
  productionId: number;
  percentComplete: number;
  framesUnderConstruction: number;
  productionQuantityTotal: number;
  productionQuantityProduced: number;
  exitDoor: number;
}

interface SourceProductionUpdateTestState {
  nextCallFrameAndPhase: number;
  queue: SourceProductionQueueEntryTestState[];
  uniqueId: number;
  productionCount: number;
  constructionCompleteFrame: number;
  doorInfoBytes: Uint8Array;
  clearFlags: string[];
  setFlags: string[];
  flagsDirty: boolean;
}

interface SourceBattlePlanUpdateTestState {
  nextCallFrameAndPhase: number;
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
}

function xferSourceStringBitFlagsForTest(xfer: Xfer, values: string[]): string[] {
  xfer.xferVersion(1);
  const uniqueValues = [...new Set(values.filter((value) => value.trim().length > 0))];
  const count = xfer.xferInt(uniqueValues.length);
  const loaded: string[] = [];
  if (values.length === 0) {
    for (let index = 0; index < count; index += 1) {
      loaded.push(xfer.xferAsciiString(''));
    }
    return loaded;
  }
  for (const value of uniqueValues) {
    xfer.xferAsciiString(value);
  }
  return uniqueValues;
}

function xferSourceKindOfNamesForTest(xfer: Xfer, kindOfNames: string[]): string[] {
  xfer.xferVersion(1);
  const count = xfer.xferInt(kindOfNames.length);
  const loaded: string[] = [];
  if (kindOfNames.length === 0) {
    for (let index = 0; index < count; index += 1) {
      loaded.push(xfer.xferAsciiString(''));
    }
    return loaded;
  }
  for (const kindOfName of kindOfNames) {
    xfer.xferAsciiString(kindOfName);
  }
  return kindOfNames;
}

interface SourceDamageInfoInputTestState {
  sourceId: number;
  sourcePlayerMaskBytes: Uint8Array;
  damageType: number;
  damageFxOverride: number;
  deathType: number;
  amount: number;
  kill: boolean;
  damageStatusType: number;
  shockWaveVector: Coord3D;
  shockWaveAmount: number;
  shockWaveRadius: number;
  shockWaveTaperOff: number;
  sourceTemplateName: string;
}

interface SourceDamageInfoOutputTestState {
  actualDamageDealt: number;
  actualDamageClipped: number;
  noEffect: boolean;
}

interface SourceDamageInfoTestState {
  input: SourceDamageInfoInputTestState;
  output: SourceDamageInfoOutputTestState;
}

interface SourceActiveBodyTestState {
  damageScalar: number;
  currentHealth: number;
  currentSubdualDamage: number;
  prevHealth: number;
  maxHealth: number;
  initialHealth: number;
  curDamageState: number;
  nextDamageFXTime: number;
  lastDamageFXDone: number;
  lastDamageInfo: SourceDamageInfoTestState;
  lastDamageTimestamp: number;
  lastHealingTimestamp: number;
  frontCrushed: boolean;
  backCrushed: boolean;
  lastDamageCleared: boolean;
  indestructible: boolean;
  particleSystemIds: number[];
  armorSetFlags: string[];
}

function createDefaultSourceDamageInfoTestState(): SourceDamageInfoTestState {
  return {
    input: {
      sourceId: 0,
      sourcePlayerMaskBytes: new Uint8Array(SOURCE_PLAYER_MASK_BYTE_LENGTH),
      damageType: 0,
      damageFxOverride: SOURCE_DAMAGE_TYPE_UNRESISTABLE,
      deathType: 0,
      amount: 0,
      kill: false,
      damageStatusType: 0,
      shockWaveVector: { x: 0, y: 0, z: 0 },
      shockWaveAmount: 0,
      shockWaveRadius: 0,
      shockWaveTaperOff: 0,
      sourceTemplateName: '',
    },
    output: {
      actualDamageDealt: 0,
      actualDamageClipped: 0,
      noEffect: false,
    },
  };
}

function createDefaultSourceActiveBodyTestState(): SourceActiveBodyTestState {
  return {
    damageScalar: 1,
    currentHealth: 100,
    currentSubdualDamage: 0,
    prevHealth: 100,
    maxHealth: 100,
    initialHealth: 100,
    curDamageState: 0,
    nextDamageFXTime: 0,
    lastDamageFXDone: 0,
    lastDamageInfo: createDefaultSourceDamageInfoTestState(),
    lastDamageTimestamp: 0xffffffff,
    lastHealingTimestamp: 0xffffffff,
    frontCrushed: false,
    backCrushed: false,
    lastDamageCleared: false,
    indestructible: false,
    particleSystemIds: [],
    armorSetFlags: [],
  };
}

function xferSourceBodyModuleBaseForTest(xfer: Xfer, damageScalar: number): number {
  xfer.xferVersion(1);
  xfer.xferVersion(1);
  xfer.xferVersion(1);
  xfer.xferVersion(1);
  return xfer.xferReal(damageScalar);
}

function xferSourceDamageInfoInputForTest(
  xfer: Xfer,
  state: SourceDamageInfoInputTestState,
): SourceDamageInfoInputTestState {
  xfer.xferVersion(3);
  return {
    sourceId: xfer.xferObjectID(state.sourceId),
    sourcePlayerMaskBytes: xfer.xferUser(state.sourcePlayerMaskBytes),
    damageType: readRawInt32Bytes(xfer.xferUser(createRawInt32Bytes(state.damageType))),
    damageFxOverride: readRawInt32Bytes(xfer.xferUser(createRawInt32Bytes(state.damageFxOverride))),
    deathType: readRawInt32Bytes(xfer.xferUser(createRawInt32Bytes(state.deathType))),
    amount: xfer.xferReal(state.amount),
    kill: xfer.xferBool(state.kill),
    damageStatusType: readRawInt32Bytes(xfer.xferUser(createRawInt32Bytes(state.damageStatusType))),
    shockWaveVector: xfer.xferCoord3D(state.shockWaveVector),
    shockWaveAmount: xfer.xferReal(state.shockWaveAmount),
    shockWaveRadius: xfer.xferReal(state.shockWaveRadius),
    shockWaveTaperOff: xfer.xferReal(state.shockWaveTaperOff),
    sourceTemplateName: xfer.xferAsciiString(state.sourceTemplateName),
  };
}

function xferSourceDamageInfoOutputForTest(
  xfer: Xfer,
  state: SourceDamageInfoOutputTestState,
): SourceDamageInfoOutputTestState {
  xfer.xferVersion(1);
  return {
    actualDamageDealt: xfer.xferReal(state.actualDamageDealt),
    actualDamageClipped: xfer.xferReal(state.actualDamageClipped),
    noEffect: xfer.xferBool(state.noEffect),
  };
}

function xferSourceDamageInfoForTest(
  xfer: Xfer,
  state: SourceDamageInfoTestState,
): SourceDamageInfoTestState {
  xfer.xferVersion(1);
  return {
    input: xferSourceDamageInfoInputForTest(xfer, state.input),
    output: xferSourceDamageInfoOutputForTest(xfer, state.output),
  };
}

function xferSourceActiveBodyForTest(
  xfer: Xfer,
  state: SourceActiveBodyTestState,
): SourceActiveBodyTestState {
  xfer.xferVersion(1);
  const damageScalar = xferSourceBodyModuleBaseForTest(xfer, state.damageScalar);
  const currentHealth = xfer.xferReal(state.currentHealth);
  const currentSubdualDamage = xfer.xferReal(state.currentSubdualDamage);
  const prevHealth = xfer.xferReal(state.prevHealth);
  const maxHealth = xfer.xferReal(state.maxHealth);
  const initialHealth = xfer.xferReal(state.initialHealth);
  const curDamageState = readRawInt32Bytes(xfer.xferUser(createRawInt32Bytes(state.curDamageState)));
  const nextDamageFXTime = xfer.xferUnsignedInt(state.nextDamageFXTime);
  const lastDamageFXDone = readRawInt32Bytes(xfer.xferUser(createRawInt32Bytes(state.lastDamageFXDone)));
  const lastDamageInfo = xferSourceDamageInfoForTest(xfer, state.lastDamageInfo);
  const lastDamageTimestamp = xfer.xferUnsignedInt(state.lastDamageTimestamp);
  const lastHealingTimestamp = xfer.xferUnsignedInt(state.lastHealingTimestamp);
  const frontCrushed = xfer.xferBool(state.frontCrushed);
  const backCrushed = xfer.xferBool(state.backCrushed);
  const lastDamageCleared = xfer.xferBool(state.lastDamageCleared);
  const indestructible = xfer.xferBool(state.indestructible);
  const particleSystemCount = xfer.xferUnsignedShort(state.particleSystemIds.length);
  const particleSystemIds: number[] = [];
  if (xfer.getMode() === XferMode.XFER_LOAD) {
    for (let index = 0; index < particleSystemCount; index += 1) {
      particleSystemIds.push(readRawInt32Bytes(xfer.xferUser(new Uint8Array(4))));
    }
  } else {
    for (const particleSystemId of state.particleSystemIds) {
      xfer.xferUser(createRawInt32Bytes(particleSystemId));
      particleSystemIds.push(particleSystemId);
    }
  }
  const armorSetFlags = xferSourceStringBitFlagsForTest(xfer, state.armorSetFlags);
  return {
    damageScalar,
    currentHealth,
    currentSubdualDamage,
    prevHealth,
    maxHealth,
    initialHealth,
    curDamageState,
    nextDamageFXTime,
    lastDamageFXDone,
    lastDamageInfo,
    lastDamageTimestamp,
    lastHealingTimestamp,
    frontCrushed,
    backCrushed,
    lastDamageCleared,
    indestructible,
    particleSystemIds,
    armorSetFlags,
  };
}

function createSourceStructureBodyBlockData(
  state: SourceActiveBodyTestState,
  constructorObjectId: number,
): Uint8Array {
  const xferSave = new XferSave();
  xferSave.open('create-source-structure-body');
  try {
    xferSave.xferVersion(1);
    xferSourceActiveBodyForTest(xferSave, state);
    xferSave.xferObjectID(constructorObjectId);
    return new Uint8Array(xferSave.getBuffer());
  } finally {
    xferSave.close();
  }
}

function parseSourceStructureBodyBlockData(data: Uint8Array) {
  const xferLoad = new XferLoad(data.slice().buffer);
  xferLoad.open('parse-source-structure-body');
  try {
    xferLoad.xferVersion(1);
    const active = xferSourceActiveBodyForTest(xferLoad, createDefaultSourceActiveBodyTestState());
    const constructorObjectId = xferLoad.xferObjectID(0);
    return { active, constructorObjectId };
  } finally {
    xferLoad.close();
  }
}

interface SourceSpecialPowerModuleTestState {
  availableOnFrame: number;
  pausedCount: number;
  pausedOnFrame: number;
  pausedPercent: number;
}

function xferSourceSpecialPowerModuleForTest(
  xfer: Xfer,
  state: SourceSpecialPowerModuleTestState,
): SourceSpecialPowerModuleTestState {
  xfer.xferVersion(1);
  xfer.xferVersion(1);
  xfer.xferVersion(1);
  xfer.xferVersion(1);
  return {
    availableOnFrame: xfer.xferUnsignedInt(state.availableOnFrame),
    pausedCount: xfer.xferInt(state.pausedCount),
    pausedOnFrame: xfer.xferUnsignedInt(state.pausedOnFrame),
    pausedPercent: xfer.xferReal(state.pausedPercent),
  };
}

function createSourceSpecialPowerModuleBlockData(state: SourceSpecialPowerModuleTestState): Uint8Array {
  const xferSave = new XferSave();
  xferSave.open('create-source-special-power-module');
  try {
    xferSave.xferVersion(1);
    xferSourceSpecialPowerModuleForTest(xferSave, state);
    return new Uint8Array(xferSave.getBuffer());
  } finally {
    xferSave.close();
  }
}

function parseSourceSpecialPowerModuleBlockData(data: Uint8Array): SourceSpecialPowerModuleTestState {
  const xferLoad = new XferLoad(data.slice().buffer);
  xferLoad.open('parse-source-special-power-module');
  try {
    xferLoad.xferVersion(1);
    return xferSourceSpecialPowerModuleForTest(xferLoad, {
      availableOnFrame: 0,
      pausedCount: 0,
      pausedOnFrame: 0,
      pausedPercent: 0,
    });
  } finally {
    xferLoad.close();
  }
}

interface SourceOpenContainTestState {
  nextCallFrameAndPhase: number;
  passengerIds: number[];
  playerEnteredMaskBytes: Uint8Array;
  lastUnloadSoundFrame: number;
  lastLoadSoundFrame: number;
  stealthUnitsContained: number;
  doorCloseCountdown: number;
  conditionState: string[];
  firePointsBytes: Uint8Array;
  firePointStart: number;
  firePointNext: number;
  firePointSize: number;
  noFirePointsInArt: boolean;
  rallyPoint: Coord3D;
  rallyPointExists: boolean;
  enterExitEntries: Array<{ objectId: number; type: number }>;
  whichExitPath: number;
  passengerAllowedToFire: boolean;
}

interface SourceTransportContainTestState {
  open: SourceOpenContainTestState;
  payloadCreated: boolean;
  extraSlotsInUse: number;
  frameExitNotBusy: number;
}

function createDefaultSourceOpenContainTestState(): SourceOpenContainTestState {
  return {
    nextCallFrameAndPhase: (99 << 2) | 2,
    passengerIds: [],
    playerEnteredMaskBytes: new Uint8Array([0x34, 0x12]),
    lastUnloadSoundFrame: 11,
    lastLoadSoundFrame: 12,
    stealthUnitsContained: 3,
    doorCloseCountdown: 4,
    conditionState: ['LOADED'],
    firePointsBytes: new Uint8Array(SOURCE_OPEN_CONTAIN_FIRE_POINTS_BYTE_LENGTH).fill(0x5a),
    firePointStart: 1,
    firePointNext: 2,
    firePointSize: 3,
    noFirePointsInArt: true,
    rallyPoint: { x: 5, y: 6, z: 7 },
    rallyPointExists: true,
    enterExitEntries: [{ objectId: 44, type: 1 }],
    whichExitPath: 2,
    passengerAllowedToFire: false,
  };
}

function xferSourceOpenContainForTest(
  xfer: Xfer,
  state: SourceOpenContainTestState,
): SourceOpenContainTestState {
  xfer.xferVersion(2);
  xfer.xferVersion(1);
  xfer.xferVersion(1);
  xfer.xferVersion(1);
  xfer.xferVersion(1);
  const nextCallFrameAndPhase = xfer.xferUnsignedInt(state.nextCallFrameAndPhase);
  const passengerCount = xfer.xferUnsignedInt(state.passengerIds.length);
  const passengerIds: number[] = [];
  if (xfer.getMode() === XferMode.XFER_LOAD) {
    for (let index = 0; index < passengerCount; index += 1) {
      passengerIds.push(xfer.xferObjectID(0));
    }
  } else {
    for (const passengerId of state.passengerIds) {
      passengerIds.push(xfer.xferObjectID(passengerId));
    }
  }
  const playerEnteredMaskBytes = xfer.xferUser(state.playerEnteredMaskBytes);
  const lastUnloadSoundFrame = xfer.xferUnsignedInt(state.lastUnloadSoundFrame);
  const lastLoadSoundFrame = xfer.xferUnsignedInt(state.lastLoadSoundFrame);
  const stealthUnitsContained = xfer.xferUnsignedInt(state.stealthUnitsContained);
  const doorCloseCountdown = xfer.xferUnsignedInt(state.doorCloseCountdown);
  const conditionState = xferSourceStringBitFlagsForTest(xfer, state.conditionState);
  const firePointsBytes = xfer.xferUser(state.firePointsBytes);
  const firePointStart = xfer.xferInt(state.firePointStart);
  const firePointNext = xfer.xferInt(state.firePointNext);
  const firePointSize = xfer.xferInt(state.firePointSize);
  const noFirePointsInArt = xfer.xferBool(state.noFirePointsInArt);
  const rallyPoint = xfer.xferCoord3D(state.rallyPoint);
  const rallyPointExists = xfer.xferBool(state.rallyPointExists);
  const enterExitCount = xfer.xferUnsignedShort(state.enterExitEntries.length);
  const enterExitEntries: Array<{ objectId: number; type: number }> = [];
  if (xfer.getMode() === XferMode.XFER_LOAD) {
    for (let index = 0; index < enterExitCount; index += 1) {
      enterExitEntries.push({
        objectId: xfer.xferObjectID(0),
        type: readRawInt32Bytes(xfer.xferUser(new Uint8Array(4))),
      });
    }
  } else {
    for (const entry of state.enterExitEntries) {
      enterExitEntries.push({
        objectId: xfer.xferObjectID(entry.objectId),
        type: readRawInt32Bytes(xfer.xferUser(createRawInt32Bytes(entry.type))),
      });
    }
  }
  const whichExitPath = xfer.xferInt(state.whichExitPath);
  const passengerAllowedToFire = xfer.xferBool(state.passengerAllowedToFire);
  return {
    nextCallFrameAndPhase,
    passengerIds,
    playerEnteredMaskBytes,
    lastUnloadSoundFrame,
    lastLoadSoundFrame,
    stealthUnitsContained,
    doorCloseCountdown,
    conditionState,
    firePointsBytes,
    firePointStart,
    firePointNext,
    firePointSize,
    noFirePointsInArt,
    rallyPoint,
    rallyPointExists,
    enterExitEntries,
    whichExitPath,
    passengerAllowedToFire,
  };
}

function xferSourceTransportContainForTest(
  xfer: Xfer,
  state: SourceTransportContainTestState,
): SourceTransportContainTestState {
  xfer.xferVersion(1);
  return {
    open: xferSourceOpenContainForTest(xfer, state.open),
    payloadCreated: xfer.xferBool(state.payloadCreated),
    extraSlotsInUse: xfer.xferInt(state.extraSlotsInUse),
    frameExitNotBusy: xfer.xferUnsignedInt(state.frameExitNotBusy),
  };
}

function createSourceTransportContainBlockData(state: SourceTransportContainTestState): Uint8Array {
  const xferSave = new XferSave();
  xferSave.open('create-source-transport-contain');
  try {
    xferSourceTransportContainForTest(xferSave, state);
    return new Uint8Array(xferSave.getBuffer());
  } finally {
    xferSave.close();
  }
}

function parseSourceTransportContainBlockData(data: Uint8Array): SourceTransportContainTestState {
  const xferLoad = new XferLoad(data.slice().buffer);
  xferLoad.open('parse-source-transport-contain');
  try {
    return xferSourceTransportContainForTest(xferLoad, {
      open: {
        ...createDefaultSourceOpenContainTestState(),
        passengerIds: [],
        conditionState: [],
        enterExitEntries: [],
      },
      payloadCreated: false,
      extraSlotsInUse: 0,
      frameExitNotBusy: 0,
    });
  } finally {
    xferLoad.close();
  }
}

function xferSourceProductionQueueEntry(
  xfer: Xfer,
  entry: SourceProductionQueueEntryTestState,
): SourceProductionQueueEntryTestState {
  return {
    type: readRawInt32Bytes(xfer.xferUser(createRawInt32Bytes(entry.type))),
    name: xfer.xferAsciiString(entry.name),
    productionId: readRawInt32Bytes(xfer.xferUser(createRawInt32Bytes(entry.productionId))),
    percentComplete: xfer.xferReal(entry.percentComplete),
    framesUnderConstruction: xfer.xferInt(entry.framesUnderConstruction),
    productionQuantityTotal: xfer.xferInt(entry.productionQuantityTotal),
    productionQuantityProduced: xfer.xferInt(entry.productionQuantityProduced),
    exitDoor: xfer.xferInt(entry.exitDoor),
  };
}

function createSourceProductionUpdateBlockData(state: SourceProductionUpdateTestState): Uint8Array {
  const xferSave = new XferSave();
  xferSave.open('create-source-production-update');
  try {
    xferSave.xferVersion(1);
    xferSave.xferUser(createSourceUpdateModuleBaseBlockData(state.nextCallFrameAndPhase));
    xferSave.xferUnsignedShort(state.queue.length);
    for (const entry of state.queue) {
      xferSourceProductionQueueEntry(xferSave, entry);
    }
    xferSave.xferUser(createRawInt32Bytes(state.uniqueId));
    xferSave.xferUnsignedInt(state.productionCount);
    xferSave.xferUnsignedInt(state.constructionCompleteFrame);
    xferSave.xferUser(state.doorInfoBytes);
    xferSourceStringBitFlagsForTest(xferSave, state.clearFlags);
    xferSourceStringBitFlagsForTest(xferSave, state.setFlags);
    xferSave.xferBool(state.flagsDirty);
    return new Uint8Array(xferSave.getBuffer());
  } finally {
    xferSave.close();
  }
}

function createSourceBattlePlanUpdateBlockData(state: SourceBattlePlanUpdateTestState): Uint8Array {
  const xferSave = new XferSave();
  xferSave.open('create-source-battle-plan-update');
  try {
    xferSave.xferVersion(1);
    xferSave.xferUser(createSourceUpdateModuleBaseBlockData(state.nextCallFrameAndPhase));
    xferSave.xferUser(createRawInt32Bytes(state.currentPlan));
    xferSave.xferUser(createRawInt32Bytes(state.desiredPlan));
    xferSave.xferUser(createRawInt32Bytes(state.planAffectingArmy));
    xferSave.xferUser(createRawInt32Bytes(state.status));
    xferSave.xferUnsignedInt(state.nextReadyFrame);
    xferSave.xferBool(state.invalidSettings);
    xferSave.xferBool(state.centeringTurret);
    xferSave.xferReal(state.armorScalar);
    xferSave.xferInt(state.bombardment);
    xferSave.xferInt(state.searchAndDestroy);
    xferSave.xferInt(state.holdTheLine);
    xferSave.xferReal(state.sightRangeScalar);
    xferSourceKindOfNamesForTest(xferSave, state.validKindOf);
    xferSourceKindOfNamesForTest(xferSave, state.invalidKindOf);
    xferSave.xferObjectID(state.visionObjectId);
    return new Uint8Array(xferSave.getBuffer());
  } finally {
    xferSave.close();
  }
}

interface SourceRgbColorTestState {
  red: number;
  green: number;
  blue: number;
}

interface SourceMobMemberSlavedUpdateTestState {
  nextCallFrameAndPhase: number;
  slaver: number;
  framesToWait: number;
  mobState: number;
  personalColor: SourceRgbColorTestState;
  primaryVictimId: number;
  squirrellinessRatio: number;
  isSelfTasking: boolean;
  catchUpCrisisTimer: number;
}

interface SourceSlavedUpdateTestState {
  nextCallFrameAndPhase: number;
  slaver: number;
  guardPointOffset: Coord3D;
  framesToWait: number;
  repairState: number;
  repairing: boolean;
}

function xferSourceRgbColor(xfer: Xfer, color: SourceRgbColorTestState): SourceRgbColorTestState {
  return {
    red: xfer.xferReal(color.red),
    green: xfer.xferReal(color.green),
    blue: xfer.xferReal(color.blue),
  };
}

function createSourceSlavedUpdateBlockData(state: SourceSlavedUpdateTestState): Uint8Array {
  const xferSave = new XferSave();
  xferSave.open('create-source-slaved-update');
  try {
    xferSave.xferVersion(1);
    xferSave.xferUser(createSourceUpdateModuleBaseBlockData(state.nextCallFrameAndPhase));
    xferSave.xferObjectID(state.slaver);
    xferSave.xferCoord3D(state.guardPointOffset);
    xferSave.xferInt(state.framesToWait);
    xferSave.xferInt(state.repairState);
    xferSave.xferBool(state.repairing);
    return new Uint8Array(xferSave.getBuffer());
  } finally {
    xferSave.close();
  }
}

function createSourceMobMemberSlavedUpdateBlockData(state: SourceMobMemberSlavedUpdateTestState): Uint8Array {
  const xferSave = new XferSave();
  xferSave.open('create-source-mob-member-slaved-update');
  try {
    xferSave.xferVersion(1);
    xferSave.xferUser(createSourceUpdateModuleBaseBlockData(state.nextCallFrameAndPhase));
    xferSave.xferObjectID(state.slaver);
    xferSave.xferInt(state.framesToWait);
    xferSave.xferInt(state.mobState);
    xferSourceRgbColor(xferSave, state.personalColor);
    xferSave.xferObjectID(state.primaryVictimId);
    xferSave.xferReal(state.squirrellinessRatio);
    xferSave.xferBool(state.isSelfTasking);
    xferSave.xferUnsignedInt(state.catchUpCrisisTimer);
    return new Uint8Array(xferSave.getBuffer());
  } finally {
    xferSave.close();
  }
}

function sourceNeutronMissileStateToInt(
  state: 'PRELAUNCH' | 'LAUNCH' | 'ATTACK' | 'DEAD',
): number {
  switch (state) {
    case 'PRELAUNCH': return 0;
    case 'LAUNCH': return 1;
    case 'ATTACK': return 2;
    case 'DEAD': return 3;
  }
}

function sourceNeutronMissileStateFromInt(
  value: number,
): 'PRELAUNCH' | 'LAUNCH' | 'ATTACK' | 'DEAD' {
  switch (value) {
    case 0: return 'PRELAUNCH';
    case 1: return 'LAUNCH';
    case 2: return 'ATTACK';
    case 3: return 'DEAD';
    default:
      throw new Error(`Unexpected NeutronMissileUpdate state ${value}`);
  }
}

function createRawNeutronMissileLaunchParamsBytes(
  attachWeaponSlot: number,
  attachSpecificBarrelToUse: number,
  accel: { x: number; y: number; z: number },
  vel: { x: number; y: number; z: number },
  stateTimestamp: number,
): Uint8Array {
  const xferSave = new XferSave();
  xferSave.open('create-raw-neutron-missile-launch-params');
  try {
    xferSave.xferInt(attachWeaponSlot);
    xferSave.xferInt(attachSpecificBarrelToUse);
    xferSave.xferCoord3D(accel);
    xferSave.xferCoord3D(vel);
    xferSave.xferUnsignedInt(stateTimestamp);
    return new Uint8Array(xferSave.getBuffer());
  } finally {
    xferSave.close();
  }
}

function createSourceNeutronMissileUpdateBlockData(
  nextCallFrameAndPhase: number,
  state: 'PRELAUNCH' | 'LAUNCH' | 'ATTACK' | 'DEAD',
  targetPos: { x: number; y: number; z: number },
  intermedPos: { x: number; y: number; z: number },
  launcherId: number,
  rawLaunchParamsBytes: Uint8Array,
  isLaunched: boolean,
  isArmed: boolean,
  noTurnDistLeft: number,
  reachedIntermediatePos: boolean,
  frameAtLaunch: number,
  heightAtLaunch: number,
  exhaustSystemTemplateName: string,
): Uint8Array {
  const xferSave = new XferSave();
  xferSave.open('create-source-neutron-missile-update');
  try {
    xferSave.xferVersion(1);
    xferSave.xferUser(createSourceUpdateModuleBaseBlockData(nextCallFrameAndPhase));
    xferSave.xferInt(sourceNeutronMissileStateToInt(state));
    xferSave.xferCoord3D(targetPos);
    xferSave.xferCoord3D(intermedPos);
    xferSave.xferObjectID(launcherId);
    xferSave.xferUser(rawLaunchParamsBytes);
    xferSave.xferBool(isLaunched);
    xferSave.xferBool(isArmed);
    xferSave.xferReal(noTurnDistLeft);
    xferSave.xferBool(reachedIntermediatePos);
    xferSave.xferUnsignedInt(frameAtLaunch);
    xferSave.xferReal(heightAtLaunch);
    xferSave.xferAsciiString(exhaustSystemTemplateName);
    return new Uint8Array(xferSave.getBuffer());
  } finally {
    xferSave.close();
  }
}

function createSourceSpyVisionUpdateBlockData(
  nextCallFrameAndPhase: number,
  deactivateFrame: number,
  currentlyActive: boolean,
  resetTimersNextUpdate: boolean,
  disabledUntilFrame: number,
): Uint8Array {
  const xferSave = new XferSave();
  xferSave.open('create-source-spy-vision-update');
  try {
    xferSave.xferVersion(2);
    xferSave.xferUser(createSourceUpdateModuleBaseBlockData(nextCallFrameAndPhase));
    xferSave.xferUnsignedInt(deactivateFrame);
    xferSave.xferBool(currentlyActive);
    xferSave.xferBool(resetTimersNextUpdate);
    xferSave.xferUnsignedInt(disabledUntilFrame);
    return new Uint8Array(xferSave.getBuffer());
  } finally {
    xferSave.close();
  }
}

function sourceSpecialAbilityPackingStateToInt(
  state: 'NONE' | 'PACKING' | 'UNPACKING' | 'PACKED' | 'UNPACKED',
): number {
  switch (state) {
    case 'NONE': return 0;
    case 'PACKING': return 1;
    case 'UNPACKING': return 2;
    case 'PACKED': return 3;
    case 'UNPACKED': return 4;
  }
}

function sourceSpecialAbilityPackingStateFromInt(
  value: number,
): 'NONE' | 'PACKING' | 'UNPACKING' | 'PACKED' | 'UNPACKED' {
  switch (value) {
    case 0: return 'NONE';
    case 1: return 'PACKING';
    case 2: return 'UNPACKING';
    case 3: return 'PACKED';
    case 4: return 'UNPACKED';
    default:
      throw new Error(`Unexpected SpecialAbilityUpdate packing state ${value}`);
  }
}

function createSourceSpecialAbilityUpdateBlockData(
  nextCallFrameAndPhase: number,
  active: boolean,
  prepFrames: number,
  animFrames: number,
  targetId: number,
  targetPos: { x: number; y: number; z: number },
  locationCount: number,
  specialObjectIdList: number[],
  specialObjectEntries: number,
  noTargetCommand: boolean,
  packingState: 'NONE' | 'PACKING' | 'UNPACKING' | 'PACKED' | 'UNPACKED',
  facingInitiated: boolean,
  facingComplete: boolean,
  withinStartAbilityRange: boolean,
  doDisableFxParticles: boolean,
  captureFlashPhase: number,
): Uint8Array {
  const xferSave = new XferSave();
  xferSave.open('create-source-special-ability-update');
  try {
    xferSave.xferVersion(1);
    xferSave.xferUser(createSourceUpdateModuleBaseBlockData(nextCallFrameAndPhase));
    xferSave.xferBool(active);
    xferSave.xferUnsignedInt(prepFrames);
    xferSave.xferUnsignedInt(animFrames);
    xferSave.xferObjectID(targetId);
    xferSave.xferCoord3D(targetPos);
    xferSave.xferInt(locationCount);
    xferSave.xferObjectIDList(specialObjectIdList);
    xferSave.xferUnsignedInt(specialObjectEntries);
    xferSave.xferBool(noTargetCommand);
    xferSave.xferInt(sourceSpecialAbilityPackingStateToInt(packingState));
    xferSave.xferBool(facingInitiated);
    xferSave.xferBool(facingComplete);
    xferSave.xferBool(withinStartAbilityRange);
    xferSave.xferBool(doDisableFxParticles);
    xferSave.xferReal(captureFlashPhase);
    return new Uint8Array(xferSave.getBuffer());
  } finally {
    xferSave.close();
  }
}

function sourceMissileDoorStateToInt(
  state: 'CLOSED' | 'OPENING' | 'OPEN' | 'WAITING_TO_CLOSE' | 'CLOSING',
): number {
  switch (state) {
    case 'CLOSED': return 0;
    case 'OPENING': return 1;
    case 'OPEN': return 2;
    case 'WAITING_TO_CLOSE': return 3;
    case 'CLOSING': return 4;
  }
}

function sourceMissileDoorStateFromInt(
  value: number,
): 'CLOSED' | 'OPENING' | 'OPEN' | 'WAITING_TO_CLOSE' | 'CLOSING' {
  switch (value) {
    case 0: return 'CLOSED';
    case 1: return 'OPENING';
    case 2: return 'OPEN';
    case 3: return 'WAITING_TO_CLOSE';
    case 4: return 'CLOSING';
    default:
      throw new Error(`Unexpected MissileLauncher door state ${value}`);
  }
}

function createSourceMissileLauncherBuildingUpdateBlockData(
  nextCallFrameAndPhase: number,
  doorState: 'CLOSED' | 'OPENING' | 'OPEN' | 'WAITING_TO_CLOSE' | 'CLOSING',
  timeoutState: 'CLOSED' | 'OPENING' | 'OPEN' | 'WAITING_TO_CLOSE' | 'CLOSING',
  timeoutFrame: number,
): Uint8Array {
  const xferSave = new XferSave();
  xferSave.open('create-source-missile-launcher-building-update');
  try {
    xferSave.xferVersion(1);
    xferSave.xferUser(createSourceUpdateModuleBaseBlockData(nextCallFrameAndPhase));
    xferSave.xferInt(sourceMissileDoorStateToInt(doorState));
    xferSave.xferInt(sourceMissileDoorStateToInt(timeoutState));
    xferSave.xferUnsignedInt(timeoutFrame);
    return new Uint8Array(xferSave.getBuffer());
  } finally {
    xferSave.close();
  }
}

const SOURCE_PARTICLE_UPLINK_MAX_OUTER_NODES = 16;

interface TestSourceParticleUplinkVisualState {
  outerSystemIds: number[];
  laserBeamIds: number[];
  groundToOrbitBeamId: number;
  orbitToTargetBeamId: number;
  connectorSystemId: number;
  laserBaseSystemId: number;
  outerNodePositions: Coord3D[];
  outerNodeOrientations: number[][];
  connectorNodePosition: Coord3D;
  laserOriginPosition: Coord3D;
  overrideTargetDestination: Coord3D;
  upBonesCached: boolean;
  defaultInfoCached: boolean;
  invalidSettings: boolean;
}

function xferParticleUplinkIdArray(xfer: Xfer, values: readonly number[]): number[] {
  const result: number[] = [];
  for (let index = 0; index < SOURCE_PARTICLE_UPLINK_MAX_OUTER_NODES; index += 1) {
    result.push(xfer.xferUnsignedInt(values[index] ?? 0));
  }
  return result;
}

function xferParticleUplinkCoordArray(xfer: Xfer, values: readonly Coord3D[]): Coord3D[] {
  const result: Coord3D[] = [];
  for (let index = 0; index < SOURCE_PARTICLE_UPLINK_MAX_OUTER_NODES; index += 1) {
    result.push(xfer.xferCoord3D(values[index] ?? { x: 0, y: 0, z: 0 }));
  }
  return result;
}

function xferParticleUplinkRawMatrix3D(xfer: Xfer, values: readonly number[]): number[] {
  const result: number[] = [];
  for (let index = 0; index < 12; index += 1) {
    result.push(xfer.xferReal(values[index] ?? 0));
  }
  return result;
}

function xferParticleUplinkMatrixArray(xfer: Xfer, values: readonly number[][]): number[][] {
  const result: number[][] = [];
  for (let index = 0; index < SOURCE_PARTICLE_UPLINK_MAX_OUTER_NODES; index += 1) {
    result.push(xferParticleUplinkRawMatrix3D(xfer, values[index] ?? []));
  }
  return result;
}

function xferParticleUplinkVisualState(
  xfer: Xfer,
  state: TestSourceParticleUplinkVisualState,
): TestSourceParticleUplinkVisualState {
  return {
    outerSystemIds: xferParticleUplinkIdArray(xfer, state.outerSystemIds),
    laserBeamIds: xferParticleUplinkIdArray(xfer, state.laserBeamIds),
    groundToOrbitBeamId: xfer.xferUnsignedInt(state.groundToOrbitBeamId),
    orbitToTargetBeamId: xfer.xferUnsignedInt(state.orbitToTargetBeamId),
    connectorSystemId: xfer.xferUnsignedInt(state.connectorSystemId),
    laserBaseSystemId: xfer.xferUnsignedInt(state.laserBaseSystemId),
    outerNodePositions: xferParticleUplinkCoordArray(xfer, state.outerNodePositions),
    outerNodeOrientations: xferParticleUplinkMatrixArray(xfer, state.outerNodeOrientations),
    connectorNodePosition: xfer.xferCoord3D(state.connectorNodePosition),
    laserOriginPosition: xfer.xferCoord3D(state.laserOriginPosition),
    overrideTargetDestination: xfer.xferCoord3D(state.overrideTargetDestination),
    upBonesCached: xfer.xferBool(state.upBonesCached),
    defaultInfoCached: xfer.xferBool(state.defaultInfoCached),
    invalidSettings: xfer.xferBool(state.invalidSettings),
  };
}

function createTestParticleUplinkVisualState(): TestSourceParticleUplinkVisualState {
  return {
    outerSystemIds: Array.from({ length: SOURCE_PARTICLE_UPLINK_MAX_OUTER_NODES }, (_, index) => 100 + index),
    laserBeamIds: Array.from({ length: SOURCE_PARTICLE_UPLINK_MAX_OUTER_NODES }, (_, index) => 200 + index),
    groundToOrbitBeamId: 301,
    orbitToTargetBeamId: 302,
    connectorSystemId: 303,
    laserBaseSystemId: 304,
    outerNodePositions: Array.from(
      { length: SOURCE_PARTICLE_UPLINK_MAX_OUTER_NODES },
      (_, index) => ({ x: index + 1, y: index + 2, z: index + 3 }),
    ),
    outerNodeOrientations: Array.from(
      { length: SOURCE_PARTICLE_UPLINK_MAX_OUTER_NODES },
      (_, index) => [1, 0, 0, index, 0, 1, 0, index + 1, 0, 0, 1, index + 2],
    ),
    connectorNodePosition: { x: 31, y: 32, z: 33 },
    laserOriginPosition: { x: 41, y: 42, z: 43 },
    overrideTargetDestination: { x: 51, y: 52, z: 53 },
    upBonesCached: true,
    defaultInfoCached: true,
    invalidSettings: false,
  };
}

function createRawInt32Bytes(value: number): Uint8Array {
  const xferSave = new XferSave();
  xferSave.open('create-raw-int32-bytes');
  try {
    xferSave.xferInt(value);
    return new Uint8Array(xferSave.getBuffer());
  } finally {
    xferSave.close();
  }
}

function readRawInt32Bytes(data: Uint8Array): number {
  const xferLoad = new XferLoad(data.slice().buffer);
  xferLoad.open('read-raw-int32-bytes');
  try {
    return xferLoad.xferInt(0);
  } finally {
    xferLoad.close();
  }
}

function sourceParticleUplinkStatusFromInt(
  value: number,
): 'IDLE' | 'CHARGING' | 'READY_TO_FIRE' | 'FIRING' | 'POSTFIRE' {
  switch (value) {
    case 0: return 'IDLE';
    case 1: return 'CHARGING';
    case 4: return 'READY_TO_FIRE';
    case 6: return 'FIRING';
    case 7: return 'POSTFIRE';
    default:
      throw new Error(`Unexpected ParticleUplink status ${value}`);
  }
}

function createSourceParticleUplinkCannonUpdateBlockData(
  nextCallFrameAndPhase: number,
  status: number,
  laserStatus: number,
  frames: number,
  visualState: TestSourceParticleUplinkVisualState,
  initialTargetPosition: { x: number; y: number; z: number },
  currentTargetPosition: { x: number; y: number; z: number },
  scorchMarksMade: number,
  nextScorchMarkFrame: number,
  nextLaunchFXFrame: number,
  damagePulsesMade: number,
  nextDamagePulseFrame: number,
  startAttackFrame: number,
  startDecayFrame: number,
  lastDrivingClickFrame: number,
  secondLastDrivingClickFrame: number,
  manualTargetMode: boolean,
  scriptedWaypointMode: boolean,
  nextDestWaypointID: number,
): Uint8Array {
  const xferSave = new XferSave();
  xferSave.open('create-source-particle-uplink-cannon-update');
  try {
    xferSave.xferVersion(3);
    xferSave.xferUser(createSourceUpdateModuleBaseBlockData(nextCallFrameAndPhase));
    xferSave.xferUser(createRawInt32Bytes(status));
    xferSave.xferUser(createRawInt32Bytes(laserStatus));
    xferSave.xferUnsignedInt(frames);
    xferParticleUplinkVisualState(xferSave, visualState);
    xferSave.xferCoord3D(initialTargetPosition);
    xferSave.xferCoord3D(currentTargetPosition);
    xferSave.xferUnsignedInt(scorchMarksMade);
    xferSave.xferUnsignedInt(nextScorchMarkFrame);
    xferSave.xferUnsignedInt(nextLaunchFXFrame);
    xferSave.xferUnsignedInt(damagePulsesMade);
    xferSave.xferUnsignedInt(nextDamagePulseFrame);
    xferSave.xferUnsignedInt(startAttackFrame);
    xferSave.xferUnsignedInt(startDecayFrame);
    xferSave.xferUnsignedInt(lastDrivingClickFrame);
    xferSave.xferUnsignedInt(secondLastDrivingClickFrame);
    xferSave.xferBool(manualTargetMode);
    xferSave.xferBool(scriptedWaypointMode);
    xferSave.xferUnsignedInt(nextDestWaypointID);
    return new Uint8Array(xferSave.getBuffer());
  } finally {
    xferSave.close();
  }
}

function createSourceCheckpointUpdateBlockData(
  nextCallFrameAndPhase: number,
  enemyNear: boolean,
  allyNear: boolean,
  maxMinorRadius: number,
  enemyScanDelay: number,
): Uint8Array {
  const xferSave = new XferSave();
  xferSave.open('create-source-checkpoint-update');
  try {
    xferSave.xferVersion(1);
    xferSave.xferUser(createSourceUpdateModuleBaseBlockData(nextCallFrameAndPhase));
    xferSave.xferBool(enemyNear);
    xferSave.xferBool(allyNear);
    xferSave.xferReal(maxMinorRadius);
    xferSave.xferUnsignedInt(enemyScanDelay);
    return new Uint8Array(xferSave.getBuffer());
  } finally {
    xferSave.close();
  }
}

function sourceStructureToppleStateToInt(
  value: 'STANDING' | 'WAITING' | 'TOPPLING' | 'WAITING_DONE' | 'DONE',
): number {
  switch (value) {
    case 'STANDING': return 0;
    case 'WAITING': return 1;
    case 'TOPPLING': return 2;
    case 'WAITING_DONE': return 3;
    case 'DONE': return 4;
  }
}

function sourceStructureToppleStateFromInt(
  value: number,
): 'STANDING' | 'WAITING' | 'TOPPLING' | 'WAITING_DONE' | 'DONE' {
  switch (value) {
    case 0: return 'STANDING';
    case 1: return 'WAITING';
    case 2: return 'TOPPLING';
    case 3: return 'WAITING_DONE';
    case 4: return 'DONE';
    default:
      throw new Error(`Unexpected StructureTopple state ${value}`);
  }
}

function sourceToppleStateToInt(
  value: 'NONE' | 'TOPPLING' | 'BOUNCING' | 'DONE',
): number {
  switch (value) {
    case 'NONE': return 0;
    case 'TOPPLING':
    case 'BOUNCING':
      return 1;
    case 'DONE': return 2;
  }
}

function sourceToppleStateFromInt(
  value: number,
): 'NONE' | 'TOPPLING' | 'DONE' {
  switch (value) {
    case 0: return 'NONE';
    case 1: return 'TOPPLING';
    case 2: return 'DONE';
    default:
      throw new Error(`Unexpected ToppleUpdate state ${value}`);
  }
}

function sourceStructureCollapseStateToInt(
  value: 'STANDING' | 'WAITING' | 'COLLAPSING' | 'DONE',
): number {
  switch (value) {
    case 'STANDING': return 0;
    case 'WAITING': return 1;
    case 'COLLAPSING': return 2;
    case 'DONE': return 3;
  }
}

function sourceStructureCollapseStateFromInt(
  value: number,
): 'STANDING' | 'WAITING' | 'COLLAPSING' | 'DONE' {
  switch (value) {
    case 0: return 'STANDING';
    case 1: return 'WAITING';
    case 2: return 'COLLAPSING';
    case 3: return 'DONE';
    default:
      throw new Error(`Unexpected StructureCollapse state ${value}`);
  }
}

function createSourceStructureCollapseUpdateBlockData(
  nextCallFrameAndPhase: number,
  collapseFrame: number,
  burstFrame: number,
  collapseState: 'STANDING' | 'WAITING' | 'COLLAPSING' | 'DONE',
  collapseVelocity: number,
  currentHeight: number,
): Uint8Array {
  const xferSave = new XferSave();
  xferSave.open('create-source-structure-collapse-update');
  try {
    xferSave.xferVersion(1);
    xferSave.xferUser(createSourceUpdateModuleBaseBlockData(nextCallFrameAndPhase));
    xferSave.xferUnsignedInt(collapseFrame);
    xferSave.xferUnsignedInt(burstFrame);
    xferSave.xferInt(sourceStructureCollapseStateToInt(collapseState));
    xferSave.xferReal(collapseVelocity);
    xferSave.xferReal(currentHeight);
    return new Uint8Array(xferSave.getBuffer());
  } finally {
    xferSave.close();
  }
}

function createSourceToppleUpdateBlockData(
  nextCallFrameAndPhase: number,
  angularVelocity: number,
  angularAcceleration: number,
  toppleDirX: number,
  toppleDirZ: number,
  toppleState: 'NONE' | 'TOPPLING' | 'BOUNCING' | 'DONE',
  angularAccumulation: number,
  angleDeltaX: number,
  numAngleDeltaX: number,
  doBounceFx: boolean,
  options: number,
  stumpId: number,
): Uint8Array {
  const xferSave = new XferSave();
  xferSave.open('create-source-topple-update');
  try {
    xferSave.xferVersion(1);
    xferSave.xferUser(createSourceUpdateModuleBaseBlockData(nextCallFrameAndPhase));
    xferSave.xferReal(angularVelocity);
    xferSave.xferReal(angularAcceleration);
    xferSave.xferCoord3D({ x: toppleDirX, y: toppleDirZ, z: 0 });
    xferSave.xferInt(sourceToppleStateToInt(toppleState));
    xferSave.xferReal(angularAccumulation);
    xferSave.xferReal(angleDeltaX);
    xferSave.xferInt(numAngleDeltaX);
    xferSave.xferBool(doBounceFx);
    xferSave.xferUnsignedInt(options);
    xferSave.xferObjectID(stumpId);
    return new Uint8Array(xferSave.getBuffer());
  } finally {
    xferSave.close();
  }
}

function createSourceStructureToppleUpdateBlockData(
  nextCallFrameAndPhase: number,
  toppleFrame: number,
  toppleDirX: number,
  toppleDirZ: number,
  toppleState: 'STANDING' | 'WAITING' | 'TOPPLING' | 'WAITING_DONE' | 'DONE',
  toppleVelocity: number,
  accumulatedAngle: number,
  structuralIntegrity: number,
  lastCrushedLocation: number,
  nextBurstFrame: number,
  delayBurstLocation: { x: number; y: number; z: number },
): Uint8Array {
  const xferSave = new XferSave();
  xferSave.open('create-source-structure-topple-update');
  try {
    xferSave.xferVersion(1);
    xferSave.xferUser(createSourceUpdateModuleBaseBlockData(nextCallFrameAndPhase));
    xferSave.xferUnsignedInt(toppleFrame);
    xferSave.xferReal(toppleDirX);
    xferSave.xferReal(toppleDirZ);
    xferSave.xferInt(sourceStructureToppleStateToInt(toppleState));
    xferSave.xferReal(toppleVelocity);
    xferSave.xferReal(accumulatedAngle);
    xferSave.xferReal(structuralIntegrity);
    xferSave.xferReal(lastCrushedLocation);
    xferSave.xferInt(nextBurstFrame);
    xferSave.xferCoord3D(delayBurstLocation);
    return new Uint8Array(xferSave.getBuffer());
  } finally {
    xferSave.close();
  }
}

function createSourceHijackerUpdateBlockData(
  nextCallFrameAndPhase: number,
  targetId: number,
  ejectX: number,
  ejectY: number,
  ejectZ: number,
  update: boolean,
  isInVehicle: boolean,
  wasTargetAirborne: boolean,
): Uint8Array {
  const xferSave = new XferSave();
  xferSave.open('create-source-hijacker-update');
  try {
    xferSave.xferVersion(1);
    xferSave.xferUser(createSourceUpdateModuleBaseBlockData(nextCallFrameAndPhase));
    xferSave.xferObjectID(targetId);
    xferSave.xferCoord3D({ x: ejectX, y: ejectY, z: ejectZ });
    xferSave.xferBool(update);
    xferSave.xferBool(isInVehicle);
    xferSave.xferBool(wasTargetAirborne);
    return new Uint8Array(xferSave.getBuffer());
  } finally {
    xferSave.close();
  }
}

function createSourceBaseOnlyObjectHelperBlockData(nextCallFrameAndPhase: number): Uint8Array {
  const xferSave = new XferSave();
  xferSave.open('create-source-base-only-object-helper');
  try {
    xferSave.xferVersion(1);
    xferSave.xferUser(createSourceObjectHelperBaseBlockData(nextCallFrameAndPhase));
    return new Uint8Array(xferSave.getBuffer());
  } finally {
    xferSave.close();
  }
}

function createSourceObjectBlockData(
  includeHelperModules = false,
  extraModules: Array<{ identifier: string; blockData: Uint8Array }> = [],
): Uint8Array {
  const state = createEmptySourceMapEntitySaveState();
  state.objectId = 7;
  state.teamId = 3;
  state.drawableId = 9;
  state.internalName = 'UNIT_007';
  state.originalTeamName = 'TEAMUNIT';
  state.statusBits = ['SELECTABLE'];
  state.geometryInfo = {
    ...state.geometryInfo,
    majorRadius: 8,
    minorRadius: 8,
    boundingCircleRadius: 8,
    boundingSphereRadius: 8,
  };
  state.visionRange = 150;
  state.shroudClearingRange = 150;
  state.shroudRange = 150;
  state.experienceTracker = {
    ...state.experienceTracker,
    currentLevel: 1,
    currentExperience: 150,
    experienceScalar: 1,
  };
  state.weaponSet = {
    version: 1,
    templateName: 'RuntimeTank',
    templateSetFlags: [],
    weapons: [
      {
        version: 3,
        templateName: 'TankGunPrimary',
        slot: 0,
        status: 0,
        ammoInClip: 1,
        whenWeCanFireAgain: 0,
        whenPreAttackFinished: 0,
        whenLastReloadStarted: 0,
        lastFireFrame: 0,
        suspendFXFrame: 0,
        projectileStreamObjectId: 0,
        maxShotCount: 0,
        currentBarrel: 0,
        numShotsForCurrentBarrel: 0,
        scatterTargetsUnused: [],
        pitchLimited: false,
        leechWeaponRangeActive: false,
      },
      {
        version: 3,
        templateName: 'TankGunSecondary',
        slot: 1,
        status: 0,
        ammoInClip: 1,
        whenWeCanFireAgain: 0,
        whenPreAttackFinished: 0,
        whenLastReloadStarted: 0,
        lastFireFrame: 0,
        suspendFXFrame: 0,
        projectileStreamObjectId: 0,
        maxShotCount: 0,
        currentBarrel: 0,
        numShotsForCurrentBarrel: 0,
        scatterTargetsUnused: [],
        pitchLimited: false,
        leechWeaponRangeActive: false,
      },
      {
        version: 3,
        templateName: 'TankGunTertiary',
        slot: 2,
        status: 0,
        ammoInClip: 1,
        whenWeCanFireAgain: 0,
        whenPreAttackFinished: 0,
        whenLastReloadStarted: 0,
        lastFireFrame: 0,
        suspendFXFrame: 0,
        projectileStreamObjectId: 0,
        maxShotCount: 0,
        currentBarrel: 0,
        numShotsForCurrentBarrel: 0,
        scatterTargetsUnused: [],
        pitchLimited: false,
        leechWeaponRangeActive: false,
      },
    ],
    currentWeapon: 0,
    currentWeaponLockedStatus: 0,
    filledWeaponSlotMask: 0b111,
    totalAntiMask: 0,
    hasDamageWeapon: true,
    totalDamageTypeMask: [],
  };
  state.constructionPercent = 100;
  state.layer = 1;
  state.destinationLayer = 1;
  state.isSelectable = true;
  state.specialPowerBits = [
    'SPECIAL_CASH_HACK',
    'SPECIAL_PARTICLE_UPLINK_CANNON',
    'SPECIAL_STALE_POWER',
  ];
  if (includeHelperModules) {
    state.modules = [
      {
        identifier: 'ModuleTag_DefectionHelper',
        blockData: createSourceDefectionHelperBlockData((99 << 2) | 2, 12, 88, 0.5, false),
      },
      {
        identifier: 'ModuleTag_FiringTrackerHelper',
        blockData: createSourceFiringTrackerBlockData((96 << 2) | 2, 2, 44, 96),
      },
      {
        identifier: 'ModuleTag_TempWeaponBonusHelper',
        blockData: createSourceTempWeaponBonusHelperBlockData((120 << 2) | 2, 4, 120),
      },
      {
        identifier: 'ModuleTag_SubdualDamageHelper',
        blockData: createSourceSubdualDamageHelperBlockData((77 << 2) | 2, 5),
      },
      {
        identifier: 'ModuleTag_SMCHelper',
        blockData: createSourceBaseOnlyObjectHelperBlockData((64 << 2) | 2),
      },
      {
        identifier: 'ModuleTag_RepulsorHelper',
        blockData: createSourceBaseOnlyObjectHelperBlockData((80 << 2) | 2),
      },
      {
        identifier: 'ModuleTag_StatusDamageHelper',
        blockData: createSourceStatusDamageHelperBlockData((90 << 2) | 2, 38, 90),
      },
      {
        identifier: 'ModuleTag_WeaponStatusHelper',
        blockData: createSourceBaseOnlyObjectHelperBlockData((55 << 2) | 3),
      },
    ];
  }
  if (extraModules.length > 0) {
    state.modules = [...state.modules, ...extraModules];
  }
  state.modulesReady = false;
  return new Uint8Array(buildSourceMapEntityChunk(state));
}

function createSourceGameLogicChunkData(
  includeHelperModules = false,
  extraModules: Array<{ identifier: string; blockData: Uint8Array }> = [],
): Uint8Array {
  const xferSave = new XferSave();
  xferSave.open('create-source-game-logic-chunk');
  try {
    xferSave.xferVersion(3);
    xferSave.xferUnsignedInt(42);
    xferSave.xferVersion(1);
    xferSave.xferUnsignedInt(1);
    xferSave.xferAsciiString('RuntimeTank');
    xferSave.xferUnsignedShort(1);
    xferSave.xferUnsignedInt(1);
    xferSave.xferUnsignedShort(1);
    xferSave.beginBlock();
    xferSave.xferUser(createSourceObjectBlockData(includeHelperModules, extraModules));
    xferSave.endBlock();

    xferSave.xferVersion(3);
    xferSave.xferAsciiString('america');
    xferSave.xferAsciiString('mission01');
    xferSave.xferInt(0);
    xferSave.xferInt(1);

    xferSave.xferUnsignedShort(0);
    xferSave.xferBool(false);
    xferSave.xferUnsignedInt(0);
    return new Uint8Array(xferSave.getBuffer());
  } finally {
    xferSave.close();
  }
}

function readFirstSourceGameLogicObjectState(data: ArrayBuffer) {
  const chunkData = readSaveChunkData(data, 'CHUNK_GameLogic');
  if (!chunkData) {
    return null;
  }
  const xferLoad = new XferLoad(chunkData.slice().buffer);
  xferLoad.open('read-first-source-game-logic-object-state');
  try {
    xferLoad.xferVersion(3);
    xferLoad.xferUnsignedInt(0);
    xferLoad.xferVersion(1);
    const tocCount = xferLoad.xferUnsignedInt(0);
    for (let index = 0; index < tocCount; index += 1) {
      xferLoad.xferAsciiString('');
      xferLoad.xferUnsignedShort(0);
    }
    const objectCount = xferLoad.xferUnsignedInt(0);
    if (objectCount <= 0) {
      return null;
    }
    xferLoad.xferUnsignedShort(0);
    const blockSize = xferLoad.beginBlock();
    const blockStart = xferLoad.getOffset();
    const objectData = chunkData.subarray(blockStart, blockStart + blockSize);
    const parsed = parseSourceMapEntityChunk(objectData);
    xferLoad.skip(blockSize);
    xferLoad.endBlock();
    return parsed;
  } finally {
    xferLoad.close();
  }
}

function parseSourceDefectionHelperBlockData(data: Uint8Array) {
  const xferLoad = new XferLoad(data.slice().buffer);
  xferLoad.open('parse-source-defection-helper');
  try {
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    return {
      nextCallFrameAndPhase: xferLoad.xferUnsignedInt(0),
      detectionStart: xferLoad.xferUnsignedInt(0),
      detectionEnd: xferLoad.xferUnsignedInt(0),
      flashPhase: xferLoad.xferReal(0),
      doFx: xferLoad.xferBool(false),
    };
  } finally {
    xferLoad.close();
  }
}

function parseSourceFiringTrackerBlockData(data: Uint8Array) {
  const xferLoad = new XferLoad(data.slice().buffer);
  xferLoad.open('parse-source-firing-tracker');
  try {
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    return {
      nextCallFrameAndPhase: xferLoad.xferUnsignedInt(0),
      consecutiveShots: xferLoad.xferInt(0),
      victimId: xferLoad.xferUnsignedInt(0),
      frameToStartCooldown: xferLoad.xferUnsignedInt(0),
    };
  } finally {
    xferLoad.close();
  }
}

function parseSourceOverchargeBehaviorBlockData(data: Uint8Array) {
  const xferLoad = new XferLoad(data.slice().buffer);
  xferLoad.open('parse-source-overcharge-behavior');
  try {
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    return {
      nextCallFrameAndPhase: xferLoad.xferUnsignedInt(0),
      overchargeActive: xferLoad.xferBool(false),
    };
  } finally {
    xferLoad.close();
  }
}

function parseSourceAutoHealBehaviorBlockData(data: Uint8Array) {
  const xferLoad = new XferLoad(data.slice().buffer);
  xferLoad.open('parse-source-auto-heal-behavior');
  try {
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    return {
      nextCallFrameAndPhase: xferLoad.xferUnsignedInt(0),
      upgradeExecuted: (() => {
        xferLoad.xferVersion(1);
        return xferLoad.xferBool(false);
      })(),
      radiusParticleSystemId: xferLoad.xferUnsignedInt(0),
      soonestHealFrame: xferLoad.xferUnsignedInt(0),
      stopped: xferLoad.xferBool(false),
    };
  } finally {
    xferLoad.close();
  }
}

function parseSourceGrantStealthBehaviorBlockData(data: Uint8Array) {
  const xferLoad = new XferLoad(data.slice().buffer);
  xferLoad.open('parse-source-grant-stealth-behavior');
  try {
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    return {
      nextCallFrameAndPhase: xferLoad.xferUnsignedInt(0),
      radiusParticleSystemId: xferLoad.xferUnsignedInt(0),
      currentScanRadius: xferLoad.xferReal(0),
    };
  } finally {
    xferLoad.close();
  }
}

function parseSourceCountermeasuresBehaviorBlockData(data: Uint8Array) {
  const xferLoad = new XferLoad(data.slice().buffer);
  xferLoad.open('parse-source-countermeasures-behavior');
  try {
    xferLoad.xferVersion(2);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    return {
      nextCallFrameAndPhase: xferLoad.xferUnsignedInt(0),
      upgradeExecuted: (() => {
        xferLoad.xferVersion(1);
        return xferLoad.xferBool(false);
      })(),
      flareIds: xferLoad.xferObjectIDList([]),
      availableCountermeasures: xferLoad.xferUnsignedInt(0),
      activeCountermeasures: xferLoad.xferUnsignedInt(0),
      divertedMissiles: xferLoad.xferUnsignedInt(0),
      incomingMissiles: xferLoad.xferUnsignedInt(0),
      reactionFrame: xferLoad.xferUnsignedInt(0),
      nextVolleyFrame: xferLoad.xferUnsignedInt(0),
    };
  } finally {
    xferLoad.close();
  }
}

function parseSourceWeaponBonusUpdateBlockData(data: Uint8Array) {
  const xferLoad = new XferLoad(data.slice().buffer);
  xferLoad.open('parse-source-weapon-bonus-update');
  try {
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    return {
      nextCallFrameAndPhase: xferLoad.xferUnsignedInt(0),
    };
  } finally {
    xferLoad.close();
  }
}

function parseSourcePowerPlantUpdateBlockData(data: Uint8Array) {
  const xferLoad = new XferLoad(data.slice().buffer);
  xferLoad.open('parse-source-power-plant-update');
  try {
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    return {
      nextCallFrameAndPhase: xferLoad.xferUnsignedInt(0),
      extended: xferLoad.xferBool(false),
    };
  } finally {
    xferLoad.close();
  }
}

function parseSourceOclUpdateBlockData(data: Uint8Array) {
  const xferLoad = new XferLoad(data.slice().buffer);
  xferLoad.open('parse-source-ocl-update');
  try {
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    return {
      nextCallFrameAndPhase: xferLoad.xferUnsignedInt(0),
      nextCreationFrame: xferLoad.xferUnsignedInt(0),
      timerStartedFrame: xferLoad.xferUnsignedInt(0),
      factionNeutral: xferLoad.xferBool(false),
      currentPlayerColor: xferLoad.xferInt(0),
    };
  } finally {
    xferLoad.close();
  }
}

function parseSourceEnemyNearUpdateBlockData(data: Uint8Array) {
  const xferLoad = new XferLoad(data.slice().buffer);
  xferLoad.open('parse-source-enemy-near-update');
  try {
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    return {
      nextCallFrameAndPhase: xferLoad.xferUnsignedInt(0),
      enemyScanDelay: xferLoad.xferUnsignedInt(0),
      enemyNear: xferLoad.xferBool(false),
    };
  } finally {
    xferLoad.close();
  }
}

function parseSourceHordeUpdateBlockData(data: Uint8Array) {
  const xferLoad = new XferLoad(data.slice().buffer);
  xferLoad.open('parse-source-horde-update');
  try {
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    return {
      nextCallFrameAndPhase: xferLoad.xferUnsignedInt(0),
      inHorde: xferLoad.xferBool(false),
      hasFlag: xferLoad.xferBool(false),
    };
  } finally {
    xferLoad.close();
  }
}

function parseSourceProneUpdateBlockData(data: Uint8Array) {
  const xferLoad = new XferLoad(data.slice().buffer);
  xferLoad.open('parse-source-prone-update');
  try {
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    return {
      nextCallFrameAndPhase: xferLoad.xferUnsignedInt(0),
      proneFrames: xferLoad.xferInt(0),
    };
  } finally {
    xferLoad.close();
  }
}

function parseSourceFireOclAfterCooldownUpdateBlockData(data: Uint8Array) {
  const xferLoad = new XferLoad(data.slice().buffer);
  xferLoad.open('parse-source-fire-ocl-after-cooldown-update');
  try {
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    return {
      nextCallFrameAndPhase: xferLoad.xferUnsignedInt(0),
      upgradeExecuted: (() => {
        xferLoad.xferVersion(1);
        return xferLoad.xferBool(false);
      })(),
      valid: xferLoad.xferBool(false),
      consecutiveShots: xferLoad.xferUnsignedInt(0),
      startFrame: xferLoad.xferUnsignedInt(0),
    };
  } finally {
    xferLoad.close();
  }
}

function parseSourceAutoFindHealingUpdateBlockData(data: Uint8Array) {
  const xferLoad = new XferLoad(data.slice().buffer);
  xferLoad.open('parse-source-auto-find-healing-update');
  try {
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    return {
      nextCallFrameAndPhase: xferLoad.xferUnsignedInt(0),
      nextScanFrames: xferLoad.xferInt(0),
    };
  } finally {
    xferLoad.close();
  }
}

function parseSourceRadiusDecalUpdateBlockData(data: Uint8Array) {
  const xferLoad = new XferLoad(data.slice().buffer);
  xferLoad.open('parse-source-radius-decal-update');
  try {
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    return {
      nextCallFrameAndPhase: xferLoad.xferUnsignedInt(0),
      killWhenNoLongerAttacking: xferLoad.xferBool(false),
    };
  } finally {
    xferLoad.close();
  }
}

function parseSourceBaseRegenerateUpdateBlockData(data: Uint8Array) {
  const xferLoad = new XferLoad(data.slice().buffer);
  xferLoad.open('parse-source-base-regenerate-update');
  try {
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    return {
      nextCallFrameAndPhase: xferLoad.xferUnsignedInt(0),
    };
  } finally {
    xferLoad.close();
  }
}

function parseSourceLifetimeUpdateBlockData(data: Uint8Array) {
  const xferLoad = new XferLoad(data.slice().buffer);
  xferLoad.open('parse-source-lifetime-update');
  try {
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    return {
      nextCallFrameAndPhase: xferLoad.xferUnsignedInt(0),
      dieFrame: xferLoad.xferUnsignedInt(0),
    };
  } finally {
    xferLoad.close();
  }
}

function parseSourceDeletionUpdateBlockData(data: Uint8Array) {
  const xferLoad = new XferLoad(data.slice().buffer);
  xferLoad.open('parse-source-deletion-update');
  try {
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    return {
      nextCallFrameAndPhase: xferLoad.xferUnsignedInt(0),
      dieFrame: xferLoad.xferUnsignedInt(0),
    };
  } finally {
    xferLoad.close();
  }
}

function parseSourceHeightDieUpdateBlockData(data: Uint8Array) {
  const xferLoad = new XferLoad(data.slice().buffer);
  xferLoad.open('parse-source-height-die-update');
  try {
    const version = xferLoad.xferVersion(2);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    return {
      version,
      nextCallFrameAndPhase: xferLoad.xferUnsignedInt(0),
      hasDied: xferLoad.xferBool(false),
      particlesDestroyed: xferLoad.xferBool(false),
      lastPosition: xferLoad.xferCoord3D({ x: 0, y: 0, z: 0 }),
      earliestDeathFrame: version >= 2 ? xferLoad.xferUnsignedInt(0) : 0,
    };
  } finally {
    xferLoad.close();
  }
}

function parseSourceStickyBombUpdateBlockData(data: Uint8Array) {
  const xferLoad = new XferLoad(data.slice().buffer);
  xferLoad.open('parse-source-sticky-bomb-update');
  try {
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    return {
      nextCallFrameAndPhase: xferLoad.xferUnsignedInt(0),
      targetId: xferLoad.xferObjectID(0),
      dieFrame: xferLoad.xferUnsignedInt(0),
      nextPingFrame: xferLoad.xferUnsignedInt(0),
    };
  } finally {
    xferLoad.close();
  }
}

function parseSourceCleanupHazardUpdateBlockData(data: Uint8Array) {
  const xferLoad = new XferLoad(data.slice().buffer);
  xferLoad.open('parse-source-cleanup-hazard-update');
  try {
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    return {
      nextCallFrameAndPhase: xferLoad.xferUnsignedInt(0),
      bestTargetId: xferLoad.xferObjectID(0),
      inRange: xferLoad.xferBool(false),
      nextScanFrames: xferLoad.xferInt(0),
      nextShotAvailableInFrames: xferLoad.xferInt(0),
      position: xferLoad.xferCoord3D({ x: 0, y: 0, z: 0 }),
      moveRange: xferLoad.xferReal(0),
    };
  } finally {
    xferLoad.close();
  }
}

function parseSourceDemoTrapUpdateBlockData(data: Uint8Array) {
  const xferLoad = new XferLoad(data.slice().buffer);
  xferLoad.open('parse-source-demo-trap-update');
  try {
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    return {
      nextCallFrameAndPhase: xferLoad.xferUnsignedInt(0),
      nextScanFrames: xferLoad.xferInt(0),
      detonated: xferLoad.xferBool(false),
    };
  } finally {
    xferLoad.close();
  }
}

function parseSourceCommandButtonHuntUpdateBlockData(data: Uint8Array) {
  const xferLoad = new XferLoad(data.slice().buffer);
  xferLoad.open('parse-source-command-button-hunt-update');
  try {
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    return {
      nextCallFrameAndPhase: xferLoad.xferUnsignedInt(0),
      commandButtonName: xferLoad.xferAsciiString(''),
    };
  } finally {
    xferLoad.close();
  }
}

function parseSourceAutoDepositUpdateBlockData(data: Uint8Array) {
  const xferLoad = new XferLoad(data.slice().buffer);
  xferLoad.open('parse-source-auto-deposit-update');
  try {
    const version = xferLoad.xferVersion(2);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    return {
      version,
      nextCallFrameAndPhase: xferLoad.xferUnsignedInt(0),
      depositOnFrame: xferLoad.xferUnsignedInt(0),
      awardInitialCaptureBonus: xferLoad.xferBool(false),
      initialized: version > 1 ? xferLoad.xferBool(false) : false,
    };
  } finally {
    xferLoad.close();
  }
}

function parseSourceDynamicShroudClearingRangeUpdateBlockData(data: Uint8Array) {
  const xferLoad = new XferLoad(data.slice().buffer);
  xferLoad.open('parse-source-dynamic-shroud-clearing-range-update');
  try {
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    return {
      nextCallFrameAndPhase: xferLoad.xferUnsignedInt(0),
      stateCountDown: xferLoad.xferInt(0),
      totalFrames: xferLoad.xferInt(0),
      growStartDeadline: xferLoad.xferUnsignedInt(0),
      sustainDeadline: xferLoad.xferUnsignedInt(0),
      shrinkStartDeadline: xferLoad.xferUnsignedInt(0),
      doneForeverFrame: xferLoad.xferUnsignedInt(0),
      changeIntervalCountdown: xferLoad.xferUnsignedInt(0),
      decalsCreated: xferLoad.xferBool(false),
      visionChangePerInterval: xferLoad.xferReal(0),
      nativeClearingRange: xferLoad.xferReal(0),
      currentClearingRange: xferLoad.xferReal(0),
    };
  } finally {
    xferLoad.close();
  }
}

function parseSourceStealthDetectorUpdateBlockData(data: Uint8Array) {
  const xferLoad = new XferLoad(data.slice().buffer);
  xferLoad.open('parse-source-stealth-detector-update');
  try {
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    return {
      nextCallFrameAndPhase: xferLoad.xferUnsignedInt(0),
      enabled: xferLoad.xferBool(false),
    };
  } finally {
    xferLoad.close();
  }
}

function parseSourceStealthUpdateBlockData(data: Uint8Array) {
  const xferLoad = new XferLoad(data.slice().buffer);
  xferLoad.open('parse-source-stealth-update');
  try {
    xferLoad.xferVersion(2);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    return {
      nextCallFrameAndPhase: xferLoad.xferUnsignedInt(0),
      stealthAllowedFrame: xferLoad.xferUnsignedInt(0),
      detectionExpiresFrame: xferLoad.xferUnsignedInt(0),
      enabled: xferLoad.xferBool(false),
      pulsePhaseRate: xferLoad.xferReal(0),
      pulsePhase: xferLoad.xferReal(0),
      disguiseAsPlayerIndex: xferLoad.xferInt(-1),
      disguiseTemplateName: xferLoad.xferAsciiString(''),
      disguiseTransitionFrames: xferLoad.xferUnsignedInt(0),
      disguiseHalfpointReached: xferLoad.xferBool(false),
      transitioningToDisguise: xferLoad.xferBool(false),
      disguised: xferLoad.xferBool(false),
      framesGranted: xferLoad.xferUnsignedInt(0),
    };
  } finally {
    xferLoad.close();
  }
}

function parseSourceFloatUpdateBlockData(data: Uint8Array) {
  const xferLoad = new XferLoad(data.slice().buffer);
  xferLoad.open('parse-source-float-update');
  try {
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    return {
      nextCallFrameAndPhase: xferLoad.xferUnsignedInt(0),
      enabled: xferLoad.xferBool(false),
    };
  } finally {
    xferLoad.close();
  }
}

function parseSourceSpectreGunshipDeploymentUpdateBlockData(data: Uint8Array) {
  const xferLoad = new XferLoad(data.slice().buffer);
  xferLoad.open('parse-source-spectre-gunship-deployment-update');
  try {
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    return {
      nextCallFrameAndPhase: xferLoad.xferUnsignedInt(0),
      gunshipId: xferLoad.xferObjectID(0),
    };
  } finally {
    xferLoad.close();
  }
}

function parseSourceSpectreGunshipUpdateBlockData(data: Uint8Array) {
  const xferLoad = new XferLoad(data.slice().buffer);
  xferLoad.open('parse-source-spectre-gunship-update');
  try {
    xferLoad.xferVersion(2);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    const nextCallFrameAndPhase = xferLoad.xferUnsignedInt(0);
    const initialTargetPosition = xferLoad.xferCoord3D({ x: 0, y: 0, z: 0 });
    const overrideTargetDestination = xferLoad.xferCoord3D({ x: 0, y: 0, z: 0 });
    const satellitePosition = xferLoad.xferCoord3D({ x: 0, y: 0, z: 0 });
    const statusBytes = xferLoad.xferUser(new Uint8Array(4));
    return {
      nextCallFrameAndPhase,
      initialTargetPosition,
      overrideTargetDestination,
      satellitePosition,
      status: new DataView(statusBytes.buffer, statusBytes.byteOffset, statusBytes.byteLength).getInt32(0, true),
      orbitEscapeFrame: xferLoad.xferUnsignedInt(0),
      gattlingTargetPosition: xferLoad.xferCoord3D({ x: 0, y: 0, z: 0 }),
      positionToShootAt: xferLoad.xferCoord3D({ x: 0, y: 0, z: 0 }),
      okToFireHowitzerCounter: xferLoad.xferUnsignedInt(0),
      gattlingId: xferLoad.xferObjectID(0),
    };
  } finally {
    xferLoad.close();
  }
}

function parseSourcePilotFindVehicleUpdateBlockData(data: Uint8Array) {
  const xferLoad = new XferLoad(data.slice().buffer);
  xferLoad.open('parse-source-pilot-find-vehicle-update');
  try {
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    return {
      nextCallFrameAndPhase: xferLoad.xferUnsignedInt(0),
      didMoveToBase: xferLoad.xferBool(false),
    };
  } finally {
    xferLoad.close();
  }
}

function parseSourcePointDefenseLaserUpdateBlockData(data: Uint8Array) {
  const xferLoad = new XferLoad(data.slice().buffer);
  xferLoad.open('parse-source-point-defense-laser-update');
  try {
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    return {
      nextCallFrameAndPhase: xferLoad.xferUnsignedInt(0),
      bestTargetId: xferLoad.xferObjectID(0),
      inRange: xferLoad.xferBool(false),
      nextScanFrames: xferLoad.xferInt(0),
      nextShotAvailableInFrames: xferLoad.xferInt(0),
    };
  } finally {
    xferLoad.close();
  }
}

function parseSourceLeafletDropBehaviorBlockData(data: Uint8Array) {
  const xferLoad = new XferLoad(data.slice().buffer);
  xferLoad.open('parse-source-leaflet-drop-behavior');
  try {
    xferLoad.xferVersion(1);
    return {
      startFrame: xferLoad.xferUnsignedInt(0),
    };
  } finally {
    xferLoad.close();
  }
}

function parseSourceEmpUpdateBlockData(data: Uint8Array) {
  const xferLoad = new XferLoad(data.slice().buffer);
  xferLoad.open('parse-source-emp-update');
  try {
    return {
      version: xferLoad.xferVersion(1),
    };
  } finally {
    xferLoad.close();
  }
}

function parseSourceRadarUpdateBlockData(data: Uint8Array) {
  const xferLoad = new XferLoad(data.slice().buffer);
  xferLoad.open('parse-source-radar-update');
  try {
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    return {
      nextCallFrameAndPhase: xferLoad.xferUnsignedInt(0),
      extendDoneFrame: xferLoad.xferUnsignedInt(0),
      extendComplete: xferLoad.xferBool(false),
      radarActive: xferLoad.xferBool(false),
    };
  } finally {
    xferLoad.close();
  }
}

function parseSourcePhysicsBehaviorBlockData(data: Uint8Array): SourcePhysicsBehaviorTestState {
  const xferLoad = new XferLoad(data.slice().buffer);
  xferLoad.open('parse-source-physics-behavior');
  try {
    xferLoad.xferVersion(2);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    const nextCallFrameAndPhase = xferLoad.xferUnsignedInt(0);
    const yawRate = xferLoad.xferReal(0);
    const rollRate = xferLoad.xferReal(0);
    const pitchRate = xferLoad.xferReal(0);
    const accel = xferLoad.xferCoord3D({ x: 0, y: 0, z: 0 });
    const prevAccel = xferLoad.xferCoord3D({ x: 0, y: 0, z: 0 });
    const vel = xferLoad.xferCoord3D({ x: 0, y: 0, z: 0 });
    const turning = readRawInt32Bytes(xferLoad.xferUser(new Uint8Array(4)));
    return {
      nextCallFrameAndPhase,
      yawRate,
      rollRate,
      pitchRate,
      accel,
      prevAccel,
      vel,
      turning,
      ignoreCollisionsWith: xferLoad.xferObjectID(0),
      flags: xferLoad.xferInt(0),
      mass: xferLoad.xferReal(0),
      currentOverlap: xferLoad.xferObjectID(0),
      previousOverlap: xferLoad.xferObjectID(0),
      motiveForceExpires: xferLoad.xferUnsignedInt(0),
      extraBounciness: xferLoad.xferReal(0),
      extraFriction: xferLoad.xferReal(0),
      velMag: xferLoad.xferReal(0),
    };
  } finally {
    xferLoad.close();
  }
}

function parseSourceProjectileStreamUpdateBlockData(data: Uint8Array): SourceProjectileStreamUpdateTestState {
  const xferLoad = new XferLoad(data.slice().buffer);
  xferLoad.open('parse-source-projectile-stream-update');
  try {
    xferLoad.xferVersion(2);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    const nextCallFrameAndPhase = xferLoad.xferUnsignedInt(0);
    const projectileIds: number[] = [];
    for (let index = 0; index < SOURCE_PROJECTILE_STREAM_MAX; index += 1) {
      projectileIds.push(xferLoad.xferObjectID(0));
    }
    return {
      nextCallFrameAndPhase,
      projectileIds,
      nextFreeIndex: xferLoad.xferInt(0),
      firstValidIndex: xferLoad.xferInt(0),
      owningObject: xferLoad.xferObjectID(0),
      targetObject: xferLoad.xferObjectID(0),
      targetPosition: xferLoad.xferCoord3D({ x: 0, y: 0, z: 0 }),
    };
  } finally {
    xferLoad.close();
  }
}

function parseSourceBoneFxUpdateBlockData(data: Uint8Array): SourceBoneFxUpdateTestState {
  const xferLoad = new XferLoad(data.slice().buffer);
  xferLoad.open('parse-source-bone-fx-update');
  try {
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    const nextCallFrameAndPhase = xferLoad.xferUnsignedInt(0);
    const particleSystemCount = xferLoad.xferUnsignedShort(0);
    const particleSystemIds: number[] = [];
    for (let index = 0; index < particleSystemCount; index += 1) {
      particleSystemIds.push(xferLoad.xferUnsignedInt(0));
    }
    return {
      nextCallFrameAndPhase,
      particleSystemIds,
      nextFxFrame: xferSourceBoneFxIntGrid(xferLoad, []),
      nextOclFrame: xferSourceBoneFxIntGrid(xferLoad, []),
      nextParticleSystemFrame: xferSourceBoneFxIntGrid(xferLoad, []),
      fxBonePositions: xferSourceBoneFxCoordGrid(xferLoad, []),
      oclBonePositions: xferSourceBoneFxCoordGrid(xferLoad, []),
      particleSystemBonePositions: xferSourceBoneFxCoordGrid(xferLoad, []),
      currentBodyState: readRawInt32Bytes(xferLoad.xferUser(new Uint8Array(4))),
      bonesResolvedBytes: xferLoad.xferUser(new Uint8Array(SOURCE_BONE_FX_BODY_DAMAGE_TYPE_COUNT)),
      active: xferLoad.xferBool(false),
    };
  } finally {
    xferLoad.close();
  }
}

function parseSourceFlammableUpdateBlockData(data: Uint8Array): SourceFlammableUpdateTestState {
  const xferLoad = new XferLoad(data.slice().buffer);
  xferLoad.open('parse-source-flammable-update');
  try {
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    return {
      nextCallFrameAndPhase: xferLoad.xferUnsignedInt(0),
      status: readRawInt32Bytes(xferLoad.xferUser(new Uint8Array(4))),
      aflameEndFrame: xferLoad.xferUnsignedInt(0),
      burnedEndFrame: xferLoad.xferUnsignedInt(0),
      damageEndFrame: xferLoad.xferUnsignedInt(0),
      flameDamageLimit: xferLoad.xferReal(0),
      lastFlameDamageDealt: xferLoad.xferUnsignedInt(0),
    };
  } finally {
    xferLoad.close();
  }
}

function parseSourceFireSpreadUpdateBlockData(data: Uint8Array) {
  const xferLoad = new XferLoad(data.slice().buffer);
  xferLoad.open('parse-source-fire-spread-update');
  try {
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    return {
      nextCallFrameAndPhase: xferLoad.xferUnsignedInt(0),
    };
  } finally {
    xferLoad.close();
  }
}

function parseSourceProductionUpdateBlockData(data: Uint8Array): SourceProductionUpdateTestState {
  const xferLoad = new XferLoad(data.slice().buffer);
  xferLoad.open('parse-source-production-update');
  try {
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    const nextCallFrameAndPhase = xferLoad.xferUnsignedInt(0);
    const queueCount = xferLoad.xferUnsignedShort(0);
    const queue: SourceProductionQueueEntryTestState[] = [];
    for (let index = 0; index < queueCount; index += 1) {
      queue.push(xferSourceProductionQueueEntry(xferLoad, {
        type: 0,
        name: '',
        productionId: 0,
        percentComplete: 0,
        framesUnderConstruction: 0,
        productionQuantityTotal: 0,
        productionQuantityProduced: 0,
        exitDoor: 0,
      }));
    }
    return {
      nextCallFrameAndPhase,
      queue,
      uniqueId: readRawInt32Bytes(xferLoad.xferUser(new Uint8Array(4))),
      productionCount: xferLoad.xferUnsignedInt(0),
      constructionCompleteFrame: xferLoad.xferUnsignedInt(0),
      doorInfoBytes: xferLoad.xferUser(new Uint8Array(SOURCE_PRODUCTION_DOOR_INFO_BYTE_LENGTH)),
      clearFlags: xferSourceStringBitFlagsForTest(xferLoad, []),
      setFlags: xferSourceStringBitFlagsForTest(xferLoad, []),
      flagsDirty: xferLoad.xferBool(false),
    };
  } finally {
    xferLoad.close();
  }
}

function parseSourceSlavedUpdateBlockData(data: Uint8Array): SourceSlavedUpdateTestState {
  const xferLoad = new XferLoad(data.slice().buffer);
  xferLoad.open('parse-source-slaved-update');
  try {
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    return {
      nextCallFrameAndPhase: xferLoad.xferUnsignedInt(0),
      slaver: xferLoad.xferObjectID(0),
      guardPointOffset: xferLoad.xferCoord3D({ x: 0, y: 0, z: 0 }),
      framesToWait: xferLoad.xferInt(0),
      repairState: xferLoad.xferInt(0),
      repairing: xferLoad.xferBool(false),
    };
  } finally {
    xferLoad.close();
  }
}

function parseSourceBattlePlanUpdateBlockData(data: Uint8Array): SourceBattlePlanUpdateTestState {
  const xferLoad = new XferLoad(data.slice().buffer);
  xferLoad.open('parse-source-battle-plan-update');
  try {
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    return {
      nextCallFrameAndPhase: xferLoad.xferUnsignedInt(0),
      currentPlan: readRawInt32Bytes(xferLoad.xferUser(new Uint8Array(4))),
      desiredPlan: readRawInt32Bytes(xferLoad.xferUser(new Uint8Array(4))),
      planAffectingArmy: readRawInt32Bytes(xferLoad.xferUser(new Uint8Array(4))),
      status: readRawInt32Bytes(xferLoad.xferUser(new Uint8Array(4))),
      nextReadyFrame: xferLoad.xferUnsignedInt(0),
      invalidSettings: xferLoad.xferBool(false),
      centeringTurret: xferLoad.xferBool(false),
      armorScalar: xferLoad.xferReal(0),
      bombardment: xferLoad.xferInt(0),
      searchAndDestroy: xferLoad.xferInt(0),
      holdTheLine: xferLoad.xferInt(0),
      sightRangeScalar: xferLoad.xferReal(0),
      validKindOf: xferSourceKindOfNamesForTest(xferLoad, []),
      invalidKindOf: xferSourceKindOfNamesForTest(xferLoad, []),
      visionObjectId: xferLoad.xferObjectID(0),
    };
  } finally {
    xferLoad.close();
  }
}

function parseSourceMobMemberSlavedUpdateBlockData(data: Uint8Array): SourceMobMemberSlavedUpdateTestState {
  const xferLoad = new XferLoad(data.slice().buffer);
  xferLoad.open('parse-source-mob-member-slaved-update');
  try {
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    return {
      nextCallFrameAndPhase: xferLoad.xferUnsignedInt(0),
      slaver: xferLoad.xferObjectID(0),
      framesToWait: xferLoad.xferInt(0),
      mobState: xferLoad.xferInt(0),
      personalColor: xferSourceRgbColor(xferLoad, { red: 0, green: 0, blue: 0 }),
      primaryVictimId: xferLoad.xferObjectID(0),
      squirrellinessRatio: xferLoad.xferReal(0),
      isSelfTasking: xferLoad.xferBool(false),
      catchUpCrisisTimer: xferLoad.xferUnsignedInt(0),
    };
  } finally {
    xferLoad.close();
  }
}

function parseSourceNeutronMissileUpdateBlockData(data: Uint8Array) {
  const xferLoad = new XferLoad(data.slice().buffer);
  xferLoad.open('parse-source-neutron-missile-update');
  try {
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    const nextCallFrameAndPhase = xferLoad.xferUnsignedInt(0);
    const state = sourceNeutronMissileStateFromInt(xferLoad.xferInt(0));
    const targetPos = xferLoad.xferCoord3D({ x: 0, y: 0, z: 0 });
    const intermedPos = xferLoad.xferCoord3D({ x: 0, y: 0, z: 0 });
    const launcherId = xferLoad.xferObjectID(0);
    const attachWeaponSlot = xferLoad.xferInt(0);
    const attachSpecificBarrelToUse = xferLoad.xferInt(0);
    const accel = xferLoad.xferCoord3D({ x: 0, y: 0, z: 0 });
    const vel = xferLoad.xferCoord3D({ x: 0, y: 0, z: 0 });
    const stateTimestamp = xferLoad.xferUnsignedInt(0);
    const isLaunched = xferLoad.xferBool(false);
    const isArmed = xferLoad.xferBool(false);
    const noTurnDistLeft = xferLoad.xferReal(0);
    const reachedIntermediatePos = xferLoad.xferBool(false);
    const frameAtLaunch = xferLoad.xferUnsignedInt(0);
    const heightAtLaunch = xferLoad.xferReal(0);
    const exhaustSystemTemplateName = xferLoad.xferAsciiString('');
    return {
      nextCallFrameAndPhase,
      state,
      targetPos,
      intermedPos,
      launcherId,
      attachWeaponSlot,
      attachSpecificBarrelToUse,
      accel,
      vel,
      stateTimestamp,
      isLaunched,
      isArmed,
      noTurnDistLeft,
      reachedIntermediatePos,
      frameAtLaunch,
      heightAtLaunch,
      exhaustSystemTemplateName,
    };
  } finally {
    xferLoad.close();
  }
}

function parseSourceSpyVisionUpdateBlockData(data: Uint8Array) {
  const xferLoad = new XferLoad(data.slice().buffer);
  xferLoad.open('parse-source-spy-vision-update');
  try {
    const version = xferLoad.xferVersion(2);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    return {
      version,
      nextCallFrameAndPhase: xferLoad.xferUnsignedInt(0),
      deactivateFrame: xferLoad.xferUnsignedInt(0),
      currentlyActive: xferLoad.xferBool(false),
      resetTimersNextUpdate: version >= 2 ? xferLoad.xferBool(false) : false,
      disabledUntilFrame: version >= 2 ? xferLoad.xferUnsignedInt(0) : 0,
    };
  } finally {
    xferLoad.close();
  }
}

function parseSourceSpecialAbilityUpdateBlockData(data: Uint8Array) {
  const xferLoad = new XferLoad(data.slice().buffer);
  xferLoad.open('parse-source-special-ability-update');
  try {
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    return {
      nextCallFrameAndPhase: xferLoad.xferUnsignedInt(0),
      active: xferLoad.xferBool(false),
      prepFrames: xferLoad.xferUnsignedInt(0),
      animFrames: xferLoad.xferUnsignedInt(0),
      targetId: xferLoad.xferObjectID(0),
      targetPos: xferLoad.xferCoord3D({ x: 0, y: 0, z: 0 }),
      locationCount: xferLoad.xferInt(0),
      specialObjectIdList: xferLoad.xferObjectIDList([]),
      specialObjectEntries: xferLoad.xferUnsignedInt(0),
      noTargetCommand: xferLoad.xferBool(false),
      packingState: sourceSpecialAbilityPackingStateFromInt(xferLoad.xferInt(0)),
      facingInitiated: xferLoad.xferBool(false),
      facingComplete: xferLoad.xferBool(false),
      withinStartAbilityRange: xferLoad.xferBool(false),
      doDisableFxParticles: xferLoad.xferBool(true),
      captureFlashPhase: xferLoad.xferReal(0),
    };
  } finally {
    xferLoad.close();
  }
}

function parseSourceMissileLauncherBuildingUpdateBlockData(data: Uint8Array) {
  const xferLoad = new XferLoad(data.slice().buffer);
  xferLoad.open('parse-source-missile-launcher-building-update');
  try {
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    return {
      nextCallFrameAndPhase: xferLoad.xferUnsignedInt(0),
      doorState: sourceMissileDoorStateFromInt(xferLoad.xferInt(0)),
      timeoutState: sourceMissileDoorStateFromInt(xferLoad.xferInt(0)),
      timeoutFrame: xferLoad.xferUnsignedInt(0),
    };
  } finally {
    xferLoad.close();
  }
}

function parseSourceParticleUplinkCannonUpdateBlockData(data: Uint8Array) {
  const xferLoad = new XferLoad(data.slice().buffer);
  xferLoad.open('parse-source-particle-uplink-cannon-update');
  try {
    const version = xferLoad.xferVersion(3);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    return {
      version,
      nextCallFrameAndPhase: xferLoad.xferUnsignedInt(0),
      status: sourceParticleUplinkStatusFromInt(readRawInt32Bytes(xferLoad.xferUser(new Uint8Array(4)))),
      laserStatus: readRawInt32Bytes(xferLoad.xferUser(new Uint8Array(4))),
      frames: xferLoad.xferUnsignedInt(0),
      visualState: xferParticleUplinkVisualState(xferLoad, createTestParticleUplinkVisualState()),
      initialTargetPosition: xferLoad.xferCoord3D({ x: 0, y: 0, z: 0 }),
      currentTargetPosition: xferLoad.xferCoord3D({ x: 0, y: 0, z: 0 }),
      scorchMarksMade: xferLoad.xferUnsignedInt(0),
      nextScorchMarkFrame: xferLoad.xferUnsignedInt(0),
      nextLaunchFXFrame: xferLoad.xferUnsignedInt(0),
      damagePulsesMade: xferLoad.xferUnsignedInt(0),
      nextDamagePulseFrame: xferLoad.xferUnsignedInt(0),
      startAttackFrame: xferLoad.xferUnsignedInt(0),
      startDecayFrame: xferLoad.xferUnsignedInt(0),
      lastDrivingClickFrame: xferLoad.xferUnsignedInt(0),
      secondLastDrivingClickFrame: xferLoad.xferUnsignedInt(0),
      manualTargetMode: xferLoad.xferBool(false),
      scriptedWaypointMode: xferLoad.xferBool(false),
      nextDestWaypointID: xferLoad.xferUnsignedInt(0),
    };
  } finally {
    xferLoad.close();
  }
}

function parseSourceCheckpointUpdateBlockData(data: Uint8Array) {
  const xferLoad = new XferLoad(data.slice().buffer);
  xferLoad.open('parse-source-checkpoint-update');
  try {
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    return {
      nextCallFrameAndPhase: xferLoad.xferUnsignedInt(0),
      enemyNear: xferLoad.xferBool(false),
      allyNear: xferLoad.xferBool(false),
      maxMinorRadius: xferLoad.xferReal(0),
      enemyScanDelay: xferLoad.xferUnsignedInt(0),
    };
  } finally {
    xferLoad.close();
  }
}

function parseSourceStructureToppleUpdateBlockData(data: Uint8Array) {
  const xferLoad = new XferLoad(data.slice().buffer);
  xferLoad.open('parse-source-structure-topple-update');
  try {
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    return {
      nextCallFrameAndPhase: xferLoad.xferUnsignedInt(0),
      toppleFrame: xferLoad.xferUnsignedInt(0),
      toppleDirX: xferLoad.xferReal(0),
      toppleDirZ: xferLoad.xferReal(0),
      toppleState: sourceStructureToppleStateFromInt(xferLoad.xferInt(0)),
      toppleVelocity: xferLoad.xferReal(0),
      accumulatedAngle: xferLoad.xferReal(0),
      structuralIntegrity: xferLoad.xferReal(0),
      lastCrushedLocation: xferLoad.xferReal(0),
      nextBurstFrame: xferLoad.xferInt(0),
      delayBurstLocation: xferLoad.xferCoord3D({ x: 0, y: 0, z: 0 }),
    };
  } finally {
    xferLoad.close();
  }
}

function parseSourceToppleUpdateBlockData(data: Uint8Array) {
  const xferLoad = new XferLoad(data.slice().buffer);
  xferLoad.open('parse-source-topple-update');
  try {
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    return {
      nextCallFrameAndPhase: xferLoad.xferUnsignedInt(0),
      angularVelocity: xferLoad.xferReal(0),
      angularAcceleration: xferLoad.xferReal(0),
      ...(() => {
        const direction = xferLoad.xferCoord3D({ x: 0, y: 0, z: 0 });
        return {
          toppleDirX: direction.x,
          toppleDirZ: direction.y,
        };
      })(),
      toppleState: sourceToppleStateFromInt(xferLoad.xferInt(0)),
      angularAccumulation: xferLoad.xferReal(0),
      angleDeltaX: xferLoad.xferReal(0),
      numAngleDeltaX: xferLoad.xferInt(0),
      doBounceFx: xferLoad.xferBool(false),
      options: xferLoad.xferUnsignedInt(0),
      stumpId: xferLoad.xferObjectID(0),
    };
  } finally {
    xferLoad.close();
  }
}

function parseSourceStructureCollapseUpdateBlockData(data: Uint8Array) {
  const xferLoad = new XferLoad(data.slice().buffer);
  xferLoad.open('parse-source-structure-collapse-update');
  try {
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    return {
      nextCallFrameAndPhase: xferLoad.xferUnsignedInt(0),
      collapseFrame: xferLoad.xferUnsignedInt(0),
      burstFrame: xferLoad.xferUnsignedInt(0),
      collapseState: sourceStructureCollapseStateFromInt(xferLoad.xferInt(0)),
      collapseVelocity: xferLoad.xferReal(0),
      currentHeight: xferLoad.xferReal(0),
    };
  } finally {
    xferLoad.close();
  }
}

function parseSourceHijackerUpdateBlockData(data: Uint8Array) {
  const xferLoad = new XferLoad(data.slice().buffer);
  xferLoad.open('parse-source-hijacker-update');
  try {
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    return {
      nextCallFrameAndPhase: xferLoad.xferUnsignedInt(0),
      targetId: xferLoad.xferObjectID(0),
      eject: xferLoad.xferCoord3D({ x: 0, y: 0, z: 0 }),
      update: xferLoad.xferBool(false),
      isInVehicle: xferLoad.xferBool(false),
      wasTargetAirborne: xferLoad.xferBool(false),
    };
  } finally {
    xferLoad.close();
  }
}

function parseSourceTempWeaponBonusHelperBlockData(data: Uint8Array) {
  const xferLoad = new XferLoad(data.slice().buffer);
  xferLoad.open('parse-source-temp-weapon-bonus-helper');
  try {
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    return {
      nextCallFrameAndPhase: xferLoad.xferUnsignedInt(0),
      currentBonus: xferLoad.xferInt(0),
      frameToRemove: xferLoad.xferUnsignedInt(0),
    };
  } finally {
    xferLoad.close();
  }
}

function parseSourceSubdualDamageHelperBlockData(data: Uint8Array) {
  const xferLoad = new XferLoad(data.slice().buffer);
  xferLoad.open('parse-source-subdual-damage-helper');
  try {
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    return {
      nextCallFrameAndPhase: xferLoad.xferUnsignedInt(0),
      healingStepCountdown: xferLoad.xferUnsignedInt(0),
    };
  } finally {
    xferLoad.close();
  }
}

function parseSourceStatusDamageHelperBlockData(data: Uint8Array) {
  const xferLoad = new XferLoad(data.slice().buffer);
  xferLoad.open('parse-source-status-damage-helper');
  try {
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    return {
      nextCallFrameAndPhase: xferLoad.xferUnsignedInt(0),
      currentStatus: xferLoad.xferInt(0),
      frameToHeal: xferLoad.xferUnsignedInt(0),
    };
  } finally {
    xferLoad.close();
  }
}

function parseSourceBaseOnlyObjectHelperBlockData(data: Uint8Array) {
  const xferLoad = new XferLoad(data.slice().buffer);
  xferLoad.open('parse-source-base-only-object-helper');
  try {
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    return {
      nextCallFrameAndPhase: xferLoad.xferUnsignedInt(0),
    };
  } finally {
    xferLoad.close();
  }
}

function createRawGameClientDrawableBlockData(objectId: number, drawableId: number): ArrayBuffer {
  const xferSave = new XferSave();
  xferSave.open('create-raw-game-client-drawable-block-data');
  try {
    xferSave.xferObjectID(objectId);
    xferSave.xferVersion(5);
    xferSave.xferUnsignedInt(drawableId);
    xferSave.xferUser(new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd]));
    return xferSave.getBuffer();
  } finally {
    xferSave.close();
  }
}

function readCampaignChunk(data: ArrayBuffer): {
  version: number;
  campaignName: string;
  missionName: string;
  rankPoints: number;
  difficulty: number;
  isChallengeCampaign: boolean;
  playerTemplateNum: number | null;
  challengeGameInfoVersion: number | null;
  trailingBytes: number;
} | null {
  const chunkData = readSaveChunkData(data, 'CHUNK_Campaign');
  if (!chunkData) {
    return null;
  }
  const xferLoad = new XferLoad(chunkData.buffer);
  xferLoad.open('read-campaign-chunk');
  try {
    const version = xferLoad.xferVersion(5);
    const campaignName = xferLoad.xferAsciiString('');
    const missionName = xferLoad.xferAsciiString('');
    const rankPoints = xferLoad.xferInt(0);
    const difficulty = xferLoad.xferInt(0);
    let isChallengeCampaign = false;
    let challengeGameInfoVersion: number | null = null;
    let playerTemplateNum: number | null = null;
    if (version >= 4) {
      isChallengeCampaign = xferLoad.xferBool(false);
      if (isChallengeCampaign) {
        challengeGameInfoVersion = xferLoad.xferVersion(4);
        xferLoad.xferInt(0);
        xferLoad.xferInt(0);
        xferLoad.xferBool(false);
        xferLoad.xferBool(false);
        xferLoad.xferBool(false);
        xferLoad.xferInt(0);
        const slotCount = xferLoad.xferInt(0);
        for (let index = 0; index < slotCount; index += 1) {
          xferLoad.xferInt(0);
          if (challengeGameInfoVersion >= 2) {
            xferLoad.xferUnicodeString('');
          }
          xferLoad.xferBool(false);
          xferLoad.xferBool(false);
          xferLoad.xferInt(0);
          xferLoad.xferInt(0);
          xferLoad.xferInt(0);
          xferLoad.xferInt(0);
          xferLoad.xferInt(0);
          xferLoad.xferInt(0);
          xferLoad.xferInt(0);
        }
        xferLoad.xferUnsignedInt(0);
        xferLoad.xferAsciiString('');
        xferLoad.xferUnsignedInt(0);
        xferLoad.xferUnsignedInt(0);
        xferLoad.xferInt(0);
        xferLoad.xferInt(0);
        if (challengeGameInfoVersion >= 3) {
          xferLoad.xferUnsignedShort(0);
          if (challengeGameInfoVersion === 3) {
            xferLoad.xferBool(false);
          }
          xferLoad.xferVersion(1);
          xferLoad.xferUnsignedInt(0);
        }
      }
    }
    if (version >= 5) {
      playerTemplateNum = xferLoad.xferInt(0);
    }
    return {
      version,
      campaignName,
      missionName,
      rankPoints,
      difficulty,
      isChallengeCampaign,
      playerTemplateNum,
      challengeGameInfoVersion,
      trailingBytes: chunkData.byteLength - xferLoad.getOffset(),
    };
  } finally {
    xferLoad.close();
  }
}

function readSidesListChunk(data: ArrayBuffer): {
  version: number;
  sideCount: number;
  scriptLists: Array<{
    present: boolean;
    scripts: Array<{ active: boolean }>;
    groups: Array<{
      version: number;
      active: boolean;
      scripts: Array<{ active: boolean }>;
    }>;
  }>;
  trailingBytes: number;
} | null {
  const chunkData = readSaveChunkData(data, 'CHUNK_SidesList');
  if (!chunkData) {
    return null;
  }
  const xferLoad = new XferLoad(chunkData.buffer);
  xferLoad.open('read-sides-list-chunk');
  try {
    const version = xferLoad.xferVersion(1);
    const sideCount = xferLoad.xferInt(0);
    const scriptLists = [];
    for (let sideIndex = 0; sideIndex < sideCount; sideIndex += 1) {
      const present = xferLoad.xferBool(false);
      const scripts: Array<{ active: boolean }> = [];
      const groups: Array<{
        version: number;
        active: boolean;
        scripts: Array<{ active: boolean }>;
      }> = [];
      if (present) {
        const listVersion = xferLoad.xferVersion(1);
        expect(listVersion).toBe(1);
        const scriptCount = xferLoad.xferUnsignedShort(0);
        for (let scriptIndex = 0; scriptIndex < scriptCount; scriptIndex += 1) {
          const scriptVersion = xferLoad.xferVersion(1);
          expect(scriptVersion).toBe(1);
          scripts.push({ active: xferLoad.xferBool(false) });
        }
        const groupCount = xferLoad.xferUnsignedShort(0);
        for (let groupIndex = 0; groupIndex < groupCount; groupIndex += 1) {
          const groupVersion = xferLoad.xferVersion(2);
          const active = groupVersion >= 2 ? xferLoad.xferBool(false) : true;
          const groupScriptCount = xferLoad.xferUnsignedShort(0);
          const groupScripts: Array<{ active: boolean }> = [];
          for (let scriptIndex = 0; scriptIndex < groupScriptCount; scriptIndex += 1) {
            const scriptVersion = xferLoad.xferVersion(1);
            expect(scriptVersion).toBe(1);
            groupScripts.push({ active: xferLoad.xferBool(false) });
          }
          groups.push({ version: groupVersion, active, scripts: groupScripts });
        }
      }
      scriptLists.push({ present, scripts, groups });
    }
    return {
      version,
      sideCount,
      scriptLists,
      trailingBytes: chunkData.byteLength - xferLoad.getOffset(),
    };
  } finally {
    xferLoad.close();
  }
}

function createChallengeGameInfoState(
  overrides: Partial<RuntimeSaveChallengeGameInfoState> = {},
): RuntimeSaveChallengeGameInfoState {
  return {
    version: 4,
    preorderMask: 0,
    crcInterval: 100,
    inGame: true,
    inProgress: true,
    surrendered: false,
    gameId: 0,
    slots: Array.from({ length: 8 }, (_, index) => ({
      state: index === 0 ? 5 : 1,
      name: index === 0 ? 'General Granger' : 'Closed',
      isAccepted: index !== 0,
      isMuted: false,
      color: -1,
      startPos: -1,
      playerTemplate: index === 0 ? 5 : -1,
      teamNumber: -1,
      origColor: -1,
      origStartPos: -1,
      origPlayerTemplate: index === 0 ? 5 : -1,
    })),
    localIp: 0,
    mapName: 'MapsZH/Maps/GC_Challenge/GC_Challenge.map',
    mapCrc: 0,
    mapSize: 0,
    mapMask: 0,
    seed: 12345,
    superweaponRestriction: 0,
    startingCash: 10000,
    ...overrides,
  };
}

function readGameClientChunk(data: ArrayBuffer): {
  version: number;
  frame: number;
  tocVersion: number;
  tocCount: number;
  tocEntries: string[];
  drawableCount: number;
  drawableObjectIds: number[];
  drawableIds: number[];
  briefingLines: string[];
} | null {
  const chunkData = readSaveChunkData(data, 'CHUNK_GameClient');
  if (!chunkData) {
    return null;
  }
  const xferLoad = new XferLoad(chunkData.buffer);
  xferLoad.open('read-game-client-chunk');
  try {
    const version = xferLoad.xferVersion(3);
    const frame = xferLoad.xferUnsignedInt(0);
    const tocVersion = xferLoad.xferVersion(1);
    const tocCount = xferLoad.xferUnsignedInt(0);
    const tocEntries: string[] = [];
    for (let index = 0; index < tocCount; index += 1) {
      tocEntries.push(xferLoad.xferAsciiString(''));
      xferLoad.xferUnsignedShort(0);
    }
    const drawableCount = xferLoad.xferUnsignedShort(0);
    const drawableObjectIds: number[] = [];
    const drawableIds: number[] = [];
    for (let index = 0; index < drawableCount; index += 1) {
      xferLoad.xferUnsignedShort(0);
      const blockSize = xferLoad.beginBlock();
      const blockStart = xferLoad.getOffset();
      drawableObjectIds.push(xferLoad.xferObjectID(0));
      xferLoad.xferVersion(7);
      drawableIds.push(xferLoad.xferUnsignedInt(0));
      const bytesConsumed = xferLoad.getOffset() - blockStart;
      xferLoad.skip(blockSize - bytesConsumed);
      xferLoad.endBlock();
    }
    const briefingCount = xferLoad.xferInt(0);
    const briefingLines: string[] = [];
    for (let index = 0; index < briefingCount; index += 1) {
      briefingLines.push(xferLoad.xferAsciiString(''));
    }
    return {
      version,
      frame,
      tocVersion,
      tocCount,
      tocEntries,
      drawableCount,
      drawableObjectIds,
      drawableIds,
      briefingLines,
    };
  } finally {
    xferLoad.close();
  }
}

function buildExpectedTransformRows(
  x: number,
  y: number,
  z: number,
  rotationY: number,
): number[] {
  const matrix = new THREE.Matrix4();
  matrix.compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotationY, 0, 'XYZ')),
    new THREE.Vector3(1, 1, 1),
  );
  const e = matrix.elements;
  return [
    e[0]!, e[4]!, e[8]!, e[12]!,
    e[1]!, e[5]!, e[9]!, e[13]!,
    e[2]!, e[6]!, e[10]!, e[14]!,
  ];
}

function readFirstGeneratedDrawableTransform(data: ArrayBuffer): number[] | null {
  const chunkData = readSaveChunkData(data, 'CHUNK_GameClient');
  if (!chunkData) {
    return null;
  }
  const xferLoad = new XferLoad(chunkData.buffer);
  xferLoad.open('read-first-generated-drawable-transform');
  try {
    xferLoad.xferVersion(3);
    xferLoad.xferUnsignedInt(0);
    xferLoad.xferVersion(1);
    const tocCount = xferLoad.xferUnsignedInt(0);
    for (let index = 0; index < tocCount; index += 1) {
      xferLoad.xferAsciiString('');
      xferLoad.xferUnsignedShort(0);
    }
    const drawableCount = xferLoad.xferUnsignedShort(0);
    if (drawableCount <= 0) {
      return null;
    }

    xferLoad.xferUnsignedShort(0);
    const blockSize = xferLoad.beginBlock();
    const blockStart = xferLoad.getOffset();
    xferLoad.xferObjectID(0);
    xferLoad.xferVersion(7);
    xferLoad.xferUnsignedInt(0);
    xferLoad.xferVersion(1);
    const conditionCount = xferLoad.xferInt(0);
    for (let index = 0; index < conditionCount; index += 1) {
      xferLoad.xferAsciiString('');
    }
    const matrixOffset = xferLoad.getOffset();
    const matrixView = new DataView(chunkData.buffer, chunkData.byteOffset + matrixOffset, 12 * 4);
    const rows: number[] = [];
    for (let index = 0; index < 12; index += 1) {
      rows.push(matrixView.getFloat32(index * 4, true));
    }
    const consumed = xferLoad.getOffset() - blockStart;
    xferLoad.skip(blockSize - consumed);
    xferLoad.endBlock();
    return rows;
  } finally {
    xferLoad.close();
  }
}

function readTerrainVisualChunk(data: ArrayBuffer): {
  version: number;
  trailingBytes: number;
} | null {
  const chunkData = readSaveChunkData(data, 'CHUNK_TerrainVisual');
  if (!chunkData) {
    return null;
  }
  const xferLoad = new XferLoad(chunkData.buffer);
  xferLoad.open('read-terrain-visual-chunk');
  try {
    const version = xferLoad.xferVersion(1);
    return {
      version,
      trailingBytes: chunkData.byteLength - xferLoad.getOffset(),
    };
  } finally {
    xferLoad.close();
  }
}

function readGhostObjectChunk(data: ArrayBuffer): {
  version: number;
  localPlayerIndex: number;
  trailingBytes: number;
} | null {
  const chunkData = readSaveChunkData(data, 'CHUNK_GhostObject');
  if (!chunkData) {
    return null;
  }
  const xferLoad = new XferLoad(chunkData.buffer);
  xferLoad.open('read-ghost-object-chunk');
  try {
    const version = xferLoad.xferVersion(1);
    const localPlayerIndex = xferLoad.xferInt(0);
    return {
      version,
      localPlayerIndex,
      trailingBytes: chunkData.byteLength - xferLoad.getOffset(),
    };
  } finally {
    xferLoad.close();
  }
}

describe('runtime-save-game', () => {
  it('parses legacy JSON-backed CHUNK_SidesList payloads for backwards compatibility', () => {
    const legacyState = {
      version: 1,
      state: {
        scriptPlayerSideByName: new Map([['THE_PLAYER', 'america']]),
        mapScriptLists: [{
          scripts: [{
            name: 'IntroScript',
            active: true,
          }],
          groups: [],
        }],
      },
    };
    const legacySerialized = JSON.stringify({
      version: 1,
      state: {
        scriptPlayerSideByName: {
          __runtimeType: 'Map',
          entries: [['THE_PLAYER', 'america']],
        },
        mapScriptLists: [{
          scripts: [{
            name: 'IntroScript',
            active: true,
          }],
          groups: [],
        }],
      },
    });

    const xferSave = new XferSave();
    xferSave.open('legacy-sides-list');
    try {
      xferSave.xferVersion(1);
      xferSave.xferLongString(legacySerialized);
      const parsed = parseSourceSidesListChunk(xferSave.getBuffer());
      expect(parsed).toEqual(legacyState);
    } finally {
      xferSave.close();
    }
  });

  it('round-trips embedded map data and browser runtime payloads', () => {
    const mapData = {
      heightmap: {
        width: 4,
        height: 4,
        borderSize: 0,
        data: 'AAAAAAAAAAAAAAAAAAAAAA==',
      },
      sidesList: {
        sides: [{
          dict: {
            playerName: 'The_Player',
            playerFaction: 'USA',
          },
          buildList: [],
        }],
        teams: [],
      },
      objects: [],
      triggers: [],
      waypoints: {
        nodes: [{
          name: 'INTRO_FOCUS',
          position: { x: 64, z: 72 },
        }],
        links: [],
      },
      textureClasses: [],
      blendTileCount: 0,
    };

    const saveFile = buildRuntimeSaveFile({
      description: 'Runtime Save Smoke Test',
      mapPath: 'assets/maps/ScenarioSkirmish.json',
      mapData,
      gameClientBriefingLines: ['MISSION_BRIEFING_ALPHA', 'MISSION_BRIEFING_BETA'],
      cameraState: {
        targetX: 18,
        targetZ: 24,
        angle: 0.25,
        zoom: 140,
        pitch: 1,
      },
      inGameUiState: {
        version: 3,
        namedTimerLastFlashFrame: 17,
        namedTimerUsedFlashColor: true,
        showNamedTimers: false,
        namedTimers: [{
          timerName: 'SupplyDrop',
          timerText: 'Supply Drop Ready',
          isCountdown: false,
        }],
        superweaponHiddenByScript: false,
        superweapons: [{
          playerIndex: 0,
          templateName: 'SUPERWEAPONSCUDSTORM',
          powerName: 'SUPERWEAPONSCUDSTORM',
          objectId: 7,
          timestamp: 45,
          hiddenByScript: true,
          hiddenByScience: false,
          ready: false,
          evaReadyPlayed: false,
        }],
      },
      currentMusicTrackName: 'SkirmishAmbient',
      scriptEngineFadeState: {
        fadeType: 'SUBTRACT',
        minFade: 0.2,
        maxFade: 0.8,
        currentFadeValue: 0.65,
        currentFadeFrame: 11,
        increaseFrames: 12,
        holdFrames: 4,
        decreaseFrames: 6,
      },
      gameLogic: {
        captureSourceTerrainLogicRuntimeSaveState: () => ({
          version: 2,
          activeBoundary: 3,
          waterUpdates: [{
            triggerId: 9,
            changePerFrame: 0.5,
            targetHeight: 10,
            damageAmount: 25,
            currentHeight: 4,
          }],
        }),
        captureSourcePartitionRuntimeSaveState: () => ({
          version: 2,
          cellSize: 10,
          totalCellCount: 2,
          cells: [
            {
              shroudLevels: Array.from({ length: 8 }, (_, index) => ({
                currentShroud: index === 0 ? 0 : 1,
                activeShroudLevel: 0,
              })),
            },
            {
              shroudLevels: Array.from({ length: 8 }, (_, index) => ({
                currentShroud: index === 0 ? -1 : 1,
                activeShroudLevel: index === 1 ? 1 : 0,
              })),
            },
          ],
          pendingUndoShroudReveals: [],
        }),
        captureSourcePlayerRuntimeSaveState: () => ({
          version: 1,
          state: {
            playerSideByIndex: new Map([[0, 'USA']]),
            sideCredits: new Map([['USA', 1337]]),
            sideSciences: new Map([['USA', new Set(['SCIENCE_ANTHRAX_BOMB'])]]),
            controllingPlayerScriptCredits: new Map([['the_player', 900]]),
            controllingPlayerScriptSciences: new Map([['the_player', new Set(['SCIENCE_ANTHRAX_BOMB'])]]),
            sideMissionAttempts: new Map([['USA', 2]]),
          },
          tunnelTrackers: [{
            side: 'USA',
            tracker: {
              tunnelIds: [21, 22],
              passengerIds: [77],
              tunnelCount: 2,
            },
          }],
        }),
        captureSourceRadarRuntimeSaveState: () => ({
          ...createEmptyRadarState(),
          radarHidden: true,
          localObjectList: [{ objectId: 7, color: -16711936 }],
          events: Array.from({ length: 64 }, (_, index) => index === 0
            ? {
                type: 4,
                active: true,
                createFrame: 31,
                dieFrame: 151,
                fadeFrame: 136,
                color1: { red: 255, green: 255, blue: 0, alpha: 255 },
                color2: { red: 255, green: 255, blue: 128, alpha: 255 },
                worldLoc: { x: 18, y: 24, z: 0 },
                radarLoc: { x: 9, y: 12 },
                soundPlayed: false,
                sourceEntityId: 7,
                sourceTeamName: 'TEAMTHEPLAYER',
              }
            : createEmptyRadarEvent()),
          nextFreeRadarEvent: 1,
          lastRadarEvent: 0,
        }),
        captureSourceSidesListRuntimeSaveState: () => createSourceSidesListState(),
        captureSourceTeamFactoryRuntimeSaveState: () => ({
          version: 1,
          state: {
            scriptTeamsByName: new Map([['TEAMTHEPLAYER', {
              nameUpper: 'TEAMTHEPLAYER',
              prototypeNameUpper: 'TEAMTHEPLAYER',
              memberEntityIds: new Set([7]),
              created: true,
              stateName: 'ATTACKING',
              attackPrioritySetName: 'ANTIVEHICLESET',
              recruitableOverride: null,
              isAIRecruitable: true,
              homeWaypointName: 'HOME',
              controllingSide: 'america',
              controllingPlayerToken: 'the_player',
              isSingleton: true,
              maxInstances: 1,
              productionPriority: 3,
              productionPrioritySuccessIncrease: 0,
              productionPriorityFailureDecrease: 0,
              reinforcementUnitEntries: [],
              reinforcementTransportTemplateName: '',
              reinforcementStartWaypointName: '',
              reinforcementTeamStartsFull: false,
              reinforcementTransportsExit: false,
            }]]),
            scriptTeamInstanceNamesByPrototypeName: new Map([['TEAMTHEPLAYER', ['TEAMTHEPLAYER']]]),
          },
        }),
        captureSourceScriptEngineRuntimeSaveState: () => ({
          version: 1,
          state: {
            scriptCountersByName: new Map([['missiontimer', { value: 90, isCountdownTimer: true }]]),
            scriptFlagsByName: new Map([['intro_complete', true]]),
            scriptCompletedVideos: ['USA_BNN_INTRO'],
            scriptNamedMapRevealByName: new Map([['INTRO_FOCUS', {
              revealName: 'INTRO_FOCUS',
              waypointName: 'INTRO_FOCUS',
              playerName: 'USA',
              playerIndex: 0,
              worldX: 64,
              worldZ: 72,
              radius: 18,
              applied: true,
            }]]),
          },
        }),
        captureSourceInGameUiRuntimeSaveState: () => ({
          version: 1,
          state: {
            scriptDisplayedCounters: new Map([['SupplyDrop', {
              counterName: 'SupplyDrop',
              counterText: 'Supply Drop Ready',
              isCountdown: false,
              frame: 17,
            }]]),
            scriptNamedTimerDisplayEnabled: false,
            scriptSpecialPowerDisplayEnabled: true,
            scriptHiddenSpecialPowerDisplayEntityIds: new Set<number>([7]),
          },
        }),
        captureSourceGameLogicRuntimeSaveState: () => ({
          version: 1,
          gameRandomSeed: 123456789,
          nextId: 41,
          nextProjectileVisualId: 3,
          animationTime: 12.5,
          selectedEntityId: null,
          selectedEntityIds: [],
          scriptSelectionChangedFrame: 19,
          frameCounter: 21,
          controlBarDirtyFrame: 21,
          scriptObjectTopologyVersion: 4,
          scriptObjectCountChangedFrame: 20,
          defeatedSides: new Set<string>(['Observer']),
          gameEndFrame: null,
          scriptEndGameTimerActive: false,
          rankLevelLimit: 7,
          difficultyBonusesInitialized: true,
          scriptScoringEnabled: false,
          showBehindBuildingMarkers: true,
          drawIconUI: false,
          showDynamicLOD: false,
          scriptHulkMaxLifetimeOverride: 180,
          rankPointsToAddAtGameStart: 5,
          superweaponRestriction: 1,
          spawnedEntities: [],
          caveTrackers: [{
            caveIndex: 4,
            tracker: {
              tunnelIds: [91],
              passengerIds: [92, 93],
              tunnelCount: 1,
            },
          }],
          sellingEntities: [{ entityId: 7, sellFrame: 11 }],
          buildableOverrides: [{
            templateName: 'AmericaBarracks',
            buildableStatus: 'NO',
          }],
          controlBarOverrides: [{
            commandSetName: 'AMERICABARRACKSCOMMANDSET',
            slot: 1,
            commandButtonName: 'COMMAND_AMERICA_BARRACKS',
          }],
          bridgeSegments: [{
            segmentId: 4,
            passable: true,
            cellIndices: [10, 11],
            transitionIndices: [22],
            controlEntityIds: [101, 102],
            startWorldX: 1,
            startWorldZ: 2,
            endWorldX: 3,
            endWorldZ: 4,
            startSurfaceY: 5,
            endSurfaceY: 6,
          }],
          pendingWeaponDamageEvents: [{
            sourceEntityId: 7,
            primaryVictimEntityId: null,
            impactX: 18,
            impactY: 0,
            impactZ: 24,
            executeFrame: 55,
            projectilePlannedImpactFrame: 55,
            delivery: 'PROJECTILE',
            weaponName: 'TestMissile',
            launchFrame: 21,
            sourceX: 10,
            sourceY: 0,
            sourceZ: 10,
            projectileVisualId: 3,
            bezierP1Y: 0,
            bezierP2Y: 0,
            bezierFirstPercentIndent: 0,
            bezierSecondPercentIndent: 0,
            hasBezierArc: false,
            countermeasureDivertFrame: 0,
            countermeasureNoDamage: false,
            suppressImpactVisual: false,
            missileAIState: null,
            scriptWaypointPath: [{ x: 14, z: 16 }],
            damageFXOverride: 'SMALL_ARMS',
            sourceTemplateName: 'RuntimeTank',
          }],
          historicDamageLog: [{
            weaponName: 'TestMissile',
            hits: [{ frame: 20, x: 14, z: 16 }],
          }],
        }),
        captureBrowserRuntimeSaveState: () => ({
          version: 1,
          spawnedEntities: new Map([
            [7, {
              id: 7,
              templateName: 'RuntimeTank',
              kindOf: new Set(['VEHICLE', 'SELECTABLE']),
            }],
          ]),
        }),
        getObjectIdCounter: () => 41,
      },
    });

    expect(listSaveGameChunks(saveFile.data).map((chunk) => chunk.blockName)).toEqual([
      'CHUNK_GameState',
      'CHUNK_Campaign',
      'CHUNK_GameStateMap',
      'CHUNK_TerrainLogic',
      'CHUNK_TeamFactory',
      'CHUNK_Players',
      'CHUNK_GameLogic',
      'CHUNK_Radar',
      'CHUNK_ScriptEngine',
      'CHUNK_SidesList',
      'CHUNK_TacticalView',
      'CHUNK_GameClient',
      'CHUNK_InGameUI',
      'CHUNK_Partition',
      'CHUNK_ParticleSystem',
      'CHUNK_TerrainVisual',
      'CHUNK_GhostObject',
      'CHUNK_TS_RuntimeState',
    ]);

    const parsed = parseRuntimeSaveFile(saveFile.data);
    const playerState = parsed.gameLogicPlayersState;
    const partitionState = parsed.gameLogicPartitionState;
    const radarState = parsed.gameLogicRadarState;
    const sidesListState = parsed.gameLogicSidesListState;
    const teamFactoryState = parsed.gameLogicTeamFactoryState
      ?? (
        parsed.sourceTeamFactoryChunkData
          ? applySourceTeamFactoryChunkToState(
              parsed.sourceTeamFactoryChunkData,
              createEmptyTeamFactoryState('TEAMTHEPLAYER', {
                attackPrioritySetName: 'ANTIVEHICLESET',
                isAIRecruitable: true,
                homeWaypointName: 'HOME',
                controllingSide: 'america',
                controllingPlayerToken: 'the_player',
                isSingleton: true,
                maxInstances: 1,
                productionPriority: 3,
              }),
              parsed.gameLogicPlayersState,
              parsed.gameLogicSidesListState,
            )
          : null
      );
    const scriptEngineState = parsed.gameLogicScriptEngineState;
    const inGameUiState = parsed.gameLogicInGameUiState;
    const terrainLogicState = parsed.gameLogicTerrainLogicState;
    const coreState = parsed.gameLogicCoreState;
    const logicState = parsed.gameLogicState as {
      version: number;
      spawnedEntities: Map<number, { id: number; templateName: string; kindOf: Set<string> }>;
    };
    const sidesListChunk = readSidesListChunk(saveFile.data);
    const gameClientChunk = readGameClientChunk(saveFile.data);
    const terrainVisualChunk = readTerrainVisualChunk(saveFile.data);
    const ghostObjectChunk = readGhostObjectChunk(saveFile.data);

    expect(parsed.metadata.description).toBe('Runtime Save Smoke Test');
    expect(parsed.mapObjectIdCounter).toBe(41);
    expect(parsed.mapDrawableIdCounter).toBe(41);
    expect(inspectRuntimeSaveCoreChunkStatus(saveFile.data)).toEqual([
      { blockName: 'CHUNK_Players', mode: 'parsed' },
      { blockName: 'CHUNK_GameLogic', mode: 'legacy' },
      { blockName: 'CHUNK_ScriptEngine', mode: 'parsed' },
      { blockName: 'CHUNK_InGameUI', mode: 'parsed' },
    ]);
    expect(inspectGameLogicChunkLayout(readSaveChunkData(saveFile.data, 'CHUNK_GameLogic')!)).toEqual({
      layout: 'legacy',
      version: null,
      frameCounter: null,
      objectTocCount: null,
      objectCount: null,
      firstObjectTemplateName: null,
      firstObjectTocId: null,
      firstObjectVersion: null,
      firstObjectInternalName: null,
      firstObjectTeamId: null,
      firstObjectLayout: null,
      reason: expect.any(String),
    });
    expect(gameClientChunk).toEqual({
      version: 3,
      frame: 21,
      tocVersion: 1,
      tocCount: 0,
      tocEntries: [],
      drawableCount: 0,
      drawableObjectIds: [],
      drawableIds: [],
      briefingLines: ['MISSION_BRIEFING_ALPHA', 'MISSION_BRIEFING_BETA'],
    });
    expect(parsed.gameClientState).toEqual({
      version: 3,
      prefixBytes: expect.any(ArrayBuffer),
      briefingLines: ['MISSION_BRIEFING_ALPHA', 'MISSION_BRIEFING_BETA'],
      drawables: [],
    });
    expect(sidesListChunk).toEqual({
      version: 1,
      sideCount: 1,
      scriptLists: [{
        present: true,
        scripts: [{ active: true }],
        groups: [],
      }],
      trailingBytes: 0,
    });
    expect(terrainVisualChunk).toEqual({
      version: 1,
      trailingBytes: 0,
    });
    expect(ghostObjectChunk).toEqual({
      version: 1,
      localPlayerIndex: 0,
      trailingBytes: 0,
    });
    expect(parsed.mapPath).toBe('assets/maps/ScenarioSkirmish.json');
    expect(parsed.mapData).toEqual(mapData);
    expect(parsed.cameraState).toEqual({
      targetX: 18,
      targetZ: 24,
      angle: 0.25,
      zoom: 140,
      pitch: 1,
    });
    expect(parsed.tacticalViewState).toEqual({
      version: 1,
      angle: 0.25,
      position: {
        x: 18,
        y: 0,
        z: 24,
      },
    });
    expect(terrainLogicState).toEqual({
      version: 2,
      activeBoundary: 3,
      waterUpdates: [{
        triggerId: 9,
        changePerFrame: 0.5,
        targetHeight: 10,
        damageAmount: 25,
        currentHeight: 4,
      }],
    });
    expect(partitionState).toEqual({
      version: 2,
      cellSize: 10,
      totalCellCount: 2,
      cells: [
        {
          shroudLevels: Array.from({ length: 8 }, (_, index) => ({
            currentShroud: index === 0 ? 0 : 1,
            activeShroudLevel: 0,
          })),
        },
        {
          shroudLevels: Array.from({ length: 8 }, (_, index) => ({
            currentShroud: index === 0 ? -1 : 1,
            activeShroudLevel: index === 1 ? 1 : 0,
          })),
        },
      ],
      pendingUndoShroudReveals: [],
    });
    expect(playerState?.state.playerSideByIndex).toEqual(new Map([[0, 'USA']]));
    expect(playerState?.state.controllingPlayerScriptCredits).toEqual(new Map([['the_player', 1337]]));
    expect(playerState?.state.controllingPlayerScriptSciences).toEqual(
      new Map([['the_player', new Set(['SCIENCE_ANTHRAX_BOMB'])]]),
    );
    expect(playerState?.state.sideMissionAttempts).toBeUndefined();
    expect(playerState?.tunnelTrackers).toEqual([{
      side: 'USA',
      tracker: {
        tunnelIds: [21, 22],
        passengerIds: [77],
        tunnelCount: 2,
      },
    }]);
    expect(radarState?.version).toBe(2);
    if (!radarState || radarState.version !== 2) {
      throw new Error('Expected structured radar payload');
    }
    expect(radarState.radarHidden).toBe(true);
    expect(radarState.localObjectList).toEqual([{ objectId: 7, color: -16711936 }]);
    expect(radarState.events[0]).toEqual({
      type: 4,
      active: true,
      createFrame: 31,
      dieFrame: 151,
      fadeFrame: 136,
      color1: { red: 255, green: 255, blue: 0, alpha: 255 },
      color2: { red: 255, green: 255, blue: 128, alpha: 255 },
      worldLoc: { x: 18, y: 24, z: 0 },
      radarLoc: { x: 9, y: 12 },
      soundPlayed: false,
      sourceEntityId: 7,
      sourceTeamName: 'TEAMTHEPLAYER',
    });
    expect(radarState.nextFreeRadarEvent).toBe(1);
    expect(radarState.lastRadarEvent).toBe(0);
    expect(sidesListState).toEqual({
      version: 2,
      state: {},
      scriptLists: [{
        present: true,
        scripts: [{ active: true }],
        groups: [],
      }],
    });
    expect(teamFactoryState?.state.scriptTeamsByName).toEqual(new Map([['TEAMTHEPLAYER', {
      nameUpper: 'TEAMTHEPLAYER',
      prototypeNameUpper: 'TEAMTHEPLAYER',
      sourcePrototypeId: 1,
      sourceTeamId: 1,
      memberEntityIds: new Set([7]),
      created: true,
      stateName: 'ATTACKING',
      attackPrioritySetName: 'ANTIVEHICLESET',
      recruitableOverride: null,
      isAIRecruitable: true,
      homeWaypointName: 'HOME',
      controllingSide: 'USA',
      controllingPlayerToken: 'the_player',
      isSingleton: true,
      maxInstances: 1,
      productionPriority: 3,
      productionPrioritySuccessIncrease: 0,
      productionPriorityFailureDecrease: 0,
      reinforcementUnitEntries: [],
      reinforcementTransportTemplateName: '',
      reinforcementStartWaypointName: '',
      reinforcementTeamStartsFull: false,
      reinforcementTransportsExit: false,
    }]]));
    expect(teamFactoryState?.state.scriptTeamInstanceNamesByPrototypeName).toEqual(
      new Map([['TEAMTHEPLAYER', ['TEAMTHEPLAYER']]]),
    );
    expect(teamFactoryState?.state.scriptNextSourceTeamId).toBe(2);
    expect(teamFactoryState?.state.scriptNextSourceTeamPrototypeId).toBe(2);
    expect(scriptEngineState?.state.scriptCountersByName).toEqual(
      new Map([['missiontimer', { value: 90, isCountdownTimer: true }]]),
    );
    expect(scriptEngineState?.state.scriptFlagsByName).toEqual(new Map([['intro_complete', true]]));
    expect(scriptEngineState?.state.scriptCompletedVideos).toEqual(['USA_BNN_INTRO']);
    expect(scriptEngineState?.state.scriptNamedMapRevealByName).toEqual(new Map([['INTRO_FOCUS', {
      revealName: 'INTRO_FOCUS',
      waypointName: 'INTRO_FOCUS',
      playerName: 'USA',
      playerIndex: 0,
      worldX: 64,
      worldZ: 72,
      radius: 18,
      applied: false,
    }]]));
    expect(scriptEngineState?.state.scriptMusicTrackState).toEqual({
      trackName: 'SkirmishAmbient',
      fadeOut: false,
      fadeIn: false,
      frame: 0,
    });
    expect(parsed.scriptEngineFadeState).toEqual(expect.objectContaining({
      fadeType: 'SUBTRACT',
      currentFadeFrame: 11,
      increaseFrames: 12,
      holdFrames: 4,
      decreaseFrames: 6,
    }));
    expect(parsed.scriptEngineFadeState?.minFade).toBeCloseTo(0.2, 6);
    expect(parsed.scriptEngineFadeState?.maxFade).toBeCloseTo(0.8, 6);
    expect(parsed.scriptEngineFadeState?.currentFadeValue).toBeCloseTo(0.65, 6);
    expect(parsed.inGameUiState).toEqual({
      version: 3,
      namedTimerLastFlashFrame: 17,
      namedTimerUsedFlashColor: true,
      showNamedTimers: false,
      namedTimers: [{
        timerName: 'SupplyDrop',
        timerText: 'Supply Drop Ready',
        isCountdown: false,
      }],
      superweaponHiddenByScript: false,
      superweapons: [{
        playerIndex: 0,
        templateName: 'SUPERWEAPONSCUDSTORM',
        powerName: 'SUPERWEAPONSCUDSTORM',
        objectId: 7,
        timestamp: 45,
        hiddenByScript: true,
        hiddenByScience: false,
        ready: false,
        evaReadyPlayed: false,
      }],
    });
    expect(inGameUiState?.state.scriptNamedTimerDisplayEnabled).toBe(false);
    expect(inGameUiState?.state.scriptHiddenSpecialPowerDisplayEntityIds).toEqual(new Set([7]));
    expect(coreState?.spawnedEntities).toEqual([]);
    expect(coreState?.selectedEntityId).toBeNull();
    expect(coreState?.gameRandomSeed).toBe(123456789);
    expect(coreState?.rankLevelLimit).toBe(7);
    expect(coreState?.difficultyBonusesInitialized).toBe(true);
    expect(coreState?.scriptScoringEnabled).toBe(false);
    expect(coreState?.showBehindBuildingMarkers).toBe(true);
    expect(coreState?.drawIconUI).toBe(false);
    expect(coreState?.showDynamicLOD).toBe(false);
    expect(coreState?.scriptHulkMaxLifetimeOverride).toBe(180);
    expect(coreState?.rankPointsToAddAtGameStart).toBe(5);
    expect(coreState?.superweaponRestriction).toBe(1);
    expect(coreState?.caveTrackers).toEqual([{
      caveIndex: 4,
      tracker: {
        tunnelIds: [91],
        passengerIds: [92, 93],
        tunnelCount: 1,
      },
    }]);
    expect(coreState?.controlBarOverrides).toEqual([{
      commandSetName: 'AMERICABARRACKSCOMMANDSET',
      slot: 1,
      commandButtonName: 'COMMAND_AMERICA_BARRACKS',
    }]);
    expect(coreState?.bridgeSegments).toEqual([{
      segmentId: 4,
      passable: true,
      cellIndices: [10, 11],
      transitionIndices: [22],
      controlEntityIds: [101, 102],
      startWorldX: 1,
      startWorldZ: 2,
      endWorldX: 3,
      endWorldZ: 4,
      startSurfaceY: 5,
      endSurfaceY: 6,
    }]);
    expect(coreState?.pendingWeaponDamageEvents).toEqual([{
      sourceEntityId: 7,
      primaryVictimEntityId: null,
      impactX: 18,
      impactY: 0,
      impactZ: 24,
      executeFrame: 55,
      projectilePlannedImpactFrame: 55,
      delivery: 'PROJECTILE',
      weaponName: 'TestMissile',
      launchFrame: 21,
      sourceX: 10,
      sourceY: 0,
      sourceZ: 10,
      projectileVisualId: 3,
      bezierP1Y: 0,
      bezierP2Y: 0,
      bezierFirstPercentIndent: 0,
      bezierSecondPercentIndent: 0,
      hasBezierArc: false,
      countermeasureDivertFrame: 0,
      countermeasureNoDamage: false,
      suppressImpactVisual: false,
      missileAIState: null,
      scriptWaypointPath: [{ x: 14, z: 16 }],
      damageFXOverride: 'SMALL_ARMS',
      sourceTemplateName: 'RuntimeTank',
    }]);
    expect(coreState?.historicDamageLog).toEqual([{
      weaponName: 'TestMissile',
      hits: [{ frame: 20, x: 14, z: 16 }],
    }]);
    expect(coreState?.sellingEntities).toEqual([{ entityId: 7, sellFrame: 11 }]);
    expect(coreState?.buildableOverrides).toEqual([{
      templateName: 'AmericaBarracks',
      buildableStatus: 'NO',
    }]);
    expect(logicState.version).toBe(1);
    expect(logicState.spawnedEntities.get(7)?.templateName).toBe('RuntimeTank');
    expect(logicState.spawnedEntities.get(7)?.kindOf.has('VEHICLE')).toBe(true);
    expect(parsed.campaign).toBeNull();
  });

  it('writes live attached-object drawables into fresh CHUNK_GameClient saves', () => {
    const mapData = {
      heightmap: {
        width: 2,
        height: 2,
        borderSize: 0,
        data: 'AAAAAA==',
      },
      objects: [],
      triggers: [],
      waypoints: { nodes: [], links: [] },
      textureClasses: [],
      blendTileCount: 0,
    };

    const saveFile = buildRuntimeSaveFile({
      description: 'GameClient Drawable Save',
      mapPath: 'assets/maps/TestMap.json',
      mapData,
      cameraState: null,
      gameClientLiveEntityIds: [7],
      renderableEntityStates: [
        {
          id: 7,
          templateName: 'AmericaTankCrusader',
          resolved: true,
          renderAssetCandidates: ['AmericaTankCrusader'],
          renderAssetPath: 'AmericaTankCrusader.glb',
          renderAssetResolved: true,
          category: 'vehicle',
          x: 10,
          y: 0,
          z: 20,
          rotationY: 0.5,
          animationState: 'MOVE',
          health: 100,
          maxHealth: 100,
          isSelected: false,
          veterancyLevel: 0,
          isStealthed: false,
          isDetected: false,
          stealthFriendlyOpacity: 1,
          disguiseTemplateName: null,
          shroudStatus: 'CLEAR',
          constructionPercent: -1,
          capturePercent: -1,
          toppleAngle: 0,
          toppleDirX: 0,
          toppleDirZ: 0,
          turretAngles: [],
          modelConditionFlags: ['MOVING', 'WEAPONSET_VETERAN'],
          scriptFlashCount: 2,
          scriptFlashColor: 0x123456,
          shadowType: 'SHADOW_VOLUME',
        },
        {
          id: 99,
          templateName: 'PendingDeathVisualOnly',
          resolved: true,
          renderAssetCandidates: ['PendingDeathVisualOnly'],
          renderAssetPath: 'PendingDeathVisualOnly.glb',
          renderAssetResolved: true,
          category: 'ground',
          x: 0,
          y: 0,
          z: 0,
          rotationY: 0,
          animationState: 'DIE',
          health: 0,
          maxHealth: 100,
          isSelected: false,
          veterancyLevel: 0,
          isStealthed: false,
          isDetected: false,
          stealthFriendlyOpacity: 1,
          disguiseTemplateName: null,
          shroudStatus: 'CLEAR',
          constructionPercent: -1,
          capturePercent: -1,
          toppleAngle: 0,
          toppleDirX: 0,
          toppleDirZ: 0,
          turretAngles: [],
        },
      ],
      gameLogic: {
        captureSourceTerrainLogicRuntimeSaveState: () => ({
          version: 2,
          activeBoundary: 0,
          waterUpdates: [],
        }),
        captureSourcePartitionRuntimeSaveState: createEmptyPartitionState,
        captureSourcePlayerRuntimeSaveState: () => ({
          version: 1,
          state: { localPlayerIndex: 0 },
        }),
        captureSourceRadarRuntimeSaveState: createEmptyRadarState,
        captureSourceSidesListRuntimeSaveState: () => createEmptySidesListState(),
        captureSourceTeamFactoryRuntimeSaveState: () => createEmptyTeamFactoryState(),
        captureSourceScriptEngineRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceInGameUiRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceGameLogicRuntimeSaveState: () => ({
          version: 7,
          nextId: 8,
          nextProjectileVisualId: 1,
          animationTime: 0,
          selectedEntityId: null,
          selectedEntityIds: [],
          scriptSelectionChangedFrame: 0,
          frameCounter: 42,
          controlBarDirtyFrame: 0,
          scriptObjectTopologyVersion: 0,
          scriptObjectCountChangedFrame: 0,
          defeatedSides: new Set(),
          gameEndFrame: null,
          scriptEndGameTimerActive: false,
          spawnedEntities: [],
        }),
        captureBrowserRuntimeSaveState: () => ({ version: 1 }),
        getObjectIdCounter: () => 8,
      },
    });

    expect(readGameClientChunk(saveFile.data)).toEqual({
      version: 3,
      frame: 42,
      tocVersion: 1,
      tocCount: 1,
      tocEntries: ['AmericaTankCrusader'],
      drawableCount: 1,
      drawableObjectIds: [7],
      drawableIds: [7],
      briefingLines: [],
    });
    const transformRows = readFirstGeneratedDrawableTransform(saveFile.data);
    const expectedRows = buildExpectedTransformRows(10, 0, 20, 0.5);
    expect(transformRows).not.toBeNull();
    for (let index = 0; index < expectedRows.length; index += 1) {
      expect(transformRows?.[index]).toBeCloseTo(expectedRows[index]!, 5);
    }
  });

  it('replaces parsed attached-object GameClient drawables while preserving unattached raw drawables', () => {
    const mapData = {
      heightmap: {
        width: 2,
        height: 2,
        borderSize: 0,
        data: 'AAAAAA==',
      },
      objects: [],
      triggers: [],
      waypoints: { nodes: [], links: [] },
      textureClasses: [],
      blendTileCount: 0,
    };

    const incomingSave = buildRuntimeSaveFile({
      description: 'Parsed GameClient Drawable Save',
      mapPath: 'assets/maps/TestMap.json',
      mapData,
      cameraState: null,
      gameClientState: {
        version: 3,
        prefixBytes: new ArrayBuffer(0),
        briefingLines: ['MISSION_ALPHA'],
        drawables: [
          {
            templateName: 'LegacyAttachedTank',
            objectId: 7,
            blockData: createRawGameClientDrawableBlockData(7, 700),
          },
          {
            templateName: 'LegacyScorchMark',
            objectId: 0,
            blockData: createRawGameClientDrawableBlockData(0, 900),
          },
        ],
      },
      gameLogic: {
        captureSourceTerrainLogicRuntimeSaveState: () => ({
          version: 2,
          activeBoundary: 0,
          waterUpdates: [],
        }),
        captureSourcePartitionRuntimeSaveState: createEmptyPartitionState,
        captureSourcePlayerRuntimeSaveState: () => ({
          version: 1,
          state: { localPlayerIndex: 0 },
        }),
        captureSourceRadarRuntimeSaveState: createEmptyRadarState,
        captureSourceSidesListRuntimeSaveState: () => createEmptySidesListState(),
        captureSourceTeamFactoryRuntimeSaveState: () => createEmptyTeamFactoryState(),
        captureSourceScriptEngineRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceInGameUiRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceGameLogicRuntimeSaveState: () => ({
          version: 7,
          nextId: 8,
          nextProjectileVisualId: 1,
          animationTime: 0,
          selectedEntityId: null,
          selectedEntityIds: [],
          scriptSelectionChangedFrame: 0,
          frameCounter: 10,
          controlBarDirtyFrame: 0,
          scriptObjectTopologyVersion: 0,
          scriptObjectCountChangedFrame: 0,
          defeatedSides: new Set(),
          gameEndFrame: null,
          scriptEndGameTimerActive: false,
          spawnedEntities: [],
        }),
        captureBrowserRuntimeSaveState: () => ({ version: 1 }),
        getObjectIdCounter: () => 8,
      },
    });

    const parsed = parseRuntimeSaveFile(incomingSave.data);
    expect(parsed.gameClientState?.drawables).toEqual([
      expect.objectContaining({
        templateName: 'LegacyAttachedTank',
        objectId: 7,
        blockData: expect.any(ArrayBuffer),
      }),
      expect.objectContaining({
        templateName: 'LegacyScorchMark',
        objectId: 0,
        blockData: expect.any(ArrayBuffer),
      }),
    ]);

    const rebuilt = buildRuntimeSaveFile({
      description: parsed.metadata.description,
      mapPath: parsed.mapPath,
      mapData: parsed.mapData ?? mapData,
      cameraState: parsed.cameraState,
      tacticalViewState: parsed.tacticalViewState,
      gameClientState: parsed.gameClientState,
      gameClientLiveEntityIds: [7],
      renderableEntityStates: [
        {
          id: 7,
          templateName: 'AmericaTankCrusader',
          resolved: true,
          renderAssetCandidates: ['AmericaTankCrusader'],
          renderAssetPath: 'AmericaTankCrusader.glb',
          renderAssetResolved: true,
          category: 'vehicle',
          x: 10,
          y: 0,
          z: 20,
          rotationY: 0,
          animationState: 'MOVE',
          health: 100,
          maxHealth: 100,
          isSelected: false,
          veterancyLevel: 0,
          isStealthed: false,
          isDetected: false,
          stealthFriendlyOpacity: 1,
          disguiseTemplateName: null,
          shroudStatus: 'CLEAR',
          constructionPercent: -1,
          capturePercent: -1,
          toppleAngle: 0,
          toppleDirX: 0,
          toppleDirZ: 0,
          turretAngles: [],
          modelConditionFlags: ['MOVING'],
          shadowType: 'SHADOW_VOLUME',
        },
      ],
      gameLogic: {
        captureSourceTerrainLogicRuntimeSaveState: () => parsed.gameLogicTerrainLogicState ?? {
          version: 2,
          activeBoundary: 0,
          waterUpdates: [],
        },
        captureSourcePartitionRuntimeSaveState: () => parsed.gameLogicPartitionState ?? createEmptyPartitionState(),
        captureSourcePlayerRuntimeSaveState: () => parsed.gameLogicPlayersState ?? {
          version: 1,
          state: { localPlayerIndex: 0 },
        },
        captureSourceRadarRuntimeSaveState: () => parsed.gameLogicRadarState ?? createEmptyRadarState(),
        captureSourceSidesListRuntimeSaveState: () => parsed.gameLogicSidesListState ?? createEmptySidesListState(),
        captureSourceTeamFactoryRuntimeSaveState: () => (
          parsed.gameLogicTeamFactoryState
          ?? (
            parsed.sourceTeamFactoryChunkData
              ? applySourceTeamFactoryChunkToState(
                  parsed.sourceTeamFactoryChunkData,
                  createEmptyTeamFactoryState(),
                  parsed.gameLogicPlayersState,
                  parsed.gameLogicSidesListState,
                )
              : createEmptyTeamFactoryState()
          )
        ),
        captureSourceScriptEngineRuntimeSaveState: () => parsed.gameLogicScriptEngineState ?? { version: 1, state: {} },
        captureSourceInGameUiRuntimeSaveState: () => parsed.gameLogicInGameUiState ?? { version: 1, state: {} },
        captureSourceGameLogicRuntimeSaveState: () => ({
          version: 7,
          nextId: 8,
          nextProjectileVisualId: 1,
          animationTime: 0,
          selectedEntityId: null,
          selectedEntityIds: [],
          scriptSelectionChangedFrame: 0,
          frameCounter: 20,
          controlBarDirtyFrame: 0,
          scriptObjectTopologyVersion: 0,
          scriptObjectCountChangedFrame: 0,
          defeatedSides: new Set(),
          gameEndFrame: null,
          scriptEndGameTimerActive: false,
          spawnedEntities: [],
        }),
        captureBrowserRuntimeSaveState: () => parsed.gameLogicState ?? { version: 1 },
        getObjectIdCounter: () => 8,
      },
    });

    expect(readGameClientChunk(rebuilt.data)).toEqual({
      version: 3,
      frame: 20,
      tocVersion: 1,
      tocCount: 2,
      tocEntries: ['AmericaTankCrusader', 'LegacyScorchMark'],
      drawableCount: 2,
      drawableObjectIds: [7, 0],
      drawableIds: [7, 900],
      briefingLines: ['MISSION_ALPHA'],
    });
  });

  it('omits CHUNK_TS_RuntimeState when the browser runtime payload is empty', () => {
    const mapData = {
      heightmap: {
        width: 2,
        height: 2,
        borderSize: 0,
        data: 'AAAAAA==',
      },
      objects: [],
      triggers: [],
      waypoints: { nodes: [], links: [] },
      textureClasses: [],
      blendTileCount: 0,
    };

    const saveFile = buildRuntimeSaveFile({
      description: 'Retail-Like Save',
      mapPath: 'maps/_extracted/MapsZH/Maps/MD_USA01/MD_USA01.json',
      mapData,
      cameraState: {
        targetX: 64,
        targetZ: 96,
        angle: 0.5,
        zoom: 180,
        pitch: 1,
      },
      gameLogic: {
        captureSourceTerrainLogicRuntimeSaveState: () => ({
          version: 2,
          activeBoundary: 0,
          waterUpdates: [],
        }),
        captureSourcePartitionRuntimeSaveState: () => createEmptyPartitionState(),
        captureSourcePlayerRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceRadarRuntimeSaveState: () => createEmptyRadarState(),
        captureSourceSidesListRuntimeSaveState: () => createEmptySidesListState(),
        captureSourceTeamFactoryRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceScriptEngineRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceInGameUiRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceGameLogicRuntimeSaveState: () => ({
          version: 1,
          gameRandomSeed: 99,
          nextId: 10,
          nextProjectileVisualId: 1,
          animationTime: 0,
          selectedEntityId: null,
          selectedEntityIds: [],
          scriptSelectionChangedFrame: -1,
          frameCounter: 0,
          controlBarDirtyFrame: -1,
          scriptObjectTopologyVersion: 0,
          scriptObjectCountChangedFrame: 0,
          defeatedSides: new Set<string>(),
          gameEndFrame: null,
          scriptEndGameTimerActive: false,
          spawnedEntities: [],
        }),
        captureBrowserRuntimeSaveState: () => ({ version: 1 }),
        getObjectIdCounter: () => 10,
      },
    });

    expect(listSaveGameChunks(saveFile.data).map((chunk) => chunk.blockName)).toEqual([
      'CHUNK_GameState',
      'CHUNK_Campaign',
      'CHUNK_GameStateMap',
      'CHUNK_TerrainLogic',
      'CHUNK_TeamFactory',
      'CHUNK_Players',
      'CHUNK_GameLogic',
      'CHUNK_Radar',
      'CHUNK_ScriptEngine',
      'CHUNK_SidesList',
      'CHUNK_TacticalView',
      'CHUNK_GameClient',
      'CHUNK_InGameUI',
      'CHUNK_Partition',
      'CHUNK_ParticleSystem',
      'CHUNK_TerrainVisual',
      'CHUNK_GhostObject',
    ]);

    const parsed = parseRuntimeSaveFile(saveFile.data);

    expect(parsed.mapPath).toBe('maps/_extracted/MapsZH/Maps/MD_USA01/MD_USA01.json');
    expect(parsed.mapData).toEqual(mapData);
    expect(parsed.cameraState).toBeNull();
    expect(parsed.tacticalViewState).toEqual({
      version: 1,
      angle: 0.5,
      position: {
        x: 64,
        y: 0,
        z: 96,
      },
    });
    expect(parsed.gameLogicState).toBeNull();
    expect(parsed.gameLogicCoreState?.gameRandomSeed).toBe(99);
  });

  it('treats embedded retail map bytes as non-JSON payloads and falls back to map path reload', () => {
    const mapData = {
      heightmap: {
        width: 2,
        height: 2,
        borderSize: 0,
        data: 'AAAAAA==',
      },
      objects: [],
      triggers: [],
      waypoints: { nodes: [], links: [] },
      textureClasses: [],
      blendTileCount: 0,
    };

    const saveFile = buildRuntimeSaveFile({
      description: 'Retail Map Bytes',
      mapPath: 'maps/_extracted/MapsZH/Maps/MD_USA01/MD_USA01.json',
      mapData,
      cameraState: null,
      gameLogic: {
        captureSourceTerrainLogicRuntimeSaveState: () => ({
          version: 2,
          activeBoundary: 0,
          waterUpdates: [],
        }),
        captureSourcePartitionRuntimeSaveState: () => createEmptyPartitionState(),
        captureSourcePlayerRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceRadarRuntimeSaveState: () => createEmptyRadarState(),
        captureSourceSidesListRuntimeSaveState: () => createEmptySidesListState(),
        captureSourceTeamFactoryRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceScriptEngineRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceInGameUiRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceGameLogicRuntimeSaveState: () => ({
          version: 1,
          nextId: 10,
          nextProjectileVisualId: 1,
          animationTime: 0,
          selectedEntityId: null,
          selectedEntityIds: [],
          scriptSelectionChangedFrame: -1,
          frameCounter: 0,
          controlBarDirtyFrame: -1,
          scriptObjectTopologyVersion: 0,
          scriptObjectCountChangedFrame: 0,
          defeatedSides: new Set<string>(),
          gameEndFrame: null,
          scriptEndGameTimerActive: false,
          spawnedEntities: [],
        }),
        captureBrowserRuntimeSaveState: () => ({ version: 1, spawnedEntities: [] }),
        getObjectIdCounter: () => 10,
      },
      embeddedMapBytes: new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
      sourceGameMode: SOURCE_GAME_MODE_SINGLE_PLAYER,
    });

    const parsed = parseRuntimeSaveFile(saveFile.data);

    expect(parsed.mapPath).toBe('maps/_extracted/MapsZH/Maps/MD_USA01/MD_USA01.json');
    expect(parsed.mapData).toBeNull();
    expect(parsed.campaign).toBeNull();
  });

  it('round-trips non-challenge campaign metadata through CHUNK_Campaign', () => {
    const mapData = {
      heightmap: {
        width: 2,
        height: 2,
        borderSize: 0,
        data: 'AAAAAA==',
      },
      objects: [],
      triggers: [],
      waypoints: { nodes: [], links: [] },
      textureClasses: [],
      blendTileCount: 0,
    };

    const saveFile = buildRuntimeSaveFile({
      description: 'USA Campaign Save',
      mapPath: 'maps/_extracted/MapsZH/Maps/MD_USA02/MD_USA02.json',
      mapData,
      cameraState: null,
      gameLogic: {
        captureSourceTerrainLogicRuntimeSaveState: () => ({
          version: 2,
          activeBoundary: 0,
          waterUpdates: [],
        }),
        captureSourcePartitionRuntimeSaveState: () => createEmptyPartitionState(),
        captureSourcePlayerRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceRadarRuntimeSaveState: () => createEmptyRadarState(),
        captureSourceSidesListRuntimeSaveState: () => createEmptySidesListState(),
        captureSourceTeamFactoryRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceScriptEngineRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceInGameUiRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceGameLogicRuntimeSaveState: () => ({
          version: 1,
          nextId: 22,
          nextProjectileVisualId: 1,
          animationTime: 0,
          selectedEntityId: null,
          selectedEntityIds: [],
          scriptSelectionChangedFrame: -1,
          frameCounter: 0,
          controlBarDirtyFrame: -1,
          scriptObjectTopologyVersion: 0,
          scriptObjectCountChangedFrame: 0,
          defeatedSides: new Set<string>(),
          gameEndFrame: null,
          scriptEndGameTimerActive: false,
          spawnedEntities: [],
        }),
        captureBrowserRuntimeSaveState: () => ({ version: 1, entities: [] }),
        getObjectIdCounter: () => 22,
      },
      campaign: {
        campaignName: 'usa',
        missionName: 'mission02',
        missionNumber: 1,
        difficulty: 'HARD',
        rankPoints: 0,
        isChallengeCampaign: false,
        playerTemplateNum: -1,
      },
    });

    expect(readCampaignChunk(saveFile.data)).toEqual({
      version: 3,
      campaignName: 'usa',
      missionName: 'mission02',
      rankPoints: 0,
      difficulty: 2,
      isChallengeCampaign: false,
      playerTemplateNum: null,
      challengeGameInfoVersion: null,
      trailingBytes: 0,
    });

    const parsed = parseRuntimeSaveFile(saveFile.data);

    expect(parsed.metadata.campaignSide).toBe('usa');
    expect(parsed.metadata.missionNumber).toBe(1);
    expect(parsed.campaign).toEqual({
      version: 3,
      campaignName: 'usa',
      missionName: 'mission02',
      missionNumber: 1,
      difficulty: 'HARD',
      rankPoints: 0,
      isChallengeCampaign: false,
      playerTemplateNum: -1,
      challengeGameInfoState: null,
    });
  });

  it('emits source version 5 challenge campaign metadata for fresh TS saves', () => {
    const mapData = {
      heightmap: {
        width: 2,
        height: 2,
        borderSize: 0,
        data: 'AAAAAA==',
      },
      objects: [],
      triggers: [],
      waypoints: { nodes: [], links: [] },
      textureClasses: [],
      blendTileCount: 0,
    };

    const saveFile = buildRuntimeSaveFile({
      description: 'Challenge Save',
      mapPath: 'maps/_extracted/MapsZH/Maps/MD_CHALLENGE/MD_CHALLENGE.json',
      mapData,
      cameraState: null,
      gameLogic: {
        captureSourceTerrainLogicRuntimeSaveState: () => ({
          version: 2,
          activeBoundary: 0,
          waterUpdates: [],
        }),
        captureSourcePartitionRuntimeSaveState: () => createEmptyPartitionState(),
        captureSourcePlayerRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceRadarRuntimeSaveState: () => createEmptyRadarState(),
        captureSourceSidesListRuntimeSaveState: () => createEmptySidesListState(),
        captureSourceTeamFactoryRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceScriptEngineRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceInGameUiRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceGameLogicRuntimeSaveState: () => ({
          version: 1,
          gameRandomSeed: 77,
          nextId: 5,
          nextProjectileVisualId: 1,
          animationTime: 0,
          selectedEntityId: null,
          selectedEntityIds: [],
          scriptSelectionChangedFrame: -1,
          frameCounter: 0,
          controlBarDirtyFrame: -1,
          scriptObjectTopologyVersion: 0,
          scriptObjectCountChangedFrame: 0,
          defeatedSides: new Set<string>(),
          gameEndFrame: null,
          scriptEndGameTimerActive: false,
          spawnedEntities: [],
        }),
        captureBrowserRuntimeSaveState: () => ({ version: 1 }),
        getObjectIdCounter: () => 5,
      },
      campaign: {
        campaignName: 'challenge_0',
        missionName: 'mission01',
        missionNumber: 0,
        difficulty: 'NORMAL',
        rankPoints: 0,
        isChallengeCampaign: true,
        playerTemplateNum: 3,
        sourceMapName: 'Maps/GC_Challenge/GC_Challenge.map',
        playerDisplayName: 'General Granger',
      },
    });

    expect(readCampaignChunk(saveFile.data)).toEqual({
      version: 5,
      campaignName: 'challenge_0',
      missionName: 'mission01',
      rankPoints: 0,
      difficulty: 1,
      isChallengeCampaign: true,
      playerTemplateNum: 3,
      challengeGameInfoVersion: 4,
      trailingBytes: 0,
    });

    const expectedChallengeGameInfoState = createChallengeGameInfoState({
      inGame: true,
      inProgress: false,
      seed: 77,
      mapName: 'Maps/GC_Challenge/GC_Challenge.map',
      slots: Array.from({ length: 8 }, (_, index) => (
        index === 0
          ? {
              state: 5,
              name: 'General Granger',
              isAccepted: true,
              isMuted: false,
              color: -1,
              startPos: -1,
              playerTemplate: 3,
              teamNumber: -1,
              origColor: -1,
              origStartPos: -1,
              origPlayerTemplate: -1,
            }
          : {
              state: 1,
              name: 'Closed',
              isAccepted: false,
              isMuted: false,
              color: -1,
              startPos: -1,
              playerTemplate: -1,
              teamNumber: -1,
              origColor: -1,
              origStartPos: -1,
              origPlayerTemplate: -1,
            }
      )),
    });

    const parsed = parseRuntimeSaveFile(saveFile.data);
    expect(parsed.campaign).toEqual({
      version: 5,
      campaignName: 'challenge_0',
      missionName: 'mission01',
      missionNumber: 0,
      difficulty: 'NORMAL',
      rankPoints: 0,
      isChallengeCampaign: true,
      playerTemplateNum: 3,
      challengeGameInfoState: expectedChallengeGameInfoState,
    });
  });

  it('round-trips source version 5 challenge campaign chunks with challenge game info', () => {
    const mapData = {
      heightmap: {
        width: 2,
        height: 2,
        borderSize: 0,
        data: 'AAAAAA==',
      },
      objects: [],
      triggers: [],
      waypoints: { nodes: [], links: [] },
      textureClasses: [],
      blendTileCount: 0,
    };

    const challengeGameInfoState = createChallengeGameInfoState();
    const saveFile = buildRuntimeSaveFile({
      description: 'Challenge Save v5',
      mapPath: 'maps/_extracted/MapsZH/Maps/MD_CHALLENGE/MD_CHALLENGE.json',
      mapData,
      cameraState: null,
      gameLogic: {
        captureSourceTerrainLogicRuntimeSaveState: () => ({
          version: 2,
          activeBoundary: 0,
          waterUpdates: [],
        }),
        captureSourcePartitionRuntimeSaveState: () => createEmptyPartitionState(),
        captureSourcePlayerRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceRadarRuntimeSaveState: () => createEmptyRadarState(),
        captureSourceSidesListRuntimeSaveState: () => createEmptySidesListState(),
        captureSourceTeamFactoryRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceScriptEngineRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceInGameUiRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceGameLogicRuntimeSaveState: () => ({
          version: 1,
          nextId: 5,
          nextProjectileVisualId: 1,
          animationTime: 0,
          selectedEntityId: null,
          selectedEntityIds: [],
          scriptSelectionChangedFrame: -1,
          frameCounter: 0,
          controlBarDirtyFrame: -1,
          scriptObjectTopologyVersion: 0,
          scriptObjectCountChangedFrame: 0,
          defeatedSides: new Set<string>(),
          gameEndFrame: null,
          scriptEndGameTimerActive: false,
          spawnedEntities: [],
        }),
        captureBrowserRuntimeSaveState: () => ({ version: 1 }),
        getObjectIdCounter: () => 5,
      },
      campaign: {
        version: 5,
        campaignName: 'challenge_0',
        missionName: 'mission01',
        missionNumber: 0,
        difficulty: 'NORMAL',
        rankPoints: 0,
        isChallengeCampaign: true,
        playerTemplateNum: 5,
        challengeGameInfoState,
      },
    });

    expect(readCampaignChunk(saveFile.data)).toEqual({
      version: 5,
      campaignName: 'challenge_0',
      missionName: 'mission01',
      rankPoints: 0,
      difficulty: 1,
      isChallengeCampaign: true,
      playerTemplateNum: 5,
      challengeGameInfoVersion: 4,
      trailingBytes: 0,
    });

    const parsed = parseRuntimeSaveFile(saveFile.data);
    expect(parsed.campaign).toEqual({
      version: 5,
      campaignName: 'challenge_0',
      missionName: 'mission01',
      missionNumber: 0,
      difficulty: 'NORMAL',
      rankPoints: 0,
      isChallengeCampaign: true,
      playerTemplateNum: 5,
      challengeGameInfoState,
    });

    const rebuilt = buildRuntimeSaveFile({
      description: 'Challenge Save v5 Rebuilt',
      mapPath: 'maps/_extracted/MapsZH/Maps/MD_CHALLENGE/MD_CHALLENGE.json',
      mapData,
      cameraState: null,
      gameLogic: {
        captureSourceTerrainLogicRuntimeSaveState: () => ({
          version: 2,
          activeBoundary: 0,
          waterUpdates: [],
        }),
        captureSourcePartitionRuntimeSaveState: () => createEmptyPartitionState(),
        captureSourcePlayerRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceRadarRuntimeSaveState: () => createEmptyRadarState(),
        captureSourceSidesListRuntimeSaveState: () => createEmptySidesListState(),
        captureSourceTeamFactoryRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceScriptEngineRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceInGameUiRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceGameLogicRuntimeSaveState: () => ({
          version: 1,
          nextId: 5,
          nextProjectileVisualId: 1,
          animationTime: 0,
          selectedEntityId: null,
          selectedEntityIds: [],
          scriptSelectionChangedFrame: -1,
          frameCounter: 0,
          controlBarDirtyFrame: -1,
          scriptObjectTopologyVersion: 0,
          scriptObjectCountChangedFrame: 0,
          defeatedSides: new Set<string>(),
          gameEndFrame: null,
          scriptEndGameTimerActive: false,
          spawnedEntities: [],
        }),
        captureBrowserRuntimeSaveState: () => ({ version: 1 }),
        getObjectIdCounter: () => 5,
      },
      campaign: parsed.campaign,
    });

    expect(readCampaignChunk(rebuilt.data)).toEqual({
      version: 5,
      campaignName: 'challenge_0',
      missionName: 'mission01',
      rankPoints: 0,
      difficulty: 1,
      isChallengeCampaign: true,
      playerTemplateNum: 5,
      challengeGameInfoVersion: 4,
      trailingBytes: 0,
    });
  });

  it('preserves raw unimplemented source chunks when rebuilding a loaded save', () => {
    const mapData = {
      heightmap: {
        width: 2,
        height: 2,
        borderSize: 0,
        data: 'AAAAAA==',
      },
      objects: [],
      triggers: [],
      waypoints: { nodes: [], links: [] },
      textureClasses: [],
      blendTileCount: 0,
    };

    const rawGameLogicBytes = new Uint8Array([0x06, 0xde, 0xad, 0xbe, 0xef]);
    const rawScriptEngineBytes = new Uint8Array([0x05, 0x34, 0x12, 0x78]);
    const rawInGameUiBytes = new Uint8Array([0x03, 0xaa, 0xbb, 0xcc]);
    const rawPlayersBytes = new Uint8Array([0x7f, 0x11, 0x22, 0x33]);
    const saveFile = buildRuntimeSaveFile({
      description: 'Passthrough Save',
      mapPath: 'maps/_extracted/MapsZH/Maps/MD_USA01/MD_USA01.json',
      mapData,
      cameraState: null,
      passthroughBlocks: [
        {
          blockName: 'CHUNK_GameLogic',
          blockData: rawGameLogicBytes.buffer,
        },
        {
          blockName: 'CHUNK_Players',
          blockData: rawPlayersBytes.buffer,
        },
        {
          blockName: 'CHUNK_ScriptEngine',
          blockData: rawScriptEngineBytes.buffer,
        },
        {
          blockName: 'CHUNK_InGameUI',
          blockData: rawInGameUiBytes.buffer,
        },
        {
          blockName: 'CHUNK_TerrainVisual',
          blockData: new Uint8Array([0x01, 0x02, 0x03, 0x04]).buffer,
        },
      ],
      gameLogic: {
        captureSourceTerrainLogicRuntimeSaveState: () => ({
          version: 2,
          activeBoundary: 0,
          waterUpdates: [],
        }),
        captureSourcePartitionRuntimeSaveState: () => createEmptyPartitionState(),
        captureSourcePlayerRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceRadarRuntimeSaveState: () => createEmptyRadarState(),
        captureSourceSidesListRuntimeSaveState: () => createEmptySidesListState(),
        captureSourceTeamFactoryRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceScriptEngineRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceInGameUiRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceGameLogicRuntimeSaveState: () => ({
          version: 1,
          nextId: 10,
          nextProjectileVisualId: 1,
          animationTime: 0,
          selectedEntityId: null,
          selectedEntityIds: [],
          scriptSelectionChangedFrame: -1,
          frameCounter: 0,
          controlBarDirtyFrame: -1,
          scriptObjectTopologyVersion: 0,
          scriptObjectCountChangedFrame: 0,
          defeatedSides: new Set<string>(),
          gameEndFrame: null,
          scriptEndGameTimerActive: false,
          spawnedEntities: [],
        }),
        captureBrowserRuntimeSaveState: () => ({ version: 1, spawnedEntities: [] }),
        getObjectIdCounter: () => 10,
      },
    });
    const terrainVisualBytes = new Uint8Array([0x01, 0x02, 0x03, 0x04]);

    const parsed = parseRuntimeSaveFile(saveFile.data);

    expect(parsed.gameClientState?.briefingLines).toEqual([]);
    expect(parsed.gameLogicCoreState).toBeNull();
    expect(parsed.gameLogicPlayersState).toBeNull();
    expect(parsed.passthroughBlocks.map((block) => block.blockName).sort()).toEqual([
      'CHUNK_GhostObject',
      'CHUNK_GameLogic',
      'CHUNK_ParticleSystem',
      'CHUNK_Players',
      'CHUNK_ScriptEngine',
      'CHUNK_TerrainVisual',
      'CHUNK_InGameUI',
    ].sort());
    const terrainVisualBlock = parsed.passthroughBlocks.find((block) => block.blockName === 'CHUNK_TerrainVisual');
    const gameLogicBlock = parsed.passthroughBlocks.find((block) => block.blockName === 'CHUNK_GameLogic');
    const playersBlock = parsed.passthroughBlocks.find((block) => block.blockName === 'CHUNK_Players');
    const scriptEngineBlock = parsed.passthroughBlocks.find((block) => block.blockName === 'CHUNK_ScriptEngine');
    const inGameUiBlock = parsed.passthroughBlocks.find((block) => block.blockName === 'CHUNK_InGameUI');
    expect(terrainVisualBlock).toBeDefined();
    expect(gameLogicBlock).toBeDefined();
    expect(playersBlock).toBeDefined();
    expect(scriptEngineBlock).toBeDefined();
    expect(inGameUiBlock).toBeDefined();
    expect(new Uint8Array(terrainVisualBlock!.blockData)).toEqual(terrainVisualBytes);
    expect(new Uint8Array(gameLogicBlock!.blockData)).toEqual(rawGameLogicBytes);
    expect(new Uint8Array(playersBlock!.blockData)).toEqual(rawPlayersBytes);
    expect(new Uint8Array(scriptEngineBlock!.blockData)).toEqual(rawScriptEngineBytes);
    expect(new Uint8Array(inGameUiBlock!.blockData)).toEqual(rawInGameUiBytes);

    const rebuilt = buildRuntimeSaveFile({
      description: parsed.metadata.description,
      mapPath: parsed.mapPath,
      mapData: parsed.mapData ?? mapData,
      cameraState: parsed.cameraState,
      tacticalViewState: parsed.tacticalViewState,
      gameClientBriefingLines: ['MISSION_GAMMA'],
      gameClientState: parsed.gameClientState,
      passthroughBlocks: parsed.passthroughBlocks,
      gameLogic: {
        captureSourceTerrainLogicRuntimeSaveState: () => parsed.gameLogicTerrainLogicState ?? {
          version: 2,
          activeBoundary: 0,
          waterUpdates: [],
        },
        captureSourcePartitionRuntimeSaveState: () => parsed.gameLogicPartitionState ?? createEmptyPartitionState(),
        captureSourcePlayerRuntimeSaveState: () => parsed.gameLogicPlayersState ?? { version: 1, state: {} },
        captureSourceRadarRuntimeSaveState: () => parsed.gameLogicRadarState ?? createEmptyRadarState(),
        captureSourceSidesListRuntimeSaveState: () => parsed.gameLogicSidesListState ?? createEmptySidesListState(),
        captureSourceTeamFactoryRuntimeSaveState: () => (
          parsed.gameLogicTeamFactoryState
          ?? (
            parsed.sourceTeamFactoryChunkData
              ? applySourceTeamFactoryChunkToState(
                  parsed.sourceTeamFactoryChunkData,
                  createEmptyTeamFactoryState(),
                  parsed.gameLogicPlayersState,
                  parsed.gameLogicSidesListState,
                )
              : createEmptyTeamFactoryState()
          )
        ),
        captureSourceScriptEngineRuntimeSaveState: () => parsed.gameLogicScriptEngineState ?? { version: 1, state: {} },
        captureSourceInGameUiRuntimeSaveState: () => parsed.gameLogicInGameUiState ?? { version: 1, state: {} },
        captureSourceGameLogicRuntimeSaveState: () => parsed.gameLogicCoreState ?? {
          version: 1,
          nextId: 10,
          nextProjectileVisualId: 1,
          animationTime: 0,
          selectedEntityId: null,
          selectedEntityIds: [],
          scriptSelectionChangedFrame: -1,
          frameCounter: 0,
          controlBarDirtyFrame: -1,
          scriptObjectTopologyVersion: 0,
          scriptObjectCountChangedFrame: 0,
          defeatedSides: new Set<string>(),
          gameEndFrame: null,
          scriptEndGameTimerActive: false,
          spawnedEntities: [],
        },
        captureBrowserRuntimeSaveState: () => parsed.gameLogicState ?? { version: 1, spawnedEntities: [] },
        getObjectIdCounter: () => parsed.gameLogicCoreState?.nextId ?? 10,
      },
    });

    expect(readSaveChunkData(rebuilt.data, 'CHUNK_TerrainVisual')).toEqual(terrainVisualBytes);
    expect(readSaveChunkData(rebuilt.data, 'CHUNK_GameLogic')).toEqual(rawGameLogicBytes);
    expect(readSaveChunkData(rebuilt.data, 'CHUNK_Players')).toEqual(rawPlayersBytes);
    expect(readSaveChunkData(rebuilt.data, 'CHUNK_ScriptEngine')).toEqual(rawScriptEngineBytes);
    expect(readSaveChunkData(rebuilt.data, 'CHUNK_InGameUI')).toEqual(rawInGameUiBytes);
    expect(inspectRuntimeSaveCoreChunkStatus(saveFile.data)).toEqual([
      { blockName: 'CHUNK_Players', mode: 'raw_passthrough' },
      { blockName: 'CHUNK_GameLogic', mode: 'raw_passthrough' },
      { blockName: 'CHUNK_ScriptEngine', mode: 'raw_passthrough' },
      { blockName: 'CHUNK_InGameUI', mode: 'raw_passthrough' },
    ]);
    expect(readGameClientChunk(rebuilt.data)?.briefingLines).toEqual(['MISSION_GAMMA']);
  });

  it('inspects a source-shaped CHUNK_GameLogic shell and first object layout', () => {
    expect(inspectGameLogicChunkLayout(createSourceGameLogicChunkData())).toEqual({
      layout: 'source_outer',
      version: 3,
      frameCounter: 42,
      objectTocCount: 1,
      objectCount: 1,
      firstObjectTemplateName: 'RuntimeTank',
      firstObjectTocId: 1,
      firstObjectVersion: 9,
      firstObjectInternalName: 'UNIT_007',
      firstObjectTeamId: 3,
      firstObjectLayout: {
        layout: 'source_partial',
        version: 9,
        objectId: 7,
        parsedThrough: 'complete',
        moduleCount: 0,
        moduleIdentifiers: [],
        remainingBytes: 0,
      },
    });
  });

  it('resolves source GameLogic object names for source ScriptEngine loads through source GameLogic rewrites', () => {
    const mapData = {
      heightmap: {
        width: 2,
        height: 2,
        borderSize: 0,
        data: 'AAAAAA==',
      },
      objects: [],
      triggers: [],
      waypoints: { nodes: [], links: [] },
      textureClasses: [],
      blendTileCount: 0,
    };

    const sourceGameLogicBytes = createSourceGameLogicChunkData();
    const saveFile = buildRuntimeSaveFile({
      description: 'Source GameLogic Script Lookup',
      mapPath: 'assets/maps/SourceLookup.json',
      mapData,
      cameraState: null,
      passthroughBlocks: [{
        blockName: 'CHUNK_GameLogic',
        blockData: sourceGameLogicBytes.slice().buffer,
      }],
      gameLogic: {
        captureSourceTerrainLogicRuntimeSaveState: () => ({
          version: 2,
          activeBoundary: 0,
          waterUpdates: [],
        }),
        captureSourcePartitionRuntimeSaveState: createEmptyPartitionState,
        captureSourcePlayerRuntimeSaveState: () => ({
          version: 1,
          state: {
            localPlayerIndex: 0,
            playerSideByIndex: new Map([[0, 'USA']]),
          },
        }),
        captureSourceRadarRuntimeSaveState: createEmptyRadarState,
        captureSourceSidesListRuntimeSaveState: () => createEmptySidesListState(),
        captureSourceTeamFactoryRuntimeSaveState: () => createEmptyTeamFactoryState(),
        captureSourceScriptEngineRuntimeSaveState: () => ({
          version: 1,
          state: {
            scriptToppleDirectionByEntityId: new Map([[7, { x: 12, z: 34 }]]),
          },
        }),
        captureSourceInGameUiRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceGameLogicRuntimeSaveState: () => ({
          version: 10,
          nextId: 8,
          nextProjectileVisualId: 1,
          animationTime: 0,
          selectedEntityId: null,
          selectedEntityIds: [],
          scriptSelectionChangedFrame: 0,
          frameCounter: 42,
          controlBarDirtyFrame: 0,
          scriptObjectTopologyVersion: 0,
          scriptObjectCountChangedFrame: 0,
          defeatedSides: new Set<string>(),
          gameEndFrame: null,
          scriptEndGameTimerActive: false,
          spawnedEntities: [{
            id: 7,
            scriptName: 'UNIT_007',
          } as unknown as import('@generals/game-logic').MapEntity],
        }),
        captureBrowserRuntimeSaveState: () => ({ version: 1 }),
        getObjectIdCounter: () => 8,
      },
    });

    const parsed = parseRuntimeSaveFile(saveFile.data);
    const scriptEngineState = parsed.gameLogicScriptEngineState?.state as {
      scriptToppleDirectionByEntityId?: Map<number, { x: number; z: number }>;
    } | undefined;

    expect(parsed.gameLogicCoreState).toBeNull();
    expect(parsed.sourceGameLogicImportState).toMatchObject({
      version: 1,
      sourceChunkVersion: 3,
      frameCounter: 42,
      objectIdCounter: 8,
      objects: [{
        templateName: 'RuntimeTank',
        state: {
          objectId: 7,
          internalName: 'UNIT_007',
          originalTeamName: 'TEAMUNIT',
        },
      }],
    });
    expect(parsed.sourceGameLogicPrototypeNames).toEqual(['TEAMUNIT']);
    expect(inspectRuntimeSaveCoreChunkStatus(saveFile.data)).toEqual([
      { blockName: 'CHUNK_Players', mode: 'parsed' },
      { blockName: 'CHUNK_GameLogic', mode: 'parsed' },
      { blockName: 'CHUNK_ScriptEngine', mode: 'parsed' },
      { blockName: 'CHUNK_InGameUI', mode: 'parsed' },
    ]);
    expect(scriptEngineState?.scriptToppleDirectionByEntityId).toEqual(
      new Map([[7, { x: 12, z: 34 }]]),
    );
    expect(inspectGameLogicChunkLayout(readSaveChunkData(saveFile.data, 'CHUNK_GameLogic')!)).toEqual({
      layout: 'source_outer',
      version: 3,
      frameCounter: 42,
      objectTocCount: 1,
      objectCount: 1,
      firstObjectTemplateName: 'RuntimeTank',
      firstObjectTocId: 1,
      firstObjectVersion: 9,
      firstObjectInternalName: 'UNIT_007',
      firstObjectTeamId: 3,
      firstObjectLayout: {
        layout: 'source_partial',
        version: 9,
        objectId: 7,
        parsedThrough: 'complete',
        moduleCount: 0,
        moduleIdentifiers: [],
        remainingBytes: 0,
      },
    });
  });

  it('rewrites source CHUNK_GameLogic outer state on resave while preserving object-table parsing', () => {
    const mapData = {
      heightmap: {
        width: 2,
        height: 2,
        borderSize: 0,
        data: 'AAAAAA==',
      },
      objects: [],
      triggers: [],
      waypoints: { nodes: [], links: [] },
      textureClasses: [],
      blendTileCount: 0,
    };

    const sourceGameLogicBytes = createSourceGameLogicChunkData();
    const saveFile = buildRuntimeSaveFile({
      description: 'Source GameLogic Resave Rewrite',
      mapPath: 'assets/maps/SourceRewrite.json',
      mapData,
      cameraState: null,
      passthroughBlocks: [{
        blockName: 'CHUNK_GameLogic',
        blockData: sourceGameLogicBytes.slice().buffer,
      }],
      gameLogic: {
        captureSourceTerrainLogicRuntimeSaveState: () => ({
          version: 2,
          activeBoundary: 0,
          waterUpdates: [],
        }),
        captureSourcePartitionRuntimeSaveState: createEmptyPartitionState,
        captureSourcePlayerRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceRadarRuntimeSaveState: createEmptyRadarState,
        captureSourceSidesListRuntimeSaveState: () => createEmptySidesListState(),
        captureSourceTeamFactoryRuntimeSaveState: () => createEmptyTeamFactoryState(),
        captureSourceScriptEngineRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceInGameUiRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceGameLogicRuntimeSaveState: () => ({
          version: 10,
          nextId: 8,
          nextProjectileVisualId: 1,
          animationTime: 0,
          selectedEntityId: null,
          selectedEntityIds: [],
          scriptSelectionChangedFrame: 0,
          frameCounter: 99,
          controlBarDirtyFrame: 0,
          scriptObjectTopologyVersion: 0,
          scriptObjectCountChangedFrame: 0,
          defeatedSides: new Set<string>(),
          gameEndFrame: null,
          scriptEndGameTimerActive: false,
          scriptScoringEnabled: true,
          spawnedEntities: [],
        }),
        captureBrowserRuntimeSaveState: () => ({ version: 1 }),
        getObjectIdCounter: () => 8,
      },
    });

    const gameLogicChunk = readSaveChunkData(saveFile.data, 'CHUNK_GameLogic');

    expect(gameLogicChunk).not.toEqual(sourceGameLogicBytes);
    expect(inspectGameLogicChunkLayout(gameLogicChunk!)).toEqual({
      layout: 'source_outer',
      version: 3,
      frameCounter: 99,
      objectTocCount: 1,
      objectCount: 1,
      firstObjectTemplateName: 'RuntimeTank',
      firstObjectTocId: 1,
      firstObjectVersion: 9,
      firstObjectInternalName: 'UNIT_007',
      firstObjectTeamId: 3,
      firstObjectLayout: {
        layout: 'source_partial',
        version: 9,
        objectId: 7,
        parsedThrough: 'complete',
        moduleCount: 0,
        moduleIdentifiers: [],
        remainingBytes: 0,
      },
    });
  });

  it('overlays live entity identity fields onto rewritten source GameLogic object blocks', () => {
    const mapData = {
      heightmap: {
        width: 2,
        height: 2,
        borderSize: 0,
        data: 'AAAAAA==',
      },
      objects: [],
      triggers: [],
      waypoints: { nodes: [], links: [] },
      textureClasses: [],
      blendTileCount: 0,
    };

    const sourceGameLogicBytes = createSourceGameLogicChunkData();
    const saveFile = buildRuntimeSaveFile({
      description: 'Source GameLogic Object Rewrite',
      mapPath: 'assets/maps/SourceObjectRewrite.json',
      mapData,
      cameraState: null,
      passthroughBlocks: [{
        blockName: 'CHUNK_GameLogic',
        blockData: sourceGameLogicBytes.slice().buffer,
      }],
      gameLogic: {
        captureSourceTerrainLogicRuntimeSaveState: () => ({
          version: 2,
          activeBoundary: 0,
          waterUpdates: [],
        }),
        captureSourcePartitionRuntimeSaveState: createEmptyPartitionState,
        captureSourcePlayerRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceRadarRuntimeSaveState: createEmptyRadarState,
        captureSourceSidesListRuntimeSaveState: () => createEmptySidesListState(),
        captureSourceTeamFactoryRuntimeSaveState: () => createEmptyTeamFactoryState(),
        captureSourceScriptEngineRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceInGameUiRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceGameLogicRuntimeSaveState: () => ({
          version: 10,
          nextId: 8,
          nextProjectileVisualId: 1,
          animationTime: 0,
          selectedEntityId: null,
          selectedEntityIds: [],
          scriptSelectionChangedFrame: 0,
          frameCounter: 42,
          controlBarDirtyFrame: 0,
          scriptObjectTopologyVersion: 0,
          scriptObjectCountChangedFrame: 0,
          defeatedSides: new Set<string>(),
          gameEndFrame: null,
          scriptEndGameTimerActive: false,
          spawnedEntities: [{
            id: 7,
            x: 10,
            y: 0,
            z: 20,
            rotationY: 1.25,
            scriptName: 'UNIT_RENAMED',
            sourceTeamNameUpper: 'TEAMRENAMED',
            visionRange: 250,
            constructionPercent: 50,
            completedUpgrades: new Set(['Upgrade_A']),
            weaponBonusConditionFlags: 16,
            commandSetStringOverride: 'CommandSet_New',
            receivingDifficultyBonus: true,
          } as unknown as import('@generals/game-logic').MapEntity],
        }),
        captureBrowserRuntimeSaveState: () => ({ version: 1 }),
        getObjectIdCounter: () => 8,
      },
    });

    const parsed = parseRuntimeSaveFile(saveFile.data);

    expect(parsed.sourceGameLogicPrototypeNames).toEqual(['TEAMRENAMED']);
    expect(inspectGameLogicChunkLayout(readSaveChunkData(saveFile.data, 'CHUNK_GameLogic')!)).toEqual({
      layout: 'source_outer',
      version: 3,
      frameCounter: 42,
      objectTocCount: 1,
      objectCount: 1,
      firstObjectTemplateName: 'RuntimeTank',
      firstObjectTocId: 1,
      firstObjectVersion: 9,
      firstObjectInternalName: 'UNIT_RENAMED',
      firstObjectTeamId: 3,
      firstObjectLayout: {
        layout: 'source_partial',
        version: 9,
        objectId: 7,
        parsedThrough: 'complete',
        moduleCount: 0,
        moduleIdentifiers: [],
        remainingBytes: 0,
      },
    });
  });

  it('overlays live source Object::xfer status, disable, experience, and weapon fields on resave', () => {
    const sourceGameLogicBytes = createSourceGameLogicChunkData(true);
    const saveFile = buildRuntimeSaveFile({
      description: 'Source GameLogic Object Runtime Overlay',
      mapPath: 'assets/maps/SourceObjectRuntimeOverlay.json',
      mapData: {
        heightmap: {
          width: 1,
          height: 1,
          borderSize: 0,
          data: 'AAAAAA==',
        },
        sidesList: { sides: [], teams: [] },
        objects: [],
        triggers: [],
        waypoints: { nodes: [], links: [] },
        textureClasses: [],
        blendTileCount: 0,
      },
      cameraState: null,
      passthroughBlocks: [{
        blockName: 'CHUNK_GameLogic',
        blockData: sourceGameLogicBytes.slice().buffer,
      }],
      gameLogic: {
        captureSourceTerrainLogicRuntimeSaveState: () => ({
          version: 2,
          activeBoundary: 0,
          waterUpdates: [],
        }),
        captureSourcePartitionRuntimeSaveState: createEmptyPartitionState,
        captureSourcePlayerRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceRadarRuntimeSaveState: createEmptyRadarState,
        captureSourceSidesListRuntimeSaveState: () => createEmptySidesListState(),
        captureSourceTeamFactoryRuntimeSaveState: () => createEmptyTeamFactoryState(),
        captureSourceScriptEngineRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceInGameUiRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceGameLogicRuntimeSaveState: () => ({
          version: 10,
          nextId: 8,
          nextProjectileVisualId: 1,
          animationTime: 0,
          selectedEntityId: null,
          selectedEntityIds: [],
          scriptSelectionChangedFrame: 0,
          frameCounter: 42,
          controlBarDirtyFrame: 0,
          scriptObjectTopologyVersion: 0,
          scriptObjectCountChangedFrame: 0,
          defeatedSides: new Set<string>(),
          gameEndFrame: null,
          scriptEndGameTimerActive: false,
          objectTriggerAreaStates: [{
            entityId: 7,
            enteredOrExitedFrame: 42,
            triggerAreas: [
              { triggerName: 'Trigger_A', entered: 1, exited: 0, isInside: 1 },
              { triggerName: 'Trigger_B', entered: 0, exited: 1, isInside: 0 },
            ],
          }],
          spawnedEntities: [{
            id: 7,
            templateName: 'RuntimeTank',
            x: 10,
            y: 0,
            z: 20,
            rotationY: 1.25,
            builderId: 17,
            scriptName: 'UNIT_STATUS_REWRITE',
            sourceTeamNameUpper: 'TEAMSTATUS',
            visionRange: 250,
            shroudClearingRange: 225,
            customIndicatorColor: 0x12ab34,
            healthBoxOffset: { x: 6, y: 4, z: -2 },
            constructionPercent: 50,
            completedUpgrades: new Set(['Upgrade_A']),
            receivingDifficultyBonus: true,
            commandSetStringOverride: 'CommandSet_New',
            sourceSpecialPowerBitNames: [
              'SPECIAL_PARTICLE_UPLINK_CANNON',
              'SPECIAL_CASH_HACK',
            ],
            undetectedDefectorUntilFrame: 140,
            defectorHelperDetectionStartFrame: 42,
            defectorHelperDetectionEndFrame: 140,
            defectorHelperFlashPhase: 1.75,
            defectorHelperDoFx: true,
            repulsorHelperUntilFrame: 102,
            statusDamageStatusName: 'FAERIE_FIRE',
            statusDamageClearFrame: 132,
            objectStatusFlags: new Set([
              'IS_USING_ABILITY',
              'CARBOMB',
              'RIDER1',
              'SCRIPT_DISABLED',
              'SCRIPT_TARGETABLE',
              'DISABLED_HACKED',
              'DISABLED_UNDERPOWERED',
            ]),
            cheerTimerFrames: 35,
            disabledHackedUntilFrame: 333,
            disabledEmpUntilFrame: 0,
            disabledParalyzedUntilFrame: 0,
            transportContainerId: 21,
            healContainEnteredFrame: 77,
            experienceState: {
              currentLevel: 2,
              currentExperience: 500,
              experienceScalar: 1.5,
              experienceSinkEntityId: 99,
            },
            attackWeaponSlotIndex: 2,
            attackWeapon: { name: 'LaserWeapon' },
            consecutiveShotsAtTarget: 4,
            consecutiveShotsTargetEntityId: 91,
            continuousFireCooldownFrame: 96,
            attackAmmoInClip: 4,
            nextAttackFrame: 88,
            preAttackFinishFrame: 66,
            lastShotFrame: 12,
            lastShotFrameBySlot: [10, 11, 12],
            weaponLockStatus: 'LOCKED_TEMPORARILY',
            maxShotsRemaining: 3,
            leechRangeActive: true,
            totalWeaponAntiMask: 12,
            weaponSetFlagsMask: 8,
            weaponBonusConditionFlags: 0x00800010,
            tempWeaponBonusFlag: 0x00800000,
            tempWeaponBonusExpiryFrame: 120,
            currentSubdualDamage: 25,
            subdualHealingCountdown: 3,
            soleHealingBenefactorId: 44,
            soleHealingBenefactorExpirationFrame: 555,
          } as unknown as import('@generals/game-logic').MapEntity],
        }),
        captureSourceObjectXferOverlayState: () => [{
          entityId: 7,
          privateStatus: 0x0c,
          specialModelConditionUntil: 77,
          lastWeaponCondition: [0, 0, 4],
          modulesReady: true,
        }],
        captureBrowserRuntimeSaveState: () => ({ version: 1 }),
        getObjectIdCounter: () => 8,
      },
    });

    const firstObject = readFirstSourceGameLogicObjectState(saveFile.data);

    expect(firstObject).not.toBeNull();
    expect(firstObject?.internalName).toBe('UNIT_STATUS_REWRITE');
    expect(firstObject?.statusBits).toEqual(['USING_ABILITY', 'IS_CARBOMB', 'STATUS_RIDER1']);
    expect(firstObject?.scriptStatus).toBe(0x11);
    expect(firstObject?.disabledMask).toEqual([
      'DISABLED_HACKED',
      'DISABLED_UNDERPOWERED',
      'DISABLED_SCRIPT_DISABLED',
    ]);
    expect(firstObject?.disabledTillFrame[1]).toBe(333);
    expect(firstObject?.disabledTillFrame[6]).toBe(0x3fffffff);
    expect(firstObject?.disabledTillFrame[11]).toBe(0x3fffffff);
    expect(firstObject?.builderId).toBe(17);
    expect(firstObject?.shroudClearingRange).toBe(225);
    expect(firstObject?.indicatorColor).toBe(0xff12ab34 | 0);
    expect(firstObject?.healthBoxOffset).toEqual({ x: 6, y: 4, z: -2 });
    expect(firstObject?.privateStatus).toBe(0x0c);
    expect(firstObject?.specialModelConditionUntil).toBe(77);
    expect(firstObject?.lastWeaponCondition).toEqual([0, 0, 4]);
    expect(firstObject?.experienceTracker).toMatchObject({
      currentLevel: 2,
      currentExperience: 500,
      experienceSinkObjectId: 99,
      experienceScalar: 1.5,
    });
    expect(firstObject?.containedById).toBe(21);
    expect(firstObject?.containedByFrame).toBe(77);
    expect(firstObject?.enteredOrExitedFrame).toBe(42);
    expect(firstObject?.triggerAreas).toEqual([
      { triggerName: 'Trigger_A', entered: 1, exited: 0, isInside: 1 },
      { triggerName: 'Trigger_B', entered: 0, exited: 1, isInside: 0 },
    ]);
    expect(firstObject?.soleHealingBenefactorId).toBe(44);
    expect(firstObject?.soleHealingBenefactorExpirationFrame).toBe(555);
    expect(firstObject?.weaponSetFlags).toEqual(['PLAYER_UPGRADE']);
    expect(firstObject?.weaponSet?.templateSetFlags).toEqual(['PLAYER_UPGRADE']);
    expect(firstObject?.weaponSet?.currentWeapon).toBe(2);
    expect(firstObject?.weaponSet?.currentWeaponLockedStatus).toBe(1);
    expect(firstObject?.weaponSet?.totalAntiMask).toBe(12);
    expect(firstObject?.specialPowerBits).toEqual([
      'SPECIAL_CASH_HACK',
      'SPECIAL_PARTICLE_UPLINK_CANNON',
    ]);
    expect(firstObject?.modulesReady).toBe(true);
    expect(firstObject?.weaponSet?.weapons[2]).toMatchObject({
      templateName: 'LaserWeapon',
      slot: 2,
      ammoInClip: 4,
      whenWeCanFireAgain: 88,
      whenPreAttackFinished: 66,
      lastFireFrame: 12,
      maxShotCount: 3,
      leechWeaponRangeActive: true,
    });
    const defectionHelper = firstObject?.modules.find((module) => module.identifier === 'ModuleTag_DefectionHelper');
    const firingTrackerHelper = firstObject?.modules.find((module) => module.identifier === 'ModuleTag_FiringTrackerHelper');
    const smcHelper = firstObject?.modules.find((module) => module.identifier === 'ModuleTag_SMCHelper');
    const repulsorHelper = firstObject?.modules.find((module) => module.identifier === 'ModuleTag_RepulsorHelper');
    const statusDamageHelper = firstObject?.modules.find((module) => module.identifier === 'ModuleTag_StatusDamageHelper');
    const tempWeaponBonusHelper = firstObject?.modules.find((module) => module.identifier === 'ModuleTag_TempWeaponBonusHelper');
    const subdualDamageHelper = firstObject?.modules.find((module) => module.identifier === 'ModuleTag_SubdualDamageHelper');
    const weaponStatusHelper = firstObject?.modules.find((module) => module.identifier === 'ModuleTag_WeaponStatusHelper');
    expect(defectionHelper).toBeDefined();
    expect(firingTrackerHelper).toBeDefined();
    expect(smcHelper).toBeDefined();
    expect(repulsorHelper).toBeDefined();
    expect(statusDamageHelper).toBeDefined();
    expect(tempWeaponBonusHelper).toBeDefined();
    expect(subdualDamageHelper).toBeDefined();
    expect(weaponStatusHelper).toBeDefined();
    expect(parseSourceDefectionHelperBlockData(defectionHelper!.blockData)).toEqual({
      nextCallFrameAndPhase: (43 << 2) | 2,
      detectionStart: 42,
      detectionEnd: 140,
      flashPhase: 1.75,
      doFx: true,
    });
    expect(parseSourceFiringTrackerBlockData(firingTrackerHelper!.blockData)).toEqual({
      nextCallFrameAndPhase: (96 << 2) | 2,
      consecutiveShots: 4,
      victimId: 91,
      frameToStartCooldown: 96,
    });
    expect(parseSourceBaseOnlyObjectHelperBlockData(smcHelper!.blockData)).toEqual({
      nextCallFrameAndPhase: (77 << 2) | 2,
    });
    expect(parseSourceBaseOnlyObjectHelperBlockData(repulsorHelper!.blockData)).toEqual({
      nextCallFrameAndPhase: (102 << 2) | 2,
    });
    expect(parseSourceStatusDamageHelperBlockData(statusDamageHelper!.blockData)).toEqual({
      nextCallFrameAndPhase: (132 << 2) | 2,
      currentStatus: 38,
      frameToHeal: 132,
    });
    expect(parseSourceTempWeaponBonusHelperBlockData(tempWeaponBonusHelper!.blockData)).toEqual({
      nextCallFrameAndPhase: (120 << 2) | 2,
      currentBonus: 23,
      frameToRemove: 120,
    });
    expect(parseSourceSubdualDamageHelperBlockData(subdualDamageHelper!.blockData)).toEqual({
      nextCallFrameAndPhase: (43 << 2) | 2,
      healingStepCountdown: 3,
    });
    expect(parseSourceBaseOnlyObjectHelperBlockData(weaponStatusHelper!.blockData)).toEqual({
      nextCallFrameAndPhase: (43 << 2) | 3,
    });
  });

  it('rewrites source OverchargeBehavior modules via resolved module tags', () => {
    const sourceGameLogicBytes = createSourceGameLogicChunkData(false, [{
      identifier: 'ModuleTag_Overcharge',
      blockData: createSourceOverchargeBehaviorBlockData((99 << 2) | 2, false),
    }]);

    const saveFile = buildRuntimeSaveFile({
      description: 'source overcharge rewrite',
      mapPath: 'Maps/RuntimeTank/RuntimeTank.map',
      mapData: {
        width: 1,
        height: 1,
        tiles: [0],
        objects: [],
        waypoints: [],
        namedAreas: [],
        namedPolygons: [],
        namedWaypointPaths: [],
        startPositions: [],
        meta: {
          name: 'RuntimeTank',
          players: 1,
          supplyDockCount: 0,
          oilDerrickCount: 0,
          techBuildingCount: 0,
        },
        blendTileCount: 0,
      },
      cameraState: null,
      passthroughBlocks: [{
        blockName: 'CHUNK_GameLogic',
        blockData: sourceGameLogicBytes.slice().buffer,
      }],
      gameLogic: {
        captureSourceTerrainLogicRuntimeSaveState: () => ({
          version: 2,
          activeBoundary: 0,
          waterUpdates: [],
        }),
        captureSourcePartitionRuntimeSaveState: createEmptyPartitionState,
        captureSourcePlayerRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceRadarRuntimeSaveState: createEmptyRadarState,
        captureSourceSidesListRuntimeSaveState: () => createEmptySidesListState(),
        captureSourceTeamFactoryRuntimeSaveState: () => createEmptyTeamFactoryState(),
        captureSourceScriptEngineRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceInGameUiRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceGameLogicRuntimeSaveState: () => ({
          version: 10,
          nextId: 8,
          nextProjectileVisualId: 1,
          animationTime: 0,
          selectedEntityId: null,
          selectedEntityIds: [],
          scriptSelectionChangedFrame: 0,
          frameCounter: 42,
          controlBarDirtyFrame: 0,
          scriptObjectTopologyVersion: 0,
          scriptObjectCountChangedFrame: 0,
          defeatedSides: new Set<string>(),
          gameEndFrame: null,
          scriptEndGameTimerActive: false,
          objectTriggerAreaStates: [],
          spawnedEntities: [{
            id: 7,
            templateName: 'RuntimeTank',
            x: 10,
            y: 0,
            z: 20,
            rotationY: 1.25,
            overchargeActive: true,
          } as unknown as import('@generals/game-logic').MapEntity],
        }),
        resolveSourceObjectModuleTypeByTag: (templateName, moduleTag) =>
          templateName === 'RuntimeTank' && moduleTag === 'ModuleTag_Overcharge'
            ? 'OVERCHARGEBEHAVIOR'
            : null,
        captureBrowserRuntimeSaveState: () => ({ version: 1 }),
        getObjectIdCounter: () => 8,
      },
    });

    const firstObject = readFirstSourceGameLogicObjectState(saveFile.data);
    const overchargeModule = firstObject?.modules.find((module) => module.identifier === 'ModuleTag_Overcharge');

    expect(overchargeModule).toBeDefined();
    expect(parseSourceOverchargeBehaviorBlockData(overchargeModule!.blockData)).toEqual({
      nextCallFrameAndPhase: (43 << 2) | 2,
      overchargeActive: true,
    });
  });

  it('rewrites source AutoHealBehavior modules via resolved module tags', () => {
    const sourceGameLogicBytes = createSourceGameLogicChunkData(false, [{
      identifier: 'ModuleTag_AutoHeal',
      blockData: createSourceAutoHealBehaviorBlockData((104 << 2) | 2, false, 55, 18, false),
    }]);

    const saveFile = buildRuntimeSaveFile({
      description: 'source auto-heal rewrite',
      mapPath: 'Maps/RuntimeTank/RuntimeTank.map',
      mapData: {
        width: 1,
        height: 1,
        tiles: [0],
        objects: [],
        waypoints: [],
        namedAreas: [],
        namedPolygons: [],
        namedWaypointPaths: [],
        startPositions: [],
        meta: {
          name: 'RuntimeTank',
          players: 1,
          supplyDockCount: 0,
          oilDerrickCount: 0,
          techBuildingCount: 0,
        },
        blendTileCount: 0,
      },
      cameraState: null,
      passthroughBlocks: [{
        blockName: 'CHUNK_GameLogic',
        blockData: sourceGameLogicBytes.slice().buffer,
      }],
      gameLogic: {
        captureSourceTerrainLogicRuntimeSaveState: () => ({
          version: 2,
          activeBoundary: 0,
          waterUpdates: [],
        }),
        captureSourcePartitionRuntimeSaveState: createEmptyPartitionState,
        captureSourcePlayerRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceRadarRuntimeSaveState: createEmptyRadarState,
        captureSourceSidesListRuntimeSaveState: () => createEmptySidesListState(),
        captureSourceTeamFactoryRuntimeSaveState: () => createEmptyTeamFactoryState(),
        captureSourceScriptEngineRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceInGameUiRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceGameLogicRuntimeSaveState: () => ({
          version: 10,
          nextId: 8,
          nextProjectileVisualId: 1,
          animationTime: 0,
          selectedEntityId: null,
          selectedEntityIds: [],
          scriptSelectionChangedFrame: 0,
          frameCounter: 42,
          controlBarDirtyFrame: 0,
          scriptObjectTopologyVersion: 0,
          scriptObjectCountChangedFrame: 0,
          defeatedSides: new Set<string>(),
          gameEndFrame: null,
          scriptEndGameTimerActive: false,
          objectTriggerAreaStates: [],
          spawnedEntities: [{
            id: 7,
            templateName: 'RuntimeTank',
            x: 10,
            y: 0,
            z: 20,
            rotationY: 1.25,
            health: 150,
            maxHealth: 200,
            autoHealProfile: {
              healingAmount: 10,
              healingDelayFrames: 30,
              startHealingDelayFrames: 48,
              radius: 0,
              affectsWholePlayer: false,
              initiallyActive: true,
              singleBurst: false,
              kindOf: null,
              forbiddenKindOf: null,
              radiusParticleSystemName: '',
              unitHealPulseParticleSystemName: '',
              skipSelfForHealing: false,
            },
            autoHealNextFrame: 88,
            autoHealSoonestHealFrame: 77,
            autoHealStopped: false,
            autoHealDamageDelayUntilFrame: 90,
            autoHealSingleBurstDone: false,
          } as unknown as import('@generals/game-logic').MapEntity],
        }),
        resolveSourceObjectModuleTypeByTag: (templateName, moduleTag) =>
          templateName === 'RuntimeTank' && moduleTag === 'ModuleTag_AutoHeal'
            ? 'AUTOHEALBEHAVIOR'
            : null,
        captureBrowserRuntimeSaveState: () => ({ version: 1 }),
        getObjectIdCounter: () => 8,
      },
    });

    const firstObject = readFirstSourceGameLogicObjectState(saveFile.data);
    const autoHealModule = firstObject?.modules.find((module) => module.identifier === 'ModuleTag_AutoHeal');

    expect(autoHealModule).toBeDefined();
    expect(parseSourceAutoHealBehaviorBlockData(autoHealModule!.blockData)).toEqual({
      nextCallFrameAndPhase: (90 << 2) | 2,
      upgradeExecuted: false,
      radiusParticleSystemId: 55,
      soonestHealFrame: 77,
      stopped: false,
    });
  });

  it('rewrites source GrantStealthBehavior modules via resolved module tags', () => {
    const sourceGameLogicBytes = createSourceGameLogicChunkData(false, [{
      identifier: 'ModuleTag_GrantStealth',
      blockData: createSourceGrantStealthBehaviorBlockData((101 << 2) | 2, 77, 15),
    }]);

    const saveFile = buildRuntimeSaveFile({
      description: 'source grant stealth rewrite',
      mapPath: 'Maps/RuntimeTank/RuntimeTank.map',
      mapData: {
        width: 1,
        height: 1,
        tiles: [0],
        objects: [],
        waypoints: [],
        namedAreas: [],
        namedPolygons: [],
        namedWaypointPaths: [],
        startPositions: [],
        meta: {
          name: 'RuntimeTank',
          players: 1,
          supplyDockCount: 0,
          oilDerrickCount: 0,
          techBuildingCount: 0,
        },
        blendTileCount: 0,
      },
      cameraState: null,
      passthroughBlocks: [{
        blockName: 'CHUNK_GameLogic',
        blockData: sourceGameLogicBytes.slice().buffer,
      }],
      gameLogic: {
        captureSourceTerrainLogicRuntimeSaveState: () => ({
          version: 2,
          activeBoundary: 0,
          waterUpdates: [],
        }),
        captureSourcePartitionRuntimeSaveState: createEmptyPartitionState,
        captureSourcePlayerRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceRadarRuntimeSaveState: createEmptyRadarState,
        captureSourceSidesListRuntimeSaveState: () => createEmptySidesListState(),
        captureSourceTeamFactoryRuntimeSaveState: () => createEmptyTeamFactoryState(),
        captureSourceScriptEngineRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceInGameUiRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceGameLogicRuntimeSaveState: () => ({
          version: 10,
          nextId: 8,
          nextProjectileVisualId: 1,
          animationTime: 0,
          selectedEntityId: null,
          selectedEntityIds: [],
          scriptSelectionChangedFrame: 0,
          frameCounter: 42,
          controlBarDirtyFrame: 0,
          scriptObjectTopologyVersion: 0,
          scriptObjectCountChangedFrame: 0,
          defeatedSides: new Set<string>(),
          gameEndFrame: null,
          scriptEndGameTimerActive: false,
          objectTriggerAreaStates: [],
          spawnedEntities: [{
            id: 7,
            templateName: 'RuntimeTank',
            x: 10,
            y: 0,
            z: 20,
            rotationY: 1.25,
            grantStealthProfile: {
              startRadius: 0,
              finalRadius: 100,
              radiusGrowRate: 10,
              kindOf: null,
            },
            grantStealthCurrentRadius: 35,
          } as unknown as import('@generals/game-logic').MapEntity],
        }),
        resolveSourceObjectModuleTypeByTag: (templateName, moduleTag) =>
          templateName === 'RuntimeTank' && moduleTag === 'ModuleTag_GrantStealth'
            ? 'GRANTSTEALTHBEHAVIOR'
            : null,
        captureBrowserRuntimeSaveState: () => ({ version: 1 }),
        getObjectIdCounter: () => 8,
      },
    });

    const firstObject = readFirstSourceGameLogicObjectState(saveFile.data);
    const grantStealthModule = firstObject?.modules.find((module) => module.identifier === 'ModuleTag_GrantStealth');

    expect(grantStealthModule).toBeDefined();
    expect(parseSourceGrantStealthBehaviorBlockData(grantStealthModule!.blockData)).toEqual({
      nextCallFrameAndPhase: (43 << 2) | 2,
      radiusParticleSystemId: 77,
      currentScanRadius: 35,
    });
  });

  it('rewrites source CountermeasuresBehavior modules via resolved module tags', () => {
    const sourceGameLogicBytes = createSourceGameLogicChunkData(false, [{
      identifier: 'ModuleTag_Countermeasures',
      blockData: createSourceCountermeasuresBehaviorBlockData((103 << 2) | 2, true, [91], 1, 1, 2, 3, 90, 120),
    }]);

    const saveFile = buildRuntimeSaveFile({
      description: 'source countermeasures rewrite',
      mapPath: 'Maps/RuntimeTank/RuntimeTank.map',
      mapData: {
        width: 1,
        height: 1,
        tiles: [0],
        objects: [],
        waypoints: [],
        namedAreas: [],
        namedPolygons: [],
        namedWaypointPaths: [],
        startPositions: [],
        meta: {
          name: 'RuntimeTank',
          players: 1,
          supplyDockCount: 0,
          oilDerrickCount: 0,
          techBuildingCount: 0,
        },
        blendTileCount: 0,
      },
      cameraState: null,
      passthroughBlocks: [{
        blockName: 'CHUNK_GameLogic',
        blockData: sourceGameLogicBytes.slice().buffer,
      }],
      gameLogic: {
        captureSourceTerrainLogicRuntimeSaveState: () => ({
          version: 2,
          activeBoundary: 0,
          waterUpdates: [],
        }),
        captureSourcePartitionRuntimeSaveState: createEmptyPartitionState,
        captureSourcePlayerRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceRadarRuntimeSaveState: createEmptyRadarState,
        captureSourceSidesListRuntimeSaveState: () => createEmptySidesListState(),
        captureSourceTeamFactoryRuntimeSaveState: () => createEmptyTeamFactoryState(),
        captureSourceScriptEngineRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceInGameUiRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceGameLogicRuntimeSaveState: () => ({
          version: 10,
          nextId: 8,
          nextProjectileVisualId: 1,
          animationTime: 0,
          selectedEntityId: null,
          selectedEntityIds: [],
          scriptSelectionChangedFrame: 0,
          frameCounter: 42,
          controlBarDirtyFrame: 0,
          scriptObjectTopologyVersion: 0,
          scriptObjectCountChangedFrame: 0,
          defeatedSides: new Set<string>(),
          gameEndFrame: null,
          scriptEndGameTimerActive: false,
          objectTriggerAreaStates: [],
          spawnedEntities: [{
            id: 7,
            templateName: 'RuntimeTank',
            x: 10,
            y: 0,
            z: 20,
            rotationY: 1.25,
            countermeasuresState: {
              availableCountermeasures: 4,
              activeCountermeasures: 2,
              flareIds: [1001, 1002],
              reactionFrame: 88,
              nextVolleyFrame: 116,
              reloadFrame: 0,
              incomingMissiles: 7,
              divertedMissiles: 5,
            },
          } as unknown as import('@generals/game-logic').MapEntity],
        }),
        resolveSourceObjectModuleTypeByTag: (templateName, moduleTag) =>
          templateName === 'RuntimeTank' && moduleTag === 'ModuleTag_Countermeasures'
            ? 'COUNTERMEASURESBEHAVIOR'
            : null,
        captureBrowserRuntimeSaveState: () => ({ version: 1 }),
        getObjectIdCounter: () => 8,
      },
    });

    const firstObject = readFirstSourceGameLogicObjectState(saveFile.data);
    const countermeasuresModule = firstObject?.modules.find((module) => module.identifier === 'ModuleTag_Countermeasures');

    expect(countermeasuresModule).toBeDefined();
    expect(parseSourceCountermeasuresBehaviorBlockData(countermeasuresModule!.blockData)).toEqual({
      nextCallFrameAndPhase: (43 << 2) | 2,
      upgradeExecuted: true,
      flareIds: [1001, 1002],
      availableCountermeasures: 4,
      activeCountermeasures: 2,
      divertedMissiles: 5,
      incomingMissiles: 7,
      reactionFrame: 88,
      nextVolleyFrame: 116,
    });
  });

  it('rewrites source WeaponBonusUpdate modules via resolved module tags', () => {
    const sourceGameLogicBytes = createSourceGameLogicChunkData(false, [{
      identifier: 'ModuleTag_Propaganda',
      blockData: createSourceWeaponBonusUpdateBlockData((111 << 2) | 2),
    }]);

    const saveFile = buildRuntimeSaveFile({
      description: 'source weapon bonus rewrite',
      mapPath: 'Maps/RuntimeTank/RuntimeTank.map',
      mapData: {
        width: 1,
        height: 1,
        tiles: [0],
        objects: [],
        waypoints: [],
        namedAreas: [],
        namedPolygons: [],
        namedWaypointPaths: [],
        startPositions: [],
        meta: {
          name: 'RuntimeTank',
          players: 1,
          supplyDockCount: 0,
          oilDerrickCount: 0,
          techBuildingCount: 0,
        },
        blendTileCount: 0,
      },
      cameraState: null,
      passthroughBlocks: [{
        blockName: 'CHUNK_GameLogic',
        blockData: sourceGameLogicBytes.slice().buffer,
      }],
      gameLogic: {
        captureSourceTerrainLogicRuntimeSaveState: () => ({
          version: 2,
          activeBoundary: 0,
          waterUpdates: [],
        }),
        captureSourcePartitionRuntimeSaveState: createEmptyPartitionState,
        captureSourcePlayerRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceRadarRuntimeSaveState: createEmptyRadarState,
        captureSourceSidesListRuntimeSaveState: () => createEmptySidesListState(),
        captureSourceTeamFactoryRuntimeSaveState: () => createEmptyTeamFactoryState(),
        captureSourceScriptEngineRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceInGameUiRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceGameLogicRuntimeSaveState: () => ({
          version: 10,
          nextId: 8,
          nextProjectileVisualId: 1,
          animationTime: 0,
          selectedEntityId: null,
          selectedEntityIds: [],
          scriptSelectionChangedFrame: 0,
          frameCounter: 42,
          controlBarDirtyFrame: 0,
          scriptObjectTopologyVersion: 0,
          scriptObjectCountChangedFrame: 0,
          defeatedSides: new Set<string>(),
          gameEndFrame: null,
          scriptEndGameTimerActive: false,
          objectTriggerAreaStates: [],
          spawnedEntities: [{
            id: 7,
            templateName: 'RuntimeTank',
            x: 10,
            y: 0,
            z: 20,
            rotationY: 1.25,
            weaponBonusUpdateProfiles: [{
              moduleTag: 'MODULETAG_PROPAGANDA',
              requiredKindOf: new Set<string>(),
              forbiddenKindOf: new Set<string>(),
              bonusDurationFrames: 90,
              bonusDelayFrames: 30,
              bonusRange: 200,
              bonusConditionFlag: 1 << 4,
            }],
            weaponBonusUpdateNextPulseFrames: [97],
          } as unknown as import('@generals/game-logic').MapEntity],
        }),
        resolveSourceObjectModuleTypeByTag: (templateName, moduleTag) =>
          templateName === 'RuntimeTank' && moduleTag === 'ModuleTag_Propaganda'
            ? 'WEAPONBONUSUPDATE'
            : null,
        captureBrowserRuntimeSaveState: () => ({ version: 1 }),
        getObjectIdCounter: () => 8,
      },
    });

    const firstObject = readFirstSourceGameLogicObjectState(saveFile.data);
    const weaponBonusModule = firstObject?.modules.find((module) => module.identifier === 'ModuleTag_Propaganda');

    expect(weaponBonusModule).toBeDefined();
    expect(parseSourceWeaponBonusUpdateBlockData(weaponBonusModule!.blockData)).toEqual({
      nextCallFrameAndPhase: (97 << 2) | 2,
    });
  });

  it('rewrites source PowerPlantUpdate modules via resolved module tags', () => {
    const sourceGameLogicBytes = createSourceGameLogicChunkData(false, [{
      identifier: 'ModuleTag_PowerPlant',
      blockData: createSourcePowerPlantUpdateBlockData((88 << 2) | 2, false),
    }]);

    const saveFile = buildRuntimeSaveFile({
      description: 'source power plant rewrite',
      mapPath: 'Maps/RuntimeTank/RuntimeTank.map',
      mapData: {
        width: 1,
        height: 1,
        tiles: [0],
        objects: [],
        waypoints: [],
        namedAreas: [],
        namedPolygons: [],
        namedWaypointPaths: [],
        startPositions: [],
        meta: {
          name: 'RuntimeTank',
          players: 1,
          supplyDockCount: 0,
          oilDerrickCount: 0,
          techBuildingCount: 0,
        },
        blendTileCount: 0,
      },
      cameraState: null,
      passthroughBlocks: [{
        blockName: 'CHUNK_GameLogic',
        blockData: sourceGameLogicBytes.slice().buffer,
      }],
      gameLogic: {
        captureSourceTerrainLogicRuntimeSaveState: () => ({
          version: 2,
          activeBoundary: 0,
          waterUpdates: [],
        }),
        captureSourcePartitionRuntimeSaveState: createEmptyPartitionState,
        captureSourcePlayerRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceRadarRuntimeSaveState: createEmptyRadarState,
        captureSourceSidesListRuntimeSaveState: () => createEmptySidesListState(),
        captureSourceTeamFactoryRuntimeSaveState: () => createEmptyTeamFactoryState(),
        captureSourceScriptEngineRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceInGameUiRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceGameLogicRuntimeSaveState: () => ({
          version: 10,
          nextId: 8,
          nextProjectileVisualId: 1,
          animationTime: 0,
          selectedEntityId: null,
          selectedEntityIds: [],
          scriptSelectionChangedFrame: 0,
          frameCounter: 42,
          controlBarDirtyFrame: 0,
          scriptObjectTopologyVersion: 0,
          scriptObjectCountChangedFrame: 0,
          defeatedSides: new Set<string>(),
          gameEndFrame: null,
          scriptEndGameTimerActive: false,
          objectTriggerAreaStates: [],
          spawnedEntities: [{
            id: 7,
            templateName: 'RuntimeTank',
            x: 10,
            y: 0,
            z: 20,
            rotationY: 1.25,
            powerPlantUpdateState: {
              extended: true,
              upgradeFinishFrame: 120,
            },
          } as unknown as import('@generals/game-logic').MapEntity],
        }),
        resolveSourceObjectModuleTypeByTag: (templateName, moduleTag) =>
          templateName === 'RuntimeTank' && moduleTag === 'ModuleTag_PowerPlant'
            ? 'POWERPLANTUPDATE'
            : null,
        captureBrowserRuntimeSaveState: () => ({ version: 1 }),
        getObjectIdCounter: () => 8,
      },
    });

    const firstObject = readFirstSourceGameLogicObjectState(saveFile.data);
    const powerPlantModule = firstObject?.modules.find((module) => module.identifier === 'ModuleTag_PowerPlant');

    expect(powerPlantModule).toBeDefined();
    expect(parseSourcePowerPlantUpdateBlockData(powerPlantModule!.blockData)).toEqual({
      nextCallFrameAndPhase: (120 << 2) | 2,
      extended: true,
    });
  });

  it('rewrites source EnemyNearUpdate modules from live runtime state', () => {
    const sourceGameLogicBytes = createSourceGameLogicChunkData(false, [{
      identifier: 'ModuleTag_EnemyNear',
      blockData: createSourceEnemyNearUpdateBlockData((90 << 2) | 2, 12, false),
    }]);

    const saveFile = buildRuntimeSaveFile({
      description: 'source enemy near rewrite',
      mapPath: 'Maps/RuntimeTank/RuntimeTank.map',
      mapData: {
        width: 1,
        height: 1,
        tiles: [0],
        objects: [],
        waypoints: [],
        namedAreas: [],
        namedPolygons: [],
        namedWaypointPaths: [],
        startPositions: [],
        meta: {
          name: 'RuntimeTank',
          players: 1,
          supplyDockCount: 0,
          oilDerrickCount: 0,
          techBuildingCount: 0,
        },
        blendTileCount: 0,
      },
      cameraState: null,
      passthroughBlocks: [{
        blockName: 'CHUNK_GameLogic',
        blockData: sourceGameLogicBytes.slice().buffer,
      }],
      gameLogic: {
        captureSourceTerrainLogicRuntimeSaveState: () => ({
          version: 2,
          activeBoundary: 0,
          waterUpdates: [],
        }),
        captureSourcePartitionRuntimeSaveState: createEmptyPartitionState,
        captureSourcePlayerRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceRadarRuntimeSaveState: createEmptyRadarState,
        captureSourceSidesListRuntimeSaveState: () => createEmptySidesListState(),
        captureSourceTeamFactoryRuntimeSaveState: () => createEmptyTeamFactoryState(),
        captureSourceScriptEngineRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceInGameUiRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceGameLogicRuntimeSaveState: () => ({
          version: 10,
          nextId: 8,
          nextProjectileVisualId: 1,
          animationTime: 0,
          selectedEntityId: null,
          selectedEntityIds: [],
          scriptSelectionChangedFrame: 0,
          frameCounter: 42,
          controlBarDirtyFrame: 0,
          scriptObjectTopologyVersion: 0,
          scriptObjectCountChangedFrame: 0,
          defeatedSides: new Set<string>(),
          gameEndFrame: null,
          scriptEndGameTimerActive: false,
          objectTriggerAreaStates: [],
          spawnedEntities: [{
            id: 7,
            templateName: 'RuntimeTank',
            x: 10,
            y: 0,
            z: 20,
            rotationY: 1.25,
            enemyNearScanDelayFrames: 30,
            enemyNearNextScanCountdown: 5,
            enemyNearDetected: true,
          } as unknown as import('@generals/game-logic').MapEntity],
        }),
        resolveSourceObjectModuleTypeByTag: (templateName, moduleTag) =>
          templateName === 'RuntimeTank' && moduleTag === 'ModuleTag_EnemyNear'
            ? 'ENEMYNEARUPDATE'
            : null,
        captureBrowserRuntimeSaveState: () => ({ version: 1 }),
        getObjectIdCounter: () => 8,
      },
    });

    const firstObject = readFirstSourceGameLogicObjectState(saveFile.data);
    const enemyNearModule = firstObject?.modules.find((module) => module.identifier === 'ModuleTag_EnemyNear');

    expect(enemyNearModule).toBeDefined();
    expect(parseSourceEnemyNearUpdateBlockData(enemyNearModule!.blockData)).toEqual({
      nextCallFrameAndPhase: (43 << 2) | 2,
      enemyScanDelay: 5,
      enemyNear: true,
    });
  });

  it('rewrites source HordeUpdate modules from live runtime state', () => {
    const sourceGameLogicBytes = createSourceGameLogicChunkData(false, [{
      identifier: 'ModuleTag_Horde',
      blockData: createSourceHordeUpdateBlockData((88 << 2) | 2, false, true),
    }]);

    const saveFile = buildRuntimeSaveFile({
      description: 'source horde rewrite',
      mapPath: 'Maps/RuntimeTank/RuntimeTank.map',
      mapData: {
        width: 1,
        height: 1,
        tiles: [0],
        objects: [],
        waypoints: [],
        namedAreas: [],
        namedPolygons: [],
        namedWaypointPaths: [],
        startPositions: [],
        meta: {
          name: 'RuntimeTank',
          players: 1,
          supplyDockCount: 0,
          oilDerrickCount: 0,
          techBuildingCount: 0,
        },
        blendTileCount: 0,
      },
      cameraState: null,
      passthroughBlocks: [{
        blockName: 'CHUNK_GameLogic',
        blockData: sourceGameLogicBytes.slice().buffer,
      }],
      gameLogic: {
        captureSourceTerrainLogicRuntimeSaveState: () => ({
          version: 2,
          activeBoundary: 0,
          waterUpdates: [],
        }),
        captureSourcePartitionRuntimeSaveState: createEmptyPartitionState,
        captureSourcePlayerRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceRadarRuntimeSaveState: createEmptyRadarState,
        captureSourceSidesListRuntimeSaveState: () => createEmptySidesListState(),
        captureSourceTeamFactoryRuntimeSaveState: () => createEmptyTeamFactoryState(),
        captureSourceScriptEngineRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceInGameUiRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceGameLogicRuntimeSaveState: () => ({
          version: 10,
          nextId: 8,
          nextProjectileVisualId: 1,
          animationTime: 0,
          selectedEntityId: null,
          selectedEntityIds: [],
          scriptSelectionChangedFrame: 0,
          frameCounter: 42,
          controlBarDirtyFrame: 0,
          scriptObjectTopologyVersion: 0,
          scriptObjectCountChangedFrame: 0,
          defeatedSides: new Set<string>(),
          gameEndFrame: null,
          scriptEndGameTimerActive: false,
          objectTriggerAreaStates: [],
          spawnedEntities: [{
            id: 7,
            templateName: 'RuntimeTank',
            x: 10,
            y: 0,
            z: 20,
            rotationY: 1.25,
            kindOf: new Set<string>(['INFANTRY']),
            hordeProfile: {
              updateRate: 30,
              kindOf: new Set<string>(),
              minCount: 3,
              minDist: 80,
              rubOffRadius: 20,
              alliesOnly: true,
              exactMatch: false,
              action: 'HORDE',
              allowedNationalism: true,
              flagSubObjectNames: [],
            },
            hordeNextCheckFrame: 91,
            isInHorde: true,
            isTrueHordeMember: true,
          } as unknown as import('@generals/game-logic').MapEntity],
        }),
        resolveSourceObjectModuleTypeByTag: (templateName, moduleTag) =>
          templateName === 'RuntimeTank' && moduleTag === 'ModuleTag_Horde'
            ? 'HORDEUPDATE'
            : null,
        captureBrowserRuntimeSaveState: () => ({ version: 1 }),
        getObjectIdCounter: () => 8,
      },
    });

    const firstObject = readFirstSourceGameLogicObjectState(saveFile.data);
    const hordeModule = firstObject?.modules.find((module) => module.identifier === 'ModuleTag_Horde');

    expect(hordeModule).toBeDefined();
    expect(parseSourceHordeUpdateBlockData(hordeModule!.blockData)).toEqual({
      nextCallFrameAndPhase: (91 << 2) | 2,
      inHorde: true,
      hasFlag: true,
    });
  });

  it('rewrites source ProneUpdate modules from live runtime state', () => {
    const sourceGameLogicBytes = createSourceGameLogicChunkData(false, [{
      identifier: 'ModuleTag_Prone',
      blockData: createSourceProneUpdateBlockData((70 << 2) | 2, 0),
    }]);

    const saveFile = buildRuntimeSaveFile({
      description: 'source prone rewrite',
      mapPath: 'Maps/RuntimeTank/RuntimeTank.map',
      mapData: {
        width: 1,
        height: 1,
        tiles: [0],
        objects: [],
        waypoints: [],
        namedAreas: [],
        namedPolygons: [],
        namedWaypointPaths: [],
        startPositions: [],
        meta: {
          name: 'RuntimeTank',
          players: 1,
          supplyDockCount: 0,
          oilDerrickCount: 0,
          techBuildingCount: 0,
        },
        blendTileCount: 0,
      },
      cameraState: null,
      passthroughBlocks: [{
        blockName: 'CHUNK_GameLogic',
        blockData: sourceGameLogicBytes.slice().buffer,
      }],
      gameLogic: {
        captureSourceTerrainLogicRuntimeSaveState: () => ({
          version: 2,
          activeBoundary: 0,
          waterUpdates: [],
        }),
        captureSourcePartitionRuntimeSaveState: createEmptyPartitionState,
        captureSourcePlayerRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceRadarRuntimeSaveState: createEmptyRadarState,
        captureSourceSidesListRuntimeSaveState: () => createEmptySidesListState(),
        captureSourceTeamFactoryRuntimeSaveState: () => createEmptyTeamFactoryState(),
        captureSourceScriptEngineRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceInGameUiRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceGameLogicRuntimeSaveState: () => ({
          version: 10,
          nextId: 8,
          nextProjectileVisualId: 1,
          animationTime: 0,
          selectedEntityId: null,
          selectedEntityIds: [],
          scriptSelectionChangedFrame: 0,
          frameCounter: 42,
          controlBarDirtyFrame: 0,
          scriptObjectTopologyVersion: 0,
          scriptObjectCountChangedFrame: 0,
          defeatedSides: new Set<string>(),
          gameEndFrame: null,
          scriptEndGameTimerActive: false,
          objectTriggerAreaStates: [],
          spawnedEntities: [{
            id: 7,
            templateName: 'RuntimeTank',
            x: 10,
            y: 0,
            z: 20,
            rotationY: 1.25,
            proneDamageToFramesRatio: 2,
            proneFramesRemaining: 19,
          } as unknown as import('@generals/game-logic').MapEntity],
        }),
        resolveSourceObjectModuleTypeByTag: (templateName, moduleTag) =>
          templateName === 'RuntimeTank' && moduleTag === 'ModuleTag_Prone'
            ? 'PRONEUPDATE'
            : null,
        captureBrowserRuntimeSaveState: () => ({ version: 1 }),
        getObjectIdCounter: () => 8,
      },
    });

    const firstObject = readFirstSourceGameLogicObjectState(saveFile.data);
    const proneModule = firstObject?.modules.find((module) => module.identifier === 'ModuleTag_Prone');

    expect(proneModule).toBeDefined();
    expect(parseSourceProneUpdateBlockData(proneModule!.blockData)).toEqual({
      nextCallFrameAndPhase: (43 << 2) | 2,
      proneFrames: 19,
    });
  });

  it('rewrites source FireOCLAfterWeaponCooldownUpdate modules via resolved module tags', () => {
    const sourceGameLogicBytes = createSourceGameLogicChunkData(false, [{
      identifier: 'ModuleTag_FireOCL',
      blockData: createSourceFireOclAfterCooldownUpdateBlockData((77 << 2) | 2, true, false, 0, 0),
    }]);

    const saveFile = buildRuntimeSaveFile({
      description: 'source fire ocl after cooldown rewrite',
      mapPath: 'Maps/RuntimeTank/RuntimeTank.map',
      mapData: {
        width: 1,
        height: 1,
        tiles: [0],
        objects: [],
        waypoints: [],
        namedAreas: [],
        namedPolygons: [],
        namedWaypointPaths: [],
        startPositions: [],
        meta: {
          name: 'RuntimeTank',
          players: 1,
          supplyDockCount: 0,
          oilDerrickCount: 0,
          techBuildingCount: 0,
        },
        blendTileCount: 0,
      },
      cameraState: null,
      passthroughBlocks: [{
        blockName: 'CHUNK_GameLogic',
        blockData: sourceGameLogicBytes.slice().buffer,
      }],
      gameLogic: {
        captureSourceTerrainLogicRuntimeSaveState: () => ({
          version: 2,
          activeBoundary: 0,
          waterUpdates: [],
        }),
        captureSourcePartitionRuntimeSaveState: createEmptyPartitionState,
        captureSourcePlayerRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceRadarRuntimeSaveState: createEmptyRadarState,
        captureSourceSidesListRuntimeSaveState: () => createEmptySidesListState(),
        captureSourceTeamFactoryRuntimeSaveState: () => createEmptyTeamFactoryState(),
        captureSourceScriptEngineRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceInGameUiRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceGameLogicRuntimeSaveState: () => ({
          version: 10,
          nextId: 8,
          nextProjectileVisualId: 1,
          animationTime: 0,
          selectedEntityId: null,
          selectedEntityIds: [],
          scriptSelectionChangedFrame: 0,
          frameCounter: 42,
          controlBarDirtyFrame: 0,
          scriptObjectTopologyVersion: 0,
          scriptObjectCountChangedFrame: 0,
          defeatedSides: new Set<string>(),
          gameEndFrame: null,
          scriptEndGameTimerActive: false,
          objectTriggerAreaStates: [],
          spawnedEntities: [{
            id: 7,
            templateName: 'RuntimeTank',
            x: 10,
            y: 0,
            z: 20,
            rotationY: 1.25,
            fireOCLAfterCooldownProfiles: [{
              moduleTag: 'MODULETAG_FIREOCL',
              weaponSlot: 0,
              oclName: 'OCL_Test',
              minShotsRequired: 2,
              oclLifetimePerSecond: 1000,
              oclMaxFrames: 90,
            }],
            fireOCLAfterCooldownStates: [{
              valid: true,
              consecutiveShots: 4,
              startFrame: 31,
            }],
          } as unknown as import('@generals/game-logic').MapEntity],
        }),
        resolveSourceObjectModuleTypeByTag: (templateName, moduleTag) =>
          templateName === 'RuntimeTank' && moduleTag === 'ModuleTag_FireOCL'
            ? 'FIREOCLAFTERWEAPONCOOLDOWNUPDATE'
            : null,
        captureBrowserRuntimeSaveState: () => ({ version: 1 }),
        getObjectIdCounter: () => 8,
      },
    });

    const firstObject = readFirstSourceGameLogicObjectState(saveFile.data);
    const fireOclModule = firstObject?.modules.find((module) => module.identifier === 'ModuleTag_FireOCL');

    expect(fireOclModule).toBeDefined();
    expect(parseSourceFireOclAfterCooldownUpdateBlockData(fireOclModule!.blockData)).toEqual({
      nextCallFrameAndPhase: (43 << 2) | 2,
      upgradeExecuted: true,
      valid: true,
      consecutiveShots: 4,
      startFrame: 31,
    });
  });

  it('rewrites source AutoFindHealingUpdate modules from live runtime state', () => {
    const sourceGameLogicBytes = createSourceGameLogicChunkData(false, [{
      identifier: 'ModuleTag_AutoHealScan',
      blockData: createSourceAutoFindHealingUpdateBlockData((72 << 2) | 2, 0),
    }]);

    const saveFile = buildRuntimeSaveFile({
      description: 'source auto find healing rewrite',
      mapPath: 'Maps/RuntimeTank/RuntimeTank.map',
      mapData: {
        width: 1,
        height: 1,
        tiles: [0],
        objects: [],
        waypoints: [],
        namedAreas: [],
        namedPolygons: [],
        namedWaypointPaths: [],
        startPositions: [],
        meta: {
          name: 'RuntimeTank',
          players: 1,
          supplyDockCount: 0,
          oilDerrickCount: 0,
          techBuildingCount: 0,
        },
        blendTileCount: 0,
      },
      cameraState: null,
      passthroughBlocks: [{
        blockName: 'CHUNK_GameLogic',
        blockData: sourceGameLogicBytes.slice().buffer,
      }],
      gameLogic: {
        captureSourceTerrainLogicRuntimeSaveState: () => ({
          version: 2,
          activeBoundary: 0,
          waterUpdates: [],
        }),
        captureSourcePartitionRuntimeSaveState: createEmptyPartitionState,
        captureSourcePlayerRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceRadarRuntimeSaveState: createEmptyRadarState,
        captureSourceSidesListRuntimeSaveState: () => createEmptySidesListState(),
        captureSourceTeamFactoryRuntimeSaveState: () => createEmptyTeamFactoryState(),
        captureSourceScriptEngineRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceInGameUiRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceGameLogicRuntimeSaveState: () => ({
          version: 10,
          nextId: 8,
          nextProjectileVisualId: 1,
          animationTime: 0,
          selectedEntityId: null,
          selectedEntityIds: [],
          scriptSelectionChangedFrame: 0,
          frameCounter: 42,
          controlBarDirtyFrame: 0,
          scriptObjectTopologyVersion: 0,
          scriptObjectCountChangedFrame: 0,
          defeatedSides: new Set<string>(),
          gameEndFrame: null,
          scriptEndGameTimerActive: false,
          objectTriggerAreaStates: [],
          spawnedEntities: [{
            id: 7,
            templateName: 'RuntimeTank',
            x: 10,
            y: 0,
            z: 20,
            rotationY: 1.25,
            autoFindHealingProfile: {
              scanRateFrames: 12,
              scanRange: 150,
              neverHeal: 0.95,
              alwaysHeal: 0.25,
            },
            autoFindHealingNextScanFrame: 58,
          } as unknown as import('@generals/game-logic').MapEntity],
        }),
        resolveSourceObjectModuleTypeByTag: (templateName, moduleTag) =>
          templateName === 'RuntimeTank' && moduleTag === 'ModuleTag_AutoHealScan'
            ? 'AUTOFINDHEALINGUPDATE'
            : null,
        captureBrowserRuntimeSaveState: () => ({ version: 1 }),
        getObjectIdCounter: () => 8,
      },
    });

    const firstObject = readFirstSourceGameLogicObjectState(saveFile.data);
    const autoFindHealingModule = firstObject?.modules.find((module) => module.identifier === 'ModuleTag_AutoHealScan');

    expect(autoFindHealingModule).toBeDefined();
    expect(parseSourceAutoFindHealingUpdateBlockData(autoFindHealingModule!.blockData)).toEqual({
      nextCallFrameAndPhase: (43 << 2) | 2,
      nextScanFrames: 15,
    });
  });

  it('rewrites source RadiusDecalUpdate modules from live runtime state', () => {
    const sourceGameLogicBytes = createSourceGameLogicChunkData(false, [{
      identifier: 'ModuleTag_RadiusDecal',
      blockData: createSourceRadiusDecalUpdateBlockData((84 << 2) | 2, false),
    }]);

    const saveFile = buildRuntimeSaveFile({
      description: 'source radius decal rewrite',
      mapPath: 'Maps/RuntimeTank/RuntimeTank.map',
      mapData: {
        width: 1,
        height: 1,
        tiles: [0],
        objects: [],
        waypoints: [],
        namedAreas: [],
        namedPolygons: [],
        namedWaypointPaths: [],
        startPositions: [],
        meta: {
          name: 'RuntimeTank',
          players: 1,
          supplyDockCount: 0,
          oilDerrickCount: 0,
          techBuildingCount: 0,
        },
        blendTileCount: 0,
      },
      cameraState: null,
      passthroughBlocks: [{
        blockName: 'CHUNK_GameLogic',
        blockData: sourceGameLogicBytes.slice().buffer,
      }],
      gameLogic: {
        captureSourceTerrainLogicRuntimeSaveState: () => ({
          version: 2,
          activeBoundary: 0,
          waterUpdates: [],
        }),
        captureSourcePartitionRuntimeSaveState: createEmptyPartitionState,
        captureSourcePlayerRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceRadarRuntimeSaveState: createEmptyRadarState,
        captureSourceSidesListRuntimeSaveState: () => createEmptySidesListState(),
        captureSourceTeamFactoryRuntimeSaveState: () => createEmptyTeamFactoryState(),
        captureSourceScriptEngineRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceInGameUiRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceGameLogicRuntimeSaveState: () => ({
          version: 10,
          nextId: 8,
          nextProjectileVisualId: 1,
          animationTime: 0,
          selectedEntityId: null,
          selectedEntityIds: [],
          scriptSelectionChangedFrame: 0,
          frameCounter: 42,
          controlBarDirtyFrame: 0,
          scriptObjectTopologyVersion: 0,
          scriptObjectCountChangedFrame: 0,
          defeatedSides: new Set<string>(),
          gameEndFrame: null,
          scriptEndGameTimerActive: false,
          objectTriggerAreaStates: [],
          spawnedEntities: [{
            id: 7,
            templateName: 'RuntimeTank',
            x: 10,
            y: 0,
            z: 20,
            rotationY: 1.25,
            radiusDecalStates: [{
              positionX: 10,
              positionY: 0,
              positionZ: 20,
              radius: 35,
              visible: true,
              killWhenNoLongerAttacking: false,
            }],
            radiusDecalModuleStates: [{
              moduleTag: 'MODULETAG_RADIUSDECAL',
              killWhenNoLongerAttacking: true,
            }],
          } as unknown as import('@generals/game-logic').MapEntity],
        }),
        resolveSourceObjectModuleTypeByTag: (templateName, moduleTag) =>
          templateName === 'RuntimeTank' && moduleTag === 'ModuleTag_RadiusDecal'
            ? 'RADIUSDECALUPDATE'
            : null,
        captureBrowserRuntimeSaveState: () => ({ version: 1 }),
        getObjectIdCounter: () => 8,
      },
    });

    const firstObject = readFirstSourceGameLogicObjectState(saveFile.data);
    const radiusDecalModule = firstObject?.modules.find((module) => module.identifier === 'ModuleTag_RadiusDecal');

    expect(radiusDecalModule).toBeDefined();
    expect(parseSourceRadiusDecalUpdateBlockData(radiusDecalModule!.blockData)).toEqual({
      nextCallFrameAndPhase: (43 << 2) | 2,
      killWhenNoLongerAttacking: true,
    });
  });

  it('rewrites source BaseRegenerateUpdate modules from live runtime state', () => {
    const sourceGameLogicBytes = createSourceGameLogicChunkData(false, [{
      identifier: 'ModuleTag_BaseRegen',
      blockData: createSourceBaseRegenerateUpdateBlockData((84 << 2) | 2),
    }]);

    const saveFile = buildRuntimeSaveFile({
      description: 'source base regenerate rewrite',
      mapPath: 'Maps/RuntimeTank/RuntimeTank.map',
      mapData: {
        width: 1,
        height: 1,
        tiles: [0],
        objects: [],
        waypoints: [],
        namedAreas: [],
        namedPolygons: [],
        namedWaypointPaths: [],
        startPositions: [],
        meta: {
          name: 'RuntimeTank',
          players: 1,
          supplyDockCount: 0,
          oilDerrickCount: 0,
          techBuildingCount: 0,
        },
        blendTileCount: 0,
      },
      cameraState: null,
      passthroughBlocks: [{
        blockName: 'CHUNK_GameLogic',
        blockData: sourceGameLogicBytes.slice().buffer,
      }],
      gameLogic: {
        captureSourceTerrainLogicRuntimeSaveState: () => ({
          version: 2,
          activeBoundary: 0,
          waterUpdates: [],
        }),
        captureSourcePartitionRuntimeSaveState: createEmptyPartitionState,
        captureSourcePlayerRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceRadarRuntimeSaveState: createEmptyRadarState,
        captureSourceSidesListRuntimeSaveState: () => createEmptySidesListState(),
        captureSourceTeamFactoryRuntimeSaveState: () => createEmptyTeamFactoryState(),
        captureSourceScriptEngineRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceInGameUiRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceGameLogicRuntimeSaveState: () => ({
          version: 10,
          nextId: 8,
          nextProjectileVisualId: 1,
          animationTime: 0,
          selectedEntityId: null,
          selectedEntityIds: [],
          scriptSelectionChangedFrame: 0,
          frameCounter: 42,
          controlBarDirtyFrame: 0,
          scriptObjectTopologyVersion: 0,
          scriptObjectCountChangedFrame: 0,
          defeatedSides: new Set<string>(),
          gameEndFrame: null,
          scriptEndGameTimerActive: false,
          objectTriggerAreaStates: [],
          spawnedEntities: [{
            id: 7,
            templateName: 'RuntimeTank',
            x: 10,
            y: 0,
            z: 20,
            rotationY: 1.25,
            health: 300,
            maxHealth: 500,
            baseRegenDelayUntilFrame: 75,
            objectStatusFlags: new Set<string>(),
          } as unknown as import('@generals/game-logic').MapEntity],
        }),
        resolveSourceObjectModuleTypeByTag: (templateName, moduleTag) =>
          templateName === 'RuntimeTank' && moduleTag === 'ModuleTag_BaseRegen'
            ? 'BASEREGENERATEUPDATE'
            : null,
        captureBrowserRuntimeSaveState: () => ({ version: 1 }),
        getObjectIdCounter: () => 8,
      },
    });

    const firstObject = readFirstSourceGameLogicObjectState(saveFile.data);
    const baseRegenModule = firstObject?.modules.find((module) => module.identifier === 'ModuleTag_BaseRegen');

    expect(baseRegenModule).toBeDefined();
    expect(parseSourceBaseRegenerateUpdateBlockData(baseRegenModule!.blockData)).toEqual({
      nextCallFrameAndPhase: (75 << 2) | 2,
    });
  });

  it('rewrites source LifetimeUpdate modules from live runtime state', () => {
    const sourceGameLogicBytes = createSourceGameLogicChunkData(false, [{
      identifier: 'ModuleTag_Lifetime',
      blockData: createSourceLifetimeUpdateBlockData((84 << 2) | 2, 120),
    }]);

    const saveFile = buildRuntimeSaveFile({
      description: 'source lifetime rewrite',
      mapPath: 'Maps/RuntimeTank/RuntimeTank.map',
      mapData: {
        width: 1,
        height: 1,
        tiles: [0],
        objects: [],
        waypoints: [],
        namedAreas: [],
        namedPolygons: [],
        namedWaypointPaths: [],
        startPositions: [],
        meta: {
          name: 'RuntimeTank',
          players: 1,
          supplyDockCount: 0,
          oilDerrickCount: 0,
          techBuildingCount: 0,
        },
        blendTileCount: 0,
      },
      cameraState: null,
      passthroughBlocks: [{
        blockName: 'CHUNK_GameLogic',
        blockData: sourceGameLogicBytes.slice().buffer,
      }],
      gameLogic: {
        captureSourceTerrainLogicRuntimeSaveState: () => ({
          version: 2,
          activeBoundary: 0,
          waterUpdates: [],
        }),
        captureSourcePartitionRuntimeSaveState: createEmptyPartitionState,
        captureSourcePlayerRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceRadarRuntimeSaveState: createEmptyRadarState,
        captureSourceSidesListRuntimeSaveState: () => createEmptySidesListState(),
        captureSourceTeamFactoryRuntimeSaveState: () => createEmptyTeamFactoryState(),
        captureSourceScriptEngineRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceInGameUiRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceGameLogicRuntimeSaveState: () => ({
          version: 10,
          nextId: 8,
          nextProjectileVisualId: 1,
          animationTime: 0,
          selectedEntityId: null,
          selectedEntityIds: [],
          scriptSelectionChangedFrame: 0,
          frameCounter: 42,
          controlBarDirtyFrame: 0,
          scriptObjectTopologyVersion: 0,
          scriptObjectCountChangedFrame: 0,
          defeatedSides: new Set<string>(),
          gameEndFrame: null,
          scriptEndGameTimerActive: false,
          objectTriggerAreaStates: [],
          spawnedEntities: [{
            id: 7,
            templateName: 'RuntimeTank',
            x: 10,
            y: 0,
            z: 20,
            rotationY: 1.25,
            lifetimeDieFrame: 333,
          } as unknown as import('@generals/game-logic').MapEntity],
        }),
        resolveSourceObjectModuleTypeByTag: (templateName, moduleTag) =>
          templateName === 'RuntimeTank' && moduleTag === 'ModuleTag_Lifetime'
            ? 'LIFETIMEUPDATE'
            : null,
        captureBrowserRuntimeSaveState: () => ({ version: 1 }),
        getObjectIdCounter: () => 8,
      },
    });

    const firstObject = readFirstSourceGameLogicObjectState(saveFile.data);
    const lifetimeModule = firstObject?.modules.find((module) => module.identifier === 'ModuleTag_Lifetime');

    expect(lifetimeModule).toBeDefined();
    expect(parseSourceLifetimeUpdateBlockData(lifetimeModule!.blockData)).toEqual({
      nextCallFrameAndPhase: (333 << 2) | 2,
      dieFrame: 333,
    });
  });

  it('rewrites source DeletionUpdate modules from live runtime state', () => {
    const sourceGameLogicBytes = createSourceGameLogicChunkData(false, [{
      identifier: 'ModuleTag_Delete',
      blockData: createSourceDeletionUpdateBlockData((84 << 2) | 2, 120),
    }]);

    const saveFile = buildRuntimeSaveFile({
      description: 'source deletion rewrite',
      mapPath: 'Maps/RuntimeTank/RuntimeTank.map',
      mapData: {
        width: 1,
        height: 1,
        tiles: [0],
        objects: [],
        waypoints: [],
        namedAreas: [],
        namedPolygons: [],
        namedWaypointPaths: [],
        startPositions: [],
        meta: {
          name: 'RuntimeTank',
          players: 1,
          supplyDockCount: 0,
          oilDerrickCount: 0,
          techBuildingCount: 0,
        },
        blendTileCount: 0,
      },
      cameraState: null,
      passthroughBlocks: [{
        blockName: 'CHUNK_GameLogic',
        blockData: sourceGameLogicBytes.slice().buffer,
      }],
      gameLogic: {
        captureSourceTerrainLogicRuntimeSaveState: () => ({
          version: 2,
          activeBoundary: 0,
          waterUpdates: [],
        }),
        captureSourcePartitionRuntimeSaveState: createEmptyPartitionState,
        captureSourcePlayerRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceRadarRuntimeSaveState: createEmptyRadarState,
        captureSourceSidesListRuntimeSaveState: () => createEmptySidesListState(),
        captureSourceTeamFactoryRuntimeSaveState: () => createEmptyTeamFactoryState(),
        captureSourceScriptEngineRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceInGameUiRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceGameLogicRuntimeSaveState: () => ({
          version: 10,
          nextId: 8,
          nextProjectileVisualId: 1,
          animationTime: 0,
          selectedEntityId: null,
          selectedEntityIds: [],
          scriptSelectionChangedFrame: 0,
          frameCounter: 42,
          controlBarDirtyFrame: 0,
          scriptObjectTopologyVersion: 0,
          scriptObjectCountChangedFrame: 0,
          defeatedSides: new Set<string>(),
          gameEndFrame: null,
          scriptEndGameTimerActive: false,
          objectTriggerAreaStates: [],
          spawnedEntities: [{
            id: 7,
            templateName: 'RuntimeTank',
            x: 10,
            y: 0,
            z: 20,
            rotationY: 1.25,
            deletionDieFrame: 444,
          } as unknown as import('@generals/game-logic').MapEntity],
        }),
        resolveSourceObjectModuleTypeByTag: (templateName, moduleTag) =>
          templateName === 'RuntimeTank' && moduleTag === 'ModuleTag_Delete'
            ? 'DELETIONUPDATE'
            : null,
        captureBrowserRuntimeSaveState: () => ({ version: 1 }),
        getObjectIdCounter: () => 8,
      },
    });

    const firstObject = readFirstSourceGameLogicObjectState(saveFile.data);
    const deletionModule = firstObject?.modules.find((module) => module.identifier === 'ModuleTag_Delete');

    expect(deletionModule).toBeDefined();
    expect(parseSourceDeletionUpdateBlockData(deletionModule!.blockData)).toEqual({
      nextCallFrameAndPhase: (444 << 2) | 2,
      dieFrame: 444,
    });
  });

  it('rewrites source HeightDieUpdate modules from live runtime state', () => {
    const sourceGameLogicBytes = createSourceGameLogicChunkData(false, [{
      identifier: 'ModuleTag_HeightDie',
      blockData: createSourceHeightDieUpdateBlockData(
        (84 << 2) | 2,
        false,
        true,
        { x: 1, y: 2, z: 3 },
        100,
      ),
    }]);

    const saveFile = buildRuntimeSaveFile({
      description: 'source height die rewrite',
      mapPath: 'Maps/RuntimeTank/RuntimeTank.map',
      mapData: {
        width: 1,
        height: 1,
        tiles: [0],
        objects: [],
        waypoints: [],
        namedAreas: [],
        namedPolygons: [],
        namedWaypointPaths: [],
        startPositions: [],
        meta: {
          name: 'RuntimeTank',
          players: 1,
          supplyDockCount: 0,
          oilDerrickCount: 0,
          techBuildingCount: 0,
        },
        blendTileCount: 0,
      },
      cameraState: null,
      passthroughBlocks: [{
        blockName: 'CHUNK_GameLogic',
        blockData: sourceGameLogicBytes.slice().buffer,
      }],
      gameLogic: {
        captureSourceTerrainLogicRuntimeSaveState: () => ({
          version: 2,
          activeBoundary: 0,
          waterUpdates: [],
        }),
        captureSourcePartitionRuntimeSaveState: createEmptyPartitionState,
        captureSourcePlayerRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceRadarRuntimeSaveState: createEmptyRadarState,
        captureSourceSidesListRuntimeSaveState: () => createEmptySidesListState(),
        captureSourceTeamFactoryRuntimeSaveState: () => createEmptyTeamFactoryState(),
        captureSourceScriptEngineRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceInGameUiRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceGameLogicRuntimeSaveState: () => ({
          version: 10,
          nextId: 8,
          nextProjectileVisualId: 1,
          animationTime: 0,
          selectedEntityId: null,
          selectedEntityIds: [],
          scriptSelectionChangedFrame: 0,
          frameCounter: 42,
          controlBarDirtyFrame: 0,
          scriptObjectTopologyVersion: 0,
          scriptObjectCountChangedFrame: 0,
          defeatedSides: new Set<string>(),
          gameEndFrame: null,
          scriptEndGameTimerActive: false,
          objectTriggerAreaStates: [],
          spawnedEntities: [{
            id: 7,
            templateName: 'RuntimeTank',
            x: 10,
            y: 25,
            z: 20,
            rotationY: 1.25,
            heightDieProfile: {
              targetHeight: 30,
              targetHeightIncludesStructures: false,
              onlyWhenMovingDown: false,
              destroyAttachedParticlesAtHeight: -1,
              snapToGroundOnDeath: false,
              initialDelayFrames: 15,
            },
            heightDieActiveFrame: 200,
            heightDieHasDied: false,
            heightDieLastPositionX: 10,
            heightDieLastPositionZ: 20,
            heightDieLastY: 26,
            heightDieParticlesDestroyed: false,
            destroyed: false,
          } as unknown as import('@generals/game-logic').MapEntity],
        }),
        resolveSourceObjectModuleTypeByTag: (templateName, moduleTag) =>
          templateName === 'RuntimeTank' && moduleTag === 'ModuleTag_HeightDie'
            ? 'HEIGHTDIEUPDATE'
            : null,
        captureBrowserRuntimeSaveState: () => ({ version: 1 }),
        getObjectIdCounter: () => 8,
      },
    });

    const firstObject = readFirstSourceGameLogicObjectState(saveFile.data);
    const heightDieModule = firstObject?.modules.find((module) => module.identifier === 'ModuleTag_HeightDie');

    expect(heightDieModule).toBeDefined();
    expect(parseSourceHeightDieUpdateBlockData(heightDieModule!.blockData)).toEqual({
      version: 2,
      nextCallFrameAndPhase: (43 << 2) | 2,
      hasDied: false,
      particlesDestroyed: false,
      lastPosition: { x: 10, y: 20, z: 26 },
      earliestDeathFrame: 200,
    });
  });

  it('rewrites source StickyBombUpdate modules from live runtime state', () => {
    const sourceGameLogicBytes = createSourceGameLogicChunkData(false, [{
      identifier: 'ModuleTag_StickyBomb',
      blockData: createSourceStickyBombUpdateBlockData((84 << 2) | 2, 11, 90, 75),
    }]);

    const saveFile = buildRuntimeSaveFile({
      description: 'source sticky bomb rewrite',
      mapPath: 'Maps/RuntimeTank/RuntimeTank.map',
      mapData: {
        width: 1,
        height: 1,
        tiles: [0],
        objects: [],
        waypoints: [],
        namedAreas: [],
        namedPolygons: [],
        namedWaypointPaths: [],
        startPositions: [],
        meta: {
          name: 'RuntimeTank',
          players: 1,
          supplyDockCount: 0,
          oilDerrickCount: 0,
          techBuildingCount: 0,
        },
        blendTileCount: 0,
      },
      cameraState: null,
      passthroughBlocks: [{
        blockName: 'CHUNK_GameLogic',
        blockData: sourceGameLogicBytes.slice().buffer,
      }],
      gameLogic: {
        captureSourceTerrainLogicRuntimeSaveState: () => ({
          version: 2,
          activeBoundary: 0,
          waterUpdates: [],
        }),
        captureSourcePartitionRuntimeSaveState: createEmptyPartitionState,
        captureSourcePlayerRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceRadarRuntimeSaveState: createEmptyRadarState,
        captureSourceSidesListRuntimeSaveState: () => createEmptySidesListState(),
        captureSourceTeamFactoryRuntimeSaveState: () => createEmptyTeamFactoryState(),
        captureSourceScriptEngineRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceInGameUiRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceGameLogicRuntimeSaveState: () => ({
          version: 10,
          nextId: 8,
          nextProjectileVisualId: 1,
          animationTime: 0,
          selectedEntityId: null,
          selectedEntityIds: [],
          scriptSelectionChangedFrame: 0,
          frameCounter: 42,
          controlBarDirtyFrame: 0,
          scriptObjectTopologyVersion: 0,
          scriptObjectCountChangedFrame: 0,
          defeatedSides: new Set<string>(),
          gameEndFrame: null,
          scriptEndGameTimerActive: false,
          objectTriggerAreaStates: [],
          spawnedEntities: [{
            id: 7,
            templateName: 'RuntimeTank',
            x: 10,
            y: 0,
            z: 20,
            rotationY: 1.25,
            stickyBombProfile: {
              offsetZ: 5,
              detonationWeaponName: 'Demo_StickyBombDetonationWeapon',
            },
            stickyBombTargetId: 77,
            stickyBombDieFrame: 90,
            stickyBombNextPingFrame: 75,
          } as unknown as import('@generals/game-logic').MapEntity],
        }),
        resolveSourceObjectModuleTypeByTag: (templateName, moduleTag) =>
          templateName === 'RuntimeTank' && moduleTag === 'ModuleTag_StickyBomb'
            ? 'STICKYBOMBUPDATE'
            : null,
        captureBrowserRuntimeSaveState: () => ({ version: 1 }),
        getObjectIdCounter: () => 8,
      },
    });

    const firstObject = readFirstSourceGameLogicObjectState(saveFile.data);
    const stickyBombModule = firstObject?.modules.find((module) => module.identifier === 'ModuleTag_StickyBomb');

    expect(stickyBombModule).toBeDefined();
    expect(parseSourceStickyBombUpdateBlockData(stickyBombModule!.blockData)).toEqual({
      nextCallFrameAndPhase: (43 << 2) | 2,
      targetId: 77,
      dieFrame: 90,
      nextPingFrame: 75,
    });
  });

  it('rewrites source CleanupHazardUpdate modules from live runtime state', () => {
    const sourceGameLogicBytes = createSourceGameLogicChunkData(false, [{
      identifier: 'ModuleTag_Cleanup',
      blockData: createSourceCleanupHazardUpdateBlockData(
        (84 << 2) | 2,
        11,
        false,
        5,
        6,
        { x: 1, y: 2, z: 3 },
        250,
      ),
    }]);

    const saveFile = buildRuntimeSaveFile({
      description: 'source cleanup hazard rewrite',
      mapPath: 'Maps/RuntimeTank/RuntimeTank.map',
      mapData: {
        width: 1,
        height: 1,
        tiles: [0],
        objects: [],
        waypoints: [],
        namedAreas: [],
        namedPolygons: [],
        namedWaypointPaths: [],
        startPositions: [],
        meta: {
          name: 'RuntimeTank',
          players: 1,
          supplyDockCount: 0,
          oilDerrickCount: 0,
          techBuildingCount: 0,
        },
        blendTileCount: 0,
      },
      cameraState: null,
      passthroughBlocks: [{
        blockName: 'CHUNK_GameLogic',
        blockData: sourceGameLogicBytes.slice().buffer,
      }],
      gameLogic: {
        captureSourceTerrainLogicRuntimeSaveState: () => ({
          version: 2,
          activeBoundary: 0,
          waterUpdates: [],
        }),
        captureSourcePartitionRuntimeSaveState: createEmptyPartitionState,
        captureSourcePlayerRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceRadarRuntimeSaveState: createEmptyRadarState,
        captureSourceSidesListRuntimeSaveState: () => createEmptySidesListState(),
        captureSourceTeamFactoryRuntimeSaveState: () => createEmptyTeamFactoryState(),
        captureSourceScriptEngineRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceInGameUiRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceGameLogicRuntimeSaveState: () => ({
          version: 10,
          nextId: 8,
          nextProjectileVisualId: 1,
          animationTime: 0,
          selectedEntityId: null,
          selectedEntityIds: [],
          scriptSelectionChangedFrame: 0,
          frameCounter: 42,
          controlBarDirtyFrame: 0,
          scriptObjectTopologyVersion: 0,
          scriptObjectCountChangedFrame: 0,
          defeatedSides: new Set<string>(),
          gameEndFrame: null,
          scriptEndGameTimerActive: false,
          objectTriggerAreaStates: [],
          spawnedEntities: [{
            id: 7,
            templateName: 'RuntimeTank',
            x: 10,
            y: 0,
            z: 20,
            rotationY: 1.25,
            cleanupHazardProfile: {
              weaponSlot: 'PRIMARY',
              scanFrames: 20,
              scanRange: 300,
            },
            cleanupHazardState: {
              bestTargetId: 77,
              nextScanFrame: 9,
              inRange: true,
              nextShotAvailableFrame: 123,
              cleanupAreaPosition: { x: 4, y: 5, z: 6 },
              cleanupAreaMoveRange: 125,
            },
          } as unknown as import('@generals/game-logic').MapEntity],
        }),
        resolveSourceObjectModuleTypeByTag: (templateName, moduleTag) =>
          templateName === 'RuntimeTank' && moduleTag === 'ModuleTag_Cleanup'
            ? 'CLEANUPHAZARDUPDATE'
            : null,
        captureBrowserRuntimeSaveState: () => ({ version: 1 }),
        getObjectIdCounter: () => 8,
      },
    });

    const firstObject = readFirstSourceGameLogicObjectState(saveFile.data);
    const cleanupModule = firstObject?.modules.find((module) => module.identifier === 'ModuleTag_Cleanup');

    expect(cleanupModule).toBeDefined();
    expect(parseSourceCleanupHazardUpdateBlockData(cleanupModule!.blockData)).toEqual({
      nextCallFrameAndPhase: (43 << 2) | 2,
      bestTargetId: 77,
      inRange: true,
      nextScanFrames: 9,
      nextShotAvailableInFrames: 81,
      position: { x: 4, y: 5, z: 6 },
      moveRange: 125,
    });
  });

  it('rewrites source DemoTrapUpdate modules from live runtime state', () => {
    const sourceGameLogicBytes = createSourceGameLogicChunkData(false, [{
      identifier: 'ModuleTag_DemoTrap',
      blockData: createSourceDemoTrapUpdateBlockData((84 << 2) | 2, 5, false),
    }]);

    const saveFile = buildRuntimeSaveFile({
      description: 'source demo trap rewrite',
      mapPath: 'Maps/RuntimeTank/RuntimeTank.map',
      mapData: {
        width: 1,
        height: 1,
        tiles: [0],
        objects: [],
        waypoints: [],
        namedAreas: [],
        namedPolygons: [],
        namedWaypointPaths: [],
        startPositions: [],
        meta: {
          name: 'RuntimeTank',
          players: 1,
          supplyDockCount: 0,
          oilDerrickCount: 0,
          techBuildingCount: 0,
        },
        blendTileCount: 0,
      },
      cameraState: null,
      passthroughBlocks: [{
        blockName: 'CHUNK_GameLogic',
        blockData: sourceGameLogicBytes.slice().buffer,
      }],
      gameLogic: {
        captureSourceTerrainLogicRuntimeSaveState: () => ({
          version: 2,
          activeBoundary: 0,
          waterUpdates: [],
        }),
        captureSourcePartitionRuntimeSaveState: createEmptyPartitionState,
        captureSourcePlayerRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceRadarRuntimeSaveState: createEmptyRadarState,
        captureSourceSidesListRuntimeSaveState: () => createEmptySidesListState(),
        captureSourceTeamFactoryRuntimeSaveState: () => createEmptyTeamFactoryState(),
        captureSourceScriptEngineRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceInGameUiRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceGameLogicRuntimeSaveState: () => ({
          version: 10,
          nextId: 8,
          nextProjectileVisualId: 1,
          animationTime: 0,
          selectedEntityId: null,
          selectedEntityIds: [],
          scriptSelectionChangedFrame: 0,
          frameCounter: 42,
          controlBarDirtyFrame: 0,
          scriptObjectTopologyVersion: 0,
          scriptObjectCountChangedFrame: 0,
          defeatedSides: new Set<string>(),
          gameEndFrame: null,
          scriptEndGameTimerActive: false,
          objectTriggerAreaStates: [],
          spawnedEntities: [{
            id: 7,
            templateName: 'RuntimeTank',
            x: 10,
            y: 0,
            z: 20,
            rotationY: 1.25,
            demoTrapProfile: {
              scanFrames: 20,
            },
            demoTrapNextScanFrame: 91,
            demoTrapDetonated: true,
          } as unknown as import('@generals/game-logic').MapEntity],
        }),
        resolveSourceObjectModuleTypeByTag: (templateName, moduleTag) =>
          templateName === 'RuntimeTank' && moduleTag === 'ModuleTag_DemoTrap'
            ? 'DEMOTRAPUPDATE'
            : null,
        captureBrowserRuntimeSaveState: () => ({ version: 1 }),
        getObjectIdCounter: () => 8,
      },
    });

    const firstObject = readFirstSourceGameLogicObjectState(saveFile.data);
    const demoTrapModule = firstObject?.modules.find((module) => module.identifier === 'ModuleTag_DemoTrap');

    expect(demoTrapModule).toBeDefined();
    expect(parseSourceDemoTrapUpdateBlockData(demoTrapModule!.blockData)).toEqual({
      nextCallFrameAndPhase: (43 << 2) | 2,
      nextScanFrames: 49,
      detonated: true,
    });
  });

  it('rewrites source CommandButtonHuntUpdate modules from live runtime state', () => {
    const sourceGameLogicBytes = createSourceGameLogicChunkData(false, [{
      identifier: 'ModuleTag_Hunt',
      blockData: createSourceCommandButtonHuntUpdateBlockData((84 << 2) | 2, 'OLD_BUTTON'),
    }]);

    const saveFile = buildRuntimeSaveFile({
      description: 'source command button hunt rewrite',
      mapPath: 'Maps/RuntimeTank/RuntimeTank.map',
      mapData: {
        width: 1,
        height: 1,
        tiles: [0],
        objects: [],
        waypoints: [],
        namedAreas: [],
        namedPolygons: [],
        namedWaypointPaths: [],
        startPositions: [],
        meta: {
          name: 'RuntimeTank',
          players: 1,
          supplyDockCount: 0,
          oilDerrickCount: 0,
          techBuildingCount: 0,
        },
        blendTileCount: 0,
      },
      cameraState: null,
      passthroughBlocks: [{
        blockName: 'CHUNK_GameLogic',
        blockData: sourceGameLogicBytes.slice().buffer,
      }],
      gameLogic: {
        captureSourceTerrainLogicRuntimeSaveState: () => ({
          version: 2,
          activeBoundary: 0,
          waterUpdates: [],
        }),
        captureSourcePartitionRuntimeSaveState: createEmptyPartitionState,
        captureSourcePlayerRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceRadarRuntimeSaveState: createEmptyRadarState,
        captureSourceSidesListRuntimeSaveState: () => createEmptySidesListState(),
        captureSourceTeamFactoryRuntimeSaveState: () => createEmptyTeamFactoryState(),
        captureSourceScriptEngineRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceInGameUiRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceGameLogicRuntimeSaveState: () => ({
          version: 10,
          nextId: 8,
          nextProjectileVisualId: 1,
          animationTime: 0,
          selectedEntityId: null,
          selectedEntityIds: [],
          scriptSelectionChangedFrame: 0,
          frameCounter: 42,
          controlBarDirtyFrame: 0,
          scriptObjectTopologyVersion: 0,
          scriptObjectCountChangedFrame: 0,
          defeatedSides: new Set<string>(),
          gameEndFrame: null,
          scriptEndGameTimerActive: false,
          objectTriggerAreaStates: [],
          spawnedEntities: [{
            id: 7,
            templateName: 'RuntimeTank',
            x: 10,
            y: 0,
            z: 20,
            rotationY: 1.25,
            commandButtonHuntProfile: {
              scanFrames: 20,
              scanRange: 300,
            },
            commandButtonHuntMode: 'SPECIAL_POWER',
            commandButtonHuntButtonName: 'SPECIALABILITY_PARTICLE_CANNON',
            commandButtonHuntNextScanFrame: 91,
          } as unknown as import('@generals/game-logic').MapEntity],
        }),
        resolveSourceObjectModuleTypeByTag: (templateName, moduleTag) =>
          templateName === 'RuntimeTank' && moduleTag === 'ModuleTag_Hunt'
            ? 'COMMANDBUTTONHUNTUPDATE'
            : null,
        captureBrowserRuntimeSaveState: () => ({ version: 1 }),
        getObjectIdCounter: () => 8,
      },
    });

    const firstObject = readFirstSourceGameLogicObjectState(saveFile.data);
    const huntModule = firstObject?.modules.find((module) => module.identifier === 'ModuleTag_Hunt');

    expect(huntModule).toBeDefined();
    expect(parseSourceCommandButtonHuntUpdateBlockData(huntModule!.blockData)).toEqual({
      nextCallFrameAndPhase: (91 << 2) | 2,
      commandButtonName: 'SPECIALABILITY_PARTICLE_CANNON',
    });
  });

  it('rewrites source AutoDepositUpdate modules from live runtime state', () => {
    const sourceGameLogicBytes = createSourceGameLogicChunkData(false, [{
      identifier: 'ModuleTag_AutoDeposit',
      blockData: createSourceAutoDepositUpdateBlockData((84 << 2) | 2, 75, false, false),
    }]);

    const saveFile = buildRuntimeSaveFile({
      description: 'source auto deposit rewrite',
      mapPath: 'Maps/RuntimeTank/RuntimeTank.map',
      mapData: {
        width: 1,
        height: 1,
        tiles: [0],
        objects: [],
        waypoints: [],
        namedAreas: [],
        namedPolygons: [],
        namedWaypointPaths: [],
        startPositions: [],
        meta: {
          name: 'RuntimeTank',
          players: 1,
          supplyDockCount: 0,
          oilDerrickCount: 0,
          techBuildingCount: 0,
        },
        blendTileCount: 0,
      },
      cameraState: null,
      passthroughBlocks: [{
        blockName: 'CHUNK_GameLogic',
        blockData: sourceGameLogicBytes.slice().buffer,
      }],
      gameLogic: {
        captureSourceTerrainLogicRuntimeSaveState: () => ({
          version: 2,
          activeBoundary: 0,
          waterUpdates: [],
        }),
        captureSourcePartitionRuntimeSaveState: createEmptyPartitionState,
        captureSourcePlayerRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceRadarRuntimeSaveState: createEmptyRadarState,
        captureSourceSidesListRuntimeSaveState: () => createEmptySidesListState(),
        captureSourceTeamFactoryRuntimeSaveState: () => createEmptyTeamFactoryState(),
        captureSourceScriptEngineRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceInGameUiRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceGameLogicRuntimeSaveState: () => ({
          version: 10,
          nextId: 8,
          nextProjectileVisualId: 1,
          animationTime: 0,
          selectedEntityId: null,
          selectedEntityIds: [],
          scriptSelectionChangedFrame: 0,
          frameCounter: 42,
          controlBarDirtyFrame: 0,
          scriptObjectTopologyVersion: 0,
          scriptObjectCountChangedFrame: 0,
          defeatedSides: new Set<string>(),
          gameEndFrame: null,
          scriptEndGameTimerActive: false,
          objectTriggerAreaStates: [],
          spawnedEntities: [{
            id: 7,
            templateName: 'RuntimeTank',
            x: 10,
            y: 0,
            z: 20,
            rotationY: 1.25,
            autoDepositProfile: {
              depositFrames: 30,
              depositAmount: 20,
              initialCaptureBonus: 100,
            },
            autoDepositNextFrame: 123,
            autoDepositCaptureBonusPending: true,
            autoDepositInitialized: true,
          } as unknown as import('@generals/game-logic').MapEntity],
        }),
        resolveSourceObjectModuleTypeByTag: (templateName, moduleTag) =>
          templateName === 'RuntimeTank' && moduleTag === 'ModuleTag_AutoDeposit'
            ? 'AUTODEPOSITUPDATE'
            : null,
        captureBrowserRuntimeSaveState: () => ({ version: 1 }),
        getObjectIdCounter: () => 8,
      },
    });

    const firstObject = readFirstSourceGameLogicObjectState(saveFile.data);
    const autoDepositModule = firstObject?.modules.find((module) => module.identifier === 'ModuleTag_AutoDeposit');

    expect(autoDepositModule).toBeDefined();
    expect(parseSourceAutoDepositUpdateBlockData(autoDepositModule!.blockData)).toEqual({
      version: 2,
      nextCallFrameAndPhase: (43 << 2) | 2,
      depositOnFrame: 123,
      awardInitialCaptureBonus: true,
      initialized: true,
    });
  });

  it('rewrites source DynamicShroudClearingRangeUpdate modules from live runtime state', () => {
    const sourceGameLogicBytes = createSourceGameLogicChunkData(false, [{
      identifier: 'ModuleTag_DynamicShroud',
      blockData: createSourceDynamicShroudClearingRangeUpdateBlockData(
        (84 << 2) | 2,
        10,
        20,
        15,
        12,
        9,
        200,
        4,
        true,
        1.25,
        300,
        25,
      ),
    }]);

    const saveFile = buildRuntimeSaveFile({
      description: 'source dynamic shroud rewrite',
      mapPath: 'Maps/RuntimeTank/RuntimeTank.map',
      mapData: {
        width: 1,
        height: 1,
        tiles: [0],
        objects: [],
        waypoints: [],
        namedAreas: [],
        namedPolygons: [],
        namedWaypointPaths: [],
        startPositions: [],
        meta: {
          name: 'RuntimeTank',
          players: 1,
          supplyDockCount: 0,
          oilDerrickCount: 0,
          techBuildingCount: 0,
        },
        blendTileCount: 0,
      },
      cameraState: null,
      passthroughBlocks: [{
        blockName: 'CHUNK_GameLogic',
        blockData: sourceGameLogicBytes.slice().buffer,
      }],
      gameLogic: {
        captureSourceTerrainLogicRuntimeSaveState: () => ({
          version: 2,
          activeBoundary: 0,
          waterUpdates: [],
        }),
        captureSourcePartitionRuntimeSaveState: createEmptyPartitionState,
        captureSourcePlayerRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceRadarRuntimeSaveState: createEmptyRadarState,
        captureSourceSidesListRuntimeSaveState: () => createEmptySidesListState(),
        captureSourceTeamFactoryRuntimeSaveState: () => createEmptyTeamFactoryState(),
        captureSourceScriptEngineRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceInGameUiRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceGameLogicRuntimeSaveState: () => ({
          version: 10,
          nextId: 8,
          nextProjectileVisualId: 1,
          animationTime: 0,
          selectedEntityId: null,
          selectedEntityIds: [],
          scriptSelectionChangedFrame: 0,
          frameCounter: 42,
          controlBarDirtyFrame: 0,
          scriptObjectTopologyVersion: 0,
          scriptObjectCountChangedFrame: 0,
          defeatedSides: new Set<string>(),
          gameEndFrame: null,
          scriptEndGameTimerActive: false,
          objectTriggerAreaStates: [],
          spawnedEntities: [{
            id: 7,
            templateName: 'RuntimeTank',
            x: 10,
            y: 0,
            z: 20,
            rotationY: 1.25,
            dynamicShroudProfile: {
              changeInterval: 2,
              growInterval: 1,
              shrinkDelay: 30,
              shrinkTime: 40,
              growDelay: 50,
              growTime: 60,
              finalVision: 20,
            },
            dynamicShroudState: 'GROWING',
            dynamicShroudStateCountdown: 77,
            dynamicShroudTotalFrames: 88,
            dynamicShroudGrowStartDeadline: 70,
            dynamicShroudSustainDeadline: 55,
            dynamicShroudShrinkStartDeadline: 33,
            dynamicShroudDoneForeverFrame: 456,
            dynamicShroudChangeIntervalCountdown: 6,
            dynamicShroudDecalsCreated: false,
            dynamicShroudVisionChangePerInterval: 0,
            dynamicShroudNativeClearingRange: 400,
            dynamicShroudCurrentClearingRange: 125,
          } as unknown as import('@generals/game-logic').MapEntity],
        }),
        resolveSourceObjectModuleTypeByTag: (templateName, moduleTag) =>
          templateName === 'RuntimeTank' && moduleTag === 'ModuleTag_DynamicShroud'
            ? 'DYNAMICSHROUDCLEARINGRANGEUPDATE'
            : null,
        captureBrowserRuntimeSaveState: () => ({ version: 1 }),
        getObjectIdCounter: () => 8,
      },
    });

    const firstObject = readFirstSourceGameLogicObjectState(saveFile.data);
    const dynamicShroudModule = firstObject?.modules.find(
      (module) => module.identifier === 'ModuleTag_DynamicShroud',
    );

    expect(dynamicShroudModule).toBeDefined();
    expect(parseSourceDynamicShroudClearingRangeUpdateBlockData(dynamicShroudModule!.blockData)).toEqual({
      nextCallFrameAndPhase: (43 << 2) | 2,
      stateCountDown: 77,
      totalFrames: 88,
      growStartDeadline: 70,
      sustainDeadline: 55,
      shrinkStartDeadline: 33,
      doneForeverFrame: 456,
      changeIntervalCountdown: 6,
      decalsCreated: false,
      visionChangePerInterval: 0,
      nativeClearingRange: 400,
      currentClearingRange: 125,
    });
  });

  it('rewrites source StealthUpdate modules from live runtime state', () => {
    const sourceGameLogicBytes = createSourceGameLogicChunkData(false, [{
      identifier: 'ModuleTag_Stealth',
      blockData: createSourceStealthUpdateBlockData(
        (84 << 2) | 2,
        140,
        155,
        false,
        0.125,
        1.75,
        3,
        'OldDisguise',
        12,
        true,
        true,
        true,
        8,
      ),
    }]);

    const saveFile = buildRuntimeSaveFile({
      description: 'source stealth update rewrite',
      mapPath: 'Maps/RuntimeTank/RuntimeTank.map',
      mapData: {
        width: 1,
        height: 1,
        tiles: [0],
        objects: [],
        waypoints: [],
        namedAreas: [],
        namedPolygons: [],
        namedWaypointPaths: [],
        startPositions: [],
        meta: {
          name: 'RuntimeTank',
          players: 1,
          supplyDockCount: 0,
          oilDerrickCount: 0,
          techBuildingCount: 0,
        },
        blendTileCount: 0,
      },
      cameraState: null,
      passthroughBlocks: [{
        blockName: 'CHUNK_GameLogic',
        blockData: sourceGameLogicBytes.slice().buffer,
      }],
      gameLogic: {
        captureSourceTerrainLogicRuntimeSaveState: () => ({
          version: 2,
          activeBoundary: 0,
          waterUpdates: [],
        }),
        captureSourcePartitionRuntimeSaveState: createEmptyPartitionState,
        captureSourcePlayerRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceRadarRuntimeSaveState: createEmptyRadarState,
        captureSourceSidesListRuntimeSaveState: () => createEmptySidesListState(),
        captureSourceTeamFactoryRuntimeSaveState: () => createEmptyTeamFactoryState(),
        captureSourceScriptEngineRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceInGameUiRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceGameLogicRuntimeSaveState: () => ({
          version: 10,
          nextId: 8,
          nextProjectileVisualId: 1,
          animationTime: 0,
          selectedEntityId: null,
          selectedEntityIds: [],
          scriptSelectionChangedFrame: 0,
          frameCounter: 42,
          controlBarDirtyFrame: 0,
          scriptObjectTopologyVersion: 0,
          scriptObjectCountChangedFrame: 0,
          defeatedSides: new Set<string>(),
          gameEndFrame: null,
          scriptEndGameTimerActive: false,
          objectTriggerAreaStates: [],
          spawnedEntities: [{
            id: 7,
            templateName: 'RuntimeTank',
            x: 10,
            y: 0,
            z: 20,
            rotationY: 1.25,
            stealthProfile: {
              stealthDelayFrames: 9,
              innateStealth: true,
              forbiddenConditions: 0,
              moveThresholdSpeed: 0,
              revealDistanceFromTarget: 0,
              orderIdleEnemiesToAttackMeUponReveal: false,
              friendlyOpacityMin: 0.5,
              hintDetectableConditions: [],
              disguisesAsTeam: true,
              forbiddenStatus: [],
              requiredStatus: [],
              friendlyOpacityMax: 1,
              pulseFrequencyFrames: 30,
              disguiseFX: '',
              disguiseRevealFX: '',
              disguiseTransitionFrames: 12,
              disguiseRevealTransitionFrames: 12,
              useRiderStealth: false,
              enemyDetectionEvaEvent: '',
              ownDetectionEvaEvent: '',
              blackMarketCheckDelayFrames: 0,
              grantedBySpecialPower: false,
            },
            stealthEnabled: true,
            stealthDelayRemaining: 9,
            stealthPulsePhaseRate: 0.2,
            stealthPulsePhase: 2.25,
            temporaryStealthGrant: true,
            temporaryStealthExpireFrame: 57,
            stealthDisguisePlayerIndex: 2,
            stealthDisguiseTransitionFrames: 6,
            stealthDisguiseHalfpointReached: false,
            stealthTransitioningToDisguise: true,
            disguiseTemplateName: 'EnemyTank',
            detectedUntilFrame: 91,
            objectStatusFlags: new Set(['CAN_STEALTH', 'STEALTHED', 'DISGUISED']),
          } as unknown as import('@generals/game-logic').MapEntity],
        }),
        resolveSourceObjectModuleTypeByTag: (templateName, moduleTag) =>
          templateName === 'RuntimeTank' && moduleTag === 'ModuleTag_Stealth'
            ? 'STEALTHUPDATE'
            : null,
        captureBrowserRuntimeSaveState: () => ({ version: 1 }),
        getObjectIdCounter: () => 8,
      },
    });

    const firstObject = readFirstSourceGameLogicObjectState(saveFile.data);
    const stealthModule = firstObject?.modules.find((module) => module.identifier === 'ModuleTag_Stealth');

    expect(stealthModule).toBeDefined();
    const parsed = parseSourceStealthUpdateBlockData(stealthModule!.blockData);
    expect(parsed).toEqual({
      nextCallFrameAndPhase: (43 << 2) | 2,
      stealthAllowedFrame: 42,
      detectionExpiresFrame: 91,
      enabled: true,
      pulsePhaseRate: parsed!.pulsePhaseRate,
      pulsePhase: 2.25,
      disguiseAsPlayerIndex: 2,
      disguiseTemplateName: 'EnemyTank',
      disguiseTransitionFrames: 6,
      disguiseHalfpointReached: false,
      transitioningToDisguise: true,
      disguised: true,
      framesGranted: 15,
    });
    expect(parsed?.pulsePhaseRate).toBeCloseTo(0.2, 6);
  });

  it('rewrites source StealthDetectorUpdate modules from live runtime state', () => {
    const sourceGameLogicBytes = createSourceGameLogicChunkData(false, [{
      identifier: 'ModuleTag_Detector',
      blockData: createSourceStealthDetectorUpdateBlockData((84 << 2) | 2, false),
    }]);

    const saveFile = buildRuntimeSaveFile({
      description: 'source stealth detector rewrite',
      mapPath: 'Maps/RuntimeTank/RuntimeTank.map',
      mapData: {
        width: 1,
        height: 1,
        tiles: [0],
        objects: [],
        waypoints: [],
        namedAreas: [],
        namedPolygons: [],
        namedWaypointPaths: [],
        startPositions: [],
        meta: {
          name: 'RuntimeTank',
          players: 1,
          supplyDockCount: 0,
          oilDerrickCount: 0,
          techBuildingCount: 0,
        },
        blendTileCount: 0,
      },
      cameraState: null,
      passthroughBlocks: [{
        blockName: 'CHUNK_GameLogic',
        blockData: sourceGameLogicBytes.slice().buffer,
      }],
      gameLogic: {
        captureSourceTerrainLogicRuntimeSaveState: () => ({
          version: 2,
          activeBoundary: 0,
          waterUpdates: [],
        }),
        captureSourcePartitionRuntimeSaveState: createEmptyPartitionState,
        captureSourcePlayerRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceRadarRuntimeSaveState: createEmptyRadarState,
        captureSourceSidesListRuntimeSaveState: () => createEmptySidesListState(),
        captureSourceTeamFactoryRuntimeSaveState: () => createEmptyTeamFactoryState(),
        captureSourceScriptEngineRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceInGameUiRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceGameLogicRuntimeSaveState: () => ({
          version: 10,
          nextId: 8,
          nextProjectileVisualId: 1,
          animationTime: 0,
          selectedEntityId: null,
          selectedEntityIds: [],
          scriptSelectionChangedFrame: 0,
          frameCounter: 42,
          controlBarDirtyFrame: 0,
          scriptObjectTopologyVersion: 0,
          scriptObjectCountChangedFrame: 0,
          defeatedSides: new Set<string>(),
          gameEndFrame: null,
          scriptEndGameTimerActive: false,
          objectTriggerAreaStates: [],
          spawnedEntities: [{
            id: 7,
            templateName: 'RuntimeTank',
            x: 10,
            y: 0,
            z: 20,
            rotationY: 1.25,
            detectorProfile: {
              detectionRange: 300,
              detectionRate: 20,
              initiallyDisabled: true,
              canDetectWhileGarrisoned: false,
              canDetectWhileContained: false,
              extraRequiredKindOf: new Set<string>(),
              extraForbiddenKindOf: new Set<string>(),
            },
            detectorEnabled: true,
            detectorNextScanFrame: 91,
          } as unknown as import('@generals/game-logic').MapEntity],
        }),
        resolveSourceObjectModuleTypeByTag: (templateName, moduleTag) =>
          templateName === 'RuntimeTank' && moduleTag === 'ModuleTag_Detector'
            ? 'STEALTHDETECTORUPDATE'
            : null,
        captureBrowserRuntimeSaveState: () => ({ version: 1 }),
        getObjectIdCounter: () => 8,
      },
    });

    const firstObject = readFirstSourceGameLogicObjectState(saveFile.data);
    const detectorModule = firstObject?.modules.find((module) => module.identifier === 'ModuleTag_Detector');

    expect(detectorModule).toBeDefined();
    expect(parseSourceStealthDetectorUpdateBlockData(detectorModule!.blockData)).toEqual({
      nextCallFrameAndPhase: (91 << 2) | 2,
      enabled: true,
    });
  });

  it('rewrites source PhysicsBehavior modules from live runtime state', () => {
    const sourceGameLogicBytes = createSourceGameLogicChunkData(false, [{
      identifier: 'ModuleTag_Physics',
      blockData: createSourcePhysicsBehaviorBlockData({
        nextCallFrameAndPhase: (84 << 2) | 2,
        yawRate: 0.91,
        rollRate: 0.82,
        pitchRate: 0.73,
        accel: { x: 9, y: 8, z: 7 },
        prevAccel: { x: 6, y: 5, z: 4 },
        vel: { x: 3, y: 2, z: 1 },
        turning: -1,
        ignoreCollisionsWith: 123,
        flags: SOURCE_PHYSICS_FLAG_APPLY_FRICTION2D_WHEN_AIRBORNE
          | SOURCE_PHYSICS_FLAG_IMMUNE_TO_FALLING_DAMAGE
          | SOURCE_PHYSICS_FLAG_STICK_TO_GROUND
          | SOURCE_PHYSICS_FLAG_ALLOW_COLLIDE_FORCE
          | SOURCE_PHYSICS_FLAG_IS_IN_UPDATE,
        mass: 5,
        currentOverlap: 456,
        previousOverlap: 789,
        motiveForceExpires: 1024,
        extraBounciness: 0.11,
        extraFriction: 0.22,
        velMag: 2.5,
      }),
    }]);

    const saveFile = buildRuntimeSaveFile({
      description: 'source physics behavior rewrite',
      mapPath: 'Maps/RuntimeTank/RuntimeTank.map',
      mapData: {
        width: 1,
        height: 1,
        tiles: [0],
        objects: [],
        waypoints: [],
        namedAreas: [],
        namedPolygons: [],
        namedWaypointPaths: [],
        startPositions: [],
        meta: {
          name: 'RuntimeTank',
          players: 1,
          supplyDockCount: 0,
          oilDerrickCount: 0,
          techBuildingCount: 0,
        },
        blendTileCount: 0,
      },
      cameraState: null,
      passthroughBlocks: [{
        blockName: 'CHUNK_GameLogic',
        blockData: sourceGameLogicBytes.slice().buffer,
      }],
      gameLogic: {
        captureSourceTerrainLogicRuntimeSaveState: () => ({
          version: 2,
          activeBoundary: 0,
          waterUpdates: [],
        }),
        captureSourcePartitionRuntimeSaveState: createEmptyPartitionState,
        captureSourcePlayerRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceRadarRuntimeSaveState: createEmptyRadarState,
        captureSourceSidesListRuntimeSaveState: () => createEmptySidesListState(),
        captureSourceTeamFactoryRuntimeSaveState: () => createEmptyTeamFactoryState(),
        captureSourceScriptEngineRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceInGameUiRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceGameLogicRuntimeSaveState: () => ({
          version: 10,
          nextId: 8,
          nextProjectileVisualId: 1,
          animationTime: 0,
          selectedEntityId: null,
          selectedEntityIds: [],
          scriptSelectionChangedFrame: 0,
          frameCounter: 42,
          controlBarDirtyFrame: 0,
          scriptObjectTopologyVersion: 0,
          scriptObjectCountChangedFrame: 0,
          defeatedSides: new Set<string>(),
          gameEndFrame: null,
          scriptEndGameTimerActive: false,
          objectTriggerAreaStates: [],
          spawnedEntities: [{
            id: 7,
            templateName: 'RuntimeTank',
            x: 10,
            y: 0,
            z: 20,
            rotationY: 1.25,
            physicsBehaviorProfile: {
              mass: 12.5,
              forwardFriction: 0.15,
              lateralFriction: 0.16,
              zFriction: 0.17,
              aerodynamicFriction: 0.18,
              centerOfMassOffset: 0,
              killWhenRestingOnGround: false,
              allowBouncing: true,
              allowCollideForce: false,
              pitchRollYawFactor: 1,
            },
            physicsBehaviorState: {
              velX: 1.5,
              velY: 2.5,
              velZ: -3.5,
              accelX: 0.125,
              accelY: 0.25,
              accelZ: -0.5,
              yawRate: 0.03125,
              pitchRate: 0,
              rollRate: -0.0625,
              wasAirborneLastFrame: true,
              stickToGround: false,
              allowToFall: true,
              isInFreeFall: true,
              extraBounciness: 0.75,
              extraFriction: -0.125,
              isStunned: true,
            },
          } as unknown as import('@generals/game-logic').MapEntity],
        }),
        resolveSourceObjectModuleTypeByTag: (templateName, moduleTag) =>
          templateName === 'RuntimeTank' && moduleTag === 'ModuleTag_Physics'
            ? 'PHYSICSBEHAVIOR'
            : null,
        captureBrowserRuntimeSaveState: () => ({ version: 1 }),
        getObjectIdCounter: () => 8,
      },
    });

    const firstObject = readFirstSourceGameLogicObjectState(saveFile.data);
    const physicsModule = firstObject?.modules.find((module) => module.identifier === 'ModuleTag_Physics');

    expect(physicsModule).toBeDefined();
    const parsed = parseSourcePhysicsBehaviorBlockData(physicsModule!.blockData);
    expect(parsed.nextCallFrameAndPhase).toBe((43 << 2) | 2);
    expect(parsed.yawRate).toBeCloseTo(0.03125, 6);
    expect(parsed.rollRate).toBeCloseTo(-0.0625, 6);
    expect(parsed.pitchRate).toBeCloseTo(0, 6);
    expect(parsed.accel).toEqual({ x: 0.125, y: -0.5, z: 0.25 });
    expect(parsed.prevAccel).toEqual({ x: 6, y: 5, z: 4 });
    expect(parsed.vel).toEqual({ x: 1.5, y: -3.5, z: 2.5 });
    expect(parsed.turning).toBe(-1);
    expect(parsed.ignoreCollisionsWith).toBe(123);
    expect(parsed.mass).toBeCloseTo(12.5, 6);
    expect(parsed.currentOverlap).toBe(456);
    expect(parsed.previousOverlap).toBe(789);
    expect(parsed.motiveForceExpires).toBe(1024);
    expect(parsed.extraBounciness).toBeCloseTo(0.75, 6);
    expect(parsed.extraFriction).toBeCloseTo(-0.125, 6);
    expect(parsed.velMag).toBe(SOURCE_PHYSICS_INVALID_VEL_MAG);
    expect(parsed.flags).toBe(
      SOURCE_PHYSICS_FLAG_APPLY_FRICTION2D_WHEN_AIRBORNE
      | SOURCE_PHYSICS_FLAG_IMMUNE_TO_FALLING_DAMAGE
      | SOURCE_PHYSICS_FLAG_UPDATE_EVER_RUN
      | SOURCE_PHYSICS_FLAG_ALLOW_BOUNCE
      | SOURCE_PHYSICS_FLAG_WAS_AIRBORNE_LAST_FRAME
      | SOURCE_PHYSICS_FLAG_ALLOW_TO_FALL
      | SOURCE_PHYSICS_FLAG_HAS_PITCH_ROLL_YAW
      | SOURCE_PHYSICS_FLAG_IS_IN_FREEFALL
      | SOURCE_PHYSICS_FLAG_IS_STUNNED
    );
    expect(parsed.flags & SOURCE_PHYSICS_FLAG_STICK_TO_GROUND).toBe(0);
    expect(parsed.flags & SOURCE_PHYSICS_FLAG_ALLOW_COLLIDE_FORCE).toBe(0);
    expect(parsed.flags & SOURCE_PHYSICS_FLAG_IS_IN_UPDATE).toBe(0);
  });

  it('rewrites source ProjectileStreamUpdate modules from live runtime state', () => {
    const sourceGameLogicBytes = createSourceGameLogicChunkData(false, [{
      identifier: 'ModuleTag_Stream',
      blockData: createSourceProjectileStreamUpdateBlockData({
        nextCallFrameAndPhase: (84 << 2) | 2,
        projectileIds: Array.from({ length: SOURCE_PROJECTILE_STREAM_MAX }, (_, index) => 90 + index),
        nextFreeIndex: 9,
        firstValidIndex: 4,
        owningObject: 12,
        targetObject: 44,
        targetPosition: { x: 101, y: 202, z: 303 },
      }),
    }]);

    const saveFile = buildRuntimeSaveFile({
      description: 'source projectile stream rewrite',
      mapPath: 'Maps/RuntimeTank/RuntimeTank.map',
      mapData: {
        width: 1,
        height: 1,
        tiles: [0],
        objects: [],
        waypoints: [],
        namedAreas: [],
        namedPolygons: [],
        namedWaypointPaths: [],
        startPositions: [],
        meta: {
          name: 'RuntimeTank',
          players: 1,
          supplyDockCount: 0,
          oilDerrickCount: 0,
          techBuildingCount: 0,
        },
        blendTileCount: 0,
      },
      cameraState: null,
      passthroughBlocks: [{
        blockName: 'CHUNK_GameLogic',
        blockData: sourceGameLogicBytes.slice().buffer,
      }],
      gameLogic: {
        captureSourceTerrainLogicRuntimeSaveState: () => ({
          version: 2,
          activeBoundary: 0,
          waterUpdates: [],
        }),
        captureSourcePartitionRuntimeSaveState: createEmptyPartitionState,
        captureSourcePlayerRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceRadarRuntimeSaveState: createEmptyRadarState,
        captureSourceSidesListRuntimeSaveState: () => createEmptySidesListState(),
        captureSourceTeamFactoryRuntimeSaveState: () => createEmptyTeamFactoryState(),
        captureSourceScriptEngineRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceInGameUiRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceGameLogicRuntimeSaveState: () => ({
          version: 10,
          nextId: 24,
          nextProjectileVisualId: 1,
          animationTime: 0,
          selectedEntityId: null,
          selectedEntityIds: [],
          scriptSelectionChangedFrame: 0,
          frameCounter: 42,
          controlBarDirtyFrame: 0,
          scriptObjectTopologyVersion: 0,
          scriptObjectCountChangedFrame: 0,
          defeatedSides: new Set<string>(),
          gameEndFrame: null,
          scriptEndGameTimerActive: false,
          objectTriggerAreaStates: [],
          spawnedEntities: [{
            id: 7,
            templateName: 'RuntimeTank',
            x: 10,
            y: 0,
            z: 20,
            rotationY: 1.25,
            projectileStreamProfile: { enabled: true },
            projectileStreamState: {
              projectileIds: Array.from({ length: 22 }, (_, index) => index + 2),
              nextIndex: 2,
              ownerEntityId: 77,
              targetObjectId: 55,
              targetPosition: { x: 404, y: 505, z: 606 },
            },
          } as unknown as import('@generals/game-logic').MapEntity],
        }),
        resolveSourceObjectModuleTypeByTag: (templateName, moduleTag) =>
          templateName === 'RuntimeTank' && moduleTag === 'ModuleTag_Stream'
            ? 'PROJECTILESTREAMUPDATE'
            : null,
        captureBrowserRuntimeSaveState: () => ({ version: 1 }),
        getObjectIdCounter: () => 24,
      },
    });

    const firstObject = readFirstSourceGameLogicObjectState(saveFile.data);
    const streamModule = firstObject?.modules.find((module) => module.identifier === 'ModuleTag_Stream');

    expect(streamModule).toBeDefined();
    const parsed = parseSourceProjectileStreamUpdateBlockData(streamModule!.blockData);
    const expectedProjectileIds = [
      ...Array.from({ length: SOURCE_PROJECTILE_STREAM_MAX - 1 }, (_, index) => index + 5),
      0,
    ];
    expect(parsed.nextCallFrameAndPhase).toBe((43 << 2) | 2);
    expect(parsed.projectileIds).toEqual(expectedProjectileIds);
    expect(parsed.nextFreeIndex).toBe(19);
    expect(parsed.firstValidIndex).toBe(0);
    expect(parsed.owningObject).toBe(77);
    expect(parsed.targetObject).toBe(55);
    expect(parsed.targetPosition).toEqual({ x: 404, y: 505, z: 606 });
  });

  it('rewrites source BoneFXUpdate modules from live runtime state', () => {
    const preservedFxPositions = createSourceBoneFxCoordGrid(10);
    const preservedOclPositions = createSourceBoneFxCoordGrid(210);
    const preservedParticlePositions = createSourceBoneFxCoordGrid(410);
    const liveNextFxFrame = createSourceBoneFxIntGrid(1000);
    const liveNextOclFrame = createSourceBoneFxIntGrid(2000);
    const liveNextParticleFrame = createSourceBoneFxIntGrid(3000);
    const liveFxPositions = createSourceBoneFxCoordGrid(1010);
    const liveOclPositions = createSourceBoneFxCoordGrid(1210);
    const liveParticlePositions = createSourceBoneFxCoordGrid(1410);
    const sourceGameLogicBytes = createSourceGameLogicChunkData(false, [{
      identifier: 'ModuleTag_BoneFX',
      blockData: createSourceBoneFxUpdateBlockData({
        nextCallFrameAndPhase: (84 << 2) | 2,
        particleSystemIds: [100, 101, 102],
        nextFxFrame: createSourceBoneFxIntGrid(100),
        nextOclFrame: createSourceBoneFxIntGrid(200),
        nextParticleSystemFrame: createSourceBoneFxIntGrid(300),
        fxBonePositions: preservedFxPositions,
        oclBonePositions: preservedOclPositions,
        particleSystemBonePositions: preservedParticlePositions,
        currentBodyState: 1,
        bonesResolvedBytes: new Uint8Array([1, 0, 1, 0]),
        active: false,
      }),
    }]);

    const saveFile = buildRuntimeSaveFile({
      description: 'source bone fx update rewrite',
      mapPath: 'Maps/RuntimeTank/RuntimeTank.map',
      mapData: {
        width: 1,
        height: 1,
        tiles: [0],
        objects: [],
        waypoints: [],
        namedAreas: [],
        namedPolygons: [],
        namedWaypointPaths: [],
        startPositions: [],
        meta: {
          name: 'RuntimeTank',
          players: 1,
          supplyDockCount: 0,
          oilDerrickCount: 0,
          techBuildingCount: 0,
        },
        blendTileCount: 0,
      },
      cameraState: null,
      passthroughBlocks: [{
        blockName: 'CHUNK_GameLogic',
        blockData: sourceGameLogicBytes.slice().buffer,
      }],
      gameLogic: {
        captureSourceTerrainLogicRuntimeSaveState: () => ({
          version: 2,
          activeBoundary: 0,
          waterUpdates: [],
        }),
        captureSourcePartitionRuntimeSaveState: createEmptyPartitionState,
        captureSourcePlayerRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceRadarRuntimeSaveState: createEmptyRadarState,
        captureSourceSidesListRuntimeSaveState: () => createEmptySidesListState(),
        captureSourceTeamFactoryRuntimeSaveState: () => createEmptyTeamFactoryState(),
        captureSourceScriptEngineRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceInGameUiRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceGameLogicRuntimeSaveState: () => ({
          version: 10,
          nextId: 101,
          nextProjectileVisualId: 1,
          animationTime: 0,
          selectedEntityId: null,
          selectedEntityIds: [],
          scriptSelectionChangedFrame: 0,
          frameCounter: 42,
          controlBarDirtyFrame: 0,
          scriptObjectTopologyVersion: 0,
          scriptObjectCountChangedFrame: 0,
          defeatedSides: new Set<string>(),
          gameEndFrame: null,
          scriptEndGameTimerActive: false,
          objectTriggerAreaStates: [],
          spawnedEntities: [{
            id: 7,
            templateName: 'RuntimeTank',
            x: 10,
            y: 0,
            z: 20,
            rotationY: 1.25,
            boneFXState: {
              currentBodyState: 2,
              active: true,
              nextFXFrame: liveNextFxFrame,
              nextOCLFrame: liveNextOclFrame,
              nextParticleFrame: liveNextParticleFrame,
              fxBonePositions: liveFxPositions,
              oclBonePositions: liveOclPositions,
              particleSystemBonePositions: liveParticlePositions,
              bonesResolved: [false, true, false, true],
              activeParticleIds: [77, 88],
              pendingVisualEvents: [],
            },
          } as unknown as import('@generals/game-logic').MapEntity],
        }),
        resolveSourceObjectModuleTypeByTag: (templateName, moduleTag) =>
          templateName === 'RuntimeTank' && moduleTag === 'ModuleTag_BoneFX'
            ? 'BONEFXUPDATE'
            : null,
        captureBrowserRuntimeSaveState: () => ({ version: 1 }),
        getObjectIdCounter: () => 101,
      },
    });

    const firstObject = readFirstSourceGameLogicObjectState(saveFile.data);
    const boneFxModule = firstObject?.modules.find((module) => module.identifier === 'ModuleTag_BoneFX');

    expect(boneFxModule).toBeDefined();
    const parsed = parseSourceBoneFxUpdateBlockData(boneFxModule!.blockData);
    expect(parsed.nextCallFrameAndPhase).toBe((43 << 2) | 2);
    expect(parsed.particleSystemIds).toEqual([77, 88]);
    expect(parsed.nextFxFrame).toEqual(liveNextFxFrame);
    expect(parsed.nextOclFrame).toEqual(liveNextOclFrame);
    expect(parsed.nextParticleSystemFrame).toEqual(liveNextParticleFrame);
    expect(parsed.fxBonePositions).toEqual(liveFxPositions);
    expect(parsed.oclBonePositions).toEqual(liveOclPositions);
    expect(parsed.particleSystemBonePositions).toEqual(liveParticlePositions);
    expect(parsed.currentBodyState).toBe(2);
    expect(Array.from(parsed.bonesResolvedBytes)).toEqual([0, 1, 0, 1]);
    expect(parsed.active).toBe(true);
  });

  it('rewrites source FlammableUpdate and FireSpreadUpdate modules from live runtime state', () => {
    const sourceGameLogicBytes = createSourceGameLogicChunkData(false, [{
      identifier: 'ModuleTag_Flammable',
      blockData: createSourceFlammableUpdateBlockData({
        nextCallFrameAndPhase: (84 << 2) | 2,
        status: 0,
        aflameEndFrame: 11,
        burnedEndFrame: 12,
        damageEndFrame: 13,
        flameDamageLimit: 20,
        lastFlameDamageDealt: 14,
      }),
    }, {
      identifier: 'ModuleTag_FireSpread',
      blockData: createSourceFireSpreadUpdateBlockData((99 << 2) | 2),
    }]);

    const saveFile = buildRuntimeSaveFile({
      description: 'source fire update rewrite',
      mapPath: 'Maps/RuntimeTank/RuntimeTank.map',
      mapData: {
        width: 1,
        height: 1,
        tiles: [0],
        objects: [],
        waypoints: [],
        namedAreas: [],
        namedPolygons: [],
        namedWaypointPaths: [],
        startPositions: [],
        meta: {
          name: 'RuntimeTank',
          players: 1,
          supplyDockCount: 0,
          oilDerrickCount: 0,
          techBuildingCount: 0,
        },
        blendTileCount: 0,
      },
      cameraState: null,
      passthroughBlocks: [{
        blockName: 'CHUNK_GameLogic',
        blockData: sourceGameLogicBytes.slice().buffer,
      }],
      gameLogic: {
        captureSourceTerrainLogicRuntimeSaveState: () => ({
          version: 2,
          activeBoundary: 0,
          waterUpdates: [],
        }),
        captureSourcePartitionRuntimeSaveState: createEmptyPartitionState,
        captureSourcePlayerRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceRadarRuntimeSaveState: createEmptyRadarState,
        captureSourceSidesListRuntimeSaveState: () => createEmptySidesListState(),
        captureSourceTeamFactoryRuntimeSaveState: () => createEmptyTeamFactoryState(),
        captureSourceScriptEngineRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceInGameUiRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceGameLogicRuntimeSaveState: () => ({
          version: 10,
          nextId: 101,
          nextProjectileVisualId: 1,
          animationTime: 0,
          selectedEntityId: null,
          selectedEntityIds: [],
          scriptSelectionChangedFrame: 0,
          frameCounter: 42,
          controlBarDirtyFrame: 0,
          scriptObjectTopologyVersion: 0,
          scriptObjectCountChangedFrame: 0,
          defeatedSides: new Set<string>(),
          gameEndFrame: null,
          scriptEndGameTimerActive: false,
          objectTriggerAreaStates: [],
          spawnedEntities: [{
            id: 7,
            templateName: 'RuntimeTank',
            x: 10,
            y: 0,
            z: 20,
            rotationY: 1.25,
            flameStatus: 'AFLAME',
            flameEndFrame: 90,
            flameBurnedEndFrame: 80,
            flameDamageNextFrame: 75,
            flameLastDamageReceivedFrame: 60,
            flameDamageAccumulated: 15,
            flammableProfile: {
              flameDamageLimit: 20,
              flameDamageExpirationDelayFrames: 60,
              aflameDurationFrames: 120,
              aflameDamageDelayFrames: 10,
              aflameDamageAmount: 4,
              burnedDelayFrames: 30,
            },
            fireSpreadProfile: {
              minSpreadDelayFrames: 5,
              maxSpreadDelayFrames: 8,
              spreadTryRange: 30,
            },
            fireSpreadNextFrame: 77,
          } as unknown as import('@generals/game-logic').MapEntity],
        }),
        resolveSourceObjectModuleTypeByTag: (templateName, moduleTag) => {
          if (templateName !== 'RuntimeTank') {
            return null;
          }
          if (moduleTag === 'ModuleTag_Flammable') {
            return 'FLAMMABLEUPDATE';
          }
          if (moduleTag === 'ModuleTag_FireSpread') {
            return 'FIRESPREADUPDATE';
          }
          return null;
        },
        captureBrowserRuntimeSaveState: () => ({ version: 1 }),
        getObjectIdCounter: () => 101,
      },
    });

    const firstObject = readFirstSourceGameLogicObjectState(saveFile.data);
    const flammableModule = firstObject?.modules.find((module) => module.identifier === 'ModuleTag_Flammable');
    const fireSpreadModule = firstObject?.modules.find((module) => module.identifier === 'ModuleTag_FireSpread');

    expect(flammableModule).toBeDefined();
    expect(fireSpreadModule).toBeDefined();
    const flammable = parseSourceFlammableUpdateBlockData(flammableModule!.blockData);
    expect(flammable.nextCallFrameAndPhase).toBe((75 << 2) | 2);
    expect(flammable.status).toBe(SOURCE_FLAMMABLE_STATUS_AFLAME);
    expect(flammable.aflameEndFrame).toBe(90);
    expect(flammable.burnedEndFrame).toBe(80);
    expect(flammable.damageEndFrame).toBe(75);
    expect(flammable.flameDamageLimit).toBeCloseTo(5, 6);
    expect(flammable.lastFlameDamageDealt).toBe(60);
    expect(parseSourceFireSpreadUpdateBlockData(fireSpreadModule!.blockData)).toEqual({
      nextCallFrameAndPhase: (77 << 2) | 2,
    });
  });

  it('rewrites source FireWeaponUpdate weapon cooldown state from live runtime modules', () => {
    const sourceGameLogicBytes = createSourceGameLogicChunkData(false, [{
      identifier: 'ModuleTag_AutoFire',
      blockData: createSourceFireWeaponUpdateBlockData({
        nextCallFrameAndPhase: (80 << 2) | 2,
        weapon: createSourceWeaponSnapshotTestState({
          templateName: 'OldAutoWeapon',
          status: 0,
          ammoInClip: 5,
          whenWeCanFireAgain: 20,
          whenLastReloadStarted: 12,
          lastFireFrame: 11,
          currentBarrel: 2,
          numShotsForCurrentBarrel: 3,
          scatterTargetsUnused: [101, 102],
          pitchLimited: true,
          leechWeaponRangeActive: true,
        }),
        initialDelayFrame: 15,
      }),
    }]);

    const saveFile = buildRuntimeSaveFile({
      description: 'source fire weapon update rewrite',
      mapPath: 'Maps/RuntimeTank/RuntimeTank.map',
      mapData: {
        width: 1,
        height: 1,
        tiles: [0],
        objects: [],
        waypoints: [],
        namedAreas: [],
        namedPolygons: [],
        namedWaypointPaths: [],
        startPositions: [],
        meta: {
          name: 'RuntimeTank',
          players: 1,
          supplyDockCount: 0,
          oilDerrickCount: 0,
          techBuildingCount: 0,
        },
        blendTileCount: 0,
      },
      cameraState: null,
      passthroughBlocks: [{
        blockName: 'CHUNK_GameLogic',
        blockData: sourceGameLogicBytes.slice().buffer,
      }],
      gameLogic: {
        captureSourceTerrainLogicRuntimeSaveState: () => ({
          version: 2,
          activeBoundary: 0,
          waterUpdates: [],
        }),
        captureSourcePartitionRuntimeSaveState: createEmptyPartitionState,
        captureSourcePlayerRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceRadarRuntimeSaveState: createEmptyRadarState,
        captureSourceSidesListRuntimeSaveState: () => createEmptySidesListState(),
        captureSourceTeamFactoryRuntimeSaveState: () => createEmptyTeamFactoryState(),
        captureSourceScriptEngineRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceInGameUiRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceGameLogicRuntimeSaveState: () => ({
          version: 10,
          nextId: 101,
          nextProjectileVisualId: 1,
          animationTime: 0,
          selectedEntityId: null,
          selectedEntityIds: [],
          scriptSelectionChangedFrame: 0,
          frameCounter: 42,
          controlBarDirtyFrame: 0,
          scriptObjectTopologyVersion: 0,
          scriptObjectCountChangedFrame: 0,
          defeatedSides: new Set<string>(),
          gameEndFrame: null,
          scriptEndGameTimerActive: false,
          objectTriggerAreaStates: [],
          spawnedEntities: [{
            id: 7,
            templateName: 'RuntimeTank',
            x: 10,
            y: 0,
            z: 20,
            rotationY: 1.25,
            fireWeaponUpdateProfiles: [{
              moduleTag: 'MODULETAG_AUTOFIRE',
              weaponName: 'RuntimeAutoWeapon',
              initialDelayFrames: 4,
              exclusiveWeaponDelayFrames: 0,
            }],
            fireWeaponUpdateNextFireFrames: [75],
          } as unknown as import('@generals/game-logic').MapEntity],
        }),
        resolveSourceObjectModuleTypeByTag: (templateName, moduleTag) => {
          if (templateName === 'RuntimeTank' && moduleTag === 'ModuleTag_AutoFire') {
            return 'FIREWEAPONUPDATE';
          }
          return null;
        },
        captureBrowserRuntimeSaveState: () => ({ version: 1 }),
        getObjectIdCounter: () => 101,
      },
    });

    const firstObject = readFirstSourceGameLogicObjectState(saveFile.data);
    const fireWeaponModule = firstObject?.modules.find((module) => module.identifier === 'ModuleTag_AutoFire');

    expect(fireWeaponModule).toBeDefined();
    const parsed = parseSourceFireWeaponUpdateBlockData(fireWeaponModule!.blockData);
    expect(parsed.nextCallFrameAndPhase).toBe((43 << 2) | 2);
    expect(parsed.initialDelayFrame).toBe(75);
    expect(parsed.weapon.templateName).toBe('RuntimeAutoWeapon');
    expect(parsed.weapon.status).toBe(SOURCE_WEAPON_STATUS_BETWEEN_FIRING_SHOTS);
    expect(parsed.weapon.whenWeCanFireAgain).toBe(75);
    expect(parsed.weapon.ammoInClip).toBe(5);
    expect(parsed.weapon.whenLastReloadStarted).toBe(12);
    expect(parsed.weapon.lastFireFrame).toBe(11);
    expect(parsed.weapon.currentBarrel).toBe(2);
    expect(parsed.weapon.numShotsForCurrentBarrel).toBe(3);
    expect(parsed.weapon.scatterTargetsUnused).toEqual([101, 102]);
    expect(parsed.weapon.pitchLimited).toBe(true);
    expect(parsed.weapon.leechWeaponRangeActive).toBe(true);
  });

  it('rewrites source FireWeaponCollide and AnimationSteeringUpdate modules from live runtime state', () => {
    const sourceGameLogicBytes = createSourceGameLogicChunkData(false, [{
      identifier: 'ModuleTag_Collide',
      blockData: createSourceFireWeaponCollideBlockData({
        weaponPresent: true,
        weapon: createSourceWeaponSnapshotTestState({
          templateName: 'OldCollideWeapon',
          ammoInClip: 7,
          whenWeCanFireAgain: 25,
          lastFireFrame: 14,
          currentBarrel: 1,
          scatterTargetsUnused: [201],
        }),
        everFired: true,
      }),
    }, {
      identifier: 'ModuleTag_AnimSteer',
      blockData: createSourceAnimationSteeringUpdateBlockData((99 << 2) | 2),
    }]);

    const saveFile = buildRuntimeSaveFile({
      description: 'source fire weapon collide and animation steering rewrite',
      mapPath: 'Maps/RuntimeCollider/RuntimeCollider.map',
      mapData: {
        width: 1,
        height: 1,
        tiles: [0],
        objects: [],
        waypoints: [],
        namedAreas: [],
        namedPolygons: [],
        namedWaypointPaths: [],
        startPositions: [],
        meta: {
          name: 'RuntimeCollider',
          players: 1,
          supplyDockCount: 0,
          oilDerrickCount: 0,
          techBuildingCount: 0,
        },
        blendTileCount: 0,
      },
      cameraState: null,
      passthroughBlocks: [{
        blockName: 'CHUNK_GameLogic',
        blockData: sourceGameLogicBytes.slice().buffer,
      }],
      gameLogic: {
        captureSourceTerrainLogicRuntimeSaveState: () => ({
          version: 2,
          activeBoundary: 0,
          waterUpdates: [],
        }),
        captureSourcePartitionRuntimeSaveState: createEmptyPartitionState,
        captureSourcePlayerRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceRadarRuntimeSaveState: createEmptyRadarState,
        captureSourceSidesListRuntimeSaveState: () => createEmptySidesListState(),
        captureSourceTeamFactoryRuntimeSaveState: () => createEmptyTeamFactoryState(),
        captureSourceScriptEngineRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceInGameUiRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceGameLogicRuntimeSaveState: () => ({
          version: 10,
          nextId: 101,
          nextProjectileVisualId: 1,
          animationTime: 0,
          selectedEntityId: null,
          selectedEntityIds: [],
          scriptSelectionChangedFrame: 0,
          frameCounter: 42,
          controlBarDirtyFrame: 0,
          scriptObjectTopologyVersion: 0,
          scriptObjectCountChangedFrame: 0,
          defeatedSides: new Set<string>(),
          gameEndFrame: null,
          scriptEndGameTimerActive: false,
          objectTriggerAreaStates: [],
          spawnedEntities: [{
            id: 7,
            templateName: 'RuntimeTank',
            x: 10,
            y: 0,
            z: 20,
            rotationY: 1.25,
            fireWeaponCollideProfiles: [{
              moduleTag: 'MODULETAG_COLLIDE',
              collideWeapon: 'RuntimeCollideWeapon',
              fireOnce: true,
              requiredStatus: new Set<string>(),
              forbiddenStatus: new Set<string>(),
            }],
            fireWeaponCollideEverFired: [false],
            animationSteeringProfile: { transitionFrames: 3 },
          } as unknown as import('@generals/game-logic').MapEntity],
        }),
        resolveSourceObjectModuleTypeByTag: (templateName, moduleTag) => {
          if (templateName === 'RuntimeTank' && moduleTag === 'ModuleTag_Collide') {
            return 'FIREWEAPONCOLLIDE';
          }
          if (templateName === 'RuntimeTank' && moduleTag === 'ModuleTag_AnimSteer') {
            return 'ANIMATIONSTEERINGUPDATE';
          }
          return null;
        },
        captureBrowserRuntimeSaveState: () => ({ version: 1 }),
        getObjectIdCounter: () => 101,
      },
    });

    const firstObject = readFirstSourceGameLogicObjectState(saveFile.data);
    const collideModule = firstObject?.modules.find((module) => module.identifier === 'ModuleTag_Collide');
    const animationModule = firstObject?.modules.find((module) => module.identifier === 'ModuleTag_AnimSteer');

    expect(collideModule).toBeDefined();
    const parsedCollide = parseSourceFireWeaponCollideBlockData(collideModule!.blockData);
    expect(parsedCollide.weaponPresent).toBe(true);
    expect(parsedCollide.weapon.templateName).toBe('RuntimeCollideWeapon');
    expect(parsedCollide.weapon.ammoInClip).toBe(7);
    expect(parsedCollide.weapon.whenWeCanFireAgain).toBe(25);
    expect(parsedCollide.weapon.lastFireFrame).toBe(14);
    expect(parsedCollide.weapon.currentBarrel).toBe(1);
    expect(parsedCollide.weapon.scatterTargetsUnused).toEqual([201]);
    expect(parsedCollide.everFired).toBe(false);

    expect(animationModule).toBeDefined();
    const parsedAnimation = parseSourceAnimationSteeringUpdateBlockData(animationModule!.blockData);
    expect(parsedAnimation.nextCallFrameAndPhase).toBe((43 << 2) | 2);
  });

  it('rewrites source DeployStyleAIUpdate tail while preserving AIUpdateInterface bytes', () => {
    const sourceDeployBlock = createSourceDeployStyleAIUpdateBlockData(0, 0);
    const preservedPrefix = parseSourceDeployStyleAIUpdateBlockData(sourceDeployBlock).prefix;
    const sourceGameLogicBytes = createSourceGameLogicChunkData(false, [{
      identifier: 'ModuleTag_Deploy',
      blockData: sourceDeployBlock,
    }]);

    const saveFile = buildRuntimeSaveFile({
      description: 'source deploy style ai update rewrite',
      mapPath: 'Maps/RuntimeDeploy/RuntimeDeploy.map',
      mapData: {
        width: 1,
        height: 1,
        tiles: [0],
        objects: [],
        waypoints: [],
        namedAreas: [],
        namedPolygons: [],
        namedWaypointPaths: [],
        startPositions: [],
        meta: {
          name: 'RuntimeDeploy',
          players: 1,
          supplyDockCount: 0,
          oilDerrickCount: 0,
          techBuildingCount: 0,
        },
        blendTileCount: 0,
      },
      cameraState: null,
      passthroughBlocks: [{
        blockName: 'CHUNK_GameLogic',
        blockData: sourceGameLogicBytes.slice().buffer,
      }],
      gameLogic: {
        captureSourceTerrainLogicRuntimeSaveState: () => ({
          version: 2,
          activeBoundary: 0,
          waterUpdates: [],
        }),
        captureSourcePartitionRuntimeSaveState: createEmptyPartitionState,
        captureSourcePlayerRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceRadarRuntimeSaveState: createEmptyRadarState,
        captureSourceSidesListRuntimeSaveState: () => createEmptySidesListState(),
        captureSourceTeamFactoryRuntimeSaveState: () => createEmptyTeamFactoryState(),
        captureSourceScriptEngineRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceInGameUiRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceGameLogicRuntimeSaveState: () => ({
          version: 10,
          nextId: 101,
          nextProjectileVisualId: 1,
          animationTime: 0,
          selectedEntityId: null,
          selectedEntityIds: [],
          scriptSelectionChangedFrame: 0,
          frameCounter: 42,
          controlBarDirtyFrame: 0,
          scriptObjectTopologyVersion: 0,
          scriptObjectCountChangedFrame: 0,
          defeatedSides: new Set<string>(),
          gameEndFrame: null,
          scriptEndGameTimerActive: false,
          objectTriggerAreaStates: [],
          spawnedEntities: [{
            id: 7,
            templateName: 'RuntimeTank',
            x: 10,
            y: 0,
            z: 20,
            rotationY: 1.25,
            deployStyleProfile: {
              unpackTimeFrames: 30,
              packTimeFrames: 20,
              turretsFunctionOnlyWhenDeployed: false,
              resetTurretBeforePacking: false,
              turretsMustCenterBeforePacking: false,
            },
            deployState: 'UNDEPLOY',
            deployFrameToWait: 88,
          } as unknown as import('@generals/game-logic').MapEntity],
        }),
        resolveSourceObjectModuleTypeByTag: (templateName, moduleTag) => {
          if (templateName === 'RuntimeTank' && moduleTag === 'ModuleTag_Deploy') {
            return 'DEPLOYSTYLEAIUPDATE';
          }
          return null;
        },
        captureBrowserRuntimeSaveState: () => ({ version: 1 }),
        getObjectIdCounter: () => 101,
      },
    });

    const firstObject = readFirstSourceGameLogicObjectState(saveFile.data);
    const deployModule = firstObject?.modules.find((module) => module.identifier === 'ModuleTag_Deploy');

    expect(deployModule).toBeDefined();
    const parsed = parseSourceDeployStyleAIUpdateBlockData(deployModule!.blockData);
    expect(parsed.prefix).toEqual(preservedPrefix);
    expect(parsed.state).toBe(3);
    expect(parsed.frameToWaitForDeploy).toBe(88);
  });

  it('rewrites source production exit update modules from live rally and queue state', () => {
    const sourceGameLogicBytes = createSourceGameLogicChunkData(false, [{
      identifier: 'ModuleTag_DefaultExit',
      blockData: createSourceProductionExitRallyBlockData(
        (90 << 2) | 2,
        { x: 1, y: 2, z: 3 },
        false,
      ),
    }, {
      identifier: 'ModuleTag_SupplyExit',
      blockData: createSourceProductionExitRallyBlockData(
        (91 << 2) | 2,
        { x: 4, y: 5, z: 6 },
        false,
      ),
    }, {
      identifier: 'ModuleTag_QueueExit',
      blockData: createSourceQueueProductionExitBlockData(
        (92 << 2) | 2,
        11,
        { x: 7, y: 8, z: 9 },
        false,
        44.5,
        2,
      ),
    }, {
      identifier: 'ModuleTag_SpawnExit',
      blockData: createSourceSpawnPointProductionExitBlockData(
        (93 << 2) | 2,
        [301, 302, 303, 304],
      ),
    }]);

    const saveFile = buildRuntimeSaveFile({
      description: 'source production exit rewrite',
      mapPath: 'Maps/RuntimeFactory/RuntimeFactory.map',
      mapData: {
        width: 1,
        height: 1,
        tiles: [0],
        objects: [],
        waypoints: [],
        namedAreas: [],
        namedPolygons: [],
        namedWaypointPaths: [],
        startPositions: [],
        meta: {
          name: 'RuntimeFactory',
          players: 1,
          supplyDockCount: 0,
          oilDerrickCount: 0,
          techBuildingCount: 0,
        },
        blendTileCount: 0,
      },
      cameraState: null,
      passthroughBlocks: [{
        blockName: 'CHUNK_GameLogic',
        blockData: sourceGameLogicBytes.slice().buffer,
      }],
      gameLogic: {
        captureSourceTerrainLogicRuntimeSaveState: () => ({
          version: 2,
          activeBoundary: 0,
          waterUpdates: [],
        }),
        captureSourcePartitionRuntimeSaveState: createEmptyPartitionState,
        captureSourcePlayerRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceRadarRuntimeSaveState: createEmptyRadarState,
        captureSourceSidesListRuntimeSaveState: () => createEmptySidesListState(),
        captureSourceTeamFactoryRuntimeSaveState: () => createEmptyTeamFactoryState(),
        captureSourceScriptEngineRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceInGameUiRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceGameLogicRuntimeSaveState: () => ({
          version: 10,
          nextId: 101,
          nextProjectileVisualId: 1,
          animationTime: 0,
          selectedEntityId: null,
          selectedEntityIds: [],
          scriptSelectionChangedFrame: 0,
          frameCounter: 42,
          controlBarDirtyFrame: 0,
          scriptObjectTopologyVersion: 0,
          scriptObjectCountChangedFrame: 0,
          defeatedSides: new Set<string>(),
          gameEndFrame: null,
          scriptEndGameTimerActive: false,
          objectTriggerAreaStates: [],
          spawnedEntities: [{
            id: 7,
            templateName: 'RuntimeTank',
            x: 10,
            y: 0,
            z: 20,
            rotationY: 1.25,
            queueProductionExitProfile: {
              moduleType: 'QUEUE',
              unitCreatePoint: { x: 0, y: 0, z: 0 },
              naturalRallyPoint: null,
              exitDelayFrames: 30,
              allowAirborneCreation: false,
              initialBurst: 5,
              spawnPointBoneName: null,
            },
            rallyPoint: { x: 100, z: 200 },
            rallyPointY: 66,
            queueProductionExitDelayFramesRemaining: 9,
            queueProductionExitBurstRemaining: 4,
            queueProductionExitCreationClearDistance: 55.5,
            spawnPointExitState: {
              initialized: true,
              spawnPointCount: 10,
              spawnPositions: [],
              occupierIds: [-1, 401, -1, 403, 404],
            },
          } as unknown as import('@generals/game-logic').MapEntity],
        }),
        resolveSourceObjectModuleTypeByTag: (templateName, moduleTag) => {
          if (templateName !== 'RuntimeTank') {
            return null;
          }
          switch (moduleTag) {
            case 'ModuleTag_DefaultExit': return 'DEFAULTPRODUCTIONEXITUPDATE';
            case 'ModuleTag_SupplyExit': return 'SUPPLYCENTERPRODUCTIONEXITUPDATE';
            case 'ModuleTag_QueueExit': return 'QUEUEPRODUCTIONEXITUPDATE';
            case 'ModuleTag_SpawnExit': return 'SPAWNPOINTPRODUCTIONEXITUPDATE';
            default: return null;
          }
        },
        captureBrowserRuntimeSaveState: () => ({ version: 1 }),
        getObjectIdCounter: () => 101,
      },
    });

    const firstObject = readFirstSourceGameLogicObjectState(saveFile.data);
    const defaultModule = firstObject?.modules.find((module) => module.identifier === 'ModuleTag_DefaultExit');
    const supplyModule = firstObject?.modules.find((module) => module.identifier === 'ModuleTag_SupplyExit');
    const queueModule = firstObject?.modules.find((module) => module.identifier === 'ModuleTag_QueueExit');
    const spawnModule = firstObject?.modules.find((module) => module.identifier === 'ModuleTag_SpawnExit');

    expect(defaultModule).toBeDefined();
    const parsedDefault = parseSourceProductionExitRallyBlockData(defaultModule!.blockData);
    expect(parsedDefault.nextCallFrameAndPhase).toBe(0xfffffffe);
    expect(parsedDefault.rallyPoint).toEqual({ x: 100, y: 66, z: 200 });
    expect(parsedDefault.rallyPointExists).toBe(true);

    expect(supplyModule).toBeDefined();
    const parsedSupply = parseSourceProductionExitRallyBlockData(supplyModule!.blockData);
    expect(parsedSupply.nextCallFrameAndPhase).toBe(0xfffffffe);
    expect(parsedSupply.rallyPoint).toEqual({ x: 100, y: 66, z: 200 });
    expect(parsedSupply.rallyPointExists).toBe(true);

    expect(queueModule).toBeDefined();
    const parsedQueue = parseSourceQueueProductionExitBlockData(queueModule!.blockData);
    expect(parsedQueue.nextCallFrameAndPhase).toBe((43 << 2) | 2);
    expect(parsedQueue.currentDelay).toBe(9);
    expect(parsedQueue.rallyPoint).toEqual({ x: 100, y: 66, z: 200 });
    expect(parsedQueue.rallyPointExists).toBe(true);
    expect(parsedQueue.creationClearDistance).toBeCloseTo(55.5);
    expect(parsedQueue.currentBurstCount).toBe(4);

    expect(spawnModule).toBeDefined();
    const parsedSpawn = parseSourceSpawnPointProductionExitBlockData(spawnModule!.blockData);
    expect(parsedSpawn.nextCallFrameAndPhase).toBe(0xfffffffe);
    expect(parsedSpawn.occupierIds).toEqual([0, 401, 0, 403, 404, 0, 0, 0, 0, 0]);
  });

  it('rewrites source dock update modules while preserving source-only dock vectors', () => {
    const dockState = createSourceDockUpdateTestState();
    const sourceGameLogicBytes = createSourceGameLogicChunkData(false, [{
      identifier: 'ModuleTag_SupplyCenterDock',
      blockData: createSourceDockOnlyUpdateBlockData(dockState),
    }, {
      identifier: 'ModuleTag_WarehouseDock',
      blockData: createSourceSupplyWarehouseDockUpdateBlockData(dockState, 19),
    }, {
      identifier: 'ModuleTag_RepairDock',
      blockData: createSourceRepairDockUpdateBlockData(dockState, 0, 0),
    }, {
      identifier: 'ModuleTag_PrisonDock',
      blockData: createSourceDockOnlyUpdateBlockData(dockState),
    }, {
      identifier: 'ModuleTag_RailedDock',
      blockData: createSourceRailedTransportDockUpdateBlockData(dockState),
    }]);

    const saveFile = buildRuntimeSaveFile({
      description: 'source dock rewrite',
      mapPath: 'Maps/RuntimeDock/RuntimeDock.map',
      mapData: {
        width: 1,
        height: 1,
        tiles: [0],
        objects: [],
        waypoints: [],
        namedAreas: [],
        namedPolygons: [],
        namedWaypointPaths: [],
        startPositions: [],
        meta: {
          name: 'RuntimeDock',
          players: 1,
          supplyDockCount: 0,
          oilDerrickCount: 0,
          techBuildingCount: 0,
        },
        blendTileCount: 0,
      },
      cameraState: null,
      passthroughBlocks: [{
        blockName: 'CHUNK_GameLogic',
        blockData: sourceGameLogicBytes.slice().buffer,
      }],
      gameLogic: {
        captureSourceTerrainLogicRuntimeSaveState: () => ({
          version: 2,
          activeBoundary: 0,
          waterUpdates: [],
        }),
        captureSourcePartitionRuntimeSaveState: createEmptyPartitionState,
        captureSourcePlayerRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceRadarRuntimeSaveState: createEmptyRadarState,
        captureSourceSidesListRuntimeSaveState: () => createEmptySidesListState(),
        captureSourceTeamFactoryRuntimeSaveState: () => createEmptyTeamFactoryState(),
        captureSourceScriptEngineRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceInGameUiRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceGameLogicRuntimeSaveState: () => ({
          version: 10,
          nextId: 101,
          nextProjectileVisualId: 1,
          animationTime: 0,
          selectedEntityId: null,
          selectedEntityIds: [],
          scriptSelectionChangedFrame: 0,
          frameCounter: 42,
          controlBarDirtyFrame: 0,
          scriptObjectTopologyVersion: 0,
          scriptObjectCountChangedFrame: 0,
          defeatedSides: new Set<string>(),
          gameEndFrame: null,
          scriptEndGameTimerActive: false,
          objectTriggerAreaStates: [],
          supplyWarehouseStates: [{
            entityId: 7,
            state: { currentBoxes: 6 },
          }],
          spawnedEntities: [{
            id: 7,
            templateName: 'RuntimeTank',
            x: 10,
            y: 0,
            z: 20,
            rotationY: 1.25,
            isSupplyCenter: true,
            supplyWarehouseProfile: {
              startingBoxes: 20,
              deleteWhenEmpty: false,
              numberApproachPositions: 2,
              allowsPassthrough: true,
            },
            swCripplingDockDisabled: true,
            repairDockProfile: {
              timeForFullHealFrames: 30,
              numberApproachPositions: 2,
              allowsPassthrough: false,
            },
            repairDockLastRepairEntityId: 44,
            repairDockHealthToAddPerFrame: 3.5,
          } as unknown as import('@generals/game-logic').MapEntity],
        }),
        resolveSourceObjectModuleTypeByTag: (templateName, moduleTag) => {
          if (templateName !== 'RuntimeTank') {
            return null;
          }
          switch (moduleTag) {
            case 'ModuleTag_SupplyCenterDock': return 'SUPPLYCENTERDOCKUPDATE';
            case 'ModuleTag_WarehouseDock': return 'SUPPLYWAREHOUSEDOCKUPDATE';
            case 'ModuleTag_RepairDock': return 'REPAIRDOCKUPDATE';
            case 'ModuleTag_PrisonDock': return 'PRISONDOCKUPDATE';
            case 'ModuleTag_RailedDock': return 'RAILEDTRANSPORTDOCKUPDATE';
            default: return null;
          }
        },
        captureBrowserRuntimeSaveState: () => ({ version: 1 }),
        getObjectIdCounter: () => 101,
      },
    });

    const firstObject = readFirstSourceGameLogicObjectState(saveFile.data);
    const supplyCenterModule = firstObject?.modules.find((module) => module.identifier === 'ModuleTag_SupplyCenterDock');
    const warehouseModule = firstObject?.modules.find((module) => module.identifier === 'ModuleTag_WarehouseDock');
    const repairModule = firstObject?.modules.find((module) => module.identifier === 'ModuleTag_RepairDock');
    const prisonModule = firstObject?.modules.find((module) => module.identifier === 'ModuleTag_PrisonDock');
    const railedModule = firstObject?.modules.find((module) => module.identifier === 'ModuleTag_RailedDock');

    expect(supplyCenterModule).toBeDefined();
    const parsedSupplyCenter = parseSourceDockOnlyUpdateBlockData(supplyCenterModule!.blockData);
    expect(parsedSupplyCenter.nextCallFrameAndPhase).toBe((43 << 2) | 2);
    expect(parsedSupplyCenter.approachPositions).toEqual(dockState.approachPositions);
    expect(parsedSupplyCenter.approachPositionOwners).toEqual(dockState.approachPositionOwners);
    expect(parsedSupplyCenter.approachPositionReached).toEqual(dockState.approachPositionReached);
    expect(parsedSupplyCenter.activeDocker).toBe(dockState.activeDocker);
    expect(parsedSupplyCenter.dockerInside).toBe(dockState.dockerInside);
    expect(parsedSupplyCenter.dockOpen).toBe(dockState.dockOpen);

    expect(warehouseModule).toBeDefined();
    const parsedWarehouse = parseSourceSupplyWarehouseDockUpdateBlockData(warehouseModule!.blockData);
    expect(parsedWarehouse.dock.nextCallFrameAndPhase).toBe((43 << 2) | 2);
    expect(parsedWarehouse.dock.approachPositions).toEqual(dockState.approachPositions);
    expect(parsedWarehouse.dock.approachPositionOwners).toEqual(dockState.approachPositionOwners);
    expect(parsedWarehouse.dock.dockCrippled).toBe(true);
    expect(parsedWarehouse.boxesStored).toBe(6);

    expect(repairModule).toBeDefined();
    const parsedRepair = parseSourceRepairDockUpdateBlockData(repairModule!.blockData);
    expect(parsedRepair.dock.nextCallFrameAndPhase).toBe((43 << 2) | 2);
    expect(parsedRepair.dock.approachPositionReached).toEqual(dockState.approachPositionReached);
    expect(parsedRepair.lastRepair).toBe(44);
    expect(parsedRepair.healthToAddPerFrame).toBeCloseTo(3.5);

    expect(prisonModule).toBeDefined();
    const parsedPrison = parseSourceDockOnlyUpdateBlockData(prisonModule!.blockData);
    expect(parsedPrison.nextCallFrameAndPhase).toBe((43 << 2) | 2);
    expect(parsedPrison.approachPositionOwners).toEqual(dockState.approachPositionOwners);

    expect(railedModule).toBeDefined();
    const parsedRailed = parseSourceRailedTransportDockUpdateBlockData(railedModule!.blockData);
    expect(parsedRailed.dock.nextCallFrameAndPhase).toBe((43 << 2) | 2);
    expect(parsedRailed.dockingObjectId).toBe(31);
    expect(parsedRailed.pullInsideDistancePerFrame).toBeCloseTo(1.25);
    expect(parsedRailed.unloadingObjectId).toBe(32);
    expect(parsedRailed.pushOutsideDistancePerFrame).toBeCloseTo(2.5);
    expect(parsedRailed.unloadCount).toBe(-1);
  });

  it('rewrites source SupplyWarehouseCripplingBehavior heal timers from live runtime state', () => {
    const sourceGameLogicBytes = createSourceGameLogicChunkData(false, [{
      identifier: 'ModuleTag_Cripple',
      blockData: createSourceSupplyWarehouseCripplingBehaviorBlockData(
        (90 << 2) | 2,
        80,
        95,
      ),
    }]);

    const saveFile = buildRuntimeSaveFile({
      description: 'source supply warehouse crippling rewrite',
      mapPath: 'Maps/RuntimeCripple/RuntimeCripple.map',
      mapData: {
        width: 1,
        height: 1,
        tiles: [0],
        objects: [],
        waypoints: [],
        namedAreas: [],
        namedPolygons: [],
        namedWaypointPaths: [],
        startPositions: [],
        meta: {
          name: 'RuntimeCripple',
          players: 1,
          supplyDockCount: 0,
          oilDerrickCount: 0,
          techBuildingCount: 0,
        },
        blendTileCount: 0,
      },
      cameraState: null,
      passthroughBlocks: [{
        blockName: 'CHUNK_GameLogic',
        blockData: sourceGameLogicBytes.slice().buffer,
      }],
      gameLogic: {
        captureSourceTerrainLogicRuntimeSaveState: () => ({
          version: 2,
          activeBoundary: 0,
          waterUpdates: [],
        }),
        captureSourcePartitionRuntimeSaveState: createEmptyPartitionState,
        captureSourcePlayerRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceRadarRuntimeSaveState: createEmptyRadarState,
        captureSourceSidesListRuntimeSaveState: () => createEmptySidesListState(),
        captureSourceTeamFactoryRuntimeSaveState: () => createEmptyTeamFactoryState(),
        captureSourceScriptEngineRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceInGameUiRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceGameLogicRuntimeSaveState: () => ({
          version: 10,
          nextId: 101,
          nextProjectileVisualId: 1,
          animationTime: 0,
          selectedEntityId: null,
          selectedEntityIds: [],
          scriptSelectionChangedFrame: 0,
          frameCounter: 42,
          controlBarDirtyFrame: 0,
          scriptObjectTopologyVersion: 0,
          scriptObjectCountChangedFrame: 0,
          defeatedSides: new Set<string>(),
          gameEndFrame: null,
          scriptEndGameTimerActive: false,
          objectTriggerAreaStates: [],
          spawnedEntities: [{
            id: 7,
            templateName: 'RuntimeTank',
            x: 10,
            y: 0,
            z: 20,
            rotationY: 1.25,
            health: 300,
            maxHealth: 1000,
            supplyWarehouseCripplingProfile: {
              selfHealSuppressionFrames: 30,
              selfHealDelayFrames: 10,
              selfHealAmount: 50,
            },
            swCripplingHealSuppressedUntilFrame: 100,
            swCripplingNextHealFrame: 110,
            swCripplingDockDisabled: true,
          } as unknown as import('@generals/game-logic').MapEntity],
        }),
        resolveSourceObjectModuleTypeByTag: (templateName, moduleTag) => {
          if (templateName !== 'RuntimeTank') {
            return null;
          }
          return moduleTag === 'ModuleTag_Cripple' ? 'SUPPLYWAREHOUSECRIPPLINGBEHAVIOR' : null;
        },
        captureBrowserRuntimeSaveState: () => ({ version: 1 }),
        getObjectIdCounter: () => 101,
      },
    });

    const firstObject = readFirstSourceGameLogicObjectState(saveFile.data);
    const module = firstObject?.modules.find((candidate) => candidate.identifier === 'ModuleTag_Cripple');

    expect(module).toBeDefined();
    const parsed = parseSourceSupplyWarehouseCripplingBehaviorBlockData(module!.blockData);
    expect(parsed.nextCallFrameAndPhase).toBe((100 << 2) | 2);
    expect(parsed.healingSuppressedUntilFrame).toBe(100);
    expect(parsed.nextHealingFrame).toBe(110);
  });

  it('rewrites source SpawnBehavior lists and counters from live runtime state', () => {
    const sourceSpawnState = createSourceSpawnBehaviorTestState();
    const sourceGameLogicBytes = createSourceGameLogicChunkData(false, [{
      identifier: 'ModuleTag_Spawn',
      blockData: createSourceSpawnBehaviorBlockData(sourceSpawnState),
    }]);

    const saveFile = buildRuntimeSaveFile({
      description: 'source spawn behavior rewrite',
      mapPath: 'Maps/RuntimeSpawn/RuntimeSpawn.map',
      mapData: {
        width: 1,
        height: 1,
        tiles: [0],
        objects: [],
        waypoints: [],
        namedAreas: [],
        namedPolygons: [],
        namedWaypointPaths: [],
        startPositions: [],
        meta: {
          name: 'RuntimeSpawn',
          players: 1,
          supplyDockCount: 0,
          oilDerrickCount: 0,
          techBuildingCount: 0,
        },
        blendTileCount: 0,
      },
      cameraState: null,
      passthroughBlocks: [{
        blockName: 'CHUNK_GameLogic',
        blockData: sourceGameLogicBytes.slice().buffer,
      }],
      gameLogic: {
        captureSourceTerrainLogicRuntimeSaveState: () => ({
          version: 2,
          activeBoundary: 0,
          waterUpdates: [],
        }),
        captureSourcePartitionRuntimeSaveState: createEmptyPartitionState,
        captureSourcePlayerRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceRadarRuntimeSaveState: createEmptyRadarState,
        captureSourceSidesListRuntimeSaveState: () => createEmptySidesListState(),
        captureSourceTeamFactoryRuntimeSaveState: () => createEmptyTeamFactoryState(),
        captureSourceScriptEngineRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceInGameUiRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceGameLogicRuntimeSaveState: () => ({
          version: 10,
          nextId: 101,
          nextProjectileVisualId: 1,
          animationTime: 0,
          selectedEntityId: null,
          selectedEntityIds: [],
          scriptSelectionChangedFrame: 0,
          frameCounter: 42,
          controlBarDirtyFrame: 0,
          scriptObjectTopologyVersion: 0,
          scriptObjectCountChangedFrame: 0,
          defeatedSides: new Set<string>(),
          gameEndFrame: null,
          scriptEndGameTimerActive: false,
          objectTriggerAreaStates: [],
          spawnedEntities: [{
            id: 7,
            templateName: 'RuntimeTank',
            x: 10,
            y: 0,
            z: 20,
            rotationY: 1.25,
            spawnBehaviorState: {
              profile: {
                spawnNumber: 3,
                spawnReplaceDelayFrames: 30,
                spawnTemplateNames: ['DroneA', 'DroneB'],
                oneShot: true,
                spawnedRequireSpawner: true,
                aggregateHealth: true,
                initialBurst: 2,
                slavesHaveFreeWill: false,
                canReclaimOrphans: false,
                exitByBudding: false,
              },
              slaveIds: [51, 52],
              replacementFrames: [70, 75],
              templateNameIndex: 1,
              oneShotRemaining: 1,
              oneShotCompleted: false,
              initialBurstApplied: true,
            },
          } as unknown as import('@generals/game-logic').MapEntity],
        }),
        resolveSourceObjectModuleTypeByTag: (templateName, moduleTag) => {
          if (templateName !== 'RuntimeTank') {
            return null;
          }
          return moduleTag === 'ModuleTag_Spawn' ? 'SPAWNBEHAVIOR' : null;
        },
        captureBrowserRuntimeSaveState: () => ({ version: 1 }),
        getObjectIdCounter: () => 101,
      },
    });

    const firstObject = readFirstSourceGameLogicObjectState(saveFile.data);
    const module = firstObject?.modules.find((candidate) => candidate.identifier === 'ModuleTag_Spawn');

    expect(module).toBeDefined();
    const parsed = parseSourceSpawnBehaviorBlockData(module!.blockData);
    expect(parsed.version).toBe(2);
    expect(parsed.initialBurstTimesInited).toBe(true);
    expect(parsed.spawnTemplateName).toBe('DroneB');
    expect(parsed.oneShotCountdown).toBe(1);
    expect(parsed.framesToWait).toBe(sourceSpawnState.framesToWait);
    expect(parsed.firstBatchCount).toBe(sourceSpawnState.firstBatchCount);
    expect(parsed.replacementTimes).toEqual([70, 75]);
    expect(parsed.spawnIds).toEqual([51, 52]);
    expect(parsed.active).toBe(true);
    expect(parsed.aggregateHealth).toBe(true);
    expect(parsed.spawnCount).toBe(2);
    expect(parsed.selfTaskingSpawnCount).toBe(sourceSpawnState.selfTaskingSpawnCount);
  });

  it('rewrites source PoisonedBehavior and MinefieldBehavior modules from live runtime state', () => {
    const sourceGameLogicBytes = createSourceGameLogicChunkData(false, [{
      identifier: 'ModuleTag_Poisoned',
      blockData: createSourcePoisonedBehaviorBlockData({
        nextCallFrameAndPhase: (84 << 2) | 2,
        poisonDamageFrame: 11,
        poisonOverallStopFrame: 12,
        poisonDamageAmount: 3,
        deathType: SOURCE_DEATH_TYPE_POISONED,
      }),
    }, {
      identifier: 'ModuleTag_Minefield',
      blockData: createSourceMinefieldBehaviorBlockData({
        nextCallFrameAndPhase: (88 << 2) | 2,
        virtualMinesRemaining: 1,
        nextDeathCheckFrame: 222,
        scootFramesLeft: 0,
        scootVelocity: { x: 1, y: 2, z: 3 },
        scootAcceleration: { x: 4, y: 5, z: 6 },
        ignoreDamage: false,
        regenerates: true,
        draining: false,
        immunes: [
          { objectId: 40, collideTime: 10 },
          { objectId: 0, collideTime: 0 },
          { objectId: 0, collideTime: 0 },
        ],
      }),
    }]);

    const saveFile = buildRuntimeSaveFile({
      description: 'source poison minefield rewrite',
      mapPath: 'Maps/RuntimeTank/RuntimeTank.map',
      mapData: {
        width: 1,
        height: 1,
        tiles: [0],
        objects: [],
        waypoints: [],
        namedAreas: [],
        namedPolygons: [],
        namedWaypointPaths: [],
        startPositions: [],
        meta: {
          name: 'RuntimeTank',
          players: 1,
          supplyDockCount: 0,
          oilDerrickCount: 0,
          techBuildingCount: 0,
        },
        blendTileCount: 0,
      },
      cameraState: null,
      passthroughBlocks: [{
        blockName: 'CHUNK_GameLogic',
        blockData: sourceGameLogicBytes.slice().buffer,
      }],
      gameLogic: {
        captureSourceTerrainLogicRuntimeSaveState: () => ({
          version: 2,
          activeBoundary: 0,
          waterUpdates: [],
        }),
        captureSourcePartitionRuntimeSaveState: createEmptyPartitionState,
        captureSourcePlayerRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceRadarRuntimeSaveState: createEmptyRadarState,
        captureSourceSidesListRuntimeSaveState: () => createEmptySidesListState(),
        captureSourceTeamFactoryRuntimeSaveState: () => createEmptyTeamFactoryState(),
        captureSourceScriptEngineRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceInGameUiRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceGameLogicRuntimeSaveState: () => ({
          version: 10,
          nextId: 101,
          nextProjectileVisualId: 1,
          animationTime: 0,
          selectedEntityId: null,
          selectedEntityIds: [],
          scriptSelectionChangedFrame: 0,
          frameCounter: 42,
          controlBarDirtyFrame: 0,
          scriptObjectTopologyVersion: 0,
          scriptObjectCountChangedFrame: 0,
          defeatedSides: new Set<string>(),
          gameEndFrame: null,
          scriptEndGameTimerActive: false,
          objectTriggerAreaStates: [],
          spawnedEntities: [{
            id: 7,
            templateName: 'RuntimeTank',
            x: 10,
            y: 0,
            z: 20,
            rotationY: 1.25,
            producerEntityId: 33,
            poisonDamageAmount: 6.5,
            poisonNextDamageFrame: 70,
            poisonExpireFrame: 90,
            poisonDeathType: 'LASERED',
            poisonedBehaviorProfile: {
              poisonDamageIntervalFrames: 10,
              poisonDurationFrames: 120,
            },
            minefieldProfile: {
              stopsRegenAfterCreatorDies: true,
            },
            mineVirtualMinesRemaining: 2,
            mineNextDeathCheckFrame: 110,
            mineScootFramesLeft: 0,
            mineIgnoreDamage: true,
            mineRegenerates: false,
            mineDraining: true,
            mineImmunes: [
              { entityId: 11, collideFrame: 41 },
              { entityId: 12, collideFrame: 42 },
            ],
          } as unknown as import('@generals/game-logic').MapEntity],
        }),
        resolveSourceObjectModuleTypeByTag: (templateName, moduleTag) => {
          if (templateName !== 'RuntimeTank') {
            return null;
          }
          if (moduleTag === 'ModuleTag_Poisoned') {
            return 'POISONEDBEHAVIOR';
          }
          if (moduleTag === 'ModuleTag_Minefield') {
            return 'MINEFIELDBEHAVIOR';
          }
          return null;
        },
        captureBrowserRuntimeSaveState: () => ({ version: 1 }),
        getObjectIdCounter: () => 101,
      },
    });

    const firstObject = readFirstSourceGameLogicObjectState(saveFile.data);
    const poisonedModule = firstObject?.modules.find((module) => module.identifier === 'ModuleTag_Poisoned');
    const minefieldModule = firstObject?.modules.find((module) => module.identifier === 'ModuleTag_Minefield');

    expect(firstObject?.producerId).toBe(33);
    expect(poisonedModule).toBeDefined();
    expect(minefieldModule).toBeDefined();
    const poisoned = parseSourcePoisonedBehaviorBlockData(poisonedModule!.blockData);
    expect(poisoned.nextCallFrameAndPhase).toBe((70 << 2) | 2);
    expect(poisoned.poisonDamageFrame).toBe(70);
    expect(poisoned.poisonOverallStopFrame).toBe(90);
    expect(poisoned.poisonDamageAmount).toBeCloseTo(6.5, 6);
    expect(poisoned.deathType).toBe(SOURCE_DEATH_TYPE_LASERED);

    const minefield = parseSourceMinefieldBehaviorBlockData(minefieldModule!.blockData);
    expect(minefield.nextCallFrameAndPhase).toBe((43 << 2) | 2);
    expect(minefield.virtualMinesRemaining).toBe(2);
    expect(minefield.nextDeathCheckFrame).toBe(110);
    expect(minefield.scootFramesLeft).toBe(0);
    expect(minefield.scootVelocity).toEqual({ x: 1, y: 2, z: 3 });
    expect(minefield.scootAcceleration).toEqual({ x: 4, y: 5, z: 6 });
    expect(minefield.ignoreDamage).toBe(true);
    expect(minefield.regenerates).toBe(false);
    expect(minefield.draining).toBe(true);
    expect(minefield.immunes).toEqual([
      { objectId: 11, collideTime: 41 },
      { objectId: 12, collideTime: 42 },
      { objectId: 0, collideTime: 0 },
    ]);
  });

  it('rewrites source dynamic-geometry and smart-bomb update modules from live runtime state', () => {
    const preservedDynamicState: SourceDynamicGeometryInfoUpdateTestState = {
      nextCallFrameAndPhase: (80 << 2) | 2,
      startingDelayCountdown: 99,
      timeActive: 1,
      started: false,
      finished: false,
      reverseAtTransitionTime: true,
      direction: -1,
      switchedDirections: true,
      initialHeight: 1,
      initialMajorRadius: 2,
      initialMinorRadius: 3,
      finalHeight: 4,
      finalMajorRadius: 5,
      finalMinorRadius: 6,
    };
    const firestormParticleBytes = new Uint8Array(
      Array.from({ length: SOURCE_FIRESTORM_PARTICLE_IDS_BYTE_LENGTH }, (_, index) => (index * 5 + 3) & 0xff),
    );
    const sourceGameLogicBytes = createSourceGameLogicChunkData(false, [{
      identifier: 'ModuleTag_DynamicGeometry',
      blockData: createSourceDynamicGeometryInfoUpdateBlockData(preservedDynamicState),
    }, {
      identifier: 'ModuleTag_FirestormGeometry',
      blockData: createSourceFirestormDynamicGeometryInfoUpdateBlockData({
        dynamic: {
          ...preservedDynamicState,
          nextCallFrameAndPhase: (81 << 2) | 2,
          direction: 1,
        },
        particleSystemIdBytes: firestormParticleBytes,
        effectsFired: true,
        scorchPlaced: false,
        lastDamageFrame: 12,
      }),
    }, {
      identifier: 'ModuleTag_SmartBomb',
      blockData: createSourceSmartBombTargetHomingUpdateBlockData((82 << 2) | 2),
    }]);

    const saveFile = buildRuntimeSaveFile({
      description: 'source dynamic geometry rewrite',
      mapPath: 'Maps/RuntimeTank/RuntimeTank.map',
      mapData: {
        width: 1,
        height: 1,
        tiles: [0],
        objects: [],
        waypoints: [],
        namedAreas: [],
        namedPolygons: [],
        namedWaypointPaths: [],
        startPositions: [],
        meta: {
          name: 'RuntimeTank',
          players: 1,
          supplyDockCount: 0,
          oilDerrickCount: 0,
          techBuildingCount: 0,
        },
        blendTileCount: 0,
      },
      cameraState: null,
      passthroughBlocks: [{
        blockName: 'CHUNK_GameLogic',
        blockData: sourceGameLogicBytes.slice().buffer,
      }],
      gameLogic: {
        captureSourceTerrainLogicRuntimeSaveState: () => ({
          version: 2,
          activeBoundary: 0,
          waterUpdates: [],
        }),
        captureSourcePartitionRuntimeSaveState: createEmptyPartitionState,
        captureSourcePlayerRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceRadarRuntimeSaveState: createEmptyRadarState,
        captureSourceSidesListRuntimeSaveState: () => createEmptySidesListState(),
        captureSourceTeamFactoryRuntimeSaveState: () => createEmptyTeamFactoryState(),
        captureSourceScriptEngineRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceInGameUiRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceGameLogicRuntimeSaveState: () => ({
          version: 10,
          nextId: 101,
          nextProjectileVisualId: 1,
          animationTime: 0,
          selectedEntityId: null,
          selectedEntityIds: [],
          scriptSelectionChangedFrame: 0,
          frameCounter: 42,
          controlBarDirtyFrame: 0,
          scriptObjectTopologyVersion: 0,
          scriptObjectCountChangedFrame: 0,
          defeatedSides: new Set<string>(),
          gameEndFrame: null,
          scriptEndGameTimerActive: false,
          objectTriggerAreaStates: [],
          spawnedEntities: [{
            id: 7,
            templateName: 'RuntimeTank',
            x: 10,
            y: 0,
            z: 20,
            rotationY: 1.25,
            dynamicGeometryProfile: {
              initialDelayFrames: 3,
              initialHeight: 10,
              initialMajorRadius: 11,
              initialMinorRadius: 12,
              finalHeight: 20,
              finalMajorRadius: 21,
              finalMinorRadius: 22,
              transitionTimeFrames: 30,
              reverseAtTransitionTime: true,
            },
            dynamicGeometryState: {
              delayCountdown: 5,
              started: true,
              finished: false,
              timeActive: 7,
              initialHeight: 13,
              initialMajorRadius: 14,
              initialMinorRadius: 15,
              finalHeight: 23,
              finalMajorRadius: 24,
              finalMinorRadius: 25,
              reverseAtTransitionTime: false,
            },
            firestormDamageProfile: {
              damageAmount: 5,
              delayBetweenDamageFrames: 10,
              maxHeightForDamage: 30,
            },
            firestormDamageState: { lastDamageFrame: 66 },
            smartBombProfile: { courseCorrectionScalar: 0.99 },
            smartBombState: {
              targetReceived: true,
              targetX: 100,
              targetZ: 120,
            },
          } as unknown as import('@generals/game-logic').MapEntity],
        }),
        resolveSourceObjectModuleTypeByTag: (templateName, moduleTag) => {
          if (templateName !== 'RuntimeTank') {
            return null;
          }
          if (moduleTag === 'ModuleTag_DynamicGeometry') {
            return 'DYNAMICGEOMETRYINFOUPDATE';
          }
          if (moduleTag === 'ModuleTag_FirestormGeometry') {
            return 'FIRESTORMDYNAMICGEOMETRYINFOUPDATE';
          }
          if (moduleTag === 'ModuleTag_SmartBomb') {
            return 'SMARTBOMBTARGETHOMINGUPDATE';
          }
          return null;
        },
        captureBrowserRuntimeSaveState: () => ({ version: 1 }),
        getObjectIdCounter: () => 101,
      },
    });

    const firstObject = readFirstSourceGameLogicObjectState(saveFile.data);
    const dynamicModule = firstObject?.modules.find((module) => module.identifier === 'ModuleTag_DynamicGeometry');
    const firestormModule = firstObject?.modules.find((module) => module.identifier === 'ModuleTag_FirestormGeometry');
    const smartBombModule = firstObject?.modules.find((module) => module.identifier === 'ModuleTag_SmartBomb');

    expect(dynamicModule).toBeDefined();
    expect(firestormModule).toBeDefined();
    expect(smartBombModule).toBeDefined();
    const dynamic = parseSourceDynamicGeometryInfoUpdateBlockData(dynamicModule!.blockData);
    expect(dynamic.nextCallFrameAndPhase).toBe((43 << 2) | 2);
    expect(dynamic.startingDelayCountdown).toBe(5);
    expect(dynamic.timeActive).toBe(7);
    expect(dynamic.started).toBe(true);
    expect(dynamic.finished).toBe(false);
    expect(dynamic.reverseAtTransitionTime).toBe(false);
    expect(dynamic.direction).toBe(-1);
    expect(dynamic.switchedDirections).toBe(true);
    expect(dynamic.initialHeight).toBeCloseTo(13, 6);
    expect(dynamic.initialMajorRadius).toBeCloseTo(14, 6);
    expect(dynamic.initialMinorRadius).toBeCloseTo(15, 6);
    expect(dynamic.finalHeight).toBeCloseTo(23, 6);
    expect(dynamic.finalMajorRadius).toBeCloseTo(24, 6);
    expect(dynamic.finalMinorRadius).toBeCloseTo(25, 6);

    const firestorm = parseSourceFirestormDynamicGeometryInfoUpdateBlockData(firestormModule!.blockData);
    expect(firestorm.dynamic.nextCallFrameAndPhase).toBe((43 << 2) | 2);
    expect(firestorm.dynamic.timeActive).toBe(7);
    expect(firestorm.dynamic.direction).toBe(1);
    expect(Array.from(firestorm.particleSystemIdBytes)).toEqual(Array.from(firestormParticleBytes));
    expect(firestorm.effectsFired).toBe(true);
    expect(firestorm.scorchPlaced).toBe(false);
    expect(firestorm.lastDamageFrame).toBe(66);
    expect(parseSourceSmartBombTargetHomingUpdateBlockData(smartBombModule!.blockData)).toEqual({
      nextCallFrameAndPhase: (43 << 2) | 2,
    });
  });

  it('rewrites source ProductionUpdate modules from live runtime state', () => {
    const preservedDoorInfoBytes = new Uint8Array(
      Array.from({ length: SOURCE_PRODUCTION_DOOR_INFO_BYTE_LENGTH }, (_, index) => (index * 3 + 1) & 0xff),
    );
    const preservedClearFlags = ['DOOR_1_CLOSING'];
    const preservedSetFlags = ['ACTIVELY_CONSTRUCTING', 'DOOR_1_OPENING'];
    const sourceGameLogicBytes = createSourceGameLogicChunkData(false, [{
      identifier: 'ModuleTag_Production',
      blockData: createSourceProductionUpdateBlockData({
        nextCallFrameAndPhase: (84 << 2) | 2,
        queue: [{
          type: SOURCE_PRODUCTION_UNIT,
          name: 'AmericaRanger',
          productionId: 7,
          percentComplete: 10,
          framesUnderConstruction: 4,
          productionQuantityTotal: 1,
          productionQuantityProduced: 0,
          exitDoor: 2,
        }, {
          type: SOURCE_PRODUCTION_UPGRADE,
          name: 'Upgrade_AmericaRangerCaptureBuilding',
          productionId: 0,
          percentComplete: 5,
          framesUnderConstruction: 2,
          productionQuantityTotal: 0,
          productionQuantityProduced: 0,
          exitDoor: -1,
        }],
        uniqueId: 3,
        productionCount: 2,
        constructionCompleteFrame: 123,
        doorInfoBytes: preservedDoorInfoBytes,
        clearFlags: preservedClearFlags,
        setFlags: preservedSetFlags,
        flagsDirty: true,
      }),
    }]);

    const saveFile = buildRuntimeSaveFile({
      description: 'source production update rewrite',
      mapPath: 'Maps/RuntimeTank/RuntimeTank.map',
      mapData: {
        width: 1,
        height: 1,
        tiles: [0],
        objects: [],
        waypoints: [],
        namedAreas: [],
        namedPolygons: [],
        namedWaypointPaths: [],
        startPositions: [],
        meta: {
          name: 'RuntimeTank',
          players: 1,
          supplyDockCount: 0,
          oilDerrickCount: 0,
          techBuildingCount: 0,
        },
        blendTileCount: 0,
      },
      cameraState: null,
      passthroughBlocks: [{
        blockName: 'CHUNK_GameLogic',
        blockData: sourceGameLogicBytes.slice().buffer,
      }],
      gameLogic: {
        captureSourceTerrainLogicRuntimeSaveState: () => ({
          version: 2,
          activeBoundary: 0,
          waterUpdates: [],
        }),
        captureSourcePartitionRuntimeSaveState: createEmptyPartitionState,
        captureSourcePlayerRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceRadarRuntimeSaveState: createEmptyRadarState,
        captureSourceSidesListRuntimeSaveState: () => createEmptySidesListState(),
        captureSourceTeamFactoryRuntimeSaveState: () => createEmptyTeamFactoryState(),
        captureSourceScriptEngineRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceInGameUiRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceGameLogicRuntimeSaveState: () => ({
          version: 10,
          nextId: 101,
          nextProjectileVisualId: 1,
          animationTime: 0,
          selectedEntityId: null,
          selectedEntityIds: [],
          scriptSelectionChangedFrame: 0,
          frameCounter: 42,
          controlBarDirtyFrame: 0,
          scriptObjectTopologyVersion: 0,
          scriptObjectCountChangedFrame: 0,
          defeatedSides: new Set<string>(),
          gameEndFrame: null,
          scriptEndGameTimerActive: false,
          objectTriggerAreaStates: [],
          spawnedEntities: [{
            id: 7,
            templateName: 'RuntimeTank',
            x: 10,
            y: 0,
            z: 20,
            rotationY: 1.25,
            productionProfile: {
              maxQueueEntries: 9,
              quantityModifiers: [],
              numDoorAnimations: 1,
              doorOpeningTimeFrames: 15,
              constructionCompleteDurationFrames: 30,
            },
            productionNextId: 9,
            productionQueue: [{
              type: 'UNIT',
              templateName: 'AMERICARANGER',
              productionId: 7,
              buildCost: 225,
              totalProductionFrames: 80,
              framesUnderConstruction: 18.75,
              percentComplete: 37.5,
              productionQuantityTotal: 4,
              productionQuantityProduced: 1,
            }, {
              type: 'UPGRADE',
              upgradeName: 'UPGRADE_AMERICARANGERCAPTUREBUILDING',
              productionId: 0,
              buildCost: 1000,
              totalProductionFrames: 60,
              framesUnderConstruction: 30,
              percentComplete: 50,
              upgradeType: 'PLAYER',
            }],
          } as unknown as import('@generals/game-logic').MapEntity],
        }),
        resolveSourceObjectModuleTypeByTag: (templateName, moduleTag) =>
          templateName === 'RuntimeTank' && moduleTag === 'ModuleTag_Production'
            ? 'PRODUCTIONUPDATE'
            : null,
        captureBrowserRuntimeSaveState: () => ({ version: 1 }),
        getObjectIdCounter: () => 101,
      },
    });

    const firstObject = readFirstSourceGameLogicObjectState(saveFile.data);
    const productionModule = firstObject?.modules.find((module) => module.identifier === 'ModuleTag_Production');

    expect(productionModule).toBeDefined();
    const parsed = parseSourceProductionUpdateBlockData(productionModule!.blockData);
    expect(parsed.nextCallFrameAndPhase).toBe((43 << 2) | 2);
    expect(parsed.queue).toEqual([{
      type: SOURCE_PRODUCTION_UNIT,
      name: 'AmericaRanger',
      productionId: 7,
      percentComplete: 37.5,
      framesUnderConstruction: 18,
      productionQuantityTotal: 4,
      productionQuantityProduced: 1,
      exitDoor: 2,
    }, {
      type: SOURCE_PRODUCTION_UPGRADE,
      name: 'Upgrade_AmericaRangerCaptureBuilding',
      productionId: 0,
      percentComplete: 50,
      framesUnderConstruction: 30,
      productionQuantityTotal: 0,
      productionQuantityProduced: 0,
      exitDoor: -1,
    }]);
    expect(parsed.uniqueId).toBe(9);
    expect(parsed.productionCount).toBe(2);
    expect(parsed.constructionCompleteFrame).toBe(123);
    expect(Array.from(parsed.doorInfoBytes)).toEqual(Array.from(preservedDoorInfoBytes));
    expect(parsed.clearFlags).toEqual(preservedClearFlags);
    expect(parsed.setFlags).toEqual(preservedSetFlags);
    expect(parsed.flagsDirty).toBe(true);
  });

  it('rewrites source body modules from live runtime state', () => {
    const preservedBody = {
      ...createDefaultSourceActiveBodyTestState(),
      damageScalar: 0.8,
      currentHealth: 175,
      currentSubdualDamage: 5,
      prevHealth: 180,
      maxHealth: 300,
      initialHealth: 300,
      curDamageState: 0,
      nextDamageFXTime: 777,
      lastDamageFXDone: 6,
      lastDamageInfo: {
        input: {
          sourceId: 4,
          sourcePlayerMaskBytes: new Uint8Array([0x34, 0x12]),
          damageType: 3,
          damageFxOverride: SOURCE_DAMAGE_TYPE_UNRESISTABLE,
          deathType: 4,
          amount: 99,
          kill: false,
          damageStatusType: 12,
          shockWaveVector: { x: 1, y: 2, z: 3 },
          shockWaveAmount: 4,
          shockWaveRadius: 5,
          shockWaveTaperOff: 6,
          sourceTemplateName: 'OldSource',
        },
        output: {
          actualDamageDealt: 33,
          actualDamageClipped: 22,
          noEffect: false,
        },
      },
      lastDamageTimestamp: 88,
      lastHealingTimestamp: 99,
      frontCrushed: false,
      backCrushed: true,
      lastDamageCleared: true,
      indestructible: false,
      particleSystemIds: [15, 16],
      armorSetFlags: ['ELITE', 'PLAYER_UPGRADE'],
    };
    const sourceGameLogicBytes = createSourceGameLogicChunkData(false, [{
      identifier: 'ModuleTag_Body',
      blockData: createSourceStructureBodyBlockData(preservedBody, 21),
    }]);

    const saveFile = buildRuntimeSaveFile({
      description: 'source body module rewrite',
      mapPath: 'Maps/RuntimeTank/RuntimeTank.map',
      mapData: {
        width: 1,
        height: 1,
        tiles: [0],
        objects: [],
        waypoints: [],
        namedAreas: [],
        namedPolygons: [],
        namedWaypointPaths: [],
        startPositions: [],
        meta: {
          name: 'RuntimeTank',
          players: 1,
          supplyDockCount: 0,
          oilDerrickCount: 0,
          techBuildingCount: 0,
        },
        blendTileCount: 0,
      },
      cameraState: null,
      passthroughBlocks: [{
        blockName: 'CHUNK_GameLogic',
        blockData: sourceGameLogicBytes.slice().buffer,
      }],
      gameLogic: {
        captureSourceTerrainLogicRuntimeSaveState: () => ({
          version: 2,
          activeBoundary: 0,
          waterUpdates: [],
        }),
        captureSourcePartitionRuntimeSaveState: createEmptyPartitionState,
        captureSourcePlayerRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceRadarRuntimeSaveState: createEmptyRadarState,
        captureSourceSidesListRuntimeSaveState: () => createEmptySidesListState(),
        captureSourceTeamFactoryRuntimeSaveState: () => createEmptyTeamFactoryState(),
        captureSourceScriptEngineRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceInGameUiRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceGameLogicRuntimeSaveState: () => ({
          version: 10,
          nextId: 101,
          nextProjectileVisualId: 1,
          animationTime: 0,
          selectedEntityId: null,
          selectedEntityIds: [],
          scriptSelectionChangedFrame: 0,
          frameCounter: 42,
          controlBarDirtyFrame: 0,
          scriptObjectTopologyVersion: 0,
          scriptObjectCountChangedFrame: 0,
          defeatedSides: new Set<string>(),
          gameEndFrame: null,
          scriptEndGameTimerActive: false,
          objectTriggerAreaStates: [],
          spawnedEntities: [{
            id: 7,
            templateName: 'RuntimeTank',
            x: 10,
            y: 0,
            z: 20,
            rotationY: 1.25,
            health: 45,
            maxHealth: 200,
            initialHealth: 250,
            currentSubdualDamage: 60,
            battlePlanDamageScalar: 0.5,
            frontCrushed: true,
            backCrushed: false,
            isIndestructible: true,
            armorSetFlagsMask: (1 << 0) | (1 << 5) | (1 << 7),
            builderId: 33,
            lastDamageFrame: 41,
            lastDamageInfoFrame: 40,
            scriptLastDamageSourceEntityId: 9,
            scriptLastDamageSourceTemplateName: 'GLATechnical',
            lastDamageNoEffect: true,
          } as unknown as import('@generals/game-logic').MapEntity],
        }),
        resolveSourceObjectModuleTypeByTag: (templateName, moduleTag) =>
          templateName === 'RuntimeTank' && moduleTag === 'ModuleTag_Body'
            ? 'STRUCTUREBODY'
            : null,
        captureBrowserRuntimeSaveState: () => ({ version: 1 }),
        getObjectIdCounter: () => 101,
      },
    });

    const firstObject = readFirstSourceGameLogicObjectState(saveFile.data);
    const bodyModule = firstObject?.modules.find((module) => module.identifier === 'ModuleTag_Body');

    expect(bodyModule).toBeDefined();
    const parsed = parseSourceStructureBodyBlockData(bodyModule!.blockData);
    expect(parsed.constructorObjectId).toBe(33);
    expect(parsed.active.damageScalar).toBeCloseTo(0.5, 6);
    expect(parsed.active.currentHealth).toBeCloseTo(45, 6);
    expect(parsed.active.currentSubdualDamage).toBeCloseTo(60, 6);
    expect(parsed.active.prevHealth).toBeCloseTo(45, 6);
    expect(parsed.active.maxHealth).toBeCloseTo(200, 6);
    expect(parsed.active.initialHealth).toBeCloseTo(250, 6);
    expect(parsed.active.curDamageState).toBe(1);
    expect(parsed.active.nextDamageFXTime).toBe(777);
    expect(parsed.active.lastDamageFXDone).toBe(6);
    expect(parsed.active.lastDamageInfo.input.sourceId).toBe(9);
    expect(parsed.active.lastDamageInfo.input.sourceTemplateName).toBe('GLATechnical');
    expect(Array.from(parsed.active.lastDamageInfo.input.sourcePlayerMaskBytes)).toEqual([0x34, 0x12]);
    expect(parsed.active.lastDamageInfo.input.damageType).toBe(3);
    expect(parsed.active.lastDamageInfo.output.actualDamageDealt).toBeCloseTo(33, 6);
    expect(parsed.active.lastDamageInfo.output.actualDamageClipped).toBeCloseTo(22, 6);
    expect(parsed.active.lastDamageInfo.output.noEffect).toBe(true);
    expect(parsed.active.lastDamageTimestamp).toBe(41);
    expect(parsed.active.lastHealingTimestamp).toBe(99);
    expect(parsed.active.frontCrushed).toBe(true);
    expect(parsed.active.backCrushed).toBe(false);
    expect(parsed.active.lastDamageCleared).toBe(true);
    expect(parsed.active.indestructible).toBe(true);
    expect(parsed.active.particleSystemIds).toEqual([15, 16]);
    expect(parsed.active.armorSetFlags).toEqual(['VETERAN', 'SECOND_LIFE', 'CRATE_UPGRADE_TWO']);
  });

  it('rewrites source SpecialPowerModule state from live runtime module tags', () => {
    const sourceGameLogicBytes = createSourceGameLogicChunkData(false, [{
      identifier: 'ModuleTag_CargoDrop',
      blockData: createSourceSpecialPowerModuleBlockData({
        availableOnFrame: 100,
        pausedCount: 0,
        pausedOnFrame: 0,
        pausedPercent: 0.25,
      }),
    }]);

    const saveFile = buildRuntimeSaveFile({
      description: 'source special power module rewrite',
      mapPath: 'Maps/RuntimeTank/RuntimeTank.map',
      mapData: {
        width: 1,
        height: 1,
        tiles: [0],
        objects: [],
        waypoints: [],
        namedAreas: [],
        namedPolygons: [],
        namedWaypointPaths: [],
        startPositions: [],
        meta: {
          name: 'RuntimeTank',
          players: 1,
          supplyDockCount: 0,
          oilDerrickCount: 0,
          techBuildingCount: 0,
        },
        blendTileCount: 0,
      },
      cameraState: null,
      passthroughBlocks: [{
        blockName: 'CHUNK_GameLogic',
        blockData: sourceGameLogicBytes.slice().buffer,
      }],
      gameLogic: {
        captureSourceTerrainLogicRuntimeSaveState: () => ({
          version: 2,
          activeBoundary: 0,
          waterUpdates: [],
        }),
        captureSourcePartitionRuntimeSaveState: createEmptyPartitionState,
        captureSourcePlayerRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceRadarRuntimeSaveState: createEmptyRadarState,
        captureSourceSidesListRuntimeSaveState: () => createEmptySidesListState(),
        captureSourceTeamFactoryRuntimeSaveState: () => createEmptyTeamFactoryState(),
        captureSourceScriptEngineRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceInGameUiRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceGameLogicRuntimeSaveState: () => ({
          version: 10,
          nextId: 101,
          nextProjectileVisualId: 1,
          animationTime: 0,
          selectedEntityId: null,
          selectedEntityIds: [],
          scriptSelectionChangedFrame: 0,
          frameCounter: 42,
          controlBarDirtyFrame: 0,
          scriptObjectTopologyVersion: 0,
          scriptObjectCountChangedFrame: 0,
          defeatedSides: new Set<string>(),
          gameEndFrame: null,
          scriptEndGameTimerActive: false,
          objectTriggerAreaStates: [],
          spawnedEntities: [{
            id: 7,
            templateName: 'RuntimeTank',
            specialPowerModules: new Map([
              ['SPECIAL_WRONG_OCL', {
                specialPowerTemplateName: 'SPECIAL_WRONG_OCL',
                moduleType: 'OCLSPECIALPOWER',
                moduleTag: 'MODULETAG_OTHER',
                availableOnFrame: 999,
                pausedCount: 9,
                pausedOnFrame: 999,
                pausedPercent: 0.99,
              }],
              ['SPECIAL_CARGO_DROP', {
                specialPowerTemplateName: 'SPECIAL_CARGO_DROP',
                moduleType: 'OCLSPECIALPOWER',
                moduleTag: 'MODULETAG_CARGODROP',
                availableOnFrame: 321,
                pausedCount: 2,
                pausedOnFrame: 123,
                pausedPercent: 0.75,
              }],
            ]),
          } as unknown as import('@generals/game-logic').MapEntity],
        }),
        resolveSourceObjectModuleTypeByTag: (templateName, moduleTag) =>
          templateName === 'RuntimeTank' && moduleTag === 'ModuleTag_CargoDrop'
            ? 'OCLSPECIALPOWER'
            : null,
        captureBrowserRuntimeSaveState: () => ({ version: 1 }),
        getObjectIdCounter: () => 101,
      },
    });

    const firstObject = readFirstSourceGameLogicObjectState(saveFile.data);
    const specialPowerModule = firstObject?.modules.find((module) => module.identifier === 'ModuleTag_CargoDrop');

    expect(specialPowerModule).toBeDefined();
    expect(parseSourceSpecialPowerModuleBlockData(specialPowerModule!.blockData)).toEqual({
      availableOnFrame: 321,
      pausedCount: 2,
      pausedOnFrame: 123,
      pausedPercent: 0.75,
    });
  });

  it('rewrites source TransportContain passenger lists from live containment state', () => {
    const preservedOpen = createDefaultSourceOpenContainTestState();
    const sourceGameLogicBytes = createSourceGameLogicChunkData(false, [{
      identifier: 'ModuleTag_Contain',
      blockData: createSourceTransportContainBlockData({
        open: {
          ...preservedOpen,
          passengerIds: [40],
          passengerAllowedToFire: false,
        },
        payloadCreated: false,
        extraSlotsInUse: 6,
        frameExitNotBusy: 77,
      }),
    }]);

    const saveFile = buildRuntimeSaveFile({
      description: 'source transport contain rewrite',
      mapPath: 'Maps/RuntimeTank/RuntimeTank.map',
      mapData: {
        width: 1,
        height: 1,
        tiles: [0],
        objects: [],
        waypoints: [],
        namedAreas: [],
        namedPolygons: [],
        namedWaypointPaths: [],
        startPositions: [],
        meta: {
          name: 'RuntimeTank',
          players: 1,
          supplyDockCount: 0,
          oilDerrickCount: 0,
          techBuildingCount: 0,
        },
        blendTileCount: 0,
      },
      cameraState: null,
      passthroughBlocks: [{
        blockName: 'CHUNK_GameLogic',
        blockData: sourceGameLogicBytes.slice().buffer,
      }],
      gameLogic: {
        captureSourceTerrainLogicRuntimeSaveState: () => ({
          version: 2,
          activeBoundary: 0,
          waterUpdates: [],
        }),
        captureSourcePartitionRuntimeSaveState: createEmptyPartitionState,
        captureSourcePlayerRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceRadarRuntimeSaveState: createEmptyRadarState,
        captureSourceSidesListRuntimeSaveState: () => createEmptySidesListState(),
        captureSourceTeamFactoryRuntimeSaveState: () => createEmptyTeamFactoryState(),
        captureSourceScriptEngineRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceInGameUiRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceGameLogicRuntimeSaveState: () => ({
          version: 10,
          nextId: 101,
          nextProjectileVisualId: 1,
          animationTime: 0,
          selectedEntityId: null,
          selectedEntityIds: [],
          scriptSelectionChangedFrame: 0,
          frameCounter: 42,
          controlBarDirtyFrame: 0,
          scriptObjectTopologyVersion: 0,
          scriptObjectCountChangedFrame: 0,
          defeatedSides: new Set<string>(),
          gameEndFrame: null,
          scriptEndGameTimerActive: false,
          objectTriggerAreaStates: [],
          spawnedEntities: [
            {
              id: 7,
              templateName: 'RuntimeTank',
              initialPayloadCreated: true,
              containProfile: {
                moduleType: 'TRANSPORT',
                passengersAllowedToFire: true,
              },
            },
            {
              id: 10,
              templateName: 'PassengerA',
              transportContainerId: 7,
            },
            {
              id: 8,
              templateName: 'PassengerB',
              transportContainerId: 7,
            },
            {
              id: 9,
              templateName: 'OtherPassenger',
              transportContainerId: 99,
            },
          ] as unknown as import('@generals/game-logic').MapEntity[],
        }),
        resolveSourceObjectModuleTypeByTag: (templateName, moduleTag) =>
          templateName === 'RuntimeTank' && moduleTag === 'ModuleTag_Contain'
            ? 'TRANSPORTCONTAIN'
            : null,
        captureBrowserRuntimeSaveState: () => ({ version: 1 }),
        getObjectIdCounter: () => 101,
      },
    });

    const firstObject = readFirstSourceGameLogicObjectState(saveFile.data);
    const containModule = firstObject?.modules.find((module) => module.identifier === 'ModuleTag_Contain');

    expect(containModule).toBeDefined();
    const parsed = parseSourceTransportContainBlockData(containModule!.blockData);
    expect(parsed.open.passengerIds).toEqual([8, 10]);
    expect(parsed.open.passengerAllowedToFire).toBe(true);
    expect(Array.from(parsed.open.playerEnteredMaskBytes)).toEqual([0x34, 0x12]);
    expect(parsed.open.lastUnloadSoundFrame).toBe(11);
    expect(parsed.open.lastLoadSoundFrame).toBe(12);
    expect(parsed.open.stealthUnitsContained).toBe(3);
    expect(parsed.open.doorCloseCountdown).toBe(4);
    expect(parsed.open.conditionState).toEqual(['LOADED']);
    expect(Array.from(parsed.open.firePointsBytes)).toEqual(Array.from(preservedOpen.firePointsBytes));
    expect(parsed.open.enterExitEntries).toEqual([{ objectId: 44, type: 1 }]);
    expect(parsed.payloadCreated).toBe(true);
    expect(parsed.extraSlotsInUse).toBe(6);
    expect(parsed.frameExitNotBusy).toBe(77);
  });

  it('rewrites source BattlePlanUpdate modules from live runtime state', () => {
    const sourceGameLogicBytes = createSourceGameLogicChunkData(false, [{
      identifier: 'ModuleTag_BattlePlan',
      blockData: createSourceBattlePlanUpdateBlockData({
        nextCallFrameAndPhase: (84 << 2) | 2,
        currentPlan: SOURCE_BATTLE_PLAN_BOMBARDMENT,
        desiredPlan: SOURCE_BATTLE_PLAN_SEARCH_AND_DESTROY,
        planAffectingArmy: SOURCE_BATTLE_PLAN_BOMBARDMENT,
        status: SOURCE_BATTLE_PLAN_STATUS_ACTIVE,
        nextReadyFrame: 44,
        invalidSettings: false,
        centeringTurret: true,
        armorScalar: 1,
        bombardment: 1,
        searchAndDestroy: 0,
        holdTheLine: 0,
        sightRangeScalar: 1,
        validKindOf: ['STRUCTURE'],
        invalidKindOf: [],
        visionObjectId: 1234,
      }),
    }]);

    const saveFile = buildRuntimeSaveFile({
      description: 'source battle plan update rewrite',
      mapPath: 'Maps/RuntimeTank/RuntimeTank.map',
      mapData: {
        width: 1,
        height: 1,
        tiles: [0],
        objects: [],
        waypoints: [],
        namedAreas: [],
        namedPolygons: [],
        namedWaypointPaths: [],
        startPositions: [],
        meta: {
          name: 'RuntimeTank',
          players: 1,
          supplyDockCount: 0,
          oilDerrickCount: 0,
          techBuildingCount: 0,
        },
        blendTileCount: 0,
      },
      cameraState: null,
      passthroughBlocks: [{
        blockName: 'CHUNK_GameLogic',
        blockData: sourceGameLogicBytes.slice().buffer,
      }],
      gameLogic: {
        captureSourceTerrainLogicRuntimeSaveState: () => ({
          version: 2,
          activeBoundary: 0,
          waterUpdates: [],
        }),
        captureSourcePartitionRuntimeSaveState: createEmptyPartitionState,
        captureSourcePlayerRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceRadarRuntimeSaveState: createEmptyRadarState,
        captureSourceSidesListRuntimeSaveState: () => createEmptySidesListState(),
        captureSourceTeamFactoryRuntimeSaveState: () => createEmptyTeamFactoryState(),
        captureSourceScriptEngineRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceInGameUiRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceGameLogicRuntimeSaveState: () => ({
          version: 10,
          nextId: 101,
          nextProjectileVisualId: 1,
          animationTime: 0,
          selectedEntityId: null,
          selectedEntityIds: [],
          scriptSelectionChangedFrame: 0,
          frameCounter: 42,
          controlBarDirtyFrame: 0,
          scriptObjectTopologyVersion: 0,
          scriptObjectCountChangedFrame: 0,
          defeatedSides: new Set<string>(),
          gameEndFrame: null,
          scriptEndGameTimerActive: false,
          objectTriggerAreaStates: [],
          spawnedEntities: [{
            id: 7,
            templateName: 'RuntimeTank',
            x: 10,
            y: 0,
            z: 20,
            rotationY: 1.25,
            battlePlanProfile: {
              specialPowerTemplateName: 'SPECIALPOWERCHANGEBATTLEPLANS',
              bombardmentAnimationFrames: 12,
              holdTheLineAnimationFrames: 13,
              searchAndDestroyAnimationFrames: 14,
              transitionIdleFrames: 15,
              battlePlanParalyzeFrames: 16,
              holdTheLineArmorDamageScalar: 0.5,
              searchAndDestroySightRangeScalar: 1.75,
              strategyCenterSearchAndDestroySightRangeScalar: 1.25,
              strategyCenterSearchAndDestroyDetectsStealth: true,
              strategyCenterHoldTheLineMaxHealthScalar: 1.5,
              validMemberKindOf: new Set(['VEHICLE', 'INFANTRY']),
              invalidMemberKindOf: new Set(['DRONE']),
            },
            battlePlanState: {
              desiredPlan: 'HOLDTHELINE',
              activePlan: 'NONE',
              currentPlan: 'BOMBARDMENT',
              transitionStatus: 'PACKING',
              transitionFinishFrame: 88,
              idleCooldownFinishFrame: 0,
            },
          } as unknown as import('@generals/game-logic').MapEntity],
        }),
        resolveSourceObjectModuleTypeByTag: (templateName, moduleTag) =>
          templateName === 'RuntimeTank' && moduleTag === 'ModuleTag_BattlePlan'
            ? 'BATTLEPLANUPDATE'
            : null,
        captureBrowserRuntimeSaveState: () => ({ version: 1 }),
        getObjectIdCounter: () => 101,
      },
    });

    const firstObject = readFirstSourceGameLogicObjectState(saveFile.data);
    const battlePlanModule = firstObject?.modules.find((module) => module.identifier === 'ModuleTag_BattlePlan');

    expect(battlePlanModule).toBeDefined();
    const parsed = parseSourceBattlePlanUpdateBlockData(battlePlanModule!.blockData);
    expect(parsed.nextCallFrameAndPhase).toBe((43 << 2) | 2);
    expect(parsed.currentPlan).toBe(SOURCE_BATTLE_PLAN_BOMBARDMENT);
    expect(parsed.desiredPlan).toBe(SOURCE_BATTLE_PLAN_HOLD_THE_LINE);
    expect(parsed.planAffectingArmy).toBe(SOURCE_BATTLE_PLAN_NONE);
    expect(parsed.status).toBe(SOURCE_BATTLE_PLAN_STATUS_PACKING);
    expect(parsed.nextReadyFrame).toBe(88);
    expect(parsed.invalidSettings).toBe(false);
    expect(parsed.centeringTurret).toBe(true);
    expect(parsed.armorScalar).toBe(1);
    expect(parsed.bombardment).toBe(0);
    expect(parsed.searchAndDestroy).toBe(0);
    expect(parsed.holdTheLine).toBe(0);
    expect(parsed.sightRangeScalar).toBe(1);
    expect(parsed.validKindOf).toEqual(['INFANTRY', 'VEHICLE']);
    expect(parsed.invalidKindOf).toEqual(['DRONE']);
    expect(parsed.visionObjectId).toBe(1234);
  });

  it('rewrites source SlavedUpdate modules from live runtime state', () => {
    const sourceGameLogicBytes = createSourceGameLogicChunkData(false, [{
      identifier: 'ModuleTag_Slaved',
      blockData: createSourceSlavedUpdateBlockData({
        nextCallFrameAndPhase: (84 << 2) | 2,
        slaver: 12,
        guardPointOffset: { x: 1, y: 2, z: 5 },
        framesToWait: 4,
        repairState: 4,
        repairing: true,
      }),
    }]);

    const saveFile = buildRuntimeSaveFile({
      description: 'source slaved update rewrite',
      mapPath: 'Maps/RuntimeTank/RuntimeTank.map',
      mapData: {
        width: 1,
        height: 1,
        tiles: [0],
        objects: [],
        waypoints: [],
        namedAreas: [],
        namedPolygons: [],
        namedWaypointPaths: [],
        startPositions: [],
        meta: {
          name: 'RuntimeTank',
          players: 1,
          supplyDockCount: 0,
          oilDerrickCount: 0,
          techBuildingCount: 0,
        },
        blendTileCount: 0,
      },
      cameraState: null,
      passthroughBlocks: [{
        blockName: 'CHUNK_GameLogic',
        blockData: sourceGameLogicBytes.slice().buffer,
      }],
      gameLogic: {
        captureSourceTerrainLogicRuntimeSaveState: () => ({
          version: 2,
          activeBoundary: 0,
          waterUpdates: [],
        }),
        captureSourcePartitionRuntimeSaveState: createEmptyPartitionState,
        captureSourcePlayerRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceRadarRuntimeSaveState: createEmptyRadarState,
        captureSourceSidesListRuntimeSaveState: () => createEmptySidesListState(),
        captureSourceTeamFactoryRuntimeSaveState: () => createEmptyTeamFactoryState(),
        captureSourceScriptEngineRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceInGameUiRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceGameLogicRuntimeSaveState: () => ({
          version: 10,
          nextId: 101,
          nextProjectileVisualId: 1,
          animationTime: 0,
          selectedEntityId: null,
          selectedEntityIds: [],
          scriptSelectionChangedFrame: 0,
          frameCounter: 42,
          controlBarDirtyFrame: 0,
          scriptObjectTopologyVersion: 0,
          scriptObjectCountChangedFrame: 0,
          defeatedSides: new Set<string>(),
          gameEndFrame: null,
          scriptEndGameTimerActive: false,
          objectTriggerAreaStates: [],
          spawnedEntities: [{
            id: 7,
            templateName: 'RuntimeTank',
            x: 10,
            y: 0,
            z: 20,
            rotationY: 1.25,
            slaverEntityId: 88,
            slavedUpdateProfile: { guardMaxRange: 30 },
            slaveGuardOffsetX: 3.5,
            slaveGuardOffsetZ: -4.5,
            slavedNextUpdateFrame: 50,
          } as unknown as import('@generals/game-logic').MapEntity],
        }),
        resolveSourceObjectModuleTypeByTag: (templateName, moduleTag) =>
          templateName === 'RuntimeTank' && moduleTag === 'ModuleTag_Slaved'
            ? 'SLAVEDUPDATE'
            : null,
        captureBrowserRuntimeSaveState: () => ({ version: 1 }),
        getObjectIdCounter: () => 101,
      },
    });

    const firstObject = readFirstSourceGameLogicObjectState(saveFile.data);
    const slavedModule = firstObject?.modules.find((module) => module.identifier === 'ModuleTag_Slaved');

    expect(slavedModule).toBeDefined();
    const parsed = parseSourceSlavedUpdateBlockData(slavedModule!.blockData);
    expect(parsed.nextCallFrameAndPhase).toBe((43 << 2) | 2);
    expect(parsed.slaver).toBe(88);
    expect(parsed.guardPointOffset).toEqual({ x: 3.5, y: -4.5, z: 5 });
    expect(parsed.framesToWait).toBe(8);
    expect(parsed.repairState).toBe(4);
    expect(parsed.repairing).toBe(true);
  });

  it('rewrites source MobMemberSlavedUpdate modules from live runtime state', () => {
    const sourceGameLogicBytes = createSourceGameLogicChunkData(false, [{
      identifier: 'ModuleTag_MobSlaved',
      blockData: createSourceMobMemberSlavedUpdateBlockData({
        nextCallFrameAndPhase: (84 << 2) | 2,
        slaver: 12,
        framesToWait: 4,
        mobState: 1,
        personalColor: { red: 0.1, green: 0.2, blue: 0.3 },
        primaryVictimId: 33,
        squirrellinessRatio: 0.25,
        isSelfTasking: false,
        catchUpCrisisTimer: 5,
      }),
    }]);

    const saveFile = buildRuntimeSaveFile({
      description: 'source mob member slaved rewrite',
      mapPath: 'Maps/RuntimeTank/RuntimeTank.map',
      mapData: {
        width: 1,
        height: 1,
        tiles: [0],
        objects: [],
        waypoints: [],
        namedAreas: [],
        namedPolygons: [],
        namedWaypointPaths: [],
        startPositions: [],
        meta: {
          name: 'RuntimeTank',
          players: 1,
          supplyDockCount: 0,
          oilDerrickCount: 0,
          techBuildingCount: 0,
        },
        blendTileCount: 0,
      },
      cameraState: null,
      passthroughBlocks: [{
        blockName: 'CHUNK_GameLogic',
        blockData: sourceGameLogicBytes.slice().buffer,
      }],
      gameLogic: {
        captureSourceTerrainLogicRuntimeSaveState: () => ({
          version: 2,
          activeBoundary: 0,
          waterUpdates: [],
        }),
        captureSourcePartitionRuntimeSaveState: createEmptyPartitionState,
        captureSourcePlayerRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceRadarRuntimeSaveState: createEmptyRadarState,
        captureSourceSidesListRuntimeSaveState: () => createEmptySidesListState(),
        captureSourceTeamFactoryRuntimeSaveState: () => createEmptyTeamFactoryState(),
        captureSourceScriptEngineRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceInGameUiRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceGameLogicRuntimeSaveState: () => ({
          version: 10,
          nextId: 101,
          nextProjectileVisualId: 1,
          animationTime: 0,
          selectedEntityId: null,
          selectedEntityIds: [],
          scriptSelectionChangedFrame: 0,
          frameCounter: 42,
          controlBarDirtyFrame: 0,
          scriptObjectTopologyVersion: 0,
          scriptObjectCountChangedFrame: 0,
          defeatedSides: new Set<string>(),
          gameEndFrame: null,
          scriptEndGameTimerActive: false,
          objectTriggerAreaStates: [],
          spawnedEntities: [{
            id: 7,
            templateName: 'RuntimeTank',
            x: 10,
            y: 0,
            z: 20,
            rotationY: 1.25,
            slaverEntityId: 88,
            mobMemberProfile: {
              mustCatchUpRadius: 80,
              noNeedToCatchUpRadius: 30,
              squirrellinessRatio: 0.625,
              catchUpCrisisBailTime: 20,
            },
            mobMemberState: {
              framesToWait: 11,
              catchUpCrisisTimer: 7,
              primaryVictimId: 99,
              isSelfTasking: true,
              mobState: 2,
            },
          } as unknown as import('@generals/game-logic').MapEntity],
        }),
        resolveSourceObjectModuleTypeByTag: (templateName, moduleTag) =>
          templateName === 'RuntimeTank' && moduleTag === 'ModuleTag_MobSlaved'
            ? 'MOBMEMBERSLAVEDUPDATE'
            : null,
        captureBrowserRuntimeSaveState: () => ({ version: 1 }),
        getObjectIdCounter: () => 101,
      },
    });

    const firstObject = readFirstSourceGameLogicObjectState(saveFile.data);
    const mobModule = firstObject?.modules.find((module) => module.identifier === 'ModuleTag_MobSlaved');

    expect(mobModule).toBeDefined();
    const parsed = parseSourceMobMemberSlavedUpdateBlockData(mobModule!.blockData);
    expect(parsed.nextCallFrameAndPhase).toBe((43 << 2) | 2);
    expect(parsed.slaver).toBe(88);
    expect(parsed.framesToWait).toBe(11);
    expect(parsed.mobState).toBe(2);
    expect(parsed.personalColor.red).toBeCloseTo(0.1, 6);
    expect(parsed.personalColor.green).toBeCloseTo(0.2, 6);
    expect(parsed.personalColor.blue).toBeCloseTo(0.3, 6);
    expect(parsed.primaryVictimId).toBe(99);
    expect(parsed.squirrellinessRatio).toBeCloseTo(0.625, 6);
    expect(parsed.isSelfTasking).toBe(true);
    expect(parsed.catchUpCrisisTimer).toBe(7);
  });

  it('rewrites source FloatUpdate modules from live runtime state', () => {
    const sourceGameLogicBytes = createSourceGameLogicChunkData(false, [{
      identifier: 'ModuleTag_Float',
      blockData: createSourceFloatUpdateBlockData((84 << 2) | 2, false),
    }]);

    const saveFile = buildRuntimeSaveFile({
      description: 'source float update rewrite',
      mapPath: 'Maps/RuntimeTank/RuntimeTank.map',
      mapData: {
        width: 1,
        height: 1,
        tiles: [0],
        objects: [],
        waypoints: [],
        namedAreas: [],
        namedPolygons: [],
        namedWaypointPaths: [],
        startPositions: [],
        meta: {
          name: 'RuntimeTank',
          players: 1,
          supplyDockCount: 0,
          oilDerrickCount: 0,
          techBuildingCount: 0,
        },
        blendTileCount: 0,
      },
      cameraState: null,
      passthroughBlocks: [{
        blockName: 'CHUNK_GameLogic',
        blockData: sourceGameLogicBytes.slice().buffer,
      }],
      gameLogic: {
        captureSourceTerrainLogicRuntimeSaveState: () => ({
          version: 2,
          activeBoundary: 0,
          waterUpdates: [],
        }),
        captureSourcePartitionRuntimeSaveState: createEmptyPartitionState,
        captureSourcePlayerRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceRadarRuntimeSaveState: createEmptyRadarState,
        captureSourceSidesListRuntimeSaveState: () => createEmptySidesListState(),
        captureSourceTeamFactoryRuntimeSaveState: () => createEmptyTeamFactoryState(),
        captureSourceScriptEngineRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceInGameUiRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceGameLogicRuntimeSaveState: () => ({
          version: 10,
          nextId: 8,
          nextProjectileVisualId: 1,
          animationTime: 0,
          selectedEntityId: null,
          selectedEntityIds: [],
          scriptSelectionChangedFrame: 0,
          frameCounter: 42,
          controlBarDirtyFrame: 0,
          scriptObjectTopologyVersion: 0,
          scriptObjectCountChangedFrame: 0,
          defeatedSides: new Set<string>(),
          gameEndFrame: null,
          scriptEndGameTimerActive: false,
          objectTriggerAreaStates: [],
          spawnedEntities: [{
            id: 7,
            templateName: 'RuntimeTank',
            x: 10,
            y: 0,
            z: 20,
            rotationY: 1.25,
            floatUpdateProfile: {
              enabled: true,
            },
          } as unknown as import('@generals/game-logic').MapEntity],
        }),
        resolveSourceObjectModuleTypeByTag: (templateName, moduleTag) =>
          templateName === 'RuntimeTank' && moduleTag === 'ModuleTag_Float'
            ? 'FLOATUPDATE'
            : null,
        captureBrowserRuntimeSaveState: () => ({ version: 1 }),
        getObjectIdCounter: () => 8,
      },
    });

    const firstObject = readFirstSourceGameLogicObjectState(saveFile.data);
    const floatModule = firstObject?.modules.find((module) => module.identifier === 'ModuleTag_Float');

    expect(floatModule).toBeDefined();
    expect(parseSourceFloatUpdateBlockData(floatModule!.blockData)).toEqual({
      nextCallFrameAndPhase: (43 << 2) | 2,
      enabled: true,
    });
  });

  it('rewrites source SpectreGunshipDeploymentUpdate modules from live runtime state', () => {
    const sourceGameLogicBytes = createSourceGameLogicChunkData(false, [{
      identifier: 'ModuleTag_SpectreDeploy',
      blockData: createSourceSpectreGunshipDeploymentUpdateBlockData((84 << 2) | 2, 7),
    }]);

    const saveFile = buildRuntimeSaveFile({
      description: 'source spectre deployment rewrite',
      mapPath: 'Maps/RuntimeTank/RuntimeTank.map',
      mapData: {
        width: 1,
        height: 1,
        tiles: [0],
        objects: [],
        waypoints: [],
        namedAreas: [],
        namedPolygons: [],
        namedWaypointPaths: [],
        startPositions: [],
        meta: {
          name: 'RuntimeTank',
          players: 1,
          supplyDockCount: 0,
          oilDerrickCount: 0,
          techBuildingCount: 0,
        },
        blendTileCount: 0,
      },
      cameraState: null,
      passthroughBlocks: [{
        blockName: 'CHUNK_GameLogic',
        blockData: sourceGameLogicBytes.slice().buffer,
      }],
      gameLogic: {
        captureSourceTerrainLogicRuntimeSaveState: () => ({
          version: 2,
          activeBoundary: 0,
          waterUpdates: [],
        }),
        captureSourcePartitionRuntimeSaveState: createEmptyPartitionState,
        captureSourcePlayerRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceRadarRuntimeSaveState: createEmptyRadarState,
        captureSourceSidesListRuntimeSaveState: () => createEmptySidesListState(),
        captureSourceTeamFactoryRuntimeSaveState: () => createEmptyTeamFactoryState(),
        captureSourceScriptEngineRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceInGameUiRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceGameLogicRuntimeSaveState: () => ({
          version: 10,
          nextId: 8,
          nextProjectileVisualId: 1,
          animationTime: 0,
          selectedEntityId: null,
          selectedEntityIds: [],
          scriptSelectionChangedFrame: 0,
          frameCounter: 42,
          controlBarDirtyFrame: 0,
          scriptObjectTopologyVersion: 0,
          scriptObjectCountChangedFrame: 0,
          defeatedSides: new Set<string>(),
          gameEndFrame: null,
          scriptEndGameTimerActive: false,
          objectTriggerAreaStates: [],
          spawnedEntities: [{
            id: 7,
            templateName: 'RuntimeTank',
            x: 10,
            y: 0,
            z: 20,
            rotationY: 1.25,
            spectreGunshipDeploymentProfile: {
              specialPowerTemplate: 'SUPERWEAPON_SPECTRE',
              gunshipTemplateName: 'SpectreGunship',
              attackAreaRadius: 200,
              gunshipOrbitRadius: 250,
              createLocation: 'FARTHEST_FROM_TARGET',
              requiredScience: '',
            },
            spectreGunshipDeploymentGunshipId: 42,
          } as unknown as import('@generals/game-logic').MapEntity],
        }),
        resolveSourceObjectModuleTypeByTag: (templateName, moduleTag) =>
          templateName === 'RuntimeTank' && moduleTag === 'ModuleTag_SpectreDeploy'
            ? 'SPECTREGUNSHIPDEPLOYMENTUPDATE'
            : null,
        captureBrowserRuntimeSaveState: () => ({ version: 1 }),
        getObjectIdCounter: () => 8,
      },
    });

    const firstObject = readFirstSourceGameLogicObjectState(saveFile.data);
    const deploymentModule = firstObject?.modules.find((module) => module.identifier === 'ModuleTag_SpectreDeploy');

    expect(deploymentModule).toBeDefined();
    expect(parseSourceSpectreGunshipDeploymentUpdateBlockData(deploymentModule!.blockData)).toEqual({
      nextCallFrameAndPhase: (43 << 2) | 2,
      gunshipId: 42,
    });
  });

  it('rewrites source SpectreGunshipUpdate modules from live runtime state', () => {
    const sourceGameLogicBytes = createSourceGameLogicChunkData(false, [{
      identifier: 'ModuleTag_Spectre',
      blockData: createSourceSpectreGunshipUpdateBlockData(
        (84 << 2) | 2,
        { x: 100, y: 7, z: 200 },
        { x: 110, y: 8, z: 210 },
        { x: 120, y: 9, z: 220 },
        3,
        150,
        { x: 130, y: 10, z: 230 },
        { x: 140, y: 11, z: 240 },
        2,
        77,
      ),
    }]);

    const saveFile = buildRuntimeSaveFile({
      description: 'source spectre gunship rewrite',
      mapPath: 'Maps/RuntimeTank/RuntimeTank.map',
      mapData: {
        width: 1,
        height: 1,
        tiles: [0],
        objects: [],
        waypoints: [],
        namedAreas: [],
        namedPolygons: [],
        namedWaypointPaths: [],
        startPositions: [],
        meta: {
          name: 'RuntimeTank',
          players: 1,
          supplyDockCount: 0,
          oilDerrickCount: 0,
          techBuildingCount: 0,
        },
        blendTileCount: 0,
      },
      cameraState: null,
      passthroughBlocks: [{
        blockName: 'CHUNK_GameLogic',
        blockData: sourceGameLogicBytes.slice().buffer,
      }],
      gameLogic: {
        captureSourceTerrainLogicRuntimeSaveState: () => ({
          version: 2,
          activeBoundary: 0,
          waterUpdates: [],
        }),
        captureSourcePartitionRuntimeSaveState: createEmptyPartitionState,
        captureSourcePlayerRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceRadarRuntimeSaveState: createEmptyRadarState,
        captureSourceSidesListRuntimeSaveState: () => createEmptySidesListState(),
        captureSourceTeamFactoryRuntimeSaveState: () => createEmptyTeamFactoryState(),
        captureSourceScriptEngineRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceInGameUiRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceGameLogicRuntimeSaveState: () => ({
          version: 10,
          nextId: 8,
          nextProjectileVisualId: 1,
          animationTime: 0,
          selectedEntityId: null,
          selectedEntityIds: [],
          scriptSelectionChangedFrame: 0,
          frameCounter: 42,
          controlBarDirtyFrame: 0,
          scriptObjectTopologyVersion: 0,
          scriptObjectCountChangedFrame: 0,
          defeatedSides: new Set<string>(),
          gameEndFrame: null,
          scriptEndGameTimerActive: false,
          objectTriggerAreaStates: [],
          spawnedEntities: [{
            id: 7,
            templateName: 'RuntimeTank',
            x: 10,
            y: 12,
            z: 20,
            rotationY: 1.25,
            spectreGunshipProfile: {
              specialPowerTemplate: 'SUPERWEAPON_SPECTRE',
              gattlingTemplateName: 'SpectreGattling',
              orbitFrames: 90,
              howitzerFiringRate: 10,
              howitzerFollowLag: 5,
              attackAreaRadius: 200,
              strafingIncrement: 20,
              orbitInsertionSlope: 0.7,
              randomOffsetForHowitzer: 20,
              targetingReticleRadius: 25,
              gunshipOrbitRadius: 250,
              howitzerWeaponTemplateName: 'SpectreHowitzer',
              gattlingStrafeFXParticleSystemName: 'FX_Strafing',
            },
            spectreGunshipState: {
              status: 'ORBITING',
              initialTargetX: 500,
              initialTargetZ: 600,
              overrideTargetX: 510,
              overrideTargetZ: 610,
              satelliteX: 520,
              satelliteZ: 620,
              gattlingTargetX: 530,
              gattlingTargetZ: 630,
              positionToShootAtX: 540,
              positionToShootAtZ: 640,
              orbitEscapeFrame: 175,
              okToFireHowitzerCounter: 9,
              gattlingEntityId: 88,
            },
          } as unknown as import('@generals/game-logic').MapEntity],
        }),
        resolveSourceObjectModuleTypeByTag: (templateName, moduleTag) =>
          templateName === 'RuntimeTank' && moduleTag === 'ModuleTag_Spectre'
            ? 'SPECTREGUNSHIPUPDATE'
            : null,
        captureBrowserRuntimeSaveState: () => ({ version: 1 }),
        getObjectIdCounter: () => 8,
      },
    });

    const firstObject = readFirstSourceGameLogicObjectState(saveFile.data);
    const spectreModule = firstObject?.modules.find((module) => module.identifier === 'ModuleTag_Spectre');

    expect(spectreModule).toBeDefined();
    expect(parseSourceSpectreGunshipUpdateBlockData(spectreModule!.blockData)).toEqual({
      nextCallFrameAndPhase: (43 << 2) | 2,
      initialTargetPosition: { x: 500, y: 7, z: 600 },
      overrideTargetDestination: { x: 510, y: 8, z: 610 },
      satellitePosition: { x: 520, y: 9, z: 620 },
      status: 1,
      orbitEscapeFrame: 175,
      gattlingTargetPosition: { x: 530, y: 10, z: 630 },
      positionToShootAt: { x: 540, y: 11, z: 640 },
      okToFireHowitzerCounter: 9,
      gattlingId: 88,
    });
  });

  it('rewrites source PilotFindVehicleUpdate modules from live runtime state', () => {
    const sourceGameLogicBytes = createSourceGameLogicChunkData(false, [{
      identifier: 'ModuleTag_Pilot',
      blockData: createSourcePilotFindVehicleUpdateBlockData((84 << 2) | 2, false),
    }]);

    const saveFile = buildRuntimeSaveFile({
      description: 'source pilot find vehicle rewrite',
      mapPath: 'Maps/RuntimeTank/RuntimeTank.map',
      mapData: {
        width: 1,
        height: 1,
        tiles: [0],
        objects: [],
        waypoints: [],
        namedAreas: [],
        namedPolygons: [],
        namedWaypointPaths: [],
        startPositions: [],
        meta: {
          name: 'RuntimeTank',
          players: 1,
          supplyDockCount: 0,
          oilDerrickCount: 0,
          techBuildingCount: 0,
        },
        blendTileCount: 0,
      },
      cameraState: null,
      passthroughBlocks: [{
        blockName: 'CHUNK_GameLogic',
        blockData: sourceGameLogicBytes.slice().buffer,
      }],
      gameLogic: {
        captureSourceTerrainLogicRuntimeSaveState: () => ({
          version: 2,
          activeBoundary: 0,
          waterUpdates: [],
        }),
        captureSourcePartitionRuntimeSaveState: createEmptyPartitionState,
        captureSourcePlayerRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceRadarRuntimeSaveState: createEmptyRadarState,
        captureSourceSidesListRuntimeSaveState: () => createEmptySidesListState(),
        captureSourceTeamFactoryRuntimeSaveState: () => createEmptyTeamFactoryState(),
        captureSourceScriptEngineRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceInGameUiRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceGameLogicRuntimeSaveState: () => ({
          version: 10,
          nextId: 8,
          nextProjectileVisualId: 1,
          animationTime: 0,
          selectedEntityId: null,
          selectedEntityIds: [],
          scriptSelectionChangedFrame: 0,
          frameCounter: 42,
          controlBarDirtyFrame: 0,
          scriptObjectTopologyVersion: 0,
          scriptObjectCountChangedFrame: 0,
          defeatedSides: new Set<string>(),
          gameEndFrame: null,
          scriptEndGameTimerActive: false,
          objectTriggerAreaStates: [],
          spawnedEntities: [{
            id: 7,
            templateName: 'RuntimeTank',
            x: 10,
            y: 0,
            z: 20,
            rotationY: 1.25,
            pilotFindVehicleProfile: {
              scanFrames: 15,
              scanRange: 300,
            },
            pilotFindVehicleDidMoveToBase: true,
          } as unknown as import('@generals/game-logic').MapEntity],
        }),
        resolveSourceObjectModuleTypeByTag: (templateName, moduleTag) =>
          templateName === 'RuntimeTank' && moduleTag === 'ModuleTag_Pilot'
            ? 'PILOTFINDVEHICLEUPDATE'
            : null,
        captureBrowserRuntimeSaveState: () => ({ version: 1 }),
        getObjectIdCounter: () => 8,
      },
    });

    const firstObject = readFirstSourceGameLogicObjectState(saveFile.data);
    const pilotModule = firstObject?.modules.find((module) => module.identifier === 'ModuleTag_Pilot');

    expect(pilotModule).toBeDefined();
    expect(parseSourcePilotFindVehicleUpdateBlockData(pilotModule!.blockData)).toEqual({
      nextCallFrameAndPhase: (43 << 2) | 2,
      didMoveToBase: true,
    });
  });

  it('rewrites source PointDefenseLaserUpdate modules from live runtime state', () => {
    const sourceGameLogicBytes = createSourceGameLogicChunkData(false, [{
      identifier: 'ModuleTag_PDL',
      blockData: createSourcePointDefenseLaserUpdateBlockData((84 << 2) | 2, 11, true, 5, 6),
    }]);

    const saveFile = buildRuntimeSaveFile({
      description: 'source point defense laser rewrite',
      mapPath: 'Maps/RuntimeTank/RuntimeTank.map',
      mapData: {
        width: 1,
        height: 1,
        tiles: [0],
        objects: [],
        waypoints: [],
        namedAreas: [],
        namedPolygons: [],
        namedWaypointPaths: [],
        startPositions: [],
        meta: {
          name: 'RuntimeTank',
          players: 1,
          supplyDockCount: 0,
          oilDerrickCount: 0,
          techBuildingCount: 0,
        },
        blendTileCount: 0,
      },
      cameraState: null,
      passthroughBlocks: [{
        blockName: 'CHUNK_GameLogic',
        blockData: sourceGameLogicBytes.slice().buffer,
      }],
      gameLogic: {
        captureSourceTerrainLogicRuntimeSaveState: () => ({
          version: 2,
          activeBoundary: 0,
          waterUpdates: [],
        }),
        captureSourcePartitionRuntimeSaveState: createEmptyPartitionState,
        captureSourcePlayerRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceRadarRuntimeSaveState: createEmptyRadarState,
        captureSourceSidesListRuntimeSaveState: () => createEmptySidesListState(),
        captureSourceTeamFactoryRuntimeSaveState: () => createEmptyTeamFactoryState(),
        captureSourceScriptEngineRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceInGameUiRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceGameLogicRuntimeSaveState: () => ({
          version: 10,
          nextId: 8,
          nextProjectileVisualId: 1,
          animationTime: 0,
          selectedEntityId: null,
          selectedEntityIds: [],
          scriptSelectionChangedFrame: 0,
          frameCounter: 42,
          controlBarDirtyFrame: 0,
          scriptObjectTopologyVersion: 0,
          scriptObjectCountChangedFrame: 0,
          defeatedSides: new Set<string>(),
          gameEndFrame: null,
          scriptEndGameTimerActive: false,
          objectTriggerAreaStates: [],
          spawnedEntities: [{
            id: 7,
            templateName: 'RuntimeTank',
            x: 10,
            y: 0,
            z: 20,
            rotationY: 1.25,
            pointDefenseLaserProfile: {
              weaponName: 'PDLWeapon',
              primaryTargetKindOf: new Set<string>(),
              secondaryTargetKindOf: new Set<string>(),
              scanRate: 10,
              scanRange: 300,
              predictTargetVelocityFactor: 0,
            },
            pdlNextScanFrame: 51,
            pdlNextShotFrame: 62,
          } as unknown as import('@generals/game-logic').MapEntity],
        }),
        resolveSourceObjectModuleTypeByTag: (templateName, moduleTag) =>
          templateName === 'RuntimeTank' && moduleTag === 'ModuleTag_PDL'
            ? 'POINTDEFENSELASERUPDATE'
            : null,
        captureBrowserRuntimeSaveState: () => ({ version: 1 }),
        getObjectIdCounter: () => 8,
      },
    });

    const firstObject = readFirstSourceGameLogicObjectState(saveFile.data);
    const pdlModule = firstObject?.modules.find((module) => module.identifier === 'ModuleTag_PDL');

    expect(pdlModule).toBeDefined();
    expect(parseSourcePointDefenseLaserUpdateBlockData(pdlModule!.blockData)).toEqual({
      nextCallFrameAndPhase: (43 << 2) | 2,
      bestTargetId: 11,
      inRange: true,
      nextScanFrames: 9,
      nextShotAvailableInFrames: 20,
    });
  });

  it('rewrites source LeafletDropBehavior modules from live runtime state', () => {
    const sourceGameLogicBytes = createSourceGameLogicChunkData(false, [{
      identifier: 'ModuleTag_Leaflet',
      blockData: createSourceLeafletDropBehaviorBlockData(77),
    }]);

    const saveFile = buildRuntimeSaveFile({
      description: 'source leaflet drop rewrite',
      mapPath: 'Maps/RuntimeTank/RuntimeTank.map',
      mapData: {
        width: 1,
        height: 1,
        tiles: [0],
        objects: [],
        waypoints: [],
        namedAreas: [],
        namedPolygons: [],
        namedWaypointPaths: [],
        startPositions: [],
        meta: {
          name: 'RuntimeTank',
          players: 1,
          supplyDockCount: 0,
          oilDerrickCount: 0,
          techBuildingCount: 0,
        },
        blendTileCount: 0,
      },
      cameraState: null,
      passthroughBlocks: [{
        blockName: 'CHUNK_GameLogic',
        blockData: sourceGameLogicBytes.slice().buffer,
      }],
      gameLogic: {
        captureSourceTerrainLogicRuntimeSaveState: () => ({
          version: 2,
          activeBoundary: 0,
          waterUpdates: [],
        }),
        captureSourcePartitionRuntimeSaveState: createEmptyPartitionState,
        captureSourcePlayerRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceRadarRuntimeSaveState: createEmptyRadarState,
        captureSourceSidesListRuntimeSaveState: () => createEmptySidesListState(),
        captureSourceTeamFactoryRuntimeSaveState: () => createEmptyTeamFactoryState(),
        captureSourceScriptEngineRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceInGameUiRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceGameLogicRuntimeSaveState: () => ({
          version: 10,
          nextId: 8,
          nextProjectileVisualId: 1,
          animationTime: 0,
          selectedEntityId: null,
          selectedEntityIds: [],
          scriptSelectionChangedFrame: 0,
          frameCounter: 42,
          controlBarDirtyFrame: 0,
          scriptObjectTopologyVersion: 0,
          scriptObjectCountChangedFrame: 0,
          defeatedSides: new Set<string>(),
          gameEndFrame: null,
          scriptEndGameTimerActive: false,
          objectTriggerAreaStates: [],
          spawnedEntities: [{
            id: 7,
            templateName: 'RuntimeTank',
            x: 10,
            y: 0,
            z: 20,
            rotationY: 1.25,
            leafletDropProfile: {
              delayFrames: 30,
              disabledDurationFrames: 150,
              affectRadius: 40,
            },
            leafletDropState: {
              startFrame: 96,
              fired: false,
            },
          } as unknown as import('@generals/game-logic').MapEntity],
        }),
        resolveSourceObjectModuleTypeByTag: (templateName, moduleTag) =>
          templateName === 'RuntimeTank' && moduleTag === 'ModuleTag_Leaflet'
            ? 'LEAFLETDROPBEHAVIOR'
            : null,
        captureBrowserRuntimeSaveState: () => ({ version: 1 }),
        getObjectIdCounter: () => 8,
      },
    });

    const firstObject = readFirstSourceGameLogicObjectState(saveFile.data);
    const leafletModule = firstObject?.modules.find((module) => module.identifier === 'ModuleTag_Leaflet');

    expect(leafletModule).toBeDefined();
    expect(parseSourceLeafletDropBehaviorBlockData(leafletModule!.blockData)).toEqual({
      startFrame: 96,
    });
  });

  it('rewrites source HijackerUpdate modules from live runtime state', () => {
    const sourceGameLogicBytes = createSourceGameLogicChunkData(false, [{
      identifier: 'ModuleTag_Hijacker',
      blockData: createSourceHijackerUpdateBlockData((83 << 2) | 2, 21, 1, 2, 3, false, false, false),
    }]);

    const saveFile = buildRuntimeSaveFile({
      description: 'source hijacker rewrite',
      mapPath: 'Maps/RuntimeTank/RuntimeTank.map',
      mapData: {
        width: 1,
        height: 1,
        tiles: [0],
        objects: [],
        waypoints: [],
        namedAreas: [],
        namedPolygons: [],
        namedWaypointPaths: [],
        startPositions: [],
        meta: {
          name: 'RuntimeTank',
          players: 1,
          supplyDockCount: 0,
          oilDerrickCount: 0,
          techBuildingCount: 0,
        },
        blendTileCount: 0,
      },
      cameraState: null,
      passthroughBlocks: [{
        blockName: 'CHUNK_GameLogic',
        blockData: sourceGameLogicBytes.slice().buffer,
      }],
      gameLogic: {
        captureSourceTerrainLogicRuntimeSaveState: () => ({
          version: 2,
          activeBoundary: 0,
          waterUpdates: [],
        }),
        captureSourcePartitionRuntimeSaveState: createEmptyPartitionState,
        captureSourcePlayerRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceRadarRuntimeSaveState: createEmptyRadarState,
        captureSourceSidesListRuntimeSaveState: () => createEmptySidesListState(),
        captureSourceTeamFactoryRuntimeSaveState: () => createEmptyTeamFactoryState(),
        captureSourceScriptEngineRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceInGameUiRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceGameLogicRuntimeSaveState: () => ({
          version: 10,
          nextId: 8,
          nextProjectileVisualId: 1,
          animationTime: 0,
          selectedEntityId: null,
          selectedEntityIds: [],
          scriptSelectionChangedFrame: 0,
          frameCounter: 42,
          controlBarDirtyFrame: 0,
          scriptObjectTopologyVersion: 0,
          scriptObjectCountChangedFrame: 0,
          defeatedSides: new Set<string>(),
          gameEndFrame: null,
          scriptEndGameTimerActive: false,
          objectTriggerAreaStates: [],
          spawnedEntities: [{
            id: 7,
            templateName: 'RuntimeTank',
            x: 10,
            y: 0,
            z: 20,
            rotationY: 1.25,
            hijackerUpdateProfile: {
              parachuteName: 'ParachuteContainer',
            },
            hijackerState: {
              targetId: 44,
              isInVehicle: true,
              wasTargetAirborne: true,
              ejectX: 12,
              ejectY: 9,
              ejectZ: 34,
            },
          } as unknown as import('@generals/game-logic').MapEntity],
        }),
        resolveSourceObjectModuleTypeByTag: (templateName, moduleTag) =>
          templateName === 'RuntimeTank' && moduleTag === 'ModuleTag_Hijacker'
            ? 'HIJACKERUPDATE'
            : null,
        captureBrowserRuntimeSaveState: () => ({ version: 1 }),
        getObjectIdCounter: () => 8,
      },
    });

    const firstObject = readFirstSourceGameLogicObjectState(saveFile.data);
    const hijackerModule = firstObject?.modules.find((module) => module.identifier === 'ModuleTag_Hijacker');

    expect(hijackerModule).toBeDefined();
    expect(parseSourceHijackerUpdateBlockData(hijackerModule!.blockData)).toEqual({
      nextCallFrameAndPhase: (43 << 2) | 2,
      targetId: 44,
      eject: { x: 12, y: 9, z: 34 },
      update: true,
      isInVehicle: true,
      wasTargetAirborne: true,
    });
  });

  it('rewrites source EMPUpdate modules from live runtime state', () => {
    const sourceGameLogicBytes = createSourceGameLogicChunkData(false, [{
      identifier: 'ModuleTag_EMP',
      blockData: createSourceEmpUpdateBlockData(),
    }]);

    const saveFile = buildRuntimeSaveFile({
      description: 'source emp rewrite',
      mapPath: 'Maps/RuntimeEMP/RuntimeEMP.map',
      mapData: {
        width: 1,
        height: 1,
        tiles: [0],
        objects: [],
        waypoints: [],
        namedAreas: [],
        namedPolygons: [],
        namedWaypointPaths: [],
        startPositions: [],
        meta: {
          name: 'RuntimeEMP',
          players: 1,
          supplyDockCount: 0,
          oilDerrickCount: 0,
          techBuildingCount: 0,
        },
        blendTileCount: 0,
      },
      cameraState: null,
      passthroughBlocks: [{
        blockName: 'CHUNK_GameLogic',
        blockData: sourceGameLogicBytes.slice().buffer,
      }],
      gameLogic: {
        captureSourceTerrainLogicRuntimeSaveState: () => ({
          version: 2,
          activeBoundary: 0,
          waterUpdates: [],
        }),
        captureSourcePartitionRuntimeSaveState: createEmptyPartitionState,
        captureSourcePlayerRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceRadarRuntimeSaveState: createEmptyRadarState,
        captureSourceSidesListRuntimeSaveState: () => createEmptySidesListState(),
        captureSourceTeamFactoryRuntimeSaveState: () => createEmptyTeamFactoryState(),
        captureSourceScriptEngineRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceInGameUiRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceGameLogicRuntimeSaveState: () => ({
          version: 10,
          nextId: 8,
          nextProjectileVisualId: 1,
          animationTime: 0,
          selectedEntityId: null,
          selectedEntityIds: [],
          scriptSelectionChangedFrame: 0,
          frameCounter: 42,
          controlBarDirtyFrame: 0,
          scriptObjectTopologyVersion: 0,
          scriptObjectCountChangedFrame: 0,
          defeatedSides: new Set<string>(),
          gameEndFrame: null,
          scriptEndGameTimerActive: false,
          objectTriggerAreaStates: [],
          spawnedEntities: [{
            id: 7,
            templateName: 'RuntimeEMPField',
            x: 10,
            y: 0,
            z: 20,
            rotationY: 1.25,
            empUpdateProfile: {
              lifetimeFrames: 120,
              startFadeFrame: 30,
              disabledDurationFrames: 90,
              effectRadius: 80,
              doesNotAffectMyOwnBuildings: false,
              victimRequiredKindOf: new Set<string>(),
              victimForbiddenKindOf: new Set<string>(),
            },
            empUpdateState: {
              dieFrame: 180,
              fadeFrame: 72,
              disableAttackFired: true,
            },
          } as unknown as import('@generals/game-logic').MapEntity],
        }),
        resolveSourceObjectModuleTypeByTag: (templateName, moduleTag) =>
          templateName === 'RuntimeEMPField' && moduleTag === 'ModuleTag_EMP'
            ? 'EMPUPDATE'
            : null,
        captureBrowserRuntimeSaveState: () => ({ version: 1 }),
        getObjectIdCounter: () => 8,
      },
    });

    const firstObject = readFirstSourceGameLogicObjectState(saveFile.data);
    const empModule = firstObject?.modules.find((module) => module.identifier === 'ModuleTag_EMP');

    expect(empModule).toBeDefined();
    expect(parseSourceEmpUpdateBlockData(empModule!.blockData)).toEqual({
      version: 1,
    });
  });

  it('rewrites source RadarUpdate modules from live runtime state', () => {
    const sourceGameLogicBytes = createSourceGameLogicChunkData(false, [{
      identifier: 'ModuleTag_Radar',
      blockData: createSourceRadarUpdateBlockData((70 << 2) | 2, 60, false, false),
    }]);

    const saveFile = buildRuntimeSaveFile({
      description: 'source radar rewrite',
      mapPath: 'Maps/RuntimeRadar/RuntimeRadar.map',
      mapData: {
        width: 1,
        height: 1,
        tiles: [0],
        objects: [],
        waypoints: [],
        namedAreas: [],
        namedPolygons: [],
        namedWaypointPaths: [],
        startPositions: [],
        meta: {
          name: 'RuntimeRadar',
          players: 1,
          supplyDockCount: 0,
          oilDerrickCount: 0,
          techBuildingCount: 0,
        },
        blendTileCount: 0,
      },
      cameraState: null,
      passthroughBlocks: [{
        blockName: 'CHUNK_GameLogic',
        blockData: sourceGameLogicBytes.slice().buffer,
      }],
      gameLogic: {
        captureSourceTerrainLogicRuntimeSaveState: () => ({
          version: 2,
          activeBoundary: 0,
          waterUpdates: [],
        }),
        captureSourcePartitionRuntimeSaveState: createEmptyPartitionState,
        captureSourcePlayerRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceRadarRuntimeSaveState: createEmptyRadarState,
        captureSourceSidesListRuntimeSaveState: () => createEmptySidesListState(),
        captureSourceTeamFactoryRuntimeSaveState: () => createEmptyTeamFactoryState(),
        captureSourceScriptEngineRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceInGameUiRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceGameLogicRuntimeSaveState: () => ({
          version: 10,
          nextId: 8,
          nextProjectileVisualId: 1,
          animationTime: 0,
          selectedEntityId: null,
          selectedEntityIds: [],
          scriptSelectionChangedFrame: 0,
          frameCounter: 42,
          controlBarDirtyFrame: 0,
          scriptObjectTopologyVersion: 0,
          scriptObjectCountChangedFrame: 0,
          defeatedSides: new Set<string>(),
          gameEndFrame: null,
          scriptEndGameTimerActive: false,
          objectTriggerAreaStates: [],
          spawnedEntities: [{
            id: 7,
            templateName: 'RuntimeTank',
            x: 10,
            y: 0,
            z: 20,
            rotationY: 1.25,
            radarUpdateProfile: {
              radarExtendTimeFrames: 120,
            },
            radarExtendDoneFrame: 96,
            radarExtendComplete: true,
            radarActive: true,
          } as unknown as import('@generals/game-logic').MapEntity],
        }),
        resolveSourceObjectModuleTypeByTag: (templateName, moduleTag) =>
          templateName === 'RuntimeTank' && moduleTag === 'ModuleTag_Radar'
            ? 'RADARUPDATE'
            : null,
        captureBrowserRuntimeSaveState: () => ({ version: 1 }),
        getObjectIdCounter: () => 8,
      },
    });

    const firstObject = readFirstSourceGameLogicObjectState(saveFile.data);
    const radarModule = firstObject?.modules.find((module) => module.identifier === 'ModuleTag_Radar');

    expect(radarModule).toBeDefined();
    expect(parseSourceRadarUpdateBlockData(radarModule!.blockData)).toEqual({
      nextCallFrameAndPhase: (43 << 2) | 2,
      extendDoneFrame: 96,
      extendComplete: true,
      radarActive: true,
    });
  });

  it('rewrites source NeutronMissileUpdate modules from live runtime state', () => {
    const rawLaunchParamsBytes = createRawNeutronMissileLaunchParamsBytes(
      7,
      3,
      { x: 1.5, y: 2.5, z: 3.5 },
      { x: 4.5, y: 5.5, z: 6.5 },
      99,
    );
    const sourceGameLogicBytes = createSourceGameLogicChunkData(false, [{
      identifier: 'ModuleTag_NeutronMissile',
      blockData: createSourceNeutronMissileUpdateBlockData(
        (70 << 2) | 2,
        'LAUNCH',
        { x: 11, y: 12, z: 13 },
        { x: 21, y: 22, z: 23 },
        44,
        rawLaunchParamsBytes,
        false,
        false,
        88.5,
        false,
        77,
        12.25,
        'NukeExhaustTrail',
      ),
    }]);

    const saveFile = buildRuntimeSaveFile({
      description: 'source neutron missile rewrite',
      mapPath: 'Maps/RuntimeTank/RuntimeTank.map',
      mapData: {
        width: 1,
        height: 1,
        tiles: [0],
        objects: [],
        waypoints: [],
        namedAreas: [],
        namedPolygons: [],
        namedWaypointPaths: [],
        startPositions: [],
        meta: {
          name: 'RuntimeTank',
          players: 1,
          supplyDockCount: 0,
          oilDerrickCount: 0,
          techBuildingCount: 0,
        },
        blendTileCount: 0,
      },
      cameraState: null,
      passthroughBlocks: [{
        blockName: 'CHUNK_GameLogic',
        blockData: sourceGameLogicBytes.slice().buffer,
      }],
      gameLogic: {
        captureSourceTerrainLogicRuntimeSaveState: () => ({
          version: 2,
          activeBoundary: 0,
          waterUpdates: [],
        }),
        captureSourcePartitionRuntimeSaveState: createEmptyPartitionState,
        captureSourcePlayerRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceRadarRuntimeSaveState: createEmptyRadarState,
        captureSourceSidesListRuntimeSaveState: () => createEmptySidesListState(),
        captureSourceTeamFactoryRuntimeSaveState: () => createEmptyTeamFactoryState(),
        captureSourceScriptEngineRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceInGameUiRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceGameLogicRuntimeSaveState: () => ({
          version: 10,
          nextId: 8,
          nextProjectileVisualId: 1,
          animationTime: 0,
          selectedEntityId: null,
          selectedEntityIds: [],
          scriptSelectionChangedFrame: 0,
          frameCounter: 42,
          controlBarDirtyFrame: 0,
          scriptObjectTopologyVersion: 0,
          scriptObjectCountChangedFrame: 0,
          defeatedSides: new Set<string>(),
          gameEndFrame: null,
          scriptEndGameTimerActive: false,
          objectTriggerAreaStates: [],
          spawnedEntities: [{
            id: 7,
            templateName: 'RuntimeTank',
            x: 10,
            y: 20,
            z: 30,
            rotationY: 0,
            neutronMissileUpdateProfile: {
              initialDist: 150,
              maxTurnRate: 1,
              forwardDamping: 0.2,
              relativeSpeed: 3,
              targetFromDirectlyAbove: 120,
              specialAccelFactor: 1.25,
              specialSpeedTimeFrames: 30,
              specialSpeedHeight: 200,
              deliveryDecalRadius: 150,
              specialJitterDistance: 12,
            },
            neutronMissileUpdateState: {
              state: 'ATTACK',
              targetX: 101,
              targetY: 202,
              targetZ: 303,
              intermedX: 111,
              intermedY: 222,
              intermedZ: 333,
              accelX: 1.5,
              accelY: 2.5,
              accelZ: 3.5,
              velX: 4.5,
              velY: 5.5,
              velZ: 6.5,
              launcherId: 55,
              attachWeaponSlot: 7,
              attachSpecificBarrelToUse: 3,
              stateTimestamp: 99,
              isArmed: true,
              isLaunched: true,
              noTurnDistLeft: 44.25,
              reachedIntermediatePos: true,
              frameAtLaunch: 66,
              heightAtLaunch: 77.75,
            },
          } as unknown as import('@generals/game-logic').MapEntity],
        }),
        resolveSourceObjectModuleTypeByTag: (templateName, moduleTag) =>
          templateName === 'RuntimeTank' && moduleTag === 'ModuleTag_NeutronMissile'
            ? 'NEUTRONMISSILEUPDATE'
            : null,
        captureBrowserRuntimeSaveState: () => ({ version: 1 }),
        getObjectIdCounter: () => 8,
      },
    });

    const firstObject = readFirstSourceGameLogicObjectState(saveFile.data);
    const missileModule = firstObject?.modules.find((module) => module.identifier === 'ModuleTag_NeutronMissile');

    expect(missileModule).toBeDefined();
    expect(parseSourceNeutronMissileUpdateBlockData(missileModule!.blockData)).toEqual({
      nextCallFrameAndPhase: (43 << 2) | 2,
      state: 'ATTACK',
      targetPos: { x: 101, y: 202, z: 303 },
      intermedPos: { x: 111, y: 222, z: 333 },
      launcherId: 55,
      attachWeaponSlot: 7,
      attachSpecificBarrelToUse: 3,
      accel: { x: 1.5, y: 2.5, z: 3.5 },
      vel: { x: 4.5, y: 5.5, z: 6.5 },
      stateTimestamp: 99,
      isLaunched: true,
      isArmed: true,
      noTurnDistLeft: 44.25,
      reachedIntermediatePos: true,
      frameAtLaunch: 66,
      heightAtLaunch: 77.75,
      exhaustSystemTemplateName: 'NukeExhaustTrail',
    });
  });

  it('rewrites source SpyVisionUpdate modules from live runtime state', () => {
    const sourceGameLogicBytes = createSourceGameLogicChunkData(false, [{
      identifier: 'ModuleTag_SpyVision',
      blockData: createSourceSpyVisionUpdateBlockData((70 << 2) | 2, 99, true, true, 123),
    }]);

    const saveFile = buildRuntimeSaveFile({
      description: 'source spy vision rewrite',
      mapPath: 'Maps/RuntimeTank/RuntimeTank.map',
      mapData: {
        width: 1,
        height: 1,
        tiles: [0],
        objects: [],
        waypoints: [],
        namedAreas: [],
        namedPolygons: [],
        namedWaypointPaths: [],
        startPositions: [],
        meta: {
          name: 'RuntimeTank',
          players: 1,
          supplyDockCount: 0,
          oilDerrickCount: 0,
          techBuildingCount: 0,
        },
        blendTileCount: 0,
      },
      cameraState: null,
      passthroughBlocks: [{
        blockName: 'CHUNK_GameLogic',
        blockData: sourceGameLogicBytes.slice().buffer,
      }],
      gameLogic: {
        captureSourceTerrainLogicRuntimeSaveState: () => ({
          version: 2,
          activeBoundary: 0,
          waterUpdates: [],
        }),
        captureSourcePartitionRuntimeSaveState: createEmptyPartitionState,
        captureSourcePlayerRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceRadarRuntimeSaveState: createEmptyRadarState,
        captureSourceSidesListRuntimeSaveState: () => createEmptySidesListState(),
        captureSourceTeamFactoryRuntimeSaveState: () => createEmptyTeamFactoryState(),
        captureSourceScriptEngineRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceInGameUiRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceGameLogicRuntimeSaveState: () => ({
          version: 10,
          nextId: 8,
          nextProjectileVisualId: 1,
          animationTime: 0,
          selectedEntityId: null,
          selectedEntityIds: [],
          scriptSelectionChangedFrame: 0,
          frameCounter: 42,
          controlBarDirtyFrame: 0,
          scriptObjectTopologyVersion: 0,
          scriptObjectCountChangedFrame: 0,
          defeatedSides: new Set<string>(),
          gameEndFrame: null,
          scriptEndGameTimerActive: false,
          objectTriggerAreaStates: [],
          spawnedEntities: [{
            id: 7,
            templateName: 'RuntimeTank',
            x: 10,
            y: 0,
            z: 20,
            rotationY: 0,
            specialPowerModules: new Map([
              ['SPECIAL_SPY_VISION', {
                specialPowerTemplateName: 'SPECIAL_SPY_VISION',
                moduleType: 'SPYVISIONSPECIALPOWER',
                updateModuleStartsAttack: false,
                startsPaused: false,
                availableOnFrame: 0,
                pausedCount: 0,
                pausedOnFrame: 0,
                pausedPercent: 0,
                spyVisionDeactivateFrame: 456,
                spyVisionCurrentlyActive: false,
                spyVisionResetTimersNextUpdate: true,
                spyVisionDisabledUntilFrame: 789,
                cashHackMoneyAmount: 0,
                cashBountyPercent: 0,
                spyVisionBaseDurationMs: 0,
                fireWeaponMaxShots: 1,
                cleanupMoveRange: 0,
                oclName: '',
                areaDamageRadius: 0,
                areaDamageAmount: 0,
                areaHealAmount: 0,
                areaHealRadius: 0,
                detonationObjectName: '',
                scriptedSpecialPowerOnly: false,
                oclAdjustPositionToPassable: false,
                referenceObject: '',
              }],
            ]),
          } as unknown as import('@generals/game-logic').MapEntity],
        }),
        resolveSourceObjectModuleTypeByTag: (templateName, moduleTag) =>
          templateName === 'RuntimeTank' && moduleTag === 'ModuleTag_SpyVision'
            ? 'SPYVISIONUPDATE'
            : null,
        captureBrowserRuntimeSaveState: () => ({ version: 1 }),
        getObjectIdCounter: () => 8,
      },
    });

    const firstObject = readFirstSourceGameLogicObjectState(saveFile.data);
    const spyVisionModule = firstObject?.modules.find((module) => module.identifier === 'ModuleTag_SpyVision');

    expect(spyVisionModule).toBeDefined();
    expect(parseSourceSpyVisionUpdateBlockData(spyVisionModule!.blockData)).toEqual({
      version: 2,
      nextCallFrameAndPhase: (789 << 2) | 2,
      deactivateFrame: 456,
      currentlyActive: false,
      resetTimersNextUpdate: true,
      disabledUntilFrame: 789,
    });
  });

  it('rewrites source SpecialAbilityUpdate modules from live runtime state', () => {
    const sourceGameLogicBytes = createSourceGameLogicChunkData(false, [{
      identifier: 'ModuleTag_SpecialAbility',
      blockData: createSourceSpecialAbilityUpdateBlockData(
        (70 << 2) | 2,
        false,
        1,
        2,
        99,
        { x: 11, y: 7, z: 22 },
        4,
        [91, 92],
        2,
        false,
        'PACKING',
        true,
        true,
        false,
        false,
        1.5,
      ),
    }]);

    const saveFile = buildRuntimeSaveFile({
      description: 'source special ability rewrite',
      mapPath: 'Maps/RuntimeSpecialAbility/RuntimeSpecialAbility.map',
      mapData: {
        width: 1,
        height: 1,
        tiles: [0],
        objects: [],
        waypoints: [],
        namedAreas: [],
        namedPolygons: [],
        namedWaypointPaths: [],
        startPositions: [],
        meta: {
          name: 'RuntimeSpecialAbility',
          players: 1,
          supplyDockCount: 0,
          oilDerrickCount: 0,
          techBuildingCount: 0,
        },
        blendTileCount: 0,
      },
      cameraState: null,
      passthroughBlocks: [{
        blockName: 'CHUNK_GameLogic',
        blockData: sourceGameLogicBytes.slice().buffer,
      }],
      gameLogic: {
        captureSourceTerrainLogicRuntimeSaveState: () => ({
          version: 2,
          activeBoundary: 0,
          waterUpdates: [],
        }),
        captureSourcePartitionRuntimeSaveState: createEmptyPartitionState,
        captureSourcePlayerRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceRadarRuntimeSaveState: createEmptyRadarState,
        captureSourceSidesListRuntimeSaveState: () => createEmptySidesListState(),
        captureSourceTeamFactoryRuntimeSaveState: () => createEmptyTeamFactoryState(),
        captureSourceScriptEngineRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceInGameUiRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceGameLogicRuntimeSaveState: () => ({
          version: 10,
          nextId: 8,
          nextProjectileVisualId: 1,
          animationTime: 0,
          selectedEntityId: null,
          selectedEntityIds: [],
          scriptSelectionChangedFrame: 0,
          frameCounter: 42,
          controlBarDirtyFrame: 0,
          scriptObjectTopologyVersion: 0,
          scriptObjectCountChangedFrame: 0,
          defeatedSides: new Set<string>(),
          gameEndFrame: null,
          scriptEndGameTimerActive: false,
          objectTriggerAreaStates: [],
          spawnedEntities: [{
            id: 7,
            templateName: 'RuntimeTank',
            x: 10,
            y: 0,
            z: 20,
            rotationY: 1.25,
            specialAbilityProfile: {
              specialPowerTemplateName: 'SPECIALABILITYTEST',
              startAbilityRange: 50,
              abilityAbortRange: 75,
              preparationFrames: 30,
              persistentPrepFrames: 0,
              packTimeFrames: 15,
              unpackTimeFrames: 20,
              packUnpackVariationFactor: 0,
              skipPackingWithNoTarget: false,
              effectDurationFrames: 0,
              fleeRangeAfterCompletion: 0,
              flipOwnerAfterPacking: false,
              flipOwnerAfterUnpacking: false,
              loseStealthOnTrigger: false,
              preTriggerUnstealthFrames: 0,
              awardXPForTriggering: 0,
              specialObject: null,
              specialObjectAttachToBone: null,
              maxSpecialObjects: 3,
              specialObjectsPersistent: true,
              effectValue: 0,
              uniqueSpecialObjectTargets: false,
              specialObjectsPersistWhenOwnerDies: false,
              alwaysValidateSpecialObjects: false,
              doCaptureFX: false,
              needToFaceTarget: true,
              approachRequiresLOS: true,
              persistenceRequiresRecharge: false,
            },
            specialAbilityState: {
              active: true,
              packingState: 'UNPACKING',
              prepFrames: 33,
              animFrames: 7,
              targetEntityId: null,
              targetX: 44,
              targetZ: 66,
              withinStartAbilityRange: true,
              noTargetCommand: false,
              persistentTriggerCount: 0,
              facingInitiated: false,
              facingComplete: true,
              doDisableFxParticles: true,
              captureFlashPhase: 2.75,
            },
          } as unknown as import('@generals/game-logic').MapEntity],
        }),
        resolveSourceObjectModuleTypeByTag: (templateName, moduleTag) =>
          templateName === 'RuntimeTank' && moduleTag === 'ModuleTag_SpecialAbility'
            ? 'SPECIALABILITYUPDATE'
            : null,
        captureBrowserRuntimeSaveState: () => ({ version: 1 }),
        getObjectIdCounter: () => 8,
      },
    });

    const firstObject = readFirstSourceGameLogicObjectState(saveFile.data);
    const specialAbilityModule = firstObject?.modules.find((module) => module.identifier === 'ModuleTag_SpecialAbility');

    expect(specialAbilityModule).toBeDefined();
    expect(parseSourceSpecialAbilityUpdateBlockData(specialAbilityModule!.blockData)).toEqual({
      nextCallFrameAndPhase: (43 << 2) | 2,
      active: true,
      prepFrames: 33,
      animFrames: 7,
      targetId: 0,
      targetPos: { x: 44, y: 7, z: 66 },
      locationCount: 0,
      specialObjectIdList: [],
      specialObjectEntries: 0,
      noTargetCommand: false,
      packingState: 'UNPACKING',
      facingInitiated: false,
      facingComplete: true,
      withinStartAbilityRange: true,
      doDisableFxParticles: true,
      captureFlashPhase: 2.75,
    });
  });

  it('rewrites source MissileLauncherBuildingUpdate modules from live runtime state', () => {
    const sourceGameLogicBytes = createSourceGameLogicChunkData(false, [{
      identifier: 'ModuleTag_MissileLauncher',
      blockData: createSourceMissileLauncherBuildingUpdateBlockData(
        (70 << 2) | 2,
        'CLOSED',
        'CLOSED',
        60,
      ),
    }]);

    const saveFile = buildRuntimeSaveFile({
      description: 'source missile launcher rewrite',
      mapPath: 'Maps/RuntimeMissile/RuntimeMissile.map',
      mapData: {
        width: 1,
        height: 1,
        tiles: [0],
        objects: [],
        waypoints: [],
        namedAreas: [],
        namedPolygons: [],
        namedWaypointPaths: [],
        startPositions: [],
        meta: {
          name: 'RuntimeMissile',
          players: 1,
          supplyDockCount: 0,
          oilDerrickCount: 0,
          techBuildingCount: 0,
        },
        blendTileCount: 0,
      },
      cameraState: null,
      passthroughBlocks: [{
        blockName: 'CHUNK_GameLogic',
        blockData: sourceGameLogicBytes.slice().buffer,
      }],
      gameLogic: {
        captureSourceTerrainLogicRuntimeSaveState: () => ({
          version: 2,
          activeBoundary: 0,
          waterUpdates: [],
        }),
        captureSourcePartitionRuntimeSaveState: createEmptyPartitionState,
        captureSourcePlayerRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceRadarRuntimeSaveState: createEmptyRadarState,
        captureSourceSidesListRuntimeSaveState: () => createEmptySidesListState(),
        captureSourceTeamFactoryRuntimeSaveState: () => createEmptyTeamFactoryState(),
        captureSourceScriptEngineRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceInGameUiRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceGameLogicRuntimeSaveState: () => ({
          version: 10,
          nextId: 8,
          nextProjectileVisualId: 1,
          animationTime: 0,
          selectedEntityId: null,
          selectedEntityIds: [],
          scriptSelectionChangedFrame: 0,
          frameCounter: 42,
          controlBarDirtyFrame: 0,
          scriptObjectTopologyVersion: 0,
          scriptObjectCountChangedFrame: 0,
          defeatedSides: new Set<string>(),
          gameEndFrame: null,
          scriptEndGameTimerActive: false,
          objectTriggerAreaStates: [],
          spawnedEntities: [{
            id: 7,
            templateName: 'RuntimeTank',
            x: 10,
            y: 0,
            z: 20,
            rotationY: 1.25,
            missileLauncherBuildingProfile: {
              specialPowerTemplateName: 'SuperWeaponScudStorm',
              doorOpenTimeFrames: 45,
              doorWaitOpenTimeFrames: 60,
              doorClosingTimeFrames: 30,
            },
            missileLauncherBuildingState: {
              doorState: 'WAITING_TO_CLOSE',
              timeoutState: 'CLOSING',
              timeoutFrame: 123,
            },
          } as unknown as import('@generals/game-logic').MapEntity],
        }),
        resolveSourceObjectModuleTypeByTag: (templateName, moduleTag) =>
          templateName === 'RuntimeTank' && moduleTag === 'ModuleTag_MissileLauncher'
            ? 'MISSILELAUNCHERBUILDINGUPDATE'
            : null,
        captureBrowserRuntimeSaveState: () => ({ version: 1 }),
        getObjectIdCounter: () => 8,
      },
    });

    const firstObject = readFirstSourceGameLogicObjectState(saveFile.data);
    const missileModule = firstObject?.modules.find(
      (module) => module.identifier === 'ModuleTag_MissileLauncher',
    );

    expect(missileModule).toBeDefined();
    expect(parseSourceMissileLauncherBuildingUpdateBlockData(missileModule!.blockData)).toEqual({
      nextCallFrameAndPhase: (43 << 2) | 2,
      doorState: 'WAITING_TO_CLOSE',
      timeoutState: 'CLOSING',
      timeoutFrame: 123,
    });
  });

  it('rewrites source ParticleUplinkCannonUpdate modules from live runtime state', () => {
    const visualState = createTestParticleUplinkVisualState();
    const sourceGameLogicBytes = createSourceGameLogicChunkData(false, [{
      identifier: 'ModuleTag_ParticleUplink',
      blockData: createSourceParticleUplinkCannonUpdateBlockData(
        (70 << 2) | 2,
        1,
        2,
        15,
        visualState,
        { x: 1, y: 2, z: 3 },
        { x: 4, y: 5, z: 6 },
        9,
        111,
        222,
        1,
        120,
        80,
        95,
        77,
        66,
        true,
        false,
        321,
      ),
    }]);

    const saveFile = buildRuntimeSaveFile({
      description: 'source particle uplink rewrite',
      mapPath: 'Maps/RuntimeParticle/RuntimeParticle.map',
      mapData: {
        width: 1,
        height: 1,
        tiles: [0],
        objects: [],
        waypoints: [],
        namedAreas: [],
        namedPolygons: [],
        namedWaypointPaths: [],
        startPositions: [],
        meta: {
          name: 'RuntimeParticle',
          players: 1,
          supplyDockCount: 0,
          oilDerrickCount: 0,
          techBuildingCount: 0,
        },
        blendTileCount: 0,
      },
      cameraState: null,
      passthroughBlocks: [{
        blockName: 'CHUNK_GameLogic',
        blockData: sourceGameLogicBytes.slice().buffer,
      }],
      gameLogic: {
        captureSourceTerrainLogicRuntimeSaveState: () => ({
          version: 2,
          activeBoundary: 0,
          waterUpdates: [],
        }),
        captureSourcePartitionRuntimeSaveState: createEmptyPartitionState,
        captureSourcePlayerRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceRadarRuntimeSaveState: createEmptyRadarState,
        captureSourceSidesListRuntimeSaveState: () => createEmptySidesListState(),
        captureSourceTeamFactoryRuntimeSaveState: () => createEmptyTeamFactoryState(),
        captureSourceScriptEngineRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceInGameUiRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceGameLogicRuntimeSaveState: () => ({
          version: 10,
          nextId: 8,
          nextProjectileVisualId: 1,
          animationTime: 0,
          selectedEntityId: null,
          selectedEntityIds: [],
          scriptSelectionChangedFrame: 0,
          frameCounter: 42,
          controlBarDirtyFrame: 0,
          scriptObjectTopologyVersion: 0,
          scriptObjectCountChangedFrame: 0,
          defeatedSides: new Set<string>(),
          gameEndFrame: null,
          scriptEndGameTimerActive: false,
          objectTriggerAreaStates: [],
          spawnedEntities: [{
            id: 7,
            templateName: 'RuntimeTank',
            x: 10,
            y: 0,
            z: 20,
            rotationY: 1.25,
            particleUplinkCannonProfile: {
              specialPowerTemplateName: 'SuperWeaponParticleUplinkCannon',
              beginChargeFrames: 30,
              raiseAntennaFrames: 20,
              readyDelayFrames: 10,
              widthGrowFrames: 15,
              beamTravelFrames: 12,
              totalFiringFrames: 90,
              totalDamagePulses: 6,
              damagePerSecond: 100,
              damageType: 'LASER',
              damageRadiusScalar: 1,
              revealRange: 75,
              swathOfDeathDistance: 120,
              swathOfDeathAmplitude: 20,
              manualDrivingSpeed: 10,
              manualFastDrivingSpeed: 20,
            },
            particleUplinkCannonState: {
              status: 'FIRING',
              laserStatus: 'BORN',
              framesInState: 7,
              targetX: 44,
              targetZ: 66,
              currentTargetX: 55,
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
              nextDestWaypointID: 0,
            },
          } as unknown as import('@generals/game-logic').MapEntity],
        }),
        resolveSourceObjectModuleTypeByTag: (templateName, moduleTag) =>
          templateName === 'RuntimeTank' && moduleTag === 'ModuleTag_ParticleUplink'
            ? 'PARTICLEUPLINKCANNONUPDATE'
            : null,
        captureBrowserRuntimeSaveState: () => ({ version: 1 }),
        getObjectIdCounter: () => 8,
      },
    });

    const firstObject = readFirstSourceGameLogicObjectState(saveFile.data);
    const particleModule = firstObject?.modules.find(
      (module) => module.identifier === 'ModuleTag_ParticleUplink',
    );

    expect(particleModule).toBeDefined();
    expect(parseSourceParticleUplinkCannonUpdateBlockData(particleModule!.blockData)).toEqual({
      version: 3,
      nextCallFrameAndPhase: (43 << 2) | 2,
      status: 'FIRING',
      laserStatus: 1,
      frames: 7,
      visualState,
      initialTargetPosition: { x: 44, y: 2, z: 66 },
      currentTargetPosition: { x: 55, y: 5, z: 77 },
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
      nextDestWaypointID: 0,
    });
  });

  it('rewrites source CheckpointUpdate modules from live runtime state', () => {
    const sourceGameLogicBytes = createSourceGameLogicChunkData(false, [{
      identifier: 'ModuleTag_Checkpoint',
      blockData: createSourceCheckpointUpdateBlockData((70 << 2) | 2, false, false, 8, 1),
    }]);

    const saveFile = buildRuntimeSaveFile({
      description: 'source checkpoint rewrite',
      mapPath: 'Maps/RuntimeCheckpoint/RuntimeCheckpoint.map',
      mapData: {
        width: 1,
        height: 1,
        tiles: [0],
        objects: [],
        waypoints: [],
        namedAreas: [],
        namedPolygons: [],
        namedWaypointPaths: [],
        startPositions: [],
        meta: {
          name: 'RuntimeCheckpoint',
          players: 1,
          supplyDockCount: 0,
          oilDerrickCount: 0,
          techBuildingCount: 0,
        },
        blendTileCount: 0,
      },
      cameraState: null,
      passthroughBlocks: [{
        blockName: 'CHUNK_GameLogic',
        blockData: sourceGameLogicBytes.slice().buffer,
      }],
      gameLogic: {
        captureSourceTerrainLogicRuntimeSaveState: () => ({
          version: 2,
          activeBoundary: 0,
          waterUpdates: [],
        }),
        captureSourcePartitionRuntimeSaveState: createEmptyPartitionState,
        captureSourcePlayerRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceRadarRuntimeSaveState: createEmptyRadarState,
        captureSourceSidesListRuntimeSaveState: () => createEmptySidesListState(),
        captureSourceTeamFactoryRuntimeSaveState: () => createEmptyTeamFactoryState(),
        captureSourceScriptEngineRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceInGameUiRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceGameLogicRuntimeSaveState: () => ({
          version: 10,
          nextId: 8,
          nextProjectileVisualId: 1,
          animationTime: 0,
          selectedEntityId: null,
          selectedEntityIds: [],
          scriptSelectionChangedFrame: 0,
          frameCounter: 42,
          controlBarDirtyFrame: 0,
          scriptObjectTopologyVersion: 0,
          scriptObjectCountChangedFrame: 0,
          defeatedSides: new Set<string>(),
          gameEndFrame: null,
          scriptEndGameTimerActive: false,
          objectTriggerAreaStates: [],
          spawnedEntities: [{
            id: 7,
            templateName: 'RuntimeTank',
            x: 10,
            y: 0,
            z: 20,
            rotationY: 1.25,
            checkpointProfile: {
              scanDelayFrames: 30,
            },
            checkpointEnemyNear: true,
            checkpointAllyNear: false,
            checkpointMaxMinorRadius: 11.5,
            checkpointScanCountdown: 30,
          } as unknown as import('@generals/game-logic').MapEntity],
        }),
        resolveSourceObjectModuleTypeByTag: (templateName, moduleTag) =>
          templateName === 'RuntimeTank' && moduleTag === 'ModuleTag_Checkpoint'
            ? 'CHECKPOINTUPDATE'
            : null,
        captureBrowserRuntimeSaveState: () => ({ version: 1 }),
        getObjectIdCounter: () => 8,
      },
    });

    const firstObject = readFirstSourceGameLogicObjectState(saveFile.data);
    const checkpointModule = firstObject?.modules.find(
      (module) => module.identifier === 'ModuleTag_Checkpoint',
    );

    expect(checkpointModule).toBeDefined();
    expect(parseSourceCheckpointUpdateBlockData(checkpointModule!.blockData)).toEqual({
      nextCallFrameAndPhase: (43 << 2) | 2,
      enemyNear: true,
      allyNear: false,
      maxMinorRadius: 11.5,
      enemyScanDelay: 30,
    });
  });

  it('rewrites source StructureToppleUpdate modules from live runtime state', () => {
    const sourceGameLogicBytes = createSourceGameLogicChunkData(false, [{
      identifier: 'ModuleTag_Topple',
      blockData: createSourceStructureToppleUpdateBlockData(
        (70 << 2) | 2,
        90,
        0.25,
        -0.75,
        'WAITING',
        0.1,
        0.2,
        0.8,
        12,
        95,
        { x: 1, y: 2, z: 3 },
      ),
    }]);

    const saveFile = buildRuntimeSaveFile({
      description: 'source structure topple rewrite',
      mapPath: 'Maps/RuntimeTopple/RuntimeTopple.map',
      mapData: {
        width: 1,
        height: 1,
        tiles: [0],
        objects: [],
        waypoints: [],
        namedAreas: [],
        namedPolygons: [],
        namedWaypointPaths: [],
        startPositions: [],
        meta: {
          name: 'RuntimeTopple',
          players: 1,
          supplyDockCount: 0,
          oilDerrickCount: 0,
          techBuildingCount: 0,
        },
        blendTileCount: 0,
      },
      cameraState: null,
      passthroughBlocks: [{
        blockName: 'CHUNK_GameLogic',
        blockData: sourceGameLogicBytes.slice().buffer,
      }],
      gameLogic: {
        captureSourceTerrainLogicRuntimeSaveState: () => ({
          version: 2,
          activeBoundary: 0,
          waterUpdates: [],
        }),
        captureSourcePartitionRuntimeSaveState: createEmptyPartitionState,
        captureSourcePlayerRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceRadarRuntimeSaveState: createEmptyRadarState,
        captureSourceSidesListRuntimeSaveState: () => createEmptySidesListState(),
        captureSourceTeamFactoryRuntimeSaveState: () => createEmptyTeamFactoryState(),
        captureSourceScriptEngineRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceInGameUiRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceGameLogicRuntimeSaveState: () => ({
          version: 10,
          nextId: 8,
          nextProjectileVisualId: 1,
          animationTime: 0,
          selectedEntityId: null,
          selectedEntityIds: [],
          scriptSelectionChangedFrame: 0,
          frameCounter: 42,
          controlBarDirtyFrame: 0,
          scriptObjectTopologyVersion: 0,
          scriptObjectCountChangedFrame: 0,
          defeatedSides: new Set<string>(),
          gameEndFrame: null,
          scriptEndGameTimerActive: false,
          objectTriggerAreaStates: [],
          spawnedEntities: [{
            id: 7,
            templateName: 'RuntimeTank',
            x: 10,
            y: 0,
            z: 20,
            rotationY: 1.25,
            structureToppleProfile: {
              minToppleDelayFrames: 15,
              maxToppleDelayFrames: 30,
              minToppleBurstDelayFrames: 6,
              maxToppleBurstDelayFrames: 12,
              structuralIntegrity: 0.5,
              structuralDecay: 0.9,
              crushingWeaponName: 'StructureCrush',
            },
            structureToppleState: {
              state: 'TOPPLING',
              toppleFrame: 64,
              toppleVelocity: 0.45,
              accumulatedAngle: 0.9,
              structuralIntegrity: 0.35,
              toppleDirX: -0.6,
              toppleDirZ: 0.8,
              buildingHeight: 22,
              lastCrushedLocation: 19.5,
              nextBurstFrame: -1,
              delayBurstLocation: { x: 14, y: 3, z: 28 },
            },
          } as unknown as import('@generals/game-logic').MapEntity],
        }),
        resolveSourceObjectModuleTypeByTag: (templateName, moduleTag) =>
          templateName === 'RuntimeTank' && moduleTag === 'ModuleTag_Topple'
            ? 'STRUCTURETOPPLEUPDATE'
            : null,
        captureBrowserRuntimeSaveState: () => ({ version: 1 }),
        getObjectIdCounter: () => 8,
      },
    });

    const firstObject = readFirstSourceGameLogicObjectState(saveFile.data);
    const toppleModule = firstObject?.modules.find(
      (module) => module.identifier === 'ModuleTag_Topple',
    );

    expect(toppleModule).toBeDefined();
    const parsedToppleModule = parseSourceStructureToppleUpdateBlockData(toppleModule!.blockData);
    expect(parsedToppleModule.nextCallFrameAndPhase).toBe((43 << 2) | 2);
    expect(parsedToppleModule.toppleFrame).toBe(64);
    expect(parsedToppleModule.toppleDirX).toBeCloseTo(-0.6, 5);
    expect(parsedToppleModule.toppleDirZ).toBeCloseTo(0.8, 5);
    expect(parsedToppleModule.toppleState).toBe('TOPPLING');
    expect(parsedToppleModule.toppleVelocity).toBeCloseTo(0.45, 5);
    expect(parsedToppleModule.accumulatedAngle).toBeCloseTo(0.9, 5);
    expect(parsedToppleModule.structuralIntegrity).toBeCloseTo(0.35, 5);
    expect(parsedToppleModule.lastCrushedLocation).toBeCloseTo(19.5, 5);
    expect(parsedToppleModule.nextBurstFrame).toBe(95);
    expect(parsedToppleModule.delayBurstLocation).toEqual({ x: 14, y: 3, z: 28 });
  });

  it('rewrites source ToppleUpdate modules from live runtime state', () => {
    const sourceGameLogicBytes = createSourceGameLogicChunkData(false, [{
      identifier: 'ModuleTag_ToppleTree',
      blockData: createSourceToppleUpdateBlockData(
        (80 << 2) | 2,
        0.9,
        0.2,
        0.25,
        -0.5,
        'TOPPLING',
        0.4,
        0.15,
        3,
        true,
        2,
        99,
      ),
    }]);

    const saveFile = buildRuntimeSaveFile({
      description: 'source topple rewrite',
      mapPath: 'Maps/RuntimeToppleTree/RuntimeToppleTree.map',
      mapData: {
        width: 1,
        height: 1,
        tiles: [0],
        objects: [],
        waypoints: [],
        namedAreas: [],
        namedPolygons: [],
        namedWaypointPaths: [],
        startPositions: [],
        meta: {
          name: 'RuntimeToppleTree',
          players: 1,
          supplyDockCount: 0,
          oilDerrickCount: 0,
          techBuildingCount: 0,
        },
        blendTileCount: 0,
      },
      cameraState: null,
      passthroughBlocks: [{
        blockName: 'CHUNK_GameLogic',
        blockData: sourceGameLogicBytes.slice().buffer,
      }],
      gameLogic: {
        captureSourceTerrainLogicRuntimeSaveState: () => ({
          version: 2,
          activeBoundary: 0,
          waterUpdates: [],
        }),
        captureSourcePartitionRuntimeSaveState: createEmptyPartitionState,
        captureSourcePlayerRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceRadarRuntimeSaveState: createEmptyRadarState,
        captureSourceSidesListRuntimeSaveState: () => createEmptySidesListState(),
        captureSourceTeamFactoryRuntimeSaveState: () => createEmptyTeamFactoryState(),
        captureSourceScriptEngineRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceInGameUiRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceGameLogicRuntimeSaveState: () => ({
          version: 10,
          nextId: 8,
          nextProjectileVisualId: 1,
          animationTime: 0,
          selectedEntityId: null,
          selectedEntityIds: [],
          scriptSelectionChangedFrame: 0,
          frameCounter: 42,
          controlBarDirtyFrame: 0,
          scriptObjectTopologyVersion: 0,
          scriptObjectCountChangedFrame: 0,
          defeatedSides: new Set<string>(),
          gameEndFrame: null,
          scriptEndGameTimerActive: false,
          objectTriggerAreaStates: [],
          spawnedEntities: [{
            id: 7,
            templateName: 'RuntimeTank',
            x: 10,
            y: 0,
            z: 20,
            rotationY: 1.25,
            toppleProfile: {
              initialVelocityPercent: 0.75,
              initialAccelPercent: 0.2,
              bounceVelocityPercent: 0.5,
              killWhenFinishedToppling: false,
              killWhenStartToppling: false,
              toppleLeftOrRightOnly: false,
              reorientToppledRubble: false,
            },
            toppleState: 'BOUNCING',
            toppleDirX: -0.8,
            toppleDirZ: 0.6,
            toppleAngularVelocity: -0.35,
            toppleAngularAccumulation: 1.1,
            toppleSpeed: 5,
          } as unknown as import('@generals/game-logic').MapEntity],
        }),
        resolveSourceObjectModuleTypeByTag: (templateName, moduleTag) =>
          templateName === 'RuntimeTank' && moduleTag === 'ModuleTag_ToppleTree'
            ? 'TOPPLEUPDATE'
            : null,
        captureBrowserRuntimeSaveState: () => ({ version: 1 }),
        getObjectIdCounter: () => 8,
      },
    });

    const firstObject = readFirstSourceGameLogicObjectState(saveFile.data);
    const toppleModule = firstObject?.modules.find(
      (module) => module.identifier === 'ModuleTag_ToppleTree',
    );

    expect(toppleModule).toBeDefined();
    const parsedToppleModule = parseSourceToppleUpdateBlockData(toppleModule!.blockData);
    expect(parsedToppleModule.nextCallFrameAndPhase).toBe((43 << 2) | 2);
    expect(parsedToppleModule.angularVelocity).toBeCloseTo(-0.35, 5);
    expect(parsedToppleModule.angularAcceleration).toBeCloseTo(1.0, 5);
    expect(parsedToppleModule.toppleDirX).toBeCloseTo(-0.8, 5);
    expect(parsedToppleModule.toppleDirZ).toBeCloseTo(0.6, 5);
    expect(parsedToppleModule.toppleState).toBe('TOPPLING');
    expect(parsedToppleModule.angularAccumulation).toBeCloseTo(1.1, 5);
    expect(parsedToppleModule.angleDeltaX).toBeCloseTo(0.15, 5);
    expect(parsedToppleModule.numAngleDeltaX).toBe(3);
    expect(parsedToppleModule.doBounceFx).toBe(true);
    expect(parsedToppleModule.options).toBe(2);
    expect(parsedToppleModule.stumpId).toBe(99);
  });

  it('rewrites source StructureCollapseUpdate modules from live runtime state', () => {
    const sourceGameLogicBytes = createSourceGameLogicChunkData(false, [{
      identifier: 'ModuleTag_Collapse',
      blockData: createSourceStructureCollapseUpdateBlockData(
        (90 << 2) | 2,
        120,
        130,
        'WAITING',
        0.2,
        -1.5,
      ),
    }]);

    const saveFile = buildRuntimeSaveFile({
      description: 'source structure collapse rewrite',
      mapPath: 'Maps/RuntimeCollapse/RuntimeCollapse.map',
      mapData: {
        width: 1,
        height: 1,
        tiles: [0],
        objects: [],
        waypoints: [],
        namedAreas: [],
        namedPolygons: [],
        namedWaypointPaths: [],
        startPositions: [],
        meta: {
          name: 'RuntimeCollapse',
          players: 1,
          supplyDockCount: 0,
          oilDerrickCount: 0,
          techBuildingCount: 0,
        },
        blendTileCount: 0,
      },
      cameraState: null,
      passthroughBlocks: [{
        blockName: 'CHUNK_GameLogic',
        blockData: sourceGameLogicBytes.slice().buffer,
      }],
      gameLogic: {
        captureSourceTerrainLogicRuntimeSaveState: () => ({
          version: 2,
          activeBoundary: 0,
          waterUpdates: [],
        }),
        captureSourcePartitionRuntimeSaveState: createEmptyPartitionState,
        captureSourcePlayerRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceRadarRuntimeSaveState: createEmptyRadarState,
        captureSourceSidesListRuntimeSaveState: () => createEmptySidesListState(),
        captureSourceTeamFactoryRuntimeSaveState: () => createEmptyTeamFactoryState(),
        captureSourceScriptEngineRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceInGameUiRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceGameLogicRuntimeSaveState: () => ({
          version: 10,
          nextId: 8,
          nextProjectileVisualId: 1,
          animationTime: 0,
          selectedEntityId: null,
          selectedEntityIds: [],
          scriptSelectionChangedFrame: 0,
          frameCounter: 42,
          controlBarDirtyFrame: 0,
          scriptObjectTopologyVersion: 0,
          scriptObjectCountChangedFrame: 0,
          defeatedSides: new Set<string>(),
          gameEndFrame: null,
          scriptEndGameTimerActive: false,
          objectTriggerAreaStates: [],
          spawnedEntities: [{
            id: 7,
            templateName: 'RuntimeTank',
            x: 10,
            y: 0,
            z: 20,
            rotationY: 1.25,
            structureCollapseProfile: {
              deathTypes: new Set<string>(),
              veterancyLevels: new Set<string>(),
              exemptStatus: new Set<string>(),
              requiredStatus: new Set<string>(),
              minCollapseDelay: 10,
              maxCollapseDelay: 20,
              minBurstDelay: 5,
              maxBurstDelay: 8,
              collapseDamping: 0.25,
              bigBurstFrequency: 4,
              maxShudder: 3,
              phaseOCLs: [[], [], [], []],
            },
            structureCollapseState: {
              state: 'COLLAPSING',
              collapseFrame: 71,
              burstFrame: 77,
              currentHeight: -6.5,
              collapseVelocity: 1.75,
            },
          } as unknown as import('@generals/game-logic').MapEntity],
        }),
        resolveSourceObjectModuleTypeByTag: (templateName, moduleTag) =>
          templateName === 'RuntimeTank' && moduleTag === 'ModuleTag_Collapse'
            ? 'STRUCTURECOLLAPSEUPDATE'
            : null,
        captureBrowserRuntimeSaveState: () => ({ version: 1 }),
        getObjectIdCounter: () => 8,
      },
    });

    const firstObject = readFirstSourceGameLogicObjectState(saveFile.data);
    const collapseModule = firstObject?.modules.find(
      (module) => module.identifier === 'ModuleTag_Collapse',
    );

    expect(collapseModule).toBeDefined();
    const parsedCollapseModule = parseSourceStructureCollapseUpdateBlockData(collapseModule!.blockData);
    expect(parsedCollapseModule.nextCallFrameAndPhase).toBe((43 << 2) | 2);
    expect(parsedCollapseModule.collapseFrame).toBe(71);
    expect(parsedCollapseModule.burstFrame).toBe(77);
    expect(parsedCollapseModule.collapseState).toBe('COLLAPSING');
    expect(parsedCollapseModule.collapseVelocity).toBeCloseTo(1.75, 5);
    expect(parsedCollapseModule.currentHeight).toBeCloseTo(-6.5, 5);
  });

  it('rewrites source OCLUpdate modules via resolved module tags', () => {
    const sourceGameLogicBytes = createSourceGameLogicChunkData(false, [{
      identifier: 'ModuleTag_OCLSpawn',
      blockData: createSourceOclUpdateBlockData((66 << 2) | 2, 90, 60, false, -12345),
    }]);

    const saveFile = buildRuntimeSaveFile({
      description: 'source ocl rewrite',
      mapPath: 'Maps/RuntimeTank/RuntimeTank.map',
      mapData: {
        width: 1,
        height: 1,
        tiles: [0],
        objects: [],
        waypoints: [],
        namedAreas: [],
        namedPolygons: [],
        namedWaypointPaths: [],
        startPositions: [],
        meta: {
          name: 'RuntimeTank',
          players: 1,
          supplyDockCount: 0,
          oilDerrickCount: 0,
          techBuildingCount: 0,
        },
        blendTileCount: 0,
      },
      cameraState: null,
      passthroughBlocks: [{
        blockName: 'CHUNK_GameLogic',
        blockData: sourceGameLogicBytes.slice().buffer,
      }],
      gameLogic: {
        captureSourceTerrainLogicRuntimeSaveState: () => ({
          version: 2,
          activeBoundary: 0,
          waterUpdates: [],
        }),
        captureSourcePartitionRuntimeSaveState: createEmptyPartitionState,
        captureSourcePlayerRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceRadarRuntimeSaveState: createEmptyRadarState,
        captureSourceSidesListRuntimeSaveState: () => createEmptySidesListState(),
        captureSourceTeamFactoryRuntimeSaveState: () => createEmptyTeamFactoryState(),
        captureSourceScriptEngineRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceInGameUiRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceGameLogicRuntimeSaveState: () => ({
          version: 10,
          nextId: 8,
          nextProjectileVisualId: 1,
          animationTime: 0,
          selectedEntityId: null,
          selectedEntityIds: [],
          scriptSelectionChangedFrame: 0,
          frameCounter: 42,
          controlBarDirtyFrame: 0,
          scriptObjectTopologyVersion: 0,
          scriptObjectCountChangedFrame: 0,
          defeatedSides: new Set<string>(),
          gameEndFrame: null,
          scriptEndGameTimerActive: false,
          objectTriggerAreaStates: [],
          spawnedEntities: [{
            id: 7,
            templateName: 'RuntimeTank',
            x: 10,
            y: 0,
            z: 20,
            rotationY: 1.25,
            oclUpdateProfiles: [{
              moduleTag: 'MODULETAG_OCLSPAWN',
              oclName: 'OCLSpawnUnit',
              minDelayFrames: 30,
              maxDelayFrames: 30,
              createAtEdge: false,
              factionTriggered: true,
              factionOCLMap: new Map([['CHINA', 'OCLSpawnUnit']]),
            }],
            oclUpdateNextCreationFrames: [96],
            oclUpdateTimerStarted: [true],
            oclUpdateTimerStartedFrames: [63],
            oclUpdateFactionNeutral: [false],
            oclUpdateFactionOwnerSide: ['China'],
            oclUpdateCurrentPlayerColors: [-123456],
          } as unknown as import('@generals/game-logic').MapEntity],
        }),
        resolveSourceObjectModuleTypeByTag: (templateName, moduleTag) =>
          templateName === 'RuntimeTank' && moduleTag === 'ModuleTag_OCLSpawn'
            ? 'OCLUPDATE'
            : null,
        captureBrowserRuntimeSaveState: () => ({ version: 1 }),
        getObjectIdCounter: () => 8,
      },
    });

    const firstObject = readFirstSourceGameLogicObjectState(saveFile.data);
    const oclModule = firstObject?.modules.find((module) => module.identifier === 'ModuleTag_OCLSpawn');

    expect(oclModule).toBeDefined();
    expect(parseSourceOclUpdateBlockData(oclModule!.blockData)).toEqual({
      nextCallFrameAndPhase: (43 << 2) | 2,
      nextCreationFrame: 96,
      timerStartedFrame: 63,
      factionNeutral: false,
      currentPlayerColor: -123456,
    });
  });

  it('hydrates team-factory prototypes from source GameLogic team names when legacy core state is absent', () => {
    const sourceTeamFactoryChunk = buildSourceTeamFactoryChunk(
      createEmptyTeamFactoryState('TEAMUNIT'),
      null,
      null,
    );

    const restored = applySourceTeamFactoryChunkToState(
      sourceTeamFactoryChunk,
      createEmptyTeamFactoryState(),
      null,
      null,
      null,
      ['TEAMUNIT'],
    );

    expect(restored.state.scriptNextSourceTeamId).toBe(1);
    expect(restored.state.scriptTeamInstanceNamesByPrototypeName).toEqual(
      new Map([['TEAMUNIT', ['TEAMUNIT']]]),
    );
    expect(restored.state.scriptTeamsByName).toEqual(new Map([['TEAMUNIT', {
      nameUpper: 'TEAMUNIT',
      prototypeNameUpper: 'TEAMUNIT',
      sourcePrototypeId: 1,
      sourceTeamId: null,
      memberEntityIds: new Set<number>(),
      created: false,
      stateName: '',
      attackPrioritySetName: '',
      recruitableOverride: null,
      isAIRecruitable: false,
      homeWaypointName: '',
      controllingSide: null,
      controllingPlayerToken: null,
      isSingleton: true,
      maxInstances: 0,
      productionPriority: 0,
      productionPrioritySuccessIncrease: 0,
      productionPriorityFailureDecrease: 0,
      reinforcementUnitEntries: [],
      reinforcementTransportTemplateName: '',
      reinforcementStartWaypointName: '',
      reinforcementTeamStartsFull: false,
      reinforcementTransportsExit: false,
    }]]));
  });

  it('round-trips live particle-system save state through CHUNK_ParticleSystem', () => {
    const mapData = {
      heightmap: {
        width: 2,
        height: 2,
        borderSize: 0,
        data: 'AAAAAA==',
      },
      objects: [],
      triggers: [],
      waypoints: { nodes: [], links: [] },
      textureClasses: [],
      blendTileCount: 0,
    };

    const particleSystemState = {
      version: 1 as const,
      nextId: 4,
      systems: [{
        id: 3,
        template: {
          name: 'SmokePuff',
          priority: 'WEAPON_EXPLOSION' as const,
          isOneShot: true,
          shader: 'ALPHA' as const,
          type: 'PARTICLE' as const,
          particleName: 'EXSmokNew1.tga',
          angleZ: { min: 0, max: 0.2 },
          angularRateZ: { min: 0, max: 0.05 },
          angularDamping: { min: 1, max: 1 },
          velocityDamping: { min: 0.98, max: 0.98 },
          gravity: 0.01,
          lifetime: { min: 30, max: 30 },
          systemLifetime: 60,
          size: { min: 1, max: 1.5 },
          startSizeRate: { min: 0, max: 0 },
          sizeRate: { min: 0.01, max: 0.01 },
          sizeRateDamping: { min: 1, max: 1 },
          alphaKeyframes: [
            { alphaMin: 0, alphaMax: 0, frame: 0 },
            { alphaMin: 1, alphaMax: 1, frame: 15 },
            { alphaMin: 0, alphaMax: 0, frame: 30 },
          ],
          colorKeyframes: [
            { r: 255, g: 255, b: 255, frame: 0 },
          ],
          colorScale: { min: 1, max: 1 },
          burstDelay: { min: 1, max: 1 },
          burstCount: { min: 1, max: 1 },
          initialDelay: { min: 0, max: 0 },
          driftVelocity: { x: 0, y: 0.01, z: 0 },
          velocityType: 'SPHERICAL' as const,
          velOrtho: {
            x: { min: 0, max: 0 },
            y: { min: 0, max: 0 },
            z: { min: 0, max: 0 },
          },
          velOutward: { min: 0, max: 0 },
          velOutwardOther: { min: 0, max: 0 },
          velSpherical: { min: 0.5, max: 0.5 },
          velHemispherical: { min: 0, max: 0 },
          velCylindrical: {
            radial: { min: 0, max: 0 },
            normal: { min: 0, max: 0 },
          },
          volumeType: 'POINT' as const,
          volLineStart: { x: 0, y: 0, z: 0 },
          volLineEnd: { x: 0, y: 0, z: 0 },
          volBoxHalfSize: { x: 0, y: 0, z: 0 },
          volSphereRadius: 0,
          volCylinderRadius: 0,
          volCylinderLength: 0,
          isHollow: false,
          isGroundAligned: false,
          isEmitAboveGroundOnly: false,
          isParticleUpTowardsEmitter: false,
          windMotion: 'Unused' as const,
          windAngleChangeMin: 0.15,
          windAngleChangeMax: 0.45,
          windPingPongStartAngleMin: 0,
          windPingPongStartAngleMax: Math.PI / 4,
          windPingPongEndAngleMin: 5.5,
          windPingPongEndAngleMax: Math.PI * 2,
        },
        position: { x: 12, y: 3, z: 18 },
        orientation: { x: 0, y: 0, z: 0, w: 1 },
        particleCount: 1,
        particles: [
          12, 3, 18,
          0.2, 0.1, -0.05,
          0.75,
          1, 1, 1,
          1.4,
          8,
          30,
          0.1,
          0.02,
          0.01,
          1,
          0.98,
          1,
          0.5,
        ],
        burstTimer: 1,
        systemAge: 9,
        initialDelayRemaining: 0,
        alive: true,
        windAngle: 0,
        windAngleChange: 0.15,
        windMotionMovingToEnd: true,
        windPingPongTargetAngle: Math.PI * 2,
        slaveSystemId: null,
        masterSystemId: null,
        attachedParticleSystems: [],
        prevPositions: [11.8, 2.9, 18.1],
      }],
    };

    const saveFile = buildRuntimeSaveFile({
      description: 'Particle Runtime Save',
      mapPath: 'assets/maps/ScenarioSkirmish.json',
      mapData,
      cameraState: {
        targetX: 12,
        targetZ: 18,
        angle: 0,
        zoom: 120,
        pitch: 1,
      },
      particleSystemState,
      gameLogic: {
        captureSourceTerrainLogicRuntimeSaveState: () => ({ version: 2, activeBoundary: 0, waterUpdates: [] }),
        captureSourcePartitionRuntimeSaveState: () => createEmptyPartitionState(),
        captureSourcePlayerRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceRadarRuntimeSaveState: () => createEmptyRadarState(),
        captureSourceSidesListRuntimeSaveState: () => createEmptySidesListState(),
        captureSourceTeamFactoryRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceScriptEngineRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceInGameUiRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceGameLogicRuntimeSaveState: () => ({
          version: 1,
          nextId: 10,
          nextProjectileVisualId: 1,
          animationTime: 0,
          selectedEntityId: null,
          selectedEntityIds: [],
          scriptSelectionChangedFrame: -1,
          controlBarDirtyFrame: -1,
          frameCounter: 0,
          scriptObjectTopologyVersion: 0,
          scriptObjectCountChangedFrame: 0,
          defeatedSides: new Set<string>(),
          gameEndFrame: null,
          scriptEndGameTimerActive: false,
          spawnedEntities: [],
        }),
        captureBrowserRuntimeSaveState: () => ({ version: 1, spawnedEntities: [] }),
        getObjectIdCounter: () => 10,
      },
    });

    const parsed = parseRuntimeSaveFile(saveFile.data);
    expect(parsed.particleSystemState).not.toBeNull();
    expect(parsed.particleSystemState?.nextId).toBe(4);
    expect(parsed.particleSystemState?.systems).toHaveLength(1);
    expect(parsed.particleSystemState?.systems[0]?.template.name).toBe('SmokePuff');
    expect(parsed.particleSystemState?.systems[0]?.particleCount).toBe(1);
    expect(parsed.particleSystemState?.systems[0]?.particles.slice(0, 3)).toEqual([12, 3, 18]);
    expect(parsed.particleSystemState?.systems[0]?.prevPositions?.[0]).toBeCloseTo(11.8, 5);
    expect(parsed.particleSystemState?.systems[0]?.prevPositions?.[1]).toBeCloseTo(2.9, 5);
    expect(parsed.particleSystemState?.systems[0]?.prevPositions?.[2]).toBeCloseTo(18.1, 5);
  });
});
