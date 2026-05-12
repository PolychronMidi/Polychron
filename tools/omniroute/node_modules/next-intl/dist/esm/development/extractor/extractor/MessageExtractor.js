import { createRequire } from 'module';
import path from 'path';
import { transform } from '@swc/core';
import { getDefaultProjectRoot, normalizePathToPosix } from '../utils.js';
import LRUCache from './LRUCache.js';

const require$1 = createRequire(import.meta.url);
class MessageExtractor {
  compileCache = new LRUCache(750);
  constructor(opts) {
    this.isDevelopment = opts.isDevelopment ?? false;
    this.projectRoot = opts.projectRoot ?? getDefaultProjectRoot();
    this.sourceMap = opts.sourceMap ?? false;
  }
  async extract(absoluteFilePath, source) {
    const cacheKey = [source, absoluteFilePath].join('!');
    const cached = this.compileCache.get(cacheKey);
    if (cached) return cached;

    // Shortcut parsing if hook is not used. The Turbopack integration already
    // pre-filters this, but for webpack this feature doesn't exist, so we need
    // to do it here.
    if (!source.includes('useExtracted') && !source.includes('getExtracted')) {
      return {
        messages: [],
        code: source
      };
    }
    const filePath = normalizePathToPosix(path.relative(this.projectRoot, absoluteFilePath));
    const result = await transform(source, {
      jsc: {
        target: 'esnext',
        parser: {
          syntax: 'typescript',
          tsx: true,
          decorators: true
        },
        experimental: {
          cacheRoot: 'node_modules/.cache/swc',
          disableBuiltinTransformsForInternalTesting: true,
          disableAllLints: true,
          plugins: [[require$1.resolve('next-intl-swc-plugin-extractor'), {
            isDevelopment: this.isDevelopment,
            filePath
          }]]
        }
      },
      sourceMaps: this.sourceMap,
      sourceFileName: filePath,
      filename: filePath
    });

    // TODO: Improve the typing of @swc/core
    const output = result.output;
    const messages = JSON.parse(JSON.parse(output).results);
    const extractionResult = {
      code: result.code,
      map: result.map,
      messages
    };
    this.compileCache.set(cacheKey, extractionResult);
    return extractionResult;
  }
}

export { MessageExtractor as default };
