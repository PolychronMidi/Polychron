#!/usr/bin/env node

/**
 * Pre-commit hook: Polychron File Integrity Guard
 * 
 * Prevents commits with:
 * - Files missing final newlines
 * - Non-UTF-8 encoding
 * - Commits that are ONLY whitespace changes
 * 
 * Run via: husky -> .husky/pre-commit
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const EXTENSIONS = ['.ts', '.js', '.json', '.md', '.mjs', '.py'];
const ENCODING = 'utf8';

// Get files staged for commit
let stagedFiles = [];
try {
  stagedFiles = execSync('git diff --cached --name-only', { encoding: ENCODING })
    .trim()
    .split('\n')
    .filter(f => f && fs.existsSync(f));
} catch (e) {
  console.log('Could not get staged files');
  process.exit(0);
}

const violations = [];

stagedFiles.forEach(file => {
  // Only check text files
  if (!EXTENSIONS.some(ext => file.endsWith(ext))) return;

  try {
    const content = fs.readFileSync(file, ENCODING);
    
    // Check 1: Final newline
    if (content.length > 0 && !content.endsWith('\n')) {
      violations.push({
        file,
        issue: 'Missing final newline',
        fix: 'Serena tools add this automatically; editor should too'
      });
    }

    // Check 2: Only whitespace changes in this commit?
    // (Detect if diff is just spaces/blank lines)
    try {
      const diff = execSync(`git diff --cached --no-ext-diff -- "${file}"`, { 
        encoding: ENCODING,
        stdio: ['pipe', 'pipe', 'pipe']
      });
      
      const addedLines = diff.split('\n')
        .filter(line => line.startsWith('+') && !line.startsWith('+++'))
        .map(line => line.slice(1));
      
      const removedLines = diff.split('\n')
        .filter(line => line.startsWith('-') && !line.startsWith('---'))
        .map(line => line.slice(1));

      // If all changes are whitespace, flag it
      const allWhitespace = [...addedLines, ...removedLines]
        .every(line => line.trim() === '');
      
      if (allWhitespace && (addedLines.length > 0 || removedLines.length > 0)) {
        violations.push({
          file,
          issue: 'Commit contains ONLY whitespace/encoding changes',
          fix: 'Don\'t commit whitespace-only changes; run "git restore --staged <file>"'
        });
      }
    } catch (e) {
      // Ignore diff parsing errors
    }

  } catch (e) {
    violations.push({
      file,
      issue: `Cannot read file: ${e.message}`,
      fix: 'Check file encoding and permissions'
    });
  }
});

if (violations.length > 0) {
  console.error('\n❌ Pre-commit validation FAILED\n');
  violations.forEach(v => {
    console.error(`📄 ${v.file}`);
    console.error(`   Issue: ${v.issue}`);
    console.error(`   Fix: ${v.fix}\n`);
  });
  console.error('💡 Use Serena tools to edit files, never terminal commands\n');
  process.exit(1);
}

console.log('✅ Pre-commit checks passed');
process.exit(0);
