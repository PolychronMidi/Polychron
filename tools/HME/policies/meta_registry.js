'use strict';
/**
 * Cross-layer rule meta-registry. Discovery-only — does NOT execute rules
 * across layers (each layer keeps its own execution path because the
 * timing properties are load-bearing). Returns unified metadata for every
 * rule in the codebase, regardless of which enforcement layer it lives in.
 *
 * Layers covered (per the unification analysis):
 *   - hook        — tools/HME/policies/builtin/*.js (already unified, registry)
 *   - eslint      — scripts/eslint-rules/*.js
 *   - hci         — tools/HME/scripts/verify_coherence/*.py (verifier classes)
 *   - hypermeta   — scripts/bias-bounds-manifest.json + check-hypermeta-jurisdiction.js
 *   - audit       — scripts/audit-*.py
 *   - boot        — src/play/fullBootstrap.js (advisory + critical globals)
 *   - middleware  — tools/HME/proxy/middleware/*.js
 *
 * Not covered (intentional):
 *   - runtime invariants in src/ (validator.create() + emissionGateway etc.)
 *     are too pervasive and don't have stable named identities. Listing
 *     every single _safety.assertFinite call is noise, not signal.
 *   - CLAUDE.md prose rules — these are LLM-readable text, not executable
 *     rules with names.
 *
 * Each adapter returns an array of:
 *   {name, layer, category, description, file, defaultEnabled?, status?}
 *
 * `status` is layer-specific: 'on'|'off' for hook policies (config-aware),
 * 'always' for ESLint/audit/runtime (no per-rule disable), or undefined.
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = process.env.PROJECT_ROOT
  || path.resolve(__dirname, '..', '..', '..');

// ── Adapters ────────────────────────────────────────────────────────────

function _scanHookPolicies() {
  // Reuses the existing registry — the canonical source.
  try {
    const registry = require('./registry');
    const config = require('./config');
    registry.loadBuiltins();
    return registry.list().map((p) => ({
      name: p.name,
      layer: 'hook',
      category: p.category || 'uncategorized',
      description: p.description || '',
      file: '(builtin)',
      defaultEnabled: p.defaultEnabled,
      status: config.isEnabled(p.name, p.defaultEnabled) ? 'on' : 'off',
    }));
  } catch (_e) {
    return [];
  }
}

function _scanEslintRules() {
  const dir = path.join(PROJECT_ROOT, 'scripts', 'eslint-rules');
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const f of fs.readdirSync(dir).sort()) {
    if (!f.endsWith('.js') || f.startsWith('_')) continue;
    const file = path.join(dir, f);
    const name = f.replace(/\.js$/, '');
    let description = '';
    try {
      const src = fs.readFileSync(file, 'utf8');
      // ESLint rules typically have a `description:` field in meta.docs.
      const m = src.match(/description:\s*['"`]([^'"`]+)['"`]/)
             || src.match(/^\/\/\s*(.+)$/m);
      if (m) description = m[1].slice(0, 160);
    } catch (_e) { /* best-effort */ }
    out.push({
      name: `local/${name}`,
      layer: 'eslint',
      category: 'lint',
      description,
      file: path.relative(PROJECT_ROOT, file),
      status: 'always',
    });
  }
  return out;
}

function _scanHciVerifiers() {
  const dir = path.join(PROJECT_ROOT, 'tools', 'HME', 'scripts', 'verify_coherence');
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const f of fs.readdirSync(dir).sort()) {
    if (!f.endsWith('.py') || f.startsWith('_')) continue;
    const file = path.join(dir, f);
    let src = '';
    try { src = fs.readFileSync(file, 'utf8'); } catch (_e) { continue; }
    // Verifier classes follow a `name = "kebab-case"` + `class FooVerifier(Verifier)`
    // convention. Extract every match.
    const nameRe = /^\s*name\s*=\s*['"]([a-z][a-z0-9-]*)['"]\s*$/gm;
    let m;
    while ((m = nameRe.exec(src)) !== null) {
      // Try to find the class docstring above.
      const before = src.slice(0, m.index);
      const docMatch = before.match(/class\s+\w+Verifier[^"]*"""([^"]+)"""[^"]*$/);
      const description = docMatch ? docMatch[1].trim().slice(0, 160) : '';
      out.push({
        name: m[1],
        layer: 'hci',
        category: 'audit',
        description,
        file: path.relative(PROJECT_ROOT, file),
        status: 'always',
      });
    }
  }
  return out;
}

function _scanAuditScripts() {
  const dir = path.join(PROJECT_ROOT, 'scripts');
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const f of fs.readdirSync(dir).sort()) {
    if (!f.startsWith('audit-') || (!f.endsWith('.py') && !f.endsWith('.js'))) continue;
    const file = path.join(dir, f);
    const name = f.replace(/\.(py|js)$/, '');
    let description = '';
    try {
      const src = fs.readFileSync(file, 'utf8').slice(0, 800);
      // First top-level docstring or comment block.
      const m = src.match(/"""([^"]+)"""/) || src.match(/\/\*\*?([\s\S]+?)\*\//) || src.match(/^# (.+)$/m) || src.match(/^\/\/ (.+)$/m);
      if (m) description = m[1].split('\n')[0].trim().slice(0, 160);
    } catch (_e) { /* best-effort */ }
    out.push({
      name,
      layer: 'audit',
      category: 'audit',
      description,
      file: path.relative(PROJECT_ROOT, file),
      status: 'always',
    });
  }
  return out;
}

function _scanHypermeta() {
  const manifest = path.join(PROJECT_ROOT, 'scripts', 'bias-bounds-manifest.json');
  if (!fs.existsSync(manifest)) return [];
  return [{
    name: 'hypermeta-jurisdiction',
    layer: 'hypermeta',
    category: 'invariant',
    description: 'Validates 93 conductorIntelligence.register*Bias() calls against bounds manifest. Runs in 4 phases.',
    file: 'scripts/pipeline/validators/check-hypermeta-jurisdiction.js',
    status: 'always',
  }];
}

function _scanBootValidators() {
  const file = path.join(PROJECT_ROOT, 'src', 'play', 'fullBootstrap.js');
  if (!fs.existsSync(file)) return [];
  // fullBootstrap.js exports a critical globals list. Surface as a single
  // meta-rule rather than enumerating every global (would flood).
  return [{
    name: 'boot-validated-globals',
    layer: 'boot',
    category: 'invariant',
    description: 'Critical globals validated at pipeline boot. Missing critical → throw; advisory (@boot-advisory) → warn.',
    file: 'src/play/fullBootstrap.js',
    status: 'always',
  }];
}

function _scanMiddleware() {
  const dir = path.join(PROJECT_ROOT, 'tools', 'HME', 'proxy', 'middleware');
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const f of fs.readdirSync(dir).sort()) {
    if (!f.endsWith('.js') || f.startsWith('_') || f === 'index.js') continue;
    if (f.startsWith('test_') || f.endsWith('.test.js')) continue;
    const file = path.join(dir, f);
    const name = f.replace(/\.js$/, '');
    let description = '';
    try {
      const src = fs.readFileSync(file, 'utf8').slice(0, 1200);
      const m = src.match(/\/\*\*?\s*\n?\s*\*?\s*([^\n*]{20,})/);
      if (m) description = m[1].trim().slice(0, 160);
    } catch (_e) { /* best-effort */ }
    out.push({
      name,
      layer: 'middleware',
      category: 'middleware',
      description,
      file: path.relative(PROJECT_ROOT, file),
      status: 'always',
    });
  }
  return out;
}

// ── Public API ──────────────────────────────────────────────────────────

function listAll() {
  return [
    ..._scanHookPolicies(),
    ..._scanEslintRules(),
    ..._scanHciVerifiers(),
    ..._scanAuditScripts(),
    ..._scanHypermeta(),
    ..._scanBootValidators(),
    ..._scanMiddleware(),
  ];
}

function listByLayer(layer) {
  return listAll().filter((r) => r.layer === layer);
}

function summary() {
  const all = listAll();
  const byLayer = {};
  for (const r of all) byLayer[r.layer] = (byLayer[r.layer] || 0) + 1;
  return { total: all.length, byLayer };
}

module.exports = { listAll, listByLayer, summary };
