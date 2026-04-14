import { ContextTracker } from "../streamUtils";
import { TokenUsage } from "../router";
import { listChainLinks } from "../SessionStore";
import { PanelHost } from "./PanelHost";

/**
 * Owns the context-percent tracker: accumulates token usage, exposes the
 * current pct for chain-threshold checks, and posts `contextUpdate` messages
 * to the webview.
 *
 * Knows nothing about sessions or chains directly — callers hand in the
 * current sessionId (for chainLink count lookup) and chainIndex at post time.
 */
export interface ContextPostArgs {
  sessionId: string | null;
  chainIndex: number;
}

export class ContextMeter {
  private _tracker: ContextTracker = ContextMeter._blank();

  constructor(
    private readonly projectRoot: string,
    private readonly host: PanelHost,
  ) {}

  private static _blank(): ContextTracker {
    return {
      lastInputTokens: null, lastOutputTokens: null, usedPct: null,
      totalChars: 0, model: "", cliModelId: null, cliModelName: null,
    };
  }

  get pctUsed(): number {
    return this._tracker.usedPct ?? 0;
  }

  reset(args: ContextPostArgs, restoredPct?: number): void {
    this._tracker = ContextMeter._blank();
    if (restoredPct) this._tracker.usedPct = restoredPct;
    this.post(args);
  }

  /**
   * Clear the tracker without posting. Caller is responsible for posting
   * an update when it wants the webview to see the cleared state.
   */
  resetSilently(): void {
    this._tracker = ContextMeter._blank();
  }

  update(text: string, thinking: string, model: string, usage: TokenUsage | undefined, args: ContextPostArgs): void {
    this._tracker.model = model;
    this._tracker.totalChars += text.length + (thinking?.length ?? 0);
    if (usage) {
      this._tracker.lastInputTokens = usage.inputTokens;
      this._tracker.lastOutputTokens = usage.outputTokens;
      if (usage.usedPct != null) this._tracker.usedPct = usage.usedPct;
      if (usage.modelId) this._tracker.cliModelId = usage.modelId;
      if (usage.modelName) this._tracker.cliModelName = usage.modelName;
    }
    this.post(args);
  }

  post(args: ContextPostArgs): void {
    const chainLinkCount = args.sessionId
      ? listChainLinks(this.projectRoot, args.sessionId).length
      : 0;
    this.host.post({
      type: "contextUpdate",
      pct: this.pctUsed,
      chainLinks: chainLinkCount,
      chainIndex: args.chainIndex,
      cliModel: this._tracker.cliModelName || this._tracker.cliModelId || undefined,
    });
  }
}
