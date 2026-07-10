import { isServiceUnavailableMessage } from "@/lib/env/messages";

export function parseCleanerApiError(
  response: Response,
  data: { error?: string } | null
): { message: string; variant: "empty" | "warning" | "error" } {
  const message =
    data?.error ??
    (response.status === 401
      ? "Please sign in again to continue."
      : response.status === 403
        ? "This page is only available to cleaner accounts."
        : "Something went wrong. Please try again.");

  if (response.ok) {
    return { message, variant: "empty" };
  }

  if (
    isServiceUnavailableMessage(message) ||
    message.toLowerCase().includes("profile") ||
    message.toLowerCase().includes("setting up your cleaner") ||
    response.status === 503
  ) {
    return { message, variant: "warning" };
  }

  return { message, variant: "error" };
}
