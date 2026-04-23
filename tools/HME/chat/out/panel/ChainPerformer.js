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
exports.ChainPerformer = exports.CHAIN_THRESHOLD_PCT = void 0;
exports.resolveChainThresholdPct = resolveChainThresholdPct;
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const SessionStore_1 = require("../session/SessionStore");
const Arbiter_1 = require("../Arbiter");
const chatChain_1 = require("../session/chatChain");
const streamUtils_1 = require("../streamUtils");
// Fire chain at a per-model percentage. Smaller models (200k context,
// Sonnet default) need to rotate earlier because absolute headroom is
// tiny: 15% of 200k = 30k tokens, which is the minimum for Stage 1A+1B
// extract + Stage 2 synthesis. Larger models (1M context, Sonnet 1M or
// Opus 1M) can rotate later because 10% of 1M = 100k tokens is plenty.
// Auto-compaction by Claude Code fires at ~92-95%, so the threshold
// must stay below that regardless of model size.
exports.CHAIN_THRESHOLD_PCT = 85; // legacy constant — still exported for compatibility
/** Resolve per-model chain-rotation threshold. Model id is the full
 *  CLI key from token usage (e.g. "claude-sonnet-4-6", "claude-opus-4-7-1m").
 *  Returns percentage-of-context at which rotation should fire. */
function resolveChainThresholdPct(modelId) {
    if (!modelId)
        return exports.CHAIN_THRESHOLD_PCT;
    const lower = modelId.toLowerCase();
    // 1M-context variants: rotate later because absolute headroom is large.
    if (lower.includes("1m") || lower.includes("-1m") || lower.includes("_1m")) {
        return 90;
    }
    // Opus with default context is ~200k.
    if (lower.includes("opus")) {
        return 82;
    }
    // Sonnet default (200k) and everything else.
    return exports.CHAIN_THRESHOLD_PCT;
}
class ChainPerformer {
    constructor(projectRoot, host, session, errorSink) {
        this.projectRoot = projectRoot;
        this.host = host;
        this.session = session;
        this.errorSink = errorSink;
        this._inProgress = false;
    }
    get inProgress() {
        return this._inProgress;
    }
    /**
     * If context pct has crossed the chain threshold and no chain is already
     * running, synthesize a chain link summary and rotate the session.
     */
    maybeChain() {
        if (!this.session.hasMeterLiveUpdate())
            return;
        const pct = this.session.getContextPct();
        // Fail-fast against fabricated percentages. A healthy meter reads in
        // [0, 100]; values above that are the exact bug class that caused a
        // premature chain fire on turn 1 (1456% from a 1M/200k mismatch).
        // Refuse to rotate on an impossible reading — log loudly and return.
        if (!Number.isFinite(pct) || pct < 0 || pct > 110) {
            const msg = `maybeChain refusing to fire with out-of-range pct=${pct}. ` +
                `Upstream computeTurnUsage and ContextMeter.update should have dropped this — ` +
                `investigate the token-accounting path.`;
            console.error(`[HME Chat] ${msg}`);
            if (this.errorSink)
                this.errorSink.post("ChainPerformer.maybeChain", msg);
            this.host.postError("chain", `invalid context pct=${pct} — chain suppressed`);
            return;
        }
        const threshold = resolveChainThresholdPct(this.session.getModelId());
        if (pct < threshold)
            return;
        if (this._inProgress)
            return;
        this._performChain().catch((e) => {
            console.error(`[HME Chat] Chain failed: ${e}`);
            this.host.postError("chain", String(e));
            this._inProgress = false;
        });
    }
    async _performChain() {
        const sessionId = this.session.getSessionId();
        if (!sessionId || this._inProgress)
            return;
        this._inProgress = true;
        try {
            await this._performChainInner(sessionId);
        }
        finally {
            this._inProgress = false;
        }
    }
    async _performChainInner(sessionId) {
        const linkIndex = this.session.getChainIndex();
        this.host.post({
            type: "notice", level: "info",
            text: `Context chain: saving link ${linkIndex + 1} and generating summary...`,
        });
        const todos = this._loadTodos();
        const priorSummaries = (0, SessionStore_1.loadChainSummaries)(this.projectRoot, sessionId);
        const messages = this.session.getMessages();
        const summaryPrompt = (0, chatChain_1.buildSummaryPrompt)(messages, todos, priorSummaries);
        let summary = "";
        try {
            summary = await (0, Arbiter_1.synthesizeChainSummary)(summaryPrompt);
        }
        catch (e) {
            console.error(`[HME Chat] Chain summary via local model failed: ${e}`);
            summary = (0, chatChain_1.buildFallbackSummary)(messages, todos, priorSummaries);
        }
        const link = {
            index: linkIndex,
            sessionId,
            messages: [...messages],
            summary,
            todos,
            contextTokens: this.session.getContextPct(),
            claudeSessionId: this.session.getClaudeSessionId(),
            createdAt: Date.now(),
        };
        (0, SessionStore_1.saveChainLink)(this.projectRoot, link);
        const continuationMsg = {
            id: (0, streamUtils_1.uid)(),
            role: "user",
            text: `[Context Chain — Link ${linkIndex + 1} continuation]\n\n${summary}`,
            route: "claude",
            ts: Date.now(),
        };
        const newChainIndex = linkIndex + 1;
        this.session.rotate(continuationMsg, newChainIndex);
        this.host.post({ type: "chainCompleted", linkIndex, chainIndex: newChainIndex });
        this.host.post({
            type: "notice", level: "info",
            text: `Context chain: link ${linkIndex + 1} saved. Fresh context resumed.`,
        });
        this.session.postContextUpdate();
    }
    _loadTodos() {
        try {
            // Project-local todo store. todo.py writes tools/HME/KB/todos.json.
            const todoPath = path.join(this.projectRoot, "tools", "HME", "KB", "todos.json");
            return JSON.parse(fs.readFileSync(todoPath, "utf8"));
        }
        catch (e) {
            if (e?.code !== "ENOENT")
                console.error(`[HME] Failed to load todos.json: ${e?.message ?? e}`);
            return [];
        }
    }
}
exports.ChainPerformer = ChainPerformer;
