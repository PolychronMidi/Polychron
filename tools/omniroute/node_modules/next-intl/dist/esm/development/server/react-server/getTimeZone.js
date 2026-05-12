import { cache } from 'react';
import getConfig from './getConfig.js';

async function getTimeZoneCachedImpl(locale) {
  const config = await getConfig(locale);
  return config.timeZone;
}
const getTimeZoneCached = cache(getTimeZoneCachedImpl);
async function getTimeZone(opts) {
  return getTimeZoneCached(opts?.locale);
}

export { getTimeZone as default };
