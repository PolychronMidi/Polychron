#!/usr/bin/env node
import fs from 'fs';
import { execSync } from 'child_process';

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
console.log('- Run `npm run todo` to create a TODO if none exists');
console.log('- Implement your task and add timestamped notes to TODO.md');
console.log('- Run `npm run test` and `npm run docs:check` locally');
console.log('- Run `npm run am-i-done` before reporting completion');
