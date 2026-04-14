import { ClaudeOptions, OllamaOptions } from "./router";

export const OLLAMA_URL = "http://localhost:11434";

export function claudeOptsFromMsg(msg: any): ClaudeOptions {
  return {
    model: msg.claudeModel,
    effort: msg.claudeEffort,
    thinking: msg.claudeThinking,
    permissionMode: "bypassPermissions",
  };
}

export function ollamaOptsFromMsg(msg: any): OllamaOptions {
  return { model: msg.ollamaModel, url: OLLAMA_URL };
}
