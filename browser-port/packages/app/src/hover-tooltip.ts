/**
 * Cleans a raw INI template name into a human-readable display name.
 *
 * Strips known faction prefixes (e.g. "America", "ChinaInfantry", "GLAVehicle")
 * then inserts spaces before capital letters.  Falls back to simple space-insertion
 * when stripping the prefix would leave an empty string.
 */
export function formatTemplateName(rawName: string): string {
  const stripped = rawName
    .replace(
      /^(AmericaInfantry|AmericaVehicle|ChinaInfantry|ChinaVehicle|GLAInfantry|GLAVehicle|America|China|GLA)/,
      '',
    );
  const spaced = (stripped || rawName).replace(/([A-Z])/g, ' $1').trim();
  return spaced;
}
