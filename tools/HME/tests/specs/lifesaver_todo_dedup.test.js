'use strict';
// Regression: register_todo_from_lifesaver must collapse memory-variant
// errors via _normalize_error_for_dedup so a runaway monitor loop firing
// "GPU has 17342 MB free" / "16826 MB free" / "12828 MB free" doesn't
// create N distinct entries. Before this fix, 35 zombie entries from a
// single recurring failure piled up in tools/HME/KB/todos.json, which
// the user reported as "absolutely riddled with spam."
//
// Tests via Python subprocess since the todo store is implemented in
// Python (server.tools_analysis.todo). Spawns a sandboxed PROJECT_ROOT
// to avoid touching the production store.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function _runPython(sandbox, body) {
  const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
  const env = {
    ...process.env,
    PROJECT_ROOT: sandbox,
    PYTHONPATH: path.join(repoRoot, 'tools', 'HME', 'service'),
  };
  const result = spawnSync('python3', ['-c', body], { env, encoding: 'utf8' });
  return result;
}

function _withSandboxedTodoStore(fn) {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-todo-test-'));
  fs.mkdirSync(path.join(sandbox, 'tools', 'HME', 'KB'), { recursive: true });
  fs.mkdirSync(path.join(sandbox, 'output', 'metrics'), { recursive: true });
  // hme_env requires a .env file in PROJECT_ROOT and a CLAUDE.md sibling
  // to resolve project root. The synthesis import chain validates many
  // model-alias keys at import time, so a minimal stub doesn't suffice.
  //
  // SANITIZED clone: copy the production .env (so every required key is
  // present), rewrite PROJECT_ROOT to the sandbox, and redact known
  // secret-class keys to "REDACTED-FOR-TEST" so a /tmp leak from the
  // sandbox dir doesn't expose API tokens. Keys that hme_env validates
  // (model aliases, ports, paths) stay intact since they're not secret.
  // If hme_env adds new secret-class keys, add them to SECRET_KEY_PATTERNS.
  const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
  const prodEnv = fs.readFileSync(path.join(repoRoot, '.env'), 'utf8');
  const SECRET_KEY_PATTERNS = [
    /_TOKEN$/, /_KEY$/, /_SECRET$/, /_PASSWORD$/, /_PASSWD$/,
    /_API_KEY$/, /_AUTH$/, /_CREDENTIALS?$/,
    /^TELEGRAM_/, /^ANTHROPIC_/, /^OPENAI_/, /^GITHUB_/,
  ];
  const isSecretKey = (k) => SECRET_KEY_PATTERNS.some((re) => re.test(k));
  const sandboxEnv = prodEnv.split('\n').map((line) => {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!m) return line;
    const [, key] = m;
    if (key === 'PROJECT_ROOT') return `PROJECT_ROOT=${sandbox}`;
    if (isSecretKey(key)) return `${key}=REDACTED-FOR-TEST`;
    return line;
  }).join('\n');
  fs.writeFileSync(path.join(sandbox, '.env'), sandboxEnv, { mode: 0o600 });
  fs.writeFileSync(path.join(sandbox, 'CLAUDE.md'), '# sandbox\n');
  // Seed an empty store with the legacy meta-header sentinel shape.
  fs.writeFileSync(
    path.join(sandbox, 'tools', 'HME', 'KB', 'todos.json'),
    JSON.stringify([{ id: 0, _meta: { max_id: 0, updated_ts: 0 } }]),
  );
  try {
    return fn(sandbox);
  } finally {
    try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch (_e) { /* best-effort */ }
  }
}

test('lifesaver-todo dedup: memory-variant errors collapse to one entry', () => {
  _withSandboxedTodoStore((sandbox) => {
    const result = _runPython(sandbox, `
from server.tools_analysis.todo import register_todo_from_lifesaver, _load_todos
import json
# Three near-duplicate errors that differ only in memory numbers.
register_todo_from_lifesaver("llamacpp_offload_invariant", "GPU1 has 17342 MB free, coder needs ~22049 MB", "CRITICAL")
register_todo_from_lifesaver("llamacpp_offload_invariant", "GPU1 has 16826 MB free, coder needs ~22049 MB", "CRITICAL")
register_todo_from_lifesaver("llamacpp_offload_invariant", "GPU1 has 12828 MB free, coder needs ~22049 MB", "CRITICAL")
meta, todos = _load_todos()
ls_open = [t for t in todos if t.get("source") == "lifesaver" and not t.get("done")]
print(json.dumps({
  "open_count": len(ls_open),
  "recurrence": ls_open[0].get("recurrence_count") if ls_open else 0,
}))
`);
    if (result.status !== 0) {
      throw new Error(`python failed: ${result.stderr}`);
    }
    const parsed = JSON.parse(result.stdout.trim().split('\n').pop());
    assert.strictEqual(parsed.open_count, 1, 'three memory-variant errors must collapse to ONE entry');
    assert.strictEqual(parsed.recurrence, 3, 'recurrence_count must reflect all three firings');
  });
});

test('lifesaver-todo dedup: structurally-different errors stay distinct', () => {
  _withSandboxedTodoStore((sandbox) => {
    const result = _runPython(sandbox, `
from server.tools_analysis.todo import register_todo_from_lifesaver, _load_todos
import json
# Different ERROR CLASSES — must NOT collapse.
register_todo_from_lifesaver("llamacpp_offload_invariant", "GPU1 has 17342 MB free, coder needs ~22049 MB", "CRITICAL")
register_todo_from_lifesaver("llamacpp_offload_invariant", "model crash: segfault in attention layer", "CRITICAL")
register_todo_from_lifesaver("rag_proxy", "shim connection refused", "WARNING")
meta, todos = _load_todos()
ls_open = [t for t in todos if t.get("source") == "lifesaver" and not t.get("done")]
print(json.dumps({"open_count": len(ls_open)}))
`);
    if (result.status !== 0) {
      throw new Error(`python failed: ${result.stderr}`);
    }
    const parsed = JSON.parse(result.stdout.trim().split('\n').pop());
    assert.strictEqual(parsed.open_count, 3, 'structurally-different errors must remain distinct entries');
  });
});

test('hme_todo add: identical-text duplicate becomes recurrence increment', () => {
  _withSandboxedTodoStore((sandbox) => {
    const result = _runPython(sandbox, `
from server.tools_analysis.todo import hme_todo, _load_todos
import json
hme_todo(action="add", text="rebuild the index")
hme_todo(action="add", text="rebuild the index")  # duplicate
hme_todo(action="add", text="rebuild the index")  # another duplicate
meta, todos = _load_todos()
matches = [t for t in todos if t.get("text") == "rebuild the index"]
print(json.dumps({
  "match_count": len(matches),
  "recurrence": matches[0].get("recurrence_count") if matches else 0,
}))
`);
    if (result.status !== 0) throw new Error(`python failed: ${result.stderr}`);
    const parsed = JSON.parse(result.stdout.trim().split('\n').pop());
    assert.strictEqual(parsed.match_count, 1, 'three identical adds must collapse to ONE entry');
    assert.strictEqual(parsed.recurrence, 3, 'recurrence_count must reflect all three adds');
  });
});

test('hme_todo add: dedup respects parent_id (sub-todos with same text under different parents stay distinct)', () => {
  _withSandboxedTodoStore((sandbox) => {
    const result = _runPython(sandbox, `
from server.tools_analysis.todo import hme_todo, _load_todos
import json
hme_todo(action="add", text="parent A")
hme_todo(action="add", text="parent B")
meta, todos = _load_todos()
parent_a = next(t for t in todos if t.get("text") == "parent A")
parent_b = next(t for t in todos if t.get("text") == "parent B")
hme_todo(action="add", text="rebuild", parent_id=parent_a["id"])
hme_todo(action="add", text="rebuild", parent_id=parent_b["id"])
hme_todo(action="add", text="rebuild", parent_id=parent_a["id"])  # dup of A's sub
meta, todos = _load_todos()
parent_a = next(t for t in todos if t.get("text") == "parent A")
parent_b = next(t for t in todos if t.get("text") == "parent B")
print(json.dumps({
  "a_subs": len(parent_a.get("subs", [])),
  "b_subs": len(parent_b.get("subs", [])),
  "a_recurrence": parent_a["subs"][0].get("recurrence_count", 1) if parent_a.get("subs") else 0,
}))
`);
    if (result.status !== 0) throw new Error(`python failed: ${result.stderr}`);
    const parsed = JSON.parse(result.stdout.trim().split('\n').pop());
    assert.strictEqual(parsed.a_subs, 1, 'A has one sub even after duplicate add');
    assert.strictEqual(parsed.b_subs, 1, 'B has its own sub (not deduped against A)');
    assert.strictEqual(parsed.a_recurrence, 2, 'A sub recurrence reflects the second add');
  });
});

test('archive: clear auto-archives complete set to KB devlog and resets to fresh slate', () => {
  _withSandboxedTodoStore((sandbox) => {
    const fs2 = require('fs');
    const p2 = require('path');
    fs2.mkdirSync(p2.join(sandbox, 'doc'), { recursive: true });
    fs2.writeFileSync(p2.join(sandbox, 'doc', 'SPEC.md'),
      `# Test SPEC\n\n## Phases\n\n### Phase 0: bootstrap\n\n- [x] [easy] Item A\n\n` +
      `_Phase 0 complete_ (2026-04-26T10:00:00Z):\n\nDid bootstrap.\n\n` +
      `### Phase 1: extension\n\n- [x] [hard] Item B\n\n` +
      `_Phase 1 complete_ (2026-04-26T11:00:00Z):\n\nExtended.\n\n## Glossary\n\n- **t**: term\n`
    );
    fs2.writeFileSync(p2.join(sandbox, 'doc', 'TODO.md'),
      `# TODO\n\n## In flight\n\n## Just shipped\n\n- did stuff\n\n## Next up\n\n(empty)\n`
    );
    const result = _runPython(sandbox, `
from server.tools_analysis.todo import hme_todo, _detect_complete_set
import json, os
detection = _detect_complete_set()
out = hme_todo(action="clear", text="test set name")
spec_md = open(os.path.join("${sandbox}", "doc", "SPEC.md")).read()
todo_md = open(os.path.join("${sandbox}", "doc", "TODO.md")).read()
devlog_dir = os.path.join("${sandbox}", "tools", "HME", "KB", "devlog")
devlog_files = sorted(os.listdir(devlog_dir)) if os.path.exists(devlog_dir) else []
print(json.dumps({
  "detected_complete": detection["complete"],
  "archive_message_present": "📦 Set archived" in out,
  "devlog_count": len(devlog_files),
  "devlog_filename_pattern": all("test-set-name" in f for f in devlog_files) if devlog_files else False,
  "spec_has_phase_0_placeholder": "### Phase 0: <next initiative" in spec_md,
  "spec_has_archive_pointer": "Previous set" in spec_md and "archived" in spec_md,
  "spec_has_generic_title": spec_md.startswith("# Polychron Active SPEC"),
  "spec_preamble_no_buddy_specific": "buddy_system" not in spec_md and "Co-Buddy Fanout" not in spec_md,
  "spec_no_old_phases": "_Phase 0 complete_" not in spec_md and "_Phase 1 complete_" not in spec_md,
  "todo_reset_to_fresh": "(empty — populate from the new set" in todo_md,
}))
`);
    if (result.status !== 0) throw new Error(`python failed: ${result.stderr}`);
    const parsed = JSON.parse(result.stdout.trim().split('\n').pop());
    assert.strictEqual(parsed.detected_complete, true, 'all-complete detection must fire');
    assert.strictEqual(parsed.archive_message_present, true, 'clear must surface archive message');
    assert.strictEqual(parsed.devlog_count, 1, 'one devlog file must be produced');
    assert.strictEqual(parsed.devlog_filename_pattern, true, 'devlog filename must include slug');
    assert.strictEqual(parsed.spec_has_phase_0_placeholder, true, 'fresh SPEC has Phase 0 placeholder');
    assert.strictEqual(parsed.spec_has_archive_pointer, true, 'fresh SPEC has archive pointer');
    assert.strictEqual(parsed.spec_no_old_phases, true, 'fresh SPEC drops old completed phases');
    assert.strictEqual(parsed.todo_reset_to_fresh, true, 'fresh TODO has empty-Next-up message');
  });
});

test('auto-prune: every hme_todo invocation prunes done todos past horizon (all sources)', () => {
  _withSandboxedTodoStore((sandbox) => {
    const result = _runPython(sandbox, `
import os
os.environ["HME_DONE_TODO_PRUNE_SEC"] = "1"  # 1-second horizon for test
from server.tools_analysis.todo import hme_todo, _load_todos
import json, time
hme_todo(action="add", text="will-be-done")
hme_todo(action="add", text="will-stay-open")
meta, todos = _load_todos()
done_id = next(t["id"] for t in todos if "done" in t["text"])
hme_todo(action="done", todo_id=done_id)
time.sleep(2)  # past prune horizon
# Triggering ANY action runs auto-prune
hme_todo(action="list")
meta, todos = _load_todos()
texts = sorted(t["text"] for t in todos)
print(json.dumps({"remaining": texts}))
`);
    if (result.status !== 0) throw new Error(`python failed: ${result.stderr}`);
    const parsed = JSON.parse(result.stdout.trim().split('\n').pop());
    assert.deepStrictEqual(parsed.remaining, ['will-stay-open'], 'done entry past horizon must be auto-pruned');
  });
});

test('auto-prune: list emits system-reminder when done-pending count crosses threshold', () => {
  _withSandboxedTodoStore((sandbox) => {
    // Threshold: 15 done items in the store (high enough to avoid
    // false-firing on legitimate work-in-progress; only fires once
    // the store has genuinely accumulated stale completions).
    const result = _runPython(sandbox, `
from server.tools_analysis.todo import hme_todo, _load_todos
import json
for i in range(16):
    hme_todo(action="add", text=f"item-{i}")
_, todos = _load_todos()
for t in todos:
    hme_todo(action="done", todo_id=t["id"])
output = hme_todo(action="list")
print(json.dumps({
  "has_reminder": "<system-reminder>" in output and "pending cleanup" in output,
}))
`);
    if (result.status !== 0) throw new Error(`python failed: ${result.stderr}`);
    const parsed = JSON.parse(result.stdout.trim().split('\n').pop());
    assert.strictEqual(parsed.has_reminder, true, 'system-reminder must surface when threshold crossed');
  });
});

test('auto-prune: list does NOT emit reminder when done count below threshold', () => {
  _withSandboxedTodoStore((sandbox) => {
    const result = _runPython(sandbox, `
from server.tools_analysis.todo import hme_todo, _load_todos
import json
for i in range(3):
    hme_todo(action="add", text=f"item-{i}")
_, todos = _load_todos()
for t in todos:
    hme_todo(action="done", todo_id=t["id"])
output = hme_todo(action="list")
print(json.dumps({
  "has_reminder": "<system-reminder>" in output and "pending cleanup" in output,
}))
`);
    if (result.status !== 0) throw new Error(`python failed: ${result.stderr}`);
    const parsed = JSON.parse(result.stdout.trim().split('\n').pop());
    assert.strictEqual(parsed.has_reminder, false, 'small done count must NOT trigger reminder');
  });
});

test('archive: clear refuses to archive when set is not complete', () => {
  _withSandboxedTodoStore((sandbox) => {
    const fs2 = require('fs');
    const p2 = require('path');
    fs2.mkdirSync(p2.join(sandbox, 'doc'), { recursive: true });
    // Phase has open `[ ]` items — set not complete
    fs2.writeFileSync(p2.join(sandbox, 'doc', 'SPEC.md'),
      `# SPEC\n\n## Phases\n\n### Phase 0: wip\n\n- [x] [easy] Done item\n- [ ] [hard] Still open\n`
    );
    fs2.writeFileSync(p2.join(sandbox, 'doc', 'TODO.md'), `# TODO\n\n## Just shipped\n\n## Next up\n`);
    const result = _runPython(sandbox, `
from server.tools_analysis.todo import hme_todo
import os
out = hme_todo(action="clear")
spec_md = open(os.path.join("${sandbox}", "doc", "SPEC.md")).read()
import json
print(json.dumps({
  "no_archive_message": "📦 Set archived" not in out,
  "blocker_message_shown": "Set not yet complete" in out,
  "spec_unchanged": "Still open" in spec_md,
}))
`);
    if (result.status !== 0) throw new Error(`python failed: ${result.stderr}`);
    const parsed = JSON.parse(result.stdout.trim().split('\n').pop());
    assert.strictEqual(parsed.no_archive_message, true, 'must NOT archive when set incomplete');
    assert.strictEqual(parsed.blocker_message_shown, true, 'must surface blocker reason');
    assert.strictEqual(parsed.spec_unchanged, true, 'SPEC.md must remain untouched');
  });
});

test('lifesaver-todo store-protection: TTL sweep auto-resolves stale entries', () => {
  _withSandboxedTodoStore((sandbox) => {
    const result = _runPython(sandbox, `
import os
os.environ["HME_LIFESAVER_TODO_TTL_SEC"] = "1"  # 1-second TTL for test
from server.tools_analysis.todo import register_todo_from_lifesaver, _load_todos, _enforce_lifesaver_caps, _todo_lock, _save_todos
import json, time
register_todo_from_lifesaver("monitor_a", "transient failure A", "CRITICAL")
time.sleep(2)  # entry now older than TTL
# Trigger sweep via a fresh registration.
register_todo_from_lifesaver("monitor_b", "fresh failure B", "CRITICAL")
meta, todos = _load_todos()
ls = [t for t in todos if t.get("source") == "lifesaver"]
ls_open = [t for t in ls if not t.get("done")]
ttl_resolved = [t for t in ls if t.get("resolved_reason") == "stale-ttl"]
print(json.dumps({
  "total": len(ls),
  "open": len(ls_open),
  "ttl_resolved": len(ttl_resolved),
}))
`);
    if (result.status !== 0) {
      throw new Error(`python failed: ${result.stderr}`);
    }
    const parsed = JSON.parse(result.stdout.trim().split('\n').pop());
    assert.strictEqual(parsed.ttl_resolved, 1, 'stale entry must be auto-resolved by TTL sweep');
    assert.strictEqual(parsed.open, 1, 'only the fresh entry stays open');
  });
});
