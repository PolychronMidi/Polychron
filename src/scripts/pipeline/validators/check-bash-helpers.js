'use strict';

// Scans hook scripts in tools/HME/hooks for `_function_name` calls and verifies
// each is defined either locally or in a sourced helper (transitively).

const fs = require('fs');
const path = require('path');

const ROOT = process.env.PROJECT_ROOT || path.resolve(__dirname, '..', '..', '..', '..');
const HOOK_ROOTS = [path.join(ROOT, 'tools/HME/hooks')];

const KNOWN_OK = new Set([
  '_HBOOT_DIR', '_HME_SAFETY_DIR', '_HME_HELPERS_DIR', '_HME_LOG', '_HME_LATENCY',
  '_AB_HIT', '_VLB_HIT', '_BLOAT_HIT', '_NPG_PRIOR', '_RPR_OUT', '_RPR_PAYLOAD',
  '_DA_LOG', '_DA_TS', '_TURN_EDIT_STATE', '_MODULE_BASE',
]);

function listShellFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '__pycache__' || entry.name === '_disabled') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listShellFiles(full));
    else if (entry.name.endsWith('.sh')) out.push(full);
  }
  return out;
}

// rationale: lookup by basename avoids nested-quote parsing complexity.
const HELPER_INDEX = new Map();
function _indexHelpers() {
  const root = path.join(ROOT, 'tools/HME/hooks/helpers');
  if (!fs.existsSync(root)) return;
  function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== '__pycache__') walk(full); }
      else if (e.name.endsWith('.sh')) HELPER_INDEX.set(e.name, full);
    }
  }
  walk(root);
}
_indexHelpers();

function collectSourcedFiles(absStart, visited = new Set()) {
  if (visited.has(absStart)) return visited;
  visited.add(absStart);
  let text;
  try { text = fs.readFileSync(absStart, 'utf8'); } catch { return visited; }
  const re = /^\s*source\s+[^\n]*?([^\s"'`/]+\.sh)\b/gm;
  let m;
  while ((m = re.exec(text))) {
    const resolved = HELPER_INDEX.get(m[1]);
    if (resolved) collectSourcedFiles(resolved, visited);
  }
  return visited;
}

function collectDefinedFunctions(absFiles) {
  const defs = new Set();
  const defRe = /^\s*(?:function\s+)?([_A-Za-z][_A-Za-z0-9]*)\s*\(\s*\)\s*\{/gm;
  for (const f of absFiles) {
    let text;
    try { text = fs.readFileSync(f, 'utf8'); } catch { continue; }
    let m;
    while ((m = defRe.exec(text))) defs.add(m[1]);
  }
  return defs;
}

function findUnderscoreCalls(text) {
  const calls = new Set();
  const re = /(?:^|[\s;`&|(){}])(_[a-zA-Z][_a-zA-Z0-9]*)\s*(?=\s|\(|\{|$)/gm;
  let m;
  while ((m = re.exec(text))) calls.add(m[1]);
  return calls;
}

function main() {
  const violations = [];
  for (const root of HOOK_ROOTS) {
    if (!fs.existsSync(root)) continue;
    for (const hook of listShellFiles(root)) {
      if (hook.includes('/_disabled/') || hook.includes('/helpers/')) continue;
      const sourced = collectSourcedFiles(hook);
      const defined = collectDefinedFunctions([...sourced]);
      let text;
      try { text = fs.readFileSync(hook, 'utf8'); } catch { continue; }
      const calls = findUnderscoreCalls(text);
      for (const call of calls) {
        if (KNOWN_OK.has(call)) continue;
        if (defined.has(call)) continue;
        if (text.includes(`${call}=`)) continue;
        violations.push({ hook: path.relative(ROOT, hook), call });
      }
    }
  }
  if (violations.length > 0) {
    for (const v of violations) {
      console.error('  VIOLATION: ' + v.hook + ' calls undefined `' + v.call + '`');
    }
    throw new Error('check-bash-helpers: ' + violations.length + ' undefined function call(s); add the helper, source the file that defines it, or remove the call.');
  }
  console.log('check-bash-helpers: PASS');
}

main();
