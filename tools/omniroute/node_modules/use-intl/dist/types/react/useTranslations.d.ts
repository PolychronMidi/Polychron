import type { Messages } from '../core/AppConfig.js';
import type { NamespaceKeys, NestedKeyOf } from '../core/MessageKeys.js';
import type createTranslator from '../core/createTranslator.js';
/**
 * Translates messages from the given namespace by using the ICU syntax.
 * See https://formatjs.io/docs/core-concepts/icu-syntax.
 *
 * If no namespace is provided, all available messages are returned.
 * The namespace can also indicate nesting by using a dot
 * (e.g. `namespace.Component`).
 */
export default function useTranslations<NestedKey extends NamespaceKeys<Messages, NestedKeyOf<Messages>> = never>(namespace?: NestedKey): ReturnType<typeof createTranslator<Messages, NestedKey>>;
