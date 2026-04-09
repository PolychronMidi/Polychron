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
    }
    static createOrShow(projectRoot) {
        const col = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;
        if (ChatPanel.current) {
            ChatPanel.current._panel.reveal(col);
            return;
        }
        const panel = vscode.window.createWebviewPanel("hmeChat", "HME Chat", col || vscode.ViewColumn.One, {
            enableScripts: true,
            retainContextWhenHidden: true,
        });
        // Auto-restore the most recently active session (same as window-reload path)
        const sessions = (0, SessionStore_1.listSessions)(projectRoot);
        const restoreId = sessions[0]?.id;
        ChatPanel.current = new ChatPanel(panel, projectRoot, restoreId);
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
        this._post({ type: "sessionLoaded", id: persisted.entry.id, messages: persisted.messages, title: persisted.entry.title });
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
        // ── Auto-route: arbiter classifies message complexity ──
        let resolvedRoute = msg.route;
        if (msg.route === "auto") {
            this._post({ type: "notice", level: "info", text: "🔀 Arbiter classifying…" });
            const transcriptCtx = this._transcript.getRecentContext(20, 1500);
            // Wire real signals into the arbiter — constraint density + error rate
            let constraintCount = 0;
            try {
                const { warnings, blocks } = await (0, router_1.validateMessage)(msg.text);
                constraintCount = warnings.length + blocks.length;
            }
            catch { /* shim down — arbiter proceeds with 0 constraints */ }
            const recentErrors = this._transcript.getWindow(15)
                .filter((e) => (e.type === "audit" || e.type === "tool_result") && e.content?.includes("ERROR")).length;
            const decision = await (0, Arbiter_1.classifyMessage)(msg.text, transcriptCtx, constraintCount, recentErrors);
            resolvedRoute = decision.route;
            const isArbiterError = decision.isError;
            this._post({
                type: "notice",
                level: isArbiterError ? "warn" : "info",
                text: `🔀 Arbiter → ${decision.route} (${Math.round(decision.confidence * 100)}%): ${decision.reason}`,
            });
            this._transcript.logRouteSwitch("auto", `${decision.route} (${decision.reason})`);
            if (isArbiterError) {
                // Log prominently in transcript
                this._transcript.log({
                    ts: Date.now(), type: "audit", route: "auto",
                    content: `ARBITER ERROR: ${decision.reason} — falling back to ${decision.route}`,
                    summary: `Arbiter failed: ${decision.reason}`,
                });
                // Shim is single writer; fall back to direct disk write only if shim unreachable.
                (0, router_1.logShimError)("arbiter", decision.reason, `fell back to ${decision.route}`).catch((e) => {
                    console.error(`[HME FAILFAST] arbiter logShimError failed: ${e?.message ?? e}`);
                    const errLine = `[${new Date().toISOString()}] [arbiter] ${decision.reason} — fell back to ${decision.route}\n`;
                    try {
                        fs.mkdirSync(path.join(this._projectRoot, "log"), { recursive: true });
                        fs.appendFileSync(path.join(this._projectRoot, "log", "hme-errors.log"), errLine);
                    }
                    catch (fileErr) {
                        console.error(`[HME FAILFAST] Arbiter disk fallback failed: ${fileErr?.message ?? fileErr}`);
                    }
                });
            }
            if (decision.thinking) {
                this._transcript.log({
                    ts: Date.now(), type: "tool_call", route: "auto",
                    content: `Arbiter reasoning: ${decision.thinking.slice(0, 500)}`,
                    summary: `Arbiter thinking: ${decision.thinking.slice(0, 80)}`,
                });
            }
        }
        // ── Auto-create session on first message ──
        if (!this._state.sessionEntry) {
            const entry = (0, SessionStore_1.createSession)(this._projectRoot, (0, SessionStore_1.deriveTitle)(msg.text));
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
            // Poll readiness — retry up to 5 times every 2s
            let attempts = 0;
            const poll = () => {
                attempts++;
                (0, router_1.isHmeShimReady)().then(({ ready }) => {
                    if (ready) {
                        started = true;
                        this._post({ type: "hmeShimStatus", ready: true });
                        return;
                    }
                    if (attempts < 5 && this._shimProc) {
                        this._post({ type: "hmeShimStatus", ready: false, failed: false });
                        setTimeout(poll, 2000);
                    }
                    else {
                        this._shimFailed = true;
                        this._post({ type: "hmeShimStatus", ready: false, failed: true });
                        this._postError("shim", `HME shim started but /health not ready after ${attempts * 2}s — check log/hme-errors.log or run mcp/hme_http.py manually`);
                    }
                });
            };
            setTimeout(poll, 2000);
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
        if (fs.existsSync(htmlPath)) {
            return fs.readFileSync(htmlPath, "utf8");
        }
        return getInlineHtml();
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
function uid() {
    return Math.random().toString(36).slice(2, 10);
}
function getInlineHtml() {
    // Returns the full chat UI — keeps all HTML/CSS/JS in one place
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>HME Chat</title>
<style>
  html { overflow: hidden; }
  :root {
    --bg: var(--vscode-editor-background);
    --fg: var(--vscode-editor-foreground);
    --input-bg: var(--vscode-input-background);
    --input-fg: var(--vscode-input-foreground);
    --input-border: var(--vscode-input-border);
    --btn-bg: var(--vscode-button-background);
    --btn-fg: var(--vscode-button-foreground);
    --btn-hover: var(--vscode-button-hoverBackground);
    --border: var(--vscode-panel-border);
    --user-bg: var(--vscode-editorWidget-background);
    --assistant-bg: var(--vscode-editor-background);
    --thinking-bg: var(--vscode-editorInfo-background, #1a2a3a);
    --thinking-fg: var(--vscode-editorInfo-foreground, #7ec8e3);
    --tool-bg: var(--vscode-editorHint-background, #1a2a1a);
    --tool-fg: var(--vscode-editorHint-foreground, #7ec87e);
    --error-fg: var(--vscode-errorForeground);
    --route-auto: #56b8da;
    --route-claude: #da7756;
    --route-local: #56da8a;
    --route-hybrid: #7e56da;
    --subtle: var(--vscode-descriptionForeground);
    --font-mono: var(--vscode-editor-font-family, monospace);
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: var(--bg);
    color: var(--fg);
    font-family: var(--vscode-font-family, sans-serif);
    font-size: var(--vscode-font-size, 13px);
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow: hidden;
  }

  /* ── Layout ── */
  #layout { display: flex; flex: 1; overflow: hidden; }

  /* ── Sidebar toggle ── */
  #sidebar-toggle-btn {
    background: transparent;
    border: none;
    color: var(--subtle);
    cursor: pointer;
    font-size: 14px;
    padding: 2px 5px;
    border-radius: 3px;
    line-height: 1;
  }
  #sidebar-toggle-btn:hover { color: var(--fg); background: var(--user-bg); }

  /* ── Session sidebar ── */
  #sidebar {
    width: 200px;
    min-width: 160px;
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    overflow: hidden;
  }
  #sidebar-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 8px;
    border-bottom: 1px solid var(--border);
    font-size: 11px;
    color: var(--subtle);
    flex-shrink: 0;
  }
  #new-session-btn {
    background: var(--btn-bg);
    color: var(--btn-fg);
    border: none;
    border-radius: 3px;
    padding: 2px 7px;
    cursor: pointer;
    font-size: 11px;
  }
  #new-session-btn:hover { background: var(--btn-hover); }
  #sidebar-settings {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 5px 8px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .zoom-btn {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--fg);
    border-radius: 3px;
    width: 20px;
    height: 20px;
    cursor: pointer;
    font-size: 13px;
    line-height: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
  }
  .zoom-btn:hover { border-color: var(--fg); background: var(--user-bg); }
  #zoom-label { font-size: 10px; color: var(--subtle); min-width: 34px; text-align: center; }
  #session-list {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 4px;
  }
  .session-item {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 5px 6px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 11px;
    color: var(--fg);
    overflow: hidden;
  }
  .session-item:hover { background: var(--user-bg); }
  .session-item.active { background: var(--user-bg); border-left: 2px solid var(--btn-bg); }
  .session-title {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .session-delete {
    opacity: 0;
    background: transparent;
    border: none;
    color: var(--subtle);
    cursor: pointer;
    font-size: 11px;
    padding: 0 2px;
    flex-shrink: 0;
  }
  .session-item:hover .session-delete { opacity: 1; }
  .session-delete:hover { color: var(--error-fg); }

  /* ── Main area ── */
  #main { flex: 1; display: flex; flex-direction: column; overflow: hidden; }

  /* ── Toolbar ── */
  #toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border-bottom: 1px solid var(--border);
    flex-wrap: wrap;
    flex-shrink: 0;
  }
  #toolbar label { color: var(--subtle); font-size: 11px; }
  #toolbar select, #toolbar input[type="text"] {
    background: var(--input-bg);
    color: var(--input-fg);
    border: 1px solid var(--input-border);
    border-radius: 3px;
    padding: 2px 6px;
    font-size: 12px;
    height: 24px;
  }


  .claude-only, .local-only { transition: opacity 0.15s; }

  #thinking-wrap { display: flex; align-items: center; gap: 4px; }
  #thinking-wrap input[type="checkbox"] { cursor: pointer; }

  #clear-btn {
    margin-left: auto;
    background: transparent;
    border: 1px solid var(--border);
    color: var(--subtle);
    border-radius: 3px;
    padding: 2px 8px;
    cursor: pointer;
    font-size: 11px;
  }
  #clear-btn:hover { border-color: var(--fg); color: var(--fg); }

  /* ── Messages ── */
  #messages {
    flex: 1;
    overflow-y: auto;
    padding: 12px 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .msg {
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-width: 100%;
  }
  .msg-header {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: var(--subtle);
  }
  .route-badge {
    padding: 1px 5px;
    border-radius: 3px;
    font-size: 10px;
    font-weight: bold;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .route-auto   { background: var(--route-auto);   color: #000; }
  .route-claude { background: var(--route-claude); color: #fff; }
  .route-local  { background: var(--route-local);  color: #000; }
  .route-hybrid { background: var(--route-hybrid); color: #fff; }
  .model-badge {
    color: var(--subtle);
    font-size: 10px;
    font-family: var(--font-mono);
  }

  .msg-body {
    padding: 8px 12px;
    border-radius: 6px;
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .msg.user .msg-body   { background: var(--user-bg); }
  .msg.assistant .msg-body { background: var(--assistant-bg); border: 1px solid var(--border); }

  /* Thinking accordion */
  details.thinking {
    background: var(--thinking-bg);
    border: 1px solid color-mix(in srgb, var(--thinking-fg) 30%, transparent);
    border-radius: 4px;
    font-size: 11px;
  }
  details.thinking summary {
    padding: 4px 8px;
    cursor: pointer;
    color: var(--thinking-fg);
    user-select: none;
    list-style: none;
  }
  details.thinking summary::-webkit-details-marker { display: none; }
  details.thinking summary::before { content: "▶ "; }
  details.thinking[open] summary::before { content: "▼ "; }
  details.thinking .thinking-body {
    padding: 6px 10px;
    color: var(--thinking-fg);
    font-family: var(--font-mono);
    font-size: 11px;
    opacity: 0.85;
    white-space: pre-wrap;
    max-height: 300px;
    overflow-y: auto;
  }

  /* Tool steps */
  .tool-step {
    font-size: 11px;
    font-family: var(--font-mono);
    color: var(--tool-fg);
    background: var(--tool-bg);
    padding: 3px 8px;
    border-radius: 3px;
    border-left: 2px solid var(--tool-fg);
  }

  .cost-badge {
    color: var(--subtle);
    font-size: 10px;
  }
  .queued-badge {
    padding: 1px 5px;
    border-radius: 3px;
    font-size: 10px;
    background: var(--vscode-badge-background);
    color: var(--vscode-badge-foreground);
    opacity: 0.7;
  }

  .error-msg {
    color: var(--error-fg);
    font-size: 12px;
    font-family: var(--font-mono);
  }

  /* Standalone error bubble — fail-fast, always visible, never buried */
  .error-bubble {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 8px 12px;
    border-radius: 6px;
    border-left: 3px solid var(--error-fg);
    background: color-mix(in srgb, var(--error-fg) 10%, var(--bg));
    font-size: 12px;
    font-family: var(--font-mono);
    color: var(--error-fg);
    white-space: pre-wrap;
    word-break: break-word;
    animation: error-flash 0.3s ease-out;
  }
  .error-bubble-icon { flex-shrink: 0; font-size: 14px; }
  .error-bubble-body { flex: 1; }
  .error-bubble-source {
    font-size: 10px;
    opacity: 0.7;
    margin-bottom: 3px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  @keyframes error-flash {
    from { opacity: 0; transform: translateX(-4px); }
    to   { opacity: 1; transform: translateX(0); }
  }

  /* CRITICAL error overlay — blocks UI until acknowledged */
  .critical-overlay {
    position: fixed;
    inset: 0;
    z-index: 9999;
    background: rgba(0, 0, 0, 0.85);
    display: flex;
    align-items: center;
    justify-content: center;
    animation: overlay-in 0.2s ease-out;
  }
  .critical-box {
    max-width: 90%;
    padding: 20px 24px;
    border-radius: 10px;
    border: 2px solid var(--error-fg);
    background: var(--bg);
    color: var(--error-fg);
    font-family: var(--font-mono);
    text-align: left;
  }
  .critical-box h2 { margin: 0 0 12px; font-size: 16px; }
  .critical-box pre {
    white-space: pre-wrap;
    word-break: break-word;
    font-size: 12px;
    margin: 8px 0 16px;
    padding: 8px;
    background: rgba(255,0,0,0.08);
    border-radius: 4px;
  }
  .critical-box button {
    padding: 6px 16px;
    border: 1px solid var(--error-fg);
    background: transparent;
    color: var(--error-fg);
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
  }
  .critical-box button:hover { background: rgba(255,0,0,0.15); }
  @keyframes overlay-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  /* Streaming cursor — inline span, instantly hidden on done to prevent flash */
  .stream-cursor { animation: blink 0.8s step-end infinite; }
  .stream-cursor.done { animation: none; visibility: hidden; }
  @keyframes blink { 50% { opacity: 0; } }

  /* ── Notice bar ── */
  #notice-bar {
    display: none;
    padding: 6px 12px;
    font-size: 11px;
    font-family: var(--font-mono);
    white-space: pre-wrap;
    border-top: 1px solid var(--border);
    flex-shrink: 0;
    cursor: pointer;
  }
  #notice-bar.warn  { background: color-mix(in srgb, #b8860b 15%, transparent); color: #e0c060; border-left: 3px solid #b8860b; }
  #notice-bar.block { background: color-mix(in srgb, var(--error-fg) 15%, transparent); color: var(--error-fg); border-left: 3px solid var(--error-fg); }
  #notice-bar.audit { background: color-mix(in srgb, var(--route-hybrid) 12%, transparent); color: var(--route-hybrid); border-left: 3px solid var(--route-hybrid); }
  #notice-bar.info  { background: color-mix(in srgb, var(--btn-bg) 12%, transparent); color: var(--btn-fg); border-left: 3px solid var(--btn-bg); }

  /* ── Input area ── */
  #input-area {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 10px;
    border-top: 1px solid var(--border);
    flex-shrink: 0;
  }
  #msg-input {
    background: var(--input-bg);
    color: var(--input-fg);
    border: 1px solid var(--input-border);
    border-radius: 4px;
    padding: 8px 10px;
    font-family: inherit;
    font-size: 13px;
    resize: none;
    min-height: 60px;
    max-height: 200px;
    outline: none;
  }
  #msg-input:focus { border-color: var(--btn-bg); }
  #input-row {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  #send-btn {
    background: var(--btn-bg);
    color: var(--btn-fg);
    border: none;
    border-radius: 4px;
    padding: 6px 16px;
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
  }
  #send-btn:hover { background: var(--btn-hover); }
  #send-btn:disabled { opacity: 0.5; cursor: default; }
  #stop-btn {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--fg);
    border-radius: 4px;
    padding: 6px 12px;
    cursor: pointer;
    font-size: 12px;
    display: none;
  }
  #stop-btn:hover { border-color: var(--error-fg); color: var(--error-fg); }
  #queue-btn {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--fg);
    border-radius: 4px;
    padding: 6px 12px;
    cursor: pointer;
    font-size: 12px;
    display: none;
  }
  #queue-btn:hover { border-color: var(--btn-bg); color: var(--btn-bg); }
  #status-line {
    font-size: 11px;
    color: var(--subtle);
    align-self: center;
    margin-left: auto;
  }
</style>
</head>
<body>

<div id="layout">
<!-- Session sidebar -->
<div id="sidebar">
  <div id="sidebar-header">
    <span>Sessions</span>
    <button id="new-session-btn" title="New session">+</button>
  </div>
  <div id="sidebar-settings">
    <button class="zoom-btn" id="zoom-out-btn" title="Zoom out">−</button>
    <span id="zoom-label">100%</span>
    <button class="zoom-btn" id="zoom-in-btn" title="Zoom in">+</button>
  </div>
  <div id="session-list"></div>
</div>

<!-- Main -->
<div id="main">
<!-- Toolbar -->
<div id="toolbar">
  <button id="sidebar-toggle-btn" title="Toggle session sidebar">⚙</button>

  <!-- Model + effort controls (claude route always active) -->
  <select id="claude-model">
    <option value="claude-opus-4-6">Opus 4.6</option>
    <option value="claude-sonnet-4-6" selected>Sonnet 4.6</option>
    <option value="claude-haiku-4-5-20251001">Haiku 4.5</option>
  </select>
  <select id="claude-effort">
    <option value="low">Low</option>
    <option value="medium">Medium</option>
    <option value="high" selected>High</option>
    <option value="max">Max</option>
  </select>
  <div id="thinking-wrap">
    <input type="checkbox" id="thinking-toggle" />
    <label for="thinking-toggle">Thinking</label>
  </div>

  <span id="shim-status" title="HME KB shim status" style="font-size:10px;color:var(--subtle);margin-left:4px;">HME ○</span>
  <button id="clear-btn">Clear</button>
</div>

<!-- Messages -->
<div id="messages"></div>

<!-- Notice bar -->
<div id="notice-bar" title="Click to dismiss"></div>

<!-- Input -->
<div id="input-area">
  <textarea id="msg-input" placeholder="Message… (Enter to send, Shift+Enter for newline)"></textarea>
  <div id="input-row">
    <button id="send-btn">Send</button>
    <button id="stop-btn">Stop</button>
    <button id="queue-btn">Queue</button>
    <span id="status-line"></span>
  </div>
</div>

</div><!-- /main -->
</div><!-- /layout -->

<script>
const vscode = acquireVsCodeApi();

// ── State ──────────────────────────────────────────────────────────────────
let streaming = false;
const activeStreams = new Set();   // supports parallel streams (agent mode)
let streamTools = [];
const streamBodyMap = new Map();      // per-stream active text block
const streamThinkingMap = new Map();  // per-stream active thinking block

// ── UI refs ────────────────────────────────────────────────────────────────
const claudeModel = document.getElementById('claude-model');
const claudeEffort= document.getElementById('claude-effort');
const thinkingChk = document.getElementById('thinking-toggle');

// Update effort/thinking visibility when model changes:
// Opus: all options including Max. Sonnet: hide Max. Haiku: hide effort + thinking entirely.
function updateModelControls() {
  const m = claudeModel.value;
  const isHaiku = m === 'claude-haiku-4-5-20251001';
  const isSonnet = m === 'claude-sonnet-4-6';
  const effortEl = document.getElementById('claude-effort');
  const thinkingWrap = document.getElementById('thinking-wrap');
  const maxOpt = effortEl.querySelector('option[value="max"]');
  effortEl.style.display = isHaiku ? 'none' : '';
  thinkingWrap.style.display = isHaiku ? 'none' : '';
  if (maxOpt) maxOpt.style.display = isSonnet ? 'none' : '';
  // If Sonnet is selected and max was chosen, fall back to high
  if (isSonnet && effortEl.value === 'max') effortEl.value = 'high';
}
claudeModel.addEventListener('change', updateModelControls);
updateModelControls();
const messages    = document.getElementById('messages');
const input       = document.getElementById('msg-input');
const sendBtn     = document.getElementById('send-btn');
const stopBtn     = document.getElementById('stop-btn');
const queueBtn    = document.getElementById('queue-btn');
const statusLine  = document.getElementById('status-line');
const clearBtn    = document.getElementById('clear-btn');

// ── Send ───────────────────────────────────────────────────────────────────
function send() {
  let text = input.value.trim();
  if (!text) return;
  input.value = '';
  input.style.height = '';
  // Default route is claude. Slash prefixes override for backend testing:
  // /local, /hybrid, /auto, /agent — e.g. "/local what is X?"
  let route = 'claude';
  const routeMatch = text.match(/^\/(local|hybrid|auto|agent) /);
  if (routeMatch) {
    route = routeMatch[1];
    text = text.slice(routeMatch[0].length).trim();
  }
  const isClaude = route === 'claude';
  vscode.postMessage({
    type: 'send',
    text,
    route,
    claudeModel: claudeModel.value,
    claudeEffort: isClaude ? claudeEffort.value : undefined,
    claudeThinking: isClaude ? thinkingChk.checked : false,
    ollamaModel: 'qwen3-coder:30b',
  });
  // Show stop/queue immediately — don't wait for streamStart which may be delayed
  // by arbiter classification (up to 60s on auto route).
  streaming = true;
  stopBtn.style.display = 'inline-block';
  queueBtn.style.display = 'inline-block';
  setStatus('Sending…');
}

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
});
input.addEventListener('input', () => {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 200) + 'px';
});
sendBtn.addEventListener('click', send);
stopBtn.addEventListener('click', () => vscode.postMessage({ type: 'cancel' }));
queueBtn.addEventListener('click', () => {
  let text = input.value.trim();
  if (!text) return;
  input.value = '';
  input.style.height = '';
  vscode.postMessage({
    type: 'queue',
    text,
    route: 'claude', // queue always sends as claude; use /route prefix in send() for testing
    claudeModel: claudeModel.value,
    claudeEffort: claudeEffort.value,
    claudeThinking: thinkingChk.checked,
    ollamaModel: 'qwen3-coder:30b',
  });
});
clearBtn.addEventListener('click', () => vscode.postMessage({ type: 'clearHistory' }));

// ── Receive messages from extension ───────────────────────────────────────
window.addEventListener('message', (event) => {
  const msg = event.data;
  switch (msg.type) {
    case 'message':
      appendMessage(msg.message);
      break;
    case 'streamStart':
      startStream(msg.id, msg.route, msg.model);
      break;
    case 'streamChunk':
      appendChunk(msg.id, msg.chunkType, msg.chunk);
      break;
    case 'errorBubble':
      appendErrorBubble(msg.source, msg.message);
      break;
    case 'criticalError':
      appendErrorBubble(msg.source, msg.message);
      showCriticalOverlay(msg.source, msg.message);
      break;
    case 'streamEnd':
      endStream(msg.id, msg.cost);
      break;
    case 'cancelConfirmed':
      [...activeStreams].forEach(sid => endStream(sid, undefined));
      break;
    case 'historyCleared':
      messages.innerHTML = '';
      setStatus('');
      break;
  }
});

// ── Message rendering ──────────────────────────────────────────────────────
function appendMessage(msg) {
  const div = document.createElement('div');
  div.className = \`msg \${msg.role}\`;
  div.id = \`msg-\${msg.id}\`;

  const header = document.createElement('div');
  header.className = 'msg-header';
  const roleLabel = msg.role === 'user' ? 'You' : 'Assistant';
  header.innerHTML = \`<span>\${roleLabel}</span>\`;
  if (msg.route) {
    header.innerHTML += \`<span class="route-badge route-\${msg.route}">\${msg.route}</span>\`;
  }
  if (streaming && msg.role === 'user') {
    header.innerHTML += \`<span class="queued-badge">queued</span>\`;
  }

  div.appendChild(header);

  if (msg.thinking) {
    const details = document.createElement('details');
    details.className = 'thinking';
    details.open = true;
    details.innerHTML = \`<summary>🧠 Thinking</summary><div class="thinking-body"></div>\`;
    details.querySelector('.thinking-body').textContent = msg.thinking;
    div.appendChild(details);
  }

  if (msg.text) {
    const body = document.createElement('div');
    body.className = 'msg-body';
    body.textContent = msg.text;
    div.appendChild(body);
  }

  if (msg.tools && msg.tools.length) {
    for (const t of msg.tools) {
      const toolDiv = document.createElement('div');
      toolDiv.className = 'tool-step';
      toolDiv.textContent = t;
      div.appendChild(toolDiv);
    }
  }

  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
}

function startStream(id, route, model) {
  streaming = true;
  activeStreams.add(id);
  streamTools = [];

  const div = document.createElement('div');
  div.className = 'msg assistant';
  div.id = \`msg-\${id}\`;

  const header = document.createElement('div');
  header.className = 'msg-header';
  header.innerHTML = \`<span>Assistant</span><span class="route-badge route-\${route}">\${route}</span><span class="model-badge">\${model}</span>\`;

  div.appendChild(header);
  messages.appendChild(div);

  stopBtn.style.display = 'inline-block';
  queueBtn.style.display = 'inline-block';
  setStatus('Streaming…');
  messages.scrollTop = messages.scrollHeight;
}

function appendChunk(id, chunkType, chunk) {
  const div = document.getElementById(\`msg-\${id}\`);
  if (!div) return;

  if (chunkType === 'thinking') {
    // Each thinking segment gets its own block per stream; nulled by text/tool chunks
    if (!streamThinkingMap.get(id)) {
      const thk = document.createElement('details');
      thk.className = 'thinking';
      thk.open = true;
      thk.innerHTML = \`<summary>🧠 Thinking…</summary><div class="thinking-body"></div>\`;
      div.appendChild(thk);
      streamThinkingMap.set(id, thk);
    }
    streamThinkingMap.get(id).querySelector('.thinking-body').textContent += chunk;
  } else if (chunkType === 'tool') {
    // Hide cursor in current text block for this stream
    streamBodyMap.get(id)?.querySelector('.stream-cursor')?.classList.add('done');
    streamBodyMap.delete(id);
    streamThinkingMap.delete(id);
    const toolDiv = document.createElement('div');
    toolDiv.className = 'tool-step';
    toolDiv.textContent = chunk;
    div.appendChild(toolDiv);
  } else if (chunkType === 'error') {
    const errDiv = document.createElement('div');
    errDiv.className = 'error-msg';
    errDiv.textContent = '⚠ ' + chunk;
    div.appendChild(errDiv);
  } else {
    streamThinkingMap.delete(id); // entering text mode — close current thinking segment
    // text — one block per inter-tool segment per stream
    if (!streamBodyMap.get(id)) {
      const body = document.createElement('div');
      body.className = 'msg-body';
      const cur = document.createElement('span');
      cur.className = 'stream-cursor';
      cur.textContent = '▊';
      body.appendChild(cur);
      div.appendChild(body);
      streamBodyMap.set(id, body);
    }
    const body = streamBodyMap.get(id);
    const cur = body.querySelector('.stream-cursor');
    body.insertBefore(document.createTextNode(chunk), cur);
  }
  messages.scrollTop = messages.scrollHeight;
}

function endStream(id, cost) {
  activeStreams.delete(id);
  streaming = activeStreams.size > 0;
  streamBodyMap.delete(id);
  streamThinkingMap.delete(id);
  if (!streaming) { stopBtn.style.display = 'none'; queueBtn.style.display = 'none'; }

  const div = document.getElementById(\`msg-\${id}\`);
  if (div) {
    div.querySelectorAll('.stream-cursor').forEach(c => {
      c.classList.add('done'); // hide immediately — stops animation in same paint
      requestAnimationFrame(() => c.remove());
    });

    // Update all thinking block summaries (may be multiple interspersed blocks)
    div.querySelectorAll('details.thinking summary').forEach(s => { s.textContent = '🧠 Thinking'; });

    if (cost !== undefined && cost !== null) {
      const header = div.querySelector('.msg-header');
      if (header) header.innerHTML += \`<span class="cost-badge">$\${cost.toFixed(4)}</span>\`;
    }
  }

  if (!streaming) setStatus(cost !== undefined ? \`Cost: $\${cost?.toFixed(4) ?? '?'}\` : '');
}

function appendErrorBubble(source, message) {
  const wrap = document.createElement('div');
  wrap.className = 'error-bubble';

  const icon = document.createElement('span');
  icon.className = 'error-bubble-icon';
  icon.textContent = '⚠';

  const body = document.createElement('div');
  body.className = 'error-bubble-body';

  const src = document.createElement('div');
  src.className = 'error-bubble-source';
  src.textContent = source;

  const text = document.createElement('div');
  text.textContent = message;

  body.appendChild(src);
  body.appendChild(text);
  wrap.appendChild(icon);
  wrap.appendChild(body);
  messages.appendChild(wrap);
  messages.scrollTop = messages.scrollHeight;
}

function showCriticalOverlay(source, message) {
  // Remove any existing overlay first
  document.querySelectorAll('.critical-overlay').forEach(el => el.remove());
  const overlay = document.createElement('div');
  overlay.className = 'critical-overlay';
  overlay.innerHTML = '<div class="critical-box">'
    + '<h2>CRITICAL ERROR</h2>'
    + '<pre></pre>'
    + '<button>Acknowledge</button>'
    + '</div>';
  overlay.querySelector('pre').textContent = '[' + source + '] ' + message;
  overlay.querySelector('button').addEventListener('click', () => overlay.remove());
  document.body.appendChild(overlay);
  setStatus('CRITICAL ERROR: ' + source);
}

function setStatus(text) {
  statusLine.textContent = text;
}

// ── Notice bar ─────────────────────────────────────────────────────────────
const noticeBar = document.getElementById('notice-bar');
noticeBar?.addEventListener('click', () => {
  if (noticeBar) { noticeBar.style.display = 'none'; noticeBar.textContent = ''; }
});
window.addEventListener('message', (event) => {
  const msg = event.data;
  if (msg.type === 'notice' && noticeBar) {
    noticeBar.className = msg.level || 'warn';
    noticeBar.textContent = msg.text;
    noticeBar.style.display = 'block';
  }
}, true);

// ── Sidebar toggle ─────────────────────────────────────────────────────────
const sidebar = document.getElementById('sidebar');
const sidebarToggleBtn = document.getElementById('sidebar-toggle-btn');
const _uiState = vscode.getState() || {};
let sidebarVisible = _uiState.sidebarVisible ?? false;  // hidden by default
function applySidebar() {
  if (sidebar) sidebar.style.display = sidebarVisible ? 'flex' : 'none';
  if (sidebarToggleBtn) sidebarToggleBtn.style.color = sidebarVisible ? 'var(--subtle)' : 'var(--btn-fg)';
}
sidebarToggleBtn?.addEventListener('click', () => {
  sidebarVisible = !sidebarVisible;
  applySidebar();
  vscode.setState({ ...(vscode.getState() || {}), sidebarVisible });
});
applySidebar();

// ── Zoom controls ──────────────────────────────────────────────────────────
let zoomLevel = _uiState.zoomLevel ?? 1.0;
const ZOOM_STEP = 0.1, ZOOM_MIN = 0.6, ZOOM_MAX = 1.8;
const zoomLabel = document.getElementById('zoom-label');
function applyZoom() {
  if (zoomLevel === 1.0) {
    document.body.style.zoom = '';
    document.body.style.height = '';
  } else {
    // Compensate body height so zoomed content still fills exactly the viewport
    document.body.style.zoom = String(zoomLevel);
    document.body.style.height = \`\${(100 / zoomLevel).toFixed(3)}vh\`;
  }
  if (zoomLabel) zoomLabel.textContent = Math.round(zoomLevel * 100) + '%';
}
document.getElementById('zoom-in-btn')?.addEventListener('click', () => {
  zoomLevel = Math.min(ZOOM_MAX, Math.round((zoomLevel + ZOOM_STEP) * 10) / 10);
  applyZoom();
  vscode.setState({ ...(vscode.getState() || {}), zoomLevel });
});
document.getElementById('zoom-out-btn')?.addEventListener('click', () => {
  zoomLevel = Math.max(ZOOM_MIN, Math.round((zoomLevel - ZOOM_STEP) * 10) / 10);
  applyZoom();
  vscode.setState({ ...(vscode.getState() || {}), zoomLevel });
});
applyZoom();

// ── Session sidebar ────────────────────────────────────────────────────────
const sessionList = document.getElementById('session-list');
const newSessionBtn = document.getElementById('new-session-btn');
let activeSessionId = null;

function renderSessions(sessions) {
  if (!sessionList) return;
  sessionList.innerHTML = '';
  for (const s of sessions) {
    const item = document.createElement('div');
    item.className = 'session-item' + (s.id === activeSessionId ? ' active' : '');
    item.dataset.id = s.id;

    const title = document.createElement('span');
    title.className = 'session-title';
    title.textContent = s.title;
    title.title = s.title;

    const del = document.createElement('button');
    del.className = 'session-delete';
    del.textContent = '×';
    del.title = 'Delete session';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      vscode.postMessage({ type: 'deleteSession', id: s.id });
    });

    item.appendChild(title);
    item.appendChild(del);
    item.addEventListener('click', () => {
      vscode.postMessage({ type: 'loadSession', id: s.id });
    });
    // Double-click title to rename inline
    title.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.value = s.title;
      inp.style.cssText = 'width:100%;background:var(--input-bg);color:var(--input-fg);border:1px solid var(--btn-bg);border-radius:2px;padding:1px 4px;font-size:11px;';
      title.replaceWith(inp);
      inp.focus();
      inp.select();
      const commit = () => {
        const newTitle = inp.value.trim() || s.title;
        if (newTitle !== s.title) vscode.postMessage({ type: 'renameSession', id: s.id, title: newTitle });
        inp.replaceWith(title);
        title.textContent = newTitle;
      };
      inp.addEventListener('blur', commit);
      inp.addEventListener('keydown', (ke) => {
        if (ke.key === 'Enter') { ke.preventDefault(); commit(); }
        if (ke.key === 'Escape') { inp.replaceWith(title); }
      });
    });
    sessionList.appendChild(item);
  }
}

newSessionBtn?.addEventListener('click', () => {
  activeSessionId = null;
  vscode.postMessage({ type: 'newSession' });
});

window.addEventListener('message', (event) => {
  const msg = event.data;
  if (msg.type === 'sessionList') {
    renderSessions(msg.sessions);
  } else if (msg.type === 'sessionCreated') {
    activeSessionId = msg.session.id;
    vscode.setState({ ...(vscode.getState() || {}), activeSessionId });
    vscode.postMessage({ type: 'listSessions' });
  } else if (msg.type === 'sessionLoaded') {
    activeSessionId = msg.id;
    vscode.setState({ ...(vscode.getState() || {}), activeSessionId });
    messages.innerHTML = '';
    for (const m of msg.messages) appendMessage(m);
    setStatus(\`Loaded: \${msg.title}\`);
    vscode.postMessage({ type: 'listSessions' });
  } else if (msg.type === 'historyCleared') {
    activeSessionId = null;
    vscode.setState({ ...(vscode.getState() || {}), activeSessionId: null });
    messages.innerHTML = '';
    setStatus('');
    vscode.postMessage({ type: 'listSessions' });
  }
}, true);

// Load session list on startup
vscode.postMessage({ type: 'listSessions' });

// ── HME shim status ────────────────────────────────────────────────────────
const shimStatus = document.getElementById('shim-status');
function checkShim() {
  vscode.postMessage({ type: 'checkHmeShim' });
}
window.addEventListener('message', (event) => {
  if (event.data.type === 'hmeShimStatus') {
    if (shimStatus) {
      shimStatus.textContent = event.data.ready ? 'HME ●' : event.data.failed ? 'HME ✗' : 'HME ○';
      shimStatus.style.color = event.data.ready ? 'var(--route-hybrid)' : event.data.failed ? 'var(--error-fg)' : 'var(--subtle)';
      shimStatus.title = event.data.ready ? 'HME KB shim: ready' : event.data.failed ? 'HME KB shim: FAILED — see chat for error' : 'HME KB shim: starting…';
    }
  }
}, true);
// Check on load and when switching to hybrid
checkShim();
// Always check shim on load (claude route always active)
checkShim();
</script>
</body>
</html>`;
}
