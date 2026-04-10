import * as http from "http";
import { OllamaMessage, ChunkCallback } from "./router";
import { streamOllamaAgentic } from "./routerOllama";

const HME_HTTP_PORT = 7734;
const HME_HTTP_URL = `http://127.0.0.1:${HME_HTTP_PORT}`;

// ── HME context enrichment ────────────────────────────────────────────────

export interface EnrichResult {
  warm: string;
  kb: Array<{ title: string; content: string; category: string; score: number }>;
  kbCount: number;
}

export async function fetchHmeContext(query: string, topK: number = 5): Promise<EnrichResult> {
  return new Promise((resolve, reject) => {
    let done = false;
    const fail = (msg: string) => { if (!done) { done = true; reject(new Error(msg)); } };
    const timer = setTimeout(() => { req.destroy(); fail("HME shim /enrich timeout (5s)"); }, 5000);
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
          clearTimeout(timer);
          if (done) return;
          done = true;
          try {
            const parsed = JSON.parse(raw);
            const kb = parsed.kb ?? [];
            resolve({ warm: parsed.warm ?? "", kb, kbCount: kb.length });
          } catch (e: any) {
            reject(new Error(`HME shim /enrich parse error: ${e?.message ?? e}`));
          }
        });
      }
    );
    req.on("error", (e: any) => { clearTimeout(timer); fail(`HME shim /enrich unreachable: ${e?.message ?? e}`); });
    req.write(body);
    req.end();
  });
}

function shimPost<T>(path: string, body: string, parse: (raw: string) => T, timeoutMs: number = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    let done = false;
    const fail = (msg: string) => { if (!done) { done = true; req.destroy(); reject(new Error(msg)); } };
    const timer = setTimeout(() => fail(`HME shim ${path} timeout (${timeoutMs / 1000}s)`), timeoutMs);
    const req = http.request(
      {
        hostname: "127.0.0.1", port: HME_HTTP_PORT, path, method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      },
      (res) => {
        let raw = "";
        res.on("data", (c: Buffer) => { raw += c.toString("utf8"); });
        res.on("end", () => {
          clearTimeout(timer);
          if (done) return;
          done = true;
          try { resolve(parse(raw)); }
          catch (e: any) { reject(new Error(`HME shim ${path} parse error: ${e?.message ?? e}`)); }
        });
      }
    );
    req.on("error", (e: any) => { clearTimeout(timer); fail(`HME shim ${path} unreachable: ${e?.message ?? e}`); });
    req.write(body);
    req.end();
  });
}

export interface EnrichPromptResult {
  enriched: string;
  original: string;
  triage: { kb: boolean; structural: boolean; contextual: boolean; raw: string };
  trace: { triage_ms: number; assembly_ms: number; enrich_ms: number; compress_ms: number };
  unchanged?: boolean;
  reason?: string;
  error?: string;
}

export async function enrichPrompt(prompt: string, frame: string = ""): Promise<EnrichPromptResult> {
  return shimPost<EnrichPromptResult>(
    "/enrich_prompt",
    JSON.stringify({ prompt, frame }),
    (raw) => JSON.parse(raw),
    200000,  // 200s — reasoning model needs time to think + generate
  );
}

export async function validateMessage(message: string): Promise<{ warnings: any[]; blocks: any[] }> {
  return shimPost("/validate", JSON.stringify({ query: message }), JSON.parse);
}

export async function auditChanges(changedFiles: string = ""): Promise<{ violations: any[]; changed_files: string[] }> {
  return shimPost("/audit", JSON.stringify({ changed_files: changedFiles }), JSON.parse, 15000);
}

export async function postTranscript(entries: any[]): Promise<void> {
  return shimPost("/transcript", JSON.stringify({ entries }), () => undefined);
}

export async function reindexFiles(files: string[]): Promise<{ indexed: string[]; count: number }> {
  return shimPost("/reindex", JSON.stringify({ files }), JSON.parse, 15000);
}

export async function postNarrative(narrative: string): Promise<void> {
  return shimPost("/narrative", JSON.stringify({ narrative }), () => undefined);
}

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
        catch (e: any) {
          console.error(`[HME] shim /health parse error: ${e?.message ?? e}`);
          resolve({ ready: false, errors: [{ message: `parse error: ${e?.message}` }] });
        }
      });
    });
    req.on("error", (e: any) => {
      console.error(`[HME] shim /health unreachable: ${e?.message ?? e}`);
      resolve({ ready: false, errors: [{ message: `unreachable: ${e?.message}` }] });
    });
    req.setTimeout(1000, () => { req.destroy(); resolve({ ready: false, errors: [{ message: "timeout" }] }); });
  });
}

export async function logShimError(source: string, message: string, detail: string = ""): Promise<void> {
  return shimPost("/error", JSON.stringify({ source, message, detail }), () => undefined);
  // Do NOT swallow rejection here — ChatPanel's .catch() on this call is the disk fallback.
  // Swallowing here makes logShimError always resolve, killing the fallback silently.
}

// ── Hybrid route ──────────────────────────────────────────────────────────

export async function streamHybrid(
  message: string,
  history: OllamaMessage[],
  opts: { model: string; url: string },
  workingDir: string,
  onChunk: ChunkCallback,
  onDone: () => void,
  onError: (msg: string) => void
): Promise<() => void> {
  let hmeWarm = "";
  try {
    const enriched = await fetchHmeContext(message);
    hmeWarm = enriched.warm;
  } catch (e: any) {
    onChunk(`FAILFAST: HME context enrichment failed: ${e?.message ?? e}`, "error");
  }

  const messages: OllamaMessage[] = [];

  const systemContent = [
    "You are an agentic coding assistant with access to bash, read_file, and write_file tools. When asked to perform a task — create files, edit code, run commands, implement features — call the appropriate tool immediately. Never respond with suggestions, plans, or code blocks without calling a tool first.",
    hmeWarm ? `\nProject knowledge base context:\n${hmeWarm}` : "",
  ].join("").trim();

  messages.push({ role: "system", content: systemContent });
  messages.push(...history, { role: "user", content: message });

  return streamOllamaAgentic(messages, opts, workingDir, onChunk, onDone, onError);
}
