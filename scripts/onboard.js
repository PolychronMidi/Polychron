#!/usr/bin/env node
const fs = require('fs');
const { execSync } = require('child_process');

// Onboarding helper: ensures README and TODO quick checklist
const todoPath = 'TODO.md';
if (!fs.existsSync(todoPath)) {
  console.log('No TODO.md found; creating one with `npm run todo`');
  try {
    execSync('npm run todo', { stdio: 'inherit' });
  } catch (e) {
    console.warn('Failed to run `npm run todo`; please run it manually.');
  }
} else {
  console.log('TODO.md already exists; nothing to do.');
}

console.log('\nQuick onboarding checklist:');
console.log('- Review and follow RULES.md religiously');
console.log('- Add all discussed tasks to TODO.md, tracking updates according to RULES.md');
console.log('- Run `npm run test` after major changes, avoiding repeat test runs instead of parsing /logs');
console.log('- Only when all tasks are done, run `npm run am-i-done` before reporting progress outside of TODO.md');
