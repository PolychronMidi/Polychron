#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { Project } from 'ts-morph';
import chokidar from 'chokidar';

const projectRoot = process.cwd();
const srcDir = path.join(projectRoot, 'src');
const docsDir = path.join(projectRoot, 'docs');

// Mapping: source file -> doc file
const modules = [
  { name: 'backstage.ts', doc: 'backstage.md' },
  { name: 'CancellationToken.ts', doc: 'CancellationToken.md' },
  { name: 'ComposerRegistry.ts', doc: 'ComposerRegistry.md' },
  { name: 'composers.ts', doc: 'composers.md' },
  { name: 'composers/GenericComposer.ts', doc: 'composers/GenericComposer.md' },
  { name: 'composers/MeasureComposer.ts', doc: 'composers/MeasureComposer.md' },
  { name: 'composers/ScaleComposer.ts', doc: 'composers/ScaleComposer.md' },
  { name: 'composers/ModeComposer.ts', doc: 'composers/ModeComposer.md' },
  { name: 'composers/PentatonicComposer.ts', doc: 'composers/PentatonicComposer.md' },
  { name: 'composers/ChordComposer.ts', doc: 'composers/ChordComposer.md' },
  { name: 'composers/ProgressionGenerator.ts', doc: 'composers/ProgressionGenerator.md' },
  { name: 'CompositionContext.ts', doc: 'CompositionContext.md' },
  { name: 'CompositionProgress.ts', doc: 'CompositionProgress.md' },
  { name: 'CompositionState.ts', doc: 'CompositionState.md' },
  { name: 'DIContainer.ts', doc: 'DIContainer.md' },
  { name: 'EventBus.ts', doc: 'EventBus.md' },
  { name: 'fxManager.ts', doc: 'fxManager.md' },
  { name: 'ModuleInitializer.ts', doc: 'ModuleInitializer.md' },
  { name: 'motifs.ts', doc: 'motifs.md' },
  { name: 'play.ts', doc: 'play.md' },
  { name: 'playNotes.ts', doc: 'playNotes.md' },
  { name: 'PolychronConfig.ts', doc: 'PolychronConfig.md' },
  { name: 'PolychronContext.ts', doc: 'PolychronContext.md' },
  { name: 'PolychronError.ts', doc: 'PolychronError.md' },
  { name: 'PolychronInit.ts', doc: 'PolychronInit.md' },
  { name: 'rhythm.ts', doc: 'rhythm.md' },
  { name: 'sheet.ts', doc: 'sheet.md' },
  { name: 'stage.ts', doc: 'stage.md' },
  { name: 'structure.ts', doc: 'structure.md' },
  { name: 'time.ts', doc: 'time.md' },
  { name: 'time/LayerManager.ts', doc: 'time/LayerManager.md' },
  { name: 'time/TimingCalculator.ts', doc: 'time/TimingCalculator.md' },
  { name: 'time/TimingContext.ts', doc: 'time/TimingContext.md' },
  { name: 'TimingTree.ts', doc: 'TimingTree.md' },
  { name: 'utils.ts', doc: 'utils.md' },
  { name: 'venue.ts', doc: 'venue.md' },
  { name: 'voiceLeading.ts', doc: 'voiceLeading.md' },
  { name: 'voiceLeading/VoiceLeadingScore.ts', doc: 'voiceLeading/VoiceLeadingScore.md' },
  { name: 'writer.ts', doc: 'writer.md' },
];
const docBySrc = new Map(modules.map(m => [path.join(srcDir, m.name), path.join(docsDir, m.doc)]));
const srcByDoc = new Map(modules.map(m => [path.join(docsDir, m.doc), path.join(srcDir, m.name)]));

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

function autoLinkDoc(docPath) {
  const content = fs.readFileSync(docPath, 'utf-8');
  const isReadme = path.basename(docPath) === 'README.md';
  const parts = splitByCodeFences(content);
  const processed = parts.map(p => p.type === 'text' ? enforceLinksInText(p.text, isReadme) : p.text).join('\n');
  if (processed !== content) {
    fs.writeFileSync(docPath, processed);
    console.log(`Linked: ${path.relative(projectRoot, docPath)}`);
  }
}

function injectSnippet(docPath, snippetName, code) {
  const doc = fs.readFileSync(docPath, 'utf-8');
  const beginTag = `<!-- BEGIN: snippet:${snippetName} -->`;
  const endTag = `<!-- END: snippet:${snippetName} -->`;
  const beginIdx = doc.indexOf(beginTag);
  const endIdx = doc.indexOf(endTag);
  if (beginIdx === -1 || endIdx === -1) return false;
  const before = doc.slice(0, beginIdx + beginTag.length);
  const after = doc.slice(endIdx);
  const injected = `\n\n\`\`\`typescript\n${code}\n\`\`\`\n\n`;
  const out = before + injected + after;
  fs.writeFileSync(docPath, out);
  console.log(`Snippet: ${path.relative(projectRoot, docPath)} -> ${snippetName}`);
  return true;
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

function processDoc(project, docPath) {
  // Auto-link first
  autoLinkDoc(docPath);
  // Snippets
  const srcPath = srcByDoc.get(docPath);
  if (!srcPath || !fs.existsSync(srcPath)) return;
  const content = fs.readFileSync(docPath, 'utf-8');
  const re = /<!--\s*BEGIN:\s*snippet:([^\s>]+)\s*-->/g;
  const names = [];
  let m;
  while ((m = re.exec(content)) !== null) {
    names.push(m[1]);
  }
  for (const name of names) {
    const code = extractFromSource(project, srcPath, name);
    if (code) injectSnippet(docPath, name, code);
  }
}

function fixAll() {
  const project = new Project({ tsConfigFilePath: path.join(projectRoot, 'tsconfig.json') });
  for (const { doc } of modules) {
    const docPath = path.join(docsDir, doc);
    if (fs.existsSync(docPath)) processDoc(project, docPath);
  }
}

function watchAll() {
  const project = new Project({ tsConfigFilePath: path.join(projectRoot, 'tsconfig.json') });
  const watcher = chokidar.watch(path.join(srcDir, '**/*.ts'), { ignoreInitial: true });
  watcher.on('change', (changed) => {
    const docPath = docBySrc.get(changed);
    if (docPath && fs.existsSync(docPath)) {
      processDoc(project, docPath);
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

const cmd = process.argv[2] || 'fix';
if (cmd === 'fix') fixAll();
else if (cmd === 'watch') watchAll();
else if (cmd === 'check') checkAll();
else {
  console.error('Usage: node scripts/docs.mjs [fix|watch|check]');
  process.exit(1);
}
