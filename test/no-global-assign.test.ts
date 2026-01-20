import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const root = process.cwd();
const allowlist = JSON.parse(fs.readFileSync(path.join(root, '.global-allowlist.json'), 'utf8')).allowed;

function scanDir(dir: string): string[] {
  const res: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.isDirectory()) {
      if (['node_modules', 'dist', 'coverage', 'output', '__pycache__'].includes(e.name)) continue;
      res.push(...scanDir(path.join(dir, e.name)));
    } else if (e.name.endsWith('.ts') || e.name.endsWith('.js')) {
      res.push(path.join(dir, e.name));
    }
  }
  return res;
}

describe('No new globalThis assignments', () => {
  it('should not assign new properties to globalThis outside allowlist', () => {
    const files = scanDir(path.join(root, 'src'));
    const violations: string[] = [];
    const re = /globalThis\.([a-zA-Z0-9_$]+)\s*=\s*/g;
    for (const f of files) {
      const txt = fs.readFileSync(f, 'utf8');
      let m;
      while ((m = re.exec(txt)) !== null) {
        const name = m[1];
        if (!allowlist.includes(name)) {
          violations.push(`${f}: globalThis.${name}`);
        }
      }
    }
    expect(violations.length, String(violations.slice(0, 10).join(', '))).toBe(0);
  });
});
