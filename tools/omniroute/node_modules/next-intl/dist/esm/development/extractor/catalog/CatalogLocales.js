import fs$1 from 'fs';
import fs from 'fs/promises';
import path from 'path';

class CatalogLocales {
  onChangeCallbacks = new Set();
  constructor(params) {
    this.messagesDir = params.messagesDir;
    this.sourceLocale = params.sourceLocale;
    this.extension = params.extension;
    this.locales = params.locales;
  }
  async getTargetLocales() {
    if (this.targetLocales) {
      return this.targetLocales;
    }
    if (this.locales === 'infer') {
      this.targetLocales = await this.readTargetLocales();
    } else {
      this.targetLocales = this.locales.filter(locale => locale !== this.sourceLocale);
    }
    return this.targetLocales;
  }
  async readTargetLocales() {
    try {
      const files = await fs.readdir(this.messagesDir);
      return files.filter(file => file.endsWith(this.extension)).map(file => path.basename(file, this.extension)).filter(locale => locale !== this.sourceLocale);
    } catch {
      return [];
    }
  }
  subscribeLocalesChange(callback) {
    this.onChangeCallbacks.add(callback);
    if (this.locales === 'infer' && !this.watcher) {
      void this.startWatcher();
    }
  }
  unsubscribeLocalesChange(callback) {
    this.onChangeCallbacks.delete(callback);
    if (this.onChangeCallbacks.size === 0) {
      this.stopWatcher();
    }
  }
  async startWatcher() {
    if (this.watcher) {
      return;
    }
    await fs.mkdir(this.messagesDir, {
      recursive: true
    });
    this.watcher = fs$1.watch(this.messagesDir, {
      persistent: false,
      recursive: false
    }, (event, filename) => {
      const isCatalogFile = filename != null && filename.endsWith(this.extension) && !filename.includes(path.sep);
      if (isCatalogFile) {
        void this.onChange();
      }
    });
  }
  stopWatcher() {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = undefined;
    }
  }
  async onChange() {
    const oldLocales = new Set(this.targetLocales || []);
    this.targetLocales = await this.readTargetLocales();
    const newLocalesSet = new Set(this.targetLocales);
    const added = this.targetLocales.filter(locale => !oldLocales.has(locale));
    const removed = Array.from(oldLocales).filter(locale => !newLocalesSet.has(locale));
    if (added.length > 0 || removed.length > 0) {
      for (const callback of this.onChangeCallbacks) {
        callback({
          added,
          removed
        });
      }
    }
  }
}

export { CatalogLocales as default };
