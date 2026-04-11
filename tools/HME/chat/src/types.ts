export interface ContentBlock {
  type: "thinking" | "text" | "tool";
  content: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  thinking?: string;
  tools?: string[];
  blocks?: ContentBlock[];
  route?: string;
  cost?: number;
  ts: number;
}
