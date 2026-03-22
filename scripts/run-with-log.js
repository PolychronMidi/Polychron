/* global stripAnsi */
/**
 * Run a command and stream stdout/stderr to a log file while mirroring it to the console.
 * Usage: node scripts/run-with-log.js <logFile> <command> [args...]
 * @module scripts/run-with-log
 */
const { spawn } = require('child_process');
const { createWriteStream } = require('fs');
const { mkdir } = require('fs/promises');
// Load stripAnsi for side-effects (defines naked global `stripAnsi`)
require('./utils/stripAnsi');
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
  fs.mkdirSync(lockDir, { recursive: true });
  // If an owner is present and it's **not** us, skip lock handling (we're a nested child)
  if (!owner || owner === process.pid) {
    if (fs.existsSync(lockPath)) {
      try {
        const pid = Number(fs.readFileSync(lockPath, 'utf8').trim());
        if (pid && pid > 0) {
          // If the existing PID equals our PID, it's a stale leftover from this process; remove and continue
          if (pid === process.pid) {
            try { fs.unlinkSync(lockPath); } catch (_e) { console.warn('run-with-log: failed to remove stale lock file (continuing):', _e && _e.stack ? _e.stack : _e); }
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
              try { fs.unlinkSync(lockPath); } catch (_e) { console.warn('run-with-log: failed to remove malformed lock file (continuing):', _e && _e.stack ? _e.stack : _e); }
            }
          }
        }
      } catch (e) { /* malformed lock: remove and continue */ try { fs.unlinkSync(lockPath); } catch (_e) { console.warn('run-with-log: failed to remove malformed lock file (continuing):', _e && _e.stack ? _e.stack : _e); } }
    }
    // Write our PID to the lock file so subsequent invocations detect it
    try { fs.writeFileSync(lockPath, String(process.pid)); wroteLock = true; } catch (_e) { console.warn('run-with-log: failed to write lock file (continuing):', _e && _e.stack ? _e.stack : _e); }
  } else {
    // We're a nested invocation; do not touch global lock
  }
} catch (_e) { console.warn('run-with-log: lock handling failed (continuing):', _e && _e.stack ? _e.stack : _e); }

// Ensure we remove the lock on exit (only if we wrote it)
const removeLock = () => { try { if (wroteLock && fs.existsSync(lockPath)) fs.unlinkSync(lockPath); } catch (e) { console.warn('run-with-log: removeLock failed (continuing):', e && e.stack ? e.stack : e); } };
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
const proc = spawn(command[0], command.slice(1), { shell: false, stdio: 'pipe', env: childEnv });

// ── Persistent single-line spinner ──────────────────────────────────────────
// One status line pinned at the bottom. Overwrites itself in place so it never
// adds extra lines. Cleared before child output, redrawn after.
const _SPIN = ['|', '/', '-', '\\'];
let _spinIdx = 0;
let _statusShown = false;
const _STATUS_MSG = ' script in progress, wait...';

function _writeStatus() {
  const ch = _SPIN[_spinIdx++ & 3];
  process.stderr.write('\x1b[2K\r' + ch + _STATUS_MSG);
  _statusShown = true;
}
function _clearStatus() {
  if (_statusShown) {
    process.stderr.write('\x1b[2K\r');
    _statusShown = false;
  }
}
_writeStatus();
const _spinTimer = setInterval(_writeStatus, 500);
_spinTimer.unref();

/**
 * Normalize a single line for the persistent log:
 * - Strip ANSI escapes
 * - Replace absolute repo paths with relative ones
 * - Shorten node_modules references
 */
function normalizeForLog(line) {
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
  // Omit timestamps and stream labels for a cleaner persistent log
  return s;
}

function writeNormalized(streamLabel, chunk) {
  // Split into lines and write each normalized line
  const raw = String(chunk);
  const lines = raw.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l === '' && i === lines.length - 1) continue; // trailing newline
    // Skip spinner status lines from the log
    if (l.indexOf('script in progress') !== -1) continue;
    const normalized = normalizeForLog(l) + '\n';
    logStream.write(normalized);
  }
}

proc.stdout.on('data', (data) => {
  _clearStatus();
  process.stdout.write(data);
  writeNormalized('STDOUT', data);
  _writeStatus();
});

proc.stderr.on('data', (data) => {
  _clearStatus();
  process.stderr.write(data);
  writeNormalized('STDERR', data);
  _writeStatus();
});

proc.on('close', (code) => {
  clearInterval(_spinTimer);
  _clearStatus();
  const summary = `[${new Date().toISOString()}] PROCESS EXIT: code=${code}\n`;
  logStream.write(summary);
  logStream.end();
  process.stderr.write('script exited (code=' + code + ')\n');
  process.exit(code);
});
