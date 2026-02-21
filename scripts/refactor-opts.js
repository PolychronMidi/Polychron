const fs = require('fs');
const path = require('path');

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat && stat.isDirectory()) {
      results = results.concat(walk(filePath));
    } else if (filePath.endsWith('.js')) {
      results.push(filePath);
    }
  });
  return results;
}

const targetDir = path.join(__dirname, '../src/conductor');
const files = walk(targetDir);

let updatedCount = 0;

files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  const originalContent = content;

  // Only process files that actually contain the target pattern
  if (content.includes('opts || {}')) {
    // 1. Replace `opts || {}` with `opts`
    content = content.replace(/\bopts\s*\|\|\s*\{\}/g, 'opts');

    // 2. Update function signatures to use default parameters

    // Matches: function name(opts) or function(opts)
    content = content.replace(/(function\s*\w*\s*\([^)]*?)\bopts\b(?!\s*=)([^)]*\))/g, '$1opts = {}$2');

    // Matches: (opts) =>
    content = content.replace(/(\([^)]*?)\bopts\b(?!\s*=)([^)]*\)\s*=>)/g, '$1opts = {}$2');

    // Matches: opts => (and adds parentheses since default params require them)
    content = content.replace(/\bopts\s*=>/g, '(opts = {}) =>');

    // Matches: method(opts) {
    // Uses negative lookahead to avoid matching control structures like `if (opts) {`
    content = content.replace(/^(\s*(?!if|for|while|switch|catch)\w+\s*\([^)]*?)\bopts\b(?!\s*=)([^)]*\)\s*\{)/gm, '$1opts = {}$2');

    if (content !== originalContent) {
      fs.writeFileSync(file, content, 'utf8');
      console.log(`Updated ${path.relative(process.cwd(), file)}`);
      updatedCount++;
    }
  }
});

console.log(`\nDone! Updated ${updatedCount} files.`);
