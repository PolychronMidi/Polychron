# Polychron HME TODO (handoff doc)

> Cross-cycle state. Every skill reads this on start and updates it on close. Three sections, in this order. See [doc/templates/SPEC.md](SPEC.md) for the full architectural plan.

## In flight

<!-- Exactly one line per currently-running skill, format:
  - [<skill-name> @ <utc-iso>] <one-line: what this skill is currently doing>
  Empty when no skill is running. -->

## Just shipped (last cycle)











<!-- Append-on-close, newest first. Trim to last 10; older history lives in
  the previous set's devlog at tools/HME/KB/devlog/. -->










- [E5] Whole-surface OVERDRIVE_MODE coherence sweep: take the inventory from E4, plus any new sites surfaced by grep `OVERDRIVE_MODE` across `tools/HME/`, `.env`, `config/`, `doc/`, `scripts/`, `runtime/`, and any test that pins a mode value. Produce one unified verdict table (file:line → behavior under each MODE value 0..5 → correctness) and fix every drifted site. Outcome: MODE=5 has zero silent-fallthrough or undocumented-default sites left. (auto-shipped from SPEC checkbox flip)
- [E5] If E4's audit finds MODE=2/3/4 collapsible into MODE=5's registry-driven shape, execute the consolidation: add the equivalent named-chain entries to `config/models.json` (e.g., a `legacy_chains.mode2 = ["claude-opus-4-7", "claude-sonnet-4-6"]` block), and after the E3 refactor lands, remove the four hardcoded resolver fns in favor of a single registry-driven lookup keyed by mode string. Tests: `synthesis_overdrive_mode{2,3,4}.test.js` must continue to pass unchanged. If E4 found them not-collapsible, this item flips to "document the irreducibility in `doc/HME.md` MODE-evolution section and close." (auto-shipped from SPEC checkbox flip)
- [E3] In `config/models.json`, decide and document the `manually_toprank.E5 = ["mimo-v2.5-pro-go"]` intent: MiMo (`tier_score=4`) currently leads DeepSeek-Pro (`tier_score=5`). Precedence in `_resolve_mode5_chain` is already deterministic (top-rank first, then tier_score desc within cost class) -- the question is whether the data is correct. Either (a) raise MiMo's `tier_score` to 5 and drop the override (data fix), or (b) keep the override and add a `_meta.toprank_rationale.E5` field explaining why score-inversion is intentional. Avoid having two ranking mechanisms silently fight. (auto-shipped from SPEC checkbox flip)
- [E3] Refactor the MODE=2/3/4/5 elif ladder in `synthesis_reasoning.call` (lines 362-443) into a dispatcher dict `_MODE_DISPATCHERS: {str -> Callable[[tier], Optional[tuple[chain, allow_subagent]]]}`. Each mode contributes one resolver fn (`_resolve_mode2_chain`, `_resolve_mode3_chain`, `_resolve_mode4_chain`, existing `_resolve_mode5_chain`). The dispatcher loop becomes mode-agnostic: lookup → resolve → call `_call_opus_overdrive` → set `_last_source` → return. Resolves the OCP violation: adding MODE=6 will be a one-line registration. (auto-shipped from SPEC checkbox flip)
- [E4] Design-pattern audit: are MODE=2/3/4 degenerate cases of MODE=5 (one-element registry chains)? Compare each mode's chain definition to what a MODE=5 lookup would return if `config/models.json` had matching entries. Include an early-exit audit: any caller that branches on `OVERDRIVE_MODE` before reaching synthesis (so collapsing the elif-arms does not break a non-synthesis path). If collapsible, produce a migration sketch (do not execute -- queue to E5). If not collapsible, document the divergence. (auto-shipped from SPEC checkbox flip)
- [E4] Cross-file MODE=N gate audit. Inventory every site that reads `OVERDRIVE_MODE` and verify MODE=5 reachability: `hme_proxy.js:486` (must NOT swap; verify falls through), `proxy-supervisor.sh:129`, `proxy-watchdog.sh:40`, `launcher/polychron-launch.sh:75` (the OmniRoute branches), `buddy_dispatch_status.py:227` (display), `verify_coherence/env_settings.py:98` (auth injection check). Produce a per-site verdict (correct / drifted / undefined-behavior) and fix the drifted ones in the same pass. (auto-shipped from SPEC checkbox flip)
- [E2] In `synthesis_overdrive.py`, locate the legacy "OVERDRIVE_MODE=1 Opus-then-Sonnet" comment/docstring drift at lines 253/438/440/452/457 (per mode4 devlog inventory) -- rewrite each to acknowledge MODE>=2 callers passing `chain_override`. No logic change. (auto-shipped from SPEC checkbox flip)
- [E2] Sweep active docs (`README.md`, `doc/HME.md`, `doc/SRC.md`, `doc/templates/*.md`, `tools/HME/KB/learnings.jsonl` if mode-mentions, `.env` MODE description block) for mode enumerations that stop at 3 or 4; produce a per-file diff list and apply trivial textual fixes (drift only -- not semantic rewrites). (auto-shipped from SPEC checkbox flip)
- [E1] Fix stale "Opus-then-Sonnet chain" docstring at `synthesis_overdrive.py:474` -- only describes MODE=1; reword to "OVERDRIVE_MODE=1 path -- Opus-then-Sonnet chain. MODE>=2 paths supply `chain_override` and reuse this function for the actual per-model dispatch." (auto-shipped from SPEC checkbox flip)
- [E1] Fix stale mode-enumeration comment at `synthesis_reasoning.py:354` ("0=cascade; 1=Opus-all; 2=Opus/Sonnet/cascade; 3=Opus/DSeek/cascade.") -- extend to cover MODE=4 (main-agent swap + DSeek tiers) and MODE=5 (registry-driven cascade). (auto-shipped from SPEC checkbox flip)

## Next up (queued for next cycle)

<!-- One line per queued item:
  - [<difficulty>] <description>. Reason: <source> -->

(empty -- populate from the new set's SPEC Phase 0 via `i/todo ingest_from_spec`)

---

When this Next up is empty AND every `- [ ]` in [doc/templates/SPEC.md](SPEC.md) has been flipped to `[x]`, the dev cycle exits with `[no-work] <reason>`. See SPEC.md "Empty-queue bail" appendix.
