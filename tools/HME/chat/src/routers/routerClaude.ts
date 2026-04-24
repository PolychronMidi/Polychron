import { readFileSync, appendFileSync } from "fs";
import { ClaudeOptions, ChunkCallback, TokenUsage } from "../router";

// Env vars that a parent Claude Code session passes to its children. If we
// pass them to the spawned `claude` child, v2.1.118 detects a nested session
// and exits with code 0 at ~450ms with no output. Strip them so the child
// boots as a fresh Claude Code session.
const PARENT_CLAUDE_SESSION_VARS = new Set([
  "CLAUDECODE",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_EXECPATH",
  "CLAUDE_CODE_SSE_PORT",
  "CLAUDE_AGENT_SDK_VERSION",
  "CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING",
]);

export function buildClaudeEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k === "ANTHROPIC_API_KEY") continue;
    if (PARENT_CLAUDE_SESSION_VARS.has(k)) continue;
    if (v !== undefined) env[k] = v;
  }
  if (!env["PATH"]?.includes(".local/bin")) {
    env["PATH"] = `/home/${process.env["USER"] ?? "jah"}/.local/bin:${env["PATH"] ?? "/usr/local/bin:/usr/bin:/bin"}`;
  }
  return env;
}

//  Shared CLI arg builder

export function buildClaudeArgs(
  opts: ClaudeOptions,
  sessionId: string | null,
  prefix: string[],
): string[] {
  const args = [
    ...prefix,
    "--model", opts.model,
    "--effort", opts.effort,
    "--permission-mode", opts.permissionMode || "acceptEdits",
    // Thinking is a separate independent toggle — delivered via inline --settings JSON.
    "--settings", JSON.stringify({ alwaysThinkingEnabled: !!opts.thinking }),
  ];
  if (sessionId) args.push("--resume", sessionId);
  return args;
}

//  Claude CLI — pool-backed long-lived process
//
// Each chat session gets ONE persistent `claude` process from
// claudeProcessPool. Turn 1 builds the prompt cache; turn 2+ hits it — the
// 10x-context / 10x-latency regression versus VS Code was caused by the
// former per-message spawn + --resume hydration, not by anything the proxy
// does. Subscription billing is preserved because we still use the CLI.

export function streamClaude(
  chatSessionId: string,
  message: string,
  sessionId: string | null,
  opts: ClaudeOptions,
  workingDir: string,
  onChunk: ChunkCallback,
  onSessionId: (id: string) => void,
  onDone: (cost?: number, usage?: TokenUsage) => void,
  onError: (msg: string) => void
): () => void {
  // Lazy-imported to avoid the circular dep (pool imports from this module).
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { getOrSpawnProcess } = require("./claudeProcessPool") as typeof import("./claudeProcessPool");
  const proc = getOrSpawnProcess(chatSessionId, sessionId, opts, workingDir);

  // Merge the statusline-raw fallback onto usage — the result event already
  // has the authoritative usedPct via computeTurnUsage, but the fallback
  // catches regressions (e.g. if Anthropic ships a CLI that stops emitting
  // modelUsage.contextWindow, the meter keeps working).
  const wrappedOnDone = (cost?: number, usage?: TokenUsage) => {
    let merged = usage;
    if (!merged || merged.usedPct == null) {
      try {
        const raw = JSON.parse(readFileSync("/tmp/claude-statusline-raw.json", "utf8"));
        const usedPct = sanitizeUsedPct(raw?.context_window?.used_percentage, "streamClaude:statusline-raw");
        if (usedPct != null) {
          merged = {
            ...(merged ?? { inputTokens: 0, outputTokens: 0 }),
            usedPct,
            modelId: raw?.model?.id || merged?.modelId,
            modelName: raw?.model?.display_name || merged?.modelName,
          };
        }
      } catch { /* silent-ok: statusline file absent, keep merged as-is */ }
    }
    onDone(cost, merged);
  };

  return proc.startTurn(message, {
    onChunk, onSessionId, onDone: wrappedOnDone, onError,
  });
}

// Sanity bounds for a reported/computed usedPct.
//
// HARD CEILING (100.5%) — anything above is a bug by definition. A context
// window is a fixed denominator; >100% means the denominator is wrong (the
// 1M-vs-200k bug that shipped 1456% as a "real" value). 0.5% of slop
// accommodates floating-point rounding without admitting a 105% miscalc.
//
// SUSPICIOUS BAND (95..100%) — legitimately reachable only after a long
// session; on turn 1-2 it's almost certainly a miscalculation. Values in
// this band still propagate (we can't prove they're wrong) but also emit a
// `suspicious_pct` rejection so investigations leave a trace.
export const USED_PCT_HARD_CEILING = 100.5;
export const USED_PCT_SUSPICIOUS_FLOOR = 95;
// Legacy export — callers outside this module still reference the old name
// for the hard ceiling. Kept as an alias rather than removed so a third-party
// import doesn't silently resolve to undefined.
export const USED_PCT_SANITY_CEILING = USED_PCT_HARD_CEILING;

// Module-level error sink for sanitizer rejections. Set once at panel init
// by BrowserPanel so every rejection lands in hme-errors.log and surfaces
// in the userpromptsubmit banner next turn. console.error alone vanishes.
let _sanitizerSink: { post: (source: string, message: string) => void } | null = null;
export function setSanitizerErrorSink(sink: { post: (source: string, message: string) => void } | null): void {
  _sanitizerSink = sink;
}

// Module-level turn-number getter. BrowserPanel sets this so the sanitizer
// can distinguish "turn 1 reporting 99%" (almost always a miscalc) from
// "turn 20 reporting 99%" (plausibly real). Defaults to null, which means
// "unknown turn — skip the suspicious-band check" rather than silently
// treating every reading as not-suspicious.
let _getTurnNumber: (() => number | null) | null = null;
export function setTurnNumberProvider(fn: (() => number | null) | null): void {
  _getTurnNumber = fn;
}
function _reportRejection(source: string, message: string): void {
  console.error(`[HME] ${message}`);
  if (_sanitizerSink) {
    _sanitizerSink.post(source, message);
  } else {
    // Sink not wired yet (e.g. called before BrowserPanel init). Write directly
    // so the LIFESAVER can catch it — never silently drop a rejection.
    const root = process.env["PROJECT_ROOT"] ?? "";
    if (root) {
      try {
        appendFileSync(
          `${root}/log/hme-errors.log`,
          `[${new Date().toISOString()}] [${source}] ${message}\n`,
        );
      } catch (_e) { /* last resort already logged to console above */ }
    }
  }
}

/**
 * Single sanitization gate for every path that produces a usedPct.
 *
 * Returns `undefined` (meter keeps last known value) when:
 *  - raw is null/undefined (no signal)
 *  - raw is non-finite or out of [0, USED_PCT_HARD_CEILING]
 *
 * When raw lands in the SUSPICIOUS band [USED_PCT_SUSPICIOUS_FLOOR, 100.5]
 * AND `turnNumber` is ≤ 2, the value still propagates (we can't prove it's
 * wrong) but emits a high-priority `suspicious_pct` rejection so post-hoc
 * investigations find a trace. Turn 1-2 at 95%+ is the exact signature of
 * the 1M-vs-200k miscalc that shipped before this guard existed.
 *
 * Call sites: result-event computeTurnUsage, PTY /context parseContextOutput,
 * PTY ctxFile _buildPtyUsage.
 */
export function sanitizeUsedPct(
  raw: unknown,
  source: string,
  turnNumberOverride?: number,
): number | undefined {
  const turnNumber = turnNumberOverride ?? (_getTurnNumber ? _getTurnNumber() ?? undefined : undefined);
  if (raw == null) return undefined;
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    _reportRejection("sanitizeUsedPct", `sanitizeUsedPct(${source}) rejected non-finite value: ${JSON.stringify(raw)}`);
    return undefined;
  }
  if (raw < 0 || raw > USED_PCT_HARD_CEILING) {
    _reportRejection(
      "sanitizeUsedPct",
      `sanitizeUsedPct(${source}) rejected out-of-range value ${raw} (hard ceiling ${USED_PCT_HARD_CEILING})`
    );
    return undefined;
  }
  // Suspicious band: value is numerically plausible but suspicious on early
  // turns. Log but propagate — never silently drop data that might be real.
  if (raw >= USED_PCT_SUSPICIOUS_FLOOR && turnNumber != null && turnNumber <= 2) {
    _reportRejection(
      "sanitizeUsedPct",
      `sanitizeUsedPct(${source}) suspicious_pct: ${raw}% on turn ${turnNumber} ` +
      `(values >=${USED_PCT_SUSPICIOUS_FLOOR}% so early almost always indicate a miscalc). ` +
      `Value propagated — investigate if the meter triggers a chain soon.`
    );
  }
  return Math.round(raw * 10) / 10;
}

export function computeTurnUsage(
  evt: any,
  uiModelAlias: string,
  inputTokens: number | undefined,
  outputTokens: number | undefined,
): TokenUsage | undefined {
  if (inputTokens == null || outputTokens == null) return undefined;
  const modelUsage = evt.modelUsage;
  if (!modelUsage || typeof modelUsage !== "object") {
    _reportRejection("computeTurnUsage", `result event missing modelUsage — usedPct cannot be computed (uiAlias=${uiModelAlias})`);
    return { inputTokens, outputTokens, usedPct: undefined };
  }
  const entries = Object.entries(modelUsage) as [string, any][];
  const prefix = `claude-${uiModelAlias}-`;
  const match = entries.find(([k]) => k.startsWith(prefix));
  if (!match) {
    // UI alias doesn't match any modelUsage key. Hard fail — don't guess.
    // Surfacing this loudly catches CLI naming drift (e.g. a future
    // "claude-opus5-..." key that no longer matches "claude-opus-").
    _reportRejection(
      "computeTurnUsage",
      `no modelUsage entry matches UI alias "${uiModelAlias}" (prefix="${prefix}"). Available keys: ${entries.map(e => e[0]).join(", ")}`
    );
    return { inputTokens, outputTokens, usedPct: undefined };
  }
  const [modelKey, modelEntry] = match;
  const contextWindow: unknown = modelEntry?.contextWindow;
  if (typeof contextWindow !== "number" || !Number.isFinite(contextWindow) || contextWindow < 1000) {
    _reportRejection(
      "computeTurnUsage",
      `invalid contextWindow on modelUsage["${modelKey}"]: ${JSON.stringify(contextWindow)} — usedPct skipped (uiAlias=${uiModelAlias})`
    );
    return { inputTokens, outputTokens, usedPct: undefined, modelId: modelKey, modelName: modelEntry?.modelName };
  }
  // Use the last iteration's cache_read as the context fill — multi-turn tool
  // calls produce multiple iterations, each re-reading the full cache, so summing
  // across iterations gives a multiple of the real fill. The last iteration's
  // cache_read_input_tokens IS the actual window occupancy this turn.
  const iterations: any[] = evt.usage?.iterations ?? [];
  const lastIter = iterations[iterations.length - 1] ?? {};
  const fill = (lastIter.input_tokens ?? 0)
    + (lastIter.cache_read_input_tokens ?? 0)
    + (lastIter.cache_creation_input_tokens ?? 0);
  const rawPct = (fill / contextWindow) * 100;
  const usedPct = sanitizeUsedPct(rawPct, `computeTurnUsage:fill=${fill},ctxWindow=${contextWindow},model=${modelKey}`);
  return {
    inputTokens,
    outputTokens,
    usedPct,
    modelId: modelKey,
    modelName: modelEntry?.modelName,
  };
}

// handleStreamEvent was the per-message stream-json parser for the former
// fire-and-forget streamClaude. The pool now owns event parsing inline
// (claudeProcessPool.ts _handleEvent) because it needs to distinguish "first
// init event of a long-lived process" from "per-turn event."
