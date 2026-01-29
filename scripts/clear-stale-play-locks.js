const fs = require('fs');
const path = require('path');
const LOCK_DIR = path.join(process.cwd(), 'tmp');
const LOCK_PATH = path.join(LOCK_DIR, 'play.lock');
const HEARTBEAT_MS = Number(process.env.PLAY_GUARD_STALE_MS) || (30 * 1000);
const GRACE_MS = Number(process.env.PLAY_GUARD_GRACE_MS) || 2000;

function isPidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return false; }
}

function tryKill(pid, sig) {
  try { process.kill(pid, sig); return true; } catch (e) { return false; }
}

(async function main() {
  try {
    if (!fs.existsSync(LOCK_PATH)) {
      console.log('clear-stale-play-locks: no lock file present');
      process.exit(0);
    }
    const raw = fs.readFileSync(LOCK_PATH, 'utf8');
    const obj = JSON.parse(raw);
    const hb = obj && obj.heartbeat ? Number(obj.heartbeat) : (obj && obj.when ? (new Date(obj.when)).getTime() : null);
    const age = hb ? (Date.now() - hb) : Infinity;
    if (age < HEARTBEAT_MS) {
      console.log(`clear-stale-play-locks: lock owner is recent (age=${age}ms) - nothing to do`);
      process.exit(0);
    }

    console.log(`clear-stale-play-locks: stale lock detected (age=${age}ms) - attempting reclaim for pid=${obj.pid}`);

    if (obj && obj.pid && isPidAlive(obj.pid)) {
      console.log(`clear-stale-play-locks: sending SIGTERM to owner pid ${obj.pid}`);
      tryKill(obj.pid, 'SIGTERM');
      await new Promise(r => setTimeout(r, GRACE_MS));
      if (isPidAlive(obj.pid)) {
        console.log(`clear-stale-play-locks: still alive - sending SIGKILL to pid ${obj.pid}`);
        tryKill(obj.pid, 'SIGKILL');
        await new Promise(r => setTimeout(r, 500));
      }
    }

    // If owner still alive we refuse to remove lock; otherwise remove
    if (obj && obj.pid && isPidAlive(obj.pid)) {
      console.error('clear-stale-play-locks: owner still alive after kill attempts - aborting');
      process.exit(2);
    }

    try { fs.unlinkSync(LOCK_PATH); console.log('clear-stale-play-locks: removed stale lock'); } catch (e) { console.error('clear-stale-play-locks: failed to remove lock', e && e.message); process.exit(3); }
    process.exit(0);
  } catch (e) {
    console.error('clear-stale-play-locks: unexpected error', e && e.message);
    process.exit(1);
  }
})();
