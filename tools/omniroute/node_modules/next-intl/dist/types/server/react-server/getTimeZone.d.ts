import type { Locale, Timezone } from 'use-intl';
export default function getTimeZone(opts?: {
    locale?: Locale;
}): Promise<Timezone>;
