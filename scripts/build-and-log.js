#!/usr/bin/env node
// scripts/build-and-log.js
// Build TypeScript with 15-second timeout and log to file

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const logFile = path.join(process.cwd(), 'build.log');
const logStream = fs.createWriteStream(logFile, { flags: 'w' });

const startTime = Date.now();
const startMsg = `\n${'='.repeat(60)}\nBuild started at ${new Date().toISOString()}\n${'='.repeat(60)}\n`;

console.log(startMsg.trim());
logStream.write(startMsg);

try {
  const result = spawnSync('npm', ['run', 'build'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 15000, // 15 second timeout
    encoding: 'utf-8',
    shell: true // Required for Windows to find npm.cmd
  });

  const output = (result.stdout || '') + (result.stderr || '');
  logStream.write(output);
  process.stdout.write(output);

  const duration = Date.now() - startTime;
  const endMsg = `\n${'='.repeat(60)}\nBuild completed in ${duration}ms\nLog saved to: ${logFile}\n${'='.repeat(60)}\n`;

  logStream.write(endMsg);
  console.log(endMsg.trim());

  if (result.error) {
    if (result.error.code === 'ETIMEDOUT') {
      console.error('\n❌ Build timeout after 15 seconds');
      logStream.write('\nBuild timeout after 15 seconds\n');
    } else {
      console.error('\n❌ Build error:', result.error.message);
      logStream.write(`\nBuild error: ${result.error.message}\n`);
    }
    logStream.end();
    process.exit(1);
  }

  if (result.status !== 0) {
    console.error(`\n❌ Build failed with exit code ${result.status}`);
    logStream.write(`\nBuild failed with exit code ${result.status}\n`);
    logStream.end();
    process.exit(result.status);
  }

  console.log('✅ Build successful');
  logStream.write('\nBuild successful\n');
  logStream.end();
} catch (error) {
  console.error('❌ Build error:', error.message);
  logStream.write(`\nUnexpected error: ${error.message}\n`);
  logStream.end();
  process.exit(1);
}
