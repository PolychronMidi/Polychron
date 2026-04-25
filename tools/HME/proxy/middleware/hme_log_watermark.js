'use strict';
// Daemon-thread error watermark — scans the tail of log/hme.log for new
// ERROR-level lines since the last tool call and appends them to
// log/hme-errors.log so stop.sh's lifesaver check picks them up.
// Replaces log-tool-call.sh's hme.log watermark block.
//
// Runs on every completed HME_ tool call (proxy normalizes mcp__HME__* → HME_*).

const fs = require('fs');
const path = require('path');

const HME_LOG = 'log/hme.log';
const ERR_LOG = 'log/hme-errors.log';
const WATERMARK = 'tmp/hme-log-errors.watermark';
// ,NNN ERROR anchor matches `2026-04-16 18:30:45,123 ERROR msg`.
const ERR_LINE_RE = /,\d{3}\s+ERROR\s/;

module.exports = {
  name: 'hme_log_watermark',

  onToolResult({ toolUse, ctx }) {
    const name = toolUse.name || '';
    if (!name.startsWith('HME_')) return;

    const hmeLogPath = path.join(ctx.PROJECT_ROOT, HME_LOG);
    const errLogPath = path.join(ctx.PROJECT_ROOT, ERR_LOG);
    const wmPath = path.join(ctx.PROJECT_ROOT, WATERMARK);

    let curSize = 0;
    try {
      curSize = fs.statSync(hmeLogPath).size;
    } catch (_e) { return; /* no log yet */ }

    let lastSize = -1;
    try {
      lastSize = parseInt(fs.readFileSync(wmPath, 'utf8').trim(), 10);
      if (!Number.isFinite(lastSize)) lastSize = -1;
    } catch (_e) { /* first run */ }

    // First run: seed the watermark at the current file end so we only
    // escalate errors that appear AFTER the middleware starts observing.
    // Without this, every fresh proxy boot re-escalates every historical
    // ERROR line in hme.log to hme-errors.log.
    if (lastSize < 0) {
      try { fs.mkdirSync(path.dirname(wmPath), { recursive: true }); } catch (_e) { /* best-effort */ }
      fs.writeFileSync(wmPath, String(curSize));
      return;
    }

    // Log rotation → reset watermark.
    if (curSize < lastSize) lastSize = 0;
    if (curSize <= lastSize) return;

    let fd;
    try {
      fd = fs.openSync(hmeLogPath, 'r');
      const bytesToRead = curSize - lastSize;
      const buf = Buffer.alloc(bytesToRead);
      fs.readSync(fd, buf, 0, bytesToRead, lastSize);
      const chunk = buf.toString('utf8');
      const newErrors = chunk.split('\n').filter((l) => ERR_LINE_RE.test(l)).slice(0, 20);
      // Peer-review iter 120: previously the watermark advanced even
      // when appendFileSync to errLog threw — so on a transient
      // permission-flap or full-disk, errors were silently dropped from
      // the LIFESAVER escalation channel forever. Now: append FIRST,
      // verify (re-throw on failure so the outer catch logs it), then
      // advance the watermark only after escalation actually landed.
      // Idempotent re-escalation on next run is preferable to silent
      // loss.
      if (newErrors.length > 0) {
        try { fs.mkdirSync(path.dirname(errLogPath), { recursive: true }); } catch (_e) { /* best-effort: silent-ok mkdir, the appendFileSync below will throw if errLog can't be created */ }
        const ts = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
        const body = newErrors.map((l) => `[${ts}] hme.log: ${l}`).join('\n') + '\n';
        fs.appendFileSync(errLogPath, body);  // throws on failure; outer catch surfaces
        console.warn(`[middleware] hme_log_watermark: escalated ${newErrors.length} ERROR line(s) to hme-errors.log`);
      }
      try { fs.mkdirSync(path.dirname(wmPath), { recursive: true }); } catch (_e) { /* silent-ok mkdir; writeFileSync below surfaces real failures */ }
      fs.writeFileSync(wmPath, String(curSize));  // advance only AFTER append succeeded
    } catch (err) {
      ctx.warn(`hme_log_watermark read failed: ${err.message}`);
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
  },
};
