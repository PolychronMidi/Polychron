class POParser {
    static parse(content) {
        const lines = POParser.splitLines(content);
        const messages = [];
        const meta = {};
        let state = 'entry';
        let entry;
        for(let i = 0; i < lines.length; i++){
            const line = lines[i].trim();
            // An empty line indicates the end of an entry
            if (!line) {
                if (state === 'entry' && entry) {
                    messages.push(POParser.finishEntry(entry));
                    entry = undefined;
                }
                state = 'entry';
                continue;
            }
            if (state === 'meta') {
                if (line.startsWith(POParser.QUOTE)) {
                    const rawMetaLine = POParser.extractQuotedString(line, state);
                    const metaLine = POParser.unescape(rawMetaLine);
                    const cleaned = metaLine.endsWith('\n') ? metaLine.slice(0, -1) : metaLine;
                    const separatorIndex = cleaned.indexOf(POParser.META_SEPARATOR);
                    if (separatorIndex > 0) {
                        const key = cleaned.substring(0, separatorIndex).trim();
                        const value = cleaned.substring(separatorIndex + 1).trim();
                        meta[key] = value;
                    }
                } else {
                    POParser.throwWithLine('Encountered unexpected non-quoted metadata line', line);
                }
            } else {
                // Unsupported comment types
                if (POParser.lineStartsWithPrefix(line, POParser.COMMENTS.TRANSLATOR)) {
                    POParser.throwWithLine('Translator comments (#) are not supported, use inline descriptions instead', line);
                }
                if (POParser.lineStartsWithPrefix(line, POParser.COMMENTS.PREVIOUS)) {
                    POParser.throwWithLine('Previous string key comments (#|) are not supported', line);
                }
                // Flag comments
                if (POParser.lineStartsWithPrefix(line, POParser.COMMENTS.FLAG)) {
                    entry = POParser.ensureEntry(entry);
                    const flagsText = line.substring(POParser.COMMENTS.FLAG.length).trim();
                    entry.flags = flagsText.split(',').map((flag)=>flag.trim()).filter(Boolean);
                    continue;
                }
                // Reference comments
                if (POParser.lineStartsWithPrefix(line, POParser.COMMENTS.REFERENCE)) {
                    var _entry;
                    entry = POParser.ensureEntry(entry);
                    const parts = line.substring(POParser.COMMENTS.REFERENCE.length).trim().split(POParser.FILE_COLUMN_SEPARATOR);
                    const path = parts[0];
                    let lineNumber;
                    if (parts.length > 1) {
                        const parsedLine = parseInt(parts[1]);
                        if (!isNaN(parsedLine)) {
                            lineNumber = parsedLine;
                        }
                    }
                    (_entry = entry).references ?? (_entry.references = []);
                    const reference = {
                        path
                    };
                    if (lineNumber) {
                        reference.line = lineNumber;
                    }
                    entry.references.push(reference);
                    continue;
                }
                // Extracted comments
                if (POParser.lineStartsWithPrefix(line, POParser.COMMENTS.EXTRACTED)) {
                    var _entry1;
                    entry = POParser.ensureEntry(entry);
                    const comment = line.substring(POParser.COMMENTS.EXTRACTED.length).trim();
                    (_entry1 = entry).extractedComments ?? (_entry1.extractedComments = []);
                    entry.extractedComments.push(comment);
                    continue;
                }
                // Check for unsupported features
                if (POParser.lineStartsWithPrefix(line, POParser.KEYWORDS.MSGID_PLURAL)) {
                    POParser.throwWithLine('Plural forms (msgid_plural) are not supported, use ICU pluralization instead', line);
                }
                // msgctxt
                if (POParser.lineStartsWithPrefix(line, POParser.KEYWORDS.MSGCTXT)) {
                    entry = POParser.ensureEntry(entry);
                    entry.msgctxt = POParser.unescape(POParser.extractQuotedString(line.substring(POParser.KEYWORDS.MSGCTXT.length + 1), state));
                    continue;
                }
                // msgid
                if (POParser.lineStartsWithPrefix(line, POParser.KEYWORDS.MSGID)) {
                    entry = POParser.ensureEntry(entry);
                    entry.msgid = POParser.unescape(POParser.extractQuotedString(line.substring(POParser.KEYWORDS.MSGID.length + 1), state));
                    if (POParser.isMetaEntry(entry, messages)) {
                        state = 'meta';
                        entry = undefined;
                    }
                    continue;
                }
                // msgstr
                if (POParser.lineStartsWithPrefix(line, POParser.KEYWORDS.MSGSTR)) {
                    entry = POParser.ensureEntry(entry);
                    entry.msgstr = POParser.unescape(POParser.extractQuotedString(line.substring(POParser.KEYWORDS.MSGSTR.length + 1), state));
                    if (POParser.isMetaEntry(entry, messages)) {
                        state = 'meta';
                        entry = undefined;
                    }
                    continue;
                }
                // Multi-line strings are not supported in entry mode
                if (line.startsWith(POParser.QUOTE)) {
                    POParser.throwWithLine('Multi-line strings are not supported, use single-line strings instead', line);
                }
            }
        }
        // Finish any remaining entry
        if (state === 'entry' && entry) {
            messages.push(POParser.finishEntry(entry));
        }
        return {
            meta: Object.keys(meta).length > 0 ? meta : undefined,
            messages: messages.length > 0 ? messages : undefined
        };
    }
    static isMetaEntry(entry, messages) {
        return messages.length === 0 && entry.msgid === '' && entry.msgstr === '';
    }
    static serialize(catalog) {
        const lines = [];
        // Metadata
        if (catalog.meta) {
            lines.push(`${POParser.KEYWORDS.MSGID} ${POParser.QUOTE}${POParser.QUOTE}`);
            lines.push(`${POParser.KEYWORDS.MSGSTR} ${POParser.QUOTE}${POParser.QUOTE}`);
            for (const [key, value] of Object.entries(catalog.meta)){
                lines.push(`${POParser.QUOTE}${key}${POParser.META_SEPARATOR} ${POParser.escape(value)}${POParser.NEWLINE}${POParser.QUOTE}`);
            }
            lines.push('');
        }
        // Messages
        if (catalog.messages) {
            for (const entry of catalog.messages){
                if (entry.extractedComments && entry.extractedComments.length > 0) {
                    for (const comment of entry.extractedComments){
                        lines.push(`${POParser.COMMENTS.EXTRACTED} ${comment}`);
                    }
                }
                if (entry.references && entry.references.length > 0) {
                    for (const ref of entry.references){
                        let refString = ref.path;
                        if (ref.line) {
                            refString += `${POParser.FILE_COLUMN_SEPARATOR}${ref.line}`;
                        }
                        lines.push(`${POParser.COMMENTS.REFERENCE} ${refString}`);
                    }
                }
                if (entry.flags && entry.flags.length > 0) {
                    lines.push(`${POParser.COMMENTS.FLAG} ${entry.flags.join(POParser.FLAG_SEPARATOR)}`);
                }
                if (entry.msgctxt) {
                    lines.push(`${POParser.KEYWORDS.MSGCTXT} ${POParser.QUOTE}${POParser.escape(entry.msgctxt)}${POParser.QUOTE}`);
                }
                lines.push(`${POParser.KEYWORDS.MSGID} ${POParser.QUOTE}${POParser.escape(entry.msgid)}${POParser.QUOTE}`);
                lines.push(`${POParser.KEYWORDS.MSGSTR} ${POParser.QUOTE}${POParser.escape(entry.msgstr)}${POParser.QUOTE}`);
                lines.push('');
            }
        }
        return lines.join('\n');
    }
    static lineStartsWithPrefix(line, prefix) {
        return line.startsWith(prefix + ' ');
    }
    static throwWithLine(message, line) {
        throw new Error(`${message}:\n> ${line}`);
    }
    static splitLines(content) {
        // Avoid overhead for Unix newlines only
        if (content.includes('\r')) {
            content = content.replace(/\r\n/g, '\n');
        }
        return content.split('\n');
    }
    static ensureEntry(entry) {
        return entry || {};
    }
    static finishEntry(entry) {
        if (entry.msgid == null || entry.msgstr == null) {
            throw new Error('Incomplete message entry: both msgid and msgstr are required');
        }
        return {
            msgctxt: entry.msgctxt,
            msgid: entry.msgid,
            msgstr: entry.msgstr,
            extractedComments: entry.extractedComments,
            references: entry.references,
            flags: entry.flags
        };
    }
    static extractQuotedString(line, state) {
        const trimmed = line.trim();
        if (!trimmed.startsWith(POParser.QUOTE)) {
            POParser.throwWithLine('Incomplete quoted string', line);
        }
        if (!trimmed.endsWith(POParser.QUOTE)) {
            if (state === 'meta') {
                return trimmed.substring(POParser.QUOTE.length);
            }
            POParser.throwWithLine('Incomplete quoted string', line);
        }
        const endIndex = trimmed.length - POParser.QUOTE.length;
        return trimmed.substring(POParser.QUOTE.length, endIndex);
    }
    static escape(value) {
        let result = '';
        for (const char of value){
            const mapped = POParser.ESCAPE_LOOKUP[char];
            result += mapped != null ? `\\${mapped}` : char;
        }
        return result;
    }
    static unescape(value) {
        let result = '';
        for(let i = 0; i < value.length; i++){
            const char = value[i];
            if (char === '\\' && i + 1 < value.length) {
                const nextChar = value[i + 1];
                const mapped = POParser.UNESCAPE_LOOKUP[nextChar];
                if (mapped != null) {
                    result += mapped;
                    i++;
                    continue;
                }
            }
            result += char;
        }
        return result;
    }
}
POParser.KEYWORDS = {
    MSGID: 'msgid',
    MSGSTR: 'msgstr',
    MSGCTXT: 'msgctxt',
    MSGID_PLURAL: 'msgid_plural'
};
POParser.COMMENTS = {
    REFERENCE: '#:',
    EXTRACTED: '#.',
    TRANSLATOR: '#',
    FLAG: '#,',
    PREVIOUS: '#|'
};
POParser.QUOTE = '"';
POParser.NEWLINE = '\\n';
POParser.FILE_COLUMN_SEPARATOR = ':';
POParser.META_SEPARATOR = ':';
POParser.FLAG_SEPARATOR = ', ';
POParser.ESCAPE_LOOKUP = {
    '\\': '\\',
    '"': '"',
    '\n': 'n',
    '\r': 'r',
    '\t': 't'
};
POParser.UNESCAPE_LOOKUP = Object.entries(POParser.ESCAPE_LOOKUP).reduce((acc, [char, code])=>{
    acc[code] = char;
    return acc;
}, {});

export { POParser as default };
