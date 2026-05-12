import { type CompiledMessage } from './types.js';
export type { CompiledMessage } from './types.js';
export type FormatValues<RichTextElement = unknown> = Record<string, string | number | boolean | Date | ((chunks: Array<string | RichTextElement>) => RichTextElement)>;
export type Formats = {
    dateTime?: Record<string, Intl.DateTimeFormatOptions>;
    number?: Record<string, Intl.NumberFormatOptions>;
};
export type FormatOptions = {
    formats?: Formats;
    formatters: {
        getDateTimeFormat(...args: ConstructorParameters<typeof Intl.DateTimeFormat>): Intl.DateTimeFormat;
        getNumberFormat(...args: ConstructorParameters<typeof Intl.NumberFormat>): Intl.NumberFormat;
        getPluralRules(...args: ConstructorParameters<typeof Intl.PluralRules>): Intl.PluralRules;
    };
    timeZone?: string;
};
export default function format<RichTextElement = string>(message: CompiledMessage, locale: string, values: FormatValues<RichTextElement> | undefined, options: FormatOptions): string | RichTextElement | Array<string | RichTextElement>;
