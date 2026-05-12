import type { ComponentProps } from 'react';
import BaseNextIntlClientProvider from '../shared/NextIntlClientProvider.js';
type Props = ComponentProps<typeof BaseNextIntlClientProvider>;
export default function NextIntlClientProviderServer({ formats, locale, messages, now, timeZone, ...rest }: Props): Promise<import("react/jsx-runtime").JSX.Element>;
export {};
