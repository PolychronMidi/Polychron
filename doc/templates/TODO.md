# Polychron HME TODO (handoff doc)

> Cross-cycle state. Every skill reads this on start and updates it on close. Three sections, in this order. See [doc/templates/SPEC.md](SPEC.md) for the full architectural plan.

## In flight

<!-- Exactly one line per currently-running skill, format:
  - [<skill-name> @ <utc-iso>] <one-line: what this skill is currently doing>
  Empty when no skill is running. -->

## Just shipped (last cycle)


<!-- Append-on-close, newest first. Trim to last 10; older history lives in
  the previous set's devlog at tools/HME/KB/devlog/. -->

- [easy] (pre) Fix consult-sentinel wipe: `_write_consult_sentinel` helper extracted; called AFTER `synthesis_reasoning.call()` returns (the proxy at 9099 fires UserPromptSubmit during the synthesis HTTP path, which wipes mid-call sentinel writes). Landed 2026-05-10 in `buddy_handoff_consult.py`. (auto-shipped from SPEC checkbox flip)
- [easy] (pre) Fix verify-landed checker: filename-shape regex only (overbroad `\b{mod}\b` match removed); turn-edit recording deferred to AFTER blocking gates. Landed 2026-05-10 in `verify_landed_block.sh` + `pretooluse_edit.sh`. (auto-shipped from SPEC checkbox flip)

## Next up (queued for next cycle)

<!-- One line per queued item:
  - [<difficulty>] <description>. Reason: <source> -->

(empty -- populate from the new set's SPEC Phase 0 via `i/todo ingest_from_spec`)

---

When this Next up is empty AND every `- [ ]` in [doc/templates/SPEC.md](SPEC.md) has been flipped to `[x]`, the dev cycle exits with `[no-work] <reason>`. See SPEC.md "Empty-queue bail" appendix.
