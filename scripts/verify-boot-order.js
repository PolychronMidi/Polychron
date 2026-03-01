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

// ---- Auto-fix: rewrite index.js require order based on dependency graph ----
// For each index.js, topologically sort its direct require() children so that
// providers always precede consumers within the same file's scope.

function autoFix(bootOrder, fileToGlobals, globalToFile, globalSet) {
  // Collect every index.js that has direct require() children
  const indexFiles = new Set();
  for (const f of bootOrder) {
    if (f.endsWith('index.js')) indexFiles.add(f);
  }

  let totalRewrites = 0;

  for (const indexFile of indexFiles) {
    const src = fs.readFileSync(indexFile, 'utf8');
    const lines = src.split(/\r?\n/);

    // Parse require blocks: contiguous comment+require lines.
    // A "require entry" = optional comment lines immediately before, then the require line.
    // Non-require, non-comment lines are "anchors" that divide sortable blocks.
    const entries = [];    // { startLine, endLine, reqPath, resolvedAbs, commentLines, reqLine }
    const anchors = [];    // { lineIndex, text } — non-require lines that are NOT comments for requires

    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trimStart();

      // Collect leading comment lines
      const commentStart = i;
      while (i < lines.length && lines[i].trimStart().startsWith('//')) {
        // Peek: is next non-comment line a require?
        let j = i + 1;
        while (j < lines.length && lines[j].trimStart().startsWith('//')) j++;
        if (j < lines.length && /require\s*\(\s*['"]\./.test(lines[j])) {
          i++;
        } else if (i === commentStart) {
          // standalone comment before a non-require line
          break;
        } else {
          break;
        }
      }

      const reqLine = lines[i] || '';
      const reqMatch = reqLine.match(/require\s*\(\s*['"](\.[^'"]+)['"]\s*\)/);
      if (reqMatch) {
        const reqPath = reqMatch[1];
        let resolvedAbs = null;
        try { resolvedAbs = resolveRequire(reqPath, path.dirname(indexFile)); } catch { /* skip */ }
        entries.push({
          startLine: commentStart,
          endLine: i,
          reqPath,
          resolvedAbs,
          text: lines.slice(commentStart, i + 1).join('\n')
        });
        i++;
      } else {
        // Not a require line — anchor
        if (trimmed.length > 0) {
          anchors.push({ lineIndex: i, text: line });
        }
        i++;
      }
    }

    if (entries.length < 2) continue;

    // Build per-file provides/consumes from the boot-order analysis
    const entryFiles = entries.filter(e => e.resolvedAbs).map(e => e.resolvedAbs);

    // Gather all files transitively required by each entry
    function allTransitive(absPath, visited) {
      if (!visited) visited = new Set();
      if (visited.has(absPath)) return visited;
      visited.add(absPath);
      const src2 = fs.readFileSync(absPath, 'utf8');
      for (const req of extractRequires(src2)) {
        if (!req.startsWith('.')) continue;
        try {
          const child = resolveRequire(req, path.dirname(absPath));
          allTransitive(child, visited);
        } catch { /* skip */ }
      }
      return visited;
    }

    // Map: entry resolvedAbs -> Set of all globals provided by it and its transitive children
    const entryProvides = new Map();
    const entryConsumes = new Map();
    for (const entry of entries) {
      if (!entry.resolvedAbs) continue;
      const transitive = allTransitive(entry.resolvedAbs);
      const provides = new Set();
      const consumes = new Set();
      for (const f of transitive) {
        const fp = fileToGlobals.get(f);
        if (fp) for (const g of fp) provides.add(g);
        const fc = scanConsumed(f, globalSet);
        for (const g of fc) consumes.add(g);
      }
      entryProvides.set(entry.resolvedAbs, provides);
      entryConsumes.set(entry.resolvedAbs, consumes);
    }

    // Build directed dependency edges: entry A must come before entry B
    // if A provides a global that B (or its transitive tree) consumes,
    // AND both are owned by this same index.js
    const entryAbsList = entries.filter(e => e.resolvedAbs).map(e => e.resolvedAbs);
    const entryAbsSet = new Set(entryAbsList);
    // Also include all globals provided by transitive children of our entries
    const allProvidedByEntries = new Map(); // global -> entry resolvedAbs
    for (const entry of entries) {
      if (!entry.resolvedAbs) continue;
      const prov = entryProvides.get(entry.resolvedAbs);
      if (prov) for (const g of prov) allProvidedByEntries.set(g, entry.resolvedAbs);
    }

    // edges: Map<resolvedAbs, Set<resolvedAbs>> meaning "key must come BEFORE values in set"
    const mustPrecede = new Map();
    for (const abs of entryAbsSet) mustPrecede.set(abs, new Set());

    for (const entry of entries) {
      if (!entry.resolvedAbs) continue;
      const cons = entryConsumes.get(entry.resolvedAbs);
      if (!cons) continue;
      for (const g of cons) {
        const provider = allProvidedByEntries.get(g);
        if (!provider || provider === entry.resolvedAbs) continue;
        if (!entryAbsSet.has(provider)) continue;
        // provider must come before entry
        mustPrecede.get(provider).add(entry.resolvedAbs);
      }
    }

    // Topological sort (Kahn's algorithm) with stable ordering
    const inDegree = new Map();
    for (const abs of entryAbsSet) inDegree.set(abs, 0);
    for (const [, deps] of mustPrecede) {
      for (const d of deps) inDegree.set(d, (inDegree.get(d) || 0) + 1);
    }

    // Use original order as tiebreaker for stability
    const originalOrder = new Map();
    for (let ei = 0; ei < entries.length; ei++) {
      if (entries[ei].resolvedAbs) originalOrder.set(entries[ei].resolvedAbs, ei);
    }

    const queue = [];
    for (const abs of entryAbsSet) {
      if (inDegree.get(abs) === 0) queue.push(abs);
    }
    queue.sort((a, b) => (originalOrder.get(a) || 0) - (originalOrder.get(b) || 0));

    const sorted = [];
    while (queue.length > 0) {
      const node = queue.shift();
      sorted.push(node);
      const deps = mustPrecede.get(node) || new Set();
      const next = [];
      for (const d of deps) {
        inDegree.set(d, inDegree.get(d) - 1);
        if (inDegree.get(d) === 0) next.push(d);
      }
      next.sort((a, b) => (originalOrder.get(a) || 0) - (originalOrder.get(b) || 0));
      for (const n of next) queue.push(n);
    }

    if (sorted.length !== entryAbsSet.size) {
      // Cycle detected — skip this index.js, can't fix
      console.log('verify-boot-order: --fix: CYCLE detected in ' + rel(indexFile) + ', skipping');
      continue;
    }

    // Build sorted entry list (map resolvedAbs back to entry objects)
    const absToEntry = new Map();
    for (const entry of entries) {
      if (entry.resolvedAbs) absToEntry.set(entry.resolvedAbs, entry);
    }

    // Check if order actually changed
    let changed = false;
    for (let si = 0; si < sorted.length; si++) {
      const origIdx = originalOrder.get(sorted[si]);
      if (origIdx !== si) { changed = true; break; }
    }
    if (!changed) continue;

    // Reconstruct the file: preserve anchor lines in their relative positions,
    // replace require blocks in sorted order.
    // Strategy: collect all require-entry text blocks from original,
    // then emit them in the new sorted order at the same line positions.

    // Gather the original line ranges used by entries
    const entryLineRanges = entries.map(e => ({ start: e.startLine, end: e.endLine }));
    // All lines NOT belonging to any entry
    const nonEntryLines = [];
    const entryLineSet = new Set();
    for (const e of entries) {
      for (let l = e.startLine; l <= e.endLine; l++) entryLineSet.add(l);
    }
    for (let l = 0; l < lines.length; l++) {
      if (!entryLineSet.has(l)) nonEntryLines.push({ lineIndex: l, text: lines[l] });
    }

    // Rebuild: walk through line indices, when we hit entry blocks emit in sorted order
    const newLines = [];
    let entrySlot = 0;
    let lineIdx = 0;

    // Sorted entries in text form
    const sortedEntryTexts = sorted.map(abs => absToEntry.get(abs).text);
    // Entries without resolvedAbs go at end
    const unresolvedEntries = entries.filter(e => !e.resolvedAbs);
    const allSortedTexts = [...sortedEntryTexts, ...unresolvedEntries.map(e => e.text)];

    while (lineIdx < lines.length) {
      if (entryLineSet.has(lineIdx)) {
        // We're at the start of an entry block — emit next sorted entry
        if (entrySlot < allSortedTexts.length) {
          newLines.push(allSortedTexts[entrySlot]);
          entrySlot++;
        }
        // Skip past the original entry's lines
        while (lineIdx < lines.length && entryLineSet.has(lineIdx)) lineIdx++;
      } else {
        newLines.push(lines[lineIdx]);
        lineIdx++;
      }
    }

    const newSrc = newLines.join('\n');
    if (newSrc !== src) {
      fs.writeFileSync(indexFile, newSrc, 'utf8');
      totalRewrites++;
      console.log('verify-boot-order: --fix: rewrote ' + rel(indexFile));
    }
  }

  return totalRewrites;
}

// ---- Main verification ----

const FIX_MODE = process.argv.includes('--fix');

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

  // Phase 3: auto-fix if requested
  let fixedCount = 0;
  if (FIX_MODE && violations.length > 0) {
    fixedCount = autoFix(bootOrder, fileToGlobals, globalToFile, globalSet);
    if (fixedCount > 0) {
      // Re-walk and re-check after fix
      const bootOrder2 = walkBootOrder(path.join(SRC, 'index.js'));
      const prov2 = mapProviders(bootOrder2, globalSet);
      const check2 = checkIntraSubsystemOrder(
        bootOrder2, prov2.fileToGlobals, prov2.globalToFile, globalSet
      );
      if (check2.violations.length === 0) {
        console.log('verify-boot-order: --fix: all ' + violations.length + ' violations resolved (' + fixedCount + ' index.js files rewritten)');
      } else {
        console.log('verify-boot-order: --fix: reduced violations from ' + violations.length + ' to ' + check2.violations.length + ' (' + fixedCount + ' index.js files rewritten)');
        // Update output with post-fix state
        writeOutput(bootOrder2, prov2.fileToGlobals, globalSet, prov2.globalToFile, mapped, orphaned, prov2.reassigned, check2.violations, check2.subsystemCount);
        return;
      }
      writeOutput(bootOrder2, prov2.fileToGlobals, globalSet, prov2.globalToFile, prov2.globalToFile.size, orphaned, prov2.reassigned, check2.violations, check2.subsystemCount);
      return;
    }
  }

  writeOutput(bootOrder, fileToGlobals, globalSet, globalToFile, mapped, orphaned, reassigned, violations, subsystemCount);

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

function writeOutput(bootOrder, fileToGlobals, globalSet, globalToFile, mapped, orphaned, reassigned, violations, subsystemCount) {
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
}

verify();
