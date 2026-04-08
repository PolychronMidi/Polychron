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
  thinking?: string;   // raw chain-of-thought from model (if present)
};

const ARBITER_MODEL = "qwen3:4b";
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
    const body = JSON.stringify({
      model: ARBITER_MODEL,
      messages: [{ role: "user", content: prompt }],
      stream: false,
      think: false,
      format: CLASSIFY_FORMAT,
      options: { temperature: 0, num_predict: 256 },
    });

    const req = http.request(
      {
        hostname: "localhost",
        port: 11434,
        path: "/api/chat",
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
        timeout: 15000,
      },
      (res) => {
        let raw = "";
        res.on("data", (c: Buffer) => { raw += c.toString("utf8"); });
        res.on("end", () => {
          try {
            const outer = JSON.parse(raw);
            const inner = JSON.parse(outer.message?.content ?? "{}");
            const route = inner.route === "local" ? "local" : "claude" as "claude" | "local";
            const confidence = Math.min(1, Math.max(0, Number(inner.confidence) || 0.5));
            const reason = String(inner.reason ?? "").slice(0, 200) || "arbiter parse failed";
            resolve({ route, confidence, reason, escalated: false });
          } catch {
            resolve({ route: "claude", confidence: 0.5, reason: "arbiter parse failed", escalated: false });
          }
        });
      }
    );
    req.on("error", () => resolve({ route: "claude", confidence: 0.5, reason: "arbiter unreachable", escalated: false }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ route: "claude", confidence: 0.5, reason: "arbiter timeout", escalated: false });
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

  return new Promise((resolve) => {
    const body = JSON.stringify({
      model: ARBITER_MODEL,
      messages: [{ role: "user", content: prompt }],
      stream: false,
      think: false,
      options: { temperature: 0.2, num_predict: 512 },
    });

    const req = http.request(
      {
        hostname: "localhost", port: 11434, path: "/api/chat", method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
        timeout: 15000,
      },
      (res) => {
        let raw = "";
        res.on("data", (c: Buffer) => { raw += c.toString("utf8"); });
        res.on("end", () => {
          try {
            const parsed = JSON.parse(raw);
            resolve((parsed.message?.content ?? "").trim().slice(0, 500));
          } catch {
            resolve("");
          }
        });
      }
    );
    req.on("error", () => resolve(""));
    req.on("timeout", () => { req.destroy(); resolve(""); });
    req.write(body);
    req.end();
  });
}
