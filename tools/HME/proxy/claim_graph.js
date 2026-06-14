'use strict';

const fs = require('fs');
const path = require('path');
const { PROJECT_ROOT } = require('./shared');

const DEFAULT_GRAPH = path.join(PROJECT_ROOT, 'tools', 'HME', 'runtime', 'claim-graph.json');
const NODE_KINDS = Object.freeze(['file', 'verifier', 'policy', 'test', 'kb_entry', 'alert', 'repair', 'claim', 'evidence', 'invalidator']);
const EDGE_RELATIONS = Object.freeze(['produces', 'evidenced_by', 'preserved_by', 'repaired_by', 'invalidated_by', 'measured_by', 'preserves', 'originated_from', 'risks_breaking']);
const NODE_SET = new Set(NODE_KINDS);
const EDGE_SET = new Set(EDGE_RELATIONS);

function createGraph(fields = {}) { return { schema_version: '1.0.0', nodes: {}, edges: [], ...fields }; }

function validateNodeKind(kind) {
  if (!NODE_SET.has(kind)) throw new Error(`claim_graph: invalid node kind ${kind}`);
}

function validateEdgeRelation(relation) {
  if (!EDGE_SET.has(relation)) throw new Error(`claim_graph: invalid edge relation ${relation}`);
}

function addNode(graph, id, kind, fields = {}) {
  if (!id || !kind) throw new Error('claim_graph: id and kind required');
  validateNodeKind(kind);
  graph.nodes[id] = { id, kind, updated_at: new Date().toISOString(), ...fields };
  return graph.nodes[id];
}

function addEdge(graph, from, relation, to, fields = {}) {
  if (!graph.nodes[from] || !graph.nodes[to]) throw new Error('claim_graph: edge endpoints must exist');
  validateEdgeRelation(relation);
  const edge = { from, relation, to, ts: new Date().toISOString(), ...fields };
  graph.edges.push(edge);
  return edge;
}

function writeEdge(file, from, relation, to, fields = {}) {
  const graph = loadGraph(file);
  const edge = addEdge(graph, from, relation, to, fields);
  saveGraph(graph, file);
  return edge;
}

function explain(graph, id) {
  const node = graph.nodes[id];
  if (!node) return null;
  return {
    node,
    incoming: graph.edges.filter((e) => e.to === id),
    outgoing: graph.edges.filter((e) => e.from === id),
  };
}

function explainClaim(graph, id) {
  const base = explain(graph, id);
  if (!base) return null;
  const node = base.node;
  const tests = base.incoming.concat(base.outgoing).filter((e) => e.relation === 'preserved_by' || e.relation === 'preserves').map((e) => e.from === id ? e.to : e.from);
  return {
    claim_id: id,
    rule_origin: node.rule_origin || '',
    birthing_bug: node.birthing_bug || '',
    preserving_tests: node.preserving_tests || tests,
    retirement_condition: node.retirement_condition || '',
    breakage_risk: node.breakage_risk || '',
    incoming: base.incoming,
    outgoing: base.outgoing,
  };
}

function loadGraph(file = DEFAULT_GRAPH) {
  if (!fs.existsSync(file)) return createGraph();
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  return { ...createGraph(), ...parsed, nodes: parsed.nodes || {}, edges: parsed.edges || [] };
}

function saveGraph(graph, file = DEFAULT_GRAPH) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(graph, null, 2) + '\n');
  return file;
}

function enforceRetention(graph, opts = {}) {
  const maxNodes = Number.isFinite(opts.maxNodes) ? opts.maxNodes : 5000;
  const maxEdges = Number.isFinite(opts.maxEdges) ? opts.maxEdges : 20000;
  const nodeIds = Object.keys(graph.nodes || {});
  const removed = [];
  if (nodeIds.length > maxNodes) {
    const sorted = nodeIds.sort((a, b) => String(graph.nodes[a].updated_at || '').localeCompare(String(graph.nodes[b].updated_at || '')));
    for (const id of sorted.slice(0, nodeIds.length - maxNodes)) {
      delete graph.nodes[id];
      removed.push(id);
    }
    graph.edges = (graph.edges || []).filter((e) => graph.nodes[e.from] && graph.nodes[e.to]);
  }
  if ((graph.edges || []).length > maxEdges) graph.edges = graph.edges.slice(graph.edges.length - maxEdges);
  return { graph, removed, node_count: Object.keys(graph.nodes || {}).length, edge_count: (graph.edges || []).length };
}

module.exports = {
  DEFAULT_GRAPH,
  NODE_KINDS,
  EDGE_RELATIONS,
  createGraph,
  addNode,
  addEdge,
  writeEdge,
  explain,
  explainClaim,
  loadGraph,
  saveGraph,
  enforceRetention,
};
