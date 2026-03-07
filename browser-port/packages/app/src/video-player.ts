/**
 * VideoPlayer — HTML5 <video> playback for campaign movies and script-triggered videos.
 *
 * Source parity:
 *   GeneralsMD/Code/GameEngine/Include/GameClient/VideoPlayer.h
 *   GeneralsMD/Code/GameEngine/Source/GameClient/VideoPlayer.cpp
 *
 * Parses Video.ini for name→filename mapping, creates a fullscreen <video> overlay,
 * and wires into the script movie playback bridge.
 */

// ──── Video.ini parsing ─────────────────────────────────────────────────────

export interface VideoEntry {
  name: string;
  filename: string;
  comment: string;
}

/**
 * Parse Video.ini text to build a name→filename map.
 * Format:
 *   Video <InternalName>
 *     Filename = <diskFilename>
 *     Comment = <description>
 *   End
 */
export function parseVideoIni(text: string): Map<string, VideoEntry> {
  const entries = new Map<string, VideoEntry>();
  const lines = text.split(/\r?\n/);

  let current: VideoEntry | null = null;

  for (const rawLine of lines) {
    const commentIdx = rawLine.indexOf(';');
    const line = (commentIdx >= 0 ? rawLine.slice(0, commentIdx) : rawLine).trim();
    if (!line) continue;

    const tokens = line.split(/\s+/);
    const keyword = tokens[0]!;

    if (keyword === 'Video') {
      current = { name: tokens.slice(1).join(' '), filename: '', comment: '' };
      continue;
    }

    if ((keyword === 'End' || keyword === 'END') && current) {
      if (current.name && current.filename) {
        entries.set(current.name, current);
      }
      current = null;
      continue;
    }

    if (!current) continue;

    if (keyword === 'Filename') {
      current.filename = tokens.slice(1).join(' ').replace(/^=\s*/, '');
    } else if (keyword === 'Comment') {
      current.comment = tokens.slice(1).join(' ').replace(/^=\s*/, '');
    }
  }

  return entries;
}

// ──── VideoPlayer ───────────────────────────────────────────────────────────

export interface VideoPlayerOptions {
  /** Root element to append the video overlay to. */
  root: HTMLElement;
  /** Base URL for video files (e.g., "assets/_extracted/video"). */
  videoBaseUrl: string;
  /** Called when a video finishes playing (or is skipped). */
  onVideoCompleted?: (movieName: string) => void;
}

export class VideoPlayer {
  private root: HTMLElement;
  private videoBaseUrl: string;
  private onVideoCompleted: ((movieName: string) => void) | null;
  private videoNameToEntry = new Map<string, VideoEntry>();

  private overlayEl: HTMLElement | null = null;
  private videoEl: HTMLVideoElement | null = null;
  private currentMovieName: string | null = null;
  private _isPlaying = false;
  private resolvePlayback: (() => void) | null = null;

  constructor(options: VideoPlayerOptions) {
    this.root = options.root;
    this.videoBaseUrl = options.videoBaseUrl.replace(/\/+$/, '');
    this.onVideoCompleted = options.onVideoCompleted ?? null;
  }

  /** Parse Video.ini and populate the name→file lookup. */
  init(videoIniText: string): void {
    this.videoNameToEntry = parseVideoIni(videoIniText);
  }

  /** Resolve a video internal name to a playable URL. */
  resolveVideoUrl(movieName: string): string | null {
    const entry = this.videoNameToEntry.get(movieName);
    const filename = entry?.filename ?? movieName;
    if (!filename) return null;
    return `${this.videoBaseUrl}/${filename}.mp4`;
  }

  /** Play a video fullscreen. Returns a promise that resolves when done/skipped. */
  async playFullscreen(movieName: string): Promise<void> {
    return this.play(movieName, 'fullscreen');
  }

  /** Play a video in the radar window area (currently same as fullscreen). */
  async playInRadar(movieName: string): Promise<void> {
    return this.play(movieName, 'radar');
  }

  get isPlaying(): boolean {
    return this._isPlaying;
  }

  stop(): void {
    this.cleanup();
  }

  private async play(movieName: string, mode: 'fullscreen' | 'radar'): Promise<void> {
    // Clean up any existing playback
    this.cleanup();

    const url = this.resolveVideoUrl(movieName);
    if (!url) {
      console.warn(`[VideoPlayer] No video file for "${movieName}", skipping`);
      this.onVideoCompleted?.(movieName);
      return;
    }

    this.currentMovieName = movieName;
    this._isPlaying = true;

    // Create overlay
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background: #000; z-index: 2000; display: flex;
      align-items: center; justify-content: center; cursor: pointer;
    `;
    if (mode === 'radar') {
      overlay.style.cssText = `
        position: absolute; top: 8px; right: 8px; width: 200px; height: 150px;
        background: #000; z-index: 1500; cursor: pointer;
      `;
    }

    const video = document.createElement('video');
    video.style.cssText = mode === 'fullscreen'
      ? 'max-width: 100%; max-height: 100%; object-fit: contain;'
      : 'width: 100%; height: 100%; object-fit: cover;';
    video.autoplay = true;
    video.playsInline = true;

    // Skip hint
    if (mode === 'fullscreen') {
      const hint = document.createElement('div');
      hint.textContent = 'Click to skip';
      hint.style.cssText = `
        position: absolute; bottom: 24px; left: 50%; transform: translateX(-50%);
        color: rgba(255,255,255,0.4); font-size: 0.85rem; pointer-events: none;
        font-family: 'Segoe UI', Arial, sans-serif;
      `;
      overlay.appendChild(hint);
    }

    overlay.appendChild(video);
    this.root.appendChild(overlay);
    this.overlayEl = overlay;
    this.videoEl = video;

    return new Promise<void>((resolve) => {
      this.resolvePlayback = resolve;

      const finish = () => {
        if (this.currentMovieName === movieName) {
          this.cleanup();
        }
      };

      video.addEventListener('ended', finish, { once: true });
      video.addEventListener('error', () => {
        console.warn(`[VideoPlayer] Failed to load "${url}", skipping`);
        finish();
      }, { once: true });

      // Click to skip
      overlay.addEventListener('click', finish, { once: true });

      // Keyboard skip (Escape or Space)
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape' || e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          document.removeEventListener('keydown', onKey);
          finish();
        }
      };
      document.addEventListener('keydown', onKey);

      video.src = url;
      video.play().catch(() => {
        // Autoplay blocked — skip
        console.warn(`[VideoPlayer] Autoplay blocked for "${movieName}", skipping`);
        finish();
      });
    });
  }

  private cleanup(): void {
    const movieName = this.currentMovieName;

    if (this.videoEl) {
      this.videoEl.pause();
      this.videoEl.removeAttribute('src');
      this.videoEl.load();
      this.videoEl = null;
    }
    if (this.overlayEl) {
      this.overlayEl.remove();
      this.overlayEl = null;
    }

    this._isPlaying = false;
    this.currentMovieName = null;

    if (this.resolvePlayback) {
      this.resolvePlayback();
      this.resolvePlayback = null;
    }

    if (movieName) {
      this.onVideoCompleted?.(movieName);
    }
  }
}
