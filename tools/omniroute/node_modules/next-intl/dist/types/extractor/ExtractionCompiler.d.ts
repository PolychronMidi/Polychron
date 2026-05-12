import MessageExtractor from './extractor/MessageExtractor.js';
import type { ExtractorConfig } from './types.js';
export default class ExtractionCompiler implements Disposable {
    private manager;
    constructor(config: ExtractorConfig, opts?: {
        isDevelopment?: boolean;
        projectRoot?: string;
        sourceMap?: boolean;
        extractor?: MessageExtractor;
    });
    extractAll(): Promise<void>;
    [Symbol.dispose](): void;
    private installExitHandlers;
    private uninstallExitHandlers;
}
