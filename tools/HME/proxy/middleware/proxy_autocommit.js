'use strict';
// proxy_autocommit.js - hook-independent autocommit.
//
// userpromptsubmit hook fires unreliably in VS Code Claude extension mode
// (multiple incidents documented). Autocommit is too important to depend
// on the hook -- the proxy is supervised and always running, so move
// autocommit logic INTO the proxy middleware and run it on every API
// request through the proxy.
//
// Side effect: this middleware is also a probe. If commits start landing
// after every Anthropic request, we know the user's traffic is routing
// through the proxy. If commits don't land while the user reports
// uncommitted work, the extension is bypassing the proxy and we have a
// different problem to solve.
//
// Failures append to hme-errors.log so lifesaver_inject surfaces them on
// the next request (one-cycle latency, but persistent visibility).

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

    // Quick check: anything to commit?
    let dirty = '';
    try {
      dirty = execSync('git status --porcelain', { cwd: root, encoding: 'utf8', timeout: 3000 });
    } catch (err) {
      _appendErr(root, `git status failed: ${err.message.slice(0, 200)}`);
      return;
    }
    if (!dirty.trim()) return;

    // Proof-of-life: one line to hme-proxy.out ONLY when there's work to
    // commit. Silent when tree is clean so this doesn't spam. If you see
    // dirty files but no trace here, the proxy isn't in the path.
    const dirtyCount = dirty.trim().split('\n').length;
    console.warn(`Acceptable warning: [middleware] proxy_autocommit: ${dirtyCount} dirty file(s), committing`);

    // Stage + commit. Timestamp message matches hook convention.
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
