import { ClaudeOptions, LlamacppOptions } from "./router";

export const LLAMACPP_URL = process.env.HME_LLAMACPP_ARBITER_URL ?? "http://127.0.0.1:8080";

// ── Claude config validation & resolution ─────────────────────────────────────

const VALID_MODEL_ALIASES = new Set(["opus", "sonnet", "haiku"]);
const VALID_EFFORTS = new Set(["low", "medium", "high", "max"]);

const MODEL_ID_MAP: Record<string, string> = {
  opus: "claude-opus-4-7",
  sonnet: "claude-sonnet-4-6",
  haiku: "claude-haiku-4-5-20251001",
};

export interface ClaudeConfig {
  model: string;      // alias: "opus" | "sonnet" | "haiku"
  effort: string;     // "low" | "medium" | "high" | "max"
  thinking: boolean;
}

export interface ResolvedClaudeConfig {
  alias: string;           // the short name ("sonnet")
  modelId: string;         // full CLI id ("claude-sonnet-4-6")
  cliEffort: string;       // the actual --effort value: low|medium|high|xhigh|max
  thinking: boolean;       // requested flag (informational)
}

/** Throws on invalid config. Called by BrowserPanel.setClaudeConfig. */
export function validateClaudeConfig(cfg: Partial<ClaudeConfig>): ClaudeConfig {
  if (!cfg.model || !VALID_MODEL_ALIASES.has(cfg.model)) {
    throw new Error(`Invalid claude model: ${JSON.stringify(cfg.model)} (expected opus|sonnet|haiku)`);
  }
  if (!cfg.effort || !VALID_EFFORTS.has(cfg.effort)) {
    throw new Error(`Invalid claude effort: ${JSON.stringify(cfg.effort)} (expected low|medium|high|max)`);
  }
  if (typeof cfg.thinking !== "boolean") {
    throw new Error(`Invalid claude thinking: ${JSON.stringify(cfg.thinking)} (expected boolean)`);
  }
  // Haiku does not support effort/thinking — force to medium/false.
  if (cfg.model === "haiku") {
    return { model: "haiku", effort: "medium", thinking: false };
  }
  // Max effort implies thinking is on (the tier produces it).
  if (cfg.effort === "max") {
    return { model: cfg.model, effort: "max", thinking: true };
  }
  return { model: cfg.model, effort: cfg.effort, thinking: cfg.thinking };
}

/** Resolve validated config → full CLI args. Effort "high" + thinking=true becomes "xhigh". */
export function resolveClaudeConfig(cfg: ClaudeConfig): ResolvedClaudeConfig {
  const modelId = MODEL_ID_MAP[cfg.model];
  if (!modelId) throw new Error(`Unmapped model alias: ${cfg.model}`);
  let cliEffort = cfg.effort;
  if (cfg.thinking && cfg.effort === "high") cliEffort = "xhigh";
  return { alias: cfg.model, modelId, cliEffort, thinking: cfg.thinking };
}

export function claudeOptsFromConfig(resolved: ResolvedClaudeConfig): ClaudeOptions {
  return {
    model: resolved.modelId,
    effort: resolved.cliEffort,
    thinking: resolved.thinking,
    permissionMode: "bypassPermissions",
  };
}

// Legacy helper — still used by send flow. Validates msg.claudeModel/Effort/Thinking then resolves.
export function claudeOptsFromMsg(msg: any): ClaudeOptions {
  const cfg = validateClaudeConfig({
    model: msg.claudeModel,
    effort: msg.claudeEffort,
    thinking: msg.claudeThinking,
  });
  return claudeOptsFromConfig(resolveClaudeConfig(cfg));
}

export function llamacppOptsFromMsg(msg: any): LlamacppOptions {
  return { model: msg.llamacppModel, url: LLAMACPP_URL };
}
