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
exports.fetchHmeContext = fetchHmeContext;
exports.enrichPrompt = enrichPrompt;
exports.validateMessage = validateMessage;
exports.auditChanges = auditChanges;
exports.postTranscript = postTranscript;
exports.reindexFiles = reindexFiles;
exports.postNarrative = postNarrative;
exports.isHmeShimReady = isHmeShimReady;
exports.logShimError = logShimError;
exports.streamHybrid = streamHybrid;
const http = __importStar(require("http"));
const routerLlamacpp_1 = require("./routerLlamacpp");
const streamUtils_1 = require("../streamUtils");
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
async function fetchHmeContext(query, topK = 5) {
    return shimPost("/enrich", JSON.stringify({ query, top_k: topK }), (raw) => {
        const parsed = JSON.parse(raw);
        const kb = parsed.kb ?? [];
        return { warm: parsed.warm ?? "", kb, kbCount: kb.length };
    });
}
function shimGet(path, parse, fallback, timeoutMs = 1000) {
    return new Promise((resolve) => {
        const req = http.get(`${HME_HTTP_URL}/chat${path}`, (res) => {
            let raw = "";
            res.on("data", (c) => { raw += c.toString("utf8"); });
            res.on("end", () => {
                try {
                    resolve(parse(raw));
                }
                catch (e) {
                    console.error(`[HME] shim ${path} parse error: ${e?.message ?? e}`);
                    resolve(fallback);
                }
            });
        });
        req.on("error", (e) => {
            console.error(`[HME] shim ${path} unreachable: ${e?.message ?? e}`);
            resolve(fallback);
        });
        req.setTimeout(timeoutMs, () => { req.destroy(); resolve(fallback); });
    });
}
/** Single attempt — pure transport. Used inside _shimPostWithRetry. */
function _shimPostOnce(path, body, parse, timeoutMs) {
    return new Promise((resolve, reject) => {
        let done = false;
        const fail = (msg) => { if (!done) {
            done = true;
            req.destroy();
            reject(new Error(msg));
        } };
        const timer = setTimeout(() => fail(`HME shim ${path} timeout (${timeoutMs / 1000}s)`), timeoutMs);
        const req = http.request({
            hostname: "127.0.0.1", port: HME_HTTP_PORT, path: `/chat${path}`, method: "POST",
            headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
        }, (res) => {
            let raw = "";
            res.on("data", (c) => { raw += c.toString("utf8"); });
            res.on("end", () => {
                clearTimeout(timer);
                if (done)
                    return;
                done = true;
                try {
                    resolve(parse(raw));
                }
                catch (e) {
                    reject(new Error(`HME shim ${path} parse error: ${e?.message ?? e}`));
                }
            });
        });
        req.on("error", (e) => { clearTimeout(timer); fail(`HME shim ${path} unreachable: ${e?.message ?? e}`); });
        req.write(body);
        req.end();
    });
}
/** Shim POST with one transparent retry on transient failure (ECONNREFUSED,
 * ETIMEDOUT, parse error). The shim restarts during updates; a single-
 * shot call would surface the restart as a user-facing failure even when
 * a 1s wait would have succeeded. Parse errors do not retry — they
 * indicate a contract mismatch, not transport flakiness. */
function shimPost(path, body, parse, timeoutMs = 5000) {
    return _shimPostOnce(path, body, parse, timeoutMs).catch((err) => {
        const msg = String(err?.message ?? err);
        const transient = /unreachable|timeout|ECONNREFUSED|ETIMEDOUT|ECONNRESET|EPIPE/i.test(msg);
        if (!transient)
            throw err;
        console.error(`[HME] shim ${path} retrying after transient: ${msg.slice(0, 120)}`);
        return new Promise((resolve, reject) => {
            setTimeout(() => {
                _shimPostOnce(path, body, parse, timeoutMs).then(resolve, reject);
            }, 1000);
        });
    });
}
async function enrichPrompt(prompt, frame = "") {
    return shimPost("/enrich_prompt", JSON.stringify({ prompt, frame }), (raw) => JSON.parse(raw), 200000);
}
async function validateMessage(message) {
    return shimPost("/validate", JSON.stringify({ query: message }), JSON.parse);
}
async function auditChanges(changedFiles = "") {
    return shimPost("/audit", JSON.stringify({ changed_files: changedFiles }), JSON.parse, 15000);
}
async function postTranscript(entries) {
    return shimPost("/transcript", JSON.stringify({ entries }), () => undefined);
}
async function reindexFiles(files) {
    return shimPost("/reindex", JSON.stringify({ files }), JSON.parse, 30000);
}
async function postNarrative(narrative) {
    return shimPost("/narrative", JSON.stringify({ narrative }), () => undefined);
}
async function isHmeShimReady() {
    return shimGet("/health", (raw) => {
        const parsed = JSON.parse(raw);
        return { ready: parsed.status === "ready", errors: parsed.recent_errors ?? [] };
    }, { ready: false, errors: [{ message: "unreachable or timeout" }] });
}
async function logShimError(source, message, detail = "") {
    return shimPost("/error", JSON.stringify({ source, message, detail }), () => undefined);
    // Do NOT swallow rejection here — BrowserPanel's .catch() on this call is the disk fallback.
    // Swallowing here makes logShimError always resolve, killing the fallback silently.
}
//  Hybrid route
async function streamHybrid(message, history, opts, workingDir, onChunk, onDone, onError) {
    let hmeWarm = "";
    try {
        const enriched = await fetchHmeContext(message);
        hmeWarm = enriched.warm;
    }
    catch (e) {
        // KB enrichment failure is non-fatal — continue with empty context
        onChunk(`[HME] KB context unavailable: ${e?.message ?? e}`, "tool");
    }
    const messages = [];
    const systemContent = [
        streamUtils_1.AGENTIC_SYSTEM_PROMPT,
        hmeWarm ? `\nProject knowledge base context:\n${hmeWarm}` : "",
    ].join("").trim();
    messages.push({ role: "system", content: systemContent });
    messages.push(...history, { role: "user", content: message });
    return (0, routerLlamacpp_1.streamLlamacppAgentic)(messages, opts, workingDir, onChunk, onDone, onError);
}
