"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChatPanel = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const router_1 = require("./router");
const SessionStore_1 = require("./SessionStore");
const TranscriptLogger_1 = require("./TranscriptLogger");
const Arbiter_1 = require("./Arbiter");
class ChatPanel {
    constructor(panel, projectRoot, restoreSessionId) {
        this._state = { messages: [], claudeSessionId: null, ollamaHistory: [], lastRoute: null, sessionEntry: null };
        this._isStreaming = false;
        this._messageQueue = [];
        this._disposables = [];
        this._restoreSessionId = null;
        this._disposed = false;
        this._shimProc = null;
        this._shimFailed = false;
        this._shimPollTimer = null;
        this._panel = panel;
        this._projectRoot = projectRoot;
        this._restoreSessionId = restoreSessionId ?? null;
        // Wrap all init that touches disk or native modules in try/catch
        // so a failure here never prevents the panel from opening
        try {
            this._transcript = new TranscriptLogger_1.TranscriptLogger(projectRoot);
            this._transcript.setNarrativeCallback(async (entries) => {
                try {
                    const narrative = await (0, Arbiter_1.synthesizeNarrative)(entries);
                    if (narrative) {
                        (0, router_1.postNarrative)(narrative).catch((e) => this._postError("narrative", String(e)));
                    }
                    return narrative;
                }
                catch (e) {
                    // Narrative synthesis is background enrichment — timeout on CPU is expected.
                    // Log to console only; never surface as a user-visible error or lifesaver trigger.
                    console.error(`[HME] narrative-synthesis skipped: ${e?.message ?? e}`);
                    return "";
                }
            });
        }
        catch (e) {
            // TranscriptLogger failed — use a no-op stub
            this._transcript = {
                logUser: () => { }, logAssistant: () => { }, logToolCall: () => { },
                logRouteSwitch: () => { }, logValidation: () => { }, logAudit: () => { },
                logSessionStart: () => { }, getRecentContext: () => "", getWindow: () => [],
                getAll: () => [], count: 0, setNarrativeCallback: () => { }, rotate: () => { },
                forceNarrative: () => Promise.resolve(),
            };
        }
        this._panel.webview.html = this._getHtml();
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._panel.webview.onDidReceiveMessage((msg) => this._handleMessage(msg), null, this._disposables);
        // Without retainContextWhenHidden, VS Code destroys webview content when the
        // panel is hidden and recreates it when shown. Re-send HTML + messages on show.
        this._panel.onDidChangeViewState(() => {
            if (this._panel.visible) {
                this._panel.webview.html = this._getHtml();
                for (const m of this._displayMessages()) {
                    this._post({ type: "message", message: m });
                }
                // If a stream is active, tell the webview so it shows Stop/Queue
                if (this._isStreaming) {
                    this._post({ type: "streamingRestored" });
                }
            }
        }, null, this._disposables);
    }
    static createOrShow(projectRoot) {
        const col = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;
        if (ChatPanel.current) {
            ChatPanel.current._panel.reveal(col);
            return;
        }
        const panel = vscode.window.createWebviewPanel("hmeChat", "HME Chat", col || vscode.ViewColumn.One, { enableScripts: true });
        // Start fresh — old sessions accessible from sidebar. Deserialize path handles reload restore.
        ChatPanel.current = new ChatPanel(panel, projectRoot);
    }
    static deserialize(panel, state, projectRoot) {
        const restoreSessionId = state?.activeSessionId;
        ChatPanel.current = new ChatPanel(panel, projectRoot, restoreSessionId);
    }
    _handleMessage(msg) {
        switch (msg.type) {
            case "send":
                // Hard interrupt: cancel current stream + clear queue, start new message immediately.
                // This is what Enter key and Send button do — new thought always takes priority.
                if (this._isStreaming) {
                    this._cancelCurrent?.();
                    this._cancelCurrent = undefined;
                    this._messageQueue = [];
                    this._post({ type: "cancelConfirmed" });
                    this._isStreaming = false;
                }
                this._isStreaming = true;
                this._onSend(msg).catch((e) => {
                    this._postError("send", String(e));
                    this._drainQueue();
                });
                break;
            case "queue":
                // Queue: waits behind current stream (explicit "send after current finishes").
                // Only Queue button uses this — gives user control when they want sequential order.
                if (this._isStreaming) {
                    const queuedUserMsg = {
                        id: uid(), role: "user", text: msg.text, route: msg.route, ts: Date.now(),
                    };
                    this._post({ type: "message", message: queuedUserMsg });
                    this._messageQueue.push({ ...msg, _queuedUserMsg: queuedUserMsg });
                }
                else {
                    this._isStreaming = true;
                    this._onSend(msg).catch((e) => {
                        this._postError("send", String(e));
                        this._drainQueue();
                    });
                }
                break;
            case "cancel":
                this._cancelCurrent?.();
                this._cancelCurrent = undefined;
                this._messageQueue = [];
                this._post({ type: "cancelConfirmed" });
                this._isStreaming = false;
                break;
            case "clearHistory":
                this._state = { messages: [], claudeSessionId: null, ollamaHistory: [], lastRoute: null, sessionEntry: null };
                this._post({ type: "historyCleared" });
                break;
            case "checkHmeShim":
                (0, router_1.isHmeShimReady)().then(({ ready, errors }) => {
                    this._post({ type: "hmeShimStatus", ready, failed: !ready && this._shimFailed });
                    if (!ready) {
                        this._startHmeShim();
                    }
                    if (errors.length > 0) {
                        const summary = errors.slice(-3).map((e) => `[${e.ts_str ?? "?"}] [${e.source}] ${e.message}`).join("\n");
                        this._post({ type: "notice", level: "warn", text: `⚠ HME errors (check log/hme-errors.log):\n${summary}` });
                    }
                });
                break;
            case "listSessions":
                this._post({ type: "sessionList", sessions: (0, SessionStore_1.listSessions)(this._projectRoot) });
                // On first listSessions after deserialize, auto-load the previously active session
                if (this._restoreSessionId) {
                    const id = this._restoreSessionId;
                    this._restoreSessionId = null;
                    this._loadSession(id);
                }
                break;
            case "loadSession":
                this._loadSession(msg.id);
                break;
            case "deleteSession":
                (0, SessionStore_1.deleteSession)(this._projectRoot, msg.id);
                if (this._state.sessionEntry?.id === msg.id) {
                    this._state = { messages: [], claudeSessionId: null, ollamaHistory: [], lastRoute: null, sessionEntry: null };
                    this._transcript.setSessionId("");
                    this._post({ type: "historyCleared" });
                }
                this._post({ type: "sessionList", sessions: (0, SessionStore_1.listSessions)(this._projectRoot) });
                break;
            case "renameSession":
                (0, SessionStore_1.renameSession)(this._projectRoot, msg.id, msg.title);
                this._post({ type: "sessionList", sessions: (0, SessionStore_1.listSessions)(this._projectRoot) });
                break;
            case "newSession":
                this._state = { messages: [], claudeSessionId: null, ollamaHistory: [], lastRoute: null, sessionEntry: null };
                this._post({ type: "historyCleared" });
                break;
        }
    }
    /** Return the most recent messages up to the display cap. */
    _displayMessages() {
        return this._state.messages.slice(-ChatPanel.DISPLAY_CAP);
    }
    _loadSession(id) {
        const persisted = (0, SessionStore_1.loadSession)(this._projectRoot, id);
        if (!persisted)
            return;
        this._state = {
            messages: persisted.messages,
            claudeSessionId: persisted.entry.claudeSessionId,
            ollamaHistory: persisted.ollamaHistory,
            lastRoute: null,
            sessionEntry: persisted.entry,
        };
        this._transcript.setSessionId(persisted.entry.id);
        this._transcript.logSessionStart(persisted.entry.id, persisted.entry.title, true);
        const display = this._displayMessages();
        const pruned = display.length < persisted.messages.length;
        this._post({ type: "sessionLoaded", id: persisted.entry.id, messages: display, title: persisted.entry.title });
        if (pruned) {
            this._post({ type: "notice", level: "info", text: `Showing last ${display.length} of ${persisted.messages.length} messages` });
        }
    }
    _persistState() {
        if (!this._state.sessionEntry)
            return;
        const entry = {
            ...this._state.sessionEntry,
            claudeSessionId: this._state.claudeSessionId,
            updatedAt: Date.now(),
        };
        this._state.sessionEntry = entry;
        (0, SessionStore_1.saveSession)(this._projectRoot, entry, this._state.messages, this._state.ollamaHistory);
    }
    async _onSend(msg) {
        // ── Agent route: parallel local + hybrid test (no auto-route needed) ──
        if (msg.route === "agent") {
            return this._onSendAgent(msg);
        }
        // ── Route resolution: auto resolves to claude (arbiter classification removed) ──
        let resolvedRoute = (msg.route === "auto" ? "claude" : msg.route);
        // ── Auto-create session on first message ──
        if (!this._state.sessionEntry) {
            let entry;
            try {
                entry = (0, SessionStore_1.createSession)(this._projectRoot, (0, SessionStore_1.deriveTitle)(msg.text));
            }
            catch (e) {
                this._isStreaming = false;
                throw new Error(`Session create failed: ${e?.message ?? e}`);
            }
            this._state.sessionEntry = entry;
            this._transcript.setSessionId(entry.id);
            this._transcript.logSessionStart(entry.id, entry.title, false);
            this._post({ type: "sessionCreated", session: entry });
        }
        // ── Log user message first so transcript order is correct ──
        const model = resolvedRoute === "local" || resolvedRoute === "hybrid" ? msg.ollamaModel : msg.claudeModel;
        this._transcript.logUser(msg.text, resolvedRoute, model);
        // ── Pre-send validation (async, after user is logged) ──
        (0, router_1.validateMessage)(msg.text).then(({ warnings, blocks }) => {
            this._transcript.logValidation(msg.text, warnings.length, blocks.length);
            if (blocks.length > 0) {
                const notice = blocks.map((b) => `⛔ [${b.title}] ${b.content}`).join("\n");
                this._post({ type: "notice", level: "block", text: `HME anti-pattern alert:\n${notice}` });
            }
            else if (warnings.length > 0) {
                const notice = warnings.map((w) => `⚠ [${w.title}]`).join(" · ");
                this._post({ type: "notice", level: "warn", text: `HME constraints: ${notice}` });
            }
        }).catch((e) => this._postError("validation", String(e)));
        // ── Mirror transcript to HTTP shim ──
        (0, router_1.postTranscript)([{
                ts: Date.now(), type: "user", route: resolvedRoute, model,
                content: msg.text, summary: `User [${resolvedRoute}]: ${msg.text.slice(0, 100)}`,
            }]).catch((e) => this._postError("transcript", String(e)));
        const userMsg = msg._queuedUserMsg ?? {
            id: uid(), role: "user", text: msg.text, route: resolvedRoute, ts: Date.now(),
        };
        this._state.messages.push(userMsg);
        if (!msg._queuedUserMsg) {
            this._post({ type: "message", message: userMsg });
        }
        // ── Cross-route history portability ──
        let contextPrefix = "";
        if (this._state.lastRoute && this._state.lastRoute !== resolvedRoute) {
            this._transcript.logRouteSwitch(this._state.lastRoute, resolvedRoute);
            if (resolvedRoute === "local" || resolvedRoute === "hybrid") {
                this._state.ollamaHistory = this._state.messages
                    .filter((m) => m.role === "user" || m.role === "assistant")
                    .map((m) => ({ role: m.role, content: m.text || "" }));
                this._state.ollamaHistory.pop();
            }
            if (resolvedRoute === "claude" && this._state.lastRoute !== "claude") {
                this._state.claudeSessionId = null;
                // Inject prior local/hybrid conversation as context block so Claude has continuity
                const prior = this._state.messages
                    .filter((m) => m.role === "user" || m.role === "assistant")
                    .slice(0, -1) // exclude the current user message just pushed
                    .slice(-12); // cap at 12 messages to avoid huge context
                if (prior.length > 0) {
                    const lines = prior.map((m) => `${m.role === "user" ? "Human" : "Assistant"}: ${(m.text || "").slice(0, 600)}`).join("\n");
                    contextPrefix = `[Prior conversation via local model — use for context only]\n${lines}\n[End of prior context]\n\n`;
                }
            }
        }
        this._state.lastRoute = resolvedRoute;
        const assistantId = uid();
        this._post({
            type: "streamStart",
            id: assistantId,
            route: resolvedRoute,
            model,
        });
        // Stamp resolved route so stream functions log correctly (not "auto")
        const resolvedMsg = { ...msg, _resolvedRoute: resolvedRoute, _contextPrefix: contextPrefix };
        if (resolvedRoute === "local") {
            this._streamOllama(resolvedMsg, assistantId);
        }
        else if (resolvedRoute === "hybrid") {
            this._streamHybrid(resolvedMsg, assistantId);
        }
        else {
            this._streamClaude(resolvedMsg, assistantId);
        }
    }
    /**
     * Agent route: fires local AND hybrid in parallel so I can compare both without
     * making the user manually switch routes. Neither response writes to ollamaHistory
     * to avoid double-appending; local result wins for history after both complete.
     */
    async _onSendAgent(msg) {
        if (!this._state.sessionEntry) {
            const entry = (0, SessionStore_1.createSession)(this._projectRoot, (0, SessionStore_1.deriveTitle)(msg.text));
            this._state.sessionEntry = entry;
            this._transcript.setSessionId(entry.id);
            this._transcript.logSessionStart(entry.id, entry.title, false);
            this._post({ type: "sessionCreated", session: entry });
        }
        this._transcript.logUser(msg.text, "agent", msg.ollamaModel);
        (0, router_1.postTranscript)([{
                ts: Date.now(), type: "user", route: "agent", model: msg.ollamaModel,
                content: msg.text, summary: `User [agent]: ${msg.text.slice(0, 100)}`,
            }]).catch((e) => this._postError("transcript", String(e)));
        const userMsg = { id: uid(), role: "user", text: msg.text, route: "local", ts: Date.now() };
        this._state.messages.push(userMsg);
        this._post({ type: "message", message: userMsg });
        this._post({ type: "notice", level: "info", text: "🤖 Agent mode: running local + hybrid in parallel…" });
        const localId = uid();
        const hybridId = uid();
        this._post({ type: "streamStart", id: localId, route: "local", model: `[local] ${msg.ollamaModel}` });
        this._post({ type: "streamStart", id: hybridId, route: "hybrid", model: `[hybrid] ${msg.ollamaModel}` });
        let doneCount = 0;
        let drained = false;
        const cancelFns = [];
        const safeDrain = () => { if (!drained) {
            drained = true;
            this._drainQueue();
        } };
        const checkBothDone = () => {
            doneCount++;
            if (doneCount >= 2) {
                this._persistState();
                safeDrain();
            }
        };
        this._cancelCurrent = () => cancelFns.forEach((fn) => fn());
        // FAILFAST: on error, surface immediately but let surviving sibling continue.
        // checkBothDone increments the counter — when both streams complete (success or error),
        // the queue drains. Never kill a working response because its sibling failed.
        this._streamAgent(msg, localId, "local", checkBothDone, checkBothDone, cancelFns);
        this._streamAgentHybrid(msg, hybridId, "hybrid", checkBothDone, checkBothDone, cancelFns);
    }
    _streamAgent(msg, assistantId, label, onBothDone, onForceDrain, cancelFns) {
        const systemPrompt = {
            role: "system",
            content: "You are an agentic coding assistant with access to bash, read_file, and write_file tools. When asked to perform a task — create files, edit code, run commands, implement features — call the appropriate tool immediately. Never respond with suggestions, plans, or code blocks without calling a tool first.",
        };
        const requestHistory = [systemPrompt, ...this._state.ollamaHistory, { role: "user", content: msg.text }];
        let text = "";
        let tools = [];
        let streamEnded = false;
        const safeEnd = () => { if (streamEnded)
            return; streamEnded = true; onBothDone(); };
        const onDone = () => {
            if (label === "local") {
                this._state.ollamaHistory.push({ role: "user", content: msg.text });
                this._state.ollamaHistory.push({ role: "assistant", content: text });
            }
            this._state.messages.push({ id: assistantId, role: "assistant", text, tools: tools.length ? tools : undefined, route: label, ts: Date.now() });
            this._post({ type: "streamEnd", id: assistantId });
            this._transcript.logAssistant(text, label, msg.ollamaModel, tools);
            const changedFiles = this._reindexFromTools(tools);
            this._runPostAudit(changedFiles);
            safeEnd();
        };
        const onChunk = (chunk, type) => {
            if (type === "tool") {
                tools.push(chunk);
                this._post({ type: "streamChunk", id: assistantId, chunkType: "tool", chunk });
                this._transcript.logToolCall(chunk.split("]")[0].replace("[", ""), chunk, label);
            }
            else {
                text += chunk;
                this._post({ type: "streamChunk", id: assistantId, chunkType: type, chunk });
            }
        };
        const cancel = (0, router_1.streamOllamaAgentic)(requestHistory, { model: msg.ollamaModel, url: "http://localhost:11434" }, this._projectRoot, onChunk, onDone, (err) => {
            this._postError(label, err);
            if (!streamEnded) {
                streamEnded = true;
                this._post({ type: "streamEnd", id: assistantId });
                onForceDrain();
            }
        });
        cancelFns.push(cancel);
    }
    _streamAgentHybrid(msg, assistantId, label, onBothDone, onForceDrain, cancelFns) {
        const history = [...this._state.ollamaHistory];
        let text = "";
        let tools = [];
        let aborted = false;
        let streamEnded = false;
        const safeEnd = () => { if (streamEnded)
            return; streamEnded = true; onBothDone(); };
        // Register cancel immediately so abort works during HME context fetch
        const cancelWrapper = () => { aborted = true; };
        cancelFns.push(cancelWrapper);
        this._post({ type: "streamChunk", id: assistantId, chunkType: "tool", chunk: "[HME] Enriching with KB context…" });
        (0, router_1.streamHybrid)(msg.text, history, { model: msg.ollamaModel, url: "http://localhost:11434" }, this._projectRoot, (chunk, type) => {
            if (aborted)
                return;
            if (type === "tool") {
                tools.push(chunk);
                this._post({ type: "streamChunk", id: assistantId, chunkType: "tool", chunk });
                this._transcript.logToolCall(chunk.split("]")[0].replace("[", ""), chunk, "hybrid");
            }
            else {
                text += chunk;
                this._post({ type: "streamChunk", id: assistantId, chunkType: type, chunk });
            }
        }, () => {
            if (aborted)
                return;
            this._state.messages.push({ id: assistantId, role: "assistant", text, tools: tools.length ? tools : undefined, route: "hybrid", ts: Date.now() });
            this._post({ type: "streamEnd", id: assistantId });
            this._transcript.logAssistant(text, "hybrid", msg.ollamaModel, tools);
            const changedFiles = this._reindexFromTools(tools);
            this._runPostAudit(changedFiles);
            safeEnd();
        }, (err) => {
            if (aborted)
                return;
            this._postError(label, err);
            if (!streamEnded) {
                streamEnded = true;
                this._post({ type: "streamEnd", id: assistantId });
                onForceDrain(); // counts as done — lets surviving sibling continue
            }
        }).then((cancel) => {
            if (aborted) {
                cancel();
                return;
            }
            cancelFns.push(cancel);
        }).catch((err) => {
            if (aborted)
                return;
            this._postError(label, String(err));
            if (!streamEnded) {
                streamEnded = true;
                this._post({ type: "streamEnd", id: assistantId });
                onForceDrain();
            }
        });
    }
    _streamClaude(msg, assistantId) {
        let text = "";
        let thinking = "";
        let tools = [];
        let streamEnded = false;
        let aborted = false; // gate: prevents buffered PTY/pipe chunks posting after cancel
        const safeEnd = () => {
            if (streamEnded)
                return;
            streamEnded = true;
            this._drainQueue();
        };
        const onDone = () => {
            if (aborted)
                return;
            const assistantMsg = {
                id: assistantId,
                role: "assistant",
                text,
                thinking: thinking || undefined,
                tools: tools.length ? tools : undefined,
                route: msg._resolvedRoute ?? msg.route,
                ts: Date.now(),
            };
            this._state.messages.push(assistantMsg);
            this._persistState();
            this._post({ type: "streamEnd", id: assistantId });
            // Log to transcript + mirror to shim
            this._transcript.logAssistant(text, msg._resolvedRoute ?? msg.route ?? "claude", msg.claudeModel, tools);
            this._mirrorAssistantToShim(text, msg._resolvedRoute ?? msg.route ?? "claude", msg.claudeModel, tools);
            const changedFiles = this._reindexFromTools(tools);
            this._runPostAudit(changedFiles);
            safeEnd();
        };
        const onChunk = (chunk, type) => {
            if (aborted)
                return; // discard buffered chunks after cancel
            if (type === "text") {
                text += chunk;
                this._post({ type: "streamChunk", id: assistantId, chunkType: "text", chunk });
            }
            else if (type === "thinking") {
                thinking += chunk;
                this._post({ type: "streamChunk", id: assistantId, chunkType: "thinking", chunk });
            }
            else if (type === "tool") {
                tools.push(chunk);
                this._post({ type: "streamChunk", id: assistantId, chunkType: "tool", chunk });
                // Log tool call to transcript
                this._transcript.logToolCall(chunk.split("]")[0].replace("[", ""), chunk, msg._resolvedRoute ?? msg.route ?? "claude");
            }
            else if (type === "error") {
                this._postError("claude", chunk);
            }
        };
        const onError = (err) => {
            if (aborted)
                return;
            if (!streamEnded) {
                this._post({ type: "streamEnd", id: assistantId });
                safeEnd();
            }
            this._postError("claude", err);
        };
        // Prepend prior-route context block if switching from local/hybrid → claude
        const effectiveText = (msg._contextPrefix ?? "") + msg.text;
        // Use PTY mode so hooks fire; fall back to -p mode if PTY fails.
        // cancelFn: set aborted=true first so buffered PTY/pipe chunks are dropped immediately.
        let cancelFn;
        this._cancelCurrent = () => { aborted = true; cancelFn?.(); };
        cancelFn = (0, router_1.streamClaudePty)(effectiveText, this._state.claudeSessionId, { model: msg.claudeModel, effort: msg.claudeEffort, thinking: msg.claudeThinking, permissionMode: "bypassPermissions" }, this._projectRoot, onChunk, (sessionId) => { this._state.claudeSessionId = sessionId; }, onDone, (err) => {
            // PTY failed — fall back to stream-json mode silently
            console.log(`[HME Chat] PTY unavailable (${err}), falling back to -p mode`);
            cancelFn = (0, router_1.streamClaude)(effectiveText, this._state.claudeSessionId, { model: msg.claudeModel, effort: msg.claudeEffort, thinking: msg.claudeThinking, permissionMode: "bypassPermissions" }, this._projectRoot, onChunk, (sessionId) => { this._state.claudeSessionId = sessionId; }, (cost) => { onDone(); }, onError);
        });
    }
    /** Mirror assistant response to HTTP shim transcript. */
    _mirrorAssistantToShim(text, route, model, tools) {
        (0, router_1.postTranscript)([{
                ts: Date.now(), type: "assistant", route, model,
                content: text.slice(0, 2000),
                summary: `Assistant [${route}]: ${text.slice(0, 100)}`,
                meta: tools?.length ? { tools } : undefined,
            }]).catch((e) => this._postError("transcript", String(e)));
    }
    /**
     * Detect files modified by tool calls and trigger immediate mini-reindex.
     * Parses tool call strings for file paths — Claude ("file_path") and Ollama ("path") formats.
     * Returns the set of detected file paths for downstream use (audit).
     */
    _reindexFromTools(tools) {
        const files = new Set();
        for (const t of tools) {
            // Claude format: [Edit] or [Write] {"file_path":"src/foo.js"...}
            const fileMatch = t.match(/"file_path"\s*:\s*"([^"]+)"/);
            if (fileMatch)
                files.add(fileMatch[1]);
            // Ollama agentic format: [write_file] {"path":"src/foo.js"...}
            const ollamaMatch = t.match(/\[(write_file|read_file|bash)\]\s*\{[^}]*"path"\s*:\s*"([^"]+)"/);
            if (ollamaMatch)
                files.add(ollamaMatch[2]);
        }
        if (files.size > 0) {
            (0, router_1.reindexFiles)([...files]).catch((e) => this._postError("reindex", String(e)));
        }
        return files;
    }
    _runPostAudit(changedFiles) {
        const filesArg = changedFiles?.size ? [...changedFiles].join(",") : "";
        (0, router_1.auditChanges)(filesArg).then(({ violations, changed_files }) => {
            this._transcript.logAudit(changed_files.length, violations.length);
            if (violations.length > 0) {
                const summary = violations
                    .map((v) => `• [${v.category}] ${v.file}: ${v.title}`)
                    .join("\n");
                this._post({ type: "notice", level: "audit", text: `HME post-audit (${changed_files.length} files changed):\n${summary}` });
            }
        }).catch((e) => this._postError("audit", String(e)));
    }
    _streamOllama(msg, assistantId) {
        const systemPrompt = {
            role: "system",
            content: "You are an agentic coding assistant with access to bash, read_file, and write_file tools. When asked to perform a task — create files, edit code, run commands, implement features — call the appropriate tool immediately. Never respond with suggestions, plans, or code blocks without calling a tool first.",
        };
        const contextMessages = msg._contextPrefix
            ? [{ role: "user", content: msg._contextPrefix }, { role: "assistant", content: "Understood. I have the prior conversation context." }]
            : [];
        const requestHistory = [systemPrompt, ...contextMessages, ...this._state.ollamaHistory, { role: "user", content: msg.text }];
        let text = "";
        let tools = [];
        let streamEnded = false;
        let aborted = false; // gate: drops buffered Ollama chunks after cancel
        const safeEnd = () => {
            if (streamEnded)
                return;
            streamEnded = true;
            this._drainQueue();
        };
        const onDone = () => {
            if (aborted)
                return;
            this._state.ollamaHistory.push({ role: "user", content: msg.text });
            this._state.ollamaHistory.push({ role: "assistant", content: text });
            const assistantMsg = {
                id: assistantId, role: "assistant", text,
                tools: tools.length ? tools : undefined,
                route: "local", ts: Date.now(),
            };
            this._state.messages.push(assistantMsg);
            this._persistState();
            this._post({ type: "streamEnd", id: assistantId });
            this._transcript.logAssistant(text, "local", msg.ollamaModel, tools);
            this._mirrorAssistantToShim(text, "local", msg.ollamaModel, tools);
            const changedFiles = this._reindexFromTools(tools);
            this._runPostAudit(changedFiles);
            safeEnd();
        };
        const onChunk = (chunk, type) => {
            if (aborted)
                return; // discard buffered chunks after cancel
            if (type === "tool") {
                tools.push(chunk);
                this._post({ type: "streamChunk", id: assistantId, chunkType: "tool", chunk });
                this._transcript.logToolCall(chunk.split("]")[0].replace("[", ""), chunk, "local");
            }
            else {
                text += chunk;
                this._post({ type: "streamChunk", id: assistantId, chunkType: type, chunk });
            }
        };
        let ollamaCancelFn;
        this._cancelCurrent = () => { aborted = true; ollamaCancelFn?.(); };
        ollamaCancelFn = (0, router_1.streamOllamaAgentic)(requestHistory, { model: msg.ollamaModel, url: "http://localhost:11434" }, this._projectRoot, onChunk, onDone, (err) => {
            if (!streamEnded) {
                this._post({ type: "streamEnd", id: assistantId });
                safeEnd();
            }
            this._postError("local", err);
        });
    }
    _streamHybrid(msg, assistantId) {
        const contextMessages = msg._contextPrefix
            ? [{ role: "user", content: msg._contextPrefix }, { role: "assistant", content: "Understood. I have the prior conversation context." }]
            : [];
        const history = [...contextMessages, ...this._state.ollamaHistory];
        let text = "";
        let tools = [];
        let cancelFn;
        let aborted = false;
        let streamEnded = false;
        const safeEnd = () => {
            if (streamEnded)
                return;
            streamEnded = true;
            this._drainQueue();
        };
        // Cancelable immediately — even during HME context fetch
        this._cancelCurrent = () => { aborted = true; cancelFn?.(); };
        // Post "enriching…" status
        this._post({ type: "streamChunk", id: assistantId, chunkType: "tool", chunk: "[HME] Enriching with KB context…" });
        (0, router_1.streamHybrid)(msg.text, history, { model: msg.ollamaModel, url: "http://localhost:11434" }, this._projectRoot, (chunk, type) => {
            if (aborted)
                return;
            if (type === "tool") {
                tools.push(chunk);
                this._post({ type: "streamChunk", id: assistantId, chunkType: "tool", chunk });
                this._transcript.logToolCall(chunk.split("]")[0].replace("[", ""), chunk, "hybrid");
            }
            else {
                text += chunk;
                this._post({ type: "streamChunk", id: assistantId, chunkType: type, chunk });
            }
        }, () => {
            if (aborted)
                return;
            this._state.ollamaHistory.push({ role: "user", content: msg.text });
            this._state.ollamaHistory.push({ role: "assistant", content: text });
            const assistantMsg = {
                id: assistantId, role: "assistant", text,
                tools: tools.length ? tools : undefined,
                route: "hybrid", ts: Date.now(),
            };
            this._state.messages.push(assistantMsg);
            this._persistState();
            this._post({ type: "streamEnd", id: assistantId });
            this._transcript.logAssistant(text, "hybrid", msg.ollamaModel, tools);
            this._mirrorAssistantToShim(text, "hybrid", msg.ollamaModel, tools);
            const changedFiles = this._reindexFromTools(tools);
            this._runPostAudit(changedFiles);
            safeEnd();
        }, (err) => {
            if (aborted)
                return;
            if (!streamEnded) {
                this._post({ type: "streamEnd", id: assistantId });
                safeEnd();
            }
            this._postError("hybrid", err);
        }).then((cancel) => {
            if (aborted) {
                cancel();
                return;
            }
            cancelFn = cancel;
        }).catch((err) => {
            if (aborted)
                return;
            if (!streamEnded) {
                this._post({ type: "streamEnd", id: assistantId });
                safeEnd();
            }
            this._postError("hybrid", String(err));
        });
    }
    /** Fail-fast error surface: bubble in chat + log file + KB antipattern lookup. */
    _postError(source, message) {
        const isCritical = message.includes("CRITICAL") || message.includes("timeout") || message.includes("refused");
        // Errors surface in the webview bubble — never as VS Code popups (those interrupt the user).
        this._post({ type: isCritical ? "criticalError" : "errorBubble", source, message });
        // Shim is the single writer to hme-errors.log — avoids duplicate entries.
        // Fall back to direct disk write only if shim is unreachable.
        (0, router_1.logShimError)(source, message).catch((e) => {
            console.error(`[HME FAILFAST] logShimError failed for [${source}] ${message}: ${e?.message ?? e}`);
            const errLine = `[${new Date().toISOString()}] [${source}] ${message}\n`;
            try {
                fs.mkdirSync(path.join(this._projectRoot, "log"), { recursive: true });
                fs.appendFileSync(path.join(this._projectRoot, "log", "hme-errors.log"), errLine);
            }
            catch (fileErr) {
                console.error(`[HME FAILFAST] Disk fallback also failed for [${source}] ${message}: ${fileErr?.message ?? fileErr}`);
            }
        });
        // Query KB for antipatterns — console.error on failure (no recursion)
        (0, router_1.validateMessage)(`${source} error: ${message}`).then(({ warnings, blocks }) => {
            const relevant = [...blocks, ...warnings];
            if (relevant.length > 0) {
                const lines = relevant.map((r) => `• [${r.title}] ${r.content ?? r.title}`).join("\n");
                this._post({ type: "notice", level: blocks.length > 0 ? "block" : "warn", text: `HME antipatterns for this error:\n${lines}` });
            }
        }).catch((e) => {
            console.error(`[HME FAILFAST] KB antipattern lookup failed for [${source}] ${message}: ${e?.message ?? e}`);
        });
    }
    _startHmeShim() {
        if (this._shimProc && !this._shimProc.killed)
            return; // already running
        this._shimFailed = false;
        const shimPath = path.join(__dirname, "..", "..", "mcp", "hme_http.py");
        const env = { ...process.env };
        if (!env["PATH"]?.includes(".local/bin")) {
            env["PATH"] = `/home/${process.env["USER"] ?? "jah"}/.local/bin:${env["PATH"] ?? "/usr/local/bin:/usr/bin:/bin"}`;
        }
        try {
            this._shimProc = require("child_process").spawn("python3", [shimPath], {
                cwd: this._projectRoot,
                env,
                detached: false,
                stdio: "ignore",
            });
            let started = false;
            this._shimProc.on("error", (e) => {
                this._shimProc = null;
                this._post({ type: "hmeShimStatus", ready: false });
                this._postError("shim", `HME shim failed to start: ${e.message}`);
            });
            this._shimProc.on("exit", (code) => {
                const wasStarted = started;
                this._shimProc = null;
                this._post({ type: "hmeShimStatus", ready: false });
                if (!wasStarted) {
                    this._postError("shim", `HME shim exited before becoming ready (code ${code ?? "?"})`);
                }
                else if (!this._disposed) {
                    // Shim died after a successful start — restart it after a brief delay to release port
                    setTimeout(() => { if (!this._disposed)
                        this._startHmeShim(); }, 3000);
                }
            });
            // Poll readiness — retry up to 5 times every 2s. One poll loop at a time.
            let attempts = 0;
            const poll = () => {
                attempts++;
                (0, router_1.isHmeShimReady)().then(({ ready }) => {
                    if (ready) {
                        started = true;
                        this._shimPollTimer = null;
                        this._post({ type: "hmeShimStatus", ready: true });
                        return;
                    }
                    if (attempts < 5 && this._shimProc) {
                        this._post({ type: "hmeShimStatus", ready: false, failed: false });
                        this._shimPollTimer = setTimeout(poll, 2000);
                    }
                    else {
                        this._shimPollTimer = null;
                        this._shimFailed = true;
                        this._post({ type: "hmeShimStatus", ready: false, failed: true });
                        this._postError("shim", `HME shim started but /health not ready after ${attempts * 2}s — check log/hme-errors.log or run mcp/hme_http.py manually`);
                    }
                });
            };
            if (this._shimPollTimer) {
                clearTimeout(this._shimPollTimer);
            }
            this._shimPollTimer = setTimeout(poll, 2000);
        }
        catch (e) {
            this._postError("shim", `HME shim spawn error: ${e?.message ?? e}`);
        }
    }
    _drainQueue() {
        this._isStreaming = false;
        if (this._messageQueue.length > 0) {
            const next = this._messageQueue.shift();
            this._isStreaming = true;
            this._onSend(next).catch((e) => {
                this._post({ type: "streamChunk", id: "err", chunkType: "error", chunk: String(e) });
                this._post({ type: "streamEnd", id: "err" });
                this._drainQueue();
            });
        }
    }
    _post(data) {
        this._panel.webview.postMessage(data);
    }
    _getHtml() {
        const htmlPath = path.join(__dirname, "..", "webview", "index.html");
        return fs.readFileSync(htmlPath, "utf8");
    }
    async dispose() {
        if (this._disposed)
            return;
        this._disposed = true;
        this._cancelCurrent?.();
        this._cancelCurrent = undefined;
        this._messageQueue = [];
        this._isStreaming = false;
        ChatPanel.current = undefined;
        if (this._shimPollTimer) {
            clearTimeout(this._shimPollTimer);
            this._shimPollTimer = null;
        }
        // Persist in-flight state synchronously before anything async (writeFileSync — always completes)
        try {
            this._persistState();
        }
        catch (e) { }
        // Graceful async cleanup: await narrative synthesis with 5s cap, then kill shim
        const narrativeWork = Promise.resolve(this._transcript.forceNarrative?.());
        const timeout = new Promise((resolve) => setTimeout(resolve, 5000));
        await Promise.race([narrativeWork, timeout]);
        try {
            this._shimProc?.kill();
        }
        catch (e) {
            console.error(`[HME] shimProc kill failed: ${e?.message ?? e}`);
        }
        this._panel.dispose();
        this._disposables.forEach((d) => d.dispose());
        this._disposables = [];
    }
}
exports.ChatPanel = ChatPanel;
/** Max messages sent to webview for display. Full history stays in _state.messages and transcript logs. */
ChatPanel.DISPLAY_CAP = 100;
function uid() {
    return Math.random().toString(36).slice(2, 10);
}
