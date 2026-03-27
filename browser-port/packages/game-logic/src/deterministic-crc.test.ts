import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { DeterministicStateKernel } from '@generals/engine';
import { IniDataRegistry } from '@generals/ini-data';
import { HeightmapGrid, type MapDataJSON } from '@generals/terrain';

import { GameLogicSubsystem } from './index.js';
import type { GameLogicCommand } from './types.js';

const EMPTY_HEIGHTMAP_BASE64 = 'AAAAAA==';

function createTestMapData(): MapDataJSON {
  return {
    heightmap: {
      width: 2,
      height: 2,
      borderSize: 0,
      data: EMPTY_HEIGHTMAP_BASE64,
    },
    objects: [
      {
        position: {
          x: 5,
          y: 5,
          z: 0,
        },
        angle: 0,
        templateName: 'TestEntity',
        flags: 0,
        properties: {},
      },
    ],
    triggers: [],
    textureClasses: [],
    blendTileCount: 0,
  };
}

function createSubsystem(): GameLogicSubsystem {
  const scene = new THREE.Scene();
  const subsystem = new GameLogicSubsystem(scene);
  const heightmap = new HeightmapGrid(2, 2, 0, new Uint8Array([0, 0, 0, 0]));
  subsystem.loadMapObjects(createTestMapData(), new IniDataRegistry(), heightmap);
  return subsystem;
}

function computeGameLogicCrc(subsystem: GameLogicSubsystem, frame = 0): number {
  const kernel = new DeterministicStateKernel({
    gameLogicCrcSectionWriters: subsystem.createDeterministicGameLogicCrcSectionWriters(),
  });
  const crc = kernel.computeGameLogicCrc(frame);
  if (crc === null) {
    throw new Error('expected deterministic GameLogic CRC');
  }
  return crc;
}

function applyDeterministicStressInputs(subsystem: GameLogicSubsystem, frame: number): void {
  if (frame % 2 === 0) {
    subsystem.submitCommand({ type: 'clearSelection' });
  }
  if (frame % 3 === 0) {
    subsystem.submitCommand({ type: 'select', entityId: 1 });
  }
  if (frame % 5 === 0) {
    subsystem.executeScriptAction({ actionType: 170 }); // REFRESH_RADAR
  }
  if (frame % 7 === 0) {
    subsystem.notifyScriptSpeechCompleted(`StressSpeech_${frame}`);
  }
  if (frame % 11 === 0) {
    subsystem.setScriptFlag('StressFlag', (frame % 22) === 0);
  }
  if (frame % 13 === 0) {
    subsystem.setScriptCounter('StressCounter', frame);
  }
}

function runDeterministicStressReplay(totalFrames: number): number[] {
  const subsystem = createSubsystem();
  try {
    const crcTimeline: number[] = [];
    for (let frame = 0; frame < totalFrames; frame += 1) {
      applyDeterministicStressInputs(subsystem, frame);
      subsystem.update(1 / 30);
      crcTimeline.push(computeGameLogicCrc(subsystem, frame));
    }
    return crcTimeline;
  } finally {
    subsystem.dispose();
  }
}

const LONG_STRESS_REPLAY_TOTAL_FRAMES = 1200;
const LONG_STRESS_REPLAY_CHECKPOINT_FRAMES = [0, 1, 2, 5, 10, 30, 60, 120, 240, 480, 720, 960, 1199] as const;
const CAMPAIGN_REPLAY_TOTAL_FRAMES = 130;
const CAMPAIGN_REPLAY_CHECKPOINT_FRAMES = [0, 1, 2, 5, 10, 15, 20, 30, 45, 60, 90, 120, 129] as const;
const CAMPAIGN_PROGRESS_CHECKPOINT_FRAMES_BASE = [0, 1, 2, 5, 10] as const;

interface CampaignReplayOutcome {
  crcTimeline: number[];
  checkpointCrcs: number[];
  missionState: {
    missionStage: number | null;
    missionTimer: number | null;
    extractionTimer: number | null;
    missionStarted: boolean;
    objectiveComplete: boolean;
    extractionCalled: boolean;
    inputDisabled: boolean;
    radarForced: boolean;
    radarRefreshFrame: number | null;
  };
  completionState: {
    speechLine1: boolean;
    timedSpeechLine2: boolean;
    audioExplosion: boolean;
    musicTrackA: boolean;
    missionOutroVideo: boolean;
  };
}

interface CampaignProgressCertificationCase {
  name: 'early' | 'mid' | 'late';
  totalFrames: number;
  checkpointCrcs: number[];
  missionState: CampaignReplayOutcome['missionState'];
  completionState: CampaignReplayOutcome['completionState'];
}

function applyCampaignReplayInputs(subsystem: GameLogicSubsystem, frame: number): void {
  switch (frame) {
    case 0:
      subsystem.setScriptCurrentPlayerSide('America');
      subsystem.setScriptCallingTeamContext('MissionTeam');
      subsystem.setScriptCallingEntityContext(1);
      subsystem.setScriptTeamMembers('MissionTeam', [1]);
      subsystem.setScriptTeamPrototype('MissionTeam', 'MissionTeamProto');
      subsystem.setScriptTeamState('MissionTeam', 'Advance');
      subsystem.executeScriptAction({ actionType: 'SET_FLAG', flagName: 'MissionStarted', value: true });
      subsystem.executeScriptAction({ actionType: 'SET_FLAG', flagName: 'ObjectiveComplete', value: false });
      subsystem.executeScriptAction({ actionType: 'SET_COUNTER', counterName: 'MissionStage', value: 1 });
      subsystem.executeScriptAction({ actionType: 'SET_TIMER', counterName: 'MissionTimer', value: 20 });
      subsystem.executeScriptAction({
        actionType: 'DISPLAY_COUNTDOWN_TIMER',
        timerName: 'MissionTimer',
        timerText: 'Mission Time',
      });
      subsystem.executeScriptAction({ actionType: 'RADAR_FORCE_ENABLE' });
      subsystem.submitCommand({ type: 'select', entityId: 1 });
      break;
    case 1:
      subsystem.executeScriptAction({ actionType: 'CALL_SUBROUTINE', scriptName: 'Mission_Subroutine_Init' });
      break;
    case 3:
      subsystem.executeScriptAction({ actionType: 'INCREMENT_COUNTER', value: 2, counterName: 'MissionStage' });
      break;
    case 5:
      subsystem.executeScriptAction({ actionType: 'STOP_TIMER', counterName: 'MissionTimer' });
      subsystem.notifyScriptSpeechCompleted('MissionBriefing_Line1');
      break;
    case 6:
      subsystem.setScriptAudioLengthMs('MissionBriefing_Line2', 1200);
      subsystem.evaluateScriptSpeechHasCompleted({ speechName: 'MissionBriefing_Line2' });
      break;
    case 7:
      subsystem.notifyScriptAudioCompleted('MissionExplosion');
      break;
    case 8:
      subsystem.notifyScriptMusicCompleted('MissionTrackA', 0);
      break;
    case 10:
      subsystem.executeScriptAction({ actionType: 'RESTART_TIMER', counterName: 'MissionTimer' });
      break;
    case 12:
      subsystem.executeScriptAction({ actionType: 'DISABLE_INPUT' });
      break;
    case 14:
      subsystem.executeScriptAction({ actionType: 'ENABLE_INPUT' });
      break;
    case 15:
      subsystem.executeScriptAction({ actionType: 'ADD_TO_MSEC_TIMER', value: 1, counterName: 'MissionTimer' });
      break;
    case 16:
      subsystem.executeScriptAction({ actionType: 'SUB_FROM_MSEC_TIMER', value: 0.5, counterName: 'MissionTimer' });
      break;
    case 18:
      subsystem.executeScriptAction({ actionType: 'DECREMENT_COUNTER', value: 1, counterName: 'MissionStage' });
      break;
    case 20:
      subsystem.executeScriptAction({ actionType: 'SET_FLAG', flagName: 'ObjectiveComplete', value: true });
      break;
    case 22:
      subsystem.executeScriptAction({ actionType: 'RADAR_REVERT_TO_NORMAL' });
      break;
    case 24:
      subsystem.executeScriptAction({ actionType: 'INCREMENT_COUNTER', value: 3, counterName: 'MissionStage' });
      break;
    case 30:
      subsystem.notifyScriptUIInteraction('MissionUIPulse');
      break;
    case 40:
      subsystem.executeScriptAction({ actionType: 'SET_FLAG', flagName: 'ExtractionCalled', value: true });
      subsystem.setScriptCameraMovementFinished(false);
      break;
    case 45:
      subsystem.setScriptCameraMovementFinished(true);
      subsystem.setScriptCounter('MissionStage', 4);
      break;
    case 52:
      subsystem.executeScriptAction({
        actionType: 'SET_MILLISECOND_TIMER',
        counterName: 'ExtractionTimer',
        seconds: 2,
      });
      break;
    case 60:
      subsystem.setScriptFlag('MissionStarted', false);
      break;
    case 75:
      subsystem.notifyScriptSubroutineCall('Mission_Subroutine_Extraction');
      break;
    case 90:
      subsystem.submitCommand({ type: 'clearSelection' });
      break;
    case 95:
      subsystem.submitCommand({ type: 'select', entityId: 1 });
      break;
    case 110:
      subsystem.notifyScriptVideoCompleted('MissionOutro');
      break;
    case 120:
      subsystem.executeScriptAction({ actionType: 'HIDE_COUNTDOWN_TIMER', timerName: 'MissionTimer' });
      break;
    default:
      break;
  }

  if (frame % 9 === 0) {
    subsystem.executeScriptAction({ actionType: 'REFRESH_RADAR' });
  }
}

function runCampaignScenarioReplay(totalFrames = CAMPAIGN_REPLAY_TOTAL_FRAMES): CampaignReplayOutcome {
  const subsystem = createSubsystem();
  try {
    const crcTimeline: number[] = [];
    for (let frame = 0; frame < totalFrames; frame += 1) {
      applyCampaignReplayInputs(subsystem, frame);
      subsystem.update(1 / 30);
      crcTimeline.push(computeGameLogicCrc(subsystem, frame));
    }

    const privateApi = subsystem as unknown as {
      scriptCountersByName: Map<string, { value: number; isCountdownTimer: boolean }>;
      scriptFlagsByName: Map<string, boolean>;
    };

    const missionState = {
      missionStage: privateApi.scriptCountersByName.get('MissionStage')?.value ?? null,
      missionTimer: privateApi.scriptCountersByName.get('MissionTimer')?.value ?? null,
      extractionTimer: privateApi.scriptCountersByName.get('ExtractionTimer')?.value ?? null,
      missionStarted: privateApi.scriptFlagsByName.get('MissionStarted') ?? false,
      objectiveComplete: privateApi.scriptFlagsByName.get('ObjectiveComplete') ?? false,
      extractionCalled: privateApi.scriptFlagsByName.get('ExtractionCalled') ?? false,
      inputDisabled: subsystem.isScriptInputDisabled(),
      radarForced: subsystem.isScriptRadarForced(),
      radarRefreshFrame: subsystem.getScriptRadarRefreshRequestedFrame(),
    };

    const completionState = {
      speechLine1: subsystem.evaluateScriptSpeechHasCompleted({ speechName: 'MissionBriefing_Line1' }),
      timedSpeechLine2: subsystem.evaluateScriptSpeechHasCompleted({ speechName: 'MissionBriefing_Line2' }),
      audioExplosion: subsystem.evaluateScriptAudioHasCompleted({ audioName: 'MissionExplosion' }),
      musicTrackA: subsystem.evaluateScriptMusicHasCompleted({ musicName: 'MissionTrackA', index: 0 }),
      missionOutroVideo: subsystem.evaluateScriptVideoHasCompleted({ videoName: 'MissionOutro' }),
    };

    return {
      crcTimeline,
      checkpointCrcs: CAMPAIGN_REPLAY_CHECKPOINT_FRAMES.map((frame) => crcTimeline[frame]!),
      missionState,
      completionState,
    };
  } finally {
    subsystem.dispose();
  }
}

const CAMPAIGN_PROGRESS_CERTIFICATION_CASES: CampaignProgressCertificationCase[] = [
  {
    name: 'early',
    totalFrames: 30,
    checkpointCrcs: [3145627795, 1916373169, 2184285778, 3582187378, 353742932, 1617286099],
    missionState: {
      missionStage: 5,
      missionTimer: 11,
      extractionTimer: null,
      missionStarted: true,
      objectiveComplete: true,
      extractionCalled: false,
      inputDisabled: false,
      radarForced: false,
      radarRefreshFrame: 27,
    },
    completionState: {
      speechLine1: true,
      timedSpeechLine2: false,
      audioExplosion: true,
      musicTrackA: true,
      missionOutroVideo: false,
    },
  },
  {
    name: 'mid',
    totalFrames: 75,
    checkpointCrcs: [3145627795, 1916373169, 2184285778, 3582187378, 353742932, 168319768],
    missionState: {
      missionStage: 4,
      missionTimer: -1,
      extractionTimer: 37,
      missionStarted: false,
      objectiveComplete: true,
      extractionCalled: true,
      inputDisabled: false,
      radarForced: false,
      radarRefreshFrame: 72,
    },
    completionState: {
      speechLine1: true,
      timedSpeechLine2: true,
      audioExplosion: true,
      musicTrackA: true,
      missionOutroVideo: false,
    },
  },
  {
    name: 'late',
    totalFrames: 130,
    checkpointCrcs: [3145627795, 1916373169, 2184285778, 3582187378, 353742932, 3375085075],
    missionState: {
      missionStage: 4,
      missionTimer: -1,
      extractionTimer: -1,
      missionStarted: false,
      objectiveComplete: true,
      extractionCalled: true,
      inputDisabled: false,
      radarForced: false,
      radarRefreshFrame: 126,
    },
    completionState: {
      speechLine1: true,
      timedSpeechLine2: true,
      audioExplosion: true,
      musicTrackA: true,
      missionOutroVideo: true,
    },
  },
];

describe('GameLogic deterministic CRC ownership', () => {
  it('produces stable CRC values when game logic state is unchanged', () => {
    const subsystem = createSubsystem();
    try {
      const first = computeGameLogicCrc(subsystem, 0);
      const second = computeGameLogicCrc(subsystem, 0);
      expect(second).toBe(first);
    } finally {
      subsystem.dispose();
    }
  });

  it('changes CRC when player relationship ownership state changes', () => {
    const subsystem = createSubsystem();
    try {
      const baseline = computeGameLogicCrc(subsystem, 0);
      subsystem.setTeamRelationship('America', 'China', 0);
      const changed = computeGameLogicCrc(subsystem, 0);
      expect(changed).not.toBe(baseline);
    } finally {
      subsystem.dispose();
    }
  });

  it('changes CRC after simulation command processing updates game logic state', () => {
    const subsystem = createSubsystem();
    try {
      const baseline = computeGameLogicCrc(subsystem, 0);
      subsystem.submitCommand({
        type: 'select',
        entityId: 1,
      });
      subsystem.update(1 / 30);
      const changed = computeGameLogicCrc(subsystem, 0);
      expect(changed).not.toBe(baseline);
    } finally {
      subsystem.dispose();
    }
  });

  it('changes CRC when runtime AI config changes', () => {
    const subsystem = createSubsystem();
    try {
      const baseline = computeGameLogicCrc(subsystem, 0);
      const privateApi = subsystem as unknown as {
        runtimeAiConfig: {
          resourcesPoor: number;
        };
      };
      privateApi.runtimeAiConfig.resourcesPoor = 2001;
      const changed = computeGameLogicCrc(subsystem, 0);
      expect(changed).not.toBe(baseline);
    } finally {
      subsystem.dispose();
    }
  });

  it('changes CRC when script completion queues and lazy audio-test state change', () => {
    const subsystem = createSubsystem();
    try {
      const baseline = computeGameLogicCrc(subsystem, 0);

      subsystem.notifyScriptSpeechCompleted('SpeechLine_CRC');
      const withCompletionQueue = computeGameLogicCrc(subsystem, 0);
      expect(withCompletionQueue).not.toBe(baseline);

      subsystem.setScriptAudioLengthMs('SpeechLine_CRC_Timed', 1000);
      const withAudioLengthMetadata = computeGameLogicCrc(subsystem, 0);
      expect(withAudioLengthMetadata).not.toBe(withCompletionQueue);

      subsystem.evaluateScriptSpeechHasCompleted({ speechName: 'SpeechLine_CRC_Timed' });
      const withLazyDeadline = computeGameLogicCrc(subsystem, 0);
      expect(withLazyDeadline).not.toBe(withAudioLengthMetadata);

      subsystem.setScriptCounter('MissionCounter_CRC', 7);
      subsystem.setScriptFlag('MissionFlag_CRC', true);
      subsystem.notifyScriptUIInteraction('UIHook_CRC');
      subsystem.setScriptActive('Subroutine_CRC', false);
      subsystem.notifyScriptSubroutineCall('Subroutine_CRC');
      subsystem.setScriptCameraMovementFinished(false);
      subsystem.executeScriptAction({ actionType: 'RADAR_FORCE_ENABLE' });
      const withScriptRuntimeState = computeGameLogicCrc(subsystem, 0);
      expect(withScriptRuntimeState).not.toBe(withLazyDeadline);

      subsystem.setScriptTeamMembers('TeamCRC', [1]);
      subsystem.setScriptTeamPrototype('TeamCRC', 'TeamProtoCRC');
      const withScriptTeamState = computeGameLogicCrc(subsystem, 0);
      expect(withScriptTeamState).not.toBe(withScriptRuntimeState);

      const privateApi = subsystem as unknown as {
        scriptTeamCreatedReadyFrameByName: Map<string, number>;
        scriptTeamCreatedAutoClearFrameByName: Map<string, number>;
        pendingScriptReinforcementTransportArrivalByEntityId: Map<number, {
          targetX: number;
          targetZ: number;
          originX: number;
          originZ: number;
          deliveryDistance: number;
          deliverPayloadMode: boolean;
          deliverPayloadDoorDelayFrames: number;
          deliverPayloadDropDelayFrames: number;
          deliverPayloadNextDropFrame: number;
          deliverPayloadDropOffsetX: number;
          deliverPayloadDropOffsetZ: number;
          deliverPayloadDropVarianceX: number;
          deliverPayloadDropVarianceZ: number;
          exitTargetX: number;
          exitTargetZ: number;
          transportsExit: boolean;
          evacuationIssued: boolean;
          exitMoveIssued: boolean;
        }>;
      };
      privateApi.scriptTeamCreatedReadyFrameByName.set('TEAMCRC', 123);
      privateApi.scriptTeamCreatedAutoClearFrameByName.set('TEAMCRC', 124);
      privateApi.pendingScriptReinforcementTransportArrivalByEntityId.set(1, {
        targetX: 10,
        targetZ: 20,
        originX: 5,
        originZ: 6,
        deliveryDistance: 7,
        deliverPayloadMode: true,
        deliverPayloadDoorDelayFrames: 8,
        deliverPayloadDropDelayFrames: 9,
        deliverPayloadNextDropFrame: 10,
        deliverPayloadDropOffsetX: 11,
        deliverPayloadDropOffsetZ: 12,
        deliverPayloadDropVarianceX: 13,
        deliverPayloadDropVarianceZ: 14,
        exitTargetX: 15,
        exitTargetZ: 16,
        transportsExit: true,
        evacuationIssued: false,
        exitMoveIssued: true,
      });
      const withScriptReinforcementState = computeGameLogicCrc(subsystem, 0);
      expect(withScriptReinforcementState).not.toBe(withScriptTeamState);
    } finally {
      subsystem.dispose();
    }
  });

  it('serializes all active command variants used by runtime command queue', () => {
    const subsystem = createSubsystem();
    try {
      const privateApi = subsystem as unknown as {
        commandQueue: GameLogicCommand[];
      };

      const commandSamples: GameLogicCommand[] = [
        { type: 'purchaseScience', scienceName: 'SCIENCE_A', scienceCost: 3, side: 'America' },
        {
          type: 'issueSpecialPower',
          commandSource: 'SCRIPT',
          commandButtonId: 'Command_TestPower',
          specialPowerName: 'SuperweaponA',
          commandOption: 1,
          issuingEntityIds: [1],
          sourceEntityId: 1,
          targetEntityId: null,
          targetX: 10,
          targetZ: 20,
        },
        {
          type: 'combatDrop',
          entityId: 1,
          targetObjectId: null,
          targetPosition: [10, 0, 20],
          commandSource: 'AI',
        },
        {
          type: 'enterObject',
          entityId: 1,
          targetObjectId: 1,
          commandSource: 'SCRIPT',
          action: 'captureUnmannedFactionUnit',
        },
        { type: 'garrisonBuilding', entityId: 1, targetBuildingId: 1 },
        { type: 'repairBuilding', entityId: 1, targetBuildingId: 1, commandSource: 'AI' },
        { type: 'enterTransport', entityId: 1, targetTransportId: 1, commandSource: 'SCRIPT' },
        { type: 'detonateDemoTrap', entityId: 1 },
        { type: 'toggleDemoTrapMode', entityId: 1 },
      ];

      for (const command of commandSamples) {
        privateApi.commandQueue.length = 0;
        privateApi.commandQueue.push(command);
        expect(() => computeGameLogicCrc(subsystem, 0)).not.toThrow();
      }
    } finally {
      subsystem.dispose();
    }
  });

  it('stays CRC-identical across two long-running parallel simulations', () => {
    const left = createSubsystem();
    const right = createSubsystem();
    try {
      for (let frame = 0; frame < 240; frame += 1) {
        applyDeterministicStressInputs(left, frame);
        applyDeterministicStressInputs(right, frame);
        left.update(1 / 30);
        right.update(1 / 30);
        expect(computeGameLogicCrc(left, frame)).toBe(computeGameLogicCrc(right, frame));
      }
    } finally {
      left.dispose();
      right.dispose();
    }
  });

  it('replays deterministic stress timeline with invariant CRC sequence', () => {
    const firstRun = runDeterministicStressReplay(240);
    const replayRun = runDeterministicStressReplay(240);
    expect(replayRun).toEqual(firstRun);
  });

  it('replays a campaign-style scripted timeline with deterministic mission outcomes', () => {
    const campaignReplay = runCampaignScenarioReplay();
    expect(campaignReplay.missionState).toEqual({
      missionStage: 4,
      missionTimer: -1,
      extractionTimer: -1,
      missionStarted: false,
      objectiveComplete: true,
      extractionCalled: true,
      inputDisabled: false,
      radarForced: false,
      radarRefreshFrame: 126,
    });
    expect(campaignReplay.completionState).toEqual({
      speechLine1: true,
      timedSpeechLine2: true,
      audioExplosion: true,
      musicTrackA: true,
      missionOutroVideo: true,
    });
  });

  it('matches fixed campaign replay CRC checkpoints and full replay timeline', () => {
    const firstRun = runCampaignScenarioReplay();
    const replayRun = runCampaignScenarioReplay();
    expect(replayRun.crcTimeline).toEqual(firstRun.crcTimeline);
    expect(firstRun.checkpointCrcs).toEqual([
      3145627795,
      1916373169,
      2184285778,
      3582187378,
      353742932,
      1850723878,
      2578792901,
      2384113276,
      2203188828,
      4185183660,
      784498120,
      3849276285,
      3375085075,
    ]);
  });

  it('certifies long-session stress replay with fixed deterministic CRC checkpoints', () => {
    const firstRun = runDeterministicStressReplay(LONG_STRESS_REPLAY_TOTAL_FRAMES);
    const replayRun = runDeterministicStressReplay(LONG_STRESS_REPLAY_TOTAL_FRAMES);
    expect(replayRun).toEqual(firstRun);
    expect(LONG_STRESS_REPLAY_CHECKPOINT_FRAMES.map((frame) => firstRun[frame]!)).toEqual([
      306702229,
      4224381317,
      1105233253,
      1326132515,
      2960796439,
      1543137912,
      938342946,
      3604454842,
      374894980,
      591033169,
      2478831388,
      2501348825,
      1550847340,
    ]);
  });

  it('certifies campaign progression matrix (early/mid/late) with fixed checkpoints', () => {
    for (const certificationCase of CAMPAIGN_PROGRESS_CERTIFICATION_CASES) {
      const firstRun = runCampaignScenarioReplay(certificationCase.totalFrames);
      const replayRun = runCampaignScenarioReplay(certificationCase.totalFrames);
      expect(replayRun.crcTimeline).toEqual(firstRun.crcTimeline);

      const checkpointFrames = [
        ...CAMPAIGN_PROGRESS_CHECKPOINT_FRAMES_BASE,
        certificationCase.totalFrames - 1,
      ];
      expect(checkpointFrames.map((frame) => firstRun.crcTimeline[frame]!)).toEqual(certificationCase.checkpointCrcs);
      expect(firstRun.missionState).toEqual(certificationCase.missionState);
      expect(firstRun.completionState).toEqual(certificationCase.completionState);
    }
  });
});
