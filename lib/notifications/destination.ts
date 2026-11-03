type NotificationDestination = {
  type: string;
  jobId?: string | null;
  metadata?: Record<string, unknown> | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Only local portal paths may become notification links. */
function portalUrl(value: unknown, portal: "admin" | "cleaner"): string | null {
  if (typeof value !== "string" || /[\\\s\u0000-\u001f\u007f]/.test(value))
    return null;
  try {
    const url = new URL(value, "https://notification.invalid");
    if (
      !value.startsWith(`/${portal}/`) ||
      url.origin !== "https://notification.invalid"
    )
      return null;
    // Reject encoded path separators and traversal, including normalized ../ paths.
    if (url.pathname !== value.split(/[?#]/, 1)[0] || /%/i.test(url.pathname))
      return null;
    return value;
  } catch {
    return null;
  }
}

export function adminNotificationUrl(
  n: NotificationDestination,
): string | null {
  if (
    n.metadata?.source === "restock_request" &&
    typeof n.metadata.propertyId === "string" &&
    UUID.test(n.metadata.propertyId)
  ) {
    const requestId =
      typeof n.metadata.requestId === "string" &&
      UUID.test(n.metadata.requestId)
        ? n.metadata.requestId
        : null;
    return `/admin/restocking/${n.metadata.propertyId}${requestId ? `?requestId=${requestId}` : ""}`;
  }
  const saved = portalUrl(n.metadata?.url, "admin");
  if (saved) {
    const detail = saved.startsWith("/admin/job-oversight/")
      ? saved.split(/[?#]/, 1)[0].slice("/admin/job-oversight/".length)
      : null;
    // ON DELETE SET NULL clears jobId, but cannot clear a URL stored in JSON.
    if (
      detail === null ||
      (n.jobId && UUID.test(n.jobId) && detail === n.jobId)
    )
      return saved;
  }
  if (n.metadata?.source === "cleaner_dispute" || n.type === "dispute_update")
    return "/admin/disputes";
  if (n.metadata?.source === "restock_request") return "/admin/restocking";
  if (n.type === "swap_requested") return "/admin/job-oversight?view=swaps";
  return n.jobId && UUID.test(n.jobId)
    ? `/admin/job-oversight/${n.jobId}`
    : null;
}

export function cleanerNotificationUrl(
  n: NotificationDestination,
): string | null {
  if (n.metadata?.source === "restock_status") {
    const requestId =
      typeof n.metadata.requestId === "string" &&
      UUID.test(n.metadata.requestId)
        ? n.metadata.requestId
        : null;
    return `/cleaner/restocking${requestId ? `?requestId=${requestId}` : ""}`;
  }
  const saved = portalUrl(n.metadata?.url, "cleaner");
  if (saved) {
    const detail = saved.startsWith("/cleaner/jobs/")
      ? saved.split(/[?#]/, 1)[0].slice("/cleaner/jobs/".length)
      : null;
    if (
      detail === null ||
      (n.jobId && UUID.test(n.jobId) && detail === n.jobId)
    )
      return saved;
  }
  if (n.type === "availability_reminder") return "/cleaner/availability";
  if (n.type === "payment_ready") return "/cleaner/pay";
  if (n.type === "dispute_update" || n.type === "reliability_check")
    return "/cleaner/profile";
  // A former assignee or an urgent-cover candidate may not open job details.
  // The job API remains the authority; legacy rows go to the scoped jobs list.
  return n.jobId && UUID.test(n.jobId) ? "/cleaner/jobs" : null;
}
