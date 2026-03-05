import type { VisualEvent } from '@generals/game-logic';

export type CombatVisualEffectAction =
  | { type: 'spawnExplosion'; radius: number }
  | { type: 'spawnMuzzleFlash' }
  | { type: 'spawnDestruction'; radius: number }
  | { type: 'spawnRubble'; radius: number }
  | { type: 'spawnSmokeColumn' }
  | { type: 'playAudio'; eventName: string };

function resolveImpactAudioEventName(radius: number): string {
  return radius > 5 ? 'CombatExplosionLarge' : 'CombatExplosionSmall';
}

export function planCombatVisualEffects(event: VisualEvent): CombatVisualEffectAction[] {
  switch (event.type) {
    case 'WEAPON_IMPACT': {
      if (event.projectileType === 'LASER') {
        return [{ type: 'spawnMuzzleFlash' }];
      }
      if (event.projectileType === 'BULLET') {
        return [
          { type: 'spawnMuzzleFlash' },
          { type: 'playAudio', eventName: 'CombatGunshot' },
        ];
      }
      return [
        { type: 'spawnExplosion', radius: event.radius },
        { type: 'playAudio', eventName: resolveImpactAudioEventName(event.radius) },
      ];
    }
    case 'WEAPON_FIRED': {
      const audioEventName = event.projectileType === 'MISSILE'
        ? 'CombatMissileLaunch'
        : event.projectileType === 'ARTILLERY'
          ? 'CombatArtilleryFire'
          : 'CombatGunshot';
      return [
        { type: 'spawnMuzzleFlash' },
        { type: 'playAudio', eventName: audioEventName },
      ];
    }
    case 'ENTITY_DESTROYED': {
      const actions: CombatVisualEffectAction[] = [
        { type: 'spawnDestruction', radius: event.radius },
        { type: 'playAudio', eventName: 'CombatEntityDestroyed' },
      ];
      if (event.radius >= 1.5) {
        actions.push({ type: 'spawnRubble', radius: event.radius });
        actions.push({ type: 'spawnSmokeColumn' });
      }
      return actions;
    }
    default:
      return [];
  }
}

