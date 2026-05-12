import { redirect, permanentRedirect } from 'next/navigation';
import { forwardRef } from 'react';
import { receiveRoutingConfig } from '../../routing/config.js';
import use from '../../shared/use.js';
import { isLocalizableHref, isPromise } from '../../shared/utils.js';
import BaseLink from './BaseLink.js';
import { validateReceivedConfig, serializeSearchParams, compileLocalizedPathname, applyPathnamePrefix, normalizeNameOrNameWithParams } from './utils.js';
import { jsx } from 'react/jsx-runtime';

/**
 * Shared implementations for `react-server` and `react-client`
 */
function createSharedNavigationFns(getLocale, routing) {
  const config = receiveRoutingConfig(routing || {});
  {
    validateReceivedConfig(config);
  }
  const pathnames = config.pathnames;
  function Link({
    href,
    locale,
    ...rest
  }, ref) {
    let pathname, params;
    if (typeof href === 'object') {
      pathname = href.pathname;
      // @ts-expect-error -- This is ok
      params = href.params;
    } else {
      pathname = href;
    }

    // @ts-expect-error -- This is ok
    const isLocalizable = isLocalizableHref(href);
    const localePromiseOrValue = getLocale();
    const curLocale = isPromise(localePromiseOrValue) ? use(localePromiseOrValue) : localePromiseOrValue;
    const finalPathname = isLocalizable ? getPathname({
      locale: locale || curLocale,
      // @ts-expect-error -- This is ok
      href: pathnames == null ? pathname : {
        pathname,
        params
      },
      // Always include a prefix when changing locales
      forcePrefix: locale != null || undefined
    }) : pathname;
    return /*#__PURE__*/jsx(BaseLink, {
      ref: ref
      // @ts-expect-error -- This is ok
      ,
      href: typeof href === 'object' ? {
        ...href,
        pathname: finalPathname
      } : finalPathname,
      locale: locale,
      localeCookie: config.localeCookie,
      ...rest
    });
  }
  const LinkWithRef = /*#__PURE__*/forwardRef(Link);
  function getPathname(args) {
    const {
      forcePrefix,
      href,
      locale
    } = args;
    let pathname;
    if (pathnames == null) {
      if (typeof href === 'object') {
        pathname = href.pathname;
        if (href.query) {
          pathname += serializeSearchParams(href.query);
        }
      } else {
        pathname = href;
      }
    } else {
      pathname = compileLocalizedPathname({
        locale,
        // @ts-expect-error -- This is ok
        ...normalizeNameOrNameWithParams(href),
        // @ts-expect-error -- This is ok
        pathnames: config.pathnames
      });
    }
    return applyPathnamePrefix(pathname, locale, config, forcePrefix);
  }
  function getRedirectFn(fn) {
    /** @see https://next-intl.dev/docs/routing/navigation#redirect */
    return function redirectFn(args, ...rest) {
      return fn(getPathname(args), ...rest);
    };
  }
  const redirect$1 = getRedirectFn(redirect);
  const permanentRedirect$1 = getRedirectFn(permanentRedirect);
  return {
    config,
    Link: LinkWithRef,
    redirect: redirect$1,
    permanentRedirect: permanentRedirect$1,
    getPathname
  };
}

export { createSharedNavigationFns as default };
