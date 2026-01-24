import fs from 'fs';
import path from 'path';
const out = path.resolve(process.cwd(), 'output');
if (!fs.existsSync(out)) process.exit(0);
const files = fs.readdirSync(out).filter(f => f.endsWith('.csv'));
for (const f of files) {
  const p = path.join(out, f);
  try {
    let s = fs.readFileSync(p, 'utf8');
    const before = (s.match(/unitHash:/g) || []).length;
    s = s.replace(/\bunitHash:[0-9A-Za-z]+,?/g, '')
         .replace(/,([0-9A-Za-z]{4,8})(?=(\r?\n|$))/gm, '')
         .replace(/,,+/g, ',')
         .replace(/,\r?\n/g, '\n')
         .replace(/(^,|,\r?\n)/gm, '\n');
    const after = (s.match(/unitHash:/g) || []).length;
    if (before !== after) {
      fs.writeFileSync(p, s);
      console.log(`Scrubbed unitHash tokens from ${p}: ${before} -> ${after}`);
    } else {
      console.log(`No unitHash tokens found in ${p}`);
    }
  } catch (e) {
    console.error('Failed to scrub', p, e && e.message);
  }
}
