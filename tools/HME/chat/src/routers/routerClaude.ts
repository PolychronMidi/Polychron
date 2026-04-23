import { spawn } from "child_process";
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

function buildClaudeEnv(): Record<string, string> {
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

function buildClaudeArgs(
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

//  Claude CLI (pipe mode)

export function streamClaude(
  message: string,
  sessionId: string | null,
  opts: ClaudeOptions,
  workingDir: string,
  onChunk: ChunkCallback,
  onSessionId: (id: string) => void,
  onDone: (cost?: number, usage?: TokenUsage) => void,
  onError: (msg: string) => void
): () => void {
  // opts.thinking: Extended thinking blocks come through natively in stream-json --verbose.
  const args = buildClaudeArgs(opts, sessionId, ["-p", "--output-format", "stream-json", "--verbose"]);

  const env = buildClaudeEnv();
  // The statusline hook always writes to /tmp/claude-context.json in Claude Code's
  // environment — setting HME_CTX_FILE on the subprocess env has no effect on the
  // hook. Read the fixed path directly.
  const ctxFile = `/tmp/claude-context.json`;

  const proc = spawn("claude", args, {
    cwd: workingDir,
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });

  proc.stdin.write(message);
  proc.stdin.end();

  const _readCtxFile = (): Partial<TokenUsage> => {
    try {
      const d = JSON.parse(readFileSync(ctxFile, "utf8"));
      const usedPct = sanitizeUsedPct(d.used_pct, `streamClaude:ctxFile:${ctxFile}`);
      return {
        ...(usedPct != null ? { usedPct } : {}),
        ...(d.model_id ? { modelId: d.model_id } : {}),
        ...(d.model_name ? { modelName: d.model_name } : {}),
      };
    } catch {
      return {};
    }
  };

  let buf = "";
  let doneFired = false;
  // Store result-event data; emit after close so the Stop hook has already
  // written the real API used_pct to ctxFile before we read it.
  let pendingCost: number | undefined;
  let pendingUsage: TokenUsage | undefined;
  let resultReceived = false;

  const storeResult = (cost?: number, usage?: TokenUsage) => {
    resultReceived = true;
    pendingCost = cost;
    pendingUsage = usage;
  };

  const finalize = (code: number | null) => {
    if (doneFired) return;
    doneFired = true;
    // Read used_pct from statusline-raw — the statusline hook writes this for
    // every Claude Code session. used_percentage is the direct API value, no math.
    let ctxOverride: Partial<TokenUsage> = {};
    try {
      const raw = JSON.parse(readFileSync("/tmp/claude-statusline-raw.json", "utf8"));
      const usedPct = sanitizeUsedPct(raw?.context_window?.used_percentage, "streamClaude:statusline-raw");
      if (usedPct != null) {
        ctxOverride = {
          usedPct,
          modelId: raw?.model?.id || undefined,
          modelName: raw?.model?.display_name || undefined,
        };
      }
    } catch {}
    if (ctxOverride.usedPct == null) ctxOverride = _readCtxFile();
    const base = resultReceived ? pendingUsage : undefined;
    const merged: TokenUsage | undefined = base
      ? { ...base, ...ctxOverride }
      : (ctxOverride.usedPct != null ? { inputTokens: 0, outputTokens: 0, ...ctxOverride } as TokenUsage : undefined);
    onDone(pendingCost, merged);
  };

  const INACTIVITY_MS = 30000;
  let inactivityTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
    if (!doneFired) {
      doneFired = true;
      try { proc.kill(); } catch {}
      onError(`CRITICAL: Claude CLI produced no output for ${INACTIVITY_MS / 1000}s — API may be down or rate-limited`);
    }
  }, INACTIVITY_MS);
  const resetInactivity = () => {
    if (inactivityTimer) { clearTimeout(inactivityTimer); inactivityTimer = null; }
  };

  proc.stdout.on("data", (data: Buffer) => {
    resetInactivity();
    buf += data.toString("utf8");
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const evt = JSON.parse(line);
        handleStreamEvent(evt, opts.model, onChunk, onSessionId, storeResult);
      } catch (e) {
        console.error(`[HME] stream JSON parse failed: ${(e as any)?.message ?? e} | line: ${line.slice(0, 120)}`);
        if (line.trim()) onChunk(line.trim(), "error");
      }
    }
  });

  proc.stderr.on("data", (data: Buffer) => {
    resetInactivity();
    const text = data.toString("utf8").trim();
    if (text) onError(text);
  });

  proc.on("close", (code) => {
    resetInactivity();
    if (buf.trim()) {
      try {
        const evt = JSON.parse(buf.trim());
        handleStreamEvent(evt, opts.model, onChunk, onSessionId, storeResult);
      } catch (e) {
        console.error(`[HME] close-buf JSON parse failed: ${(e as any)?.message ?? e} | buf: ${buf.slice(0, 120)}`);
        onChunk(buf.trim(), "error");
      }
    }
    if (code !== 0) { onError(`Claude CLI exited with code ${code}`); return; }
    finalize(code);
  });

  return () => { try { proc.kill(); } catch {} };
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

function computeTurnUsage(
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

function handleStreamEvent(
  evt: any,
  uiModelAlias: string,
  onChunk: ChunkCallback,
  onSessionId: (id: string) => void,
  onDone: (cost?: number, usage?: TokenUsage) => void
) {
  if (evt.type === "system" && evt.subtype === "init" && evt.session_id) {
    onSessionId(evt.session_id);
    return;
  }

  if (evt.type === "assistant" && evt.message?.content) {
    for (const block of evt.message.content) {
      if (block.type === "thinking" && block.thinking) {
        onChunk(block.thinking, "thinking");
      } else if (block.type === "text" && block.text) {
        onChunk(block.text, "text");
      } else if (block.type === "tool_use") {
        onChunk(`[${block.name}] ${JSON.stringify(block.input ?? {}, null, 2)}`, "tool");
      }
    }
    return;
  }

  if (evt.type === "result") {
    const inputTokens: number | undefined = evt.usage?.input_tokens;
    const outputTokens: number | undefined = evt.usage?.output_tokens;
    const usage = computeTurnUsage(evt, uiModelAlias, inputTokens, outputTokens);
    onDone(evt.total_cost_usd ?? evt.cost_usd ?? undefined, usage);
    return;
  }
}
