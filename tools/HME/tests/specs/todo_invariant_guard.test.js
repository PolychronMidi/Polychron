'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { bashTodoDecision } = require('../../proxy/todo_invariant_guard');

test('Bash shell-side TODO mutation is denied unless routed through canonical todo engine archive', () => {
  const todoPath = ['doc', 'templates', 'TODO.md'].join('/');
  for (const cmd of [
    `python3 - <<PY\nfrom pathlib import Path\nPath("${todoPath}").write_text("bad")\nPY`,
    `sed -i s/1_/5_/ ${todoPath}`,
    `cat x > $PROJECT_ROOT/${todoPath}`,
  ]) {
    const d = bashTodoDecision(cmd);
    assert.equal(d && d.decision, 'deny', cmd);
    assert.match(d.reason, /canonical TODO engine/);
  }
  assert.equal(bashTodoDecision('python3 -m todo_engine.store maybe_archive doc/templates/TODO.md'), null);
});
