/**
 * Recursively collect .md files under a docs directory (skipping README.md / .TEMPLATE.md).
 * @param {string} docsDir - The docs directory to scan.
 * @returns {string[]} Array of file paths.
 */
import fs from 'fs';
import path from 'path';
export default function getAllMdFiles(docsDir) {
  const files = [];
  function walkDir(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) walkDir(fullPath);
      else if (entry.name.endsWith('.md')) {
        if (entry.name !== 'README.md' && entry.name !== '.TEMPLATE.md') files.push(fullPath);
      }
    }
  }
  walkDir(docsDir);
  return files;
}
