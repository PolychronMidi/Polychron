export default class LRUCache<Value> {
    private readonly maxSize;
    private cache;
    constructor(maxSize: number);
    set(key: string, value: Value): void;
    get(key: string): Value | undefined;
}
