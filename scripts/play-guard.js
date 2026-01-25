// scripts/play-guard.js - guard to ensure only one play runs at a time
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const LOCK_DIR = path.join(process.cwd(), 'tmp');
const LOCK_PATH = path.join(LOCK_DIR, 'play.lock');
const FIN_PATH = path.join(process.cwd(), 'output', 'play.finished.json');

function isPidAlive(pid) {
  try {
    // signal 0 only tests for existence
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return false;
  }
}

(async function main() {
  try {
    if (!fs.existsSync(LOCK_DIR)) fs.mkdirSync(LOCK_DIR, { recursive: true });

    if (fs.existsSync(LOCK_PATH)) {
      try {
        const data = fs.readFileSync(LOCK_PATH, 'utf8');
        const obj = JSON.parse(data);
        if (obj && obj.pid && isPidAlive(obj.pid)) {
          console.error(`Play guard: another play is running (pid=${obj.pid}). Exiting.`);
          process.exit(2);
        } else {
          // stale lock
          fs.unlinkSync(LOCK_PATH);
        }
      } catch (e) {
        // remove corrupted/stale lock file
        try { fs.unlinkSync(LOCK_PATH); } catch (_) {}
      }
    }

    const lock = { pid: process.pid, when: new Date().toISOString() };
    fs.writeFileSync(LOCK_PATH, JSON.stringify(lock));
    console.log(`Play guard: starting play (pid=${process.pid})`);

    const child = spawn(process.execPath, ['src/play.js'], { stdio: 'inherit', shell: false });

    child.on('close', (code, sig) => {
      try {
        if (fs.existsSync(LOCK_PATH)) fs.unlinkSync(LOCK_PATH);
      } catch (e) {}
      const fin = { when: new Date().toISOString(), exitCode: code, signal: sig };
      try { fs.mkdirSync(path.join(process.cwd(),'output'), { recursive: true }); fs.writeFileSync(FIN_PATH, JSON.stringify(fin, null, 2)); } catch (e) {}
      console.log(`Play guard: child exited (code=${code}, signal=${sig})`);
      process.exit(code);
    });

    child.on('error', (err) => {
      try { if (fs.existsSync(LOCK_PATH)) fs.unlinkSync(LOCK_PATH); } catch (_e) {}
      console.error('Play guard: failed to spawn play child:', err && err.message);
      process.exit(3);
    });

    // Ensure we clean up on signals
    const cleanupAndExit = (code) => {
      try { if (fs.existsSync(LOCK_PATH)) fs.unlinkSync(LOCK_PATH); } catch (e) {}
      process.exit(code || 1);
    };
    process.on('SIGINT', () => cleanupAndExit(130));
    process.on('SIGTERM', () => cleanupAndExit(143));

  } catch (e) {
    console.error('Play guard: unexpected error', e && e.message);
    process.exit(1);
  }
})();
