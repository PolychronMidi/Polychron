import { initializePlayEngine } from '../src/play.js';

console.log('debug-unit-coverage: starting');

function walkTree(node, path = [], results = []) {
  if (!node) return results;
  const keys = Object.keys(node.children || {});
  if (keys.length === 0) {
    results.push({ path: path.join('/'), node });
  } else {
    for (const k of keys) {
      results.push({ path: path.concat(k).join('/'), node: node.children[k] });
      walkTree(node.children[k], path.concat(k), results);
    }
  }
  return results;
}

(async () => {
  await initializePlayEngine();
  const { getCurrentCompositionContext } = await import('../src/play.js');
  const ctx = getCurrentCompositionContext();

  const tree = ctx.state.timingTree;
  const layerNames = Object.keys(tree);
  console.log('layers:', layerNames);

  const emptySamples = [];

  for (const layer of layerNames) {
    const layerNode = tree[layer];
    const rows = ctx.LM.layers[layer] && ctx.LM.layers[layer].buffer
      ? (ctx.LM.layers[layer].buffer.rows || ctx.LM.layers[layer].buffer)
      : [];

    const points = walkTree(layerNode, [layer], []);

    for (const p of points) {
      const path = p.path;
      const node = p.node;
      const parts = path.split('/');
      const unitKinds = ['measure', 'beat', 'division', 'subdivision', 'subsubdivision'];
      const presentKinds = parts.filter((x) => unitKinds.includes(x));
      if (presentKinds.length === 0) continue;
      const level = presentKinds[presentKinds.length - 1];

      const start = node.start;
      const end = node.end;
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;

      const cnt = (rows || []).filter((r) => Number.isFinite(r && r.tick) && r.tick >= start && r.tick < end).length;
      if (cnt === 0) {
        emptySamples.push({ layer, level, path, start, end });
      }
    }
  }

  console.log('emptySamples count:', emptySamples.length);
  console.log('first 20 empties:', emptySamples.slice(0, 20));
})();
