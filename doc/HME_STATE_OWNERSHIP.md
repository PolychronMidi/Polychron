# HME State-File Ownership Registry

**Status:** Living document. Updated when a new state file is added or a
writer's path changes. Surfaced by peer-review iter 136 as the single
most-impactful unwatched architectural contract: HME spans four
runtimes (bash hooks, Node proxy, Python worker, daemon processes)
that all touch shared filesystem state, and there is no automated
guard against two runtimes writing the same file without coordination.

The fix surface this document represents:
1. Make ownership explicit per file
2. Eventually wire a verifier that grep-checks no actor outside the
   declared owner-set writes to each file (similar to how
   `audit-marker-registry.py` checks marker producers/consumers)
3. When introducing a new shared-state file, add it here BEFORE
   shipping. Multi-writer files require an explicit coordination
   strategy (locking, append-only-with-source-tag, single-truth
   broker endpoint).

---

## State files with single owner (safe)

| File | Owner | Read-only consumers |
|---|---|---|
| `tmp/hme-thread.sid` | `i/thread init/stop` | `agent_direct.dispatch_thread`, `i/thread send/status` |
| `tmp/hme-thread-call-count` | `agent_direct.dispatch_thread` | (none) |
| `tmp/hme-proxy-supervisor.pid` | `proxy-supervisor.sh` | shell ops, monitoring |
| `tmp/hme-proxy-maintenance.flag` | `proxy-maintenance.sh` | `proxy-supervisor.sh` |
| `tmp/hme-universal-pulse.heartbeat` | `universal_pulse.py` | `validate_startup.py` |
| `tmp/hme-non-hme-streak.score` | `_safety.sh` (`_streak_tick`) | `_safety.sh` (`_streak_check`) |
| `tmp/hme-streak-warn.txt` | `streak_calibrator.py` | `_safety.sh` |
| `tmp/hme-onboarding.state` | `_onboarding.sh` helpers | onboarding hook chain |
| `tmp/hme-tab.txt` | `_append_file_to_tab` (multiple hooks) | `precompact.sh`, `postcompact.sh` |
| `tmp/hme-log-errors.watermark` | `hme_log_watermark.js` | `hme_log_watermark.js` |
| `tmp/hme-supervisor-abandoned` | `proxy-supervisor.sh` (sentinel write) | `userpromptsubmit.sh` |
| `output/metrics/detector-stats.jsonl` | each detector's `_emit_stats` | `audit-detector-stats.py` |
| `output/metrics/hme-predictions.jsonl` | `cascade_analysis._log_prediction` | reconciler (currently dead) |
| `output/metrics/hme-enricher-efficacy.jsonl` | `context_budget.js._recordFire` | (currently dead) |
| `output/metrics/hme-activity.jsonl` | `tools/HME/activity/emit.py` | `i/status`, blindspots reports |
| `tools/HME/before-editing-cache.json` | worker's pre-edit cache writer | `before_editing` tool |
| `tools/HME/KB/*.lance` | worker's KB indexer | `_helpers.knowledge_search` |

---

## State files with MULTIPLE writers (require coordination)

These are the structural risk. Each row needs an explicit strategy.

### `log/hme-errors.log`

**Writers:**
- `tools/HME/activity/universal_pulse.py` — `[universal_pulse]` prefix (self-origin)
- `tools/HME/proxy/middleware/hme_log_watermark.js` — escalated ERROR lines from `log/hme.log`
- `tools/HME/proxy/middleware/mcp_fail_scan.js` — agent FAIL strings
- `tools/HME/hooks/lifecycle/userpromptsubmit.sh` — autocommit failure banners (via `_autocommit.sh`)
- `tools/HME/hooks/helpers/_autocommit.sh` — direct append on commit failure
- `tools/HME/hooks/helpers/safety/curl.sh` — `_safe_curl` failure entries
- `tools/HME/hooks/helpers/safety/misc_safe.sh` — `_safe_*` helper failures
- `tools/HME/hooks/lifecycle/sessionstart.sh` — broken-hook detection at boot

**Reader:** `tools/HME/hooks/lifecycle/stop/lifesaver.sh` (and `userpromptsubmit.sh` mid-turn)

**Coordination strategy:**
- Append-only (POSIX guarantees atomic appends ≤ PIPE_BUF for single `write()` calls; all writers should use single-line appends)
- Source-tag prefix is the discrimination key. lifesaver.sh now classifies entries by tag prefix to demote self-origin to reveal-register (peer-review iter 130 fix). New writers MUST prefix with a recognizable tag and register the tag in `tools/HME/proxy/middleware/_markers.js` HME_SELFORIGIN_*.

### `tmp/hme-nexus.state`

**Writers:**
- `tools/HME/proxy/middleware/index.js` — `_nexusMark` from middleware (Edit/Write/Read/HME_*)
- `tools/HME/hooks/posttooluse/posttooluse_hme_review.sh` — clears EDIT, marks REVIEW
- `tools/HME/hooks/lifecycle/stop/nexus_audit.sh` — periodic audit/prune
- `tools/HME/hooks/lifecycle/userpromptsubmit.sh` — turnstart context

**Coordination strategy:**
- Append-only writes
- Periodic prune to bounded line count (`_nexus_prune_clean_edits`)
- ⚠ **Risk**: `nexus_audit.sh` rewrites the file (truncate + re-write) which can collide with a concurrent middleware append. No `flock` currently. **Open work item**.

### `tmp/hme-errors.turnstart` and `tmp/hme-errors.lastread`

**Writers:**
- `userpromptsubmit.sh:119` writes `turnstart`
- `lifesaver.sh` writes both turnstart + lastread on Stop

**Reader:** `streak_calibrator.py`, `lifesaver.sh`

**Coordination strategy:**
- Single-actor-per-event-class: turnstart written ONLY at user-prompt-submit; lastread written ONLY at stop. Sequential; not concurrent.
- If parallel sessions ever share the same `tmp/`, this breaks.

---

## Verifier targets (TODO)

A future `audit-state-file-ownership.py` should:

1. Statically grep for `>FILE`, `> "$FILE"`, `fs.writeFileSync`, `fs.appendFileSync`, `open(path, "w"|"a")` etc. across the codebase
2. Resolve each target path to one of the entries above
3. Fail when:
   - A file in the "single owner" table has a writer outside its declared owner
   - A file in the "multiple writers" table has a writer not registered here
   - A new shared-state file appears that's not in either table

This closes the "state-file ownership invariant" peer-review iter 136 named
as the most-impactful unwatched architectural contract.
