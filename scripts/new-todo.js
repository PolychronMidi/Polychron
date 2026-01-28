#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const formatDate = require('./utils/formatDate.js');
const makeTemplate = require('./utils/TODO-template.js');
const getFailuresFromLog = require('./utils/getFailuresFromLog.js').getFailuresFromLog;

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
async function main() {
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
    console.log(`${path.relative(projectRoot, todoPath)} already exists — will append failures if any.`);
  }

  const statusBlock = getInitialStatusBlock();
  // Keep the canonical template at the top of the file as a format reminder; insert the status block *after* the template separator
  const content = HEADER + '\n' + statusBlock + '\n\n';
  fs.writeFileSync(todoPath, content, 'utf8');
  console.log((fs.existsSync(todoPath) ? 'Created' : 'Wrote') + `: ${path.relative(projectRoot, todoPath)}`);

  // If a test log exists, parse failures and append them to the bottom of the TODO file
  try {
    const logPath = path.join(projectRoot, 'log', 'test.log');
    if (fs.existsSync(logPath)) {
      try {
        const failures = getFailuresFromLog(projectRoot);

        if (failures.length > 0) {
          const seen = new Set();
          const linesToAppend = ['\n\n## Test Failures (from log/test.log)\n'];
          for (const f of failures) {
            const primary = (f.locs && f.locs[0]) || null;
            const locStr = primary ? `${primary.path}:${primary.line}${primary.col ? `:${primary.col}` : ''}` : (f.file || 'unknown');
            const key = `${locStr}|${f.desc}|${f.msg}`;
            if (seen.has(key)) continue;
            seen.add(key);

            // Summary line
            linesToAppend.push(`- [ ] **${locStr}** — ${f.desc}`);



            if (f.snippet) {
              // Trim leading/trailing blank lines in the snippet for compactness
              let start = f.snippet.startLine;
              let lines = f.snippet.lines.slice();
              while (lines.length && lines[0].trim() === '') { lines.shift(); start++; }
              while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
              const end = start + lines.length - 1;
              linesToAppend.push('', `\`\`\` js (lines ${start}-${end})`);
              for (const l of lines) linesToAppend.push(`     ${l}`);
              linesToAppend.push('```', '');
            }

            linesToAppend.push('');
          }

          fs.appendFileSync(todoPath, linesToAppend.join('\n') + '\n', 'utf8');
          console.log(`Appended ${seen.size} test failure(s) from log/test.log to ./${path.relative(projectRoot, todoPath)}`);
        } else {
          console.log('No test failures found in log/test.log to append.');
        }
      } catch (e) {
        console.error('Failed to detect test failures from log/test.log:', e && e.message ? e.message : e);
      }
    }
  } catch (e) {
    console.error('Warning: failed to parse or append test log:', e && e.message ? e.message : e);
  }}

main();
