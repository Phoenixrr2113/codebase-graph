/**
 * Driver exports + auto-registration
 */

export { FalkorDBDriver, falkorDialect } from './falkordb';

// Auto-register built-in drivers
import { registerDriver } from '../driver-registry';
import { FalkorDBDriver } from './falkordb';
import { FalkorDBLiteDriver } from './falkordblite';

registerDriver('falkordb', () => new FalkorDBDriver());
registerDriver('falkordblite', () => new FalkorDBLiteDriver());
