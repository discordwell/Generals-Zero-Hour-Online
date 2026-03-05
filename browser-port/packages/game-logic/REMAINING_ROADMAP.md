# Game Logic Remaining Roadmap (Source-Parity)

Last updated: 2026-03-04

Next roadmap for post-tranche full retail-content parity:
`/Users/discordwell/Projects/CnC_Generals_Zero_Hour/browser-port/packages/game-logic/RETAIL_CONTENT_PARITY_ROADMAP.md`

## Objective

Reach practical browser playability plus high-confidence source parity against retail C&C Generals Zero Hour behavior.

## Baseline

- Branch target: `main`
- Full test baseline: `1984` passing (`npx vitest run`)
- E2E baseline: `9` files / `755` lines (`smoke` + 8 gameplay scenarios)
- Source-parity marker counts:
  - `246` total `Source parity subset` markers across packages
  - `237` in `packages/game-logic/src/index.ts`

---

## Previous Roadmap (2026-02-24) — Completed

Status: **COMPLETED** (closed on 2026-03-04).

- [x] Phase 1: Script Team Condition/State Parity
- [x] Phase 2: Waypoint-Path Movement/Completion Parity tranche (initial subset)
- [x] Phase 3: Script CommandButton Coverage Parity tranche (initial subset)
- [x] Phase 4: Generic Enterability / GroupEnter Parity tranche (initial subset)
- [x] Phase 5: Terrain-Affecting Script Action Parity tranche
- [x] Phase 6: AI Integration Parity Cleanups tranche
- [x] Phase 7: Deterministic Snapshot and Lockstep Parity tranche
- [x] Phase 8: Browser Playability Certification tranche

Note: completed means implemented and merged, not full source equivalence.

---

## New Roadmap (Audit-Driven Parity Closure)

### Phase A: Command/UI Parity Closure

Goal: make command availability, targeting, and dispatch behavior source-compatible without fallback ambiguity.

Action items:
- [x] A1. Add model-level object-target validity gate to `ControlBarModel` (not just app-layer right-click flow).
- [x] A2. Add special-power readiness gating into control-bar button availability using live game-logic ready-frame state.
- [x] A3. Remove stale command availability TODO markers and replace with concrete source-behavior notes.
- [x] A4. Replace dispatch fallback comment path with explicit “unsupported command route” instrumentation and tests.

Primary files:
- `browser-port/packages/ui/src/control-bar.ts`
- `browser-port/packages/ui/src/control-bar.test.ts`
- `browser-port/packages/ui/src/index.ts`
- `browser-port/packages/app/src/control-bar-buttons.ts`
- `browser-port/packages/app/src/control-bar-buttons.test.ts`
- `browser-port/packages/app/src/control-bar-dispatch.ts`
- `browser-port/packages/app/src/control-bar-dispatch.test.ts`
- `browser-port/packages/app/src/main.ts`

Exit criteria:
- Object-target invalidity is rejected consistently regardless of caller path.
- Special-power buttons disable on cooldown by source-ready-frame checks.

### Phase B: Script Command-Button Coverage Closure

Goal: reduce remaining script command-button subset behavior where source supports additional variants.

Action items:
- [x] B1. Audit each currently-rejected script command-button variant and classify as:
  - `source-unsupported` (keep rejection, add explicit source proof)
  - `port-missing` (implement)
- [x] B2. Implement port-missing target variants for command types with source support.
- [x] B3. Add regression tests for each implemented variant and each intentional source-unsupported rejection.
- [x] B4. Remove stale “pending wiring” comments where runtime is already wired.

Primary files:
- `browser-port/packages/game-logic/src/index.ts`
- `browser-port/packages/game-logic/src/index.test.ts`

Exit criteria:
- No ambiguous “not implemented” comments for source-supported script command-button routes.

Current audit snapshot:
- `OBJECT_UPGRADE`/`PLAYER_UPGRADE`, `SWITCH_WEAPON`, `HACK_INTERNET`, and `SELL` object/position script invocation variants are kept no-target-only (source-equivalent).
- `COMBATDROP` is kept object-target-only for script invocation (source-equivalent).
- `POW_RETURN_TO_PRISON` and `PICK_UP_PRISONER` are kept unsupported in script command-button path (source-equivalent for standard Generals/ZH script set).
- No additional source-supported target variants were identified in this tranche.

### Phase C: Presentation/Audio Bridge Parity

Goal: close remaining bridge gaps that affect player-visible parity.

Action items:
- [x] C1. Wire drawable-position audio resolver from app runtime and validate object/drawable positional fallbacks.
- [x] C2. Remove stale terrain oversize / guardband bridge TODO markers now that runtime bridge is active.
- [x] C3. Add runtime-bridge tests for guardband + terrain oversize propagation through app frame loop seams.
- [x] C4. Re-audit audio culling behavior for unresolved owner IDs and document intended source-equivalent fallback.

Primary files:
- `browser-port/packages/app/src/main.ts`
- `browser-port/packages/audio/src/index.ts`
- `browser-port/packages/audio/src/index.test.ts`
- `browser-port/packages/game-logic/src/index.ts`

Exit criteria:
- No stale TODO markers for already-wired script presentation bridges.
- Positional audio owner resolution is wired for both object and drawable IDs.

### Phase D: Determinism + Network Handshake Parity

Goal: remove transitional parity fallbacks from network lockstep path.

Action items:
- [x] D1. Reconcile network frame resend fallback path with source-style connection ownership and resend handshake flow.
- [x] D2. Replace or scope engine metadata-CRC TODO so responsibility is explicit (`engine` metadata hash vs `game-logic` full CRC).
- [x] D3. Add targeted network tests for resend request ownership edge cases.
- [x] D4. Run long deterministic mismatch stress with CRC consensus assertions.

Primary files:
- `browser-port/packages/network/src/index.ts`
- `browser-port/packages/network/src/index.test.ts`
- `browser-port/packages/engine/src/deterministic-state.ts`
- `browser-port/packages/engine/src/deterministic-state.test.ts`
- `browser-port/packages/game-logic/src/deterministic-crc.test.ts`

Exit criteria:
- No transitional TODO fallback in frame-resend path.
- Deterministic responsibilities are explicit and test-covered.

### Phase E: Browser Parity Certification

Goal: prove parity-critical behavior via scenario coverage, not only unit tests.

Action items:
- [x] E1. Expand E2E scenarios around command targeting validity and special-power cooldown gating.
- [x] E2. Add scenario(s) for script command-button variants implemented in Phase B.
- [x] E3. Add scenario for script terrain/view presentation bridge effects.
- [x] E4. Produce blocker-only final parity gap list after rerunning full suites.

Primary files:
- `browser-port/e2e/gameplay-*.e2e.ts`
- `browser-port/e2e/smoke.e2e.ts`

Exit criteria:
- E2E covers command/target/cooldown/script bridge parity cases that were previously unproven.

Blocker-only parity gap list (post-suite rerun on 2026-03-04):
- No blocker regressions were detected in this roadmap tranche after full `npx vitest run` and full `npx playwright test`.

---

## Execution Rules

- For each slice:
  1. Implement code.
  2. Add or update focused tests.
  3. Run targeted tests.
  4. Run full `npx vitest run`.
  5. Mark slice complete here.

- Keep this file status-driven:
  - Move `[ ]` to `[x]` only after full test pass.
  - Keep blocker language concrete and code-referenced.
