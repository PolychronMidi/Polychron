import { cache } from 'react';
import { createTranslator } from 'use-intl/core';

function getServerTranslatorImpl(config, namespace) {
  return createTranslator({
    ...config,
    namespace
  });
}
var getServerTranslator = cache(getServerTranslatorImpl);

export { getServerTranslator as default };
