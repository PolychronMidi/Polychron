"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StreamPersister = void 0;
const STREAM_PERSIST_MS = 10000;
/**
 * Tracks a streaming assistant message so partial text survives ext host crashes.
 * Pushes a placeholder into the messages array immediately and persists every 10s.
 *
 * `persist` is called both on interval and on finalize; callers supply it so
 * StreamPersister doesn't need a reference to the full session state.
 */
class StreamPersister {
    constructor(host) {
        this.host = host;
    }
    track(assistantId, route, messages, persist) {
        const partial = { id: assistantId, role: "assistant", text: "", route, ts: Date.now() };
        messages.push(partial);
        persist();
        const idx = messages.length - 1;
        let dirty = false;
        const timer = setInterval(() => {
            if (dirty) {
                dirty = false;
                try {
                    persist();
                }
                catch (e) {
                    this.host.postError("persist", `interval: ${e?.message ?? e}`);
                }
            }
        }, STREAM_PERSIST_MS);
        return {
            update: (text, tools, thinking) => {
                partial.text = text;
                if (tools?.length)
                    partial.tools = tools;
                if (thinking)
                    partial.thinking = thinking;
                dirty = true;
            },
            finalize: (final) => {
                clearInterval(timer);
                messages[idx] = final;
                try {
                    persist();
                }
                catch (e) {
                    this.host.postError("persist", `finalize: ${e?.message ?? e}`);
                }
            },
        };
    }
}
exports.StreamPersister = StreamPersister;
