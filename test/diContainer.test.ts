/**
 * DIContainer Tests
 * Verify registration, retrieval, lifecycle management, and isolation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  DIContainer,
  getGlobalContainer,
  setGlobalContainer,
  resetGlobalContainer,
} from '../src/DIContainer.js';

describe('DIContainer', () => {
  let container;

  beforeEach(() => {
    container = new DIContainer();
    resetGlobalContainer();
  });

  afterEach(() => {
    container.clear();
    resetGlobalContainer();
  });

  describe('register()', () => {
    it('should register a service with singleton lifecycle by default', () => {
      const factory = () => ({ value: 42 });
      container.register('config', factory);

      expect(container.has('config')).toBe(true);
      expect(container.getServiceCount()).toBe(1);
    });

    it('should register a service with explicit lifecycle', () => {
      const factory = () => ({ value: 42 });
      container.register('transientService', factory, 'transient');

      expect(container.has('transientService')).toBe(true);
    });

    it('should throw when registering duplicate service key', () => {
      const factory = () => ({ value: 42 });
      container.register('config', factory);

      expect(() => {
        container.register('config', factory);
      }).toThrow(`Service 'config' is already registered`);
    });

    it('should accept any factory function', () => {
      class MyService {
        getValue() {
          return 42;
        }
      }
      container.register('service', () => new MyService());

      const service = container.get('service');
      expect(service.getValue()).toBe(42);
    });
  });

  describe('get()', () => {
    it('should retrieve registered singleton service', () => {
      const config = { bpm: 120 };
      container.register('config', () => config);

      const retrieved = container.get('config');
      expect(retrieved).toBe(config);
    });

    it('should return same instance for singleton services', () => {
      const counter = { count: 0 };
      const factory = () => {
        counter.count++;
        return { id: counter.count };
      };
      container.register('singleton', factory, 'singleton');

      const instance1 = container.get('singleton');
      const instance2 = container.get('singleton');

      expect(instance1).toBe(instance2);
      expect(instance1.id).toBe(1);
      expect(counter.count).toBe(1);
    });

    it('should return new instance each time for transient services', () => {
      const counter = { count: 0 };
      const factory = () => {
        counter.count++;
        return { id: counter.count };
      };
      container.register('transient', factory, 'transient');

      const instance1 = container.get('transient');
      const instance2 = container.get('transient');

      expect(instance1).not.toBe(instance2);
      expect(instance1.id).toBe(1);
      expect(instance2.id).toBe(2);
      expect(counter.count).toBe(2);
    });

    it('should throw when getting unregistered service', () => {
      expect(() => {
        container.get('nonexistent');
      }).toThrow(`Service 'nonexistent' not found in container`);
    });
  });

  describe('has()', () => {
    it('should return true for registered service', () => {
      container.register('config', () => ({}));
      expect(container.has('config')).toBe(true);
    });

    it('should return false for unregistered service', () => {
      expect(container.has('nonexistent')).toBe(false);
    });
  });

  describe('clear()', () => {
    it('should remove all services and singletons', () => {
      container.register('service1', () => ({}));
      container.register('service2', () => ({}));

      container.get('service1');
      container.get('service2');

      expect(container.getServiceCount()).toBe(2);

      container.clear();

      expect(container.getServiceCount()).toBe(0);
      expect(container.has('service1')).toBe(false);
      expect(container.has('service2')).toBe(false);
    });

    it('should allow re-registering after clear', () => {
      const factory = () => ({});
      container.register('service', factory);
      container.clear();

      container.register('service', factory);
      expect(container.has('service')).toBe(true);
    });
  });

  describe('getServiceKeys()', () => {
    it('should return array of all registered service keys', () => {
      container.register('config', () => ({}));
      container.register('logger', () => ({}));
      container.register('db', () => ({}));

      const keys = container.getServiceKeys();
      expect(keys).toContain('config');
      expect(keys).toContain('logger');
      expect(keys).toContain('db');
      expect(keys.length).toBe(3);
    });

    it('should return empty array when no services registered', () => {
      const keys = container.getServiceKeys();
      expect(keys).toEqual([]);
    });
  });

  describe('getServiceCount()', () => {
    it('should return count of registered services', () => {
      expect(container.getServiceCount()).toBe(0);

      container.register('service1', () => ({}));
      expect(container.getServiceCount()).toBe(1);

      container.register('service2', () => ({}));
      expect(container.getServiceCount()).toBe(2);
    });
  });

  describe('Lifecycle Management', () => {
    it('should isolate singleton instances between containers', () => {
      const container1 = new DIContainer();
      const container2 = new DIContainer();

      const value1 = { id: 1 };
      const value2 = { id: 2 };

      container1.register('service', () => value1);
      container2.register('service', () => value2);

      const retrieved1 = container1.get('service');
      const retrieved2 = container2.get('service');

      expect(retrieved1).toBe(value1);
      expect(retrieved2).toBe(value2);
      expect(retrieved1).not.toBe(retrieved2);
    });

    it('should cache only singletons, not transients', () => {
      const callLog = [];

      container.register('singleton', () => {
        callLog.push('singleton');
        return {};
      }, 'singleton');

      container.register('transient', () => {
        callLog.push('transient');
        return {};
      }, 'transient');

      container.get('singleton');
      container.get('singleton');
      container.get('transient');
      container.get('transient');

      expect(callLog).toEqual(['singleton', 'transient', 'transient']);
    });
  });

  describe('Global Container', () => {
    it('should return same global instance on repeated calls', () => {
      const container1 = getGlobalContainer();
      const container2 = getGlobalContainer();

      expect(container1).toBe(container2);
    });

    it('should register and retrieve from global container', () => {
      const globalContainer = getGlobalContainer();
      globalContainer.register('config', () => ({ bpm: 120 }));

      const retrieved = globalContainer.get('config');
      expect(retrieved.bpm).toBe(120);
    });

    it('should allow setting custom global container', () => {
      const customContainer = new DIContainer();
      customContainer.register('custom', () => ({ value: 'custom' }));

      setGlobalContainer(customContainer);

      const globalContainer = getGlobalContainer();
      expect(globalContainer).toBe(customContainer);
      expect(globalContainer.has('custom')).toBe(true);
    });

    it('should reset global container to null', () => {
      const container1 = getGlobalContainer();
      container1.register('service', () => ({}));

      resetGlobalContainer();

      const container2 = getGlobalContainer();
      expect(container1).not.toBe(container2);
      expect(container2.has('service')).toBe(false);
    });

    it('should isolate global container after reset', () => {
      const container1 = getGlobalContainer();
      container1.register('service1', () => ({}));

      resetGlobalContainer();

      const container2 = getGlobalContainer();
      container2.register('service2', () => ({}));

      expect(container2.has('service1')).toBe(false);
      expect(container2.has('service2')).toBe(true);
    });
  });

  describe('Integration Scenarios', () => {
    it('should handle mixed singleton and transient services', () => {
      class Logger {
        id: number;
        constructor() {
          this.id = Math.random();
        }
      }

      class Database {
        logger: Logger;
        constructor(logger: Logger) {
          this.logger = logger;
        }
      }

      container.register('logger', () => new Logger(), 'transient');
      container.register('db', () => new Database(container.get('logger')), 'transient');

      const db1 = container.get('db');
      const db2 = container.get('db');

      expect(db1).not.toBe(db2); // Both transient, so different instances
      expect(db1.logger).not.toBe(db2.logger); // Each database gets its own transient logger
    });

    it('should support service factory with dependencies', () => {
      const config = { bpm: 120 };
      container.register('config', () => config);
      container.register('composer', () => ({
        config: container.get('config'),
        compose: () => 'music',
      }));

      const composer = container.get('composer');
      expect(composer.config).toBe(config);
      expect(composer.compose()).toBe('music');
    });

    it('should handle complex service hierarchies', () => {
      // Simulate a hierarchy: App -> Stage -> FxManager -> Config
      const config = { scale: 'C Major' };

      container.register('config', () => config);
      container.register('fxManager', () => ({
        config: container.get('config'),
      }));
      container.register('stage', () => ({
        fx: container.get('fxManager'),
      }));
      container.register('app', () => ({
        stage: container.get('stage'),
      }));

      const app = container.get('app');
      expect(app.stage.fx.config.scale).toBe('C Major');
    });

    it('should maintain isolation for testing', () => {
      const container1 = new DIContainer();
      const container2 = new DIContainer();

      container1.register('state', () => ({ calls: 0 }), 'singleton');
      container2.register('state', () => ({ calls: 0 }), 'singleton');

      const state1a = container1.get('state');
      const state1b = container1.get('state');
      const state2a = container2.get('state');

      state1a.calls++;
      expect(state1b.calls).toBe(1);
      expect(state2a.calls).toBe(0);
    });
  });
});
