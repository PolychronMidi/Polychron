#!/usr/bin/env node
const { requireEnv: _hmeRequireEnv } = require('../proxy/shared/load_env.js');
'use strict';

const fs = require('fs');
const path = require('path');
const adapterLib = require('../proxy/project_adapter');

function check(results, name, ok, detail = '') {
  results.push({ name, ok, detail });
}

function underPath(child, parent) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function main() {
  const args = process.argv.slice(2);
  const rootArg = args.find((a) => a.startsWith('--root='));
  const root = path.resolve(rootArg ? rootArg.slice('--root='.length) : _hmeRequireEnv('PROJECT_ROOT'));
  const json = args.includes('--json');
  const results = [];
  let adapter;
  try {
    adapter = adapterLib.loadAdapter(root);
    check(results, 'adapter.load', true, adapter.project_id);
  } catch (err) {
    check(results, 'adapter.load', false, err.message);
    adapter = adapterLib.DEFAULT_ADAPTER;
  }
  check(results, 'project_id', /^[a-z0-9_.-]+$/.test(String(adapter.project_id || '')), String(adapter.project_id || ''));
  const sourceDirs = [];
  for (const rel of adapter.source_roots || []) {
    const abs = adapterLib.resolvePath(root, rel);
    sourceDirs.push(abs);
    check(results, `source:${rel}`, fs.existsSync(abs) && fs.statSync(abs).isDirectory(), abs);
  }
  const docs = adapter.project_docs || [adapter.primary_doc || 'doc/composition.md'];
  for (const rel of docs) {
    const abs = adapterLib.resolvePath(root, rel);
    check(results, `project_doc:${rel}`, fs.existsSync(abs) && fs.statSync(abs).isFile(), abs);
  }
  const primary = adapterLib.resolvePath(root, adapter.primary_doc || 'doc/composition.md');
  check(results, 'primary_doc', fs.existsSync(primary) && fs.statSync(primary).isFile(), primary);
  const hmeRuntime = path.join(root, 'tools', 'HME', 'runtime');
  const runtimeOutside = sourceDirs.every((src) => !underPath(hmeRuntime, src));
  check(results, 'hme_runtime_outside_sources', runtimeOutside, hmeRuntime);
  check(results, 'pipeline.main', typeof (adapter.pipeline || {}).main === 'string' && adapter.pipeline.main.length > 0, (adapter.pipeline || {}).main || '');
  for (const [name, rel] of Object.entries(adapter.artifacts || {})) {
    try {
      const abs = adapterLib.resolvePath(root, rel);
      check(results, `artifact:${name}`, true, abs);
    } catch (err) {
      check(results, `artifact:${name}`, false, err.message);
    }
  }
  for (const rel of adapter.optional_artifacts || []) {
    try {
      check(results, `optional_artifact:${rel}`, true, adapterLib.resolvePath(root, rel));
    } catch (err) {
      check(results, `optional_artifact:${rel}`, false, err.message);
    }
  }
  const ok = results.every((r) => r.ok);
  if (json) {
    process.stdout.write(JSON.stringify({ ok, project_root: root, adapter, results }, null, 2) + '\n');
  } else {
    for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}\t${r.name}\t${r.detail}`);
  }
  process.exit(ok ? 0 : 1);
}

main();
