# Context Capsule: review proxy filter_tools middleware

## artifact
tools/HME/proxy/middleware/03_filter_tools.js -- central proxy middleware that
removes configured tool definitions from outgoing Anthropic payloads. The capsule
also includes tools/HME/proxy/shared/load_env.js because _projectDropList reuses
its parseEnvFile helper for project .env syntax.

## goal
Find decision-changing correctness/safety flaws in the central tool-filter path
that could crash requests, leak project configuration across contexts, mutate the
wrong tools, lose cache_control, or undermine the settled policy that ask-peer has
no local tool-deny path and filtering is centralized here. Cite function + fix.

## constraints
Peers are driver forks with full inherited context and live tool access; any tool
filtering is centralized here via HME_FILTER_TOOLS_DROP. Empty/unset drop lists
are documented as no-op. The middleware may run for current and replayed payloads;
it must be deterministic, idempotent per payload, root-scoped when PROJECT_ROOT is
provided, avoid process.cwd fallback for project .env reads, and call ctx.markDirty()
when payload.tools changes. Review only the source in evidence unless you verify
extra facts with tools.

## rubric
Classify P0/P1/P2. For each finding: function/block, exact failure mode, one-line
fix. Reject style comments and non-shipping preferences. Prefer config-loading,
cache_control preservation, multi-project/session leakage, malformed tool shapes,
and doc/code contract mismatches.

## coverage
included: full source for 03_filter_tools.js including _stripInlineComment,
_projectDropList, _optionalProcessDropList, _dropSet, onRequest,
HME_FILTER_TOOLS_DROP parsing, cache_control rescue, ctx.PROJECT_ROOT handling,
and the imported load_env.js parseEnvFile helper.
excluded: unrelated proxy middleware, ask-peer.sh, team_dispatch_guard.py, and
upstream Claude tool schema semantics beyond what appears in evidence.

## evidence
Live source (read fresh at dispatch -- never a stale copy):
- tools/HME/proxy/middleware/03_filter_tools.js
- tools/HME/proxy/shared/load_env.js

