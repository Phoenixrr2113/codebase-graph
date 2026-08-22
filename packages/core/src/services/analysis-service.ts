import { createAnalysisQueries } from '@codegraph/graph';
import type {
  BlastRadiusInput,
  BlastRadiusResult,
  ImportCyclesInput,
  ImportCyclesResult,
  CallHierarchyInput,
  CallHierarchyResult,
  UnreferencedExportsInput,
  UnreferencedExportsResult,
  HotspotsInput,
  HotspotsResult,
  ChangeCouplingInput,
  ChangeCouplingResult,
} from '@codegraph/graph';
import { getGraphClient } from '../graphClient';

export async function getBlastRadiusImpl(input: BlastRadiusInput): Promise<BlastRadiusResult> {
  return createAnalysisQueries(await getGraphClient()).getBlastRadius(input);
}

export async function getImportCyclesImpl(input: ImportCyclesInput): Promise<ImportCyclesResult> {
  return createAnalysisQueries(await getGraphClient()).getImportCycles(input);
}

export async function getCallHierarchyImpl(input: CallHierarchyInput): Promise<CallHierarchyResult> {
  return createAnalysisQueries(await getGraphClient()).getCallHierarchy(input);
}

export async function getUnreferencedExportsImpl(
  input: UnreferencedExportsInput,
): Promise<UnreferencedExportsResult> {
  return createAnalysisQueries(await getGraphClient()).getUnreferencedExports(input);
}

export async function getHotspotsImpl(input: HotspotsInput): Promise<HotspotsResult> {
  return createAnalysisQueries(await getGraphClient()).getHotspots(input);
}

export async function getChangeCouplingImpl(
  input: ChangeCouplingInput,
): Promise<ChangeCouplingResult> {
  return createAnalysisQueries(await getGraphClient()).getChangeCoupling(input);
}
