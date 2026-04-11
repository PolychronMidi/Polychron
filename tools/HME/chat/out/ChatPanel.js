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
const router_2 = require("./router");
const TranscriptLogger_1 = require("./TranscriptLogger");
const Arbiter_1 = require("./Arbiter");
const MODEL_CONTEXT_WINDOWS = {
    "claude-opus-4-6": 1000000,
    "claude-sonnet-4-6": 500000,
};
const DEFAULT_CONTEXT_WINDOW = 500000;
const CHAIN_THRESHOLD_PCT = 75;
const SYSTEM_OVERHEAD_TOKENS = 8000;
const CHARS_PER_TOKEN = 3.5;
const OLLAMA_OUTPUT_BUFFER = 4096;
function estimateTokens(messages) {
    let chars = 0;
    for (const m of messages)
        chars += m.content.length;
    return Math.ceil(chars / CHARS_PER_TOKEN);
}
function trimHistoryToFit(history, currentMsg, extraMessages = []) {
    const budget = router_2.GPU_NUM_CTX - OLLAMA_OUTPUT_BUFFER;
    const fixedTokens = estimateTokens([...extraMessages, { content: currentMsg }]);
    const available = budget - fixedTokens;
    if (available <= 0)
        return [];
    let total = 0;
    let keepFrom = 0;
    for (let i = history.length - 1; i >= 0; i--) {
        const cost = Math.ceil(history[i].content.length / CHARS_PER_TOKEN);
        if (total + cost > available) {
            keepFrom = i + 1;
            break;
        }
        total += cost;
    }
    return history.slice(keepFrom);
}
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
            console.error(`[HME] TranscriptLogger init failed — transcript disabled: ${e?.message ?? e}`);
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
                this._state = { messages: [], claudeSessionId: null, ollamaHistory: [], lastRoute: null, sessionEntry: null, chainIndex: 0 };
                this._resetContextTracker();
                this._post({ type: "historyCleared" });
                break;
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
                    if (!ready) {
                        this._startHmeShim();
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
            case "setZoomLevel":
                if (typeof msg.level === "number") {
                    ChatPanel._globalState?.update("hme.zoomLevel", msg.level);
                }
                break;
        }
    }
    /** Return the most recent messages up to the display cap. */
    _displayMessages() {
        return this._state.messages.slice(-ChatPanel.DISPLAY_CAP);
    }
    /**
     * Track a streaming assistant message so partial text survives ext host crashes.
     * Pushes a placeholder into _state.messages immediately and persists every 10s.
     * Returns { update, finalize } — call update() on chunks, finalize(msg) to replace.
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
            contextTokens: Math.round(this._contextTracker.totalChars / CHARS_PER_TOKEN),
            chainIndex: this._state.chainIndex,
        });
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
        this._persistState();
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
        const trimmed = trimHistoryToFit(this._state.ollamaHistory, msg.text, [systemPrompt]);
        const requestHistory = [systemPrompt, ...trimmed, { role: "user", content: msg.text }];
        let text = "";
        let tools = [];
        const blocks = [];
        let lastBlockType = null;
        let streamEnded = false;
        const tracker = this._trackStream(assistantId, label);
        const safeEnd = () => { if (streamEnded)
            return; streamEnded = true; onBothDone(); };
        const appendBlock = (type, content) => {
            if (type === "tool" || lastBlockType !== type || blocks.length === 0) {
                blocks.push({ type, content });
            }
            else {
                blocks[blocks.length - 1].content += content;
            }
            lastBlockType = type;
        };
        const onDone = () => {
            if (label === "local") {
                this._state.ollamaHistory.push({ role: "user", content: msg.text });
                this._state.ollamaHistory.push({ role: "assistant", content: text });
            }
            tracker.finalize({ id: assistantId, role: "assistant", text, tools: tools.length ? tools : undefined, blocks: blocks.length ? blocks : undefined, route: label, ts: Date.now() });
            this._post({ type: "streamEnd", id: assistantId });
            this._transcript.logAssistant(text, label, msg.ollamaModel, tools);
            const changedFiles = this._reindexFromTools(tools);
            this._runPostAudit(changedFiles);
            safeEnd();
        };
        const onChunk = (chunk, type) => {
            if (type === "tool") {
                tools.push(chunk);
                appendBlock("tool", chunk);
                this._post({ type: "streamChunk", id: assistantId, chunkType: "tool", chunk });
                this._transcript.logToolCall(chunk.split("]")[0].replace("[", ""), chunk, label);
            }
            else {
                text += chunk;
                appendBlock(type === "thinking" ? "thinking" : "text", chunk);
                this._post({ type: "streamChunk", id: assistantId, chunkType: type, chunk });
            }
            tracker.update(text, tools);
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
        const history = trimHistoryToFit(this._state.ollamaHistory, msg.text);
        let text = "";
        let tools = [];
        const blocks = [];
        let lastBlockType = null;
        let aborted = false;
        let streamEnded = false;
        const tracker = this._trackStream(assistantId, "hybrid");
        const safeEnd = () => { if (streamEnded)
            return; streamEnded = true; onBothDone(); };
        const appendBlock = (type, content) => {
            if (type === "tool" || lastBlockType !== type || blocks.length === 0) {
                blocks.push({ type, content });
            }
            else {
                blocks[blocks.length - 1].content += content;
            }
            lastBlockType = type;
        };
        // Register cancel immediately so abort works during HME context fetch
        const cancelWrapper = () => { aborted = true; };
        cancelFns.push(cancelWrapper);
        this._post({ type: "streamChunk", id: assistantId, chunkType: "tool", chunk: "[HME] Enriching with KB context…" });
        appendBlock("tool", "[HME] Enriching with KB context…");
        (0, router_1.streamHybrid)(msg.text, history, { model: msg.ollamaModel, url: "http://localhost:11434" }, this._projectRoot, (chunk, type) => {
            if (aborted)
                return;
            if (type === "tool") {
                tools.push(chunk);
                appendBlock("tool", chunk);
                this._post({ type: "streamChunk", id: assistantId, chunkType: "tool", chunk });
                this._transcript.logToolCall(chunk.split("]")[0].replace("[", ""), chunk, "hybrid");
            }
            else {
                text += chunk;
                appendBlock(type === "thinking" ? "thinking" : "text", chunk);
                this._post({ type: "streamChunk", id: assistantId, chunkType: type, chunk });
            }
            tracker.update(text, tools);
        }, () => {
            if (aborted)
                return;
            tracker.finalize({ id: assistantId, role: "assistant", text, tools: tools.length ? tools : undefined, blocks: blocks.length ? blocks : undefined, route: "hybrid", ts: Date.now() });
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
        const blocks = [];
        let lastBlockType = null;
        let streamEnded = false;
        let aborted = false; // gate: prevents buffered PTY/pipe chunks posting after cancel
        const tracker = this._trackStream(assistantId, msg._resolvedRoute ?? msg.route);
        const safeEnd = () => {
            if (streamEnded)
                return;
            streamEnded = true;
            this._drainQueue();
        };
        const appendBlock = (type, content) => {
            if (type === "tool" || lastBlockType !== type || blocks.length === 0) {
                blocks.push({ type, content });
            }
            else {
                blocks[blocks.length - 1].content += content;
            }
            lastBlockType = type;
        };
        const onDone = (usage) => {
            if (aborted)
                return;
            this._updateContextTracker(text, thinking, msg.claudeModel, usage);
            const assistantMsg = {
                id: assistantId,
                role: "assistant",
                text,
                thinking: thinking || undefined,
                tools: tools.length ? tools : undefined,
                blocks: blocks.length ? blocks : undefined,
                route: msg._resolvedRoute ?? msg.route,
                ts: Date.now(),
            };
            tracker.finalize(assistantMsg);
            this._post({ type: "streamEnd", id: assistantId });
            this._transcript.logAssistant(text, msg._resolvedRoute ?? msg.route ?? "claude", msg.claudeModel, tools);
            this._mirrorAssistantToShim(text, msg._resolvedRoute ?? msg.route ?? "claude", msg.claudeModel, tools);
            const changedFiles = this._reindexFromTools(tools);
            this._runPostAudit(changedFiles);
            this._checkChainThreshold(msg);
            safeEnd();
        };
        const onChunk = (chunk, type) => {
            if (aborted)
                return; // discard buffered chunks after cancel
            if (type === "text") {
                text += chunk;
                appendBlock("text", chunk);
                this._post({ type: "streamChunk", id: assistantId, chunkType: "text", chunk });
            }
            else if (type === "thinking") {
                thinking += chunk;
                appendBlock("thinking", chunk);
                this._post({ type: "streamChunk", id: assistantId, chunkType: "thinking", chunk });
            }
            else if (type === "tool") {
                tools.push(chunk);
                appendBlock("tool", chunk);
                this._post({ type: "streamChunk", id: assistantId, chunkType: "tool", chunk });
                this._transcript.logToolCall(chunk.split("]")[0].replace("[", ""), chunk, msg._resolvedRoute ?? msg.route ?? "claude");
            }
            else if (type === "error") {
                this._postError("claude", chunk);
            }
            tracker.update(text, tools, thinking);
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
            cancelFn = (0, router_1.streamClaude)(effectiveText, this._state.claudeSessionId, { model: msg.claudeModel, effort: msg.claudeEffort, thinking: msg.claudeThinking, permissionMode: "bypassPermissions" }, this._projectRoot, onChunk, (sessionId) => { this._state.claudeSessionId = sessionId; }, (_cost, usage) => { onDone(usage); }, onError);
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
        const indexable = [...files].filter(f => {
            const ext = path.extname(f).toLowerCase();
            return ChatPanel._INDEXABLE_EXTS.has(ext);
        });
        if (indexable.length > 0) {
            // Best-effort background work — file watcher handles normal saves.
            // Timeouts/errors are silently dropped; no _postError to avoid false LIFESAVER alarms.
            (0, router_1.reindexFiles)(indexable).catch(() => { });
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
    // ── Context tracking & chain ─────────────────────────────────────────────
    _resetContextTracker(restoredTokens) {
        this._contextTracker = { lastInputTokens: null, lastOutputTokens: null, totalChars: 0, model: "" };
        if (restoredTokens) {
            this._contextTracker.totalChars = restoredTokens * CHARS_PER_TOKEN;
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
        // PTY mode: no token counts available — estimate from all message chars (both user + assistant)
        // so the meter reflects actual context usage rather than just output chars.
        const allChars = this._state.messages.reduce((sum, m) => sum + (m.text?.length ?? 0) + (m.thinking?.length ?? 0), 0);
        const estimatedTokens = allChars / CHARS_PER_TOKEN + SYSTEM_OVERHEAD_TOKENS;
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
        // Load current todos from HME todo file
        let todos = [];
        try {
            const todoPath = path.join(process.env["HOME"] ?? process.env["USERPROFILE"] ?? "~", ".claude", "mcp", "HME", "todos.json");
            todos = JSON.parse(fs.readFileSync(todoPath, "utf8"));
        }
        catch (e) {
            if (e?.code !== "ENOENT")
                console.error(`[HME] Failed to load todos.json: ${e?.message ?? e}`);
        }
        // Generate summary via a separate Claude -p call
        const priorSummaries = (0, SessionStore_1.loadChainSummaries)(this._projectRoot, sessionId);
        const recentMessages = this._state.messages.slice(-20);
        const summaryPrompt = this._buildSummaryPrompt(recentMessages, todos, priorSummaries);
        let summary = "";
        try {
            summary = await (0, Arbiter_1.synthesizeChainSummary)(summaryPrompt);
        }
        catch (e) {
            console.error(`[HME Chat] Chain summary via local model failed: ${e}`);
            summary = this._buildFallbackSummary(recentMessages, todos, priorSummaries);
        }
        // Save chain link
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
        // Reset session for new chain segment
        this._state.messages = [];
        this._state.claudeSessionId = null;
        this._state.chainIndex = linkIndex + 1;
        this._resetContextTracker();
        // Prime the new session with the summary as a system context message
        const contextMsg = {
            id: uid(),
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
    _buildSummaryPrompt(messages, todos, priorSummaries) {
        const priorContext = priorSummaries.length > 0
            ? `Previous chain link summaries:\n${priorSummaries.map((s, i) => `--- Link ${i + 1} ---\n${s}`).join("\n\n")}\n\n`
            : "";
        const todoBlock = todos.length > 0
            ? `Current todo list:\n${JSON.stringify(todos, null, 2)}\n\n`
            : "No active todos.\n\n";
        const conversationBlock = messages
            .map((m) => `[${m.role}]: ${m.text.slice(0, 1500)}`)
            .join("\n\n");
        return `You are generating a context chain summary for an AI coding assistant conversation. This summary will be used to prime a fresh context window, replacing the full conversation history.

Requirements:
1. Be concise but preserve all actionable context — decisions made, approaches chosen, files modified, bugs found
2. Include the current state of the todo list
3. Reference specific file paths and function names when relevant
4. Note any in-progress work that needs continuation
5. Keep the summary under 2000 tokens

${priorContext}${todoBlock}Recent conversation:\n${conversationBlock}\n\nGenerate the continuation summary:`;
    }
    _buildFallbackSummary(messages, todos, priorSummaries) {
        const lines = [];
        if (priorSummaries.length > 0) {
            lines.push("## Prior context");
            lines.push(priorSummaries[priorSummaries.length - 1].slice(0, 800));
        }
        lines.push("\n## Recent activity");
        for (const m of messages.slice(-8)) {
            lines.push(`[${m.role}]: ${m.text.slice(0, 300)}`);
        }
        if (todos.length > 0) {
            lines.push("\n## Active todos");
            for (const t of todos) {
                lines.push(`- [${t.done ? "x" : " "}] ${t.text}`);
                if (t.subs) {
                    for (const s of t.subs) {
                        lines.push(`  - [${s.done ? "x" : " "}] ${s.text}`);
                    }
                }
            }
        }
        return lines.join("\n");
    }
    _streamOllama(msg, assistantId) {
        const systemPrompt = {
            role: "system",
            content: "You are an agentic coding assistant with access to bash, read_file, and write_file tools. When asked to perform a task — create files, edit code, run commands, implement features — call the appropriate tool immediately. Never respond with suggestions, plans, or code blocks without calling a tool first.",
        };
        const contextMessages = msg._contextPrefix
            ? [{ role: "user", content: msg._contextPrefix }, { role: "assistant", content: "Understood. I have the prior conversation context." }]
            : [];
        const trimmed = trimHistoryToFit(this._state.ollamaHistory, msg.text, [systemPrompt, ...contextMessages]);
        const requestHistory = [systemPrompt, ...contextMessages, ...trimmed, { role: "user", content: msg.text }];
        let text = "";
        let tools = [];
        const blocks = [];
        let lastBlockType = null;
        let streamEnded = false;
        let aborted = false; // gate: drops buffered Ollama chunks after cancel
        const tracker = this._trackStream(assistantId, "local");
        const safeEnd = () => {
            if (streamEnded)
                return;
            streamEnded = true;
            this._drainQueue();
        };
        const appendBlock = (type, content) => {
            if (type === "tool" || lastBlockType !== type || blocks.length === 0) {
                blocks.push({ type, content });
            }
            else {
                blocks[blocks.length - 1].content += content;
            }
            lastBlockType = type;
        };
        const onDone = () => {
            if (aborted)
                return;
            this._state.ollamaHistory.push({ role: "user", content: msg.text });
            this._state.ollamaHistory.push({ role: "assistant", content: text });
            const assistantMsg = {
                id: assistantId, role: "assistant", text,
                tools: tools.length ? tools : undefined,
                blocks: blocks.length ? blocks : undefined,
                route: "local", ts: Date.now(),
            };
            tracker.finalize(assistantMsg);
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
                appendBlock("tool", chunk);
                this._post({ type: "streamChunk", id: assistantId, chunkType: "tool", chunk });
                this._transcript.logToolCall(chunk.split("]")[0].replace("[", ""), chunk, "local");
            }
            else {
                text += chunk;
                appendBlock(type === "thinking" ? "thinking" : "text", chunk);
                this._post({ type: "streamChunk", id: assistantId, chunkType: type, chunk });
            }
            tracker.update(text, tools);
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
        const blocks = [];
        let lastBlockType = null;
        let cancelFn;
        let aborted = false;
        let streamEnded = false;
        const tracker = this._trackStream(assistantId, "hybrid");
        const safeEnd = () => {
            if (streamEnded)
                return;
            streamEnded = true;
            this._drainQueue();
        };
        const appendBlock = (type, content) => {
            if (type === "tool" || lastBlockType !== type || blocks.length === 0) {
                blocks.push({ type, content });
            }
            else {
                blocks[blocks.length - 1].content += content;
            }
            lastBlockType = type;
        };
        // Cancelable immediately — even during HME context fetch
        this._cancelCurrent = () => { aborted = true; cancelFn?.(); };
        // Post "enriching…" status
        this._post({ type: "streamChunk", id: assistantId, chunkType: "tool", chunk: "[HME] Enriching with KB context…" });
        appendBlock("tool", "[HME] Enriching with KB context…");
        (0, router_1.streamHybrid)(msg.text, history, { model: msg.ollamaModel, url: "http://localhost:11434" }, this._projectRoot, (chunk, type) => {
            if (aborted)
                return;
            if (type === "tool") {
                tools.push(chunk);
                appendBlock("tool", chunk);
                this._post({ type: "streamChunk", id: assistantId, chunkType: "tool", chunk });
                this._transcript.logToolCall(chunk.split("]")[0].replace("[", ""), chunk, "hybrid");
            }
            else {
                text += chunk;
                appendBlock(type === "thinking" ? "thinking" : "text", chunk);
                this._post({ type: "streamChunk", id: assistantId, chunkType: type, chunk });
            }
            tracker.update(text, tools);
        }, () => {
            if (aborted)
                return;
            this._state.ollamaHistory.push({ role: "user", content: msg.text });
            this._state.ollamaHistory.push({ role: "assistant", content: text });
            const assistantMsg = {
                id: assistantId, role: "assistant", text,
                tools: tools.length ? tools : undefined,
                blocks: blocks.length ? blocks : undefined,
                route: "hybrid", ts: Date.now(),
            };
            tracker.finalize(assistantMsg);
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
    /** Fail-fast error surface: log file + KB antipattern lookup. Lifesaver hook surfaces errors to Claude. */
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
        // Persist in-flight state synchronously before anything async (writeFileSync — always completes)
        try {
            this._persistState();
        }
        catch (e) {
            console.error(`[HME] dispose: _persistState failed: ${e?.message ?? e}`);
        }
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
ChatPanel.STREAM_PERSIST_MS = 10000;
/**
 * Detect files modified by tool calls and trigger immediate mini-reindex.
 * Parses tool call strings for file paths — Claude ("file_path") and Ollama ("path") formats.
 * Returns the set of detected file paths for downstream use (audit).
 */
ChatPanel._INDEXABLE_EXTS = new Set([
    ".js", ".ts", ".tsx", ".jsx", ".py", ".json", ".md", ".css", ".html", ".sh",
]);
function uid() {
    return Math.random().toString(36).slice(2, 10);
}
