#!/usr/bin/env python3
"""Merge v6 LoRA GGUF into phi-4 Q4_K_M base GGUF → hme-arbiter-v6.gguf (f16).

llama-export-lora: base Q4_K_M + LoRA f16 → merged f16 GGUF (~28 GB)
"""
import os
import subprocess
import sys

BASE_GGUF   = "/home/jah/models/phi-4-Q4_K_M.gguf"
LORA_GGUF   = "/home/jah/models/hme-arbiter-v6-lora-f16.gguf"
OUTPUT_GGUF = "/home/jah/models/hme-arbiter-v6.gguf"
EXPORT_LORA = "/home/jah/tools/llama.cpp/build/bin/llama-export-lora"


if __name__ == "__main__":
    for path, label in [(BASE_GGUF, "base"), (LORA_GGUF, "lora"), (EXPORT_LORA, "export-lora")]:
        if not os.path.exists(path):
            print(f"ERROR: {label} not found: {path}")
            sys.exit(1)
    print(f"Merging LoRA into base GGUF → {OUTPUT_GGUF}")
    result = subprocess.run(
        [EXPORT_LORA, "-m", BASE_GGUF, "--lora", LORA_GGUF, "-o", OUTPUT_GGUF],
        check=False,
    )
    if result.returncode != 0:
        print(f"FAILED (rc={result.returncode})")
        sys.exit(1)
    size_gb = os.path.getsize(OUTPUT_GGUF) / 1e9
    print(f"\nDone. {OUTPUT_GGUF} ({size_gb:.1f} GB)")
    print("Next: update .env HME_ARBITER to the new path and remove HME_ARBITER_ADAPTER.")
