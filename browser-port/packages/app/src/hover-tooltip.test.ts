import { describe, it, expect } from 'vitest';
import { formatTemplateName } from './hover-tooltip';

describe('formatTemplateName', () => {
  it('strips America prefix and inserts spaces', () => {
    expect(formatTemplateName('AmericaTankCrusader')).toBe('Tank Crusader');
  });

  it('strips China prefix and inserts spaces', () => {
    expect(formatTemplateName('ChinaTankBattlemaster')).toBe('Tank Battlemaster');
  });

  it('strips GLA prefix and inserts spaces', () => {
    expect(formatTemplateName('GLAScudLauncher')).toBe('Scud Launcher');
  });

  it('strips AmericaInfantry prefix', () => {
    expect(formatTemplateName('AmericaInfantryRanger')).toBe('Ranger');
  });

  it('strips ChinaVehicle prefix', () => {
    expect(formatTemplateName('ChinaVehicleOverlord')).toBe('Overlord');
  });

  it('strips GLAInfantry prefix', () => {
    expect(formatTemplateName('GLAInfantryRebel')).toBe('Rebel');
  });

  it('strips GLAVehicle prefix', () => {
    expect(formatTemplateName('GLAVehicleTechnical')).toBe('Technical');
  });

  it('handles names with no faction prefix', () => {
    expect(formatTemplateName('SupplyDropZone')).toBe('Supply Drop Zone');
  });

  it('falls back to space-insertion if prefix strip yields empty', () => {
    // Edge case: a template literally named "America"
    expect(formatTemplateName('America')).toBe('America');
  });

  it('handles single-word names', () => {
    expect(formatTemplateName('Crusader')).toBe('Crusader');
  });

  it('strips AmericaVehicle prefix', () => {
    expect(formatTemplateName('AmericaVehicleHumvee')).toBe('Humvee');
  });

  it('strips ChinaInfantry prefix', () => {
    expect(formatTemplateName('ChinaInfantryRedGuard')).toBe('Red Guard');
  });
});
