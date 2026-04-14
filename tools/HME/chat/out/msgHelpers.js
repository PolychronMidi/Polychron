"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OLLAMA_URL = void 0;
exports.claudeOptsFromMsg = claudeOptsFromMsg;
exports.ollamaOptsFromMsg = ollamaOptsFromMsg;
exports.OLLAMA_URL = "http://localhost:11434";
function claudeOptsFromMsg(msg) {
    return {
        model: msg.claudeModel,
        effort: msg.claudeEffort,
        thinking: msg.claudeThinking,
        permissionMode: "bypassPermissions",
    };
}
function ollamaOptsFromMsg(msg) {
    return { model: msg.ollamaModel, url: exports.OLLAMA_URL };
}
