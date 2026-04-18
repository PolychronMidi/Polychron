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
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const SessionStore_1 = require("../session/SessionStore");
const Arbiter_1 = require("../Arbiter");
const chatChain_1 = require("../session/chatChain");
const streamUtils_1 = require("../streamUtils");
// Fire chain at 99% — meter reaches this before autocompact kicks in.
exports.CHAIN_THRESHOLD_PCT = 99;
class ChainPerformer {
    constructor(projectRoot, host, session) {
        this.projectRoot = projectRoot;
        this.host = host;
        this.session = session;
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
        if (this.session.getContextPct() < exports.CHAIN_THRESHOLD_PCT)
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
