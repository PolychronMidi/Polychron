"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildCrossRouteContext = buildCrossRouteContext;
exports.applyCrossRouteContext = applyCrossRouteContext;
/**
 * When the user switches routes mid-session, per-route history must be
 * synthesized from the other side so the new route sees prior context.
 *
 * - Switching TO local/hybrid: rebuild `llamacppHistory` from the canonical
 *   `messages` list (drops the newly-appended user turn with .pop()).
 * - Switching TO claude: drop the prior claude session id (old id was bound
 *   to a different process) and return a `[Prior conversation]` text prefix.
 */
function buildCrossRouteContext(messages, lastRoute, resolvedRoute) {
    if (!lastRoute || lastRoute === resolvedRoute) {
        return { contextPrefix: "" };
    }
    const result = { contextPrefix: "" };
    if (resolvedRoute === "local" || resolvedRoute === "hybrid") {
        const history = messages
            .filter((m) => m.role === "user" || m.role === "assistant")
            .map((m) => ({ role: m.role, content: m.text || "" }));
        history.pop();
        result.llamacppHistory = history;
    }
    if (resolvedRoute === "claude" && lastRoute !== "claude") {
        result.claudeSessionIdReset = true;
        const prior = messages
            .filter((m) => m.role === "user" || m.role === "assistant")
            .slice(0, -1)
            .slice(-12);
        if (prior.length > 0) {
            const lines = prior
                .map((m) => `${m.role === "user" ? "Human" : "Assistant"}: ${(m.text || "").slice(0, 600)}`)
                .join("\n");
            result.contextPrefix = `[Prior conversation via local model — use for context only]\n${lines}\n[End of prior context]\n\n`;
        }
    }
    return result;
}
/**
 * Apply the cross-route result to session state in-place.
 * Returns the contextPrefix for use in the outgoing message.
 */
function applyCrossRouteContext(state, cross) {
    if (cross.llamacppHistory)
        state.llamacppHistory = cross.llamacppHistory;
    if (cross.claudeSessionIdReset)
        state.claudeSessionId = null;
    return cross.contextPrefix;
}
