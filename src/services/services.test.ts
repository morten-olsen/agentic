import { describe, it, expect, beforeEach } from 'vitest';

import { Services, destroySymbol } from './services.ts';

class MockService {
  #services: Services;
  value = 'test';

  constructor(services: Services) {
    this.#services = services;
  }

  getServices = (): Services => this.#services;
}

class DestroyableService {
  destroyed = false;

  // eslint-disable-next-line @typescript-eslint/no-empty-function, @typescript-eslint/no-useless-constructor, @typescript-eslint/no-unused-vars -- Test class requires Services signature
  constructor(_services: Services) {}

  [destroySymbol] = async (): Promise<void> => {
    this.destroyed = true;
  };
}

class DependentService {
  #services: Services;

  constructor(services: Services) {
    this.#services = services;
  }

  getMock = (): MockService => {
    return this.#services.get(MockService);
  };
}

describe('Services', () => {
  let services: Services;

  beforeEach(() => {
    services = new Services();
  });

  describe('get', () => {
    it('creates a service instance on first access', () => {
      const instance = services.get(MockService);

      expect(instance).toBeInstanceOf(MockService);
      expect(instance.value).toBe('test');
    });

    it('returns the same instance on subsequent access', () => {
      const first = services.get(MockService);
      const second = services.get(MockService);

      expect(first).toBe(second);
    });

    it('passes the Services container to the constructor', () => {
      const instance = services.get(MockService);

      expect(instance.getServices()).toBe(services);
    });

    it('allows services to resolve other services lazily', () => {
      const dependent = services.get(DependentService);
      const mock = dependent.getMock();

      expect(mock).toBeInstanceOf(MockService);
      expect(services.get(MockService)).toBe(mock);
    });
  });

  describe('set', () => {
    it('sets a custom instance for a service', () => {
      const customInstance = new MockService(services);
      customInstance.value = 'custom';

      services.set(MockService, customInstance);

      expect(services.get(MockService)).toBe(customInstance);
      expect(services.get(MockService).value).toBe('custom');
    });

    it('allows setting mock instances for testing', () => {
      const mockInstance = { value: 'mocked' } as unknown as MockService;

      services.set(MockService, mockInstance);

      expect(services.get(MockService).value).toBe('mocked');
    });
  });

  describe('has', () => {
    it('returns false for non-instantiated services', () => {
      expect(services.has(MockService)).toBe(false);
    });

    it('returns true for instantiated services', () => {
      services.get(MockService);

      expect(services.has(MockService)).toBe(true);
    });

    it('returns true for set services', () => {
      services.set(MockService, new MockService(services));

      expect(services.has(MockService)).toBe(true);
    });
  });

  describe('destroy', () => {
    it('calls destroy symbol on destroyable services', async () => {
      const instance = services.get(DestroyableService);

      expect(instance.destroyed).toBe(false);

      await services.destroy();

      expect(instance.destroyed).toBe(true);
    });

    it('clears all instances after destroy', async () => {
      services.get(MockService);
      services.get(DestroyableService);

      await services.destroy();

      expect(services.has(MockService)).toBe(false);
      expect(services.has(DestroyableService)).toBe(false);
    });

    it('handles services without destroy symbol', async () => {
      services.get(MockService);

      await expect(services.destroy()).resolves.toBeUndefined();
    });

    it('handles multiple destroyable services', async () => {
      const first = services.get(DestroyableService);

      class AnotherDestroyable {
        destroyed = false;
        // eslint-disable-next-line @typescript-eslint/no-empty-function, @typescript-eslint/no-useless-constructor, @typescript-eslint/no-unused-vars -- Test class requires Services signature
        constructor(_services: Services) {}
        [destroySymbol] = async (): Promise<void> => {
          this.destroyed = true;
        };
      }

      services.set(AnotherDestroyable, new AnotherDestroyable(services));
      const second = services.get(AnotherDestroyable);

      await services.destroy();

      expect(first.destroyed).toBe(true);
      expect(second.destroyed).toBe(true);
    });
  });
});
