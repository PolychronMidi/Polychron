"use client";
import NextLink from 'next/link';
import { usePathname } from 'next/navigation';
import { forwardRef } from 'react';
import { useLocale } from 'use-intl';
import syncLocaleCookie from './syncLocaleCookie.js';
import { jsx } from 'react/jsx-runtime';

function BaseLink({
  href,
  locale,
  localeCookie,
  onClick,
  prefetch,
  ...rest
}, ref) {
  const curLocale = useLocale();
  const isChangingLocale = locale != null && locale !== curLocale;

  // The types aren't entirely correct here. Outside of Next.js
  // `useParams` can be called, but the return type is `null`.
  const pathname = usePathname();
  function onLinkClick(event) {
    // Even though we force a prefix when changing locales,
    // this could be a cache hit of the client-side router,
    // therefore we sync the cookie to ensure it's up to date.
    syncLocaleCookie(localeCookie, pathname, curLocale, locale);
    if (onClick) onClick(event);
  }
  if (isChangingLocale) {
    if (prefetch && "development" !== 'production') {
      console.error('The `prefetch` prop is currently not supported when using the `locale` prop on `Link` to switch the locale.`');
    }
    prefetch = false;
  }

  // Somehow the types for `next/link` don't work as expected
  // when `moduleResolution: "nodenext"` is used.
  const Link = NextLink;
  return /*#__PURE__*/jsx(Link, {
    ref: ref,
    href: href,
    hrefLang: isChangingLocale ? locale : undefined,
    onClick: onLinkClick,
    prefetch: prefetch,
    ...rest
  });
}
var BaseLink$1 = /*#__PURE__*/forwardRef(BaseLink);

export { BaseLink$1 as default };
