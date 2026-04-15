// llama.cpp chat router — OpenAI /v1/chat/completions client for the chat UI.
//
// Replaces the former ollama /api/chat client. Exposes legacy symbol names
// (streamOllama, streamOllamaAgentic, GPU_NUM_CTX) as aliases so routerHme,
// chatStreaming, ChatPanel, etc. keep building without a coordinated rename.
//
// Wire protocol:
//   Streaming  → POST /v1/chat/completions with stream: true → SSE frames
//                (data: {...}\n\n, terminator data: [DONE])
//   Agentic    → POST /v1/chat/completions with stream: false → JSON
//                {choices: [{message: {content, tool_calls}}]}

import { execSync } from "child_process";
import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import { OllamaOptions, OllamaMessage, ChunkCallback } from "./router";

export const GPU_NUM_CTX = 49152;

function llamacppErrMsg(e: any, url: string): string {
  return e?.code === "ECONNREFUSED"
    ? `CRITICAL: llama-server not running — connection refused — NOT responding at ${url}`
    : (e?.message ?? String(e));
}

function stripThinkTags(text: string): string {
  if (!text) return text;
  const closeIdx = text.lastIndexOf("</think>");
  if (closeIdx !== -1) return text.slice(closeIdx + 8).trim();
  const openIdx = text.indexOf("<think>");
  if (openIdx !== -1) return text.slice(0, openIdx).trim();
  return text;
}

// ── Streaming: SSE parsing ────────────────────────────────────────────────
//
// llama-server streams OpenAI-compatible SSE:
//   data: {"choices":[{"delta":{"content":"…"}}],…}
//   data: {"choices":[{"delta":{"content":"…"},"finish_reason":null}],…}
//   …
//   data: [DONE]
//
// We split on "\n\n", strip the "data: " prefix, parse each JSON frame, and
// pull content deltas out of choices[0].delta.content.
export function streamLlamacpp(
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
    temperature: 0.7,
    max_tokens: 4096,
    cache_prompt: true,
  });
  const url = new URL(`${opts.url}/v1/chat/completions`);
  let aborted = false;
  let accText = "";
  let accThink = "";
  let inThink = false;

  const req = http.request(
    {
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
        "Content-Length": Buffer.byteLength(body),
      },
    },
    (res) => {
      let buf = "";
      res.on("data", (chunk: Buffer) => {
        if (aborted) return;
        buf += chunk.toString("utf8");
        // SSE frames are separated by a blank line
        const frames = buf.split("\n\n");
        buf = frames.pop() ?? "";
        for (const frame of frames) {
          if (!frame.trim()) continue;
          // Each frame may have multiple "data: " lines — usually just one
          for (const rawLine of frame.split("\n")) {
            const line = rawLine.trim();
            if (!line || !line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (payload === "[DONE]") {
              if (accThink) onChunk(accThink.trim(), "thinking");
              if (accText) onChunk(stripThinkTags(accText.trim()), "text");
              onDone();
              return;
            }
            try {
              const obj = JSON.parse(payload);
              const choices = obj?.choices ?? [];
              if (!choices.length) continue;
              const delta = choices[0]?.delta ?? {};
              const content: string = delta.content ?? "";
              if (!content) continue;

              if (content.includes("<think>")) {
                inThink = true;
                accThink += content.replace("<think>", "");
                continue;
              }
              if (content.includes("</think>")) {
                inThink = false;
                accThink += content.replace("</think>", "");
                onChunk(accThink.trim(), "thinking");
                accThink = "";
                continue;
              }
              if (inThink) { accThink += content; continue; }
              accText += content;
            } catch {}
          }
        }
      });
      res.on("end", () => {
        if (!aborted) {
          if (accThink) onChunk(accThink.trim(), "thinking");
          if (accText) onChunk(stripThinkTags(accText.trim()), "text");
          onDone();
        }
      });
      res.on("error", (e) => { if (!aborted) onError(e.message); });
    }
  );
  req.on("error", (e: any) => {
    if (!aborted) onError(llamacppErrMsg(e, opts.url));
  });
  req.write(body);
  req.end();

  return () => { aborted = true; req.destroy(); };
}

// ── Agentic tool loop ─────────────────────────────────────────────────────

const LLAMACPP_TOOLS = [
  {
    type: "function",
    function: {
      name: "bash",
      description: "Execute a bash command in the project working directory. Use for creating/deleting files, running scripts, installing packages, etc.",
      parameters: {
        type: "object",
        properties: { command: { type: "string", description: "The bash command to execute" } },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read the full contents of a file by path.",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "File path relative to project root" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Write or overwrite a file with the given content.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path relative to project root" },
          content: { type: "string", description: "File content to write" },
        },
        required: ["path", "content"],
      },
    },
  },
];

const LLAMACPP_HARD_TIMEOUT_MS = 120000;

function isLlamacppAlive(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const u = new URL(url);
    const req = http.get(
      { hostname: u.hostname, port: u.port || 80, path: "/health", timeout: 3000 },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      }
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
  });
}

function llamacppChatOnce(
  messages: any[],
  tools: any[],
  opts: OllamaOptions
): { promise: Promise<any>; cancel: () => void } {
  let req: ReturnType<typeof http.request> | null = null;
  let hardTimer: ReturnType<typeof setTimeout> | null = null;

  const promise = new Promise<any>((resolve, reject) => {
    hardTimer = setTimeout(
      () => {
        req?.destroy();
        reject(new Error(`llama-server timeout: no response after ${LLAMACPP_HARD_TIMEOUT_MS / 1000}s`));
      },
      LLAMACPP_HARD_TIMEOUT_MS
    );
    if ((hardTimer as any).unref) (hardTimer as any).unref();

    const body = JSON.stringify({
      model: opts.model,
      messages,
      tools,
      stream: false,
      temperature: 0.7,
      max_tokens: 4096,
      cache_prompt: true,
    });
    const url = new URL(`${opts.url}/v1/chat/completions`);
    req = http.request(
      {
        hostname: url.hostname,
        port: url.port || 80,
        path: url.pathname,
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      },
      (res) => {
        let raw = "";
        res.on("data", (c: Buffer) => { raw += c.toString("utf8"); });
        res.on("end", () => {
          if (hardTimer) clearTimeout(hardTimer);
          if (res.statusCode && res.statusCode >= 400) {
            try { reject(new Error((JSON.parse(raw) as any)?.error?.message ?? (JSON.parse(raw) as any).error ?? `llama-server HTTP ${res.statusCode}`)); }
            catch { reject(new Error(`llama-server HTTP ${res.statusCode}: ${raw.slice(0, 200)}`)); }
            return;
          }
          try {
            const parsed = JSON.parse(raw);
            // Translate OpenAI envelope → ollama-ish message shape the caller expects.
            const choice = parsed?.choices?.[0] ?? {};
            const msg = choice.message ?? {};
            if (typeof msg.content === "string") {
              msg.content = stripThinkTags(msg.content);
            }
            resolve({ message: msg, _raw: parsed });
          }
          catch (e) { reject(new Error(`llama-server parse error: ${raw.slice(0, 200)}`)); }
        });
        res.on("error", (e) => { if (hardTimer) clearTimeout(hardTimer); reject(e); });
      }
    );
    req.on("error", (e: any) => {
      if (hardTimer) clearTimeout(hardTimer);
      reject(new Error(llamacppErrMsg(e, opts.url)));
    });
    req.write(body);
    req.end();
  });

  const cancel = () => { req?.destroy(); if (hardTimer) clearTimeout(hardTimer); };
  return { promise, cancel };
}

function parseXmlFunctionCalls(content: string): any[] {
  const calls: any[] = [];
  const fnRe = /<function=(\w+)>([\s\S]*?)<\/function>/g;
  const paramRe = /<parameter=(\w+)>([\s\S]*?)<\/parameter>/g;
  let fm: RegExpExecArray | null;
  while ((fm = fnRe.exec(content)) !== null) {
    const name = fm[1];
    const body = fm[2];
    const args: Record<string, string> = {};
    let pm: RegExpExecArray | null;
    const localRe = new RegExp(paramRe.source, "g");
    while ((pm = localRe.exec(body)) !== null) {
      args[pm[1]] = pm[2].trim();
    }
    calls.push({ function: { name, arguments: args } });
  }
  return calls;
}

export function streamLlamacppAgentic(
  messages: OllamaMessage[],
  opts: OllamaOptions,
  workingDir: string,
  onChunk: ChunkCallback,
  onDone: () => void,
  onError: (msg: string) => void
): () => void {
  let aborted = false;
  let currentRequest: { promise: Promise<any>; cancel: () => void } | null = null;
  const abort = () => {
    aborted = true;
    currentRequest?.cancel();
  };

  const runLoop = async () => {
    const current: any[] = [...messages];
    let iterations = 0;
    const MAX = 15;

    while (iterations++ < MAX && !aborted) {
      onChunk(`⏳ llama-server thinking…`, "tool");
      let response: any;
      try {
        currentRequest = llamacppChatOnce(current, LLAMACPP_TOOLS, opts);
        response = await currentRequest.promise;
        currentRequest = null;
      } catch (e: any) {
        currentRequest = null;
        if (aborted) return;
        const alive = await isLlamacppAlive(opts.url);
        if (alive) {
          onChunk(`⚠ Timeout but llama-server is alive — model may be slow. Retrying once…`, "error");
          try {
            currentRequest = llamacppChatOnce(current, LLAMACPP_TOOLS, opts);
            response = await currentRequest.promise;
            currentRequest = null;
          } catch (retryErr: any) {
            currentRequest = null;
            if (!aborted) onError(`CRITICAL AFTER RETRY: ${retryErr.message ?? String(retryErr)}`);
            return;
          }
        } else {
          const errMsg = llamacppErrMsg(e, opts.url);
          onError(errMsg.startsWith("CRITICAL") ? errMsg : `CRITICAL: ${errMsg}`);
          return;
        }
      }
      if (aborted) return;

      const msg = response?.message ?? {};
      let toolCalls: any[] = msg.tool_calls ?? [];

      if (toolCalls.length === 0 && (msg.content ?? "").includes("<function=")) {
        toolCalls = parseXmlFunctionCalls(msg.content ?? "");
      }

      if (toolCalls.length === 0) {
        const text = stripThinkTags(msg.content ?? "");
        if (text) onChunk(text, "text");
        onDone();
        return;
      }

      current.push({ role: "assistant", content: msg.content ?? "", tool_calls: toolCalls });

      for (const tc of toolCalls) {
        if (aborted) return;
        const fnName: string = tc.function?.name ?? "";
        let args: any = {};
        try {
          args = typeof tc.function?.arguments === "string"
            ? JSON.parse(tc.function.arguments)
            : (tc.function?.arguments ?? {});
        } catch (e: any) {
          onChunk(`⚠ [${fnName}] failed to parse tool args: ${e?.message ?? e}`, "error");
          args = {};
        }

        onChunk(`[${fnName}] ${JSON.stringify(args).slice(0, 120)}`, "tool");

        let result = "";
        try {
          if (fnName === "bash") {
            result = execSync(String(args.command ?? ""), {
              cwd: workingDir,
              timeout: 30000,
              encoding: "utf8",
            });
            result = result.trim() || "(no output)";
          } else if (fnName === "read_file") {
            const abs = path.resolve(workingDir, String(args.path ?? ""));
            result = fs.readFileSync(abs, "utf8");
          } else if (fnName === "write_file") {
            const abs = path.resolve(workingDir, String(args.path ?? ""));
            fs.mkdirSync(path.dirname(abs), { recursive: true });
            fs.writeFileSync(abs, String(args.content ?? ""), "utf8");
            result = `Written: ${args.path}`;
          } else {
            result = `Unknown tool: ${fnName}`;
          }
        } catch (e: any) {
          result = `Error: ${e.message ?? String(e)}`;
        }

        current.push({ role: "tool", content: result });
        onChunk(`  → ${result.slice(0, 200)}`, "tool");
      }
    }

    if (!aborted) onError("Agentic loop exceeded max iterations");
  };

  runLoop().catch((e) => { if (!aborted) onError(e?.message ?? String(e)); });
  return abort;
}

// ── Legacy aliases ────────────────────────────────────────────────────────
// routerHme, chatStreaming, ChatPanel, and router still import the old
// ollama-flavored names. Alias them to the llama.cpp implementations so
// nothing else in the chat extension needs to be touched simultaneously.
export const streamOllama = streamLlamacpp;
export const streamOllamaAgentic = streamLlamacppAgentic;
