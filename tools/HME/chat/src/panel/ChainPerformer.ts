import * as path from "path";
import * as fs from "fs";
import { ChatMessage } from "../types";
import { ChainLink, saveChainLink, loadChainSummaries } from "../session/SessionStore";
import { synthesizeChainSummary } from "../Arbiter";
import { buildSummaryPrompt, buildFallbackSummary } from "../session/chatChain";
import { uid } from "../streamUtils";
import { PanelHost } from "./PanelHost";

// Fire chain at 99% — meter reaches this before autocompact kicks in.
export const CHAIN_THRESHOLD_PCT = 99;

/**
 * The panel exposes this narrow surface to the ChainPerformer so it can
 * rotate session state when a chain link is saved. Keeps the performer
 * from taking a reference to the full BrowserPanel.
 */
export interface ChainSessionBridge {
  getSessionId(): string | null;
  getMessages(): ChatMessage[];
  getChainIndex(): number;
  getClaudeSessionId(): string | null;
  getContextPct(): number;
  hasMeterLiveUpdate(): boolean;
  /**
   * Clear messages + claude session id, advance chainIndex, reset context meter
   * (silently — no webview post), then seed messages with the continuation user
   * message and persist. The ChainPerformer will request postContextUpdate()
   * explicitly so the event order is: chainCompleted → notice → contextUpdate.
   */
  rotate(continuationMsg: ChatMessage, newChainIndex: number): void;
  postContextUpdate(): void;
}

export class ChainPerformer {
  private _inProgress = false;

  constructor(
    private readonly projectRoot: string,
    private readonly host: PanelHost,
    private readonly session: ChainSessionBridge,
  ) {}

  get inProgress(): boolean {
    return this._inProgress;
  }

  /**
   * If context pct has crossed the chain threshold and no chain is already
   * running, synthesize a chain link summary and rotate the session.
   */
  maybeChain(): void {
    if (!this.session.hasMeterLiveUpdate()) return;
    if (this.session.getContextPct() < CHAIN_THRESHOLD_PCT) return;
    if (this._inProgress) return;
    this._performChain().catch((e) => {
      console.error(`[HME Chat] Chain failed: ${e}`);
      this.host.postError("chain", String(e));
      this._inProgress = false;
    });
  }

  private async _performChain(): Promise<void> {
    const sessionId = this.session.getSessionId();
    if (!sessionId || this._inProgress) return;
    this._inProgress = true;
    try {
      await this._performChainInner(sessionId);
    } finally {
      this._inProgress = false;
    }
  }

  private async _performChainInner(sessionId: string): Promise<void> {
    const linkIndex = this.session.getChainIndex();

    this.host.post({
      type: "notice", level: "info",
      text: `Context chain: saving link ${linkIndex + 1} and generating summary...`,
    });

    const todos = this._loadTodos();
    const priorSummaries = loadChainSummaries(this.projectRoot, sessionId);
    const messages = this.session.getMessages();
    const summaryPrompt = buildSummaryPrompt(messages, todos, priorSummaries);

    let summary = "";
    try {
      summary = await synthesizeChainSummary(summaryPrompt);
    } catch (e) {
      console.error(`[HME Chat] Chain summary via local model failed: ${e}`);
      summary = buildFallbackSummary(messages, todos, priorSummaries);
    }

    const link: ChainLink = {
      index: linkIndex,
      sessionId,
      messages: [...messages],
      summary,
      todos,
      contextTokens: this.session.getContextPct(),
      claudeSessionId: this.session.getClaudeSessionId(),
      createdAt: Date.now(),
    };
    saveChainLink(this.projectRoot, link);

    const continuationMsg: ChatMessage = {
      id: uid(),
      role: "user",
      text: `[Context Chain — Link ${linkIndex + 1} continuation]\n\n${summary}`,
      route: "claude",
      ts: Date.now(),
    };
    const newChainIndex = linkIndex + 1;
    this.session.rotate(continuationMsg, newChainIndex);

    this.host.post({ type: "chainCompleted", linkIndex, chainIndex: newChainIndex });
    this.host.post({
      type: "notice", level: "info",
      text: `Context chain: link ${linkIndex + 1} saved. Fresh context resumed.`,
    });
    this.session.postContextUpdate();
  }

  private _loadTodos(): any[] {
    try {
      // Project-local todo store. Previously pointed at ~/.claude/mcp/HME/todos.json
      // (the deleted home-dir MCP symlink), which never actually existed — ENOENT
      // was silently swallowed and the method always returned []. todo.py writes
      // todos.json inside the project tree; that's the canonical path.
      const todoPath = path.join(this.projectRoot, ".claude", "mcp", "HME", "todos.json");
      return JSON.parse(fs.readFileSync(todoPath, "utf8"));
    } catch (e: any) {
      if (e?.code !== "ENOENT") console.error(`[HME] Failed to load todos.json: ${e?.message ?? e}`);
      return [];
    }
  }
}
