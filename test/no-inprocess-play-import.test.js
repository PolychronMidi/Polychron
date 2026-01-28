import fs from 'fs';
import path from 'path';
import { it, expect } from 'vitest';

function walkDir(dir, files = [], base = '') {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const rel = path.join(base, e.name);
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (['node_modules', 'output', 'log', '.git'].includes(e.name)) continue;
      walkDir(abs, files, rel);
    } else if (e.isFile()) {
      // Ignore this test itself and intentionally spawned reproducer test scripts under test/reproducers
      if (rel === 'test/no-inprocess-play-import.test.js' || rel.startsWith('test' + path.sep + 'reproducers')) continue;
      if (rel.endsWith('.js') || rel.endsWith('.mjs')) files.push(abs);
    }
  }
  return files;
}

it('no in-process imports of src/play.js (use child process instead)', () => {
  const banned = /(require\s*\(\s*['\"][^'\"]*src[\/\\]play\.js['\"]\s*\)|import[^\n]*['\"][^'\"]*src[\/\\]play\.js['\"]|require\.resolve\s*\(\s*['\"][^'\"]*src[\/\\]play\.js['\"]\s*\)|import\s*\(\s*['\"][^'\"]*src[\/\\]play\.js['\"]\s*\))/;
  const files = walkDir(process.cwd(), [], '');
  const matches = [];

  for (const f of files) {
    let content = '';
    try { content = fs.readFileSync(f, 'utf8'); } catch (e) { continue; }
    if (banned.test(content)) {
      const lines = content.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        if (banned.test(lines[i])) matches.push({ file: path.relative(process.cwd(), f), line: i + 1, text: lines[i].trim() });
      }
    }
  }

  if (matches.length) {
    console.error('In-process imports of src/play.js found:');
    matches.forEach(m => console.error(`${m.file}:${m.line}: ${m.text}`));
  }

  expect(matches.length, 'Found in-process imports of src/play.js; prefer running play.js in a child process (spawnSync/process.execPath) instead of importing it in-process').toBe(0);
});
