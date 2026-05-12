import fs from 'fs/promises';
import path from 'path';

class CatalogPersister {
  constructor(params) {
    this.messagesPath = params.messagesPath;
    this.codec = params.codec;
    this.extension = params.extension;
  }
  getFileName(locale) {
    return locale + this.extension;
  }
  getFilePath(locale) {
    return path.join(this.messagesPath, this.getFileName(locale));
  }
  async read(locale) {
    const filePath = this.getFilePath(locale);
    let content;
    try {
      content = await fs.readFile(filePath, 'utf8');
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        return [];
      }
      throw new Error(`Error while reading ${this.getFileName(locale)}:\n> ${error}`, {
        cause: error
      });
    }
    try {
      return this.codec.decode(content, {
        locale
      });
    } catch (error) {
      throw new Error(`Error while decoding ${this.getFileName(locale)}:\n> ${error}`, {
        cause: error
      });
    }
  }
  async write(messages, context) {
    const filePath = this.getFilePath(context.locale);
    const content = this.codec.encode(messages, context);
    try {
      const outputDir = path.dirname(filePath);
      await fs.mkdir(outputDir, {
        recursive: true
      });
      await fs.writeFile(filePath, content);
    } catch (error) {
      console.error(`❌ Failed to write catalog: ${error}`);
    }
  }
  async getLastModified(locale) {
    const filePath = this.getFilePath(locale);
    try {
      const stats = await fs.stat(filePath);
      return stats.mtime;
    } catch {
      return undefined;
    }
  }
}

export { CatalogPersister as default };
