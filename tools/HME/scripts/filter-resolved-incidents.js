#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const root = process.env.PROJECT_ROOT || path.resolve(__dirname, '..', '..', '..');
const incidents = require('../proxy/incident_registry');
const input = fs.readFileSync(0, 'utf8').split('\n').filter(Boolean);
const out = incidents.unresolvedLines(root, input);
process.stdout.write(out.join('\n') + (out.length ? '\n' : ''));
