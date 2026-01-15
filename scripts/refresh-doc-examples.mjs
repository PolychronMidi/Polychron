#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

/**
 * Extracts a symbol's code block from a source file.
 * - Supports class declarations of form `class Name {` and `Name = class Name {`.
 * - Optionally attaches the leading JSDoc block if present.
 */
function extractSymbol({ filePath, symbol }) {
  const src = fs.readFileSync(filePath, 'utf-8');
  const lines = src.split(/\r?\n/);
  const symbolPatterns = [
    new RegExp(`^\\s*class\\s+${symbol}\\s*\\{`),
    new RegExp(`^\\s*${symbol}\\s*=\\s*class\\s+${symbol}\\s*\\{`),
  ];

  let startIdx = -1;
  let startsWithAssignment = false;
  for (let i = 0; i < lines.length; i++) {
    if (symbolPatterns[1].test(lines[i])) { startIdx = i; startsWithAssignment = true; break; }
    if (symbolPatterns[0].test(lines[i])) { startIdx = i; startsWithAssignment = false; break; }
  }
  if (startIdx < 0) throw new Error(`Symbol ${symbol} not found in ${filePath}`);

  // Capture JSDoc immediately above, if present
  let jsdocStart = -1;
  let jsdocEnd = -1;
  for (let i = startIdx - 1; i >= 0; i--) {
    const line = lines[i];
    if (line.match(/^\s*\/\*\*/)) { jsdocStart = i; break; }
    if (line.trim() === '') continue; // skip blank lines
    // Stop if any non-blank, non-comment line encountered
    if (!line.match(/^\s*\*/)
      && !line.match(/^\s*\/\/.*$/)
      && !line.match(/^\s*\/*/)) {
      break;
    }
  }
  if (jsdocStart >= 0) {
    for (let i = jsdocStart; i < startIdx; i++) {
      if (lines[i].match(/^\s*\*\/\s*$/)) { jsdocEnd = i; break; }
    }
  }

  // Extract class body with brace matching
  let braceCount = 0;
  let endIdx = startIdx;
  const startLine = lines[startIdx];
  const firstBracePos = startLine.indexOf('{');
  if (firstBracePos === -1) throw new Error(`Malformed class declaration at ${filePath}:${startIdx+1}`);
  braceCount = 1;

  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i];
    // Count braces; naive but fine for our code style
    for (const ch of line) {
      if (ch === '{') braceCount++;
      else if (ch === '}') braceCount--;
    }
    endIdx = i;
    if (braceCount === 0) {
      break;
    }
  }

  // For assignment form, class ends with `};`, include the trailing semicolon if present
  if (startsWithAssignment && endIdx + 1 < lines.length && lines[endIdx + 1].trim().startsWith('};')) {
    endIdx = endIdx + 1;
  }

  const codeLines = [];
  if (jsdocStart >= 0 && jsdocEnd >= 0) {
    codeLines.push(...lines.slice(jsdocStart, jsdocEnd + 1));
  }
  codeLines.push(...lines.slice(startIdx, endIdx + 1));
  return codeLines.join('\n');
}

/**
 * Extracts a method body from a class in a source file, including leading JSDoc if present.
 */
function extractMethod({ filePath, className, methodName }) {
  const src = fs.readFileSync(filePath, 'utf-8');
  const lines = src.split(/\r?\n/);

  // Find class start
  const classPatterns = [
    new RegExp(`^\\s*class\\s+${className}\\s*\\{`),
    new RegExp(`^\\s*${className}\\s*=\\s*class\\s+${className}\\s*\\{`),
  ];
  let classStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (classPatterns[0].test(lines[i]) || classPatterns[1].test(lines[i])) { classStart = i; break; }
  }
  if (classStart < 0) throw new Error(`Class ${className} not found in ${filePath}`);

  // Extract class block to limit search
  let braceCount = 0;
  let classEnd = classStart;
  for (let i = classStart; i < lines.length; i++) {
    const line = lines[i];
    for (const ch of line) { if (ch === '{') braceCount++; else if (ch === '}') braceCount--; }
    classEnd = i;
    if (braceCount === 0) break;
  }
  const classLines = lines.slice(classStart, classEnd + 1);

  // Search for method
  const methodRegex = new RegExp(`^\\s*${methodName}\\s*\\(`);
  let methodStart = -1;
  for (let i = 0; i < classLines.length; i++) {
    if (methodRegex.test(classLines[i])) { methodStart = i; break; }
  }
  if (methodStart < 0) throw new Error(`Method ${methodName} not found in class ${className}`);

  // Map methodStart to original file lines
  methodStart = classStart + methodStart;

  // Capture JSDoc above method if present
  let jsdocStart = -1, jsdocEnd = -1;
  for (let i = methodStart - 1; i >= classStart; i--) {
    const line = lines[i];
    if (line.match(/^\s*\/\*\*/)) { jsdocStart = i; break; }
    if (line.trim() === '') continue;
    if (!line.match(/^\s*\*/)
      && !line.match(/^\s*\/\/.*$/)
      && !line.match(/^\s*\/*/)) {
      break;
    }
  }
  if (jsdocStart >= 0) {
    for (let i = jsdocStart; i < methodStart; i++) {
      if (lines[i].match(/^\s*\*\/\s*$/)) { jsdocEnd = i; break; }
    }
  }

  // Extract method body with brace matching
  let mBraceCount = 0;
  let methodEnd = methodStart;
  // Initialize when encountering first '{' on the method line
  let started = false;
  for (let i = methodStart; i < lines.length; i++) {
    const line = lines[i];
    for (const ch of line) {
      if (ch === '{') { mBraceCount++; started = true; }
      else if (ch === '}') { mBraceCount--; }
    }
    methodEnd = i;
    if (started && mBraceCount === 0) break;
  }

  const codeLines = [];
  if (jsdocStart >= 0 && jsdocEnd >= 0) codeLines.push(...lines.slice(jsdocStart, jsdocEnd + 1));
  codeLines.push(...lines.slice(methodStart, methodEnd + 1));
  return codeLines.join('\n');
}

/**
 * Extracts a top-level or assigned arrow function (e.g., `name = () => { ... }`).
 * Includes leading JSDoc if present.
 */
function extractFunction({ filePath, functionName }) {
  const src = fs.readFileSync(filePath, 'utf-8');
  const lines = src.split(/\r?\n/);
  const patterns = [
    new RegExp(`^\\s*function\\s+${functionName}\\s*\\(`),
    new RegExp(`^\\s*${functionName}\\s*=\\s*\\([^)]*\\)\\s*=>\\s*\\{`),
  ];
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (patterns[0].test(lines[i]) || patterns[1].test(lines[i])) { start = i; break; }
  }
  if (start < 0) throw new Error(`Function ${functionName} not found in ${filePath}`);

  // JSDoc above
  let jsdocStart = -1, jsdocEnd = -1;
  for (let i = start - 1; i >= 0; i--) {
    const line = lines[i];
    if (line.match(/^\s*\/\*\*/)) { jsdocStart = i; break; }
    if (line.trim() === '') continue;
    if (!line.match(/^\s*\*/)
      && !line.match(/^\s*\/\/.*$/)
      && !line.match(/^\s*\/*/)) {
      break;
    }
  }
  if (jsdocStart >= 0) {
    for (let i = jsdocStart; i < start; i++) {
      if (lines[i].match(/^\s*\*\/\s*$/)) { jsdocEnd = i; break; }
    }
  }

  // Extract function body via brace counting
  let braceCount = 0, end = start; let started = false;
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    for (const ch of line) {
      if (ch === '{') { braceCount++; started = true; }
      else if (ch === '}') { braceCount--; }
    }
    end = i; if (started && braceCount === 0) break;
  }

  const codeLines = [];
  if (jsdocStart >= 0 && jsdocEnd >= 0) codeLines.push(...lines.slice(jsdocStart, jsdocEnd + 1));
  codeLines.push(...lines.slice(start, end + 1));
  return codeLines.join('\n');
}

/**
 * Extracts a method from an object literal (e.g., `const LM = { register: (...) => { ... } }`).
 * Includes leading JSDoc if present.
 */
function extractObjectMethod({ filePath, objectName, methodName }) {
  const src = fs.readFileSync(filePath, 'utf-8');
  const lines = src.split(/\r?\n/);
  const objDeclRegex = new RegExp(`^\\s*(const|let|var)\\s+${objectName}.*\\{`);
  let objStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (objDeclRegex.test(lines[i])) { objStart = i; break; }
  }
  if (objStart < 0) throw new Error(`Object ${objectName} not found in ${filePath}`);

  // Find object end via brace counting
  let braceCount = 0, objEnd = objStart;
  for (let i = objStart; i < lines.length; i++) {
    const line = lines[i];
    for (const ch of line) { if (ch === '{') braceCount++; else if (ch === '}') braceCount--; }
    objEnd = i; if (braceCount === 0) break;
  }
  const objLines = lines.slice(objStart, objEnd + 1);

  // Find method start line inside object
  const methodRegex = new RegExp(`^\\s*${methodName}\\s*:\\s*`);
  let relStart = -1;
  for (let i = 0; i < objLines.length; i++) {
    if (methodRegex.test(objLines[i])) { relStart = i; break; }
  }
  if (relStart < 0) throw new Error(`Method ${methodName} not found in object ${objectName}`);
  let start = objStart + relStart;

  // JSDoc above
  let jsdocStart = -1, jsdocEnd = -1;
  for (let i = start - 1; i >= objStart; i--) {
    const line = lines[i];
    if (line.match(/^\s*\/\*\*/)) { jsdocStart = i; break; }
    if (line.trim() === '') continue;
    if (!line.match(/^\s*\*/)
      && !line.match(/^\s*\/\/.*$/)
      && !line.match(/^\s*\/*/)) {
      break;
    }
  }
  if (jsdocStart >= 0) {
    for (let i = jsdocStart; i < start; i++) {
      if (lines[i].match(/^\s*\*\/\s*$/)) { jsdocEnd = i; break; }
    }
  }

  // Extract method body via brace counting
  let braceCount2 = 0, end = start; let started = false;
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    for (const ch of line) {
      if (ch === '{') { braceCount2++; started = true; }
      else if (ch === '}') { braceCount2--; }
    }
    end = i;
    // Stop when we've closed the method's braces and see a trailing comma or end of object
    if (started && braceCount2 === 0) { break; }
  }

  const codeLines = [];
  if (jsdocStart >= 0 && jsdocEnd >= 0) codeLines.push(...lines.slice(jsdocStart, jsdocEnd + 1));
  codeLines.push(...lines.slice(start, end + 1));
  return codeLines.join('\n');
}

function replaceSnippetInDoc(docPath, snippetName, code) {
  const doc = fs.readFileSync(docPath, 'utf-8');
  const beginTag = `<!-- BEGIN: snippet:${snippetName} -->`;
  const endTag = `<!-- END: snippet:${snippetName} -->`;
  const beginIdx = doc.indexOf(beginTag);
  const endIdx = doc.indexOf(endTag);
  if (beginIdx === -1 || endIdx === -1) {
    throw new Error(`Snippet markers for ${snippetName} not found in ${docPath}`);
  }
  const before = doc.slice(0, beginIdx + beginTag.length);
  const after = doc.slice(endIdx);
  const injected = `\n\n\`\`\`javascript\n${code}\n\`\`\`\n\n`;
  const out = before + injected + after;
  fs.writeFileSync(docPath, out);
}

function main() {
  const projectRoot = process.cwd();
  const targets = [
    { symbol: 'CSVBuffer', file: path.join(projectRoot, 'src', 'writer.js'), doc: path.join(projectRoot, 'docs', 'writer.md') },
    { symbol: 'TimingCalculator', file: path.join(projectRoot, 'src', 'time.js'), doc: path.join(projectRoot, 'docs', 'time.md') },
    // Stage method snippet (we inject just a placeholder for now); future: parse method body
    { symbol: 'Stage', file: path.join(projectRoot, 'src', 'stage.js'), doc: path.join(projectRoot, 'docs', 'stage.md'), method: 'setTuningAndInstruments', snippetName: 'Stage_setTuningAndInstruments' },
    { symbol: 'FxManager', file: path.join(projectRoot, 'src', 'fxManager.js'), doc: path.join(projectRoot, 'docs', 'fxManager.md'), method: 'stutterFade', snippetName: 'FxManager_stutterFade' },
    { symbol: 'FxManager', file: path.join(projectRoot, 'src', 'fxManager.js'), doc: path.join(projectRoot, 'docs', 'fxManager.md'), method: 'stutterPan', snippetName: 'FxManager_stutterPan' },
    { symbol: 'FxManager', file: path.join(projectRoot, 'src', 'fxManager.js'), doc: path.join(projectRoot, 'docs', 'fxManager.md'), method: 'stutterFX', snippetName: 'FxManager_stutterFX' },
    { symbol: 'VoiceLeadingScore', file: path.join(projectRoot, 'src', 'voiceLeading.js'), doc: path.join(projectRoot, 'docs', 'voiceLeading.md'), method: 'selectNextNote', snippetName: 'VoiceLeading_selectNextNote' },
    { symbol: 'VoiceLeadingScore', file: path.join(projectRoot, 'src', 'voiceLeading.js'), doc: path.join(projectRoot, 'docs', 'voiceLeading.md'), method: 'analyzeQuality', snippetName: 'VoiceLeading_analyzeQuality' },
    { symbol: 'Stage', file: path.join(projectRoot, 'src', 'stage.js'), doc: path.join(projectRoot, 'docs', 'stage.md'), method: 'playNotes', snippetName: 'Stage_playNotes' },
    // Writer/grandFinale function and LM object methods
    { functionName: 'grandFinale', file: path.join(projectRoot, 'src', 'writer.js'), doc: path.join(projectRoot, 'docs', 'writer.md'), snippetName: 'Writer_grandFinale' },
    { objectName: 'LM', file: path.join(projectRoot, 'src', 'time.js'), doc: path.join(projectRoot, 'docs', 'time.md'), method: 'register', snippetName: 'LM_register' },
    { objectName: 'LM', file: path.join(projectRoot, 'src', 'time.js'), doc: path.join(projectRoot, 'docs', 'time.md'), method: 'activate', snippetName: 'LM_activate' },
    { objectName: 'LM', file: path.join(projectRoot, 'src', 'time.js'), doc: path.join(projectRoot, 'docs', 'time.md'), method: 'advance', snippetName: 'LM_advance' },
    { functionName: 'setUnitTiming', file: path.join(projectRoot, 'src', 'time.js'), doc: path.join(projectRoot, 'docs', 'time.md'), snippetName: 'Time_setUnitTiming' },
  ];

  for (const t of targets) {
    if (t.symbol && !t.method) {
      const code = extractSymbol({ filePath: t.file, symbol: t.symbol });
      replaceSnippetInDoc(t.doc, t.symbol, code);
      console.log(`Updated ${path.basename(t.doc)} snippet: ${t.symbol}`);
    } else if (t.symbol && t.method) {
      const code = extractMethod({ filePath: t.file, className: t.symbol, methodName: t.method });
      replaceSnippetInDoc(t.doc, t.snippetName, code);
      console.log(`Updated ${path.basename(t.doc)} snippet: ${t.snippetName}`);
    } else if (t.functionName) {
      const code = extractFunction({ filePath: t.file, functionName: t.functionName });
      replaceSnippetInDoc(t.doc, t.snippetName, code);
      console.log(`Updated ${path.basename(t.doc)} snippet: ${t.snippetName}`);
    } else if (t.objectName && t.method) {
      const code = extractObjectMethod({ filePath: t.file, objectName: t.objectName, methodName: t.method });
      replaceSnippetInDoc(t.doc, t.snippetName, code);
      console.log(`Updated ${path.basename(t.doc)} snippet: ${t.snippetName}`);
    }
  }
}

main();
