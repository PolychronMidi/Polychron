import { getAcceptLanguageLocale } from './resolveLocale.js';

function syncCookie(request, response, locale, routing, domain) {
  if (!routing.localeCookie) return;
  const {
    name,
    ...rest
  } = routing.localeCookie;
  const hasLocaleCookie = request.cookies.has(name);
  const hasOutdatedCookie = hasLocaleCookie && request.cookies.get(name)?.value !== locale;
  if (hasOutdatedCookie) {
    response.cookies.set(name, locale, {
      path: request.nextUrl.basePath || undefined,
      ...rest
    });
  } else if (!hasLocaleCookie) {
    const acceptLanguageLocale = getAcceptLanguageLocale(request.headers, domain?.locales || routing.locales, routing.defaultLocale);
    if (acceptLanguageLocale !== locale) {
      response.cookies.set(name, locale, {
        path: request.nextUrl.basePath || undefined,
        ...rest
      });
    }
  }
}

export { syncCookie as default };
