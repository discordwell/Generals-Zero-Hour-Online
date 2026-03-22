/**
 * General's Powers Panel -- In-game science purchase overlay.
 *
 * Source parity:
 *   Generals/Code/GameClient/GUI/GUICallbacks/GeneralsPowers.cpp
 *
 * Displays purchasable General's Powers (sciences) for the local player.
 * Each power shows its name, cost, and purchase status. Players can click
 * a purchasable power to spend their General's Points (GP) on it.
 * Toggled via hotkey (F4) during gameplay.
 */

const GENERALS_POWERS_STYLES = `
  .gp-overlay {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 60px;
    background: rgba(0, 0, 0, 0.6);
    z-index: 950;
    font-family: 'Segoe UI', Arial, sans-serif;
    color: #e0d8c0;
  }
  .gp-panel {
    background: rgba(12, 16, 28, 0.96);
    border: 1px solid rgba(201, 168, 76, 0.4);
    padding: 20px 28px;
    min-width: 420px;
    max-width: 560px;
    max-height: 80vh;
    overflow-y: auto;
  }
  .gp-title {
    font-size: 1.3rem;
    color: #c9a84c;
    text-transform: uppercase;
    letter-spacing: 0.25em;
    margin-bottom: 4px;
    text-align: center;
  }
  .gp-subtitle {
    font-size: 0.8rem;
    color: #8a8070;
    text-align: center;
    margin-bottom: 16px;
  }
  .gp-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 6px;
  }
  .gp-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    border: 1px solid rgba(201, 168, 76, 0.12);
    border-radius: 3px;
    background: rgba(201, 168, 76, 0.03);
    transition: background 0.15s, border-color 0.15s;
  }
  .gp-item-purchasable {
    cursor: pointer;
    border-color: rgba(106, 170, 106, 0.4);
    background: rgba(106, 170, 106, 0.06);
  }
  .gp-item-purchasable:hover {
    background: rgba(106, 170, 106, 0.15);
    border-color: rgba(106, 170, 106, 0.6);
  }
  .gp-item-purchased {
    border-color: rgba(201, 168, 76, 0.3);
    background: rgba(201, 168, 76, 0.08);
    opacity: 0.7;
  }
  .gp-item-locked {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .gp-item-name {
    font-size: 0.85rem;
    font-weight: 500;
  }
  .gp-item-name-purchasable {
    color: #8fcc8f;
  }
  .gp-item-name-purchased {
    color: #c9a84c;
    text-decoration: line-through;
    text-decoration-color: rgba(201, 168, 76, 0.4);
  }
  .gp-item-name-locked {
    color: #6a6258;
  }
  .gp-item-right {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-shrink: 0;
  }
  .gp-item-cost {
    font-size: 0.75rem;
    font-weight: 600;
    padding: 2px 8px;
    border-radius: 2px;
    letter-spacing: 0.05em;
  }
  .gp-cost-purchasable {
    color: #8fcc8f;
    background: rgba(106, 170, 106, 0.12);
  }
  .gp-cost-purchased {
    color: #c9a84c;
    background: rgba(201, 168, 76, 0.1);
  }
  .gp-cost-locked {
    color: #6a6258;
    background: rgba(100, 100, 100, 0.1);
  }
  .gp-item-status {
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    white-space: nowrap;
  }
  .gp-status-purchased {
    color: #c9a84c;
  }
  .gp-status-prereq {
    color: #cc7744;
  }
  .gp-status-points {
    color: #cc5555;
  }
  .gp-close {
    display: block;
    margin: 14px auto 0;
    padding: 7px 22px;
    border: 1px solid rgba(201, 168, 76, 0.4);
    background: rgba(201, 168, 76, 0.08);
    color: #c9a84c;
    font-size: 0.85rem;
    font-family: inherit;
    text-transform: uppercase;
    letter-spacing: 0.15em;
    cursor: pointer;
    transition: background 0.2s;
  }
  .gp-close:hover {
    background: rgba(201, 168, 76, 0.18);
  }
  .gp-empty {
    text-align: center;
    color: #6a6258;
    padding: 20px;
    font-size: 0.85rem;
  }
`;

export interface GeneralsPowerInfo {
  name: string;
  displayName: string;
  cost: number;
  status: 'purchased' | 'purchasable' | 'prerequisites_unmet' | 'insufficient_points' | 'disabled' | 'hidden';
  prerequisites: string[];
}

export interface GeneralsPowersPanelCallbacks {
  onClose(): void;
  getRankLevel(): number;
  getPurchasePoints(): number;
  getAllSciences(): GeneralsPowerInfo[];
  onPurchase(scienceName: string, cost: number): void;
}

export class GeneralsPowersPanel {
  private root: HTMLElement;
  private callbacks: GeneralsPowersPanelCallbacks;
  private overlayEl: HTMLElement | null = null;
  private styleEl: HTMLStyleElement | null = null;
  private _escHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(root: HTMLElement, callbacks: GeneralsPowersPanelCallbacks) {
    this.root = root;
    this.callbacks = callbacks;
  }

  show(): void {
    if (this.overlayEl) {
      // Already visible - refresh contents instead.
      this.refresh();
      return;
    }

    if (!this.styleEl) {
      this.styleEl = document.createElement('style');
      this.styleEl.textContent = GENERALS_POWERS_STYLES;
      document.head.appendChild(this.styleEl);
    }

    const el = document.createElement('div');
    el.className = 'gp-overlay';
    this.buildPanelContent(el);

    el.addEventListener('click', (e) => {
      const target = (e.target as HTMLElement).closest('[data-action]') as HTMLElement | null;
      if (target?.dataset.action === 'close' || e.target === el) {
        this.hide();
        this.callbacks.onClose();
        return;
      }
      if (target?.dataset.action === 'purchase') {
        const scienceName = target.dataset.science;
        const cost = parseInt(target.dataset.cost ?? '', 10);
        if (scienceName && Number.isFinite(cost) && cost > 0) {
          this.callbacks.onPurchase(scienceName, cost);
          // Refresh to show updated state after purchase.
          this.refresh();
        }
      }
    });

    this._escHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.hide();
        this.callbacks.onClose();
      }
    };
    document.addEventListener('keydown', this._escHandler, true);

    this.root.appendChild(el);
    this.overlayEl = el;
  }

  hide(): void {
    if (this.overlayEl) {
      this.overlayEl.remove();
      this.overlayEl = null;
    }
    if (this._escHandler) {
      document.removeEventListener('keydown', this._escHandler, true);
      this._escHandler = null;
    }
  }

  toggle(): void {
    if (this.isVisible) {
      this.hide();
      this.callbacks.onClose();
    } else {
      this.show();
    }
  }

  get isVisible(): boolean {
    return this.overlayEl !== null;
  }

  /** Refresh panel contents in-place while keeping it visible. */
  private refresh(): void {
    if (!this.overlayEl) return;
    this.overlayEl.innerHTML = '';
    this.buildPanelContent(this.overlayEl);
  }

  private buildPanelContent(container: HTMLElement): void {
    const rankLevel = this.callbacks.getRankLevel();
    const purchasePoints = this.callbacks.getPurchasePoints();
    const sciences = this.callbacks.getAllSciences();

    // Filter out hidden sciences and sort: purchasable first, then by cost.
    const visible = sciences
      .filter(s => s.status !== 'hidden')
      .sort((a, b) => {
        const statusOrder: Record<string, number> = { purchasable: 0, insufficient_points: 1, prerequisites_unmet: 2, disabled: 3, purchased: 4, hidden: 5 };
        const orderA = statusOrder[a.status] ?? 5;
        const orderB = statusOrder[b.status] ?? 5;
        if (orderA !== orderB) return orderA - orderB;
        return a.cost - b.cost;
      });

    const rankStars = '\u2605'.repeat(Math.min(rankLevel, 5));
    const pointsLabel = purchasePoints === 1 ? 'point' : 'points';

    let itemsHtml: string;
    if (visible.length === 0) {
      itemsHtml = '<div class="gp-empty">No General\'s Powers available for your faction.</div>';
    } else {
      itemsHtml = visible.map(sci => {
        let itemClass = 'gp-item';
        let nameClass = 'gp-item-name';
        let costClass = 'gp-item-cost';
        let statusHtml = '';
        let actionAttrs = '';

        switch (sci.status) {
          case 'purchasable':
            itemClass += ' gp-item-purchasable';
            nameClass += ' gp-item-name-purchasable';
            costClass += ' gp-cost-purchasable';
            actionAttrs = ` data-action="purchase" data-science="${this.escapeAttr(sci.name)}" data-cost="${sci.cost}"`;
            break;
          case 'purchased':
            itemClass += ' gp-item-purchased';
            nameClass += ' gp-item-name-purchased';
            costClass += ' gp-cost-purchased';
            statusHtml = '<span class="gp-item-status gp-status-purchased">Owned</span>';
            break;
          case 'prerequisites_unmet':
            itemClass += ' gp-item-locked';
            nameClass += ' gp-item-name-locked';
            costClass += ' gp-cost-locked';
            statusHtml = '<span class="gp-item-status gp-status-prereq">Prereqs</span>';
            break;
          case 'insufficient_points':
            itemClass += ' gp-item-locked';
            nameClass += ' gp-item-name-locked';
            costClass += ' gp-cost-locked';
            statusHtml = '<span class="gp-item-status gp-status-points">Need GP</span>';
            break;
          case 'disabled':
            itemClass += ' gp-item-locked';
            nameClass += ' gp-item-name-locked';
            costClass += ' gp-cost-locked';
            statusHtml = '<span class="gp-item-status gp-status-prereq">Disabled</span>';
            break;
        }

        return `
          <div class="${itemClass}"${actionAttrs}>
            <span class="${nameClass}">${this.escapeHtml(sci.displayName)}</span>
            <div class="gp-item-right">
              ${statusHtml}
              <span class="${costClass}">${sci.cost} GP</span>
            </div>
          </div>
        `;
      }).join('');
    }

    container.innerHTML = `
      <div class="gp-panel">
        <div class="gp-title">General's Powers</div>
        <div class="gp-subtitle">${rankStars} Rank ${rankLevel} &mdash; ${purchasePoints} ${pointsLabel} available</div>
        <div class="gp-grid">
          ${itemsHtml}
        </div>
        <button class="gp-close" data-action="close">Close (F4)</button>
      </div>
    `;
  }

  private escapeHtml(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  private escapeAttr(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}
