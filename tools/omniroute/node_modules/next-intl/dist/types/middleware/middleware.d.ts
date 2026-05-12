import { type NextRequest, NextResponse } from 'next/server.js';
import { type RoutingConfig } from '../routing/config.js';
import type { DomainsConfig, LocalePrefixMode, Locales, Pathnames } from '../routing/types.js';
export default function createMiddleware<const AppLocales extends Locales, const AppLocalePrefixMode extends LocalePrefixMode = 'always', const AppPathnames extends Pathnames<AppLocales> = never, const AppDomains extends DomainsConfig<AppLocales> = never>(routing: RoutingConfig<AppLocales, AppLocalePrefixMode, AppPathnames, AppDomains>): (request: NextRequest) => NextResponse<unknown>;
