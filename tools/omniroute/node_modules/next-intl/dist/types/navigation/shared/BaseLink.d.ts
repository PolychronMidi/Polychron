import { type LinkProps } from 'next/link.js';
import { type ComponentProps } from 'react';
import { type Locale } from 'use-intl';
import type { InitializedLocaleCookieConfig } from '../../routing/config.js';
type NextLinkProps = Omit<ComponentProps<'a'>, keyof LinkProps> & Omit<LinkProps, 'locale'>;
type Props = NextLinkProps & {
    locale?: Locale;
    localeCookie: InitializedLocaleCookieConfig;
};
declare const _default: import("react").ForwardRefExoticComponent<Omit<Props, "ref"> & import("react").RefAttributes<HTMLAnchorElement>>;
export default _default;
