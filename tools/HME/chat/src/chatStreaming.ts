import * as path from "path";
import {
  OllamaMessage, TokenUsage,
  streamClaude, streamClaudePty, streamOllamaAgentic, streamHybrid,
  postTranscript, reindexFiles, auditChanges,
} from "./router";
import { ChatMessage } from "./types";
import { ChatCtx, makeBlockAccumulator, trimHistoryToFit, uid } from "./streamUtils";

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

// ── Streaming methods ─────────────────────────────────────────────────────────

const AGENTIC_SYSTEM: OllamaMessage = {
  role: "system",
  content: "You are an agentic coding assistant with access to bash, read_file, and write_file tools. When asked to perform a task — create files, edit code, run commands, implement features — call the appropriate tool immediately. Never respond with suggestions, plans, or code blocks without calling a tool first.",
};

export function streamClaudeMsg(ctx: ChatCtx, msg: any, assistantId: string) {
  let text = "";
  let thinking = "";
  let tools: string[] = [];
  const acc = makeBlockAccumulator();
  let streamEnded = false;
  let aborted = false;
  const tracker = ctx.trackStream(assistantId, msg._resolvedRoute ?? msg.route);
  const safeEnd = () => { if (!streamEnded) { streamEnded = true; ctx.drainQueue(); } };

  const onDone = (usage?: TokenUsage) => {
    if (aborted) return;
    ctx.updateContextTracker(text, thinking, msg.claudeModel, usage);
    const assistantMsg: ChatMessage = {
      id: assistantId, role: "assistant", text,
      thinking: thinking || undefined,
      tools: tools.length ? tools : undefined,
      blocks: acc.blocks.length ? acc.blocks : undefined,
      route: msg._resolvedRoute ?? msg.route,
      ts: Date.now(),
    };
    tracker.finalize(assistantMsg);
    ctx.post({ type: "streamEnd", id: assistantId });
    ctx.transcript.logAssistant(text, msg._resolvedRoute ?? msg.route ?? "claude", msg.claudeModel, tools);
    mirrorAssistantToShim(ctx, text, msg._resolvedRoute ?? msg.route ?? "claude", msg.claudeModel, tools);
    const changedFiles = reindexFromTools(tools);
    runPostAudit(ctx, changedFiles);
    ctx.checkChainThreshold(msg);
    safeEnd();
  };

  const onChunk = (chunk: string, type: string) => {
    if (aborted) return;
    if (type === "text") {
      text += chunk; acc.append("text", chunk);
      ctx.post({ type: "streamChunk", id: assistantId, chunkType: "text", chunk });
    } else if (type === "thinking") {
      thinking += chunk; acc.append("thinking", chunk);
      ctx.post({ type: "streamChunk", id: assistantId, chunkType: "thinking", chunk });
    } else if (type === "tool") {
      tools.push(chunk); acc.append("tool", chunk);
      ctx.post({ type: "streamChunk", id: assistantId, chunkType: "tool", chunk });
      ctx.transcript.logToolCall(chunk.split("]")[0].replace("[", ""), chunk, msg._resolvedRoute ?? msg.route ?? "claude");
    } else if (type === "error") {
      ctx.postError("claude", chunk);
    }
    tracker.update(text, tools, thinking);
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

  let text = "";
  let tools: string[] = [];
  const acc = makeBlockAccumulator();
  let streamEnded = false;
  let aborted = false;
  const tracker = ctx.trackStream(assistantId, "local");
  const safeEnd = () => { if (!streamEnded) { streamEnded = true; ctx.drainQueue(); } };

  const onDone = () => {
    if (aborted) return;
    ctx.state.ollamaHistory.push({ role: "user", content: msg.text });
    ctx.state.ollamaHistory.push({ role: "assistant", content: text });
    tracker.finalize({
      id: assistantId, role: "assistant", text,
      tools: tools.length ? tools : undefined,
      blocks: acc.blocks.length ? acc.blocks : undefined,
      route: "local", ts: Date.now(),
    });
    ctx.post({ type: "streamEnd", id: assistantId });
    ctx.transcript.logAssistant(text, "local", msg.ollamaModel, tools);
    mirrorAssistantToShim(ctx, text, "local", msg.ollamaModel, tools);
    const changedFiles = reindexFromTools(tools);
    runPostAudit(ctx, changedFiles);
    safeEnd();
  };

  const onChunk = (chunk: string, type: string) => {
    if (aborted) return;
    if (type === "tool") {
      tools.push(chunk); acc.append("tool", chunk);
      ctx.post({ type: "streamChunk", id: assistantId, chunkType: "tool", chunk });
      ctx.transcript.logToolCall(chunk.split("]")[0].replace("[", ""), chunk, "local");
    } else {
      text += chunk; acc.append(type === "thinking" ? "thinking" : "text", chunk);
      ctx.post({ type: "streamChunk", id: assistantId, chunkType: type, chunk });
    }
    tracker.update(text, tools);
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
  let text = "";
  let tools: string[] = [];
  const acc = makeBlockAccumulator();
  let cancelFn: (() => void) | undefined;
  let aborted = false;
  let streamEnded = false;
  const tracker = ctx.trackStream(assistantId, "hybrid");
  const safeEnd = () => { if (!streamEnded) { streamEnded = true; ctx.drainQueue(); } };

  ctx.setCancelCurrent(() => { aborted = true; cancelFn?.(); });
  ctx.post({ type: "streamChunk", id: assistantId, chunkType: "tool", chunk: "[HME] Enriching with KB context…" });
  acc.append("tool", "[HME] Enriching with KB context…");

  streamHybrid(
    msg.text, history,
    { model: msg.ollamaModel, url: "http://localhost:11434" },
    ctx.projectRoot,
    (chunk, type) => {
      if (aborted) return;
      if (type === "tool") {
        tools.push(chunk); acc.append("tool", chunk);
        ctx.post({ type: "streamChunk", id: assistantId, chunkType: "tool", chunk });
        ctx.transcript.logToolCall(chunk.split("]")[0].replace("[", ""), chunk, "hybrid");
      } else {
        text += chunk; acc.append(type === "thinking" ? "thinking" : "text", chunk);
        ctx.post({ type: "streamChunk", id: assistantId, chunkType: type, chunk });
      }
      tracker.update(text, tools);
    },
    () => {
      if (aborted) return;
      ctx.state.ollamaHistory.push({ role: "user", content: msg.text });
      ctx.state.ollamaHistory.push({ role: "assistant", content: text });
      tracker.finalize({
        id: assistantId, role: "assistant", text,
        tools: tools.length ? tools : undefined,
        blocks: acc.blocks.length ? acc.blocks : undefined,
        route: "hybrid", ts: Date.now(),
      });
      ctx.post({ type: "streamEnd", id: assistantId });
      ctx.transcript.logAssistant(text, "hybrid", msg.ollamaModel, tools);
      mirrorAssistantToShim(ctx, text, "hybrid", msg.ollamaModel, tools);
      const changedFiles = reindexFromTools(tools);
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
  let text = "";
  let tools: string[] = [];
  const acc = makeBlockAccumulator();
  let streamEnded = false;
  const tracker = ctx.trackStream(assistantId, label);
  const safeEnd = () => { if (!streamEnded) { streamEnded = true; onBothDone(); } };

  const onDone = () => {
    if (label === "local") {
      ctx.state.ollamaHistory.push({ role: "user", content: msg.text });
      ctx.state.ollamaHistory.push({ role: "assistant", content: text });
    }
    tracker.finalize({
      id: assistantId, role: "assistant", text,
      tools: tools.length ? tools : undefined,
      blocks: acc.blocks.length ? acc.blocks : undefined,
      route: label, ts: Date.now(),
    });
    ctx.post({ type: "streamEnd", id: assistantId });
    ctx.transcript.logAssistant(text, label, msg.ollamaModel, tools);
    const changedFiles = reindexFromTools(tools);
    runPostAudit(ctx, changedFiles);
    safeEnd();
  };

  const onChunk = (chunk: string, type: string) => {
    if (type === "tool") {
      tools.push(chunk); acc.append("tool", chunk);
      ctx.post({ type: "streamChunk", id: assistantId, chunkType: "tool", chunk });
      ctx.transcript.logToolCall(chunk.split("]")[0].replace("[", ""), chunk, label);
    } else {
      text += chunk; acc.append(type === "thinking" ? "thinking" : "text", chunk);
      ctx.post({ type: "streamChunk", id: assistantId, chunkType: type, chunk });
    }
    tracker.update(text, tools);
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
  let text = "";
  let tools: string[] = [];
  const acc = makeBlockAccumulator();
  let aborted = false;
  let streamEnded = false;
  const tracker = ctx.trackStream(assistantId, "hybrid");
  const safeEnd = () => { if (!streamEnded) { streamEnded = true; onBothDone(); } };

  cancelFns.push(() => { aborted = true; });
  ctx.post({ type: "streamChunk", id: assistantId, chunkType: "tool", chunk: "[HME] Enriching with KB context…" });
  acc.append("tool", "[HME] Enriching with KB context…");

  streamHybrid(
    msg.text, history,
    { model: msg.ollamaModel, url: "http://localhost:11434" },
    ctx.projectRoot,
    (chunk, type) => {
      if (aborted) return;
      if (type === "tool") {
        tools.push(chunk); acc.append("tool", chunk);
        ctx.post({ type: "streamChunk", id: assistantId, chunkType: "tool", chunk });
        ctx.transcript.logToolCall(chunk.split("]")[0].replace("[", ""), chunk, "hybrid");
      } else {
        text += chunk; acc.append(type === "thinking" ? "thinking" : "text", chunk);
        ctx.post({ type: "streamChunk", id: assistantId, chunkType: type, chunk });
      }
      tracker.update(text, tools);
    },
    () => {
      if (aborted) return;
      tracker.finalize({
        id: assistantId, role: "assistant", text,
        tools: tools.length ? tools : undefined,
        blocks: acc.blocks.length ? acc.blocks : undefined,
        route: "hybrid", ts: Date.now(),
      });
      ctx.post({ type: "streamEnd", id: assistantId });
      ctx.transcript.logAssistant(text, "hybrid", msg.ollamaModel, tools);
      const changedFiles = reindexFromTools(tools);
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
