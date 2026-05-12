import { cache } from 'react';

// See https://github.com/vercel/next.js/discussions/58862
function getCacheImpl() {
  const value = {
    locale: undefined
  };
  return value;
}
const getCache = cache(getCacheImpl);
function getCachedRequestLocale() {
  return getCache().locale;
}
function setCachedRequestLocale(locale) {
  getCache().locale = locale;
}

export { getCachedRequestLocale, setCachedRequestLocale };
