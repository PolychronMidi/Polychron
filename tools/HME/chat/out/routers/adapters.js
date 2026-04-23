"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hybridAdapter = exports.llamacppAdapter = exports.claudePtyAdapter = exports.claudeAdapter = void 0;
exports.getAdapterForRoute = getAdapterForRoute;
exports.runAdapter = runAdapter;
/**
 * Concrete `RouterAdapter` instances for the three backends, plus a
 * `runAdapter` helper that collapses the per-route boilerplate previously
 * duplicated across `streamClaudeMsg` / `streamLlamacppMsg` / `streamHybridMsg`.
 *
 * Callers pick an adapter via `getAdapterForRoute(route)` and drive it
 * through `runAdapter(adapter, messages, opts)` — error handling, deadline,
 * sessionId, and usage are all normalized. Per-route quirks (Claude PTY
 * mode, llama think-tags, hybrid enrichment) are hidden inside each
 * backend's legacy function; the adapter wraps them in a uniform shape.
 */
const router_1 = require("../router");
exports.claudeAdapter = (0, router_1.wrapLegacyStream)("claude", "Claude (pipe)", (input, opts, cb) => {
    return (0, router_1.streamClaude)(input.message, input.sessionId, opts.claude, input.workingDir, cb.chunk, (id) => cb.sessionId?.(id), (_cost, usage) => {
        if (usage) {
            cb.tokens?.({
                input: usage.inputTokens,
                output: usage.outputTokens,
                usedPct: usage.usedPct,
            });
        }
        cb.done();
    }, cb.error);
});
exports.claudePtyAdapter = (0, router_1.wrapLegacyStream)("claude", "Claude (PTY)", (input, opts, cb) => {
    return (0, router_1.streamClaudePty)(input.message, input.sessionId, opts.claude, input.workingDir, cb.chunk, (id) => cb.sessionId?.(id), (usage) => {
        if (usage) {
            cb.tokens?.({
                input: usage.inputTokens,
                output: usage.outputTokens,
                usedPct: usage.usedPct,
            });
        }
        cb.done();
    }, cb.error, opts.onRawData, opts.onPtyReady);
});
// llama.cpp / hybrid backends don't carry API session ids. A synthetic id
// keeps the RouterInterface contract uniform — session-resumption code sees
// an id on every route and can match the `llama-` prefix to skip resume attempts.
function syntheticLlamaSessionId() {
    return `llama-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
exports.llamacppAdapter = (0, router_1.wrapLegacyStream)("local", "llama.cpp (agentic)", (messages, opts, cb) => {
    cb.sessionId?.(syntheticLlamaSessionId());
    return (0, router_1.streamLlamacppAgentic)(messages, opts.llamacpp, opts.workingDir, cb.chunk, cb.done, cb.error);
});
exports.hybridAdapter = (0, router_1.wrapLegacyStream)("hybrid", "llama.cpp + KB (hybrid)", (input, opts, cb) => {
    // Race guard: the cancellor from streamHybrid arrives via Promise.then.
    // If the caller cancels BEFORE .then fires, we must remember the request
    // and fire the real cancellor the moment it's available — otherwise an
    // early cancel is silently dropped and the stream keeps emitting chunks
    // into a disposed consumer.
    cb.sessionId?.(syntheticLlamaSessionId());
    let cancelFn = null;
    let cancelRequested = false;
    const fireCancelIfReady = () => {
        if (cancelRequested && cancelFn) {
            try {
                cancelFn();
            }
            catch { /* silent-ok: inner cancel may already be past completion */ }
            cancelFn = null;
        }
    };
    (0, router_1.streamHybrid)(input.message, input.history, opts.llamacpp, input.workingDir, cb.chunk, cb.done, cb.error).then((inner) => {
        cancelFn = inner;
        fireCancelIfReady();
    }).catch((e) => {
        if (!cancelRequested)
            cb.error(String(e?.message ?? e));
    });
    return () => {
        cancelRequested = true;
        fireCancelIfReady();
    };
});
/**
 * Return the adapter appropriate for the given route. Caller is
 * responsible for supplying the right input shape per adapter.
 */
function getAdapterForRoute(route, opts) {
    switch (route) {
        case "claude":
            return opts?.claudePty ? exports.claudePtyAdapter : exports.claudeAdapter;
        case "local":
            return exports.llamacppAdapter;
        case "hybrid":
            return exports.hybridAdapter;
        case "agent":
            // Agent route has two parallel streams — callers drive them
            // independently via llamacppAdapter + hybridAdapter rather than
            // coming through this function.
            throw new Error("'agent' route has no single adapter; use llamacppAdapter + hybridAdapter in parallel");
    }
}
/**
 * Uniform runner: drive an adapter to completion with a consistent
 * result shape. For callers that need the final StreamResult (no
 * per-chunk handling). The chatStreaming harness uses its own
 * runAdapterStream helper that integrates with the HarnessHandle
 * state-tracking; this helper is for standalone consumers.
 */
async function runAdapter(adapter, messages, opts) {
    const handle = adapter.stream(messages, opts);
    const result = await handle.done;
    return { result, cancel: handle.cancel };
}
