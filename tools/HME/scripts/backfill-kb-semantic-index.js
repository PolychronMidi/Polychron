#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PROJECT_ROOT } = require('../proxy/shared');
const kb = require('../proxy/kb_semantic_checksum');

const KB_DIR = path.join(PROJECT_ROOT, 'tools', 'HME', 'KB');
const OUT = path.join(PROJECT_ROOT, 'tools', 'HME', 'runtime', 'kb-semantic-index.json');

function hash(text) { return 'sha256:' + crypto.createHash('sha256').update(text || '').digest('hex'); }
function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(fp, out);
    else if (/\.(md|json|txt)$/.test(ent.name)) out.push(fp);
  }
  return out;
}
function symbols(text, file) {
  const found = new Set([path.basename(file)]);
  for (const m of text.matchAll(/`([A-Za-z0-9_./:-]{3,})`/g)) found.add(m[1]);
  for (const m of text.matchAll(/^#{1,3}\s+(.+)$/gm)) found.add(m[1].trim().slice(0, 80));
  return [...found].slice(0, 20);
}
function entry(file) {
  const rel = path.relative(PROJECT_ROOT, file).replace(/\\/g, '/');
  const text = fs.readFileSync(file, 'utf8');
  const ev = hash(text);
  const syms = symbols(text, rel);
  const source_checksums = { [rel]: ev };
  const symbol_checksums = {};
  for (const s of syms) symbol_checksums[s] = hash(`${rel}:${s}:${ev}`);
  const e = {
    id: rel,
    source_files: [rel],
    symbols: syms,
    tests: ['self_coherence_substrate.test.js'],
    decision_date: fs.statSync(file).mtime.toISOString(),
    supersession_condition: 'source file, referenced symbol, or preserving test changes',
    confidence: 0.7,
    evidence_hash: ev,
    source_checksums,
    symbol_checksums,
    checksum: '',
  };
  e.checksum = kb.checksumEntry(e);
  return e;
}
function main() {
  const entries = walk(KB_DIR).map(entry);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ generated_at: new Date().toISOString(), entries }, null, 2) + '\n');
  console.log(JSON.stringify({ entries: entries.length, out: path.relative(PROJECT_ROOT, OUT) }));
}
if (require.main === module) main();
module.exports = { walk, entry };
