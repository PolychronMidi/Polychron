import type { Locale } from 'use-intl';
export default function getNow(opts?: {
    locale?: Locale;
}): Promise<Date>;
