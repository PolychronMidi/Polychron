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
      const logText = fs.readFileSync(logPath, 'utf8');
      const lines = logText.split(/\r?\n/);
      // Strip ANSI sequences (colors/formatting) for reliable regex matching
      const stripAnsi = s => s.replace(/\x1b\[[0-9;]*m/g, '');
      const cleanLines = lines.map(l => stripAnsi(l));

      const failures = [];
      // First, try to detect explicit FAIL lines (some reporters)
      for (let i = 0; i < cleanLines.length; i++) {
        const line = cleanLines[i];
        const failMatch = line.match(/\bFAIL\b\s+(\S+)\s*>\s*(.+)$/i);
        if (failMatch) {
          const file = failMatch[1];
          const desc = failMatch[2].trim().replace(/\s+/g, ' ');
          // look ahead for error message and location markers
          let msg = '';
          let loc = '';
          for (let j = i + 1; j < Math.min(cleanLines.length, i + 30); j++) {
            const lraw = cleanLines[j];
            const l = lraw.trim();
            if (!loc) {
              const locMatch = lraw.match(/❯\s*(\S+:\d+:\d+)/);
              if (locMatch) loc = locMatch[1];
            }
            if (!msg) {
              const errMatch = l.match(/^([A-Za-z0-9_]+Error|AssertionError|Error):\s*(.+)$/);
              if (errMatch) { msg = errMatch[0]; break; }
            }
          }
          if (!msg) {
            for (let j = i + 1; j < Math.min(cleanLines.length, i + 10); j++) {
              const l = cleanLines[j].trim();
              if (l && !/^stdout|^\[|^·/.test(l)) { msg = l.replace(/\s+/g, ' '); break; }
            }
          }
          failures.push({ file, loc, desc, msg });
        }
      }

      // Second, detect vitest-style stdout/stderr lines that include the test file and description,
      // followed shortly by an Error/Assertion message or stack trace.
      const testLineRe = /(?:stdout|stderr)\s*\|\s*(\S+)\s*>\s*(.+)$/i;
      for (let i = 0; i < cleanLines.length; i++) {
        const m = cleanLines[i].match(testLineRe);
        if (m) {
          const file = m[1];
          // description may include multiple '>' segments; use the last segment after '>' as the test name
          const segments = m[2].split('>');
          const desc = segments.map(s => s.trim()).filter(Boolean).slice(-1)[0] || segments[0].trim();

          // look ahead for an Error/TypeError/Assertion message within the next 20 lines
          let msg = '';
          let loc = '';
          for (let j = i + 1; j < Math.min(cleanLines.length, i + 40); j++) {
            const lraw = cleanLines[j];
            const l = lraw.trim();
            if (!l) continue;
            if (!loc) {
              const locMatch = lraw.match(/(\S+\.ts:\d+:\d+)/);
              if (locMatch) loc = locMatch[1];
            }
            const errMatch = l.match(/^([A-Za-z0-9_]+Error|AssertionError|Error|TypeError):\s*(.+)$/);
            if (errMatch) { msg = errMatch[0]; break; }
            const inlineErr = l.match(/Error:\s*(.+)/);
            if (inlineErr) { msg = `Error: ${inlineErr[1]}`; break; }
            if (cleanLines[j].match(testLineRe)) break;
          }

          if (msg) {
            failures.push({ file, loc, desc: desc.replace(/\s+/g, ' '), msg });
          }
        }
      }

      if (failures.length > 0) {
        // Deduplicate
        const seen = new Set();
        const linesToAppend = ['\n\n## Test Failures (from log/test.log)\n'];
        for (const f of failures) {
          const key = `${f.file}|${f.loc}|${f.desc}|${f.msg}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const locPart = f.loc ? `${f.loc}` : f.file;
          const msgPart = f.msg ? ` — ${f.msg}` : '';
          linesToAppend.push(`- [ ] ${locPart} — ${f.desc}${msgPart}`);
        }
        fs.appendFileSync(todoPath, linesToAppend.join('\n') + '\n', 'utf8');
        console.log(`Appended ${seen.size} test failure(s) from log/test.log to ${path.relative(projectRoot, todoPath)}`);
      } else {
        console.log('No test failures found in log/test.log to append.');
      }
    }
  } catch (e) {
    console.error('Warning: failed to parse or append test log:', e && e.message ? e.message : e);
  }
}

main();
