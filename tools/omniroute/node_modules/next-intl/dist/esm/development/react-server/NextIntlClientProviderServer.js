import getConfigNow from '../server/react-server/getConfigNow.js';
import getFormats from '../server/react-server/getFormats.js';
import NextIntlClientProvider from '../shared/NextIntlClientProvider.js';
import { jsx } from 'react/jsx-runtime';
import getTimeZone from '../server/react-server/getTimeZone.js';
import getMessages from '../server/react-server/getMessages.js';
import getLocaleCached from '../server/react-server/getLocale.js';

async function NextIntlClientProviderServer({
  formats,
  locale,
  messages,
  now,
  timeZone,
  ...rest
}) {
  return /*#__PURE__*/jsx(NextIntlClientProvider
  // We need to be careful about potentially reading from headers here.
  // See https://github.com/amannn/next-intl/issues/631
  , {
    formats: formats === undefined ? await getFormats() : formats,
    locale: locale ?? (await getLocaleCached()),
    messages: messages === undefined ? await getMessages() : messages
    // Note that we don't assign a default for `now` here,
    // we only read one from the request config - if any.
    // Otherwise this would cause a `dynamicIO` error.
    ,
    now: now ?? (await getConfigNow()),
    timeZone: timeZone ?? (await getTimeZone()),
    ...rest
  });
}

export { NextIntlClientProviderServer as default };
