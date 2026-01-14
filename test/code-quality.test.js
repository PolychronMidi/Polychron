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
    const filePath = path.join(__dirname, '..', file);
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
    const filePath = path.join(__dirname, '..', file);
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
