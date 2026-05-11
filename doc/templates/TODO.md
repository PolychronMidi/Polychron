# Polychron HME TODO (handoff doc)

> Cross-cycle state. Every skill reads this on start and updates it on close. Three sections, in this order. See [doc/templates/SPEC.md](SPEC.md) for the full architectural plan.

## In flight

<!-- Exactly one line per currently-running skill, format:
  - [<skill-name> @ <utc-iso>] <one-line: what this skill is currently doing>
  Empty when no skill is running. -->

## Just shipped (last cycle)











<!-- Append-on-close, newest first. Trim to last 10; older history lives in
  the previous set's devlog at tools/HME/KB/devlog/. -->











- [E2] glm-5.1 quality probe: shipped a real refactor-proposal prompt (200-word, concrete code) and captured a coherent 6-bullet response. **Quality signal**: glm-5.1 named a specific data structure (`MODEL_ROUTING` dict), gave concrete code lines, addressed extensibility, and predicted impact of adding new providers. Zero hallucinated APIs in the output. **Adoption**: the refactor proposal itself is a candidate Phase 4 item (consolidate `_is_zen` startswith chain into a routing table for future kimi-*/qwen-*/minimax-* additions). (auto-shipped from SPEC checkbox flip)
- [E4] Proxy main-agent rewrite shipped inline in `hme_proxy.js` at the pre-`resolveUpstream` injection point (cleaner than a separate middleware file -- the mutation must happen on `clientReq.headers` before `resolveUpstream` reads them, and middlewares only see `payload`). When `OVERDRIVE_MODE=4` AND `payload.model` starts with `claude-` AND no `x-hme-upstream` header is already set: sets `x-hme-upstream: https://opencode.ai/zen/go`, injects `x-api-key: ${OPENCODE_API_KEY}`, drops the OAuth `authorization` header, rewrites `payload.model` to `deepseek-v4-pro`, wraps any string `message.content` as `[{type:"text",text:...}]` blocks. OAuth injection at `hme_proxy.js:679-704` naturally skips because `x-api-key` is set. Activation requires `OVERDRIVE_MODE=4` in `.env` + proxy restart. (auto-shipped from SPEC checkbox flip)
- [E2] `_label_for_model` shipped: `glm-5.1` -> `overdrive/zen/glm-5.1`. (auto-shipped from SPEC checkbox flip)
- [E2] `i/dispatch status` MODE descriptions updated: `4=main+E4=deepseek-pro / E5=glm-5.1 / E3=deepseek-flash / E1-E2=cascade`. (auto-shipped from SPEC checkbox flip)
- [E3] Live smoke verified: `_try_overdrive_model('glm-5.1', 'reply PONG', ...)` returned `'PONG'`; label resolved to `overdrive/zen/glm-5.1`. Synthesis-side MODE=4 path proven end-to-end through the proxy. (auto-shipped from SPEC checkbox flip)
- [E3] `_try_overdrive_model`: detector refactored to `_is_zen = startswith("deepseek-") or startswith("glm-")`. glm-* routes through the same Zen Go headers as deepseek-*. (auto-shipped from SPEC checkbox flip)
- [E3] `synthesis_reasoning.py`: shipped `elif _od_mode == "4":` branch -- E5 to glm-5.1 chain, E4 to deepseek-pro, E3 to deepseek-flash, E1-E2 to None. (auto-shipped from SPEC checkbox flip)
- [E3] `tools/HME/tests/specs/synthesis_overdrive_mode4.test.js` shipped: 4 tests (E5 to glm-5.1, E4 to deepseek-pro, E3 to deepseek-flash, E1/E2 to cascade). All pass. (auto-shipped from SPEC checkbox flip)
- [E3] Added `OVERDRIVE_MODE=4` documentation block to `.env` parallel to MODE=3, documenting the main-agent-swap semantic and per-tier mapping (main+E4=deepseek-pro, E5=glm-5.1, E3=deepseek-flash, E1-E2=cascade). (auto-shipped from SPEC checkbox flip)
- [E2] Captured per-tier `last_source` from live E1-E4 dispatch run: E1/E2 -> `nvidia/mistralai/mistral-large-3-675b-instruct-2512` (after `deepseek-v3.2` HTTP 410 EOL); E3 -> `overdrive/zen/deepseek-flash`; E4 -> `overdrive/zen/deepseek-pro`. **Harvested fix shipped same turn**: replaced EOL `deepseek-v3.2` with `deepseek-v4-pro` across `synthesis_nvidia.py:18` + `synthesis_reasoning.py:98,125`; added `deepseek-v4-flash` as new second-tier reasoning entry. NVIDIA `/v1/models` confirmed both v4 variants are served. Stale doc comment in `synthesis_nvidia.py:27` updated too. (auto-shipped from SPEC checkbox flip)

## Next up (queued for next cycle)

<!-- One line per queued item:
  - [<difficulty>] <description>. Reason: <source> -->

<!-- DONE 2026-05-11: deepseek-v3.2 replaced with deepseek-v4-pro across synthesis_nvidia.py:18 + synthesis_reasoning.py:98,125; deepseek-v4-flash added as new second-tier reasoning entry. NVIDIA endpoint confirmed serves both v4 variants. -->
- [E3] Cascade hallucinates structural facts when given grep/structural queries. Reason: live E1 test produced fabricated subdirectory names. Mitigation: docstring on `synthesis_reasoning.call` warning callers that E1/E2 are not safe for repo-structure questions; route those via direct grep tool calls.
- [E3] Promote deepseek-flash's E3 architecture-review finding (`_call_opus_overdrive` vs `_try_overdrive_model` entanglements) to a Phase 3 item once the entanglements are surfaced as concrete code citations. Reason: live E3 dispatch produced structured proposal but needs grounding pass.
- [E3] Cross-check deepseek-pro's E4 ProviderRegistry proposal against actual `synthesis_provider_base.OpenAIProvider` shape before adoption. Reason: live E4 dispatch produced 3-5 bullet design proposal that needs validation against existing code.

---

When this Next up is empty AND every `- [ ]` in [doc/templates/SPEC.md](SPEC.md) has been flipped to `[x]`, the dev cycle exits with `[no-work] <reason>`. See SPEC.md "Empty-queue bail" appendix.
