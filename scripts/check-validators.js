const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '..', 'src');

function findMismatches(dir) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
            findMismatches(fullPath);
        } else if (fullPath.endsWith('.js')) {
            const content = fs.readFileSync(fullPath, 'utf8');
            const basename = path.basename(fullPath, '.js');

            // Match Validator.create('Name') or Validator.create("Name")
            const regex = /Validator\.create\(['"]([^'"]+)['"]\)/g;
            let match;

            while ((match = regex.exec(content)) !== null) {
                const validatorName = match[1];
                if (validatorName !== basename) {
                    // Make path relative to workspace root for cleaner output
                    const relPath = path.relative(path.join(__dirname, '..'), fullPath);
                    console.log(`${relPath}: expected '${basename}', found '${validatorName}'`);
                }
            }
        }
    }
}

console.log('Checking for Validator.create() mismatches...\n');
findMismatches(srcDir);
console.log('\nDone.');
