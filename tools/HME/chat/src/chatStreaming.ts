import * as path from "path";
import {
  OllamaMessage, TokenUsage,
  streamClaude, streamClaudePty, streamOllamaAgentic, streamHybrid,
  postTranscript, reindexFiles, auditChanges,
} from "./router";
import { ChatCtx, StreamTracker, makeBlockAccumulator, trimHistoryToFit } from "./streamUtils";

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
    reindexFiles(indexable).catch(() => {});
  }
  return files;
}

export function runPostAudit(ctx: ChatCtx, changedFiles?: Set<string>) {
  const filesArg = changedFiles?.size ? [...changedFiles].join(",") : "";
  auditChanges(filesArg).then(({ violations, changed_files }) => {
    ctx.transcript.logAudit(changed_files.length, violations.length);
    if (violations.length > 0) {
      const summary = violations
        .map((v: any) => `• [${v.category}] ${v.file}: ${v.title}`)
        .join("\n");
      ctx.post({ type: "notice", level: "audit", text: `HME post-audit (${changed_files.length} files changed):\n${summary}` });
    }
  }).catch((e: any) => ctx.postError("audit", String(e)));
}

// ── Chunk accumulation state + shared onChunk factory ────────────────────────

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

// ── Streaming methods ─────────────────────────────────────────────────────────

const AGENTIC_SYSTEM: OllamaMessage = {
  role: "system",
  content: "You are an agentic coding assistant with access to bash, read_file, and write_file tools. When asked to perform a task — create files, edit code, run commands, implement features — call the appropriate tool immediately. Never respond with suggestions, plans, or code blocks without calling a tool first.",
};

export function streamClaudeMsg(ctx: ChatCtx, msg: any, assistantId: string) {
  const state: ChunkState = { text: "", thinking: "", tools: [] };
  const acc = makeBlockAccumulator();
  let streamEnded = false;
  let aborted = false;
  const route = msg._resolvedRoute ?? msg.route ?? "claude";
  const tracker = ctx.trackStream(assistantId, route);
  const safeEnd = () => { if (!streamEnded) { streamEnded = true; ctx.drainQueue(); } };
  const onChunk = makeOnChunk(ctx, assistantId, acc, state, tracker, route, {
    abortCheck: () => aborted,
    handleError: (chunk) => ctx.postError("claude", chunk),
  });

  const onDone = (usage?: TokenUsage) => {
    if (aborted) return;
    ctx.updateContextTracker(state.text, state.thinking, msg.claudeModel, usage);
    tracker.finalize({
      id: assistantId, role: "assistant", text: state.text,
      thinking: state.thinking || undefined,
      tools: state.tools.length ? state.tools : undefined,
      blocks: acc.blocks.length ? acc.blocks : undefined,
      route, ts: Date.now(),
    });
    ctx.post({ type: "streamEnd", id: assistantId });
    ctx.transcript.logAssistant(state.text, route, msg.claudeModel, state.tools);
    mirrorAssistantToShim(ctx, state.text, route, msg.claudeModel, state.tools);
    const changedFiles = reindexFromTools(state.tools);
    runPostAudit(ctx, changedFiles);
    ctx.checkChainThreshold(msg);
    safeEnd();
  };

  const onError = (err: string) => {
    if (aborted) return;
    if (!streamEnded) { ctx.post({ type: "streamEnd", id: assistantId }); safeEnd(); }
    ctx.postError("claude", err);
  };

  const effectiveText = (msg._contextPrefix ?? "") + msg.text;
  let cancelFn: (() => void) | undefined;
  ctx.setCancelCurrent(() => { aborted = true; cancelFn?.(); });
  cancelFn = streamClaudePty(
    effectiveText, ctx.state.claudeSessionId,
    { model: msg.claudeModel, effort: msg.claudeEffort, thinking: msg.claudeThinking, permissionMode: "bypassPermissions" },
    ctx.projectRoot, onChunk as any,
    (sessionId) => { ctx.state.claudeSessionId = sessionId; },
    onDone,
    (err) => {
      console.log(`[HME Chat] PTY unavailable (${err}), falling back to -p mode`);
      cancelFn = streamClaude(
        effectiveText, ctx.state.claudeSessionId,
        { model: msg.claudeModel, effort: msg.claudeEffort, thinking: msg.claudeThinking, permissionMode: "bypassPermissions" },
        ctx.projectRoot, onChunk as any,
        (sessionId) => { ctx.state.claudeSessionId = sessionId; },
        (_cost, usage) => { onDone(usage); },
        onError
      );
    }
  );
}

export function streamOllamaMsg(ctx: ChatCtx, msg: any, assistantId: string) {
  const contextMessages: OllamaMessage[] = msg._contextPrefix
    ? [{ role: "user" as const, content: msg._contextPrefix }, { role: "assistant" as const, content: "Understood. I have the prior conversation context." }]
    : [];
  const trimmed = trimHistoryToFit(ctx.state.ollamaHistory, msg.text, [AGENTIC_SYSTEM, ...contextMessages]);
  const requestHistory = [AGENTIC_SYSTEM, ...contextMessages, ...trimmed, { role: "user" as const, content: msg.text }];

  const state: ChunkState = { text: "", thinking: "", tools: [] };
  const acc = makeBlockAccumulator();
  let streamEnded = false;
  let aborted = false;
  const tracker = ctx.trackStream(assistantId, "local");
  const safeEnd = () => { if (!streamEnded) { streamEnded = true; ctx.drainQueue(); } };
  const onChunk = makeOnChunk(ctx, assistantId, acc, state, tracker, "local", { abortCheck: () => aborted });

  const onDone = () => {
    if (aborted) return;
    ctx.state.ollamaHistory.push({ role: "user", content: msg.text });
    ctx.state.ollamaHistory.push({ role: "assistant", content: state.text });
    tracker.finalize({
      id: assistantId, role: "assistant", text: state.text,
      tools: state.tools.length ? state.tools : undefined,
      blocks: acc.blocks.length ? acc.blocks : undefined,
      route: "local", ts: Date.now(),
    });
    ctx.post({ type: "streamEnd", id: assistantId });
    ctx.transcript.logAssistant(state.text, "local", msg.ollamaModel, state.tools);
    mirrorAssistantToShim(ctx, state.text, "local", msg.ollamaModel, state.tools);
    const changedFiles = reindexFromTools(state.tools);
    runPostAudit(ctx, changedFiles);
    safeEnd();
  };

  let ollamaCancelFn: (() => void) | undefined;
  ctx.setCancelCurrent(() => { aborted = true; ollamaCancelFn?.(); });
  ollamaCancelFn = streamOllamaAgentic(
    requestHistory,
    { model: msg.ollamaModel, url: "http://localhost:11434" },
    ctx.projectRoot, onChunk, onDone,
    (err) => {
      if (!streamEnded) { ctx.post({ type: "streamEnd", id: assistantId }); safeEnd(); }
      ctx.postError("local", err);
    }
  );
}

export function streamHybridMsg(ctx: ChatCtx, msg: any, assistantId: string) {
  const contextMessages: OllamaMessage[] = msg._contextPrefix
    ? [{ role: "user" as const, content: msg._contextPrefix }, { role: "assistant" as const, content: "Understood. I have the prior conversation context." }]
    : [];
  const history = [...contextMessages, ...ctx.state.ollamaHistory];
  const state: ChunkState = { text: "", thinking: "", tools: [] };
  const acc = makeBlockAccumulator();
  let cancelFn: (() => void) | undefined;
  let aborted = false;
  let streamEnded = false;
  const tracker = ctx.trackStream(assistantId, "hybrid");
  const safeEnd = () => { if (!streamEnded) { streamEnded = true; ctx.drainQueue(); } };
  const onChunk = makeOnChunk(ctx, assistantId, acc, state, tracker, "hybrid", { abortCheck: () => aborted });

  ctx.setCancelCurrent(() => { aborted = true; cancelFn?.(); });
  ctx.post({ type: "streamChunk", id: assistantId, chunkType: "tool", chunk: "[HME] Enriching with KB context…" });
  acc.append("tool", "[HME] Enriching with KB context…");

  streamHybrid(
    msg.text, history,
    { model: msg.ollamaModel, url: "http://localhost:11434" },
    ctx.projectRoot, onChunk,
    () => {
      if (aborted) return;
      ctx.state.ollamaHistory.push({ role: "user", content: msg.text });
      ctx.state.ollamaHistory.push({ role: "assistant", content: state.text });
      tracker.finalize({
        id: assistantId, role: "assistant", text: state.text,
        tools: state.tools.length ? state.tools : undefined,
        blocks: acc.blocks.length ? acc.blocks : undefined,
        route: "hybrid", ts: Date.now(),
      });
      ctx.post({ type: "streamEnd", id: assistantId });
      ctx.transcript.logAssistant(state.text, "hybrid", msg.ollamaModel, state.tools);
      mirrorAssistantToShim(ctx, state.text, "hybrid", msg.ollamaModel, state.tools);
      const changedFiles = reindexFromTools(state.tools);
      runPostAudit(ctx, changedFiles);
      safeEnd();
    },
    (err) => {
      if (aborted) return;
      if (!streamEnded) { ctx.post({ type: "streamEnd", id: assistantId }); safeEnd(); }
      ctx.postError("hybrid", err);
    }
  ).then((cancel) => {
    if (aborted) { cancel(); return; }
    cancelFn = cancel;
  }).catch((err) => {
    if (aborted) return;
    if (!streamEnded) { ctx.post({ type: "streamEnd", id: assistantId }); safeEnd(); }
    ctx.postError("hybrid", String(err));
  });
}

export function streamAgentMsg(
  ctx: ChatCtx,
  msg: any,
  assistantId: string,
  label: "local" | "hybrid",
  onBothDone: () => void,
  onForceDrain: () => void,
  cancelFns: Array<() => void>
) {
  const trimmed = trimHistoryToFit(ctx.state.ollamaHistory, msg.text, [AGENTIC_SYSTEM]);
  const requestHistory = [AGENTIC_SYSTEM, ...trimmed, { role: "user" as const, content: msg.text }];
  const state: ChunkState = { text: "", thinking: "", tools: [] };
  const acc = makeBlockAccumulator();
  let streamEnded = false;
  const tracker = ctx.trackStream(assistantId, label);
  const safeEnd = () => { if (!streamEnded) { streamEnded = true; onBothDone(); } };
  const onChunk = makeOnChunk(ctx, assistantId, acc, state, tracker, label);

  const onDone = () => {
    if (label === "local") {
      ctx.state.ollamaHistory.push({ role: "user", content: msg.text });
      ctx.state.ollamaHistory.push({ role: "assistant", content: state.text });
    }
    tracker.finalize({
      id: assistantId, role: "assistant", text: state.text,
      tools: state.tools.length ? state.tools : undefined,
      blocks: acc.blocks.length ? acc.blocks : undefined,
      route: label, ts: Date.now(),
    });
    ctx.post({ type: "streamEnd", id: assistantId });
    ctx.transcript.logAssistant(state.text, label, msg.ollamaModel, state.tools);
    const changedFiles = reindexFromTools(state.tools);
    runPostAudit(ctx, changedFiles);
    safeEnd();
  };

  const cancel = streamOllamaAgentic(
    requestHistory,
    { model: msg.ollamaModel, url: "http://localhost:11434" },
    ctx.projectRoot, onChunk, onDone,
    (err) => {
      ctx.postError(label, err);
      if (!streamEnded) { streamEnded = true; ctx.post({ type: "streamEnd", id: assistantId }); onForceDrain(); }
    }
  );
  cancelFns.push(cancel);
}

export function streamAgentHybridMsg(
  ctx: ChatCtx,
  msg: any,
  assistantId: string,
  label: "local" | "hybrid",
  onBothDone: () => void,
  onForceDrain: () => void,
  cancelFns: Array<() => void>
) {
  const history = trimHistoryToFit(ctx.state.ollamaHistory, msg.text);
  const state: ChunkState = { text: "", thinking: "", tools: [] };
  const acc = makeBlockAccumulator();
  let aborted = false;
  let streamEnded = false;
  const tracker = ctx.trackStream(assistantId, "hybrid");
  const safeEnd = () => { if (!streamEnded) { streamEnded = true; onBothDone(); } };
  const onChunk = makeOnChunk(ctx, assistantId, acc, state, tracker, "hybrid", { abortCheck: () => aborted });

  cancelFns.push(() => { aborted = true; });
  ctx.post({ type: "streamChunk", id: assistantId, chunkType: "tool", chunk: "[HME] Enriching with KB context…" });
  acc.append("tool", "[HME] Enriching with KB context…");

  streamHybrid(
    msg.text, history,
    { model: msg.ollamaModel, url: "http://localhost:11434" },
    ctx.projectRoot, onChunk,
    () => {
      if (aborted) return;
      tracker.finalize({
        id: assistantId, role: "assistant", text: state.text,
        tools: state.tools.length ? state.tools : undefined,
        blocks: acc.blocks.length ? acc.blocks : undefined,
        route: "hybrid", ts: Date.now(),
      });
      ctx.post({ type: "streamEnd", id: assistantId });
      ctx.transcript.logAssistant(state.text, "hybrid", msg.ollamaModel, state.tools);
      const changedFiles = reindexFromTools(state.tools);
      runPostAudit(ctx, changedFiles);
      safeEnd();
    },
    (err) => {
      if (aborted) return;
      ctx.postError(label, err);
      if (!streamEnded) { streamEnded = true; ctx.post({ type: "streamEnd", id: assistantId }); onForceDrain(); }
    }
  ).then((cancel) => {
    if (aborted) { cancel(); return; }
    cancelFns.push(cancel);
  }).catch((err) => {
    if (aborted) return;
    ctx.postError(label, String(err));
    if (!streamEnded) { streamEnded = true; ctx.post({ type: "streamEnd", id: assistantId }); onForceDrain(); }
  });
}
