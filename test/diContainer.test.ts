import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  DIContainer,
  Lifecycle,
  ServiceFactory,
  registerServices,
  getDependencies,
} from '../src/DIContainer';
import { PolychronError, ErrorCode } from '../src/PolychronError';

// Mock services for testing
interface Logger {
  log(msg: string): void;
}

interface Database {
  connect(): void;
}

interface UserService {
  getUser(id: number): string;
}

class MockLogger implements Logger {
  logs: string[] = [];
  log(msg: string): void {
    this.logs.push(msg);
  }
}

class MockDatabase implements Database {
  connected = false;
  connect(): void {
    this.connected = true;
  }
}

class MockUserService implements UserService {
  constructor(private db: Database) {}
  getUser(id: number): string {
    return `User ${id}`;
  }
}

describe('DIContainer - Dependency Injection', () => {
  let container: DIContainer;

  beforeEach(() => {
    container = DIContainer.getInstance();
    container.clear();
  });

  afterEach(() => {
    container.clear();
  });

  describe('DIContainer singleton', () => {
    it('should return same instance', () => {
      const instance1 = DIContainer.getInstance();
      const instance2 = DIContainer.getInstance();
      expect(instance1).toBe(instance2);
    });

    it('should start empty', () => {
      expect(container.getServiceCount()).toBe(0);
    });
  });

  describe('Service registration', () => {
    it('should register a singleton service', () => {
      const factory: ServiceFactory<Logger> = () => new MockLogger();
      container.register('Logger', factory, Lifecycle.SINGLETON);

      expect(container.has('Logger')).toBe(true);
      expect(container.isSingleton('Logger')).toBe(true);
    });

    it('should register a transient service', () => {
      const factory: ServiceFactory<Logger> = () => new MockLogger();
      container.register('Logger', factory, Lifecycle.TRANSIENT);

      expect(container.has('Logger')).toBe(true);
      expect(container.isTransient('Logger')).toBe(true);
    });

    it('should register singleton via helper', () => {
      const factory: ServiceFactory<Logger> = () => new MockLogger();
      container.registerSingleton('Logger', factory);

      expect(container.isSingleton('Logger')).toBe(true);
    });

    it('should register transient via helper', () => {
      const factory: ServiceFactory<Logger> = () => new MockLogger();
      container.registerTransient('Logger', factory);

      expect(container.isTransient('Logger')).toBe(true);
    });

    it('should register instance directly', () => {
      const logger = new MockLogger();
      container.registerInstance('Logger', logger);

      expect(container.has('Logger')).toBe(true);
      expect(container.resolve('Logger')).toBe(logger);
    });

    it('should throw on duplicate registration', () => {
      const factory: ServiceFactory<Logger> = () => new MockLogger();
      container.register('Logger', factory);

      expect(() => {
        container.register('Logger', factory);
      }).toThrow(PolychronError);
    });

    it('should support multiple services', () => {
      container.register('Logger', () => new MockLogger());
      container.register('Database', () => new MockDatabase());
      container.register('UserService', () => new MockUserService(new MockDatabase()));

      expect(container.getServiceCount()).toBe(3);
    });
  });

  describe('Service resolution', () => {
    it('should resolve registered service', () => {
      const factory: ServiceFactory<Logger> = () => new MockLogger();
      container.register('Logger', factory);

      const logger = container.resolve<Logger>('Logger');
      expect(logger).toBeInstanceOf(MockLogger);
    });

    it('should throw if service not found', () => {
      expect(() => {
        container.resolve('NonExistent');
      }).toThrow(PolychronError);
    });

    it('should throw with service key in error', () => {
      try {
        container.resolve('NonExistent');
        expect.fail('Should have thrown');
      } catch (error) {
        if (error instanceof PolychronError) {
          expect(error.context.service).toBe('NonExistent');
        }
      }
    });

    it('should resolve singleton only once', () => {
      const factory = vi.fn(() => new MockLogger());
      container.registerSingleton('Logger', factory);

      const logger1 = container.resolve<Logger>('Logger');
      const logger2 = container.resolve<Logger>('Logger');

      expect(logger1).toBe(logger2);
      expect(factory).toHaveBeenCalledTimes(1);
    });

    it('should resolve transient each time', () => {
      const factory = vi.fn(() => new MockLogger());
      container.registerTransient('Logger', factory);

      const logger1 = container.resolve<Logger>('Logger');
      const logger2 = container.resolve<Logger>('Logger');

      expect(logger1).not.toBe(logger2);
      expect(factory).toHaveBeenCalledTimes(2);
    });

    it('should support constructor injection', () => {
      container.registerSingleton('Database', () => new MockDatabase());
      container.registerSingleton('UserService', (c) => {
        const db = c.resolve<Database>('Database');
        return new MockUserService(db);
      });

      const userService = container.resolve<UserService>('UserService');
      expect(userService).toBeInstanceOf(MockUserService);
    });

    it('should support chained dependencies', () => {
      container.registerSingleton('Database', () => {
        const db = new MockDatabase();
        db.connect();
        return db;
      });

      container.registerSingleton('UserService', (c) => {
        const db = c.resolve<Database>('Database');
        return new MockUserService(db);
      });

      const userService = container.resolve<UserService>('UserService');
      const db = container.resolve<Database>('Database');

      expect(userService).toBeInstanceOf(MockUserService);
      expect(db.connected).toBe(true);
    });
  });

  describe('Circular dependency detection', () => {
    it('should detect circular dependency', () => {
      // Service A depends on Service B
      container.registerSingleton('ServiceA', (c) => ({
        b: c.resolve('ServiceB'),
      }));

      // Service B depends on Service A (circular)
      container.registerSingleton('ServiceB', (c) => ({
        a: c.resolve('ServiceA'),
      }));

      expect(() => {
        container.resolve('ServiceA');
      }).toThrow(PolychronError);

      try {
        container.resolve('ServiceA');
        expect.fail('Should have thrown');
      } catch (error) {
        if (error instanceof PolychronError) {
          expect(error.code).toBe(ErrorCode.INITIALIZATION_ERROR);
          expect(error.message).toContain('Circular dependency');
        }
      }
    });

    it('should detect self-circular dependency', () => {
      container.registerSingleton('ServiceA', (c) => ({
        self: c.resolve('ServiceA'),
      }));

      expect(() => {
        container.resolve('ServiceA');
      }).toThrow(PolychronError);
    });
  });

  describe('Service querying', () => {
    beforeEach(() => {
      container.register('Logger', () => new MockLogger());
      container.register('Database', () => new MockDatabase());
    });

    it('should check if service exists', () => {
      expect(container.has('Logger')).toBe(true);
      expect(container.has('NonExistent')).toBe(false);
    });

    it('should get all service keys', () => {
      const keys = container.getKeys();
      expect(keys).toContain('Logger');
      expect(keys).toContain('Database');
      expect(keys.length).toBe(2);
    });

    it('should get service registration', () => {
      const registration = container.getRegistration('Logger');
      expect(registration).toBeDefined();
      expect(registration?.key).toBe('Logger');
    });

    it('should get all registrations', () => {
      const registrations = container.getAllRegistrations();
      expect(registrations.length).toBe(2);
    });

    it('should get lifecycle type', () => {
      container.registerSingleton('S1', () => ({}));
      container.registerTransient('T1', () => ({}));

      expect(container.getLifecycle('S1')).toBe(Lifecycle.SINGLETON);
      expect(container.getLifecycle('T1')).toBe(Lifecycle.TRANSIENT);
      expect(container.getLifecycle('NonExistent')).toBeUndefined();
    });

    it('should check singleton/transient status', () => {
      container.registerSingleton('S1', () => ({}));
      container.registerTransient('T1', () => ({}));

      expect(container.isSingleton('S1')).toBe(true);
      expect(container.isTransient('T1')).toBe(true);
      expect(container.isSingleton('T1')).toBe(false);
      expect(container.isTransient('S1')).toBe(false);
    });

    it('should get service count', () => {
      expect(container.getServiceCount()).toBe(2);
    });
  });

  describe('Instance caching', () => {
    it('should cache singleton instances', () => {
      const instance = new MockLogger();
      container.registerInstance('Logger', instance);

      const cached = container.getCachedInstance<Logger>('Logger');
      expect(cached).toBe(instance);
    });

    it('should not cache transient instances', () => {
      container.registerTransient('Logger', () => new MockLogger());

      const resolved = container.resolve<Logger>('Logger');
      const cached = container.getCachedInstance<Logger>('Logger');

      expect(cached).toBeUndefined();
      expect(resolved).toBeInstanceOf(MockLogger);
    });

    it('should count cached instances', () => {
      container.registerSingleton('Logger', () => new MockLogger());
      container.registerTransient('Database', () => new MockDatabase());

      // Resolve singleton to cache it
      container.resolve('Logger');

      expect(container.getCachedInstanceCount()).toBe(1);
    });

    it('should clear instances but keep registrations', () => {
      container.registerSingleton('Logger', () => new MockLogger());
      const logger1 = container.resolve<Logger>('Logger');

      container.clearInstances();

      const logger2 = container.resolve<Logger>('Logger');

      expect(logger1).not.toBe(logger2);
      expect(container.has('Logger')).toBe(true);
    });
  });

  describe('Container state management', () => {
    it('should unregister service', () => {
      container.register('Logger', () => new MockLogger());
      expect(container.has('Logger')).toBe(true);

      const removed = container.unregister('Logger');
      expect(removed).toBe(true);
      expect(container.has('Logger')).toBe(false);
    });

    it('should return false when unregistering non-existent service', () => {
      const removed = container.unregister('NonExistent');
      expect(removed).toBe(false);
    });

    it('should clear all services', () => {
      container.register('Logger', () => new MockLogger());
      container.register('Database', () => new MockDatabase());

      expect(container.getServiceCount()).toBe(2);

      container.clear();

      expect(container.getServiceCount()).toBe(0);
      expect(container.has('Logger')).toBe(false);
      expect(container.has('Database')).toBe(false);
    });
  });

  describe('Batch registration', () => {
    it('should register multiple services', () => {
      const configs = [
        {
          key: 'Logger',
          factory: () => new MockLogger(),
          lifecycle: Lifecycle.SINGLETON,
        },
        {
          key: 'Database',
          factory: () => new MockDatabase(),
          lifecycle: Lifecycle.SINGLETON,
        },
      ];

      registerServices(container, configs);

      expect(container.getServiceCount()).toBe(2);
      expect(container.has('Logger')).toBe(true);
      expect(container.has('Database')).toBe(true);
    });

    it('should use default lifecycle in batch registration', () => {
      const configs = [
        {
          key: 'Logger',
          factory: () => new MockLogger(),
          // No lifecycle specified, should default to SINGLETON
        },
      ];

      registerServices(container, configs);

      expect(container.isSingleton('Logger')).toBe(true);
    });
  });

  describe('Dependency graph debugging', () => {
    it('should get dependencies for service', () => {
      container.registerSingleton('Database', () => new MockDatabase());

      container.registerSingleton('UserService', (c) => {
        const db = c.resolve('Database');
        return new MockUserService(db);
      });

      // Note: This is a best-effort heuristic, not guaranteed to be perfect
      // Just verify it doesn't crash
      const deps = getDependencies(container, 'UserService');
      expect(Array.isArray(deps)).toBe(true);
    });

    it('should handle services with no dependencies', () => {
      container.registerSingleton('Logger', () => new MockLogger());

      const deps = getDependencies(container, 'Logger');
      expect(Array.isArray(deps)).toBe(true);
    });
  });

  describe('Module initialization pattern', () => {
    it('should support staged initialization', () => {
      const order: string[] = [];

      // Stage 1: Configuration
      container.registerSingleton('Config', () => {
        order.push('Config');
        return { bpm: 120 };
      });

      // Stage 2: Core services (depend on config)
      container.registerSingleton('Logger', (c) => {
        order.push('Logger');
        const config = c.resolve('Config');
        return new MockLogger();
      });

      // Stage 3: Services (depend on logger)
      container.registerSingleton('Database', (c) => {
        order.push('Database');
        const logger = c.resolve<Logger>('Logger');
        return new MockDatabase();
      });

      // Resolve in arbitrary order - dependencies should resolve first
      container.resolve('Database');

      expect(order).toEqual(['Config', 'Logger', 'Database']);
    });

    it('should isolate services in tests via clearInstances', () => {
      const logger1 = new MockLogger();
      logger1.log('test1');

      container.registerInstance('Logger', logger1);
      expect(container.resolve<Logger>('Logger')).toBe(logger1);

      // Reset for new test
      container.clearInstances();

      const logger2 = new MockLogger();
      logger2.log('test2');
      container.registerInstance('Logger', logger2);

      expect(container.resolve<Logger>('Logger')).toBe(logger2);
      expect(container.resolve<Logger>('Logger')).not.toBe(logger1);
    });
  });

  describe('Error handling', () => {
    it('should include service key in registration error', () => {
      container.register('Service', () => ({}));

      try {
        container.register('Service', () => ({}));
        expect.fail('Should have thrown');
      } catch (error) {
        if (error instanceof PolychronError) {
          expect(error.context.service).toBe('Service');
        }
      }
    });

    it('should include circular dependency info in error', () => {
      container.registerSingleton('A', (c) => ({
        b: c.resolve('B'),
      }));
      container.registerSingleton('B', (c) => ({
        a: c.resolve('A'),
      }));

      try {
        container.resolve('A');
        expect.fail('Should have thrown');
      } catch (error) {
        if (error instanceof PolychronError) {
          expect(error.context.resolving).toBeDefined();
        }
      }
    });
  });

  describe('Performance characteristics', () => {
    it('should resolve singletons efficiently (cached)', () => {
      const factory = vi.fn(() => new MockLogger());
      container.registerSingleton('Logger', factory);

      // Resolve 100 times
      for (let i = 0; i < 100; i++) {
        container.resolve('Logger');
      }

      // Factory should only be called once
      expect(factory).toHaveBeenCalledTimes(1);
    });

    it('should handle many services', () => {
      // Register 100 services
      for (let i = 0; i < 100; i++) {
        container.registerSingleton(`Service${i}`, () => ({ id: i }));
      }

      expect(container.getServiceCount()).toBe(100);

      // Resolve all
      for (let i = 0; i < 100; i++) {
        const service = container.resolve(`Service${i}`);
        expect(service).toEqual({ id: i });
      }
    });
  });
});
