import type { MessagesFormat } from './format/types.js';
export type Locale = string;
export type ExtractorMessageReference = {
    path: string;
    line?: number;
};
export type ExtractorMessage = {
    id: string;
    message: string;
    description?: string;
    references?: Array<ExtractorMessageReference>;
    /** Allows for additional properties like .po flags to be read and later written. */
    [key: string]: unknown;
};
export type MessagesConfig = {
    path: string;
    format: MessagesFormat;
    locales: 'infer' | ReadonlyArray<Locale>;
    precompile?: boolean;
};
export type ExtractorConfig = {
    srcPath: string | Array<string>;
    sourceLocale: string;
    messages: MessagesConfig;
};
export type CatalogLoaderConfig = {
    messages: MessagesConfig;
};
