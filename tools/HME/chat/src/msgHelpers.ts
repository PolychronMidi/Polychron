import { ClaudeOptions, LlamacppOptions } from "./router";

export const LLAMACPP_URL = process.env.HME_LLAMACPP_ARBITER_URL ?? "http://127.0.0.1:8080";

export function claudeOptsFromMsg(msg: any): ClaudeOptions {
  return {
    model: msg.claudeModel,
    effort: msg.claudeEffort,
    thinking: msg.claudeThinking,
    permissionMode: "bypassPermissions",
  };
}

export function llamacppOptsFromMsg(msg: any): LlamacppOptions {
  return { model: msg.llamacppModel, url: LLAMACPP_URL };
}
