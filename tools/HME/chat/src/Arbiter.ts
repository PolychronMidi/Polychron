/**
 * Arbiter — local llama.cpp model that classifies message complexity and routes
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
import { TranscriptEntry } from "./session/TranscriptLogger";

export type ArbiterDecision = {
  route: "claude" | "local";
  confidence: number;  // 0.0–1.0
  reason: string;
  escalated: boolean;  // true if overriding user's preference
  isError: boolean;    // true whenever arbiter failed — never rely on string matching reason
  thinking?: string;   // raw chain-of-thought from model (if present)
};

const ARBITER_PORT = parseInt(process.env.HME_ARBITER_PORT || "8080", 10);
const CODER_PORT = parseInt(process.env.HME_CODER_PORT || "8081", 10);
const ARBITER_MODEL = "qwen3:4b";
const CHAIN_SUMMARY_MODEL = "qwen3:30b-a3b";

// 30s TTL prevents redundant arbiter calls for repeated/similar messages
const _decisionCache = new Map<string, { decision: ArbiterDecision; ts: number }>();
const CACHE_TTL_MS = 30_000;
function _cacheKey(msg: string, cc: number, ec: number): string {
  return `${cc}:${ec}:${msg.slice(0, 200)}`;
}

const CLASSIFY_PROMPT = `/no_think
Route this coding assistant message to either "claude" (expensive, powerful) or "local" (free, fast).

Route to claude: multi-file changes, architectural refactors, complex debugging, security work, KB constraint violations, thorough analysis requests, or when recent errors suggest complexity.
Route to local: simple questions, single-file edits, code explanations, formatting, quick lookups.

Recent session:
{transcript}

KB constraint hits for this message: {constraint_count} (high count = touches heavily-constrained modules → prefer claude)
Recent errors in session: {error_count} (high count = session is struggling → prefer claude)

Message: {message}`;

/** POST to a llama-server OpenAI-compat endpoint and return the content string. */
function llamacppChat(
  port: number,
  messages: Array<{ role: string; content: string }>,
  opts: {
    model: string;
    max_tokens?: number;
    temperature?: number;
    response_format?: { type: string };
    timeoutMs?: number;
  }
): Promise<string> {
  return new Promise((resolve, reject) => {
    let done = false;
    const fail = (err: Error) => { if (!done) { done = true; req?.destroy(); reject(err); } };
    const ms = opts.timeoutMs ?? 60_000;
    const timer = setTimeout(() => fail(new Error(`llama.cpp timeout (${ms / 1000}s)`)), ms);

    const payload: Record<string, unknown> = {
      model: opts.model, messages, stream: false,
    };
    if (opts.max_tokens !== undefined) payload.max_tokens = opts.max_tokens;
    if (opts.temperature !== undefined) payload.temperature = opts.temperature;
    if (opts.response_format) payload.response_format = opts.response_format;

    const body = Buffer.from(JSON.stringify(payload), "utf8");
    let req: ReturnType<typeof http.request>;
    req = http.request(
      {
        hostname: "127.0.0.1", port, path: "/v1/chat/completions", method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": body.length },
      },
      (res) => {
        let raw = "";
        res.on("data", (c: Buffer) => { raw += c.toString("utf8"); });
        res.on("end", () => {
          clearTimeout(timer);
          if (done) return;
          done = true;
          if (res.statusCode && res.statusCode >= 400) {
            try { reject(new Error(`HTTP ${res.statusCode}: ${(JSON.parse(raw) as any).error?.message ?? raw.slice(0, 100)}`)); }
            catch { reject(new Error(`HTTP ${res.statusCode}: ${raw.slice(0, 100)}`)); }
            return;
          }
          try {
            const parsed = JSON.parse(raw);
            resolve((parsed.choices?.[0]?.message?.content as string) ?? "");
          } catch (e: any) {
            reject(new Error(`parse error: ${e?.message ?? e}`));
          }
        });
      }
    );
    req.on("error", (e: any) => {
      clearTimeout(timer);
      const msg = e?.code === "ECONNREFUSED" ? "llama.cpp not running" : (e?.message ?? String(e));
      fail(new Error(msg));
    });
    req.write(body);
    req.end();
  });
}

/**
 * Ask the local arbiter to classify a message.
 * Uses llama.cpp structured JSON output — eliminates CoT bleed into content field.
 * Falls back to "claude" on any error; isError=true flags the failure downstream.
 */
export async function classifyMessage(
  message: string,
  transcriptContext: string,
  constraintCount: number,
  errorCount: number = 0
): Promise<ArbiterDecision> {
  const key = _cacheKey(message, constraintCount, errorCount);
  const cached = _decisionCache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.decision;

  const prompt = CLASSIFY_PROMPT
    .replace("{message}", message.slice(0, 1000))
    .replace("{transcript}", transcriptContext.slice(0, 1500))
    .replace("{constraint_count}", String(constraintCount))
    .replace("{error_count}", String(errorCount));

  let contentAccum: string;
  try {
    contentAccum = await llamacppChat(ARBITER_PORT, [{ role: "user", content: prompt }], {
      model: ARBITER_MODEL, max_tokens: 256, temperature: 0,
      response_format: { type: "json_object" }, timeoutMs: 60_000,
    });
  } catch (e: any) {
    const reason = e?.message?.includes("not running")
      ? "arbiter unreachable — llama.cpp not running"
      : `arbiter ${e?.message ?? e}`;
    return { route: "claude", confidence: 0.5, reason, escalated: false, isError: true };
  }

  try {
    const inner = JSON.parse(contentAccum);
    const route = inner.route === "local" ? "local" : "claude" as "claude" | "local";
    const confidence = Math.min(1, Math.max(0, Number(inner.confidence) || 0.5));
    const reason = String(inner.reason ?? "").slice(0, 200) || "arbiter parse failed";
    // Low-confidence local decisions escalate to claude for safety
    const escalated = route === "local" && confidence < 0.65;
    const decision: ArbiterDecision = {
      route: escalated ? "claude" : route,
      confidence, reason, escalated, isError: false,
    };
    _decisionCache.set(key, { decision, ts: Date.now() });
    return decision;
  } catch {
    return { route: "claude", confidence: 0.5, reason: `arbiter parse failed: ${contentAccum.slice(0, 80)}`, escalated: false, isError: true };
  }
}

/**
 * Narrative synthesis — ask local model to summarize recent session activity
 * into a compact digest for transcript injection.
 */
export async function synthesizeNarrative(entries: TranscriptEntry[]): Promise<string> {
  if (entries.length < 4) return "";

  const summaries = entries.map((e) => e.summary || e.content.slice(0, 100)).join("\n");
  const prompt = `/no_think\n\nSummarize this coding session activity into a 2-3 sentence digest. Focus on: what was being worked on, what succeeded, what failed, and what's pending. Be extremely concise.

Session activity:
${summaries.slice(0, 2000)}

Digest:`;

  // 180s — CPU-only qwen3:4b for 512 tokens can exceed 60s when busy. Non-fatal.
  const content = await llamacppChat(ARBITER_PORT, [{ role: "user", content: prompt }], {
    model: ARBITER_MODEL, max_tokens: 512, temperature: 0.2, timeoutMs: 180_000,
  });
  return content.trim().slice(0, 500);
}

/**
 * Chain link summary — ask local reasoning model to generate a continuation
 * summary for context chaining. Uses qwen3:30b-a3b (GPU, reasoning-capable)
 * on the main llama.cpp port, not the tiny arbiter model.
 */
export async function synthesizeChainSummary(prompt: string): Promise<string> {
  const content = await llamacppChat(CODER_PORT, [{ role: "user", content: prompt }], {
    model: CHAIN_SUMMARY_MODEL, max_tokens: 2048, temperature: 0.3, timeoutMs: 180_000,
  });
  return content.trim();
}
