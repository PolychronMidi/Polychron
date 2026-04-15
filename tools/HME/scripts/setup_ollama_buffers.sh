#!/bin/bash
# Setup tmpfs overflow buffers for Ollama GPU model fast-reload.
#
# Creates 2GB RAM-backed buffers at /mnt/ollama-buffer-gpu{0,1}.
# When a model gets evicted and needs reloading, Ollama can reload from
# the RAM copy (~instant) instead of SSD (~seconds).
#
# Usage:
#   sudo bash tools/HME/scripts/setup_ollama_buffers.sh setup   # create + populate
#   sudo bash tools/HME/scripts/setup_ollama_buffers.sh teardown # unmount + remove
#   sudo bash tools/HME/scripts/setup_ollama_buffers.sh status   # check mounts
#
# After setup, run 'warm' to copy model blobs into the buffers.

set -euo pipefail

BUFFER_SIZE="2G"
GPU0_MOUNT="/mnt/ollama-buffer-gpu0"
GPU1_MOUNT="/mnt/ollama-buffer-gpu1"
OLLAMA_MODELS="${OLLAMA_MODELS:-$HOME/.ollama/models}"

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
    echo "Done. Run '$0 warm' to populate with model blobs."
    ;;

  warm)
    echo "Warming buffers with model blobs..."
    # Find the blob SHA for each model via Ollama manifest
    for port_mount in "11434:$GPU0_MOUNT" "11435:$GPU1_MOUNT"; do
      port="${port_mount%%:*}"
      mnt="${port_mount##*:}"
      if ! mountpoint -q "$mnt" 2>/dev/null; then
        echo "  SKIP: $mnt not mounted (run 'setup' first)"
        continue
      fi
      # Get model name from running instance
      model=$(curl -s "http://localhost:$port/api/ps" 2>/dev/null | \
              python3 -c "import sys,json; d=json.load(sys.stdin); print(d['models'][0]['name'])" 2>/dev/null || echo "")
      if [ -z "$model" ]; then
        echo "  SKIP: port $port unreachable or no model loaded"
        continue
      fi
      # Find the model's blob file (largest file = weights)
      manifest_path="$OLLAMA_MODELS/manifests/registry.ollama.ai/library/${model%%:*}/${model##*:}"
      if [ ! -f "$manifest_path" ]; then
        echo "  SKIP: manifest not found for $model at $manifest_path"
        continue
      fi
      # Extract the weights layer SHA (largest layer)
      blob_sha=$(python3 -c "
import json
with open('$manifest_path') as f:
    m = json.load(f)
layers = sorted(m.get('layers', []), key=lambda l: l.get('size', 0), reverse=True)
if layers:
    print(layers[0]['digest'].replace(':', '-'))
" 2>/dev/null || echo "")
      if [ -z "$blob_sha" ]; then
        echo "  SKIP: could not parse manifest for $model"
        continue
      fi
      blob_src="$OLLAMA_MODELS/blobs/$blob_sha"
      blob_dst="$mnt/$blob_sha"
      if [ -f "$blob_dst" ]; then
        src_size=$(stat -c%s "$blob_src" 2>/dev/null || echo 0)
        dst_size=$(stat -c%s "$blob_dst" 2>/dev/null || echo 0)
        if [ "$src_size" = "$dst_size" ]; then
          echo "  $model → $mnt (already warm, $(numfmt --to=iec $dst_size))"
          continue
        fi
      fi
      blob_size=$(stat -c%s "$blob_src" 2>/dev/null || echo 0)
      buf_avail=$(df -B1 "$mnt" | tail -1 | awk '{print $4}')
      if [ "$blob_size" -gt "$buf_avail" ]; then
        echo "  SKIP: $model blob $(numfmt --to=iec $blob_size) > buffer avail $(numfmt --to=iec $buf_avail)"
        echo "  NOTE: 2GB buffer too small for full model blob. Buffer is useful for KV cache overflow,"
        echo "        context snapshots, or partial model layers. Consider increasing BUFFER_SIZE."
        continue
      fi
      echo "  Copying $model blob ($(numfmt --to=iec $blob_size)) → $mnt..."
      cp "$blob_src" "$blob_dst"
      echo "  Done: $model warmed in $mnt"
    done
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
    echo "Ollama buffer status:"
    for mnt in "$GPU0_MOUNT" "$GPU1_MOUNT"; do
      if mountpoint -q "$mnt" 2>/dev/null; then
        used=$(df -h "$mnt" | tail -1 | awk '{print $3}')
        total=$(df -h "$mnt" | tail -1 | awk '{print $2}')
        files=$(ls "$mnt" 2>/dev/null | wc -l)
        echo "  $mnt: MOUNTED (${used}/${total} used, $files files)"
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
