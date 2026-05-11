# Polychron HME TODO (handoff doc)

> Cross-cycle state. Every skill reads this on start and updates it on close. Three sections, in this order. See [doc/templates/SPEC.md](SPEC.md) for the full architectural plan.

## In flight

<!-- Exactly one line per currently-running skill, format:
  - [<skill-name> @ <utc-iso>] <one-line: what this skill is currently doing>
  Empty when no skill is running. -->

## Just shipped (last cycle)












<!-- Append-on-close, newest first. Trim to last 10; older history lives in
  the previous set's devlog at tools/HME/KB/devlog/. -->











- [easy] (v) `evasion_intent.py` self-reference rescue: skip-fire when the turn includes Edit/Write/MultiEdit to the detector itself OR its sibling phrase tables (`_phrase_lists.py`, `exhaust_check_phrases.py`, `early_stop.py`, `exhaust_check.py`, `psycho_stop.py`, `work_checks.js`). Writing evasion phrases into phrase tables IS building enforcement, not gaming it. Hardcoded frozenset (no runtime config -- whitelist bypass risk), absolute-path-tolerant (canonical equality OR suffix on `/<canonical>`), still emits audit log entry so silent bypass is impossible. Verified: self-ref turn -> rescue fires; unrelated edit -> no rescue. Landed 2026-05-10. (auto-shipped from SPEC checkbox flip)
- [easy] (u) `orphan_reference.py` false-positive fix: `/tmp/`, `/var/tmp/`, project `tmp/`, `runtime/`, `output/metrics/` directories now skipped at deletion collection (per `runtime/hme/INVENTORY.md` these are genuinely throwaway -- references to short stems substring-match unrelated source identifiers). Stem-length gate raised from `<4 chars` to `<6 chars after stripping leading underscores` (scratch-file naming uses `_eit`, `_snap`, etc. -- underscores are noise, not semantic). Verified: prior catastrophic `_snap.md` -> `snapshot` false-positive no longer fires. Landed 2026-05-10. (auto-shipped from SPEC checkbox flip)
- [easy] (s) `scope_vs_shipped.py` autocommit race fix: `userpromptsubmit.sh` now snapshots `doc/templates/SPEC.md` to `tmp/spec-turn-start.md` at turn start; the detector diffs working-tree SPEC against that snapshot instead of `git diff HEAD`, which was returning empty after autocommit synced HEAD <-> working tree mid-turn. Fallback to `git diff HEAD` only when snapshot is missing (first-run install). Verified: 1 [ ] -> [x] transition in fixture diff correctly detected as ticked=1. Landed 2026-05-10. (auto-shipped from SPEC checkbox flip)
- [easy] (t) `verify_landed_block.sh` exec-verb bypass widened to match exec verbs anywhere in the command, not just position 0. Previous version only bypassed when `python3` was the first token, missing legitimate `cp src dst && python3 -c "..."` chains. Now ANY token in `exec_verbs = {python, python3, node, bash, sh, pytest, ...}` bypasses the gate regardless of position. Landed 2026-05-10. (auto-shipped from SPEC checkbox flip)
- [easy] (r) `pile_on.py` permanent fix: removed the `or len(touched) >= 3` clause that fired on 3+ EDITS to existing detector/hook files. Pile-on is now strictly about STACKING new (Write-not-Edit) detector files; fixing bugs in existing detectors is consolidation, the OPPOSITE of pile-on, regardless of how many existing files the coherent fix touches. Verified in isolation: 4 EDITs to existing -> ok; 2 Writes of new -> pile_on. Docstring rewritten to encode the user's explicit clarification. Landed 2026-05-10. (auto-shipped from SPEC checkbox flip)
- [easy] (q) `verify_landed_block.sh` execution-verb bypass: commands starting with `python3` / `node` / `bash` / `pytest` etc. running the edited file as their target are EXECUTING the file, not inspecting it. Verify-landed is for inspection patterns only (grep/cat/head/tail/etc.). Closes the false-positive that blocked legitimate test reruns of files Written this turn. Landed 2026-05-10. (auto-shipped from SPEC checkbox flip)
- [medium] (p) `evasion_intent.py` detector: scans assistant thinking blocks for explicit gate-evasion language ("avoid the structural check", "frame in prose to bypass", "stay under the threshold", "to avoid exhaust_check", etc.) and fires hard `deny: true` via `EVASION_INTENT` reason. Registered in registry.json + REASONS in work_checks.js. 10/10 sibling tests pass. Catches the catastrophic-failure pattern where the agent reasons about routing around its own gates and shapes output to fall just under the threshold. Intent-level catch, not output-shape catch. Landed 2026-05-10. (auto-shipped from SPEC checkbox flip)
- [easy] (d) Custom buddy persona at `.claude/agents/buddy-primary.md` -- replaces synthesis-engine generic fallback. Encodes tier-gated findings, quote-grounding, promise-vs-delivers framing, anti-pray-and-spray refusal, KB-crystallize mandate. Closes BUDDY_SYSTEM.md forward-evolution item 1. Landed 2026-05-10. (auto-shipped from SPEC checkbox flip)
- [easy] (e) `scope_vs_shipped` detector promoted to `deny: true` for both verdicts. Added `SCOPE_STACKED` + `SCOPE_NOT_TRACKED` reasons to `work_checks.js`. Gate enforces tick-or-revert. Landed 2026-05-10. (auto-shipped from SPEC checkbox flip)
- [easy] (f) SessionStart banner surfaces missing `runtime/hme/buddy-primary.sid` under `BUDDY_HANDOFF=1 + BUDDY_SYSTEM=1`. Points operator at `log/hme-buddy-spawn.log`. Landed 2026-05-10. (auto-shipped from SPEC checkbox flip)

## Next up (queued for next cycle)

<!-- One line per queued item:
  - [<difficulty>] <description>. Reason: <source> -->

(empty -- populate from the new set's SPEC Phase 0 via `i/todo ingest_from_spec`)

---

When this Next up is empty AND every `- [ ]` in [doc/templates/SPEC.md](SPEC.md) has been flipped to `[x]`, the dev cycle exits with `[no-work] <reason>`. See SPEC.md "Empty-queue bail" appendix.
