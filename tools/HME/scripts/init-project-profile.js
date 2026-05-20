#!/usr/bin/env node
const { requireEnv: _hmeRequireEnv } = require('../proxy/shared/load_env.js');
'use strict';

const fs = require('fs');
const path = require('path');

function arg(name, fallback) {
  const flag = `--${name}=`;
  const hit = process.argv.slice(2).find((a) => a.startsWith(flag));
  return hit ? hit.slice(flag.length) : fallback;
}

function main() {
  const root = path.resolve(arg('root', _hmeRequireEnv('PROJECT_ROOT')));
  const name = arg('name', path.basename(root));
  const id = arg('id', name.toLowerCase().replace(/[^a-z0-9_.-]+/g, '-').replace(/^-|-$/g, '') || 'project');
  const source = arg('source', 'src');
  const doc = arg('doc', 'doc/composition.md');
  const pipeline = arg('pipeline', 'npm test');
  const force = process.argv.includes('--force');
  const cfgPath = path.join(root, 'config', 'project-adapter.json');
  if (fs.existsSync(cfgPath) && !force) {
    console.error(`project adapter already exists: ${cfgPath}`);
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
  fs.mkdirSync(path.join(root, source), { recursive: true });
  fs.mkdirSync(path.dirname(path.join(root, doc)), { recursive: true });
  if (!fs.existsSync(path.join(root, doc))) {
    fs.writeFileSync(path.join(root, doc), `# ${name}\n\nDescribe the project intent, architecture, and success criteria.\n`);
  }
  const adapter = {
    project_id: id,
    project_name: name,
    domain: 'software',
    source_roots: [source],
    project_docs: [doc],
    primary_doc: doc,
    pipeline: { main: pipeline },
    artifacts: { metrics_dir: `${source}/output/metrics` },
    optional_artifacts: [],
    capabilities: { pipeline_summary: false },
    health: {},
  };
  fs.writeFileSync(cfgPath, JSON.stringify(adapter, null, 2) + '\n');
  console.log(`project adapter written: ${path.relative(root, cfgPath)}`);
}

main();
