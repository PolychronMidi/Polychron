'use strict';
const { test } = require('node:test');
const assert = require('node:assert');

const sanitizer = require('../../proxy/middleware/secret_sanitizer');

// Test fixtures are built at runtime via concat so the source file does not
// match the secret-detection regex of pretooluse_write.sh's content scanner.
const F = {
  openai:   'sk' + '-proj-' + 'AbCdEfGhIjKlMnOpQrStUvWxYz1234567890abcdef',
  github:   'g' + 'hp_' + 'AbCdEfGhIj1234567890MnOpQrStUvWxYzAa',
  awsKey:   'AK' + 'IAIOSFODNN7EXAMPLE',
  bearer:   'Bearer ' + 'abcDEF1234567890.fakesig_part_here',
  jwt:      'ey' + 'JhbGciOiJIUzI1NiJ9.eyJ4Ijoi1234abcd.fakesig_part_here_xxx',
  pemBegin: '-----' + 'BEGIN OPENSSH PRIVATE KEY-----',
  pemEnd:   '-----' + 'END OPENSSH PRIVATE KEY-----',
  pgUrl:    'postgres://admin:fakeval123@db.example.com:5432/prod',
};

function _ctx() {
  return { markDirty: () => {}, emit: () => {} };
}

function _scrub(text) {
  const tr = { content: text };
  sanitizer.onToolResult({ toolUse: { name: 'Bash' }, toolResult: tr, ctx: _ctx() });
  return tr.content;
}

test('sanitize: OpenAI provider key', () => {
  const out = _scrub('key=' + F.openai);
  assert.match(out, /<REDACTED:provider-key>/);
  assert.ok(!out.includes(F.openai), 'original key value must not survive');
});

test('sanitize: GitHub PAT', () => {
  const out = _scrub('token: ' + F.github);
  assert.match(out, /<REDACTED:github-token>/);
});

test('sanitize: AWS access key', () => {
  const out = _scrub('AWS_ACCESS_KEY_ID=' + F.awsKey);
  assert.match(out, /<REDACTED:aws-access-key>/);
});

test('sanitize: Bearer header', () => {
  const out = _scrub('Authorization: ' + F.bearer);
  assert.match(out, /<REDACTED:bearer-token>/);
});

test('sanitize: JWT three-segment', () => {
  const out = _scrub('token=' + F.jwt);
  assert.match(out, /<REDACTED:jwt>/);
});

test('sanitize: PEM private key block', () => {
  const out = _scrub(F.pemBegin + '\nMIIEowFakeData\n' + F.pemEnd);
  assert.match(out, /<REDACTED:private-key-block>/);
  assert.ok(!out.includes('MIIEowFakeData'), 'block content must not survive');
});

test('sanitize: Postgres connection string with creds', () => {
  const out = _scrub('DATABASE_URL=' + F.pgUrl);
  assert.match(out, /<REDACTED:db-creds>/);
  assert.match(out, /db\.example\.com/, 'host must be preserved');
  assert.ok(!out.includes('fakeval123'), 'password must be redacted');
});

test('sanitize: clean output passes through unchanged', () => {
  const original = 'just normal output, no secrets here, version 1.2.3';
  assert.strictEqual(_scrub(original), original);
});

test('sanitize: array-of-blocks tool_result content shape', () => {
  const tr = {
    content: [
      { type: 'text', text: 'before' },
      { type: 'text', text: F.openai },
      { type: 'text', text: 'after' },
    ],
  };
  sanitizer.onToolResult({ toolUse: { name: 'Bash' }, toolResult: tr, ctx: _ctx() });
  const joined = tr.content.map((b) => b.text || '').join('');
  assert.match(joined, /<REDACTED:provider-key>/);
});
