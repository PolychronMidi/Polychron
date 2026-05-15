# `runtime/hme/` — durable inter-script state

**Why this dir exists separately from `tmp/`:** `tmp/` is genuinely
throwaway (rotating dump dirs, scratch files, single-shot snapshots).
Anything that constitutes a CONTRACT between two scripts — a flag the
writer expects the reader to consume, a state file the lifecycle depends
on — belongs here, where it survives a `tmp/` flush.

## Naming convention

- File names match the constants in `tools/HME/proxy/shared.js`
  (`RUNTIME_DIR`-prefixed) and `tools/HME/service/paths.py`
  (`runtime_dir()`-prefixed).
- No `hme-` prefix needed (the directory already implies it).

## Migrated state files

| File | Writer | Reader(s) | Lifecycle | Stale-criterion |
|---|---|---|---|---|
| `supervisor-abandoned` | `proxy/supervisor/index.js` | `userpromptsubmit.sh` (gates BLOCK) | Cleared by supervisor on healthy child; cross-checked + auto-unlinked by userpromptsubmit | Named child healthURL=200 → unlink |
| `fp-gate-armed.flag` | `stop_chain/policies/work_checks.js` (on `ctx.deny`) | `middleware/23_stop_hook_fp_gate.js` (consumes + deletes on inject) | One-shot per Stop deny | Older than next user prompt → stale |
| `stop-detector-verdicts.env` | `lifecycle/stop/detectors.sh` | `work_checks.js`, `anti_patterns.sh` | Overwritten each Stop chain run | Per-run; never stale |
| `completeness-injected.json` | `work_checks.js` | self (counter advance) | 50-entry FIFO cap, per-user-turn | Older than user-turn boundary |
| `errors-lastread` | `lifecycle/stop/lifesaver.sh` | `userpromptsubmit.sh` | hook-side LIFESAVER scan watermark | Per-watermark; never stale |
| `errors-lastread.proxy` | `middleware/22_lifesaver_inject.js` | self | proxy-side scan watermark; seeded to EOF on proxy boot | Per-watermark; never stale |
| `errors-turnstart` | `userpromptsubmit.sh` | `lifesaver.sh` | Per-turn marker for mid-turn-error detection | Older than turn boundary → stale |
| `proxy-supervisor.pid`, `proxy-supervisor.pid.lock` | `direct/proxy-supervisor.sh` | `event_kernel/supervisors.js` + self | Long-lived; `.lock` held during PID write | PID dead → stale |
| `universal-pulse-supervisor.pid` | `direct/universal-pulse-supervisor.sh` | self + watchdog | Long-lived | PID dead → stale |
| `autocommit.{counter,last-success,fail,lock}` | `_autocommit.sh` | self + `userpromptsubmit.sh` (fail-flag check) + `autocommit_health.py` | Counter increments per attempt; reset on success; lock held during git ops | Lock with no live holder → unlinked by stale-recovery |
| `canary-pending.txt` | `lifecycle/canary.sh` | `lifesaver.sh` (consume + advance) | Per-canary | Watchdog detects via consumed-vs-pending diff |
| `heartbeat-{autocommit,canary,inline-check,lifesaver}.ts` | matching writer | `universal_pulse.py` | Liveness markers; touched per-fire | >90s stale → universal-pulse alerts |

## Genuinely-throwaway tmp/ files (KEEP)

These are correct uses of `tmp/`:
- `tmp/blank-debug/hme-resp-*.{json,body,req-body}` — rotating proxy
  request/response dumps, last-100 cap
- `tmp/blank-debug/hme-lc-*.json` — rotating lifecycle event dumps
- `tmp/claude-*-payload-*.json` — per-failure forensic snapshots
- `tmp/_det_py_err_$$` — per-process scratch from detectors.sh
- `tmp/hme-bg-analyze-*.err` — background-task scratch
- `tmp/hme-errors.inline-watermark` — process-local watermark, regenerable
- `tmp/hme-canary-consumed.txt` — append-only audit log; lossy-OK
