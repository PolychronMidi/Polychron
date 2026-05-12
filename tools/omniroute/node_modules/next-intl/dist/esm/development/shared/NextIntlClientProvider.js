"use client";
import { IntlProvider } from 'use-intl/react';
import { jsx } from 'react/jsx-runtime';

function NextIntlClientProvider({
  locale,
  ...rest
}) {
  if (!locale) {
    throw new Error("Couldn't infer the `locale` prop in `NextIntlClientProvider`, please provide it explicitly.\n\nSee https://next-intl.dev/docs/configuration#locale" );
  }
  return /*#__PURE__*/jsx(IntlProvider, {
    locale: locale,
    ...rest
  });
}

export { NextIntlClientProvider as default };
