class LRUCache {
  constructor(maxSize) {
    this.maxSize = maxSize;
    this.cache = new Map();
  }
  set(key, value) {
    const isNewKey = !this.cache.has(key);
    if (isNewKey && this.cache.size >= this.maxSize) {
      const lruKey = this.cache.keys().next().value;
      if (lruKey !== undefined) {
        this.cache.delete(lruKey);
      }
    }
    this.cache.set(key, {
      key,
      value
    });
  }
  get(key) {
    const item = this.cache.get(key);
    if (item) {
      this.cache.delete(key);
      this.cache.set(key, item);
      return item.value;
    }
    return undefined;
  }
}

export { LRUCache as default };
