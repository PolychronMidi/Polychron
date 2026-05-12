import fs from 'fs/promises';
import path from 'path';
import { subscribe } from '@parcel/watcher';
import SourceFileFilter from './SourceFileFilter.js';
import SourceFileScanner from './SourceFileScanner.js';

class SourceFileWatcher {
  subscriptions = [];
  constructor(roots, onChange) {
    this.roots = roots;
    this.onChange = onChange;
  }
  async start() {
    if (this.subscriptions.length > 0) {
      return;
    }
    const ignore = SourceFileFilter.IGNORED_DIRECTORIES.map(dir => `**/${dir}/**`);
    for (const root of this.roots) {
      const sub = await subscribe(root, async (err, events) => {
        if (err) {
          console.error(err);
          return;
        }
        const filtered = await this.normalizeEvents(events);
        if (filtered.length > 0) {
          void this.onChange(filtered);
        }
      }, {
        ignore
      });
      this.subscriptions.push(sub);
    }
  }
  async normalizeEvents(events) {
    const directoryCreatePaths = [];
    const otherEvents = [];

    // We need to expand directory creates because during rename operations,
    // @parcel/watcher emits a directory create event but may not emit individual
    // file events for the moved files
    await Promise.all(events.map(async event => {
      if (event.type === 'create') {
        try {
          const stats = await fs.stat(event.path);
          if (stats.isDirectory()) {
            directoryCreatePaths.push(event.path);
            return;
          }
        } catch {
          // Path doesn't exist or is inaccessible, treat as file
        }
      }
      otherEvents.push(event);
    }));

    // Expand directory create events to find source files inside
    let expandedCreateEvents = [];
    if (directoryCreatePaths.length > 0) {
      try {
        const sourceFiles = await SourceFileScanner.getSourceFiles(directoryCreatePaths);
        expandedCreateEvents = Array.from(sourceFiles).map(filePath => ({
          type: 'create',
          path: filePath
        }));
      } catch {
        // Directories might have been deleted or are inaccessible
      }
    }

    // Combine original events with expanded directory creates.
    // Deduplicate by path to avoid processing the same file twice
    // in case @parcel/watcher also emitted individual file events.
    const allEvents = [...otherEvents, ...expandedCreateEvents];
    const seenPaths = new Set();
    const deduplicated = [];
    for (const event of allEvents) {
      const key = `${event.type}:${event.path}`;
      if (!seenPaths.has(key)) {
        seenPaths.add(key);
        deduplicated.push(event);
      }
    }
    return deduplicated.filter(event => {
      // Keep all delete events (might be deleted directories that no longer exist)
      if (event.type === 'delete') {
        return true;
      }
      // Keep source files
      return SourceFileFilter.isSourceFile(event.path);
    });
  }
  async expandDirectoryDeleteEvents(events, prevKnownFiles) {
    const expanded = [];
    for (const event of events) {
      if (event.type === 'delete' && !SourceFileFilter.isSourceFile(event.path)) {
        const dirPath = path.resolve(event.path);
        const filesInDirectory = [];
        for (const filePath of prevKnownFiles) {
          if (SourceFileFilter.isWithinPath(filePath, dirPath)) {
            filesInDirectory.push(filePath);
          }
        }

        // If we found files within this path, it was a directory
        if (filesInDirectory.length > 0) {
          for (const filePath of filesInDirectory) {
            expanded.push({
              type: 'delete',
              path: filePath
            });
          }
        } else {
          // Not a directory or no files in it, pass through as-is
          expanded.push(event);
        }
      } else {
        // Pass through as-is
        expanded.push(event);
      }
    }
    return expanded;
  }
  async stop() {
    await Promise.all(this.subscriptions.map(sub => sub.unsubscribe()));
    this.subscriptions = [];
  }
  [Symbol.dispose]() {
    void this.stop();
  }
}

export { SourceFileWatcher as default };
