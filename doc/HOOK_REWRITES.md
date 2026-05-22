# Hook auto-rewrites and blocks

PreToolUse and PostToolUse hooks run policies from
`tools/HME/policies/builtin/`. Policies fall into three kinds:

- **block-*** — deny the tool call when the pattern fires.
- **rewrite-*** — mutate the tool input/output in place so the call can
  proceed without a model retry. Surfaced as `DDoC stripped:` system
  reminders.
- **nexus-*** — informational checks gated by the unified TODO/NEXUS
  surface.

This document inventories every policy currently registered so the
model has a single place to look up "why did my edit lose a line / get
rewritten / get blocked?".

## rewrite policies (silent mutation)

| Policy                          | Trigger                                                | Mutation                                                                  |
|  |  |  |
| `rewrite-console-warn-prefix`   | `console.warn('...')` without the `Acceptable warning: ` prefix | Prepend the prefix to the first string argument.                  |
| `rewrite-except-pass-silent-ok` | Python `except ...: pass` with no annotation           | Append `# silent-ok: pending review` to the pass line.                    |
| `rewrite-hardcoded-project-root`| Hardcoded project-root literal in Write/Edit content   | Replace with `$PROJECT_ROOT`.                                             |
| `block-character-spam`          | 4+ identical decoration chars (`====`, `####`, etc.)   | Strip the offending runs in-place. Per-line opt-out via `spam-ok` token.  |
| `block-comment-bloat`           | 3+ consecutive non-annotation comment lines            | Truncate long comment lines and remove bloat lines.                       |
| `block-comment-ellipsis-stub`   | Comment-ellipsis stub placeholders (`// ... rest`)     | Strip the stub.                                                           |

The "block-" prefix on the last three is historical; they currently
rewrite rather than block. New rewrite-class policies should use the
`rewrite-` prefix.

## block policies (deny)

| Policy                          | Trigger                                                                              |
|  |  |
| `block-curl-pipe-sh`            | `curl ... \| sh` / `wget ... \| bash` and variants (supply-chain attack pattern).    |
| `block-git-checkout-clobber`    | Broad `git checkout <ref> -- .` clobbers and direct restore of unified TODO state.   |
| `block-memory-dir-writes`       | Writes to `.claude/projects/.../memory/`.                                            |
| `block-mid-pipeline-write`      | Writes/edits to `src/` while `tmp/run.lock` exists.                                  |
| `block-misplaced-log-tmp`       | Writes to nested `log/` or `tmp/` subdirectories (must live at project root).        |
| `block-misplaced-metrics`       | Writes to `metrics/` outside `src/output/metrics/`.                                  |
| `block-mkdir-misplaced-log-tmp` | `mkdir` of nested `log/` or `tmp/` directories.                                      |
| `block-mkdir-misplaced-metrics` | `mkdir` of `metrics/` outside `src/output/metrics/`.                                 |
| `block-runlock-deletion`        | Deletion of `tmp/run.lock`.                                                          |
| `block-secret-content-pattern`  | Write/Edit content matching known secret patterns.                                   |
| `block-secrets-write`           | Writes to canonical secret file paths (`.env`, `.credentials.json`, etc.).           |

## nexus policies

| Policy                          | Trigger                                                                              |
|  |  |
| `nexus-edit-check`              | Edits to files referenced by an open NEXUS TODO entry.                               |
| `no-conflicts`                  | Edits to files currently flagged in merge-conflict state.                            |
| `auto-fill-agent-description`   | Spawning a sub-agent without a `description` argument.                               |

## Surface messages

When a rewrite policy fires, the model receives a `system-reminder`
containing `DDoC stripped: <rule_name> <details>`. To attribute a strip
back to the responsible policy, search the policy directory for the rule
name printed in the message.

## Lint-only mode (proposed)

Setting `HME_POLICIES_LINT_ONLY=1` would route all rewrites to warnings
(no mutation) for a development window. This is not implemented yet but
is the cleanest path to making policy churn visible during refactors
without disabling the policies entirely.
