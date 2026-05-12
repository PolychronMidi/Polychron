import fs from 'fs';
/**
 * Wrapper around `fs.watch` that provides a workaround
 * for https://github.com/nodejs/node/issues/5039.
 */
export default function watchFile(filepath: string, callback: () => void): fs.FSWatcher;
