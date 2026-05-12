import type { Locale } from 'use-intl';
declare function getLocaleCachedImpl(): Promise<Locale>;
declare const getLocaleCached: typeof getLocaleCachedImpl;
export default getLocaleCached;
