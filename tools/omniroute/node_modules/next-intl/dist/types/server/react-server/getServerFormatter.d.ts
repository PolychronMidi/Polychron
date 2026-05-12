import { createFormatter } from 'use-intl/core';
declare function getFormatterCachedImpl(config: Parameters<typeof createFormatter>[0]): {
    dateTime: {
        (value: Date | number, options?: import("use-intl/core").DateTimeFormatOptions): string;
        (value: Date | number, format?: string, options?: import("use-intl/core").DateTimeFormatOptions): string;
    };
    number: {
        (value: number | bigint, options?: import("use-intl/core").NumberFormatOptions): string;
        (value: number | bigint, format?: string, options?: import("use-intl/core").NumberFormatOptions): string;
    };
    relativeTime: {
        (date: number | Date, now?: import("use-intl/core").RelativeTimeFormatOptions["now"]): string;
        (date: number | Date, options?: import("use-intl/core").RelativeTimeFormatOptions): string;
    };
    list: {
        <Value extends string | import("react").ReactElement<unknown, string | import("react").JSXElementConstructor<any>>>(value: Iterable<Value>, options?: Intl.ListFormatOptions): Value extends string ? string : Iterable<import("react").ReactElement>;
        <Value extends string | import("react").ReactElement<unknown, string | import("react").JSXElementConstructor<any>>>(value: Iterable<Value>, format?: string, options?: Intl.ListFormatOptions): Value extends string ? string : Iterable<import("react").ReactElement>;
    };
    dateTimeRange: {
        (start: Date | number, end: Date | number, options?: import("use-intl/core").DateTimeFormatOptions): string;
        (start: Date | number, end: Date | number, format?: string, options?: import("use-intl/core").DateTimeFormatOptions): string;
    };
    displayName: {
        (value: string, options: Intl.DisplayNamesOptions): string;
        (value: string, format: string, options?: Intl.DisplayNamesOptions): string;
    };
};
declare const getFormatterCached: typeof getFormatterCachedImpl;
export default getFormatterCached;
