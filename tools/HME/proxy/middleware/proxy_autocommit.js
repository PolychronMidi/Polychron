'use strict';
// proxy_autocommit.js -- request-driven autocommit middleware.
//
// Runs on every Anthropic API request that reaches the proxy. Checks git
// status; if dirty, commits with a timestamp message. Failures route to
// hme-errors.log so lifesaver_inject surfaces them on the next request.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ERR_LOG = 'log/hme-errors.log';

function _appendErr(root, msg) {
  try {
    const ts = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    fs.appendFileSync(path.join(root, ERR_LOG), `[${ts}] [autocommit:proxy] ${msg}\n`);
  } catch (_e) { /* best-effort */ }
}

module.exports = {
  name: 'proxy_autocommit',

  onRequest({ payload, ctx }) {
    if (!payload || !Array.isArray(payload.messages)) return;
    const root = ctx.PROJECT_ROOT;
    if (!root) return;

    let dirty = '';
    try {
      dirty = execSync('git status --porcelain', { cwd: root, encoding: 'utf8', timeout: 3000 });
    } catch (err) {
      _appendErr(root, `git status failed: ${err.message.slice(0, 200)}`);
      return;
    }
    if (!dirty.trim()) return;

    const ts = new Date().toISOString().slice(0, 19);
    try {
      execSync('git add -A', { cwd: root, timeout: 5000 });
    } catch (err) {
      _appendErr(root, `git add failed: ${err.message.slice(0, 200)}`);
      return;
    }
    try {
      execSync(`git commit -m "${ts}" --quiet`, { cwd: root, timeout: 5000 });
    } catch (err) {
      const msg = (err.stderr ? err.stderr.toString() : '') + (err.stdout ? err.stdout.toString() : '');
      if (msg.includes('nothing to commit')) return;
      _appendErr(root, `git commit failed: ${(msg || err.message).slice(0, 300)}`);
    }
  },
};
