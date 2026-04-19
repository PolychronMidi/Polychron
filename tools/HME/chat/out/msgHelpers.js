"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LLAMACPP_URL = void 0;
exports.validateClaudeConfig = validateClaudeConfig;
exports.resolveClaudeConfig = resolveClaudeConfig;
exports.claudeOptsFromConfig = claudeOptsFromConfig;
exports.claudeOptsFromMsg = claudeOptsFromMsg;
exports.llamacppOptsFromMsg = llamacppOptsFromMsg;
exports.LLAMACPP_URL = process.env.HME_LLAMACPP_ARBITER_URL ?? "http://127.0.0.1:8080";
//  Claude config validation & resolution ─
//
// Claude CLI flags (verified from `claude --help`):
//   --model <alias|id>   opus | sonnet | haiku
//   --effort <level>     low | medium | high | xhigh | max
//   --settings <json>    inline JSON; supports { "alwaysThinkingEnabled": boolean }
//
// Thinking is **independent** of effort. The checkbox toggles alwaysThinkingEnabled
// at any effort level. We do not munge effort based on the thinking state.
const VALID_MODEL_ALIASES = new Set(["opus", "sonnet", "haiku"]);
const VALID_EFFORTS = new Set(["low", "medium", "high", "max"]);
const MODEL_ID_MAP = {
    opus: "opus",
    sonnet: "sonnet",
    haiku: "haiku",
};
/** Throws on invalid config. Haiku has no effort/thinking controls in the UI. */
function validateClaudeConfig(cfg) {
    if (!cfg.model || !VALID_MODEL_ALIASES.has(cfg.model)) {
        throw new Error(`Invalid claude model: ${JSON.stringify(cfg.model)} (expected opus|sonnet|haiku)`);
    }
    if (typeof cfg.thinking !== "boolean") {
        throw new Error(`Invalid claude thinking: ${JSON.stringify(cfg.thinking)} (expected boolean)`);
    }
    if (cfg.model === "haiku") {
        // Haiku hides effort/thinking in the UI — store canonical values server-side.
        return { model: "haiku", effort: "medium", thinking: false };
    }
    if (!cfg.effort || !VALID_EFFORTS.has(cfg.effort)) {
        throw new Error(`Invalid claude effort: ${JSON.stringify(cfg.effort)} (expected low|medium|high|max)`);
    }
    return { model: cfg.model, effort: cfg.effort, thinking: cfg.thinking };
}
function resolveClaudeConfig(cfg) {
    const modelId = MODEL_ID_MAP[cfg.model];
    if (!modelId)
        throw new Error(`Unmapped model alias: ${cfg.model}`);
    return { alias: cfg.model, modelId, cliEffort: cfg.effort, thinking: cfg.thinking };
}
function claudeOptsFromConfig(resolved) {
    return {
        model: resolved.modelId,
        effort: resolved.cliEffort,
        thinking: resolved.thinking,
        permissionMode: "bypassPermissions",
    };
}
function claudeOptsFromMsg(msg) {
    const cfg = validateClaudeConfig({
        model: msg.claudeModel,
        effort: msg.claudeEffort,
        thinking: msg.claudeThinking,
    });
    return claudeOptsFromConfig(resolveClaudeConfig(cfg));
}
function llamacppOptsFromMsg(msg) {
    return { model: msg.llamacppModel, url: exports.LLAMACPP_URL };
}
