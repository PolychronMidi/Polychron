#!/usr/bin/env node
/**
 * Check whether TODO tasks are done according to their Initial Status blocks.
 * Compares each TODO-*.md initial status against the latest status in README.md.
 * If Tests (passed/total) and Coverage (lines %) in README are >= Initial values,
 * a success message is printed. Otherwise, a violation message is printed.
 */

import fs from 'fs';
import path from 'path';

const projectRoot = process.cwd();
const readmePath = path.join(projectRoot, 'README.md');

function extractStatusBlockFromReadme(content) {
  const start = '<!-- BEGIN: test-status -->';
  const end = '<!-- END: test-status -->';
  const si = content.indexOf(start);
  const ei = content.indexOf(end);
  if (si === -1 || ei === -1) return null;
  return content.slice(si + start.length, ei).trim();
}

function extractInitialStatusFromTodo(content) {
  // The Initial status block uses the phrase "Initial status" (from new-todo).
  const m = content.match(/Initial status[\s\S]*?(?:\n\s*\n|$)/i);
  if (m) return m[0].trim();
  // Fallback: try to find the first block that looks like a status (date line followed by - Tests ...)
  const fallback = content.split('\n').slice(0, 12).join('\n');
  const ok = /Tests\s+\d+/i.test(fallback);
  return ok ? fallback : null;
}

function parseStatusText(block) {
  // Parse Tests line: - Tests 1282/1282 - 100%
  const lines = block.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const res = { tests: null, lint: null, type: null, coverage: null };

  for (const line of lines) {
    let m;
    if ((m = line.match(/Tests\s+(\d+)\/(\d+)\s*-\s*([0-9.]+)%/i))) {
      res.tests = { passed: Number(m[1]), total: Number(m[2]), pct: Number(m[3]) };
      continue;
    }
    if ((m = line.match(/Tests\s+(\d+)\/(\d+)/i))) {
      res.tests = { passed: Number(m[1]), total: Number(m[2]), pct: null };
      continue;
    }
    if ((m = line.match(/Lint\s+(\d+)\s+errors?\s*\/\s*(\d+)\s+warnings?/i))) {
      res.lint = { errors: Number(m[1]), warnings: Number(m[2]) };
      continue;
    }
    if ((m = line.match(/Type-check\s+(\d+)\s+errors?\s*\/\s*(\d+)\s+warnings?/i))) {
      res.type = { errors: Number(m[1]), warnings: Number(m[2]) };
      continue;
    }
    // Coverage lines: could be "Coverage 75.4% (Statements: ... Lines: 75.4% Branches: ... Functions: ... )"
    if ((m = line.match(/Coverage\s+([0-9.]+)%/i))) {
      const overall = Number(m[1]);
      const linesM = line.match(/Lines:\s*([0-9.]+)%/i);
      const linesPct = linesM ? Number(linesM[1]) : null;
      res.coverage = { overall, lines: linesPct };
      continue;
    }
    // Alternate: "- Coverage 75.4% (Statements: 74.7% Lines: 75.4% Branches: 56.9% Functions: 74.1%)"
    const covM = line.match(/Lines:\s*([0-9.]+)%/i);
    if (covM) {
      res.coverage = res.coverage || {};
      res.coverage.lines = Number(covM[1]);
      continue;
    }
  }

  return res;
}

function readLatestStatus() {
  if (!fs.existsSync(readmePath)) return null;
  const content = fs.readFileSync(readmePath, 'utf8');
  const block = extractStatusBlockFromReadme(content);
  if (!block) return null;
  return parseStatusText(block);
}

function readTodoInitialStatus(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const block = extractInitialStatusFromTodo(content);
  if (!block) return null;
  return parseStatusText(block);
}

function gatherTodoFiles() {
  const files = fs.readdirSync(projectRoot).filter(f => /^TODO.*\.md$/i.test(f));
  return files.map(f => path.join(projectRoot, f));
}

function compareMetrics(initial, latest) {
  // For each metric that exists in initial and is numeric, ensure latest >= initial.
  const result = { ok: true, reasons: [] };

  if (initial.tests) {
    if (!latest.tests) {
      result.ok = false; result.reasons.push('Latest tests data missing');
    } else {
      if (latest.tests.total < initial.tests.total) {
        result.ok = false; result.reasons.push(`Tests total decreased: initial ${initial.tests.total} -> latest ${latest.tests.total}`);
      }
      if (latest.tests.passed < initial.tests.passed) {
        result.ok = false; result.reasons.push(`Tests passed decreased: initial ${initial.tests.passed} -> latest ${latest.tests.passed}`);
      }
    }
  }

  if (initial.coverage && initial.coverage.lines != null) {
    if (!latest.coverage || latest.coverage.lines == null) {
      result.ok = false; result.reasons.push('Latest coverage (lines %) missing');
    } else if (latest.coverage.lines < initial.coverage.lines) {
      result.ok = false; result.reasons.push(`Coverage lines decreased: initial ${initial.coverage.lines}% -> latest ${latest.coverage.lines}%`);
    }
  }

  return result;
}

function main() {
  const latest = readLatestStatus();
  if (!latest) {
    console.error('Could not read Latest Status from README.md');
    process.exit(2);
  }

  const todoFiles = gatherTodoFiles();
  if (todoFiles.length === 0) {
    console.log('No TODO-*.md files found in repo root. Nothing to check.');
    process.exit(0);
  }

  let anyViolation = false;

  for (const f of todoFiles) {
    const name = path.basename(f);
    const content = fs.readFileSync(f, 'utf8');

    // Check for canonical TODO header presence
    if (!content.includes('### TODO TEMPLATE')) {
      console.log(`${name}: TODO Protocol violation: Thoroughly review RULES.md.`);
      anyViolation = true;
      continue;
    }

    const initial = readTodoInitialStatus(f);
    if (!initial) {
      console.log(`${name}: No initial status block found; skipping.`);
      continue;
    }

    const cmp = compareMetrics(initial, latest);
    if (cmp.ok) {
      console.log(`${name}: If all your TODOs in ${name} are marked complete and all protocols in RULES.md followed throughout, this task is complete!`);
    } else {
      anyViolation = true;
      console.log(`${name}: You have violated protocol (review RULES.md) - restore Latest Status to at least as good as Initial Status, then move on with TODO tasks.`);
      console.log('  Reasons:');
      for (const r of cmp.reasons) console.log('   - ' + r);
    }
  }

  process.exit(anyViolation ? 1 : 0);
}

if (import.meta.url === `file://${process.cwd().replace(/\\/g, '/')}/scripts/am-i-done.js`) {
  main();
} else if (process.argv[1] && process.argv[1].endsWith('am-i-done.js')) {
  main();
}
