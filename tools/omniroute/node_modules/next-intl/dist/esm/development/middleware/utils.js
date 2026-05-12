import { normalizeTrailingSlash, getSortedPathnames, matchesPathname, prefixPathname, getLocalePrefix, templateToRegex, getLocalizedTemplate } from '../shared/utils.js';

function getInternalTemplate(pathnames, pathname, locale) {
  const sortedPathnames = getSortedPathnames(Object.keys(pathnames));

  // Try to find a localized pathname that matches
  for (const internalPathname of sortedPathnames) {
    const localizedPathnamesOrPathname = pathnames[internalPathname];
    if (typeof localizedPathnamesOrPathname === 'string') {
      const localizedPathname = localizedPathnamesOrPathname;
      if (matchesPathname(localizedPathname, pathname)) {
        return [undefined, internalPathname];
      }
    } else {
      // Prefer the entry with the current locale in case multiple
      // localized pathnames match the current pathname
      const sortedEntries = Object.entries(localizedPathnamesOrPathname);
      const curLocaleIndex = sortedEntries.findIndex(([entryLocale]) => entryLocale === locale);
      if (curLocaleIndex > 0) {
        sortedEntries.unshift(sortedEntries.splice(curLocaleIndex, 1)[0]);
      }
      for (const [entryLocale] of sortedEntries) {
        const localizedTemplate = getLocalizedTemplate(pathnames[internalPathname], entryLocale, internalPathname);
        if (matchesPathname(localizedTemplate, pathname)) {
          return [entryLocale, internalPathname];
        }
      }
    }
  }

  // Try to find an internal pathname that matches (this can be the case
  // if all localized pathnames are different from the internal pathnames)
  for (const internalPathname of Object.keys(pathnames)) {
    if (matchesPathname(internalPathname, pathname)) {
      return [undefined, internalPathname];
    }
  }

  // No match
  return [undefined, undefined];
}
function formatTemplatePathname(sourcePathname, sourceTemplate, targetTemplate, prefix) {
  const params = getRouteParams(sourceTemplate, sourcePathname);
  let targetPathname = '';
  targetPathname += formatPathnameTemplate(targetTemplate, params);

  // A pathname with an optional catchall like `/categories/[[...slug]]`
  // should be normalized to `/categories` if the catchall is not present
  // and no trailing slash is configured
  targetPathname = normalizeTrailingSlash(targetPathname);
  return targetPathname;
}

/**
 * Removes potential prefixes from the pathname.
 */
function getNormalizedPathname(pathname, locales, localePrefix) {
  // Add trailing slash for consistent handling
  // both for the root as well as nested paths
  if (!pathname.endsWith('/')) {
    pathname += '/';
  }
  const localePrefixes = getLocalePrefixes(locales, localePrefix);
  const regex = new RegExp(`^(${localePrefixes.map(([, prefix]) => prefix.replaceAll('/', '\\/')).join('|')})/(.*)`, 'i');
  const match = pathname.match(regex);
  let result = match ? '/' + match[2] : pathname;
  if (result !== '/') {
    result = normalizeTrailingSlash(result);
  }
  return result;
}
function getLocalePrefixes(locales, localePrefix, sort = true) {
  const prefixes = locales.map(locale => [locale, getLocalePrefix(locale, localePrefix)]);
  if (sort) {
    // More specific ones first
    prefixes.sort((a, b) => b[1].length - a[1].length);
  }
  return prefixes;
}
function getPathnameMatch(pathname, locales, localePrefix, domain) {
  const localePrefixes = getLocalePrefixes(locales, localePrefix);

  // Sort to prioritize domain locales
  if (domain) {
    localePrefixes.sort(([localeA], [localeB]) => {
      if (localeA === domain.defaultLocale) return -1;
      if (localeB === domain.defaultLocale) return 1;
      const isLocaleAInDomain = domain.locales.includes(localeA);
      const isLocaleBInDomain = domain.locales.includes(localeB);
      if (isLocaleAInDomain && !isLocaleBInDomain) return -1;
      if (!isLocaleAInDomain && isLocaleBInDomain) return 1;
      return 0;
    });
  }
  for (const [locale, prefix] of localePrefixes) {
    let exact, matches;
    if (pathname === prefix || pathname.startsWith(prefix + '/')) {
      exact = matches = true;
    } else {
      const normalizedPathname = pathname.toLowerCase();
      const normalizedPrefix = prefix.toLowerCase();
      if (normalizedPathname === normalizedPrefix || normalizedPathname.startsWith(normalizedPrefix + '/')) {
        exact = false;
        matches = true;
      }
    }
    if (matches) {
      return {
        locale,
        prefix,
        matchedPrefix: pathname.slice(0, prefix.length),
        exact
      };
    }
  }
}
function getRouteParams(template, pathname) {
  const normalizedPathname = normalizeTrailingSlash(pathname);
  const normalizedTemplate = normalizeTrailingSlash(template);
  const regex = templateToRegex(normalizedTemplate);
  const match = regex.exec(normalizedPathname);
  if (!match) return undefined;
  const params = {};
  const keys = normalizedTemplate.match(/\[([^\]]+)\]/g) ?? [];
  for (let i = 1; i < match.length; i++) {
    const rawKey = keys[i - 1];
    if (!rawKey) continue;
    const key = rawKey.replace(/[[\]]/g, '');
    const value = match[i] ?? '';
    params[key] = value;
  }
  return params;
}
function formatPathnameTemplate(template, params) {
  if (!params) return template;

  // Simplify syntax for optional catchall ('[[...slug]]') so
  // we can replace the value with simple interpolation
  template = template.replace(/\[\[/g, '[').replace(/\]\]/g, ']');
  let result = template;
  Object.entries(params).forEach(([key, value]) => {
    result = result.replace(`[${key}]`, value);
  });
  return result;
}
function formatPathname(pathname, prefix, search) {
  let result = pathname;
  if (prefix) {
    result = prefixPathname(prefix, result);
  }
  if (search) {
    result += search;
  }
  return result;
}
function getHost(requestHeaders) {
  return requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host') ?? undefined;
}
function isLocaleSupportedOnDomain(locale, domain) {
  return domain.defaultLocale === locale || domain.locales.includes(locale);
}
function getBestMatchingDomain(curHostDomain, locale, domainsConfig) {
  let domainConfig;

  // Prio 1: Stay on current domain
  if (curHostDomain && isLocaleSupportedOnDomain(locale, curHostDomain)) {
    domainConfig = curHostDomain;
  }

  // Prio 2: Use alternative domain with matching default locale
  if (!domainConfig) {
    domainConfig = domainsConfig.find(cur => cur.defaultLocale === locale);
  }

  // Prio 3: Use alternative domain that supports the locale
  if (!domainConfig) {
    domainConfig = domainsConfig.find(cur => cur.locales.includes(locale));
  }
  return domainConfig;
}
function applyBasePath(pathname, basePath) {
  return normalizeTrailingSlash(basePath + pathname);
}
function getLocaleAsPrefix(locale) {
  return `/${locale}`;
}
function sanitizePathname(pathname) {
  // Sanitize malicious URIs, e.g.:
  // '/en/\\example.org'  → '/en/%5Cexample.org'     (backslash → %5C)
  // '/en/\t/example.org' → '/en/example.org'        (WHATWG-stripped TAB)
  // '/en/\n/example.org' → '/en/example.org'        (WHATWG-stripped LF)
  // '/en/\r/example.org' → '/en/example.org'        (WHATWG-stripped CR)
  // '/en////example.org' → '/en/example.org'        (consecutive slashes)
  //
  // U+0009/000A/000D are silently stripped by the WHATWG URL parser
  // (https://url.spec.whatwg.org/#concept-url-parser). Without removing
  // them here, a decoded TAB in a segment separator position causes
  // new URL("/\t/host", base) to collapse to "//host" → open redirect.
  return pathname.replace(/\\/g, '%5C').replace(/[\t\n\r]/g, '').replace(/\/+/g, '/');
}

export { applyBasePath, formatPathname, formatPathnameTemplate, formatTemplatePathname, getBestMatchingDomain, getHost, getInternalTemplate, getLocaleAsPrefix, getLocalePrefixes, getNormalizedPathname, getPathnameMatch, getRouteParams, isLocaleSupportedOnDomain, sanitizePathname };
