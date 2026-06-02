'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  compactEntry,
  compactTranscriptLines,
  compactTranscriptFile,
  maybeCompactTranscriptFile,
} = require('../../proxy/transcript_compactor');

function bigToolEntry(i, size) {
  return {
    uuid: `u${i}`,
    parentUuid: i === 0 ? null : `u${i - 1}`,
    type: 'user',
    timestamp: `t${i}`,
    toolUseResult: { stdout: 'x'.repeat(size), stderr: '' },
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: `call${i}`, content: 'y'.repeat(size) }],
    },
  };
}

test('compactEntry elides heavy toolUseResult + tool_result but keeps small fields', () => {
  const entry = {
    uuid: 'u1',
    parentUuid: 'u0',
    toolUseResult: { stdout: 'x'.repeat(50000) },
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c1', content: 'y'.repeat(50000) }] },
  };
  const saved = compactEntry(entry, 4096);
  assert.ok(saved > 0);
  assert.equal(entry.uuid, 'u1', 'envelope preserved');
  assert.equal(entry.parentUuid, 'u0', 'chain link preserved');
  assert.match(JSON.stringify(entry.toolUseResult), /transcript-compactor/);
  assert.match(entry.message.content[0].content, /transcript-compactor/);
  assert.equal(entry.message.content[0].type, 'tool_result', 'block type preserved');
  assert.equal(entry.message.content[0].tool_use_id, 'c1', 'tool_use_id preserved');
});

test('compactEntry leaves small results and text/thinking/tool_use untouched', () => {
  const entry = {
    uuid: 'u2',
    toolUseResult: { stdout: 'small' },
    message: {
      role: 'assistant',
      content: [
        { type: 'text', text: 'hello' },
        { type: 'thinking', thinking: 'reasoning', signature: 's'.repeat(20000) },
        { type: 'tool_use', id: 'c2', name: 'Bash', input: { command: 'ls' } },
        { type: 'tool_result', tool_use_id: 'c0', content: 'short output' },
      ],
    },
  };
  const before = JSON.stringify(entry);
  const saved = compactEntry(entry, 4096);
  assert.equal(saved, 0, 'nothing over the floor');
  assert.equal(JSON.stringify(entry), before, 'byte-exact: thinking/text/tool_use never touched');
});

test('compactTranscriptLines keeps EVERY line and preserves the recent window byte-exact', () => {
  const lines = [];
  for (let i = 0; i < 100; i += 1) lines.push(JSON.stringify(bigToolEntry(i, 50000)));
  const { lines: out, changedEntries, beforeBytes, afterBytes, total } = compactTranscriptLines(lines, { keepRecent: 20, byteFloor: 4096 });
  assert.equal(out.length, lines.length, 'no line dropped -> uuid chain intact');
  assert.equal(total, 100);
  // Recent 20 untouched (byte-exact).
  for (let i = 80; i < 100; i += 1) assert.equal(out[i], lines[i], `recent line ${i} byte-exact`);
  // Older 80 elided.
  assert.equal(changedEntries, 80);
  assert.ok(afterBytes < beforeBytes / 2, `large reclaim: ${beforeBytes} -> ${afterBytes}`);
  // Chain still parses and links.
  const first = JSON.parse(out[1]);
  assert.equal(first.parentUuid, 'u0');
  assert.match(JSON.stringify(first.toolUseResult), /transcript-compactor/);
});

test('compactTranscriptLines never drops unparseable lines', () => {
  const lines = ['{not json', JSON.stringify(bigToolEntry(1, 50000)), '   ', 'also bad'];
  const { lines: out } = compactTranscriptLines(lines, { keepRecent: 0, byteFloor: 4096 });
  assert.equal(out.length, 4);
  assert.equal(out[0], '{not json', 'malformed line preserved verbatim');
  assert.equal(out[3], 'also bad');
});

test('compactTranscriptFile is a no-op under the high-water mark', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-tc-'));
  try {
    const f = path.join(dir, 't.jsonl');
    fs.writeFileSync(f, JSON.stringify(bigToolEntry(0, 1000)) + '\n');
    const before = fs.readFileSync(f, 'utf8');
    const r = compactTranscriptFile(f, { highWaterBytes: 10 * 1024 * 1024 });
    assert.equal(r.changedEntries, 0);
    assert.equal(r.reason, 'under_high_water');
    assert.equal(fs.readFileSync(f, 'utf8'), before, 'file untouched under high-water');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('compactTranscriptFile atomically shrinks an over-limit transcript and keeps it valid jsonl', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-tc-'));
  try {
    const f = path.join(dir, 't.jsonl');
    const lines = [];
    for (let i = 0; i < 200; i += 1) lines.push(JSON.stringify(bigToolEntry(i, 60000)));
    fs.writeFileSync(f, lines.join('\n') + '\n');
    const beforeSize = fs.statSync(f).size;
    const r = compactTranscriptFile(f, { highWaterBytes: 1024, keepRecent: 40, byteFloor: 4096 });
    assert.equal(r.ok, true);
    assert.equal(r.reason, 'compacted');
    assert.ok(r.changedEntries >= 160);
    const afterSize = fs.statSync(f).size;
    assert.ok(afterSize < beforeSize / 2, `shrunk ${beforeSize} -> ${afterSize}`);
    // Every line still present and parseable; trailing newline preserved.
    const body = fs.readFileSync(f, 'utf8');
    assert.equal(body.endsWith('\n'), true);
    const out = body.split('\n').filter(Boolean);
    assert.equal(out.length, 200, 'no entry dropped');
    for (const l of out) JSON.parse(l); // throws if any line is invalid json
    // Recent window byte-exact (last 40 keep full payload).
    const last = JSON.parse(out[199]);
    assert.equal(last.toolUseResult.stdout.length, 60000, 'recent payload intact');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('maybeCompactTranscriptFile honors the opt-out flag and high-water override', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-tc-'));
  try {
    const f = path.join(dir, 't.jsonl');
    const lines = [];
    for (let i = 0; i < 120; i += 1) lines.push(JSON.stringify(bigToolEntry(i, 60000)));
    fs.writeFileSync(f, lines.join('\n') + '\n');
    const before = fs.readFileSync(f, 'utf8');

    // Disabled -> no-op.
    const off = maybeCompactTranscriptFile({ transcriptPath: f, env: { HME_TRANSCRIPT_COMPACT: '0' } });
    assert.equal(off.reason, 'disabled');
    assert.equal(fs.readFileSync(f, 'utf8'), before, 'disabled flag leaves file untouched');

    // No path -> safe no-op.
    assert.equal(maybeCompactTranscriptFile({ transcriptPath: '', env: {} }).reason, 'no_path');

    // High-water override (1MB) -> compacts the ~7MB fixture.
    const on = maybeCompactTranscriptFile({ transcriptPath: f, env: { HME_TRANSCRIPT_COMPACT_HIGH_WATER_MB: '1' } });
    assert.equal(on.ok, true);
    assert.ok(on.changedEntries > 0);
    assert.ok(fs.statSync(f).size < Buffer.byteLength(before, 'utf8'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('escalation tier drives a recent-heavy transcript under the hard limit', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-tc-'));
  try {
    const f = path.join(dir, 't.jsonl');
    const lines = [];
    for (let i = 0; i < 30; i += 1) lines.push(JSON.stringify(bigToolEntry(i, 40000)));
    fs.writeFileSync(f, lines.join('\n') + '\n');
    // keepRecent default (80) would treat all 30 as "recent" and elide nothing,
    // leaving the file over the hard limit -> escalation must engage.
    const r = compactTranscriptFile(f, { highWaterBytes: 1024, hardLimitBytes: 600000 });
    assert.equal(r.ok, true);
    assert.ok(r.tier > 0, `escalation must engage, got tier ${r.tier}`);
    assert.ok(r.afterBytes <= 600000, `must drive under hard limit, got ${r.afterBytes}`);
    const out = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean);
    assert.equal(out.length, 30, 'no entry dropped even at deepest tier');
    for (const l of out) JSON.parse(l);
    // The most-recent entries stay byte-exact even when escalation is deep.
    assert.equal(JSON.parse(out[29]).toolUseResult.stdout.length, 40000, 'newest turn preserved');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('midturn trigger only fires in the emergency band, stop uses the gentler high-water', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-tc-'));
  try {
    const f = path.join(dir, 't.jsonl');
    const lines = [];
    // >keepRecent(80) entries so there are OLD entries beyond the recent window.
    for (let i = 0; i < 200; i += 1) lines.push(JSON.stringify(bigToolEntry(i, 40000)));
    fs.writeFileSync(f, lines.join('\n') + '\n'); // ~16MB
    const sizeMb = fs.statSync(f).size / 1048576;
    assert.ok(sizeMb > 1 && sizeMb < 24, 'fixture sits below both default thresholds');

    // Default thresholds: stop high-water 24MB and midturn 28MB -> both no-op here.
    assert.equal(maybeCompactTranscriptFile({ transcriptPath: f, env: {}, trigger: 'stop' }).changedEntries, 0);
    assert.equal(maybeCompactTranscriptFile({ transcriptPath: f, env: {}, trigger: 'midturn' }).changedEntries, 0);

    // Midturn override below the fixture size -> midturn fires; stop (24MB) still no-op.
    assert.equal(maybeCompactTranscriptFile({ transcriptPath: f, env: { HME_TRANSCRIPT_COMPACT_MIDTURN_MB: '1' }, trigger: 'stop' }).changedEntries, 0);
    const fired = maybeCompactTranscriptFile({ transcriptPath: f, env: { HME_TRANSCRIPT_COMPACT_MIDTURN_MB: '1' }, trigger: 'midturn' });
    assert.ok(fired.changedEntries > 0, 'midturn fires once over its emergency threshold');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('maybeCompactTranscriptFile emits a transcript_compaction telemetry event', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-tc-'));
  try {
    const f = path.join(dir, 't.jsonl');
    const lines = [];
    for (let i = 0; i < 80; i += 1) lines.push(JSON.stringify(bigToolEntry(i, 40000)));
    fs.writeFileSync(f, lines.join('\n') + '\n');
    const events = [];
    const r = maybeCompactTranscriptFile({
      transcriptPath: f,
      env: { HME_TRANSCRIPT_COMPACT_HIGH_WATER_MB: '1' },
      emit: (e) => events.push(e),
      trigger: 'stop',
    });
    assert.ok(r.changedEntries > 0);
    assert.equal(events.length, 1);
    assert.equal(events[0].event, 'transcript_compaction');
    assert.equal(events[0].trigger, 'stop');
    assert.ok(events[0].changed_entries > 0);
    assert.ok(events[0].before_mb >= events[0].after_mb);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
