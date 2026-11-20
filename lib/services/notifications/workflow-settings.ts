import "server-only";
export const notificationWorkflowSchemaReady = () => process.env.NOTIFICATION_WORKFLOWS_SCHEMA_READY === "true";
/** Explicit cutoff prevents old/demo events being dispatched when rollout is enabled. */
export function notificationWorkflowCutoff(): Date | null {
  if (!notificationWorkflowSchemaReady() || process.env.NOTIFICATION_WORKFLOWS_ENABLED !== "true" ||
      !["test", "production"].includes(process.env.NOTIFICATION_WORKFLOWS_ENVIRONMENT ?? "")) return null;
  const raw = process.env.NOTIFICATION_WORKFLOWS_SINCE;
  if (!raw || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(raw)) return null;
  const at = new Date(raw);
  return Number.isFinite(+at) ? at : null;
}
export function workflowRecipientAllowed(recipient: string) {
  if (process.env.NOTIFICATION_WORKFLOWS_ENVIRONMENT !== "test") return true;
  return (process.env.NOTIFICATION_TEST_RECIPIENTS ?? "").split(",").map(s => s.trim().toLowerCase()).includes(recipient.toLowerCase());
}
