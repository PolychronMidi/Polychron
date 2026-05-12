/**
 * Allows to import `next-intl/server` in non-RSC environments.
 *
 * This is mostly relevant for testing, since e.g. a `generateMetadata`
 * export from a page might use `next-intl/server`, but the test
 * only uses the default export for a page.
 */

function notSupported(message) {
  return () => {
    throw new Error(`\`${message}\` is not supported in Client Components.`);
  };
}
function getRequestConfig(
// eslint-disable-next-line @typescript-eslint/no-unused-vars
...args) {
  return notSupported('getRequestConfig');
}
const getFormatter = notSupported('getFormatter');
const getNow = notSupported('getNow');
const getTimeZone = notSupported('getTimeZone');
const getMessages = notSupported('getMessages');
const getLocale = notSupported('getLocale');
const getExtracted = notSupported('getExtracted');

// The type of `getTranslations` is not assigned here because it
// causes a type error. The types use the `react-server` entry
// anyway, therefore this is irrelevant.
const getTranslations = notSupported('getTranslations');
const setRequestLocale = notSupported('setRequestLocale');

export { getExtracted, getFormatter, getLocale, getMessages, getNow, getRequestConfig, getTimeZone, getTranslations, setRequestLocale };
