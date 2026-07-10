export function resolvePostAuthPath(role: string | undefined): string {
  if (role === "cleaner") {
    return "/cleaner/jobs";
  }

  if (role === "admin" || role === "super_admin") {
    return "/admin/dashboard";
  }

  return "/customer/dashboard";
}

export function isSafeRedirectPath(path: string): boolean {
  return path.startsWith("/") && !path.startsWith("//");
}

/**
 * Picks where to send a user after auth/callback.
 * Prevents cleaners from landing on the customer portal (and being bounced to /).
 */
export function resolveAuthCallbackDestination(
  role: string | undefined,
  requestedNext: string | null
): string {
  const roleDefault = resolvePostAuthPath(role);

  if (!requestedNext || !isSafeRedirectPath(requestedNext)) {
    return roleDefault;
  }

  if (role === "cleaner" && !requestedNext.startsWith("/cleaner")) {
    return roleDefault;
  }

  if (
    (role === "admin" || role === "super_admin") &&
    (requestedNext.startsWith("/cleaner") || requestedNext.startsWith("/customer"))
  ) {
    return roleDefault;
  }

  if (role === "user" && requestedNext.startsWith("/cleaner")) {
    return roleDefault;
  }

  return requestedNext;
}
