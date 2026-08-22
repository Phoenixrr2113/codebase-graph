export const EXTERNAL_FALKORDB_GUIDANCE =
  'Embedded FalkorDBLite is unavailable on this platform. Set CODEGRAPH_DRIVER=falkordb and FALKORDB_URL, or configure FALKORDB_HOST and FALKORDB_PORT.';

function requireContract(condition, message) {
  if (!condition) throw new Error(message);
}

export function assertBlockedStorage(storage, label) {
  requireContract(storage?.ownerState === 'blocked', `${label} did not report blocked storage`);
  requireContract(storage?.driver === 'falkordb', `${label} did not select external FalkorDB`);
  requireContract(
    storage?.externalGuidance === EXTERNAL_FALKORDB_GUIDANCE,
    `${label} guidance did not match the frozen contract`,
  );
}

export function assertUnsupportedMcpStatus(status) {
  requireContract(
    status?.configured === false && status?.setupRequired === true && status?.error === undefined,
    'unsupported MCP status did not remain setup-safe',
  );
  requireContract(
    status.setup?.storage?.embeddedSupported === false,
    'unsupported MCP status reported embedded storage support',
  );
  assertBlockedStorage(status.setup?.storage, 'MCP status');
}
