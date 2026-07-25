import "server-only";

import { db } from "@/db";
import { customers, jobs, properties, subscriptions, users } from "@/db/schemas";
import { createAdminClient } from "@/lib/supabase/server";
import { getStripe } from "@/lib/stripe/get-stripe";
import { and, eq, inArray } from "drizzle-orm";

export type CustomerContactPatch = {
  name?: string;
  email?: string;
  phone?: string | null;
};

async function findAuthUserIdByEmail(email: string): Promise<string | null> {
  const supabaseAdmin = createAdminClient();
  let page = 1;

  while (page <= 10) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage: 200,
    });

    if (error) {
      throw new Error(error.message);
    }

    const match = data.users.find(
      (user) => user.email?.toLowerCase() === email.toLowerCase()
    );
    if (match) return match.id;

    if (data.users.length < 200) break;
    page += 1;
  }

  return null;
}

async function syncStripeCustomer(input: {
  stripeCustomerId: string | null;
  previousEmail: string;
  email: string;
  name: string;
  phone: string | null;
}): Promise<void> {
  const stripe = getStripe();
  if (!stripe) return;

  const payload = {
    email: input.email,
    name: input.name,
    phone: input.phone ?? undefined,
  };

  if (input.stripeCustomerId) {
    await stripe.customers.update(input.stripeCustomerId, payload);
    return;
  }

  const existing = await stripe.customers.list({
    email: input.previousEmail,
    limit: 1,
  });

  if (existing.data.length > 0) {
    await stripe.customers.update(existing.data[0].id, payload);
  }
}

async function syncAuthAndAppUser(input: {
  previousEmail: string;
  email: string;
  name: string;
}): Promise<void> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return;

  const supabaseAdmin = createAdminClient();
  const authUserId =
    (await findAuthUserIdByEmail(input.previousEmail)) ??
    (await findAuthUserIdByEmail(input.email));

  if (authUserId) {
    const { error } = await supabaseAdmin.auth.admin.updateUserById(authUserId, {
      email: input.email,
      email_confirm: true,
      app_metadata: { role: "user" },
      user_metadata: {
        role: "user",
        full_name: input.name,
        name: input.name,
      },
    });

    if (error) {
      throw new Error(`Could not update login email: ${error.message}`);
    }
  }

  const appUser = await db.query.users.findFirst({
    where: eq(users.email, input.previousEmail.toLowerCase()),
    columns: { id: true },
  });

  if (appUser) {
    await db
      .update(users)
      .set({
        email: input.email.toLowerCase(),
        name: input.name,
        updatedAt: new Date(),
      })
      .where(eq(users.id, appUser.id));
  }
}

/**
 * Updates a customer row and keeps Stripe + Supabase auth in sync when contact
 * details change (especially email).
 */
export async function updateCustomerContact(
  customerId: string,
  patch: CustomerContactPatch
): Promise<{ id: string; name: string; email: string; phone: string | null }> {
  const existing = await db.query.customers.findFirst({
    where: eq(customers.id, customerId),
  });

  if (!existing) {
    throw new Error("Customer not found");
  }

  const nextEmail = patch.email?.trim().toLowerCase() ?? existing.email;
  const nextName = patch.name?.trim() ?? existing.name;
  const nextPhone =
    patch.phone !== undefined ? patch.phone?.trim() || null : existing.phone;

  if (nextEmail !== existing.email) {
    const emailTaken = await db.query.customers.findFirst({
      where: eq(customers.email, nextEmail),
      columns: { id: true },
    });

    if (emailTaken && emailTaken.id !== customerId) {
      throw new Error("Another customer already uses this email");
    }
  }

  const [updated] = await db
    .update(customers)
    .set({
      name: nextName,
      email: nextEmail,
      phone: nextPhone,
      updatedAt: new Date(),
    })
    .where(eq(customers.id, customerId))
    .returning({
      id: customers.id,
      name: customers.name,
      email: customers.email,
      phone: customers.phone,
      stripeCustomerId: customers.stripeCustomerId,
    });

  const emailChanged = nextEmail !== existing.email;
  const contactChanged =
    emailChanged ||
    nextName !== existing.name ||
    nextPhone !== existing.phone;

  if (contactChanged) {
    await syncStripeCustomer({
      stripeCustomerId: updated.stripeCustomerId,
      previousEmail: existing.email,
      email: nextEmail,
      name: nextName,
      phone: nextPhone,
    });
  }

  if (emailChanged) {
    await syncAuthAndAppUser({
      previousEmail: existing.email,
      email: nextEmail,
      name: nextName,
    });
  }

  return {
    id: updated.id,
    name: updated.name,
    email: updated.email,
    phone: updated.phone,
  };
}

export type DeleteCustomerResult = {
  customerId: string;
  name: string;
  email: string;
  deletedPropertyCount: number;
};

/**
 * Permanently delete a customer (task 1.7).
 *
 * Deliberately **refusal-based**, mirroring `deleteProperty` in
 * `lib/queries/properties.ts`: a customer with cleaning history or a live
 * subscription is never silently cascaded away, because that history is the
 * payout, dispute and reserve-ledger trail. The admin is told what to resolve
 * first instead. Only a customer with no jobs and no active subscription can be
 * removed — the genuine "created in error / duplicate / never onboarded" case.
 *
 * What the FK graph does on a permitted delete: `properties`, `subscriptions`
 * and `ratings` cascade; `promo_redemptions.customer_id` is set null so the
 * redemption record (and its burn count) survives.
 *
 * The Stripe customer is intentionally left in place — deleting it would
 * destroy invoice/charge history that Stripe keeps for reporting and disputes.
 */
export async function deleteCustomer(
  customerId: string
): Promise<DeleteCustomerResult> {
  const customer = await db.query.customers.findFirst({
    where: eq(customers.id, customerId),
    columns: { id: true, name: true, email: true },
  });

  if (!customer) {
    throw new Error("Customer not found");
  }

  const ownedProperties = await db.query.properties.findMany({
    where: eq(properties.customerId, customerId),
    columns: { id: true },
  });
  const propertyIds = ownedProperties.map((property) => property.id);

  if (propertyIds.length > 0) {
    const linkedJob = await db.query.jobs.findFirst({
      where: inArray(jobs.propertyId, propertyIds),
      columns: { id: true },
    });

    if (linkedJob) {
      // `jobs.property_id` has no ON DELETE rule, so this would fail as a raw
      // FK violation anyway. Fail with an actionable message instead.
      throw new Error(
        "This customer has cleaning history and cannot be deleted. Their record is part of the job, payout and dispute trail."
      );
    }
  }

  const activeSubscription = await db.query.subscriptions.findFirst({
    where: and(
      eq(subscriptions.customerId, customerId),
      eq(subscriptions.status, "active")
    ),
    columns: { id: true },
  });

  if (activeSubscription) {
    throw new Error(
      "This customer has an active subscription. Cancel the subscription first, then delete the customer."
    );
  }

  await db.delete(customers).where(eq(customers.id, customerId));

  // Remove the portal login last: if it fails, the customer row is already
  // gone and the orphaned login can no longer resolve to any data.
  await deletePortalLogin(customer.email);

  return {
    customerId,
    name: customer.name,
    email: customer.email,
    deletedPropertyCount: propertyIds.length,
  };
}

/**
 * Best-effort removal of the customer's Supabase auth user and `users` row.
 * The link is by email, the same way `syncAuthAndAppUser` resolves it.
 * Failures are logged, not thrown — the customer record is already deleted and
 * a leftover login is an admin cleanup task, not a reason to report failure.
 */
async function deletePortalLogin(email: string): Promise<void> {
  const normalized = email.toLowerCase();

  try {
    await db.delete(users).where(eq(users.email, normalized));
  } catch (err) {
    console.error("[deleteCustomer] could not remove users row", err);
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return;

  try {
    const authUserId = await findAuthUserIdByEmail(normalized);
    if (!authUserId) return;

    const supabaseAdmin = createAdminClient();
    const { error } = await supabaseAdmin.auth.admin.deleteUser(authUserId);
    if (error) {
      console.error("[deleteCustomer] could not remove auth user", error);
    }
  } catch (err) {
    console.error("[deleteCustomer] auth cleanup failed", err);
  }
}
