import type { LinkProps } from 'next/link.js';
import type { LocalePrefixConfigVerbose, LocalePrefixMode, Locales, Pathnames } from '../routing/types.js';
type Href = LinkProps['href'];
export declare function isLocalizableHref(href: Href): boolean;
export declare function unprefixPathname(pathname: string, prefix: string): string;
export declare function prefixPathname(prefix: string, pathname: string): string;
export declare function hasPathnamePrefixed(prefix: string | undefined, pathname: string): boolean;
export declare function getLocalizedTemplate<AppLocales extends Locales>(pathnameConfig: Pathnames<AppLocales>[keyof Pathnames<AppLocales>], locale: AppLocales[number], internalTemplate: string): string;
export declare function normalizeTrailingSlash(pathname: string): string;
export declare function matchesPathname(
/** E.g. `/users/[userId]-[userName]` */
template: string, 
/** E.g. `/users/23-jane` */
pathname: string): boolean;
export declare function getLocalePrefix<AppLocales extends Locales, AppLocalePrefixMode extends LocalePrefixMode>(locale: AppLocales[number], localePrefix: LocalePrefixConfigVerbose<AppLocales, AppLocalePrefixMode>): string;
export declare function getLocaleAsPrefix(locale: string): string;
export declare function templateToRegex(template: string): RegExp;
export declare function getSortedPathnames(pathnames: Array<string>): string[];
export declare function isPromise<Value>(value: Value | Promise<Value>): value is Promise<Value>;
export {};
