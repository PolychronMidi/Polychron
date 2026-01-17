import { spawnSync } from 'child_process';

function runCommand(cmd, args) {
  console.log(`Running: ${cmd} ${args.join(' ')}`);
  const result = spawnSync(cmd, args, {
    shell: true,
    stdio: 'inherit',
    encoding: 'utf-8'
  });

  if (result.status !== 0) {
    console.error(`\n❌ Command failed with exit code ${result.status}\n`);
    process.exit(result.status);
  }
  console.log();
}

console.log('\n=== FULL PIPELINE TEST ===\n');

console.log('1. Linting...');
runCommand('npm', ['run', 'lint:raw']);

console.log('2. Type checking...');
runCommand('npm', ['run', 'type-check']);

console.log('3. Building...');
runCommand('npm', ['run', 'build:raw']);

console.log('4. Testing...');
runCommand('npm', ['run', 'test:raw']);

console.log('5. Running play...');
runCommand('npm', ['run', 'play:raw']);

console.log('=== ALL SYSTEMS OPERATIONAL ===\n');
