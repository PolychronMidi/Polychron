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
    proc.stdout.on("data", (data) => {
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
                // non-JSON line, skip
            }
        }
    });
    proc.stderr.on("data", (data) => {
        const text = data.toString("utf8").trim();
        if (text)
            onError(text);
    });
    proc.on("close", (code) => {
        // Flush any remaining buffered output
        if (buf.trim()) {
            try {
                const evt = JSON.parse(buf.trim());
                handleStreamEvent(evt, onChunk, onSessionId, safeOnDone);
            }
            catch { }
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
    const scheduleDone = () => {
        if (doneTimer)
            clearTimeout(doneTimer);
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
                // Send message then Enter
                proc.write(message.replace(/\r?\n/g, " ") + "\r");
            }
            return;
        }
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
    const killed = { v: false };
    return () => {
        killed.v = true;
        turnDone = true;
        if (doneTimer)
            clearTimeout(doneTimer);
        try {
            proc.kill();
        }
        catch { }
    };
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
                    const text = parsed?.message?.content ?? "";
                    if (text)
                        onChunk(text, "text");
                    if (parsed?.done)
                        fireDone();
                }
                catch { }
            }
        });
        res.on("end", () => { if (!aborted)
            fireDone(); });
        res.on("error", (e) => onError(e.message));
    });
    req.on("error", (e) => onError(e.message));
    req.write(body);
    req.end();
    return () => { aborted = true; req.destroy(); };
}
// ── HME context enrichment ─────────────────────────────────────────────────
/**
 * Fetch KB context from the HME HTTP shim for a given query.
 * Returns the warm context string, or empty string if shim is unreachable.
 */
async function fetchHmeContext(query, topK = 5) {
    return new Promise((resolve) => {
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
                try {
                    const parsed = JSON.parse(raw);
                    resolve(parsed.warm ?? "");
                }
                catch {
                    resolve("");
                }
            });
        });
        req.on("error", () => resolve(""));
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
    return new Promise((resolve) => {
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
                catch {
                    resolve({ warnings: [], blocks: [] });
                }
            });
        });
        req.on("error", () => resolve({ warnings: [], blocks: [] }));
        req.write(body);
        req.end();
    });
}
/**
 * Post-response: audit changed files against KB constraints.
 * Returns {violations, changed_files}.
 */
async function auditChanges(changedFiles = "") {
    return new Promise((resolve) => {
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
                catch {
                    resolve({ violations: [], changed_files: [] });
                }
            });
        });
        req.on("error", () => resolve({ violations: [], changed_files: [] }));
        req.write(body);
        req.end();
    });
}
/**
 * Post transcript entries to the HME HTTP shim.
 * Mirrors the TranscriptLogger's JSONL entries to the server-side store.
 */
async function postTranscript(entries) {
    return new Promise((resolve) => {
        const body = JSON.stringify({ entries });
        const req = http.request({
            hostname: "127.0.0.1", port: HME_HTTP_PORT, path: "/transcript", method: "POST",
            headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
        }, () => resolve());
        req.on("error", () => resolve());
        req.write(body);
        req.end();
    });
}
/**
 * Trigger immediate mini-reindex of specific files via HME HTTP shim.
 * Called after tool calls that modify files (Edit/Write).
 */
async function reindexFiles(files) {
    return new Promise((resolve) => {
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
                catch {
                    resolve({ indexed: [], count: 0 });
                }
            });
        });
        req.on("error", () => resolve({ indexed: [], count: 0 }));
        req.write(body);
        req.end();
    });
}
/**
 * Post a narrative digest to the HME HTTP shim.
 * Called after the Ollama arbiter synthesizes a rolling summary.
 */
async function postNarrative(narrative) {
    return new Promise((resolve) => {
        const body = JSON.stringify({ narrative });
        const req = http.request({
            hostname: "127.0.0.1", port: HME_HTTP_PORT, path: "/narrative", method: "POST",
            headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
        }, () => resolve());
        req.on("error", () => resolve());
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
                catch {
                    resolve({ ready: false, errors: [] });
                }
            });
        });
        req.on("error", () => resolve({ ready: false, errors: [] }));
        req.setTimeout(1000, () => { req.destroy(); resolve({ ready: false, errors: [] }); });
    });
}
/**
 * Post a critical error to the HME HTTP shim error log.
 * Writes to log/hme-errors.log on disk — readable by main Claude session.
 */
async function logShimError(source, message, detail = "") {
    return new Promise((resolve) => {
        const body = JSON.stringify({ source, message, detail });
        const req = http.request({
            hostname: "127.0.0.1", port: HME_HTTP_PORT, path: "/error", method: "POST",
            headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
        }, () => resolve());
        req.on("error", () => resolve());
        req.write(body);
        req.end();
    });
}
/**
 * Hybrid route: enrich message with HME KB context, then send to Ollama.
 * Falls back to plain Ollama if shim is unreachable.
 */
async function streamHybrid(message, history, opts, onChunk, onDone, onError) {
    const hmeContext = await fetchHmeContext(message);
    const messages = [];
    if (hmeContext) {
        messages.push({
            role: "system",
            content: `You are an expert assistant with access to the following project knowledge base context. Use it to ground your response.\n\n${hmeContext}`,
        });
    }
    messages.push(...history, { role: "user", content: message });
    return streamOllama(messages, opts, onChunk, onDone, onError);
}
