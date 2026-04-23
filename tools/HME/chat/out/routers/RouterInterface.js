"use strict";
/**
 * Router interface — normalized contract for streaming backends.
 *
 * Tonight's deep dive called out three procedural stream functions
 * (streamClaude, streamLlamacpp, streamHybrid) with divergent callback
 * orders and error semantics. That fragmentation was the largest
 * barrier to "ecstatic to think about" cited in the audit.
 *
 * The fix here is lightweight: a RouterAdapter shape that every backend
 * satisfies. Implementations MAY still have route-specific wrinkles
 * (Claude fires sessionId mid-stream, llama doesn't) but the shape
 * normalizes them so callers see one contract.
 *
 * Adoption strategy: new code uses `RouterAdapter`. Legacy
 * streamXxxMsg() functions keep their current signatures (they bolt
 * through run_stream harness which we don't want to touch mid-session).
 * As chatStreaming.ts matures, per-adapter variance gets pulled into
 * this layer, not duplicated at each call site.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeResult = makeResult;
exports.wrapLegacyStream = wrapLegacyStream;
/** Helper: build a resolved StreamResult with sensible defaults. */
function makeResult(partial) {
    return {
        text: partial.text ?? "",
        thinking: partial.thinking,
        ok: partial.ok ?? false,
        error: partial.error,
        sessionId: partial.sessionId,
        tokens: partial.tokens,
    };
}
/** Thin adapter wrapper: converts a legacy `onChunk/onDone/onError + cancel`
 * function into a RouterAdapter shape without rewriting the legacy
 * implementation. Used by routerClaude/routerLlamacpp/routerHme
 * adapters until the full internals can be unified. */
function wrapLegacyStream(route, name, launch) {
    return {
        route,
        name,
        stream(messages, opts) {
            let acc = "";
            let think = "";
            let sessionId;
            let tokens;
            let resolved = false;
            let resolveResult;
            const done = new Promise((resolve) => { resolveResult = resolve; });
            let deadlineTimer;
            const resolveOnce = (r) => {
                if (resolved)
                    return;
                resolved = true;
                if (deadlineTimer)
                    clearTimeout(deadlineTimer);
                resolveResult(r);
            };
            const chunk = (text, type) => {
                opts.onChunk(text, type);
                if (type === "text")
                    acc += text;
                else if (type === "thinking")
                    think += text;
            };
            const cancelFn = launch(messages, opts, {
                chunk,
                done: () => resolveOnce(makeResult({ text: acc, thinking: think, ok: true, sessionId, tokens })),
                error: (msg) => resolveOnce(makeResult({ text: acc, thinking: think, ok: false, error: msg, sessionId, tokens })),
                sessionId: (id) => { sessionId = id; opts.onSessionId?.(id); },
                tokens: (u) => { tokens = u; opts.onTokenUsage?.(u); },
            });
            if (opts.deadlineMs && opts.deadlineMs > 0) {
                deadlineTimer = setTimeout(() => {
                    try {
                        cancelFn();
                    }
                    catch { /* silent-ok: already cancelled */ }
                    resolveOnce(makeResult({
                        text: acc, thinking: think, ok: false,
                        error: `${name}: wall deadline ${opts.deadlineMs}ms exceeded`,
                        sessionId, tokens,
                    }));
                }, opts.deadlineMs);
            }
            return {
                cancel: () => {
                    try {
                        cancelFn();
                    }
                    catch { /* silent-ok: legacy cancel may throw on already-done */ }
                    resolveOnce(makeResult({ text: acc, thinking: think, ok: false, error: "cancelled", sessionId, tokens }));
                },
                done,
            };
        },
    };
}
