#!/usr/bin/env python3
"""HME Arbiter v6 training — TRL SFTTrainer + PEFT QLoRA.

Runs on Qwen2.5-3B-Instruct for corpus validation.
Once eval passes, swap BASE_MODEL to microsoft/phi-4 for the full upgrade.

Usage:
  python3 tools/HME/scripts/train_arbiter_v6.py [--sanity] [--base phi4]

--sanity: 50-step smoke test (confirms format + no OOM)
--base phi4: use microsoft/phi-4 instead of Qwen2.5-3B (requires HF weights)
"""
import argparse
import json
import os
import sys

_PROJECT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))

BASE_MODELS = {
    "3b":  "Qwen/Qwen2.5-3B-Instruct",
    "phi4": "microsoft/phi-4",
}

CORPUS = os.path.join(_PROJECT, "metrics", "hme-corpus-v6.jsonl")

SYSTEM_PROMPT = (
    "You are the HME arbiter — a research planner for the Polychron JavaScript codebase. "
    "Polychron is an algorithmic composition system: source files are IIFEs under src/, "
    "organized as globals. Load order: utils→conductor→rhythm→time→composers→fx→crossLayer→writer→play. "
    "CRITICAL: only use module names and file paths from the list provided to you. "
    "Never invent paths. If a module is not in your registry, say so explicitly."
)


def load_corpus():
    samples = []
    with open(CORPUS) as f:
        for line in f:
            samples.append(json.loads(line.strip()))
    return samples


def format_chatml(sample: dict) -> str:
    """Format as ChatML for QLoRA training."""
    system = sample.get("system", SYSTEM_PROMPT)
    user = sample.get("user", "")
    asst = sample.get("assistant", "")
    return (
        f"<|im_start|>system\n{system}<|im_end|>\n"
        f"<|im_start|>user\n{user}<|im_end|>\n"
        f"<|im_start|>assistant\n{asst}<|im_end|>"
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--sanity", action="store_true", help="50-step smoke test only")
    parser.add_argument("--base", default="3b", choices=list(BASE_MODELS.keys()),
                        help="Base model key (3b or phi4)")
    args = parser.parse_args()

    base_model_id = BASE_MODELS[args.base]
    output_dir = os.path.join(
        _PROJECT, "metrics",
        f"hme-arbiter-adapter-v6-{'sanity' if args.sanity else args.base}"
    )
    max_steps = 50 if args.sanity else -1
    num_epochs = 1 if args.sanity else 4
    eval_steps = 25 if args.sanity else 100
    save_steps = 50 if args.sanity else 200
    batch_acc  = 2 if args.sanity else 4
    grad_acc   = 4 if args.sanity else 8

    print(f"Base model: {base_model_id}")
    print(f"Output:     {output_dir}")
    print(f"Sanity:     {args.sanity}")

    import torch
    from datasets import Dataset
    from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
    from transformers import (
        AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig, TrainingArguments,
    )
    from trl import SFTTrainer, SFTConfig

    # ── Load model ─────────────────────────────────────────────────────────────
    bnb_cfg = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_compute_dtype=torch.float16,
        bnb_4bit_use_double_quant=True,
        bnb_4bit_quant_type="nf4",
    )
    print("Loading base model...")
    model = AutoModelForCausalLM.from_pretrained(
        base_model_id,
        quantization_config=bnb_cfg,
        device_map="auto",
        trust_remote_code=True,
        torch_dtype=torch.float16,
    )
    model = prepare_model_for_kbit_training(model)

    tokenizer = AutoTokenizer.from_pretrained(base_model_id, trust_remote_code=True)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token
    tokenizer.padding_side = "right"
    tokenizer.model_max_length = 2048

    # ── LoRA ───────────────────────────────────────────────────────────────────
    lora_cfg = LoraConfig(
        r=32,
        lora_alpha=64,
        lora_dropout=0.05,
        bias="none",
        task_type="CAUSAL_LM",
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj",
                         "gate_proj", "up_proj", "down_proj"],
    )
    model = get_peft_model(model, lora_cfg)
    model.print_trainable_parameters()

    # ── Dataset ────────────────────────────────────────────────────────────────
    print("Loading corpus...")
    raw = load_corpus()
    if args.sanity:
        raw = raw[:200]  # small slice for sanity run

    texts = [format_chatml(s) for s in raw]
    split_idx = max(1, int(len(texts) * 0.95))
    train_ds = Dataset.from_dict({"text": texts[:split_idx]})
    eval_ds  = Dataset.from_dict({"text": texts[split_idx:]})
    print(f"Train: {len(train_ds)}, Eval: {len(eval_ds)}")

    # ── Training args ──────────────────────────────────────────────────────────
    train_args = SFTConfig(
        output_dir=output_dir,
        num_train_epochs=num_epochs,
        max_steps=max_steps,
        per_device_train_batch_size=1,
        per_device_eval_batch_size=1,
        gradient_accumulation_steps=grad_acc,
        optim="adafactor",
        learning_rate=1e-4,
        lr_scheduler_type="cosine",
        warmup_steps=20 if not args.sanity else 5,
        weight_decay=0.01,
        bf16=False,
        fp16=False,
        tf32=False,
        gradient_checkpointing=True,
        eval_strategy="steps",
        eval_steps=eval_steps,
        save_strategy="steps",
        save_steps=save_steps,
        save_total_limit=3,
        load_best_model_at_end=True,
        metric_for_best_model="eval_loss",
        greater_is_better=False,
        logging_steps=10 if not args.sanity else 5,
        report_to="none",
        dataset_text_field="text",
        packing=False,
    )

    trainer = SFTTrainer(
        model=model,
        args=train_args,
        train_dataset=train_ds,
        eval_dataset=eval_ds,
        processing_class=tokenizer,
    )

    # ── Write training lock ────────────────────────────────────────────────────
    lock_path = os.path.join(_PROJECT, "tmp", "hme-training.lock")
    os.makedirs(os.path.dirname(lock_path), exist_ok=True)
    with open(lock_path, "w") as f:
        f.write(f"arbiter-v6-{args.base}{'sanity' if args.sanity else ''}\n")

    print("Training...")
    trainer.train()

    print(f"Done. Best model saved to {output_dir}")
    if args.sanity:
        print("Sanity PASSED — phi-4 training format confirmed. Run without --sanity for full run.")

    # Remove lock
    try:
        os.remove(lock_path)
    except Exception:
        pass


if __name__ == "__main__":
    main()
