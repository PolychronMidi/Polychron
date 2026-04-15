import { ClaudeOptions, LlamacppOptions } from "./router";

export const OLLAMA_URL = "http://localhost:11434";

export function claudeOptsFromMsg(msg: any): ClaudeOptions {
  return {
    model: msg.claudeModel,
    effort: msg.claudeEffort,
    thinking: msg.claudeThinking,
    permissionMode: "bypassPermissions",
  };
}

export function llamacppOptsFromMsg(msg: any): LlamacppOptions {
  return { model: msg.llamacppModel, url: OLLAMA_URL };
}
