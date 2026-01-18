#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');
const docsDir = path.join(projectRoot, 'docs');

const TODO_TEMPLATE = `<!-- 
### TODO - log of items planned / in progress

- [mm-dd-hh:mm] Example (newest) TODO Title - One sentence summary.
[mm-dd-hh:mm] Timestamped note of latest development or roadblock for this TODO
[mm-dd-hh:mm] Older timestamped notes for this TODO

- mm-dd-hh:mm Example Todo #2 (older) , etc...
-->

`;

function getAllMdFiles() {
  const files = [];
  
  function walkDir(dir) {
    const entries = fs.readdirSync(dir);
    for (const entry of entries) {
      const fullPath = path.join(dir, entry);
      const stat = fs.statSync(fullPath);
      
      if (stat.isDirectory()) {
        walkDir(fullPath);
      } else if (entry.endsWith('.md')) {
        // Skip README.md and .TEMPLATE.md
        if (entry !== 'README.md' && entry !== '.TEMPLATE.md') {
          files.push(fullPath);
        }
      }
    }
  }
  
  walkDir(docsDir);
  return files;
}

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
  const updated = TODO_TEMPLATE + content;
  
  fs.writeFileSync(filepath, updated, 'utf-8');
  return hadTodo || true; // Always return true since we prepended
}

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
    filesToProcess = getAllMdFiles();
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
