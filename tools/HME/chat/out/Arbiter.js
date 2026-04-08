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
async function classifyMessage(message, transcriptContext, constraintCount) {
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
        const req = http.request({
            hostname: "localhost",
            port: 11434,
            path: "/api/chat",
            method: "POST",
            headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
            timeout: 15000,
        }, (res) => {
            let raw = "";
            res.on("data", (c) => { raw += c.toString("utf8"); });
            res.on("end", () => {
                try {
                    const outer = JSON.parse(raw);
                    const inner = JSON.parse(outer.message?.content ?? "{}");
                    const route = inner.route === "local" ? "local" : "claude";
                    const confidence = Math.min(1, Math.max(0, Number(inner.confidence) || 0.5));
                    const reason = String(inner.reason ?? "").slice(0, 200) || "arbiter parse failed";
                    resolve({ route, confidence, reason, escalated: false });
                }
                catch {
                    resolve({ route: "claude", confidence: 0.5, reason: "arbiter parse failed", escalated: false });
                }
            });
        });
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
async function synthesizeNarrative(entries) {
    if (entries.length < 4)
        return "";
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
        const req = http.request({
            hostname: "localhost", port: 11434, path: "/api/chat", method: "POST",
            headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
            timeout: 15000,
        }, (res) => {
            let raw = "";
            res.on("data", (c) => { raw += c.toString("utf8"); });
            res.on("end", () => {
                try {
                    const parsed = JSON.parse(raw);
                    resolve((parsed.message?.content ?? "").trim().slice(0, 500));
                }
                catch {
                    resolve("");
                }
            });
        });
        req.on("error", () => resolve(""));
        req.on("timeout", () => { req.destroy(); resolve(""); });
        req.write(body);
        req.end();
    });
}
