/**
 * Services container for dependency injection.
 *
 * Provides lazy instantiation of services with get/set/destroy pattern.
 * Services receive the container and resolve dependencies lazily in methods.
 */

const destroySymbol = Symbol('destroy');

type ServiceConstructor<T> = new (services: Services) => T;

type Destroyable = {
  [destroySymbol]?: () => Promise<void>;
};

class Services {
  #instances = new Map<ServiceConstructor<unknown>, unknown>();

  /**
   * Gets or creates a service instance.
   * Services are instantiated lazily on first access.
   */
  get = <T>(service: ServiceConstructor<T>): T => {
    if (!this.#instances.has(service)) {
      this.#instances.set(service, new service(this));
    }
    return this.#instances.get(service) as T;
  };

  /**
   * Sets a service instance directly.
   * Useful for testing with mocks or custom implementations.
   */
  set = <T>(service: ServiceConstructor<T>, instance: T): void => {
    this.#instances.set(service, instance);
  };

  /**
   * Checks if a service has been instantiated.
   */
  has = <T>(service: ServiceConstructor<T>): boolean => {
    return this.#instances.has(service);
  };

  /**
   * Destroys all service instances that implement the destroy symbol.
   * Call this during application shutdown.
   */
  destroy = async (): Promise<void> => {
    const destroyPromises = Array.from(this.#instances.values()).map(async (instance) => {
      if (instance && typeof instance === 'object' && destroySymbol in instance) {
        const destroyable = instance as Destroyable;
        if (typeof destroyable[destroySymbol] === 'function') {
          await destroyable[destroySymbol]();
        }
      }
    });
    await Promise.all(destroyPromises);
    this.#instances.clear();
  };
}

export type { ServiceConstructor, Destroyable };
export { Services, destroySymbol };
