import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { GameLogicSubsystem } from './index.js';
import { makeBlock, makeBundle, makeHeightmap, makeMap, makeObjectDef, makeRegistry } from './test-helpers.js';

describe('child object runtime normalization', () => {
  it('normalizes displaced root fields for map-loaded ChildObject-like entities', () => {
    const childLikeFactory = {
      name: 'ChildLikeFactory',
      fields: {
        ButtonImage: 'TestFactory',
        SelectPortrait: 'TestFactory_L',
      },
      blocks: [
        makeBlock('Draw', 'W3DModelDraw ModuleTag_01', {
          Side: 'China',
          KindOf: ['STRUCTURE', 'IMMOBILE', 'FS_FACTORY'],
          Geometry: 'BOX',
          GeometryMajorRadius: 30,
          GeometryMinorRadius: 24,
          GeometryHeight: 20,
        }, [
          makeBlock('Body', 'StructureBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
        ]),
      ],
      resolved: true,
    };

    const registry = makeRegistry(makeBundle({ objects: [childLikeFactory as any] }));
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([
        {
          templateName: 'ChildLikeFactory',
          angle: 0,
          flags: 0,
          position: { x: 64, y: 64, z: 0 },
          properties: {},
        },
      ], 64, 64),
      registry,
      makeHeightmap(64, 64),
    );

    const factory = logic.getRenderableEntityStates().find((entity) => entity.templateName === 'ChildLikeFactory');
    expect(factory).toBeDefined();
    expect(factory?.side).toBe('China');
    expect(factory?.health).toBe(1000);
  });

  it('uses normalized ChildObject geometry for build-location checks', () => {
    const childLikeFactory = {
      name: 'ChildLikeFactory',
      fields: {
        ButtonImage: 'TestFactory',
      },
      blocks: [
        makeBlock('Draw', 'W3DModelDraw ModuleTag_01', {
          Side: 'China',
          KindOf: ['STRUCTURE', 'IMMOBILE'],
          Geometry: 'BOX',
          GeometryMajorRadius: 30,
          GeometryMinorRadius: 24,
          GeometryHeight: 20,
        }, [
          makeBlock('Body', 'StructureBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
        ]),
      ],
      resolved: true,
    };

    const blocker = makeObjectDef(
      'Blocker',
      'America',
      ['STRUCTURE', 'IMMOBILE'],
      [makeBlock('Body', 'StructureBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 })],
      {
        Geometry: 'BOX',
        GeometryMajorRadius: 20,
        GeometryMinorRadius: 20,
        GeometryHeight: 20,
      },
    );

    const registry = makeRegistry(makeBundle({ objects: [childLikeFactory as any, blocker] }));
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([
        {
          templateName: 'Blocker',
          angle: 0,
          flags: 0,
          position: { x: 96, y: 96, z: 0 },
          properties: {},
        },
      ], 64, 64),
      registry,
      makeHeightmap(64, 64),
    );

    expect(logic.isBuildLocationValid('ChildLikeFactory', 96, 96, 0)).toBe(false);
  });
});
