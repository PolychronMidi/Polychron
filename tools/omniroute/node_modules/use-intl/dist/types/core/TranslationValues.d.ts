import type { ReactNode } from 'react';
export type TranslationValues = Record<string, string | number | Date>;
export type RichTagsFunction = (chunks: ReactNode) => ReactNode;
export type MarkupTagsFunction = (chunks: string) => string;
export type RichTranslationValues = Record<string, TranslationValues[string] | RichTagsFunction>;
export type MarkupTranslationValues = Record<string, TranslationValues[string] | MarkupTagsFunction>;
