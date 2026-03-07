/**
 * Post-Game Stats Screen — Victory/defeat results with per-side statistics.
 *
 * Source parity:
 *   Generals/Code/GameClient/GUI/GUICallbacks/Menus/ScoreScreen.cpp
 *   Generals/Code/GameEngine/Include/Common/ScoreKeeper.h
 *
 * Replaces the simple endgame overlay with a full stats breakdown showing
 * units built/lost/destroyed, structures built/lost/destroyed, and money
 * earned for each side.
 */

const POSTGAME_STYLES = `
  .postgame-overlay {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.8);
    z-index: 960;
    font-family: 'Segoe UI', Arial, sans-serif;
    color: #e0d8c0;
  }
  .postgame-panel {
    background: rgba(12, 16, 28, 0.95);
    border: 1px solid rgba(201, 168, 76, 0.35);
    padding: 32px 40px;
    min-width: 560px;
    max-width: 720px;
  }
  .postgame-result {
    text-align: center;
    margin-bottom: 24px;
  }
  .postgame-result-title {
    font-size: 2.4rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.2em;
    text-shadow: 0 2px 8px rgba(0,0,0,0.8);
  }
  .postgame-result-victory { color: #c9a84c; }
  .postgame-result-defeat { color: #cc3333; }
  .postgame-result-subtitle {
    font-size: 1rem;
    color: #8a8070;
    margin-top: 6px;
  }
  .postgame-stats-title {
    font-size: 0.75rem;
    color: #6a6258;
    text-transform: uppercase;
    letter-spacing: 0.15em;
    margin-bottom: 8px;
    border-bottom: 1px solid rgba(201, 168, 76, 0.15);
    padding-bottom: 4px;
  }
  .postgame-table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 20px;
  }
  .postgame-table th {
    font-size: 0.7rem;
    color: #6a6258;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    padding: 4px 6px 8px;
    text-align: right;
    border-bottom: 1px solid rgba(201, 168, 76, 0.15);
  }
  .postgame-table th:first-child {
    text-align: left;
  }
  .postgame-table td {
    font-size: 0.85rem;
    padding: 7px 6px;
    text-align: right;
    border-bottom: 1px solid rgba(201, 168, 76, 0.06);
    font-variant-numeric: tabular-nums;
  }
  .postgame-table td:first-child {
    text-align: left;
  }
  .postgame-side-winner {
    color: #c9a84c;
    font-weight: 600;
  }
  .postgame-side-loser {
    color: #cc4444;
  }
  .postgame-side-neutral {
    color: #8a8070;
  }
  .postgame-faction-usa { color: #5588cc; }
  .postgame-faction-china { color: #cc5555; }
  .postgame-faction-gla { color: #88aa44; }
  .postgame-actions {
    display: flex;
    gap: 12px;
    justify-content: center;
    margin-top: 24px;
  }
  .postgame-btn {
    padding: 10px 28px;
    border: 1px solid rgba(201, 168, 76, 0.4);
    background: rgba(201, 168, 76, 0.08);
    color: #c9a84c;
    font-size: 0.95rem;
    font-family: inherit;
    text-transform: uppercase;
    letter-spacing: 0.15em;
    cursor: pointer;
    transition: background 0.2s, border-color 0.2s;
  }
  .postgame-btn:hover {
    background: rgba(201, 168, 76, 0.18);
    border-color: rgba(201, 168, 76, 0.7);
  }
  .postgame-btn.primary {
    background: rgba(201, 168, 76, 0.2);
    border-color: #c9a84c;
  }
  .postgame-btn.primary:hover {
    background: rgba(201, 168, 76, 0.35);
  }
`;

export interface SideScoreDisplay {
  side: string;
  faction: string;
  isVictor: boolean;
  isLocal: boolean;
  unitsBuilt: number;
  unitsLost: number;
  unitsDestroyed: number;
  structuresBuilt: number;
  structuresLost: number;
  structuresDestroyed: number;
  moneyEarned: number;
  moneySpent: number;
}

export interface PostgameScreenCallbacks {
  onReturnToMenu(): void;
  onPlayAgain(): void;
}

export class PostgameStatsScreen {
  private root: HTMLElement;
  private callbacks: PostgameScreenCallbacks;
  private overlayEl: HTMLElement | null = null;
  private styleEl: HTMLStyleElement | null = null;

  constructor(root: HTMLElement, callbacks: PostgameScreenCallbacks) {
    this.root = root;
    this.callbacks = callbacks;
  }

  show(
    result: 'VICTORY' | 'DEFEAT',
    sides: SideScoreDisplay[],
  ): void {
    if (this.overlayEl) return;

    if (!this.styleEl) {
      this.styleEl = document.createElement('style');
      this.styleEl.textContent = POSTGAME_STYLES;
      document.head.appendChild(this.styleEl);
    }

    const resultClass = result === 'VICTORY' ? 'postgame-result-victory' : 'postgame-result-defeat';
    const resultText = result === 'VICTORY' ? 'Victory' : 'Defeat';
    const subtitleText = result === 'VICTORY'
      ? 'All enemy forces have been eliminated.'
      : 'Your forces have been destroyed.';

    const rows = sides.map(s => {
      const sideClass = s.isVictor ? 'postgame-side-winner' : 'postgame-side-loser';
      const factionClass = this.factionClass(s.faction);
      const marker = s.isLocal ? ' (You)' : '';
      return `
        <tr>
          <td class="${sideClass}"><span class="${factionClass}">${this.escapeHtml(s.faction)}</span>${marker}</td>
          <td>${s.unitsBuilt}</td>
          <td>${s.unitsLost}</td>
          <td>${s.unitsDestroyed}</td>
          <td>${s.structuresBuilt}</td>
          <td>${s.structuresLost}</td>
          <td>${s.structuresDestroyed}</td>
          <td>$${s.moneyEarned.toLocaleString()}</td>
          <td>$${s.moneySpent.toLocaleString()}</td>
        </tr>
      `;
    }).join('');

    const el = document.createElement('div');
    el.className = 'postgame-overlay';
    el.innerHTML = `
      <div class="postgame-panel">
        <div class="postgame-result">
          <div class="postgame-result-title ${resultClass}">${resultText}</div>
          <div class="postgame-result-subtitle">${subtitleText}</div>
        </div>

        <div class="postgame-stats-title">Battle Statistics</div>
        <table class="postgame-table">
          <thead>
            <tr>
              <th>Side</th>
              <th>Units Built</th>
              <th>Units Lost</th>
              <th>Units Killed</th>
              <th>Bldgs Built</th>
              <th>Bldgs Lost</th>
              <th>Bldgs Killed</th>
              <th>Income</th>
              <th>Spent</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>

        <div class="postgame-actions">
          <button class="postgame-btn" data-action="menu">Return to Menu</button>
          <button class="postgame-btn primary" data-action="again">Play Again</button>
        </div>
      </div>
    `;

    el.addEventListener('click', (e) => {
      const target = (e.target as HTMLElement).closest('[data-action]') as HTMLElement | null;
      if (!target) return;
      if (target.dataset.action === 'menu') {
        this.callbacks.onReturnToMenu();
      } else if (target.dataset.action === 'again') {
        this.callbacks.onPlayAgain();
      }
    });

    this.root.appendChild(el);
    this.overlayEl = el;
  }

  hide(): void {
    if (this.overlayEl) {
      this.overlayEl.remove();
      this.overlayEl = null;
    }
    if (this.styleEl) {
      this.styleEl.remove();
      this.styleEl = null;
    }
  }

  get isVisible(): boolean {
    return this.overlayEl !== null;
  }

  private factionClass(faction: string): string {
    const lower = faction.toLowerCase();
    if (lower.includes('america') || lower === 'usa') return 'postgame-faction-usa';
    if (lower.includes('china')) return 'postgame-faction-china';
    if (lower.includes('gla')) return 'postgame-faction-gla';
    return '';
  }

  private escapeHtml(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}
