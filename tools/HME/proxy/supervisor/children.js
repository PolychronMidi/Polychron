'use strict';
// Supervised child specs: { name, cmd, args, env, healthUrl, startupMs, restartDelayMs, maxRestarts, callTimeoutMs }

const path = require('path');
const { PROJECT_ROOT } = require('../shared');
const { servicePort } = require('../service_registry');

const WORKER_PORT = servicePort('worker');
const LLAMACPP_DAEMON_PORT = servicePort('llamacpp_daemon');

const PYTHONPATH = process.env.PYTHONPATH || '';
const MCP_DIR = path.join(PROJECT_ROOT, 'tools/HME/service');

function mcpEnv() {
  return {
    ...process.env,
    PROJECT_ROOT,
    PYTHONPATH: [MCP_DIR, PYTHONPATH].filter(Boolean).join(':'),
    HF_HUB_OFFLINE: '1',
    TRANSFORMERS_OFFLINE: '1',
    HME_WORKER_PORT: String(WORKER_PORT),
    // Must be set BEFORE PyTorch's first cuda init or it's ignored.
    // expandable_segments avoids the fragmentation that turns a 5 GiB
    // fresh request into a 48 GiB allocation failure during reindex.
    PYTORCH_CUDA_ALLOC_CONF: process.env.PYTORCH_CUDA_ALLOC_CONF || 'expandable_segments:True',
  };
}

const CHILDREN = [
  {
    name: 'worker',
    cmd: 'python3',
    args: [path.join(MCP_DIR, 'worker.py'), '--port', String(WORKER_PORT)],
    env: mcpEnv,
    healthUrl: `http://127.0.0.1:${WORKER_PORT}/health`,
    startupMs: 25_000,   // worker loads RAG engines directly -- slower cold boot
    restartDelayMs: 2_000,
    maxRestarts: 20,
    callTimeoutMs: 90_000,
  },
  {
    name: 'llamacpp_daemon',
    cmd: 'python3',
    // Post-R98 split: the daemon is a package at mcp/llamacpp_daemon/.
    // Invoke via -m so Python's import machinery picks up the package;
    // cwd points at mcp/ so the relative module resolves.
    cwd: MCP_DIR,
    args: ['-m', 'llamacpp_daemon', '--port', String(LLAMACPP_DAEMON_PORT)],
    env: mcpEnv,
    healthUrl: `http://127.0.0.1:${LLAMACPP_DAEMON_PORT}/health`,
    startupMs: 5_000,
    restartDelayMs: 3_000,
    maxRestarts: 10,
    callTimeoutMs: null,
  },
];

module.exports = { CHILDREN, WORKER_PORT };
