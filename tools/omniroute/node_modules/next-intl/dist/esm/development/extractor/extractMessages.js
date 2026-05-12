import ExtractionCompiler from './ExtractionCompiler.js';
import MessageExtractor from './extractor/MessageExtractor.js';
import { getDefaultProjectRoot } from './utils.js';

async function extractMessages(params) {
  const compiler = new ExtractionCompiler(params, {
    extractor: new MessageExtractor({
      isDevelopment: false,
      projectRoot: getDefaultProjectRoot()
    })
  });
  await compiler.extractAll();
}

export { extractMessages as default };
