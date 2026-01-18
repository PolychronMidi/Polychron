<!-- 
### TODO - log of items planned / in progress

- [mm-dd-hh:mm] Example (newest) TODO Title - One sentence summary.
[mm-dd-hh:mm] Timestamped note of latest development or roadblock for this TODO
[mm-dd-hh:mm] Older timestamped notes for this TODO

- mm-dd-hh:mm Example Todo #2 (older) , etc...
-->

# DIContainer.ts - Lightweight Dependency Injection

> **Status**: Core Utility  
> **Dependencies**: None (standalone)


## Overview

`DIContainer.ts` provides a minimal dependency injection container supporting singleton and transient lifecycles. It is used to register factories, resolve services, and manage a global container for convenience in tests and legacy code.

**Core Responsibilities:**
- Register services with lifecycle control (singleton vs transient)
- Resolve services with caching for singletons
- Inspect and clear registered services for testing isolation
- Provide a global container getter/setter/reset for legacy access

## Architecture Role

- Injected into composition context to supply services to modules
- Used by tests to isolate service instances via `clear()` or global reset

---

## API

### `class DIContainer`

Minimal DI container with lifecycle-aware registrations.

<!-- BEGIN: snippet:DIContainer -->

```typescript
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
```

<!-- END: snippet:DIContainer -->

#### `register(key, factory, lifecycle = 'singleton')`

Register a factory with lifecycle control.

<!-- BEGIN: snippet:DIContainer_register -->

```typescript
register(key: string, factory: () => any, lifecycle: ServiceLifecycle = 'singleton'): void {
    if (this.services.has(key)) {
      throw new Error(`Service '${key}' is already registered`);
    }
    this.services.set(key, { lifecycle, factory });
  }
```

<!-- END: snippet:DIContainer_register -->

#### `get(key)`

Resolve a service; caches singletons, creates transients per call.

<!-- BEGIN: snippet:DIContainer_get -->

```typescript
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
```

<!-- END: snippet:DIContainer_get -->

#### `has(key)`

Check if a service is registered.

<!-- BEGIN: snippet:DIContainer_has -->

```typescript
has(key: string): boolean {
    return this.services.has(key);
  }
```

<!-- END: snippet:DIContainer_has -->

#### `clear()`

Remove all registrations and cached singletons (testing helper).

<!-- BEGIN: snippet:DIContainer_clear -->

```typescript
clear(): void {
    this.services.clear();
    this.singletons.clear();
  }
```

<!-- END: snippet:DIContainer_clear -->

#### `getServiceKeys()` / `getServiceCount()`

Inspect registered services.

<!-- BEGIN: snippet:DIContainer_getServiceKeys -->

```typescript
getServiceKeys(): string[] {
    return Array.from(this.services.keys());
  }
```

<!-- END: snippet:DIContainer_getServiceKeys -->

<!-- BEGIN: snippet:DIContainer_getServiceCount -->

```typescript
getServiceCount(): number {
    return this.services.size;
  }
```

<!-- END: snippet:DIContainer_getServiceCount -->

### Global Helpers

#### `getGlobalContainer()` / `setGlobalContainer(container)` / `resetGlobalContainer()`

Convenience accessors for a shared container, primarily for testing and legacy compatibility.

---

## Usage Example

```typescript
import { DIContainer, getGlobalContainer } from '../src/DIContainer';

const container = new DIContainer();
container.register('config', () => ({ env: 'test' }));
container.register('uuid', () => crypto.randomUUID(), 'transient');

const cfg = container.get('config'); // singleton
const id1 = container.get('uuid');   // new each call
const id2 = container.get('uuid');

setGlobalContainer(container);
const same = getGlobalContainer().get('config');
```

---

## Related Modules

- CompositionContext.ts ([code](../src/CompositionContext.ts)) ([doc](CompositionContext.md)) - Context wiring that carries the container
- ModuleInitializer.ts ([code](../src/ModuleInitializer.ts)) ([doc](ModuleInitializer.md)) - Bootstraps modules and registers services
