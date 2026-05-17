'use strict';

const fs = require('fs');
const path = require('path');
const { PROJECT_ROOT } = require('./hme_paths');

const DEFAULT_ADAPTER = Object.freeze({
  project_id: 'generic',
  project_name: 'Generic project',
  domain: 'software',
  source_roots: ['src'],
  project_docs: ['doc/composition.md'],
  primary_doc: 'doc/composition.md',
  pipeline: { main: 'npm test' },
  artifacts: { metrics_dir: 'src/output/metrics' },
  optional_artifacts: [],
  capabilities: {},
  health: {},
});

function adapterPath(root = PROJECT_ROOT) {
  return process.env.HME_PROJECT_ADAPTER || path.join(root, 'config', 'project-adapter.json');
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (_err) { return null; }
}

function mergeAdapter(raw) {
  const cfg = { ...DEFAULT_ADAPTER, ...(raw || {}) };
  cfg.source_roots = Array.isArray(cfg.source_roots) ? cfg.source_roots : ['src'];
  cfg.project_docs = Array.isArray(cfg.project_docs) ? cfg.project_docs : [cfg.primary_doc];
  cfg.pipeline = cfg.pipeline && typeof cfg.pipeline === 'object' ? cfg.pipeline : {};
  cfg.artifacts = cfg.artifacts && typeof cfg.artifacts === 'object' ? cfg.artifacts : {};
  cfg.optional_artifacts = Array.isArray(cfg.optional_artifacts) ? cfg.optional_artifacts : [];
  cfg.capabilities = cfg.capabilities && typeof cfg.capabilities === 'object' ? cfg.capabilities : {};
  cfg.health = cfg.health && typeof cfg.health === 'object' ? cfg.health : {};
  return cfg;
}

function loadAdapter(root = PROJECT_ROOT) {
  return mergeAdapter(readJson(adapterPath(root)));
}

function resolvePath(root, relPath) {
  const rel = String(relPath || '');
  const abs = path.resolve(root, rel);
  const back = path.relative(path.resolve(root), abs);
  if (back.startsWith('..') || path.isAbsolute(back)) {
    throw new Error(`adapter path escapes project root: ${rel}`);
  }
  return abs;
}

function artifactPath(name, root = PROJECT_ROOT, adapter = loadAdapter(root)) {
  const rel = adapter.artifacts && adapter.artifacts[name];
  return rel ? resolvePath(root, rel) : '';
}

function sourceRoots(root = PROJECT_ROOT, adapter = loadAdapter(root)) {
  return adapter.source_roots.map((p) => resolvePath(root, p));
}

function projectDocs(root = PROJECT_ROOT, adapter = loadAdapter(root)) {
  return adapter.project_docs.map((p) => resolvePath(root, p));
}

function hasCapability(name, adapter) {
  return Boolean((adapter || loadAdapter()).capabilities[name]);
}

module.exports = {
  DEFAULT_ADAPTER,
  adapterPath,
  loadAdapter,
  resolvePath,
  artifactPath,
  sourceRoots,
  projectDocs,
  hasCapability,
};
