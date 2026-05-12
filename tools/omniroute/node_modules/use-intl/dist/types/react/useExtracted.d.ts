import type { ReactNode } from 'react';
import type { MarkupTagsFunction, RichTagsFunction } from '../core/TranslationValues.js';
import type { TranslateArgs } from '../core/createTranslator.js';
type TranslateArgsObject<Value extends string, TagsFn extends RichTagsFunction | MarkupTagsFunction = never> = TranslateArgs<Value, TagsFn> extends readonly [any?, any?] ? undefined extends TranslateArgs<Value, TagsFn>[0] ? {
    values?: TranslateArgs<Value, TagsFn>[0];
    formats?: TranslateArgs<Value, TagsFn>[1];
} : {
    values: TranslateArgs<Value, TagsFn>[0];
    formats?: TranslateArgs<Value, TagsFn>[1];
} : never;
export default function useExtracted(namespace?: string): {
    <Message extends string>(message: Message, ...[values, formats]: TranslateArgs<Message>): string;
    <Message extends string>(params: {
        id?: string;
        /** Inline ICU message in the source locale. */
        message: Message;
        /** Description for translators and tooling. */
        description?: string;
    } & TranslateArgsObject<Message>): string;
    rich: {
        <Message extends string>(message: Message, ...[values, formats]: TranslateArgs<Message, RichTagsFunction>): ReactNode;
        <Message extends string>(params: {
            id?: string;
            /** Inline ICU message in the source locale. */
            message: Message;
            /** Description for translators and tooling. */
            description?: string;
        } & TranslateArgsObject<Message, RichTagsFunction>): ReactNode;
    };
    markup: {
        <Message extends string>(message: Message, ...[values, formats]: TranslateArgs<Message, MarkupTagsFunction>): string;
        <Message extends string>(params: {
            id?: string;
            /** Inline ICU message in the source locale. */
            message: Message;
            /** Description for translators and tooling. */
            description?: string;
        } & TranslateArgsObject<Message, MarkupTagsFunction>): string;
    };
    has<Message extends string>(message: Message): boolean;
};
export {};
