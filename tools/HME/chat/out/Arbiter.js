"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.classifyMessage = classifyMessage;
exports.synthesizeNarrative = synthesizeNarrative;
exports.synthesizeChainSummary = synthesizeChainSummary;
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
const http = __importStar(require("http"));
const DAEMON_PORT = parseInt(process.env.HME_LLAMACPP_DAEMON_PORT || "7735", 10);
const ARBITER_MODEL = "qwen3:4b";
const CHAIN_SUMMARY_MODEL = "qwen3:30b-a3b";
// 30s TTL prevents redundant arbiter calls for repeated/similar messages
const _decisionCache = new Map();
const CACHE_TTL_MS = 30000;
function _cacheKey(msg, cc, ec) {
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
/** POST to the llamacpp_daemon /generate — daemon owns routing, timeouts, busy flags. */
function daemonPost(payload) {
    return new Promise((resolve, reject) => {
        const body = Buffer.from(JSON.stringify(payload), "utf8");
        const req = http.request({
            hostname: "127.0.0.1", port: DAEMON_PORT, path: "/generate", method: "POST",
            headers: { "Content-Type": "application/json", "Content-Length": body.length },
        }, (res) => {
            let raw = "";
            res.on("data", (c) => { raw += c.toString("utf8"); });
            res.on("end", () => {
                try {
                    const parsed = JSON.parse(raw);
                    if (parsed.error) {
                        reject(new Error(parsed.error));
                        return;
                    }
                    resolve(parsed.response ?? "");
                }
                catch (e) {
                    reject(new Error(`daemon parse error: ${e?.message ?? e}`));
                }
            });
        });
        req.on("error", (e) => {
            reject(new Error(e?.code === "ECONNREFUSED" ? "llamacpp_daemon not running" : (e?.message ?? String(e))));
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
async function classifyMessage(message, transcriptContext, constraintCount, errorCount = 0) {
    const key = _cacheKey(message, constraintCount, errorCount);
    const cached = _decisionCache.get(key);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS)
        return cached.decision;
    const prompt = CLASSIFY_PROMPT
        .replace("{message}", message.slice(0, 1000))
        .replace("{transcript}", transcriptContext.slice(0, 1500))
        .replace("{constraint_count}", String(constraintCount))
        .replace("{error_count}", String(errorCount));
    let contentAccum;
    try {
        contentAccum = await daemonPost({
            model: ARBITER_MODEL, messages: [{ role: "user", content: prompt }],
            max_tokens: 256, temperature: 0, response_format: { type: "json_object" },
        });
    }
    catch (e) {
        const reason = e?.message?.includes("not running")
            ? "arbiter unreachable — llama.cpp not running"
            : `arbiter ${e?.message ?? e}`;
        return { route: "claude", confidence: 0.5, reason, escalated: false, isError: true };
    }
    try {
        const inner = JSON.parse(contentAccum);
        const route = inner.route === "local" ? "local" : "claude";
        const confidence = Math.min(1, Math.max(0, Number(inner.confidence) || 0.5));
        const reason = String(inner.reason ?? "").slice(0, 200) || "arbiter parse failed";
        // Low-confidence local decisions escalate to claude for safety
        const escalated = route === "local" && confidence < 0.65;
        const decision = {
            route: escalated ? "claude" : route,
            confidence, reason, escalated, isError: false,
        };
        _decisionCache.set(key, { decision, ts: Date.now() });
        return decision;
    }
    catch {
        return { route: "claude", confidence: 0.5, reason: `arbiter parse failed: ${contentAccum.slice(0, 80)}`, escalated: false, isError: true };
    }
}
/**
 * Narrative synthesis — ask local model to summarize recent session activity
 * into a compact digest for transcript injection.
 */
async function synthesizeNarrative(entries) {
    if (entries.length < 4)
        return "";
    const summaries = entries.map((e) => e.summary || e.content.slice(0, 100)).join("\n");
    const prompt = `/no_think\n\nSummarize this coding session activity into a 2-3 sentence digest. Focus on: what was being worked on, what succeeded, what failed, and what's pending. Be extremely concise.

Session activity:
${summaries.slice(0, 2000)}

Digest:`;
    const content = await daemonPost({
        model: ARBITER_MODEL, messages: [{ role: "user", content: prompt }],
        max_tokens: 512, temperature: 0.2,
    });
    return content.trim().slice(0, 500);
}
/**
 * Chain link summary — ask local reasoning model to generate a continuation
 * summary for context chaining. Uses qwen3:30b-a3b (GPU, reasoning-capable)
 * on the main llama.cpp port, not the tiny arbiter model.
 */
async function synthesizeChainSummary(prompt) {
    const content = await daemonPost({
        model: CHAIN_SUMMARY_MODEL, messages: [{ role: "user", content: prompt }],
        max_tokens: 2048, temperature: 0.3,
    });
    return content.trim();
}
