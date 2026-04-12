import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createConnection, type Socket } from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { QEMU_CONFIG } from './generals-config.js';
import type { InputStep } from './input-sequences.js';

/** Timeout for individual QMP commands (ms). */
const QMP_TIMEOUT = 30_000;

/**
 * Validate a string for safe use in HMP commands.
 * Only allows alphanumeric, hyphens, underscores, dots, slashes, spaces, and colons.
 */
function validateHmpArg(value: string, label: string): void {
  if (!/^[\w./ :\\-]+$/.test(value)) {
    throw new Error(`Invalid ${label} for HMP command: ${value}`);
  }
}

function validateDiskImage(): void {
  const result = spawnSync('qemu-img', ['info', '--backing-chain', QEMU_CONFIG.diskImage], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || 'qemu-img info failed').trim();
    throw new Error(
      `QEMU disk image is not bootable: ${QEMU_CONFIG.diskImage}\n` +
      `${detail}\n` +
      'Restore the missing backing image or convert this overlay to a standalone qcow2 before capturing source save fixtures.',
    );
  }
}

/**
 * Manages a QEMU VM via QMP (QEMU Machine Protocol).
 * Handles lifecycle: boot → input → screendump → shutdown.
 *
 * Adapted from Emperor: Battle for Dune visual oracle.
 * The core QMP protocol is identical — only the config differs.
 */
export class QemuController {
  private proc: ChildProcess | null = null;
  private qmpSocket: Socket | null = null;
  private qmpReady = false;
  private greetingReceived = false;
  private responseQueue: Array<{
    resolve: (val: unknown) => void;
    reject: (err: Error) => void;
  }> = [];
  private buffer = '';

  async boot(): Promise<void> {
    if (!fs.existsSync(QEMU_CONFIG.diskImage)) {
      throw new Error(
        `QEMU disk image not found: ${QEMU_CONFIG.diskImage}\n` +
        'See tools/visual-oracle/vm/README.md for setup instructions.'
      );
    }
    validateDiskImage();

    // Clean up stale socket
    if (fs.existsSync(QEMU_CONFIG.qmpSocket)) {
      fs.unlinkSync(QEMU_CONFIG.qmpSocket);
    }

    // Build port-forwarding string for user-mode networking
    const hostfwds = (QEMU_CONFIG.portForwards ?? [])
      .map((pf) => `hostfwd=tcp::${pf.host}-:${pf.guest}`)
      .join(',');
    const netdevArg = hostfwds
      ? `user,id=net0,${hostfwds}`
      : 'user,id=net0';

    const args = [
      '-hda', QEMU_CONFIG.diskImage,
      '-m', QEMU_CONFIG.memory,
      '-vga', QEMU_CONFIG.display,
      // VNC display backend — required for QMP input events to reach the guest.
      '-vnc', QEMU_CONFIG.vncDisplay ?? ':1',
      '-qmp', `unix:${QEMU_CONFIG.qmpSocket},server,nowait`,
      '-accel', 'tcg',     // software emulation (ARM Mac)
      '-cpu', QEMU_CONFIG.cpu ?? 'Conroe',
      '-smp', '2',         // Generals benefits from dual-core
      '-usb',
      '-device', 'usb-tablet', // absolute mouse positioning
      '-device', QEMU_CONFIG.audio ?? 'intel-hda',
      ...(QEMU_CONFIG.audio === 'intel-hda' ? ['-device', 'hda-duplex'] : []),
      '-netdev', netdevArg,
      '-device', 'e1000,netdev=net0',
    ];

    if (QEMU_CONFIG.cdrom) {
      args.push('-cdrom', QEMU_CONFIG.cdrom);
    }

    console.log(`[QEMU] Booting VM: ${QEMU_CONFIG.binary} ${args.join(' ')}`);
    this.proc = spawn(QEMU_CONFIG.binary, args, { stdio: 'ignore' });

    this.proc.on('error', (err) => {
      console.error('[QEMU] Process error:', err.message);
    });

    this.proc.on('exit', (code) => {
      console.log(`[QEMU] Process exited with code ${code}`);
    });

    // Wait for QMP socket to become available
    await this.waitForQmpSocket();
    await this.connectQmp();
  }

  private async waitForQmpSocket(): Promise<void> {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      if (fs.existsSync(QEMU_CONFIG.qmpSocket)) return;
      await sleep(500);
    }
    throw new Error('QMP socket did not appear within 30s');
  }

  private async connectQmp(): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const settle = (fn: typeof resolve | typeof reject, val: unknown) => {
        if (settled) return;
        settled = true;
        (fn as (v: unknown) => void)(val);
      };

      this.qmpSocket = createConnection(QEMU_CONFIG.qmpSocket);

      this.qmpSocket.on('error', (err) => {
        settle(reject, new Error(`QMP connection error: ${err.message}`));
      });

      this.qmpSocket.on('data', (data) => {
        this.buffer += data.toString();
        this.processQmpBuffer();
      });

      this.qmpSocket.once('connect', async () => {
        const deadline = Date.now() + 10_000;
        while (!this.greetingReceived && Date.now() < deadline) {
          await sleep(100);
        }
        if (!this.greetingReceived) {
          settle(reject, new Error('QMP greeting not received within 10s'));
          return;
        }

        this.qmpReady = true;
        await this.qmpCommand('qmp_capabilities');
        console.log('[QEMU] QMP connected and ready');
        settle(resolve, undefined);
      });
    });
  }

  private processQmpBuffer(): void {
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);

        if (msg.QMP) {
          this.greetingReceived = true;
          console.log('[QEMU] QMP greeting received');
          continue;
        }

        if (msg.return !== undefined || msg.error) {
          const handler = this.responseQueue.shift();
          if (handler) {
            if (msg.error) {
              handler.reject(new Error(`QMP error: ${JSON.stringify(msg.error)}`));
            } else {
              handler.resolve(msg.return);
            }
          }
        }
        if (msg.event) {
          console.log(`[QEMU] Event: ${msg.event}`);
        }
      } catch {
        // Partial JSON, will be completed on next data event
      }
    }
  }

  private sendRaw(obj: unknown): void {
    this.qmpSocket?.write(JSON.stringify(obj) + '\n');
  }

  private async qmpCommand(execute: string, args?: Record<string, unknown>): Promise<unknown> {
    if (!this.qmpReady) throw new Error('QMP not ready');

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.responseQueue.findIndex((h) => h.resolve === resolve);
        if (idx >= 0) this.responseQueue.splice(idx, 1);
        reject(new Error(`QMP command '${execute}' timed out after ${QMP_TIMEOUT}ms`));
      }, QMP_TIMEOUT);

      this.responseQueue.push({
        resolve: (val) => { clearTimeout(timer); resolve(val); },
        reject: (err) => { clearTimeout(timer); reject(err); },
      });
      const cmd: Record<string, unknown> = { execute };
      if (args) cmd.arguments = args;
      this.sendRaw(cmd);
    });
  }

  /**
   * Drain the response queue, rejecting all pending promises.
   * Called on disconnect/shutdown to prevent hanging awaits.
   */
  private drainResponseQueue(): void {
    const pending = this.responseQueue.splice(0);
    for (const handler of pending) {
      handler.reject(new Error('QMP connection closed'));
    }
  }

  /**
   * Send keyboard input to the VM guest.
   * Key names follow QEMU qcode conventions: 'ret', 'esc', 'a'-'z', '1'-'9', etc.
   */
  async sendKey(keys: string[]): Promise<void> {
    const qemuKeys = keys.map((k) => ({ type: 'qcode', data: k }));
    await this.qmpCommand('send-key', { keys: qemuKeys });
  }

  /**
   * Connect to an already-running QEMU VM via its QMP socket.
   */
  async connectToExisting(): Promise<void> {
    if (!fs.existsSync(QEMU_CONFIG.qmpSocket)) {
      throw new Error(
        `QMP socket not found: ${QEMU_CONFIG.qmpSocket}\n` +
        'Is the QEMU VM already running?'
      );
    }
    await this.connectQmp();
  }

  /**
   * Detect the current guest framebuffer size from a screendump PPM header.
   */
  async getFramebufferSize(): Promise<{ width: number; height: number }> {
    const tmpPath = '/tmp/generals-fb-probe.ppm';
    await this.qmpCommand('screendump', { filename: tmpPath });
    await sleep(300);
    const buf = fs.readFileSync(tmpPath);
    fs.unlinkSync(tmpPath);
    let offset = 0;
    let line = readLine(buf, offset);
    offset += line.length + 1;
    let dimLine = readLine(buf, offset);
    while (dimLine.startsWith('#')) {
      offset += dimLine.length + 1;
      dimLine = readLine(buf, offset);
    }
    const [width, height] = dimLine.trim().split(/\s+/).map(Number);
    return { width, height };
  }

  /**
   * Move the mouse to absolute screen coordinates via usb-tablet device.
   * Coordinates are in VM display pixels. QMP uses 0-32767 range.
   */
  async mouseMove(x: number, y: number, fbSize?: { width: number; height: number }): Promise<void> {
    const res = fbSize ?? QEMU_CONFIG.resolution;
    const absX = Math.round((x / res.width) * 32767);
    const absY = Math.round((y / res.height) * 32767);
    await this.qmpCommand('input-send-event', {
      events: [
        { type: 'abs', data: { axis: 'x', value: absX } },
        { type: 'abs', data: { axis: 'y', value: absY } },
      ],
    });
  }

  /**
   * Click at absolute screen coordinates.
   * Two-device approach for DirectInput compatibility:
   * 1. Position via usb-tablet (input-send-event abs) → WM_MOUSEMOVE
   * 2. Click via HMP mouse_button → WM_LBUTTONDOWN/UP
   */
  async mouseClick(
    x: number,
    y: number,
    button: 'left' | 'right' | 'middle' = 'left',
    fbSize?: { width: number; height: number },
  ): Promise<void> {
    await this.mouseMove(x, y, fbSize);
    await sleep(50);

    const btnMask = button === 'left' ? 1 : button === 'middle' ? 2 : 4;
    await this.qmpCommand('human-monitor-command', {
      'command-line': `mouse_button ${btnMask}`,
    });
    await sleep(100);
    await this.qmpCommand('human-monitor-command', {
      'command-line': 'mouse_button 0',
    });
  }

  /**
   * Press a mouse button without releasing (for drag operations).
   */
  async mouseDown(button: 'left' | 'right' | 'middle' = 'left'): Promise<void> {
    const btnMask = button === 'left' ? 1 : button === 'middle' ? 2 : 4;
    await this.qmpCommand('human-monitor-command', {
      'command-line': `mouse_button ${btnMask}`,
    });
  }

  /**
   * Release all mouse buttons.
   */
  async mouseUp(): Promise<void> {
    await this.qmpCommand('human-monitor-command', {
      'command-line': 'mouse_button 0',
    });
  }

  /**
   * Load a VM snapshot (savevm/loadvm via HMP).
   */
  async loadSnapshot(name: string): Promise<void> {
    validateHmpArg(name, 'snapshot name');
    console.log(`[QEMU] Loading snapshot "${name}"...`);
    await this.qmpCommand('human-monitor-command', { 'command-line': `loadvm ${name}` });
    console.log(`[QEMU] Snapshot "${name}" loaded`);
  }

  /**
   * Save a VM snapshot for instant restore later.
   */
  async saveSnapshot(name: string): Promise<void> {
    validateHmpArg(name, 'snapshot name');
    console.log(`[QEMU] Saving snapshot "${name}"...`);
    await this.qmpCommand('human-monitor-command', { 'command-line': `savevm ${name}` });
    await sleep(3000);
    console.log(`[QEMU] Snapshot "${name}" saved`);
  }

  /**
   * Change the CD/DVD disc in the VM's IDE CD-ROM drive.
   */
  async changeCD(isoPath: string): Promise<void> {
    validateHmpArg(isoPath, 'ISO path');
    console.log(`[QEMU] Changing CD to: ${isoPath}`);
    await this.qmpCommand('human-monitor-command', {
      'command-line': `change ide1-cd0 ${isoPath}`,
    });
  }

  /**
   * Eject the CD/DVD from the VM.
   */
  async ejectCD(): Promise<void> {
    await this.qmpCommand('human-monitor-command', {
      'command-line': 'eject ide1-cd0',
    });
  }

  /**
   * Capture the guest framebuffer as PNG.
   * QEMU screendump outputs PPM, which we convert to PNG.
   */
  async captureScreenshot(outputPath: string): Promise<Buffer> {
    if (!outputPath.endsWith('.png')) {
      throw new Error(`captureScreenshot requires a .png output path, got: ${outputPath}`);
    }
    const ppmPath = outputPath.replace(/\.png$/, '.ppm');
    await this.qmpCommand('screendump', { filename: ppmPath });
    await sleep(500);
    const pngBuf = ppmToPng(fs.readFileSync(ppmPath));
    fs.writeFileSync(outputPath, pngBuf);
    fs.unlinkSync(ppmPath);
    return pngBuf;
  }

  /**
   * Execute a sequence of input steps.
   */
  async executeInputSequence(steps: InputStep[]): Promise<void> {
    for (const step of steps) {
      if (step.action === 'wait') {
        console.log(`[QEMU] Waiting ${step.ms}ms${step.comment ? ` (${step.comment})` : ''}`);
        await sleep(step.ms || 1000);
      } else if (step.action === 'key' && step.keys) {
        console.log(`[QEMU] Sending keys: ${step.keys.join('+')}${step.comment ? ` (${step.comment})` : ''}`);
        await this.sendKey(step.keys);
        await sleep(200);
      } else if (step.action === 'click' && step.x !== undefined && step.y !== undefined) {
        console.log(`[QEMU] Clicking (${step.x}, ${step.y})${step.comment ? ` (${step.comment})` : ''}`);
        await this.mouseClick(step.x, step.y, step.button as 'left' | 'right' ?? 'left');
        await sleep(200);
      }
    }
  }

  /**
   * Capture multiple screenshots at an interval.
   */
  async captureMultiple(
    scenarioId: string,
    count: number,
    intervalMs: number,
  ): Promise<Buffer[]> {
    const outDir = path.join(QEMU_CONFIG.screenshotDir, scenarioId, 'original');
    fs.mkdirSync(outDir, { recursive: true });

    const buffers: Buffer[] = [];
    for (let i = 0; i < count; i++) {
      const outPath = path.join(outDir, `capture-${String(i).padStart(2, '0')}.png`);
      console.log(`[QEMU] Capturing screenshot ${i + 1}/${count} → ${outPath}`);
      const buf = await this.captureScreenshot(outPath);
      buffers.push(buf);
      if (i < count - 1) {
        await sleep(intervalMs);
      }
    }
    return buffers;
  }

  /**
   * Wait for the VM desktop to be responsive.
   * Polls screendump until it returns a reasonably sized frame.
   */
  async waitForDesktop(timeoutMs = QEMU_CONFIG.bootTimeout): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    const tmpPath = '/tmp/generals-visual-oracle-probe.ppm';
    console.log('[QEMU] Waiting for desktop...');

    try {
      while (Date.now() < deadline) {
        try {
          await this.qmpCommand('screendump', { filename: tmpPath });
          await sleep(500);
          if (fs.existsSync(tmpPath)) {
            const stat = fs.statSync(tmpPath);
            if (stat.size > 100_000) {
              console.log('[QEMU] Desktop appears ready');
              return;
            }
          }
        } catch {
          // Not ready yet
        }
        await sleep(3000);
      }
      throw new Error(`Desktop did not become ready within ${timeoutMs}ms`);
    } finally {
      try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    }
  }

  /**
   * Reset the guest OS without restarting QEMU.
   */
  async resetGuest(): Promise<void> {
    console.log('[QEMU] Resetting guest OS...');
    await this.qmpCommand('system_reset');
    await this.waitForDesktop();
  }

  /**
   * Disconnect QMP without shutting down the VM.
   */
  disconnectQmp(): void {
    this.drainResponseQueue();
    this.qmpSocket?.destroy();
    this.qmpSocket = null;
    this.qmpReady = false;
    this.greetingReceived = false;
  }

  async shutdown(): Promise<void> {
    console.log('[QEMU] Shutting down VM...');
    try {
      await this.qmpCommand('system_powerdown');
      await sleep(2000);
    } catch {
      // Ignore errors during shutdown
    }

    this.drainResponseQueue();
    this.qmpSocket?.destroy();
    this.qmpSocket = null;
    this.greetingReceived = false;

    if (this.proc) {
      this.proc.kill('SIGTERM');
      await sleep(1000);
      if (!this.proc.killed) {
        this.proc.kill('SIGKILL');
      }
      this.proc = null;
    }

    if (fs.existsSync(QEMU_CONFIG.qmpSocket)) {
      fs.unlinkSync(QEMU_CONFIG.qmpSocket);
    }

    console.log('[QEMU] VM shut down');
  }
}

// ── PPM → PNG conversion ──

function ppmToPng(ppmData: Buffer): Buffer {
  let offset = 0;
  const magic = readLine(ppmData, offset);
  offset += magic.length + 1;
  if (magic.trim() !== 'P6') {
    throw new Error(`Expected PPM P6 format, got: ${magic.trim()}`);
  }

  let dimLine = readLine(ppmData, offset);
  offset += dimLine.length + 1;
  while (dimLine.startsWith('#')) {
    dimLine = readLine(ppmData, offset);
    offset += dimLine.length + 1;
  }

  const [width, height] = dimLine.trim().split(/\s+/).map(Number);

  const maxLine = readLine(ppmData, offset);
  offset += maxLine.length + 1;

  const rgbData = ppmData.subarray(offset);
  const expectedLen = width * height * 3;
  if (rgbData.length < expectedLen) {
    throw new Error(`Truncated PPM: expected ${expectedLen} RGB bytes, got ${rgbData.length}`);
  }

  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const srcIdx = (y * width + x) * 3;
      const dstIdx = (y * width + x) * 4;
      png.data[dstIdx + 0] = rgbData[srcIdx + 0]; // R
      png.data[dstIdx + 1] = rgbData[srcIdx + 1]; // G
      png.data[dstIdx + 2] = rgbData[srcIdx + 2]; // B
      png.data[dstIdx + 3] = 255;                  // A
    }
  }

  return PNG.sync.write(png);
}

function readLine(buf: Buffer, offset: number): string {
  let end = offset;
  while (end < buf.length && buf[end] !== 0x0a) end++;
  return buf.subarray(offset, end).toString('ascii');
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
