// code-quality.test.js - Static analysis guards to catch malformed code artifacts.
// minimalist comments, details at: code-quality.md

import { test, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Scan source files for forbidden patterns that would indicate malformed code.
 */
test('source files should not contain literal escape sequences in comments', () => {
  const sourceFiles = [
    'backstage.js',
    'composers.js',
    'play.js',
    'rhythm.js',
    'sheet.js',
    'stage.js',
    'time.js',
    'venue.js',
    'writer.js'
  ];

  const forbiddenPatterns = [
    { pattern: /\\n(?!["'])/g, name: 'literal \\n outside strings' },
    { pattern: /\\t(?!["'])/g, name: 'literal \\t outside strings' },
    { pattern: /\\r(?!["'])/g, name: 'literal \\r outside strings' }
  ];

  const violations = [];

  sourceFiles.forEach(file => {
    const filePath = path.join(__dirname, '..', 'src', file);
    if (!fs.existsSync(filePath)) return;

    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');

    forbiddenPatterns.forEach(({ pattern, name }) => {
      let match;
      const regex = new RegExp(pattern.source, pattern.flags);

      while ((match = regex.exec(content)) !== null) {
        // Find line number
        const beforeMatch = content.substring(0, match.index);
        const lineNumber = beforeMatch.split('\n').length;
        const lineContent = lines[lineNumber - 1];

        // Check if it's actually in a string literal (simple heuristic)
        const lineBeforeMatch = lineContent.substring(0, match.index - beforeMatch.lastIndexOf('\n') - 1);
        const singleQuotes = (lineBeforeMatch.match(/'/g) || []).length;
        const doubleQuotes = (lineBeforeMatch.match(/"/g) || []).length;
        const backticks = (lineBeforeMatch.match(/`/g) || []).length;

        // If odd number of quotes before match, likely inside string
        const likelyInString = (singleQuotes % 2 !== 0) || (doubleQuotes % 2 !== 0) || (backticks % 2 !== 0);

        if (!likelyInString) {
          violations.push({
            file,
            line: lineNumber,
            pattern: name,
            content: lineContent.trim()
          });
        }
      }
    });
  });

  if (violations.length > 0) {
    const message = violations.map(v =>
      `${v.file}:${v.line} - Found ${v.pattern}: ${v.content.substring(0, 80)}`
    ).join('\n');
    expect.fail(`Found ${violations.length} malformed code artifact(s):\n${message}`);
  }

  expect(violations).toEqual([]);
});

/**
 * Ensure all source files end with a newline.
 */
test('source files should end with newline', () => {
  const sourceFiles = [
    'backstage.js',
    'composers.js',
    'play.js',
    'rhythm.js',
    'sheet.js',
    'stage.js',
    'time.js',
    'venue.js',
    'writer.js'
  ];

  const violations = [];

  sourceFiles.forEach(file => {
    const filePath = path.join(__dirname, '..', 'src', file);
    if (!fs.existsSync(filePath)) return;

    const content = fs.readFileSync(filePath, 'utf8');
    if (content.length > 0 && !content.endsWith('\n')) {
      violations.push(file);
    }
  });

  if (violations.length > 0) {
    expect.fail(`Files missing final newline: ${violations.join(', ')}`);
  }

  expect(violations).toEqual([]);
});

/**
 * Check that critical timing functions have JSDoc annotations.
 */
test('critical timing functions should have JSDoc', () => {
  const filePath = path.join(__dirname, '..', 'src', 'time.js');
  const content = fs.readFileSync(filePath, 'utf8');

  const criticalFunctions = [
    'getMidiMeter',
    'setMidiTiming',
    'setUnitTiming',
    'getPolyrhythm'
  ];

  const violations = [];

  criticalFunctions.forEach(funcName => {
    // Look for JSDoc (/** ... */) before function declaration
    const patterns = [
      new RegExp(`/\\*\\*[\\s\\S]*?\\*/\\s*${funcName}\\s*[=(]`, 'g'),
      new RegExp(`/\\*\\*[\\s\\S]*?\\*/\\s*function\\s+${funcName}\\s*\\(`, 'g')
    ];

    const hasJSDoc = patterns.some(pattern => pattern.test(content));

    if (!hasJSDoc) {
      violations.push(funcName);
    }
  });

  if (violations.length > 0) {
    expect.fail(`Missing JSDoc for critical functions: ${violations.join(', ')}`);
  }

  expect(violations).toEqual([]);
});

/**
 * Check for common typos in the codebase.
 */
test('source files should not contain common typos', () => {
  const sourceFiles = [
    'backstage.js',
    'composers.js',
    'play.js',
    'rhythm.js',
    'sheet.js',
    'stage.js',
    'time.js',
    'venue.js',
    'writer.js'
  ];

  const typoPatterns = [
    { pattern: /\brhtyhm\b/gi, correct: 'rhythm' },
    { pattern: /\bsubsubdivRhthm\b/g, correct: 'subsubdivRhythm' },
    { pattern: /\bteh\b/gi, correct: 'the' },
    { pattern: /\bfunciton\b/gi, correct: 'function' },
    { pattern: /\bretrun\b/gi, correct: 'return' }
  ];

  const violations = [];

  sourceFiles.forEach(file => {
    const filePath = path.join(__dirname, '..', 'src', file);
    if (!fs.existsSync(filePath)) return;

    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');

    typoPatterns.forEach(({ pattern, correct }) => {
      let match;
      const regex = new RegExp(pattern.source, pattern.flags);

      while ((match = regex.exec(content)) !== null) {
        const beforeMatch = content.substring(0, match.index);
        const lineNumber = beforeMatch.split('\n').length;
        const lineContent = lines[lineNumber - 1];

        violations.push({
          file,
          line: lineNumber,
          typo: match[0],
          correct,
          content: lineContent.trim()
        });
      }
    });
  });

  if (violations.length > 0) {
    const message = violations.map(v =>
      `${v.file}:${v.line} - Typo "${v.typo}" should be "${v.correct}": ${v.content.substring(0, 60)}`
    ).join('\n');
    expect.fail(`Found ${violations.length} typo(s):\n${message}`);
  }

  expect(violations).toEqual([]);
});

/**
 * Verify naming conventions: camelCase for functions/variables.
 */
test('function names should follow camelCase convention', () => {
  const sourceFiles = [
    'backstage.js',
    'composers.js',
    'play.js',
    'rhythm.js',
    'sheet.js',
    'stage.js',
    'time.js',
    'venue.js',
    'writer.js'
  ];

  const violations = [];

  sourceFiles.forEach(file => {
    const filePath = path.join(__dirname, '..', 'src', file);
    if (!fs.existsSync(filePath)) return;

    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');

    // Match function declarations: function name(...) or name = function(...) or name = (...) =>
    const functionPattern = /(?:function\s+([a-zA-Z_][a-zA-Z0-9_]*)|([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(?:function|\([^)]*\)\s*=>))/g;

    let match;
    while ((match = functionPattern.exec(content)) !== null) {
      const funcName = match[1] || match[2];

      // Skip if it's all caps (constant) or starts with _ (private/unused)
      if (/^[A-Z_]+$/.test(funcName) || funcName.startsWith('_')) continue;

      // Check for snake_case or PascalCase (except class names which can be PascalCase)
      const hasUnderscore = /_/.test(funcName) && funcName !== '_';
      const isPascalCase = /^[A-Z]/.test(funcName);

      // Allow PascalCase for known classes
      const knownClasses = ['TimingContext', 'LayerManager'];
      if (isPascalCase && knownClasses.includes(funcName)) continue;

      if (hasUnderscore) {
        const beforeMatch = content.substring(0, match.index);
        const lineNumber = beforeMatch.split('\n').length;
        violations.push({
          file,
          line: lineNumber,
          name: funcName,
          issue: 'uses snake_case instead of camelCase'
        });
      }
    }
  });

  if (violations.length > 0) {
    const message = violations.map(v =>
      `${v.file}:${v.line} - Function "${v.name}" ${v.issue}`
    ).join('\n');
    expect.fail(`Found ${violations.length} naming violation(s):\n${message}`);
  }

  expect(violations).toEqual([]);
});
