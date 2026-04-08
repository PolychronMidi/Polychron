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
const ARBITER_MODEL = "qwen3:4b"; // small, CPU-only (num_gpu:0) — never competes with GPU-resident 30B models
const OLLAMA_URL = "http://localhost:11434";
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
 * Ask the local arbiter to classify a message.
 * Uses Ollama structured JSON output — eliminates CoT bleed into content field.
 * Falls back to "claude" on any error; error reason strings always contain
 * "timeout", "unreachable", or "failed" so isArbiterError fires downstream.
 */
async function classifyMessage(message, transcriptContext, constraintCount, errorCount = 0) {
    const prompt = CLASSIFY_PROMPT
        .replace("{message}", message.slice(0, 1000))
        .replace("{transcript}", transcriptContext.slice(0, 1500))
        .replace("{constraint_count}", String(constraintCount))
        .replace("{error_count}", String(errorCount));
    return new Promise((resolve) => {
        let done = false;
        const fail = (reason) => {
            if (!done) {
                done = true;
                req?.destroy();
                resolve({ route: "claude", confidence: 0.5, reason, escalated: false, isError: true });
            }
        };
        // Hard cap: 60s total. qwen3-coder:30b is always GPU-resident (keep_alive=-1) — should respond in <5s.
        const hardTimer = setTimeout(() => fail("arbiter timeout (60s hard cap)"), 60000);
        // Inactivity timer: starts only after FIRST byte. Before first byte, the hard cap
        // covers truly stuck runners — cold model loading takes >15s and is not a stall.
        // After first byte: 15s with no new data = runner stuck mid-stream.
        let inactivityTimer = null;
        const resetInactivity = () => {
            if (inactivityTimer)
                clearTimeout(inactivityTimer);
            inactivityTimer = setTimeout(() => fail("arbiter inactive (no bytes for 15s mid-stream — runner stuck)"), 15000);
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
            options: { temperature: 0, num_predict: 256, num_gpu: 0 }, // num_gpu:0 = CPU-only, never steal VRAM from 30B models
        });
        let req;
        req = http.request({
            hostname: "localhost",
            port: 11434,
            path: "/api/chat",
            method: "POST",
            headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
        }, (res) => {
            // HTTP error from Ollama (model not found, overloaded, etc)
            if (res.statusCode && res.statusCode >= 400) {
                let errBody = "";
                res.on("data", (c) => { errBody += c.toString("utf8"); });
                res.on("end", () => {
                    try {
                        fail(`arbiter HTTP ${res.statusCode}: ${JSON.parse(errBody).error ?? errBody.slice(0, 100)}`);
                    }
                    catch {
                        fail(`arbiter HTTP ${res.statusCode}: ${errBody.slice(0, 100)}`);
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
                        const obj = JSON.parse(line);
                        contentAccum += obj.message?.content ?? "";
                    }
                    catch { /* partial streaming line — rawChunk buffer handles reassembly */ }
                }
            });
            res.on("end", () => {
                clearTimeout(hardTimer);
                if (inactivityTimer)
                    clearTimeout(inactivityTimer);
                if (done)
                    return;
                done = true;
                try {
                    const inner = JSON.parse(contentAccum);
                    const route = inner.route === "local" ? "local" : "claude";
                    const confidence = Math.min(1, Math.max(0, Number(inner.confidence) || 0.5));
                    const reason = String(inner.reason ?? "").slice(0, 200) || "arbiter parse failed";
                    resolve({ route, confidence, reason, escalated: false, isError: false });
                }
                catch {
                    resolve({ route: "claude", confidence: 0.5, reason: `arbiter parse failed: ${contentAccum.slice(0, 80)}`, escalated: false, isError: true });
                }
            });
        });
        req.on("error", (e) => {
            clearTimeout(hardTimer);
            if (inactivityTimer !== null)
                clearTimeout(inactivityTimer);
            if (done)
                return;
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
    return new Promise((resolve, reject) => {
        let done = false;
        const fail = (err) => { if (!done) {
            done = true;
            req?.destroy();
            reject(err);
        } };
        const hardTimer = setTimeout(() => fail(new Error("Narrative synthesis timeout (60s hard cap)")), 60000);
        // Start only after first byte — cold model loading takes >15s and is not a stall.
        let inactivityTimer = null;
        const resetInactivity = () => {
            if (inactivityTimer)
                clearTimeout(inactivityTimer);
            inactivityTimer = setTimeout(() => fail(new Error("Narrative synthesis inactive (no bytes for 15s mid-stream — model stuck)")), 15000);
        };
        const body = JSON.stringify({
            model: ARBITER_MODEL,
            messages: [{ role: "user", content: prompt }],
            stream: true,
            think: false,
            options: { temperature: 0.2, num_predict: 512, num_gpu: 0 }, // CPU-only
        });
        let req;
        req = http.request({
            hostname: "localhost", port: 11434, path: "/api/chat", method: "POST",
            headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
        }, (res) => {
            if (res.statusCode && res.statusCode >= 400) {
                let errBody = "";
                res.on("data", (c) => { errBody += c.toString("utf8"); });
                res.on("end", () => {
                    try {
                        fail(new Error(`Narrative HTTP ${res.statusCode}: ${JSON.parse(errBody).error ?? errBody.slice(0, 100)}`));
                    }
                    catch {
                        fail(new Error(`Narrative HTTP ${res.statusCode}: ${errBody.slice(0, 100)}`));
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
                resolve(contentAccum.trim().slice(0, 500));
            });
        });
        req.on("error", (e) => {
            clearTimeout(hardTimer);
            if (inactivityTimer)
                clearTimeout(inactivityTimer);
            const reason = e?.code === "ECONNREFUSED" ? "Ollama not running" : (e?.message ?? e);
            fail(new Error(`Narrative synthesis unreachable: ${reason}`));
        });
        req.write(body);
        req.end();
    });
}
