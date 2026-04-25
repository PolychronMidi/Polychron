#!/usr/bin/env node
'use strict';
/**
 * `i/policies` CLI — discover and configure unified hook-time policies.
 *
 * Subcommands:
 *   list                       List every registered policy with status (en/dis/default).
 *   show <name>                Detailed view of one policy.
 *   enable <name>              Add to project-shared .hme/policies.json `enabled` list.
 *   disable <name>              Add to project-shared .hme/policies.json `disabled` list.
 *   reset <name>               Remove name from both lists (revert to defaultEnabled).
 *   paths                      Print the three config-scope file paths.
 *   eval <name>                Run a single policy against stdin JSON ({toolInput,...}); print decision.
 *
 * Config writes go to the PROJECT-shared file by default. Pass `--scope=local`
 * to write to .hme/policies.local.json or `--scope=global` for ~/.hme/policies.json.
 */

const fs = require('fs');
const path = require('path');

const registry = require('./registry');
const config = require('./config');

function _initRegistry() {
  registry.loadBuiltins();
  const cfg = config.get();
  if (cfg.customPoliciesPath) {
    const resolved = path.isAbsolute(cfg.customPoliciesPath)
      ? cfg.customPoliciesPath
      : path.join(registry.PROJECT_ROOT, cfg.customPoliciesPath);
    registry.loadCustom(resolved);
  }
}

function _statusOf(p) {
  const cfg = config.get();
  if (cfg.disabled.has(p.name)) return 'disabled';
  if (cfg.enabled.has(p.name))  return 'enabled';
  return p.defaultEnabled ? 'default-on' : 'default-off';
}

function cmdList() {
  _initRegistry();
  const policies = registry.list();
  if (policies.length === 0) {
    console.log('(no policies registered)');
    return 0;
  }
  // Group by category.
  const byCat = new Map();
  for (const p of policies) {
    const cat = p.category || 'uncategorized';
    if (!byCat.has(cat)) byCat.set(cat, []);
    byCat.get(cat).push(p);
  }
  const cats = Array.from(byCat.keys()).sort();
  for (const cat of cats) {
    console.log(`\n[${cat}]`);
    for (const p of byCat.get(cat).sort((a, b) => a.name.localeCompare(b.name))) {
      const status = _statusOf(p);
      const events = p.match.events.join(',');
      const tools = p.match.tools ? `[${p.match.tools.join(',')}]` : '*';
      const pad = (s, n) => (s + ' '.repeat(n)).slice(0, n);
      console.log(`  ${pad(p.name, 28)} ${pad(status, 12)} ${pad(events, 16)} ${pad(tools, 24)} ${p.description || ''}`);
    }
  }
  return 0;
}

function cmdShow(name) {
  _initRegistry();
  const p = registry.get(name);
  if (!p) {
    console.error(`policy not found: ${name}`);
    return 1;
  }
  console.log(`name:           ${p.name}`);
  console.log(`description:    ${p.description || '(none)'}`);
  console.log(`category:       ${p.category || 'uncategorized'}`);
  console.log(`default:        ${p.defaultEnabled ? 'enabled' : 'disabled'}`);
  console.log(`status:         ${_statusOf(p)}`);
  console.log(`match.events:   ${p.match.events.join(', ')}`);
  console.log(`match.tools:    ${p.match.tools ? p.match.tools.join(', ') : '(any)'}`);
  if (p.params) console.log(`default params: ${JSON.stringify(p.params)}`);
  console.log(`current params: ${JSON.stringify(config.paramsFor(p.name, p.params || {}))}`);
  return 0;
}

function _scopeFile(scope) {
  const files = config._scopeFiles();
  // Indices: 0=local, 1=project, 2=global
  if (scope === 'local')  return files[0];
  if (scope === 'global') return files[2];
  return files[1]; // project (default)
}

function _writeMutation(name, listKey, action, scope) {
  const file = _scopeFile(scope);
  let cfg = {};
  if (fs.existsSync(file)) {
    try { cfg = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (err) { console.error(`refusing to clobber malformed JSON at ${file}: ${err.message}`); return 1; }
  }
  const list = Array.isArray(cfg[listKey]) ? cfg[listKey] : [];
  const set = new Set(list);
  if (action === 'add') set.add(name);
  if (action === 'remove') set.delete(name);
  cfg[listKey] = Array.from(set).sort();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
  console.log(`${listKey}: ${action === 'add' ? '+' : '-'}${name} → ${file}`);
  config.reset();
  return 0;
}

function cmdEnable(name, scope) {
  _initRegistry();
  if (!registry.get(name)) { console.error(`policy not found: ${name}`); return 1; }
  // Adding to enabled also removes from disabled (mutually exclusive).
  _writeMutation(name, 'disabled', 'remove', scope);
  return _writeMutation(name, 'enabled', 'add', scope);
}

function cmdDisable(name, scope) {
  _initRegistry();
  if (!registry.get(name)) { console.error(`policy not found: ${name}`); return 1; }
  _writeMutation(name, 'enabled', 'remove', scope);
  return _writeMutation(name, 'disabled', 'add', scope);
}

function cmdReset(name, scope) {
  _initRegistry();
  if (!registry.get(name)) { console.error(`policy not found: ${name}`); return 1; }
  _writeMutation(name, 'enabled', 'remove', scope);
  return _writeMutation(name, 'disabled', 'remove', scope);
}

function cmdPaths() {
  const files = config._scopeFiles();
  console.log(`local:   ${files[0]}${fs.existsSync(files[0]) ? '' : ' (does not exist)'}`);
  console.log(`project: ${files[1]}${fs.existsSync(files[1]) ? '' : ' (does not exist)'}`);
  console.log(`global:  ${files[2]}${fs.existsSync(files[2]) ? '' : ' (does not exist)'}`);
  return 0;
}

async function cmdEval(name) {
  _initRegistry();
  const p = registry.get(name);
  if (!p) { console.error(`policy not found: ${name}`); return 1; }
  let stdin = '';
  for await (const chunk of process.stdin) stdin += chunk;
  let input;
  try { input = JSON.parse(stdin || '{}'); }
  catch (err) { console.error(`invalid JSON on stdin: ${err.message}`); return 2; }
  const ctx = {
    toolInput: input.tool_input || input.toolInput || {},
    toolName: input.tool_name || input.toolName || '',
    sessionId: input.session_id || input.sessionId || '',
    payload: input,
    deny: registry.deny,
    instruct: registry.instruct,
    allow: registry.allow,
    params: config.paramsFor(p.name, p.params || {}),
  };
  let result;
  try { result = await p.fn(ctx); }
  catch (err) { console.error(`policy '${name}' threw: ${err.stack || err.message}`); return 1; }
  process.stdout.write(JSON.stringify(result || ctx.allow()) + '\n');
  return 0;
}

function _parseScope(args) {
  const flag = args.find((a) => a.startsWith('--scope='));
  return flag ? flag.split('=')[1] : 'project';
}

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0] || 'list';
  const rest = args.slice(1);
  const scope = _parseScope(rest);
  const positional = rest.filter((a) => !a.startsWith('--'));

  let rc = 0;
  switch (cmd) {
    case 'list':    rc = cmdList(); break;
    case 'show':    rc = cmdShow(positional[0]); break;
    case 'enable':  rc = cmdEnable(positional[0], scope); break;
    case 'disable': rc = cmdDisable(positional[0], scope); break;
    case 'reset':   rc = cmdReset(positional[0], scope); break;
    case 'paths':   rc = cmdPaths(); break;
    case 'eval':    rc = await cmdEval(positional[0]); break;
    case '--help':
    case '-h':
    case 'help':
      console.log('Usage: i/policies <list|show|enable|disable|reset|paths|eval> [args] [--scope=local|project|global]');
      console.log('');
      console.log('  list              Show every registered policy with status.');
      console.log('  show NAME         Detailed view of one policy.');
      console.log('  enable NAME       Enable a policy (writes to .hme/policies.json by default).');
      console.log('  disable NAME      Disable a policy.');
      console.log('  reset NAME        Revert to defaultEnabled (remove from both enable/disable lists).');
      console.log('  paths             Print the three config-scope file paths.');
      console.log('  eval NAME         Run one policy against stdin JSON ({tool_input,...}).');
      rc = 0;
      break;
    default:
      console.error(`unknown command: ${cmd}`);
      console.error('try: i/policies help');
      rc = 2;
  }
  process.exit(rc);
}

main().catch((err) => {
  console.error(`[i/policies] crash: ${err.stack || err.message}`);
  process.exit(1);
});
