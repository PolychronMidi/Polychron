const fs = require('fs');
const s = fs.readFileSync('src/time.ts','utf8');
const lines = s.split('\n');
let depth = 0;
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  for (let j = 0; j < line.length; j++) {
    const c = line[j];
    if (c === '{') depth++;
    else if (c === '}') depth--;
  }
  if (i % 20 === 0 || depth < 0 || depth > 5) console.log((i+1)+': depth='+depth+' | '+line);
}
console.log('final depth', depth);
