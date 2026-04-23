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
export { streamClaude, streamClaudePty } from "./routers/routerClaude";
export { streamLlamacpp, streamLlamacppAgentic, GPU_NUM_CTX } from "./routers/routerLlamacpp";
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
} from "./routers/routerHme";
export type { EnrichResult, EnrichPromptResult } from "./routers/routerHme";

// Normalized Router interface (tonight's unification pass). New code
// should consume routers via RouterAdapter + StreamHandle; legacy
// streamXxxMsg() functions remain for compatibility.
export type { RouterAdapter, StreamHandle, StreamResult, BaseStreamOptions } from "./routers/RouterInterface";
export { wrapLegacyStream, makeResult } from "./routers/RouterInterface";
// Concrete adapters — one per backend, all normalized through the
// RouterAdapter interface. Use getAdapterForRoute() + runAdapter().
export {
  claudeAdapter, claudePtyAdapter, llamacppAdapter, hybridAdapter,
  getAdapterForRoute, runAdapter,
} from "./routers/adapters";
export type {
  ClaudeStreamInput, ClaudeStreamOptions, ClaudePtyStreamOptions,
  LlamacppStreamOptions,
  HybridStreamInput, HybridStreamOptions,
  StreamInput, StreamOpts,
} from "./routers/adapters";
