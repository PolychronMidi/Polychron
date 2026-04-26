'use strict';
// Heartbeat freshness watchdog. Each critical hook component writes
// tmp/hme-heartbeat-<name>.ts on successful execution (epoch seconds).
// This validator checks that each expected heartbeat is no older than
// its declared freshness window. Stale = silent-fail vector somewhere
// in that component's chain.
//
// Catches the failure mode at the OUTPUT level (consequence) rather than
// auditing every input vector. If autocommit silently fails to run, its
// heartbeat goes stale -- this validator surfaces that.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..');
const TMP = path.join(ROOT, 'tmp');

// Expected heartbeats and their freshness windows.
// New components: add an entry here AND wire `date +%s > $tmp/hme-heartbeat-<name>.ts`
// (or use `_hme_heartbeat <name>` from _safety.sh) into the success path.
const HEARTBEATS = [
  {
    name: 'autocommit',
    file: 'hme-heartbeat-autocommit.ts',
    maxAgeSec: 24 * 60 * 60, // 24h -- autocommits fire on every Stop, but during dev it can sit idle
    history:
      'Stale autocommit heartbeat = autocommit-direct.sh succeeded last >24h ago. ' +
      'Either no Stop events have fired, or autocommit is silently failing on every run.',
  },
  {
    name: 'lifesaver',
    file: 'hme-heartbeat-lifesaver.ts',
    maxAgeSec: 24 * 60 * 60,
    history:
      'Stale lifesaver heartbeat = the Stop-hook LIFESAVER scanner has not executed in >24h. ' +
      'Either Stop events have stopped firing, the hook chain is broken, or lifesaver.sh is failing before reaching the heartbeat.',
  },
  {
    name: 'inline-check',
    file: 'hme-heartbeat-inline-check.ts',
    maxAgeSec: 24 * 60 * 60,
    history:
      'Stale inline-check heartbeat = the PostToolUse mid-turn error injector has not executed in >24h. ' +
      'PostToolUse hooks are the most frequent event class -- staleness here means the proxy hook chain is broken.',
  },
];

function check() {
  const violations = [];
  const observations = [];
  const now = Math.floor(Date.now() / 1000);

  for (const hb of HEARTBEATS) {
    const fp = path.join(TMP, hb.file);
    if (!fs.existsSync(fp)) {
      // Missing heartbeat is treated as observation, not error -- on a
      // fresh checkout these files don't exist yet. Once they appear,
      // staleness becomes a real signal.
      observations.push(`MISSING: ${hb.file} (component "${hb.name}" never wrote a heartbeat)`);
      continue;
    }
    const content = fs.readFileSync(fp, 'utf8').trim();
    const ts = parseInt(content, 10);
    if (!Number.isFinite(ts)) {
      violations.push(`MALFORMED: ${hb.file} contains "${content}" (expected epoch seconds)`);
      continue;
    }
    const age = now - ts;
    if (age > hb.maxAgeSec) {
      violations.push(
        `STALE: ${hb.name} (age ${age}s > max ${hb.maxAgeSec}s). History: ${hb.history}`
      );
    } else {
      observations.push(`fresh: ${hb.name} (age ${age}s)`);
    }
  }

  return { violations, observations };
}

const { violations, observations } = check();
for (const o of observations) console.log('  ' + o);
if (violations.length > 0) {
  for (const v of violations) console.error('  ' + v);
  console.error(`\ncheck-heartbeat-freshness: FAIL (${violations.length} stale or malformed)`);
  process.exit(1);
}
console.log(`check-heartbeat-freshness: PASS (${HEARTBEATS.length} heartbeats checked)`);
