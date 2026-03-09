// Walks the `src` directory and prints files sorted by lines of code (descending).

const fs = require('fs');
const path = require('path');
const readline = require('readline');

async function walk(dir, fileList = []) {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  for (const ent of entries) {
    // Skip node_modules just in case
    if (ent.name === 'node_modules') continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      await walk(full, fileList);
    } else if (ent.isFile()) {
      fileList.push(full);
    }
  }
  return fileList;
}

async function countLines(filePath) {
  const rs = fs.createReadStream(filePath);
  const rl = readline.createInterface({ input: rs, crlfDelay: Infinity });
  let count = 0;
  for await (const _ of rl) count++;
  return count;
}

async function countLinesForFiles(files, concurrency = 8) {
  const results = new Array(files.length);
  let idx = 0;
  async function worker() {
    while (true) {
      const i = idx++;
      if (typeof i === 'undefined' || i >= files.length) return;
      const f = files[i];
      try {
        results[i] = await countLines(f);
      } catch (e) {
        console.error(`Error reading ${f}: ${e && e.message ? e.message : e}`);
        results[i] = 0;
      }
    }
  }
  const workers = Array.from({ length: Math.max(1, concurrency) }, () => worker());
  await Promise.all(workers);
  return results;
}

async function main() {
  const arg = process.argv[2];
  const srcDir = arg ? path.resolve(process.cwd(), arg) : path.resolve(__dirname, '..', 'src');

  try {
    const st = await fs.promises.stat(srcDir);
    if (!st.isDirectory()) {
      console.error(`Specified path is not a directory: ${srcDir}`);
      process.exit(2);
    }
  } catch (err) {
    console.error(`Cannot access src directory: ${srcDir}\n${err && err.message ? err.message : err}`);
    process.exit(2);
  }

  const files = await walk(srcDir);
  if (files.length === 0) {
    console.log('No files found under', srcDir);
    return;
  }

  const concurrency = 8;
  const counts = await countLinesForFiles(files, concurrency);

  const report = files.map((f, i) => {
    const rel = path.relative(process.cwd(), f).replace(/\\+/g, '/');
    return { file: rel, lines: counts[i] };
  });

  // Sort ascending by line count, then alphabetically by file path for ties
  report.sort((a, b) => a.lines - b.lines || a.file.localeCompare(b.file));

  for (const r of report) {
    console.log(`${r.file} - ${r.lines} ${r.lines === 1 ? 'line' : 'lines'}`);
  }
}

main().catch(err => { console.error(err && err.stack ? err.stack : err); process.exit(1); });
