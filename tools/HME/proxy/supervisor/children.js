'use strict';
// Supervised child specs: { name, cmd, args, env, healthUrl, startupMs, restartDelayMs, maxRestarts, callTimeoutMs }

const path = require('path');
const { PROJECT_ROOT } = require('../shared');

const MCP_PORT = parseInt(process.env.HME_MCP_PORT || '9098', 10);
const SHIM_PORT = MCP_PORT;  // legacy alias

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
  };
}

const CHILDREN = [
  {
    name: 'worker',
    cmd: 'python3',
    args: [path.join(MCP_DIR, 'worker.py'), '--port', String(MCP_PORT)],
    env: mcpEnv,
    healthUrl: `http://127.0.0.1:${MCP_PORT}/health`,
    startupMs: 25_000,   // worker loads RAG engines directly now — slower cold boot
    restartDelayMs: 2_000,
    maxRestarts: 20,
    callTimeoutMs: 90_000,
  },
];

module.exports = { CHILDREN, MCP_PORT, SHIM_PORT };
