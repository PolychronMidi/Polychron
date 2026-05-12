import { cloneElement, isValidElement } from 'react';
import formatMessage from 'use-intl/format-message';
import { I as IntlError, a as IntlErrorCode, c as createIntlFormatters, b as createCache } from './formatters-r4aAmsMP.js';

function joinPath(...parts) {
  return parts.filter(Boolean).join('.');
}

/**
 * Contains defaults that are used for all entry points into the core.
 * See also `InitializedIntlConfiguration`.
 */

function defaultGetMessageFallback(props) {
  return joinPath(props.namespace, props.key);
}
function defaultOnError(error) {
  console.error(error);
}

function prepareTranslationValues(values) {
  // Related to https://github.com/formatjs/formatjs/issues/1467
  const transformedValues = {};
  Object.keys(values).forEach(key => {
    let index = 0;
    const value = values[key];
    let transformed;
    if (typeof value === 'function') {
      transformed = chunks => {
        const result = value(chunks);
        return /*#__PURE__*/isValidElement(result) ? /*#__PURE__*/cloneElement(result, {
          key: key + index++
        }) : result;
      };
    } else {
      transformed = value;
    }
    transformedValues[key] = transformed;
  });
  return transformedValues;
}
function resolvePath(locale, messages, key, namespace) {
  const fullKey = joinPath(namespace, key);
  if (!messages) {
    throw new Error(`No messages available at \`${namespace}\`.` );
  }
  let message = messages;
  key.split('.').forEach(part => {
    const next = message[part];

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (part == null || next == null) {
      throw new Error(`Could not resolve \`${fullKey}\` in messages for locale \`${locale}\`.` );
    }
    message = next;
  });
  return message;
}
function getMessagesOrError(locale, messages, namespace) {
  try {
    if (!messages) {
      throw new Error(`No messages were configured.` );
    }
    const retrievedMessages = namespace ? resolvePath(locale, messages, namespace) : messages;

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!retrievedMessages) {
      throw new Error(`No messages for namespace \`${namespace}\` found.` );
    }
    return retrievedMessages;
  } catch (error) {
    const intlError = new IntlError(IntlErrorCode.MISSING_MESSAGE, error.message);
    return intlError;
  }
}
function createBaseTranslator(config) {
  const messagesOrError = getMessagesOrError(config.locale, config.messages, config.namespace);
  return createBaseTranslatorImpl({
    ...config,
    messagesOrError
  });
}
function createBaseTranslatorImpl({
  cache,
  formats: globalFormats,
  formatters,
  getMessageFallback = defaultGetMessageFallback,
  locale,
  messagesOrError,
  namespace,
  onError,
  timeZone
}) {
  const hasMessagesError = messagesOrError instanceof IntlError;
  function getFallbackFromErrorAndNotify(key, code, message, fallback) {
    const error = new IntlError(code, message);
    onError(error);
    return fallback ?? getMessageFallback({
      error,
      key,
      namespace
    });
  }
  function translateBaseFn(/** Use a dot to indicate a level of nesting (e.g. `namespace.nestedLabel`). */
  key, /** Key value pairs for values to interpolate into the message. */
  values, /** Provide custom formats for numbers, dates and times. */
  formats, _fallback) {
    const fallback = _fallback;
    let message;
    if (hasMessagesError) {
      if (fallback) {
        message = fallback;
      } else {
        onError(messagesOrError);
        return getMessageFallback({
          error: messagesOrError,
          key,
          namespace
        });
      }
    } else {
      const messages = messagesOrError;
      try {
        message = resolvePath(locale, messages, key, namespace);
      } catch (error) {
        if (fallback) {
          message = fallback;
        } else {
          return getFallbackFromErrorAndNotify(key, IntlErrorCode.MISSING_MESSAGE, error.message, fallback);
        }
      }
    }
    try {
      const messagePath = joinPath(namespace, key);
      return formatMessage(messagePath,
      // @ts-expect-error -- We have additional validation either in `compile-format.tsx` or in case of `format-only.tsx` in the loader
      message, values ? prepareTranslationValues(values) : values, {
        cache,
        formatters,
        globalFormats,
        formats,
        locale,
        timeZone
      });
    } catch (error) {
      let errorCode, errorMessage;
      if (error instanceof IntlError) {
        errorCode = error.code;
        errorMessage = error.originalMessage;
      } else {
        errorCode = IntlErrorCode.FORMATTING_ERROR;
        errorMessage = error.message;
      }
      return getFallbackFromErrorAndNotify(key, errorCode, errorMessage, fallback);
    }
  }
  function translateFn(/** Use a dot to indicate a level of nesting (e.g. `namespace.nestedLabel`). */
  key, /** Key value pairs for values to interpolate into the message. */
  values, /** Custom formats for numbers, dates and times. */
  formats, _fallback) {
    const result = translateBaseFn(key, values, formats, _fallback);
    if (typeof result !== 'string') {
      return getFallbackFromErrorAndNotify(key, IntlErrorCode.INVALID_MESSAGE, `The message \`${key}\` in ${namespace ? `namespace \`${namespace}\`` : 'messages'} didn't resolve to a string. If you want to format rich text, use \`t.rich\` instead.` );
    }
    return result;
  }
  translateFn.rich = translateBaseFn;

  // Augment `translateBaseFn` to return plain strings
  translateFn.markup = (key, values, formats, _fallback) => {
    const result = translateBaseFn(key,
    // @ts-expect-error -- `MarkupTranslationValues` is practically a sub type
    // of `RichTranslationValues` but TypeScript isn't smart enough here.
    values, formats, _fallback);
    if (typeof result !== 'string') {
      const error = new IntlError(IntlErrorCode.FORMATTING_ERROR, "`t.markup` only accepts functions for formatting that receive and return strings.\n\nE.g. t.markup('markup', {b: (chunks) => `<b>${chunks}</b>`})");
      onError(error);
      return getMessageFallback({
        error,
        key,
        namespace
      });
    }
    return result;
  };
  translateFn.raw = key => {
    {
      if (!formatMessage.raw) {
        throw new Error('`t.raw` is not supported when messages are precompiled.');
      }
    }
    if (hasMessagesError) {
      onError(messagesOrError);
      return getMessageFallback({
        error: messagesOrError,
        key,
        namespace
      });
    }
    const messages = messagesOrError;
    try {
      return resolvePath(locale, messages, key, namespace);
    } catch (error) {
      return getFallbackFromErrorAndNotify(key, IntlErrorCode.MISSING_MESSAGE, error.message);
    }
  };
  translateFn.has = key => {
    if (hasMessagesError) {
      return false;
    }
    try {
      resolvePath(locale, messagesOrError, key, namespace);
      return true;
    } catch {
      return false;
    }
  };
  return translateFn;
}

/**
 * For the strictly typed messages to work we have to wrap the namespace into
 * a mandatory prefix. See https://stackoverflow.com/a/71529575/343045
 */
function resolveNamespace(namespace, namespacePrefix) {
  return namespace === namespacePrefix ? undefined : namespace.slice((namespacePrefix + '.').length);
}

const SECOND = 1;
const MINUTE = SECOND * 60;
const HOUR = MINUTE * 60;
const DAY = HOUR * 24;
const WEEK = DAY * 7;
const MONTH = DAY * (365 / 12); // Approximation
const QUARTER = MONTH * 3;
const YEAR = DAY * 365;
const UNIT_SECONDS = {
  second: SECOND,
  seconds: SECOND,
  minute: MINUTE,
  minutes: MINUTE,
  hour: HOUR,
  hours: HOUR,
  day: DAY,
  days: DAY,
  week: WEEK,
  weeks: WEEK,
  month: MONTH,
  months: MONTH,
  quarter: QUARTER,
  quarters: QUARTER,
  year: YEAR,
  years: YEAR
};
function resolveRelativeTimeUnit(seconds) {
  const absValue = Math.abs(seconds);
  if (absValue < MINUTE) {
    return 'second';
  } else if (absValue < HOUR) {
    return 'minute';
  } else if (absValue < DAY) {
    return 'hour';
  } else if (absValue < WEEK) {
    return 'day';
  } else if (absValue < MONTH) {
    return 'week';
  } else if (absValue < YEAR) {
    return 'month';
  }
  return 'year';
}
function calculateRelativeTimeValue(seconds, unit) {
  // We have to round the resulting values, as `Intl.RelativeTimeFormat`
  // will include fractions like '2.1 hours ago'.
  return Math.round(seconds / UNIT_SECONDS[unit]);
}
function createFormatter(props) {
  const {
    _cache: cache = createCache(),
    _formatters: formatters = createIntlFormatters(cache),
    formats,
    locale,
    onError = defaultOnError,
    timeZone: globalTimeZone
  } = props;
  function applyTimeZone(options) {
    if (!options?.timeZone) {
      if (globalTimeZone) {
        options = {
          ...options,
          timeZone: globalTimeZone
        };
      } else {
        onError(new IntlError(IntlErrorCode.ENVIRONMENT_FALLBACK, `The \`timeZone\` parameter wasn't provided and there is no global default configured. Consider adding a global default to avoid markup mismatches caused by environment differences. Learn more: https://next-intl.dev/docs/configuration#time-zone` ));
      }
    }
    return options;
  }
  function resolveFormatOrOptions(typeFormats, formatOrOptions, overrides) {
    let options;
    if (typeof formatOrOptions === 'string') {
      const formatName = formatOrOptions;
      options = typeFormats?.[formatName];
      if (!options) {
        const error = new IntlError(IntlErrorCode.MISSING_FORMAT, `Format \`${formatName}\` is not available.` );
        onError(error);
        throw error;
      }
    } else {
      options = formatOrOptions;
    }
    if (overrides) {
      options = {
        ...options,
        ...overrides
      };
    }
    return options;
  }
  function getFormattedValue(formatOrOptions, overrides, typeFormats, formatter, getFallback) {
    let options;
    try {
      options = resolveFormatOrOptions(typeFormats, formatOrOptions, overrides);
    } catch {
      return getFallback();
    }
    try {
      return formatter(options);
    } catch (error) {
      onError(new IntlError(IntlErrorCode.FORMATTING_ERROR, error.message));
      return getFallback();
    }
  }
  function dateTime(value, formatOrOptions, overrides) {
    return getFormattedValue(formatOrOptions, overrides, formats?.dateTime, options => {
      options = applyTimeZone(options);
      return formatters.getDateTimeFormat(locale, options).format(value);
    }, () => String(value));
  }
  function dateTimeRange(start, end, formatOrOptions, overrides) {
    return getFormattedValue(formatOrOptions, overrides, formats?.dateTime, options => {
      options = applyTimeZone(options);
      return formatters.getDateTimeFormat(locale, options).formatRange(start, end);
    }, () => [dateTime(start), dateTime(end)].join(' – '));
  }
  function number(value, formatOrOptions, overrides) {
    return getFormattedValue(formatOrOptions, overrides, formats?.number, options => formatters.getNumberFormat(locale, options).format(value), () => String(value));
  }
  function getGlobalNow() {
    // Only read when necessary to avoid triggering a `dynamicIO` error
    // unnecessarily (`now` is only needed for `format.relativeTime`)
    if (props.now) {
      return props.now;
    } else {
      onError(new IntlError(IntlErrorCode.ENVIRONMENT_FALLBACK, `The \`now\` parameter wasn't provided to \`relativeTime\` and there is no global default configured, therefore the current time will be used as a fallback. See https://next-intl.dev/docs/usage/dates-times#relative-times-usenow` ));
      return new Date();
    }
  }
  function relativeTime(date, nowOrOptions) {
    try {
      let nowDate, unit;
      const opts = {};
      if (nowOrOptions instanceof Date || typeof nowOrOptions === 'number') {
        nowDate = new Date(nowOrOptions);
      } else if (nowOrOptions) {
        if (nowOrOptions.now != null) {
          nowDate = new Date(nowOrOptions.now);
        } else {
          nowDate = getGlobalNow();
        }
        unit = nowOrOptions.unit;
        opts.style = nowOrOptions.style;
        // @ts-expect-error -- Types are slightly outdated
        opts.numberingSystem = nowOrOptions.numberingSystem;
      }
      if (!nowDate) {
        nowDate = getGlobalNow();
      }
      const dateDate = new Date(date);
      const seconds = (dateDate.getTime() - nowDate.getTime()) / 1000;
      if (!unit) {
        unit = resolveRelativeTimeUnit(seconds);
      }

      // `numeric: 'auto'` can theoretically produce output like "yesterday",
      // but it only works with integers. E.g. -1 day will produce "yesterday",
      // but -1.1 days will produce "-1.1 days". Rounding before formatting is
      // not desired, as the given dates might cross a threshold were the
      // output isn't correct anymore. Example: 2024-01-08T23:00:00.000Z and
      // 2024-01-08T01:00:00.000Z would produce "yesterday", which is not the
      // case. By using `always` we can ensure correct output. The only exception
      // is the formatting of times <1 second as "now".
      opts.numeric = unit === 'second' ? 'auto' : 'always';
      const value = calculateRelativeTimeValue(seconds, unit);
      return formatters.getRelativeTimeFormat(locale, opts).format(value, unit);
    } catch (error) {
      onError(new IntlError(IntlErrorCode.FORMATTING_ERROR, error.message));
      return String(date);
    }
  }
  function list(value, formatOrOptions, overrides) {
    const serializedValue = [];
    const richValues = new Map();

    // `formatToParts` only accepts strings, therefore we have to temporarily
    // replace React elements with a placeholder ID that can be used to retrieve
    // the original value afterwards.
    let index = 0;
    for (const item of value) {
      let serializedItem;
      if (typeof item === 'object') {
        serializedItem = String(index);
        richValues.set(serializedItem, item);
      } else {
        serializedItem = String(item);
      }
      serializedValue.push(serializedItem);
      index++;
    }
    return getFormattedValue(formatOrOptions, overrides, formats?.list,
    // @ts-expect-error -- `richValues.size` is used to determine the return type, but TypeScript can't infer the meaning of this correctly
    options => {
      const result = formatters.getListFormat(locale, options).formatToParts(serializedValue).map(part => part.type === 'literal' ? part.value : richValues.get(part.value) || part.value);
      if (richValues.size > 0) {
        return result;
      } else {
        return result.join('');
      }
    }, () => String(value));
  }
  function displayName(value, formatOrOptions, overrides) {
    return getFormattedValue(formatOrOptions, overrides, formats?.displayName, options =>
    // `options` is guaranteed non-null because our overloads require
    // either inline options or a named format that resolves to options.
    formatters.getDisplayNames(locale, options).of(value), () => value);
  }
  return {
    dateTime,
    number,
    relativeTime,
    list,
    dateTimeRange,
    displayName
  };
}

function validateMessagesSegment(messages, invalidKeyLabels, parentPath) {
  Object.entries(messages).forEach(([key, messageOrMessages]) => {
    if (key.includes('.')) {
      let keyLabel = key;
      if (parentPath) keyLabel += ` (at ${parentPath})`;
      invalidKeyLabels.push(keyLabel);
    }

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (messageOrMessages != null && typeof messageOrMessages === 'object') {
      validateMessagesSegment(messageOrMessages, invalidKeyLabels, joinPath(parentPath, key));
    }
  });
}
function validateMessages(messages, onError) {
  const invalidKeyLabels = [];
  validateMessagesSegment(messages, invalidKeyLabels);
  if (invalidKeyLabels.length > 0) {
    onError(new IntlError(IntlErrorCode.INVALID_KEY, `Namespace keys cannot contain the character "." as this is used to express nesting. Please remove it or replace it with another character.

Invalid ${invalidKeyLabels.length === 1 ? 'key' : 'keys'}: ${invalidKeyLabels.join(', ')}

If you're migrating from a flat structure, you can convert your messages as follows:

import {set} from "lodash";

const input = {
  "one.one": "1.1",
  "one.two": "1.2",
  "two.one.one": "2.1.1"
};

const output = Object.entries(input).reduce(
  (acc, [key, value]) => set(acc, key, value),
  {}
);

// Output:
//
// {
//   "one": {
//     "one": "1.1",
//     "two": "1.2"
//   },
//   "two": {
//     "one": {
//       "one": "2.1.1"
//     }
//   }
// }
` ));
  }
}

/**
 * Enhances the incoming props with defaults.
 */
function initializeConfig({
  formats,
  getMessageFallback,
  messages,
  onError,
  ...rest
}) {
  const finalOnError = onError || defaultOnError;
  const finalGetMessageFallback = getMessageFallback || defaultGetMessageFallback;
  {
    if (messages) {
      validateMessages(messages, finalOnError);
    }
  }
  return {
    ...rest,
    formats: formats || undefined,
    messages: messages || undefined,
    onError: finalOnError,
    getMessageFallback: finalGetMessageFallback
  };
}

export { createBaseTranslator as a, defaultOnError as b, createFormatter as c, defaultGetMessageFallback as d, initializeConfig as i, resolveNamespace as r };
