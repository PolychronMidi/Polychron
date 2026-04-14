import { spawn } from "child_process";
import { readFileSync, appendFileSync } from "fs";
import { ClaudeOptions, ChunkCallback, TokenUsage } from "./router";

// node-pty is loaded lazily — a native module crash must never take down the extension host.
let _pty: typeof import("node-pty") | null = null;
function getPty(): typeof import("node-pty") | null {
  if (_pty) return _pty;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    _pty = require("node-pty");
    return _pty;
  } catch (e) {
    console.error(`[HME] node-pty unavailable — PTY mode disabled, falling back to -p: ${(e as any)?.message ?? e}`);
    return null;
  }
}

const HME_LOG = "/tmp/hme-ctx-debug.log";
function hmeLog(msg: string) {
  try { appendFileSync(HME_LOG, `[${new Date().toISOString()}] ${msg}\n`); } catch (e) {
    try { appendFileSync("/tmp/hme-log-fail.txt", String(e) + "\n"); } catch {}
  }
}

function buildClaudeEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k !== "ANTHROPIC_API_KEY" && v !== undefined) env[k] = v;
  }
  if (!env["PATH"]?.includes(".local/bin")) {
    env["PATH"] = `/home/${process.env["USER"] ?? "jah"}/.local/bin:${env["PATH"] ?? "/usr/local/bin:/usr/bin:/bin"}`;
  }
  return env;
}

// ── Shared CLI arg builder ────────────────────────────────────────────────

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
  ];
  if (sessionId) args.push("--resume", sessionId);
  return args;
}

// ── Claude CLI (pipe mode) ────────────────────────────────────────────────

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
  const proc = spawn("claude", args, {
    cwd: workingDir,
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });

  proc.stdin.write(message);
  proc.stdin.end();

  let buf = "";
  let doneFired = false;
  const safeOnDone = (cost?: number) => {
    if (!doneFired) { doneFired = true; onDone(cost); }
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
        handleStreamEvent(evt, onChunk, onSessionId, safeOnDone);
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
        handleStreamEvent(evt, onChunk, onSessionId, safeOnDone);
      } catch (e) {
        console.error(`[HME] close-buf JSON parse failed: ${(e as any)?.message ?? e} | buf: ${buf.slice(0, 120)}`);
        onChunk(buf.trim(), "error");
      }
    }
    if (code !== 0) onError(`Claude CLI exited with code ${code}`);
    else safeOnDone();
  });

  return () => { try { proc.kill(); } catch {} };
}

function handleStreamEvent(
  evt: any,
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
    const inputTokens: number | undefined = evt.input_tokens;
    const outputTokens: number | undefined = evt.output_tokens;
    if (inputTokens == null || outputTokens == null) {
      onChunk("[HME] WARN: result event missing token counts — context % will not update", "error");
    }
    const usage: TokenUsage | undefined =
      (inputTokens != null && outputTokens != null)
        ? {
            inputTokens,
            outputTokens,
            // All current Claude models have a 200k context window.
            usedPct: Math.round((inputTokens / 200000) * 1000) / 10,
          }
        : undefined;
    onDone(evt.cost_usd ?? undefined, usage);
    return;
  }
}

// ── Claude PTY (hook-aware interactive mode) ───────────────────────────────

const PTY_DONE_PATTERNS = [
  /^>\s*$/m,
  /\nHuman:\s*$/,
  /\[H\]/,
];

/** Classify a single PTY text line into chunk type for onChunk. Returns null to suppress. */
function classifyPtyLine(text: string, fullOutput: string): { chunk: string; type: "thinking" | "tool" | "text" | "error" } | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (/^(?:⠋|⠙|⠹|⠸|⠼|⠴|⠦|⠧|⠇|⠏)\s/.test(trimmed)) {
    return { chunk: trimmed.replace(/^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]\s*/, ""), type: "thinking" };
  }
  if (/^●\s/.test(trimmed) || /^\[.*\]/.test(trimmed)) {
    return { chunk: trimmed, type: "tool" };
  }
  if (!PTY_DONE_PATTERNS.some((p) => p.test(fullOutput.slice(-200)))) {
    return { chunk: text, type: "text" };
  }
  return null;
}

function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[\x20-\x3f]*[0-9;]*[\x20-\x7e]/g, "")
            .replace(/\x1b\][^\x07]*\x07/g, "")
            .replace(/\r/g, "");
}

function parseK(s: string): number {
  const n = parseFloat(s);
  return s.endsWith("k") || s.endsWith("K") ? Math.round(n * 1000) : Math.round(n);
}

function parseContextOutput(text: string): TokenUsage | undefined {
  // Extract Free space % and Autocompact buffer % from /context output.
  // Used% = 100 - freeSpace% - autocompact%
  const freeMatch = text.match(/Free\s+space[^\n]*\((\d+(?:\.\d+)?)%\)/i);
  const autoMatch = text.match(/Autocompact\s+buffer[^\n]*\((\d+(?:\.\d+)?)%\)/i);
  if (freeMatch && autoMatch) {
    const freePct = parseFloat(freeMatch[1]);
    const autoPct = parseFloat(autoMatch[1]);
    const usedPct = Math.round((100 - freePct - autoPct) * 10) / 10;
    // Also grab total token count from "Tokens: Xk / Yk (N%)" for inputTokens
    const tokenLine = text.match(/Tokens[:\s]+([\d.]+k?)\s*\/\s*([\d.]+k?)/i);
    const inputTokens = tokenLine ? parseK(tokenLine[1]) : 0;
    return { inputTokens, outputTokens: 0, usedPct };
  }
  // Fallback: use token line percentage directly
  const lineMatch = text.match(/Tokens[:\s]+([\d.]+k?)\s*\/\s*([\d.]+k?)\s*\((\d+(?:\.\d+)?)%\)/i);
  if (lineMatch) {
    return { inputTokens: parseK(lineMatch[1]), outputTokens: 0, usedPct: parseFloat(lineMatch[3]) };
  }
  return undefined;
}

export function streamClaudePty(
  message: string,
  sessionId: string | null,
  opts: ClaudeOptions,
  workingDir: string,
  onChunk: ChunkCallback,
  onSessionId: (id: string) => void,
  onDone: (usage?: TokenUsage) => void,
  onError: (msg: string) => void,
  onRawData?: (raw: string) => void,
  onPtyReady?: (writeFn: (data: string) => void) => void
): () => void {
  hmeLog(`streamClaudePty called model=${opts.model} effort=${opts.effort}`);
  // PTY always uses bypassPermissions (interactive hook-aware mode).
  const args = buildClaudeArgs({ ...opts, permissionMode: "bypassPermissions" }, sessionId, []);

  const env = buildClaudeEnv();
  env["TERM"] = "xterm-256color";
  // Each PTY session writes context data to its own file so the main Claude Code
  // session's Stop hook (writing to /tmp/claude-context.json) can't overwrite it.
  const ctxFile = `/tmp/claude-ctx-pty-${Date.now()}.json`;
  env["HME_CTX_FILE"] = ctxFile;

  const ptyLib = getPty();
  if (!ptyLib) {
    onError("node-pty unavailable");
    return () => {};
  }

  let proc: ReturnType<typeof ptyLib.spawn>;
  try {
    proc = ptyLib.spawn("claude", args, {
      name: "xterm-256color",
      cols: 220,
      rows: 50,
      cwd: workingDir,
      env: env as NodeJS.ProcessEnv,
    });
  } catch (e: any) {
    onError(`PTY spawn failed: ${e?.message ?? e}`);
    return () => {};
  }

  onPtyReady?.((data) => { try { proc.write(data); } catch {} });

  let fullOutput = "";
  let sentMessage = false;
  let turnDone = false;
  let sessionIdSent = false;
  let initBuf = "";
  let doneTimer: ReturnType<typeof setTimeout> | null = null;
  let contextQueryActive = false;
  let contextQueryBuf = "";
  let donePatternMatched = false;

  const PTY_INACTIVITY_MS = 15000;
  let ptyInactivityTimer: ReturnType<typeof setTimeout> | null = null;
  const resetPtyInactivity = () => {
    if (ptyInactivityTimer) clearTimeout(ptyInactivityTimer);
    ptyInactivityTimer = setTimeout(() => {
      if (!turnDone) {
        turnDone = true;
        if (doneTimer) clearTimeout(doneTimer);
        try { proc.kill(); } catch {}
        onError(
          `CRITICAL: Claude PTY produced no output for ${PTY_INACTIVITY_MS / 1000}s` +
          " after message send — API may be down or CLI crashed"
        );
      }
    }, PTY_INACTIVITY_MS);
  };

  const _buildPtyUsage = (): TokenUsage | undefined => {
    try {
      const ctxData = JSON.parse(readFileSync(ctxFile, "utf8"));
      const usedPct = typeof ctxData.used_pct === "number" ? ctxData.used_pct : undefined;
      return {
        inputTokens: ctxData.input_tokens ?? 0,
        outputTokens: ctxData.output_tokens ?? 0,
        usedPct,
        modelId: ctxData.model_id || undefined,
        modelName: ctxData.model_name || undefined,
      };
    } catch (e: any) {
      if (e?.code !== "ENOENT") hmeLog(`WARN _buildPtyUsage: ${e?.message ?? e}`);
      return undefined;
    }
  };

  const finalizeTurn = () => {
    if (!turnDone) {
      turnDone = true;
      // Try contextQueryBuf first (from /context command), then fall back to
      // parsing fullOutput directly — Claude CLI may emit token info in its footer.
      const ctxParsed = parseContextOutput(contextQueryBuf) ?? parseContextOutput(fullOutput);
      hmeLog(`finalize: donePatternMatched=${donePatternMatched}`);
      hmeLog(`finalize: ctxBuf=${JSON.stringify(contextQueryBuf.slice(0, 200))}`);
      hmeLog(`finalize: ctxParsed=${JSON.stringify(ctxParsed)}`);
      hmeLog(`finalize: fullTail=${JSON.stringify(fullOutput.slice(-400))}`);
      if (!fullOutput.trim()) {
        hmeLog(`WARN finalize: fullOutput is empty — message may not have been sent or PTY died before responding`);
        onChunk("[HME] WARN: PTY produced no output — message may not have been received", "error");
      }
      const usage = ctxParsed ?? _buildPtyUsage();
      if (!usage) {
        const reason = donePatternMatched
          ? "matched but /context parse failed"
          : "never matched (PTY output format may have changed)";
        hmeLog(`WARN finalize: no context data — done patterns ${reason}`);
        const chunkReason = donePatternMatched
          ? "/context parse failed"
          : "PTY done patterns never matched, check hme-ctx-debug.log";
        onChunk(`[HME] WARN: context % unavailable — ${chunkReason}`, "error");
      }
      onDone(usage);
      try { proc.kill(); } catch {}
    }
  };

  const scheduleContextQuery = () => {
    if (doneTimer) clearTimeout(doneTimer);
    if (ptyInactivityTimer) { clearTimeout(ptyInactivityTimer); ptyInactivityTimer = null; }
    donePatternMatched = true;
    contextQueryActive = true;
    contextQueryBuf = "";
    hmeLog("ctx: sending /context");
    try {
      proc.write("/context\r");
    } catch (e: any) {
      hmeLog(`ERROR ctx: /context write failed: ${e?.message ?? e}`);
      onError(`PTY /context write failed: ${e?.message ?? e}`);
    }
    doneTimer = setTimeout(finalizeTurn, 1500);
  };

  proc.onData((raw: string) => {
    onRawData?.(raw);
    const text = stripAnsi(raw);

    if (!sentMessage) {
      initBuf += text;
      // Wait for the prompt character at the very end of the buffer — never trigger
      // on │ (box-drawing borders in the startup banner) which causes the remainder
      // of the banner, including "bypassPermissions" notices, to leak into chat.
      const promptFound = initBuf.includes("> ") || initBuf.includes("Human:");
      const ready = promptFound || initBuf.length > 2000;
      if (ready) {
        if (!promptFound) {
          hmeLog(
            `WARN init fallback: prompt not found in ${initBuf.length} chars — ` +
            `banner format may have changed. Head: ${JSON.stringify(initBuf.slice(0, 300))}`
          );
          onChunk(
            "[HME] WARN: PTY prompt not detected — banner format may have changed, see hme-ctx-debug.log",
            "error"
          );
        }
        sentMessage = true;
        proc.write(message.replace(/\r?\n/g, " ") + "\r");
        resetPtyInactivity();
      }
      return;
    }

    if (contextQueryActive) {
      contextQueryBuf += text;
      // New prompt means /context finished — fire immediately if we have data
      if (PTY_DONE_PATTERNS.some((p) => p.test(text)) && parseContextOutput(contextQueryBuf)) {
        if (doneTimer) clearTimeout(doneTimer);
        finalizeTurn();
      }
      return;
    }

    resetPtyInactivity();
    fullOutput += text;

    if (!sessionIdSent) {
      const sessionMatch = fullOutput.match(/Session(?:\s+ID)?:\s*([a-f0-9-]{8,})/i);
      if (sessionMatch) { sessionIdSent = true; onSessionId(sessionMatch[1]); }
    }

    const classified = classifyPtyLine(text, fullOutput);
    if (classified) onChunk(classified.chunk, classified.type);

    if (PTY_DONE_PATTERNS.some((p) => p.test(fullOutput.slice(-400)))) {
      scheduleContextQuery();
    }
  });

  proc.onExit(({ exitCode }: { exitCode: number; signal?: number }) => {
    if (ptyInactivityTimer) { clearTimeout(ptyInactivityTimer); ptyInactivityTimer = null; }
    if (turnDone) return;
    setTimeout(() => {
      if (turnDone) return;
      if (doneTimer) clearTimeout(doneTimer);
      if (exitCode !== 0) {
        turnDone = true;
        onError(`Claude CLI exited with code ${exitCode}`);
      } else {
        finalizeTurn();
      }
    }, 200);
  });

  const killed = { v: false };
  return () => {
    killed.v = true;
    turnDone = true;
    if (doneTimer) clearTimeout(doneTimer);
    if (ptyInactivityTimer) { clearTimeout(ptyInactivityTimer); ptyInactivityTimer = null; }
    try { proc.kill(); } catch {}
  };
}
