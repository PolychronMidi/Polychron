#!/usr/bin/env python3
"""Merge v6 LoRA adapter into microsoft/phi-4 and export to f16 GGUF.

Steps:
  1. Load base phi-4 (bf16) + v6 adapter (checkpoint-233)
  2. merge_and_unload()
  3. Save merged HF model to /tmp/hme-arbiter-v6-merged/
  4. convert_hf_to_gguf.py → f16 GGUF at /tmp/hme-arbiter-v6-f16.gguf
  5. Delete merged intermediate to reclaim disk

Lossless f16 per user preference — no q4_k_m quantization.
"""
import os
import shutil
import subprocess
import sys

BASE_MODEL   = "microsoft/phi-4"
ADAPTER_PATH = "/home/jah/Polychron/metrics/hme-arbiter-adapter-v6-phi4/checkpoint-233"
MERGED_PATH  = "/tmp/hme-arbiter-v6-merged"
GGUF_F16     = "/tmp/hme-arbiter-v6-f16.gguf"
LLAMA_CPP    = "/home/jah/tools/llama.cpp"
CONVERT      = f"{LLAMA_CPP}/convert_hf_to_gguf.py"
PHI4_HF_CACHE = "/home/jah/.cache/huggingface/hub/models--microsoft--phi-4"


def step1_merge_and_save():
    """Load base + adapter, merge in RAM, force-materialize tensors, drop HF
    cache from disk, THEN save merged model. This keeps peak disk usage to
    only the merged size (29 GB) instead of (phi-4 cache 28 GB + merged 29 GB).
    """
    print("Step 1: Merging v6 adapter into phi-4...")
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer
    from peft import PeftModel

    print(f"  Loading base: {BASE_MODEL} (bf16, forced into RAM — no mmap)")
    # low_cpu_mem_usage=False + explicit no mmap forces real RAM copy so we can
    # delete the underlying safetensors files without segfault.
    base = AutoModelForCausalLM.from_pretrained(
        BASE_MODEL,
        torch_dtype=torch.bfloat16,
        device_map="cpu",
        trust_remote_code=True,
        low_cpu_mem_usage=False,
    )
    # Force copy every parameter into fresh RAM-owned tensors (severs mmap).
    print("  Materializing base weights into RAM...")
    for p in base.parameters():
        p.data = p.data.clone()
    for b in base.buffers():
        b.data = b.data.clone()

    print(f"  Loading adapter: {ADAPTER_PATH}")
    model = PeftModel.from_pretrained(base, ADAPTER_PATH)
    print("  Merging...")
    merged = model.merge_and_unload()
    for p in merged.parameters():
        p.data = p.data.clone()

    # Save tokenizer from cache BEFORE we delete it.
    print("  Loading tokenizer into RAM...")
    tok = AutoTokenizer.from_pretrained(BASE_MODEL, trust_remote_code=True)

    # Now safe to drop HF cache — everything we need is in RAM.
    print(f"  Dropping phi-4 HF cache at {PHI4_HF_CACHE}")
    if os.path.isdir(PHI4_HF_CACHE):
        shutil.rmtree(PHI4_HF_CACHE)
    subprocess.run(["df", "-h", "/"], check=False)

    print(f"  Saving merged model to {MERGED_PATH}")
    os.makedirs(MERGED_PATH, exist_ok=True)
    merged.save_pretrained(MERGED_PATH, safe_serialization=True)
    tok.save_pretrained(MERGED_PATH)
    subprocess.run(["df", "-h", "/"], check=False)
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


def step3_cleanup():
    print(f"Step 3: Deleting merged intermediate at {MERGED_PATH}")
    if os.path.isdir(MERGED_PATH):
        shutil.rmtree(MERGED_PATH)
    print(f"  Step 3 done. Final GGUF at: {GGUF_F16}")


if __name__ == "__main__":
    step1_merge()
    step1b_drop_hf_cache()
    step2_convert()
    step3_cleanup()
    print("\nDone.")
    print("Next:")
    print(f"  llamacpp create hme-arbiter-v6 -f metrics/Modelfile-v6")
    print(f"  Update .env: HME_ARBITER_MODEL=hme-arbiter-v6")
