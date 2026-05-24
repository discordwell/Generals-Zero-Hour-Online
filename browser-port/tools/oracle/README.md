# Generals Headless Oracle

A standalone C++ binary that reads C&C Generals `.sav` save files in the
same byte format the original engine uses, and emits a JSON representation
of the parsed state.

The oracle is Layer 3 of the parity harness (see `PARITY_WORKFLOW.md` in
the repo root). It is an independent C++ implementation that reads the same
files as the TS port, so we can diff TS vs C++ output and surface byte-level
format divergences in either direction.

## Build

Prereqs (Windows): conda env with cmake + mingw-w64. The npm harness
auto-detects the `oracle` conda env and rebuilds only when
`tools/oracle/src/*` or `tools/oracle/CMakeLists.txt` is newer than the
binary.

```sh
npm run oracle:build
npm run oracle:rebuild
```

Set `ORACLE_CONDA_ENV=<name>` if the env is not named `oracle`. Set
`ORACLE_SKIP_BUILD=1` or pass `--no-build` to `tools/oracle-parity-report.ts`
when you explicitly want to use an existing binary without freshness checks.

Manual build command:

```sh
conda create -n oracle -c conda-forge cmake make m2w64-gcc m2w64-binutils -y
conda run -n oracle cmake -S tools/oracle -B tools/oracle/build -G "Unix Makefiles" \
  -DCMAKE_CXX_COMPILER=x86_64-w64-mingw32-g++ \
  -DCMAKE_MAKE_PROGRAM=make
conda run -n oracle cmake --build tools/oracle/build
```

Produces `tools/oracle/build/oracle.exe`.

## Run

```sh
conda run -n oracle .\tools\oracle\build\oracle.exe fixtures\source-saves\zipeater_GN_000.sav
npm run parity:oracle:strict
```

Sample output:

```json
{
  "fixture": "fixtures/source-saves/zipeater_GN_000.sav",
  "fileSize": 3884209,
  "chunkCount": 17,
  "chunks": [
    { "name": "CHUNK_GameState", "blockStartOffset": 0, "blockDataOffset": 20, "blockSize": 99 },
    { "name": "CHUNK_GameLogic", "blockStartOffset": 808186, "blockDataOffset": 808206, "blockSize": 2116208 }
  ]
}
```

## Architecture

```
v1 - chunk walker
  Reads .sav top-level CHUNK_<name> blocks and emits a JSON inventory.
  Validates the build chain and the AsciiString + int32 size-prefix
  framing used by XferLoad.cpp:201.

v2 - CHUNK_GameLogic decoder
  Parses the CHUNK_GameLogic payload: version, frameCounter, object TOC,
  per-object xfer blocks.

v3 - per-object header decoder
  Walks Object::xfer for every saved entity and dumps templateName, tocId,
  block offset, and block size.

v4 (current) - Object::xfer identity decoder
  Decodes version, objectId, transform skip, teamId, producerId, builderId,
  drawableId, and internalName for every saved object. The TS differential
  compares those fields against parseSourceGameLogicChunkState().

v5 - Frame advancer (oracle proper)
  Compile against the GeneralsMD GameLogic + Object code, drive
  GameLogic::update() N times, dump post-frame state. This is the gold-
  standard runtime-parity oracle and requires extracting the full engine
  from the Win32 / DirectX dependency tree - a multi-week project.
```

## Wire-In

The differential test that drives the oracle and diffs its output against
the TS port lives at `tools/oracle-parity-report.ts`. See the parent
`PARITY_WORKFLOW.md` for the full Layer 3 workflow.
