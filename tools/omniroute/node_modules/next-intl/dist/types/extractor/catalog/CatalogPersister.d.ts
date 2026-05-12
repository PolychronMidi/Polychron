import type ExtractorCodec from '../format/ExtractorCodec.js';
import type { ExtractorMessage, Locale } from '../types.js';
export default class CatalogPersister {
    private messagesPath;
    private codec;
    private extension;
    constructor(params: {
        messagesPath: string;
        codec: ExtractorCodec;
        extension: string;
    });
    private getFileName;
    private getFilePath;
    read(locale: Locale): Promise<Array<ExtractorMessage>>;
    write(messages: Array<ExtractorMessage>, context: {
        locale: Locale;
        sourceMessagesById: Map<string, ExtractorMessage>;
    }): Promise<void>;
    getLastModified(locale: Locale): Promise<Date | undefined>;
}
