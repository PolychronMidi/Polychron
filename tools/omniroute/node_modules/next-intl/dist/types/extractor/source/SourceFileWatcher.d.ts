import { type Event } from '@parcel/watcher';
type OnChange = (events: Array<Event>) => Promise<void>;
export type SourceFileWatcherEvent = Event;
export default class SourceFileWatcher implements Disposable {
    private subscriptions;
    private roots;
    private onChange;
    constructor(roots: Array<string>, onChange: OnChange);
    start(): Promise<void>;
    private normalizeEvents;
    expandDirectoryDeleteEvents(events: Array<Event>, prevKnownFiles: Array<string>): Promise<Array<Event>>;
    stop(): Promise<void>;
    [Symbol.dispose](): void;
}
export {};
