/**
 * Diplomacy Screen — In-game player status overlay.
 *
 * Source parity:
 *   Generals/Code/GameClient/GUI/GUICallbacks/Diplomacy.cpp
 *
 * Displays all players/sides with their faction, team, and alive/defeated
 * status. Toggled via a hotkey (F9) or the diplomacy button during gameplay.
 */

const DIPLOMACY_STYLES = `
  .diplomacy-overlay {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 80px;
    background: rgba(0, 0, 0, 0.55);
    z-index: 940;
    font-family: 'Segoe UI', Arial, sans-serif;
    color: #e0d8c0;
  }
  .diplomacy-panel {
    background: rgba(12, 16, 28, 0.95);
    border: 1px solid rgba(201, 168, 76, 0.35);
    padding: 24px 32px;
    min-width: 480px;
    max-width: 600px;
  }
  .diplomacy-title {
    font-size: 1.3rem;
    color: #c9a84c;
    text-transform: uppercase;
    letter-spacing: 0.25em;
    margin-bottom: 20px;
    text-align: center;
  }
  .diplomacy-table {
    width: 100%;
    border-collapse: collapse;
  }
  .diplomacy-table th {
    font-size: 0.7rem;
    color: #6a6258;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    padding: 4px 8px 8px;
    text-align: left;
    border-bottom: 1px solid rgba(201, 168, 76, 0.15);
  }
  .diplomacy-table td {
    font-size: 0.9rem;
    padding: 8px;
    border-bottom: 1px solid rgba(201, 168, 76, 0.06);
  }
  .diplomacy-status-alive {
    color: #6aaa6a;
  }
  .diplomacy-status-defeated {
    color: #cc4444;
  }
  .diplomacy-player-local {
    color: #c9a84c;
    font-weight: 600;
  }
  .diplomacy-faction-usa { color: #5588cc; }
  .diplomacy-faction-china { color: #cc5555; }
  .diplomacy-faction-gla { color: #88aa44; }
  .diplomacy-faction-other { color: #8a8070; }
  .diplomacy-close {
    display: block;
    margin: 16px auto 0;
    padding: 8px 24px;
    border: 1px solid rgba(201, 168, 76, 0.4);
    background: rgba(201, 168, 76, 0.08);
    color: #c9a84c;
    font-size: 0.9rem;
    font-family: inherit;
    text-transform: uppercase;
    letter-spacing: 0.15em;
    cursor: pointer;
    transition: background 0.2s;
  }
  .diplomacy-close:hover {
    background: rgba(201, 168, 76, 0.18);
  }
`;

export interface DiplomacyPlayerInfo {
  side: string;
  displayName: string;
  faction: string;
  isLocal: boolean;
  isDefeated: boolean;
  playerType: 'HUMAN' | 'COMPUTER';
}

export interface DiplomacyScreenCallbacks {
  onClose(): void;
  getPlayerInfos(): DiplomacyPlayerInfo[];
}

export class DiplomacyScreen {
  private root: HTMLElement;
  private callbacks: DiplomacyScreenCallbacks;
  private overlayEl: HTMLElement | null = null;
  private styleEl: HTMLStyleElement | null = null;
  private _escHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(root: HTMLElement, callbacks: DiplomacyScreenCallbacks) {
    this.root = root;
    this.callbacks = callbacks;
  }

  show(): void {
    if (this.overlayEl) return;

    if (!this.styleEl) {
      this.styleEl = document.createElement('style');
      this.styleEl.textContent = DIPLOMACY_STYLES;
      document.head.appendChild(this.styleEl);
    }

    const players = this.callbacks.getPlayerInfos();
    const rows = players.map(p => {
      const factionClass = this.factionClass(p.faction);
      const statusClass = p.isDefeated ? 'diplomacy-status-defeated' : 'diplomacy-status-alive';
      const statusText = p.isDefeated ? 'Defeated' : 'Active';
      const nameClass = p.isLocal ? 'diplomacy-player-local' : '';
      const typeLabel = p.playerType === 'COMPUTER' ? 'AI' : 'Human';
      return `
        <tr>
          <td class="${nameClass}">${this.escapeHtml(p.displayName)}</td>
          <td class="${factionClass}">${this.escapeHtml(p.faction)}</td>
          <td>${typeLabel}</td>
          <td class="${statusClass}">${statusText}</td>
        </tr>
      `;
    }).join('');

    const el = document.createElement('div');
    el.className = 'diplomacy-overlay';
    el.innerHTML = `
      <div class="diplomacy-panel">
        <div class="diplomacy-title">Diplomacy</div>
        <table class="diplomacy-table">
          <thead>
            <tr>
              <th>Player</th>
              <th>Faction</th>
              <th>Type</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${rows || '<tr><td colspan="4" style="text-align:center;color:#6a6258">No players</td></tr>'}
          </tbody>
        </table>
        <button class="diplomacy-close" data-action="close">Close</button>
      </div>
    `;

    el.addEventListener('click', (e) => {
      const target = (e.target as HTMLElement).closest('[data-action]') as HTMLElement | null;
      if ((target?.dataset.action === 'close') || e.target === el) {
        this.hide();
        this.callbacks.onClose();
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

  private factionClass(faction: string): string {
    const lower = faction.toLowerCase();
    if (lower.includes('america') || lower === 'usa') return 'diplomacy-faction-usa';
    if (lower.includes('china')) return 'diplomacy-faction-china';
    if (lower.includes('gla')) return 'diplomacy-faction-gla';
    return 'diplomacy-faction-other';
  }

  private escapeHtml(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}
