// scripts/visualize-feedback-graph.js
// Generates an interactive HTML visualization of the feedback topology
// from feedback_graph.json. Pure zero-dependency SVG rendering.
//
// Output: metrics/feedback-graph.html
// Run: node scripts/visualize-feedback-graph.js
// Integrated into `npm run main` pipeline.

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const GRAPH_PATH = path.join(ROOT, 'metrics/feedback_graph.json');
const OUTPUT_DIR = path.join(ROOT, 'metrics');
const HTML_PATH  = path.join(OUTPUT_DIR, 'feedback-graph.html');
const INVARIANTS_PATH = path.join(OUTPUT_DIR, 'tuning-invariants.json');

function getInvariantStatus(invariants) {
  if (!invariants || typeof invariants !== 'object') return null;

  if (Array.isArray(invariants.results) && invariants.results.length > 0) {
    let passed = 0;
    for (let i = 0; i < invariants.results.length; i++) {
      const result = invariants.results[i];
      if (result && (result.pass === true || result.status === 'PASS')) passed++;
    }
    return {
      passed,
      total: invariants.results.length,
      allPass: passed === invariants.results.length
    };
  }

  if (invariants.meta && typeof invariants.meta.passed === 'number' && typeof invariants.meta.total === 'number') {
    return {
      passed: invariants.meta.passed,
      total: invariants.meta.total,
      allPass: invariants.meta.passed === invariants.meta.total
    };
  }

  return null;
}

function main() {
  if (!fs.existsSync(GRAPH_PATH)) {
    console.warn('Acceptable warning: visualize-feedback-graph: feedback_graph.json not found, skipping.');
    return;
  }

  let graph;
  try {
    graph = JSON.parse(fs.readFileSync(GRAPH_PATH, 'utf8'));
  } catch (err) {
    console.warn('Acceptable warning: visualize-feedback-graph: failed to parse feedback_graph.json: ' + (err && err.message ? err.message : err));
    return;
  }
  const loops = graph.feedbackLoops || [];
  const firewalls = graph.firewalls || {};

  // Load tuning invariant results if available
  let invariants = null;
  if (fs.existsSync(INVARIANTS_PATH)) {
    invariants = JSON.parse(fs.readFileSync(INVARIANTS_PATH, 'utf8'));
  }

  // Build node set from loops
  const nodeSet = new Set();
  for (const loop of loops) {
    nodeSet.add(loop.sourceDomain);
    nodeSet.add(loop.targetDomain);
  }
  const nodes = [...nodeSet];

  // Assign positions in a circle
  const cx = 500, cy = 350, radius = 250;
  const nodePositions = {};
  nodes.forEach((n, i) => {
    const angle = (2 * Math.PI * i) / nodes.length - Math.PI / 2;
    nodePositions[n] = {
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle)
    };
  });

  // Color scheme by latency
  const latencyColors = {
    'immediate': '#4CAF50',
    'beat-delayed': '#2196F3',
    'phrase-delayed': '#FF9800',
    'section-delayed': '#F44336'
  };

  // Build SVG content
  const svgParts = [];

  // Arrowhead marker definitions
  svgParts.push('<defs>');
  for (const [latency, color] of Object.entries(latencyColors)) {
    svgParts.push(`<marker id="arrow-${latency}" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="${color}"/></marker>`);
  }
  svgParts.push('</defs>');

  // Draw edges (feedback loops)
  for (const loop of loops) {
    const src = nodePositions[loop.sourceDomain];
    const tgt = nodePositions[loop.targetDomain];
    if (!src || !tgt) continue;

    const color = latencyColors[loop.latency] || '#999';
    const midX = (src.x + tgt.x) / 2 + (src.y - tgt.y) * 0.15;
    const midY = (src.y + tgt.y) / 2 + (tgt.x - src.x) * 0.15;

    svgParts.push(`<path d="M ${src.x} ${src.y} Q ${midX} ${midY} ${tgt.x} ${tgt.y}" fill="none" stroke="${color}" stroke-width="2.5" marker-end="url(#arrow-${loop.latency})" opacity="0.8">`);
    svgParts.push(`<title>${loop.id} (${loop.module})\n${loop.mechanism}\nLatency: ${loop.latency}\nFirewalls: ${(loop.firewallsCrossed || []).join(', ') || 'none'}</title>`);
    svgParts.push('</path>');

    // Loop label at midpoint
    svgParts.push(`<text x="${midX}" y="${midY - 8}" text-anchor="middle" font-size="10" fill="${color}" font-weight="bold">${loop.id}</text>`);
  }

  // Draw nodes
  for (const [name, pos] of Object.entries(nodePositions)) {
    const shortName = name.replace(/.*\//, '').replace(/\s*\(.*\)/, '');
    const subsystem = name.includes('/') ? name.split('/')[0] : 'top';
    const nodeColor = subsystem === 'conductor' ? '#7E57C2'
      : subsystem === 'crossLayer' ? '#26A69A'
      : subsystem === 'play' ? '#EF5350'
      : subsystem === 'time' ? '#42A5F5'
      : '#78909C';

    svgParts.push(`<circle cx="${pos.x}" cy="${pos.y}" r="28" fill="${nodeColor}" stroke="#fff" stroke-width="2" opacity="0.9"><title>${name}</title></circle>`);
    svgParts.push(`<text x="${pos.x}" y="${pos.y + 4}" text-anchor="middle" font-size="9" fill="white" font-weight="bold">${shortName}</text>`);
  }

  // Firewalls legend
  const fwNames = Object.keys(firewalls);
  let fwY = 20;
  svgParts.push('<g transform="translate(20, 20)">');
  svgParts.push('<text x="0" y="0" font-size="13" font-weight="bold" fill="#333">Firewalls</text>');
  for (const fw of fwNames) {
    fwY += 18;
    const info = firewalls[fw];
    svgParts.push(`<text x="0" y="${fwY}" font-size="10" fill="#666"><tspan font-weight="bold">${fw}</tspan>: ${info.boundaryType}</text>`);
  }
  svgParts.push('</g>');

  // Latency legend
  svgParts.push('<g transform="translate(20, 620)">');
  svgParts.push('<text x="0" y="0" font-size="13" font-weight="bold" fill="#333">Latency</text>');
  let legX = 0;
  for (const [latency, color] of Object.entries(latencyColors)) {
    svgParts.push(`<rect x="${legX}" y="10" width="12" height="12" fill="${color}" rx="2"/>`);
    svgParts.push(`<text x="${legX + 16}" y="21" font-size="10" fill="#333">${latency}</text>`);
    legX += 130;
  }
  svgParts.push('</g>');

  // Tuning invariant status badge
  const invariantStatus = getInvariantStatus(invariants);
  if (invariantStatus) {
    svgParts.push(`<g transform="translate(750, 20)">`);
    svgParts.push(`<rect x="0" y="0" width="220" height="30" rx="6" fill="${invariantStatus.allPass ? '#4CAF50' : '#F44336'}" opacity="0.9"/>`);
    svgParts.push(`<text x="110" y="20" text-anchor="middle" font-size="12" fill="white" font-weight="bold">Invariants: ${invariantStatus.passed}/${invariantStatus.total} ${invariantStatus.allPass ? 'PASS' : 'FAIL'}</text>`);
    svgParts.push('</g>');
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Polychron Feedback Topology</title>
<style>
  body { margin: 0; background: #f5f5f5; font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
  .container { max-width: 1000px; margin: 20px auto; }
  h1 { text-align: center; color: #333; margin: 10px 0; font-size: 20px; }
  svg { display: block; margin: 0 auto; background: white; border-radius: 8px; box-shadow: 0 2px 12px rgba(0,0,0,0.1); }
  .info { text-align: center; color: #666; font-size: 12px; margin: 10px 0; }
</style>
</head>
<body>
<div class="container">
  <h1>Polychron Feedback Topology</h1>
  <p class="info">${loops.length} feedback loops | ${fwNames.length} firewalls | ${nodes.length} domains</p>
  <svg viewBox="0 0 1000 660" xmlns="http://www.w3.org/2000/svg">
    ${svgParts.join('\n    ')}
  </svg>
  <p class="info">Hover over edges for mechanism details. Generated ${new Date().toISOString()}</p>
</div>
</body>
</html>`;

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(HTML_PATH, html, 'utf8');
  console.log(`visualize-feedback-graph: ${loops.length} loops, ${fwNames.length} firewalls -> metrics/feedback-graph.html`);
}

main();
