'use strict';

const { spawnSync } = require('child_process');
const path = require('path');
const { PROJECT_ROOT } = require('./shared');

let cachedSchemas = null;
let cachedMeta = null;

function runExporter(kind) {
  const script = path.join(PROJECT_ROOT, 'tools', 'HME', 'hme_tools', 'export.py');
  const result = spawnSync('python3', [script, '--kind', kind], {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    timeout: 30000,
    env: { ...process.env, PROJECT_ROOT },
  });
  if (result.status !== 0) {
    const msg = `${result.stderr || result.stdout || result.error && result.error.message || 'unknown exporter failure'}`.trim();
    throw new Error(`HME smolagents tool export failed (${kind}): ${msg}`);
  }
  return JSON.parse(result.stdout || '[]');
}

function canonicalToolSchemas() {
  if (!cachedSchemas) cachedSchemas = runExporter('codex');
  return JSON.parse(JSON.stringify(cachedSchemas));
}

function canonicalToolMetadata() {
  if (!cachedMeta) cachedMeta = runExporter('hme');
  return JSON.parse(JSON.stringify(cachedMeta));
}

function canonicalToolNames() {
  return new Set(canonicalToolSchemas().map((tool) => tool.name));
}

module.exports = { canonicalToolSchemas, canonicalToolMetadata, canonicalToolNames };
