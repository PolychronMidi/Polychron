// Main Entry Point - Refactored Polychron system
import { PolychronEngine } from './polychronEngine.js';
import { CONFIG } from './config.js';

(async () => {
  try {
    console.log('─ Initialising Polychron MIDI engine …');
    const engine = new PolychronEngine(CONFIG);

    console.log('─ Generating composition … (this may take a few seconds)');
    const { filename, duration } = await engine.generateComposition();

    console.log(`✓ Finished! File: ${filename}  Duration: ${duration}`);
    console.log('You can now open the CSV or convert it to a .mid file.');
  } catch (err) {
    console.error('✗ Unhandled error:', err);
    process.exit(1);
  }
})();
