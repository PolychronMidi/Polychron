import * as path from "path";
import * as fs from "fs";
import { ChatMessage } from "../types";
import { ChainLink, saveChainLink, loadChainSummaries } from "../session/SessionStore";
import { synthesizeChainSummary } from "../Arbiter";
import { buildSummaryPrompt, buildFallbackSummary } from "../session/chatChain";
import { uid } from "../streamUtils";
import { PanelHost } from "./PanelHost";

// Fire chain at a per-model percentage. Smaller models (200k context,
// Sonnet default) need to rotate earlier because absolute headroom is
// tiny: 15% of 200k = 30k tokens, which is the minimum for Stage 1A+1B
// extract + Stage 2 synthesis. Larger models (1M context, Sonnet 1M or
// Opus 1M) can rotate later because 10% of 1M = 100k tokens is plenty.
// Auto-compaction by Claude Code fires at ~92-95%, so the threshold
// must stay below that regardless of model size.
export const CHAIN_THRESHOLD_PCT = 85;  // legacy constant — still exported for compatibility

/** Resolve per-model chain-rotation threshold. Model id is the full
 *  CLI key from token usage (e.g. "claude-sonnet-4-6", "claude-opus-4-7-1m").
 *  Returns percentage-of-context at which rotation should fire. */
export function resolveChainThresholdPct(modelId?: string | null): number {
  if (!modelId) return CHAIN_THRESHOLD_PCT;
  const lower = modelId.toLowerCase();
  // 1M-context variants: rotate later because absolute headroom is large.
  if (lower.includes("1m") || lower.includes("-1m") || lower.includes("_1m")) {
    return 90;
  }
  // Opus with default context is ~200k.
  if (lower.includes("opus")) {
    return 82;
  }
  // Sonnet default (200k) and everything else.
  return CHAIN_THRESHOLD_PCT;
}

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
    private readonly errorSink?: { post: (source: string, message: string) => void },
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
    const pct = this.session.getContextPct();
    // Fail-fast against fabricated percentages. A healthy meter reads in
    // [0, 100]; values above that are the exact bug class that caused a
    // premature chain fire on turn 1 (1456% from a 1M/200k mismatch).
    // Refuse to rotate on an impossible reading — log loudly and return.
    if (!Number.isFinite(pct) || pct < 0 || pct > 110) {
      const msg = `maybeChain refusing to fire with out-of-range pct=${pct}. ` +
        `Upstream computeTurnUsage and ContextMeter.update should have dropped this — ` +
        `investigate the token-accounting path.`;
      console.error(`[HME Chat] ${msg}`);
      if (this.errorSink) this.errorSink.post("ChainPerformer.maybeChain", msg);
      this.host.postError("chain", `invalid context pct=${pct} — chain suppressed`);
      return;
    }
    if (pct < CHAIN_THRESHOLD_PCT) return;
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
      // Project-local todo store. todo.py writes tools/HME/KB/todos.json.
      const todoPath = path.join(this.projectRoot, "tools", "HME", "KB", "todos.json");
      return JSON.parse(fs.readFileSync(todoPath, "utf8"));
    } catch (e: any) {
      if (e?.code !== "ENOENT") console.error(`[HME] Failed to load todos.json: ${e?.message ?? e}`);
      return [];
    }
  }
}
