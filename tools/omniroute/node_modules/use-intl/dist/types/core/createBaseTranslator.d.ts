import { type ReactNode } from 'react';
import type AbstractIntlMessages from './AbstractIntlMessages.js';
import type Formats from './Formats.js';
import type { InitializedIntlConfig } from './IntlConfig.js';
import IntlError from './IntlError.js';
import type { MessageKeys, NestedKeyOf, NestedValueOf } from './MessageKeys.js';
import type { MarkupTranslationValues, RichTranslationValues, TranslationValues } from './TranslationValues.js';
import type { Formatters, IntlCache } from './formatters.js';
export type CreateBaseTranslatorProps<Messages> = InitializedIntlConfig & {
    cache: IntlCache;
    formatters: Formatters;
    namespace?: string;
    messagesOrError: Messages | IntlError;
};
export default function createBaseTranslator<Messages extends AbstractIntlMessages, NestedKey extends NestedKeyOf<Messages>>(config: Omit<CreateBaseTranslatorProps<Messages>, 'messagesOrError'>): {
    <TargetKey extends MessageKeys<NestedValueOf<Messages, NestedKey>, NestedKeyOf<NestedValueOf<Messages, NestedKey>>>>(key: TargetKey, values?: TranslationValues, formats?: Formats, _fallback?: never): string;
    rich: (key: string, values?: RichTranslationValues, formats?: Formats, _fallback?: never) => ReactNode;
    markup(key: Parameters<(key: string, values?: RichTranslationValues, formats?: Formats, _fallback?: never) => ReactNode>[0], values: MarkupTranslationValues, formats?: Parameters<(key: string, values?: RichTranslationValues, formats?: Formats, _fallback?: never) => ReactNode>[2], _fallback?: never): string;
    raw(key: string): any;
    has(key: string): boolean;
};
