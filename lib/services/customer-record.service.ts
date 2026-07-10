import "server-only";

import { db } from "@/db";
import { customers, users } from "@/db/schemas";
import { createAdminClient } from "@/lib/supabase/server";
import { getStripe } from "@/lib/stripe/get-stripe";
import { eq } from "drizzle-orm";

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
