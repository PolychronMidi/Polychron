import { ClaudeOptions, LlamacppOptions } from "./router";

export const LLAMACPP_URL = process.env.HME_LLAMACPP_ARBITER_URL ?? "http://127.0.0.1:8080";

//  Claude config validation & resolution
//
// Claude CLI flags (verified from `claude --help`):
//   --model <alias|id>   opus | sonnet | haiku
//   --effort <level>     low | medium | high | xhigh | max
//   --settings <json>    inline JSON; supports { "alwaysThinkingEnabled": boolean }
//
// Thinking is **independent** of effort. The checkbox toggles alwaysThinkingEnabled
// at any effort level. We do not munge effort based on the thinking state.

const VALID_MODEL_ALIASES = new Set(["opus", "sonnet", "haiku"]);
const VALID_EFFORTS = new Set(["low", "medium", "high", "max"]);

export interface ClaudeConfig {
  model: string;
  effort: string;
  thinking: boolean;
}

export interface ResolvedClaudeConfig {
  alias: string;
  modelId: string;
  cliEffort: string;
  thinking: boolean;
}

/** Throws on invalid config. Haiku has no effort/thinking controls in the UI. */
export function validateClaudeConfig(cfg: Partial<ClaudeConfig>): ClaudeConfig {
  if (!cfg.model || !VALID_MODEL_ALIASES.has(cfg.model)) {
    throw new Error(`Invalid claude model: ${JSON.stringify(cfg.model)} (expected opus|sonnet|haiku)`);
  }
  if (typeof cfg.thinking !== "boolean") {
    throw new Error(`Invalid claude thinking: ${JSON.stringify(cfg.thinking)} (expected boolean)`);
  }
  if (cfg.model === "haiku") {
    // Haiku hides effort/thinking in the UI — store canonical values server-side.
    return { model: "haiku", effort: "medium", thinking: false };
  }
  if (!cfg.effort || !VALID_EFFORTS.has(cfg.effort)) {
    throw new Error(`Invalid claude effort: ${JSON.stringify(cfg.effort)} (expected low|medium|high|max)`);
  }
  return { model: cfg.model, effort: cfg.effort, thinking: cfg.thinking };
}

export function resolveClaudeConfig(cfg: ClaudeConfig): ResolvedClaudeConfig {
  // `cfg.model` is already the CLI alias (opus/sonnet/haiku), which the Claude
  // CLI accepts directly as --model. No aliasing table needed — the alias *is*
  // the id the CLI wants. Earlier versions carried a full MODEL_ID_MAP for
  // long-form ids; the CLI deprecated those in favor of the short aliases.
  return { alias: cfg.model, modelId: cfg.model, cliEffort: cfg.effort, thinking: cfg.thinking };
}

export function claudeOptsFromConfig(resolved: ResolvedClaudeConfig): ClaudeOptions {
  return {
    model: resolved.modelId,
    effort: resolved.cliEffort,
    thinking: resolved.thinking,
    permissionMode: "bypassPermissions",
  };
}

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
