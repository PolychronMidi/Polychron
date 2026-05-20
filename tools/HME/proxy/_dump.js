'use strict';
const { requireEnv: _hmeRequireEnv } = require('./shared/load_env.js');
// Payload dump util. Called from middleware/24_dump_system.js (post-pipeline)
// and from hme_proxy.js (pre-pipeline). Off by default; HME_DUMP_SYSTEM_PROMPT=1
// in .env enables both writes -- the pre/post pair lets the operator diff
// what HME mutated.

const fs = require('fs');
const path = require('path');

const ENABLED = (_hmeRequireEnv('HME_DUMP_SYSTEM_PROMPT')) === '1';

function _formatSystem(system) {
  if (typeof system === 'string') return system;
  if (Array.isArray(system)) {
    return system
      .map((b, i) => {
        const body = typeof b === 'string' ? b : (b && b.text) || '';
        const cc = b && b.cache_control ? ` cache_control=${JSON.stringify(b.cache_control)}` : '';
        return `--- BLOCK ${i}${cc} ---\n${body}`;
      })
      .join('\n');
  }
  return `(unrecognized payload.system shape: ${typeof system})\n` + JSON.stringify(system, null, 2);
}

function _trimmedPayload(payload) {
  const trimmed = { ...payload };
  if (Array.isArray(trimmed.messages)) {
    trimmed._messages_count = trimmed.messages.length;
    trimmed._messages_sample = trimmed.messages.slice(0, 2);
    delete trimmed.messages;
  }
  return trimmed;
}

function writeDump(payload, projectRoot, suffix, warn) {
  if (!ENABLED) return;
  if (!payload) return;
  const tag = suffix ? `-${suffix}` : '';
  try { fs.mkdirSync(path.join(projectRoot, 'tmp'), { recursive: true }); } catch (_e) { /* ignore */ }
  if (payload.system != null) {
    const sysOut = path.join(projectRoot, 'tmp', `claude-system-prompt${tag}.txt`);
    try { fs.writeFileSync(sysOut, _formatSystem(payload.system)); }
    catch (err) { warn && warn(`dump_system: system write failed: ${err.message}`); }
  }
  const fullOut = path.join(projectRoot, 'tmp', `claude-full-payload${tag}.json`);
  try { fs.writeFileSync(fullOut, JSON.stringify(_trimmedPayload(payload), null, 2)); }
  catch (err) { warn && warn(`dump_system: full-payload write failed: ${err.message}`); }
}

module.exports = { writeDump, ENABLED };
