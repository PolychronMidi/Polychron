# Polychron HME TODO (handoff doc)

> Cross-cycle state. Every skill reads this on start and updates it on close. Three sections, in this order. See [doc/templates/SPEC.md](SPEC.md) for the full architectural plan.

## In flight

<!-- Exactly one line per currently-running skill, format:
  - [<skill-name> @ <utc-iso>] <one-line: what this skill is currently doing>
  Empty when no skill is running. -->

## Just shipped (last cycle)







<!-- Append-on-close, newest first. Trim to last 10; older history lives in
  the previous set's devlog at tools/HME/KB/devlog/. -->






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
