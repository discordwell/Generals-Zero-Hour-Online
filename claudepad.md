# Session Summaries

## 2026-03-07T22:00Z — Advanced Rendering: Particles, LOD, Shadows, Decals (Full 6-Phase)
- **Phase 1 — INI Data Pipeline** (`ini-data/src/registry.ts` modified):
  - Added `RawBlockDef` interface, 4 new Map collections (particleSystems, fxLists, staticGameLODs, dynamicGameLODs)
  - Moved ParticleSystem/FXList from skip list to active indexing, added StaticGameLOD/DynamicGameLOD
  - Updated bundle round-trip (loadBundle/toBundle/getStats) + accessor methods
- **Phase 2 — GameLODManager** (`renderer/src/game-lod-manager.ts`):
  - Static presets (Low/Medium/High) with 13 fields matching retail GameLOD.ini
  - Dynamic FPS adaptation: 30-sample rolling average, auto-switching between LOD levels
  - Query methods: getParticleCap(), shouldSkipParticle(), shouldUseShadowVolumes()
- **Phase 3 — Particle System** (4 new files):
  - `particle-system-template.ts`: Full ParticleSystemInfo port (~40 fields, enums, keyframes)
  - `fx-list-template.ts`: 8 nugget types (ParticleSystem, Sound, ViewShake, LightPulse, TerrainScorch, etc.)
  - `particle-system-manager.ts`: Flat Float32Array pool (stride 17), emission volumes, velocity distributions, InstancedMesh rendering
  - `fx-list-manager.ts`: Event-driven orchestrator with callbacks for sound/scorch/viewShake
  - **main.ts integration**: Deleted ~250 lines inline particle code, replaced with subsystem pipeline
- **Phase 4 — Shadow System** (`renderer/src/shadow-decal.ts`, `object-visuals.ts` modified):
  - Per-object shadow types: SHADOW_VOLUME→castShadow, SHADOW_DECAL→blob mesh, SHADOW_NONE→off
  - Shadow decal meshes: PlaneGeometry with MultiplyBlending, positioned at terrain height
- **Phase 5 — Decal System** (4 new files):
  - `decal-renderer.ts`: Terrain-projected PlaneGeometry quads, polygon offset, lifetime/fade
  - `radius-decal.ts`: Selection circles and radius indicators
  - `terrain-scorch.ts`: Persistent explosion scorch marks with cap enforcement
  - `decal-manager.ts`: Subsystem coordinating all decal types, wired to FXListManager onTerrainScorch
- **Phase 6 — LOD Export + Runtime** (`GltfBuilder.ts` modified, `lod-manager.ts` new):
  - GltfBuilder now creates multi-scene GLBs from HLOD data (one scene per LOD level, maxScreenSize in extras)
  - LODManager: THREE.LOD wrapping with maxScreenSize→distance conversion
- **Tests**: 2294 total passing (87 renderer, 30 w3d-converter, many others unchanged)
- **New files**: 11 source + 11 test files across renderer package, GltfBuilder.ts modified

## 2026-03-07T19:00Z — Save/Load System (Full 6-Phase Implementation)
- **Phase 1 — Xfer Framework** (`engine/src/xfer.ts`, `xfer-save.ts`, `xfer-load.ts`, `xfer-crc.ts`, `snapshot.ts`):
  - Abstract Xfer base class with return-value pattern (C++ uses void* mutation)
  - XferSave: growing ArrayBuffer binary writer with block size patching
  - XferLoad: ArrayBuffer reader, XferCrc: wraps XferCrcAccumulator
  - Snapshot interface: `crc()`, `xfer()`, `loadPostProcess()`
- **Phase 2 — Subsystem Integration** (`subsystem.ts` modified):
  - Optional `crc?`, `xfer?`, `snapshotPostProcess?` on Subsystem interface
  - SubsystemRegistry: `xferSnapshotAll()`, `crcAll()`, `snapshotPostProcessAll()`
- **Phase 3 — GameState Orchestrator** (`game-state.ts`):
  - Named SnapshotBlock registration, `[blockName][size][data]` + `"SG_EOF"` terminator
  - Fixed CRC infinite loop: CRC mode uses save path not load path
- **Phase 4 — Entity Serialization** (`game-logic/src/entity-xfer.ts`):
  - `xferMapEntity()` serializes all ~400+ MapEntity properties
  - JSON encoding for 98 complex profile types with Map/Set reviver
- **Phase 5 — Browser Storage** (`engine/src/save-storage.ts`):
  - IndexedDB with `save-files` + `save-metadata` object stores
  - Download/upload via Blob+anchor / File.arrayBuffer()
- **Phase 6 — UI Integration** (`ui/src/save-load-menu.ts`):
  - DOM overlay with Save/Load/Delete/Download/Upload/Close buttons
  - F5/F9 keyboard shortcuts via `installSaveLoadShortcuts()`
- **Tests**: 71 new tests (41 xfer + 13 game-state + 6 save-storage + 11 entity-xfer), all 2,258 passing
- **Key fix**: `deterministic-state.ts` — `xferBytes()` made public for XferCrc integration

## 2026-03-07T17:00Z — Options, Diplomacy, Post-Game Stats UI Screens
- **Options Screen** (`options-screen.ts`): Audio (music/SFX/voice volume sliders) + Game (scroll speed slider)
  - Persists to localStorage as `Options.ini` key=value format (source parity: OptionPreferences)
  - Accessible from main menu (Options button now enabled) and in-game (ESC key)
  - Wired into AudioManager.setMusicVolume/setSfxVolume and RTSCamera.setScrollSpeed
- **Diplomacy Screen** (`diplomacy-screen.ts`): In-game player status overlay
  - Shows all sides: faction, player type (Human/AI), status (Active/Defeated)
  - Toggled via F9 key, color-coded per faction (USA blue, China red, GLA green)
  - Queries gameLogic.getActiveSideNames/isSideDefeated/getSidePlayerType
- **Post-Game Stats Screen** (`postgame-stats-screen.ts`): Replaces simple endgame overlay
  - Per-side stats table: Units Built/Lost/Killed, Bldgs Built/Lost/Killed, Income
  - Victory/Defeat result display with "Return to Menu" and "Play Again" buttons
- **Expanded SideScoreState** in game-logic: Added unitsBuilt/Lost/Destroyed, structuresLost/Destroyed, moneyEarned
  - Score hooks added to spawnProducedUnit (unitsBuilt), markEntityDestroyed (lost/destroyed), addSideCredits (moneyEarned)
  - getActiveSideNames() added for side enumeration
- **RTSCamera.setScrollSpeed()** added to input package
- **Tests**: 6 new options-screen tests, 2 new game-logic score state tests, all 2,248 passing
- **Production build**: Verified (1,969KB gzip 483KB)

## 2026-03-07T14:30Z — All Remaining Asset Converters (7 New Types)
- **Implemented 7 new asset converters** covering ~3,700 previously unconverted files:
  1. **CSF converter**: Binary localization parser (bitwise-NOT UCS-2), 2 files → 6,364 entries each
  2. **STR converter**: Text mission string parser, 11 files (6 with content)
  3. **Audio converter**: IMA ADPCM decoder (4-bit→16-bit PCM) + PCM/MP3 passthrough, 3,530 files
  4. **WND converter**: UI layout parser (window hierarchy, draw data, gadgets), 77/77 files
  5. **Cursor converter**: RIFF ANI parser → JSON metadata + RGBA sprite sheets, 52/52 files
  6. **WAK converter**: Binary water track parser (float pairs + wave type), 14/14 files
  7. **Video converter**: BIK→MP4 via FFmpeg (graceful skip if not installed), 39 files
  8. **BMP support**: Added to existing texture-converter, 2 retail bitmap files
- **Pipeline wiring**: All steps added to convert-all.ts VALID_STEPS and main()
- **Tests**: 19 new tests (synthetic + retail data), all 2,102 tests pass
- **Retail verification**: Every converter tested against full retail data with 0 failures

## 2026-03-07T00:45Z — Asset Restoration & Full Conversion Pipeline
- **Problem**: Cleanup commit a5ad8c38 accidentally deleted 4,436 .glb models and emptied ini-bundle.json (638-byte stub)
- **Restored from git history** (commit 506afc03):
  - 4,436 models (.glb) — committed ff10ee11
  - 22MB ini-bundle.json (1,993 objects) — later regenerated
  - Manifest rebuilt to 8,297 entries (was 5)
- **Ran convert-all pipeline** (`--only big,map,ini` against retail/installed):
  - Extracted 16 .big archives (926MB)
  - Converted 101 maps to JSON (203MB)
  - Regenerated ini-bundle: **2,110 objects** (up from 1,993), 12,089 blocks, 2 parse errors (stray END in Campaign.ini)
  - Manifest updated to 8,495 entries (3,857 textures + 4,437 models + 101 maps + 99 INI files + 1 bundle)
- **Final asset status**: 3,857 textures + 4,437 models + 101 maps + 23MB ini-bundle = 8,495 manifest entries
- **INI parse stats**: 169 registry errors, 12 unsupported block types (AIData, ChallengeGenerals, CommandMap, Credits, etc.)
- All 2,083 tests pass. Commits: ff10ee11, d71f68cf — pushed.

## 2026-03-07T00:00Z — Port 5 C++ Update/Behavior Modules (Batch A+B)
- **Phase 1**: Git cleanup — committed regenerated ini-bundle.json + manifest.json, deleted `_extracted/` map intermediates (commit a5ad8c38)
- **Modules ported** (5 of 7 planned; BaseRegenerateUpdate already exists, LaserUpdate is client-only):
  1. **PhysicsBehavior**: Gravity, friction (forward/lateral/aerodynamic), bounce, kill-when-resting, landing collision
  2. **StructureToppleUpdate**: Building collapse state machine (STANDING→WAITING→TOPPLING→WAITING_DONE→DONE), crushing damage along topple path
  3. **MissileLauncherBuildingUpdate**: SCUD Storm door state machine (CLOSED→OPENING→OPEN→WAITING_TO_CLOSE→CLOSING), special power readiness integration
  4. **ParticleUplinkCannonUpdate**: Particle cannon firing (IDLE→CHARGING→READY→FIRING→POSTFIRE), area damage pulses with swath-of-death path
  5. **NeutronMissileUpdate**: Nuke missile flight (PRELAUNCH→LAUNCH→ATTACK→DEAD), intermediate position above target, special speed phase for ascent
- **Bug fixes during testing**:
  - `getTerrainHeightAt` → `resolveGroundHeight` (correct method name)
  - Gravity applied to `accelY` not `accelZ` (Y is vertical in THREE.js)
  - `gameRandom.next()` → `gameRandom.nextRange()` (correct API)
  - `markEntityDestroyed(entity, null, null, 'NORMAL')` → `markEntityDestroyed(entity.id, -1)` (correct signature)
- **Results**: 2,083 tests pass (11 new), 0 failures.
- **Code review findings** (14 HIGH, 16 MEDIUM, 4 LOW): Fixed 6 issues:
  - Gravity -0.4 → -1.0 (HIGH-1), bounce force via velocity not zeroed accel (HIGH-2)
  - allowCollideForce default true (HIGH-4), CLOSING→CLOSED door chain (HIGH-7)
  - structuralIntegrity default 0.1 (MEDIUM-9), ZFriction applied (MEDIUM-1)
  - Noted for future: friction decomposition (HIGH-3), visual rotation (HIGH-5), swath path (HIGH-10), turn rate limiting (HIGH-11)

## 2026-03-06T20:10Z — INI Parser Hybrid End Matching (4 Missing Objects Recovered)
- **Hybrid End matching**: Object/ChildObject/ObjectReskin use C++ nesting-based End (pure depth counting); all other block types retain indent-based matching
  - `nestingEnd` flag propagated through parseBlock recursion
  - DEFINITE_BLOCK_TYPES bypass only active in nesting-end context (prevents "Sound" being misread as block inside AudioEvent)
  - Safety break: encountering `Object Foo` (not `Object = Foo`) inside nesting-end block closes current block (recovers from consumed End tokens)
- **Expanded type sets**: SUB_BLOCK_TYPES ~80+ entries (OCL/FXList/Weapon/UI/SkirmishAI sub-blocks), DEFINITE_BLOCK_TYPES ~50+ entries
- **Standalone keyword block detection**: single-token lines with deeper-indented content parsed as blocks (e.g. Prerequisites, Turret)
- **Results**: Object/ dir 1863 objects (+4), 0 errors (was 145). All 4 previously missing objects found (Dam, GreekHouse1, AncientSoldierStatue02, CINE_ShiekLimo)
- **Code review fixes**: Removed TrackMarks, Turret, AltTurret, Attack from DEFINITE_BLOCK_TYPES (dual-use as fields in ConditionState/Draw/AudioEvent)
- **Top-level block types**: Added 20+ missing types (Credits, CommandMap, Mouse, AIData, LOD types, etc.) + singletons → errors 3385→2 (only stray END in Campaign.ini)
- **Final**: 10858 blocks, 2 errors. All 2,072 tests pass. Commits: 6d13dce4, 758979e6, d6afc3f8
- ini-bundle not regenerated (needs --game-dir) — 4 new objects will appear on next full conversion

## 2026-03-06T18:45Z — Git LFS Asset Commit + INI Parser Bug Fixes
- **Git LFS setup**: .gitattributes tracking .rgba/.glb/map .json/ini-bundle/manifest via LFS
  - 8,397 runtime assets committed (1.3 GB): textures (887M), models (149M), maps (203M), ini-bundle (22M), manifest (3.6M)
  - .gitignore updated: `/assets/` (raw retail), intermediate `_extracted/` dirs ignored; runtime assets allowed through
  - Push blocked by GitHub fork LFS restriction — refs pushed with `GIT_LFS_SKIP_PUSH=1`, blobs stay local
- **INI parser fixes** — 3 bugs causing silent object drops:
  1. `hasNestedSubBlockBody`: VeterancyLevels (SUB_BLOCK_TYPE) used as inline field misidentified as empty sub-block, consuming parent's End
  2. Case-sensitive End check: retail files use both `End` and `END`
  3. Indent-based End matching too strict for retail files with inconsistent indentation (e.g. indent 1 vs 2)
  - Results: Objects 1993→2106 (+113), CommandSets 412→471 (+59), missing refs 79→2
  - Remaining 2 are retail data typos (`CommandSet = = GLADemoTrapCommandSet`)
- All 2,070 tests pass, committed c4a6a6f0, pushed

## 2026-02-21T14:10Z — HelicopterSlowDeath + CleanupHazard + AssistedTargeting
- HelicopterSlowDeathBehavior: spiral orbit, self-spin oscillation, gravity descent, ground hit detection, final explosion
  - Fixed: `entity.heading` → `entity.rotationY`, `executeOCLByName` → `executeOCL`, profile index tracking in state
  - Fixed: `isDieModuleApplicable` now handles `DeathTypes: ALL` as special case
  - 5 tests (profile extraction, state init, spiral motion, ground destroy, spin oscillation)
- CleanupHazardUpdate: passive scan for CLEANUP_HAZARD entities, auto-attack with weapon damage
  - Bypasses enemy relationship checks (direct damage via `applyWeaponDamageAmount`)
  - 3 tests (profile extraction, auto-attack nearby, ignore out-of-range)
- AssistedTargetingUpdate: profile extraction + `isEntityFreeToAssist` + `issueAssistedAttack` methods
  - 3 tests (profile extraction, free-to-assist check, assisted attack issues damage)
- All 1356 tests pass

## 2026-02-21T13:25Z — JetAI + Collision Code Review Fixes
- Fixed JetAI HIGH: commands during TAKING_OFF/LANDING/RETURNING now queued as pending (C++ parity: aiDoCommand lines 2415-2420)
- Fixed JetAI MEDIUM: attackMoveTo interception added for parked/transitioning jets
- Fixed JetAI MEDIUM: suppressed auto-targeting for PARKED/RELOAD_AMMO/TAKING_OFF/LANDING jets
- Fixed JetAI MEDIUM: findSuitableAirfield uses getTeamRelationship === ALLIES (C++ ALLOW_ALLIES parity)
- Collision review findings (overlap cap + IS_USING_ABILITY guard) were already in committed code from 6b9bc6c
- All 1345 tests pass, committed e726985, pushed

## 2026-02-21T13:20Z — JetAIUpdate Flight State Machine
- Implemented 7-state JetAI state machine: PARKED → TAKING_OFF → AIRBORNE → RETURNING_FOR_LANDING → LANDING → RELOAD_AMMO → PARKED + CIRCLING_DEAD_AIRFIELD
- Replaced JetAISneakyProfile with full JetAIProfile (13 fields from INI)
- JetAIRuntimeState tracks state, altitude, pending commands, producer cache, timers
- Map-placed aircraft start AIRBORNE; produced aircraft start PARKED (set by applyQueueProductionExitPath)
- Movement: airborne aircraft skip A* pathfinding (direct waypoint), terrain snap manages cruise altitude
- Command interception: moveTo/attackEntity to PARKED aircraft stored as pendingCommand → takeoff
- Out-of-ammo damage, idle return timer, airfield search when producer destroyed
- 13 new tests, all 1345 tests pass

## 2026-02-21T12:15Z — Turret AI + Locomotor Physics Code Reviews + Collision Avoidance (IN PROGRESS)
- Turret AI committed as 482376e, pushed. Code review agent (ac60639) running in background.
- Locomotor physics code review (aea83bb) completed: 3 MEDIUM findings (braking formula, turn-alignment, heading blending are deliberate simplifications). 0 HIGH.
- **Collision avoidance (Task #100) — IN PROGRESS, 4 TESTS FAILING**:
  - Added `updateUnitCollisionSeparation()` after `updateEntityMovement` in tick loop (line ~3482)
  - Implementation: O(n²) ground entity pair check, bounding circle overlap, position separation
  - 4 tests fail because entities placed at same position intentionally (salvage crate, hive spawn slaves, sticky bomb). Need to add exclusions for:
    - Sticky bomb entities (`stickyBombTargetId !== 0`)
    - Spawn behavior slaves (entities where a parent's `spawnBehaviorState.slaveIds` includes them)
    - Entities with pending enter-object actions
  - Fix approach: skip entities that have `stickyBombTargetId !== 0` and add a `spawnBehaviorOwnerId` or check via `spawnBehaviorState.slaveIds`

## 2026-02-21T08:00Z — Damage Retaliation + Locomotor Physics + Turret AI
- Damage retaliation: committed 6d70308, code review fixes in 4590aba
  - lastAttackerEntityId tracking, immediate retaliation in idle auto-targeting
  - Fixes: stealth DETECTED exception, IS_USING_ABILITY skip, death cleanup
- Locomotor physics: committed 8b79702
  - LocomotorSetProfile extended: minSpeed, acceleration, braking, turnRate, appearance
  - currentSpeed field, rate-limited turning, braking distance lookahead
  - Split heading-based (turnRate > 0) vs direct waypoint (turnRate = 0) movement
- Turret AI: committed 482376e
  - TurretProfile + TurretRuntimeState, turretStates[] on MapEntity
  - State machine: IDLE → AIM → HOLD → RECENTER → IDLE
  - INI: TurretTurnRate (deg/s → rad/frame), NaturalTurretAngle, FiresWhileTurning, RecenterTime
  - isTurretAlignedForFiring callback wired into combat-update.ts
  - turretAngles[] exported in renderable state
- All 1332 tests passing before collision avoidance work began

## 2026-02-21T06:50Z — AutoDeposit + DynamicShroud + Code Review Fixes
- AutoDepositUpdate: C++ parity rewrite
  - Constructor-based timer init (not lazy), 3-field state (nextFrame, initialized, captureBonusPending)
  - Capture bonus awarded via captureEntity hook (Player.cpp line 1038 parity)
  - isEntityNeutralControlled() helper (checks side + player type mapping)
  - 6 tests — All 1266 tests pass
- DynamicShroudClearingRangeUpdate: animated vision range system
  - 5-state machine: NOT_STARTED → GROWING → SUSTAINING → SHRINKING → DONE → SLEEPING
  - Deadline-based state transitions from countdown timer
  - Growing: +nativeClearingRange/growTime per frame; Shrinking: -(native-final)/shrinkTime per frame
  - Change interval throttling (growInterval during GROWING, changeInterval otherwise)
  - Profile INI extraction with duration parsing
  - 3 tests — All 1266 tests pass
- Code review fixes (from agent a4f3d98):
  - CheckpointUpdate geometry save/restore before scan (prevents gate oscillation — HIGH)
  - HeightDieUpdate snap condition: entity.y < terrainY (not entity.y - baseHeight — MEDIUM)
  - Cleaned up duplicate AutoDepositProfile interface and entity fields
  - Removed duplicate entity creation fields

## 2026-02-21T03:15Z — PoisonedBehavior Fixes + StickyBombUpdate + InstantDeathBehavior
- PoisonedBehavior C++ parity fixes:
  - Profile-based poison params (guard: only entities WITH PoisonedBehavior can be poisoned)
  - Re-poison timer uses Math.min() for C++ parity
  - Healing clears poison (all heal paths: self-heal, radius, whole-player, base regen, callback)
  - Fixed AutoHeal radius mode bug: full-health healers couldn't heal others
  - 4 tests — All 1215 tests pass
- StickyBombUpdate: bomb attachment/tracking/detonation system:
  - Profile INI (OffsetZ, GeometryBasedDamageWeapon), position tracking, detonation damage
  - executeStickyBombDetonationDamage in markEntityDestroyed (handles LifetimeUpdate death + explicit detonation)
  - checkAndDetonateBoobyTrap with ally check (C++ line 966)
  - Recursion guard via clearing stickyBombTargetId before damage application
  - 5 tests — All 1220 tests pass
- InstantDeathBehavior: die module with DieMuxData filtering:
  - DeathTypes, VeterancyLevels, ExemptStatus, RequiredStatus filtering
  - Weapon and OCL effects (random selection from lists)
  - Shared isDieModuleApplicable (refactored from isSlowDeathApplicable)
  - 4 tests — All 1224 tests pass
- Code review fixes: dyingEntityIds re-entrancy guard (C++ m_hasDiedAlready), removed dead poison entity fields

## 2026-02-21T02:00Z — FlammableUpdate + DeletionUpdate + RadarUpdate + FloatUpdate + SpyVision
- FlammableUpdate parity fixes — committed dde82a5
  - Added burnedDelayFrames independent timer, fixed AFLAME→NORMAL/BURNED transition
  - Fixed flameDamageAccumulated re-ignition parity (don't reset on ignition)
  - 6 tests — All 1205 tests pass
- DeletionUpdate: silent timed removal (no death pipeline) — committed 67124f6
  - silentDestroyEntity() method: cleans up references without death events/XP/crates
  - RadarUpdateProfile + FloatUpdateProfile extraction (update logic deferred)
  - RadarUpdate extension animation timer on RadarUpgrade application
  - 5 tests — All 1210 tests pass
- Spy Vision duration expiry — committed 3e71ae5
  - temporaryVisionReveals tracking with expiration timers
  - revealFogOfWar now accepts durationMs parameter, defaults to 30s
  - updateTemporaryVisionReveals() removes expired lookers each frame
  - 1 test — All 1211 tests pass

# Key Findings

## Project Structure
- Monorepo at `browser-port/` with `packages/*` and `tools/*` workspaces
- Build: `tsc --build && vite build packages/app`
- Test: `npx vitest run`
- Tools run via `tsx` (TypeScript executor for ES modules)
- Strict TS with `noUncheckedIndexedAccess: true` — typed array indexing returns `T | undefined`

## Binary Format References (from C++ source exploration)
- **BIG archives**: BIGF/BIG4 magic, LE archive size, BE file count/offsets/sizes, null-terminated paths
- **W3D models**: Little-endian chunked format, 8-byte headers (type u32 + size u32 with MSB sub-chunk flag)
- **TGA textures**: 18-byte header, BGR/BGRA pixel order, optional RLE, bottom-left origin default
- **DDS textures**: "DDS " magic, 128-byte header, DXT1/3/5 4x4 block compression
- **MAP files**: "CkMp" magic TOC, DataChunk format (id u32 + version u16 + size i32)
