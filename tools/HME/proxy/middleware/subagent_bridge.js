'use strict';
/**
 * HME subagent bridge.
 *
 * Pairs with synthesis_reasoning.py's OVERDRIVE_VIA_SUBAGENT path. When
 * HME wants to do a reasoning call but Anthropic direct-API RPM is
 * exhausted (typical symptom: 429 on opus + sonnet + cascade timeout),
 * HME writes the prompt to tmp/hme-subagent-queue/<req_id>.json and emits
 * a `[[HME_AGENT_TASK req_id=... prompt_file=...]]` sentinel in the
 * reasoning output. That sentinel ends up in a Bash tool_result the
 * assistant receives.
 *
 * This middleware has two responsibilities:
 *
 *   1. onRequest — scan the outgoing request's message history for any
 *      un-dispatched sentinels. For each, append a system message that
 *      tells Claude: "invoke Agent(subagent_type='general-purpose',
 *      prompt=<read the file>, description='HME reasoning for <req_id>')
 *      now; the Agent's response is the authoritative reasoning output."
 *      A sentinel is "dispatched" once an Agent tool_use has been emitted
 *      with a description containing the req_id — we track this in a set
 *      so the system-message injection is one-shot per req_id.
 *
 *   2. onToolResult — when an Agent tool_result comes back and its paired
 *      tool_use has a description matching "HME reasoning for <req_id>",
 *      write Agent's text output to tmp/hme-subagent-results/<req_id>.json
 *      and move the queue entry to tmp/hme-subagent-queue/done/. Future
 *      HME callers can poll that results dir to resume synchronous flows;
 *      for the current MVP, the Agent's result is shown inline to the
 *      user via its normal tool_result path (fire-and-forget is enough).
 *
 * Rate-limit bucket: Agent tool invocations from Claude Code consume
 * session budget, not per-minute raw-API RPM. That's the whole point.
 */

const fs = require('fs');
const path = require('path');
const { PROJECT_ROOT } = require('../shared');

const QUEUE_DIR = path.join(PROJECT_ROOT, 'tmp', 'hme-subagent-queue');
const RESULTS_DIR = path.join(PROJECT_ROOT, 'tmp', 'hme-subagent-results');
const DONE_DIR = path.join(QUEUE_DIR, 'done');

// Match the sentinel HME writes. Capture the req_id and (optional) prompt_file.
const SENTINEL_RE = /\[\[HME_AGENT_TASK\s+req_id=([a-zA-Z0-9]+)\s+(?:prompt_file=([^\s\]]+)\s*)?\]\]/g;

// In-memory dedup: once we've seen an Agent dispatch with this req_id in
// its description, don't re-inject the system prompt on subsequent turns.
// Reset on proxy restart (acceptable; a restart is rare enough that a
// one-time re-dispatch won't break anything).
const _dispatched = new Set();

function _ensureDir(p) {
  try { fs.mkdirSync(p, { recursive: true }); } catch (_e) { /* ignore */ }
}

function _textOf(toolResult) {
  const c = toolResult && toolResult.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.filter(x => x && x.type === 'text').map(x => x.text || '').join('');
  return '';
}

function _scanPendingSentinels(payload) {
  // Walk tool_result blocks in message history; return a de-duplicated
  // list of {req_id, prompt_file} for sentinels not yet dispatched.
  const out = [];
  const seen = new Set();
  const msgs = (payload && payload.messages) || [];
  for (const m of msgs) {
    if (!m || !Array.isArray(m.content)) continue;
    for (const b of m.content) {
      if (!b) continue;
      const text = b.type === 'tool_result' ? _textOf(b) : (b.type === 'text' ? (b.text || '') : '');
      if (!text || text.indexOf('HME_AGENT_TASK') === -1) continue;
      let m2;
      SENTINEL_RE.lastIndex = 0;
      while ((m2 = SENTINEL_RE.exec(text)) !== null) {
        const [, reqId, promptFile] = m2;
        if (seen.has(reqId) || _dispatched.has(reqId)) continue;
        seen.add(reqId);
        out.push({ reqId, promptFile: promptFile || `tmp/hme-subagent-queue/${reqId}.json` });
      }
    }
  }
  return out;
}

function _readPromptFile(relPath) {
  const abs = path.isAbsolute(relPath) ? relPath : path.join(PROJECT_ROOT, relPath);
  try {
    const raw = fs.readFileSync(abs, 'utf8');
    return JSON.parse(raw);
  } catch (_e) {
    return null;
  }
}

function _scanAgentDispatches(payload) {
  // Walk assistant messages; mark any req_id for which an Agent tool_use
  // has been emitted (description contains "HME reasoning for <req_id>").
  const msgs = (payload && payload.messages) || [];
  for (const m of msgs) {
    if (!m || m.role !== 'assistant' || !Array.isArray(m.content)) continue;
    for (const b of m.content) {
      if (b && b.type === 'tool_use' && b.name === 'Agent') {
        const desc = (b.input && b.input.description) || '';
        const match = /HME reasoning for ([a-zA-Z0-9]+)/.exec(desc);
        if (match) _dispatched.add(match[1]);
      }
    }
  }
}

module.exports = {
  name: 'subagent_bridge',

  onRequest({ payload, ctx }) {
    _ensureDir(QUEUE_DIR);
    _ensureDir(RESULTS_DIR);
    _ensureDir(DONE_DIR);
    // First mark any dispatches the assistant has already initiated in
    // earlier turns so we don't double-inject.
    _scanAgentDispatches(payload);
    const pending = _scanPendingSentinels(payload);
    if (pending.length === 0) return;

    // Build one system-prompt block covering every pending req_id. The
    // instruction is surgical: invoke Agent NOW, with a specific prompt
    // read from the file, tagged so the response is routable back here.
    const blocks = [];
    for (const { reqId, promptFile } of pending) {
      const data = _readPromptFile(promptFile);
      if (!data || typeof data.prompt !== 'string') {
        blocks.push(
          `  - req_id=${reqId}: queue file missing or malformed (${promptFile}); ignore.`,
        );
        _dispatched.add(reqId);
        continue;
      }
      // Truncate prompt preview so the system message stays bounded.
      const preview = data.prompt.length > 600
        ? data.prompt.slice(0, 600) + '…'
        : data.prompt;
      // Subagent type: honor the queue payload's hint (any of Claude Code's
      // valid types — general-purpose, Explore, Plan, statusline-setup,
      // claude-code-guide). Default general-purpose so legacy queue files
      // without the field still work. This is the "all possible subagent
      // types" fix — previously the middleware hardcoded general-purpose
      // which effectively made Explore/Plan/etc. unreachable for HME
      // reasoning even when they'd be the right fit (e.g. research-heavy
      // synthesis calls benefit from Explore's parallel-file-reading).
      const KNOWN_TYPES = new Set([
        'general-purpose', 'Explore', 'Plan',
        'statusline-setup', 'claude-code-guide',
      ]);
      let subagentType = data.subagent_type || 'general-purpose';
      if (!KNOWN_TYPES.has(subagentType)) {
        subagentType = 'general-purpose';
      }
      blocks.push(
        `  - req_id=${reqId}\n` +
        `    prompt_file: ${promptFile}\n` +
        `    subagent_type: ${subagentType}\n` +
        `    system: ${(data.system || '').slice(0, 200)}\n` +
        `    max_tokens: ${data.max_tokens || 2048}\n` +
        `    prompt_preview: ${preview.replace(/\n/g, ' ')}`,
      );
    }

    if (blocks.length === 0) return;

    const systemMsg = [
      'HME reasoning subagent dispatch needed.',
      '',
      'One or more reasoning tasks were queued by the HME server because the direct-API',
      'path (Opus/Sonnet via proxy) was rate-limited. Each task is waiting for you to',
      'dispatch it via the Agent tool, where session-budget applies instead of per-minute',
      'API RPM.',
      '',
      'For EACH pending task below, invoke Agent exactly once:',
      '  - subagent_type: as listed per-task below (honor the field; each task',
      '    picks the type best suited to its nature — general-purpose for most,',
      '    Explore for research-heavy prompts, Plan for design questions, etc.)',
      "  - description: 'HME reasoning for <req_id>' (verbatim; the bridge uses this to route the result)",
      '  - prompt: read the full prompt from prompt_file (Bash `cat` or Read), then pass as-is',
      '',
      'After the Agent returns, include its output inline in your reply so the user sees',
      "the reasoning. Do NOT paraphrase the Agent's output — show it directly.",
      '',
      'Pending tasks:',
      ...blocks,
    ].join('\n');

    // Append to payload.system. Anthropic accepts system as either a
    // string or an array of text blocks; normalize to array and append.
    if (typeof payload.system === 'string') {
      payload.system = [{ type: 'text', text: payload.system }];
    }
    if (!Array.isArray(payload.system)) {
      payload.system = [];
    }
    payload.system.push({ type: 'text', text: systemMsg });
    ctx.markDirty();
    ctx.emit({
      event: 'subagent_bridge_injected',
      pending_count: blocks.length,
      req_ids: pending.map(p => p.reqId).join(','),
    });
  },

  onToolResult({ toolUse, toolResult, ctx }) {
    if (!toolUse || toolUse.name !== 'Agent') return;
    const desc = (toolUse.input && toolUse.input.description) || '';
    const match = /HME reasoning for ([a-zA-Z0-9]+)/.exec(desc);
    if (!match) return;
    const reqId = match[1];
    // Capture Agent's text output and write it to the results dir so
    // future HME callers can synchronously consume it.
    const text = _textOf(toolResult);
    if (!text) return;
    _ensureDir(RESULTS_DIR);
    const outPath = path.join(RESULTS_DIR, `${reqId}.json`);
    try {
      fs.writeFileSync(outPath, JSON.stringify({
        req_id: reqId,
        text,
        captured_at: Date.now(),
      }));
    } catch (err) {
      ctx.warn(`subagent_bridge: result write failed for ${reqId}: ${err.message}`);
      return;
    }
    // Move the queue entry to done/ for audit trail.
    const queuePath = path.join(QUEUE_DIR, `${reqId}.json`);
    const donePath = path.join(DONE_DIR, `${reqId}.json`);
    try { _ensureDir(DONE_DIR); fs.renameSync(queuePath, donePath); } catch (_e) { /* ok if absent */ }
    _dispatched.add(reqId);
    ctx.emit({
      event: 'subagent_bridge_result_captured',
      req_id: reqId,
      bytes: text.length,
    });
  },
};
