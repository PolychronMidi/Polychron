'use strict';

function createGraph() { return { nodes: {}, edges: [] }; }
function addNode(graph, id, kind, fields = {}) {
  if (!id || !kind) throw new Error('claim_graph: id and kind required');
  graph.nodes[id] = { id, kind, ...fields };
  return graph.nodes[id];
}
function addEdge(graph, from, relation, to, fields = {}) {
  if (!graph.nodes[from] || !graph.nodes[to]) throw new Error('claim_graph: edge endpoints must exist');
  const edge = { from, relation, to, ...fields };
  graph.edges.push(edge);
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
module.exports = { createGraph, addNode, addEdge, explain };
