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
