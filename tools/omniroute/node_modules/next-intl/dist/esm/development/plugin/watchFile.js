import fs from 'fs';
import path from 'path';

/**
 * Wrapper around `fs.watch` that provides a workaround
 * for https://github.com/nodejs/node/issues/5039.
 */
function watchFile(filepath, callback) {
  const directory = path.dirname(filepath);
  const filename = path.basename(filepath);
  return fs.watch(directory, {
    persistent: false,
    recursive: false
  }, (event, changedFilename) => {
    if (changedFilename === filename) {
      callback();
    }
  });
}

export { watchFile as default };
