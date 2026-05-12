import { memoize, strategies } from '@formatjs/fast-memoize';

class IntlError extends Error {
  constructor(code, originalMessage) {
    let message = code;
    if (originalMessage) {
      message += ': ' + originalMessage;
    }
    super(message);
    this.code = code;
    if (originalMessage) {
      this.originalMessage = originalMessage;
    }
  }
}

var IntlErrorCode = /*#__PURE__*/function (IntlErrorCode) {
  IntlErrorCode["MISSING_MESSAGE"] = "MISSING_MESSAGE";
  IntlErrorCode["MISSING_FORMAT"] = "MISSING_FORMAT";
  IntlErrorCode["ENVIRONMENT_FALLBACK"] = "ENVIRONMENT_FALLBACK";
  IntlErrorCode["INSUFFICIENT_PATH"] = "INSUFFICIENT_PATH";
  IntlErrorCode["INVALID_MESSAGE"] = "INVALID_MESSAGE";
  IntlErrorCode["INVALID_KEY"] = "INVALID_KEY";
  IntlErrorCode["FORMATTING_ERROR"] = "FORMATTING_ERROR";
  return IntlErrorCode;
}(IntlErrorCode || {});

function createCache() {
  return {
    dateTime: {},
    number: {},
    message: {},
    relativeTime: {},
    pluralRules: {},
    list: {},
    displayNames: {}
  };
}
function createMemoCache(store) {
  return {
    create() {
      return {
        get(key) {
          return store[key];
        },
        set(key, value) {
          store[key] = value;
        }
      };
    }
  };
}
function memoFn(fn, cache) {
  return memoize(fn, {
    cache: createMemoCache(cache),
    strategy: strategies.variadic
  });
}
function memoConstructor(ConstructorFn, cache) {
  return memoFn((...args) => new ConstructorFn(...args), cache);
}
function createIntlFormatters(cache) {
  const getDateTimeFormat = memoConstructor(Intl.DateTimeFormat, cache.dateTime);
  const getNumberFormat = memoConstructor(Intl.NumberFormat, cache.number);
  const getPluralRules = memoConstructor(Intl.PluralRules, cache.pluralRules);
  const getRelativeTimeFormat = memoConstructor(Intl.RelativeTimeFormat, cache.relativeTime);
  const getListFormat = memoConstructor(Intl.ListFormat, cache.list);
  const getDisplayNames = memoConstructor(Intl.DisplayNames, cache.displayNames);
  return {
    getDateTimeFormat,
    getNumberFormat,
    getPluralRules,
    getRelativeTimeFormat,
    getListFormat,
    getDisplayNames
  };
}

export { IntlError as I, IntlErrorCode as a, createCache as b, createIntlFormatters as c, memoFn as m };
