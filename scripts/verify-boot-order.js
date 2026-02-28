// scripts/verify-boot-order.js
// Walks the require chains from src/index.js to build the complete flat
// boot order, maps each file to the global(s) it provides, and cross-
// references with globals.d.ts. Writes output/boot-order.json for forensics.
//
// Fails fast on:
//   - Unresolvable require() paths
//   - Circular require chains
//
// Warns on:
//   - Re-assigned globals (same global assigned in multiple files - last wins)
//
// Run automatically as part of `npm run main`.

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT        = path.join(__dirname, '..');
const SRC         = path.join(ROOT, 'src');
const GLOBALS_DTS = path.join(SRC, 'types', 'globals.d.ts');
const OUTPUT      = path.join(ROOT, 'output', 'boot-order.json');

// ---- Parse globals.d.ts for every `declare var NAME:` entry ----

function parseDeclaredGlobals() {
  const src = fs.readFileSync(GLOBALS_DTS, 'utf8');
  const names = new Set();
  const re = /^\s*declare\s+var\s+([A-Za-z_$][\w$]*)\s*:/gm;
  let match;
  while ((match = re.exec(src)) !== null) names.add(match[1]);
  if (names.size === 0) throw new Error('verify-boot-order: no declarations found in globals.d.ts');
  return names;
}

// ---- Resolve a relative require path to an absolute .js file ----

function resolveRequire(reqPath, fromDir) {
  const abs = path.resolve(fromDir, reqPath);
  const withJs = abs + '.js';
  if (fs.existsSync(withJs) && fs.statSync(withJs).isFile()) return withJs;
  const idx = path.join(abs, 'index.js');
  if (fs.existsSync(idx)) return idx;
  if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return abs;
  throw new Error(
    'verify-boot-order: cannot resolve require(\'' + reqPath + '\') from ' + rel(fromDir)
  );
}

// ---- Extract require('...') calls from source, skipping comment lines ----

function extractRequires(source) {
  const out = [];
  for (const line of source.split(/\r?\n/)) {
    if (line.trimStart().startsWith('//')) continue;
    const re = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
    let m;
    while ((m = re.exec(line)) !== null) out.push(m[1]);
  }
  return out;
}

// ---- Walk the require tree depth-first, recording boot order ----
// Files are recorded when first entered (pre-order) - matching CommonJS
// execution semantics where a module's top-level code runs before control
// returns to the parent.

function walkBootOrder(entryAbs) {
  const visited = new Set();
  const order   = [];
  const stack   = [];

  function visit(absPath) {
    if (visited.has(absPath)) return;
    if (stack.includes(absPath)) {
      const cycle = stack.slice(stack.indexOf(absPath)).map(rel);
      throw new Error(
        'verify-boot-order: circular require:\n  ' + cycle.join(' -> ') + ' -> ' + rel(absPath)
      );
    }

    visited.add(absPath);
    stack.push(absPath);
    order.push(absPath);

    for (const req of extractRequires(fs.readFileSync(absPath, 'utf8'))) {
      if (!req.startsWith('.')) continue;
      visit(resolveRequire(req, path.dirname(absPath)));
    }

    stack.pop();
  }

  visit(entryAbs);
  return order;
}

// ---- Map each file to the declared globals it provides ----
// A global is "provided" when its name appears as a bare assignment at the
// start of a line (column 0): `NAME = ...` but NOT `NAME ==` or ` NAME = `.
// Also handles destructuring: `[a, b] = ...` at column 0.

function mapProviders(bootOrder, globalSet) {
  const globalToFile  = new Map();
  const fileToGlobals = new Map();
  const reassigned    = [];

  function record(name, filePath, provided) {
    if (!globalSet.has(name) || provided.includes(name)) return;
    if (globalToFile.has(name)) {
      reassigned.push({ name, from: rel(globalToFile.get(name)), to: rel(filePath) });
    }
    globalToFile.set(name, filePath);
    provided.push(name);
  }

  for (const filePath of bootOrder) {
    const src      = fs.readFileSync(filePath, 'utf8');
    const provided = [];

    for (const line of src.split(/\r?\n/)) {
      // Only scan unindented lines (column-0 assignments match global convention)
      if (!line.length || line[0] === ' ' || line[0] === '\t' || line[0] === '/') continue;

      // Destructuring: [a, b] = ... or [a,b,c] = ...
      if (line[0] === '[') {
        const bracket = line.match(/^\[([^\]]+)\]\s*=/);
        if (bracket) {
          for (const id of bracket[1].split(',')) {
            const name = id.trim();
            if (/^[A-Za-z_$][\w$]*$/.test(name)) record(name, filePath, provided);
          }
        }
        continue;
      }

      // Match ALL identifier assignments on the line:
      //   chain:  a=b=c=0        -> a, b, c
      //   multi:  a=0;b=1;c=2    -> a, b, c
      //   alias:  rf=randomFloat= -> rf, randomFloat
      // Negative lookbehind excludes property access (obj.prop) without
      // consuming the separator character between chain identifiers.
      const re = /(?<![.\w$])([A-Za-z_$][\w$]*)\s*=(?!=)/g;
      let m;
      while ((m = re.exec(line)) !== null) record(m[1], filePath, provided);
    }

    if (provided.length) fileToGlobals.set(filePath, provided);
  }

  if (reassigned.length) {
    console.log(
      'verify-boot-order: ' + reassigned.length + ' re-assigned global(s) (last writer wins):\n  ' +
      reassigned.map(function(r) { return r.name + ': ' + r.from + ' -> ' + r.to; }).join('\n  ')
    );
  }
  return { globalToFile, fileToGlobals, reassigned };
}

// ---- Helpers ----

function rel(absPath) {
  return path.relative(ROOT, absPath).replace(/\\/g, '/');
}

// ---- Main verification ----

function verify() {
  const globalSet = parseDeclaredGlobals();
  const bootOrder = walkBootOrder(path.join(SRC, 'index.js'));
  const { globalToFile, fileToGlobals, reassigned } = mapProviders(bootOrder, globalSet);

  const mapped   = globalToFile.size;
  const orphaned = [...globalSet].filter(n => !globalToFile.has(n));

  // Write forensic output with metadata envelope
  const output = {
    meta: {
      generated: new Date().toISOString(),
      totalFiles: bootOrder.length,
      globalsDeclared: globalSet.size,
      globalsMapped: mapped,
      orphaned: orphaned,
      reassigned: reassigned
    },
    bootOrder: bootOrder.map(function(f, i) {
      return {
        order: i + 1,
        file: rel(f),
        provides: fileToGlobals.get(f) || []
      };
    })
  };

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, JSON.stringify(output, null, 2), 'utf8');

  console.log(
    'verify-boot-order: ' + bootOrder.length + ' files, ' +
    mapped + '/' + globalSet.size + ' globals mapped -> output/boot-order.json'
  );

  if (orphaned.length) {
    console.log(
      'verify-boot-order: ' + orphaned.length + ' runtime-assigned globals (no static provider): ' +
      orphaned.slice(0, 8).join(', ') + (orphaned.length > 8 ? ' ...' : '')
    );
  }
}

verify();
