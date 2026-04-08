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
const CLASSIFY_PROMPT = `You are a routing arbiter for a coding assistant. Classify the user's message to decide which AI should handle it.

ROUTE TO CLAUDE (expensive, powerful) when:
- Multi-file architectural changes
- Complex debugging requiring deep codebase understanding
- Refactoring across module boundaries
- Security-sensitive operations
- When KB constraints/anti-patterns are dense (high violation risk)
- When recent transcript shows errors or failed attempts
- The message explicitly asks for thorough analysis

ROUTE TO LOCAL (free, fast) when:
- Simple questions about code
- Single-file edits
- Explanations of existing code
- Formatting/style changes
- Quick lookups or searches
- The message is short and straightforward

Recent session activity:
{transcript}

KB constraint density: {constraint_count} relevant constraints found

User message:
{message}

Respond with EXACTLY one line in this format:
ROUTE: claude|local CONFIDENCE: 0.0-1.0 REASON: brief explanation`;
/**
 * Ask the local arbiter to classify a message.
 * Falls back to "claude" if Ollama is unreachable or response is unparseable.
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
            options: { temperature: 0.1, num_predict: 512 },
        });
        const req = http.request({
            hostname: "localhost",
            port: 11434,
            path: "/api/chat",
            method: "POST",
            headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
            timeout: 12000,
        }, (res) => {
            let raw = "";
            res.on("data", (c) => { raw += c.toString("utf8"); });
            res.on("end", () => {
                try {
                    const parsed = JSON.parse(raw);
                    const response = parsed.message?.content ?? "";
                    resolve(parseArbiterResponse(response));
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
function parseArbiterResponse(text) {
    // Expected: ROUTE: claude|local CONFIDENCE: 0.8 REASON: multi-file refactor
    const routeMatch = text.match(/ROUTE:\s*(claude|local)/i);
    const confMatch = text.match(/CONFIDENCE:\s*([0-9.]+)/i);
    const reasonMatch = text.match(/REASON:\s*(.+)/i);
    const route = (routeMatch?.[1]?.toLowerCase() === "local" ? "local" : "claude");
    const confidence = confMatch ? Math.min(1, Math.max(0, parseFloat(confMatch[1]))) : 0.5;
    const reason = reasonMatch?.[1]?.trim() ?? "no reason given";
    return { route, confidence, reason, escalated: false };
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
    const prompt = `Summarize this coding session activity into a 2-3 sentence digest. Focus on: what was being worked on, what succeeded, what failed, and what's pending. Be extremely concise.

Session activity:
${summaries.slice(0, 2000)}

Digest:`;
    return new Promise((resolve) => {
        const body = JSON.stringify({
            model: ARBITER_MODEL,
            messages: [{ role: "user", content: prompt }],
            stream: false,
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
