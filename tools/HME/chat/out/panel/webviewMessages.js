"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dispatchWebviewMessage = dispatchWebviewMessage;
/**
 * Dispatch an untyped webview message through a typed handler map.
 * Unknown message types are silently ignored (webview may send unsupported types).
 */
function dispatchWebviewMessage(msg, handlers) {
    const handler = handlers[msg?.type];
    if (handler)
        handler(msg);
}
