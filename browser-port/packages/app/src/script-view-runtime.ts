export interface ScriptViewRuntimeGameLogic {
  getScriptViewGuardbandBias(): { x: number; y: number } | null;
  getScriptTerrainOversizeAmount(): number;
  isScriptSkyboxEnabled(): boolean;
}

export interface ScriptViewRuntimeObjectVisualManager {
  setViewGuardBandBias(guardBandX: number, guardBandY: number): void;
}

export interface ScriptViewRuntimeTerrainVisual {
  setScriptTerrainOversizeAmount(amount: number): void;
}

export interface ScriptViewRuntimeSkybox {
  setEnabled(enabled: boolean): void;
}

export function syncScriptViewRuntimeBridge(
  gameLogic: ScriptViewRuntimeGameLogic,
  objectVisualManager: ScriptViewRuntimeObjectVisualManager,
  terrainVisual: ScriptViewRuntimeTerrainVisual,
  skybox: ScriptViewRuntimeSkybox,
): void {
  const scriptViewGuardBandBias = gameLogic.getScriptViewGuardbandBias();
  objectVisualManager.setViewGuardBandBias(
    scriptViewGuardBandBias?.x ?? 0,
    scriptViewGuardBandBias?.y ?? 0,
  );
  terrainVisual.setScriptTerrainOversizeAmount(gameLogic.getScriptTerrainOversizeAmount());
  skybox.setEnabled(gameLogic.isScriptSkyboxEnabled());
}
