'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

function makeSandbox(prefix) {
  const base = path.join(os.tmpdir(), 'hme-test-sandboxes');
  fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, prefix));
  for (const d of ['src', 'tmp', 'log', 'src/output/metrics', '.git', 'bin']) {
    fs.mkdirSync(path.join(root, d), { recursive: true });
  }
  for (const d of ['tools', 'scripts', 'config']) {
    fs.symlinkSync(path.join(REPO_ROOT, d), path.join(root, d));
  }
  const fakeGit = path.join(root, 'bin', 'git');
  fs.writeFileSync(fakeGit, '#!/usr/bin/env bash\nexit 0\n');
  fs.chmodSync(fakeGit, 0o755);
  return root;
}

function freshenChainModules(root) {
  process.env.PROJECT_ROOT = root;
  process.env.HME_RUNTIME_DIR = path.join(root, 'tmp', 'hme-runtime');
  fs.mkdirSync(process.env.HME_RUNTIME_DIR, { recursive: true });
  for (const k of Object.keys(require.cache)) {
    if (
      k.includes('/tools/HME/event_kernel/')
      || k.includes('/tools/HME/proxy/')
      || k.includes('/tools/HME/policies/')
    ) {
      delete require.cache[k];
    }
  }
}

function withChainSandbox(prefix, fn) {
  const root = makeSandbox(prefix);
  const priorProjectRoot = process.env.PROJECT_ROOT;
  const priorRuntimeDir = process.env.HME_RUNTIME_DIR;
  freshenChainModules(root);
  try {
    return fn(root);
  } finally {
    if (priorProjectRoot === undefined) delete process.env.PROJECT_ROOT;
    else process.env.PROJECT_ROOT = priorProjectRoot;
    if (priorRuntimeDir === undefined) delete process.env.HME_RUNTIME_DIR;
    else process.env.HME_RUNTIME_DIR = priorRuntimeDir;
    try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) { /* best-effort */ }
  }
}

async function withChainSandboxAsync(prefix, fn) {
  const root = makeSandbox(prefix);
  const priorProjectRoot = process.env.PROJECT_ROOT;
  const priorRuntimeDir = process.env.HME_RUNTIME_DIR;
  freshenChainModules(root);
  try {
    return await fn(root);
  } finally {
    if (priorProjectRoot === undefined) delete process.env.PROJECT_ROOT;
    else process.env.PROJECT_ROOT = priorProjectRoot;
    if (priorRuntimeDir === undefined) delete process.env.HME_RUNTIME_DIR;
    else process.env.HME_RUNTIME_DIR = priorRuntimeDir;
    try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) { /* best-effort */ }
  }
}

module.exports = {
  REPO_ROOT,
  makeSandbox,
  freshenChainModules,
  withChainSandbox,
  withChainSandboxAsync,
};
