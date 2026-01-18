import { describe, it, expect } from 'vitest';
import {
  DIContainer,
  getGlobalContainer,
} from '../src/DIContainer';

describe('DIContainer', () => {
  it('should create container instance', () => {
    const container = new DIContainer();
    expect(container).toBeDefined();
  });

  it('should register and resolve services', () => {
    const container = new DIContainer();
    const service = { name: 'test' };
    container.register('testService', () => service);
    expect(container.get('testService')).toBe(service);
  });

  it('should have global container', () => {
    const global = getGlobalContainer();
    expect(global).toBeDefined();
    expect(global).toBeInstanceOf(DIContainer);
  });

  it('should isolate container instances', () => {
    const container1 = new DIContainer();
    const container2 = new DIContainer();
    
    container1.register('service', () => ({ id: 1 }));
    container2.register('service', () => ({ id: 2 }));
    
    expect((container1.get('service') as any).id).toBe(1);
    expect((container2.get('service') as any).id).toBe(2);
  });
});
