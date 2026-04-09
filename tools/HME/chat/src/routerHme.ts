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

export async function validateMessage(message: string): Promise<{ warnings: any[]; blocks: any[] }> {
  return new Promise((resolve, reject) => {
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
          catch (e: any) { reject(new Error(`HME /validate parse error: ${e?.message ?? e}`)); }
        });
      }
    );
    req.on("error", (e: any) => reject(new Error(`HME /validate unreachable: ${e?.message ?? e}`)));
    req.write(body);
    req.end();
  });
}

export async function auditChanges(changedFiles: string = ""): Promise<{ violations: any[]; changed_files: string[] }> {
  return new Promise((resolve, reject) => {
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
          catch (e: any) { reject(new Error(`HME /audit parse error: ${e?.message ?? e}`)); }
        });
      }
    );
    req.on("error", (e: any) => reject(new Error(`HME /audit unreachable: ${e?.message ?? e}`)));
    req.write(body);
    req.end();
  });
}

export async function postTranscript(entries: any[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ entries });
    const req = http.request(
      {
        hostname: "127.0.0.1", port: HME_HTTP_PORT, path: "/transcript", method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      },
      () => resolve()
    );
    req.on("error", (e: any) => reject(new Error(`HME /transcript unreachable: ${e?.message ?? e}`)));
    req.write(body);
    req.end();
  });
}

export async function reindexFiles(files: string[]): Promise<{ indexed: string[]; count: number }> {
  return new Promise((resolve, reject) => {
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
          catch (e: any) { reject(new Error(`HME /reindex parse error: ${e?.message ?? e}`)); }
        });
      }
    );
    req.on("error", (e: any) => reject(new Error(`HME /reindex unreachable: ${e?.message ?? e}`)));
    req.write(body);
    req.end();
  });
}

export async function postNarrative(narrative: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ narrative });
    const req = http.request(
      {
        hostname: "127.0.0.1", port: HME_HTTP_PORT, path: "/narrative", method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      },
      () => resolve()
    );
    req.on("error", (e: any) => reject(new Error(`HME /narrative unreachable: ${e?.message ?? e}`)));
    req.write(body);
    req.end();
  });
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
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ source, message, detail });
    const req = http.request(
      {
        hostname: "127.0.0.1", port: HME_HTTP_PORT, path: "/error", method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      },
      () => resolve()
    );
    req.on("error", (e: any) => reject(new Error(`HME /error unreachable: ${e?.message ?? e}`)));
    req.write(body);
    req.end();
  });
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
