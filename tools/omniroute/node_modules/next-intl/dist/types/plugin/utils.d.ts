export declare function throwError(message: string): never;
export declare function warn(message: string): void;
/**
 * Returns a function that runs the provided callback only once per process.
 * Next.js can call the config multiple times - this ensures we only run once.
 * Uses an environment variable to track execution across config loads.
 */
export declare function once(namespace: string): (fn: () => void) => void;
