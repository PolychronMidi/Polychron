import { type ReactNode } from 'react';
import type IntlConfig from '../core/IntlConfig.js';
type Props = IntlConfig & {
    children: ReactNode;
};
export default function IntlProvider({ children, formats, getMessageFallback, locale, messages, now, onError, timeZone }: Props): import("react/jsx-runtime").JSX.Element;
export {};
