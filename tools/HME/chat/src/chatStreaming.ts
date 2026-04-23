import * as path from "path";
import {
  LlamacppMessage, TokenUsage,
  streamClaude, streamClaudePty, streamLlamacppAgentic, streamHybrid,
  postTranscript, reindexFiles, auditChanges,
  hybridAdapter, claudeAdapter, claudePtyAdapter, llamacppAdapter,
  RouterAdapter, StreamHandle, BaseStreamOptions,
} from "./router";
import { ChatCtx, StreamTracker, makeBlockAccumulator, trimHistoryToFit, AGENTIC_SYSTEM_PROMPT } from "./streamUtils";
import { claudeOptsFromMsg, llamacppOptsFromMsg } from "./msgHelpers";
import { ChatMessage } from "./types";
import type { SendMsg } from "./panel/webviewMessages";

//  Helpers

const INDEXABLE_EXTS = new Set([
  ".js", ".ts", ".tsx", ".jsx", ".py", ".json", ".md", ".css", ".html", ".sh",
]);

export function mirrorAssistantToShim(ctx: ChatCtx, text: string, route: string, model?: string, tools?: string[]) {
  postTranscript([{
    ts: Date.now(), type: "assistant", route, model,
    content: text.slice(0, 2000),
    summary: `Assistant [${route}]: ${text.slice(0, 100)}`,
    meta: tools?.length ? { tools } : undefined,
  }]).catch((e: any) => ctx.postError("transcript", String(e)));
}

export function reindexFromTools(tools: string[]): Set<string> {
  const files = new Set<string>();
  for (const t of tools) {
    const fileMatch = t.match(/"file_path"\s*:\s*"([^"]+)"/);
    if (fileMatch) files.add(fileMatch[1]);
    const llamacppMatch = t.match(/\[(write_file|read_file|bash)\]\s*\{[^}]*"path"\s*:\s*"([^"]+)"/);
    if (llamacppMatch) files.add(llamacppMatch[2]);
  }
  const indexable = [...files].filter(f => INDEXABLE_EXTS.has(path.extname(f).toLowerCase()));
  if (indexable.length > 0) {
    reindexFiles(indexable).catch((e: any) => console.error(`[HME] reindexFiles failed: ${e?.message ?? e}`));
  }
  return files;
}

export function runPostAudit(ctx: ChatCtx, changedFiles?: Set<string>) {
  const filesArg = changedFiles?.size ? [...changedFiles].join(",") : "";
  auditChanges(filesArg).then(({ violations, changed_files }) => {
    ctx.transcript.logAudit(changed_files.length, violations.length);
    if (violations.length > 0) {
      const summary = violations
        .map((v: any) => `[${v.category}] ${v.file}: ${v.title}`)
        .join("; ");
      ctx.postError("audit", `post-audit (${changed_files.length} files): ${summary}`);
    }
  }).catch((e: any) => ctx.postError("audit", String(e)));
}

//  Stream harness

interface ChunkState {
  text: string;
  thinking: string;
  tools: string[];
}

function makeOnChunk(
  ctx: ChatCtx,
  assistantId: string,
  acc: ReturnType<typeof makeBlockAccumulator>,
  state: ChunkState,
  tracker: StreamTracker,
  route: string,
  opts: { abortCheck?: () => boolean; handleError?: (chunk: string) => void } = {}
): (chunk: string, type: string) => void {
  return (chunk, type) => {
    if (opts.abortCheck?.()) return;
    if (type === "tool") {
      state.tools.push(chunk);
      acc.append("tool", chunk);
      ctx.post({ type: "streamChunk", id: assistantId, chunkType: "tool", chunk });
      ctx.transcript.logToolCall(chunk.split("]")[0].replace("[", ""), chunk, route);
      if (/^\[(?:Pre|Post)Compact\]/.test(chunk)) {
        ctx.post({ type: "notice", level: "block", text: `CRITICAL: ${chunk}` });
        ctx.postError("compact", chunk);
      }
    } else if (type === "thinking") {
      state.thinking += chunk;
      acc.append("thinking", chunk);
      ctx.post({ type: "streamChunk", id: assistantId, chunkType: "thinking", chunk });
    } else if (type === "error") {
      opts.handleError?.(chunk);
    } else {
      state.text += chunk;
      acc.append("text", chunk);
      ctx.post({ type: "streamChunk", id: assistantId, chunkType: type, chunk });
    }
    tracker.update(state.text, state.tools, state.thinking || undefined);
  };
}

/**
 * Harness args captured by reference so the start() callback sees the same
 * aborted/streamEnded flags as the runStream lifecycle.
 */
interface HarnessHandle {
  state: ChunkState;
  acc: ReturnType<typeof makeBlockAccumulator>;
  tracker: StreamTracker;
  onChunk: (chunk: string, type: string) => void;
  isAborted: () => boolean;
  isEnded: () => boolean;
  markEnded: () => void;
  safeEnd: () => void;
  postStreamEnd: () => void;
  /** Register the transport cancel fn so the harness abort propagates to it. */
  setCancel: (fn: () => void) => void;
}

interface RunStreamOpts {
  ctx: ChatCtx;
  assistantId: string;
  route: string;
  /** Start the underlying transport. Use handle to drive chunks, cancel, and finalize. */
  start: (handle: HarnessHandle) => void;
  /** If true (default), uses ctx.setCancelCurrent. Agent modes disable and manage externally. */
  ownCancel?: boolean;
  /** If true (default), safeEnd calls ctx.drainQueue. Agent modes use onEnd instead. */
  drainOnEnd?: boolean;
  /** Called by safeEnd instead of ctx.drainQueue when drainOnEnd is false. */
  onEnd?: () => void;
  /** Optional prelude tool-chunk posted before start() (e.g. "Enriching with KB context…"). */
  preludeChunk?: string;
}

function runStream(opts: RunStreamOpts): { cancel: () => void; handle: HarnessHandle } {
  const { ctx, assistantId, route } = opts;
  const state: ChunkState = { text: "", thinking: "", tools: [] };
  const acc = makeBlockAccumulator();
  let aborted = false;
  let streamEnded = false;
  const tracker = ctx.trackStream(assistantId, route);
  const safeEnd = () => {
    if (streamEnded) return;
    streamEnded = true;
    if (opts.drainOnEnd ?? true) ctx.drainQueue();
    else opts.onEnd?.();
  };
  const postStreamEnd = () => ctx.post({ type: "streamEnd", id: assistantId });
  const onChunk = makeOnChunk(ctx, assistantId, acc, state, tracker, route, {
    abortCheck: () => aborted,
    handleError: (chunk) => ctx.postError(route, chunk),
  });

  let cancelFn: (() => void) | undefined;
  const setCancel = (fn: () => void) => { cancelFn = fn; };

  const handle: HarnessHandle = {
    state,
    acc,
    tracker,
    onChunk,
    isAborted: () => aborted,
    isEnded: () => streamEnded,
    markEnded: () => { streamEnded = true; },
    safeEnd,
    postStreamEnd,
    setCancel,
  };

  if (opts.preludeChunk) {
    ctx.post({ type: "streamChunk", id: assistantId, chunkType: "tool", chunk: opts.preludeChunk });
    acc.append("tool", opts.preludeChunk);
  }

  if (opts.ownCancel ?? true) {
    ctx.setCancelCurrent(() => { aborted = true; cancelFn?.(); });
  }

  opts.start(handle);

  return {
    cancel: () => { aborted = true; cancelFn?.(); },
    handle,
  };
}

interface FinalizeOpts {
  includeThinking?: boolean;
  pushLlamacpp?: boolean;
  userText?: string;
  checkChain?: boolean;
  model?: string;
  skipMirror?: boolean;
}

/**
 * Build the final ChatMessage, finalize the tracker, post streamEnd, run side-effects.
 * Returns the built message so callers can inspect it if needed.
 */
function finalizeStream(
  h: HarnessHandle,
  ctx: ChatCtx,
  assistantId: string,
  route: string,
  opts: FinalizeOpts = {},
): ChatMessage {
  const msg: ChatMessage = {
    id: assistantId, role: "assistant", text: h.state.text,
    tools: h.state.tools.length ? h.state.tools : undefined,
    blocks: h.acc.blocks.length ? h.acc.blocks : undefined,
    route, ts: Date.now(),
  };
  if (opts.includeThinking && h.state.thinking) msg.thinking = h.state.thinking;
  h.tracker.finalize(msg);
  h.postStreamEnd();
  if (opts.pushLlamacpp && opts.userText !== undefined) {
    ctx.state.llamacppHistory.push({ role: "user", content: opts.userText });
    ctx.state.llamacppHistory.push({ role: "assistant", content: h.state.text });
  }
  ctx.transcript.logAssistant(h.state.text, route, opts.model, h.state.tools);
  if (!opts.skipMirror) mirrorAssistantToShim(ctx, h.state.text, route, opts.model, h.state.tools);
  const changedFiles = reindexFromTools(h.state.tools);
  runPostAudit(ctx, changedFiles);
  if (opts.checkChain) ctx.checkChainThreshold();
  return msg;
}

/**
 * Attach a promise-returned cancel fn to the harness.
 * Aborts immediately if the harness was already aborted before the promise resolves.
 * On rejection, calls onError then signals the harness ended via onForceEnd.
 */
function attachPromiseCancel(
  h: HarnessHandle,
  promise: Promise<() => void>,
  onError: (err: string) => void,
  onForceEnd?: () => void,
): void {
  promise.then((cancel) => {
    if (h.isAborted()) { cancel(); return; }
    h.setCancel(cancel);
  }).catch((err) => {
    if (h.isAborted()) return;
    onError(String(err));
    if (!h.isEnded()) {
      if (onForceEnd) { h.markEnded(); h.postStreamEnd(); onForceEnd(); }
      else { h.postStreamEnd(); h.safeEnd(); }
    }
  });
}

//  Streaming methods

/** SendMsg enriched by _onSend before routing to a specific stream function. */
type ResolvedMsg = SendMsg & { _resolvedRoute?: string; _contextPrefix?: string };

const AGENTIC_SYSTEM: LlamacppMessage = { role: "system", content: AGENTIC_SYSTEM_PROMPT };

function contextPrefixMessages(prefix: string | undefined): LlamacppMessage[] {
  return prefix
    ? [
        { role: "user", content: prefix },
        { role: "assistant", content: "Understood. I have the prior conversation context." },
      ]
    : [];
}

export function streamClaudeMsg(ctx: ChatCtx, msg: ResolvedMsg, assistantId: string) {
  const route = msg._resolvedRoute ?? msg.route ?? "claude";
  const effectiveText = (msg._contextPrefix ?? "") + msg.text;
  const claudeOpts = claudeOptsFromMsg(msg);
  // Announce exactly what we're about to send — the browser reconciles this against its UI.
  ctx.post({
    type: "claudeConfigDispatched",
    assistantId,
    modelId: claudeOpts.model,
    effort: claudeOpts.effort,
    thinking: claudeOpts.thinking,
  });

  runStream({
    ctx, assistantId, route,
    start: (h) => {
      // Claude has two backends (PTY hook-aware + pipe fallback) and
      // unique-among-routes needs (sessionId capture, token usage
      // validation, model-mismatch detection). The adapter handles
      // sessionId + usage via normalized callbacks; PTY fallback to
      // pipe still uses a direct legacy-function path because it's a
      // mid-stream SWITCH, not a fresh launch, and goes through the
      // PTY-specific onRawData / onPtyReady hooks that aren't in the
      // adapter contract.
      const onCompleted = (usage?: TokenUsage) => {
        if (h.isAborted()) return;
        ctx.updateContextTracker(h.state.text, h.state.thinking, msg.claudeModel, usage);
        const _modelMismatch = usage?.modelId &&
          !usage.modelId.includes(claudeOpts.model) &&
          !usage.modelId.startsWith(`claude-${claudeOpts.model}`);
        if (_modelMismatch) {
          ctx.post({
            type: "claudeConfigMismatch",
            assistantId,
            requested: claudeOpts.model,
            actual: usage.modelId,
          });
          ctx.postError("claude", `model mismatch: requested ${claudeOpts.model}, got ${usage.modelId}`);
        } else if (usage?.modelId && !_modelMismatch) {
          ctx.post({
            type: "claudeConfigConfirmed",
            assistantId,
            modelId: usage.modelId,
            modelName: usage.modelName,
            thinkingEmitted: !!h.state.thinking,
          });
        }
        finalizeStream(h, ctx, assistantId, route, { includeThinking: true, model: msg.claudeModel, checkChain: true });
        h.safeEnd();
      };
      const onError = (err: string) => {
        if (h.isAborted()) return;
        if (!h.isEnded()) { h.postStreamEnd(); h.safeEnd(); }
        ctx.postError("claude", err);
      };
      // Start PTY via the adapter. On PTY-unavailable error, fall back
      // to pipe mode via the pipe adapter. Both report sessionId via
      // onSessionId — the state update is uniform.
      const startPipeFallback = () => {
        const pipeHandle = claudeAdapter.stream(
          { message: effectiveText, sessionId: ctx.state.claudeSessionId, workingDir: ctx.projectRoot },
          {
            onChunk: h.onChunk,
            claude: claudeOpts,
            // Hard wall-clock cap. Without this, runaway thinking or a
            // hung stdio pipe can leave Claude streaming indefinitely
            // with no user recourse beyond manual cancel. 300s is
            // generous enough for thorough thinking, tight enough to
            // surface stuck streams.
            deadlineMs: 300_000,
            onSessionId: (sessionId) => { ctx.state.claudeSessionId = sessionId; },
            onTokenUsage: (u) => {
              onCompleted({
                inputTokens: u.input ?? 0,
                outputTokens: u.output ?? 0,
                usedPct: u.usedPct,
              } as TokenUsage);
            },
          },
        );
        h.setCancel(() => pipeHandle.cancel());
        pipeHandle.done.then((result) => {
          if (!result.ok) onError(result.error ?? "unknown error");
          // onCompleted was already called via onTokenUsage; if the
          // stream ended without tokens, still finalize.
          else if (!result.tokens) onCompleted(undefined);
        });
      };
      // PTY path now goes through claudePtyAdapter — the adapter's
      // extended options carry the onRawData / onPtyReady side-channels
      // that the mirror terminal needs. On PTY unavailable, pipe adapter
      // takes over via startPipeFallback.
      let _ptyErrorFallback = false;
      const ptyHandle = claudePtyAdapter.stream(
        { message: effectiveText, sessionId: ctx.state.claudeSessionId, workingDir: ctx.projectRoot },
        {
          onChunk: h.onChunk,
          claude: claudeOpts,
          deadlineMs: 300_000,  // same hard cap as pipe — a hung PTY is worse
          onSessionId: (sessionId) => { ctx.state.claudeSessionId = sessionId; },
          onTokenUsage: (u) => {
            onCompleted({
              inputTokens: u.input ?? 0,
              outputTokens: u.output ?? 0,
              usedPct: u.usedPct,
            } as TokenUsage);
          },
          onRawData: ctx.mirrorPty ? (raw) => ctx.mirrorPty!.onRawData(raw) : undefined,
          onPtyReady: ctx.mirrorPty ? (fn) => ctx.mirrorPty!.onPtyReady(fn) : undefined,
        },
      );
      h.setCancel(() => ptyHandle.cancel());
      ptyHandle.done.then((result) => {
        if (_ptyErrorFallback) return;  // pipe path already took over
        if (h.isAborted()) return;
        if (!result.ok) {
          const err = result.error ?? "unknown PTY error";
          // PTY failures typically mean the PTY binding refused at spawn
          // (node-pty unavailable, etc.). Fall back to pipe via adapter.
          console.log(`[HME Chat] PTY unavailable (${err}), falling back to pipe via claudeAdapter`);
          _ptyErrorFallback = true;
          startPipeFallback();
          return;
        }
        // Success path: onCompleted was called via onTokenUsage when
        // usage arrived. If no usage (rare — legacy CLIs), finalize now.
        if (!result.tokens) onCompleted(undefined);
      });
    },
  });
}

export function streamLlamacppMsg(ctx: ChatCtx, msg: ResolvedMsg, assistantId: string) {
  const contextMessages = contextPrefixMessages(msg._contextPrefix);
  const trimmed = trimHistoryToFit(ctx.state.llamacppHistory, msg.text, [AGENTIC_SYSTEM, ...contextMessages]);
  const requestHistory = [AGENTIC_SYSTEM, ...contextMessages, ...trimmed, { role: "user" as const, content: msg.text }];

  runStream({
    ctx, assistantId, route: "local",
    start: (h) => {
      const handle = llamacppAdapter.stream(requestHistory, {
        onChunk: h.onChunk,
        llamacpp: llamacppOptsFromMsg(msg),
        workingDir: ctx.projectRoot,
      });
      h.setCancel(() => handle.cancel());
      handle.done.then((result) => {
        if (h.isAborted()) return;
        if (!result.ok) {
          if (!h.isEnded()) { h.postStreamEnd(); h.safeEnd(); }
          ctx.postError("local", result.error ?? "unknown error");
          return;
        }
        finalizeStream(h, ctx, assistantId, "local", { pushLlamacpp: true, userText: msg.text, model: msg.llamacppModel });
        h.safeEnd();
      });
    },
  });
}

export function streamHybridMsg(ctx: ChatCtx, msg: ResolvedMsg, assistantId: string) {
  const contextMessages = contextPrefixMessages(msg._contextPrefix);
  const trimmed = trimHistoryToFit(ctx.state.llamacppHistory, msg.text, [AGENTIC_SYSTEM, ...contextMessages]);
  const history = [...contextMessages, ...trimmed];

  // Migrated to RouterAdapter: error / cancel / done are normalized in
  // a single Promise<StreamResult> so the harness sees one shape
  // regardless of backend. Compare to streamClaudeMsg + streamLlamacppMsg
  // for the legacy callback patterns those routes still use.
  runStream({
    ctx, assistantId, route: "hybrid",
    preludeChunk: "[HME] Enriching with KB context…",
    start: (h) => {
      const handle = hybridAdapter.stream(
        { message: msg.text, history, workingDir: ctx.projectRoot },
        {
          onChunk: h.onChunk,
          llamacpp: llamacppOptsFromMsg(msg),
        },
      );
      h.setCancel(() => handle.cancel());
      handle.done.then((result) => {
        if (h.isAborted()) return;
        if (!result.ok) {
          if (!h.isEnded()) { h.postStreamEnd(); h.safeEnd(); }
          ctx.postError("hybrid", result.error ?? "unknown error");
          return;
        }
        finalizeStream(h, ctx, assistantId, "hybrid", { pushLlamacpp: true, userText: msg.text, model: msg.llamacppModel });
        h.safeEnd();
      }).catch((err: any) => {
        // RouterAdapter contract says result.error carries failures, not
        // a rejected promise — but defend against legacy implementations
        // that might still throw.
        if (!h.isEnded()) { h.postStreamEnd(); h.safeEnd(); }
        ctx.postError("hybrid", String(err?.message ?? err));
      });
    },
  });
}

export function streamAgentMsg(
  ctx: ChatCtx,
  msg: SendMsg,
  assistantId: string,
  label: "local" | "hybrid",
  onBothDone: () => void,
  onForceDrain: () => void,
  cancelFns: Array<() => void>,
) {
  const trimmed = trimHistoryToFit(ctx.state.llamacppHistory, msg.text, [AGENTIC_SYSTEM]);
  const requestHistory = [AGENTIC_SYSTEM, ...trimmed, { role: "user" as const, content: msg.text }];

  const { cancel } = runStream({
    ctx, assistantId, route: label,
    ownCancel: false, drainOnEnd: false, onEnd: onBothDone,
    start: (h) => {
      const onDone = () => {
        if (h.isAborted()) return;
        finalizeStream(h, ctx, assistantId, label, {
          pushLlamacpp: label === "local", userText: msg.text,
          model: msg.llamacppModel, skipMirror: true,
        });
        h.safeEnd();
      };
      h.setCancel(streamLlamacppAgentic(
        requestHistory,
        llamacppOptsFromMsg(msg),
        ctx.projectRoot, h.onChunk, onDone,
        (err) => {
          ctx.postError(label, err);
          if (h.isEnded()) return;
          h.markEnded();
          h.postStreamEnd();
          onForceDrain();
        },
      ));
    },
  });
  cancelFns.push(cancel);
}

export function streamAgentHybridMsg(
  ctx: ChatCtx,
  msg: SendMsg,
  assistantId: string,
  label: "local" | "hybrid",
  onBothDone: () => void,
  onForceDrain: () => void,
  cancelFns: Array<() => void>,
) {
  const history = trimHistoryToFit(ctx.state.llamacppHistory, msg.text, [AGENTIC_SYSTEM]);

  const { cancel } = runStream({
    ctx, assistantId, route: "hybrid",
    preludeChunk: "[HME] Enriching with KB context…",
    ownCancel: false, drainOnEnd: false, onEnd: onBothDone,
    start: (h) => {
      const onDone = () => {
        if (h.isAborted()) return;
        finalizeStream(h, ctx, assistantId, "hybrid", { model: msg.llamacppModel, skipMirror: true });
        h.safeEnd();
      };
      const onError = (err: string) => {
        if (h.isAborted()) return;
        ctx.postError(label, err);
        if (h.isEnded()) return;
        h.markEnded();
        h.postStreamEnd();
        onForceDrain();
      };
      attachPromiseCancel(
        h,
        streamHybrid(msg.text, history, llamacppOptsFromMsg(msg), ctx.projectRoot, h.onChunk, onDone, onError),
        (err) => ctx.postError(label, err),
        onForceDrain,
      );
    },
  });
  cancelFns.push(cancel);
}
