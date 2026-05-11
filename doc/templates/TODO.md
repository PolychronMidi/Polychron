# Polychron HME TODO (handoff doc)

> Cross-cycle state. Every skill reads this on start and updates it on close. Three sections, in this order. See [doc/templates/SPEC.md](SPEC.md) for the full architectural plan.

## In flight

<!-- Exactly one line per currently-running skill, format:
  - [<skill-name> @ <utc-iso>] <one-line: what this skill is currently doing>
  Empty when no skill is running. -->

## Just shipped (last cycle)



<!-- Append-on-close, newest first. Trim to last 10; older history lives in
  the previous set's devlog at tools/HME/KB/devlog/. -->



- [E1] Enumerated modules in `synthesis/` -- **HALLUCINATION FINDING**: cascade tier (mistral-large-3 after NVIDIA deepseek-v3.2 returned HTTP 410 EOL) fabricated subdirectory names (`constraint_enricher`, `callgraph_builder`, `kb_augmenter`, etc.) that DON'T EXIST. Real dir contains only `.py` files. **Eval signal**: do not route grep/structural-fact tasks to cascade -- use E3+ when grounding to filesystem state matters. (auto-shipped from SPEC checkbox flip)
- [E1] Listed every reference to `OVERDRIVE_MODE` across the codebase. **Categorized inventory:** consumers (`synthesis_reasoning.py:344`, `buddy_dispatch_status.py:227`); docs (`.env:265-294`, `SPEC.md`, `TODO.md`, `loc-ignore.txt:193`); tests (`synthesis_overdrive_mode2.test.js` x5, `synthesis_overdrive_mode3.test.js` x6); legacy docstring/comment refs (`synthesis_reasoning.py:262,323,343`, `synthesis_overdrive.py:253,438,440,452,457`, `verify_coherence/env_settings.py:98`). **Finding harvested**: `synthesis_reasoning.py:343` comment was stale (only mentioned MODE=0/1/2, missing MODE=3) -- fixed in this turn. (auto-shipped from SPEC checkbox flip)
- [2026-05-11] `OVERDRIVE_MODE=3` routing: E5 to Opus, E4 to deepseek-v4-pro, E3 to deepseek-v4-flash, E1-E2 to cascade. Routes through HME proxy via `X-HME-Upstream: https://opencode.ai/zen/go` + `x-api-key`; Zen's `/v1/messages` is Anthropic-shape native (no translator). Live smoke verified both DeepSeek models. `tools/HME/service/server/tools_analysis/synthesis/{synthesis_reasoning,synthesis_overdrive}.py`, `tools/HME/tests/specs/synthesis_overdrive_mode3.test.js` (6 tests), `.env`, `tools/HME/scripts/buddy_dispatch_status.py`
- [2026-05-11] `_try_overdrive_model` hardening: per-model `max_tokens` cap (haiku=64K) + auto-drop `thinking` when budget exceeds cap. Surfaced by LIFESAVER during smoke testing. `tools/HME/service/server/tools_analysis/synthesis/synthesis_overdrive.py`
- [2026-05-11] `verify_landed_block.sh` bypass for `git` + `/tmp/` paths (snapshot/scratch reads aren't source-file verification). `tools/HME/hooks/pretooluse/bash/verify_landed_block.sh`

## Next up (queued for next cycle)

<!-- One line per queued item:
  - [<difficulty>] <description>. Reason: <source> -->

(empty -- populate from the new set's SPEC Phase 0 via `i/todo ingest_from_spec`)

---

When this Next up is empty AND every `- [ ]` in [doc/templates/SPEC.md](SPEC.md) has been flipped to `[x]`, the dev cycle exits with `[no-work] <reason>`. See SPEC.md "Empty-queue bail" appendix.
