# Directory Intent Convention

Machine-readable YAML frontmatter at the top of `README.md` files. Aggregated into `metrics/hme-dir-intent.json`; the proxy's `dir_context` middleware injects the local rules when the agent touches that subtree. Fills the "what invariants govern this dir?" gap that code, KB, and CLAUDE.md can't efficiently answer on their own.

## When to add a README

Not every directory — only **cohesion boundaries**:

- Subsystem roots (`src/conductor`, `src/crossLayer`)
- Architectural zones (`tools/HME/proxy`, `tools/HME/mcp`, `scripts/pipeline/validators`)
- Anywhere local rules apply that aren't derivable from code or global CLAUDE.md

Leaf dirs where the dirname is self-documenting (`src/conductor/signal/profiling/`) don't need one unless a local rule applies.

## Schema

```markdown
---
name: <foldername>                      # must match dirname
rules:                                  # terse, imperative, LOCAL rules
  - Never hand-tune meta-controller constants — modify controller logic instead
  - Bias bounds are locked; snapshot after structural changes with <cmd>
info: |                                 # why this dir exists; drift-risky prose
  <short paragraph — role in the system>
children:                               # optional; only when children differ in purpose
  signal/profiling: Runtime feature extractors (L0 recorders)
  signal/meta: Meta-observer layers consuming profiler output
---

# Free-form human-facing README body.
```

### Field rules

- **`name`**: aggregator verifies against dirname; mismatch = fail.
- **`rules`**: each item is ONE terse imperative. No "should"/"might" — either a rule or it doesn't belong. Rules that duplicate CLAUDE.md verbatim are flagged as redundant (CLAUDE.md already covers global; this is for local).
- **`info`**: 2–5 sentences. Role, key invariants, non-obvious references. Drift-prone — the aggregator hashes it and flags divergence from the directory's actual file list.
- **`children`**: use when child dirs differ in purpose enough to warrant one-line descriptions. Keep to 3–7 entries. Omit entirely for flat or uniform directories.

## What NOT to put in a README

- **Global rules** already in CLAUDE.md (fail-fast, no globals, self-registration pattern, etc.) — flagged as redundant by the aggregator.
- **File listings** — the filesystem is authoritative; prose copies drift instantly.
- **Change history / changelog** — belongs in git.
- **Prose that paraphrases code** — if the code is the source of truth, don't write a prose copy.

## Aggregator behavior

`scripts/pipeline/hme/build-dir-intent-index.py`:

1. Walks project, finds every `README.md` with frontmatter
2. Parses; validates `name` against dirname
3. Computes current signature: `(file_count_depth_1, file_list_hash, manager_file_content_hash_prefix)`
4. Compares against stored signature in `metrics/hme-dir-signatures.json`; flags drift
5. Writes `metrics/hme-dir-intent.json` — the index the proxy reads
6. Optionally flags **candidate dirs missing a README** (≥5 source files + index/manager + referenced by parent subsystem)

## Proxy middleware integration

`tools/HME/proxy/middleware/dir_context.js` fires on `Read`/`Edit`/`Write`/`Grep`/`Glob`:

- Walks up from the target file, finds the closest tracked dir in the index
- Appends one line: `[HME dir:<name>] <rule1> | <rule2>` (max 2 rules, ~150 chars)
- Silent if no tracked ancestor or if the tool_result already has an HME footer

Info / children / full body are NEVER auto-injected — surface them only when the agent explicitly reads the README.

## Drift handling

- `metrics/hme-dir-signatures.json` stores each dir's last-known signature
- On aggregation: if current signature diverges, the dir is tagged `drifted: true` in the index
- `review(mode='health')` surfaces drifted dirs
- The middleware still injects rules even when drifted — rules drift more slowly than info; the worst case is the rule being stale, not wrong prose

## Intentional trade-offs

- **Per-rule drift protection is NOT attempted** — rules are imperatives that tend to remain valid even as implementations change. If a rule becomes wrong, a human updates it.
- **No auto-generation** — READMEs are authored, not synthesized. The aggregator is read-only.
- **No cross-dir references in rules** — a rule about dir A should be in A's README, not B's. Keeps aggregation local.
