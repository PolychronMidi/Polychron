import { execSync } from "child_process";
import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import { OllamaOptions, OllamaMessage, ChunkCallback } from "./router";

export const GPU_NUM_CTX = 49152;

// ── Ollama streaming ──────────────────────────────────────────────────────

function stripThinkTags(text: string): string {
  if (!text) return text;
  const closeIdx = text.lastIndexOf("</think>");
  if (closeIdx !== -1) return text.slice(closeIdx + 8).trim();
  const openIdx = text.indexOf("<think>");
  if (openIdx !== -1) return text.slice(0, openIdx).trim();
  return text;
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
    think: true,
    options: { temperature: 0.7, num_predict: 4096, num_gpu: 99, num_ctx: GPU_NUM_CTX },
  });
  const url = new URL(`${opts.url}/api/chat`);
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
        "Content-Length": Buffer.byteLength(body),
      },
    },
    (res) => {
      let buf = "";
      res.on("data", (chunk: Buffer) => {
        if (aborted) return;
        buf += chunk.toString("utf8");
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const obj = JSON.parse(line);
            if (obj.done) {
              if (accThink) onChunk(accThink.trim(), "thinking");
              if (accText) onChunk(stripThinkTags(accText.trim()), "text");
              onDone();
              return;
            }
            const content = obj?.message?.content ?? "";
            if (!content) continue;

            if (content.includes("<think>")) { inThink = true; accThink += content.replace("<think>", ""); continue; }
            if (content.includes("</think>")) { inThink = false; accThink += content.replace("</think>", ""); onChunk(accThink.trim(), "thinking"); accThink = ""; continue; }
            if (inThink) { accThink += content; continue; }
            accText += content;
          } catch {}
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
    if (!aborted) {
      const msg = e.code === "ECONNREFUSED"
        ? `CRITICAL: Ollama not running — connection refused — Ollama is NOT responding at ${opts.url}`
        : e.message;
      onError(msg);
    }
  });
  req.write(body);
  req.end();

  return () => { aborted = true; req.destroy(); };
}

// ── Ollama agentic tool loop ──────────────────────────────────────────────

const OLLAMA_TOOLS = [
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

const OLLAMA_HARD_TIMEOUT_MS = 120000;

function isOllamaAlive(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const u = new URL(url);
    const req = http.get({ hostname: u.hostname, port: u.port || 80, path: "/api/tags", timeout: 3000 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
  });
}

function ollamaChatOnce(
  messages: any[],
  tools: any[],
  opts: OllamaOptions
): { promise: Promise<any>; cancel: () => void } {
  let req: ReturnType<typeof http.request> | null = null;
  let hardTimer: ReturnType<typeof setTimeout> | null = null;

  const promise = new Promise<any>((resolve, reject) => {
    hardTimer = setTimeout(
      () => { req?.destroy(); reject(new Error(`Ollama timeout: no response after ${OLLAMA_HARD_TIMEOUT_MS / 1000}s`)); },
      OLLAMA_HARD_TIMEOUT_MS
    );
    if ((hardTimer as any).unref) (hardTimer as any).unref();

    const body = JSON.stringify({
      model: opts.model,
      messages,
      tools,
      stream: false,
      think: false,
      options: { temperature: 0.7, num_predict: 4096, num_ctx: GPU_NUM_CTX },
    });
    const url = new URL(`${opts.url}/api/chat`);
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
            try { reject(new Error((JSON.parse(raw) as any).error ?? `Ollama HTTP ${res.statusCode}`)); }
            catch { reject(new Error(`Ollama HTTP ${res.statusCode}: ${raw.slice(0, 200)}`)); }
            return;
          }
          try {
            const parsed = JSON.parse(raw);
            if (parsed?.message?.content) {
              parsed.message.content = stripThinkTags(parsed.message.content);
            }
            resolve(parsed);
          }
          catch (e) { reject(new Error(`Ollama parse error: ${raw.slice(0, 200)}`)); }
        });
        res.on("error", (e) => { if (hardTimer) clearTimeout(hardTimer); reject(e); });
      }
    );
    req.on("error", (e: any) => {
      if (hardTimer) clearTimeout(hardTimer);
      const msg = e.code === "ECONNREFUSED"
        ? `CRITICAL: Ollama not running — connection refused — Ollama is NOT responding at ${opts.url}`
        : e.message;
      reject(new Error(msg));
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

export function streamOllamaAgentic(
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
      onChunk(`⏳ Ollama thinking…`, "tool");
      let response: any;
      try {
        currentRequest = ollamaChatOnce(current, OLLAMA_TOOLS, opts);
        response = await currentRequest.promise;
        currentRequest = null;
      } catch (e: any) {
        currentRequest = null;
        if (aborted) return;
        const alive = await isOllamaAlive(opts.url);
        if (alive) {
          onChunk(`⚠ Timeout but Ollama is alive — model may be slow. Retrying once…`, "error");
          try {
            currentRequest = ollamaChatOnce(current, OLLAMA_TOOLS, opts);
            response = await currentRequest.promise;
            currentRequest = null;
          } catch (retryErr: any) {
            currentRequest = null;
            if (!aborted) onError(`CRITICAL AFTER RETRY: ${retryErr.message ?? String(retryErr)}`);
            return;
          }
        } else {
          const errMsg = e.message ?? String(e);
          onError(errMsg.startsWith("CRITICAL") ? errMsg : `CRITICAL: ${errMsg} — Ollama is NOT responding at ${opts.url}`);
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
        } catch { args = {}; }

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
