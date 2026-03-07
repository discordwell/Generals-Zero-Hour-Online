# Architecture

Browser port of C&C Generals: Zero Hour — one-for-one port from the in-repo C++ source.

## Repository Layout

```
CnC_Generals_Zero_Hour/
├── Generals/Code/          # Original C++ source (read-only reference)
├── browser-port/
│   ├── packages/           # Runtime packages
│   │   ├── app/            # Entry point, game shell, UI dispatch
│   │   ├── core/           # Math, types, INI parser, engine abstractions
│   │   ├── engine/         # Game loop, deterministic frame state, networking
│   │   ├── game-logic/     # Simulation: combat, pathfinding, AI, production
│   │   ├── ini-data/       # INI data registry and type definitions
│   │   ├── assets/         # Asset loading, IndexedDB caching, manifest
│   │   ├── renderer/       # Three.js 3D rendering (models, terrain, water)
│   │   ├── audio/          # Web Audio API playback
│   │   ├── input/          # Keyboard/mouse, RTS camera
│   │   ├── terrain/        # Heightmap processing, mesh generation
│   │   ├── ui/             # Control bar, command buttons
│   │   └── network/        # Multiplayer sync, frame ACK/resend
│   └── tools/              # Build-time conversion utilities
│       ├── convert-all.ts  # Master pipeline orchestrator
│       ├── big-extractor/  # .big archive extraction
│       ├── texture-converter/ # .tga/.dds → .rgba
│       ├── w3d-converter/  # .w3d → .glb (Three.js)
│       ├── map-converter/  # .map → .json (heightmap + objects)
│       └── *.ts            # Parity/coverage reports
```

## Asset Conversion Pipeline

```
Retail .big archives
  → big-extractor → raw files
    → texture-converter → .rgba (width + height + RGBA bytes)
    → w3d-converter → .glb (glTF binary)
    → map-converter → .json (heightmap + object placement)
    → ini-parser → ini-bundle.json (all INI data indexed by type)

Output: packages/app/public/assets/
Manifest: conversion.manifest.json (SHA-256 hashes, version tracking)
```

Run: `npx tsx tools/convert-all.ts --game-dir <path>`

Runtime assets tracked via Git LFS (.rgba, .glb, map JSON, ini-bundle, manifest).

## Key Architectural Patterns

### Deterministic Simulation
- Frame-based execution with command replay
- `DeterministicFrameState` tracks commands per frame
- `GameRandom` with seeded RNG for reproducibility
- CRC consensus across players for multiplayer sync

### Subsystem Architecture
- All major systems implement `Subsystem` interface (init, update, dispose, reset)
- `SubsystemRegistry` manages initialization order
- Plugin-style extensibility

### Two-Phase Initialization
1. **preInit**: Load assets, renderer, audio, UI framework
2. **startGame**: Load map, initialize game logic, start game loop

### INI Parser (packages/core/src/ini/)
- Hybrid End matching: Object blocks use C++ nesting-based depth counting; other blocks use indent-based matching
- `SUB_BLOCK_TYPES` (80+) and `DEFINITE_BLOCK_TYPES` (50+) for sub-block detection
- `#include` resolution, `#define` macros, inheritance (`Object Foo : Bar`)
- Parses all retail INI files: 10700+ blocks, 2100+ Objects

### Game Logic (packages/game-logic/)
The largest package (~2.2MB). Maps directly to C++ source:
- Combat: damage, projectiles, targeting, turret AI
- Movement: A* pathfinding, locomotor physics, collision avoidance
- Economy: supply chain, production queues
- AI: skirmish personality, build orders, attack coordination
- Special powers, upgrades, fog of war, script engine

## Build & Test

```bash
cd browser-port
npm install
tsc --build              # Type check
npx vitest run           # Unit tests (2072 tests)
vite build packages/app  # Production build
npx playwright test      # E2E tests
```

Key dependencies: Three.js (rendering), Vite (build), Vitest (tests), Playwright (E2E).

## C++ Source Mapping

| C++ Module | Browser Port |
|---|---|
| GameEngine/Source/GameLogic/ | packages/game-logic/ |
| GameEngine/Source/GameClient/ | packages/renderer/, packages/audio/ |
| GameEngine/Source/Common/INI/ | packages/core/src/ini/ |
| GameEngineDevice/ | packages/input/, Web APIs |
| Tools/WorldBuilder/ | tools/map-converter/ |
