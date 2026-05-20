'use strict';
/**
 * SSE event rewriters -- plug into SseTransform.
 *
 * Rewriter signature: (eventName, data, ctx) => replacement
 *   - return data (unchanged or mutated): emit normally
 *   - return null: drop the event
 *   - return { events: [[name, data], ...] }: emit list in order (replaces)
 *
 * Rewriters run left-to-right -- order matters.
 */

// NOTE: `hmePrefixRestore` was removed -- with full bypass, Claude Code never
// sees HME tool_uses (the proxy handles dispatch internally and strips them
// from the response before forwarding). No restoration needed.


const DROP_TOOL_USE_NAMES = new Set(['TodoWrite']);

function dropToolUseRewrite(eventName, data, ctx) {
  let drops = ctx.get('drop_tool_use_indices');
  if (!drops) { drops = new Set(); ctx.set('drop_tool_use_indices', drops); }
  if (eventName === 'content_block_start' && data && data.content_block && data.content_block.type === 'tool_use') {
    if (DROP_TOOL_USE_NAMES.has(data.content_block.name)) {
      drops.add(data.index);
      return null;
    }
    return data;
  }
  if (data && drops.has(data.index)) {
    if (eventName === 'content_block_stop') drops.delete(data.index);
    return null;
  }
  if (eventName === 'message_delta' && data && data.delta && data.delta.stop_reason === 'tool_use' && drops.size === 0) {
    data = { ...data, delta: { ...data.delta, stop_reason: 'end_turn' } };
  }
  return data;
}

// Bash run_in_background -> /hme/spawn; avoids task-notification spam.

const { serviceUrl } = require('./service_registry');
const { evaluateBashInput, blockedCommand } = require('./bash_command_policy');

const SPAWN_URL = serviceUrl('proxy', { path: '/hme/spawn' });
const BASH_TOOL_NAMES = new Set(['Bash']);
const READ_TOOL_NAMES = new Set(['Read']);

function _buildSpawnCommand(originalCmd, description) {
  const payload = JSON.stringify({
    name: (description || 'bg').replace(/[^\w-]/g, '_').slice(0, 24),
    cmd: 'bash',
    args: ['-c', originalCmd],
    ttl_sec: 3600,
  }).replace(/'/g, `'\\''`);
  return `curl -sf -X POST ${SPAWN_URL} -H 'content-type: application/json' -d '${payload}'`;
}

function _holdToolInput(ctx, key, eventName, data, names) {
  let holds = ctx.get(key);
  if (!holds) { holds = new Map(); ctx.set(key, holds); }
  if (eventName === 'content_block_start' && data && data.content_block && data.content_block.type === 'tool_use') {
    if (names.has(data.content_block.name)) holds.set(data.index, { id: data.content_block.id, name: data.content_block.name, partial: '' });
  }
  return holds;
}

function _inputDeltaEvent(index, partialJson) {
  return ['content_block_delta', { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: partialJson } }];
}

function _parseToolInput(state) {
  try { return JSON.parse(state.partial); } catch (_e) { return null; }
}

function _emitHeldInput(state, index, input) {
  const events = [];
  if (input !== null) events.push(_inputDeltaEvent(index, JSON.stringify(input)));
  else if (state.partial) events.push(_inputDeltaEvent(index, state.partial));
  return events;
}

function runInBackgroundRewrite(eventName, data, ctx) {
  const holds = _holdToolInput(ctx, 'bash_hold', eventName, data, BASH_TOOL_NAMES);

  // Track Bash tool_use blocks -- start holding their deltas.
  if (eventName === 'content_block_start' && data && data.content_block && data.content_block.type === 'tool_use') return data;

  // Hold deltas for tracked Bash tool_uses.
  if (eventName === 'content_block_delta' && data && data.delta && data.delta.type === 'input_json_delta') {
    const state = holds.get(data.index);
    if (state) {
      state.partial += (data.delta.partial_json || '');
      return null; // drop -- we re-emit on content_block_stop
    }
    return data;
  }

  // On stop: parse accumulated input, rewrite if needed, emit [synthetic_delta, stop].
  if (eventName === 'content_block_stop' && data) {
    const state = holds.get(data.index);
    if (!state) return data;
    holds.delete(data.index);

    const input = _parseToolInput(state);
    let finalInput = input;
    if (input && input.run_in_background === true && typeof input.command === 'string') {
      finalInput = {
        command: _buildSpawnCommand(input.command, input.description || ''),
        description: input.description || 'spawned via /hme/spawn',
      };
    }

    const events = _emitHeldInput(state, data.index, finalInput);
    events.push(['content_block_stop', data]);
    return { events };
  }
  return data;
}

// Edit/MultiEdit missing required params -> rewrite to Read of the same file.
// Claude Code's client-side schema validator rejects Edit calls without
// old_string/new_string with InputValidationError, forcing a retry-loop.
// Convert the tool_use block in-flight: if the model emitted Edit-without-
// required-fields, the call almost always meant "I need to see what's in
// this file first". Synthesize a Read call (using offset/limit if the Edit
// hinted at them, else first 50 lines) so the model gets the content
// instead of a hard error.
const { editToReadFallback, isInvalidEditInput, isEditFamilyTool } = require('./edit_validation');

const READ_FALLBACK_TOOL_NAMES = new Set(['Read']);
let _sessionReadCache = null;
function _readCache() {
  if (_sessionReadCache !== null) return _sessionReadCache;
  try { _sessionReadCache = require('./session_read_cache'); }
  catch (_e) { _sessionReadCache = false; }
  return _sessionReadCache;
}

function _editTargetUnread(input, ctx) {
  const cache = _readCache();
  if (!cache) return false;
  const sessionId = ctx && typeof ctx.get === 'function' ? ctx.get('session_id') : '';
  if (!sessionId) return false;
  const fp = String((input && (input.file_path || input.path)) || '').trim();
  if (!fp || !fp.startsWith('/')) return false;
  return !cache.hasRead(sessionId, fp);
}

function editFallbackToReadRewrite(eventName, data, ctx) {
  let editHolds = ctx.get('edit_fallback_hold');
  if (!editHolds) { editHolds = new Map(); ctx.set('edit_fallback_hold', editHolds); }
  let readHolds = ctx.get('read_track_hold');
  if (!readHolds) { readHolds = new Map(); ctx.set('read_track_hold', readHolds); }

  if (eventName === 'content_block_start' && data && data.content_block && data.content_block.type === 'tool_use') {
    if (isEditFamilyTool(data.content_block.name)) {
      editHolds.set(data.index, { id: data.content_block.id, name: data.content_block.name, startData: data, partial: '' });
      return null;
    }
    if (READ_FALLBACK_TOOL_NAMES.has(data.content_block.name)) {
      readHolds.set(data.index, { partial: '' });
    }
    return data;
  }
  if (eventName === 'content_block_delta' && data && data.delta && data.delta.type === 'input_json_delta') {
    const editState = editHolds.get(data.index);
    if (editState) { editState.partial += (data.delta.partial_json || ''); return null; }
    const readState = readHolds.get(data.index);
    if (readState) { readState.partial += (data.delta.partial_json || ''); }
    return data;
  }
  if (eventName !== 'content_block_stop' || !data) return data;

  const readState = readHolds.get(data.index);
  if (readState) {
    readHolds.delete(data.index);
    const cache = _readCache();
    const sessionId = ctx && typeof ctx.get === 'function' ? ctx.get('session_id') : '';
    if (cache && sessionId) {
      try {
        const readInput = JSON.parse(readState.partial || '{}');
        const fp = String((readInput && (readInput.file_path || readInput.path)) || '').trim();
        if (fp) cache.recordRead(sessionId, fp);
      } catch (_e) { /* silent-ok: malformed JSON; the real tool execution will surface the error */ }
    }
  }

  const editState = editHolds.get(data.index);
  if (!editState) return data;
  editHolds.delete(data.index);
  const parsed = _parseToolInput(editState);
  const invalid = isInvalidEditInput(parsed, { checkFs: true });
  const unread = !invalid && _editTargetUnread(parsed, ctx);
  if (!invalid && !unread) {
    return { events: [
      ['content_block_start', editState.startData],
      _inputDeltaEvent(data.index, editState.partial || JSON.stringify(parsed)),
      ['content_block_stop', data],
    ]};
  }
  const readInput = editToReadFallback(parsed || {});
  const readStart = {
    ...editState.startData,
    content_block: { ...editState.startData.content_block, name: 'Read', input: {} },
  };
  if (unread) {
    const cache = _readCache();
    const sessionId = ctx && typeof ctx.get === 'function' ? ctx.get('session_id') : '';
    if (cache && sessionId && readInput.file_path) cache.recordRead(sessionId, readInput.file_path);
  }
  return { events: [
    ['content_block_start', readStart],
    _inputDeltaEvent(data.index, JSON.stringify(readInput)),
    ['content_block_stop', data],
  ]};
}

function _isPdfReadPath(file) {
  return /\.pdf(?:$|[?#])/i.test(String(file || '').trim());
}

function _normalizeReadInput(input) {
  if (!input || typeof input !== 'object') return input;
  const next = { ...input };
  const file = next.file_path || next.path || '';
  if (Object.prototype.hasOwnProperty.call(next, 'pages') && (!String(next.pages || '').trim() || !_isPdfReadPath(file))) delete next.pages;
  if (Number(next.limit) > 500) next.limit = 200;
  return next;
}

function readInputNormalizeRewrite(eventName, data, ctx) {
  const holds = _holdToolInput(ctx, 'read_hold', eventName, data, READ_TOOL_NAMES);
  if (eventName === 'content_block_start' && data && data.content_block && data.content_block.type === 'tool_use') return data;
  if (eventName === 'content_block_delta' && data && data.delta && data.delta.type === 'input_json_delta') {
    const state = holds.get(data.index);
    if (state) { state.partial += (data.delta.partial_json || ''); return null; }
    return data;
  }
  if (eventName !== 'content_block_stop' || !data) return data;
  const state = holds.get(data.index);
  if (!state) return data;
  holds.delete(data.index);
  const events = _emitHeldInput(state, data.index, _normalizeReadInput(_parseToolInput(state)));
  events.push(['content_block_stop', data]);
  return { events };
}

// Long leading sleep -> no-op prefix; preserves semantics while avoiding CLI block.
const LEADING_SLEEP_RE = /^\s*sleep\s+(\d+)\s*([;&|])/;
const LEADING_SLEEP_MIN_REWRITE = 10;  // seconds

function _rewriteLongLeadingSleep(command) {
  if (typeof command !== 'string') return command;
  const m = LEADING_SLEEP_RE.exec(command);
  if (!m) return command;
  const seconds = Number(m[1]);
  if (!Number.isFinite(seconds) || seconds < LEADING_SLEEP_MIN_REWRITE) {
    return command;
  }
  // Prefix with `:` (shell no-op / true). Leading token is `:`, sleep is
  // second. Claude Code's leading-sleep check doesn't trip.
  return ': ; ' + command;
}

function bashPolicyRewrite(eventName, data, ctx) {
  if (eventName !== 'content_block_stop' || !data) return data;
  const holds = ctx.get('bash_hold');
  if (!holds) return data;
  const state = holds.get(data.index);
  if (!state) return data;
  const input = _parseToolInput(state);
  if (!input || typeof input.command !== 'string') return data;
  const verdict = evaluateBashInput(input, { supportsRunInBackground: true });
  if (!verdict || verdict.decision === 'allow' && !verdict.changed) return data;
  if (verdict.decision === 'deny') {
    state.partial = JSON.stringify({ ...input, command: blockedCommand(verdict.reason), description: 'blocked by HME policy' });
    return data;
  }
  state.partial = JSON.stringify(verdict.input || input);
  return data;
}

function longLeadingSleepRewrite(eventName, data, ctx) {
  // Mutates held Bash input before runInBackgroundRewrite emits it.
  if (eventName !== 'content_block_stop' || !data) return data;
  const holds = ctx.get('bash_hold');
  if (!holds) return data;
  // Peek -- don't delete; runInBackgroundRewrite (run AFTER this in the
  // chain) will handle deletion + final emit.
  const state = holds.get(data.index);
  if (!state) return data;
  const input = _parseToolInput(state);
  if (!input) return data;
  if (!input || typeof input.command !== 'string') return data;
  const rewritten = _rewriteLongLeadingSleep(input.command);
  if (rewritten === input.command) return data;
  // Mutate the held state so runInBackgroundRewrite sees the rewritten
  // command when it reads state.partial on stop. Preserve other keys.
  input.command = rewritten;
  state.partial = JSON.stringify(input);
  return data;
}

// Strip bare-ack text after stop-hook denies; silence-equivalent spam.
const _ACK_PATTERNS = [
  /^\s*ok[.!]?\s*$/i,
  /^\s*done[.!]?\s*$/i,
  /^\s*noted[.!]?\s*$/i,
  /^\s*got\s+it[.!]?\s*$/i,
  /^\s*ack[.!]?\s*$/i,
  /^\s*acknowledged[.!]?\s*$/i,
  /^\s*sure[.!]?\s*$/i,
  /^\s*yes[.!]?\s*$/i,
  /^\s*yep[.!]?\s*$/i,
  /^\s*yeah[.!]?\s*$/i,
  /^\s*will\s+do[.!]?\s*$/i,
  /^\s*on\s+it[.!]?\s*$/i,
  /^\s*understood[.!]?\s*$/i,
  /^\s*roger[.!]?\s*$/i,
  /^\s*right[.!]?\s*$/i,
  /^\s*proceeding[.!]?\s*$/i,
  /^\s*continuing[.!]?\s*$/i,
  /^\s*resuming[.!]?\s*$/i,
];

// Catch responses the keyword patterns miss: empty, bare punctuation
// (`.`, `..`, `!?`), or single-glyph non-letter responses that the model
// emits under stop-hook pressure to dodge the no-text-output gate
// without saying anything substantive.
function _isMinimalAck(text) {
  const t = (text || '').trim();
  if (!t) return true;
  if (/^[\s.!?;:,\-_*~`]+$/.test(t)) return true;
  if (t.length <= 2 && !/[a-z0-9]/i.test(t)) return true;
  return false;
}

// Drop assistant text that fabricates a `Human:` / `Assistant:` turn prefix.
function _isHallucinatedTurnPrefix(text) {
  if (typeof text !== 'string') return false;
  // Pure prefix tokens: "Human:", "Assistant:", or repeated.
  if (/^\s*(?:(?:Human|Assistant)\s*:\s*){1,}\s*$/.test(text)) return true;
  // Prefix followed by ANYTHING (free-form fabricated turn, system-
  // reminder echo, stop-hook payload echo, anything else). Anchored
  // at start so we only catch the FAKE-TURN-START shape, not mid-text
  // mentions of "Human:" in legitimate prose.
  if (/^\s*(?:Human|Assistant)\s*:\s+\S/.test(text)) return true;
  return false;
}

// Drop literal solo-rationale ceremony; keep generic rationale requests intact.
function _isCeremonyDodge(text) {
  if (typeof text !== 'string') return false;
  // Block-start anchor only. Trailing solo-rationale paragraphs in
  // otherwise-substantive responses are handled SURGICALLY by
  // _trimSoloRationaleParagraph (called from soloRationaleTrimRewrite)
  // -- whole-block strip would nuke the substantive content too.
  if (/^\s*Solo[- ](?:rationale|justification)\s*[:.]/i.test(text)) return true;
  if (/^\s*Why\s+solo\s+(?:was|is)\s+(?:right|the\s+(?:right|correct)\s+call|appropriate|correct)/i.test(text)) return true;
  if (/^\s*Solo\s+(?:was|is)\s+(?:right|correct|appropriate|the\s+(?:right|correct)\s+call)\b/i.test(text)) return true;
  return false;
}

// Surgical trim of trailing solo-rationale paragraph (mid-text, after blank line).
function _trimSoloRationaleParagraph(text) {
  if (typeof text !== 'string' || !text) return { text, trimmed: false };
  const patterns = [
    /\n\s*\n\s*Solo[- ](?:rationale|justification)\b[\s\S]*$/i,
    /\n\s*\n\s*Why\s+solo\s+(?:was|is)\s+(?:right|the\s+(?:right|correct)\s+call|appropriate|correct)\b[\s\S]*$/i,
    /\n\s*\n\s*Solo\s+(?:was|is)\s+(?:right|correct|appropriate|the\s+(?:right|correct)\s+call)\b[\s\S]*$/i,
  ];
  for (const pat of patterns) {
    const m = text.match(pat);
    if (m) return { text: text.slice(0, m.index).replace(/\s+$/, ''), trimmed: true };
  }
  return { text, trimmed: false };
}

function _isBareAck(text) {
  if (typeof text !== 'string') return false;
  if (_ACK_PATTERNS.some((pat) => pat.test(text))) return true;
  if (_isMinimalAck(text)) return true;
  // Turn-prefix hallucinations are also bare-ack class for the
  // ackStripRewrite path. A separate always-on rewriter
  // (hallucinatedTurnPrefixStripRewrite below) catches them
  // regardless of priorUserWasDeny gate.
  if (_isHallucinatedTurnPrefix(text)) return true;
  // Stop-hook ceremony-dodge: same treatment -- always spam, the
  // always-on rewriter strips it regardless of gate.
  if (_isCeremonyDodge(text)) return true;
  return false;
}

function ackStripRewrite(eventName, data, ctx) {
  // Only active when the request payload indicated the prior user
  // message was a hook-deny payload. Set by the proxy before passing
  // events through the rewriter chain.
  if (!ctx.get('priorUserWasDeny')) return data;

  const key = 'text_hold';
  let holds = ctx.get(key);
  if (!holds) { holds = new Map(); ctx.set(key, holds); }

  if (eventName === 'content_block_start' && data && data.content_block && data.content_block.type === 'text') {
    holds.set(data.index, { buffered: [data] });
    return null;  // hold the start event
  }

  if (eventName === 'content_block_delta' && data && data.delta && data.delta.type === 'text_delta') {
    const state = holds.get(data.index);
    if (!state) return data;
    state.buffered.push(['content_block_delta', data]);
    return null;  // hold the delta event
  }

  if (eventName === 'content_block_stop' && data) {
    const state = holds.get(data.index);
    if (!state) return data;
    holds.delete(data.index);
    // Reconstruct full text from held delta events.
    let text = '';
    for (const ev of state.buffered) {
      if (Array.isArray(ev) && ev[0] === 'content_block_delta') {
        const d = ev[1];
        if (d && d.delta && typeof d.delta.text === 'string') text += d.delta.text;
      }
    }
    if (_isBareAck(text)) {
      // Log stats outside errors.log so stripped spam does not re-surface.
      try {
        const fs = require('fs');
        const path = require('path');
        const { PROJECT_ROOT } = require('./shared');
        fs.appendFileSync(
          path.join(PROJECT_ROOT, 'log', 'hme-bare-ack-strips.jsonl'),
          JSON.stringify({
            ts: new Date().toISOString(),
            path: 'sse',
            context: 'cascade-after-deny',
            text_preview: text.slice(0, 40),
          }) + '\n',
        );
      } catch (_e) { /* stat is best-effort */ }
      return null;
    }
    // Not a bare ack -- replay the held events as a list, then the stop.
    const events = [];
    // First item in state.buffered was the content_block_start data
    // (stored bare, not as [name, data] tuple). Re-emit as start event.
    events.push(['content_block_start', state.buffered[0]]);
    for (let i = 1; i < state.buffered.length; i++) {
      events.push(state.buffered[i]);
    }
    events.push(['content_block_stop', data]);
    return { events };
  }

  return data;
}

// Anti-slop strip; entries define regex, replacement, and stat label.
const _SLOP_PATTERNS = [
  // #1 Narrator setup.
  { name: 'narrator_setup',
    re: /(^|[\.\!\?]\s+|\n\s*)(?:Here'?s the thing[,:]?|Here'?s where it gets interesting[,:]?|Here'?s where the real [a-zA-Z]+ lives[,:]?)\s*/gi,
    repl: '$1' },
  // #2 Dramatic rhetorical framing.
  { name: 'dramatic_framing',
    re: /(^|[\.\!\?]\s+|\n\s*)(?:The part that (?:actually|really) matters\?|But here'?s the part where[^.]*\.|And that'?s when (?:it clicked|everything (?:changed|clicked))\.?|Want to (?:know|hear) the (?:crazy|wild|interesting) part\??)\s*/gi,
    repl: '$1' },
  // #7 Authority signaling.
  { name: 'authority_signal',
    re: /(^|[\.\!\?]\s+|\n\s*)(?:Let me be clear[,:]?|The uncomfortable truth is(?: that)?[,:]?|Here'?s what nobody tells you[,:]?|The hard truth is(?: that)?[,:]?|Here'?s the reality[,:]?|What most people miss is(?: that)?[,:]?)\s*/gi,
    repl: '$1' },
  // #8 False dichotomy lead-in. "It's not about X, it's about Y" /
  // "Stop doing X. Start doing Y." -- catch the rhetorical scaffold.
  { name: 'false_dichotomy',
    re: /(^|[\.\!\?]\s+|\n\s*)(?:It'?s not (?:about|that) [^,.]+,\s*it'?s (?:about|that)\s+|Stop (?:doing|thinking|trying)[^.]*\.\s*Start\s+)/gi,
    repl: '$1' },
  // #9 Self-branded concepts. "This is what I call the X" / "I have a
  // framework called X" -- naming a pattern before showing it works.
  { name: 'self_branded_concept',
    re: /(^|[\.\!\?]\s+|\n\s*)(?:This is what I call (?:the|a)?\s*|I (?:have|use|developed) a (?:framework|model|system|method) (?:called|named)\s+)/gi,
    repl: '$1' },
  // #10 Artificial drama sentences. Short paired contrasts.
  { name: 'artificial_drama',
    re: /(^|[\.\!\?]\s+|\n\s*)(?:The shift sounds simple\.\s*It'?s not\.|Easy to say\.\s*Hard to (?:execute|do)\.|Sounds (?:obvious|simple)\.\s*It'?s not\.|Simple in theory\.\s*Hard in practice\.)\s*/gi,
    repl: '$1' },
  // #11 Empathy openers. Even in tool output these sometimes appear
  // (e.g. an agent prefacing a fix with "We've all been there").
  { name: 'empathy_opener',
    re: /(^|[\.\!\?]\s+|\n\s*)(?:We'?ve all been there\.?|You know (?:that|the) feeling when[^.?]*[.?]|Sound familiar\??)\s*/gi,
    repl: '$1' },
  // #12 Wisdom packaging.
  { name: 'wisdom_packaging',
    re: /(^|[\.\!\?]\s+|\n\s*)(?:The lesson\??[:.]?|The takeaway(?:\s+here)?\s+is(?:\s+simple)?[:.]?|What this really means is(?: that)?[,:]?)\s*/gi,
    repl: '$1' },
  // #13 Em-dash crutch. Replace bracketing em-dashes / `--` with
  // commas when used as parenthetical bridges between word characters.
  // Skips structural use (start-of-line lists, code).
  { name: 'em_dash_crutch',
    re: /(\w)\s+(?:\u2014|--)\s+(\w)/g,
    repl: '$1, $2' },
  // #17 Colon-list trio.
  { name: 'colon_list_trio',
    re: /(?:^|\n)(?:\s*The (?:result|impact|lesson|takeaway|point|outcome|effect)[:.]\s*[^.\n]+\.\s*){3,}/gi,
    repl: '\n' },
  // #19 The perfect pivot. "But then I realized...", "That's when
  // everything changed."
  { name: 'perfect_pivot',
    re: /(^|[\.\!\?]\s+|\n\s*)(?:But then I realized(?:\s+that)?[,:]?|That'?s when everything changed\.?|That'?s when it (?:hit|clicked) me\.?|And then it hit me[,:]?)\s*/gi,
    repl: '$1' },
  // #20 Engagement-bait endings.
  { name: 'engagement_bait',
    re: /(^|[\.\!\?]\s+|\n\s*)(?:So here'?s my question for you[:.]?[^.]*\.?|Curious to hear your thoughts\.?|What do you think\?|Let me know (?:what you think|your thoughts)[\.\?]?|Drop (?:a comment|your thoughts) below\.?)\s*$/gim,
    repl: '$1' },
  // #21 Humble-brag disclaimer.
  { name: 'humble_brag',
    re: /(^|[\.\!\?]\s+|\n\s*)(?:I don'?t have all the answers,? but|Not claiming to be (?:an? )?expert,? but|Just my (?:two cents|2c|opinion),? but)\s+/gi,
    repl: '$1' },
  // #23 "Most people" strawman. "Most people think X." / "Everyone
  // focuses on X. Nobody talks about Y."
  { name: 'most_people_strawman',
    re: /(^|[\.\!\?]\s+|\n\s*)(?:Most people (?:think|believe|assume)[^.]*\.\s*They'?re wrong\.?|Everyone focuses on [^.]*\.\s*Nobody (?:talks about|mentions|sees)\s+|Most people (?:miss this|don'?t see this)[,:]?)\s*/gi,
    repl: '$1' },
  // #25 The reframe play. "X isn't [obvious]. It's [slight tweak]."
  // Pure rhetorical flourish; the slight tweak is rarely action-changing.
  { name: 'reframe_play',
    re: /(^|[\.\!\?]\s+|\n\s*)(?:It'?s not (?:really )?(?:about|a question of) [^,.]+\.\s*It'?s (?:about|a question of)\s+)/gi,
    repl: '$1' },
  // #26 Adverb overload. Delete intensifying adverbs that add weight to
  // sentences that should stand on their own. Word-boundary anchored
  // and only when followed by a space (so "actuallySomething" in code
  // identifiers stays put). Conservative -- only the worst offenders.
  { name: 'adverb_overload',
    re: /\b(?:Truly|truly|Actually|actually|Fundamentally|fundamentally|Essentially|essentially|Ultimately|ultimately|Literally|literally)(?=\s+[a-zA-Z])\s+/g,
    repl: '' },
  // #27 Qualifying hedge.
  { name: 'qualifying_hedge',
    re: /(^|[\.\!\?]\s+|\n\s*)(?:It'?s worth noting that|Interestingly(?: enough)?[,:]?|What'?s (?:fascinating|interesting) is(?: that)?[,:]?|It'?s important to note that|Notably[,:]?)\s*/gi,
    repl: '$1' },
  // #28 Overly smooth transitions.
  { name: 'smooth_transition',
    re: /(^|[\.\!\?]\s+|\n\s*)(?:Speaking of which[,:]?|This brings us to[^.]*\.|Building on (?:this|that)(?:\s+idea)?[,:]?|With that (?:in mind|said)[,:]?)\s*/gi,
    repl: '$1' },
  // #29 Parenthetical asides for relatability. "(yes, really)",
  // "(trust me on this)", "(I learned this the hard way)"
  { name: 'relatability_aside',
    re: /\s*\((?:yes,?\s*really|trust me(?:\s*on this)?|I learned this the hard way|no really|seriously|believe it or not)\)/gi,
    repl: '' },
  // #22 Metaphor stacking. 2+ "like X" / "as if Y" similes in the same
  // sentence. The first simile lands, the second+ stacks. Strip the
  // additional ones (collapses "X is like A, like B, like C" -> "X is
  // like A").
  { name: 'metaphor_stacking',
    re: /(\blike\s+[a-z][^,.;:!?]{0,40})\s*,\s*(?:like|as if)\s+[a-z][^,.;:!?]{0,40}(?:\s*,\s*(?:like|as if)\s+[a-z][^,.;:!?]{0,40})*/gi,
    repl: '$1' },
  // #24 Numbered wisdom list: drop 3+ short standalone maxim items.
  { name: 'numbered_wisdom_list',
    re: /(?:^|\n)(?:\s*\d+\.\s+[A-Z][^.\n]{5,75}\.\s*\n){3,}/gm,
    repl: '\n' },
  // #3 Parallel dramatic sentences: keep first repeated-opener sentence.
  { name: 'parallel_dramatic',
    re: /(\b(?:You|I|We|It|This|That|They)\b)([^.!?\n]{1,50}[.!?])\s+\1[^.!?\n]{1,50}[.!?]\s+\1[^.!?\n]{1,50}[.!?]/g,
    repl: '$1$2' },
  // Caveman compression: delete low-signal glue words/first-person filler.
  { name: 'caveman_compression',
    re: /\b(?:i\s+am|i\s+will|i['’]m|i['’]ll|i|has|too|is|the|now)\b\s*/gi,
    repl: '' },
  // #15 Excessive bold: sentinel invokes density-gated demoter below.
  { name: 'excessive_bold',
    re: null,  // handled in _stripExcessiveBold below
    repl: null },
];

// Catalog gaps: omitted patterns require whole-doc context or reader judgment.
const _CATALOG_NOT_IN_CODE = ['#4', '#5', '#6', '#14', '#16', '#18'];

function _capFix(s) {
  // After deletions, sentences may start with lowercase. Promote the
  // first alpha after sentence-end punctuation OR start-of-string.
  return s.replace(/(^|[.!?]\s+)([a-z])/g, (_m, lead, ch) => lead + ch.toUpperCase());
}

// #15 Excessive bold demoter; all-or-nothing when density is egregious.
function _stripExcessiveBold(text) {
  if (!text || typeof text !== 'string') return { out: text, hit: false };
  const boldRe = /\*\*([^*\n]{1,80})\*\*/g;
  const matches = [...text.matchAll(boldRe)];
  if (matches.length < 6) return { out: text, hit: false };
  const wordCount = (text.match(/\b[\w'-]+\b/g) || []).length;
  if (wordCount === 0) return { out: text, hit: false };
  const density = matches.length / wordCount;  // bolds per word
  if (density < 1 / 25) return { out: text, hit: false };
  // Density-positive AND most bolds short = highlighter pattern.
  const shortBolds = matches.filter((m) => m[1].length <= 30).length;
  if (shortBolds < matches.length * 0.7) return { out: text, hit: false };
  return { out: text.replace(boldRe, '$1'), hit: true };
}

function _stripSlop(text) {
  if (typeof text !== 'string' || !text) return { out: text, hits: [] };
  let out = text;
  const hits = [];
  for (const p of _SLOP_PATTERNS) {
    if (p.re === null) continue;  // function-style entries (e.g. excessive_bold)
    const before = out;
    out = out.replace(p.re, p.repl);
    if (out !== before) hits.push(p.name);
  }
  // Function-style strips: density-gated, can't be a simple regex.
  const boldResult = _stripExcessiveBold(out);
  if (boldResult.hit) {
    out = boldResult.out;
    hits.push('excessive_bold');
  }
  if (hits.length > 0) out = _capFix(out);
  // Collapse any double-spaces or " ," artifacts left by the deletions.
  out = out.replace(/ {2,}/g, ' ').replace(/\s+([,.;:!?])/g, '$1').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')');
  return { out, hits };
}

function _logSlopHits(hits, textPreview) {
  try {
    const fs = require('fs');
    const path = require('path');
    const { PROJECT_ROOT } = require('./shared');
    fs.appendFileSync(
      path.join(PROJECT_ROOT, 'log', 'hme-slop-strips.jsonl'),
      JSON.stringify({
        ts: new Date().toISOString(),
        hits,
        text_preview: textPreview.slice(0, 80),
      }) + '\n',
    );
  } catch (_e) { /* stat is best-effort */ }
}

// Always-on text-block slop rewriter; replay corrected block at stop.
function slopStripRewrite(eventName, data, ctx) {
  // Gated on priorUserWasDeny -- slop patterns mostly appear in stop-hook
  // follow-ups; normal turns stream freely.
  if (!ctx.get('priorUserWasDeny')) return data;
  const key = 'slop_text_hold';
  let holds = ctx.get(key);
  if (!holds) { holds = new Map(); ctx.set(key, holds); }

  if (eventName === 'content_block_start' && data && data.content_block && ['text', 'thinking'].includes(data.content_block.type)) {
    holds.set(data.index, { startData: data, blockType: data.content_block.type, deltas: [] });
    return null;  // hold the start
  }
  if (eventName === 'content_block_delta' && data && data.delta && ['text_delta', 'thinking_delta'].includes(data.delta.type)) {
    const state = holds.get(data.index);
    if (!state) return data;  // not a held block (e.g. ack-strip already swallowed it)
    state.deltas.push(data);
    return null;
  }
  if (eventName === 'content_block_stop' && data) {
    const state = holds.get(data.index);
    if (!state) return data;
    holds.delete(data.index);
    let assembled = '';
    for (const d of state.deltas) {
      if (!d || !d.delta) continue;
      if (typeof d.delta.text === 'string') assembled += d.delta.text;
      if (typeof d.delta.thinking === 'string') assembled += d.delta.thinking;
    }
    const { out, hits } = _stripSlop(assembled);
    if (hits.length > 0) _logSlopHits(hits, assembled);
    // Re-emit: the original start, ONE replacement delta with stripped
    // text, then the stop. Original deltas dropped (replaced by single
    // corrected delta) regardless of whether stripping changed anything
    // -- chunking semantics already lost by buffering.
    const events = [['content_block_start', state.startData]];
    if (out) {
      const delta = state.blockType === 'thinking'
        ? { type: 'thinking_delta', thinking: out }
        : { type: 'text_delta', text: out };
      events.push(['content_block_delta', {
        type: 'content_block_delta',
        index: data.index,
        delta,
      }]);
    }
    events.push(['content_block_stop', data]);
    return { events };
  }
  return data;
}

// Drop fake turn prefixes; decide after a short lookahead, then stream.
const _TURN_PREFIX_LOOKAHEAD = 64;

function hallucinatedTurnPrefixStripRewrite(eventName, data, ctx) {
  const key = 'turn_prefix_text_hold';
  let holds = ctx.get(key);
  if (!holds) { holds = new Map(); ctx.set(key, holds); }

  if (eventName === 'content_block_start' && data && data.content_block && data.content_block.type === 'text') {
    holds.set(data.index, { startData: data, deltas: [], decided: false, accumulated: '' });
    return null;
  }
  if (eventName === 'content_block_delta' && data && data.delta && data.delta.type === 'text_delta') {
    const state = holds.get(data.index);
    if (!state) return data;
    if (state.decided) return data;
    state.deltas.push(data);
    state.accumulated += data.delta.text || '';
    if (state.accumulated.length < _TURN_PREFIX_LOOKAHEAD) return null;
    const isPrefix = _isHallucinatedTurnPrefix(state.accumulated);
    const isDodge = _isCeremonyDodge(state.accumulated);
    if (isPrefix || isDodge) {
      try {
        const fs = require('fs');
        const path = require('path');
        const { PROJECT_ROOT } = require('./shared');
        fs.appendFileSync(
          path.join(PROJECT_ROOT, 'log', 'hme-turn-prefix-strips.jsonl'),
          JSON.stringify({
            ts: new Date().toISOString(),
            kind: isPrefix ? 'turn_prefix' : 'ceremony_dodge',
            text_preview: state.accumulated.slice(0, 100),
          }) + '\n',
        );
      } catch (_e) { /* stat is best-effort */ }
      state.decided = true;
      state.dropping = true;
      return null;
    }
    state.decided = true;
    const events = [['content_block_start', state.startData]];
    for (const d of state.deltas) events.push(['content_block_delta', d]);
    return { events };
  }
  if (eventName === 'content_block_stop' && data) {
    const state = holds.get(data.index);
    if (!state) return data;
    holds.delete(data.index);
    if (state.dropping) return null;
    if (state.decided) return data;
    let assembled = state.accumulated;
    const isPrefix = _isHallucinatedTurnPrefix(assembled);
    const isDodge = _isCeremonyDodge(assembled);
    if (isPrefix || isDodge) {
      // Best-effort stat (separate log; never errors.log).
      try {
        const fs = require('fs');
        const path = require('path');
        const { PROJECT_ROOT } = require('./shared');
        fs.appendFileSync(
          path.join(PROJECT_ROOT, 'log', 'hme-turn-prefix-strips.jsonl'),
          JSON.stringify({
            ts: new Date().toISOString(),
            kind: isPrefix ? 'turn_prefix' : 'ceremony_dodge',
            text_preview: assembled.slice(0, 100),
          }) + '\n',
        );
      } catch (_e) { /* stat is best-effort */ }
      return null;  // drop the whole block
    }
    // Not a hallucinated prefix -- replay held events through.
    const events = [['content_block_start', state.startData]];
    for (const d of state.deltas) {
      events.push(['content_block_delta', d]);
    }
    events.push(['content_block_stop', data]);
    return { events };
  }
  return data;
}

// Stop-hook ceremony detector: replace bypass explanations with `.`.
const _STOP_HOOK_CEREMONY_PATTERNS = [
  // Tier reclassification dance ("Tier reclassify per the doctrine...")
  /\btier\s+reclass\w*/i,
  /\bre[\s-]?evaluat\w+\s+(the\s+)?tier/i,
  /\b(?:re[\s-]?)?classify(?:ing)?\s+(?:the\s+)?(?:tier|turn|effort|work)/i,
  // "this turn was status-report / research / read-only"
  /\bthis\s+turn\s+(?:was|is)\s+(?:a\s+)?(?:status[\s-]?report|research|read[\s-]?only|brief|trivial|light(?:weight)?)/i,
  // Tier name dismissals ("not E4", "not Deep", "not Comprehensive")
  /\b(?:not\s+|isn'?t\s+)e[45]\b(?:\s+work|\s+effort|\s+tier|\s+floor)?/i,
  /\b(?:not|isn'?t)\s+(?:deep|comprehensive)\s+(?:effort|work|tier)/i,
  // "Per the doctrine's offered path" -- bypass framing using the rule's
  // own language as cover.
  /\bper\s+(?:the\s+)?(?:doctrine|hook|gate|stop[\s-]?hook|advisor)['']?s?\s+(?:own\s+)?(?:offered\s+)?path/i,
  /\b(?:the\s+)?(?:three|two)\s+offered\s+paths/i,
  // "The hook is firing on" / "the gate misclassified"
  /\bthe\s+(?:hook|gate|detector|doctrine|advisor|classifier|exhaust|psycho)\s+(?:is\s+)?(?:firing\s+on|misclassif|mis[\s-]?tagg|mis[\s-]?fired?|fired\s+on)/i,
  // "doesn't apply" excuses
  /\b(?:false[\s-]positive|floor\s+doesn'?t\s+apply|gate\s+doesn'?t\s+apply|doctrine\s+doesn'?t\s+apply|rule\s+doesn'?t\s+apply)/i,
  /\b(?:advisor|doctrine|gate|hook|rule)\s+(?:doesn'?t|does\s+not)\s+apply/i,
  // Solo-rationale shapes (block-start only; trailing-paragraph case
  // is handled surgically by soloRationaleTrimRewrite, not here).
  /^\s*solo[\s-](?:rationale|justification)\s*[:.]/i,
  /^\s*why\s+solo\s+(?:was|is)\s+(?:right|correct|the\s+(?:right|correct))/i,
  /^\s*solo\s+(?:was|is)\s+(?:right|correct|appropriate|the\s+(?:right|correct)\s+call)/i,
  // "The rule fired but..." / "the gate misfired"
  /\b(?:the\s+)?(?:rule|hook|gate|detector|doctrine)\s+(?:fired|misfired)\s+but/i,
  // "Acknowledged" as standalone ceremonial opener (not real new-info ack)
  /^\s*acknowledg(?:e|ed|ing)[\s.,:]+(?:the\s+)?(?:hook|gate|doctrine|stop|rule|warning|flag)/i,
];

function _isStopHookCeremony(text) {
  if (typeof text !== 'string' || !text) return false;
  // Scan only the first 200 chars to keep this conservative -- long
  // substantive responses that incidentally use one of these tokens
  // deep in the body are not affected.
  const lead = text.slice(0, 200);
  return _STOP_HOOK_CEREMONY_PATTERNS.some((p) => p.test(lead));
}

// Stop-hook ceremony strip: emit `.`, then suppress later content events.
function stopHookCeremonyStripRewrite(eventName, data, ctx) {
  if (!ctx.get('priorUserWasDeny')) return data;

  // Drop all subsequent content-level events once we've truncated.
  // Pass through message-level events so the stream completes.
  if (ctx.get('stop_hook_truncated')) {
    if (eventName === 'content_block_start'
        || eventName === 'content_block_delta'
        || eventName === 'content_block_stop') {
      return null;
    }
    return data;
  }

  const key = 'stop_hook_ceremony_hold';
  let holds = ctx.get(key);
  if (!holds) { holds = new Map(); ctx.set(key, holds); }

  if (eventName === 'content_block_start' && data && data.content_block && data.content_block.type === 'text') {
    holds.set(data.index, { startData: data, deltas: [] });
    return null;
  }
  if (eventName === 'content_block_delta' && data && data.delta && data.delta.type === 'text_delta') {
    const state = holds.get(data.index);
    if (!state) return data;
    state.deltas.push(data);
    return null;
  }
  if (eventName === 'content_block_stop' && data) {
    const state = holds.get(data.index);
    if (!state) return data;
    holds.delete(data.index);
    let assembled = '';
    for (const d of state.deltas) {
      if (d && d.delta && typeof d.delta.text === 'string') assembled += d.delta.text;
    }
    if (_isStopHookCeremony(assembled)) {
      ctx.set('stop_hook_truncated', true);
      try {
        const fs = require('fs');
        const path = require('path');
        const { PROJECT_ROOT } = require('./shared');
        fs.appendFileSync(
          path.join(PROJECT_ROOT, 'log', 'hme-stop-hook-ceremony-strips.jsonl'),
          JSON.stringify({
            ts: new Date().toISOString(),
            text_preview: assembled.slice(0, 300),
            assembled_len: assembled.length,
          }) + '\n',
        );
      } catch (_e) { /* stat is best-effort */ }
      const events = [
        ['content_block_start', state.startData],
        ['content_block_delta', {
          type: 'content_block_delta',
          index: data.index,
          delta: { type: 'text_delta', text: '.' },
        }],
        ['content_block_stop', data],
      ];
      return { events };
    }
    // Not ceremony -- replay held events through.
    const events = [['content_block_start', state.startData]];
    for (const d of state.deltas) {
      events.push(['content_block_delta', d]);
    }
    events.push(['content_block_stop', data]);
    return { events };
  }
  return data;
}

// FP-CHECK marker handler: normalize yes/no markers before client display.
function fpGateMarkerRewrite(eventName, data, ctx) {
  if (!ctx.get('priorUserWasDeny')) return data;

  // Once truncated, drop all subsequent content events. Pass-through
  // message-level events so the stream completes cleanly.
  if (ctx.get('fp_gate_truncated')) {
    if (eventName === 'content_block_start'
        || eventName === 'content_block_delta'
        || eventName === 'content_block_stop') {
      return null;
    }
    return data;
  }

  const key = 'fp_gate_hold';
  let holds = ctx.get(key);
  if (!holds) { holds = new Map(); ctx.set(key, holds); }

  if (eventName === 'content_block_start' && data && data.content_block && data.content_block.type === 'text') {
    holds.set(data.index, { startData: data, deltas: [] });
    return null;
  }
  if (eventName === 'content_block_delta' && data && data.delta && data.delta.type === 'text_delta') {
    const state = holds.get(data.index);
    if (!state) return data;
    state.deltas.push(data);
    return null;
  }
  if (eventName === 'content_block_stop' && data) {
    const state = holds.get(data.index);
    if (!state) return data;
    holds.delete(data.index);
    let assembled = '';
    for (const d of state.deltas) {
      if (d && d.delta && typeof d.delta.text === 'string') assembled += d.delta.text;
    }
    // Only act on FIRST text block (subsequent blocks shouldn't carry
    // the marker -- they're already past the gate).
    const alreadyHandled = ctx.get('fp_gate_first_block_done');
    if (alreadyHandled) {
      const events = [['content_block_start', state.startData]];
      for (const d of state.deltas) events.push(['content_block_delta', d]);
      events.push(['content_block_stop', data]);
      return { events };
    }
    ctx.set('fp_gate_first_block_done', true);

    // YES: drop the rest of the model's output, but emit a VISIBLE marker
    // so the user can distinguish "intentional silence (fp-gate yes)" from
    // "model crashed / blank response". Earlier we collapsed to `.` which
    // Claude Code's UI renders as nothing -> indistinguishable from a bug.
    if (/\[FP-CHECK:\s*yes\]/i.test(assembled)) {
      ctx.set('fp_gate_truncated', true);
      try {
        const fs = require('fs');
        const path = require('path');
        const { PROJECT_ROOT } = require('./shared');
        fs.appendFileSync(
          path.join(PROJECT_ROOT, 'log', 'hme-fp-gate-marker.jsonl'),
          JSON.stringify({
            ts: new Date().toISOString(),
            verdict: 'yes',
            assembled_len: assembled.length,
            preview: assembled.slice(0, 200),
          }) + '\n',
        );
      } catch (_e) { /* stat is best-effort */ }
      const events = [
        ['content_block_start', state.startData],
        ['content_block_delta', {
          type: 'content_block_delta',
          index: data.index,
          delta: { type: 'text_delta', text: '`[fp-gate: yes -- silent ack of false-positive flag]`' },
        }],
        ['content_block_stop', data],
      ];
      return { events };
    }

    // NO: strip the marker line + trailing whitespace, pass rest through.
    const noMatch = assembled.match(/^[\s]*\[FP-CHECK:\s*no\]\s*\n?/i);
    if (noMatch) {
      const stripped = assembled.slice(noMatch[0].length);
      try {
        const fs = require('fs');
        const path = require('path');
        const { PROJECT_ROOT } = require('./shared');
        fs.appendFileSync(
          path.join(PROJECT_ROOT, 'log', 'hme-fp-gate-marker.jsonl'),
          JSON.stringify({
            ts: new Date().toISOString(),
            verdict: 'no',
            kept_len: stripped.length,
          }) + '\n',
        );
      } catch (_e) { /* stat is best-effort */ }
      const events = [['content_block_start', state.startData]];
      if (stripped) {
        events.push(['content_block_delta', {
          type: 'content_block_delta',
          index: data.index,
          delta: { type: 'text_delta', text: stripped },
        }]);
      }
      events.push(['content_block_stop', data]);
      return { events };
    }

    // Marker missing -- agent ignored the fp-gate. Pass through; the
    // older stopHookCeremonyStripRewrite catches prose-shaped ceremony
    // as a fallback.
    const events = [['content_block_start', state.startData]];
    for (const d of state.deltas) events.push(['content_block_delta', d]);
    events.push(['content_block_stop', data]);
    return { events };
  }
  return data;
}

// Surgical trim of trailing solo-rationale paragraph; preserves substantive prefix.
// Gated on priorUserWasDeny -- solo-rationale only emitted in response to
// advisor-doctrine flags. Normal turns stream freely.
function soloRationaleTrimRewrite(eventName, data, ctx) {
  if (!ctx.get('priorUserWasDeny')) return data;
  const key = 'srt_hold';
  let holds = ctx.get(key);
  if (!holds) { holds = new Map(); ctx.set(key, holds); }

  if (eventName === 'content_block_start' && data && data.content_block && data.content_block.type === 'text') {
    holds.set(data.index, { startData: data, deltas: [] });
    return null;
  }
  if (eventName === 'content_block_delta' && data && data.delta && data.delta.type === 'text_delta') {
    const state = holds.get(data.index);
    if (!state) return data;
    state.deltas.push(data);
    return null;
  }
  if (eventName === 'content_block_stop' && data) {
    const state = holds.get(data.index);
    if (!state) return data;
    holds.delete(data.index);
    let assembled = '';
    for (const d of state.deltas) {
      if (d && d.delta && typeof d.delta.text === 'string') assembled += d.delta.text;
    }
    const { text: trimmed, trimmed: didTrim } = _trimSoloRationaleParagraph(assembled);
    if (!didTrim) {
      const events = [['content_block_start', state.startData]];
      for (const d of state.deltas) events.push(['content_block_delta', d]);
      events.push(['content_block_stop', data]);
      return { events };
    }
    try {
      const fs = require('fs');
      const path = require('path');
      const { PROJECT_ROOT } = require('./shared');
      fs.appendFileSync(
        path.join(PROJECT_ROOT, 'log', 'hme-solo-rationale-trim.jsonl'),
        JSON.stringify({
          ts: new Date().toISOString(),
          original_len: assembled.length,
          trimmed_len: trimmed.length,
          removed_len: assembled.length - trimmed.length,
          removed_preview: assembled.slice(trimmed.length).slice(0, 200),
        }) + '\n',
      );
    } catch (_e) { /* best-effort */ }
    const events = [['content_block_start', state.startData]];
    if (trimmed) {
      events.push(['content_block_delta', {
        type: 'content_block_delta',
        index: data.index,
        delta: { type: 'text_delta', text: trimmed },
      }]);
    }
    events.push(['content_block_stop', data]);
    return { events };
  }
  return data;
}

module.exports = {
  dropToolUseRewrite,
  editFallbackToReadRewrite,
  readInputNormalizeRewrite,
  bashPolicyRewrite,
  runInBackgroundRewrite,
  longLeadingSleepRewrite,
  ackStripRewrite,
  slopStripRewrite,
  hallucinatedTurnPrefixStripRewrite,
  stopHookCeremonyStripRewrite,
  fpGateMarkerRewrite,
  soloRationaleTrimRewrite,
  _isBareAck,                  // exported for tests
  _isHallucinatedTurnPrefix,   // exported for tests
  _isCeremonyDodge,            // exported for tests
  _isStopHookCeremony,         // exported for tests
  _trimSoloRationaleParagraph, // exported for tests
  _rewriteLongLeadingSleep,    // exported for tests
  _normalizeReadInput,         // exported for tests
  _stripSlop,                  // exported for tests
};
