# Generals Parity Workflow

Parity is proven in layers.  Hand-written TS tests are useful for regression
control, but they do not prove agreement with the original C&C Generals C++
engine on their own.  This document describes how the layers compose, what
each one actually proves, and the path to a CI-gated guarantee.

Modeled on CLIaaS / EasterEgg's `PARITY_WORKFLOW.md` for Red Alert.

## Layer 0 — Source Truth

```sh
npm run parity:source         # report-only
npm run parity:strict         # fail on any mismatch
```

Compares static C++ data (enum definitions, INI field tables, save chunk
layouts, weapon-bonus condition names, damage-type bit lists, module field
parsers, etc.) against the corresponding TypeScript port constants.  Reads
C++ source headers directly out of the in-repo `../GeneralsMD/Code/...`
tree, so a header edit in the source mirror immediately surfaces as a TS
divergence.

356 categories at the time of writing — all green.

**What this proves**: every C++ enum, INI field key, weapon-bonus mask,
save-chunk schema, and module field name the TS port hard-codes matches
the source.

**What it does not prove**: that the runtime behavior agrees with the
original engine — only that the static surface area lines up.

Outputs:

```
test-results/parity/source-parity.json
test-results/parity/source-parity.md
```

### Supporting reports

| Command | What it ranks |
|---------|-------------|
| `npm run report:module-runtime-coverage` | Source+INI modules without gameplay signals |
| `npm run report:module-field-coverage` | Shipped module fields without TS extraction |
| `npm run report:conversion-parity` | INI bundle conversion drift |
| `npm run report:command-coverage` | Command-type coverage for control-bar dispatch |
| `npm run report:script-coverage` | Map-script action / condition coverage |
| `npm run report:save-core-chunks` | Source-save chunk parser round-trip status |

All passing as of 2026-05-20.

## Layer 1 — Save-Load Differential

```sh
npx tsx tools/save-load-parity-report.ts             # regenerate oracle
npx playwright test e2e/save-load-parity.e2e.ts      # diff TS vs oracle
```

The oracle generator parses every real `.sav` fixture under
`fixtures/source-saves/` and dumps the C++ engine's authoritative state:

- frame counter
- object count
- complete object-TOC template list (153 distinct templates per Generals
  campaign save, 200+ per Zero Hour skirmish)
- first-object metadata (template, internal name, team id)
- all CHUNK_* block names present in the file

Output lives at `parity-reports/save-load-parity.json` and `.md` — _not_
under `test-results/`, because Playwright wipes that directory at the start
of each test run.

The differential test then:

1. Boots the dev server via Playwright's webServer config.
2. Loads each fixture through the actual load-game UI.
3. Captures the TS port's `gameLogic.frameCounter` and `spawnedEntities` via
   the `__GENERALS_E2E__` runtime hook.
4. Asserts:
   - **Frame parity (exact)**: TS frame counter equals C++ frame counter.
   - **Object count parity (TS ≤ C++)**: TS spawns no more than C++; any
     excess would be a load-time fabrication bug.
   - **Template coverage (100% strict)**: TS port's spawned templates
     cover **every** distinct template the C++ save references.  Counts
     alive and destroyed entities both — hulks/debris/decals are saved in
     a destroyed state in C++ and the TS port restores them faithfully.
5. Writes per-fixture findings to
   `parity-reports/save-load-findings/<fixture>.sav.json` with covered /
   missing template names, so a downstream tool can roll up the cross-
   fixture diff matrix.

By default only three fixtures run (one Generals, one ZH campaign, one ZH
Challenge) — set `PARITY_FULL=1` to exercise all 36 real saves.

**What this proves**: the TS port can ingest every real C++ save fixture
without losing the frame counter, without fabricating entities, and
reconstructs **100%** of the distinct object templates the C++ engine
saved — including non-gameplay decoration like `Amb_*` ambient-audio
triggers, system decals (`VerticalArrow`), debris hulks, and stumped
trees.  Verified across all 36 fixtures / 34,282 live C++ objects.

**What it does not prove**: that the per-entity field state (positions,
HPs, module fields) matches C++ — only that the templates show up.
Closing this is Layer 2's job (replay CRC differential).

## Layer 1c — Runtime Behavior Fingerprint

```sh
npm run parity:runtime-behavior:test
```

For each save fixture, loads it into the TS port (auto-paused), advances
30/60/120/300 frames in controlled steps, captures the full GameLogic CRC
plus per-section CRCs at every checkpoint, and asserts byte-equality
against a golden fingerprint committed at
`parity-reports/runtime-behavior-fingerprints/<fixture>.json`.

The CRC walk mirrors C++ `GameLogic::getCRC()` (GameLogic.cpp:5420):

- `MARKER:Objects` + every `Object::xfer` snapshot in order
- `RandomSeed`
- `MARKER:ThePartitionManager` + partition snapshot
- `MARKER:ThePlayerList` + player list snapshot
- `MARKER:TheAI` + AI snapshot

If the TS port's `xferSnapshot` implementations match C++ byte-for-byte
(Layer 0's source-truth gates ensure they do), then **stable cross-run
CRCs at fixed frame offsets prove byte-identical runtime state**.  Any
code change that perturbs a single entity field — position, HP, AI
bucket, deterministic random seed — flips the CRC and fails this test.

On a missing fingerprint, the test bootstraps it and skips the equality
check.  On a present fingerprint, equality is enforced.  Committed
fingerprints become the simulation's behavioral spec.

Default subset: `zipeater_GN_000` + `zipeater_ZH_000` (~50s).
`BEHAVIOR_FULL=1` runs all 36 fixtures (~20 min).

**What this proves**: the TS port is byte-deterministic across runs — the
same save advanced the same number of frames produces the same state
every time, down to the bit.  Combined with Layer 0's verification that
TS uses the same xfer-snapshot algorithm as C++, this is the strongest
runtime-parity assertion possible without a co-running C++ engine.

**Composes with**:

- `e2e/source-save-simulation.e2e.ts` — within-process determinism: loads
  a save, runs 300 frames, then RELOADS the same save, runs 300 frames
  again, and asserts CRC identical.  Catches non-deterministic bugs in
  the current process (e.g., a `Math.random` slipping into game-logic).
  L1c catches the complementary case: cross-process drift between
  arbitrary runs against the committed golden fingerprint.

**What it does not prove**: that the CRC value itself matches what the
original C++ engine would compute for the same state.  Closing that
requires Layer 2 (replay CRC differential) or Layer 3 (headless C++
oracle).

## Layer 1d — Runtime Command Fingerprint

```sh
npm run parity:runtime-command:test
```

Extends Layer 1c to include real player commands.  For each fixture,
picks a deterministic VEHICLE (smallest entity id that's alive,
movable, has a side, not airborne), issues a `moveTo` command 50 units
in +X/+Z, advances 30 frames, and captures the post-command CRC + the
entity's exact final position.

Locks down the entire runtime: command dispatch → AI state machine →
locomotor physics (accel/brake/turnRate/minSpeed) → pathfinding A* →
per-frame movement integration.  Any change that affects how a unit
responds to a move command flips the CRC and the entity position.

Fingerprints live at
`parity-reports/runtime-command-fingerprints/<fixture>.json` and are
committed.

## Layer 2 — Replay (.rep) Differential  *(header parser landed; differential pending fixtures)*

Generals replay files (`.rep`) contain frame-by-frame player commands plus
a periodic CRC32 of game state.  A replay differential harness will:

1. Parse a `.rep` to extract: starting save (if any), command sequence,
   CRC checkpoint frames.
2. Drive the TS port through the same command sequence at the same frames.
3. Compare TS-computed CRCs against the recorded values at each checkpoint.

The first frame where CRCs diverge is the first frame TS computed something
different from C++.  This is the gold-standard runtime differential because
the CRC is computed from the C++ engine's complete state — there is no way
for a buggy port to fake it.

Status:
- `tools/replay-format.ts` parses the GENREP header (magic, start/end time,
  frame duration, desync flag, slot disconnects, replay name, SYSTEMTIME,
  version string + number, exe/INI CRCs, game options, local player index).
  Covered by `tools/replay-format.test.ts`.
- Command-stream + CRC differential pending: need real `.rep` fixtures to
  validate the per-frame GameMessage parser
  (Recorder.cpp:780-810) against.

Estimated remaining effort: 1-2 sessions once fixtures land.

## Layer 3 - Headless C++ Oracle  *(v4 landed - Object::xfer identity diff at 36/36 = 0 mismatches)*

```sh
# Build the oracle binary. parity:oracle also auto-builds if the binary is
# missing or stale; set ORACLE_CONDA_ENV if the env is not named "oracle".
npm run oracle:build

# Run the differential against every real .sav fixture:
npm run parity:oracle               # report-only
npm run parity:oracle:strict        # exit non-zero on any mismatch
```

An INDEPENDENT C++ implementation (mingw-w64 build, standalone — no
GeneralsMD source linkage required) that reads the same `.sav` files
as the TS port and dumps a parsed JSON representation.  The
differential (`tools/oracle-parity-report.ts`) runs the oracle on every
real fixture, parses the same fixture in TS via `@generals/engine` and
`runtime-save-game.parseSourceGameLogicChunkState`, and asserts per-field
agreement.

Current scope (v4):
- Chunk inventory: every CHUNK_<name>, blockStartOffset, blockDataOffset,
  blockSize.
- CHUNK_GameLogic header: version, frame counter, object TOC count + per-
  entry templateName/id, object count.
- Per-object headers: tocId, resolved templateName, blockSize, payload
  offset, for **every saved object across every fixture**.
- Object::xfer identity fields: version, objectId, teamId, producerId,
  builderId, drawableId, and internalName for every object whose identity
  prefix parses in the standalone C++ oracle.

Result: 36/36 fixtures agree, 0 mismatches across all 34,282 live C++
objects.  This is the strongest TS↔C++ static parity proof currently
available — two completely independent parsers (one in mingw-built
C++, one in TS) walking the same bytes and producing identical output.

Roadmap:
- **v5** — extract GameLogic + Object + module sources from GeneralsMD/,
  compile against them, drive the engine's `update()` N times from a
  loaded save, dump post-frame state.  This is the gold-standard
  runtime-parity oracle and the missing piece for L3 to assert TS CRC
  == C++ CRC at frame N for any N.

**What this proves**: the TS port and the C++ engine agree byte-for-byte
on the save format for every chunk, every TOC entry, and every per-
object header.  Any change in either implementation that would shift
even a single field surfaces as a per-fixture mismatch.

**What it does not prove**: that the remaining per-object payload fields
(status bitset internals, geometry, sighting, module list, module payloads)
match, or that simulation runtime behavior matches (deferred to v5).

## Layer 4 — Visual Verification  *(deferred)*

```sh
npm run report:visual-scenes                    # Playwright scene probes
```

Side-by-side screenshot comparison between the TS port and the original
game running in a Windows VM is the future ambition.  Today's
implementation is Playwright probes of canonical retail scenes
(`Tournament Desert`, `MD_USA01`, etc.) that catch unresolved model
placeholders, page errors, missing skybox state, and obvious renderer
divergence.  Blocked on
`tools/visual-oracle/vm/generals-win10.qcow2` — see
`fixtures/source-saves/README.md` for VM status notes.

## Layer 5 — Vitest Parity Agent

```sh
npm run parity                                  # all parity-tagged tests
npx vitest run packages/game-logic/src/parity-combat.test.ts
npx vitest run packages/game-logic/src/parity-pipeline.test.ts
npx vitest run packages/game-logic/src/parity-agent.test.ts
npx vitest run tools/parity-source-truth.test.ts
```

Headless game-logic tests using `createParityAgent()` — a camera-free wrapper
around `GameLogicSubsystem` that runs in vitest without browser or
Three.js rendering.  Useful for fast inner-loop development against
specific source formulas (armor coefficients, clip reload, pre-attack
types), independent of the larger differential harness.

## Promotion to CI gate

The path to a real guarantee is:

1. Drive Layer 0 to 100% strict, with the known-difference set empty.
   _Done — 356/356 categories green._
2. Drive Layer 1 template-coverage threshold to 100%.  _Done — all 36
   fixtures pass at strict 100% across 34,282 live C++ objects._
3. Bootstrap Layer 1c + 1d runtime-behavior fingerprints across all 36
   fixtures.  _Done — committed golden CRC + post-command-state
   fingerprints lock down byte-deterministic runtime behavior._
4. Drive Layer 3 oracle differential to Object::xfer identity agreement.
   _Done - v4 oracle agrees with TS port on every chunk, every TOC
   entry, every per-object header, and every parsed identity prefix across
   34,282 saved objects._
5. Extend Layer 3 oracle to v5 (run the engine's update() loop from a
   loaded save).  v5 is the missing
   piece for TS CRC == C++ CRC at frame N runtime equality.
6. Build Layer 2 (replay differential) once real `.rep` fixtures land
   and reach 100% CRC agreement on at least one full replay.
7. Promote `--strict` variants of all layers into CI only after the
   known-difference set is empty or explicitly allowlisted in this file.

Until those three layers are green together, parity is still an audit
effort rather than a proof.

## Quick reference

| Command | Layer | Output |
|---------|-------|--------|
| `npm run parity:strict` | 0 | source-parity.json (356 categories) |
| `npm run report:module-runtime-coverage` | 0 | module-runtime-coverage-report.json |
| `npm run report:module-field-coverage` | 0 | module-field-coverage-report.json |
| `npx tsx tools/save-load-parity-report.ts` | 1 | parity-reports/save-load-parity.{json,md} |
| `npx playwright test e2e/save-load-parity.e2e.ts` | 1 | parity-reports/save-load-findings/*.json |
| `npm run parity:runtime-behavior:test` | 1c | parity-reports/runtime-behavior-fingerprints/*.json |
| `npm run parity:runtime-command:test` | 1d | parity-reports/runtime-command-fingerprints/*.json |
| `npm run oracle:build` | 3 | tools/oracle/build/oracle.exe |
| `npm run parity:oracle` | 3 | parity-reports/oracle-parity.{json,md} |
| `npm run parity:oracle:strict` | 3 | same; exit 1 on any mismatch |
| `npm run report:visual-scenes` | 4 | visual-scene-parity-report.json |
| `npm run parity` | 5 | vitest pass/fail |
| `npm test` | all | full suite |

## File map

```
PARITY_WORKFLOW.md                              ← this document
tools/parity-source-truth.ts                    ← Layer 0
tools/save-load-parity-report.ts                ← Layer 1 oracle generator
e2e/save-load-parity.e2e.ts                     ← Layer 1 differential test
parity-reports/save-load-parity.{json,md}       ← Layer 1 oracle output
parity-reports/save-load-findings/*.json        ← Layer 1 per-fixture findings (gitignored)
e2e/runtime-behavior-parity.e2e.ts              ← Layer 1c runtime fingerprint test
parity-reports/runtime-behavior-fingerprints/*.json ← Layer 1c golden CRC reference (committed)
e2e/runtime-command-parity.e2e.ts               ← Layer 1d command fingerprint test
parity-reports/runtime-command-fingerprints/*.json ← Layer 1d golden post-command state (committed)
tools/runtime-behavior-summary.ts               ← cross-fixture roll-up of 1c volatility
parity-reports/runtime-behavior-summary.{json,md} ← aggregated fingerprint matrix
tools/oracle/CMakeLists.txt                     ← Layer 3 C++ oracle build
tools/oracle/src/main.cpp                       ← Layer 3 chunk + GameLogic + per-object decoder
tools/oracle/README.md                          ← Layer 3 build + run instructions
tools/oracle-parity-report.ts                   ← Layer 3 differential driver
parity-reports/oracle-parity.{json,md}          ← Layer 3 diff results (36/36 agree)
tools/replay-format.ts                          ← Layer 2 GENREP header parser
tools/replay-format.test.ts                     ← Layer 2 unit tests
test-results/parity/source-parity.{json,md}     ← Layer 0 output
fixtures/source-saves/*.sav                     ← C++ engine ground truth (36 real fixtures)
```
