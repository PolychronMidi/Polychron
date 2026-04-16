#!/bin/bash
# Setup tmpfs overflow buffers for llama.cpp GGUF fast-reload.
#
# Creates RAM-backed buffers at /mnt/llamacpp-buffer-gpu{0,1}.
# When llama-server restarts, it can mmap the GGUF from the RAM copy
# (~instant) instead of re-reading from SSD (~seconds–minutes for 18 GB).
#
# Usage:
#   sudo bash tools/HME/scripts/setup_llamacpp_buffers.sh setup    # create mounts
#   sudo bash tools/HME/scripts/setup_llamacpp_buffers.sh warm     # copy GGUFs in
#   sudo bash tools/HME/scripts/setup_llamacpp_buffers.sh teardown # unmount + remove
#   sudo bash tools/HME/scripts/setup_llamacpp_buffers.sh status   # check mounts
#
# Topology matches llamacpp_supervisor + llamacpp-arbiter/coder.service:
#   GPU0 (Vulkan1) = arbiter = phi-4-Q4_K_M.gguf (~9 GB) + v6 LoRA (~85 MB)
#   GPU1 (Vulkan2) = coder   = qwen3-coder-30b-Q4_K_M.gguf (~18 GB)
#
# BUFFER_SIZE must be >= the largest GGUF you plan to warm. Default 20 GB
# per mount covers the 18 GB coder + headroom.

set -euo pipefail

BUFFER_SIZE="${LLAMACPP_BUFFER_SIZE:-20G}"
GPU0_MOUNT="/mnt/llamacpp-buffer-gpu0"
GPU1_MOUNT="/mnt/llamacpp-buffer-gpu1"
MODELS_DIR="${HME_MODELS_DIR:-$HOME/models}"
LORA_DIR="${HME_LORA_DIR:-$HOME/Polychron/metrics}"

# Instance topology: which GGUF(s) each buffer mirrors.
#   arbiter on GPU0 → phi-4 + v6 LoRA
#   coder   on GPU1 → qwen3-coder-30b
ARBITER_MODEL="${HME_ARBITER_GGUF:-$MODELS_DIR/phi-4-Q4_K_M.gguf}"
ARBITER_LORA="${HME_ARBITER_LORA:-$LORA_DIR/hme-arbiter.gguf}"
CODER_MODEL="${HME_CODER_GGUF:-$MODELS_DIR/qwen3-coder-30b-Q4_K_M.gguf}"

case "${1:-status}" in
  setup)
    echo "Creating ${BUFFER_SIZE} tmpfs buffers..."
    for mnt in "$GPU0_MOUNT" "$GPU1_MOUNT"; do
      mkdir -p "$mnt"
      if mountpoint -q "$mnt" 2>/dev/null; then
        echo "  $mnt already mounted"
      else
        mount -t tmpfs -o size="$BUFFER_SIZE",noatime,mode=0755 tmpfs "$mnt"
        echo "  $mnt mounted (${BUFFER_SIZE} tmpfs)"
      fi
    done
    echo "Done. Run '$0 warm' to populate with GGUF files."
    ;;

  warm)
    echo "Warming buffers with GGUF files..."
    # GPU0 (arbiter) → phi-4 + v6 LoRA
    if mountpoint -q "$GPU0_MOUNT" 2>/dev/null; then
      for src in "$ARBITER_MODEL" "$ARBITER_LORA"; do
        if [ ! -f "$src" ]; then
          echo "  SKIP: source missing: $src"
          continue
        fi
        dst="$GPU0_MOUNT/$(basename "$src")"
        if [ -f "$dst" ]; then
          src_size=$(stat -c%s "$src")
          dst_size=$(stat -c%s "$dst")
          if [ "$src_size" = "$dst_size" ]; then
            echo "  arbiter → $GPU0_MOUNT: $(basename "$src") already warm ($(numfmt --to=iec $dst_size))"
            continue
          fi
        fi
        src_size=$(stat -c%s "$src")
        buf_avail=$(df -B1 "$GPU0_MOUNT" | tail -1 | awk '{print $4}')
        if [ "$src_size" -gt "$buf_avail" ]; then
          echo "  SKIP: $(basename "$src") $(numfmt --to=iec $src_size) > buffer avail $(numfmt --to=iec $buf_avail)"
          echo "  NOTE: increase LLAMACPP_BUFFER_SIZE env var (currently $BUFFER_SIZE)."
          continue
        fi
        echo "  Copying $(basename "$src") ($(numfmt --to=iec $src_size)) → $GPU0_MOUNT..."
        cp "$src" "$dst"
      done
    else
      echo "  SKIP: $GPU0_MOUNT not mounted (run 'setup' first)"
    fi

    # GPU1 (coder) → qwen3-coder-30b
    if mountpoint -q "$GPU1_MOUNT" 2>/dev/null; then
      if [ -f "$CODER_MODEL" ]; then
        dst="$GPU1_MOUNT/$(basename "$CODER_MODEL")"
        if [ -f "$dst" ]; then
          src_size=$(stat -c%s "$CODER_MODEL")
          dst_size=$(stat -c%s "$dst")
          if [ "$src_size" = "$dst_size" ]; then
            echo "  coder → $GPU1_MOUNT: $(basename "$CODER_MODEL") already warm ($(numfmt --to=iec $dst_size))"
          else
            echo "  Re-copying $(basename "$CODER_MODEL") (size changed)..."
            cp "$CODER_MODEL" "$dst"
          fi
        else
          src_size=$(stat -c%s "$CODER_MODEL")
          buf_avail=$(df -B1 "$GPU1_MOUNT" | tail -1 | awk '{print $4}')
          if [ "$src_size" -gt "$buf_avail" ]; then
            echo "  SKIP: $(basename "$CODER_MODEL") $(numfmt --to=iec $src_size) > buffer avail $(numfmt --to=iec $buf_avail)"
            echo "  NOTE: increase LLAMACPP_BUFFER_SIZE env var (currently $BUFFER_SIZE)."
          else
            echo "  Copying $(basename "$CODER_MODEL") ($(numfmt --to=iec $src_size)) → $GPU1_MOUNT..."
            cp "$CODER_MODEL" "$dst"
          fi
        fi
      else
        echo "  SKIP: coder model missing: $CODER_MODEL"
      fi
    else
      echo "  SKIP: $GPU1_MOUNT not mounted (run 'setup' first)"
    fi
    echo "Done. Point llama-server at these tmpfs paths via HME_ARBITER_GGUF/HME_CODER_GGUF."
    ;;

  teardown)
    echo "Tearing down buffers..."
    for mnt in "$GPU0_MOUNT" "$GPU1_MOUNT"; do
      if mountpoint -q "$mnt" 2>/dev/null; then
        umount "$mnt"
        echo "  $mnt unmounted"
      fi
      if [ -d "$mnt" ]; then
        rmdir "$mnt" 2>/dev/null || true
      fi
    done
    echo "Done."
    ;;

  status)
    echo "llama.cpp buffer status:"
    for mnt in "$GPU0_MOUNT" "$GPU1_MOUNT"; do
      if mountpoint -q "$mnt" 2>/dev/null; then
        used=$(df -h "$mnt" | tail -1 | awk '{print $3}')
        total=$(df -h "$mnt" | tail -1 | awk '{print $2}')
        files=$(ls "$mnt" 2>/dev/null | wc -l)
        echo "  $mnt: MOUNTED (${used}/${total} used, $files files)"
        ls -lh "$mnt" 2>/dev/null | tail -n +2 | awk '{printf "    %s %s\n", $5, $9}'
      else
        echo "  $mnt: NOT MOUNTED"
      fi
    done
    ;;

  *)
    echo "Usage: $0 {setup|warm|teardown|status}"
    exit 1
    ;;
esac
