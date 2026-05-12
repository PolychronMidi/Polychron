type Entry = {
    msgctxt?: string;
    msgid: string;
    msgstr: string;
    references?: Array<{
        path: string;
        line?: number;
    }>;
    extractedComments?: Array<string>;
    flags?: Array<string>;
};
type Catalog = {
    meta?: Record<string, string>;
    messages?: Array<Entry>;
};
declare class POParser {
    private static readonly KEYWORDS;
    private static readonly COMMENTS;
    private static readonly QUOTE;
    private static readonly NEWLINE;
    private static readonly FILE_COLUMN_SEPARATOR;
    private static readonly META_SEPARATOR;
    private static readonly FLAG_SEPARATOR;
    private static readonly ESCAPE_LOOKUP;
    private static readonly UNESCAPE_LOOKUP;
    static parse(content: string): Catalog;
    private static isMetaEntry;
    static serialize(catalog: Catalog): string;
    private static lineStartsWithPrefix;
    private static throwWithLine;
    private static splitLines;
    private static ensureEntry;
    private static finishEntry;
    private static extractQuotedString;
    private static escape;
    private static unescape;
}

export { POParser as default };
export type { Entry };
