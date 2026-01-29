import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';

// This test ensures no individual tests specify a numeric per-test timeout.
// We enforce that timeouts should be configured globally in vitest config only.

describe('test-suite style rules', () => {
  it('has no per-test numeric timeouts in repository tests', () => {
    const testsDir = path.join(process.cwd(), 'test');
    const files = fs.readdirSync(testsDir).filter(f => f.endsWith('.js') || f.endsWith('.ts'));
    const offenders = [];

    // Robust detection: locate `it`/`test` calls and parse top-level arguments to avoid
    // false positives from numeric literals inside nested expressions (e.g., expect(..., 5)).
    const callRe = /\b(it|test)\s*\(/g;

    function extractCallArgs(src, startIdx) {
      // startIdx points at the opening paren after `it` or `test`
      let i = startIdx;
      let depth = 1; // we are after '('
      const len = src.length;
      let argStart = i + 1;
      const args = [];
      let inString = null;
      let escape = false;
      let bracketDepth = 0;

      for (i = startIdx + 1; i < len; i++) {
        const ch = src[i];
        if (inString) {
          if (escape) { escape = false; continue; }
          if (ch === '\\') { escape = true; continue; }
          if (ch === inString) { inString = null; }
          continue;
        }
        if (ch === '"' || ch === "'" || ch === '`') { inString = ch; continue; }
        if (ch === '(') { depth++; continue; }
        if (ch === ')') {
          depth--; if (depth === 0) { args.push(src.slice(argStart, i)); return args; } continue;
        }
        if (ch === '[' || ch === '{') { bracketDepth++; continue; }
        if (ch === ']' || ch === '}') { bracketDepth--; continue; }
        if (ch === ',' && depth === 1 && bracketDepth === 0) {
          args.push(src.slice(argStart, i)); argStart = i + 1; continue;
        }
      }
      return null; // unbalanced
    }

    for (const f of files) {
      // Skip this test file itself which contains examples and detection code
      if (f === path.basename(__filename)) continue;
      const p = path.join(testsDir, f);
      const src = fs.readFileSync(p, 'utf8');
      let m;
      callRe.lastIndex = 0;
      let fileOffenders = [];
      while ((m = callRe.exec(src)) !== null) {
        const parenIdx = m.index + m[0].length - 1; // index of '('
        const args = extractCallArgs(src, parenIdx);
        if (!args) continue;
        // Case 1: third arg is a numeric literal timeout: it('name', fn, 5000)
        if (args.length >= 3) {
          const last = args[2].trim();
          if (/^\d+$/.test(last)) fileOffenders.push({ call: m[0].trim(), timeout: last, reason: 'numeric third arg' });
          // Case 2: third arg is an object literal with a `timeout` property: it('name', fn, { timeout: 5000 })
          if (/^\{[\s\S]*\}$/.test(last)) {
            const timeoutMatch = last.match(/\btimeout\s*:\s*(\d+)/);
            if (timeoutMatch) fileOffenders.push({ call: m[0].trim(), timeout: timeoutMatch[1], reason: 'object timeout property' });
          }
        }
        // Case 3: chained .timeout(...) after the call: it('name', fn).timeout(5000)
        // Look ahead a short distance for '.timeout(' after the call
        const afterIdx = parenIdx + (args && args[0] ? args[0].length : 0);
        const look = src.slice(parenIdx, parenIdx + 200);
        const chainMatch = look.match(/\)\s*\.\s*timeout\s*\(\s*(\d+)\s*\)/);
        if (chainMatch) fileOffenders.push({ call: m[0].trim(), timeout: chainMatch[1], reason: 'chained .timeout' });
      }

      // Global overrides: vi.setTimeout(5000) or jest.setTimeout(5000)
      const globalSetTimeoutRe = /\b(vi|jest)\.setTimeout\s*\(\s*(\d+)\s*\)/g;
      let gs;
      while ((gs = globalSetTimeoutRe.exec(src)) !== null) {
        fileOffenders.push({ file: f, call: gs[0], timeout: gs[2], reason: 'global setTimeout' });
      }

      // Detect spawnSync/execSync options with `timeout` property in tests; e.g. spawnSync(..., { timeout: 60000 })
      const childTimeoutRe = /\b(spawnSync|execSync)\s*\([^\)]{0,400}\btimeout\s*:\s*([\d][\d\s\*\+\-\/\(\)]*)\b/g;
      let ct;
      while ((ct = childTimeoutRe.exec(src)) !== null) {
        fileOffenders.push({ file: f, call: ct[0].slice(0,200), timeout: ct[2].trim(), reason: 'child spawn timeout' });
      }
      if (fileOffenders.length) offenders.push({ file: f, occurrences: fileOffenders });
    }

    if (offenders.length) {
      // Pretty-print offenders for triage
      const details = offenders.map(o => {
        const occ = o.occurrences.map(c => `${c.reason}: ${c.call} ... ${c.timeout}`).join('; ');
        return `${o.file}: ${occ}`;
      }).join('\n');
      const msg = `Found per-test numeric timeouts in tests:\n${details}\n` +
        `Please remove per-test numeric timeouts and rely on global vitest timeout in configuration.`;
      // Throw to ensure the failure message appears in test output
      throw new Error(msg);
    }
    expect(offenders.length).toBe(0);
  });
});
