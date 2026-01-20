#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const projectRoot = process.cwd();
const todoPath = process.env.ONBOARD_TEST_TODO ? path.resolve(process.cwd(), process.env.ONBOARD_TEST_TODO) : path.join(projectRoot, 'TODO.md');

const HEADER = `### TODO TEMPLATE (Leave this template at top of file as format reminder)

*** [MM/DD HH:MM] Example (newest) TODO Title - One sentence summary.
- [MM/DD HH:MM] Timestamped note of latest development or roadblock for this TODO
- [MM/DD HH:MM] Older timestamped notes for this TODO

*** [MM/DD HH:MM] Example Todo #2 (older) , start actual TODO list below like in formart shown here.
- [MM/DD HH:MM] Remember to revisit the TODO often, always adding/updating timestamps at line starts.
---

`;

function formatDateMMDDYY() {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const yy = String(now.getFullYear()).slice(-2);
  return `${mm}/${dd}/${yy}`;
}

function getInitialStatusBlock() {
  const readmePath = path.join(projectRoot, 'README.md');
  const start = '<!-- BEGIN: test-status -->';
  const end = '<!-- END: test-status -->';

  let readme = '';
  if (fs.existsSync(readmePath)) readme = fs.readFileSync(readmePath, 'utf8');

  // If README doesn't have the test-status block, run the docs status updater to generate it
  if (!readme.includes(start)) {
    try {
      execSync('node scripts/docs.mjs status', { stdio: 'ignore' });
      if (fs.existsSync(readmePath)) readme = fs.readFileSync(readmePath, 'utf8');
    } catch (e) {
      // ignore; we'll fallback to a minimal line
    }
  }

  if (readme.includes(start) && readme.includes(end)) {
    let block = readme.slice(readme.indexOf(start) + start.length, readme.indexOf(end)).trim();
    block = block.replace(/Latest Status/, 'Initial status (this TODO is NOT DONE until Latest Status shows all scores equal or better than initial.)');
    return block;
  }

  // Fallback minimal block
  const dateStr = formatDateMMDDYY();
  return `${dateStr} - Initial status (this TODO is NOT DONE until Latest Status shows all scores equal or better than initial.)\n- Tests data unavailable\n- Lint data unavailable\n- Type-check data unavailable\n- Coverage data unavailable`;
}

function usage() {
  console.log('Usage: node scripts/new-todo.mjs');
  console.log('Creates TODO.md at repo root with the canonical TODO template at the top.');
}

function main() {
  const args = process.argv.slice(2);

  if (fs.existsSync(todoPath)) {
    console.error(`Error: TODO.md already exists at ${todoPath}. Update the existing TODO.md instead of creating a new one.`);
    process.exit(1);
  }

  const statusBlock = getInitialStatusBlock();
  // Keep the canonical template at the top of the file as a format reminder; insert the status block *after* the template separator
  const content = HEADER + '\n' + statusBlock + '\n\n';
  fs.writeFileSync(todoPath, content, 'utf8');
  console.log((fs.existsSync(todoPath) ? 'Created' : 'Wrote') + `: ${path.relative(projectRoot, todoPath)}`);
}

main();
