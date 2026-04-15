#!/usr/bin/env python3
"""Merge v5 LoRA adapter into Qwen2.5-3B-Instruct and export to GGUF.

Steps:
  1. Load base model + adapter
  2. merge_and_unload()
  3. Save merged HF model to /tmp/hme-arbiter-v5-merged/
  4. convert_hf_to_gguf.py → f16 GGUF
  5. quantize → q4_k_m GGUF at metrics/hme-arbiter-v5.gguf
"""
import subprocess
import sys
import os

BASE_MODEL = "Qwen/Qwen2.5-3B-Instruct"
ADAPTER_PATH = "/home/jah/Polychron/metrics/hme-arbiter-adapter-v5"
MERGED_PATH = "/tmp/hme-arbiter-v5-merged"
GGUF_F16 = "/tmp/hme-arbiter-v5-f16.gguf"
GGUF_OUT = "/home/jah/Polychron/metrics/hme-arbiter-v5.gguf"
LLAMA_CPP = "/home/jah/tools/llama.cpp"
QUANTIZE = f"{LLAMA_CPP}/tools/quantize"
CONVERT = f"{LLAMA_CPP}/convert_hf_to_gguf.py"


def step1_merge():
    print("Step 1: Merging adapter into base model...")
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer
    from peft import PeftModel

    print(f"  Loading base: {BASE_MODEL}")
    base = AutoModelForCausalLM.from_pretrained(
        BASE_MODEL,
        torch_dtype=torch.float16,
        device_map="cpu",
        trust_remote_code=True,
    )
    print(f"  Loading adapter: {ADAPTER_PATH}")
    model = PeftModel.from_pretrained(base, ADAPTER_PATH)
    print("  Merging...")
    merged = model.merge_and_unload()

    print(f"  Saving merged model to {MERGED_PATH}")
    os.makedirs(MERGED_PATH, exist_ok=True)
    merged.save_pretrained(MERGED_PATH)

    print("  Saving tokenizer...")
    tok = AutoTokenizer.from_pretrained(BASE_MODEL, trust_remote_code=True)
    tok.save_pretrained(MERGED_PATH)
    print("  Step 1 done.")


def step2_convert():
    print(f"Step 2: Converting HF → GGUF f16 at {GGUF_F16}")
    result = subprocess.run(
        [sys.executable, CONVERT, MERGED_PATH, "--outfile", GGUF_F16, "--outtype", "f16"],
        capture_output=False,
    )
    if result.returncode != 0:
        print(f"  FAILED (rc={result.returncode})")
        sys.exit(1)
    print("  Step 2 done.")


def step3_quantize():
    print(f"Step 3: Quantizing f16 → q4_k_m at {GGUF_OUT}")
    result = subprocess.run(
        [QUANTIZE, GGUF_F16, GGUF_OUT, "q4_k_m"],
        capture_output=False,
    )
    if result.returncode != 0:
        print(f"  FAILED (rc={result.returncode})")
        sys.exit(1)
    print(f"  Step 3 done. Output: {GGUF_OUT}")


if __name__ == "__main__":
    step1_merge()
    step2_convert()
    step3_quantize()
    print("\nDone. Run: ollama create hme-arbiter -f /path/to/Modelfile")
