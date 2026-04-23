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
            const onDone = (usage) => {
                if (h.isAborted())
                    return;
                ctx.updateContextTracker(h.state.text, h.state.thinking, msg.claudeModel, usage);
                // Validate: did Claude actually run with the model we asked for?
                // usage.modelId is the full CLI key (e.g. "claude-sonnet-4-6");
                // claudeOpts.model is the short alias (e.g. "sonnet"). A mismatch
                // is only real when the alias doesn't appear in the full ID at all.
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
            const startPipe = () => (0, router_1.streamClaude)(effectiveText, ctx.state.claudeSessionId, claudeOpts, ctx.projectRoot, h.onChunk, (sessionId) => { ctx.state.claudeSessionId = sessionId; }, (_cost, usage) => { onDone(usage); }, onError);
            h.setCancel((0, router_1.streamClaudePty)(effectiveText, ctx.state.claudeSessionId, claudeOpts, ctx.projectRoot, h.onChunk, (sessionId) => { ctx.state.claudeSessionId = sessionId; }, onDone, (err) => {
                console.log(`[HME Chat] PTY unavailable (${err}), falling back to -p mode`);
                h.setCancel(startPipe());
            }, ctx.mirrorPty ? (raw) => ctx.mirrorPty.onRawData(raw) : undefined, ctx.mirrorPty ? (fn) => ctx.mirrorPty.onPtyReady(fn) : undefined));
        },
    });
}
function streamLlamacppMsg(ctx, msg, assistantId) {
    const contextMessages = contextPrefixMessages(msg._contextPrefix);
    const trimmed = (0, streamUtils_1.trimHistoryToFit)(ctx.state.llamacppHistory, msg.text, [AGENTIC_SYSTEM, ...contextMessages]);
    const requestHistory = [AGENTIC_SYSTEM, ...contextMessages, ...trimmed, { role: "user", content: msg.text }];
    runStream({
        ctx, assistantId, route: "local",
        start: (h) => {
            const onDone = () => {
                if (h.isAborted())
                    return;
                finalizeStream(h, ctx, assistantId, "local", { pushLlamacpp: true, userText: msg.text, model: msg.llamacppModel });
                h.safeEnd();
            };
            h.setCancel((0, router_1.streamLlamacppAgentic)(requestHistory, (0, msgHelpers_1.llamacppOptsFromMsg)(msg), ctx.projectRoot, h.onChunk, onDone, (err) => {
                if (!h.isEnded()) {
                    h.postStreamEnd();
                    h.safeEnd();
                }
                ctx.postError("local", err);
            }));
        },
    });
}
function streamHybridMsg(ctx, msg, assistantId) {
    const contextMessages = contextPrefixMessages(msg._contextPrefix);
    const trimmed = (0, streamUtils_1.trimHistoryToFit)(ctx.state.llamacppHistory, msg.text, [AGENTIC_SYSTEM, ...contextMessages]);
    const history = [...contextMessages, ...trimmed];
    // Migrated to RouterAdapter: error / cancel / done are normalized in
    // a single Promise<StreamResult> so the harness sees one shape
    // regardless of backend. Compare to streamClaudeMsg + streamLlamacppMsg
    // for the legacy callback patterns those routes still use.
    runStream({
        ctx, assistantId, route: "hybrid",
        preludeChunk: "[HME] Enriching with KB context…",
        start: (h) => {
            const handle = router_1.hybridAdapter.stream({ message: msg.text, history, workingDir: ctx.projectRoot }, {
                onChunk: h.onChunk,
                llamacpp: (0, msgHelpers_1.llamacppOptsFromMsg)(msg),
            });
            h.setCancel(() => handle.cancel());
            handle.done.then((result) => {
                if (h.isAborted())
                    return;
                if (!result.ok) {
                    if (!h.isEnded()) {
                        h.postStreamEnd();
                        h.safeEnd();
                    }
                    ctx.postError("hybrid", result.error ?? "unknown error");
                    return;
                }
                finalizeStream(h, ctx, assistantId, "hybrid", { pushLlamacpp: true, userText: msg.text, model: msg.llamacppModel });
                h.safeEnd();
            }).catch((err) => {
                // RouterAdapter contract says result.error carries failures, not
                // a rejected promise — but defend against legacy implementations
                // that might still throw.
                if (!h.isEnded()) {
                    h.postStreamEnd();
                    h.safeEnd();
                }
                ctx.postError("hybrid", String(err?.message ?? err));
            });
        },
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
