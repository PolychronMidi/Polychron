import { cache } from 'react';
import getConfig from './getConfig.js';
import getFormatterCached$1 from './getServerFormatter.js';

async function getFormatterCachedImpl(locale) {
  const config = await getConfig(locale);
  return getFormatterCached$1(config);
}
const getFormatterCached = cache(getFormatterCachedImpl);

/**
 * Returns a formatter based on the given locale.
 *
 * The formatter automatically receives the request config, but
 * you can override it by passing in additional options.
 */
async function getFormatter(opts) {
  return getFormatterCached(opts?.locale);
}

export { getFormatter as default };
