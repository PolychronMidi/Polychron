/**
 * Run a command and stream stdout/stderr to a log file while mirroring it to the console.
 * Usage: node scripts/run-with-log.js <logFile> <command> [args...]
 * @module scripts/run-with-log
 */
import { spawn } from 'child_process';
import { createWriteStream } from 'fs';
import { mkdir } from 'fs/promises';

const [, , logFile, ...command] = process.argv;

if (!logFile || command.length === 0) {
  console.error('Usage: node scripts/run-with-log.js <logFile> <command> [args...]');
  process.exit(1);
} else {
  console.log(`Logging output to log/${logFile}`);
}

await mkdir('log', { recursive: true });

const logStream = createWriteStream(`log/${logFile}`);
const proc = spawn(command[0], command.slice(1), { shell: true, stdio: 'pipe' });

proc.stdout.on('data', (data) => {
  process.stdout.write(data);
  logStream.write(data);
});

proc.stderr.on('data', (data) => {
  process.stderr.write(data);
  logStream.write(data);
});

proc.on('close', (code) => {
  logStream.end();
  process.exit(code);
});
