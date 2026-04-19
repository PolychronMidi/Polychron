import * as path from "path";
import * as fs from "fs";
import {
  isHmeShimReady, validateMessage, enrichPrompt, postTranscript,
} from "./router";
import { ChatMessage } from "./types";
import {
  listSessions,
  loadSession,
  createSession,
  saveSession,
  deleteSession,
  renameSession,
  deriveTitle,
  listChainLinks,
} from "./session/SessionStore";
import { TranscriptLogger, nullTranscript } from "./session/TranscriptLogger";
import { synthesizeNarrative, classifyMessage } from "./Arbiter";
import {
  uid,
  SessionState, StreamTracker, ChatCtx,
} from "./streamUtils";
import {
  streamClaudeMsg, streamLlamacppMsg, streamHybridMsg,
  streamAgentMsg, streamAgentHybridMsg,
} from "./chatStreaming";
import { buildCrossRouteContext, applyCrossRouteContext } from "./session/crossRouteHistory";
import { PanelHost } from "./panel/PanelHost";
import { ErrorSink } from "./panel/ErrorSink";
import { setSanitizerErrorSink, setTurnNumberProvider } from "./routers/routerClaude";
import { ShimSupervisor } from "./panel/ShimSupervisor";
import { ContextMeter, ContextPostArgs } from "./panel/ContextMeter";
import { ChainPerformer, ChainSessionBridge } from "./panel/ChainPerformer";
import { StreamPersister } from "./panel/StreamPersister";
import { dispatchWebviewMessage, SendMsg } from "./panel/webviewMessages";
import { validateClaudeConfig, resolveClaudeConfig, ClaudeConfig, ResolvedClaudeConfig } from "./msgHelpers";
import type { Response as ExpressResponse } from "express";

export class BrowserPanel implements PanelHost {
  public static current: BrowserPanel | undefined;
  private readonly _projectRoot: string;
  private _state: SessionState = BrowserPanel._blankState();
  private _cancelCurrent?: () => void;
  private _isStreaming = false;
  private _messageQueue: any[] = [];
  private _transcript: TranscriptLogger;
  private _restoreSessionId: string | null = null;
  private _disposed = false;
  private _sseClients: ExpressResponse[] = [];
  // Authoritative Claude config — kept in sync with the browser UI via setClaudeConfig.
  // Send/queue messages fall back to this if they omit the fields (they shouldn't, but
  // it means the server state is the source of truth, not the browser payload).
  private _claudeConfig: ClaudeConfig = { model: "sonnet", effort: "high", thinking: false };

  //  Extracted components
  private readonly _errorSink: ErrorSink;
  private readonly _shim: ShimSupervisor;
  private readonly _contextMeter: ContextMeter;
  private readonly _chain: ChainPerformer;
  private readonly _streamPersister: StreamPersister;
  private readonly _ctx: ChatCtx;

  private static _blankState(): SessionState {
    return { messages: [], claudeSessionId: null, llamacppHistory: [], lastRoute: null, sessionEntry: null, chainIndex: 0 };
  }

  constructor(projectRoot: string, restoreSessionId?: string) {
    this._projectRoot = projectRoot;
    this._restoreSessionId = restoreSessionId ?? null;

    this._errorSink = new ErrorSink(projectRoot);
    // Route sanitizer/computeTurnUsage rejections (invalid contextWindow,
    // out-of-range usedPct, etc.) through hme-errors.log so they surface in
    // the next turn's userpromptsubmit banner. console.error alone vanishes.
    setSanitizerErrorSink(this._errorSink);
    // Turn-number provider lets the sanitizer flag "95%+ on turn 1-2" as
    // suspicious_pct (the signature of the 1M-vs-200k miscalc). Count user
    // messages so assistant responses and tool returns don't inflate it.
    setTurnNumberProvider(() => this._state.messages.filter(m => m.role === "user").length);
    this._shim = new ShimSupervisor(projectRoot, this);
    this._contextMeter = new ContextMeter(projectRoot, this, this._errorSink);
    this._chain = new ChainPerformer(projectRoot, this, this._chainBridge(), this._errorSink);
    this._streamPersister = new StreamPersister(this);
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
      this._transcript = new TranscriptLogger(projectRoot);
      this._transcript.setNarrativeCallback(async (entries) => {
        try {
          const narrative = await synthesizeNarrative(entries);
          if (narrative) {
            postTranscript([{ ts: Date.now(), type: "narrative", content: narrative }])
              .catch((e: any) => this.postError("narrative", String(e)));
          }
          return narrative;
        } catch (e: any) {
          console.error(`[HME] narrative-synthesis skipped: ${(e as any)?.message ?? e}`);
          return "";
        }
      });
    } catch (e) {
      console.error(`[HME] TranscriptLogger init failed — transcript disabled: ${(e as any)?.message ?? e}`);
      this._transcript = nullTranscript();
    }
  }

  //  SSE client registry

  registerSseClient(res: ExpressResponse): void {
    this._sseClients.push(res);
    // Send any pending restore on first connect
    if (this._restoreSessionId) {
      const id = this._restoreSessionId;
      this._restoreSessionId = null;
      setImmediate(() => this._loadSession(id));
    }
  }

  unregisterSseClient(res: ExpressResponse): void {
    this._sseClients = this._sseClients.filter(c => c !== res);
  }

  //  PanelHost implementation

  public post(data: any): void {
    const payload = `data: ${JSON.stringify(data)}\n\n`;
    console.log(`[HME→SSE] type=${data?.type ?? '?'} clients=${this._sseClients.length}`);
    for (const res of this._sseClients) {
      try { res.write(payload); } catch (e: any) { console.error(`[HME] SSE write failed: ${e?.message ?? e}`); }
    }
  }

  public postError(source: string, message: string): void {
    console.error(`[HME] postError [${source}]: ${message}`);
    this._errorSink.post(source, message);
    this.post({ type: "errorBubble", source, message });
  }

  //  Extracted-component support

  private _ctxArgs(): ContextPostArgs {
    return {
      sessionId: this._state.sessionEntry?.id ?? null,
      chainIndex: this._state.chainIndex,
    };
  }

  private _chainBridge(): ChainSessionBridge {
    return {
      getSessionId: () => this._state.sessionEntry?.id ?? null,
      getMessages: () => this._state.messages,
      getChainIndex: () => this._state.chainIndex,
      getClaudeSessionId: () => this._state.claudeSessionId,
      getContextPct: () => this._contextMeter.pctUsed,
      hasMeterLiveUpdate: () => this._contextMeter.hasLiveUpdate,
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

  public static createOrShow(projectRoot: string): BrowserPanel {
    if (BrowserPanel.current) return BrowserPanel.current;
    BrowserPanel.current = new BrowserPanel(projectRoot);
    return BrowserPanel.current;
  }

  //  Incoming message dispatch (from Express POST /api/message)

  public handleMessage(msg: any): void {
    console.log(`[HME] handleMessage type=${msg?.type} clients=${this._sseClients.length}`);
    try {
      dispatchWebviewMessage(msg, this._messageHandlers);
    } catch (e: any) {
      console.error(`[HME] handleMessage threw: ${e?.message ?? e}\n${e?.stack}`);
      this.post({ type: "errorBubble", source: "dispatch", message: String(e?.message ?? e) });
    }
  }

  private readonly _messageHandlers: import("./panel/webviewMessages").WebviewHandlers = {
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
        const queuedUserMsg: ChatMessage = {
          id: uid(), role: "user", text: msg.text, route: msg.route, ts: Date.now(),
        };
        this.post({ type: "message", message: queuedUserMsg });
        this._messageQueue.push({ ...msg, _queuedUserMsg: queuedUserMsg });
      } else {
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
      this.post({ type: "sessionList", sessions: listSessions(this._projectRoot) });
      if (this._restoreSessionId) {
        const id = this._restoreSessionId;
        this._restoreSessionId = null;
        this._loadSession(id);
      }
    },
    loadSession: (msg) => this._loadSession(msg.id),
    deleteSession: (msg) => {
      deleteSession(this._projectRoot, msg.id);
      if (this._state.sessionEntry?.id === msg.id) {
        this._state = BrowserPanel._blankState();
        this._contextMeter.reset(this._ctxArgs());
        this._transcript.setSessionId("");
        this.post({ type: "historyCleared" });
      }
      this.post({ type: "sessionList", sessions: listSessions(this._projectRoot) });
    },
    renameSession: (msg) => {
      renameSession(this._projectRoot, msg.id, msg.title);
      this.post({ type: "sessionList", sessions: listSessions(this._projectRoot) });
    },
    newSession: () => {
      this._state = BrowserPanel._blankState();
      this._contextMeter.reset(this._ctxArgs());
      this.post({ type: "historyCleared" });
    },
    enrichPrompt: (msg) => {
      this.post({ type: "enrichStatus", status: "enriching" });
      enrichPrompt(msg.prompt, msg.frame ?? "").then((result) => {
        this.post({ type: "enrichResult", ...result });
      }).catch((e) => {
        this.post({
          type: "enrichResult", enriched: msg.prompt, original: msg.prompt,
          error: String(e), unchanged: true,
        });
      });
    },
    checkHmeShim: () => {
      isHmeShimReady().then(({ ready }) => {
        this.post({ type: "hmeShimStatus", ready, failed: !ready && this._shim.failed });
        if (!ready) this._shim.start();
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
        const validated = validateClaudeConfig({
          model: msg.claudeModel,
          effort: msg.claudeEffort,
          thinking: msg.claudeThinking,
        });
        this._claudeConfig = validated;
        const resolved = resolveClaudeConfig(validated);
        this.post({
          type: "claudeConfigApplied",
          alias: resolved.alias,
          modelId: resolved.modelId,
          effort: resolved.cliEffort,
          thinking: resolved.thinking,
        });
      } catch (e: any) {
        this.postError("config", `setClaudeConfig rejected: ${e?.message ?? e}`);
        // Re-broadcast current server-side config so the browser can reconcile.
        const resolved = resolveClaudeConfig(this._claudeConfig);
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

  //  Stream tracking & session persistence

  private static readonly DISPLAY_CAP = 100;

  private _displayMessages(): ChatMessage[] {
    return this._state.messages.slice(-BrowserPanel.DISPLAY_CAP);
  }

  private _trackStream(assistantId: string, route: string): StreamTracker {
    return this._streamPersister.track(
      assistantId, route,
      this._state.messages,
      () => this._persistState(),
    );
  }

  private _loadSession(id: string) {
    const persisted = loadSession(this._projectRoot, id);
    if (!persisted) return;
    const chainLinks = listChainLinks(this._projectRoot, id);
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

  private _persistState() {
    if (!this._state.sessionEntry) return;
    const entry = {
      ...this._state.sessionEntry,
      claudeSessionId: this._state.claudeSessionId,
      updatedAt: Date.now(),
    };
    this._state.sessionEntry = entry;
    saveSession(this._projectRoot, entry, this._state.messages, this._state.llamacppHistory, {
      contextTokens: this._contextMeter.pctUsed,
      chainIndex: this._state.chainIndex,
    });
  }

  //  Send pipeline

  private async _onSend(msg: SendMsg & { _queuedUserMsg?: ChatMessage }) {
    if (msg.route === "agent") {
      return this._onSendAgent(msg);
    }

    let resolvedRoute: "claude" | "local" | "hybrid";
    if (msg.route === "auto") {
      this.post({ type: "notice", level: "info", text: "🔀 Auto-routing…" });
      const transcriptContext = this._state.messages.slice(-6)
        .map((m) => `${m.role}: ${m.text.slice(0, 100)}`).join("\n");
      const decision = await classifyMessage(msg.text, transcriptContext, 0);
      resolvedRoute = decision.route;
      if (!decision.isError) {
        const label = decision.escalated ? `⬆ escalated to ${decision.route}` : decision.route;
        this.post({
          type: "notice", level: "info",
          text: `🔀 → ${label} (${Math.round(decision.confidence * 100)}% — ${decision.reason})`,
        });
      }
    } else {
      resolvedRoute = msg.route as "claude" | "local" | "hybrid";
    }

    if (!this._state.sessionEntry) {
      let entry;
      try {
        entry = createSession(this._projectRoot, deriveTitle(msg.text));
      } catch (e: any) {
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
    const resolvedCfg = resolveClaudeConfig(this._claudeConfig);
    msg.claudeModel = resolvedCfg.modelId;
    msg.claudeEffort = resolvedCfg.cliEffort;
    msg.claudeThinking = resolvedCfg.thinking;

    const model = resolvedRoute === "local" || resolvedRoute === "hybrid" ? msg.llamacppModel : msg.claudeModel;
    this._transcript.logUser(msg.text, resolvedRoute, model);

    validateMessage(msg.text).then(({ warnings, blocks }) => {
      this._transcript.logValidation(msg.text, warnings.length, blocks.length);
      if (blocks.length > 0) {
        const notice = blocks.map((b: any) => `⛔ [${b.title}] ${b.content}`).join("\n");
        this.post({ type: "notice", level: "block", text: `HME anti-pattern alert:\n${notice}` });
      } else if (warnings.length > 0) {
        const notice = warnings.map((w: any) => `⚠ [${w.title}]`).join(" · ");
        this.post({ type: "notice", level: "warn", text: `HME constraints: ${notice}` });
      }
    }).catch((e: any) => this.postError("validation", String(e)));

    postTranscript([{
      ts: Date.now(), type: "user", route: resolvedRoute, model,
      content: msg.text, summary: `User [${resolvedRoute}]: ${msg.text.slice(0, 100)}`,
    }]).catch((e: any) => this.postError("transcript", String(e)));

    const userMsg: ChatMessage = (msg as any)._queuedUserMsg ?? {
      id: uid(), role: "user", text: msg.text, route: resolvedRoute, ts: Date.now(),
    };
    this._state.messages.push(userMsg);
    this._persistState();
    if (!(msg as any)._queuedUserMsg) {
      this.post({ type: "message", message: userMsg });
    }

    if (this._state.lastRoute && this._state.lastRoute !== resolvedRoute) {
      this._transcript.logRouteSwitch(this._state.lastRoute, resolvedRoute);
    }
    const cross = buildCrossRouteContext(this._state.messages, this._state.lastRoute, resolvedRoute);
    const contextPrefix = applyCrossRouteContext(this._state, cross);
    this._state.lastRoute = resolvedRoute;

    const assistantId = uid();
    const streamStartExtras = resolvedRoute === "claude"
      ? { effort: resolvedCfg.cliEffort, thinking: resolvedCfg.thinking }
      : {};
    this.post({ type: "streamStart", id: assistantId, route: resolvedRoute, model, ...streamStartExtras });

    const resolvedMsg = { ...msg, _resolvedRoute: resolvedRoute, _contextPrefix: contextPrefix };
    const ctx = this._ctx;
    try {
      if (resolvedRoute === "local") {
        console.log(`[HME] calling streamLlamacppMsg`);
        streamLlamacppMsg(ctx, resolvedMsg, assistantId);
      } else if (resolvedRoute === "hybrid") {
        console.log(`[HME] calling streamHybridMsg`);
        streamHybridMsg(ctx, resolvedMsg, assistantId);
      } else {
        console.log(`[HME] calling streamClaudeMsg`);
        streamClaudeMsg(ctx, resolvedMsg, assistantId);
      }
    } catch (e: any) {
      console.error(`[HME] stream call threw synchronously: ${e?.message ?? e}\n${e?.stack}`);
      this.post({ type: "errorBubble", source: resolvedRoute, message: String(e?.message ?? e) });
    }
  }

  private async _onSendAgent(msg: SendMsg) {
    if (!this._state.sessionEntry) {
      const entry = createSession(this._projectRoot, deriveTitle(msg.text));
      this._state.sessionEntry = entry;
      this._transcript.setSessionId(entry.id);
      this._transcript.logSessionStart(entry.id, entry.title, false);
      this.post({ type: "sessionCreated", session: entry });
    }
    this._transcript.logUser(msg.text, "agent", msg.llamacppModel);
    postTranscript([{
      ts: Date.now(), type: "user", route: "agent", model: msg.llamacppModel,
      content: msg.text, summary: `User [agent]: ${msg.text.slice(0, 100)}`,
    }]).catch((e: any) => this.postError("transcript", String(e)));

    const userMsg: ChatMessage = { id: uid(), role: "user", text: msg.text, route: "local" as any, ts: Date.now() };
    this._state.messages.push(userMsg);
    this._persistState();
    this.post({ type: "message", message: userMsg });
    this.post({ type: "notice", level: "info", text: "🤖 Agent mode: running local + hybrid in parallel…" });

    const localId = uid();
    const hybridId = uid();
    this.post({ type: "streamStart", id: localId, route: "local", model: `[local] ${msg.llamacppModel}` });
    this.post({ type: "streamStart", id: hybridId, route: "hybrid", model: `[hybrid] ${msg.llamacppModel}` });

    let doneCount = 0;
    let drained = false;
    const cancelFns: Array<() => void> = [];
    const safeDrain = () => { if (!drained) { drained = true; this._drainQueue(); } };
    const checkBothDone = () => { if (++doneCount >= 2) { this._persistState(); safeDrain(); } };
    this._cancelCurrent = () => cancelFns.forEach((fn) => fn());

    const ctx = this._ctx;
    streamAgentMsg(ctx, msg, localId, "local", checkBothDone, checkBothDone, cancelFns);
    streamAgentHybridMsg(ctx, msg, hybridId, "hybrid", checkBothDone, checkBothDone, cancelFns);
  }

  //  Queue & cleanup

  private _drainQueue() {
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

  public getHtmlPath(): string {
    return path.join(__dirname, "..", "webview", "browser.html");
  }

  public async dispose(): Promise<void> {
    if (this._disposed) return;
    this._disposed = true;
    this._cancelCurrent?.();
    this._cancelCurrent = undefined;
    this._messageQueue = [];
    this._isStreaming = false;
    BrowserPanel.current = undefined;
    this._shim.dispose();
    try { this._persistState(); } catch (e) { console.error(`[HME] dispose: _persistState failed: ${(e as any)?.message ?? e}`); }
    const narrativeWork = Promise.resolve(this._transcript.forceNarrative?.());
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, 5000));
    await Promise.race([narrativeWork, timeout]);
    for (const res of this._sseClients) {
      try { res.end(); } catch { /* ignore */ }
    }
    this._sseClients = [];
  }
}
