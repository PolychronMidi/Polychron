const fs = require('fs');
const path = require('path');

// Use Vitest globals (configured via vitest.config.mjs)
/* global describe, it, expect, beforeEach, afterEach */

const { appendToFile, writeDebugFile, writeIndexTrace, isEnabled } = require('../src/logGate');

const OUT = path.join(process.cwd(), 'output');
const cleanupFile = (name) => { try { const p = path.join(OUT, name); if (fs.existsSync(p)) fs.unlinkSync(p); } catch (e) { /* swallow */ } };

beforeEach(() => {
  cleanupFile('logGate-append-test.ndjson');
  cleanupFile('logGate-debug-test.ndjson');
  cleanupFile('index-traces.ndjson');
});

afterEach(() => {
  delete process.env.DEBUG_TRACES;
  delete process.env.INDEX_TRACES;
});

describe('logGate helpers', () => {
  it('appendToFile always writes an object to output', () => {
    appendToFile('logGate-append-test.ndjson', { hello: 'world' });
    const p = path.join(OUT, 'logGate-append-test.ndjson');
    expect(fs.existsSync(p)).toBe(true);
    const txt = fs.readFileSync(p, 'utf8').trim();
    const lines = txt.split(/\r?\n/).filter(Boolean);
    expect(lines.length).toBeGreaterThan(0);
    const obj = JSON.parse(lines[lines.length - 1]);
    expect(obj.hello).toBe('world');
  });

  it('writeDebugFile respects DEBUG_TRACES gate when enabled', () => {
    delete process.env.DEBUG_TRACES;
    writeDebugFile('logGate-debug-test.ndjson', { a: 1 });
    let p = path.join(OUT, 'logGate-debug-test.ndjson');
    // Should not be written when gate unset
    expect(fs.existsSync(p)).toBe(false);

    process.env.DEBUG_TRACES = '1';
    writeDebugFile('logGate-debug-test.ndjson', { b: 2 });
    expect(fs.existsSync(p)).toBe(true);
    const obj = JSON.parse(fs.readFileSync(p, 'utf8').trim().split(/\r?\n/).filter(Boolean).pop());
    expect(obj.b).toBe(2);
  });

  it('writeIndexTrace respects INDEX_TRACES gate', () => {
    delete process.env.INDEX_TRACES;
    writeIndexTrace({ tag: 'no-gate' });
    let p = path.join(OUT, 'index-traces.ndjson');
    expect(fs.existsSync(p)).toBe(false);

    process.env.INDEX_TRACES = '1';
    writeIndexTrace({ tag: 'ok' });
    expect(fs.existsSync(p)).toBe(true);
    const obj = JSON.parse(fs.readFileSync(p, 'utf8').trim().split(/\r?\n/).filter(Boolean).pop());
    expect(obj.tag).toBe('ok');
    expect(isEnabled('index')).toBe(true);
  });
});
