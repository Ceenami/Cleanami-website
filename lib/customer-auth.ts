import "server-only";

import { getDbOrNull } from "@/db";
import { customers, jobs, properties } from "@/db/schemas";
import { createClient } from "@/lib/supabase/server";
import {
  getSessionIdentity,
  getSessionRole,
  resolveRoleFromDatabase,
} from "@/lib/auth/server-roles";
import { SERVICE_UNAVAILABLE } from "@/lib/env/messages";
import { and, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";

export type CustomerAuthResult = {
  customerId: string | null;
  error: string | null;
};

async function resolveCustomerEmail(
  claimsEmail: string | undefined
): Promise<string | null> {
  if (claimsEmail && claimsEmail.length > 0) {
    return claimsEmail;
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user?.email) {
    return null;
  }

  return data.user.email;
}

async function lookupCustomerByEmail(email: string) {
  const database = getDbOrNull();
  if (!database) {
    return { customerId: null, error: SERVICE_UNAVAILABLE.database };
  }

  const customer = await database.query.customers.findFirst({
    where: eq(customers.email, email.toLowerCase()),
    columns: { id: true, portalAccessEnabled: true },
  });

  if (!customer) {
    return {
      customerId: null,
      error:
        "No property profile found for this account. Complete booking onboarding or contact support.",
    };
  }

  if (!customer.portalAccessEnabled) {
    return {
      customerId: null,
      error:
        "Your customer portal is not active yet. Complete booking and first payment to access your dashboard.",
    };
  }

  return { customerId: customer.id, error: null };
}

/**
 * Resolves the customer row linked to the signed-in user's email.
 * Regular customers (role=user) and admin/super_admin accounts that have a
 * linked customers row (same email, portal_access_enabled) may use customer APIs.
 */
export async function getCustomerAuth(): Promise<CustomerAuthResult> {
  // Identity via `getSessionIdentity()`, which reads the cookie session OR an
  // `Authorization: Bearer` token. This used to read cookies only, while
  // `getSessionRole()` has always been bearer-aware — so the two could
  // disagree inside a single request, and a bearer-authenticated caller would
  // pass the role gate only to be refused here as unauthenticated.
  const { supabaseUserId, email: claimsEmail } = await getSessionIdentity();

  if (!supabaseUserId) {
    return { customerId: null, error: "Unauthorized" };
  }

  const userRole = await resolveRoleFromDatabase(supabaseUserId, claimsEmail);
  if (userRole === "cleaner") {
    return { customerId: null, error: "Forbidden" };
  }

  const isCustomer = userRole === "user";
  const isAdmin = userRole === "admin" || userRole === "super_admin";

  if (!isCustomer && !isAdmin) {
    return { customerId: null, error: "Forbidden" };
  }

  const email = await resolveCustomerEmail(claimsEmail);
  if (!email) {
    return {
      customerId: null,
      error:
        "Could not resolve your account email. Try signing out and back in.",
    };
  }

  return lookupCustomerByEmail(email);
}

/**
 * Gate for /customer/* pages. Regular customers (role=user) and founders/admins
 * with a linked customers row (same email, portal_access_enabled) may enter.
 */
export async function getCustomerPortalLayoutAuth(): Promise<CustomerAuthResult> {
  // Identity via `getSessionIdentity()`, which reads the cookie session OR an
  // `Authorization: Bearer` token. This used to read cookies only, while
  // `getSessionRole()` has always been bearer-aware — so the two could
  // disagree inside a single request, and a bearer-authenticated caller would
  // pass the role gate only to be refused here as unauthenticated.
  const { supabaseUserId, email: claimsEmail } = await getSessionIdentity();

  if (!supabaseUserId) {
    return { customerId: null, error: "Unauthorized" };
  }

  const userRole = await resolveRoleFromDatabase(supabaseUserId, claimsEmail);
  if (userRole === "cleaner") {
    return { customerId: null, error: "Forbidden" };
  }

  const isCustomer = userRole === "user";
  const isAdmin = userRole === "admin" || userRole === "super_admin";

  if (!isCustomer && !isAdmin) {
    return { customerId: null, error: "Forbidden" };
  }

  const email = await resolveCustomerEmail(claimsEmail);
  if (!email) {
    return {
      customerId: null,
      error:
        "Could not resolve your account email. Try signing out and back in.",
    };
  }

  return lookupCustomerByEmail(email);
}

export type PortalCustomerScope = {
  isAdmin: boolean;
  isCustomer: boolean;
  customerId?: string;
  error: string | null;
};

/**
 * Admin portal: full data unless ownerScope=1.
 * Customer portal (or ownerScope): data scoped to the linked customer row.
 *
 * The role is resolved authoritatively from the DB (`users.role`) — callers no
 * longer pass a client-derived role.
 */
export async function resolvePortalCustomerScope(
  request: NextRequest
): Promise<PortalCustomerScope> {
  const userRole = await getSessionRole();
  const isAdmin = userRole === "admin" || userRole === "super_admin";
  const isCustomer = userRole === "user";
  const ownerScope = request.nextUrl.searchParams.get("ownerScope") === "1";

  if (!isAdmin && !isCustomer) {
    return {
      isAdmin: false,
      isCustomer: false,
      error: "Unauthorized",
    };
  }

  if (isCustomer) {
    const { customerId, error } = await getCustomerAuth();
    if (!customerId) {
      return {
        isAdmin,
        isCustomer,
        error: error ?? "Unauthorized",
      };
    }

    return {
      isAdmin,
      isCustomer,
      customerId,
      error: null,
    };
  }

  if (isAdmin && ownerScope) {
    const { supabaseUserId, email: claimsEmail } = await getSessionIdentity();
    if (!supabaseUserId) {
      return { isAdmin, isCustomer, error: "Unauthorized" };
    }

    const email = await resolveCustomerEmail(claimsEmail);
    if (!email) {
      return { isAdmin, isCustomer, error: "Unauthorized" };
    }

    const { customerId, error } = await lookupCustomerByEmail(email);
    if (!customerId) {
      return { isAdmin, isCustomer, error: error ?? "Unauthorized" };
    }

    return { isAdmin, isCustomer, customerId, error: null };
  }

  return {
    isAdmin,
    isCustomer,
    error: null,
  };
}

export async function customerOwnsJob(
  customerId: string,
  jobId: string
): Promise<boolean> {
  const database = getDbOrNull();
  if (!database) return false;

  const row = await database
    .select({ id: jobs.id })
    .from(jobs)
    .innerJoin(properties, eq(jobs.propertyId, properties.id))
    .where(and(eq(jobs.id, jobId), eq(properties.customerId, customerId)))
    .limit(1);

  return row.length > 0;
}

export function customerAuthErrorStatus(error: string | null): number {
  if (error === SERVICE_UNAVAILABLE.database) {
    return 503;
  }
  if (error?.includes("property profile")) {
    return 503;
  }
  if (error === "Forbidden") {
    return 403;
  }
  return 401;
}
