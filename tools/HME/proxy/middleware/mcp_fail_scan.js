'use strict';
// Scan mcp__HME__ tool outputs for FAIL/FAILED markers and escalate to
// log/hme-errors.log so stop.sh's NEXUS lifesaver check blocks until fixed.
// Replaces the FAIL-scan block in log-tool-call.sh.

const fs = require('fs');
const path = require('path');

const ERR_LOG = 'log/hme-errors.log';
const FAIL_RE = /\bFAIL(ED)?\b/;
const FAIL_SKIP_RE = /PASS|fail-fast|fail to|may fail|might fail|could fail/i;

function _resultText(toolResult) {
  const c = toolResult.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.filter((x) => x && x.type === 'text').map((x) => x.text || '').join('');
  return '';
}

module.exports = {
  name: 'mcp_fail_scan',

  onToolResult({ toolUse, toolResult, ctx }) {
    const name = toolUse.name || '';
    if (!name.startsWith('mcp__HME__')) return;
    const text = _resultText(toolResult);
    if (!text) return;
    const fails = text
      .split('\n')
      .filter((l) => FAIL_RE.test(l) && !FAIL_SKIP_RE.test(l))
      .slice(0, 20);
    if (fails.length === 0) return;

    const errLogPath = path.join(ctx.PROJECT_ROOT, ERR_LOG);
    try { fs.mkdirSync(path.dirname(errLogPath), { recursive: true }); } catch (_e) {}
    const ts = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    const body = fails.map((l) => `[${ts}] ${name}: ${l}`).join('\n') + '\n';
    try {
      fs.appendFileSync(errLogPath, body);
      console.warn(`[middleware] mcp_fail_scan: escalated ${fails.length} FAIL line(s) from ${name}`);
    } catch (err) {
      ctx.warn(`mcp_fail_scan write failed: ${err.message}`);
    }
  },
};
