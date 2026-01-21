import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Scan src/ for occurrences of globalThis and report them.
// This test is intended as a metric and will fail if the count grows unbounded.
// Current threshold is permissive; we will lower it gradually as we remove fallbacks.

describe('Global fallbacks report', () => {
  it('finds and reports occurrences of globalThis usage in src', () => {
    const srcDir = path.resolve(__dirname, '..', 'src');

    const results: Array<{file:string, line:number, text:string}> = [];

    function walk(dir: string) {
      for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
          walk(full);
        } else if (stat.isFile() && full.endsWith('.ts')) {
          const content = fs.readFileSync(full, 'utf8');
          const lines = content.split(/\r?\n/);
          for (let i = 0; i < lines.length; i++) {
            if (/\bglobalThis\b/.test(lines[i])) {
              results.push({ file: path.relative(process.cwd(), full), line: i + 1, text: lines[i].trim() });
            }
          }
        }
      }
    }

    walk(srcDir);

    // Print for visibility in CI logs
    if (results.length === 0) {
      console.log('No globalThis occurrences found in src/ — great!');
    } else {
      console.log(`Found ${results.length} globalThis occurrences:`);
      results.slice(0, 200).forEach(r => console.log(`${r.file}:${r.line}: ${r.text}`));
    }

    // Set a permissive threshold (will be reduced over time)
    const threshold = 300; // current count is lower than this; lower the threshold as we migrate away from globals
    expect(results.length, `globalThis occurrences found; reduce or migrate these to DI/context`).toBeLessThanOrEqual(threshold);
  });
});
