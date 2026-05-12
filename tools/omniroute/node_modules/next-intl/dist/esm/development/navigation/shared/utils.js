import { getSortedPathnames, matchesPathname, isLocalizableHref, prefixPathname, getLocalizedTemplate, normalizeTrailingSlash, getLocalePrefix } from '../../shared/utils.js';

// Minor false positive: A route that has both optional and
// required params will allow optional params.

// For `Link`

// For `getPathname` (hence also its consumers: `redirect`, `useRouter`, …)

function normalizeNameOrNameWithParams(href) {
  return typeof href === 'string' ? {
    pathname: href
  } : href;
}
function serializeSearchParams(searchParams) {
  function serializeValue(value) {
    return String(value);
  }
  const urlSearchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (Array.isArray(value)) {
      value.forEach(cur => {
        urlSearchParams.append(key, serializeValue(cur));
      });
    } else {
      urlSearchParams.set(key, serializeValue(value));
    }
  }
  return '?' + urlSearchParams.toString();
}
function compileLocalizedPathname({
  pathname,
  locale,
  params,
  pathnames,
  query
}) {
  function compilePath(value) {
    const pathnameConfig = pathnames[value];
    let compiled;
    if (pathnameConfig) {
      const template = getLocalizedTemplate(pathnameConfig, locale, value);
      compiled = template;
      if (params) {
        Object.entries(params).forEach(([key, paramValue]) => {
          let regexp, replacer;
          if (Array.isArray(paramValue)) {
            regexp = `(\\[)?\\[...${key}\\](\\])?`;
            replacer = paramValue.map(v => String(v)).join('/');
          } else {
            regexp = `\\[${key}\\]`;
            replacer = String(paramValue);
          }
          compiled = compiled.replace(new RegExp(regexp, 'g'), replacer);
        });
      }

      // Clean up optional catch-all segments that were not replaced
      compiled = compiled.replace(/\[\[\.\.\..+\]\]/g, '');
      if (compiled.includes('[')) {
        // Next.js throws anyway, therefore better provide a more helpful error message
        throw new Error(`Insufficient params provided for localized pathname.\nTemplate: ${template}\nParams: ${JSON.stringify(params)}`);
      }
      compiled = encodePathname(compiled);
    } else {
      // Unknown pathnames
      compiled = value;
    }
    compiled = normalizeTrailingSlash(compiled);
    if (query) {
      // This also encodes non-ASCII characters by
      // using `new URLSearchParams()` internally
      compiled += serializeSearchParams(query);
    }
    return compiled;
  }
  if (typeof pathname === 'string') {
    return compilePath(pathname);
  } else {
    const {
      pathname: internalPathname,
      ...rest
    } = pathname;
    const compiled = compilePath(internalPathname);
    const result = {
      ...rest,
      pathname: compiled
    };
    return result;
  }
}
function encodePathname(pathname) {
  // Generally, to comply with RFC 3986 and Google's best practices for URL structures
  // (https://developers.google.com/search/docs/crawling-indexing/url-structure),
  // we should always encode non-ASCII characters.
  //
  // There are two places where next-intl interacts with potentially non-ASCII URLs:
  // 1. Middleware: When mapping a localized pathname to a non-localized pathname internally
  // 2. Navigation APIs: When generating a URLs to be used for <Link /> & friends
  //
  // Next.js normalizes incoming pathnames to always be encoded, therefore we can safely
  // decode them there (see middleware.tsx). On the other hand, Next.js doesn't consistently
  // encode non-ASCII characters that are passed to navigation APIs:
  // 1. <Link /> doesn't encode non-ASCII characters
  // 2. useRouter() uses `new URL()` internally, which will encode—but only if necessary
  // 3. redirect() uses useRouter() on the client, but on the server side only
  //    assigns the location header without encoding.
  //
  // In addition to this, for getPathname() we need to encode non-ASCII characters.
  //
  // Therefore, the bottom line is that next-intl should take care of encoding non-ASCII
  // characters in all cases, but can rely on `new URL()` to not double-encode characters.
  return new URL(pathname, 'http://l').pathname;
}
function getRoute(locale, pathname, pathnames) {
  const sortedPathnames = getSortedPathnames(Object.keys(pathnames));
  const decoded = decodeURI(pathname);
  for (const internalPathname of sortedPathnames) {
    const localizedPathnamesOrPathname = pathnames[internalPathname];
    if (typeof localizedPathnamesOrPathname === 'string') {
      const localizedPathname = localizedPathnamesOrPathname;
      if (matchesPathname(localizedPathname, decoded)) {
        return internalPathname;
      }
    } else {
      if (matchesPathname(getLocalizedTemplate(localizedPathnamesOrPathname, locale, internalPathname), decoded)) {
        return internalPathname;
      }
    }
  }
  return pathname;
}
function getBasePath(pathname, windowPathname = window.location.pathname) {
  if (pathname === '/') {
    return windowPathname;
  } else {
    return windowPathname.replace(pathname, '');
  }
}
function applyPathnamePrefix(pathname, locale, routing, force) {
  const {
    mode: routingMode
  } = routing.localePrefix;
  let shouldPrefix;
  if (force !== undefined) {
    shouldPrefix = force;
  } else if (isLocalizableHref(pathname)) {
    // Since locales are unique per domain, there should be
    // only one domain that contains the locale
    const domain = routing.domains?.find(cur => cur.locales.includes(locale));

    // Domains can override the mode
    const mode = domain?.localePrefix || routingMode;
    if (mode === 'always') {
      shouldPrefix = true;
    } else if (mode === 'as-needed') {
      shouldPrefix = domain ? locale !== domain.defaultLocale : locale !== routing.defaultLocale;
    }
  }
  return shouldPrefix ? prefixPathname(getLocalePrefix(locale, routing.localePrefix), pathname) : pathname;
}
function validateReceivedConfig(config) {
  if (config.localePrefix?.mode === 'as-needed' && !('defaultLocale' in config)) {
    throw new Error("`localePrefix: 'as-needed' requires a `defaultLocale`.");
  }
}

export { applyPathnamePrefix, compileLocalizedPathname, getBasePath, getRoute, normalizeNameOrNameWithParams, serializeSearchParams, validateReceivedConfig };
