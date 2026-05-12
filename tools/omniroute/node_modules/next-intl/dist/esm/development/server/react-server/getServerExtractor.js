import { cache } from 'react';
import getServerTranslator from './getServerTranslator.js';

// Note: This API is usually compiled into `useTranslations`,
// but there is some fallback handling which allows this hook
// to still work when not being compiled.
//
// This is relevant for:
// - Isolated environments like tests, Storybook, etc.
// - Fallbacks in case an extracted message is not yet available
function getServerExtractorImpl(config, namespace) {
  const t = getServerTranslator(config, namespace);
  function translateFn(...[message, values, formats]) {
    return t(undefined, values, formats,
    // @ts-expect-error -- Secret fallback parameter
    message );
  }
  translateFn.rich = function translateRichFn(...[message, values, formats]) {
    return t.rich(undefined, values, formats,
    // @ts-expect-error -- Secret fallback parameter
    message );
  };
  translateFn.markup = function translateMarkupFn(...[message, values, formats]) {
    return t.markup(undefined, values, formats,
    // @ts-expect-error -- Secret fallback parameter
    message );
  };
  translateFn.has = function translateHasFn(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  ...[message]) {
    // Not really something better we can do here
    return true;
  };
  return translateFn;
}
var getServerExtractor = cache(getServerExtractorImpl);

export { getServerExtractor as default };
