import { cache } from 'react';
import getConfig from './getConfig.js';

async function getFormatsCachedImpl() {
  const config = await getConfig();
  return config.formats;
}
const getFormats = cache(getFormatsCachedImpl);

export { getFormats as default };
