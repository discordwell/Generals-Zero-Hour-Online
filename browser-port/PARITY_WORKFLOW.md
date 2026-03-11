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

## Layer 2: Unit Tests (Parity Agent)

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

## Layer 3: Visual Comparison

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
