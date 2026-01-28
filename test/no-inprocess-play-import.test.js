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

it('no in-process imports or concurrent spawn/exec of src/play.js (use guarded child process only)', () => {
  const bannedPatterns = [
    { name: 'in-process import', re: /(require\s*\(\s*['"][^'"]*src[/\\]play\.js['"]\s*\)|import[^\n]*['"][^'"]*src[/\\]play\.js['"]|require\.resolve\s*\(\s*['"][^'"]*src[/\\]play\.js['"]\s*\)|import\s*\(\s*['"][^'"]*src[/\\]play\.js['"]\s*\))/ },
    { name: 'spawn/exec of play.js', re: /(\bspawn\b|\bspawnSync\b|\bexec\b|\bexecSync\b)\s*\([^)]*['"`]([^'"`]*src[/\\]play\.js)[^'"`]*['"`]/ },
    { name: 'path.join src/play.js', re: /path\.join\s*\([^)]*['"]src[/\\]play\.js['"][^)]*\)/ }
  ];

  const files = walkDir(process.cwd(), [], '');
  const matches = [];

  for (const f of files) {
    let content = '';
    try { content = fs.readFileSync(f, 'utf8'); } catch (e) { continue; }
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      for (const p of bannedPatterns) {
        if (p.re.test(ln)) {
          const relPath = path.relative(process.cwd(), f);
          // Allow the guarded wrapper `scripts/play-guard.js` to reference `src/play.js` internally
          if (relPath === path.join('scripts','play-guard.js')) continue;
          matches.push({ file: relPath, line: i + 1, text: ln.trim(), pattern: p.name });
        }
      }
    }
  }

  if (matches.length) {
    console.error('Disallowed references to src/play.js found (imports/spawn/exec/path.join):');
    matches.forEach(m => console.error(`${m.file}:${m.line} [${m.pattern}]: ${m.text}`));
  }

  expect(matches.length, 'Found disallowed in-process import or spawn/exec/path.join referencing src/play.js; avoid importing or concurrently spawning the main play script. Use a guarded child process or the play guard.').toBe(0);
});
