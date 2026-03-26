/**
 * Parity tests for ThingTemplate fields added from C++ constructor defaults:
 *
 * 1. ThreatValue — AI target prioritization (default 0)
 * 2. RadarPriority — minimap display priority (default INVALID)
 * 3. OcclusionDelay — frames before occlusion kicks in (default 0)
 * 4. StructureRubbleHeight — rubble height after destruction (default 0)
 * 5. InstanceScaleFuzziness — random scale variation (default 0)
 * 6. ShadowOffsetX — shadow rendering X offset (default 0)
 * 7. ShadowOffsetY — shadow rendering Y offset (default 0)
 * 8. BuildCompletion — where completed units appear (default APPEARS_AT_RALLY_POINT)
 * 9. EnterGuard — can garrison enemy buildings (default false)
 * 10. HijackGuard — can hijack enemy vehicles (default false)
 */

import { describe, expect, it } from 'vitest';

import {
  createParityAgent,
  makeBlock,
  makeObjectDef,
  place,
} from './parity-agent.js';

function createAgentWithObject(
  name: string,
  fields: Record<string, unknown> = {},
  kindOf: string[] = ['VEHICLE'],
) {
  return createParityAgent({
    bundles: {
      objects: [
        makeObjectDef(name, 'America', kindOf, [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
        ], fields),
      ],
    },
    sides: { America: {} },
    mapObjects: [place(name, 10, 10)],
  });
}

function getEntity(agent: ReturnType<typeof createParityAgent>) {
  return agent.gameLogic.spawnedEntities.values().next().value;
}

// ── ThreatValue ──────────────────────────────────────────────────────────

describe('ThingTemplate: ThreatValue', () => {
  it('defaults to 0 when not specified', () => {
    const agent = createAgentWithObject('BasicUnit');
    expect(getEntity(agent).threatValue).toBe(0);
  });

  it('reads ThreatValue from INI', () => {
    const agent = createAgentWithObject('HighThreat', { ThreatValue: 25 });
    expect(getEntity(agent).threatValue).toBe(25);
  });
});

// ── RadarPriority ────────────────────────────────────────────────────────

describe('ThingTemplate: RadarPriority', () => {
  it('defaults to INVALID when not specified', () => {
    const agent = createAgentWithObject('BasicUnit');
    expect(getEntity(agent).radarPriority).toBe('INVALID');
  });

  it('reads RadarPriority STRUCTURE from INI', () => {
    const agent = createAgentWithObject('Building', { RadarPriority: 'STRUCTURE' }, ['STRUCTURE']);
    expect(getEntity(agent).radarPriority).toBe('STRUCTURE');
  });

  it('reads RadarPriority UNIT from INI', () => {
    const agent = createAgentWithObject('Tank', { RadarPriority: 'UNIT' });
    expect(getEntity(agent).radarPriority).toBe('UNIT');
  });

  it('reads RadarPriority NOT_ON_RADAR from INI', () => {
    const agent = createAgentWithObject('HiddenObj', { RadarPriority: 'NOT_ON_RADAR' });
    expect(getEntity(agent).radarPriority).toBe('NOT_ON_RADAR');
  });

  it('reads RadarPriority LOCAL_UNIT_ONLY from INI', () => {
    const agent = createAgentWithObject('LocalUnit', { RadarPriority: 'LOCAL_UNIT_ONLY' });
    expect(getEntity(agent).radarPriority).toBe('LOCAL_UNIT_ONLY');
  });

  it('falls back to INVALID for unrecognized values', () => {
    const agent = createAgentWithObject('BadRadar', { RadarPriority: 'NONSENSE' });
    expect(getEntity(agent).radarPriority).toBe('INVALID');
  });
});

// ── OcclusionDelay ───────────────────────────────────────────────────────

describe('ThingTemplate: OcclusionDelay', () => {
  it('defaults to 0 when not specified', () => {
    const agent = createAgentWithObject('BasicUnit');
    expect(getEntity(agent).occlusionDelay).toBe(0);
  });

  it('reads OcclusionDelay from INI', () => {
    const agent = createAgentWithObject('DelayedOcclusion', { OcclusionDelay: 90 });
    expect(getEntity(agent).occlusionDelay).toBe(90);
  });
});

// ── StructureRubbleHeight ────────────────────────────────────────────────

describe('ThingTemplate: StructureRubbleHeight', () => {
  it('defaults to 0 when not specified', () => {
    const agent = createAgentWithObject('BasicUnit');
    expect(getEntity(agent).structureRubbleHeight).toBe(0);
  });

  it('reads StructureRubbleHeight from INI', () => {
    const agent = createAgentWithObject('Rubble', { StructureRubbleHeight: 15 });
    expect(getEntity(agent).structureRubbleHeight).toBe(15);
  });
});

// ── InstanceScaleFuzziness ───────────────────────────────────────────────

describe('ThingTemplate: InstanceScaleFuzziness', () => {
  it('defaults to 0 when not specified', () => {
    const agent = createAgentWithObject('BasicUnit');
    expect(getEntity(agent).instanceScaleFuzziness).toBe(0);
  });

  it('reads InstanceScaleFuzziness from INI', () => {
    const agent = createAgentWithObject('FuzzyScale', { InstanceScaleFuzziness: 0.05 });
    expect(getEntity(agent).instanceScaleFuzziness).toBeCloseTo(0.05, 4);
  });
});

// ── ShadowOffsetX / ShadowOffsetY ────────────────────────────────────────

describe('ThingTemplate: ShadowOffsetX/ShadowOffsetY', () => {
  it('defaults ShadowOffsetX to 0 when not specified', () => {
    const agent = createAgentWithObject('BasicUnit');
    expect(getEntity(agent).shadowOffsetX).toBe(0);
  });

  it('defaults ShadowOffsetY to 0 when not specified', () => {
    const agent = createAgentWithObject('BasicUnit');
    expect(getEntity(agent).shadowOffsetY).toBe(0);
  });

  it('reads ShadowOffsetX from INI', () => {
    const agent = createAgentWithObject('OffsetShadow', { ShadowOffsetX: 3.5 });
    expect(getEntity(agent).shadowOffsetX).toBeCloseTo(3.5, 4);
  });

  it('reads ShadowOffsetY from INI', () => {
    const agent = createAgentWithObject('OffsetShadow', { ShadowOffsetY: -2.0 });
    expect(getEntity(agent).shadowOffsetY).toBeCloseTo(-2.0, 4);
  });
});

// ── BuildCompletion ──────────────────────────────────────────────────────

describe('ThingTemplate: BuildCompletion', () => {
  it('defaults to APPEARS_AT_RALLY_POINT when not specified', () => {
    const agent = createAgentWithObject('BasicUnit');
    expect(getEntity(agent).buildCompletion).toBe('APPEARS_AT_RALLY_POINT');
  });

  it('reads BuildCompletion PLACED_BY_PLAYER from INI', () => {
    const agent = createAgentWithObject('PlacedUnit', { BuildCompletion: 'PLACED_BY_PLAYER' });
    expect(getEntity(agent).buildCompletion).toBe('PLACED_BY_PLAYER');
  });

  it('reads BuildCompletion INVALID from INI', () => {
    const agent = createAgentWithObject('InvalidBuild', { BuildCompletion: 'INVALID' });
    expect(getEntity(agent).buildCompletion).toBe('INVALID');
  });

  it('falls back to APPEARS_AT_RALLY_POINT for unrecognized values', () => {
    const agent = createAgentWithObject('BadBuild', { BuildCompletion: 'NONSENSE' });
    expect(getEntity(agent).buildCompletion).toBe('APPEARS_AT_RALLY_POINT');
  });
});

// ── EnterGuard ───────────────────────────────────────────────────────────

describe('ThingTemplate: EnterGuard', () => {
  it('defaults to false when not specified', () => {
    const agent = createAgentWithObject('BasicUnit');
    expect(getEntity(agent).enterGuard).toBe(false);
  });

  it('reads EnterGuard = Yes from INI', () => {
    const agent = createAgentWithObject('Garrison', { EnterGuard: true });
    expect(getEntity(agent).enterGuard).toBe(true);
  });
});

// ── HijackGuard ──────────────────────────────────────────────────────────

describe('ThingTemplate: HijackGuard', () => {
  it('defaults to false when not specified', () => {
    const agent = createAgentWithObject('BasicUnit');
    expect(getEntity(agent).hijackGuard).toBe(false);
  });

  it('reads HijackGuard = Yes from INI', () => {
    const agent = createAgentWithObject('Hijacker', { HijackGuard: true });
    expect(getEntity(agent).hijackGuard).toBe(true);
  });
});
