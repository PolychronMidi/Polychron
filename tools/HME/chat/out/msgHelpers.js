"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LLAMACPP_URL = void 0;
exports.claudeOptsFromMsg = claudeOptsFromMsg;
exports.llamacppOptsFromMsg = llamacppOptsFromMsg;
exports.LLAMACPP_URL = process.env.HME_LLAMACPP_ARBITER_URL ?? "http://127.0.0.1:8080";
function claudeOptsFromMsg(msg) {
    return {
        model: msg.claudeModel,
        effort: msg.claudeEffort,
        thinking: msg.claudeThinking,
        permissionMode: "bypassPermissions",
    };
}
function llamacppOptsFromMsg(msg) {
    return { model: msg.llamacppModel, url: exports.LLAMACPP_URL };
}
