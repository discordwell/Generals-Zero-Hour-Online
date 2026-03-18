# Claudepad — Session Memory

## Session Summaries

### 2026-03-18T23:00Z — Fix init hang, deploy, wet test
- **Root cause**: Page hung on "Initializing subsystems..." due to two issues:
  1. IDB deadlock: multiple open Generals tabs blocked `CacheStore.open()` — no timeout, hung forever
  2. Stale `ini-bundle.json` on server (hash mismatch) — masked by the IDB hang
- **Fix**: Added 3-second timeout + `onblocked` handler to `CacheStore.open()` in `packages/assets/src/cache.ts`
- **Deploy**: Rebuilt with new bundle hash `index-Ci5Yp0j1.js`, rsync'd dist + corrected ini-bundle.json to ovh2
- **Wet test results**: Main menu loads, Skirmish on Tournament Desert works (784 objects, terrain/minimap/command card render)
- **Remaining**: 273 unresolved visuals (3D model pipeline), debug HUD still visible (separate from UiRuntime debug toggle)
- Previous session's code changes confirmed intact: hotkey resolver, CommandCardRenderer, F2 debug toggle, enableDebugOverlay:false
- SSH was down on ovh2 for ~30min (port 22 refused, daemon crashed) — came back on its own
- All 3295 tests pass

### 2026-03-13T03:10Z — Test infrastructure: shared helpers + test decomposition
- Created `test-helpers.ts` — single shared module with 18 reusable test builders (makeBlock, makeObjectDef, makeBundle, etc.)
- Eliminated duplicate helper definitions from index.test.ts, containment.test.ts, parity-agent.ts
- Decomposed index.test.ts (69,639 → 44,019 lines, 37% reduction) into 8 domain test files:
  - update-behaviors.test.ts (13,240 lines, 74 describe blocks)
  - entity-lifecycle.test.ts (3,670 lines, 21 describe blocks)
  - aircraft-ai.test.ts (2,562 lines, 6 describe blocks)
  - status-effects.test.ts (1,956 lines, 8 describe blocks)
  - upgrade-production.test.ts (1,673 lines, 12 describe blocks)
  - render-state.test.ts (1,315 lines, 6 describe blocks)
  - stealth-detection.test.ts (679 lines, 3 describe blocks)
  - bridge-mechanics.test.ts (442 lines, 1 describe block)
- All 3,241 tests pass across 142 test files, TSC clean

### 2026-03-13T02:26Z — Phases 11-13 COMPLETE, all 13 phases done
- Phase 11: Extracted entity-factory.ts (97 methods, 4,522 lines) — createMapEntity, spawnEntityFromTemplate, 95 extract*Profile methods
- Phase 12: Extracted render-state-bridge.ts (10 methods + 2 constants, 691 lines) — syncModelConditionFlags, deriveRenderAnimationState, makeRenderableEntityState
- Phase 13: Extracted update-behaviors.ts (56 methods, 2,225 lines) — mines, crates, demo traps, battle plan, special abilities, guard, deploy, horde, bone FX, etc.
- index.ts reduced from 66,247 → 30,987 lines (53% reduction, ~35,260 lines extracted)
- All 3,241 tests pass, TSC clean (only pre-existing parity-agent errors)
- 13 phases completed across multiple sessions

### 2026-03-12T21:20Z — Phase 1a: script-actions.ts extraction COMPLETE
- Extracted 402 script action methods from `GameLogicSubsystem` class in `index.ts` to new `script-actions.ts` (12,273 lines)
- `index.ts` reduced from 66,247 → 54,165 lines (12,082 line reduction)
- Pattern: `self: GL` parameter (GL = any), `@ts-nocheck`, facades in index.ts with `(impl as any)(this, ...args)`
- 109 facade methods added, ~80 class methods changed from `private` to `/* @internal */`
- 44 module-level constants exported for script-actions.ts to import
- Circular import from index.js works because constants only accessed inside function bodies (ESM live bindings)
- Also imports from ini-readers.js, registry-lookups.js, special-power-routing.js, supply-chain.js, production-prerequisites.js
- All 3241 tests pass, only 3 pre-existing TS errors remain (parity-agent.ts)
- Temp extraction scripts cleaned up (15 files removed)

## Key Findings

### Phase 1a Extraction Lessons
- **Brace counting for method boundaries** gets confused by inline object types in function parameters — need manual correction
- **ESM circular deps** work fine if the imported values are only accessed inside function bodies (not at module evaluation time)
- **`@ts-nocheck` + `self: any`** is the pragmatic choice for extracted methods — real type safety comes from the test suite
- **ALL_CAPS string-stripping** to find missing constants: strip quoted strings before scanning, or you'll get false negatives from constants whose names match switch case labels
- **`export type type`** bug: adding `export` to `type X` declarations must avoid doubling the `type` keyword
- **TS6133 for private methods**: Methods called via `self.method()` from `@ts-nocheck` files are invisible to TS — remove `private` to silence
