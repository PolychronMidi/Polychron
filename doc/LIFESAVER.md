# LIFESAVER -- Safety, Invariants & Self-Correction

Index of HME's enforcement surface. Mechanisms live in their source files; this doc is the map, not the catalog. ~80 mechanisms across 6 layers.

## Design Principles

1. **Fail fast.** Every error surfaces immediately with full context. No silent swallowing.
2. **Anti-polling.** Background tasks fire notifications when done. Polling is the antipattern.
3. **Anti-idle.** Launching a background pipeline then stopping is wasted compute. Do substantive work while it runs.
4. **Plan discipline.** Finish atomic units before pivoting. Never leave code in a broken intermediate state.
5. **Lifecycle completeness.** Edits need review, stable pipelines need commits, failures need diagnosis.
6. **Correction over rejection.** Where possible, fix the input via `updatedInput` and let it proceed rather than blocking.

## Enforcement Layers

```
Layer 0: SessionStart hook    -- bootstrap: validate hooks, start HTTP shim, reset state
Layer 1: PreToolUse hooks     -- intercept before execution (block, correct, enrich, redirect)
Layer 2: PostToolUse hooks    -- react after execution (track state, surface errors)
Layer 3: Stop hook            -- prevent premature exit (10+ blocking checks)
Layer 4: Declarative invariants -- config/invariants.json (45+ checks, no code changes needed)
Layer 5: ESLint rules         -- 27 custom rules enforcing fail-fast + architectural boundaries
Layer 6: Pipeline validators  -- 6 scripts integrated into npm run main
```

## Layer 0: SessionStart

**Source:** `tools/HME/hooks/lifecycle/sessionstart.sh`

Five responsibilities at session boot: hook executable check (non-executable → `hme-errors.log`), state reset (clears `tmp/hme-tab.txt`, `tmp/hme-nexus.state`), HTTP shim startup on port 7734, environment export (`HME_ACTIVE=1`), and orientation surface (pipeline verdict + last journal round + uncommitted change count).

## Layer 1: PreToolUse Hooks

**Source:** `tools/HME/hooks/pretooluse/`

The `hookSpecificOutput` mechanism gives four response modes:

- **Correct** (`allow` + `updatedInput`): fix input parameters, let the call proceed (e.g. strip `timeout` from Bash).
- **Enrich** (`allow` + `systemMessage`): let the call proceed, inject extra context (e.g. KB titles on Read of a briefed module).
- **Redirect** (`deny` + `systemMessage`): deny the tool, tell the agent which to use instead, with the original data pre-formatted (e.g. `TodoWrite` → `i/todo`).
- **Hard block** (`exit 2`): reject and force retry. Reserved for cases where no safe correction exists.

### Hard-block categories

- **Anti-polling:** `tail`/`cat`/`grep`/`stat`/`ls -l` on pipeline metric/log files; multiple reads of `/tmp/claude-*` task output; `sleep + tail` patterns; `run.lock` access of any kind.
- **Pipeline correctness:** pipeline command without `run_in_background=true`; double-backgrounding (`run_in_background=true && trailing &`); `rm` + `run.lock`.
- **Fail-fast:** empty catch blocks, no-op error handlers, suppressed stderr.
- **Edit/Write:** LLM stub placeholder patterns (ellipsis + "remaining" language); writes to deprecated `.claude/projects/*/memory/`; secret/API-key patterns; 4+ identical decoration characters in a row (opt-out: `spam-ok` per line).
- **KB hygiene:** `i/learn` titles starting with `Feedback:` (behavioral self-notes belong in CLAUDE.md or a hook).

### Soft feedback (stderr, command proceeds)

Editing src/ without prior `i/hme-read`; reading task-output files (reminder to wait for notification); writes to `lab/sketches.js` (lab-rules reminder).

### Streak counter

Raw tool calls accrue weighted score; HME tool calls reset it. Weights: Read=5, Edit/Write=10, Bash=15, Grep=20. Block message at threshold: "Use an HME npm script before continuing."

## Layer 2: PostToolUse Hooks

**Source:** `tools/HME/hooks/posttooluse/`

| Hook | Purpose |
|---|---|
| `posttooluse_bash.sh` | Pipeline verdict tracking + error banner on Traceback/CUDA OOM/RuntimeError |
| `posttooluse_edit.sh` | Edit-backlog count → "Run review(mode='forget') now" at threshold |
| `log-tool-call.sh` | Empty-matcher: timing + FAIL scan + streak reset on every tool |
| `posttooluse_addknowledge.sh` | KB tab cleanup |
| `posttooluse_agent.sh` | Background-output path tracking through compaction |
| `posttooluse_hme_read.sh` | NEXUS BRIEF marker |
| `posttooluse_hme_review.sh` | NEXUS EDIT-clear + REVIEW marker + next-step suggestion |
| `posttooluse_pipeline_kb.sh` | Trace-summary extraction → pending KB anchor |
| `posttooluse_read.sh` | Silent KB enrichment + streak reset |
| `posttooluse_write.sh` | Note-file tracking through compaction |

## Layer 3: Stop Hook

**Source:** `tools/HME/hooks/lifecycle/stop/` + `tools/HME/scripts/detectors/`

10+ independent blocking checks. Each detector lives at `tools/HME/scripts/detectors/<name>.py`; the shell side runs them via `run_all.py`. Verdicts persist to `runtime/hme/stop-detector-verdicts.env`; `tools/HME/proxy/stop_chain/policies/work_checks.js` dispatches denies based on the file.

Categories:

- **Mid-turn errors:** new errors in `log/hme-errors.log` since turn-start, or unfixed errors from previous turn → block.
- **Anti-polling:** transcript scan for `/tasks/*.output` reads or repeated `check_pipeline` calls.
- **Anti-idle:** background pipeline launched → require N+ real tool calls before exit.
- **Plan abandonment:** Agent spawned with KB/HME work keywords → use HME tools directly.
- **NEXUS lifecycle:** edited files unreviewed, stable pipeline uncommitted, failed pipeline undiagnosed.
- **Stop-work antipattern:** dismissive text ("nothing to do", "no action needed") OR text-only short response with no tool calls.
- **Exhaust violation:** `exhaust_check.py` -- final text enumerates remaining items (TBD/banked/takes-effect-on-next/etc.) without fixing them.
- **Scope-escape:** `scope_escape.py` -- final text dismisses a problem as `pre-existing` / `out of scope` instead of fixing.
- **Phantom capability:** `phantom_capability.py` -- agent declared a thinking/delegation capability not in `_capability_enum.py`.
- **Verification doctrine:** `claim_without_evidence.py` -- completion claim (`works`/`passes`/`lands`) without same-turn evidence-producing tool call.
- **Systematic-debugging gate:** `fix_without_investigation.py` -- bug report → Edit/Write without prior investigation tool call.

Phantom-paraphrase + ceremony-dodge variants are softer flags caught alongside the harder ones.

## Layer 4: Declarative Invariants

**Source:** `tools/HME/config/invariants.json` (45+ checks, run via `i/evolve focus=invariants`)

Add a new check by adding a JSON entry with type/path/severity, no code changes needed.

### Check types

`files_executable`, `files_referenced`, `file_exists`, `symlink_valid`, `json_valid`, `glob_count_gte`, `pattern_in_file`, `patterns_all_in_file`, `pattern_count_gte`, `symbols_used`, `symbols_have_kb`, `files_mtime_window`, `kb_content_no_pattern`, `kb_freshness`, `shell_output_empty`.

### Critical invariants enforce

Hook executability, hook registration in `hooks.json`, ESLint rule registration in `eslint.config.mjs`, JSON config validity (×7), Stop-hook required sections present, LIFESAVER FAIL scan present in `log-tool-call.sh`, all `_safety.sh` helpers present, all 7 lifecycle events registered, ≥27 ESLint rules, ≥25 L0 channel constants, all 27 trust-system pairs, 19 stutter variants self-registered, MCP/skills symlinks valid, no untracked files outside `.gitignore`, ≥11 feedback-graph loops, LIFESAVER.md exists.

### Warning invariants

`adaptive-state.json` validity, evolution journal exists, KB has data files (≥1 `.lance`), top 15 IIFE globals have KB entries, every `L0_CHANNELS` constant used somewhere, `trace.jsonl` and run-history within 300s mtime, coupling labels documented in `ARCHITECTURE.md`, KB free of thinking-artifact tags, KB updated within 14 days, CLAUDE.md documents correct ESLint rule count.

## Layer 5: ESLint Rules

**Source:** `scripts/eslint-rules/` (27 custom rules; authoritative count from `verify-numeric-drift.py`)

Categories:

- **Fail-fast enforcement:** `no-empty-catch`, `only-error-throws`, `no-silent-early-return`, `no-doubled-fallback`, `no-or-fallback-on-config-read`, `no-or-fallback-on-map-get`.
- **Architectural boundaries:** `no-direct-buffer-push-from-crosslayer`, `no-unregistered-feedback-loop`, `no-direct-conductor-state-from-crosslayer`, `no-conductor-registration-from-crosslayer`, `no-direct-coupling-matrix-read`, `no-direct-signal-read`, `no-direct-crosslayer-write-from-conductor`.
- **Channel + math discipline:** `no-bare-l0-channel`, `no-bare-math`, `no-math-random`.
- **Validator + code organization:** `prefer-validator`, `validator-name-matches-filename`, `no-unstamped-validator`, `no-requires-outside-index`, `case-conventions`, `no-non-ascii`, `no-typeof-validated-global`, `no-console-acceptable-warning`, `no-useless-expose-dependencies-comments`, `no-bare-declared-global-in-init`.

## Layer 6: Pipeline Validators

**Source:** `scripts/pipeline/` (6 scripts, run pre-composition by `npm run main`)

| Script | Purpose |
|---|---|
| `validate-feedback-graph.js` | Cross-validate `output/metrics/feedback_graph.json` against source registrations |
| `check-registration-coherence.js` | Functional registrations must also call `conductorIntelligence.registerModule()` |
| `check-safe-preboot-audit.js` | Prevent growth of `safePreBoot.call()` beyond 171-call baseline |
| `check-hypermeta-jurisdiction.js` | 4-phase: no manual axis floors/caps, no coupling-matrix reads outside approved modules, 93 bias bounds locked, 5 watched constants unchanged |
| `check-tuning-invariants.js` | Adaptive tuning parameters within bounds from `doc/TUNING_MAP.md` |
| `check-manifest-health.js` | Post-composition: regime distribution, density rates, coupling bounds, P90 limits |

## Supporting Infrastructure

### `_safety.sh` -- shared preamble

Sourced by every hook. Provides `_safe_curl`, `_safe_jq`, `_safe_py3`, `_safe_int` (timeout/fallback wrappers), `_streak_tick`/`_check`/`_reset` (weighted tool counter), `_hme_enrich`/`_validate`/`_kb_count`/`_kb_titles` (HTTP shim calls to localhost:7734).

### `_nexus.sh` -- lifecycle state tracker

State file: `tmp/hme-nexus.state` (TYPE:TIMESTAMP:PAYLOAD per line). Types: `BRIEF` (read(mode='before') ran), `EDIT` (file edited), `PIPELINE` (pipeline verdict), `COMMIT` (git commit). `_nexus_pending()` checks lifecycle completeness for the Stop hook.

### `userpromptsubmit.sh` -- turn-start surface

Three responsibilities: LIFESAVER error surface (compares `log/hme-errors.log` against `tmp/hme-errors.lastread` watermark, banner on new errors, records line count to `tmp/hme-errors.turnstart`); evolution-context injection on evolution-related prompts; unconditional plan-discipline reminder.

### `precompact.sh` / `postcompact.sh` -- compaction lifecycle

Surfaces unsaved KB anchors and tracked note files BEFORE compaction; re-surfaces them AFTER. Logs `pre_compact` / `post_compact` events to `output/metrics/compact-log.jsonl` for compaction-frequency analysis. Post-compaction also suggests `i/status mode=resume`.

### Error flow

```
Tool execution
  → log-tool-call.sh scans output for FAIL
  → writes to log/hme-errors.log
  → userpromptsubmit.sh surfaces at turn start
  → stop.sh blocks exit if unfixed errors remain
  → watermark advances only after fix confirmed
```

## Block → Correct / Enrich / Redirect

The original enforcement pattern was hard-block (`exit 2`): reject and force a retry. Costs a turn cycle. The newer `hookSpecificOutput` modes:

- **Correct** -- fixable parameters (timeout stripping). Zero turns wasted.
- **Enrich** -- augmentable tools (Read on a project file with KB entries). Tool proceeds, agent gets bonus context without a separate HME call.
- **Redirect** -- replaceable tools (TodoWrite → `i/todo`). One turn to switch, but `systemMessage` pre-formats the data.
- **Hard block** -- when no safe alternative exists (deleting `run.lock`, silent error suppression, empty catch blocks).
