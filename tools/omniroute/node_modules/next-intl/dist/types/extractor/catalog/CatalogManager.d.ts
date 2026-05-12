import type MessageExtractor from '../extractor/MessageExtractor.js';
import type { ExtractorConfig } from '../types.js';
export default class CatalogManager implements Disposable {
    private config;
    /**
     * The source of truth for which messages are used.
     * NOTE: Should be mutated in place to keep `messagesById` and `messagesByFile` in sync.
     */
    private messagesByFile;
    /**
     * Fast lookup for messages by ID across all files,
     * contains the same messages as `messagesByFile`.
     * NOTE: Should be mutated in place to keep `messagesById` and `messagesByFile` in sync.
     */
    private messagesById;
    /**
     * This potentially also includes outdated ones that were initially available,
     * but are not used anymore. This allows to restore them if they are used again.
     **/
    private translationsByTargetLocale;
    private lastWriteByLocale;
    private saveScheduler;
    private projectRoot;
    private isDevelopment;
    private persister?;
    private codec?;
    private catalogLocales?;
    private extractor;
    private sourceWatcher?;
    private loadCatalogsPromise?;
    private scanCompletePromise?;
    constructor(config: ExtractorConfig, opts: {
        projectRoot?: string;
        isDevelopment?: boolean;
        sourceMap?: boolean;
        extractor: MessageExtractor;
    });
    private getCodec;
    private getPersister;
    private getCatalogLocales;
    private getTargetLocales;
    private getSrcPaths;
    loadMessages(): Promise<void>;
    private loadSourceMessages;
    private loadLocaleMessages;
    private loadTargetMessages;
    private reloadLocaleCatalog;
    private mergeSourceDiskMetadata;
    private processFile;
    private mergeReferences;
    private haveMessagesChangedForFile;
    private areMessagesEqual;
    save(): Promise<void>;
    private saveImpl;
    private saveLocale;
    private onLocalesChange;
    private handleFileEvents;
    [Symbol.dispose](): void;
}
