import type { ReactElement } from 'react';
import type { FormatNames, Locale } from './AppConfig.js';
import type DateTimeFormatOptions from './DateTimeFormatOptions.js';
import type Formats from './Formats.js';
import IntlError from './IntlError.js';
import type NumberFormatOptions from './NumberFormatOptions.js';
import type RelativeTimeFormatOptions from './RelativeTimeFormatOptions.js';
import type TimeZone from './TimeZone.js';
import { type Formatters, type IntlCache } from './formatters.js';
type Props = {
    locale: Locale;
    timeZone?: TimeZone;
    onError?(error: IntlError): void;
    formats?: Formats;
    now?: Date;
    /** @private */
    _formatters?: Formatters;
    /** @private */
    _cache?: IntlCache;
};
export default function createFormatter(props: Props): {
    dateTime: {
        (value: Date | number, options?: DateTimeFormatOptions): string;
        (value: Date | number, format?: FormatNames["dateTime"], options?: DateTimeFormatOptions): string;
    };
    number: {
        (value: number | bigint, options?: NumberFormatOptions): string;
        (value: number | bigint, format?: FormatNames["number"], options?: NumberFormatOptions): string;
    };
    relativeTime: {
        (date: number | Date, now?: RelativeTimeFormatOptions["now"]): string;
        (date: number | Date, options?: RelativeTimeFormatOptions): string;
    };
    list: {
        <Value extends string | ReactElement<unknown, string | import("react").JSXElementConstructor<any>>>(value: Iterable<Value>, options?: Intl.ListFormatOptions): Value extends string ? string : Iterable<ReactElement>;
        <Value extends string | ReactElement<unknown, string | import("react").JSXElementConstructor<any>>>(value: Iterable<Value>, format?: FormatNames["list"], options?: Intl.ListFormatOptions): Value extends string ? string : Iterable<ReactElement>;
    };
    dateTimeRange: {
        (start: Date | number, end: Date | number, options?: DateTimeFormatOptions): string;
        (start: Date | number, end: Date | number, format?: FormatNames["dateTime"], options?: DateTimeFormatOptions): string;
    };
    displayName: {
        (value: string, options: Intl.DisplayNamesOptions): string;
        (value: string, format: FormatNames["displayName"], options?: Intl.DisplayNamesOptions): string;
    };
};
export {};
