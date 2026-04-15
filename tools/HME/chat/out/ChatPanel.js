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
const chatStreaming_1 = require("./chatStreaming");
const crossRouteHistory_1 = require("./crossRouteHistory");
const ErrorSink_1 = require("./panel/ErrorSink");
const ShimSupervisor_1 = require("./panel/ShimSupervisor");
const MirrorTerminal_1 = require("./panel/MirrorTerminal");
const ContextMeter_1 = require("./panel/ContextMeter");
const ChainPerformer_1 = require("./panel/ChainPerformer");
const StreamPersister_1 = require("./panel/StreamPersister");
const webviewMessages_1 = require("./panel/webviewMessages");
class ChatPanel {
    static _blankState() {
        return { messages: [], claudeSessionId: null, llamacppHistory: [], lastRoute: null, sessionEntry: null, chainIndex: 0 };
    }
    constructor(panel, projectRoot, restoreSessionId) {
        this._state = ChatPanel._blankState();
        this._isStreaming = false;
        this._messageQueue = [];
        this._disposables = [];
        this._restoreSessionId = null;
        this._disposed = false;
        // ── Webview message dispatch ─────────────────────────────────────────────
        this._messageHandlers = {
            // ── Stream control ───────────────────────────────────────────────────
            send: (msg) => {
                // Hard interrupt: cancel current stream + clear queue, start new message immediately.
                if (this._isStreaming) {
                    this._cancelCurrent?.();
                    this._cancelCurrent = undefined;
                    this._messageQueue = [];
                    this.post({ type: "cancelConfirmed" });
                    this._isStreaming = false;
                }
                this._isStreaming = true;
                this._onSend(msg).catch((e) => {
                    this.postError("send", String(e));
                    this._drainQueue();
                });
            },
            queue: (msg) => {
                // Queue: waits behind current stream (explicit "send after current finishes").
                if (this._isStreaming) {
                    const queuedUserMsg = {
                        id: (0, streamUtils_1.uid)(), role: "user", text: msg.text, route: msg.route, ts: Date.now(),
                    };
                    this.post({ type: "message", message: queuedUserMsg });
                    this._messageQueue.push({ ...msg, _queuedUserMsg: queuedUserMsg });
                }
                else {
                    this._isStreaming = true;
                    this._onSend(msg).catch((e) => {
                        this.postError("send", String(e));
                        this._drainQueue();
                    });
                }
            },
            cancel: () => {
                this._cancelCurrent?.();
                this._cancelCurrent = undefined;
                this._messageQueue = [];
                this.post({ type: "cancelConfirmed" });
                this._isStreaming = false;
            },
            // ── Session management ───────────────────────────────────────────────
            clearHistory: () => {
                this._state = ChatPanel._blankState();
                this._contextMeter.reset(this._ctxArgs());
                this.post({ type: "historyCleared" });
            },
            listSessions: () => {
                this.post({ type: "sessionList", sessions: (0, SessionStore_1.listSessions)(this._projectRoot) });
                if (this._restoreSessionId) {
                    const id = this._restoreSessionId;
                    this._restoreSessionId = null;
                    this._loadSession(id);
                }
            },
            loadSession: (msg) => this._loadSession(msg.id),
            deleteSession: (msg) => {
                (0, SessionStore_1.deleteSession)(this._projectRoot, msg.id);
                if (this._state.sessionEntry?.id === msg.id) {
                    this._state = ChatPanel._blankState();
                    this._contextMeter.reset(this._ctxArgs());
                    this._transcript.setSessionId("");
                    this.post({ type: "historyCleared" });
                }
                this.post({ type: "sessionList", sessions: (0, SessionStore_1.listSessions)(this._projectRoot) });
            },
            renameSession: (msg) => {
                (0, SessionStore_1.renameSession)(this._projectRoot, msg.id, msg.title);
                this.post({ type: "sessionList", sessions: (0, SessionStore_1.listSessions)(this._projectRoot) });
            },
            newSession: () => {
                this._state = ChatPanel._blankState();
                this._contextMeter.reset(this._ctxArgs());
                this.post({ type: "historyCleared" });
            },
            // ── HME features ─────────────────────────────────────────────────────
            enrichPrompt: (msg) => {
                this.post({ type: "enrichStatus", status: "enriching" });
                (0, router_1.enrichPrompt)(msg.prompt, msg.frame ?? "").then((result) => {
                    this.post({ type: "enrichResult", ...result });
                }).catch((e) => {
                    this.post({
                        type: "enrichResult", enriched: msg.prompt, original: msg.prompt,
                        error: String(e), unchanged: true,
                    });
                });
            },
            checkHmeShim: () => {
                (0, router_1.isHmeShimReady)().then(({ ready }) => {
                    this.post({ type: "hmeShimStatus", ready, failed: !ready && this._shim.failed });
                    if (!ready)
                        this._shim.start();
                });
            },
            // ── UI state ─────────────────────────────────────────────────────────
            setZoomLevel: (msg) => {
                if (typeof msg.level === "number") {
                    ChatPanel._globalState?.update("hme.zoomLevel", msg.level);
                }
            },
            setMirrorMode: (msg) => {
                const enabled = !!msg.enabled;
                this._mirror.setEnabled(enabled, msg.model || "claude-sonnet-4-6", msg.effort || "high");
                this.post({ type: "mirrorModeChanged", enabled });
            },
        };
        this._panel = panel;
        this._projectRoot = projectRoot;
        this._restoreSessionId = restoreSessionId ?? null;
        // PanelHost methods (post/postError) delegate to the panel via
        // `this.post` / `this.postError` below. The extracted components
        // receive `this` typed as PanelHost to keep the coupling narrow.
        this._errorSink = new ErrorSink_1.ErrorSink(projectRoot);
        this._shim = new ShimSupervisor_1.ShimSupervisor(projectRoot, this);
        this._mirror = new MirrorTerminal_1.MirrorTerminal(projectRoot);
        this._contextMeter = new ContextMeter_1.ContextMeter(projectRoot, this);
        this._chain = new ChainPerformer_1.ChainPerformer(projectRoot, this, this._chainBridge());
        this._streamPersister = new StreamPersister_1.StreamPersister(this);
        const self = this;
        this._ctx = {
            get projectRoot() { return self._projectRoot; },
            get transcript() { return self._transcript; },
            get state() { return self._state; },
            post: (data) => self.post(data),
            postError: (s, m) => self.postError(s, m),
            drainQueue: () => self._drainQueue(),
            trackStream: (id, r) => self._trackStream(id, r),
            updateContextTracker: (t, th, m, u) => self._contextMeter.update(t, th, m, u, self._ctxArgs()),
            checkChainThreshold: () => self._chain.maybeChain(),
            setCancelCurrent: (fn) => { self._cancelCurrent = fn; },
        };
        try {
            this._transcript = new TranscriptLogger_1.TranscriptLogger(projectRoot);
            this._transcript.setNarrativeCallback(async (entries) => {
                try {
                    const narrative = await (0, Arbiter_1.synthesizeNarrative)(entries);
                    if (narrative) {
                        (0, router_1.postTranscript)([{ ts: Date.now(), type: "narrative", content: narrative }])
                            .catch((e) => this.postError("narrative", String(e)));
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
        this._panel.webview.onDidReceiveMessage((msg) => (0, webviewMessages_1.dispatchWebviewMessage)(msg, this._messageHandlers), null, this._disposables);
        // retainContextWhenHidden keeps the webview alive when the tab is hidden —
        // scroll position, model/effort/thinking controls, and streaming state are
        // all preserved automatically. Only refresh the context meter on show.
        this._panel.onDidChangeViewState(() => {
            if (this._panel.visible) {
                this._contextMeter.post(this._ctxArgs());
            }
        }, null, this._disposables);
    }
    // ── PanelHost implementation ─────────────────────────────────────────────
    post(data) {
        this._panel.webview.postMessage(data);
    }
    postError(source, message) {
        this._errorSink.post(source, message);
    }
    // ── Extracted-component support ──────────────────────────────────────────
    _ctxArgs() {
        return {
            sessionId: this._state.sessionEntry?.id ?? null,
            chainIndex: this._state.chainIndex,
        };
    }
    _chainBridge() {
        return {
            getSessionId: () => this._state.sessionEntry?.id ?? null,
            getMessages: () => this._state.messages,
            getChainIndex: () => this._state.chainIndex,
            getClaudeSessionId: () => this._state.claudeSessionId,
            getContextPct: () => this._contextMeter.pctUsed,
            rotate: (continuationMsg, newChainIndex) => {
                // Rotate session state without firing the context meter post — the
                // ChainPerformer will request a final post after chainCompleted + notice
                // so the webview sees events in the original order.
                this._state.messages = [];
                this._state.claudeSessionId = null;
                this._state.chainIndex = newChainIndex;
                this._contextMeter.resetSilently();
                this._state.messages.push(continuationMsg);
                this._persistState();
            },
            postContextUpdate: () => this._contextMeter.post(this._ctxArgs()),
        };
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
        const panel = vscode.window.createWebviewPanel("hmeChat", "HME Chat", col || vscode.ViewColumn.One, { enableScripts: true, retainContextWhenHidden: true });
        ChatPanel.current = new ChatPanel(panel, projectRoot);
    }
    static deserialize(panel, state, projectRoot) {
        const restoreSessionId = state?.activeSessionId;
        ChatPanel.current = new ChatPanel(panel, projectRoot, restoreSessionId);
    }
    _displayMessages() {
        return this._state.messages.slice(-ChatPanel.DISPLAY_CAP);
    }
    _trackStream(assistantId, route) {
        return this._streamPersister.track(assistantId, route, this._state.messages, () => this._persistState());
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
            llamacppHistory: persisted.llamacppHistory,
            lastRoute: null,
            sessionEntry: persisted.entry,
            chainIndex,
        };
        this._contextMeter.reset(this._ctxArgs(), persisted.contextTokens);
        this._transcript.setSessionId(persisted.entry.id);
        this._transcript.logSessionStart(persisted.entry.id, persisted.entry.title, true);
        const display = this._displayMessages();
        const pruned = display.length < persisted.messages.length;
        this.post({ type: "sessionLoaded", id: persisted.entry.id, messages: display, title: persisted.entry.title });
        if (pruned) {
            this.post({
                type: "notice", level: "info",
                text: `Showing last ${display.length} of ${persisted.messages.length} messages`,
            });
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
        (0, SessionStore_1.saveSession)(this._projectRoot, entry, this._state.messages, this._state.llamacppHistory, {
            contextTokens: this._contextMeter.pctUsed,
            chainIndex: this._state.chainIndex,
        });
    }
    // ── Send pipeline ────────────────────────────────────────────────────────
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
            this.post({ type: "sessionCreated", session: entry });
        }
        const model = resolvedRoute === "local" || resolvedRoute === "hybrid" ? msg.llamacppModel : msg.claudeModel;
        this._transcript.logUser(msg.text, resolvedRoute, model);
        (0, router_1.validateMessage)(msg.text).then(({ warnings, blocks }) => {
            this._transcript.logValidation(msg.text, warnings.length, blocks.length);
            if (blocks.length > 0) {
                const notice = blocks.map((b) => `⛔ [${b.title}] ${b.content}`).join("\n");
                this.post({ type: "notice", level: "block", text: `HME anti-pattern alert:\n${notice}` });
            }
            else if (warnings.length > 0) {
                const notice = warnings.map((w) => `⚠ [${w.title}]`).join(" · ");
                this.post({ type: "notice", level: "warn", text: `HME constraints: ${notice}` });
            }
        }).catch((e) => this.postError("validation", String(e)));
        (0, router_1.postTranscript)([{
                ts: Date.now(), type: "user", route: resolvedRoute, model,
                content: msg.text, summary: `User [${resolvedRoute}]: ${msg.text.slice(0, 100)}`,
            }]).catch((e) => this.postError("transcript", String(e)));
        const userMsg = msg._queuedUserMsg ?? {
            id: (0, streamUtils_1.uid)(), role: "user", text: msg.text, route: resolvedRoute, ts: Date.now(),
        };
        this._state.messages.push(userMsg);
        this._persistState();
        if (!msg._queuedUserMsg) {
            this.post({ type: "message", message: userMsg });
        }
        // ── Cross-route history portability ──
        if (this._state.lastRoute && this._state.lastRoute !== resolvedRoute) {
            this._transcript.logRouteSwitch(this._state.lastRoute, resolvedRoute);
        }
        const cross = (0, crossRouteHistory_1.buildCrossRouteContext)(this._state.messages, this._state.lastRoute, resolvedRoute);
        const contextPrefix = (0, crossRouteHistory_1.applyCrossRouteContext)(this._state, cross);
        this._state.lastRoute = resolvedRoute;
        const assistantId = (0, streamUtils_1.uid)();
        this.post({ type: "streamStart", id: assistantId, route: resolvedRoute, model });
        const resolvedMsg = { ...msg, _resolvedRoute: resolvedRoute, _contextPrefix: contextPrefix };
        const ctx = this._ctx;
        if (resolvedRoute === "local") {
            (0, chatStreaming_1.streamLlamacppMsg)(ctx, resolvedMsg, assistantId);
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
     * Neither response writes to llamacppHistory to avoid double-appending;
     * local result wins for history after both complete.
     */
    async _onSendAgent(msg) {
        if (!this._state.sessionEntry) {
            const entry = (0, SessionStore_1.createSession)(this._projectRoot, (0, SessionStore_1.deriveTitle)(msg.text));
            this._state.sessionEntry = entry;
            this._transcript.setSessionId(entry.id);
            this._transcript.logSessionStart(entry.id, entry.title, false);
            this.post({ type: "sessionCreated", session: entry });
        }
        this._transcript.logUser(msg.text, "agent", msg.llamacppModel);
        (0, router_1.postTranscript)([{
                ts: Date.now(), type: "user", route: "agent", model: msg.llamacppModel,
                content: msg.text, summary: `User [agent]: ${msg.text.slice(0, 100)}`,
            }]).catch((e) => this.postError("transcript", String(e)));
        const userMsg = { id: (0, streamUtils_1.uid)(), role: "user", text: msg.text, route: "local", ts: Date.now() };
        this._state.messages.push(userMsg);
        this._persistState();
        this.post({ type: "message", message: userMsg });
        this.post({ type: "notice", level: "info", text: "🤖 Agent mode: running local + hybrid in parallel…" });
        const localId = (0, streamUtils_1.uid)();
        const hybridId = (0, streamUtils_1.uid)();
        this.post({ type: "streamStart", id: localId, route: "local", model: `[local] ${msg.llamacppModel}` });
        this.post({ type: "streamStart", id: hybridId, route: "hybrid", model: `[hybrid] ${msg.llamacppModel}` });
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
        const ctx = this._ctx;
        (0, chatStreaming_1.streamAgentMsg)(ctx, msg, localId, "local", checkBothDone, checkBothDone, cancelFns);
        (0, chatStreaming_1.streamAgentHybridMsg)(ctx, msg, hybridId, "hybrid", checkBothDone, checkBothDone, cancelFns);
    }
    // ── Message queue & webview plumbing ─────────────────────────────────────
    _drainQueue() {
        this._isStreaming = false;
        if (this._messageQueue.length > 0) {
            const next = this._messageQueue.shift();
            this._isStreaming = true;
            this._onSend(next).catch((e) => {
                this.postError("send", String(e));
                this.post({ type: "streamEnd", id: "err" });
                this._drainQueue();
            });
        }
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
        this._shim.dispose();
        try {
            this._persistState();
        }
        catch (e) {
            console.error(`[HME] dispose: _persistState failed: ${e?.message ?? e}`);
        }
        const narrativeWork = Promise.resolve(this._transcript.forceNarrative?.());
        const timeout = new Promise((resolve) => setTimeout(resolve, 5000));
        await Promise.race([narrativeWork, timeout]);
        this._panel.dispose();
        this._disposables.forEach((d) => d.dispose());
        this._disposables = [];
    }
}
exports.ChatPanel = ChatPanel;
// ── Stream tracking & session persistence ────────────────────────────────
ChatPanel.DISPLAY_CAP = 100;
