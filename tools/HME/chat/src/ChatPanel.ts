import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import {
  isHmeShimReady, validateMessage, enrichPrompt,
  postTranscript, logShimError, TokenUsage,
} from "./router";
import { ChatMessage } from "./types";
import {
  SessionEntry,
  ChainLink,
  listSessions,
  loadSession,
  createSession,
  saveSession,
  deleteSession,
  renameSession,
  deriveTitle,
  saveChainLink,
  loadChainSummaries,
  listChainLinks,
} from "./SessionStore";
import { TranscriptLogger, nullTranscript } from "./TranscriptLogger";
import { synthesizeNarrative, synthesizeChainSummary } from "./Arbiter";
import {
  uid, CHARS_PER_TOKEN,
  SessionState, ContextTracker, StreamTracker, ChatCtx,
} from "./streamUtils";
import { buildSummaryPrompt, buildFallbackSummary } from "./chatChain";
import {
  streamClaudeMsg, streamOllamaMsg, streamHybridMsg,
  streamAgentMsg, streamAgentHybridMsg,
} from "./chatStreaming";

const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  "claude-opus-4-6": 1_000_000,
  "claude-sonnet-4-6": 500_000,
};
const DEFAULT_CONTEXT_WINDOW = 500_000;
const CHAIN_THRESHOLD_PCT = 75;
const SYSTEM_OVERHEAD_TOKENS = 8_000;

export class ChatPanel {
  public static current: ChatPanel | undefined;
  private static _globalState: vscode.Memento | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _projectRoot: string;
  private _state: SessionState = { messages: [], claudeSessionId: null, ollamaHistory: [], lastRoute: null, sessionEntry: null, chainIndex: 0 };
  private _cancelCurrent?: () => void;
  private _isStreaming = false;
  private _messageQueue: any[] = [];
  private _disposables: vscode.Disposable[] = [];
  private _transcript: TranscriptLogger;
  private _restoreSessionId: string | null = null;
  private _disposed = false;
  private _contextTracker: ContextTracker = { lastInputTokens: null, lastOutputTokens: null, totalChars: 0, model: "" };
  private _chainingInProgress = false;

  private constructor(panel: vscode.WebviewPanel, projectRoot: string, restoreSessionId?: string) {
    this._panel = panel;
    this._projectRoot = projectRoot;
    this._restoreSessionId = restoreSessionId ?? null;

    try {
      this._transcript = new TranscriptLogger(projectRoot);
      this._transcript.setNarrativeCallback(async (entries) => {
        try {
          const narrative = await synthesizeNarrative(entries);
          if (narrative) {
            postTranscript([{ ts: Date.now(), type: "narrative", content: narrative }])
              .catch((e: any) => this._postError("narrative", String(e)));
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
      this._disposables
    );
    // Without retainContextWhenHidden, VS Code destroys webview content when the
    // panel is hidden and recreates it when shown. Re-send HTML + messages on show.
    this._panel.onDidChangeViewState(
      () => {
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
      },
      null,
      this._disposables
    );
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
      { enableScripts: true }
    );
    ChatPanel.current = new ChatPanel(panel, projectRoot);
  }

  public static deserialize(panel: vscode.WebviewPanel, state: any, projectRoot: string) {
    const restoreSessionId: string | undefined = state?.activeSessionId;
    ChatPanel.current = new ChatPanel(panel, projectRoot, restoreSessionId);
  }

  private _handleMessage(msg: any) {
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
          const queuedUserMsg: ChatMessage = {
            id: uid(), role: "user", text: msg.text, route: msg.route, ts: Date.now(),
          };
          this._post({ type: "message", message: queuedUserMsg });
          this._messageQueue.push({ ...msg, _queuedUserMsg: queuedUserMsg });
        } else {
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
        enrichPrompt(msg.prompt, msg.frame ?? "").then((result) => {
          this._post({ type: "enrichResult", ...result });
        }).catch((e) => {
          this._post({ type: "enrichResult", enriched: msg.prompt, original: msg.prompt,
            error: String(e), unchanged: true });
        });
        break;
      case "checkHmeShim":
        isHmeShimReady().then(({ ready }) => {
          this._post({ type: "hmeShimStatus", ready, failed: !ready && this._shimFailed });
          if (!ready) this._startHmeShim();
        });
        break;
      // ── Session management ───────────────────────────────────────────────
      case "listSessions":
        this._post({ type: "sessionList", sessions: listSessions(this._projectRoot) });
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
        deleteSession(this._projectRoot, msg.id);
        if (this._state.sessionEntry?.id === msg.id) {
          this._state = { messages: [], claudeSessionId: null, ollamaHistory: [], lastRoute: null, sessionEntry: null, chainIndex: 0 };
          this._resetContextTracker();
          this._transcript.setSessionId("");
          this._post({ type: "historyCleared" });
        }
        this._post({ type: "sessionList", sessions: listSessions(this._projectRoot) });
        break;
      case "renameSession":
        renameSession(this._projectRoot, msg.id, msg.title);
        this._post({ type: "sessionList", sessions: listSessions(this._projectRoot) });
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

  private static readonly DISPLAY_CAP = 100;
  private static readonly STREAM_PERSIST_MS = 10_000;

  private _displayMessages(): ChatMessage[] {
    return this._state.messages.slice(-ChatPanel.DISPLAY_CAP);
  }

  /**
   * Track a streaming assistant message so partial text survives ext host crashes.
   * Pushes a placeholder into _state.messages immediately and persists every 10s.
   */
  private _trackStream(assistantId: string, route: string): StreamTracker {
    const partial: ChatMessage = { id: assistantId, role: "assistant", text: "", route, ts: Date.now() };
    this._state.messages.push(partial);
    this._persistState();
    const idx = this._state.messages.length - 1;
    let dirty = false;
    const timer = setInterval(() => {
      if (dirty) { dirty = false; this._persistState(); }
    }, ChatPanel.STREAM_PERSIST_MS);
    return {
      update: (text: string, tools?: string[], thinking?: string) => {
        partial.text = text;
        if (tools?.length) partial.tools = tools;
        if (thinking) partial.thinking = thinking;
        dirty = true;
      },
      finalize: (final: ChatMessage) => {
        clearInterval(timer);
        this._state.messages[idx] = final;
        this._persistState();
      },
    };
  }

  private _makeCtx(): ChatCtx {
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

  private _persistState() {
    if (!this._state.sessionEntry) return;
    const entry = {
      ...this._state.sessionEntry,
      claudeSessionId: this._state.claudeSessionId,
      updatedAt: Date.now(),
    };
    this._state.sessionEntry = entry;
    saveSession(this._projectRoot, entry, this._state.messages, this._state.ollamaHistory, {
      contextTokens: Math.round(this._contextTracker.totalChars / CHARS_PER_TOKEN),
      chainIndex: this._state.chainIndex,
    });
  }

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
      this._post({ type: "sessionCreated", session: entry });
    }

    const model = resolvedRoute === "local" || resolvedRoute === "hybrid" ? msg.ollamaModel : msg.claudeModel;
    this._transcript.logUser(msg.text, resolvedRoute, model);

    validateMessage(msg.text).then(({ warnings, blocks }) => {
      this._transcript.logValidation(msg.text, warnings.length, blocks.length);
      if (blocks.length > 0) {
        const notice = blocks.map((b: any) => `⛔ [${b.title}] ${b.content}`).join("\n");
        this._post({ type: "notice", level: "block", text: `HME anti-pattern alert:\n${notice}` });
      } else if (warnings.length > 0) {
        const notice = warnings.map((w: any) => `⚠ [${w.title}]`).join(" · ");
        this._post({ type: "notice", level: "warn", text: `HME constraints: ${notice}` });
      }
    }).catch((e: any) => this._postError("validation", String(e)));

    postTranscript([{
      ts: Date.now(), type: "user", route: resolvedRoute, model,
      content: msg.text, summary: `User [${resolvedRoute}]: ${msg.text.slice(0, 100)}`,
    }]).catch((e: any) => this._postError("transcript", String(e)));

    const userMsg: ChatMessage = (msg as any)._queuedUserMsg ?? {
      id: uid(), role: "user", text: msg.text, route: resolvedRoute, ts: Date.now(),
    };
    this._state.messages.push(userMsg);
    this._persistState();
    if (!(msg as any)._queuedUserMsg) {
      this._post({ type: "message", message: userMsg });
    }

    // ── Cross-route history portability ──
    let contextPrefix = "";
    if (this._state.lastRoute && this._state.lastRoute !== resolvedRoute) {
      this._transcript.logRouteSwitch(this._state.lastRoute, resolvedRoute);
      if (resolvedRoute === "local" || resolvedRoute === "hybrid") {
        this._state.ollamaHistory = this._state.messages
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => ({ role: m.role as "user" | "assistant", content: m.text || "" }));
        this._state.ollamaHistory.pop();
      }
      if (resolvedRoute === "claude" && this._state.lastRoute !== "claude") {
        this._state.claudeSessionId = null;
        const prior = this._state.messages
          .filter((m) => m.role === "user" || m.role === "assistant")
          .slice(0, -1).slice(-12);
        if (prior.length > 0) {
          const lines = prior.map((m) =>
            `${m.role === "user" ? "Human" : "Assistant"}: ${(m.text || "").slice(0, 600)}`
          ).join("\n");
          contextPrefix = `[Prior conversation via local model — use for context only]\n${lines}\n[End of prior context]\n\n`;
        }
      }
    }
    this._state.lastRoute = resolvedRoute;

    const assistantId = uid();
    this._post({ type: "streamStart", id: assistantId, route: resolvedRoute, model });

    const resolvedMsg = { ...msg, _resolvedRoute: resolvedRoute, _contextPrefix: contextPrefix };
    const ctx = this._makeCtx();
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
      this._post({ type: "sessionCreated", session: entry });
    }
    this._transcript.logUser(msg.text, "agent", msg.ollamaModel);
    postTranscript([{
      ts: Date.now(), type: "user", route: "agent", model: msg.ollamaModel,
      content: msg.text, summary: `User [agent]: ${msg.text.slice(0, 100)}`,
    }]).catch((e: any) => this._postError("transcript", String(e)));

    const userMsg: ChatMessage = { id: uid(), role: "user", text: msg.text, route: "local" as any, ts: Date.now() };
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
    const cancelFns: Array<() => void> = [];
    const safeDrain = () => { if (!drained) { drained = true; this._drainQueue(); } };
    const checkBothDone = () => { if (++doneCount >= 2) { this._persistState(); safeDrain(); } };
    this._cancelCurrent = () => cancelFns.forEach((fn) => fn());

    const ctx = this._makeCtx();
    streamAgentMsg(ctx, msg, localId, "local", checkBothDone, checkBothDone, cancelFns);
    streamAgentHybridMsg(ctx, msg, hybridId, "hybrid", checkBothDone, checkBothDone, cancelFns);
  }

  // ── Context tracking & chain ───────────────────────────────────────────────

  private _resetContextTracker(restoredTokens?: number) {
    this._contextTracker = { lastInputTokens: null, lastOutputTokens: null, totalChars: 0, model: "" };
    if (restoredTokens) {
      this._contextTracker.totalChars = restoredTokens * CHARS_PER_TOKEN;
    }
    this._postContextUpdate();
  }

  private _updateContextTracker(text: string, thinking: string, model: string, usage?: TokenUsage) {
    this._contextTracker.model = model;
    this._contextTracker.totalChars += text.length + (thinking?.length ?? 0);
    if (usage) {
      this._contextTracker.lastInputTokens = usage.inputTokens;
      this._contextTracker.lastOutputTokens = usage.outputTokens;
    }
    this._postContextUpdate();
  }

  private _getContextPct(): number {
    const window = MODEL_CONTEXT_WINDOWS[this._contextTracker.model] ?? DEFAULT_CONTEXT_WINDOW;
    if (this._contextTracker.lastInputTokens != null && this._contextTracker.lastOutputTokens != null) {
      const used = this._contextTracker.lastInputTokens + this._contextTracker.lastOutputTokens;
      return Math.min(99, Math.round(used / window * 100));
    }
    // PTY mode: no token counts — estimate from all message chars
    const allChars = this._state.messages.reduce(
      (sum, m) => sum + (m.text?.length ?? 0) + ((m as any).thinking?.length ?? 0), 0
    );
    const estimatedTokens = allChars / CHARS_PER_TOKEN + SYSTEM_OVERHEAD_TOKENS;
    return Math.min(99, Math.round(estimatedTokens / window * 100));
  }

  private _postContextUpdate() {
    const pct = this._getContextPct();
    const chainLinks = this._state.sessionEntry
      ? listChainLinks(this._projectRoot, this._state.sessionEntry.id).length
      : 0;
    this._post({ type: "contextUpdate", pct, chainLinks, chainIndex: this._state.chainIndex });
  }

  private _checkChainThreshold(msg: any) {
    const pct = this._getContextPct();
    if (pct < CHAIN_THRESHOLD_PCT || this._chainingInProgress) return;
    this._performChain(msg).catch((e) => {
      console.error(`[HME Chat] Chain failed: ${e}`);
      this._postError("chain", String(e));
      this._chainingInProgress = false;
    });
  }

  private async _performChain(msg: any) {
    if (!this._state.sessionEntry || this._chainingInProgress) return;
    this._chainingInProgress = true;
    const sessionId = this._state.sessionEntry.id;
    const linkIndex = this._state.chainIndex;

    this._post({ type: "notice", level: "info", text: `Context chain: saving link ${linkIndex + 1} and generating summary...` });

    let todos: any[] = [];
    try {
      const todoPath = path.join(
        process.env["HOME"] ?? process.env["USERPROFILE"] ?? "~",
        ".claude", "mcp", "HME", "todos.json"
      );
      todos = JSON.parse(fs.readFileSync(todoPath, "utf8"));
    } catch (e: any) {
      if (e?.code !== "ENOENT") console.error(`[HME] Failed to load todos.json: ${e?.message ?? e}`);
    }

    const priorSummaries = loadChainSummaries(this._projectRoot, sessionId);
    const recentMessages = this._state.messages.slice(-20);
    const summaryPrompt = buildSummaryPrompt(recentMessages, todos, priorSummaries);

    let summary = "";
    try {
      summary = await synthesizeChainSummary(summaryPrompt);
    } catch (e) {
      console.error(`[HME Chat] Chain summary via local model failed: ${e}`);
      summary = buildFallbackSummary(recentMessages, todos, priorSummaries);
    }

    const link: ChainLink = {
      index: linkIndex,
      sessionId,
      messages: [...this._state.messages],
      summary,
      todos,
      contextTokens: this._getContextPct(),
      claudeSessionId: this._state.claudeSessionId,
      createdAt: Date.now(),
    };
    saveChainLink(this._projectRoot, link);

    this._state.messages = [];
    this._state.claudeSessionId = null;
    this._state.chainIndex = linkIndex + 1;
    this._resetContextTracker();

    const contextMsg: ChatMessage = {
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

  // ── Error handling ─────────────────────────────────────────────────────────

  private _postError(source: string, message: string) {
    // Errors route to hme-errors.log only — Lifesaver reads it for Claude's awareness.
    // No UI notices: the user reads logs when they want to; this channel is not for them.
    logShimError(source, message).catch((e: any) => {
      console.error(`[HME FAILFAST] logShimError failed for [${source}] ${message}: ${e?.message ?? e}`);
      const errLine = `[${new Date().toISOString()}] [${source}] ${message}\n`;
      try {
        fs.mkdirSync(path.join(this._projectRoot, "log"), { recursive: true });
        fs.appendFileSync(path.join(this._projectRoot, "log", "hme-errors.log"), errLine);
      } catch (fileErr: any) {
        console.error(`[HME FAILFAST] Disk fallback also failed for [${source}] ${message}: ${fileErr?.message ?? fileErr}`);
      }
    });
  }

  // ── HME shim process management ────────────────────────────────────────────

  private _shimProc: import("child_process").ChildProcess | null = null;
  private _shimFailed = false;
  private _shimPollTimer: ReturnType<typeof setTimeout> | null = null;

  private _startHmeShim() {
    if (this._shimProc && !this._shimProc.killed) return;
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
      this._shimProc!.on("error", (e: Error) => {
        this._shimProc = null;
        this._post({ type: "hmeShimStatus", ready: false });
        this._postError("shim", `HME shim failed to start: ${e.message}`);
      });
      this._shimProc!.on("exit", (code: number | null) => {
        const wasStarted = started;
        this._shimProc = null;
        this._post({ type: "hmeShimStatus", ready: false });
        if (!wasStarted) {
          this._postError("shim", `HME shim exited before becoming ready (code ${code ?? "?"})`);
        } else if (!this._disposed) {
          setTimeout(() => { if (!this._disposed) this._startHmeShim(); }, 3000);
        }
      });
      let attempts = 0;
      const poll = () => {
        attempts++;
        isHmeShimReady().then(({ ready }) => {
          if (ready) { started = true; this._shimPollTimer = null; this._post({ type: "hmeShimStatus", ready: true }); return; }
          if (attempts < 5 && this._shimProc) {
            this._post({ type: "hmeShimStatus", ready: false, failed: false });
            this._shimPollTimer = setTimeout(poll, 2000);
          } else {
            this._shimPollTimer = null;
            this._shimFailed = true;
            this._post({ type: "hmeShimStatus", ready: false, failed: true });
            this._postError("shim", `HME shim started but /health not ready after ${attempts * 2}s — check log/hme-errors.log or run mcp/hme_http.py manually`);
          }
        });
      };
      if (this._shimPollTimer) clearTimeout(this._shimPollTimer);
      this._shimPollTimer = setTimeout(poll, 2000);
    } catch (e: any) {
      this._postError("shim", `HME shim spawn error: ${e?.message ?? e}`);
    }
  }

  // ── Message queue & webview plumbing ───────────────────────────────────────

  private _drainQueue() {
    this._isStreaming = false;
    if (this._messageQueue.length > 0) {
      const next = this._messageQueue.shift();
      this._isStreaming = true;
      this._onSend(next).catch((e) => {
        this._postError("send", String(e));
        this._post({ type: "streamEnd", id: "err" });
        this._drainQueue();
      });
    }
  }

  private _post(data: any) {
    this._panel.webview.postMessage(data);
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
    if (this._shimPollTimer) { clearTimeout(this._shimPollTimer); this._shimPollTimer = null; }
    try { this._persistState(); } catch (e) { console.error(`[HME] dispose: _persistState failed: ${(e as any)?.message ?? e}`); }
    const narrativeWork = Promise.resolve(this._transcript.forceNarrative?.());
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, 5000));
    await Promise.race([narrativeWork, timeout]);
    try { this._shimProc?.kill(); } catch (e: any) { console.error(`[HME] shimProc kill failed: ${e?.message ?? e}`); }
    this._panel.dispose();
    this._disposables.forEach((d) => d.dispose());
    this._disposables = [];
  }
}
