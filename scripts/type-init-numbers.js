const fs = require('fs');
const path = require('path');

const initPath = path.join(__dirname, '../src/utils/init.js');
const globalsPath = path.join(__dirname, '../src/types/globals.d.ts');

const initContent = fs.readFileSync(initPath, 'utf8');
const lines = initContent.split('\n');
const line12 = lines[11]; // 0-indexed

// Extract variables from line 12: a=b=c=0;
const vars = line12.split('=')
  .map(v => v.trim().replace(';', ''))
  .filter(v => v && v !== '0');

let globalsContent = fs.readFileSync(globalsPath, 'utf8');

let count = 0;
for (const v of vars) {
  const regex = new RegExp(`declare var ${v}:\\s*any;`, 'g');
  if (regex.test(globalsContent)) {
    globalsContent = globalsContent.replace(regex, `declare var ${v}: number;`);
    count++;
  }
}

fs.writeFileSync(globalsPath, globalsContent);
console.log(`Updated ${count} variables to type number in globals.d.ts`);
