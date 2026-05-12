import type { LocalePrefixConfigVerbose, LocalePrefixMode, Locales } from '../../routing/types.js';
export default function useBasePathname<AppLocales extends Locales, AppLocalePrefixMode extends LocalePrefixMode>(config: {
    localePrefix: LocalePrefixConfigVerbose<AppLocales, AppLocalePrefixMode>;
    defaultLocale?: AppLocales[number];
}): string | null;
