'use strict';

const path = require('path');
const proxyAutocommit = require('./middleware/21_proxy_autocommit');
const { readAutocommitFailure, touchLifesaverHeartbeat } = require('./lifesaver_alerts');

function appendInstructions(body, note) {
  const current = typeof body.instructions === 'string' ? body.instructions : '';
  return { ...body, instructions: current ? `${current}\n\n${note}` : note };
}

function runAutocommit({ host, projectRoot, record = () => {}, disabled = false }) {
  if (disabled || process.env[`HME_${String(host || '').toUpperCase()}_PROXY_AUTOCOMMIT`] === '0') return 'disabled';
  try {
    proxyAutocommit.onRequest({ payload: { messages: [{ role: 'user', content: '' }] }, ctx: { PROJECT_ROOT: projectRoot } });
    return 'ran';
  } catch (err) {
    record({ kind: 'autocommit-crash', host, message: err.message, stack: err.stack });
    return 'crashed';
  }
}

function injectLifesaver({ body, host, projectRoot }) {
  touchLifesaverHeartbeat(projectRoot);
  const failure = readAutocommitFailure(projectRoot);
  if (!failure) return { body, injected: false };
  return { body: appendInstructions(body, `[lifesaver inject from ${host || 'proxy'} proxy]\n${failure.banner}`), injected: true, flag: failure.flagPath };
}

function failFlagPath(projectRoot, name) { return path.join(projectRoot, 'tools', 'HME', 'runtime', name); }

module.exports = { appendInstructions, runAutocommit, injectLifesaver, failFlagPath };
