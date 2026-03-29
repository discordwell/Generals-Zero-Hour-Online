import type { EvaEvent, EvaEventType } from '@generals/game-logic';
import { resolveEvaFactionPrefix } from './eva-faction-prefix.js';

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
  CASH_STOLEN: 40,
  BUILDING_SABOTAGED: 35,
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

/**
 * Resolve faction-specific EVA audio event name.
 * Source parity: Eva.cpp maps Eva event types to per-faction AudioEvent names
 * like EvaUSA_LowPower, EvaChina_UnitLost, EvaGLA_UpgradeComplete.
 */
function resolveEvaAudioEventName(event: EvaEvent, side: string): string {
  const prefix = resolveEvaFactionPrefix(side);
  const suffix = EVA_AUDIO_SUFFIX_MAP[event.type];
  if (suffix) {
    return `${prefix}_${suffix}`;
  }
  return `${prefix}_${event.type}`;
}

const EVA_AUDIO_SUFFIX_MAP: Record<EvaEventType, string> = {
  LOW_POWER: 'LowPower',
  INSUFFICIENT_FUNDS: 'InsufficientFunds',
  BUILDING_LOST: 'BuildingLost',
  UNIT_LOST: 'UnitLost',
  BASE_UNDER_ATTACK: 'BaseUnderAttack',
  ALLY_UNDER_ATTACK: 'AllyUnderAttack',
  UPGRADE_COMPLETE: 'UpgradeComplete',
  GENERAL_LEVEL_UP: 'GeneralPromotion',
  VEHICLE_STOLEN: 'VehicleStolen',
  BUILDING_STOLEN: 'BuildingStolen',
  SUPERWEAPON_DETECTED: 'SuperweaponDetected',
  SUPERWEAPON_LAUNCHED: 'SuperweaponLaunched',
  SUPERWEAPON_READY: 'SuperweaponReady',
  CONSTRUCTION_COMPLETE: 'ConstructionComplete',
  UNIT_READY: 'UnitReady',
  BEACON_DETECTED: 'BeaconDetected',
  CASH_STOLEN: 'CashStolen',
  BUILDING_SABOTAGED: 'BuildingSabotaged',
};

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

/** Per-event-type cooldown (ms) to prevent spamming. */
const EVA_COOLDOWN_MS: Partial<Record<EvaEventType, number>> = {
  BASE_UNDER_ATTACK: 10000,
  ALLY_UNDER_ATTACK: 10000,
  UNIT_LOST: 5000,
  BUILDING_LOST: 5000,
  LOW_POWER: 15000,
  INSUFFICIENT_FUNDS: 8000,
};

const DEFAULT_EVA_COOLDOWN_MS = 3000;

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

  /** Track last play time per EVA event type for cooldown enforcement. */
  const lastPlayedByType = new Map<EvaEventType, number>();

  return {
    syncAfterSimulationStep(): void {
      const localPlayerSide = normalizeSideName(resolveLocalPlayerSide());
      if (!localPlayerSide) {
        // Still drain events to prevent buffer buildup.
        gameLogic.drainEvaEvents();
        return;
      }

      const relevantEvents = gameLogic
        .drainEvaEvents()
        .filter((event) => normalizeSideName(event.side) === localPlayerSide);
      if (relevantEvents.length === 0) {
        return;
      }

      // Filter by cooldown — skip events played too recently.
      const now = performance.now();
      const cooledDown = relevantEvents.filter((event) => {
        const lastPlayed = lastPlayedByType.get(event.type);
        if (lastPlayed === undefined) return true; // Never played before.
        const cooldown = EVA_COOLDOWN_MS[event.type] ?? DEFAULT_EVA_COOLDOWN_MS;
        return now - lastPlayed >= cooldown;
      });

      const selectedEvent = selectHighestPriorityEvent(cooledDown);
      if (!selectedEvent) {
        return;
      }

      lastPlayedByType.set(selectedEvent.type, now);

      const message = formatEvaMessage(selectedEvent);
      uiRuntime.showMessage(message, DEFAULT_EVA_MESSAGE_MS);

      const audioEventName = resolveEvaAudioEventName(selectedEvent, localPlayerSide);
      audioManager?.addAudioEvent(audioEventName);

      logger.debug(
        `[EVA type=${selectedEvent.type} side=${selectedEvent.side} rel=${selectedEvent.relationship}] ${message}`,
      );
    },
  };
}
