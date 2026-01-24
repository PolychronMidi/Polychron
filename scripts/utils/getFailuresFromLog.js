import stripAnsi from './stripAnsi.js';
import readLogSafe from './readLogSafe.js';

/**
 * Parse failures from the test log and return an array of objects { file, loc, desc, msg }
 * Accepts an optional projectRoot (defaults to process.cwd()) so callers can override in tests.
 */
export function getFailuresFromLog(projectRoot = process.cwd()) {
  const raw = readLogSafe(projectRoot, 'test.log');
  if (!raw || !raw.trim()) return [];
  const clean = stripAnsi(raw);
  const lines = clean.split(/\r?\n/);
  const failures = [];
  function pushFail(o) {
    const key = `${o.file}|${o.loc}|${o.desc}|${o.msg}`;
    if (!failures.some(f => `${f.file}|${f.loc}|${f.desc}|${f.msg}` === key)) failures.push(o);
  }

  // Find explicit FAIL markers
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const failMatch = line.match(/\bFAIL\b\s+(\S+)\s*>\s*(.+)$/i);
    if (failMatch) {
      const file = failMatch[1];
      const desc = failMatch[2].trim().replace(/\s+/g, ' ');
      let msg = '';
      let loc = '';
      for (let j = i + 1; j < Math.min(lines.length, i + 40); j++) {
        const l = lines[j].trim();
        if (!loc) {
          const locMatch = lines[j].match(/(\S+\.(?:ts|js):\d+:\d+)/);
          if (locMatch) loc = locMatch[1];
        }
        const errMatch = l.match(/^([A-Za-z0-9_]+Error|AssertionError|Error|TypeError):\s*(.+)$/);
        if (errMatch) { msg = errMatch[0]; break; }
      }
      pushFail({ file, loc, desc, msg });
    }
  }

  // Also look for vitest stdout/stderr test headers and aggregate following error messages
  const testLineRe = /(?:stdout|stderr)\s*\|\s*(\S+)\s*>\s*(.+)$/i;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(testLineRe);
    if (m) {
      const file = m[1];
      const segments = m[2].split('>');
      const desc = segments.map(s => s.trim()).filter(Boolean).slice(-1)[0] || segments[0].trim();
      let msg = '';
      let loc = '';
      for (let j = i + 1; j < Math.min(lines.length, i + 40); j++) {
        const l = lines[j].trim(); if (!l) continue;
        if (!loc) {
          const locMatch = lines[j].match(/(\S+\.(?:ts|js):\d+:\d+)/);
          if (locMatch) loc = locMatch[1];
        }
        const errMatch = l.match(/^([A-Za-z0-9_]+Error|AssertionError|Error|TypeError):\s*(.+)$/);
        if (errMatch) { msg = errMatch[0]; break; }
      }
      if (msg) {
        // Only treat this as an actual test failure when the message appears to be an assertion
        // or when a stack/location inside a test file is present.
        const isAssertion = /AssertionError|should|expected|assert/i.test(msg);
        const inTestFile = Boolean(loc && /(?:<repo>.*[/\\]test|\.test\.(?:ts|js))/i.test(loc));
        if (isAssertion || inTestFile) pushFail({ file, loc, desc: desc.replace(/\s+/g, ' '), msg });
      }
    }
  }

  return failures;
}
