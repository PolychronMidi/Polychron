# HME Chat Session Transfer

You are resuming development of the HME Chat system — a custom VS Code chat panel at `tools/HME/chat/` that routes every message through the HME intelligence layer. This is the Polychron project's self-evolving composition system.

## What Exists (Built and Compiled)

### Chat Extension (`tools/HME/chat/`)
- **`src/extension.ts`** — VS Code activation entrypoint, registers `hme-chat.open` command (Ctrl+Shift+H)
- **`src/ChatPanel.ts`** — Full WebviewPanel with inline HTML/CSS/JS chat UI. Session sidebar (left panel), toolbar (route/model/effort/thinking selectors), message rendering (thinking accordion, tool steps, cost badge), streaming cursor, notice bar (warn/block/audit/info levels), HME shim status indicator
- **`src/router.ts`** — 5 streaming functions: `streamClaude` (-p mode), `streamClaudePty` (PTY with hooks), `streamOllama`, `streamHybrid` (KB-enriched Ollama), plus `fetchHmeContext`, `validateMessage`, `auditChanges`, `postTranscript`, `reindexFiles`, `postNarrative`, `isHmeShimReady`
- **`src/Arbiter.ts`** — Local qwen3:4b classifies message complexity (`classifyMessage`) and synthesizes narrative digests (`synthesizeNarrative`). Returns `{route, confidence, reason}`
- **`src/TranscriptLogger.ts`** — Append-only JSONL to `log/session-transcript.jsonl`. 500 entries in memory, time-windowed retrieval, auto-rotate at 2MB. Logs: user, assistant, tool_call, route_switch, validation, audit, narrative, session_start/resume. Narrative callback fires every 8 turns
- **`src/SessionStore.ts`** — Persistent sessions at `~/.config/hme-chat/workspaces/{sha256(projectRoot)[:16]}/`. Index + per-session JSON. Stores messages, ollamaHistory, claudeSessionId
- **`src/types.ts`** — ChatMessage interface

### HME HTTP Shim (`tools/HME/mcp/hme_http.py`)
- 7 endpoints: `/health`, `/enrich`, `/validate`, `/audit`, `/transcript` (GET+POST), `/reindex`, `/narrative`
- Loads same LanceDB as MCP server (same KB, same model)
- Transcript store: in-memory mirror of JSONL, time-windowed retrieval
- Start: `PROJECT_ROOT=/home/jah/Polychron python3 tools/HME/mcp/hme_http.py` (port 7734)

### PostToolUse Hook (`tools/HME/hooks/log-tool-call.sh`)
- Universal matcher ("") in `.claude/settings.json` — logs every tool call from main Claude session
- Appends to `log/session-transcript.jsonl` + mirrors to HTTP shim + triggers `/reindex` for Edit/Write

## Data Flow (Every Message)

```
User message → /validate (KB anti-patterns) → [Auto?] Arbiter classifies
→ TranscriptLogger.logUser() + POST /transcript
→ Dispatch: PTY Claude (hooks fire) | Ollama | Hybrid (KB+transcript enriched)
→ Tool calls logged in real-time
→ TranscriptLogger.logAssistant() + mirror to shim
→ Parse tool calls → /reindex modified files
→ /audit (git diff + KB constraint check)
→ Every 8 turns: narrative synthesis via qwen3:4b → /narrative
→ Session saved to disk
```

## Five Routes

| Route | Backend | Cost |
|-------|---------|------|
| Auto | qwen3:4b arbiter decides | Free classification |
| Claude | `claude` via PTY (hooks fire, bypassPermissions) | Subscription |
| Local | Ollama streaming | Free |
| Hybrid | KB+transcript enrichment → Ollama | Free |

## Key Design Decisions

- **bypassPermissions** is the default — no tool permission prompts
- **PTY mode** (node-pty) for Claude route so `.claude/settings.json` hooks fire. Falls back to `-p` stream-json if PTY fails
- **Cross-route history portability**: switching from Claude→Local rebuilds ollamaHistory from unified messages array. Local→Claude starts fresh session (could inject as context block)
- **Auto route**: arbiter prompt includes recent transcript context + KB constraint density
- **Session auto-creation** on first message, title from first 60 chars
- **Model list**: claude-opus-4-6, claude-sonnet-4-6, claude-haiku-4-5-20251001 (canonical IDs, no duplicates)
- **Local models**: qwen3-coder:30b (GPU0), qwen3:30b-a3b (GPU1), qwen3:4b (arbiter)

## What to Test and Develop Next

### Immediate Testing
1. **Install and load the extension**: `cd tools/HME/chat && npm install && npm run compile && ln -s $(pwd) ~/.vscode/extensions/hme-chat` — reload VS Code, Ctrl+Shift+H
2. **Start the HTTP shim**: `PROJECT_ROOT=/home/jah/Polychron python3 tools/HME/mcp/hme_http.py &`
3. **Test each route**: Send a simple message on Claude, Local, Hybrid, Auto — verify streaming works
4. **Test session persistence**: Send a message, close panel, reopen, click session in sidebar — verify history restores
5. **Test cross-route portability**: Start on Claude, switch to Local mid-conversation — verify Local sees prior history
6. **Test notice bar**: Send a message mentioning "coupling matrix" or "binaural" — verify KB constraints appear
7. **Test auto routing**: Send simple "what does processBeats do?" (should route local) vs "refactor the coupling engine across 5 files" (should route claude)
8. **Test transcript**: After a few messages, check `log/session-transcript.jsonl` — verify entries accumulate. Also `curl http://127.0.0.1:7734/transcript?minutes=60` to verify HTTP shim sees them

### Known Issues to Investigate
- PTY mode prompt detection (`PTY_DONE_PATTERNS`) may need tuning — Claude CLI output patterns may vary by version
- Narrative synthesis (every 8 turns) hasn't been tested end-to-end — verify qwen3:4b produces useful digests
- ~~`/reindex` endpoint calls `_project_engine.index_file()` — verify this method exists~~ **FIXED (R97)**: `index_file` + `_index_file_locked` added to `RAGEngine` in `rag_engine.py`. Single-file mini-reindex now works correctly.
- Cross-route history injection for Claude→after→Local (prepending prior Local history as context block in Claude's first message) is not yet implemented — currently just starts a fresh Claude session

### Development Roadmap
1. **Context injection on route switch to Claude**: When switching from Local/Hybrid to Claude, serialize prior conversation as a context block in the first message to the new Claude session
2. **Narrative quality tuning**: The arbiter prompt for `synthesizeNarrative` may need refinement — test output quality and adjust
3. **Streaming thinking in Hybrid mode**: Currently Hybrid only gets text chunks from Ollama — could add thinking mode for qwen3 models that support it
4. **Session rename UI**: Double-click session title in sidebar to rename
5. **Export session**: Button to export full conversation as markdown
6. **Auto-start HTTP shim**: Have the extension auto-start `hme_http.py` if not running when panel opens
7. **Multi-panel support**: Allow multiple chat panels (like vs-agentic's multi-window)

## Critical Project Rules (from CLAUDE.md)

- Use `npm run main` for the full pipeline, never individual scripts
- Globals via `require()` side effects, never `global.` or `globalThis.`
- Fail fast — no silent early returns, no `|| 0` fallbacks
- Use `validator.create('ModuleName')` for all validation
- Before modifying any src/ file: `read("moduleName", mode="before")`
- After changes: `review(mode='forget')` (auto-detects from git)
- For any search: use `find(query)` instead of Grep
- Never remove `tmp/run.lock`
- Never delete code before checking if it should be implemented
- Auto-commit after each verified non-regressive pipeline run

## HME MCP Tools Available

11 tools: `evolve`, `find`, `review`, `read`, `learn`, `status`, `trace`, `hme_admin`, `beat_snapshot`, `warm_pre_edit_cache`, `fix_antipattern`. Full reference in `doc/HME.md`.

## File Locations

```
tools/HME/chat/              Chat extension (this project)
tools/HME/mcp/hme_http.py    HTTP shim server
tools/HME/hooks/log-tool-call.sh  PostToolUse transcript hook
.claude/settings.json         Hook registrations (project-level)
log/session-transcript.jsonl  Transcript log
doc/HME.md                   Full HME reference
CLAUDE.md                    Project rules and constraints
```
