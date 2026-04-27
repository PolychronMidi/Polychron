/**
 * Run a command and stream stdout/stderr to a log file while mirroring it to the console.
 * Usage: node scripts/run-with-log.js <logFile> <command> [args...]
 * @module scripts/run-with-log
 */
const { spawn } = require('child_process');
const { mkdir } = require('fs/promises');
// Load stripAnsi for side-effects (defines naked global `stripAnsi`)
require('./stripAnsi');
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
const owner = (() => {
  const raw = process.env.RUN_WITH_LOG_OWNER;
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`RUN_WITH_LOG_OWNER="${raw}" is not a positive integer PID`);
  }
  return n;
})();
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
              console.error('\nERROR: another command is running (pid=' + pid + ').');
              console.error('Please wait for it to finish or remove the stale lock at', lockPath);
              console.error('');
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

// Ensure log directory exists (sync so the fd open below always succeeds)
fs.mkdirSync('log', { recursive: true });

// fd-based log writer: tracks logPos so the progress marker can be overwritten
// on each new write and truncated away cleanly on exit.
const LOG_PATH = `log/${logFile}`;
const PROGRESS_LINE = 'script in progress, wait...\n';
const logFd = fs.openSync(LOG_PATH, 'w');
let logPos = 0;

function writeToLog(text) {
  const buf = Buffer.from(text);
  fs.writeSync(logFd, buf, 0, buf.length, logPos);
  logPos += buf.length;
  // Rewrite progress marker at new end so it's always the last line
  const pb = Buffer.from(PROGRESS_LINE);
  fs.writeSync(logFd, pb, 0, pb.length, logPos);
}

function finalizeLog(exitText) {
  // Truncate to logPos (removes progress marker), write exit line, close fd
  fs.ftruncateSync(logFd, logPos);
  const buf = Buffer.from(exitText);
  fs.writeSync(logFd, buf, 0, buf.length, logPos);
  fs.closeSync(logFd);
}

// Write initial progress marker
writeToLog('');
// Preserve and propagate RUN_WITH_LOG_OWNER so nested run-with-log invocations are recognized as children
const childEnv = Object.assign({}, process.env);
if (!childEnv.RUN_WITH_LOG_OWNER) childEnv.RUN_WITH_LOG_OWNER = String(owner || process.pid);
const proc = spawn(command[0], command.slice(1), { shell: false, stdio: 'pipe', env: childEnv });

// Persistent single-line spinner -- only active when stderr is a real TTY.
// When stderr is redirected to a file the ANSI escape codes land as literal
// characters (\x1b[2K, \r) producing spam lines in the log.
const _IS_TTY = Boolean(process.stderr.isTTY);
const _SPIN = ['|', '/', '-', '\\'];
let _spinIdx = 0;
let _statusShown = false;
const _STATUS_MSG = ' script in progress, wait...';

function _writeStatus() {
  if (!_IS_TTY) return;
  const ch = _SPIN[_spinIdx++ & 3];
  process.stderr.write('\x1b[2K\r' + ch + _STATUS_MSG);
  _statusShown = true;
}
function _clearStatus() {
  if (!_IS_TTY || !_statusShown) return;
  process.stderr.write('\x1b[2K\r');
  _statusShown = false;
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

function writeNormalized(chunk) {
  const raw = String(chunk);
  const lines = raw.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l === '' && i === lines.length - 1) continue; // trailing newline
    writeToLog(normalizeForLog(l) + '\n');
  }
}

proc.stdout.on('data', (data) => {
  _clearStatus();
  process.stdout.write(data);
  writeNormalized(data);
  _writeStatus();
});

proc.stderr.on('data', (data) => {
  _clearStatus();
  process.stderr.write(data);
  writeNormalized(data);
  _writeStatus();
});

proc.on('close', (code) => {
  clearInterval(_spinTimer);
  _clearStatus();
  finalizeLog(`script exited (code=${code})\n`);
  process.stderr.write('script exited (code=' + code + ')\n');
  process.exit(code);
});
