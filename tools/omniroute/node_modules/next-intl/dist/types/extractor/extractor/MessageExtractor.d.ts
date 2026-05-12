import type { ExtractorMessage } from '../types.js';
type StrictExtractedMessage = ExtractorMessage & {
    references: NonNullable<ExtractorMessage['references']>;
};
export default class MessageExtractor {
    private isDevelopment;
    private projectRoot;
    private sourceMap;
    private compileCache;
    constructor(opts: {
        isDevelopment?: boolean;
        projectRoot?: string;
        sourceMap?: boolean;
    });
    extract(absoluteFilePath: string, source: string): Promise<{
        messages: Array<StrictExtractedMessage>;
        code: string;
        map?: string;
    }>;
}
export {};
