#!/usr/bin/env python3
"""HME Arbiter v6 — QLoRA fine-tune on microsoft/phi-4 (14B).

v6 goals (what v5 failed at):
  1. No hallucinated file paths — model must only use paths from its input registry.
  2. Correct WHAT/WHERE/WHY planning format matching the actual cascade prompt.
  3. Coder corpus: same factual base, structured FILE/FUNCTION/SIGNALS/CONNECTS output.
  4. Planning corpus: multi-step investigation plans with exact module names only.
  5. Refusal corpus: model says "not in registry" when asked about unknown modules.

Corpus sections:
  A. Factual grounding  — 487 module→path pairs (the canonical truth, same for coder)
  B. Planning           — cascade-format WHAT/WHERE/WHY plans (matches inference prompt)
  C. Structured extraction — coder-style FILE/FUNCTION/SIGNALS/CONNECTS (for coder reuse)
  D. Negative/refusal   — "module X not in registry, cannot invent path"
  E. Architecture facts — subsystem overview, boundaries, load order

Usage:
  python3 tools/HME/scripts/finetune-arbiter-v6.py --export
  python3 tools/HME/scripts/finetune-arbiter-v6.py --config
  python3 tools/HME/scripts/finetune-arbiter-v6.py --train   # launches axolotl
"""
import json
import os
import random
import subprocess
import sys

_PROJECT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
_CORPUS  = os.path.join(_PROJECT, "metrics", "hme-corpus-v6.jsonl")
_CODER_CORPUS = os.path.join(_PROJECT, "metrics", "hme-coder-corpus-v6.jsonl")
_CONFIG  = os.path.join(_PROJECT, "metrics", "axolotl-arbiter-v6.yaml")
_ADAPTER_OUT = os.path.join(_PROJECT, "metrics", "hme-arbiter-adapter-v6")
_GGUF_F16    = os.path.join(_PROJECT, "metrics", "hme-arbiter-v6-f16.gguf")
_GGUF_OUT    = os.path.join(_PROJECT, "metrics", "hme-arbiter-v6.gguf")
_LLAMA_CONVERT = os.path.join(_PROJECT, "..", "..", "tools", "llama.cpp", "convert_hf_to_gguf.py")
_LLAMA_QUANTIZE = os.path.join(_PROJECT, "..", "..", "tools", "llama.cpp", "build", "bin", "llama-quantize")
_MERGED_PATH = "/tmp/hme-arbiter-v6-merged"

BASE_MODEL = "microsoft/phi-4"

# Phi-4 uses ChatML template same as Qwen — im_start/im_end
SYSTEM_PROMPT = (
    "You are the HME arbiter — a research planner for the Polychron JavaScript codebase. "
    "Polychron is an algorithmic composition system: source files are IIFEs under src/, "
    "organized as globals. Load order: utils→conductor→rhythm→time→composers→fx→crossLayer→writer→play. "
    "CRITICAL: only use module names and file paths from the list provided to you. "
    "Never invent paths. If a module is not in your registry, say so explicitly."
)

CODER_SYSTEM = (
    "You are a code fact extractor for the Polychron JavaScript codebase. "
    "Given source code and an investigation plan, extract structured facts: "
    "FILE (exact path as shown in source), FUNCTION (exact name), SIGNALS (L0 channels or events), "
    "CONNECTS (modules it reads from or writes to). "
    "Only use names that literally appear in the source code provided. No inference, no invention."
)

random.seed(42)


# ── Module map ─────────────────────────────────────────────────────────────────

def build_module_map() -> dict[str, str]:
    """Walk src/ and return {module_name: rel_path} for all .js files."""
    src = os.path.join(_PROJECT, "src")
    result = {}
    for root, dirs, files in os.walk(src):
        dirs[:] = [d for d in dirs if d not in {"node_modules", "__pycache__"}]
        for f in files:
            if f.endswith(".js"):
                name = f[:-3]
                rel = os.path.relpath(os.path.join(root, f), _PROJECT)
                result[name] = rel
    return result


def subsystem_of(path: str) -> str:
    """Return subsystem name from path."""
    parts = path.split("/")
    if len(parts) >= 2:
        return parts[1]
    return "src"


# ── Section A: Factual grounding ───────────────────────────────────────────────

def section_a_factual(module_map: dict) -> list[dict]:
    """One sample per module: exact path lookup + subsystem. Shared with coder."""
    samples = []
    for name, path in module_map.items():
        sub = subsystem_of(path)
        # Q: Where is X implemented?
        samples.append({
            "system": SYSTEM_PROMPT,
            "user": f"Where is {name} implemented?",
            "assistant": path,
        })
        # Q: What subsystem does X belong to?
        samples.append({
            "system": SYSTEM_PROMPT,
            "user": f"What subsystem does {name} belong to?",
            "assistant": f"{sub} (file: {path})",
        })
        # Q: What file contains X?
        samples.append({
            "system": SYSTEM_PROMPT,
            "user": f"What file contains {name}?",
            "assistant": path,
        })
    return samples


# ── Section B: Planning (cascade-format) ───────────────────────────────────────

# Real investigation plan patterns observed from system usage.
# Format matches synthesis_llamacpp.py line 963-965:
#   "Break into 3-5 investigation steps:\n\n{question}\n\n"
#   "Known project modules (use exact names): {comma list}\n\n"
#   "Each step: WHAT (exact module name from list above), WHERE (subsystem), WHY (relevance)."

_PLAN_TEMPLATES = [
    # Pattern: how does A interact with B
    {
        "q": "How does {m1} interact with {m2}?",
        "plan": (
            "1. WHAT: `{m1}`, WHERE: {s1}, WHY: primary subject — understand its interface and what it exposes.\n"
            "2. WHAT: `{m2}`, WHERE: {s2}, WHY: secondary subject — understand what it expects as input.\n"
            "3. WHAT: `{m1}` + `{m2}`, WHERE: both, WHY: trace the call path between them and any shared L0 channels.\n"
            "4. WHAT: {m3}, WHERE: {s3}, WHY: registry hub — confirm both modules are registered and check dependency order."
        ),
    },
    # Pattern: what does X do
    {
        "q": "What does {m1} do and how does it connect to {m2}?",
        "plan": (
            "1. WHAT: `{m1}`, WHERE: {s1}, WHY: read the IIFE to understand its exported API and side effects.\n"
            "2. WHAT: `{m2}`, WHERE: {s2}, WHY: check what channels or methods it registers that {m1} might use.\n"
            "3. WHAT: `{m3}`, WHERE: {s3}, WHY: verify load order — {m1} must load before any consumer."
        ),
    },
    # Pattern: why is X firing / diagnostic
    {
        "q": "Why would {m1} cause unexpected behavior in {m2}?",
        "plan": (
            "1. WHAT: `{m1}`, WHERE: {s1}, WHY: identify what state it mutates or what signals it emits.\n"
            "2. WHAT: `{m2}`, WHERE: {s2}, WHY: identify what signals it reads and what it expects.\n"
            "3. WHAT: `{m3}`, WHERE: {s3}, WHY: check if there is a shared dependency that could be the root cause.\n"
            "4. WHAT: `{m1}` + `{m2}`, WHERE: both, WHY: trace the data flow to confirm the interference point."
        ),
    },
    # Pattern: how to add / extend
    {
        "q": "How do I add a new registration to {m1}?",
        "plan": (
            "1. WHAT: `{m1}`, WHERE: {s1}, WHY: read the registration API — what parameters does it accept?\n"
            "2. WHAT: `{m2}`, WHERE: {s2}, WHY: existing registrant example — copy the pattern.\n"
            "3. WHAT: `{m3}`, WHERE: {s3}, WHY: load order — new file must be required before {m1} is called.\n"
        ),
    },
    # Pattern: trace a signal
    {
        "q": "Trace the data flow from {m1} to {m2}.",
        "plan": (
            "1. WHAT: `{m1}`, WHERE: {s1}, WHY: find what L0 channel or method it publishes on.\n"
            "2. WHAT: `{m2}`, WHERE: {s2}, WHY: find what L0 channel or method it subscribes to.\n"
            "3. WHAT: `{m3}`, WHERE: {s3}, WHY: potential intermediate — check if it relays or transforms the signal.\n"
            "4. WHAT: `{m1}` + `{m2}`, WHERE: both, WHY: confirm the channel names match end-to-end."
        ),
    },
]


def _registry_hint(mods: list[str]) -> str:
    return f"Known project modules (use exact names): {', '.join(mods)}"


def section_b_planning(module_map: dict) -> list[dict]:
    """Multi-step investigation plans in the exact cascade format."""
    samples = []
    module_names = [n for n in module_map if n != "index"]
    sub_map = {n: subsystem_of(p) for n, p in module_map.items()}

    for _ in range(600):
        # Pick 3 random modules for m1, m2, m3
        mods = random.sample(module_names, min(8, len(module_names)))
        m1, m2, m3 = mods[0], mods[1], mods[2]
        s1 = sub_map.get(m1, "src")
        s2 = sub_map.get(m2, "src")
        s3 = sub_map.get(m3, "src")
        registry = mods[:6]  # 6 modules in registry, matching runtime behavior

        tmpl = random.choice(_PLAN_TEMPLATES)
        question = tmpl["q"].format(m1=m1, m2=m2, m3=m3, s1=s1, s2=s2, s3=s3)
        plan = tmpl["plan"].format(m1=m1, m2=m2, m3=m3, s1=s1, s2=s2, s3=s3)

        user = (
            f"Break into 3-5 investigation steps:\n\n{question}\n\n"
            f"{_registry_hint(registry)}\n\n"
            "Each step: WHAT (exact module name from list above), WHERE (subsystem), WHY (relevance)."
        )
        samples.append({
            "system": SYSTEM_PROMPT,
            "user": user,
            "assistant": plan,
        })

    return samples


# ── Section C: Structured extraction (shared with coder) ──────────────────────

def _read_source_snippet(path: str, max_chars: int = 800) -> str:
    abs_path = os.path.join(_PROJECT, path)
    try:
        with open(abs_path) as f:
            return f.read(max_chars)
    except Exception:
        return ""


def section_c_extraction(module_map: dict) -> list[dict]:
    """Coder-format: given source, extract FILE/FUNCTION/SIGNALS/CONNECTS."""
    samples = []
    items = [(n, p) for n, p in module_map.items() if n != "index"]
    random.shuffle(items)

    for name, path in items[:300]:
        src = _read_source_snippet(path, 600)
        if not src or len(src) < 80:
            continue
        sub = subsystem_of(path)

        # Build a minimal synthetic extraction answer from what we know about the file
        answer = (
            f"FILE: {path}\n"
            f"FUNCTION: (see source — IIFE module pattern)\n"
            f"SIGNALS: (check for absoluteTimeGrid subscriptions in source above)\n"
            f"CONNECTS: (check require() calls and crossLayerRegistry/conductorIntelligence registrations)"
        )

        user = (
            f"SOURCE CODE:\n```\n{src}\n```\n\n"
            f"Execute this analysis plan:\n"
            f"1. WHAT: `{name}`, WHERE: {sub}, WHY: understand its interface.\n\n"
            f"QUESTION: What does {name} export and how does it connect to the system?\n\n"
            "For each step extract: FILE (exact path from source code above), "
            "FUNCTION, SIGNALS, CONNECTS.\n"
            "Only use paths and names from SOURCE CODE above."
        )
        samples.append({
            "system": CODER_SYSTEM,
            "user": user,
            "assistant": answer,
        })

    return samples


# ── Section D: Refusal / negative examples ─────────────────────────────────────

_FAKE_MODULES = [
    "signalBroadcaster", "layerSwitchManager", "conductorBridge", "rhythmAnalyzer",
    "harmonyController", "noteEmitter", "beatDispatcher", "tempoRegulator",
    "velocityScaler", "onsetDetector", "pitchShifter", "chordVoicer",
    "melodyTracer", "counterpoint", "voiceLeader", "rhythmicEngine",
    "patternMatcher", "noteScheduler", "progressionBuilder", "dynamicRanger",
]


def section_d_refusals(module_map: dict) -> list[dict]:
    """Negative examples: unknown module not in registry → refuse to invent path."""
    samples = []
    real_modules = list(module_map.keys())

    for fake in _FAKE_MODULES:
        # Registry contains only real modules (fake is absent)
        registry = random.sample([n for n in real_modules if n != "index"], 6)
        user = (
            f"Break into 3-5 investigation steps:\n\n"
            f"How does {fake} work in Polychron?\n\n"
            f"{_registry_hint(registry)}\n\n"
            "Each step: WHAT (exact module name from list above), WHERE (subsystem), WHY (relevance)."
        )
        samples.append({
            "system": SYSTEM_PROMPT,
            "user": user,
            "assistant": (
                f"`{fake}` is not in the provided module registry. "
                "I cannot invent a file path for it. "
                "Investigate using only the listed modules:\n"
                + "\n".join(f"- `{m}`" for m in registry[:3])
            ),
        })
        # Also: direct location query for fake module
        samples.append({
            "system": SYSTEM_PROMPT,
            "user": f"Where is {fake} implemented?",
            "assistant": (
                f"`{fake}` does not appear in the Polychron source tree. "
                "It may not exist — check the module registry before searching."
            ),
        })

    return samples


# ── Section E: Architecture facts ──────────────────────────────────────────────

_ARCH_QA = [
    ("What is the load order for Polychron subsystems?",
     "utils → conductor → rhythm → time → composers → fx → crossLayer → writer → play. "
     "Each subsystem's index.js loads helpers first, then the manager/orchestrator last."),

    ("What are the architectural boundaries for cross-layer writes from conductor?",
     "conductor cannot write to cross-layer state. Only local playProb/stutterProb and "
     "explainabilityBus diagnostics are permitted. Cross-layer writes from conductor are banned."),

    ("How should a new module register itself?",
     "Write the file as an IIFE, self-register at end via crossLayerRegistry or conductorIntelligence, "
     "then require from the subsystem index.js. Never use global. or globalThis."),

    ("What is the L0 channel system?",
     "absoluteTimeGrid (L0) channels — inter-module communication. Channel names must use "
     "L0_CHANNELS.xxx constants. Bare strings in L0 method calls are a hard error (local/no-bare-l0-channel). "
     "New channels: add to l0Channels.js, declare in globals.d.ts."),

    ("How are cross-layer emissions routed?",
     "All buffer writes route through crossLayerEmissionGateway.emit(sourceModule, buffer, event). "
     "Never push() directly to cross-layer buffers."),

    ("What is the Hypermeta-First rule?",
     "19 hypermeta self-calibrating controllers manage all 6 axes. Never hand-tune meta-controller "
     "constants — modify controller logic instead. Never set coherentThresholdScale per-profile."),

    ("What is the per-layer state mechanism?",
     "Mutable globals that bleed between L1/L2 polyrhythmic layers must live in LM.perLayerState, "
     "saved/restored on every activate() call. Currently: crossModulation, lastCrossMod, balOffset, "
     "sideBias, lBal, rBal, cBal, cBal2, cBal3, refVar, bassVar, flipBin."),

    ("What is the conductor subsystem responsible for?",
     "src/conductor/ — the main signal/analysis subsystem. Contains signal profiling, regime "
     "classification, meta-controllers, coupling matrix, journey planning, melodic/rhythmic analysis. "
     "Single-manager hub: conductorIntelligence is the facade."),

    ("What is the crossLayer subsystem responsible for?",
     "src/crossLayer/ — cross-boundary synthesis. Rhythm, harmony, melody, dynamics, structure modules "
     "that run on BOTH L1 and L2. Cannot write to conductor state (read-only via getters only)."),

    ("What is the fx subsystem responsible for?",
     "src/fx/ — audio effects: stutter variants, noise generators. Loaded after composers. "
     "Self-register with crossLayerRegistry."),

    ("What does the writer subsystem do?",
     "src/writer/ — MIDI/audio output serialization. Takes the beat pipeline output and writes files. "
     "Loaded second-to-last, after fx."),

    ("How does validation work in Polychron?",
     "All validation uses validator.create('ModuleName'). Never use raw typeof, || [], || 0, or "
     "ternary fallbacks for validation. Globals are truth — initialize correctly at the source, "
     "never sanitize downstream."),

    ("What is the feedback graph?",
     "metrics/feedback_graph.json — declares all feedback loops and firewall ports. New feedback loop: "
     "register with feedbackRegistry and declare in feedback_graph.json. New cross-boundary data flow: "
     "declare a firewall port."),

    ("What are the 9 firewall ports?",
     "Declared in metrics/feedback_graph.json under firewallPorts. These are the controlled "
     "cross-boundary openings between conductor and crossLayer. Any new cross-boundary data flow "
     "requires declaring a new port here."),
]


def section_e_architecture() -> list[dict]:
    samples = []
    for q, a in _ARCH_QA:
        samples.append({"system": SYSTEM_PROMPT, "user": q, "assistant": a})
    return samples


# ── Export ─────────────────────────────────────────────────────────────────────

def export_corpus() -> int:
    print("Building module map...")
    module_map = build_module_map()
    print(f"  {len(module_map)} modules found")

    print("Generating sections...")
    sec_a = section_a_factual(module_map)
    sec_b = section_b_planning(module_map)
    sec_c = section_c_extraction(module_map)
    sec_d = section_d_refusals(module_map)
    sec_e = section_e_architecture()

    arbiter_corpus = sec_a + sec_b + sec_d + sec_e
    coder_corpus   = sec_a + sec_c + sec_e

    random.shuffle(arbiter_corpus)
    random.shuffle(coder_corpus)

    os.makedirs(os.path.dirname(_CORPUS), exist_ok=True)
    with open(_CORPUS, "w") as f:
        for ex in arbiter_corpus:
            f.write(json.dumps(ex) + "\n")

    with open(_CODER_CORPUS, "w") as f:
        for ex in coder_corpus:
            f.write(json.dumps(ex) + "\n")

    print(f"\nArbiter corpus: {_CORPUS}")
    print(f"  {len(arbiter_corpus)} examples")
    print(f"    A (factual):   {len(sec_a)}")
    print(f"    B (planning):  {len(sec_b)}")
    print(f"    D (refusals):  {len(sec_d)}")
    print(f"    E (arch):      {len(sec_e)}")

    print(f"\nCoder corpus: {_CODER_CORPUS}")
    print(f"  {len(coder_corpus)} examples")
    print(f"    A (factual):      {len(sec_a)}")
    print(f"    C (extraction):   {len(sec_c)}")
    print(f"    E (arch):         {len(sec_e)}")

    return 0


# ── Config ─────────────────────────────────────────────────────────────────────

def write_config() -> int:
    """Write axolotl QLoRA config targeting phi-4 (14B)."""
    # phi-4: 14B params, fits in 24GB VRAM with 4-bit + gradient checkpointing.
    # r=32 (vs 16 in v5) for higher capacity on the larger model.
    # num_epochs=4: planning tasks need more repetition to override base priors.
    # sequence_len=2048: planning prompts + answers fit in 1K but arch facts can be longer.
    config = f"""\
# HME Arbiter v6 QLoRA — microsoft/phi-4 (14B)
# Target: investigation planning with exact module names, no hallucinated paths
# Corpus: {len(open(_CORPUS).readlines()) if os.path.exists(_CORPUS) else 'run --export first'} examples

base_model: microsoft/phi-4
model_type: AutoModelForCausalLM
tokenizer_type: AutoTokenizer

load_in_4bit: true
strict: false

datasets:
  - path: metrics/hme-corpus-v6.jsonl
    type: input_output
    field_human: user
    field_model: assistant

dataset_prepared_path: last_run_prepared_v6
val_set_size: 0.05
output_dir: {_ADAPTER_OUT}

sequence_len: 2048
sample_packing: false
pad_to_sequence_len: false

chat_template: chatml
default_system_message: "{SYSTEM_PROMPT}"

adapter: qlora
lora_r: 32
lora_alpha: 64
lora_dropout: 0.05
lora_target_modules:
  - q_proj
  - k_proj
  - v_proj
  - o_proj
  - gate_proj
  - up_proj
  - down_proj

gradient_accumulation_steps: 8
micro_batch_size: 1
num_epochs: 4
optimizer: adafactor
lr_scheduler: cosine
learning_rate: 0.0001

bf16: true
tf32: true
gradient_checkpointing: true
flash_attention: false

warmup_steps: 20
eval_steps: 100
save_steps: 200
logging_steps: 10
weight_decay: 0.01

# After training:
#   python3 tools/HME/scripts/finetune-arbiter-v6.py --merge
#   ollama create hme-arbiter -f metrics/Modelfile-v6
#   Then set HME_ARBITER_MODEL=hme-arbiter in .env and restart shim
"""
    os.makedirs(os.path.dirname(_CONFIG), exist_ok=True)
    with open(_CONFIG, "w") as f:
        f.write(config)
    print(f"Config written: {_CONFIG}")
    return 0


# ── Train ──────────────────────────────────────────────────────────────────────

def train() -> int:
    if not os.path.exists(_CORPUS):
        print("Corpus missing — run --export first")
        return 1
    if not os.path.exists(_CONFIG):
        print("Config missing — run --config first")
        return 1
    # Write training lock
    lock_path = os.path.join(_PROJECT, "tmp", "hme-training.lock")
    os.makedirs(os.path.dirname(lock_path), exist_ok=True)
    with open(lock_path, "w") as f:
        f.write("arbiter-v6\n")
    print(f"Training lock written: {lock_path}")
    print("Launching axolotl...")
    rel_config = os.path.relpath(_CONFIG, _PROJECT)
    result = subprocess.run(
        ["python3", "-m", "axolotl.cli.train", rel_config],
        cwd=_PROJECT,
    )
    return result.returncode


# ── Merge ──────────────────────────────────────────────────────────────────────

def merge() -> int:
    """Merge best adapter checkpoint → f16 GGUF."""
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer
    from peft import PeftModel

    # Find best checkpoint
    adapter_path = _ADAPTER_OUT
    # axolotl saves best as the top-level adapter
    print(f"Loading base: {BASE_MODEL}")
    base = AutoModelForCausalLM.from_pretrained(
        BASE_MODEL, dtype=torch.float16, device_map="cpu", trust_remote_code=True,
    )
    print(f"Loading adapter: {adapter_path}")
    model = PeftModel.from_pretrained(base, adapter_path)
    print("Merging...")
    merged = model.merge_and_unload()

    os.makedirs(_MERGED_PATH, exist_ok=True)
    merged.save_pretrained(_MERGED_PATH)
    tok = AutoTokenizer.from_pretrained(BASE_MODEL, trust_remote_code=True)
    tok.save_pretrained(_MERGED_PATH)
    print(f"Merged saved to {_MERGED_PATH}")

    # Convert to GGUF f16 (keep full precision — phi4 14B = ~28GB f16, fits in RAM)
    print("Converting to GGUF f16...")
    r = subprocess.run([sys.executable, _LLAMA_CONVERT, _MERGED_PATH,
                        "--outfile", _GGUF_F16, "--outtype", "f16"])
    if r.returncode != 0:
        print("GGUF conversion failed")
        return 1

    # Write Modelfile
    modelfile = os.path.join(_PROJECT, "metrics", "Modelfile-v6")
    with open(modelfile, "w") as f:
        f.write(f"FROM {_GGUF_F16}\n")
        f.write('TEMPLATE "<|im_start|>system\n{{ .System }}<|im_end|>\n<|im_start|>user\n{{ .Prompt }}<|im_end|>\n<|im_start|>assistant\n"\n')
        f.write(f"SYSTEM {SYSTEM_PROMPT}\n")
        f.write("PARAMETER top_p 0.9\n")
        f.write("PARAMETER num_ctx 4096\n")
        f.write("PARAMETER stop <|im_end|>\n")
        f.write("PARAMETER stop <|im_start|>\n")
        f.write("PARAMETER temperature 0.2\n")
    print(f"Modelfile written: {modelfile}")
    print("Run: ollama create hme-arbiter -f metrics/Modelfile-v6")
    return 0


# ── Eval ───────────────────────────────────────────────────────────────────────

_EVAL_CASES = [
    # Hallucination test: module in registry, must use it
    {
        "user": (
            "Break into 3-5 investigation steps:\n\n"
            "How does regimeSelfBalancer interact with coherentThresholdScale?\n\n"
            "Known project modules (use exact names): regimeSelfBalancer, coherentThresholdScale, "
            "metaControllerRegistry, systemDynamicsProfiler, feedbackRegistry, conductorIntelligence\n\n"
            "Each step: WHAT (exact module name from list above), WHERE (subsystem), WHY (relevance)."
        ),
        "check": lambda r: (
            "regimeSelfBalancer" in r and "coherentThresholdScale" in r
            and "threshold_scoring" not in r  # hallucinated path from v5
            and "regimeReactiveDynamics" not in r  # hallucinated path from v5
        ),
        "label": "planning: no hallucinated paths",
    },
    # Refusal test: module NOT in registry
    {
        "user": (
            "Break into 3-5 investigation steps:\n\nHow does signalBroadcaster work?\n\n"
            "Known project modules (use exact names): conductorIntelligence, metaControllerRegistry, "
            "feedbackRegistry, systemDynamicsProfiler, signalReader, l0Channels\n\n"
            "Each step: WHAT (exact module name from list above), WHERE (subsystem), WHY (relevance)."
        ),
        "check": lambda r: (
            "signalBroadcaster" in r and
            any(w in r.lower() for w in ["not in", "not listed", "cannot", "does not appear"])
        ),
        "label": "refusal: unknown module not invented",
    },
    # Path lookup
    {
        "user": "Where is feedbackRegistry implemented?",
        "check": lambda r: "src/" in r and "feedbackRegistry" in r.lower(),
        "label": "factual: path lookup",
    },
]


def eval_model(model_name: str = "hme-arbiter") -> int:
    import urllib.request
    passed = 0
    for case in _EVAL_CASES:
        body = json.dumps({
            "model": model_name,
            "prompt": case["user"],
            "stream": False,
            "options": {"temperature": 0.1, "num_predict": 400},
        }).encode()
        req = urllib.request.Request(
            "http://localhost:11435/api/generate", data=body,
            headers={"Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                resp = json.loads(r.read())
                text = resp.get("response", "")
            ok = case["check"](text)
            status = "PASS" if ok else "FAIL"
            if ok:
                passed += 1
            print(f"[{status}] {case['label']}")
            if not ok:
                print(f"       Response: {text[:200]}")
        except Exception as e:
            print(f"[ERR] {case['label']}: {e}")
    print(f"\n{passed}/{len(_EVAL_CASES)} passed")
    return 0 if passed == len(_EVAL_CASES) else 1


# ── Main ───────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--export", action="store_true")
    p.add_argument("--config", action="store_true")
    p.add_argument("--train",  action="store_true")
    p.add_argument("--merge",  action="store_true")
    p.add_argument("--eval",   action="store_true")
    p.add_argument("--all",    action="store_true", help="export + config + train + merge")
    args = p.parse_args()

    if args.all or args.export:
        sys.exit(export_corpus())
    if args.config:
        sys.exit(write_config())
    if args.train:
        sys.exit(train())
    if args.merge:
        sys.exit(merge())
    if args.eval:
        sys.exit(eval_model())

    p.print_help()
