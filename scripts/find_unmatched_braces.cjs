const fs = require('fs');
const s = fs.readFileSync('src/time.js','utf8');
let stack = [];
let idx = -1;
for (let i = 0; i < s.length; i++) {
  const c = s[i];
  if (c === '{') stack.push(i);
  else if (c === '}') {
    if (stack.length === 0) {
      console.log('Unmatched } at index', i);
      process.exit(0);
    } else stack.pop();
  }
}
if (stack.length) idx = stack[stack.length - 1];
if (idx >= 0) {
  const before = s.slice(0, idx);
  const line = before.split('\n').length;
  console.log('Unmatched { at index', idx, 'line', line);
  const lines = s.split('\n');
  for (let i = Math.max(0, line - 5); i < Math.min(lines.length, line + 5); i++) {
    console.log((i + 1) + ':', lines[i]);
  }
} else console.log('All matched');
