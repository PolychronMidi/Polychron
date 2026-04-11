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
        (0, router_1.reindexFiles)(indexable).catch(() => { });
    }
    return files;
}
function runPostAudit(ctx, changedFiles) {
    const filesArg = changedFiles?.size ? [...changedFiles].join(",") : "";
    (0, router_1.auditChanges)(filesArg).then(({ violations, changed_files }) => {
        ctx.transcript.logAudit(changed_files.length, violations.length);
        if (violations.length > 0) {
            const summary = violations
                .map((v) => `• [${v.category}] ${v.file}: ${v.title}`)
                .join("\n");
            ctx.post({ type: "notice", level: "audit", text: `HME post-audit (${changed_files.length} files changed):\n${summary}` });
        }
    }).catch((e) => ctx.postError("audit", String(e)));
}
// ── Streaming methods ─────────────────────────────────────────────────────────
const AGENTIC_SYSTEM = {
    role: "system",
    content: "You are an agentic coding assistant with access to bash, read_file, and write_file tools. When asked to perform a task — create files, edit code, run commands, implement features — call the appropriate tool immediately. Never respond with suggestions, plans, or code blocks without calling a tool first.",
};
function streamClaudeMsg(ctx, msg, assistantId) {
    let text = "";
    let thinking = "";
    let tools = [];
    const acc = (0, streamUtils_1.makeBlockAccumulator)();
    let streamEnded = false;
    let aborted = false;
    const tracker = ctx.trackStream(assistantId, msg._resolvedRoute ?? msg.route);
    const safeEnd = () => { if (!streamEnded) {
        streamEnded = true;
        ctx.drainQueue();
    } };
    const onDone = (usage) => {
        if (aborted)
            return;
        ctx.updateContextTracker(text, thinking, msg.claudeModel, usage);
        const assistantMsg = {
            id: assistantId, role: "assistant", text,
            thinking: thinking || undefined,
            tools: tools.length ? tools : undefined,
            blocks: acc.blocks.length ? acc.blocks : undefined,
            route: msg._resolvedRoute ?? msg.route,
            ts: Date.now(),
        };
        tracker.finalize(assistantMsg);
        ctx.post({ type: "streamEnd", id: assistantId });
        ctx.transcript.logAssistant(text, msg._resolvedRoute ?? msg.route ?? "claude", msg.claudeModel, tools);
        mirrorAssistantToShim(ctx, text, msg._resolvedRoute ?? msg.route ?? "claude", msg.claudeModel, tools);
        const changedFiles = reindexFromTools(tools);
        runPostAudit(ctx, changedFiles);
        ctx.checkChainThreshold(msg);
        safeEnd();
    };
    const onChunk = (chunk, type) => {
        if (aborted)
            return;
        if (type === "text") {
            text += chunk;
            acc.append("text", chunk);
            ctx.post({ type: "streamChunk", id: assistantId, chunkType: "text", chunk });
        }
        else if (type === "thinking") {
            thinking += chunk;
            acc.append("thinking", chunk);
            ctx.post({ type: "streamChunk", id: assistantId, chunkType: "thinking", chunk });
        }
        else if (type === "tool") {
            tools.push(chunk);
            acc.append("tool", chunk);
            ctx.post({ type: "streamChunk", id: assistantId, chunkType: "tool", chunk });
            ctx.transcript.logToolCall(chunk.split("]")[0].replace("[", ""), chunk, msg._resolvedRoute ?? msg.route ?? "claude");
        }
        else if (type === "error") {
            ctx.postError("claude", chunk);
        }
        tracker.update(text, tools, thinking);
    };
    const onError = (err) => {
        if (aborted)
            return;
        if (!streamEnded) {
            ctx.post({ type: "streamEnd", id: assistantId });
            safeEnd();
        }
        ctx.postError("claude", err);
    };
    const effectiveText = (msg._contextPrefix ?? "") + msg.text;
    let cancelFn;
    ctx.setCancelCurrent(() => { aborted = true; cancelFn?.(); });
    cancelFn = (0, router_1.streamClaudePty)(effectiveText, ctx.state.claudeSessionId, { model: msg.claudeModel, effort: msg.claudeEffort, thinking: msg.claudeThinking, permissionMode: "bypassPermissions" }, ctx.projectRoot, onChunk, (sessionId) => { ctx.state.claudeSessionId = sessionId; }, onDone, (err) => {
        console.log(`[HME Chat] PTY unavailable (${err}), falling back to -p mode`);
        cancelFn = (0, router_1.streamClaude)(effectiveText, ctx.state.claudeSessionId, { model: msg.claudeModel, effort: msg.claudeEffort, thinking: msg.claudeThinking, permissionMode: "bypassPermissions" }, ctx.projectRoot, onChunk, (sessionId) => { ctx.state.claudeSessionId = sessionId; }, (_cost, usage) => { onDone(usage); }, onError);
    });
}
function streamOllamaMsg(ctx, msg, assistantId) {
    const contextMessages = msg._contextPrefix
        ? [{ role: "user", content: msg._contextPrefix }, { role: "assistant", content: "Understood. I have the prior conversation context." }]
        : [];
    const trimmed = (0, streamUtils_1.trimHistoryToFit)(ctx.state.ollamaHistory, msg.text, [AGENTIC_SYSTEM, ...contextMessages]);
    const requestHistory = [AGENTIC_SYSTEM, ...contextMessages, ...trimmed, { role: "user", content: msg.text }];
    let text = "";
    let tools = [];
    const acc = (0, streamUtils_1.makeBlockAccumulator)();
    let streamEnded = false;
    let aborted = false;
    const tracker = ctx.trackStream(assistantId, "local");
    const safeEnd = () => { if (!streamEnded) {
        streamEnded = true;
        ctx.drainQueue();
    } };
    const onDone = () => {
        if (aborted)
            return;
        ctx.state.ollamaHistory.push({ role: "user", content: msg.text });
        ctx.state.ollamaHistory.push({ role: "assistant", content: text });
        tracker.finalize({
            id: assistantId, role: "assistant", text,
            tools: tools.length ? tools : undefined,
            blocks: acc.blocks.length ? acc.blocks : undefined,
            route: "local", ts: Date.now(),
        });
        ctx.post({ type: "streamEnd", id: assistantId });
        ctx.transcript.logAssistant(text, "local", msg.ollamaModel, tools);
        mirrorAssistantToShim(ctx, text, "local", msg.ollamaModel, tools);
        const changedFiles = reindexFromTools(tools);
        runPostAudit(ctx, changedFiles);
        safeEnd();
    };
    const onChunk = (chunk, type) => {
        if (aborted)
            return;
        if (type === "tool") {
            tools.push(chunk);
            acc.append("tool", chunk);
            ctx.post({ type: "streamChunk", id: assistantId, chunkType: "tool", chunk });
            ctx.transcript.logToolCall(chunk.split("]")[0].replace("[", ""), chunk, "local");
        }
        else {
            text += chunk;
            acc.append(type === "thinking" ? "thinking" : "text", chunk);
            ctx.post({ type: "streamChunk", id: assistantId, chunkType: type, chunk });
        }
        tracker.update(text, tools);
    };
    let ollamaCancelFn;
    ctx.setCancelCurrent(() => { aborted = true; ollamaCancelFn?.(); });
    ollamaCancelFn = (0, router_1.streamOllamaAgentic)(requestHistory, { model: msg.ollamaModel, url: "http://localhost:11434" }, ctx.projectRoot, onChunk, onDone, (err) => {
        if (!streamEnded) {
            ctx.post({ type: "streamEnd", id: assistantId });
            safeEnd();
        }
        ctx.postError("local", err);
    });
}
function streamHybridMsg(ctx, msg, assistantId) {
    const contextMessages = msg._contextPrefix
        ? [{ role: "user", content: msg._contextPrefix }, { role: "assistant", content: "Understood. I have the prior conversation context." }]
        : [];
    const history = [...contextMessages, ...ctx.state.ollamaHistory];
    let text = "";
    let tools = [];
    const acc = (0, streamUtils_1.makeBlockAccumulator)();
    let cancelFn;
    let aborted = false;
    let streamEnded = false;
    const tracker = ctx.trackStream(assistantId, "hybrid");
    const safeEnd = () => { if (!streamEnded) {
        streamEnded = true;
        ctx.drainQueue();
    } };
    ctx.setCancelCurrent(() => { aborted = true; cancelFn?.(); });
    ctx.post({ type: "streamChunk", id: assistantId, chunkType: "tool", chunk: "[HME] Enriching with KB context…" });
    acc.append("tool", "[HME] Enriching with KB context…");
    (0, router_1.streamHybrid)(msg.text, history, { model: msg.ollamaModel, url: "http://localhost:11434" }, ctx.projectRoot, (chunk, type) => {
        if (aborted)
            return;
        if (type === "tool") {
            tools.push(chunk);
            acc.append("tool", chunk);
            ctx.post({ type: "streamChunk", id: assistantId, chunkType: "tool", chunk });
            ctx.transcript.logToolCall(chunk.split("]")[0].replace("[", ""), chunk, "hybrid");
        }
        else {
            text += chunk;
            acc.append(type === "thinking" ? "thinking" : "text", chunk);
            ctx.post({ type: "streamChunk", id: assistantId, chunkType: type, chunk });
        }
        tracker.update(text, tools);
    }, () => {
        if (aborted)
            return;
        ctx.state.ollamaHistory.push({ role: "user", content: msg.text });
        ctx.state.ollamaHistory.push({ role: "assistant", content: text });
        tracker.finalize({
            id: assistantId, role: "assistant", text,
            tools: tools.length ? tools : undefined,
            blocks: acc.blocks.length ? acc.blocks : undefined,
            route: "hybrid", ts: Date.now(),
        });
        ctx.post({ type: "streamEnd", id: assistantId });
        ctx.transcript.logAssistant(text, "hybrid", msg.ollamaModel, tools);
        mirrorAssistantToShim(ctx, text, "hybrid", msg.ollamaModel, tools);
        const changedFiles = reindexFromTools(tools);
        runPostAudit(ctx, changedFiles);
        safeEnd();
    }, (err) => {
        if (aborted)
            return;
        if (!streamEnded) {
            ctx.post({ type: "streamEnd", id: assistantId });
            safeEnd();
        }
        ctx.postError("hybrid", err);
    }).then((cancel) => {
        if (aborted) {
            cancel();
            return;
        }
        cancelFn = cancel;
    }).catch((err) => {
        if (aborted)
            return;
        if (!streamEnded) {
            ctx.post({ type: "streamEnd", id: assistantId });
            safeEnd();
        }
        ctx.postError("hybrid", String(err));
    });
}
function streamAgentMsg(ctx, msg, assistantId, label, onBothDone, onForceDrain, cancelFns) {
    const trimmed = (0, streamUtils_1.trimHistoryToFit)(ctx.state.ollamaHistory, msg.text, [AGENTIC_SYSTEM]);
    const requestHistory = [AGENTIC_SYSTEM, ...trimmed, { role: "user", content: msg.text }];
    let text = "";
    let tools = [];
    const acc = (0, streamUtils_1.makeBlockAccumulator)();
    let streamEnded = false;
    const tracker = ctx.trackStream(assistantId, label);
    const safeEnd = () => { if (!streamEnded) {
        streamEnded = true;
        onBothDone();
    } };
    const onDone = () => {
        if (label === "local") {
            ctx.state.ollamaHistory.push({ role: "user", content: msg.text });
            ctx.state.ollamaHistory.push({ role: "assistant", content: text });
        }
        tracker.finalize({
            id: assistantId, role: "assistant", text,
            tools: tools.length ? tools : undefined,
            blocks: acc.blocks.length ? acc.blocks : undefined,
            route: label, ts: Date.now(),
        });
        ctx.post({ type: "streamEnd", id: assistantId });
        ctx.transcript.logAssistant(text, label, msg.ollamaModel, tools);
        const changedFiles = reindexFromTools(tools);
        runPostAudit(ctx, changedFiles);
        safeEnd();
    };
    const onChunk = (chunk, type) => {
        if (type === "tool") {
            tools.push(chunk);
            acc.append("tool", chunk);
            ctx.post({ type: "streamChunk", id: assistantId, chunkType: "tool", chunk });
            ctx.transcript.logToolCall(chunk.split("]")[0].replace("[", ""), chunk, label);
        }
        else {
            text += chunk;
            acc.append(type === "thinking" ? "thinking" : "text", chunk);
            ctx.post({ type: "streamChunk", id: assistantId, chunkType: type, chunk });
        }
        tracker.update(text, tools);
    };
    const cancel = (0, router_1.streamOllamaAgentic)(requestHistory, { model: msg.ollamaModel, url: "http://localhost:11434" }, ctx.projectRoot, onChunk, onDone, (err) => {
        ctx.postError(label, err);
        if (!streamEnded) {
            streamEnded = true;
            ctx.post({ type: "streamEnd", id: assistantId });
            onForceDrain();
        }
    });
    cancelFns.push(cancel);
}
function streamAgentHybridMsg(ctx, msg, assistantId, label, onBothDone, onForceDrain, cancelFns) {
    const history = (0, streamUtils_1.trimHistoryToFit)(ctx.state.ollamaHistory, msg.text);
    let text = "";
    let tools = [];
    const acc = (0, streamUtils_1.makeBlockAccumulator)();
    let aborted = false;
    let streamEnded = false;
    const tracker = ctx.trackStream(assistantId, "hybrid");
    const safeEnd = () => { if (!streamEnded) {
        streamEnded = true;
        onBothDone();
    } };
    cancelFns.push(() => { aborted = true; });
    ctx.post({ type: "streamChunk", id: assistantId, chunkType: "tool", chunk: "[HME] Enriching with KB context…" });
    acc.append("tool", "[HME] Enriching with KB context…");
    (0, router_1.streamHybrid)(msg.text, history, { model: msg.ollamaModel, url: "http://localhost:11434" }, ctx.projectRoot, (chunk, type) => {
        if (aborted)
            return;
        if (type === "tool") {
            tools.push(chunk);
            acc.append("tool", chunk);
            ctx.post({ type: "streamChunk", id: assistantId, chunkType: "tool", chunk });
            ctx.transcript.logToolCall(chunk.split("]")[0].replace("[", ""), chunk, "hybrid");
        }
        else {
            text += chunk;
            acc.append(type === "thinking" ? "thinking" : "text", chunk);
            ctx.post({ type: "streamChunk", id: assistantId, chunkType: type, chunk });
        }
        tracker.update(text, tools);
    }, () => {
        if (aborted)
            return;
        tracker.finalize({
            id: assistantId, role: "assistant", text,
            tools: tools.length ? tools : undefined,
            blocks: acc.blocks.length ? acc.blocks : undefined,
            route: "hybrid", ts: Date.now(),
        });
        ctx.post({ type: "streamEnd", id: assistantId });
        ctx.transcript.logAssistant(text, "hybrid", msg.ollamaModel, tools);
        const changedFiles = reindexFromTools(tools);
        runPostAudit(ctx, changedFiles);
        safeEnd();
    }, (err) => {
        if (aborted)
            return;
        ctx.postError(label, err);
        if (!streamEnded) {
            streamEnded = true;
            ctx.post({ type: "streamEnd", id: assistantId });
            onForceDrain();
        }
    }).then((cancel) => {
        if (aborted) {
            cancel();
            return;
        }
        cancelFns.push(cancel);
    }).catch((err) => {
        if (aborted)
            return;
        ctx.postError(label, String(err));
        if (!streamEnded) {
            streamEnded = true;
            ctx.post({ type: "streamEnd", id: assistantId });
            onForceDrain();
        }
    });
}
