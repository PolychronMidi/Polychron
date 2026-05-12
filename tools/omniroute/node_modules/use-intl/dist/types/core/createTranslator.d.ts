import type { ReactNode } from 'react';
import type Formats from './Formats.js';
import type ICUArgs from './ICUArgs.js';
import type ICUTags from './ICUTags.js';
import type IntlConfig from './IntlConfig.js';
import type { MessageKeys, NamespaceKeys, NestedKeyOf, NestedValueOf } from './MessageKeys.js';
import type { MarkupTagsFunction, RichTagsFunction, TranslationValues } from './TranslationValues.js';
import { type Formatters, type IntlCache } from './formatters.js';
import type { Prettify } from './types.js';
type ICUArgsWithTags<MessageString extends string, TagsFn extends RichTagsFunction | MarkupTagsFunction = never> = ICUArgs<MessageString, {
    ICUArgument: string;
    ICUNumberArgument: number | bigint;
    ICUDateArgument: Date;
}> & ([TagsFn] extends [never] ? {} : ICUTags<MessageString, TagsFn>);
type OnlyOptional<T> = Partial<T> extends T ? true : false;
export type TranslateArgs<Value extends string, TagsFn extends RichTagsFunction | MarkupTagsFunction = never> = string extends Value ? [
    values?: Record<string, TranslationValues[string] | TagsFn>,
    formats?: Formats
] : (Value extends any ? (key: ICUArgsWithTags<Value, TagsFn>) => void : never) extends (key: infer Args) => void ? OnlyOptional<Args> extends true ? [values?: undefined, formats?: Formats] : [values: Prettify<Args>, formats?: Formats] : never;
type IntlMessages = Record<string, any>;
type NamespacedMessageKeys<TranslatorMessages extends IntlMessages, Namespace extends NamespaceKeys<TranslatorMessages, NestedKeyOf<TranslatorMessages>> = never> = MessageKeys<NestedValueOf<{
    '!': TranslatorMessages;
}, [
    Namespace
] extends [never] ? '!' : `!.${Namespace}`>, NestedKeyOf<NestedValueOf<{
    '!': TranslatorMessages;
}, [
    Namespace
] extends [never] ? '!' : `!.${Namespace}`>>>;
type NamespacedValue<TranslatorMessages extends IntlMessages, Namespace extends NamespaceKeys<TranslatorMessages, NestedKeyOf<TranslatorMessages>>, TargetKey extends NamespacedMessageKeys<TranslatorMessages, Namespace>> = NestedValueOf<TranslatorMessages, [
    Namespace
] extends [never] ? TargetKey : `${Namespace}.${TargetKey}`>;
/**
 * @private Not intended for direct use.
 */
export type Translator<TranslatorMessages extends IntlMessages = IntlMessages, Namespace extends NamespaceKeys<TranslatorMessages, NestedKeyOf<TranslatorMessages>> = never> = {
    <TargetKey extends NamespacedMessageKeys<TranslatorMessages, Namespace>>(key: TargetKey, ...args: TranslateArgs<NamespacedValue<TranslatorMessages, Namespace, TargetKey>>): string;
    rich<TargetKey extends NamespacedMessageKeys<TranslatorMessages, Namespace>>(key: TargetKey, ...args: TranslateArgs<NamespacedValue<TranslatorMessages, Namespace, TargetKey>, RichTagsFunction>): ReactNode;
    markup<TargetKey extends NamespacedMessageKeys<TranslatorMessages, Namespace>>(key: TargetKey, ...args: TranslateArgs<NamespacedValue<TranslatorMessages, Namespace, TargetKey>, MarkupTagsFunction>): string;
    raw<TargetKey extends NamespacedMessageKeys<TranslatorMessages, Namespace>>(key: TargetKey): any;
    has<TargetKey extends NamespacedMessageKeys<TranslatorMessages, Namespace>>(key: TargetKey): boolean;
};
/**
 * Translates messages from the given namespace by using the ICU syntax.
 * See https://formatjs.io/docs/core-concepts/icu-syntax.
 *
 * If no namespace is provided, all available messages are returned.
 * The namespace can also indicate nesting by using a dot
 * (e.g. `namespace.Component`).
 */
export default function createTranslator<const TranslatorMessages extends IntlMessages, const Namespace extends NamespaceKeys<TranslatorMessages, NestedKeyOf<TranslatorMessages>> = never>({ _cache, _formatters, getMessageFallback, messages, namespace, onError, ...rest }: Omit<IntlConfig, 'messages'> & {
    messages?: TranslatorMessages;
    namespace?: Namespace;
    /** @private */
    _formatters?: Formatters;
    /** @private */
    _cache?: IntlCache;
}): Translator<TranslatorMessages, Namespace>;
export {};
