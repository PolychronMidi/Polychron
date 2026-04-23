import * as http from "http";
import { LlamacppMessage, ChunkCallback } from "../router";
import { streamLlamacppAgentic as streamLlamacppAgentic } from "./routerLlamacpp";
import { AGENTIC_SYSTEM_PROMPT } from "../streamUtils";

const HME_HTTP_PORT = (() => {
  const raw = process.env.HME_PROXY_PORT;
  if (raw == null || raw === "") return 9099;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 65535) {
    throw new Error(`HME_PROXY_PORT="${raw}" is not a valid port (0-65535)`);
  }
  return n;
})();
const HME_HTTP_URL = `http://127.0.0.1:${HME_HTTP_PORT}`;

//  HME context enrichment

export interface EnrichResult {
  warm: string;
  kb: Array<{ title: string; content: string; category: string; score: number }>;
  kbCount: number;
}

export async function fetchHmeContext(query: string, topK: number = 5): Promise<EnrichResult> {
  return shimPost<EnrichResult>(
    "/enrich",
    JSON.stringify({ query, top_k: topK }),
    (raw) => {
      const parsed = JSON.parse(raw);
      const kb = parsed.kb ?? [];
      return { warm: parsed.warm ?? "", kb, kbCount: kb.length };
    },
  );
}

function shimGet<T>(path: string, parse: (raw: string) => T, fallback: T, timeoutMs: number = 1000): Promise<T> {
  return new Promise((resolve) => {
    const req = http.get(`${HME_HTTP_URL}/chat${path}`, (res) => {
      let raw = "";
      res.on("data", (c: Buffer) => { raw += c.toString("utf8"); });
      res.on("end", () => {
        try { resolve(parse(raw)); }
        catch (e: any) {
          console.error(`[HME] shim ${path} parse error: ${e?.message ?? e}`);
          resolve(fallback);
        }
      });
    });
    req.on("error", (e: any) => {
      console.error(`[HME] shim ${path} unreachable: ${e?.message ?? e}`);
      resolve(fallback);
    });
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve(fallback); });
  });
}

/** Single attempt — pure transport. Used inside _shimPostWithRetry. */
function _shimPostOnce<T>(path: string, body: string, parse: (raw: string) => T, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    let done = false;
    const fail = (msg: string) => { if (!done) { done = true; req.destroy(); reject(new Error(msg)); } };
    const timer = setTimeout(() => fail(`HME shim ${path} timeout (${timeoutMs / 1000}s)`), timeoutMs);
    const req = http.request(
      {
        hostname: "127.0.0.1", port: HME_HTTP_PORT, path: `/chat${path}`, method: "POST",
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

/** Shim POST with one transparent retry on transient failure (ECONNREFUSED,
 * ETIMEDOUT, parse error). The shim restarts during updates; a single-
 * shot call would surface the restart as a user-facing failure even when
 * a 1s wait would have succeeded. Parse errors do not retry — they
 * indicate a contract mismatch, not transport flakiness. */
function shimPost<T>(path: string, body: string, parse: (raw: string) => T, timeoutMs: number = 5000): Promise<T> {
  return _shimPostOnce(path, body, parse, timeoutMs).catch((err: any) => {
    const msg = String(err?.message ?? err);
    const transient = /unreachable|timeout|ECONNREFUSED|ETIMEDOUT|ECONNRESET|EPIPE/i.test(msg);
    if (!transient) throw err;
    console.error(`[HME] shim ${path} retrying after transient: ${msg.slice(0, 120)}`);
    return new Promise<T>((resolve, reject) => {
      setTimeout(() => {
        _shimPostOnce(path, body, parse, timeoutMs).then(resolve, reject);
      }, 1000);
    });
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
  return shimPost("/reindex", JSON.stringify({ files }), JSON.parse, 30000);
}

export async function postNarrative(narrative: string): Promise<void> {
  return shimPost("/narrative", JSON.stringify({ narrative }), () => undefined);
}

export async function isHmeShimReady(): Promise<{ ready: boolean; errors: any[] }> {
  return shimGet<{ ready: boolean; errors: any[] }>(
    "/health",
    (raw) => {
      const parsed = JSON.parse(raw);
      return { ready: parsed.status === "ready", errors: parsed.recent_errors ?? [] };
    },
    { ready: false, errors: [{ message: "unreachable or timeout" }] },
  );
}

export async function logShimError(source: string, message: string, detail: string = ""): Promise<void> {
  return shimPost("/error", JSON.stringify({ source, message, detail }), () => undefined);
  // Do NOT swallow rejection here — BrowserPanel's .catch() on this call is the disk fallback.
  // Swallowing here makes logShimError always resolve, killing the fallback silently.
}

//  Hybrid route

export async function streamHybrid(
  message: string,
  history: LlamacppMessage[],
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
    // KB enrichment failure is non-fatal — continue with empty context
    onChunk(`[HME] KB context unavailable: ${e?.message ?? e}`, "tool");
  }

  const messages: LlamacppMessage[] = [];

  const systemContent = [
    AGENTIC_SYSTEM_PROMPT,
    hmeWarm ? `\nProject knowledge base context:\n${hmeWarm}` : "",
  ].join("").trim();

  messages.push({ role: "system", content: systemContent });
  messages.push(...history, { role: "user", content: message });

  return streamLlamacppAgentic(messages, opts, workingDir, onChunk, onDone, onError);
}
