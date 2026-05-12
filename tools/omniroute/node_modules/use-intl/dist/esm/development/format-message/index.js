import { IntlMessageFormat } from 'intl-messageformat';
import { isValidElement } from 'react';
import { I as IntlError, a as IntlErrorCode, m as memoFn } from '../formatters-r4aAmsMP.js';


/**
 * `intl-messageformat` uses separate keys for `date` and `time`, but there's
 * only one native API: `Intl.DateTimeFormat`. Additionally you might want to
 * include both a time and a date in a value, therefore the separation doesn't
 * seem so useful. We offer a single `dateTime` namespace instead, but we have
 * to convert the format before `intl-messageformat` can be used.
 */
function convertFormatsToIntlMessageFormat(globalFormats, inlineFormats, timeZone) {
  const mfDateDefaults = IntlMessageFormat.formats.date;
  const mfTimeDefaults = IntlMessageFormat.formats.time;
  const dateTimeFormats = {
    ...globalFormats?.dateTime,
    ...inlineFormats?.dateTime
  };
  const allFormats = {
    date: {
      ...mfDateDefaults,
      ...dateTimeFormats
    },
    time: {
      ...mfTimeDefaults,
      ...dateTimeFormats
    },
    number: {
      ...globalFormats?.number,
      ...inlineFormats?.number
    }
    // (list is not supported in ICU messages)
  };
  if (timeZone) {
    // The only way to set a time zone with `intl-messageformat` is to merge it into the formats
    // https://github.com/formatjs/formatjs/blob/8256c5271505cf2606e48e3c97ecdd16ede4f1b5/packages/intl/src/message.ts#L15
    ['date', 'time'].forEach(property => {
      const formats = allFormats[property];
      for (const [key, value] of Object.entries(formats)) {
        formats[key] = {
          timeZone,
          ...value
        };
      }
    });
  }
  return allFormats;
}

// Placed here for improved tree shaking. Somehow when this is placed in
// `formatters.tsx`, then it can't be shaken off from `next-intl`.
function createMessageFormatter(cache, intlFormatters) {
  const getMessageFormat = memoFn((...args) => new IntlMessageFormat(args[0], args[1], args[2], {
    formatters: intlFormatters,
    ...args[3]
  }), cache.message);
  return getMessageFormat;
}
function getPlainMessage(candidate, values) {
  // To improve runtime performance, only compile message if:
  return (
    // 1. Values are provided
    values ||
    // 2. There are escaped braces (e.g. "'{name'}")
    /'[{}]/.test(candidate) ||
    // 3. There are missing arguments or tags (dev-only error handling)
    /<|{/.test(candidate) ? undefined // Compile
    : candidate // Don't compile
  );
}

/**
 * Compiles and formats an ICU message at runtime using intl-messageformat.
 * This is the default implementation used when messages are not precompiled.
 */
function formatMessage(/** The raw ICU message string (or precompiled message, though this implementation ignores precompilation) */
...[key, message, values, options]) {
  if (Array.isArray(message)) {
    throw new IntlError(IntlErrorCode.INVALID_MESSAGE, `Message at \`${key}\` resolved to an array, but only strings are supported. See https://next-intl.dev/docs/usage/translations#arrays-of-messages` );
  }
  if (typeof message === 'object') {
    throw new IntlError(IntlErrorCode.INSUFFICIENT_PATH, `Message at \`${key}\` resolved to \`${typeof message}\`, but only strings are supported. Use a \`.\` to retrieve nested messages. See https://next-intl.dev/docs/usage/translations#structuring-messages` );
  }

  // Hot path that avoids creating an `IntlMessageFormat` instance
  if (typeof message === 'string') {
    const plainMessage = getPlainMessage(message, values);
    if (plainMessage) return plainMessage;
  }
  const {
    cache,
    formats,
    formatters,
    globalFormats,
    locale,
    timeZone
  } = options;

  // Lazy init the message formatter for better tree
  // shaking in case message formatting is not used.
  if (!formatters.getMessageFormat) {
    formatters.getMessageFormat = createMessageFormatter(cache, formatters);
  }
  let messageFormat;
  try {
    messageFormat = formatters.getMessageFormat(message, locale, convertFormatsToIntlMessageFormat(globalFormats, formats, timeZone), {
      formatters: {
        ...formatters,
        getDateTimeFormat(locales, dateTimeOptions) {
          // Workaround for https://github.com/formatjs/formatjs/issues/4279
          return formatters.getDateTimeFormat(locales, {
            ...dateTimeOptions,
            timeZone: dateTimeOptions?.timeZone ?? timeZone
          });
        }
      }
    });
  } catch (error) {
    throw new IntlError(IntlErrorCode.INVALID_MESSAGE, `${error.message} (${error.originalMessage})` );
  }
  const formattedMessage = messageFormat.format(
  // @ts-expect-error `intl-messageformat` expects a different format
  // for rich text elements since a recent minor update. This
  // needs to be evaluated in detail, possibly also in regard
  // to be able to format to parts.
  values);

  // Limit the function signature to return strings or React elements
  return /*#__PURE__*/isValidElement(formattedMessage) ||
  // Arrays of React elements
  Array.isArray(formattedMessage) || typeof formattedMessage === 'string' ? formattedMessage : String(formattedMessage);
}

// `t.raw` is supported
formatMessage.raw = true;

export { formatMessage as default };
