import { ContextTracker } from "../streamUtils";
import { TokenUsage } from "../router";
import { listChainLinks } from "../session/SessionStore";
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
  private _hasLiveUpdate = false;

  constructor(
    private readonly projectRoot: string,
    private readonly host: PanelHost,
    private readonly errorSink?: { post: (source: string, message: string) => void },
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

  /** True only after at least one live response has updated the meter this session. */
  get hasLiveUpdate(): boolean {
    return this._hasLiveUpdate;
  }

  reset(args: ContextPostArgs, restoredPct?: number): void {
    this._tracker = ContextMeter._blank();
    this._hasLiveUpdate = false;
    if (restoredPct) this._tracker.usedPct = restoredPct;
    this.post(args);
  }

  /**
   * Clear the tracker without posting. Caller is responsible for posting
   * an update when it wants the webview to see the cleared state.
   */
  resetSilently(): void {
    this._tracker = ContextMeter._blank();
    this._hasLiveUpdate = false;
  }

  update(text: string, thinking: string, model: string, usage: TokenUsage | undefined, args: ContextPostArgs): void {
    this._tracker.model = model;
    this._tracker.totalChars += text.length + (thinking?.length ?? 0);
    if (usage) {
      this._tracker.lastInputTokens = usage.inputTokens;
      this._tracker.lastOutputTokens = usage.outputTokens;
      // Defense in depth: a fabricated percentage (e.g. 1456% from dividing
      // a 1M-model's load by a 200k default) must never overwrite the
      // tracker. The router-level computeTurnUsage should already drop these,
      // but other callers (PTY path, llama routes) feed this method too.
      // Accept only finite values in [0, 110]. Anything else is logged and
      // ignored, preserving the last known good pct.
      if (usage.usedPct != null) {
        if (Number.isFinite(usage.usedPct) && usage.usedPct >= 0 && usage.usedPct <= 110) {
          this._tracker.usedPct = usage.usedPct;
        } else {
          const msg = `ContextMeter rejected out-of-range usedPct=${usage.usedPct} ` +
            `(model=${model}, modelId=${usage.modelId ?? "?"}). Keeping previous value ${this._tracker.usedPct}.`;
          console.error(`[HME] ${msg}`);
          if (this.errorSink) this.errorSink.post("ContextMeter.update", msg);
        }
      }
      if (usage.modelId) this._tracker.cliModelId = usage.modelId;
      if (usage.modelName) this._tracker.cliModelName = usage.modelName;
    }
    this._hasLiveUpdate = true;
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
