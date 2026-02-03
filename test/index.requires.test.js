import { expect, test } from 'vitest';
import fs from 'fs';
import path from 'path';

// Ensure every directory under src that contains an index.js lists requires
// for all sibling .js files (excluding index.js itself).

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test('each src subfolder with index.js requires its local .js files', () => {
  const root = path.resolve(__dirname, '../src');
  const missingMap = [];

  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files = entries.filter(e => e.isFile()).map(e => e.name);
    const subdirs = entries.filter(e => e.isDirectory()).map(e => e.name);

    if (files.includes('index.js')) {
      const indexPath = path.join(dir, 'index.js');
      let indexContent = '';
      try { indexContent = fs.readFileSync(indexPath, 'utf8'); } catch (e) { /* swallow - will be caught as missing */ }
      const jsFiles = files.filter(f => f.endsWith('.js') && f !== 'index.js');
      const missing = [];
      jsFiles.forEach((f) => {
        const base = f.replace(/\.js$/, '');
        // Match exact standalone require('./name'); line (no assignment, no extra tokens)
        const patt = new RegExp("^\\s*require\\(\\s*['\"]\\./" + escapeRegExp(base) + "(\\.js)?['\"]\\s*\\)\\s*;\\s*$","m");
        if (!patt.test(indexContent)) missing.push(f);
      });
      if (missing.length) missingMap.push({ dir: path.relative(process.cwd(), dir), missing });
    }

    // Recurse into subdirectories
    subdirs.forEach(sd => walk(path.join(dir, sd)));
  }

  walk(root);

  if (missingMap.length) {
    const msgs = missingMap.map(m => `${m.dir}: missing requires for ${m.missing.join(', ')}`);
    // Fail with clear message
    expect(msgs.join('\n')).toBe('');
  } else {
    expect(missingMap.length).toBe(0);
  }
});

// Ensure no require() usage in src files is assigned using const/let/var keywords
// (enforces naked-side-effect requires like `require('./foo');`).
test('no requires assigned with const/let/var in src files', () => {
  const root = path.resolve(__dirname, '../src');
  const violations = [];

  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files = entries.filter(e => e.isFile()).map(e => e.name);
    const subdirs = entries.filter(e => e.isDirectory()).map(e => e.name);

    files.filter(f => f.endsWith('.js')).forEach((file) => {
      const filePath = path.join(dir, file);
      let content = '';
      try { content = fs.readFileSync(filePath, 'utf8'); } catch (e) { return; }
      const lines = content.split('\n');
      lines.forEach((line, i) => {
        const trimmed = line.trim();
        // Ignore commented-out lines
        if (/^\/+/.test(trimmed)) return;
        // Detect patterns like: const X = require('...')  OR let X = require(...) OR var X = require(...)
        if (/^\s*(?:const|let|var)\b[\s\S]*\brequire\s*\(/.test(line)) {
          violations.push(`${path.relative(process.cwd(), filePath)}:${i+1}: ${trimmed}`);
        }
      });
    });

    subdirs.forEach(sd => walk(path.join(dir, sd)));
  }

  walk(root);

  if (violations.length) {
    expect(violations.join('\n')).toBe('');
  } else {
    expect(violations.length).toBe(0);
  }
});
