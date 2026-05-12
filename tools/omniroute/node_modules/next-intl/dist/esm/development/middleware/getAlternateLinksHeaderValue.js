import { normalizeTrailingSlash } from '../shared/utils.js';
import { getHost, getNormalizedPathname, getLocalePrefixes, isLocaleSupportedOnDomain, applyBasePath, formatTemplatePathname } from './utils.js';

/**
 * See https://developers.google.com/search/docs/specialty/international/localized-versions
 */
function getAlternateLinksHeaderValue({
  internalTemplateName,
  localizedPathnames,
  request,
  resolvedLocale,
  routing
}) {
  const normalizedUrl = request.nextUrl.clone();
  const host = getHost(request.headers);
  if (host) {
    normalizedUrl.port = '';
    normalizedUrl.host = host;
  }
  normalizedUrl.protocol = request.headers.get('x-forwarded-proto') ?? normalizedUrl.protocol;
  normalizedUrl.pathname = getNormalizedPathname(normalizedUrl.pathname, routing.locales, routing.localePrefix);
  function getAlternateEntry(url, locale) {
    url.pathname = normalizeTrailingSlash(url.pathname);
    if (request.nextUrl.basePath) {
      url = new URL(url);
      url.pathname = applyBasePath(url.pathname, request.nextUrl.basePath);
    }
    return `<${url.toString()}>; rel="alternate"; hreflang="${locale}"`;
  }
  function getLocalizedPathname(pathname, locale) {
    if (localizedPathnames && typeof localizedPathnames === 'object') {
      const sourceTemplate = localizedPathnames[resolvedLocale];
      return formatTemplatePathname(pathname, sourceTemplate ?? internalTemplateName, localizedPathnames[locale] ?? internalTemplateName);
    } else {
      return pathname;
    }
  }
  const links = getLocalePrefixes(routing.locales, routing.localePrefix, false).flatMap(([locale, prefix]) => {
    function prefixPathname(pathname) {
      if (pathname === '/') {
        return prefix;
      } else {
        return prefix + pathname;
      }
    }
    let url;
    if (routing.domains) {
      const domainConfigs = routing.domains.filter(cur => isLocaleSupportedOnDomain(locale, cur));
      return domainConfigs.map(domainConfig => {
        url = new URL(normalizedUrl);
        url.port = '';
        url.host = domainConfig.domain;

        // Important: Use `normalizedUrl` here, as `url` potentially uses
        // a `basePath` that automatically gets applied to the pathname
        url.pathname = getLocalizedPathname(normalizedUrl.pathname, locale);

        // Use domain-specific localePrefix mode if available
        const domainMode = domainConfig.localePrefix || routing.localePrefix.mode;
        if (locale !== domainConfig.defaultLocale || domainMode === 'always') {
          url.pathname = prefixPathname(url.pathname);
        }
        return getAlternateEntry(url, locale);
      });
    } else {
      let pathname;
      if (localizedPathnames && typeof localizedPathnames === 'object') {
        pathname = getLocalizedPathname(normalizedUrl.pathname, locale);
      } else {
        pathname = normalizedUrl.pathname;
      }
      if (locale !== routing.defaultLocale || routing.localePrefix.mode === 'always') {
        pathname = prefixPathname(pathname);
      }
      url = new URL(pathname, normalizedUrl);
    }
    return getAlternateEntry(url, locale);
  });

  // Add x-default entry
  const shouldAddXDefault =
  // For domain-based routing there is no reasonable x-default
  !routing.domains || routing.domains.length === 0;
  if (shouldAddXDefault) {
    const localizedPathname = getLocalizedPathname(normalizedUrl.pathname, routing.defaultLocale);
    if (localizedPathname) {
      const url = new URL(localizedPathname, normalizedUrl);
      links.push(getAlternateEntry(url, 'x-default'));
    }
  }
  return links.join(', ');
}

export { getAlternateLinksHeaderValue as default };
