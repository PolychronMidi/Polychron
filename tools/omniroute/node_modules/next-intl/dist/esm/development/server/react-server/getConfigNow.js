import { cache } from 'react';
import getConfig from './getConfig.js';

async function getConfigNowImpl(locale) {
  const config = await getConfig(locale);
  return config.now;
}
const getConfigNow = cache(getConfigNowImpl);

export { getConfigNow as default };
