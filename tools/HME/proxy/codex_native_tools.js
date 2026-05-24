'use strict';

// Pure passthrough: the codex proxy must NOT rewrite tool calls the upstream
// model emits, must NOT rename Edit/Write/Bash/etc -> exec_command, and must

const { uniformToolList } = require('./codex_uniform_tools');

const BRIDGE = 'python3 tools/HME/hme_tools/run_tool.py';

function nativeToolSchemas() { return uniformToolList(); }

function injectNativeToolSchemas(body, _cfg) {
  return { body, stats: { added: 0, dropped: 0, replaced: false, dropped_names: [] } };
}

function rewriteCodexResponseObject(obj) {
  return { body: obj, stats: { calls: 0 } };
}

function createNativeToolSseRewriter() {
  const stats = { calls: 0 };
  return {
    stats,
    feed(chunk) { return chunk.toString('utf8'); },
    finish() { return ''; },
  };
}

function jsonHeredoc(input) {
  return `<<'HME_CODEX_JSON'\n${JSON.stringify(input)}\nHME_CODEX_JSON`;
}

function bridgeCommand(name, args) {
  return `${BRIDGE} ${name} --json ${jsonHeredoc(args || {})}`;
}

module.exports = {
  injectNativeToolSchemas,
  rewriteCodexResponseObject,
  createNativeToolSseRewriter,
  bridgeCommand,
  nativeToolSchemas,
};
