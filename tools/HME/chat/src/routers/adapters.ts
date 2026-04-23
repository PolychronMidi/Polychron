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
import {
  streamClaude,
  streamClaudePty,
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

// Claude (pipe mode) — takes a single message string + sessionId.
export interface ClaudeStreamInput {
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
    "Claude (pipe)",
    (input, opts, cb) => {
      return streamClaude(
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

// Claude PTY — same shape as pipe but routes through the PTY harness.
export const claudePtyAdapter: RouterAdapter<ClaudeStreamInput, ClaudeStreamOptions> =
  wrapLegacyStream<ClaudeStreamInput, ClaudeStreamOptions>(
    "claude",
    "Claude (PTY)",
    (input, opts, cb) => {
      return streamClaudePty(
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

export const llamacppAdapter: RouterAdapter<LlamacppMessage[], LlamacppStreamOptions> =
  wrapLegacyStream<LlamacppMessage[], LlamacppStreamOptions>(
    "local",
    "llama.cpp (agentic)",
    (messages, opts, cb) => {
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
export interface HybridStreamInput {
  messages: LlamacppMessage[];
  userText: string;
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
      let cancelled = false;
      streamHybrid(
        input.messages,
        input.userText,
        opts.llamacpp,
        input.workingDir,
        cb.chunk,
        cb.done,
        cb.error,
      ).catch((e: any) => {
        if (!cancelled) cb.error(String(e?.message ?? e));
      });
      return () => { cancelled = true; };
    },
  );

/**
 * Return the adapter appropriate for the given route. Caller is
 * responsible for supplying the right input shape per adapter.
 */
export function getAdapterForRoute(route: Route, opts?: { claudePty?: boolean }):
  | RouterAdapter<ClaudeStreamInput, ClaudeStreamOptions>
  | RouterAdapter<LlamacppMessage[], LlamacppStreamOptions>
  | RouterAdapter<HybridStreamInput, HybridStreamOptions> {
  switch (route) {
    case "claude":
      return opts?.claudePty ? claudePtyAdapter : claudeAdapter;
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
 * result shape. Replaces the 3-way boilerplate in chatStreaming where
 * every route hand-rolled onDone/onError/finalize wiring.
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
