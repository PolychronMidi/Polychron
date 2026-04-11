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
const http = __importStar(require("http"));
const ARBITER_MODEL = "qwen3:4b"; // small, CPU-only — dedicated instance on port 11436
const CHAIN_SUMMARY_MODEL = "qwen3:30b-a3b";
const CLASSIFY_PROMPT = `/no_think
Route this coding assistant message to either "claude" (expensive, powerful) or "local" (free, fast).

Route to claude: multi-file changes, architectural refactors, complex debugging, security work, KB constraint violations, thorough analysis requests, or when recent errors suggest complexity.
Route to local: simple questions, single-file edits, code explanations, formatting, quick lookups.

Recent session:
{transcript}

KB constraint hits for this message: {constraint_count} (high count = touches heavily-constrained modules → prefer claude)
Recent errors in session: {error_count} (high count = session is struggling → prefer claude)

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
 * Shared NDJSON streaming helper for Ollama API calls.
 * Accumulates message.content fields across chunks. Throws on HTTP errors,
 * hard timeout, inactivity timeout, or connection failure.
 * Inactivity timer starts at first byte (covers cold model loads before that).
 */
function ollamaStreamNdjson(hostname, port, body, hardMs, inactivityMs) {
    return new Promise((resolve, reject) => {
        let done = false;
        const fail = (err) => { if (!done) {
            done = true;
            req?.destroy();
            reject(err);
        } };
        const hardTimer = setTimeout(() => fail(new Error(`Ollama timeout (${hardMs / 1000}s)`)), hardMs);
        let inactivityTimer = null;
        const resetInactivity = () => {
            if (inactivityTimer)
                clearTimeout(inactivityTimer);
            inactivityTimer = setTimeout(() => fail(new Error(`Ollama inactive (${inactivityMs / 1000}s mid-stream)`)), inactivityMs);
        };
        let req;
        req = http.request({
            hostname, port, path: "/api/chat", method: "POST",
            headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
        }, (res) => {
            if (res.statusCode && res.statusCode >= 400) {
                let errBody = "";
                res.on("data", (c) => { errBody += c.toString("utf8"); });
                res.on("end", () => {
                    clearTimeout(hardTimer);
                    if (inactivityTimer)
                        clearTimeout(inactivityTimer);
                    try {
                        fail(new Error(`HTTP ${res.statusCode}: ${JSON.parse(errBody).error ?? errBody.slice(0, 100)}`));
                    }
                    catch {
                        fail(new Error(`HTTP ${res.statusCode}: ${errBody.slice(0, 100)}`));
                    }
                });
                return;
            }
            let contentAccum = "";
            let rawChunk = "";
            res.on("data", (c) => {
                resetInactivity();
                rawChunk += c.toString("utf8");
                const lines = rawChunk.split("\n");
                rawChunk = lines.pop() ?? "";
                for (const line of lines) {
                    if (!line.trim())
                        continue;
                    try {
                        contentAccum += JSON.parse(line).message?.content ?? "";
                    }
                    catch { /* partial streaming line */ }
                }
            });
            res.on("end", () => {
                clearTimeout(hardTimer);
                if (inactivityTimer)
                    clearTimeout(inactivityTimer);
                if (done)
                    return;
                done = true;
                resolve(contentAccum);
            });
        });
        req.on("error", (e) => {
            clearTimeout(hardTimer);
            if (inactivityTimer)
                clearTimeout(inactivityTimer);
            const msg = e?.code === "ECONNREFUSED" ? "Ollama not running" : (e?.message ?? String(e));
            fail(new Error(msg));
        });
        req.write(body);
        req.end();
    });
}
/**
 * Ask the local arbiter to classify a message.
 * Uses Ollama structured JSON output — eliminates CoT bleed into content field.
 * Falls back to "claude" on any error; isError=true flags the failure downstream.
 */
async function classifyMessage(message, transcriptContext, constraintCount, errorCount = 0) {
    const prompt = CLASSIFY_PROMPT
        .replace("{message}", message.slice(0, 1000))
        .replace("{transcript}", transcriptContext.slice(0, 1500))
        .replace("{constraint_count}", String(constraintCount))
        .replace("{error_count}", String(errorCount));
    const body = JSON.stringify({
        model: ARBITER_MODEL,
        messages: [{ role: "user", content: prompt }],
        stream: true, think: false, format: CLASSIFY_FORMAT,
        options: { temperature: 0, num_predict: 256, num_gpu: 0, num_ctx: 4096 },
    });
    let contentAccum;
    try {
        contentAccum = await ollamaStreamNdjson("localhost", 11436, body, 60000, 15000);
    }
    catch (e) {
        const reason = e?.message?.includes("not running")
            ? "arbiter unreachable — Ollama not running"
            : `arbiter ${e?.message ?? e}`;
        return { route: "claude", confidence: 0.5, reason, escalated: false, isError: true };
    }
    try {
        const inner = JSON.parse(contentAccum);
        const route = inner.route === "local" ? "local" : "claude";
        const confidence = Math.min(1, Math.max(0, Number(inner.confidence) || 0.5));
        const reason = String(inner.reason ?? "").slice(0, 200) || "arbiter parse failed";
        return { route, confidence, reason, escalated: false, isError: false };
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
    const body = JSON.stringify({
        model: ARBITER_MODEL,
        messages: [{ role: "user", content: prompt }],
        stream: true, think: false,
        options: { temperature: 0.2, num_predict: 512, num_gpu: 0, num_ctx: 4096 },
    });
    // 180s cap — CPU-only qwen3:4b for 512 tokens can exceed 60s when busy.
    // Narrative is background enrichment; timeout is expected and non-actionable.
    const content = await ollamaStreamNdjson("localhost", 11436, body, 180000, 30000);
    return content.trim().slice(0, 500);
}
/**
 * Chain link summary — ask local reasoning model to generate a continuation
 * summary for context chaining. Uses qwen3:30b-a3b (GPU, reasoning-capable)
 * on the main Ollama port, not the tiny arbiter model.
 */
async function synthesizeChainSummary(prompt) {
    const body = JSON.stringify({
        model: CHAIN_SUMMARY_MODEL,
        messages: [{ role: "user", content: prompt }],
        stream: true,
        options: { temperature: 0.3, num_predict: 2048, num_ctx: 49152 },
    });
    const content = await ollamaStreamNdjson("localhost", 11434, body, 180000, 30000);
    return content.trim();
}
