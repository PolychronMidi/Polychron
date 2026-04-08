export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  thinking?: string;
  tools?: string[];
  route?: string;
  cost?: number;
  ts: number;
}
