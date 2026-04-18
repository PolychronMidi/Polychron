/** Shape shared by "send" and "queue" messages — the send payload. */
export interface SendMsg {
  text: string;
  route: "claude" | "local" | "hybrid" | "auto" | "agent";
  claudeModel: string;
  claudeEffort: string;
  claudeThinking: boolean;
  llamacppModel: string;
}

/** Claude config sent eagerly on any control change. */
export interface ClaudeConfigMsg {
  claudeModel: string;      // "opus" | "sonnet" | "haiku"
  claudeEffort: string;     // "low" | "medium" | "high" | "max"
  claudeThinking: boolean;
}

/**
 * Discriminated union of all messages the webview can post to the extension.
 * Exhaustive-checked at compile time via the typed dispatch helper below.
 */
export type WebviewMessage =
  | (SendMsg & { type: "send" })
  | (SendMsg & { type: "queue" })
  | { type: "cancel" }
  | { type: "clearHistory" }
  | { type: "listSessions" }
  | { type: "loadSession"; id: string }
  | { type: "deleteSession"; id: string }
  | { type: "renameSession"; id: string; title: string }
  | { type: "newSession" }
  | { type: "enrichPrompt"; prompt: string; frame?: string }
  | { type: "checkHmeShim" }
  | { type: "setZoomLevel"; level: number }
  | { type: "setMirrorMode"; enabled: boolean; model?: string; effort?: string }
  | (ClaudeConfigMsg & { type: "setClaudeConfig" });

/** Typed handler map: every key is a message type, handler receives the narrowed message. */
export type WebviewHandlers = {
  [K in WebviewMessage["type"]]?: (msg: Extract<WebviewMessage, { type: K }>) => void;
};

/**
 * Dispatch an untyped webview message through a typed handler map.
 * Unknown message types are silently ignored (webview may send unsupported types).
 */
export function dispatchWebviewMessage(msg: any, handlers: WebviewHandlers): void {
  const handler = handlers[msg?.type as WebviewMessage["type"]];
  if (handler) (handler as (m: any) => void)(msg);
}
