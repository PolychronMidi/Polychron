import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

function walk(dir: string): string[] {
  return fs.readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return fs.statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe('globalThis usage regression test', () => {
  it('does not increase globalThis usage beyond baseline', () => {
    const files = walk(path.resolve(__dirname, '..', 'src')).filter((f) => /\.(ts|js)$/.test(f));
    let count = 0;
    for (const file of files) {
      const txt = fs.readFileSync(file, 'utf8');
      const matches = txt.match(/globalThis/g);
      if (matches) count += matches.length;
    }
    // Baseline captured on 2026-01-21
    const BASELINE = 479;
    expect(count).toBeLessThanOrEqual(BASELINE);
  });
});
