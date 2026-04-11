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
const streamUtils_1 = require("./streamUtils");
const chatChain_1 = require("./chatChain");
const chatStreaming_1 = require("./chatStreaming");
const MODEL_CONTEXT_WINDOWS = {
    "claude-opus-4-6": 1000000,
    "claude-sonnet-4-6": 500000,
};
const DEFAULT_CONTEXT_WINDOW = 500000;
const CHAIN_THRESHOLD_PCT = 75;
const SYSTEM_OVERHEAD_TOKENS = 8000;
class ChatPanel {
    constructor(panel, projectRoot, restoreSessionId) {
        this._state = { messages: [], claudeSessionId: null, ollamaHistory: [], lastRoute: null, sessionEntry: null, chainIndex: 0 };
        this._isStreaming = false;
        this._messageQueue = [];
        this._disposables = [];
        this._restoreSessionId = null;
        this._disposed = false;
        this._contextTracker = { lastInputTokens: null, lastOutputTokens: null, totalChars: 0, model: "" };
        this._chainingInProgress = false;
        // ── HME shim process management ────────────────────────────────────────────
        this._shimProc = null;
        this._shimFailed = false;
        this._shimPollTimer = null;
        this._panel = panel;
        this._projectRoot = projectRoot;
        this._restoreSessionId = restoreSessionId ?? null;
        try {
            this._transcript = new TranscriptLogger_1.TranscriptLogger(projectRoot);
            this._transcript.setNarrativeCallback(async (entries) => {
                try {
                    const narrative = await (0, Arbiter_1.synthesizeNarrative)(entries);
                    if (narrative) {
                        (0, router_1.postTranscript)([{ ts: Date.now(), type: "narrative", content: narrative }])
                            .catch((e) => this._postError("narrative", String(e)));
                    }
                    return narrative;
                }
                catch (e) {
                    console.error(`[HME] narrative-synthesis skipped: ${e?.message ?? e}`);
                    return "";
                }
            });
        }
        catch (e) {
            console.error(`[HME] TranscriptLogger init failed — transcript disabled: ${e?.message ?? e}`);
            this._transcript = (0, TranscriptLogger_1.nullTranscript)();
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
                if (this._isStreaming) {
                    this._post({ type: "streamingRestored" });
                }
                this._postContextUpdate();
            }
        }, null, this._disposables);
    }
    static setGlobalState(state) {
        ChatPanel._globalState = state;
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
        ChatPanel.current = new ChatPanel(panel, projectRoot);
    }
    static deserialize(panel, state, projectRoot) {
        const restoreSessionId = state?.activeSessionId;
        ChatPanel.current = new ChatPanel(panel, projectRoot, restoreSessionId);
    }
    _handleMessage(msg) {
        switch (msg.type) {
            // ── Stream control ───────────────────────────────────────────────────
            case "send":
                // Hard interrupt: cancel current stream + clear queue, start new message immediately.
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
                if (this._isStreaming) {
                    const queuedUserMsg = {
                        id: (0, streamUtils_1.uid)(), role: "user", text: msg.text, route: msg.route, ts: Date.now(),
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
            // ── Session management ───────────────────────────────────────────────
            case "clearHistory":
                this._state = { messages: [], claudeSessionId: null, ollamaHistory: [], lastRoute: null, sessionEntry: null, chainIndex: 0 };
                this._resetContextTracker();
                this._post({ type: "historyCleared" });
                break;
            // ── HME features ─────────────────────────────────────────────────────
            case "enrichPrompt":
                this._post({ type: "enrichStatus", status: "enriching" });
                (0, router_1.enrichPrompt)(msg.prompt, msg.frame ?? "").then((result) => {
                    this._post({ type: "enrichResult", ...result });
                }).catch((e) => {
                    this._post({ type: "enrichResult", enriched: msg.prompt, original: msg.prompt,
                        error: String(e), unchanged: true });
                });
                break;
            case "checkHmeShim":
                (0, router_1.isHmeShimReady)().then(({ ready }) => {
                    this._post({ type: "hmeShimStatus", ready, failed: !ready && this._shimFailed });
                    if (!ready)
                        this._startHmeShim();
                });
                break;
            // ── Session management ───────────────────────────────────────────────
            case "listSessions":
                this._post({ type: "sessionList", sessions: (0, SessionStore_1.listSessions)(this._projectRoot) });
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
                    this._state = { messages: [], claudeSessionId: null, ollamaHistory: [], lastRoute: null, sessionEntry: null, chainIndex: 0 };
                    this._resetContextTracker();
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
                this._state = { messages: [], claudeSessionId: null, ollamaHistory: [], lastRoute: null, sessionEntry: null, chainIndex: 0 };
                this._resetContextTracker();
                this._post({ type: "historyCleared" });
                break;
            // ── UI state ─────────────────────────────────────────────────────────
            case "setZoomLevel":
                if (typeof msg.level === "number") {
                    ChatPanel._globalState?.update("hme.zoomLevel", msg.level);
                }
                break;
        }
    }
    _displayMessages() {
        return this._state.messages.slice(-ChatPanel.DISPLAY_CAP);
    }
    /**
     * Track a streaming assistant message so partial text survives ext host crashes.
     * Pushes a placeholder into _state.messages immediately and persists every 10s.
     */
    _trackStream(assistantId, route) {
        const partial = { id: assistantId, role: "assistant", text: "", route, ts: Date.now() };
        this._state.messages.push(partial);
        this._persistState();
        const idx = this._state.messages.length - 1;
        let dirty = false;
        const timer = setInterval(() => {
            if (dirty) {
                dirty = false;
                this._persistState();
            }
        }, ChatPanel.STREAM_PERSIST_MS);
        return {
            update: (text, tools, thinking) => {
                partial.text = text;
                if (tools?.length)
                    partial.tools = tools;
                if (thinking)
                    partial.thinking = thinking;
                dirty = true;
            },
            finalize: (final) => {
                clearInterval(timer);
                this._state.messages[idx] = final;
                this._persistState();
            },
        };
    }
    _makeCtx() {
        const self = this;
        return {
            get projectRoot() { return self._projectRoot; },
            get transcript() { return self._transcript; },
            get state() { return self._state; },
            post: (data) => self._post(data),
            postError: (s, m) => self._postError(s, m),
            drainQueue: () => self._drainQueue(),
            trackStream: (id, r) => self._trackStream(id, r),
            updateContextTracker: (t, th, m, u) => self._updateContextTracker(t, th, m, u),
            checkChainThreshold: (msg) => self._checkChainThreshold(msg),
            setCancelCurrent: (fn) => { self._cancelCurrent = fn; },
        };
    }
    _loadSession(id) {
        const persisted = (0, SessionStore_1.loadSession)(this._projectRoot, id);
        if (!persisted)
            return;
        const chainLinks = (0, SessionStore_1.listChainLinks)(this._projectRoot, id);
        const chainIndex = chainLinks.length > 0 ? Math.max(...chainLinks) + 1 : (persisted.chainIndex ?? 0);
        this._state = {
            messages: persisted.messages,
            claudeSessionId: persisted.entry.claudeSessionId,
            ollamaHistory: persisted.ollamaHistory,
            lastRoute: null,
            sessionEntry: persisted.entry,
            chainIndex,
        };
        this._resetContextTracker(persisted.contextTokens);
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
        (0, SessionStore_1.saveSession)(this._projectRoot, entry, this._state.messages, this._state.ollamaHistory, {
            contextTokens: Math.round(this._contextTracker.totalChars / streamUtils_1.CHARS_PER_TOKEN),
            chainIndex: this._state.chainIndex,
        });
    }
    async _onSend(msg) {
        if (msg.route === "agent") {
            return this._onSendAgent(msg);
        }
        const resolvedRoute = (msg.route === "auto" ? "claude" : msg.route);
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
        const model = resolvedRoute === "local" || resolvedRoute === "hybrid" ? msg.ollamaModel : msg.claudeModel;
        this._transcript.logUser(msg.text, resolvedRoute, model);
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
        (0, router_1.postTranscript)([{
                ts: Date.now(), type: "user", route: resolvedRoute, model,
                content: msg.text, summary: `User [${resolvedRoute}]: ${msg.text.slice(0, 100)}`,
            }]).catch((e) => this._postError("transcript", String(e)));
        const userMsg = msg._queuedUserMsg ?? {
            id: (0, streamUtils_1.uid)(), role: "user", text: msg.text, route: resolvedRoute, ts: Date.now(),
        };
        this._state.messages.push(userMsg);
        this._persistState();
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
                const prior = this._state.messages
                    .filter((m) => m.role === "user" || m.role === "assistant")
                    .slice(0, -1).slice(-12);
                if (prior.length > 0) {
                    const lines = prior.map((m) => `${m.role === "user" ? "Human" : "Assistant"}: ${(m.text || "").slice(0, 600)}`).join("\n");
                    contextPrefix = `[Prior conversation via local model — use for context only]\n${lines}\n[End of prior context]\n\n`;
                }
            }
        }
        this._state.lastRoute = resolvedRoute;
        const assistantId = (0, streamUtils_1.uid)();
        this._post({ type: "streamStart", id: assistantId, route: resolvedRoute, model });
        const resolvedMsg = { ...msg, _resolvedRoute: resolvedRoute, _contextPrefix: contextPrefix };
        const ctx = this._makeCtx();
        if (resolvedRoute === "local") {
            (0, chatStreaming_1.streamOllamaMsg)(ctx, resolvedMsg, assistantId);
        }
        else if (resolvedRoute === "hybrid") {
            (0, chatStreaming_1.streamHybridMsg)(ctx, resolvedMsg, assistantId);
        }
        else {
            (0, chatStreaming_1.streamClaudeMsg)(ctx, resolvedMsg, assistantId);
        }
    }
    /**
     * Agent route: fires local AND hybrid in parallel for side-by-side comparison.
     * Neither response writes to ollamaHistory to avoid double-appending;
     * local result wins for history after both complete.
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
        const userMsg = { id: (0, streamUtils_1.uid)(), role: "user", text: msg.text, route: "local", ts: Date.now() };
        this._state.messages.push(userMsg);
        this._persistState();
        this._post({ type: "message", message: userMsg });
        this._post({ type: "notice", level: "info", text: "🤖 Agent mode: running local + hybrid in parallel…" });
        const localId = (0, streamUtils_1.uid)();
        const hybridId = (0, streamUtils_1.uid)();
        this._post({ type: "streamStart", id: localId, route: "local", model: `[local] ${msg.ollamaModel}` });
        this._post({ type: "streamStart", id: hybridId, route: "hybrid", model: `[hybrid] ${msg.ollamaModel}` });
        let doneCount = 0;
        let drained = false;
        const cancelFns = [];
        const safeDrain = () => { if (!drained) {
            drained = true;
            this._drainQueue();
        } };
        const checkBothDone = () => { if (++doneCount >= 2) {
            this._persistState();
            safeDrain();
        } };
        this._cancelCurrent = () => cancelFns.forEach((fn) => fn());
        const ctx = this._makeCtx();
        (0, chatStreaming_1.streamAgentMsg)(ctx, msg, localId, "local", checkBothDone, checkBothDone, cancelFns);
        (0, chatStreaming_1.streamAgentHybridMsg)(ctx, msg, hybridId, "hybrid", checkBothDone, checkBothDone, cancelFns);
    }
    // ── Context tracking & chain ───────────────────────────────────────────────
    _resetContextTracker(restoredTokens) {
        this._contextTracker = { lastInputTokens: null, lastOutputTokens: null, totalChars: 0, model: "" };
        if (restoredTokens) {
            this._contextTracker.totalChars = restoredTokens * streamUtils_1.CHARS_PER_TOKEN;
        }
        this._postContextUpdate();
    }
    _updateContextTracker(text, thinking, model, usage) {
        this._contextTracker.model = model;
        this._contextTracker.totalChars += text.length + (thinking?.length ?? 0);
        if (usage) {
            this._contextTracker.lastInputTokens = usage.inputTokens;
            this._contextTracker.lastOutputTokens = usage.outputTokens;
        }
        this._postContextUpdate();
    }
    _getContextPct() {
        const window = MODEL_CONTEXT_WINDOWS[this._contextTracker.model] ?? DEFAULT_CONTEXT_WINDOW;
        if (this._contextTracker.lastInputTokens != null && this._contextTracker.lastOutputTokens != null) {
            const used = this._contextTracker.lastInputTokens + this._contextTracker.lastOutputTokens;
            return Math.min(99, Math.round(used / window * 100));
        }
        // PTY mode: no token counts — estimate from all message chars
        const allChars = this._state.messages.reduce((sum, m) => sum + (m.text?.length ?? 0) + (m.thinking?.length ?? 0), 0);
        const estimatedTokens = allChars / streamUtils_1.CHARS_PER_TOKEN + SYSTEM_OVERHEAD_TOKENS;
        return Math.min(99, Math.round(estimatedTokens / window * 100));
    }
    _postContextUpdate() {
        const pct = this._getContextPct();
        const chainLinks = this._state.sessionEntry
            ? (0, SessionStore_1.listChainLinks)(this._projectRoot, this._state.sessionEntry.id).length
            : 0;
        this._post({ type: "contextUpdate", pct, chainLinks, chainIndex: this._state.chainIndex });
    }
    _checkChainThreshold(msg) {
        const pct = this._getContextPct();
        if (pct < CHAIN_THRESHOLD_PCT || this._chainingInProgress)
            return;
        this._performChain(msg).catch((e) => {
            console.error(`[HME Chat] Chain failed: ${e}`);
            this._postError("chain", String(e));
            this._chainingInProgress = false;
        });
    }
    async _performChain(msg) {
        if (!this._state.sessionEntry || this._chainingInProgress)
            return;
        this._chainingInProgress = true;
        const sessionId = this._state.sessionEntry.id;
        const linkIndex = this._state.chainIndex;
        this._post({ type: "notice", level: "info", text: `Context chain: saving link ${linkIndex + 1} and generating summary...` });
        let todos = [];
        try {
            const todoPath = path.join(process.env["HOME"] ?? process.env["USERPROFILE"] ?? "~", ".claude", "mcp", "HME", "todos.json");
            todos = JSON.parse(fs.readFileSync(todoPath, "utf8"));
        }
        catch (e) {
            if (e?.code !== "ENOENT")
                console.error(`[HME] Failed to load todos.json: ${e?.message ?? e}`);
        }
        const priorSummaries = (0, SessionStore_1.loadChainSummaries)(this._projectRoot, sessionId);
        const recentMessages = this._state.messages.slice(-20);
        const summaryPrompt = (0, chatChain_1.buildSummaryPrompt)(recentMessages, todos, priorSummaries);
        let summary = "";
        try {
            summary = await (0, Arbiter_1.synthesizeChainSummary)(summaryPrompt);
        }
        catch (e) {
            console.error(`[HME Chat] Chain summary via local model failed: ${e}`);
            summary = (0, chatChain_1.buildFallbackSummary)(recentMessages, todos, priorSummaries);
        }
        const link = {
            index: linkIndex,
            sessionId,
            messages: [...this._state.messages],
            summary,
            todos,
            contextTokens: this._getContextPct(),
            claudeSessionId: this._state.claudeSessionId,
            createdAt: Date.now(),
        };
        (0, SessionStore_1.saveChainLink)(this._projectRoot, link);
        this._state.messages = [];
        this._state.claudeSessionId = null;
        this._state.chainIndex = linkIndex + 1;
        this._resetContextTracker();
        const contextMsg = {
            id: (0, streamUtils_1.uid)(),
            role: "user",
            text: `[Context Chain — Link ${linkIndex + 1} continuation]\n\n${summary}`,
            route: "claude",
            ts: Date.now(),
        };
        this._state.messages.push(contextMsg);
        this._persistState();
        this._post({ type: "chainCompleted", linkIndex, chainIndex: this._state.chainIndex });
        this._post({ type: "notice", level: "info", text: `Context chain: link ${linkIndex + 1} saved. Fresh context resumed.` });
        this._postContextUpdate();
        this._chainingInProgress = false;
    }
    // ── Error handling ─────────────────────────────────────────────────────────
    _postError(source, message) {
        // Errors route to hme-errors.log only — Lifesaver reads it for Claude's awareness.
        // No UI notices: the user reads logs when they want to; this channel is not for them.
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
    }
    _startHmeShim() {
        if (this._shimProc && !this._shimProc.killed)
            return;
        this._shimFailed = false;
        const shimPath = path.join(__dirname, "..", "..", "mcp", "hme_http.py");
        const env = { ...process.env };
        if (!env["PATH"]?.includes(".local/bin")) {
            env["PATH"] = `/home/${process.env["USER"] ?? "jah"}/.local/bin:${env["PATH"] ?? "/usr/local/bin:/usr/bin:/bin"}`;
        }
        try {
            this._shimProc = require("child_process").spawn("python3", [shimPath], {
                cwd: this._projectRoot, env, detached: false, stdio: "ignore",
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
                    setTimeout(() => { if (!this._disposed)
                        this._startHmeShim(); }, 3000);
                }
            });
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
            if (this._shimPollTimer)
                clearTimeout(this._shimPollTimer);
            this._shimPollTimer = setTimeout(poll, 2000);
        }
        catch (e) {
            this._postError("shim", `HME shim spawn error: ${e?.message ?? e}`);
        }
    }
    // ── Message queue & webview plumbing ───────────────────────────────────────
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
        let html = fs.readFileSync(htmlPath, "utf8");
        const storedZoom = ChatPanel._globalState?.get("hme.zoomLevel") ?? 1.0;
        html = html.replace("<head>", `<head><script>window.__HME_ZOOM__=${storedZoom};</script>`);
        return html;
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
        try {
            this._persistState();
        }
        catch (e) {
            console.error(`[HME] dispose: _persistState failed: ${e?.message ?? e}`);
        }
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
ChatPanel.DISPLAY_CAP = 100;
ChatPanel.STREAM_PERSIST_MS = 10000;
