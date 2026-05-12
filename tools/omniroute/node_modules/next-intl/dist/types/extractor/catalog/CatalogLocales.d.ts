import type { Locale, MessagesConfig } from '../types.js';
type LocaleChangeCallback = (params: {
    added: Array<Locale>;
    removed: Array<Locale>;
}) => unknown;
type CatalogLocalesParams = {
    messagesDir: string;
    sourceLocale: Locale;
    extension: string;
    locales: MessagesConfig['locales'];
};
export default class CatalogLocales {
    private messagesDir;
    private extension;
    private sourceLocale;
    private locales;
    private watcher?;
    private targetLocales?;
    private onChangeCallbacks;
    constructor(params: CatalogLocalesParams);
    getTargetLocales(): Promise<Array<Locale>>;
    private readTargetLocales;
    subscribeLocalesChange(callback: LocaleChangeCallback): void;
    unsubscribeLocalesChange(callback: LocaleChangeCallback): void;
    private startWatcher;
    private stopWatcher;
    private onChange;
}
export {};
