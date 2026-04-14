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
exports.streamOllamaMsg = streamOllamaMsg;
exports.streamHybridMsg = streamHybridMsg;
exports.streamAgentMsg = streamAgentMsg;
exports.streamAgentHybridMsg = streamAgentHybridMsg;
const path = __importStar(require("path"));
const router_1 = require("./router");
const streamUtils_1 = require("./streamUtils");
const msgHelpers_1 = require("./msgHelpers");
// ── Helpers ───────────────────────────────────────────────────────────────────
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
        const ollamaMatch = t.match(/\[(write_file|read_file|bash)\]\s*\{[^}]*"path"\s*:\s*"([^"]+)"/);
        if (ollamaMatch)
            files.add(ollamaMatch[2]);
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
    };
    if (opts.preludeChunk) {
        ctx.post({ type: "streamChunk", id: assistantId, chunkType: "tool", chunk: opts.preludeChunk });
        acc.append("tool", opts.preludeChunk);
    }
    let cancelFn;
    const setCancel = (fn) => { cancelFn = fn; };
    if (opts.ownCancel ?? true) {
        ctx.setCancelCurrent(() => { aborted = true; cancelFn?.(); });
    }
    // start() may assign cancel synchronously or via a promise; we expose a mutable setter.
    handle.setCancel = setCancel;
    opts.start(handle);
    return {
        cancel: () => { aborted = true; cancelFn?.(); },
        handle,
    };
}
/** Build a ChatMessage from the captured chunk state. */
function toFinalMessage(assistantId, route, state, acc, includeThinking = false) {
    const msg = {
        id: assistantId, role: "assistant", text: state.text,
        tools: state.tools.length ? state.tools : undefined,
        blocks: acc.blocks.length ? acc.blocks : undefined,
        route, ts: Date.now(),
    };
    if (includeThinking && state.thinking)
        msg.thinking = state.thinking;
    return msg;
}
/** Common finalize side-effects (reindex + audit), optionally pushing to ollamaHistory. */
function finalizeSideEffects(ctx, state, route, model, pushOllama, userText) {
    if (pushOllama && userText !== undefined) {
        ctx.state.ollamaHistory.push({ role: "user", content: userText });
        ctx.state.ollamaHistory.push({ role: "assistant", content: state.text });
    }
    ctx.transcript.logAssistant(state.text, route, model, state.tools);
    mirrorAssistantToShim(ctx, state.text, route, model, state.tools);
    const changedFiles = reindexFromTools(state.tools);
    runPostAudit(ctx, changedFiles);
}
// ── Streaming methods ─────────────────────────────────────────────────────────
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
    runStream({
        ctx, assistantId, route,
        start: (h) => {
            const onDone = (usage) => {
                if (h.isAborted())
                    return;
                ctx.updateContextTracker(h.state.text, h.state.thinking, msg.claudeModel, usage);
                h.tracker.finalize(toFinalMessage(assistantId, route, h.state, h.acc, true));
                h.postStreamEnd();
                finalizeSideEffects(ctx, h.state, route, msg.claudeModel, false);
                ctx.checkChainThreshold(msg);
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
            const setCancel = h.setCancel;
            setCancel((0, router_1.streamClaudePty)(effectiveText, ctx.state.claudeSessionId, claudeOpts, ctx.projectRoot, h.onChunk, (sessionId) => { ctx.state.claudeSessionId = sessionId; }, onDone, (err) => {
                console.log(`[HME Chat] PTY unavailable (${err}), falling back to -p mode`);
                setCancel(startPipe());
            }, ctx.mirrorPty ? (raw) => ctx.mirrorPty.onRawData(raw) : undefined, ctx.mirrorPty ? (fn) => ctx.mirrorPty.onPtyReady(fn) : undefined));
        },
    });
}
function streamOllamaMsg(ctx, msg, assistantId) {
    const contextMessages = contextPrefixMessages(msg._contextPrefix);
    const trimmed = (0, streamUtils_1.trimHistoryToFit)(ctx.state.ollamaHistory, msg.text, [AGENTIC_SYSTEM, ...contextMessages]);
    const requestHistory = [AGENTIC_SYSTEM, ...contextMessages, ...trimmed, { role: "user", content: msg.text }];
    runStream({
        ctx, assistantId, route: "local",
        start: (h) => {
            const onDone = () => {
                if (h.isAborted())
                    return;
                h.tracker.finalize(toFinalMessage(assistantId, "local", h.state, h.acc));
                h.postStreamEnd();
                finalizeSideEffects(ctx, h.state, "local", msg.ollamaModel, true, msg.text);
                h.safeEnd();
            };
            const setCancel = h.setCancel;
            setCancel((0, router_1.streamOllamaAgentic)(requestHistory, (0, msgHelpers_1.ollamaOptsFromMsg)(msg), ctx.projectRoot, h.onChunk, onDone, (err) => {
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
    const history = [...contextMessages, ...ctx.state.ollamaHistory];
    runStream({
        ctx, assistantId, route: "hybrid",
        preludeChunk: "[HME] Enriching with KB context…",
        start: (h) => {
            const setCancel = h.setCancel;
            const onDone = () => {
                if (h.isAborted())
                    return;
                h.tracker.finalize(toFinalMessage(assistantId, "hybrid", h.state, h.acc));
                h.postStreamEnd();
                finalizeSideEffects(ctx, h.state, "hybrid", msg.ollamaModel, true, msg.text);
                h.safeEnd();
            };
            const onError = (err) => {
                if (h.isAborted())
                    return;
                if (!h.isEnded()) {
                    h.postStreamEnd();
                    h.safeEnd();
                }
                ctx.postError("hybrid", err);
            };
            (0, router_1.streamHybrid)(msg.text, history, (0, msgHelpers_1.ollamaOptsFromMsg)(msg), ctx.projectRoot, h.onChunk, onDone, onError).then((cancel) => {
                if (h.isAborted()) {
                    cancel();
                    return;
                }
                setCancel(cancel);
            }).catch((err) => {
                if (h.isAborted())
                    return;
                if (!h.isEnded()) {
                    h.postStreamEnd();
                    h.safeEnd();
                }
                ctx.postError("hybrid", String(err));
            });
        },
    });
}
function streamAgentMsg(ctx, msg, assistantId, label, onBothDone, onForceDrain, cancelFns) {
    const trimmed = (0, streamUtils_1.trimHistoryToFit)(ctx.state.ollamaHistory, msg.text, [AGENTIC_SYSTEM]);
    const requestHistory = [AGENTIC_SYSTEM, ...trimmed, { role: "user", content: msg.text }];
    const { cancel } = runStream({
        ctx, assistantId, route: label,
        ownCancel: false, drainOnEnd: false, onEnd: onBothDone,
        start: (h) => {
            const onDone = () => {
                if (h.isAborted())
                    return;
                if (label === "local") {
                    ctx.state.ollamaHistory.push({ role: "user", content: msg.text });
                    ctx.state.ollamaHistory.push({ role: "assistant", content: h.state.text });
                }
                h.tracker.finalize(toFinalMessage(assistantId, label, h.state, h.acc));
                h.postStreamEnd();
                ctx.transcript.logAssistant(h.state.text, label, msg.ollamaModel, h.state.tools);
                const changedFiles = reindexFromTools(h.state.tools);
                runPostAudit(ctx, changedFiles);
                h.safeEnd();
            };
            const setCancel = h.setCancel;
            setCancel((0, router_1.streamOllamaAgentic)(requestHistory, (0, msgHelpers_1.ollamaOptsFromMsg)(msg), ctx.projectRoot, h.onChunk, onDone, (err) => {
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
    const history = (0, streamUtils_1.trimHistoryToFit)(ctx.state.ollamaHistory, msg.text);
    const { cancel } = runStream({
        ctx, assistantId, route: "hybrid",
        preludeChunk: "[HME] Enriching with KB context…",
        ownCancel: false, drainOnEnd: false, onEnd: onBothDone,
        start: (h) => {
            const setCancel = h.setCancel;
            const onDone = () => {
                if (h.isAborted())
                    return;
                h.tracker.finalize(toFinalMessage(assistantId, "hybrid", h.state, h.acc));
                h.postStreamEnd();
                ctx.transcript.logAssistant(h.state.text, "hybrid", msg.ollamaModel, h.state.tools);
                const changedFiles = reindexFromTools(h.state.tools);
                runPostAudit(ctx, changedFiles);
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
            (0, router_1.streamHybrid)(msg.text, history, (0, msgHelpers_1.ollamaOptsFromMsg)(msg), ctx.projectRoot, h.onChunk, onDone, onError).then((c) => {
                if (h.isAborted()) {
                    c();
                    return;
                }
                setCancel(c);
            }).catch((err) => {
                if (h.isAborted())
                    return;
                ctx.postError(label, String(err));
                if (h.isEnded())
                    return;
                h.markEnded();
                h.postStreamEnd();
                onForceDrain();
            });
        },
    });
    cancelFns.push(cancel);
}
