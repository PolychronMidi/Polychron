import { match } from '@formatjs/intl-localematcher';
import Negotiator from 'negotiator';
import { getPathnameMatch, isLocaleSupportedOnDomain, getHost } from './utils.js';

function findDomainFromHost(requestHeaders, domains) {
  const host = getHost(requestHeaders);
  if (host) {
    return domains.find(cur => cur.domain === host);
  }
  return undefined;
}
function orderLocales(locales) {
  // Workaround for https://github.com/formatjs/formatjs/issues/4469
  return locales.slice().sort((a, b) => b.length - a.length);
}
function mapToProvidedLocale(locales, locale) {
  return locales.find(cur => cur.toLowerCase() === locale.toLowerCase());
}
function getAcceptLanguageLocale(requestHeaders, locales, defaultLocale) {
  let locale;
  const languages = new Negotiator({
    headers: {
      'accept-language': requestHeaders.get('accept-language') || undefined
    }
  }).languages();
  try {
    const orderedLocales = orderLocales(locales);
    locale = mapToProvidedLocale(locales, match(languages, orderedLocales, defaultLocale));
  } catch {
    // Invalid language
  }
  return locale;
}
function getLocaleFromCookie(routing, requestCookies) {
  if (routing.localeCookie && requestCookies.has(routing.localeCookie.name)) {
    const value = requestCookies.get(routing.localeCookie.name)?.value;
    if (value && routing.locales.includes(value)) {
      return value;
    }
  }
}
function resolveLocaleFromPrefix(routing, requestHeaders, requestCookies, pathname) {
  let locale;

  // Prio 1: Use route prefix
  if (pathname) {
    locale = getPathnameMatch(pathname, routing.locales, routing.localePrefix)?.locale;
  }

  // Prio 2: Use existing cookie
  if (!locale && routing.localeDetection) {
    locale = getLocaleFromCookie(routing, requestCookies);
  }

  // Prio 3: Use the `accept-language` header
  if (!locale && routing.localeDetection) {
    locale = getAcceptLanguageLocale(requestHeaders, routing.locales, routing.defaultLocale);
  }

  // Prio 4: Use default locale
  if (!locale) {
    locale = routing.defaultLocale;
  }
  return locale;
}
function resolveLocaleFromDomain(routing, requestHeaders, requestCookies, pathname) {
  const domains = routing.domains;
  const domain = findDomainFromHost(requestHeaders, domains);
  if (!domain) {
    return {
      locale: resolveLocaleFromPrefix(routing, requestHeaders, requestCookies, pathname)
    };
  }
  let locale;

  // Prio 1: Use route prefix
  if (pathname) {
    const prefixLocale = getPathnameMatch(pathname, routing.locales, routing.localePrefix, domain)?.locale;
    if (prefixLocale) {
      if (isLocaleSupportedOnDomain(prefixLocale, domain)) {
        locale = prefixLocale;
      } else {
        // Causes a redirect to a domain that supports the locale
        return {
          locale: prefixLocale,
          domain
        };
      }
    }
  }

  // Prio 2: Use existing cookie
  if (!locale && routing.localeDetection) {
    const cookieLocale = getLocaleFromCookie(routing, requestCookies);
    if (cookieLocale) {
      if (isLocaleSupportedOnDomain(cookieLocale, domain)) {
        locale = cookieLocale;
      }
    }
  }

  // Prio 3: Use the `accept-language` header
  if (!locale && routing.localeDetection) {
    const headerLocale = getAcceptLanguageLocale(requestHeaders, domain.locales, domain.defaultLocale);
    if (headerLocale) {
      locale = headerLocale;
    }
  }

  // Prio 4: Use default locale
  if (!locale) {
    locale = domain.defaultLocale;
  }
  return {
    locale,
    domain
  };
}
function resolveLocale(routing, requestHeaders, requestCookies, pathname) {
  if (routing.domains) {
    return resolveLocaleFromDomain(routing, requestHeaders, requestCookies, pathname);
  } else {
    return {
      locale: resolveLocaleFromPrefix(routing, requestHeaders, requestCookies, pathname)
    };
  }
}

export { resolveLocale as default, getAcceptLanguageLocale };
