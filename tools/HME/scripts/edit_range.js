// Compute [start_line, end_line] (1-based, inclusive) of an Edit/Write
// against its target file. Used by pretooluse_edit.sh to record precise
// edited ranges in tmp/hme-turn-edits.txt so read_policy.js can allow
'use strict';

const fs = require('fs');

function main() {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => (raw += c));
  process.stdin.on('end', () => {
    let input;
    try { input = JSON.parse(raw); } catch (_e) { process.stdout.write('0 0\n'); process.exit(0); }
    const file = input && (input.file_path || input.path) || '';
    const old = input && typeof input.old_string === 'string' ? input.old_string : '';
    if (!file || !old) { process.stdout.write('0 0\n'); process.exit(0); }
    let content;
    try { content = fs.readFileSync(file, 'utf8'); } catch (_e) { process.stdout.write('0 0\n'); process.exit(0); }
    const idx = content.indexOf(old);
    if (idx < 0) { process.stdout.write('0 0\n'); process.exit(0); }
    let start = 1;
    for (let i = 0; i < idx; i++) if (content.charCodeAt(i) === 0x0a) start++;
    let end = start;
    for (let i = 0; i < old.length; i++) if (old.charCodeAt(i) === 0x0a) end++;
    process.stdout.write(`${start} ${end}\n`);
  });
}

main();
