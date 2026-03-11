/**
 * Source Truth Parity Verification — compares C++ source data against the TypeScript port.
 *
 * Parses C++ header files from the in-repo original and compares enum values,
 * field tables, and bonus conditions against the browser port's implementation.
 *
 * Usage:
 *   npx tsx tools/parity-source-truth.ts [--strict]
 *
 * Outputs:
 *   test-results/parity/source-parity.json   — structured mismatch list
 *   test-results/parity/source-parity.md     — human-readable summary
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ── Types ───────────────────────────────────────────────────────────────────

export interface ParityMismatch {
  category: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  cppValue?: string;
  tsValue?: string;
}

export interface ParityCategoryResult {
  category: string;
  status: 'match' | 'mismatch' | 'partial';
  mismatches: ParityMismatch[];
}

export interface SourceParityReport {
  generatedAt: string;
  status: 'pass' | 'fail';
  summary: {
    totalCategories: number;
    passingCategories: number;
    failingCategories: number;
    totalMismatches: number;
    errors: number;
    warnings: number;
  };
  categories: ParityCategoryResult[];
}

// ── Parsers ─────────────────────────────────────────────────────────────────

/**
 * Parse C++ damage type enum names from GeneralsMD Damage.h or Damage.cpp.
 * Extracts the s_bitNameList[] string array.
 */
export function parseCppDamageTypeNames(source: string): string[] {
  // Look for the s_bitNameList array (ZH style) or TheDamageNames array (Generals style)
  const patterns = [
    /s_bitNameList\s*\[\s*\]\s*=\s*\{([^}]+)\}/s,
    /TheDamageNames\s*\[\s*\]\s*=\s*\{([^}]+)\}/s,
  ];

  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match) {
      return extractQuotedStrings(match[1]!);
    }
  }
  return [];
}

/**
 * Parse C++ WeaponBonusConditionType names from Weapon.h.
 * Extracts TheWeaponBonusNames[] string array.
 */
export function parseCppWeaponBonusNames(source: string): string[] {
  const match = source.match(/TheWeaponBonusNames\s*\[\s*\]\s*=\s*\{([^}]+)\}/s);
  if (!match) return [];
  return extractQuotedStrings(match[1]!);
}

/**
 * Parse C++ weapon field names from TheWeaponTemplateFieldParseTable.
 * Extracts the field name strings.
 */
export function parseCppWeaponFieldNames(source: string): string[] {
  const match = source.match(
    /TheWeaponTemplateFieldParseTable\s*\[\s*\]\s*=\s*\{([\s\S]*?)\{\s*NULL/,
  );
  if (!match) return [];
  return extractQuotedStrings(match[1]!);
}

/**
 * Parse C++ WeaponBonusConditionType enum values.
 * Returns ordered list of enum constant names (without WEAPONBONUSCONDITION_ prefix).
 */
export function parseCppWeaponBonusEnumValues(source: string): string[] {
  const match = source.match(
    /enum\s+WeaponBonusConditionType\s*\{([\s\S]*?WEAPONBONUSCONDITION_COUNT[\s\S]*?)\}/,
  );
  if (!match) return [];

  const body = match[1]!;
  const names: string[] = [];
  const lines = body.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    // Skip preprocessor directives, comments, INVALID, and COUNT
    if (trimmed.startsWith('#') || trimmed.startsWith('//')) continue;
    const enumMatch = trimmed.match(/^WEAPONBONUSCONDITION_(\w+)/);
    if (!enumMatch) continue;
    const name = enumMatch[1]!;
    if (name === 'INVALID' || name === 'COUNT') continue;
    // Skip obsolete entries
    if (name.includes('OBSOLETE')) continue;
    names.push(name);
  }
  return names;
}

function extractQuotedStrings(text: string): string[] {
  const names: string[] = [];
  const regex = /["']([^"']+)["']/g;
  let m;
  while ((m = regex.exec(text)) !== null) {
    names.push(m[1]!);
  }
  return names;
}

// ── TS Port Extractors ──────────────────────────────────────────────────────

/**
 * Extract SOURCE_DAMAGE_TYPE_NAMES from the TS port's index.ts.
 */
export function parseTsDamageTypeNames(source: string): string[] {
  const match = source.match(
    /SOURCE_DAMAGE_TYPE_NAMES\s*(?::\s*readonly\s+string\[\])?\s*=\s*\[([\s\S]*?)\];/,
  );
  if (!match) return [];
  return extractQuotedStrings(match[1]!);
}

/**
 * Extract WEAPON_BONUS_CONDITION_BY_NAME keys from the TS port's index.ts.
 */
export function parseTsWeaponBonusConditionNames(source: string): string[] {
  const match = source.match(
    /WEAPON_BONUS_CONDITION_BY_NAME\s*=\s*new\s+Map\s*<[^>]*>\s*\(\s*\[([\s\S]*?)\]\s*\)/,
  );
  if (!match) return [];
  return extractQuotedStrings(match[1]!);
}

/**
 * Extract weapon field names read by resolveWeaponProfileFromDef in TS port.
 * Finds all readNumericField/readStringField/readBooleanField calls.
 */
export function parseTsWeaponFieldNames(source: string): string[] {
  // Find the resolveWeaponProfileFromDef method body
  const startIdx = source.indexOf('resolveWeaponProfileFromDef(weaponDef');
  if (startIdx === -1) return [];

  // Find the end of the method by looking for the next top-level method declaration
  const rest = source.slice(startIdx);
  const nextMethodMatch = rest.match(/\n  (?:private|public|protected)\s+\w+\s*\(/);
  const endOffset = nextMethodMatch?.index ?? 15000;
  const window = rest.slice(0, endOffset);

  const fieldNames = new Set<string>();

  // Match readNumericField/readStringField/readBooleanField with field name arrays
  const fieldRegex = /read(?:Numeric|String|Boolean)Field\s*\([^,]+,\s*\[([^\]]+)\]/g;
  let m;
  while ((m = fieldRegex.exec(window)) !== null) {
    for (const name of extractQuotedStrings(m[1]!)) {
      fieldNames.add(name);
    }
  }

  // Also match direct field access like weaponDef.fields['FieldName']
  const directRegex = /weaponDef\.fields\s*\[\s*'([^']+)'/g;
  while ((m = directRegex.exec(window)) !== null) {
    fieldNames.add(m[1]!);
  }

  return Array.from(fieldNames).sort();
}

// ── Comparison Logic ────────────────────────────────────────────────────────

export function compareDamageTypes(cppNames: string[], tsNames: string[]): ParityCategoryResult {
  const mismatches: ParityMismatch[] = [];

  // Check ordering for matching positions
  const minLen = Math.min(cppNames.length, tsNames.length);
  for (let i = 0; i < minLen; i++) {
    if (cppNames[i] !== tsNames[i]) {
      mismatches.push({
        category: 'damage-types',
        severity: 'error',
        message: `Position ${i}: C++ has "${cppNames[i]}" but TS has "${tsNames[i]}"`,
        cppValue: cppNames[i],
        tsValue: tsNames[i],
      });
    }
  }

  // Check for extra/missing entries
  if (cppNames.length > tsNames.length) {
    for (let i = tsNames.length; i < cppNames.length; i++) {
      mismatches.push({
        category: 'damage-types',
        severity: 'error',
        message: `Missing in TS: "${cppNames[i]}" at position ${i}`,
        cppValue: cppNames[i],
      });
    }
  } else if (tsNames.length > cppNames.length) {
    for (let i = cppNames.length; i < tsNames.length; i++) {
      mismatches.push({
        category: 'damage-types',
        severity: 'error',
        message: `Extra in TS: "${tsNames[i]}" at position ${i} (not in C++)`,
        tsValue: tsNames[i],
      });
    }
  }

  return {
    category: 'damage-types',
    status: mismatches.length === 0 ? 'match' : 'mismatch',
    mismatches,
  };
}

export function compareWeaponBonusConditions(
  _cppEnumValues: string[],
  cppNameStrings: string[],
  tsNames: string[],
): ParityCategoryResult {
  const mismatches: ParityMismatch[] = [];

  // Compare the TheWeaponBonusNames string array against TS map keys
  const tsSet = new Set(tsNames);
  const cppSet = new Set(cppNameStrings);

  for (const name of cppNameStrings) {
    if (name.includes('OBSOLETE')) continue;
    if (name.startsWith('SOLO_')) continue; // difficulty bonuses, not gameplay
    if (name.startsWith('DEMORALIZED')) continue; // #ifdef'd out
    if (!tsSet.has(name)) {
      mismatches.push({
        category: 'weapon-bonus-conditions',
        severity: 'warning',
        message: `Missing in TS: "${name}" (present in C++ TheWeaponBonusNames)`,
        cppValue: name,
      });
    }
  }

  for (const name of tsNames) {
    if (!cppSet.has(name)) {
      mismatches.push({
        category: 'weapon-bonus-conditions',
        severity: 'warning',
        message: `Extra in TS: "${name}" (not in C++ TheWeaponBonusNames)`,
        tsValue: name,
      });
    }
  }

  return {
    category: 'weapon-bonus-conditions',
    status: mismatches.length === 0 ? 'match' : mismatches.some((m) => m.severity === 'error') ? 'mismatch' : 'partial',
    mismatches,
  };
}

export function compareWeaponFields(cppFields: string[], tsFields: string[]): ParityCategoryResult {
  const mismatches: ParityMismatch[] = [];
  const tsSet = new Set(tsFields);
  const cppSet = new Set(cppFields);

  // Fields that are visual-only or not relevant for game logic parity
  const visualOnlyFields = new Set([
    'FireSound', 'FireSoundLoopTime', 'FireFX', 'ProjectileDetonationFX',
    'FireOCL', 'ProjectileDetonationOCL', 'ProjectileExhaust',
    'VeterancyFireFX', 'VeterancyProjectileDetonationFX',
    'VeterancyFireOCL', 'VeterancyProjectileDetonationOCL',
    'VeterancyProjectileExhaust',
    'WeaponRecoil', 'ShowsAmmoPips', 'PlayFXWhenStealthed',
    'SuspendFXDelay', 'ProjectileStreamName',
  ]);

  for (const field of cppFields) {
    if (visualOnlyFields.has(field)) continue;
    if (!tsSet.has(field)) {
      mismatches.push({
        category: 'weapon-fields',
        severity: 'warning',
        message: `C++ weapon field "${field}" not read by TS resolveWeaponProfileFromDef`,
        cppValue: field,
      });
    }
  }

  for (const field of tsFields) {
    if (!cppSet.has(field)) {
      mismatches.push({
        category: 'weapon-fields',
        severity: 'info',
        message: `TS reads "${field}" which is not in C++ WeaponTemplateFieldParseTable (may be an alias)`,
        tsValue: field,
      });
    }
  }

  return {
    category: 'weapon-fields',
    status: mismatches.length === 0 ? 'match' : mismatches.some((m) => m.severity === 'error') ? 'mismatch' : 'partial',
    mismatches,
  };
}

// ── Report Builder ──────────────────────────────────────────────────────────

export function buildSourceParityReport(categories: ParityCategoryResult[]): SourceParityReport {
  const totalMismatches = categories.reduce((sum, c) => sum + c.mismatches.length, 0);
  const errors = categories.reduce(
    (sum, c) => sum + c.mismatches.filter((m) => m.severity === 'error').length,
    0,
  );
  const warnings = categories.reduce(
    (sum, c) => sum + c.mismatches.filter((m) => m.severity === 'warning').length,
    0,
  );
  const passingCategories = categories.filter((c) => c.status === 'match').length;
  const failingCategories = categories.filter((c) => c.status === 'mismatch').length;

  return {
    generatedAt: new Date().toISOString(),
    status: errors > 0 ? 'fail' : 'pass',
    summary: {
      totalCategories: categories.length,
      passingCategories,
      failingCategories,
      totalMismatches,
      errors,
      warnings,
    },
    categories,
  };
}

export function formatReportMarkdown(report: SourceParityReport): string {
  const lines: string[] = [
    '# Source Truth Parity Report',
    '',
    `Generated: ${report.generatedAt}`,
    `Status: **${report.status.toUpperCase()}**`,
    '',
    '## Summary',
    '',
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Categories | ${report.summary.totalCategories} |`,
    `| Passing | ${report.summary.passingCategories} |`,
    `| Failing | ${report.summary.failingCategories} |`,
    `| Total Mismatches | ${report.summary.totalMismatches} |`,
    `| Errors | ${report.summary.errors} |`,
    `| Warnings | ${report.summary.warnings} |`,
    '',
  ];

  for (const category of report.categories) {
    const icon = category.status === 'match' ? 'PASS' : category.status === 'mismatch' ? 'FAIL' : 'WARN';
    lines.push(`## ${icon}: ${category.category}`);
    lines.push('');

    if (category.mismatches.length === 0) {
      lines.push('No mismatches found.');
    } else {
      for (const mismatch of category.mismatches) {
        const prefix = mismatch.severity === 'error' ? '[ERROR]' : mismatch.severity === 'warning' ? '[WARN]' : '[INFO]';
        lines.push(`- ${prefix} ${mismatch.message}`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ── Main ────────────────────────────────────────────────────────────────────

export async function runSourceParityCheck(rootDir: string): Promise<SourceParityReport> {
  const repoRoot = path.resolve(rootDir, '..');

  // Read C++ source files (prefer ZH/GeneralsMD variant)
  const zhDamageCpp = await readFileOrEmpty(
    path.join(repoRoot, 'GeneralsMD/Code/GameEngine/Source/GameLogic/System/Damage.cpp'),
  );
  const zhDamageH = await readFileOrEmpty(
    path.join(repoRoot, 'GeneralsMD/Code/GameEngine/Include/GameLogic/Damage.h'),
  );
  const genDamageH = await readFileOrEmpty(
    path.join(repoRoot, 'Generals/Code/GameEngine/Include/GameLogic/Damage.h'),
  );
  const zhWeaponH = await readFileOrEmpty(
    path.join(repoRoot, 'GeneralsMD/Code/GameEngine/Include/GameLogic/Weapon.h'),
  );
  const genWeaponH = await readFileOrEmpty(
    path.join(repoRoot, 'Generals/Code/GameEngine/Include/GameLogic/Weapon.h'),
  );
  const zhWeaponCpp = await readFileOrEmpty(
    path.join(repoRoot, 'GeneralsMD/Code/GameEngine/Source/GameLogic/Object/Weapon.cpp'),
  );
  const genWeaponCpp = await readFileOrEmpty(
    path.join(repoRoot, 'Generals/Code/GameEngine/Source/GameLogic/Object/Weapon.cpp'),
  );

  // Read TS port source
  const tsIndexPath = path.join(rootDir, 'packages/game-logic/src/index.ts');
  const tsIndex = await readFileOrEmpty(tsIndexPath);

  const categories: ParityCategoryResult[] = [];

  // A. Damage Types — use ZH if available, else Generals
  const cppDamageSource = zhDamageCpp || zhDamageH || genDamageH;
  const cppDamageNames = parseCppDamageTypeNames(cppDamageSource);
  const tsDamageNames = parseTsDamageTypeNames(tsIndex);
  if (cppDamageNames.length > 0 && tsDamageNames.length > 0) {
    categories.push(compareDamageTypes(cppDamageNames, tsDamageNames));
  }

  // B. Weapon Bonus Conditions — use ZH if available
  const weaponBonusSource = zhWeaponH || genWeaponH;
  const cppBonusEnumValues = parseCppWeaponBonusEnumValues(weaponBonusSource);
  const cppBonusNames = parseCppWeaponBonusNames(weaponBonusSource);
  const tsBonusNames = parseTsWeaponBonusConditionNames(tsIndex);
  if (cppBonusNames.length > 0 && tsBonusNames.length > 0) {
    categories.push(compareWeaponBonusConditions(cppBonusEnumValues, cppBonusNames, tsBonusNames));
  }

  // C. Weapon Fields — use ZH parse table
  const weaponFieldSource = zhWeaponCpp || genWeaponCpp;
  const cppWeaponFields = parseCppWeaponFieldNames(weaponFieldSource);
  const tsWeaponFields = parseTsWeaponFieldNames(tsIndex);
  if (cppWeaponFields.length > 0 && tsWeaponFields.length > 0) {
    categories.push(compareWeaponFields(cppWeaponFields, tsWeaponFields));
  }

  return buildSourceParityReport(categories);
}

async function readFileOrEmpty(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return '';
  }
}

async function main(): Promise<void> {
  const scriptPath = fileURLToPath(import.meta.url);
  const rootDir = path.resolve(path.dirname(scriptPath), '..');
  const strict = process.argv.includes('--strict');

  const report = await runSourceParityCheck(rootDir);

  // Ensure output directory exists
  const outputDir = path.join(rootDir, 'test-results', 'parity');
  await fs.mkdir(outputDir, { recursive: true });

  const jsonPath = path.join(outputDir, 'source-parity.json');
  const mdPath = path.join(outputDir, 'source-parity.md');

  await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await fs.writeFile(mdPath, formatReportMarkdown(report), 'utf8');

  console.log(`Source parity report written: ${jsonPath}`);
  console.log(`Markdown summary: ${mdPath}`);
  console.log(`Status: ${report.status} (${report.summary.errors} errors, ${report.summary.warnings} warnings)`);

  for (const cat of report.categories) {
    const icon = cat.status === 'match' ? 'PASS' : cat.status === 'mismatch' ? 'FAIL' : 'WARN';
    console.log(`  ${icon}: ${cat.category} (${cat.mismatches.length} mismatches)`);
  }

  if (strict && report.status === 'fail') {
    process.exitCode = 1;
  }
}

const executedScriptPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
const currentScriptPath = fileURLToPath(import.meta.url);
if (executedScriptPath === currentScriptPath) {
  await main();
}
