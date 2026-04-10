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
exports.validateMessage = validateMessage;
exports.auditChanges = auditChanges;
exports.postTranscript = postTranscript;
exports.reindexFiles = reindexFiles;
exports.postNarrative = postNarrative;
exports.isHmeShimReady = isHmeShimReady;
exports.logShimError = logShimError;
exports.streamHybrid = streamHybrid;
const http = __importStar(require("http"));
const routerOllama_1 = require("./routerOllama");
const HME_HTTP_PORT = 7734;
const HME_HTTP_URL = `http://127.0.0.1:${HME_HTTP_PORT}`;
async function fetchHmeContext(query, topK = 5) {
    return new Promise((resolve, reject) => {
        let done = false;
        const fail = (msg) => { if (!done) {
            done = true;
            reject(new Error(msg));
        } };
        const timer = setTimeout(() => { req.destroy(); fail("HME shim /enrich timeout (5s)"); }, 5000);
        const body = JSON.stringify({ query, top_k: topK });
        const req = http.request({
            hostname: "127.0.0.1",
            port: HME_HTTP_PORT,
            path: "/enrich",
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(body),
            },
        }, (res) => {
            let raw = "";
            res.on("data", (c) => { raw += c.toString("utf8"); });
            res.on("end", () => {
                clearTimeout(timer);
                if (done)
                    return;
                done = true;
                try {
                    const parsed = JSON.parse(raw);
                    const kb = parsed.kb ?? [];
                    resolve({ warm: parsed.warm ?? "", kb, kbCount: kb.length });
                }
                catch (e) {
                    reject(new Error(`HME shim /enrich parse error: ${e?.message ?? e}`));
                }
            });
        });
        req.on("error", (e) => { clearTimeout(timer); fail(`HME shim /enrich unreachable: ${e?.message ?? e}`); });
        req.write(body);
        req.end();
    });
}
// ── Shim HTTP helper — 5s timeout on all fire-and-forget calls ───────────────
function shimPost(path, body, parse) {
    return new Promise((resolve, reject) => {
        let done = false;
        const fail = (msg) => { if (!done) {
            done = true;
            req.destroy();
            reject(new Error(msg));
        } };
        const timer = setTimeout(() => fail(`HME shim ${path} timeout (5s)`), 5000);
        const req = http.request({
            hostname: "127.0.0.1", port: HME_HTTP_PORT, path, method: "POST",
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
async function validateMessage(message) {
    return shimPost("/validate", JSON.stringify({ query: message }), JSON.parse);
}
async function auditChanges(changedFiles = "") {
    return shimPost("/audit", JSON.stringify({ changed_files: changedFiles }), JSON.parse);
}
async function postTranscript(entries) {
    return shimPost("/transcript", JSON.stringify({ entries }), () => undefined);
}
async function reindexFiles(files) {
    return shimPost("/reindex", JSON.stringify({ files }), JSON.parse);
}
async function postNarrative(narrative) {
    return shimPost("/narrative", JSON.stringify({ narrative }), () => undefined);
}
async function isHmeShimReady() {
    return new Promise((resolve) => {
        const req = http.get(`${HME_HTTP_URL}/health`, (res) => {
            let raw = "";
            res.on("data", (c) => { raw += c.toString("utf8"); });
            res.on("end", () => {
                try {
                    const parsed = JSON.parse(raw);
                    resolve({ ready: parsed.status === "ready", errors: parsed.recent_errors ?? [] });
                }
                catch (e) {
                    console.error(`[HME] shim /health parse error: ${e?.message ?? e}`);
                    resolve({ ready: false, errors: [{ message: `parse error: ${e?.message}` }] });
                }
            });
        });
        req.on("error", (e) => {
            console.error(`[HME] shim /health unreachable: ${e?.message ?? e}`);
            resolve({ ready: false, errors: [{ message: `unreachable: ${e?.message}` }] });
        });
        req.setTimeout(1000, () => { req.destroy(); resolve({ ready: false, errors: [{ message: "timeout" }] }); });
    });
}
async function logShimError(source, message, detail = "") {
    return shimPost("/error", JSON.stringify({ source, message, detail }), () => undefined);
    // Do NOT swallow rejection here — ChatPanel's .catch() on this call is the disk fallback.
    // Swallowing here makes logShimError always resolve, killing the fallback silently.
}
// ── Hybrid route ──────────────────────────────────────────────────────────
async function streamHybrid(message, history, opts, workingDir, onChunk, onDone, onError) {
    let hmeWarm = "";
    try {
        const enriched = await fetchHmeContext(message);
        hmeWarm = enriched.warm;
    }
    catch (e) {
        onChunk(`FAILFAST: HME context enrichment failed: ${e?.message ?? e}`, "error");
    }
    const messages = [];
    const systemContent = [
        "You are an agentic coding assistant with access to bash, read_file, and write_file tools. When asked to perform a task — create files, edit code, run commands, implement features — call the appropriate tool immediately. Never respond with suggestions, plans, or code blocks without calling a tool first.",
        hmeWarm ? `\nProject knowledge base context:\n${hmeWarm}` : "",
    ].join("").trim();
    messages.push({ role: "system", content: systemContent });
    messages.push(...history, { role: "user", content: message });
    return (0, routerOllama_1.streamOllamaAgentic)(messages, opts, workingDir, onChunk, onDone, onError);
}
