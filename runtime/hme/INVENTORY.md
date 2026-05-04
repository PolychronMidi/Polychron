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
| `supervisor-abandoned` | `proxy/supervisor/index.js` (writes JSON when restart limit hit) | `hooks/lifecycle/userpromptsubmit.sh` (reads to gate BLOCK) | Cleared by supervisor when child becomes healthy; cross-checked + auto-unlinked by userpromptsubmit if child healthURL responds | If named child's healthURL returns 200 → sentinel is stale, unlink |
| `fp-gate-armed.flag` | `proxy/stop_chain/policies/work_checks.js` (writes on `ctx.deny`) | `proxy/middleware/stop_hook_fp_gate.js` (consumes + deletes on inject) | One-shot per Stop deny | Older than next user prompt → stale |
| `stop-detector-verdicts.env` | `hooks/lifecycle/stop/detectors.sh` | `proxy/stop_chain/policies/work_checks.js`, `anti_patterns.sh` | Overwritten each Stop chain run | Per-run; never stale |
| `completeness-injected.json` | `proxy/stop_chain/policies/work_checks.js` | self (counter advance) | 50-entry FIFO cap, per-user-turn | Older than user-turn boundary |

## TODO: still-in-tmp/ files that should migrate

These are inter-script-state contracts currently parked in `tmp/`. Each
needs the same path-constant + writer/reader update treatment as the
migrated four above. Sequence is by stale-state risk (highest first):

| File | Writer | Reader(s) | Risk |
|---|---|---|---|
| `tmp/hme-buddy-N.sid` / `tmp/hme-buddy.sid` | `hooks/helpers/buddy_init.sh` | `service/agent_direct.py` dispatcher | Persistent buddy session ids — losing breaks dispatch |
| `tmp/hme-thread.sid` | `i/thread init` | `synthesis_overdrive.py` | Persistent thread id — losing reverts to ephemeral dispatch |
| `tmp/hme-proxy-supervisor.pid` | `proxy-supervisor.sh` | `_proxy_bridge.sh` watchdog | Long-lived pid; respawn detection depends on it |
| `tmp/hme-universal-pulse-supervisor.pid` | `universal-pulse-supervisor.sh` | self + watchdog | Same as proxy-supervisor |
| `tmp/hme-errors.lastread` | `hooks/lifecycle/stop/lifesaver.sh` | `userpromptsubmit.sh` | LIFESAVER scan watermark — losing causes re-injection |
| `tmp/hme-errors.turnstart` | `userpromptsubmit.sh` | `lifesaver.sh` | Per-turn marker for mid-turn-error detection |
| `tmp/hme-canary-pending.txt` | `lifecycle/canary.sh` | `lifesaver.sh` | Alert-chain self-test state |
| `tmp/hme-autocommit.{counter,last-success,lock}` | `hooks/helpers/_autocommit.sh` | self | Autocommit health bookkeeping |
| `tmp/hme-heartbeat-*.ts` | various | `universal_pulse.py` | Process liveness markers |

## Genuinely-throwaway tmp/ files (KEEP)

These are correct uses of `tmp/`:
- `tmp/blank-debug/hme-resp-*.{json,body,req-body}` — rotating proxy
  request/response dumps, last-100 cap
- `tmp/blank-debug/hme-lc-*.json` — rotating lifecycle event dumps
- `tmp/claude-*-payload-*.json` — per-failure forensic snapshots
- `tmp/_det_py_err_$$` — per-process scratch from detectors.sh
- `tmp/hme-bg-analyze-*.err` — background-task scratch
