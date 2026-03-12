// @ts-nocheck — self is typed as any; real safety comes from the test suite.
/**
 * Script camera, audio, and media methods — extracted from GameLogicSubsystem.
 *
 * Source parity: ScriptEngine camera/audio/movie actions
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type GL = any;

import { DRAWABLE_FRAMES_PER_FLASH, LOGIC_FRAME_RATE } from './index.js';

// ---- Script camera/media implementations ----

export function setScriptCameraMovementFinished(self: GL, finished: boolean): void {
  self.scriptCameraMovementFinished = finished;
}

export function setScriptCameraTether(self: GL, entityId: number, immediate: boolean, play: number): boolean {
  const entity = self.spawnedEntities.get(entityId);
  if (!entity || entity.destroyed || !Number.isFinite(play)) {
    return false;
  }
  self.scriptCameraTetherState = {
    entityId,
    immediate,
    play,
  };
  return true;
}

export function clearScriptCameraTether(self: GL): void {
  self.scriptCameraTetherState = null;
}

export function getScriptCameraTetherState(self: GL): ScriptCameraTetherState | null {
  if (!self.scriptCameraTetherState) {
    return null;
  }
  return { ...self.scriptCameraTetherState };
}

export function setScriptCameraFollowNamed(self: GL, entityId: number, snapToUnit: boolean): boolean {
  const entity = self.spawnedEntities.get(entityId);
  if (!entity || entity.destroyed) {
    return false;
  }
  self.scriptCameraFollowState = {
    entityId,
    snapToUnit,
  };
  return true;
}

export function clearScriptCameraFollowNamed(self: GL): void {
  self.scriptCameraFollowState = null;
}

export function getScriptCameraFollowState(self: GL): ScriptCameraFollowState | null {
  if (!self.scriptCameraFollowState) {
    return null;
  }
  return { ...self.scriptCameraFollowState };
}

export function setScriptCameraSlaveMode(self: GL, thingTemplateName: string, boneName: string): boolean {
  const normalizedThingTemplateName = thingTemplateName.trim();
  const normalizedBoneName = boneName.trim();
  if (!normalizedThingTemplateName || !normalizedBoneName) {
    return false;
  }
  self.scriptCameraSlaveModeState = {
    thingTemplateName: normalizedThingTemplateName,
    boneName: normalizedBoneName,
  };
  return true;
}

export function clearScriptCameraSlaveMode(self: GL): void {
  self.scriptCameraSlaveModeState = null;
}

export function getScriptCameraSlaveModeState(self: GL): ScriptCameraSlaveModeState | null {
  if (!self.scriptCameraSlaveModeState) {
    return null;
  }
  return { ...self.scriptCameraSlaveModeState };
}

export function setScriptCameraDefaultView(self: GL, pitch: number, angle: number, maxHeight: number): boolean {
  if (!Number.isFinite(pitch) || !Number.isFinite(angle) || !Number.isFinite(maxHeight)) {
    return false;
  }
  self.scriptCameraDefaultViewState = {
    pitch,
    angle,
    maxHeight,
  };
  return true;
}

export function getScriptCameraDefaultViewState(self: GL): ScriptCameraDefaultViewState | null {
  if (!self.scriptCameraDefaultViewState) {
    return null;
  }
  return { ...self.scriptCameraDefaultViewState };
}

export function setScriptCameraLookTowardObject(self: GL, 
  entityId: number,
  durationSeconds: number,
  holdSeconds: number,
  easeInSeconds: number,
  easeOutSeconds: number,
): boolean {
  const entity = self.spawnedEntities.get(entityId);
  if (!entity || entity.destroyed) {
    return false;
  }
  if (
    !Number.isFinite(durationSeconds)
    || !Number.isFinite(holdSeconds)
    || !Number.isFinite(easeInSeconds)
    || !Number.isFinite(easeOutSeconds)
  ) {
    return false;
  }
  self.scriptCameraLookTowardObjectState = {
    entityId,
    durationMs: durationSeconds * 1000,
    holdMs: holdSeconds * 1000,
    easeInMs: easeInSeconds * 1000,
    easeOutMs: easeOutSeconds * 1000,
  };
  return true;
}

export function getScriptCameraLookTowardObjectState(self: GL): ScriptCameraLookTowardObjectState | null {
  if (!self.scriptCameraLookTowardObjectState) {
    return null;
  }
  return { ...self.scriptCameraLookTowardObjectState };
}

export function setScriptCameraLookTowardWaypoint(self: GL, 
  waypointName: string,
  durationSeconds: number,
  easeInSeconds: number,
  easeOutSeconds: number,
  reverseRotation: boolean,
): boolean {
  const waypoint = self.resolveScriptWaypointPosition(waypointName);
  if (!waypoint) {
    return false;
  }
  if (
    !Number.isFinite(durationSeconds)
    || !Number.isFinite(easeInSeconds)
    || !Number.isFinite(easeOutSeconds)
  ) {
    return false;
  }
  self.scriptCameraLookTowardWaypointState = {
    waypointName: waypointName.trim(),
    x: waypoint.x,
    z: waypoint.z,
    durationMs: durationSeconds * 1000,
    easeInMs: easeInSeconds * 1000,
    easeOutMs: easeOutSeconds * 1000,
    reverseRotation,
  };
  return true;
}

export function getScriptCameraLookTowardWaypointState(self: GL): ScriptCameraLookTowardWaypointState | null {
  if (!self.scriptCameraLookTowardWaypointState) {
    return null;
  }
  return { ...self.scriptCameraLookTowardWaypointState };
}

export function requestScriptMoveCameraTo(self: GL, 
  waypointName: string,
  durationSeconds: number,
  cameraStutterSeconds: number,
  easeInSeconds: number,
  easeOutSeconds: number,
): boolean {
  const waypoint = self.resolveScriptWaypointPosition(waypointName);
  if (!waypoint) {
    return false;
  }
  if (
    !Number.isFinite(durationSeconds)
    || !Number.isFinite(cameraStutterSeconds)
    || !Number.isFinite(easeInSeconds)
    || !Number.isFinite(easeOutSeconds)
  ) {
    return false;
  }
  self.queueScriptCameraActionRequest({
    requestType: 'MOVE_TO',
    waypointName: waypointName.trim(),
    lookAtWaypointName: null,
    x: waypoint.x,
    z: waypoint.z,
    lookAtX: null,
    lookAtZ: null,
    durationMs: durationSeconds * 1000,
    cameraStutterMs: cameraStutterSeconds * 1000,
    easeInMs: easeInSeconds * 1000,
    easeOutMs: easeOutSeconds * 1000,
    rotations: null,
    zoom: null,
    pitch: null,
  });
  return true;
}

export function requestScriptMoveCameraAlongWaypointPath(self: GL, 
  waypointName: string,
  durationSeconds: number,
  cameraStutterSeconds: number,
  easeInSeconds: number,
  easeOutSeconds: number,
): boolean {
  const waypoint = self.resolveScriptWaypointPosition(waypointName);
  if (!waypoint) {
    return false;
  }
  if (
    !Number.isFinite(durationSeconds)
    || !Number.isFinite(cameraStutterSeconds)
    || !Number.isFinite(easeInSeconds)
    || !Number.isFinite(easeOutSeconds)
  ) {
    return false;
  }
  self.queueScriptCameraActionRequest({
    requestType: 'MOVE_ALONG_WAYPOINT_PATH',
    waypointName: waypointName.trim(),
    lookAtWaypointName: null,
    x: waypoint.x,
    z: waypoint.z,
    lookAtX: null,
    lookAtZ: null,
    durationMs: durationSeconds * 1000,
    cameraStutterMs: cameraStutterSeconds * 1000,
    easeInMs: easeInSeconds * 1000,
    easeOutMs: easeOutSeconds * 1000,
    rotations: null,
    zoom: null,
    pitch: null,
  });
  return true;
}

export function requestScriptResetCamera(self: GL, 
  waypointName: string,
  durationSeconds: number,
  easeInSeconds: number,
  easeOutSeconds: number,
): boolean {
  const waypoint = self.resolveScriptWaypointPosition(waypointName);
  if (!waypoint) {
    return false;
  }
  if (
    !Number.isFinite(durationSeconds)
    || !Number.isFinite(easeInSeconds)
    || !Number.isFinite(easeOutSeconds)
  ) {
    return false;
  }
  self.queueScriptCameraActionRequest({
    requestType: 'RESET',
    waypointName: waypointName.trim(),
    lookAtWaypointName: null,
    x: waypoint.x,
    z: waypoint.z,
    lookAtX: null,
    lookAtZ: null,
    durationMs: durationSeconds * 1000,
    cameraStutterMs: 0,
    easeInMs: easeInSeconds * 1000,
    easeOutMs: easeOutSeconds * 1000,
    rotations: null,
    zoom: null,
    pitch: null,
  });
  return true;
}

export function requestScriptRotateCamera(self: GL, 
  rotations: number,
  durationSeconds: number,
  easeInSeconds: number,
  easeOutSeconds: number,
): boolean {
  if (
    !Number.isFinite(rotations)
    || !Number.isFinite(durationSeconds)
    || !Number.isFinite(easeInSeconds)
    || !Number.isFinite(easeOutSeconds)
  ) {
    return false;
  }
  self.queueScriptCameraActionRequest({
    requestType: 'ROTATE',
    waypointName: null,
    lookAtWaypointName: null,
    x: null,
    z: null,
    lookAtX: null,
    lookAtZ: null,
    durationMs: durationSeconds * 1000,
    cameraStutterMs: 0,
    easeInMs: easeInSeconds * 1000,
    easeOutMs: easeOutSeconds * 1000,
    rotations,
    zoom: null,
    pitch: null,
  });
  return true;
}

export function requestScriptSetupCamera(self: GL, 
  waypointName: string,
  zoom: number,
  pitch: number,
  lookAtWaypointName: string,
): boolean {
  const waypoint = self.resolveScriptWaypointPosition(waypointName);
  const lookAtWaypoint = self.resolveScriptWaypointPosition(lookAtWaypointName);
  if (!waypoint || !lookAtWaypoint) {
    return false;
  }
  if (!Number.isFinite(zoom) || !Number.isFinite(pitch)) {
    return false;
  }
  self.queueScriptCameraActionRequest({
    requestType: 'SETUP',
    waypointName: waypointName.trim(),
    lookAtWaypointName: lookAtWaypointName.trim(),
    x: waypoint.x,
    z: waypoint.z,
    lookAtX: lookAtWaypoint.x,
    lookAtZ: lookAtWaypoint.z,
    durationMs: 0,
    cameraStutterMs: 0,
    easeInMs: 0,
    easeOutMs: 0,
    rotations: null,
    zoom,
    pitch,
  });
  return true;
}

export function requestScriptZoomCamera(self: GL, 
  zoom: number,
  durationSeconds: number,
  easeInSeconds: number,
  easeOutSeconds: number,
): boolean {
  if (
    !Number.isFinite(zoom)
    || !Number.isFinite(durationSeconds)
    || !Number.isFinite(easeInSeconds)
    || !Number.isFinite(easeOutSeconds)
  ) {
    return false;
  }
  self.queueScriptCameraActionRequest({
    requestType: 'ZOOM',
    waypointName: null,
    lookAtWaypointName: null,
    x: null,
    z: null,
    lookAtX: null,
    lookAtZ: null,
    durationMs: durationSeconds * 1000,
    cameraStutterMs: 0,
    easeInMs: easeInSeconds * 1000,
    easeOutMs: easeOutSeconds * 1000,
    rotations: null,
    zoom,
    pitch: null,
  });
  return true;
}

export function requestScriptPitchCamera(self: GL, 
  pitch: number,
  durationSeconds: number,
  easeInSeconds: number,
  easeOutSeconds: number,
): boolean {
  if (
    !Number.isFinite(pitch)
    || !Number.isFinite(durationSeconds)
    || !Number.isFinite(easeInSeconds)
    || !Number.isFinite(easeOutSeconds)
  ) {
    return false;
  }
  self.queueScriptCameraActionRequest({
    requestType: 'PITCH',
    waypointName: null,
    lookAtWaypointName: null,
    x: null,
    z: null,
    lookAtX: null,
    lookAtZ: null,
    durationMs: durationSeconds * 1000,
    cameraStutterMs: 0,
    easeInMs: easeInSeconds * 1000,
    easeOutMs: easeOutSeconds * 1000,
    rotations: null,
    zoom: null,
    pitch,
  });
  return true;
}

export function drainScriptCameraActionRequests(self: GL): ScriptCameraActionRequestState[] {
  if (self.scriptCameraActionRequests.length === 0) {
    return [];
  }
  const requests = self.scriptCameraActionRequests.map((request) => ({ ...request }));
  self.scriptCameraActionRequests.length = 0;
  return requests;
}

export function requestScriptCameraModFreezeTime(self: GL): void {
  self.queueScriptCameraModifierRequest({
    requestType: 'FREEZE_TIME',
    waypointName: null,
    x: null,
    z: null,
    zoom: null,
    pitch: null,
    easeIn: null,
    easeOut: null,
    speedMultiplier: null,
    rollingAverageFrames: null,
  });
}

export function requestScriptCameraModFreezeAngle(self: GL): void {
  self.queueScriptCameraModifierRequest({
    requestType: 'FREEZE_ANGLE',
    waypointName: null,
    x: null,
    z: null,
    zoom: null,
    pitch: null,
    easeIn: null,
    easeOut: null,
    speedMultiplier: null,
    rollingAverageFrames: null,
  });
}

export function requestScriptCameraModFinalZoom(self: GL, zoom: number, easeIn: number, easeOut: number): boolean {
  if (!Number.isFinite(zoom) || !Number.isFinite(easeIn) || !Number.isFinite(easeOut)) {
    return false;
  }
  self.queueScriptCameraModifierRequest({
    requestType: 'FINAL_ZOOM',
    waypointName: null,
    x: null,
    z: null,
    zoom,
    pitch: null,
    easeIn,
    easeOut,
    speedMultiplier: null,
    rollingAverageFrames: null,
  });
  return true;
}

export function requestScriptCameraModFinalPitch(self: GL, pitch: number, easeIn: number, easeOut: number): boolean {
  if (!Number.isFinite(pitch) || !Number.isFinite(easeIn) || !Number.isFinite(easeOut)) {
    return false;
  }
  self.queueScriptCameraModifierRequest({
    requestType: 'FINAL_PITCH',
    waypointName: null,
    x: null,
    z: null,
    zoom: null,
    pitch,
    easeIn,
    easeOut,
    speedMultiplier: null,
    rollingAverageFrames: null,
  });
  return true;
}

export function requestScriptCameraModFinalSpeedMultiplier(self: GL, speedMultiplier: number): void {
  self.queueScriptCameraModifierRequest({
    requestType: 'FINAL_SPEED_MULTIPLIER',
    waypointName: null,
    x: null,
    z: null,
    zoom: null,
    pitch: null,
    easeIn: null,
    easeOut: null,
    speedMultiplier: Math.trunc(speedMultiplier),
    rollingAverageFrames: null,
  });
}

export function requestScriptCameraModRollingAverage(self: GL, rollingAverageFrames: number): void {
  self.queueScriptCameraModifierRequest({
    requestType: 'ROLLING_AVERAGE',
    waypointName: null,
    x: null,
    z: null,
    zoom: null,
    pitch: null,
    easeIn: null,
    easeOut: null,
    speedMultiplier: null,
    rollingAverageFrames: Math.max(1, Math.trunc(rollingAverageFrames)),
  });
}

export function requestScriptCameraModFinalLookToward(self: GL, waypointName: string): boolean {
  const waypoint = self.resolveScriptWaypointPosition(waypointName);
  if (!waypoint) {
    return false;
  }
  self.queueScriptCameraModifierRequest({
    requestType: 'FINAL_LOOK_TOWARD',
    waypointName: waypointName.trim(),
    x: waypoint.x,
    z: waypoint.z,
    zoom: null,
    pitch: null,
    easeIn: null,
    easeOut: null,
    speedMultiplier: null,
    rollingAverageFrames: null,
  });
  return true;
}

export function requestScriptCameraModLookToward(self: GL, waypointName: string): boolean {
  const waypoint = self.resolveScriptWaypointPosition(waypointName);
  if (!waypoint) {
    return false;
  }
  self.queueScriptCameraModifierRequest({
    requestType: 'LOOK_TOWARD',
    waypointName: waypointName.trim(),
    x: waypoint.x,
    z: waypoint.z,
    zoom: null,
    pitch: null,
    easeIn: null,
    easeOut: null,
    speedMultiplier: null,
    rollingAverageFrames: null,
  });
  return true;
}

export function requestScriptCameraModMoveToSelection(self: GL): boolean {
  let selectedCount = 0;
  let sumX = 0;
  let sumZ = 0;
  for (const selectedId of self.selectedEntityIds) {
    const entity = self.spawnedEntities.get(selectedId);
    if (!entity || entity.destroyed) {
      continue;
    }
    sumX += entity.x;
    sumZ += entity.z;
    selectedCount += 1;
  }

  if (selectedCount === 0) {
    // Source parity: no-op when there is no current selection.
    return true;
  }

  self.queueScriptCameraModifierRequest({
    requestType: 'MOVE_TO_SELECTION',
    waypointName: null,
    x: sumX / selectedCount,
    z: sumZ / selectedCount,
    zoom: null,
    pitch: null,
    easeIn: null,
    easeOut: null,
    speedMultiplier: null,
    rollingAverageFrames: null,
  });
  return true;
}

export function drainScriptCameraModifierRequests(self: GL): ScriptCameraModifierRequestState[] {
  if (self.scriptCameraModifierRequests.length === 0) {
    return [];
  }
  const requests = self.scriptCameraModifierRequests.map((request) => ({ ...request }));
  self.scriptCameraModifierRequests.length = 0;
  return requests;
}

export function requestScriptCameraBlackWhiteMode(self: GL, enabled: boolean, fadeFrames: number): void {
  const normalizedFadeFrames = Number.isFinite(fadeFrames) ? Math.trunc(fadeFrames) : 0;

  // Source parity: ending BW mode is ignored if the BW filter isn't active.
  if (!enabled && !self.scriptCameraBlackWhiteEnabled) {
    return;
  }

  self.scriptCameraBlackWhiteEnabled = enabled;
  self.scriptCameraBlackWhiteRequests.push({
    enabled,
    fadeFrames: normalizedFadeFrames,
    frame: self.frameCounter,
  });
}

export function drainScriptCameraBlackWhiteRequests(self: GL): ScriptCameraBlackWhiteRequestState[] {
  if (self.scriptCameraBlackWhiteRequests.length === 0) {
    return [];
  }
  const requests = self.scriptCameraBlackWhiteRequests.map((request) => ({ ...request }));
  self.scriptCameraBlackWhiteRequests.length = 0;
  return requests;
}

export function requestScriptCameraFade(self: GL, 
  fadeType: ScriptCameraFadeRequestState['fadeType'],
  minFade: number,
  maxFade: number,
  increaseFrames: number,
  holdFrames: number,
  decreaseFrames: number,
): void {
  if (!Number.isFinite(minFade) || !Number.isFinite(maxFade)) {
    return;
  }
  self.scriptCameraFadeRequests.push({
    fadeType,
    minFade,
    maxFade,
    increaseFrames: Math.trunc(increaseFrames),
    holdFrames: Math.trunc(holdFrames),
    decreaseFrames: Math.trunc(decreaseFrames),
    frame: self.frameCounter,
  });
}

export function drainScriptCameraFadeRequests(self: GL): ScriptCameraFadeRequestState[] {
  if (self.scriptCameraFadeRequests.length === 0) {
    return [];
  }
  const requests = self.scriptCameraFadeRequests.map((request) => ({ ...request }));
  self.scriptCameraFadeRequests.length = 0;
  return requests;
}

export function requestScriptCameraMotionBlur(self: GL, zoomIn: boolean, saturate: boolean): void {
  self.queueScriptCameraFilterRequest({
    requestType: 'MOTION_BLUR',
    zoomIn,
    saturate,
    waypointName: null,
    x: null,
    z: null,
    followMode: null,
  });
}

export function requestScriptCameraMotionBlurJump(self: GL, waypointName: string, saturate: boolean): boolean {
  const waypoint = self.resolveScriptWaypointPosition(waypointName);
  if (!waypoint) {
    return false;
  }
  self.queueScriptCameraFilterRequest({
    requestType: 'MOTION_BLUR_JUMP',
    zoomIn: null,
    saturate,
    waypointName: waypointName.trim(),
    x: waypoint.x,
    z: waypoint.z,
    followMode: null,
  });
  return true;
}

export function requestScriptCameraMotionBlurFollow(self: GL, followMode: number): void {
  self.queueScriptCameraFilterRequest({
    requestType: 'MOTION_BLUR_FOLLOW',
    zoomIn: null,
    saturate: null,
    waypointName: null,
    x: null,
    z: null,
    followMode: Math.trunc(followMode),
  });
}

export function requestScriptCameraMotionBlurEndFollow(self: GL): void {
  self.queueScriptCameraFilterRequest({
    requestType: 'MOTION_BLUR_END_FOLLOW',
    zoomIn: null,
    saturate: null,
    waypointName: null,
    x: null,
    z: null,
    followMode: null,
  });
}

export function drainScriptCameraFilterRequests(self: GL): ScriptCameraFilterRequestState[] {
  if (self.scriptCameraFilterRequests.length === 0) {
    return [];
  }
  const requests = self.scriptCameraFilterRequests.map((request) => ({ ...request }));
  self.scriptCameraFilterRequests.length = 0;
  return requests;
}

export function requestScriptCameraAddShaker(self: GL, 
  waypointName: string,
  amplitude: number,
  durationSeconds: number,
  radius: number,
): boolean {
  const waypoint = self.resolveScriptWaypointPosition(waypointName);
  if (!waypoint) {
    return false;
  }
  if (
    !Number.isFinite(amplitude)
    || !Number.isFinite(durationSeconds)
    || !Number.isFinite(radius)
  ) {
    return false;
  }
  self.scriptCameraShakerRequests.push({
    waypointName: waypointName.trim(),
    x: waypoint.x,
    z: waypoint.z,
    amplitude,
    durationSeconds,
    radius,
    frame: self.frameCounter,
  });
  return true;
}

export function drainScriptCameraShakerRequests(self: GL): ScriptCameraShakerRequestState[] {
  if (self.scriptCameraShakerRequests.length === 0) {
    return [];
  }
  const requests = self.scriptCameraShakerRequests.map((request) => ({ ...request }));
  self.scriptCameraShakerRequests.length = 0;
  return requests;
}

export function setScriptScreenShake(self: GL, intensity: number): boolean {
  if (!Number.isFinite(intensity)) {
    return false;
  }
  self.scriptScreenShakeState = {
    intensity: Math.trunc(intensity),
    frame: self.frameCounter,
  };
  return true;
}

export function getScriptScreenShakeState(self: GL): ScriptScreenShakeState | null {
  if (!self.scriptScreenShakeState) {
    return null;
  }
  return { ...self.scriptScreenShakeState };
}

export function requestScriptMoviePlayback(self: GL, movieName: string, playbackType: 'FULLSCREEN' | 'RADAR'): boolean {
  const normalizedMovieName = movieName.trim();
  if (!normalizedMovieName) {
    return false;
  }
  self.clearScriptCompletedName(self.scriptCompletedVideos, normalizedMovieName);
  self.scriptMoviePlaybackRequests.push({
    movieName: normalizedMovieName,
    playbackType,
    frame: self.frameCounter,
  });
  return true;
}

export function drainScriptMoviePlaybackRequests(self: GL): ScriptMoviePlaybackRequestState[] {
  if (self.scriptMoviePlaybackRequests.length === 0) {
    return [];
  }
  const requests = self.scriptMoviePlaybackRequests.map((request) => ({ ...request }));
  self.scriptMoviePlaybackRequests.length = 0;
  return requests;
}

export function requestScriptCameoFlash(self: GL, commandButtonName: string, timeInSeconds: number): boolean {
  const normalizedButtonName = commandButtonName.trim();
  if (!normalizedButtonName || !Number.isFinite(timeInSeconds)) {
    return false;
  }
  const frames = Math.max(0, Math.trunc(LOGIC_FRAME_RATE * timeInSeconds));
  let flashCount = Math.max(0, Math.trunc(frames / DRAWABLE_FRAMES_PER_FLASH));
  // Source parity: make flash count even so the cameo returns to its original state.
  if ((flashCount & 1) === 1) {
    flashCount += 1;
  }
  self.scriptCameoFlashRequests.push({
    commandButtonName: normalizedButtonName,
    flashCount,
    frame: self.frameCounter,
  });
  return true;
}

export function requestScriptPlaySoundEffect(self: GL, audioName: string): boolean {
  return self.queueScriptAudioPlaybackRequest({
    audioName,
    playbackType: 'SOUND_EFFECT',
    allowOverlap: true,
    sourceEntityId: null,
    x: null,
    y: null,
    z: null,
  });
}

export function requestScriptPlaySoundEffectAt(self: GL, audioName: string, waypointName: string): boolean {
  const waypoint = self.resolveScriptWaypointPosition(waypointName);
  if (!waypoint) {
    return false;
  }
  return self.queueScriptAudioPlaybackRequest({
    audioName,
    playbackType: 'SOUND_EFFECT',
    allowOverlap: true,
    sourceEntityId: null,
    x: waypoint.x,
    y: self.resolveGroundHeight(waypoint.x, waypoint.z),
    z: waypoint.z,
  });
}

export function requestScriptSpeechPlay(self: GL, speechName: string, allowOverlap: boolean): boolean {
  return self.queueScriptAudioPlaybackRequest({
    audioName: speechName,
    playbackType: 'SPEECH',
    allowOverlap,
    sourceEntityId: null,
    x: null,
    y: null,
    z: null,
  });
}

export function drainScriptAudioPlaybackRequests(self: GL): ScriptAudioPlaybackRequestState[] {
  if (self.scriptAudioPlaybackRequests.length === 0) {
    return [];
  }
  const requests = self.scriptAudioPlaybackRequests.map((request) => ({ ...request }));
  self.scriptAudioPlaybackRequests.length = 0;
  return requests;
}

export function setScriptAmbientSoundsPaused(self: GL, paused: boolean): void {
  self.scriptAmbientSoundsPaused = paused;
}

export function setScriptCameraAudibleDistance(self: GL, audibleDistance: number): void {
  if (!Number.isFinite(audibleDistance)) {
    return;
  }
  self.scriptCameraAudibleDistance = audibleDistance;
}

export function getScriptCameraAudibleDistance(self: GL): number {
  return self.scriptCameraAudibleDistance;
}

export function requestScriptAudioRemoveAllDisabled(self: GL): void {
  self.scriptAudioRemovalRequests.push({
    eventName: null,
    removeDisabledOnly: true,
    frame: self.frameCounter,
  });
}

export function requestScriptAudioRemoveType(self: GL, eventName: string): boolean {
  const normalizedName = self.normalizeScriptAudioEventName(eventName);
  if (!normalizedName) {
    return false;
  }
  self.scriptAudioRemovalRequests.push({
    eventName: normalizedName,
    removeDisabledOnly: false,
    frame: self.frameCounter,
  });
  return true;
}

export function drainScriptAudioRemovalRequests(self: GL): ScriptAudioRemovalRequestState[] {
  if (self.scriptAudioRemovalRequests.length === 0) {
    return [];
  }
  const requests = self.scriptAudioRemovalRequests.map((request) => ({ ...request }));
  self.scriptAudioRemovalRequests.length = 0;
  return requests;
}

export function setScriptSoundVolumeScale(self: GL, newVolumePercent: number): void {
  self.scriptSoundVolumeScale = self.clampScriptVolumeScale(newVolumePercent);
}

export function setScriptSpeechVolumeScale(self: GL, newVolumePercent: number): void {
  self.scriptSpeechVolumeScale = self.clampScriptVolumeScale(newVolumePercent);
}

export function setScriptMusicVolumeScale(self: GL, newVolumePercent: number): void {
  self.scriptMusicVolumeScale = self.clampScriptVolumeScale(newVolumePercent);
}
