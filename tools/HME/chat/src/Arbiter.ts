/**
 * Arbiter — local Ollama model that classifies message complexity and routes
 * between Claude (expensive, high capability) and local models (free, fast).
 *
 * When the user selects "auto" route, the arbiter:
 * 1. Sends the message + recent transcript to a fast local model (qwen3:4b)
 * 2. Gets back a classification: { route, confidence, reason }
 * 3. Routes accordingly — Claude for complex/multi-file/architectural work,
 *    local for simple queries/single-file edits/explanations
 *
 * Classification signals the arbiter uses:
 * - Message length and complexity (multi-step requests → Claude)
 * - Mentions of multiple files, architectural changes → Claude
 * - Simple questions, explanations, small edits → local
 * - KB constraint density (many constraints → Claude for safety)
 * - Recent error rate in transcript (errors → escalate to Claude)
 */
import * as http from "http";
import { TranscriptEntry } from "./TranscriptLogger";

export type ArbiterDecision = {
  route: "claude" | "local";
  confidence: number;  // 0.0–1.0
  reason: string;
  escalated: boolean;  // true if overriding user's preference
  isError: boolean;    // true whenever arbiter failed — never rely on string matching reason
  thinking?: string;   // raw chain-of-thought from model (if present)
};

const ARBITER_MODEL = "qwen3:4b";  // small, CPU-only — never competes with GPU-resident 30B models
const OLLAMA_URL = "http://localhost:11434";

const CLASSIFY_PROMPT = `/no_think
Route this coding assistant message to either "claude" (expensive, powerful) or "local" (free, fast).

Route to claude: multi-file changes, architectural refactors, complex debugging, security work, KB constraint violations, thorough analysis requests.
Route to local: simple questions, single-file edits, code explanations, formatting, quick lookups.

Recent session:
{transcript}

KB constraints: {constraint_count}

Message: {message}`;

const CLASSIFY_FORMAT = {
  type: "object",
  properties: {
    route: { type: "string", enum: ["claude", "local"] },
    confidence: { type: "number" },
    reason: { type: "string" },
  },
  required: ["route", "confidence", "reason"],
};

/**
 * Ask the local arbiter to classify a message.
 * Uses Ollama structured JSON output — eliminates CoT bleed into content field.
 * Falls back to "claude" on any error; error reason strings always contain
 * "timeout", "unreachable", or "failed" so isArbiterError fires downstream.
 */
export async function classifyMessage(
  message: string,
  transcriptContext: string,
  constraintCount: number
): Promise<ArbiterDecision> {
  const prompt = CLASSIFY_PROMPT
    .replace("{message}", message.slice(0, 1000))
    .replace("{transcript}", transcriptContext.slice(0, 1500))
    .replace("{constraint_count}", String(constraintCount));

  return new Promise((resolve) => {
    let done = false;
    const fail = (reason: string) => {
      if (!done) { done = true; req?.destroy(); resolve({ route: "claude", confidence: 0.5, reason, escalated: false, isError: true }); }
    };

    // Hard cap: 60s total. stream:true gives us per-chunk inactivity detection.
    const hardTimer = setTimeout(() => fail("arbiter timeout (60s hard cap)"), 60000);

    // Inactivity timer: if no bytes arrive within 15s, model is stuck (queue frozen or
    // runner in error state). Fail fast rather than burning the full 60s.
    let inactivityTimer = setTimeout(() => fail("arbiter inactive (no bytes in 15s — model queue frozen or runner stuck)"), 15000);
    const resetInactivity = () => {
      clearTimeout(inactivityTimer);
      inactivityTimer = setTimeout(() => fail("arbiter inactive (no bytes in 15s — model queue frozen or runner stuck)"), 15000);
    };

    // stream:true: first byte arrives as soon as Ollama starts processing.
    // If stuck (runner status:2, queue full), we get 0 bytes → inactivity fires in 15s.
    // Accumulate all content chunks; parse final assembled JSON at stream end.
    const body = JSON.stringify({
      model: ARBITER_MODEL,
      messages: [{ role: "user", content: prompt }],
      stream: true,
      think: false,
      format: CLASSIFY_FORMAT,
      options: { temperature: 0, num_predict: 256 },  // GPU auto-falls-back to CPU: only 1.3GB VRAM free, qwen3:4b needs 2.5GB
    });

    let req: ReturnType<typeof http.request>;
    req = http.request(
      {
        hostname: "localhost",
        port: 11434,
        path: "/api/chat",
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      },
      (res) => {
        // HTTP error from Ollama (model not found, overloaded, etc)
        if (res.statusCode && res.statusCode >= 400) {
          let errBody = "";
          res.on("data", (c: Buffer) => { errBody += c.toString("utf8"); });
          res.on("end", () => {
            try { fail(`arbiter HTTP ${res.statusCode}: ${(JSON.parse(errBody) as any).error ?? errBody.slice(0, 100)}`); }
            catch { fail(`arbiter HTTP ${res.statusCode}: ${errBody.slice(0, 100)}`); }
          });
          return;
        }
        let contentAccum = "";
        let rawChunk = "";
        res.on("data", (c: Buffer) => {
          resetInactivity();
          rawChunk += c.toString("utf8");
          const lines = rawChunk.split("\n");
          rawChunk = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const obj = JSON.parse(line);
              contentAccum += obj.message?.content ?? "";
            } catch { /* partial streaming line — rawChunk buffer handles reassembly */ }
          }
        });
        res.on("end", () => {
          clearTimeout(hardTimer);
          clearTimeout(inactivityTimer);
          if (done) return;
          done = true;
          try {
            const inner = JSON.parse(contentAccum);
            const route = inner.route === "local" ? "local" : "claude" as "claude" | "local";
            const confidence = Math.min(1, Math.max(0, Number(inner.confidence) || 0.5));
            const reason = String(inner.reason ?? "").slice(0, 200) || "arbiter parse failed";
            resolve({ route, confidence, reason, escalated: false, isError: false });
          } catch {
            resolve({ route: "claude", confidence: 0.5, reason: `arbiter parse failed: ${contentAccum.slice(0, 80)}`, escalated: false, isError: true });
          }
        });
      }
    );
    req.on("error", (e: any) => {
      clearTimeout(hardTimer);
      clearTimeout(inactivityTimer);
      if (done) return;
      done = true;
      const reason = e?.code === "ECONNREFUSED" ? "arbiter unreachable — Ollama not running" : `arbiter unreachable: ${e?.message ?? e}`;
      resolve({ route: "claude", confidence: 0.5, reason, escalated: false, isError: true });
    });
    req.write(body);
    req.end();
  });
}

/**
 * Narrative synthesis — ask local model to summarize recent session activity
 * into a compact digest for transcript injection.
 */
export async function synthesizeNarrative(
  entries: TranscriptEntry[]
): Promise<string> {
  if (entries.length < 4) return "";

  const summaries = entries
    .map((e) => e.summary || e.content.slice(0, 100))
    .join("\n");

  const prompt = `/no_think\n\nSummarize this coding session activity into a 2-3 sentence digest. Focus on: what was being worked on, what succeeded, what failed, and what's pending. Be extremely concise.

Session activity:
${summaries.slice(0, 2000)}

Digest:`;

  return new Promise((resolve, reject) => {
    let done = false;
    const fail = (err: Error) => { if (!done) { done = true; req?.destroy(); reject(err); } };

    const hardTimer = setTimeout(() => fail(new Error("Narrative synthesis timeout (60s hard cap)")), 60000);
    let inactivityTimer = setTimeout(() => fail(new Error("Narrative synthesis inactive (no bytes in 15s — model stuck)")), 15000);
    const resetInactivity = () => {
      clearTimeout(inactivityTimer);
      inactivityTimer = setTimeout(() => fail(new Error("Narrative synthesis inactive (no bytes in 15s — model stuck)")), 15000);
    };

    const body = JSON.stringify({
      model: ARBITER_MODEL,
      messages: [{ role: "user", content: prompt }],
      stream: true,
      think: false,
      options: { temperature: 0.2, num_predict: 512 },  // GPU auto-falls-back to CPU: only 1.3GB VRAM free
    });

    let req: ReturnType<typeof http.request>;
    req = http.request(
      {
        hostname: "localhost", port: 11434, path: "/api/chat", method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          let errBody = "";
          res.on("data", (c: Buffer) => { errBody += c.toString("utf8"); });
          res.on("end", () => {
            try { fail(new Error(`Narrative HTTP ${res.statusCode}: ${(JSON.parse(errBody) as any).error ?? errBody.slice(0, 100)}`)); }
            catch { fail(new Error(`Narrative HTTP ${res.statusCode}: ${errBody.slice(0, 100)}`)); }
          });
          return;
        }
        let contentAccum = "";
        let rawChunk = "";
        res.on("data", (c: Buffer) => {
          resetInactivity();
          rawChunk += c.toString("utf8");
          const lines = rawChunk.split("\n");
          rawChunk = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            try { contentAccum += JSON.parse(line).message?.content ?? ""; } catch { /* partial streaming line */ }
          }
        });
        res.on("end", () => {
          clearTimeout(hardTimer);
          clearTimeout(inactivityTimer);
          if (done) return;
          done = true;
          resolve(contentAccum.trim().slice(0, 500));
        });
      }
    );
    req.on("error", (e: any) => {
      clearTimeout(hardTimer);
      clearTimeout(inactivityTimer);
      const reason = e?.code === "ECONNREFUSED" ? "Ollama not running" : (e?.message ?? e);
      fail(new Error(`Narrative synthesis unreachable: ${reason}`));
    });
    req.write(body);
    req.end();
  });
}
