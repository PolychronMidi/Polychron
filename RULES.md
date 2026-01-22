# RULES
Review this file proactively any time the slightest doubt arises.

All rules can be summarized in the 5 rules:

Changes in `/src`, `/test`, or `/docs` require coherent correspondence across all 3 which follows each one's unique rule.

These 3 rules (Source, Test, Docs) are tied together with the TODO rule (`npm run am-i-done`) and the Efficiency rule (Serena, subagents, batching, reading logs.)


## RULE 1: TODO - Tracking Accountability At Each Step
Every task must be tracked in `TODO.md` using the prescribed workflow to ensure accountability and clarity
- Every task must begin with the command `npm run todo` which creates `TODO.md`
- Before reporting progress or asking for confirmation, always make sure all TODO items are complete first, then run `npm run am-i-done` to verify completion status.
- If all items in TODO.md are not marked done, or Initial Status for tests and errors does not match Latest Status, return to working on the task until fully complete.
- Never start a new TODO file when there is one in progress, and never commit to git.
- Only when `npm run am-i-done` reports all items complete and statuses match, report completion and request confirmation to proceed.

### RULE 1A: Anti-Harassment - Respect Diversity
- Never report partial progress or ask for confirmation until all items in TODO.md are complete.
- This team consists of neurodiverse members: respect their need for ONLY minimal, emergency-only pings outside of the main team communication channel TODO.md.
- Requests for clarification and confirmation to continue should be reserved only for emergecies or high-danger situations.
- Where ambiguity or uncertainty as to which option to proceed with exists, note the ambiguity in the relevant TODO.md line, and why the chosen direction was taken.
- Assume all progress is being reviewed live in TODO.md and that work will be manually cancelled if deemed unacceptable.

## RULE 2: Source - /src

Code should be clean, minimalist, dynamic, and coherent in a self-documenting way that only requires minimal comments, with full descriptions reserved for that files's relevant .md file in /docs.


## RULE 3: Test - /test SEE ALSO: /docs/test.md

Core principle: Test real implementations, not mocks. Tests align with Polychron's core goal to maximize dynamism and evolution.

### Why This Matters
- Polychron is an experimental music composition sandbox; tests must catch actual bugs in integration scenarios
- No mock/code divergence; single source of truth
- Rapid iteration: change code, immediately see what breaks
- DO: Scan dynamic code, DON'T hardcode
- DO: Import real functions, DON'T mock

### Test Architecture
- Framework: Vitest
- Import pattern: Side-effect imports for globals (`import '../../src/sheet.js'`), then specific imports
- Global state: `setupGlobalState()` in `test/helpers.ts` (uses real defaults)
- Mock usage: Only for callbacks (`vi.fn()`); never for core functions
- Test namespace: Use `g.__POLYCHRON_TEST__?.enableLogging` for debug output


## RULE 4: Docs - /docs
Documentation must be clear, accurate, and automatically synchronized with source code to ensure reliability and ease of maintenance.

### Commands
- `npm run docs:fix` – Auto-link modules + inject code snippets + update README status
- `npm run docs:watch` – Watch mode for live doc updates
- `npm run docs:check` – Validation only (CI-safe)
- `npm run docs:status` – Update root README.md test status block
- `npm run docs:index` – Regenerate docs/README.md index

### How Docs Works
Auto-linking: Plain module names → `module.ts ([code](../src/module.ts)) ([doc](module.md))`
Snippet injection: Markers like `<!-- BEGIN: snippet:ClassName_method -->` pull real source code

1. Create `docs/ModuleName.md` from template (`docs/.TEMPLATE.md`)
2. Reference modules as plain text (e.g., "stage.ts coordinates with play.ts")
3. Add snippet markers where live code should appear:
   ```markdown
   <!-- BEGIN: snippet:Stage_setTuningAndInstruments -->
   <!-- END: snippet:Stage_setTuningAndInstruments -->
   ```
4. Run `npm run docs:fix`
5. Update `docs/README.md` index

### Common Docs Mistakes
DON'T DO: Manual links: `[stage.ts](../src/stage.ts)` → Write "stage.ts" plainly, let script link it
DON'T DO: Pasted code: Copy-paste drifts → Use snippet markers for real-time injection
DON'T DO: Hardcoded lists: Module arrays go stale → Use `generateModuleMapping()` in scripts\


## RULE 5: Efficiency
Use Serena MCP commands, subagents, and batching as much as possible for efficiency.

### File Edits
- DO: Use all available Serena MCP tools as often as possible (`replace_content`, `replace_symbol_body`, `insert_at_line`, `create_text_file`)
- DO: batch smaller tasks together use subagents for efficiency.
- DON'T DO: Never use terminal commands where native tools or MCP tools exist
- Why: Terminal edits corrupt file encoding and line endings

### Reading Output
- DO: After changes: Run test/lint once, then read logs from `/log/` directory
- DO: For inspection: Read existing logs (`/log/test.log`, `/log/lint.log`)
- DON'T DO: Re-run tests just to view output
- Why: Logs persist; re-running wastes tokens

### Code Navigation
- DO: Large files: Use `get_symbols_overview`, `find_symbol`, `search_for_pattern`
- DON'T DO: Use `read_file` on files >500 lines
- Why: Symbolic tools are token-efficient

### Batch Operations
- DO: Prefer `multi_replace_string_in_file` for related edits
- DON'T DO: Perform sequential single-edit operations
- **Why**: One batch call vs. N separate calls
