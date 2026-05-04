# Parity Testing Workflow

Three-layer verification system ensuring the browser port matches the original C++ Generals engine.

## Layer 1: Source Truth Verification

Parses C++ source headers/implementations from the in-repo original and compares enum values,
field tables, and type definitions against the TypeScript port.

```bash
# Generate source truth report (JSON + Markdown)
npm run parity:source

# Strict mode — exits non-zero on errors
npm run parity:strict
```

**Reports:**
- `test-results/parity/source-parity.json` — structured mismatch data
- `test-results/parity/source-parity.md` — human-readable summary

**What it checks:**
- Damage type enum ordering (C++ `DamageType` vs TS `SOURCE_DAMAGE_TYPE_NAMES`)
- Weapon bonus condition names (C++ `TheWeaponBonusNames` vs TS `WEAPON_BONUS_CONDITION_BY_NAME`)
- Weapon field coverage (C++ `TheWeaponTemplateFieldParseTable` vs TS `resolveWeaponProfileFromDef`)

## Layer 2: Module Runtime Coverage

Compares source-declared modules, shipped INI module usage, TypeScript gameplay
signals, test signals, and save-only coverage. Use this before picking the next
runtime parity target so high-use INI modules do not hide behind save adapters or
incidental imports.

```bash
npm run report:module-runtime-coverage
```

**Reports:**
- `module-runtime-coverage-report.json` - ranked source+INI module coverage gaps

**What it checks:**
- C++ `ModuleFactory.cpp` registrations from Generals and GeneralsMD
- Module usage in the shipped `ini-bundle.json`
- Gameplay implementation signals in `packages/game-logic/src`
- Test and save-coverage signals for each module

## Layer 3: Module Field Coverage

Compares C++ module `buildFieldParse` tables, shipped INI fields, TypeScript
runtime extraction signals, and tests. Use this after module coverage is clear:
it finds the next layer of parity drift where a module exists but individual INI
parameters are still ignored.

```bash
npm run report:module-field-coverage
```

**Reports:**
- `module-field-coverage-report.json` - ranked shipped module fields missing TS runtime signals

**What it checks:**
- C++ module data classes, inherited field parsers, and helper parse tables
- Shipped INI fields by module type and usage count
- Gameplay implementation signals in `packages/game-logic/src`
- Test signals for each shipped source-known module field

## Layer 4: Unit Tests (Parity Agent)

Headless game logic tests using `createParityAgent()` — a camera-free wrapper around
`GameLogicSubsystem` that works in vitest without browser/Three.js rendering.

```bash
# Run all parity tests (source truth + combat + pipeline)
npm run parity

# Run specific test files
npx vitest run packages/game-logic/src/parity-combat.test.ts
npx vitest run packages/game-logic/src/parity-pipeline.test.ts
npx vitest run packages/game-logic/src/parity-agent.test.ts
npx vitest run tools/parity-source-truth.test.ts
```

**Test categories:**
- `parity-agent.test.ts` — Agent smoke tests (state, step, diff, determinism)
- `parity-combat.test.ts` — C++ formula verification (armor coefficients, UNRESISTABLE, clip reload, delay, pre-attack types)
- `parity-pipeline.test.ts` — Multi-system integration (combat+armor+upgrade, mutual combat, victory, guard, stop)
- `parity-source-truth.test.ts` — Parser unit tests + live source comparison

## Layer 4: Runtime Visual Scene Parity

Retail-map scene probes using Playwright against the built app. This catches
runtime visual blockers that the logic/source-truth layers can miss, such as
unresolved model placeholders, missing skybox state, and page/runtime errors.

```bash
npm run report:visual-scenes
```

**Reports:**
- `visual-scene-parity-report.json` — per-scene runtime probe results
- `test-results/visual-scenes/*.png` — scene captures for inspected maps

**Current probe scenes:**
- `Tournament Desert`
- `MD_USA01`

**What it checks:**
- No uncaught page errors
- No unresolved placed-map objects
- No unresolved rendered entities / visible placeholders after warm-up
- Minimum renderable population for the scene
- Script skybox visible on campaign intro scenes that expect it

## Layer 5: Visual Comparison

Screenshot comparison using the Visual Oracle tool (QEMU-based).

```bash
cd tools/visual-oracle && npx tsx cli.ts <command>
```

See `tools/visual-oracle/` for details.

## Quick Reference

| Command | What it does |
|---------|-------------|
| `npm run parity` | Run all parity vitest suites |
| `npm run parity:source` | Generate source truth report |
| `npm run parity:strict` | Source truth with non-zero exit on failure |
| `npm run report:module-runtime-coverage` | Rank source+INI modules missing gameplay coverage |
| `npm run report:module-field-coverage` | Rank shipped source-known module fields missing gameplay coverage |
| `npm run report:visual-scenes` | Probe canonical retail scenes for runtime visual blockers |
| `npm test` | Run all tests including parity |

## Architecture

```
ParityAgent (parity-agent.ts)
  └── GameLogicSubsystem (index.ts)  ← wraps, doesn't duplicate
       ├── submitCommand() ← move, attack, build, etc.
       ├── update(1/30) ← step simulation
       └── getEntityState() ← read entity data

Source Truth (parity-source-truth.ts)
  ├── C++ headers (Generals/ + GeneralsMD/)
  │    ├── Damage.h / Damage.cpp
  │    ├── Weapon.h / Weapon.cpp
  │    └── Armor.cpp
  └── TS port (packages/game-logic/src/index.ts)
       ├── SOURCE_DAMAGE_TYPE_NAMES
       ├── WEAPON_BONUS_CONDITION_BY_NAME
       └── resolveWeaponProfileFromDef()
```
