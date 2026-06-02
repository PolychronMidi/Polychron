#!/usr/bin/env node
'use strict';

const fs = require('fs');

// Read stdin FIRST so any downstream failure can still surface the raw lines.
let input = [];
try { input = fs.readFileSync(0, 'utf8').split('\n').filter(Boolean); } catch (_e) { input = []; }
const write = (lines) => process.stdout.write(lines.join('\n') + (lines.length ? '\n' : ''));

try {
  const { requireEnv } = require('../proxy/shared/load_env');
  const root = requireEnv('PROJECT_ROOT');
  const incidents = require('../proxy/incident_registry');
  write(incidents.unresolvedLines(root, input));
} catch (_e) {
  // Fail SAFE: a broken env/resolver must never silently swallow real LIFESAVER
  // errors. Surface every input line unchanged so the hook still blocks/alerts.
  write(input);
}
