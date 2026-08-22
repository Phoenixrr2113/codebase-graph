import { getSetupStatus } from '@codegraph/core';

type SetupStatus = Awaited<ReturnType<typeof getSetupStatus>>;
export type SetupStorageStatus = SetupStatus['storage'];

export const EXTERNAL_FALKORDB_GUIDANCE =
  'Embedded FalkorDBLite is unavailable on this platform. Set CODEGRAPH_DRIVER=falkordb and FALKORDB_URL, or configure FALKORDB_HOST and FALKORDB_PORT.';

export function normalizeSetupStatus(status: SetupStatus): SetupStatus {
  if (status.storage.ownerState !== 'blocked' || status.storage.externalGuidance !== null) {
    return status;
  }
  return {
    ...status,
    storage: {
      ...status.storage,
      externalGuidance: EXTERNAL_FALKORDB_GUIDANCE,
    },
  };
}

export async function readBlockedSetupStatus(): Promise<SetupStatus | null> {
  const status = normalizeSetupStatus(await getSetupStatus());
  return status.storage.ownerState === 'blocked' ? status : null;
}
