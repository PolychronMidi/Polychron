"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContextMeter = void 0;
const SessionStore_1 = require("../SessionStore");
class ContextMeter {
    constructor(projectRoot, host) {
        this.projectRoot = projectRoot;
        this.host = host;
        this._tracker = ContextMeter._blank();
    }
    static _blank() {
        return {
            lastInputTokens: null, lastOutputTokens: null, usedPct: null,
            totalChars: 0, model: "", cliModelId: null, cliModelName: null,
        };
    }
    get pctUsed() {
        return this._tracker.usedPct ?? 0;
    }
    reset(args, restoredPct) {
        this._tracker = ContextMeter._blank();
        if (restoredPct)
            this._tracker.usedPct = restoredPct;
        this.post(args);
    }
    /**
     * Clear the tracker without posting. Caller is responsible for posting
     * an update when it wants the webview to see the cleared state.
     */
    resetSilently() {
        this._tracker = ContextMeter._blank();
    }
    update(text, thinking, model, usage, args) {
        this._tracker.model = model;
        this._tracker.totalChars += text.length + (thinking?.length ?? 0);
        if (usage) {
            this._tracker.lastInputTokens = usage.inputTokens;
            this._tracker.lastOutputTokens = usage.outputTokens;
            if (usage.usedPct != null)
                this._tracker.usedPct = usage.usedPct;
            if (usage.modelId)
                this._tracker.cliModelId = usage.modelId;
            if (usage.modelName)
                this._tracker.cliModelName = usage.modelName;
        }
        this.post(args);
    }
    post(args) {
        const chainLinkCount = args.sessionId
            ? (0, SessionStore_1.listChainLinks)(this.projectRoot, args.sessionId).length
            : 0;
        this.host.post({
            type: "contextUpdate",
            pct: this.pctUsed,
            chainLinks: chainLinkCount,
            chainIndex: args.chainIndex,
            cliModel: this._tracker.cliModelName || this._tracker.cliModelId || undefined,
        });
    }
}
exports.ContextMeter = ContextMeter;
