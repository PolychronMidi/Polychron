'use strict';

const fs = require('fs');
const path = require('path');

const AUTOCOMMIT_FAIL_REL = path.join('tools', 'HME', 'runtime', 'autocommit.fail');
const LIFESAVER_HEARTBEAT_REL = path.join('tools', 'HME', 'runtime', 'heartbeat-lifesaver.ts');

function readAutocommitFailure(root) {
  const flagPath = path.join(root, AUTOCOMMIT_FAIL_REL);
  let body = '';
  try {
    body = fs.readFileSync(flagPath, 'utf8').trim();
  } catch (_e) {
    return null;
  }
  const banner = `[ALERT] LIFESAVER - AUTOCOMMIT FAILED - FIX BEFORE ANYTHING ELSE

${body}

The autocommit helper left this flag behind. Last attempt did not
succeed, which means working-tree changes have NOT been committed.
Diagnose: check git status in the project root; read log/hme-errors.log;
inspect tools/HME/runtime/autocommit.err if present; verify .env loaded PROJECT_ROOT.
Fix the root cause. Do not silence the alert -- the flag clears automatically
on the next successful autocommit.`;
  return { flagPath, body, banner };
}

function touchLifesaverHeartbeat(root) {
  try {
    const heartbeat = path.join(root, LIFESAVER_HEARTBEAT_REL);
    fs.mkdirSync(path.dirname(heartbeat), { recursive: true });
    fs.writeFileSync(heartbeat, String(Math.floor(Date.now() / 1000)));
    return true;
  } catch (_e) {
    return false;
  }
}

module.exports = {
  AUTOCOMMIT_FAIL_REL,
  LIFESAVER_HEARTBEAT_REL,
  readAutocommitFailure,
  touchLifesaverHeartbeat,
};
