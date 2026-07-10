import "server-only";

import { db } from "@/db";
import { users } from "@/db/schemas";
import { sendCustomerPortalEmail } from "@/lib/services/email.service";
import { getAppBaseUrl } from "@/lib/app-url";
import { createAdminClient } from "@/lib/supabase/server";
import { eq } from "drizzle-orm";

export type InviteCustomerPortalResult =
  | { success: true; supabaseUserId: string; emailSent: boolean }
  | { success: false; error: string };

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

async function upsertAppUser(input: {
  supabaseUserId: string;
  email: string;
  name: string;
}) {
  const existing = await db.query.users.findFirst({
    where: eq(users.supabaseUserId, input.supabaseUserId),
    columns: { id: true },
  });

  if (existing) {
    await db
      .update(users)
      .set({
        email: input.email.toLowerCase(),
        name: input.name,
        role: "user",
        updatedAt: new Date(),
      })
      .where(eq(users.id, existing.id));
    return;
  }

  const byEmail = await db.query.users.findFirst({
    where: eq(users.email, input.email.toLowerCase()),
    columns: { id: true },
  });

  if (byEmail) {
    await db
      .update(users)
      .set({
        supabaseUserId: input.supabaseUserId,
        name: input.name,
        role: "user",
        updatedAt: new Date(),
      })
      .where(eq(users.id, byEmail.id));
    return;
  }

  await db.insert(users).values({
    supabaseUserId: input.supabaseUserId,
    email: input.email.toLowerCase(),
    name: input.name,
    role: "user",
  });
}

async function sendPortalLoginEmail(input: {
  email: string;
  name: string;
  isNewUser: boolean;
}): Promise<boolean> {
  const supabaseAdmin = createAdminClient();
  const redirectTo = `${getAppBaseUrl()}/auth/callback?next=/customer/dashboard`;

  if (input.isNewUser) {
    const { error } = await supabaseAdmin.auth.admin.inviteUserByEmail(
      input.email,
      {
        redirectTo,
        data: {
          role: "user",
          full_name: input.name,
          name: input.name,
        },
      }
    );

    if (!error) return true;

    console.warn(
      "[inviteCustomerToPortalAfterPayment] inviteUserByEmail failed:",
      error.message
    );
  }

  const { data, error } = await supabaseAdmin.auth.admin.generateLink({
    type: "magiclink",
    email: input.email,
    options: { redirectTo },
  });

  if (error || !data.properties?.action_link) {
    console.error(
      "[inviteCustomerToPortalAfterPayment] generateLink failed:",
      error?.message
    );
    return false;
  }

  const emailResult = await sendCustomerPortalEmail({
    to: input.email,
    loginUrl: data.properties.action_link,
    recipientName: input.name,
    isNewUser: input.isNewUser,
  });

  if (!emailResult.success) {
    console.error(
      "[inviteCustomerToPortalAfterPayment] email send failed:",
      emailResult.error
    );
    return false;
  }

  return true;
}

/**
 * Creates the Supabase auth user (no password) and emails a magic link or
 * invite after booking payment. Only call after portal_access_enabled is set.
 */
export async function inviteCustomerToPortalAfterPayment(input: {
  email: string;
  name: string;
}): Promise<InviteCustomerPortalResult> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return {
      success: false,
      error: "Customer login setup is not configured. Contact support.",
    };
  }

  const email = input.email.trim().toLowerCase();
  const supabaseAdmin = createAdminClient();

  try {
    const existingAuthUserId = await findAuthUserIdByEmail(email);
    let supabaseUserId = existingAuthUserId;
    const isNewUser = !existingAuthUserId;

    if (existingAuthUserId) {
      const { error: updateError } =
        await supabaseAdmin.auth.admin.updateUserById(existingAuthUserId, {
          email_confirm: true,
          user_metadata: {
            role: "user",
            full_name: input.name,
            name: input.name,
          },
        });

      if (updateError) {
        return { success: false, error: updateError.message };
      }
    } else {
      const { data, error } = await supabaseAdmin.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: {
          role: "user",
          full_name: input.name,
          name: input.name,
        },
      });

      if (error || !data.user) {
        return {
          success: false,
          error: error?.message ?? "Could not create customer login",
        };
      }

      supabaseUserId = data.user.id;
    }

    if (!supabaseUserId) {
      return { success: false, error: "Could not resolve customer login" };
    }

    await upsertAppUser({
      supabaseUserId,
      email,
      name: input.name,
    });

    const emailSent = await sendPortalLoginEmail({
      email,
      name: input.name,
      isNewUser,
    });

    return { success: true, supabaseUserId, emailSent };
  } catch (err) {
    console.error("[inviteCustomerToPortalAfterPayment]", err);
    return {
      success: false,
      error:
        err instanceof Error
          ? err.message
          : "Failed to create customer login account",
    };
  }
}
