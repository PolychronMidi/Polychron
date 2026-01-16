/**
 * Dependency Injection Container - Service registration and resolution
 * Manages service lifecycle (singletons, transient) and dependency injection
 */

import { PolychronError, ErrorCode } from './PolychronError.js';

/**
 * Service lifecycle options
 */
export enum Lifecycle {
  SINGLETON = 'SINGLETON', // Single instance, reused
  TRANSIENT = 'TRANSIENT', // New instance each time
}

/**
 * Service factory function - creates instances of a service
 */
export type ServiceFactory<T = any> = (container: DIContainer) => T;

/**
 * Service registration metadata
 */
interface ServiceRegistration<T = any> {
  key: string;
  factory: ServiceFactory<T>;
  lifecycle: Lifecycle;
  instance?: T; // For singletons
}

/**
 * DIContainer - Manages service registration and resolution
 * Singleton pattern - one container per application
 */
export class DIContainer {
  private static instance: DIContainer;
  private services: Map<string, ServiceRegistration> = new Map();
  private resolving: Set<string> = new Set(); // Track circular dependencies

  private constructor() {}

  /**
   * Get singleton container instance
   */
  static getInstance(): DIContainer {
    if (!DIContainer.instance) {
      DIContainer.instance = new DIContainer();
    }
    return DIContainer.instance;
  }

  /**
   * Register a service in the container
   * @param key Service identifier (typically class name or interface name)
   * @param factory Function that creates the service
   * @param lifecycle SINGLETON (reuse) or TRANSIENT (new each time)
   */
  register<T = any>(
    key: string,
    factory: ServiceFactory<T>,
    lifecycle: Lifecycle = Lifecycle.SINGLETON
  ): void {
    if (this.services.has(key)) {
      throw new PolychronError(
        ErrorCode.INITIALIZATION_ERROR,
        `Service already registered: ${key}`,
        { service: key }
      );
    }

    this.services.set(key, {
      key,
      factory,
      lifecycle,
    });
  }

  /**
   * Register a singleton service (created once, reused)
   */
  registerSingleton<T = any>(key: string, factory: ServiceFactory<T>): void {
    this.register(key, factory, Lifecycle.SINGLETON);
  }

  /**
   * Register a transient service (new instance each time)
   */
  registerTransient<T = any>(key: string, factory: ServiceFactory<T>): void {
    this.register(key, factory, Lifecycle.TRANSIENT);
  }

  /**
   * Register an instance directly (singleton)
   */
  registerInstance<T = any>(key: string, instance: T): void {
    const registration: ServiceRegistration<T> = {
      key,
      factory: () => instance,
      lifecycle: Lifecycle.SINGLETON,
      instance,
    };

    this.services.set(key, registration);
  }

  /**
   * Resolve a service by key
   * @throws PolychronError if service not found or circular dependency detected
   */
  resolve<T = any>(key: string): T {
    // Use a stack-based resolution to ensure dependencies resolve first
    const resolutionStack: string[] = [];
    const resolved: Set<string> = new Set();

    const resolveInternal = (serviceKey: string): T => {
      // Check for circular dependencies
      if (this.resolving.has(serviceKey)) {
        throw new PolychronError(
          ErrorCode.INITIALIZATION_ERROR,
          `Circular dependency detected: ${serviceKey}`,
          { service: serviceKey, resolving: Array.from(this.resolving) }
        );
      }

      const registration = this.services.get(serviceKey);
      if (!registration) {
        throw new PolychronError(
          ErrorCode.INITIALIZATION_ERROR,
          `Service not found: ${serviceKey}`,
          { service: serviceKey }
        );
      }

      // Return singleton instance if already created
      if (registration.lifecycle === Lifecycle.SINGLETON && registration.instance !== undefined) {
        return registration.instance;
      }

      // Skip if already resolved in this resolution cycle
      if (resolved.has(serviceKey)) {
        return registration.instance as T;
      }

      // Track resolution to detect circular dependencies
      this.resolving.add(serviceKey);

      try {
        // Get dependencies by inspecting the factory code
        const dependencies = this.extractDependencies(serviceKey);

        // Resolve dependencies first (depth-first)
        for (const dep of dependencies) {
          if (!resolved.has(dep)) {
            resolveInternal(dep);
          }
        }

        // Now resolve this service
        const instance = registration.factory(this) as T;

        // Store singleton instance
        if (registration.lifecycle === Lifecycle.SINGLETON) {
          registration.instance = instance;
        }

        resolved.add(serviceKey);
        return instance;
      } finally {
        this.resolving.delete(serviceKey);
      }
    };

    return resolveInternal(key);
  }

  /**
   * Extract dependencies from a service factory by inspecting its source code
   */
  private extractDependencies(key: string): string[] {
    const registration = this.services.get(key);
    if (!registration) {
      return [];
    }

    const source = registration.factory.toString();

    // Extract c.resolve calls or container.resolve calls
    const matches = source.match(/(c|container)\.resolve\s*\(\s*['\"`]([^'\"`]+)['\"`]/g) || [];
    const deps = matches.map((m) => {
      const match = m.match(/['\"`]([^'\"`]+)['\"`]/);
      return match?.[1] || '';
    });

    return [...new Set(deps)].filter((d) => d && d !== key); // Remove duplicates and self-references
  }

  /**
   * Check if service is registered
   */
  has(key: string): boolean {
    return this.services.has(key);
  }

  /**
   * Get all registered service keys
   */
  getKeys(): string[] {
    return Array.from(this.services.keys());
  }

  /**
   * Get service registration info (for debugging)
   */
  getRegistration(key: string): ServiceRegistration | undefined {
    return this.services.get(key);
  }

  /**
   * Get all registered services (for debugging)
   */
  getAllRegistrations(): ServiceRegistration[] {
    return Array.from(this.services.values());
  }

  /**
   * Get lifecycle type of a service
   */
  getLifecycle(key: string): Lifecycle | undefined {
    return this.services.get(key)?.lifecycle;
  }

  /**
   * Check if service is singleton
   */
  isSingleton(key: string): boolean {
    return this.getLifecycle(key) === Lifecycle.SINGLETON;
  }

  /**
   * Check if service is transient
   */
  isTransient(key: string): boolean {
    return this.getLifecycle(key) === Lifecycle.TRANSIENT;
  }

  /**
   * Get singleton instance if cached (for debugging)
   */
  getCachedInstance<T = any>(key: string): T | undefined {
    return this.services.get(key)?.instance as T | undefined;
  }

  /**
   * Clear all singleton instances (not registrations)
   * Useful for testing/reset scenarios
   */
  clearInstances(): void {
    for (const registration of this.services.values()) {
      registration.instance = undefined;
    }
  }

  /**
   * Clear all registrations
   * Useful for testing
   */
  clear(): void {
    this.services.clear();
    this.resolving.clear();
  }

  /**
   * Unregister a service
   */
  unregister(key: string): boolean {
    return this.services.delete(key);
  }

  /**
   * Get count of registered services
   */
  getServiceCount(): number {
    return this.services.size;
  }

  /**
   * Get count of cached singleton instances
   */
  getCachedInstanceCount(): number {
    return Array.from(this.services.values()).filter((r) => r.instance !== undefined).length;
  }
}

/**
 * Helper types for dependency injection patterns
 */

/**
 * Constructor injection type - function that takes container and returns service
 */
export type ConstructorInjection<T> = (container: DIContainer) => T;

/**
 * Service configuration for batch registration
 */
export interface ServiceConfig<T = any> {
  key: string;
  factory: ServiceFactory<T>;
  lifecycle?: Lifecycle;
  dependsOn?: string[]; // For documentation/validation
}

/**
 * Register multiple services at once
 */
export function registerServices(
  container: DIContainer,
  configs: ServiceConfig[]
): void {
  for (const config of configs) {
    container.register(
      config.key,
      config.factory,
      config.lifecycle || Lifecycle.SINGLETON
    );
  }
}

/**
 * Get all services a service depends on (for debugging dependency graphs)
 */
export function getDependencies(
  container: DIContainer,
  key: string
): string[] {
  const registration = container.getRegistration(key);
  if (!registration) {
    return [];
  }

  // Try to infer dependencies from factory function source code
  // This is a best-effort approach for debugging
  const source = registration.factory.toString();
  const containerUses = source.includes('container');

  if (containerUses) {
    // Extract container.resolve calls (basic regex)
    const matches = source.match(/container\.resolve\(['"`]([^'"`]+)['"`]\)/g) || [];
    return matches.map((m) => m.match(/['"`]([^'"`]+)['"`]/)?.[1] || '');
  }

  return [];
}
