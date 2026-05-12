import type { NextRequest } from 'next/server.js';
import type { ResolvedRoutingConfig } from '../routing/config.js';
import type { DomainsConfig, LocalePrefixMode, Locales, Pathnames } from '../routing/types.js';
/**
 * See https://developers.google.com/search/docs/specialty/international/localized-versions
 */
export default function getAlternateLinksHeaderValue<AppLocales extends Locales, AppLocalePrefixMode extends LocalePrefixMode, AppPathnames extends Pathnames<AppLocales> | undefined, AppDomains extends DomainsConfig<AppLocales> | undefined>({ internalTemplateName, localizedPathnames, request, resolvedLocale, routing }: {
    routing: Omit<ResolvedRoutingConfig<AppLocales, AppLocalePrefixMode, AppPathnames, AppDomains>, 'pathnames'>;
    request: NextRequest;
    resolvedLocale: AppLocales[number];
    localizedPathnames?: Pathnames<AppLocales>[string];
    internalTemplateName?: string;
}): string;
