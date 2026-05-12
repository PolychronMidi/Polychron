import type { Locale, useMessages as useMessagesType } from 'use-intl';
import getConfig from './getConfig.js';
export declare function getMessagesFromConfig(config: Awaited<ReturnType<typeof getConfig>>): ReturnType<typeof useMessagesType>;
export default function getMessages(opts?: {
    locale?: Locale;
}): Promise<ReturnType<typeof useMessagesType>>;
