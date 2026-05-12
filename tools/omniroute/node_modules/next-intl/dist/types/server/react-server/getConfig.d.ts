import { type IntlConfig, type Locale, _createIntlFormatters } from 'use-intl/core';
declare function getConfigImpl(localeOverride?: Locale): Promise<{
    locale: IntlConfig['locale'];
    formats?: NonNullable<IntlConfig['formats']>;
    timeZone: NonNullable<IntlConfig['timeZone']>;
    onError: NonNullable<IntlConfig['onError']>;
    getMessageFallback: NonNullable<IntlConfig['getMessageFallback']>;
    messages?: NonNullable<IntlConfig['messages']>;
    now?: NonNullable<IntlConfig['now']>;
    _formatters: ReturnType<typeof _createIntlFormatters>;
}>;
declare const getConfig: typeof getConfigImpl;
export default getConfig;
