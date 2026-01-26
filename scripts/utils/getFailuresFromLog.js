const stripAnsi = require('./stripAnsi.js');
const readLogSafe = require('./readLogSafe.js');
const fs = require('fs');
const path = require('path');

// Regex to find file:line[:col] locations in stacks/lines, supporting Windows and POSIX paths and various extensions
const LOC_RE = /([A-Za-z]:\\[^\s:()]+|(?:\.\/|\.\.\/|\/)?[^\s:()]+?\.(?:ts|js|mjs|cjs|tsx|jsx)):(\d+)(?::(\d+))?/g;
const ERROR_LINE_RE = /^([A-Za-z0-9_]+Error|AssertionError|Error|TypeError):\s*(.+)$/;

function tryParseLocFromString(s) {
  const m = s.match(/([A-Za-z]:\\[^\s:()]+|(?:\.\/|\.\.\/|\/)?[^\s:()]+?\.(?:ts|js|mjs|cjs|tsx|jsx)):(\d+)(?::(\d+))?/);
  if (!m) return null;
  return { path: m[1], line: Number(m[2]), col: m[3] ? Number(m[3]) : null };
}

function makeSnippet(projectRoot, loc, ctx = 2) {
  if (!loc || !loc.path || !loc.line) return null;
  // Resolve path: if absolute, use as-is; else try projectRoot-relative
  let p = loc.path;
  // Normalize leading ./ or ../
  if (!path.isAbsolute(p)) {
    p = path.join(projectRoot, p);
  }
  if (!fs.existsSync(p)) return null;

  const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
  const idx = Math.max(0, Math.min(lines.length - 1, loc.line - 1));
  const start = Math.max(0, idx - ctx);
  const end = Math.min(lines.length - 1, idx + ctx);
  return {
    path: path.relative(projectRoot, p),
    startLine: start + 1,
    lines: lines.slice(start, end + 1),
  };
}

function gatherStackBlock(lines, startIndex, maxLines = 200) {
  const block = [];
  for (let j = startIndex; j < Math.min(lines.length, startIndex + maxLines); j++) {
    const l = lines[j];
    if (l.trim() === '') {
      // allow empty lines but continue until a clear separator like '●' or 'FAIL' or '---'
      // break only if we see a test separator
      if (/^\s*-{3,}|^\s*FAIL\b|^\s*●/i.test(lines[j + 1] || '')) break;
    }
    block.push(l);
    // stop when we encounter another top-level test header
    if (/^\s*(OK|FAIL)\b/.test(lines[j + 1] || '')) break;
  }
  return block.join('\n');
}

/**
 * Parse failures from the test log and return an array of objects
 * { file, locs: [{path,line,col}], desc, msg, stack, snippet }
 * Accepts an optional projectRoot (defaults to process.cwd()) so callers can override in tests.
 */
function getFailuresFromLog(projectRoot = process.cwd()) {
  const raw = readLogSafe(projectRoot, 'test.log');
  if (!raw || !raw.trim()) return [];
  const clean = stripAnsi(raw);
  const lines = clean.split(/\r?\n/);
  const failures = [];

  function pushFail(o) {
    const key = `${o.desc}|${o.msg}|${(o.locs && o.locs[0] && `${o.locs[0].path}:${o.locs[0].line}`) || ''}`;
    if (!failures.some(f => `${f.desc}|${f.msg}|${(f.locs && f.locs[0] && `${f.locs[0].path}:${f.locs[0].line}`) || ''}` === key)) failures.push(o);
  }

  // Find explicit FAIL markers
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const failMatch = line.match(/\bFAIL\b\s+(\S+)\s*>\s*(.+)$/i);
    if (failMatch) {
      const file = failMatch[1];
      const desc = failMatch[2].trim().replace(/\s+/g, ' ');
      const stack = gatherStackBlock(lines, i + 1);
      let msg = '';
      const locs = [];
      let m;
      while ((m = LOC_RE.exec(stack))) {
        locs.push({ path: m[1], line: Number(m[2]), col: m[3] ? Number(m[3]) : null });
      }
      // find error message line if present
      const stackLines = stack.split(/\r?\n/);
      for (let sl of stackLines) {
        const em = sl.match(ERROR_LINE_RE);
        if (em) { msg = em[0]; break; }
      }
      const snippet = locs[0] ? makeSnippet(projectRoot, locs[0]) : null;
      pushFail({ file, locs, desc, msg, stack, snippet });
    }
  }

  // Also look for vitest stdout/stderr test headers and aggregate following error messages
  const testLineRe = /(?:stdout|stderr)\s*\|\s*(\S+)\s*>\s*(.+)$/i;
  for (let i = 0; i < lines.length; i++) {
    const mLine = lines[i].match(testLineRe);
    if (mLine) {
      const file = mLine[1];
      const segments = mLine[2].split('>');
      const desc = segments.map(s => s.trim()).filter(Boolean).slice(-1)[0] || segments[0].trim();
      const stack = gatherStackBlock(lines, i + 1);
      let msg = '';
      const locs = [];
      let m;
      while ((m = LOC_RE.exec(stack))) {
        locs.push({ path: m[1], line: Number(m[2]), col: m[3] ? Number(m[3]) : null });
      }
      const stackLines = stack.split(/\r?\n/);
      for (let sl of stackLines) {
        const em = sl.match(ERROR_LINE_RE);
        if (em) { msg = em[0]; break; }
      }
      const isAssertion = /AssertionError|should|expected|assert/i.test(msg);
      const inTestFile = Boolean(locs.length && /(?:<repo>.*[/\\]test|\.test\.(?:ts|js))/i.test(locs[0].path));
      if (isAssertion || inTestFile) {
        const snippet = locs[0] ? makeSnippet(projectRoot, locs[0]) : null;
        pushFail({ file, locs, desc: desc.replace(/\s+/g, ' '), msg, stack, snippet });
      }
    }
  }

  return failures;
}

module.exports = { getFailuresFromLog };
