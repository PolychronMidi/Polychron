'use strict';

const { _isStopHookCeremony, _trimSoloRationaleParagraph } = require('./predicates');

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
        const { PROJECT_ROOT } = require('../shared');
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
        const { PROJECT_ROOT } = require('../shared');
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
        const { PROJECT_ROOT } = require('../shared');
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
      const { PROJECT_ROOT } = require('../shared');
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
  stopHookCeremonyStripRewrite,
  fpGateMarkerRewrite,
  soloRationaleTrimRewrite,
};
