"use strict";
// llama.cpp chat router — OpenAI /v1/chat/completions client for the chat UI.
//
// Replaces the former ollama /api/chat client. Exports streamLlamacpp,
// streamLlamacppAgentic, and GPU_NUM_CTX for routerHme, chatStreaming, BrowserPanel.
//
// Wire protocol:
//   Streaming  → POST /v1/chat/completions with stream: true → SSE frames
//                (data: {...}\n\n, terminator data: [DONE])
//   Agentic    → POST /v1/chat/completions with stream: false → JSON
//                {choices: [{message: {content, tool_calls}}]}
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
exports.streamLlamacpp = streamLlamacpp;
exports.streamLlamacppAgentic = streamLlamacppAgentic;
const child_process_1 = require("child_process");
const http = __importStar(require("http"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
exports.GPU_NUM_CTX = 49152;
function llamacppErrMsg(e, url) {
    return e?.code === "ECONNREFUSED"
        ? `CRITICAL: llama-server not running — connection refused — NOT responding at ${url}`
        : (e?.message ?? String(e));
}
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
//  Streaming: SSE parsing
//
// llama-server streams OpenAI-compatible SSE:
//   data: {"choices":[{"delta":{"content":"…"}}],…}
//   data: {"choices":[{"delta":{"content":"…"},"finish_reason":null}],…}
//   …
//   data: [DONE]
//
// We split on "\n\n", strip the "data: " prefix, parse each JSON frame, and
// pull content deltas out of choices[0].delta.content.
function streamLlamacpp(messages, opts, onChunk, onDone, onError) {
    const body = JSON.stringify({
        model: opts.model,
        messages,
        stream: true,
        temperature: 0.7,
        max_tokens: 4096,
        cache_prompt: true,
    });
    const url = new URL(`${opts.url}/v1/chat/completions`);
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
            "Accept": "text/event-stream",
            "Content-Length": Buffer.byteLength(body),
        },
    }, (res) => {
        let buf = "";
        res.on("data", (chunk) => {
            if (aborted)
                return;
            buf += chunk.toString("utf8");
            // SSE frames are separated by a blank line
            const frames = buf.split("\n\n");
            buf = frames.pop() ?? "";
            for (const frame of frames) {
                if (!frame.trim())
                    continue;
                // Each frame may have multiple "data: " lines — usually just one
                for (const rawLine of frame.split("\n")) {
                    const line = rawLine.trim();
                    if (!line || !line.startsWith("data:"))
                        continue;
                    const payload = line.slice(5).trim();
                    if (payload === "[DONE]") {
                        if (accThink)
                            onChunk(accThink.trim(), "thinking");
                        if (accText)
                            onChunk(stripThinkTags(accText.trim()), "text");
                        onDone();
                        return;
                    }
                    try {
                        const obj = JSON.parse(payload);
                        // OpenAI-compat SSE contract: every non-[DONE] frame must have
                        // `choices` (an array). Some providers emit a leading empty-
                        // choices frame for role assignment — tolerate that. But a
                        // frame missing `choices` entirely is a contract violation
                        // worth surfacing — don't silently drop tokens.
                        if (!Array.isArray(obj?.choices)) {
                            onChunk(`[contract-drift] frame has no .choices array: ${payload.slice(0, 120)}`, "error");
                            continue;
                        }
                        if (obj.choices.length === 0)
                            continue;
                        const delta = obj.choices[0]?.delta;
                        if (!delta || typeof delta !== "object") {
                            onChunk(`[contract-drift] frame .choices[0].delta missing: ${payload.slice(0, 120)}`, "error");
                            continue;
                        }
                        // `content` can legitimately be absent when the frame carries
                        // only a role assignment or finish_reason. Tolerate those by
                        // continuing; only fail on malformed non-string content.
                        if (delta.content === undefined || delta.content === null)
                            continue;
                        if (typeof delta.content !== "string") {
                            onChunk(`[contract-drift] delta.content not a string: ${JSON.stringify(delta).slice(0, 120)}`, "error");
                            continue;
                        }
                        const content = delta.content;
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
                    catch (parseErr) {
                        // Don't silently drop malformed frames — that hid a partial-JSON
                        // bug for weeks before the chat went unresponsive on restart-mid-
                        // stream. Surface the parse failure to the UI as a 'parse-error'
                        // chunk so the operator sees the broken frame instead of just
                        // noticing missing tokens.
                        const _msg = parseErr?.message ?? String(parseErr);
                        onChunk(`[parse-error] ${_msg}: ${payload.slice(0, 120)}`, "error");
                    }
                }
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
            onError(llamacppErrMsg(e, opts.url));
    });
    req.write(body);
    req.end();
    return () => { aborted = true; req.destroy(); };
}
//  Agentic tool loop
const LLAMACPP_TOOLS = [
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
const LLAMACPP_HARD_TIMEOUT_MS = 120000;
function isLlamacppAlive(url) {
    return new Promise((resolve) => {
        const u = new URL(url);
        const req = http.get({ hostname: u.hostname, port: u.port || 80, path: "/health", timeout: 3000 }, (res) => {
            res.resume();
            resolve(res.statusCode === 200);
        });
        req.on("error", () => resolve(false));
        req.on("timeout", () => { req.destroy(); resolve(false); });
    });
}
function llamacppChatOnce(messages, tools, opts) {
    let req = null;
    let hardTimer = null;
    const promise = new Promise((resolve, reject) => {
        hardTimer = setTimeout(() => {
            req?.destroy();
            reject(new Error(`llama-server timeout: no response after ${LLAMACPP_HARD_TIMEOUT_MS / 1000}s`));
        }, LLAMACPP_HARD_TIMEOUT_MS);
        if (hardTimer.unref)
            hardTimer.unref();
        const body = JSON.stringify({
            model: opts.model,
            messages,
            tools,
            stream: false,
            temperature: 0.7,
            max_tokens: 4096,
            cache_prompt: true,
        });
        const url = new URL(`${opts.url}/v1/chat/completions`);
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
                        reject(new Error(JSON.parse(raw)?.error?.message ?? JSON.parse(raw).error ?? `llama-server HTTP ${res.statusCode}`));
                    }
                    catch {
                        reject(new Error(`llama-server HTTP ${res.statusCode}: ${raw.slice(0, 200)}`));
                    }
                    return;
                }
                let parsed;
                try {
                    parsed = JSON.parse(raw);
                }
                catch (e) {
                    reject(new Error(`llama-server parse error: ${raw.slice(0, 200)}`));
                    return;
                }
                // OpenAI envelope contract: choices[0].message must exist. An
                // empty `{}` fallback would propagate to the agentic loop which
                // would then see no tool_calls + empty content and think the
                // model finished — a false termination on contract drift.
                const choice = parsed?.choices?.[0];
                if (!choice || typeof choice !== "object") {
                    reject(new Error(`llama-server envelope missing choices[0]: ${raw.slice(0, 200)}`));
                    return;
                }
                const msg = choice.message;
                if (!msg || typeof msg !== "object") {
                    reject(new Error(`llama-server envelope missing choices[0].message: ${raw.slice(0, 200)}`));
                    return;
                }
                if (typeof msg.content === "string") {
                    msg.content = stripThinkTags(msg.content);
                }
                resolve({ message: msg, _raw: parsed });
            });
            res.on("error", (e) => { if (hardTimer)
                clearTimeout(hardTimer); reject(e); });
        });
        req.on("error", (e) => {
            if (hardTimer)
                clearTimeout(hardTimer);
            reject(new Error(llamacppErrMsg(e, opts.url)));
        });
        req.write(body);
        req.end();
    });
    const cancel = () => { req?.destroy(); if (hardTimer)
        clearTimeout(hardTimer); };
    return { promise, cancel };
}
/**
 * Resolve an agent-supplied path safely under workingDir. Returns null
 * if the resolved path escapes workingDir (e.g. via '..' or absolute
 * path). Without this guard, an agent could read /etc/passwd or
 * write to ~/.ssh/authorized_keys.
 */
function _resolveWithinWorkdir(workingDir, requested) {
    if (!requested)
        return null;
    const root = path.resolve(workingDir);
    const candidate = path.resolve(root, requested);
    // Exact match is OK; otherwise must be a child path.
    if (candidate === root)
        return candidate;
    if (!candidate.startsWith(root + path.sep))
        return null;
    return candidate;
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
function streamLlamacppAgentic(messages, opts, workingDir, onChunk, onDone, onError) {
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
            onChunk(`⏳ llama-server thinking…`, "tool");
            let response;
            try {
                currentRequest = llamacppChatOnce(current, LLAMACPP_TOOLS, opts);
                response = await currentRequest.promise;
                currentRequest = null;
            }
            catch (e) {
                currentRequest = null;
                if (aborted)
                    return;
                const alive = await isLlamacppAlive(opts.url);
                if (alive) {
                    onChunk(`⚠ Timeout but llama-server is alive — model may be slow. Retrying once…`, "error");
                    try {
                        currentRequest = llamacppChatOnce(current, LLAMACPP_TOOLS, opts);
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
                    const errMsg = llamacppErrMsg(e, opts.url);
                    onError(errMsg.startsWith("CRITICAL") ? errMsg : `CRITICAL: ${errMsg}`);
                    return;
                }
            }
            if (aborted)
                return;
            // llamacppChatOnce now throws on missing message, so this is a real
            // message object — but the content/tool_calls fields may still be
            // absent depending on the model's response.
            const msg = response.message;
            let toolCalls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
            const rawContent = typeof msg.content === "string" ? msg.content : "";
            if (toolCalls.length === 0 && rawContent.includes("<function=")) {
                toolCalls = parseXmlFunctionCalls(rawContent);
            }
            if (toolCalls.length === 0) {
                const text = stripThinkTags(rawContent);
                if (text) {
                    onChunk(text, "text");
                    onDone();
                    return;
                }
                // No tool calls AND no text — the model said nothing at all. Silent
                // onDone here produces a blank assistant bubble, leaving the user
                // to wonder what broke. Fail loud so the UI surfaces the empty
                // response as an error instead.
                onError(`llama-server returned empty response (no tool_calls, no content) on iteration ${iterations}`);
                return;
            }
            current.push({ role: "assistant", content: rawContent, tool_calls: toolCalls });
            for (const tc of toolCalls) {
                if (aborted)
                    return;
                const fnName = typeof tc.function?.name === "string" ? tc.function.name : "";
                if (!fnName) {
                    // An unnamed tool call loops forever: the model emits a malformed
                    // call, we execute "Unknown tool: ", append result, model emits
                    // another malformed call, etc. Terminate the loop loudly instead.
                    onError(`llama-server emitted tool_call with no function name: ${JSON.stringify(tc).slice(0, 200)}`);
                    return;
                }
                let args = {};
                try {
                    args = typeof tc.function?.arguments === "string"
                        ? JSON.parse(tc.function.arguments)
                        : (tc.function?.arguments ?? {});
                }
                catch (e) {
                    onChunk(`⚠ [${fnName}] failed to parse tool args: ${e?.message ?? e}`, "error");
                    args = {};
                }
                onChunk(`[${fnName}] ${JSON.stringify(args).slice(0, 120)}`, "tool");
                let result = "";
                try {
                    if (fnName === "bash") {
                        // Cap output size — a runaway command (large `find /`, streaming log
                        // tail, etc.) otherwise balloons RSS and can take the server down
                        // or trivially blow through the model's context budget on the next
                        // tool turn. 256 KiB is generous for legitimate output and tight
                        // enough to cut pathological cases. `maxBuffer` raises ERR_CHILD_
                        // PROCESS_STDIO_MAXBUFFER which we catch and surface as a clear
                        // message, preserving any output captured before the limit.
                        const BASH_MAX_BYTES = 256 * 1024;
                        try {
                            result = (0, child_process_1.execSync)(String(args.command ?? ""), {
                                cwd: workingDir,
                                timeout: 30000,
                                encoding: "utf8",
                                maxBuffer: BASH_MAX_BYTES,
                            });
                        }
                        catch (execErr) {
                            const partial = typeof execErr?.stdout === "string" ? execErr.stdout : "";
                            if (execErr?.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
                                result = `${partial}\n[bash: output truncated — exceeded ${BASH_MAX_BYTES} bytes; narrow the command]`;
                            }
                            else {
                                throw execErr;
                            }
                        }
                        result = result.trim() || "(no output)";
                    }
                    else if (fnName === "read_file") {
                        const abs = _resolveWithinWorkdir(workingDir, String(args.path ?? ""));
                        if (!abs) {
                            result = `Refused: path '${args.path}' resolves outside workingDir ${workingDir}`;
                        }
                        else {
                            result = fs.readFileSync(abs, "utf8");
                        }
                    }
                    else if (fnName === "write_file") {
                        const abs = _resolveWithinWorkdir(workingDir, String(args.path ?? ""));
                        if (!abs) {
                            result = `Refused: path '${args.path}' resolves outside workingDir ${workingDir}`;
                        }
                        else {
                            fs.mkdirSync(path.dirname(abs), { recursive: true });
                            fs.writeFileSync(abs, String(args.content ?? ""), "utf8");
                            result = `Written: ${args.path}`;
                        }
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
