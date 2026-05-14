# HME Public Tool Surface (Complete Reference)

> Mode tables for evolve / review / read / learn / trace / hme_admin plus a "when to use what" lookup. Linked from [HME.md](HME.md).

## When to Use What

| I want to... | Use |

| Find code by intent | `find("where does convergence happen")` |
| Find all callers of a function | `find("callers of convergenceDetector")` |
| Find boundary violations | `find("X should use Y", mode="boundary")` |
| Check if a change is safe | `read("symbolName", mode="impact")` |
| Audit a file for conventions | `review(mode='convention', file_path='path')` |
| Check constraints before editing | `read("path/to/file.js", mode="before")` |
| Find exact variable name | `find("varName", mode="grep")` |
| Check KB for stale entries | `learn(action='health')` |
| Understand a module deeply | `read("moduleName", mode="story")` |
| Preview rename impact | `find("oldName->newName", mode="rename")` |
| What should I work on next? | `evolve()` |
| Post-pipeline review | `review()` or `review(mode='full')` |
| Trace a signal through the system | `trace("emergentRhythm")` |
| Search the KB | `learn(query='coupling constraints')` |
| Add a KB entry | `learn(title='...', content='...', category='pattern')` |
| Enrich a prompt with project context | `enrich_prompt(prompt='...', frame='focus on...')` |
| Search 2-3 specific files | Read tool (not HME -- overkill) |


## The Public Tool Surface -- Complete Reference

Five agent-callable HME tools route explicit public capability: `evolve`, `review`, `learn`, `trace`, and `hme_admin`. Native `Read`, `Edit`, `Grep`, `Glob`, and `TodoWrite` are enriched automatically by proxy hooks; internal helpers (`search_code`, `find_callers`, `module_intel`, `before_editing`, the todo bridge, etc.) are called BY these paths -- agents never invoke them directly.

### 1. `evolve(focus)` -- "What should I work on next?"

| focus | What it does |
--
| `"all"` (default) | LOC offenders + coupling gaps + pipeline suggestions + synthesis |
| `"loc"` | Top oversized files in src/ |
| `"coupling"` | Dimension gaps + antagonism leverage points |
| `"pipeline"` | Pipeline-based evolution suggestions |
| `"patterns"` | Meta-patterns across journal rounds: confirm rates, subsystem receptivity |
| `"seed"` | Auto-generate starter KB entries for high-dependency modules with zero coverage |
| `"contradict"` | Full KB pairwise contradiction scan -- finds conflicting entries, suggests resolution |
| `"stress"` | Adversarial self-play -- 35 enforcement probes across LIFESAVER, hooks, ESLint, feedback graph, selftest |
| `"invariants"` | Declarative invariant battery -- loads checks from `config/invariants.json`. 10 check types, extensible without Python changes |

### 2. `review(mode, ...)` -- Post-pipeline review hub

| mode | Extra params | What it does |
-
| `"digest"` (default) | `critique=True/False` | Pipeline digest with evolution suggestions. Auto-drafts KB entry on STABLE |
| `"regime"` | | ASCII regime timeline + transitions |
| `"trust"` | `system_a`, `system_b` | Trust ecology. Empty = leaderboard. Two systems = rivalry with overtakes |
| `"sections"` | `section_a`, `section_b` (0-indexed) | Side-by-side section comparison |
| `"audio"` | | Perceptual analysis (EnCodec + CLAP). 15% confidence |
| `"composition"` | | Section arc biographies + drama moments + hotspot leaderboard |
| `"health"` | | Full-repo convention sweep, prioritized by severity |
| `"forget"` | `changed_files` (auto-detects from git) | Post-change audit: missed constraints, boundaries, doc needs |
| `"convention"` | `file_path` (required) | Audit single file against conventions |
| `"symbols"` | | Dead code detection + importance ranking |
| `"docs"` | | Verify docs match implementation |
| `"full"` | | Sequential: digest + regime + trust |

### 3. `read(target, mode)` -- Smart code reader

**Auto-detection** (mode="auto", default): format determines behavior.

| target format | What happens |

| `"src/path/file.js"` | File structure + KB context |
| `"src/path/file.js:10-50"` | Extract lines 10-50 |
| `"src/path/file.js:42"` | Line 42 +/- 10 lines context |
| `"functionName"` (camelCase) | Get function body, or module story if it's a src/ module |
| `"anything else"` | Semantic code search (top 5) |

**Explicit modes:**

| mode | What it does |
-
| `"before"` | **Pre-edit briefing**: KB constraints + callers + boundaries + evolutionary potential |
| `"story"` | Module living biography (definition, evolution, callers, neighbors) |
| `"impact"` | Callers + KB constraints (blast radius) |
| `"both"` | Story + impact combined |
| `"lines"` | Line range extraction |
| `"function"` | Function body extraction |
| `"structure"` | File structure (symbols, functions, globals) |
| `"callers"` | All call sites of the target |
| `"deps"` | Dependency graph for a file |

### 4. `learn(...)` -- Unified KB interface

**Auto-detection** from parameters (no mode needed):

| What you pass | What happens |

| `query='coupling constraints'` | Search KB (semantic + BM25 + cross-encoder reranking) |
| `title='R94 fix', content='...'` | Add KB entry. Optional: `category`, `tags`, `related_to`, `listening_notes` |
| `remove='entry_id'` | Delete KB entry |

**Explicit actions** (override auto-detection):

| action | What it does |

| `"list"` | List all entries (filter by `category`) |
| `"compact"` | Deduplicate similar entries (threshold=0.85) |
| `"export"` | Export entire KB as markdown |
| `"graph"` | Spreading-activation knowledge graph (uses `query`) |
| `"dream"` | Pairwise similarity pass -- discover hidden connections |
| `"health"` | KB staleness check (stale file refs, wrong line counts) |

**Categories:** `architecture`, `decision`, `pattern`, `bugfix`, `general`
**Relation types:** `caused_by`, `fixed_by`, `depends_on`, `contradicts`, `similar_to`, `supersedes`

### 5. `trace(target, mode, section, limit)` -- Signal flow tracing

| mode | What it does |
-
| `"auto"` (default) | Detects: beat key (S3/2:1:3:0/400) -> snapshot; L0 channel -> cascade; else -> module |
| `"snapshot"` | Full state at one beat: regime, trust, coupling labels, notes. Beat key formats: `S3`, `2:1:3:0`, `400` |
| `"cascade"` | L0 channel cascade trace, 3 hops deep |
| `"module"` | Per-section trace: regime, tension, trust scores, value ranges |
| `"causal"` | Causal trace: constant -> controller -> metric -> musical effect |
| `"interaction"` | Correlate two modules' trust scores: cooperative/competitive/independent |
| `"delta"` | Compare current vs previous pipeline run: feature deltas, regime shifts, trust changes |

### 6. `hme_admin(action, modules, antipattern, hook_target)` -- HME maintenance

| action | What it does |

| `"selftest"` (default) | Verify tool registration, doc sync, index, llama.cpp, KB, symlinks |
| `"reload"` | Hot-reload tool modules (modules='module1,module2' or 'all') |
| `"both"` | Reload then selftest |
| `"index"` | Reindex all code chunks + symbols |
| `"clear_index"` | Wipe hash cache + chunk store, rebuild from scratch |
| `"warm"` | Pre-populate all caches: Tier 1 callers+KB, Tier 2 synthesis, GPU KV contexts |
| `"introspect"` | Self-benchmarking: tool usage patterns, workflow discipline, KB health |
| `"fix_antipattern"` | Synthesize bash snippet to enforce a behavioral rule in a hook (antipattern=, hook_target=) |

`hook_target` options: `pretooluse_bash`, `pretooluse_edit`, `pretooluse_read`, `pretooluse_grep`, `pretooluse_write`, `posttooluse_bash`, `stop`, `userpromptsubmit`.

`enrich_prompt` is an internal function accessible via HTTP shim (`/enrich_prompt`) -- not an MCP tool.


## Knowledge KB

68 entries across 4 categories. FSRS-6 spaced repetition: frequently retrieved entries resist temporal decay.

| Category | Count | What to Store | Example |
--
| `architecture` | 27 | Boundary rules, module profiles, system topology | "feedbackOscillator -- 198 lines, highest hotspot rate 31.7%" |
| `decision` | 17 | Calibration anchors, threshold choices, confirmed rounds | "R80 LEGENDARY: complexity triple-bridge" |
| `pattern` | 15 | Anti-patterns, proven patterns, evolution recipes | "antagonism bridge: couple BOTH sides of antagonist pair" |
| `bugfix` | 9 | Root causes, fixes, prevention rules | "perceptual OOM: force CPU when llama.cpp warm contexts resident" |
