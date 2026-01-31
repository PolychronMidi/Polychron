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

// Concurrency guard: create a PID lock so concurrent invocations are rejected loudly
const fs = require('fs');
const lockDir = 'tmp';
const lockPath = require('path').join(lockDir, 'run.lock');
// Support nested run-with-log invocations spawned from a root: they set RUN_WITH_LOG_OWNER to the root PID
const owner = process.env.RUN_WITH_LOG_OWNER ? Number(process.env.RUN_WITH_LOG_OWNER) : null;
let wroteLock = false;
try {
  // Ensure lock directory exists
  mkdir(lockDir, { recursive: true }).catch(() => {});
  // If an owner is present and it's **not** us, skip lock handling (we're a nested child)
  if (!owner || owner === process.pid) {
    if (fs.existsSync(lockPath)) {
      try {
        const pid = Number(fs.readFileSync(lockPath, 'utf8').trim());
        if (pid && pid > 0) {
          // If the existing PID equals our PID, it's a stale leftover from this process; remove and continue
          if (pid === process.pid) {
            try { fs.unlinkSync(lockPath); } catch (_e) { /* swallow */ }
          } else {
            try {
              // Check if the PID is still running
              process.kill(pid, 0);
              // If no error, process exists -> refuse to start another command
              console.error('\n\n=================================================================');
              console.error(`ERROR: Another command is running (pid=${pid}).`);
              console.error('Please wait for it to finish or remove the stale lock at', lockPath);
              console.error('=================================================================\n\n');
              process.exit(2);
            } catch (e) {
              // Process not running -> stale lock, remove it and continue
              try { fs.unlinkSync(lockPath); } catch (_e) { /* swallow */ }
            }
          }
        }
      } catch (e) { /* malformed lock: remove and continue */ try { fs.unlinkSync(lockPath); } catch (_e) { /* swallow */ } }
    }
    // Write our PID to the lock file so subsequent invocations detect it
    try { fs.writeFileSync(lockPath, String(process.pid)); wroteLock = true; } catch (_e) { /* swallow */ }
  } else {
    // We're a nested invocation; do not touch global lock
  }
} catch (_e) { /* swallow any lock errors to avoid preventing normal runs */ }

// Ensure we remove the lock on exit (only if we wrote it)
const removeLock = () => { try { if (wroteLock && fs.existsSync(lockPath)) fs.unlinkSync(lockPath); } catch (e) { /* swallow */ } };
process.on('exit', removeLock);
process.on('SIGINT', () => { removeLock(); process.exit(130); });
process.on('SIGTERM', () => { removeLock(); process.exit(143); });
process.on('uncaughtException', (err) => { removeLock(); throw err; });

// Ensure log directory exists (async-safe)
mkdir('log', { recursive: true }).catch(() => {});

const logStream = createWriteStream(`log/${logFile}`);
// Preserve and propagate RUN_WITH_LOG_OWNER so nested run-with-log invocations are recognized as children
const childEnv = Object.assign({}, process.env);
if (!childEnv.RUN_WITH_LOG_OWNER) childEnv.RUN_WITH_LOG_OWNER = String(owner || process.pid);
const proc = spawn(command[0], command.slice(1), { shell: true, stdio: 'pipe', env: childEnv });

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
