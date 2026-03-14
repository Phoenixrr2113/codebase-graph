/**
 * Driver Registry — pluggable database driver registration.
 *
 * Allows new drivers (Neo4j, Memgraph, LanceDB) to be added without
 * modifying core client code. Each driver registers a factory function.
 */

import type { DatabaseDriver, DriverConfig } from './driver';

export type DriverFactory = (config: DriverConfig) => DatabaseDriver;

const registry = new Map<string, DriverFactory>();

/**
 * Register a database driver factory.
 * Call this at module load to make a driver available.
 */
export function registerDriver(name: string, factory: DriverFactory): void {
  registry.set(name, factory);
}

/**
 * Create a driver instance by name.
 * Throws if the driver is not registered.
 */
export function createDriver(config: DriverConfig): DatabaseDriver {
  const factory = registry.get(config.driver);
  if (!factory) {
    const available = Array.from(registry.keys()).join(', ');
    throw new Error(`Unknown driver "${config.driver}". Available: ${available || 'none registered'}`);
  }
  return factory(config);
}

/**
 * Get all registered driver names.
 */
export function getRegisteredDrivers(): string[] {
  return Array.from(registry.keys());
}
