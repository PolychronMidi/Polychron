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
exports.mirrorAssistantToShim = mirrorAssistantToShim;
exports.reindexFromTools = reindexFromTools;
exports.runPostAudit = runPostAudit;
exports.streamClaudeMsg = streamClaudeMsg;
exports.streamLlamacppMsg = streamLlamacppMsg;
exports.streamHybridMsg = streamHybridMsg;
exports.streamAgentMsg = streamAgentMsg;
exports.streamAgentHybridMsg = streamAgentHybridMsg;
const path = __importStar(require("path"));
const router_1 = require("./router");
const streamUtils_1 = require("./streamUtils");
const msgHelpers_1 = require("./msgHelpers");
//  Helpers
const INDEXABLE_EXTS = new Set([
    ".js", ".ts", ".tsx", ".jsx", ".py", ".json", ".md", ".css", ".html", ".sh",
]);
function mirrorAssistantToShim(ctx, text, route, model, tools) {
    (0, router_1.postTranscript)([{
            ts: Date.now(), type: "assistant", route, model,
            content: text.slice(0, 2000),
            summary: `Assistant [${route}]: ${text.slice(0, 100)}`,
            meta: tools?.length ? { tools } : undefined,
        }]).catch((e) => ctx.postError("transcript", String(e)));
}
function reindexFromTools(tools) {
    const files = new Set();
    for (const t of tools) {
        const fileMatch = t.match(/"file_path"\s*:\s*"([^"]+)"/);
        if (fileMatch)
            files.add(fileMatch[1]);
        const llamacppMatch = t.match(/\[(write_file|read_file|bash)\]\s*\{[^}]*"path"\s*:\s*"([^"]+)"/);
        if (llamacppMatch)
            files.add(llamacppMatch[2]);
    }
    const indexable = [...files].filter(f => INDEXABLE_EXTS.has(path.extname(f).toLowerCase()));
    if (indexable.length > 0) {
        (0, router_1.reindexFiles)(indexable).catch((e) => console.error(`[HME] reindexFiles failed: ${e?.message ?? e}`));
    }
    return files;
}
function runPostAudit(ctx, changedFiles) {
    const filesArg = changedFiles?.size ? [...changedFiles].join(",") : "";
    (0, router_1.auditChanges)(filesArg).then(({ violations, changed_files }) => {
        ctx.transcript.logAudit(changed_files.length, violations.length);
        if (violations.length > 0) {
            const summary = violations
                .map((v) => `[${v.category}] ${v.file}: ${v.title}`)
                .join("; ");
            ctx.postError("audit", `post-audit (${changed_files.length} files): ${summary}`);
        }
    }).catch((e) => ctx.postError("audit", String(e)));
}
function makeOnChunk(ctx, assistantId, acc, state, tracker, route, opts = {}) {
    return (chunk, type) => {
        if (opts.abortCheck?.())
            return;
        if (type === "tool") {
            state.tools.push(chunk);
            acc.append("tool", chunk);
            ctx.post({ type: "streamChunk", id: assistantId, chunkType: "tool", chunk });
            ctx.transcript.logToolCall(chunk.split("]")[0].replace("[", ""), chunk, route);
            if (/^\[(?:Pre|Post)Compact\]/.test(chunk)) {
                ctx.post({ type: "notice", level: "block", text: `CRITICAL: ${chunk}` });
                ctx.postError("compact", chunk);
            }
        }
        else if (type === "thinking") {
            state.thinking += chunk;
            acc.append("thinking", chunk);
            ctx.post({ type: "streamChunk", id: assistantId, chunkType: "thinking", chunk });
        }
        else if (type === "error") {
            opts.handleError?.(chunk);
        }
        else {
            state.text += chunk;
            acc.append("text", chunk);
            ctx.post({ type: "streamChunk", id: assistantId, chunkType: type, chunk });
        }
        tracker.update(state.text, state.tools, state.thinking || undefined);
    };
}
function runStream(opts) {
    const { ctx, assistantId, route } = opts;
    const state = { text: "", thinking: "", tools: [] };
    const acc = (0, streamUtils_1.makeBlockAccumulator)();
    let aborted = false;
    let streamEnded = false;
    const tracker = ctx.trackStream(assistantId, route);
    const safeEnd = () => {
        if (streamEnded)
            return;
        streamEnded = true;
        if (opts.drainOnEnd ?? true)
            ctx.drainQueue();
        else
            opts.onEnd?.();
    };
    const postStreamEnd = () => ctx.post({ type: "streamEnd", id: assistantId });
    const onChunk = makeOnChunk(ctx, assistantId, acc, state, tracker, route, {
        abortCheck: () => aborted,
        handleError: (chunk) => ctx.postError(route, chunk),
    });
    let cancelFn;
    const setCancel = (fn) => { cancelFn = fn; };
    const handle = {
        state,
        acc,
        tracker,
        onChunk,
        isAborted: () => aborted,
        isEnded: () => streamEnded,
        markEnded: () => { streamEnded = true; },
        safeEnd,
        postStreamEnd,
        setCancel,
    };
    if (opts.preludeChunk) {
        ctx.post({ type: "streamChunk", id: assistantId, chunkType: "tool", chunk: opts.preludeChunk });
        acc.append("tool", opts.preludeChunk);
    }
    if (opts.ownCancel ?? true) {
        ctx.setCancelCurrent(() => { aborted = true; cancelFn?.(); });
    }
    opts.start(handle);
    return {
        cancel: () => { aborted = true; cancelFn?.(); },
        handle,
    };
}
/**
 * Build the final ChatMessage, finalize the tracker, post streamEnd, run side-effects.
 * Returns the built message so callers can inspect it if needed.
 */
function finalizeStream(h, ctx, assistantId, route, opts = {}) {
    const msg = {
        id: assistantId, role: "assistant", text: h.state.text,
        tools: h.state.tools.length ? h.state.tools : undefined,
        blocks: h.acc.blocks.length ? h.acc.blocks : undefined,
        route, ts: Date.now(),
    };
    if (opts.includeThinking && h.state.thinking)
        msg.thinking = h.state.thinking;
    h.tracker.finalize(msg);
    h.postStreamEnd();
    if (opts.pushLlamacpp && opts.userText !== undefined) {
        ctx.state.llamacppHistory.push({ role: "user", content: opts.userText });
        ctx.state.llamacppHistory.push({ role: "assistant", content: h.state.text });
    }
    ctx.transcript.logAssistant(h.state.text, route, opts.model, h.state.tools);
    if (!opts.skipMirror)
        mirrorAssistantToShim(ctx, h.state.text, route, opts.model, h.state.tools);
    const changedFiles = reindexFromTools(h.state.tools);
    runPostAudit(ctx, changedFiles);
    if (opts.checkChain)
        ctx.checkChainThreshold();
    return msg;
}
/**
 * Attach a promise-returned cancel fn to the harness.
 * Aborts immediately if the harness was already aborted before the promise resolves.
 * On rejection, calls onError then signals the harness ended via onForceEnd.
 */
function attachPromiseCancel(h, promise, onError, onForceEnd) {
    promise.then((cancel) => {
        if (h.isAborted()) {
            cancel();
            return;
        }
        h.setCancel(cancel);
    }).catch((err) => {
        if (h.isAborted())
            return;
        onError(String(err));
        if (!h.isEnded()) {
            if (onForceEnd) {
                h.markEnded();
                h.postStreamEnd();
                onForceEnd();
            }
            else {
                h.postStreamEnd();
                h.safeEnd();
            }
        }
    });
}
const AGENTIC_SYSTEM = { role: "system", content: streamUtils_1.AGENTIC_SYSTEM_PROMPT };
function contextPrefixMessages(prefix) {
    return prefix
        ? [
            { role: "user", content: prefix },
            { role: "assistant", content: "Understood. I have the prior conversation context." },
        ]
        : [];
}
function streamClaudeMsg(ctx, msg, assistantId) {
    const route = msg._resolvedRoute ?? msg.route ?? "claude";
    const effectiveText = (msg._contextPrefix ?? "") + msg.text;
    const claudeOpts = (0, msgHelpers_1.claudeOptsFromMsg)(msg);
    // Announce exactly what we're about to send — the browser reconciles this against its UI.
    ctx.post({
        type: "claudeConfigDispatched",
        assistantId,
        modelId: claudeOpts.model,
        effort: claudeOpts.effort,
        thinking: claudeOpts.thinking,
    });
    runStream({
        ctx, assistantId, route,
        start: (h) => {
            // Claude uses a long-lived process pool keyed on chat-session id
            // (claudeProcessPool) — turn 1 hydrates, turn 2+ hits prompt cache.
            // It needs its own adapter-driven path rather than runAdapterStream
            // because of model-mismatch detection + per-turn session_id re-emit.
            const onCompleted = (usage) => {
                if (h.isAborted())
                    return;
                ctx.updateContextTracker(h.state.text, h.state.thinking, msg.claudeModel, usage);
                const _modelMismatch = usage?.modelId &&
                    !usage.modelId.includes(claudeOpts.model) &&
                    !usage.modelId.startsWith(`claude-${claudeOpts.model}`);
                if (_modelMismatch) {
                    ctx.post({
                        type: "claudeConfigMismatch",
                        assistantId,
                        requested: claudeOpts.model,
                        actual: usage.modelId,
                    });
                    ctx.postError("claude", `model mismatch: requested ${claudeOpts.model}, got ${usage.modelId}`);
                }
                else if (usage?.modelId && !_modelMismatch) {
                    ctx.post({
                        type: "claudeConfigConfirmed",
                        assistantId,
                        modelId: usage.modelId,
                        modelName: usage.modelName,
                        thinkingEmitted: !!h.state.thinking,
                    });
                }
                finalizeStream(h, ctx, assistantId, route, { includeThinking: true, model: msg.claudeModel, checkChain: true });
                h.safeEnd();
            };
            const onError = (err) => {
                if (h.isAborted())
                    return;
                if (!h.isEnded()) {
                    h.postStreamEnd();
                    h.safeEnd();
                }
                ctx.postError("claude", err);
            };
            // chatSessionId keys the process pool. A chat without a persisted
            // session entry still gets a transient pool key via assistantId so a
            // single turn at least benefits from the long-lived infrastructure.
            const chatSessionId = ctx.state.sessionEntry?.id ?? `transient-${assistantId}`;
            const pipeHandle = router_1.claudeAdapter.stream({
                chatSessionId,
                message: effectiveText,
                sessionId: ctx.state.claudeSessionId,
                workingDir: ctx.projectRoot,
            }, {
                onChunk: h.onChunk,
                claude: claudeOpts,
                // Hard wall-clock cap. Without this, runaway thinking or a hung
                // stdio pipe can leave Claude streaming indefinitely with no
                // user recourse beyond manual cancel. 300s is generous enough
                // for thorough thinking, tight enough to surface stuck streams.
                deadlineMs: 300000,
                onSessionId: (sessionId) => { ctx.state.claudeSessionId = sessionId; },
                onTokenUsage: (u) => {
                    onCompleted({
                        inputTokens: u.input ?? 0,
                        outputTokens: u.output ?? 0,
                        usedPct: u.usedPct,
                    });
                },
            });
            h.setCancel(() => pipeHandle.cancel());
            pipeHandle.done.then((result) => {
                if (!result.ok)
                    onError(result.error ?? "unknown error");
                // onCompleted was already called via onTokenUsage; if the stream
                // ended without tokens, still finalize.
                else if (!result.tokens)
                    onCompleted(undefined);
            });
        },
    });
}
/**
 * Generic adapter-driven runner: handle the common harness + finalize +
 * error-propagation pattern for any adapter-based route. Claude still
 * needs its own path because PTY-vs-pipe fallback + model-mismatch
 * detection are unique to it; llamacpp and hybrid are fully covered here.
 */
function runAdapterStream(args) {
    const { ctx, assistantId, route, adapter, buildInput, finalize, preludeChunk } = args;
    runStream({
        ctx, assistantId, route, preludeChunk,
        start: (h) => {
            const { messages, opts } = buildInput(ctx.postError);
            // Force the harness's onChunk into the adapter options so both
            // the UI (via post) and the finalize bookkeeping see every chunk.
            const fullOpts = { ...opts, onChunk: h.onChunk };
            const handle = adapter.stream(messages, fullOpts);
            h.setCancel(() => handle.cancel());
            handle.done.then((result) => {
                if (h.isAborted())
                    return;
                if (!result.ok) {
                    if (!h.isEnded()) {
                        h.postStreamEnd();
                        h.safeEnd();
                    }
                    ctx.postError(route, result.error ?? "unknown error");
                    return;
                }
                finalizeStream(h, ctx, assistantId, route, finalize);
                h.safeEnd();
            });
        },
    });
}
function streamLlamacppMsg(ctx, msg, assistantId) {
    const contextMessages = contextPrefixMessages(msg._contextPrefix);
    const trimmed = (0, streamUtils_1.trimHistoryToFit)(ctx.state.llamacppHistory, msg.text, [AGENTIC_SYSTEM, ...contextMessages]);
    const requestHistory = [AGENTIC_SYSTEM, ...contextMessages, ...trimmed, { role: "user", content: msg.text }];
    runAdapterStream({
        ctx, assistantId, route: "local", adapter: router_1.llamacppAdapter,
        buildInput: () => ({
            messages: requestHistory,
            opts: {
                onChunk: () => { }, // overwritten by runAdapterStream
                llamacpp: (0, msgHelpers_1.llamacppOptsFromMsg)(msg),
                workingDir: ctx.projectRoot,
            },
        }),
        finalize: { pushLlamacpp: true, userText: msg.text, model: msg.llamacppModel },
    });
}
function streamHybridMsg(ctx, msg, assistantId) {
    const contextMessages = contextPrefixMessages(msg._contextPrefix);
    const trimmed = (0, streamUtils_1.trimHistoryToFit)(ctx.state.llamacppHistory, msg.text, [AGENTIC_SYSTEM, ...contextMessages]);
    const history = [...contextMessages, ...trimmed];
    runAdapterStream({
        ctx, assistantId, route: "hybrid", adapter: router_1.hybridAdapter,
        preludeChunk: "[HME] Enriching with KB context…",
        buildInput: () => ({
            messages: { message: msg.text, history, workingDir: ctx.projectRoot },
            opts: {
                onChunk: () => { }, // overwritten by runAdapterStream
                llamacpp: (0, msgHelpers_1.llamacppOptsFromMsg)(msg),
            },
        }),
        finalize: { pushLlamacpp: true, userText: msg.text, model: msg.llamacppModel },
    });
}
function streamAgentMsg(ctx, msg, assistantId, label, onBothDone, onForceDrain, cancelFns) {
    const trimmed = (0, streamUtils_1.trimHistoryToFit)(ctx.state.llamacppHistory, msg.text, [AGENTIC_SYSTEM]);
    const requestHistory = [AGENTIC_SYSTEM, ...trimmed, { role: "user", content: msg.text }];
    const { cancel } = runStream({
        ctx, assistantId, route: label,
        ownCancel: false, drainOnEnd: false, onEnd: onBothDone,
        start: (h) => {
            const onDone = () => {
                if (h.isAborted())
                    return;
                finalizeStream(h, ctx, assistantId, label, {
                    pushLlamacpp: label === "local", userText: msg.text,
                    model: msg.llamacppModel, skipMirror: true,
                });
                h.safeEnd();
            };
            h.setCancel((0, router_1.streamLlamacppAgentic)(requestHistory, (0, msgHelpers_1.llamacppOptsFromMsg)(msg), ctx.projectRoot, h.onChunk, onDone, (err) => {
                ctx.postError(label, err);
                if (h.isEnded())
                    return;
                h.markEnded();
                h.postStreamEnd();
                onForceDrain();
            }));
        },
    });
    cancelFns.push(cancel);
}
function streamAgentHybridMsg(ctx, msg, assistantId, label, onBothDone, onForceDrain, cancelFns) {
    const history = (0, streamUtils_1.trimHistoryToFit)(ctx.state.llamacppHistory, msg.text, [AGENTIC_SYSTEM]);
    const { cancel } = runStream({
        ctx, assistantId, route: "hybrid",
        preludeChunk: "[HME] Enriching with KB context…",
        ownCancel: false, drainOnEnd: false, onEnd: onBothDone,
        start: (h) => {
            const onDone = () => {
                if (h.isAborted())
                    return;
                finalizeStream(h, ctx, assistantId, "hybrid", { model: msg.llamacppModel, skipMirror: true });
                h.safeEnd();
            };
            const onError = (err) => {
                if (h.isAborted())
                    return;
                ctx.postError(label, err);
                if (h.isEnded())
                    return;
                h.markEnded();
                h.postStreamEnd();
                onForceDrain();
            };
            attachPromiseCancel(h, (0, router_1.streamHybrid)(msg.text, history, (0, msgHelpers_1.llamacppOptsFromMsg)(msg), ctx.projectRoot, h.onChunk, onDone, onError), (err) => ctx.postError(label, err), onForceDrain);
        },
    });
    cancelFns.push(cancel);
}
