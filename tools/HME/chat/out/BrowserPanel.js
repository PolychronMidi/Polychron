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
exports.BrowserPanel = void 0;
const path = __importStar(require("path"));
const router_1 = require("./router");
const SessionStore_1 = require("./session/SessionStore");
const TranscriptLogger_1 = require("./session/TranscriptLogger");
const Arbiter_1 = require("./Arbiter");
const streamUtils_1 = require("./streamUtils");
const chatStreaming_1 = require("./chatStreaming");
const crossRouteHistory_1 = require("./session/crossRouteHistory");
const ErrorSink_1 = require("./panel/ErrorSink");
const ShimSupervisor_1 = require("./panel/ShimSupervisor");
const ContextMeter_1 = require("./panel/ContextMeter");
const ChainPerformer_1 = require("./panel/ChainPerformer");
const StreamPersister_1 = require("./panel/StreamPersister");
const webviewMessages_1 = require("./panel/webviewMessages");
class BrowserPanel {
    static _blankState() {
        return { messages: [], claudeSessionId: null, llamacppHistory: [], lastRoute: null, sessionEntry: null, chainIndex: 0 };
    }
    constructor(projectRoot, restoreSessionId) {
        this._state = BrowserPanel._blankState();
        this._isStreaming = false;
        this._messageQueue = [];
        this._restoreSessionId = null;
        this._disposed = false;
        this._sseClients = [];
        this._messageHandlers = {
            send: (msg) => {
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
            clearHistory: () => {
                this._state = BrowserPanel._blankState();
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
                    this._state = BrowserPanel._blankState();
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
                this._state = BrowserPanel._blankState();
                this._contextMeter.reset(this._ctxArgs());
                this.post({ type: "historyCleared" });
            },
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
            setZoomLevel: (_msg) => {
                // No-op: browser uses localStorage for zoom persistence
            },
            setMirrorMode: (_msg) => {
                // No-op: mirror terminal not available in browser mode
            },
        };
        this._projectRoot = projectRoot;
        this._restoreSessionId = restoreSessionId ?? null;
        this._errorSink = new ErrorSink_1.ErrorSink(projectRoot);
        this._shim = new ShimSupervisor_1.ShimSupervisor(projectRoot, this);
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
    }
    // ── SSE client registry ──────────────────────────────────────────────────
    registerSseClient(res) {
        this._sseClients.push(res);
        // Send any pending restore on first connect
        if (this._restoreSessionId) {
            const id = this._restoreSessionId;
            this._restoreSessionId = null;
            setImmediate(() => this._loadSession(id));
        }
    }
    unregisterSseClient(res) {
        this._sseClients = this._sseClients.filter(c => c !== res);
    }
    // ── PanelHost implementation ─────────────────────────────────────────────
    post(data) {
        const payload = `data: ${JSON.stringify(data)}\n\n`;
        for (const res of this._sseClients) {
            try {
                res.write(payload);
            }
            catch { /* client disconnected */ }
        }
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
    static createOrShow(projectRoot) {
        if (BrowserPanel.current)
            return BrowserPanel.current;
        BrowserPanel.current = new BrowserPanel(projectRoot);
        return BrowserPanel.current;
    }
    // ── Incoming message dispatch (from Express POST /api/message) ───────────
    handleMessage(msg) {
        (0, webviewMessages_1.dispatchWebviewMessage)(msg, this._messageHandlers);
    }
    _displayMessages() {
        return this._state.messages.slice(-BrowserPanel.DISPLAY_CAP);
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
        let resolvedRoute;
        if (msg.route === "auto") {
            this.post({ type: "notice", level: "info", text: "🔀 Auto-routing…" });
            const transcriptContext = this._state.messages.slice(-6)
                .map((m) => `${m.role}: ${m.text.slice(0, 100)}`).join("\n");
            const decision = await (0, Arbiter_1.classifyMessage)(msg.text, transcriptContext, 0);
            resolvedRoute = decision.route;
            if (!decision.isError) {
                const label = decision.escalated ? `⬆ escalated to ${decision.route}` : decision.route;
                this.post({
                    type: "notice", level: "info",
                    text: `🔀 → ${label} (${Math.round(decision.confidence * 100)}% — ${decision.reason})`,
                });
            }
        }
        else {
            resolvedRoute = msg.route;
        }
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
    // ── Queue & cleanup ──────────────────────────────────────────────────────
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
    getHtmlPath() {
        return path.join(__dirname, "..", "webview", "browser.html");
    }
    async dispose() {
        if (this._disposed)
            return;
        this._disposed = true;
        this._cancelCurrent?.();
        this._cancelCurrent = undefined;
        this._messageQueue = [];
        this._isStreaming = false;
        BrowserPanel.current = undefined;
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
        for (const res of this._sseClients) {
            try {
                res.end();
            }
            catch { /* ignore */ }
        }
        this._sseClients = [];
    }
}
exports.BrowserPanel = BrowserPanel;
// ── Stream tracking & session persistence ────────────────────────────────
BrowserPanel.DISPLAY_CAP = 100;
