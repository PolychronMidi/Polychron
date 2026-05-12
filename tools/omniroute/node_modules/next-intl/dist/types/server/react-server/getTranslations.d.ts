import type { Locale, Messages, NamespaceKeys, NestedKeyOf, createTranslator } from 'use-intl/core';
declare function getTranslations<NestedKey extends NamespaceKeys<Messages, NestedKeyOf<Messages>> = never>(namespace?: NestedKey): Promise<ReturnType<typeof createTranslator<Messages, NestedKey>>>;
declare function getTranslations<NestedKey extends NamespaceKeys<Messages, NestedKeyOf<Messages>> = never>(opts?: {
    locale: Locale;
    namespace?: NestedKey;
}): Promise<ReturnType<typeof createTranslator<Messages, NestedKey>>>;
declare const _default: typeof getTranslations;
export default _default;
