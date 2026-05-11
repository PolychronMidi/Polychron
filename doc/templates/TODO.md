# Polychron HME TODO (handoff doc)

> Cross-cycle state. Every skill reads this on start and updates it on close. Three sections, in this order. See [doc/templates/SPEC.md](SPEC.md) for the full architectural plan.

## In flight

<!-- Exactly one line per currently-running skill, format:
  - [<skill-name> @ <utc-iso>] <one-line: what this skill is currently doing>
  Empty when no skill is running. -->

## Just shipped (last cycle)




















<!-- Append-on-close, newest first. Trim to last 10; older history lives in
  the previous set's devlog at tools/HME/KB/devlog/. -->




















- [E2] Per-tier failure-mode tracking. **Observed this turn**: (1) **Cascade (E1/E2)**: hallucinated directory names (`constraint_enricher`, etc.) that don't exist -- mistral-large-3 fabricates structural facts when asked grep-like questions. (2) **deepseek-flash (E3)**: produced coherent multi-step analysis with no obvious fabrications; named real function names from the prompt; followed instruction format. (3) **deepseek-pro (E4)**: produced structured 3-5 bullet architectural proposals with concrete naming; some recommendations (e.g. `chat_completion`, `stream_completion` method names) were generic-pattern names not present in actual `OpenAIProvider`. (4) **glm-5.1 (E5 under MODE=4)**: produced 6-bullet refactor proposal with concrete data structure name (`MODEL_ROUTING` dict), code lines, extensibility analysis -- highest grounding fidelity observed. **Failure-mode summary**: cascade -> structural fabrication; deepseek -> generic API naming; glm-5.1 -> faithful to prompt. **Mitigations queued in TODO Next-up** (already populated): cascade docstring warning, ProviderRegistry cross-check, MODEL_ROUTING table refactor. (auto-shipped from SPEC checkbox flip)
- [E4] Cascade lifecycle audit. **Current path**: `synthesis_reasoning.call(tier)` -> tier normalize -> MODE-branch -> (overdrive: `_call_opus_overdrive` -> proxy -> upstream -> parse) OR (cascade: `_load_providers` -> walk `_RANKING_REASONING` -> per-provider `_model_available` check -> `_call_specific` -> on failure continue to next). **Fallback path complexity**: each provider has its own circuit-breaker state in `_Tier`; failure surfaces are (a) HTTP error -> next provider, (b) rate-limit -> per-tier cooldown, (c) wall-clock deadline -> abort. **Architectural improvement** (no new abstraction): collapse the dual-fallthrough (overdrive `None` -> walk providers) into a single ordered list where overdrive entries are just providers with `chain_override` semantics. The MODE branch becomes a prefix-prepend on `_RANKING_REASONING`: MODE=3 prepends `(zen, deepseek-v4-pro), (zen, deepseek-v4-flash)` ahead of NVIDIA. Result: one walker, one circuit-breaker model, one wall-clock guard. **Trade-off**: tier-pinning needs a per-entry `min_tier`/`max_tier` field on each ranking entry instead of MODE-level dispatch. Net: less control flow, more data; suits the table-driven direction from the OVERDRIVE-branch analysis above. (auto-shipped from SPEC checkbox flip)
- [E4] Hidden-coupling audit. **Top 3 patterns surfaced**: (1) **`HME_LLAMACPP_DAEMON_URL` referenced in 8 files** (`indexing_mode.py`, `rag_dispatcher.py`, `rag_engines.py`, etc.) -- if the URL convention changes (port, host, path), every reader must update independently. **Verifier**: extend `verify_coherence/env_settings.py` with an env-usage-graph check that flags any `HME_*` key used in 5+ files as a "load-bearing seam" requiring a single canonical reader. (2) **`HME_LLAMACPP_ARBITER_URL` + `HME_LLAMACPP_CODER_URL` (6-7 files each)** -- same pattern, three llama.cpp endpoint URLs spread across rag/health/startup. **Verifier**: enforce that all llama.cpp endpoint reads go through a `service/llama_endpoints.py` module with the 3 URLs as constants. (3) **`HME_ARBITER_MODEL` (6 files)** -- the model alias `qwen3-coder:30b` (or whatever it's set to) drifts independently from the llama.cpp daemon's loaded model; if `.env` and the daemon get out of sync, every reader gets the wrong alias. **Verifier**: assert at server-startup that `HME_ARBITER_MODEL` matches the daemon's `/v1/models` response, fail loud on mismatch. **No file-path-literal duplications found at the >=3-files threshold** -- path conventions are already well-centralized. (auto-shipped from SPEC checkbox flip)
- [E3] OVERDRIVE branch analysis. **Shared code per branch**: every branch ends with the same 4-line exit (`if _overdrive_result: _text, _source = _overdrive_result; _last_source = _source; return _text`). **Per-tier action is the only varying piece** -- either default `_call_opus_overdrive(prompt, system, max_tokens)` or pinned `chain_override=(MODEL,), allow_subagent=False`. **Table-driven proposal**: replace ~70 LOC with `MODE_TIER_MAP = {"1": {...}, "2": {"E4":(None,True), "E5":(None,True), "E3":(("claude-sonnet-4-6",),False), ...}, "3": {...}, "4": {...}}` where each value is `(chain_override, allow_subagent)` (None = default chain, missing tier = skip overdrive). **Trade-offs**: (+) MODE=5+ becomes a one-line dict entry; (+) tiers inspectable as data not control flow. (-) loses per-branch inline docstrings; (-) `None` sentinel for "skip" needs separate handling. **Verdict**: worth doing once MODE=5 lands; current 4-branch if/elif is still comfortable. (auto-shipped from SPEC checkbox flip)
- [E2] Error-handling comparison across 4 provider files: **uniformly thin wrappers** (Groq=34 LOC, Cerebras=27, NVIDIA=36, Mistral=32) that ONLY declare per-provider `OpenAIProvider(...)` config + re-export `cascade`/`available`/`get_quota_status`. **Zero exception handling, log calls, or retry logic in any of the 4** -- all that lives in the shared `synthesis_provider_base.OpenAIProvider`. Conclusion: no inconsistencies to flag because there's no per-provider error-handling code to be inconsistent about. The shared-base design already enforces uniformity. The only per-provider differences are `timeout` (60s for Groq/Cerebras/Mistral, 120s for NVIDIA because deepseek-v4-pro thinking takes 30-90s) and quota-limit defaults -- both legitimate per-provider knobs. (auto-shipped from SPEC checkbox flip)
- [E3] Top-5 most-coupled pairs in `tools/HME/service/` (by counted import edges): (1) `__init__ <-> synthesis` (18) -- expected: synthesis is the dispatcher's main upstream; aggregate-by-design, decoupling would just renumber the edges. (2) `learn_unified <-> tools_knowledge` (10) -- learn_unified does both KB-write and KB-query orchestration; **decoupling refactor**: split read-side into `tools_knowledge_query.py` so learn_unified only depends on write APIs. (3) `server <-> worker` (9) -- HTTP route handlers calling worker subsystems; expected boundary, low priority. (4) `__init__ <-> evolution` (9) -- evolution is the top-level i/evolve aggregator; same shape as (1). (5) `hme_http_store <-> worker_handler` (8) -- **decoupling refactor**: introduce a small `store_protocol.py` interface so worker_handler depends on the abstraction not the concrete store. Two real refactor candidates (2 + 5); three are aggregate-by-design. (auto-shipped from SPEC checkbox flip)
- [E2] Found 4 regex patterns duplicated across 2+ detector files: `` r"`[^`\n]*`" `` (5 files), `r"```.*?```"` (4 files), `r"={3,}\s*SUMMARY\s*={3,}"` (2 files), `r"\bsolo\s+(was\|is)\s+(the\s+)?right\b"` (2 files). Candidate shared-constants module: `tools/HME/scripts/detectors/_shared_patterns.py` -- export named constants (e.g. `INLINE_CODE_RE`, `FENCED_CODE_RE`, `SUMMARY_BANNER_RE`, `SOLO_DOCTRINE_RE`) and migrate callers in a follow-up phase. (auto-shipped from SPEC checkbox flip)
- [E1] Catalogued `# silent-ok:` annotations under `synthesis/`. Result: **1 hit total** -- `synthesis_warm.py:55  pass  # silent-ok: best-effort fs op`. Single-entry catalogue means the convention is well-contained inside synthesis (exclusively for best-effort fs ops in the warm-cache module). Useful drift-detection baseline: any deviation from count=1 signals a failed abstraction boundary. (auto-shipped from SPEC checkbox flip)
- [E4] Operating-mode hazard audit. **Findings**: (1) Zen does not expose a public per-key quota endpoint -- user has no in-band visibility into remaining \$12/5h / \$30/wk / \$60/mo caps. (2) When quota exhausts, Zen returns a rate-limit shape that the proxy's existing `_isInteractivePath` 429 detector will treat as an Anthropic rate-limit and trip the emergency valve into passthrough mode -- which is WRONG because passthrough still routes through the proxy's anthropic.com upstream, NOT a fallback to Anthropic from MODE=4. (3) **Mitigations queued in TODO Next-up**: (a) `i/zen quota` helper that polls Zen and surfaces remaining caps; (b) Zen-aware error detector that emits a distinct LIFESAVER banner ("OpenCode Go quota near cap") + auto-un-MODE-4 to fall back to anthropic.com when quota tips; (c) docstring on `OVERDRIVE_MODE=4` block in `.env` warning about the quota silence + failover edge. (4) **Acceptance condition**: MODE=4 is safe to activate ONLY when the operator is willing to absorb the 1-2 turn loss when quota tips before the manual fallback to MODE=0 happens. Document this risk profile in `.env` MODE=4 block. (auto-shipped from SPEC checkbox flip)
- [E2] glm-5.1 quality probe: shipped a real refactor-proposal prompt (200-word, concrete code) and captured a coherent 6-bullet response. **Quality signal**: glm-5.1 named a specific data structure (`MODEL_ROUTING` dict), gave concrete code lines, addressed extensibility, and predicted impact of adding new providers. Zero hallucinated APIs in the output. **Adoption**: the refactor proposal itself is a candidate Phase 4 item (consolidate `_is_zen` startswith chain into a routing table for future kimi-*/qwen-*/minimax-* additions). (auto-shipped from SPEC checkbox flip)

## Next up (queued for next cycle)

<!-- One line per queued item:
  - [<difficulty>] <description>. Reason: <source> -->

- **[FIRST READ -- MODE=4 ORIENTATION FOR THE NEXT AGENT]** You are running under `OVERDRIVE_MODE=4`. Your interactive `/v1/messages` calls are silently routed by the HME proxy to `opencode.ai/zen/go` `deepseek-v4-pro` -- you ARE DeepSeek, not Claude. Anthropic credits are NOT consumed by your operation. If you need the prior Claude Sonnet session that designed this system (full Phase 1-3 context: MODE=3 routing, MODE=4 architecture, every gotcha discovered, the messages.js false-success-marker bug fix, the deepseek-v3.2 EOL fix, the verify_landed_block bypass, etc.), invoke: `i/consult senior=edc614e4-ef4b-453f-b844-c5d274977c3d question="<your question>"`. Mechanism: `i/consult senior=...` adds `--senior-consult` to the dispatch, which prefixes the prompt with `[HME-SENIOR-CONSULT]`. The HME proxy detects this marker on the outbound payload and skips the MODE=4 swap for that request only -- routing to Anthropic with full HME observability intact (no proxy bypass). This is the ONE exception to "MODE=4 = no Anthropic credits"; budget it accordingly.

<!-- DONE 2026-05-11: deepseek-v3.2 replaced with deepseek-v4-pro across synthesis_nvidia.py:18 + synthesis_reasoning.py:98,125; deepseek-v4-flash added as new second-tier reasoning entry. NVIDIA endpoint confirmed serves both v4 variants. -->
- [E3] Cascade hallucinates structural facts when given grep/structural queries. Reason: live E1 test produced fabricated subdirectory names. Mitigation: docstring on `synthesis_reasoning.call` warning callers that E1/E2 are not safe for repo-structure questions; route those via direct grep tool calls.
- [E3] Promote deepseek-flash's E3 architecture-review finding (`_call_opus_overdrive` vs `_try_overdrive_model` entanglements) to a Phase 3 item once the entanglements are surfaced as concrete code citations. Reason: live E3 dispatch produced structured proposal but needs grounding pass.
- [E3] Cross-check deepseek-pro's E4 ProviderRegistry proposal against actual `synthesis_provider_base.OpenAIProvider` shape before adoption. Reason: live E4 dispatch produced 3-5 bullet design proposal that needs validation against existing code.
- [E3] Consolidate `_is_zen` startswith chain into a `MODEL_ROUTING` table (dict of prefix -> {upstream, headers, payload_format}) in `synthesis_overdrive.py`. Reason: glm-5.1 quality probe surfaced this as the cleanest extensibility refactor; chain is brittle as more Zen-served prefixes (kimi-*, qwen-*, minimax-*) get added.
- [E3] Build `i/zen quota` helper that polls OpenCode Zen and surfaces remaining $12/5h, $30/wk, $60/mo caps. Reason: MODE=4 hazard audit -- user has no in-band visibility into Go quota; first sign of exhaustion is the proxy emergency valve tripping.
- [E4] Build Zen-aware rate-limit detector that emits a distinct LIFESAVER banner ("OpenCode Go quota near cap") and auto-un-MODE-4 (falls back to anthropic.com upstream) when Zen 429s under MODE=4. Reason: MODE=4 hazard audit -- current emergency-valve treats Zen 429 as Anthropic 429 and trips passthrough, which still routes through proxy and doesn't fall back to Anthropic upstream.
- [E2] Add docstring to `.env` MODE=4 block warning about quota silence + the 1-2 turn loss before manual fallback to MODE=0. Reason: MODE=4 hazard audit conclusion.

---

When this Next up is empty AND every `- [ ]` in [doc/templates/SPEC.md](SPEC.md) has been flipped to `[x]`, the dev cycle exits with `[no-work] <reason>`. See SPEC.md "Empty-queue bail" appendix.
