type SaveTask<T> = () => Promise<T>;
/**
 * De-duplicates excessive save invocations,
 * while keeping a single one instant.
 */
export default class SaveScheduler<Value> implements Disposable {
    private saveTimeout?;
    private isSaving;
    private delayMs;
    private pendingResolvers;
    private nextSaveTask?;
    constructor(delayMs?: number);
    schedule(saveTask: SaveTask<Value>): Promise<Value>;
    private scheduleSave;
    private executeSave;
    [Symbol.dispose](): void;
}
export {};
