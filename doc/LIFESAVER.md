# LIFESAVER — Safety, Invariants & Self-Correction

Complete reference for every enforcement mechanism that keeps the agent, pipeline, and codebase honest. ~80 mechanisms across 6 enforcement layers: hook blocks, hook corrections, declarative invariants, ESLint rules, pipeline validators, and lifecycle tracking.

## Design Principles

1. **Fail fast** — no error, anywhere, may be silently swallowed. Every error surfaces immediately with full context.
2. **Anti-polling** — background tasks fire notifications when done. Polling is the antipattern.
3. **Anti-idle** — launching a background pipeline then stopping is wasted compute. Do substantive work while it runs.
4. **Plan discipline** — finish atomic units before pivoting. Never leave code in a broken intermediate state.
5. **Lifecycle completeness** — edits need review, stable pipelines need commits, failures need diagnosis.
6. **Correction over rejection** — where possible, fix the input and let it proceed (updatedInput) rather than blocking and forcing a retry.

## Enforcement Layers

```
Layer 0: SessionStart hook    — bootstrap: validate hooks, start HTTP shim, reset state, orient
Layer 1: PreToolUse hooks     — intercept before execution (block, correct, or advise)
Layer 2: PostToolUse hooks    — react after execution (track state, surface errors)
Layer 3: Stop hook            — prevent premature exit (8 blocking checks)
Layer 4: Declarative invariants — config/invariants.json (45+ checks, no code changes needed)
Layer 5: ESLint rules         — 27 custom rules enforcing fail-fast + architectural boundaries
Layer 6: Pipeline validators  — 6 scripts integrated into npm run main
```



## Layer 0: SessionStart

### sessionstart.sh — bootstrap and orientation

Runs once at session start. Five responsibilities:

1. **Hook executable check** — scans every `*.sh` in hooks/ (excluding `_*` helpers). Non-executable hooks logged to `hme-errors.log` and surfaced via stderr.
2. **State reset** — clears `tmp/hme-tab.txt`, `tmp/hme-nexus.state`, `tmp/hme-primer-needed.flag` for a fresh session.
3. **HTTP shim** — ensures `hme_http.py` is listening on port 7734. Starts in background if not bound.
4. **Environment** — exports `HME_ACTIVE=1` via `CLAUDE_ENV_FILE`.
5. **Orientation** — surfaces pipeline verdict, last journal round, uncommitted change count, and suggests `status(mode='resume')`.



## Layer 1: PreToolUse Hooks

### Corrections (updatedInput / systemMessage — zero wasted turns)

The `hookSpecificOutput` mechanism replaces the old exit-2 block pattern. Three variants:

**Correct** (`permissionDecision: "allow"` + `updatedInput`): fix input parameters, let the call proceed.
**Enrich** (`permissionDecision: "allow"` + `systemMessage`): let the call proceed, inject extra context.
**Redirect** (`permissionDecision: "deny"` + `systemMessage`): deny the tool, tell agent which tool to use instead with the original data pre-formatted.

- `pretooluse_bash.sh` — `timeout` in tool_input. **Correct**: strip timeout via updatedInput. Message: "timeout removed — all project scripts handle timeouts inline".
- `pretooluse_read.sh` — Read on project src/ file with KB entries. **Enrich**: allow Read, inject KB titles + entry count. Message: "KB context for {module} (N entries). For full briefing: `i/hme-read target={module}`".
- `pretooluse_grep.sh` — Grep with KB matches. **Enrich**: allow Grep, inject KB titles + trace nudge. Message: "HME has N KB entries. For KB-enriched results: `i/trace target=<query>`".
- `pretooluse_grep.sh` — Grep without KB matches. **Enrich**: allow Grep, inject trace nudge. Message: "`i/trace` returns matches + KB cross-references".
- `pretooluse_write.sh` — Write to src/ file with KB entries. **Enrich**: allow Write, inject KB constraint titles. Message: "Writing to {module} — N KB constraints exist. Verify compliance…".
- `pretooluse_todowrite.sh` — any TodoWrite call. **Redirect**: deny, extract tasks, format for HME todo. Message: "Use `i/todo` instead — supports subtodos. Your tasks: …".
- `pretooluse_hme_primer.sh` — first HME tool call of session (via `Bash(i/<tool>)`). **Enrich**: allow tool, inject AGENT_PRIMER.md content via systemMessage. One-shot primer injection via hookSpecificOutput.

### Correct example (Bash timeout stripping)
```json
{
  "hookSpecificOutput": {
    "permissionDecision": "allow",
    "updatedInput": {"command": "<original>", "run_in_background": true}
  },
  "systemMessage": "timeout removed — all project scripts handle timeouts inline"
}
```

### Enrich example (Read KB injection)
```json
{
  "hookSpecificOutput": {"permissionDecision": "allow"},
  "systemMessage": "KB context for conductorDampening (3 entries):\n    conductorState - mutable conductor state container\n    ..."
}
```

### Redirect example (TodoWrite to HME todo)
```json
{
  "hookSpecificOutput": {"permissionDecision": "deny"},
  "systemMessage": "Use `i/todo` instead of TodoWrite...\nYour tasks:\n  - Fix coupling\n  - Run pipeline\nAPI: i/todo action=add text=\"task\" ..."
}
```

### Hard Blocks (exit 2 — command rejected, agent must retry differently)

- `pretooluse_bash.sh` — `rm` + `run.lock` in command. LIFESAVER: never delete run.lock.
- `pretooluse_bash.sh` — any `run.lock` access. Anti-polling: checking the lock IS polling.
- `pretooluse_bash.sh` — `stat`/`ls -l` on pipeline metric files. Anti-polling: timestamp checking is indirect polling.
- `pretooluse_bash.sh` — pipeline command without `run_in_background=true`. Anti-wait: pipeline must run in background.
- `pretooluse_bash.sh` — `run_in_background=true` AND trailing `&`. Correctness: double-backgrounding fires false completion.
- `pretooluse_bash.sh` — `tail`/`cat`/`grep` on pipeline log files. Anti-polling: use `i/status`.
- `pretooluse_bash.sh` — `sleep` + `tail`/`cat`/`grep` in same command. Anti-polling: sleep-then-check is the antipattern.
- `pretooluse_bash.sh` — empty catch blocks, no-op error handlers, suppressed stderr. Fail fast: no silent error suppression.
- `pretooluse_bash.sh` — 3rd+ read of `/tmp/claude-*` task output. Anti-polling: already checked twice; wait for notification.
- `pretooluse_edit.sh` — LLM stub placeholder pattern (ellipsis + "remaining" language). Correctness: use actual replacement content.
- `pretooluse_write.sh` — write to `.claude/projects/*/memory/`. Anti-pattern: memory saving supplanted by HME.
- `pretooluse_write.sh` — API key/password/secret/token pattern detected. Security: review before writing credentials.
- `pretooluse_write.sh` — LLM stub placeholder in full file write. Correctness: stubs destroy files.
- `pretooluse_write.sh` — `logger.warning()` for expected background failures. Fix antipattern: use `logger.info` for expected failures.
- `pretooluse_check_pipeline.sh` — 2nd+ `i/status` call in same turn. **Redirect**: deny + suggest continuing real work while the pipeline runs.

### Soft Feedback (stderr — command proceeds, agent sees advice)

- `pretooluse_edit.sh` — editing src/ without prior `read(mode='before')`. NEXUS: call read() for KB constraints + callers + risks.
- `pretooluse_edit.sh` — module has KB entries (via HTTP shim). Surface KB constraint titles and counts.
- `pretooluse_grep.sh` — grep pattern with KB matches. Suggest `find()` for KB-enriched results.
- `pretooluse_read.sh` — reading task output file. Remind to wait for completion notification.
- `pretooluse_read.sh` — project file with no KB entries. Suggest `read()` for KB + callers + structure.
- `pretooluse_write.sh` — writing to `lab/sketches.js`. Lab rules: real monkey-patching, no empty sketches.

Note: `pretooluse_read.sh` on project files WITH KB entries now uses the Enrich pattern (see Corrections above) instead of stderr. The Read proceeds and KB context is injected via `systemMessage`.

### Streak Counter (weighted tool tracking)

Raw tool calls accumulate a weighted score. HME MCP tool calls reset it to zero.

- **Read** — weight 5; warns at 10 calls (score 50), blocks at 14 (score 70).
- **Edit/Write** — weight 10; warns at 5 calls, blocks at 7.
- **Bash** — weight 15; warns at ~3 calls, blocks at ~5.
- **Grep** — weight 20; warns at ~3 calls, blocks at ~4.

Block message: "Use an HME npm script (`i/hme-read`, `i/trace`, `i/review`) before continuing."



## Layer 2: PostToolUse Hooks

### posttooluse_bash.sh — Pipeline verdict tracking

After `npm run main` completes:
1. Scan `output/metrics/pipeline-summary.json` for `errorPatterns` (Traceback, CUDA OOM, RuntimeError)
2. Scan for failed steps (`ok: false`)
3. If errors found: emit loud banner — "PIPELINE ERRORS DETECTED — DO NOT IGNORE"
4. Track NEXUS state: mark pipeline verdict (STABLE/EVOLVED/DRIFTED/FAILED)
5. Remind about post-pipeline phases 5-7 (fingerprint, trace-summary, journal, KB update)

After `npm run snapshot`: remind to persist calibration anchors.
After `node lab/run`: check for FAIL/PASS in sketch results.

### posttooluse_edit.sh — Edit backlog tracking

Counts edits to `src/` and `tools/HME/` files via NEXUS state:
- 3+ edits: "Consider review(mode='forget') soon"
- 5+ edits: "Run review(mode='forget') now — backlog is growing"

### log-tool-call.sh — LIFESAVER timing + FAIL scanning

Runs on every tool (empty matcher):
1. **Timing**: reads start timestamp written by the matching pretooluse hook, warns if threshold exceeded (15s default, 30s for review/warm_pre_edit_cache)
2. **FAIL scan**: greps tool output for "FAIL", writes to `log/hme-errors.log` with timestamp
3. **Streak reset**: resets raw tool streak to 0 (HME tool used = streak cleared)

### posttooluse_addknowledge.sh — KB tab cleanup

After `add_knowledge`: clears pending `KB:` entries from `tmp/hme-tab.txt`. Prevents compact preservation from surfacing already-saved anchors.

### posttooluse_agent.sh — background output tracking

After Agent spawns: extracts background output file path and appends to compact tab. Ensures random-hash `/tmp/claude-*` paths survive compaction.

### posttooluse_hme_read.sh — NEXUS briefing tracker

After `i/hme-read`: marks target file as BRIEF in NEXUS state. The `pretooluse_edit.sh` hook checks NEXUS before edits — files not briefed trigger a warning. Also resets streak.

### posttooluse_hme_review.sh — edit backlog lifecycle

After `i/review mode=forget`: clears EDIT entries from NEXUS, marks REVIEW complete, and surfaces next step (commit if pipeline passed, run pipeline otherwise). Resets streak.

### posttooluse_pipeline_kb.sh — trace summary extraction

After `npm run main` via Bash: parses `output/metrics/trace-summary.json` for regime distribution, trust dominance, coupling labels, beat/section counts. Writes a summary line to `tmp/hme-tab.txt` as a pending KB anchor.

### posttooluse_read.sh — silent KB enrichment

After Read on project source files: checks KB for module entries. If found, surfaces count and suggests `i/hme-read` for full briefing. Resets streak (reading = gathering context).

### posttooluse_write.sh — note file tracking

After Write to `.md`/`.txt` files outside `tmp/`: appends path to compact tab. Ensures doc and note files survive compaction.



## Layer 3: Stop Hook

8 independent blocking checks in `stop.sh`, all returning `{"decision":"block","reason":"..."}`:

### 1. LIFESAVER — mid-turn error detection

**State files**: `log/hme-errors.log`, `tmp/hme-errors.turnstart`, `tmp/hme-errors.lastread`

Two checks:
- **New errors this turn**: total lines > turnstart count -> block with error text
- **Unfixed errors from previous turn**: watermark < turnstart count -> block

"Acknowledging an error without fixing it is a CRITICAL VIOLATION."

### 2. Autonomous evolution loop

**State file**: `.claude/hme-evolver.local.md` (frontmatter: enabled, iteration, max_iterations, done_signal). Filename is legacy — the Evolver subagent was retired; the mechanism is now pure hook logic.

If enabled and not done: block exit, inject next evolution prompt, increment iteration counter. The Stop hook re-injects the prompt, preventing the agent from stopping between rounds.

### 3. Anti-polling (transcript analysis)

Python script parses transcript for:
- Bash calls reading `/tasks/*.output` files
- Multiple `check_pipeline` MCP calls

2+ polls -> hard block.

### 4. Anti-idle (background launch detection)

Detects pipeline commands with `run_in_background=true`, then:
- If pipeline still running: require 20+ real tool calls before exit
- If pipeline complete: require 5+ real tool calls

Block message lists substantive work: `hme_admin(action='index')`, next evolution, `review(mode='forget')`, docs/KB updates.

### 5. Plan abandonment

Detects Agent spawned with KB/HME work keywords. Block: use HME tools directly, don't delegate KB work to subagents.

### 6. NEXUS lifecycle audit

`_nexus_pending()` checks:
- Edited files not reviewed -> "run review(mode='forget')"
- Pipeline STABLE/EVOLVED but not committed
- Pipeline FAILED/DRIFTED without diagnosis

### 7. Stop-work antipattern (dismissive text)

Detects last assistant message containing: "no response requested", "nothing to do", "no action needed". Hard block — there is always pending work after a user message.

### 8. Stop-work antipattern (text-only short)

Last message was <200 chars with no tool_use blocks. Hard block — if work remains, continue; if genuinely done, provide substantive summary.



## Layer 4: Declarative Invariants

**File**: `tools/HME/config/invariants.json` — 45+ checks run via `evolve(focus='invariants')`.

No code changes needed to add new checks — add JSON entries with a type, path, and severity.

### Check Types

- `files_executable` — glob files must be executable
- `files_referenced` — glob files must appear in reference file
- `file_exists` — path must exist
- `symlink_valid` — symlink must resolve
- `json_valid` — file must parse as valid JSON
- `glob_count_gte` — count of glob matches ≥ minimum
- `pattern_in_file` — regex pattern found in file
- `patterns_all_in_file` — all patterns present in file
- `pattern_count_gte` — count of pattern matches ≥ minimum
- `symbols_used` — defined symbols must be referenced
- `symbols_have_kb` — high-caller symbols need KB entries
- `files_mtime_window` — two files modified within time delta
- `kb_content_no_pattern` — KB entries must not contain regex
- `kb_freshness` — KB updated within max_age_days
- `shell_output_empty` — shell command must produce no stdout

### Critical Invariants (errors)

- Every hook script executable (`files_executable`)
- Every hook registered in hooks/hooks.json (`files_referenced`)
- Every custom ESLint rule registered in eslint.config.mjs (`files_referenced`)
- All JSON config files valid (`json_valid` x7)
- Stop hook contains all 5 enforcement sections (`patterns_all_in_file`)
- LIFESAVER FAIL scan present in log-tool-call.sh (`patterns_all_in_file`)
- All _safety.sh helpers present (`patterns_all_in_file`)
- All 7 lifecycle events registered in settings (`patterns_all_in_file`)
- Minimum 27 ESLint rules (`glob_count_gte`)
- Minimum 25 L0 channel constants (`pattern_count_gte`)
- All 27 trust system pairs (`pattern_count_gte`)
- 19 stutter variants self-registered (`pattern_count_gte`)
- Symlinks valid: MCP and skills (`symlink_valid`)
- Every hook registered in hooks.json (`files_referenced`)
- No untracked files outside .gitignore (`shell_output_empty`)
- Feedback graph has >= 11 loops (`pattern_count_gte`)
- LIFESAVER.md exists (`file_exists`)

### Warning Invariants

- adaptive-state.json valid
- Evolution journal exists
- KB has data files (>=1 .lance)
- Top 15 IIFE globals have KB entries
- Every L0_CHANNELS constant used somewhere
- trace.jsonl and run-history within 300s mtime
- Coupling labels documented in ARCHITECTURE.md
- KB free of thinking artifact tags
- KB updated within 14 days
- CLAUDE.md documents correct ESLint rule count (`pattern_in_file`)



## Layer 5: ESLint Rules

27 custom rules in `scripts/eslint-rules/`, all integrated into `npm run main`. Authoritative count comes from `verify-numeric-drift.py`.

### Fail Fast Enforcement

- `no-empty-catch` — empty catch blocks; must rethrow, log, or recover
- `only-error-throws` — throwing strings/objects; must throw `Error` instances
- `no-silent-early-return` — bare returns without prior error handling
- `no-doubled-fallback` — `x || y || z`-style cascades on Map.get/config reads
- `no-or-fallback-on-config-read` — `||` defaults on configuration reads (use validators)
- `no-or-fallback-on-map-get` — `||` defaults on `Map.get()` (use validators)

### Architectural Boundaries

- `no-direct-buffer-push-from-crosslayer` — cross-layer calling `p()`/`push()`; must use `crossLayerEmissionGateway`
- `no-unregistered-feedback-loop` — feedback loops without `feedbackRegistry` registration
- `no-direct-conductor-state-from-crosslayer` — cross-layer reading `conductorState`; must use `conductorSignalBridge`
- `no-conductor-registration-from-crosslayer` — cross-layer registering with `conductorIntelligence`
- `no-direct-coupling-matrix-read` — reading `.couplingMatrix` outside coupling engine
- `no-direct-signal-read` — reading signal snapshot directly; must use `signalReader`
- `no-direct-crosslayer-write-from-conductor` — conductor writing to cross-layer state

### Channel & Math Discipline

- `no-bare-l0-channel` — bare string literals in L0 calls; must use `L0_CHANNELS` constants
- `no-bare-math` — direct `Math.*` access; must use project `m = Math` alias
- `no-math-random` — `Math.random()`; must use deterministic RNG

### Validator & Code Organization

- `prefer-validator` — ad-hoc `typeof`/`isFinite` checks when validator exists
- `validator-name-matches-filename` — mismatched `validator.create()` name vs filename
- `no-unstamped-validator` — validators without module name stamp
- `no-requires-outside-index` — `require()` outside `index.js` files
- `case-conventions` — wrong casing (camelCase vars, PascalCase classes)
- `no-non-ascii` — non-ASCII characters in source code
- `no-typeof-validated-global` — `typeof` checks on boot-validated globals
- `no-console-acceptable-warning` — console calls outside accepted format
- `no-useless-expose-dependencies-comments` — dead `@expose-dependencies` comments
- `no-bare-declared-global-in-init` — globals referenced in init before side-effect require



## Layer 6: Pipeline Validators

6 scripts integrated into `npm run main`, run before composition:

### validate-feedback-graph.js
Cross-validates `output/metrics/feedback_graph.json` against source code registrations. Every JSON loop must have a source registration, and vice versa. Checks firewall port structure.

### check-registration-coherence.js
Modules with functional registrations (registerDensityBias, etc.) must also call `conductorIntelligence.registerModule()` for lifecycle resets. Reports orphans.

### check-safe-preboot-audit.js
Prevents growth of `safePreBoot.call()`. Baseline: 171 calls in 59 files. Pipeline fails if count exceeds baseline — new code must use `moduleLifecycle.registerInitializer()`.

### check-hypermeta-jurisdiction.js
4-phase enforcement:
- Phase 1: No manual axis floors/caps in SpecialCaps
- Phase 2: No coupling matrix reads outside approved modules
- Phase 3: 93 bias registration bounds locked against manifest
- Phase 4: 5 watched controller-managed constants unchanged

### check-tuning-invariants.js
Validates adaptive tuning parameters within declared bounds from `doc/TUNING_MAP.md`.

### check-manifest-health.js
Post-composition validation: regime distribution, density rates, coupling bounds, tail-end P90 limits.



## Supporting Infrastructure

### _safety.sh — shared preamble

Sourced by every hook. Provides:
- `_safe_curl(url, body)` — 2s timeout, returns empty on failure
- `_safe_jq(json, query, fallback)` — field extraction with fallback
- `_safe_py3(script, fallback)` — Python one-liner with fallback
- `_safe_int(val)` — numeric validation, returns 0 if invalid
- `_streak_tick(weight)` / `_streak_check()` / `_streak_reset()` — weighted tool counter
- `_hme_enrich(module)` / `_hme_validate(module)` / `_hme_kb_count(json)` / `_hme_kb_titles(json, n)` — HTTP shim calls to localhost:7734

### _nexus.sh — lifecycle state tracker

State file: `tmp/hme-nexus.state` (TYPE:TIMESTAMP:PAYLOAD per line)

| Type | Set by | Meaning |
-
| BRIEF | pretooluse_edit.sh | File briefed with read(mode='before') |
| EDIT | posttooluse_edit.sh | File edited |
| PIPELINE | posttooluse_bash.sh | Pipeline verdict |
| COMMIT | posttooluse_bash.sh | Git commit executed |

`_nexus_pending()` checks lifecycle completeness for the Stop hook.

### LIFESAVER error flow

```
Tool execution
     |
log-tool-call.sh scans output for FAIL
     |
Writes to log/hme-errors.log
     |
userpromptsubmit.sh surfaces errors at turn start
     |
stop.sh blocks exit if unfixed errors remain
     |
Watermark advances only after fix confirmed
```

### userpromptsubmit.sh — turn-start error surface + evolution context

Runs at the start of every user turn. Three responsibilities:

1. **LIFESAVER error surface** — reads `log/hme-errors.log`, compares against `tmp/hme-errors.lastread` watermark. If new errors exist, emits a loud banner with the error text. Records line count to `tmp/hme-errors.turnstart` for the Stop hook to compare against.
2. **Evolution context injection** — if the prompt matches evolution-related keywords (evolve, pipeline, lab, sketch), injects a reminder to use `before_editing`, `what_did_i_forget`, and `add_knowledge`.
3. **Plan discipline reminder** — unconditionally appends anti-abandonment reminder every turn.

### precompact.sh — pre-compaction state surface

Runs before Claude Code compacts context. Three responsibilities:

1. **KB anchor surface** — reads `tmp/hme-tab.txt` for `KB:` entries (pending, unsaved knowledge). Surfaces them to stderr so the agent can persist them before context is wiped.
2. **Note file surface** — surfaces `FILE:` entries from tab (tracked note files from background tasks, writes, agents).
3. **Context meter logging** — reads `/tmp/claude-context.json` from the statusline, writes a `pre_compact` entry to `output/metrics/compact-log.jsonl` with used/remaining percentages and timestamp for compaction frequency analysis.

### postcompact.sh — post-compaction re-surface

Runs after compaction completes. Mirrors precompact surface so the agent can immediately act on pending work:

1. Re-surfaces unsaved `KB:` entries from tab (still pending after compaction).
2. Re-surfaces tracked `FILE:` entries.
3. Logs `post_compact` event to `output/metrics/compact-log.jsonl`.
4. Suggests `status(mode='resume')` for full session state recovery.



## Evolution: Block to Correct / Enrich / Redirect

The original enforcement pattern was **block** (exit 2): reject the tool call and force a retry. This works but costs a full turn cycle and adds context.

Three newer patterns via `hookSpecificOutput`:

```
Block (old):      detect -> exit 2 -> agent retries -> wasted turn
Correct (new):    detect -> updatedInput -> command proceeds -> one-line note
Enrich (new):     detect -> allow + systemMessage -> command proceeds + KB context injected
Redirect (new):   detect -> deny + systemMessage with data -> agent uses better tool
```

**Correct** — for fixable parameters (timeout stripping). Zero turns wasted.
**Enrich** — for augmentable tools (Read on project files). Tool proceeds, agent gets bonus context without a separate HME call.
**Redirect** — for replaceable tools (TodoWrite -> HME todo). One turn to switch, but the systemMessage pre-formats the data so the agent just copies it to the correct tool.

Reserve hard blocks (exit 2) for cases where no safe correction, enrichment, or redirect exists (deleting run.lock, silent error suppression, empty catch blocks).
