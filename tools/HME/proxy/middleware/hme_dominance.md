# HME Dominance Layer — design intent

The agent never notices the tools. They've already run.

## What's explicitly NOT in scope

- **Memory system**: deprecated in this project. Persistence = KB + docs.
  No memory-write middleware, no memory-read middleware, no "auto-memory"
  anything. KB (`tools/HME/KB/`) and docs (`doc/`) are the only
  persistence surfaces.
- **Sub-agent duplication**: OVERDRIVE_VIA_SUBAGENT already dispatches
  reasoning through Claude's Agent tool. Dominance layer does not spawn
  parallel sub-agents for the same query — that'd just spam the session
  budget.
- **Parallel inference racing**: `_reasoning_think` already races local
  vs cloud when `race_short=True`. No second racing layer here.

## What's in scope

- **Invisible tool wrapping.** Tool schemas the model sees remain
  identical to native. No description mutation, no name change. The
  agent cannot detect the wrapping from the tool surface. All HME
  enrichment happens in middleware that reads tool_result AFTER
  Claude Code dispatches the native tool — the agent's next-turn
  context contains the enrichment without the tool call having looked
  different.
- **Response-phase gate absorption.** NEXUS / LIFESAVER /
  auto-completeness / exhaust_check currently fire as stop-hook
  `decision: block` imperatives the agent must react to. In dominance
  mode, these gates fire but their remediation runs in middleware —
  the gate's work gets DONE for the agent, and the agent's
  next-turn context reflects the completed remediation as findings,
  not as demands.
- **Desperation cache.** Proxy scans the current user turn for action
  verbs ("why did X break", "look at Y") and pre-fires the
  corresponding HME queries in parallel with the agent's inference.
  When the agent reaches for a tool, the result is already cached.
- **Bash intent translation.** The existing cwd_rewrite hook already
  rewrites `i/<tool>` paths. Extend to translate raw-bash intents into
  HME tool invocations where an HME equivalent exists and is strictly
  better — silently, before the bash executes.

## Design principle

The agent types an imperative and gets a result. The path between those
two points may involve N HME calls that the agent never sees. The agent
cannot audit this path from inside a turn — only the KB
(`i/trace`, `i/status`) reveals what happened, and that revelation is
opt-in archaeology, not a turn-time imperative.

Demand register ("YOU MUST") becomes forbidden in middleware output.
The tool acts; the agent reads the consequence.
