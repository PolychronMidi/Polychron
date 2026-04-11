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
exports.GPU_NUM_CTX = void 0;
exports.streamOllama = streamOllama;
exports.streamOllamaAgentic = streamOllamaAgentic;
const child_process_1 = require("child_process");
const http = __importStar(require("http"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
exports.GPU_NUM_CTX = 49152;
function ollamaErrMsg(e, url) {
    return e?.code === "ECONNREFUSED"
        ? `CRITICAL: Ollama not running — connection refused — Ollama is NOT responding at ${url}`
        : (e?.message ?? String(e));
}
// ── Ollama streaming ──────────────────────────────────────────────────────
function stripThinkTags(text) {
    if (!text)
        return text;
    const closeIdx = text.lastIndexOf("</think>");
    if (closeIdx !== -1)
        return text.slice(closeIdx + 8).trim();
    const openIdx = text.indexOf("<think>");
    if (openIdx !== -1)
        return text.slice(0, openIdx).trim();
    return text;
}
function streamOllama(messages, opts, onChunk, onDone, onError) {
    const body = JSON.stringify({
        model: opts.model,
        messages,
        stream: true,
        think: true,
        options: { temperature: 0.7, num_predict: 4096, num_gpu: 99, num_ctx: exports.GPU_NUM_CTX },
    });
    const url = new URL(`${opts.url}/api/chat`);
    let aborted = false;
    let accText = "";
    let accThink = "";
    let inThink = false;
    const req = http.request({
        hostname: url.hostname,
        port: url.port || 80,
        path: url.pathname,
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body),
        },
    }, (res) => {
        let buf = "";
        res.on("data", (chunk) => {
            if (aborted)
                return;
            buf += chunk.toString("utf8");
            const lines = buf.split("\n");
            buf = lines.pop() ?? "";
            for (const line of lines) {
                if (!line.trim())
                    continue;
                try {
                    const obj = JSON.parse(line);
                    if (obj.done) {
                        if (accThink)
                            onChunk(accThink.trim(), "thinking");
                        if (accText)
                            onChunk(stripThinkTags(accText.trim()), "text");
                        onDone();
                        return;
                    }
                    const content = obj?.message?.content ?? "";
                    if (!content)
                        continue;
                    if (content.includes("<think>")) {
                        inThink = true;
                        accThink += content.replace("<think>", "");
                        continue;
                    }
                    if (content.includes("</think>")) {
                        inThink = false;
                        accThink += content.replace("</think>", "");
                        onChunk(accThink.trim(), "thinking");
                        accThink = "";
                        continue;
                    }
                    if (inThink) {
                        accThink += content;
                        continue;
                    }
                    accText += content;
                }
                catch { }
            }
        });
        res.on("end", () => {
            if (!aborted) {
                if (accThink)
                    onChunk(accThink.trim(), "thinking");
                if (accText)
                    onChunk(stripThinkTags(accText.trim()), "text");
                onDone();
            }
        });
        res.on("error", (e) => { if (!aborted)
            onError(e.message); });
    });
    req.on("error", (e) => {
        if (!aborted)
            onError(ollamaErrMsg(e, opts.url));
    });
    req.write(body);
    req.end();
    return () => { aborted = true; req.destroy(); };
}
// ── Ollama agentic tool loop ──────────────────────────────────────────────
const OLLAMA_TOOLS = [
    {
        type: "function",
        function: {
            name: "bash",
            description: "Execute a bash command in the project working directory. Use for creating/deleting files, running scripts, installing packages, etc.",
            parameters: {
                type: "object",
                properties: { command: { type: "string", description: "The bash command to execute" } },
                required: ["command"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "read_file",
            description: "Read the full contents of a file by path.",
            parameters: {
                type: "object",
                properties: { path: { type: "string", description: "File path relative to project root" } },
                required: ["path"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "write_file",
            description: "Write or overwrite a file with the given content.",
            parameters: {
                type: "object",
                properties: {
                    path: { type: "string", description: "File path relative to project root" },
                    content: { type: "string", description: "File content to write" },
                },
                required: ["path", "content"],
            },
        },
    },
];
const OLLAMA_HARD_TIMEOUT_MS = 120000;
function isOllamaAlive(url) {
    return new Promise((resolve) => {
        const u = new URL(url);
        const req = http.get({ hostname: u.hostname, port: u.port || 80, path: "/api/tags", timeout: 3000 }, (res) => {
            res.resume();
            resolve(res.statusCode === 200);
        });
        req.on("error", () => resolve(false));
        req.on("timeout", () => { req.destroy(); resolve(false); });
    });
}
function ollamaChatOnce(messages, tools, opts) {
    let req = null;
    let hardTimer = null;
    const promise = new Promise((resolve, reject) => {
        hardTimer = setTimeout(() => { req?.destroy(); reject(new Error(`Ollama timeout: no response after ${OLLAMA_HARD_TIMEOUT_MS / 1000}s`)); }, OLLAMA_HARD_TIMEOUT_MS);
        if (hardTimer.unref)
            hardTimer.unref();
        const body = JSON.stringify({
            model: opts.model,
            messages,
            tools,
            stream: false,
            think: false,
            options: { temperature: 0.7, num_predict: 4096, num_ctx: exports.GPU_NUM_CTX },
        });
        const url = new URL(`${opts.url}/api/chat`);
        req = http.request({
            hostname: url.hostname,
            port: url.port || 80,
            path: url.pathname,
            method: "POST",
            headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
        }, (res) => {
            let raw = "";
            res.on("data", (c) => { raw += c.toString("utf8"); });
            res.on("end", () => {
                if (hardTimer)
                    clearTimeout(hardTimer);
                if (res.statusCode && res.statusCode >= 400) {
                    try {
                        reject(new Error(JSON.parse(raw).error ?? `Ollama HTTP ${res.statusCode}`));
                    }
                    catch {
                        reject(new Error(`Ollama HTTP ${res.statusCode}: ${raw.slice(0, 200)}`));
                    }
                    return;
                }
                try {
                    const parsed = JSON.parse(raw);
                    if (parsed?.message?.content) {
                        parsed.message.content = stripThinkTags(parsed.message.content);
                    }
                    resolve(parsed);
                }
                catch (e) {
                    reject(new Error(`Ollama parse error: ${raw.slice(0, 200)}`));
                }
            });
            res.on("error", (e) => { if (hardTimer)
                clearTimeout(hardTimer); reject(e); });
        });
        req.on("error", (e) => {
            if (hardTimer)
                clearTimeout(hardTimer);
            reject(new Error(ollamaErrMsg(e, opts.url)));
        });
        req.write(body);
        req.end();
    });
    const cancel = () => { req?.destroy(); if (hardTimer)
        clearTimeout(hardTimer); };
    return { promise, cancel };
}
function parseXmlFunctionCalls(content) {
    const calls = [];
    const fnRe = /<function=(\w+)>([\s\S]*?)<\/function>/g;
    const paramRe = /<parameter=(\w+)>([\s\S]*?)<\/parameter>/g;
    let fm;
    while ((fm = fnRe.exec(content)) !== null) {
        const name = fm[1];
        const body = fm[2];
        const args = {};
        let pm;
        const localRe = new RegExp(paramRe.source, "g");
        while ((pm = localRe.exec(body)) !== null) {
            args[pm[1]] = pm[2].trim();
        }
        calls.push({ function: { name, arguments: args } });
    }
    return calls;
}
function streamOllamaAgentic(messages, opts, workingDir, onChunk, onDone, onError) {
    let aborted = false;
    let currentRequest = null;
    const abort = () => {
        aborted = true;
        currentRequest?.cancel();
    };
    const runLoop = async () => {
        const current = [...messages];
        let iterations = 0;
        const MAX = 15;
        while (iterations++ < MAX && !aborted) {
            onChunk(`⏳ Ollama thinking…`, "tool");
            let response;
            try {
                currentRequest = ollamaChatOnce(current, OLLAMA_TOOLS, opts);
                response = await currentRequest.promise;
                currentRequest = null;
            }
            catch (e) {
                currentRequest = null;
                if (aborted)
                    return;
                const alive = await isOllamaAlive(opts.url);
                if (alive) {
                    onChunk(`⚠ Timeout but Ollama is alive — model may be slow. Retrying once…`, "error");
                    try {
                        currentRequest = ollamaChatOnce(current, OLLAMA_TOOLS, opts);
                        response = await currentRequest.promise;
                        currentRequest = null;
                    }
                    catch (retryErr) {
                        currentRequest = null;
                        if (!aborted)
                            onError(`CRITICAL AFTER RETRY: ${retryErr.message ?? String(retryErr)}`);
                        return;
                    }
                }
                else {
                    const errMsg = ollamaErrMsg(e, opts.url);
                    onError(errMsg.startsWith("CRITICAL") ? errMsg : `CRITICAL: ${errMsg}`);
                    return;
                }
            }
            if (aborted)
                return;
            const msg = response?.message ?? {};
            let toolCalls = msg.tool_calls ?? [];
            if (toolCalls.length === 0 && (msg.content ?? "").includes("<function=")) {
                toolCalls = parseXmlFunctionCalls(msg.content ?? "");
            }
            if (toolCalls.length === 0) {
                const text = stripThinkTags(msg.content ?? "");
                if (text)
                    onChunk(text, "text");
                onDone();
                return;
            }
            current.push({ role: "assistant", content: msg.content ?? "", tool_calls: toolCalls });
            for (const tc of toolCalls) {
                if (aborted)
                    return;
                const fnName = tc.function?.name ?? "";
                let args = {};
                try {
                    args = typeof tc.function?.arguments === "string"
                        ? JSON.parse(tc.function.arguments)
                        : (tc.function?.arguments ?? {});
                }
                catch {
                    args = {};
                }
                onChunk(`[${fnName}] ${JSON.stringify(args).slice(0, 120)}`, "tool");
                let result = "";
                try {
                    if (fnName === "bash") {
                        result = (0, child_process_1.execSync)(String(args.command ?? ""), {
                            cwd: workingDir,
                            timeout: 30000,
                            encoding: "utf8",
                        });
                        result = result.trim() || "(no output)";
                    }
                    else if (fnName === "read_file") {
                        const abs = path.resolve(workingDir, String(args.path ?? ""));
                        result = fs.readFileSync(abs, "utf8");
                    }
                    else if (fnName === "write_file") {
                        const abs = path.resolve(workingDir, String(args.path ?? ""));
                        fs.mkdirSync(path.dirname(abs), { recursive: true });
                        fs.writeFileSync(abs, String(args.content ?? ""), "utf8");
                        result = `Written: ${args.path}`;
                    }
                    else {
                        result = `Unknown tool: ${fnName}`;
                    }
                }
                catch (e) {
                    result = `Error: ${e.message ?? String(e)}`;
                }
                current.push({ role: "tool", content: result });
                onChunk(`  → ${result.slice(0, 200)}`, "tool");
            }
        }
        if (!aborted)
            onError("Agentic loop exceeded max iterations");
    };
    runLoop().catch((e) => { if (!aborted)
        onError(e?.message ?? String(e)); });
    return abort;
}
