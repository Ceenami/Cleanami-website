import type { RestockStatus, RestockUrgency } from "@/db/schemas";

export const OPEN_RESTOCK_STATUSES: RestockStatus[] = [
  "requested",
  "approved",
  "ordered",
];
export function isOpenRestock(status: RestockStatus) {
  return OPEN_RESTOCK_STATUSES.includes(status);
}
export const RESTOCK_ACTIONS: Record<RestockStatus, RestockStatus[]> = {
  requested: ["approved", "declined"],
  approved: ["ordered", "fulfilled", "declined"],
  ordered: ["fulfilled", "declined"],
  fulfilled: [],
  declined: ["requested"],
};
export const RESTOCK_ACTION_LABELS: Record<RestockStatus, string> = {
  requested: "Reopen",
  approved: "Approve",
  ordered: "Mark ordered",
  fulfilled: "Mark fulfilled",
  declined: "Decline",
};
export type RestockItem = {
  id: string;
  propertyId: string;
  jobId: string | null;
  jobDate: string | null;
  cleanerName: string | null;
  item: string;
  quantity: number;
  urgency: RestockUrgency;
  notes: string | null;
  status: RestockStatus;
  adminNotes: string | null;
  createdAt: string;
  resolvedAt: string | null;
};
export type RestockProperty = {
  propertyId: string;
  address: string;
  openCount: number;
  urgentCount: number;
  totalCount: number;
  latestRequestAt: string;
};
export type RestockSummary = {
  properties: RestockProperty[];
  page: number;
  hasMore: boolean;
  totals: {
    openCount: number;
    propertyCount: number;
    urgentCount: number;
    totalCount: number;
  };
};
export type RestockDetails = {
  requests: RestockItem[];
  nextCursor: string | null;
  focusedRequest: RestockItem | null;
  openCount: number;
  totalCount: number;
};
export function restockPropertyUrl(propertyId: string, requestId?: string) {
  return `/admin/restocking/${propertyId}${requestId ? `?requestId=${requestId}` : ""}`;
}
