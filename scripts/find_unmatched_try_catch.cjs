const fs = require('fs');
const s = fs.readFileSync('src/time.ts','utf8');
const finds = [];
for (let i = 0; i < s.length; i++) {
  if (s.slice(i, i+4) === 'try ') {
    // ensure this is 'try {' after optional whitespace
    const rest = s.slice(i, i+20);
    const m = s.slice(i).match(/^try\s*\{/);
    if (m) {
      finds.push(i);
    }
  } else if (s.slice(i, i+4) === 'try{') {
    finds.push(i);
  } else if (s.slice(i, i+4) === 'try\n' /* not likely */) {
    // ignore
  }
}

function findClosingBrace(startIdx) {
  let depth = 0;
  for (let i = startIdx; i < s.length; i++) {
    const c = s[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

const lines = s.split('\n');
for (const idx of finds) {
  const line = s.slice(0, idx).split('\n').length;
  // find opening brace index
  const openIdx = s.indexOf('{', idx);
  const closeIdx = findClosingBrace(openIdx);
  if (closeIdx === -1) {
    console.log('try at line', line, 'has no closing brace');
    continue;
  }
  // find next non-whitespace token after closeIdx
  const after = s.slice(closeIdx+1).trimStart();
  const next = after.slice(0,6);
  const nextLine = s.slice(0, closeIdx).split('\n').length;
  if (next.startsWith('catch') || next.startsWith('finally')) {
    // matched
  } else {
    console.log('try at line', line, 'closing brace at line', nextLine, 'next token', next.slice(0,20));
  }
}
