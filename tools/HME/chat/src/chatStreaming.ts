import * as path from "path";
import {
  OllamaMessage, TokenUsage,
  streamClaude, streamClaudePty, streamOllamaAgentic, streamHybrid,
  postTranscript, reindexFiles, auditChanges,
} from "./router";
import { ChatCtx, StreamTracker, makeBlockAccumulator, trimHistoryToFit, AGENTIC_SYSTEM_PROMPT } from "./streamUtils";
import { claudeOptsFromMsg, ollamaOptsFromMsg } from "./msgHelpers";
import { ChatMessage } from "./types";
import type { SendMsg } from "./panel/webviewMessages";

// ── Helpers ───────────────────────────────────────────────────────────────────

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
    const ollamaMatch = t.match(/\[(write_file|read_file|bash)\]\s*\{[^}]*"path"\s*:\s*"([^"]+)"/);
    if (ollamaMatch) files.add(ollamaMatch[2]);
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

// ── Stream harness ────────────────────────────────────────────────────────────

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
  pushOllama?: boolean;
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
  if (opts.pushOllama && opts.userText !== undefined) {
    ctx.state.ollamaHistory.push({ role: "user", content: opts.userText });
    ctx.state.ollamaHistory.push({ role: "assistant", content: h.state.text });
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

// ── Streaming methods ─────────────────────────────────────────────────────────

/** SendMsg enriched by _onSend before routing to a specific stream function. */
type ResolvedMsg = SendMsg & { _resolvedRoute?: string; _contextPrefix?: string };

const AGENTIC_SYSTEM: OllamaMessage = { role: "system", content: AGENTIC_SYSTEM_PROMPT };

function contextPrefixMessages(prefix: string | undefined): OllamaMessage[] {
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

  runStream({
    ctx, assistantId, route,
    start: (h) => {
      const onDone = (usage?: TokenUsage) => {
        if (h.isAborted()) return;
        ctx.updateContextTracker(h.state.text, h.state.thinking, msg.claudeModel, usage);
        finalizeStream(h, ctx, assistantId, route, { includeThinking: true, model: msg.claudeModel, checkChain: true });
        h.safeEnd();
      };
      const onError = (err: string) => {
        if (h.isAborted()) return;
        if (!h.isEnded()) { h.postStreamEnd(); h.safeEnd(); }
        ctx.postError("claude", err);
      };
      const startPipe = () => streamClaude(
        effectiveText, ctx.state.claudeSessionId,
        claudeOpts,
        ctx.projectRoot, h.onChunk as any,
        (sessionId) => { ctx.state.claudeSessionId = sessionId; },
        (_cost, usage) => { onDone(usage); },
        onError,
      );
      h.setCancel(streamClaudePty(
        effectiveText, ctx.state.claudeSessionId,
        claudeOpts,
        ctx.projectRoot, h.onChunk as any,
        (sessionId) => { ctx.state.claudeSessionId = sessionId; },
        onDone,
        (err) => {
          console.log(`[HME Chat] PTY unavailable (${err}), falling back to -p mode`);
          h.setCancel(startPipe());
        },
        ctx.mirrorPty ? (raw) => ctx.mirrorPty!.onRawData(raw) : undefined,
        ctx.mirrorPty ? (fn) => ctx.mirrorPty!.onPtyReady(fn) : undefined,
      ));
    },
  });
}

export function streamOllamaMsg(ctx: ChatCtx, msg: ResolvedMsg, assistantId: string) {
  const contextMessages = contextPrefixMessages(msg._contextPrefix);
  const trimmed = trimHistoryToFit(ctx.state.ollamaHistory, msg.text, [AGENTIC_SYSTEM, ...contextMessages]);
  const requestHistory = [AGENTIC_SYSTEM, ...contextMessages, ...trimmed, { role: "user" as const, content: msg.text }];

  runStream({
    ctx, assistantId, route: "local",
    start: (h) => {
      const onDone = () => {
        if (h.isAborted()) return;
        finalizeStream(h, ctx, assistantId, "local", { pushOllama: true, userText: msg.text, model: msg.ollamaModel });
        h.safeEnd();
      };
      h.setCancel(streamOllamaAgentic(
        requestHistory,
        ollamaOptsFromMsg(msg),
        ctx.projectRoot, h.onChunk, onDone,
        (err) => {
          if (!h.isEnded()) { h.postStreamEnd(); h.safeEnd(); }
          ctx.postError("local", err);
        },
      ));
    },
  });
}

export function streamHybridMsg(ctx: ChatCtx, msg: ResolvedMsg, assistantId: string) {
  const contextMessages = contextPrefixMessages(msg._contextPrefix);
  const history = [...contextMessages, ...ctx.state.ollamaHistory];

  runStream({
    ctx, assistantId, route: "hybrid",
    preludeChunk: "[HME] Enriching with KB context…",
    start: (h) => {
      const onDone = () => {
        if (h.isAborted()) return;
        finalizeStream(h, ctx, assistantId, "hybrid", { pushOllama: true, userText: msg.text, model: msg.ollamaModel });
        h.safeEnd();
      };
      const onError = (err: string) => {
        if (h.isAborted()) return;
        if (!h.isEnded()) { h.postStreamEnd(); h.safeEnd(); }
        ctx.postError("hybrid", err);
      };
      attachPromiseCancel(
        h,
        streamHybrid(msg.text, history, ollamaOptsFromMsg(msg), ctx.projectRoot, h.onChunk, onDone, onError),
        (err) => ctx.postError("hybrid", err),
      );
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
  const trimmed = trimHistoryToFit(ctx.state.ollamaHistory, msg.text, [AGENTIC_SYSTEM]);
  const requestHistory = [AGENTIC_SYSTEM, ...trimmed, { role: "user" as const, content: msg.text }];

  const { cancel } = runStream({
    ctx, assistantId, route: label,
    ownCancel: false, drainOnEnd: false, onEnd: onBothDone,
    start: (h) => {
      const onDone = () => {
        if (h.isAborted()) return;
        finalizeStream(h, ctx, assistantId, label, {
          pushOllama: label === "local", userText: msg.text,
          model: msg.ollamaModel, skipMirror: true,
        });
        h.safeEnd();
      };
      h.setCancel(streamOllamaAgentic(
        requestHistory,
        ollamaOptsFromMsg(msg),
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
  const history = trimHistoryToFit(ctx.state.ollamaHistory, msg.text);

  const { cancel } = runStream({
    ctx, assistantId, route: "hybrid",
    preludeChunk: "[HME] Enriching with KB context…",
    ownCancel: false, drainOnEnd: false, onEnd: onBothDone,
    start: (h) => {
      const onDone = () => {
        if (h.isAborted()) return;
        finalizeStream(h, ctx, assistantId, "hybrid", { model: msg.ollamaModel, skipMirror: true });
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
        streamHybrid(msg.text, history, ollamaOptsFromMsg(msg), ctx.projectRoot, h.onChunk, onDone, onError),
        (err) => ctx.postError(label, err),
        onForceDrain,
      );
    },
  });
  cancelFns.push(cancel);
}
