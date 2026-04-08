import { spawn } from "child_process";
import * as http from "http";

// node-pty is loaded lazily inside streamClaudePty only — a native module crash
// must never take down the extension host at startup.
let _pty: typeof import("node-pty") | null = null;
function getPty(): typeof import("node-pty") | null {
  if (_pty) return _pty;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    _pty = require("node-pty");
    return _pty;
  } catch {
    return null;
  }
}

// HME HTTP shim — runs alongside MCP server at port 7734
const HME_HTTP_PORT = 7734;
const HME_HTTP_URL = `http://127.0.0.1:${HME_HTTP_PORT}`;

export type Route = "claude" | "local" | "hybrid";

export interface ClaudeOptions {
  model: string;        // e.g. "opus", "sonnet", "haiku", or full model id
  effort: string;       // "low" | "medium" | "high" | "max"
  thinking: boolean;    // adds --verbose to surface thinking blocks
  permissionMode: string; // "acceptEdits" | "bypassPermissions" | "default"
}

export interface OllamaOptions {
  model: string;        // e.g. "qwen3-coder:30b"
  url: string;          // e.g. "http://localhost:11434"
}

export interface RouterOptions {
  route: Route;
  claude: ClaudeOptions;
  ollama: OllamaOptions;
  workingDir: string;
}

export type ChunkCallback = (text: string, type: "text" | "thinking" | "tool" | "error") => void;

// ── Claude CLI ─────────────────────────────────────────────────────────────

export function streamClaude(
  message: string,
  sessionId: string | null,
  opts: ClaudeOptions,
  workingDir: string,
  onChunk: ChunkCallback,
  onSessionId: (id: string) => void,
  onDone: (cost?: number) => void,
  onError: (msg: string) => void
): () => void {
  const args: string[] = ["-p", "--output-format", "stream-json", "--verbose"];
  args.push("--model", opts.model);
  args.push("--effort", opts.effort);
  args.push("--permission-mode", opts.permissionMode || "acceptEdits");
  if (opts.thinking) {
    // Extended thinking is available on Opus; --verbose surfaces the thinking blocks
    // in stream-json output. Nothing extra needed — thinking blocks come through natively.
  }
  if (sessionId) {
    args.push("--resume", sessionId);
  }

  const env = { ...process.env };
  // Remove API key so CLI uses subscription auth
  delete env["ANTHROPIC_API_KEY"];
  // Ensure claude is findable — VS Code extension host may have a stripped PATH
  if (!env["PATH"]?.includes(".local/bin")) {
    env["PATH"] = `/home/${process.env["USER"] ?? "jah"}/.local/bin:${env["PATH"] ?? "/usr/local/bin:/usr/bin:/bin"}`;
  }

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

  proc.stdout.on("data", (data: Buffer) => {
    buf += data.toString("utf8");
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const evt = JSON.parse(line);
        handleStreamEvent(evt, onChunk, onSessionId, safeOnDone);
      } catch {
        // non-JSON line, skip
      }
    }
  });

  proc.stderr.on("data", (data: Buffer) => {
    const text = data.toString("utf8").trim();
    if (text) onError(text);
  });

  proc.on("close", (code) => {
    // Flush any remaining buffered output
    if (buf.trim()) {
      try {
        const evt = JSON.parse(buf.trim());
        handleStreamEvent(evt, onChunk, onSessionId, safeOnDone);
      } catch {}
    }
    if (code !== 0) onError(`Claude CLI exited with code ${code}`);
    else safeOnDone(); // ensure done fires even if result event was missing
  });

  return () => { try { proc.kill(); } catch {} };
}

function handleStreamEvent(
  evt: any,
  onChunk: ChunkCallback,
  onSessionId: (id: string) => void,
  onDone: (cost?: number) => void
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
        onChunk(`[${block.name}] ${JSON.stringify(block.input ?? {}).slice(0, 120)}`, "tool");
      }
    }
    return;
  }

  if (evt.type === "result") {
    onDone(evt.cost_usd ?? undefined);
    return;
  }
}

// ── Claude PTY (hook-aware interactive mode) ───────────────────────────────

// Strips ANSI escape sequences from terminal output
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*[mGKHFABCDJsuhl]/g, "")
            .replace(/\x1b\][^\x07]*\x07/g, "")
            .replace(/\r/g, "");
}

// Claude CLI interactive prompt indicators — turn is done when we see these
// after receiving substantial output. The CLI shows "> " for input and
// "╭─" / "│" box-drawing chars for its response blocks.
const PTY_DONE_PATTERNS = [
  /^>\s*$/m,                    // bare prompt line
  /\nHuman:\s*$/,               // conversation turn marker
  /\[H\]/,                      // alternate prompt marker
];

/**
 * Spawn Claude CLI via PTY (pseudo-terminal) so .claude/settings.json hooks fire.
 * Sends `message`, streams output back, detects turn completion via prompt re-appearance.
 *
 * Hooks (PreToolUse, PostToolUse, Stop) fire because this is a real interactive session.
 * Uses --resume for session continuity. bypassPermissions so no permission prompts block.
 */
export function streamClaudePty(
  message: string,
  sessionId: string | null,
  opts: ClaudeOptions,
  workingDir: string,
  onChunk: ChunkCallback,
  onSessionId: (id: string) => void,
  onDone: () => void,
  onError: (msg: string) => void
): () => void {
  const args: string[] = ["--model", opts.model, "--permission-mode", "bypassPermissions"];
  if (sessionId) args.push("--resume", sessionId);

  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k !== "ANTHROPIC_API_KEY" && v !== undefined) env[k] = v;
  }
  env["TERM"] = "xterm-256color";
  if (!env["PATH"]?.includes(".local/bin")) {
    env["PATH"] = `/home/${process.env["USER"] ?? "jah"}/.local/bin:${env["PATH"] ?? "/usr/local/bin:/usr/bin:/bin"}`;
  }

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

  let fullOutput = "";
  let sentMessage = false;
  let turnDone = false;
  let sessionIdSent = false;
  // Wait for initial prompt before sending — CLI prints ">" or similar
  let initBuf = "";
  let doneTimer: ReturnType<typeof setTimeout> | null = null;

  const scheduleDone = () => {
    if (doneTimer) clearTimeout(doneTimer);
    doneTimer = setTimeout(() => {
      if (!turnDone) {
        turnDone = true;
        onDone();
        try { proc.kill(); } catch {}
      }
    }, 800);
  };

  proc.onData((raw: string) => {
    const text = stripAnsi(raw);

    if (!sentMessage) {
      // Wait for initial prompt from CLI before sending our message
      initBuf += text;
      const ready =
        initBuf.includes("> ") ||
        initBuf.includes("│") ||
        initBuf.includes("Human:") ||
        initBuf.length > 200;
      if (ready) {
        sentMessage = true;
        // Send message then Enter
        proc.write(message.replace(/\r?\n/g, " ") + "\r");
      }
      return;
    }

    // Strip echoed input line (first line after send)
    fullOutput += text;

    // Detect session ID from output — fire once only
    if (!sessionIdSent) {
      const sessionMatch = fullOutput.match(/Session(?:\s+ID)?:\s*([a-f0-9-]{8,})/i);
      if (sessionMatch) { sessionIdSent = true; onSessionId(sessionMatch[1]); }
    }

    // Classify and emit chunks
    // Thinking blocks: Claude wraps them in ⠋ spinner or "Thinking..." lines
    if (/^(?:⠋|⠙|⠹|⠸|⠼|⠴|⠦|⠧|⠇|⠏)\s/.test(text.trim())) {
      onChunk(text.trim().replace(/^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]\s*/, ""), "thinking");
    } else if (/^●\s/.test(text.trim()) || /^\[.*\]/.test(text.trim())) {
      // Tool use: "● ToolName(...)" or "[tool_name]"
      onChunk(text.trim(), "tool");
    } else if (text.trim() && !PTY_DONE_PATTERNS.some((p) => p.test(fullOutput.slice(-200)))) {
      onChunk(text, "text");
    }

    // Detect prompt re-appearance = turn complete
    if (PTY_DONE_PATTERNS.some((p) => p.test(fullOutput.slice(-400)))) {
      scheduleDone();
    }
  });

  const killed = { v: false };
  return () => {
    killed.v = true;
    turnDone = true;
    if (doneTimer) clearTimeout(doneTimer);
    try { proc.kill(); } catch {}
  };
}

// ── Ollama ─────────────────────────────────────────────────────────────────

export interface OllamaMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export function streamOllama(
  messages: OllamaMessage[],
  opts: OllamaOptions,
  onChunk: ChunkCallback,
  onDone: () => void,
  onError: (msg: string) => void
): () => void {
  const body = JSON.stringify({
    model: opts.model,
    messages,
    stream: true,
    think: false,  // suppress CoT tokens bleeding into content stream
    options: { temperature: 0.7, num_predict: 4096 },
  });

  const url = new URL(`${opts.url}/api/chat`);
  let aborted = false;

  const req = http.request(
    {
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    },
    (res) => {
      if (res.statusCode && res.statusCode >= 400) {
        let errBody = "";
        res.on("data", (c: Buffer) => { errBody += c.toString("utf8"); });
        res.on("end", () => {
          try { onError((JSON.parse(errBody) as any).error ?? `Ollama error ${res.statusCode}`); }
          catch { onError(`Ollama error ${res.statusCode}`); }
        });
        return;
      }
      let buf = "";
      let doneFired = false;
      const fireDone = () => { if (!doneFired) { doneFired = true; onDone(); } };
      res.on("data", (chunk: Buffer) => {
        if (aborted) return;
        buf += chunk.toString("utf8");
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line);
            const text = parsed?.message?.content ?? "";
            if (text) onChunk(text, "text");
            if (parsed?.done) fireDone();
          } catch {}
        }
      });
      res.on("end", () => { if (!aborted) fireDone(); });
      res.on("error", (e) => onError(e.message));
    }
  );

  req.on("error", (e) => onError(e.message));
  req.write(body);
  req.end();

  return () => { aborted = true; req.destroy(); };
}

// ── HME context enrichment ─────────────────────────────────────────────────

/**
 * Fetch KB context from the HME HTTP shim for a given query.
 * Returns the warm context string, or empty string if shim is unreachable.
 */
export async function fetchHmeContext(query: string, topK: number = 5): Promise<string> {
  return new Promise((resolve) => {
    const body = JSON.stringify({ query, top_k: topK });
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: HME_HTTP_PORT,
        path: "/enrich",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (c: Buffer) => { raw += c.toString("utf8"); });
        res.on("end", () => {
          try {
            const parsed = JSON.parse(raw);
            resolve(parsed.warm ?? "");
          } catch {
            resolve("");
          }
        });
      }
    );
    req.on("error", () => resolve(""));
    req.write(body);
    req.end();
  });
}

/**
 * Pre-send: validate message against KB anti-patterns and architectural constraints.
 * Returns {warnings, blocks} — blocks are hard stops (bugfix/antipattern category),
 * warnings are softer architectural nudges.
 */
export async function validateMessage(message: string): Promise<{ warnings: any[]; blocks: any[] }> {
  return new Promise((resolve) => {
    const body = JSON.stringify({ query: message });
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: HME_HTTP_PORT,
        path: "/validate",
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      },
      (res) => {
        let raw = "";
        res.on("data", (c: Buffer) => { raw += c.toString("utf8"); });
        res.on("end", () => {
          try { resolve(JSON.parse(raw)); }
          catch { resolve({ warnings: [], blocks: [] }); }
        });
      }
    );
    req.on("error", () => resolve({ warnings: [], blocks: [] }));
    req.write(body);
    req.end();
  });
}

/**
 * Post-response: audit changed files against KB constraints.
 * Returns {violations, changed_files}.
 */
export async function auditChanges(changedFiles: string = ""): Promise<{ violations: any[]; changed_files: string[] }> {
  return new Promise((resolve) => {
    const body = JSON.stringify({ changed_files: changedFiles });
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: HME_HTTP_PORT,
        path: "/audit",
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      },
      (res) => {
        let raw = "";
        res.on("data", (c: Buffer) => { raw += c.toString("utf8"); });
        res.on("end", () => {
          try { resolve(JSON.parse(raw)); }
          catch { resolve({ violations: [], changed_files: [] }); }
        });
      }
    );
    req.on("error", () => resolve({ violations: [], changed_files: [] }));
    req.write(body);
    req.end();
  });
}

/**
 * Post transcript entries to the HME HTTP shim.
 * Mirrors the TranscriptLogger's JSONL entries to the server-side store.
 */
export async function postTranscript(entries: any[]): Promise<void> {
  return new Promise((resolve) => {
    const body = JSON.stringify({ entries });
    const req = http.request(
      {
        hostname: "127.0.0.1", port: HME_HTTP_PORT, path: "/transcript", method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      },
      () => resolve()
    );
    req.on("error", () => resolve());
    req.write(body);
    req.end();
  });
}

/**
 * Trigger immediate mini-reindex of specific files via HME HTTP shim.
 * Called after tool calls that modify files (Edit/Write).
 */
export async function reindexFiles(files: string[]): Promise<{ indexed: string[]; count: number }> {
  return new Promise((resolve) => {
    const body = JSON.stringify({ files });
    const req = http.request(
      {
        hostname: "127.0.0.1", port: HME_HTTP_PORT, path: "/reindex", method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      },
      (res) => {
        let raw = "";
        res.on("data", (c: Buffer) => { raw += c.toString("utf8"); });
        res.on("end", () => {
          try { resolve(JSON.parse(raw)); }
          catch { resolve({ indexed: [], count: 0 }); }
        });
      }
    );
    req.on("error", () => resolve({ indexed: [], count: 0 }));
    req.write(body);
    req.end();
  });
}

/**
 * Post a narrative digest to the HME HTTP shim.
 * Called after the Ollama arbiter synthesizes a rolling summary.
 */
export async function postNarrative(narrative: string): Promise<void> {
  return new Promise((resolve) => {
    const body = JSON.stringify({ narrative });
    const req = http.request(
      {
        hostname: "127.0.0.1", port: HME_HTTP_PORT, path: "/narrative", method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      },
      () => resolve()
    );
    req.on("error", () => resolve());
    req.write(body);
    req.end();
  });
}

/** Check whether the HME HTTP shim is reachable. Returns {ready, errors}. */
export async function isHmeShimReady(): Promise<{ ready: boolean; errors: any[] }> {
  return new Promise((resolve) => {
    const req = http.get(`${HME_HTTP_URL}/health`, (res) => {
      let raw = "";
      res.on("data", (c: Buffer) => { raw += c.toString("utf8"); });
      res.on("end", () => {
        try {
          const parsed = JSON.parse(raw);
          resolve({ ready: parsed.status === "ready", errors: parsed.recent_errors ?? [] });
        }
        catch { resolve({ ready: false, errors: [] }); }
      });
    });
    req.on("error", () => resolve({ ready: false, errors: [] }));
    req.setTimeout(1000, () => { req.destroy(); resolve({ ready: false, errors: [] }); });
  });
}

/**
 * Post a critical error to the HME HTTP shim error log.
 * Writes to log/hme-errors.log on disk — readable by main Claude session.
 */
export async function logShimError(source: string, message: string, detail: string = ""): Promise<void> {
  return new Promise((resolve) => {
    const body = JSON.stringify({ source, message, detail });
    const req = http.request(
      {
        hostname: "127.0.0.1", port: HME_HTTP_PORT, path: "/error", method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      },
      () => resolve()
    );
    req.on("error", () => resolve());
    req.write(body);
    req.end();
  });
}

/**
 * Hybrid route: enrich message with HME KB context, then send to Ollama.
 * Falls back to plain Ollama if shim is unreachable.
 */
export async function streamHybrid(
  message: string,
  history: OllamaMessage[],
  opts: OllamaOptions,
  onChunk: ChunkCallback,
  onDone: () => void,
  onError: (msg: string) => void
): Promise<() => void> {
  const hmeContext = await fetchHmeContext(message);

  const messages: OllamaMessage[] = [];

  if (hmeContext) {
    messages.push({
      role: "system",
      content: `You are an expert assistant with access to the following project knowledge base context. Use it to ground your response.\n\n${hmeContext}`,
    });
  }

  messages.push(...history, { role: "user", content: message });

  return streamOllama(messages, opts, onChunk, onDone, onError);
}
