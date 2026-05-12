import type AbstractIntlMessages from '../core/AbstractIntlMessages.js';
import type { NestedKeyOf } from '../core/MessageKeys.js';
export default function useTranslationsImpl<Messages extends AbstractIntlMessages, NestedKey extends NestedKeyOf<Messages>>(allMessagesPrefixed: Messages, namespacePrefixed: NestedKey, namespacePrefix: string): {
    <TargetKey extends unknown>(key: TargetKey, values?: import("../core.js").TranslationValues, formats?: import("../core.js").Formats, _fallback?: never): string;
    rich: (key: string, values?: import("../core.js").RichTranslationValues, formats?: import("../core.js").Formats, _fallback?: never) => import("react").ReactNode;
    markup(key: Parameters<(key: string, values?: import("../core.js").RichTranslationValues, formats?: import("../core.js").Formats, _fallback?: never) => import("react").ReactNode>[0], values: import("../core.js").MarkupTranslationValues, formats?: Parameters<(key: string, values?: import("../core.js").RichTranslationValues, formats?: import("../core.js").Formats, _fallback?: never) => import("react").ReactNode>[2], _fallback?: never): string;
    raw(key: string): any;
    has(key: string): boolean;
};
