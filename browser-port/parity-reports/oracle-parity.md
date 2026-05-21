# Oracle Parity Differential

Diffs the headless C++ oracle (`tools/oracle/build/oracle.exe`)
against the TS port's `listSaveGameChunks` for every real .sav
fixture under `fixtures/source-saves/`.  100% agreement proves
the TS save-chunk parser matches the original C++ byte format.

- generated: 2026-05-21T07:30:43.692Z
- fixtures: 36
- agreeing (TS == C++): 36
- diverging: 0
- total mismatches: 0

## Per-fixture results

| fixture | C++ chunks | TS chunks | agree | mismatches |
|---|---|---|---|---|
| zipeater_GN_000.sav | 17 | 17 | ✅ | 0 |
| zipeater_GN_001.sav | 17 | 17 | ✅ | 0 |
| zipeater_GN_008.sav | 17 | 17 | ✅ | 0 |
| zipeater_GN_015.sav | 17 | 17 | ✅ | 0 |
| zipeater_GN_022.sav | 17 | 17 | ✅ | 0 |
| zipeater_GN_023.sav | 17 | 17 | ✅ | 0 |
| zipeater_GN_030.sav | 17 | 17 | ✅ | 0 |
| zipeater_GN_037.sav | 17 | 17 | ✅ | 0 |
| zipeater_GN_044.sav | 17 | 17 | ✅ | 0 |
| zipeater_ZH_000.sav | 17 | 17 | ✅ | 0 |
| zipeater_ZH_005.sav | 17 | 17 | ✅ | 0 |
| zipeater_ZH_010.sav | 17 | 17 | ✅ | 0 |
| zipeater_ZH_015.sav | 17 | 17 | ✅ | 0 |
| zipeater_ZH_020.sav | 17 | 17 | ✅ | 0 |
| zipeater_ZH_025.sav | 17 | 17 | ✅ | 0 |
| zipeater_ZH_030.sav | 17 | 17 | ✅ | 0 |
| zipeater_ZH_037.sav | 17 | 17 | ✅ | 0 |
| zipeater_ZH_044.sav | 17 | 17 | ✅ | 0 |
| zipeater_ZH_051.sav | 17 | 17 | ✅ | 0 |
| zipeater_ZH_058.sav | 17 | 17 | ✅ | 0 |
| zipeater_ZH_065.sav | 17 | 17 | ✅ | 0 |
| zipeater_ZH_073.sav | 17 | 17 | ✅ | 0 |
| zipeater_ZH_080.sav | 17 | 17 | ✅ | 0 |
| zipeater_ZH_087.sav | 17 | 17 | ✅ | 0 |
| zipeater_ZH_095.sav | 17 | 17 | ✅ | 0 |
| zipeater_ZH_102.sav | 17 | 17 | ✅ | 0 |
| zipeater_ZH_109.sav | 17 | 17 | ✅ | 0 |
| zipeater_ZH_116.sav | 17 | 17 | ✅ | 0 |
| zipeater_ZH_123.sav | 17 | 17 | ✅ | 0 |
| zipeater_ZH_130.sav | 17 | 17 | ✅ | 0 |
| zipeater_ZH_138.sav | 17 | 17 | ✅ | 0 |
| zipeater_ZH_145.sav | 17 | 17 | ✅ | 0 |
| zipeater_ZH_152.sav | 17 | 17 | ✅ | 0 |
| zipeater_ZH_160.sav | 17 | 17 | ✅ | 0 |
| zipeater_ZH_161.sav | 17 | 17 | ✅ | 0 |
| zipeater_ZH_162.sav | 17 | 17 | ✅ | 0 |