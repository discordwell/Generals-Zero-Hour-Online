import type { EvaEvent, EvaEventType } from '@generals/game-logic';

const DEFAULT_EVA_MESSAGE_MS = 3500;

const EVA_PRIORITY_BY_TYPE: Record<EvaEventType, number> = {
  BASE_UNDER_ATTACK: 100,
  ALLY_UNDER_ATTACK: 95,
  SUPERWEAPON_LAUNCHED: 90,
  SUPERWEAPON_DETECTED: 85,
  BUILDING_LOST: 80,
  UNIT_LOST: 75,
  LOW_POWER: 70,
  INSUFFICIENT_FUNDS: 65,
  GENERAL_LEVEL_UP: 60,
  UPGRADE_COMPLETE: 55,
  CONSTRUCTION_COMPLETE: 50,
  UNIT_READY: 45,
  VEHICLE_STOLEN: 40,
  BUILDING_STOLEN: 40,
  SUPERWEAPON_READY: 35,
  BEACON_DETECTED: 30,
};

export interface ScriptEvaRuntimeGameLogic {
  drainEvaEvents(): EvaEvent[];
}

export interface ScriptEvaRuntimeUi {
  showMessage(message: string, durationMs?: number): void;
}

export interface ScriptEvaRuntimeAudio {
  addAudioEvent(eventName: string): number;
}

export interface ScriptEvaRuntimeLogger {
  debug(message: string): void;
}

export interface ScriptEvaRuntimeBridge {
  syncAfterSimulationStep(): void;
}

export interface CreateScriptEvaRuntimeBridgeOptions {
  gameLogic: ScriptEvaRuntimeGameLogic;
  uiRuntime: ScriptEvaRuntimeUi;
  resolveLocalPlayerSide: () => string | null;
  audioManager?: ScriptEvaRuntimeAudio;
  logger?: ScriptEvaRuntimeLogger;
}

function normalizeSideName(side: string | null | undefined): string | null {
  if (typeof side !== 'string') {
    return null;
  }
  const normalized = side.trim().toUpperCase();
  return normalized || null;
}

function resolveEvaAudioEventName(event: EvaEvent): string {
  return `EVA_${event.type}`;
}

function formatEvaMessage(event: EvaEvent): string {
  switch (event.type) {
    case 'LOW_POWER':
      return 'Low power.';
    case 'INSUFFICIENT_FUNDS':
      return 'Insufficient funds.';
    case 'BUILDING_LOST':
      return 'Building lost.';
    case 'UNIT_LOST':
      return 'Unit lost.';
    case 'BASE_UNDER_ATTACK':
      return event.relationship === 'ally' ? 'Ally base under attack.' : 'Base under attack.';
    case 'ALLY_UNDER_ATTACK':
      return 'Ally under attack.';
    case 'UPGRADE_COMPLETE':
      return event.detail ? `${event.detail} upgrade complete.` : 'Upgrade complete.';
    case 'GENERAL_LEVEL_UP':
      return 'General promoted.';
    case 'VEHICLE_STOLEN':
      return 'Vehicle stolen.';
    case 'BUILDING_STOLEN':
      return 'Building stolen.';
    case 'SUPERWEAPON_DETECTED':
      return event.detail
        ? `Enemy superweapon detected: ${event.detail}.`
        : 'Enemy superweapon detected.';
    case 'SUPERWEAPON_LAUNCHED':
      return 'Superweapon launched.';
    case 'SUPERWEAPON_READY':
      return event.detail ? `${event.detail} ready.` : 'Superweapon ready.';
    case 'CONSTRUCTION_COMPLETE':
      return event.detail ? `${event.detail} construction complete.` : 'Construction complete.';
    case 'UNIT_READY':
      return event.detail ? `${event.detail} ready.` : 'Unit ready.';
    case 'BEACON_DETECTED':
      return 'Beacon detected.';
    default:
      return String(event.type).replace(/_/g, ' ');
  }
}

function selectHighestPriorityEvent(events: readonly EvaEvent[]): EvaEvent | null {
  let selected: EvaEvent | null = null;
  let selectedPriority = Number.NEGATIVE_INFINITY;
  for (const event of events) {
    const priority = EVA_PRIORITY_BY_TYPE[event.type] ?? 0;
    if (selected === null || priority >= selectedPriority) {
      selected = event;
      selectedPriority = priority;
    }
  }
  return selected;
}

export function createScriptEvaRuntimeBridge(
  options: CreateScriptEvaRuntimeBridgeOptions,
): ScriptEvaRuntimeBridge {
  const {
    gameLogic,
    uiRuntime,
    audioManager,
    resolveLocalPlayerSide,
    logger = console,
  } = options;

  return {
    syncAfterSimulationStep(): void {
      const localPlayerSide = normalizeSideName(resolveLocalPlayerSide());
      if (!localPlayerSide) {
        return;
      }

      const relevantEvents = gameLogic
        .drainEvaEvents()
        .filter((event) => normalizeSideName(event.side) === localPlayerSide);
      if (relevantEvents.length === 0) {
        return;
      }

      const selectedEvent = selectHighestPriorityEvent(relevantEvents);
      if (!selectedEvent) {
        return;
      }

      const message = formatEvaMessage(selectedEvent);
      uiRuntime.showMessage(message, DEFAULT_EVA_MESSAGE_MS);

      const audioEventName = resolveEvaAudioEventName(selectedEvent);
      audioManager?.addAudioEvent(audioEventName);

      logger.debug(
        `[EVA type=${selectedEvent.type} side=${selectedEvent.side} rel=${selectedEvent.relationship}] ${message}`,
      );
    },
  };
}
