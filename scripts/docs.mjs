#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { Project } from 'ts-morph';
import chokidar from 'chokidar';

const projectRoot = process.cwd();
const srcDir = path.join(projectRoot, 'src');
const docsDir = path.join(projectRoot, 'docs');
const logDir = path.join(projectRoot, 'log');

function stripAnsi(input) {
  return input.replace(/\u001B\[[0-9;]*[A-Za-z]/g, '');
}

function formatDateMMDDYY() {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const yy = String(now.getFullYear()).slice(-2);
  return `${mm}/${dd}/${yy}`;
}

// Generate mapping dynamically: scan /src for .ts files and create docs mapping
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
      } else if (entry.endsWith('.ts')) {
        // Convert .ts to .md
        const docName = entry.replace(/\.ts$/, '.md');
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

function readLogSafe(fileName) {
  const logPath = path.join(logDir, fileName);
  if (!fs.existsSync(logPath)) return '';
  return fs.readFileSync(logPath, 'utf-8');
}

function parseTestStats() {
  const raw = readLogSafe('test.log');
  if (!raw.trim()) return { summary: 'No recent test run (log/test.log not found)', total: null, passed: null, percentage: null };
  const clean = stripAnsi(raw);
  const passedMatch = [...clean.matchAll(/Tests\s+(\d+)\s+passed\s*\((\d+)\)/gi)].pop();
  const failedMatch = [...clean.matchAll(/Tests\s+(\d+)\s+failed.*?(\d+)\s+passed.*?(\d+)\s+total/gi)].pop();
  let total = null;
  let passed = null;
  let failed = null;

  if (passedMatch) {
    passed = Number(passedMatch[1]);
    total = Number(passedMatch[2] || passedMatch[1]);
  }

  if (total === null && failedMatch) {
    failed = Number(failedMatch[1]);
    passed = Number(failedMatch[2]);
    total = Number(failedMatch[3]);
  }

  if (total === null) {
    const fallbackLine = clean.split(/\r?\n/).reverse().find(l => /Tests\s+/i.test(l)) || '';
    const nums = (fallbackLine.match(/\d+/g) || []).map(Number);
    if (nums.length >= 2) {
      passed = nums[0];
      total = nums[nums.length - 1];
    }
  }

  if (total === null) {
    return { summary: 'Tests data unavailable', total: null, passed: null, percentage: null };
  }

  if (failed === null && total !== null && passed !== null) {
    failed = Math.max(total - passed, 0);
  }

  const percentage = total > 0 && passed !== null ? Math.round((passed / total) * 1000) / 10 : null;
  return { summary: null, total, passed, failed, percentage };
}

function parseLintStats() {
  const raw = readLogSafe('lint.log');
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

function parseTypeCheckStats() {
  const raw = readLogSafe('type-check.log');
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

function buildStatusBlock() {
  const dateStr = formatDateMMDDYY();
  const tests = parseTestStats();
  const lint = parseLintStats();
  const type = parseTypeCheckStats();

  const testsLine = tests.total !== null && tests.passed !== null && tests.percentage !== null
    ? `- Tests ${tests.total}/${tests.passed} - ${tests.percentage}%`
    : `- Tests ${tests.summary}`;

  const lintLine = lint.errors !== null && lint.warnings !== null
    ? `- Lint ${lint.errors} errors / ${lint.warnings} warnings`
    : `- Lint ${lint.summary}`;

  const typeLine = type.errors !== null && type.warnings !== null
    ? `- Type-check ${type.errors} errors / ${type.warnings} warnings`
    : `- Type-check ${type.summary}`;

  return `${dateStr} - Latest Status\n${testsLine}\n${lintLine}\n${typeLine}`;
}

function updateRootReadmeStatus() {
  const readmePath = path.join(projectRoot, 'README.md');
  if (!fs.existsSync(readmePath)) return;
  const start = '<!-- BEGIN: test-status -->';
  const end = '<!-- END: test-status -->';
  const statusBlock = `${start}\n${buildStatusBlock()}\n${end}`;
  const current = fs.readFileSync(readmePath, 'utf-8');

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

function splitByCodeFences(content) {
  const parts = [];
  const lines = content.split(/\r?\n/);
  let inFence = false;
  let buffer = [];
  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      buffer.push(line);
      if (inFence) {
        parts.push({ type: 'code', text: buffer.join('\n') });
        buffer = [];
        inFence = false;
      } else {
        parts.push({ type: 'text', text: buffer.slice(0, -1).join('\n') });
        buffer = [line];
        inFence = true;
      }
    } else {
      buffer.push(line);
    }
  }
  if (buffer.length) {
    parts.push({ type: inFence ? 'code' : 'text', text: buffer.join('\n') });
  }
  return parts;
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

function normalizeCodeForComparison(code) {
  // Collapse multiple spaces/tabs into single space, trim lines
  return code.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).join('\n').trim();
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
    // Could be class or interface
    const intf = sf.getInterface(parts[0]);
    if (intf) return intf.getText();
    const cls = sf.getClass(parts[0]);
    if (cls) return cls.getText();
    return null;
  } else {
    const [className, memberName] = parts;
    const cls = sf.getClass(className);
    if (!cls) return null;
    // method
    const m = cls.getMethod(memberName)
      || cls.getGetAccessor(memberName)
      || cls.getSetAccessor(memberName);
    return m ? m.getText() : null;
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

function fixAll(verbose=false) {
  const project = new Project({ tsConfigFilePath: path.join(projectRoot, 'tsconfig.json') });
  for (const { doc } of modules) {
    const docPath = path.join(docsDir, doc);
    if (fs.existsSync(docPath)) processDoc(project, docPath, verbose);
  }
  generateIndex(); // Generate index after fixing all docs
  updateRootReadmeStatus();
}

function watchAll() {
  const project = new Project({ tsConfigFilePath: path.join(projectRoot, 'tsconfig.json') });
  const watcher = chokidar.watch(path.join(srcDir, '**/*.ts'), { ignoreInitial: true });
  watcher.on('change', (changed) => {
    const docPath = docBySrc.get(changed);
    if (docPath && fs.existsSync(docPath)) {
      processDoc(project, docPath, true); // verbose in watch mode
    }
  });
  console.log('Watching src/*.ts for docs refresh...');
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
    else if (['sheet.ts', 'structure.md', 'PolychronConfig.md', 'PolychronContext.md', 'PolychronInit.md'].includes(path.basename(link))) category = 'Configuration';
    else if (link.includes('/')) category = 'Subdirectories';

    docsByCategory[category].push({ link, displayName, displayPath, overview });
  }

  // Generate README content
  let readme = `# Documentation Index

Complete reference documentation for all Polychron modules.

---

`;

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

const cmd = process.argv[2] || 'fix';
const verbose = process.argv[3] === '--verbose';
if (cmd === 'fix') fixAll(verbose);
else if (cmd === 'watch') watchAll();
else if (cmd === 'check') checkAll();
else if (cmd === 'index') generateIndex();
else if (cmd === 'status') updateRootReadmeStatus();
else {
  console.error('Usage: node scripts/docs.mjs [fix|watch|check|index|status] [--verbose]');
  process.exit(1);
}
