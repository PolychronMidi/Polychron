import type { Locale } from 'use-intl';
declare function getConfigNowImpl(locale?: Locale): Promise<Date | undefined>;
declare const getConfigNow: typeof getConfigNowImpl;
export default getConfigNow;
