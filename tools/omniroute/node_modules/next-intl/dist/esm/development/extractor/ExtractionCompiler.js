import CatalogManager from './catalog/CatalogManager.js';
import MessageExtractor from './extractor/MessageExtractor.js';

class ExtractionCompiler {
  constructor(config, opts = {}) {
    const extractor = opts.extractor ?? new MessageExtractor(opts);
    this.manager = new CatalogManager(config, {
      ...opts,
      extractor
    });
    this[Symbol.dispose] = this[Symbol.dispose].bind(this);
    this.installExitHandlers();
  }
  async extractAll() {
    // We can't rely on all files being compiled (e.g. due to persistent
    // caching), so loading the messages initially is necessary.
    await this.manager.loadMessages();
    await this.manager.save();
  }
  [Symbol.dispose]() {
    this.uninstallExitHandlers();
    this.manager[Symbol.dispose]();
  }
  installExitHandlers() {
    const cleanup = this[Symbol.dispose];
    process.on('exit', cleanup);
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
  }
  uninstallExitHandlers() {
    const cleanup = this[Symbol.dispose];
    process.off('exit', cleanup);
    process.off('SIGINT', cleanup);
    process.off('SIGTERM', cleanup);
  }
}

export { ExtractionCompiler as default };
