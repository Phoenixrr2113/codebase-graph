/**
 * @codegraph/logger - Unit tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createLogger, logger, trace, traced, withTrace } from '../src';

describe('Logger', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('createLogger', () => {
    it('should create a logger instance', () => {
      const log = createLogger();
      expect(log.debug).toBeDefined();
      expect(log.info).toBeDefined();
      expect(log.warn).toBeDefined();
      expect(log.error).toBeDefined();
      expect(log.child).toBeDefined();
    });

    it('should respect log level configuration', () => {
      const log = createLogger({ level: 'warn' });
      
      log.debug('debug message');
      log.info('info message');
      log.warn('warn message');
      log.error('error message');
      
      expect(console.debug).not.toHaveBeenCalled();
      expect(console.log).not.toHaveBeenCalled();
      expect(console.warn).toHaveBeenCalledTimes(1);
      expect(console.error).toHaveBeenCalledTimes(1);
    });

    it('should include namespace in output', () => {
      const log = createLogger({ level: 'info', namespace: 'Test' });
      log.info('test message');
      
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[Test]')
      );
    });

    it('should create child loggers with extended namespace', () => {
      const parent = createLogger({ level: 'info', namespace: 'Parent' });
      const child = parent.child('Child');
      
      child.info('child message');
      
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[Parent:Child]')
      );
    });
  });

  describe('default logger', () => {
    it('should export a default logger instance', () => {
      expect(logger).toBeDefined();
      expect(logger.info).toBeDefined();
    });
  });
});

describe('Tracing', () => {
  let debugSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('traced wrapper', () => {
    it('should wrap a function and preserve behavior', () => {
      const fn = (x: number) => x * 2;
      const tracedFn = traced('multiply', fn);
      
      expect(tracedFn(5)).toBe(10);
    });

    it('should handle async functions', async () => {
      const fn = async (x: number) => x * 2;
      const tracedFn = traced('asyncMultiply', fn);
      
      const result = await tracedFn(5);
      expect(result).toBe(10);
    });

    it('should propagate errors', () => {
      const fn = () => { throw new Error('test error'); };
      const tracedFn = traced('failingFn', fn);
      
      expect(() => tracedFn()).toThrow('test error');
    });
  });

  describe('withTrace utility', () => {
    it('should trace inline code blocks', async () => {
      const result = await withTrace('testBlock', () => 42);
      expect(result).toBe(42);
    });

    it('should handle async blocks', async () => {
      const result = await withTrace('asyncBlock', async () => {
        return Promise.resolve(100);
      });
      expect(result).toBe(100);
    });
  });

  describe('@trace decorator', () => {
    it('should be a function', () => {
      expect(typeof trace).toBe('function');
    });
  });
});
