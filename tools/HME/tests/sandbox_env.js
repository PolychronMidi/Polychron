'use strict';

const fs = require('fs');
const path = require('path');

function isSecretKey(key) {
  return [
    /_TOKEN$/, /_KEY$/, /_SECRET$/, /_PASSWORD$/, /_PASSWD$/,
    /_API_KEY$/, /_AUTH$/, /_CREDENTIALS?$/,
    /^TELEGRAM_/, /^ANTHROPIC_/, /^OPENAI_/, /^GITHUB_/,
  ].some((re) => re.test(key));
}

function upsert(lines, key, value) {
  let found = false;
  const next = lines.map((line) => {
    if (!line.startsWith(`${key}=`)) return line;
    found = true;
    return `${key}=${value}`;
  });
  if (!found) next.push(`${key}=${value}`);
  return next;
}

function sandboxEnv(repoRoot, sandbox, overrides = {}) {
  let lines = fs.readFileSync(path.join(repoRoot, '.env'), 'utf8').split('\n').map((line) => {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=/);
    if (!match) return line;
    if (match[1] === 'PROJECT_ROOT') return `PROJECT_ROOT=${sandbox}`;
    if (isSecretKey(match[1])) return `${match[1]}=REDACTED-FOR-TEST`;
    return line;
  });
  lines = upsert(lines, 'PROJECT_ROOT', sandbox);
  for (const [key, value] of Object.entries(overrides)) lines = upsert(lines, key, value);
  return lines.join('\n');
}

function writeRedactedEnv(repoRoot, sandbox, overrides = {}) {
  fs.writeFileSync(path.join(sandbox, '.env'), sandboxEnv(repoRoot, sandbox, overrides), { mode: 0o600 });
}

module.exports = { sandboxEnv, writeRedactedEnv };
