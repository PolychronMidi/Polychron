"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildSummaryPrompt = buildSummaryPrompt;
exports.buildFallbackSummary = buildFallbackSummary;
function buildSummaryPrompt(messages, todos, priorSummaries) {
    const priorContext = priorSummaries.length > 0
        ? `Previous chain link summaries:\n${priorSummaries.map((s, i) => `--- Link ${i + 1} ---\n${s}`).join("\n\n")}\n\n`
        : "";
    const todoBlock = todos.length > 0
        ? `Current todo list:\n${JSON.stringify(todos, null, 2)}\n\n`
        : "No active todos.\n\n";
    const conversationBlock = messages
        .map((m) => `[${m.role}]: ${m.text.slice(0, 1500)}`)
        .join("\n\n");
    return `You are generating a context chain summary for an AI coding assistant conversation. This summary will be used to prime a fresh context window, replacing the full conversation history.

Requirements:
1. Be concise but preserve all actionable context — decisions made, approaches chosen, files modified, bugs found
2. Include the current state of the todo list
3. Reference specific file paths and function names when relevant
4. Note any in-progress work that needs continuation
5. Keep the summary under 2000 tokens

${priorContext}${todoBlock}Recent conversation:\n${conversationBlock}\n\nGenerate the continuation summary:`;
}
function buildFallbackSummary(messages, todos, priorSummaries) {
    const lines = [];
    if (priorSummaries.length > 0) {
        lines.push("## Prior context");
        lines.push(priorSummaries[priorSummaries.length - 1].slice(0, 800));
    }
    lines.push("\n## Recent activity");
    for (const m of messages.slice(-8)) {
        lines.push(`[${m.role}]: ${m.text.slice(0, 300)}`);
    }
    if (todos.length > 0) {
        lines.push("\n## Active todos");
        for (const t of todos) {
            lines.push(`- [${t.done ? "x" : " "}] ${t.text}`);
            if (t.subs) {
                for (const s of t.subs) {
                    lines.push(`  - [${s.done ? "x" : " "}] ${s.text}`);
                }
            }
        }
    }
    return lines.join("\n");
}
