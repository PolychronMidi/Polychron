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
  { name: 'backstage.js', doc: 'backstage.md' },
  { name: 'composers.js', doc: 'composers.md' },
  { name: 'fxManager.js', doc: 'fxManager.md' },
  { name: 'motifs.js', doc: 'motifs.md' },
  { name: 'play.js', doc: 'play.md' },
  { name: 'rhythm.js', doc: 'rhythm.md' },
  { name: 'sheet.js', doc: 'sheet.md' },
  { name: 'stage.js', doc: 'stage.md' },
  { name: 'time.js', doc: 'time.md' },
  { name: 'venue.js', doc: 'venue.md' },
  { name: 'voiceLeading.js', doc: 'voiceLeading.md' },
  { name: 'writer.js', doc: 'writer.md' },
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

function enforceLinksInText(text) {
  let out = text;
  for (const m of modules) {
    const codeLink = `([code](../src/${m.name}))`;
    const docLink = m.doc ? `([doc](${m.doc}))` : '';
    const formatted = `**${m.name}** ${codeLink}${docLink ? ' ' + docLink : ''}`;

    // 1) Ensure bold references have links if missing
    const boldRegex = new RegExp(`\\*\\*${m.name}\\*\\*(?![\
\r]*\\s*\\(\\[code\\])`, 'g');
    out = out.replace(boldRegex, formatted);

    // 2) Convert plain references to formatted (skip if already part of a link text)
    const plainRegex = new RegExp(`(?<!\\[)\\b${m.name.replace('.', '\\.')}\\b(?!\\])`, 'g');
    out = out.replace(plainRegex, (match, offset, s) => {
      // Avoid replacing inside existing URLs or link targets
      const windowBefore = s.slice(Math.max(0, offset - 64), offset);
      const windowAfter = s.slice(offset + match.length, offset + match.length + 64);
      const inParentheses = windowBefore.lastIndexOf('(') > windowBefore.lastIndexOf(')')
        || windowAfter.indexOf(')') !== -1;
      const nearUrl = /src\/|docs\//.test(windowBefore) || /src\/|docs\//.test(windowAfter) || /https?:\/\//.test(windowBefore) || /https?:\/\//.test(windowAfter);
      const nearLinkSyntax = /\]\(/.test(windowBefore) || /\)\[/.test(windowAfter);
      const hasBackticks = windowBefore.includes('`') || windowAfter.includes('`');
      if ((inParentheses && (nearUrl || nearLinkSyntax)) || hasBackticks) return match;
      return formatted;
    });

    // 3) Cleanup any previously broken URL targets that include bold filename
    const escapedName = m.name.replace('.', '\\.');
    const brokenUrl = new RegExp(`\\.\\.\/src\/\\*\\*${escapedName}\\*\\*`, 'g');
    out = out.replace(brokenUrl, `../src/${m.name}`);
  }
  return out;
}

for (const file of targetFiles) {
  const content = fs.readFileSync(file, 'utf-8');
  const parts = splitByCodeFences(content);
  const processed = parts.map(p => p.type === 'text' ? enforceLinksInText(p.text) : p.text).join('\n');
  if (processed !== content) {
    fs.writeFileSync(file, processed);
    console.log(`Updated links in ${path.relative(projectRoot, file)}`);
  }
}
