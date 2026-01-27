/**
 * Run a command and stream stdout/stderr to a log file while mirroring it to the console.
 * Usage: node scripts/run-with-log.js <logFile> <command> [args...]
 * @module scripts/run-with-log
 */
const { spawn } = require('child_process');
const { createWriteStream } = require('fs');
const { mkdir } = require('fs/promises');
const stripAnsi = require('./utils/stripAnsi');
const path = require('path');

const cwd = process.cwd();
const [, , logFile, ...command] = process.argv;

if (!logFile || command.length === 0) {
  console.error('Usage: node scripts/run-with-log.js <logFile> <command> [args...]');
  process.exit(1);
} else {
  console.log(`Logging output to log/${logFile}`);
}

// Ensure log directory exists (async-safe)
mkdir('log', { recursive: true }).catch(() => {});

const logStream = createWriteStream(`log/${logFile}`);
const proc = spawn(command[0], command.slice(1), { shell: true, stdio: 'pipe' });

/**
 * Normalize a single line for the persistent log:
 * - Strip ANSI escapes
 * - Replace absolute repo paths with relative ones
 * - Shorten node_modules references
 * - Prefix with a timestamp and stream label (STDOUT/STDERR)
 */
function normalizeForLog(line, label = 'STDOUT') {
  let s = String(line || '');
  s = stripAnsi(s);
  // Collapse file:// prefixes that appear in stack traces
  s = s.replace(new RegExp('file:[\\/]{2,}', 'g'), '');
  // Replace absolute repository-root paths with a short <repo>/ prefix
  if (cwd && typeof s === 'string') {
    const safeCwd = cwd.replace(/\\/g, '/');
    s = s.split(safeCwd).join('<repo>');
  }
  // Collapse repetitive node_modules paths to a concise token
  s = s.replace(new RegExp('node_modules[\\/](@?[^\\/\\s]+)[\\/]?', 'g'), 'node_modules/$1/...');
  // Omit timestamps for a cleaner persistent log
  return `${label}: ${s}`;
}

function writeNormalized(streamLabel, chunk) {
  // Split into lines and write each normalized line
  const raw = String(chunk);
  const lines = raw.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l === '' && i === lines.length - 1) continue; // trailing newline
    const normalized = normalizeForLog(l, streamLabel) + '\n';
    logStream.write(normalized);
  }
}

proc.stdout.on('data', (data) => {
  // Mirror colored output to console for developer convenience
  process.stdout.write(data);
  // Write a cleaned, timestamped copy to the persistent log
  writeNormalized('STDOUT', data);
});

proc.stderr.on('data', (data) => {
  // Mirror colored output to console
  process.stderr.write(data);
  // Clean and write to the persistent log, labeled STDERR
  writeNormalized('STDERR', data);
});

proc.on('close', (code) => {
  const summary = `[${new Date().toISOString()}] PROCESS EXIT: code=${code}\n`;
  logStream.write(summary);
  logStream.end();
  process.exit(code);
});
