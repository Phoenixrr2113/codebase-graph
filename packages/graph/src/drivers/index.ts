/**
 * Driver exports
 *
 * KuzuDriver uses dynamic import('kuzu') internally, so importing this
 * file does NOT pull in the kuzu native module. The kuzu npm package is
 * only loaded when KuzuDriver.connect() is called.
 */

export { FalkorDBDriver, falkorDialect } from './falkordb';
export { KuzuDriver, kuzuDialect } from './kuzu';
