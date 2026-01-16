/**
 * DIContainer - Dependency Injection Container
 * Manages service registration, retrieval, and lifecycle
 * Supports singleton and transient patterns
 */

export type ServiceLifecycle = 'singleton' | 'transient';

export interface ServiceDescriptor {
  lifecycle: ServiceLifecycle;
  factory: () => any;
}

export class DIContainer {
  private services: Map<string, ServiceDescriptor> = new Map();
  private singletons: Map<string, any> = new Map();

  /**
   * Register a service in the container
   * @param key - Service identifier
   * @param factory - Function that creates the service instance
   * @param lifecycle - 'singleton' (cached) or 'transient' (new instance each time)
   */
  register(key: string, factory: () => any, lifecycle: ServiceLifecycle = 'singleton'): void {
    if (this.services.has(key)) {
      throw new Error(`Service '${key}' is already registered`);
    }
    this.services.set(key, { lifecycle, factory });
  }

  /**
   * Get a service instance from the container
   * @param key - Service identifier
   * @returns Service instance
   */
  get<T = any>(key: string): T {
    const descriptor = this.services.get(key);
    if (!descriptor) {
      throw new Error(`Service '${key}' not found in container`);
    }

    // Return cached singleton
    if (descriptor.lifecycle === 'singleton') {
      if (this.singletons.has(key)) {
        return this.singletons.get(key) as T;
      }
      const instance = descriptor.factory();
      this.singletons.set(key, instance);
      return instance as T;
    }

    // Return new transient instance
    return descriptor.factory() as T;
  }

  /**
   * Check if a service is registered
   * @param key - Service identifier
   */
  has(key: string): boolean {
    return this.services.has(key);
  }

  /**
   * Clear all services and singletons
   * Useful for testing isolation
   */
  clear(): void {
    this.services.clear();
    this.singletons.clear();
  }

  /**
   * Get all registered service keys
   */
  getServiceKeys(): string[] {
    return Array.from(this.services.keys());
  }

  /**
   * Get count of registered services
   */
  getServiceCount(): number {
    return this.services.size;
  }
}

/**
 * Global container instance
 */
let globalContainer: DIContainer | null = null;

/**
 * Get or create the global DI container
 */
export function getGlobalContainer(): DIContainer {
  if (!globalContainer) {
    globalContainer = new DIContainer();
  }
  return globalContainer;
}

/**
 * Set the global DI container (for testing)
 */
export function setGlobalContainer(container: DIContainer): void {
  globalContainer = container;
}

/**
 * Reset the global DI container (for testing isolation)
 */
export function resetGlobalContainer(): void {
  globalContainer = null;
}
