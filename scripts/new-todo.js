#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import formatDate from './utils/formatDate.js';

const dateStr = formatDate();
const projectRoot = process.cwd();

/**
 * Sanitize a user-provided name into a safe filename segment.
 * - spaces -> dashes
 * - remove unsafe characters
 * @param {string} raw
 * @returns {string}
 */
function sanitizeName(raw) {
  return raw.trim().replace(/\s+/g, '-').replace(/[^a-zA-Z0-9._-]/g, '-');
}

import makeTemplate from './utils/TODO-template.js';

const HEADER = makeTemplate(dateStr);

/**
 * Generate an initial status block from README test-status block (or minimal fallback).
 * @returns {string} Initial status summary to insert into TODO.md
 */
function getInitialStatusBlock() {
  const readmePath = path.join(projectRoot, 'README.md');
  const start = '<!-- BEGIN: test-status -->';
  const end = '<!-- END: test-status -->';

  let readme = '';
  if (fs.existsSync(readmePath)) readme = fs.readFileSync(readmePath, 'utf8');

  // If README doesn't have the test-status block, run the docs status updater to generate it
  if (!readme.includes(start)) {
    try {
      execSync('node scripts/docs.js status', { stdio: 'ignore' });
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

  console.error('Warning: README.md does not contain a test-status block. Initial status will be minimal.');
  return 'Initial status: No detailed status available.';
}

/**
 * Print usage for this CLI.
 */
function usage() {
  console.log('Usage: node scripts/new-todo.js [name]');
  console.log('Creates TODO.md (default) or TODO-<name>.md at repo root when [name] provided (e.g., `npm run todo things` creates TODO-things.md).');
}

/**
 * CLI entrypoint: create TODO.md with header and initial status block.
 */
function main() {
  const args = process.argv.slice(2);

  // Determine filename: default TODO.md, or TODO-<name>.md when a simple name is provided.
  let filename = 'TODO.md';
  if (args.length > 0 && args[0].trim()) {
    const raw = args[0].trim();
    if (raw.includes('/') || raw.includes('\\')) {
      // treat as relative path (allow explicit paths)
      filename = raw.endsWith('.md') ? raw : `${raw}.md`;
    } else {
      const clean = sanitizeName(raw);
      if (/^TODO[._-]/i.test(clean) || clean.toLowerCase().endsWith('.md')) {
        filename = clean.endsWith('.md') ? clean : `${clean}.md`;
      } else {
        filename = `TODO-${clean}.md`;
      }
    }
  }

  const todoPath = path.join(projectRoot, filename);

  if (fs.existsSync(todoPath)) {
    console.error(`Error: ${path.relative(projectRoot, todoPath)} already exists at ${todoPath}. Update the existing file instead of creating a new one.`);
    process.exit(1);
  }

  const statusBlock = getInitialStatusBlock();
  // Keep the canonical template at the top of the file as a format reminder; insert the status block *after* the template separator
  const content = HEADER + '\n' + statusBlock + '\n\n';
  fs.writeFileSync(todoPath, content, 'utf8');
  console.log((fs.existsSync(todoPath) ? 'Created' : 'Wrote') + `: ${path.relative(projectRoot, todoPath)}`);
}

main();
