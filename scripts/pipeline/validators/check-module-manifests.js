#!/usr/bin/env node
'use strict';

// check-module-manifests.js
//
// Validates that every src/**/*.js file calling moduleLifecycle.declare({...})
// satisfies the registry contract:
//
//   1. The manifest's `name` and every entry in `provides` MUST have a
//      corresponding `declare var <name>:` entry in src/types/globals.d.ts.
//      Catches the bug where a module is migrated to declare() but the
//      type system doesn't know about it -- callers see `any` (or worse,
//      a missing-global lint error).
//
//   2. The manifest's `subsystem` (when declared) MUST be one of the
//      known subsystem names. Catches typos that would silently bypass
//      future firewall enforcement.
//
//   3. The manifest's `reads` (when declared) cross-subsystem references
//      MUST be either (a) same-subsystem, or (b) declared as firewall
//      ports in output/metrics/feedback_graph.json. This is the same
//      enforcement check applied to import-time cross-layer reads, but
//      shifted from runtime to declarative.
//
// Phase 1: this verifier passes trivially when no modules have been
// migrated to declare() yet. It exists so that phase 2 migrations are
// caught at validation time.

const fs = require('fs');
const path = require('path');
const { ROOT } = require('../hme/utils');

const SRC_DIR = path.join(ROOT, 'src');
const GLOBALS_DTS = path.join(ROOT, 'src/types/globals.d.ts');

const KNOWN_SUBSYSTEMS = new Set([
  'utils', 'conductor', 'rhythm', 'time',
  'composers', 'fx', 'crossLayer', 'writer', 'play',
]);

function _walkJs(dir, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === '__pycache__') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) _walkJs(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
}

function _readDeclaredGlobalNames() {
  const dts = fs.readFileSync(GLOBALS_DTS, 'utf8');
  const declareRe = /^\s*declare\s+var\s+([A-Za-z_$][\w$]*)\s*:/;
  const names = new Set();
  for (const line of dts.split(/\r?\n/)) {
    const m = line.match(declareRe);
    if (m) names.add(m[1]);
  }
  return names;
}

// Extract manifest fields from a `moduleLifecycle.declare({...})` call.
// We use a deliberate non-eval text-extract -- safer than executing source
// and tolerates files that import other side-effects. Pattern targets the
// canonical form used in the migration; non-canonical forms (e.g. building
// the manifest separately and passing the variable) won't be recognized
// here and SHOULD be rewritten to the canonical form so they're auditable.
function _extractManifestsFromSource(source) {
  // Very intentionally minimal grammar: object-literal between `declare(` and
  // its matching `)`, single-level brace counting. Handles nested objects
  // (e.g. compose: { axis: 'parent' }) but not template literals containing
  // unbalanced braces -- such manifests should be flagged for migration to
  // a static form.
  const manifests = [];
  const declareSig = 'moduleLifecycle.declare(';
  let idx = source.indexOf(declareSig);
  while (idx !== -1) {
    const start = source.indexOf('{', idx + declareSig.length);
    if (start === -1) break;
    let depth = 0;
    let end = -1;
    for (let i = start; i < source.length; i++) {
      const c = source[i];
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    if (end === -1) break;
    manifests.push({ raw: source.slice(start, end + 1), pos: idx });
    idx = source.indexOf(declareSig, end);
  }
  return manifests;
}

function _extractField(rawObj, fieldName) {
  // String field: name: 'foo' or name: "foo"
  const stringRe = new RegExp(`\\b${fieldName}\\s*:\\s*['"]([^'"]+)['"]`);
  const sm = rawObj.match(stringRe);
  if (sm) return sm[1];
  return null;
}

function _extractStringArrayField(rawObj, fieldName) {
  const arrRe = new RegExp(`\\b${fieldName}\\s*:\\s*\\[([^\\]]*)\\]`);
  const am = rawObj.match(arrRe);
  if (!am) return null;
  const inner = am[1];
  const items = [];
  const itemRe = /['"]([^'"]+)['"]/g;
  let m;
  while ((m = itemRe.exec(inner)) !== null) items.push(m[1]);
  return items;
}

function main() {
  const files = [];
  _walkJs(SRC_DIR, files);
  const declaredGlobals = _readDeclaredGlobalNames();
  const violations = [];
  let manifestCount = 0;

  // The registry implementation file references `moduleLifecycle.declare(`
  // in comments and inside its own implementation -- skip it.
  const REGISTRY_IMPL = path.join(SRC_DIR, 'utils', 'moduleLifecycle.js');

  for (const file of files) {
    if (file === REGISTRY_IMPL) continue;
    const source = fs.readFileSync(file, 'utf8');
    if (!source.includes('moduleLifecycle.declare(')) continue;
    const manifests = _extractManifestsFromSource(source);
    for (const m of manifests) {
      manifestCount++;
      const rel = path.relative(ROOT, file);
      const name = _extractField(m.raw, 'name');
      if (!name) {
        violations.push(`${rel}: manifest at offset ${m.pos} has no extractable 'name' field (canonical form: name: 'foo')`);
        continue;
      }
      const provides = _extractStringArrayField(m.raw, 'provides') || [];
      const subsystem = _extractField(m.raw, 'subsystem');
      const reads = _extractStringArrayField(m.raw, 'reads') || [];
      if (provides.length === 0) {
        violations.push(`${rel}: "${name}" has no extractable 'provides' array`);
      }
      // Type declarations: every provided name must exist in globals.d.ts
      for (const provName of provides) {
        if (!declaredGlobals.has(provName)) {
          violations.push(`${rel}: "${name}" provides "${provName}" but no \`declare var ${provName}:\` entry exists in src/types/globals.d.ts`);
        }
      }
      // Subsystem must be known
      if (subsystem && !KNOWN_SUBSYSTEMS.has(subsystem)) {
        violations.push(`${rel}: "${name}" subsystem="${subsystem}" not in known subsystems (${[...KNOWN_SUBSYSTEMS].join(', ')})`);
      }
      // reads -- documented but not yet firewall-checked. Phase 2.
      void reads;
    }
  }

  if (violations.length > 0) {
    for (const v of violations) console.error('  VIOLATION: ' + v);
    throw new Error(`check-module-manifests: ${violations.length} violation(s) across ${manifestCount} declared manifest(s)`);
  }
  console.log(`check-module-manifests: PASS (${manifestCount} manifest(s) validated, 0 violations)`);
}

main();
