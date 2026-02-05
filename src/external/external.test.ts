import { describe, it, expect, beforeEach, vi } from 'vitest';

import { Services } from '../services/services.ts';

import { ExternalServiceRegistry } from './external.ts';
import type { ExternalServiceDefinition, ServiceClient } from './external.schemas.ts';
import { ServiceNotFoundError, ServiceNotConfiguredError } from './external.errors.ts';

// Mock service definition factory
const createMockDefinition = (
  id: string,
  configured: boolean,
  createClientFn?: () => Promise<ServiceClient>,
): ExternalServiceDefinition => ({
  id,
  name: `Mock ${id}`,
  description: `Mock service ${id}`,
  isConfigured: () => configured,
  createClient:
    createClientFn ??
    (async () => ({
      disconnect: vi.fn().mockResolvedValue(undefined),
    })),
});

describe('ExternalServiceRegistry', () => {
  let services: Services;
  let registry: ExternalServiceRegistry;

  beforeEach(() => {
    services = new Services();
    registry = new ExternalServiceRegistry(services);
  });

  describe('register', () => {
    it('registers a service definition', () => {
      const definition = createMockDefinition('test', true);

      registry.register(definition);

      expect(registry.getDefinition('test')).toBe(definition);
    });

    it('overwrites existing definition with same id', () => {
      const first = createMockDefinition('test', true);
      const second = createMockDefinition('test', false);

      registry.register(first);
      registry.register(second);

      expect(registry.getDefinition('test')).toBe(second);
    });
  });

  describe('unregister', () => {
    it('removes a registered service', () => {
      const definition = createMockDefinition('test', true);
      registry.register(definition);

      const result = registry.unregister('test');

      expect(result).toBe(true);
      expect(registry.getDefinition('test')).toBeUndefined();
    });

    it('returns false for non-existent service', () => {
      const result = registry.unregister('nonexistent');

      expect(result).toBe(false);
    });
  });

  describe('listAll', () => {
    it('returns all registered services', () => {
      const def1 = createMockDefinition('service1', true);
      const def2 = createMockDefinition('service2', false);

      registry.register(def1);
      registry.register(def2);

      const all = registry.listAll();

      expect(all).toHaveLength(2);
      expect(all).toContain(def1);
      expect(all).toContain(def2);
    });

    it('returns empty array when no services registered', () => {
      expect(registry.listAll()).toEqual([]);
    });
  });

  describe('isConfigured', () => {
    it('returns true for configured service', () => {
      registry.register(createMockDefinition('test', true));

      expect(registry.isConfigured('test')).toBe(true);
    });

    it('returns false for unconfigured service', () => {
      registry.register(createMockDefinition('test', false));

      expect(registry.isConfigured('test')).toBe(false);
    });

    it('returns false for unknown service', () => {
      expect(registry.isConfigured('unknown')).toBe(false);
    });
  });

  describe('areServicesMet', () => {
    it('returns true when all services are configured', () => {
      registry.register(createMockDefinition('service1', true));
      registry.register(createMockDefinition('service2', true));

      expect(registry.areServicesMet(['service1', 'service2'])).toBe(true);
    });

    it('returns false when any service is not configured', () => {
      registry.register(createMockDefinition('service1', true));
      registry.register(createMockDefinition('service2', false));

      expect(registry.areServicesMet(['service1', 'service2'])).toBe(false);
    });

    it('returns false when any service is not registered', () => {
      registry.register(createMockDefinition('service1', true));

      expect(registry.areServicesMet(['service1', 'unknown'])).toBe(false);
    });

    it('returns true for empty array', () => {
      expect(registry.areServicesMet([])).toBe(true);
    });
  });

  describe('getStatus', () => {
    it('returns status for configured service', () => {
      registry.register(createMockDefinition('test', true));

      const status = registry.getStatus('test');

      expect(status).toEqual({
        serviceId: 'test',
        serviceName: 'Mock test',
        configured: true,
        connectionStatus: 'unknown',
      });
    });

    it('returns connected status for service with client', async () => {
      registry.register(createMockDefinition('test', true));
      await registry.getClient('test');

      const status = registry.getStatus('test');

      expect(status.connectionStatus).toBe('connected');
    });

    it('returns error status for unknown service', () => {
      const status = registry.getStatus('unknown');

      expect(status).toEqual({
        serviceId: 'unknown',
        serviceName: 'Unknown',
        configured: false,
        connectionStatus: 'unknown',
        errorMessage: 'Service not found: unknown',
      });
    });
  });

  describe('getClient', () => {
    it('creates and returns a client for configured service', async () => {
      const mockClient = { disconnect: vi.fn().mockResolvedValue(undefined) };
      const definition = createMockDefinition('test', true, async () => mockClient);
      registry.register(definition);

      const client = await registry.getClient('test');

      expect(client).toBe(mockClient);
    });

    it('caches client on subsequent calls', async () => {
      const createClient = vi.fn().mockResolvedValue({ disconnect: vi.fn() });
      const definition = createMockDefinition('test', true, createClient);
      registry.register(definition);

      const first = await registry.getClient('test');
      const second = await registry.getClient('test');

      expect(first).toBe(second);
      expect(createClient).toHaveBeenCalledTimes(1);
    });

    it('throws ServiceNotFoundError for unknown service', async () => {
      await expect(registry.getClient('unknown')).rejects.toThrow(ServiceNotFoundError);
    });

    it('throws ServiceNotConfiguredError for unconfigured service', async () => {
      registry.register(createMockDefinition('test', false));

      await expect(registry.getClient('test')).rejects.toThrow(ServiceNotConfiguredError);
    });
  });

  describe('hasClient', () => {
    it('returns false before client is created', () => {
      registry.register(createMockDefinition('test', true));

      expect(registry.hasClient('test')).toBe(false);
    });

    it('returns true after client is created', async () => {
      registry.register(createMockDefinition('test', true));
      await registry.getClient('test');

      expect(registry.hasClient('test')).toBe(true);
    });
  });

  describe('disconnectClient', () => {
    it('disconnects and removes cached client', async () => {
      const disconnect = vi.fn().mockResolvedValue(undefined);
      const definition = createMockDefinition('test', true, async () => ({ disconnect }));
      registry.register(definition);

      await registry.getClient('test');
      expect(registry.hasClient('test')).toBe(true);

      await registry.disconnectClient('test');

      expect(disconnect).toHaveBeenCalled();
      expect(registry.hasClient('test')).toBe(false);
    });

    it('does nothing for service without client', async () => {
      registry.register(createMockDefinition('test', true));

      await expect(registry.disconnectClient('test')).resolves.toBeUndefined();
    });
  });

  describe('listStatuses', () => {
    it('returns statuses for all registered services', () => {
      registry.register(createMockDefinition('service1', true));
      registry.register(createMockDefinition('service2', false));

      const statuses = registry.listStatuses();

      expect(statuses).toHaveLength(2);
      expect(statuses.find((s) => s.serviceId === 'service1')?.configured).toBe(true);
      expect(statuses.find((s) => s.serviceId === 'service2')?.configured).toBe(false);
    });
  });
});
