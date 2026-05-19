'use strict';

const { spawnSync } = require('child_process');
const path = require('path');
const { PROJECT_ROOT } = require('./shared');

const SOURCE_ROOT = path.resolve(__dirname, '..', '..', '..');

let cachedSchemas = null;
let cachedMeta = null;
let cachedMetaByName = null;
let cachedRequiredByName = null;

function runExporter(kind) {
  const script = path.join(SOURCE_ROOT, 'tools', 'HME', 'hme_tools', 'export.py');
  const result = spawnSync('python3', [script, '--kind', kind], {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    timeout: 30000,
    env: { ...process.env, PROJECT_ROOT, HME_SOURCE_ROOT: SOURCE_ROOT },
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

function canonicalToolMetadataByName() {
  if (!cachedMetaByName) cachedMetaByName = Object.fromEntries(canonicalToolMetadata().map((tool) => [tool.name, tool]));
  return JSON.parse(JSON.stringify(cachedMetaByName));
}

function canonicalRequiredFieldsByName() {
  if (!cachedRequiredByName) {
    cachedRequiredByName = Object.fromEntries(canonicalToolMetadata().map((tool) => [tool.name, (tool.parameters && tool.parameters.required) || []]));
  }
  return JSON.parse(JSON.stringify(cachedRequiredByName));
}

function canonicalToolNames() {
  return new Set(canonicalToolSchemas().map((tool) => tool.name));
}

function toolMetadata(name) {
  return canonicalToolMetadataByName()[name] || null;
}

function requiredFields(name) {
  return canonicalRequiredFieldsByName()[name] || [];
}

function inputAliases(name) {
  const meta = toolMetadata(name);
  return meta && meta.hme && meta.hme.input_aliases && typeof meta.hme.input_aliases === 'object' ? meta.hme.input_aliases : {};
}

function missingRequiredFields(name, args = {}) {
  const aliases = inputAliases(name);
  return requiredFields(name).filter((field) => {
    const keys = [field, ...((aliases[field] || []))];
    return !keys.some((key) => Object.prototype.hasOwnProperty.call(args, key) && args[key] != null && String(args[key]).length > 0);
  });
}

module.exports = { canonicalToolSchemas, canonicalToolMetadata, canonicalToolMetadataByName, canonicalRequiredFieldsByName, canonicalToolNames, toolMetadata, requiredFields, inputAliases, missingRequiredFields };
