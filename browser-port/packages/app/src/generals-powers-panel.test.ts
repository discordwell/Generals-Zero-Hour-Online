// @vitest-environment jsdom
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { GeneralsPowersPanel, type GeneralsPowerInfo } from './generals-powers-panel.js';

function makePower(
  name: string,
  displayName: string,
  cost: number,
  status: GeneralsPowerInfo['status'],
  prerequisites: string[] = [],
): GeneralsPowerInfo {
  return { name, displayName, cost, status, prerequisites };
}

describe('GeneralsPowersPanel', () => {
  let root: HTMLDivElement;
  let purchaseLog: Array<{ scienceName: string; cost: number }>;
  let closeCount: number;
  let powers: GeneralsPowerInfo[];
  let rankLevel: number;
  let purchasePoints: number;
  let panel: GeneralsPowersPanel;

  beforeEach(() => {
    root = document.createElement('div');
    document.body.appendChild(root);
    purchaseLog = [];
    closeCount = 0;
    rankLevel = 3;
    purchasePoints = 2;
    powers = [
      makePower('SCIENCE_PaladinTank', 'USAPaladin', 1, 'purchased'),
      makePower('SCIENCE_StealthFighter', 'USAStealthFighter', 1, 'purchasable'),
      makePower('SCIENCE_Paradrop1', 'USAParaDrop1', 1, 'purchasable'),
      makePower('SCIENCE_Paradrop2', 'USAParaDrop2', 1, 'prerequisites_unmet', ['SCIENCE_Paradrop1']),
      makePower('SCIENCE_DaisyCutter', 'USADaisyCutter', 1, 'insufficient_points'),
      makePower('SCIENCE_MOAB', 'MOAB', 1, 'hidden'),
    ];
    panel = new GeneralsPowersPanel(root, {
      onClose: () => { closeCount++; },
      getRankLevel: () => rankLevel,
      getPurchasePoints: () => purchasePoints,
      getAllSciences: () => powers,
      onPurchase: (scienceName, cost) => {
        purchaseLog.push({ scienceName, cost });
      },
    });
  });

  afterEach(() => {
    panel.hide();
    root.remove();
    // Clean up any style elements injected into the head
    document.querySelectorAll('style').forEach(s => {
      if (s.textContent?.includes('gp-overlay')) s.remove();
    });
  });

  it('starts hidden', () => {
    expect(panel.isVisible).toBe(false);
    expect(root.querySelector('.gp-overlay')).toBeNull();
  });

  it('shows panel on show()', () => {
    panel.show();
    expect(panel.isVisible).toBe(true);
    expect(root.querySelector('.gp-overlay')).not.toBeNull();
    expect(root.querySelector('.gp-title')?.textContent).toBe("General's Powers");
  });

  it('hides panel on hide()', () => {
    panel.show();
    panel.hide();
    expect(panel.isVisible).toBe(false);
    expect(root.querySelector('.gp-overlay')).toBeNull();
  });

  it('toggles visibility', () => {
    panel.toggle();
    expect(panel.isVisible).toBe(true);
    panel.toggle();
    expect(panel.isVisible).toBe(false);
  });

  it('displays rank and purchase points in subtitle', () => {
    panel.show();
    const subtitle = root.querySelector('.gp-subtitle');
    expect(subtitle?.textContent).toContain('Rank 3');
    expect(subtitle?.textContent).toContain('2 points available');
  });

  it('filters out hidden sciences', () => {
    panel.show();
    const items = root.querySelectorAll('.gp-item');
    const names = Array.from(items).map(el =>
      el.querySelector('.gp-item-name')?.textContent,
    );
    expect(names).not.toContain('MOAB');
    expect(names).toContain('USAStealthFighter');
  });

  it('shows purchased sciences with line-through styling class', () => {
    panel.show();
    const items = root.querySelectorAll('.gp-item-purchased');
    expect(items.length).toBe(1);
    expect(items[0].querySelector('.gp-item-name-purchased')?.textContent).toBe('USAPaladin');
  });

  it('shows purchasable sciences with purchasable styling', () => {
    panel.show();
    const items = root.querySelectorAll('.gp-item-purchasable');
    expect(items.length).toBe(2);
  });

  it('shows locked sciences for prerequisites_unmet', () => {
    panel.show();
    const prereqItems = root.querySelectorAll('.gp-status-prereq');
    expect(prereqItems.length).toBe(1);
    expect(prereqItems[0].textContent).toBe('Prereqs');
  });

  it('shows locked sciences for insufficient_points', () => {
    panel.show();
    const pointItems = root.querySelectorAll('.gp-status-points');
    expect(pointItems.length).toBe(1);
    expect(pointItems[0].textContent).toBe('Need GP');
  });

  it('triggers onPurchase when clicking a purchasable science', () => {
    panel.show();
    const purchasableItems = root.querySelectorAll('[data-action="purchase"]');
    expect(purchasableItems.length).toBe(2);

    // Click the first purchasable item
    (purchasableItems[0] as HTMLElement).click();
    expect(purchaseLog).toEqual([{ scienceName: 'SCIENCE_StealthFighter', cost: 1 }]);
  });

  it('does not trigger onPurchase for locked sciences', () => {
    panel.show();
    const lockedItems = root.querySelectorAll('.gp-item-locked');
    expect(lockedItems.length).toBeGreaterThan(0);

    for (const item of Array.from(lockedItems)) {
      (item as HTMLElement).click();
    }
    expect(purchaseLog).toEqual([]);
  });

  it('closes when clicking the close button', () => {
    panel.show();
    const closeBtn = root.querySelector('[data-action="close"]') as HTMLElement;
    expect(closeBtn).not.toBeNull();
    closeBtn.click();
    expect(panel.isVisible).toBe(false);
    expect(closeCount).toBe(1);
  });

  it('closes when clicking the overlay background', () => {
    panel.show();
    const overlay = root.querySelector('.gp-overlay') as HTMLElement;
    // Simulate clicking the overlay background directly (not a child)
    overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(panel.isVisible).toBe(false);
  });

  it('sorts purchasable sciences first', () => {
    panel.show();
    const items = root.querySelectorAll('.gp-item');
    const names = Array.from(items).map(el =>
      el.querySelector('.gp-item-name')?.textContent,
    );
    // Purchasable should come before locked/purchased
    const stealthIdx = names.indexOf('USAStealthFighter');
    const paladinIdx = names.indexOf('USAPaladin');
    expect(stealthIdx).toBeLessThan(paladinIdx);
  });

  it('displays cost in GP for each science', () => {
    panel.show();
    const costLabels = root.querySelectorAll('.gp-item-cost');
    expect(costLabels.length).toBe(5); // 5 visible (hidden is filtered out)
    for (const label of Array.from(costLabels)) {
      expect(label.textContent).toContain('GP');
    }
  });

  it('shows empty message when no sciences available', () => {
    powers = [];
    panel.show();
    const empty = root.querySelector('.gp-empty');
    expect(empty).not.toBeNull();
    expect(empty?.textContent).toContain('No General\'s Powers');
  });

  it('uses singular "point" when 1 point available', () => {
    purchasePoints = 1;
    panel.show();
    const subtitle = root.querySelector('.gp-subtitle');
    expect(subtitle?.textContent).toContain('1 point available');
  });

  it('refreshes content when show() is called while already visible', () => {
    panel.show();
    // Change data
    purchasePoints = 5;
    rankLevel = 5;
    // Show again should refresh
    panel.show();
    const subtitle = root.querySelector('.gp-subtitle');
    expect(subtitle?.textContent).toContain('Rank 5');
    expect(subtitle?.textContent).toContain('5 points available');
  });
});
