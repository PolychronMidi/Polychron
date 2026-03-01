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
  let inBlockComment = false; // persists across lines (multi-line /* */ blocks)

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const trimmed = line.trimStart();

    // Skip pure single-line comment lines (but still process block comment state)
    if (!inBlockComment && trimmed.startsWith('//')) continue;

    // Track brace depth, distinguishing IIFE openers from function openers.
    // Scan character-by-character, building code-only text for identifier scanning.
    let inString = false;
    let stringChar = '';
    let inLineComment = false;
    const codeParts = [];   // accumulate code-only text (no strings/comments)
    let codeStart = inBlockComment ? -1 : 0;

    for (let ci = 0; ci < line.length; ci++) {
      const ch = line[ci];
      const next = line[ci + 1] || '';

      // Block comment handling (persists across lines)
      if (inBlockComment) {
        if (ch === '*' && next === '/') { inBlockComment = false; ci++; codeStart = ci + 1; }
        continue;
      }
      if (inLineComment) continue;
      if (ch === '/' && next === '/') {
        if (codeStart >= 0 && codeStart < ci) codeParts.push(line.slice(codeStart, ci));
        codeStart = -1;
        inLineComment = true;
        continue;
      }
      if (ch === '/' && next === '*') {
        if (codeStart >= 0 && codeStart < ci) codeParts.push(line.slice(codeStart, ci));
        codeStart = -1;
        inBlockComment = true;
        ci++;
        continue;
      }

      // String literal handling
      if (inString) {
        if (ch === '\\') { ci++; continue; }
        if (ch === stringChar) { inString = false; codeStart = ci + 1; }
        continue;
      }
      if (ch === '\'' || ch === '"' || ch === '`') {
        if (codeStart >= 0 && codeStart < ci) codeParts.push(line.slice(codeStart, ci));
        inString = true;
        stringChar = ch;
        codeStart = -1;
        continue;
      }

      // Brace tracking — integrate with codeParts so only depth-0 code is collected.
      // One-line functions like `function f() { return globalVar; }` open and
      // close on the same line, leaving depth at 0 at line end. Without per-brace
      // flushing, the function-body code would be scanned for globals.
      if (ch === '{') {
        // Check if this opens an IIFE body: `(() => {` or `(function() {`
        // Exclude named function expressions like (function name(args) {)
        const preceding = line.slice(0, ci);
        const isIIFE = /\(\s*\(\s*\)\s*=>\s*$/.test(preceding) ||
                        /\(\s*function\s*\([^)]*\)\s*$/.test(preceding);
        if (isIIFE) {
          iifeDepthOffset++;
        } else {
          if (depth === 0 && codeStart >= 0 && codeStart < ci) {
            codeParts.push(line.slice(codeStart, ci));
            codeStart = -1;
          }
          depth++;
        }
      } else if (ch === '}') {
        if (iifeDepthOffset > 0) {
          if (depth === 0) {
            iifeDepthOffset--;
          } else {
            depth--;
          }
        } else {
          depth = Math.max(0, depth - 1);
        }
        // Returning to depth 0: start a new code segment after the closing brace
        if (depth === 0) {
          codeStart = ci + 1;
        }
      }
    }

    // Close any trailing code range (only at depth 0)
    if (depth === 0 && codeStart >= 0 && codeStart < line.length && !inBlockComment && !inLineComment) {
      codeParts.push(line.slice(codeStart));
    }

    // Skip lines entirely inside function bodies
    if (depth > 0) continue;

    // Skip require lines
    if (/\brequire\s*\(/.test(line)) continue;

    // Scan identifiers only in code portions (comments and strings excluded)
    const codeOnly = codeParts.join(' ');
    const idRe = /\b([A-Za-z_$][\w$]*)\b/g;
    let m;
    while ((m = idRe.exec(codeOnly)) !== null) {
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
      const selfProvides = new Set(fileToGlobals.get(filePath) || []);
      const fRel = rel(filePath);

      for (const g of consumed) {
        const provider = subsystemProviders.get(g);
        if (!provider) continue; // provided by another subsystem — OK
        if (provider === filePath) continue; // self-provided — OK
        // Consumer also assigns this global (re-assignment) — not a real dependency
        if (selfProvides.has(g)) continue;
        // index.js consuming globals from its own children is safe
        // (children load during index.js execution via require)
        if (fRel.endsWith('/index.js')) {
          const dir = fRel.replace(/\/index\.js$/, '/');
          if (rel(provider).startsWith(dir)) continue;
        }

        const providerIdx = bootIndex.get(provider);
        const consumerIdx = bootIndex.get(filePath);
        if (providerIdx > consumerIdx) {
          violations.push({
            subsystem: sub,
            consumer: fRel,
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

// ---- Auto-fix: rewrite index.js require order based on violations ----
// Strategy: use the already-computed violations to know exactly which files
// need to move before which. For each index.js, build a constraint graph
// from violations where both consumer and provider are direct children of
// that index.js, then topologically sort. Falls back to original order on
// cycles. Skips src/index.js (architecturally mandated subsystem order).

function autoFix(violations, bootOrder, fileToGlobals, globalToFile, globalSet) {
  const TOP_INDEX = path.join(SRC, 'index.js');

  // Build map: file -> the index.js that directly requires it
  // (i.e. its parent index.js)
  const fileToParentIndex = new Map();
  const indexChildren = new Map(); // indexFile -> [resolvedAbs, ...]

  for (const f of bootOrder) {
    if (!f.endsWith('index.js')) continue;
    const src = fs.readFileSync(f, 'utf8');
    const children = [];
    for (const req of extractRequires(src)) {
      if (!req.startsWith('.')) continue;
      try {
        const child = resolveRequire(req, path.dirname(f));
        children.push(child);
        fileToParentIndex.set(child, f);
      } catch { /* skip */ }
    }
    indexChildren.set(f, children);
  }

  // For each file in boot order, find which index.js child it belongs to
  // (it may be a deeply nested file — trace back to the direct child)
  function directChildOf(file, idxFile) {
    const children = indexChildren.get(idxFile);
    if (!children) return null;
    for (const child of children) {
      if (file === child) return child;
      // Check if file is transitively under child
      const transitive = walkTransitive(child);
      if (transitive.has(file)) return child;
    }
    return null;
  }

  const transitiveCache = new Map();
  function walkTransitive(absPath) {
    if (transitiveCache.has(absPath)) return transitiveCache.get(absPath);
    const visited = new Set();
    const stack = [absPath];
    while (stack.length) {
      const f = stack.pop();
      if (visited.has(f)) continue;
      visited.add(f);
      try {
        const src2 = fs.readFileSync(f, 'utf8');
        for (const req of extractRequires(src2)) {
          if (!req.startsWith('.')) continue;
          try {
            const child = resolveRequire(req, path.dirname(f));
            if (!visited.has(child)) stack.push(child);
          } catch { /* skip */ }
        }
      } catch { /* skip */ }
    }
    transitiveCache.set(absPath, visited);
    return visited;
  }

  // Cache for scanConsumed results (avoid re-reading files per index)
  const consumedCache = new Map();
  function getCachedConsumed(f) {
    if (consumedCache.has(f)) return consumedCache.get(f);
    const result = scanConsumed(f, globalSet);
    consumedCache.set(f, result);
    return result;
  }

  // Group violations by the index.js that owns both consumer and provider
  const violationsByIndex = new Map(); // indexFile -> [{providerChild, consumerChild}]

  for (const v of violations) {
    const consumerAbs = path.join(ROOT, v.consumer);
    const providerAbs = path.join(ROOT, v.provider);

    // Find the common parent index.js
    for (const [idxFile, children] of indexChildren) {
      if (idxFile === TOP_INDEX) continue; // never touch src/index.js

      const consChild = directChildOf(consumerAbs, idxFile);
      const provChild = directChildOf(providerAbs, idxFile);

      if (consChild && provChild && consChild !== provChild) {
        if (!violationsByIndex.has(idxFile)) violationsByIndex.set(idxFile, []);
        violationsByIndex.get(idxFile).push({
          providerChild: provChild,
          consumerChild: consChild,
          global: v.global
        });
        break;
      }
    }
  }

  let totalRewrites = 0;

  for (const [idxFile, vList] of violationsByIndex) {
    const src = fs.readFileSync(idxFile, 'utf8');
    const lines = src.split(/\r?\n/);
    const children = indexChildren.get(idxFile);
    if (!children || children.length < 2) continue;

    // Parse require entries: each is a contiguous block of comment lines
    // immediately followed by a require line. We record the line range.
    const reqEntries = []; // { startLine, endLine, resolvedAbs }

    let li = 0;
    while (li < lines.length) {
      // Skip non-comment, non-require lines
      if (!lines[li].trimStart().startsWith('//') && !/require\s*\(\s*['"]\./.test(lines[li])) {
        li++;
        continue;
      }

      // Collect leading comment lines
      const commentStart = li;
      while (li < lines.length && lines[li].trimStart().startsWith('//')) li++;

      // Check if a require line follows
      if (li < lines.length && /require\s*\(\s*['"]\./.test(lines[li])) {
        const reqMatch = lines[li].match(/require\s*\(\s*['"](\.[^'"]+)['"]\s*\)/);
        let resolvedAbs = null;
        if (reqMatch) {
          try { resolvedAbs = resolveRequire(reqMatch[1], path.dirname(idxFile)); } catch { /* skip */ }
        }
        reqEntries.push({ startLine: commentStart, endLine: li, resolvedAbs });
        li++;
      } else {
        // Comments didn't lead to a require — skip them
        // (li is already past the comments)
      }
    }

    if (reqEntries.length < 2) continue;

    // Build FULL dependency graph between children of this index file.
    // For each child, compute globals provided and consumed by its
    // transitive subtree. Add edge A->B whenever A provides a global
    // consumed at load-time by B's subtree (and B doesn't self-provide it).
    // This prevents the topo sort from breaking already-satisfied deps.
    const childProvides = new Map();
    const childConsumes = new Map();
    for (const re of reqEntries) {
      if (!re.resolvedAbs) continue;
      const subtree = walkTransitive(re.resolvedAbs);
      const provSet = new Set();
      const consSet = new Set();
      for (const f of subtree) {
        const provs = fileToGlobals.get(f) || [];
        for (const g of provs) {
          // Only credit this subtree if it is the authoritative (last) provider.
          // Re-assigned globals whose final writer is in a different subtree
          // would create false dependency edges and spurious cycles.
          if (globalToFile.get(g) === f) provSet.add(g);
        }
        const cons = getCachedConsumed(f);
        for (const g of cons) consSet.add(g);
      }
      childProvides.set(re.resolvedAbs, provSet);
      childConsumes.set(re.resolvedAbs, consSet);
    }

    const mustPrecede = new Map();
    for (const re of reqEntries) {
      if (re.resolvedAbs) mustPrecede.set(re.resolvedAbs, new Set());
    }

    for (const entryA of reqEntries) {
      if (!entryA.resolvedAbs) continue;
      const provA = childProvides.get(entryA.resolvedAbs);
      for (const entryB of reqEntries) {
        if (!entryB.resolvedAbs || entryA.resolvedAbs === entryB.resolvedAbs) continue;
        const consB = childConsumes.get(entryB.resolvedAbs);
        const provB = childProvides.get(entryB.resolvedAbs);
        for (const g of provA) {
          if (consB.has(g) && !provB.has(g)) {
            mustPrecede.get(entryA.resolvedAbs).add(entryB.resolvedAbs);
            break;
          }
        }
      }
    }

    // Topological sort with Kahn's, using original order as stable tiebreaker
    const origIdx = new Map();
    for (let ri = 0; ri < reqEntries.length; ri++) {
      if (reqEntries[ri].resolvedAbs) origIdx.set(reqEntries[ri].resolvedAbs, ri);
    }

    const resolvedSet = new Set(reqEntries.filter(e => e.resolvedAbs).map(e => e.resolvedAbs));
    const inDeg = new Map();
    for (const abs of resolvedSet) inDeg.set(abs, 0);
    for (const [, targets] of mustPrecede) {
      for (const t of targets) {
        if (inDeg.has(t)) inDeg.set(t, inDeg.get(t) + 1);
      }
    }

    const queue = [...resolvedSet].filter(a => inDeg.get(a) === 0);
    queue.sort((a, b) => (origIdx.get(a) || 0) - (origIdx.get(b) || 0));

    const sorted = [];
    while (queue.length) {
      const node = queue.shift();
      sorted.push(node);
      for (const t of (mustPrecede.get(node) || [])) {
        inDeg.set(t, inDeg.get(t) - 1);
        if (inDeg.get(t) === 0) queue.push(t);
      }
      queue.sort((a, b) => (origIdx.get(a) || 0) - (origIdx.get(b) || 0));
    }

    if (sorted.length !== resolvedSet.size) {
      console.log('verify-boot-order: --fix: cycle in ' + rel(idxFile) + ', using best-effort sort');
      for (const abs of resolvedSet) {
        if (!sorted.includes(abs)) sorted.push(abs);
      }
      sorted.sort((a, b) => (origIdx.get(a) || 0) - (origIdx.get(b) || 0));
    }

    // Map resolvedAbs -> reqEntry
    const absToEntry = new Map();
    for (const re of reqEntries) {
      if (re.resolvedAbs) absToEntry.set(re.resolvedAbs, re);
    }

    // Check if anything actually moved
    const resolvedEntries = reqEntries.filter(e => e.resolvedAbs);
    let changed = false;
    for (let si = 0; si < sorted.length; si++) {
      if (sorted[si] !== resolvedEntries[si].resolvedAbs) { changed = true; break; }
    }
    if (!changed) continue;

    // Reconstruct file by region-based assembly.
    // Collect all require entries sorted by startLine to identify gaps.
    // Output = gap0 + sorted[0] + gap1 + sorted[1] + ... + gapN
    // where gaps are the original lines between/around require entries.
    const slots = resolvedEntries.map(e => ({ start: e.startLine, end: e.endLine }));
    const sortedLineArrays = sorted.map(abs => {
      const e = absToEntry.get(abs);
      return lines.slice(e.startLine, e.endLine + 1);
    });

    const result = [];

    // Lines before first slot
    for (let l = 0; l < slots[0].start; l++) result.push(lines[l]);

    for (let si = 0; si < slots.length; si++) {
      // Emit sorted entry for this slot
      for (const sl of sortedLineArrays[si]) result.push(sl);

      // Emit gap between this slot and next slot (or end of file)
      const gapStart = slots[si].end + 1;
      const gapEnd = (si + 1 < slots.length) ? slots[si + 1].start : lines.length;
      for (let l = gapStart; l < gapEnd; l++) result.push(lines[l]);
    }

    const eol = src.includes('\r\n') ? '\r\n' : '\n';
    const newSrc = result.join(eol);
    if (newSrc !== src) {
      fs.writeFileSync(idxFile, newSrc, 'utf8');
      totalRewrites++;
      console.log('verify-boot-order: --fix: rewrote ' + rel(idxFile));
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
    fixedCount = autoFix(violations, bootOrder, fileToGlobals, globalToFile, globalSet);
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
