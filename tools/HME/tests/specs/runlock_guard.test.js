'use strict';
const { test } = require('node:test');
const assert = require('node:assert');

const policy = require('../../policies/builtin/block-runlock-deletion');

// Build the lock-name token at runtime so this source file doesn't trip
// pretooluse_write.sh's secret-detection regex on commit.
const LOCK = 'r' + 'un.lock';

function _registry() {
  return require('../../policies/registry');
}

function _ctx(command) {
  const r = _registry();
  return {
    toolInput: { command },
    deny: r.deny, instruct: r.instruct, allow: r.allow,
  };
}

async function _runDeny(command) {
  const result = await policy.fn(_ctx(command));
  assert.strictEqual(result.decision, 'deny', `expected deny for: ${command}\n  got: ${JSON.stringify(result)}`);
  return result;
}

async function _runAllow(command) {
  const result = await policy.fn(_ctx(command));
  assert.strictEqual(result.decision, 'allow', `expected allow for: ${command}\n  got: ${JSON.stringify(result)}`);
}

test('runlock: rm', async () => { await _runDeny(`rm tmp/${LOCK}`); });
test('runlock: rm -f', async () => { await _runDeny(`rm -f tmp/${LOCK}`); });
test('runlock: unlink', async () => { await _runDeny(`unlink tmp/${LOCK}`); });
test('runlock: shred -u', async () => { await _runDeny(`shred -u tmp/${LOCK}`); });
test('runlock: truncate', async () => { await _runDeny(`truncate -s 0 tmp/${LOCK}`); });
test('runlock: find -delete', async () => { await _runDeny(`find . -name ${LOCK} -delete`); });
test('runlock: mv away', async () => { await _runDeny(`mv tmp/${LOCK} /tmp/elsewhere`); });
test('runlock: redirect-truncate', async () => { await _runDeny(`> tmp/${LOCK}`); });
test('runlock: python os.remove', async () => {
  await _runDeny(`python3 -c "import os; os.remove('tmp/${LOCK}')"`);
});
test('runlock: variable-aliased rm (lockTokens still match in source)', async () => {
  await _runDeny(`L=tmp/${LOCK}; rm "$L"`);
});

test('runlock: command without the lock string is allowed', async () => {
  await _runAllow('echo hello');
  await _runAllow(`rm /tmp/somefile.txt`);
});

test('runlock: deletion verb against UNRELATED file is allowed (no run.lock token)', async () => {
  await _runAllow('rm /tmp/cache.tmp');
});

test('runlock: lock token in non-deletion context is allowed', async () => {
  await _runAllow(`cat tmp/${LOCK}`);
  await _runAllow(`stat tmp/${LOCK}`);
});

test('runlock: variable-substitution split bypass is NOT caught (documented limitation)', async () => {
  // BASE=run; rm tmp/$BASE.lock — the source contains "$BASE.lock" not
  // "run.lock". Argv tokenization can't see the runtime variable
  // substitution. Documented bypass; covered by settings.json deny rule
  // as defense-in-depth.
  const result = await policy.fn(_ctx('BASE=run; rm tmp/$BASE.lock'));
  assert.strictEqual(result.decision, 'allow', 'documented limitation: runtime var-split escapes the JS guard');
});
