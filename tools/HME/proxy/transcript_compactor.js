'use strict';

// On-disk transcript compactor. Claude Code maintains an append-only .jsonl
// transcript that the proxy never touches; it grows unbounded and Claude Code

const fs = require('fs');
const path = require('path');

// Real Claude Code constants (binary 2.1.159): the transcript read path errors
// at kO4=31457280 (30MB); the load-as-JSON ceiling is 268435456 (256MB). We
// start compacting at 24MB (highWater) and treat 30MB as the hard limit the
const HARD_LIMIT_BYTES = 31457280;

const DEFAULTS = {
  // Don't touch the most recent N entries: current working context stays byte
  // exact so the active task is never degraded.
  keepRecent: 80,
  // Only elide a value whose serialized size exceeds this floor; small results
  // (decisions, short outputs) are left alone.
  byteFloor: 4096,
  // File-level no-op guard: leave files under this size completely untouched.
  highWaterBytes: 24 * 1024 * 1024,
  // Ceiling the escalation tiers must drive the file under (30MB).
  hardLimitBytes: HARD_LIMIT_BYTES,
};

// Progressive elision tiers. Each shrinks the recent-keep window and byte floor
// so that even a transcript whose RECENT turns alone exceed the hard limit
const ESCALATION_TIERS = [
  { keepRecent: 40, byteFloor: 2048 },
  { keepRecent: 16, byteFloor: 1024 },
  { keepRecent: 4, byteFloor: 256 },
];
const EMERGENCY_TIERS = [
  { keepRecent: 80, byteFloor: 2048 },
  { keepRecent: 80, byteFloor: 1024 },
  { keepRecent: 80, byteFloor: 256 },
];

function _marker(originalBytes) {
  return `(content elided by hme-proxy transcript-compactor: original was ${originalBytes}B; full output remains in the wire history the model already consumed)`;
}

function _serializedBytes(value) {
  try { return Buffer.byteLength(JSON.stringify(value), 'utf8'); }
  catch (_e) { return 0; }
}

// Replace a heavy value with a compact marker, preserving the shape the reader
// expects: strings -> marker string; arrays of text blocks -> single marker
function _elideValue(value, originalBytes) {
  if (typeof value === 'string') return _marker(originalBytes);
  if (Array.isArray(value)) return [{ type: 'text', text: _marker(originalBytes) }];
  return { _hme_elided: true, original_bytes: originalBytes, note: _marker(originalBytes) };
}

function _elideToolResultContent(block, byteFloor) {
  if (!block || block.type !== 'tool_result') return false;
  const size = _serializedBytes(block.content);
  if (size <= byteFloor) return false;
  block.content = _elideValue(block.content, size);
  return true;
}

// Compact a single parsed transcript entry in place. Returns bytes reclaimed.
function compactEntry(entry, byteFloor) {
  if (!entry || typeof entry !== 'object') return 0;
  let saved = 0;

  // Top-level toolUseResult: the raw duplicate of the tool output. The
  // model-visible copy lives in message.content[].tool_result, so eliding this
  if (Object.prototype.hasOwnProperty.call(entry, 'toolUseResult')) {
    const size = _serializedBytes(entry.toolUseResult);
    if (size > byteFloor) {
      entry.toolUseResult = _elideValue(entry.toolUseResult, size);
      saved += size;
    }
  }

  // Top-level attachment(s): captured file snapshots, often whole-file dumps.
  for (const key of ['attachment', 'attachments']) {
    if (!Object.prototype.hasOwnProperty.call(entry, key)) continue;
    const size = _serializedBytes(entry[key]);
    if (size > byteFloor) {
      entry[key] = _elideValue(entry[key], size);
      saved += size;
    }
  }

  // Old large tool_result blocks inside the message content.
  const content = entry.message && entry.message.content;
  if (Array.isArray(content)) {
    for (const block of content) {
      if (_elideToolResultContent(block, byteFloor)) saved += 1;
    }
  }
  return saved;
}

// Compact an array of raw .jsonl line strings. Never drops a line: unparseable
// lines and recent-window lines pass through byte-exact. Returns the new line
function compactTranscriptLines(rawLines, opts = {}) {
  const keepRecent = Number.isFinite(opts.keepRecent) ? opts.keepRecent : DEFAULTS.keepRecent;
  const byteFloor = Number.isFinite(opts.byteFloor) ? opts.byteFloor : DEFAULTS.byteFloor;
  const lines = rawLines.filter((l) => l !== undefined && l !== null);
  const total = lines.length;
  const cutoff = Math.max(0, total - keepRecent);
  let changedEntries = 0;
  const out = new Array(total);

  for (let i = 0; i < total; i += 1) {
    const line = lines[i];
    // Recent window and blank lines: pass through untouched.
    if (i >= cutoff || !line.trim()) {
      out[i] = line;
      continue;
    }
    let entry;
    try { entry = JSON.parse(line); }
    catch (_e) { out[i] = line; continue; }
    const saved = compactEntry(entry, byteFloor);
    if (saved > 0) {
      out[i] = JSON.stringify(entry);
      changedEntries += 1;
    } else {
      out[i] = line;
    }
  }
  return {
    lines: out,
    beforeBytes: Buffer.byteLength(lines.join('\n'), 'utf8'),
    afterBytes: Buffer.byteLength(out.join('\n'), 'utf8'),
    changedEntries,
    total,
    keepRecent,
    byteFloor,
  };
}

// File-level atomic compaction. No-op (returns changed:0) when the file is
// under highWaterBytes. Re-checks size+mtime immediately before the rename so a
function compactTranscriptFile(filePath, opts = {}) {
  const highWater = Number.isFinite(opts.highWaterBytes) ? opts.highWaterBytes : DEFAULTS.highWaterBytes;
  let stat;
  try { stat = fs.statSync(filePath); }
  catch (_e) { return { ok: false, reason: 'missing', changedEntries: 0 }; }
  if (stat.size < highWater) {
    return { ok: true, reason: 'under_high_water', changedEntries: 0, beforeBytes: stat.size, afterBytes: stat.size };
  }
  let raw;
  try { raw = fs.readFileSync(filePath, 'utf8'); }
  catch (_e) { return { ok: false, reason: 'unreadable', changedEntries: 0 }; }
  const hardLimitBytes = Number.isFinite(opts.hardLimitBytes) ? opts.hardLimitBytes : DEFAULTS.hardLimitBytes;
  const hadTrailingNewline = raw.endsWith('\n');
  const rawLines = raw.split('\n');
  if (hadTrailingNewline) rawLines.pop();
  // Baseline pass preserves the caller's recent window. If OLD entries can still
  // shrink enough at lower byte floors, exhaust those floors before ever shrinking
  // recent context. Shrink the recent window ONLY when the preserved recent window
  let result = compactTranscriptLines(rawLines, opts);
  let tier = 0;
  const baseKeep = Number.isFinite(opts.keepRecent) ? opts.keepRecent : DEFAULTS.keepRecent;
  for (const emergency of EMERGENCY_TIERS) {
    if (result.afterBytes <= hardLimitBytes) break;
    result = compactTranscriptLines(rawLines, { ...emergency, keepRecent: baseKeep });
  }
  while (result.afterBytes > hardLimitBytes && tier < ESCALATION_TIERS.length) {
    const nextTier = ESCALATION_TIERS[tier];
    const currentKeep = result.keepRecent;
    const nextKeep = Number.isFinite(nextTier.keepRecent) ? nextTier.keepRecent : currentKeep;
    if (nextKeep < currentKeep) {
      const recentStart = Math.max(0, rawLines.length - currentKeep);
      const recentBytes = Buffer.byteLength(rawLines.slice(recentStart).join('\n'), 'utf8');
      if (recentBytes <= hardLimitBytes) {
        return { ok: false, reason: 'hard_limit_requires_old_line_emergency', changedEntries: 0, beforeBytes: result.beforeBytes, afterBytes: result.afterBytes, tier, underHardLimit: false };
      }
    }
    result = compactTranscriptLines(rawLines, nextTier);
    tier += 1;
  }
  if (result.changedEntries === 0) {
    return { ok: true, reason: 'nothing_to_elide', changedEntries: 0, beforeBytes: result.beforeBytes, afterBytes: result.afterBytes, tier };
  }
  // Abort if Claude Code appended/changed the file while we were compacting:
  // never clobber a concurrent write.
  let recheck;
  try { recheck = fs.statSync(filePath); }
  catch (_e) { return { ok: false, reason: 'vanished', changedEntries: 0 }; }
  if (recheck.size !== stat.size || recheck.mtimeMs !== stat.mtimeMs) {
    return { ok: false, reason: 'concurrent_write', changedEntries: 0 };
  }
  const body = result.lines.join('\n') + (hadTrailingNewline ? '\n' : '');
  const tmp = path.join(path.dirname(filePath), `.hme-transcript-compact-${process.pid}-${path.basename(filePath)}.tmp`);
  try {
    // Mesh-found P1 (transcript-compactor review): crash-DURABLE write. fsync the
    // temp file before the rename so a crash/power-loss can't leave a 0-length or
    const fd = fs.openSync(tmp, 'w');
    try {
      fs.writeSync(fd, body);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    // Final guard: only rename if the original still matches our snapshot.
    const finalCheck = fs.statSync(filePath);
    if (finalCheck.size !== stat.size || finalCheck.mtimeMs !== stat.mtimeMs) {
      try { fs.unlinkSync(tmp); } catch (_e) { /* best-effort */ }
      return { ok: false, reason: 'concurrent_write', changedEntries: 0 };
    }
    fs.renameSync(tmp, filePath);
    let dfd;
    try { dfd = fs.openSync(path.dirname(filePath), 'r'); fs.fsyncSync(dfd); }
    catch (_e) { /* silent-ok: dir fsync best-effort; data fsync already done */ }
    finally { if (dfd !== undefined) fs.closeSync(dfd); }
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch (_e) { /* best-effort */ }
    return { ok: false, reason: `write_failed:${err.message}`, changedEntries: 0 };
  }
  return {
    ok: true,
    reason: 'compacted',
    changedEntries: result.changedEntries,
    beforeBytes: result.beforeBytes,
    afterBytes: Buffer.byteLength(body, 'utf8'),
    tier,
    underHardLimit: Buffer.byteLength(body, 'utf8') <= hardLimitBytes,
  };
}

// Orchestration entry for the Stop-hook lane. Reads the opt-out flag and the
// high-water override from env, then runs the guarded atomic compaction. Pure
// best-effort: any failure returns a reason and never throws.
function maybeCompactTranscriptFile({ transcriptPath, env = process.env, log, emit, trigger = 'stop' } = {}) {
  if (env.HME_TRANSCRIPT_COMPACT === '0') return { ok: true, reason: 'disabled', changedEntries: 0 };
  if (!transcriptPath || typeof transcriptPath !== 'string') return { ok: false, reason: 'no_path', changedEntries: 0 };
  // Mid-turn (PostToolUse) is NOT a quiescent point -- Claude may append the
  // next entry imminently -- so it only fires in the genuine emergency band
  let highWaterBytes;
  if (trigger === 'midturn') {
    const emb = Number(env.HME_TRANSCRIPT_COMPACT_MIDTURN_MB);
    highWaterBytes = Number.isFinite(emb) && emb > 0 ? Math.floor(emb * 1024 * 1024) : 28 * 1024 * 1024;
  } else {
    const mb = Number(env.HME_TRANSCRIPT_COMPACT_HIGH_WATER_MB);
    highWaterBytes = Number.isFinite(mb) && mb > 0 ? Math.floor(mb * 1024 * 1024) : DEFAULTS.highWaterBytes;
  }
  let result;
  try {
    result = compactTranscriptFile(transcriptPath, { highWaterBytes });
  } catch (err) {
    // silent-ok: failure is recorded in result.reason and surfaced via the transcript_co
    result = { ok: false, reason: `threw:${err && err.message}`, changedEntries: 0 };
  }
  if (result.changedEntries > 0) {
    const before = Math.round((result.beforeBytes || 0) / 1048576);
    const after = Math.round((result.afterBytes || 0) / 1048576);
    if (typeof log === 'function') {
      log(`[hme] transcript-compactor (${trigger}): ${result.changedEntries} entr(ies) elided, ${before}MB -> ${after}MB tier=${result.tier || 0} (${transcriptPath})`);
    }
    if (typeof emit === 'function') {
      try {
        emit({ event: 'transcript_compaction', trigger, changed_entries: result.changedEntries, before_mb: before, after_mb: after, tier: result.tier || 0 });
      } catch (_e) { /* silent-ok: telemetry must never break the hook path */ }
    }
  }
  return result;
}

module.exports = {
  DEFAULTS,
  compactEntry,
  compactTranscriptLines,
  compactTranscriptFile,
  maybeCompactTranscriptFile,
  _marker,
};
