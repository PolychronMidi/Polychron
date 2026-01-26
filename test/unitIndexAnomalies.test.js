import { it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

it('PLAY_LIMIT=1 produces no unit index anomalies', () => {
  const out = path.join(process.cwd(), 'output');
  const anomalies = path.join(out, 'unitIndex-anomalies.ndjson');
  const anomaliesRich = path.join(out, 'unitIndex-anomalies-rich.ndjson');

  // Clean previous artifacts
  try { if (fs.existsSync(anomalies)) fs.unlinkSync(anomalies); } catch (e) {}
  try { if (fs.existsSync(anomaliesRich)) fs.unlinkSync(anomaliesRich); } catch (e) {}

  // Run deterministic play
  const res = spawnSync(process.execPath, [path.join('src','play.js')], { env: { ...process.env, PLAY_LIMIT: '1', INDEX_TRACES: '1' }, stdio: 'inherit' });
  if (res.error) throw res.error;

  // Read anomalies file
  const exists = fs.existsSync(anomalies);
  const lines = exists ? fs.readFileSync(anomalies, 'utf8').trim().split(/\r?\n/).filter(Boolean) : [];

  // Fail if any anomalies were produced
  expect(lines.length, `Expected no unit index anomalies, found ${lines.length}. See ${anomalies} for details.`).toBe(0);
});
