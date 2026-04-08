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
exports.streamClaude = streamClaude;
exports.streamClaudePty = streamClaudePty;
exports.streamOllama = streamOllama;
exports.streamOllamaAgentic = streamOllamaAgentic;
exports.fetchHmeContext = fetchHmeContext;
exports.validateMessage = validateMessage;
exports.auditChanges = auditChanges;
exports.postTranscript = postTranscript;
exports.reindexFiles = reindexFiles;
exports.postNarrative = postNarrative;
exports.isHmeShimReady = isHmeShimReady;
exports.logShimError = logShimError;
exports.streamHybrid = streamHybrid;
const child_process_1 = require("child_process");
const http = __importStar(require("http"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
// node-pty is loaded lazily inside streamClaudePty only — a native module crash
// must never take down the extension host at startup.
let _pty = null;
function getPty() {
    if (_pty)
        return _pty;
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        _pty = require("node-pty");
        return _pty;
    }
    catch {
        return null;
    }
}
// HME HTTP shim — runs alongside MCP server at port 7734
const HME_HTTP_PORT = 7734;
const HME_HTTP_URL = `http://127.0.0.1:${HME_HTTP_PORT}`;
// ── Claude CLI ─────────────────────────────────────────────────────────────
function streamClaude(message, sessionId, opts, workingDir, onChunk, onSessionId, onDone, onError) {
    const args = ["-p", "--output-format", "stream-json", "--verbose"];
    args.push("--model", opts.model);
    args.push("--effort", opts.effort);
    args.push("--permission-mode", opts.permissionMode || "acceptEdits");
    if (opts.thinking) {
        // Extended thinking is available on Opus; --verbose surfaces the thinking blocks
        // in stream-json output. Nothing extra needed — thinking blocks come through natively.
    }
    if (sessionId) {
        args.push("--resume", sessionId);
    }
    const env = { ...process.env };
    // Remove API key so CLI uses subscription auth
    delete env["ANTHROPIC_API_KEY"];
    // Ensure claude is findable — VS Code extension host may have a stripped PATH
    if (!env["PATH"]?.includes(".local/bin")) {
        env["PATH"] = `/home/${process.env["USER"] ?? "jah"}/.local/bin:${env["PATH"] ?? "/usr/local/bin:/usr/bin:/bin"}`;
    }
    const proc = (0, child_process_1.spawn)("claude", args, {
        cwd: workingDir,
        env,
        stdio: ["pipe", "pipe", "pipe"],
    });
    proc.stdin.write(message);
    proc.stdin.end();
    let buf = "";
    let doneFired = false;
    const safeOnDone = (cost) => {
        if (!doneFired) {
            doneFired = true;
            onDone(cost);
        }
    };
    // Inactivity timer: if CLI produces no stdout for 30s it's stuck (API 500/timeout/stall).
    // Mirrors Arbiter's 15s guard — fail fast rather than hanging indefinitely.
    const INACTIVITY_MS = 30000;
    let inactivityTimer = setTimeout(() => {
        if (!doneFired) {
            doneFired = true;
            try {
                proc.kill();
            }
            catch { }
            onError(`CRITICAL: Claude CLI produced no output for ${INACTIVITY_MS / 1000}s — API may be down or rate-limited`);
        }
    }, INACTIVITY_MS);
    const resetInactivity = () => {
        if (inactivityTimer) {
            clearTimeout(inactivityTimer);
            inactivityTimer = null;
        }
    };
    proc.stdout.on("data", (data) => {
        resetInactivity();
        buf += data.toString("utf8");
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
            if (!line.trim())
                continue;
            try {
                const evt = JSON.parse(line);
                handleStreamEvent(evt, onChunk, onSessionId, safeOnDone);
            }
            catch {
                // Non-JSON lines from CLI are often error messages — surface them
                if (line.trim())
                    onChunk(line.trim(), "error");
            }
        }
    });
    proc.stderr.on("data", (data) => {
        resetInactivity();
        const text = data.toString("utf8").trim();
        if (text)
            onError(text);
    });
    proc.on("close", (code) => {
        resetInactivity();
        // Flush any remaining buffered output
        if (buf.trim()) {
            try {
                const evt = JSON.parse(buf.trim());
                handleStreamEvent(evt, onChunk, onSessionId, safeOnDone);
            }
            catch {
                // Final buffer wasn't JSON — surface it (often a critical error message)
                onChunk(buf.trim(), "error");
            }
        }
        if (code !== 0)
            onError(`Claude CLI exited with code ${code}`);
        else
            safeOnDone(); // ensure done fires even if result event was missing
    });
    return () => { try {
        proc.kill();
    }
    catch { } };
}
function handleStreamEvent(evt, onChunk, onSessionId, onDone) {
    if (evt.type === "system" && evt.subtype === "init" && evt.session_id) {
        onSessionId(evt.session_id);
        return;
    }
    if (evt.type === "assistant" && evt.message?.content) {
        for (const block of evt.message.content) {
            if (block.type === "thinking" && block.thinking) {
                onChunk(block.thinking, "thinking");
            }
            else if (block.type === "text" && block.text) {
                onChunk(block.text, "text");
            }
            else if (block.type === "tool_use") {
                onChunk(`[${block.name}] ${JSON.stringify(block.input ?? {}).slice(0, 120)}`, "tool");
            }
        }
        return;
    }
    if (evt.type === "result") {
        onDone(evt.cost_usd ?? undefined);
        return;
    }
}
// ── Claude PTY (hook-aware interactive mode) ───────────────────────────────
// Strips ANSI escape sequences from terminal output
function stripAnsi(str) {
    // eslint-disable-next-line no-control-regex
    return str.replace(/\x1b\[[0-9;]*[mGKHFABCDJsuhl]/g, "")
        .replace(/\x1b\][^\x07]*\x07/g, "")
        .replace(/\r/g, "");
}
// Claude CLI interactive prompt indicators — turn is done when we see these
// after receiving substantial output. The CLI shows "> " for input and
// "╭─" / "│" box-drawing chars for its response blocks.
const PTY_DONE_PATTERNS = [
    /^>\s*$/m, // bare prompt line
    /\nHuman:\s*$/, // conversation turn marker
    /\[H\]/, // alternate prompt marker
];
/**
 * Spawn Claude CLI via PTY (pseudo-terminal) so .claude/settings.json hooks fire.
 * Sends `message`, streams output back, detects turn completion via prompt re-appearance.
 *
 * Hooks (PreToolUse, PostToolUse, Stop) fire because this is a real interactive session.
 * Uses --resume for session continuity. bypassPermissions so no permission prompts block.
 */
function streamClaudePty(message, sessionId, opts, workingDir, onChunk, onSessionId, onDone, onError) {
    const args = ["--model", opts.model, "--permission-mode", "bypassPermissions"];
    if (sessionId)
        args.push("--resume", sessionId);
    const env = {};
    for (const [k, v] of Object.entries(process.env)) {
        if (k !== "ANTHROPIC_API_KEY" && v !== undefined)
            env[k] = v;
    }
    env["TERM"] = "xterm-256color";
    if (!env["PATH"]?.includes(".local/bin")) {
        env["PATH"] = `/home/${process.env["USER"] ?? "jah"}/.local/bin:${env["PATH"] ?? "/usr/local/bin:/usr/bin:/bin"}`;
    }
    const ptyLib = getPty();
    if (!ptyLib) {
        onError("node-pty unavailable");
        return () => { };
    }
    let proc;
    try {
        proc = ptyLib.spawn("claude", args, {
            name: "xterm-256color",
            cols: 220,
            rows: 50,
            cwd: workingDir,
            env: env,
        });
    }
    catch (e) {
        onError(`PTY spawn failed: ${e?.message ?? e}`);
        return () => { };
    }
    let fullOutput = "";
    let sentMessage = false;
    let turnDone = false;
    let sessionIdSent = false;
    // Wait for initial prompt before sending — CLI prints ">" or similar
    let initBuf = "";
    let doneTimer = null;
    // Inactivity timer: 15s after message send with no data = CLI stuck (API 500/stall/runner dead).
    // Mirrors Arbiter's 15s guard. Only active post-send — init phase has its own safe threshold.
    const PTY_INACTIVITY_MS = 15000;
    let ptyInactivityTimer = null;
    const resetPtyInactivity = () => {
        if (ptyInactivityTimer)
            clearTimeout(ptyInactivityTimer);
        ptyInactivityTimer = setTimeout(() => {
            if (!turnDone) {
                turnDone = true;
                if (doneTimer)
                    clearTimeout(doneTimer);
                try {
                    proc.kill();
                }
                catch { }
                onError(`CRITICAL: Claude PTY produced no output for ${PTY_INACTIVITY_MS / 1000}s after message send — API may be down or CLI crashed`);
            }
        }, PTY_INACTIVITY_MS);
    };
    const scheduleDone = () => {
        if (doneTimer)
            clearTimeout(doneTimer);
        if (ptyInactivityTimer) {
            clearTimeout(ptyInactivityTimer);
            ptyInactivityTimer = null;
        }
        doneTimer = setTimeout(() => {
            if (!turnDone) {
                turnDone = true;
                onDone();
                try {
                    proc.kill();
                }
                catch { }
            }
        }, 800);
    };
    proc.onData((raw) => {
        const text = stripAnsi(raw);
        if (!sentMessage) {
            // Wait for initial prompt from CLI before sending our message
            initBuf += text;
            const ready = initBuf.includes("> ") ||
                initBuf.includes("│") ||
                initBuf.includes("Human:") ||
                initBuf.length > 200;
            if (ready) {
                sentMessage = true;
                proc.write(message.replace(/\r?\n/g, " ") + "\r");
                resetPtyInactivity(); // start inactivity guard from moment of send
            }
            return;
        }
        resetPtyInactivity(); // any data post-send resets the inactivity clock
        // Strip echoed input line (first line after send)
        fullOutput += text;
        // Detect session ID from output — fire once only
        if (!sessionIdSent) {
            const sessionMatch = fullOutput.match(/Session(?:\s+ID)?:\s*([a-f0-9-]{8,})/i);
            if (sessionMatch) {
                sessionIdSent = true;
                onSessionId(sessionMatch[1]);
            }
        }
        // Classify and emit chunks
        // Thinking blocks: Claude wraps them in ⠋ spinner or "Thinking..." lines
        if (/^(?:⠋|⠙|⠹|⠸|⠼|⠴|⠦|⠧|⠇|⠏)\s/.test(text.trim())) {
            onChunk(text.trim().replace(/^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]\s*/, ""), "thinking");
        }
        else if (/^●\s/.test(text.trim()) || /^\[.*\]/.test(text.trim())) {
            // Tool use: "● ToolName(...)" or "[tool_name]"
            onChunk(text.trim(), "tool");
        }
        else if (text.trim() && !PTY_DONE_PATTERNS.some((p) => p.test(fullOutput.slice(-200)))) {
            onChunk(text, "text");
        }
        // Detect prompt re-appearance = turn complete
        if (PTY_DONE_PATTERNS.some((p) => p.test(fullOutput.slice(-400)))) {
            scheduleDone();
        }
    });
    // FAILFAST: if the CLI process exits without triggering a done-pattern,
    // fire onError so the stream never hangs. This catches: API 500, auth errors,
    // crashes, SIGKILL. The 1.5s delay lets any final onData flush arrive first.
    proc.onExit(({ exitCode }) => {
        if (ptyInactivityTimer) {
            clearTimeout(ptyInactivityTimer);
            ptyInactivityTimer = null;
        }
        if (turnDone)
            return; // already handled by done-pattern detection
        setTimeout(() => {
            if (turnDone)
                return;
            turnDone = true;
            if (doneTimer)
                clearTimeout(doneTimer);
            if (exitCode !== 0) {
                onError(`Claude CLI exited with code ${exitCode}`);
            }
            else {
                onDone(); // clean exit but no done-pattern matched (short response)
            }
        }, 1500);
    });
    const killed = { v: false };
    return () => {
        killed.v = true;
        turnDone = true;
        if (doneTimer)
            clearTimeout(doneTimer);
        if (ptyInactivityTimer) {
            clearTimeout(ptyInactivityTimer);
            ptyInactivityTimer = null;
        }
        try {
            proc.kill();
        }
        catch { }
    };
}
/**
 * Strip <think>...</think> tags from model output. Qwen3 models emit CoT
 * inside content even with think:false — defensive stripping at every exit.
 */
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
        think: false, // suppress CoT tokens bleeding into content stream
        options: { temperature: 0.7, num_predict: 4096 },
    });
    const url = new URL(`${opts.url}/api/chat`);
    let aborted = false;
    const req = http.request({
        hostname: url.hostname,
        port: url.port || 80,
        path: url.pathname,
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body),
        },
        // 30s socket inactivity: fires if Ollama sends no bytes.
        // stream:true means chunks arrive as soon as generation starts.
        // Silence = model not loaded (use hme_admin warm) or Ollama stuck.
        timeout: 30000,
    }, (res) => {
        if (res.statusCode && res.statusCode >= 400) {
            let errBody = "";
            res.on("data", (c) => { errBody += c.toString("utf8"); });
            res.on("end", () => {
                try {
                    onError(JSON.parse(errBody).error ?? `Ollama error ${res.statusCode}`);
                }
                catch {
                    onError(`Ollama error ${res.statusCode}`);
                }
            });
            return;
        }
        let buf = "";
        let doneFired = false;
        let inThink = false; // true while accumulating <think>...</think> block
        let thinkBuf = ""; // accumulated content — flushed after </think>
        const fireDone = () => { if (!doneFired) {
            doneFired = true;
            onDone();
        } };
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
                    const parsed = JSON.parse(line);
                    let text = parsed?.message?.content ?? "";
                    // Defensive think-tag gate: buffer content inside <think> blocks
                    if (text) {
                        if (inThink) {
                            thinkBuf += text;
                            const closeIdx = thinkBuf.indexOf("</think>");
                            if (closeIdx !== -1) {
                                inThink = false;
                                text = thinkBuf.slice(closeIdx + 8);
                                thinkBuf = "";
                                if (text)
                                    onChunk(text, "text");
                            }
                        }
                        else if (text.includes("<think>")) {
                            const openIdx = text.indexOf("<think>");
                            const before = text.slice(0, openIdx);
                            if (before)
                                onChunk(before, "text");
                            inThink = true;
                            thinkBuf = text.slice(openIdx + 7);
                            // Check if </think> is in the same chunk
                            const closeIdx = thinkBuf.indexOf("</think>");
                            if (closeIdx !== -1) {
                                inThink = false;
                                const after = thinkBuf.slice(closeIdx + 8);
                                thinkBuf = "";
                                if (after)
                                    onChunk(after, "text");
                            }
                        }
                        else {
                            onChunk(text, "text");
                        }
                    }
                    if (parsed?.done)
                        fireDone();
                }
                catch (e) {
                    onError(`Ollama stream parse error: ${e?.message ?? String(e)}`);
                }
            }
        });
        res.on("end", () => { if (!aborted)
            fireDone(); });
        res.on("error", (e) => { if (!aborted)
            onError(e.message); });
    });
    req.on("error", (e) => { if (!aborted)
        onError(e.message); });
    req.on("timeout", () => { aborted = true; req.destroy(); onError(`CRITICAL: Ollama stream stalled — no bytes for 30s. Model may not be loaded (run hme_admin warm) or Ollama queue is frozen.`); });
    req.write(body);
    req.end();
    return () => { aborted = true; req.destroy(); };
}
// ── Ollama agentic tool loop ───────────────────────────────────────────────
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
const OLLAMA_HARD_TIMEOUT_MS = 120000; // 2 min — loaded 30B model on GPU should respond within 2 min
/** Ping Ollama /api/tags — resolves true if alive, false otherwise. 3s timeout. */
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
            options: { temperature: 0.7, num_predict: 4096 },
        });
        const url = new URL(`${opts.url}/api/chat`);
        req = http.request({
            hostname: url.hostname,
            port: url.port || 80,
            path: url.pathname,
            method: "POST",
            headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
            // NO socket timeout: stream:false means Ollama sends ZERO bytes until the
            // full response is computed. A socket inactivity timeout is meaningless and
            // causes false-alarm kills on large prompts. The hard timer is the sole safeguard.
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
                    // Defensive: strip think tags from content before returning
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
            const msg = e.code === "ECONNREFUSED"
                ? `CRITICAL: Ollama not running — connection refused — Ollama is NOT responding at ${opts.url}`
                : e.message;
            reject(new Error(msg));
        });
        req.write(body);
        req.end();
    });
    const cancel = () => { req?.destroy(); if (hardTimer)
        clearTimeout(hardTimer); };
    return { promise, cancel };
}
/** Parse XML-style function calls emitted by some models when structured tool_calls is absent. */
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
/**
 * Agentic Ollama loop: sends tools to the model, executes tool_calls, feeds
 * results back, and repeats until the model produces a final text response.
 * Supports bash, read_file, write_file tool calls.
 */
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
                // FAILFAST with auto-retry: check if Ollama is alive before giving up
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
                    const errMsg = e.message ?? String(e);
                    onError(errMsg.startsWith("CRITICAL") ? errMsg : `CRITICAL: ${errMsg} — Ollama is NOT responding at ${opts.url}`);
                    return;
                }
            }
            if (aborted)
                return;
            const msg = response?.message ?? {};
            let toolCalls = msg.tool_calls ?? [];
            // Fallback: parse XML-style function calls from content when structured tool_calls absent.
            // Some models emit <function=name><parameter=key>val</parameter></function> in content.
            if (toolCalls.length === 0 && (msg.content ?? "").includes("<function=")) {
                toolCalls = parseXmlFunctionCalls(msg.content ?? "");
            }
            if (toolCalls.length === 0) {
                // Final text response — defensive strip (ollamaChatOnce already strips,
                // but this is the last gate before user-visible output)
                const text = stripThinkTags(msg.content ?? "");
                if (text)
                    onChunk(text, "text");
                onDone();
                return;
            }
            // Add the assistant turn (may have empty content)
            current.push({ role: "assistant", content: msg.content ?? "", tool_calls: toolCalls });
            // Execute each tool call and add results
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
/** Fetch KB context from the HME HTTP shim. Returns warm text + structured KB hits. */
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
/**
 * Pre-send: validate message against KB anti-patterns and architectural constraints.
 * Returns {warnings, blocks} — blocks are hard stops (bugfix/antipattern category),
 * warnings are softer architectural nudges.
 */
async function validateMessage(message) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify({ query: message });
        const req = http.request({
            hostname: "127.0.0.1",
            port: HME_HTTP_PORT,
            path: "/validate",
            method: "POST",
            headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
        }, (res) => {
            let raw = "";
            res.on("data", (c) => { raw += c.toString("utf8"); });
            res.on("end", () => {
                try {
                    resolve(JSON.parse(raw));
                }
                catch (e) {
                    reject(new Error(`HME /validate parse error: ${e?.message ?? e}`));
                }
            });
        });
        req.on("error", (e) => reject(new Error(`HME /validate unreachable: ${e?.message ?? e}`)));
        req.write(body);
        req.end();
    });
}
/**
 * Post-response: audit changed files against KB constraints.
 * Returns {violations, changed_files}.
 */
async function auditChanges(changedFiles = "") {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify({ changed_files: changedFiles });
        const req = http.request({
            hostname: "127.0.0.1",
            port: HME_HTTP_PORT,
            path: "/audit",
            method: "POST",
            headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
        }, (res) => {
            let raw = "";
            res.on("data", (c) => { raw += c.toString("utf8"); });
            res.on("end", () => {
                try {
                    resolve(JSON.parse(raw));
                }
                catch (e) {
                    reject(new Error(`HME /audit parse error: ${e?.message ?? e}`));
                }
            });
        });
        req.on("error", (e) => reject(new Error(`HME /audit unreachable: ${e?.message ?? e}`)));
        req.write(body);
        req.end();
    });
}
/**
 * Post transcript entries to the HME HTTP shim.
 * Mirrors the TranscriptLogger's JSONL entries to the server-side store.
 */
async function postTranscript(entries) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify({ entries });
        const req = http.request({
            hostname: "127.0.0.1", port: HME_HTTP_PORT, path: "/transcript", method: "POST",
            headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
        }, () => resolve());
        req.on("error", (e) => reject(new Error(`HME /transcript unreachable: ${e?.message ?? e}`)));
        req.write(body);
        req.end();
    });
}
/**
 * Trigger immediate mini-reindex of specific files via HME HTTP shim.
 * Called after tool calls that modify files (Edit/Write).
 */
async function reindexFiles(files) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify({ files });
        const req = http.request({
            hostname: "127.0.0.1", port: HME_HTTP_PORT, path: "/reindex", method: "POST",
            headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
        }, (res) => {
            let raw = "";
            res.on("data", (c) => { raw += c.toString("utf8"); });
            res.on("end", () => {
                try {
                    resolve(JSON.parse(raw));
                }
                catch (e) {
                    reject(new Error(`HME /reindex parse error: ${e?.message ?? e}`));
                }
            });
        });
        req.on("error", (e) => reject(new Error(`HME /reindex unreachable: ${e?.message ?? e}`)));
        req.write(body);
        req.end();
    });
}
/**
 * Post a narrative digest to the HME HTTP shim.
 * Called after the Ollama arbiter synthesizes a rolling summary.
 */
async function postNarrative(narrative) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify({ narrative });
        const req = http.request({
            hostname: "127.0.0.1", port: HME_HTTP_PORT, path: "/narrative", method: "POST",
            headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
        }, () => resolve());
        req.on("error", (e) => reject(new Error(`HME /narrative unreachable: ${e?.message ?? e}`)));
        req.write(body);
        req.end();
    });
}
/** Check whether the HME HTTP shim is reachable. Returns {ready, errors}. */
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
/**
 * Post a critical error to the HME HTTP shim error log.
 * Writes to log/hme-errors.log on disk — readable by main Claude session.
 */
async function logShimError(source, message, detail = "") {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify({ source, message, detail });
        const req = http.request({
            hostname: "127.0.0.1", port: HME_HTTP_PORT, path: "/error", method: "POST",
            headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
        }, () => resolve());
        req.on("error", (e) => reject(new Error(`HME /error unreachable: ${e?.message ?? e}`)));
        req.write(body);
        req.end();
    });
}
/**
 * Hybrid route: enrich message with HME KB context, then send to Ollama.
 * Falls back to plain Ollama if shim is unreachable.
 */
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
    return streamOllamaAgentic(messages, opts, workingDir, onChunk, onDone, onError);
}
