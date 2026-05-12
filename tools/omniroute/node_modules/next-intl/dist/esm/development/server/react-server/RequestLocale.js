import { headers } from 'next/headers';
import { cache } from 'react';
import { HEADER_LOCALE_NAME } from '../../shared/constants.js';
import { isPromise } from '../../shared/utils.js';
import { getCachedRequestLocale } from './RequestLocaleCache.js';

async function getHeadersImpl() {
  const promiseOrValue = headers();

  // Compatibility with Next.js <15
  return isPromise(promiseOrValue) ? await promiseOrValue : promiseOrValue;
}
const getHeaders = cache(getHeadersImpl);
async function getLocaleFromHeaderImpl() {
  let locale;
  try {
    locale = (await getHeaders()).get(HEADER_LOCALE_NAME) || undefined;
  } catch (error) {
    if (error instanceof Error && error.digest === 'DYNAMIC_SERVER_USAGE') {
      const wrappedError = new Error('Usage of next-intl APIs in Server Components currently opts into dynamic rendering. This limitation will eventually be lifted, but as a stopgap solution, you can use the `setRequestLocale` API to enable static rendering, see https://next-intl.dev/docs/routing/setup#static-rendering', {
        cause: error
      });
      wrappedError.digest = error.digest;
      throw wrappedError;
    } else {
      throw error;
    }
  }
  return locale;
}
const getLocaleFromHeader = cache(getLocaleFromHeaderImpl);
async function getRequestLocale() {
  return getCachedRequestLocale() || (await getLocaleFromHeader());
}

export { getRequestLocale };
