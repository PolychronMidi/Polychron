import type { InitializedIntlConfig } from '../core/IntlConfig.js';
import type { Formatters, IntlCache } from '../core/formatters.js';
export type IntlContextValue = InitializedIntlConfig & {
    formatters: Formatters;
    cache: IntlCache;
};
declare const IntlContext: import("react").Context<IntlContextValue | undefined>;
export default IntlContext;
