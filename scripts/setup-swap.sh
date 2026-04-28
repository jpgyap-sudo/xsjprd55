#!/usr/bin/env bash
# ============================================================
# Swap Setup for Low-Memory Droplets (1 GB RAM)
# Prevents OOM kills during Docker builds.
# ============================================================

set -e

SWAP_SIZE="2G"
SWAP_FILE="/swapfile"

echo "========================================"
echo "Setting up ${SWAP_SIZE} swap file"
echo "========================================"

if [ -f "$SWAP_FILE" ]; then
    echo "Swap file already exists. Skipping."
    exit 0
fi

fallocate -l $SWAP_SIZE $SWAP_FILE
chmod 600 $SWAP_FILE
mkswap $SWAP_FILE
swapon $SWAP_FILE

# Make persistent across reboots
if ! grep -q "$SWAP_FILE" /etc/fstab; then
    echo "$SWAP_FILE none swap sw 0 0" >> /etc/fstab
fi

echo "✅ Swap enabled:"
swapon --show
echo ""
echo "Free memory:"
free -h
