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
const routerClaude_1 = require("./routers/routerClaude");
const ShimSupervisor_1 = require("./panel/ShimSupervisor");
const ContextMeter_1 = require("./panel/ContextMeter");
const ChainPerformer_1 = require("./panel/ChainPerformer");
const StreamPersister_1 = require("./panel/StreamPersister");
const webviewMessages_1 = require("./panel/webviewMessages");
const msgHelpers_1 = require("./msgHelpers");
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
        // Per-client last-activity timestamp. A stuck client (laptop closed,
        // browser frozen) otherwise lives forever — res.write queues into
        // kernel buffers that never drain, holding the panel alive and
        // slowing every broadcast. Clients idle > SSE_IDLE_MS are removed.
        this._sseClientSeen = new WeakMap();
        // Authoritative Claude config — kept in sync with the browser UI via setClaudeConfig.
        // Send/queue messages fall back to this if they omit the fields (they shouldn't, but
        // it means the server state is the source of truth, not the browser payload).
        this._claudeConfig = { model: "sonnet", effort: "high", thinking: false };
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
                    // Cap the queue depth so a stuck stream + spamming send button
                    // can't grow unbounded memory. 10 is generous for human pace and
                    // tight enough to surface "your stream is hung" instead of
                    // silently buffering 5000 messages.
                    const QUEUE_LIMIT = 10;
                    if (this._messageQueue.length >= QUEUE_LIMIT) {
                        this.postError("queue", `Message queue full (${QUEUE_LIMIT} pending). The current stream may be stuck — cancel and retry.`);
                        return;
                    }
                    const queuedUserMsg = {
                        id: (0, streamUtils_1.uid)(), role: "user", text: msg.text, route: msg.route, ts: Date.now(),
                    };
                    this.post({ type: "message", message: queuedUserMsg });
                    this._messageQueue.push({ ...msg, _queuedUserMsg: queuedUserMsg });
                    // Surface queue depth + warning when stream may be stuck.
                    const depth = this._messageQueue.length;
                    this.post({ type: "queueStatus", pending: depth, limit: QUEUE_LIMIT });
                    if (depth >= QUEUE_LIMIT - 2) {
                        this.post({
                            type: "queueAlert", pending: depth, limit: QUEUE_LIMIT,
                            reason: "current stream may be stuck",
                        });
                    }
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
                // Ghost-message cleanup: remove the trailing partially-streamed
                // assistant message from state so the UI doesn't show a half-written
                // orphan that can't be edited or continued. Persister flushed the
                // partial earlier for crash-safety; on user cancel we drop it.
                const last = this._state.messages[this._state.messages.length - 1];
                if (last && last.role === "assistant" && last.id) {
                    const removedId = last.id;
                    this._state.messages.pop();
                    this.post({ type: "messageRemoved", id: removedId });
                }
                this.post({ type: "cancelConfirmed" });
                this._isStreaming = false;
            },
            drainQueue: () => {
                // Explicit user-initiated queue drain. Use this when the UI shows
                // a queueAlert — preserves the in-flight stream but discards all
                // queued pending messages so the user can retype from a clean state.
                const dropped = this._messageQueue.length;
                this._messageQueue = [];
                this.post({ type: "queueStatus", pending: 0, limit: 10 });
                this.post({ type: "notice", level: "info", text: `Queue drained (${dropped} message${dropped === 1 ? "" : "s"} discarded).` });
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
            checkArbiterHealth: () => {
                // Surface arbiter daemon health to the webview so the user can see
                // whether route=auto is genuinely classifying or silently falling
                // back to Claude because the daemon is unreachable.
                const health = (0, Arbiter_1.getArbiterHealth)();
                this.post({
                    type: "arbiterHealth",
                    healthy: health.healthy,
                    consecutiveFailures: health.consecutiveFailures,
                    lastOkMs: health.lastOkMs,
                });
            },
            setZoomLevel: (_msg) => {
                // No-op: browser uses localStorage for zoom persistence
            },
            setMirrorMode: (_msg) => {
                // No-op: mirror terminal not available in browser mode
            },
            setClaudeConfig: (msg) => {
                try {
                    const validated = (0, msgHelpers_1.validateClaudeConfig)({
                        model: msg.claudeModel,
                        effort: msg.claudeEffort,
                        thinking: msg.claudeThinking,
                    });
                    this._claudeConfig = validated;
                    const resolved = (0, msgHelpers_1.resolveClaudeConfig)(validated);
                    this.post({
                        type: "claudeConfigApplied",
                        alias: resolved.alias,
                        modelId: resolved.modelId,
                        effort: resolved.cliEffort,
                        thinking: resolved.thinking,
                    });
                }
                catch (e) {
                    this.postError("config", `setClaudeConfig rejected: ${e?.message ?? e}`);
                    // Re-broadcast current server-side config so the browser can reconcile.
                    const resolved = (0, msgHelpers_1.resolveClaudeConfig)(this._claudeConfig);
                    this.post({
                        type: "claudeConfigApplied",
                        alias: resolved.alias,
                        modelId: resolved.modelId,
                        effort: resolved.cliEffort,
                        thinking: resolved.thinking,
                        rejected: true,
                    });
                }
            },
        };
        /**
         * Serialize writes to disk via a Promise chain so concurrent
         * _persistState() calls (agent-mode completion + user send during
         * chain rotation + SSE post) can't race. Each call returns a
         * Promise that resolves after the write completes.
         */
        this._persistChain = Promise.resolve();
        this._projectRoot = projectRoot;
        this._restoreSessionId = restoreSessionId ?? null;
        this._errorSink = new ErrorSink_1.ErrorSink(projectRoot);
        // Route sanitizer/computeTurnUsage rejections (invalid contextWindow,
        // out-of-range usedPct, etc.) through hme-errors.log so they surface in
        // the next turn's userpromptsubmit banner. console.error alone vanishes.
        (0, routerClaude_1.setSanitizerErrorSink)(this._errorSink);
        // Turn-number provider lets the sanitizer flag "95%+ on turn 1-2" as
        // suspicious_pct (the signature of the 1M-vs-200k miscalc). Count user
        // messages so assistant responses and tool returns don't inflate it.
        (0, routerClaude_1.setTurnNumberProvider)(() => this._state.messages.filter(m => m.role === "user").length);
        this._shim = new ShimSupervisor_1.ShimSupervisor(projectRoot, this);
        this._contextMeter = new ContextMeter_1.ContextMeter(projectRoot, this, this._errorSink);
        this._chain = new ChainPerformer_1.ChainPerformer(projectRoot, this, this._chainBridge(), this._errorSink);
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
                // Hard timeout so a hung daemon doesn't stall the chat. Every 3 turns
                // the narrative callback fires; a 3s ceiling keeps the chat snappy
                // even when the synthesis backend is degraded. On timeout we return
                // an empty string — the next attempt will try again with fresh state.
                const NARRATIVE_TIMEOUT_MS = 3000;
                const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve(""), NARRATIVE_TIMEOUT_MS));
                let narrative = "";
                try {
                    narrative = await Promise.race([(0, Arbiter_1.synthesizeNarrative)(entries), timeoutPromise]);
                }
                catch (e) {
                    console.error(`[HME] narrative-synthesis skipped: ${e?.message ?? e}`);
                    return "";
                }
                if (!narrative) {
                    // Either timeout fired or the daemon returned empty — record so the
                    // user can investigate if this becomes chronic, but don't block.
                    console.error(`[HME] narrative-synthesis returned empty (timeout=${NARRATIVE_TIMEOUT_MS}ms or daemon empty)`);
                    return "";
                }
                (0, router_1.postTranscript)([{ ts: Date.now(), type: "narrative", content: narrative }])
                    .catch((e) => this.postError("narrative", String(e)));
                return narrative;
            });
        }
        catch (e) {
            console.error(`[HME] TranscriptLogger init failed — transcript disabled: ${e?.message ?? e}`);
            this._transcript = (0, TranscriptLogger_1.nullTranscript)();
        }
    }
    registerSseClient(res) {
        this._sseClients.push(res);
        this._sseClientSeen.set(res, Date.now());
        // Send any pending restore on first connect
        if (this._restoreSessionId) {
            const id = this._restoreSessionId;
            this._restoreSessionId = null;
            setImmediate(() => this._loadSession(id));
        }
    }
    unregisterSseClient(res) {
        this._sseClients = this._sseClients.filter(c => c !== res);
        this._sseClientSeen.delete(res);
    }
    //  PanelHost implementation
    post(data) {
        const payload = `data: ${JSON.stringify(data)}\n\n`;
        const now = Date.now();
        console.log(`[HME→SSE] type=${data?.type ?? '?'} clients=${this._sseClients.length}`);
        // Remove idle clients opportunistically so a stream of posts
        // self-heals a client registry that accumulates orphans.
        const stillAlive = [];
        for (const res of this._sseClients) {
            const lastSeen = this._sseClientSeen.get(res) ?? 0;
            if (now - lastSeen > BrowserPanel._SSE_IDLE_MS) {
                try {
                    res.end();
                }
                catch { /* silent-ok: already dead */ }
                this._sseClientSeen.delete(res);
                continue;
            }
            try {
                res.write(payload);
                this._sseClientSeen.set(res, now);
                stillAlive.push(res);
            }
            catch (e) {
                // Write failed — client's TCP window is stuck or socket is dead.
                // Drop it; the browser will reconnect if still interested.
                console.error(`[HME] SSE write failed, dropping client: ${e?.message ?? e}`);
                try {
                    res.end();
                }
                catch { /* silent-ok: already broken */ }
                this._sseClientSeen.delete(res);
            }
        }
        this._sseClients = stillAlive;
    }
    postError(source, message) {
        console.error(`[HME] postError [${source}]: ${message}`);
        this._errorSink.post(source, message);
        this.post({ type: "errorBubble", source, message });
    }
    //  Extracted-component support
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
            getModelId: () => this._contextMeter.cliModelId,
            hasMeterLiveUpdate: () => this._contextMeter.hasLiveUpdate,
            rotate: (continuationMsg, newChainIndex) => {
                this._applyStateChange((s) => {
                    s.messages = [];
                    s.claudeSessionId = null;
                    s.chainIndex = newChainIndex;
                    s.messages.push(continuationMsg);
                });
                this._contextMeter.resetSilently();
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
    //  Incoming message dispatch (from Express POST /api/message)
    handleMessage(msg) {
        console.log(`[HME] handleMessage type=${msg?.type} clients=${this._sseClients.length}`);
        try {
            (0, webviewMessages_1.dispatchWebviewMessage)(msg, this._messageHandlers);
        }
        catch (e) {
            console.error(`[HME] handleMessage threw: ${e?.message ?? e}\n${e?.stack}`);
            this.post({ type: "errorBubble", source: "dispatch", message: String(e?.message ?? e) });
        }
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
            return this._persistChain;
        // Snapshot state at call time — the write may happen later and
        // we want the snapshot to reflect the moment of the call.
        const entry = {
            ...this._state.sessionEntry,
            claudeSessionId: this._state.claudeSessionId,
            updatedAt: Date.now(),
        };
        this._state.sessionEntry = entry;
        const messages = [...this._state.messages];
        const llamacppHistory = [...this._state.llamacppHistory];
        const opts = {
            contextTokens: this._contextMeter.pctUsed,
            chainIndex: this._state.chainIndex,
        };
        this._persistChain = this._persistChain.then(() => {
            try {
                (0, SessionStore_1.saveSession)(this._projectRoot, entry, messages, llamacppHistory, opts);
            }
            catch (e) {
                console.error(`[HME] saveSession failed: ${e?.message ?? e}`);
            }
        });
        return this._persistChain;
    }
    /**
     * Canonical state-mutation broker. Every caller that modifies this._state
     * SHOULD go through here so (a) mutations are visible in one place for
     * debugging, (b) persistence is automatic, (c) concurrent callers
     * serialize through _persistChain instead of writing in parallel.
     * Pass persist=false when the mutation is transient (e.g. chainIndex
     * bump that the next _persistState() will pick up anyway).
     */
    _applyStateChange(mutate, persist = true) {
        mutate(this._state);
        if (persist) {
            void this._persistState();
        }
    }
    //  Send pipeline
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
            else {
                // Surface the fallback. Hidden auto-route failures erode trust in
                // routing decisions — a user who thinks they're hitting a local
                // model but is actually paying Claude API costs needs to know.
                this.post({
                    type: "notice", level: "warn",
                    text: `⚠ Auto-route unavailable — falling back to ${decision.route}. (${decision.reason || "arbiter unreachable"})`,
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
        // Server-side config is authoritative: overwrite msg fields from stored _claudeConfig
        // so the Claude CLI always runs with exactly what the server last confirmed. This
        // prevents UI/server drift if the browser's state gets out of sync.
        const resolvedCfg = (0, msgHelpers_1.resolveClaudeConfig)(this._claudeConfig);
        msg.claudeModel = resolvedCfg.modelId;
        msg.claudeEffort = resolvedCfg.cliEffort;
        msg.claudeThinking = resolvedCfg.thinking;
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
        this._applyStateChange((s) => { s.messages.push(userMsg); });
        if (!msg._queuedUserMsg) {
            this.post({ type: "message", message: userMsg });
        }
        if (this._state.lastRoute && this._state.lastRoute !== resolvedRoute) {
            this._transcript.logRouteSwitch(this._state.lastRoute, resolvedRoute);
        }
        const cross = (0, crossRouteHistory_1.buildCrossRouteContext)(this._state.messages, this._state.lastRoute, resolvedRoute);
        // applyCrossRouteContext mutates state in-place + returns the prefix.
        // Route through the broker so the persist path is uniform.
        let contextPrefix = "";
        this._applyStateChange((s) => {
            contextPrefix = (0, crossRouteHistory_1.applyCrossRouteContext)(s, cross);
            s.lastRoute = resolvedRoute;
        });
        const assistantId = (0, streamUtils_1.uid)();
        const streamStartExtras = resolvedRoute === "claude"
            ? { effort: resolvedCfg.cliEffort, thinking: resolvedCfg.thinking }
            : {};
        this.post({ type: "streamStart", id: assistantId, route: resolvedRoute, model, ...streamStartExtras });
        const resolvedMsg = { ...msg, _resolvedRoute: resolvedRoute, _contextPrefix: contextPrefix };
        const ctx = this._ctx;
        try {
            if (resolvedRoute === "local") {
                console.log(`[HME] calling streamLlamacppMsg`);
                (0, chatStreaming_1.streamLlamacppMsg)(ctx, resolvedMsg, assistantId);
            }
            else if (resolvedRoute === "hybrid") {
                console.log(`[HME] calling streamHybridMsg`);
                (0, chatStreaming_1.streamHybridMsg)(ctx, resolvedMsg, assistantId);
            }
            else {
                console.log(`[HME] calling streamClaudeMsg`);
                (0, chatStreaming_1.streamClaudeMsg)(ctx, resolvedMsg, assistantId);
            }
        }
        catch (e) {
            console.error(`[HME] stream call threw synchronously: ${e?.message ?? e}\n${e?.stack}`);
            this.post({ type: "errorBubble", source: resolvedRoute, message: String(e?.message ?? e) });
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
        this._applyStateChange((s) => { s.messages.push(userMsg); });
        this.post({ type: "message", message: userMsg });
        this.post({ type: "notice", level: "info", text: "🤖 Agent mode: running local + hybrid in parallel…" });
        const localId = (0, streamUtils_1.uid)();
        const hybridId = (0, streamUtils_1.uid)();
        this.post({ type: "streamStart", id: localId, route: "local", model: `[local] ${msg.llamacppModel}` });
        this.post({ type: "streamStart", id: hybridId, route: "hybrid", model: `[hybrid] ${msg.llamacppModel}` });
        // Agent-mode runs local + hybrid in parallel. Each stream calls
        // checkBothDone exactly once on completion. JS is single-threaded
        // so ++doneCount is atomic per-microtask, BUT a rogue double-call
        // from either stream (e.g. onDone + onError firing on the same
        // abort) would trip the >= 2 gate early. A Set of seen labels
        // makes the completion set explicit and idempotent.
        const seenDone = new Set();
        let drained = false;
        let persisted = false;
        const cancelFns = [];
        const safeDrain = () => { if (!drained) {
            drained = true;
            this._drainQueue();
        } };
        const markDone = (label) => {
            if (seenDone.has(label))
                return;
            seenDone.add(label);
            if (seenDone.size >= 2 && !persisted) {
                persisted = true;
                this._persistState();
                safeDrain();
            }
        };
        this._cancelCurrent = () => cancelFns.forEach((fn) => fn());
        const ctx = this._ctx;
        (0, chatStreaming_1.streamAgentMsg)(ctx, msg, localId, "local", () => markDone("local"), () => markDone("local"), cancelFns);
        (0, chatStreaming_1.streamAgentHybridMsg)(ctx, msg, hybridId, "hybrid", () => markDone("hybrid"), () => markDone("hybrid"), cancelFns);
    }
    //  Queue & cleanup
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
        // Fire-and-forget the final narrative. Previously we awaited up to 5s —
        // with the narrative callback now capped at 3s per call, there's nothing
        // left to wait for here: the final narrative either completes within its
        // own budget or gives up. Blocking dispose on it only delays tab close.
        this._transcript.forceNarrative?.();
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
//  SSE client registry
// 5 minutes of no writes at all = client is almost certainly gone.
// The sweep runs on post() so we don't need a persistent timer.
BrowserPanel._SSE_IDLE_MS = 5 * 60 * 1000;
//  Stream tracking & session persistence
BrowserPanel.DISPLAY_CAP = 100;
