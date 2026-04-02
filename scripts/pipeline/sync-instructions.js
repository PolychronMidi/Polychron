#!/usr/bin/env node
// sync-instructions.js - Keeps CLAUDE.md and copilot-instructions.md in sync.
// Whichever was modified more recently wins. Run as part of the pipeline.

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../..');
const files = [
  path.join(root, 'CLAUDE.md'),
  path.join(root, '.github', 'copilot-instructions.md')
];

// Ensure both exist (bootstrap CLAUDE.md from copilot-instructions if missing)
const exists = files.map(f => fs.existsSync(f));
if (!exists[0] && !exists[1]) {
  console.error('sync-instructions: neither CLAUDE.md nor copilot-instructions.md exists');
  process.exit(1);
}
if (!exists[0] && exists[1]) {
  fs.copyFileSync(files[1], files[0]);
  console.log(`sync-instructions: created ${files[0]} from ${files[1]}`);
  process.exit(0);
}
if (exists[0] && !exists[1]) {
  fs.mkdirSync(path.dirname(files[1]), { recursive: true });
  fs.copyFileSync(files[0], files[1]);
  console.log(`sync-instructions: created ${files[1]} from ${files[0]}`);
  process.exit(0);
}

// Both exist -- compare
const content0 = fs.readFileSync(files[0], 'utf8');
const content1 = fs.readFileSync(files[1], 'utf8');

if (content0 === content1) {
  console.log('sync-instructions: in sync');
  process.exit(0);
}

// Different -- newer wins
const mtime0 = fs.statSync(files[0]).mtimeMs;
const mtime1 = fs.statSync(files[1]).mtimeMs;

if (mtime0 > mtime1) {
  fs.copyFileSync(files[0], files[1]);
  console.log(`sync-instructions: ${files[1]} updated from ${files[0]}`);
} else {
  fs.copyFileSync(files[1], files[0]);
  console.log(`sync-instructions: ${files[0]} updated from ${files[1]}`);
}
