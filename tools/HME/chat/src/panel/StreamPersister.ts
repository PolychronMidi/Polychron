import { ChatMessage } from "../types";
import { StreamTracker } from "../streamUtils";
import { PanelHost } from "./PanelHost";

const STREAM_PERSIST_MS = 10_000;

/**
 * Tracks a streaming assistant message so partial text survives ext host crashes.
 * Pushes a placeholder into the messages array immediately and persists every 10s.
 *
 * `persist` is called both on interval and on finalize; callers supply it so
 * StreamPersister doesn't need a reference to the full session state.
 */
export class StreamPersister {
  constructor(private readonly host: PanelHost) {}

  track(
    assistantId: string,
    route: string,
    messages: ChatMessage[],
    persist: () => void,
  ): StreamTracker {
    const partial: ChatMessage = { id: assistantId, role: "assistant", text: "", route, ts: Date.now() };
    messages.push(partial);
    persist();
    const idx = messages.length - 1;
    let dirty = false;
    const timer = setInterval(() => {
      if (dirty) {
        dirty = false;
        try { persist(); }
        catch (e: any) { this.host.postError("persist", `interval: ${e?.message ?? e}`); }
      }
    }, STREAM_PERSIST_MS);
    return {
      update: (text: string, tools?: string[], thinking?: string) => {
        partial.text = text;
        if (tools?.length) partial.tools = tools;
        if (thinking) partial.thinking = thinking;
        dirty = true;
      },
      finalize: (final: ChatMessage) => {
        clearInterval(timer);
        messages[idx] = final;
        try { persist(); }
        catch (e: any) { this.host.postError("persist", `finalize: ${e?.message ?? e}`); }
      },
    };
  }
}
