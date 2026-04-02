import type { SupplementalMapObjectDefinition } from '@generals/game-logic';

/**
 * Retail map-object supplements backed by source content that does not flow
 * through the normal INI bundle today.
 */
export function collectSourceMapObjectSupplements(): SupplementalMapObjectDefinition[] {
  return [
    {
      // Source: Data/INI/Object/CivilianProp.ini contains a commented retail
      // Snowman definition that still points at the original model name.
      templateName: 'Snowman',
      modelName: 'PMSnowman',
      kindOf: ['IMMOBILE'],
    },
    {
      // Source: PlayerTemplate.ini uses MultiplayerBeacon as the retail beacon
      // template name, GameLogicDispatch creates it through ThingFactory, and
      // the converted retail beacon art is SCMBeacon.
      templateName: 'MultiplayerBeacon',
      modelName: 'SCMBeacon',
      kindOf: ['STRUCTURE', 'BEACON', 'IMMOBILE'],
    },
    {
      // Source: Data/INI/Object/CivilianProp.ini defines Object Fountain1.
      // Several campaign maps still reference the map template alias Fountain01.
      templateName: 'Fountain01',
      objectDefName: 'Fountain1',
    },
    {
      // Source: Data/INI/Object/CivilianProp.ini defines Object Fountain2.
      // Several campaign maps still reference the map template alias Fountain02.
      templateName: 'Fountain02',
      objectDefName: 'Fountain2',
    },
    {
      // Source-backed map-only prop: campaign maps reference Fountain04 and the
      // converted retail fountain art exists as PMFountain4. No canonical
      // object definition with that exact template name survives in the bundle.
      templateName: 'Fountain04',
      modelName: 'PMFountain4',
    },
    {
      // Source: Data/INI/Object/DemoGeneral.ini defines Object Demo_GLAVehicleCombatBike.
      // MD_GLA02_CINE still places the legacy GC_ prefixed template name.
      templateName: 'GC_Demo_GLAVehicleCombatBike',
      objectDefName: 'Demo_GLAVehicleCombatBike',
    },
    {
      // Source-backed map-only prop: campaign maps place AmericaDetentionCamp,
      // localization contains Detention Camp strings, and converted retail art
      // exists as ABDetCamp even though no canonical object definition survives
      // in the current extracted INI bundle.
      templateName: 'AmericaDetentionCamp',
      modelName: 'ABDetCamp',
    },
    {
      // Source: Data/INI/Object/CivilianProp.ini contains a commented retail
      // Object Frosty block that still points at PMSnowman.
      templateName: 'Frosty',
      modelName: 'PMSnowman',
    },
  ];
}
