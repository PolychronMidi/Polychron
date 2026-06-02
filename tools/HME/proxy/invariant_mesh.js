'use strict';

const fs = require('fs');
const path = require('path');
const { PROJECT_ROOT } = require('./shared');

function _json(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_e) { return fallback; } }
function _node(type, id, meta = {}) { return { id: `${type}:${id}`, type, name: String(id), meta }; }
function _edge(from, to, kind) { return { from, to, kind }; }

function buildMesh(root = PROJECT_ROOT) {
  const nodes = [];
  const edges = [];
  const routes = _json(path.join(root, 'tools/HME/event_kernel/dispatcher-routes.json'), { routes: [] }).routes || [];
  const middleware = _json(path.join(root, 'tools/HME/proxy/middleware/manifest.json'), { modules: [] }).modules || [];
  const stateFiles = _json(path.join(root, 'tools/HME/config/state-files.json'), { single_owner: [] }).single_owner || [];
  const services = _json(path.join(root, 'tools/HME/config/services.json'), { services: [] }).services || [];
  const specsDir = path.join(root, 'tools/HME/tests/specs');
  const tests = fs.existsSync(specsDir) ? fs.readdirSync(specsDir).filter((f) => /\.test\.(js|py)$/.test(f)).sort() : [];

  for (const r of routes) {
    nodes.push(_node('route', r.event, { policyContext: r.policyContext, strictMode: r.strictMode }));
    for (const s of r.scripts || []) {
      nodes.push(_node('hook_script', s));
      edges.push(_edge(`route:${r.event}`, `hook_script:${s}`, 'invokes'));
    }
  }
  for (const m of middleware) {
    nodes.push(_node('middleware', m.name, {
      file: m.file,
      phase: m.phase,
      effects: m.effects || [],
      mutatesPayload: Boolean(m.mutatesPayload),
      mutatesToolResult: Boolean(m.mutatesToolResult),
      idempotencyMarkerDeclared: Object.prototype.hasOwnProperty.call(m, 'idempotencyMarkerRequired'),
    }));
    for (const effect of m.effects || []) edges.push(_edge(`middleware:${m.name}`, `effect:${effect}`, 'emits_effect'));
  }
  for (const s of stateFiles) {
    nodes.push(_node('state_file', s.path, { owner: s.owner, schema: s.schema }));
    if (s.owner) edges.push(_edge(`owner:${s.owner}`, `state_file:${s.path}`, 'owns'));
  }
  for (const svc of services) {
    nodes.push(_node('service', svc.id, { required: Boolean(svc.required), kind: svc.kind }));
    if (svc.supervised_by) edges.push(_edge(`service:${svc.supervised_by}`, `service:${svc.id}`, 'supervises'));
  }
  for (const t of tests) nodes.push(_node('test', t));
  for (const t of tests) {
    const low = t.toLowerCase();
    for (const m of middleware) if (low.includes(String(m.name).replace(/_/g, '-')) || low.includes(String(m.name))) edges.push(_edge(`test:${t}`, `middleware:${m.name}`, 'covers'));
    for (const r of routes) if (low.includes(String(r.event).toLowerCase())) edges.push(_edge(`test:${t}`, `route:${r.event}`, 'covers'));
  }
  return { nodes, edges, counts: { nodes: nodes.length, edges: edges.length, routes: routes.length, middleware: middleware.length, state_files: stateFiles.length, services: services.length, tests: tests.length } };
}

function queryMesh(root, mode = 'summary') {
  const mesh = buildMesh(root);
  if (mode === 'mutators') return mesh.nodes.filter((n) => n.type === 'middleware' && (n.meta.effects || []).some((e) => /payload|toolResult/.test(e)));
  if (mode === 'orphans') {
    const covered = new Set(mesh.edges.filter((e) => e.kind === 'covers').map((e) => e.to));
    return mesh.nodes.filter((n) => ['middleware', 'route'].includes(n.type) && !covered.has(n.id));
  }
  return mesh.counts;
}

module.exports = { buildMesh, queryMesh };
