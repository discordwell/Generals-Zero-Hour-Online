#!/bin/bash
# Setup script for Windows 10 VM with C&C Generals: Zero Hour
# For visual oracle screenshot comparison with the browser port.
#
# Usage: bash tools/visual-oracle/vm/setup-vm.sh [step]
#   step 1: Create disk + install Windows 10 (interactive, ~45 min)
#   step 2: Install C&C Generals + Zero Hour from ISOs (interactive, ~15 min)
#   step 3: Configure game settings + create snapshot (semi-automated)
#   (no arg): Show usage

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"
DISK_IMAGE="$SCRIPT_DIR/generals-win10.qcow2"
QMP_SOCK="/tmp/generals-zh-qmp.sock"
DISK_SIZE="30G"
RAM="4G"
VNC_DISPLAY=":1"

# Check if Emperor BFD project has a Win10 image we can clone
EMPEROR_WIN10="$HOME/Projects/emperorbfdune/tools/visual-oracle/vm/emperor-win10.qcow2"
EMPEROR_WIN7="$HOME/Projects/emperorbfdune/tools/visual-oracle/vm/emperor-win7.qcow2"
CLONE_MODE="${GENERALS_VM_CLONE_MODE:-standalone}"

check_prereqs() {
    echo "=== Checking prerequisites ==="
    command -v qemu-system-i386 &>/dev/null || { echo "Error: qemu not found. Run: brew install qemu"; exit 1; }
    command -v qemu-img &>/dev/null || { echo "Error: qemu-img not found"; exit 1; }
    echo "[OK] QEMU found: $(qemu-system-i386 --version | head -1)"
}

validate_disk_image() {
    if [ ! -f "$DISK_IMAGE" ]; then
        echo "Error: Disk image not found: $DISK_IMAGE"
        echo "Run: bash tools/visual-oracle/vm/setup-vm.sh create"
        return 1
    fi

    if qemu-img info --backing-chain "$DISK_IMAGE" >/dev/null 2>&1; then
        return 0
    fi

    echo "Error: Disk image has a broken qcow2 backing chain:"
    qemu-img info --backing-chain "$DISK_IMAGE" 2>&1 || true
    echo ""
    echo "This overlay cannot boot until the real backing image is restored."
    echo "If you have the base image, run:"
    echo "  GENERALS_VM_BASE_IMAGE=/path/to/base.qcow2 bash tools/visual-oracle/vm/setup-vm.sh repair"
    return 1
}

clone_base_image() {
    local base_image="$1"
    local label="$2"

    echo "Found $label image."
    echo "  Source: $base_image"
    echo "  Target: $DISK_IMAGE"

    case "$CLONE_MODE" in
        standalone)
            qemu-img convert -O qcow2 "$base_image" "$DISK_IMAGE"
            echo "Created standalone qcow2 clone."
            ;;
        overlay)
            qemu-img create -f qcow2 -b "$base_image" -F qcow2 "$DISK_IMAGE"
            echo "Created qcow2 overlay."
            echo "Warning: this disk will not boot if the backing image is moved or deleted."
            ;;
        *)
            echo "Error: GENERALS_VM_CLONE_MODE must be 'standalone' or 'overlay' (got '$CLONE_MODE')."
            return 1
            ;;
    esac
}

repair_backing() {
    echo "=== Repair VM backing chain ==="
    if [ ! -f "$DISK_IMAGE" ]; then
        echo "Error: Disk image not found: $DISK_IMAGE"
        return 1
    fi

    if qemu-img info --backing-chain "$DISK_IMAGE" >/dev/null 2>&1; then
        echo "Disk backing chain is already valid."
        qemu-img info --backing-chain "$DISK_IMAGE"
        return 0
    fi

    local base_image="${GENERALS_VM_BASE_IMAGE:-}"
    if [ -z "$base_image" ]; then
        echo "Error: GENERALS_VM_BASE_IMAGE is required to repair this overlay."
        echo "The missing backing image recorded in the overlay is:"
        qemu-img info "$DISK_IMAGE" 2>/dev/null | sed -n 's/^backing file: /  /p' || true
        return 1
    fi
    if [ ! -f "$base_image" ]; then
        echo "Error: GENERALS_VM_BASE_IMAGE does not exist: $base_image"
        return 1
    fi

    qemu-img rebase -u -b "$base_image" -F qcow2 "$DISK_IMAGE"
    validate_disk_image
    echo "Rebased overlay onto: $base_image"
}

step1_create_vm() {
    echo "=== Step 1: Create Windows VM ==="

    if [ -f "$DISK_IMAGE" ]; then
        echo "Disk image already exists: $DISK_IMAGE"
        validate_disk_image || true
        echo "Move it aside first to reinstall; this script will not delete existing VM state."
        return 1
    fi

    # Option A: Clone from Emperor BFD project
    local base_win10="${GENERALS_VM_BASE_IMAGE:-$EMPEROR_WIN10}"
    if [ -f "$base_win10" ]; then
        clone_base_image "$base_win10" "Windows 10 base"
        return 0
    fi

    if [ -f "$EMPEROR_WIN7" ]; then
        clone_base_image "$EMPEROR_WIN7" "Windows 7 base"
        return 0
    fi

    # Option B: Fresh install from ISO
    echo "No existing Windows VM found."
    echo ""
    echo "To create a fresh VM, provide a Windows ISO:"
    echo "  1. Download Windows 10 LTSC or Win7 SP1 ISO"
    echo "  2. Place it at: $SCRIPT_DIR/windows.iso"
    echo "  3. Re-run this step"
    echo ""

    local WIN_ISO="$SCRIPT_DIR/windows.iso"
    if [ ! -f "$WIN_ISO" ]; then
        echo "No ISO found at $WIN_ISO"
        echo ""
        echo "Alternative: If you have the Emperor BFD project with a Windows VM,"
        echo "copy or symlink it:"
        echo "  ln -s ~/Projects/emperorbfdune/tools/visual-oracle/vm/emperor-win10.qcow2 \\"
        echo "    $EMPEROR_WIN10"
        return 1
    fi

    echo "Creating $DISK_SIZE QCOW2 disk..."
    qemu-img create -f qcow2 "$DISK_IMAGE" "$DISK_SIZE"

    echo "Starting QEMU for Windows installation..."
    echo "Install Windows, then shut down the VM."
    echo ""

    qemu-system-i386 \
        -hda "$DISK_IMAGE" \
        -cdrom "$WIN_ISO" \
        -m "$RAM" \
        -vga vmware \
        -accel tcg \
        -cpu Conroe \
        -smp 2 \
        -usb -device usb-tablet \
        -display cocoa \
        -boot d \
        -qmp unix:"$QMP_SOCK",server,nowait \
        -name "Win10 Install - Generals"
}

step2_install_generals() {
    echo "=== Step 2: Install C&C Generals + Zero Hour ==="
    validate_disk_image
    echo ""
    echo "You need Generals + Zero Hour installation media."
    echo "Options:"
    echo "  A) CD images (.iso files) — place in $SCRIPT_DIR/"
    echo "  B) Origin/EA App installer (.exe) — copy to VM"
    echo "  C) Already installed — skip to step 3"
    echo ""

    # Look for ISOs
    local GENERALS_ISO=""
    local ZH_ISO=""
    for f in "$SCRIPT_DIR"/*.iso "$PROJECT_DIR"/*.iso; do
        [ -f "$f" ] || continue
        case "$(basename "$f" | tr '[:upper:]' '[:lower:]')" in
            *generals*) GENERALS_ISO="$f" ;;
            *zero*hour* | *zh*) ZH_ISO="$f" ;;
        esac
    done

    local CDROM_ARG=""
    if [ -n "$GENERALS_ISO" ]; then
        echo "Found Generals ISO: $GENERALS_ISO"
        CDROM_ARG="-cdrom $GENERALS_ISO"
    elif [ -n "$ZH_ISO" ]; then
        echo "Found Zero Hour ISO: $ZH_ISO"
        CDROM_ARG="-cdrom $ZH_ISO"
    fi

    echo "Starting VM for game installation..."
    echo ""
    echo "QMP socket: $QMP_SOCK"
    echo "To swap CDs during install:"
    echo "  echo '{\"execute\":\"qmp_capabilities\"}' | nc -U $QMP_SOCK"
    echo "  echo '{\"execute\":\"human-monitor-command\",\"arguments\":{\"command-line\":\"change ide1-cd0 /path/to/disc2.iso\"}}' | nc -U $QMP_SOCK"
    echo ""
    echo "VNC available at localhost:$(( ${VNC_DISPLAY#:} + 5900 ))"
    echo ""

    # shellcheck disable=SC2086
    qemu-system-i386 \
        -hda "$DISK_IMAGE" \
        ${CDROM_ARG} \
        -m "$RAM" \
        -vga vmware \
        -accel tcg \
        -cpu Conroe \
        -smp 2 \
        -usb -device usb-tablet \
        -display cocoa \
        -vnc "$VNC_DISPLAY" \
        -qmp unix:"$QMP_SOCK",server,nowait \
        -device intel-hda -device hda-duplex \
        -netdev user,id=net0 -device e1000,netdev=net0 \
        -name "Generals Install"
}

step3_configure() {
    echo "=== Step 3: Configure + Create Snapshot ==="
    validate_disk_image
    echo ""
    echo "Starting VM. Once booted:"
    echo ""
    echo "  1. Launch Generals Zero Hour"
    echo "  2. Set resolution to 800x600"
    echo "  3. Set graphics quality as desired"
    echo "  4. Start a skirmish game (any map, USA vs Easy AI)"
    echo "  5. Once in-game, DO NOT close — we'll create a snapshot"
    echo ""
    echo "When ready, create snapshot from another terminal:"
    echo "  echo '{\"execute\":\"qmp_capabilities\"}' | nc -U $QMP_SOCK"
    echo "  echo '{\"execute\":\"human-monitor-command\",\"arguments\":{\"command-line\":\"savevm desktop-ready\"}}' | nc -U $QMP_SOCK"
    echo ""
    echo "Or for an in-game snapshot:"
    echo "  echo '{\"execute\":\"human-monitor-command\",\"arguments\":{\"command-line\":\"savevm ingame-ready\"}}' | nc -U $QMP_SOCK"
    echo ""

    qemu-system-i386 \
        -hda "$DISK_IMAGE" \
        -m "$RAM" \
        -vga vmware \
        -accel tcg \
        -cpu Conroe \
        -smp 2 \
        -usb -device usb-tablet \
        -display cocoa \
        -vnc "$VNC_DISPLAY" \
        -qmp unix:"$QMP_SOCK",server,nowait \
        -device intel-hda -device hda-duplex \
        -netdev user,id=net0 -device e1000,netdev=net0 \
        -name "Generals Config"
}

headless() {
    echo "=== Starting Headless VM ==="
    validate_disk_image
    echo "QMP socket: $QMP_SOCK"
    echo "VNC: localhost:$(( ${VNC_DISPLAY#:} + 5900 ))"
    echo ""

    qemu-system-i386 \
        -hda "$DISK_IMAGE" \
        -m "$RAM" \
        -vga vmware \
        -accel tcg \
        -cpu Conroe \
        -smp 2 \
        -usb -device usb-tablet \
        -vnc "$VNC_DISPLAY" \
        -qmp unix:"$QMP_SOCK",server,nowait \
        -device intel-hda -device hda-duplex \
        -netdev user,id=net0 -device e1000,netdev=net0 \
        -name "Generals ZH (headless)"
}

# Main
check_prereqs

STEP="${1:-help}"
case "$STEP" in
    1|create)    step1_create_vm ;;
    2|install)   step2_install_generals ;;
    3|configure) step3_configure ;;
    check)       validate_disk_image && qemu-img info --backing-chain "$DISK_IMAGE" ;;
    repair)      repair_backing ;;
    headless)    headless ;;
    help|*)
        echo "Visual Oracle — VM Setup for C&C Generals: Zero Hour"
        echo ""
        echo "Usage: bash $(basename "$0") <step>"
        echo ""
        echo "Steps:"
        echo "  1 (create)     Create Windows VM disk image"
        echo "  2 (install)    Install Generals + Zero Hour in VM"
        echo "  3 (configure)  Configure game settings + create snapshot"
        echo "  check          Validate the qcow2 backing chain"
        echo "  repair         Rebase a broken overlay using GENERALS_VM_BASE_IMAGE"
        echo "  headless       Start VM in headless mode for oracle use"
        echo ""
        echo "Disk image: $DISK_IMAGE"
        echo "QMP socket: $QMP_SOCK"
        ;;
esac
