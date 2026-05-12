import type AbstractIntlMessages from './AbstractIntlMessages.js';
import type { InitializedIntlConfig } from './IntlConfig.js';
import type { NestedKeyOf } from './MessageKeys.js';
import type { Formatters, IntlCache } from './formatters.js';
export type CreateTranslatorImplProps<Messages> = Omit<InitializedIntlConfig, 'messages'> & {
    namespace: string;
    messages: Messages;
    formatters: Formatters;
    cache: IntlCache;
};
export default function createTranslatorImpl<Messages extends AbstractIntlMessages, NestedKey extends NestedKeyOf<Messages>>({ messages, namespace, ...rest }: CreateTranslatorImplProps<Messages>, namespacePrefix: string): {
    <TargetKey extends import("./MessageKeys.js").MessageKeys<import("./MessageKeys.js").NestedValueOf<Messages, NestedKey>, NestedKeyOf<import("./MessageKeys.js").NestedValueOf<Messages, NestedKey>>>>(key: TargetKey, values?: import("./TranslationValues.js").TranslationValues, formats?: import("./Formats.js").default, _fallback?: never): string;
    rich: (key: string, values?: import("./TranslationValues.js").RichTranslationValues, formats?: import("./Formats.js").default, _fallback?: never) => import("react").ReactNode;
    markup(key: Parameters<(key: string, values?: import("./TranslationValues.js").RichTranslationValues, formats?: import("./Formats.js").default, _fallback?: never) => import("react").ReactNode>[0], values: import("./TranslationValues.js").MarkupTranslationValues, formats?: Parameters<(key: string, values?: import("./TranslationValues.js").RichTranslationValues, formats?: import("./Formats.js").default, _fallback?: never) => import("react").ReactNode>[2], _fallback?: never): string;
    raw(key: string): any;
    has(key: string): boolean;
};
