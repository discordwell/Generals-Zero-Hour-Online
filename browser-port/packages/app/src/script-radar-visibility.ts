export function resolveScriptRadarVisibility(
  scriptRadarHidden: boolean,
  scriptRadarForced: boolean,
): boolean {
  if (scriptRadarForced) {
    return true;
  }
  return !scriptRadarHidden;
}

export function resolveScriptRadarInteractionEnabled(
  radarVisible: boolean,
  scriptInputDisabled: boolean,
): boolean {
  if (!radarVisible) {
    return false;
  }
  return !scriptInputDisabled;
}

export function resolveScriptRadarEntityBlipVisibility(
  radarVisible: boolean,
  scriptDrawIconUiEnabled: boolean,
): boolean {
  if (!radarVisible) {
    return false;
  }
  return scriptDrawIconUiEnabled;
}
