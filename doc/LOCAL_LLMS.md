# Local LLMs

> The HME subagent pipeline runs two domain-fine-tuned LLMs fully locally on amateur hardware (dual Tesla M40 24 GB). No cloud inference for planning or extraction. The arbiter is a QLoRA-trained phi-4 (14.7B) that produces investigation plans; the coder is a stock qwen3-coder:30b that does FILE / FUNCTION / SIGNALS / CONNECTS extraction. Both serve through llama.cpp (Vulkan) behind a persistent Python shim that the MCP host talks to over HTTP.

This document is the single source of truth for how local inference is wired. It covers the serving stack, the hardware layout, the training pipeline that produces new arbiter LoRA adapters, and what's queued next.

**See also:** [HME.md](HME.md) for the executive that consumes these models, [doc/ARCHITECTURE.md](ARCHITECTURE.md) for the broader system.

## The cascade

Every HME query that needs local reasoning flows through a three-stage cascade. The arbiter plans, the coder extracts, the reasoner (cloud fallback) synthesizes. Only the first two run locally:

```
user query
    -> arbiter (phi-4 + v6 LoRA)      plan: 3-5 investigation steps
        -> coder (qwen3-coder:30b)    extract: FILE/FUNCTION/SIGNALS/CONNECTS per step
            -> reasoner (cloud)       synthesize: final answer
```

The arbiter is the stage that was hallucinating file paths in v5 — inventing modules like `utils/threshold_scoring.js` that never existed. v6's training fixes this by teaching the model to refuse when a module isn't in the registry passed into the prompt.

## Serving stack

Two `llama-server` instances (Vulkan backend, build b8797) run as systemd services. One per M40. Both expose OpenAI-compatible `/v1/chat/completions`.

| Role | Port | Model | LoRA | Systemd unit |
|------|------|-------|------|--------------|
| Arbiter | 8080 | `phi-4-Q4_K_M.gguf` | `hme-arbiter.gguf` | `llamacpp-arbiter.service` |
| Coder | 8081 | `qwen3-coder-30b-Q4_K_M.gguf` | (none yet) | `llamacpp-coder.service` |

Model files live in `/home/jah/models/`. LoRA adapters live in `/home/jah/Polychron/metrics/` and are symlinked into the path the unit expects. Logs go to `/var/log/llamacpp-arbiter.log` and `/var/log/llamacpp-coder.log`.

Both services use `Restart=on-failure` with a 5 s back-off, so a crash self-heals unless the underlying problem (OOM, missing file) persists.

### Why llama.cpp instead of llamacpp

Switched in commit `0577c0f7`. llama.cpp gives:

- **Parallel slot execution** via `--parallel N` — llamacpp is one-at-a-time per instance.
- **Loose LoRA adapters** via `--lora FILE.gguf` — no merge step needed, swap at runtime via `POST /lora-adapters`.
- **Per-slot KV cache** with `cache_prompt` — warm contexts without llamacpp's context[] hack.
- **No CUDA toolkit needed** — the Vulkan backend runs with just the stock NVIDIA driver, which is critical on Maxwell (M40) where modern CUDA toolchains have dropped sm_52 support.
- **Standard OpenAI API** — not vendor-locked, drop-in replacement for any OpenAI-SDK consumer.

### Shim in front (`hme_http.py`)

Between the MCP host and llama-server sits `tools/HME/mcp/hme_http.py` on `127.0.0.1:7734`. It's a long-running Python process that:

- Holds the RAG engine (jina-embeddings-v2-base-code on one GPU, bge-reranker-v2-m3 on CPU or GPU)
- Routes MCP tool calls to the right llama-server URL based on the requested model alias
- Enforces wall-clock timeouts via thread abandonment so one stuck synthesis can't jam the queue
- Re-reads `.env` on every routing call so model / backend / URL changes take effect without a shim restart (see `_refresh_arbiter()` in `synthesis_llamacpp.py`)

Env vars the shim reads (authoritative list in `.env`):

```
HME_ARBITER_BACKEND=llamacpp
HME_ARBITER_MODEL=hme-arbiter
HME_LLAMACPP_ARBITER_URL=http://127.0.0.1:8080
HME_LLAMACPP_CODER_URL=http://127.0.0.1:8081
HME_CODER_MODEL=qwen3-coder:30b
HME_REASONING_MODEL=qwen3-coder:30b
```

`HME_ARBITER_MODEL` is the `--alias` the arbiter `llama-server` advertises, not a filesystem name. Renaming here only re-routes; the backing GGUF is defined in the unit file.

## Hardware layout

Two Tesla M40 24 GB (Maxwell, sm_52) + an Intel UHD 770 iGPU visible to Vulkan. The M40s are the workhorses; the iGPU is a fallback surface for embedding models when both M40s are contested.

| Vulkan index | Device | Capacity | Typical tenant |
|--------------|--------|----------|----------------|
| Vulkan0 | Intel UHD 770 | 48 GB UMA | (fallback for embeddings only) |
| Vulkan1 | Tesla M40 #A | 23 GB | arbiter llama-server (~10 GB) |
| Vulkan2 | Tesla M40 #B | 23 GB | coder llama-server (~18.6 GB) + RAG engine overflow |

**Watch out for device renumbering.** llama.cpp's Vulkan backend enumerates devices in order of free memory at startup, not by PCI slot. Two services both asking for `--device Vulkan1` will still land on different physical GPUs if one was free and the other wasn't when each started. A service that worked yesterday with `--device Vulkan2` may need `--device Vulkan1` today depending on what's holding memory at boot.

Symptom of renumber: `ErrorOutOfDeviceMemory` / `unable to allocate Vulkan buffer` in the llama-server log, even though `--list-devices` shows free capacity. Fix: match the unit's `--device` to whichever index actually has headroom right now, then restart.

## Memory budget

With everything running at steady state:

- Arbiter llama-server: **~10 GB** on its assigned M40 (phi-4 Q4_K_M weights + KV cache for 4096 ctx)
- Coder llama-server: **~18.6 GB** on its assigned M40 (qwen3-coder:30b Q4_K_M + KV cache for 8192 ctx, parallel=2)
- RAG engine (jina + bge-reranker via `hme_http.py`): **~5 GB**, lands wherever free space is available. Can grow if queries keep embedding new content without triggering the VRAM monitor's pressure release.

The monitor in `tools/HME/mcp/vram_monitor.py` watches both M40s and evicts embedding batches when headroom drops below a configured threshold, so the RAG engine can't starve the llama-servers.

**Training is the only workload that needs all of one M40 to itself.** See the next section.

## Training a new arbiter LoRA

The arbiter's domain knowledge lives in its LoRA adapter, not the base model. To update it, you train a new adapter on an updated corpus, convert to GGUF, and swap it in. No merge, no 29 GB intermediate, no service downtime beyond the llama-server restart.

### One-time dependencies

- `trl` + `bitsandbytes` (0.43.3 on Maxwell — 0.49+ drops sm_52 and crashes with `ops.cu:62 named symbol not found`)
- `peft`, `transformers`, `accelerate`, `datasets` (already present)
- phi-4 HF safetensors (~28 GB) **only during training** — delete after LoRA GGUF export

### Corpus

`tools/HME/scripts/finetune-arbiter-v6.py` generates two corpora from the same factual base:

- `metrics/hme-corpus-v6.jsonl` — **1962 arbiter planning examples** (system → user → assistant ChatML)
- `metrics/hme-coder-corpus-v6.jsonl` — **1622 coder extraction examples** (same factual base, different output format)

Sections inside each:

| Section | Purpose | Examples |
|---------|---------|----------|
| A | Factual lookup (module → path → subsystem) | 1308 |
| B | Planning (arbiter only) — 3-5 step investigation format | 600 |
| C | Extraction (coder only) — FILE/FUNCTION/SIGNALS/CONNECTS | 300 |
| D | Refusals — fake module names the model must reject | 40 |
| E | Architecture Q&A (load order, firewall ports, layer isolation) | 14 |

Sections A, D, E are shared between both corpora. B is arbiter-only. C is coder-only.

### Training script

`tools/HME/scripts/train_arbiter_v6.py` — TRL SFTTrainer + PEFT QLoRA. Quirks that matter on M40:

- **bf16 off, fp16 off, tf32 off** — Maxwell doesn't support tf32, bf16 is emulated in software and crashes the GradScaler with a BFloat16 dtype mismatch. Running full-precision fp32 compute is the only path that works; adafactor handles the optimizer state efficiently enough that this isn't the memory killer you'd expect.
- **bnb compute dtype = fp16** — not bf16, same reason.
- **`CUDA_VISIBLE_DEVICES=0`** and `PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True` — pins training to whichever M40 has full headroom, prevents fragmentation death.
- **grad_accum = 8**, batch = 1 — effective batch 8, fits in ~13 GB for phi-4 training.
- **LoRA r=32, alpha=64**, targets `q_proj, k_proj, v_proj, o_proj, gate_proj, up_proj, down_proj` — produces ~60M trainable params (0.4% of phi-4).

Flags:

```bash
# Sanity (50 steps, small slice) — proves the pipeline works before committing hours
python3 tools/HME/scripts/train_arbiter_v6.py --sanity --base phi4

# Full run, warm-started from sanity checkpoint to save the first epoch
python3 tools/HME/scripts/train_arbiter_v6.py --base phi4 \
  --warm-from metrics/hme-arbiter-phi4/checkpoint-50 \
  --epochs 1
```

**Timing on one M40 #B (nothing else running on that GPU):**

- Sanity: ~27 minutes (50 steps × 30 s/step)
- Full v6 run warm-started + 1 epoch: **~4 hours 22 minutes** (233 steps × 64 s/step)
- Final v6 eval metrics: loss 0.152, token accuracy 96.4%, entropy 0.16

**Before starting:** one M40 must be completely free. In practice this means temporarily stopping the coder llama-server or keeping it on the other M40. The arbiter stays up the whole time because it's Q4_K_M GGUF served by a process that doesn't care about the fine-tuning job happening elsewhere.

### Converting the adapter to GGUF

`llama.cpp`'s `convert_lora_to_gguf.py` produces a runtime-loadable adapter without any merge step. The input is the PEFT `checkpoint-N` directory; the output is a single `.gguf` file that llama-server takes via `--lora`.

```bash
python3 /home/jah/tools/llama.cpp/convert_lora_to_gguf.py \
  --outtype f16 \
  --base-model-id microsoft/phi-4 \
  --outfile /home/jah/models/hme-arbiter-v7-lora-f16.gguf \
  metrics/hme-arbiter-phi4/checkpoint-N
```

`--base-model-id` pulls only the base model's `config.json` + `tokenizer.json` from HuggingFace (a few MB). You don't need the full base weights cached for this step.

The produced file is ~85 MB for an r=32 LoRA on phi-4. f16 is lossless for this size; no reason to go smaller.

### Deploying

1. Copy / symlink the new GGUF to the path the unit expects (`/home/jah/Polychron/metrics/hme-arbiter-vN-lora.gguf` or edit the unit).
2. `sudo systemctl restart llamacpp-arbiter`
3. `curl -s http://127.0.0.1:8080/health` — wait for `{"status":"ok"}`.
4. Send a real planning query and verify the output uses only registry module names.

If you want a side-by-side A/B, run two llama-server instances on different ports with different `--lora` flags and compare on the same queries.

## Operational runbook

### Check what's actually running

```bash
systemctl status llamacpp-arbiter llamacpp-coder --no-pager
ss -tlnp | grep -E '8080|8081'
/home/jah/tools/llama-cpp-vulkan/llama-b8797/llama-server --list-devices
nvidia-smi --query-compute-apps=pid,process_name,used_gpu_memory --format=csv
```

### Arbiter failed to start

1. `tail -40 /var/log/llamacpp-arbiter.log` — look for `ErrorOutOfDeviceMemory` or `failed to load model`.
2. If OOM: check which Vulkan index actually has headroom right now (`--list-devices`), edit the unit's `--device Vulkan<N>` to match, `sudo systemctl daemon-reload && sudo systemctl restart llamacpp-arbiter`.
3. If "failed to load model": the path in the unit is wrong or the file is missing. `ls -la` the path, check symlinks.
4. If the LoRA is the problem: try starting the arbiter without `--lora` to isolate. A malformed adapter GGUF produces a tensor-shape mismatch error, not OOM.

### RAG engine ate too much VRAM

```bash
pkill -f hme_http.py
```

The MCP host relaunches it on the next tool call with a fresh allocation. This is the simplest fix for "jina grew to 18 GB overnight" bloat.

### Live LoRA swap without restart

```bash
curl -X POST http://127.0.0.1:8080/lora-adapters \
  -H 'Content-Type: application/json' \
  -d '[{"path":"/home/jah/models/hme-arbiter-v7-lora-f16.gguf","scale":1.0}]'
```

Requires the server to have been started with `--lora-init-without-apply` or to already have the target adapter path. Useful for A/B testing without restart churn.

## Next steps

Ordered roughly by impact vs effort.

1. **Validate v6 arbiter in real use (1–2 days, zero effort).** It passed one test query cleanly, but the real test is a round of evolution work. Watch for path hallucination, poor step decomposition, or ignoring the registry. If issues surface, the fix is to the corpus, not the training loop.

2. **Train a coder LoRA on the v6 coder corpus (~6 hours, ~60 GB temporary disk).** Same pipeline as the arbiter. The corpus already exists (`metrics/hme-coder-corpus-v6.jsonl`, 1622 examples). Needs:
   - Download `Qwen/Qwen3-Coder-30B-A3B-Instruct` HF safetensors (~60 GB, temporary — delete after LoRA GGUF export)
   - Sanity run on 50 steps (~45 min on 30B)
   - Full 1 epoch warm-started (~5 hours)
   - Convert LoRA to GGUF, add `--lora` to `llamacpp-coder.service`, restart
   - Net permanent disk cost: ~150 MB for the LoRA GGUF

3. **Stabilize Vulkan device enumeration.** Both service unit files currently hardcode `--device Vulkan1` and collide when free-memory ordering changes. Options: pin by PCI bus ID via `CUDA_VISIBLE_DEVICES` + `GGML_VK_VISIBLE_DEVICES`, or have a preflight script that picks the right index at start and rewrites the unit or exports an env override. Either removes the "works yesterday, breaks today" failure mode.

4. **Move the RAG engine off the contested M40s.** jina + bge-reranker together fit comfortably on the Intel iGPU (Vulkan0 has 48 GB UMA free). Forcing the shim to land embeddings there would give both M40s back to llama-server and eliminate the "jina grew to 18 GB" recurring problem. Requires adding a device selection path to `hme_http.py` and benchmarking iGPU embedding throughput vs M40.

5. **v7 corpus iteration.** The v6 corpus is 1962 examples across 5 sections. Gaps surfaced during v6 validation should feed into v7: more refusals for subtle near-miss module names, more architecture Q&A for layer boundaries, more planning examples that use multi-subsystem investigations. Training cost per iteration is ~4.5 hours + conversion; corpus generation is the bottleneck, not training.

6. **Unified factual base for all three cascade stages.** Right now the arbiter and coder corpora share sections A/D/E but diverge in format. A single canonical "HME facts" dataset keyed on module name, with per-role output templates layered on top, would make v7+ corpus generation declarative instead of per-role. Would also make it trivial to add a fourth role (e.g. a dedicated refactoring planner) without duplicating ground truth.
