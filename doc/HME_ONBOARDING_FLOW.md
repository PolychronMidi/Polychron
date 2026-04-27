# HME Onboarding Flow

Per-session walkthrough that teaches the HME loop by gating and chaining tool calls. Every new session re-arms the walkthrough; graduation is session-local.

The design lives in three pieces:
- **Chain decider** ([tools/HME/service/server/onboarding_chain.py](../tools/HME/service/server/onboarding_chain.py)) — the middleman that runs prerequisites silently inside HME tool handlers
- **Shell hooks** ([tools/HME/hooks/](../tools/HME/hooks/)) — gate Edit/Bash (tools the chain decider cannot reach from Python)
- **Primer** ([doc/AGENT_PRIMER.md](./AGENT_PRIMER.md)) — the walkthrough-shaped content the hook injects on first HME tool call

This document is the design spec. Edit it when the flow changes; the code follows.

## Design principles

1. **One tool call per logical step.** The agent never issues two tool calls to accomplish one conceptual move. Prerequisites run silently inside the tool handler and their output is prepended to the result.
2. **Advancement is automatic.** The agent never writes state. Hooks and tool handlers advance state forward as side effects of legitimate tool calls.
3. **Forward-only.** State never moves backward. This eliminates whole classes of race conditions.
4. **Permissive on missing state.** If the state file is missing or corrupt, the machine treats the agent as graduated (blocks relax). Losing state never gets the agent stuck.
5. **Composition is the carrier wave; HME self-monitoring rides along.** Every walkthrough targets a composition evolution. While editing, the agent is primed to observe HME itself and report findings at `learn()` time.
6. **Hooks enforce what the chain decider cannot.** Hooks handle `Edit`, `Bash`, `Write` — tools whose handlers live outside the HME MCP server. For HME tools, the chain decider is the authority.

## State machine

```
    boot ┐
     │                │ hme_admin(action='selftest') passes
     ▼                ▼
 selftest_ok          │
     │                │ evolve(focus='design'|'forge'|'curate'|'stress'|'invariants')
     ▼                ▼
  targeted            │
     │                │ Edit on /src/ (briefing auto-chains; posttooluse_edit.sh advances state)
     ▼                ▼
   edited             │
     │                │ review(mode='forget') reports zero warnings
     ▼                ▼
  reviewed            │
     │                │ Bash: npm run main (pretooluse/posttooluse_bash.sh)
     ▼                ▼
    piped             │
     │                │ fingerprint-comparison.json verdict = STABLE | EVOLVED
     ▼                ▼
  verified            │
     │                │ learn(title=..., content=...) with non-empty args
     ▼                ▼
  graduated ┘
```

### State definitions

- **boot** — fresh session. Transition: `hme_admin(action='selftest')`. Forward when: output contains no `FAIL:` lines.
- **selftest_ok** — tool surface + index + KB verified. Transition: `evolve(focus=...)` with a target-picking focus. Forward: always.
- **targeted** — evolution target chosen; ready for Edit. Transition: Edit on any `/src/` file. Forward when: successful Edit in PostToolUse (briefing surfaces via pretooluse_edit's `_hme_validate`).
- **edited** — changes applied. Transition: `review(mode='forget')`. Forward when: output contains `Warnings: none` or `No changed files detected`.
- **reviewed** — changes pass KB audit. Transition: `Bash: npm run main`. Forward when: command actually launched in PostToolUse.
- **piped** — pipeline running in background. Transition: pipeline completion. Forward when: `pipeline-summary.json.failed == 0` AND `fingerprint-comparison.json.verdict in {STABLE, EVOLVED}`.
- **verified** — pipeline passed. Transition: `learn(title=, content=)`. Forward when: both `title` and `content` non-empty.
- **graduated** — loop complete. State file is deleted.

The `briefed` state was removed: the KB briefing that used to be its own step is now auto-chained into every Edit via `_hme_validate` in [pretooluse_edit.sh](../tools/HME/hooks/pretooluse_edit.sh), so the agent never needs to call `read(target, mode='before')` explicitly. The `read` tool still exists as a hidden internal utility called by the hook.

## Auto-chaining rules

The chain decider implements exactly **one** prerequisite rule. Everything else is state advancement, not chaining.

### Rule: selftest prerequisite

When state is `boot` and any HME tool **other than** `hme_admin(action='selftest')` is called, the handler runs `hme_admin(action='selftest')` in-process first, prepends its output to the tool result, and advances state to `selftest_ok` if selftest reports zero failures.

This is the only rule because the other transitions already describe natural workflow order. Once the agent is past `boot`, they'll naturally call `evolve(design)` → `read(before)` → `Edit` in that order, and the hooks enforce the remaining gates.

**Why only selftest is auto-chained:** it's the only truly silent prerequisite — everything else requires agent judgment (which target? what content?). Silent auto-chaining for judgment calls would hide meaningful work from the agent.

## Gates (shell hooks)

For tools outside the HME MCP server, hooks are the gatekeepers. Gates fire only during onboarding — graduated agents bypass them and hit the pre-existing soft warnings.

- [pretooluse_edit.sh](../tools/HME/hooks/pretooluse_edit.sh) — block `Edit` on `/src/` when state is earlier than `briefed`. Forces agent through read(mode='before') first.
- [pretooluse_bash.sh](../tools/HME/hooks/pretooluse_bash.sh) — block `Bash: npm run main` when state is earlier than `reviewed`. Forces agent through review(mode='forget') first.
- [posttooluse_edit.sh](../tools/HME/hooks/posttooluse_edit.sh) — advance `briefed` → `edited` on successful src/ Edit. Automatic state bookkeeping.
- [posttooluse_bash.sh](../tools/HME/hooks/posttooluse_bash.sh) — advance `reviewed` → `piped` on npm launch; `piped` → `verified` on clean STABLE/EVOLVED verdict.

## Tool handler wiring

Every HME tool is wrapped with `@chained("tool_name")` from [onboarding_chain.py](../tools/HME/service/server/onboarding_chain.py). The decorator:

1. Calls `chain_enter(tool_name, kwargs)` — runs any prerequisite, captures prereq output
2. Executes the original tool body
3. Prepends prereq output to the result (if any)
4. Calls `chain_exit(tool_name, kwargs, result)` — advances state, appends status line
5. Returns the final string to the MCP protocol

The `@chained` decorator sits between `@ctx.mcp.tool()` and the function body:

```python
@ctx.mcp.tool()
@chained("evolve")
def evolve(focus: str = "all", query: str = "") -> str:
    ...
```

Decorator order matters: `@ctx.mcp.tool()` must be OUTERMOST so FastMCP registers the wrapped function. `functools.wraps` preserves `__wrapped__`, which `inspect.signature()` follows transparently — the MCP tool schema sees the original signature.

## Composition ∩ self-coherence: the dual-lens loop

The walkthrough targets a composition evolution (step 2 picks a musical target via `evolve(focus='design')`) but the same pass also monitors HME for errors and improvement opportunities.

**How the dual lens works:**
- `evolve(focus='design')` emits composition targets AND surfaces any HME health issues it encountered while scanning
- `read(target, mode='before')` pulls KB constraints AND reports stale/wrong/missing entries
- Edits on the target may expose boundary violations that should be covered by new hooks
- `review(mode='forget')` audits changes against KB AND flags KB entries that are contradicted by the new code
- `learn(title=, content=)` at graduation persists BOTH the composition finding AND any HME observations as a combined entry with a `## HME observations` section

The primer at step 1 tells the agent to watch for HME issues while doing composition work. There is no separate self-coherence branch.

## Graduation

Graduation fires when `learn(title=, content=)` is called with both `title` and `content` non-empty and state is `verified`. The chain_exit handler:

1. Sets state to `graduated`
2. Deletes `tmp/hme-onboarding.state` and `tmp/hme-onboarding.target`
3. Appends `🎓 HME ONBOARDING COMPLETE` to the learn() result
4. All subsequent tool calls bypass onboarding gates

Graduation is per-session. The next `SessionStart` re-initializes state to `boot` via [sessionstart.sh](../tools/HME/hooks/sessionstart.sh):`_onb_init`.

## Compaction resilience

The onboarding state file lives in `tmp/`, which survives compaction. No special PreCompact/PostCompact handling is required today. If we later need post-compaction re-priming, add a `postcompact.sh` rule that reads `_onb_state` and injects a status reminder into context.

## Native TodoWrite integration (E4)

The walkthrough state mirrors into the HME todo store as a parent todo with one sub per step. When the agent calls native `TodoWrite`, the `pretooluse_todowrite.sh` hook merges the onboarding tree into the agent's native list via `updatedInput`, so the walkthrough appears in the session-visible todo view alongside the agent's own work items.

Flow:

1. `set_state(new_state)` writes the state file AND calls `register_onboarding_tree(steps)` in [tools/HME/service/server/tools_analysis/todo.py](../tools/HME/service/server/tools_analysis/todo.py)
2. The todo module rebuilds the parent's sub list, preserving existing sub IDs by matching on step text (no ID churn across transitions)
3. On the next `TodoWrite` call, [pretooluse_todowrite.sh](../tools/HME/hooks/pretooluse_todowrite.sh) reads the HME store, calls `merge_native_todowrite()`, and returns the merged flat list as `hookSpecificOutput.updatedInput`
4. Native TodoWrite runs with the merged list — the agent sees the walkthrough as indented sub-items under a parent `[HME onboarding] walkthrough`
5. On graduation, `clear_onboarding_tree()` removes the parent + all subs

The todo store is the single source of truth for visible work; the onboarding state file remains authoritative for the chain decider's gate logic (fast path, no JSON parsing needed).

## Failure modes

- **State file missing mid-session** — treated as `graduated`. Permissive; never gets the agent stuck.
- **Python onboarding_chain import fails** — shell hooks still work (they read the state file directly via `cat`). Tool handlers fall through: no state advancement, no chain output.
- **Agent picks a non-existent target at step 3** — `read()` returns an error; state stays `targeted`. No advancement. Agent retries.
- **Agent edits outside `/src/` during onboarding** — no block. Hooks only gate `/src/` edits.
- **Selftest fails at boot** — `chain_enter` still prepends the selftest output. State stays `boot`. Agent sees failures and fixes them before proceeding.
- **User interrupts mid-loop** — state persists. Next prompt shows `_nexus_pending()` reminder. Agent resumes.
- **Compaction** — state file survives. Walkthrough continues from current step.

## Adding new steps

To add a state to the machine:

1. Add it to `STATES` in [onboarding_chain.py](../tools/HME/service/server/onboarding_chain.py)
2. Add a `STEP_LABELS` entry
3. Add a transition branch in `_advance()`
4. Add the matching state to `_ONB_STATES` in [_onboarding.sh](../tools/HME/hooks/_onboarding.sh)
5. Add its step-label case in `_onb_step_label`
6. Update this table

To add a new gate for an external tool:

1. In the hook's `pretooluse_*.sh`, source `_onboarding.sh`
2. Check `_onb_before "state_name"` and emit a `decision: "deny"` with an instructive reason
3. In the matching `posttooluse_*.sh`, advance state via `_onb_advance_to`

## What is NOT enforced

- **Graduation persistence across sessions.** Every new session re-arms onboarding. This matches LLM amnesia: the "veteran" from the last session has no memory of that loop.
- **Order within a state.** Inside `briefed`, the agent can Edit multiple files in any order. Onboarding doesn't micromanage the edit sequence.
- **Quality of the learn() content.** Graduation only checks that title and content are both non-empty. KB quality lives elsewhere (`evolve(focus='curate')`).

## Reference

- [doc/AGENT_PRIMER.md](./AGENT_PRIMER.md) — what the primer hook injects on first HME call
- [doc/HME.md](./HME.md) — the broader HME reference
- [tools/HME/service/server/onboarding_chain.py](../tools/HME/service/server/onboarding_chain.py) — Python state machine
- [tools/HME/hooks/_onboarding.sh](../tools/HME/hooks/_onboarding.sh) — shell helpers
- [tools/HME/hooks/sessionstart.sh](../tools/HME/hooks/sessionstart.sh) — initializes state to `boot`
- [tools/HME/hooks/pretooluse_hme_primer.sh](../tools/HME/hooks/pretooluse_hme_primer.sh) — injects primer on first HME call
