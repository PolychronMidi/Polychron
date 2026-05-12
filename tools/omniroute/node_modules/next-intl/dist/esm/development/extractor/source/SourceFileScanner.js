import fs from 'fs/promises';
import path from 'path';
import SourceFileFilter from './SourceFileFilter.js';

class SourceFileScanner {
  static async walkSourceFiles(dir, srcPaths, acc = []) {
    const entries = await fs.readdir(dir, {
      withFileTypes: true
    });
    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SourceFileFilter.shouldEnterDirectory(entryPath, srcPaths)) {
          continue;
        }
        await SourceFileScanner.walkSourceFiles(entryPath, srcPaths, acc);
      } else {
        if (SourceFileFilter.isSourceFile(entry.name)) {
          acc.push(entryPath);
        }
      }
    }
    return acc;
  }
  static async getSourceFiles(srcPaths) {
    const files = (await Promise.all(srcPaths.map(srcPath => SourceFileScanner.walkSourceFiles(srcPath, srcPaths)))).flat();
    return new Set(files);
  }
}

export { SourceFileScanner as default };
