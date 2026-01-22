/**
 * Module Initialization System - Formalized initialization lifecycle for Polychron modules
 * Ensures modules initialize in correct dependency order with proper error handling and rollback
 */

import type { IPolychronContext } from './PolychronContext.js';
import { PolychronError, ErrorCode } from './PolychronError.js';

/**
 * Module initialization lifecycle interface
 * All core modules implement this to participate in managed initialization
 */
export interface IModuleInitializer {
  /** Module name for logging and identification */
  name: string;

  /** Priority order (lower = initializes first). Used for dependency ordering. */
  priority: number;

  /**
   * Validate configuration before initialization
   * @returns true if config is valid, false or throw if invalid
   */
  validateConfig(context: IPolychronContext): boolean;

  /**
   * Initialize the module with the given context
   * Called after all lower-priority modules initialized
   * @throws PolychronError on initialization failure
   */
  init(context: IPolychronContext): void;

  /**
   * Clean up/destroy the module
   * Called during rollback on initialization failure
   * Should undo any changes made during init()
   */
  destroy(): void;
}

/**
 * Module Registry - Manages ordered initialization and lifecycle of all modules
 * Implements singleton pattern for global module management
 */
export class ModuleRegistry {
  private static instance: ModuleRegistry;
  private modules: Map<string, IModuleInitializer> = new Map();
  private initializedModules: string[] = [];
  private isInitialized = false;

  private constructor() {}

  /**
   * Get singleton instance
   */
  static getInstance(): ModuleRegistry {
    if (!ModuleRegistry.instance) {
      ModuleRegistry.instance = new ModuleRegistry();
    }
    return ModuleRegistry.instance;
  }

  /**
   * Register a module in the registry
   * @throws PolychronError if module with same name already registered
   */
  register(module: IModuleInitializer): void {
    if (this.modules.has(module.name)) {
      throw new PolychronError(
        ErrorCode.INITIALIZATION_ERROR,
        `Module already registered: ${module.name}`,
        { module: module.name }
      );
    }
    this.modules.set(module.name, module);
  }

  /**
   * Get registered module by name
   */
  getModule(name: string): IModuleInitializer | undefined {
    return this.modules.get(name);
  }

  /**
   * Get all registered modules sorted by priority
   */
  getAllModules(): IModuleInitializer[] {
    return Array.from(this.modules.values()).sort(
      (a, b) => a.priority - b.priority
    );
  }

  /**
   * Initialize all modules in priority order with rollback on error
   * @throws PolychronError on initialization failure (all initialized modules are destroyed)
   */
  /**
   * Initialize all modules in priority order with rollback on error
   * Validates ALL modules first, then initializes them
   * @throws PolychronError on initialization or validation failure (all initialized modules are destroyed)
   */
  initAll(context: IPolychronContext): void {
    if (this.isInitialized) {
      throw new PolychronError(
        ErrorCode.INITIALIZATION_ERROR,
        'ModuleRegistry already initialized. Call reset() first.'
      );
    }

    const sortedModules = this.getAllModules();
    this.initializedModules = [];

    try {
      // Step 1: Validate all modules first
      for (const module of sortedModules) {
        if (!module.validateConfig(context)) {
          throw new PolychronError(
            ErrorCode.VALIDATION_CONFIGURATION,
            `Module validation failed: ${module.name}`,
            { module: module.name }
          );
        }
      }

      // Step 2: Initialize each module in priority order (only if all validation passed)
      for (const module of sortedModules) {
        try {
          module.init(context);
          this.initializedModules.push(module.name);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          throw new PolychronError(
            ErrorCode.INITIALIZATION_ERROR,
            `Failed to initialize module ${module.name}: ${message}`,
            {
              module: module.name,
              originalError: error,
            }
          );
        }
      }

      this.isInitialized = true;
    } catch (error) {
      // Rollback: destroy all initialized modules in reverse order
      this.rollback();
      throw error;
    }
  }

  /**
   * Destroy all modules in reverse initialization order
   */
  private rollback(): void {
    // Destroy in reverse order (reverse of initialization)
    for (let i = this.initializedModules.length - 1; i >= 0; i--) {
      const moduleName = this.initializedModules[i];
      const module = this.modules.get(moduleName);
      if (module) {
        try {
          module.destroy();
        } catch (error) {
          // Log but don't throw - we need to destroy all modules
          console.error(
            `Error destroying module ${moduleName}:`,
            error instanceof Error ? error.message : String(error)
          );
        }
      }
    }
    this.initializedModules = [];
    this.isInitialized = false;
  }

  /**
   * Check if all modules are initialized
   */
  isAllInitialized(): boolean {
    return this.isInitialized;
  }

  /**
   * Get list of initialized module names
   */
  getInitializedModules(): string[] {
    return [...this.initializedModules];
  }

  /**
   * Reset registry to uninitialized state
   * Destroys all modules
   */
  reset(): void {
    this.rollback();
  }

  /**
   * Clear all modules from registry
   * Useful for testing
   */
  clear(): void {
    this.rollback();
    this.modules.clear();
  }
}

/**
 * Default priority values for core modules
 * Lower number = initializes first
 */
export const INIT_PRIORITIES = {
  CONFIG: 0, // Must initialize first
  EVENT_BUS: 10, // Events before dependent modules
  LAYER_MANAGER: 20, // Timing infrastructure
  STAGE: 30, // Uses layer manager
  FX_MANAGER: 40, // Uses stage
  WRITERS: 50, // Final stage, uses stage output
} as const;
