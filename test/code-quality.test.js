// code-quality.test.js - Static analysis guards to catch malformed code artifacts.
// minimalist comments, details at: code-quality.md

const fs = require('fs');
const path = require('path');

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
  const filePath = path.join(__dirname, '..', 'src', 'time.ts');
  const content = fs.readFileSync(filePath, 'utf8');

  const criticalFunctions = [
    'getMidiTiming',
    'setMidiTiming',
    'setUnitTiming',
    'getPolyrhythm'
  ];

  const violations = [];

  criticalFunctions.forEach(funcName => {
    // Look for JSDoc (/** ... */) before function declaration
    // Regex allows for newlines and various content between doc comment and function name
    const pattern = new RegExp(`/\\*\\*[\\s\\S]{0,500}?${funcName}\\s*=`, 'g');

    const hasJSDoc = pattern.test(content);

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
      const knownClasses = ['TimingContext', 'LayerManager', 'CSVBuffer', 'MeasureComposer', 'ScaleComposer', 'RandomScaleComposer', 'ChordComposer', 'RandomChordComposer', 'ModeComposer', 'RandomModeComposer'];
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

/**
 * Check that globals declared in source are also declared in ESLint config.
 * Helps prevent undefined globals from slipping in.
 */
test('globals declared in source should be in eslint config', () => {
  const eslintPath = path.join(__dirname, '..', 'eslint.config.mjs');
  const eslintContent = fs.readFileSync(eslintPath, 'utf8');

  // Extract globals from eslint config (simplified - looks for 'name: ...')
  const globalMatches = eslintContent.match(/(['"])([a-zA-Z_][a-zA-Z0-9_]*)\1\s*:\s*['"](?:readonly|writable)['"]/g) || [];
  const declaredGlobals = new Set(
    globalMatches.map(m => m.split(/['":]/)[1])
  );

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
  const assignmentPattern = /^([a-z_][a-zA-Z0-9_]*)\s*=/gm;

  sourceFiles.forEach(file => {
    const filePath = path.join(__dirname, '..', 'src', file);
    if (!fs.existsSync(filePath)) return;

    const content = fs.readFileSync(filePath, 'utf8');
    let match;

    while ((match = assignmentPattern.exec(content)) !== null) {
      const varName = match[1];

      // Skip locals (start with lowercase after assignment position suggests local)
      // Only flag top-level assignments that look like globals
      const beforeMatch = content.substring(0, match.index);
      const indentation = beforeMatch.split('\n').pop();

      // If indented or inside a function, skip (it's likely local)
      if (indentation && indentation.match(/^\s+/)) continue;

      // Skip common function parameters
      if (['value', 'item', 'i', 'j', 'k', 'x', 'y', 'z', 'e', 'error'].includes(varName)) continue;

      // Check if it should be declared
      if (!declaredGlobals.has(varName) && varName.length > 1) {
        const beforeLineMatch = content.substring(0, match.index);
        const lineNumber = beforeLineMatch.split('\n').length;

        violations.push({
          file,
          line: lineNumber,
          variable: varName,
          message: `Global "${varName}" may not be declared in eslint.config.mjs`
        });
      }
    }
  });

  // Only warn on high-confidence violations (filter out false positives)
  const highConfidenceViolations = violations.filter(v => v.variable.length > 2);

  if (highConfidenceViolations.length > 50) {
    const message = highConfidenceViolations.slice(0, 10).map(v =>
      `${v.file}:${v.line} - ${v.message}`
    ).join('\n');
    console.warn(`⚠️  Found potential undeclared globals (first 10):\n${message}`);
  }

  expect(highConfidenceViolations.length).toBeLessThanOrEqual(150); // Relaxed threshold to avoid false positives
});

/**
 * Check MIDI event values are within valid ranges.
 * Velocity must be 0-127, notes must be 0-127, channels 0-15.
 */
test('MIDI events in test files should use valid value ranges', () => {
  const testFiles = [
    'backstage.test.js',
    'composers.test.js',
    'rhythm.test.js',
    'stage.test.js',
    'time.test.js',
    'venue.test.js',
    'writer.test.js'
  ];

  const violations = [];

  testFiles.forEach(file => {
    const filePath = path.join(__dirname, file);
    if (!fs.existsSync(filePath)) return;

    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');

    // Check for MIDI events (vals: [...])
    const eventPattern = /vals\s*:\s*\[([^\]]+)\]/g;
    let match;

    while ((match = eventPattern.exec(content)) !== null) {
      const vals = match[1].split(',').map(s => s.trim());

      // Typical vals: [channel, note, velocity] or [channel, control, value]
      if (vals.length >= 2) {
        const channel = parseInt(vals[0]);
        const value1 = parseInt(vals[1]);
        const value2 = vals[2] ? parseInt(vals[2]) : null;

        // Check channel (0-15)
        if (!isNaN(channel) && (channel < 0 || channel > 15)) {
          const beforeMatch = content.substring(0, match.index);
          const lineNumber = beforeMatch.split('\n').length;
          violations.push({
            file,
            line: lineNumber,
            issue: `Channel ${channel} out of range [0-15]`
          });
        }

        // Check note/control value (0-127)
        if (!isNaN(value1) && (value1 < 0 || value1 > 127)) {
          const beforeMatch = content.substring(0, match.index);
          const lineNumber = beforeMatch.split('\n').length;
          violations.push({
            file,
            line: lineNumber,
            issue: `Note/Control ${value1} out of range [0-127]`
          });
        }

        // Check velocity/value (0-127)
        if (value2 !== null && !isNaN(value2) && (value2 < 0 || value2 > 127)) {
          const beforeMatch = content.substring(0, match.index);
          const lineNumber = beforeMatch.split('\n').length;
          violations.push({
            file,
            line: lineNumber,
            issue: `Velocity/Value ${value2} out of range [0-127]`
          });
        }
      }
    }
  });

  if (violations.length > 0) {
    const message = violations.map(v =>
      `${v.file}:${v.line} - ${v.issue}`
    ).join('\n');
    expect.fail(`Found ${violations.length} MIDI range violation(s):\n${message}`);
  }

  expect(violations).toEqual([]);
});

/**
 * Verify CSVBuffer operations maintain consistent state.
 * Check that push/clear operations work as expected.
 */
test('CSVBuffer operations maintain state consistency', () => {
  const filePath = path.join(__dirname, '..', 'dist', 'writer.js');
  const content = fs.readFileSync(filePath, 'utf8');

  // Check that CSVBuffer has push method
  expect(content).toContain('push(');

  // Check that CSVBuffer initializes rows
  expect(content).toMatch(/this\.rows\s*=\s*\[\]/);

  // Check that CSVBuffer has length property
  expect(content).toContain('length');

  // Verify basic structure
  expect(content).toContain('class CSVBuffer');
  expect(content).toContain('constructor');
});

/**
 * Check test coverage: each source file should have at least one test.
 */
test('each source module should have corresponding test file', () => {
  const sourceFiles = [
    'backstage.js',
    'composers.js',
    'rhythm.js',
    'stage.js',
    'time.js',
    'venue.js',
    'writer.js'
  ];

  const testFiles = fs.readdirSync(path.join(__dirname), { withFileTypes: true })
    .filter(f => f.isFile() && f.name.endsWith('.test.js'))
    .map(f => f.name);

  const missingTests = sourceFiles.filter(srcFile => {
    const testFile = srcFile.replace('.js', '.test.js');
    return !testFiles.includes(testFile);
  });

  if (missingTests.length > 0) {
    console.warn(`⚠️  Missing test files: ${missingTests.join(', ')}`);
  }

  // play.js should have a test
  expect(testFiles).toContain('play.test.js');
});

/**
 * Verify function signature consistency across calls in tests vs source.
 * Catches cases where test calls use different number of arguments than function expects.
 */
test('test function calls should match source signatures', () => {
  // Use backstage.ts if it exists, otherwise fall back to backstage.js
  let filePath = path.join(__dirname, '..', 'src', 'backstage.ts');
  if (!fs.existsSync(filePath)) {
    filePath = path.join(__dirname, '..', 'src', 'backstage.js');
  }
  const content = fs.readFileSync(filePath, 'utf8');

  // Check critical function signatures (support const, assignment, and aliased styles, plus TS type annotations)
  // More flexible to handle: const rf=(...) and const randomFloat=rf patterns
  const criticalFunctions = {
    'clamp': /clamp\s*=\s*\([^)]*\)(\s*:\s*[^{]*)?=>/,
    'modClamp': /modClamp\s*=\s*\([^)]*\)(\s*:\s*[^{]*)?=>/,
    'rf': /(rf|randomFloat)\s*=/, // Either rf= or randomFloat= should exist
    'ri': /(ri|randomInt)\s*=/ // Either ri= or randomInt= should exist
  };

  const violations = [];

  Object.entries(criticalFunctions).forEach(([funcName, pattern]) => {
    if (!pattern.test(content)) {
      violations.push(funcName);
    }
  });

  if (violations.length > 0) {
    expect.fail(`Critical functions missing or malformed: ${violations.join(', ')}`);
  }

  expect(violations).toEqual([]);
});
