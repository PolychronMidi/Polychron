import type { RequestCookies } from 'next/dist/server/web/spec-extension/cookies.js';
import type { Locale } from 'use-intl';
import type { ResolvedRoutingConfig } from '../routing/config.js';
import type { DomainConfig, DomainsConfig, LocalePrefixMode, Locales, Pathnames } from '../routing/types.js';
export declare function getAcceptLanguageLocale<AppLocales extends Locales>(requestHeaders: Headers, locales: AppLocales, defaultLocale: Locale): string | undefined;
export default function resolveLocale<AppLocales extends Locales, AppLocalePrefixMode extends LocalePrefixMode, AppPathnames extends Pathnames<AppLocales> | undefined, AppDomains extends DomainsConfig<AppLocales> | undefined>(routing: Omit<ResolvedRoutingConfig<AppLocales, AppLocalePrefixMode, AppPathnames, AppDomains>, 'pathnames'>, requestHeaders: Headers, requestCookies: RequestCookies, pathname: string): {
    locale: AppLocales[number];
    domain?: DomainConfig<AppLocales>;
};
