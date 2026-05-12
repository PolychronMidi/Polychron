import MessageExtractor from './extractor/MessageExtractor.js';

// Module-level extractor instance for transformation caching.
// Note: Next.js/Turbopack may create multiple loader instances, but each
// only handles file transformation. The ExtractionCompiler (which manages
// catalogs) is initialized separately in createNextIntlPlugin.
let extractor;
function extractionLoader(source) {
  const callback = this.async();
  const projectRoot = this.rootContext;

  // Avoid rollup's `replace` plugin to compile this away
  const isDevelopment = process.env['NODE_ENV'.trim()] === 'development';
  if (!extractor) {
    extractor = new MessageExtractor({
      isDevelopment,
      projectRoot,
      sourceMap: this.sourceMap
    });
  }
  extractor.extract(this.resourcePath, source).then(result => {
    callback(null, result.code, result.map);
  }).catch(callback);
}

export { extractionLoader as default };
