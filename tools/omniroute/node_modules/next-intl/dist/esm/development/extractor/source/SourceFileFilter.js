import path from 'path';

class SourceFileFilter {
  static EXTENSIONS = ['ts', 'tsx', 'js', 'jsx'];

  // Will not be entered, except if explicitly asked for
  // TODO: At some point we should infer these from .gitignore
  static IGNORED_DIRECTORIES = ['node_modules', '.next', '.git'];
  static isSourceFile(filePath) {
    const ext = path.extname(filePath);
    return SourceFileFilter.EXTENSIONS.map(cur => '.' + cur).includes(ext);
  }
  static shouldEnterDirectory(dirPath, srcPaths) {
    const dirName = path.basename(dirPath);
    if (SourceFileFilter.IGNORED_DIRECTORIES.includes(dirName)) {
      return SourceFileFilter.isIgnoredDirectoryExplicitlyIncluded(dirPath, srcPaths);
    }
    return true;
  }
  static isIgnoredDirectoryExplicitlyIncluded(ignoredDirPath, srcPaths) {
    return srcPaths.some(srcPath => SourceFileFilter.isWithinPath(srcPath, ignoredDirPath));
  }
  static isWithinPath(targetPath, basePath) {
    const relativePath = path.relative(basePath, targetPath);
    return relativePath === '' || !relativePath.startsWith('..');
  }
}

export { SourceFileFilter as default };
