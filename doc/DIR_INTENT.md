# Directory Intent Convention

Every cohesion-boundary directory gets a `README.md` that renders normally on GitHub, with a machine-readable block hidden at the bottom. The hidden block contains the local `rules` that govern edits in that subtree; the visible README content above it is the dir's `intro`.

Aggregated into `output/metrics/hme-dir-intent.json` by `scripts/pipeline/hme/build-dir-intent-index.py`. The proxy's `dir_context` middleware reads the index and injects the closest ancestor dir's `rules` into tool results when the agent touches files in that subtree.

## When to add a README

Not every directory — only **cohesion boundaries**:

- Subsystem roots (`src/conductor`, `src/crossLayer`)
- Architectural zones (`tools/HME/proxy`, `tools/HME/proxy/middleware`, `scripts/pipeline/validators`)
- Any directory where a local rule or invariant applies that isn't derivable from code

Leaf dirs where the dirname is self-documenting don't need one unless a local rule applies.

## Schema

```markdown
# Subsystem Name

Normal human-facing README content — headings, prose, links. Renders on GitHub
without the metadata below showing. Write it as you would any README.

## Whatever sections make sense for humans

...

<!-- HME-DIR-INTENT
rules:
  - Never hand-tune meta-controller constants — modify controller logic instead
  - Bias bounds are locked; snapshot after structural changes with <command>
-->
```

### Fields

- **`rules`** — list of terse imperative strings. Each item is ONE rule. No "should"/"might" — either a rule or it doesn't belong. Rules that duplicate `CLAUDE.md` verbatim are flagged as redundant (CLAUDE.md covers global; READMEs cover local).

### `intro` is implicit

The aggregator captures everything above the `<!-- HME-DIR-INTENT -->` block and stores it as the directory's `intro`. The file serves double duty: humans see a normal README, the aggregator extracts both halves. No field duplication.

## What NOT to put in rules

- **Global rules** already in `CLAUDE.md` (fail-fast, no globals, self-registration, etc.) — flagged as redundant.
- **File-listing / changelog / prose that paraphrases code** — the code and git history are authoritative.
- **Cross-directory references** — a rule about directory A should live in A's README, not B's.

## Aggregator behavior

`scripts/pipeline/hme/build-dir-intent-index.py`:

1. Walks project, finds every `README.md` containing an `<!-- HME-DIR-INTENT -->` block
2. Parses YAML inside the block; captures the README body above it as `intro`
3. Computes drift signature: `(file_count_depth_1, file_list_hash, manager_file_content_hash_prefix)`
4. Compares against stored signature in `output/metrics/hme-dir-signatures.json`; flags drift
5. Writes `output/metrics/hme-dir-intent.json`
6. Flags candidate dirs missing a README (≥5 source files + `index.js`/`__init__.py`/`Manager.js`)

READMEs without the `<!-- HME-DIR-INTENT -->` block are ignored — they're normal human READMEs using some other convention (e.g., HuggingFace model cards).

## Proxy middleware integration

`tools/HME/proxy/middleware/dir_context.js` fires on `Read` / `Edit` / `Write` / `NotebookEdit` / `Grep` / `Glob`:

- Walks up from the target file to the closest tracked directory
- Appends one line: `[HME dir:<basename>] <rule1> | <rule2>` (max 2 rules, ~180 char budget)
- Silent when no tracked ancestor
- Idempotent via `ctx.hasHmeFooter` (prevents restart-stacking)

`intro` is **never** auto-injected. It's surfaced only when the agent explicitly reads the README.

## Drift handling

- `output/metrics/hme-dir-signatures.json` stores each directory's last-known signature
- On aggregation: if current signature diverges, the directory is tagged `drifted: true` in the index
- The middleware still injects rules even when drifted, but adds a `(drifted)` tag — rules age slower than prose, but the agent should be skeptical
- `review(mode='health')` surfaces drifted and invalid entries

## Trade-offs

- **No per-rule drift protection** — rules are imperatives that tend to remain valid across implementation changes. A stale rule gets corrected by a human.
- **No auto-generation** — READMEs are authored. The aggregator is read-only.
- **Single source of truth** — the file is both the human-facing README and the machine-parseable source. No sidecar files.
