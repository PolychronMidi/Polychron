import { cache } from 'react';
import getConfig from './getConfig.js';
import getServerExtractor from './getServerExtractor.js';

// Call signature 1: `getExtracted(namespace)`

// Call signature 2: `getExtracted({locale, namespace})`

// Implementation
async function getExtractedImpl(namespaceOrOpts) {
  let namespace;
  let locale;
  if (typeof namespaceOrOpts === 'string') {
    namespace = namespaceOrOpts;
  } else if (namespaceOrOpts) {
    locale = namespaceOrOpts.locale;
    namespace = namespaceOrOpts.namespace;
  }
  const config = await getConfig(locale);
  return getServerExtractor(config, namespace);
}
const getExtracted = cache(getExtractedImpl);

export { getExtracted as default };
