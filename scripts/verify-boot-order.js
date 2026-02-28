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

// ---- Scan consumed globals at LOAD TIME only ----
// Only top-level code runs during require(). References inside function
// bodies, method definitions, and arrow-function expressions are deferred
// to runtime — by which point every global has been assigned. We track
// brace depth: depth 0 = top-level, depth >= 1 = inside a function body.
// IIFE wrappers (the `= (() => {` / `= (function() {` pattern used by
// every Polychron module) count as load-time because they execute
// immediately, so we do NOT increment depth for the opening brace of an
// IIFE. We detect IIFEs by looking for `(() => {` or `(function` before
// the opening brace.

function scanConsumed(filePath, globalSet) {
  const src = fs.readFileSync(filePath, 'utf8');
  const consumed = new Set();
  const lines = src.split(/\r?\n/);

  let depth = 0;          // function nesting depth (0 = top-level / IIFE body)
  let iifeDepthOffset = 0; // how many IIFE braces we're inside (don't count)

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const trimmed = line.trimStart();

    // Skip pure comment lines
    if (trimmed.startsWith('//')) continue;

    // Track brace depth, distinguishing IIFE openers from function openers.
    // Scan character-by-character (ignoring string literals and comments).
    let inString = false;
    let stringChar = '';
    let inLineComment = false;
    let inBlockComment = false;

    for (let ci = 0; ci < line.length; ci++) {
      const ch = line[ci];
      const next = line[ci + 1] || '';

      // Block comment handling
      if (inBlockComment) {
        if (ch === '*' && next === '/') { inBlockComment = false; ci++; }
        continue;
      }
      if (inLineComment) continue;
      if (ch === '/' && next === '/') { inLineComment = true; continue; }
      if (ch === '/' && next === '*') { inBlockComment = true; ci++; continue; }

      // String literal handling
      if (inString) {
        if (ch === '\\') { ci++; continue; }
        if (ch === stringChar) inString = false;
        continue;
      }
      if (ch === '\'' || ch === '"' || ch === '`') {
        inString = true;
        stringChar = ch;
        continue;
      }

      // Brace tracking
      if (ch === '{') {
        // Check if this opens an IIFE body: look back for `(() => ` or `(function`
        const preceding = line.slice(0, ci);
        const isIIFE = /\(\s*\(\s*\)\s*=>\s*$/.test(preceding) ||
                        /\(\s*function\s*\w*\s*\([^)]*\)\s*$/.test(preceding);
        if (isIIFE) {
          iifeDepthOffset++;
        } else {
          depth++;
        }
      } else if (ch === '}') {
        if (iifeDepthOffset > 0) {
          // Could be closing an IIFE brace — heuristic: if depth is 0, it's
          // an IIFE closer, otherwise it's a regular function closer.
          if (depth === 0) {
            iifeDepthOffset--;
          } else {
            depth--;
          }
        } else {
          depth = Math.max(0, depth - 1);
        }
      }
    }

    // Only scan identifiers at load-time depth (top-level or inside IIFE body)
    if (depth > 0) continue;

    // Skip require lines
    if (/\brequire\s*\(/.test(line)) continue;

    const idRe = /\b([A-Za-z_$][\w$]*)\b/g;
    let m;
    while ((m = idRe.exec(line)) !== null) {
      if (globalSet.has(m[1])) consumed.add(m[1]);
    }
  }
  return consumed;
}

// ---- Derive subsystem from relative path ----

function subsystemOf(relPath) {
  // src/<subsystem>/... → subsystem
  const match = relPath.match(/^src\/([^/]+)\//);
  return match ? match[1] : null;
}

// ---- Intra-subsystem dependency ordering check ----
// For each subsystem, verify that every global consumed by a module
// that is provided within the SAME subsystem was provided by an
// earlier-loaded file.

function checkIntraSubsystemOrder(bootOrder, fileToGlobals, globalToFile, globalSet) {
  const violations = [];

  // Build: for each file, its boot index
  const bootIndex = new Map();
  for (let i = 0; i < bootOrder.length; i++) bootIndex.set(bootOrder[i], i);

  // Build: for each file, the set of globals it consumes
  const fileConsumes = new Map();
  for (const filePath of bootOrder) {
    fileConsumes.set(filePath, scanConsumed(filePath, globalSet));
  }

  // Group files by subsystem
  const subsystems = new Map();
  for (const filePath of bootOrder) {
    const sub = subsystemOf(rel(filePath));
    if (!sub) continue;
    if (!subsystems.has(sub)) subsystems.set(sub, []);
    subsystems.get(sub).push(filePath);
  }

  // For each subsystem, check that consumed intra-subsystem globals
  // were provided by earlier files
  for (const [sub, files] of subsystems) {
    // Globals provided by this subsystem
    const subsystemProviders = new Map();
    for (const f of files) {
      const provides = fileToGlobals.get(f) || [];
      for (const g of provides) subsystemProviders.set(g, f);
    }

    for (const filePath of files) {
      const consumed = fileConsumes.get(filePath);
      for (const g of consumed) {
        const provider = subsystemProviders.get(g);
        if (!provider) continue; // provided by another subsystem — OK
        if (provider === filePath) continue; // self-provided — OK

        const providerIdx = bootIndex.get(provider);
        const consumerIdx = bootIndex.get(filePath);
        if (providerIdx > consumerIdx) {
          violations.push({
            subsystem: sub,
            consumer: rel(filePath),
            provider: rel(provider),
            global: g,
            consumerOrder: consumerIdx + 1,
            providerOrder: providerIdx + 1
          });
        }
      }
    }
  }

  return { violations, subsystemCount: subsystems.size };
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

  // Phase 2: intra-subsystem ordering
  const { violations, subsystemCount } = checkIntraSubsystemOrder(
    bootOrder, fileToGlobals, globalToFile, globalSet
  );

  // Write forensic output with metadata envelope
  const output = {
    meta: {
      generated: new Date().toISOString(),
      totalFiles: bootOrder.length,
      globalsDeclared: globalSet.size,
      globalsMapped: mapped,
      orphaned: orphaned,
      reassigned: reassigned,
      subsystemCount: subsystemCount,
      intraSubsystemViolations: violations.length
    },
    bootOrder: bootOrder.map(function(f, i) {
      return {
        order: i + 1,
        file: rel(f),
        provides: fileToGlobals.get(f) || []
      };
    }),
    intraSubsystemViolations: violations
  };

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, JSON.stringify(output, null, 2), 'utf8');

  console.log(
    'verify-boot-order: ' + bootOrder.length + ' files, ' +
    mapped + '/' + globalSet.size + ' globals mapped, ' +
    subsystemCount + ' subsystems checked -> output/boot-order.json'
  );

  if (orphaned.length) {
    console.log(
      'verify-boot-order: ' + orphaned.length + ' runtime-assigned globals (no static provider): ' +
      orphaned.slice(0, 8).join(', ') + (orphaned.length > 8 ? ' ...' : '')
    );
  }

  if (violations.length) {
    console.log(
      'verify-boot-order: ' + violations.length + ' intra-subsystem ordering violation(s):'
    );
    for (const v of violations.slice(0, 10)) {
      console.log(
        '  [' + v.subsystem + '] ' + v.consumer + ' (#' + v.consumerOrder +
        ') reads "' + v.global + '" before ' + v.provider + ' (#' + v.providerOrder + ') provides it'
      );
    }
    if (violations.length > 10) {
      console.log('  ... and ' + (violations.length - 10) + ' more');
    }
  }
}

verify();
