/**
 * This is the main entry file when non-'react-server'
 * environments import from 'next-intl'.
 *
 * Maintainer notes:
 * - Make sure this mirrors the API from 'react-server'.
 * - Make sure everything exported from this module is
 *   supported in all Next.js versions that are supported.
 */
import { useFormatter as base_useFormatter, useTranslations as base_useTranslations } from 'use-intl';
export * from 'use-intl/core';
export { IntlProvider, useLocale, useNow, useTimeZone, useMessages } from 'use-intl/react';
export { _useExtracted as useExtracted } from 'use-intl/react';
export declare const useTranslations: typeof base_useTranslations;
export declare const useFormatter: typeof base_useFormatter;
export { default as NextIntlClientProvider } from '../shared/NextIntlClientProvider.js';
