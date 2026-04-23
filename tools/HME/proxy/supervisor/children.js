'use strict';
// Supervised child specs: { name, cmd, args, env, healthUrl, startupMs, restartDelayMs, maxRestarts, callTimeoutMs }

const path = require('path');
const { PROJECT_ROOT } = require('../shared');

const MCP_PORT = parseInt(process.env.HME_MCP_PORT || '9098', 10);
const SHIM_PORT = MCP_PORT;  // legacy alias
const LLAMACPP_DAEMON_PORT = parseInt(process.env.HME_LLAMACPP_DAEMON_PORT || '7735', 10);

const PYTHONPATH = process.env.PYTHONPATH || '';
const MCP_DIR = path.join(PROJECT_ROOT, 'tools/HME/mcp');

function mcpEnv() {
  return {
    ...process.env,
    PROJECT_ROOT,
    PYTHONPATH: [MCP_DIR, PYTHONPATH].filter(Boolean).join(':'),
    HF_HUB_OFFLINE: '1',
    TRANSFORMERS_OFFLINE: '1',
    HME_MCP_PORT: String(MCP_PORT),
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
    args: [path.join(MCP_DIR, 'worker.py'), '--port', String(MCP_PORT)],
    env: mcpEnv,
    healthUrl: `http://127.0.0.1:${MCP_PORT}/health`,
    startupMs: 25_000,   // worker loads RAG engines directly — slower cold boot
    restartDelayMs: 2_000,
    maxRestarts: 20,
    callTimeoutMs: 90_000,
  },
  {
    name: 'llamacpp_daemon',
    cmd: 'python3',
    args: [path.join(MCP_DIR, 'llamacpp_daemon.py'), '--port', String(LLAMACPP_DAEMON_PORT)],
    env: mcpEnv,
    healthUrl: `http://127.0.0.1:${LLAMACPP_DAEMON_PORT}/health`,
    startupMs: 5_000,
    restartDelayMs: 3_000,
    maxRestarts: 10,
    callTimeoutMs: null,
  },
];

module.exports = { CHILDREN, MCP_PORT, SHIM_PORT };
