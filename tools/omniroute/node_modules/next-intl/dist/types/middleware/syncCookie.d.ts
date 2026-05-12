import type { NextRequest, NextResponse } from 'next/server.js';
import type { Locale } from 'use-intl';
import type { InitializedLocaleCookieConfig, ResolvedRoutingConfig } from '../routing/config.js';
import type { DomainConfig, DomainsConfig, LocalePrefixMode, Locales, Pathnames } from '../routing/types.js';
export default function syncCookie<AppLocales extends Locales, AppLocalePrefixMode extends LocalePrefixMode, AppPathnames extends Pathnames<AppLocales> | undefined, AppDomains extends DomainsConfig<AppLocales> | undefined>(request: NextRequest, response: NextResponse, locale: Locale, routing: Pick<ResolvedRoutingConfig<AppLocales, AppLocalePrefixMode, AppPathnames, AppDomains>, 'locales' | 'defaultLocale'> & {
    localeCookie: InitializedLocaleCookieConfig;
}, domain?: DomainConfig<AppLocales>): void;
