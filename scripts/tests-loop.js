#!/usr/bin/env node

/**
 * Run tests repeatedly and log failures.
 * @module scripts/tests-loop
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

/**
 * Execute the test loop.
 * @param {number} iterations - Number of iterations to run.
 * @param {string} [testFile] - Optional test file to run.
 */
function runTestsLoop(iterations, testFile = '') {
  const logFile = path.join(process.cwd(), 'test-failures.log');

  let failureCount = 0;
  let passCount = 0;
  let failedRuns = [];

  console.log(`Running tests ${iterations} times${testFile ? ` (${testFile})` : ''}...`);
  console.log(`Failures will be logged to: ${logFile}\n`);

  // Clear log file
  fs.writeFileSync(logFile, '');

  for (let i = 1; i <= iterations; i++) {
    try {
      const cmd = testFile 
        ? `npm test -- ${testFile} 2>&1` 
        : `npm test 2>&1`;
      
      const output = execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
      
      // Check if tests passed
      if (output.includes('failed')) {
        failureCount++;
        failedRuns.push(i);
        
        // Extract failure information
        const failureMatch = output.match(/(\d+)\s+failed.*?(\d+)\s+passed/);
        if (failureMatch) {
          fs.appendFileSync(logFile, `\n=== RUN ${i}: FAILED ===\n`);
          fs.appendFileSync(logFile, `Failed: ${failureMatch[1]}, Passed: ${failureMatch[2]}\n`);
          
          // Extract assertion errors
          const errorMatches = output.match(/AssertionError: .+/g);
          if (errorMatches) {
            errorMatches.forEach(err => {
              fs.appendFileSync(logFile, `  ${err}\n`);
            });
          }
        }
        process.stdout.write('✗');
      } else {
        passCount++;
        process.stdout.write('✓');
      }
    } catch (error) {
      failureCount++;
      failedRuns.push(i);
      fs.appendFileSync(logFile, `\n=== RUN ${i}: ERROR ===\n`);
      fs.appendFileSync(logFile, error.message + '\n');
      process.stdout.write('✗');
    }
    
    if (i % 10 === 0) process.stdout.write(` ${i}\n`);
  }

  console.log(`\n\n=== RESULTS ===`);
  console.log(`Passed: ${passCount}/${iterations}`);
  console.log(`Failed: ${failureCount}/${iterations}`);

  if (failedRuns.length > 0) {
    console.log(`\nFailed on runs: ${failedRuns.join(', ')}`);
    console.log(`\nDetails logged to: ${logFile}`);
  } else {
    console.log('\n✓ All runs passed!');
  }

  process.exit(failureCount > 0 ? 1 : 0);
}

const iterations = parseInt(process.argv[2]) || 20;
const testFile = process.argv[3] || '';
runTestsLoop(iterations, testFile);
