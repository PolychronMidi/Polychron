#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import getAllMdFiles from './utils/getAllMdFiles.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');
const docsDir = path.join(projectRoot, 'docs');

import { placeholderTemplate } from './utils/TODO-template.js';

const TODO_TEMPLATE = placeholderTemplate();

/**
 * Clear TODO sections in a markdown file and prepend canonical TODO template.
 * @param {string} filepath - Absolute path to the markdown file to modify.
 * @returns {boolean} True when changes are applied.
 */
function clearTodosInFile(filepath) {
  let content = fs.readFileSync(filepath, 'utf-8');

  // Remove old TODO section (either commented or uncommented)
  const todoPatternCommented = /<!-- [\s\S]*?### TODO - log of items planned[\s\S]*?-->\n\n/;
  const todoPatternUncommented = /### TODO - log of items planned[\s\S]*?(?=\n## |\n# )/;

  let hadTodo = false;

  if (todoPatternCommented.test(content)) {
    content = content.replace(todoPatternCommented, '');
    hadTodo = true;
  } else if (todoPatternUncommented.test(content)) {
    content = content.replace(todoPatternUncommented, '');
    hadTodo = true;
  }

  // Prepend TODO template at the beginning
  const updated = content;

  fs.writeFileSync(filepath, updated, 'utf-8');
  return hadTodo || true; // Always return true since we prepended
}

/**
 * CLI entry point: clear TODOs across documentation files or specified files.
 * @returns {void}
 */
function main() {
  let filesToProcess = [];

  // Check if specific files were provided as arguments
  const args = process.argv.slice(2);

  if (args.length > 0) {
    // Process comma-separated or space-separated file arguments
    const fileArgs = args.join(',').split(',').map(f => f.trim()).filter(f => f);

    for (const fileArg of fileArgs) {
      // If it's just a filename, look for it in docs
      let filepath;
      if (fileArg.includes('/') || fileArg.includes('\\')) {
        filepath = path.join(projectRoot, fileArg);
      } else {
        filepath = path.join(docsDir, fileArg);
      }

      // Try with .md extension if not provided
      if (!filepath.endsWith('.md')) {
        filepath += '.md';
      }

      if (fs.existsSync(filepath)) {
        filesToProcess.push(filepath);
      } else {
        console.warn(`Warning: File not found: ${filepath}`);
      }
    }
  } else {
    // Process all .md files
    filesToProcess = getAllMdFiles(docsDir);
  }

  if (filesToProcess.length === 0) {
    console.log('No files to process.');
    return;
  }

  console.log(`Clearing TODOs in ${filesToProcess.length} file(s)...`);
  console.log('-'.repeat(60));

  let clearedCount = 0;

  for (const filepath of filesToProcess) {
    const relative = path.relative(projectRoot, filepath);
    try {
      if (clearTodosInFile(filepath)) {
        console.log(`✓ Cleared: ${relative}`);
        clearedCount++;
      } else {
        console.log(`- Skipped (no TODO): ${relative}`);
      }
    } catch (err) {
      console.error(`✗ Error: ${relative} - ${err.message}`);
    }
  }

  console.log('-'.repeat(60));
  console.log(`Total cleared: ${clearedCount}/${filesToProcess.length}`);
}

main();
