import { cache } from 'react';
import getConfig from './getConfig.js';

async function getLocaleCachedImpl() {
  const config = await getConfig();
  return config.locale;
}
const getLocaleCached = cache(getLocaleCachedImpl);

export { getLocaleCached as default };
