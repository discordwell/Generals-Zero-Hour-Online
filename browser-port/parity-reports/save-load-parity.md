# Save-Load Parity Oracle

C++ engine ground-truth state extracted from `fixtures/source-saves/`.
Downstream differential tests load the same `.sav` files into the TS
port and assert TS == C++ for every field listed here.

- generated: 2026-05-20T20:57:40.381Z
- real saves: 36
- parsed cleanly: 36
- parse failures: 0
- total live C++ objects in oracle: 34,282
- distinct missions covered: 20
- distinct maps covered: 15

## Per-Save Oracle Data

| fixture | map | side | frame | objects | first object |
|---|---|---|---|---|---|
| zipeater_GN_000.sav | Training01.map | training | 1372 | 1916 | VerticalArrow (toc=1) |
| zipeater_GN_001.sav | CHI01.map | china | 2156 | 1836 | ChinaTankOverlord (toc=1) |
| zipeater_GN_008.sav | GLA01.map | gla | 853 | 1947 | TreeSpruceStump (toc=1) |
| zipeater_GN_015.sav | USA01.map | usa | 1918 | 1901 | AmericaVehicleChinook (toc=1) |
| zipeater_GN_022.sav | Training01.map | training | 1300 | 1941 | VerticalArrow (toc=1) |
| zipeater_GN_023.sav | CHI01.map | china | 2055 | 1831 | ChinaTankOverlord (toc=1) |
| zipeater_GN_030.sav | GLA01.map | gla | 839 | 1947 | TreeSpruceStump (toc=1) |
| zipeater_GN_037.sav | USA01.map | usa | 1920 | 1891 | AmericaVehicleChinook (toc=1) |
| zipeater_GN_044.sav | usa08.map | usa | 79282 | 1664 | AmericaCrateParachute (toc=1) |
| zipeater_ZH_000.sav | MD_USA01.map | usa | 2466 | 915 | BaikonurRocketPad_C (toc=1) |
| zipeater_ZH_005.sav | MD_GLA01.map | gla | 1304 | 449 | AmericaVehicleHumveeDeadHull (toc=1) |
| zipeater_ZH_010.sav | MD_CHI01.map | china | 1813 | 483 | GLAInfantryTunnelDefender (toc=1) |
| zipeater_ZH_015.sav | MD_USA01.map | usa | 2504 | 882 | BaikonurRocketPad_C (toc=1) |
| zipeater_ZH_020.sav | MD_GLA01.map | gla | 1294 | 449 | AmericaVehicleHumveeDeadHull (toc=1) |
| zipeater_ZH_025.sav | MD_CHI01.map | china | 1788 | 455 | GLAInfantryTunnelDefender (toc=1) |
| zipeater_ZH_030.sav | GC_AirGeneral.map | challenge_5 | 1138 | 312 | AirF_AmericaStrategyCenter (toc=1) |
| zipeater_ZH_037.sav | GC_ChemGeneral.map | challenge_0 | 835 | 498 | Chem_GLAInfantryStingerSoldier (toc=1) |
| zipeater_ZH_044.sav | GC_TankGeneral.map | challenge_3 | 371 | 495 | Tank_ChinaVehicleSupplyTruck (toc=1) |
| zipeater_ZH_051.sav | GC_AirGeneral.map | challenge_6 | 1124 | 311 | AirF_AmericaAirfield (toc=1) |
| zipeater_ZH_058.sav | GC_TankGeneral.map | challenge_1 | 493 | 495 | Tank_ChinaVehicleSupplyTruck (toc=1) |
| zipeater_ZH_065.sav | GC_SuperWeaponsGeneral.map | challenge_8 | 1046 | 359 | ParticleUplinkCannonTrailRemnant (toc=1) |
| zipeater_ZH_073.sav | GC_LaserGeneral.map | challenge_2 | 1105 | 1527 | Lazr_AmericaInfantryRanger (toc=1) |
| zipeater_ZH_080.sav | GC_ChemGeneral.map | challenge_4 | 853 | 498 | Chem_GLAInfantryStingerSoldier (toc=1) |
| zipeater_ZH_087.sav | GC_AirGeneral.map | challenge_7 | 1165 | 312 | AirF_AmericaStrategyCenter (toc=1) |
| zipeater_ZH_095.sav | GC_AirGeneral.map | challenge_5 | 1116 | 311 | AirF_AmericaAirfield (toc=1) |
| zipeater_ZH_102.sav | GC_ChemGeneral.map | challenge_0 | 762 | 470 | Chem_GLAInfantryTunnelDefender (toc=1) |
| zipeater_ZH_109.sav | GC_TankGeneral.map | challenge_3 | 456 | 453 | Tank_ChinaVehicleSupplyTruck (toc=1) |
| zipeater_ZH_116.sav | GC_AirGeneral.map | challenge_6 | 1106 | 311 | AirF_AmericaAirfield (toc=1) |
| zipeater_ZH_123.sav | GC_TankGeneral.map | challenge_1 | 421 | 453 | Tank_ChinaVehicleSupplyTruck (toc=1) |
| zipeater_ZH_130.sav | GC_SuperWeaponsGeneral.map | challenge_8 | 1082 | 290 | ParticleUplinkCannonTrailRemnant (toc=1) |
| zipeater_ZH_138.sav | GC_LaserGeneral.map | challenge_2 | 840 | 1490 | Lazr_AmericaTankAvenger (toc=1) |
| zipeater_ZH_145.sav | GC_ChemGeneral.map | challenge_4 | 791 | 470 | Chem_GLAInfantryTunnelDefender (toc=1) |
| zipeater_ZH_152.sav | GC_AirGeneral.map | challenge_7 | 1108 | 311 | AirF_AmericaAirfield (toc=1) |
| zipeater_ZH_160.sav | md_chi05.map | china | 440048 | 2060 | LargeParachute (toc=1) |
| zipeater_ZH_161.sav | gc_chinaboss.map | challenge_2 | 193178 | 1285 | NeutronBlastObject (toc=1) |
| zipeater_ZH_162.sav | gc_chinaboss.map | challenge_3 | 316846 | 1064 | AvengerTargetingLaserBeam (toc=1) |
