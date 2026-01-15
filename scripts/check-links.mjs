#!/usr/bin/env node
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

function findMarkdownFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  files.forEach(file => {
    const filePath = path.join(dir, file);
    if (fs.statSync(filePath).isDirectory()) {
      findMarkdownFiles(filePath, fileList);
    } else if (file.endsWith('.md')) {
      fileList.push(filePath);
    }
  });
  return fileList;
}

const projectRoot = process.cwd();
const docsDir = path.join(projectRoot, 'docs');
const mdFiles = findMarkdownFiles(docsDir);

let exitCode = 0;
for (const file of mdFiles) {
  console.log(`Checking ${path.relative(projectRoot, file)}...`);
  try {
    execSync(`npx markdown-link-check --config .markdown-link-check.json "${file}"`, {
      stdio: 'inherit',
      cwd: projectRoot
    });
  } catch (e) {
    exitCode = 1;
  }
}

process.exit(exitCode);
