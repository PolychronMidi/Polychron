import { useRouter, usePathname } from 'next/navigation';
import { useMemo } from 'react';
import { useLocale } from 'use-intl';
import createSharedNavigationFns from '../shared/createSharedNavigationFns.js';
import syncLocaleCookie from '../shared/syncLocaleCookie.js';
import { getRoute } from '../shared/utils.js';
import useBasePathname from './useBasePathname.js';

function createNavigation(routing) {
  const {
    Link,
    config,
    getPathname,
    ...redirects
  } = createSharedNavigationFns(useLocale, routing);

  /** @see https://next-intl.dev/docs/routing/navigation#usepathname */
  function usePathname$1() {
    const pathname = useBasePathname(config);
    const locale = useLocale();

    // @ts-expect-error -- Mirror the behavior from Next.js, where `null` is returned when `usePathname` is used outside of Next, but the types indicate that a string is always returned.
    return useMemo(() => pathname &&
    // @ts-expect-error -- This is fine
    config.pathnames ? getRoute(locale, pathname,
    // @ts-expect-error -- This is fine
    config.pathnames) : pathname, [locale, pathname]);
  }
  function useRouter$1() {
    const router = useRouter();
    const curLocale = useLocale();
    const nextPathname = usePathname();
    return useMemo(() => {
      function createHandler(fn) {
        return function handler(href, options) {
          const {
            locale: nextLocale,
            ...rest
          } = options || {};
          const pathname = getPathname({
            href,
            locale: nextLocale || curLocale,
            // Always include a prefix when changing locales. Theoretically,
            // this is only necessary for the case described in #2020. However,
            // the full detection is rather expensive, and this behavior is
            // consistent with the `Link` component. The downside is an
            // additional redirect for users in other situations. Locale
            // changes should be rare though, so this might be fine.
            forcePrefix: nextLocale != null || undefined
          });
          const args = [pathname];
          if (Object.keys(rest).length > 0) {
            // @ts-expect-error -- This is fine
            args.push(rest);
          }
          syncLocaleCookie(config.localeCookie, nextPathname, curLocale, nextLocale);
          fn(...args);
        };
      }
      return {
        ...router,
        /** @see https://next-intl.dev/docs/routing/navigation#userouter */
        push: createHandler(router.push),
        /** @see https://next-intl.dev/docs/routing/navigation#userouter */
        replace: createHandler(router.replace),
        /** @see https://next-intl.dev/docs/routing/navigation#userouter */
        prefetch: createHandler(router.prefetch)
      };
    }, [curLocale, nextPathname, router]);
  }
  return {
    ...redirects,
    Link,
    usePathname: usePathname$1,
    useRouter: useRouter$1,
    getPathname
  };
}

export { createNavigation as default };
