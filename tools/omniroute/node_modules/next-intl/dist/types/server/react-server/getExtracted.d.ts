import type { Locale } from 'use-intl/core';
import getServerExtractor from './getServerExtractor.js';
type Return = ReturnType<typeof getServerExtractor>;
declare function getExtractedImpl(namespace?: string): Promise<Return>;
declare function getExtractedImpl(opts?: {
    locale: Locale;
    namespace?: string;
}): Promise<Return>;
declare const getExtracted: typeof getExtractedImpl;
export default getExtracted;
