#!/usr/bin/env python3
"""H10: QLoRA fine-tune scaffold for the HME arbiter (qwen3:4b).

This is SCAFFOLDING — the actual training requires `unsloth` or `axolotl`
plus a GPU with enough VRAM for the chosen base model. This script:

  1. Exports the project KB as a JSONL training corpus
  2. Writes a training config file (axolotl-compatible)
  3. Produces a shell command to invoke the trainer
  4. Explains what the next steps are

The motivation: the HME arbiter (qwen3:4b) is a generic 4B CPU model.
It's fast but produces generic JSON plans that are mostly redundant with
keyword extraction. A domain-specific fine-tune on Polychron's KB +
session narratives would produce an arbiter that:
  - Speaks the project's vocabulary natively (crossLayer, hypermeta,
    coupling matrix, regime classifier, etc.)
  - Knows which subsystems exist and what they contain
  - Proposes search terms that match the actual codebase's naming
  - Understands architectural constraints (firewall ports, load order,
    L0 channel discipline)

Expected quality leap: arbiter plans become useful enough to re-enable
arbiter routing in `explore` mode (currently skipped for speed because
keyword extraction matches generic arbiter output).

Prerequisites for real training:
  pip install unsloth bitsandbytes accelerate peft transformers datasets
  GPU with >= 6GB VRAM (8GB recommended)
  Base model: Qwen/Qwen2.5-4B-Instruct or compatible

Usage:
    python3 tools/HME/scripts/finetune-arbiter.py --export   # write corpus
    python3 tools/HME/scripts/finetune-arbiter.py --config   # write training config
    python3 tools/HME/scripts/finetune-arbiter.py --plan     # show training plan
"""
import json
import os
import sys
import time
import urllib.request

_PROJECT = os.environ.get("PROJECT_ROOT") or os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "..")
)
_CORPUS = os.path.join(_PROJECT, "tools", "models", "training", "hme-arbiter-corpus.jsonl")
_CONFIG = os.path.join(_PROJECT, "tools", "models", "training", "hme-arbiter-finetune.yaml")
_SHIM_URL = "http://127.0.0.1:9098/rag"


def _query(method: str, **kwargs) -> list:
    payload = json.dumps({
        "engine": "project", "method": method, "kwargs": kwargs,
    }).encode()
    try:
        req = urllib.request.Request(_SHIM_URL, data=payload,
                                     headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read()).get("result", []) or []
    except Exception as e:
        sys.stderr.write(f"shim error: {e}\n")
        return []


def export_corpus() -> int:
    """Export project KB as JSONL training examples.
    Each example: {"instruction": "research plan for X", "input": "question",
                   "output": "JSON plan"}
    """
    entries = _query("list_knowledge")
    if not entries:
        sys.stderr.write("no KB entries — shim down or KB empty\n")
        return 2
    examples = []
    for e in entries:
        title = e.get("title", "")
        content = e.get("content", "")
        if not title or not content:
            continue
        # Turn each KB entry into 2-3 training examples
        # 1. Definition: "what is X" → title + content
        examples.append({
            "instruction": "Explain this module/concept in the Polychron codebase.",
            "input": f"What is {title.split(' — ')[0].split(':')[0]}?",
            "output": content,
        })
        # 2. Search plan: "how do I research X" → search terms
        identifiers = [w for w in content.split() if "_" in w or
                       (w and w[0].islower() and any(c.isupper() for c in w))]
        if identifiers:
            plan = {
                "terms": identifiers[:4],
                "grep_patterns": identifiers[:3],
                "directories": ["src/"],
            }
            examples.append({
                "instruction": (
                    "Output a JSON research plan for this question about the Polychron "
                    "codebase. Format: {terms, grep_patterns, glob_patterns, directories}. "
                    "Output ONLY valid JSON."
                ),
                "input": f"How do I find {title.split(' — ')[0][:60]}?",
                "output": json.dumps(plan),
            })
    os.makedirs(os.path.dirname(_CORPUS), exist_ok=True)
    with open(_CORPUS, "w") as f:
        for ex in examples:
            f.write(json.dumps(ex) + "\n")
    print(f"Corpus written: {_CORPUS}")
    print(f"  {len(examples)} training examples from {len(entries)} KB entries")
    return 0


def write_config() -> int:
    """Write an axolotl-compatible QLoRA training config."""
    config = """# HME arbiter QLoRA fine-tune config (H10 scaffold)
# Base model: Qwen/Qwen2.5-4B-Instruct
# Target adapter: HME arbiter specialized for Polychron KB research planning

base_model: Qwen/Qwen2.5-4B-Instruct
model_type: AutoModelForCausalLM
tokenizer_type: AutoTokenizer

load_in_4bit: true
strict: false

datasets:
  - path: tools/models/training/hme-arbiter-corpus.jsonl
    type: alpaca
    field_instruction: instruction
    field_input: input
    field_output: output

dataset_prepared_path: last_run_prepared
val_set_size: 0.05
output_dir: ./lora-out-hme-arbiter

sequence_len: 1024
sample_packing: false
pad_to_sequence_len: false

adapter: qlora
lora_r: 16
lora_alpha: 32
lora_dropout: 0.05
lora_target_modules:
  - q_proj
  - k_proj
  - v_proj
  - o_proj

gradient_accumulation_steps: 4
micro_batch_size: 2
num_epochs: 3
optimizer: adamw_torch
lr_scheduler: cosine
learning_rate: 0.0002

bf16: auto
tf32: false
gradient_checkpointing: true
flash_attention: false

warmup_steps: 10
eval_steps: 50
save_steps: 100
logging_steps: 10
weight_decay: 0.0

# After training, merge adapter and convert to GGUF:
#   python3 -m unsloth.save_gguf ./lora-out-hme-arbiter \\
#       --outfile hme-arbiter.gguf --quantization q4_k_m
# Then load into llama.cpp:
#   llamacpp create hme-arbiter -f Modelfile
# And update agent_local.py _ARBITER_MODEL to "hme-arbiter:latest"
"""
    os.makedirs(os.path.dirname(_CONFIG), exist_ok=True)
    with open(_CONFIG, "w") as f:
        f.write(config)
    print(f"Training config: {_CONFIG}")
    return 0


def show_plan() -> int:
    print("# HME Arbiter QLoRA Fine-Tune Plan (H10)")
    print()
    print("## Prerequisites")
    print("  - GPU with >= 6GB VRAM (8GB recommended)")
    print("  - pip install unsloth bitsandbytes accelerate peft transformers datasets")
    print("  - Base model: Qwen/Qwen2.5-4B-Instruct (or compatible 4B/7B)")
    print()
    print("## Steps")
    print("  1. Export corpus:     python3 tools/HME/scripts/finetune-arbiter.py --export")
    print("  2. Write config:      python3 tools/HME/scripts/finetune-arbiter.py --config")
    print("  3. Train (3 epochs):  accelerate launch -m axolotl.cli.train \\")
    print(f"                          {os.path.relpath(_CONFIG, _PROJECT)}")
    print("  4. Merge adapter:     python3 -m unsloth.save_gguf ./lora-out-hme-arbiter \\")
    print("                          --outfile hme-arbiter.gguf --quantization q4_k_m")
    print("  5. Load into llama.cpp:  llamacpp create hme-arbiter -f Modelfile")
    print("  6. Update agent_local.py: _ARBITER_MODEL = 'hme-arbiter:latest'")
    print("  7. Re-enable arbiter in explore mode: skip_arbiter=False in _MODE_CONFIGS")
    print()
    print("## Expected quality improvements")
    print("  - Arbiter plans correctly identify Polychron subsystems")
    print("  - Search terms match actual codebase naming (crossLayerX, hypermetaY)")
    print("  - JSON output is valid first-try (current ~30% parse failure rate)")
    print("  - Plan mode becomes noticeably more grounded")
    print()
    print("## Training time estimate")
    print("  - 112 KB entries × 2 examples = ~224 training samples")
    print("  - 3 epochs on 8GB GPU: ~20-40 minutes wall time")
    return 0


def main(argv: list) -> int:
    if "--export" in argv:
        return export_corpus()
    if "--config" in argv:
        return write_config()
    return show_plan()


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
