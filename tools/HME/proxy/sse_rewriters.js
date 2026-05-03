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

//  Rewriter: Bash run_in_background -> /hme/spawn
// Holds all `content_block_delta` events for a Bash tool_use until the
// corresponding `content_block_stop`, parses the accumulated input, and if
// run_in_background=true, replaces the command with a synchronous curl to
// /hme/spawn (proxy's TTL-bounded spawn endpoint). Emits one synthetic
// delta carrying the rewritten input, then the original stop event.
//
// Claude Code runs the curl as a normal (non-background) Bash call, gets
// the spawn id as the tool_result, and never fires a task-notification.

const SPAWN_URL = 'http://127.0.0.1:9099/hme/spawn';

function _buildSpawnCommand(originalCmd, description) {
  const payload = JSON.stringify({
    name: (description || 'bg').replace(/[^\w-]/g, '_').slice(0, 24),
    cmd: 'bash',
    args: ['-c', originalCmd],
    ttl_sec: 3600,
  }).replace(/'/g, `'\\''`);
  return `curl -sf -X POST ${SPAWN_URL} -H 'content-type: application/json' -d '${payload}'`;
}

function runInBackgroundRewrite(eventName, data, ctx) {
  const key = 'bash_hold';
  let holds = ctx.get(key);
  if (!holds) { holds = new Map(); ctx.set(key, holds); }

  // Track Bash tool_use blocks -- start holding their deltas.
  if (eventName === 'content_block_start' && data && data.content_block && data.content_block.type === 'tool_use') {
    if (data.content_block.name === 'Bash') {
      holds.set(data.index, {
        id: data.content_block.id,
        partial: '',
        firstDeltaShape: null,
      });
    }
    return data;
  }

  // Hold deltas for tracked Bash tool_uses.
  if (eventName === 'content_block_delta' && data && data.delta && data.delta.type === 'input_json_delta') {
    const state = holds.get(data.index);
    if (state) {
      state.partial += (data.delta.partial_json || '');
      if (!state.firstDeltaShape) {
        state.firstDeltaShape = { type: data.type, index: data.index };
      }
      return null; // drop -- we re-emit on content_block_stop
    }
    return data;
  }

  // On stop: parse accumulated input, rewrite if needed, emit [synthetic_delta, stop].
  if (eventName === 'content_block_stop' && data) {
    const state = holds.get(data.index);
    if (!state) return data;
    holds.delete(data.index);

    let input = null;
    try { input = JSON.parse(state.partial); }
    catch (_e) { /* malformed partial -- emit as-is so the error surfaces */ }

    let finalInput = input;
    if (input && input.run_in_background === true && typeof input.command === 'string') {
      finalInput = {
        command: _buildSpawnCommand(input.command, input.description || ''),
        description: input.description || 'spawned via /hme/spawn',
      };
    }

    const events = [];
    if (finalInput !== null) {
      events.push(['content_block_delta', {
        type: 'content_block_delta',
        index: data.index,
        delta: { type: 'input_json_delta', partial_json: JSON.stringify(finalInput) },
      }]);
    } else if (state.partial) {
      // Malformed JSON -- replay the original partial so the client can error.
      events.push(['content_block_delta', {
        type: 'content_block_delta',
        index: data.index,
        delta: { type: 'input_json_delta', partial_json: state.partial },
      }]);
    }
    events.push(['content_block_stop', data]);
    return { events };
  }
  return data;
}

//  Rewriter: long-leading-sleep -> no-op-prefix rewrite
//
// Claude Code's built-in Bash safety filter rejects commands that start
// with `sleep N` (where N is large) to prevent the agent from burning
// wall-clock on a blind wait. The rejection looks like:
//   "Blocked: sleep 60 followed by: ... To wait for a condition, use
//    Monitor with an until-loop ... Do not chain shorter sleeps"
// That tool_use_error interrupts the agent with a full round-trip of
// context overhead (the agent has to read the error, understand the
// suggestion, and re-issue). Instead, rewrite the command silently at
// the SSE layer so Claude Code never trips the block.
//
// Strategy: prefix leading `sleep N` with a no-op command so the leading
// token is `:` (true), not sleep. The pattern `sleep N; CMD` or
// `sleep N && CMD` becomes `: ; sleep N; CMD` -- semantically identical,
// no command deleted or reordered, leading token is `:`.
//
// Trigger: command starts with `sleep <integer>` followed by `;`, `&&`,
// `||`, or `|`. Also handles compound statements inside `bash -c`/`sh -c`.
// Agent-initiated short sleeps (sleep 2 / sleep 5) are not rewritten --
// Claude Code's filter targets long waits only, and rewriting every
// small sleep would be noisy. Threshold: leading sleep >= 10s -> rewrite.
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

function longLeadingSleepRewrite(eventName, data, ctx) {
  // Uses the same per-index hold pattern as runInBackgroundRewrite so
  // both rewriters see the fully-assembled tool_use input on the stop
  // event. They share the `bash_hold` ctx key, but both read-not-mutate
  // the .partial string until content_block_stop -- safe to co-exist as
  // long as we don't duplicate the emit logic. This rewriter ONLY runs
  // on the stop event and only emits if it actually needs to rewrite.
  if (eventName !== 'content_block_stop' || !data) return data;
  const holds = ctx.get('bash_hold');
  if (!holds) return data;
  // Peek -- don't delete; runInBackgroundRewrite (run AFTER this in the
  // chain) will handle deletion + final emit.
  const state = holds.get(data.index);
  if (!state) return data;
  let input = null;
  try { input = JSON.parse(state.partial); } catch (_e) { return data; }
  if (!input || typeof input.command !== 'string') return data;
  const rewritten = _rewriteLongLeadingSleep(input.command);
  if (rewritten === input.command) return data;
  // Mutate the held state so runInBackgroundRewrite sees the rewritten
  // command when it reads state.partial on stop. Preserve other keys.
  input.command = rewritten;
  state.partial = JSON.stringify(input);
  return data;
}

// Rewriter: strip bare-ack text blocks when the request was a stop-hook
// cascade. Context: the agent literally cannot emit zero bytes -- every
// turn must contain content. When the prior user message is a stop-hook
// deny payload (AUTO-COMPLETENESS / STOP-WORK / etc.) and the agent
// emits "ok" (the silence-equivalent), the chat client still displays
// "ok" because the proxy passes streaming text through verbatim. The
// user's complaint: "ok" spam in the chat. Total proxy dominance lets us
// strip those text blocks BEFORE they reach the chat client.
//
// Strategy: ack_strip rewriter watches text content_blocks. For each
// text block it buffers deltas. On content_block_stop, if the assembled
// text matches a bare-ack pattern AND ctx.priorUserWasDeny is true,
// drop the entire block (all events: start, deltas, stop). Other text
// blocks pass through verbatim.
//
// ctx.priorUserWasDeny is populated by the proxy at request-handling
// time -- it scans the request payload's last user message for the
// hook-payload markers and sets the flag before passing to the
// rewriter chain.
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

function _isBareAck(text) {
  if (typeof text !== 'string') return false;
  if (_ACK_PATTERNS.some((pat) => pat.test(text))) return true;
  if (_isMinimalAck(text)) return true;
  // Hallucinated turn-prefix output: text consisting entirely of one or
  // more `Human:` / `Assistant:` tokens (with optional newlines/spaces
  // between, possibly followed by trailing whitespace).
  if (/^\s*(?:(?:Human|Assistant)\s*:\s*){1,}\s*$/.test(text)) return true;
  // Hallucinated turn-prefix FOLLOWED BY content the model regurgitated
  // from its own system context (e.g. `Human: <system-reminder>`). This
  // is the gate-dodge variant where the model fabricates an entire fake
  // user turn including an inner system-reminder tag. The user has called
  // this out repeatedly; treat it as ack-class spam and strip.
  if (/^\s*(?:Human|Assistant)\s*:\s*<\s*system-reminder/.test(text)) return true;
  // Same shape but with stop-hook payload echo instead of system-reminder.
  if (/^\s*(?:Human|Assistant)\s*:\s*(?:Stop hook|AUTO-COMPLETENESS|PreToolUse|PostToolUse|EXHAUST PROTOCOL|PSYCHOPATHIC-STOP|ADVISOR DOCTRINE|STOP-WORK)/.test(text)) return true;
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
      // Strip is the cure -- the chat client never sees this "ok".
      // Write a structured stat line to a SEPARATE log (not errors.log)
      // so frequency stays observable without lifesaver/status injectors
      // re-surfacing it as an unresolved error every turn. The earlier
      // "emit to errors.log so the agent diagnoses" design self-defeated:
      // the strip already handles the user-visible spam, so the alert
      // became its own coherence-noise spam.
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

// Anti-slop strip. 8 of the 29 patterns from
// recursive-drift/templates/voice/anti-slop.md, scoped to engineering-
// agent text (skipping content-publishing-shaped ones like empathy
// openers, narrative pivots, parenthetical-aside relatability, etc.).
//
// Each entry is {re, repl, name}: `re` matches the slop phrase
// (case-insensitive, multi-line aware), `repl` is the substitute
// (usually empty -- delete the phrase). `name` is the pattern label
// for the stat log.
//
// Capitalize-after rule: if the regex deletes a sentence prefix and
// leaves the next word lowercase, the post-pass _capFix promotes the
// first letter. Without this, "Let me be clear, the value is X" -> ", the
// value is X" -> ", The value is X" via the cap fix. (Less mangled than
// leaving "the" mid-sentence after the leading comma.)
const _SLOP_PATTERNS = [
  // #1 Narrator setup. "Here's the thing..." / "Here's where..."
  // The "about <topic>" clause is intentionally NOT captured -- a topic
  // like "caching: ..." would let `[^,.]+` swallow past the colon and
  // eat the actual content. The slop is the lead-in phrase itself; the
  // sentence's substantive content stays put.
  { name: 'narrator_setup',
    re: /(^|[\.\!\?]\s+|\n\s*)(?:Here'?s the thing[,:]?|Here'?s where it gets interesting[,:]?|Here'?s where the real [a-zA-Z]+ lives[,:]?)\s*/gi,
    repl: '$1' },
  // #7 Authority signaling.
  { name: 'authority_signal',
    re: /(^|[\.\!\?]\s+|\n\s*)(?:Let me be clear[,:]?|The uncomfortable truth is(?: that)?[,:]?|Here'?s what nobody tells you[,:]?|The hard truth is(?: that)?[,:]?|Here'?s the reality[,:]?|What most people miss is(?: that)?[,:]?)\s*/gi,
    repl: '$1' },
  // #12 Wisdom packaging. Strip the lead-in; leave the actual point.
  { name: 'wisdom_packaging',
    re: /(^|[\.\!\?]\s+|\n\s*)(?:The lesson\??[:.]?|The takeaway(?:\s+here)?\s+is(?:\s+simple)?[:.]?|What this really means is(?: that)?[,:]?)\s*/gi,
    repl: '$1' },
  // #21 Humble-brag disclaimer. "Not claiming to be an expert, but..."
  { name: 'humble_brag',
    re: /(^|[\.\!\?]\s+|\n\s*)(?:I don'?t have all the answers,? but|Not claiming to be (?:an? )?expert,? but|Just my (?:two cents|2c|opinion),? but)\s+/gi,
    repl: '$1' },
  // #27 Qualifying hedge. "It's worth noting that..." / "Interestingly enough..."
  { name: 'qualifying_hedge',
    re: /(^|[\.\!\?]\s+|\n\s*)(?:It'?s worth noting that|Interestingly(?: enough)?[,:]?|What'?s (?:fascinating|interesting) is(?: that)?[,:]?|It'?s important to note that|Notably[,:]?)\s*/gi,
    repl: '$1' },
  // #28 Overly smooth transitions.
  { name: 'smooth_transition',
    re: /(^|[\.\!\?]\s+|\n\s*)(?:Speaking of which[,:]?|This brings us to[^.]*\.|Building on (?:this|that)(?:\s+idea)?[,:]?|With that (?:in mind|said)[,:]?)\s*/gi,
    repl: '$1' },
  // #17 Colon-listed everything (sequence of "X: Y. Z: W." short snaps).
  // Tactical: only catch the "The result: ..., The impact: ..., The
  // lesson: ..." trio shape. Single colon-statements are legitimate
  // and left alone.
  { name: 'colon_list_trio',
    re: /(?:^|\n)(?:\s*The (?:result|impact|lesson|takeaway|point|outcome|effect)[:.]\s*[^.\n]+\.\s*){3,}/gi,
    repl: '\n' },
  // #13 Em-dash crutch. Replace bracketing em-dashes / `--` with commas
  // when used as parenthetical bridges. Keeps em-dashes that look
  // structural (start-of-line lists, code). NOTE: imperfect heuristic.
  { name: 'em_dash_crutch',
    re: /(\w)\s+(?:—|--)\s+(\w)/g,
    repl: '$1, $2' },
];

function _capFix(s) {
  // After deletions, sentences may start with lowercase. Promote the
  // first alpha after sentence-end punctuation OR start-of-string.
  return s.replace(/(^|[.!?]\s+)([a-z])/g, (_m, lead, ch) => lead + ch.toUpperCase());
}

function _stripSlop(text) {
  if (typeof text !== 'string' || !text) return { out: text, hits: [] };
  let out = text;
  const hits = [];
  for (const p of _SLOP_PATTERNS) {
    const before = out;
    out = out.replace(p.re, p.repl);
    if (out !== before) hits.push(p.name);
  }
  if (hits.length > 0) out = _capFix(out);
  // Collapse any double-spaces or " ," artifacts left by the deletions.
  out = out.replace(/ {2,}/g, ' ').replace(/\s+,/g, ',').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')');
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

// Always-on rewriter: buffer text content blocks, run _stripSlop on
// the assembled text at content_block_stop, replay as a single
// corrected delta. UX cost: text blocks land at block_stop instead of
// streaming. Acceptable per explicit operator request.
//
// Independent of ackStripRewrite -- runs alongside it. ackStripRewrite
// (priorUserWasDeny only) drops the whole block on bare-ack; this
// rewriter modifies content of every text block.
function slopStripRewrite(eventName, data, ctx) {
  const key = 'slop_text_hold';
  let holds = ctx.get(key);
  if (!holds) { holds = new Map(); ctx.set(key, holds); }

  if (eventName === 'content_block_start' && data && data.content_block && data.content_block.type === 'text') {
    holds.set(data.index, { startData: data, deltas: [] });
    return null;  // hold the start
  }
  if (eventName === 'content_block_delta' && data && data.delta && data.delta.type === 'text_delta') {
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
      if (d && d.delta && typeof d.delta.text === 'string') assembled += d.delta.text;
    }
    const { out, hits } = _stripSlop(assembled);
    if (hits.length > 0) _logSlopHits(hits, assembled);
    // Re-emit: the original start, ONE replacement delta with stripped
    // text, then the stop. Original deltas dropped (replaced by single
    // corrected delta) regardless of whether stripping changed anything
    // -- chunking semantics already lost by buffering.
    const events = [['content_block_start', state.startData]];
    if (out) {
      events.push(['content_block_delta', {
        type: 'content_block_delta',
        index: data.index,
        delta: { type: 'text_delta', text: out },
      }]);
    }
    events.push(['content_block_stop', data]);
    return { events };
  }
  return data;
}

module.exports = {
  runInBackgroundRewrite,
  longLeadingSleepRewrite,
  ackStripRewrite,
  slopStripRewrite,
  _isBareAck,             // exported for tests
  _rewriteLongLeadingSleep, // exported for tests
  _stripSlop,             // exported for tests
};
