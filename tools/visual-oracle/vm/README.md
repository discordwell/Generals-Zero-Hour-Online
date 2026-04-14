# Visual Oracle — VM Setup

QEMU-based Windows VM for running original C&C Generals: Zero Hour.
Used to capture screenshots for parity comparison with the browser port.

## Architecture

```
Host (macOS ARM)
  └─ QEMU (TCG software emulation, i386)
       └─ Windows 10 / Win7 guest
            └─ C&C Generals: Zero Hour (DirectX 8)
```

QMP (QEMU Machine Protocol) over Unix socket provides:
- Keyboard input (`send-key`)
- Mouse input (USB-tablet absolute positioning + HMP mouse_button)
- Screenshot capture (`screendump` → PPM → PNG)
- Snapshot management (`savevm`/`loadvm` for instant restore)

## Prerequisites

```bash
brew install qemu    # Provides qemu-system-i386
```

## Quick Setup

### Option A: Clone from an existing Windows qcow2 (fastest)

If you have the Emperor BFD project with a Windows VM already set up:

```bash
bash tools/visual-oracle/vm/setup-vm.sh 1   # Auto-detects and clones
```

By default this creates a standalone qcow2 so the Generals VM does not depend on
another checkout's backing file. To intentionally create an overlay instead:

```bash
GENERALS_VM_CLONE_MODE=overlay bash tools/visual-oracle/vm/setup-vm.sh 1
```

If the base qcow2 lives somewhere else:

```bash
GENERALS_VM_BASE_IMAGE=/path/to/base.qcow2 bash tools/visual-oracle/vm/setup-vm.sh 1
```

### Option B: Fresh Windows install

1. Place a Windows 10 or Win7 ISO at `tools/visual-oracle/vm/windows.iso`
2. Run: `bash tools/visual-oracle/vm/setup-vm.sh 1`
3. Install Windows interactively

### Validate or Repair an Existing Disk

```bash
bash tools/visual-oracle/vm/setup-vm.sh check
GENERALS_VM_BASE_IMAGE=/path/to/base.qcow2 bash tools/visual-oracle/vm/setup-vm.sh repair
```

`repair` only updates qcow2 metadata to point at a real backing image. It cannot
recover a deleted backing image or flatten an overlay without the original base.

### Install Generals

```bash
bash tools/visual-oracle/vm/setup-vm.sh 2
```

Place Generals ISOs in the `vm/` directory. The script will detect them.
Swap CDs during install via QMP:

```bash
echo '{"execute":"qmp_capabilities"}' | nc -U /tmp/generals-zh-qmp.sock
echo '{"execute":"human-monitor-command","arguments":{"command-line":"change ide1-cd0 /path/to/disc2.iso"}}' | nc -U /tmp/generals-zh-qmp.sock
```

### Configure and Snapshot

```bash
bash tools/visual-oracle/vm/setup-vm.sh 3
```

1. Launch Generals Zero Hour in the VM
2. Set resolution to 800x600
3. Configure graphics settings
4. Create a snapshot for instant restore:

```bash
echo '{"execute":"human-monitor-command","arguments":{"command-line":"savevm desktop-ready"}}' | nc -U /tmp/generals-zh-qmp.sock
```

## Headless Operation

Once set up, run headless for automated screenshot capture:

```bash
bash tools/visual-oracle/vm/setup-vm.sh headless
```

Then use the oracle CLI:

```bash
cd tools/visual-oracle
npx tsx cli.ts screenshot           # Capture current screen
npx tsx cli.ts navigate             # Auto-navigate to gameplay
npx tsx cli.ts capture scenario.json # Execute scripted scenario
```

## DirectX in QEMU

C&C Generals uses DirectX 8. Under QEMU's software emulation (TCG on ARM Mac),
there's no GPU acceleration. Options:

1. **dgVoodoo2**: Wraps D3D8 → D3D11 WARP (software rendering). Works on Win7+.
   - Copy `DDraw.dll`, `D3D8.dll` from dgVoodoo2 to game directory
   - Set `OutputAPI = d3d11warp` in `dgVoodoo.conf`

2. **Native D3D8**: May work with `-vga vmware` (vmsvga) which provides
   basic 3D acceleration. Test first before adding wrappers.

3. **Wine on macOS**: Alternative to QEMU, but has focus management issues.

## Troubleshooting

- **Black screen after boot**: Try `-vga std` or `-vga cirrus`
- **Game crashes on launch**: Install dgVoodoo2 D3D8 wrapper
- **Mouse doesn't work in game**: Ensure `-usb -device usb-tablet` flags are present
- **Slow performance**: Expected — TCG on ARM Mac runs at ~3-5 FPS
  - This is fine for screenshot comparison (not trying to play in real-time)
- **Snapshot won't load**: Display adapter (`-vga`) must match what was used during save
- **Broken qcow2 backing chain**: Run `setup-vm.sh check`. If the backing file
  was moved, provide its current path with `GENERALS_VM_BASE_IMAGE` and run
  `setup-vm.sh repair`. If the backing file was deleted, rebuild from a real base
  image or a fresh Windows install; the overlay alone is not bootable.
