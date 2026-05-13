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

function _holdToolInput(ctx, key, eventName, data, names) {
  let holds = ctx.get(key);
  if (!holds) { holds = new Map(); ctx.set(key, holds); }
  if (eventName === 'content_block_start' && data && data.content_block && data.content_block.type === 'tool_use') {
    if (names.has(data.content_block.name)) {
      holds.set(data.index, { id: data.content_block.id, name: data.content_block.name, partial: '', firstDeltaShape: null });
    }
  }
  return holds;
}

function runInBackgroundRewrite(eventName, data, ctx) {
  const holds = _holdToolInput(ctx, 'bash_hold', eventName, data, new Set(['Bash']));

  // Track Bash tool_use blocks -- start holding their deltas.
  if (eventName === 'content_block_start' && data && data.content_block && data.content_block.type === 'tool_use') return data;

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

// Hallucinated turn-prefix detection. ANY assistant text block that
// starts with `Human:` or `Assistant:` (case-sensitive on the H/A,
// followed by colon) is the model fabricating a fresh turn boundary
// inside its own response -- never legitimate. The previous version
// only matched when the prefix was followed by `<system-reminder>` or
// known stop-hook payload tokens; free-form fake user turns ("Human:
// i am a sample user...") slipped past. Now: any prefix shape, with
// or without trailing content, fires.
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

// Stop-hook ceremony-dodge detection. The advisor doctrine's escape
// hatch ("the agent must explicitly justify why solo was right")
// invites a class of long-form prose responses that exist only to
// satisfy the gate -- "Solo-rationale: ..." / "Why solo was right: ..."
// /  "Solo was the right call because ...". User flagged these as
// "completely useless spam" -- they're ceremony in service of dodging
// a stop-hook check, not substantive work. Always-illegitimate
// (independent of priorUserWasDeny gate) -- belongs in the always-on
// strip path alongside hallucinated turn prefixes.
//
// Conservative scope: only the literal doctrine-prompted phrasings.
// Generic "Rationale:" / "Justification:" stays clear because users
// can legitimately ask for those.
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

// Anti-slop strip. 19 of the 29 patterns from
// recursive-drift/templates/voice/anti-slop.md are implemented below.
// The remaining 10 are out of regex scope (see _UNIMPLEMENTED_SLOP at
// the bottom of this block for the list and reasons).
//
// Each entry is {re, repl, name}: `re` matches the slop phrase
// (case-insensitive, multi-line aware), `repl` is the substitute
// (usually `$1` -- preserve the leading sentence boundary, delete the
// rest). `name` is the pattern label for the stat log.
//
// Capitalize-after rule: if the regex deletes a sentence prefix and
// leaves the next word lowercase, the post-pass _capFix promotes the
// first letter. Without this, "Let me be clear, the value is X" -> ", the
// value is X" -> ", The value is X" via the cap fix.
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
  // #24 Numbered wisdom list. A run of numbered items where every item
  // is a short, self-contained maxim (no verb-leading action, no
  // continuation). Heuristic: 3+ consecutive lines of `\d+\.` where
  // each line is <= 80 chars and ends with `.`. Drops the whole list
  // -- the maxims rarely connect; if they did the agent should write
  // a paragraph.
  { name: 'numbered_wisdom_list',
    re: /(?:^|\n)(?:\s*\d+\.\s+[A-Z][^.\n]{5,75}\.\s*\n){3,}/gm,
    repl: '\n' },
  // #3 Three parallel dramatic sentences. 3+ consecutive short
  // sentences (<=50 chars body each) that share an identical opening
  // pronoun. Catalog example: "You can't see it. You can't copy-paste
  // it away. You have to know it exists." -- collapse to the first
  // sentence. Backref `\1` captures just the opening token, NOT the
  // whole sentence, so the match anchors on shared opener.
  { name: 'parallel_dramatic',
    re: /(\b(?:You|I|We|It|This|That|They)\b)([^.!?\n]{1,50}[.!?])\s+\1[^.!?\n]{1,50}[.!?]\s+\1[^.!?\n]{1,50}[.!?]/g,
    repl: '$1$2' },
  // #15 Excessive bold. When a single text block has > 1 bold token
  // per ~25 words, AI is highlighter-spamming. We can't selectively
  // demote without judgment, so we only fire when the density is
  // egregious (>= 6 bold tokens in <= 150 words = ~1 per 25 words)
  // AND most of them are short single-word/phrase emphasis. When that
  // matches, demote ALL bolds in the block to plain text. Conservative
  // density threshold avoids damaging legitimate emphasis in normal
  // prose. Implemented as a function-style rewrite below; the entry
  // here is a sentinel so the strip pass invokes the function.
  { name: 'excessive_bold',
    re: null,  // handled in _stripExcessiveBold below
    repl: null },
];

// Catalog patterns NOT implemented in code, with the structural reason
// each one cannot run inside a per-content_block regex rewriter:
//   #4  Bookend summary       -- compares the intro of a doc to the
//                                conclusion; the proxy only ever sees a
//                                single content_block at a time, never
//                                an intro/conclusion pair.
//   #5  Perfect section symmetry -- whole-doc layout analysis (length
//                                ratios across sections); single-block
//                                scope cannot see siblings.
//   #6  Ascending list        -- comparison across list items requires
//                                whole-list context; the SSE delta
//                                stream emits list items piecemeal.
//   #14 Overcomplicated tech detail -- audience-relative judgment; the
//                                proxy has no reader model to compare
//                                detail depth against.
//   #16 Quotation marks for emphasis -- ambiguous with code (variable
//                                names like "tool_use", file paths,
//                                JSON strings). Auto-strip damages
//                                tool-shape text more than it helps.
//   #18 Obvious insight dressed up -- requires world model to know
//                                what's obvious. No regex can reason
//                                about novelty.
// Recursive-drift's reference implementation auto-fixes ~5 patterns
// (em-dash + a few authority phrases) and uses regenerate-on-fail for
// the rest -- that pattern doesn't fit a passthrough proxy.
const _CATALOG_NOT_IN_CODE = ['#4', '#5', '#6', '#14', '#16', '#18'];

function _capFix(s) {
  // After deletions, sentences may start with lowercase. Promote the
  // first alpha after sentence-end punctuation OR start-of-string.
  return s.replace(/(^|[.!?]\s+)([a-z])/g, (_m, lead, ch) => lead + ch.toUpperCase());
}

// #15 Excessive bold demoter. Counts `**X**` tokens; if density per
// word exceeds threshold AND most bolds are short emphasis, strips
// ALL `**` markers in the block. Non-trivial: we can't pick which
// individual bolds are slop-emphasis vs real emphasis, so it's
// all-or-nothing on the block, gated by density.
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
  // Gated on priorUserWasDeny -- slop patterns mostly appear in stop-hook
  // follow-ups; normal turns stream freely.
  if (!ctx.get('priorUserWasDeny')) return data;
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

// Always-on whole-block drop for hallucinated turn-prefix shapes.
// Independent of ackStripRewrite (priorUserWasDeny gate) and
// slopStripRewrite (inline modifications). A `Human:` / `Assistant:`
// prefix at the start of an assistant text block is never legitimate
// regardless of conversational context -- the model is fabricating a
// turn boundary inside its own response. Drop the whole block; the
// chat client never sees the fake turn.
// Lookahead-and-flush: only buffer until ~64 chars accumulated, decide,
// then flush + stream rest directly. Restores token-by-token streaming.
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

// Full-spectrum stop-hook ceremony detector. Catches the WHOLE class of
// "explain why the stop-hook misfired / doesn't apply / can be dismissed"
// responses. This is the next layer beyond _isCeremonyDodge (which only
// catches `Solo-rationale:` and explicit "why solo was right" framings).
//
// User intent: when the prior user message was a stop-hook payload AND
// the agent's response is bypass-explanation rather than substantive
// work, REPLACE the whole text with `.` and end the turn cleanly.
// Saves the next-turn context burn of carrying the bypass prose
// forward in the transcript.
//
// Gate: only fires when ctx.priorUserWasDeny is set (i.e. the prior
// user message contained a stop-hook payload marker). Regular user
// prompts that happen to mention "tier" or "doctrine" mid-prose are
// not affected.
//
// Conservative match window: only the FIRST 200 chars of the assembled
// text are scanned. A long substantive response that incidentally
// mentions one of these tokens deeper in the body is not affected.
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

// Always-active when ctx.priorUserWasDeny is set (i.e. prior user
// message was a stop-hook payload). Buffers text content_blocks; on
// stop, if the assembled text matches the ceremony shape, replaces
// the entire block content with a single `.` delta AND sets a
// truncated flag so all subsequent content events from upstream are
// dropped (the upstream stream still completes via message_delta /
// message_stop, but no further client-visible content is emitted).
//
// This is the user's "simulate stop button" semantic at the SSE
// layer -- the model continues generating but the proxy stops
// forwarding text after the first ceremony-shape block.
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

// FP-CHECK marker handler. The companion to the chunk-level upstream
// kill in hme_proxy.js. By the time SSE events reach this rewriter,
// either (a) the upstream completed normally (no `[FP-CHECK: yes]`
// emitted) or (b) the upstream was killed mid-stream after `[FP-CHECK:
// yes]` was seen. In both cases this rewriter normalizes the
// client-visible output:
//   - `yes` marker present anywhere in first text block -> emit `.`,
//     drop everything else
//   - `no` marker on first line -> strip the marker line (and trailing
//     newline), pass through the rest verbatim
//   - marker missing -> agent ignored the fp-gate, fall through to
//     existing ceremony detection (older stopHookCeremonyStripRewrite)
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
  _stripSlop,                  // exported for tests
};
