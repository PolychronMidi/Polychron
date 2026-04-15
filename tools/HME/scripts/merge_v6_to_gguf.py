#!/usr/bin/env python3
"""Merge v6 LoRA GGUF into phi-4 Q4_K_M base GGUF → single hme-arbiter-v6.gguf.

Steps:
  1. llama-export-lora: base Q4_K_M + LoRA f16 → merged f16 GGUF (~28 GB tmp)
  2. llama-quantize:    f16 GGUF → Q4_K_M GGUF (~9 GB, final)
  3. Delete f16 intermediate to reclaim disk
"""
import os
import subprocess
import sys

BASE_GGUF   = "/home/jah/models/phi-4-Q4_K_M.gguf"
LORA_GGUF   = "/home/jah/models/hme-arbiter-v6-lora-f16.gguf"
MERGED_F16  = "/tmp/hme-arbiter-v6-f16.gguf"
OUTPUT_GGUF = "/home/jah/models/hme-arbiter-v6.gguf"
EXPORT_LORA = "/home/jah/tools/llama.cpp/build/bin/llama-export-lora"
QUANTIZE    = "/home/jah/tools/llama-cpp-vulkan/llama-b8797/llama-quantize"


def step1_merge():
    print(f"Step 1: Merging LoRA into base GGUF → {MERGED_F16}")
    print(f"  base: {BASE_GGUF}")
    print(f"  lora: {LORA_GGUF}")
    result = subprocess.run(
        [EXPORT_LORA, "-m", BASE_GGUF, "--lora", LORA_GGUF, "-o", MERGED_F16],
        check=False,
    )
    if result.returncode != 0:
        print(f"  FAILED (rc={result.returncode})")
        sys.exit(1)
    size_gb = os.path.getsize(MERGED_F16) / 1e9
    print(f"  Step 1 done. f16 GGUF: {size_gb:.1f} GB")


def step2_quantize():
    print(f"Step 2: Quantizing f16 → Q4_K_M at {OUTPUT_GGUF}")
    result = subprocess.run(
        [QUANTIZE, MERGED_F16, OUTPUT_GGUF, "Q4_K_M"],
        check=False,
    )
    if result.returncode != 0:
        print(f"  FAILED (rc={result.returncode})")
        sys.exit(1)
    size_gb = os.path.getsize(OUTPUT_GGUF) / 1e9
    print(f"  Step 2 done. Q4_K_M GGUF: {size_gb:.1f} GB")


def step3_cleanup():
    print(f"Step 3: Deleting f16 intermediate at {MERGED_F16}")
    if os.path.exists(MERGED_F16):
        os.remove(MERGED_F16)
    print("  Step 3 done.")


if __name__ == "__main__":
    for path, label in [(BASE_GGUF, "base"), (LORA_GGUF, "lora"), (EXPORT_LORA, "export-lora"), (QUANTIZE, "quantize")]:
        if not os.path.exists(path):
            print(f"ERROR: {label} not found: {path}")
            sys.exit(1)
    step1_merge()
    step2_quantize()
    step3_cleanup()
    print(f"\nDone. Final model: {OUTPUT_GGUF}")
    print("Next: update .env HME_ARBITER to the new path and remove HME_ARBITER_ADAPTER.")
