import "server-only";

import { getDbOrNull } from "@/db";
import { customers, jobs, properties } from "@/db/schemas";
import { createClient } from "@/lib/supabase/server";
import { SERVICE_UNAVAILABLE } from "@/lib/env/messages";
import { and, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";

export type CustomerAuthResult = {
  customerId: string | null;
  error: string | null;
};

async function resolveCustomerEmail(
  claims: Record<string, unknown>
): Promise<string | null> {
  if (typeof claims.email === "string" && claims.email.length > 0) {
    return claims.email;
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
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;

  if (!claims?.sub) {
    return { customerId: null, error: "Unauthorized" };
  }

  const userRole = claims.user_metadata?.role as string | undefined;
  if (userRole === "cleaner") {
    return { customerId: null, error: "Forbidden" };
  }

  const isCustomer = userRole === "user";
  const isAdmin = userRole === "admin" || userRole === "super_admin";

  if (!isCustomer && !isAdmin) {
    return { customerId: null, error: "Forbidden" };
  }

  const email = await resolveCustomerEmail(claims);
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
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;

  if (!claims?.sub) {
    return { customerId: null, error: "Unauthorized" };
  }

  const userRole = claims.user_metadata?.role as string | undefined;
  if (userRole === "cleaner") {
    return { customerId: null, error: "Forbidden" };
  }

  const isCustomer = userRole === "user";
  const isAdmin = userRole === "admin" || userRole === "super_admin";

  if (!isCustomer && !isAdmin) {
    return { customerId: null, error: "Forbidden" };
  }

  const email = await resolveCustomerEmail(claims);
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
 */
export async function resolvePortalCustomerScope(
  request: NextRequest,
  userRole: string | undefined
): Promise<PortalCustomerScope> {
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
    const supabase = await createClient();
    const { data } = await supabase.auth.getClaims();
    const claims = data?.claims;
    if (!claims?.sub) {
      return { isAdmin, isCustomer, error: "Unauthorized" };
    }

    const email = await resolveCustomerEmail(claims);
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
