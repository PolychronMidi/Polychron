'use strict';
// Alert-chain canary watchdog. UserPromptSubmit injects fingerprinted
// [CANARY-<id>] lines into hme-errors.log. The PostToolUse inline-check
// and Stop-hook lifesaver consume them (write to hme-canary-consumed.txt).
//
// If a canary was injected but never consumed AND is older than its TTL,
// the alert chain regressed: the producer side wrote, but no consumer
// scanned past it. This catches silent-fails at the chain level even
// when individual fix-and-patch audits miss specific vectors.
//
// Pending canaries within TTL are treated as in-flight (recent injects
// that haven't had time to fire through Stop yet).

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..');
const PENDING = path.join(ROOT, 'tmp', 'hme-canary-pending.txt');
const CONSUMED = path.join(ROOT, 'tmp', 'hme-canary-consumed.txt');

// TTL: a canary should be consumed within this many seconds of injection.
// PostToolUse fires on every tool call (typically <10s); Stop fires at
// turn end (<minutes). 600s = 10min gives generous slack for slow turns.
const CANARY_TTL_SEC = 600;
// Only treat canaries older than this as "definitely should have been
// consumed by now" for FAILing CI. Anything younger is in-flight.

function loadPending() {
  if (!fs.existsSync(PENDING)) return [];
  const out = [];
  for (const line of fs.readFileSync(PENDING, 'utf8').split('\n')) {
    if (!line) continue;
    const [id, lineNum, ts] = line.split('|');
    if (!id) continue;
    out.push({ id, lineNum, ts: parseInt(ts, 10) || 0 });
  }
  return out;
}

function loadConsumed() {
  if (!fs.existsSync(CONSUMED)) return new Set();
  const out = new Set();
  for (const line of fs.readFileSync(CONSUMED, 'utf8').split('\n')) {
    if (!line) continue;
    const [id] = line.split('|');
    if (id) out.add(id);
  }
  return out;
}

const pending = loadPending();
const consumed = loadConsumed();
const now = Math.floor(Date.now() / 1000);

const stale = [];
const inFlight = [];
for (const c of pending) {
  if (consumed.has(c.id)) continue;
  const age = now - c.ts;
  if (age > CANARY_TTL_SEC) stale.push({ ...c, age });
  else inFlight.push({ ...c, age });
}

// Report
console.log(`canaries pending: ${pending.length}`);
console.log(`canaries consumed: ${consumed.size}`);
console.log(`in-flight (within TTL ${CANARY_TTL_SEC}s): ${inFlight.length}`);

if (stale.length > 0) {
  console.error(`\nSTALE canaries (alert chain may be silently regressed):`);
  for (const s of stale.slice(0, 5)) {
    console.error(`  ${s.id} age=${s.age}s line=${s.lineNum}`);
  }
  if (stale.length > 5) console.error(`  ...+${stale.length - 5} more`);
  console.error(`\ncheck-canary-consumption: FAIL (${stale.length} stale canaries)`);
  process.exit(1);
}
console.log(`check-canary-consumption: PASS`);
