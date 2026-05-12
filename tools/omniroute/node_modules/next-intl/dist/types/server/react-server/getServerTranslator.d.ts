import { type Messages, type NamespaceKeys, type NestedKeyOf, createTranslator } from 'use-intl/core';
declare function getServerTranslatorImpl<NestedKey extends NamespaceKeys<Messages, NestedKeyOf<Messages>> = never>(config: Parameters<typeof createTranslator>[0], namespace?: NestedKey): ReturnType<typeof createTranslator<Messages, NestedKey>>;
declare const _default: typeof getServerTranslatorImpl;
export default _default;
