# Full Retail-Content Parity Roadmap

Last updated: 2026-03-05

## Scope

This roadmap starts **after** completion of `/Users/discordwell/Projects/CnC_Generals_Zero_Hour/browser-port/packages/game-logic/REMAINING_ROADMAP.md` (Phases A-E complete).

Goal: close gaps between the current browser port and full retail C&C Generals Zero Hour behavior/content, including real data scale, full module parity, and campaign/skirmish playability.

## Baseline Snapshot (2026-03-05)

- Branch target: `main`
- Unit/integration tests: `2049` passing (`npx vitest run`)
- E2E tests: `13` passing (`npx playwright test`)
- TypeScript compile health: `0` `tsc` errors (`npm run -s typecheck`)
- Runtime content bundle (current checked-in app assets):
  - objects: `8`
  - command buttons: `6`
  - command sets: `3`
  - special powers: `1`

## Top-Level Gap Buckets

1. **Engineering baseline debt**: typecheck failures and package type mismatch prevent safe large-scale parity work.
2. **Retail data scale gap**: checked-in runtime content is a tiny fixture set, not retail content.
3. **Gameplay module depth gap**: multiple systems are implemented as source-parity subsets rather than full behavior.
4. **Campaign/script completeness gap**: script engine exists but still has subset/unsupported paths vs full retail script usage.
5. **UI/audio/presentation gap**: core hooks exist, but full retail command card/EVA/FX/audio behavior is incomplete at content scale.
6. **Certification gap**: current E2E suite validates smoke scenarios, not full retail parity matrix.

---

## Phase 0: Engineering Baseline Hardening

Goal: make the codebase safe for large incremental parity slices.

Action items:
- [x] 0.1 Fix all `npm run -s typecheck` errors in `game-logic`, `app`, and `renderer`.
- [x] 0.2 Add CI-style local gate script: `typecheck + vitest + playwright-smoke`.
- [x] 0.3 Remove stale/invalid types introduced by in-progress modules (`MapEntity` field drift, command type mismatches).
- [x] 0.4 Add a tracked “parity debt” report generation script (counts TODO/subset markers by package).

Primary files:
- `/Users/discordwell/Projects/CnC_Generals_Zero_Hour/browser-port/packages/game-logic/src/index.ts`
- `/Users/discordwell/Projects/CnC_Generals_Zero_Hour/browser-port/packages/app/src/main.ts`
- `/Users/discordwell/Projects/CnC_Generals_Zero_Hour/browser-port/packages/renderer/src/object-visuals.ts`
- `/Users/discordwell/Projects/CnC_Generals_Zero_Hour/browser-port/package.json`

Exit criteria:
- `typecheck`, `vitest`, and `playwright smoke` all pass from a single command.

---

## Phase 1: Retail Data Pipeline + Runtime Catalog Expansion

Goal: move from fixture-only content to retail-scale runtime data.

Action items:
- [x] 1.1 Validate `convert-all` pipeline end-to-end on a full retail data source tree.
- [x] 1.2 Expand conversion coverage for unresolved INI inheritance/content edge cases (including current TODOs in production template ancestry handling).
- [x] 1.3 Produce a “retail-lite” checked-in test dataset (non-copyright-sensitive subset) with meaningful command sets/special powers.
- [x] 1.4 Add conversion parity report: unresolved blocks, unsupported block types, missing command set references.
- [x] 1.5 Add guardrails to fail startup if manifest/data mismatch is detected.

Primary files:
- `/Users/discordwell/Projects/CnC_Generals_Zero_Hour/browser-port/tools/convert-all/src/convert-all.ts`
- `/Users/discordwell/Projects/CnC_Generals_Zero_Hour/browser-port/packages/ini-data/src/registry.ts`
- `/Users/discordwell/Projects/CnC_Generals_Zero_Hour/browser-port/packages/app/public/assets/data/ini-bundle.json`

Exit criteria:
- Runtime can load a retail-scale converted catalog with non-trivial command sets, powers, and upgrades.

---

## Phase 2: Command Card and Build Graph Full Coverage

Goal: remove remaining command-card and production graph deviations at retail scale.

Action items:
- [x] 2.1 Build a full command-type coverage matrix from retail command buttons and map each to dispatch support status.
- [x] 2.2 Implement missing dispatch routes for retail-referenced command types.
- [x] 2.3 Replace remaining malformed-data TODO guidance paths with explicit source-equivalent behavior or hard validation errors.
- [x] 2.4 Validate upgrade/science/build prerequisites against retail dependency chains.
- [x] 2.5 Add scenario tests for representative command cards from each faction.

Primary files:
- `/Users/discordwell/Projects/CnC_Generals_Zero_Hour/browser-port/packages/app/src/control-bar-dispatch.ts`
- `/Users/discordwell/Projects/CnC_Generals_Zero_Hour/browser-port/packages/app/src/control-bar-buttons.ts`
- `/Users/discordwell/Projects/CnC_Generals_Zero_Hour/browser-port/packages/game-logic/src/index.ts`

Exit criteria:
- No retail-referenced command button resolves to unsupported route in normal gameplay.

---

## Phase 3: Unit AI Module Deep-Parity Closure

Goal: complete AI behavior depth beyond current subset implementations.

Action items:
- [x] 3.1 Worker/Dozer: finish task arbitration parity (build vs gather vs repair priority, idle behavior, retask semantics).
- [x] 3.2 Chinook AI: finish full supply, transport, and combat-drop edge cases (state transitions + cancellation rules).
- [x] 3.3 Missile AI: close remaining edge cases for lock loss, fuel/death transitions, and pathing constraints.
- [x] 3.4 Repair dock behavior: complete docking approach-slot and multi-unit contention semantics.
- [x] 3.5 Formation/animation steering: complete visual + movement cohesion behavior under group orders.

Primary files:
- `/Users/discordwell/Projects/CnC_Generals_Zero_Hour/browser-port/packages/game-logic/src/index.ts`
- `/Users/discordwell/Projects/CnC_Generals_Zero_Hour/browser-port/packages/game-logic/src/supply-chain.ts`
- `/Users/discordwell/Projects/CnC_Generals_Zero_Hour/browser-port/packages/game-logic/src/index.test.ts`

Exit criteria:
- AI behavior for core retail units is stable under long simulation and matches source expectations in targeted regression packs.

---

## Phase 4: Weapons, Projectiles, and Special Power Execution Closure

Goal: eliminate remaining special-power and projectile execution shortcuts.

Action items:
- [x] 4.1 Resolve `special-power-routing` TODO/deferred execution assumptions and align with source execution ownership.
- [x] 4.2 Audit OCL-driven and module-driven special powers for missing side effects and recharge semantics.
- [x] 4.3 Expand projectile/weapon behavior coverage for retail weapon flags and damage interactions at scale.
- [x] 4.4 Add parity tests for cross-system interactions: powers + fog + shroud + transport + garrison.

Primary files:
- `/Users/discordwell/Projects/CnC_Generals_Zero_Hour/browser-port/packages/game-logic/src/special-power-routing.ts`
- `/Users/discordwell/Projects/CnC_Generals_Zero_Hour/browser-port/packages/game-logic/src/index.ts`
- `/Users/discordwell/Projects/CnC_Generals_Zero_Hour/browser-port/packages/game-logic/src/combat-damage-events.ts`

Exit criteria:
- Retail-referenced special powers and projectile behaviors run without TODO-path fallbacks.

---

## Phase 5: Script Engine and Campaign-Scale Compatibility

Goal: move from script subset compatibility to campaign-grade script execution.

Action items:
- [x] 5.1 Build action/condition coverage matrix vs retail script usage (campaign + challenge + skirmish scripts).
- [x] 5.2 Implement high-frequency unsupported script actions/conditions found in real map scripts.
- [x] 5.3 Close team/object context edge cases (`THIS_TEAM`, `THIS_OBJECT`, named-player resolution under nested calls).
- [x] 5.4 Validate cutscene/message/audio/timer/script synchronization behavior for mission flows.
- [x] 5.5 Add campaign scenario replay tests with deterministic expected outcomes.

Primary files:
- `/Users/discordwell/Projects/CnC_Generals_Zero_Hour/browser-port/packages/game-logic/src/index.ts`
- `/Users/discordwell/Projects/CnC_Generals_Zero_Hour/browser-port/packages/game-logic/src/index.test.ts`
- `/Users/discordwell/Projects/CnC_Generals_Zero_Hour/browser-port/tools/map-converter/src/MapParser.ts`

Exit criteria:
- Representative campaign scripts run to completion without manual patching.

---

## Phase 6: UI/HUD/EVA and Presentation Parity

Goal: reach gameplay-visible parity for command feedback and mission presentation.

Action items:
- [x] 6.1 Complete command card UX states (disabled reasons, flashing semantics, context-sensitive labels/icons).
- [x] 6.2 Implement EVA/notification parity for attack/power/mission-critical events.
- [x] 6.3 Close minimap/radar/overlay behavior differences in script-controlled missions.
- [x] 6.4 Align endgame/cinematic flow with script timing and player input lock rules.

Primary files:
- `/Users/discordwell/Projects/CnC_Generals_Zero_Hour/browser-port/packages/app/src/main.ts`
- `/Users/discordwell/Projects/CnC_Generals_Zero_Hour/browser-port/packages/app/src/control-bar-*.ts`
- `/Users/discordwell/Projects/CnC_Generals_Zero_Hour/browser-port/packages/ui/src/*.ts`

Exit criteria:
- UI events/feedback match retail expectations in scripted and skirmish scenarios.

---

## Phase 7: Audio/FX/Rendering Content-Scale Parity

Goal: make large-scale retail content presentation behave consistently.

Action items:
- [x] 7.1 Expand audio event coverage (ambient, positional, ownership-scoped, interrupt/priority behavior).
- [x] 7.2 Resolve renderer state mismatches exposed by richer animation states (including type model alignment).
- [x] 7.3 Validate object FX/particles and destruction visuals against retail behavior.
- [x] 7.4 Add stress tests for long-session visual/audio stability.

Primary files:
- `/Users/discordwell/Projects/CnC_Generals_Zero_Hour/browser-port/packages/audio/src/index.ts`
- `/Users/discordwell/Projects/CnC_Generals_Zero_Hour/browser-port/packages/renderer/src/object-visuals.ts`
- `/Users/discordwell/Projects/CnC_Generals_Zero_Hour/browser-port/packages/app/src/script-*-runtime.ts`

Exit criteria:
- No major visual/audio desync or missing-event regressions in long gameplay sessions.

---

## Phase 8: Multiplayer, Replay, and Deterministic Certification

Goal: ensure parity-critical lockstep behavior under realistic multiplayer conditions.

Action items:
- [x] 8.1 Expand lockstep/resend tests to long-running packet-loss/reorder scenarios.
- [x] 8.2 Validate command serialization coverage for all gameplay-relevant command types.
- [x] 8.3 Add replay certification suite: deterministic CRC checkpoints over long sessions.
- [x] 8.4 Document and close any remaining nondeterministic seams.

Primary files:
- `/Users/discordwell/Projects/CnC_Generals_Zero_Hour/browser-port/packages/network/src/index.ts`
- `/Users/discordwell/Projects/CnC_Generals_Zero_Hour/browser-port/packages/engine/src/deterministic-state.ts`
- `/Users/discordwell/Projects/CnC_Generals_Zero_Hour/browser-port/packages/game-logic/src/deterministic-crc.test.ts`

Exit criteria:
- Deterministic CRC/replay tests are stable across long scenario matrix runs.

Nondeterminism seam ledger:
- Network wall-clock usage is isolated behind `NetworkManagerOptions.nowProvider` in `/Users/discordwell/Projects/CnC_Generals_Zero_Hour/browser-port/packages/network/src/index.ts`.
- Deterministic seam tests cover injected clock behavior in `/Users/discordwell/Projects/CnC_Generals_Zero_Hour/browser-port/packages/network/src/index.test.ts`.
- Guardrails enforce no wall-clock/random API usage in game-logic runtime sources via `/Users/discordwell/Projects/CnC_Generals_Zero_Hour/browser-port/packages/game-logic/src/deterministic-seam-guardrails.test.ts`.

---

## Phase 9: Full Certification Matrix and Blocker Burn-Down

Goal: prove practical retail parity via repeatable automated and manual checks.

Action items:
- [x] 9.1 Build faction/general matrix scenarios (USA/China/GLA + Zero Hour generals where data allows).
- [x] 9.2 Build campaign progression matrix (early/mid/late mission scripts).
- [x] 9.3 Add performance certification thresholds (frame time, memory, load time) for retail-scale assets.
- [x] 9.4 Publish blocker-only parity report after each full-suite run; burn down to zero.

Primary files:
- `/Users/discordwell/Projects/CnC_Generals_Zero_Hour/browser-port/e2e/*.e2e.ts`
- `/Users/discordwell/Projects/CnC_Generals_Zero_Hour/browser-port/packages/game-logic/RETAIL_CONTENT_PARITY_ROADMAP.md`

Exit criteria:
- Blocker list is empty for agreed parity scope.

---

## Execution Rules

- For each slice:
  1. Implement code.
  2. Add/update focused tests.
  3. Run targeted tests.
  4. Run full `npx vitest run`.
  5. Run relevant `npx playwright test` subset (or full suite for phase exit).
  6. Mark slice complete here.

- Priority order:
  1. Compile/type safety
  2. Retail data/catalog correctness
  3. Simulation correctness
  4. Presentation polish

- Keep this file status-driven:
  - Move `[ ]` to `[x]` only after test evidence.
  - Keep blocker language concrete and file-referenced.
