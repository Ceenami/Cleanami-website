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
  if (path.length > 2048 || !path.startsWith("/") || path.startsWith("//") ||
      /[\\\s\u0000-\u001f\u007f]/.test(path)) return false;
  try {
    const url = new URL(path, "https://return.invalid");
    const pathname = path.split(/[?#]/, 1)[0];
    // Refuse normalization/traversal and encoded path separators. Query values
    // remain encoded and intact (period, job/offer IDs, role and version hints).
    return url.origin === "https://return.invalid" && url.pathname === pathname && pathname.length <= 1024 &&
      !pathname.includes("%") && !/%(?:0[0-9a-f]|1[0-9a-f]|7f|5c)/i.test(path);
  } catch { return false; }
}

/** Navigation hint only. Target pages/APIs still authorize their actual resource. */
export function safePortalReturnPath(value: unknown): string | null {
  return typeof value === "string" && isSafeRedirectPath(value) &&
    /^\/(?:admin|customer|cleaner)(?:\/|$)/.test(value.split(/[?#]/, 1)[0]) ? value : null;
}

export function signInReturnPath(requestedNext: unknown, error?: string): string {
  const params = new URLSearchParams();
  const next = safePortalReturnPath(requestedNext);
  if (next) params.set("next", next);
  if (error) params.set("error", error);
  return `/sign-in${params.size ? `?${params}` : ""}`;
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

  const next = safePortalReturnPath(requestedNext);
  if (!next) {
    return roleDefault;
  }
  const portal = role === "cleaner" ? "cleaner" : role === "admin" || role === "super_admin" ? "admin" : role === "user" ? "customer" : null;
  const pathname = next.split(/[?#]/, 1)[0];
  return portal && (pathname === `/${portal}` || pathname.startsWith(`/${portal}/`)) ? next : roleDefault;
}
