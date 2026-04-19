"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildSummaryPrompt = buildSummaryPrompt;
exports.buildFallbackSummary = buildFallbackSummary;
// ~6k tokens of conversation input
const SUMMARY_CHAR_BUDGET = 24000;
function _budgetMessages(messages, charBudget) {
    // Walk newest-to-oldest, collect until budget exhausted, then reverse for chronological order
    let remaining = charBudget;
    const selected = [];
    for (let i = messages.length - 1; i >= 0; i--) {
        const cost = messages[i].text.length + 20;
        if (remaining - cost < 0 && selected.length > 0)
            break;
        selected.unshift(messages[i]);
        remaining -= cost;
    }
    return selected;
}
function buildSummaryPrompt(messages, todos, priorSummaries) {
    const priorContext = priorSummaries.length > 0
        ? `Previous chain link summaries:\n${priorSummaries.map((s, i) => ` Link ${i + 1} \n${s}`).join("\n\n")}\n\n`
        : "";
    const todoBlock = todos.length > 0
        ? `Current todo list:\n${JSON.stringify(todos, null, 2)}\n\n`
        : "No active todos.\n\n";
    const budgeted = _budgetMessages(messages, SUMMARY_CHAR_BUDGET);
    const conversationBlock = budgeted
        .map((m) => `[${m.role}]: ${m.text}`)
        .join("\n\n");
    return `You are generating a context chain summary for an AI coding assistant conversation. This summary primes a fresh context window, replacing full conversation history.

Respond ONLY with this structured format — no preamble, no extra text:

## State
[Current task/focus and where work left off. 1-3 sentences.]

## Files
[Specific file paths and function names that are relevant or were modified. Bullet list.]

## Decisions
[Key choices made, approaches chosen, bugs diagnosed. Bullet list.]

## In Progress
[Work underway and not yet complete. Bullet list. Omit section if none.]

## Next
[Immediate next steps the assistant should continue. Bullet list.]



Keep total response under 600 words. Be precise — file paths and function names over prose.

${priorContext}${todoBlock}Conversation:\n${conversationBlock}\n\nGenerate the structured summary:`;
}
function buildFallbackSummary(messages, todos, priorSummaries) {
    const lines = [];
    lines.push("## State");
    if (priorSummaries.length > 0) {
        lines.push(priorSummaries[priorSummaries.length - 1].slice(0, 600));
    }
    else {
        lines.push("(no prior summary available — see In Progress below)");
    }
    lines.push("\n## Files");
    lines.push("(fallback mode — extract from activity below)");
    lines.push("\n## Decisions");
    lines.push("(fallback mode — extract from activity below)");
    lines.push("\n## In Progress");
    for (const m of messages.slice(-6)) {
        lines.push(`[${m.role}]: ${m.text.slice(0, 250)}`);
    }
    lines.push("\n## Next");
    const pending = todos.filter((t) => !t.done);
    if (pending.length > 0) {
        for (const t of pending) {
            lines.push(`- ${t.text}`);
            if (t.subs) {
                for (const s of t.subs) {
                    if (!s.done)
                        lines.push(`  - ${s.text}`);
                }
            }
        }
    }
    else {
        lines.push("(see In Progress above)");
    }
    return lines.join("\n");
}
