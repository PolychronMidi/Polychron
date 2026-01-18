#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

const projectRoot = process.cwd();
const targetFiles = [path.join(projectRoot, 'README.md')];
const docsDir = path.join(projectRoot, 'docs');
if (fs.existsSync(docsDir)) {
  for (const f of fs.readdirSync(docsDir)) {
    if (f.endsWith('.md')) targetFiles.push(path.join(docsDir, f));
  }
}

// Module mapping: src file -> docs file name
const modules = [
  { name: 'backstage.ts', doc: 'backstage.md' },
  { name: 'CancellationToken.ts', doc: 'CancellationToken.md' },
  { name: 'ComposerRegistry.ts', doc: 'ComposerRegistry.md' },
  { name: 'composers.ts', doc: 'composers.md' },
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
  { name: 'TimingTree.ts', doc: 'TimingTree.md' },
  { name: 'utils.ts', doc: 'utils.md' },
  { name: 'venue.ts', doc: 'venue.md' },
  { name: 'voiceLeading.ts', doc: 'voiceLeading.md' },
  { name: 'writer.ts', doc: 'writer.md' },
];

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

function enforceLinksInText(text, { codePrefix, docPrefix }) {
  let out = text;
  for (const m of modules) {
    const codeLink = `([code](${codePrefix}/${m.name}))`;
    const docTarget = `${docPrefix}${m.doc}`;
    const docLink = m.doc ? ` ([doc](${docTarget}))` : '';
    const links = `${codeLink}${docLink}`;

    // Skip if already has both code and doc links
    const nameEsc = m.name.replace('.', '\\.');
    // Replace plain filename references with links (avoid inside code, backticks, or existing links)
    const plainRegex = new RegExp(`(?<!\\[)\\b${nameEsc}\\b(?!\\])`, 'g');
    out = out.replace(plainRegex, (match, offset, s) => {
      const windowBefore = s.slice(Math.max(0, offset - 64), offset);
      const windowAfter = s.slice(offset + match.length, offset + match.length + 64);
      const inParentheses = windowBefore.lastIndexOf('(') > windowBefore.lastIndexOf(')')
        || windowAfter.indexOf(')') !== -1;
      const nearUrl = /src\/|docs\//.test(windowBefore) || /src\/|docs\//.test(windowAfter) || /https?:\/\//.test(windowBefore) || /https?:\/\//.test(windowAfter);
      const nearLinkSyntax = /\]\(/.test(windowBefore) || /\)\[/.test(windowAfter);
      const hasBackticks = windowBefore.includes('`') || windowAfter.includes('`');
      if ((inParentheses && (nearUrl || nearLinkSyntax)) || hasBackticks) return match;
      return `${match} ${links}`;
    });
    // Replace plain filename references with links (avoid inside code, backticks, or existing links)

  }
}
