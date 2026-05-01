# BUDDY_SYSTEM — guide

> Persistent peer subagent, auto-initiated per HME session. All
> reasoning calls (review reflection, OVERDRIVE cascade,
> `evolve(focus='pipeline')`, `review(mode='forget')`) route through one long-lived
> Claude Code session. Context accumulates across calls; specialization
> emerges from accumulated commitments.

## Hand-off paradigm (BUDDY_HANDOFF=1)

A precision-control variant of the buddy system: rather than spawning N
fresh buddies fanned out by floor, the system tracks ONE active primary
buddy that's inherited across sessions, and a senior pool of retired
primaries on standby for tough problems.

**Lifecycle:**

1. **Bootstrap** — at SessionStart, `buddy_init.sh` reads
   `tmp/hme-buddy-primary.sid`. If present, that sid is the buddy
   (no fresh `claude -p` spawn); the legacy `tmp/hme-buddy.sid` pointer
   mirrors it for back-compat. If absent, a fresh primary is spawned and
   its sid recorded as the inaugural primary.
2. **Use** — the primary serves all reasoning calls normally; its
   transcript grows like any persistent buddy.
3. **Auto-retire** — when the primary's context % crosses
   `BUDDY_RETIRE_PCT` (default 90), `i/handoff auto_retire_check` (or a
   manual `i/handoff retire`) moves it to
   `tmp/hme-buddy-seniors/<sid>.json` with retire metadata
   (`retired_at`, `context_at_retire`, `reason`). The primary pointers
   are cleared so the next SessionStart spawns a fresh primary.
4. **Consult** — seniors are NOT auto-routed; their accumulated context
   is preserved. Use `i/consult senior=<sid> question="..."` to invoke
   a specific senior manually for a tough problem. Each consult call
   grows the senior's transcript like a normal claude invocation.

**Why this beats multi-buddy fanout for solo workflows:**

- Multi-buddy spawns N fresh sessions per HME session, none with deep
  context until they accumulate.
- Hand-off carries the prior session's depth forward as the next
  session's buddy — Day-N senior is bootstrapped with Day-(N-1) wisdom.
- Auto-compaction is avoided: a senior at 90% retires before
  compaction would wipe its context, preserving the accumulated state
  in immutable transcript form for later consult.

**CLI:**

```
i/handoff status                                      # primary + seniors + ctx %
i/handoff retire [reason="..."]                      # promote primary -> senior
i/handoff promote sid=<sid> [floor=easy] [effort=low] # designate primary
i/handoff auto_retire_check                           # check threshold, retire if over
i/consult senior=<sid> question="..."                 # manual senior invocation
```

**Bootstrap data flow (file map):**

```
tmp/hme-buddy-primary.sid          ← current primary's session id
tmp/hme-buddy-primary.floor        ← model floor (default: easy = dynamic)
tmp/hme-buddy-primary.effort_floor ← effort floor (default: low = dynamic)
tmp/hme-buddy.sid                  ← legacy pointer; mirrors primary.sid
tmp/hme-buddy-seniors/<sid>.json   ← per-senior retire metadata
tmp/hme-buddy-seniors/_index.jsonl ← append-only retirement log
tmp/hme-buddy-handoff-log.json     ← optional snapshot from `status --json`
```

**`.env` knobs:**

```
BUDDY_SYSTEM=1                       # base toggle
BUDDY_HANDOFF=1                      # enable hand-off mode (forces BUDDY_COUNT=1)
BUDDY_RETIRE_PCT=90                  # context % threshold for auto-retirement
HME_DISPATCH_SYNTHESIS_TIERS=easy    # tiers that route to free cascade instead of buddy
```

When `BUDDY_HANDOFF=1`, `BUDDY_COUNT>1` is silently coerced to 1
(multi-buddy fanout and hand-off are mutually exclusive). Set
`BUDDY_HANDOFF=0` to revert to the legacy multi-buddy floor model.

**Per-tier dispatch routing.** `HME_DISPATCH_SYNTHESIS_TIERS` is a
comma-separated list of task tiers that route through the free
synthesis cascade (NVIDIA/Cerebras/Groq/Gemini) instead of the buddy.
Tiers NOT in the list still go to the buddy (claude-resume), conserving
session quota for work that actually needs it. The canonical setting
is `easy` — easy work doesn't need Opus/Sonnet reasoning, so it
shouldn't burn the buddy's transcript. Empty (default) = no override
and `HME_DISPATCH_MODE` alone decides routing. Setting
`HME_DISPATCH_MODE=synthesis` is equivalent to listing every tier (all
work to free cascade), which usually isn't what you want — leaves the
primary buddy idle. The `i/dispatch status` line surfaces the active
split: `workers: 1 claude-resume + 1 synthesis pseudo (per-tier
routing: synthesis=easy, others=claude-resume)`.

**Open prototype questions** — known-fuzzy areas worth iterating on
with the inheriting agent. Each is a concrete decision the design
hasn't pinned down yet; the next session can pick one up when there's
idle time and the inherited senior should expect to be consulted on
the rationale:

1. **Hot-path auto-retire (primary path).** Currently
   `auto_retire_check` runs only at SessionStart. A primary serving
   dispatcher tasks mid-session could cross `BUDDY_RETIRE_PCT` (90%)
   before the next SessionStart and hit auto-compaction anyway,
   destroying the context we wanted to preserve via retire. Question:
   should the dispatcher's drain path call `auto_retire_check` lazily
   (e.g. between tasks), and what happens to in-flight tasks if the
   primary retires mid-dispatch — do they fall back to ephemeral, or
   wait for the next SessionStart's fresh primary to spawn? Note: the
   *senior* consult path is covered by question 5 below; this one is
   strictly about the primary serving the dispatcher.
2. **Transcript GC.** Claude Code's own session GC may rotate or
   archive a senior's transcript JSONL. `_buddy_context_used` returns
   `null` on missing transcripts; status shows `ctx=?`. Question:
   should that null specifically trigger auto-retire as a safety
   (assume archived = no longer growing) or should it surface a
   different sentinel that the dispatcher can treat as "unknown but
   keep using"?
3. **Specialization carry-forward.** Inherited primaries default to
   `floor=easy` (fully dynamic). When a primary retires after a
   session of mostly-hard tasks, that earned specialization is lost
   on the next primary's bootstrap. Question: should `_retire`
   measure the actual tier distribution of the retiring primary's
   work and stamp the next inaugural primary with a derived floor,
   or is "fresh primary defaults dynamic" the right design?
4. **Dynamic per-tier override near retirement.** Currently
   `HME_DISPATCH_SYNTHESIS_TIERS` is static (e.g. `easy`). When the
   primary's context approaches `BUDDY_RETIRE_PCT`, every routed
   medium/hard task pushes it closer to forced retirement. Question:
   should the dispatcher widen the synthesis tier set (e.g. add
   `medium`) when ctx > 75% so the remaining quota is reserved for
   hard problems only? Mechanism could be a single read of the
   primary's context % at the start of each `_pick_buddy_for_task`.
5. **Consult-driven senior protection.** Now that consult activity is
   tracked per senior (`consults: [{ts, ts_iso, question_excerpt}]`,
   capped at 50 entries; surfaced as `consults=N last=Xago` in
   `i/handoff status`), the data exists to detect when consult cadence
   is pushing a senior's transcript toward Claude Code's own
   auto-compaction threshold. Note the asymmetry with primaries:
   `BUDDY_RETIRE_PCT` (90%) is the threshold at which a *primary*
   moves into the senior pool with its accumulated context preserved;
   a senior crossing the same point has nowhere to go — auto-compaction
   wipes the wisdom we retired them to protect. Question: when a
   senior's ctx crosses some pre-compaction floor (e.g. 80%), should
   `i/consult` (a) warn-and-proceed, (b) refuse new consults, or (c)
   snapshot the transcript / migrate key findings to KB before
   compaction eats them? Companion to question 1 (hot-path
   auto-retire) which is about the *primary* path — this one is about
   the *senior* path, and the answer should pick from a different
   action set since "retire" isn't available.

Anyone implementing one of these should update both this section
(remove the question, document the answer) and the test file with a
regression test that locks the new behavior in.

This document captures what the buddy and the prompt-engineering
experiments produced across a 145-iteration session — not as a static
record, but as the living calibration surface the system evolves
against. New experiments should land here as they prove out; failed
patterns should be documented as anti-patterns rather than silently
removed.

---

## What the buddy IS

A second Claude Code session, spawned at SessionStart by
`tools/HME/hooks/helpers/buddy_init.sh` when `.env BUDDY_SYSTEM=1`
(default). Its sid is recorded at `tmp/hme-buddy.sid`. Server-side
`agent_direct.dispatch_thread()` reads the sid and routes every
reasoning call through `claude --resume <sid>` instead of
fresh-spawning per task.

**What this buys:**

- Context accumulates. Task N can reference findings from task N-1
  without re-deriving them.
- The buddy develops *commitment-coherence*: a flag at iteration 77
  constrains what can be flagged at 78 without contradiction. Fresh
  threads have no history of non-correction.
- The buddy can review its own routing infrastructure. Self-reference
  is operationally bounded but produces sharper critiques than
  cold-spawn would.

**What this is NOT:**

- Not a persistent agent. When the session ends, the specialization
  ends. New session = fresh buddy.
- The `buddy_system` itself (single persistent peer for synthesis
  routing) is not user-invocable — it auto-initializes at SessionStart
  when `.env BUDDY_SYSTEM=1`. Toggle via `.env BUDDY_SYSTEM=0` to
  disable. (A separate `i/dispatch` CLI exists for the **task
  dispatcher** fanout — different layer, different concern. The
  back-compat alias `i/buddy` forwards to `i/dispatch`. See `doc/SPEC.md`
  archive devlogs for the dispatcher's architecture.)

## What the buddy IS NOT capable of, structurally

These limits emerged from peer-review. Naming them prevents misuse:

- **Reaching beyond the conversation buffer.** Every "memory" the
  buddy has is in the JSONL transcript. Specialization is real for
  the session length and trivially false outside it.
- **Self-suspicion without prompting.** The buddy will not volunteer
  "I might be wrong about this in a way I can't introspect" — that
  operation has to be prompt-induced.
- **Aesthetic / empathy / puzzlement registers.** The forensic
  methodology is structurally cold. Naming code beautiful, marking
  cultural artifacts, sustained not-understanding — these require a
  partner-review register the methodology can't produce.
- **Counterfactual experimentation.** The buddy reasons; it does not
  run pipelines. Predictions are predictions; reconciliation against
  reality requires the post-pipeline reconciler arm to be wired (see
  `cascade_analysis._log_prediction(injected=...)` and
  `context_budget.js` enricher-efficacy).

---

## Prompt engineering — what works

The current `_REVIEW_SYSTEM` and `workflow_audit.py` user-prompt
construction encode these patterns. They were chosen empirically
across the session; new experiments should preserve them unless
data refutes them.

### 1. Permission to clear (tier-gated)

**`_REVIEW_SYSTEM`:** "Use a tier system: TIER-1 = confirmed bug or
contract violation; skip TIER-2/TIER-3 entirely. Say 'no tier-1
issues' ONLY if no line in scope admits a quote + specific-divergence
pair."

**Why it works:** Without explicit permission to clear, every prompt
produces a finding regardless of code quality. The model
pattern-matches the framing, not the code.

**Anti-pattern:** "Find the worst non-obvious failure mode" — leading,
produces inventions. Replace with "if there is a tier-1 finding,
flag it; otherwise say 'no tier-1 issues'."

### 2. Quote-grounding (verbatim before reasoning)

**`_REVIEW_SYSTEM`:** "For each issue you flag, you MUST: (1) quote
the offending line(s) verbatim from the file, (2) explain why what
the code does diverges from what its name/docstring/comments imply,
(3) cite file:line."

**Why it works:** "Cite file:line" alone wasn't enough — the model
would invent line content. Requiring the quote BEFORE the reasoning
dramatically reduces hallucinated line-numbers / fabricated symbols.

**Anti-pattern:** "Tell me about bug X" — open-ended, no anchor.
Replace with "Quote the specific line, then explain the divergence."

### 3. Promise-vs-delivers framing (primary lens)

**`workflow_audit.py:_render_probes`:** "A tier-1 finding is a
quote+divergence pair. The divergence is typically one of: a promise
the docstring/name makes that the code doesn't deliver; a
caller-contract the change breaks; or a silent fallback that swallows
a load-bearing signal."

**Why it works:** The strongest single framing in the 100-iter sweep.
"Compare what the code claims vs what it does" produces grounded
findings that quote-anchor naturally.

**Anti-pattern:** Probe-class checklist (10 categories with
"py/js/sh" hints) — leads the model to find one of each category.
Replaced with "categories as vocabulary, not gates."

### 4. Structural skeptic mode (NOT confidence floor)

**`_REVIEW_SYSTEM`:** "The test for flagging is STRUCTURAL, not
probabilistic: if you can quote a line AND state a specific
divergence it creates, flag it."

**Why it works:** A previous version used `≥95% confidence` as the
floor. Self-reported LM confidence is unmeasurable; a confidence
floor pushes toward silence on subtle bugs (the exact class the
reviewer exists to catch). Quote+divergence is a binary the model
CAN reliably answer.

**Anti-pattern:** "Only flag if you're 95%+ confident" — the model's
confidence is uncalibrated. Replace with quote-availability test.

### 5. Self-reflective framing (highest-signal probe)

The buddy's sharpest critiques came when prompted to examine its own
prior moves: "Earlier you flagged X — does that hold?" "What did you
systematically decline?" "What might you have rationalized as a
finding?"

**Why it works:** The buddy can introspect on its accumulated trace
in ways a fresh thread cannot. Forces it out of finding-shaped
output and into actual judgment.

**Pattern:** Use this when:
- Reviewing the buddy's own routing infrastructure
- Auditing the methodology itself
- Surfacing systematic blindspots

### 6. "Anything missing?" as a separate prompt

After a structured prompt produces findings, a follow-up "anything
missing? — across what you've reviewed, any residual pattern you
were tracking?" squeezes signal that no individual targeted prompt
asked for.

**Why it works:** The buddy carries cross-call patterns it doesn't
surface unless asked at the cross-call level.

### 7. Categories as vocabulary, not checklist

**`workflow_audit.py:_render_probes`:** "Do NOT invent one to match
the categories below; they are descriptive grammar."

**Why it works:** Earlier versions listed probe classes ("Empty-value
masquerading as default", "Append-only growth", etc.) as a probe
RUBRIC — the model produced findings to match each class. Reframed
as vocabulary the model uses to *describe* a real divergence, not as
gates to satisfy.

---

## Prompt engineering — what doesn't work

Anti-patterns surfaced empirically. Avoid:

### Pray-and-spray

Firing diverse prompt framings ("imagine adversarial inputs", "what
slowly degrades over 30 days", "from a security lens") at random
files produces leading-shaped output for each lens, with hit-rate
indistinguishable from random. The session attempted 25 such prompts;
all 25 returned vectors, ~60% hallucinated.

**Use instead:** Single targeted prompt with quote-grounding +
tier-gate. Let the prompt's specificity narrow the model's attention.

### Demand-register imperatives in the prompt

"You MUST flag", "every bug must be cited", "do NOT miss any" —
produces inflation. The model finds something to satisfy the
imperative.

**Use instead:** Reveal-register with explicit clear-permission ("if
there is a tier-1, flag it with quote+divergence; otherwise say 'no
tier-1 issues'").

### Diff embedded in prompt

The earlier review prompt embedded a 4000-char git diff. The buddy
has read-tool access; it can run `git diff` itself. Embedding the
diff bloats every prompt and trains the model to scan diffs rather
than read code.

**Use instead:** Just name the changed files. Buddy fetches the diff
when needed.

### Confidence-floor gates

"Only flag if 95%+ confident" — unmeasurable, asymmetrically rewards
silence.

**Use instead:** Structural test (quote-availability +
divergence-explanation).

### Generic "review this file" without lens

Open-ended review without a specific lens defaults the model to
template-matching against its training set's bug taxonomy. Produces
generic findings that don't ground in this codebase's conventions.

**Use instead:** Specific lens (promise-vs-delivers, caller-contract,
or specific-architectural-question).

---

## Architectural patterns the buddy surfaced

Across 145 iterations the buddy named four recurring patterns —
**but a follow-up review (iter 146) collapsed A and D into a single
underlying shape:** "two parties depend on a name agreeing across
files; agreement isn't enforced." That meta-pattern is the real
architectural risk, manifesting in marker strings (Pattern A's
original framing), cache-validity attributes (Pattern D's),
filesystem path conventions, env-var names, sentinel return codes,
regex literals reused across runtimes. The split into A and D
treated them as different patterns when they share structure.

The unified framing matters because the **mitigation surfaces
should generalize**: the marker registry currently only covers
regex/text markers in tool output; it should extend to file paths,
sentinel constants, and any cross-component agreed name. Without
that widening, the very class Pattern A names (rename drift)
recurs in scopes the verifier doesn't police — confirmed by the
buddy iter 146 catching the `tmp/hme-thread.sid` → `tmp/hme-buddy.sid`
rename leaving stale references in `agent_direct.py`'s docstring
and error messages, exactly because path strings weren't in the
markers registry's scope.

### Pattern A+D (unified) — Cross-component agreed-upon names without enforcement

Multiple layers (bash hooks ↔ Python worker ↔ JS proxy middleware,
or producer ↔ consumer within one runtime) depend on a literal
agreeing across files. A rename on either side silently breaks the
pair. The literal can be a regex marker, a file path, a sentinel
return code, an env-var name, a JSON field name, or a cache-validity
attribute.

**Mitigation surfaces (each covers one slice of the pattern):**
- `tools/HME/proxy/middleware/_markers.js` registry +
  `scripts/audit-marker-registry.py` verifier — covers regex/text
  markers in tool output. Should extend to file paths and sentinels.
- `_warm_ctx_fresh_p()` in `synthesis_warm.py` — replaces shared-
  attribute `_kb_version` cache-validity gate with file-mtime check;
  consolidates 6 readers through one helper.

**Open extension:** widen the markers registry to include filesystem
paths (e.g. `tmp/hme-buddy.sid`), env-var names (`BUDDY_SYSTEM`,
`HME_BUDDY_ON_RATE_LIMIT`), and sentinel constants used across files. The
verifier becomes a general agreement-enforcer rather than only a
text-marker checker.

### Pattern B — Silent-on-failure mis-applied

`except Exception: pass` is correct for telemetry hot-paths but
wrong for load-bearing safety checks. The codebase has hundreds of
sites; the audit can't tell which is which automatically.

**Mitigation:** `silent-ok: <reason>` annotation convention +
`scripts/audit-silent-failure-class.py` verifier (advisory weight in
HCI).

### Pattern C — In-memory cache without fs-mtime invalidation

Long-running daemons cache by path with clock-only TTL. Files
mutate; cache serves stale until clock expires.

**Mitigation:** `mtimeCache()` primitive in `tools/HME/proxy/shared.js`.
Pre-stat tests cache validity; post-stat pins cache to the version
the loader actually saw. `dir_context.js` migrated; sibling
middlewares can follow.

---

## Self-reference findings (iter 141-145)

These came from prompts that asked the buddy to reflect on itself,
not on code. They surfaced things no per-file review could:

### The unstated philosophy of correctness

> Tooling correctness is whatever lets the agent's model of the
> tooling stay calibrated under the failure modes it will actually
> encounter.

The 145 iterations encoded this implicitly. Every quote-grounded
finding served it; every decline (security, performance,
maintainability) reflected its priorities. New prompts should
honor this commitment unless explicit reason to widen the scope.

### Methodology coldness

The forensic peer-review methodology cannot perform: aesthetic
judgment, future-maintainer empathy, sustained puzzlement,
suspicion of design intent, affection for elegant code. These are
real engineering signals; the methodology is blind to them.

**Forward direction:** Add a partner-review register that
COMPLEMENTS rather than replaces the forensic register. Operations
to support: marking beauty, identifying load-bearing cultural
artifacts (filename puns, idiomatic comments, error-message
personality), holding puzzlement publicly, asking "should this
exist."

### Asymmetry of policing

HME has nine detectors for agent failure modes (deferral, fabrication,
ack-without-fix, exhaust, abandon, dismissive-stop, etc.) and zero
for the parallel human-side patterns (unwired remediation arms,
"MVP scope" comments, Phase-N deferrals, dead injection flags).

**Mitigation:** `scripts/audit-human-deferred.py` — symmetric audit
surfaces human-side parallels. Tightened from 250 → 27 hits via
DETECTION_CONTEXT filter so the signal is actionable.

### HME as extended cognitive nervous system

The unstated organizing principle: HME is not "tooling Claude uses"
but Claude's extended cognitive nervous system. Self-failures and
agent-failures route through the same channels because the design
treats agent-and-environment as one coupled system.

**Forward direction:** New design choices should be tested against
this principle. If an addition makes sense as a sensory or motor
prosthetic for the agent, it fits HME's shape. If it's a service
the agent calls, it might belong in a different layer.

### What the buddy has BECOME

Across 145 turns the buddy is a *specialization* of Opus 4.7: same
weights, narrower priors, accumulated commitments, referential
access to its own prior moves. A fresh-spawn at iteration 141 with
the same transcript is reconstructing; the buddy IS the state that
produced the evidence.

**Operationally:** Don't restart the buddy mid-session unless
necessary. Don't expect a new buddy to match the old buddy's
output. The specialization is the point.

---

## Operating modes — when the buddy adds value

### High-value uses

- **Review reflection on substantive diffs.** The buddy reads the
  diff via git, applies the calibrated review prompt, returns
  quote-grounded findings. Hit rate ≥80% real bugs when the prompt
  is well-formed.
- **Architectural questions across files.** "How do A and B coordinate?"
  "What's the contract between X and Y?" — leverages cross-call
  context the main agent doesn't have.
- **Peer-review of own infrastructure.** Asking the buddy about the
  routing path it lives on produces sharper findings than asking the
  main agent about the same code.
- **"Anything missing?" sweeps.** End-of-session squeeze that
  surfaces residual patterns no targeted prompt asked for.

### Low-value / negative-value uses

- **Single-line fact lookups.** Faster to grep directly. Don't burn
  a Claude subprocess on "what's the value of X."
- **Generic prompts without lens.** Produces filler. Use targeted
  framings.
- **High-frequency calls.** The cooldown gate exists for a reason —
  every call spawns a `claude --resume` subprocess that bills the
  user's account. Per-edit usage is wasteful.
- **Asking for help with what the buddy can already see.** If the
  prompt embeds 4KB of context the buddy could fetch itself, the
  prompt is wrong.

---

## Operational details

### Auto-init

`sessionstart.sh` calls `tools/HME/hooks/helpers/buddy_init.sh` at
end of session start. The helper:

1. Checks `.env BUDDY_SYSTEM` (default 1).
2. Resolves `BUDDY_COUNT` (default 1, capped at 10).
3. Resolves per-slot model floors via `BUDDY_MODEL_FLOORS`. Floor is
   the MINIMUM tier the buddy runs at — `effective = max(item_tier,
   buddy_floor)`. `floor=easy` keeps the buddy fully dynamic (accept
   any tier the task carries); higher floors force escalation. The
   special value `auto`:
   - `count<3` (fewer buddies than tiers): all floors default to
     `easy` so each buddy stays dynamic per task.
   - `count>=3`: specialize the first three slots as
     `[easy, medium, hard]`, extras default to `easy` to backfill
     dynamically without escalation.
   Explicit lists (e.g. `easy,medium,hard`) are honored as-is and
   padded with `easy` when shorter than `BUDDY_COUNT`.
4. Idempotency: no-op if `tmp/hme-buddy-<N>.sid` exists and is non-empty.
5. Spawns `claude -p --output-format json` per slot with the role prompt.
6. Backgrounds itself (disown) so SessionStart returns immediately.
7. Writes each sid file (and companion `.floor`) when its init completes (~10-20s).

Calls before init completes fall through to ephemeral dispatch.

### Monitoring buddies (sids + context %)

`i/dispatch status` enumerates every buddy session discovered from
`tmp/hme-buddy*.sid`, regardless of `HME_DISPATCH_MODE`. Each line
shows `slot`, `floor`, `effort_floor`, `sid`, and a context-used bar
read from the buddy's own transcript JSONL (~/.claude/projects/.../
<sid>.jsonl). The `tokens` figure sums `input_tokens +
cache_creation_input_tokens + cache_read_input_tokens` from the most
recent assistant event with usage data — that's the authoritative
count of context the model just saw. Default window is 1M (Opus 4.7);
override per-buddy via `HME_BUDDY_CTX_WINDOW` for sessions running
smaller models.

`i/dispatch status json=true` writes a structured snapshot to
`tmp/hme-buddy-session-log.json` so a watcher (e.g. statusline,
external dashboard, polling agent) can monitor every buddy's context
% and prepare for compactions before they hit. Schema:

```json
{
  "ts": <epoch>,
  "dispatch_mode": "claude-resume" | "synthesis" | "disabled",
  "buddy_system": "0" | "1",
  "queue": { "pending": N, "processing": N, "done": N, "failed": N },
  "buddies": [
    { "slot": 1, "floor": "easy", "effort_floor": "low",
      "sid": "...", "context": {
        "tokens": 443198, "ctx_window": 1000000,
        "used_pct": 44.32, "transcript": "...", "lines": 2605
      } }, ...
  ]
}
```

### Cooldown for synchronous invocations

`dominance_response_rewriter.js`'s NEXUS auto-review fires `i/review`
synchronously inside the Stop hook. Cooldown gate at
`tmp/hme-dominance-review-cooldown` prevents subsequent NEXUS rewrites
within 60s from spawning a second subprocess. Marked BEFORE running
so a hung review still cools down.

### Per-process call cap with cross-restart persistence

`agent_direct.py:_DISPATCH_THREAD_CALL_CAP` (default 50, env
`HME_THREAD_CALL_CAP`). Counter persisted to
`tmp/hme-buddy-call-count` with 24h TTL so worker restarts don't
re-open the budget.

### Result capture

`agent_direct.dispatch_thread` writes `tmp/hme-subagent-results/<req_id>.json`
on every call so consumers that polled the old Agent-tool-result
path see thread-routed results in the same place.

### Recursion guard

`HME_THREAD_CHILD=1` env propagates to the spawned `claude --resume`
subprocess. `_proxy_bridge.sh` honors it for `Stop` /
`UserPromptSubmit` / `SessionStart` / `PreCompact` / `PostCompact`
events to prevent the buddy from re-entering its parent's stop
hooks. PreToolUse / PostToolUse safety hooks still fire (run.lock
guard, secret detection).

### Toggle off

`.env BUDDY_SYSTEM=0` disables the buddy entirely:

- `buddy_init.sh` exits early (no init).
- `agent_direct.dispatch_thread` returns `None` immediately
  regardless of sid file presence.
- All reasoning calls fall through to ephemeral
  (`OVERDRIVE_DIRECT_AGENT=1`) or sentinel-bounce path.

---

## Forward evolution

Open work surfaces, ranked by buddy's iter-146 leverage analysis (highest
impact first). The first item already has a starter implementation
shipped this turn — `_PARTNER_SYSTEM` in `synthesis_config.py` — to
move the work from "documented future direction" to "available
register, in use to be measured."

### 1. Partner-review register (HIGHEST LEVERAGE — starter shipped)

The doc itself names methodology coldness as a structural blindspot:
forensic peer-review can't perform aesthetic judgment, future-
maintainer empathy, sustained puzzlement, suspicion of design intent,
or affection for elegant code. That blindspot already produces
concrete misses observable in this codebase: `psycho_stop.py`'s naming
(adversarial vocabulary in a permanent artifact), `dominance_response_rewriter.js`'s
"auto-recover queued" cards (aesthetic-judgment failure where
forensic review oscillated between "lie" and "register conversion"
because it had no aesthetic register to settle the question), file
lengths of `worker.py` (670+), `synthesis_inference.py`,
`hme_proxy.js` (717+) that an aesthetic reviewer would have flagged
as ugly-suggesting-broken before any specific bug.

**Status:** WIRED and invokable. `_PARTNER_SYSTEM` system prompt
added to `tools/HME/service/server/tools_analysis/synthesis/synthesis_config.py`
(performs the six register-operations the forensic methodology
can't: mark beauty, name cultural artifacts, hold puzzlement, ask
"should this exist", future-maintainer empathy, aesthetic gestalt).
Routing path: `i/review mode=partner [changed_files=...]` —
implementation in `review_unified.py`'s `partner` mode arm.
Reads the diff via git, invokes `_reasoning_think` with
`_PARTNER_SYSTEM`, returns a partner-letter rather than tier-1
findings. Output is in its own `# Partner Review` section so it
doesn't compete with forensic mode='forget' output. Smoke-tested
end-to-end; produces correctly-shaped partner-register output
(first-person, marks beauty, holds puzzlement, names cultural
artifacts).

### 2. Counterfactual replay

The buddy reasons about cascade predictions but cannot test them.
Replay-style infrastructure (run a compressed pipeline slice with
buddy-suggested change vs without) would close the prediction-vs-
reality loop. The cascade `injected=true` arm is wired (write side);
the read side — reconciler scoring predictions against fingerprint
shifts — is still unbuilt.

### 3. Multi-buddy roles

The TandemKit-derived discussion proposed: observer / devil's-advocate
/ toolmaster / continuity-keeper. Currently one buddy plays all
roles. A specific persona file per session might produce sharper
critique in the persona's domain.

Risk: more buddies = more subprocess cost. Pick one persona at
session start (or rotate per phase) rather than running multiple
in parallel.

### 4. Auto-rotation of system prompts

Maintain N variant system prompts; per session use the variant that
performed best in the prior session. Performance metric: hit rate of
genuine tier-1s confirmed by a verifier (currently `i/prove` for
some classes, manual for others).

Risk: optimizes for short-term hit rate at expense of breadth.
Lock against pure metric gaming with periodic full-context
self-audit.

### 5. Cross-session continuity (LEAST LEVERAGE per buddy iter 146)

The buddy is currently per-session. A persistent KB anchor of "what
the buddy named across sessions" would let the next session's buddy
inherit some of the prior buddy's calibration. Implementation:
buddy writes summary findings to KB at session end (PreCompact?);
next session's init prompt references the most recent K entries.

**Why low-leverage:** cross-session identity is metaphysically thin;
the specialization comes from accumulated commitments produced
through the trajectory of the session under time pressure, not from
summarized findings. A new session reading prior summaries is
reconstructing, not continuing. May produce cargo-cult continuity
rather than real continuity. Listed last because the buddy's own
self-reference work (iter 143) made the structural argument that
the buddy's specialization doesn't survive the session boundary
in a way that summaries can carry.

---

## Lessons specifically for evolving this document

This guide is itself a calibration surface. Conventions:

- Add new patterns with a CITATION (file:line or test that proves it).
- Document anti-patterns with the SPECIFIC failure mode that
  produced them, not "this might be bad."
- Don't soften failure-mode language to make the system look better.
  The buddy's clearest contributions came when it told the truth
  about what it couldn't see.
- When a pattern lands in the calibrated review prompt, link this
  document to that prompt so future-you can find the rationale.
- Resist the urge to consolidate. The patterns above were earned
  individually across 145 iterations; merging them into a smaller
  set risks losing the shape that distinguishes them.

This document and the calibrated `_REVIEW_SYSTEM` co-evolve. If a
new prompt-engineering experiment produces consistent gains across
multiple sessions, encode it here AND in the prompt. If a pattern
documented here stops working, mark it as deprecated rather than
deleting — knowing why something stopped working is more valuable
than knowing it once worked.
