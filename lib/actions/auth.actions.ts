"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  forgotPasswordFormSchema,
  resetPasswordFormSchema,
  signInFormSchema,
  signUpFormSchema,
} from "@/lib/validations/auth";
import { createClient } from "@/lib/supabase/server";
import { getAppBaseUrl } from "@/lib/app-url";
import { db } from "@/db";
import { formatError } from "@/lib/utils";
import { resolveAuthCallbackDestination } from "@/lib/auth-redirects";
import { resolveRoleFromDatabase } from "@/lib/auth/server-roles";
import { AuthService } from "@/lib/services/auth/auth.service";
import { AuthUserForm } from "@/lib/types/auth";

function redirectForRole(role: string | undefined, requestedNext: string | null = null) {
  const destination = resolveAuthCallbackDestination(role, requestedNext);
  revalidatePath(destination.split(/[?#]/, 1)[0]);
  return redirect(destination);
}

/** Log bounded diagnostic fields only: DB errors may contain SQL and credentials. */
function portalLookupFailure(error: unknown): { errorCode: string; reason: string } {
  const transportCodes = new Set([
    "ERR_INVALID_URL", "ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ECONNRESET",
    "ETIMEDOUT", "EHOSTUNREACH", "ENETUNREACH", "CONNECT_TIMEOUT",
    "CONNECTION_CLOSED", "CONNECTION_ENDED", "CONNECTION_DESTROYED",
    "ERR_TLS_CERT_ALTNAME_INVALID", "CERT_HAS_EXPIRED", "DEPTH_ZERO_SELF_SIGNED_CERT",
    "SELF_SIGNED_CERT_IN_CHAIN", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  ]);
  let current = error;
  let errorCode = "UNKNOWN";
  let reason = "database_lookup_failed";
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth++) {
    const entry = current as { code?: unknown; message?: unknown; cause?: unknown };
    if (errorCode === "UNKNOWN" && typeof entry.code === "string" &&
        (/^[0-9A-Z]{5}$/.test(entry.code) || transportCodes.has(entry.code))) errorCode = entry.code;
    if (typeof entry.message === "string") {
      if (/tenant or user not found/i.test(entry.message)) reason = "pooler_tenant_not_found";
      else if (/password authentication failed|invalid password|sasl.*signature/i.test(entry.message)) reason = "database_credentials_rejected";
    }
    current = entry.cause;
  }
  return { errorCode, reason };
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "global" });
  revalidatePath("/", "layout");
  return redirect("/sign-in");
}

/**
 * Sends a password-reset email.
 *
 * Always reports success, whatever Supabase says: telling an anonymous caller
 * whether an address has an account is an account-enumeration leak, and the
 * user-visible outcome ("check your inbox") is the same either way.
 */
export async function requestPasswordReset(
  prevState: AuthUserForm | undefined,
  formData: FormData
): Promise<AuthUserForm> {
  const email = String(formData.get("email") ?? "");
  const validation = forgotPasswordFormSchema.safeParse({ email });

  if (!validation.success) {
    return {
      success: false,
      data: { email },
      error: { message: formatError(validation.error) },
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(
    validation.data.email.toLowerCase(),
    {
      // `/auth/confirm` verifies the recovery token, establishes the session,
      // then forwards to the form that sets the new password.
      redirectTo: `${getAppBaseUrl()}/auth/confirm?type=recovery&next=${encodeURIComponent(
        "/reset-password"
      )}`,
    }
  );

  if (error) {
    console.warn("[requestPasswordReset]", error.message);
  }

  return {
    success: true,
    data: { email: validation.data.email },
    error: { message: "" },
  };
}

/** Sets a new password for the session established by the recovery link. */
export async function resetPassword(
  prevState: AuthUserForm | undefined,
  formData: FormData
): Promise<AuthUserForm> {
  const validation = resetPasswordFormSchema.safeParse({
    password: formData.get("password"),
    confirmPassword: formData.get("confirm-password"),
  });

  if (!validation.success) {
    return {
      success: false,
      data: { email: "" },
      error: { message: formatError(validation.error) },
    };
  }

  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();

  if (!claimsData?.claims?.sub) {
    return {
      success: false,
      data: { email: "" },
      error: {
        message:
          "This reset link has expired. Request a new one from the sign-in page.",
      },
    };
  }

  const { error } = await supabase.auth.updateUser({
    password: validation.data.password,
  });

  if (error) {
    return {
      success: false,
      data: { email: "" },
      error: { message: error.message },
    };
  }

  // Every other device holding the old session is signed out, so a leaked
  // password cannot keep an existing session alive.
  await supabase.auth.signOut({ scope: "others" });

  return redirect("/sign-in?reset=1");
}

export async function signUpUser(
  prevState: AuthUserForm | undefined,
  formData: FormData
) {
  const validation = signUpFormSchema.safeParse({
    email: formData.get("email") as string,
    password: formData.get("password") as string,
    confirmPassword: formData.get("confirm-password") as string,
    role: formData.get("role") as string,
    name: (formData.get("name") as string) || undefined,
  });

  if (!validation.success) {
    return {
      success: false,
      data: {
        email: formData.get("email") as string,
      },
      error: {
        message: formatError(validation.error),
      },
    };
  }

  const validatedFields = validation.data;

  const supabase = await createClient();
  const authService = new AuthService(supabase, db);

  const result = await authService.signUpUser(validatedFields);

  if (!result.success) {
    return {
      success: result.success,
      data: {
        email: validatedFields.email,
      },
      error: {
        message: result.error?.message ?? "Sign up failed. Please try again.",
      },
    };
  }

  const userRole =
    result.data?.user_metadata?.role || validatedFields.role || "user";

  return redirectForRole(userRole);
}

export async function signInUser(
  prevState: AuthUserForm | undefined,
  formData: FormData
) {
  const validation = signInFormSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });


  if (!validation.success) {
    return {
      success: false,
      data: {
        email: formData.get("email") as string,
      },
      error: {
        message: `validation: ${formatError(validation.error)}`,
      },
    };
  }

  const validatedFields = validation.data;

  const supabase = await createClient();
  const authService = new AuthService(supabase, db);

  const result = await authService.signInUser(validatedFields);

  if (!result.success) {
    return {
      success: result.success,
      data: {
        email: validatedFields.email,
      },
      error: {
        message: result.error?.message ?? "Sign in failed. Please try again.",
      },
    };
  }

  let userRole: string | undefined;
  let lookupFailure: ReturnType<typeof portalLookupFailure> | undefined;
  try {
    userRole = result.data?.id ? await resolveRoleFromDatabase(result.data.id, result.data.email) : undefined;
  } catch (error) { lookupFailure = portalLookupFailure(error); }
  if (!userRole) {
    const databaseConfigured = Boolean(process.env.DATABASE_URL?.trim());
    console.warn("[auth] Portal profile unavailable", {
      databaseConfigured,
      reason: lookupFailure?.reason ?? (databaseConfigured ? "profile_not_found" : "database_unconfigured"),
      errorCode: lookupFailure?.errorCode ?? null,
    });
    return {
      success: false, data: { email: validatedFields.email },
      error: { message: "Signed in, but your portal profile could not be loaded. Try again or contact CleanNami." },
    };
  }
  const requestedNext = formData.get("next");
  return redirectForRole(userRole, typeof requestedNext === "string" ? requestedNext : null);
}
