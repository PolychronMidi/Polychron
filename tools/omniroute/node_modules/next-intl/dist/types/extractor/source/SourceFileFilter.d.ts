export default class SourceFileFilter {
    static readonly EXTENSIONS: string[];
    static readonly IGNORED_DIRECTORIES: string[];
    static isSourceFile(filePath: string): boolean;
    static shouldEnterDirectory(dirPath: string, srcPaths: Array<string>): boolean;
    private static isIgnoredDirectoryExplicitlyIncluded;
    static isWithinPath(targetPath: string, basePath: string): boolean;
}
