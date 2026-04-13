import { OllamaMessage, GPU_NUM_CTX, TokenUsage } from "./router";
import { ContentBlock, ChatMessage } from "./types";
import { TranscriptLogger } from "./TranscriptLogger";
import { SessionEntry } from "./SessionStore";

export const CHARS_PER_TOKEN = 3.5;
export const OLLAMA_OUTPUT_BUFFER = 4096;

export function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function estimateTokens(messages: { content: string }[]): number {
  let chars = 0;
  for (const m of messages) chars += m.content.length;
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

export function trimHistoryToFit(
  history: OllamaMessage[],
  currentMsg: string,
  extraMessages: OllamaMessage[] = []
): OllamaMessage[] {
  const budget = GPU_NUM_CTX - OLLAMA_OUTPUT_BUFFER;
  const fixedTokens = estimateTokens([...extraMessages, { content: currentMsg }]);
  const available = budget - fixedTokens;
  if (available <= 0) return [];
  let total = 0;
  let keepFrom = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const cost = Math.ceil(history[i].content.length / CHARS_PER_TOKEN);
    if (total + cost > available) { keepFrom = i + 1; break; }
    total += cost;
  }
  return history.slice(keepFrom);
}

export function makeBlockAccumulator() {
  const blocks: ContentBlock[] = [];
  let lastType: string | null = null;
  return {
    blocks,
    append(type: "thinking" | "text" | "tool", content: string) {
      if (type === "tool" || lastType !== type || blocks.length === 0) {
        blocks.push({ type, content });
      } else {
        blocks[blocks.length - 1].content += content;
      }
      lastType = type;
    },
  };
}

export interface SessionState {
  messages: ChatMessage[];
  claudeSessionId: string | null;
  ollamaHistory: OllamaMessage[];
  lastRoute: "claude" | "local" | "hybrid" | "agent" | null;
  sessionEntry: SessionEntry | null;
  chainIndex: number;
}

export interface ContextTracker {
  lastInputTokens: number | null;
  lastOutputTokens: number | null;
  usedPct: number | null;
  totalChars: number;
  model: string;
}

export interface StreamTracker {
  update(text: string, tools?: string[], thinking?: string): void;
  finalize(msg: ChatMessage): void;
}

export interface ChatCtx {
  readonly projectRoot: string;
  readonly transcript: TranscriptLogger;
  readonly state: SessionState;
  post(data: any): void;
  postError(source: string, message: string): void;
  drainQueue(): void;
  trackStream(id: string, route: string): StreamTracker;
  updateContextTracker(text: string, thinking: string, model: string, usage?: TokenUsage): void;
  checkChainThreshold(msg: any): void;
  setCancelCurrent(fn?: () => void): void;
}
