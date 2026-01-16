import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  IModuleInitializer,
  ModuleRegistry,
  INIT_PRIORITIES,
} from '../src/ModuleInitializer';
import { PolychronError, ErrorCode } from '../src/PolychronError';
import { PolychronContext } from '../src/PolychronContext';

/**
 * Mock module for testing
 */
class MockModule implements IModuleInitializer {
  name: string;
  priority: number;
  validateConfigCalls = 0;
  initCalls = 0;
  destroyCalls = 0;
  shouldValidateFail = false;
  shouldInitFail = false;

  constructor(name: string, priority: number) {
    this.name = name;
    this.priority = priority;
  }

  validateConfig(context: PolychronContext): boolean {
    this.validateConfigCalls++;
    if (this.shouldValidateFail) {
      return false;
    }
    return true;
  }

  init(context: PolychronContext): void {
    this.initCalls++;
    if (this.shouldInitFail) {
      throw new Error(`Intentional init failure in ${this.name}`);
    }
  }

  destroy(): void {
    this.destroyCalls++;
  }
}

describe('Module Initialization System', () => {
  let registry: ModuleRegistry;
  let context: PolychronContext;

  beforeEach(() => {
    // Clear the singleton completely
    const current = ModuleRegistry.getInstance();
    current.clear();
    registry = current;
    // Mock context (minimal implementation)
    context = {} as PolychronContext;
  });

  afterEach(() => {
    registry.clear();
  });

  describe('ModuleRegistry singleton', () => {
    it('should return same instance on multiple calls', () => {
      const instance1 = ModuleRegistry.getInstance();
      const instance2 = ModuleRegistry.getInstance();
      expect(instance1).toBe(instance2);
    });

    it('should start with empty registry', () => {
      expect(registry.getAllModules()).toHaveLength(0);
    });
  });

  describe('Module registration', () => {
    it('should register a module', () => {
      const mod = new MockModule('test', 10);
      registry.register(mod);
      expect(registry.getModule('test')).toBe(mod);
    });

    it('should register multiple modules', () => {
      const mod1 = new MockModule('mod1', 10);
      const mod2 = new MockModule('mod2', 20);
      registry.register(mod1);
      registry.register(mod2);
      expect(registry.getAllModules()).toHaveLength(2);
    });

    it('should throw on duplicate registration', () => {
      const mod = new MockModule('test', 10);
      registry.register(mod);
      expect(() => registry.register(mod)).toThrow(PolychronError);
      expect(() => registry.register(mod)).toThrow(
        'Module already registered: test'
      );
    });

    it('should return undefined for unregistered module', () => {
      expect(registry.getModule('nonexistent')).toBeUndefined();
    });
  });

  describe('Module priority ordering', () => {
    it('should sort modules by priority ascending', () => {
      const mod3 = new MockModule('mod3', 30);
      const mod1 = new MockModule('mod1', 10);
      const mod2 = new MockModule('mod2', 20);

      registry.register(mod3);
      registry.register(mod1);
      registry.register(mod2);

      const sorted = registry.getAllModules();
      expect(sorted[0].name).toBe('mod1');
      expect(sorted[1].name).toBe('mod2');
      expect(sorted[2].name).toBe('mod3');
    });

    it('should initialize modules in priority order', () => {
      const initOrder: string[] = [];
      const mod1 = new MockModule('mod1', 30);
      const mod2 = new MockModule('mod2', 10);
      const mod3 = new MockModule('mod3', 20);

      // Wrap init to track order
      const orig1 = mod1.init.bind(mod1);
      const orig2 = mod2.init.bind(mod2);
      const orig3 = mod3.init.bind(mod3);

      mod1.init = (ctx) => {
        initOrder.push('mod1');
        orig1(ctx);
      };
      mod2.init = (ctx) => {
        initOrder.push('mod2');
        orig2(ctx);
      };
      mod3.init = (ctx) => {
        initOrder.push('mod3');
        orig3(ctx);
      };

      registry.register(mod1);
      registry.register(mod2);
      registry.register(mod3);

      registry.initAll(context);

      expect(initOrder).toEqual(['mod2', 'mod3', 'mod1']);
    });
  });

  describe('Module initialization lifecycle', () => {
    it('should call validateConfig before init on each module', () => {
      const mod = new MockModule('test', 10);
      registry.register(mod);

      registry.initAll(context);

      expect(mod.validateConfigCalls).toBe(1);
      expect(mod.initCalls).toBe(1);
    });

    it('should mark modules as initialized', () => {
      const mod1 = new MockModule('mod1', 10);
      const mod2 = new MockModule('mod2', 20);
      registry.register(mod1);
      registry.register(mod2);

      expect(registry.isAllInitialized()).toBe(false);
      registry.initAll(context);
      expect(registry.isAllInitialized()).toBe(true);
      expect(registry.getInitializedModules()).toEqual(['mod1', 'mod2']);
    });

    it('should throw if initAll called twice', () => {
      const mod = new MockModule('test', 10);
      registry.register(mod);

      registry.initAll(context);
      expect(() => registry.initAll(context)).toThrow(PolychronError);
      expect(() => registry.initAll(context)).toThrow(
        'already initialized'
      );
    });
  });

  describe('Configuration validation', () => {
    it('should throw if module validation fails', () => {
      const mod = new MockModule('test', 10);
      mod.shouldValidateFail = true;
      registry.register(mod);

      expect(() => registry.initAll(context)).toThrow(PolychronError);
      expect(() => registry.initAll(context)).toThrow(
        'validation failed: test'
      );
    });

    it('should validate all modules before initializing any', () => {
      const mod1 = new MockModule('mod1', 10);
      const mod2 = new MockModule('mod2', 20);
      mod2.shouldValidateFail = true;

      registry.register(mod1);
      registry.register(mod2);

      expect(() => registry.initAll(context)).toThrow();
      // mod1 should be validated but not initialized
      expect(mod1.validateConfigCalls).toBe(1);
      expect(mod1.initCalls).toBe(0);
    });
  });

  describe('Error handling and rollback', () => {
    it('should destroy initialized modules on init failure', () => {
      const mod1 = new MockModule('mod1', 10);
      const mod2 = new MockModule('mod2', 20);
      const mod3 = new MockModule('mod3', 30);

      mod2.shouldInitFail = true;

      registry.register(mod1);
      registry.register(mod2);
      registry.register(mod3);

      expect(() => registry.initAll(context)).toThrow(PolychronError);

      // mod1 was initialized and should be destroyed
      expect(mod1.initCalls).toBe(1);
      expect(mod1.destroyCalls).toBe(1);

      // mod2 failed, should not be destroyed (never fully initialized)
      expect(mod2.initCalls).toBe(1);
      expect(mod2.destroyCalls).toBe(0);

      // mod3 should not be initialized or destroyed
      expect(mod3.initCalls).toBe(0);
      expect(mod3.destroyCalls).toBe(0);
    });

    it('should destroy modules in reverse init order during rollback', () => {
      const destroyOrder: string[] = [];
      const mod1 = new MockModule('mod1', 10);
      const mod2 = new MockModule('mod2', 20);
      const mod3 = new MockModule('mod3', 30);

      mod3.shouldInitFail = true;

      // Wrap destroy to track order while still counting
      const orig1Destroy = mod1.destroy.bind(mod1);
      const orig2Destroy = mod2.destroy.bind(mod2);

      mod1.destroy = () => {
        destroyOrder.push('mod1');
        orig1Destroy();
      };
      mod2.destroy = () => {
        destroyOrder.push('mod2');
        orig2Destroy();
      };

      registry.register(mod1);
      registry.register(mod2);
      registry.register(mod3);

      expect(() => registry.initAll(context)).toThrow();

      // Should destroy in reverse order: mod2, mod1
      expect(destroyOrder).toEqual(['mod2', 'mod1']);
    });

    it('should continue destroying modules even if one destroy fails', () => {
      const mod1 = new MockModule('mod1', 10);
      const mod2 = new MockModule('mod2', 20);

      mod2.shouldInitFail = true;
      const origDestroy = mod1.destroy.bind(mod1);
      mod1.destroy = () => {
        origDestroy();
        throw new Error('Destroy failed');
      };

      registry.register(mod1);
      registry.register(mod2);

      // Should throw but not crash during rollback
      expect(() => registry.initAll(context)).toThrow();
      expect(mod1.destroyCalls).toBe(1);
    });

    it('should not be marked as initialized after failed init', () => {
      const mod = new MockModule('test', 10);
      mod.shouldInitFail = true;
      registry.register(mod);

      expect(() => registry.initAll(context)).toThrow();
      expect(registry.isAllInitialized()).toBe(false);
      expect(registry.getInitializedModules()).toHaveLength(0);
    });
  });

  describe('Registry reset and clear', () => {
    it('should reset to uninitialized state', () => {
      const mod = new MockModule('test', 10);
      registry.register(mod);
      registry.initAll(context);

      expect(registry.isAllInitialized()).toBe(true);

      registry.reset();

      expect(registry.isAllInitialized()).toBe(false);
      expect(mod.destroyCalls).toBe(1);
    });

    it('should clear all modules', () => {
      const mod1 = new MockModule('mod1', 10);
      const mod2 = new MockModule('mod2', 20);
      registry.register(mod1);
      registry.register(mod2);

      registry.clear();

      expect(registry.getAllModules()).toHaveLength(0);
      expect(registry.getModule('mod1')).toBeUndefined();
      expect(registry.getModule('mod2')).toBeUndefined();
    });

    it('should allow re-registration after clear', () => {
      const mod1 = new MockModule('mod1', 10);
      registry.register(mod1);
      registry.clear();

      const mod2 = new MockModule('mod1', 20);
      registry.register(mod2);

      expect(registry.getModule('mod1')).toBe(mod2);
    });
  });

  describe('Error wrapping', () => {
    it('should wrap module init errors in PolychronError', () => {
      const mod = new MockModule('test', 10);
      mod.shouldInitFail = true;
      registry.register(mod);

      try {
        registry.initAll(context);
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(PolychronError);
        if (error instanceof PolychronError) {
          expect(error.code).toBe(ErrorCode.INITIALIZATION_ERROR);
          expect(error.context.module).toBe('test');
        }
      }
    });
  });

  describe('INIT_PRIORITIES constants', () => {
    it('should define sensible priority order', () => {
      expect(INIT_PRIORITIES.CONFIG).toBeLessThan(INIT_PRIORITIES.EVENT_BUS);
      expect(INIT_PRIORITIES.EVENT_BUS).toBeLessThan(
        INIT_PRIORITIES.LAYER_MANAGER
      );
      expect(INIT_PRIORITIES.LAYER_MANAGER).toBeLessThan(INIT_PRIORITIES.STAGE);
      expect(INIT_PRIORITIES.STAGE).toBeLessThan(INIT_PRIORITIES.FX_MANAGER);
      expect(INIT_PRIORITIES.FX_MANAGER).toBeLessThan(INIT_PRIORITIES.WRITERS);
    });
  });

  describe('Cross-module dependency handling', () => {
    it('should initialize modules that depend on previous modules', () => {
      const mod1 = new MockModule('config', INIT_PRIORITIES.CONFIG);
      const mod2 = new MockModule(
        'stage',
        INIT_PRIORITIES.STAGE
      );
      let mod1Ready = false;

      // Wrap init to track state
      const orig1Init = mod1.init.bind(mod1);
      const orig2Init = mod2.init.bind(mod2);

      mod1.init = (ctx) => {
        orig1Init(ctx);
        mod1Ready = true;
      };

      mod2.init = (ctx) => {
        // This runs after mod1, so mod1 should be ready
        expect(mod1Ready).toBe(true);
        orig2Init(ctx);
      };

      registry.register(mod1);
      registry.register(mod2);

      registry.initAll(context);
      expect(mod1.initCalls).toBe(1);
      expect(mod2.initCalls).toBe(1);
    });
  });
});
