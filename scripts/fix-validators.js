const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '..', 'src');

function fixMismatches(dir) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
            fixMismatches(fullPath);
        } else if (fullPath.endsWith('.js')) {
            let content = fs.readFileSync(fullPath, 'utf8');
            const basename = path.basename(fullPath, '.js');

            const regex = /Validator\.create\(['"]([^'"]+)['"]\)/g;
            let match;
            let changed = false;

            while ((match = regex.exec(content)) !== null) {
                const validatorName = match[1];
                if (validatorName !== basename) {
                    content = content.replace(`Validator.create('${validatorName}')`, `Validator.create('${basename}')`);
                    content = content.replace(`Validator.create("${validatorName}")`, `Validator.create('${basename}')`);
                    changed = true;
                }
            }

            if (changed) {
                fs.writeFileSync(fullPath, content, 'utf8');
                console.log(`Fixed ${path.relative(path.join(__dirname, '..'), fullPath)}`);
            }
        }
    }
}

fixMismatches(srcDir);
console.log('Done fixing mismatches.');
