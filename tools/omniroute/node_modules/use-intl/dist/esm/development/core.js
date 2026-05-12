import { c as createIntlFormatters, b as createCache } from './formatters-r4aAmsMP.js';
export { I as IntlError, a as IntlErrorCode } from './formatters-r4aAmsMP.js';
import { r as resolveNamespace, a as createBaseTranslator, d as defaultGetMessageFallback, b as defaultOnError } from './initializeConfig-CUsOI8u2.js';
export { c as createFormatter, i as initializeConfig } from './initializeConfig-CUsOI8u2.js';




function createTranslatorImpl({
  messages,
  namespace,
  ...rest
}, namespacePrefix) {
  // The `namespacePrefix` is part of the type system.
  // See the comment in the function invocation.
  messages = messages[namespacePrefix];
  namespace = resolveNamespace(namespace, namespacePrefix);
  return createBaseTranslator({
    ...rest,
    messages,
    namespace
  });
}

// This type is slightly more loose than `AbstractIntlMessages`
// in order to avoid a type error.

/**
 * @private Not intended for direct use.
 */

/**
 * Translates messages from the given namespace by using the ICU syntax.
 * See https://formatjs.io/docs/core-concepts/icu-syntax.
 *
 * If no namespace is provided, all available messages are returned.
 * The namespace can also indicate nesting by using a dot
 * (e.g. `namespace.Component`).
 */
function createTranslator({
  _cache = createCache(),
  _formatters = createIntlFormatters(_cache),
  getMessageFallback = defaultGetMessageFallback,
  messages,
  namespace,
  onError = defaultOnError,
  ...rest
}) {
  // We have to wrap the actual function so the type inference for the optional
  // namespace works correctly. See https://stackoverflow.com/a/71529575/343045
  // The prefix ("!") is arbitrary.
  // @ts-expect-error Use the explicit annotation instead
  return createTranslatorImpl({
    ...rest,
    onError,
    cache: _cache,
    formatters: _formatters,
    getMessageFallback,
    // @ts-expect-error `messages` is allowed to be `undefined` here and will be handled internally
    messages: {
      '!': messages
    },
    namespace: namespace ? `!.${namespace}` : '!'
  }, '!');
}

/**
 * Checks if a locale exists in a list of locales.
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/Locale
 */
function hasLocale(locales, candidate) {
  return locales.includes(candidate);
}

export { createCache as _createCache, createIntlFormatters as _createIntlFormatters, createTranslator, hasLocale };
