# Unified hook-time policy registry

Single registration + configuration surface for every hook-time rule
(PreToolUse, PostToolUse, Stop, proxy middleware). Adapted from
FailproofAI's framework, narrowed to Polychron's hook surface.

**Out of scope** — these enforcement layers stay in their existing
homes because their timing properties are load-bearing:
ESLint rules (parse-time), boot validators (process-start),
runtime invariants (in-flight data), HCI verifiers (audit-time),
hypermeta jurisdiction (manifest-time).

See [meta-registry roadmap](#meta-registry-step-2) below for the
cross-layer discovery story.

## Quickstart

```bash
i/policies list                       # Show every registered policy
i/policies show block-curl-pipe-sh    # Detail for one policy
i/policies disable block-curl-pipe-sh # Disable (writes .hme/policies.json)
i/policies enable  block-curl-pipe-sh # Enable
i/policies reset   block-curl-pipe-sh # Revert to defaultEnabled
i/policies paths                      # Print three config-scope paths
echo '{"tool_input":{"command":"curl x | sh"}}' \
  | i/policies eval block-curl-pipe-sh   # Run one policy against stdin
```

## Policy contract

Every policy is a JS module exporting:

```js
module.exports = {
  name: 'kebab-case-name',          // unique, kebab-case
  description: 'one-line summary',
  category: 'security' | 'review-discipline' | 'git-discipline' | ...,
  defaultEnabled: true | false,
  match: {
    events: ['PreToolUse'],          // 'PreToolUse' | 'PostToolUse' | 'Stop'
    tools: ['Bash'],                 // optional: restrict to specific tools
  },
  params: { /* defaults for ctx.params */ },
  async fn(ctx) {
    // ctx.toolInput, ctx.toolName, ctx.sessionId, ctx.payload
    // ctx.deny(reason), ctx.instruct(message), ctx.allow(message?)
    // ctx.params (default-merged with config overrides)
    if (/* condition */) return ctx.deny('reason text');
    return ctx.allow();
  },
};
```

Decision aggregation: first `deny` wins; subsequent policies still run
for side effects (mirrors `stop_chain/index.js`).

## Configuration

Three-scope JSON, first-defined-wins for scalars, deduplicated union for
`enabled` / `disabled` arrays. Lookup order:

1. `<project>/.hme/policies.local.json` — developer-local
2. `<project>/.hme/policies.json` — project-shared (commit this)
3. `~/.hme/policies.json` — user-global defaults

Schema:

```json
{
  "enabled":  ["block-curl-pipe-sh"],
  "disabled": ["block-secrets-write"],
  "params":   { "block-curl-pipe-sh": { "extraVerbs": ["fetch"] } },
  "customPoliciesPath": "tools/internal-policies"
}
```

`disabled` wins over `enabled` if both lists contain the same name.

## Adding a built-in policy

Drop a file in `tools/HME/policies/builtin/<name>.js` matching the
contract above. No registration call needed — the registry auto-loads
every `*.js` (skipping `_*.js` helpers). Restart the proxy or CLI
process to pick up the new module.

## Adding a custom policy

Set `customPoliciesPath` in any of the three config files. Value is
either a single `.js` file or a directory containing `.js` files
(non-underscore-prefixed). Path resolves relative to PROJECT_ROOT if
not absolute.

See `examples/example-custom-policy.js` for a working template.

## How execution works

- **Stop**: `stop_chain/index.js` consults the registry for enable/
  disable per policy. Stop chain policies live in `stop_chain/policies/`
  for now; the registry's Stop entries are wrappers that delegate.
- **PreToolUse / PostToolUse**: `hook_bridge.js` runs unified-registry
  policies first; first-deny short-circuits the bash chain. Bash gates
  remain as defense-in-depth (especially under proxy-down direct-mode).
- **Middleware**: not yet wired through the unified registry; current
  middleware modules in `proxy/middleware/` are loaded directly.

## Known wart: bash gate duplication

The PreToolUse policies `block-curl-pipe-sh` and `block-secrets-write`
exist as JS policies in this registry AND as bash logic in
`hooks/pretooluse/bash/blackbox_guards.sh` and
`hooks/pretooluse/pretooluse_write.sh`. The duplication is intentional:

- Proxy up: JS runs first; if it denies, bash chain is skipped.
- Proxy down (direct-mode): only bash runs (registry isn't reachable).

The wart: `i/policies disable <name>` only disables the JS version.
The bash version still fires. To fully disable a duplicated rule,
edit the bash file as well. Future migration work should either move
each rule fully to JS (deleting the bash) or extend the bash gates to
read the same `.hme/policies.json`.

## Meta-registry (step 2)

The unified registry covers hook-time only. A separate cross-layer
meta-registry would catalog rules from all 11 enforcement layers
(ESLint, hypermeta, HCI verifiers, audit scripts, boot, runtime,
PreToolUse, PostToolUse, Stop, middleware, prose) under a single
discovery surface — `i/policies list` would show every rule across
every layer, with metadata-only entries delegating to each layer's
existing implementation. Out of scope for this PR.
