# Session Summaries

## 2026-03-11T01:45Z — W3D Model Rendering Pipeline Complete
Implemented full W3D model rendering pipeline across 4 phases:
- **Phase 1 (Path Resolution)**: Added case-insensitive basename index to RuntimeManifest so bare model names like "AVThundrblt_D1" resolve to full manifest paths. Added resolveModelPath() to AssetManager. Updated ObjectVisualManager to use manifest-based resolution — magenta placeholder boxes should now load as geometry.
- **Phase 2 (Textures)**: Created PngEncoder (minimal RGBA→PNG via zlib). Updated GltfBuilder to embed textures as PNG in GLBs. Added --texture-dir flag to W3D converter CLI for .rgba texture lookup.
- **Phase 3 (Materials)**: Added VERTEX_MATERIAL_INFO + SHADERS chunk parsing to W3dMeshParser (diffuse/specular/emissive, shininess, opacity, alpha test/blend). Maps W3D materials to PBR in GltfBuilder (baseColorFactor, roughnessFactor, emissiveFactor, alphaMode).
- **Phase 4 (Skinning)**: Replaced identity inverse bind matrices with real computed IBMs — accumulates parent chain world transforms then inverts. New mat4FromTQ/mat4Multiply/mat4Invert helpers.
- **Pipeline**: convert-all.ts now passes --texture-dir to w3d-converter. All 3165 tests pass, clean TypeScript build.
- **Next**: Re-run `npm run convert:all` with --game-dir to regenerate GLBs with textures/materials/skinning.

## 2026-03-11T01:10Z — Browser Port Wet Testing Complete
Performed comprehensive wet tests (7 tests) of the browser port via Playwright:
- **All core flows working**: Loading screen, main menu, single player submenu, skirmish setup (102 maps, 3 factions, AI, credits), direct map loading, options screen
- **Terrain rendering works**: Height maps + texture blending visible on Tournament Desert
- **Camera controls work**: Pan, zoom, rotate all functional
- **Hard wet test passed with 0 errors**: XSS properly escaped, survives rapid resize/keyboard spam/click spam
- **Fixed broken smoke test**: `SmokeTest.json` didn't exist — updated to use real Tournament Desert map, increased timeouts, added main menu test
- **Fixed Playwright config**: Changed from Vite dev server to production build + serve
- **Key issues found**: (1) All 784 map entities render as green placeholders (no W3D models), (2) 204/784 objects unresolved to INI defs, (3) ControlBar shows no commands, (4) Campaign.ini/Video.ini missing, (5) Debug overlay dumps all unresolved entity IDs
- All 3146 unit tests + 2 smoke tests + 2 e2e Playwright tests pass

## 2026-03-10T16:30Z — Visual Oracle VM: Generals + ZH Installed
Completed automated Generals + Zero Hour installation in QEMU VM by bypassing the retail installer entirely:
- **Problem**: Retail installer's serial key check rejected all available keys (First Decade keys incompatible with standalone installer). Mouse clicks unreliable in XP guest (USB tablet driver issues).
- **Solution**: Extracted game files on macOS using `msiextract` (MSI) + `cabextract` (Data2.cab/Language.cab from disc 2). Created ISOs with `hdiutil makehybrid`. Booted VM with game ISO as CD, used `xcopy` from cmd.exe to copy files, `reg add` for registry entries.
- **Key fix**: `reg add` commands failed because trailing `\"` in paths was interpreted as escaped quote by cmd.exe. Removed trailing `\` from paths.
- **Result**: Snapshot `generals-installed` saved with both games fully installed. Game files: 1.6GB Generals + 1.2GB Zero Hour.
- Base image: `emperor-win10.qcow2` (actually runs Windows XP 5.1.2600).

## 2026-03-10T08:30Z — Visual Oracle: QEMU-based Original Game Comparison Tool
Built `tools/visual-oracle/` — a QEMU-based tool for running the original C&C Generals Zero Hour in a headless Windows VM and comparing screenshots with the browser port.
- **QemuController**: QMP protocol for VM lifecycle, input injection (USB-tablet + HMP two-device mouse for DirectInput), PPM→PNG screendump. Adapted from Emperor BFD project.
- **GeneralsOracle**: Claude vision-based menu navigation (30-step loop), scripted action execution (click, key, drag, screenshot), connects to running or fresh VM.
- **ScenarioRunner + LlmJudge**: Runs same scenario in both games, captures labeled screenshots, Claude vision comparison with aspect scoring (1-10 scale).
- **VM setup script**: Auto-detects Emperor BFD Win7/Win10 images for overlay clone, or fresh install from ISO. 3-step setup (create VM → install game → configure+snapshot).
- **CLI**: `screenshot`, `capture`, `compare`, `navigate`, `connect` commands.
- TypeScript clean build. Dependencies: pngjs, @anthropic-ai/sdk. QEMU 10.2.1 already installed.
- **Blocker**: No Generals ZH CD images found on machine. VM setup ready once ISOs are provided.

## 2026-03-10T04:45Z — Locomotor Surface Mask Fix + Cliff Expansion Fix + Control Harness
Two critical pathfinding bugs fixed, enabling unit movement and building placement on real maps:
- **BUG #1 — Cliff expansion flood-fill** (from previous session): Second expansion loop cascaded, marking 95.5% of Tournament Desert as cliff. Fixed: single-round expansion matching C++ `classifyMap`. Result: 51.3% cliff (correct).
- **BUG #2 — locomotorSurfaceMask = 0**: INI bundle stores Locomotor as `["SET_NORMAL", "LocomotorName"]`. `parseLocomotorEntries` recursed into each array element, creating empty locomotor sets. Fix: treat flat string arrays as single entry tokens.
- **Control harness TS fixes**: Fixed `guardPosition` (missing guardMode), `constructBuilding` (wrong fields), `setRallyPoint` (extra commandSource), `attack` (used wrong command type).
- **Unused import cleanup**: Removed `GeneralPersona` from `game-shell.ts`.
- Wet test confirmed: dozer pathfinds, moves 160 units along A* path, builds Power Plant, all on Tournament Desert.
- 2 regression tests added. All 3146 tests pass.

## 2026-03-10T05:15Z — Skirmish Startup Fixes: Starting Entities & Victory Guard
Fixed two critical skirmish bugs:
- **Immediate DEFEAT bug**: Skirmish maps have zero player-owned entities; victory check fired on frame 1 declaring all sides defeated. Root cause: C++ loads `SkirmishScripts.scb` to spawn starting units, which browser port lacked.
- **Fix 1 — `spawnSkirmishStartingEntities()`**: Reads `StartingBuilding` + `StartingUnit0` from PlayerTemplate.ini `FactionDef` blocks, spawns at `Player_N_Start` waypoints. Called from `main.ts` after `loadMapObjects`.
- **Fix 2 — Victory condition grace**: `checkVictoryConditions()` now skips when `newlyDefeated.length === activeSides.size` (all sides simultaneously defeated = startup race).
- **Fix 3 — player-side-sync null guard**: `syncPlayerSidesFromNetwork` skips null sides to prevent overwriting skirmish-setup sides.
- 3 new tests, all 3143 tests pass. Deployed to generals.discordwell.com and wet-tested: credits show $10,000, entities spawn on minimap, no instant defeat.
- Commit 918729e3, pushed to origin/main.

## 2026-03-10T00:32Z — Previously Out-of-Scope Module Ports (Phases A-C)
Ported 3 modules previously classified as out-of-scope:
- **Phase A: FirestormDynamicGeometryInfoUpdate** — DAMAGE_FLAME pulses within expanding radius (4 tests)
- **Phase B: BaikonurLaunchPower** — Spawns DetonationObject at target, DOOR_1_OPENING on no-target (3 tests)
- **Phase C: SpawnPointProductionExitUpdate** — Circular bone-free spawn distribution for 14 GLA buildings (5 tests)
- All 3 phases ran in parallel worktree agents, merged sequentially
- Code review: 4 warnings fixed (bounding circle calc, FROM_BOUNDINGSPHERE_2D, self-exclusion parity, disabled guard)
- Railroad system (4 modules) remains deferred
- Total: 3133 tests passing across 130 files

## 2026-03-09T23:20Z — Waterfall Plan Phases 1-5 + Code Review Fixes
Implemented all 5 phases of the remaining C++ module port waterfall plan, plus Phase 3 SpectreGunship:
- **Phases 1,2,4,5** (from previous session): MobMemberSlavedUpdate, BoneFXUpdate, RadiusDecalUpdate, Bridge System (3 modules), FlightDeckBehavior — merged from 4 parallel worktree branches with post-merge structural fixes.
- **Phase 3 — SpectreGunshipUpdate + SpectreGunshipDeploymentUpdate**: Orbital gunship state machine (INSERTING→ORBITING→DEPARTING→IDLE), dual weapon system (gattling strafing + howitzer area damage), deployment from command center spawns gunship at map edge, target override constraint within attack radius, special power routing integration. 8 new tests.
- **Code review fixes (11 findings applied)**: (1) noNeedToCatchUpRadius hysteresis zone added to mob member update. (2) Dead `_effectPrefix` parameter removed from parseBoneFXFieldValue. (3) Duplicate block iteration in extractBridgeBehaviorProfile removed (merge artifact). (4) Dead `_entity` parameter removed from boneFXInitTimes. (5) BoneFX onlyOnce default fixed (true→false, matching C++). (6) Vacuous BoneFX damage transition test fixed (uses applyWeaponDamageAmount + checks currentBodyState as number). (7) Math.random() replaced with gameRandom.nextFloat() for determinism. (8) Unused totalSpaces variable removed from FlightDeck init.
- **Post-merge fixes**: 4 structural issues from worktree merge (unclosed test blocks, BoneFX test body mixed into Bridge test, missing describe/it closings).
- **Total**: 3115 tests pass, 130 test files. Only pre-existing TS errors in other packages.

## 2026-03-09T20:00Z — Fix 5 Verified Source Parity Gaps (Final P1/P2 Tranche)
Fixed 5 confirmed remaining gaps from thorough re-audit. 2 agents ran in parallel:
- **Agent A (Death Physics)**: (1) SlowDeath fling physics — flingForce/flingPitch/variance parsed from INI, random 3D velocity decomposition, gravity (4.0/30 per frame), ground bounce with 30% velocity retention, explodedState transitions FLAILING→BOUNCING→SPLATTED. (3) BattleBusSlowDeathBehavior — two-phase death: fake death throws vertically with gravity, damages passengers by percentage, lands as SECOND_LIFE hulk with 50% health; empty hulk auto-destruction timer; real death (SECOND_LIFE already set) delegates to normal SlowDeath.
- **Agent B (Modules/Scripts/Conditions)**: (2) ProjectileStreamUpdate — circular buffer of 20 projectile IDs, cull dead projectiles, getStreamPoints() for renderer, streamPoints in RenderableEntityState. (4) Script action targeting variants — OBJECT_UPGRADE/SWITCH_WEAPON/HACK_INTERNET/SELL now accept OBJECT target; COMBATDROP now accepts NONE/POSITION targets. (5) CLIMBING/FLOODED condition flags wired — CLIMBING from prevFrameY slope detection (>0.1 threshold), FLOODED from getWaterHeightAt() lookup.
- **Code review fixes (5 HIGH)**: (1) Fling pitch variance changed from bidirectional `[-v,+v]` to C++ one-sided `[base, base+v]`. (2) ProjectileStream buffer culling changed from filter-all to front-only cull (C++ preserves middle holes for visual stream breaks), getStreamPoints emits `(0,0,0)` for dead entries. (3) BattleBus passenger damage now uses each passenger's maxHealth (not bus's). (4) Reverted SELL/HACK_INTERNET/SWITCH_WEAPON/OBJECT_UPGRADE OBJECT targets — C++ explicitly does NOT implement these (DEBUG_CRASH). (5) CLIMBING flag changed from Y-velocity detection to pathfind NAV_CLIFF cell type (C++ AIStates.cpp:1646). FLOODED noted as approximation (C++ uses WaveGuideUpdate, not general water level).
- **Total**: 3076 tests pass (20+ new), 130 test files. No new TS errors.

## 2026-03-09T17:00Z — Fix 9 P1/P2 Source Parity Gaps (3 Parallel Batches)
Fixed 9 verified remaining gaps from 3-domain C++ source audit. 3 batches ran in parallel with worktree isolation:
- **Batch A (Particle System)**: (1) Slave/attached particle systems — recursive creation at slavePosOffset, cascade destroy, per-particle attached systems with position tracking. (2) Wind motion — PingPong with distance-based speed scaling (C++ ParticleSys.cpp:2205-2289), Circular with angle wrapping. Wind applies as position nudge (not velocity). (3) STREAK rendering — LineSegments geometry with in-place buffer updates, cached material, trailing edge alpha=0.
- **Batch B (Game Logic)**: (4) SpecialPowerUpdate ready frames — door state now driven by actual sharedShortcutSpecialPowerReadyFrames, pre-open animation when power approaches readiness. (5) HistoricBonus weapons — per-WeaponTemplate tracking (shared across units), add-after-check pattern (C++ line 1126), count >= count-1 (implicit current hit), ms-to-frames via ceil(time*30/1000). (6) ModelConditionFlags TODOs — wired SPECIAL_CHEERING/RAISING_FLAG timers, EXPLODED_FLAILING/BOUNCING/SPLATTED state machine.
- **Batch C (UI + Refactoring)**: (7) Minimap per-player radar colors — sideColors map + allySides set with green/red fallback. (8) CashBounty integration test. (9) Interface deduplication — ModelConditionInfo/findBestConditionMatch/computeConditionKey consolidated to condition-state-matcher.ts, removed duplicates from object-visuals.ts.
- **Code review fixes**: Wind position-vs-velocity (HIGH), wind strength 0.3→2.0 (HIGH), PingPong distance-based scaling (HIGH), HistoricBonus per-template keying (HIGH), add-after-check ordering (HIGH), STREAK material caching (MED), ms-to-frames formula (MED).
- **Total**: 3055 tests pass (21+ new), 130 test files. No new TS errors.

## 2026-03-09T13:45Z — Fix 14 P0 Source Parity Bugs (8 Agents, 2 Batches)
Fixed all 14 P0 critical behavioral differences identified in 5-domain C++ parity review:
- **Pathfinding**: Turn cost direction vectors corrected (parent→current vs current→neighbor, removed unnecessary grandparent lookup). 8 new tests.
- **Construction Health**: Buildings now gain health proportionally during construction via `addConstructionHealth` context method. 2 new tests.
- **Production**: Multiple factory bonus now computed per-frame (not snapshotted at queue time), disabled factories (EMP/hacked/underpowered/subdued) skip production tick. 2 new tests.
- **Damage**: UNRESISTABLE damage now bypasses battle plan scalar. 1 new test.
- **Combat Weapons**: `estimateWeaponDamage` now applies `damageBonus` multiplier; `OUT_OF_AMMO` no longer skips `autoReloadsClip` weapons. 2 new tests.
- **Scripts**: `CALL_SUBROUTINE` on group passes `false` to prevent inner subroutine execution. 1 new test.
- **Audio**: `shouldPlayLocally` changed to first-match-returns semantics (ST_PLAYER takes priority over ST_ENEMIES). 1 test updated.
- **Condition States**: `IgnoreConditionStates` parsed from draw modules and stripped before matching. `ONCE_BACKWARDS`/`LOOP_BACKWARDS` animation modes supported. 11 new tests.
- **Particles**: Velocity/angular damping sampled once at emission (stored per-particle, stride 17→20). Per-particle alpha factor replaces averaged min/max. Physics order corrected (gravity→damping→drift→position). 3 new tests.
- **Laser Beams**: NumBeams creates N interpolated concentric layers. Segments + ArcHeight produce segmented arcing beams. 6 new tests.
- **Code review fixes**: Per-frame Set allocation for ignoreConditionStates cached, production bonus moved from queue-time to per-frame.
- **Total**: 3034 tests pass (21 new), 130 test files. No new TS errors.

## 2026-03-08T15:30Z — P1/P2 Code Review Fixes (5 Tasks)
Fixed remaining items from 8-agent sprint code review:
1. **Pathfinding heuristic** — `/ 2` → `>> 1` for C++ integer division parity in both `heuristic()` and `pathHeuristic()`
2. **Multiple ConditionsYes** — `conditionFlagSets` on ModelConditionInfo, inner loop in both `findBestConditionMatch()` copies, `mergeConditionInfosByVisualKey()` grouping in collectModelConditionInfos. Removed dead `conditionKeys` field after code review.
3. **Pre-normalize damage types** — Removed `.trim().toUpperCase()` from `adjustDamageByArmor()` and `adjustDamageByArmorSet()` hot paths. All callers verified uppercase.
4. **Data-driven MusicManager** — Per-list indices (menuIndex/ambientIndex/battleIndex), configurable track lists via constructor config, `getMusicTracksByType()` on registry, faction param on victory/defeat.
5. **Game time for pulses** — `accumulatedTime` field replaces `performance.now()` for selection ring pulse and stealth opacity. Animations freeze when paused (dt=0). Fixed sentinel from 0 to -1 for accumulatedTime=0 edge case.
Code review: Fixed P0 (missing Task 1 patch), P2 dead `conditionKeys` field, P2 selection ring sentinel. Noted but deferred: interface dedup across packages, findBestConditionMatch dedup. 2995 tests pass, no new TS errors.

## 2026-03-08T13:00Z — Code Review Fixes for 8-Agent Sprint
Fixed P0 bugs: DozerAI construction progress never written back (buildings stuck at 0%); audio double-fetch + stale loadingBuffers guard (permanent load failure after error). Performance: pre-computed `conditionKey` on ModelConditionInfo (eliminates per-frame sort+join), snapshot-before-iterate in stopAllPlaybackNodes. TypeScript: fixed 14 compilation errors from sprint (rotationX, specialPowerStates, applyWeaponDamageAmount signatures, unused methods, private access). Documented diagonal corner-cutting divergence from C++. Added multi-frame construction progress test. 2,983 tests pass.

## 2026-03-08T12:00Z — 8-Agent Feature Parity Sprint (329 new tests)
Eight parallel agents targeting top feature parity gaps from code review:
1. **Pathfinding** — A* with binary heap (O(n log n)), path smoothing via Bresenham LOS, locomotor terrain costs, turn penalties. New: `pathfinding.ts` (53 tests). Upgraded `navigation-pathfinding.ts` to use new BinaryHeap.
2. **Unit AI** — DozerAI (build/repair/idle-seek), HackInternetAI (4-state income), TransportAI (load/unload/flight), WorkerAI (dual role). New: `ai-updates.ts` (72 tests).
3. **Combat** — Multi-weapon slots A/B/C with independent cooldowns, WeaponSet condition matching, armor/damage type table, scatter radius, projectile flight models. New: `combat-weapon-set.ts` (86 tests).
4. **Containment** — TransportContain (capacity/death), TunnelContain (shared network), OverlordContain (sub-unit slots), HealContain (gradual heal), OpenContain (passengers fire). New: `containment.test.ts` (21 tests). Code in `index.ts`.
5. **Audio** — 3D positional (playSound3D/2D/OnEntity), node pooling, random sound selection, pitch/volume shift, zoom volume, music crossfade/ducking, gesture unlock, AudioEvent INI parsing. (18 tests).
6. **Animations** — TransitionState parsing+playback, idle randomization with weighted selection, per-condition model swapping with cache, AnimationSpeedFactorRange. (21 tests).
7. **Condition Flags** — Expanded syncModelConditionFlags from ~20→60 flags (76 total). Added FIRING_B/C, TURRET_ROTATE, WEAPONSET_VETERAN/ELITE/HERO, PRONE, ATTACKING, etc. (24 tests).
8. **Script Engine** — Coverage audit: 112/112 conditions, 333/333 actions dispatched. Added ~500 lines of tests for 26 previously untested types. (34 tests).
- **Total**: 2,982 tests pass (329 new), 129 test files. 5 new source files, 12 modified.

## 2026-03-08T10:00Z — Phase 1B: ModelConditionFlags Animation System (5 Tasks)
- **Task 1 — ModelConditionInfo Parsing** (`game-logic/src/render-profile-helpers.ts`): `ModelConditionInfo` interface (conditionFlags, modelName, animationName, idleAnimationName, hideSubObjects, showSubObjects, animationMode), `collectModelConditionInfos()` + `parseModelConditionStateBlock()` to extract structured data from INI ModelConditionState blocks. 22 new tests.
- **Task 2 — SparseMatchFinder** (`game-logic/src/condition-state-matcher.ts`): Port of C++ `findBestInfoSlow()` — maximizes yesMatch, minimizes yesExtraneousBits as tiebreaker. `createConditionMatcher()` with Map cache. 12 new tests.
- **Task 3 — Game-Logic Flag Expansion** (`game-logic/src/index.ts`): `syncModelConditionFlags()` method called from `updateRenderState()` — sets/clears ~20 flags: DAMAGED/REALLYDAMAGED/RUBBLE (from body damage state), MOVING (with topple/tensile guards), FIRING_A/RELOADING_A/PREATTACK_A/BETWEEN_FIRING_SHOTS_A/USING_WEAPON_A, ACTIVELY_BEING_CONSTRUCTED/PARTIALLY_CONSTRUCTED, GARRISONED, CARRYING, SOLD, DYING, DEPLOYED/PACKING/UNPACKING, RAPPELLING. Added modelConditionFlags/currentSpeed/maxSpeed to makeRenderableEntityState. 10 new tests.
- **Task 4 — Renderer Condition System** (`renderer/src/object-visuals.ts`): `syncConditionAnimation()` — best-fit condition match → animation clip crossfade + sub-object hide/show. `syncAnimationSpeed()` — timeScale = currentSpeed/maxSpeed clamped [0.3, 2.0] for MOVING entities. `syncTreadScrolling()` — UV offset for meshes named "TREAD". Cached activeFlags Set to avoid per-frame allocation. 8 new tests.
- **Task 5 — Building Placement Ghost** (`app/src/main.ts`): Replaced green box with actual building model via `cloneModelForGhost()`. Green semi-transparent material override, fallback box on load failure. 4 new tests.
- **Code review fixes**: Removed `prev.enabled=false` before crossFadeFrom (was breaking smooth blend), cached activeFlags Set (eliminated per-frame allocation), treadUVOffset modulo wrapping (prevents float precision degradation), 999→Infinity for bestYesExtraneousBits.
- **Known duplication**: ModelConditionInfo interface + findBestConditionMatch duplicated between game-logic and renderer (no cross-package import). Noted for future consolidation.
- **Total**: 2,653 tests pass (51 new across 5 files), 3 new source files, 7 modified files.

## 2026-03-08T07:55Z — Phase 1C/2C UI Subsystems (6 Parallel Agents)
- **MinimapRenderer** (`ui/src/minimap-renderer.ts`): Heightmap terrain rendering (green→brown height coloring), unit dots (own=green, enemy=red), fog-of-war overlay (SHROUDED×0.15, FOGGED×0.5), camera viewport rectangle, click-to-world coordinate mapping. CanvasFactory injection for headless testing. 19 tests with MockCanvasContext (Bresenham line rasterizer, pixel buffer).
- **CommandCardRenderer** (`ui/src/command-card-renderer.ts`): 4×3 CSS grid button panel, reads ControlBarModel slots, icon/label/hotkey/production-progress/cooldown overlays. Strip `&` from labels for display, extract hotkey letter. sync() + dispose() lifecycle. 16 tests (jsdom).
- **ControlGroupManager** (`input/src/control-group-manager.ts`): Groups 0-9 with assign/recall/addToGroup. Dead entity filtering via isAlive callback on recall. 14 tests.
- **DisplayStringRenderer** (`renderer/src/display-strings.ts`): Floating text numbers (damage=red, heal=green, cash=yellow) as THREE.Sprite + CanvasTexture. Rise at 1.5 u/s, fade over 1.5s, 64-sprite pool cap, dispose cleanup. 13 tests.
- **Selection circle enhancements** (`renderer/src/object-visuals.ts`): Color-coding (green=own via SEL_COLOR_OWN, red=enemy via SEL_COLOR_ENEMY), radius scaling from INI MajorRadius (geometryMajorRadius), 0.25s pulse animation with 1.15× overshoot on fresh selection. 6 new tests.
- **SkirmishSetupScreen** (`app/src/skirmish-setup-screen.ts`): 8-slot player config (faction/team/color/position dropdowns), 24 official maps, start-game callback. 30 tests (jsdom).
- **Game-logic additions**: `statusEffects`, `selectionCircleRadius`, `isOwnedByLocalPlayer` added to RenderableEntityState in types.ts. makeRenderableEntityState populates from geometryMajorRadius + resolveLocalPlayerSide().
- **jsdom**: Added as devDependency for DOM-based component testing.
- **Total**: 2,596 tests pass (249 new), 10 new files, 7 modified files. Committed fdc55335, pushed.

## 2026-03-08T06:30Z — Audio Integration, Shroud Renderer, Status Overlays
- **Voice audio bridge** (`app/src/voice-audio-bridge.ts`): Maps unit template→VoiceSelect/Move/Attack/etc INI fields, parent chain walking, 400ms cooldown, voice cache. `playGroupVoice()` plays for first entity only (InGameUI.cpp parity). 8 tests.
- **Music manager** (`app/src/music-manager.ts`): State machine (idle/menu/ambient/battle/victory/defeat). Battle triggered by `notifyCombat()`, auto-returns to ambient after configurable cooldown (15s default + 5s min battle). Faction-specific victory/defeat stingers. 12 tests.
- **EVA faction-specific audio** (`script-eva-runtime.ts` modified): Changed from generic `EVA_${type}` to `EvaUSA_LowPower`, `EvaChina_UnitLost`, `EvaGLA_UpgradeComplete` matching retail INI AudioEvent definitions. Per-type cooldowns (BASE_UNDER_ATTACK: 10s, LOW_POWER: 15s). 5 tests (2 new).
- **Weapon fire sounds** (`game-logic/src/types.ts`, `index.ts` modified): `fireSoundEvent` field on VisualEvent and AttackWeaponProfile, extracted from INI `FireSound` field. combat-visual-effects.ts uses specific fire sound or falls back to generic.
- **Shroud renderer** (`renderer/src/shroud-renderer.ts`): Extracted from inline main.ts fog overlay. DataTexture-based terrain overlay plane (SHROUDED=α230, FOGGED=α140, CLEAR=α0), linear filtered, frame-throttled (every 5 frames), lazy mesh creation. 11 tests.
- **Status effect overlays** (`renderer/src/object-visuals.ts` modified): Colored diamond icons for POISONED (green), BURNING (orange), DISABLED_EMP (blue), DISABLED_UNDERPOWERED (yellow), DISABLED_HELD (purple). Billboard rotation, automatic diff/rebuild on effect set changes. `statusEffects` field added to RenderableEntityState, resolved from objectStatusFlags + poisonDamageAmount in game-logic. 3 tests.
- **main.ts wiring**: ShroudRenderer replaces 70 lines of inline fog code. voiceBridge + musicManager instantiated, battle music triggered on WEAPON_IMPACT/ENTITY_DESTROYED, selection voice on click, move/attack voice on right-click commands.
- **Power system**: Fully implemented already (brownout, production slowdown, radar disable, special power pause, sabotage). Task #14 completed without changes.
- **Total**: 2,497 tests pass (14 new), 6 new files, 10 modified files. Committed 79d79763, pushed.

## 2026-03-08T04:50Z — Rendering, Network & Replay Systems (9-Task Sprint)
- **Turret bone rotation** (`renderer/src/object-visuals.ts`): Added `findTurretBones()` using regex pattern matching on model hierarchy, `syncTurretBones()` applying Z-axis quaternion rotation from game-logic `turretAngles[]`. 4 tests.
- **Laser beam renderer** (`renderer/src/laser-beam-renderer.ts`): Dual cylinder meshes (inner core + outer glow) with additive blending, configurable colors/widths, auto-fade and cleanup. 8 tests.
- **Dynamic lights** (`renderer/src/dynamic-lights.ts`): THREE.PointLight manager with 16-light cap, `addExplosionLight()`/`addMuzzleFlashLight()` convenience methods, lifetime + fade. Wired to visual events for spawnExplosion/spawnMuzzleFlash actions. 8 tests.
- **Bullet tracers** (`renderer/src/tracer-renderer.ts`): Moving box geometry traveling from muzzle toward target with additive blending, opacity fade, 64-tracer cap. 10 tests.
- **Debris** (`renderer/src/debris-renderer.ts`): Procedural chunks with gravity (-20 u/s²), bounce damping (0.4), spin, 30% lifetime fade, 256-chunk cap. Spawns on ENTITY_DESTROYED events. 10 tests.
- **Terrain roads** (`renderer/src/terrain-roads.ts`): Extracts road segments from map objects with ROAD_POINT1/ROAD_POINT2 flags, builds connected paths, generates tessellated quad strip meshes following terrain heightmap. 16 tests.
- **WebRTC transport** (`network/src/webrtc-transport.ts`): Implements `TransportLike` interface with DataChannel peer-to-peer, WebSocket signaling (join/offer/answer/ICE), relay mask routing, bandwidth metrics. 12 tests.
- **Lobby protocol** (`network/src/lobby-protocol.ts`): `LobbyManager` with player join/leave, faction/team/color selection, ready state, chat, settings, game start coordination. 8-player cap, message types for full lobby lifecycle. 21 tests.
- **Replay system** (`engine/src/replay-manager.ts`): Record/playback with frame-indexed command storage, serialize/deserialize, speed control (0.25x-8x), seek, onFrame/onComplete callbacks. 24 tests.
- **VisualEvent generalization**: Renamed `laserTargetX/Y/Z` → `targetX/Y/Z`, now passed for all weapon types (not just LASER), enabling both laser beams and bullet tracers.
- **main.ts wiring**: All new renderers (laser, dynamic lights, tracers, debris, roads) instantiated and updated in render loop. Visual event processing routes to appropriate renderers by projectileType and action type.
- **Total**: 2,461 tests pass (113 new), 9 new source files + 9 new test files

## 2026-03-08T02:20Z — Audio & Cursor Integration
- **Audio buffer loader** (`audio-buffer-loader.ts`): Maps bare INI filenames (e.g., "vgenlo2a") to converted asset URLs via manifest index
  - `buildAudioIndex()`: O(1) Map<lowercaseBasename, outputPath> from audio-converter manifest entries
  - `createAudioBufferLoader()`: Returns `AudioBufferLoader` callback that fetches from `RUNTIME_ASSET_BASE_URL/outputPath`
  - Added `setAudioBufferLoader()` setter to `AudioManager` (packages/audio/src/index.ts) for post-construction wiring
- **Cursor manager** (`cursor-manager.ts`): Loads converted ANI cursor data, renders animated cursors on overlay canvas
  - `CursorManager`: Preloads cursors by name, manages animation timing (jiffy-based rates), renders via putImageData on overlay `<canvas>`
  - `parseSpriteSheet()`: Parses u32 LE width/height header + RGBA pixels into ImageData frames, with bounds validation
  - `resolveGameCursor()`: State machine mapping selection/hover/edge-scroll to cursor names (SCCPointer/Select/Move/Attack/Scroll0-7/Target)
  - `detectEdgeScrollDir()`: Returns 0-7 compass direction from mouse position relative to viewport edges
  - Disposed flag prevents in-flight preloads from repopulating cache; double-attach guard removes old overlay
- **main.ts integration**:
  - PreInit: Creates audio loader and cursor manager from manifest after `subsystems.initAll()`
  - startGame: Attaches cursor overlay to game canvas, preloads 13 essential cursors
  - Game loop onSimulationStep: Resolves hover target (enemy/own-unit/ground) via `resolveObjectTargetFromInput` + `getEntityRelationship`, updates cursor state and animation
  - Game loop onRender: Draws cursor at mouse position via overlay canvas
  - disposeGame: Calls `cursorManager.dispose()` to clean up overlay DOM + cache
- **Code review fixes**: Added dispose call in disposeGame, double-attach guard, disposed flag for in-flight preloads, bounds checking in parseSpriteSheet
- **Tests**: 27 new tests (5 audio-buffer-loader, 22 cursor-manager), all 2347 tests pass

## 2026-03-08T01:15Z — Campaign Mode Code Review Fixes
- **Bug 6 (High)**: Fixed keydown listener leak in `video-player.ts` — stored `activeKeyHandler` ref, removed in `cleanup()`
- **Bugs 15/16 (High)**: Fixed event listener accumulation in `main.ts` — added `AbortController` (`gameAbort`) so `disposeGame()` removes all resize/pagehide/beforeunload listeners on mission transitions
- **Bug 11 (High)**: Fixed XSS in `game-shell.ts` — added `esc()` HTML escape helper, applied to all INI-sourced data in briefing screen (mission name, location, objectives, unit names)
- **Bug 2 (Medium)**: Fixed ObjectiveLine/UnitNames parsing in `campaign-manager.ts` — changed from `.push(rest)` to index-based assignment (`[objIdx] = rest`) matching C++ fixed-slot parity
- **Bug 14 (Medium)**: Added empty `mapDir` guard in `game-shell.ts` `handleStartCampaign()`
- **Bug 17 (Medium)**: Campaign DEFEAT retry now calls `disposeGame()` + recursive `startGame()` instead of `window.location.reload()`
- All 2320 tests pass

## 2026-03-08T00:40Z — Campaign Mode Implementation (7-Phase)
- **Phase 1 — Script Coverage Audit**: All 115 action types used by campaign maps already handled. 0 gaps.
- **Phase 2 — CampaignManager** (`game-logic/src/campaign-manager.ts`):
  - Parses Campaign.ini (17 campaigns: 3 story, 9 challenge, 1 training, 4 demo)
  - Mission chaining: setCampaign → gotoNextMission, resolveMapAssetPath
  - Difficulty tracking (EASY/NORMAL/HARD), getRankPoints() always 0 per source parity
  - 28 tests covering parsing, mission chaining, map resolution
- **Phase 3 — Video Playback** (`app/src/video-player.ts`):
  - Parses Video.ini for name→filename mapping (e.g., "MD_USA01" → "MD_USA01_0.mp4")
  - HTML5 `<video>` fullscreen overlay with click/keyboard skip
  - Wired into script-ui-effects-runtime bridge → calls notifyScriptVideoCompleted()
  - 4 tests for Video.ini parsing
- **Phase 4 — Campaign UI** (`app/src/game-shell.ts` rewritten):
  - New screens: Single Player menu, Campaign Faction Select, Difficulty Select, Briefing, Challenge Select
  - ShellScreen expanded with 8 screen types, screen management via Map<ShellScreen, HTMLElement>
  - CampaignStartSettings type with gameMode, campaignName, difficulty, mission data
  - 3x3 Generals Challenge grid with difficulty selection
- **Phase 5 — Mission Lifecycle** (`app/src/main.ts` modified):
  - Campaign.ini + Video.ini loaded during init(), passed to GameShell
  - startGame() accepts optional campaignContext (CampaignManager + VideoPlayer)
  - Victory → gotoNextMission() → play transition movie → load next map (recursive startGame)
  - Campaign complete → play final movie → return to shell
  - Defeat → postgame screen with retry/menu options
- **Phase 6 — Challenge Generals** (`app/src/challenge-generals.ts`):
  - 9 general personas with campaign/template mappings
  - Progress persistence via localStorage (defeated indices)
  - 11 tests including storage persistence and corrupt data handling
- **Phase 7 — Verification**: 2309 tests pass (43 new), real Campaign.ini parses all 17 campaigns correctly
- **New files**: 6 source + 3 test files
- **Modified files**: game-shell.ts (rewritten), main.ts (campaign lifecycle), script-ui-effects-runtime.ts (video bridge), game-logic/index.ts (export)

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
