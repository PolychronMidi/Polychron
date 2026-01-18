import { describe, it, expect, beforeEach } from 'vitest';
import { CompositionEventBusImpl } from '../src/CompositionProgress';
import type { ProgressCallback } from '../src/CompositionProgress';

describe('CompositionProgress', () => {
  let eventBus: CompositionEventBusImpl;

  beforeEach(() => {
    eventBus = new CompositionEventBusImpl();
  });

  it('should create event bus instance', () => {
    expect(eventBus).toBeDefined();
    expect(typeof eventBus.on).toBe('function');
    expect(typeof eventBus.emit).toBe('function');
  });

  it('should register progress listener', () => {
    const callback: ProgressCallback = () => {};
    eventBus.on('progress', callback);
    expect(eventBus).toBeDefined();
  });

  it('should emit progress events', () => {
    let called = false;
    const callback: ProgressCallback = () => { called = true; };
    
    eventBus.on('progress', callback);
    eventBus.emit('progress', {
      phase: 'initialization',
      progress: 0,
      message: 'Starting',
    });

    expect(called).toBe(true);
  });

  it('should pass correct data to listeners', () => {
    let receivedData: any = null;
    const callback: ProgressCallback = (data) => { receivedData = data; };
    
    eventBus.on('progress', callback);
    eventBus.emit('progress', {
      phase: 'composing',
      progress: 0.5,
      message: 'Composing measures',
    });

    expect(receivedData).toBeDefined();
    expect(receivedData.phase).toBe('composing');
    expect(receivedData.progress).toBe(0.5);
  });

  it('should support multiple listeners', () => {
    let count = 0;
    const callback1: ProgressCallback = () => { count++; };
    const callback2: ProgressCallback = () => { count++; };
    
    eventBus.on('progress', callback1);
    eventBus.on('progress', callback2);
    eventBus.emit('progress', {
      phase: 'rendering',
      progress: 1,
      message: 'Complete',
    });

    expect(count).toBe(2);
  });
});
