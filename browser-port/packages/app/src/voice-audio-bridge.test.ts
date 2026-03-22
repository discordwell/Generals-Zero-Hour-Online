import { describe, expect, it, vi } from 'vitest';
import { VoiceAudioBridge, type VoiceAudioManager, type VoiceGameLogic } from './voice-audio-bridge.js';
import type { IniDataRegistry } from '@generals/ini-data';

function createMockRegistry(objects: Record<string, Record<string, string>>): IniDataRegistry {
  return {
    getObject(name: string) {
      const fields = objects[name];
      if (!fields) return undefined;
      return { name, fields, blocks: [], resolved: true } as unknown as ReturnType<IniDataRegistry['getObject']>;
    },
  } as unknown as IniDataRegistry;
}

function createMockAudioManager(): VoiceAudioManager & { played: Array<{ name: string; pos?: readonly [number, number, number] }> } {
  const played: Array<{ name: string; pos?: readonly [number, number, number] }> = [];
  let nextHandle = 1;
  return {
    played,
    addAudioEvent(eventName: string, position?: readonly [number, number, number]) {
      played.push({ name: eventName, pos: position });
      return nextHandle++;
    },
    removeAudioEvent() {},
  };
}

function createMockGameLogic(entities: Map<number, { x: number; y: number; z: number; templateName: string }>): VoiceGameLogic {
  return {
    getEntityState(id: number) {
      return entities.get(id) ?? null;
    },
  };
}

describe('VoiceAudioBridge', () => {
  it('plays select voice for entity', () => {
    const registry = createMockRegistry({
      Ranger: { VoiceSelect: 'RangerVoiceSelect', VoiceMove: 'RangerVoiceMove' },
    });
    const audio = createMockAudioManager();
    const logic = createMockGameLogic(new Map([
      [1, { x: 10, y: 0, z: 20, templateName: 'Ranger' }],
    ]));
    const bridge = new VoiceAudioBridge(registry, audio, logic);

    expect(bridge.playVoice(1, 'select')).toBe(true);
    expect(audio.played).toHaveLength(1);
    expect(audio.played[0]!.name).toBe('RangerVoiceSelect');
    expect(audio.played[0]!.pos).toEqual([10, 0, 20]);
  });

  it('plays move voice for entity', () => {
    const registry = createMockRegistry({
      Crusader: { VoiceSelect: 'CrusaderSelect', VoiceMove: 'CrusaderMove' },
    });
    const audio = createMockAudioManager();
    const logic = createMockGameLogic(new Map([
      [2, { x: 5, y: 1, z: 15, templateName: 'Crusader' }],
    ]));
    const bridge = new VoiceAudioBridge(registry, audio, logic);

    expect(bridge.playVoice(2, 'move')).toBe(true);
    expect(audio.played[0]!.name).toBe('CrusaderMove');
  });

  it('returns false for entity without voice field', () => {
    const registry = createMockRegistry({
      Building: { VoiceSelect: 'BuildingSelect' },
    });
    const audio = createMockAudioManager();
    const logic = createMockGameLogic(new Map([
      [3, { x: 0, y: 0, z: 0, templateName: 'Building' }],
    ]));
    const bridge = new VoiceAudioBridge(registry, audio, logic);

    expect(bridge.playVoice(3, 'attack')).toBe(false);
    expect(audio.played).toHaveLength(0);
  });

  it('returns false for nonexistent entity', () => {
    const registry = createMockRegistry({});
    const audio = createMockAudioManager();
    const logic = createMockGameLogic(new Map());
    const bridge = new VoiceAudioBridge(registry, audio, logic);

    expect(bridge.playVoice(999, 'select')).toBe(false);
  });

  it('enforces cooldown between voices', () => {
    const registry = createMockRegistry({
      Tank: { VoiceSelect: 'TankSelect' },
    });
    const audio = createMockAudioManager();
    const logic = createMockGameLogic(new Map([
      [1, { x: 0, y: 0, z: 0, templateName: 'Tank' }],
    ]));
    const bridge = new VoiceAudioBridge(registry, audio, logic);

    let mockTime = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => mockTime);

    expect(bridge.playVoice(1, 'select')).toBe(true);
    expect(audio.played).toHaveLength(1);

    // Within cooldown — should be rejected.
    mockTime += 100;
    expect(bridge.playVoice(1, 'select')).toBe(false);
    expect(audio.played).toHaveLength(1);

    // After cooldown — should play.
    mockTime += 500;
    expect(bridge.playVoice(1, 'select')).toBe(true);
    expect(audio.played).toHaveLength(2);

    vi.restoreAllMocks();
  });

  it('playGroupVoice plays voice for first entity only', () => {
    const registry = createMockRegistry({
      Ranger: { VoiceSelect: 'RangerSelect' },
      Humvee: { VoiceSelect: 'HumveeSelect' },
    });
    const audio = createMockAudioManager();
    const logic = createMockGameLogic(new Map([
      [1, { x: 0, y: 0, z: 0, templateName: 'Ranger' }],
      [2, { x: 5, y: 0, z: 5, templateName: 'Humvee' }],
    ]));
    const bridge = new VoiceAudioBridge(registry, audio, logic);

    expect(bridge.playGroupVoice([1, 2], 'select')).toBe(true);
    // Only one voice should play (for the first entity).
    expect(audio.played).toHaveLength(1);
    expect(audio.played[0]!.name).toBe('RangerSelect');
  });

  it('playGroupVoice picks a random entity for command voices (move/attack)', () => {
    const registry = createMockRegistry({
      Ranger: { VoiceMove: 'RangerMove' },
      Humvee: { VoiceMove: 'HumveeMove' },
      Tank: { VoiceMove: 'TankMove' },
    });
    const audio = createMockAudioManager();
    const logic = createMockGameLogic(new Map([
      [1, { x: 0, y: 0, z: 0, templateName: 'Ranger' }],
      [2, { x: 5, y: 0, z: 5, templateName: 'Humvee' }],
      [3, { x: 10, y: 0, z: 10, templateName: 'Tank' }],
    ]));
    const bridge = new VoiceAudioBridge(registry, audio, logic);

    // Seed Math.random to return predictable values for the test.
    const mathRandomSpy = vi.spyOn(Math, 'random');
    let mockTime = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => mockTime);

    // Math.floor(0.7 * 3) = 2 → picks entity at index 2 (Tank)
    mathRandomSpy.mockReturnValueOnce(0.7);
    expect(bridge.playGroupVoice([1, 2, 3], 'move')).toBe(true);
    expect(audio.played).toHaveLength(1);
    expect(audio.played[0]!.name).toBe('TankMove');

    // Advance past cooldown.
    mockTime += 500;

    // Math.floor(0.1 * 3) = 0 → picks entity at index 0 (Ranger)
    mathRandomSpy.mockReturnValueOnce(0.1);
    expect(bridge.playGroupVoice([1, 2, 3], 'move')).toBe(true);
    expect(audio.played).toHaveLength(2);
    expect(audio.played[1]!.name).toBe('RangerMove');

    vi.restoreAllMocks();
  });

  it('caches voice lookups', () => {
    const objects: Record<string, Record<string, string>> = {
      Tank: { VoiceSelect: 'TankSelect' },
    };
    const registry = createMockRegistry(objects);
    const getObjectSpy = vi.spyOn(registry, 'getObject');
    const audio = createMockAudioManager();
    const logic = createMockGameLogic(new Map([
      [1, { x: 0, y: 0, z: 0, templateName: 'Tank' }],
    ]));
    const bridge = new VoiceAudioBridge(registry, audio, logic);

    let mockTime = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => mockTime);

    bridge.playVoice(1, 'select');
    mockTime += 500;
    bridge.playVoice(1, 'select');

    // getObject should only be called once due to cache.
    expect(getObjectSpy).toHaveBeenCalledTimes(1);

    vi.restoreAllMocks();
  });

  it('dispose clears cache and stops current voice', () => {
    const registry = createMockRegistry({
      Tank: { VoiceSelect: 'TankSelect' },
    });
    const audio = createMockAudioManager();
    const removeSpy = vi.spyOn(audio, 'removeAudioEvent');
    const logic = createMockGameLogic(new Map([
      [1, { x: 0, y: 0, z: 0, templateName: 'Tank' }],
    ]));
    const bridge = new VoiceAudioBridge(registry, audio, logic);

    bridge.playVoice(1, 'select');
    bridge.dispose();

    expect(removeSpy).toHaveBeenCalled();
  });
});
