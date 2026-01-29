const fs = require('fs');
const path = require('path');
const testsDir = path.join(process.cwd(), 'test');
const files = fs.readdirSync(testsDir).filter(f => f.endsWith('.js') || f.endsWith('.ts'));
const callRe = /\b(it|test)\s*\(/g;
function extractCallArgs(src, startIdx) {
  let i = startIdx;
  let depth = 1;
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
    if (ch === ')') { depth--; if (depth === 0) { args.push(src.slice(argStart, i)); return args; } continue; }
    if (ch === '[' || ch === '{') { bracketDepth++; continue; }
    if (ch === ']' || ch === '}') { bracketDepth--; continue; }
    if (ch === ',' && depth === 1 && bracketDepth === 0) { args.push(src.slice(argStart, i)); argStart = i + 1; continue; }
  }
  return null;
}
const offenders = [];
for (const f of files) {
  if (f === 'no-per-test-timeouts.test.js') continue;
  const p = path.join(testsDir, f);
  const src = fs.readFileSync(p, 'utf8');
  let m;
  callRe.lastIndex = 0;
  let fileOffenders = [];
  while ((m = callRe.exec(src)) !== null) {
    const parenIdx = m.index + m[0].length -1;
    const args = extractCallArgs(src, parenIdx);
    if (!args) continue;
    if (args.length >= 3) {
      const last = args[2].trim();
      if (/^\d+$/.test(last)) fileOffenders.push({ call: m[0].trim(), timeout: last, reason: 'numeric third arg' });
      if (/^\{[\s\S]*\}$/.test(last)) {
        const timeoutMatch = last.match(/\btimeout\s*:\s*(\d+)/);
        if (timeoutMatch) fileOffenders.push({ call: m[0].trim(), timeout: timeoutMatch[1], reason: 'object timeout property' });
      }
    }
    const look = src.slice(parenIdx, parenIdx + 200);
    const chainMatch = look.match(/\)\s*\.\s*timeout\s*\(\s*(\d+)\s*\)/);
    if (chainMatch) fileOffenders.push({ call: m[0].trim(), timeout: chainMatch[1], reason: 'chained .timeout' });
  }
  const globalSetTimeoutRe = /\b(vi|jest)\.setTimeout\s*\(\s*(\d+)\s*\)/g;
  let gs;
  while ((gs = globalSetTimeoutRe.exec(src)) !== null) {
    fileOffenders.push({ file: f, call: gs[0], timeout: gs[2], reason: 'global setTimeout' });
  }
  const childTimeoutRe = /\b(spawnSync|execSync)\s*\([^\)]{0,400}\btimeout\s*:\s*([\d][\d\s\*\+\-\/\(\)]*)\b/g;
  let ct;
  while ((ct = childTimeoutRe.exec(src)) !== null) {
    fileOffenders.push({ file: f, call: ct[0].slice(0,200), rawTimeout: ct[2] || null, reason: 'child spawn timeout' });
  }
  if (fileOffenders.length) offenders.push({ file: f, occurrences: fileOffenders });
}
console.log(JSON.stringify(offenders, null, 2));
process.exit(0);
