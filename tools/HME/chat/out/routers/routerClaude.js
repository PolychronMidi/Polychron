"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.USED_PCT_SANITY_CEILING = exports.USED_PCT_SUSPICIOUS_FLOOR = exports.USED_PCT_HARD_CEILING = void 0;
exports.streamClaude = streamClaude;
exports.setSanitizerErrorSink = setSanitizerErrorSink;
exports.setTurnNumberProvider = setTurnNumberProvider;
exports.sanitizeUsedPct = sanitizeUsedPct;
exports.streamClaudePty = streamClaudePty;
const child_process_1 = require("child_process");
const fs_1 = require("fs");
// node-pty is loaded lazily — a native module crash must never take down the extension host.
// Set process.env.HME_NO_PTY=1 to skip PTY entirely (e.g. browser/server mode).
let _pty = null;
function getPty() {
    if (process.env["HME_NO_PTY"])
        return null;
    if (_pty)
        return _pty;
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        _pty = require("node-pty");
        return _pty;
    }
    catch (e) {
        console.error(`[HME] node-pty unavailable — PTY mode disabled, falling back to -p: ${e?.message ?? e}`);
        return null;
    }
}
const HME_LOG = "/tmp/hme-ctx-debug.log";
function hmeLog(msg) {
    try {
        (0, fs_1.appendFileSync)(HME_LOG, `[${new Date().toISOString()}] ${msg}\n`);
    }
    catch (e) {
        try {
            (0, fs_1.appendFileSync)("/tmp/hme-log-fail.txt", String(e) + "\n");
        }
        catch { }
    }
}
function buildClaudeEnv() {
    const env = {};
    for (const [k, v] of Object.entries(process.env)) {
        if (k !== "ANTHROPIC_API_KEY" && v !== undefined)
            env[k] = v;
    }
    if (!env["PATH"]?.includes(".local/bin")) {
        env["PATH"] = `/home/${process.env["USER"] ?? "jah"}/.local/bin:${env["PATH"] ?? "/usr/local/bin:/usr/bin:/bin"}`;
    }
    return env;
}
// ── Shared CLI arg builder ────────────────────────────────────────────────
function buildClaudeArgs(opts, sessionId, prefix) {
    const args = [
        ...prefix,
        "--model", opts.model,
        "--effort", opts.effort,
        "--permission-mode", opts.permissionMode || "acceptEdits",
        // Thinking is a separate independent toggle — delivered via inline --settings JSON.
        "--settings", JSON.stringify({ alwaysThinkingEnabled: !!opts.thinking }),
    ];
    if (sessionId)
        args.push("--resume", sessionId);
    return args;
}
// ── Claude CLI (pipe mode) ────────────────────────────────────────────────
function streamClaude(message, sessionId, opts, workingDir, onChunk, onSessionId, onDone, onError) {
    // opts.thinking: Extended thinking blocks come through natively in stream-json --verbose.
    const args = buildClaudeArgs(opts, sessionId, ["-p", "--output-format", "stream-json", "--verbose"]);
    const env = buildClaudeEnv();
    // The statusline hook always writes to /tmp/claude-context.json in Claude Code's
    // environment — setting HME_CTX_FILE on the subprocess env has no effect on the
    // hook. Read the fixed path directly.
    const ctxFile = `/tmp/claude-context.json`;
    const proc = (0, child_process_1.spawn)("claude", args, {
        cwd: workingDir,
        env,
        stdio: ["pipe", "pipe", "pipe"],
    });
    proc.stdin.write(message);
    proc.stdin.end();
    const _readCtxFile = () => {
        try {
            const d = JSON.parse((0, fs_1.readFileSync)(ctxFile, "utf8"));
            const usedPct = sanitizeUsedPct(d.used_pct, `streamClaude:ctxFile:${ctxFile}`);
            return {
                ...(usedPct != null ? { usedPct } : {}),
                ...(d.model_id ? { modelId: d.model_id } : {}),
                ...(d.model_name ? { modelName: d.model_name } : {}),
            };
        }
        catch {
            return {};
        }
    };
    let buf = "";
    let doneFired = false;
    // Store result-event data; emit after close so the Stop hook has already
    // written the real API used_pct to ctxFile before we read it.
    let pendingCost;
    let pendingUsage;
    let resultReceived = false;
    const storeResult = (cost, usage) => {
        resultReceived = true;
        pendingCost = cost;
        pendingUsage = usage;
    };
    const finalize = (code) => {
        if (doneFired)
            return;
        doneFired = true;
        // Read used_pct from statusline-raw — the statusline hook writes this for
        // every Claude Code session. used_percentage is the direct API value, no math.
        let ctxOverride = {};
        try {
            const raw = JSON.parse((0, fs_1.readFileSync)("/tmp/claude-statusline-raw.json", "utf8"));
            const usedPct = sanitizeUsedPct(raw?.context_window?.used_percentage, "streamClaude:statusline-raw");
            if (usedPct != null) {
                ctxOverride = {
                    usedPct,
                    modelId: raw?.model?.id || undefined,
                    modelName: raw?.model?.display_name || undefined,
                };
            }
        }
        catch { }
        if (ctxOverride.usedPct == null)
            ctxOverride = _readCtxFile();
        const base = resultReceived ? pendingUsage : undefined;
        const merged = base
            ? { ...base, ...ctxOverride }
            : (ctxOverride.usedPct != null ? { inputTokens: 0, outputTokens: 0, ...ctxOverride } : undefined);
        onDone(pendingCost, merged);
    };
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
                handleStreamEvent(evt, opts.model, onChunk, onSessionId, storeResult);
            }
            catch (e) {
                console.error(`[HME] stream JSON parse failed: ${e?.message ?? e} | line: ${line.slice(0, 120)}`);
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
        if (buf.trim()) {
            try {
                const evt = JSON.parse(buf.trim());
                handleStreamEvent(evt, opts.model, onChunk, onSessionId, storeResult);
            }
            catch (e) {
                console.error(`[HME] close-buf JSON parse failed: ${e?.message ?? e} | buf: ${buf.slice(0, 120)}`);
                onChunk(buf.trim(), "error");
            }
        }
        if (code !== 0) {
            onError(`Claude CLI exited with code ${code}`);
            return;
        }
        finalize(code);
    });
    return () => { try {
        proc.kill();
    }
    catch { } };
}
// Sanity bounds for a reported/computed usedPct.
//
// HARD CEILING (100.5%) — anything above is a bug by definition. A context
// window is a fixed denominator; >100% means the denominator is wrong (the
// 1M-vs-200k bug that shipped 1456% as a "real" value). 0.5% of slop
// accommodates floating-point rounding without admitting a 105% miscalc.
//
// SUSPICIOUS BAND (95..100%) — legitimately reachable only after a long
// session; on turn 1-2 it's almost certainly a miscalculation. Values in
// this band still propagate (we can't prove they're wrong) but also emit a
// `suspicious_pct` rejection so investigations leave a trace.
exports.USED_PCT_HARD_CEILING = 100.5;
exports.USED_PCT_SUSPICIOUS_FLOOR = 95;
// Legacy export — callers outside this module still reference the old name
// for the hard ceiling. Kept as an alias rather than removed so a third-party
// import doesn't silently resolve to undefined.
exports.USED_PCT_SANITY_CEILING = exports.USED_PCT_HARD_CEILING;
// Module-level error sink for sanitizer rejections. Set once at panel init
// by BrowserPanel so every rejection lands in hme-errors.log and surfaces
// in the userpromptsubmit banner next turn. console.error alone vanishes.
let _sanitizerSink = null;
function setSanitizerErrorSink(sink) {
    _sanitizerSink = sink;
}
// Module-level turn-number getter. BrowserPanel sets this so the sanitizer
// can distinguish "turn 1 reporting 99%" (almost always a miscalc) from
// "turn 20 reporting 99%" (plausibly real). Defaults to null, which means
// "unknown turn — skip the suspicious-band check" rather than silently
// treating every reading as not-suspicious.
let _getTurnNumber = null;
function setTurnNumberProvider(fn) {
    _getTurnNumber = fn;
}
function _reportRejection(source, message) {
    console.error(`[HME] ${message}`);
    if (_sanitizerSink) {
        _sanitizerSink.post(source, message);
    }
    else {
        // Sink not wired yet (e.g. called before BrowserPanel init). Write directly
        // so the LIFESAVER can catch it — never silently drop a rejection.
        const root = process.env["PROJECT_ROOT"] ?? "";
        if (root) {
            try {
                (0, fs_1.appendFileSync)(`${root}/log/hme-errors.log`, `[${new Date().toISOString()}] [${source}] ${message}\n`);
            }
            catch (_e) { /* last resort already logged to console above */ }
        }
    }
}
/**
 * Single sanitization gate for every path that produces a usedPct.
 *
 * Returns `undefined` (meter keeps last known value) when:
 *  - raw is null/undefined (no signal)
 *  - raw is non-finite or out of [0, USED_PCT_HARD_CEILING]
 *
 * When raw lands in the SUSPICIOUS band [USED_PCT_SUSPICIOUS_FLOOR, 100.5]
 * AND `turnNumber` is ≤ 2, the value still propagates (we can't prove it's
 * wrong) but emits a high-priority `suspicious_pct` rejection so post-hoc
 * investigations find a trace. Turn 1-2 at 95%+ is the exact signature of
 * the 1M-vs-200k miscalc that shipped before this guard existed.
 *
 * Call sites: result-event computeTurnUsage, PTY /context parseContextOutput,
 * PTY ctxFile _buildPtyUsage.
 */
function sanitizeUsedPct(raw, source, turnNumberOverride) {
    const turnNumber = turnNumberOverride ?? (_getTurnNumber ? _getTurnNumber() ?? undefined : undefined);
    if (raw == null)
        return undefined;
    if (typeof raw !== "number" || !Number.isFinite(raw)) {
        _reportRejection("sanitizeUsedPct", `sanitizeUsedPct(${source}) rejected non-finite value: ${JSON.stringify(raw)}`);
        return undefined;
    }
    if (raw < 0 || raw > exports.USED_PCT_HARD_CEILING) {
        _reportRejection("sanitizeUsedPct", `sanitizeUsedPct(${source}) rejected out-of-range value ${raw} (hard ceiling ${exports.USED_PCT_HARD_CEILING})`);
        return undefined;
    }
    // Suspicious band: value is numerically plausible but suspicious on early
    // turns. Log but propagate — never silently drop data that might be real.
    if (raw >= exports.USED_PCT_SUSPICIOUS_FLOOR && turnNumber != null && turnNumber <= 2) {
        _reportRejection("sanitizeUsedPct", `sanitizeUsedPct(${source}) suspicious_pct: ${raw}% on turn ${turnNumber} ` +
            `(values >=${exports.USED_PCT_SUSPICIOUS_FLOOR}% so early almost always indicate a miscalc). ` +
            `Value propagated — investigate if the meter triggers a chain soon.`);
    }
    return Math.round(raw * 10) / 10;
}
function computeTurnUsage(evt, uiModelAlias, inputTokens, outputTokens) {
    if (inputTokens == null || outputTokens == null)
        return undefined;
    const modelUsage = evt.modelUsage;
    if (!modelUsage || typeof modelUsage !== "object") {
        _reportRejection("computeTurnUsage", `result event missing modelUsage — usedPct cannot be computed (uiAlias=${uiModelAlias})`);
        return { inputTokens, outputTokens, usedPct: undefined };
    }
    const entries = Object.entries(modelUsage);
    const prefix = `claude-${uiModelAlias}-`;
    const match = entries.find(([k]) => k.startsWith(prefix));
    if (!match) {
        // UI alias doesn't match any modelUsage key. Hard fail — don't guess.
        // Surfacing this loudly catches CLI naming drift (e.g. a future
        // "claude-opus5-..." key that no longer matches "claude-opus-").
        _reportRejection("computeTurnUsage", `no modelUsage entry matches UI alias "${uiModelAlias}" (prefix="${prefix}"). Available keys: ${entries.map(e => e[0]).join(", ")}`);
        return { inputTokens, outputTokens, usedPct: undefined };
    }
    const [modelKey, modelEntry] = match;
    const contextWindow = modelEntry?.contextWindow;
    if (typeof contextWindow !== "number" || !Number.isFinite(contextWindow) || contextWindow < 1000) {
        _reportRejection("computeTurnUsage", `invalid contextWindow on modelUsage["${modelKey}"]: ${JSON.stringify(contextWindow)} — usedPct skipped (uiAlias=${uiModelAlias})`);
        return { inputTokens, outputTokens, usedPct: undefined, modelId: modelKey, modelName: modelEntry?.modelName };
    }
    // Use the last iteration's cache_read as the context fill — multi-turn tool
    // calls produce multiple iterations, each re-reading the full cache, so summing
    // across iterations gives a multiple of the real fill. The last iteration's
    // cache_read_input_tokens IS the actual window occupancy this turn.
    const iterations = evt.usage?.iterations ?? [];
    const lastIter = iterations[iterations.length - 1] ?? {};
    const fill = (lastIter.input_tokens ?? 0)
        + (lastIter.cache_read_input_tokens ?? 0)
        + (lastIter.cache_creation_input_tokens ?? 0);
    const rawPct = (fill / contextWindow) * 100;
    const usedPct = sanitizeUsedPct(rawPct, `computeTurnUsage:fill=${fill},ctxWindow=${contextWindow},model=${modelKey}`);
    return {
        inputTokens,
        outputTokens,
        usedPct,
        modelId: modelKey,
        modelName: modelEntry?.modelName,
    };
}
function handleStreamEvent(evt, uiModelAlias, onChunk, onSessionId, onDone) {
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
                onChunk(`[${block.name}] ${JSON.stringify(block.input ?? {}, null, 2)}`, "tool");
            }
        }
        return;
    }
    if (evt.type === "result") {
        const inputTokens = evt.usage?.input_tokens;
        const outputTokens = evt.usage?.output_tokens;
        const usage = computeTurnUsage(evt, uiModelAlias, inputTokens, outputTokens);
        onDone(evt.total_cost_usd ?? evt.cost_usd ?? undefined, usage);
        return;
    }
}
// ── Claude PTY (hook-aware interactive mode) ───────────────────────────────
const PTY_DONE_PATTERNS = [
    /\d+%\s*\|\s*\S/, // statusline footer: "90% | Sonnet 4.6" — unambiguous turn-complete
    /❯\s+[1-9]\d+/, // prompt with non-zero token count: "❯ 20378" (not "❯ 0")
    /\nHuman:\s*$/,
    /\[H\]/,
];
/** Classify a single PTY text line into chunk type for onChunk. Returns null to suppress. */
function classifyPtyLine(text, fullOutput) {
    const trimmed = text.trim();
    if (!trimmed)
        return null;
    if (/^(?:⠋|⠙|⠹|⠸|⠼|⠴|⠦|⠧|⠇|⠏)\s/.test(trimmed)) {
        return { chunk: trimmed.replace(/^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]\s*/, ""), type: "thinking" };
    }
    if (/^●\s/.test(trimmed) || /^\[.*\]/.test(trimmed)) {
        return { chunk: trimmed, type: "tool" };
    }
    if (!PTY_DONE_PATTERNS.some((p) => p.test(fullOutput.slice(-200)))) {
        return { chunk: text, type: "text" };
    }
    return null;
}
function stripAnsi(str) {
    // eslint-disable-next-line no-control-regex
    return str.replace(/\x1b\[[\x20-\x3f]*[0-9;]*[\x20-\x7e]/g, "")
        .replace(/\x1b\][^\x07]*\x07/g, "")
        .replace(/\r/g, "");
}
function parseK(s) {
    const n = parseFloat(s);
    return s.endsWith("k") || s.endsWith("K") ? Math.round(n * 1000) : Math.round(n);
}
function parseContextOutput(text) {
    // Extract Free space % and Autocompact buffer % from /context output.
    // Used% = 100 - freeSpace% - autocompact%
    const freeMatch = text.match(/Free\s+space[^\n]*\((\d+(?:\.\d+)?)%\)/i);
    const autoMatch = text.match(/Autocompact\s+buffer[^\n]*\((\d+(?:\.\d+)?)%\)/i);
    if (freeMatch && autoMatch) {
        const freePct = parseFloat(freeMatch[1]);
        const autoPct = parseFloat(autoMatch[1]);
        const rawPct = 100 - freePct - autoPct;
        const usedPct = sanitizeUsedPct(rawPct, `parseContextOutput:free/auto (free=${freePct},auto=${autoPct})`);
        // Also grab total token count from "Tokens: Xk / Yk (N%)" for inputTokens
        const tokenLine = text.match(/Tokens[:\s]+([\d.]+k?)\s*\/\s*([\d.]+k?)/i);
        const inputTokens = tokenLine ? parseK(tokenLine[1]) : 0;
        return { inputTokens, outputTokens: 0, usedPct };
    }
    // Fallback: use token line percentage directly
    const lineMatch = text.match(/Tokens[:\s]+([\d.]+k?)\s*\/\s*([\d.]+k?)\s*\((\d+(?:\.\d+)?)%\)/i);
    if (lineMatch) {
        const usedPct = sanitizeUsedPct(parseFloat(lineMatch[3]), `parseContextOutput:tokenLine`);
        return { inputTokens: parseK(lineMatch[1]), outputTokens: 0, usedPct };
    }
    // Statusline footer format (CLI v2+): "❯ 20378\n\nXX% | Sonnet 4.6\n\n  20378 tokens"
    // The XX% value is context_window.remaining_percentage — invert to get used%.
    const statuslineMatch = text.match(/(\d+(?:\.\d+)?)%\s*\|\s*\S/);
    if (statuslineMatch) {
        const remainingPct = parseFloat(statuslineMatch[1]);
        const usedPct = sanitizeUsedPct(100 - remainingPct, `parseContextOutput:statusline(100-${remainingPct})`);
        const tokMatch = text.match(/([\d.]+k?)\s+tokens/i);
        const inputTokens = tokMatch ? parseK(tokMatch[1]) : 0;
        return { inputTokens, outputTokens: 0, usedPct };
    }
    return undefined;
}
function streamClaudePty(message, sessionId, opts, workingDir, onChunk, onSessionId, onDone, onError, onRawData, onPtyReady) {
    hmeLog(`streamClaudePty called model=${opts.model} effort=${opts.effort}`);
    // PTY always uses bypassPermissions (interactive hook-aware mode).
    const args = buildClaudeArgs({ ...opts, permissionMode: "bypassPermissions" }, sessionId, []);
    const env = buildClaudeEnv();
    env["TERM"] = "xterm-256color";
    // Each PTY session writes context data to its own file so the main Claude Code
    // session's Stop hook (writing to /tmp/claude-context.json) can't overwrite it.
    const ctxFile = `/tmp/claude-ctx-pty-${Date.now()}.json`;
    env["HME_CTX_FILE"] = ctxFile;
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
    onPtyReady?.((data) => { try {
        proc.write(data);
    }
    catch { } });
    let fullOutput = "";
    let sentMessage = false;
    let turnDone = false;
    let sessionIdSent = false;
    let initBuf = "";
    let doneTimer = null;
    let contextQueryActive = false;
    let contextQueryBuf = "";
    let donePatternMatched = false;
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
                onError(`CRITICAL: Claude PTY produced no output for ${PTY_INACTIVITY_MS / 1000}s` +
                    " after message send — API may be down or CLI crashed");
            }
        }, PTY_INACTIVITY_MS);
    };
    const _buildPtyUsage = () => {
        // Primary: dedicated ctxFile written by statusline.sh when HME_CTX_FILE is set.
        try {
            const ctxData = JSON.parse((0, fs_1.readFileSync)(ctxFile, "utf8"));
            return {
                inputTokens: ctxData.input_tokens ?? 0,
                outputTokens: ctxData.output_tokens ?? 0,
                usedPct: sanitizeUsedPct(ctxData.used_pct, `_buildPtyUsage:${ctxFile}`),
                modelId: ctxData.model_id || undefined,
                modelName: ctxData.model_name || undefined,
            };
        }
        catch (e) {
            if (e?.code !== "ENOENT")
                hmeLog(`WARN _buildPtyUsage ctxFile: ${e?.message ?? e}`);
        }
        // Fallback: statusline.sh always writes /tmp/claude-statusline-raw.json with the
        // real API used_percentage regardless of HME_CTX_FILE. Read it directly.
        try {
            const raw = JSON.parse((0, fs_1.readFileSync)("/tmp/claude-statusline-raw.json", "utf8"));
            const usedPct = sanitizeUsedPct(raw?.context_window?.used_percentage, "_buildPtyUsage:statusline-raw");
            if (usedPct != null) {
                hmeLog(`_buildPtyUsage: statusline-raw fallback usedPct=${usedPct} model=${raw?.model?.id}`);
                return {
                    inputTokens: raw?.context_window?.current_usage?.input_tokens ?? 0,
                    outputTokens: raw?.context_window?.current_usage?.output_tokens ?? 0,
                    usedPct,
                    modelId: raw?.model?.id || undefined,
                    modelName: raw?.model?.display_name || undefined,
                };
            }
        }
        catch (e) {
            if (e?.code !== "ENOENT")
                hmeLog(`WARN _buildPtyUsage statusline-raw: ${e?.message ?? e}`);
        }
        return undefined;
    };
    const finalizeTurn = () => {
        if (!turnDone) {
            turnDone = true;
            // Try contextQueryBuf first (from /context command), then fall back to
            // parsing fullOutput directly — Claude CLI may emit token info in its footer.
            const ctxParsed = parseContextOutput(contextQueryBuf) ?? parseContextOutput(fullOutput);
            hmeLog(`finalize: donePatternMatched=${donePatternMatched}`);
            hmeLog(`finalize: ctxBuf=${JSON.stringify(contextQueryBuf.slice(0, 200))}`);
            hmeLog(`finalize: ctxParsed=${JSON.stringify(ctxParsed)}`);
            hmeLog(`finalize: fullTail=${JSON.stringify(fullOutput.slice(-400))}`);
            if (!fullOutput.trim()) {
                hmeLog(`WARN finalize: fullOutput is empty — message may not have been sent or PTY died before responding`);
                onChunk("[HME] WARN: PTY produced no output — message may not have been received", "error");
            }
            const usage = ctxParsed ?? _buildPtyUsage();
            if (!usage) {
                const reason = donePatternMatched
                    ? "matched but /context parse failed"
                    : "never matched (PTY output format may have changed)";
                hmeLog(`WARN finalize: no context data — done patterns ${reason}`);
                const chunkReason = donePatternMatched
                    ? "/context parse failed"
                    : "PTY done patterns never matched, check hme-ctx-debug.log";
                onChunk(`[HME] WARN: context % unavailable — ${chunkReason}`, "error");
            }
            onDone(usage);
            try {
                proc.kill();
            }
            catch { }
        }
    };
    const scheduleContextQuery = () => {
        if (doneTimer)
            clearTimeout(doneTimer);
        if (ptyInactivityTimer) {
            clearTimeout(ptyInactivityTimer);
            ptyInactivityTimer = null;
        }
        donePatternMatched = true;
        contextQueryActive = true;
        contextQueryBuf = "";
        hmeLog("ctx: sending /context");
        try {
            proc.write("/context\r");
        }
        catch (e) {
            hmeLog(`ERROR ctx: /context write failed: ${e?.message ?? e}`);
            onError(`PTY /context write failed: ${e?.message ?? e}`);
        }
        doneTimer = setTimeout(finalizeTurn, 1500);
    };
    proc.onData((raw) => {
        onRawData?.(raw);
        const text = stripAnsi(raw);
        if (!sentMessage) {
            initBuf += text;
            // Wait for the prompt character at the very end of the buffer — never trigger
            // on │ (box-drawing borders in the startup banner) which causes the remainder
            // of the banner, including "bypassPermissions" notices, to leak into chat.
            const promptFound = initBuf.includes("> ") || initBuf.includes("❯") || initBuf.includes("Human:");
            const ready = promptFound || initBuf.length > 2000;
            if (ready) {
                if (!promptFound) {
                    hmeLog(`WARN init fallback: prompt not found in ${initBuf.length} chars — ` +
                        `banner format may have changed. Head: ${JSON.stringify(initBuf.slice(0, 300))}`);
                    onChunk("[HME] WARN: PTY prompt not detected — banner format may have changed, see hme-ctx-debug.log", "error");
                }
                sentMessage = true;
                proc.write(message.replace(/\r?\n/g, " ") + "\r");
                resetPtyInactivity();
            }
            return;
        }
        if (contextQueryActive) {
            contextQueryBuf += text;
            // New prompt means /context finished — fire immediately if we have data
            if (PTY_DONE_PATTERNS.some((p) => p.test(text)) && parseContextOutput(contextQueryBuf)) {
                if (doneTimer)
                    clearTimeout(doneTimer);
                finalizeTurn();
            }
            return;
        }
        resetPtyInactivity();
        fullOutput += text;
        if (!sessionIdSent) {
            const sessionMatch = fullOutput.match(/Session(?:\s+ID)?:\s*([a-f0-9-]{8,})/i);
            if (sessionMatch) {
                sessionIdSent = true;
                onSessionId(sessionMatch[1]);
            }
        }
        const classified = classifyPtyLine(text, fullOutput);
        if (classified)
            onChunk(classified.chunk, classified.type);
        if (PTY_DONE_PATTERNS.some((p) => p.test(fullOutput.slice(-400)))) {
            scheduleContextQuery();
        }
    });
    proc.onExit(({ exitCode }) => {
        if (ptyInactivityTimer) {
            clearTimeout(ptyInactivityTimer);
            ptyInactivityTimer = null;
        }
        if (turnDone)
            return;
        setTimeout(() => {
            if (turnDone)
                return;
            if (doneTimer)
                clearTimeout(doneTimer);
            if (exitCode !== 0) {
                turnDone = true;
                onError(`Claude CLI exited with code ${exitCode}`);
            }
            else {
                finalizeTurn();
            }
        }, 200);
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
