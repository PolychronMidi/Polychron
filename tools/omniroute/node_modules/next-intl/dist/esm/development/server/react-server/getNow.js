import getConfigNow from './getConfigNow.js';
import getDefaultNow from './getDefaultNow.js';

async function getNow(opts) {
  return (await getConfigNow(opts?.locale)) ?? getDefaultNow();
}

export { getNow as default };
