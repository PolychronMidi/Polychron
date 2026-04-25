'use strict';
/**
 * Pure-JS port of nexus_edit_check.sh — early-firing EDIT-count gate.
 * Reads tmp/hme-nexus.state, prunes EDIT entries whose files match HEAD
 * (net-zero edits), and emits a `deny` if any unreviewed edits remain.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { PROJECT_ROOT } = require('../../shared');

const NEXUS_FILE = path.join(PROJECT_ROOT, 'tmp', 'hme-nexus.state');
const MCP_PORT = process.env.HME_MCP_PORT || '9098';

function readState() {
  try { return fs.readFileSync(NEXUS_FILE, 'utf8'); }
  catch (_e) { return ''; }
}

function writeState(text) {
  try { fs.writeFileSync(NEXUS_FILE, text); }
  catch (_e) { /* best-effort */ }
}

function pruneCleanEdits() {
  const gitDir = path.join(PROJECT_ROOT, '.git');
  if (!fs.existsSync(gitDir)) return;
  const lines = readState().split('\n');
  const kept = [];
  for (const line of lines) {
    if (!line) continue;
    if (line.startsWith('EDIT:')) {
      const parts = line.split(':');
      // Format: EDIT:TIMESTAMP:PAYLOAD where PAYLOAD may contain colons.
      const filepath = parts.slice(2).join(':');
      if (filepath && fs.existsSync(filepath)) {
        try {
          execFileSync('git', ['-C', PROJECT_ROOT, 'diff', '--quiet', 'HEAD', '--', filepath]);
          // exit 0 → no diff against HEAD → drop the entry.
          continue;
        } catch (_e) {
          // exit !=0 → diff present, keep the entry. Fall through.
        }
      }
    }
    kept.push(line);
  }
  writeState(kept.join('\n'));
}

function countEdits() {
  return readState()
    .split('\n')
    .filter((l) => l.startsWith('EDIT:'))
    .length;
}

async function fetchKbHints(timeoutMs = 10_000) {
  if (typeof fetch !== 'function') return '';
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(`http://127.0.0.1:${MCP_PORT}/audit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ changed_files: '' }),
      signal: ac.signal,
    });
    if (!res.ok) return '';
    const data = await res.json();
    const violations = (data && data.violations) || [];
    if (!violations.length) return '';
    const lines = ['', '', 'KB hits for changed modules (review these in context):'];
    for (const v of violations.slice(0, 5)) {
      lines.push(`  - ${v.file || '?'}: ${v.title || v.message || ''}`);
    }
    return lines.join('\n');
  } catch (_e) {
    return '';
  } finally {
    clearTimeout(t);
  }
}

module.exports = {
  name: 'nexus_edit_check',
  async run(ctx) {
    pruneCleanEdits();
    const editCount = countEdits();
    if (editCount === 0) return ctx.allow();
    const hints = await fetchKbHints();
    return ctx.deny(
      `NEXUS — ${editCount} unreviewed edit(s). Run \`i/review mode=forget\` before stopping.${hints}`
    );
  },
};
