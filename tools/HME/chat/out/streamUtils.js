"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LLAMACPP_OUTPUT_BUFFER = exports.AGENTIC_SYSTEM_PROMPT = exports.CHARS_PER_TOKEN = void 0;
exports.uid = uid;
exports.estimateTokens = estimateTokens;
exports.trimHistoryToFit = trimHistoryToFit;
exports.makeBlockAccumulator = makeBlockAccumulator;
const router_1 = require("./router");
exports.CHARS_PER_TOKEN = 3.5;
exports.AGENTIC_SYSTEM_PROMPT = "You are an agentic coding assistant with access to bash, read_file, and write_file tools. " +
    "When asked to perform a task — create files, edit code, run commands, implement features — " +
    "call the appropriate tool immediately. Never respond with suggestions, plans, or code blocks " +
    "without calling a tool first.";
exports.LLAMACPP_OUTPUT_BUFFER = 4096;
function uid() {
    return Math.random().toString(36).slice(2, 10);
}
function estimateTokens(messages) {
    let chars = 0;
    for (const m of messages)
        chars += m.content.length;
    return Math.ceil(chars / exports.CHARS_PER_TOKEN);
}
function trimHistoryToFit(history, currentMsg, extraMessages = []) {
    const budget = router_1.GPU_NUM_CTX - exports.LLAMACPP_OUTPUT_BUFFER;
    const fixedTokens = estimateTokens([...extraMessages, { content: currentMsg }]);
    const available = budget - fixedTokens;
    if (available <= 0)
        return [];
    let total = 0;
    let keepFrom = 0;
    for (let i = history.length - 1; i >= 0; i--) {
        const cost = Math.ceil(history[i].content.length / exports.CHARS_PER_TOKEN);
        if (total + cost > available) {
            keepFrom = i + 1;
            break;
        }
        total += cost;
    }
    return history.slice(keepFrom);
}
function makeBlockAccumulator() {
    const blocks = [];
    let lastType = null;
    return {
        blocks,
        append(type, content) {
            if (type === "tool" || lastType !== type || blocks.length === 0) {
                blocks.push({ type, content });
            }
            else {
                blocks[blocks.length - 1].content += content;
            }
            lastType = type;
        },
    };
}
