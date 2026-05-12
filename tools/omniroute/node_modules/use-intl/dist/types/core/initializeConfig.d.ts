import type IntlConfig from './IntlConfig.js';
/**
 * Enhances the incoming props with defaults.
 */
export default function initializeConfig<Props extends IntlConfig>({ formats, getMessageFallback, messages, onError, ...rest }: Props): Omit<Props, "formats" | "messages" | "onError" | "getMessageFallback"> & {
    formats: NonNullable<IntlConfig["formats"]> | undefined;
    messages: NonNullable<IntlConfig["messages"]> | undefined;
    onError: (error: import("./IntlError.js").default) => void;
    getMessageFallback: (info: {
        error: import("./IntlError.js").default;
        key: string;
        namespace?: string;
    }) => string;
};
