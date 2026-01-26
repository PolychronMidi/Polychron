#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { Project } = require('ts-morph');
const chokidar = require('chokidar');
const child_process = require('child_process');

// parseCoverageStats wrapper: prefer requiring the helper directly, but if it's an ES module
// fallback to spawning node to dynamically import and call the function synchronously.
function parseCoverageStats(projectRoot = process.cwd()) {
  try {
    const mod = require('./coverage-utils.js');
    if (mod && typeof mod.parseCoverageStats === 'function') return mod.parseCoverageStats(projectRoot);
  } catch (e) {
    // try dynamic import via a child Node process to handle ES modules
    try {
      const cmd = `import('./coverage-utils.js').then(m => console.log(JSON.stringify(m.parseCoverageStats(${JSON.stringify(projectRoot)})))).catch(err => { console.error(err && err.stack ? err.stack : err); process.exit(1); });`;
      const r = child_process.spawnSync(process.execPath, ['-e', cmd], { encoding: 'utf8' });
      if (r && r.status === 0 && r.stdout) {
        try {
          return JSON.parse(r.stdout.trim());
        } catch (e2) {}
      }
    } catch (e2) {}
  }
  return { summary: 'Coverage data unavailable', statements: null, branches: null, functions: null, lines: null };
}
let stripAnsi;
let readLogSafe;
let formatDate;
let splitByCodeFences;
let normalizeCodeForComparison;
let getFailuresFromLog;

async function loadDeps() {
  // Try CommonJS require first, fallback to dynamic import for ESM modules
  // Prefer dynamic import (handles ESM); fall back to require where necessary
  try { const m = await import('./utils/stripAnsi.js'); stripAnsi = m.default || m; } catch (e) { stripAnsi = require('./utils/stripAnsi.js'); }
  try { const m = await import('./utils/readLogSafe.js'); readLogSafe = m.default || m; } catch (e) { readLogSafe = require('./utils/readLogSafe.js'); }
  try { const m = await import('./utils/formatDate.js'); formatDate = m.default || m; } catch (e) { formatDate = require('./utils/formatDate.js'); }
  try { const m = await import('./utils/splitByCodeFences.js'); splitByCodeFences = m.default || m; } catch (e) { splitByCodeFences = require('./utils/splitByCodeFences.js'); }
  try { const m = await import('./utils/normalizeCodeForComparison.js'); normalizeCodeForComparison = m.default || m; } catch (e) { normalizeCodeForComparison = require('./utils/normalizeCodeForComparison.js'); }
  try { const m = await import('./utils/getFailuresFromLog.js'); getFailuresFromLog = m.getFailuresFromLog || m.default || m; } catch (e) { const gf = require('./utils/getFailuresFromLog.js'); getFailuresFromLog = gf.getFailuresFromLog || gf; }
}

const projectRoot = process.cwd();
const srcDir = path.join(projectRoot, 'src');
const docsDir = path.join(projectRoot, 'docs');
const logDir = path.join(projectRoot, 'log');

// Generate mapping dynamically: scan /src for .js files and create docs mapping
function generateModuleMapping() {
  const modules = [];

  function scanDir(dir, baseRelative = '') {
    const entries = fs.readdirSync(dir);
    for (const entry of entries) {
      const fullPath = path.join(dir, entry);
      const stat = fs.statSync(fullPath);
      const relative = path.join(baseRelative, entry);

      if (stat.isDirectory()) {
        scanDir(fullPath, relative);
      } else if (entry.endsWith('.js')) {
        // Convert .js to .md
        const docName = entry.replace(/\.js$/, '.md');
        const docPath = baseRelative ? path.join(baseRelative, docName) : docName;
        modules.push({ name: relative, doc: docPath });
      }
    }
  }

  scanDir(srcDir);
  return modules;
}

// Mapping: source file -> doc file (generated dynamically)
const modules = generateModuleMapping();
const docBySrc = new Map(modules.map(m => [path.join(srcDir, m.name), path.join(docsDir, m.doc)]));
const srcByDoc = new Map(modules.map(m => [path.join(docsDir, m.doc), path.join(srcDir, m.name)]));


/**
 * Parse test run statistics from the test log.
 * @returns {{summary:string|null,total:number|null,passed:number|null,failed:number|null,percentage:number|null}}
 */
function parseTestStats() {
  const raw = readLogSafe(projectRoot, 'test.log');
  if (!raw.trim()) return { summary: 'No recent test run (log/test.log not found)', tests: null, testFiles: null };
  const clean = stripAnsi(raw);

  // If the test runner process exited with a non-zero code, prefer a clear summary
  const exitMatches = [...clean.matchAll(/PROCESS EXIT:\s*code=(\d+)/gi)];
  if (exitMatches.length) {
    const code = Number(exitMatches.pop()[1]);
    if (!Number.isNaN(code) && code !== 0) {
      return { summary: `Test run failed (exit code=${code})`, tests: null, testFiles: null };
    }
  }

  // Common Windows / shell failure message: npm not found
  if (/npm' is not recognized|npm is not recognized|npm: command not found/i.test(clean)) {
    return { summary: 'Test runner unavailable (npm not found)', tests: null, testFiles: null };
  }

  // Parse the "Test Files" summary line (if present)
  const testFilesMatch = clean.match(/Test Files\s+.*?(\d+)\s+passed(?:\s*\|\s*(\d+)\s+skipped)?\s*\((\d+)\)/i);
  const testFiles = { total: null, passed: null, skipped: 0, percentage: null };
  if (testFilesMatch) {
    testFiles.passed = Number(testFilesMatch[1]);
    testFiles.skipped = Number(testFilesMatch[2] || 0);
    testFiles.total = Number(testFilesMatch[3]);
    if (testFiles.total > 0) testFiles.percentage = Math.round((testFiles.passed / testFiles.total) * 1000) / 10;
  }

  // Parse the "Tests" summary line (preferred)
  const testsMatch = clean.match(/Tests\s+(\d+)\s+passed(?:\s*\|\s*(\d+)\s+skipped)?\s*\((\d+)\)/i);
  const failedMatch = clean.match(/Tests\s+(\d+)\s+failed.*?(\d+)\s+passed.*?(\d+)\s+total/i);
  const tests = { total: null, passed: null, skipped: 0, failed: null, percentage: null };

  if (testsMatch) {
    tests.passed = Number(testsMatch[1]);
    tests.skipped = Number(testsMatch[2] || 0);
    tests.total = Number(testsMatch[3]);
  } else if (failedMatch) {
    tests.failed = Number(failedMatch[1]);
    tests.passed = Number(failedMatch[2]);
    tests.total = Number(failedMatch[3]);
  }

  // If still missing, try a fallback that finds a recent 'tests' containing line and heuristically extracts numbers
  if (tests.total === null) {
    const fallbackLine = clean.split(/\r?\n/).reverse().find(l => /\btests?\b/i.test(l) || /Test Files\b/i.test(l)) || '';
    const nums = (fallbackLine.match(/\d+/g) || []).map(Number);
    if (nums.length >= 2) {
      // Heuristic: first number may be passed, last is likely total
      tests.passed = tests.passed || nums[0];
      tests.total = tests.total || nums[nums.length - 1];
    }
  }

  // If values still missing, return an explanatory summary
  if (tests.total === null && !testFiles.total) {
    return { summary: 'Data unavailable (could not parse test results)', tests: null, testFiles: testFiles.total ? testFiles : null };
  }

  // Sanity: if parsed passed > total, log warning and swap (rare but observed in noisy logs)
  if (tests.passed !== null && tests.total !== null && tests.passed > tests.total) {
    console.warn(`parseTestStats: parsed passed (${tests.passed}) > total (${tests.total}) - swapping to correct order`);
    const tmp = tests.passed;
    tests.passed = tests.total;
    tests.total = tmp;
  }

  if (tests.failed === null && tests.total !== null && tests.passed !== null) {
    tests.failed = Math.max(tests.total - tests.passed - (tests.skipped || 0), 0);
  }

  if (tests.total && tests.passed !== null) {
    tests.percentage = tests.total > 0 ? Math.round((tests.passed / tests.total) * 1000) / 10 : null;
  }

  return { summary: null, tests, testFiles: testFiles.total ? testFiles : null };
}

/**
 * Parse lint stats from lint log.
 * @returns {{summary:string|null,errors:number,warnings:number}}
 */
function parseLintStats() {
  const raw = readLogSafe(projectRoot, 'lint.log');
  if (!raw.trim()) return { summary: 'No recent lint run (log/lint.log not found)', errors: 0, warnings: 0 };
  const clean = stripAnsi(raw);
  const summaryMatch = clean.match(/(\d+)\s+problems? \((\d+)\s+errors?,\s+(\d+)\s+warnings?\)/i);
  if (summaryMatch) {
    return {
      summary: null,
      errors: Number(summaryMatch[2]),
      warnings: Number(summaryMatch[3])
    };
  }
  return { summary: 'Lint output did not include a summary', errors: 0, warnings: 0 };
}

/**
 * Parse TypeScript type-check output for error/warning counts.
 * @returns {{summary:string|null,errors:number,warnings:number}}
 */
function parseTypeCheckStats() {
  const raw = readLogSafe(projectRoot, 'type-check.log');
  if (!raw.trim()) return { summary: 'No recent type-check run (log/type-check.log not found)', errors: 0, warnings: 0 };
  const clean = stripAnsi(raw);
  const errorMatches = clean.match(/error\s+TS\d+/gi) || [];
  // TypeScript rarely emits warnings in --noEmit mode; treat non-error notices as warnings if present
  const warningMatches = clean.match(/warning/gi) || [];
  return {
    summary: null,
    errors: errorMatches.length,
    warnings: warningMatches.length
  };
}

/* parseCoverageStats moved to ./coverage-utils.js */


/**
 * Build a multi-line status block summarizing recent test/lint/type/coverage runs.
 * @returns {string} Multi-line status block ready for README insertion.
 */
function buildStatusBlock() {
  const dateStr = formatDate();
  const stats = parseTestStats();
  const lint = parseLintStats();
  const type = parseTypeCheckStats();
  const coverage = parseCoverageStats();

  // Compose Test Files line (if available)
  let testFilesLine = null;
  if (stats.testFiles) {
    const tf = stats.testFiles;
    testFilesLine = `- Test Files ${tf.passed} passed | ${tf.skipped} skipped (${tf.total})` + (tf.percentage !== null ? ` - ${tf.percentage}%` : '');
  }

  // Compose Tests line
  let testsLine = null;
  if (stats.tests) {
    const t = stats.tests;
    testsLine = `- Tests ${t.passed}/${t.total}` + (t.percentage !== null ? ` - ${t.percentage}%` : '');
  } else {
    testsLine = `- Tests ${stats.summary}`;
  }

  const lintLine = lint.errors !== null && lint.warnings !== null
    ? `- Lint ${lint.errors} errors / ${lint.warnings} warnings`
    : `- Lint ${lint.summary}`;

  const typeLine = type.errors !== null && type.warnings !== null
    ? `- Type-check ${type.errors} errors / ${type.warnings} warnings`
    : `- Type-check ${type.summary}`;

  const coverageLine = coverage.lines !== null
    ? `- Coverage ${coverage.lines}% (Statements: ${coverage.statements}% Lines: ${coverage.lines}% Branches: ${coverage.branches}% Functions: ${coverage.functions}%)`
    : `- Coverage ${coverage.summary}`;

  // Multi-line: each tool on its own line, coverage stays as one informative line
  return `${dateStr} - Latest Status\n${testFilesLine ? testFilesLine + '\n' : ''}${testsLine}\n${lintLine}\n${typeLine}\n${coverageLine}`;
}

// Export for external use so other scripts (e.g., onboarding) can reuse the same formatting
// (CommonJS: module.exports assigned at EOF)

function updateRootReadmeStatus() {
  const readmePath = path.join(projectRoot, 'README.md');
  if (!fs.existsSync(readmePath)) return;

  const docsNoteStart = '<!-- BEGIN: docs-autogen-note -->';
  const docsNoteEnd = '<!-- END: docs-autogen-note -->';
  const docsNoteContent = "<!-- Docs README is auto-generated by scripts/docs.js. To regenerate run: 'node scripts/docs.js index' or 'npm run docs:fix' -->";
  const docsNoteBlock = `${docsNoteStart}\n${docsNoteContent}\n${docsNoteEnd}`;

  const start = '<!-- BEGIN: test-status -->';
  const end = '<!-- END: test-status -->';
  const statusBlock = `${start}\n${buildStatusBlock()}\n${end}`;
  let current = fs.readFileSync(readmePath, 'utf-8');

  // Ensure docs autogen comment exists in root README (insert after title if missing)
  if (!current.includes(docsNoteStart)) {
    if (current.includes('# Polychron')) {
      current = current.replace('# Polychron', `# Polychron\n\n${docsNoteBlock}`);
    } else {
      current = `${docsNoteBlock}\n\n${current}`;
    }
  }

  const regex = new RegExp(`${start}[\\s\\S]*?${end}`, 'm');
  let next = current;
  if (regex.test(current)) {
    next = current.replace(regex, statusBlock);
  } else if (current.includes('Test info goes here.')) {
    next = current.replace('Test info goes here.', statusBlock);
  } else {
    next = current.replace('# Polychron', `# Polychron\n\n${statusBlock}`);
  }

  if (next !== current) {
    fs.writeFileSync(readmePath, next);
    console.log('Updated: README.md test status');
  }
}


// getFailuresFromLog re-export will be exposed via module.exports at EOF

/*
 * Scan root-level TODO*.md files and synchronize the "Test Failures" section with current log
 * - Marks entries as fixed (checked) when the failure no longer appears in the log
 * - Ensures ongoing failures remain unchecked
 * - Appends any new failures that are not already present
 */
function updateTodosStatus() {
  const failures = getFailuresFromLog();
  const todoFiles = fs.readdirSync(projectRoot).filter(f => /^TODO(?:[-_].+)?\.md$/i.test(f));
  if (todoFiles.length === 0) return;

  for (const todo of todoFiles) {
    const p = path.join(projectRoot, todo);
    let content = fs.readFileSync(p, 'utf8');
    const reSection = /(##\s*Test Failures[\s\S]*?)(?=\n##\s|$)/i;
    const m = content.match(reSection);
    if (!m) continue;

    const section = m[1];
    const lines = section.split(/\r?\n/);
    const updated = [...lines];
    let changed = false;

    // Update existing items
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!/^- \[[ x]?\]/.test(line)) continue;
      const body = line.replace(/^\s*- \[[ x]?\]\s*/, '');
      const parts = body.split('—').map(s => s.trim());
      const locPart = parts[0] || '';
      const descPart = parts[1] || '';

      const matched = failures.find(f => (f.file && locPart.includes(f.file)) || (descPart && f.desc && descPart.includes(f.desc)));
      if (matched) {
        if (/^- \[x\]/i.test(line)) {
          updated[i] = line.replace(/^- \[x\]/i, '- [ ]'); changed = true;
        }
        if (matched.msg && !line.includes(matched.msg)) { updated[i] = updated[i] + ` — ${matched.msg}`; changed = true; }
      } else {
        if (!/^- \[x\]/i.test(line)) {
          const date = formatDate();
          updated[i] = line.replace(/^- \[\s\]/i, '- [x]') + ` (fixed ${date})`; changed = true;
        }
      }
    }

    // Append any new failures
    const existingKeys = new Set(lines.filter(l => /^- \[/.test(l)).map(l => l.replace(/\s*\(fixed.*?\)\s*$/, '').trim()));
    const toAppend = [];
    for (const f of failures) {
      const candidate = `- [ ] ${f.loc || f.file} — ${f.desc}${f.msg ? ` — ${f.msg}` : ''}`;
      if (!Array.from(existingKeys).some(k => k.includes(f.desc) || k.includes(f.file))) {
        toAppend.push(candidate);
      }
    }

    if (toAppend.length) {
      const insertPos = m.index + section.length;
      const before = content.slice(0, insertPos);
      const after = content.slice(insertPos);
      content = before + '\n' + toAppend.join('\n') + '\n' + after;
      changed = true;
    }

    if (changed) {
      // replace the old section text with the new updated block
      const newSection = updated.join('\n');
      content = content.replace(m[1], newSection);
      fs.writeFileSync(p, content, 'utf8');
      console.log(`Updated: ${todo} (synchronized with test.log)`);
    }
  }
}


function enforceLinksInText(text, isReadme=false) {
  let out = text;
  const codePrefix = isReadme ? 'src' : '../src';
  const docPrefix = isReadme ? 'docs/' : '';
  for (const m of modules) {
    const codeLink = `([code](${codePrefix}/${m.name}))`;
    const docTarget = `${docPrefix}${m.doc}`;
    const docLink = m.doc ? ` ([doc](${docTarget}))` : '';
    const links = `${codeLink}${docLink}`;
    const nameEsc = m.name.replace('.', '\\.')
      .replace(/([\\+*?\[\]{}()^$|])/g, '\\$1');
    const plainRegex = new RegExp(`(?<!\\[)\\b${nameEsc}\\b(?!\\])`, 'g');
    out = out.replace(plainRegex, `${m.name} ${links}`);
  }
  return out;
}

/**
 * Auto-link references to source and docs inside a doc file's text sections.
 * @param {string} docPath - Full path to the doc file to update.
 * @param {boolean} [verbose=false] - Verbose flag to log changes.
 * @returns {boolean} True when the document was updated.
 */
function autoLinkDoc(docPath, verbose=false) {
  const content = fs.readFileSync(docPath, 'utf-8');
  const isReadme = path.basename(docPath) === 'README.md';
  const parts = splitByCodeFences(content);
  const processed = parts.map(p => p.type === 'text' ? enforceLinksInText(p.text, isReadme) : p.text).join('\n');
  if (processed !== content) {
    fs.writeFileSync(docPath, processed);
    if (verbose) console.log(`Linked: ${path.relative(projectRoot, docPath)}`);
    return true;
  }
  return false;
}


function injectSnippet(docPath, snippetName, code) {
  const docBefore = fs.readFileSync(docPath, 'utf-8');
  const beginTag = `<!-- BEGIN: snippet:${snippetName} -->`;
  const endTag = `<!-- END: snippet:${snippetName} -->`;
  const beginIdx = docBefore.indexOf(beginTag);
  const endIdx = docBefore.indexOf(endTag);
  if (beginIdx === -1 || endIdx === -1) return false;

  // Extract existing code between markers to check if it's the same (ignoring formatting)
  const existingBetween = docBefore.slice(beginIdx + beginTag.length, endIdx);
  const existingCode = existingBetween.match(/```typescript\n([\s\S]*?)\n```/)?.[1] || '';

  const existingNorm = normalizeCodeForComparison(existingCode);
  const proposedNorm = normalizeCodeForComparison(code);

  if (existingNorm === proposedNorm) return false; // Already correct (ignoring formatting)

  const before = docBefore.slice(0, beginIdx + beginTag.length);
  const after = docBefore.slice(endIdx);
  const injected = `\n\n\`\`\`typescript\n${code}\n\`\`\`\n\n`;
  const docAfter = before + injected + after;

  fs.writeFileSync(docPath, docAfter);
  return true; // Changed and written
}

function extractFromSource(project, srcPath, snippetName) {
  const sf = project.getSourceFile(srcPath);
  if (!sf) return null;
  const parts = snippetName.split('_');
  if (parts.length === 1) {
    const name = parts[0];
    // Interface
    const intf = sf.getInterface(name);
    if (intf) return intf.getText();
    // Class
    const cls = sf.getClass(name);
    if (cls) return cls.getText();
    // Top-level function
    const func = sf.getFunction(name);
    if (func) return func.getText();
    // Variable declaration (exported const arrow function)
    const varDecl = sf.getVariableDeclaration(name);
    if (varDecl) return varDecl.getText();
    return null;
  } else {
    const [className, memberName] = parts;
    const cls = sf.getClass(className);
    if (cls) {
      // method or accessor
      const m = cls.getMethod(memberName)
        || cls.getGetAccessor(memberName)
        || cls.getSetAccessor(memberName);
      return m ? m.getText() : null;
    }
    // Fallback: maybe the snippet name used Class_member but class is missing; try top-level function named memberName
    const func = sf.getFunction(memberName);
    if (func) return func.getText();
    const varDecl = sf.getVariableDeclaration(memberName);
    if (varDecl) return varDecl.getText();
    return null;
  }
}

function processDoc(project, docPath, verbose=false) {
  // Auto-link first
  autoLinkDoc(docPath, verbose);
  // Snippets
  const srcPath = srcByDoc.get(docPath);
  if (!srcPath || !fs.existsSync(srcPath)) return;
  const initialContent = fs.readFileSync(docPath, 'utf-8');
  const re = /<!--\s*BEGIN:\s*snippet:([^\s>]+)\s*-->/g;
  const names = [];
  let m;
  while ((m = re.exec(initialContent)) !== null) {
    names.push(m[1]);
  }
  let docChanged = false;
  for (const name of names) {
    const code = extractFromSource(project, srcPath, name);
    if (code && injectSnippet(docPath, name, code)) {
      docChanged = true;
    }
  }
  if (docChanged) {
    console.log(`Updated: ${path.relative(projectRoot, docPath)}`);
  }
}

/**
 * Fix all documentation files by auto-linking and injecting snippets.
 * @param {boolean} [verbose=false] - If true, log file updates.
 */
function getProject() {
  const tsPath = path.join(projectRoot, 'tsconfig.json');
  if (fs.existsSync(tsPath)) return new Project({ tsConfigFilePath: tsPath });
  // Fallback project for JS-only repos without tsconfig.json
  return new Project({ compilerOptions: { allowJs: true, checkJs: false, noEmit: true } });
}

function fixAll(verbose=false) {
  const project = getProject();
  for (const { doc } of modules) {
    const docPath = path.join(docsDir, doc);
    if (fs.existsSync(docPath)) processDoc(project, docPath, verbose);
  }
  generateIndex(); // Generate index after fixing all docs
  updateRootReadmeStatus();
}

function watchAll() {
  const project = getProject();
  const watcher = chokidar.watch(path.join(srcDir, '**/*.js'), { ignoreInitial: true });
  watcher.on('change', (changed) => {
    const docPath = docBySrc.get(changed);
    if (docPath && fs.existsSync(docPath)) {
      processDoc(project, docPath, true); // verbose in watch mode
    }
  });
  console.log('Watching src/*.js for docs refresh...');
}

function checkAll() {
  let ok = true;
  for (const { doc } of modules) {
    const docPath = path.join(docsDir, doc);
    if (!fs.existsSync(docPath)) continue;
    const content = fs.readFileSync(docPath, 'utf-8');
    const re = /<!--\s*BEGIN:\s*snippet:([^\s>]+)\s*-->[\s\S]*?<!--\s*END:\s*snippet:\1\s*-->/g;
    let m; while ((m = re.exec(content)) !== null) {
      const inner = content.slice(m.index + m[0].indexOf('>') + 1, re.lastIndex - (`<!-- END: snippet:${m[1]} -->`).length);
      if (!/```/.test(inner)) {
        console.error(`Missing snippet content: ${path.relative(projectRoot, docPath)} -> ${m[1]}`);
        ok = false;
      }
    }
  }
  if (!ok) {
    process.exitCode = 1;
  } else {
    console.log('Docs check passed.');
  }
}

/**
 * Generate an index README for the docs directory by extracting overview sections.
 * @returns {void}
 */
function generateIndex() {
  // Scan all .md files and extract overview sections
  function scanDocs(dir, baseRelative = '') {
    const docs = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relative = baseRelative ? path.join(baseRelative, entry.name) : entry.name;

      if (entry.isDirectory()) {
        docs.push(...scanDocs(fullPath, relative));
      } else if (entry.name.endsWith('.md') && entry.name !== 'README.md') {
        docs.push({ path: relative, fullPath });
      }
    }

    return docs;
  }

  const docFiles = scanDocs(docsDir);

  // Extract overview from each doc
  const docsByCategory = {
    'Core & Orchestration': [],
    'Timing & Rhythm': [],
    'Composition': [],
    'Music Theory': [],
    'Configuration': [],
    'Infrastructure': [],
    'Subdirectories': []
  };

  for (const doc of docFiles) {
    const content = fs.readFileSync(doc.fullPath, 'utf-8');

    // Extract overview section (first paragraph after ## Overview)
    const overviewMatch = content.match(/## Overview\n+([\s\S]*?)(?:\n##|\n---|\n$)/);
    const overview = overviewMatch ? overviewMatch[1].trim().split('\n')[0] : 'Documentation for this module.';

    // Convert path to relative link
    const link = doc.path.replace(/\\/g, '/');
    const displayName = path.basename(link, '.md');
    const displayPath = link.replace('.md', '');

    // Categorize
    let category = 'Infrastructure';
    if (link.includes('composers/')) category = 'Composition';
    else if (link.includes('time/')) category = 'Timing & Rhythm';
    else if (link.includes('voiceLeading/')) category = 'Music Theory';
    else if (link.includes('validators/')) category = 'Infrastructure';
    else if (['play.md', 'playNotes.md', 'stage.md', 'writer.md'].includes(path.basename(link))) category = 'Core & Orchestration';
    else if (['time.md', 'TimingTree.md', 'rhythm.md'].includes(path.basename(link))) category = 'Timing & Rhythm';
    else if (['composers.md', 'ComposerRegistry.md'].includes(path.basename(link))) category = 'Composition';
    else if (['venue.md', 'voiceLeading.md', 'motifs.md'].includes(path.basename(link))) category = 'Music Theory';
    else if (['sheet.js', 'structure.md', 'PolychronConfig.md', 'PolychronContext.md', 'PolychronInit.md'].includes(path.basename(link))) category = 'Configuration';
    else if (link.includes('/')) category = 'Subdirectories';

    docsByCategory[category].push({ link, displayName, displayPath, overview });
  }

  // Generate README content
  const docsAutogenHeader = `<!-- AUTO-GENERATED: DO NOT EDIT. To regenerate run: 'node scripts/docs.js index' or 'npm run docs:fix' -->\n\n`;
  let readme = `${docsAutogenHeader}# Documentation Index\n\nComplete reference documentation for all Polychron modules.\n\n---\n\n`;

  for (const [category, docs] of Object.entries(docsByCategory)) {
    if (docs.length === 0) continue;

    readme += `## ${category}\n\n`;
    for (const doc of docs.sort((a, b) => a.displayName.localeCompare(b.displayName))) {
      readme += `- **[${doc.displayName}](${doc.link})** — ${doc.overview}\n\n`;
    }
  }

  readme += `---\n\n**Note**: All source modules in \`/src\` have corresponding documentation in \`/docs\`. Documentation is automatically validated to ensure 1:1 coverage via the code-quality test suite.\n`;

  fs.writeFileSync(path.join(docsDir, 'README.md'), readme);
  console.log('Generated: docs/README.md');
}

(async () => {
  await loadDeps();
  const cmd = process.argv[2] || 'fix';
  const verbose = process.argv[3] === '--verbose';
  try {
    if (cmd === 'fix') await fixAll(verbose);
    else if (cmd === 'watch') await watchAll();
    else if (cmd === 'check') await checkAll();
    else if (cmd === 'index') await generateIndex();
    else if (cmd === 'status') {
      await updateRootReadmeStatus();
      try { await updateTodosStatus(); } catch (e) { console.error('Error updating TODO status:', e && e.message ? e.message : e); }
    } else {
      console.error('Usage: node scripts/docs.js [fix|watch|check|index|status] [--verbose]');
      process.exit(1);
    }
  } catch (e) {
    console.error('docs.js: ERROR', e && e.stack ? e.stack : e);
    process.exit(1);
  }
})();

// Expose helper functions for CommonJS consumers/tests
module.exports = {
  buildStatusBlock,
  getFailuresFromLog,
  parseCoverageStats
};
