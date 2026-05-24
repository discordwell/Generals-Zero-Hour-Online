# Oracle Parity Differential

Diffs the headless C++ oracle (`tools/oracle/build/oracle.exe`)
against the TS port's `listSaveGameChunks` for every real .sav
fixture under `fixtures/source-saves/`.  100% agreement proves
the TS save-chunk parser matches the original C++ byte format.

- generated: 2026-05-24T11:00:30.846Z
- fixtures: 36
- agreeing (TS == C++): 36
- diverging: 0
- total mismatches: 0

## Per-fixture results

| fixture | C++/TS chunks | C++/TS frame | C++/TS objects | C++/TS TOC | agree |
|---|---|---|---|---|---|
| zipeater_GN_000.sav | 17/17 | 1372/1372 | 1916/1916 | 153/153 | ✅ |
| zipeater_GN_001.sav | 17/17 | 2156/2156 | 1836/1836 | 202/202 | ✅ |
| zipeater_GN_008.sav | 17/17 | 853/853 | 1947/1947 | 107/107 | ✅ |
| zipeater_GN_015.sav | 17/17 | 1918/1918 | 1901/1901 | 162/162 | ✅ |
| zipeater_GN_022.sav | 17/17 | 1300/1300 | 1941/1941 | 156/156 | ✅ |
| zipeater_GN_023.sav | 17/17 | 2055/2055 | 1831/1831 | 202/202 | ✅ |
| zipeater_GN_030.sav | 17/17 | 839/839 | 1947/1947 | 107/107 | ✅ |
| zipeater_GN_037.sav | 17/17 | 1920/1920 | 1891/1891 | 161/161 | ✅ |
| zipeater_GN_044.sav | 17/17 | 79282/79282 | 1664/1664 | 220/220 | ✅ |
| zipeater_ZH_000.sav | 17/17 | 2466/2466 | 915/915 | 188/188 | ✅ |
| zipeater_ZH_005.sav | 17/17 | 1304/1304 | 449/449 | 104/104 | ✅ |
| zipeater_ZH_010.sav | 17/17 | 1813/1813 | 483/483 | 149/149 | ✅ |
| zipeater_ZH_015.sav | 17/17 | 2504/2504 | 882/882 | 187/187 | ✅ |
| zipeater_ZH_020.sav | 17/17 | 1294/1294 | 449/449 | 104/104 | ✅ |
| zipeater_ZH_025.sav | 17/17 | 1788/1788 | 455/455 | 147/147 | ✅ |
| zipeater_ZH_030.sav | 17/17 | 1138/1138 | 312/312 | 89/89 | ✅ |
| zipeater_ZH_037.sav | 17/17 | 835/835 | 498/498 | 132/132 | ✅ |
| zipeater_ZH_044.sav | 17/17 | 371/371 | 495/495 | 93/93 | ✅ |
| zipeater_ZH_051.sav | 17/17 | 1124/1124 | 311/311 | 88/88 | ✅ |
| zipeater_ZH_058.sav | 17/17 | 493/493 | 495/495 | 93/93 | ✅ |
| zipeater_ZH_065.sav | 17/17 | 1046/1046 | 359/359 | 67/67 | ✅ |
| zipeater_ZH_073.sav | 17/17 | 1105/1105 | 1527/1527 | 187/187 | ✅ |
| zipeater_ZH_080.sav | 17/17 | 853/853 | 498/498 | 132/132 | ✅ |
| zipeater_ZH_087.sav | 17/17 | 1165/1165 | 312/312 | 89/89 | ✅ |
| zipeater_ZH_095.sav | 17/17 | 1116/1116 | 311/311 | 88/88 | ✅ |
| zipeater_ZH_102.sav | 17/17 | 762/762 | 470/470 | 131/131 | ✅ |
| zipeater_ZH_109.sav | 17/17 | 456/456 | 453/453 | 91/91 | ✅ |
| zipeater_ZH_116.sav | 17/17 | 1106/1106 | 311/311 | 88/88 | ✅ |
| zipeater_ZH_123.sav | 17/17 | 421/421 | 453/453 | 91/91 | ✅ |
| zipeater_ZH_130.sav | 17/17 | 1082/1082 | 290/290 | 63/63 | ✅ |
| zipeater_ZH_138.sav | 17/17 | 840/840 | 1490/1490 | 186/186 | ✅ |
| zipeater_ZH_145.sav | 17/17 | 791/791 | 470/470 | 131/131 | ✅ |
| zipeater_ZH_152.sav | 17/17 | 1108/1108 | 311/311 | 88/88 | ✅ |
| zipeater_ZH_160.sav | 17/17 | 440048/440048 | 2060/2060 | 253/253 | ✅ |
| zipeater_ZH_161.sav | 17/17 | 193178/193178 | 1285/1285 | 125/125 | ✅ |
| zipeater_ZH_162.sav | 17/17 | 316846/316846 | 1064/1064 | 123/123 | ✅ |