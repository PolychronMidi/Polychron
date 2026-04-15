// Router barrel — types and re-exports from split modules.

export type Route = "claude" | "local" | "hybrid" | "agent";

export interface ClaudeOptions {
  model: string;
  effort: string;
  thinking: boolean;
  permissionMode: string;
}

export interface LlamacppOptions {
  model: string;
  url: string;
}

export interface LlamacppMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface RouterOptions {
  route: Route;
  claude: ClaudeOptions;
  llamacpp: LlamacppOptions;
  workingDir: string;
}

export type ChunkCallback = (text: string, type: "text" | "thinking" | "tool" | "error") => void;

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  usedPct?: number;
  modelId?: string;
  modelName?: string;
}

// Re-export all functions from split modules so existing imports from "./router" keep working.
export { streamClaude, streamClaudePty } from "./routerClaude";
export { streamllama.cpp, streamLlamacppAgentic, streamLlamacpp, streamLlamacppAgentic, GPU_NUM_CTX } from "./routerLlamacpp";
export {
  fetchHmeContext,
  enrichPrompt,
  validateMessage,
  auditChanges,
  postTranscript,
  reindexFiles,
  postNarrative,
  isHmeShimReady,
  logShimError,
  streamHybrid,
} from "./routerHme";
export type { EnrichResult, EnrichPromptResult } from "./routerHme";
