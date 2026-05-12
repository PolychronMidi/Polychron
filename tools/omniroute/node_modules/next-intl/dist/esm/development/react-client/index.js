import { useFormatter as useFormatter$1, useTranslations as useTranslations$1 } from 'use-intl';

/**
 * This is the main entry file when non-'react-server'
 * environments import from 'next-intl'.
 *
 * Maintainer notes:
 * - Make sure this mirrors the API from 'react-server'.
 * - Make sure everything exported from this module is
 *   supported in all Next.js versions that are supported.
 */


// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
function callHook(name, hook) {
  return (...args) => {
    try {
      return hook(...args);
    } catch {
      throw new Error(`Failed to call \`${name}\` because the context from \`NextIntlClientProvider\` was not found.

This can happen because:
1) You intended to render this component as a Server Component, the render
   failed, and therefore React attempted to render the component on the client
   instead. If this is the case, check the console for server errors.
2) You intended to render this component on the client side, but no context was found.
   Learn more about this error here: https://next-intl.dev/docs/environments/server-client-components#missing-context` );
    }
  };
}
const useTranslations = callHook('useTranslations', useTranslations$1);
const useFormatter = callHook('useFormatter', useFormatter$1);

export { useFormatter, useTranslations };
