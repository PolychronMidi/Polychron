import { cache } from 'react';
import getConfig from './getConfig.js';
import getServerTranslator from './getServerTranslator.js';

// Maintainer note: `getTranslations` has two different call signatures.
// We need to define these with function overloads, otherwise TypeScript
// messes up the return type.

// Call signature 1: `getTranslations(namespace)`

// Call signature 2: `getTranslations({locale, namespace})`

// Implementation
async function getTranslations(namespaceOrOpts) {
  let namespace;
  let locale;
  if (typeof namespaceOrOpts === 'string') {
    namespace = namespaceOrOpts;
  } else if (namespaceOrOpts) {
    locale = namespaceOrOpts.locale;
    namespace = namespaceOrOpts.namespace;
  }
  const config = await getConfig(locale);
  return getServerTranslator(config, namespace);
}
var getTranslations_default = cache(getTranslations);

export { getTranslations_default as default };
