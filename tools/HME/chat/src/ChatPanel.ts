import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import {
  streamClaude, streamClaudePty, streamOllama, streamHybrid,
  isHmeShimReady, validateMessage, auditChanges,
  postTranscript, reindexFiles, postNarrative, logShimError, OllamaMessage,
} from "./router";
import { ChatMessage } from "./types";
import {
  SessionEntry,
  listSessions,
  loadSession,
  createSession,
  saveSession,
  deleteSession,
  renameSession,
  deriveTitle,
} from "./SessionStore";
import { TranscriptLogger } from "./TranscriptLogger";
import { classifyMessage, synthesizeNarrative } from "./Arbiter";

interface SessionState {
  messages: ChatMessage[];
  claudeSessionId: string | null;
  ollamaHistory: OllamaMessage[];
  lastRoute: "claude" | "local" | "hybrid" | null;
  sessionEntry: SessionEntry | null;
}

export class ChatPanel {
  public static current: ChatPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _projectRoot: string;
  private _state: SessionState = { messages: [], claudeSessionId: null, ollamaHistory: [], lastRoute: null, sessionEntry: null };
  private _cancelCurrent?: () => void;
  private _isStreaming = false;
  private _messageQueue: any[] = [];
  private _disposables: vscode.Disposable[] = [];
  private _transcript: TranscriptLogger;
  private _restoreSessionId: string | null = null;

  private constructor(panel: vscode.WebviewPanel, projectRoot: string, restoreSessionId?: string) {
    this._panel = panel;
    this._projectRoot = projectRoot;
    this._restoreSessionId = restoreSessionId ?? null;

    // Wrap all init that touches disk or native modules in try/catch
    // so a failure here never prevents the panel from opening
    try {
      this._transcript = new TranscriptLogger(projectRoot);
      this._transcript.setNarrativeCallback(async (entries) => {
        try {
          const narrative = await synthesizeNarrative(entries);
          if (narrative) postNarrative(narrative).catch(() => {});
          return narrative;
        } catch { return ""; }
      });
    } catch (e) {
      // TranscriptLogger failed — use a no-op stub
      this._transcript = {
        logUser: () => {}, logAssistant: () => {}, logToolCall: () => {},
        logRouteSwitch: () => {}, logValidation: () => {}, logAudit: () => {},
        logSessionStart: () => {}, getRecentContext: () => "", getWindow: () => [],
        getAll: () => [], count: 0, setNarrativeCallback: () => {}, rotate: () => {},
      } as any;
    }

    this._panel.webview.html = this._getHtml();
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this._panel.webview.onDidReceiveMessage(
      (msg) => this._handleMessage(msg),
      null,
      this._disposables
    );
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
      "hmeChat",
      "HME Chat",
      col || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );
    ChatPanel.current = new ChatPanel(panel, projectRoot);
  }

  public static deserialize(panel: vscode.WebviewPanel, state: any, projectRoot: string) {
    const restoreSessionId: string | undefined = state?.activeSessionId;
    ChatPanel.current = new ChatPanel(panel, projectRoot, restoreSessionId);
  }

  private _handleMessage(msg: any) {
    switch (msg.type) {
      case "send":
        if (this._isStreaming) {
          // Show user message immediately; queue response until current stream ends
          const queuedUserMsg: ChatMessage = {
            id: uid(), role: "user", text: msg.text, route: msg.route, ts: Date.now(),
          };
          this._post({ type: "message", message: queuedUserMsg });
          this._messageQueue.push({ ...msg, _queuedUserMsg: queuedUserMsg });
        } else {
          this._isStreaming = true;
          this._onSend(msg).catch((e) => {
            this._post({ type: "streamChunk", id: "err", chunkType: "error", chunk: String(e) });
            this._post({ type: "streamEnd", id: "err" });
            this._drainQueue();
          });
        }
        break;
      case "cancel":
        this._cancelCurrent?.();
        this._cancelCurrent = undefined;
        this._post({ type: "cancelConfirmed" });
        this._drainQueue();
        break;
      case "clearHistory":
        this._state = { messages: [], claudeSessionId: null, ollamaHistory: [], lastRoute: null, sessionEntry: null };
        this._post({ type: "historyCleared" });
        break;
      case "checkHmeShim":
        isHmeShimReady().then(({ ready, errors }) => {
          this._post({ type: "hmeShimStatus", ready });
          if (errors.length > 0) {
            const summary = errors.slice(-3).map((e: any) =>
              `[${e.ts_str ?? "?"}] [${e.source}] ${e.message}`
            ).join("\n");
            this._post({ type: "notice", level: "warn", text: `⚠ HME errors (check log/hme-errors.log):\n${summary}` });
          }
        });
        break;
      case "listSessions":
        this._post({ type: "sessionList", sessions: listSessions(this._projectRoot) });
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
        deleteSession(this._projectRoot, msg.id);
        if (this._state.sessionEntry?.id === msg.id) {
          this._state = { messages: [], claudeSessionId: null, ollamaHistory: [], lastRoute: null, sessionEntry: null };
          this._post({ type: "historyCleared" });
        }
        this._post({ type: "sessionList", sessions: listSessions(this._projectRoot) });
        break;
      case "renameSession":
        renameSession(this._projectRoot, msg.id, msg.title);
        this._post({ type: "sessionList", sessions: listSessions(this._projectRoot) });
        break;
      case "newSession":
        this._state = { messages: [], claudeSessionId: null, ollamaHistory: [], lastRoute: null, sessionEntry: null };
        this._post({ type: "historyCleared" });
        break;
    }
  }

  private _loadSession(id: string) {
    const persisted = loadSession(this._projectRoot, id);
    if (!persisted) return;
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

  private _persistState() {
    if (!this._state.sessionEntry) return;
    const entry = {
      ...this._state.sessionEntry,
      claudeSessionId: this._state.claudeSessionId,
      updatedAt: Date.now(),
    };
    this._state.sessionEntry = entry;
    saveSession(this._projectRoot, entry, this._state.messages, this._state.ollamaHistory);
  }

  private async _onSend(msg: {
    text: string;
    route: "claude" | "local" | "hybrid" | "auto";
    claudeModel: string;
    claudeEffort: string;
    claudeThinking: boolean;
    ollamaModel: string;
  }) {
    // ── Auto-route: arbiter classifies message complexity ──
    let resolvedRoute = msg.route as "claude" | "local" | "hybrid";
    if (msg.route === "auto") {
      this._post({ type: "notice", level: "info", text: "🔀 Arbiter classifying…" });
      const transcriptCtx = this._transcript.getRecentContext(20, 1500);
      const decision = await classifyMessage(msg.text, transcriptCtx, 0);
      resolvedRoute = decision.route;
      const isArbiterError = decision.reason.includes("timeout") || decision.reason.includes("unreachable") || decision.reason.includes("failed");
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
        // Write to log/hme-errors.log — direct file write (guaranteed) + shim (if running)
        const errLine = `[${new Date().toISOString()}] [arbiter] ${decision.reason} — fell back to ${decision.route}\n`;
        try { fs.mkdirSync(path.join(this._projectRoot, "log"), { recursive: true }); } catch {}
        try { fs.appendFileSync(path.join(this._projectRoot, "log", "hme-errors.log"), errLine); } catch {}
        logShimError("arbiter", decision.reason, `fell back to ${decision.route}`).catch(() => {});
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
      const entry = createSession(this._projectRoot, deriveTitle(msg.text));
      this._state.sessionEntry = entry;
      this._transcript.setSessionId(entry.id);
      this._transcript.logSessionStart(entry.id, entry.title, false);
      this._post({ type: "sessionCreated", session: entry });
    }

    // ── Log user message first so transcript order is correct ──
    const model = resolvedRoute === "local" || resolvedRoute === "hybrid" ? msg.ollamaModel : msg.claudeModel;
    this._transcript.logUser(msg.text, resolvedRoute, model);

    // ── Pre-send validation (async, after user is logged) ──
    validateMessage(msg.text).then(({ warnings, blocks }) => {
      this._transcript.logValidation(msg.text, warnings.length, blocks.length);
      if (blocks.length > 0) {
        const notice = blocks.map((b: any) => `⛔ [${b.title}] ${b.content}`).join("\n");
        this._post({ type: "notice", level: "block", text: `HME anti-pattern alert:\n${notice}` });
      } else if (warnings.length > 0) {
        const notice = warnings.map((w: any) => `⚠ [${w.title}]`).join(" · ");
        this._post({ type: "notice", level: "warn", text: `HME constraints: ${notice}` });
      }
    }).catch(() => {});

    // ── Mirror transcript to HTTP shim ──
    postTranscript([{
      ts: Date.now(), type: "user", route: resolvedRoute, model,
      content: msg.text, summary: `User [${resolvedRoute}]: ${msg.text.slice(0, 100)}`,
    }]).catch(() => {});

    const userMsg: ChatMessage = (msg as any)._queuedUserMsg ?? {
      id: uid(), role: "user", text: msg.text, route: resolvedRoute, ts: Date.now(),
    };
    this._state.messages.push(userMsg);
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
        // Inject prior local/hybrid conversation as context block so Claude has continuity
        const prior = this._state.messages
          .filter((m) => m.role === "user" || m.role === "assistant")
          .slice(0, -1) // exclude the current user message just pushed
          .slice(-12);  // cap at 12 messages to avoid huge context
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
    } else if (resolvedRoute === "hybrid") {
      this._streamHybrid(resolvedMsg, assistantId);
    } else {
      this._streamClaude(resolvedMsg, assistantId);
    }
  }

  private _streamClaude(msg: any, assistantId: string) {
    let text = "";
    let thinking = "";
    let tools: string[] = [];
    let streamEnded = false;
    const safeEnd = () => {
      if (streamEnded) return;
      streamEnded = true;
      this._drainQueue();
    };

    const onDone = () => {
      const assistantMsg: ChatMessage = {
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
      this._reindexFromTools(tools);
      this._runPostAudit();
      safeEnd();
    };

    const onChunk = (chunk: string, type: string) => {
      if (type === "text") { text += chunk; this._post({ type: "streamChunk", id: assistantId, chunkType: "text", chunk }); }
      else if (type === "thinking") { thinking += chunk; this._post({ type: "streamChunk", id: assistantId, chunkType: "thinking", chunk }); }
      else if (type === "tool") {
        tools.push(chunk);
        this._post({ type: "streamChunk", id: assistantId, chunkType: "tool", chunk });
        // Log tool call to transcript
        this._transcript.logToolCall(chunk.split("]")[0].replace("[", ""), chunk, msg._resolvedRoute ?? msg.route ?? "claude");
      }
      else if (type === "error") { this._post({ type: "streamChunk", id: assistantId, chunkType: "error", chunk }); }
    };

    const onError = (err: string) => {
      this._post({ type: "streamChunk", id: assistantId, chunkType: "error", chunk: err });
      if (!streamEnded) {
        this._post({ type: "streamEnd", id: assistantId });
        safeEnd();
      }
    };

    // Prepend prior-route context block if switching from local/hybrid → claude
    const effectiveText = (msg._contextPrefix ?? "") + msg.text;

    // Use PTY mode so hooks fire; fall back to -p mode if PTY fails
    this._cancelCurrent = streamClaudePty(
      effectiveText,
      this._state.claudeSessionId,
      { model: msg.claudeModel, effort: msg.claudeEffort, thinking: msg.claudeThinking, permissionMode: "bypassPermissions" },
      this._projectRoot,
      onChunk as any,
      (sessionId) => { this._state.claudeSessionId = sessionId; },
      onDone,
      (err) => {
        // PTY failed — fall back to stream-json mode silently
        console.log(`[HME Chat] PTY unavailable (${err}), falling back to -p mode`);
        this._cancelCurrent = streamClaude(
          effectiveText, this._state.claudeSessionId,
          { model: msg.claudeModel, effort: msg.claudeEffort, thinking: msg.claudeThinking, permissionMode: "bypassPermissions" },
          this._projectRoot, onChunk as any,
          (sessionId) => { this._state.claudeSessionId = sessionId; },
          (cost) => { onDone(); },
          onError
        );
      }
    );
  }

  /** Mirror assistant response to HTTP shim transcript. */
  private _mirrorAssistantToShim(text: string, route: string, model?: string, tools?: string[]) {
    postTranscript([{
      ts: Date.now(), type: "assistant", route, model,
      content: text.slice(0, 2000),
      summary: `Assistant [${route}]: ${text.slice(0, 100)}`,
      meta: tools?.length ? { tools } : undefined,
    }]).catch(() => {});
  }

  /**
   * Detect files modified by tool calls and trigger immediate mini-reindex.
   * Parses tool call strings for file paths (Edit, Write, Bash with redirect).
   */
  private _reindexFromTools(tools: string[]) {
    const files = new Set<string>();
    for (const t of tools) {
      // Match patterns like [Edit] {"file_path":"src/foo.js"...}
      const fileMatch = t.match(/"file_path"\s*:\s*"([^"]+)"/);
      if (fileMatch) files.add(fileMatch[1]);
      // Match [Write] patterns
      const writeMatch = t.match(/\[Write\].*?"([^"]+)"/);
      if (writeMatch) files.add(writeMatch[1]);
    }
    if (files.size > 0) {
      reindexFiles([...files]).catch(() => {});
    }
  }

  private _runPostAudit() {
    auditChanges().then(({ violations, changed_files }) => {
      this._transcript.logAudit(changed_files.length, violations.length);
      if (violations.length > 0) {
        const summary = violations
          .map((v: any) => `• [${v.category}] ${v.file}: ${v.title}`)
          .join("\n");
        this._post({ type: "notice", level: "audit", text: `HME post-audit (${changed_files.length} files changed):\n${summary}` });
      }
    }).catch(() => {});
  }

  private _streamOllama(msg: any, assistantId: string) {
    const requestHistory = [...this._state.ollamaHistory, { role: "user" as const, content: msg.text }];

    let text = "";
    let streamEnded = false;
    const safeEnd = () => {
      if (streamEnded) return;
      streamEnded = true;
      this._drainQueue();
    };

    this._cancelCurrent = streamOllama(
      requestHistory,
      { model: msg.ollamaModel, url: "http://localhost:11434" },
      (chunk, type) => {
        text += chunk;
        this._post({ type: "streamChunk", id: assistantId, chunkType: type, chunk });
      },
      () => {
        // Only commit to history on success to prevent dangling user message on error
        this._state.ollamaHistory.push({ role: "user", content: msg.text });
        this._state.ollamaHistory.push({ role: "assistant", content: text });
        const assistantMsg: ChatMessage = {
          id: assistantId, role: "assistant", text, route: "local", ts: Date.now(),
        };
        this._state.messages.push(assistantMsg);
        this._persistState();
        this._post({ type: "streamEnd", id: assistantId });
        this._transcript.logAssistant(text, "local", msg.ollamaModel);
        this._mirrorAssistantToShim(text, "local", msg.ollamaModel);
        this._runPostAudit();
        safeEnd();
      },
      (err) => {
        this._post({ type: "streamChunk", id: assistantId, chunkType: "error", chunk: err });
        if (!streamEnded) {
          this._post({ type: "streamEnd", id: assistantId });
          safeEnd();
        }
      }
    );
  }

  private _streamHybrid(msg: any, assistantId: string) {
    const history = [...this._state.ollamaHistory];
    let text = "";
    let cancelFn: (() => void) | undefined;
    let streamEnded = false;
    const safeEnd = () => {
      if (streamEnded) return;
      streamEnded = true;
      this._drainQueue();
    };

    // Post "enriching…" status
    this._post({ type: "streamChunk", id: assistantId, chunkType: "tool", chunk: "[HME] Enriching with KB context…" });

    streamHybrid(
      msg.text,
      history,
      { model: msg.ollamaModel, url: "http://localhost:11434" },
      (chunk, type) => {
        text += chunk;
        this._post({ type: "streamChunk", id: assistantId, chunkType: type, chunk });
      },
      () => {
        this._state.ollamaHistory.push({ role: "user", content: msg.text });
        this._state.ollamaHistory.push({ role: "assistant", content: text });
        const assistantMsg: ChatMessage = {
          id: assistantId, role: "assistant", text, route: "hybrid", ts: Date.now(),
        };
        this._state.messages.push(assistantMsg);
        this._persistState();
        this._post({ type: "streamEnd", id: assistantId });
        this._transcript.logAssistant(text, "hybrid", msg.ollamaModel);
        this._mirrorAssistantToShim(text, "hybrid", msg.ollamaModel);
        this._runPostAudit();
        safeEnd();
      },
      (err) => {
        this._post({ type: "streamChunk", id: assistantId, chunkType: "error", chunk: err });
        if (!streamEnded) {
          this._post({ type: "streamEnd", id: assistantId });
          safeEnd();
        }
      }
    ).then((cancel) => {
      cancelFn = cancel;
      this._cancelCurrent = () => cancelFn?.();
    }).catch((err) => {
      this._post({ type: "streamChunk", id: assistantId, chunkType: "error", chunk: String(err) });
      if (!streamEnded) {
        this._post({ type: "streamEnd", id: assistantId });
        safeEnd();
      }
    });
  }

  private _drainQueue() {
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

  private _post(data: any) {
    this._panel.webview.postMessage(data);
  }

  private _getHtml(): string {
    const htmlPath = path.join(__dirname, "..", "webview", "index.html");
    if (fs.existsSync(htmlPath)) {
      return fs.readFileSync(htmlPath, "utf8");
    }
    return getInlineHtml();
  }

  public dispose() {
    this._cancelCurrent?.();
    this._transcript.forceNarrative?.();
    ChatPanel.current = undefined;
    this._panel.dispose();
    this._disposables.forEach((d) => d.dispose());
    this._disposables = [];
  }
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function getInlineHtml(): string {
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
  #route-select { font-weight: bold; }
  #route-select option[value="claude"] { color: var(--route-claude); }
  #route-select option[value="local"]  { color: var(--route-local); }
  #route-select option[value="hybrid"] { color: var(--route-hybrid); }

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
  #cancel-btn {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--fg);
    border-radius: 4px;
    padding: 6px 12px;
    cursor: pointer;
    font-size: 12px;
    display: none;
  }
  #cancel-btn:hover { border-color: var(--error-fg); color: var(--error-fg); }
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
  <label>Route</label>
  <select id="route-select">
    <option value="auto">Auto</option>
    <option value="claude">Claude</option>
    <option value="local">Local</option>
    <option value="hybrid">Hybrid</option>
  </select>

  <!-- Claude controls -->
  <div class="claude-only" id="claude-controls" style="display:flex;gap:8px;align-items:center;">
    <label>Model</label>
    <select id="claude-model">
      <option value="claude-opus-4-6">Opus 4.6</option>
      <option value="claude-sonnet-4-6" selected>Sonnet 4.6</option>
      <option value="claude-haiku-4-5-20251001">Haiku 4.5</option>
    </select>
    <label>Effort</label>
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
  </div>

  <!-- Local controls -->
  <div class="local-only" id="local-controls" style="display:none;gap:8px;align-items:center;">
    <label>Model</label>
    <select id="local-model">
      <option value="qwen3-coder:30b">qwen3-coder:30b (GPU0 — coder)</option>
      <option value="qwen3:30b-a3b">qwen3:30b-a3b (GPU1 — reasoner)</option>
      <option value="qwen3:4b">qwen3:4b (arbiter — fast)</option>
    </select>
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
    <button id="cancel-btn">Cancel</button>
    <span id="status-line"></span>
  </div>
</div>

</div><!-- /main -->
</div><!-- /layout -->

<script>
const vscode = acquireVsCodeApi();

// ── State ──────────────────────────────────────────────────────────────────
let streaming = false;
let streamingId = null;
let streamTools = [];
let streamCurrentBody = null;    // active text block — nulled after each tool/thinking segment
let streamCurrentThinking = null; // active thinking block — nulled after each text/tool chunk

// ── UI refs ────────────────────────────────────────────────────────────────
const routeSel    = document.getElementById('route-select');
const claudeCtrls = document.getElementById('claude-controls');
const localCtrls  = document.getElementById('local-controls');
const claudeModel = document.getElementById('claude-model');
const claudeEffort= document.getElementById('claude-effort');
const thinkingChk = document.getElementById('thinking-toggle');
const localModel  = document.getElementById('local-model');
const messages    = document.getElementById('messages');
const input       = document.getElementById('msg-input');
const sendBtn     = document.getElementById('send-btn');
const cancelBtn   = document.getElementById('cancel-btn');
const statusLine  = document.getElementById('status-line');
const clearBtn    = document.getElementById('clear-btn');

// ── Route switching ────────────────────────────────────────────────────────
routeSel.addEventListener('change', () => {
  const r = routeSel.value;
  claudeCtrls.style.display = (r === 'claude' || r === 'hybrid' || r === 'auto') ? 'flex' : 'none';
  localCtrls.style.display  = (r === 'local' || r === 'auto') ? 'flex' : 'none';
});
// Fire initial state
claudeCtrls.style.display = 'flex';
localCtrls.style.display = 'flex';

// ── Send ───────────────────────────────────────────────────────────────────
function send() {
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  input.style.height = '';
  vscode.postMessage({
    type: 'send',
    text,
    route: routeSel.value,
    claudeModel: claudeModel.value,
    claudeEffort: claudeEffort.value,
    claudeThinking: thinkingChk.checked,
    ollamaModel: localModel.value,
  });
}

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
});
input.addEventListener('input', () => {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 200) + 'px';
});
sendBtn.addEventListener('click', send);
cancelBtn.addEventListener('click', () => vscode.postMessage({ type: 'cancel' }));
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
    case 'streamEnd':
      endStream(msg.id, msg.cost);
      break;
    case 'cancelConfirmed':
      endStream(streamingId, undefined);
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
  streamingId = id;
  streamTools = [];
  streamCurrentBody = null;
  streamCurrentThinking = null;

  const div = document.createElement('div');
  div.className = 'msg assistant';
  div.id = \`msg-\${id}\`;

  const header = document.createElement('div');
  header.className = 'msg-header';
  header.innerHTML = \`<span>Assistant</span><span class="route-badge route-\${route}">\${route}</span><span class="model-badge">\${model}</span>\`;

  div.appendChild(header);
  messages.appendChild(div);

  cancelBtn.style.display = 'inline-block';
  setStatus('Streaming…');
  messages.scrollTop = messages.scrollHeight;
}

function appendChunk(id, chunkType, chunk) {
  const div = document.getElementById(\`msg-\${id}\`);
  if (!div) return;

  if (chunkType === 'thinking') {
    // Each thinking segment gets its own block; nulled by text/tool chunks
    if (!streamCurrentThinking) {
      streamCurrentThinking = document.createElement('details');
      streamCurrentThinking.className = 'thinking';
      streamCurrentThinking.open = true;
      streamCurrentThinking.innerHTML = \`<summary>🧠 Thinking…</summary><div class="thinking-body"></div>\`;
      div.appendChild(streamCurrentThinking);
    }
    streamCurrentThinking.querySelector('.thinking-body').textContent += chunk;
  } else if (chunkType === 'tool') {
    // Hide cursor in current text block — prevents multiple cursors animating at once
    streamCurrentBody?.querySelector('.stream-cursor')?.classList.add('done');
    streamCurrentBody = null;
    streamCurrentThinking = null;
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
    streamCurrentThinking = null; // entering text mode — close current thinking segment
    // text — one block per inter-tool segment
    if (!streamCurrentBody) {
      streamCurrentBody = document.createElement('div');
      streamCurrentBody.className = 'msg-body';
      const cur = document.createElement('span');
      cur.className = 'stream-cursor';
      cur.textContent = '▊';
      streamCurrentBody.appendChild(cur);
      div.appendChild(streamCurrentBody);
    }
    const cur = streamCurrentBody.querySelector('.stream-cursor');
    streamCurrentBody.insertBefore(document.createTextNode(chunk), cur);
  }
  messages.scrollTop = messages.scrollHeight;
}

function endStream(id, cost) {
  streaming = false;
  streamingId = null;
  streamCurrentBody = null;
  streamCurrentThinking = null;
  cancelBtn.style.display = 'none';

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

  setStatus(cost !== undefined ? \`Cost: $\${cost?.toFixed(4) ?? '?'}\` : '');
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
let sidebarVisible = true;
sidebarToggleBtn?.addEventListener('click', () => {
  sidebarVisible = !sidebarVisible;
  if (sidebar) sidebar.style.display = sidebarVisible ? 'flex' : 'none';
  if (sidebarToggleBtn) sidebarToggleBtn.style.color = sidebarVisible ? 'var(--subtle)' : 'var(--btn-fg)';
});

// ── Zoom controls ──────────────────────────────────────────────────────────
let zoomLevel = 1.0;
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
});
document.getElementById('zoom-out-btn')?.addEventListener('click', () => {
  zoomLevel = Math.max(ZOOM_MIN, Math.round((zoomLevel - ZOOM_STEP) * 10) / 10);
  applyZoom();
});

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
    vscode.setState({ activeSessionId });
    vscode.postMessage({ type: 'listSessions' });
  } else if (msg.type === 'sessionLoaded') {
    activeSessionId = msg.id;
    vscode.setState({ activeSessionId });
    messages.innerHTML = '';
    for (const m of msg.messages) appendMessage(m);
    setStatus(\`Loaded: \${msg.title}\`);
    vscode.postMessage({ type: 'listSessions' });
  } else if (msg.type === 'historyCleared') {
    activeSessionId = null;
    vscode.setState({ activeSessionId: null });
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
      shimStatus.textContent = event.data.ready ? 'HME ●' : 'HME ○';
      shimStatus.style.color = event.data.ready ? 'var(--route-hybrid)' : 'var(--subtle)';
      shimStatus.title = event.data.ready ? 'HME KB shim: ready' : 'HME KB shim: not running (start hme_http.py)';
    }
  }
}, true);
// Check on load and when switching to hybrid
checkShim();
routeSel.addEventListener('change', () => {
  if (routeSel.value === 'hybrid') checkShim();
});
</script>
</body>
</html>`;
}
