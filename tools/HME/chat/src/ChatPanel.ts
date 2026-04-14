import * as vscode from "vscode";
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
} from "./SessionStore";
import { TranscriptLogger, nullTranscript } from "./TranscriptLogger";
import { synthesizeNarrative } from "./Arbiter";
import {
  uid,
  SessionState, StreamTracker, ChatCtx,
} from "./streamUtils";
import {
  streamClaudeMsg, streamOllamaMsg, streamHybridMsg,
  streamAgentMsg, streamAgentHybridMsg,
} from "./chatStreaming";
import { buildCrossRouteContext } from "./crossRouteHistory";
import { PanelHost } from "./panel/PanelHost";
import { ErrorSink } from "./panel/ErrorSink";
import { ShimSupervisor } from "./panel/ShimSupervisor";
import { MirrorTerminal } from "./panel/MirrorTerminal";
import { ContextMeter, ContextPostArgs } from "./panel/ContextMeter";
import { ChainPerformer, ChainSessionBridge } from "./panel/ChainPerformer";
import { StreamPersister } from "./panel/StreamPersister";
import { dispatchWebviewMessage } from "./panel/webviewMessages";

export class ChatPanel implements PanelHost {
  public static current: ChatPanel | undefined;
  private static _globalState: vscode.Memento | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _projectRoot: string;
  private _state: SessionState = ChatPanel._blankState();
  private _cancelCurrent?: () => void;
  private _isStreaming = false;
  private _messageQueue: any[] = [];
  private _disposables: vscode.Disposable[] = [];
  private _transcript: TranscriptLogger;
  private _restoreSessionId: string | null = null;
  private _disposed = false;

  // ── Extracted components ─────────────────────────────────────────────────
  private readonly _errorSink: ErrorSink;
  private readonly _shim: ShimSupervisor;
  private readonly _mirror: MirrorTerminal;
  private readonly _contextMeter: ContextMeter;
  private readonly _chain: ChainPerformer;
  private readonly _streamPersister: StreamPersister;
  private readonly _ctx: ChatCtx;

  private static _blankState(): SessionState {
    return { messages: [], claudeSessionId: null, ollamaHistory: [], lastRoute: null, sessionEntry: null, chainIndex: 0 };
  }

  private constructor(panel: vscode.WebviewPanel, projectRoot: string, restoreSessionId?: string) {
    this._panel = panel;
    this._projectRoot = projectRoot;
    this._restoreSessionId = restoreSessionId ?? null;

    // PanelHost methods (post/postError) delegate to the panel via
    // `this.post` / `this.postError` below. The extracted components
    // receive `this` typed as PanelHost to keep the coupling narrow.
    this._errorSink = new ErrorSink(projectRoot);
    this._shim = new ShimSupervisor(projectRoot, this);
    this._mirror = new MirrorTerminal(projectRoot);
    this._contextMeter = new ContextMeter(projectRoot, this);
    this._chain = new ChainPerformer(projectRoot, this, this._chainBridge());
    this._streamPersister = new StreamPersister(this);
    this._ctx = this._makeCtx();

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

    this._panel.webview.html = this._getHtml();
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this._panel.webview.onDidReceiveMessage(
      (msg) => this._handleMessage(msg),
      null,
      this._disposables,
    );
    // retainContextWhenHidden keeps the webview alive when the tab is hidden —
    // scroll position, model/effort/thinking controls, and streaming state are
    // all preserved automatically. Only refresh the context meter on show.
    this._panel.onDidChangeViewState(
      () => {
        if (this._panel.visible) {
          this._contextMeter.post(this._ctxArgs());
        }
      },
      null,
      this._disposables,
    );
  }

  // ── PanelHost implementation ─────────────────────────────────────────────

  public post(data: any): void {
    this._panel.webview.postMessage(data);
  }

  public postError(source: string, message: string): void {
    this._errorSink.post(source, message);
  }

  // ── Extracted-component support ──────────────────────────────────────────

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

  public static setGlobalState(state: vscode.Memento) {
    ChatPanel._globalState = state;
  }

  public static createOrShow(projectRoot: string) {
    const col = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (ChatPanel.current) {
      ChatPanel.current._panel.reveal(col);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "hmeChat", "HME Chat",
      col || vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    ChatPanel.current = new ChatPanel(panel, projectRoot);
  }

  public static deserialize(panel: vscode.WebviewPanel, state: any, projectRoot: string) {
    const restoreSessionId: string | undefined = state?.activeSessionId;
    ChatPanel.current = new ChatPanel(panel, projectRoot, restoreSessionId);
  }

  // ── Webview message dispatch ─────────────────────────────────────────────

  private _handleMessage(msg: any) {
    dispatchWebviewMessage(msg, this._messageHandlers);
  }

  private readonly _messageHandlers: import("./panel/webviewMessages").WebviewHandlers = {
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
    // ── Session management ───────────────────────────────────────────────
    clearHistory: () => {
      this._state = ChatPanel._blankState();
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
        this._state = ChatPanel._blankState();
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
      this._state = ChatPanel._blankState();
      this._contextMeter.reset(this._ctxArgs());
      this.post({ type: "historyCleared" });
    },
    // ── HME features ─────────────────────────────────────────────────────
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

  // ── Stream tracking & session persistence ────────────────────────────────

  private static readonly DISPLAY_CAP = 100;

  private _displayMessages(): ChatMessage[] {
    return this._state.messages.slice(-ChatPanel.DISPLAY_CAP);
  }

  private _trackStream(assistantId: string, route: string): StreamTracker {
    return this._streamPersister.track(
      assistantId, route,
      this._state.messages,
      () => this._persistState(),
    );
  }

  private _makeCtx(): ChatCtx {
    const self = this;
    return {
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
  }

  private _loadSession(id: string) {
    const persisted = loadSession(this._projectRoot, id);
    if (!persisted) return;
    const chainLinks = listChainLinks(this._projectRoot, id);
    const chainIndex = chainLinks.length > 0 ? Math.max(...chainLinks) + 1 : (persisted.chainIndex ?? 0);
    this._state = {
      messages: persisted.messages,
      claudeSessionId: persisted.entry.claudeSessionId,
      ollamaHistory: persisted.ollamaHistory,
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
    saveSession(this._projectRoot, entry, this._state.messages, this._state.ollamaHistory, {
      contextTokens: this._contextMeter.pctUsed,
      chainIndex: this._state.chainIndex,
    });
  }

  // ── Send pipeline ────────────────────────────────────────────────────────

  private async _onSend(msg: {
    text: string;
    route: "claude" | "local" | "hybrid" | "auto" | "agent";
    claudeModel: string;
    claudeEffort: string;
    claudeThinking: boolean;
    ollamaModel: string;
  }) {
    if (msg.route === "agent") {
      return this._onSendAgent(msg);
    }

    const resolvedRoute = (msg.route === "auto" ? "claude" : msg.route) as "claude" | "local" | "hybrid";

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

    const model = resolvedRoute === "local" || resolvedRoute === "hybrid" ? msg.ollamaModel : msg.claudeModel;
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

    // ── Cross-route history portability ──
    if (this._state.lastRoute && this._state.lastRoute !== resolvedRoute) {
      this._transcript.logRouteSwitch(this._state.lastRoute, resolvedRoute);
    }
    const cross = buildCrossRouteContext(this._state.messages, this._state.lastRoute, resolvedRoute);
    if (cross.ollamaHistory) this._state.ollamaHistory = cross.ollamaHistory;
    if (cross.claudeSessionIdReset) this._state.claudeSessionId = null;
    const contextPrefix = cross.contextPrefix;
    this._state.lastRoute = resolvedRoute;

    const assistantId = uid();
    this.post({ type: "streamStart", id: assistantId, route: resolvedRoute, model });

    const resolvedMsg = { ...msg, _resolvedRoute: resolvedRoute, _contextPrefix: contextPrefix };
    const ctx = this._ctx;
    if (resolvedRoute === "local") {
      streamOllamaMsg(ctx, resolvedMsg, assistantId);
    } else if (resolvedRoute === "hybrid") {
      streamHybridMsg(ctx, resolvedMsg, assistantId);
    } else {
      streamClaudeMsg(ctx, resolvedMsg, assistantId);
    }
  }

  /**
   * Agent route: fires local AND hybrid in parallel for side-by-side comparison.
   * Neither response writes to ollamaHistory to avoid double-appending;
   * local result wins for history after both complete.
   */
  private async _onSendAgent(msg: any) {
    if (!this._state.sessionEntry) {
      const entry = createSession(this._projectRoot, deriveTitle(msg.text));
      this._state.sessionEntry = entry;
      this._transcript.setSessionId(entry.id);
      this._transcript.logSessionStart(entry.id, entry.title, false);
      this.post({ type: "sessionCreated", session: entry });
    }
    this._transcript.logUser(msg.text, "agent", msg.ollamaModel);
    postTranscript([{
      ts: Date.now(), type: "user", route: "agent", model: msg.ollamaModel,
      content: msg.text, summary: `User [agent]: ${msg.text.slice(0, 100)}`,
    }]).catch((e: any) => this.postError("transcript", String(e)));

    const userMsg: ChatMessage = { id: uid(), role: "user", text: msg.text, route: "local" as any, ts: Date.now() };
    this._state.messages.push(userMsg);
    this._persistState();
    this.post({ type: "message", message: userMsg });
    this.post({ type: "notice", level: "info", text: "🤖 Agent mode: running local + hybrid in parallel…" });

    const localId = uid();
    const hybridId = uid();
    this.post({ type: "streamStart", id: localId, route: "local", model: `[local] ${msg.ollamaModel}` });
    this.post({ type: "streamStart", id: hybridId, route: "hybrid", model: `[hybrid] ${msg.ollamaModel}` });

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

  // ── Message queue & webview plumbing ─────────────────────────────────────

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

  private _getHtml(): string {
    const htmlPath = path.join(__dirname, "..", "webview", "index.html");
    let html = fs.readFileSync(htmlPath, "utf8");
    const storedZoom = ChatPanel._globalState?.get<number>("hme.zoomLevel") ?? 1.0;
    html = html.replace("<head>", `<head><script>window.__HME_ZOOM__=${storedZoom};</script>`);
    return html;
  }

  public async dispose(): Promise<void> {
    if (this._disposed) return;
    this._disposed = true;
    this._cancelCurrent?.();
    this._cancelCurrent = undefined;
    this._messageQueue = [];
    this._isStreaming = false;
    ChatPanel.current = undefined;
    this._shim.dispose();
    try { this._persistState(); } catch (e) { console.error(`[HME] dispose: _persistState failed: ${(e as any)?.message ?? e}`); }
    const narrativeWork = Promise.resolve(this._transcript.forceNarrative?.());
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, 5000));
    await Promise.race([narrativeWork, timeout]);
    this._panel.dispose();
    this._disposables.forEach((d) => d.dispose());
    this._disposables = [];
  }
}
