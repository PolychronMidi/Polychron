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

import { ChunkCallback, LlamacppMessage, Route } from "../router";

/** A single streaming turn. Caller gets one Promise per turn and can
 * observe progress through the onChunk callback. SessionId (Claude-
 * specific) is forwarded via onSessionId when the backend produces one;
 * onTokenUsage reports final usage snapshot when the backend produces
 * one. All callbacks are optional — backends only call what they have. */
export interface StreamHandle {
  /** Cancel the in-flight stream. Idempotent. */
  cancel(): void;
  /** Resolves when the stream ends (success or error). Error path is
   * surfaced via `result.error` rather than rejection so callers have
   * a single join point. */
  done: Promise<StreamResult>;
}

export interface StreamResult {
  /** Concatenated assistant text (excluding thinking blocks). */
  text: string;
  /** Concatenated thinking text, if any. */
  thinking?: string;
  /** True if stream terminated normally. */
  ok: boolean;
  /** Error message if ok=false. */
  error?: string;
  /** Backend-specific: Claude session id (null otherwise). */
  sessionId?: string | null;
  /** Backend-specific: final token usage snapshot. */
  tokens?: { input?: number; output?: number; usedPct?: number };
}

/** Options all backends accept. Backend-specific options go into a
 * discriminated union at the caller boundary (not this interface). */
export interface BaseStreamOptions {
  onChunk: ChunkCallback;
  /** Called at most once if the backend produces a session id. */
  onSessionId?(id: string | null): void;
  /** Called at most once with final token usage if known. */
  onTokenUsage?(usage: { input?: number; output?: number; usedPct?: number }): void;
  /** Maximum wall-clock time for the entire stream. Backends enforce
   * this as a hard cap; omit to accept backend default. */
  deadlineMs?: number;
}

export interface RouterAdapter<MessageT = unknown, OptionsT = BaseStreamOptions> {
  /** Which route this adapter serves. */
  readonly route: Route;
  /** Human-readable name for error messages / logging. */
  readonly name: string;
  /** Start a stream. Returns a handle whose .done Promise resolves with
   * the normalized StreamResult (never rejects — errors go in result.error). */
  stream(messages: MessageT, opts: OptionsT): StreamHandle;
}

/** Helper: build a resolved StreamResult with sensible defaults. */
export function makeResult(partial: Partial<StreamResult>): StreamResult {
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
export function wrapLegacyStream<OptionsT extends BaseStreamOptions>(
  route: Route,
  name: string,
  launch: (
    messages: LlamacppMessage[],
    opts: OptionsT,
    cb: {
      chunk: ChunkCallback;
      done: () => void;
      error: (msg: string) => void;
      sessionId?: (id: string | null) => void;
      tokens?: (u: { input?: number; output?: number; usedPct?: number }) => void;
    },
  ) => () => void,
): RouterAdapter<LlamacppMessage[], OptionsT> {
  return {
    route,
    name,
    stream(messages, opts): StreamHandle {
      let acc = "";
      let think = "";
      let sessionId: string | null | undefined;
      let tokens: StreamResult["tokens"];
      let resolved = false;
      let resolveResult!: (r: StreamResult) => void;
      const done = new Promise<StreamResult>((resolve) => { resolveResult = resolve; });
      let deadlineTimer: NodeJS.Timeout | undefined;
      const resolveOnce = (r: StreamResult) => {
        if (resolved) return;
        resolved = true;
        if (deadlineTimer) clearTimeout(deadlineTimer);
        resolveResult(r);
      };
      const chunk: ChunkCallback = (text, type) => {
        opts.onChunk(text, type);
        if (type === "text") acc += text;
        else if (type === "thinking") think += text;
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
          try { cancelFn(); } catch { /* silent-ok: already cancelled */ }
          resolveOnce(makeResult({
            text: acc, thinking: think, ok: false,
            error: `${name}: wall deadline ${opts.deadlineMs}ms exceeded`,
            sessionId, tokens,
          }));
        }, opts.deadlineMs);
      }
      return {
        cancel: () => {
          try { cancelFn(); } catch { /* silent-ok: legacy cancel may throw on already-done */ }
          resolveOnce(makeResult({ text: acc, thinking: think, ok: false, error: "cancelled", sessionId, tokens }));
        },
        done,
      };
    },
  };
}
