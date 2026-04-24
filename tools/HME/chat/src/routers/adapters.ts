/**
 * Concrete `RouterAdapter` instances for the three backends, plus a
 * `runAdapter` helper that collapses the per-route boilerplate previously
 * duplicated across `streamClaudeMsg` / `streamLlamacppMsg` / `streamHybridMsg`.
 *
 * Callers pick an adapter via `getAdapterForRoute(route)` and drive it
 * through `runAdapter(adapter, messages, opts)` — error handling, deadline,
 * sessionId, and usage are all normalized. Per-route quirks (llama think-tags,
 * hybrid enrichment) are hidden inside each backend's legacy function; the
 * adapter wraps them in a uniform shape.
 */
import {
  streamClaude,
  streamLlamacppAgentic,
  streamHybrid,
  ClaudeOptions,
  LlamacppOptions,
  LlamacppMessage,
  Route,
  RouterAdapter,
  StreamResult,
  BaseStreamOptions,
  wrapLegacyStream,
} from "../router";

// Claude (pool-backed) — pool keys on `chatSessionId`, so identical turns on
// the same chat session reuse the same long-lived claude process (prompt
// cache hits from turn 2 onward). `sessionId` is the Claude-native id used
// for --resume on respawn after death or config change.
export interface ClaudeStreamInput {
  chatSessionId: string;
  message: string;
  sessionId: string | null;
  workingDir: string;
}
export interface ClaudeStreamOptions extends BaseStreamOptions {
  claude: ClaudeOptions;
}

export const claudeAdapter: RouterAdapter<ClaudeStreamInput, ClaudeStreamOptions> =
  wrapLegacyStream<ClaudeStreamInput, ClaudeStreamOptions>(
    "claude",
    "Claude (stream-json pool)",
    (input, opts, cb) => {
      return streamClaude(
        input.chatSessionId,
        input.message,
        input.sessionId,
        opts.claude,
        input.workingDir,
        cb.chunk,
        (id) => cb.sessionId?.(id),
        (_cost, usage) => {
          if (usage) {
            cb.tokens?.({
              input: usage.inputTokens,
              output: usage.outputTokens,
              usedPct: usage.usedPct,
            });
          }
          cb.done();
        },
        cb.error,
      );
    },
  );

// llama.cpp agentic — takes pre-trimmed LlamacppMessage[].
export interface LlamacppStreamOptions extends BaseStreamOptions {
  llamacpp: LlamacppOptions;
  workingDir: string;
}

// llama.cpp / hybrid backends don't carry API session ids. A synthetic id
// keeps the RouterInterface contract uniform — session-resumption code sees
// an id on every route and can match the `llama-` prefix to skip resume attempts.
function syntheticLlamaSessionId(): string {
  return `llama-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export const llamacppAdapter: RouterAdapter<LlamacppMessage[], LlamacppStreamOptions> =
  wrapLegacyStream<LlamacppMessage[], LlamacppStreamOptions>(
    "local",
    "llama.cpp (agentic)",
    (messages, opts, cb) => {
      cb.sessionId?.(syntheticLlamaSessionId());
      return streamLlamacppAgentic(
        messages,
        opts.llamacpp,
        opts.workingDir,
        cb.chunk,
        cb.done,
        cb.error,
      );
    },
  );

// Hybrid — llama + KB enrichment. Takes the full request as a dict shape.
// Note: streamHybrid's positional order is (message, history, opts, ...).
export interface HybridStreamInput {
  message: string;
  history: LlamacppMessage[];
  workingDir: string;
}
export interface HybridStreamOptions extends BaseStreamOptions {
  llamacpp: LlamacppOptions;
}

export const hybridAdapter: RouterAdapter<HybridStreamInput, HybridStreamOptions> =
  wrapLegacyStream<HybridStreamInput, HybridStreamOptions>(
    "hybrid",
    "llama.cpp + KB (hybrid)",
    (input, opts, cb) => {
      // Race guard: the cancellor from streamHybrid arrives via Promise.then.
      // If the caller cancels BEFORE .then fires, we must remember the request
      // and fire the real cancellor the moment it's available — otherwise an
      // early cancel is silently dropped and the stream keeps emitting chunks
      // into a disposed consumer.
      cb.sessionId?.(syntheticLlamaSessionId());
      let cancelFn: (() => void) | null = null;
      let cancelRequested = false;
      const fireCancelIfReady = () => {
        if (cancelRequested && cancelFn) {
          try { cancelFn(); } catch { /* silent-ok: inner cancel may already be past completion */ }
          cancelFn = null;
        }
      };
      streamHybrid(
        input.message,
        input.history,
        opts.llamacpp,
        input.workingDir,
        cb.chunk,
        cb.done,
        cb.error,
      ).then((inner) => {
        cancelFn = inner;
        fireCancelIfReady();
      }).catch((e: any) => {
        if (!cancelRequested) cb.error(String(e?.message ?? e));
      });
      return () => {
        cancelRequested = true;
        fireCancelIfReady();
      };
    },
  );

/**
 * Return the adapter appropriate for the given route. Caller is
 * responsible for supplying the right input shape per adapter.
 */
export function getAdapterForRoute(route: Route):
  | RouterAdapter<ClaudeStreamInput, ClaudeStreamOptions>
  | RouterAdapter<LlamacppMessage[], LlamacppStreamOptions>
  | RouterAdapter<HybridStreamInput, HybridStreamOptions> {
  switch (route) {
    case "claude":
      return claudeAdapter;
    case "local":
      return llamacppAdapter;
    case "hybrid":
      return hybridAdapter;
    case "agent":
      // Agent route has two parallel streams — callers drive them
      // independently via llamacppAdapter + hybridAdapter rather than
      // coming through this function.
      throw new Error("'agent' route has no single adapter; use llamacppAdapter + hybridAdapter in parallel");
  }
}

export type StreamInput = ClaudeStreamInput | LlamacppMessage[] | HybridStreamInput;
export type StreamOpts = ClaudeStreamOptions | LlamacppStreamOptions | HybridStreamOptions;

/**
 * Uniform runner: drive an adapter to completion with a consistent
 * result shape. For callers that need the final StreamResult (no
 * per-chunk handling). The chatStreaming harness uses its own
 * runAdapterStream helper that integrates with the HarnessHandle
 * state-tracking; this helper is for standalone consumers.
 */
export async function runAdapter<M, O extends BaseStreamOptions>(
  adapter: RouterAdapter<M, O>,
  messages: M,
  opts: O,
): Promise<{ result: StreamResult; cancel: () => void }> {
  const handle = adapter.stream(messages, opts);
  const result = await handle.done;
  return { result, cancel: handle.cancel };
}
