#!/usr/bin/env node
'use strict';
const assert = require('assert');
const hook = require('../tools/HME/event_kernel/dispatcher');
const compat = require('../tools/HME/proxy/hook_bridge');
(async () => {
  assert.strictEqual(compat.dispatchEvent, hook.dispatchEvent);
  let r = await hook.dispatchEvent('NoSuchEvent', '{}');
  assert.equal(r.exit_code, 0);
  assert.match(r.stderr, /unknown event/);
  r = await hook.dispatchEvent('PostToolUse', JSON.stringify({tool_name:'Read', tool_input:{file_path:'CLAUDE.md'}}));
  assert.equal(r.exit_code, 0);
  console.log('hme_hook_test=ok');
})().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
