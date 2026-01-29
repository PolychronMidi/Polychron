const fs = require('fs');
const path = require('path');
const { checkCriticalsSince } = require('../scripts/play-guard-check');

beforeEach(() => {
  const out = path.join(process.cwd(), 'output');
  if (!fs.existsSync(out)) fs.mkdirSync(out, { recursive: true });
  const p = path.join(out, 'critical-errors.ndjson');
  try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (e) { /* swallow */ }
});

test('checkCriticalsSince returns entries written after run start', () => {
  const out = path.join(process.cwd(), 'output');
  const p = path.join(out, `critical-errors.${Date.now()}.ndjson`);
  const older = { when: new Date(Date.now() - 60000).toISOString(), key: 'old', msg: 'old' };
  const newer = { when: new Date().toISOString(), key: 'new', msg: 'new' };
  fs.appendFileSync(p, JSON.stringify(older) + '\n');
  fs.appendFileSync(p, JSON.stringify(newer) + '\n');

  const res = checkCriticalsSince(new Date(Date.now() - 10000).toISOString(), p);
  expect(Array.isArray(res)).toBe(true);
  expect(res.some(r => r.key === 'new')).toBe(true);
  expect(res.some(r => r.key === 'old')).toBe(false);
});

test('checkCriticalsSince returns empty when no recent entries', () => {
  const out = path.join(process.cwd(), 'output');
  const p = path.join(out, `critical-errors.${Date.now()}.ndjson`);
  const older = { when: new Date(Date.now() - 60000).toISOString(), key: 'old', msg: 'old' };
  fs.appendFileSync(p, JSON.stringify(older) + '\n');

  const res = checkCriticalsSince(new Date().toISOString(), p);
  expect(res.length).toBe(0);
});

afterAll(() => {
  const p = path.join(process.cwd(), 'output', 'critical-errors.ndjson');
  try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (e) { /* swallow */ }
});
