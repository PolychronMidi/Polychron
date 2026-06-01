'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { test } = require('node:test');

const SCRIPT = `${__dirname}/../../scripts/hme-claude.py`;

function runPython(body) {
  return execFileSync('python3', ['-'], { input: body, encoding: 'utf8' });
}

test('hme-claude strips plain and dimmed cc success banners, but not failures', () => {
  const out = runPython(`
import importlib.util
spec = importlib.util.spec_from_file_location('hme_claude_bridge', ${JSON.stringify(SCRIPT)})
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
patterns = mod.success_banner_patterns({'cc': ['/compact', 'continue']})
text = mod.success_banner_text('cc', ['/compact', 'continue'])
variants = {
  'plain-lf': (text + '\\n').encode('utf-8'),
  'plain-crlf': (text.replace('\\n', '\\r\\n') + '\\r\\n').encode('utf-8'),
  'whole-dim': b'\\x1b[2m' + text.replace('\\n', '\\r\\n').encode('utf-8') + b'\\x1b[22m\\r\\n',
  'per-line-dim': b'\\x1b[2mUserPromptSubmit operation blocked by hook:\\x1b[22m\\r\\n'
    + b'\\x1b[2m  cc shortcut: dispatched /compact -> continue to the live session via the PTY bridge.\\x1b[22m\\r\\n',
}
for name, data in variants.items():
    for chunk_size in (5, len(data)):
        f = mod.ExactOutputFilter(patterns)
        out = b''
        for i in range(0, len(data), chunk_size):
            out += f.feed(data[i:i+chunk_size])
        out += f.flush()
        assert out == b'', (name, chunk_size, out)

failure = b'\\x1b[2mUserPromptSubmit operation blocked by hook:\\x1b[22m\\r\\n' \\
    + b'\\x1b[2m  cc shortcut: no PTY bridge attached.\\x1b[22m\\r\\n'
f = mod.ExactOutputFilter(patterns)
out = f.feed(failure) + f.flush()
assert b'no PTY bridge attached' in out, out
print('ok')
`);
  assert.equal(out.trim(), 'ok');
});

test('hme-claude banner filter does not hold back normal PTY echo', () => {
  const out = runPython(`
import importlib.util
spec = importlib.util.spec_from_file_location('hme_claude_bridge', ${JSON.stringify(SCRIPT)})
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
f = mod.ExactOutputFilter(mod.success_banner_patterns({'cc': ['/compact', 'continue']}))
for ch in b'abcdef':
    got = f.feed(bytes([ch]))
    assert got == bytes([ch]), (ch, got)
assert f.flush() == b''
print('ok')
`);
  assert.equal(out.trim(), 'ok');
});

test('hme-claude resolves dynamic c& control-line prompt', () => {
  const out = runPython(`
import importlib.util
spec = importlib.util.spec_from_file_location('hme_claude_bridge', ${JSON.stringify(SCRIPT)})
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
token, prompt = mod.decode_control_line(b'c&\\tY29udGludWU=\\n')
assert token == 'c&', token
assert prompt == 'continue', prompt
assert mod.resolve_steps({'c&': ['/compact', '$prompt']}, token, prompt) == ['/compact', 'continue']
assert mod.resolve_steps({'c&': ['/compact', '$prompt']}, 'c&', '') == ['/compact', '']
print('ok')
`);
  assert.equal(out.trim(), 'ok');
});
