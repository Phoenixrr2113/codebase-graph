/**
 * Driver exports + auto-registration
 *
 * KuzuDriver uses dynamic import('kuzu') internally, so importing this
 * file does NOT pull in the kuzu native module. The kuzu npm package is
 * only loaded when KuzuDriver.connect() is called.
 */

export { FalkorDBDriver, falkorDialect } from './falkordb';
export { KuzuDriver, kuzuDialect } from './kuzu';

// Auto-register built-in drivers
import { registerDriver } from '../driver-registry';
import { FalkorDBDriver } from './falkordb';
import { FalkorDBLiteDriver } from './falkordblite';

registerDriver('falkordb', () => new FalkorDBDriver());
registerDriver('falkordblite', () => new FalkorDBLiteDriver());
