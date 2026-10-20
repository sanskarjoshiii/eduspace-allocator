import type { FacilityIssueStatus } from '@/lib/domain';
import type { FacilityIssueLean } from '@/server/worker/types';

export interface FacilityIssueDto {
  id: string;
  spaceId: string;
  spaceName: string;
  facilityTypeId: string;
  facilityName: string;
  affectedQuantity: number;
  description: string;
  evidenceUrl: string;
  status: FacilityIssueStatus;
  reportedBy: string;
  reportedByName: string;
  createdAt: string;
  resolvedAt: string | null;
  affectedAllocationIds: string[];
  /** Replacement proposals created for the affected allocations. */
  replacementAllocationIds: string[];
}

export function toFacilityIssueDto(
  i: FacilityIssueLean,
  refs: { spaceName: string; facilityName: string; reportedByName: string; replacementAllocationIds: string[] },
): FacilityIssueDto {
  return {
    id: i._id.toString(),
    spaceId: i.spaceId.toString(),
    spaceName: refs.spaceName,
    facilityTypeId: i.facilityTypeId.toString(),
    facilityName: refs.facilityName,
    affectedQuantity: i.affectedQuantity,
    description: i.description ?? '',
    evidenceUrl: i.evidenceUrl ?? '',
    status: i.status,
    reportedBy: i.reportedBy.toString(),
    reportedByName: refs.reportedByName,
    createdAt: new Date(i.createdAt).toISOString(),
    resolvedAt: i.resolvedAt ? new Date(i.resolvedAt).toISOString() : null,
    affectedAllocationIds: (i.affectedAllocationIds ?? []).map(String),
    replacementAllocationIds: refs.replacementAllocationIds,
  };
}
